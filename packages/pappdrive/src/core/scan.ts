// The disk side: hashing files, scanning the folder, the ignore rules, and the paths a watcher names.
// See spec 05-client.md (Local state, Path rules, Ignore rules, Watching a visible folder)
// and 12-implementation.md (Content ids, step by step).
import type { IndexEntry } from "@pappdrive/protocol"
import { concat, fromUtf8 } from "./bytes.js"
import { bigFileId, blobId, type DataKeys } from "./crypto.js"
import { dirKeysOf } from "./decide.js"
import { SyncError } from "./errors.js"
import { IGNORE_FILE, type IgnoreFile, IgnoreRules } from "./ignore.js"
import { baseName, HIDDEN_DIR, parentOf, pathKey, pathProblem } from "./paths.js"
import type { DiskRec, LocalState } from "./state.js"
import type { Change, FileStat, FolderContext, FsAdapter } from "./types.js"

/** Keeps the disk index (state.disk) and the ignore rules up to date with the folder. */
export class Scanner {
  rules = new IgnoreRules()
  /** The .pappignore files the rules came from, and where each one is (folder -> path as spelled on disk). */
  private ignoreFiles: IgnoreFile[] = []
  private ignorePaths = new Map<string, string>()
  /** The rules changed: the next round scans everything. */
  needsFullScan = false
  private reportedDups = new Set<string>()

  constructor(
    private readonly ctx: FolderContext,
    private readonly partSize: number,
    private readonly state: LocalState,
    private readonly fire: (change: Change) => void,
  ) {}

  /** Ignored and not synced yet. Hard-ignored paths (.git, the hidden folder) always are. */
  isIgnored(path: string): boolean {
    return this.rules.isHard(path) || (!this.state.isKnown(pathKey(path)) && this.rules.ignores(path))
  }

  /** Reads the .pappignore files again. Changed rules: the next round scans everything. */
  async refreshRules(): Promise<void> {
    const candidates = new Map(this.ignorePaths)
    for (const rec of this.state.disk.values()) {
      if (baseName(rec.path).toLowerCase() === IGNORE_FILE) candidates.set(parentOf(rec.path), rec.path)
    }
    const files: IgnoreFile[] = []
    const paths = new Map<string, string>()
    for (const [dir, path] of candidates) {
      const st = await this.ctx.fs.stat(path)
      if (!st) continue
      files.push({ dir, content: fromUtf8.decode(await readAll(this.ctx.fs, path, st.size, this.partSize)) })
      paths.set(dir, path)
    }
    if (rulesSignature(files) === rulesSignature(this.ignoreFiles)) return
    this.ignoreFiles = files
    this.ignorePaths = paths
    this.rules = new IgnoreRules(files)
    this.needsFullScan = true
  }

  /** Scans `root` ("" for the whole folder). Only changed files are hashed. Returns the paths whose disk entry changed. */
  async scan(root = ""): Promise<string[]> {
    const rootKey = pathKey(root)
    const under = (key: string) => root === "" || key === rootKey || key.startsWith(rootKey + "/")
    const found = await this.walk(root, under)

    const before = this.state.disk
    const after = new Map([...before].filter(([k]) => !under(k)))
    for (const [k, r] of found.disk) after.set(k, r)
    this.state.replaceDisk(after)
    this.ignoreFiles = found.ignoreFiles
    this.ignorePaths = new Map([...this.ignorePaths].filter(([dir]) => !under(pathKey(dir))))
    for (const [dir, path] of found.ignorePaths) this.ignorePaths.set(dir, path)
    this.rules = new IgnoreRules(this.ignoreFiles)
    this.reportDups(found.caseDuplicates)
    if (root === "") this.needsFullScan = false

    const changed: string[] = []
    for (const [k, r] of after) {
      const b = before.get(k)
      if (under(k) && (!b || b.path !== r.path || b.entry.id !== r.entry.id || !!b.skipped !== !!r.skipped)) changed.push(r.path)
    }
    for (const [k, r] of before) if (under(k) && !after.has(k)) changed.push(r.path)
    return changed
  }

