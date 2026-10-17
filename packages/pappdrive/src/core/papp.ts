// The account layer: sign-up, sign-in, recovery, tokens, opening folders, deletion.
// See spec 07-encryption.md, 04-server.md and 12-implementation.md, SDK.
import {
  APP_NAME_RE,
  DEFAULT_ARGON2,
  type GoneReason,
  type LoginRequest,
  type LoginResponse,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  type ParamsResponse,
  type PasswordRequest,
  type RecoverRequest,
  type RecoverResponse,
  type SignupRequest,
  type TokenResponse,
} from "@pappdrive/protocol"
import { Api, decodeJwt, goneError, signedOut } from "./api.js"
import { fromBase64, toBase64 } from "./bytes.js"
import {
  type DataKeys,
  dataKeys,
  deriveFromPassword,
  deriveFromRecovery,
  formatRecoveryCode,
  lockDataKey,
  newDataKey,
  newRecoveryCode,
  parseRecoveryCode,
  unlockDataKey,
} from "./crypto.js"
import { ApiError, SyncError } from "./errors.js"
import { openFolder } from "./folder.js"
import type { Files, Folder, FolderContext, FsAdapter, KeyStore, Papp, PappOptions, Platform } from "./types.js"

/** What the key store holds for one server and app. Never inside the app folder. */
interface StoredSession {
  email: string
  userId: string
  installId: string
  refreshToken: string
  dataKey: string // base64
}

/** The command that creates an app. The CLI binary is `pappdrive`, from the package `pappdrive-cli`. */
export function createAppCommand(app: string): string {
  return `npx pappdrive-cli apps create ${app}`
}

export function sessionName(server: string, app: string): string {
  return `pappdrive:${server.replace(/\/+$/, "")}:${app}`
}

function checkPassword(password: string): void {
  if ([...password.normalize("NFC")].length < MIN_PASSWORD_LENGTH) {
    throw new SyncError(
      "weak-password",
      `The password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters; a few random words work well.`,
    )
  }
}

export function createPappCore(opts: PappOptions, platform: Platform): Papp {
  return new PappCore(opts, platform)
}

type Kind = "signup" | "signin" | "recover" | "delete" | "password"

class PappCore implements Papp {
  readonly ready: Promise<void>
  private readonly app: string
  private readonly read: string[]
  private readonly keyStore: KeyStore
  private readonly name: string
  private readonly api: Api
  private session: StoredSession | null = null
  private keys: Promise<DataKeys> | null = null
  private own: Folder | null = null
  private ownOpening: Promise<Files> | null = null
  private readonly readers = new Map<string, Promise<Folder>>() // opening or open, by app name
  private readonly readerFolders = new Map<string, Folder>() // open
  private readonly marked = new WeakSet<Folder>()

  constructor(
    opts: PappOptions,
    private readonly platform: Platform,
  ) {
    const bad = [opts.app, ...(opts.read ?? [])].find((n) => typeof n !== "string" || !APP_NAME_RE.test(n))
    if (bad !== undefined) {
      throw new SyncError(
        "no-app",
        `"${bad}" is not a valid app name. App names are lowercase letters, digits and -, 1 to 64 characters.`,
      )
    }
    this.app = opts.app
    this.read = [...(opts.read ?? [])]
    this.keyStore = opts.keyStore ?? platform.defaultKeyStore()
    this.name = sessionName(opts.server, opts.app)
    this.api = new Api(opts.server, {
      read: () => this.read,
      onGone: (reason) => this.gone(reason, false),
      onSignedOut: () => this.dropLocal(false),
    })
    this.ready = this.restore()
  }

  // ---------- Session ----------

  private async restore(): Promise<void> {
    const raw = await this.keyStore.get(this.name)
    if (!raw) return
    let s: StoredSession
    try {
      s = JSON.parse(raw) as StoredSession
      if (!s.refreshToken || !s.dataKey || !s.userId || !s.email) throw new Error("incomplete")
    } catch {
      await this.keyStore.delete(this.name)
      return
    }
    this.session = s
    this.api.setSession(s.refreshToken)
  }

