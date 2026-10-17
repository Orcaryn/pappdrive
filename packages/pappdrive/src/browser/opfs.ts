// FsAdapter over the Origin Private File System (OPFS). Spec 05-client.md, Folder modes:
// the browser is private only. One folder lives at `pappdrive/<userId>/<app>/`, and a
// read-only mirror of another app's folder at `pappdrive/<userId>/<app>.read-<other>/`.
//
// Browser APIs used, with support checked against MDN browser-compat-data (Oct 2026):
// - navigator.storage.getDirectory(): Chrome 86, Firefox 111, Safari 15.2.
// - FileSystemFileHandle.createWritable(): Chrome 86, Firefox 111, Safari 26. Main thread and
//   workers. The new contents show only when the stream is closed (a swap file).
// - FileSystemSyncAccessHandle: Chrome 102, Firefox 111, Safari 15.2, but only in dedicated
//   workers. So it is the fallback for Safari before 26: a small worker made from a blob URL.
// - FileSystemHandle.move(dir, name): Chrome 102 (files only, no folders), Firefox 111,
//   Safari 15.2. The web-platform tests check that it replaces an existing file
//   ("move(dir, name) can overwrite an existing file").
//
// How each write works:
// - Every file write goes to a fresh `*.saving` name, then one move() puts it in place. The app
//   and the engine never see a half-written file. Where move() is missing, the file is written
//   in place with createWritable, which is still all-or-nothing because of its swap file. The
//   worker fallback without move() is the one case that is not atomic.
// - Temp files (downloads in progress) are folders of numbered chunks, `.pappdrive/tmp/<name>/00000000`.
//   Each tempAppend writes one new chunk. Why: `createWritable({ keepExistingData: true })` copies
//   the whole file into its swap file on every call, so appending 640 parts to a 10 GiB file
//   would copy terabytes. Sync access handles could append in place, but only inside a worker.
// - moveTempInto: one chunk is moved into place with no copy. Several chunks are first joined
//   into one file in the temp folder, then moved. A move inside OPFS is one operation, so the
//   file at the path is either the old one or the new one, never a mix.
// - Folders cannot be moved in Chrome, so move() of a folder moves each file inside it.
//
// Case: Chrome and Firefox keep OPFS entries in their own databases and treat names as case
// sensitive. WebKit stores each entry under its own name on the real disk
// (FileSystemStorageHandle.cpp, pathByAppendingComponent), so on a Mac with the default
// case-insensitive volume, Safari's OPFS is case-insensitive too. The adapter does not guess:
// it creates a probe file and looks it up in other capitals.
import { utf8 } from "../core/bytes.js"
import { SyncError } from "../core/errors.js"
import { HIDDEN_DIR } from "../core/paths.js"
import type { DirEntry, FileStat, FsAdapter } from "../core/types.js"

// ---------- The slice of the File System API this file uses ----------
// Declared here because TypeScript's DOM lib lacks move() and directory iteration.

export interface OpfsWritable {
  write(data: Blob | Uint8Array<ArrayBuffer>): Promise<void>
  close(): Promise<void>
  abort?(reason?: unknown): Promise<void>
}

export interface OpfsFileHandle {
  readonly kind: "file"
  readonly name: string
  getFile(): Promise<File>
  createWritable?(options?: { keepExistingData?: boolean }): Promise<OpfsWritable>
  move?(dir: OpfsDirHandle, name: string): Promise<void>
}

export interface OpfsDirHandle {
  readonly kind: "directory"
  readonly name: string
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterable<[string, OpfsDirHandle | OpfsFileHandle]>
}

export interface OpfsOptions {
  /** The OPFS root. Default: navigator.storage.getDirectory(). Tests pass a fake. */
  getRoot?: () => Promise<OpfsDirHandle>
  /** How whole files are written. Default "auto": createWritable, else a sync access handle in a worker. */
  writer?: "auto" | "writable" | "worker"
}

const TMP = [HIDDEN_DIR, "tmp"]
const CHUNK = /^\d{8}$/
const JOINED = "joined"
const SLICE = 16 * 1024 * 1024
const PROBE = "case-Probe"

const errName = (e: unknown): string => (e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "")
const isMissing = (e: unknown) => errName(e) === "NotFoundError"
const isWrongKind = (e: unknown) => errName(e) === "TypeMismatchError"

