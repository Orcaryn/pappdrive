// FsAdapter over node:fs/promises, for a visible folder or a private store.
// See types.ts (FsAdapter) and spec 05-client.md, Local state and Path rules.
//
// Layout of a root: the app's files, plus `.pappdrive/` with the state files and `.pappdrive/tmp/`.
// Paths in and out are NFC with forward slashes. On disk a name may be spelled another way (macOS
// hands out NFD names, and a Linux disk may hold NFD names copied from a Mac): every lookup finds
// the entry whatever its normalization, and new names are created in NFC.
import { randomBytes } from "node:crypto"
import * as fsp from "node:fs/promises"
import { join, resolve } from "node:path"
import { HIDDEN_DIR, parentOf } from "../core/paths.js"
import { SyncError } from "../core/errors.js"
import type { DirEntry, FileStat, FsAdapter } from "../core/types.js"

const TMP = "tmp"
const isWindows = process.platform === "win32"
// Names a folder may hold and still count as empty: the system's own leftovers.
const JUNK = new Set([".ds_store", "thumbs.db", "desktop.ini"])
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i
// eslint-disable-next-line no-control-regex
const WINDOWS_BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/
const ASCII = /^[\x00-\x7f]*$/

/** Can a system create a file with this name segment? Exported for tests (`windows` forces the rules). */
export function canCreateName(segment: string, windows = isWindows): boolean {
  if (segment === "" || segment.includes("/") || segment.includes("\0")) return false
  if (!windows) return true
  if (WINDOWS_BAD_CHARS.test(segment)) return false
  if (segment.endsWith(".") || segment.endsWith(" ")) return false
  return !WINDOWS_RESERVED.test(segment)
}

function errCode(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | null)?.code
}

function tempName(): string {
  return randomBytes(6).toString("hex")
}

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
  const caseInsensitive = await probeCase(hidden)
  return new NodeFsImpl(abs, kind, caseInsensitive)
}

async function probeCase(hidden: string): Promise<boolean> {
  const name = `case-probe-${tempName()}`
  const probe = join(hidden, name)
  await fsp.writeFile(probe, "")
  try {
    await fsp.stat(join(hidden, name.toUpperCase()))
    return true
  } catch {
    return false
  } finally {
    await fsp.rm(probe, { force: true })
  }
}

class NodeFsImpl implements NodeFs {
  readonly root: string
  readonly kind: "visible" | "private"
  readonly caseInsensitive: boolean
  private readonly hidden: string
  private readonly tmp: string

  constructor(root: string, kind: "visible" | "private", caseInsensitive: boolean) {
    this.root = root
    this.kind = kind
    this.caseInsensitive = caseInsensitive
    this.hidden = join(root, HIDDEN_DIR)
    this.tmp = join(this.hidden, TMP)
  }

  canCreate(segment: string): boolean {
    return canCreateName(segment)
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
    let exists = true
    for (const seg of path.split("/")) {
      if (seg === "" || seg === "." || seg === "..") {
        throw new SyncError("bad-path", `"${path}" is not a valid path: it has an empty, "." or ".." segment.`)
      }
      if (!exists || ASCII.test(seg)) {
        cur = join(cur, seg)
        continue
      }
      const direct = join(cur, seg)
      if (await present(direct)) {
        cur = direct
        continue
      }
      const found = await findNfc(cur, seg)
      if (found === null) exists = false
      cur = join(cur, found ?? seg)
    }
    return cur
  }

  private tempPath(temp: string): string {
    if (temp === "" || /[/\\]/.test(temp) || temp === "." || temp === "..") {
      throw new SyncError("bad-path", `"${temp}" is not a valid temp file name. Use a plain name such as a file id.`)
    }
    return join(this.tmp, temp)
  }

  // ---------- Files ----------

  async stat(path: string): Promise<FileStat | null> {
    try {
      const st = await fsp.stat(await this.real(path))
      if (!st.isFile()) return null
      return { size: st.size, mtime: Math.floor(st.mtimeMs) }
    } catch (e) {
      if (errCode(e) === "ENOENT" || errCode(e) === "ENOTDIR") return null
      throw e
    }
  }

