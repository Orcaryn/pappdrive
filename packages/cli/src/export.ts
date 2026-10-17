// `pappdrive export <app> <dir>`: download and decrypt an app's whole folder.
// See spec 07-encryption.md, Data export. Uses a token without an app whose read list names <app>
// (04-server.md, Apps), the index read link, download links, and core crypto. Big files come in parts.
import * as fsp from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { type IndexBody, type IndexEntry, type IndexFile, MAX_IDS_PER_CALL } from "@pappdrive/protocol"
import { bigFileId, type DataKeys, decodeBody, decryptBlob } from "../../pappdrive/src/core/crypto.js"
import { SyncError } from "../../pappdrive/src/core/errors.js"
import { HIDDEN_DIR, pathKey, pathProblem } from "../../pappdrive/src/core/paths.js"
import { canCreateName } from "../../pappdrive/src/node/fs.js"
import type { Client } from "./client.js"

const TEMP_DIR = ".pappdrive-export"
/** Stored bytes in flight at once. Plus one blob being decrypted: about 48 MiB, as in the library. */
const IN_FLIGHT = 32 * 1024 * 1024
const WORKERS = 6
/** Links last five minutes; ask again after four. */
const LINK_TTL_MS = 4 * 60_000
/** Ask for links only this far ahead (stored bytes), so none expires before it is used. */
const LINK_AHEAD = 256 * 1024 * 1024
const RETRIES = 3

export interface ExportPlanItem {
  path: string
  entry: IndexEntry
  blobs: string[]
}
export interface ExportPlan {
  items: ExportPlanItem[]
  skipped: { path: string; reason: string }[]
  bytes: number
}

/**
 * Which paths to write, and which to skip with a reason: names that break the path rules,
 * names this system cannot create, and on a case-insensitive disk names that differ only in capitals.
 * A file that is also a folder ("notes" and "notes/a.md") keeps the folder; the file is skipped.
 */
export function planExport(body: IndexBody, opts: { caseInsensitive: boolean; canCreate?: (seg: string) => boolean }): ExportPlan {
  const canCreate = opts.canCreate ?? canCreateName
  const skipped: ExportPlan["skipped"] = []
  const items: ExportPlanItem[] = []
  const key = (p: string) => (opts.caseInsensitive ? pathKey(p) : p.normalize("NFC"))
  const paths = Object.keys(body).sort()
  const dirs = new Set<string>()
  for (const p of paths) {
    const segs = p.split("/")
    for (let i = 1; i < segs.length; i++) dirs.add(key(segs.slice(0, i).join("/")))
  }
  const taken = new Map<string, string>()
  for (const path of paths) {
    const entry = body[path]!
    const problem = pathProblem(path)
    if (problem) {
      skipped.push({ path, reason: `not a valid path: ${problem}` })
      continue
    }
    const first = path.split("/")[0]!.toLowerCase()
    if (first === HIDDEN_DIR || first === TEMP_DIR) {
      skipped.push({ path, reason: `inside the reserved folder ${first}/` })
      continue
    }
    const bad = path.split("/").find((s) => !canCreate(s))
    if (bad !== undefined) {
      skipped.push({ path, reason: `this system cannot create the name "${bad}"` })
      continue
    }
    const k = key(path)
    if (dirs.has(k)) {
      skipped.push({ path, reason: "a folder has the same name" })
      continue
    }
    const other = taken.get(k)
    if (other !== undefined) {
      skipped.push({ path, reason: `differs from "${other}" only in capital letters, and this disk sees them as one file` })
      continue
    }
    taken.set(k, path)
    items.push({ path, entry, blobs: entry.parts ?? [entry.id] })
  }
  return { items, skipped, bytes: items.reduce((n, i) => n + i.entry.size, 0) }
}

