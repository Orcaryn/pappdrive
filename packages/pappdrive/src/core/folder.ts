// One open folder: the Files API, scheduling, the watcher and the browser tab lock.
// The account layer calls openFolder(ctx), then `await folder.start()`. See spec 05-client.md and 06-sync.md.
import type { GoneReason, IndexEntry } from "@pappdrive/protocol"
import { PART_SIZE } from "@pappdrive/protocol"
import { concat, fromUtf8, toHex, utf8 } from "./bytes.js"
import { blobId, randomBytes } from "./crypto.js"
import { sameVersion } from "./decide.js"
import { SyncError } from "./errors.js"
import { IGNORE_FILE } from "./ignore.js"
import { baseName, checkPath, HIDDEN_DIR, parentOf, pathKey } from "./paths.js"
import { entryFromParts, joinPath, readAll, Scanner } from "./scan.js"
import { LocalState } from "./state.js"
import { SyncEngine } from "./sync.js"
import type { Change, Coordinator, CoordinatorMessage, FileInfo, Folder, FolderContext, Status, WriteData } from "./types.js"

/** Timings and sizes. Tests may shrink them; the defaults are the spec's. */
export interface Tuning {
  /** Plaintext bytes per blob. Only tests change it. */
  partSize: number
  /** Polling interval; 0 turns polling off. */
  pollMs: number
  /** Debounce for local changes: quiet time, and the longest wait after the first change. */
  quietMs: number
  maxWaitMs: number
  /** Wait for quiet after watcher events. */
  watchQuietMs: number
  watchMaxMs: number
  /** Within this long of a file's mtime, the check before a move compares the hash too. */
  recentMs: number
  now: () => number
}

const DEFAULT_TUNING: Tuning = {
  partSize: PART_SIZE,
  pollMs: 10_000,
  quietMs: 2_000,
  maxWaitMs: 10_000,
  watchQuietMs: 2_000,
  watchMaxMs: 10_000,
  recentMs: 2_000,
  now: () => Date.now(),
}

const READ_CHUNK = 1024 * 1024

/**
 * Opens a folder for syncing. Nothing runs until `start()`.
 * `tuning` is for tests only (smaller parts, no polling); apps never pass it.
 */
export function openFolder(ctx: FolderContext, tuning?: Partial<Tuning>): Folder {
  return new FolderImpl(ctx, { ...DEFAULT_TUNING, ...tuning })
}

class FolderImpl implements Folder {
  readonly readOnly: boolean
  private readonly state: LocalState
  private readonly scanner: Scanner
  private readonly engine: SyncEngine
  private st: Status = { syncing: false, lastSync: null, pending: 0, skipped: [], deleted: null, error: null }
  private watchCbs = new Set<(c: Change) => void>()
  private statusCbs = new Set<(s: Status) => void>()

  private closed = false
  private halted = false // unknown index version: no more rounds
  private leader = false // this tab syncs (always, outside a browser), once the start scan is done
  private coord: Coordinator | undefined
  private recentWrites = new Map<string, number>() // follower: paths it wrote, to skip the leader's echo
  private writeTemps = new Set<string>() // temp files of writes in progress

  // Rounds and watcher work run one at a time, on this chain.
  private mutex: Promise<void> = Promise.resolve()
  /** A round asked for and not started yet. Later requests join it. */
  private queued: { local: boolean; done: Promise<void> } | null = null

  private pollTimer: ReturnType<typeof setInterval> | undefined
  private debounceFirst: number | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private statusTimer: ReturnType<typeof setTimeout> | undefined
  private unBackground: (() => void) | undefined

