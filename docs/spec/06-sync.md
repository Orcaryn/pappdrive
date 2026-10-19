# 6. Sync
## When a sync runs
- When the app opens.
- Every few seconds while the app is open, and at once when the server says another device committed. See Noticing changes in [Server](04-server.md).
- After the app or the user changes a file, debounced: wait until nothing has changed for two seconds, but never more than ten seconds after the first change. A burst of saves becomes one commit.
- While the debounce is waiting, a polling round only applies changes from the server. This device's changes wait for the debounce to end.
- When the app goes to the background or closes, the debounce ends at once and the sync runs.
## One sync round
1. Fetch the delta, sending the last ETag. "Unchanged" means only this device's own changes need sending. A delta that names a checkpoint this device does not hold: fetch that checkpoint too. The server index is the checkpoint with the delta applied.
   - No delta, but synced is not empty: the folder was deleted. Stop, and upload nothing. See Deletion in [Server](04-server.md). (A read-only folder treats a missing index as empty. See [Client](05-client.md).)
2. Run the decision table on every path. Each path gets one action: nothing, download, delete here, upload, delete on server, or conflict. Then look for a file and a folder with the same name. Rules below.
3. Apply what came from the server: downloads and local deletes. Rules below.
4. Handle conflicts: download the server's version to the path, and keep this device's version beside it as a conflict copy. The copy is a new file to upload.
5. If this device has changes (uploads, deletes on server, conflict copies): upload the blobs they need. A blob whose id is already in the server header is not uploaded. "Already stored" counts as success.
6. Build the commit: the delta from step 1 with only this device's changes merged in. Never the list of files on disk. When the merged delta would hold more than 100 paths or 100 new blobs, or the folder has no checkpoint yet, the commit is a new checkpoint with an empty delta instead. See [Index](03-index.md).
7. Send the commit with the delta's ETag.
   - Saved (200): mark the paths this device changed as synced.
   - Stale (412): another device wrote first. Start the round again.
   - Blob missing (422): upload it again and resend.
## Applying changes from the server
Downloads:
- One server call gets download links for up to 100 blobs.
- A few downloads run at once, smallest first, with at most 32 MiB of blobs in flight. With the part being decrypted, that is 48 MiB at most, the same as uploads.
- Each blob is downloaded, decrypted, checked against its id, and written to a temp file in the hidden folder.
- A big file is downloaded one part at a time, in order. Each part is checked and added to the end of the temp file. At the end, the part list is checked against the file id.
- The temp file is named by the file id. If the download stops halfway, for example because the app closed, the next round continues from the last whole part.
- A temp file that no download needs any more, because the file changed on the server, is deleted.
- Just before moving it into place, check the file in the folder again. Is it the same as the library last recorded? Same size and same modified time, or still missing if it is a new file.
  - Same: move the new file into place.
  - Different: someone just saved it. Handle it as a conflict. The local save is kept as a conflict copy.
  - Saved in the last two seconds: compare the hash too. Some disks record time only to the second, and FAT to two seconds.
- The app never sees a half-written file, because the move is a single rename.
Local deletes:
- Run after all downloads, so a renamed file appears at its new path before it leaves the old one.
- Check the file the same way first. If it was edited since, keep it and upload it. An edit beats a delete.
- If these deletes leave a folder empty, the folder is removed too. It no longer exists on the server. An empty folder the user made stays.
Locks and limits:
- Saves through the library (`papp.files.write`) and downloads take turns on the same file. They never race.
- Programs outside the library can still save in the tiny gap between the check and the move. That save is lost. This can only happen in visible mode. Closing the gap fully would need file locks, and other programs ignore them. The library takes no locks. See [Client](05-client.md).
Progress:
- Disk and synced are updated one file at a time, as each download or delete finishes.
- A file that has not arrived yet keeps its old synced entry, so the next round tries it again.
- A crash halfway is safe. Files that already arrived match the server, so the next round leaves them alone.
- A download that fails because the blob was just deleted means the server index moved on. The next round fetches it again.
- The watch callback fires for each file as it lands.
## The decision table
Each path is compared in three places:
- **disk**: the folder on this device now
- **synced**: the last version this device and the server agreed on
- **server**: the server index just fetched
**Path is in synced.** Each side is unchanged, changed, or deleted compared with synced.
| disk \ server | unchanged | changed | deleted |
|---|---|---|---|
| **unchanged** | nothing | download | delete here |
| **changed** | upload | same content: nothing. Else: **conflict** | upload, the file comes back |
| **deleted** | delete on server | download, the file comes back | nothing, remove from synced |
**Path is not in synced.** It is new on one side or both.
| case | action |
|---|---|
| new on disk only | upload |
| new on server only | download |
| new on both | same content: nothing, add to synced. Else: **conflict** |
- Twelve cases in total.
- Only two cases are conflicts: changed on both sides, or new on both sides, with different contents.
- With one person using one device at a time, conflicts are rare.
## A file and a folder with the same name
- Two devices are offline. One makes a file called `notes`. The other makes `notes/a.md`, which makes a folder called `notes`.
- Each path is fine on its own, so the decision table sees no problem.
- So after the table, the device checks the paths it will commit: the server index plus its own changes. If there is a file `notes` and also a path that starts with `notes/`, that is a clash. Capital letters are ignored, as below.
- The device does this check, not the server. The server cannot read paths.
- The rule is the same as for any conflict: the server's side keeps the name, because other devices already have it. This device's side moves.
  - This device made the file: the file becomes `notes (conflict 2026-10-17 09-15-30)`.
  - This device made the folder: the folder becomes `notes (conflict 2026-10-17 09-15-30)/`, with every file in it. A move changes paths only. No file uploads twice.
