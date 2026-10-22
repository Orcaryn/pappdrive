import { readFileSync } from 'node:fs';
import { appsCreate, appsList } from './commands/apps.js';
import { login, logout, signup, verify } from './commands/account.js';
import { deleteAccount, deleteApp } from './commands/delete.js';
import { exportApp } from './commands/export/index.js';
import { HELP, parseArgs, type Command } from './shared/args.js';
import { createCtx, type Ctx } from './shared/context.js';
import { CliError, describeError } from './shared/errors.js';

const RUN: Record<Command, (ctx: Ctx, ...args: string[]) => Promise<void>> = {
  signup,
  verify,
  login,
  logout,
  'apps list': appsList,
  'apps create': appsCreate,
  export: exportApp,
  'delete-app': deleteApp,
  'delete-account': deleteAccount,
};

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (!(e instanceof CliError)) {
    throw e;
  }

  process.stderr.write(`${e.message}\n`);
  process.exitCode = e.exitCode;
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.command === 'help') {
    process.stdout.write(HELP);

    return 0;
  } else if (parsed.command === 'version') {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    process.stdout.write(`pappdrive ${version}\n`);

    return 0;
  }

  const { command, args, flags } = parsed;
  const ctx = await createCtx(flags);
  try {
    await RUN[command](ctx, ...args);

    return 0;
  } catch (e) {
    ctx.status('');
    process.stderr.write(`${describeError(e, ctx.server, flags.recovery ? 'recover' : command, flags.app ?? args[0])}\n`);

    return e instanceof CliError ? e.exitCode : 1;
  } finally {
    ctx.prompter.close();
  }
}
