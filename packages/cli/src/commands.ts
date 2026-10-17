// The commands. Each error message says how to fix it.
// Server calls go through core request(): the routes the Papp SDK does not expose
// (apps, deletion, sign-in without an app). See spec 12-implementation.md, API.
import * as fsp from "node:fs/promises"
import { join } from "node:path"
import {
  APP_NAME_RE,
  type AppInfo,
  type LoginRequest,
  type LoginResponse,
  normalizeEmail,
  type RecoverRequest,
  type RecoverResponse,
  type RefreshResponse,
  type SignupRequest,
  type TokenResponse,
} from "@pappdrive/protocol"
import { request } from "../../pappdrive/src/core/api.js"
import { toBase64 } from "../../pappdrive/src/core/bytes.js"
import {
  dataKeys,
  deriveFromPassword,
  deriveFromRecovery,
  formatRecoveryCode,
  lockDataKey,
  parseRecoveryCode,
  randomBytes,
  unlockDataKey,
} from "../../pappdrive/src/core/crypto.js"
import { ApiError, SyncError } from "../../pappdrive/src/core/errors.js"
import type { KeyStore } from "../../pappdrive/src/core/types.js"
import { configDir } from "../../pappdrive/src/node/keystore.js"
import { askNewPassword, confirmRecoveryCode, type Prompter } from "../../pappdrive/src/node/prompt.js"
import { CliError, type Command, type Parsed } from "./args.js"
import { runExport } from "./export.js"

export interface Ctx {
  server: string
  flags: Parsed["flags"]
  /** The server and email used last. */
  config: CliConfig
  /** The sign-in (refresh token) is kept under this name: in the system keychain, or a 0600 key file. */
  keyStore: KeyStore
  sessionName: string
  p: Prompter
  out: (line: string) => void
  /** Rewrites one status line on a terminal; prints nothing elsewhere. */
  status: (line: string) => void
}

export interface CliConfig {
  server?: string
  email?: string
}

const configPath = () => join(configDir(), "cli.json")

export async function loadConfig(): Promise<CliConfig> {
  try {
    return JSON.parse(await fsp.readFile(configPath(), "utf8")) as CliConfig
  } catch {
    return {}
  }
}

/** Only a convenience: a failure here must not stop signup before the recovery code is shown. */
async function remember(ctx: Ctx, email: string): Promise<void> {
  ctx.config = { server: ctx.server, email: normalizeEmail(email) }
  await fsp
    .mkdir(configDir(), { recursive: true, mode: 0o700 })
    .then(() => fsp.writeFile(configPath(), JSON.stringify(ctx.config, null, 2) + "\n", { mode: 0o600 }))
    .catch(() => {})
}

/** A server or library error, in plain words, with what to do next. `during` is the command, or "recover". */
export function describeError(e: unknown, server: string, during?: Command | "recover", app?: string): string {
  if (e instanceof ApiError) {
    switch (e.error) {
      case "network":
        return `Could not reach ${server}. Check the address (--server) and the connection, then try again.`
      case "credentials":
        return during === "recover"
          ? "Wrong email or recovery code. Check both against your saved copy and try again."
          : "Wrong email or password. Try again. If you forgot the password, `pappdrive export <app> <dir> --recovery` still works with the recovery code."
      case "expired":
        return "Your sign-in on this computer has ended. Run `pappdrive login`, then the command again."
      case "rate-limited":
        return `Too many tries. Wait ${e.retryAfter ?? 60} seconds, then run the command again.`
      case "exists":
        return during === "signup"
          ? "An account with this email already exists. Run `pappdrive login` instead."
          : `You already have an app named "${app}". Pick another name, or use that app. See them with \`pappdrive apps list\`.`
      case "no-app":
        return `There is no app named "${app}" in this account. See your apps with \`pappdrive apps list\`, or create it with \`pappdrive apps create ${app}\`.`
      case "gone":
        return e.reason === "account" ? "This account was deleted. Create a new one with `pappdrive signup`." : "The app's folder was deleted."
      case "not-allowed":
        return "The server did not allow this with the current sign-in. Run `pappdrive login`, then the command again."
      case "bad-request":
        return during === "apps create"
          ? "The server refused the app name. App names use lowercase letters, digits and -, 1 to 64 characters, like my-notes."
          : "The server refused the request as malformed. Update pappdrive-cli, then try again."
      default:
        return `The server answered ${e.status} ${e.error}. Try again in a minute; if it keeps happening, the server may be down.`
    }
  }
  if (e instanceof SyncError) return e.message.replace(/^[a-z-]+: /, "")
  if (e instanceof CliError) return e.message
  return `Unexpected error: ${(e as Error).stack}`
}

