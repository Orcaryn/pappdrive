// Plain-words texts for the sign-in form. No DOM here, so it is tested in Node.
// Errors are matched by `code`. Across Electron IPC an error loses its class and fields, and
// arrives as an Error whose message holds "<code>: <message>", so the code is also read from there.

export const MIN_PASSWORD = 12

export type Mode = "sign-in" | "sign-up" | "recover"

const CODES = [
  "credentials",
  "exists",
  "weak-password",
  "rate-limited",
  "no-app",
  "network",
  "server",
  "gone",
  "update-needed",
  "not-allowed",
] as const

export interface ErrorInfo {
  code: string | null
  message: string
  retryAfter?: number
}

export function errorInfo(err: unknown): ErrorInfo {
  const e = (err ?? {}) as { code?: unknown; message?: unknown; retryAfter?: unknown; name?: unknown }
  const message = typeof e.message === "string" ? e.message : String(err)
  let code = typeof e.code === "string" ? e.code : null
  if (!code) {
    const m = new RegExp(`(?:^|[\\s:'"])(${CODES.join("|")}): `).exec(message)
    if (m) code = m[1]!
  }
  // fetch() in browsers rejects with a TypeError when there is no connection.
  if (!code && e.name === "TypeError" && /fetch|network|load failed/i.test(message)) code = "network"
  let retryAfter = typeof e.retryAfter === "number" ? e.retryAfter : undefined
  if (retryAfter === undefined && code === "rate-limited") {
    const w = /(\d+)\s*second/.exec(message)
    if (w) retryAfter = Number(w[1])
  }
  return retryAfter === undefined ? { code, message } : { code, message, retryAfter }
}

export function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`
  const min = Math.ceil(seconds / 60)
  return `${min} minute${min === 1 ? "" : "s"}`
}

/** The command that creates the app, taken from the library's message when it names one. */
export function createCommand(message: string, app?: string): { app: string; command: string } {
  const cmd = /((?:npx )?pappdrive(?:-cli)? apps create ([a-z0-9-]{1,64}))/.exec(message)
  if (cmd) return { app: cmd[2]!, command: cmd[1]! }
  const named = /app "([a-z0-9-]{1,64})"/.exec(message)?.[1] ?? app ?? "<app name>"
  return { app: named, command: `pappdrive apps create ${named}` }
}

/** What the user reads. `field` says which input to mark as wrong. */
export function errorText(
  err: unknown,
  mode: Mode,
  opts: { app?: string; online?: boolean } = {},
): { text: string; field?: "email" | "password" | "code"; command?: string } {
  const info = errorInfo(err)
  switch (info.code) {
    case "credentials":
      return mode === "recover"
        ? { text: "The email or the recovery code is wrong. Check both against your saved copy of the code.", field: "code" }
        : { text: "Wrong email or password. Try again, or use your recovery code if you forgot the password.", field: "password" }
    case "exists":
      return { text: "An account with this email already exists. Sign in instead.", field: "email" }
    case "weak-password":
      return { text: `The password is too short. Use at least ${MIN_PASSWORD} characters. A few random words work well.`, field: "password" }
    case "rate-limited": {
      const wait = info.retryAfter !== undefined ? waitText(info.retryAfter) : "a minute"
      return { text: `Too many tries. Wait ${wait}, then try again.` }
    }
    case "no-app": {
      const { app, command } = createCommand(info.message, opts.app)
      return { text: `The app "${app}" is not created yet. Create it in a terminal with this command, then try again:`, command }
    }
    case "network":
      return { text: "You seem to be offline, or the sync server cannot be reached. Check the connection and try again." }
    case "gone":
      return { text: "This account or app folder was deleted. Sign up again to start a new, empty folder." }
    case "update-needed":
      return { text: "This app needs an update to sync. Update it, then try again." }
    case "server":
      return { text: "The sync server had a problem. Try again in a minute." }
  }
  if (opts.online === false) {
    return { text: "You seem to be offline. Check the connection and try again." }
  }
  return { text: `Something went wrong: ${info.message}` }
}

/** Crockford base32 reading: case and dashes ignored, I and L read as 1, O as 0. */
function normalizeGroup(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
}

/** Did the user type back the last group of the code? */
export function matchesGroup(typed: string, lastGroup: string): boolean {
  const t = normalizeGroup(typed)
  return t.length > 0 && t === normalizeGroup(lastGroup)
}

export function passwordTooShort(password: string): boolean {
  return [...password.normalize("NFC")].length < MIN_PASSWORD
}
