import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import * as fsp from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
import { SyncError } from "../src/core/errors.js"
import { canCreateName, openNodeFs, type NodeFs } from "../src/node/fs.js"
import { nodeKeyStore, keyFileName } from "../src/node/keystore.js"
import { expandHome, openVisibleFolder, privateStorePath } from "../src/node/platform.js"
import { toRelative } from "../src/node/watcher.js"

const enc = new TextEncoder()
const dec = new TextDecoder()
const scratch: string[] = []
const tmp = (label: string) => {
  const d = mkdtempSync(join(tmpdir(), `pappdrive-${label}-`))
  scratch.push(d)
  return d
}
afterAll(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })))

/** Is this temp volume case-insensitive? (macOS and Windows usually, Linux usually not.) */
function volumeIgnoresCase(dir: string): boolean {
  const p = join(dir, "CaseCheck")
  rmSync(p, { force: true })
  writeFileSync(p, "")
  const r = existsSync(join(dir, "casecheck"))
  rmSync(p, { force: true })
  return r
}

describe("node FsAdapter", () => {
  let root: string
  let fs: NodeFs
  beforeEach(async () => {
    root = join(tmp("fs"), "folder")
    fs = await openNodeFs(root, "visible")
  })

  it("creates the folder, the hidden folder and its tmp folder, and leaves no probe behind", () => {
    expect(statSync(join(root, ".pappdrive", "tmp")).isDirectory()).toBe(true)
    expect(readdirSync(join(root, ".pappdrive"))).toEqual(["tmp"])
  })

  it("detects whether the volume ignores capital letters", () => {
    expect(fs.caseInsensitive).toBe(volumeIgnoresCase(root))
  })

  it("lists, stats and reads files; a folder stats as null; a missing folder lists as []", async () => {
    await fsp.mkdir(join(root, "notes"))
    await fsp.writeFile(join(root, "notes", "a.md"), "hello world")
    expect(await fs.stat("notes")).toBeNull()
    expect(await fs.stat("missing.md")).toBeNull()
    expect(await fs.stat("notes/a.md/x")).toBeNull()
    const st = await fs.stat("notes/a.md")
    expect(st?.size).toBe(11)
    expect(Number.isInteger(st?.mtime)).toBe(true)
    const top = await fs.list("")
    expect(top.sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: ".pappdrive", dir: true },
      { name: "notes", dir: true },
    ])
    expect(await fs.list("notes")).toEqual([{ name: "a.md", dir: false }])
    expect(await fs.list("nope")).toEqual([])
    expect(dec.decode(await fs.read("notes/a.md", 6, 100))).toBe("world")
    expect(dec.decode(await fs.read("notes/a.md", 0, 5))).toBe("hello")
    expect((await fs.read("notes/a.md", 50, 10)).length).toBe(0)
    await expect(fs.read("nope.md", 0, 1)).rejects.toMatchObject({ code: "not-found" })
  })

  it("lists links to files as files, leaves out links to folders", async () => {
    await fsp.writeFile(join(root, "real.md"), "x")
    await fsp.mkdir(join(root, "d"))
    try {
      await fsp.symlink(join(root, "real.md"), join(root, "link.md"))
      await fsp.symlink(join(root, "d"), join(root, "dlink"))
      await fsp.symlink(join(root, "gone"), join(root, "broken"))
    } catch {
      return // no symlinks here (Windows without the right)
    }
    const names = (await fs.list("")).map((e) => `${e.name}:${e.dir}`).sort()
    expect(names).toEqual([".pappdrive:true", "d:true", "link.md:false", "real.md:false"])
  })

  it("maps NFD names on disk to NFC paths, both ways", async () => {
    const nfc = "Café/résumé.md".normalize("NFC")
    const nfd = nfc.normalize("NFD")
    await fsp.mkdir(join(root, nfd.split("/")[0]!))
    await fsp.writeFile(join(root, nfd), "bonjour")
    const top = await fs.list("")
    expect(top.map((e) => e.name)).toContain("Café".normalize("NFC"))
    const inner = await fs.list("Café".normalize("NFC"))
    expect(inner).toEqual([{ name: "résumé.md".normalize("NFC"), dir: false }])
    expect((await fs.stat(nfc))?.size).toBe(7)
    expect(dec.decode(await fs.read(nfc, 0, 100))).toBe("bonjour")
    // A download into the NFC path replaces the NFD file, not a second file beside it.
    await fs.tempAppend("t1", enc.encode("salut"))
    await fs.moveTempInto("t1", nfc)
    expect(await fs.list("Café".normalize("NFC"))).toHaveLength(1)
    expect(dec.decode(await fs.read(nfc, 0, 100))).toBe("salut")
    await fs.remove(nfc)
    expect(await fs.stat(nfc)).toBeNull()
    await fs.removeEmptyDirs("Café".normalize("NFC"))
    expect((await fs.list("")).map((e) => e.name)).toEqual([".pappdrive"])
  })

  it("creates new names in NFC", async () => {
    const nfc = "naïve.md".normalize("NFC")
    await fs.tempAppend("t", enc.encode("x"))
    await fs.moveTempInto("t", `dir/${nfc}`)
    const raw = readdirSync(join(root, "dir"))
    expect(raw).toHaveLength(1)
    expect(raw[0]!.normalize("NFC")).toBe(nfc)
    if (process.platform !== "darwin") expect(raw[0]).toBe(nfc) // macOS may report either form
  })

  it("canCreate follows the system's rules", () => {
    expect(canCreateName("a:b.md", false)).toBe(true)
    expect(canCreateName("what?.md", false)).toBe(true)
    expect(canCreateName("CON", false)).toBe(true)
    expect(canCreateName("a/b", false)).toBe(false)
    expect(canCreateName("a\0b", false)).toBe(false)
    for (const bad of ["a:b.md", "x<y", "q?", "s*", 'quote"', "pipe|", "back\\slash", "dot.", "space ", "CON", "con.txt", "NUL", "com1", "LPT9.log", "COM¹", "aux.md"]) {
      expect(canCreateName(bad, true), bad).toBe(false)
    }
    for (const good of ["todo.md", "console.md", "com10", "a.b.c", ".hidden", "café"]) expect(canCreateName(good, true), good).toBe(true)
    expect(fs.canCreate("todo.md")).toBe(true)
  })

  it("moves a temp file into place, creating parents, and returns its stat", async () => {
    await fs.tempAppend("abc", enc.encode("part one "))
    await fs.tempAppend("abc", enc.encode("part two"))
    expect(await fs.tempSize("abc")).toBe(17)
    await fs.tempTruncate("abc", 8)
    expect(await fs.tempSize("abc")).toBe(8)
    expect(await fs.tempList()).toEqual(["abc"])
    const st = await fs.moveTempInto("abc", "deep/er/file.txt")
    expect(st.size).toBe(8)
    expect(await fs.stat("deep/er/file.txt")).toEqual(st)
    expect(await fs.tempList()).toEqual([])
    expect(await fs.tempSize("abc")).toBeNull()
    // Replaces an existing file.
    await fs.tempAppend("v2", enc.encode("new"))
    await fs.moveTempInto("v2", "deep/er/file.txt")
    expect(dec.decode(await fs.read("deep/er/file.txt", 0, 10))).toBe("new")
    await fs.tempAppend("gone", enc.encode("x"))
    await fs.tempRemove("gone")
    await fs.tempRemove("gone") // no error when missing
    expect(await fs.tempList()).toEqual([])
    await expect(fs.tempAppend("../escape", enc.encode("x"))).rejects.toBeInstanceOf(SyncError)
  })

  it("refuses to create a folder where a file is", async () => {
    await fsp.writeFile(join(root, "notes"), "a file")
    await fs.tempAppend("t", enc.encode("x"))
    await expect(fs.moveTempInto("t", "notes/a.md")).rejects.toMatchObject({ code: "bad-path" })
  })

  it("moves files and folders, and renames when only capitals change", async () => {
    await fsp.mkdir(join(root, "notes"))
    await fsp.writeFile(join(root, "notes", "a.md"), "a")
    await fs.move("notes/a.md", "other/b.md")
    expect(await fs.stat("notes/a.md")).toBeNull()
    expect((await fs.stat("other/b.md"))?.size).toBe(1)
    await fs.move("other", "notes (conflict)/inner")
    expect((await fs.stat("notes (conflict)/inner/b.md"))?.size).toBe(1)
    await fs.move("notes (conflict)/inner/b.md", "notes (conflict)/inner/B.md")
    expect(readdirSync(join(root, "notes (conflict)", "inner"))).toEqual(["B.md"])
    await fs.move("notes (conflict)", "Notes (Conflict)")
    expect(readdirSync(root).sort()).toEqual([".pappdrive", "Notes (Conflict)", "notes"])
  })

  it("removes files, with no error when missing", async () => {
    await fsp.writeFile(join(root, "a.md"), "a")
    await fs.remove("a.md")
    await fs.remove("a.md")
    await fs.remove("no/such/dir/x.md")
    expect(existsSync(join(root, "a.md"))).toBe(false)
  })

  it("removes empty folders up to the first non-empty one, never the top or the hidden folder", async () => {
    await fsp.mkdir(join(root, "a", "b", "c"), { recursive: true })
    await fsp.writeFile(join(root, "a", "keep.md"), "k")
    await fs.removeEmptyDirs("a/b/c")
    expect(existsSync(join(root, "a", "b"))).toBe(false)
    expect(existsSync(join(root, "a", "keep.md"))).toBe(true)
    await fsp.rm(join(root, "a", "keep.md"))
    await fsp.mkdir(join(root, "x", "y"), { recursive: true })
    await fsp.writeFile(join(root, "x", "y", ".DS_Store"), "junk")
    await fs.removeEmptyDirs("x/y")
    expect(existsSync(join(root, "x"))).toBe(false) // only the system's leftovers: counts as empty
    await fs.removeEmptyDirs("a")
    await fs.removeEmptyDirs("")
    await fs.removeEmptyDirs("missing/deeper")
    expect(existsSync(root)).toBe(true)
    await fs.removeEmptyDirs(".pappdrive/tmp")
    expect(existsSync(join(root, ".pappdrive", "tmp"))).toBe(true)
  })

  it("saves state atomically and loads it back", async () => {
    expect(await fs.loadState("synced")).toBeNull()
    await fs.saveState("synced", '{"a":1}')
    await fs.saveState("synced", '{"a":2}')
    expect(await fs.loadState("synced")).toBe('{"a":2}')
    expect(readdirSync(join(root, ".pappdrive")).sort()).toEqual(["synced", "tmp"]) // no temp files left
    await Promise.all(Array.from({ length: 20 }, (_, i) => fs.saveState("disk", JSON.stringify({ i }))))
    expect(JSON.parse((await fs.loadState("disk"))!)).toHaveProperty("i")
    await expect(fs.saveState("../x", "")).rejects.toMatchObject({ code: "bad-path" })
    await expect(fs.saveState("tmp", "")).rejects.toMatchObject({ code: "bad-path" })
  })

  it("destroy: a visible folder loses only its hidden folder", async () => {
    await fsp.writeFile(join(root, "mine.md"), "the user's file")
    await fs.saveState("synced", "{}")
    await fs.destroy()
    expect(readdirSync(root)).toEqual(["mine.md"])
  })

  it("destroy: a private store is removed whole", async () => {
    const store = join(tmp("priv"), "store")
    const p = await openNodeFs(store, "private")
    await p.tempAppend("t", enc.encode("x"))
    await p.moveTempInto("t", "a.md")
    await p.destroy()
    expect(existsSync(store)).toBe(false)
  })
})