  /**
   * Looks at paths a watcher (or another tab) named. Events are hints: each path is checked itself.
   * Returns the paths whose disk entry changed, and the ones still being written.
   */
  async processPaths(paths: string[]): Promise<{ changed: string[]; changing: string[] }> {
    const { fs, keys } = this.ctx
    const changed: string[] = []
    const changing: string[] = []
    let ignoreFileTouched = false
    for (const path of new Set(paths.map((p) => p.normalize("NFC").replace(/^\/+|\/+$/g, "")))) {
      if (path === "") {
        changed.push(...(await this.scan()))
        continue
      }
      if (this.rules.isHard(path)) continue
      if (baseName(path).toLowerCase() === IGNORE_FILE) ignoreFileTouched = true
      const key = pathKey(path)
      const rec = this.state.disk.get(key)
      const st = await fs.stat(path)
      if (st) {
        if (this.isIgnored(path)) continue
        if (pathProblem(path)) {
          if (!rec?.skipped) {
            this.state.setDisk({ path, entry: { id: "", size: 0, mtime: 0 }, skipped: "bad name" })
            changed.push(path)
          }
          continue
        }
        if (rec && rec.path === path && !rec.skipped && sameStat(st, rec.entry)) continue
        // A second spelling next to the one in the disk index (a case-sensitive disk): reported, not synced.
        if (rec && rec.path !== path && !fs.caseInsensitive && (await fs.stat(rec.path))) {
          this.reportDups([path])
          continue
        }
        const h = await hashFile(fs, keys, path, this.partSize)
        if (h === "changing") {
          changing.push(path)
          continue
        }
        if (h !== "missing") {
          this.state.setDisk({ path, entry: h })
          changed.push(path)
          continue
        }
      }
      // Gone, or a folder.
      if ((await fs.list(path)).length > 0) {
        changed.push(...(await this.scan(path)))
        continue
      }
      for (const [k, r] of [...this.state.disk]) {
        if ((k === key || k.startsWith(key + "/")) && !(await fs.stat(r.path))) {
          this.state.deleteDisk(k)
          changed.push(r.path)
        }
      }
    }
    if (ignoreFileTouched) await this.refreshRules()
    return { changed, changing }
  }

  /**
   * Walks `root` and hashes what changed. Throws folder-taken on a hidden folder below the top
   * in a visible folder: that is another app's folder inside this one.
   */
  private async walk(root: string, under: (key: string) => boolean) {
    const { fs, keys } = this.ctx
    // Paths in synced or the server index, as spelled there, and their folders: never ignored (the git rule).
    const known = new Map<string, string>()
    for (const [k, r] of [...(this.state.server?.map ?? []), ...this.state.synced]) known.set(k, r.path)
    const knownDirs = dirKeysOf(known.values())
    const ignoreFiles = this.ignoreFiles.filter((f) => !under(pathKey(f.dir)))
    const ignorePaths = new Map<string, string>()
    let rules = new IgnoreRules(ignoreFiles)
    const found: DiskRec[] = []

    const visit = async (dir: string): Promise<void> => {
      const entries = (await fs.list(dir)).map((e) => ({ name: e.name.normalize("NFC"), dir: e.dir }))
      const ignoreFile = entries.find((e) => !e.dir && e.name.toLowerCase() === IGNORE_FILE)
      if (ignoreFile) {
        const path = joinPath(dir, ignoreFile.name)
        const st = await fs.stat(path)
        if (st) {
          ignoreFiles.push({ dir, content: fromUtf8.decode(await readAll(fs, path, st.size, this.partSize)) })
          ignorePaths.set(dir, path)
          rules = new IgnoreRules(ignoreFiles)
        }
      }
      for (const e of entries) {
        const path = joinPath(dir, e.name)
        if (e.dir && e.name.toLowerCase() === HIDDEN_DIR) {
          if (dir !== "" && fs.kind === "visible") {
            throw new SyncError(
              "folder-taken",
              `"${path}" is another app's hidden folder, so another app's folder is inside this one. ` +
                `Two apps cannot sync the same files. Open a folder that does not contain "${dir}", or move that folder out.`,
            )
          }
          continue
        }
        if (rules.isHard(path) || (!(e.dir ? knownDirs : known).has(pathKey(path)) && rules.ignores(path, e.dir))) continue
        if (e.dir) {
          await visit(path)
          continue
        }
        if (pathProblem(path)) {
          found.push({ path, entry: { id: "", size: 0, mtime: 0 }, skipped: "bad name" })
          continue
        }
        const prev = this.state.disk.get(pathKey(path))
        const st = await fs.stat(path)
        if (!st) continue // vanished since the listing
        if (prev && !prev.skipped && prev.path === path && sameStat(st, prev.entry)) {
          found.push(prev)
          continue
        }
        const h = await hashFile(fs, keys, path, this.partSize)
        // Still being written: keep the old entry; the watcher or the next scan looks again.
        if (h === "changing") {
          if (prev) found.push(prev)
        } else if (h !== "missing") found.push({ path, entry: h })
      }
    }
    await visit(root)

    // Names that differ only in capitals (a case-sensitive disk): keep the one in the index, else the first found.
    const disk = new Map<string, DiskRec>()
    const caseDuplicates: string[] = []
    for (const rec of found) {
      const key = pathKey(rec.path)
      const had = disk.get(key)
      if (!had) disk.set(key, rec)
      else if (rec.path === known.get(key)) {
        disk.set(key, rec)
        caseDuplicates.push(had.path)
      } else caseDuplicates.push(rec.path)
    }
    // A file and a folder whose names differ only in capitals, both here: the file does not sync.
    for (const key of dirKeysOf(disk.keys())) {
      const rec = disk.get(key)
      if (!rec) continue
      disk.delete(key)
      caseDuplicates.push(rec.path)
    }
    return { disk, ignoreFiles, ignorePaths, caseDuplicates }
  }

