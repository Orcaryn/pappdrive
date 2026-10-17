// One open folder: the Files API, scheduling, the watcher and the browser tab lock.
// The account layer calls openFolder(ctx), then `await folder.start()`. See spec 05-client.md and 06-sync.md.
import type { GoneReason, IndexEntry } from "@pappdrive/protocol"
import { concat, fromUtf8, toHex, utf8 } from "./bytes.js"
import { blobId, randomBytes } from "./crypto.js"
import { SyncError } from "./errors.js"
import { IGNORE_FILE } from "./ignore.js"
import { baseName, checkPath, HIDDEN_DIR, parentOf, pathKey } from "./paths.js"
import { entryFromParts, joinPath, readAll } from "./scan.js"
import { DEFAULT_TUNING, SyncEngine, type Tuning } from "./sync.js"
import type { Change, Coordinator, CoordinatorMessage, FileInfo, Folder, FolderContext, Status, WriteData } from "./types.js"

export { DEFAULT_TUNING, type Tuning } from "./sync.js"

const READ_CHUNK = 1024 * 1024
const ROUND_TRIES = 8

/**
 * Opens a folder for syncing. Nothing runs until `start()`.
 * `tuning` is for tests only (smaller parts, no polling); apps never pass it.
 */
export function openFolder(ctx: FolderContext, tuning?: Partial<Tuning>): Folder {
  return new FolderImpl(ctx, { ...DEFAULT_TUNING, ...tuning })
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function notFound(path: string): SyncError {
  return new SyncError("not-found", `"${path}" does not exist. Check the path with files.list(), or write it first.`)
}

class FolderImpl implements Folder {
  readonly readOnly: boolean
  private readonly engine: SyncEngine
  private readonly t: Tuning
  private st: Status = { syncing: false, lastSync: null, pending: 0, skipped: [], deleted: null, error: null }
  private watchCbs = new Set<(c: Change) => void>()
  private statusCbs = new Set<(s: Status) => void>()

  private started = false
  private closed = false
  private halted = false // unknown index version: no more rounds
  private leader = false
  private coord: Coordinator | undefined
  private unsubCoord: (() => void) | undefined
  private recentWrites = new Map<string, number>() // follower: paths it wrote, to skip the leader's echo

  // Rounds and watcher processing run one at a time.
  private mutex: Promise<void> = Promise.resolve()
  private queued: { local: boolean; promise: Promise<void>; resolve: () => void } | null = null
  private pumping: Promise<void> | null = null

  // Timers
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private debounceFirst: number | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private statusTimer: ReturnType<typeof setTimeout> | undefined
  private unBackground: (() => void) | undefined

  // Watcher
  private stopWatcher: (() => Promise<void>) | undefined
  private watchGlobs = ""
  private watchPending = new Set<string>()
  private watchFirst: number | null = null
  private watchTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly ctx: FolderContext,
    tuning: Tuning,
  ) {
    this.readOnly = ctx.readOnly
    this.t = tuning
    this.engine = new SyncEngine(ctx, tuning, (c) => this.fire(c))
  }

  private get fs() {
    return this.ctx.fs
  }
  private get stopped() {
    return this.closed || this.st.deleted !== null
  }

  // ======================= Lifecycle =======================

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const make = this.ctx.platform.coordinator
    if (!make) return this.becomeLeader()
    const coord = make.call(this.ctx.platform, `pappdrive:${this.ctx.app}${this.readOnly ? ":read" : ""}`)
    this.coord = coord
    this.unsubCoord = coord.onMessage((m) => this.onCoordMessage(m))
    const lead = coord.waitForLead().then(() => true)
    const now = await Promise.race([lead, new Promise<boolean>((r) => setTimeout(() => r(false), 50))])
    if (now || coord.isLeader()) return this.becomeLeader()
    // A follower until the leading tab closes.
    lead.then(
      () => {
        if (!this.stopped) this.becomeLeader().catch((e) => this.setError(e))
      },
      () => {},
    )
  }

  private async becomeLeader(): Promise<void> {
    const { state } = this.engine
    const app = await state.loadApp()
    if (app !== null && app !== this.ctx.app) {
      throw new SyncError(
        "folder-taken",
        `This folder belongs to the app "${app}". Two apps cannot sync the same files. ` +
          `Open another folder for "${this.ctx.app}", or open "${app}"'s folder read-only with papp.openReadOnly("${app}").`,
      )
    }
    await state.load()
    if (!this.coord) await this.engine.cleanWriteTemps()
    await this.engine.fullScan()
    if (app === null) await state.saveApp(this.ctx.app)
    await state.flush()
    if (this.stopped) return
    this.leader = true
    this.updateStatusNow()
    await this.startWatcher()
    if (this.t.pollMs > 0) {
      this.pollTimer = setInterval(() => this.poll(), this.t.pollMs)
      ;(this.pollTimer as { unref?: () => void }).unref?.()
    }
    this.unBackground = this.ctx.platform.onBackground?.(() => this.flushDebounce())
    void this.requestRound(true)
  }

  async close(): Promise<void> {
    if (this.closed) return
    const wasDeleted = this.st.deleted !== null
    this.closed = true
    this.engine.stopped = true
    this.stopTimers()
    await this.stopWatcherNow()
    await this.pumping?.catch(() => {})
    if (this.leader && !wasDeleted) await this.engine.state.flush().catch(() => {})
    this.unsubCoord?.()
    this.coord?.close()
  }

  async markDeleted(reason: GoneReason): Promise<void> {
    if (this.st.deleted) return
    this.st.deleted = reason
    this.engine.stopped = true
    this.stopTimers()
    await this.stopWatcherNow()
    try {
      await this.fs.destroy()
    } catch {
      // nothing left to do; the folder is gone either way
    }
    this.st.syncing = false
    this.st.pending = 0
    this.notify()
    this.unsubCoord?.()
    this.coord?.close()
  }

  private stopTimers(): void {
    clearInterval(this.pollTimer)
    clearTimeout(this.debounceTimer)
    clearTimeout(this.saveTimer)
    clearTimeout(this.statusTimer)
    clearTimeout(this.watchTimer)
    this.unBackground?.()
    this.unBackground = undefined
  }

  private assertOpen(): void {
    if (this.st.deleted) {
      const what = this.st.deleted === "account" ? "The account was deleted" : "This app's folder was deleted"
      throw new SyncError("gone", `${what}, so this device stopped syncing and signed out. Sign up or sign in again to start a new, empty folder.`, {
        reason: this.st.deleted,
      })
    }
    if (this.closed) throw new SyncError("signed-out", "This folder was closed (sign-out or close). Sign in and open it again with papp.open().")
  }

  // ======================= Scheduling =======================

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutex.then(fn)
    this.mutex = run.then(
      () => {},
      () => {},
    )
    return run
  }

  /** Runs a round soon. Resolves when a round that started after this call has finished. */
  private requestRound(local: boolean): Promise<void> {
    if (this.stopped || this.halted || !this.leader) return Promise.resolve()
    if (this.queued) {
      this.queued.local ||= local
      return this.queued.promise
    }
    let resolve!: () => void
    const promise = new Promise<void>((r) => (resolve = r))
    this.queued = { local, promise, resolve }
    if (!this.pumping) this.pumping = this.pump().finally(() => (this.pumping = null))
    return promise
  }

  private async pump(): Promise<void> {
    while (this.queued) {
      const q = this.queued
      this.queued = null
      try {
        if (!this.stopped && !this.halted) await this.exclusive(() => this.doRound(q.local))
      } finally {
        q.resolve()
      }
    }
  }

  private async doRound(local: boolean): Promise<void> {
    this.st.syncing = true
    this.notify()
    try {
      let result = "stale"
      for (let i = 0; i < ROUND_TRIES && result === "stale"; i++) result = await this.engine.round(local && !this.readOnly)
      if (result === "stopped" || this.stopped) return
      if (result === "stale") {
        throw new SyncError("server", "Other devices kept committing first, so this device's changes wait. The next sync tries again.")
      }
      this.st.lastSync = this.t.now()
      this.st.error = this.engine.downloadError ? message(this.engine.downloadError) : null
    } catch (e) {
      if (this.stopped) return
      this.st.error = message(e)
      if (e instanceof SyncError && e.code === "update-needed") this.halted = true
    } finally {
      if (!this.st.deleted) {
        this.st.syncing = false
        this.st.pending = this.engine.countPending()
        this.st.skipped = [...this.engine.skippedPaths]
        this.notify()
      }
    }
    if (!this.stopped) await this.restartWatcherIfNeeded()
  }

  private poll(): void {
    // While the debounce waits, a polling round only applies changes from the server.
    void this.requestRound(this.debounceFirst === null)
  }

  /** A local change: sync after 2 s of quiet, but never more than 10 s after the first change. */
  private scheduleDebounce(): void {
    if (this.stopped) return
    const now = this.t.now()
    if (this.debounceFirst === null) this.debounceFirst = now
    clearTimeout(this.debounceTimer)
    const wait = Math.max(0, Math.min(this.t.quietMs, this.debounceFirst + this.t.maxWaitMs - now))
    this.debounceTimer = setTimeout(() => this.flushDebounce(), wait)
  }

  /** Ends the debounce at once (also when the app goes to the background) and syncs. */
  private flushDebounce(): Promise<void> {
    clearTimeout(this.debounceTimer)
    this.debounceTimer = undefined
    this.debounceFirst = null
    return this.requestRound(true)
  }

  private scheduleSave(): void {
    if (this.saveTimer || !this.leader) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      if (!this.stopped) this.engine.state.flush().catch((e) => this.setError(e))
    }, 1000)
  }

  private scheduleStatus(): void {
    if (this.statusTimer) return
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined
      if (!this.stopped) this.updateStatusNow()
    }, 20)
  }

  private updateStatusNow(): void {
    this.st.pending = this.engine.countPending()
    this.st.skipped = [...this.engine.skippedPaths]
    this.notify()
  }

  private setError(e: unknown): void {
    if (this.stopped) return
    this.st.error = message(e)
    this.notify()
  }

  // ======================= Watcher (visible folders) =======================

  private async startWatcher(): Promise<void> {
    const w = this.ctx.platform.watcher
    if (!w || this.fs.kind !== "visible" || this.readOnly || this.stopped) return
    const globs = this.engine.rules.watcherSkipGlobs()
    this.watchGlobs = JSON.stringify(globs)
    this.stopWatcher = await w.start(
      this.fs,
      globs,
      (paths) => this.onWatchPaths(paths),
      () => this.onWatchDropped(),
    )
  }

  private async stopWatcherNow(): Promise<void> {
    const stop = this.stopWatcher
    this.stopWatcher = undefined
    if (stop) await stop().catch(() => {})
  }

  private async restartWatcherIfNeeded(): Promise<void> {
    if (!this.stopWatcher) return
    if (JSON.stringify(this.engine.rules.watcherSkipGlobs()) === this.watchGlobs) return
    await this.stopWatcherNow()
    await this.startWatcher().catch((e) => this.setError(e))
  }

  /** Events are hints. Wait for quiet (2 s, at most 10 s), then look at each file. */
  private onWatchPaths(paths: string[]): void {
    if (this.stopped) return
    for (const p of paths) this.watchPending.add(p)
    const now = this.t.now()
    if (this.watchFirst === null) this.watchFirst = now
    clearTimeout(this.watchTimer)
    const wait = Math.max(0, Math.min(this.t.watchQuietMs, this.watchFirst + this.t.watchMaxMs - now))
    this.watchTimer = setTimeout(() => void this.processWatch(), wait)
  }

  private async processWatch(): Promise<void> {
    const paths = [...this.watchPending]
    this.watchPending.clear()
    this.watchFirst = null
    if (paths.length === 0 || this.stopped) return
    try {
      await this.exclusive(async () => {
        if (this.stopped) return
        const { changed, changing } = await this.engine.processPaths(paths)
        this.localChanged(changed)
        if (changing.length) this.onWatchPaths(changing) // still being written: wait for quiet again
        if (this.engine.needsFullScan || this.engine.rulesDirty) this.scheduleDebounce()
      })
    } catch (e) {
      this.setError(e)
    }
  }

  /** The watcher failed or dropped events: scan the whole folder. Only changed files are hashed. */
  private onWatchDropped(): void {
    if (this.stopped) return
    this.exclusive(async () => {
      if (this.stopped) return
      this.localChanged(await this.engine.fullScan())
    }).catch((e) => this.setError(e))
  }

  /** Fires `local` for changed paths (ignored ones fire nothing) and starts the debounce. */
  private localChanged(paths: string[]): void {
    let any = false
    for (const p of paths) {
      if (this.engine.isIgnored(p)) continue
      any = true
      this.fire({ path: p, origin: "local" })
    }
    if (any) {
      this.scheduleDebounce()
      this.scheduleSave()
      this.scheduleStatus()
    }
  }

  // ======================= Tabs (browser) =======================

  private onCoordMessage(m: CoordinatorMessage): void {
    if (this.stopped) return
    if (this.leader) {
      if (m.type !== "local-change") return
      if (m.paths.length === 0) {
        void this.flushDebounce()
        return
      }
      this.exclusive(async () => {
        if (this.stopped) return
        this.localChanged((await this.engine.processPaths(m.paths)).changed)
      }).catch((e) => this.setError(e))
      return
    }
    if (m.type === "change") {
      const c = m.change
      const wrote = this.recentWrites.get(c.path)
      if (c.origin === "local" && wrote !== undefined && this.t.now() - wrote < 10_000) return
      this.deliver(c)
    } else if (m.type === "status") {
      this.st = { ...m.status, skipped: [...m.status.skipped] }
      for (const cb of this.statusCbs) safe(() => cb(this.status))
    }
  }

  // ======================= Events =======================

  private fire(change: Change): void {
    this.deliver(change)
    if (this.leader) this.coord?.post({ type: "change", change })
  }

  private deliver(change: Change): void {
    for (const cb of this.watchCbs) safe(() => cb({ ...change }))
  }

  private notify(): void {
    const s = this.status
    for (const cb of this.statusCbs) safe(() => cb(s))
    if (this.leader) this.coord?.post({ type: "status", status: s })
  }

  // ======================= Files =======================

  get status(): Status {
    return { ...this.st, skipped: [...this.st.skipped] }
  }

  watch(cb: (change: Change) => void): () => void {
    this.watchCbs.add(cb)
    return () => void this.watchCbs.delete(cb)
  }

  onStatus(cb: (status: Status) => void): () => void {
    this.statusCbs.add(cb)
    return () => void this.statusCbs.delete(cb)
  }

  async sync(): Promise<void> {
    if (this.st.deleted) return
    this.assertOpen()
    if (this.leader) return this.flushDebounce()
    if (!this.coord) return
    // A follower tab: ask the leader, and wait for its next finished round.
    const coord = this.coord
    await new Promise<void>((resolve) => {
      let sawSyncing = false
      const timer = setTimeout(done, 30_000)
      const off = coord.onMessage((m) => {
        if (m.type !== "status") return
        if (m.status.syncing) sawSyncing = true
        else if (sawSyncing) done()
      })
      function done() {
        clearTimeout(timer)
        off()
        resolve()
      }
      coord.post({ type: "local-change", paths: [] })
    })
  }

  async write(path: string, data: WriteData): Promise<void> {
    this.assertOpen()
    if (this.readOnly) throw this.readOnlyError("write")
    const p = checkPath(path)
    if (p.split("/").some((s) => s.toLowerCase() === HIDDEN_DIR)) {
      throw new SyncError("bad-path", `"${path}" has a folder named ${HIDDEN_DIR}, the library's hidden folder. Use another name.`)
    }
    await this.checkNames(p)
    const temp = `w-${toHex(randomBytes(8))}`
    this.engine.activeTemps.add(temp)
    let ignored = false
    try {
      const entry = await this.streamToTemp(temp, data)
      const key = pathKey(p)
      await this.engine.withLock(key, async () => {
        const st = await this.fs.moveTempInto(temp, p)
        if (!this.leader) return
        ignored = this.engine.isIgnored(p)
        if (ignored) this.engine.state.deleteDisk(key) // an ignored file stays on this device only
        else this.engine.state.setDisk({ path: p, entry: { ...entry, size: st.size, mtime: st.mtime } })
      })
    } catch (e) {
      await this.fs.tempRemove(temp).catch(() => {})
      throw e
    } finally {
      this.engine.activeTemps.delete(temp)
    }
    // A new .pappignore applies at once; files it now hides drop out at the next round's scan.
    if (this.leader && baseName(p).toLowerCase() === IGNORE_FILE) await this.engine.refreshRules()
    if (!ignored) this.afterLocalChange(p)
  }

  async read(path: string): Promise<Uint8Array> {
    this.assertOpen()
    const p = checkPath(path)
    const st = await this.fs.stat(p)
    if (!st) throw notFound(path)
    return readAll(this.fs, p, st.size, 16 * READ_CHUNK)
  }

  async readText(path: string): Promise<string> {
    return fromUtf8.decode(await this.read(path))
  }

  readStream(path: string): ReadableStream<Uint8Array> {
    this.assertOpen()
    const p = checkPath(path)
    const fs = this.fs
    let off = 0
    let size: number | null = null
    return new ReadableStream<Uint8Array>({
      async pull(c) {
        if (size === null) {
          const st = await fs.stat(p)
          if (!st) {
            c.error(notFound(path))
            return
          }
          size = st.size
        }
        if (off >= size) {
          c.close()
          return
        }
        const data = await fs.read(p, off, Math.min(READ_CHUNK, size - off))
        if (data.length === 0) {
          c.close()
          return
        }
        off += data.length
        c.enqueue(data)
      },
    })
  }

  async list(dir?: string): Promise<FileInfo[]> {
    this.assertOpen()
    const d = dir === undefined || dir === "" || dir === "/" ? "" : checkPath(dir.replace(/\/+$/, ""))
    const out: FileInfo[] = []
    for (const e of await this.fs.list(d)) {
      const name = e.name.normalize("NFC")
      if (d === "" && name.toLowerCase() === HIDDEN_DIR) continue
      const path = joinPath(d, name)
      if (e.dir) {
        if (await this.hasFiles(path)) out.push({ path, size: 0, mtime: 0, dir: true })
      } else {
        const st = await this.fs.stat(path)
        if (st) out.push({ path, size: st.size, mtime: st.mtime, dir: false })
      }
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  async remove(path: string): Promise<void> {
    this.assertOpen()
    if (this.readOnly) throw this.readOnlyError("remove")
    const p = checkPath(path)
    if (!(await this.fs.stat(p))) {
      throw new SyncError("not-found", `"${path}" does not exist, so there is nothing to remove. List files with files.list(); a folder goes away once its files are removed.`)
    }
    const key = pathKey(p)
    const ignored = this.leader && this.engine.isIgnored(p)
    await this.engine.withLock(key, async () => {
      await this.fs.remove(p)
      if (this.leader) this.engine.state.deleteDisk(key)
      if (parentOf(p) !== "") await this.fs.removeEmptyDirs(parentOf(p))
    })
    if (!ignored) this.afterLocalChange(p)
  }

  private afterLocalChange(p: string): void {
    if (this.leader) {
      this.fire({ path: p, origin: "local" })
      this.scheduleDebounce()
      this.scheduleSave()
      this.scheduleStatus()
      return
    }
    this.recentWrites.set(p, this.t.now())
    this.deliver({ path: p, origin: "local" })
    this.coord?.post({ type: "local-change", paths: [p] })
  }

  private readOnlyError(what: string): SyncError {
    return new SyncError(
      "read-only",
      `"${this.ctx.app}" is open read-only, so ${what} is not allowed. Change files through papp.files, the app's own folder, or in the "${this.ctx.app}" app itself.`,
    )
  }

  /** Refuses a name that differs from an existing one only in capitals, and a file/folder name clash. */
  private async checkNames(p: string): Promise<void> {
    const segs = p.split("/")
    let dir = ""
    for (let i = 0; i < segs.length; i++) {
      const name = segs[i]!
      const last = i === segs.length - 1
      const match = (await this.fs.list(dir)).find((e) => pathKey(e.name) === pathKey(name))
      if (!match) return
      const spelled = match.name.normalize("NFC")
      const existing = joinPath(dir, spelled)
      if (spelled !== name) {
        if (last && !match.dir) throw new SyncError("case-clash", `"${existing}" already exists. Write to "${existing}", or remove it first.`)
        const fixed = [existing, ...segs.slice(i + 1)].join("/")
        throw new SyncError("case-clash", `The folder "${existing}" already exists with other capitals. Write to "${fixed}" instead.`)
      }
      if (last && match.dir) {
        throw new SyncError("bad-path", `"${p}" is a folder. A file and a folder cannot share a name. Write inside it, like "${p}/name", or pick another name.`)
      }
      if (!last && !match.dir) {
        throw new SyncError("bad-path", `"${existing}" is a file, so "${p}" cannot be inside it. A file and a folder cannot share a name. Rename or remove "${existing}" first.`)
      }
      dir = existing
    }
  }

  private async hasFiles(dir: string): Promise<boolean> {
    for (const e of await this.fs.list(dir)) {
      if (!e.dir) return true
      if (await this.hasFiles(joinPath(dir, e.name.normalize("NFC")))) return true
    }
    return false
  }

  /** Streams the data into a temp file, one part at a time, computing its id on the way. */
  private async streamToTemp(temp: string, data: WriteData): Promise<IndexEntry> {
    const ps = this.t.partSize
    const keys = this.ctx.keys
    const ids: string[] = []
    let pending: Uint8Array[] = []
    let pendingLen = 0
    let total = 0
    const emit = async (part: Uint8Array) => {
      ids.push(await blobId(keys, part))
      await this.fs.tempAppend(temp, part)
    }
    const feed = async (chunk: Uint8Array) => {
      total += chunk.length
      pending.push(chunk)
      pendingLen += chunk.length
      while (pendingLen >= ps) {
        const all = pending.length === 1 ? pending[0]! : concat(...pending)
        await emit(all.subarray(0, ps))
        const rest = all.subarray(ps)
        pending = rest.length ? [rest] : []
        pendingLen = rest.length
      }
    }
    if (typeof data === "string") await feed(utf8.encode(data))
    else if (data instanceof Uint8Array) await feed(data)
    else {
      const stream = typeof Blob !== "undefined" && data instanceof Blob ? data.stream() : (data as ReadableStream<Uint8Array>)
      if (!stream || typeof (stream as ReadableStream).getReader !== "function") {
        throw new TypeError("files.write takes a string, a Uint8Array, a Blob or a ReadableStream of Uint8Array.")
      }
      const reader = stream.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value?.length) await feed(value instanceof Uint8Array ? value : new Uint8Array(value))
      }
    }
    if (pendingLen > 0 || total === 0) await emit(pending.length === 1 ? pending[0]! : concat(...pending))
    return entryFromParts(keys, ids, total, 0)
  }
}

function safe(fn: () => void): void {
  try {
    fn()
  } catch (e) {
    // An app callback threw. Keep syncing; show it where a developer looks.
    console.error("pappdrive: a watch or onStatus callback threw:", e)
  }
}
