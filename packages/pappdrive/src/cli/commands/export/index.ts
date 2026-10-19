import * as fsp from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TokenResponse } from '@pappdrive/protocol';
import { openNodeFs } from '../../../node/fs.js';
import { nodePlatform } from '../../../node/platform.js';
import { logInWithPassword, logInWithRecoveryCode } from '../../../papp/account.js';
import { createApi } from '../../../papp/api.js';
import { openFolder } from '../../../papp/folder/index.js';
import { request } from '../../../papp/http.js';
import { dataKeys } from '../../../shared/crypto.js';
import { HIDDEN_DIR } from '../../../shared/paths.js';
import { parseRecoveryCode } from '../../../shared/recovery-code.js';
import type { Ctx } from '../../shared/context.js';
import { CliError, describeError } from '../../shared/errors.js';
import { askEmail, withPassword } from '../../shared/sign-in.js';

export async function exportApp(ctx: Ctx, app: string, dir: string): Promise<void> {
  const target = resolve(dir);
  await assertEmptyOrUnfinished(target);
  ctx.out(`Exporting "${app}" from ${ctx.server} into ${target}.`);
  const email = await askEmail(ctx);
  const session = await unlockAccount(ctx, email, app);
  const api = createApi(ctx.server, [app], { onGone: async () => {}, onSignedOut: async () => {} });
  api.setSession(session.refreshToken, session.accessToken);
  const folder = openFolder({
    app,
    readOnly: true,
    fs: await openNodeFs(target, 'private'),
    keys: await dataKeys(session.dataKey),
    api: api.folderApi(app, true),
    platform: nodePlatform,
    checkGone: async () => 'ok',
  });
  let landed = 0;
  folder.watch(() => ctx.status(`${++landed} files`));

  try {
    await folder.start();
    await folder.sync();
  } finally {
    await folder.close();
    ctx.status('');
    await request(ctx.server, 'POST', '/auth/logout', undefined, session.accessToken).catch((e: unknown) =>
      ctx.out(`The export's sign-in could not be stopped on the server (${describeError(e, ctx.server)}). It stops when the password changes.`)
    );
  }

  const { error, skipped } = folder.status;

  for (const path of skipped) {
    ctx.out(`  skipped ${path}: this system cannot create that name`);
  }

  if (error !== null) {
    throw new CliError(`Some files could not be exported: ${error} Run the same command again; finished files are kept.`);
  }

  await fsp.rm(join(target, HIDDEN_DIR), { recursive: true, force: true });
  const entries = await fsp.readdir(target);

  if (entries.length === 0) {
    ctx.out(`"${app}" has no files yet: its folder was never synced, or it was deleted. Nothing to export.`);
  } else {
    ctx.out(`Exported "${app}" into ${target}.${skipped.length ? ` ${skipped.length} files were skipped; export on a system that can create those names to get them.` : ''}`);
  }
}

async function assertEmptyOrUnfinished(dir: string): Promise<void> {
  const names = await fsp.readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') {
      return [];
    } else if (e.code === 'ENOTDIR') {
      throw new CliError(`"${dir}" is a file. Give export a folder to write into.`);
    }

    throw e;
  });

  if (names.some(n => n !== HIDDEN_DIR && n !== '.DS_Store')) {
    throw new CliError(`"${dir}" is not empty. Export into a new or empty folder.`);
  }
}

async function unlockAccount(ctx: Ctx, email: string, app: string): Promise<TokenResponse & { dataKey: Uint8Array }> {
  if (!ctx.flags.recovery) {
    return withPassword(ctx, pw => logInWithPassword(ctx.server, email, pw, { read: [app] }));
  }

  const code = await ctx.prompter.ask('Recovery code: ');
  ctx.status('Checking the recovery code...');

  try {
    return await logInWithRecoveryCode(ctx.server, email, parseRecoveryCode(code), { read: [app] });
  } finally {
    ctx.status('');
  }
}
