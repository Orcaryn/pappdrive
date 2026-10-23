# 12. Implementation details
How the design is built. The other sections say what and why. This one says with what.
## Tech stack
### Server
- TypeScript on Cloudflare Workers, Paid plan. One Worker, plain `fetch` handler.
- Database: D1. It holds only users, apps and device tokens. Time Travel restores it to any minute in the last 30 days.
- R2 on the server side (get, head, put, list, delete) through the Worker's R2 binding. No keys needed, no S3 client.
- Upload and download links: `aws4fetch`, signed with an R2 API token stored as a Worker secret. The binding cannot sign links.
- Per-folder commit queue: one Durable Object per user and app, named `<user>/<app>`.
  - Commits and the sweep run inside it, one at a time, through a promise chain.
  - Do not use `blockConcurrencyWhile` for this. It resets the Durable Object after 30 seconds, and a large sweep can take longer.
  - It stores nothing.
  - Declared with `new_sqlite_classes` in `wrangler.jsonc`. Since July 2026, new Durable Object types must use SQLite storage, even one that stores nothing. A `new_classes` migration fails on deploy.
- Watch sockets: the same Durable Object accepts them with the WebSocket Hibernation API and sends the new ETag to each after a commit. It never calls `setTimeout` or `setInterval`; either would stop it from hibernating and bill duration. The Worker checks the token, then forwards the upgrade request to the Durable Object. The socket is authenticated once, at connect; the device reopens it with a fresh token before the old one expires.
- Daily sweep: an alarm on each folder's Durable Object. The first commit sets it. Each sweep sets the next one.
- Folder deletion: a method on the same Durable Object, in the same queue. R2 lists and deletes up to 1,000 keys per call. It sets one last alarm for a day later. That sweep finds no delta, deletes everything left, and sets no next alarm.
- Upload links and commits read the token's row in D1, to refuse a token stopped by a deletion. Other routes trust the access token until it expires.
- Sign-in rate limit: the Workers Rate Limiting binding, per email and per IP. It counts separately in each Cloudflare location. That is enough against online password guessing.
- No local copy of the server and no test bucket. Development deploys to the real Worker and `pappdrive-prod`.
  - Test with a separate test account, never the real one. A bug, such as a bad sweep, then only touches the test account's folders.
  - `wrangler.jsonc` is still needed. It declares the Durable Object and the bindings for deploys.
### Library
- TypeScript, one package with three adapters:
  - **core**: decision table, index format, encryption, sync loop. No platform code.
  - **node**: desktop apps and command-line tools.
  - **browser**: web apps, and Capacitor apps on phones.
- Node adapter:
  - Folder watcher: `@parcel/watcher`, the one VS Code, Parcel and Nx use. Native watching on each system: FSEvents on a Mac, inotify on Linux, ReadDirectoryChangesW on Windows.
    - It is told which folders to skip: the always-ignored ones, and folder rules from `.pappignore`. Those folders are not watched at all.
    - Rules with `!` are not passed to it, because the watcher cannot un-ignore. They, and all other rules, are checked when an event arrives.
    - It merges events, so they are only hints. See [Client](05-client.md).
  - Ignore rules: the `ignore` package, which eslint and prettier use. It follows the `.gitignore` rules and ignores capital letters by default.
    - It does not find `.pappignore` files itself. The library finds them, one per folder at most.
    - A path is checked against each `.pappignore` above it, from the top folder down, the way git does. Each check uses the path as seen from that `.pappignore`'s folder.
  - Key storage: the system keychain through `@napi-rs/keyring`. Linux without a keychain: a file at `~/.config/pappdrive/<user id>.key`, readable only by the user.
- Browser adapter:
  - Private mode only: the origin private file system (OPFS).
  - Key storage: IndexedDB.
  - After sign-in, the library calls `navigator.storage.persist()` once. It asks the browser not to delete the folder on its own when the disk runs low. It uses no extra space. Chrome and Safari decide without asking the user. Firefox shows the user a popup. If the browser says no, nothing breaks.
  - The tab lock: the Web Locks API.
