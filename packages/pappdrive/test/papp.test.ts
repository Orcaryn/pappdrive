import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ARGON2, type Argon2Params, type GoneReason } from '@pappdrive/protocol';
import { SyncError } from '../src/shared/errors.js';
import { createPappCore } from '../src/papp/index.js';
import type { KeyStore, Status } from '../src/shared/types.js';
import type { Platform } from '../src/shared/platform.js';
import type { Folder, FolderContext } from '../src/papp/folder/types.js';
import { hashWasmArgon2 } from '../src/shared/argon2.js';
import { must } from './helpers/must.js';

const opened: { ctx: FolderContext; folder: Folder }[] = [];
vi.mock('../src/papp/folder/index.js', () => ({
  openFolder: (ctx: FolderContext): Folder => {
    const status: Status = { syncing: false, lastSync: null, pending: 0, skipped: [], deleted: null, error: null };
    const folder = {
      readOnly: ctx.readOnly,
      status,
      start: vi.fn(async () => {}),
      sync: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      markDeleted: vi.fn(async (reason: GoneReason) => {
        status.deleted = reason;
      }),
    } as unknown as Folder;
    opened.push({ ctx, folder });

    return folder;
  },
}));

const LOW: Argon2Params = { m: 1024, t: 1, p: 1 };
const SERVER = 'https://sync.test';

interface User {
  userId: string;
  loginKey: string;
  recoveryLoginKey: string;
  params: Argon2Params;
  passwordCopy: string;
  recoveryCopy: string;
  apps: Set<string>;
}
interface Install {
  userId: string;
  app: string;
  read: string[];
  stopped?: GoneReason;
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type FakeServer = ReturnType<typeof createFakeServer>;

function createFakeServer() {
  let n = 0;
  const server = { users: new Map<string, User>(), installs: new Map<string, Install>(), calls: [] as string[], accessSeconds: 3600, expireNext: false, fetch };

  function token(refresh: string, inst: Install): string {
    const exp = Math.floor(Date.now() / 1000) + server.accessSeconds;

    return `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: inst.userId, app: inst.app, install: refresh, read: inst.read, exp }))}.sig`;
  }

  function issue(userId: string, app: string, read: string[]): { accessToken: string; refreshToken: string; installId: string } {
    const refreshToken = `rt${++n}`;
    const inst = { userId, app, read };
    server.installs.set(refreshToken, inst);

    return { accessToken: token(refreshToken, inst), refreshToken, installId: `inst${n}` };
  }

  async function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, '');
    server.calls.push(`${init?.method ?? 'GET'} ${path}${url.search}`);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const json = (status: number, data?: unknown) => new Response(data === undefined ? null : JSON.stringify(data), { status });
    const err = (status: number, error: string, extra: object = {}) => json(status, { error, ...extra });
    const checkApps = (u: User, names: string[]) => names.every(n => u.apps.has(n));

    switch (path) {
      case '/auth/params':
        return json(200, server.users.get(body.email)?.params ?? LOW);
      case '/auth/signup': {
        if (server.users.has(body.email)) {
          return err(409, 'exists');
        }

        const u: User = {
          userId: `user${++n}`,
          loginKey: body.loginKey,
          recoveryLoginKey: body.recoveryLoginKey,
          params: LOW,
          passwordCopy: body.passwordCopy,
          recoveryCopy: body.recoveryCopy,
          apps: new Set(body.app ? [body.app] : []),
        };

        if (!checkApps(u, body.read)) {
          return err(404, 'no-app');
        }

        server.users.set(body.email, u);

        return json(200, issue(u.userId, body.app ?? '', body.read));
      }

      case '/auth/login':
      case '/auth/recover': {
        const u = server.users.get(body.email);
        const ok = path === '/auth/login' ? u?.loginKey === body.loginKey : u?.recoveryLoginKey === body.recoveryLoginKey;

        if (!u || !ok) {
          return err(401, 'credentials');
        } else if (body.app && !u.apps.has(body.app)) {
          return err(404, 'no-app');
        } else if (!checkApps(u, body.read)) {
          return err(404, 'no-app');
        }

        const t = issue(u.userId, body.app ?? '', body.read);

        return json(200, path === '/auth/login' ? { ...t, passwordCopy: u.passwordCopy } : { ...t, recoveryCopy: u.recoveryCopy });
      }

      case '/auth/refresh': {
        const inst = server.installs.get(body.refreshToken);

        if (!inst) {
          return err(401, 'credentials');
        } else if (inst.stopped) {
          return err(410, 'gone', { reason: inst.stopped });
        } else if (body.read) {
          inst.read = body.read;
        }

        return json(200, { accessToken: token(body.refreshToken, inst) });
      }

      case '/app/delete':
      case '/account/delete': {
        const u = server.users.get(body.email);

        if (!u || u.loginKey !== body.loginKey) {
          return err(401, 'credentials');
        }

        for (const inst of server.installs.values()) {
          if (inst.userId !== u.userId) {
            continue;
          } else if (path === '/account/delete') {
            inst.stopped = 'account';
          } else if (inst.app === body.app) {
            inst.stopped = 'app';
          }
        }

        if (path === '/account/delete') {
          server.users.delete(body.email);
        } else {
          u.apps.delete(body.app);
        }

        return json(204);
      }
    }