function segs(path: string): string[] {
  return path === "" ? [] : path.split("/")
}

function savingName(name: string): string {
  return `${name}.${Math.random().toString(36).slice(2, 10)}.saving`
}

async function defaultRoot(): Promise<OpfsDirHandle> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage
  if (!storage?.getDirectory) {
    throw new SyncError(
      "not-allowed",
      "This browser gives the page no private file storage (OPFS). It needs a secure page (https or localhost); " +
        "some browsers also turn it off in private windows. Open the app in a normal window over https.",
    )
  }
  try {
    return (await storage.getDirectory()) as unknown as OpfsDirHandle
  } catch (e) {
    throw new SyncError(
      "not-allowed",
      `The browser refused private file storage (OPFS): ${errName(e) || String(e)}. ` +
        "Private windows often turn it off. Open the app in a normal window.",
    )
  }
}

// ---------- Writing a whole file ----------

type Chunk = Blob | Uint8Array

type WholeWriter = (abs: string[], dir: OpfsDirHandle, name: string, chunks: Chunk[]) => Promise<void>

const asBuffer = (c: Uint8Array): Uint8Array<ArrayBuffer> =>
  c.buffer instanceof ArrayBuffer ? (c as Uint8Array<ArrayBuffer>) : new Uint8Array(c)

const writableWriter: WholeWriter = async (_abs, dir, name, chunks) => {
  const handle = await dir.getFileHandle(name, { create: true })
  const w = await handle.createWritable!()
  try {
    for (const c of chunks) await w.write(c instanceof Blob ? c : asBuffer(c))
    await w.close()
  } catch (e) {
    await w.abort?.().catch(() => {})
    throw e
  }
}

// Runs in a dedicated worker. Kept as a string so no bundler step is needed.
const WORKER_SOURCE = `
const SLICE = ${SLICE};
self.onmessage = async (e) => {
  const { id, dir, name, chunks } = e.data;
  let h;
  try {
    let d = await navigator.storage.getDirectory();
    for (const s of dir) d = await d.getDirectoryHandle(s, { create: true });
    const f = await d.getFileHandle(name, { create: true });
    h = await f.createSyncAccessHandle();
    h.truncate(0);
    let at = 0;
    for (const c of chunks) {
      if (c instanceof Blob) {
        for (let o = 0; o < c.size; o += SLICE) {
          at += h.write(new Uint8Array(await c.slice(o, o + SLICE).arrayBuffer()), { at });
        }
      } else {
        at += h.write(c, { at });
      }
    }
    h.flush();
    self.postMessage({ id });
  } catch (err) {
    self.postMessage({ id, name: String(err && err.name), message: String(err && err.message) });
  } finally {
    if (h) h.close();
  }
};`

function workerWriter(): WholeWriter {
  let worker: Worker | null = null
  let next = 0
  const waiting = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()
  const start = (): Worker => {
    if (worker) return worker
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }))
    worker = new Worker(url)
    worker.onmessage = (e: MessageEvent<{ id: number; name?: string; message?: string }>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if (e.data.name === undefined) w.resolve()
      else w.reject(Object.assign(new Error(e.data.message), { name: e.data.name }))
    }
    worker.onerror = (e) => {
      for (const w of waiting.values()) w.reject(new Error(`pappdrive OPFS worker failed: ${e.message}`))
      waiting.clear()
    }
    return worker
  }
  return (abs, _dir, name, chunks) =>
    new Promise<void>((resolve, reject) => {
      const id = next++
      waiting.set(id, { resolve, reject })
      start().postMessage({ id, dir: abs, name, chunks })
    })
}

interface SyncHandle {
  truncate(size: number): void
  write(data: Uint8Array, options: { at: number }): number
  flush(): void
  close(): void
}

/** Inside a dedicated worker, without createWritable: a sync access handle, directly. */
const syncHandleWriter: WholeWriter = async (_abs, dir, name, chunks) => {
  const f = (await dir.getFileHandle(name, { create: true })) as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }
  const h = await f.createSyncAccessHandle()
  try {
    h.truncate(0)
    let at = 0
    for (const c of chunks) {
      if (c instanceof Blob) {
        for (let o = 0; o < c.size; o += SLICE) at += h.write(new Uint8Array(await c.slice(o, o + SLICE).arrayBuffer()), { at })
      } else at += h.write(c, { at })
    }
    h.flush()
  } finally {
    h.close()
  }
}