- Capacitor: the browser adapter, with the phone's secure storage for the key.
### Crypto
- All through WebCrypto, which Node and every browser have, except the password hash.
- Password hash: Argon2id, as WebAssembly (`hash-wasm`).
- Settings: 64 MiB of memory, 3 passes, 4 lanes, 32 bytes out. This is the second recommended setting in RFC 9106, the one for devices with little memory, like phones.
- The settings are saved with each account, in the user row. A device asks for them before it signs in (`/auth/params`). So they can be raised later: new accounts get the new settings, and an old account moves to them at its next password change.
- Salt: SHA-256 of `pappdrive|` plus the email, trimmed and lowercased first. So `Sagi@x.com` and `sagi@x.com` give the same keys.
  - Hashed, because Argon2 needs a salt of at least 8 bytes, and a short email can be shorter. The hash is always 32 bytes.
  - The `pappdrive|` prefix keeps the keys different from any other product that also salts with the email.
- The Argon2id output is split with HKDF-SHA256 into the login key and the password key.
- The recovery code: 128 random bits, shown as words or groups of letters. Split with HKDF the same way, no Argon2id.
- The data key: 256 random bits. HKDF makes three keys from it: one for AES-256-GCM, one for HMAC-SHA256 blob ids, one for HMAC-SHA256 file ids of big files.
- Locked copies: the data key encrypted with AES-256-GCM under the password key or the recovery key.
- The server stores the login keys hashed with SHA-256. They are already random, so a slow hash is not needed there.
- Short passwords are refused at sign-up. Minimum length: 12.
## Formats
### Blob
- Encrypted whole, in memory, with AES-256-GCM.
- Size limit: a blob holds up to 16 MiB of plaintext, exactly 16,777,216 bytes. Bigger files are cut into parts, below.
- Its blob is 29 bytes bigger: the version byte, the nonce and the tag. So the server allows blobs up to 16,777,245 bytes.
- Layout: one format version byte, a random 12-byte nonce, then the ciphertext with its 16-byte tag.
- Each blob gets a new random nonce. That is safe until billions of blobs share one key.
- Blob id: HMAC-SHA256 of the plaintext, 64 hex characters.
### Parts
- Files over 16 MiB are cut at every 16 MiB. Every part is 16 MiB except the last, which is 1 byte to 16 MiB.
- File id of a big file: HMAC-SHA256, with the file id key, of the part ids in order, each as its 32 raw bytes.
- Its own key, so a big file's id and a blob id are made in different ways and cannot match by accident.
### Index body
- JSON, then gzip, then AES-256-GCM with a random 12-byte nonce in front, then base64. The same for a delta body, whose JSON is `{ seq, ops }`: `ops` maps paths to entries or `null`.
- The GCM additional data names the body's place: `pappdrive index|<app>|<index id>` or `pappdrive delta|<app>|<base index id>`. All apps share one key, so without it the server could hand one app another app's index, or a delta made for another base.
- `seq` counts commits: each commit, delta or checkpoint, writes the last seen `seq` plus one. A device keeps the highest `seq` it has seen, next to its disk and synced indexes, and stops syncing when the server sends a lower one. So the server cannot roll a folder back to an older index without the device noticing.
### Path comparison
- NFC first, then Unicode lowercase (`toLowerCase()` after `normalize("NFC")`), for comparing only. The stored path keeps its spelling.
### Content ids, step by step
1. Read the next 16 MiB of the file. Less at the end of the file.
2. HMAC it. That is the blob id.
3. Skip it if the id is in the server header, was uploaded by this device in the last day, or is already in the batch. Go to step 6.
4. If the batch already has 100 blobs, or one more blob would take it past 32 MiB, upload it first: ask for the links, upload, empty the batch.
5. Encrypt it, then SHA-256 the ciphertext. Add the ciphertext to the batch and drop the plaintext.
6. Go back to step 1 until the end of the file.
7. For a big file, compute its id from the part ids.
- After the last file, upload what is left in the batch.
- Memory holds at most the part being read (16 MiB) and the batch (32 MiB): 48 MiB, however big the file is.
- The device keeps a list of the blobs it uploaded and when, in the hidden folder, until a commit includes them. So an upload that stops halfway does not send its parts again. After a day the sweep may have deleted them, so they count as not uploaded.
- In visible mode, check the file's size and modified time before the first read and after the last. If either changed, start the file again. Parts already uploaded and no longer needed are deleted by the sweep.
## Storage calls
- Only these: PutObject, GetObject, HeadObject, ListObjectsV2, DeleteObject, presigned PUT and GET.
- Any S3-compatible provider has them. The server calls them through the R2 binding. Each binding call has a matching S3 call, so a move to another provider stays possible.
- Commit writes: `put` with `onlyIf`, given a `Headers` object. The delta carries `If-Match: <etag>`, or `If-None-Match: *` for the first commit; a new checkpoint carries `If-None-Match: *` under its fresh id. If the condition fails, `put` returns `null`, and the server answers 412.
- Bucket CORS: any origin, methods GET, PUT and HEAD, the ETag header exposed.
- Allowed request headers: `If-None-Match` and `x-amz-checksum-sha256`. Browsers check with R2 before sending them.
- Max age one day, so the browser checks once a day, not before every poll.
## Upload links
- The link is signed with three headers:
  - `Content-Length`: the exact size
  - `x-amz-checksum-sha256`: the exact content, base64
  - `If-None-Match: *`: only if nothing is stored there yet
