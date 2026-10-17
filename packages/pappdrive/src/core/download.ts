// Downloading files into temp files in the hidden folder. See spec 06-sync.md, Applying changes from the server.
// Links per 100 ids, a few downloads at once, smallest first, at most 32 MiB of blobs in flight.
// A big file comes part by part into a temp file named by its file id, and continues from the last whole part.
import type { DownloadLink, IndexEntry } from "@pappdrive/protocol"
import { BLOB_OVERHEAD, DOWNLOAD_LINK_SECONDS, MAX_IDS_PER_CALL } from "@pappdrive/protocol"
import { bigFileId, decryptBlob, type DataKeys } from "./crypto.js"
import { SyncError } from "./errors.js"
import { getBlob } from "./r2.js"
import type { FolderApi, FsAdapter } from "./types.js"

export const IN_FLIGHT_BYTES = 32 * 1024 * 1024
const CONCURRENCY = 3
const LINK_TRUST_MS = (DOWNLOAD_LINK_SECONDS - 60) * 1000

export interface DownloadJob {
  key: string
  entry: IndexEntry
}

/** Temp file name for a downloaded file: its file id. */
export function tempNameFor(entry: IndexEntry): string {
  return entry.id
}

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
    const w = this.waiters
    this.waiters = []
    for (const f of w) f()
  }
}

/** Download links, fetched up to 100 at a time, ahead of need. */
class Links {
  private cache = new Map<string, { url: string; at: number }>()
  constructor(
    private readonly api: FolderApi,
    private readonly upcoming: string[],
    private readonly now: () => number,
  ) {}
  private pos = 0
  async get(id: string): Promise<string> {
    const hit = this.cache.get(id)
    if (hit && this.now() - hit.at < LINK_TRUST_MS) return hit.url
    const ids = [id]
    while (ids.length < MAX_IDS_PER_CALL && this.pos < this.upcoming.length) {
      const next = this.upcoming[this.pos++]!
      const c = this.cache.get(next)
      if (next !== id && !(c && this.now() - c.at < LINK_TRUST_MS) && !ids.includes(next)) ids.push(next)
    }
    const links: DownloadLink[] = await this.api.downloadLinks(ids)
    const at = this.now()
    for (const l of links) this.cache.set(l.id, { url: l.url, at })
    const got = this.cache.get(id)
    if (!got) throw new SyncError("server", `The server sent no download link for blob ${id}. The next sync tries again.`)
    return got.url
  }
}

export interface DownloadOptions {
  fs: FsAdapter
  keys: DataKeys
  api: FolderApi
  partSize: number
  now: () => number
  isStopped: () => boolean
  /** Called with each file once its temp file is complete. Moves it into place. */
  land: (job: DownloadJob, temp: string) => Promise<void>
  onError: (job: DownloadJob, err: unknown) => void
}

/** Downloads the jobs (smallest first) and lands each one as it completes. */
export async function downloadAll(jobs: DownloadJob[], o: DownloadOptions): Promise<void> {
  const sorted = [...jobs].sort((a, b) => a.entry.size - b.entry.size)
  const upcoming = sorted.flatMap((j) => j.entry.parts ?? [j.entry.id])
  const links = new Links(o.api, upcoming, o.now)
  const budget = new Budget(IN_FLIGHT_BYTES)
  let next = 0
  const worker = async () => {
    while (next < sorted.length && !o.isStopped()) {
      const job = sorted[next++]!
      try {
        const temp = await fetchToTemp(job, o, links, budget)
        if (o.isStopped()) return
        await o.land(job, temp)
      } catch (e) {
        o.onError(job, e)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sorted.length) }, worker))
}

async function fetchBlob(id: string, size: number, o: DownloadOptions, links: Links, budget: Budget): Promise<Uint8Array> {
  const cost = size + BLOB_OVERHEAD
  await budget.take(cost)
  try {
    const url = await links.get(id)
    const data = await getBlob(url)
    const pt = await decryptBlob(o.keys, data, id)
    if (pt.length !== size) throw new SyncError("server", `Blob ${id} has the wrong size. The next sync fetches the index again.`)
    return pt
  } finally {
    budget.give(cost)
  }
}

async function fetchToTemp(job: DownloadJob, o: DownloadOptions, links: Links, budget: Budget): Promise<string> {
  const { fs } = o
  const { entry } = job
  const temp = tempNameFor(entry)
  if (!entry.parts) {
    if ((await fs.tempSize(temp)) === entry.size) return temp // finished in an earlier round
    const pt = await fetchBlob(entry.id, entry.size, o, links, budget)
    await fs.tempRemove(temp)
    await fs.tempAppend(temp, pt)
    return temp
  }
  // A big file: check the part list against the file id, then continue from the last whole part.
  if ((await bigFileId(o.keys, entry.parts)) !== entry.id) {
    throw new SyncError("server", "A big file's part list does not match its file id. The next sync fetches the index again.")
  }
  let have = (await fs.tempSize(temp)) ?? 0
  if (have > entry.size) have = 0
  const whole = Math.floor(have / o.partSize)
  if (have !== whole * o.partSize || have === 0) await fs.tempTruncate(temp, whole * o.partSize)
  for (let i = whole; i < entry.parts.length; i++) {
    if (o.isStopped()) throw new SyncError("network", "Sync stopped during a download. It continues from the last whole part next time.")
    const size = Math.min(o.partSize, entry.size - i * o.partSize)
    const pt = await fetchBlob(entry.parts[i]!, size, o, links, budget)
    await fs.tempAppend(temp, pt)
  }
  return temp
}
