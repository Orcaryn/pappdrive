import { type AppInfo, HOSTED_SERVER } from '@pappdrive/protocol';
import { request } from '../../papp/http.js';
import type { Ctx } from '../shared/context.js';
import { accessToken } from '../shared/sign-in.js';

export async function appsList(ctx: Ctx): Promise<void> {
  const apps = await request<AppInfo[]>(ctx.server, 'GET', '/apps', undefined, await accessToken(ctx));

  if (apps.length === 0) {
    ctx.out('No apps yet. Create one with `pappdrive apps create <name>`.');

    return;
  }

  const width = Math.max(4, ...apps.map(a => a.name.length));
  ctx.out(`${'NAME'.padEnd(width)}  CREATED`);

  for (const a of apps.sort((x, y) => x.name.localeCompare(y.name))) {
    ctx.out(`${a.name.padEnd(width)}  ${new Date(a.created).toLocaleString()}`);
  }
}

export async function appsCreate(ctx: Ctx, name: string): Promise<void> {
  await request(ctx.server, 'POST', '/apps', { name }, await accessToken(ctx));
  ctx.out(`Created the app "${name}".`);
  const start = ctx.server === HOSTED_SERVER ? `createPapp({ app: "${name}" })` : `createPapp({ server: "${ctx.server}", app: "${name}" })`;
  ctx.out(`In the app: ${start}, then sign in with your email and password.`);
}
