// The node entry of pappdrive: Node, Electron's main process, and command-line tools.
//
//   import { createPapp } from "pappdrive"
//   const papp = createPapp({ server: "https://sync.example.com", app: "my-notes" })
//   await papp.ready
//   if (!papp.signedIn) await papp.signInPrompt()          // a terminal tool; an Electron app uses the form
//   const files = await papp.open({ mode: "visible", path: "~/Notes" })
import { createPappCore } from "../core/papp.js"
import type { Papp, PappOptions } from "../core/types.js"
import { nodePlatform } from "./platform.js"

export function createPapp(opts: PappOptions): Papp {
  return createPappCore(opts, nodePlatform)
}

export { SyncError } from "../core/errors.js"
export type { SyncErrorCode } from "../core/errors.js"
export type { Change, FileInfo, Files, KeyStore, Papp, PappOptions, Status, WriteData } from "../core/types.js"
export { nodePlatform } from "./platform.js"
export { nodeKeyStore, type NodeKeyStoreOptions } from "./keystore.js"
