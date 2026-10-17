// One tab syncs. Spec 05-client.md: "In a browser one tab holds a lock and does the syncing."
// The lock is a Web Lock, held until close() or until the tab goes away; the browser then grants
// it to the next waiting tab. Messages between tabs go over a BroadcastChannel of the same name,
// which never delivers a message to its sender.
import type { Coordinator, CoordinatorMessage } from "../core/types.js"

/** The part of navigator.locks used here. Tests pass a fake. */
export interface LockManagerLike {
  request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<unknown>
}

export function browserCoordinator(name: string, locks: LockManagerLike = navigator.locks): Coordinator {
  const key = `pappdrive:${name}`
  const channel = new BroadcastChannel(key)
  const listeners = new Set<(msg: CoordinatorMessage) => void>()
  const abort = new AbortController()
  let leader = false
  let closed = false
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  let granted!: () => void
  const lead = new Promise<void>((r) => (granted = r))

  locks
    .request(key, { signal: abort.signal }, async () => {
      if (closed) return // granted just as close() ran
      leader = true
      granted()
      await held
    })
    .catch(() => {}) // AbortError: closed while waiting

  channel.onmessage = (e: MessageEvent<CoordinatorMessage>) => {
    for (const cb of listeners) cb(e.data)
  }

  return {
    /** Never resolves after close(). */
    waitForLead: () => lead,
    isLeader: () => leader,
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
