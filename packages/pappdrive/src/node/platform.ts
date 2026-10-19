import { homedir } from 'node:os';
import * as fsp from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { HIDDEN_DIR } from '../shared/paths.js';
import { SyncError } from '../shared/errors.js';
import type { FsAdapter, Platform } from '../shared/platform.js';
import { dataDir } from './dirs.js';
import { ifMissing, makeDir, openNodeFs } from './fs.js';
import { onProcessEnd } from './process-end.js';

export const nodePlatform: Platform = {
  openPrivate: (userId, app, readFor) => openNodeFs(privateStorePath(userId, app, readFor), 'private'),
  openVisible: openVisibleFolder,
  onBackground: onProcessEnd,
};

export function privateStorePath(userId: string, app: string, readFor?: string): string {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(userId)) {
    throw new SyncError('bad-path', `The user id "${userId}" cannot be used as a folder name. This is a bug in pappdrive; please report it.`);
  }

  const base = join(dataDir(), userId);

  return readFor === undefined ? join(base, app) : join(base, `${app}.read`, readFor);
}

function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  } else if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2));
  }

  return resolve(path);
}

export async function openVisibleFolder(path: string): Promise<FsAdapter> {
  const abs = expandHome(path);
  const above = await folderAbove(abs);

  if (above !== null) {
    throw new SyncError(
      'folder-taken',
      `"${abs}" is inside "${above}", which is already a synced app folder (it has a ${HIDDEN_DIR}/ folder). ` +
        `Two apps syncing the same files would never agree. Open a folder outside "${above}". ` +
        `To use that app's files, open them read-only with papp.openReadOnly("<that app>").`
    );
  }

  await makeDir(abs, () => new SyncError('bad-path', `"${abs}" is a file, not a folder. Give open() a folder path.`));

  return openNodeFs(abs, 'visible');
}

async function folderAbove(abs: string): Promise<string | null> {
  for (let d = dirname(abs); ; d = dirname(d)) {
    const hidden = await ifMissing(fsp.stat(join(d, HIDDEN_DIR)), null);

    if (hidden?.isDirectory()) {
      return d;
    } else if (dirname(d) === d) {
      return null;
    }
  }
}
