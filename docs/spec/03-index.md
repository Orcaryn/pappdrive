# 3. Index
Two files per user and app. The server writes both and reads only their plaintext headers.
```
<user>/<app>/index/<id>   the checkpoint: the whole folder as of one commit. Written rarely, never changed.
<user>/<app>/delta        the changes since that checkpoint. Rewritten on every commit.
```
- The folder's state is the checkpoint with the delta applied. The delta's ETag is the folder's version.
- Why two files: a 10,000-file folder is about a megabyte of index. Rewriting it on every save, and downloading it again on every device after every save, was the main cost of sync. The delta caps a commit and a poll at about a hundred lines. Git's `split-index` works the same way: a big shared index rewritten rarely, a small one rewritten every time.
## The checkpoint
One JSON object:
```json
{
  "v": 1,
  "blobs": { "<64 hex id>": <stored size in bytes>, ... },
  "body": "<encrypted path list>"
}
```
- **v**: format version. A client that sees an unknown number stops and asks for an update.
- **blobs**: the plaintext header. Every blob id the body references, with its stored size, which is the encrypted size.
- **body**: the path list, compressed and encrypted with the user's data key. Exact encoding in [Implementation details](12-implementation.md).
- The id is 64 random hex characters, chosen by the device that writes it. The object never changes, so a device keeps the checkpoint it has and fetches another only when the delta names a different id.
## The delta
```json
{
  "v": 1,
  "base": "<id of the checkpoint it extends>",
  "blobs": { "<64 hex id>": <stored size in bytes>, ... },
  "body": "<encrypted changes>"
}
```
- **base**: which checkpoint the changes apply to. A device whose checkpoint has another id fetches the one named here.
- **blobs**: the plaintext header, with only the ids the changes use that the checkpoint's header lacks. The server verifies these at commit and, together with the checkpoint's header, uses them to find blobs that dropped out. Live blobs = checkpoint header + delta header.
- **body**: encrypted like a checkpoint body. Decrypted, a map from path to entry, or to `null` for a path deleted since the checkpoint. One line per path changed, latest change wins, so the delta's size is bounded by the number of distinct paths touched, not by the number of commits.
## Commits
- A **delta commit** rewrites the delta: the changes already in it, merged with this device's. The server checks the new blob ids and writes with `If-Match` on the delta's ETag. Cost: the size of the delta.
- A **checkpoint commit** writes a new checkpoint under a new id and an empty delta pointing at it. A device makes one when the folder has no checkpoint yet, or when the merged delta would hold more than 100 paths or more than 100 new blobs. Cost: the size of the folder, every hundred commits or so.
- Both go through the folder's queue on the server, so the checkpoint and the delta are written in order, and a device never sees a delta that names a checkpoint not yet stored.
- The server cannot read either body. The device must list every blob id a body uses in the matching header, or other devices will find files they cannot download.
## The body
The body, decrypted, is a map from path to entry:
```json
{
  "notes/todo.md":     { "id": "3f9a…", "size": 1206,  "mtime": 1760690000000 },
  "notes/img/cat.jpg": { "id": "b71c…", "size": 88182, "mtime": 1760680000000 },
  "video/talk.mp4":    { "id": "9e04…", "size": 40000000, "mtime": 1760670000000,
                         "parts": ["c2d8…", "51af…", "07be…"] }
}
```
- Path is the key, so no duplicates. NFC, no leading slash, forward slashes.
- Files only, no folders. A folder exists because files are in it. An empty folder does not sync. Git and remoteStorage work the same way.
- Why: the decision table compares ids, and a folder has no id. With files only, the table needs no folder rules.
- **id**: 64 hex characters, the file id. A file up to 16 MiB is one blob, and this is its blob id. For a bigger file, it is a keyed hash of the part ids in order. No blob has that id.
- **parts**: only on files over 16 MiB. The part ids, in order. Every part is 16 MiB except the last.
- The decision table compares file ids only, so it works the same for big files. Same contents, same parts, same id.
- The header lists every part id. It does not list a big file's own id, because no blob has it.
- The server cannot reorder or drop parts. The list is inside the encrypted body.
- **mtime**: milliseconds since the epoch, as the device saw it. For display and scanning only. The id decides conflicts.
- **size**: the real file size, for the app to show. The header's size is the encrypted one, a little larger.
## Sizes
- Ten thousand files: a checkpoint of about a megabyte raw, half after gzip. Ids do not compress well. The delta: a line per changed path, so a few hundred bytes to a few tens of kilobytes.
- A big file adds one id per 16 MiB. A 10 GiB file has 640 parts. That adds about 45 KB to a body before compression, and about 50 KB to a header. Over 100 new blobs in one commit forces a checkpoint.
- No trie. No per-entry version. The file id is the version. The explorer tree is built from paths at load time.
