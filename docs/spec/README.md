# Pappdrive: design spec
| | |
|---|---|
| Status | Ready to build |
| Owner | Sagi Hammer |
| Last updated | 2026-10-17 |
| Storage | Cloudflare R2, bucket `pappdrive-prod`, Western Europe |
| Server host | Cloudflare Workers, Paid plan |
## Purpose
- A library that gives a personal app a folder that stays the same on every device its user owns.
- "Personal app" means an app built by one person for their own use. Builder and user are usually the same person.
## Goals
- Files, not rows. Any program can read the folder.
- Works offline. Syncs when a connection exists.
- The operator runs the server and owns the storage. No third-party sync service.
- Storage sees only encrypted bytes, opaque ids, and sizes.
- End to end: the operator cannot read user data and holds no key that can be lost.
- The server stays thin: sign-in, locked keys it cannot open, signed links, index commits, cleanup.
## Non-goals
- Multi-user collaboration on the same data.
- Merging edits inside a file.
- Queries across files.
- Backups or long-term file history. Versions are kept for a week: every commit from the last hour, then one per day.
- Password reset by email. Only the user's other devices or recovery code can reset it.
## Terms
- **Builder**: the person who writes an app on top of the library, usually through a coding agent like Claude Code.
- **Operator**: whoever runs the server and the bucket.
- **App**: created by the user before it can sign in. Its name is unique per user, and it has one folder.
- **Folder**: one app's synced files for one user, on one device.
- **Blob**: encrypted contents, stored in R2 under its id. A file up to 16 MiB is one blob. A bigger file is several.
- **Part**: one 16 MiB piece of a bigger file. Each part is a normal blob.
- **Blob id**: a keyed hash (HMAC) of the blob's plaintext. Same contents, same id.
- **File id**: for a one-blob file, its blob id. For a bigger file, a keyed hash of its part ids in order.
- **Index**: the folder's map from paths to file ids, held in R2 as a checkpoint plus a delta. The only truth.
- **Checkpoint**: the whole index as of one commit, under its own id. Written every hundred or so commits, never changed.
- **Delta**: the changes since the newest checkpoint. Rewritten on every commit; its ETag is the folder's version.
- **Header**: the plaintext part of the index. Blob ids and their stored sizes.
- **Body**: the encrypted part of the index. Paths, file ids, part lists, real sizes, modified times.
- **ETag**: R2's version tag for an object. The delta's ETag is the folder's version.
- **Disk index**: on the device, the ids of what is in the folder now.
- **Synced index**: on the device, the index as of the last successful sync.
- **Server index**: the index as R2 holds it right now.
- **Decision table**: the twelve rules that say what to do with each path during a sync.
- **Commit**: a client sending a new delta, or a new checkpoint, to the server for writing.
- **`.pappignore`**: a file that works exactly like `.gitignore`. Files it matches never sync.
## Sections
1. [Overview](01-overview.md): pieces, library interface, invariants
2. [Storage](02-storage.md): provider, bucket, blobs
3. [Index](03-index.md): file format
4. [Server](04-server.md): sign-in, links, commit, reads, read-only access, deletion, state
5. [Client](05-client.md): folder modes, local state, path rules, ignore rules, watching
6. [Sync](06-sync.md): loop, decision table, conflicts
7. [Encryption](07-encryption.md): keys, threat model, export
8. [Cleanup](08-cleanup.md)
9. [Limits and guidance](09-limits-and-guidance.md): limits, the agent as builder, builder guidance, scope, open questions, cost
10. [Implementation plan](10-build-order.md)
11. [Prior art](11-research.md)
12. [Implementation details](12-implementation.md): tech stack, formats, API, SDK
