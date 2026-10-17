// Electron main process. papp lives here, with the node adapter:
// a visible folder ~/Journal that the user can open in Finder or any editor.
// The window only shows the UI and calls these functions over IPC (see preload.cjs).
import { app, BrowserWindow, ipcMain } from "electron"
import { createPapp } from "pappdrive"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { safeStorageKeyStore, canUseSafeStorage } from "./keystore.js"

const here = dirname(fileURLToPath(import.meta.url))
const SERVER = process.env.PAPPDRIVE_SERVER // e.g. https://sync.example.com
const APP = "journal" // created once with: pappdrive apps create journal

let papp
let win
let files = null // set after open
let stopWatch = () => {}
let stopStatus = () => {}

// Journal entries: one Markdown file per day at the top of the folder, like 2026-10-17.md.
// Only plain names ending in .md, so the window cannot reach other paths.
function checkName(name) {
  if (typeof name !== "string" || !name.endsWith(".md") || name.includes("/") || name.startsWith(".")) {
    throw Object.assign(new Error(`bad-path: "${name}" is not a journal entry. Use a name like 2026-10-17.md.`), { code: "bad-path" })
  }
  return name
}

async function openJournal() {
  if (files) return
  files = await papp.open({ mode: "visible", path: join(app.getPath("home"), "Journal") })
  // A conflict copy is created by the library. Nothing else in this folder needs ignoring,
  // but a .pappignore is the place for caches and logs if the app ever makes any.
  stopWatch = files.watch(change => win?.webContents.send("journal:change", change))
  stopStatus = files.onStatus(status => {
    win?.webContents.send("journal:status", status)
    if (status.deleted) {
      // The folder or the account was deleted on another device. Sync has stopped and this
      // device is signed out. The files in ~/Journal stay. The window shows the sign-in form again.
      stopWatch()
      stopStatus()
      files = null
    }
  })
  win?.webContents.send("journal:status", files.status)
}

// Every handler returns { ok, value } or { ok: false, error }, so the error's code and
// retryAfter survive IPC. (Electron would keep only the message of a thrown error.)
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      return {
        ok: false,
        error: { code: err?.code ?? "unknown", message: String(err?.message ?? err), retryAfter: err?.retryAfter, reason: err?.reason },
      }
    }
  })
}

// Account: the sign-in form in the window calls these three.
handle("auth:signUp", (email, password) => papp.signUp(email, password)) // returns { recoveryCode }
handle("auth:signIn", (email, password) => papp.signIn(email, password))
handle("auth:recover", (email, code, newPassword) => papp.recover(email, code, newPassword))
handle("auth:signOut", async () => {
  stopWatch()
  stopStatus()
  files = null
  await papp.signOut()
})

// Journal.
handle("journal:signedIn", () => papp.signedIn)
handle("journal:open", () => openJournal())
handle("journal:list", async () => {
  const entries = await files.list()
  // Conflict copies, like "2026-10-17 (conflict 2026-10-17 09-15-30).md", are listed like any entry.
  return entries.filter(e => !e.dir && e.path.endsWith(".md")).sort((a, b) => b.path.localeCompare(a.path))
})
handle("journal:read", async name => {
  try {
    return await files.readText(checkName(name))
  } catch (err) {
    if (err?.code === "not-found") return "" // a new day, or deleted on another device
    throw err
  }
})
handle("journal:write", (name, text) => files.write(checkName(name), text))
handle("journal:remove", name => files.remove(checkName(name)))
handle("journal:sync", () => files.sync())
handle("journal:status", () => files?.status ?? null)

async function main() {
  await app.whenReady()
  if (!SERVER) throw new Error("Set PAPPDRIVE_SERVER to your Pappdrive server, e.g. https://sync.example.com")

  papp = createPapp({
    server: SERVER,
    app: APP,
    // Optional. Without it, the data key goes to the system keychain. Switching later means one new sign-in.
    keyStore: canUseSafeStorage() ? safeStorageKeyStore() : undefined,
  })
  await papp.ready
  if (papp.signedIn) await openJournal()

  win = new BrowserWindow({
    width: 960,
    height: 680,
    title: "Journal",
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true },
  })
  await win.loadFile(join(here, "index.html"))
}

// Send pending changes before quitting, so the other computer gets them.
let quitting = false
app.on("before-quit", event => {
  if (quitting || !files) return
  event.preventDefault()
  quitting = true
  const timeout = new Promise(resolve => setTimeout(resolve, 5000))
  Promise.race([files.sync().catch(() => {}), timeout]).finally(() => app.quit())
})
app.on("window-all-closed", () => app.quit())

main().catch(err => {
  console.error(err)
  app.exit(1)
})
