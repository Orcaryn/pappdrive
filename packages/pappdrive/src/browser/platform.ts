// The browser Platform: private folders in OPFS, the key in IndexedDB, one tab syncing.
// Spec 05-client.md (Folder modes), 07-encryption.md (On the device, Data loss), 12-implementation.md (Browser adapter).
import { SyncError } from "../core/errors.js"
import type { Platform } from "../core/types.js"
import { browserCoordinator } from "./coordinator.js"
import { indexedDbKeyStore } from "./keystore.js"
import { openOpfs, type OpfsOptions } from "./opfs.js"

/** `pappdrive/<userId>/<app>`, or `pappdrive/<userId>/<app>.read-<other>` for a read-only mirror. */
export function opfsSegments(userId: string, app: string, readFor?: string): string[] {
  return ["pappdrive", userId, readFor ? `${app}.read-${readFor}` : app]
}

let persistAsked: Promise<void> | null = null

/** Asks once per page. Chrome and Safari decide on their own, Firefox asks the user. A no changes nothing. */
function persistOnce(): Promise<void> {
  persistAsked ??= (async () => {
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage
    if (!storage?.persist) return
    try {
      if (storage.persisted && (await storage.persisted())) return
      await storage.persist()
    } catch {
      // Refused or not allowed here. The folder still works; the browser may clear it under pressure.
    }
  })()
  return persistAsked
}

export function createBrowserPlatform(opfs: OpfsOptions = {}): Platform {
  return {
    name: "browser",
    defaultKeyStore: () => indexedDbKeyStore(),
    openPrivate: (userId, app, readFor) => openOpfs(opfsSegments(userId, app, readFor), opfs),
    async openVisible(path) {
      throw new SyncError(
        "not-allowed",
        `A visible folder ("${path}") works only on the desktop. In a browser or on a phone, open the private folder: ` +
          `await papp.open({ mode: "private" }).`,
      )
    },
    coordinator: (name) => browserCoordinator(name),
    persist: persistOnce,
    onBackground(cb) {
      if (typeof window === "undefined" || typeof document === "undefined") return () => {}
      const onVisibility = () => {
        if (document.visibilityState === "hidden") cb()
      }
      const onPageHide = () => cb()
      document.addEventListener("visibilitychange", onVisibility)
      window.addEventListener("pagehide", onPageHide)
      return () => {
        document.removeEventListener("visibilitychange", onVisibility)
        window.removeEventListener("pagehide", onPageHide)
      }
    },
    // No signInPrompt: that is the terminal. In a browser, use signInForm from "pappdrive/ui".
  }
}

export const browserPlatform: Platform = createBrowserPlatform()
