# 8. Cleanup
## Kept checkpoints
- A checkpoint is written every hundred or so commits, under its own id, and never changed. The older ones stay as the folder's history.
- At each checkpoint commit the older ones are thinned. One stays if it is one of the newest five, or from the last hour (at most 60 of those), or the newest of its UTC day within the last seven days. The rest are deleted. The checkpoint the delta names is never thinned.
- So a folder has at most about 67 checkpoints: 60 for the hour, 7 for the week. A client that checkpoints every second cannot grow the list, and the sweep reads a bounded number of them.
- Nothing deletes blobs at commit. A blob lives while the delta or any kept checkpoint mentions it.
- A bad commit, such as an app bug that removes files, can be undone to any kept checkpoint. The changes since the newest checkpoint live only in the delta, which is rewritten in place, so they have no history until the next checkpoint. The device reads a kept checkpoint, downloads the old version, and writes it back. A normal write. Its blobs are already stored, so nothing is uploaded. No route or API exposes the kept checkpoints yet.
- Cost: a checkpoint is one line per file, so a 5,000-file folder holds a few tens of megabytes of checkpoints at most. Blobs stay a week instead of a day, so churn costs about five times the garbage of today. Under two cents per user per month for every normal profile. The only expensive case is a big file rewritten on every save, which the per-user quota must cap; see [Limits](09-limits-and-guidance.md).
## Daily sweep
- Deletes blobs no kept index needs any more, and blobs uploaded but never committed: device died, commit refused.
- Steps:
  1. Read the delta and every kept checkpoint.
  2. List every blob under the user's app prefix. Skip the delta and the checkpoints.
  3. Delete every blob that neither the delta nor a kept checkpoint mentions and that is older than a day.
- Each abandoned blob is at most 16 MiB and lives at most two days: one day of grace, then the next sweep. A big file abandoned halfway leaves many. Nothing limits how many yet. An upload link rate limit comes before other users. See [Limits](09-limits-and-guidance.md).
- One day of grace is enough for most uploads, because every blob is checked at commit, so the only gap is an upload still running.
- A big upload can take more than a day. Then the sweep deletes its first parts before the commit. The commit answers 422 with the missing ids, the device uploads those again, and commits again.
- The sweep runs in the folder's Durable Object, in the same queue as commits, so it never races one. A daily alarm on each Durable Object starts it.
## After a deletion
- Deleting an app's folder, or the account, deletes everything at once. See [Server](04-server.md).
- One more sweep runs a day later. It catches blobs from upload links given out just before the deletion. It finds no delta, so it deletes everything under the prefix, of any age. It does not set a next sweep.
- If the user signed in to the app again during that day, the delta exists, and the sweep runs as usual.
## No backups
- After a week, a deleted or overwritten file is gone. Within the week only the end-of-day version survives once the hour has passed.
- A device mid-download of a blob the sweep just deleted sees a failed download, pulls the index again, and gets the new blob.
