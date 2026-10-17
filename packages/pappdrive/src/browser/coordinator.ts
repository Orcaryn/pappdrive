// One tab syncs. Spec 05-client.md: "In a browser one tab holds a lock and does the syncing."
// The lock is a Web Lock (Chrome 69, Firefox 96, Safari 15.4), held until close() or until the
// tab goes away; the browser then grants it to the next waiting tab. Messages between tabs go over a
// BroadcastChannel of the same name. A BroadcastChannel never delivers a message to its sender.
import type { Coordinator, CoordinatorMessage } from "../core/types.js"

export interface LockManagerLike {
  request(name: string, options: { signal?: AbortSignal }, callback: (lock: unknown) => Promise<void>): Promise<unknown>
}

export interface ChannelLike {
  postMessage(msg: unknown): void
  onmessage: ((e: MessageEvent) => void) | null
  close(): void
}

export interface CoordinatorDeps {
  /** Default: navigator.locks. Null (no Web Locks, e.g. an insecure page): this tab leads at once. */
  locks?: LockManagerLike | null
  /** Default: new BroadcastChannel(name). */
  channel?: (name: string) => ChannelLike
}

const TYPES = new Set(["local-change", "change", "status"])

export function browserCoordinator(name: string, deps: CoordinatorDeps = {}): Coordinator {
  const key = `pappdrive:${name}`
  const locks =
    deps.locks !== undefined ? deps.locks : typeof navigator !== "undefined" && navigator.locks ? (navigator.locks as unknown as LockManagerLike) : null
  const channel = (deps.channel ?? ((n: string) => new BroadcastChannel(n) as unknown as ChannelLike))(key)

  let leader = false
  let closed = false
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  let granted!: () => void
  const lead = new Promise<void>((r) => (granted = r))
  const abort = new AbortController()
  const listeners = new Set<(msg: CoordinatorMessage) => void>()

  if (!locks) {
    leader = true
    granted()
  } else {
    locks
      .request(key, { signal: abort.signal }, async () => {
        if (closed) return
        leader = true
        granted()
        await held
      })
      .catch(() => {}) // AbortError after close() while waiting
  }

  channel.onmessage = (e: MessageEvent) => {
    if (closed) return
    const msg = e.data as CoordinatorMessage
    if (!msg || typeof msg !== "object" || !TYPES.has((msg as { type: string }).type)) return
    for (const cb of [...listeners]) {
      try {
        cb(msg)
      } catch (err) {
        console.error("pappdrive: a coordinator listener threw", err)
      }
    }
  }

  return {
    /** Never resolves after close(). */
    waitForLead: () => lead,
    isLeader: () => leader && !closed,
    post(msg) {
      if (!closed) channel.postMessage(msg)
    },
    onMessage(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    close() {
      if (closed) return
      closed = true
      leader = false
      listeners.clear()
      abort.abort()
      release()
      channel.close()
    },
  }
}
