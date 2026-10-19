import { app, BrowserWindow, ipcMain } from 'electron';
import { createPapp, SyncError } from 'pappdrive';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeStorageKeyStore, canUseSafeStorage } from './keystore.js';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER = process.env.PAPPDRIVE_SERVER;
const APP = 'journal';

let papp;
let win;
let files = null;
let stopWatch = () => {};
let stopStatus = () => {};

function checkName(name) {
  if (typeof name !== 'string' || !name.endsWith('.md') || name.includes('/') || name.startsWith('.')) {
    throw new SyncError('bad-path', `"${name}" is not a journal entry. Use a name like 2026-10-17.md.`);
  }
  return name;
}

async function openJournal() {
  if (files) return;
  files = await papp.open({ mode: 'visible', path: join(app.getPath('home'), 'Journal') });
  stopWatch = files.watch(change => win?.webContents.send('journal:change', change));
  stopStatus = files.onStatus(status => {
    win?.webContents.send('journal:status', status);
    if (status.deleted) closeJournal();
  });
  win?.webContents.send('journal:status', files.status);
}

function closeJournal() {
  stopWatch();
  stopStatus();
  files = null;
}

// Electron IPC keeps only the message of a thrown error, so handlers return errors as values to keep code and retryAfter.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: { code: err.code, message: err.message, retryAfter: err.retryAfter, reason: err.reason } };
    }
  });
}

handle('auth:signUp', (email, password) => papp.signUp(email, password));
handle('auth:signIn', (email, password) => papp.signIn(email, password));
handle('auth:recover', (email, code, newPassword) => papp.recover(email, code, newPassword));
handle('auth:pendingSignUp', () => papp.pendingSignUp());
handle('auth:confirmRecoveryCode', () => papp.confirmRecoveryCode());
handle('auth:signOut', async () => {
  closeJournal();
  await papp.signOut();
});

function journal() {
  if (!files) throw new SyncError('signed-out', 'The journal is not open. Sign in, then call open.');
  return files;
}

handle('journal:signedIn', () => papp.signedIn);
handle('journal:open', openJournal);
handle('journal:list', async () => {
  const entries = await journal().list();
  return entries.filter(e => !e.dir && e.path.endsWith('.md')).sort((a, b) => b.path.localeCompare(a.path));
});
handle('journal:read', async name => {
  try {
    return await journal().readText(checkName(name));
  } catch (err) {
    if (err instanceof SyncError && err.code === 'not-found') return '';
    throw err;
  }
});
handle('journal:write', (name, text) => journal().write(checkName(name), text));
handle('journal:remove', name => journal().remove(checkName(name)));
handle('journal:sync', () => journal().sync());
handle('journal:status', () => journal().status);

async function main() {
  await app.whenReady();
  if (!SERVER) throw new Error('Set PAPPDRIVE_SERVER to your Pappdrive server, e.g. https://sync.example.com');

  papp = createPapp({ server: SERVER, app: APP, keyStore: canUseSafeStorage() ? safeStorageKeyStore() : undefined });
  await papp.ready;
  if (papp.signedIn) await openJournal();

  win = new BrowserWindow({ width: 960, height: 680, title: 'Journal', webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true } });
  await win.loadFile(join(here, 'index.html'));
}

let quitting = false;
app.on('before-quit', event => {
  if (quitting || !files) return;
  event.preventDefault();
  quitting = true;
  const timeout = new Promise(resolve => setTimeout(resolve, 5000));
  Promise.race([papp.close(), timeout]).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());

main().catch(err => {
  console.error(err);
  app.exit(1);
});
