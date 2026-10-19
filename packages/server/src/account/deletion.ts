import { keys } from '../shared/bucket';
import type { Env } from '../shared/env';
import { noContent } from '../shared/http';
import * as v from '../shared/validate';
import { appList } from './apps';
import { checkCredentials, rateLimit } from './credentials';

export async function deleteApp(env: Env, request: Request): Promise<Response> {
  const body = v.obj(await v.body(request));
  const email = v.email(body.email);
  await rateLimit(env, request, email);
  const app = v.appName(body.app);
  const user = await checkCredentials(env, email, v.keyBytes(body.loginKey), 'login_hash');

  await env.DB.prepare("UPDATE installs SET stopped = 'app' WHERE user_id = ? AND app = ? AND stopped IS NULL").bind(user.id, app).run();
  await env.FOLDER.getByName(`${user.id}/${app}`).deleteFolder();
  await env.DB.prepare('DELETE FROM apps WHERE user_id = ? AND name = ?').bind(user.id, app).run();

  return noContent();
}

const PARALLEL_FOLDERS = 6;

export async function deleteAccount(env: Env, request: Request): Promise<Response> {
  const body = v.obj(await v.body(request));
  const email = v.email(body.email);
  await rateLimit(env, request, email);
  const user = await checkCredentials(env, email, v.keyBytes(body.loginKey), 'login_hash');

  await env.DB.prepare("UPDATE installs SET stopped = 'account' WHERE user_id = ?").bind(user.id).run();
  await env.BUCKET.delete(keys.userKey(user.id));
  const apps = await accountApps(env, user.id);

  for (let i = 0; i < apps.length; i += PARALLEL_FOLDERS) {
    await Promise.all(apps.slice(i, i + PARALLEL_FOLDERS).map(app => env.FOLDER.getByName(`${user.id}/${app}`).deleteFolder()));
  }

  await env.DB.batch([env.DB.prepare('DELETE FROM apps WHERE user_id = ?').bind(user.id), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id)]);

  return noContent();
}

async function accountApps(env: Env, user: string): Promise<string[]> {
  const names = new Set((await appList(env, user)).map(a => a.name));
  const prefix = `${user}/`;
  let cursor: string | undefined = undefined;
  do {
    const page = await env.BUCKET.list({ prefix, delimiter: '/', cursor });

    for (const p of page.delimitedPrefixes) {
      names.add(p.slice(prefix.length, -1));
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return [...names];
}
