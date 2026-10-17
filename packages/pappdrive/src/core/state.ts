// Local state in the hidden folder: disk, synced, uploaded, app. See spec 05-client.md, Local state.
// disk and synced are stored in the index body format: { v: 1, files: { <path>: IndexEntry } }.
// In memory both are keyed by pathKey (NFC + lowercase), so the decision table matches paths without capitals.
import type { IndexEntry } from "@pappdrive/protocol"
import { SWEEP_GRACE_MS } from "@pappdrive/protocol"
import type { FsAdapter } from "./types.js"
import { pathKey } from "./paths.js"

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

const STATE_VERSION = 1
/** Uploaded blobs count as stored for a little less than the sweep's grace, so a commit has time to land. */
export const UPLOADED_TRUST_MS = SWEEP_GRACE_MS - 3600_000

interface FilesFile {
  v: number
  files: Record<string, IndexEntry & { skipped?: "bad name" }>
}

function parseFiles(text: string | null): Map<string, DiskRec> {
  const out = new Map<string, DiskRec>()
  if (!text) return out
  let data: FilesFile
  try {
    data = JSON.parse(text) as FilesFile
  } catch {
    return out // a broken state file counts as missing, which is always safe
  }
  if (!data || data.v !== STATE_VERSION || typeof data.files !== "object") return out
  for (const [path, e] of Object.entries(data.files)) {
    if (!e || typeof e.id !== "string") continue
    const { skipped, ...entry } = e
    const rec: DiskRec = { path, entry }
    if (skipped) rec.skipped = skipped
    out.set(pathKey(path), rec)
  }
  return out
}

function serializeFiles(map: Map<string, DiskRec>): string {
  const files: FilesFile["files"] = {}
  for (const rec of map.values()) files[rec.path] = rec.skipped ? { ...rec.entry, skipped: rec.skipped } : rec.entry
  return JSON.stringify({ v: STATE_VERSION, files })
}

export class LocalState {
  disk = new Map<string, DiskRec>()
  synced = new Map<string, Rec>()
  /** Blob id -> when this device uploaded it. Dropped once a commit includes it. */
  uploaded = new Map<string, number>()
  private dirty = { disk: false, synced: false, uploaded: false }

  constructor(
    private readonly fs: FsAdapter,
    private readonly now: () => number,
  ) {}

  async load(): Promise<void> {
    this.disk = parseFiles(await this.fs.loadState("disk"))
    const synced = parseFiles(await this.fs.loadState("synced"))
    this.synced = new Map([...synced].map(([k, r]) => [k, { path: r.path, entry: r.entry }]))
    this.uploaded = new Map()
    const up = await this.fs.loadState("uploaded")
    if (up) {
      try {
        const data = JSON.parse(up) as { v: number; blobs: Record<string, number> }
        const cutoff = this.now() - UPLOADED_TRUST_MS
        for (const [id, t] of Object.entries(data.blobs ?? {})) if (t > cutoff) this.uploaded.set(id, t)
      } catch {
        // missing list: blobs upload again, R2 answers "already stored"
      }
    }
  }

  /** The app this folder belongs to, or null for a new folder. */
  async loadApp(): Promise<string | null> {
    const text = await this.fs.loadState("app")
    if (text === null) return null
    const t = text.trim()
    if (t.startsWith("{")) {
      try {
        return String((JSON.parse(t) as { app: string }).app)
      } catch {
        return t
      }
    }
    return t
  }

  saveApp(app: string): Promise<void> {
    return this.fs.saveState("app", app)
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
    this.synced.set(pathKey(rec.path), { path: rec.path, entry: rec.entry })
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

  private flushing: Promise<void> = Promise.resolve()

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
