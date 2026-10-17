// The decision table. Pure: no I/O. See spec 06-sync.md, The decision table.
// Every map is keyed by pathKey (NFC + lowercase), so `Todo.md` and `todo.md` are one path.
// A version is its file id plus the spelling of its last segment: a change of capitals only is a rename,
// and syncs like any change. Folder spellings are not compared (folders match without capitals).
import { baseName, pathKey } from "./paths.js"
import type { DiskRec, Rec } from "./state.js"

export type ActionKind =
  | "download" // the server's version comes here (or, same id, only its spelling)
  | "delete-here" // the server deleted it
  | "upload" // this device's version goes to the server
  | "delete-server" // this device deleted it
  | "conflict" // both changed, or both new, with different contents
  | "adopt" // both sides have the same contents: record it as synced
  | "forget" // deleted on both sides: remove from synced

export interface Decision {
  key: string
  action: ActionKind
  disk: DiskRec | undefined
  server: Rec | undefined
}

interface DecideInput {
  disk: Map<string, DiskRec>
  synced: Map<string, Rec>
  server: Map<string, Rec>
  /** Frozen paths (skipped ones included): nothing is uploaded, downloaded or deleted, synced is left as it was. */
  frozen: Set<string>
  readOnly: boolean
}

/** Same version: same file id and the same spelling of the last segment. */
export function sameVersion(a: Rec, b: Rec): boolean {
  return a.entry.id === b.entry.id && baseName(a.path) === baseName(b.path)
}

/** Every path that needs something done. Paths needing nothing are left out. */
export function decide(input: DecideInput): Decision[] {
  const { disk, synced, server, frozen, readOnly } = input
  const keys = new Set<string>([...disk.keys(), ...synced.keys(), ...server.keys()])
  const out: Decision[] = []
  for (const key of keys) {
    if (frozen.has(key)) continue
    const d = disk.get(key)
    const s = synced.get(key)
    const v = server.get(key)
    const action = readOnly ? decideReadOnly(d, s, v) : decideOne(d, s, v)
    if (action) out.push({ key, action, disk: d, server: v })
  }
  return out
}

function decideOne(d: DiskRec | undefined, s: Rec | undefined, v: Rec | undefined): ActionKind | null {
  if (s) {
    const dState = !d ? "deleted" : sameVersion(d, s) ? "unchanged" : "changed"
    const vState = !v ? "deleted" : sameVersion(v, s) ? "unchanged" : "changed"
    switch (`${dState}/${vState}`) {
      case "unchanged/unchanged":
        return null
      case "unchanged/changed":
        return "download"
      case "unchanged/deleted":
        return "delete-here"
      case "changed/unchanged":
        return "upload"
      case "changed/changed":
        return d!.entry.id === v!.entry.id ? "adopt" : "conflict"
      case "changed/deleted":
        return "upload" // the file comes back
      case "deleted/unchanged":
        return "delete-server"
      case "deleted/changed":
        return "download" // the file comes back
      default: // deleted/deleted
        return "forget"
    }
  }
  if (d && !v) return "upload"
  if (v && !d) return "download"
  if (d && v) return d.entry.id === v.entry.id ? "adopt" : "conflict"
  return null
}

/** A read-only folder only mirrors the server: download, or delete here. */
function decideReadOnly(d: DiskRec | undefined, s: Rec | undefined, v: Rec | undefined): ActionKind | null {
  if (v) {
    if (!d || d.entry.id !== v.entry.id) return "download"
    if (!s || !sameVersion(s, v) || baseName(d.path) !== baseName(v.path)) return "adopt"
    return null
  }
  if (d) return "delete-here"
  if (s) return "forget"
  return null
}

// ---------------- A file and a folder with the same name ----------------

export interface CommitPath {
  key: string
  path: string
  /** True when this device's changes put it there (upload), false when it comes from the server index. */
  local: boolean
}

interface Clash {
  /** The file whose name is also a folder. */
  file: CommitPath
  /** Paths inside the folder of the same name. */
  inside: CommitPath[]
  /** Which side moves: this device's. "file": the file becomes a conflict copy; "folder": the folder does. */
  move: "file" | "folder"
}

/**
 * Looks for a file and a folder with the same name in the paths this device will commit:
 * the server index plus its own changes. Capitals are ignored. The server's side keeps the name.
 * Clashes where both sides come from the server, or both from this device, are left alone.
 */
export function findClashes(paths: CommitPath[]): Clash[] {
  const byKey = new Map(paths.map((p) => [p.key, p]))
  const inside = new Map<string, CommitPath[]>() // dir key -> paths below it
  for (const p of paths) {
    const segs = p.key.split("/")
    for (let i = 1; i < segs.length; i++) {
      const dir = segs.slice(0, i).join("/")
      if (!byKey.has(dir)) continue
      let list = inside.get(dir)
      if (!list) inside.set(dir, (list = []))
      list.push(p)
    }
  }
  const out: Clash[] = []
  for (const [dir, list] of inside) {
    const file = byKey.get(dir)!
    if (file.local && list.every((p) => !p.local)) out.push({ file, inside: list, move: "file" })
    else if (!file.local && list.some((p) => p.local)) out.push({ file, inside: list.filter((p) => p.local), move: "folder" })
  }
  return out
}

/** All folder keys above the given paths. */
export function dirKeysOf(paths: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const p of paths) {
    const segs = pathKey(p).split("/")
    for (let i = 1; i < segs.length; i++) out.add(segs.slice(0, i).join("/"))
  }
  return out
}
