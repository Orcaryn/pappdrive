import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;

  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config'), 'pappdrive');
}

export function dataDir(): string {
  const env = process.env;

  if (env.PAPPDRIVE_DATA_DIR) {
    return resolve(env.PAPPDRIVE_DATA_DIR);
  } else if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'pappdrive');
  } else if (process.platform === 'win32') {
    return join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'pappdrive');
  }

  const xdg = env.XDG_DATA_HOME;

  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'share'), 'pappdrive');
}
