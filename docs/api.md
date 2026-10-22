# Pappdrive: the whole API, and every rule an app must follow

Pappdrive gives a personal app one folder that stays the same on every device of its user. The app reads and writes plain files. The library syncs them in the background, works offline, and encrypts everything on the device. The server and storage see only encrypted bytes.

Read this page once, top to bottom. It is complete.

## Contents

1. [Install](#1-install)
2. [Create the app first](#2-create-the-app-first)
3. [Set up: createPapp and ready](#3-set-up-createpapp-and-ready)
4. [Sign in: the app's own form](#4-sign-in-the-apps-own-form)
5. [Open the folder: visible or private](#5-open-the-folder-visible-or-private)
6. [Files](#6-files)
7. [Watch](#7-watch)
8. [Status](#8-status)
9. [Reading another app's folder](#9-reading-another-apps-folder)
10. [Account functions](#10-account-functions)
11. [Errors](#11-errors)
12. [Path rules](#12-path-rules)
13. [.pappignore](#13-pappignore)
14. [Conflicts](#14-conflicts)
15. [Rules for app design](#15-rules-for-app-design)
16. [Platforms](#16-platforms)
17. [Limits](#17-limits)
18. [Passwords, export and deletion](#18-passwords-export-and-deletion)
19. [Checklist](#19-checklist)

## 1. Install

```sh
npm install pappdrive
```

- One package, one entry point: `"pappdrive"`.
- The right adapter is picked by the package's `exports` conditions. Node, command-line tools and Electron's main process get the node adapter. Browsers, Capacitor apps and Electron windows get the browser adapter. Use a bundler (Vite, esbuild) for browser code.
- The server is `https://sync.pappdrive.com` (no `/v1`), the hosted Pappdrive service. A user who runs their own server gives its URL instead. Keep it in an environment variable: `PAPPDRIVE_SERVER`, or `VITE_PAPPDRIVE_SERVER` in a Vite app.

## 2. Create the app first

An app must exist on the server before it can sign in. Its name is unique per user and names one folder.

```sh
export PAPPDRIVE_SERVER=https://sync.pappdrive.com   # or pass --server <url> to each command

npx pappdrive signup                   # new user: makes the account, shows the recovery code
npx pappdrive login                    # existing user
npx pappdrive apps create journal      # create the app
npx pappdrive apps list                # check
```

- The `pappdrive` command ships with the `pappdrive` package: `npx pappdrive ...` in a project that has it installed, or `npm install -g pappdrive` for a global `pappdrive`.
- App names: lowercase letters, digits and `-`, 1 to 64 characters. Example: `journal`, `my-notes`.
- The commands ask for a password in the terminal. A coding agent cannot type it. Ask the user to run them, or to run them with you watching.
- When stdin is not a terminal, the questions read their answers from it, one per line: `printf '%s\n%s\n' "$EMAIL" "$PASSWORD" | pappdrive login`. `signup` cannot be piped this way: it shows the recovery code first and then asks for its last group.
- Sign-up inside the app's own form also creates the app it names. So a brand new user can skip the CLI. An existing user who adds a new app must run `pappdrive apps create <name>` first. Otherwise sign-in fails with `no-app`.
- Every installed copy of the same app name shares the same folder. That is how the app syncs. Two different apps (for example a desktop journal and a web journal) share data only if they use the same app name.

All CLI commands:

| Command                        | Does                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- |
| `pappdrive signup`             | Makes an account. Shows the recovery code once, asks for the email code |
| `pappdrive verify`             | Sends a new email code and asks for it                                  |
| `pappdrive login` / `logout`   | Signs the CLI in or out                                                 |
| `pappdrive apps list`          | Lists the user's apps                                                   |
| `pappdrive apps create <name>` | Creates an app                                                          |
| `pappdrive export <app> <dir>` | Downloads and decrypts the whole folder of an app into `<dir>`          |
| `pappdrive delete-app <name>`  | Deletes one app's folder on every device. Final                         |
| `pappdrive delete-account`     | Deletes everything on every device. Final                               |

## 3. Set up: createPapp and ready

```ts
import { createPapp } from "pappdrive"

const papp = createPapp({
  server: "https://sync.pappdrive.com", // without /v1
  app: "journal",                     // the app name from step 2
  read: ["my-notes"],                 // optional: other apps' folders this app may read
  // keyStore: { get, set, delete },  // optional: replace where the data key is kept
  // syncOnBackground: true,          // optional: sync at once when the app leaves; off by default
})
await papp.ready  // restores a saved sign-in, if there is one

if (!papp.signedIn) {
  // show the sign-in form (section 4)
}
const files = await papp.open({ mode: "private" }) // section 5
```

- Call `createPapp` once, when the app starts. Everything else hangs off `papp`.
- `papp.signedIn` is only correct after `await papp.ready`.
- The password is asked once per device. After that the device keeps the data key: in the system keychain (Mac, Windows, Linux with a keychain), a file only the user can read when no keychain works, as on Linux without one (`~/.config/pappdrive/`, one file per server and app), or IndexedDB (browser). Never inside the app folder.
- `keyStore` replaces that storage. Interface: `get(name): Promise<string | null>`, `set(name, value): Promise<void>`, `delete(name): Promise<void>`. Values are strings. Store them encrypted. Electron apps can build one on `safeStorage`, see [examples/journal-electron](../examples/journal-electron/keystore.js). Capacitor apps wrap their secure-storage plugin with `capacitorKeyStore(plugin)` from `pappdrive/browser`.
- `syncOnBackground` (default `false`) syncs pending changes at once when the app leaves, so other devices see them sooner. Without it nothing is lost: changes already written sync on the next timer or the next open. What "leaves" means:
  - Browser: the page is hidden or unloaded.
  - Node: `SIGINT`, `SIGTERM` or `beforeExit`. The library installs handlers for these signals and holds the exit up to 10 seconds while it syncs; a second signal exits at once.
  - iOS (`Pappdrive(..., syncOnBackground: true)`): the app enters the background; the sync runs inside a background task.
  - Android (`Pappdrive(..., syncOnBackground = true)`): the app's last activity stops.

## 4. Sign in: the app's own form

The library has no UI. The app builds a small form on the account functions (section 10).

```ts
await papp.signIn(email, password)
// or, a new user:
const { recoveryCode } = await papp.signUp(email, password)
// show recoveryCode; once the user saved it:
await papp.confirmRecoveryCode()
// then ask for the 6-digit code the server emailed:
await papp.verifyEmail(code)
// or, forgot the password:
await papp.recover(email, recoveryCode, newPassword)
```

- After sign-up, show the recovery code and make the user save it, for example by typing back its last group. Only then call `confirmRecoveryCode`. Until then `signedIn` is `false` and `open` throws `signed-out`.
- If the app closes on that screen, `pendingSignUp()` returns `{ email, recoveryCode }` on the next start. Show the same code again.
- Sign-up emails a 6-digit code. Nothing uploads until `verifyEmail(code)` succeeds: sync fails with `unverified`. Offer `sendVerificationEmail()` for a new code. A code works for about an hour. If sync reports `unverified` later (the user closed the app before entering the code), show the same code form.
- Show errors by `err.code` (section 11): `credentials`, `exists`, `weak-password`, `rate-limited` with `err.retryAfter`, `no-app`, `unverified`, `network`. The message is plain enough to show as is.
- Passwords shorter than 12 characters are refused at sign-up.
- The password is hashed by library code on the device before anything is sent.

Electron: `papp` runs in the main process, the form in the window. `pappdrive/rpc` carries the calls and their errors (`code`, `retryAfter`) over IPC. See [examples/journal-electron](../examples/journal-electron/).

Command-line tools: ask for the email and password in the terminal, without echoing the password, and call `papp.signIn`. New users sign up with `pappdrive signup`. See [examples/notes-cli](../examples/notes-cli/).

## 5. Open the folder: visible or private

```ts
const files = await papp.open({ mode: "visible", path: "~/Journal" }) // a real folder the user can open
const files = await papp.open({ mode: "private" })                    // a store the library owns
papp.files // the same object, ready after open
```

- Choose one mode per app.
- **Visible**: desktop only (Node, Electron main). A real folder. The user can open and edit files with any program. The library watches the folder, so outside edits sync too. `path` is the folder, absolute or starting with `~/`.
- **Private**: every platform. A store the library owns. In a browser it is the origin private file system. The user cannot browse it. No watcher: only writes through `papp.files` sync.
- Browser and phones: private only. `"visible"` throws.
- Path rules are the same in both modes, so a private app can become visible later.
- One app, one folder. Opening a visible folder throws `folder-taken` if another app already uses it, or if it is inside or around another app's folder. Do not point two apps at the same folder, or a folder inside another.
- Signed out: `open` throws `signed-out`.
- The library keeps its state in a hidden folder `.pappdrive/` inside a visible folder. Do not touch it. Deleting it is safe: the next open rebuilds it. A deletion made while it was missing is lost (the file comes back).

## 6. Files

```ts
await files.write("2026-10-17.md", "# Friday\n")  // string, Uint8Array, Blob or ReadableStream<Uint8Array>
const bytes = await files.read("2026-10-17.md")   // Uint8Array, whole file in memory
const text = await files.readText("2026-10-17.md") // string (UTF-8)
const stream = files.readStream("video/talk.mp4")  // ReadableStream<Uint8Array>, for big files
const top = await files.list()                     // top level: [{ path, size, mtime, dir }]
const inNotes = await files.list("notes")          // inside the folder "notes"
await files.remove("old.md")
```

- Every call works offline. Sync catches up later.
- `write` creates or replaces the whole file. There is no append and no partial write.
- No `mkdir`. Writing `notes/todo.md` makes the folder `notes`. A folder exists only while it has files. `list` shows it (`dir: true`) only then. An empty folder never syncs.
- `list` is not recursive. To walk a tree, call `list(entry.path)` for each entry with `dir: true`.
- `FileInfo`: `path` (relative to the folder, forward slashes), `size` (bytes), `mtime` (ms since epoch), `dir` (boolean).
- `read`, `readText` and `remove` on a missing file throw `not-found`.
- `read` loads the whole file into memory. For big files, read with `readStream` and write a `Blob` or a `ReadableStream`.
- A bad path throws `bad-path`. A name that differs from an existing one only in capital letters throws `case-clash`. See [Path rules](#12-path-rules).
- Saves through `files.write` and incoming downloads never race on the same file.
- A downloaded file lands with one rename. The app never sees a half-written file.
- Writes to a path matched by `.pappignore` save on this device only. That is how an app keeps a local cache.

## 7. Watch

```ts
const stop = files.watch(change => {
  // change.path, change.origin, change.copy?, change.reason?
  refresh()
})
stop() // stop listening
```

One callback per change. `change.origin`:

| origin             | Means                                                                                                                                                                                                                                  | What the app does                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `"local"`          | This device wrote it: the app, or (visible mode) another program                                                                                                                                                                       | Refresh the view if it shows the file                                           |
| `"remote"`         | Another device wrote or deleted it. It was just downloaded or removed here                                                                                                                                                             | Refresh. If the user is editing that file, do not overwrite their text silently |
| `"conflict"`       | Both sides wrote it. `change.path` holds the version that reached the server first. `change.copy` is the path of this device's version, kept beside it. Also fires when one device made a file and another a folder with the same name | Refresh. Optionally tell the user. Both files are normal files                  |
| `"skipped"`        | This device cannot use the path. `change.reason` is `"bad name"`. The path is frozen here: nothing syncs for it, other devices keep it                                                                                                 | Optionally show it. Nothing to fix in code                                      |
| `"case-duplicate"` | A second name differs only in capital letters from one already synced (Linux, made by another program). It does not sync. The first still does                                                                                         | Optionally show it                                                              |

- A deleted file also fires a change. Check whether it still exists (`list` or `read` with `not-found`) instead of assuming.
- Files matched by `.pappignore` fire nothing.
- The simplest correct app re-reads its list on every change.

## 8. Status

```ts
files.status // { syncing, lastSync, pending, skipped, deleted, error }
const stop = files.onStatus(s => render(s)) // called on every change
await files.sync()                          // run a sync round now, and wait for it
```

| Field      | Type                           | Meaning                                                                                                                                                                                                                           |
| ---------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `syncing`  | boolean                        | A round is running                                                                                                                                                                                                                |
| `lastSync` | number or null                 | ms since epoch of the last successful round                                                                                                                                                                                       |
| `pending`  | number                         | Local changes not yet on the server                                                                                                                                                                                               |
| `skipped`  | string[]                       | Frozen paths, see watch `"skipped"`                                                                                                                                                                                               |
| `deleted`  | `null`, `"app"` or `"account"` | `null` normally. Set once this device learns that the app's folder or the whole account was deleted (on another device or with the CLI). Sync has stopped and the device is signed out. Show the sign-in form again, or a message |
| `error`    | string or null                 | The last round's error, for example offline or server down. The library retries by itself                                                                                                                                         |

- When a folder is deleted elsewhere: a private folder is deleted on this device too. A visible folder stays on disk, because the files belong to the user. If the user signs in again, they upload as new files.
- A sync runs: on open, within a second of another device's commit while the app is open (the server pushes a hint over a socket; after a reconnect the device checks once), and two seconds after the last change (ten at most after the first). `close()` runs one at once; so does leaving the app, with `syncOnBackground` (section 3).
- `sync()` rejects with the round's `SyncError` (`network`, `server`, `update-needed`) when the round could not finish. One file that failed to download does not reject: it shows in `status.error` and is fetched again next round.
- A short-lived program (a CLI command) must `await papp.close()` before it exits. It syncs pending changes and closes the connection that listens for other devices; while that connection is open, a Node process does not exit on its own. If that last sync fails, the folders still close and `close()` rejects with an `AggregateError` of the round errors.

## 9. Reading another app's folder

```ts
const papp = createPapp({ server, app: "dashboard", read: ["my-notes"] })
await papp.ready
const notes = await papp.openReadOnly("my-notes")
const todo = await notes.readText("todo.md")
const stop = notes.watch(change => render(change))
```

- The name must be in `read`. Otherwise `openReadOnly` throws `not-allowed`. Adding a name to `read` needs no new sign-in.
- The other app must exist, or sign-in fails with `no-app`.
- Always private, on every platform. It only downloads, so it always matches the server.
- `read`, `readText`, `readStream`, `list`, `watch`, `status`, `onStatus` and `sync` work. `write` and `remove` throw `read-only`. `notes.readOnly` is `true`.
- If the other app has not synced yet, or its folder was deleted, the folder is empty.

## 10. Account functions

For the sign-in form (section 4) and the settings screen.

```ts
const { recoveryCode } = await papp.signUp(email, password) // show the code; the user must save it
await papp.confirmRecoveryCode()                            // after the user saved it; until then signedIn is false
await papp.pendingSignUp()                                  // { email, recoveryCode } while unconfirmed, else null
await papp.verifyEmail(code)                                // the 6-digit code from the sign-up email; until then nothing uploads
await papp.sendVerificationEmail()                          // a new code
await papp.signIn(email, password)
await papp.recover(email, recoveryCode, newPassword)        // forgot the password, has the code
await papp.setPassword(newPassword)                         // signed-in device: change or forgot
await papp.signOut()                                        // removes the data key from this device
await papp.close()                                          // syncs pending changes, stops all folders; stays signed in
papp.signedIn                                               // true or false
await papp.deleteApp(password)                              // this app's folder, on every device. Final
await papp.deleteAccount(password)                          // every app, on every device. Final
```

- The library hashes the password before anything leaves the device.
- Until `confirmRecoveryCode`, the device keeps the code and `open` throws `signed-out`. After a restart, show the code from `pendingSignUp()` again.
- `setPassword` does not ask for the old password. A signed-in device already holds the key.
- Before `signOut`, remind the user to keep their password or recovery code.
- Before `deleteApp` or `deleteAccount`, tell the user to export first (section 18). Both need the password again.

## 11. Errors

Every error the library throws is a `SyncError` with a `code`. Check the code, never the message. The message says what to do next, for example `case-clash: "Todo.md" already exists. Write to "Todo.md", or remove it first.` Read it when debugging.

```ts
import { SyncError } from "pappdrive"

try {
  await files.readText("2026-10-17.md")
} catch (err) {
  if (err instanceof SyncError && err.code === "not-found") return ""
  throw err
}
```

| `code`          | When                                                                          | What to do                                                                         |
| --------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `bad-path`      | The path breaks the path rules                                                | Fix the path. Do not pass user input as a path without cleaning it                 |
| `case-clash`    | `write` with a name that differs from an existing one only in capital letters | Write to the existing spelling, or remove it first                                 |
| `not-found`     | `read`, `readText` or `remove` of a missing file                              | Treat as empty or already gone                                                     |
| `changed`       | `readStream` of a file that sync or a write replaced while it was read        | Read it again                                                                      |
| `read-only`     | `write` or `remove` on a folder opened with `openReadOnly`                    | Do not write there. Write in the app's own folder                                  |
| `not-allowed`   | `openReadOnly` with a name not in `read`                                      | Add the name to `read` in `createPapp`                                             |
| `signed-out`    | `open` (or `papp.files`) before sign-in                                       | Show the sign-in form, then open                                                   |
| `folder-taken`  | `open` on a visible folder that another app uses, or inside or around one     | Choose another folder                                                              |
| `no-app`        | Sign-in to an app the user has not created                                    | Tell the user to run `pappdrive apps create <name>`. The message names the command |
| `credentials`   | Wrong email, password, recovery code or email code                            | Ask again                                                                          |
| `unverified`    | Sync before the email address is confirmed                                    | Show the code form: `verifyEmail(code)`, `sendVerificationEmail()`                 |
| `over-quota`    | The account's storage is full. New files wait on the device                   | Tell the user: delete files or upgrade the plan. Deleting always syncs             |
| `exists`        | `signUp` with an email that already has an account                            | Sign in instead                                                                    |
| `weak-password` | Password shorter than 12 characters                                           | Ask for a longer one                                                               |
| `rate-limited`  | Too many tries, or too many uploads in a minute                               | Wait `err.retryAfter` seconds. Sync retries by itself                              |
| `gone`          | The folder or the account was deleted. `err.reason` is `"app"` or `"account"` | Same as `status.deleted`: show sign-in or a message                                |
| `network`       | No connection, or the server did not answer                                   | Nothing. The data is safe on the device. Sync retries                              |
| `server`        | The server answered with an unexpected error                                  | Nothing in code. Retry later                                                       |
| `update-needed` | The folder was written by a newer library version                             | Update the `pappdrive` package                                                     |

## 12. Path rules

- Paths are relative to the folder. Forward slash `/` separates folders. No leading slash.
- No empty segment, no `.` or `..` segment, no control characters.
- Any other character is allowed, including spaces, `:` and `?`. Windows rules are not applied to every device.
- At most 255 bytes per segment and 1024 bytes per path, in UTF-8.
- Stored as Unicode NFC. The library normalizes (macOS writes NFD).
- `write` refuses a name that differs from an existing one only in capital letters (`case-clash`). Comparison is case-insensitive on every device, because a Mac and Windows treat `Todo.md` and `todo.md` as one file.
- A file and a folder cannot share a name.
- A bad path given to `write` throws `bad-path`. A bad name made by another program is skipped and reported through watch. The library never renames a file on its own.
- A device that cannot create a name (Windows with `a:b.md`) skips it. Other devices keep it. To be safe on every system, avoid `\ : * ? " < > |` in names the app makes.
- Good file names: dates (`2026-10-17.md`), ids (`notes/k3f9a2.json`), slugs (`recipes/lemon-cake.md`).

## 13. .pappignore

- A file named `.pappignore` works exactly like `.gitignore`. Same patterns, same `!` to un-ignore.
- It can be in any folder. It applies to that folder and everything inside it.
- It is a normal file and syncs, so every device uses the same rules. Write it with `files.write(".pappignore", ...)` or as a file in a visible folder.
- Matching ignores capital letters, on every device.
- An ignored file stays on its device. It is never uploaded and fires no watch change.
- A rule only stops files that are not synced yet, like git. A file already synced keeps syncing even if a new rule matches it. Adding a rule never deletes anything, on any device.
- Always ignored, before any rule:
  - `.git/` and `.pappdrive/`. No rule can un-ignore these.
  - `node_modules/`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `*.swp`, `*.swo`, `*~`, `.#*`, `~$*`. A `!` rule can un-ignore these.
- Put build output, caches and logs in `.pappignore`. Write it before those files exist. Example:

```gitignore
dist/
build/
.cache/
cache/
*.log
tmp/
```

## 14. Conflicts

- A conflict happens when two devices change the same file before either syncs. It is rare with one person.
- The first device to sync keeps the path. The other device's version is kept beside it as a conflict copy:

```
todo.md
todo (conflict 2026-10-17 09-15-30).md
```

- A file with no extension gets the suffix at the end: `notes (conflict 2026-10-17 09-15-30)`. If the name is taken, a counter is added.
- A file and a folder with the same name (two offline devices): this device's side is renamed the same way. A folder becomes `notes (conflict 2026-10-17 09-15-30)/` with all its files.
- **A conflict copy is an ordinary file.** It is in the folder, it syncs to every device, and it shows in `list`. The app must not break on it:
  - Do not assume every file name matches the app's own pattern. A file named `2026-10-17 (conflict 2026-10-17 09-15-30).md` must not crash a date parser. Show it like any other file, or group it with the file it came from.
  - Do not assume one file per id. A JSON record and its conflict copy may hold the same `id` field.
  - JSON in a conflict copy is still valid JSON. Parse each file inside `try`, and skip or show files that fail.
- Only the device that hit the conflict gets a `"conflict"` watch change. Other devices just see a new file.
- An app may show a merge screen, or let the user delete the copy. No app has to.
- Edit against delete is not a conflict. The edit wins and the file comes back.
- Identical edits on two devices are not a conflict.
- Merging inside a file does not exist. Design data so two devices rarely write the same file (next section).

## 15. Rules for app design

- **Files are the merge unit.** The library never merges inside a file; a conflict makes a copy. So if two devices might change something while offline, make it two files. Every rule below follows from this one.
- **One file per record.** One Markdown file per journal day, one JSON file per note or task. Not one big file for everything. Two devices then rarely touch the same file, and a conflict copies one small record, not the whole app.
- **Do not sync a database.** No SQLite, no IndexedDB dump, no big JSON array as the app's data. Every change uploads at least one 16 MiB part of a big file, and a conflict copy of a database helps nobody.
- **If an app truly needs a database** (documented pattern, not built into the library): do not sync the database itself. Each device appends change files at `changes/<install-id>/<n>.json`, where `<install-id>` is a random id the app makes once per install and keeps in an ignored file, and `<n>` counts up. Every device rebuilds its local database from everyone's change files and keeps that database in an ignored path (for example `cache/db.sqlite`, with `cache/` in `.pappignore`). Each path is written by one device only, so nothing conflicts.
- **A collection is a folder.** A board is `board/todo/buy-milk.md`, `board/done/...`; moving a card is moving a file. A tag set is a folder of files. Listing a folder is the query.
- **Settings and other true single files** stay plain JSON. They change rarely on two devices at once; when they do, the conflict copy is fine and the user picks. Do not reach for a CRDT or a binary format to avoid it: the folder must stay readable by any program.
- **Build output, caches and logs go in `.pappignore`.** Write `.pappignore` first.
- **Small files.** Text and JSON are best. Images and media work. Large files (video) work, read them with `readStream`.
- **Read from the folder, not from memory.** After a `"remote"` or `"conflict"` change, re-read. Another device may have changed anything.
- **Let the user see their data.** On desktop, prefer visible mode with readable formats (Markdown, JSON). Any program can then open the folder.
- **Keep the server URL out of the code** when practical: an environment variable or a config file.

## 16. Platforms

| Platform              | Adapter                                      | Modes            | Watcher       | Key storage                                |
| --------------------- | -------------------------------------------- | ---------------- | ------------- | ------------------------------------------ |
| Node, CLI             | node                                         | visible, private | yes (visible) | system keychain, or `~/.config/pappdrive/` |
| Electron              | node in the main process; form in the window | visible, private | yes (visible) | keychain, or a `keyStore` on `safeStorage` |
| Browser               | browser                                      | private (OPFS)   | no            | IndexedDB                                  |
| Phone (Capacitor)     | browser                                      | private          | no            | the phone's secure storage                 |
| iOS native            | Swift package, engine in a hidden web view   | private          | no            | Keychain                                   |
| Android native        | Kotlin library, engine in a hidden web view  | private          | no            | Android Keystore                           |
| Desktop, any language | `pappdrived`, a child process                | visible, private | yes (visible) | system keychain, or `~/.config/pappdrive/` |

- **Phones and browsers sync only while the app is open.** No background work. Changes reach other devices the next time the app runs. Tell the user this if it matters.
- **Browser: one tab syncs.** It holds a lock (Web Locks API). Other tabs of the same app still read and write; their writes go through the tab that syncs. When that tab closes, another takes over.
- Browsers can clear site storage. The library asks to keep it (`navigator.storage.persist()`). If storage is cleared, the user signs in again and the folder downloads again. Changes not yet uploaded are lost. Safari may clear a site's storage after 7 days without a visit.
- Electron: run `papp` in the main process (node adapter, visible folder, watcher). The window gets data and the account functions over IPC. Do not create a second `papp` in the window. `pappdrive/rpc` carries the whole API over any message channel: `serve(papp, channel)` in main, `createClient(channel)` in the window.
- Native iOS, Android and non-JavaScript desktop apps: see [hosts.md](hosts.md). Same engine, same rules, one message envelope.

## 17. Limits

- No size limit per file. Files over 16 MiB are cut into 16 MiB parts. Changing a big file uploads every part it touched. Appending at the end uploads only the last parts; inserting near the start uploads them all.
- At most one commit per second per folder. Writes are batched: a burst of saves becomes one commit.
- The server keeps old versions of the folder: every commit from the last hour (at least the newest five, at most 60), then one per day for seven days. Older versions are gone. There are no backups, and no API reads the old versions yet.
- No merging inside a file. No queries across files. No share links. Every device stores the whole folder.
- Storage per account, across all its apps: Free 1 GB, Plus 50 GB, Pro 500 GB. A commit that would pass the quota fails with `over-quota`; one that frees space always goes through.
- At most 600 file parts uploaded per minute per account. Past that, sync waits `retryAfter` seconds and goes on by itself.

## 18. Passwords, export and deletion

- **We cannot recover your password. Your other devices or your recovery code can.** Put this sentence where the user signs up or changes the password.
- Forgot the password: on a signed-in device, `setPassword(newPassword)`. On a new device, sign in with the recovery code (`recover`). With neither, the data cannot be opened. There is no email reset.
- Data is lost only if the user loses all three: the password, every signed-in device, and the recovery code.
- **Export before deleting.** `pappdrive export <app> <dir>` downloads and decrypts the whole folder into normal files. It takes the password or the recovery code.
- `deleteApp`, `deleteAccount`, `pappdrive delete-app` and `pappdrive delete-account` are final. No undo, no waiting period. Each device learns it at its next sync (`status.deleted`).

## 19. Checklist

1. The user ran `pappdrive apps create <name>` (or signs up in the app's form).
2. `createPapp({ server, app })`, `await papp.ready`.
3. If `!papp.signedIn`: the app's own sign-in (section 4).
4. `papp.open(...)`: `"visible"` on desktop if the user wants to see the files, `"private"` otherwise. Browser: `"private"`.
5. One file per record. `.pappignore` for build output, caches and logs.
6. `files.watch` re-reads the view. Conflict copies show as normal files and do not break parsing.
7. `files.onStatus`: show sync state, and handle `deleted`.
8. Errors checked by `err.code`.
9. CLI commands `await papp.close()` before exit.
10. Examples to copy: [journal-electron](../examples/journal-electron/), [notes-cli](../examples/notes-cli/), [journal-web](../examples/journal-web/).
