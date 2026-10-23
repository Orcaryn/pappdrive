---
name: pappdrive
description: Build a personal app whose data syncs between the user's own devices with the pappdrive library (a synced, end-to-end encrypted folder of plain files). Use when the user wants an app for themselves - a journal, notes, tasks, a tracker, a dashboard - that keeps its data the same on their Mac, laptop, phone or browser, works offline, or needs personal app storage without running a database or thinking about a server. Covers web, Node, Electron, native iOS (Swift), native Android (Kotlin) and desktop apps in any language. Also use when a project already imports "pappdrive".
---

# Pappdrive

Pappdrive gives an app one folder that stays the same on every device of its user. The app reads and writes plain files. The library syncs, works offline and encrypts on the device.

The full API and every rule are on one page: `api.md` next to this file, if it was copied here (install: copy `node_modules/pappdrive/docs/skill/SKILL.md`, `node_modules/pappdrive/docs/api.md` and `node_modules/pappdrive/docs/hosts.md` into `.claude/skills/pappdrive/`), or `docs/api.md` in the pappdrive repository. Read it before writing code. The steps below are the minimum for JavaScript; for a native iOS, Android or non-JavaScript desktop app, read `hosts.md` as well: same engine, same rules, a Swift or Kotlin API, or JSON lines to a child process.

## Steps

1. **Create the app.** Pick a name: lowercase letters, digits, `-`, `_`. Ask the user to run these in their own terminal, because they ask for a password:
   ```sh
   npx pappdrive signup          # new user (shows the recovery code), or: npx pappdrive login
   npx pappdrive apps create <name>
   ```
2. **Install:** `npm install pappdrive`. Native iOS: the Swift package in `packages/swift`. Native Android: the Gradle module in `packages/android`. Any other language on desktop: ship the `pappdrived` binary inside the app (`hosts.md`).
3. **Start:**
   ```ts
   import { createPapp, SyncError } from "pappdrive"
   const papp = createPapp({ app: "<name>" })
   await papp.ready
   ```
4. **Sign in** if `!papp.signedIn`:
   - UI: the library has none. Build a small form: email, password, sign in (`papp.signIn`), create account (`papp.signUp`), forgot password (`papp.recover` with the recovery code). After sign-up show the recovery code, make the user type back its last group, then `papp.confirmRecoveryCode()`, then ask for the 6-digit code from the sign-up email: `papp.verifyEmail(code)` (`papp.sendVerificationEmail()` for a new one). Nothing uploads until then. On start, `papp.pendingSignUp()` returns a code not yet confirmed. Show errors by `err.code`.
   - Terminal: ask for email and password (password not echoed), then `papp.signIn`. New users run `pappdrive signup`.
   - Electron: `papp` in the main process; the window talks to it through `pappdrive/rpc` (`serve` in main, `createClient` in the window), which carries every call, event and error `code` over IPC.
   - Native iOS or Android: the same calls on `Pappdrive` in Swift or Kotlin; `open()` is always private there. Errors are `PappError` / `PappException` with the same `code`.
5. **Open:** desktop `await papp.open({ mode: "visible", path: "~/AppName" })` if the user should see the files; otherwise, and always in a browser or phone, `await papp.open({ mode: "private" })`.
6. **Use files:** `files.write(path, data)`, `read`, `readText`, `readStream`, `list(dir?)`, `remove`. Writing `a/b.md` creates folder `a`.
7. **React:** `files.watch(change => refresh())`. `files.onStatus(s => ...)` to show sync state; if `s.deleted` is set, the folder or account was deleted: show sign-in or a message.

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

In the pappdrive repository: `examples/journal-electron/`, `examples/notes-cli/`, `examples/journal-web/`, `examples/journal-ios/` (SwiftUI), `examples/sidecar-python/` (any language via `pappdrived`).
