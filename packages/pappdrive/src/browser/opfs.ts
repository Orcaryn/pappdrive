// FsAdapter over the Origin Private File System (OPFS). Spec 05-client.md, Folder modes:
// the browser is private only. One folder lives at `pappdrive/<userId>/<app>/`, and a
// read-only mirror of another app's folder at `pappdrive/<userId>/<app>.read-<other>/`.
//
// Browser support (MDN browser-compat-data, Oct 2026):
// - FileSystemHandle.move(dir, name): Chrome 102 (files only, no folders), Firefox 111, Safari 15.2.
//   It replaces an existing file, and is one operation: the path holds the old file or the new one.
// - FileSystemFileHandle.createWritable(): Chrome 86, Firefox 111, Safari 26. The new contents show
//   only when the stream closes (a swap file), so a write is all-or-nothing.
// - Safari before 26 (iPhones that cannot update) has only sync access handles, in a dedicated
//   worker. The adapter then writes a fresh `*.saving` name in a small worker and moves it over.
//
// Every write goes into .pappdrive/. Files at app paths only arrive by move().
//
// Temp files (downloads in progress) are folders of numbered chunks, `.pappdrive/tmp/<name>/00000000`.
// Each tempAppend writes one new chunk, because `createWritable({ keepExistingData: true })` copies
// the whole file into its swap file on every call: 640 appends to a 10 GiB file would copy terabytes.
// moveTempInto moves a single chunk into place; several are first joined into one file.
//
// Case: Chrome and Firefox treat names as case sensitive. WebKit stores each entry under its own
// name on the real disk, so on a Mac's default case-insensitive volume Safari's OPFS is too.
// The adapter does not guess: it looks up a probe file in other capitals.
import { utf8 } from "../core/bytes.js"
import { SyncError } from "../core/errors.js"
import { HIDDEN_DIR } from "../core/paths.js"
import type { DirEntry, FileStat, FsAdapter } from "../core/types.js"

// The slice of the File System API used here. TypeScript's DOM lib lacks move() and entries().
export interface OpfsWritable {
  write(data: Blob | Uint8Array<ArrayBuffer>): Promise<void>
  close(): Promise<void>
  abort(): Promise<void>
}

export interface OpfsFileHandle {
  readonly kind: "file"
  readonly name: string
  getFile(): Promise<File>
  createWritable?(): Promise<OpfsWritable> // missing in Safari before 26
  move(dir: OpfsDirHandle, name: string): Promise<void>
}

export interface OpfsDirHandle {
  readonly kind: "directory"
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterable<[string, OpfsDirHandle | OpfsFileHandle]>
}

type Part = Blob | Uint8Array

const TMP = [HIDDEN_DIR, "tmp"]
const CHUNK = /^\d{8}$/
const PROBE = "case-Probe"

/** Missing, or a folder where a file was asked for (and the other way round). */
const isMissing = (e: unknown) => ["NotFoundError", "TypeMismatchError"].includes((e as Error).name)
const ignoreMissing = (e: unknown) => {
  if (!isMissing(e)) throw e
}

const segs = (path: string): string[] => (path === "" ? [] : path.split("/"))

/**
 * Opens (creating it if needed) `pappdrive/<userId>/<app>`, or the read-only mirror of `readFor`.
 * Tests pass their own root.
 */
export async function openOpfs(userId: string, app: string, readFor?: string, getRoot = opfsRoot): Promise<FsAdapter> {
  const rootSegs = ["pappdrive", userId, readFor ? `${app}.read-${readFor}` : app]
  const top = await getRoot()
  let root = top
  for (const s of rootSegs) root = await root.getDirectoryHandle(s, { create: true })

  const hidden = await root.getDirectoryHandle(HIDDEN_DIR, { create: true })
  const probe = await hidden.getFileHandle(PROBE, { create: true })
  const caseInsensitive = await hidden.getFileHandle(PROBE.toUpperCase()).then(
    () => true,
    () => false,
  )
  // Leftovers from a tab that closed in the middle of a save.
  const hourAgo = Date.now() - 3600_000
  for await (const [name, h] of hidden.entries()) {
    if (h.kind === "file" && name.endsWith(".saving") && (await h.getFile()).lastModified < hourAgo) {
      await hidden.removeEntry(name).catch(ignoreMissing) // another tab may be cleaning up too
    }
  }
  return new OpfsFolder(top, rootSegs, root, caseInsensitive, typeof probe.createWritable === "function")
}

async function opfsRoot(): Promise<OpfsDirHandle> {
  try {
    return (await navigator.storage.getDirectory()) as unknown as OpfsDirHandle
  } catch (e) {
    throw new SyncError(
      "not-allowed",
      `The browser gives this page no private file storage (OPFS): ${e}. It needs a secure page (https or localhost), ` +
        "and private windows often turn it off. Open the app in a normal window over https.",
    )
  }
}

class OpfsFolder implements FsAdapter {
  readonly kind = "private"