  private stopWatcher: (() => Promise<void>) | undefined
  private watchGlobs = ""
  private watchPending = new Set<string>()
  private watchFirst: number | null = null
  private watchTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly ctx: FolderContext,
    private readonly tuning: Tuning,
  ) {
    this.readOnly = ctx.readOnly
    const fire = (c: Change) => this.fire(c)
    this.state = new LocalState(ctx.fs, tuning.now)
    this.scanner = new Scanner(ctx, tuning.partSize, this.state, fire)
    this.engine = new SyncEngine(ctx, tuning, this.state, this.scanner, fire, () => this.stopped)
  }

  private get stopped(): boolean {
    return this.closed || this.st.deleted !== null
  }

  // ======================= Lifecycle =======================

  async start(): Promise<void> {
    const make = this.ctx.platform.coordinator
    if (!make) return this.becomeLeader()
    const coord = make.call(this.ctx.platform, `pappdrive:${this.ctx.app}${this.readOnly ? ":read" : ""}`)
    this.coord = coord
    coord.onMessage((m) => this.onCoordMessage(m)) // close() drops it
    const lead = coord.waitForLead().then(() => true)
    const now = await Promise.race([lead, new Promise<boolean>((r) => setTimeout(() => r(false), 50))])
    if (now || coord.isLeader()) return this.becomeLeader()
    // A follower until the leading tab closes.
    void lead.then(() => {
      if (!this.stopped) this.becomeLeader().catch((e) => this.setError(e))
    })
  }

  private async becomeLeader(): Promise<void> {
    const { fs, app } = this.ctx
    const owner = await fs.loadState("app")
    if (owner !== null && owner !== app) {
      throw new SyncError(
        "folder-taken",
        `This folder belongs to the app "${owner}". Two apps cannot sync the same files. ` +
          `Open another folder for "${app}", or open "${owner}"'s folder read-only with papp.openReadOnly("${owner}").`,
      )
    }
    await this.state.load()
    // Write temps left by a crash. In a browser another tab may be writing one right now.
    if (!this.coord) for (const t of await fs.tempList()) if (t.startsWith("w-") && !this.writeTemps.has(t)) await fs.tempRemove(t)
    await this.scanner.scan()
    if (owner === null) await fs.saveState("app", app)
    await this.state.flush()
    if (this.stopped) return
    this.leader = true
    this.updateStatusNow()
    await this.startWatcher()
    if (this.tuning.pollMs > 0) {
      this.pollTimer = setInterval(() => this.poll(), this.tuning.pollMs)
      ;(this.pollTimer as { unref?: () => void }).unref?.() // node: polling alone does not keep a tool running
    }
    this.unBackground = this.ctx.platform.onBackground?.(() => this.flushDebounce())
    void this.requestRound(true)
  }

  async close(): Promise<void> {
    if (this.closed) return
    const wasDeleted = this.st.deleted !== null
    this.closed = true
    this.stopTimers()
    await this.stopWatcherNow()
    await this.mutex
    if (this.leader && !wasDeleted) await this.state.flush().catch(() => {})
    this.coord?.close()
  }

  async markDeleted(reason: GoneReason): Promise<void> {
    if (this.st.deleted) return
    this.st.deleted = reason
    this.stopTimers()
    await this.stopWatcherNow()
    await this.ctx.fs.destroy().catch(() => {}) // nothing left to do; the folder is gone either way
    this.st.syncing = false
    this.st.pending = 0
    this.notify()
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
      return this.queued.done
    }
    const q = { local, done: Promise.resolve() }
    q.done = this.exclusive(() => {
      this.queued = null
      return this.doRound(q.local)
    })
    this.queued = q
    return q.done
  }

  /** Never throws: a failed round shows in status.error. */
  private async doRound(local: boolean): Promise<void> {
    if (this.stopped || this.halted) return
    this.st.syncing = true
    this.notify()
    try {
      if ((await this.engine.round(local)) === "stopped" || this.stopped) return
      this.st.lastSync = this.tuning.now()
      this.st.error = this.engine.downloadError?.message ?? null
    } catch (e) {
      if (this.stopped) return
      this.st.error = (e as Error).message
      if (e instanceof SyncError && e.code === "update-needed") this.halted = true
    } finally {
      if (!this.st.deleted) {
        this.st.syncing = false
        this.updateStatusNow()
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
    const now = this.tuning.now()
    if (this.debounceFirst === null) this.debounceFirst = now
    clearTimeout(this.debounceTimer)
    const wait = Math.max(0, Math.min(this.tuning.quietMs, this.debounceFirst + this.tuning.maxWaitMs - now))
    this.debounceTimer = setTimeout(() => this.flushDebounce(), wait)
  }

  /** Ends the debounce at once (also when the app goes to the background) and syncs. */
  private flushDebounce(): Promise<void> {
    clearTimeout(this.debounceTimer)
    this.debounceFirst = null
    return this.requestRound(true)
  }

  /** Saves the disk index soon after local changes, so a crash does not hash them again. */
  private scheduleSave(): void {
    if (this.saveTimer || !this.leader) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      if (!this.stopped) this.state.flush().catch((e) => this.setError(e))
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
    this.st.pending = this.countPending()
    this.st.skipped = this.engine.skippedPaths
    this.notify()
  }

  /** Local changes not yet committed: disk differs from synced, outside frozen paths. */
  private countPending(): number {
    if (this.readOnly) return 0
    const { disk, synced } = this.state
    const frozen = new Set(this.engine.skippedPaths.map(pathKey))
    let n = 0
    for (const [key, d] of disk) {
      const s = synced.get(key)
      if (!d.skipped && !frozen.has(key) && (!s || !sameVersion(s, d))) n++
    }
    for (const key of synced.keys()) if (!disk.has(key) && !frozen.has(key)) n++
    return n
  }

  private setError(e: unknown): void {
    if (this.stopped) return
    this.st.error = (e as Error).message
    this.notify()
  }

  // ======================= Watcher (visible folders) =======================

  private async startWatcher(): Promise<void> {
    const w = this.ctx.platform.watcher
    if (!w || this.ctx.fs.kind !== "visible" || this.stopped) return
    const globs = this.scanner.rules.watcherSkipGlobs()
    this.watchGlobs = JSON.stringify(globs)
    this.stopWatcher = await w.start(
      this.ctx.fs,
      globs,
      (paths) => this.onWatchPaths(paths),
      () => this.onWatchDropped(),
    )
  }

  private async stopWatcherNow(): Promise<void> {
    const stop = this.stopWatcher
    this.stopWatcher = undefined
    await stop?.().catch(() => {}) // stopping: nothing to do about a failure
  }

  /** New ignore rules can change the folders the watcher skips. */
  private async restartWatcherIfNeeded(): Promise<void> {
    if (!this.stopWatcher || JSON.stringify(this.scanner.rules.watcherSkipGlobs()) === this.watchGlobs) return
    await this.stopWatcherNow()
    await this.startWatcher().catch((e) => this.setError(e))
  }

  /** Events are hints. Wait for quiet (2 s, at most 10 s), then look at each path. */
  private onWatchPaths(paths: string[]): void {
    if (this.stopped) return
    for (const p of paths) this.watchPending.add(p)
    const now = this.tuning.now()
    if (this.watchFirst === null) this.watchFirst = now
    clearTimeout(this.watchTimer)
    const wait = Math.max(0, Math.min(this.tuning.watchQuietMs, this.watchFirst + this.tuning.watchMaxMs - now))
    this.watchTimer = setTimeout(() => this.processWatch(), wait)
  }

  private processWatch(): void {
    const paths = [...this.watchPending]
    this.watchPending.clear()
    this.watchFirst = null
    this.exclusive(async () => {
      if (this.stopped) return
      const { changed, changing } = await this.scanner.processPaths(paths)
      this.localChanged(changed)
      if (changing.length) this.onWatchPaths(changing) // still being written: wait for quiet again
    }).catch((e) => this.setError(e))
  }

  /** The watcher failed or dropped events: scan the whole folder. Only changed files are hashed. */
  private onWatchDropped(): void {
    this.exclusive(async () => {
      if (!this.stopped) this.localChanged(await this.scanner.scan())
    }).catch((e) => this.setError(e))
  }

  /** Fires `local` for changed paths (ignored ones fire nothing) and starts the debounce. */
  private localChanged(paths: string[]): void {
    const shown = paths.filter((p) => !this.scanner.isIgnored(p))
    if (shown.length === 0) return
    for (const p of shown) this.fire({ path: p, origin: "local" })
    this.scheduleDebounce()
    this.scheduleSave()
    this.scheduleStatus()
  }

  // ======================= Tabs (browser) =======================

  private onCoordMessage(m: CoordinatorMessage): void {
    if (this.stopped) return
    if (this.leader) {
      if (m.type !== "local-change") return
      // No paths: a follower's sync().
      if (m.paths.length === 0) {
        void this.flushDebounce()
        return
      }
      this.exclusive(async () => {
        if (!this.stopped) this.localChanged((await this.scanner.processPaths(m.paths)).changed)
      }).catch((e) => this.setError(e))
      return
    }
    if (m.type === "change") {
      const wrote = this.recentWrites.get(m.change.path)
      if (m.change.origin === "local" && wrote !== undefined && this.tuning.now() - wrote < 10_000) return
      this.deliver(m.change)
    } else if (m.type === "status") {
      this.st = m.status
      this.notify()
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
    const coord = this.coord
    if (!coord) return
    // A follower tab: ask the leader, and wait for its next finished round.
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
    const { fs } = this.ctx
    const temp = `w-${toHex(randomBytes(8))}`
    this.writeTemps.add(temp)
    try {
      const entry = await this.streamToTemp(temp, data)
      await this.engine.withLock(pathKey(p), async () => {
        const st = await fs.moveTempInto(temp, p)
        if (!this.leader) return
        // An ignored file stays on this device only.
        if (this.scanner.isIgnored(p)) this.state.deleteDisk(pathKey(p))
        else this.state.setDisk({ path: p, entry: { ...entry, size: st.size, mtime: st.mtime } })
      })
    } catch (e) {
      await fs.tempRemove(temp).catch(() => {}) // the write failed; its temp file may not exist
      throw e
    } finally {
      this.writeTemps.delete(temp)
    }
    // A new .pappignore applies at once; files it now hides drop out at the next round's scan.
    if (this.leader && baseName(p).toLowerCase() === IGNORE_FILE) await this.scanner.refreshRules()
    this.afterLocalChange(p)
  }

  async read(path: string): Promise<Uint8Array> {
    this.assertOpen()
    const p = checkPath(path)
    const st = await this.ctx.fs.stat(p)
    if (!st) throw new SyncError("not-found", `"${path}" does not exist. Check the path with files.list(), or write it first.`)
    return readAll(this.ctx.fs, p, st.size, 16 * READ_CHUNK)
  }

  async readText(path: string): Promise<string> {
    return fromUtf8.decode(await this.read(path))
  }

  readStream(path: string): ReadableStream<Uint8Array> {
    this.assertOpen()
    const p = checkPath(path)
    const { fs } = this.ctx
    let off = 0
    let size: number | null = null
    return new ReadableStream<Uint8Array>({
      async pull(c) {
        if (size === null) {
          const st = await fs.stat(p)
          if (!st) return c.error(new SyncError("not-found", `"${path}" does not exist. Check the path with files.list(), or write it first.`))
          size = st.size
        }
        const data = off < size ? await fs.read(p, off, Math.min(READ_CHUNK, size - off)) : new Uint8Array(0)
        if (data.length === 0) return c.close() // the end, or the file got shorter
        off += data.length
        c.enqueue(data)
      },
    })
  }

  async list(dir?: string): Promise<FileInfo[]> {
    this.assertOpen()
    const { fs } = this.ctx
    const d = dir === undefined || dir === "" || dir === "/" ? "" : checkPath(dir.replace(/\/+$/, ""))
    const out: FileInfo[] = []
    for (const e of await fs.list(d)) {
      const name = e.name.normalize("NFC")
      if (d === "" && name.toLowerCase() === HIDDEN_DIR) continue
      const path = joinPath(d, name)
      if (e.dir) {
        if (await this.hasFiles(path)) out.push({ path, size: 0, mtime: 0, dir: true })
      } else {
        const st = await fs.stat(path)
        if (st) out.push({ path, size: st.size, mtime: st.mtime, dir: false })
      }
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  async remove(path: string): Promise<void> {
    this.assertOpen()
    if (this.readOnly) throw this.readOnlyError("remove")
    const { fs } = this.ctx
    const p = checkPath(path)
    if (!(await fs.stat(p))) {
      throw new SyncError("not-found", `"${path}" does not exist, so there is nothing to remove. List files with files.list(); a folder goes away once its files are removed.`)
    }
    await this.engine.withLock(pathKey(p), async () => {
      await fs.remove(p)
      if (this.leader) this.state.deleteDisk(pathKey(p))
      if (parentOf(p) !== "") await fs.removeEmptyDirs(parentOf(p))
    })
    this.afterLocalChange(p)
  }

  /** The leader handles its own changes. A follower fires here and tells the leader, which skips the echo. */
  private afterLocalChange(p: string): void {
    if (this.leader) return this.localChanged([p])
    this.recentWrites.set(p, this.tuning.now())
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
      const match = (await this.ctx.fs.list(dir)).find((e) => pathKey(e.name) === pathKey(name))
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
    for (const e of await this.ctx.fs.list(dir)) {
      if (!e.dir || (await this.hasFiles(joinPath(dir, e.name.normalize("NFC"))))) return true
    }
    return false
  }

  /** Streams the data into a temp file, one part at a time, computing its id on the way. */
  private async streamToTemp(temp: string, data: WriteData): Promise<IndexEntry> {
    const { fs, keys } = this.ctx
    const ps = this.tuning.partSize
    const ids: string[] = []
    let chunks: Uint8Array[] = [] // not yet a whole part
    let buffered = 0
    let size = 0
    const joined = () => (chunks.length === 1 ? chunks[0]! : concat(...chunks)) // one big chunk is not copied
    const emit = async (part: Uint8Array) => {
      ids.push(await blobId(keys, part))
      await fs.tempAppend(temp, part)
    }
    const add = async (chunk: Uint8Array) => {
      size += chunk.length
      chunks.push(chunk)
      buffered += chunk.length
      while (buffered >= ps) {
        const all = joined()
        await emit(all.subarray(0, ps))
        chunks = [all.subarray(ps)]
        buffered -= ps
      }
    }
    if (typeof data === "string") await add(utf8.encode(data))
    else if (data instanceof Uint8Array) await add(data)
    else {
      const reader = (data instanceof Blob ? data.stream() : data).getReader()
      for (let r = await reader.read(); !r.done; r = await reader.read()) await add(r.value)
    }
    if (buffered > 0 || size === 0) await emit(joined())
    return entryFromParts(keys, ids, size, 0)
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
