// Capacitor apps use the browser adapter, with the phone's secure storage for the key
// (spec 12-implementation.md, Tech stack). No plugin is a dependency: the app passes its own.
//
//   import { SecureStorage } from "@aparajita/capacitor-secure-storage"
//   createPapp({ server, app, keyStore: capacitorKeyStore(SecureStorage) })
//
//   import { SecureStoragePlugin } from "capacitor-secure-storage-plugin"
//   createPapp({ server, app, keyStore: capacitorKeyStore(SecureStoragePlugin) })
import type { KeyStore } from "../core/types.js"

/** @aparajita/capacitor-secure-storage (Keychain / Keystore). */
export interface ItemSecureStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

/** capacitor-secure-storage-plugin. get and remove reject when the key is missing. */
export interface OptionsSecureStorage {
  get(options: { key: string }): Promise<{ value: string }>
  set(options: { key: string; value: string }): Promise<unknown>
  remove(options: { key: string }): Promise<unknown>
}

export function capacitorKeyStore(plugin: ItemSecureStorage | OptionsSecureStorage): KeyStore {
  if ("getItem" in plugin) {
    return {
      get: (name) => plugin.getItem(name),
      set: (name, value) => plugin.setItem(name, value),
      delete: (name) => plugin.removeItem(name),
    }
  }
  return {
    get: (name) =>
      plugin.get({ key: name }).then(
        ({ value }) => value,
        () => null, // missing
      ),
    set: async (name, value) => void (await plugin.set({ key: name, value })),
    delete: async (name) => void (await plugin.remove({ key: name }).catch(() => {})), // missing
  }
}
