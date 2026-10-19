import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import type * as ParcelWatcher from '@parcel/watcher';

const FALLBACK_SCAN_MS = 10_000;

export async function watchFolder(root: string, skipGlobs: string[], onPaths: (paths: string[]) => void, onDropped: () => void): Promise<() => Promise<void>> {
  const parcel = await loadParcelWatcher();

  if (!parcel) {
    const timer = setInterval(onDropped, FALLBACK_SCAN_MS);
    timer.unref();

    return async () => clearInterval(timer);
  }

  // the OS reports real paths; on macOS /var is /private/var.
  const realRoot = await realpath(root);
  let stopped = false;
  const sub = await parcel.subscribe(
    realRoot,
    (err, events) => {
      if (stopped) {
        return;
      } else if (err) {
        // @parcel/watcher reports dropped events (FSEvents "must scan subdirs", inotify overflow) as err.
        onDropped();

        return;
      }

      const paths = new Set(events.flatMap(ev => toRelative(realRoot, ev.path) ?? []));

      if (paths.size > 0) {
        onPaths([...paths]);
      }
    },
    { ignore: skipGlobs }
  );

  return async () => {
    stopped = true;
    await sub.unsubscribe();
  };
}

let loading: Promise<typeof ParcelWatcher | null> | null = null;

export function loadParcelWatcher(): Promise<typeof ParcelWatcher | null> {
  loading ??= import('@parcel/watcher').catch((e: unknown) => {
    console.warn(
      `pappdrive: the folder watcher (@parcel/watcher) could not load: ${String(e)}. ` +
        `Edits made by other programs are found by a scan every ${FALLBACK_SCAN_MS / 1000} seconds instead. ` +
        `To fix it, reinstall dependencies on this machine (for example \`pnpm install\` or \`npm rebuild @parcel/watcher\`).`
    );

    return null;
  });

  return loading;
}

export function toRelative(root: string, abs: string): string | null {
  const rel = relative(root.normalize('NFC'), abs.normalize('NFC'));

  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    return null;
  }

  return rel.split(sep).join('/');
}
