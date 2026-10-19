---
name: pappdrive
description: Build a personal app whose data syncs between the user's own devices with the pappdrive library (a synced, end-to-end encrypted folder of plain files). Use when the user wants an app for themselves - a journal, notes, tasks, a tracker, a dashboard - that keeps its data the same on their Mac, laptop, phone or browser, works offline, or needs personal app storage without running a database or thinking about a server. Also use when a project already imports "pappdrive".
---

# Pappdrive

Pappdrive gives an app one folder that stays the same on every device of its user. The app reads and writes plain files. The library syncs, works offline and encrypts on the device.

The full API and every rule are on one page: `api.md` next to this file, if it was copied here (install: copy `node_modules/pappdrive/docs/skill/SKILL.md` and `node_modules/pappdrive/docs/api.md` into `.claude/skills/pappdrive/`), or `docs/api.md` in the pappdrive repository. Read it before writing code. The steps below are the minimum.

## Steps

1. **Server URL.** Ask the user for their Pappdrive server URL (for example `https://sync.example.com`). Never invent one. Keep it in an environment variable or config, not hard-coded if avoidable.
2. **Create the app.** Pick a name: lowercase letters, digits, `-`. Ask the user to run these in their own terminal, because they ask for a password:
   ```sh
   export PAPPDRIVE_SERVER=<url>
   npx pappdrive signup          # new user (shows the recovery code), or: npx pappdrive login
   npx pappdrive apps create <name>
   ```
3. **Install:** `npm install pappdrive`.
4. **Start:**
   ```ts
   import { createPapp, SyncError } from "pappdrive"
   const papp = createPapp({ server, app: "<name>" })
   await papp.ready
   ```
5. **Sign in** if `!papp.signedIn`:
   - UI: the library has none. Build a small form: email, password, sign in (`papp.signIn`), create account (`papp.signUp`), forgot password (`papp.recover` with the recovery code). After sign-up show the recovery code, make the user type back its last group, then `papp.confirmRecoveryCode()`. On start, `papp.pendingSignUp()` returns a code not yet confirmed. Show errors by `err.code`.
   - Terminal: ask for email and password (password not echoed), then `papp.signIn`. New users run `pappdrive signup`.
   - Electron: `papp` in the main process; the form in the window calls `signUp`, `signIn`, `recover`, `pendingSignUp` and `confirmRecoveryCode` in the main process over IPC, keeping each error's `code` and `retryAfter`.
6. **Open:** desktop `await papp.open({ mode: "visible", path: "~/AppName" })` if the user should see the files; otherwise, and always in a browser or phone, `await papp.open({ mode: "private" })`.
7. **Use files:** `files.write(path, data)`, `read`, `readText`, `readStream`, `list(dir?)`, `remove`. Writing `a/b.md` creates folder `a`.
8. **React:** `files.watch(change => refresh())`. `files.onStatus(s => ...)` to show sync state; if `s.deleted` is set, the folder or account was deleted: show sign-in or a message.

## Rules every app must follow

- One file per record (one Markdown file per day, one JSON file per item). Never sync a database or one big data file.
- Conflict copies are normal files, like `todo (conflict 2026-10-17 09-15-30).md`. Lists, parsers and id lookups must not break on them. Parse each file in `try`.
- Build output, caches and logs go in `.pappignore` (same syntax as `.gitignore`). Write it first.
- After a `"remote"` or `"conflict"` watch change, re-read from the folder.
- Check errors by `err.code` (`not-found`, `bad-path`, `case-clash`, `no-app`, `signed-out`, ...), not by message. The message says how to fix it.
- Command-line tools `await papp.close()` before exiting. It syncs pending changes and closes the sync connection, which otherwise keeps a Node process alive.
- Phones and browsers sync only while the app is open. One browser tab syncs.
- Tell the user: "We cannot recover your password. Your other devices or your recovery code can." Export (`pappdrive export <app> <dir>`) before any delete.

## Examples to copy

In the pappdrive repository: `examples/journal-electron/`, `examples/notes-cli/`, `examples/journal-web/`.
