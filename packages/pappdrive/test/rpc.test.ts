import { describe, expect, it } from 'vitest';
import { createChannel } from '../src/rpc/channel.js';
import { createClient } from '../src/rpc/client.js';
import { RpcError } from '../src/rpc/errors.js';
import { serve } from '../src/rpc/serve.js';
import type { PappEvents, PappMethods, Transport } from '../src/rpc/types.js';
import { SyncError } from '../src/shared/errors.js';
import type { Change, Files, Papp, Status } from '../src/shared/types.js';
import { withPlainBuffer } from '../src/shared/bytes.js';
import { must } from './helpers/must.js';

function pair(): [Transport, Transport] {
  let toB: (text: string) => void = () => {};

  let toA: (text: string) => void = () => {};

  const a: Transport = { send: text => queueMicrotask(() => toB(text)), onMessage: cb => (toA = cb) };
  const b: Transport = { send: text => queueMicrotask(() => toA(text)), onMessage: cb => (toB = cb) };

  return [a, b];
}

function fakePapp() {
  const store = new Map<string, Uint8Array>();
  const watchers = new Set<(c: Change) => void>();
  const statusWatchers = new Set<(s: Status) => void>();
  const status: Status = { syncing: false, lastSync: null, pending: 0, skipped: [], deleted: null, error: null };
  const calls: string[] = [];
  const files: Files = {
    readOnly: false,
    async write(path, data) {
      if (path === 'refused.bin') {
        throw new SyncError('bad-path', `"${path}" is refused.`);
      } else if (data instanceof ReadableStream) {
        store.set(path, new Uint8Array(await new Response(data as ReadableStream).arrayBuffer()));
      } else if (data instanceof Uint8Array || data instanceof Blob) {
        throw new Error('not in this test');
      } else {
        store.set(path, new TextEncoder().encode(data));
      }

      for (const cb of watchers) {
        cb({ path, origin: 'local' });
      }
    },
    async read(path) {
      const data = store.get(path);

      if (!data) {
        throw new SyncError('not-found', `"${path}" does not exist.`);
      }

      return data;
    },
    readText: async path => new TextDecoder().decode(await files.read(path)),
    readStream: path => new Blob([withPlainBuffer(must(store.get(path)))]).stream(),
    list: async () => [...store.keys()].map(path => ({ path, size: 0, mtime: 0, dir: false })),
    async remove(path) {
      store.delete(path);
    },
    watch: cb => {
      watchers.add(cb);

      return () => watchers.delete(cb);
    },
    status,
    onStatus: cb => {
      statusWatchers.add(cb);

      return () => statusWatchers.delete(cb);
    },
    async sync() {
      calls.push('sync');
    },
  };
  const papp: Papp = {
    ready: Promise.resolve(),
    signedIn: true,
    files,
    open: async () => files,
    openReadOnly: async () => files,
    signUp: async () => ({ recoveryCode: 'AAAA-BBBB' }),
    pendingSignUp: async () => null,
    confirmRecoveryCode: async () => {},
    verifyEmail: async () => {},
    sendVerificationEmail: async () => {},
    async signIn(email, password) {
      calls.push(`signIn ${email} ${password}`);
    },
    recover: async () => {},
    setPassword: async () => {},
    async signOut() {
      calls.push('signOut');
    },
    deleteApp: async () => {},
    async deleteAccount(password) {
      if (password !== 'right') {
        throw new SyncError('credentials', 'Wrong email or password.');
      }
    },
    close: async () => {},
  };

  return { papp, calls, statusWatchers, status };
}

function connect() {
  const [a, b] = pair();
  const fake = fakePapp();
  serve(fake.papp, createChannel<PappEvents, PappMethods>(a));

  return { client: createClient(createChannel<PappMethods, PappEvents>(b)), ...fake };
}

