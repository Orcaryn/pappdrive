// Folder watcher over @parcel/watcher. Events are hints: the engine looks at each path itself.
// See spec 05-client.md, Watching a visible folder, and 12-implementation.md, Node adapter.
import { realpath } from "node:fs/promises"
import { isAbsolute, relative, sep } from "node:path"
import type { Watcher } from "../core/types.js"
import type { NodeFs } from "./fs.js"

/** Without the native watcher, the folder is scanned this often instead (a scan hashes only what changed). */
const FALLBACK_SCAN_MS = 10_000

export const nodeWatcher: Watcher = {
  async start(fs, skipGlobs, onPaths, onDropped) {
    const parcel = await loadParcelWatcher()
    if (!parcel) {
      const timer = setInterval(onDropped, FALLBACK_SCAN_MS)
      timer.unref()
      return async () => clearInterval(timer)
    }
    // The system reports real paths (macOS: /var is /private/var), so map events from the real root.
    // The node platform only opens NodeFs folders.
    const root = await realpath((fs as NodeFs).root)
    let stopped = false
    const sub = await parcel.subscribe(
      root,
      (err, events) => {
        if (stopped) return
        if (err) {
          // An error, or events dropped (FSEvents "must scan subdirs", inotify overflow): scan everything.
          onDropped()
          return
        }
        const paths = new Set<string>()
        for (const ev of events) {
          const rel = toRelative(root, ev.path)
          if (rel !== null) paths.add(rel)
        }
        if (paths.size > 0) onPaths([...paths])
      },
      { ignore: skipGlobs },
    )
    return async () => {
      stopped = true
      await sub.unsubscribe()
    }
  },
}

let loading: Promise<typeof import("@parcel/watcher") | null> | undefined

/** Loads @parcel/watcher once. A missing or broken native module gives null, with one clear warning. */
export function loadParcelWatcher(): Promise<typeof import("@parcel/watcher") | null> {
  loading ??= import("@parcel/watcher").catch((e: unknown) => {
    console.warn(
      `pappdrive: the folder watcher (@parcel/watcher) could not load: ${(e as Error).message}. ` +
        `Edits made by other programs are found by a scan every ${FALLBACK_SCAN_MS / 1000} seconds instead. ` +
        `To fix it, reinstall dependencies on this machine (for example \`pnpm install\` or \`npm rebuild @parcel/watcher\`).`,
    )
    return null
  })
  return loading
}

/** Absolute event path -> relative NFC path with forward slashes, or null when outside the root. */
export function toRelative(root: string, abs: string): string | null {
  const rel = relative(root.normalize("NFC"), abs.normalize("NFC"))
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return null
  return rel.split(sep).join("/")
}