function checkAppName(name: string): void {
  if (!APP_NAME_RE.test(name)) {
    throw new CliError(`"${name}" is not a valid app name. Use lowercase letters, digits and -, 1 to 64 characters, like my-notes.`, 2)
  }
}

async function askEmail(ctx: Ctx): Promise<string> {
  if (ctx.flags.email) return ctx.flags.email
  const last = ctx.config.email
  for (;;) {
    const email = await ctx.p.ask(last ? `Email [${last}]: ` : "Email: ", last)
    if (/^[^\s@]+@[^\s@]+$/.test(email)) return email
    ctx.out("That does not look like an email address. Type it like name@example.com.")
  }
}

/** Asks for the password and runs the step, again while the password is wrong, up to three times. */
async function withPassword<T>(ctx: Ctx, step: (password: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const password = await ctx.p.askHidden("Password: ")
    ctx.status("Checking the password...")
    try {
      return await step(password)
    } catch (e) {
      if (!(e instanceof ApiError && e.error === "credentials" && attempt < 3)) throw e
      ctx.out(describeError(e, ctx.server))
    } finally {
      ctx.status("")
    }
  }
}

/** Runs the slow password hash with the account's settings. */
async function passwordKeys(ctx: Ctx, email: string, password: string) {
  return deriveFromPassword(email, password, await request(ctx.server, "POST", "/auth/params", { email: normalizeEmail(email) }))
}

/** Signs in without an app: the token can list and create apps, and read the folders on `read`. */
async function passwordLogin(ctx: Ctx, email: string, password: string, read: string[]) {
  const { loginKey, passwordKey } = await passwordKeys(ctx, email, password)
  const req: LoginRequest = { email: normalizeEmail(email), read, loginKey: toBase64(loginKey) }
  return { ...(await request<LoginResponse>(ctx.server, "POST", "/auth/login", req)), passwordKey }
}

// ---------- signup, login, logout ----------

export async function signup(ctx: Ctx): Promise<void> {
  const app = ctx.flags.app
  if (app !== undefined) checkAppName(app)
  ctx.out(`Creating an account on ${ctx.server}.`)
  const email = await askEmail(ctx)
  const password = await askNewPassword(ctx.p)
  ctx.status("Making the keys...")
  const { loginKey, passwordKey } = await passwordKeys(ctx, email, password)
  const dataKey = randomBytes(32)
  const code = randomBytes(16)
  const { recoveryLoginKey, recoveryKey } = await deriveFromRecovery(code)
  const req: SignupRequest = {
    email: normalizeEmail(email),
    read: [],
    loginKey: toBase64(loginKey),
    recoveryLoginKey: toBase64(recoveryLoginKey),
    passwordCopy: await lockDataKey(dataKey, passwordKey),
    recoveryCopy: await lockDataKey(dataKey, recoveryKey),
  }
  if (app !== undefined) req.app = app
  ctx.status("Creating the account...")
  let res
  try {
    res = await request<TokenResponse>(ctx.server, "POST", "/auth/signup", req)
  } finally {
    ctx.status("")
  }
  await ctx.keyStore.set(ctx.sessionName, res.refreshToken)
  await remember(ctx, email)
  await confirmRecoveryCode(ctx.p, formatRecoveryCode(code))
  ctx.out("")
  ctx.out(`Account created for ${req.email}. This computer is signed in.`)
  if (app !== undefined) {
    ctx.out(`The app "${app}" is created. In the app: createPapp({ server: "${ctx.server}", app: "${app}" }), then sign in with this email and password.`)
  } else {
    ctx.out("Next: create an app with `pappdrive apps create <name>`.")
  }
}

