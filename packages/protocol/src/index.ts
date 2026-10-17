// Shared between the server and the library: limits, names, formats and the
// shape of every /v1/ request and answer. See spec 12-implementation.md.

export const API_PREFIX = "/v1"

// Blobs
export const PART_SIZE = 16 * 1024 * 1024 // 16,777,216 bytes of plaintext per blob
export const BLOB_OVERHEAD = 29 // version byte + 12-byte nonce + 16-byte tag
export const MAX_BLOB_SIZE = PART_SIZE + BLOB_OVERHEAD // 16,777,245
export const MAX_IDS_PER_CALL = 100
export const ID_RE = /^[0-9a-f]{64}$/

// Apps
export const APP_NAME_RE = /^[a-z0-9-]{1,64}$/

// Passwords
export const MIN_PASSWORD_LENGTH = 12

// Argon2id, RFC 9106 second recommended option. m is in KiB.
export interface Argon2Params {
  m: number
  t: number
  p: number
}
export const DEFAULT_ARGON2: Argon2Params = { m: 65536, t: 3, p: 4 }
export const ARGON2_HASH_LENGTH = 32
export const SALT_PREFIX = "pappdrive|"

// Times
export const ACCESS_TOKEN_SECONDS = 3600
export const UPLOAD_LINK_SECONDS = 300
export const DOWNLOAD_LINK_SECONDS = 300
export const INDEX_LINK_SECONDS = 7 * 24 * 3600
export const KEPT_INDEX_MS = 3600_000
export const KEPT_INDEX_MIN = 5
export const SWEEP_GRACE_MS = 24 * 3600_000

// Index file, as stored in R2 at <user>/<app>/index
export interface IndexFile {
  v: 1
  blobs: Record<string, number> // blob id -> stored (encrypted) size
  body: string // base64 of nonce + AES-GCM(gzip(JSON(IndexBody)))
}
export interface IndexEntry {
  id: string // file id
  size: number // real size
  mtime: number // ms since epoch
  parts?: string[] // only for files over PART_SIZE
}
export type IndexBody = Record<string, IndexEntry>

// <user>/key, written and read by the server only
export interface KeyFile {
  passwordCopy: string // base64
  recoveryCopy: string // base64
}

// Errors: body is { error: ErrorWord, ...details }
export type ErrorWord =
  | "bad-request"
  | "credentials"
  | "expired"
  | "not-allowed"
  | "no-app"
  | "exists"
  | "gone"
  | "stale"
  | "too-big"
  | "missing"
  | "rate-limited"
export type GoneReason = "app" | "account"
export interface ErrorBody {
  error: ErrorWord
  reason?: GoneReason // with "gone"
  missing?: string[] // with "missing"
}
export const ERROR_STATUS: Record<ErrorWord, number> = {
  "bad-request": 400,
  credentials: 401,
  expired: 401,
  "not-allowed": 403,
  "no-app": 404,
  exists: 409,
  gone: 410,
  stale: 412,
  "too-big": 413,
  missing: 422,
  "rate-limited": 429,
}

// Access token claims (HS256 JWT)
export interface AccessClaims {
  sub: string // user id
  app: string // "" for a token without an app
  install: string
  read: string[]
  exp: number // seconds since epoch
}

// Routes (paths below API_PREFIX)
export interface ParamsRequest {
  email: string
}
export type ParamsResponse = Argon2Params

export interface SignupRequest {
  email: string
  app?: string
  read: string[]
  loginKey: string // base64
  recoveryLoginKey: string // base64
  passwordCopy: string // base64
  recoveryCopy: string // base64
}
export interface TokenResponse {
  accessToken: string
  refreshToken: string
  installId: string
}
export interface LoginRequest {
  email: string
  app?: string
  read: string[]
  loginKey: string
}
export interface LoginResponse extends TokenResponse {
  passwordCopy: string
}
export interface RecoverRequest {
  email: string
  app?: string
  read: string[]
  recoveryLoginKey: string
}
export interface RecoverResponse extends TokenResponse {
  recoveryCopy: string
}
export interface RefreshRequest {
  refreshToken: string
  read?: string[]
}
export interface RefreshResponse {
  accessToken: string
}
export interface PasswordRequest {
  loginKey: string
  passwordCopy: string
}

export interface AppInfo {
  name: string
  created: number // ms since epoch
}
export interface CreateAppRequest {
  name: string
}

export interface UploadItem {
  id: string
  size: number // encrypted size
  sha256: string // base64 of SHA-256 of the ciphertext
}
export interface UploadLink {
  id: string
  url: string
  headers: Record<string, string> // includes content-length; browsers set it themselves
}
export interface DownloadLink {
  id: string
  url: string
}
export interface IndexLinkResponse {
  url: string
  expires: number // ms since epoch
}
export interface HistoryItem {
  time: number // ms since epoch
  url: string
}
export interface CommitRequest {
  index: IndexFile
  etag: string | null // quoted, as R2 returns it in the ETag header
}
export interface CommitResponse {
  etag: string
}

export interface DeleteAppRequest {
  email: string
  app: string
  loginKey: string
}
export interface DeleteAccountRequest {
  email: string
  loginKey: string
}

// R2 keys
export const keys = {
  userKey: (user: string) => `${user}/key`,
  folderPrefix: (user: string, app: string) => `${user}/${app}/`,
  index: (user: string, app: string) => `${user}/${app}/index`,
  keptIndex: (user: string, app: string, time: number) =>
    `${user}/${app}/index.${String(time).padStart(13, "0")}`,
  blob: (user: string, app: string, id: string) => `${user}/${app}/${id}`,
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
