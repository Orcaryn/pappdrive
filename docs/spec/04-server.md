# 4. Server
A Cloudflare Worker in the operator's account. Kept thin by design.
## Sign-in
- The server is the identity provider. Email and password.
- The password never reaches the server. The library turns it into a login key on the device and sends that. See [Encryption](07-encryption.md).
- The library signs in directly, with no browser redirect. The password must be hashed by the library, not by a web page the server could change.
- Sign-in names the app, like `my-notes`. The app must exist first. See [Apps](#apps).
- No consent screen. Builder and user are the same person.
- Each installed copy gets a long-lived refresh token and an install id.
- The install id is how a lost phone gets logged out.
- A token writes one user's one app folder and nothing else.
- It can also read other app folders of the same user, if the app named them at sign-in. See [Read-only access](#read-only-access).
- Sign-in is rate limited per email and per IP address, against password guessing.
## Apps
- An app must be created before it can sign in. The user creates it through the API or with the command-line tool. A dashboard comes later.
- An app name is unique per user. Creating a name the user already has is refused. So two different apps never share a folder.
- All installed copies of the same app share its folder. That is how one app syncs across devices.
- Names: lowercase letters, digits, `-` and `_`, 1 to 64 characters. The name is part of the R2 path.
- Sign-up also creates the app it names. A new account has no apps yet, so nothing can clash.
- Signing in to an app that does not exist is refused.
- A read list may only name apps that exist.
- Signing in without an app gives a token that can list and create apps, and read the folders on its read list. It cannot write to any folder. The command-line tool uses it, to create apps and to export.
## API
- Sign up, sign in, recover, and change password.
- List and create apps.
- Get upload links and download links, up to 100 blobs per call.
- Read the delta, and a checkpoint by its id.
- Commit a new delta, or a new checkpoint with an empty delta.
- Watch a folder: a WebSocket that gets a message after each commit.
- Delete this app's folder, or the whole account.
- Every route starts with `/v1/`. Phones keep old copies of the library for months. A change that breaks old copies goes under `/v2/`, and `/v1/` keeps working until no copy uses it.
- Each failure has its own HTTP status code: stale commit, missing blobs, blob too big, too many requests. A "too many requests" answer says how long to wait.
- Full list with requests, answers and status codes in [Implementation details](12-implementation.md).
## Upload link
- Client computes the id, encrypts the blob, and sends the encrypted blob's size and SHA-256.
- Server checks: id well formed, size within the limit: 16 MiB plus the 29 bytes of encryption. See [Limits](09-limits-and-guidance.md). No call to R2.
- The server does not know about parts. To the server, a part is just a blob.
- Server signs an upload link for `<user>/<app>/<id>`, good for a few minutes. The link fixes three things:
  - the exact size
  - the exact contents
  - only if nothing is stored there yet
- R2 enforces all three. Details in [Implementation details](12-implementation.md).
- "Already stored" counts as success. That is the whole dedup check.
- Blobs can never be overwritten, because R2 refuses, not because the server checked first.
- Anyone holding a link can use it until it expires, so keep them short.
- Download links: same prefix rule, nothing extra to sign, also good for a few minutes.
- Both calls take a list, up to 100 ids, so a sync of many files is a few server calls, not one per file.
## Index commit
- Two kinds. A delta commit rewrites the delta. A checkpoint commit writes a new checkpoint under a new id and an empty delta that names it. The device chooses; see [Index](03-index.md).
- Both send the ETag of the delta the device last read. Null when the folder has no delta yet, which is only before the first commit; the first commit is always a checkpoint.
- The server cannot read a body. The device must list every blob id a body uses in the matching header, or other devices will find files they cannot download.
- Delta commit: the server reads the current delta, compares the new header with the old one, and checks every new id in R2 by HEAD, at most a hundred. A delta that names another checkpoint than the current one is refused as stale. Then it writes with `If-Match` on the ETag.
- Checkpoint commit: the server reads the current delta and the checkpoint it names, and compares the new header with both together. Every new id is checked in R2, with the size the header says. Missing: refuse, list the missing ids. Size differs from the header: refuse.
- Why: devices upload straight to R2, so the server never sees an upload. Without this check, a failed upload or a bug could commit an index pointing at a blob that is not there, and every other device would get a file it cannot download.
- How, with the fewest calls:
  - Few new ids, the usual commit: HEAD each one. One call per id.
  - Many new ids, like a first sync: list the folder's blobs instead. One call returns up to 1,000 blobs with their sizes.
  - The server picks whichever needs fewer calls: the number of new ids, or the number of blobs in the new header divided by 1,000. This second number is a guess: the folder in R2 also holds blobs that only the kept checkpoints use, and uploads not yet committed. Close enough to choose.
  - Why it matters: a Worker may make 10,000 calls per request by default. A first sync of 20,000 files would need 20,000 HEADs and fail. Listed, it is about 20 calls.
- Every kept id must carry the same size as before.
- So every size in a committed header was checked against R2.
- The checkpoint is written first, with `If-None-Match: *` under its new id, then the delta with `If-Match` on the ETag, or `If-None-Match: *` for the first commit. R2 refuses if another device wrote first: answer "stale". A checkpoint left behind by a refused commit is one more kept checkpoint; thinning removes it later.
- After a checkpoint commit the older checkpoints are thinned: all from the last hour, capped at 60, at least the newest five, then one per day for seven days. The one the delta names is never thinned. No blob is deleted at commit. See [Cleanup](08-cleanup.md).
- The server never merges and never picks winners. It only refuses a stale write.
- Commits and the daily sweep for one folder run one at a time. Without that, the sweep could delete an old blob that a commit running at the same moment just checked and brought back.
- How: each folder has its own Durable Object. Only one copy of it runs anywhere in the world. Commits and the sweep for that folder run inside it, through a queue.
- Why the queue: while a Durable Object waits for R2, it lets the next request start. The queue makes that request wait its turn.
- The Durable Object stores nothing. The delta and the checkpoints in R2 stay the only truth.
## Read-only access
- One app can read another app's folder. Example: a dashboard that shows the notes from `my-notes`.
- At sign-in, the app lists the folders it wants to read: `read: ["my-notes"]`. There is no consent screen, same as sign-in.
- The server stores the list with the device's token. A token refresh can change it, so adding a folder needs no new sign-in.
- A reading app can get two things: the other folder's delta and checkpoints, and its blobs. It cannot upload or commit.
- A folder that is not on the list is refused.
- The reading app needs no extra key. All of a user's apps share one data key. See [Encryption](07-encryption.md).
- So the list protects against bugs, not against a bad app. Any app the user installed already has the data key. The list stops a bug in the dashboard from writing into the notes.
- The reading device keeps a private copy of the folder, and keeps it the same as the server. See [Client](05-client.md).
## Deletion
- Two kinds: one app's folder, or the whole account.
- Both need the password again. The request carries the email and the login key, like sign-in, and no token. A stolen token cannot delete anything.
- Both are rate limited like sign-in.
- Both are final. No kept copies, no waiting period. The docs tell the user to export with the command-line tool first.
Delete an app's folder:
- Steps:
  1. Stop every token for that app, on every device. The server saves the reason with each token, so it can tell the device later.
  2. In the folder's Durable Object, in the same queue as commits: delete the delta, then every checkpoint and blob under `<user>/<app>/`.
  3. Set one last sweep for a day later. An upload link given out just before step 1 can still upload a blob after step 2. The last sweep finds no index, so it deletes everything under the prefix, of any age.
- Upload links and commits check in D1 that the device's token is still active. Without this check, a device with an access token from before the deletion could rebuild the folder. Access tokens last up to an hour.
- Deleting an app also frees its name. Creating it again starts an empty folder.
Delete the account:
- Steps:
  1. Stop every token of the user, on every device.
  2. Delete `<user>/key`. From here, no new device can open the data.
  3. List the app folders under `<user>/`, and delete each one as above.
  4. Delete the user's row. The email is free for a new signup.
- If it fails halfway, the device sends it again. Each step is safe to repeat. The row is deleted last, so the login key still works for the repeat.
- D1's Time Travel keeps a copy of the old row for 30 days. Restoring it would bring back an account with no key and no files.
What other devices see:
- At their next token refresh, the server answers "gone", with the reason: app deleted or account deleted.
- A device may notice earlier, when its index is suddenly missing. It must not treat that as "the server is empty", or it would upload all its files again and rebuild the folder. It stops syncing and refreshes its token to learn why.
- Then the library signs out of that app, deletes its hidden folder, and tells the app through `status`. For a deleted account, it also deletes the data key from the device.
- A private folder is deleted too. A visible folder stays on disk, because those files belong to the user. If the user signs in again, they upload as new files.
## Reading the index
- The device fetches the delta through the Worker, sending the ETag it already has in `If-None-Match`. The Worker passes the condition to R2 and answers 304 if nothing changed, or the new delta and its ETag if something did.
- If the delta names a checkpoint the device does not hold, it fetches that checkpoint by id. A checkpoint never changes, so the device keeps it for the session. Most polls end at the 304; most changes cost one small delta.
- The browser cache is off. The Worker answers with `Cache-Control: no-store`.
## Noticing changes
- While the app is open, the device holds one WebSocket to `/index/watch`. The folder's Durable Object owns it. After each commit it sends the new ETag to every open socket, and the device fetches the index at once.
- The socket is a hint, not the truth. The device still repeats the fetch every ten seconds in the foreground. That covers a dropped socket or a missed message.
- A 304 costs one cheap read. A device polling all month uses about a quarter million of the ten million free. Messages sent on a socket are free.
- The Durable Object accepts sockets with the Hibernation API and sets no timer. Idle, it hibernates and costs nothing. A timer would keep it awake, and an awake Durable Object bills by the second: about four dollars a month for one always-open device.
- The token rides in `Sec-WebSocket-Protocol`, offered after the protocol name `pappdrive`. A browser cannot set headers on a WebSocket, and a query string ends up in logs. The socket is checked once, at connect. The device closes it and opens a new one with a fresh token before the old one expires.
- Phones and browsers hold the socket and poll only while the app is open. Nothing runs in the background.
## State
- The whole database, in D1, is three tables:
  - users: email, user id, hash of the login key, hash of the recovery login key, the password hash settings
  - apps: user, name, when created
  - device tokens: user, app, install id, hash of the refresh token, the folders it reads, and why it was stopped, if it was
- The locked copies live in R2, at `<user>/key`, not in the database.
- No copy of the index. No cache. No table of blobs.
- R2's ETag is the version. The index is the only truth.
- A broken or wiped database is restored with D1's Time Travel, to any minute in the last 30 days. Always on, no backup job.
- Even with no restore, no data is lost: files and locked copies are in R2. Only sign-in stops, until accounts are linked to their user ids again.
## Deferred
- Device list with "log out this device".
- A per-user quota and an upload link rate limit. Needed before other users. See [Limits](09-limits-and-guidance.md).
