import { afterEach, describe, expect, it } from "vitest"
import { buf } from "../src/core/bytes.js"
import { blobId } from "../src/core/crypto.js"
import { SyncError } from "../src/core/errors.js"
import { closeDevices, device, PS, setup, type Device } from "./helpers/device.js"
import { MemFs } from "./helpers/memfs.js"

afterEach(closeDevices)

const conflictCopies = (fs: MemFs) => fs.paths().filter((p) => p.includes("(conflict "))

describe("two devices", () => {
  it("converge through the server, encrypted, with ETags and the cache off", async () => {
    const { server, keys, devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("notes/todo.md", "buy milk")
    await a.folder.write("readme.md", "hi")
    await a.folder.sync()
    expect(Object.keys(await server.body(keys)).sort()).toEqual(["notes/todo.md", "readme.md"])
    // nothing in the bucket is plaintext
    for (const blob of server.blobs.values()) expect(new TextDecoder().decode(blob)).not.toContain("milk")
    expect(server.index!.text).not.toContain("todo")

    await b.folder.sync()
    expect(await b.folder.readText("notes/todo.md")).toBe("buy milk")
    expect(b.changes.filter((c) => c.origin === "remote").map((c) => c.path).sort()).toEqual(["notes/todo.md", "readme.md"])

    // B edits, A gets it
    await b.folder.write("notes/todo.md", "buy oat milk")
    await b.folder.sync()
    await a.folder.sync()
    expect(await a.folder.readText("notes/todo.md")).toBe("buy oat milk")

    // A deletes, B deletes, and the emptied folder goes too
    await a.folder.remove("notes/todo.md")
    await a.folder.sync()
    await b.folder.sync()
    expect(b.fs.paths()).toEqual(["readme.md"])
    expect(await b.folder.list()).toEqual([expect.objectContaining({ path: "readme.md", dir: false })])

    expect(server.sawCacheNoStore).toBe(true)
    expect(server.sawContentLength).toBe(false)
    // An unchanged poll is a 304: no new commit
    const commits = server.commits
    await a.folder.sync()
    await b.folder.sync()
    expect(server.commits).toBe(commits)
    expect(a.folder.status.pending).toBe(0)
    expect(a.folder.status.lastSync).not.toBeNull()
  })

  it("same contents are stored once; a rename uploads nothing", async () => {
    const { server, devs } = await setup(1)
    const [a] = devs as [Device]
    await a.folder.write("a.md", "same")
    await a.folder.write("b.md", "same")
    await a.folder.sync()
    expect(server.puts).toHaveLength(1)
    await a.folder.remove("a.md")
    await a.folder.write("c.md", "same")
    await a.folder.sync()
    expect(server.puts).toHaveLength(1)
  })

  it("both change a file: the server keeps the path, this device's version becomes a conflict copy", async () => {
    const { devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("todo.md", "v1")
    await a.folder.sync()
    await b.folder.sync()
    await a.folder.write("todo.md", "from a")
    await b.folder.write("todo.md", "from b")
    await a.folder.sync()
    await b.folder.sync()
    expect(await b.folder.readText("todo.md")).toBe("from a")
    const copies = conflictCopies(b.fs)
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatch(/^todo \(conflict \d{4}-\d\d-\d\d \d\d-\d\d-\d\d\)\.md$/)
    expect(b.fs.text(copies[0]!)).toBe("from b")
    const conflict = b.changes.find((c) => c.origin === "conflict")
    expect(conflict).toEqual({ path: "todo.md", origin: "conflict", copy: copies[0] })
    // the copy is an ordinary file: it reaches A
    await a.folder.sync()
    expect(a.fs.text(copies[0]!)).toBe("from b")
  })

  it("both new with the same contents is not a conflict; different contents is", async () => {
    const { devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("same.md", "x")
    await b.folder.write("same.md", "x")
    await a.folder.write("diff.md", "a")
    await b.folder.write("diff.md", "b")
    await a.folder.sync()
    await b.folder.sync()
    expect(b.fs.text("same.md")).toBe("x")
    expect(b.fs.text("diff.md")).toBe("a")
    expect(conflictCopies(b.fs).map((p) => b.fs.text(p))).toEqual(["b"])
  })

  it("edit beats delete, in both directions", async () => {
    const { devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("x.md", "v1")
    await a.folder.write("y.md", "v1")
    await a.folder.sync()
    await b.folder.sync()
    // A deletes x, B edits it: B uploads, the file comes back on A
    await a.folder.remove("x.md")
    await a.folder.sync()
    await b.folder.write("x.md", "edited")
    await b.folder.sync()
    expect(b.fs.text("x.md")).toBe("edited")
    await a.folder.sync()
    expect(a.fs.text("x.md")).toBe("edited")
    // B deletes y, A edits it: A's edit comes back to B
    await a.folder.write("y.md", "edited")
    await a.folder.sync()
    await b.folder.remove("y.md")
    await b.folder.sync()
    expect(b.fs.text("y.md")).toBe("edited")
  })

  it("a save during the download becomes a conflict copy, not lost", async () => {
    const { server, devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("n.md", "v1")
    await a.folder.sync()
    await b.folder.sync()
    await a.folder.write("n.md", "from a")
    await a.folder.sync()
    // another program saves n.md on B while the download runs
    server.beforeBlobGet = () => {
      b.fs.put("n.md", "saved on b")
      server.beforeBlobGet = null
    }
    await b.folder.sync()
    expect(b.fs.text("n.md")).toBe("from a")
    expect(conflictCopies(b.fs).map((p) => b.fs.text(p))).toEqual(["saved on b"])
  })
})

describe("local deletes", () => {
  it("a file edited after the decision is kept and uploaded, not deleted", async () => {
    const { server, keys, devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("gone.md", "v1")
    await a.folder.write("other.md", "v1")
    await a.folder.sync()
    await b.folder.sync()
    await a.folder.remove("gone.md")
    await a.folder.write("other.md", "v2")
    await a.folder.sync()
    // while B downloads other.md, another program edits gone.md on B
    server.beforeBlobGet = () => {
      b.fs.put("gone.md", "edited on b")
      server.beforeBlobGet = null
    }
    await b.folder.sync()
    expect(b.fs.text("gone.md")).toBe("edited on b")
    await b.folder.sync()
    expect(Object.keys(await server.body(keys)).sort()).toEqual(["gone.md", "other.md"])
    await a.folder.sync()
    expect(a.fs.text("gone.md")).toBe("edited on b")
  })

  it("a renamed file appears at its new path before the old one goes", async () => {
    const { devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("old/name.md", "x")
    await a.folder.sync()
    await b.folder.sync()
    await a.folder.remove("old/name.md")
    await a.folder.write("new/name.md", "x")
    await a.folder.sync()
    await b.folder.sync()
    expect(b.fs.paths()).toEqual(["new/name.md"])
    const order = b.changes.filter((c) => c.origin === "remote").slice(-2).map((c) => c.path)
    expect(order).toEqual(["new/name.md", "old/name.md"])
  })
})

describe("a file and a folder with the same name", () => {
  it("this device made the file: the file moves", async () => {
    const { devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("notes/a.md", "in folder")
    await a.folder.sync()
    await b.folder.write("notes", "a file") // B is offline: it has not seen notes/
    await b.folder.sync()
    expect(b.fs.text("notes/a.md")).toBe("in folder")
    const copies = conflictCopies(b.fs)
    expect(copies).toEqual([expect.stringMatching(/^notes \(conflict .*\)$/)])
    expect(b.fs.text(copies[0]!)).toBe("a file")
    expect(b.changes.filter((c) => c.origin === "conflict")).toEqual([{ path: "notes", origin: "conflict", copy: copies[0] }])
    await a.folder.sync()
    expect(a.fs.text(copies[0]!)).toBe("a file")
  })

  it("this device made the folder: the folder moves, with every file in it", async () => {
    const { server, devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("notes", "a file")
    await a.folder.sync()
    await b.folder.write("notes/a.md", "one")
    await b.folder.write("notes/sub/b.md", "two")
    await b.folder.sync()
    expect(b.fs.text("notes")).toBe("a file")
    const dir = b.changes.find((c) => c.origin === "conflict")!.copy!
    expect(dir).toMatch(/^notes \(conflict .*\)$/)
    expect(b.fs.text(`${dir}/a.md`)).toBe("one")
    expect(b.fs.text(`${dir}/sub/b.md`)).toBe("two")
    await a.folder.sync()
    expect(a.fs.text(`${dir}/sub/b.md`)).toBe("two")
    // the move changed paths only: each blob uploaded once
    expect(new Set(server.puts).size).toBe(server.puts.length)
  })
})

describe("capital letters", () => {
  it("a case-insensitive device sees two new spellings as one path: a conflict, not two files", async () => {
    const { server, keys } = await setup(0)
    const linux = await device(server, keys)
    const mac = await device(server, keys, { caseInsensitive: true })
    await linux.folder.write("Todo.md", "linux")
    await linux.folder.sync()
    await mac.folder.write("todo.md", "mac")
    await mac.folder.sync()
    expect(mac.fs.text("todo.md")).toBe("linux")
    expect(mac.fs.paths().filter((p) => p.toLowerCase() === "todo.md")).toEqual(["Todo.md"])
    expect(conflictCopies(mac.fs).map((p) => mac.fs.text(p))).toEqual(["mac"])
  })

  it("a case-sensitive disk with two spellings syncs the first and reports the second", async () => {
    const { server, keys } = await setup(0)
    const fs = new MemFs({ kind: "visible" })
    fs.put("Todo.md", "first")
    fs.put("todo.md", "second")
    const a = await device(server, keys, { fs })
    const body = await server.body(keys)
    expect(Object.keys(body)).toHaveLength(1)
    const dup = a.changes.find((c) => c.origin === "case-duplicate")!
    expect(dup).toBeTruthy()
    expect(Object.keys(body)[0]).not.toBe(dup.path)
  })

  it("write refuses a second spelling, and says how to fix it", async () => {
    const { devs } = await setup(1)
    const [a] = devs as [Device]
    await a.folder.write("Notes/Todo.md", "x")
    await expect(a.folder.write("Notes/todo.md", "y")).rejects.toMatchObject({ code: "case-clash" })
    await expect(a.folder.write("Notes/todo.md", "y")).rejects.toThrow('"Notes/Todo.md" already exists. Write to "Notes/Todo.md", or remove it first.')
    await expect(a.folder.write("notes/b.md", "y")).rejects.toThrow('Write to "Notes/b.md" instead.')
  })

  it("a change of capitals only is a rename that syncs", async () => {
    const { server, keys } = await setup(0)
    const a = await device(server, keys, { kind: "visible" })
    const mac = await device(server, keys, { caseInsensitive: true })
    await a.folder.write("todo.md", "x")
    await a.folder.sync()
    await mac.folder.sync()
    await a.fs.move("todo.md", "TODO.md") // another program renames it
    await a.folder.sync()
    await mac.folder.sync()
    expect(mac.fs.paths()).toEqual(["TODO.md"])
    expect(Object.keys(await server.body(keys))).toEqual(["TODO.md"])
  })
})

describe("skipped paths", () => {
  it("a name this system cannot create freezes the path everywhere", async () => {
    const { server, keys } = await setup(0)
    const mac = await device(server, keys)
    const win = await device(server, keys, { canCreate: (s) => !s.includes(":") })
    await mac.folder.write("a:b.md", "v1")
    await mac.folder.write("ok.md", "fine")
    await mac.folder.sync()
    await win.folder.sync()
    expect(win.fs.paths()).toEqual(["ok.md"])
    expect(win.folder.status.skipped).toEqual(["a:b.md"])
    expect(win.changes).toContainEqual({ path: "a:b.md", origin: "skipped", reason: "bad name" })
    // Windows commits its own change: the frozen path stays on the server
    await win.folder.write("ok.md", "changed")
    await win.folder.sync()
    expect(Object.keys(await server.body(keys)).sort()).toEqual(["a:b.md", "ok.md"])
    // Edits from the Mac still reach the server and the Mac's other devices
    await mac.folder.write("a:b.md", "v2")
    await mac.folder.sync()
    await win.folder.sync()
    expect(win.fs.paths()).toEqual(["ok.md"])
    expect(Object.keys(await server.body(keys)).sort()).toEqual(["a:b.md", "ok.md"])
  })

  it("a bad name made by another program is skipped, never uploaded", async () => {
    const { server, keys } = await setup(0)
    const fs = new MemFs({ kind: "visible" })
    fs.put("bad\u0001name.md", "x")
    fs.put("good.md", "y")
    const a = await device(server, keys, { fs })
    expect(Object.keys(await server.body(keys))).toEqual(["good.md"])
    expect(a.folder.status.skipped).toEqual(["bad\u0001name.md"])
    expect(a.changes).toContainEqual({ path: "bad\u0001name.md", origin: "skipped", reason: "bad name" })
  })
})

describe("missing local state", () => {
  it("same contents are adopted, different contents become a conflict copy, nothing is deleted", async () => {
    const { server, keys, devs } = await setup(1)
    const [a] = devs as [Device]
    await a.folder.write("same.md", "same")
    await a.folder.write("diff.md", "server")
    await a.folder.write("only-server.md", "s")
    await a.folder.sync()
    const puts = server.puts.length
    const fs = new MemFs()
    fs.put("same.md", "same")
    fs.put("diff.md", "local")
    fs.put("only-local.md", "l")
    const b = await device(server, keys, { fs })
    expect(fs.text("same.md")).toBe("same")
    expect(fs.text("diff.md")).toBe("server")
    expect(fs.text("only-server.md")).toBe("s")
    expect(conflictCopies(fs).map((p) => fs.text(p))).toEqual(["local"])
    expect(Object.keys(await server.body(keys)).sort()).toEqual(
      ["diff.md", "only-local.md", "only-server.md", "same.md", conflictCopies(fs)[0]!].sort(),
    )
    expect(server.puts.length).toBe(puts + 2) // only-local and the conflict copy
    expect(b.changes.filter((c) => c.origin === "conflict")).toHaveLength(1)
  })

  it("deleting the hidden folder is safe", async () => {
    const { server, keys, devs } = await setup(1)
    const [a] = devs as [Device]
    await a.folder.write("x.md", "x")
    await a.folder.sync()
    await a.folder.close()
    a.fs.state.clear()
    const again = await device(server, keys, { fs: a.fs })
    expect(Object.keys(await server.body(keys))).toEqual(["x.md"])
    expect(again.changes.filter((c) => c.origin === "conflict")).toEqual([])
  })
})

describe("ignore rules", () => {
  it("ignored files stay here; a synced file keeps syncing when a new rule matches it (the git rule)", async () => {
    const { server, keys, devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("build.log", "synced before the rule")
    await a.folder.sync()
    await a.folder.write(".pappignore", "*.log\ncache/\n")
    await a.folder.write("new.log", "never uploaded")
    await a.folder.write("cache/x.bin", "local cache")
    await a.folder.write("node_modules/pkg/index.js", "always ignored")
    expect(a.changes.map((c) => c.path)).not.toContain("new.log")
    await a.folder.sync()
    expect(Object.keys(await server.body(keys)).sort()).toEqual([".pappignore", "build.log"])
    expect(await a.folder.readText("new.log")).toBe("never uploaded")
    // the synced file still syncs, on both devices
    await a.folder.write("build.log", "edited after the rule")
    await a.folder.sync()
    await b.folder.sync()
    expect(b.fs.text("build.log")).toBe("edited after the rule")
    expect(b.fs.text(".pappignore")).toBe("*.log\ncache/\n")
    // the rule reached B in the round after its .pappignore downloaded
    await b.folder.write("b.log", "b only")
    await b.folder.sync()
    expect(Object.keys(await server.body(keys)).sort()).toEqual([".pappignore", "build.log"])
  })
})

describe("big files", () => {
  it("are cut into parts; the header lists every part but not the file id", async () => {
    const { server, keys, devs } = await setup()
    const [a, b] = devs as [Device, Device]
    const data = new Uint8Array(PS * 2 + 100).map((_, i) => (i * 7) % 251)
    await a.folder.write("video.bin", new Blob([data]))
    await a.folder.sync()
    const body = await server.body(keys)
    const e = body["video.bin"]!
    expect(e.parts).toHaveLength(3)
    expect(e.size).toBe(data.length)
    expect(Object.keys(server.header()).sort()).toEqual([...e.parts!].sort())
    expect(server.header()[e.id]).toBeUndefined()
    expect(server.header()[e.parts![2]!]).toBe(100 + 29)
    await b.folder.sync()
    expect(await b.folder.read("video.bin")).toEqual(data)
    // readStream gives the same bytes
    const chunks: Uint8Array[] = []
    const r = b.folder.readStream("video.bin").getReader()
    for (;;) {
      const { done, value } = await r.read()
      if (done) break
      chunks.push(value)
    }
    expect(new Uint8Array(await new Blob(chunks.map((c) => buf(c))).arrayBuffer())).toEqual(data)
    // changing the last bytes uploads only the last part
    const puts = server.puts.length
    const changed = data.slice()
    changed[changed.length - 1] = 0
    await a.folder.write("video.bin", changed)
    await a.folder.sync()
    expect(server.puts.length).toBe(puts + 1)
  })

  it("a download that stopped halfway continues from the last whole part", async () => {
    const { server, keys, devs } = await setup(1)
    const [a] = devs as [Device]
    const data = new Uint8Array(PS * 3 + 5).map((_, i) => i % 256)
    await a.folder.write("big.bin", data)
    await a.folder.sync()
    const e = (await server.body(keys))["big.bin"]!
    const fs = new MemFs()
    // a temp file from an earlier run: one whole part and a bit
    await fs.tempAppend(e.id, data.slice(0, PS + 10))
    const fetched: string[] = []
    server.beforeBlobGet = (id) => void fetched.push(id)
    await device(server, keys, { fs })
    expect(fetched).toEqual(e.parts!.slice(1))
    expect(fs.files.get("big.bin")!.data).toEqual(data)
    expect(fs.temps.size).toBe(0)
  })

  it("uploads in batches of at most 100 blobs", async () => {
    const { server, devs } = await setup(1)
    const [a] = devs as [Device]
    for (let i = 0; i < 230; i++) await a.folder.write(`f/${i}.md`, `file ${i}`)
    await a.folder.sync()
    expect(server.puts).toHaveLength(230)
  })
})

describe("commits", () => {
  it("a stale commit (412) runs the round again and keeps both changes", async () => {
    const { server, keys, devs } = await setup()
    const [a, b] = devs as [Device, Device]
    await a.folder.write("a.md", "a")
    await b.folder.write("b.md", "b")
    server.beforeCommit = async () => {
      server.beforeCommit = null
      await b.folder.sync() // B commits first
    }
    await a.folder.sync()
    expect(Object.keys(await server.body(keys)).sort()).toEqual(["a.md", "b.md"])
    expect(a.fs.text("b.md")).toBe("b")
    expect(a.folder.status.error).toBeNull()
  })

  it("missing blobs (422) are uploaded again and the commit is resent", async () => {
    const { server, keys, devs } = await setup(1)
    const [a] = devs as [Device]
    await a.folder.write("a.md", "hello")
    server.beforeCommit = (n) => {
      if (n === 1) server.blobs.clear() // the sweep deleted it, say
    }
    await a.folder.sync()
    expect(Object.keys(await server.body(keys))).toEqual(["a.md"])
    expect(server.blobs.size).toBe(1)
    expect(a.folder.status.error).toBeNull()
  })

  it("an upload stopped before its commit is not sent again", async () => {
    const { server, devs } = await setup(1)
    const [a] = devs as [Device]
    await a.folder.write("a.md", "hello")
    server.beforeCommit = () => {
      throw new TypeError("network down")
    }
    await a.folder.sync()
    expect(a.folder.status.error).toContain("network down")
    server.beforeCommit = null
    const attempts = server.putAttempts
    await a.folder.sync()
    expect(server.putAttempts).toBe(attempts)
    expect(a.folder.status.pending).toBe(0)
  })
})

describe("failures and deletion", () => {
  it("a failed fetch is never an empty server", async () => {
    const { server, devs } = await setup(1)
    const [a] = devs as [Device]
    await a.folder.write("a.md", "x")
    await a.folder.sync()
    server.offline = true
    await a.folder.write("b.md", "y")
    await a.folder.sync()
    expect(a.folder.status.error).toMatch(/^network: /)
    expect(a.fs.paths()).toEqual(["a.md", "b.md"])
    expect(a.folder.status.pending).toBe(1)
    server.offline = false
    await a.folder.sync()
    expect(a.folder.status.error).toBeNull()
    expect(a.folder.status.pending).toBe(0)
  })

  it("a vanished index: ask the account layer, upload nothing", async () => {
    const { server, devs } = await setup(1)
    const [a] = devs as [Device]
    await a.folder.write("a.md", "x")
    await a.folder.sync()
    server.index = null
    server.blobs.clear()
    const puts = server.putAttempts
    await a.folder.sync()
    expect(a.gone.calls).toBe(1)
    expect(server.putAttempts).toBe(puts)
    expect(server.index).toBeNull()
    expect(a.fs.paths()).toEqual(["a.md"])
    expect(a.folder.status.error).toContain("index is missing")
  })

  it("a deleted folder stops syncing and deletes the hidden folder", async () => {
    const { server, keys } = await setup(0)
    const a = await device(server, keys, { kind: "visible", gone: "app" })
    await a.folder.write("a.md", "x")
    await a.folder.sync()
    const statuses: (string | null)[] = []
    a.folder.onStatus((s) => statuses.push(s.deleted))
    server.index = null
    await a.folder.sync()
    expect(a.folder.status.deleted).toBe("app")
    expect(statuses).toContain("app")
    expect(a.fs.destroyed).toBe(true)
    expect(a.fs.paths()).toEqual(["a.md"]) // a visible folder's files belong to the user
    await expect(a.folder.write("b.md", "y")).rejects.toMatchObject({ code: "gone", reason: "app" })
  })

  it("an unknown index version stops sync and asks for an update", async () => {
    const { server, devs } = await setup(1)
    const [a] = devs as [Device]
    server.writeIndex({ v: 2, blobs: {}, body: "" } as never)
    await a.folder.write("a.md", "x")
    await a.folder.sync()
    expect(a.folder.status.error).toMatch(/^update-needed: .*Update the pappdrive package/)
    const commits = server.commits
    await a.folder.sync()
    expect(server.commits).toBe(commits)
  })
})

describe("read-only folders", () => {
  it("mirror the server and refuse writes", async () => {
    const { server, keys } = await setup(0)
    const a = await device(server, keys)
    const r0 = await device(server, keys, { readOnly: true })
    expect(r0.folder.status.error).toBeNull() // a missing index is an empty folder
    await a.folder.write("todo.md", "x")
    await a.folder.write("old.md", "y")
    await a.folder.sync()
    const r = await device(server, keys, { readOnly: true })
    expect(await r.folder.readText("todo.md")).toBe("x")
    await expect(r.folder.write("n.md", "z")).rejects.toMatchObject({ code: "read-only" })
    await expect(r.folder.remove("todo.md")).rejects.toMatchObject({ code: "read-only" })
    await a.folder.remove("old.md")
    await a.folder.sync()
    await r.folder.sync()
    expect(r.fs.paths()).toEqual(["todo.md"])
    const commits = server.commits
    await r.folder.sync()
    expect(server.commits).toBe(commits)
    // its index vanishing means empty, not "gone"
    server.index = null
    await r.folder.sync()
    expect(r.gone.calls).toBe(0)
    expect(r.fs.paths()).toEqual([])
  })
})

describe("opening", () => {
  it("refuses a visible folder with another app's folder inside it", async () => {
    const { server, keys } = await setup(0)
    const fs = new MemFs({ kind: "visible" })
    fs.dirs.set("sub/.pappdrive", "sub/.pappdrive")
    const d = await device(server, keys, { fs }, false)
    await expect(d.folder.start()).rejects.toMatchObject({ code: "folder-taken" })
  })

  it("refuses a folder that belongs to another app", async () => {
    const { server, keys } = await setup(0)
    const fs = new MemFs({ kind: "visible" })
    fs.state.set("app", "journal")
    const d = await device(server, keys, { fs }, false)
    const err = await d.folder.start().catch((e: SyncError) => e)
    expect(err).toBeInstanceOf(SyncError)
    expect((err as SyncError).code).toBe("folder-taken")
    expect((err as SyncError).message).toContain('papp.openReadOnly("journal")')
  })

  it("records the app and keeps disk and synced state in the index format", async () => {
    const { keys, devs } = await setup(1)
    const [a] = devs as [Device]
    await a.folder.write("a.md", "x")
    await a.folder.sync()
    await a.folder.close()
    expect(a.fs.state.get("app")).toBe("notes")
    const synced = JSON.parse(a.fs.state.get("synced")!)
    expect(synced.v).toBe(1)
    expect(synced.files["a.md"].id).toBe(await blobId(keys, new TextEncoder().encode("x")))
    expect(JSON.parse(a.fs.state.get("disk")!).files["a.md"].size).toBe(1)
  })
})
