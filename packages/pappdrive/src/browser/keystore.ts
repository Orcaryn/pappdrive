// Key storage in the browser: IndexedDB, database "pappdrive", store "keys".
// Spec 07-encryption.md, On the device. Never inside the app folder (OPFS).
import type { KeyStore } from "../core/types.js"

export function indexedDbKeyStore(): KeyStore {
  let db: Promise<IDBDatabase> | undefined

  /** Runs one request and resolves with its result once the transaction has committed. */
  const run = async <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open("pappdrive", 1)
      req.onupgradeneeded = () => req.result.createObjectStore("keys")
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = (await db).transaction("keys", mode)
    const req = op(tx.objectStore("keys"))
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result)
      tx.onabort = () => reject(tx.error) // a failed request aborts the transaction
    })
  }

  return {
    get: async (name) => ((await run("readonly", (s) => s.get(name))) as string | undefined) ?? null,
    set: async (name, value) => void (await run("readwrite", (s) => s.put(value, name))),
    delete: async (name) => void (await run("readwrite", (s) => s.delete(name))),
  }
}
