// The window. No Node here: it talks to the main process through window.journal (preload.cjs).
// Bundled by esbuild (npm run build), because it imports "pappdrive/ui".
import { signInForm } from "pappdrive/ui"

const j = window.journal
const $ = id => document.getElementById(id)

// Main returns { ok, value } or { ok: false, error }. Turn errors back into thrown errors
// with their code, so the sign-in form shows the right message (wrong password, too many tries...).
async function unwrap(promise) {
  const result = await promise
  if (result.ok) return result.value
  const err = new Error(result.error.message)
  err.name = "SyncError"
  err.code = result.error.code
  if (result.error.retryAfter !== undefined) err.retryAfter = result.error.retryAfter
  if (result.error.reason !== undefined) err.reason = result.error.reason
  throw err
}

// The three functions the form needs, each running papp in the main process.
const account = {
  signUp: (email, password) => unwrap(j.signUp(email, password)),
  signIn: (email, password) => unwrap(j.signIn(email, password)),
  recover: (email, code, newPassword) => unwrap(j.recover(email, code, newPassword)),
}

// ---------- entries ----------

const today = () => new Date().toLocaleDateString("en-CA") + ".md" // 2026-10-17.md, local date
let current = null
let dirty = false
let saveTimer = null
let lastSaved = "" // the text of the current entry as last read or written

// A name is usually a date, but conflict copies and files made by other programs are not.
// Never assume the pattern: show what cannot be parsed as it is.
function label(name) {
  const base = name.slice(0, -3)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(base)
  if (!m) return base
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })
}

async function refreshList() {
  const entries = await unwrap(j.list())
  const list = $("entries")
  list.replaceChildren()
  const names = entries.map(e => e.path)
  if (current && !names.includes(current)) names.unshift(current) // today's entry before its first save
  for (const name of names) {
    const li = document.createElement("li")
    li.textContent = label(name)
    li.title = name
    if (name.includes("(conflict ")) li.classList.add("conflict")
    if (name === current) li.classList.add("current")
    li.onclick = () => select(name)
    list.append(li)
  }
}

async function select(name) {
  await saveNow()
  current = name
  $("title").textContent = label(name)
  lastSaved = await unwrap(j.read(name))
  $("editor").value = lastSaved
  dirty = false
  hideNotice()
  await refreshList()
}

async function saveNow() {
  clearTimeout(saveTimer)
  if (!current || !dirty) return
  dirty = false
  const text = $("editor").value
  lastSaved = text
  if (text === "") await unwrap(j.remove(current)).catch(() => {}) // empty day: no file
  else await unwrap(j.write(current, text))
}

$("editor").addEventListener("input", () => {
  dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveNow().catch(showError), 800)
})
$("editor").addEventListener("blur", () => saveNow().catch(showError))
$("today").onclick = () => select(today())
$("delete").onclick = async () => {
  if (!current || !confirm(`Delete ${current} on every computer?`)) return
  dirty = false
  await unwrap(j.remove(current)).catch(() => {})
  await select(today())
}
$("sync").onclick = () => unwrap(j.sync()).catch(showError)
$("signout").onclick = async () => {
  if (!confirm("Sign out? Keep your password or recovery code: you need one of them to sign in again.")) return
  await unwrap(j.signOut())
  location.reload()
}

// ---------- changes from the folder ----------

j.onChange(async change => {
  await refreshList()
  if (change.origin === "conflict") {
    showNotice(`"${change.path}" was edited on two computers. The other computer's version kept the name. Yours is now "${change.copy}".`)
  } else if (change.origin === "skipped") {
    showNotice(`"${change.path}" cannot be saved on this computer (bad name). The other computers keep it.`)
  }
  if (change.path !== current) return
  // The open entry changed: in another editor (visible folder), on another computer, or by our own save.
  const text = await unwrap(j.read(current))
  if (text === lastSaved || text === $("editor").value) return // our own save
  lastSaved = text
  if (!dirty) {
    $("editor").value = text
    return
  }
  showNotice("This day changed somewhere else while you were typing. Your text is kept.", "Load the other version", () => {
    dirty = false
    $("editor").value = text
    hideNotice()
  })
})

j.onStatus(renderStatus)

function renderStatus(s) {
  if (!s) return
  if (s.deleted) {
    // Deleted on another device or with the CLI. Signed out; ~/Journal stays on disk.
    alert(s.deleted === "account" ? "Your account was deleted. The files in ~/Journal stay on this computer." : "This journal was deleted on another computer. The files in ~/Journal stay on this computer.")
    location.reload()
    return
  }
  let text
  if (s.syncing) text = "Syncing…"
  else if (s.error) text = `Not synced: ${s.error}`
  else if (s.pending > 0) text = `${s.pending} change${s.pending === 1 ? "" : "s"} waiting`
  else if (s.lastSync) text = `Synced ${new Date(s.lastSync).toLocaleTimeString()}`
  else text = "Not synced yet"
  if (s.skipped.length) text += ` · ${s.skipped.length} skipped`
  $("status").textContent = text
}

function showNotice(text, action, onAction) {
  $("notice-text").textContent = text
  $("notice-action").hidden = !action
  if (action) {
    $("notice-action").textContent = action
    $("notice-action").onclick = onAction
  }
  $("notice").hidden = false
}
function hideNotice() {
  $("notice").hidden = true
}
function showError(err) {
  showNotice(String(err?.message ?? err))
}
$("notice-close").onclick = hideNotice

// ---------- start ----------

async function start() {
  if (!(await unwrap(j.signedIn()))) {
    $("sign-in-screen").hidden = false
    await signInForm($("sign-in"), account) // resolves once signed in; shows the recovery code at sign-up
    $("sign-in-screen").hidden = true
  }
  await unwrap(j.open())
  $("journal-screen").hidden = false
  renderStatus(await unwrap(j.status()))
  await select(today())
}

start().catch(showError)
