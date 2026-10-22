import { app, BrowserWindow, ipcMain } from 'electron';
import { createPapp } from 'pappdrive';
import { createChannel, serve } from 'pappdrive/rpc';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeStorageKeyStore, canUseSafeStorage } from './keystore.js';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = process.env.PAPPDRIVE_SERVER;
const APP = 'journal';

let papp;

async function main() {
  await app.whenReady();
  if (!SERVER) throw new Error('Set PAPPDRIVE_SERVER to your Pappdrive server, e.g. https://sync.pappdrive.com');

  papp = createPapp({ server: SERVER, app: APP, keyStore: canUseSafeStorage() ? safeStorageKeyStore() : undefined });
  await papp.ready;

  const win = new BrowserWindow({ width: 960, height: 680, title: 'Journal', webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true } });
  const channel = createChannel({ send: text => win.webContents.send('pappdrive', text), onMessage: cb => ipcMain.on('pappdrive', (_event, text) => cb(text)) });
  serve(papp, channel);
  await win.loadFile(join(here, 'index.html'));
}

let quitting = false;
app.on('before-quit', event => {
  if (quitting || !papp) return;
  event.preventDefault();
  quitting = true;
  const timeout = new Promise(resolve => setTimeout(resolve, 5000));
  Promise.race([papp.close(), timeout]).then(
    () => app.quit(),
    err => {
      console.error(err);
      app.exit(1);
    }
  );
});
app.on('window-all-closed', () => app.quit());

main().catch(err => {
  console.error(err);
  app.exit(1);
});
