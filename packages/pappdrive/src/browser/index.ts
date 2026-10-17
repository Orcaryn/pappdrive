// The browser entry of pappdrive: web apps, Electron windows, and Capacitor apps on phones.
//
//   import { createPapp } from "pappdrive"
//   const papp = createPapp({ server: "https://sync.example.com", app: "my-notes" })
//   await papp.ready
//   await papp.open({ mode: "private" })   // the browser has no visible folders
//
// Capacitor: keep the key in the phone's secure storage instead of IndexedDB:
//   createPapp({ server, app, keyStore: capacitorKeyStore(SecureStorage) })
import { createPappCore } from "../core/papp.js"
import type { Papp, PappOptions } from "../core/types.js"
import { browserPlatform } from "./platform.js"

export function createPapp(opts: PappOptions): Papp {
  return createPappCore(opts, browserPlatform)
}

export { SyncError } from "../core/errors.js"
export type { SyncErrorCode } from "../core/errors.js"
export type { Change, FileInfo, Files, KeyStore, Papp, PappOptions, Status, WriteData } from "../core/types.js"
export { capacitorKeyStore } from "./capacitor.js"
export type { ItemSecureStorage, OptionsSecureStorage } from "./capacitor.js"
export { indexedDbKeyStore } from "./keystore.js"
export { browserPlatform, createBrowserPlatform } from "./platform.js"