- Signed with `aws4fetch`, `signQuery: true`. The signed headers stay headers. (The AWS SDK moves them into the query string, where R2 ignores them. aws4fetch does not.)
- Trap: by default, aws4fetch does not sign `Content-Length`. Then R2 accepts any size. Pass `allHeaders: true`.
- Links last five minutes.
- What R2 does with these links:
  - Wrong size: refuses it and stores nothing.
  - More bytes than the signed size: stores only the bytes up to the signed size.
  - Right size, different contents: refuses it.
  - One of the signed headers missing: refuses it.
  - A second upload to the same key: refuses it with 412.
  - The checksum sent in the query string instead of a header: ignores it. So it must be a header.
## API
- JSON over HTTPS.
- Every route starts with `/v1/`. The routes below leave it out.
- Every call except the password hash settings, sign-up, sign-in, recovery, refresh, and the two deletes sends `Authorization: Bearer <access token>`.
- An access token names one user, the app it writes, and the folders it reads. It lasts an hour.
- Read routes take `?app=<name>` for another app's folder. Without it, the token's own app.
### Errors
| Status | Body `error` | Meaning |
|---|---|---|
| 400 | `bad-request` | Malformed request: bad id, more than 100 ids, bad JSON |
| 401 | `credentials` | Wrong email, login key or recovery login key. The app shows the sign-in form |
| 401 | `expired` | The access token is missing, expired or bad. The library refreshes it and tries again |
| 403 | `not-allowed` | `?app=` names a folder not on the token's read list. Or a token without an app tries to upload or commit |
| 404 | `no-app` | Sign-in or a read list names an app that does not exist |
| 409 | `exists` | Sign-up with an email that already has an account, or an app name the user already has |
| 410 | `gone` | The app's folder or the account was deleted. Body adds `reason: "app"` or `"account"` |
| 412 | `stale` | Stale commit: another device wrote first |
| 413 | `too-big` | Blob over the size limit |
| 422 | `missing` | Commit names blobs that are not stored, or have the wrong size |
| 429 | `rate-limited` | Too many requests. `Retry-After` gives the seconds to wait |
- The body is `{ error: "<word>" }`, plus details where the table says so.
- The library acts on the word, not only the number. The two 401s need different actions.
- Stale is 412 because the commit failed its `If-Match`, and that is what 412 means.
- R2 also answers 412, when an upload finds the blob already stored. That one means success. The two come from different calls, so the library cannot mix them up.
### Tokens
- **Access token**: a JWT, signed with HMAC-SHA256 (`HS256`) using a Worker secret. Signed and checked with WebCrypto, no library.
  - Claims: `sub` (user id), `app` (empty for a token without an app), `install` (install id), `read` (the read list), `exp` (one hour).
  - Routes that trust it do not touch D1. Upload links and commits also check the install's row. See the server section.
  - Changing the secret: two secrets, `TOKEN_KEY` and `TOKEN_KEY_OLD`. Sign with the new one, accept both. After an hour, remove the old one.
