import type { AppInfo } from '@pappdrive/protocol';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { bearer } from '../shared/access';
import type { Env } from '../shared/env';
import { ApiError, json } from '../shared/http';
import { apps, users } from '../shared/schema';
import * as v from '../shared/validate';

export async function listApps(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);

  return json(await appList(env, claims.sub));
}

export async function createApp(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  const name = v.appName(v.obj(await v.body(request)).name);
  const created = Date.now();
  const d = drizzle(env.DB);

  if (!(await d.select({ id: users.id }).from(users).where(eq(users.id, claims.sub)).get())) {
    throw new ApiError('gone', { reason: 'account' });
  }

  const r = await d.insert(apps).values({ userId: claims.sub, name, created }).onConflictDoNothing().run();

  if (r.meta.changes === 0) {
    throw new ApiError('exists');
  }

  return json({ name, created } satisfies AppInfo, 201);
}

export async function appList(env: Env, user: string): Promise<AppInfo[]> {
  return drizzle(env.DB).select({ name: apps.name, created: apps.created }).from(apps).where(eq(apps.userId, user)).orderBy(apps.name);
}