function pickWriter(choice: OpfsOptions["writer"]): WholeWriter {
  const proto = typeof FileSystemFileHandle === "undefined" ? undefined : (FileSystemFileHandle.prototype as unknown as Record<string, unknown>)
  if (choice === "writable") return writableWriter
  if (choice === "worker") return workerWriter()
  if (!proto || typeof proto.createWritable === "function") return writableWriter
  const inWorker = typeof document === "undefined" && typeof proto.createSyncAccessHandle === "function"
  if (inWorker) return syncHandleWriter
  if (typeof Worker === "undefined") {
    throw new SyncError("not-allowed", "This browser can write private files (OPFS) only from a worker, and has no workers. Update the browser.")
  }
  return workerWriter()
}

// ---------- The adapter ----------

/**
 * Opens (creating it if needed) the folder at `segments` under the OPFS root,
 * e.g. ["pappdrive", userId, app].
 */
export async function openOpfs(segments: string[], options: OpfsOptions = {}): Promise<FsAdapter> {
  const top = await (options.getRoot ?? defaultRoot)()
  let root = top
  for (const s of segments) root = await root.getDirectoryHandle(s, { create: true })
  const folder = new OpfsFolder(top, segments, root, pickWriter(options.writer))
  await folder.init()
  return folder
}

class OpfsFolder implements FsAdapter {
  readonly kind = "private" as const
  caseInsensitive = false
  private canMove = false

  constructor(
    private readonly top: OpfsDirHandle,
    private readonly rootSegs: string[],
    private readonly root: OpfsDirHandle,
    private readonly writeWhole: WholeWriter,
  ) {}

  async init(): Promise<void> {
    const hidden = await this.dir([HIDDEN_DIR], true)
    const probe = await hidden!.getFileHandle(PROBE, { create: true })
    this.canMove = typeof probe.move === "function"
    try {
      await hidden!.getFileHandle(PROBE.toUpperCase())
      this.caseInsensitive = true
    } catch {
      this.caseInsensitive = false
    }
    // Leftovers from a tab that closed in the middle of a save.
    const hour = Date.now() - 3600_000
    for await (const [name, h] of hidden!.entries()) {
      if (h.kind !== "file" || !name.endsWith(".saving")) continue
      const f = await h.getFile().catch(() => null)
      if (f && f.lastModified < hour) await hidden!.removeEntry(name).catch(() => {})
    }
  }

  canCreate(segment: string): boolean {
    return segment !== "" && segment !== "." && segment !== ".." && !/[/\0]/.test(segment)
  }

  // ----- handles -----

  private async dir(path: string[], create: boolean): Promise<OpfsDirHandle | null> {
    let d = this.root
    try {
      for (const s of path) d = await d.getDirectoryHandle(s, { create })
      return d
    } catch (e) {
      if (isMissing(e) || isWrongKind(e)) return null
      throw e
    }
  }

  private async file(path: string[]): Promise<OpfsFileHandle | null> {
    const parent = await this.dir(path.slice(0, -1), false)
    if (!parent) return null
    try {
      return await parent.getFileHandle(path[path.length - 1]!)
    } catch (e) {
      if (isMissing(e) || isWrongKind(e)) return null
      throw e
    }
  }

  private static async exists(dir: OpfsDirHandle, name: string): Promise<"file" | "directory" | null> {
    try {
      await dir.getFileHandle(name)
      return "file"
    } catch (e) {
      if (isWrongKind(e)) return "directory"
      if (isMissing(e)) return null
      throw e
    }
  }

  /** Moves a file handle to dest/name, replacing a file there. Copy and remove where move() is missing. */
  private async moveFile(handle: OpfsFileHandle, from: OpfsDirHandle, dest: OpfsDirHandle, destSegs: string[], name: string): Promise<void> {
    if (typeof handle.move === "function") {
      try {
        await handle.move(dest, name)
        return
      } catch (e) {
        if (errName(e) !== "NotSupportedError") throw e
      }
    }
    await this.writeWhole([...this.rootSegs, ...destSegs], dest, name, [await handle.getFile()])
    await from.removeEntry(handle.name).catch((e) => {
      if (!isMissing(e)) throw e
    })
  }

