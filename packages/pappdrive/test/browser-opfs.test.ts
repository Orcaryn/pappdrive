import { describe, expect, it } from "vitest"
import { openOpfs, type OpfsDirHandle, type OpfsFileHandle, type OpfsWritable } from "../src/browser/opfs.js"

// A small in-memory OPFS: the same handle semantics the adapter relies on.
const fail = (name: string) => new DOMException(name, name)

class FakeFile implements OpfsFileHandle {
  readonly kind = "file" as const
  data = new Uint8Array(0)
  mtime = Date.now()
  constructor(
    public name: string,
    public parent: FakeDir,
  ) {}
  async getFile() {
    if (this.parent.get(this.name) !== this) throw fail("NotFoundError")
    return new File([this.data], this.name, { lastModified: this.mtime })
  }
  async createWritable(): Promise<OpfsWritable> {
    const parts: Uint8Array[] = []
    return {
      write: async (d) => {
        parts.push(d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : new Uint8Array(d))
      },
      close: async () => {
        const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
        let o = 0
        for (const p of parts) (out.set(p, o), (o += p.length))
        this.data = out
        this.mtime = Date.now()
      },
      abort: async () => {},
    }
  }
  async move(dir: OpfsDirHandle, name: string) {
    const d = dir as FakeDir
    const there = d.get(name)
    if (there && there.kind === "directory") throw fail("TypeMismatchError")
    this.parent.delete(this.name)
    d.set(name, this)
    this.parent = d
    this.name = name
  }
}

class FakeDir implements OpfsDirHandle {
  readonly kind = "directory" as const
  private kids = new Map<string, FakeDir | FakeFile>()
  constructor(
    public name: string,
    private ci: boolean,
  ) {}
  private k(n: string) {
    return this.ci ? n.toLowerCase() : n
  }
  get(n: string) {
    return this.kids.get(this.k(n))
  }
  set(n: string, h: FakeDir | FakeFile) {
    this.kids.set(this.k(n), h)
  }
  delete(n: string) {
    this.kids.delete(this.k(n))
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    const h = this.get(name)
    if (h?.kind === "file") throw fail("TypeMismatchError")
    if (h) return h
    if (!o?.create) throw fail("NotFoundError")
    const d = new FakeDir(name, this.ci)
    this.set(name, d)
    return d
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    const h = this.get(name)
    if (h?.kind === "directory") throw fail("TypeMismatchError")
    if (h) return h
    if (!o?.create) throw fail("NotFoundError")
    const f = new FakeFile(name, this)
    this.set(name, f)
    return f
  }
  async removeEntry(name: string, o?: { recursive?: boolean }) {
    const h = this.get(name)
    if (!h) throw fail("NotFoundError")
    if (h.kind === "directory" && h.kids.size > 0 && !o?.recursive) throw fail("InvalidModificationError")
    this.delete(name)
  }
  async *entries(): AsyncIterable<[string, FakeDir | FakeFile]> {
    for (const h of [...this.kids.values()]) yield [h.name, h]
  }
}

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array) => new TextDecoder().decode(b)

async function setup(ci = false) {
  const top = new FakeDir("", ci)
  const fs = await openOpfs("u1", "notes", undefined, async () => top)
  return { top, fs }
}

