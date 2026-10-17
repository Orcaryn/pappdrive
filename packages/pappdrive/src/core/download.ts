// Downloading files into temp files in the hidden folder. See spec 06-sync.md, Applying changes from the server.
// Links per 100 ids, a few downloads at once, smallest first, at most 32 MiB of blobs in flight.
// A temp file is named by its file id. A big file comes part by part and continues from the last whole part.
import type { IndexEntry } from "@pappdrive/protocol"
import { BLOB_OVERHEAD, DOWNLOAD_LINK_SECONDS, MAX_IDS_PER_CALL } from "@pappdrive/protocol"
import { bigFileId, decryptBlob } from "./crypto.js"
import { SyncError } from "./errors.js"
import { getBlob } from "./r2.js"
import type { FolderApi, FolderContext } from "./types.js"

const IN_FLIGHT_BYTES = 32 * 1024 * 1024
const CONCURRENCY = 3
const LINK_TRUST_MS = (DOWNLOAD_LINK_SECONDS - 60) * 1000

interface DownloadOptions<J> {
  ctx: FolderContext
  partSize: number
  now: () => number
  isStopped: () => boolean
  /** Called with each file once its temp file is complete. Moves it into place. */
  land: (job: J, temp: string) => Promise<void>
  onError: (job: J, err: Error) => void
}

/** Downloads the jobs (smallest first) and lands each one as it completes. */
export async function downloadAll<J extends { entry: IndexEntry }>(jobs: J[], o: DownloadOptions<J>): Promise<void> {
  const { fs, keys, api } = o.ctx
  const ps = o.partSize
  const sorted = [...jobs].sort((a, b) => a.entry.size - b.entry.size)
  const links = new Links(api, sorted.flatMap((j) => j.entry.parts ?? [j.entry.id]), o.now)
  const budget = new Budget(IN_FLIGHT_BYTES)

  const fetchBlob = async (id: string, size: number): Promise<Uint8Array> => {
    const cost = size + BLOB_OVERHEAD
    await budget.take(cost)
    try {
      const pt = await decryptBlob(keys, await getBlob(await links.get(id)), id)
      if (pt.length !== size) throw new SyncError("server", `Blob ${id} has the wrong size. The next sync fetches the index again.`)
      return pt
    } finally {
      budget.give(cost)
    }
  }

  const fetchToTemp = async (entry: IndexEntry): Promise<string> => {
    const temp = entry.id
    if (!entry.parts) {
      if ((await fs.tempSize(temp)) === entry.size) return temp // finished in an earlier round
      const pt = await fetchBlob(entry.id, entry.size)
      await fs.tempRemove(temp)
      await fs.tempAppend(temp, pt)
      return temp
    }
    // A big file: check the part list against the file id, then continue from the last whole part.
    if ((await bigFileId(keys, entry.parts)) !== entry.id) {
      throw new SyncError("server", "A big file's part list does not match its file id. The next sync fetches the index again.")
    }
    const have = (await fs.tempSize(temp)) ?? 0
    const whole = have > entry.size ? 0 : Math.floor(have / ps)
    if (have !== whole * ps) await fs.tempTruncate(temp, whole * ps)
    for (let i = whole; i < entry.parts.length; i++) {
      if (o.isStopped()) throw new SyncError("network", "Sync stopped during a download. It continues from the last whole part next time.")
      await fs.tempAppend(temp, await fetchBlob(entry.parts[i]!, Math.min(ps, entry.size - i * ps)))
    }
    return temp
  }

  let next = 0
  const worker = async () => {
    while (next < sorted.length && !o.isStopped()) {
      const job = sorted[next++]!
      try {
        const temp = await fetchToTemp(job.entry)
        if (o.isStopped()) return
        await o.land(job, temp)
      } catch (e) {
        o.onError(job, e as Error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sorted.length) }, worker))
}

/** Bytes in flight. A blob bigger than the budget still goes, alone. */
class Budget {
  private used = 0
  private waiters: (() => void)[] = []
  constructor(private readonly max: number) {}
  async take(n: number): Promise<void> {
    while (this.used > 0 && this.used + n > this.max) await new Promise<void>((r) => this.waiters.push(r))
    this.used += n
  }
  give(n: number): void {
    this.used -= n
    for (const wake of this.waiters.splice(0)) wake()
  }
}

/** Download links, fetched up to 100 at a time, ahead of need, in download order. */
class Links {
  private cache = new Map<string, { url: string; at: number }>()
  private pos = 0
  constructor(
    private readonly api: FolderApi,
    private readonly upcoming: string[],
    private readonly now: () => number,
  ) {}

  async get(id: string): Promise<string> {
    const fresh = (x: string) => {
      const hit = this.cache.get(x)
      return hit !== undefined && this.now() - hit.at < LINK_TRUST_MS
    }
    if (fresh(id)) return this.cache.get(id)!.url
    const ids = [id]
    while (ids.length < MAX_IDS_PER_CALL && this.pos < this.upcoming.length) {
      const next = this.upcoming[this.pos++]!
      if (!fresh(next) && !ids.includes(next)) ids.push(next)
    }
    const at = this.now()
    for (const l of await this.api.downloadLinks(ids)) this.cache.set(l.id, { url: l.url, at })
    return this.cache.get(id)!.url
  }
}
