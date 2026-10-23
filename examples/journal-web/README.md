# Journal (web)

A journal in the browser that syncs with your other devices. Each day is one Markdown file, like `2026-10-17.md`. It uses the same app name (`journal`) and layout as the [Electron journal](../journal-electron/), so both show the same days.

## Run

```sh
npm install
npx pappdrive signup        # first time only; or: npx pappdrive login
npx pappdrive apps create journal

npm run dev
```

## Points to copy

- `createPapp`, `await papp.ready`, then the sign-in form if `!papp.signedIn`. At sign-up it shows the recovery code and calls `papp.confirmRecoveryCode()` only after the user types back its last group.
- `papp.open({ mode: "private" })`. A browser has no visible mode. The files live in the origin private file system, which the user cannot browse. To get them out as normal files: `pappdrive export journal ~/journal-export`.
- `files.watch` re-reads the list on every change. Conflict copies are listed like any day.
- `files.onStatus` shows "Syncing…", "Synced 09:15", changes waiting, or the last error. `status.deleted` sends the user back to the sign-in form.
- The page syncs only while it is open. Nothing runs after the tab closes. Saving on `visibilitychange` lets the library send the last edit while the tab is still alive.
- With several tabs open, one tab holds a lock and syncs for all of them. The others still read and write.
- The browser may clear site storage. The library asks it not to (`navigator.storage.persist()`). If it happens, sign in again and the journal downloads again; edits not yet synced are lost.
