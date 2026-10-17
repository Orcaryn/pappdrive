import { afterEach, describe, expect, it } from "vitest"
import type { Coordinator, CoordinatorMessage, Watcher } from "../src/core/types.js"
import { closeDevices, device, setup } from "./helpers/device.js"
import { MemFs } from "./helpers/memfs.js"

afterEach(closeDevices)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(cond: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timed out waiting")
    await sleep(5)
  }
}

class FakeWatcher implements Watcher {
  onPaths: ((p: string[]) => void) | null = null
  onDropped: (() => void) | null = null
  globs: string[] = []
  starts = 0
  async start(_root: unknown, globs: string[], onPaths: (p: string[]) => void, onDropped: () => void) {
    this.starts++
    this.globs = globs
    this.onPaths = onPaths
    this.onDropped = onDropped
    return async () => {
      this.onPaths = null
    }
  }
}

describe("files API", () => {
  it("write, read, list, remove, and the errors that say what to do", async () => {
    const { server, keys } = await setup(0)
    const { folder, fs } = await device(server, keys)
    await folder.write("notes/a.md", "a")
    await folder.write("notes/deep/b.md", new TextEncoder().encode("b"))
    await folder.write("c.txt", new Blob(["c"]))
    await folder.write(
      "s.txt",
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("str"))
          c.enqueue(new TextEncoder().encode("eam"))
          c.close()
        },
      }),
    )
    await folder.write("empty.txt", "")
    expect(await folder.readText("s.txt")).toBe("stream")
    expect(await folder.read("empty.txt")).toEqual(new Uint8Array(0))
    expect((await folder.list()).map((f) => [f.path, f.dir])).toEqual([
      ["c.txt", false],
      ["empty.txt", false],
      ["notes", true],
      ["s.txt", false],
    ])
    expect((await folder.list("notes")).map((f) => f.path)).toEqual(["notes/a.md", "notes/deep"])
    const info = (await folder.list("notes")).find((f) => f.path === "notes/a.md")!
    expect(info.size).toBe(1)
    // a folder is listed only while it has files
    fs.dirs.set("emptydir", "emptydir")
    expect((await folder.list()).map((f) => f.path)).not.toContain("emptydir")
    await folder.remove("notes/deep/b.md")
    expect((await folder.list("notes")).map((f) => f.path)).toEqual(["notes/a.md"])

    await expect(folder.read("nope.md")).rejects.toMatchObject({ code: "not-found" })
    await expect(folder.read("nope.md")).rejects.toThrow("files.list()")
    await expect(folder.remove("nope.md")).rejects.toMatchObject({ code: "not-found" })
    await expect(folder.write("/abs.md", "x")).rejects.toMatchObject({ code: "bad-path" })
    await expect(folder.write("a/../b.md", "x")).rejects.toMatchObject({ code: "bad-path" })
    await expect(folder.write(".pappdrive/x", "x")).rejects.toMatchObject({ code: "bad-path" })
    await expect(folder.write("notes", "x")).rejects.toThrow("is a folder")
    await expect(folder.write("c.txt/inside.md", "x")).rejects.toThrow("is a file")
    const reader = folder.readStream("nope.md").getReader()
    await expect(reader.read()).rejects.toMatchObject({ code: "not-found" })
    // NFD input is stored as NFC
    await folder.write("café.md", "x")
    expect(fs.paths()).toContain("café.md")
  })

  it("writing to an ignored path saves on this device only, and fires nothing", async () => {
    const { server, keys } = await setup(0)
    const a = await device(server, keys)
    await a.folder.write(".pappignore", "cache/\n")
    const before = a.changes.length
    await a.folder.write("cache/thumb.png", "local")
    expect(a.changes.length).toBe(before)
    await a.folder.sync()
    expect(Object.keys(await server.body(keys))).toEqual([".pappignore"])
    expect(await a.folder.readText("cache/thumb.png")).toBe("local")
    expect(a.folder.status.pending).toBe(0)
  })

  it("status reports pending changes and syncing", async () => {
    const { server, keys } = await setup(0)
    const a = await device(server, keys)
    const seen: boolean[] = []
    a.folder.onStatus((s) => seen.push(s.syncing))
    await a.folder.write("x.md", "x")
    await until(() => a.folder.status.pending === 1)
    await a.folder.sync()
    expect(a.folder.status.pending).toBe(0)
    expect(seen).toContain(true)
    expect(seen.at(-1)).toBe(false)
    expect(a.folder.status).toMatchObject({ syncing: false, skipped: [], deleted: null, error: null })
  })
})

