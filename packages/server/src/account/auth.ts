import { DEFAULT_ARGON2, type LoginResponse, type ParamsResponse, type RecoverResponse, type RefreshResponse, type TokenResponse } from '@pappdrive/protocol';
import { bearer, type InstallRow } from '../shared/access';
import { keys } from '../shared/bucket';
import { fromBase64, sha256Hex, toBase64Url } from '../shared/bytes';
import type { Env } from '../shared/env';
import { ApiError, json, noContent } from '../shared/http';
import { signToken } from '../shared/tokens';
import * as v from '../shared/validate';
import { appList } from './apps';
import { checkCredentials, rateLimit, userByEmail } from './credentials';

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
  const install = await newInstall(env, user, app, read);

  await env.BUCKET.put(keys.userKey(user), JSON.stringify(keyFile));
  const insertUser = env.DB.prepare('INSERT INTO users (id, email, login_hash, recovery_hash, m, t, p, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
    user,
    email,
    await sha256Hex(loginKey),
    await sha256Hex(recoveryLoginKey),
    DEFAULT_ARGON2.m,
    DEFAULT_ARGON2.t,
    DEFAULT_ARGON2.p,
    now
  );
  const insertApp = app ? [env.DB.prepare('INSERT INTO apps (user_id, name, created) VALUES (?, ?, ?)').bind(user, app, now)] : [];
  try {
    await env.DB.batch([insertUser, ...insertApp, install.insert]);
  } catch (e) {
    await env.BUCKET.delete(keys.userKey(user));

    throw e instanceof Error && /UNIQUE constraint failed/.test(e.message) ? new ApiError('exists') : e;
  }

  return json(install.tokens);
}

export async function login(env: Env, request: Request): Promise<Response> {
  const { tokens, file } = await signIn(env, request, 'loginKey', 'login_hash');

  return json({ ...tokens, passwordCopy: file.passwordCopy } satisfies LoginResponse);
}

export async function recover(env: Env, request: Request): Promise<Response> {
  const { tokens, file } = await signIn(env, request, 'recoveryLoginKey', 'recovery_hash');

  return json({ ...tokens, recoveryCopy: file.recoveryCopy } satisfies RecoverResponse);
}

export async function refresh(env: Env, request: Request): Promise<Response> {
  const body = v.obj(await v.body(request));
  const raw = fromBase64(v.text(body.refreshToken));

  if (!raw || raw.length !== 32) {
    throw new ApiError('credentials');
  }

  const row = await env.DB.prepare('SELECT * FROM installs WHERE refresh_hash = ?')
    .bind(await sha256Hex(raw))
    .first<InstallRow>();

  if (!row) {
    throw new ApiError('credentials');
  } else if (row.stopped) {
    throw new ApiError('gone', { reason: row.stopped });
  }

  const sent = body.read !== undefined;
  const read = sent ? v.readList(body.read) : (JSON.parse(row.read) as string[]);

  if (sent) {
    await requireApps(env, row.user_id, read);
    await env.DB.prepare('UPDATE installs SET read = ? WHERE id = ?').bind(JSON.stringify(read), row.id).run();
  }

  return json({ accessToken: await signToken({ sub: row.user_id, app: row.app, install: row.id, read }, env.TOKEN_KEY) } satisfies RefreshResponse);
}

export async function changePassword(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  const body = v.obj(await v.body(request));
  const loginKey = v.keyBytes(body.loginKey);
  const passwordCopy = v.lockedCopy(body.passwordCopy);
  const params = v.argon2Params(body.params);
  const file = await readKeyFile(env, claims.sub);
  await env.BUCKET.put(keys.userKey(claims.sub), JSON.stringify({ ...file, passwordCopy } satisfies KeyFile));
  const r = await env.DB.prepare('UPDATE users SET login_hash = ?, m = ?, t = ?, p = ? WHERE id = ?')
    .bind(await sha256Hex(loginKey), params.m, params.t, params.p, claims.sub)
    .run();

  if (r.meta.changes === 0) {
    throw new ApiError('gone', { reason: 'account' });
  }

  return noContent();
}

export async function logout(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  await env.DB.prepare('UPDATE installs SET refresh_hash = NULL WHERE id = ? AND user_id = ?').bind(claims.install, claims.sub).run();

  return noContent();
}

async function signIn(
  env: Env,
  request: Request,
  keyField: 'loginKey' | 'recoveryLoginKey',
  hashColumn: 'login_hash' | 'recovery_hash'
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
  const insert = env.DB.prepare('INSERT INTO installs (id, user_id, app, refresh_hash, read, stopped, created) VALUES (?, ?, ?, ?, ?, NULL, ?)').bind(
    id,
    user,
    app,
    await sha256Hex(refreshBytes),
    JSON.stringify(read),
    Date.now()
  );
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
