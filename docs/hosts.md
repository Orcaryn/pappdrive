# Hosting the engine: iOS, Android, desktop in any language

The engine is the JavaScript library. It never gets ported; it gets hosted. Every host runs the same code and talks to it through one message envelope.

| Host                     | Package                     | Runs the engine in             | Files live in       | Keys live in                        |
| ------------------------ | --------------------------- | ------------------------------ | ------------------- | ----------------------------------- |
| Web, Capacitor, Electron | `pappdrive` (npm)           | the page or the Node process   | OPFS or a folder    | IndexedDB, keychain, safeStorage    |
| iOS native (Swift)       | `packages/swift` (SwiftPM)  | a hidden `WKWebView`           | the web view's OPFS | Keychain                            |
| Android native (Kotlin)  | `packages/android` (Gradle) | a hidden `WebView`             | the web view's OPFS | Android Keystore + noBackupFilesDir |
| Desktop, any language    | `pappdrived` (one binary)   | a child process the app spawns | a folder            | the host's own secure storage       |

Phones sync only while the app is in the foreground. With `syncOnBackground` on, the host asks the engine to flush when the app goes to the background; nothing runs after that. It is off by default.

## The envelope

Text messages, one JSON object each. Both sides send requests and get replies. Only the engine sends notifications (a request without `id`).

```
→ { "id": 1, "method": "files.writeText", "params": { "files": "own", "path": "a.md", "text": "hi" } }
← { "id": 1, "ok": true, "value": null }
← { "id": 1, "ok": false, "error": { "code": "not-found", "message": "not-found: ...", "retryAfter": 60, "reason": "app" } }
→ { "method": "change", "params": { "files": "own", "change": { "path": "a.md", "origin": "remote" } } }
```

