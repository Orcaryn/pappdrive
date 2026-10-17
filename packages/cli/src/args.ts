// Plain argv parsing, no framework.

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageError"
  }
}

const VALUE_FLAGS = new Set(["server", "email", "app"])
const BOOLEAN_FLAGS = new Set(["recovery", "force", "help", "version"])
const SHORT: Record<string, string> = { h: "help", v: "version" }

export interface Parsed {
  /** "signup", "login", "logout", "apps list", "apps create", "export", "delete-app", "delete-account", "help", "version" */
  command: string
  args: string[]
  flags: { server?: string; email?: string; app?: string; recovery?: boolean; force?: boolean }
}

/** The commands, with the number of arguments each takes. */
const COMMANDS: Record<string, { args: string[]; flags: string[] }> = {
  signup: { args: [], flags: ["server", "email", "app"] },
  login: { args: [], flags: ["server", "email"] },
  logout: { args: [], flags: ["server"] },
  "apps list": { args: [], flags: ["server", "email"] },
  "apps create": { args: ["name"], flags: ["server", "email"] },
  export: { args: ["app", "dir"], flags: ["server", "email", "recovery", "force"] },
  "delete-app": { args: ["name"], flags: ["server", "email"] },
  "delete-account": { args: [], flags: ["server", "email"] },
  help: { args: [], flags: [] },
  version: { args: [], flags: [] },
}

export function parseArgs(argv: string[]): Parsed {
  const words: string[] = []
  const flags: Record<string, string | boolean> = {}
  let rest = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (rest || !a.startsWith("-") || a === "-") {
      words.push(a)
      continue
    }
    if (a === "--") {
      rest = true
      continue
    }
    let name: string
    let value: string | undefined
    if (a.startsWith("--")) {
      const eq = a.indexOf("=")
      name = eq < 0 ? a.slice(2) : a.slice(2, eq)
      value = eq < 0 ? undefined : a.slice(eq + 1)
    } else {
      name = SHORT[a.slice(1)] ?? ""
      if (!name) throw new UsageError(`Unknown option ${a}. Run \`pappdrive help\` to see the options.`)
    }
    if (VALUE_FLAGS.has(name)) {
      if (value === undefined) {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith("--")) throw new UsageError(`--${name} needs a value, like --${name} ${example(name)}.`)
        value = next
        i++
      }
      if (value === "") throw new UsageError(`--${name} needs a value, like --${name} ${example(name)}.`)
      flags[name] = value
    } else if (BOOLEAN_FLAGS.has(name)) {
      if (value !== undefined) throw new UsageError(`--${name} takes no value. Write just --${name}.`)
      flags[name] = true
    } else {
      throw new UsageError(`Unknown option --${name}. Run \`pappdrive help\` to see the options.`)
    }
  }

  if (flags.version) return { command: "version", args: [], flags: {} }
  if (flags.help || words.length === 0 || words[0] === "help") return { command: "help", args: words.slice(1), flags: {} }

  let command = words[0]!
  let args = words.slice(1)
  if (command === "apps") {
    const sub = args[0]
    if (sub !== "list" && sub !== "create") {
      throw new UsageError(
        sub === undefined
          ? "`pappdrive apps` needs a subcommand: `pappdrive apps list` or `pappdrive apps create <name>`."
          : `Unknown subcommand "apps ${sub}". Use \`pappdrive apps list\` or \`pappdrive apps create <name>\`.`,
      )
    }
    command = `apps ${sub}`
    args = args.slice(1)
  }
  const spec = COMMANDS[command]
  if (!spec) throw new UsageError(`Unknown command "${command}". Run \`pappdrive help\` to see the commands.`)
  if (args.length !== spec.args.length) {
    const usage = `pappdrive ${command}${spec.args.map((a) => ` <${a}>`).join("")}`
    throw new UsageError(
      args.length < spec.args.length
        ? `Missing ${spec.args.slice(args.length).map((a) => `<${a}>`).join(" and ")}. Usage: ${usage}`
        : `Too many arguments: ${args.slice(spec.args.length).join(" ")}. Usage: ${usage}`,
    )
  }
  for (const f of Object.keys(flags)) {
    if (!spec.flags.includes(f)) throw new UsageError(`\`pappdrive ${command}\` does not take --${f}.`)
  }
  return { command, args, flags: flags as Parsed["flags"] }
}

function example(name: string): string {
  return name === "server" ? "https://sync.example.com" : name === "email" ? "me@example.com" : "my-notes"
}

/** "https://sync.example.com/" or ".../v1" -> "https://sync.example.com". Refuses anything but http(s). */
export function normalizeServer(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new UsageError(`"${raw}" is not a server address. Give the full address, like --server https://sync.example.com.`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UsageError(`"${raw}" is not an http or https address. Use --server https://sync.example.com.`)
  }
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/+$/, "").replace(/\/v1$/, "")
}

/** --server, then $PAPPDRIVE_SERVER, then the saved config. */
export function resolveServer(flag: string | undefined, env: string | undefined, saved: string | undefined): string {
  const raw = flag ?? (env || undefined) ?? saved
  if (!raw) {
    throw new UsageError(
      "Which server? Pass --server https://sync.example.com, or set PAPPDRIVE_SERVER. " +
        "After the first signup or login it is remembered.",
    )
  }
  return normalizeServer(raw)
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