describe("scheduling", () => {
  it("local changes sync after the debounce; a burst of saves is one commit", async () => {
    const { server, keys } = await setup(0)
    const a = await device(server, keys, { tuning: { quietMs: 30, maxWaitMs: 200 } })
    const commits = server.commits
    await a.folder.write("1.md", "1")
    await a.folder.write("2.md", "2")
    await a.folder.write("3.md", "3")
    expect(server.commits).toBe(commits)
    await until(() => server.commits === commits + 1)
    await sleep(60)
    expect(server.commits).toBe(commits + 1)
    expect(Object.keys(await server.body(keys)).sort()).toEqual(["1.md", "2.md", "3.md"])
  })

  it("while the debounce waits, a poll round only applies server changes", async () => {
    const { server, keys } = await setup(0)
    const b = await device(server, keys)
    const a = await device(server, keys, { tuning: { quietMs: 10_000, maxWaitMs: 10_000, pollMs: 20 } })
    await b.folder.write("from-b.md", "b")
    await b.folder.sync()
    await a.folder.write("from-a.md", "a")
    await until(() => a.fs.text("from-b.md") === "b")
    expect(Object.keys(await server.body(keys))).toEqual(["from-b.md"])
    await a.folder.sync() // ends the debounce at once
    expect(Object.keys(await server.body(keys)).sort()).toEqual(["from-a.md", "from-b.md"])
  })

  it("going to the background ends the debounce and syncs", async () => {
    const { server, keys } = await setup(0)
    let bg: (() => void) | null = null
    const d = await device(server, keys, { tuning: { quietMs: 60_000, maxWaitMs: 60_000 } }, false)
    ;(d.ctx.platform as { onBackground?: (cb: () => void) => () => void }).onBackground = (cb) => {
      bg = cb
      return () => (bg = null)
    }
    await d.folder.start()
    await d.folder.sync()
    await d.folder.write("x.md", "x")
    expect(Object.keys(await server.body(keys))).toEqual([])
    bg!()
    await until(async () => Object.keys(await server.body(keys)).length === 1)
  })
})

describe("visible folders and the watcher", () => {
  it("events are hints: after quiet, each file is looked at; a rename-save is one change", async () => {
    const { server, keys } = await setup(0)
    const watcher = new FakeWatcher()
    const a = await device(server, keys, { kind: "visible", watcher, tuning: { watchQuietMs: 20, watchMaxMs: 200, quietMs: 20, maxWaitMs: 200 } })
    expect(watcher.globs).toEqual(expect.arrayContaining(["**/.git", ".pappdrive", "**/node_modules"]))
    a.fs.put("doc.md", "v1")
    watcher.onPaths!(["doc.md"])
    await until(async () => Object.keys(await server.body(keys)).includes("doc.md"))
    // an editor saves by rename: deleted, then created
    const before = a.changes.length
    a.fs.del("doc.md")
    watcher.onPaths!(["doc.md"])
    a.fs.put("doc.md", "version 2")
    watcher.onPaths!(["doc.md"])
    await until(async () => (await server.body(keys))["doc.md"]?.size === 9)
    expect(a.changes.slice(before)).toEqual([{ path: "doc.md", origin: "local" }])
    // a deletion by another program
    a.fs.del("doc.md")
    watcher.onPaths!(["doc.md"])
    await until(async () => !(await server.body(keys))["doc.md"])
  })

  it("dropped events mean a full scan", async () => {
    const { server, keys } = await setup(0)
    const watcher = new FakeWatcher()
    const a = await device(server, keys, { kind: "visible", watcher, tuning: { quietMs: 20, maxWaitMs: 200 } })
    a.fs.put("x/a.md", "a")
    a.fs.put("x/b.md", "b")
    watcher.onDropped!()
    await until(async () => Object.keys(await server.body(keys)).length === 2)
  })

  it("a folder event scans the folder; downloads do not look like local changes", async () => {
    const { server, keys } = await setup(0)
    const watcher = new FakeWatcher()
    const other = await device(server, keys)
    const a = await device(server, keys, { kind: "visible", watcher, tuning: { watchQuietMs: 10, quietMs: 10, maxWaitMs: 100 } })
    a.fs.put("dir/one.md", "1")
    a.fs.put("dir/two.md", "2")
    watcher.onPaths!(["dir"])
    await until(async () => Object.keys(await server.body(keys)).length === 2)
    await other.folder.write("dir/three.md", "3")
    await other.folder.sync()
    const commits = server.commits
    await a.folder.sync()
    watcher.onPaths!(["dir/three.md"]) // the watcher sees our own download
    await sleep(80)
    expect(server.commits).toBe(commits)
    expect(a.changes.filter((c) => c.path === "dir/three.md").map((c) => c.origin)).toEqual(["remote"])
  })

  it("without a watcher, a visible folder is scanned each round", async () => {
    const { server, keys } = await setup(0)
    const a = await device(server, keys, { kind: "visible" })
    a.fs.put("x.md", "x")
    await a.folder.sync()
    expect(Object.keys(await server.body(keys))).toEqual(["x.md"])
    expect(a.changes).toContainEqual({ path: "x.md", origin: "local" })
  })

  it("rescans only files whose size or mtime changed", async () => {
    const { server, keys } = await setup(0)
    const fs = new MemFs({ kind: "visible" })
    for (let i = 0; i < 5; i++) fs.put(`f${i}.md`, `file ${i}`)
    const a = await device(server, keys, { fs })
    await a.folder.close()
    let reads = 0
    const read = fs.read.bind(fs)
    fs.read = async (p, o, l) => {
      reads++
      return read(p, o, l)
    }
    fs.put("f0.md", "changed")
    await device(server, keys, { fs })
    expect(reads).toBe(1 + 1) // hashing f0, and reading it to upload
  })
})

