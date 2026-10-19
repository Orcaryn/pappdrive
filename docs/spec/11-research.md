# 11. Prior art
Existing projects, what was borrowed, what was rejected. Surveyed October 2026.
## remoteStorage, the closest thing
- Open protocol from 2011. Storage account per user, folder per app via OAuth scope, HTTP with ETags.
- Client library for browser and Node. Node server writing to S3-compatible storage, passkey sign-in.
- About 65 small apps by hobbyists. Alive, grant-funded, pitched to users not builders.
- Never took off: "first get a storage account" came before any app.
- **Not adopted:** no presigned links, so all bytes go through the server. Client library a 2.0 beta for years.
- **Borrowed:** app name as token scope and folder, conflict event with origins, path rules.
## Remotely Save
- Obsidian plugin syncing a vault to S3, Dropbox, OneDrive, WebDAV. Dormant since late 2024.
- **Borrowed:** the idea of a decision table with numbered cases, deletions from local history alone with no remote metadata, browser gotcha docs.
- **Not borrowed:** comparison by modified time. Content ids are exact. Skipping large files: they sync in parts.
## Database sync engines
- Zero, PowerSync, Electric, Jazz, Convex, LiveStore, the CRDT libraries.
- All sync rows or documents for many users against the same data. All need a server that understands the schema.
- Instant is shutting down after its team joined OpenAI.
- None sells to a person building an app for themselves. Not competitors.
- **Evolu** nearest in spirit: local SQLite, end-to-end encrypted, one owner, thin relay.
- **LiveStore** and SQLite's session extension: change-files-per-device, documented as the escape hatch for data-heavy apps.
## Bitwarden and Proton
- Password managers and mail with end-to-end encryption.
- **Borrowed:** the key model. A random data key locked with a key from the password, a separate login key, a recovery code, no email reset.
## Puter
- Self-hostable web desktop with a remote filesystem API.
- No local copy, no offline, no sync. Only the API shape overlaps.
## Syncthing
- Free, peer-to-peer folder sync. No server, no account; devices pair with an id or a QR code. Keeps old versions in `.stversions`, ignores with `.stignore`, conflicts as `.sync-conflict-` files.
- The closest "folder that follows you" without a vendor. Loses only in the browser and on phones in the background, where a peer must be online.
- **Borrowed:** nothing new; it confirms the same answers: ignore file, conflict copies, versions kept beside the data.
- **Not borrowed:** pairing codes. An account with a password already gets a new device in, and a pairing screen would be UI in every app.
## Obsidian Sync
- One user, a folder of Markdown, end-to-end encrypted, version history, about $4 to $8 a month. Pappdrive for one app, as a paid service, with millions of users.
- Proof that people pay for exactly this. Sets the price ceiling and shows version history is expected.
## CRDT libraries as the agent's default
- Yjs and Automerge are what a coding agent reaches for when told "make it sync". They merge edits inside a document and need a relay server.
- Not competitors for the market, but for the agent's first choice. The docs answer it directly: files are the merge unit; a CRDT file is binary and breaks the plain folder. See the rules in `docs/api.md`.
## Dropbox and Google Drive app folders
- The commercial version.
- Strongest argument against building this: "put it in a Dropbox app folder" works today, if the user has Dropbox.
## The branch is free
- No project targets apps built by one person for their own use.
- The audience barely existed before people could build apps without learning to code.