describe("node platform", () => {
  const saved = process.env.PAPPDRIVE_DATA_DIR
  afterEach(() => {
    if (saved === undefined) delete process.env.PAPPDRIVE_DATA_DIR
    else process.env.PAPPDRIVE_DATA_DIR = saved
  })

  it("openVisible creates the folder and refuses one inside another app's folder", async () => {
    const base = tmp("vis")
    const outer = await openVisibleFolder(join(base, "outer"))
    expect(outer.kind).toBe("visible")
    await openVisibleFolder(join(base, "sibling", "deep")) // fine: not inside
    let err: unknown
    try {
      await openVisibleFolder(join(base, "outer", "sub", "inner"))
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SyncError)
    expect((err as SyncError).code).toBe("folder-taken")
    expect((err as SyncError).message).toContain(join(base, "outer"))
    expect((err as SyncError).message).toContain("Open a folder outside")
    expect(existsSync(join(base, "outer", "sub"))).toBe(false) // refused before creating anything
    // Opening the same folder again is the engine's call (it checks which app the hidden folder records).
    await openVisibleFolder(join(base, "outer"))
  })

  it("openVisible refuses a file", async () => {
    const base = tmp("visfile")
    await fsp.writeFile(join(base, "f"), "x")
    await expect(openVisibleFolder(join(base, "f"))).rejects.toMatchObject({ code: "bad-path" })
  })

  it("expands ~", () => {
    expect(expandHome("~/Notes")).toBe(join(homedir(), "Notes"))
    expect(expandHome("~")).toBe(homedir())
  })

  it("keeps a read-only mirror next to the own store, never inside it", () => {
    process.env.PAPPDRIVE_DATA_DIR = "/data"
    const own = privateStorePath("u1", "dashboard")
    const mirror = privateStorePath("u1", "dashboard", "my-notes")
    expect(own).toBe(join("/data", "u1", "dashboard"))
    expect(mirror).toBe(join("/data", "u1", "dashboard.read", "my-notes"))
    expect(mirror.startsWith(own + "/")).toBe(false)
    expect(() => privateStorePath("../x", "a")).toThrow(SyncError)
    expect(() => privateStorePath("u1", "a/b")).toThrow(SyncError)
  })
})