  constructor(
    private readonly top: OpfsDirHandle,
    private readonly rootSegs: string[],
    private readonly root: OpfsDirHandle,
    readonly caseInsensitive: boolean,
    private readonly hasWritable: boolean,
  ) {}

  /** OPFS takes every name the path rules allow. */
  canCreate(): boolean {
    return true
  }

  async stat(path: string): Promise<FileStat | null> {
    const f = await this.getFile(path)
    return f && { size: f.size, mtime: f.lastModified }
  }

  async list(dir: string): Promise<DirEntry[]> {
    const d = await this.findDir(segs(dir))
    const out: DirEntry[] = []
    if (d) for await (const [name, h] of d.entries()) out.push({ name, dir: h.kind === "directory" })
    return out
  }

  async read(path: string, offset: number, length: number): Promise<Uint8Array> {
    const f = await this.getFile(path)
    if (!f) throw new SyncError("not-found", `"${path}" does not exist. List the folder to see what is there.`)
    return new Uint8Array(await f.slice(offset, offset + length).arrayBuffer())
  }

  async moveTempInto(temp: string, path: string): Promise<FileStat> {
    const tdirSegs = [...TMP, temp]
    const tdir = (await this.findDir(tdirSegs))!
    const chunks = await this.chunks(tdir)
    let source = chunks[0]
    if (chunks.length !== 1) {
      await this.write(tdirSegs, "joined", await Promise.all(chunks.map((c) => c.getFile())))
      source = await tdir.getFileHandle("joined")
    }
    const p = segs(path)
    await source!.move(await this.makeDir(p.slice(0, -1)), p.at(-1)!)
    await this.tempRemove(temp)
    return (await this.stat(path))!
  }

  async move(from: string, to: string): Promise<void> {
    const f = segs(from)
    const t = segs(to)
    const fromParent = await this.findDir(f.slice(0, -1))
    const file = fromParent && (await findFile(fromParent, f.at(-1)!))
    if (file) return file.move(await this.makeDir(t.slice(0, -1)), t.at(-1)!)
    const dir = await this.findDir(f)
    if (!dir) throw new SyncError("not-found", `"${from}" does not exist, so it cannot be moved.`)
    await moveDir(dir, await this.makeDir(t))
    await fromParent!.removeEntry(f.at(-1)!)
  }

  async remove(path: string): Promise<void> {
    const p = segs(path)
    const parent = await this.findDir(p.slice(0, -1))
    if (parent && (await findFile(parent, p.at(-1)!))) await parent.removeEntry(p.at(-1)!)
  }

  async removeEmptyDirs(dir: string): Promise<void> {
    for (const p = segs(dir); p.length > 0; p.pop()) {
      const d = await this.findDir(p)
      if (!d) continue
      for await (const _ of d.entries()) return
      await (await this.findDir(p.slice(0, -1)))!.removeEntry(p.at(-1)!)
    }
  }

  async tempSize(temp: string): Promise<number | null> {
    const tdir = await this.findDir([...TMP, temp])
    if (!tdir) return null
    let size = 0
    for (const c of await this.chunks(tdir)) size += (await c.getFile()).size
    return size
  }

  async tempAppend(temp: string, data: Uint8Array): Promise<void> {
    const tdirSegs = [...TMP, temp]
    // Chunks are numbered from 0 and only cut from the end, so the count is the next number.
    const count = (await this.chunks(await this.makeDir(tdirSegs))).length
    await this.write(tdirSegs, String(count).padStart(8, "0"), [data])
  }

  async tempTruncate(temp: string, size: number): Promise<void> {
    const tdirSegs = [...TMP, temp]
    const tdir = await this.findDir(tdirSegs)
    if (!tdir) return
    let start = 0
    for (const c of await this.chunks(tdir)) {
      const f = await c.getFile()
      if (start >= size) await tdir.removeEntry(c.name)
      else if (start + f.size > size) await this.write(tdirSegs, c.name, [f.slice(0, size - start)])
      start += f.size
    }
  }

  async tempRemove(temp: string): Promise<void> {
    const tmp = await this.findDir(TMP)
    await tmp?.removeEntry(temp, { recursive: true }).catch(ignoreMissing)
  }

  async tempList(): Promise<string[]> {
    const tmp = await this.findDir(TMP)
    const out: string[] = []
    if (tmp) for await (const [name, h] of tmp.entries()) if (h.kind === "directory") out.push(name)
    return out
  }

  async loadState(name: string): Promise<string | null> {
    const f = await this.getFile(`${HIDDEN_DIR}/${name}`)
    return f ? f.text() : null
  }

  async saveState(name: string, data: string): Promise<void> {
    await this.write([HIDDEN_DIR], name, [utf8.encode(data)])
  }

  async destroy(): Promise<void> {
    const parents = [this.top] // parents[i] holds rootSegs[i]
    for (const s of this.rootSegs.slice(0, -1)) parents.push(await parents.at(-1)!.getDirectoryHandle(s))
    await parents.at(-1)!.removeEntry(this.rootSegs.at(-1)!, { recursive: true }).catch(ignoreMissing)
    // Then `pappdrive/<userId>` and `pappdrive`, while they are empty.
    for (let i = parents.length - 1; i > 0; i--) {
      for await (const _ of parents[i]!.entries()) return
      await parents[i - 1]!.removeEntry(this.rootSegs[i - 1]!)
    }
  }

