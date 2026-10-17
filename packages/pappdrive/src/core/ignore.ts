// .pappignore: exactly .gitignore, case-insensitive, one file per folder at most.
// See spec 05-client.md, Ignore rules, and 12-implementation.md, Node adapter.
// The git rule (a path already synced is never ignored) is the sync engine's job, not this file's.
//
// How git decides, and so how this file decides:
//   1. A path inside an excluded folder is excluded. Nothing can re-include it (git never looks inside).
//   2. Otherwise every .pappignore from the top folder down to the path's folder is consulted, top first.
//      The last rule that matches the path itself wins: a deeper file overrides a higher one,
//      and a later line overrides an earlier one.
// "Matches the path itself" means without the parent check of step 1, which this file does across
// all .pappignore files together. The `ignore` package only does it within one file.
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

interface Level {
  dir: string
  depth: number
  key: string // lowercased dir, for matching
  ig: Ignore
  lines: string[]
  negations: string[] // lines starting with "!", without the "!"
}

interface TestResult {
  ignored: boolean
  unignored: boolean
}

/**
 * Tests the rules of one file against the path itself, without the package's own parent check.
 * Uses the package's internal rule list when there (ignore 5 to 7); else falls back to `test`,
 * which only differs when a folder excluded in this file is re-included by a deeper file.
 */
function ownTest(ig: Ignore, path: string): TestResult {
  const rules = (ig as unknown as { _rules?: { test?: (p: string, unignored: boolean, mode: string) => TestResult } })._rules
  if (rules && typeof rules.test === "function") return rules.test(path, true, "regex")
  return ig.test(path)
}

export class IgnoreRules {
  private readonly levels: Level[]
  private readonly dirCache = new Map<string, boolean>()

  constructor(files: IgnoreFile[] = []) {
    const byDir = new Map(files.map((f) => [f.dir, f.content]))
    if (!byDir.has("")) byDir.set("", "")
    this.levels = [...byDir.entries()]
      .map(([dir, content]) => {
        const lines = content.split(/\r?\n/)
        const ig = ignore({ ignorecase: true })
        if (dir === "") ig.add(SOFT_DEFAULTS)
        ig.add(content)
        const negations = lines.filter((x) => x.startsWith("!")).map((x) => x.slice(1))
        return { dir, depth: depth(dir), key: dir.toLowerCase(), ig, lines, negations }
      })
      // Top folder first, then deeper ones: a deeper file overrides, the way git does.
      .sort((a, b) => a.depth - b.depth)
  }

  /** True for .git/ and the hidden folder, at any depth. */
  isHard(path: string): boolean {
    return path.split("/").some((seg) => HARD_DIRS.includes(seg.toLowerCase()))
  }

  /** Is this path ignored? `path` is relative to the top folder; pass isDir for folders. */
  ignores(path: string, isDir = false): boolean {
    if (path === "") return false
    if (this.isHard(path)) return true
    const parent = parentOf(path)
    if (parent !== "" && this.dirIgnored(parent)) return true
    return this.ownMatch(path, isDir)
  }

  private dirIgnored(dir: string): boolean {
    let r = this.dirCache.get(dir)
    if (r === undefined) {
      r = this.ignores(dir, true)
      this.dirCache.set(dir, r)
    }
    return r
  }

  private ownMatch(path: string, isDir: boolean): boolean {
    const segs = path.split("/")
    const key = path.toLowerCase()
    let ignored = false
    for (const level of this.levels) {
      if (!isInside(key, level.key)) continue
      const rel = segs.slice(level.depth).join("/")
      if (rel === "") continue
      const r = ownTest(level.ig, isDir ? rel + "/" : rel)
      if (r.ignored) ignored = true
      else if (r.unignored) ignored = false
    }
    return ignored
  }

  /**
   * Folders the watcher can skip entirely, as paths and globs relative to the top folder
   * (the @parcel/watcher `ignore` option: a plain path skips its whole subtree, a glob matches
   * whole relative paths, so each folder glob comes with a `/**` twin for what is inside).
   * Rules with "!" are never passed: the watcher cannot un-ignore. A file's folder rules are left out
   * when that file, or any .pappignore below it, has a "!" rule, because it could re-include the folder.
   * Every event is still checked with ignores(). Globs are case-sensitive, so on a case-sensitive
   * system `Build/` is still watched for a rule `build/`; ignores() drops its events.
   */
  watcherSkipGlobs(): string[] {
    const globs = [".git", "**/.git", "**/.git/**", HIDDEN_DIR, `**/${HIDDEN_DIR}`, `**/${HIDDEN_DIR}/**`]
    if (!this.nodeModulesReincluded()) globs.push("node_modules", "**/node_modules", "**/node_modules/**")
    for (const level of this.levels) {
      if (/[*?[\]{}()!+@\\]/.test(level.dir)) continue // a folder name that would read as a glob
      const below = this.levels.filter((l) => isInside(l.key + "/", level.key) || l.key === level.key)
      if (below.some((l) => l.negations.length > 0)) continue
      const prefix = level.dir ? level.dir + "/" : ""
      for (const raw of level.lines) {
        const line = raw.trimEnd() // trailing spaces are not part of a pattern; leading ones are
        if (!line.endsWith("/") || line.startsWith("#") || line.includes("\\")) continue
        let pat = line.slice(0, -1)
        if (pat === "" || pat === "/") continue
        const anchored = pat.includes("/")
        pat = pat.replace(/^\//, "")
        const glob = anchored ? prefix + pat : `${prefix}**/${pat}`
        globs.push(glob, glob + "/**")
      }
    }
    return [...new Set(globs)]
  }

  /** Could any "!" rule re-include a node_modules folder? Then the watcher must look inside. */
  private nodeModulesReincluded(): boolean {
    for (const level of this.levels) {
      if (level.negations.length === 0) continue
      const ig = ignore({ ignorecase: true }).add(level.negations)
      if (["node_modules/", "a/node_modules/", "a/b/node_modules/"].some((p) => ig.ignores(p))) return true
    }
    return false
  }
}

function depth(dir: string): number {
  return dir === "" ? 0 : dir.split("/").length
}

/** `key` and `dirKey` are lowercased. True when `key` is inside the folder `dirKey` ("" is the top). */
function isInside(key: string, dirKey: string): boolean {
  return dirKey === "" || key.startsWith(dirKey + "/")
}
