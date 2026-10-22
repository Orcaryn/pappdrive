import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/d1';
import { migrate } from 'drizzle-orm/d1/migrator';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkCredentials } from '../src/account/credentials';
import { activeWriter } from '../src/shared/access';
import { ACCESS_TOKEN_SECONDS, signToken, verifyToken } from '../src/shared/tokens';
import { ApiError, errorResponse } from '../src/shared/http';
import type { Env } from '../src/shared/env';
import { installs, users } from '../src/shared/schema';

const mf = new Miniflare({ modules: true, script: 'export default {}', d1Databases: ['DB'] });
const env = { DB: await mf.getD1Database('DB') } as Env;
const d = drizzle(env.DB);

beforeAll(() => migrate(d, { migrationsFolder: 'migrations' }));
afterAll(() => mf.dispose());

function user(id: string, over: Partial<typeof users.$inferInsert> = {}) {
  return d.insert(users).values({ id, email: `${id}@b.c`, loginHash: 'h', recoveryHash: 'h', m: 1, t: 1, p: 1, verified: 1, created: 0, ...over });
}

async function thrown(fn: () => unknown): Promise<ApiError> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ApiError) {
      return e;
    }

    throw e;
  }

  throw new Error('did not throw');
}

describe('activeWriter (upload links and commits)', () => {
  const writerFor = async (id: string, over: Partial<typeof installs.$inferInsert> = {}) => {
    await user(id);
    await d.insert(installs).values({ id, userId: id, app: 'notes', refreshHash: id, read: [], created: 0, ...over });

    return activeWriter(env, { sub: id, app: 'notes', install: id, read: [], exp: 0 });
  };

  it('answers 410 gone with the reason when a deletion stopped the install', async () => {
    for (const reason of ['app', 'account'] as const) {
      const res = errorResponse(await thrown(() => writerFor(`gone-${reason}`, { stopped: reason })));
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: 'gone', reason });
    }
  });

  it('410 wins over a signed-out refresh token', async () => {
    expect((await thrown(() => writerFor('gone-signed-out', { stopped: 'app', refreshHash: null }))).word).toBe('gone');
  });

  it('answers 401 expired after sign-out or for an unknown install', async () => {
    expect((await thrown(() => writerFor('signed-out', { refreshHash: null }))).word).toBe('expired');
    expect((await thrown(() => activeWriter(env, { sub: 'nobody', app: 'notes', install: 'nobody', read: [], exp: 0 }))).word).toBe('expired');
  });
});

describe('checkCredentials', () => {
  const key = new Uint8Array(32).fill(7);

  it('answers 401 credentials for a wrong key or an unknown email', async () => {
    await user('cred', { loginHash: createHash('sha256').update(key).digest('hex') });
    expect((await thrown(() => checkCredentials(env, 'cred@b.c', new Uint8Array(32), 'loginHash'))).word).toBe('credentials');
    expect((await thrown(() => checkCredentials(env, 'nobody@b.c', key, 'loginHash'))).word).toBe('credentials');
    expect((await checkCredentials(env, 'cred@b.c', key, 'loginHash')).id).toBe('cred');
  });
});

describe('access tokens', () => {
  const now = 1_760_000_000_000;
  const base = { sub: 'u1', app: 'notes', install: 'i1', read: ['my-notes'] };
  const claims = { ...base, exp: now / 1000 + ACCESS_TOKEN_SECONDS };

  it('are accepted under the old key during rotation, and refused under an unknown one', async () => {
    const t = await signToken(base, 'k-old', now);
    expect(await verifyToken(t, ['k-new', 'k-old'], now)).toEqual(claims);
    expect(await verifyToken(t, ['k-new', undefined], now)).toBeNull();
  });

  it('are refused once expired', async () => {
    expect(await verifyToken(await signToken(base, 'k', now), ['k'], claims.exp * 1000)).toBeNull();
  });

  it('are refused when tampered with', async () => {
    const t = await signToken(base, 'k', now);
    const [h, p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'u2' })).toString('base64url');
    expect(await verifyToken(`${h}.${forged}.${s}`, ['k'], now)).toBeNull();
    expect(await verifyToken('a.b', ['k'], now)).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(await verifyToken(`${none}.${p}.`, ['k'], now)).toBeNull();
  });
});

describe('errorResponse', () => {
  it('adds Retry-After to 429 and CORS to everything', () => {
    const res = errorResponse(new ApiError('rate-limited'));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
