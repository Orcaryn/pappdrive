# AGENTS.md block

Copy the block below into the project's `AGENTS.md` or `CLAUDE.md`. Replace `<name>` and `<url>`.

```markdown
## Data sync: pappdrive

This app stores its data with `pappdrive`: one folder of plain files, synced between the user's devices, end-to-end encrypted. Full API and rules: https://github.com/<owner>/pappdrive/blob/main/docs/api.md (read it before changing data code).

- App name: `<name>`. Server: `<url>` (from `PAPPDRIVE_SERVER`). The app was created with `pappdrive apps create <name>`.
- Start: `createPapp({ server, app })`, `await papp.ready`, sign in from the app's own form with `papp.signIn` or `papp.signUp` + `papp.confirmRecoveryCode()`, then `papp.open(...)`.
- One file per record. Never sync a database or one big data file.
- Conflict copies like `todo (conflict 2026-10-17 09-15-30).md` are normal files. Code that lists or parses files must not break on them.
- Build output, caches and logs go in `.pappignore` (same syntax as `.gitignore`).
- Re-read from the folder on `files.watch` changes. Show `files.onStatus`; handle `status.deleted`.
- Check `SyncError` by `err.code`, not by message.
- Phones and browsers sync only while the app is open.
- Never touch the `.pappdrive/` folder.
```
