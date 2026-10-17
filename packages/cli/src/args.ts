import { parseArgs as parseArgv } from "node:util"

/** An error already explained in plain words. Usage errors exit with 2, the rest with 1. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message)
  }
}

const usageError = (message: string) => new CliError(message, 2)

export type Command = "signup" | "login" | "logout" | "apps list" | "apps create" | "export" | "delete-app" | "delete-account"

export interface Parsed {
  command: Command | "help" | "version"
  args: string[]
  flags: { server?: string; email?: string; app?: string; recovery?: boolean; force?: boolean }
}

const OPTIONS = {
  server: { type: "string" },
  email: { type: "string" },
  app: { type: "string" },
  recovery: { type: "boolean" },
  force: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const

const EXAMPLE: Record<string, string> = { server: "https://sync.example.com", email: "me@example.com", app: "my-notes" }

const COMMANDS: Record<Command, { args: string[]; flags: string[] }> = {
  signup: { args: [], flags: ["server", "email", "app"] },
  login: { args: [], flags: ["server", "email"] },
  logout: { args: [], flags: ["server"] },
  "apps list": { args: [], flags: ["server", "email"] },
  "apps create": { args: ["name"], flags: ["server", "email"] },
  export: { args: ["app", "dir"], flags: ["server", "email", "recovery", "force"] },
  "delete-app": { args: ["name"], flags: ["server", "email"] },
  "delete-account": { args: [], flags: ["server", "email"] },
}

export function parseArgs(argv: string[]): Parsed {
  // Not strict, so each mistake gets its own message below.
  const { tokens, positionals: words } = parseArgv({ args: argv, options: OPTIONS, allowPositionals: true, strict: false, tokens: true })
  const flags: Record<string, string | boolean> = {}
  for (const t of tokens) {
    if (t.kind !== "option") continue
    if (!Object.hasOwn(OPTIONS, t.name)) throw usageError(`Unknown option ${t.rawName}. Run \`pappdrive help\` to see the options.`)
    if (OPTIONS[t.name as keyof typeof OPTIONS].type === "string") {
      if (!t.value || t.value.startsWith("--")) throw usageError(`--${t.name} needs a value, like --${t.name} ${EXAMPLE[t.name]}.`)
      flags[t.name] = t.value
    } else {
      if (t.value !== undefined) throw usageError(`--${t.name} takes no value. Write just --${t.name}.`)
      flags[t.name] = true
    }
  }

  if (flags.version) return { command: "version", args: [], flags: {} }
  if (flags.help || words.length === 0 || words[0] === "help") return { command: "help", args: [], flags: {} }

  let [name, ...args] = words as [string, ...string[]]
  if (name === "apps") {
    const sub = args.shift()
    if (sub !== "list" && sub !== "create") {
      throw usageError(
        sub === undefined
          ? "`pappdrive apps` needs a subcommand: `pappdrive apps list` or `pappdrive apps create <name>`."
          : `Unknown subcommand "apps ${sub}". Use \`pappdrive apps list\` or \`pappdrive apps create <name>\`.`,
      )
    }
    name = `apps ${sub}`
  }
  if (!Object.hasOwn(COMMANDS, name)) throw usageError(`Unknown command "${name}". Run \`pappdrive help\` to see the commands.`)
  const command = name as Command
  const spec = COMMANDS[command]
  if (args.length !== spec.args.length) {
    const usage = `pappdrive ${command}${spec.args.map((a) => ` <${a}>`).join("")}`
    throw usageError(
      args.length < spec.args.length
        ? `Missing ${spec.args.slice(args.length).map((a) => `<${a}>`).join(" and ")}. Usage: ${usage}`
        : `Too many arguments: ${args.slice(spec.args.length).join(" ")}. Usage: ${usage}`,
    )
  }
  for (const f of Object.keys(flags)) {
    if (!spec.flags.includes(f)) throw usageError(`\`pappdrive ${command}\` does not take --${f}.`)
  }
  return { command, args, flags }
}

/** --server, then $PAPPDRIVE_SERVER, then the saved one. "https://sync.example.com/v1/" -> "https://sync.example.com". */
export function resolveServer(flag: string | undefined, env: string | undefined, saved: string | undefined): string {
  const raw = flag || env || saved
  if (!raw) {
    throw usageError(
      "Which server? Pass --server https://sync.example.com, or set PAPPDRIVE_SERVER. After the first signup or login it is remembered.",
    )
  }
  if (!URL.canParse(raw.trim())) {
    throw usageError(`"${raw}" is not a server address. Give the full address, like --server https://sync.example.com.`)
  }
  const url = new URL(raw.trim())
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw usageError(`"${raw}" is not an http or https address. Use --server https://sync.example.com.`)
  }
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/+$/, "").replace(/\/v1$/, "")
}

export const HELP = `pappdrive: accounts, apps and exports for pappdrive sync.

Usage:
  pappdrive signup [--email <email>] [--app <name>]   create an account (and an app)
  pappdrive login [--email <email>]                   sign in on this computer
  pappdrive logout                                    sign out on this computer
  pappdrive apps list                                 the apps in your account
  pappdrive apps create <name>                        create an app (lowercase letters, digits, -)
  pappdrive export <app> <dir> [--recovery] [--force] download and decrypt an app's whole folder
  pappdrive delete-app <name>                         delete an app's folder everywhere, for good
  pappdrive delete-account                            delete the account and every app, for good

Options:
  --server <url>   the sync server. Default: $PAPPDRIVE_SERVER, or the one used last
  --email <email>  the account's email. Default: the one used last
  --recovery       export: use the recovery code instead of the password
  --force          export: write into a folder that is not empty

The server and email used last are kept in ~/.config/pappdrive/cli.json.
The sign-in is kept in the system keychain. No password is stored.
`
