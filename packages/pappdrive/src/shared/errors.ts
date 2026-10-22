import type { GoneReason } from '@pappdrive/protocol';

export type SyncErrorCode =
  | 'bad-path'
  | 'case-clash'
  | 'not-found'
  | 'changed'
  | 'read-only'
  | 'not-allowed'
  | 'unverified'
  | 'over-quota'
  | 'signed-out'
  | 'folder-taken'
  | 'no-app'
  | 'credentials'
  | 'exists'
  | 'weak-password'
  | 'rate-limited'
  | 'gone'
  | 'network'
  | 'server'
  | 'update-needed';

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly retryAfter?: number;
  readonly reason?: GoneReason;

  constructor(code: SyncErrorCode, message: string, extra: { retryAfter?: number; reason?: GoneReason } = {}) {
    super(`${code}: ${message}`);
    this.name = 'SyncError';
    this.code = code;
    this.retryAfter = extra.retryAfter;
    this.reason = extra.reason;
  }
}
