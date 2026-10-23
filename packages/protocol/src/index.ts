export const API_PREFIX = '/v1';
export const WATCH_PROTOCOL = 'pappdrive';

export const PART_SIZE = 16 * 1024 * 1024;
const VERSION_BYTES = 1;
const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
export const BLOB_OVERHEAD = VERSION_BYTES + NONCE_BYTES + GCM_TAG_BYTES;
export const MAX_BLOB_SIZE = PART_SIZE + BLOB_OVERHEAD;
export const ID_RE = /^[0-9a-f]{64}$/;
export const APP_NAME_RE = /^[a-z0-9_-]{1,64}$/;
export const MIN_PASSWORD_LENGTH = 12;

export interface Argon2Params {
  m: number;
  t: number;
  p: number;
}
// RFC 9106's second recommended option; m is in KiB.
export const DEFAULT_ARGON2: Argon2Params = { m: 65536, t: 3, p: 4 };

export const SWEEP_GRACE_MS = 24 * 3600_000;
export const DELTA_MAX = 100;

export interface IndexFile {
  v: 1;
  blobs: Record<string, number>;
  body: string;
}
export interface DeltaFile {
  v: 1;
  base: string;
  blobs: Record<string, number>;
  body: string;
}
export interface IndexEntry {
  id: string;
  size: number;
  mtime: number;
  parts?: string[];
}
export type IndexBody = Record<string, IndexEntry>;
export type DeltaBody = Record<string, IndexEntry | null>;
export interface DeltaPayload {
  seq: number;
  ops: DeltaBody;
}

export function blobIdsOf(entry: IndexEntry): string[] {
  return entry.parts === undefined ? [entry.id] : entry.parts;
}

export type ErrorWord =
  'bad-request' | 'credentials' | 'expired' | 'not-allowed' | 'unverified' | 'no-app' | 'exists' | 'gone' | 'stale' | 'too-big' | 'missing' | 'rate-limited' | 'over-quota';
export type GoneReason = 'app' | 'account';
export interface ErrorBody {
  error: ErrorWord;
  reason?: GoneReason;
  missing?: string[];
}

// HS256 JWT claims; exp is seconds since epoch, per RFC 7519.
export interface AccessClaims {
  sub: string;
  app: string;
  install: string;
  read: string[];
  exp: number;
}

export type ParamsResponse = Argon2Params;

export interface SignupRequest {
  email: string;
  app?: string;
  read: string[];
  loginKey: string;
  recoveryLoginKey: string;
  passwordCopy: string;
  recoveryCopy: string;
}
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  installId: string;
}
export interface LoginRequest {
  email: string;
  app?: string;
  read: string[];
  loginKey: string;
}
export interface LoginResponse extends TokenResponse {
  passwordCopy: string;
}
export interface RecoverRequest {
  email: string;
  app?: string;
  read: string[];
  recoveryLoginKey: string;
}
export interface RecoverResponse extends TokenResponse {
  recoveryCopy: string;
}
export interface RefreshRequest {
  refreshToken: string;
  read?: string[];
}
export interface RefreshResponse {
  accessToken: string;
}
export interface PasswordRequest {
  loginKey: string;
  passwordCopy: string;
  params?: Argon2Params;
}

export interface VerifyRequest {
  code: string;
}

export interface AppInfo {
  name: string;
  created: number;
}

export interface DeltaCommitRequest {
  delta: DeltaFile;
  // quoted, as R2 returns it in the ETag header.
  etag: string;
}
export interface CheckpointRequest {
  index: IndexFile;
  delta: DeltaFile;
  etag: string | null;
}
export interface CommitResponse {
  etag: string;
}
export type CommitResult = { ok: true; etag: string } | { ok: false; error: 'stale' } | { ok: false; error: 'missing'; missing: string[] };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
