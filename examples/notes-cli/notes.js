#!/usr/bin/env node
// notes: a command-line notebook that syncs between your computers.
// One Markdown file per note, in the folder "notes/".
//
//   notes add <text...>        add a note
//   notes list                 list notes, newest first
//   notes show <name>          print a note (a unique start of its name is enough)
//   notes sync                 sync now
//
// Options: --server <url> (or PAPPDRIVE_SERVER), --folder <dir> (or NOTES_FOLDER) to keep the
// notes in a real folder you can open; without it they live in a private store.
import { createPapp, SyncError } from "pappdrive"
import { homedir } from "node:os"

const APP = "notes" // created once with: pappdrive apps create notes

function option(name, envName) {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1) {
    const value = process.argv[i + 1]
    process.argv.splice(i, 2)
    return value
  }
  return process.env[envName]
}

const server = option("server", "PAPPDRIVE_SERVER")
const folder = option("folder", "NOTES_FOLDER")
const [command, ...args] = process.argv.slice(2)

const usage = `usage: notes [--server <url>] [--folder <dir>] <command>
  add <text...>   add a note
  list            list notes, newest first
  show <name>     print a note
  sync            sync now`

// Names like 2026-10-17-091530-buy-milk.md: sortable, unique per second, readable.
function newName(text) {
  const now = new Date()
  const pad = n => String(n).padStart(2, "0")
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return `notes/${stamp}${slug ? "-" + slug : ""}.md`
}

// Pull what other devices wrote, or push what we wrote. Offline is fine: the change is
// saved on this device and goes up on the next run.
async function trySync(files) {
  try {
    await files.sync()
    return true
  } catch (err) {
    if (err instanceof SyncError && (err.code === "network" || err.code === "server")) {
      console.error("(offline: saved on this computer, will sync next time)")
      return false
    }
    throw err
  }
}

// The folder "notes" exists only once it has a note in it.
async function listNotes(files) {
  try {
    return (await files.list("notes")).filter(f => !f.dir && f.path.endsWith(".md"))
  } catch (err) {
    if (err instanceof SyncError && err.code === "not-found") return []
    throw err
  }
}

async function main() {
  if (!command || command === "help" || command === "--help") {
    console.log(usage)
    return
  }
  if (!server) throw new Error("Set PAPPDRIVE_SERVER or pass --server <url>, e.g. https://sync.example.com")

  const papp = createPapp({ server, app: APP })
  await papp.ready
  if (!papp.signedIn) await papp.signInPrompt() // asks in the terminal, hides the password

  const files = folder
    ? await papp.open({ mode: "visible", path: folder.replace(/^~(?=\/|$)/, homedir()) })
    : await papp.open({ mode: "private" })

  switch (command) {
    case "add": {
      const text = args.join(" ").trim()
      if (!text) throw new Error("Nothing to add. Usage: notes add <text...>")
      const path = newName(text)
      await files.write(path, text + "\n")
      await trySync(files) // a CLI exits right away: send the change now
      console.log(path.slice("notes/".length))
      break
    }
    case "list": {
      await trySync(files)
      const notes = await listNotes(files)
      notes.sort((a, b) => b.path.localeCompare(a.path))
      // Conflict copies, like "2026-10-17-091530-x (conflict 2026-10-17 09-15-30).md", are listed like any note.
      for (const note of notes) {
        const first = (await files.readText(note.path)).split("\n")[0].slice(0, 60)
        console.log(`${note.path.slice("notes/".length).padEnd(48)}  ${first}`)
      }
      if (notes.length === 0) console.log("No notes yet. Add one: notes add <text>")
      break
    }
    case "show": {
      const name = args.join(" ")
      if (!name) throw new Error("Which note? Usage: notes show <name>")
      await trySync(files)
      const notes = (await listNotes(files)).map(f => f.path.slice("notes/".length))
      const matches = notes.includes(name) ? [name] : notes.filter(n => n.startsWith(name))
      if (matches.length === 0) throw new Error(`No note starts with "${name}". See: notes list`)
      if (matches.length > 1) throw new Error(`"${name}" matches ${matches.length} notes:\n  ${matches.join("\n  ")}`)
      process.stdout.write(await files.readText("notes/" + matches[0]))
      break
    }
    case "sync": {
      if (await trySync(files)) {
        const s = files.status
        console.log(`synced${s.pending ? `, ${s.pending} change(s) still waiting` : ""}${s.skipped.length ? `, skipped: ${s.skipped.join(", ")}` : ""}`)
      }
      break
    }
    default:
      throw new Error(`Unknown command "${command}".\n${usage}`)
  }
  return papp
}

main().then(
  async papp => {
    await papp?.close() // syncs what is pending and stops polling, so the process can end
    process.exit(0)
  },
  err => {
    if (err instanceof SyncError && err.code === "no-app") {
      console.error(`${err.message}\nCreate the app once with: pappdrive apps create ${APP}`)
    } else {
      console.error(err instanceof Error ? err.message : err)
    }
    process.exit(1)
  },
)
