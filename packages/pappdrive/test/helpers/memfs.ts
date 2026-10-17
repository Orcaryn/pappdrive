// An in-memory FsAdapter for tests. Can act case-insensitive (Mac, Windows) and refuse names (Windows).
import type { DirEntry, FileStat, FsAdapter } from "../../src/core/types.js"
import { HIDDEN_DIR } from "../../src/core/paths.js"

interface FileNode {
  path: string // as spelled
  data: Uint8Array
  mtime: number
}

export interface MemFsOptions {
  kind?: "visible" | "private"
  caseInsensitive?: boolean
  canCreate?: (segment: string) => boolean
}

let clock = 0
function tick(): number {
  clock = Math.max(clock + 1, Date.now())
  return clock
}

export class MemFs implements FsAdapter {
  readonly kind: "visible" | "private"
  readonly caseInsensitive: boolean
  private readonly canCreateFn: (s: string) => boolean
  files = new Map<string, FileNode>()
  dirs = new Map<string, string>() // explicit folders (empty ones a user made)
  temps = new Map<string, Uint8Array>()
  state = new Map<string, string>()
  destroyed = false
  /** Called before each moveTempInto, so a test can sneak in a save. */
  beforeMove: ((path: string) => Promise<void> | void) | null = null

  constructor(opts: MemFsOptions = {}) {
    this.kind = opts.kind ?? "private"
    this.caseInsensitive = opts.caseInsensitive ?? false
    this.canCreateFn = opts.canCreate ?? (() => true)
  }

  private norm(p: string): string {
    return this.caseInsensitive ? p.toLowerCase() : p
  }

  canCreate(segment: string): boolean {
    return this.canCreateFn(segment)
  }

  /** Is there a folder at this path? */
  isDir(path: string): boolean {
    if (path === "") return true
    const n = this.norm(path)
    if (this.dirs.has(n)) return true
    for (const k of this.files.keys()) if (k.startsWith(n + "/")) return true
    return false
  }

  /** Maps each folder segment to the spelling that already exists (case-insensitive disks). */
  private resolve(path: string): string {
    if (!this.caseInsensitive) return path
    const segs = path.split("/")
    let out = ""
    for (let i = 0; i < segs.length - 1; i++) {
      const next = out ? `${out}/${segs[i]}` : segs[i]!
      out = this.dirSpelling(next) ?? next
    }
    return out ? `${out}/${segs[segs.length - 1]}` : segs[segs.length - 1]!
  }

  private dirSpelling(dir: string): string | undefined {
    const n = this.norm(dir)
    const d = this.dirs.get(n)
    if (d) return d
    const depth = dir.split("/").length
    for (const f of this.files.values()) {
      if (this.norm(f.path).startsWith(n + "/")) return f.path.split("/").slice(0, depth).join("/")
    }
    return undefined
  }

  async stat(path: string): Promise<FileStat | null> {
    const f = this.files.get(this.norm(path))
    return f ? { size: f.data.length, mtime: f.mtime } : null
  }

  async list(dir: string): Promise<DirEntry[]> {
    const out = new Map<string, DirEntry>()
    if (dir === "" && (this.state.size > 0 || this.temps.size > 0)) out.set(HIDDEN_DIR, { name: HIDDEN_DIR, dir: true })
    const n = dir === "" ? "" : this.norm(dir) + "/"
    const depth = dir === "" ? 0 : dir.split("/").length
    for (const f of this.files.values()) {
      if (!this.norm(f.path).startsWith(n)) continue
      const segs = f.path.split("/")
      const name = segs[depth]!
      const isDir = segs.length > depth + 1
      const k = this.norm(name)
      if (!out.has(k)) out.set(k, { name, dir: isDir })
    }
    for (const d of this.dirs.values()) {
      if (!this.norm(d).startsWith(n)) continue
      const segs = d.split("/")
      if (segs.length <= depth) continue
      const k = this.norm(segs[depth]!)
      if (!out.has(k)) out.set(k, { name: segs[depth]!, dir: true })
    }
    return [...out.values()]
  }

  async read(path: string, offset: number, length: number): Promise<Uint8Array> {
    const f = this.files.get(this.norm(path))
    if (!f) throw new Error(`memfs: no file ${path}`)
    return f.data.slice(offset, offset + length)
  }