  private reportDups(paths: string[]): void {
    for (const p of paths) {
      if (this.reportedDups.has(p)) continue
      this.reportedDups.add(p)
      this.fire({ path: p, origin: "case-duplicate" })
    }
  }
}

function rulesSignature(files: IgnoreFile[]): string {
  return JSON.stringify([...files].sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)).map((f) => [f.dir, f.content]))
}

// ---------------- Files ----------------

export function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`
}

export function sameStat(a: FileStat, b: { size: number; mtime: number }): boolean {
  return a.size === b.size && a.mtime === b.mtime
}

/** Reads a whole file, in parts of at most `chunk` bytes. */
export async function readAll(fs: FsAdapter, path: string, size: number, chunk: number): Promise<Uint8Array> {
  if (size <= chunk) return fs.read(path, 0, size)
  const parts: Uint8Array[] = []
  for (let off = 0; off < size; off += chunk) {
    const data = await fs.read(path, off, Math.min(chunk, size - off))
    if (data.length === 0) break
    parts.push(data)
  }
  return concat(...parts)
}

/** Builds the entry for contents cut into parts. One part: its blob id is the file id. */
export async function entryFromParts(keys: DataKeys, partIds: string[], size: number, mtime: number): Promise<IndexEntry> {
  if (partIds.length === 1) return { id: partIds[0]!, size, mtime }
  return { id: await bigFileId(keys, partIds), size, mtime, parts: partIds }
}

/**
 * Hashes a file part by part. Stats before the first read and after the last; if either moved,
 * the file is still being written and is hashed again. Gives up with "changing" after three tries.
 */
export async function hashFile(
  fs: FsAdapter,
  keys: DataKeys,
  path: string,
  partSize: number,
): Promise<IndexEntry | "missing" | "changing"> {
  for (let i = 0; i < 3; i++) {
    const before = await fs.stat(path)
    if (!before) return "missing"
    const ids: string[] = []
    if (before.size === 0) ids.push(await blobId(keys, new Uint8Array(0)))
    for (let off = 0; off < before.size; off += partSize) ids.push(await blobId(keys, await fs.read(path, off, Math.min(partSize, before.size - off))))
    const after = await fs.stat(path)
    if (!after) return "missing"
    if (sameStat(after, before)) return entryFromParts(keys, ids, before.size, before.mtime)
  }
  return "changing"
}
