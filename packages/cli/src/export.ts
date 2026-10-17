// `pappdrive export <app> <dir>`: download and decrypt an app's whole folder.
// See spec 07-encryption.md, Data export. Uses a token without an app whose read list names <app>
// (04-server.md, Apps), the index read link, download links, and core crypto. Big files come in parts.
import * as fsp from "node:fs/promises"
import { join, resolve } from "node:path"
import { type DownloadLink, type IndexBody, type IndexEntry, type IndexFile, type IndexLinkResponse, MAX_IDS_PER_CALL } from "@pappdrive/protocol"
import { request } from "../../pappdrive/src/core/api.js"
import { bigFileId, type DataKeys, decodeBody, decryptBlob } from "../../pappdrive/src/core/crypto.js"
import { SyncError } from "../../pappdrive/src/core/errors.js"
import { HIDDEN_DIR, pathKey, pathProblem } from "../../pappdrive/src/core/paths.js"
import { canCreateName } from "../../pappdrive/src/node/fs.js"

const TEMP_DIR = ".pappdrive-export"
/** Stored bytes in flight at once. Plus one blob being decrypted: about 48 MiB, as in the library. */
const IN_FLIGHT = 32 * 1024 * 1024
const WORKERS = 6
/** Links last five minutes; ask again after four. */
const LINK_TTL_MS = 4 * 60_000
/** Ask for links only this far ahead (stored bytes), so none expires before it is used. */
const LINK_AHEAD = 256 * 1024 * 1024
const RETRIES = 3

interface Problem {
  path: string
  reason: string
}

interface ExportResult {
  written: number
  unchanged: number
  skipped: Problem[]
  failed: Problem[]
}

/** Returns null when the app has no index: its folder was never synced, or was deleted. */
export async function runExport(o: {
  server: string
  token: string
  app: string
  dir: string
  keys: DataKeys
  force: boolean
  progress: (done: number, total: number, bytes: number, totalBytes: number) => void
}): Promise<ExportResult | null> {
  const dir = resolve(o.dir)
  if (!o.force && !(await isEmptyDir(dir))) {
    throw new SyncError(
      "bad-path",
      `"${dir}" is not empty. Export into a new or empty folder, or add --force to write into it ` +
        `(files with the same names are replaced; files already exported unchanged are skipped).`,
    )
  }
  await fsp.mkdir(dir, { recursive: true })
  const q = `?app=${encodeURIComponent(o.app)}`

  // The index, straight from storage.
  const link = await request<IndexLinkResponse>(o.server, "GET", `/index/link${q}`, undefined, o.token)
  let res: Response
  try {
    res = await fetch(link.url, { cache: "no-store" })
  } catch {
    throw new SyncError("network", "Could not reach storage to read the folder's index. Check the connection and run the export again.")
  }
  if (res.status === 404) return null
  if (!res.ok) throw new SyncError("server", `Storage answered ${res.status} when reading the folder's index. Run the export again.`)
  const index = (await res.json()) as IndexFile
  if (index.v !== 1) {
    throw new SyncError("update-needed", `The folder's index has format version ${index.v}. Update pappdrive-cli, then export again.`)
  }
  const plan = planExport(await decodeBody(o.keys, index.body), await probeCaseInsensitive(dir))
  const totalBytes = plan.items.reduce((n, i) => n + i.entry.size, 0)
  const temp = join(dir, TEMP_DIR)
  await fsp.mkdir(temp, { recursive: true })

  const order = [...new Set(plan.items.flatMap((it) => it.blobs))]
  const linkFor = linkSource((ids) => request<DownloadLink[]>(o.server, "POST", `/blobs/download${q}`, ids, o.token), order, index.blobs)
  const budget = new Budget()

  const fetchBlob = async (id: string): Promise<Uint8Array> => {
    const size = index.blobs[id]!
    await budget.take(size)
    try {
      let lastError: unknown
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        try {
          const r = await fetch(await linkFor(id, attempt > 0))
          if (!r.ok) throw new SyncError("server", `storage answered ${r.status}`)
          return await decryptBlob(o.keys, new Uint8Array(await r.arrayBuffer()), id)
        } catch (e) {
          lastError = e
        }
      }
      throw lastError
    } finally {
      budget.give(size)
    }
  }

  const result: ExportResult = { written: 0, unchanged: 0, skipped: plan.skipped, failed: [] }
  const exportFile = async (it: PlanItem, part: string) => {
    const target = join(dir, ...it.path.split("/"))
    if (o.force) {
      const st = await fsp.stat(target).catch(() => null)
      if (st?.isFile() && st.size === it.entry.size && Math.abs(st.mtimeMs - it.entry.mtime) < 2000) {
        result.unchanged++
        return
      }
    }
    const fh = await fsp.open(part, "w")
    try {
      for (const id of it.blobs) await fh.write(await fetchBlob(id))
    } finally {
      await fh.close()
    }
    if (it.entry.parts && (await bigFileId(o.keys, it.entry.parts)) !== it.entry.id) {
      throw new SyncError("server", "its parts do not match its file id")
    }
    const { size } = await fsp.stat(part)
    if (size !== it.entry.size) throw new SyncError("server", `it has ${size} bytes, the index says ${it.entry.size}`)
    await fsp.mkdir(join(target, ".."), { recursive: true })
    await fsp.rename(part, target)
    const mtime = new Date(it.entry.mtime)
    await fsp.utimes(target, mtime, mtime)
    result.written++
  }

  let next = 0
  let done = 0
  let doneBytes = 0
  const worker = async () => {
    while (next < plan.items.length) {
      const n = next++
      const it = plan.items[n]!
      const part = join(temp, `${n}`)
      try {
        await exportFile(it, part)
      } catch (e) {
        result.failed.push({ path: it.path, reason: (e as Error).message.replace(/^[a-z-]+: /, "") })
        await fsp.rm(part, { force: true })
      }
      done++
      doneBytes += it.entry.size
      o.progress(done, plan.items.length, doneBytes, totalBytes)
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker))
  await fsp.rm(temp, { recursive: true, force: true })
  return result
}

