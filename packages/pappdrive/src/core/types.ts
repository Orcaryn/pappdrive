// The contracts between the parts of the library:
//   - the public SDK surface (Papp, Files), spec 12-implementation.md, SDK
//   - what a platform adapter (node, browser) provides to the core
//   - what the account layer (papp.ts) provides to the sync engine (folder.ts)
import type { IndexFile, UploadItem, UploadLink, DownloadLink, IndexLinkResponse, HistoryItem, GoneReason } from "@pappdrive/protocol"
import type { DataKeys } from "./crypto.js"

// ===================== Public SDK =====================

export interface PappOptions {
  server: string // e.g. "https://sync.example.com", without /v1
  app: string
  read?: string[]
  keyStore?: KeyStore
}

export interface Papp {
  readonly ready: Promise<void>
  readonly signedIn: boolean
  readonly files: Files // throws signed-out style error before open()
  open(opts: { mode: "visible"; path: string } | { mode: "private" }): Promise<Files>
  openReadOnly(app: string): Promise<Files>
  signUp(email: string, password: string): Promise<{ recoveryCode: string }>
  signIn(email: string, password: string): Promise<void>
  recover(email: string, recoveryCode: string, newPassword: string): Promise<void>
  setPassword(newPassword: string): Promise<void>
  signOut(): Promise<void>
  deleteApp(password: string): Promise<void>
  deleteAccount(password: string): Promise<void>
  signInPrompt(): Promise<void> // terminal only; throws in a browser
  /** Syncs pending changes and stops all folders, so a command-line tool can exit. The sign-in stays saved. */
  close(): Promise<void>
}

export interface FileInfo {
  path: string
  size: number
  mtime: number
  dir: boolean
}

export type WriteData = string | Uint8Array | Blob | ReadableStream<Uint8Array>

export interface Change {
  path: string
  origin: "local" | "remote" | "conflict" | "skipped" | "case-duplicate"
  copy?: string // conflict copy path, with origin "conflict"
  reason?: "bad name" // with origin "skipped"
}

export interface Status {
  syncing: boolean
  lastSync: number | null // ms since epoch of the last successful round
  pending: number // local changes not yet committed
  skipped: string[] // frozen paths
  deleted: GoneReason | null
  error?: string | null // last round's error message, if it failed (offline, server down)
}

export interface Files {
  readonly readOnly: boolean
  write(path: string, data: WriteData): Promise<void>
  read(path: string): Promise<Uint8Array>
  readText(path: string): Promise<string>
  readStream(path: string): ReadableStream<Uint8Array>
  list(dir?: string): Promise<FileInfo[]>
  remove(path: string): Promise<void>
  watch(cb: (change: Change) => void): () => void
  readonly status: Status
  onStatus(cb: (status: Status) => void): () => void
  sync(): Promise<void>
}

// ===================== Platform adapters =====================

/** Key storage. Values are strings (the library stores JSON). */
export interface KeyStore {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}

export interface FileStat {
  size: number
  mtime: number // ms
}

export interface DirEntry {
  name: string // as spelled on disk; the core NFC-normalizes
  dir: boolean
}

/**
 * One folder's storage: the files themselves, plus the hidden folder `.pappdrive/`
 * (state files and temp files). Paths are relative to the folder, forward slashes,
 * NFC (the adapter maps to the system's own form, e.g. NFD names on macOS are found by their NFC path).
 * Missing parent folders are created on write/move. All writes of state are atomic (temp + rename).
 */
export interface FsAdapter {
  readonly kind: "visible" | "private"
  /** Does the system treat Todo.md and todo.md as the same file? */
  readonly caseInsensitive: boolean
  /** Can this system create a file with this name segment? (Windows: no `a:b.md`.) */
  canCreate(segment: string): boolean

  stat(path: string): Promise<FileStat | null> // null when missing or a folder
  list(dir: string): Promise<DirEntry[]> // "" is the top folder; [] when missing. Includes .pappdrive
  read(path: string, offset: number, length: number): Promise<Uint8Array> // fewer bytes at the end
  /** Moves a temp file (see below) into place with one rename. Returns the new stat. */
  moveTempInto(temp: string, path: string): Promise<FileStat>
  /** Moves a file or a folder. Used for case-only renames (via a temp name) and folder conflicts. */
  move(from: string, to: string): Promise<void>
  remove(path: string): Promise<void> // a file; no error if missing
  /** Removes `dir` and its empty parents, stopping at the first non-empty one or the top. */
  removeEmptyDirs(dir: string): Promise<void>

