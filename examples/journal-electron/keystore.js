// Optional: keep the data key with Electron's safeStorage instead of the system keychain.
// safeStorage needs no native module. It encrypts with a key the operating system keeps
// for this app (Keychain on a Mac, DPAPI on Windows, the secret service on Linux).
// Values are stored encrypted in one file in app.getPath("userData"), never in the synced folder.
import { app, safeStorage } from "electron"
import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { join } from "node:path"

/** @returns {import("pappdrive").KeyStore} */
export function safeStorageKeyStore() {
  const dir = app.getPath("userData")
  const file = join(dir, "pappdrive-keys.json")

  async function load() {
    try {
      return JSON.parse(await readFile(file, "utf8"))
    } catch {
      return {}
    }
  }
  async function save(all) {
    await mkdir(dir, { recursive: true })
    const temp = file + ".tmp"
    await writeFile(temp, JSON.stringify(all), { mode: 0o600 })
    await rename(temp, file) // atomic replace
  }

  return {
    async get(name) {
      const all = await load()
      if (!all[name]) return null
      return safeStorage.decryptString(Buffer.from(all[name], "base64"))
    },
    async set(name, value) {
      const all = await load()
      all[name] = safeStorage.encryptString(value).toString("base64")
      await save(all)
    },
    async delete(name) {
      const all = await load()
      delete all[name]
      await save(all)
    },
  }
}

/** Use safeStorage only when it really encrypts. On Linux without a keyring it may not. */
export function canUseSafeStorage() {
  if (!safeStorage.isEncryptionAvailable()) return false
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend?.() === "basic_text") return false
  return true
}
