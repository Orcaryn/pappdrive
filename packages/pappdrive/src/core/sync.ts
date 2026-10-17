// The sync engine: local state, scans, and one sync round. See spec 06-sync.md.
// The folder layer (folder.ts) owns scheduling and the Files API; this file owns what a round does.
import type { IndexBody, IndexEntry, IndexFile, IndexLinkResponse } from "@pappdrive/protocol"
import { PART_SIZE } from "@pappdrive/protocol"
import { decodeBody, encodeBody } from "./crypto.js"
import { decide, dirKeysOf, findClashes, type CommitPath, type Decision } from "./decide.js"
import { downloadAll, tempNameFor, type DownloadJob } from "./download.js"
import { ApiError, SyncError } from "./errors.js"
import { IGNORE_FILE, type IgnoreFile, IgnoreRules } from "./ignore.js"
import { baseName, conflictDirName, conflictName, parentOf, pathKey, pathProblem } from "./paths.js"
import { getIndex, R2Error } from "./r2.js"
import { hashFile, joinPath, readAll, sameStat, scanTree, type ScanResult } from "./scan.js"
import { LocalState, type DiskRec, type Rec } from "./state.js"
import type { Change, FileStat, FolderContext } from "./types.js"
import { storedSizes, Uploader } from "./upload.js"
import { fromUtf8, toHex } from "./bytes.js"
import { randomBytes } from "./crypto.js"

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

export const DEFAULT_TUNING: Tuning = {
  partSize: PART_SIZE,
  pollMs: 10_000,
  quietMs: 2_000,
  maxWaitMs: 10_000,
  watchQuietMs: 2_000,
  watchMaxMs: 10_000,
  recentMs: 2_000,
  now: () => Date.now(),
}

/** The server index as last fetched. */
export interface ServerView {
  etag: string | null
  header: Record<string, number>
  body: IndexBody
  map: Map<string, Rec>
}

function makeView(etag: string | null, header: Record<string, number>, body: IndexBody): ServerView {
  const map = new Map<string, Rec>()
  for (const path of Object.keys(body).sort()) {
    const key = pathKey(path)
    if (!map.has(key)) map.set(key, { path, entry: body[path]! })
  }
  return { etag, header, body, map }
}

const emptyView = (): ServerView => makeView(null, {}, {})

/** Thrown inside a round once the folder stops (close or markDeleted). */
class Stopped extends Error {}

export type RoundResult = "done" | "stale" | "stopped"

interface Job extends DownloadJob {
  target: string
  server: Rec
  /** The disk entry the decision was based on; undefined when the path was missing here. */
  expected: DiskRec | undefined
  /** A planned conflict already fired its change. */
  quiet: boolean
}

function isApiError(e: unknown, word: string): e is ApiError {
  return e instanceof ApiError && e.error === word
}

export class SyncEngine {
  readonly state: LocalState
  rules = new IgnoreRules()
  private ignoreFiles: IgnoreFile[] = []
  private ignorePaths = new Map<string, string>() // dir -> path of its .pappignore
  private ignoreSig = ""
  server: ServerView | null = null
  private link: IndexLinkResponse | null = null
  private reportedSkipped = new Set<string>()
  private reportedDups = new Set<string>()
  skippedPaths: string[] = []
  private locks = new Map<string, Promise<void>>()
  readonly activeTemps = new Set<string>()
  stopped = false
  /** Set when watcher events or a rule change mean the next round should scan everything. */
  needsFullScan = false
  rulesDirty = false

  constructor(
    readonly ctx: FolderContext,
    readonly tuning: Tuning,
    private readonly fire: (change: Change) => void,
  ) {
    this.state = new LocalState(ctx.fs, tuning.now)
  }

  get fs() {
    return this.ctx.fs
  }

  private checkStopped(): void {
    if (this.stopped) throw new Stopped()
  }

  // ---------------- Locks ----------------