  get signedIn(): boolean {
    return this.session !== null
  }

  private async save(email: string, res: TokenResponse, dataKey: Uint8Array): Promise<void> {
    const s: StoredSession = {
      email: normalizeEmail(email),
      userId: decodeJwt(res.accessToken).sub,
      installId: res.installId,
      refreshToken: res.refreshToken,
      dataKey: toBase64(dataKey),
    }
    await this.keyStore.set(this.name, JSON.stringify(s))
    this.session = s
    this.keys = null
    this.api.setSession(res.refreshToken, res.accessToken)
    try {
      await this.platform.persist?.()
    } catch {
      // The browser may say no. Nothing breaks.
    }
  }

  private dataKeys(): Promise<DataKeys> {
    if (!this.session) throw signedOut()
    this.keys ??= dataKeys(fromBase64(this.session.dataKey))
    return this.keys
  }

  private requireSession(): StoredSession {
    if (!this.session) throw signedOut()
    return this.session
  }

  /** Deletes the key store entry (refresh token and data key) and forgets the tokens. */
  private async clearSession(): Promise<void> {
    this.session = null
    this.keys = null
    this.api.clear()
    await this.keyStore.delete(this.name)
  }

  /** Signed out by the server (refresh answered 401). Stops folders; files stay. */
  private async dropLocal(wait: boolean): Promise<void> {
    const folders = this.openFolders()
    this.own = null
    this.ownOpening = null
    this.readers.clear()
    this.readerFolders.clear()
    await this.clearSession()
    const closing = Promise.allSettled(folders.map((f) => f.close()))
    if (wait) await closing
  }

  /**
   * The app's folder or the account was deleted. Stops every open folder and deletes its hidden
   * folder (private: everything), then signs out. Deleting the key store entry also deletes the
   * data key from this device. Never re-uploads.
   * `wait` is false when a folder's own server call got here: its round is still running, and
   * waiting for markDeleted, which stops that round, would never end.
   */
  private async gone(reason: GoneReason, wait: boolean): Promise<void> {
    const folders = this.openFolders().filter((f) => !this.marked.has(f))
    for (const f of folders) this.marked.add(f)
    this.ownOpening = null
    this.readers.clear()
    this.readerFolders.clear()
    await this.clearSession()
    const deleting = Promise.allSettled(folders.map((f) => f.markDeleted(reason)))
    if (wait) await deleting
    // this.own stays, so papp.files.status.deleted tells the app.
  }

  private openFolders(): Folder[] {
    const out: Folder[] = []
    if (this.own) out.push(this.own)
    out.push(...this.readerFolders.values())
    return out
  }

  // ---------- Server calls without a token ----------

  private async call<T>(path: string, body: unknown, kind: Kind): Promise<T> {
    try {
      return await this.api.request<T>("POST", path, body)
    } catch (e) {
      throw this.mapError(e, kind)
    }
  }

  private mapError(e: unknown, kind: Kind): unknown {
    if (!(e instanceof ApiError)) return e
    switch (e.error) {
      case "network":
        return new SyncError("network", `Could not reach the server at ${this.api.base}. Check the connection and try again.`)
      case "credentials":
        return new SyncError(
          "credentials",
          kind === "recover"
            ? "Wrong email or recovery code. Check both against the saved copy."
            : "Wrong email or password. Try again, or use the recovery code to set a new password.",
        )
      case "exists":
        return new SyncError(
          "exists",
          "An account with this email already exists. Sign in instead, or recover with the recovery code if the password is lost.",
        )
      case "no-app": {
        const others = this.read.length ? ` or one of the read folders (${this.read.join(", ")})` : ""
        return new SyncError(
          "no-app",
          `The app "${this.app}"${others} does not exist in this account. Create it first with the command-line tool: ` +
            `${createAppCommand(this.app)} (installed: pappdrive apps create ${this.app}). Then sign in again.`,
        )
      }
      case "rate-limited": {
        const wait = e.retryAfter ?? 60
        return new SyncError("rate-limited", `Too many tries. Wait ${wait} seconds, then try again.`, { retryAfter: wait })
      }
      case "gone":
        return goneError(e.reason ?? "app")
      case "not-allowed":
        return new SyncError("not-allowed", "The server refused this request for this token.")
      case "expired":
        return signedOut("The session expired and could not be renewed.")
      default:
        return new SyncError("server", `The server answered ${e.status} ${e.error}. Try again later; if it persists, update pappdrive.`)
    }
  }

