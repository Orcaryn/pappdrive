// The node Platform: Node, Electron's main process, command-line tools.
// See types.ts (Platform) and spec 05-client.md, Folder modes and Read-only folders.
import { homedir } from "node:os"
import * as fsp from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { HIDDEN_DIR } from "../core/paths.js"
import { SyncError } from "../core/errors.js"
import type { FsAdapter, Platform } from "../core/types.js"
import { openNodeFs } from "./fs.js"
import { nodeKeyStore } from "./keystore.js"
import { signInPrompt } from "./prompt.js"
import { nodeWatcher } from "./watcher.js"

/**
 * Where private stores live. PAPPDRIVE_DATA_DIR overrides it (tests, portable installs).
 * macOS ~/Library/Application Support/pappdrive, Linux $XDG_DATA_HOME/pappdrive or ~/.local/share/pappdrive,
 * Windows %LOCALAPPDATA%\pappdrive.
 */
export function dataDir(): string {
  const env = process.env
  if (env.PAPPDRIVE_DATA_DIR) return resolve(env.PAPPDRIVE_DATA_DIR)
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "pappdrive")
  if (process.platform === "win32") return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "pappdrive")
  const xdg = env.XDG_DATA_HOME
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share"), "pappdrive")
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/

function checkSegment(what: string, value: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new SyncError("bad-path", `The ${what} "${value}" cannot be used as a folder name. This is a bug in pappdrive; please report it.`)
  }
  return value
}

/**
 * The app's own store: <data>/<user>/<app>/.
 * A read-only mirror of another app's folder: <data>/<user>/<app>.read/<other>/.
 * App names have no ".", so "<app>.read" can never be another app's own store, and the mirror
 * is next to the own store but never inside its synced files.
 */
export function privateStorePath(userId: string, app: string, readFor?: string): string {
  const base = join(dataDir(), checkSegment("user id", userId))
  const own = checkSegment("app name", app)
  return readFor === undefined ? join(base, own) : join(base, `${own}.read`, checkSegment("app name", readFor))
}

/** Expands a leading "~" to the home folder and makes the path absolute. */
export function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2))
  return resolve(path)
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** The nearest folder above `abs` that holds a hidden folder, or null. */
export async function folderAbove(abs: string): Promise<string | null> {
  for (let d = dirname(abs); ; d = dirname(d)) {
    if (await isDir(join(d, HIDDEN_DIR))) return d
    if (dirname(d) === d) return null
  }
}

export async function openVisibleFolder(path: string): Promise<FsAdapter> {
  const abs = expandHome(path)
  const above = await folderAbove(abs)
  if (above !== null) {
    throw new SyncError(
      "folder-taken",
      `"${abs}" is inside "${above}", which is already a synced app folder (it has a ${HIDDEN_DIR}/ folder). ` +
        `Two apps syncing the same files would never agree. Open a folder outside "${above}". ` +
        `To use that app's files, open them read-only with papp.openReadOnly("<that app>").`,
    )
  }
  try {
    await fsp.mkdir(abs, { recursive: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST" || (e as NodeJS.ErrnoException).code === "ENOTDIR") {
      throw new SyncError("bad-path", `"${abs}" is a file, not a folder. Give open() a folder path.`)
    }
    throw e
  }
  if (!(await isDir(abs))) throw new SyncError("bad-path", `"${abs}" is a file, not a folder. Give open() a folder path.`)
  return openNodeFs(abs, "visible")
}

// ---------- Background and exit ----------

/** How long exit waits for the callbacks (and any promise they return) before going ahead. */
export const EXIT_WAIT_MS = 10_000
const callbacks = new Set<() => void>()
let exiting = false
let ranBeforeExit = false

function runAll(): Promise<unknown> {
  const results = [...callbacks].map((cb) => {
    try {
      return Promise.resolve((cb as () => unknown)())
    } catch (e) {
      return Promise.reject(e)
    }
  })
  const timeout = new Promise((r) => setTimeout(r, EXIT_WAIT_MS).unref())
  return Promise.race([Promise.allSettled(results), timeout])
}

function onSignal(signal: NodeJS.Signals) {
  if (exiting) {
    // A second Ctrl-C: leave at once.
    process.exit(signal === "SIGINT" ? 130 : 143)
  }
  exiting = true
  void runAll().finally(() => {
    process.removeListener(signal, onSignal)
    // Somebody else also listens: they decide when to exit. Otherwise exit the way the signal would.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
  })
}

function onBeforeExit() {
  // Only once: a callback that starts work keeps the process alive, and beforeExit fires again after it.
  if (ranBeforeExit) return
  ranBeforeExit = true
  void runAll()
}

const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"]

/**
 * Calls cb when the process is about to end: the event loop ran dry, or SIGINT / SIGTERM.
 * If cb returns a promise, exit waits for it, up to EXIT_WAIT_MS. A second Ctrl-C exits at once.
 */
export function onProcessEnd(cb: () => void): () => void {
  if (callbacks.size === 0) {
    process.on("beforeExit", onBeforeExit)
    for (const s of SIGNALS) process.on(s, onSignal)
  }
  callbacks.add(cb)
  return () => {
    callbacks.delete(cb)
    if (callbacks.size === 0) {
      process.removeListener("beforeExit", onBeforeExit)
      for (const s of SIGNALS) process.removeListener(s, onSignal)
    }
  }
}

export const nodePlatform: Platform = {
  name: "node",
  defaultKeyStore: () => nodeKeyStore(),
  openPrivate: async (userId, app, readFor) => openNodeFs(privateStorePath(userId, app, readFor), "private"),
  openVisible: openVisibleFolder,
  watcher: nodeWatcher,
  onBackground: onProcessEnd,
  signInPrompt: (papp) => signInPrompt(papp),
}
