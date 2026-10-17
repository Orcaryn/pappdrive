// Capacitor apps use the browser adapter, with the phone's secure storage for the key
// (spec 12-implementation.md, Tech stack). No plugin is a dependency: the app passes its own.
//
//   import { SecureStorage } from "@aparajita/capacitor-secure-storage"
//   createPapp({ server, app, keyStore: capacitorKeyStore(SecureStorage) })
//
//   import { SecureStoragePlugin } from "capacitor-secure-storage-plugin"
//   createPapp({ server, app, keyStore: capacitorKeyStore(SecureStoragePlugin) })
import type { KeyStore } from "../core/types.js"

/** @aparajita/capacitor-secure-storage: getItem / setItem / removeItem, string values (Keychain / Keystore). */
export interface ItemSecureStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

/** capacitor-secure-storage-plugin: get / set / remove with an options object. get and remove reject when the key is missing. */
export interface OptionsSecureStorage {
  get(options: { key: string }): Promise<{ value: string }>
  set(options: { key: string; value: string }): Promise<unknown>
  remove(options: { key: string }): Promise<unknown>
  keys?(): Promise<{ value: string[] }>
}

export function capacitorKeyStore(plugin: ItemSecureStorage | OptionsSecureStorage): KeyStore {
  if ("getItem" in plugin && typeof plugin.getItem === "function") {
    const p = plugin as ItemSecureStorage
    return {
      get: async (name) => (await p.getItem(name)) ?? null,
      set: (name, value) => p.setItem(name, value),
      delete: (name) => p.removeItem(name),
    }
  }
  const p = plugin as OptionsSecureStorage
  const has = async (key: string): Promise<boolean | null> => {
    if (!p.keys) return null
    return (await p.keys()).value.includes(key)
  }
  return {
    async get(name) {
      if ((await has(name)) === false) return null
      try {
        const { value } = await p.get({ key: name })
        return typeof value === "string" ? value : null
      } catch {
        return null // the plugin rejects for a missing key
      }
    },
    async set(name, value) {
      await p.set({ key: name, value })
    },
    async delete(name) {
      if ((await has(name)) === false) return
      try {
        await p.remove({ key: name })
      } catch {
        // missing key
      }
    },
  }
}
