# 5. Client
The library inside the app.
## Folder modes
- The builder chooses on open.
- **Visible.** A real folder the user can open. The library watches it, so edits from other programs sync. Desktop only. The only mode where the watcher runs. See [Watching a visible folder](#watching-a-visible-folder).
- **Private.** A store the library owns. Same files, same paths, no watcher.
- Browser: private only, in the origin private file system. Every browser has it. The user cannot reach it.
- Phones use the browser adapter, so they are private only too.
- A real folder in the browser is deferred. Only Chrome and Edge support it, there is no watcher, and the browser keeps asking for permission.
- In a browser one tab holds a lock and does the syncing.
- Path rules are identical in both modes, so private can become visible later.
- One app, one folder. A visible folder belongs to one app, and the hidden folder records which one.
- Opening a folder is refused if another app already uses it, or if it is inside or around another app's folder. The library looks for `.pappdrive/` in the folders above it, and in every folder below it during the scan.
- Why: two apps syncing the same files to two places would never agree.
- An app that needs another app's files opens them read-only. See [Read-only folders](#read-only-folders).
## Read-only folders
- An app can open another app's folder to read it. The app must name that folder at sign-in. See [Server](04-server.md).
- Always private, on every platform. In a visible folder the user could edit files, and those edits could never be uploaded.
- The library stores it next to the app's own private store. It only downloads and deletes, so it always matches the server.
- Write and remove throw an error. Read, list, watch and status work as usual.
- There are no local changes, so there are no conflicts and no commits. The decision table has only two outcomes: download, or delete here.
- If the other app's index does not exist, the folder is empty. Either that app has not synced yet, or its folder was deleted.
## Local state
Stored in a hidden folder, `.pappdrive/`, inside the app folder. Three states exist. Two are stored, one is fetched.
- **disk**: the ids, and for big files the part ids, of what is in the folder now, including edits not yet uploaded. A cache, so the app does not rehash everything on every open. The watcher updates it as files change. The scan on open refreshes it: a file whose size and modified time match its entry is not hashed again. Anything else is.
- **synced**: for each path, the last version this device and the server agreed on. It is the only memory of the past. It is how the device tells "deleted somewhere else" from "new here". It is updated one path at a time, never replaced as a whole. See [Sync](06-sync.md).
- **server**: the index R2 holds right now. Not stored. Fetched by polling and compared on the spot.
Both stored files are in the index format.
- What this device changed: disk compared with synced.
- What other devices changed: server compared with synced.
- A commit is never the list of files on disk. It is the server index with this device's changes applied. See [Sync](06-sync.md).
- Some files are marked skipped in disk: files whose names break the path rules or that this device's system cannot create. A skipped file is never uploaded, and its synced entry is left as it was. See [Sync](06-sync.md).
- The current files are the real files. No copy of contents.
- Everything on the device is plaintext.
- Deleting the hidden folder is safe. See below.
## Missing local state
- Happens on a fresh install, or when the user deleted it.
- Synced is treated as empty. Never as the fetched index, or every server file not yet on disk would look locally deleted and the next commit would delete it from the server.
- Disk is rebuilt by hashing every file in the folder.
- Fetch the latest index. Every file on disk counts as created on this device, every entry in the index as created on the server.
- Same path, same id: adopt. Nothing moves.
- Same path, different id: the server version keeps the path, the disk version is kept beside it as a conflict copy.
- Only in the index: download.
- Only on disk: upload and add to the index.
- A deletion made while the hidden folder was missing is lost. The file comes back. Nothing else is affected.
## Path rules
- UTF-8, normalized to NFC. macOS produces NFD, everything else NFC.
- Forward slash separator. No empty segment, no `.` or `..`.
- No control characters.
- Any other character is allowed, including `:` and `?`. Windows rules are not applied to every device.
- A device whose system cannot create a name, such as Windows with `a:b.md`, skips that path and reports it through watch. The other devices keep it.
- 255 bytes per segment, 1024 per path.
- `papp.files.write` refuses a name that differs from an existing one only in capital letters.
- Other devices, and other programs, can still create such a name. [Sync](06-sync.md) explains what happens then.
- A file and a folder cannot share a name. Two offline devices can still make one each. [Sync](06-sync.md) explains what happens then.
- Folders exist because files are in them. In visible mode, an empty folder the user makes stays on that device. It does not sync.
- A bad path given to `papp.files.write` is an error. A bad name made by another program is skipped. The library never renames a file on its own.
## Ignore rules
- A file named `.pappignore` works exactly like `.gitignore`. Same patterns, same `!` to un-ignore.
- An `.pappignore` can be in any folder. It applies to that folder and everything inside it.
- `.pappignore` is a normal file. It syncs, so every device uses the same rules.
- An ignored file stays on its device. It is never uploaded, and it never enters the index.
- Like in git, a rule only stops files that are not synced yet. A file already in the index keeps syncing, even if a new rule matches it. So adding a rule never deletes anything, on any device.
- Matching ignores capital letters, on every device. Otherwise a Mac and a Linux machine could disagree about the same file.
- Always ignored, before any `.pappignore`:
  - `.git/` and the library's hidden folder. No rule can un-ignore these. Two devices syncing `.git` at once break the repository.
  - `node_modules/`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, and editor leftovers: `*.swp`, `*.swo`, `*~`, `.#*`, `~$*`. An `.pappignore` can un-ignore these with `!`.
- Rules apply in both modes. In private mode, `write` to an ignored path saves the file on this device only. That is how an app keeps a local cache.
## Watching a visible folder
- The library cannot stop other programs from writing to the folder, and does not try. That is the point of a visible folder.
- It never locks files or makes them read-only. A lock blocks the user's own editor.
- A read-only file would not help anyway. On a Mac or Linux, an editor that saves by rename can still replace it. A rename needs permission on the folder, not on the file.
- Watcher events are hints, not facts. An event only means "look at this file again". The library then looks at the file itself.
  - Why: an editor that saves by rename shows up as "deleted" then "created". The watcher also merges events: a file created and deleted quickly reports nothing.
- First it waits for quiet: two seconds with no changes, ten at most. The same wait as in [Sync](06-sync.md).
- Then it checks each changed file:
  1. The file is gone: it was deleted.
  2. The file is there: note its size and modified time, hash it, then check the size and modified time again.
  3. Either one moved: the file is still being written. Wait for quiet again.
- So a rename-save becomes one change, not a delete and a new file.
- If the watcher reports an error, or that it dropped events, the library scans the whole folder. The scan is cheap: only files whose size or modified time changed are hashed.
- Ignored folders are not watched at all, so a big `node_modules` costs nothing.
- While the app is closed, nothing watches. The scan on open catches what changed.
## Watch
- One change per callback: path, origin, and for a conflict the two file names.
- `local`: this device wrote it.
- `remote`: another device wrote it, just downloaded.
- `conflict`: both wrote it. See [Sync](06-sync.md).
- Also `skipped` and `case-duplicate`. Full list in [Implementation details](12-implementation.md).
## Phones
- No background work. Sync runs while the app is open. The builder docs state this.
