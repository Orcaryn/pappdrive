// .pappignore: exactly .gitignore, case-insensitive, one file per folder at most.
// See spec 05-client.md, Ignore rules, and 12-implementation.md, Node adapter.
// The git rule (a path already synced is never ignored) is the sync engine's job, not this file's.
import ignore, { type Ignore } from "ignore"
import { HIDDEN_DIR, parentOf } from "./paths.js"

export const IGNORE_FILE = ".pappignore"

// Always ignored; no rule can un-ignore these.
const HARD_DIRS = [".git", HIDDEN_DIR]
// Always ignored, but a .pappignore can un-ignore them with "!".
const SOFT_DEFAULTS = ["node_modules/", ".DS_Store", "Thumbs.db", "desktop.ini", "*.swp", "*.swo", "*~", ".#*", "~$*"]

export interface IgnoreFile {
  dir: string // folder holding the .pappignore, "" for the top folder
  content: string
}

export class IgnoreRules {
  private readonly levels: { dir: string; ig: Ignore; lines: string[] }[]

  constructor(files: IgnoreFile[] = []) {
    const byDir = new Map(files.map((f) => [f.dir, f.content]))
    if (!byDir.has("")) byDir.set("", "")
    this.levels = [...byDir.entries()]
      .map(([dir, content]) => {
        const lines = content.split(/\r?\n/)
        const ig = ignore({ ignorecase: true })
        if (dir === "") ig.add(SOFT_DEFAULTS)
        ig.add(content)
        return { dir, ig, lines }
      })
      // Top folder first, then deeper ones: a deeper file overrides, the way git does.
      .sort((a, b) => depth(a.dir) - depth(b.dir))
  }

  /** True for .git/ and the hidden folder, at any depth. */
  isHard(path: string): boolean {
    return path.split("/").some((seg) => HARD_DIRS.includes(seg.toLowerCase()))
  }

  /** Is this path ignored? `path` is relative to the top folder; pass isDir for folders. */
  ignores(path: string, isDir = false): boolean {
    if (this.isHard(path)) return true
    let ignored = false
    for (const { dir, ig } of this.levels) {
      if (!isInside(path, dir)) continue
      const rel = dir === "" ? path : path.slice(dir.length + 1)
      if (rel === "") continue
      const r = ig.test(isDir ? rel + "/" : rel)
      if (r.ignored) ignored = true
      else if (r.unignored) ignored = false
      // A folder excluded higher up cannot be re-included below, as in git.
      if (ignored && this.parentIgnored(path)) return true
    }
    return ignored
  }

  private parentIgnored(path: string): boolean {
    for (let p = parentOf(path); p !== ""; p = parentOf(p)) {
      for (const { dir, ig } of this.levels) {
        if (!isInside(p, dir) || p === dir) continue
        const rel = dir === "" ? p : p.slice(dir.length + 1)
        if (ig.test(rel + "/").ignored) return true
      }
    }
    return false
  }

  /**
   * Folders the watcher can skip entirely, as globs relative to the top folder.
   * Rules with "!" are never passed: the watcher cannot un-ignore. Every event is still checked with ignores().
   */
  watcherSkipGlobs(): string[] {
    const globs = ["**/.git", HIDDEN_DIR]
    const negations = this.levels.flatMap((l) => l.lines.filter((x) => x.trim().startsWith("!")))
    if (!negations.some((n) => n.toLowerCase().includes("node_modules"))) globs.push("**/node_modules")
    for (const { dir, lines } of this.levels) {
      if (lines.some((x) => x.trim().startsWith("!"))) continue
      for (const raw of lines) {
        const line = raw.trim()
        if (!line.endsWith("/") || line.startsWith("#")) continue
        let pat = line.slice(0, -1)
        const anchored = pat.startsWith("/") || pat.includes("/")
        pat = pat.replace(/^\//, "")
        const prefix = dir ? dir + "/" : ""
        globs.push(anchored ? prefix + pat : `${prefix}**/${pat}`)
      }
    }
    return globs
  }
}

function depth(dir: string): number {
  return dir === "" ? 0 : dir.split("/").length
}

function isInside(path: string, dir: string): boolean {
  return dir === "" || path.toLowerCase().startsWith(dir.toLowerCase() + "/")
}
