# 10. Implementation plan
1. **Decision table**, in the core library. The twelve cases, plus the file-and-folder clash.
2. **Server**, as a Worker. Routes under `/v1/`, one status code per failure, apps with unique names per user, the index written with `no-cache`. Password sign-in with login keys, signup with the data key and recovery code made on the device, both locked copies stored at `<user>/key`, password change and recovery-code reset, upload links with signed size (16 MiB per blob), checksum and no-overwrite, download and index-read links, index commit with existence and size check, ETag, kept index copies (last hour, at least five), a Durable Object per folder for the commit queue. Read lists on tokens. App and account deletion.
3. **Node adapter**, proven on Writor (`~/git/Writor`) syncing `~/git/Writings` between two devices, encrypted from the first upload, big files in 16 MiB parts, visible mode, folder watcher with events as hints and the quiet wait, `.pappignore` and the always-ignored list, disk and synced indexes, polling, read-only folders, stopping on a deleted folder. Index structure final from here.
4. **Browser and Capacitor adapters**, with the tab lock.
5. **Command-line tool**: sign up, sign in, list and create apps, export.
6. **Daily sweep.**
7. **Docs for agents**: `llms.txt`, the one-page API, the Claude Code skill, an example per platform. Done when Claude Code builds a working synced app from the docs alone.
- Steps 5, 6 and 7, a per-user quota, and an upload link rate limit must be done before any other user's data is stored.
- Step 3 carries the most risk: editors that save by rename, and half-written files. Treating watcher events as hints and waiting for quiet handles both. Estimate a week.
