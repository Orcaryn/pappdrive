import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { afterAll, describe, expect, it } from "vitest"
import { IgnoreRules, type IgnoreFile } from "../src/core/ignore.js"

// picomatch is what @parcel/watcher uses to compile globs; load it from there.
const watcherRequire = createRequire(createRequire(import.meta.url).resolve("@parcel/watcher"))
const picomatch = watcherRequire("picomatch") as {
  (glob: string, opts: { dot: boolean }): (p: string) => boolean
  scan(glob: string): { isGlob: boolean }
}

const rules = (files: Record<string, string>) =>
  new IgnoreRules(Object.entries(files).map(([dir, content]) => ({ dir, content })))

describe("IgnoreRules: always ignored", () => {
  const r = rules({})
  it("ignores .git and the hidden folder at any depth, any case", () => {
    for (const p of [".git", ".git/config", "a/.git/HEAD", ".GIT/x", ".pappdrive", ".pappdrive/disk", "x/.PappDrive/y"]) {
      expect(r.ignores(p), p).toBe(true)
    }
    expect(r.ignores(".gitignore")).toBe(false)
    expect(r.ignores(".github/workflows/ci.yml")).toBe(false)
    expect(r.ignores("a.git")).toBe(false)
  })
  it("cannot un-ignore .git or the hidden folder", () => {
    const u = rules({ "": "!.git/\n!.git\n!.pappdrive/\n!**/.git/**" })
    expect(u.ignores(".git/config")).toBe(true)
    expect(u.ignores(".pappdrive/synced")).toBe(true)
    expect(u.isHard("a/.git/x")).toBe(true)
  })
  it("ignores the soft defaults", () => {
    for (const p of [
      "node_modules/x/index.js",
      "a/node_modules/b.js",
      ".DS_Store",
      "notes/.DS_Store",
      "Thumbs.db",
      "thumbs.db",
      "desktop.ini",
      "a/todo.md.swp",
      "x.swo",
      "todo.md~",
      ".#todo.md",
      "~$report.docx",
    ]) {
      expect(r.ignores(p), p).toBe(true)
    }
    for (const p of ["node_modules.md", "a/node_modules", "todo.md", "swp", "a~b.md", "x.#y"]) expect(r.ignores(p), p).toBe(false)
    expect(r.ignores("node_modules", true)).toBe(true)
  })
  it("lets a .pappignore un-ignore the soft defaults", () => {
    const u = rules({ "": "!node_modules/\n!.DS_Store" })
    expect(u.ignores("node_modules/x.js")).toBe(false)
    expect(u.ignores(".DS_Store")).toBe(false)
    expect(u.ignores("x.swp")).toBe(true)
    const deep = rules({ vendor: "!node_modules/" })
    expect(deep.ignores("vendor/node_modules/x.js")).toBe(false)
    expect(deep.ignores("other/node_modules/x.js")).toBe(true)
  })
})

describe("IgnoreRules: gitignore semantics", () => {
  it("matches by basename without a slash, anchored with one", () => {
    const r = rules({ "": "*.log\n/top.txt\ndocs/draft.md\n" })
    expect(r.ignores("a.log")).toBe(true)
    expect(r.ignores("x/y/a.log")).toBe(true)
    expect(r.ignores("top.txt")).toBe(true)
    expect(r.ignores("x/top.txt")).toBe(false)
    expect(r.ignores("docs/draft.md")).toBe(true)
    expect(r.ignores("x/docs/draft.md")).toBe(false)
  })
  it("folder rules match folders only, and everything inside", () => {
    const r = rules({ "": "build/\n" })
    expect(r.ignores("build", false)).toBe(false) // a file named build
    expect(r.ignores("build", true)).toBe(true)
    expect(r.ignores("build/out.js")).toBe(true)
    expect(r.ignores("a/build/deep/out.js")).toBe(true)
  })
  it("a later ! re-includes a file", () => {
    const r = rules({ "": "*.log\n!keep.log\n" })
    expect(r.ignores("a.log")).toBe(true)
    expect(r.ignores("keep.log")).toBe(false)
    expect(r.ignores("x/keep.log")).toBe(false)
  })
  it("a file inside an excluded folder cannot be re-included", () => {
    const r = rules({ "": "build/\n!build/keep.txt\n" })
    expect(r.ignores("build/keep.txt")).toBe(true)
    const s = rules({ "": "docs/*\n!docs/a/\n" })
    expect(s.ignores("docs/b.md")).toBe(true)
    expect(s.ignores("docs/a/f.md")).toBe(false)
  })
  it("supports ** and character classes", () => {
    const r = rules({ "": "a/**/z.md\n**/cache/\nlog[0-9].txt\n" })
    expect(r.ignores("a/z.md")).toBe(true)
    expect(r.ignores("a/b/c/z.md")).toBe(true)
    expect(r.ignores("b/a/z.md")).toBe(false)
    expect(r.ignores("x/cache/y")).toBe(true)
    expect(r.ignores("log5.txt")).toBe(true)
    expect(r.ignores("logx.txt")).toBe(false)
  })
  it("ignores comments, blank lines and trailing spaces; CRLF files work", () => {
    const r = rules({ "": "# *.md\n\n*.tmp   \r\n\\#hash.txt\r\n" })
    expect(r.ignores("a.md")).toBe(false)
    expect(r.ignores("a.tmp")).toBe(true)
    expect(r.ignores("#hash.txt")).toBe(true)
  })
  it("ignores capital letters, on every device", () => {
    const r = rules({ "": "*.LOG\nBuild/\n", Sub: "Secret.md" })
    expect(r.ignores("a.log")).toBe(true)
    expect(r.ignores("BUILD/x")).toBe(true)
    expect(r.ignores("build/x")).toBe(true)
    expect(r.ignores("sub/secret.md")).toBe(true)
    expect(r.ignores("SUB/SECRET.MD")).toBe(true)
  })
})

