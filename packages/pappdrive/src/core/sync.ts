// One sync round, top-down as in spec 06-sync.md, One sync round:
//   1. fetch the server index  2. decide  3-4. apply the server's changes and conflicts  5. upload  6-7. commit.
// The folder (folder.ts) owns scheduling and the Files API; the scanner (scan.ts) keeps the disk index current.
import type { IndexBody, IndexEntry, IndexFile, IndexLinkResponse } from "@pappdrive/protocol"
import { BLOB_OVERHEAD, ID_RE } from "@pappdrive/protocol"
import { toHex } from "./bytes.js"
import { decodeBody, encodeBody, randomBytes } from "./crypto.js"
import { decide, dirKeysOf, findClashes, type CommitPath, type Decision } from "./decide.js"
import { downloadAll } from "./download.js"
import { ApiError, SyncError } from "./errors.js"
import type { Tuning } from "./folder.js"
import { baseName, conflictName, parentOf, pathKey, pathProblem } from "./paths.js"
import { getIndex, R2Error, type IndexFetch } from "./r2.js"
import { hashFile, joinPath, sameStat, type Scanner } from "./scan.js"
import { serverView, type DiskRec, type LocalState, type Rec, type ServerView } from "./state.js"
import type { Change, FileStat, FolderContext } from "./types.js"
import { Uploader } from "./upload.js"

/** Commits that keep coming back stale: give up for this round. */
const ROUND_TRIES = 8

/** Thrown inside a round once the folder stops (close or markDeleted). */
class Stopped extends Error {}

/** A file to download. `path` and `entry` are the server's. */
interface Job {
  key: string
  path: string
  entry: IndexEntry
  /** Where it goes on this disk. */
  target: string
  /** The disk entry the decision was based on; undefined when the path was missing here. */
  expected: DiskRec | undefined
  /** A conflict that already fired its change. */
  quiet: boolean
}

export class SyncEngine {
  /** The first download failure of the last round, for status. The round itself goes on. */
  downloadError: Error | null = null
  /** Paths frozen on this device as of the last round: bad names, or names this system cannot create. */
  skippedPaths: string[] = []
  private link: IndexLinkResponse | null = null
  private locks = new Map<string, Promise<void>>()

  constructor(
    private readonly ctx: FolderContext,
    private readonly tuning: Tuning,
    private readonly state: LocalState,
    private readonly scanner: Scanner,
    private readonly fire: (change: Change) => void,
    private readonly isStopped: () => boolean,
  ) {}

  /**
   * One round. `local`: also send this device's changes (false while the debounce waits).
   * A stale commit (another device committed first) runs the round again.
   */
  async round(local: boolean): Promise<"done" | "stopped"> {
    this.downloadError = null
    try {
      for (let i = 0; i < ROUND_TRIES; i++) if ((await this.roundOnce(local)) === "done") return "done"
      throw new SyncError("server", "Other devices kept committing first, so this device's changes wait. The next sync tries again.")
    } catch (e) {
      if (e instanceof Stopped) return "stopped"
      throw e
    } finally {
      if (!this.isStopped()) await this.state.flush()
    }
  }

  private async roundOnce(local: boolean): Promise<"done" | "stale"> {
    const { readOnly, fs, platform } = this.ctx
    // 1. The server index.
    const view = await this.fetchIndex()
    // Each round starts by reading the .pappignore files. Without a watcher keeping disk current, it scans too.
    await this.scanner.refreshRules()
    if (this.scanner.needsFullScan || (fs.kind === "visible" && !platform.watcher)) {
      for (const p of await this.scanner.scan()) if (!this.scanner.isIgnored(p)) this.fire({ path: p, origin: "local" })
    }
    this.checkStopped()

    // 2. The decision table. A file and a folder with the same name: this device's side moves, and the table runs again.
    const frozen = this.frozenKeys(view)
    let decisions = this.decideAll(view, frozen)
    if (!readOnly && (await this.resolveClashes(decisions, view))) decisions = this.decideAll(view, frozen)

    // 3, 4. What came from the server: conflicts, downloads, local deletes.
    await this.applyServer(decisions)
    if (!local || readOnly) return "done"

    // 5-7. This device's changes, conflict copies included: the table once more, now that the server's changes are here.
    return this.commitLocal(view, this.decideAll(view, frozen))
  }