describe("browser tabs", () => {
  function bus() {
    const subs = new Set<(m: CoordinatorMessage) => void>()
    let leader: object | null = null
    const waiting: (() => void)[] = []
    const make = (): Coordinator & { me: object } => {
      const me = {}
      const mine = new Set<(m: CoordinatorMessage) => void>()
      let closed = false
      return {
        me,
        waitForLead: () =>
          new Promise<void>((resolve) => {
            const tryTake = () => {
              if (closed) return
              if (!leader) {
                leader = me
                resolve()
              } else waiting.push(tryTake)
            }
            tryTake()
          }),
        isLeader: () => leader === me,
        post: (m) => {
          for (const s of subs) if (!mine.has(s)) s(structuredClone(m))
        },
        onMessage: (cb) => {
          subs.add(cb)
          mine.add(cb)
          return () => {
            subs.delete(cb)
            mine.delete(cb)
          }
        },
        close: () => {
          closed = true
          for (const s of mine) subs.delete(s)
          if (leader === me) {
            leader = null
            waiting.splice(0).forEach((f) => f())
          }
        },
      }
    }
    return make
  }

  it("only the leader syncs; a follower's writes reach it, and the follower hears the leader", async () => {
    const { server, keys } = await setup(0)
    const coordinator = bus()
    const shared = new MemFs() // tabs share the origin's private storage
    const lead = await device(server, keys, { fs: shared, coordinator, tuning: { quietMs: 10, maxWaitMs: 100 } })
    const follow = await device(server, keys, { fs: shared, coordinator })
    await follow.folder.write("from-follower.md", "f")
    expect(follow.changes).toContainEqual({ path: "from-follower.md", origin: "local" })
    await until(async () => Object.keys(await server.body(keys)).includes("from-follower.md"))
    expect(follow.folder.status.lastSync).not.toBeNull()
    const other = await device(server, keys)
    await other.folder.write("remote.md", "r")
    await other.folder.sync()
    await follow.folder.sync()
    expect(follow.changes).toContainEqual({ path: "remote.md", origin: "remote" })
    expect(follow.changes.filter((c) => c.path === "from-follower.md")).toHaveLength(1)
    // the leader closes: the follower takes over
    await lead.folder.close()
    await other.folder.write("later.md", "l")
    await other.folder.sync()
    await until(async () => {
      await follow.folder.sync()
      return shared.text("later.md") === "l"
    })
  })
})