  /** Writes and downloads to the same path take turns. */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>((r) => (release = r))
    const chained = prev.then(() => mine)
    this.locks.set(key, chained)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (this.locks.get(key) === chained) this.locks.delete(key)
    }
  }

  // ---------------- Ignore rules and known paths ----------------

  /** In synced or in the server index: such a path is never ignored (the git rule). */
  isKnown(key: string): boolean {
    return this.state.synced.has(key) || (this.server?.map.has(key) ?? false)
  }

  /** Ignored and not synced yet. Hard-ignored paths (.git, the hidden folder) always are. */
  isIgnored(path: string): boolean {
    if (this.rules.isHard(path)) return true
    return !this.isKnown(pathKey(path)) && this.rules.ignores(path)
  }

  private setRules(files: IgnoreFile[], paths: Map<string, string>): void {
    this.ignoreFiles = files
    this.ignorePaths = paths
    this.rules = new IgnoreRules(files)
    this.ignoreSig = sigOf(files)
  }

  /** Reads the .pappignore files again. Changed rules: scan everything. */
  async refreshRules(): Promise<void> {
    const candidates = new Map(this.ignorePaths)
    for (const rec of this.state.disk.values()) {
      if (baseName(rec.path).toLowerCase() === IGNORE_FILE) candidates.set(parentOf(rec.path), rec.path)
    }
    const files: IgnoreFile[] = []
    const paths = new Map<string, string>()
    for (const [dir, path] of candidates) {
      const st = await this.fs.stat(path)
      if (!st) continue
      files.push({ dir, content: fromUtf8.decode(await readAll(this.fs, path, st.size, this.tuning.partSize)) })
      paths.set(dir, path)
    }
    this.rulesDirty = false
    if (sigOf(files) !== this.ignoreSig) {
      this.setRules(files, paths)
      this.needsFullScan = true
    }
  }

  // ---------------- Scans ----------------

  private scanOptions(ignoreFiles?: IgnoreFile[]) {
    const known = new Set<string>([...this.state.synced.keys(), ...(this.server?.map.keys() ?? [])])
    const paths = [...this.state.synced.values(), ...(this.server?.map.values() ?? [])].map((r) => r.path)
    const indexPaths = new Map<string, string>()
    for (const r of this.server?.map.values() ?? []) indexPaths.set(pathKey(r.path), r.path)
    for (const r of this.state.synced.values()) indexPaths.set(pathKey(r.path), r.path)
    return {
      fs: this.fs,
      keys: this.ctx.keys,
      partSize: this.tuning.partSize,
      prev: this.state.disk,
      known,
      knownDirs: dirKeysOf(paths),
      indexPaths,
      ...(ignoreFiles ? { ignoreFiles } : {}),
    }
  }

  /** Scans the whole folder. Returns the paths that changed since the last disk index. */
  async fullScan(): Promise<string[]> {
    const res = await scanTree(this.scanOptions())
    const changed = diffDisk(this.state.disk, res.disk, () => true)
    this.state.replaceDisk(res.disk)
    this.applyScanRules(res, "")
    this.reportDups(res.caseDuplicates)
    this.needsFullScan = false
    return changed
  }

  /** Scans one folder, after watcher events. */
  async scanSubtree(dir: string): Promise<string[]> {
    const res = await scanTree(this.scanOptions(this.ignoreFiles), dir)
    const prefix = pathKey(dir) + "/"
    const inside = (k: string) => k.startsWith(prefix)
    const next = new Map([...this.state.disk].filter(([k]) => !inside(k)))
    for (const [k, r] of res.disk) next.set(k, r)
    const changed = diffDisk(this.state.disk, next, inside)
    this.state.replaceDisk(next)
    this.applyScanRules(res, dir)
    this.reportDups(res.caseDuplicates)
    return changed
  }

  private applyScanRules(res: ScanResult, root: string): void {
    const paths = new Map(root === "" ? [] : [...this.ignorePaths].filter(([d]) => !isUnder(d, root)))
    for (const [dir, path] of res.ignorePaths) paths.set(dir, path)
    const files = res.ignoreFiles.filter((f) => paths.has(f.dir))
    this.setRules(files, paths)
  }

  private reportDups(paths: string[]): void {
    for (const p of paths) {
      if (this.reportedDups.has(p)) continue
      this.reportedDups.add(p)
      this.fire({ path: p, origin: "case-duplicate" })
    }
  }

  /**
   * Looks at paths a watcher (or another tab) named. Events are hints: each file is checked itself.
   * Returns the paths whose disk entry changed, and the ones still being written.
   */
  async processPaths(paths: string[]): Promise<{ changed: string[]; changing: string[] }> {
    const changed: string[] = []
    const changing: string[] = []
    for (const raw of new Set(paths.map((p) => p.normalize("NFC")))) {
      const path = raw.replace(/^\/+|\/+$/g, "")
      if (path === "") {
        this.needsFullScan = true
        continue
      }
      if (this.rules.isHard(path)) continue
      if (baseName(path).toLowerCase() === IGNORE_FILE) this.rulesDirty = true
      const key = pathKey(path)
      const st = await this.fs.stat(path)
      if (st) {
        if (this.isIgnored(path)) continue
        const rec = this.state.disk.get(key)
        if (pathProblem(path)) {
          if (!rec?.skipped) {
            this.state.setDisk({ path, entry: { id: "", size: 0, mtime: 0 }, skipped: "bad name" })
            changed.push(path)
          }
          continue
        }
        if (rec && rec.path === path && !rec.skipped && sameStat(st, rec.entry)) continue
        if (rec && rec.path !== path && !this.fs.caseInsensitive && (await this.fs.stat(rec.path))) {
          this.reportDups([path])
          continue
        }
        const h = await hashFile(this.fs, this.ctx.keys, path, this.tuning.partSize)
        if (h === "changing") {
          changing.push(path)
          continue
        }
        if (h !== "missing") {
          await this.withLock(key, async () => {
            if (rec && rec.path !== path) this.state.deleteDisk(key)
            this.state.setDisk({ path, entry: h.entry })
          })
          changed.push(path)
          continue
        }
      }
      // Gone, or a folder.
      const list = await this.fs.list(path)
      if (list.length > 0) {
        changed.push(...(await this.scanSubtree(path)))
        continue
      }
      const rec = this.state.disk.get(key)
      if (rec && !(await this.fs.stat(rec.path))) {
        this.state.deleteDisk(key)
        changed.push(rec.path)
      }
      const prefix = key + "/"
      for (const [k, r] of [...this.state.disk]) {
        if (k.startsWith(prefix) && !(await this.fs.stat(r.path))) {
          this.state.deleteDisk(k)
          changed.push(r.path)
        }
      }
    }
    return { changed, changing }
  }

  // ---------------- Status helpers ----------------

  /** Local changes not yet committed: disk differs from synced. */
  countPending(): number {
    if (this.ctx.readOnly) return 0
    const frozen = new Set(this.skippedPaths.map(pathKey))
    let n = 0
    for (const [key, d] of this.state.disk) {
      if (d.skipped || frozen.has(key)) continue
      const s = this.state.synced.get(key)
      if (!s || s.entry.id !== d.entry.id || baseName(s.path) !== baseName(d.path)) n++
    }
    for (const key of this.state.synced.keys()) if (!this.state.disk.has(key) && !frozen.has(key)) n++
    return n
  }

  // ---------------- The round ----------------

  private async fetchServer(): Promise<ServerView | "missing"> {
    for (let attempt = 0; ; attempt++) {
      if (!this.link || this.link.expires - 60_000 < this.tuning.now()) this.link = await this.ctx.api.indexLink()
      let r
      try {
        r = await getIndex(this.link.url, this.server?.etag ?? null)
      } catch (e) {
        // An expired or refused read link: get a new one and try once more.
        if (e instanceof R2Error && (e.status === 400 || e.status === 401 || e.status === 403) && attempt === 0) {
          this.link = null
          continue
        }
        throw e
      }
      if (r.kind === "unchanged" && this.server) return this.server
      if (r.kind === "missing") {
        this.server = null
        return "missing"
      }
      if (r.kind === "unchanged") {
        this.server = null // we sent no ETag, so this cannot happen; read it again
        continue
      }
      const body = await decodeBody(this.ctx.keys, r.index.body)
      this.server = makeView(r.etag, r.index.blobs ?? {}, body)
      return this.server
    }
  }

  /**
   * One round. `local`: also send this device's changes (false while the debounce waits).
   * "stale": another device committed first; the caller runs it again.
   */
  async round(local: boolean): Promise<RoundResult> {
    this.downloadError = null
    try {
      return await this.roundOnce(local)
    } catch (e) {
      if (e instanceof Stopped) return "stopped"
      throw e
    } finally {
      if (!this.stopped) await this.state.flush()
    }
  }

  private async roundOnce(local: boolean): Promise<RoundResult> {
    const { readOnly } = this.ctx
    const fetched = await this.fetchServer()
    this.checkStopped()
    let view: ServerView
    if (fetched === "missing") {
      if (!readOnly && this.state.synced.size > 0) {
        // The folder was deleted, or something is badly wrong. Never treat it as an empty server.
        const r = await this.ctx.checkGone()
        if (r === "gone" || this.stopped) return "stopped"
        throw new SyncError(
          "server",
          "The folder's index is missing on the server although this device synced before. " +
            "Nothing was uploaded, so the folder is not rebuilt by mistake. The next sync checks again.",
        )
      }
      view = emptyView()
    } else view = fetched

    await this.refreshRules()
    const noWatcher = this.fs.kind === "visible" && !this.ctx.platform.watcher
    if (this.needsFullScan || noWatcher) {
      for (const p of await this.fullScan()) if (!this.isIgnored(p)) this.fire({ path: p, origin: "local" })
    }
    this.checkStopped()

    const frozen = this.frozenKeys(view)
    await this.applyServer(view, frozen)
    this.checkStopped()
    if (!local || readOnly) return "done"
    return this.commitLocal(view, frozen)
  }

  /** Paths frozen on this device: bad names on disk, or server names this system cannot create. */
  private frozenKeys(view: ServerView): Set<string> {
    const frozen = new Set<string>()
    const skipped: string[] = []
    for (const [key, d] of this.state.disk) {
      if (d.skipped) {
        frozen.add(key)
        skipped.push(d.path)
      }
    }
    for (const [key, v] of view.map) {
      if (frozen.has(key)) continue
      if (this.rules.isHard(v.path)) {
        frozen.add(key) // never comes onto a device; kept on the server as it is
        continue
      }
      if (pathProblem(v.path) || v.path.split("/").some((seg) => !this.fs.canCreate(seg))) {
        frozen.add(key)
        skipped.push(v.path)
      }
    }
    // A synced entry whose disk side is skipped stays frozen too (covered by the disk loop).
    for (const p of skipped) {
      if (this.reportedSkipped.has(p)) continue
      this.reportedSkipped.add(p)
      this.fire({ path: p, origin: "skipped", reason: "bad name" })
    }
    for (const p of [...this.reportedSkipped]) if (!skipped.includes(p)) this.reportedSkipped.delete(p)
    this.skippedPaths = skipped.sort()
    return frozen
  }

  private decideNow(view: ServerView, frozen: Set<string>): Decision[] {
    return decide({
      disk: new Map(this.state.disk),
      synced: new Map(this.state.synced),
      server: view.map,
      frozen,
      readOnly: this.ctx.readOnly,
    })
  }

  // ---------------- Applying the server's changes ----------------

  private async applyServer(view: ServerView, frozen: Set<string>): Promise<void> {
    let decisions = this.decideNow(view, frozen)
    if (decisions.length === 0) {
      await this.cleanTemps(new Set())
      return
    }
    if (!this.ctx.readOnly && (await this.resolveClashes(decisions, view))) decisions = this.decideNow(view, frozen)

    const jobs: Job[] = []
    const deletes: Decision[] = []
    for (const dec of decisions) {
      this.checkStopped()
      const v = dec.server
      switch (dec.action) {
        case "conflict": {
          // The server keeps the path. This device's version moves beside it and uploads as a new file.
          const copy = await this.withLock(dec.key, async () => {
            const live = this.state.disk.get(dec.key)
            if (!live) return undefined
            return this.moveToConflictCopy(live.path, { entry: live.entry })
          })
          if (copy) this.fire({ path: v!.path, origin: "conflict", copy })
          jobs.push({ key: dec.key, entry: v!.entry, server: v!, target: this.localTarget(v!.path, undefined), expected: undefined, quiet: !!copy })
          break
        }
        case "download": {
          const d = dec.disk
          if (d && d.entry.id === v!.entry.id) {
            // Same contents, new spelling: a rename, nothing to download.
            await this.withLock(dec.key, async () => {
              const live = this.state.disk.get(dec.key)
              if (!live || live.entry.id !== v!.entry.id) return
              await this.renameLocal(live.path, this.localTarget(v!.path, live))
              this.state.setSynced(v!)
            })
            break
          }
          jobs.push({ key: dec.key, entry: v!.entry, server: v!, target: this.localTarget(v!.path, d), expected: d, quiet: false })
          break
        }
        case "adopt":
          await this.withLock(dec.key, async () => {
            const live = this.state.disk.get(dec.key)
            if (!live || live.entry.id !== v!.entry.id) return
            const target = this.localTarget(v!.path, live)
            if (live.path !== target) await this.renameLocal(live.path, target)
            this.state.setSynced(v!)
          })
          break
        case "forget":
          this.state.deleteSynced(dec.key)
          break
        case "delete-here":
          deletes.push(dec)
          break
        default:
          break // upload and delete-server are this device's changes; see commitLocal
      }
    }

    // Downloads first, so a renamed file appears at its new path before it leaves the old one.
    // A download whose path is blocked by a file or folder that the deletes remove waits for them.
    const blocked = this.blockedChecker()
    const now: Job[] = []
    const later: Job[] = []
    for (const j of jobs) (blocked(j.target) ? later : now).push(j)
    const failed = new Set<string>()
    await this.download(now, failed)
    this.checkStopped()

    const emptied = new Set<string>()
    for (const dec of deletes) {
      this.checkStopped()
      await this.deleteHere(dec, emptied)
    }
    for (const dir of emptied) if (dir !== "") await this.fs.removeEmptyDirs(dir)

    if (later.length) {
      const still = this.blockedChecker()
      const ready = later.filter((j) => !still(j.target))
      for (const j of later) if (still(j.target)) failed.add(tempNameFor(j.entry))
      await this.download(ready, failed)
    }
    this.checkStopped()
    await this.cleanTemps(failed)
    await this.state.flush()
  }

  private async download(jobs: Job[], failed: Set<string>): Promise<void> {
    if (jobs.length === 0) return
    let firstError: unknown = null
    let flushed = this.tuning.now()
    await downloadAll(jobs, {
      fs: this.fs,
      keys: this.ctx.keys,
      api: this.ctx.api,
      partSize: this.tuning.partSize,
      now: this.tuning.now,
      isStopped: () => this.stopped,
      land: async (job, temp) => {
        await this.land(job as Job, temp)
        if (this.tuning.now() - flushed > 2000) {
          flushed = this.tuning.now()
          await this.state.flush()
        }
      },
      onError: (job, e) => {
        failed.add(tempNameFor(job.entry))
        firstError ??= e
      },
    })
    // A file that did not arrive keeps its old synced entry, so the next round tries again.
    if (firstError && !this.stopped) {
      this.downloadError = firstError
    }
  }

  /** The first download failure of the round, reported in status. The round itself goes on. */
  downloadError: unknown = null

  /** Moves a downloaded temp file into place, unless someone saved the path since the decision. */
  private async land(j: Job, temp: string): Promise<void> {
    await this.withLock(j.key, async () => {
      this.checkStopped()
      const fs = this.fs
      const live = this.state.disk.get(j.key)
      let copy: string | undefined
      if (!(await this.unchangedSince(j.expected, live, j.target))) {
        const localPath = live?.path ?? j.expected?.path ?? j.target
        const h = await hashFile(fs, this.ctx.keys, localPath, this.tuning.partSize)
        if (typeof h === "object" && h.entry.id === j.server.entry.id) {
          // Saved with the same contents: nothing to move.
          this.state.setDisk({ path: localPath, entry: h.entry })
          this.state.setSynced(j.server)
          await fs.tempRemove(temp)
          return
        }
        if (h !== "missing") copy = await this.moveToConflictCopy(localPath, h === "changing" ? null : h)
        // missing: deleted since the decision; the download brings it back
      }
      const cur = this.state.disk.get(j.key)
      if (cur && cur.path !== j.target && fs.caseInsensitive) await this.renameLocal(cur.path, j.target)
      const st = await fs.moveTempInto(temp, j.target)
      if (cur && cur.path !== j.target && !fs.caseInsensitive) await fs.remove(cur.path)
      this.state.setDisk({ path: j.target, entry: { ...j.server.entry, size: st.size, mtime: st.mtime } })
      this.state.setSynced(j.server)
      if (copy) this.fire({ path: j.target, origin: "conflict", copy })
      else if (!j.quiet) this.fire({ path: j.target, origin: "remote" })
    })
  }

  /**
   * Is the file still what the decision saw? Same size and mtime, or still missing for a new file.
   * Saved within the last two seconds: compare the hash too (some disks keep time to the second).
   */
  private async unchangedSince(expected: DiskRec | undefined, live: DiskRec | undefined, target: string): Promise<boolean> {
    if (!expected) return !live && (await this.fs.stat(target)) === null
    if (!live || live.entry.id !== expected.entry.id || live.path !== expected.path) return false
    const st = await this.fs.stat(expected.path)
    if (!st || !sameStat(st, expected.entry)) return false
    if (this.tuning.now() - st.mtime < this.tuning.recentMs) {
      const h = await hashFile(this.fs, this.ctx.keys, expected.path, this.tuning.partSize)
      return typeof h === "object" && h.entry.id === expected.entry.id
    }
    return true
  }

  /** Local deletes: an edit since the decision beats the delete. */
  private async deleteHere(dec: Decision, emptied: Set<string>): Promise<void> {
    await this.withLock(dec.key, async () => {
      const live = this.state.disk.get(dec.key)
      const exp = dec.disk!
      if (!live) {
        this.state.deleteSynced(dec.key)
        return
      }
      if (await this.unchangedSince(exp, live, exp.path)) {
        await this.fs.remove(exp.path)
        this.state.deleteDisk(dec.key)
        this.state.deleteSynced(dec.key)
        emptied.add(parentOf(exp.path))
        this.fire({ path: exp.path, origin: "remote" })
        return
      }
      // Edited since: keep it. Hash it so the next commit carries the edit; the file comes back on the server.
      const h = await hashFile(this.fs, this.ctx.keys, live.path, this.tuning.partSize)
      if (typeof h === "object") this.state.setDisk({ path: live.path, entry: h.entry })
    })
  }

  /**
   * A download temp file (named by a file id) that no download needs any more is deleted.
   * Write temps (`w-…`) are left alone here: in a browser another tab may be writing one right now.
   */
  private async cleanTemps(stillNeeded: Set<string>): Promise<void> {
    for (const t of await this.fs.tempList()) {
      if (!/^[0-9a-f]{64}$/.test(t) || stillNeeded.has(t) || this.activeTemps.has(t)) continue
      await this.fs.tempRemove(t)
    }
  }

  /** At start, without other tabs: write temps left by a crash are deleted. */
  async cleanWriteTemps(): Promise<void> {
    for (const t of await this.fs.tempList()) if (t.startsWith("w-") && !this.activeTemps.has(t)) await this.fs.tempRemove(t)
  }

  /** True when a path cannot be created yet: a local folder has its name, or a file has a folder's name above it. */
  private blockedChecker(): (target: string) => boolean {
    const dirs = dirKeysOf([...this.state.disk.values()].map((r) => r.path))
    return (target) => {
      const key = pathKey(target)
      if (dirs.has(key)) return true
      const segs = key.split("/")
      for (let i = 1; i < segs.length; i++) if (this.state.disk.has(segs.slice(0, i).join("/"))) return true
      return false
    }
  }

  /** Where a server path goes on this disk: folders keep the spelling they already have here. */
  private localTarget(serverPath: string, d: DiskRec | undefined): string {
    if (d) return joinPath(parentOf(d.path), baseName(serverPath))
    const segs = serverPath.split("/")
    if (segs.length === 1) return serverPath
    const spell = new Map<string, string>()
    for (const r of this.state.disk.values()) {
      const parts = r.path.split("/")
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/")
        const k = pathKey(dir)
        if (!spell.has(k)) spell.set(k, dir)
      }
    }
    let out = ""
    for (let i = 0; i < segs.length - 1; i++) {
      const next = joinPath(out, segs[i]!)
      out = spell.get(pathKey(next)) ?? next
    }
    return joinPath(out, segs[segs.length - 1]!)
  }

  /** Renames a file here. A change of capitals only goes through a temp name on a case-insensitive disk. */
  async renameLocal(from: string, to: string): Promise<void> {
    if (from === to) return
    const before = await this.fs.stat(from)
    if (this.fs.caseInsensitive && pathKey(from) === pathKey(to)) {
      const tmp = `${from}.pappdrive-rename-${toHex(randomBytes(4))}`
      await this.fs.move(from, tmp)
      await this.fs.move(tmp, to)
    } else await this.fs.move(from, to)
    const rec = this.state.disk.get(pathKey(from))
    this.state.deleteDisk(pathKey(from))
    if (rec) {
      const st = await this.fs.stat(to)
      if (st) this.state.setDisk({ path: to, entry: carry(rec.entry, before, st) })
    }
  }

  private taken = (key: string): boolean =>
    this.state.disk.has(key) || this.state.synced.has(key) || (this.server?.map.has(key) ?? false)

  /** Moves a local file beside its path as a conflict copy. It becomes a new file to upload. */
  private async moveToConflictCopy(path: string, h: { entry: IndexEntry } | null): Promise<string> {
    const when = new Date(this.tuning.now())
    const extra = new Set<string>()
    let copy = conflictName(path, when, (k) => this.taken(k) || extra.has(k))
    while (await this.fs.stat(copy)) {
      extra.add(pathKey(copy))
      copy = conflictName(path, when, (k) => this.taken(k) || extra.has(k))
    }
    const before = await this.fs.stat(path)
    await this.fs.move(path, copy)
    this.state.deleteDisk(pathKey(path))
    if (!this.isIgnored(copy)) {
      const st = await this.fs.stat(copy)
      if (st) this.state.setDisk({ path: copy, entry: carry(h?.entry, before, st) })
    }
    return copy
  }

  /**
   * A file and a folder with the same name, in the paths this device would commit.
   * The server's side keeps the name; this device's side moves. Returns true if anything moved.
   */
  private async resolveClashes(decisions: Decision[], view: ServerView): Promise<boolean> {
    const uploads = new Map<string, Decision>()
    const dels = new Set<string>()
    for (const d of decisions) {
      if (d.action === "upload" && d.disk) uploads.set(d.key, d)
      if (d.action === "delete-server") dels.add(d.key)
    }
    if (uploads.size === 0) return false
    const paths: CommitPath[] = []
    for (const [key, rec] of view.map) if (!dels.has(key) && !uploads.has(key)) paths.push({ key, path: rec.path, local: false })
    for (const [key, d] of uploads) paths.push({ key, path: d.disk!.path, local: true })
    const clashes = findClashes(paths)
    if (clashes.length === 0) return false
    const when = new Date(this.tuning.now())
    for (const c of clashes) {
      this.checkStopped()
      if (c.move === "file") {
        const copy = await this.withLock(c.file.key, async () => {
          const live = this.state.disk.get(c.file.key)
          if (!live) return undefined
          return this.moveToConflictCopy(live.path, { entry: live.entry })
        })
        if (copy) this.fire({ path: c.file.path, origin: "conflict", copy })
        continue
      }
      // This device made the folder: the folder moves, with every file in it.
      const depth = c.file.key.split("/").length
      const localDir = c.inside[0]!.path.split("/").slice(0, depth).join("/")
      const prefix = c.file.key + "/"
      // Files the server deleted from that folder go first, so they do not come back under the new name.
      const emptied = new Set<string>()
      for (const d of decisions) if (d.action === "delete-here" && d.key.startsWith(prefix)) await this.deleteHere(d, emptied)
      const dirs = dirKeysOf([...this.state.disk.values(), ...view.map.values(), ...this.state.synced.values()].map((r) => r.path))
      const newDir = conflictDirName(localDir, when, (k) => this.taken(k) || dirs.has(k))
      await this.fs.move(localDir, newDir)
      for (const [k, r] of [...this.state.disk]) {
        if (!k.startsWith(prefix)) continue
        this.state.deleteDisk(k)
        this.state.setDisk({ ...r, path: newDir + r.path.slice(localDir.length) })
      }
      this.fire({ path: c.file.path, origin: "conflict", copy: newDir })
    }
    await this.state.flush()
    return true
  }

  // ---------------- This device's changes ----------------

  private async commitLocal(view: ServerView, frozen: Set<string>): Promise<RoundResult> {
    const decisions = this.decideNow(view, frozen)
    const ups = decisions.filter((d) => d.action === "upload")
    const dels = decisions.filter((d) => d.action === "delete-server")
    if (ups.length === 0 && dels.length === 0) return "done"

    const ps = this.tuning.partSize
    const uploader = new Uploader(this.fs, this.ctx.keys, this.ctx.api, this.state, ps, view.header)
    const committed: { key: string; diskPath: string; entry: IndexEntry }[] = []
    for (const dec of ups) {
      this.checkStopped()
      let rec = this.state.disk.get(dec.key)
      for (let tries = 0; rec && !rec.skipped && tries < 4; tries++) {
        const r = await uploader.addFile(rec.path, rec.entry)
        if (r === "missing") break // gone since; the next round sees the delete
        if (r === "changed") {
          const h = await hashFile(this.fs, this.ctx.keys, rec.path, ps)
          if (typeof h !== "object") break // gone, or still being written: next round
          const path: string = rec.path
          rec = await this.withLock(dec.key, async () => {
            const next = { path, entry: h.entry }
            this.state.setDisk(next)
            return next
          })
          continue
        }
        committed.push({ key: dec.key, diskPath: rec.path, entry: r.entry })
        break
      }
    }
    await uploader.flush()
    this.checkStopped()
    if (committed.length === 0 && dels.length === 0) return "done"

    // The commit: the server index with only this device's changes. Never the list of files on disk.
    const body: IndexBody = { ...view.body }
    for (const d of dels) delete body[view.map.get(d.key)!.path]
    const spell = new Map<string, string>()
    for (const p of Object.keys(body)) {
      const parts = p.split("/")
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/")
        if (!spell.has(pathKey(dir))) spell.set(pathKey(dir), dir)
      }
    }
    const commitPathOf = (diskPath: string): string => {
      const segs = diskPath.split("/")
      let out = ""
      for (let i = 0; i < segs.length - 1; i++) {
        const next = joinPath(out, segs[i]!)
        const k = pathKey(next)
        out = spell.get(k) ?? next
        if (!spell.has(k)) spell.set(k, out)
      }
      return joinPath(out, segs[segs.length - 1]!)
    }
    const changes: { key: string; path: string; entry: IndexEntry }[] = []
    for (const c of committed) {
      const old = view.map.get(c.key)
      if (old) delete body[old.path]
      const path = commitPathOf(c.diskPath)
      const entry: IndexEntry = { id: c.entry.id, size: c.entry.size, mtime: c.entry.mtime }
      if (c.entry.parts) entry.parts = c.entry.parts
      body[path] = entry
      changes.push({ key: c.key, path, entry })
    }
    // Safety: a file and a folder with the same name must not reach the server. Leave such uploads for next round.
    const clash = findClashes(Object.keys(body).map((p) => ({ key: pathKey(p), path: p, local: changes.some((c) => c.path === p) })))
    for (const c of clash) {
      for (const p of [c.file, ...c.inside]) {
        if (!p.local) continue
        delete body[p.path]
        const old = view.map.get(p.key)
        if (old) body[old.path] = old.entry
        const i = changes.findIndex((x) => x.path === p.path)
        if (i >= 0) changes.splice(i, 1)
      }
    }
    if (changes.length === 0 && dels.length === 0) return "done"

    const header: Record<string, number> = {}
    for (const entry of Object.values(body)) {
      const ids = entry.parts ?? [entry.id]
      const sizes = storedSizes(entry, ps)
      ids.forEach((id, i) => (header[id] = view.header[id] ?? sizes[i]!))
    }
    const index: IndexFile = { v: 1, blobs: header, body: await encodeBody(this.ctx.keys, body) }

    let etag: string | null = null
    for (let attempt = 0; etag === null; attempt++) {
      this.checkStopped()
      try {
        etag = (await this.ctx.api.commit(index, view.etag)).etag
      } catch (e) {
        if (isApiError(e, "stale")) return "stale"
        if (isApiError(e, "missing") && attempt < 3) {
          // Not stored, or the sweep deleted an old upload: send those again, then the same commit.
          if (!(await uploader.reupload(e.missing ?? []))) return "stale"
          continue
        }
        throw e
      }
    }
    // Saved: mark the paths this device changed as synced, one by one.
    for (const c of changes) this.state.setSynced({ path: c.path, entry: c.entry })
    for (const d of dels) this.state.deleteSynced(d.key)
    for (const id of Object.keys(header)) this.state.dropUploaded(id)
    this.server = makeView(etag, header, body)
    await this.state.flush()
    return "done"
  }
}