  // ---------------- 1. Fetch ----------------

  private async fetchIndex(): Promise<ServerView> {
    const { api, keys, readOnly } = this.ctx
    let fetched: IndexFetch
    for (let attempt = 0; ; attempt++) {
      if (!this.link || this.link.expires - 60_000 < this.tuning.now()) this.link = await api.indexLink()
      try {
        fetched = await getIndex(this.link.url, this.state.server?.etag ?? null)
        break
      } catch (e) {
        // An expired or refused read link: get a new one and try once more.
        if (attempt > 0 || !(e instanceof R2Error && [400, 401, 403].includes(e.status))) throw e
        this.link = null
      }
    }
    this.checkStopped()
    if (fetched.kind === "unchanged") return this.state.server! // it sent this view's ETag
    if (fetched.kind === "found") {
      return (this.state.server = serverView(fetched.etag, fetched.index.blobs, await decodeBody(keys, fetched.index.body)))
    }
    this.state.server = null
    // No index. Read-only, or never synced: an empty folder.
    if (readOnly || this.state.synced.size === 0) return serverView(null, {}, {})
    // The folder was deleted, or something is badly wrong. Never treat it as an empty server.
    if ((await this.ctx.checkGone()) === "gone" || this.isStopped()) throw new Stopped()
    throw new SyncError(
      "server",
      "The folder's index is missing on the server although this device synced before. " +
        "Nothing was uploaded, so the folder is not rebuilt by mistake. The next sync checks again.",
    )
  }

  // ---------------- 2. Decide ----------------

  /** Paths frozen on this device: bad names on disk, or server names this system cannot create. Reports new ones. */
  private frozenKeys(view: ServerView): Set<string> {
    const frozen = new Set<string>()
    const skipped: string[] = []
    for (const [key, d] of this.state.disk) {
      if (!d.skipped) continue
      frozen.add(key)
      skipped.push(d.path)
    }
    for (const [key, v] of view.map) {
      if (frozen.has(key)) continue
      if (this.scanner.rules.isHard(v.path)) frozen.add(key) // never comes onto a device; kept on the server as it is
      else if (pathProblem(v.path) || v.path.split("/").some((seg) => !this.ctx.fs.canCreate(seg))) {
        frozen.add(key)
        skipped.push(v.path)
      }
    }
    const reported = new Set(this.skippedPaths)
    for (const p of skipped) if (!reported.has(p)) this.fire({ path: p, origin: "skipped", reason: "bad name" })
    this.skippedPaths = skipped.sort()
    return frozen
  }

  private decideAll(view: ServerView, frozen: Set<string>): Decision[] {
    return decide({ disk: this.state.disk, synced: this.state.synced, server: view.map, frozen, readOnly: this.ctx.readOnly })
  }

