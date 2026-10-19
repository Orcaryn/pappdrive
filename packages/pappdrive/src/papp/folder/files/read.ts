import { concat } from '../../../shared/bytes.js';
import { SyncError } from '../../../shared/errors.js';
import { HIDDEN_DIR, joinPath } from '../../../shared/paths.js';
import type { FsAdapter } from '../../../shared/platform.js';
import type { FileInfo } from '../../../shared/types.js';

const READ_CHUNK = 1024 * 1024;

export async function readAll(fs: FsAdapter, path: string, size: number, chunk: number): Promise<Uint8Array> {
  if (size <= chunk) {
    return fs.read(path, 0, size);
  }

  const parts: Uint8Array[] = [];

  for (let off = 0; off < size; off += chunk) {
    parts.push(await fs.read(path, off, Math.min(chunk, size - off)));
  }

  return concat(...parts);
}

export function notFound(path: string): SyncError {
  return new SyncError('not-found', `"${path}" does not exist. Check the path with files.list(), or write it first.`);
}

export function fileStream(fs: FsAdapter, p: string): ReadableStream<Uint8Array> {
  let off = 0;
  let size: number | null = null;

  return new ReadableStream<Uint8Array>({
    async pull(c) {
      if (size === null) {
        const st = await fs.stat(p);

        if (!st) {
          return c.error(notFound(p));
        }

        size = st.size;
      }

      const data = off < size ? await fs.read(p, off, Math.min(READ_CHUNK, size - off)) : new Uint8Array(0);

      if (data.length === 0) {
        return c.close();
      }

      off += data.length;
      c.enqueue(data);
    },
  });
}

export async function listFolder(fs: FsAdapter, dir: string): Promise<FileInfo[]> {
  const out: FileInfo[] = [];

  for (const e of await fs.list(dir)) {
    const name = e.name.normalize('NFC');

    if (dir === '' && name.toLowerCase() === HIDDEN_DIR) {
      continue;
    }

    const path = joinPath(dir, name);

    if (e.dir) {
      if (await hasFiles(fs, path)) {
        out.push({ path, size: 0, mtime: 0, dir: true });
      }
    } else {
      const st = await fs.stat(path);

      if (st) {
        out.push({ path, size: st.size, mtime: st.mtime, dir: false });
      }
    }
  }

  return out.sort((a, b) =>
    a.path < b.path ? -1
    : a.path > b.path ? 1
    : 0
  );
}

async function hasFiles(fs: FsAdapter, dir: string): Promise<boolean> {
  for (const e of await fs.list(dir)) {
    if (!e.dir || (await hasFiles(fs, joinPath(dir, e.name.normalize('NFC'))))) {
      return true;
    }
  }

  return false;
}
