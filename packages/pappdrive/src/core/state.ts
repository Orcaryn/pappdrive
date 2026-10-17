// The three states of spec 05-client.md, Local state: disk and synced, stored in the hidden folder, and the
// server index as last fetched, in memory only. Plus the blobs this device uploaded but has not committed yet.
// disk and synced are stored in the index body format: { v: 1, files: { <path>: IndexEntry } }.
// In memory every map is keyed by pathKey (NFC + lowercase), so the decision table matches paths without capitals.
import type { IndexBody, IndexEntry } from "@pappdrive/protocol"
import { SWEEP_GRACE_MS } from "@pappdrive/protocol"
import { pathKey } from "./paths.js"
import type { FsAdapter } from "./types.js"

/** A path as spelled in its own place (disk, synced or server), with its entry. */
export interface Rec {
  path: string
  entry: IndexEntry
}

/** A disk entry. `entry.mtime` and `entry.size` are the local file's, for the scan cache. */
export interface DiskRec extends Rec {
  /** The name breaks the path rules: the whole path is frozen. */
  skipped?: "bad name"
}

/** The server index as last fetched. */
export interface ServerView {
  etag: string | null
  header: Record<string, number>
  body: IndexBody
  /** The body by pathKey. Two spellings of one path: the first one sorted wins. */
  map: Map<string, Rec>
}

export function serverView(etag: string | null, header: Record<string, number>, body: IndexBody): ServerView {
  const map = new Map<string, Rec>()
  for (const path of Object.keys(body).sort()) {
    const key = pathKey(path)
    if (!map.has(key)) map.set(key, { path, entry: body[path]! })
  }
  return { etag, header, body, map }
}

const STATE_VERSION = 1
/** Uploaded blobs count as stored for a little less than the sweep's grace, so a commit has time to land. */
const UPLOADED_TRUST_MS = SWEEP_GRACE_MS - 3600_000

export class LocalState {
  disk = new Map<string, DiskRec>()
  synced = new Map<string, Rec>()
  server: ServerView | null = null
  /** Blob id -> when this device uploaded it. Dropped once a commit includes it. */
  private uploaded = new Map<string, number>()
  private dirty = { disk: false, synced: false, uploaded: false }
  private flushing: Promise<void> = Promise.resolve()

  constructor(
    private readonly fs: FsAdapter,
    private readonly now: () => number,
  ) {}

  async load(): Promise<void> {
    this.disk = parseFiles(await this.fs.loadState("disk"))
    this.synced = parseFiles(await this.fs.loadState("synced"))
    const blobs = parseState<{ blobs: Record<string, number> }>(await this.fs.loadState("uploaded"))?.blobs ?? {}
    const cutoff = this.now() - UPLOADED_TRUST_MS
    this.uploaded = new Map(Object.entries(blobs).filter(([, t]) => t > cutoff))
  }

  /** In synced or in the server index: such a path is never ignored (the git rule). */
  isKnown(key: string): boolean {
    return this.synced.has(key) || !!this.server?.map.has(key)
  }

  setDisk(rec: DiskRec): void {
    this.disk.set(pathKey(rec.path), rec)
    this.dirty.disk = true
  }
  deleteDisk(key: string): void {
    if (this.disk.delete(key)) this.dirty.disk = true
  }
  replaceDisk(map: Map<string, DiskRec>): void {
    this.disk = map
    this.dirty.disk = true
  }
  setSynced(rec: Rec): void {
    this.synced.set(pathKey(rec.path), rec)
    this.dirty.synced = true
  }
  deleteSynced(key: string): void {
    if (this.synced.delete(key)) this.dirty.synced = true
  }
  markUploaded(id: string): void {
    this.uploaded.set(id, this.now())
    this.dirty.uploaded = true
  }
  dropUploaded(id: string): void {
    if (this.uploaded.delete(id)) this.dirty.uploaded = true
  }
  /** Uploaded by this device recently enough that the sweep has not deleted it. */
  isUploaded(id: string): boolean {
    const t = this.uploaded.get(id)
    return t !== undefined && t > this.now() - UPLOADED_TRUST_MS
  }

  /** Writes whatever changed. Each file is replaced atomically by the adapter. One flush at a time. */
  flush(): Promise<void> {
    const run = this.flushing.then(() => this.flushNow())
    this.flushing = run.catch(() => {})
    return run
  }

  private async flushNow(): Promise<void> {
    if (this.dirty.disk) {
      this.dirty.disk = false
      await this.fs.saveState("disk", serializeFiles(this.disk))
    }
    if (this.dirty.synced) {
      this.dirty.synced = false
      await this.fs.saveState("synced", serializeFiles(this.synced))
    }
    if (this.dirty.uploaded) {
      this.dirty.uploaded = false
      await this.fs.saveState("uploaded", JSON.stringify({ v: STATE_VERSION, blobs: Object.fromEntries(this.uploaded) }))
    }
  }
}

function parseState<T>(text: string | null): T | null {
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null // a broken state file counts as missing, which is always safe
  }
}

function parseFiles(text: string | null): Map<string, DiskRec> {
  const files = parseState<{ files: Record<string, IndexEntry & { skipped?: "bad name" }> }>(text)?.files ?? {}
  const out = new Map<string, DiskRec>()
  for (const [path, { skipped, ...entry }] of Object.entries(files)) out.set(pathKey(path), skipped ? { path, entry, skipped } : { path, entry })
  return out
}

function serializeFiles(map: Map<string, DiskRec>): string {
  const files: Record<string, IndexEntry & { skipped?: "bad name" }> = {}
  for (const rec of map.values()) files[rec.path] = rec.skipped ? { ...rec.entry, skipped: rec.skipped } : rec.entry
  return JSON.stringify({ v: STATE_VERSION, files })
}
