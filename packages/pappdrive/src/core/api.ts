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
import { fromBase64, fromUtf8 } from "./bytes.js"
import { ApiError, SyncError } from "./errors.js"
import type { FolderApi } from "./types.js"

/** Refresh this many seconds before the access token's exp, so a call never races the expiry. */
const REFRESH_MARGIN_SECONDS = 60

interface ApiHooks {
  /** The read list sent on each refresh (opts.read). */
  read(): string[]
  /** The server answered 410 gone: run the gone flow. Must not wait for folders to stop. */
  onGone(reason: GoneReason): Promise<void>
  /** The refresh token no longer works (401): sign out locally. */
  onSignedOut(): Promise<void>
}

/** Decodes a JWT payload without checking the signature. The server checks it. */
export function decodeJwt(token: string): AccessClaims {
  const payload = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")
  return JSON.parse(fromUtf8.decode(fromBase64(payload))) as AccessClaims
}

/** One request. Throws ApiError on a failed answer, ApiError(0, "network") when no answer came. */
export async function request<T>(server: string, method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers["content-type"] = "application/json"
  if (token) headers["authorization"] = `Bearer ${token}`
  const res = await fetch(server.replace(/\/+$/, "") + API_PREFIX + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }).catch(
    () => {
      throw new ApiError(0, "network")
    },
  )
  if (!res.ok) {
    // A body that is not JSON comes from a proxy or a crash.
    const err = (await res.json().catch(() => ({}))) as Partial<ErrorBody>
    const retryAfter = res.headers.get("retry-after")
    throw new ApiError(res.status, err.error ?? "server", {
      missing: err.missing,
      reason: err.reason,
      retryAfter: retryAfter ? Number(retryAfter) : undefined,
    })
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

export class Api {
  private accessToken: string | null = null
  private accessExp = 0 // seconds since epoch
  private refreshToken: string | null = null
  private refreshing: Promise<void> | null = null

  constructor(
    private readonly server: string,
    private readonly hooks: ApiHooks,
  ) {}

  setSession(refreshToken: string, accessToken?: string): void {
    this.refreshToken = refreshToken
    this.setAccess(accessToken ?? null)
  }

  clear(): void {
    this.refreshToken = null
    this.setAccess(null)
    this.refreshing = null
  }

  private setAccess(token: string | null): void {
    this.accessToken = token
    this.accessExp = token ? decodeJwt(token).exp : 0
  }

  /** Gets a new access token. Shared by concurrent callers. 410 runs the gone flow, 401 signs out. */
  refresh(): Promise<void> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<void> {
    const refreshToken = this.refreshToken
    if (!refreshToken) throw signedOut()
    const req: RefreshRequest = { refreshToken, read: this.hooks.read() }
    try {
      const res = await request<RefreshResponse>(this.server, "POST", "/auth/refresh", req)
      // A sign-out or a new sign-in during the call replaced the session: keep the new one.
      if (this.refreshToken === refreshToken) this.setAccess(res.accessToken)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await this.hooks.onSignedOut()
        throw signedOut("This device was signed out on the server.")
      }
      return this.onGone(e)
    }
  }

  /** A call with the access token. Refreshes first if needed, and once more on 401 expired. */
  async authed<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (this.accessExp - REFRESH_MARGIN_SECONDS < Date.now() / 1000) await this.refresh()
    try {
      return await request<T>(this.server, method, path, body, this.accessToken!)
    } catch (e) {
      if (!(e instanceof ApiError && e.error === "expired")) return this.onGone(e)
      await this.refresh()
      return request<T>(this.server, method, path, body, this.accessToken!).catch((e2: unknown) => this.onGone(e2))
    }
  }

  /** Rethrows `e`. A 410 first runs the gone flow and becomes the gone SyncError. */
  private async onGone(e: unknown): Promise<never> {
    if (e instanceof ApiError && e.status === 410) {
      await this.hooks.onGone(e.reason!)
      throw goneError(e.reason!)
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
