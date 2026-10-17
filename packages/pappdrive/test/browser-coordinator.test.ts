import { afterEach, describe, expect, it } from "vitest"
import { browserCoordinator, type LockManagerLike } from "../src/browser/coordinator.js"
import { capacitorKeyStore } from "../src/browser/capacitor.js"
import type { Coordinator, CoordinatorMessage } from "../src/core/types.js"

/** Exclusive locks, granted in request order, like navigator.locks. */
function fakeLocks(): LockManagerLike {
  const queues = new Map<string, { cb: () => Promise<void>; signal?: AbortSignal; done: (v: unknown) => void; fail: (e: unknown) => void }[]>()
  const held = new Set<string>()
  const pump = (name: string) => {
    if (held.has(name)) return
    const q = queues.get(name) ?? []
    const next = q.shift()
    if (!next) return
    held.add(name)
    next
      .cb()
      .then(next.done, next.fail)
      .finally(() => {
        held.delete(name)
        pump(name)
      })
  }
  return {
    request(name, options, cb) {
      return new Promise((done, fail) => {
        const item = { cb: () => cb({ name }), signal: options.signal, done, fail }
        options.signal?.addEventListener("abort", () => {
          const q = queues.get(name) ?? []
          const i = q.indexOf(item)
          if (i >= 0) {
            q.splice(i, 1)
            fail(new DOMException("aborted", "AbortError"))
          }
        })
        queues.set(name, [...(queues.get(name) ?? []), item])
        pump(name)
      })
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 20))
const open: Coordinator[] = []
afterEach(() => {
  for (const c of open.splice(0)) c.close()
})

describe("browser coordinator", () => {
  it("one tab leads; the next one leads when it closes", async () => {
    const locks = fakeLocks()
    const a = browserCoordinator("t1", { locks })
    const b = browserCoordinator("t1", { locks })
    open.push(a, b)
    await a.waitForLead()
    expect(a.isLeader()).toBe(true)
    let bLeads = false
    void b.waitForLead().then(() => (bLeads = true))
    await tick()
    expect(bLeads).toBe(false)
    expect(b.isLeader()).toBe(false)
    a.close()
    expect(a.isLeader()).toBe(false)
    await tick()
    expect(bLeads).toBe(true)
    expect(b.isLeader()).toBe(true)
  })

  it("a follower that closes while waiting never leads, and frees its place", async () => {
    const locks = fakeLocks()
    const a = browserCoordinator("t2", { locks })
    const b = browserCoordinator("t2", { locks })
    const c = browserCoordinator("t2", { locks })
    open.push(a, b, c)
    await a.waitForLead()
    b.close()
    a.close()
    await c.waitForLead()
    expect(c.isLeader()).toBe(true)
    expect(b.isLeader()).toBe(false)
  })

  it("messages go to the other tabs over BroadcastChannel, not back to the sender", async () => {
    const locks = fakeLocks()
    const a = browserCoordinator("t3", { locks })
    const b = browserCoordinator("t3", { locks })
    const other = browserCoordinator("t3-other", { locks })
    open.push(a, b, other)
    const gotA: CoordinatorMessage[] = []
    const gotB: CoordinatorMessage[] = []
    const gotOther: CoordinatorMessage[] = []
    a.onMessage((m) => gotA.push(m))
    const stopB = b.onMessage((m) => gotB.push(m))
    other.onMessage((m) => gotOther.push(m))
    b.post({ type: "local-change", paths: ["todo.md"] })
    a.post({ type: "change", change: { path: "todo.md", origin: "remote" } })
    await tick()
    expect(gotA).toEqual([{ type: "local-change", paths: ["todo.md"] }])
    expect(gotB).toEqual([{ type: "change", change: { path: "todo.md", origin: "remote" } }])
    expect(gotOther).toEqual([])
    stopB()
    a.post({ type: "local-change", paths: ["x"] })
    await tick()
    expect(gotB).toHaveLength(1)
  })

  it("without Web Locks, the tab leads at once", async () => {
    const a = browserCoordinator("t4", { locks: null })
    open.push(a)
    await a.waitForLead()
    expect(a.isLeader()).toBe(true)
  })
})

describe("capacitorKeyStore", () => {
  it("works with the getItem/setItem style (@aparajita/capacitor-secure-storage)", async () => {
    const m = new Map<string, string>()
    const ks = capacitorKeyStore({
      getItem: async (k) => m.get(k) ?? null,
      setItem: async (k, v) => void m.set(k, v),
      removeItem: async (k) => void m.delete(k),
    })
    expect(await ks.get("k")).toBeNull()
    await ks.set("k", "v")
    expect(await ks.get("k")).toBe("v")
    await ks.delete("k")
    expect(await ks.get("k")).toBeNull()
  })

  it("works with the options-object style that rejects on a missing key (capacitor-secure-storage-plugin)", async () => {
    const m = new Map<string, string>()
    const ks = capacitorKeyStore({
      get: async ({ key }) => {
        if (!m.has(key)) throw new Error("Item with given key does not exist")
        return { value: m.get(key)! }
      },
      set: async ({ key, value }) => (m.set(key, value), { value: true }),
      remove: async ({ key }) => {
        if (!m.delete(key)) throw new Error("Item with given key does not exist")
        return { value: true }
      },
    })
    expect(await ks.get("k")).toBeNull()
    await ks.set("k", "v")
    expect(await ks.get("k")).toBe("v")
    await ks.delete("k")
    await ks.delete("k")
    expect(await ks.get("k")).toBeNull()
  })
})