- `error.code` is a `SyncError` code from [api.md §11](api.md#11-errors), or `bad-request` (unknown method or folder handle) or `internal` (a bug; the message says what).
- Bytes travel as base64, in slices, so neither side holds a whole big file:
  - Write: `files.writeStart` → transfer id, then `files.writeChunk` per slice, then `files.writeEnd`. The file appears whole at `writeEnd`, or not at all. Send each chunk after the last one's reply; any slice size works, the hosts here use 1 MiB.
  - Read: `files.readStart` → transfer id, then `files.readChunk` until it answers null. A file replaced while it is read fails the next chunk with `changed`; read it again.
  - A transfer that fails in the engine closes itself. A host that gives up on one for its own reason sends `files.cancel`; cancelling a closed transfer does nothing.
- `open` and `openReadOnly` answer with a folder handle (`"own"`, `"read:<app>"`). Every `files.*` call names it in `params.files`. `signOut`, `deleteApp`, `deleteAccount` and `close` forget all handles.

### Methods the engine answers

Each mirrors the function of the same name in [api.md](api.md).

| Method                                                             | params                                                        | value                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------- |
| `signedIn` (waits for the session restore)                         | `{}`                                                          | boolean                           |
| `open`                                                             | `{ where: { mode: "private" } \| { mode: "visible", path } }` | handle                            |
| `openReadOnly`                                                     | `{ app }`                                                     | handle                            |
| `signUp`                                                           | `{ email, password }`                                         | `{ recoveryCode }`                |
| `pendingSignUp`                                                    | `{}`                                                          | `{ email, recoveryCode }` or null |
| `confirmRecoveryCode`, `sendVerificationEmail`, `signOut`, `close` | `{}`                                                          | null                              |
| `verifyEmail`                                                      | `{ code }`                                                    | null                              |
| `signIn`                                                           | `{ email, password }`                                         | null                              |
| `recover`                                                          | `{ email, recoveryCode, newPassword }`                        | null                              |
| `setPassword`                                                      | `{ newPassword }`                                             | null                              |
| `deleteApp`, `deleteAccount`                                       | `{ password }`                                                | null                              |
| `files.readOnly`                                                   | `{ files }`                                                   | boolean                           |
| `files.writeText`                                                  | `{ files, path, text }`                                       | null                              |
| `files.writeStart`, `files.readStart`                              | `{ files, path }`                                             | transfer id                       |
| `files.writeChunk`                                                 | `{ id, base64 }`                                              | null                              |
| `files.writeEnd`, `files.cancel`                                   | `{ id }`                                                      | null                              |
| `files.readChunk`                                                  | `{ id }`                                                      | base64 string, or null at the end |
| `files.readText`                                                   | `{ files, path }`                                             | string                            |
| `files.list`                                                       | `{ files, dir? }`                                             | `FileInfo[]`                      |
| `files.remove`                                                     | `{ files, path }`                                             | null                              |
| `files.status`                                                     | `{ files }`                                                   | `Status`                          |
| `files.sync`                                                       | `{ files }`                                                   | null                              |

### Notifications the engine sends

- `ready` `{}`: the engine restored its session and takes calls (the sidecar only; the web view hosts gate on their own `host.ready`).
- `change` `{ files, change }` and `status` `{ files, status }` for every open handle. Shapes in [api.md §7 and §8](api.md#7-watch).

### Requests the engine makes of its host

- `host.keystore.get` `{ name }` → string or null; `host.keystore.set` `{ name, value }`; `host.keystore.delete` `{ name }`. Every host answers these: the engine keeps nothing secret itself. Store the values in the OS keychain or encrypted; they hold the session and the data key. The engine asks for the key before it reports `ready`.
- With `syncOnBackground` on, web view hosts send `host.background` `{}` when the app leaves the foreground. It is a request. iOS waits for the reply inside a background task; Android does not wait. A sync that fails there shows in `status`, not in the reply.

## iOS: `packages/swift`

```swift
import Pappdrive

let papp = Pappdrive(server: "https://sync.pappdrive.com", app: "journal")
if try await !papp.signedIn() { try await papp.signIn(email: email, password: password) }
let files = try await papp.open()
try await files.write("2026-10-21.md", text: "Hello")
try await files.write("video.mov", contentsOf: pickedFileURL)
try await files.read("video.mov", to: localURL)
let stop = files.watch { change in ... }
```

- `write(_:data:)` and `read(_:)` hold the whole file in memory. For big files, stream through a file: `write(_:contentsOf:)` and `read(_:to:)` keep one 1 MiB slice in memory.

- Add the package by the repository URL; `Package.swift` is at the root. iOS 16 and up. The engine's page loads from `pappdrive://app`, a scheme the package serves from its bundle; WebKit treats scheme-handler origins as secure, which OPFS and WebCrypto require.
- The web view attaches itself to the key window at zero size. WebKit throttles pages whose view is not in a window.
- Errors are `PappError` with `code`, `message`, `retryAfter`, `reason`. After iOS kills the web content process, pending calls fail with code `restarted`; the engine reloads, restores the session and reopens the folders the app had open. Retry the call. A reopen that fails fails the folder's later calls with its error.
- The engine stops when the last reference to the `Pappdrive` and its `Files` goes away.
- A page that does not load, or an engine that does not start, is a build fault and stops the app with the error.
- `KeychainKeyStore` is the default. Pass your own `KeyStore` to share the session with an app group or a different service name.
- `syncOnBackground: true` flushes pending changes when the app enters the background, inside a background task. Off by default.
- Example: [examples/journal-ios](../examples/journal-ios/) (`xcodegen generate`, then open `Journal.xcodeproj`). Its UI test signs up on the real server, writes, relaunches and reads back.

## Android: `packages/android`

```kotlin
val papp = Pappdrive(context, server = "https://sync.pappdrive.com", app = "journal")
if (!papp.signedIn()) papp.signIn(email, password)
val files = papp.open()
files.write("2026-10-21.md", "Hello")
contentResolver.openInputStream(pickedUri)!!.use { files.write("video.mp4", it) }
File(filesDir, "video.mp4").outputStream().use { files.read("video.mp4", it) }
val stop = files.watch { change -> ... }
```

- `write(path, ByteArray)` and `read(path)` hold the whole file in memory. For big files, stream: `write(path, InputStream)` and `read(path, OutputStream)` keep one 1 MiB slice in memory. They do not close the stream.

- Gradle module `:pappdrive`, minSdk 26. Needs a WebView of Chromium 109 or newer, the first with OPFS writes; every device updated since 2023 has one.
- The page loads from `https://appassets.androidplatform.net` through `WebViewAssetLoader`, so it is a secure context.
- Every function is a `suspend` function; callbacks run on the main thread. Errors are `PappException` with the same fields as on iOS. After the WebView's render process dies, the host makes a new WebView and reopens the folders, as on iOS.
- `release()` stops the engine and destroys its WebView; later calls fail with `released`. Call it before making a second `Pappdrive` for the same app.
- `KeystoreKeyStore` is the default. It keeps each value in a file under `noBackupFilesDir`, sealed with a Keystore key, so a backup never restores the data without its key.
- `syncOnBackground = true` flushes pending changes when the app's last activity stops. Off by default.
- Instrumented tests (`connectedDebugAndroidTest`) run the bundle on an emulator, including a live sign-up, write, read and deletion against the hosted server.

## Desktop, any language: `pappdrived`

A single executable built from the Node adapter. The app ships it inside its own bundle and spawns it; nothing is installed separately.

```
pappdrived --server https://sync.pappdrive.com --app journal [--read other-app] [--sync-on-background]
```

- Write requests to its stdin, one per line. Read replies, notifications and the engine's own `host.keystore.*` requests from its stdout, one per line; answer those on stdin. Warnings go to stderr.
- It sends `{ "method": "ready", "params": {} }` once the session is restored. Calls made before that wait for it.
- `open` accepts `{ mode: "visible", path }` here: a real folder on disk, watched by the OS. `~` expands.
- Closing stdin closes the engine: it syncs what is pending and exits 0, or exits 1 with the error on stderr if that sync fails.
- `--sync-on-background` also syncs on `SIGINT` and `SIGTERM`, holding the exit up to 10 seconds. Off by default.
- Build: `pnpm build:sidecar` in `packages/pappdrive` (Bun, on a Mac) gives one universal macOS binary for Apple silicon and Intel, ad-hoc signed; sign it again with the app. For Linux or Windows, build with another Bun `--target`. Bun does not embed `@parcel/watcher`'s native module, so the binary finds edits made by other programs by a scan every 10 seconds and says so on stderr once.
- A whole client in Python, 150 lines: [examples/sidecar-python](../examples/sidecar-python/).

## Using the engine from JavaScript hosts

`pappdrive/rpc` is the envelope as code: `createChannel(transport)`, `serve(papp, channel)` on the engine side, `createClient(channel)` on the other. The Electron example runs `serve` in the main process and `createClient` in the window over `ipcMain`/`ipcRenderer`: [examples/journal-electron](../examples/journal-electron/).

`pappdrive/core` exports `createPappCore(options, platform, keyStore)` and the `Platform`, `FsAdapter`, `Coordinator` and `KeyStore` types for a host that brings its own file system.
