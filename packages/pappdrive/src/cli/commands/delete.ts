import { deleteAccountWithPassword, deleteAppWithPassword } from '../../papp/account.js';
import { hashWasmArgon2 } from '../../shared/argon2.js';
import { CliError } from '../shared/errors.js';
import type { Ctx } from '../shared/context.js';
import { askEmail, withPassword } from '../shared/sign-in.js';

export async function deleteApp(ctx: Ctx, name: string): Promise<void> {
  ctx.out('');
  ctx.out(`  DELETE THE APP "${name}" AND ALL OF ITS FILES`);
  ctx.out('');
  ctx.out(`  This deletes "${name}"'s folder on the server and stops its sync on every device.`);
  ctx.out('  It is final: no copy is kept, nothing can bring it back.');
  ctx.out('  Visible folders stay on disk on each device; private stores are deleted.');
  ctx.out(`  Export it first if you want a copy: pappdrive export ${name} <folder>`);
  ctx.out('');
  const typed = await ctx.prompter.ask(`To delete it, type the app's name (${name}): `);

  if (typed !== name) {
    throw new CliError('The name did not match. Nothing was deleted.');
  }

  const email = await askEmail(ctx);
  await withPassword(ctx, pw => deleteAppWithPassword(ctx.server, hashWasmArgon2, email, pw, name));
  ctx.out(`Deleted the app "${name}". Its name is free again.`);
}

export async function deleteAccount(ctx: Ctx): Promise<void> {
  ctx.out('');
  ctx.out('  DELETE THE WHOLE ACCOUNT');
  ctx.out('');
  ctx.out("  This deletes every app and every file of this account on the server, and the account's key.");
  ctx.out('  Every device is signed out. It is final: no copy is kept, nothing can bring it back.');
  ctx.out('  Export each app first if you want a copy: pappdrive export <app> <folder>  (see `pappdrive apps list`)');
  ctx.out('');
  const email = await askEmail(ctx);
  const phrase = 'delete my account';
  const typed = await ctx.prompter.ask(`To delete ${email}, type "${phrase}": `);

  if (typed.toLowerCase() !== phrase) {
    throw new CliError('The words did not match. Nothing was deleted.');
  }

  await withPassword(ctx, pw => deleteAccountWithPassword(ctx.server, hashWasmArgon2, email, pw));
  await ctx.keyStore.delete(ctx.sessionName);
  ctx.out(`Deleted the account ${email} and all of its apps.`);
}
