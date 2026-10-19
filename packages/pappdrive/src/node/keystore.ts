import type { AsyncEntry } from '@napi-rs/keyring';
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import type { KeyStore } from '../shared/types.js';
import { configDir } from './dirs.js';

const KEYCHAIN_SERVICE = 'pappdrive';

export interface NodeKeyStoreOptions {
  backend?: 'file';
  dir?: string;
}

export function nodeKeyStore(opts: NodeKeyStoreOptions = {}): KeyStore {
  const dir = opts.dir ?? configDir();
  const fileStore = fileKeyStore(dir);

  return opts.backend === 'file' ? fileStore : keychainKeyStore(fileStore, dir);
}

function keychainKeyStore(fileStore: KeyStore, dir: string): KeyStore {
  let keychain: Promise<typeof AsyncEntry | null> = import('@napi-rs/keyring').then(
    m => m.AsyncEntry,
    () => null
  );
  let warned = false;

  const giveUp = (e: unknown) => {
    keychain = Promise.resolve(null);

    if (warned) {
      return;
    }

    warned = true;
    console.warn(
      `pappdrive: the system keychain is not available (${String(e)}). ` +
        `The key is kept in a file in ${dir}, readable only by you. ` +
        `To use the keychain on Linux, install and unlock a secret service such as GNOME Keyring or KWallet.`
    );
  };

  const inKeychain = async <T>(name: string, op: (entry: AsyncEntry) => Promise<T>): Promise<T | undefined> => {
    const Entry = await keychain;

    if (!Entry) {
      return undefined;
    }

    try {
      return await op(new Entry(KEYCHAIN_SERVICE, name));
    } catch (e) {
      giveUp(e);

      return undefined;
    }
  };

  return {
    get: async name => (await inKeychain(name, entry => entry.getPassword())) ?? fileStore.get(name),
    async set(name, value) {
      const stored = await inKeychain(name, async entry => {
        await entry.setPassword(value);

        return true;
      });

      await (stored ? fileStore.delete(name) : fileStore.set(name, value));
    },
    async delete(name) {
      await inKeychain(name, entry => entry.deletePassword());
      await fileStore.delete(name);
    },
  };
}

function fileKeyStore(dir: string): KeyStore {
  const file = (name: string) => join(dir, `${createHash('sha256').update(name).digest('hex')}.key`);

  return {
    async get(name) {
      try {
        return await fsp.readFile(file(name), 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }

        throw e;
      }
    },
    async set(name, value) {
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
      // fs.mkdir leaves an existing folder's mode unchanged.
      await fsp.chmod(dir, 0o700);
      const target = file(name);
      const temp = `${target}.${process.pid}.${Date.now()}.saving`;
      await fsp.writeFile(temp, value, { mode: 0o600 });
      await fsp.rename(temp, target);
    },
    delete: name => fsp.rm(file(name), { force: true }),
  };
}
