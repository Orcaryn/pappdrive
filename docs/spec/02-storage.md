# 2. Storage
## Provider
Cloudflare R2, through the S3 API. Compared with AWS S3:
| | R2 | AWS S3 |
|---|---|---|
| Storage | $0.015/GB-month | $0.023/GB-month |
| Writes | $4.50 per million | $5.00 per million |
| Reads | $0.36 per million | $0.40 per million |
| Deletes | free | free |
| Egress | free | $0.09/GB after 100 GB |
| Free tier | 10 GB and 1M writes, forever | credits for 6 months |
| Conditional writes | yes | yes |
- Sync traffic is mostly downloads. On S3 that is 75 percent of the bill. On R2 it is zero.
- Per user, S3 is about five times dearer.
- Only a handful of basic S3 calls are used, so any S3-compatible provider works. List in [Implementation details](12-implementation.md).
- R2 has no presigned POST, but a presigned PUT can fix the exact size, the exact contents, and "only if nothing is there". See [Server](04-server.md).
## Buckets
- One bucket per environment. Production: `pappdrive-prod`.
- One bucket for all users, not one per user. Buckets are configuration, not per-user containers.
- Users are kept apart by the signed link, which names one object, and by the token, which writes one user's one app folder and reads only the folders the app named.
- Prefix per user and app:
```
<user>/key               data key, locked with the password and the recovery code. Server only.
<user>/<app>/index/<id>  checkpoints: the whole folder as of one commit, see Index and Cleanup
<user>/<app>/delta       the changes since the newest checkpoint, see Index
<user>/<app>/<blob id>   file contents, encrypted
```
- The bucket accepts browser requests from any website. Browser apps upload to it and poll it directly. The signed link is the permission.
## Blobs
- One file's contents, encrypted. A file over 16 MiB is cut into 16 MiB parts, and each part is its own blob. See [Index](03-index.md).
- Id = a hash of the contents mixed with the user's key (an HMAC). Same contents, same id. Nothing stored twice.
- No blob holds more than 16 MiB of a file. So memory use stays small, however big the file is.
- Never changed after written. R2 refuses a second write to the same key. A changed file gets new blobs. Old ones are deleted by the daily sweep once no kept index points to it.
Benefits of content ids:
- Undo to an old version uploads nothing.
- Duplicates and copies stored once. In a big file, a part that did not change is not stored again.
- Identical edits on two devices are not a conflict.
- Every download can be checked against its id.
- A repeated upload is refused as "already stored" and counts as success.
Costs of content ids:
- Each blob is hashed twice: once for the id, and once after encryption. The upload link needs the encrypted size and hash before the upload starts. The file is read once, one part at a time. Steps in [Implementation details](12-implementation.md).
- In visible mode the file can change while it is being read. The library checks and starts again if it did.
- Big files: adding bytes at the end, or changing bytes in place, uploads only the parts touched. Adding bytes near the start shifts every later part, so all of them upload again.
- HMAC and not a plain hash: a plain hash lets anyone who sees the bucket check whether the user has a specific known file.
## Rationale
The file format is in [Index](03-index.md).
- A rename is one line and moves no bytes.
- A file cannot change under someone downloading it.
- Why parts, and not one big blob encrypted as a stream: WebCrypto cannot encrypt in pieces, and only Chrome-based browsers can stream an upload.
- Parts also let a big upload or download stop and continue later, without starting over.
- Two versions cost one extra line.
- The bucket hides names and contents. It does show how many blobs a folder has and their sizes, because the header is plaintext.
