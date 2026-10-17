// A small fetch client for `${server}/v1/...`. JSON in and out.
// Holds the access token in memory and refreshes it when it expires.
// See spec 12-implementation.md, API and Tokens, and 04-server.md.
import {
  API_PREFIX,
  type AccessClaims,
  type CommitRequest,
  type CommitResponse,
  type DownloadLink,
  type ErrorBody,
  type GoneReason,
  type HistoryItem,
  type IndexFile,
  type IndexLinkResponse,
  type RefreshRequest,
  type RefreshResponse,
  type UploadItem,
  type UploadLink,
} from "@pappdrive/protocol"
import { fromUtf8 } from "./bytes.js"
import { ApiError, SyncError } from "./errors.js"
import type { FolderApi } from "./types.js"

/** Refresh this many seconds before the access token's exp, so a call never races the expiry. */
const REFRESH_MARGIN_SECONDS = 60

export interface ApiHooks {
  /** The read list sent on each refresh (opts.read). */
  read(): string[]
  /** The server answered 410 gone: run the gone flow. Must not wait for folders to stop. */
  onGone(reason: GoneReason): Promise<void>
  /** The refresh token no longer works (401): sign out locally. */
  onSignedOut(): Promise<void>
}

/** Decodes a JWT payload without checking the signature. The server checks it. */
export function decodeJwt(token: string): AccessClaims {
  const part = token.split(".")[1]
  if (!part) throw new SyncError("server", "The server sent an access token that is not a JWT.")
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4)
  const s = atob(b64)
  const bytes = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return JSON.parse(fromUtf8.decode(bytes)) as AccessClaims
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined
  const n = Number(header)
  if (Number.isFinite(n)) return Math.max(0, Math.ceil(n))
  const date = Date.parse(header)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

export class Api {
  readonly base: string
  private accessToken: string | null = null
  private accessExp = 0 // seconds since epoch
  private refreshToken: string | null = null
  private refreshing: Promise<void> | null = null

  constructor(
    server: string,
    private readonly hooks: ApiHooks,
  ) {
    this.base = server.replace(/\/+$/, "") + API_PREFIX
  }

  get hasSession(): boolean {
    return this.refreshToken !== null
  }

  setSession(refreshToken: string, accessToken?: string): void {
    this.refreshToken = refreshToken
    if (accessToken) this.setAccess(accessToken)
    else {
      this.accessToken = null
      this.accessExp = 0
    }
  }

  clear(): void {
    this.refreshToken = null
    this.accessToken = null
    this.accessExp = 0
    this.refreshing = null
  }

  private setAccess(token: string): void {
    this.accessToken = token
    try {
      this.accessExp = decodeJwt(token).exp
    } catch {
      this.accessExp = 0
    }
  }

  /** One request. Throws ApiError on a failed answer, ApiError(0, "network") when no answer came. */
  async request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers["content-type"] = "application/json"
    if (token) headers["authorization"] = `Bearer ${token}`
    let res: Response
    try {
      res = await fetch(this.base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, "network")
    }
    if (!res.ok) {
      let err: Partial<ErrorBody> = {}
      try {
        err = (await res.json()) as ErrorBody
      } catch {
        // not JSON: a proxy or a crash
      }
      const extra: { missing?: string[]; reason?: GoneReason; retryAfter?: number } = {}
      if (err.missing) extra.missing = err.missing
      if (err.reason) extra.reason = err.reason
      const ra = retryAfterSeconds(res.headers.get("retry-after"))
      if (ra !== undefined) extra.retryAfter = ra
      throw new ApiError(res.status, typeof err.error === "string" ? err.error : "server", extra)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /** Gets a new access token. Shared by concurrent callers. 410 runs the gone flow, 401 signs out. */
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null
      })
    }
    return this.refreshing
  }

  private async doRefresh(): Promise<void> {
    const refreshToken = this.refreshToken
    if (!refreshToken) throw signedOut()
    const req: RefreshRequest = { refreshToken, read: this.hooks.read() }
    try {
      const res = await this.request<RefreshResponse>("POST", "/auth/refresh", req)
      if (this.refreshToken === refreshToken) this.setAccess(res.accessToken)
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        const reason = e.reason ?? "app"
        await this.hooks.onGone(reason)
        throw goneError(reason)
      }
      if (e instanceof ApiError && e.status === 401) {
        await this.hooks.onSignedOut()
        throw signedOut("This device was signed out on the server.")
      }
      throw e
    }
  }

  private fresh(): boolean {
    return this.accessToken !== null && this.accessExp - REFRESH_MARGIN_SECONDS > Date.now() / 1000
  }

  /** A call with the access token. Refreshes first if needed, and once more on 401 expired. */
  async authed<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.refreshToken) throw signedOut()
    if (!this.fresh()) await this.refresh()
    try {
      return await this.request<T>(method, path, body, this.accessToken!)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && e.error === "expired") {
        await this.refresh()
        return this.authedOnce<T>(method, path, body)
      }
      return this.handleGone(e)
    }
  }

  private async authedOnce<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      return await this.request<T>(method, path, body, this.accessToken!)
    } catch (e) {
      return this.handleGone(e)
    }
  }

  private async handleGone(e: unknown): Promise<never> {
    if (e instanceof ApiError && e.status === 410) {
      const reason = e.reason ?? "app"
      await this.hooks.onGone(reason)
      throw goneError(reason)
    }
    throw e
  }

  /** Server calls for one folder: the app's own, or another app's, read-only. */
  folderApi(app: string, readOnly: boolean): FolderApi {
    const q = readOnly ? `?app=${encodeURIComponent(app)}` : ""
    const refuse = async (what: string): Promise<never> => {
      throw new SyncError("read-only", `"${app}" is open read-only. ${what} works only on papp.files, the app's own folder.`)
    }
    return {
      indexLink: () => this.authed<IndexLinkResponse>("GET", `/index/link${q}`),
      downloadLinks: (ids: string[]) => this.authed<DownloadLink[]>("POST", `/blobs/download${q}`, ids),
      uploadLinks: (items: UploadItem[]) =>
        readOnly ? refuse("Uploading") : this.authed<UploadLink[]>("POST", "/blobs/upload", items),
      commit: (index: IndexFile, etag: string | null) =>
        readOnly ? refuse("Committing") : this.authed<CommitResponse>("PUT", "/index", { index, etag } satisfies CommitRequest),
      history: () => (readOnly ? refuse("History") : this.authed<HistoryItem[]>("GET", "/index/history")),
    }
  }
}

export function goneError(reason: GoneReason): SyncError {
  const what =
    reason === "account"
      ? "The account was deleted. This device is signed out and its copy of the key is deleted."
      : "This app's folder was deleted. This device is signed out of the app."
  return new SyncError("gone", `${what} Sign up or sign in again to start a new, empty folder.`, { reason })
}

export function signedOut(detail = "Not signed in."): SyncError {
  return new SyncError("signed-out", `${detail} Sign in first: await papp.signIn(email, password), or the sign-in form.`)
}
