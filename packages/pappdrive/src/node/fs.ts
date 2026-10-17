// FsAdapter over node:fs/promises, for a visible folder or a private store.
// See types.ts (FsAdapter) and spec 05-client.md, Local state and Path rules.
//
// Layout of a root: the app's files, plus `.pappdrive/` with the state files and `.pappdrive/tmp/`.
// Paths in and out are NFC with forward slashes, already checked by the engine. On disk a name may
// be spelled another way (macOS hands out NFD names, and a Linux disk may hold NFD names copied from
// a Mac): every lookup finds the entry whatever its normalization, and new names are created in NFC.
import { randomBytes } from "node:crypto"
import * as fsp from "node:fs/promises"
import { join, resolve } from "node:path"
import { HIDDEN_DIR, parentOf } from "../core/paths.js"
import { SyncError } from "../core/errors.js"
import type { DirEntry, FileStat, FsAdapter } from "../core/types.js"

const TMP = "tmp"
// Names a folder may hold and still count as empty: the system's own leftovers.
const JUNK = new Set([".ds_store", "thumbs.db", "desktop.ini"])
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i
// eslint-disable-next-line no-control-regex
const WINDOWS_BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/
const ASCII = /^[\x00-\x7f]*$/

export interface NodeFs extends FsAdapter {
  /** Absolute path of the folder (visible) or the store (private). */
  readonly root: string
}

/**
 * Opens a root directory as an FsAdapter. Creates it, the hidden folder and its tmp folder.
 * Detects case-insensitivity with a probe file in the hidden folder.
 */
export async function openNodeFs(root: string, kind: "visible" | "private"): Promise<NodeFs> {
  const abs = resolve(root)
  const hidden = join(abs, HIDDEN_DIR)
  await fsp.mkdir(join(hidden, TMP), { recursive: true })
  const probe = `case-probe-${randomBytes(6).toString("hex")}`
  await fsp.writeFile(join(hidden, probe), "")
  const caseInsensitive = await fsp.stat(join(hidden, probe.toUpperCase())).then(() => true, () => false)
  await fsp.rm(join(hidden, probe))
  return new NodeFsImpl(abs, kind, caseInsensitive)
}

/** Can a system create a file with this name segment? Exported for tests and the CLI (`windows` forces the rules). */
export function canCreateName(segment: string, windows = process.platform === "win32"): boolean {
  if (segment === "" || segment.includes("/") || segment.includes("\0")) return false
  if (!windows) return true
  if (WINDOWS_BAD_CHARS.test(segment)) return false
  if (segment.endsWith(".") || segment.endsWith(" ")) return false
  return !WINDOWS_RESERVED.test(segment)
}

class NodeFsImpl implements NodeFs {
  private readonly hidden: string
  private readonly tmp: string

  constructor(
    readonly root: string,
    readonly kind: "visible" | "private",
    readonly caseInsensitive: boolean,
  ) {
    this.hidden = join(root, HIDDEN_DIR)
    this.tmp = join(this.hidden, TMP)
  }

  canCreate(segment: string): boolean {
    return canCreateName(segment)
  }

  // ---------- Files ----------

  async stat(path: string): Promise<FileStat | null> {
    const st = await ifMissing(fsp.stat(await this.real(path)), null)
    return st?.isFile() ? { size: st.size, mtime: Math.floor(st.mtimeMs) } : null
  }

  async list(dir: string): Promise<DirEntry[]> {
    const entries = await ifMissing(fsp.readdir(await this.real(dir), { withFileTypes: true }), [])
    const out: DirEntry[] = []
    for (const e of entries) {
      const name = e.name.normalize("NFC")
      if (e.isDirectory()) out.push({ name, dir: true })
      else if (e.isFile()) out.push({ name, dir: false })
      else if (e.isSymbolicLink()) {
        // A link to a file counts as that file. A link to a folder, or a broken link, is left out,
        // so a loop cannot happen.
        const target = await fsp.stat(join(e.parentPath, e.name)).catch(() => null)
        if (target?.isFile()) out.push({ name, dir: false })
      }
      // sockets, pipes and devices are left out
    }
    return out
  }

  async read(path: string, offset: number, length: number): Promise<Uint8Array> {
    let fh
    try {
      fh = await fsp.open(await this.real(path), "r")
    } catch (e) {
      if (["ENOENT", "EISDIR", "ENOTDIR"].includes((e as NodeJS.ErrnoException).code!)) {
        throw new SyncError("not-found", `"${path}" does not exist. Check the path with list().`)
      }
      throw e
    }
    try {
      const buf = Buffer.alloc(length)
      let got = 0
      while (got < length) {
        const { bytesRead } = await fh.read(buf, got, length - got, offset + got)
        if (bytesRead === 0) break
        got += bytesRead
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, got)
    } finally {
      await fh.close()
    }
  }

