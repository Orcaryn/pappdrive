import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type DeltaFile, type IndexBody, type IndexFile, PART_SIZE, type SignupRequest } from '@pappdrive/protocol';
import { fromBase64 } from '../src/shared/bytes.js';
import { hashWasmArgon2 } from '../src/shared/argon2.js';
import * as c from '../src/shared/crypto.js';
import type { KeyStore } from '../src/shared/types.js';
import type { Prompter } from '../src/cli/shared/prompt.js';
import { signup } from '../src/cli/commands/account.js';
import { exportApp } from '../src/cli/commands/export/index.js';
import type { Ctx } from '../src/cli/shared/context.js';

const scratch: string[] = [];

const tmp = (label: string) => {
  const d = mkdtempSync(join(tmpdir(), `pappdrive-cli-${label}-`));
  scratch.push(d);

  return d;
};

const savedXdg = process.env.XDG_CONFIG_HOME;
beforeAll(() => {
  process.env.XDG_CONFIG_HOME = tmp('config');
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(() => {
  if (savedXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = savedXdg;
  }

  scratch.forEach(d => rmSync(d, { recursive: true, force: true }));
});

const FAST_ARGON2_PARAMS = { m: 256, t: 1, p: 1 };
const PASSWORD = 'correct horse battery staple';
const EMAIL = 'me@example.com';

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface Fake {
  requests: string[];
  setFolder(index: IndexFile, delta: DeltaFile, blobs: Map<string, Uint8Array>): void;
  signup?: SignupRequest;
  verifyCode?: string;
}

function fakeServer(passwordCopy = ''): Fake {
  let folder: { index: IndexFile; delta: DeltaFile } | null = null;
  let blobs = new Map<string, Uint8Array>();
  const fake: Fake = {
    requests: [],
    setFolder(index, delta, b) {
      folder = { index, delta };
      blobs = b;
    },
  };
  const accessToken = `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: 'u1', app: '', install: 'i1', read: ['my-notes'], exp: Math.floor(Date.now() / 1000) + 3600 }))}.sig`;

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    const route = url.pathname.replace(/^\/v1/, '') + url.search;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    fake.requests.push(route);
    const blob = /^\/blobs\/([0-9a-f]{64})\?app=my-notes$/.exec(route)?.[1];

    if (route === '/auth/params') {
      return json(FAST_ARGON2_PARAMS);
    } else if (route === '/auth/signup') {
      fake.signup = body;

      return json({ accessToken, refreshToken: 'ref', installId: 'i1' });
    } else if (route === '/auth/login') {
      return json({ accessToken, refreshToken: 'ref', installId: 'i1', passwordCopy });
    } else if (route === '/auth/verify') {
      fake.verifyCode = body.code;

      return new Response(null, { status: 204 });
    } else if (route === '/auth/logout') {
      return new Response(null, { status: 204 });
    } else if (route === '/delta?app=my-notes') {
      return folder ?
          new Response(JSON.stringify(folder.delta), { status: 200, headers: { ETag: '"e1"', 'content-type': 'application/json' } })
        : new Response(null, { status: 404 });
    } else if (folder && route === `/index/${folder.delta.base}?app=my-notes`) {
      return new Response(JSON.stringify(folder.index), { status: 200, headers: { 'content-type': 'application/json' } });
    } else if (blob !== undefined) {
      const b = blobs.get(blob);

      return b ? new Response(new Uint8Array(b)) : json({ error: 'missing', missing: [blob] }, 422);
    }

    return json({ error: 'bad-request' }, 400);
  };

  vi.stubGlobal('fetch', fakeFetch);

  return fake;
}

function memoryKeyStore(): KeyStore {
  const data = new Map<string, string>();

  return { get: async n => data.get(n) ?? null, set: async (n, v) => void data.set(n, v), delete: async n => void data.delete(n) };
}

function fakePrompter(answer: (q: string) => string): Prompter {
  return { ask: async q => answer(q), askHidden: async q => answer(q), close: () => {} };
}

function ctxFor(prompter: Prompter, flags: Ctx['flags'] = {}): Ctx & { lines: string[] } {
  const lines: string[] = [];

  return {
    server: 'https://sync.test',
    flags,
    config: {},
    keyStore: memoryKeyStore(),
    sessionName: 'pappdrive-cli:https://sync.test',
    prompter,
    out: l => void lines.push(l),
    status: () => {},
    lines,
  };
}

describe('commands against a fake server', () => {
  it("signup requires the code's last group before creating the account, then sends the keys and locked copies and saves the sign-in", async () => {
    const fake = fakeServer();
    const p = fakePrompter(q => {
      if (q.startsWith('Email')) {
        return 'Me@Example.com';
      } else if (q.startsWith('Password') || q.startsWith('Type it again')) {
        return PASSWORD;
      } else if (q.includes('last group')) {
        expect(fake.signup).toBeUndefined();
        const said = ctx.lines.join('\n');
        const lastGroup = /[0-9A-Z]{5}(?:-[0-9A-Z]{5}){3}-([0-9A-Z]{6})/.exec(said)?.[1] ?? '';

        return said.includes('does not match') ? lastGroup.toLowerCase() : 'nope';
      } else if (q.startsWith('Code from the email')) {
        return '123456';
      }

      throw new Error(`unexpected question ${q}`);
    });
    const ctx = ctxFor(p, { app: 'my-notes' });
    await signup(ctx);
    const s = fake.signup as SignupRequest;
    expect(s.email).toBe(EMAIL);
    expect(s.app).toBe('my-notes');
    expect(s.read).toEqual([]);
    expect(fromBase64(s.loginKey).length).toBe(32);
    expect(fromBase64(s.recoveryLoginKey).length).toBe(32);
    const pk = await c.deriveFromPassword(hashWasmArgon2, EMAIL, PASSWORD, FAST_ARGON2_PARAMS);
    expect((await c.unlockDataKey(s.passwordCopy, pk.passwordKey)).length).toBe(32);
    expect(ctx.lines).toContain('That does not match. Look at the code above and type the characters after its last dash.');
    expect(ctx.lines).toContain('Recovery code confirmed.');
    expect(await ctx.keyStore.get(ctx.sessionName)).toBe('ref');
    expect(ctx.lines.join('\n')).toContain('The app "my-notes" is created');
    expect(fake.verifyCode).toBe('123456');
    expect(ctx.lines).toContain('Email confirmed.');
  });
});

describe('export', async () => {
  const dataKey = c.randomBytes(32);
  const keys = await c.dataKeys(dataKey);
  const pk = await c.deriveFromPassword(hashWasmArgon2, EMAIL, PASSWORD, FAST_ARGON2_PARAMS);
  const passwordCopy = await c.lockDataKey(dataKey, pk.passwordKey);
  const blobs = new Map<string, Uint8Array>();
  const header: Record<string, number> = {};

  const put = async (pt: Uint8Array) => {
    const id = await c.blobId(keys, pt);
    const blob = await c.encryptBlob(keys, pt);
    blobs.set(id, blob);
    header[id] = blob.length;

    return id;
  };

  const big = new Uint8Array(PART_SIZE + 5);

  for (let i = 0; i < big.length; i += 4096) {
    big[i] = (i / 4096) & 0xff;
  }

  const parts = [await put(big.subarray(0, PART_SIZE)), await put(big.subarray(PART_SIZE))];
  const small = new TextEncoder().encode('hello');
  const smallId = await put(small);
  const mtime = 1760690000000;
  const body: IndexBody = {
    'notes/todo.md': { id: smallId, size: 5, mtime },
    'empty.txt': { id: await put(new Uint8Array(0)), size: 0, mtime },
    ['Café/thé.md'.normalize('NFC')]: { id: await put(small), size: 5, mtime },
    'video/talk.bin': { id: await c.bigFileId(keys, parts), size: big.length, mtime, parts },
  };
  const base = 'b'.repeat(64);
  const index: IndexFile = { v: 1, blobs: header, body: await c.encodeBody(keys, { kind: 'index', app: 'my-notes', base }, body) };
  const delta: DeltaFile = { v: 1, base, blobs: {}, body: await c.encodeBody(keys, { kind: 'delta', app: 'my-notes', base }, { seq: 1, ops: {} }) };
  const run = (dir: string) => exportApp(ctxFor(fakePrompter(q => (q.startsWith('Email') ? EMAIL : PASSWORD))), 'my-notes', dir);

  it('downloads and decrypts every file, big files in parts, and leaves no hidden folder behind', async () => {
    const fake = fakeServer(passwordCopy);
    fake.setFolder(index, delta, blobs);
    const dir = join(tmp('export'), 'out');
    await run(dir);
    expect(readFileSync(join(dir, 'notes', 'todo.md'), 'utf8')).toBe('hello');
    expect(readFileSync(join(dir, 'empty.txt')).length).toBe(0);
    expect(readFileSync(join(dir, 'Café'.normalize('NFC'), 'thé.md'.normalize('NFC')), 'utf8')).toBe('hello');
    expect(Buffer.compare(readFileSync(join(dir, 'video', 'talk.bin')), Buffer.from(big))).toBe(0);
    expect(readdirSync(dir).sort()).toEqual(['Café'.normalize('NFC'), 'empty.txt', 'notes', 'video']);
    expect(fake.requests).toContain('/delta?app=my-notes');
    expect(fake.requests).toContain(`/index/${'b'.repeat(64)}?app=my-notes`);
    expect(fake.requests.at(-1)).toBe('/auth/logout');
  });

  it('refuses a folder that is not empty', async () => {
    fakeServer(passwordCopy);
    const dir = tmp('export-full');
    writeFileSync(join(dir, 'other.txt'), 'x');
    await expect(run(dir)).rejects.toThrow(/not empty/);
  });

  it('reports a blob that does not match its id, and keeps the rest', async () => {
    const fake = fakeServer(passwordCopy);
    const tampered = new Map(blobs).set(smallId, await c.encryptBlob(keys, new TextEncoder().encode('other')));
    fake.setFolder(index, delta, tampered);
    const dir = join(tmp('export-bad'), 'out');
    await expect(run(dir)).rejects.toThrow(/could not be exported/);
    expect(readFileSync(join(dir, 'empty.txt')).length).toBe(0);
    expect(readdirSync(join(dir, 'video'))).toEqual(['talk.bin']);
  });
});
