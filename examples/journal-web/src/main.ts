// A journal in the browser. Same app name and file layout as the Electron journal,
// so both show the same days. Browser: private mode only (the origin private file system).
import { createPapp, SyncError, type Change, type Files, type Status } from "pappdrive"
import { signInForm } from "pappdrive/ui"
import "./style.css"

const server = import.meta.env.VITE_PAPPDRIVE_SERVER as string | undefined
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const editor = $<HTMLTextAreaElement>("editor")

if (!server) throw new Error("Set VITE_PAPPDRIVE_SERVER in .env, e.g. https://sync.example.com")

const papp = createPapp({ server, app: "journal" }) // created once with: pappdrive apps create journal
let files: Files

// ---------- entries: one Markdown file per day ----------

const today = () => new Date().toLocaleDateString("en-CA") + ".md" // 2026-10-17.md, local date
let current: string | null = null
let dirty = false
let lastSaved = "" // the current entry's text as last read or written
let saveTimer: ReturnType<typeof setTimeout> | undefined

// Usually a date. Conflict copies, like "2026-10-17 (conflict 2026-10-17 09-15-30).md", are not:
// show them by their name instead of breaking.
function label(name: string): string {
  const base = name.slice(0, -3)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(base)
  if (!m) return base
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })
}

async function readEntry(name: string): Promise<string> {
  try {
    return await files.readText(name)
  } catch (err) {
    if (err instanceof SyncError && err.code === "not-found") return "" // a new day, or deleted elsewhere
    throw err
  }
}

async function refreshList() {
  const entries = (await files.list()).filter(e => !e.dir && e.path.endsWith(".md"))
  const names = entries.map(e => e.path).sort((a, b) => b.localeCompare(a))
  if (current && !names.includes(current)) names.unshift(current) // today's entry before its first save
  const list = $("entries")
  list.replaceChildren()
  for (const name of names) {
    const li = document.createElement("li")
    li.textContent = label(name)
    li.title = name
    if (name.includes("(conflict ")) li.classList.add("conflict")
    if (name === current) li.classList.add("current")
    li.onclick = () => void select(name).catch(showError)
    list.append(li)
  }
}

async function select(name: string) {
  await saveNow()
  current = name
  $("title").textContent = label(name)
  lastSaved = await readEntry(name)
  editor.value = lastSaved
  dirty = false
  hideNotice()
  await refreshList()
}

async function saveNow() {
  clearTimeout(saveTimer)
  if (!current || !dirty) return
  dirty = false
  const text = editor.value
  lastSaved = text
  if (text === "") await files.remove(current).catch(() => {}) // an empty day has no file
  else await files.write(current, text)
}

editor.addEventListener("input", () => {
  dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveNow().catch(showError), 800)
})
editor.addEventListener("blur", () => void saveNow().catch(showError))
// Leaving the page: save now. The library then syncs at once, while the tab is still open.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void saveNow().catch(() => {})
})

$("today").onclick = () => void select(today()).catch(showError)
$("delete").onclick = async () => {
  if (!current || !confirm(`Delete ${current} on every device?`)) return
  dirty = false
  await files.remove(current).catch(() => {})
  await select(today())
}
$("sync").onclick = () => void files.sync().catch(showError)
$("signout").onclick = async () => {
  if (!confirm("Sign out? Keep your password or recovery code: you need one of them to sign in again.")) return
  await saveNow()
  await papp.signOut()
  location.reload()
}

// ---------- changes and status ----------

async function onChange(change: Change) {
  await refreshList()
  if (change.origin === "conflict") {
    showNotice(`"${change.path}" was edited on two devices. The other device's version kept the name. This one's is now "${change.copy}".`)
  } else if (change.origin === "skipped") {
    showNotice(`"${change.path}" cannot be saved on this device (bad name). Your other devices keep it.`)
  }
  if (change.path !== current) return
  const text = await readEntry(current)
  if (text === lastSaved || text === editor.value) return // our own save
  lastSaved = text
  if (!dirty) {
    editor.value = text
    return
  }
  showNotice("This day changed on another device while you were typing. Your text is kept.", "Load the other version", () => {
    dirty = false
    editor.value = text
    hideNotice()
  })
}

function renderStatus(s: Status) {
  if (s.deleted) {
    // The journal or the account was deleted elsewhere. Sync stopped, signed out,
    // and the private folder on this device is gone. Start again at the sign-in form.
    alert(s.deleted === "account" ? "Your account was deleted." : "This journal was deleted on another device.")
    location.reload()
    return
  }
  let text: string
  if (s.syncing) text = "Syncing…"
  else if (s.error) text = `Not synced: ${s.error}`
  else if (s.pending > 0) text = `${s.pending} change${s.pending === 1 ? "" : "s"} waiting`
  else if (s.lastSync) text = `Synced ${new Date(s.lastSync).toLocaleTimeString()}`
  else text = "Not synced yet"
  if (s.skipped.length) text += ` · ${s.skipped.length} skipped`
  $("status").textContent = text
}

// ---------- notices ----------

function showNotice(text: string, action?: string, onAction?: () => void) {
  $("notice-text").textContent = text
  const button = $<HTMLButtonElement>("notice-action")
  button.hidden = !action
  if (action) {
    button.textContent = action
    button.onclick = () => onAction?.()
  }
  $("notice").hidden = false
}
function hideNotice() {
  $("notice").hidden = true
}
function showError(err: unknown) {
  showNotice(err instanceof Error ? err.message : String(err))
}
$("notice-close").onclick = hideNotice

// ---------- start ----------

async function start() {
  await papp.ready
  if (!papp.signedIn) {
    $("sign-in-screen").hidden = false
    await signInForm($("sign-in"), papp) // resolves once signed in; shows the recovery code at sign-up
    $("sign-in-screen").hidden = true
  }
  files = await papp.open({ mode: "private" })
  files.watch(change => void onChange(change).catch(showError))
  files.onStatus(renderStatus)
  $("journal-screen").hidden = false
  renderStatus(files.status)
  await select(today())
}

start().catch(showError)
