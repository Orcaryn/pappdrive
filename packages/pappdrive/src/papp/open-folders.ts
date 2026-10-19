import { fromBase64 } from '../shared/bytes.js';
import { dataKeys } from '../shared/crypto.js';
import { SyncError } from '../shared/errors.js';
import type { FsAdapter, Platform } from '../shared/platform.js';
import type { Api } from './api.js';
import { signedOut } from './errors.js';
import { openFolder } from './folder/index.js';
import type { Folder } from './folder/shared/types.js';

const OWN_FOLDER_KEY = '';

export function createOpenFolders(api: Api, platform: Platform) {
  const folders = new Map<string, Promise<Folder>>();

  async function open(dataKey: string, app: string, readOnly: boolean, openFs: () => Promise<FsAdapter>): Promise<Folder> {
    const key = readOnly ? app : OWN_FOLDER_KEY;
    let opening = folders.get(key);

    if (!opening) {
      opening = (async () => {
        const folder = openFolder({
          app,
          readOnly,
          fs: await openFs(),
          keys: await dataKeys(fromBase64(dataKey)),
          api: api.folderApi(app, readOnly),
          platform,
          checkGone: () =>
            api.refresh().then(
              () => 'ok' as const,
              e => (e instanceof SyncError && e.code === 'gone' ? 'gone' : 'ok')
            ),
        });
        await folder.start().catch(async (e: unknown) => {
          await folder.close();

          throw e;
        });

        return folder;
      })();
      folders.set(key, opening);
      opening.catch(() => {
        if (folders.get(key) === opening) {
          folders.delete(key);
        }
      });
    }

    const folder = await opening;
    const stoppedWhileOpening = folders.get(key) !== opening;

    if (stoppedWhileOpening) {
      throw signedOut();
    }

    return folder;
  }

  async function stopAll(stop: (f: Folder) => Promise<void>): Promise<void> {
    const stopping = [...folders.values()];
    folders.clear();
    const results = await Promise.allSettled(stopping.map(async opening => stop(await opening)));

    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('pappdrive: a folder did not stop cleanly:', r.reason);
      }
    }
  }

  return { open, stopAll };
}
