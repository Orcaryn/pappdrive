// The browser entry of pappdrive: web apps, Electron windows, and Capacitor apps on phones.
// Private folders in OPFS, the key in IndexedDB, one tab syncing.
// Spec 05-client.md (Folder modes), 07-encryption.md (On the device, Data loss), 12-implementation.md (Browser adapter).
//
//   import { createPapp } from "pappdrive"
//   const papp = createPapp({ server: "https://sync.example.com", app: "my-notes" })
//   await papp.ready
//   await papp.open({ mode: "private" })   // the browser has no visible folders
//
// Capacitor: keep the key in the phone's secure storage instead of IndexedDB:
//   createPapp({ server, app, keyStore: capacitorKeyStore(SecureStorage) })
import { SyncError } from "../core/errors.js"
import { createPappCore } from "../core/papp.js"
import type { Papp, PappOptions, Platform } from "../core/types.js"
import { browserCoordinator } from "./coordinator.js"
import { indexedDbKeyStore } from "./keystore.js"
import { openOpfs } from "./opfs.js"

export function createPapp(opts: PappOptions): Papp {
  return createPappCore(opts, browserPlatform)
}

export const browserPlatform: Platform = {
  name: "browser",
  defaultKeyStore: indexedDbKeyStore,
  openPrivate: (userId, app, readFor) => openOpfs(userId, app, readFor),
  async openVisible(path) {
    throw new SyncError(
      "not-allowed",
      `A visible folder ("${path}") works only on the desktop. In a browser or on a phone, open the private folder: ` +
        `await papp.open({ mode: "private" }).`,
    )
  },
  coordinator: (name) => browserCoordinator(name),
  // Chrome and Safari decide on their own, Firefox asks the user. The caller ignores a refusal.
  async persist() {
    await navigator.storage.persist()
  },
  onBackground(cb) {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") cb()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", cb)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", cb)
    }
  },
  // No signInPrompt: that is the terminal. In a browser, use signInForm from "pappdrive/ui".
}

export { SyncError } from "../core/errors.js"
export type { SyncErrorCode } from "../core/errors.js"
export type { Change, FileInfo, Files, KeyStore, Papp, PappOptions, Status, WriteData } from "../core/types.js"
export { capacitorKeyStore } from "./capacitor.js"
export type { ItemSecureStorage, OptionsSecureStorage } from "./capacitor.js"
export { indexedDbKeyStore } from "./keystore.js"