  async list(dir: string): Promise<DirEntry[]> {
    let entries
    try {
      entries = await fsp.readdir(await this.real(dir), { withFileTypes: true })
    } catch (e) {
      if (errCode(e) === "ENOENT" || errCode(e) === "ENOTDIR") return []
      throw e
    }
    const out: DirEntry[] = []
    for (const e of entries) {
      const name = e.name.normalize("NFC")
      if (e.isDirectory()) out.push({ name, dir: true })
      else if (e.isFile()) out.push({ name, dir: false })
      else if (e.isSymbolicLink()) {
        // A link to a file counts as that file. A link to a folder is left out, so a loop cannot happen.
        try {
          if ((await fsp.stat(join(e.parentPath, e.name))).isFile()) out.push({ name, dir: false })
        } catch {
          // a broken link: left out
        }
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
      if (errCode(e) === "ENOENT" || errCode(e) === "EISDIR" || errCode(e) === "ENOTDIR") {
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
    await fsp.rename(this.tempPath(temp), dst)
    const st = await fsp.stat(dst)
    return { size: st.size, mtime: Math.floor(st.mtimeMs) }
  }

  async move(from: string, to: string): Promise<void> {
    const src = await this.real(from)
    if (from === to) return
    if (this.caseInsensitive && from.toLowerCase() === to.toLowerCase()) {
      // The system sees one name: go through a temporary name in the same folder.
      const between = `${src}.pappdrive-move-${tempName()}`
      await fsp.rename(src, between)
      const dst = await this.ensureParent(to)
      await fsp.rename(between, dst)
      return
    }
    const dst = await this.ensureParent(to)
    await fsp.rename(src, dst)
  }

  async remove(path: string): Promise<void> {
    try {
      await fsp.unlink(await this.real(path))
    } catch (e) {
      if (errCode(e) === "ENOENT" || errCode(e) === "ENOTDIR") return
      throw e
    }
  }

  async removeEmptyDirs(dir: string): Promise<void> {
    for (let d = dir; d !== ""; d = parentOf(d)) {
      if (d.split("/")[0]!.toLowerCase() === HIDDEN_DIR) return
      const abs = await this.real(d)
      let names: string[]
      try {
        names = await fsp.readdir(abs)
      } catch (e) {
        if (errCode(e) === "ENOENT") continue // already gone: look at its parent
        if (errCode(e) === "ENOTDIR") return
        throw e
      }
      // A folder holding only the system's leftovers (.DS_Store and the like) counts as empty.
      if (names.some((n) => !JUNK.has(n.toLowerCase()))) return
      for (const n of names) await fsp.rm(join(abs, n), { force: true })
      try {
        await fsp.rmdir(abs)
      } catch (e) {
        if (errCode(e) === "ENOENT") continue
        if (errCode(e) === "ENOTEMPTY" || errCode(e) === "EEXIST" || errCode(e) === "EBUSY" || errCode(e) === "EPERM") return
        throw e
      }
    }
  }

  /** The on-disk path for `path`, with its parent folders created. Refuses a parent that is a file. */
  private async ensureParent(path: string): Promise<string> {
    const parent = parentOf(path)
    if (parent !== "") {
      const absParent = await this.real(parent)
      try {
        await fsp.mkdir(absParent, { recursive: true })
      } catch (e) {
        if (errCode(e) === "EEXIST" || errCode(e) === "ENOTDIR") {
          throw new SyncError("bad-path", `Cannot create "${path}": a file is in the way of its folder "${parent}".`)
        }
        throw e
      }
    }
    return this.real(path)
  }

  // ---------- Temp files ----------

  async tempSize(temp: string): Promise<number | null> {
    try {
      return (await fsp.stat(this.tempPath(temp))).size
    } catch (e) {
      if (errCode(e) === "ENOENT") return null
      throw e
    }
  }

  async tempAppend(temp: string, data: Uint8Array): Promise<void> {
    await fsp.mkdir(this.tmp, { recursive: true })
    await fsp.appendFile(this.tempPath(temp), data)
  }

  async tempTruncate(temp: string, size: number): Promise<void> {
    await fsp.truncate(this.tempPath(temp), size)
  }

  async tempRemove(temp: string): Promise<void> {
    await fsp.rm(this.tempPath(temp), { force: true })
  }

  async tempList(): Promise<string[]> {
    try {
      return await fsp.readdir(this.tmp)
    } catch (e) {
      if (errCode(e) === "ENOENT") return []
      throw e
    }
  }

  // ---------- State files ----------

  private statePath(name: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".") || name === TMP) {
      throw new SyncError("bad-path", `"${name}" is not a valid state file name. Use letters, digits, ".", "-" and "_".`)
    }
    return join(this.hidden, name)
  }

  async loadState(name: string): Promise<string | null> {
    try {
      return await fsp.readFile(this.statePath(name), "utf8")
    } catch (e) {
      if (errCode(e) === "ENOENT") return null
      throw e
    }
  }

  /** Atomic: write a temp file next to it, flush it to disk, then rename over the old one. */
  async saveState(name: string, data: string): Promise<void> {
    const target = this.statePath(name)
    await fsp.mkdir(this.hidden, { recursive: true })
    const temp = `${target}.${tempName()}.saving`
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
}

async function present(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p)
    return true
  } catch {
    return false
  }
}

/** The name in `dir` whose NFC form is `nfc`, or null. */
async function findNfc(dir: string, nfc: string): Promise<string | null> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return null
  }
  return names.find((n) => n.normalize("NFC") === nfc) ?? null
}