export async function login(ctx: Ctx): Promise<void> {
  ctx.out(`Signing in to ${ctx.server}.`)
  await signIn(ctx)
  ctx.out("Signed in. Your sign-in is kept in the system keychain; the password is not stored.")
}

async function signIn(ctx: Ctx): Promise<string> {
  const email = await askEmail(ctx)
  const res = await withPassword(ctx, (pw) => passwordLogin(ctx, email, pw, []))
  await ctx.keyStore.set(ctx.sessionName, res.refreshToken)
  await remember(ctx, email)
  return res.accessToken
}

/** An access token from the saved sign-in; signs in first when there is none or it stopped working. */
async function accessToken(ctx: Ctx): Promise<string> {
  const refreshToken = await ctx.keyStore.get(ctx.sessionName)
  if (!refreshToken) {
    ctx.out(`You are not signed in to ${ctx.server}. Sign in:`)
    return signIn(ctx)
  }
  try {
    return (await request<RefreshResponse>(ctx.server, "POST", "/auth/refresh", { refreshToken })).accessToken
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 401 || e.status === 410))) throw e
    await ctx.keyStore.delete(ctx.sessionName)
    if (e.status === 410) throw e
    ctx.out("The saved sign-in no longer works. Sign in again.")
    return signIn(ctx)
  }
}

export async function logout(ctx: Ctx): Promise<void> {
  const refreshToken = await ctx.keyStore.get(ctx.sessionName)
  if (!refreshToken) {
    ctx.out(`You were not signed in to ${ctx.server}. Nothing to do.`)
    return
  }
  try {
    const { accessToken } = await request<RefreshResponse>(ctx.server, "POST", "/auth/refresh", { refreshToken })
    await request(ctx.server, "POST", "/auth/logout", undefined, accessToken)
  } catch {
    // The sign-in already stopped, or the server is unreachable: forget it here anyway.
  }
  await ctx.keyStore.delete(ctx.sessionName)
  ctx.out(`Signed out of ${ctx.server} on this computer.`)
}

// ---------- apps ----------

export async function appsList(ctx: Ctx): Promise<void> {
  const apps = await request<AppInfo[]>(ctx.server, "GET", "/apps", undefined, await accessToken(ctx))
  if (apps.length === 0) {
    ctx.out("No apps yet. Create one with `pappdrive apps create <name>`.")
    return
  }
  const width = Math.max(4, ...apps.map((a) => a.name.length))
  ctx.out(`${"NAME".padEnd(width)}  CREATED`)
  for (const a of apps.sort((x, y) => x.name.localeCompare(y.name))) {
    ctx.out(`${a.name.padEnd(width)}  ${new Date(a.created).toLocaleString()}`)
  }
}

export async function appsCreate(ctx: Ctx, name: string): Promise<void> {
  checkAppName(name)
  await request(ctx.server, "POST", "/apps", { name }, await accessToken(ctx))
  ctx.out(`Created the app "${name}".`)
  ctx.out(`In the app: createPapp({ server: "${ctx.server}", app: "${name}" }), then sign in with your email and password.`)
}

// ---------- export ----------