  /**
   * A file and a folder with the same name, in the paths this device would commit (the server index plus its own changes).
   * The server's side keeps the name; this device's side moves. Returns true if anything moved.
   */
  private async resolveClashes(decisions: Decision[], view: ServerView): Promise<boolean> {
    const uploads = decisions.filter((d) => d.action === "upload")
    if (uploads.length === 0) return false
    const mine = new Set(decisions.filter((d) => d.action === "upload" || d.action === "delete-server").map((d) => d.key))
    const paths: CommitPath[] = []
    for (const [key, v] of view.map) if (!mine.has(key)) paths.push({ key, path: v.path, local: false })
    for (const d of uploads) paths.push({ key: d.key, path: d.disk!.path, local: true })
    const clashes = findClashes(paths)
    if (clashes.length === 0) return false

    const when = new Date(this.tuning.now())
    for (const c of clashes) {
      this.checkStopped()
      if (c.move === "file") {
        await this.conflictCopy(c.file.key, c.file.path)
        continue
      }
      // This device made the folder: the folder moves, with every file in it. A move changes paths only.
      const prefix = c.file.key + "/"
      const localDir = c.inside[0]!.path.split("/").slice(0, c.file.key.split("/").length).join("/")
      // Files the server deleted from that folder go first, so they do not come back under the new name.
      const emptied = new Set<string>()
      for (const d of decisions) if (d.action === "delete-here" && d.key.startsWith(prefix)) await this.deleteHere(d, emptied)
      const dirs = dirKeysOf([...this.state.disk.values(), ...view.map.values(), ...this.state.synced.values()].map((r) => r.path))
      const newDir = conflictName(localDir, when, (k) => this.taken(k) || dirs.has(k), true)
      await this.ctx.fs.move(localDir, newDir)
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

  // ---------------- 3, 4. Apply the server's changes ----------------

  /**
   * Conflicts move this device's version aside first. Then downloads, then local deletes, so a renamed file
   * appears at its new path before it leaves the old one. A download whose path is blocked by a file or folder
   * that the deletes remove waits for them.
   */
  private async applyServer(decisions: Decision[]): Promise<void> {
    const spell = folderSpellings([...this.state.disk.values()].map((r) => r.path))
    const jobs: Job[] = []
    const deletes: Decision[] = []
    for (const dec of decisions) {
      this.checkStopped()
      const { key, disk: d, server: v } = dec
      // A download of the same contents only changes the spelling: a rename, like adopt.
      const action = dec.action === "download" && d?.entry.id === v!.entry.id ? "adopt" : dec.action
      switch (action) {
        case "conflict": {
          // The server keeps the path. This device's version moves beside it, and uploads as a new file.
          const moved = await this.conflictCopy(key, v!.path)
          jobs.push({ key, path: v!.path, entry: v!.entry, target: respell(v!.path, spell), expected: undefined, quiet: moved })
          break
        }
        case "download":
          jobs.push({ key, path: v!.path, entry: v!.entry, target: localTarget(v!.path, d, spell), expected: d, quiet: false })
          break
        case "adopt":
          await this.withLock(key, async () => {
            const live = this.state.disk.get(key)
            if (!live || live.entry.id !== v!.entry.id) return // changed since the decision: the next round looks again
            await this.renameLocal(live.path, localTarget(v!.path, live, spell))
            this.state.setSynced(v!)
          })
          break
        case "forget":
          this.state.deleteSynced(key)
          break
        case "delete-here":
          deletes.push(dec)
          break
        // upload and delete-server are this device's changes: see commitLocal
      }
    }

    const keep = new Set<string>() // temp files of downloads that did not finish, for the next round
    const blocked = this.blockedChecker()
    const now: Job[] = []
    const later: Job[] = []
    for (const j of jobs) (blocked(j.target) ? later : now).push(j)
    await this.download(now, keep)
    this.checkStopped()

    const emptied = new Set<string>()
    for (const dec of deletes) await this.deleteHere(dec, emptied)
    for (const dir of emptied) if (dir !== "") await this.ctx.fs.removeEmptyDirs(dir)

    const stillBlocked = this.blockedChecker()
    for (const j of later) if (stillBlocked(j.target)) keep.add(j.entry.id)
    await this.download(later.filter((j) => !stillBlocked(j.target)), keep)
    this.checkStopped()

    // A download temp file (named by a file id) that no download needs any more is deleted. Write temps (`w-…`) are the folder's.
    for (const t of await this.ctx.fs.tempList()) if (ID_RE.test(t) && !keep.has(t)) await this.ctx.fs.tempRemove(t)
    await this.state.flush()
  }

  private async download(jobs: Job[], keep: Set<string>): Promise<void> {
    let flushed = this.tuning.now()
    await downloadAll(jobs, {
      ctx: this.ctx,
      partSize: this.tuning.partSize,
      now: this.tuning.now,
      isStopped: this.isStopped,
      land: async (job, temp) => {
        await this.land(job, temp)
        // Disk and synced are saved as files land, so a crash halfway keeps what arrived.
        if (this.tuning.now() - flushed > 2000) {
          flushed = this.tuning.now()
          await this.state.flush()
        }
      },
      // A file that did not arrive keeps its old synced entry, so the next round tries again.
      onError: (job, e) => {
        keep.add(job.entry.id)
        this.downloadError ??= e
      },
    })
  }

  /** Moves a downloaded temp file into place. If someone saved the path since the decision, that save becomes a conflict copy. */
  private async land(j: Job, temp: string): Promise<void> {
    const { fs, keys } = this.ctx
    await this.withLock(j.key, async () => {
      this.checkStopped()
      const live = this.state.disk.get(j.key)
      let copy: string | undefined
      if (!(await this.unchangedSince(j.expected, live, j.target))) {
        const here = live?.path ?? j.expected?.path ?? j.target
        const h = await hashFile(fs, keys, here, this.tuning.partSize)
        if (typeof h === "object" && h.id === j.entry.id) {
          // Saved with the same contents: nothing to move.
          this.state.setDisk({ path: here, entry: h })
          this.state.setSynced({ path: j.path, entry: j.entry })
          await fs.tempRemove(temp)
          return
        }
        // "missing": deleted since the decision, and the download brings it back.
        if (h !== "missing") copy = await this.moveToConflictCopy(here, h === "changing" ? undefined : h)
      }
      // The same path with other capitals still here: on a case-insensitive disk rename it first, else remove it after.
      const old = this.state.disk.get(j.key)
      const respelled = old !== undefined && old.path !== j.target
      if (respelled && fs.caseInsensitive) await this.renameLocal(old.path, j.target)
      const st = await fs.moveTempInto(temp, j.target)
      if (respelled && !fs.caseInsensitive) await fs.remove(old.path)
      this.state.setDisk({ path: j.target, entry: { ...j.entry, size: st.size, mtime: st.mtime } })
      this.state.setSynced({ path: j.path, entry: j.entry })
      if (copy) this.fire({ path: j.target, origin: "conflict", copy })
      else if (!j.quiet) this.fire({ path: j.target, origin: "remote" })
    })
  }

  /** A local delete. An edit since the decision beats the delete: the file is hashed, so the next commit carries it. */
  private async deleteHere(dec: Decision, emptied: Set<string>): Promise<void> {
    const { fs, keys } = this.ctx
    const expected = dec.disk!
    await this.withLock(dec.key, async () => {
      this.checkStopped()
      const live = this.state.disk.get(dec.key)
      if (!live) {
        this.state.deleteSynced(dec.key) // gone here too
        return
      }
      if (await this.unchangedSince(expected, live, expected.path)) {
        await fs.remove(expected.path)
        this.state.deleteDisk(dec.key)
        this.state.deleteSynced(dec.key)
        emptied.add(parentOf(expected.path))
        this.fire({ path: expected.path, origin: "remote" })
        return
      }
      const h = await hashFile(fs, keys, live.path, this.tuning.partSize)
      if (typeof h === "object") this.state.setDisk({ path: live.path, entry: h })
    })
  }

  /**
   * Is the file still what the decision saw? Same size and mtime, or still missing for a new file.
   * Saved within the last two seconds: compare the hash too (some disks keep time to the second).
   */
  private async unchangedSince(expected: DiskRec | undefined, live: DiskRec | undefined, target: string): Promise<boolean> {
    const { fs, keys } = this.ctx
    if (!expected) return !live && (await fs.stat(target)) === null
    if (!live || live.entry.id !== expected.entry.id || live.path !== expected.path) return false
    const st = await fs.stat(expected.path)
    if (!st || !sameStat(st, expected.entry)) return false
    if (this.tuning.now() - st.mtime >= this.tuning.recentMs) return true
    const h = await hashFile(fs, keys, expected.path, this.tuning.partSize)
    return typeof h === "object" && h.id === expected.entry.id
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

  // ---------------- 5-7. Upload and commit this device's changes ----------------

  private async commitLocal(view: ServerView, decisions: Decision[]): Promise<"done" | "stale"> {
    const uploads = decisions.filter((d) => d.action === "upload")
    const deletes = decisions.filter((d) => d.action === "delete-server")
    if (uploads.length === 0 && deletes.length === 0) return "done"
    const { fs, keys, api } = this.ctx
    const ps = this.tuning.partSize

    // 5. Upload the blobs. A file that is not what its disk entry says is hashed again and tried again.
    const uploader = new Uploader(this.ctx, this.state, ps, view.header)
    const uploaded: Rec[] = []
    for (const dec of uploads) {
      this.checkStopped()
      let rec = this.state.disk.get(dec.key)
      for (let tries = 0; rec && tries < 4; tries++) {
        const r = await uploader.addFile(rec.path, rec.entry)
        if (r === "ok") {
          uploaded.push(rec)
          break
        }
        if (r === "missing") break // gone since: the next round sees the delete
        const h = await hashFile(fs, keys, rec.path, ps)
        if (typeof h !== "object") break // gone, or still being written: the next round
        rec = { path: rec.path, entry: h }
        this.state.setDisk(rec)
      }
    }
    await uploader.flush()
    this.checkStopped()

    // 6. The commit: the server index with only this device's changes. Never the list of files on disk.
    const body: IndexBody = { ...view.body }
    for (const d of deletes) delete body[d.server!.path]
    const spell = folderSpellings(Object.keys(body))
    let changes: Rec[] = []
    for (const rec of uploaded) {
      const old = view.map.get(pathKey(rec.path))
      if (old) delete body[old.path]
      const path = respell(rec.path, spell) // a new file in an existing folder uses that folder's spelling
      body[path] = rec.entry
      changes.push({ path, entry: rec.entry })
    }
    // A file and a folder with the same name must not reach the server (a write during this round can make one).
    // Such uploads wait for the next round.
    const changed = new Set(changes.map((c) => c.path))
    const held = new Set<string>()
    for (const c of findClashes(Object.keys(body).map((p) => ({ key: pathKey(p), path: p, local: changed.has(p) })))) {
      for (const p of [c.file, ...c.inside]) if (p.local) held.add(p.path)
    }
    for (const path of held) {
      delete body[path]
      const old = view.map.get(pathKey(path))
      if (old) body[old.path] = old.entry
    }
    changes = changes.filter((c) => !held.has(c.path))
    if (changes.length === 0 && deletes.length === 0) return "done"

    // The header: every blob id the body references, with its stored (encrypted) size.
    const header: Record<string, number> = {}
    for (const entry of Object.values(body)) {
      ;(entry.parts ?? [entry.id]).forEach((id, i) => (header[id] = view.header[id] ?? Math.min(ps, entry.size - i * ps) + BLOB_OVERHEAD))
    }
    const index: IndexFile = { v: 1, blobs: header, body: await encodeBody(keys, body) }

    // 7. Send it with the server index's ETag.
    let etag: string
    for (let attempt = 0; ; attempt++) {
      this.checkStopped()
      try {
        etag = (await api.commit(index, view.etag)).etag
        break
      } catch (e) {
        if (!(e instanceof ApiError)) throw e
        if (e.error === "stale") return "stale"
        if (e.error !== "missing" || attempt >= 3) throw e
        // Not stored, or the sweep deleted an old upload: upload those again, then send the same commit.
        if (!(await uploader.reupload(e.missing ?? []))) return "stale"
      }
    }
    // Saved: mark the paths this device changed as synced, one by one.
    for (const c of changes) this.state.setSynced(c)
    for (const d of deletes) this.state.deleteSynced(d.key)
    for (const id of Object.keys(header)) this.state.dropUploaded(id)
    this.state.server = serverView(etag, header, body)
    await this.state.flush()
    return "done"
  }

  // ---------------- Moves on disk ----------------

  /** Moves this device's version of a path aside as a conflict copy, and fires the conflict. False if it is gone already. */
  private async conflictCopy(key: string, path: string): Promise<boolean> {
    const copy = await this.withLock(key, async () => {
      const live = this.state.disk.get(key)
      return live && this.moveToConflictCopy(live.path, live.entry)
    })
    if (copy) this.fire({ path, origin: "conflict", copy })
    return copy !== undefined
  }

  /** Moves a local file beside its path as a conflict copy. It becomes a new file to upload. */
  private async moveToConflictCopy(path: string, entry: IndexEntry | undefined): Promise<string> {
    const { fs } = this.ctx
    const when = new Date(this.tuning.now())
    const onDisk = new Set<string>()
    let copy = conflictName(path, when, (k) => this.taken(k) || onDisk.has(k))
    while (await fs.stat(copy)) {
      onDisk.add(pathKey(copy))
      copy = conflictName(path, when, (k) => this.taken(k) || onDisk.has(k))
    }
    const before = await fs.stat(path)
    await fs.move(path, copy)
    this.state.deleteDisk(pathKey(path))
    const after = await fs.stat(copy)
    if (after && !this.scanner.isIgnored(copy)) this.state.setDisk({ path: copy, entry: carry(entry, before, after) })
    return copy
  }

  /** Renames a file here. A change of capitals only goes through a temp name on a case-insensitive disk. */
  private async renameLocal(from: string, to: string): Promise<void> {
    if (from === to) return
    const { fs } = this.ctx
    const before = await fs.stat(from)
    if (fs.caseInsensitive && pathKey(from) === pathKey(to)) {
      const tmp = `${from}.pappdrive-rename-${toHex(randomBytes(4))}`
      await fs.move(from, tmp)
      await fs.move(tmp, to)
    } else await fs.move(from, to)
    const rec = this.state.disk.get(pathKey(from))
    this.state.deleteDisk(pathKey(from))
    const after = await fs.stat(to)
    if (rec && after) this.state.setDisk({ path: to, entry: carry(rec.entry, before, after) })
  }

  /** In use on any side: a conflict copy must not take the name. */
  private taken(key: string): boolean {
    return this.state.disk.has(key) || this.state.isKnown(key)
  }

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

  private checkStopped(): void {
    if (this.isStopped()) throw new Stopped()
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

/** Where a server path goes on this disk: beside the file it replaces, else in folders spelled as they are here. */
function localTarget(serverPath: string, d: DiskRec | undefined, spell: Map<string, string>): string {
  return d ? joinPath(parentOf(d.path), baseName(serverPath)) : respell(serverPath, spell)
}

/** Folder key -> spelling, for every folder above these paths. The first spelling seen wins. */
function folderSpellings(paths: string[]): Map<string, string> {
  const spell = new Map<string, string>()
  for (const p of paths) {
    const segs = p.split("/")
    for (let i = 1; i < segs.length; i++) {
      const dir = segs.slice(0, i).join("/")
      if (!spell.has(pathKey(dir))) spell.set(pathKey(dir), dir)
    }
  }
  return spell
}

/** The path with each folder spelled as in `spell`. A folder not in it keeps its own spelling, which is added. */
function respell(path: string, spell: Map<string, string>): string {
  const segs = path.split("/")
  let out = ""
  for (const seg of segs.slice(0, -1)) {
    const key = pathKey(joinPath(out, seg))
    out = spell.get(key) ?? joinPath(out, seg)
    spell.set(key, out)
  }
  return joinPath(out, segs.at(-1)!)
}