  /** Writes a whole file: to a fresh name, then one move into place. */
  private async writeAtomic(dirSegs: string[], name: string, chunks: Chunk[]): Promise<void> {
    const dir = (await this.dir(dirSegs, true))!
    const abs = [...this.rootSegs, ...dirSegs]
    if (!this.canMove) {
      // No move(): write in place. createWritable still replaces the file whole on close.
      await this.writeWhole(abs, dir, name, chunks)
      return
    }
    const tmp = savingName(name)
    await this.writeWhole(abs, dir, tmp, chunks)
    const h = await dir.getFileHandle(tmp)
    try {
      await this.moveFile(h, dir, dir, dirSegs, name)
    } catch (e) {
      await dir.removeEntry(tmp).catch(() => {})
      throw e
    }
  }

  // ----- files -----

  async stat(path: string): Promise<FileStat | null> {
    const h = await this.file(segs(path))
    if (!h) return null
    try {
      const f = await h.getFile()
      return { size: f.size, mtime: f.lastModified }
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  async list(dir: string): Promise<DirEntry[]> {
    const d = await this.dir(segs(dir), false)
    if (!d) return []
    const out: DirEntry[] = []
    for await (const [name, h] of d.entries()) out.push({ name, dir: h.kind === "directory" })
    return out
  }

  async read(path: string, offset: number, length: number): Promise<Uint8Array> {
    const h = await this.file(segs(path))
    if (!h) throw new SyncError("not-found", `"${path}" does not exist. List the folder to see what is there.`)
    const f = await h.getFile()
    return new Uint8Array(await f.slice(offset, offset + length).arrayBuffer())
  }

  async moveTempInto(temp: string, path: string): Promise<FileStat> {
    const tdirSegs = [...TMP, temp]
    const tdir = await this.dir(tdirSegs, false)
    if (!tdir) throw new Error(`pappdrive: no temp file "${temp}" to move into "${path}"`)
    const chunks = await this.chunks(tdir)
    let source: OpfsFileHandle
    if (chunks.length === 1) {
      source = chunks[0]!.handle
    } else {
      const files = await Promise.all(chunks.map((c) => c.handle.getFile()))
      await this.writeAtomic(tdirSegs, JOINED, files)
      source = await tdir.getFileHandle(JOINED)
    }
    const p = segs(path)
    const destSegs = p.slice(0, -1)
    const dest = (await this.dir(destSegs, true))!
    await this.moveFile(source, tdir, dest, destSegs, p[p.length - 1]!)
    await this.tempRemove(temp)
    const st = await this.stat(path)
    if (!st) throw new Error(`pappdrive: "${path}" is missing right after it was moved into place`)
    return st
  }

  async move(from: string, to: string): Promise<void> {
    const f = segs(from)
    const t = segs(to)
    const fromParent = await this.dir(f.slice(0, -1), false)
    if (!fromParent) throw new SyncError("not-found", `"${from}" does not exist, so it cannot be moved.`)
    const kind = await OpfsFolder.exists(fromParent, f[f.length - 1]!)
    if (!kind) throw new SyncError("not-found", `"${from}" does not exist, so it cannot be moved.`)
    if (kind === "file") {
      const h = await fromParent.getFileHandle(f[f.length - 1]!)
      const destSegs = t.slice(0, -1)
      const dest = (await this.dir(destSegs, true))!
      await this.moveFile(h, fromParent, dest, destSegs, t[t.length - 1]!)
      return
    }
    await this.moveDir(f, t)
  }

  private async moveDir(from: string[], to: string[]): Promise<void> {
    const src = (await this.dir(from, false))!
    const dest = (await this.dir(to, true))!
    const entries: [string, OpfsDirHandle | OpfsFileHandle][] = []
    for await (const e of src.entries()) entries.push(e)
    for (const [name, h] of entries) {
      if (h.kind === "file") await this.moveFile(h, src, dest, to, name)
      else await this.moveDir([...from, name], [...to, name])
    }
    const parent = (await this.dir(from.slice(0, -1), false))!
    await parent.removeEntry(from[from.length - 1]!).catch(() => {})
  }

  async remove(path: string): Promise<void> {
    const p = segs(path)
    const parent = await this.dir(p.slice(0, -1), false)
    if (!parent) return
    const name = p[p.length - 1]!
    if ((await OpfsFolder.exists(parent, name)) !== "file") return
    await parent.removeEntry(name).catch((e) => {
      if (!isMissing(e)) throw e
    })
  }

  async removeEmptyDirs(dir: string): Promise<void> {
    const p = segs(dir)
    while (p.length > 0) {
      const d = await this.dir(p, false)
      if (d) {
        for await (const _ of d.entries()) return
        const parent = (await this.dir(p.slice(0, -1), false))!
        await parent.removeEntry(p[p.length - 1]!).catch((e) => {
          if (!isMissing(e)) throw e
        })
      }
      p.pop()
    }
  }

  // ----- temp files: a folder of numbered chunks -----

  private async chunks(tdir: OpfsDirHandle): Promise<{ n: number; handle: OpfsFileHandle }[]> {
    const out: { n: number; handle: OpfsFileHandle }[] = []
    for await (const [name, h] of tdir.entries()) if (h.kind === "file" && CHUNK.test(name)) out.push({ n: Number(name), handle: h })
    return out.sort((a, b) => a.n - b.n)
  }

  async tempSize(temp: string): Promise<number | null> {
    const tdir = await this.dir([...TMP, temp], false)
    if (!tdir) return null
    let size = 0
    for (const c of await this.chunks(tdir)) size += (await c.handle.getFile()).size
    return size
  }

  async tempAppend(temp: string, data: Uint8Array): Promise<void> {
    const tdirSegs = [...TMP, temp]
    const tdir = (await this.dir(tdirSegs, true))!
    const chunks = await this.chunks(tdir)
    const n = chunks.length ? chunks[chunks.length - 1]!.n + 1 : 0
    await this.writeAtomic(tdirSegs, String(n).padStart(8, "0"), [data])
  }

  async tempTruncate(temp: string, size: number): Promise<void> {
    const tdirSegs = [...TMP, temp]
    const tdir = await this.dir(tdirSegs, false)
    if (!tdir) return
    let start = 0
    for (const c of await this.chunks(tdir)) {
      const f = await c.handle.getFile()
      const end = start + f.size
      if (start >= size) await tdir.removeEntry(c.handle.name)
      else if (end > size) await this.writeAtomic(tdirSegs, c.handle.name, [f.slice(0, size - start)])
      start = end
    }
  }

  async tempRemove(temp: string): Promise<void> {
    const tmp = await this.dir(TMP, false)
    await tmp?.removeEntry(temp, { recursive: true }).catch((e) => {
      if (!isMissing(e)) throw e
    })
  }

  async tempList(): Promise<string[]> {
    const tmp = await this.dir(TMP, false)
    if (!tmp) return []
    const out: string[] = []
    for await (const [name, h] of tmp.entries()) if (h.kind === "directory") out.push(name)
    return out
  }

  // ----- state files -----

  async loadState(name: string): Promise<string | null> {
    const h = await this.file([HIDDEN_DIR, name])
    if (!h) return null
    try {
      return await (await h.getFile()).text()
    } catch (e) {
      if (isMissing(e)) return null
      throw e
    }
  }

  async saveState(name: string, data: string): Promise<void> {
    await this.writeAtomic([HIDDEN_DIR], name, [utf8.encode(data)])
  }

  async destroy(): Promise<void> {
    let parent = this.top
    for (const s of this.rootSegs.slice(0, -1)) parent = await parent.getDirectoryHandle(s, { create: true })
    await parent.removeEntry(this.rootSegs[this.rootSegs.length - 1]!, { recursive: true }).catch((e) => {
      if (!isMissing(e)) throw e
    })
    // Remove `pappdrive/<userId>` and `pappdrive` if they are now empty.
    for (let i = this.rootSegs.length - 1; i > 0; i--) {
      let d = this.top
      try {
        for (const s of this.rootSegs.slice(0, i - 1)) d = await d.getDirectoryHandle(s)
        await d.removeEntry(this.rootSegs[i - 1]!)
      } catch {
        return
      }
    }
  }
}