/**
 * The entry for a file after a move: the old id carries over only if the file was what the entry says
 * right before the move. Otherwise id "" and mtime -1 make the next upload or scan hash it first.
 */
function carry(entry: IndexEntry | undefined, before: FileStat | null, after: FileStat): IndexEntry {
  if (entry && before && sameStat(before, entry)) return { ...entry, size: after.size, mtime: after.mtime }
  return { id: "", size: after.size, mtime: -1 }
}

function sigOf(files: IgnoreFile[]): string {
  return JSON.stringify([...files].sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)).map((f) => [f.dir, f.content]))
}

function isUnder(dir: string, root: string): boolean {
  return pathKey(dir) === pathKey(root) || pathKey(dir).startsWith(pathKey(root) + "/")
}

/** Paths whose disk entry differs between two disk indexes (restricted to keys matching `scope`). */
function diffDisk(before: Map<string, DiskRec>, after: Map<string, DiskRec>, scope: (k: string) => boolean): string[] {
  const out: string[] = []
  for (const [k, r] of after) {
    if (!scope(k)) continue
    const b = before.get(k)
    if (!b || b.path !== r.path || b.entry.id !== r.entry.id || !!b.skipped !== !!r.skipped) out.push(r.path)
  }
  for (const [k, r] of before) if (scope(k) && !after.has(k)) out.push(r.path)
  return out
}