describe("IgnoreRules: nested .pappignore files", () => {
  it("applies a nested file to its folder only, with paths relative to it", () => {
    const r = rules({ notes: "/draft.md\n*.bak\n" })
    expect(r.ignores("notes/draft.md")).toBe(true)
    expect(r.ignores("notes/x/draft.md")).toBe(false)
    expect(r.ignores("notes/x/a.bak")).toBe(true)
    expect(r.ignores("draft.md")).toBe(false)
    expect(r.ignores("a.bak")).toBe(false)
    expect(r.ignores("notesx/a.bak")).toBe(false)
  })
  it("a deeper file overrides a higher one, both ways", () => {
    const r = rules({ "": "*.log\n", a: "!keep.log\n", "a/b": "keep.log\n" })
    expect(r.ignores("keep.log")).toBe(true)
    expect(r.ignores("a/keep.log")).toBe(false)
    expect(r.ignores("a/x/keep.log")).toBe(false)
    expect(r.ignores("a/b/keep.log")).toBe(true)
  })
  it("a deeper file can re-include a folder a higher file excluded", () => {
    const r = rules({ "": "build/\n", a: "!build/\n" })
    expect(r.ignores("build/x")).toBe(true)
    expect(r.ignores("a/build/x")).toBe(false)
    expect(r.ignores("a/build/deep/y")).toBe(false)
    expect(r.ignores("b/build/x")).toBe(true)
  })
  it("a .pappignore inside an excluded folder changes nothing", () => {
    const r = rules({ "": "vendor/\n", vendor: "!*\n" })
    expect(r.ignores("vendor/x.js")).toBe(true)
    expect(r.ignores("vendor/.pappignore")).toBe(true)
  })
  it("matches a nested file's folder without regard to capitals", () => {
    const r = rules({ Notes: "*.bak" })
    expect(r.ignores("notes/a.bak")).toBe(true)
    expect(r.ignores("NOTES/A.BAK")).toBe(true)
  })
})

describe("IgnoreRules: watcherSkipGlobs", () => {
  const matcher = (globs: string[]) => {
    const ms = globs.map((g) => picomatch(g, { dot: true }))
    // Plain paths skip their whole subtree; globs match whole relative paths. Like @parcel/watcher.
    return (p: string) =>
      globs.some((g, i) => (picomatch.scan(g).isGlob ? ms[i]!(p) : p === g || p.startsWith(g + "/")))
  }
  it("always skips .git, the hidden folder and node_modules, with everything inside", () => {
    const skip = matcher(rules({}).watcherSkipGlobs())
    for (const p of [".git", ".git/objects/ab", "a/.git/HEAD", ".pappdrive/tmp/x", "node_modules", "node_modules/a/b.js", "x/node_modules/y"]) {
      expect(skip(p), p).toBe(true)
    }
    for (const p of ["a.md", "notes/todo.md", ".gitignore", "node_modules.md"]) expect(skip(p), p).toBe(false)
  })
  it("passes folder rules, anchored or not, relative to their file", () => {
    const skip = matcher(rules({ "": "build/\n/dist/\nlogs/old/\n*.log\n", sub: "cache/\n" }).watcherSkipGlobs())
    expect(skip("build")).toBe(true)
    expect(skip("a/build/x.js")).toBe(true)
    expect(skip("dist/x")).toBe(true)
    expect(skip("a/dist/x")).toBe(false)
    expect(skip("logs/old/1")).toBe(true)
    expect(skip("a/logs/old/1")).toBe(false)
    expect(skip("sub/cache/x")).toBe(true)
    expect(skip("sub/a/cache/x")).toBe(true)
    expect(skip("cache/x")).toBe(false)
    expect(skip("a.log")).toBe(false) // file rules are checked per event, not skipped
  })
  it("never passes ! rules, nor folder rules a ! could re-include", () => {
    const g = rules({ "": "build/\n", a: "!build/\n" }).watcherSkipGlobs()
    expect(g.some((x) => x.startsWith("!"))).toBe(false)
    expect(matcher(g)("a/build/x")).toBe(false)
    const same = matcher(rules({ "": "out/\n!out/\n" }).watcherSkipGlobs())
    expect(same("out/x")).toBe(false)
    // A ! in an unrelated, deeper folder leaves the other folder rules alone.
    const other = matcher(rules({ "": "*.log\n", a: "out/\n", b: "!keep.log\n" }).watcherSkipGlobs())
    expect(other("a/out/x")).toBe(true)
  })
  it("keeps watching node_modules when a rule re-includes it", () => {
    expect(matcher(rules({ "": "!node_modules/" }).watcherSkipGlobs())("node_modules/x")).toBe(false)
    expect(matcher(rules({ deep: "!node_*/" }).watcherSkipGlobs())("deep/node_modules/x")).toBe(false)
    expect(matcher(rules({ "": "*.log\n!keep.log" }).watcherSkipGlobs())("node_modules/x")).toBe(true)
  })
  it("skips nothing the rules do not ignore", () => {
    const r = rules({ "": "build/\n/dist/\nnode_modules/\n", sub: "cache/\n" })
    const skip = matcher(r.watcherSkipGlobs())
    for (const p of ["build/x", "a/build/y", "dist/z", "sub/cache/q", "sub/a/cache/q", "node_modules/m"]) {
      if (skip(p)) expect(r.ignores(p), p).toBe(true)
    }
  })
})