describe("watcher paths", () => {
  it("maps absolute paths to relative NFC paths", () => {
    expect(toRelative("/r/folder", "/r/folder/a/b.md")).toBe("a/b.md")
    expect(toRelative("/r/folder", "/r/folder")).toBeNull()
    expect(toRelative("/r/folder", "/r/other/x")).toBeNull()
    expect(toRelative("/r/folder", "/r/folder/..x.md")).toBe("..x.md")
    expect(toRelative("/r/Café", "/r/Café/é.md".normalize("NFC"))).toBe("é.md".normalize("NFC"))
  })
})

describe("key store, file fallback", () => {
  it("stores keys in a 0600 file in a 0700 folder", async () => {
    const dir = join(tmp("keys"), "pappdrive")
    const ks = nodeKeyStore({ backend: "file", dir })
    expect(await ks.get("pappdrive:https://x.example:app")).toBeNull()
    await ks.set("pappdrive:https://x.example:app", '{"k":1}')
    expect(await ks.get("pappdrive:https://x.example:app")).toBe('{"k":1}')
    await ks.set("pappdrive:https://x.example:app", '{"k":2}')
    expect(await ks.get("pappdrive:https://x.example:app")).toBe('{"k":2}')
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    if (process.platform !== "win32") {
      expect(statSync(dir).mode & 0o777).toBe(0o700)
      expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600)
    }
    await ks.delete("pappdrive:https://x.example:app")
    await ks.delete("pappdrive:https://x.example:app")
    expect(await ks.get("pappdrive:https://x.example:app")).toBeNull()
    expect(readdirSync(dir)).toEqual([])
  })

  it("makes safe, distinct file names", () => {
    expect(keyFileName("user-1")).toBe("user-1.key")
    const a = keyFileName("a/b")
    const b = keyFileName("a_b")
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9._-]+\.key$/)
    expect(keyFileName("../../etc/passwd")).not.toContain("/")
    expect(keyFileName("..")).not.toMatch(/^\./)
  })
})