- **Refresh token**: 32 random bytes, base64url. D1 keeps only its SHA-256, in the install's row.
  - It does not expire. It stops at sign-out, at a deletion, or when the install is logged out.
  - It does not change when used. Changing it on each use protects against a stolen refresh token. Here, whoever can steal it from the device can also steal the data key stored next to it, so it would add little. And a lost answer during a refresh would sign the device out, and the user would have to type the password again.
### Sign-in
```
POST /auth/params
  { email } → { m, t, p }           Argon2id settings for this email
POST /auth/signup
  { email, app, read, loginKey, recoveryLoginKey, passwordCopy, recoveryCopy }
  → { accessToken, refreshToken, installId }
POST /auth/login
  { email, app, read, loginKey }
  → { accessToken, refreshToken, installId, passwordCopy }
POST /auth/recover
  { email, app, read, recoveryLoginKey }
  → { accessToken, refreshToken, installId, recoveryCopy }
POST /auth/refresh
  { refreshToken, read } → { accessToken }      read is optional
  → 410 gone                       the token was stopped by a deletion
POST /auth/password          signed-in device only
  { loginKey, passwordCopy } → 204
POST /auth/logout
  → 204, the refresh token stops working
```
- `/auth/params`: an unknown email gets the current default settings, the ones a new account would get. Rate limited like sign-in. Once the defaults change, an old account's answer differs, so it can show that the email has an account. Accepted: sign-up shows that anyway, below.
- `/auth/signup` with an email that already has an account: 409 `exists`. This does tell anyone that the email has an account. Accepted: no email is ever sent, and the email is only a sign-in name.
- `app` is optional on `/auth/signup` and `/auth/login`. Without it, the token can list and create apps, and read the folders on its read list. It cannot upload or commit.
- `/auth/signup` also creates the app it names, if it names one.
- `/auth/logout` stops the refresh token of the install named in the access token.
- `/auth/password` also saves the current Argon2id settings with the account, so a password change moves an old account to new settings.
- `read`: the other apps whose folders this token may read, like `["my-notes"]`. An empty list if none. On refresh, a list sent replaces the stored one.
- Wrong email or key: 401 `credentials`, the same answer for both.
- Too many tries: 429 with `Retry-After`.
- `/auth/password` writes `<user>/key` first, then the login key hash. If it fails between the two, the device sends both again. It still has the data key.
### Apps
```
GET /apps
  → [{ name, created }, ...]
POST /apps
  { name } → 201
  → 409 exists                     the user already has this name
```
- Any of the user's access tokens works, with or without an app.
- A bad name: 400 `bad-request`. Names are lowercase letters, digits, `-` and `_`, 1 to 64 characters.
- Deleting an app is `/app/delete`, below. It frees the name.
### Blobs
```
POST /blobs/upload
  [{ id, size, sha256 }, ...]      up to 100
  → [{ id, url, headers }, ...]
POST /blobs/download?app=<name>
  [id, ...]                        up to 100
  → [{ id, url }, ...]
```
- Bad id: 400 for the whole list. Size over the limit: 413 for the whole list.
### Index
```
GET /delta?app=<name>              If-None-Match: <etag>
  → 200 { v, base, blobs, body }  ETag header. 304: unchanged. 404: the folder has no delta
GET /index/<id>?app=<name>
  → 200 { v, blobs, body }        the checkpoint. Never changes
GET /index/watch?app=<name>        Upgrade: websocket
  Sec-WebSocket-Protocol: pappdrive, <access token>
  → 101, protocol pappdrive       then one text message with the delta's new ETag after each commit
PUT /delta
  { delta, etag }                  the merged delta, with the ETag it replaces
  → 200 { etag }
  → 412 stale                      another device wrote first, or the delta names another checkpoint
  → 422 { missing: [id, ...] }     blobs not stored, or wrong size
PUT /index
  { index, delta, etag }           a new checkpoint under delta.base, and the empty delta that names it. etag is null for the first commit
  → 200 { etag }                   the delta's ETag
  → 412 stale
  → 422 { missing: [id, ...] }
```
- The server answers reads with `Cache-Control: no-store`. The library sends `If-None-Match` itself.
- `?app=` works only on the reads: `/delta`, `/index/<id>`, `/index/watch` and `GET /blobs/<id>`. Uploads and commits are always the token's own app.
### Deletion
```
POST /app/delete
  { email, app, loginKey } → 204   one app's folder, on every device
POST /account/delete
  { email, loginKey } → 204        every app, on every device
```
- No token. The email and login key prove the user knows the password.
- Wrong email or key: 401 `credentials`. Too many tries: 429, same as sign-in.
- Both are safe to send again after a failure.
- `/account/delete` order: stop tokens, delete `<user>/key`, delete each app folder, delete the user row.
## SDK
### Setup
```js
import { createPapp } from "pappdrive"
const papp = createPapp({
  server: "https://sync.example.com",
  app: "dashboard",
  read: ["my-notes"],  // optional: other apps' folders this app may read
})
await papp.ready       // restores a saved sign-in from the keychain, if there is one
```
- Called once, when the app starts. Everything else hangs off `papp`.
- `server`, `app` and `read` are sent at sign-up, sign-in and recovery. `read` is also sent on each refresh, so adding a name needs no new sign-in.
- `papp.signedIn` is only correct after `papp.ready`.
- The right adapter is picked by the package's `exports`, when the app is built with a bundler: Node and Electron's main process get the node adapter, browsers and Electron windows get the browser one.
- Key storage can be replaced: `createPapp({ ..., keyStore: { get, set, delete } })`. Electron apps can pass one built on Electron's `safeStorage`, which needs no native module.
### Opening
```js
await papp.open({ mode: "visible", path: "~/Notes" })
await papp.open({ mode: "private" })
papp.files  // the app's own files, ready after open
```
- `mode`: `"visible"` or `"private"`. In a browser, only `"private"`. `"visible"` throws.
- `path`: visible mode only. The folder to use.
- Signed out: `open` throws `signed-out`.
### Reading another app's folder
```js
const notes = await papp.openReadOnly("my-notes")
await notes.readText("todo.md")
const stop = notes.watch(change => render(change))
```
- Always private. It only downloads, so it always matches the server.
- `read`, `readText`, `readStream`, `list`, `watch`, `status`, `onStatus` and `sync` work. `write` and `remove` throw `read-only`.
- A name that is not in `read` throws `not-allowed`.
### Account
```js
const { recoveryCode } = await papp.signUp(email, password)  // show it once
await papp.signIn(email, password)
await papp.recover(email, recoveryCode, newPassword)
await papp.setPassword(newPassword)                          // on a signed-in device
await papp.signOut()
papp.signedIn                                                // true or false
await papp.deleteApp(password)                               // this app's folder, on every device
await papp.deleteAccount(password)                           // everything, on every device
```
- These are for an app that builds its own forms. Most apps use the ready-made one, below. Either way, the library hashes the password before anything leaves the device.
- `setPassword` does not ask for the old password. The signed-in device already holds the data key, so the old password would protect nothing. It covers both "change it" and "forgot it".
### Sign-in form
```js
import { signInForm } from "pappdrive/ui"
await signInForm(document.querySelector("#sign-in"), papp)  // resolves once signed in
await papp.signInPrompt()                                   // the same, in a terminal
```
- One form for sign-up, sign-in and recovery.
- It ships inside the package and is never loaded from the server. So the password is still hashed by library code inside the app.
- Sign-up shows the recovery code with copy and download buttons. To go on, the user must type back the last group of the code. So it cannot be skipped.
- It shows every error in plain words: wrong password, email taken, password too short, too many tries and how long to wait.
- Plain HTML, no framework. Its look can be changed with CSS variables.
- Electron: `papp` runs in the main process, the form in the window. Pass its functions through IPC: `signInForm(element, { signUp, signIn, recover })`. The Electron example shows how.
- `signInPrompt` is for command-line tools. It asks in the terminal and hides the password.
### Files
```js
await papp.files.write("todo.md", text)  // string, Uint8Array, Blob or ReadableStream
await papp.files.read("todo.md")         // Uint8Array; papp.files.readText for a string
papp.files.readStream("video/talk.mp4")  // ReadableStream, for big files
await papp.files.list()                  // top level: [{ path, size, mtime, dir }]
await papp.files.list("notes")           // inside notes
await papp.files.remove("old.md")
```
- `papp.files` is the app's own folder. A folder of another app, opened read-only, is a separate object. See above.
- Paths follow the path rules in [Client](05-client.md). A bad path throws.
- No `mkdir`. Writing `notes/todo.md` makes the folder `notes`.
- `list` shows a folder (`dir: true`) only while it has files in it.
- Every call works offline.
- `read` loads the whole file into memory. For big files, use `readStream`, and write with a `Blob` or a `ReadableStream`.
### Watching
```js
const stop = papp.files.watch(change => render(change))
stop()  // stop listening
```
- `change.path`: the file.
- `change.origin`:
  - `"local"`: this device wrote it
  - `"remote"`: another device wrote it, just downloaded
  - `"conflict"`: both wrote it, or one made a file and the other a folder with the same name. `change.copy` is the conflict copy's path.
  - `"skipped"`: the path is frozen. `change.reason` is `"bad name"`.
  - `"case-duplicate"`: a second name that differs only in capital letters. It does not sync. The first one still does.