    const auth = (init?.headers as Record<string, string> | undefined)?.['authorization'];
    const claims = auth ? JSON.parse(atob(must(auth.split('.')[1]).replace(/-/g, '+').replace(/_/g, '/'))) : null;

    if (!claims || claims.exp < Date.now() / 1000 || server.expireNext) {
      server.expireNext = false;

      return err(401, 'expired');
    }

    const inst = server.installs.get(claims.install);
    const user = [...server.users.values()].find(u => u.userId === claims.sub);

    switch (path) {
      case '/auth/password':
        if (!user) {
          return err(401, 'expired');
        }

        user.loginKey = body.loginKey;
        user.passwordCopy = body.passwordCopy;
        user.params = DEFAULT_ARGON2;

        return json(204);
      case '/auth/logout':
        server.installs.delete(claims.install);

        return json(204);
      case '/delta': {
        const app = url.searchParams.get('app');

        if (app && !claims.read.includes(app)) {
          return err(403, 'not-allowed');
        } else if (inst?.stopped) {
          return err(410, 'gone', { reason: inst.stopped });
        }

        return new Response(JSON.stringify({ v: 1, base: 'a'.repeat(64), blobs: {}, body: '' }), { status: 200, headers: { ETag: '"e1"' } });
      }
    }

    if (path.startsWith('/blobs/')) {
      return new Response(new Uint8Array(0), { status: 200 });
    }

    return err(400, 'bad-request');
  }

  return server;
}

function memoryStore(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();

  return { data, get: async n => data.get(n) ?? null, set: async (n, v) => void data.set(n, v), delete: async n => void data.delete(n) };
}

function platform(): Platform & { persist: ReturnType<typeof vi.fn> } {
  return {
    argon2: hashWasmArgon2,
    openPrivate: vi.fn(async (_u: string, _a: string, readFor?: string) => ({ kind: 'private', readFor }) as never),
    openVisible: vi.fn(async (path: string) => ({ kind: 'visible', path }) as never),
    persist: vi.fn(async () => {}),
  };
}

function startServer(): FakeServer {
  const server = createFakeServer();
  opened.length = 0;
  vi.stubGlobal('fetch', server.fetch);

  return server;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const EMAIL = 'Sagi@Example.com';
const PW = 'correct horse battery';

function device(opts: { app?: string; read?: string[]; store?: KeyStore } = {}) {
  const store = opts.store ?? memoryStore();
  const p = platform();
  const papp = createPappCore({ server: SERVER + '/', app: opts.app ?? 'notes', read: opts.read }, p, store);

  return { papp, store: store as ReturnType<typeof memoryStore>, platform: p };
}

function storedKey(store: ReturnType<typeof memoryStore>): string {
  return JSON.parse(must([...store.data.values()][0])).dataKey;
}

async function errorOf(p: Promise<unknown>): Promise<SyncError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(SyncError);

    return e as SyncError;
  }

  throw new Error('expected a SyncError');
}