  private params(email: string, kind: Kind): Promise<ParamsResponse> {
    return this.call<ParamsResponse>("/auth/params", { email: normalizeEmail(email) }, kind)
  }

  /** Before a new sign-in replaces the session: sign the old one out, so two users never mix. */
  private async replaceSession(): Promise<void> {
    if (this.session) await this.signOut()
  }

  // ---------- Account ----------

  async signUp(email: string, password: string): Promise<{ recoveryCode: string }> {
    await this.ready
    checkPassword(password)
    await this.replaceSession()
    const params = await this.params(email, "signup")
    const pk = await deriveFromPassword(email, password, params)
    const dataKey = newDataKey()
    const code = newRecoveryCode()
    const rk = await deriveFromRecovery(code)
    const req: SignupRequest = {
      email: normalizeEmail(email),
      app: this.app,
      read: this.read,
      loginKey: toBase64(pk.loginKey),
      recoveryLoginKey: toBase64(rk.recoveryLoginKey),
      passwordCopy: await lockDataKey(dataKey, pk.passwordKey),
      recoveryCopy: await lockDataKey(dataKey, rk.recoveryKey),
    }
    const res = await this.call<TokenResponse>("/auth/signup", req, "signup")
    await this.save(email, res, dataKey)
    return { recoveryCode: formatRecoveryCode(code) }
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.ready
    await this.replaceSession()
    const params = await this.params(email, "signin")
    const pk = await deriveFromPassword(email, password, params)
    const req: LoginRequest = { email: normalizeEmail(email), app: this.app, read: this.read, loginKey: toBase64(pk.loginKey) }
    const res = await this.call<LoginResponse>("/auth/login", req, "signin")
    const dataKey = await unlockDataKey(res.passwordCopy, pk.passwordKey)
    await this.save(email, res, dataKey)
  }

  async recover(email: string, recoveryCode: string, newPassword: string): Promise<void> {
    await this.ready
    checkPassword(newPassword)
    const code = parseRecoveryCode(recoveryCode)
    await this.replaceSession()
    const rk = await deriveFromRecovery(code)
    const req: RecoverRequest = {
      email: normalizeEmail(email),
      app: this.app,
      read: this.read,
      recoveryLoginKey: toBase64(rk.recoveryLoginKey),
    }
    const res = await this.call<RecoverResponse>("/auth/recover", req, "recover")
    const dataKey = await unlockDataKey(res.recoveryCopy, rk.recoveryKey)
    await this.save(email, res, dataKey)
    await this.setPassword(newPassword)
  }

  /**
   * A new password copy and login key, on a signed-in device. No old password: this device
   * already holds the data key. Uses the library's current Argon2id defaults, which the server
   * saves with the account. If it fails halfway, call it again: the device still has the data key.
   */
  async setPassword(newPassword: string): Promise<void> {
    await this.ready
    checkPassword(newPassword)
    const s = this.requireSession()
    const pk = await deriveFromPassword(s.email, newPassword, DEFAULT_ARGON2)
    const req: PasswordRequest = {
      loginKey: toBase64(pk.loginKey),
      passwordCopy: await lockDataKey(fromBase64(s.dataKey), pk.passwordKey),
      params: DEFAULT_ARGON2,
    }
    try {
      await this.api.authed<void>("POST", "/auth/password", req)
    } catch (e) {
      throw this.mapError(e, "password")
    }
  }

