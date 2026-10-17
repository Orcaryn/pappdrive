// Key storage on a desktop: the system keychain through @napi-rs/keyring, service "pappdrive".
// Where there is no keychain (Linux without a secret service, a missing native module):
// a file at ~/.config/pappdrive/<name>.key, mode 0600, in a folder with mode 0700.
// Never inside the app folder. See spec 07-encryption.md, On the device.
import type { AsyncEntry } from "@napi-rs/keyring"
import { createHash } from "node:crypto"
import * as fsp from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import type { KeyStore } from "../core/types.js"

const KEYCHAIN_SERVICE = "pappdrive"

export interface NodeKeyStoreOptions {
  /** "auto": keychain, else file. "file": the file only (tests, or a machine where the keychain prompts). */
  backend?: "auto" | "file"
  /** Folder for the file fallback. Default $XDG_CONFIG_HOME/pappdrive or ~/.config/pappdrive. */
  dir?: string
}

export function nodeKeyStore(opts: NodeKeyStoreOptions = {}): KeyStore {
  const dir = opts.dir ?? configDir()
  // Loaded on first use. null: use the file.
  let keychain: Promise<typeof AsyncEntry | null> | undefined = opts.backend === "file" ? Promise.resolve(null) : undefined
  const getKeychain = () =>
    (keychain ??= import("@napi-rs/keyring").then(
      (m) => m.AsyncEntry,
      () => null,
    ))

  let warned = false
  const giveUp = (e: unknown) => {
    // The keychain module loads but cannot be used here: use the file from now on.
    keychain = Promise.resolve(null)
    if (warned) return
    warned = true
    console.warn(
      `pappdrive: the system keychain is not available (${(e as Error).message}). ` +
        `The key is kept in a file in ${dir}, readable only by you. ` +
        `To use the keychain on Linux, install and unlock a secret service such as GNOME Keyring or KWallet.`,
    )
  }

  const file = (name: string) => join(dir, keyFileName(name))

  return {
    async get(name) {
      const Entry = await getKeychain()
      if (Entry) {
        try {
          const value = await new Entry(KEYCHAIN_SERVICE, name).getPassword()
          if (value != null) return value // null when there is no entry
        } catch (e) {
          giveUp(e)
        }
      }
      // Also where a key lands when the keychain was unavailable when it was saved.
      try {
        return await fsp.readFile(file(name), "utf8")
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
        throw e
      }
    },
    async set(name, value) {
      const Entry = await getKeychain()
      if (Entry) {
        try {
          await new Entry(KEYCHAIN_SERVICE, name).setPassword(value)
          await fsp.rm(file(name), { force: true }) // no stale copy left behind in a file
          return
        } catch (e) {
          giveUp(e)
        }
      }
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
      await fsp.chmod(dir, 0o700) // mkdir leaves an existing folder as it was
      const target = file(name)
      const temp = `${target}.${process.pid}.${Date.now()}.saving`
      await fsp.writeFile(temp, value, { mode: 0o600 })
      await fsp.rename(temp, target)
    },
    async delete(name) {
      const Entry = await getKeychain()
      if (Entry) {
        try {
          await new Entry(KEYCHAIN_SERVICE, name).deletePassword() // false when there is no entry
        } catch (e) {
          giveUp(e)
        }
      }
      await fsp.rm(file(name), { force: true })
    },
  }
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config"), "pappdrive")
}

/** A file name for a key name: safe characters kept, anything else replaced, plus a short hash if changed. */
export function keyFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_").slice(0, 100)
  if (safe === name) return `${safe}.key`
  return `${safe}-${createHash("sha256").update(name).digest("hex").slice(0, 8)}.key`
}