  // ---------- helpers ----------

  /** Writes a whole file inside .pappdrive. Nobody sees it half-written. */
  private async write(dirSegs: string[], name: string, parts: Part[]): Promise<void> {
    const dir = await this.makeDir(dirSegs)
    if (this.hasWritable) {
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable!()
      try {
        for (const part of parts) await writable.write(part as Blob | Uint8Array<ArrayBuffer>)
        await writable.close()
      } catch (e) {
        await writable.abort() // drops the swap file
        throw e
      }
      return
    }
    // A sync access handle writes in place, so write a fresh name and move it over.
    const saving = `${name}.${Math.random().toString(36).slice(2, 10)}.saving`
    const blobs = parts.map((p) => (p instanceof Blob ? p : new Blob([p as Uint8Array<ArrayBuffer>])))
    await writeInWorker([...this.rootSegs, ...dirSegs], saving, blobs)
    await (await dir.getFileHandle(saving)).move(dir, name)
  }

  /** The file at `path`, or null when it is missing or a folder. */
  private async getFile(path: string): Promise<File | null> {
    const p = segs(path)
    const parent = await this.findDir(p.slice(0, -1))
    const handle = parent && (await findFile(parent, p.at(-1)!))
    return handle && handle.getFile().catch((e) => (ignoreMissing(e), null))
  }

  private async findDir(path: string[]): Promise<OpfsDirHandle | null> {
    let d = this.root
    try {
      for (const s of path) d = await d.getDirectoryHandle(s)
      return d
    } catch (e) {
      ignoreMissing(e)
      return null
    }
  }

  private async makeDir(path: string[]): Promise<OpfsDirHandle> {
    let d = this.root
    for (const s of path) d = await d.getDirectoryHandle(s, { create: true })
    return d
  }

  /** The chunks of a temp file, in order. */
  private async chunks(tdir: OpfsDirHandle): Promise<OpfsFileHandle[]> {
    const out: OpfsFileHandle[] = []
    for await (const [name, h] of tdir.entries()) if (h.kind === "file" && CHUNK.test(name)) out.push(h)
    return out.sort((a, b) => (a.name < b.name ? -1 : 1))
  }
}

async function findFile(dir: OpfsDirHandle, name: string): Promise<OpfsFileHandle | null> {
  try {
    return await dir.getFileHandle(name)
  } catch (e) {
    ignoreMissing(e)
    return null
  }
}

/** Moves every file of `src` into `dest` and removes the emptied folders below `src`. Chrome cannot move folders. */
async function moveDir(src: OpfsDirHandle, dest: OpfsDirHandle): Promise<void> {
  const entries: [string, OpfsDirHandle | OpfsFileHandle][] = []
  for await (const e of src.entries()) entries.push(e)
  for (const [name, h] of entries) {
    if (h.kind === "file") {
      await h.move(dest, name)
    } else {
      await moveDir(h, await dest.getDirectoryHandle(name, { create: true }))
      await src.removeEntry(name)
    }
  }
}

// ---------- Safari before 26: writes in a worker ----------

const SLICE = 16 * 1024 * 1024 // read Blobs in slices, so a big file never sits in memory whole

// Kept as a string and started from a blob URL, so no bundler step is needed.
const WORKER_SOURCE = `onmessage = async ({ data: { id, path, name, parts } }) => {
  let handle
  try {
    let dir = await navigator.storage.getDirectory()
    for (const s of path) dir = await dir.getDirectoryHandle(s)
    handle = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle()
    let at = 0
    for (const part of parts) {
      for (let o = 0; o < part.size; o += ${SLICE}) {
        at += handle.write(new Uint8Array(await part.slice(o, o + ${SLICE}).arrayBuffer()), { at })
      }
    }
    handle.flush()
    postMessage({ id })
  } catch (e) {
    postMessage({ id, error: String(e) })
  } finally {
    handle?.close()
  }
}`

let worker: Worker | undefined
let nextId = 0
const waiting = new Map<number, (error?: string) => void>()

function writeInWorker(path: string[], name: string, parts: Blob[]): Promise<void> {
  if (!worker) {
    worker = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" })))
    worker.onmessage = ({ data }: MessageEvent<{ id: number; error?: string }>) => {
      waiting.get(data.id)!(data.error)
      waiting.delete(data.id)
    }
    // E.g. a Content-Security-Policy without `worker-src blob:`.
    worker.onerror = (e) => {
      for (const done of waiting.values()) done(e.message || "the OPFS worker could not start")
      waiting.clear()
    }
  }
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, (error) => (error === undefined ? resolve() : reject(new Error(`pappdrive: could not write ${name}: ${error}`))))
    worker!.postMessage({ id, path, name, parts })
  })
}
