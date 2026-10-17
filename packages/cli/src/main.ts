// pappdrive: the command-line tool. Sign up, sign in, list and create apps, export, delete.
// See spec 10-build-order.md step 5, 04-server.md (Apps, Deletion) and 07-encryption.md (Data export).
import { readFileSync } from "node:fs"
import { nodeKeyStore } from "../../pappdrive/src/node/keystore.js"
import { createPrompter, PromptCancelled } from "../../pappdrive/src/node/prompt.js"
import { CliError, HELP, parseArgs, resolveServer } from "./args.js"
import * as cmd from "./commands.js"

process.exitCode = await main(process.argv.slice(2))

async function main(argv: string[]): Promise<number> {
  let parsed
  let server: string
  let config: cmd.CliConfig
  try {
    parsed = parseArgs(argv)
    if (parsed.command === "help") {
      process.stdout.write(HELP)
      return 0
    }
    if (parsed.command === "version") {
      const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
      process.stdout.write(`pappdrive-cli ${version}\n`)
      return 0
    }
    config = await cmd.loadConfig()
    server = resolveServer(parsed.flags.server, process.env.PAPPDRIVE_SERVER, config.server)
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`)
    return 2
  }
  const { command, args, flags } = parsed

  const tty = Boolean(process.stdout.isTTY)
  let statusShown = false
  const p = createPrompter()
  const ctx: cmd.Ctx = {
    server,
    flags,
    config,
    keyStore: nodeKeyStore(),
    sessionName: `pappdrive-cli:${server}`,
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

  const [a, b] = args as [string, string]
  try {
    switch (command) {
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
        await cmd.appsCreate(ctx, a)
        break
      case "export":
        await cmd.exportApp(ctx, a, b)
        break
      case "delete-app":
        await cmd.deleteApp(ctx, a)
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
    process.stderr.write(`${cmd.describeError(e, server, flags.recovery ? "recover" : command, flags.app ?? a)}\n`)
    return e instanceof CliError ? e.exitCode : 1
  } finally {
    p.close()
  }
}
