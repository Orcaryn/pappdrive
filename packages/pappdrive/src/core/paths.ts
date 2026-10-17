// Path rules. See spec 05-client.md, Path rules, and 12-implementation.md, Path comparison.
import { utf8 } from "./bytes.js"
import { SyncError } from "./errors.js"

export const HIDDEN_DIR = ".pappdrive"
const MAX_SEGMENT_BYTES = 255
const MAX_PATH_BYTES = 1024
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** Why a path breaks the rules, or null if it is fine. Expects NFC. */
export function pathProblem(path: string): string | null {
  if (path === "") return "the path is empty"
  if (path.startsWith("/")) return "it starts with a slash. Paths are relative to the folder, like \"notes/todo.md\""
  if (path.includes("\\")) return "it contains a backslash. Use forward slashes"
  if (CONTROL.test(path)) return "it contains a control character"
  if (utf8.encode(path).length > MAX_PATH_BYTES) return `it is longer than ${MAX_PATH_BYTES} bytes`
  for (const seg of path.split("/")) {
    if (seg === "") return "it has an empty segment (\"//\" or a trailing slash)"
    if (seg === "." || seg === "..") return "it contains \".\" or \"..\""
    if (utf8.encode(seg).length > MAX_SEGMENT_BYTES) return `a segment is longer than ${MAX_SEGMENT_BYTES} bytes`
  }
  return null
}

/** NFC-normalizes and checks a path given by the app. Throws bad-path. */
export function checkPath(path: string): string {
  const p = path.normalize("NFC")
  const problem = pathProblem(p)
  if (problem) throw new SyncError("bad-path", `"${path}" is not a valid path: ${problem}.`)
  if (p.split("/")[0]!.toLowerCase() === HIDDEN_DIR) {
    throw new SyncError("bad-path", `"${path}" is inside the library's hidden folder ${HIDDEN_DIR}/. Use another path.`)
  }
  return p
}

/** Comparison key: NFC, then Unicode lowercase. The stored path keeps its spelling. */
export function pathKey(path: string): string {
  return path.normalize("NFC").toLowerCase()
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/")
  return i < 0 ? "" : path.slice(0, i)
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

/**
 * `todo.md` -> `todo (conflict 2026-10-17 09-15-30).md`; a counter is added when the name is taken.
 * A folder keeps its whole name: `notes.v2` -> `notes.v2 (conflict 2026-10-17 09-15-30)`.
 */
export function conflictName(path: string, when: Date, taken: (key: string) => boolean, isFolder = false): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ` +
    `${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`
  const dir = parentOf(path)
  const base = baseName(path)
  const dot = isFolder ? -1 : base.lastIndexOf(".")
  const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ""]
  for (let n = 1; ; n++) {
    const name = `${stem} (conflict ${stamp}${n > 1 ? ` ${n}` : ""})${ext}`
    const full = dir ? `${dir}/${name}` : name
    if (!taken(pathKey(full))) return full
  }
}
