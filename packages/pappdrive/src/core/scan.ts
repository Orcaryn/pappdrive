// Scanning the folder and hashing files. See spec 05-client.md (Local state, Path rules, Ignore rules)
// and 12-implementation.md (Content ids, step by step).
import type { IndexEntry } from "@pappdrive/protocol"
import { bigFileId, blobId, type DataKeys } from "./crypto.js"
import { SyncError } from "./errors.js"
import { IGNORE_FILE, type IgnoreFile, IgnoreRules } from "./ignore.js"
import { HIDDEN_DIR, pathKey, pathProblem } from "./paths.js"
import type { DiskRec } from "./state.js"
import type { FileStat, FsAdapter } from "./types.js"
import { concat, fromUtf8 } from "./bytes.js"

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
  if (partIds.length <= 1) return { id: partIds[0]!, size, mtime }
  return { id: await bigFileId(keys, partIds), size, mtime, parts: partIds }
}

export type HashResult = { entry: IndexEntry; stat: FileStat } | "missing" | "changing"

/**
 * Hashes a file part by part. Stats before the first read and after the last; if either moved,
 * the file is still being written and is hashed again. Gives up with "changing" after a few tries.
 */
export async function hashFile(fs: FsAdapter, keys: DataKeys, path: string, partSize: number, tries = 3): Promise<HashResult> {
  for (let i = 0; i < tries; i++) {
    const before = await fs.stat(path)
    if (!before) return "missing"
    const ids: string[] = []
    if (before.size === 0) ids.push(await blobId(keys, new Uint8Array(0)))
    for (let off = 0; off < before.size; off += partSize) {
      const data = await fs.read(path, off, Math.min(partSize, before.size - off))
      ids.push(await blobId(keys, data))
    }
    const after = await fs.stat(path)
    if (!after) return "missing"
    if (sameStat(after, before)) return { entry: await entryFromParts(keys, ids, before.size, before.mtime), stat: after }
  }
  return "changing"
}

export interface ScanOptions {
  fs: FsAdapter
  keys: DataKeys
  partSize: number
  /** Disk entries from before: a file whose size and mtime match is not hashed again. */
  prev: Map<string, DiskRec>
  /** Keys in synced or the server index: never ignored (the git rule). */
  known: Set<string>
  /** Folder keys above known paths: walked even when a rule ignores them. */
  knownDirs: Set<string>
  /** Spellings already in the index, preferred when two names differ only in capitals. */
  indexPaths: Map<string, string>
  /** .pappignore files outside the scanned folder (for a partial scan). */
  ignoreFiles?: IgnoreFile[]
}

export interface ScanResult {
  disk: Map<string, DiskRec>
  ignoreFiles: IgnoreFile[]
  rules: IgnoreRules
  /** Second names that differ from a synced one only in capitals. Not synced, reported. */
  caseDuplicates: string[]
  /** Files still being written: their old entry is kept, and they are looked at again later. */
  changing: string[]
  /** Folder -> path of its .pappignore, as spelled on disk. */
  ignorePaths: Map<string, string>
}

/**
 * Walks `root` ("" for the whole folder). Throws folder-taken on a hidden folder below the top
 * in a visible folder: that is another app's folder inside this one.
 */
export async function scanTree(opts: ScanOptions, root = ""): Promise<ScanResult> {
  const { fs } = opts
  const ignoreFiles: IgnoreFile[] = [...(opts.ignoreFiles ?? [])]
  let rules = new IgnoreRules(ignoreFiles)
  const found: DiskRec[] = []
  const changing: string[] = []
  const ignorePaths = new Map<string, string>()
  const visible = fs.kind === "visible"

  const ignoredUnknown = (path: string, dir: boolean) => {
    if (rules.isHard(path)) return true
    const key = pathKey(path)
    if (dir ? opts.knownDirs.has(key) : opts.known.has(key)) return false
    return rules.ignores(path, dir)
  }

  const walk = async (dir: string): Promise<void> => {
    const entries = (await fs.list(dir)).map((e) => ({ name: e.name.normalize("NFC"), dir: e.dir }))
    const pi = entries.find((e) => !e.dir && e.name.toLowerCase() === IGNORE_FILE)
    if (pi) {
      const path = joinPath(dir, pi.name)
      const st = await fs.stat(path)
      if (st) {
        const content = fromUtf8.decode(await readAll(fs, path, st.size, opts.partSize))
        const i = ignoreFiles.findIndex((f) => f.dir === dir)
        if (i >= 0) ignoreFiles.splice(i, 1)
        ignoreFiles.push({ dir, content })
        ignorePaths.set(dir, path)
        rules = new IgnoreRules(ignoreFiles)
      }
    }
    for (const e of entries) {
      const path = joinPath(dir, e.name)
      if (e.dir) {
        if (e.name.toLowerCase() === HIDDEN_DIR) {
          if (dir === "") continue
          if (visible) {
            throw new SyncError(
              "folder-taken",
              `"${path}" is another app's hidden folder, so another app's folder is inside this one. ` +
                `Two apps cannot sync the same files. Open a folder that does not contain "${dir}", or move that folder out.`,
            )
          }
          continue
        }
        if (ignoredUnknown(path, true)) continue
        await walk(path)
        continue
      }
      if (ignoredUnknown(path, false)) continue
      const key = pathKey(path)
      if (pathProblem(path)) {
        found.push({ path, entry: { id: "", size: 0, mtime: 0 }, skipped: "bad name" })
        continue
      }
      const prev = opts.prev.get(key)
      const st = await fs.stat(path)
      if (!st) continue // vanished since the listing
      if (prev && !prev.skipped && prev.path === path && sameStat(st, prev.entry)) {
        found.push(prev)
        continue
      }
      const h = await hashFile(fs, opts.keys, path, opts.partSize)
      if (h === "missing") continue
      if (h === "changing") {
        changing.push(path)
        if (prev) found.push(prev)
        continue
      }
      found.push({ path, entry: h.entry })
    }
  }

  await walk(root)

  // Names that differ only in capitals (a case-sensitive disk): keep the one in the index, else the first found.
  const disk = new Map<string, DiskRec>()
  const caseDuplicates: string[] = []
  const byKey = new Map<string, DiskRec[]>()
  for (const rec of found) {
    const key = pathKey(rec.path)
    const list = byKey.get(key)
    if (list) list.push(rec)
    else byKey.set(key, [rec])
  }
  for (const [key, list] of byKey) {
    let keep = list[0]!
    if (list.length > 1) {
      const indexed = opts.indexPaths.get(key)
      keep = list.find((r) => r.path === indexed) ?? keep
      for (const r of list) if (r !== keep) caseDuplicates.push(r.path)
    }
    disk.set(key, keep)
  }
  // A file and a folder whose names differ only in capitals, both here: the file does not sync.
  const dirs = new Set<string>()
  for (const key of disk.keys()) {
    const segs = key.split("/")
    for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join("/"))
  }
  for (const [key, rec] of disk) {
    if (dirs.has(key)) {
      disk.delete(key)
      caseDuplicates.push(rec.path)
    }
  }
  return { disk, ignoreFiles, rules, caseDuplicates, changing, ignorePaths }
}
