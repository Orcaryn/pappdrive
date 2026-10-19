import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import type { KeyStore } from '../../shared/types.js';
import { configDir } from '../../node/dirs.js';
import { nodeKeyStore } from '../../node/keystore.js';
import { createPrompter, type Prompter } from './prompt.js';
import type { Flags } from './args.js';
import { CliError } from './errors.js';

export interface Ctx {
  server: string;
  flags: Flags;
  config: CliConfig;
  keyStore: KeyStore;
  sessionName: string;
  prompter: Prompter;
  out: (line: string) => void;
  status: (line: string) => void;
}

interface CliConfig {
  server?: string;
  email?: string;
}

export async function createCtx(flags: Flags): Promise<Ctx> {
  const configText = await fsp.readFile(join(configDir(), 'cli.json'), 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') {
      return '{}';
    }

    throw e;
  });
  const config = JSON.parse(configText) as CliConfig;
  const server = resolveServer(flags.server, process.env.PAPPDRIVE_SERVER, config.server);
  let statusShown = false;

  return {
    server,
    flags,
    config,
    keyStore: nodeKeyStore(),
    sessionName: `pappdrive-cli:${server}`,
    prompter: createPrompter(),
    out(line) {
      if (statusShown) {
        process.stdout.write('\r\x1b[K');
      }

      statusShown = false;
      process.stdout.write(line + '\n');
    },
    status(line) {
      if (!process.stdout.isTTY) {
        return;
      }

      process.stdout.write('\r\x1b[K' + line);
      statusShown = line !== '';
    },
  };
}

export async function remember(ctx: Ctx, email: string): Promise<void> {
  const config: CliConfig = { server: ctx.server, email };
  await fsp
    .mkdir(configDir(), { recursive: true, mode: 0o700 })
    .then(() => fsp.writeFile(join(configDir(), 'cli.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 }))
    .catch((e: unknown) => ctx.out(`Could not save the server and email for next time (${String(e)}). Pass --server and --email next time.`));
}

function resolveServer(flag: string | undefined, env: string | undefined, saved: string | undefined): string {
  const raw = flag || env || saved;

  if (!raw) {
    throw new CliError('Which server? Pass --server https://sync.example.com, or set PAPPDRIVE_SERVER. After the first signup or login it is remembered.', 2);
  } else if (!URL.canParse(raw.trim())) {
    throw new CliError(`"${raw}" is not a server address. Give the full address, like --server https://sync.example.com.`, 2);
  }

  const url = new URL(raw.trim());

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CliError(`"${raw}" is not an http or https address. Use --server https://sync.example.com.`, 2);
  }

  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/+$/, '').replace(/\/v1$/, '');
}
