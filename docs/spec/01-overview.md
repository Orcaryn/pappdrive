# 1. Overview
## Summary
- A library for apps people build only for themselves.
- The library gives the app a folder. The app reads and writes files there.
- A background process in the library keeps the folder identical on all of the user's devices.
- The folder is either a real folder the user can open, or a private store the library owns. The builder chooses.
- The operator runs the server. Files live in object storage behind it, encrypted.
- The server signs links, writes one small file, and deletes blobs nothing points to. It never sees file names or contents.
## Components
- **Library.** Runs inside the app. Open, read, write, list, remove, watch. Keeps files on the device. Syncs in the background. Works offline.
- **Server.** A Cloudflare Worker in the operator's account. Signs people in. Keeps the list of each user's apps. Stores each user's key, locked with their password, which it cannot open. Signs short-lived upload and download links. Writes the index and its delta. Deletes unused blobs, and deletes a folder or an account when the user asks. Nothing else.
- **Storage.** Cloudflare R2. Free downloads and deletes, conditional writes, free tier covers one user forever. A handful of S3 calls, so the provider can change.
## Library interface
- Open a folder, then read, write, list, remove, and watch files. Full interface in [Implementation details](12-implementation.md).
- The user signs in with email and password, in a ready-made form from the library. The library hashes the password on the device.
- The library also offers sign-up (returns the recovery code to show once), recovery with the code, and a new password on a signed-in device.
- Every call works offline. Sync catches up when there is a connection.
- Devices learn about changes by asking R2 directly every few seconds while the app is open. The server is not in that loop.
## Invariants
- Blobs never change. A changed file gets new blobs.
- The checkpoint and the delta in R2 are the only truth. The delta's ETag is the version.
- The server keeps no copy of the index and no cache.
- The server never holds a key it can open. Only the user's password, devices, or recovery code can.
- First to commit keeps the path. The second version is kept beside it.