/** Is a directory missing or empty? */
async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    return (await fsp.readdir(dir)).every((n) => n === ".DS_Store")
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === "ENOENT") return true
    if (code === "ENOTDIR") throw new SyncError("bad-path", `"${dir}" is a file. Give export a folder to write into.`)
    throw e
  }
}

async function probeCaseInsensitive(dir: string): Promise<boolean> {
  const name = `${TEMP_DIR}-case-${process.pid}`
  await fsp.writeFile(join(dir, name), "")
  try {
    return await fsp.stat(join(dir, name.toUpperCase())).then(
      () => true,
      () => false,
    )
  } finally {
    await fsp.rm(join(dir, name), { force: true })
  }
}

interface PlanItem {
  path: string
  entry: IndexEntry
  blobs: string[]
}

/**
 * Which paths to write, and which to skip with a reason: names that break the path rules,
 * names this system cannot create, and on a case-insensitive disk names that differ only in capitals.
 * A file that is also a folder ("notes" and "notes/a.md") keeps the folder; the file is skipped.
 */
export function planExport(body: IndexBody, caseInsensitive: boolean, canCreate = canCreateName): { items: PlanItem[]; skipped: Problem[] } {
  const key = (p: string) => (caseInsensitive ? pathKey(p) : p.normalize("NFC"))
  const paths = Object.keys(body).sort()
  const dirs = new Set<string>()
  for (const p of paths) {
    const segs = p.split("/")
    for (let i = 1; i < segs.length; i++) dirs.add(key(segs.slice(0, i).join("/")))
  }
  const items: PlanItem[] = []
  const skipped: Problem[] = []
  const taken = new Map<string, string>()
  for (const path of paths) {
    const entry = body[path]!
    const problem = pathProblem(path)
    if (problem) {
      skipped.push({ path, reason: `not a valid path: ${problem}` })
      continue
    }
    const segs = path.split("/")
    const first = segs[0]!.toLowerCase()
    if (first === HIDDEN_DIR || first === TEMP_DIR) {
      skipped.push({ path, reason: `inside the reserved folder ${first}/` })
      continue
    }
    const bad = segs.find((s) => !canCreate(s))
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
  return { items, skipped }
}

/**
 * Download links, asked for in batches of up to 100 a little ahead of use (from the asked blob on,
 * in download order), and asked again once old or when `fresh`. One batch request at a time.
 */
function linkSource(fetchLinks: (ids: string[]) => Promise<DownloadLink[]>, order: string[], sizes: Record<string, number>) {
  const cache = new Map<string, { url: string; at: number }>()
  const usable = (id: string) => {
    const hit = cache.get(id)
    return hit !== undefined && Date.now() - hit.at < LINK_TTL_MS
  }
  let queue: Promise<unknown> = Promise.resolve()
  return (id: string, fresh: boolean): Promise<string> => {
    const run = queue.then(async () => {
      if (!fresh && usable(id)) return cache.get(id)!.url
      const ids = [id]
      let ahead = sizes[id]!
      for (let i = order.indexOf(id) + 1; i < order.length && ids.length < MAX_IDS_PER_CALL; i++) {
        const n = order[i]!
        if (usable(n)) continue
        ahead += sizes[n]!
        if (ahead > LINK_AHEAD) break
        ids.push(n)
      }
      const at = Date.now()
      for (const l of await fetchLinks(ids)) cache.set(l.id, { url: l.url, at })
      return cache.get(id)!.url
    })
    queue = run.catch(() => {})
    return run
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