  async signOut(): Promise<void> {
    await this.ready
    if (this.session) {
      try {
        await this.api.authed<void>("POST", "/auth/logout")
      } catch {
        // Offline, or already stopped: signing out here still works.
      }
    }
    const folders = this.openFolders()
    this.own = null
    this.ownOpening = null
    this.readers.clear()
    this.readerFolders.clear()
    await Promise.allSettled(folders.map((f) => f.close()))
    await this.clearSession()
  }

  async deleteApp(password: string): Promise<void> {
    await this.deleteWith(password, "app")
  }

  async deleteAccount(password: string): Promise<void> {
    await this.deleteWith(password, "account")
  }

  private async deleteWith(password: string, reason: GoneReason): Promise<void> {
    await this.ready
    const s = this.requireSession()
    const params = await this.params(s.email, "delete")
    const pk = await deriveFromPassword(s.email, password, params)
    const loginKey = toBase64(pk.loginKey)
    if (reason === "app") await this.call<void>("/app/delete", { email: s.email, app: this.app, loginKey }, "delete")
    else await this.call<void>("/account/delete", { email: s.email, loginKey }, "delete")
    await this.gone(reason, true)
  }

  async signInPrompt(): Promise<void> {
    if (!this.platform.signInPrompt) {
      throw new SyncError(
        "signed-out",
        'signInPrompt works only in a terminal. In a browser, use signInForm(element, papp) from "pappdrive/ui".',
      )
    }
    await this.ready
    await this.platform.signInPrompt(this)
  }

  // ---------- Folders ----------

  get files(): Files {
    if (!this.own) {
      throw new SyncError(
        "signed-out",
        'papp.files is ready only after open. Call await papp.open({ mode: "private" }) or await papp.open({ mode: "visible", path }) first.',
      )
    }
    return this.own
  }

  async open(opts: { mode: "visible"; path: string } | { mode: "private" }): Promise<Files> {
    await this.ready
    const s = this.requireSession()
    if (this.own && !this.marked.has(this.own)) return this.own
    this.ownOpening ??= (async () => {
      const fs = opts.mode === "visible" ? await this.platform.openVisible(opts.path) : await this.platform.openPrivate(s.userId, this.app)
      const folder = await this.start(this.app, false, fs)
      if (this.session !== s) {
        // Signed out while opening.
        await folder.close()
        throw signedOut()
      }
      this.own = folder
      return folder
    })().finally(() => {
      this.ownOpening = null
    })
    return this.ownOpening
  }

  async openReadOnly(app: string): Promise<Files> {
    await this.ready
    if (!this.read.includes(app)) {
      throw new SyncError(
        "not-allowed",
        `"${app}" is not in read. Add it to read in createPapp({ ..., read: [${[...this.read, app].map((n) => `"${n}"`).join(", ")}] }). The next token refresh sends it, no new sign-in needed.`,
      )
    }
    const s = this.requireSession()
    let p = this.readers.get(app)
    if (!p) {
      p = (async () => {
        const fs = await this.platform.openPrivate(s.userId, this.app, app)
        const folder = await this.start(app, true, fs)
        if (this.session !== s) {
          await folder.close()
          throw signedOut()
        }
        this.readerFolders.set(app, folder)
        return folder
      })()
      p.catch(() => {
        if (this.readers.get(app) === p) this.readers.delete(app)
      })
      this.readers.set(app, p)
    }
    return p
  }

  private async start(app: string, readOnly: boolean, fs: FsAdapter): Promise<Folder> {
    const ctx: FolderContext = {
      app,
      readOnly,
      fs,
      keys: await this.dataKeys(),
      api: this.api.folderApi(app, readOnly),
      platform: this.platform,
      checkGone: () => this.checkGone(),
    }
    const folder = openFolder(ctx)
    try {
      await folder.start()
    } catch (e) {
      await folder.close().catch(() => {})
      throw e
    }
    return folder
  }

  /** The index vanished: ask the server why. "gone" means the gone flow already ran. */
  private async checkGone(): Promise<"gone" | "ok"> {
    if (!this.session) return "ok"
    try {
      await this.api.refresh()
      return "ok"
    } catch (e) {
      if (e instanceof SyncError && e.code === "gone") return "gone"
      return "ok"
    }
  }
}
