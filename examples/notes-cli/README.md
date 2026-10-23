# notes (command line)

A notebook in the terminal that syncs between your computers. Each note is one Markdown file in `notes/`, named by time and first words: `2026-10-17-091530-buy-milk.md`.

## Run

```sh
npm install
npx pappdrive signup        # first time only; or: npx pappdrive login
npx pappdrive apps create notes

npm link                    # puts "notes" on your PATH; or run: node notes.js ...

notes add buy milk and bread
notes list
notes show 2026-10-17-0915
notes sync
```

The first command asks for the email and password from `pappdrive signup` and calls `papp.signIn`. After that, the computer remembers the sign-in.

## Private or visible

- Default: a private store the library owns. Nothing to see on disk.
- `--folder ~/Notes` (or `NOTES_FOLDER=~/Notes`): a real folder. Open it in any editor; edits sync on the next `notes` command. Pick one and keep it: the two modes are two separate copies on this computer, and both sync with the same server folder.

## Points to copy

- `if (!papp.signedIn) await signIn(papp)` before `open`. The app asks for the email and password itself; the password is not echoed. New accounts come from `pappdrive signup`, which shows the recovery code.
- A command-line tool is short-lived, so it calls `await files.sync()` itself: before reading (to get other devices' notes) and after writing (to send its own). It ends with `await papp.close()`, which syncs what is pending and stops polling.
- Offline is not an error: `network` and `server` codes are reported and the note stays on this computer until the next run.
- `no-app` gets the command that fixes it.
- Conflict copies (`... (conflict 2026-10-17 09-15-30).md`) are listed and shown like any note.
