// Uploading blobs: content ids step by step. See spec 12-implementation.md, Content ids, step by step.
// Memory: at most the part being read (one part) and the batch (32 MiB).
import type { IndexEntry, UploadItem } from "@pappdrive/protocol"
import { BLOB_OVERHEAD, MAX_IDS_PER_CALL } from "@pappdrive/protocol"
import { blobId, encryptBlob, sha256, type DataKeys } from "./crypto.js"
import { toBase64 } from "./bytes.js"
import { SyncError } from "./errors.js"
import { putBlob } from "./r2.js"
import { sameStat } from "./scan.js"
import type { LocalState } from "./state.js"
import type { FolderApi, FsAdapter } from "./types.js"

export const BATCH_BYTES = 32 * 1024 * 1024
const PUT_CONCURRENCY = 4

/** Where a blob's plaintext lives on disk, so a 422 can upload it again. */
export interface BlobSource {
  path: string
  offset: number
  length: number
}

export type AddResult = { entry: IndexEntry } | "changed" | "missing"

export class Uploader {
  private batch: { item: UploadItem; data: Uint8Array }[] = []
  private batchBytes = 0
  private inBatch = new Set<string>()
  /** Every blob id of every file added, with where to read it again. */
  readonly sources = new Map<string, BlobSource>()

  constructor(
    private readonly fs: FsAdapter,
    private readonly keys: DataKeys,
    private readonly api: FolderApi,
    private readonly state: LocalState,
    private readonly partSize: number,
    /** The server header: ids in it are stored already. */
    private readonly header: Record<string, number>,
  ) {}

  private needed(id: string): boolean {
    return this.header[id] === undefined && !this.state.isUploaded(id) && !this.inBatch.has(id)
  }

  /**
   * Adds the blobs of one file, as the disk index records it. Reads only parts that need uploading,
   * and checks each part read against its id. "changed": the file is not what the disk index says;
   * the caller hashes it again and retries.
   */
  async addFile(path: string, entry: IndexEntry): Promise<AddResult> {
    const before = await this.fs.stat(path)
    if (!before) return "missing"
    if (!sameStat(before, entry)) return "changed"
    const ids = entry.parts ?? [entry.id]
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      const offset = i * this.partSize
      const length = Math.min(this.partSize, entry.size - offset)
      this.sources.set(id, { path, offset, length: Math.max(0, length) })
      if (!this.needed(id)) continue
      const data = await this.fs.read(path, offset, Math.max(0, length))
      if ((await blobId(this.keys, data)) !== id) return "changed"
      await this.addBlob(id, data)
    }
    const after = await this.fs.stat(path)
    if (!after) return "missing"
    if (!sameStat(after, before)) return "changed"
    return { entry }
  }

  /** Uploads these ids again (a 422 named them missing). false: a file changed under us. */
  async reupload(ids: string[]): Promise<boolean> {
    for (const id of ids) {
      this.state.dropUploaded(id)
      const src = this.sources.get(id)
      if (!src) return false
      const data = await this.fs.read(src.path, src.offset, src.length)
      if ((await blobId(this.keys, data)) !== id) return false
      if (!this.inBatch.has(id)) await this.addBlob(id, data, true)
    }
    await this.flush()
    return true
  }

  private async addBlob(id: string, plaintext: Uint8Array, force = false): Promise<void> {
    const size = plaintext.length + BLOB_OVERHEAD
    if (this.batch.length >= MAX_IDS_PER_CALL || (this.batch.length > 0 && this.batchBytes + size > BATCH_BYTES)) await this.flush()
    if (!force && !this.needed(id)) return
    const data = await encryptBlob(this.keys, plaintext)
    const item: UploadItem = { id, size: data.length, sha256: toBase64(await sha256(data)) }
    this.batch.push({ item, data })
    this.batchBytes += data.length
    this.inBatch.add(id)
  }

  /** Asks for links and uploads what is in the batch. */
  async flush(): Promise<void> {
    if (this.batch.length === 0) return
    const batch = this.batch
    this.batch = []
    this.batchBytes = 0
    try {
      const links = await this.api.uploadLinks(batch.map((b) => b.item))
      const byId = new Map(links.map((l) => [l.id, l]))
      let next = 0
      const worker = async () => {
        while (next < batch.length) {
          const b = batch[next++]!
          const link = byId.get(b.item.id)
          if (!link) throw new SyncError("server", `The server sent no upload link for blob ${b.item.id}. The next sync tries again.`)
          await putBlob(link, b.data)
          this.state.markUploaded(b.item.id)
        }
      }
      await Promise.all(Array.from({ length: Math.min(PUT_CONCURRENCY, batch.length) }, worker))
    } finally {
      for (const b of batch) this.inBatch.delete(b.item.id)
      await this.state.flush()
    }
  }
}

/** The stored (encrypted) size of each blob of an entry, in order. */
export function storedSizes(entry: IndexEntry, partSize: number): number[] {
  if (!entry.parts) return [entry.size + BLOB_OVERHEAD]
  return entry.parts.map((_, i) => Math.min(partSize, entry.size - i * partSize) + BLOB_OVERHEAD)
}
