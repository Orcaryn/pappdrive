// pappdrive: the command-line tool. Sign up, sign in, list and create apps, export, delete.
// See spec 10-build-order.md step 5, 04-server.md (Apps, Deletion) and 07-encryption.md (Data export).
import { readFileSync } from "node:fs"
import { nodeKeyStore } from "../../pappdrive/src/node/keystore.js"
import { createPrompter, PromptCancelled } from "../../pappdrive/src/node/prompt.js"
import { HELP, parseArgs, resolveServer, UsageError } from "./args.js"
import { Client } from "./client.js"
import * as cmd from "./commands.js"
import { loadConfig } from "./config.js"

function version(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version
  } catch {
    return "unknown"
  }
}

const DURING: Record<string, Parameters<typeof cmd.describeError>[2]> = {
  signup: "signup",
  login: "login",
  "apps list": "apps",
  "apps create": "create",
  "delete-app": "delete-app",
  "delete-account": "delete-account",
}

export async function main(argv: string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`)
    return 2
  }
  if (parsed.command === "help") {
    process.stdout.write(HELP)
    return 0
  }
  if (parsed.command === "version") {
    process.stdout.write(`pappdrive-cli ${version()}\n`)
    return 0
  }

  const config = await loadConfig()
  let server: string
  try {
    server = resolveServer(parsed.flags.server, process.env.PAPPDRIVE_SERVER, config.server)
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`)
    return 2
  }

  const tty = Boolean(process.stdout.isTTY)
  let statusShown = false
  const p = createPrompter()
  const ctx: cmd.Ctx = {
    server,
    flags: parsed.flags,
    config,
    client: new Client(server),
    keyStore: nodeKeyStore(),
    p,
    out: (line) => {
      if (statusShown) process.stdout.write("\r\x1b[K")
      statusShown = false
      process.stdout.write(line + "\n")
    },
    status: (line) => {
      if (!tty) return
      process.stdout.write("\r\x1b[K" + line)
      statusShown = line !== ""
    },
  }

  const [a, b] = parsed.args
  const app = parsed.command === "signup" ? parsed.flags.app : a
  try {
    switch (parsed.command) {
      case "signup":
        await cmd.signup(ctx)
        break
      case "login":
        await cmd.login(ctx)
        break
      case "logout":
        await cmd.logout(ctx)
        break
      case "apps list":
        await cmd.appsList(ctx)
        break
      case "apps create":
        await cmd.appsCreate(ctx, a!)
        break
      case "export":
        await cmd.exportApp(ctx, a!, b!)
        break
      case "delete-app":
        await cmd.deleteApp(ctx, a!)
        break
      case "delete-account":
        await cmd.deleteAccount(ctx)
        break
    }
    return 0
  } catch (e) {
    ctx.status("")
    if (e instanceof PromptCancelled) {
      process.stderr.write(`${e.message}\n`)
      return 130
    }
    const during = parsed.command === "export" ? (ctx.flags.recovery ? "recover" : "export") : DURING[parsed.command]
    process.stderr.write(`${cmd.describeError(e, server, during, app)}\n`)
    return e instanceof UsageError ? 2 : 1
  } finally {
    p.close()
  }
}

// `node src/main.ts ...` runs it directly; bin/pappdrive.js imports it and calls main().
if ((import.meta as { main?: boolean }).main) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
