// Uploading blobs: content ids step by step. See spec 12-implementation.md, Content ids, step by step.
// Memory: at most the part being read (one part) and the batch (32 MiB).
import type { IndexEntry, UploadItem } from "@pappdrive/protocol"
import { BLOB_OVERHEAD, MAX_IDS_PER_CALL } from "@pappdrive/protocol"
import { toBase64 } from "./bytes.js"
import { blobId, encryptBlob, sha256 } from "./crypto.js"
import { putBlob } from "./r2.js"
import { sameStat } from "./scan.js"
import type { LocalState } from "./state.js"
import type { FolderContext } from "./types.js"

const BATCH_BYTES = 32 * 1024 * 1024
const PUT_CONCURRENCY = 4

export class Uploader {
  private batch: { item: UploadItem; data: Uint8Array }[] = []
  private batchBytes = 0
  private inBatch = new Set<string>()
  /** Every blob id of every file added, with where its plaintext is, so a 422 can upload it again. */
  private sources = new Map<string, { path: string; offset: number; length: number }>()

  constructor(
    private readonly ctx: FolderContext,
    private readonly state: LocalState,
    private readonly partSize: number,
    /** The server header: ids in it are stored already. */
    private readonly header: Record<string, number>,
  ) {}

  /**
   * Adds the blobs of one file, as the disk index records it. Reads only parts that need uploading,
   * and checks each part read against its id. "changed": the file is not what the disk index says;
   * the caller hashes it again and retries.
   */
  async addFile(path: string, entry: IndexEntry): Promise<"ok" | "changed" | "missing"> {
    const { fs, keys } = this.ctx
    const before = await fs.stat(path)
    if (!before) return "missing"
    if (!sameStat(before, entry)) return "changed"
    const ids = entry.parts ?? [entry.id]
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      const offset = i * this.partSize
      const length = Math.min(this.partSize, entry.size - offset)
      this.sources.set(id, { path, offset, length })
      if (!this.needed(id)) continue
      const data = await fs.read(path, offset, length)
      if ((await blobId(keys, data)) !== id) return "changed"
      await this.addBlob(id, data)
    }
    const after = await fs.stat(path)
    if (!after) return "missing"
    return sameStat(after, before) ? "ok" : "changed"
  }

  /** Uploads these ids again (a 422 named them missing). false: a file changed under us. */
  async reupload(ids: string[]): Promise<boolean> {
    for (const id of ids) {
      this.state.dropUploaded(id)
      const src = this.sources.get(id)
      if (!src) return false
      const data = await this.ctx.fs.read(src.path, src.offset, src.length)
      if ((await blobId(this.ctx.keys, data)) !== id) return false
      if (!this.inBatch.has(id)) await this.addBlob(id, data)
    }
    await this.flush()
    return true
  }

  /** Asks for links and uploads what is in the batch. */
  async flush(): Promise<void> {
    if (this.batch.length === 0) return
    const batch = this.batch
    this.batch = []
    this.batchBytes = 0
    try {
      const links = new Map((await this.ctx.api.uploadLinks(batch.map((b) => b.item))).map((l) => [l.id, l]))
      let next = 0
      const worker = async () => {
        while (next < batch.length) {
          const b = batch[next++]!
          await putBlob(links.get(b.item.id)!, b.data)
          this.state.markUploaded(b.item.id)
        }
      }
      await Promise.all(Array.from({ length: Math.min(PUT_CONCURRENCY, batch.length) }, worker))
    } finally {
      for (const b of batch) this.inBatch.delete(b.item.id)
      await this.state.flush()
    }
  }

  private needed(id: string): boolean {
    return this.header[id] === undefined && !this.state.isUploaded(id) && !this.inBatch.has(id)
  }

  private async addBlob(id: string, plaintext: Uint8Array): Promise<void> {
    const size = plaintext.length + BLOB_OVERHEAD
    if (this.batch.length >= MAX_IDS_PER_CALL || (this.batch.length > 0 && this.batchBytes + size > BATCH_BYTES)) await this.flush()
    const data = await encryptBlob(this.ctx.keys, plaintext)
    this.batch.push({ item: { id, size: data.length, sha256: toBase64(await sha256(data)) }, data })
    this.batchBytes += data.length
    this.inBatch.add(id)
  }
}