  /** Writes a file the way the system would; throws on a file/folder clash. */
  writeFile(path: string, data: Uint8Array, mtime = tick()): FileStat {
    const p = this.resolve(path)
    const segs = p.split("/")
    for (let i = 1; i < segs.length; i++) {
      if (this.files.has(this.norm(segs.slice(0, i).join("/")))) throw new Error(`memfs: ${segs.slice(0, i).join("/")} is a file`)
    }
    if (this.isDir(p)) throw new Error(`memfs: ${p} is a folder`)
    for (const s of segs) if (!this.canCreateFn(s)) throw new Error(`memfs: cannot create ${s}`)
    this.files.delete(this.norm(p))
    this.files.set(this.norm(p), { path: p, data: new Uint8Array(data), mtime })
    return { size: data.length, mtime }
  }

  async moveTempInto(temp: string, path: string): Promise<FileStat> {
    await this.beforeMove?.(path)
    const data = this.temps.get(temp)
    if (!data) throw new Error(`memfs: no temp ${temp}`)
    const st = this.writeFile(path, data)
    this.temps.delete(temp)
    return st
  }

  async move(from: string, to: string): Promise<void> {
    const f = this.files.get(this.norm(from))
    if (f) {
      this.files.delete(this.norm(from))
      const dest = this.resolve(to)
      this.files.set(this.norm(dest), { path: dest, data: f.data, mtime: f.mtime })
      return
    }
    const n = this.norm(from) + "/"
    let moved = false
    for (const [k, node] of [...this.files]) {
      if (!k.startsWith(n)) continue
      this.files.delete(k)
      const p = to + node.path.slice(from.length)
      this.files.set(this.norm(p), { ...node, path: p })
      moved = true
    }
    if (!moved) throw new Error(`memfs: nothing at ${from}`)
  }

  async remove(path: string): Promise<void> {
    this.files.delete(this.norm(path))
  }

  async removeEmptyDirs(dir: string): Promise<void> {
    let d = dir
    while (d !== "") {
      const n = this.norm(d)
      let used = false
      for (const k of this.files.keys()) if (k.startsWith(n + "/")) used = true
      for (const k of this.dirs.keys()) if (k !== n && k.startsWith(n + "/")) used = true
      if (used) return
      this.dirs.delete(n)
      d = d.includes("/") ? d.slice(0, d.lastIndexOf("/")) : ""
    }
  }

  async tempSize(temp: string): Promise<number | null> {
    return this.temps.get(temp)?.length ?? null
  }
  async tempAppend(temp: string, data: Uint8Array): Promise<void> {
    const cur = this.temps.get(temp) ?? new Uint8Array(0)
    const next = new Uint8Array(cur.length + data.length)
    next.set(cur)
    next.set(data, cur.length)
    this.temps.set(temp, next)
  }
  async tempTruncate(temp: string, size: number): Promise<void> {
    const cur = this.temps.get(temp)
    if (cur) this.temps.set(temp, cur.slice(0, size))
  }
  async tempRemove(temp: string): Promise<void> {
    this.temps.delete(temp)
  }
  async tempList(): Promise<string[]> {
    return [...this.temps.keys()]
  }

  async loadState(name: string): Promise<string | null> {
    return this.state.get(name) ?? null
  }
  async saveState(name: string, data: string): Promise<void> {
    this.state.set(name, data)
  }

  async destroy(): Promise<void> {
    this.state.clear()
    this.temps.clear()
    if (this.kind === "private") this.files.clear()
    this.destroyed = true
  }

  // ---- Helpers for tests: another program touching the folder ----
  put(path: string, text: string | Uint8Array): void {
    this.writeFile(path, typeof text === "string" ? new TextEncoder().encode(text) : text)
  }
  text(path: string): string | undefined {
    const f = this.files.get(this.norm(path))
    return f ? new TextDecoder().decode(f.data) : undefined
  }
  del(path: string): void {
    this.files.delete(this.norm(path))
  }
  /** File paths as spelled, sorted, outside the hidden folder. */
  paths(): string[] {
    return [...this.files.values()].map((f) => f.path).sort()
  }
}