- On disk, the device moves its own side first, then downloads the server's.
- Watch fires once, with origin `conflict` and both names.
## Skipped files
- A file is skipped when its name breaks the path rules, or this device's system cannot create the name. Size never skips a file.
- A skipped file freezes its whole path, on this device, in synced, and on the server:
  - Nothing is uploaded, downloaded, or deleted for that path.
  - Its synced entry stays as it was.
  - The server keeps its last version. Other devices keep theirs.
  - Edits from other devices to that path do not reach this device while it is frozen.
  - Watch reports the file as skipped, so the app can show it.
- When the reason goes away, the path joins the table again. The kept synced entry decides: upload if only this device changed it, conflict if the server changed it too.
- Why the whole path: if only the disk side were left out, a name this device cannot create would look "deleted here", and the table would delete it on the server and on every other device.
## Ignored files
- An ignored file is left out of the disk index, so the decision table never sees it. See [Ignore rules](05-client.md#ignore-rules).
- A path already in synced or in the server index is not ignored. It goes through the table as usual, whatever the rules say. That is the git rule: ignoring applies only to files not synced yet.
- Why: if a new rule hid a synced file, it would look "deleted here", and the table would delete it on the server and on every other device.
- Each round starts by reading the `.pappignore` files on disk. So a rule added on another device starts here in the round after its `.pappignore` downloads.
## Names that differ only in capital letters
- On a Mac or Windows, `Todo.md` and `todo.md` are the same file. On Linux and Android they are two files.
- Two devices could each create one of them while offline. Neither device sees a problem on its own.
- So the decision table compares paths without capital letters. It lowercases them with the standard Unicode rule first. `Todo.md` and `todo.md` count as one path.
- This applies to folder names too. `Notes/a.md` and `notes/b.md` are in the same folder.
- The index keeps the spelling the user typed. A new file in an existing folder uses that folder's spelling.
- Both new, different content: a normal conflict. One keeps the name, the other becomes a conflict copy.
- Both new, same content: nothing to do. The spelling already on the server wins.
- Only the capitals changed: a rename. It syncs like any change.
- On a Mac or Windows, a rename that only changes capitals goes through a temporary name, because the system sees one file.
- On Linux, another program can still create both names in the folder. The library syncs the one already in the index, or the first one it finds. It ignores the other and reports it through watch. Ignoring the second name does not freeze the first.
## Why the commit is not the disk list
- A file still downloading is missing from disk. Committing disk would drop it from the server, and the server would delete it everywhere.
- A skipped file is on disk with no blob. Committing disk would make every commit fail.
- So a commit only carries what this device changed. Everything else comes from the server index unchanged.
## Why synced is updated per path
- If synced took the whole committed index, a file still pending download would be in synced but not on disk.
- The next run would read that as "deleted on this device" and delete it on the server.
- So a path enters synced only when this device and the server both have the same version of it.
## Conflicts
- The first commit keeps the path. The server version stays there, because other devices already have it.
- This device's version is written beside it: `todo (conflict 2026-10-17 09-15-30).md`. Name taken: add a counter.
- The copy is an ordinary file. Goes into the index. Syncs everywhere.
- Watch fires once with origin `conflict`, the path, and the two names.
- An app can show a merge screen. No app has to.
- Only the device that hit the conflict knows. Others see two files.
## Edit versus delete
- Not a conflict. The edit wins. The file comes back.
- Throwing away work is the one outcome to avoid.
## No tombstones
- Deletions come from synced alone. In synced, missing now: deleted.
- Nothing is written to the server to say so.