export async function exportApp(ctx: Ctx, app: string, dir: string): Promise<void> {
  checkAppName(app)
  ctx.out(`Exporting "${app}" from ${ctx.server} into ${dir}.`)
  const email = await askEmail(ctx)
  let token: string
  let rawKey: Uint8Array
  if (ctx.flags.recovery) {
    const code = await ctx.p.ask("Recovery code: ")
    ctx.status("Checking the recovery code...")
    try {
      const { recoveryLoginKey, recoveryKey } = await deriveFromRecovery(parseRecoveryCode(code))
      const req: RecoverRequest = { email: normalizeEmail(email), read: [app], recoveryLoginKey: toBase64(recoveryLoginKey) }
      const res = await request<RecoverResponse>(ctx.server, "POST", "/auth/recover", req)
      token = res.accessToken
      rawKey = await unlockDataKey(res.recoveryCopy, recoveryKey)
    } finally {
      ctx.status("")
    }
  } else {
    const res = await withPassword(ctx, (pw) => passwordLogin(ctx, email, pw, [app]))
    token = res.accessToken
    rawKey = await unlockDataKey(res.passwordCopy, res.passwordKey)
  }
  try {
    const result = await runExport({
      server: ctx.server,
      token,
      app,
      dir,
      keys: await dataKeys(rawKey),
      force: Boolean(ctx.flags.force),
      progress: (done, total, bytes, totalBytes) => ctx.status(`${done} of ${total} files, ${size(bytes)} of ${size(totalBytes)}`),
    })
    ctx.status("")
    if (!result) {
      ctx.out(`"${app}" has no files yet: its folder was never synced, or it was deleted. Nothing to export.`)
      return
    }
    ctx.out(`Exported ${result.written} files into ${dir}.${result.unchanged ? ` ${result.unchanged} were already there, unchanged.` : ""}`)
    for (const s of result.skipped) ctx.out(`  skipped ${s.path}: ${s.reason}`)
    for (const f of result.failed) ctx.out(`  failed  ${f.path}: ${f.reason}`)
    if (result.skipped.length) ctx.out(`${result.skipped.length} files were skipped. To get them, export on a system that can create those names.`)
    if (result.failed.length) {
      throw new CliError(`${result.failed.length} files could not be exported. Run the same command with --force to retry them; finished files are skipped.`)
    }
  } finally {
    // The export signed in as a new install; stop it so it does not linger.
    await request(ctx.server, "POST", "/auth/logout", undefined, token).catch(() => {})
  }
}

function size(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

// ---------- deletion: the password again, no token (04-server.md, Deletion) ----------

export async function deleteApp(ctx: Ctx, name: string): Promise<void> {
  checkAppName(name)
  ctx.out("")
  ctx.out(`  DELETE THE APP "${name}" AND ALL OF ITS FILES`)
  ctx.out("")
  ctx.out(`  This deletes "${name}"'s folder on the server and stops its sync on every device.`)
  ctx.out("  It is final: no copy is kept, nothing can bring it back.")
  ctx.out("  Visible folders stay on disk on each device; private stores are deleted.")
  ctx.out(`  Export it first if you want a copy: pappdrive export ${name} <folder>`)
  ctx.out("")
  const typed = await ctx.p.ask(`To delete it, type the app's name (${name}): `)
  if (typed !== name) throw new CliError("The name did not match. Nothing was deleted.")
  const email = await askEmail(ctx)
  await withPassword(ctx, async (pw) => {
    const { loginKey } = await passwordKeys(ctx, email, pw)
    await request(ctx.server, "POST", "/app/delete", { email: normalizeEmail(email), app: name, loginKey: toBase64(loginKey) })
  })
  ctx.out(`Deleted the app "${name}". Its name is free again.`)
}

export async function deleteAccount(ctx: Ctx): Promise<void> {
  ctx.out("")
  ctx.out("  DELETE THE WHOLE ACCOUNT")
  ctx.out("")
  ctx.out("  This deletes every app and every file of this account on the server, and the account's key.")
  ctx.out("  Every device is signed out. It is final: no copy is kept, nothing can bring it back.")
  ctx.out("  Export each app first if you want a copy: pappdrive export <app> <folder>  (see `pappdrive apps list`)")
  ctx.out("")
  const email = normalizeEmail(await askEmail(ctx))
  const phrase = "delete my account"
  const typed = await ctx.p.ask(`To delete ${email}, type "${phrase}": `)
  if (typed.toLowerCase() !== phrase) throw new CliError("The words did not match. Nothing was deleted.")
  await withPassword(ctx, async (pw) => {
    const { loginKey } = await passwordKeys(ctx, email, pw)
    await request(ctx.server, "POST", "/account/delete", { email, loginKey: toBase64(loginKey) })
  })
  await ctx.keyStore.delete(ctx.sessionName)
  ctx.out(`Deleted the account ${email} and all of its apps.`)
}
