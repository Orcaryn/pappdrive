import { parseArgs as parseArgv } from 'node:util';
import { APP_NAME_RE } from '@pappdrive/protocol';
import { CliError } from './errors.js';

export type Command = 'signup' | 'verify' | 'login' | 'logout' | 'apps list' | 'apps create' | 'export' | 'delete-app' | 'delete-account';

export interface Flags {
  server?: string;
  email?: string;
  app?: string;
  recovery?: boolean;
}

type Parsed = { command: 'help' } | { command: 'version' } | { command: Command; args: string[]; flags: Flags };

const OPTIONS = {
  server: { type: 'string' },
  email: { type: 'string' },
  app: { type: 'string' },
  recovery: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;
const EXAMPLE: Record<string, string> = { server: 'https://sync.pappdrive.com', email: 'me@example.com', app: 'my-notes' };
const COMMANDS: Record<Command, { args: string[]; flags: string[] }> = {
  signup: { args: [], flags: ['server', 'email', 'app'] },
  verify: { args: [], flags: ['server'] },
  login: { args: [], flags: ['server', 'email'] },
  logout: { args: [], flags: ['server'] },
  'apps list': { args: [], flags: ['server', 'email'] },
  'apps create': { args: ['name'], flags: ['server', 'email'] },
  export: { args: ['app', 'dir'], flags: ['server', 'email', 'recovery'] },
  'delete-app': { args: ['name'], flags: ['server', 'email'] },
  'delete-account': { args: [], flags: ['server', 'email'] },
};

export function parseArgs(argv: string[]): Parsed {
  const { tokens, positionals: words } = parseArgv({ args: argv, options: OPTIONS, allowPositionals: true, strict: false, tokens: true });
  const flags: Flags & { help?: boolean; version?: boolean } = {};

  for (const t of tokens) {
    if (t.kind !== 'option') {
      continue;
    } else if (!Object.hasOwn(OPTIONS, t.name)) {
      throw new CliError(`Unknown option ${t.rawName}. Run \`pappdrive help\` to see the options.`, 2);
    } else if (OPTIONS[t.name as keyof typeof OPTIONS].type === 'string') {
      if (!t.value || t.value.startsWith('--')) {
        throw new CliError(`--${t.name} needs a value, like --${t.name} ${EXAMPLE[t.name]}.`, 2);
      }

      flags[t.name as 'server' | 'email' | 'app'] = t.value;
    } else {
      if (t.value !== undefined) {
        throw new CliError(`--${t.name} takes no value. Write just --${t.name}.`, 2);
      }

      flags[t.name as 'recovery' | 'help' | 'version'] = true;
    }
  }

  const [first, ...args] = words;

  if (flags.version) {
    return { command: 'version' };
  } else if (flags.help || first === undefined || first === 'help') {
    return { command: 'help' };
  }

  const sub = first === 'apps' ? args.shift() : undefined;

  if (first === 'apps' && sub !== 'list' && sub !== 'create') {
    throw new CliError(
      sub === undefined ?
        '`pappdrive apps` needs a subcommand: `pappdrive apps list` or `pappdrive apps create <name>`.'
      : `Unknown subcommand "apps ${sub}". Use \`pappdrive apps list\` or \`pappdrive apps create <name>\`.`,
      2
    );
  }

  const name = first === 'apps' ? `apps ${String(sub)}` : first;

  if (!Object.hasOwn(COMMANDS, name)) {
    throw new CliError(`Unknown command "${name}". Run \`pappdrive help\` to see the commands.`, 2);
  }

  const command = name as Command;
  const spec = COMMANDS[command];

  if (args.length !== spec.args.length) {
    const usage = `pappdrive ${command}${spec.args.map(a => ` <${a}>`).join('')}`;

    throw new CliError(
      args.length < spec.args.length ?
        `Missing ${spec.args
          .slice(args.length)
          .map(a => `<${a}>`)
          .join(' and ')}. Usage: ${usage}`
      : `Too many arguments: ${args.slice(spec.args.length).join(' ')}. Usage: ${usage}`,
      2
    );
  }

  for (const f of Object.keys(flags)) {
    if (!spec.flags.includes(f)) {
      throw new CliError(`\`pappdrive ${command}\` does not take --${f}.`, 2);
    }
  }

  const app = args[0] ?? flags.app;

  if (app !== undefined && !APP_NAME_RE.test(app)) {
    throw new CliError(`"${app}" is not a valid app name. Use lowercase letters, digits, - and _, 1 to 64 characters, like my-notes.`, 2);
  }

  return { command, args, flags };
}

export const HELP = `pappdrive: accounts, apps and exports for pappdrive sync.

Usage:
  pappdrive signup [--email <email>] [--app <name>]   create an account (and an app)
  pappdrive verify                                    confirm the email address with a new code
  pappdrive login [--email <email>]                   sign in on this computer
  pappdrive logout                                    sign out on this computer
  pappdrive apps list                                 the apps in your account
  pappdrive apps create <name>                        create an app (lowercase letters, digits, -, _)
  pappdrive export <app> <dir> [--recovery]           download and decrypt an app's whole folder into an empty folder
  pappdrive delete-app <name>                         delete an app's folder everywhere, for good
  pappdrive delete-account                            delete the account and every app, for good

Options:
  --server <url>   a self-hosted sync server. Default: $PAPPDRIVE_SERVER, the one used last, or the hosted service
  --email <email>  the account's email. Default: the one used last
  --recovery       export: use the recovery code instead of the password

The server and email used last are kept in ~/.config/pappdrive/cli.json.
The sign-in is kept in the system keychain. No password is stored.
When stdin is not a terminal, the questions read their answers from it, one per line.
`;