- Files matched by `.pappignore` fire no change at all.
### Status
```js
papp.files.status                                 // { syncing, lastSync, pending, skipped, deleted }
const stop = papp.files.onStatus(s => render(s))  // called on every change
await papp.files.sync()                           // run a round now
```
- `deleted`: `null` normally. `"app"` or `"account"` once this device learns that the folder or the account is gone. Sync has stopped, and the device is signed out. The app learns it through `onStatus`.
### Errors
- Every error the library throws is a `SyncError` with a `code`. The app checks the code, not the message.
- The message says what to do next, not only what went wrong. It is often read by a coding agent, which acts on it. Example: `case-clash: "Todo.md" already exists. Write to "Todo.md", or remove it first.`

| `code` | When |
|---|---|
| `bad-path` | The path breaks the path rules |
| `case-clash` | `write` with a name that differs from an existing one only in capital letters |
| `not-found` | `read` or `remove` of a file that does not exist |
| `read-only` | `write` or `remove` on a read-only folder |
| `not-allowed` | `openReadOnly` with a name not in `read` |
| `signed-out` | `open` before sign-in |
| `folder-taken` | `open` on a visible folder that another app already uses, or that is inside or around one |
| `no-app` | Sign-in to an app the user has not created. The message names the command that creates it |
| `credentials` | Wrong email, password or recovery code |
| `exists` | `signUp` with an email that already has an account |
| `weak-password` | A password shorter than the minimum |
| `rate-limited` | Too many tries. `error.retryAfter` gives the seconds |
| `gone` | The folder or the account was deleted. `error.reason` is `"app"` or `"account"` |
