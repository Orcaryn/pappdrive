import { fromBase64, toBase64 } from '../shared/bytes.js';
import type { Files, Papp } from '../shared/types.js';
import type { Channel, Handlers } from './channel.js';
import { RpcError } from './errors.js';
import type { FilesHandle, PappEvents, PappMethods } from './types.js';

export function serve(papp: Papp, channel: Channel<PappEvents, PappMethods>): void {
  const folders = new Map<FilesHandle, { files: Promise<Files>; stop: () => void }>();
  const reads = new Map<number, ReadableStreamDefaultReader<Uint8Array>>();
  const writes = new Map<number, { writer: WritableStreamDefaultWriter<Uint8Array>; written: Promise<void> }>();
  let nextTransfer = 1;

  async function track(handle: FilesHandle, opening: Promise<Files>): Promise<FilesHandle> {
    const entry = { files: opening, stop: () => {} };
    folders.get(handle)?.stop();
    folders.set(handle, entry);
    const folder = await opening;

    if (folders.get(handle) === entry) {
      const stopWatch = folder.watch(change => channel.notify('change', { files: handle, change }));
      const stopStatus = folder.onStatus(status => channel.notify('status', { files: handle, status }));
      entry.stop = () => {
        stopWatch();
        stopStatus();
      };
    }

    return handle;
  }

  function forget(): void {
    for (const { stop } of folders.values()) {
      stop();
    }

    folders.clear();
  }

  function files(handle: FilesHandle): Promise<Files> {
    const entry = folders.get(handle);

    if (!entry) {
      throw new RpcError({ code: 'bad-request', message: `bad-request: No open folder "${handle}". Call open or openReadOnly first.` });
    }

    return entry.files;
  }

  function transfer<T>(transfers: Map<number, T>, id: number): T {
    const found = transfers.get(id);

    if (!found) {
      throw new RpcError({ code: 'bad-request', message: `bad-request: No open transfer ${id}. It ended, failed or was cancelled.` });
    }

    return found;
  }

  const handlers: Handlers<PappMethods> = {
    signedIn: async () => {
      await papp.ready;

      return papp.signedIn;
    },
    open: ({ where }) => track('own', papp.open(where)),
    openReadOnly: ({ app }) => track(`read:${app}`, papp.openReadOnly(app)),
    signUp: ({ email, password }) => papp.signUp(email, password),
    pendingSignUp: () => papp.pendingSignUp(),
    confirmRecoveryCode: () => papp.confirmRecoveryCode(),
    verifyEmail: ({ code }) => papp.verifyEmail(code),
    sendVerificationEmail: () => papp.sendVerificationEmail(),
    signIn: ({ email, password }) => papp.signIn(email, password),
    recover: ({ email, recoveryCode, newPassword }) => papp.recover(email, recoveryCode, newPassword),
    setPassword: ({ newPassword }) => papp.setPassword(newPassword),
    signOut: () => papp.signOut().finally(forget),
    deleteApp: async ({ password }) => {
      await papp.deleteApp(password);
      forget();
    },
    deleteAccount: async ({ password }) => {
      await papp.deleteAccount(password);
      forget();
    },
    close: () => papp.close().finally(forget),
    'files.readOnly': async p => (await files(p.files)).readOnly,
    'files.writeText': async p => (await files(p.files)).write(p.path, p.text),
    'files.writeStart': async p => {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const written = (await files(p.files)).write(p.path, readable);
      // writer.write() waits for the reader, and a failed write reads no more; aborting fails the waiting chunk with the write's error.
      written.catch((e: unknown) => writer.abort(e));
      const id = nextTransfer++;
      writes.set(id, { writer, written });

      return id;
    },
    'files.writeChunk': async ({ id, base64 }) => {
      const write = transfer(writes, id);
      writes.delete(id);
      await write.writer.write(fromBase64(base64));
      writes.set(id, write);
    },
    'files.writeEnd': async ({ id }) => {
      const { writer, written } = transfer(writes, id);
      writes.delete(id);
      await writer.close();
      await written;
    },
    'files.readStart': async p => {
      const reader = (await files(p.files)).readStream(p.path).getReader();
      const id = nextTransfer++;
      reads.set(id, reader);

      return id;
    },
    'files.readChunk': async ({ id }) => {
      const reader = transfer(reads, id);
      reads.delete(id);
      const next = await reader.read();

      if (next.done) {
        return null;
      }

      reads.set(id, reader);

      return toBase64(next.value);
    },
    'files.cancel': async ({ id }) => {
      const reader = reads.get(id);
      const write = writes.get(id);
      reads.delete(id);
      writes.delete(id);
      await reader?.cancel();
      await write?.writer.abort();
    },
    'files.readText': async p => (await files(p.files)).readText(p.path),
    'files.list': async p => (await files(p.files)).list(p.dir),
    'files.remove': async p => (await files(p.files)).remove(p.path),
    'files.status': async p => (await files(p.files)).status,
    'files.sync': async p => (await files(p.files)).sync(),
  };
  channel.on(handlers);
}