async function probeCase(dir: string): Promise<boolean> {
  const name = `${TEMP_DIR}-case-${process.pid}`
  await fsp.writeFile(join(dir, name), "")
  try {
    await fsp.stat(join(dir, name.toUpperCase()))
    return true
  } catch {
    return false
  } finally {
    await fsp.rm(join(dir, name), { force: true })
  }
}

/** Download links, asked for in batches of up to 100, a little ahead of use, and asked again once old. */
class Links {
  private readonly cache = new Map<string, { url: string; at: number }>()
  private queue: Promise<unknown> = Promise.resolve()
  private next = 0
  private readonly fetchLinks: (ids: string[]) => Promise<{ id: string; url: string }[]>
  private readonly order: string[]
  private readonly sizes: Record<string, number>
  constructor(fetchLinks: (ids: string[]) => Promise<{ id: string; url: string }[]>, order: string[], sizes: Record<string, number>) {
    this.fetchLinks = fetchLinks
    this.order = order
    this.sizes = sizes
  }

  get(id: string, fresh = false): Promise<string> {
    const run = this.queue.then(async () => {
      const hit = this.cache.get(id)
      if (hit && !fresh && Date.now() - hit.at < LINK_TTL_MS) return hit.url
      const ids = [id]
      let ahead = this.sizes[id] ?? 0
      while (this.next < this.order.length && ids.length < MAX_IDS_PER_CALL) {
        const n = this.order[this.next]!
        const h = this.cache.get(n)
        if (n !== id && !(h && Date.now() - h.at < LINK_TTL_MS)) {
          ahead += this.sizes[n] ?? 0
          if (ahead > LINK_AHEAD) break
          ids.push(n)
        }
        this.next++
      }
      const at = Date.now()
      for (const l of await this.fetchLinks(ids)) this.cache.set(l.id, { url: l.url, at })
      const got = this.cache.get(id)
      if (!got) throw new SyncError("server", `The server sent no download link for a blob of this folder.`)
      return got.url
    })
    this.queue = run.catch(() => {})
    return run
  }

  /** The order position moves past blobs used out of order, so the next batch looks ahead from here. */
  seek(id: string): void {
    const i = this.order.indexOf(id, this.next)
    if (i >= 0) this.next = Math.max(this.next, i)
  }
}

class Budget {
  private used = 0
  private waiters: (() => void)[] = []
  async take(n: number): Promise<void> {
    while (this.used > 0 && this.used + n > IN_FLIGHT) await new Promise<void>((r) => this.waiters.push(r))
    this.used += n
  }
  give(n: number): void {
    this.used -= n
    this.waiters.splice(0).forEach((w) => w())
  }
}

export interface ExportOptions {
  client: Client
  token: string
  app: string
  dir: string
  keys: DataKeys
  force: boolean
  log: (line: string) => void
  progress?: (done: number, total: number, bytes: number, totalBytes: number) => void
  fetchFn?: typeof fetch
}

export interface ExportResult {
  written: number
  unchanged: number
  skipped: { path: string; reason: string }[]
  failed: { path: string; reason: string }[]
  empty: boolean
}

/** Is a directory missing or empty? */
async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    const names = await fsp.readdir(dir)
    return names.every((n) => n === ".DS_Store")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return true
    if ((e as NodeJS.ErrnoException).code === "ENOTDIR") {
      throw new SyncError("bad-path", `"${dir}" is a file. Give export a folder to write into.`)
    }
    throw e
  }
}