// The reference: real git, with core.ignorecase, on the same files and the same rules.
let git = true
try {
  execFileSync("git", ["--version"], { stdio: "ignore" })
} catch {
  git = false
}

describe.runIf(git)("IgnoreRules agrees with git check-ignore", () => {
  const roots: string[] = []
  afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

  function gitIgnored(files: IgnoreFile[], paths: string[]): Set<string> {
    const root = mkdtempSync(join(tmpdir(), "pappignore-git-"))
    roots.push(root)
    execFileSync("git", ["init", "-q", root])
    for (const p of paths) {
      mkdirSync(dirname(join(root, p)), { recursive: true })
      writeFileSync(join(root, p), "x")
    }
    for (const f of files) {
      const content = f.dir === "" ? "node_modules/\n.DS_Store\n*.swp\n*~\n" + f.content : f.content
      mkdirSync(join(root, f.dir), { recursive: true })
      writeFileSync(join(root, f.dir, ".gitignore"), content)
    }
    const out = execFileSync("git", ["-C", root, "-c", "core.ignorecase=true", "ls-files", "-o", "-i", "--exclude-standard", "-z"], {
      encoding: "utf8",
    })
    return new Set(out.split("\0").filter(Boolean))
  }

  const scenarios: { name: string; files: IgnoreFile[]; paths: string[] }[] = [
    {
      name: "nested files, ! and folder rules",
      files: [
        { dir: "", content: "*.log\nbuild/\n/out\ndocs/*\n!docs/keep/\n" },
        { dir: "a", content: "!keep.log\n!build/\n/local.md\n" },
        { dir: "a/b", content: "keep.log\n*.md\n!readme.md\n" },
      ],
      paths: [
        "x.log", "keep.log", "a/keep.log", "a/x.log", "a/b/keep.log", "a/b/c/keep.log", "a/c/keep.log",
        "build/o.js", "a/build/o.js", "a/b/build/o.js", "c/build/o.js", "out", "out2", "c/out",
        "docs/a.md", "docs/keep/b.md", "docs/keep/x/c.md", "a/local.md", "a/b/local.md", "a/b/readme.md",
        "a/b/notes.md", "notes.md", "node_modules/m/index.js", "a/node_modules/x.js", "a/b/.DS_Store",
        "x.swp", "x.txt~", "src/main.ts",
      ],
    },
    {
      name: "capital letters",
      files: [
        { dir: "", content: "*.TMP\nCache/\n/Top.md\n" },
        { dir: "Sub", content: "Secret.*\n" },
      ],
      paths: ["a.tmp", "b/C.Tmp", "cache/x", "x/CACHE/y", "top.md", "x/top.md", "Sub/secret.txt", "Sub/x/SECRET.md", "secret.txt"],
    },
    {
      name: "excluded folders and re-includes",
      files: [
        { dir: "", content: "vendor/\n!vendor/keep.js\ntmp/*\n!tmp/.gitkeep\n**/gen/**\n!**/gen/keep/\n" },
        { dir: "vendor", content: "!*\n" },
      ],
      paths: ["vendor/a.js", "vendor/keep.js", "tmp/x", "tmp/.gitkeep", "tmp/sub/y", "gen/a", "p/gen/b", "p/gen/keep/c", "gen.txt"],
    },
  ]

  for (const s of scenarios) {
    it(s.name, () => {
      const expected = gitIgnored(s.files, s.paths)
      const r = new IgnoreRules(s.files)
      for (const p of s.paths) expect(r.ignores(p), `${p} (git says ${expected.has(p) ? "ignored" : "kept"})`).toBe(expected.has(p))
    })
  }
})
