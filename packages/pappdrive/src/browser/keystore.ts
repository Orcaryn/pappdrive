import type { KeyStore } from '../shared/types.js';

export function indexedDbKeyStore(): KeyStore {
  let db: Promise<IDBDatabase> | null = null;

  const run = async <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('pappdrive', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('pappdrive: could not open the key store in IndexedDB.', { cause: req.error }));
    });
    const tx = (await db).transaction('keys', mode);
    const req = op(tx.objectStore('keys'));

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(new Error('pappdrive: a key store transaction failed.', { cause: tx.error }));
    });
  };

  return {
    get: async name => ((await run('readonly', s => s.get(name))) as string | undefined) ?? null,
    set: async (name, value) => void (await run('readwrite', s => s.put(value, name))),
    delete: async name => void (await run('readwrite', s => s.delete(name))),
  };
}

export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function capacitorKeyStore(plugin: SecureStorage): KeyStore {
  return { get: name => plugin.getItem(name), set: (name, value) => plugin.setItem(name, value), delete: name => plugin.removeItem(name) };
}