describe('rpc', () => {
  it('calls papp methods and returns values', async () => {
    const { client, calls } = connect();
    expect(await client.signedIn()).toBe(true);
    await client.signIn('a@b.c', 'pw');
    expect(calls).toEqual(['signIn a@b.c pw']);
    expect(await client.signUp('a@b.c', 'pw')).toEqual({ recoveryCode: 'AAAA-BBBB' });
  });

  it('writes text and bytes through a folder handle', async () => {
    const { client } = connect();
    const files = await client.open({ mode: 'private' });
    expect(files.handle).toBe('own');
    await files.write('a.txt', 'hello');
    await files.write('b.bin', new Uint8Array([0, 255, 7]));
    expect(await files.readText('a.txt')).toBe('hello');
    expect(await files.read('b.bin')).toEqual(new Uint8Array([0, 255, 7]));
    expect((await files.list()).map(f => f.path)).toEqual(['a.txt', 'b.bin']);
    expect(await files.status()).toEqual({ syncing: false, lastSync: null, pending: 0, skipped: [], deleted: null, error: null });
  });

  it('moves bytes bigger than one slice both ways', async () => {
    const { client } = connect();
    const files = await client.open({ mode: 'private' });
    const big = Uint8Array.from({ length: 2.5 * 1024 * 1024 }, (_, i) => i % 251);
    await files.write('big.bin', big);
    expect(await files.read('big.bin')).toEqual(big);
    await files.write('empty.bin', new Uint8Array(0));
    expect(await files.read('empty.bin')).toEqual(new Uint8Array(0));
  });

  it('a write the folder refuses fails its chunk instead of hanging', async () => {
    const { client } = connect();
    const files = await client.open({ mode: 'private' });
    const err = await files.write('refused.bin', new Uint8Array(3 * 1024 * 1024)).catch((e: unknown) => e);
    expect((err as RpcError).code).toBe('bad-path');
  });

  it('a cancelled write lands nothing and closes its transfer', async () => {
    const [a, b] = pair();
    const fake = fakePapp();
    serve(fake.papp, createChannel<PappEvents, PappMethods>(a));
    const raw = createChannel<PappMethods, PappEvents>(b);
    await raw.request('open', { where: { mode: 'private' } });
    const id = await raw.request('files.writeStart', { files: 'own', path: 'half.bin' });
    await raw.request('files.writeChunk', { id, base64: 'AAEC' });
    await raw.request('files.cancel', { id });
    const err = await raw.request('files.writeChunk', { id, base64: 'AAEC' }).catch((e: unknown) => e);
    expect((err as RpcError).code).toBe('bad-request');
    expect(await raw.request('files.list', { files: 'own' })).toEqual([]);
  });

  it('delivers change and status events per handle', async () => {
    const { client, statusWatchers, status } = connect();
    const files = await client.open({ mode: 'private' });
    const changes: Change[] = [];
    const statuses: Status[] = [];
    files.watch(c => changes.push(c));
    files.onStatus(s => statuses.push(s));
    await files.write('a.txt', 'x');

    for (const cb of statusWatchers) {
      cb({ ...status, syncing: true });
    }

    await new Promise(r => setTimeout(r, 0));
    expect(changes).toEqual([{ path: 'a.txt', origin: 'local' }]);
    expect(statuses).toEqual([{ ...status, syncing: true }]);
  });

  it('carries SyncError code and message across', async () => {
    const { client } = connect();
    const files = await client.open({ mode: 'private' });
    const err = await files.readText('missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe('not-found');
    expect((err as RpcError).message).toBe('not-found: "missing" does not exist.');
  });

  it('rejects an unknown handle and forgets handles on sign-out', async () => {
    const { client, calls } = connect();
    const files = await client.open({ mode: 'private' });
    await client.signOut();
    expect(calls).toEqual(['signOut']);
    const err = await files.sync().catch((e: unknown) => e);
    expect((err as RpcError).code).toBe('bad-request');
  });

  it('keeps handles open when deleting the account fails', async () => {
    const { client } = connect();
    const files = await client.open({ mode: 'private' });
    const err = await client.deleteAccount('typo').catch((e: unknown) => e);
    expect((err as RpcError).code).toBe('credentials');
    await files.write('a.txt', 'still open');
    expect(await files.readText('a.txt')).toBe('still open');
    await client.deleteAccount('right');
    expect(((await files.sync().catch((e: unknown) => e)) as RpcError).code).toBe('bad-request');
  });

  it('a call right after an unanswered open waits for it, and gets its error if it fails', async () => {
    const [a, b] = pair();
    const fake = fakePapp();
    let fail = false;
    fake.papp.open = async () => {
      await new Promise(r => setTimeout(r, 5));

      if (fail) {
        throw new SyncError('signed-out', 'Not signed in.');
      }

      return fake.papp.files;
    };

    serve(fake.papp, createChannel<PappEvents, PappMethods>(a));
    const raw = createChannel<PappMethods, PappEvents>(b);
    const opened = raw.request('open', { where: { mode: 'private' } });
    await raw.request('files.writeText', { files: 'own', path: 'a.txt', text: 'x' });
    expect(await raw.request('files.readText', { files: 'own', path: 'a.txt' })).toBe('x');
    expect(await opened).toBe('own');
    fail = true;
    const failed = raw.request('open', { where: { mode: 'private' } }).catch((e: unknown) => e);
    const err = await raw.request('files.readText', { files: 'own', path: 'a.txt' }).catch((e: unknown) => e);
    expect((err as RpcError).code).toBe('signed-out');
    expect(((await failed) as RpcError).code).toBe('signed-out');
  });
});
