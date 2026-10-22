import { DEFAULT_ARGON2, type LoginResponse, type ParamsResponse, type RecoverResponse, type RefreshResponse, type TokenResponse } from '@pappdrive/protocol';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { bearer } from '../shared/access';
import { keys } from '../shared/bucket';
import { fromBase64, sha256Hex, toBase64Url } from '../shared/bytes';
import type { Env } from '../shared/env';
import { ApiError, json, noContent } from '../shared/http';
import { apps, installs, users } from '../shared/schema';
import { signToken } from '../shared/tokens';
import * as v from '../shared/validate';
import { appList } from './apps';
import { checkCredentials, rateLimit, userByEmail } from './credentials';
import { sendCode } from './verify';

interface KeyFile {
  passwordCopy: string;
  recoveryCopy: string;
}

export async function passwordParams(env: Env, request: Request): Promise<Response> {
  const body = v.obj(await v.body(request));
  const email = v.email(body.email);
  await rateLimit(env, request, email);
  const user = await userByEmail(env, email);

  return json((user ? { m: user.m, t: user.t, p: user.p } : DEFAULT_ARGON2) satisfies ParamsResponse);
}

export async function signup(env: Env, request: Request): Promise<Response> {
  const body = v.obj(await v.body(request));
  const email = v.email(body.email);
  await rateLimit(env, request, email);
  const app = body.app === undefined ? '' : v.appName(body.app);
  const read = v.readList(body.read);
  const loginKey = v.keyBytes(body.loginKey);
  const recoveryLoginKey = v.keyBytes(body.recoveryLoginKey);
  const keyFile: KeyFile = { passwordCopy: v.lockedCopy(body.passwordCopy), recoveryCopy: v.lockedCopy(body.recoveryCopy) };

  if (await userByEmail(env, email)) {
    throw new ApiError('exists');
  } else if (read.some(name => name !== app)) {
    throw new ApiError('no-app');
  }

  const now = Date.now();
  const user = crypto.randomUUID();
  await sendCode(env, user, email);
  const install = await newInstall(env, user, app, read);

  await env.BUCKET.put(keys.userKey(user), JSON.stringify(keyFile));
  const d = drizzle(env.DB);
  const insertUser = d
    .insert(users)
    .values({ id: user, email, loginHash: await sha256Hex(loginKey), recoveryHash: await sha256Hex(recoveryLoginKey), ...DEFAULT_ARGON2, created: now });
  const insertApp = app ? [d.insert(apps).values({ userId: user, name: app, created: now })] : [];
  try {
    await d.batch([insertUser, ...insertApp, install.insert]);
  } catch (e) {
    await env.BUCKET.delete(keys.userKey(user));

    throw e instanceof Error && /UNIQUE constraint failed/.test(e.message) ? new ApiError('exists') : e;
  }

  return json(install.tokens);
}

export async function login(env: Env, request: Request): Promise<Response> {
  const { tokens, file } = await signIn(env, request, 'loginKey', 'loginHash');

  return json({ ...tokens, passwordCopy: file.passwordCopy } satisfies LoginResponse);
}

export async function recover(env: Env, request: Request): Promise<Response> {
  const { tokens, file } = await signIn(env, request, 'recoveryLoginKey', 'recoveryHash');

  return json({ ...tokens, recoveryCopy: file.recoveryCopy } satisfies RecoverResponse);
}

export async function refresh(env: Env, request: Request): Promise<Response> {
  const body = v.obj(await v.body(request));
  const raw = fromBase64(v.text(body.refreshToken));

  if (!raw || raw.length !== 32) {
    throw new ApiError('credentials');
  }

  const d = drizzle(env.DB);
  const row = await d
    .select()
    .from(installs)
    .where(eq(installs.refreshHash, await sha256Hex(raw)))
    .get();

  if (!row) {
    throw new ApiError('credentials');
  } else if (row.stopped) {
    throw new ApiError('gone', { reason: row.stopped });
  }

  const sent = body.read !== undefined;
  const read = sent ? v.readList(body.read) : row.read;

  if (sent) {
    await requireApps(env, row.userId, read);
    await d.update(installs).set({ read }).where(eq(installs.id, row.id));
  }

  return json({ accessToken: await signToken({ sub: row.userId, app: row.app, install: row.id, read }, env.TOKEN_KEY) } satisfies RefreshResponse);
}

export async function changePassword(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  const body = v.obj(await v.body(request));
  const loginKey = v.keyBytes(body.loginKey);
  const passwordCopy = v.lockedCopy(body.passwordCopy);
  const params = v.argon2Params(body.params);
  const file = await readKeyFile(env, claims.sub);
  await env.BUCKET.put(keys.userKey(claims.sub), JSON.stringify({ ...file, passwordCopy } satisfies KeyFile));
  const r = await drizzle(env.DB)
    .update(users)
    .set({ loginHash: await sha256Hex(loginKey), ...params })
    .where(eq(users.id, claims.sub))
    .run();

  if (r.meta.changes === 0) {
    throw new ApiError('gone', { reason: 'account' });
  }

  return noContent();
}

export async function logout(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  await drizzle(env.DB)
    .update(installs)
    .set({ refreshHash: null })
    .where(and(eq(installs.id, claims.install), eq(installs.userId, claims.sub)));

  return noContent();
}

async function signIn(
  env: Env,
  request: Request,
  keyField: 'loginKey' | 'recoveryLoginKey',
  hashColumn: 'loginHash' | 'recoveryHash'
): Promise<{ tokens: TokenResponse; file: KeyFile }> {
  const body = v.obj(await v.body(request));
  const email = v.email(body.email);
  await rateLimit(env, request, email);
  const app = body.app === undefined ? '' : v.appName(body.app);
  const read = v.readList(body.read);
  const user = await checkCredentials(env, email, v.keyBytes(body[keyField]), hashColumn);

  await requireApps(env, user.id, app ? [app, ...read] : read);
  const file = await readKeyFile(env, user.id);
  const install = await newInstall(env, user.id, app, read);
  await install.insert.run();

  return { tokens: install.tokens, file };
}

async function newInstall(env: Env, user: string, app: string, read: string[]) {
  const refreshBytes = crypto.getRandomValues(new Uint8Array(32));
  const id = crypto.randomUUID();
  const insert = drizzle(env.DB)
    .insert(installs)
    .values({ id, userId: user, app, refreshHash: await sha256Hex(refreshBytes), read, created: Date.now() });
  const tokens: TokenResponse = { accessToken: await signToken({ sub: user, app, install: id, read }, env.TOKEN_KEY), refreshToken: toBase64Url(refreshBytes), installId: id };

  return { insert, tokens };
}

async function requireApps(env: Env, user: string, names: string[]): Promise<void> {
  if (names.length === 0) {
    return;
  }

  const have = new Set((await appList(env, user)).map(a => a.name));

  if (names.some(name => !have.has(name))) {
    throw new ApiError('no-app');
  }
}

async function readKeyFile(env: Env, user: string): Promise<KeyFile> {
  const file = await env.BUCKET.get(keys.userKey(user));

  if (!file) {
    throw new ApiError('gone', { reason: 'account' });
  }

  return file.json<KeyFile>();
}
