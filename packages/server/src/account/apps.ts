import type { AppInfo } from '@pappdrive/protocol';
import { bearer } from '../shared/access';
import type { Env } from '../shared/env';
import { ApiError, json } from '../shared/http';
import * as v from '../shared/validate';

export async function listApps(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);

  return json(await appList(env, claims.sub));
}

export async function createApp(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  const name = v.appName(v.obj(await v.body(request)).name);
  const created = Date.now();
  const r = await env.DB.prepare('INSERT INTO apps (user_id, name, created) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)')
    .bind(claims.sub, name, created, claims.sub)
    .run()
    .catch((e: unknown) => {
      throw e instanceof Error && /UNIQUE constraint failed/.test(e.message) ? new ApiError('exists') : e;
    });

  if (r.meta.changes === 0) {
    throw new ApiError('gone', { reason: 'account' });
  }

  return json({ name, created } satisfies AppInfo, 201);
}

export async function appList(env: Env, user: string): Promise<AppInfo[]> {
  const r = await env.DB.prepare('SELECT name, created FROM apps WHERE user_id = ? ORDER BY name').bind(user).all<AppInfo>();

  return r.results;
}
