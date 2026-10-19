# 7. Encryption
## The idea
- The user's files are encrypted with a key. That key is locked with the user's password.
- The server stores only the locked copy. It never sees the password, so it cannot open the key.
- The operator cannot read user data and holds no key that can be lost.
- Same model as Bitwarden and Proton.
## Keys
- **Data key.** Random, made on the first device at signup. Encrypts everything. Never changes.
- From the data key, the device makes three keys: one to encrypt, one to compute blob ids, one to compute the file ids of big files from their part lists. No key is used for two jobs.
- **Locked copy.** The data key, encrypted with another key. Each user has two: the password copy and the recovery copy.
- **Password.** The device runs it, with the email, through a slow password hash. The result is split in two:
  - **Login key.** Sent to the server to sign in. The server stores only a hash of it.
  - **Password key.** Makes the password copy. Never leaves the device.
- The two halves are separate, so the login key tells the server nothing about the password key.
- **Recovery code.** Random, made at signup, shown to the user once. Split in two the same way:
  - **Recovery login key.** The server stores only a hash of it. It proves the user holds the code.
  - **Recovery key.** Makes the recovery copy.
- One data key per user, shared by all of that user's apps. That is what lets one app read another's folder with no key exchange. See [Server](04-server.md).
- Changing the email means making a new password copy, on a signed-in device. Not built yet.
## Where the locked copies live
- In R2, at `<user>/key`, next to the user's data:
  - the password copy
  - the recovery copy
- Only the server reads and writes it. No signed link names it.
- Useless to anyone without the password or the recovery code.
## On the device
- After sign-in, the device keeps the data key, so the password is asked only once per device.
- Where:
  - Mac, iPhone, Windows, Android: the system keychain or key store.
  - Linux without a keychain: a file only the user can read.
  - Browser: IndexedDB.
- Never inside the app folder, including the hidden folder. A zipped folder, or a folder that Dropbox or iCloud also syncs, must not carry a key.
- Signing out deletes the key from the device. It first reminds the user to keep their password or recovery code.
- The library encrypts blobs and the index body on the device before upload.
## Flows
- **Sign up.** The device makes the data key and the recovery code, makes both locked copies, and sends both login keys and both copies. The user saves the recovery code.
- **New device.** The user types the password. The device signs in with the login key, gets the password copy, and opens it. Nothing else to do.
- **New password, on a signed-in device.** Covers both "change it" and "forgot it". The device holds the data key. It makes a new password copy with the new password and sends it with the new login key. No file is re-encrypted. The old password is not asked: whoever holds the signed-in device already holds the data key.
- **Forgot password, recovery code saved.** The device signs in with the recovery login key, gets the recovery copy, opens it, then makes a new password copy.
- **Forgot password, nothing else.** The data cannot be opened. No email reset: a reset by email would mean the server holds the key.
## Protected against
- The operator, Cloudflare, and anyone with the server database or bucket access. They see encrypted bytes, random-looking ids, and locked copies.
- File names and contents are hidden.
- Not hidden: the number of files and their sizes, from the plaintext header and the blob sizes. A big file shows as a run of 16 MiB blobs.
## Not protected against
- **Weak passwords.** Someone who steals the bucket or the database can guess passwords offline. The slow hash makes each guess slow. The library refuses short passwords at sign-up. Sign-in is rate limited against guessing online.
- **A bad library update.** The operator ships the library. A bad version could send keys home. Same as every end-to-end product.
- **A stolen, signed-in device.** It holds the key. Logging it out stops its sync, not what it already has.
## What the operator is responsible for
- Keeping the R2 objects, including `<user>/key`. They are data, like the blobs.
- One plain sentence in the docs: "We cannot recover your password. Your other devices or your recovery code can."
- Nothing else. No master key, no key copies, no key backup.
## Data loss
- Data is lost only when the user has lost all three: the password, every signed-in device, and the recovery code.
- The library asks until the recovery code is saved.
- Phones and browsers sometimes clear their storage. They then ask for the password again and download the folder again. Nothing already synced is lost.
- Changes made offline and not yet uploaded are lost with it. To make this rare, the browser library asks the browser to keep its storage (`navigator.storage.persist()`). The browser may still say no. Safari may also clear a site's storage if the user has not clicked or tapped on the site in the last 7 days of Safari use. It is not documented whether `persist()` stops this.
## Account deletion
- The server deletes `<user>/key` first, then the files. See [Server](04-server.md).
- Each signed-in device deletes its copy of the data key when it learns the account is gone.
## Data export
- The command-line tool, the one that creates apps, also exports. It signs in, downloads, and decrypts a user's whole folder.
- Takes the password or the recovery code.
- This is the basis of the claim that users own their data.
## Order
- Password sign-in, the data key, both locked copies, and `<user>/key` land in implementation step 2, with signup.
- Blobs and index bodies are encrypted from the first upload, in step 3. There is no plaintext phase and no migration.
