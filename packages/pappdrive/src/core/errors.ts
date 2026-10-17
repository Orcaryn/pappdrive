import type { GoneReason } from "@pappdrive/protocol"

// Every error the library throws. The app checks `code`, not the message.
// Messages say what to do next: they are often read by a coding agent.

export type SyncErrorCode =
  | "bad-path"
  | "case-clash"
  | "not-found"
  | "read-only"
  | "not-allowed"
  | "signed-out"
  | "folder-taken"
  | "no-app"
  | "credentials"
  | "exists"
  | "weak-password"
  | "rate-limited"
  | "gone"
  // Not in the spec table, but needed: network and server trouble, unknown index version.
  | "network"
  | "server"
  | "update-needed"

export class SyncError extends Error {
  readonly code: SyncErrorCode
  retryAfter?: number
  reason?: GoneReason

  constructor(code: SyncErrorCode, message: string, extra?: { retryAfter?: number; reason?: GoneReason }) {
    super(`${code}: ${message}`)
    this.name = "SyncError"
    this.code = code
    if (extra?.retryAfter !== undefined) this.retryAfter = extra.retryAfter
    if (extra?.reason !== undefined) this.reason = extra.reason
  }
}

/** A failed server call: the status and the error word from the body. */
export class ApiError extends Error {
  readonly status: number
  readonly error: string // ErrorWord, or "network" when no answer came
  readonly missing?: string[]
  readonly reason?: GoneReason
  readonly retryAfter?: number

  constructor(status: number, error: string, extra: { missing?: string[]; reason?: GoneReason; retryAfter?: number } = {}) {
    super(`server answered ${status} ${error}`)
    this.name = "ApiError"
    this.status = status
    this.error = error
    if (extra.missing) this.missing = extra.missing
    if (extra.reason) this.reason = extra.reason
    if (extra.retryAfter !== undefined) this.retryAfter = extra.retryAfter
  }
}