describe('account layer', () => {
  it('signs up, and a second device signs in to the same data key', async () => {
    startServer();
    const a = device();
    await a.papp.ready;
    expect(a.papp.signedIn).toBe(false);
    const { recoveryCode } = await a.papp.signUp(EMAIL, PW);
    expect(recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]{6}$/);
    expect(a.papp.signedIn).toBe(false);
    expect(await a.papp.pendingSignUp()).toEqual({ email: 'sagi@example.com', recoveryCode });
    expect(await errorOf(a.papp.open({ mode: 'private' }))).toMatchObject({ code: 'signed-out' });
    await a.papp.confirmRecoveryCode();
    expect(a.papp.signedIn).toBe(true);
    expect(await a.papp.pendingSignUp()).toBe(null);
    expect(a.platform.persist).toHaveBeenCalled();
    expect([...a.store.data.keys()]).toEqual(['pappdrive:https://sync.test:notes']);

    const b = device();
    await b.papp.ready;
    await b.papp.signIn('sagi@example.com', PW);
    expect(storedKey(b.store)).toBe(storedKey(a.store));
    expect(await errorOf(device().papp.signIn(EMAIL, 'wrong password!!'))).toMatchObject({ code: 'credentials' });
  });

  it('restores the session on ready, still asking for an unconfirmed recovery code', async () => {
    const server = startServer();
    const store = memoryStore();
    const { recoveryCode } = await device({ store }).papp.signUp(EMAIL, PW);
    const reloaded = device({ store });
    await reloaded.papp.ready;
    expect(reloaded.papp.signedIn).toBe(false);
    expect(await reloaded.papp.pendingSignUp()).toEqual({ email: 'sagi@example.com', recoveryCode });
    await reloaded.papp.confirmRecoveryCode();
    const again = device({ store });
    await again.papp.ready;
    expect(again.papp.signedIn).toBe(true);
    await again.papp.open({ mode: 'private' });
    await must(opened[0]).ctx.api.getDelta(null);
    expect(server.calls.slice(-2)).toEqual(['POST /auth/refresh', 'GET /delta']);
  });

  it('recovers with the code and sets a new password; the old one then fails', async () => {
    startServer();
    const { papp, store } = device();
    const { recoveryCode } = await papp.signUp(EMAIL, PW);
    const key = storedKey(store);
    const other = device();
    await other.papp.recover(EMAIL, recoveryCode.toLowerCase(), 'a brand new password');
    expect(storedKey(other.store)).toBe(key);
    expect(await errorOf(device().papp.signIn(EMAIL, PW))).toMatchObject({ code: 'credentials' });
    const third = device();
    await third.papp.signIn(EMAIL, 'a brand new password');
    expect(storedKey(third.store)).toBe(key);
    expect(await errorOf(device().papp.recover(EMAIL, '00000-00000-00000-00000-000000', 'a brand new password'))).toMatchObject({ code: 'credentials' });
  }, 30_000);

  it('setPassword changes the password on a signed-in device', async () => {
    const server = startServer();
    const { papp } = device();
    await papp.signUp(EMAIL, PW);
    await papp.confirmRecoveryCode();
    await papp.setPassword('another long password');
    expect(must(server.users.get('sagi@example.com')).params).toEqual(DEFAULT_ARGON2);
    await device().papp.signIn(EMAIL, 'another long password');
  }, 30_000);

  it('410 on refresh runs the gone flow and clears the key store', async () => {
    startServer();
    const a = device();
    await a.papp.signUp(EMAIL, PW);
    await a.papp.confirmRecoveryCode();
    const b = device();
    await b.papp.signIn(EMAIL, PW);
    const files = await b.papp.open({ mode: 'private' });
    expect(await b.papp.open({ mode: 'private' })).toBe(files);
    await a.papp.deleteAccount(PW);
    expect(a.store.data.size).toBe(0);
    await expect(must(opened[0]).ctx.noticeGone()).resolves.toBeUndefined();
    expect(must(opened[0]).folder.markDeleted).toHaveBeenCalledWith('account');
    expect(b.store.data.size).toBe(0);
    expect(b.papp.signedIn).toBe(false);
    expect(b.papp.files.status.deleted).toBe('account');
    expect(await errorOf(b.papp.open({ mode: 'private' }))).toMatchObject({ code: 'signed-out' });
  });

  it('deleteApp deletes the app on this device and others learn it on their next call', async () => {
    const server = startServer();
    const a = device();
    await a.papp.signUp(EMAIL, PW);
    await a.papp.confirmRecoveryCode();
    const fa = await a.papp.open({ mode: 'private' });
    const b = device();
    await b.papp.signIn(EMAIL, PW);
    await b.papp.open({ mode: 'visible', path: '/tmp/notes' });
    expect(await errorOf(a.papp.deleteApp('wrong password!!'))).toMatchObject({ code: 'credentials' });
    await a.papp.deleteApp(PW);
    expect(fa.status.deleted).toBe('app');
    expect(a.store.data.size).toBe(0);
    expect(a.papp.signedIn).toBe(false);
    server.expireNext = true;
    expect(await errorOf(must(opened[1]).ctx.api.getDelta(null))).toMatchObject({ code: 'gone', reason: 'app' });
    expect(must(opened[1]).folder.markDeleted).toHaveBeenCalledWith('app');
    expect(b.store.data.size).toBe(0);
  });

  it('openReadOnly: only names in read, uses ?app=, refuses writes', async () => {
    const server = startServer();
    const notes = device();
    await notes.papp.signUp(EMAIL, PW);
    await notes.papp.confirmRecoveryCode();
    const dash = device({ app: 'dash', read: ['notes'] });
    must(server.users.get('sagi@example.com')).apps.add('dash');
    await dash.papp.signIn(EMAIL, PW);
    const e = await errorOf(dash.papp.openReadOnly('journal'));
    expect(e.code).toBe('not-allowed');
    expect(e.message).toContain('read');
    const ro = await dash.papp.openReadOnly('notes');
    expect(await dash.papp.openReadOnly('notes')).toBe(ro);
    const { ctx } = must(opened[0]);
    expect(ctx).toMatchObject({ app: 'notes', readOnly: true });
    expect(dash.platform.openPrivate).toHaveBeenCalledWith(expect.stringMatching(/^user/), 'dash', 'notes');
    await ctx.api.getDelta(null);
    await ctx.api.getBlob('a'.repeat(64));
    expect(server.calls.slice(-2)).toEqual(['GET /delta?app=notes', `GET /blobs/${'a'.repeat(64)}?app=notes`]);
  });

  it('open twice at once starts one folder; close syncs and stops it but stays signed in', async () => {
    startServer();
    const { papp } = device();
    await papp.signUp(EMAIL, PW);
    await papp.confirmRecoveryCode();
    const [a, b] = await Promise.all([papp.open({ mode: 'private' }), papp.open({ mode: 'private' })]);
    expect(a).toBe(b);
    expect(opened).toHaveLength(1);
    await papp.close();
    expect(must(opened[0]).folder.sync).toHaveBeenCalled();
    expect(must(opened[0]).folder.close).toHaveBeenCalled();
    expect(papp.signedIn).toBe(true);
    expect(await papp.open({ mode: 'private' })).not.toBe(a);
  });

  it('close rejects when the last sync fails, and still closes the folder', async () => {
    startServer();
    const { papp } = device();
    await papp.signUp(EMAIL, PW);
    await papp.confirmRecoveryCode();
    await papp.open({ mode: 'private' });
    const { folder } = must(opened[0]);
    vi.mocked(folder.sync).mockRejectedValueOnce(new SyncError('network', 'The server is unreachable.'));
    const e = await papp.close().catch((err: unknown) => err);
    expect(e).toBeInstanceOf(AggregateError);
    expect((e as AggregateError).errors).toEqual([new SyncError('network', 'The server is unreachable.')]);
    expect(folder.close).toHaveBeenCalled();
  });

  it('signOut logs out, closes folders and deletes the key store entry', async () => {
    const server = startServer();
    const { papp, store } = device();
    await papp.signUp(EMAIL, PW);
    await papp.confirmRecoveryCode();
    await papp.open({ mode: 'private' });
    await papp.signOut();
    expect(server.calls).toContain('POST /auth/logout');
    expect(must(opened[0]).folder.close).toHaveBeenCalled();
    expect(store.data.size).toBe(0);
    expect(papp.signedIn).toBe(false);
  });

  it('a refresh token stopped on the server signs out locally', async () => {
    const server = startServer();
    server.accessSeconds = 0;
    const { papp, store } = device();
    await papp.signUp(EMAIL, PW);
    await papp.confirmRecoveryCode();
    server.installs.clear();
    expect(await errorOf(papp.open({ mode: 'private' }).then(() => must(opened[0]).ctx.api.getDelta(null)))).toMatchObject({ code: 'signed-out' });
    expect(store.data.size).toBe(0);
  });
});
