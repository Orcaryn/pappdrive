import { app, safeStorage } from 'electron';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export function safeStorageKeyStore() {
  const dir = app.getPath('userData');
  const file = join(dir, 'pappdrive-keys.json');

  async function load() {
    const text = await readFile(file, 'utf8').catch(err => {
      if (err.code === 'ENOENT') return '{}';
      throw err;
    });
    return JSON.parse(text);
  }
  async function save(all) {
    await mkdir(dir, { recursive: true });
    const temp = file + '.tmp';
    await writeFile(temp, JSON.stringify(all), { mode: 0o600 });
    await rename(temp, file);
  }

  return {
    async get(name) {
      const all = await load();
      if (!all[name]) return null;
      return safeStorage.decryptString(Buffer.from(all[name], 'base64'));
    },
    async set(name, value) {
      const all = await load();
      all[name] = safeStorage.encryptString(value).toString('base64');
      await save(all);
    },
    async delete(name) {
      const all = await load();
      delete all[name];
      await save(all);
    },
  };
}

export function canUseSafeStorage() {
  // Electron's safeStorage may store plain text on Linux without a keyring, and getSelectedStorageBackend exists on Linux only.
  return safeStorage.isEncryptionAvailable() && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
}