  // Temp files in .pappdrive/tmp/, named by the caller (e.g. a file id).
  tempSize(temp: string): Promise<number | null>
  tempAppend(temp: string, data: Uint8Array): Promise<void>
  tempTruncate(temp: string, size: number): Promise<void>
  tempRemove(temp: string): Promise<void>
  tempList(): Promise<string[]>

  // State files in .pappdrive/ (disk, synced, uploaded, app). Atomic replace.
  loadState(name: string): Promise<string | null>
  saveState(name: string, data: string): Promise<void>

  /** Deletes the hidden folder; for a private store, everything. */
  destroy(): Promise<void>
}

/** Raw watcher events: hints only. The engine looks at each path itself. */
export interface Watcher {
  start(
    root: FsAdapter,
    skipGlobs: string[],
    onPaths: (paths: string[]) => void, // NFC, relative
    onDropped: () => void, // error or dropped events: do a full scan
  ): Promise<() => Promise<void>> // stop
}

/** Browser: one tab syncs. Others forward their writes to it and hear its changes. */
export interface Coordinator {
  /** Resolves once this tab holds the lock; it holds it until close. */
  waitForLead(): Promise<void>
  isLeader(): boolean
  post(msg: CoordinatorMessage): void
  onMessage(cb: (msg: CoordinatorMessage) => void): () => void
  close(): void
}
export type CoordinatorMessage =
  | { type: "local-change"; paths: string[] } // a follower wrote these paths
  | { type: "change"; change: Change } // the leader reports a change (so followers fire watch)
  | { type: "status"; status: Status }

export interface Platform {
  readonly name: "node" | "browser"
  defaultKeyStore(): KeyStore
  /** The app's own private store, or a read-only mirror of another app's folder (`readFor`). */
  openPrivate(userId: string, app: string, readFor?: string): Promise<FsAdapter>
  /** A visible folder. Throws folder-taken if a hidden folder is found above it. */
  openVisible(path: string): Promise<FsAdapter>
  watcher?: Watcher
  coordinator?(name: string): Coordinator
  /** Browser: navigator.storage.persist(). */
  persist?(): Promise<void>
  /** Calls cb when the app goes to the background or closes, so pending changes sync at once. */
  onBackground?(cb: () => void): () => void
  signInPrompt?(papp: Papp): Promise<void>
}

// ===================== Account layer -> sync engine =====================

/** Server calls for one folder. Implemented by the account layer; handles tokens and refresh. */
export interface FolderApi {
  /** Read link for the index; cached by the caller until it expires. */
  indexLink(): Promise<IndexLinkResponse>
  downloadLinks(ids: string[]): Promise<DownloadLink[]> // up to 100
  uploadLinks(items: UploadItem[]): Promise<UploadLink[]> // own folder only, up to 100
  /** Throws ApiError with error "stale" (412) or "missing" (422, .missing ids). */
  commit(index: IndexFile, etag: string | null): Promise<{ etag: string }>
  history(): Promise<HistoryItem[]>
}

export interface FolderContext {
  app: string // whose folder this is
  readOnly: boolean
  fs: FsAdapter
  keys: DataKeys
  api: FolderApi
  platform: Platform
  /**
   * The index vanished although synced is not empty. The account layer refreshes the token:
   * resolves "gone" (and then calls Folder.markDeleted itself) or "ok" (keep going, upload nothing this round).
   */
  checkGone(): Promise<"gone" | "ok">
}

/** What the engine gives back to the account layer. */
export interface Folder extends Files {
  /** Scans, starts the watcher (visible) and polling. Throws folder-taken. */
  start(): Promise<void>
  close(): Promise<void>
  /** Stops syncing, deletes the hidden folder (private: everything), sets status.deleted. */
  markDeleted(reason: GoneReason): Promise<void>
}
