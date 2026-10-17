// A small client for the /v1/ routes the CLI needs, including the ones the Papp SDK does not expose
// (apps, deletion, sign-in without an app). See spec 12-implementation.md, API.
import { API_PREFIX, type ErrorBody, normalizeEmail } from "@pappdrive/protocol"
import type {
  AppInfo,
  DownloadLink,
  IndexLinkResponse,
  LoginRequest,
  LoginResponse,
  ParamsResponse,
  RecoverRequest,
  RecoverResponse,
  SignupRequest,
  TokenResponse,
  RefreshResponse,
  DeleteAppRequest,
  DeleteAccountRequest,
} from "@pappdrive/protocol"
import { toBase64 } from "../../pappdrive/src/core/bytes.js"
import { deriveFromPassword, deriveFromRecovery, parseRecoveryCode, unlockDataKey } from "../../pappdrive/src/core/crypto.js"
import { ApiError } from "../../pappdrive/src/core/errors.js"

export type Fetch = typeof fetch

function retryAfter(res: Response, body: Record<string, unknown>): number | undefined {
  const h = res.headers.get("Retry-After")
  const n = h !== null ? Number(h) : Number(body.retryAfter)
  return Number.isFinite(n) ? Math.max(0, Math.ceil(n)) : undefined
}

export class Client {
  readonly server: string
  private readonly base: string
  /** Used for storage (R2) links too, so one fetch serves the whole command. */
  readonly fetchFn: Fetch

  constructor(server: string, fetchFn: Fetch = fetch) {
    this.server = server
    this.base = server + API_PREFIX
    this.fetchFn = ((input, init) => fetchFn(input, init)) as Fetch // never called as a method of this
  }

  /** One call. 204 gives undefined. A failed answer throws ApiError; no answer throws ApiError(0, "network"). */
  async call<T>(method: string, route: string, opts: { body?: unknown; token?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {}
    if (opts.body !== undefined) headers["content-type"] = "application/json"
    if (opts.token) headers["authorization"] = `Bearer ${opts.token}`
    let res: Response
    try {
      res = await this.fetchFn(this.base + route, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      })
    } catch {
      throw new ApiError(0, "network")
    }
    if (!res.ok) {
      let body: Partial<ErrorBody> & Record<string, unknown> = {}
      try {
        body = (await res.json()) as typeof body
      } catch {
        // not JSON: a proxy or a crash
      }
      const extra: { missing?: string[]; reason?: "app" | "account"; retryAfter?: number } = {}
      if (body.missing) extra.missing = body.missing
      if (body.reason) extra.reason = body.reason
      const ra = retryAfter(res, body)
      if (ra !== undefined) extra.retryAfter = ra
      throw new ApiError(res.status, body.error ?? (res.status >= 500 ? "server" : "unknown"), extra)
    }
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  params(email: string): Promise<ParamsResponse> {
    return this.call("POST", "/auth/params", { body: { email: normalizeEmail(email) } })
  }

  /** Runs the slow password hash with the account's settings. */
  async passwordKeys(email: string, password: string) {
    return deriveFromPassword(email, password, await this.params(email))
  }

  signup(req: SignupRequest): Promise<TokenResponse> {
    return this.call("POST", "/auth/signup", { body: req })
  }

  /** Signs in without an app: the token can list and create apps, and read the folders on `read`. */
  async login(email: string, password: string, read: string[] = []): Promise<LoginResponse & { passwordKey: Uint8Array }> {
    const { loginKey, passwordKey } = await this.passwordKeys(email, password)
    const req: LoginRequest = { email: normalizeEmail(email), read, loginKey: toBase64(loginKey) }
    const res = await this.call<LoginResponse>("POST", "/auth/login", { body: req })
    return { ...res, passwordKey }
  }

  /** Signs in with the recovery code, without an app. Returns the opened data key too. */
  async recover(email: string, code: string, read: string[] = []): Promise<RecoverResponse & { dataKey: Uint8Array }> {
    const { recoveryLoginKey, recoveryKey } = await deriveFromRecovery(parseRecoveryCode(code))
    const req: RecoverRequest = { email: normalizeEmail(email), read, recoveryLoginKey: toBase64(recoveryLoginKey) }
    const res = await this.call<RecoverResponse>("POST", "/auth/recover", { body: req })
    return { ...res, dataKey: await unlockDataKey(res.recoveryCopy, recoveryKey) }
  }

  async refresh(refreshToken: string, read?: string[]): Promise<string> {
    const body: { refreshToken: string; read?: string[] } = { refreshToken }
    if (read) body.read = read
    return (await this.call<RefreshResponse>("POST", "/auth/refresh", { body })).accessToken
  }

  logout(token: string): Promise<void> {
    return this.call("POST", "/auth/logout", { token })
  }

  listApps(token: string): Promise<AppInfo[]> {
    return this.call("GET", "/apps", { token })
  }

  createApp(token: string, name: string): Promise<void> {
    return this.call("POST", "/apps", { token, body: { name } })
  }

  indexLink(token: string, app: string): Promise<IndexLinkResponse> {
    return this.call("GET", `/index/link?app=${encodeURIComponent(app)}`, { token })
  }

  downloadLinks(token: string, app: string, ids: string[]): Promise<DownloadLink[]> {
    return this.call("POST", `/blobs/download?app=${encodeURIComponent(app)}`, { token, body: ids })
  }

  deleteApp(req: DeleteAppRequest): Promise<void> {
    return this.call("POST", "/app/delete", { body: req })
  }

  deleteAccount(req: DeleteAccountRequest): Promise<void> {
    return this.call("POST", "/account/delete", { body: req })
  }
}
