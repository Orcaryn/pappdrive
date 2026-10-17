// What the CLI remembers: the server and email used last (a plain file), and the sign-in
// (refresh token) in the system keychain, or the 0600 key file where there is none.
import * as fsp from "node:fs/promises"
import { join } from "node:path"
import type { KeyStore } from "../../pappdrive/src/core/types.js"
import { configDir } from "../../pappdrive/src/node/keystore.js"

export interface CliConfig {
  server?: string
  email?: string
}

export interface CliSession {
  email: string
  refreshToken: string
  installId: string
}

export function configPath(dir = configDir()): string {
  return join(dir, "cli.json")
}

export async function loadConfig(path = configPath()): Promise<CliConfig> {
  try {
    const raw = JSON.parse(await fsp.readFile(path, "utf8")) as unknown
    return raw && typeof raw === "object" ? (raw as CliConfig) : {}
  } catch {
    return {}
  }
}

export async function saveConfig(cfg: CliConfig, path = configPath()): Promise<void> {
  await fsp.mkdir(join(path, ".."), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.saving`
  await fsp.writeFile(temp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 })
  await fsp.rename(temp, path)
}

export function sessionKey(server: string): string {
  return `pappdrive-cli:${server}`
}

export async function loadSession(ks: KeyStore, server: string): Promise<CliSession | null> {
  const raw = await ks.get(sessionKey(server))
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as CliSession
    return typeof s.refreshToken === "string" ? s : null
  } catch {
    return null
  }
}

export function saveSession(ks: KeyStore, server: string, s: CliSession): Promise<void> {
  return ks.set(sessionKey(server), JSON.stringify(s))
}

export function deleteSession(ks: KeyStore, server: string): Promise<void> {
  return ks.delete(sessionKey(server))
}
