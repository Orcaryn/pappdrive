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
import { Api, decodeJwt, goneError, request, signedOut } from "./api.js"
import { fromBase64, toBase64 } from "./bytes.js"
import {
  dataKeys,
  deriveFromPassword,
  deriveFromRecovery,
  formatRecoveryCode,
  lockDataKey,
  parseRecoveryCode,
  randomBytes,
  unlockDataKey,
} from "./crypto.js"
import { ApiError, SyncError, type SyncErrorCode } from "./errors.js"
import { openFolder } from "./folder.js"
import type { Files, Folder, FsAdapter, KeyStore, Papp, PappOptions, Platform } from "./types.js"

/** What the key store holds for one server and app. Never inside the app folder. */
interface StoredSession {
  email: string // normalized
  userId: string
  refreshToken: string
  dataKey: string // base64
}

export function createPappCore(opts: PappOptions, platform: Platform): Papp {
  return new PappCore(opts, platform)
}

class PappCore implements Papp {
  readonly ready: Promise<void>
  private readonly app: string
  private readonly read: string[]
  private readonly keyStore: KeyStore
  private readonly keyName: string
  private readonly api: Api
  private session: StoredSession | null = null
  /** Open or opening folders: "" is the app's own, other keys are read-only folders by app name. */
  private readonly folders = new Map<string, Promise<Folder>>()
  /** Stays after the gone flow, so papp.files.status.deleted tells the app. */
  private own: Folder | null = null

  private readonly server: string

  constructor(
    opts: PappOptions,
    private readonly platform: Platform,
  ) {
    this.server = opts.server
    this.read = opts.read ?? []
    const bad = [opts.app, ...this.read].find((n) => !APP_NAME_RE.test(n))
    if (bad !== undefined) {
      throw new SyncError(
        "no-app",
        `"${bad}" is not a valid app name. App names are lowercase letters, digits and -, 1 to 64 characters.`,
      )
    }
    this.app = opts.app
    this.keyStore = opts.keyStore ?? platform.defaultKeyStore()
    this.keyName = `pappdrive:${opts.server.replace(/\/+$/, "")}:${opts.app}`
    this.api = new Api(opts.server, {
      read: () => this.read,
      // Neither waits for the folders to stop: a folder's own server call got here, and its round is still running.
      onGone: (reason) => this.gone(reason, false),
      onSignedOut: async () => {
        this.own = null
        void this.stopFolders((f) => f.close())
        await this.clearSession()
      },
    })
    this.ready = this.restore()
  }

  get signedIn(): boolean {
    return this.session !== null
  }

  // ---------- Account ----------

  async signUp(email: string, password: string): Promise<{ recoveryCode: string }> {
    await this.ready
    checkPassword(password)
    if (this.session) await this.signOut()
    email = normalizeEmail(email)
    const params = await this.post<ParamsResponse>("/auth/params", { email })
    const pk = await deriveFromPassword(email, password, params)
    const dataKey = randomBytes(32)
    const code = randomBytes(16)
    const rk = await deriveFromRecovery(code)
    const req: SignupRequest = {
      email,
      app: this.app,
      read: this.read,
      loginKey: toBase64(pk.loginKey),
      recoveryLoginKey: toBase64(rk.recoveryLoginKey),
      passwordCopy: await lockDataKey(dataKey, pk.passwordKey),
      recoveryCopy: await lockDataKey(dataKey, rk.recoveryKey),
    }
    await this.save(email, await this.post<TokenResponse>("/auth/signup", req), dataKey)
    return { recoveryCode: formatRecoveryCode(code) }
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.ready
    if (this.session) await this.signOut()
    email = normalizeEmail(email)
    const params = await this.post<ParamsResponse>("/auth/params", { email })
    const pk = await deriveFromPassword(email, password, params)
    const req: LoginRequest = { email, app: this.app, read: this.read, loginKey: toBase64(pk.loginKey) }
    const res = await this.post<LoginResponse>("/auth/login", req)
    await this.save(email, res, await unlockDataKey(res.passwordCopy, pk.passwordKey))
  }

  async recover(email: string, recoveryCode: string, newPassword: string): Promise<void> {
    await this.ready
    checkPassword(newPassword)
    const code = parseRecoveryCode(recoveryCode)
    if (this.session) await this.signOut()
    email = normalizeEmail(email)
    const rk = await deriveFromRecovery(code)
    const req: RecoverRequest = { email, app: this.app, read: this.read, recoveryLoginKey: toBase64(rk.recoveryLoginKey) }
    const res = await this.post<RecoverResponse>("/auth/recover", req)
    await this.save(email, res, await unlockDataKey(res.recoveryCopy, rk.recoveryKey))
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
    await this.post<void>("/auth/password", req, true)
  }

  async signOut(): Promise<void> {
    await this.ready
    // Offline, or already stopped on the server: signing out here still works.
    if (this.session) await this.api.authed<void>("POST", "/auth/logout").catch(() => {})
    this.own = null
    await this.stopFolders((f) => f.close())
    await this.clearSession()
  }

  /** Syncs what is pending, then stops every open folder. The sign-in stays saved. */
  async close(): Promise<void> {
    this.own = null
    await this.stopFolders((f) => f.sync().finally(() => f.close()))
  }

  deleteApp(password: string): Promise<void> {
    return this.deleteWith(password, "app")
  }

  deleteAccount(password: string): Promise<void> {
    return this.deleteWith(password, "account")
  }

