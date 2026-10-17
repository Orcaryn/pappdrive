import { describe, expect, it } from "vitest"
import { decide, findClashes, type ActionKind } from "../src/core/decide.js"
import { pathKey } from "../src/core/paths.js"
import type { DiskRec, Rec } from "../src/core/state.js"

const ID = (c: string) => c.repeat(64)
const rec = (path: string, id: string): Rec => ({ path, entry: { id, size: 1, mtime: 1 } })
const map = (...recs: (Rec | undefined)[]) => new Map(recs.filter((r): r is Rec => !!r).map((r) => [pathKey(r.path), r as DiskRec]))

function one(d?: Rec, s?: Rec, v?: Rec, readOnly = false, frozen: string[] = []): ActionKind | null {
  const out = decide({ disk: map(d), synced: map(s), server: map(v), frozen: new Set(frozen), readOnly })
  expect(out.length).toBeLessThanOrEqual(1)
  return out[0]?.action ?? null
}

describe("decision table", () => {
  const A = ID("a")
  const B = ID("b")
  const C = ID("c")
  const p = "notes/todo.md"

  it("path in synced: the nine cases", () => {
    // disk unchanged
    expect(one(rec(p, A), rec(p, A), rec(p, A))).toBe(null)
    expect(one(rec(p, A), rec(p, A), rec(p, B))).toBe("download")
    expect(one(rec(p, A), rec(p, A), undefined)).toBe("delete-here")
    // disk changed
    expect(one(rec(p, B), rec(p, A), rec(p, A))).toBe("upload")
    expect(one(rec(p, B), rec(p, A), rec(p, B))).toBe("adopt") // same content: nothing
    expect(one(rec(p, B), rec(p, A), rec(p, C))).toBe("conflict")
    expect(one(rec(p, B), rec(p, A), undefined)).toBe("upload") // edit beats delete
    // disk deleted
    expect(one(undefined, rec(p, A), rec(p, A))).toBe("delete-server")
    expect(one(undefined, rec(p, A), rec(p, B))).toBe("download") // the file comes back
    expect(one(undefined, rec(p, A), undefined)).toBe("forget")
  })

  it("path not in synced: the three cases", () => {
    expect(one(rec(p, A), undefined, undefined)).toBe("upload")
    expect(one(undefined, undefined, rec(p, A))).toBe("download")
    expect(one(rec(p, A), undefined, rec(p, A))).toBe("adopt")
    expect(one(rec(p, A), undefined, rec(p, B))).toBe("conflict")
  })

  it("matches paths without capitals, and a change of capitals is a rename", () => {
    expect(one(rec("Notes/Todo.md", A), undefined, rec("notes/todo.md", A))).toBe("adopt")
    expect(one(rec("Notes/Todo.md", A), undefined, rec("notes/todo.md", B))).toBe("conflict")
    // only the capitals of the name changed here: upload the rename
    expect(one(rec("notes/Todo.md", A), rec("notes/todo.md", A), rec("notes/todo.md", A))).toBe("upload")
    // folder capitals alone are not a change
    expect(one(rec("Notes/todo.md", A), rec("notes/todo.md", A), rec("notes/todo.md", A))).toBe(null)
    // renamed on the server
    expect(one(rec("notes/todo.md", A), rec("notes/todo.md", A), rec("notes/TODO.md", A))).toBe("download")
  })

  it("frozen paths get no action at all", () => {
    expect(one(rec(p, B), rec(p, A), rec(p, C), false, [pathKey(p)])).toBe(null)
    expect(one(undefined, rec(p, A), rec(p, A), false, [pathKey(p)])).toBe(null)
  })

  it("read-only folders only download or delete here", () => {
    expect(one(undefined, undefined, rec(p, A), true)).toBe("download")
    expect(one(rec(p, B), rec(p, A), rec(p, A), true)).toBe("download")
    expect(one(rec(p, A), rec(p, A), undefined, true)).toBe("delete-here")
    expect(one(rec(p, A), undefined, rec(p, A), true)).toBe("adopt")
    expect(one(rec(p, A), rec(p, A), rec(p, A), true)).toBe(null)
    expect(one(undefined, rec(p, A), undefined, true)).toBe("forget")
  })
})

describe("file and folder with the same name", () => {
  it("this device made the file: the file moves", () => {
    const c = findClashes([
      { key: "notes", path: "notes", local: true },
      { key: "notes/a.md", path: "notes/a.md", local: false },
    ])
    expect(c).toHaveLength(1)
    expect(c[0]!.move).toBe("file")
  })
  it("this device made the folder: the folder moves", () => {
    const c = findClashes([
      { key: "notes", path: "Notes", local: false },
      { key: "notes/a.md", path: "notes/a.md", local: true },
    ])
    expect(c).toHaveLength(1)
    expect(c[0]!.move).toBe("folder")
    expect(c[0]!.inside.map((x) => x.path)).toEqual(["notes/a.md"])
  })
  it("no clash without a shared name", () => {
    expect(findClashes([{ key: "notes.md", path: "notes.md", local: true }, { key: "notes/a.md", path: "notes/a.md", local: false }])).toEqual([])
  })
})
