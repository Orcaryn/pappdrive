import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AccessClaims } from '@pappdrive/protocol';
import { checkCredentials, type UserRow } from '../src/account/credentials';
import { activeWriter, type InstallRow } from '../src/shared/access';
import { ACCESS_TOKEN_SECONDS, signToken, verifyToken } from '../src/shared/tokens';
import { ApiError, errorResponse } from '../src/shared/http';
import type { Env } from '../src/shared/env';

function env(found: UserRow | InstallRow | null): Env {
  return { DB: { prepare: () => ({ bind: () => ({ first: async () => found }) }) } } as unknown as Env;
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
  const claims = { sub: 'u1', app: 'notes', install: 'i1', read: [], exp: 0 };
  const row = (over: Partial<InstallRow> = {}): InstallRow => ({ id: 'i1', user_id: 'u1', app: 'notes', refresh_hash: 'h', read: '[]', stopped: null, ...over });
  const writerFor = (c: AccessClaims, found: InstallRow | null) => activeWriter(env(found), c);

  it('answers 410 gone with the reason when a deletion stopped the install', async () => {
    for (const reason of ['app', 'account'] as const) {
      const res = errorResponse(await thrown(() => writerFor(claims, row({ stopped: reason }))));
      expect(res.status).toBe(410);
      expect(await res.json()).toEqual({ error: 'gone', reason });
    }
  });

  it('410 wins over a signed-out refresh token', async () => {
    expect((await thrown(() => writerFor(claims, row({ stopped: 'app', refresh_hash: null })))).word).toBe('gone');
  });

  it('answers 401 expired after sign-out or for an unknown install', async () => {
    expect((await thrown(() => writerFor(claims, row({ refresh_hash: null })))).word).toBe('expired');
    expect((await thrown(() => writerFor(claims, null))).word).toBe('expired');
  });
});

describe('checkCredentials', () => {
  const key = new Uint8Array(32).fill(7);
  const user = { id: 'u1', login_hash: createHash('sha256').update(key).digest('hex') } as UserRow;

  it('answers 401 credentials for a wrong key or an unknown email', async () => {
    expect((await thrown(() => checkCredentials(env(user), 'a@b.c', new Uint8Array(32), 'login_hash'))).word).toBe('credentials');
    expect((await thrown(() => checkCredentials(env(null), 'a@b.c', key, 'login_hash'))).word).toBe('credentials');
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