export async function runExport(o: ExportOptions): Promise<ExportResult> {
  const fetchFn = o.fetchFn ?? o.client.fetchFn
  const dir = resolve(o.dir)
  if (!o.force && !(await isEmptyDir(dir))) {
    throw new SyncError(
      "bad-path",
      `"${dir}" is not empty. Export into a new or empty folder, or add --force to write into it ` +
        `(files with the same names are replaced; files already exported unchanged are skipped).`,
    )
  }
  await fsp.mkdir(dir, { recursive: true })

  // The index, straight from storage.
  const link = await o.client.indexLink(o.token, o.app)
  let res: Response
  try {
    res = await fetchFn(link.url, { cache: "no-store" })
  } catch {
    throw new SyncError("network", "Could not reach storage to read the folder's index. Check the connection and run the export again.")
  }
  if (res.status === 404) return { written: 0, unchanged: 0, skipped: [], failed: [], empty: true }
  if (!res.ok) throw new SyncError("server", `Storage answered ${res.status} when reading the folder's index. Run the export again.`)
  const index = (await res.json()) as IndexFile
  if (index?.v !== 1) {
    throw new SyncError("update-needed", `The folder's index has format version ${String(index?.v)}. Update pappdrive-cli, then export again.`)
  }
  const body = await decodeBody(o.keys, index.body)

  const plan = planExport(body, { caseInsensitive: await probeCase(dir) })
  const temp = join(dir, TEMP_DIR)
  await fsp.mkdir(temp, { recursive: true })

  const order: string[] = []
  const seen = new Set<string>()
  for (const it of plan.items) for (const b of it.blobs) if (!seen.has(b)) (seen.add(b), order.push(b))
  const links = new Links((ids) => o.client.downloadLinks(o.token, o.app, ids), order, index.blobs)
  const budget = new Budget()

  const failed: ExportResult["failed"] = []
  let written = 0
  let unchanged = 0
  let done = 0
  let doneBytes = 0

  const fetchBlob = async (id: string): Promise<Uint8Array> => {
    const size = index.blobs[id] ?? 0
    await budget.take(size)
    try {
      let lastErr: unknown
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        try {
          const url = await links.get(id, attempt > 0)
          const r = await fetchFn(url)
          if (!r.ok) throw new SyncError("server", `storage answered ${r.status}`)
          const data = new Uint8Array(await r.arrayBuffer())
          return await decryptBlob(o.keys, data, id)
        } catch (e) {
          lastErr = e
        }
      }
      throw lastErr
    } finally {
      budget.give(size)
    }
  }

  const one = async (it: ExportPlanItem, n: number) => {
    const target = join(dir, ...it.path.split("/"))
    if (!target.startsWith(dir + sep)) throw new SyncError("bad-path", "outside the export folder")
    if (o.force) {
      const st = await fsp.stat(target).catch(() => null)
      if (st?.isFile() && st.size === it.entry.size && Math.abs(st.mtimeMs - it.entry.mtime) < 2000) {
        unchanged++
        return
      }
    }
    const part = join(temp, `${n}`)
    const fh = await fsp.open(part, "w")
    try {
      for (const id of it.blobs) {
        links.seek(id)
        const pt = await fetchBlob(id)
        await fh.write(pt)
      }
    } finally {
      await fh.close()
    }
    if (it.entry.parts && (await bigFileId(o.keys, it.entry.parts)) !== it.entry.id) {
      throw new SyncError("server", "its parts do not match its file id")
    }
    const st = await fsp.stat(part)
    if (st.size !== it.entry.size) throw new SyncError("server", `it has ${st.size} bytes, the index says ${it.entry.size}`)
    await fsp.mkdir(join(target, ".."), { recursive: true })
    await fsp.rename(part, target)
    const mtime = new Date(it.entry.mtime)
    await fsp.utimes(target, mtime, mtime).catch(() => {})
    written++
  }

  let cursor = 0
  const worker = async () => {
    while (cursor < plan.items.length) {
      const n = cursor++
      const it = plan.items[n]!
      try {
        await one(it, n)
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        failed.push({ path: it.path, reason: msg.replace(/^[a-z-]+: /, "") })
        await fsp.rm(join(temp, `${n}`), { force: true }).catch(() => {})
      }
      done++
      doneBytes += it.entry.size
      o.progress?.(done, plan.items.length, doneBytes, plan.bytes)
    }
  }
  await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(1, plan.items.length)) }, worker))
  await fsp.rm(temp, { recursive: true, force: true })
  return { written, unchanged, skipped: plan.skipped, failed, empty: false }
}
