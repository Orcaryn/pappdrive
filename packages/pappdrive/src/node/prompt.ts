// Terminal questions, with hidden password input, and the terminal sign-in form (papp.signInPrompt).
// See spec 12-implementation.md, Sign-in form: one form for sign-up, sign-in and recovery;
// sign-up shows the recovery code and cannot go on until its last group is typed back.
import * as readline from "node:readline"
import { Writable } from "node:stream"
import { MIN_PASSWORD_LENGTH } from "@pappdrive/protocol"
import { lastRecoveryGroup } from "../core/crypto.js"
import { SyncError } from "../core/errors.js"
import type { Papp } from "../core/types.js"

export class PromptCancelled extends Error {
  constructor(message = "Cancelled.") {
    super(message)
    this.name = "PromptCancelled"
  }
}

export interface Prompter {
  /** Asks a question and returns the answer, trimmed. An empty answer gives `fallback`, if set. */
  ask(question: string, fallback?: string): Promise<string>
  /** Asks without showing what is typed. Not trimmed. */
  askHidden(question: string): Promise<string>
  say(text: string): void
  close(): void
}

/**
 * One reader for the whole conversation, so answers piped in all at once are not lost.
 * Hidden input: the readline echo goes through a stream that is muted while a password is typed.
 */
export function createPrompter(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Prompter {
  const terminal = Boolean((input as { isTTY?: boolean }).isTTY)
  let muted = false
  const echo = new Writable({
    write(chunk, encoding, cb) {
      if (!muted) output.write(chunk, encoding)
      cb()
    },
  })
  Object.defineProperty(echo, "columns", { get: () => (output as { columns?: number }).columns ?? 80 })
  const rl = readline.createInterface({ input, output: echo, terminal, historySize: 0 })

  const lines: string[] = []
  let waiting: { resolve: (l: string) => void; reject: (e: Error) => void } | null = null
  let ended: Error | null = null
  rl.on("line", (line) => {
    if (waiting) {
      const w = waiting
      waiting = null
      w.resolve(line)
    } else lines.push(line)
  })
  const finish = (e: Error) => {
    ended ??= e
    if (waiting) {
      const w = waiting
      waiting = null
      w.reject(ended)
    }
  }
  rl.on("close", () => finish(new PromptCancelled("No more input: the questions could not be answered.")))
  rl.on("SIGINT", () => {
    muted = false
    output.write("\n")
    finish(new PromptCancelled())
    rl.close()
  })

  const nextLine = (): Promise<string> => {
    const l = lines.shift()
    if (l !== undefined) return Promise.resolve(l)
    if (ended) return Promise.reject(ended)
    return new Promise((resolve, reject) => (waiting = { resolve, reject }))
  }

  return {
    async ask(question, fallback) {
      if (terminal) {
        rl.setPrompt(question)
        rl.prompt()
      } else output.write(question)
      const a = (await nextLine()).trim()
      if (!terminal) output.write("\n")
      return a === "" && fallback !== undefined ? fallback : a
    },
    async askHidden(question) {
      output.write(question)
      muted = true
      try {
        if (terminal) {
          rl.setPrompt("")
          rl.prompt()
        }
        return await nextLine()
      } finally {
        muted = false
        output.write("\n")
      }
    },
    say(text) {
      output.write(text + "\n")
    },
    close() {
      rl.close()
    },
  }
}

/** The plain-words message for an error from sign-up, sign-in or recovery. */
export function explainAuthError(e: unknown, during: "sign-in" | "sign-up" | "recovery" = "sign-in"): string {
  if (!(e instanceof SyncError)) return (e as Error)?.message ?? String(e)
  const detail = e.message.replace(/^[a-z-]+: /, "")
  switch (e.code) {
    case "credentials":
      return during === "recovery"
        ? "Wrong email or recovery code. Check both and try again."
        : "Wrong email or password. Try again, or choose the recovery code if you forgot the password."
    case "exists":
      return "An account with this email already exists. Choose sign in instead."
    case "weak-password":
      return `The password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters.`
    case "rate-limited":
      return `Too many tries. Wait ${e.retryAfter ?? 60} seconds, then try again.`
    case "no-app":
      return /apps create/.test(detail)
        ? `This app is not created in your account yet. ${detail}`
        : `This app is not created in your account yet. ${detail} Create it with \`pappdrive apps create <app name>\`, then sign in again.`
    case "network":
      return `Could not reach the server. Check the connection and try again. (${detail})`
    default:
      return detail
  }
}

/** Uppercase, letters and digits only, with the look-alikes the code format folds (O is 0, I and L are 1). */
function foldCode(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
}

/** Shows the recovery code once, and does not return until its last group is typed back. */
export async function confirmRecoveryCode(p: Prompter, recoveryCode: string): Promise<void> {
  const last = lastRecoveryGroup(recoveryCode)
  p.say("")
  p.say("Your recovery code:")
  p.say("")
  p.say(`    ${recoveryCode}`)
  p.say("")
  p.say("It is the only way back in if you forget your password and have no other signed-in device.")
  p.say("Nobody can reset the password for you, not even the server's operator.")
  p.say("Save it now, in a password manager or on paper. It is not shown again.")
  p.say("")
  for (;;) {
    const typed = await p.ask(`To confirm you saved it, type its last group (the ${last.length} characters after the last dash): `)
    if (foldCode(typed) === foldCode(last)) break
    p.say("That does not match. Look at the code above and type the characters after its last dash.")
  }
  p.say("Recovery code confirmed.")
}

/** Asks for a new password twice, refusing short ones before anything is sent. */
export async function askNewPassword(p: Prompter, label = "Password"): Promise<string> {
  for (;;) {
    const pw = await p.askHidden(`${label} (at least ${MIN_PASSWORD_LENGTH} characters): `)
    if ([...pw].length < MIN_PASSWORD_LENGTH) {
      p.say(`That is ${[...pw].length} characters. Use at least ${MIN_PASSWORD_LENGTH}; a short sentence works well.`)
      continue
    }
    const again = await p.askHidden("Type it again: ")
    if (again === pw) return pw
    p.say("The two passwords differ. Try again.")
  }
}

async function askEmail(p: Prompter): Promise<string> {
  for (;;) {
    const email = await p.ask("Email: ")
    if (/^[^\s@]+@[^\s@]+$/.test(email)) return email
    p.say("That does not look like an email address. Type it like name@example.com.")
  }
}

/**
 * The terminal sign-in form: sign in, create an account, or use the recovery code.
 * Resolves once signed in. Ctrl-C rejects with PromptCancelled.
 */
export async function signInPrompt(papp: Papp, prompter?: Prompter): Promise<void> {
  await papp.ready
  if (papp.signedIn) return
  const p = prompter ?? createPrompter()
  try {
    p.say("Sign in to sync this app's folder.")
    for (;;) {
      p.say("  1. Sign in")
      p.say("  2. Create an account")
      p.say("  3. Forgot the password: use the recovery code")
      const choice = await p.ask("Choose 1, 2 or 3 [1]: ", "1")
      const during = choice === "2" ? "sign-up" : choice === "3" ? "recovery" : "sign-in"
      try {
        if (choice === "1") {
          const email = await askEmail(p)
          const password = await p.askHidden("Password: ")
          p.say("Signing in...")
          await papp.signIn(email, password)
          p.say("Signed in.")
          return
        }
        if (choice === "2") {
          const email = await askEmail(p)
          const password = await askNewPassword(p)
          p.say("Creating the account...")
          const { recoveryCode } = await papp.signUp(email, password)
          await confirmRecoveryCode(p, recoveryCode)
          p.say("Account created. Signed in.")
          return
        }
        if (choice === "3") {
          const email = await askEmail(p)
          const code = await p.ask("Recovery code: ")
          const password = await askNewPassword(p, "New password")
          p.say("Checking the recovery code...")
          await papp.recover(email, code, password)
          p.say("Password changed. Signed in.")
          return
        }
        p.say(`"${choice}" is not one of the choices. Type 1, 2 or 3.`)
      } catch (e) {
        if (e instanceof PromptCancelled) throw e
        p.say(explainAuthError(e, during))
        p.say("")
      }
    }
  } finally {
    if (!prompter) p.close()
  }
}
