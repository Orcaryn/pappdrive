import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { keys } from '../shared/bucket';
import type { Env } from '../shared/env';
import { noContent } from '../shared/http';
import { apps, installs, users } from '../shared/schema';
import * as v from '../shared/validate';
import { appList } from './apps';
import { checkCredentials, rateLimit } from './credentials';

export async function deleteApp(env: Env, request: Request): Promise<Response> {
  const body = v.obj(await v.body(request));
  const email = v.email(body.email);
  await rateLimit(env, request, email);
  const app = v.appName(body.app);
  const user = await checkCredentials(env, email, v.keyBytes(body.loginKey), 'loginHash');
  const d = drizzle(env.DB);

  await d
    .update(installs)
    .set({ stopped: 'app' })
    .where(and(eq(installs.userId, user.id), eq(installs.app, app), isNull(installs.stopped)));
  await env.FOLDER.getByName(`${user.id}/${app}`).deleteFolder();
  await d.delete(apps).where(and(eq(apps.userId, user.id), eq(apps.name, app)));

  return noContent();
}

const PARALLEL_FOLDERS = 6;

export async function deleteAccount(env: Env, request: Request): Promise<Response> {
  const body = v.obj(await v.body(request));
  const email = v.email(body.email);
  await rateLimit(env, request, email);
  const user = await checkCredentials(env, email, v.keyBytes(body.loginKey), 'loginHash');
  const d = drizzle(env.DB);

  await d.update(installs).set({ stopped: 'account' }).where(eq(installs.userId, user.id));
  await env.BUCKET.delete(keys.userKey(user.id));
  const appNames = new Set((await appList(env, user.id)).map(a => a.name));
  const prefix = `${user.id}/`;
  let cursor: string | undefined = undefined;
  do {
    const page = await env.BUCKET.list({ prefix, delimiter: '/', cursor });

    for (const p of page.delimitedPrefixes) {
      appNames.add(p.slice(prefix.length, -1));
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const folders = [...appNames];

  for (let i = 0; i < folders.length; i += PARALLEL_FOLDERS) {
    await Promise.all(folders.slice(i, i + PARALLEL_FOLDERS).map(app => env.FOLDER.getByName(`${user.id}/${app}`).deleteFolder()));
  }

  await d.batch([d.delete(apps).where(eq(apps.userId, user.id)), d.delete(users).where(eq(users.id, user.id))]);

  return noContent();
}
