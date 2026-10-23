# Journal (Electron)

A journal that syncs between your computers. Each day is one Markdown file in `~/Journal`, like `2026-10-17.md`. You can open the folder in Finder or any editor; edits made there sync too.

## Run

```sh
npm install
npx pappdrive signup        # first time only; or: npx pappdrive login
npx pappdrive apps create journal

npm start
```

On the second computer: the same `npm install` and `npm start`, then sign in with the same email and password. No `apps create` needed.

## How it is built

| File          | Role                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.js`     | Main process. `createPapp`, `papp.open({ mode: "visible", path: ~/Journal })`, `files.watch` and `files.onStatus` forwarded to the window, one IPC handler per action |
| `preload.cjs` | `contextBridge`: exposes `window.journal` (the account functions and the journal actions)                                                                             |
| `renderer.js` | The window. The sign-in form over the account functions, the list of days, the editor. Bundled with esbuild                                                           |
| `keystore.js` | Optional `keyStore` on Electron `safeStorage`                                                                                                                         |

Points to copy:

- `papp` runs only in the main process (node adapter: visible folder, watcher, keychain). The window does not import `pappdrive`.
- Errors cross IPC as `{ ok: false, error: { code, message, retryAfter, reason } }` and are thrown again in the window with the same `code`. Electron would otherwise keep only the message, and the form could not tell "wrong password" from "too many tries".
- One file per day. The list shows every `.md` file, including conflict copies such as `2026-10-17 (conflict 2026-10-17 09-15-30).md`. The date label falls back to the raw name when a name is not a date.
- On every watch change, the list is read again. If the open day changed and the user has not typed, the editor reloads. If they have typed, a notice offers the other version.
- `status.deleted` (the journal or the account was deleted elsewhere) brings back the sign-in form. The files in `~/Journal` stay.
- Before quitting, `files.sync()` sends pending changes (at most 5 seconds).

## Key storage

By default the library keeps the data key in the system keychain. `keystore.js` shows the alternative: a `keyStore` with `get`, `set` and `delete` that encrypts each value with `safeStorage.encryptString` and keeps it in `pappdrive-keys.json` inside `app.getPath("userData")`. It needs no native module. `main.js` uses it only when `safeStorage` really encrypts (on Linux without a keyring it does not). Changing the key store later means signing in once more on that computer.

The web example ([../journal-web](../journal-web/)) uses the same app name and file layout, so the same journal opens in a browser too.