  private async deleteWith(password: string, reason: GoneReason): Promise<void> {
    await this.ready
    const { email } = this.requireSession()
    const params = await this.post<ParamsResponse>("/auth/params", { email })
    const loginKey = toBase64((await deriveFromPassword(email, password, params)).loginKey)
    if (reason === "app") await this.post<void>("/app/delete", { email, app: this.app, loginKey })
    else await this.post<void>("/account/delete", { email, loginKey })
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
    this.own = await this.openOnce(s, this.app, false, () =>
      opts.mode === "visible" ? this.platform.openVisible(opts.path) : this.platform.openPrivate(s.userId, this.app),
    )
    return this.own
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
    return this.openOnce(s, app, true, () => this.platform.openPrivate(s.userId, this.app, app))
  }

  /** Opens and starts a folder, or returns the one already open or opening. */
  private async openOnce(s: StoredSession, app: string, readOnly: boolean, openFs: () => Promise<FsAdapter>): Promise<Folder> {
    const key = readOnly ? app : ""
    let opening = this.folders.get(key)
    if (!opening) {
      opening = (async () => {
        const folder = openFolder({
          app,
          readOnly,
          fs: await openFs(),
          keys: await dataKeys(fromBase64(s.dataKey)),
          api: this.api.folderApi(app, readOnly),
          platform: this.platform,
          checkGone: () =>
            this.api.refresh().then(
              () => "ok" as const,
              (e) => (e instanceof SyncError && e.code === "gone" ? "gone" : "ok"), // gone: the gone flow already ran
            ),
        })
        try {
          await folder.start()
        } catch (e) {
          await folder.close()
          throw e
        }
        return folder
      })()
      this.folders.set(key, opening)
      opening.catch(() => {
        if (this.folders.get(key) === opening) this.folders.delete(key)
      })
    }
    const folder = await opening
    // Signed out, or the gone flow ran, while opening: that already stopped this folder.
    if (this.folders.get(key) !== opening) throw signedOut()
    return folder
  }

  /** Forgets every open or opening folder and stops each with `stop`. Never rejects. */
  private stopFolders(stop: (f: Folder) => Promise<void>): Promise<unknown> {
    const folders = [...this.folders.values()]
    this.folders.clear()
    return Promise.allSettled(folders.map(async (opening) => stop(await opening)))
  }

  /**
   * The app's folder or the account was deleted. Stops every open folder and deletes its hidden
   * folder (private: everything), then signs out. Deleting the key store entry also deletes the
   * data key from this device. Never re-uploads. `this.own` stays, for papp.files.status.deleted.
   */
  private async gone(reason: GoneReason, wait: boolean): Promise<void> {
    const deleting = this.stopFolders((f) => f.markDeleted(reason))
    await this.clearSession()
    if (wait) await deleting
  }

  // ---------- Session ----------

  private async restore(): Promise<void> {
    const raw = await this.keyStore.get(this.keyName)
    if (!raw) return
    this.session = JSON.parse(raw) as StoredSession
    this.api.setSession(this.session.refreshToken)
  }

  private async save(email: string, res: TokenResponse, dataKey: Uint8Array): Promise<void> {
    const s: StoredSession = {
      email,
      userId: decodeJwt(res.accessToken).sub,
      refreshToken: res.refreshToken,
      dataKey: toBase64(dataKey),
    }
    await this.keyStore.set(this.keyName, JSON.stringify(s))
    this.session = s
    this.api.setSession(res.refreshToken, res.accessToken)
    await this.platform.persist?.()
  }

  private requireSession(): StoredSession {
    if (!this.session) throw signedOut()
    return this.session
  }

  /** Deletes the key store entry (refresh token and data key) and forgets the tokens. */
  private async clearSession(): Promise<void> {
    this.session = null
    this.api.clear()
    await this.keyStore.delete(this.keyName)
  }

  /** A POST, without a token unless `authed`. Server errors become SyncErrors that say what to do. */
  private async post<T>(path: string, body: unknown, authed = false): Promise<T> {
    try {
      return authed ? await this.api.authed<T>("POST", path, body) : await request<T>(this.server, "POST", path, body)
    } catch (e) {
      if (!(e instanceof ApiError)) throw e
      if (e.error === "expired") throw signedOut("The session expired and could not be renewed.")
      const retryAfter = e.retryAfter ?? 60
      const createApp = `npx pappdrive-cli apps create ${this.app}` // the CLI binary is pappdrive, from the package pappdrive-cli
      const messages: Record<string, string> = {
        network: `Could not reach the server at ${this.server}. Check the connection and try again.`,
        credentials:
          path === "/auth/recover"
            ? "Wrong email or recovery code. Check both against the saved copy."
            : "Wrong email or password. Try again, or use the recovery code to set a new password.",
        exists:
          "An account with this email already exists. Sign in instead, or recover with the recovery code if the password is lost.",
        "no-app":
          `The app "${this.app}"${this.read.length ? ` or one of the read folders (${this.read.join(", ")})` : ""} does not exist ` +
          `in this account. Create it first with the command-line tool: ${createApp} (installed: pappdrive apps create ${this.app}). ` +
          "Then sign in again.",
        "rate-limited": `Too many tries. Wait ${retryAfter} seconds, then try again.`,
        "not-allowed": "The server refused this request for this token.",
      }
      const message = messages[e.error]
      if (!message) throw new SyncError("server", `The server answered ${e.status} ${e.error}. Try again later; if it persists, update pappdrive.`)
      throw new SyncError(e.error as SyncErrorCode, message, e.error === "rate-limited" ? { retryAfter } : undefined)
    }
  }
}

function checkPassword(password: string): void {
  if ([...password.normalize("NFC")].length < MIN_PASSWORD_LENGTH) {
    throw new SyncError(
      "weak-password",
      `The password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters; a few random words work well.`,
    )
  }
}
