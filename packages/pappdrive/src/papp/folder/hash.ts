import type { IndexEntry } from '@pappdrive/protocol';
import { bigFileId, blobId, type DataKeys } from '../../shared/crypto.js';
import type { FsAdapter } from '../../shared/platform.js';

export async function entryFromParts(keys: DataKeys, partIds: string[], size: number, mtime: number): Promise<IndexEntry> {
  const [only, ...more] = partIds;

  if (only !== undefined && more.length === 0) {
    return { id: only, size, mtime };
  }

  return { id: await bigFileId(keys, partIds), size, mtime, parts: partIds };
}

type Hashed = { state: 'hashed'; entry: IndexEntry } | { state: 'missing' } | { state: 'changing' };

export async function hashFile(fs: FsAdapter, keys: DataKeys, path: string, partSize: number): Promise<Hashed> {
  for (let i = 0; i < 3; i++) {
    const before = await fs.stat(path);

    if (!before) {
      return { state: 'missing' };
    }

    const ids: string[] = [];

    if (before.size === 0) {
      ids.push(await blobId(keys, new Uint8Array(0)));
    }

    for (let off = 0; off < before.size; off += partSize) {
      ids.push(await blobId(keys, await fs.read(path, off, Math.min(partSize, before.size - off))));
    }

    const after = await fs.stat(path);

    if (!after) {
      return { state: 'missing' };
    } else if (after.size === before.size && after.mtime === before.mtime) {
      return { state: 'hashed', entry: await entryFromParts(keys, ids, before.size, before.mtime) };
    }
  }

  return { state: 'changing' };
}