  async moveTempInto(temp: string, path: string): Promise<FileStat> {
    const dst = await this.ensureParent(path)
    await fsp.rename(join(this.tmp, temp), dst)
    const st = await fsp.stat(dst)
    return { size: st.size, mtime: Math.floor(st.mtimeMs) }
  }

  async move(from: string, to: string): Promise<void> {
    const src = await this.real(from)
    await fsp.rename(src, await this.ensureParent(to))
  }

  async remove(path: string): Promise<void> {
    await ifMissing(fsp.unlink(await this.real(path)), undefined)
  }

  async removeEmptyDirs(dir: string): Promise<void> {
    for (let d = dir; d !== ""; d = parentOf(d)) {
      if (d.split("/")[0]!.toLowerCase() === HIDDEN_DIR) return
      const abs = await this.real(d)
      let names: string[]
      try {
        names = await fsp.readdir(abs)
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code === "ENOENT") continue // already gone: look at its parent
        if (code === "ENOTDIR") return
        throw e
      }
      // A folder holding only the system's leftovers (.DS_Store and the like) counts as empty.
      if (names.some((n) => !JUNK.has(n.toLowerCase()))) return
      for (const n of names) await fsp.rm(join(abs, n), { force: true })
      try {
        await fsp.rmdir(abs)
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code!
        if (code === "ENOENT") continue
        // Something new arrived in it, or Windows holds it open: leave it.
        if (["ENOTEMPTY", "EEXIST", "EBUSY", "EPERM"].includes(code)) return
        throw e
      }
    }
  }

  // ---------- Temp files ----------

  tempSize(temp: string): Promise<number | null> {
    return ifMissing(fsp.stat(join(this.tmp, temp)).then((st) => st.size), null)
  }

  async tempAppend(temp: string, data: Uint8Array): Promise<void> {
    await fsp.mkdir(this.tmp, { recursive: true })
    await fsp.appendFile(join(this.tmp, temp), data)
  }

  tempTruncate(temp: string, size: number): Promise<void> {
    return fsp.truncate(join(this.tmp, temp), size)
  }

  tempRemove(temp: string): Promise<void> {
    return fsp.rm(join(this.tmp, temp), { force: true })
  }

  tempList(): Promise<string[]> {
    return ifMissing(fsp.readdir(this.tmp), [])
  }

  // ---------- State files ----------

  loadState(name: string): Promise<string | null> {
    return ifMissing(fsp.readFile(join(this.hidden, name), "utf8"), null)
  }

  /** Atomic: write a temp file next to it, flush it to disk, then rename over the old one. */
  async saveState(name: string, data: string): Promise<void> {
    const target = join(this.hidden, name)
    await fsp.mkdir(this.hidden, { recursive: true })
    const temp = `${target}.${randomBytes(6).toString("hex")}.saving`
    const fh = await fsp.open(temp, "w", 0o600)
    try {
      await fh.writeFile(data, "utf8")
      await fh.sync()
    } finally {
      await fh.close()
    }
    try {
      await fsp.rename(temp, target)
    } catch (e) {
      await fsp.rm(temp, { force: true })
      throw e
    }
  }

  async destroy(): Promise<void> {
    await fsp.rm(this.kind === "private" ? this.root : this.hidden, { recursive: true, force: true })
  }

  // ---------- Name mapping ----------

  /**
   * The absolute on-disk path for a relative NFC path. Each segment is looked up as spelled;
   * if missing and not plain ASCII, the folder is listed and an entry with the same NFC form is used.
   * Segments that do not exist yet keep their NFC spelling, so new names are created in NFC.
   */
  private async real(path: string): Promise<string> {
    if (path === "") return this.root
    let cur = this.root
    let exists = true // once a segment is missing, everything below it is a new name
    for (const seg of path.split("/")) {
      let name = seg
      if (exists && !ASCII.test(seg) && !(await fsp.lstat(join(cur, seg)).then(() => true, () => false))) {
        const names = await fsp.readdir(cur).catch(() => [])
        const found = names.find((n) => n.normalize("NFC") === seg)
        if (found === undefined) exists = false
        else name = found
      }
      cur = join(cur, name)
    }
    return cur
  }

  /** The on-disk path for `path`, with its parent folders created. Refuses a parent that is a file. */
  private async ensureParent(path: string): Promise<string> {
    const parent = parentOf(path)
    if (parent !== "") {
      try {
        await fsp.mkdir(await this.real(parent), { recursive: true })
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code === "EEXIST" || code === "ENOTDIR") {
          throw new SyncError("bad-path", `Cannot create "${path}": a file is in the way of its folder "${parent}".`)
        }
        throw e
      }
    }
    return this.real(path)
  }
}

/** Resolves to `missing` when the path, or a folder on the way to it, does not exist. */
async function ifMissing<T, M>(op: Promise<T>, missing: M): Promise<T | M> {
  try {
    return await op
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return missing
    throw e
  }
}
