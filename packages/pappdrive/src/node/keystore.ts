// Key storage on a desktop: the system keychain through @napi-rs/keyring, service "pappdrive".
// Where there is no keychain (Linux without a secret service, a missing native module):
// a file at ~/.config/pappdrive/<name>.key, mode 0600, in a folder with mode 0700.
// Never inside the app folder. See spec 07-encryption.md, On the device.
import { createHash } from "node:crypto"
import * as fsp from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import type { KeyStore } from "../core/types.js"

export const KEYCHAIN_SERVICE = "pappdrive"

interface AsyncEntryLike {
  getPassword(): Promise<string | undefined | null>
  setPassword(value: string): Promise<void>
  deletePassword(): Promise<unknown>
}
type EntryCtor = new (service: string, account: string) => AsyncEntryLike

export interface NodeKeyStoreOptions {
  /** "auto": keychain, else file. "file": the file only (tests, or a machine where the keychain prompts). */
  backend?: "auto" | "file"
  /** Folder for the file fallback. Default $XDG_CONFIG_HOME/pappdrive or ~/.config/pappdrive. */
  dir?: string
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config"), "pappdrive")
}

/** A file name for a key name: safe characters kept, anything else replaced, plus a short hash if changed. */
export function keyFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 100)
  if (safe === name) return `${safe}.key`
  const h = createHash("sha256").update(name).digest("hex").slice(0, 8)
  return `${safe}-${h}.key`
}

export function nodeKeyStore(opts: NodeKeyStoreOptions = {}): KeyStore {
  const dir = opts.dir ?? configDir()
  let keychain: Promise<EntryCtor | null> | null =
    opts.backend === "file" ? Promise.resolve(null) : null
  let warned = false

  const getKeychain = (): Promise<EntryCtor | null> =>
    (keychain ??= import("@napi-rs/keyring")
      .then((m) => (m as unknown as { AsyncEntry: EntryCtor }).AsyncEntry ?? null)
      .catch(() => null))

  const giveUp = (e: unknown) => {
    // The keychain exists as a module but cannot be used here: use the file from now on.
    keychain = Promise.resolve(null)
    if (!warned) {
      warned = true
      console.warn(
        `pappdrive: the system keychain is not available (${(e as Error)?.message ?? e}). ` +
          `The key is kept in a file in ${dir}, readable only by you. ` +
          `To use the keychain on Linux, install and unlock a secret service such as GNOME Keyring or KWallet.`,
      )
    }
  }

  const file = (name: string) => join(dir, keyFileName(name))

  const fileGet = async (name: string): Promise<string | null> => {
    try {
      return await fsp.readFile(file(name), "utf8")
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
      throw e
    }
  }

  const fileSet = async (name: string, value: string): Promise<void> => {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
    await fsp.chmod(dir, 0o700).catch(() => {})
    const target = file(name)
    const temp = `${target}.${process.pid}.${Date.now()}.saving`
    await fsp.writeFile(temp, value, { mode: 0o600 })
    await fsp.chmod(temp, 0o600).catch(() => {}) // the umask may have widened it
    await fsp.rename(temp, target)
  }

  const fileDelete = (name: string) => fsp.rm(file(name), { force: true })

  return {
    async get(name) {
      const Entry = await getKeychain()
      if (Entry) {
        try {
          const v = await new Entry(KEYCHAIN_SERVICE, name).getPassword()
          if (typeof v === "string") return v
        } catch (e) {
          if (!isNoEntry(e)) giveUp(e)
        }
      }
      // Also where a key lands when the keychain was unavailable when it was saved.
      return fileGet(name)
    },
    async set(name, value) {
      const Entry = await getKeychain()
      if (Entry) {
        try {
          await new Entry(KEYCHAIN_SERVICE, name).setPassword(value)
          await fileDelete(name) // no stale copy left behind in a file
          return
        } catch (e) {
          giveUp(e)
        }
      }
      await fileSet(name, value)
    },
    async delete(name) {
      const Entry = await getKeychain()
      if (Entry) {
        try {
          await new Entry(KEYCHAIN_SERVICE, name).deletePassword()
        } catch {
          // no entry, or no keychain: the file below is all there is
        }
      }
      await fileDelete(name)
    },
  }
}

function isNoEntry(e: unknown): boolean {
  return /no (matching )?entry|not found/i.test(String((e as Error)?.message ?? e))
}
