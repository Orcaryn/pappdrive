// Key storage in the browser: IndexedDB, database "pappdrive", store "keys".
// Spec 07-encryption.md, On the device. Never inside the app folder (OPFS).
import type { KeyStore } from "../core/types.js"

const DB = "pappdrive"
const STORE = "keys"

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** `factory` defaults to the global indexedDB; tests pass fake-indexeddb. */
export function indexedDbKeyStore(factory?: IDBFactory): KeyStore {
  let db: Promise<IDBDatabase> | null = null
  const open = (): Promise<IDBDatabase> => {
    if (db) return db
    const idb = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB)
    if (!idb) return Promise.reject(new Error("pappdrive: this browser has no IndexedDB, so the key cannot be kept. Pass createPapp({ keyStore })."))
    db = new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(DB, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => {
        const d = req.result
        // Another tab upgrading the database: close, and open again on the next call.
        d.onversionchange = () => {
          d.close()
          db = null
        }
        resolve(d)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error("pappdrive: IndexedDB is blocked by another tab. Close other tabs of this app and reload."))
    })
    db.catch(() => {
      db = null
    })
    return db
  }
  const tx = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE)

  return {
    async get(name) {
      const v = await done((await tx("readonly")).get(name))
      return typeof v === "string" ? v : null
    },
    async set(name, value) {
      const store = await tx("readwrite")
      const committed = txDone(store.transaction)
      store.put(value, name)
      await committed
    },
    async delete(name) {
      const store = await tx("readwrite")
      const committed = txDone(store.transaction)
      store.delete(name)
      await committed
    },
  }
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error("pappdrive: IndexedDB transaction aborted"))
  })
}