describe("OPFS adapter", () => {
  it("is private, case-sensitive in Chrome/Firefox, and takes any name", async () => {
    const { fs } = await setup()
    expect(fs.kind).toBe("private")
    expect(fs.caseInsensitive).toBe(false)
    expect(fs.canCreate("a:b?.md")).toBe(true)
  })

  it("builds a temp file from parts, moves it into place, and cleans up", async () => {
    const { fs } = await setup()
    expect(await fs.tempSize("abc")).toBeNull()
    await fs.tempAppend("abc", bytes("hello "))
    await fs.tempAppend("abc", bytes("big "))
    await fs.tempAppend("abc", bytes("world"))
    expect(await fs.tempSize("abc")).toBe(15)
    expect(await fs.tempList()).toEqual(["abc"])
    await fs.tempTruncate("abc", 8) // drops "world", cuts "big " to "bi"
    expect(await fs.tempSize("abc")).toBe(8)
    await fs.tempAppend("abc", bytes("g world"))
    const st = await fs.moveTempInto("abc", "notes/deep/a.txt")
    expect(st.size).toBe(15)
    expect(text(await fs.read("notes/deep/a.txt", 0, 100))).toBe("hello big world")
    expect(text(await fs.read("notes/deep/a.txt", 6, 3))).toBe("big")
    expect(await fs.tempList()).toEqual([])
  })

  it("moves a one-part temp file and replaces an existing file", async () => {
    const { fs } = await setup()
    await fs.tempAppend("t1", bytes("old"))
    await fs.moveTempInto("t1", "a.md")
    await fs.tempAppend("t2", bytes("new!"))
    const st = await fs.moveTempInto("t2", "a.md")
    expect(st.size).toBe(4)
    expect(text(await fs.read("a.md", 0, 10))).toBe("new!")
  })

  it("moves an empty temp file", async () => {
    const { fs } = await setup()
    await fs.tempAppend("e", new Uint8Array(0))
    expect((await fs.moveTempInto("e", "empty.txt")).size).toBe(0)
  })

  it("stat, list, remove and removeEmptyDirs", async () => {
    const { fs } = await setup()
    await fs.tempAppend("x", bytes("1"))
    await fs.moveTempInto("x", "a/b/c.md")
    expect(await fs.stat("a/b")).toBeNull() // a folder
    expect(await fs.stat("nope")).toBeNull()
    expect((await fs.stat("a/b/c.md"))?.size).toBe(1)
    expect((await fs.list("")).map((e) => `${e.name}:${e.dir}`).sort()).toEqual([".pappdrive:true", "a:true"])
    expect(await fs.list("missing")).toEqual([])
    await fs.remove("a/b") // a folder: left alone
    await fs.remove("a/b/c.md")
    await fs.remove("a/b/c.md") // missing: no error
    await fs.removeEmptyDirs("a/b")
    expect((await fs.list("")).map((e) => e.name)).toEqual([".pappdrive"])
  })

  it("removeEmptyDirs stops at a folder that still has files", async () => {
    const { fs } = await setup()
    await fs.tempAppend("x", bytes("1"))
    await fs.moveTempInto("x", "a/keep.md")
    await fs.tempAppend("y", bytes("2"))
    await fs.moveTempInto("y", "a/b/c.md")
    await fs.remove("a/b/c.md")
    await fs.removeEmptyDirs("a/b")
    expect((await fs.list("a")).map((e) => e.name)).toEqual(["keep.md"])
  })

  it("moves files and whole folders", async () => {
    const { fs } = await setup()
    for (const [t, p] of [["1", "notes/a.md"], ["2", "notes/sub/b.md"]] as const) {
      await fs.tempAppend(t, bytes(p))
      await fs.moveTempInto(t, p)
    }
    await fs.move("notes", "notes (conflict)")
    expect(await fs.list("notes")).toEqual([])
    expect(text(await fs.read("notes (conflict)/sub/b.md", 0, 99))).toBe("notes/sub/b.md")
    await fs.move("notes (conflict)/a.md", "Top.md")
    expect(text(await fs.read("Top.md", 0, 99))).toBe("notes/a.md")
    await expect(fs.move("missing", "x")).rejects.toMatchObject({ code: "not-found" })
  })

  it("state files: save, replace, load; no leftovers", async () => {
    const { fs } = await setup()
    expect(await fs.loadState("disk")).toBeNull()
    await fs.saveState("disk", '{"a":1}')
    await fs.saveState("disk", '{"a":2}')
    expect(await fs.loadState("disk")).toBe('{"a":2}')
    const hidden = (await fs.list(".pappdrive")).map((e) => e.name)
    expect(hidden.filter((n) => n.endsWith(".saving"))).toEqual([])
  })

  it("destroy removes the store and empty parents", async () => {
    const { top, fs } = await setup()
    await fs.saveState("disk", "{}")
    await fs.destroy()
    await expect(top.getDirectoryHandle("pappdrive")).rejects.toMatchObject({ name: "NotFoundError" })
  })
})

describe("OPFS adapter on a case-insensitive disk (Safari on a Mac)", () => {
  it("detects it", async () => {
    const { fs } = await setup(true)
    expect(fs.caseInsensitive).toBe(true)
  })
  it("keeps a read-only mirror apart from the app's own store, but destroy keeps the sibling", async () => {
    const top = new FakeDir("", false)
    const own = await openOpfs("u1", "dash", undefined, async () => top)
    const mirror = await openOpfs("u1", "dash", "my-notes", async () => top)
    await own.saveState("disk", "own")
    await mirror.saveState("disk", "mirror")
    expect(await own.loadState("disk")).toBe("own")
    await mirror.destroy()
    expect(await own.loadState("disk")).toBe("own")
    const user = await (await top.getDirectoryHandle("pappdrive")).getDirectoryHandle("u1")
    const names: string[] = []
    for await (const [n] of user.entries()) names.push(n)
    expect(names).toEqual(["dash"])
  })
})
