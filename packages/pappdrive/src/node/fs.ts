import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HIDDEN_DIR, parentOf, pathKey } from '../shared/paths.js';
import { SyncError } from '../shared/errors.js';
import type { DirEntry, FsAdapter } from '../shared/platform.js';
import { watchFolder } from './watcher.js';

const SYSTEM_LEFTOVERS = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const WINDOWS_BAD_CHARS = /[<>:"/\\|?*]/;
const NON_ASCII = /\P{ASCII}/u;

export async function openNodeFs(root: string, kind: FsAdapter['kind']): Promise<FsAdapter> {
  const abs = resolve(root);
  const hidden = join(abs, HIDDEN_DIR);
  const tmp = join(hidden, 'tmp');
  await fsp.mkdir(tmp, { recursive: true });
  const probe = `case-probe-${randomBytes(6).toString('hex')}`;
  await fsp.writeFile(join(hidden, probe), '');
  const caseInsensitive = (await ifMissing(fsp.stat(join(hidden, probe.toUpperCase())), null)) !== null;
  await fsp.rm(join(hidden, probe));

  const real = async (path: string): Promise<string> => {
    let cur = abs;

    for (const seg of path === '' ? [] : path.split('/')) {
      cur = join(cur, NON_ASCII.test(seg) ? await onDiskName(cur, seg) : seg);
    }

    return cur;
  };

  const ensureParent = async (path: string): Promise<string> => {
    const parent = parentOf(path);

    if (parent !== '') {
      await makeDir(await real(parent), () => new SyncError('bad-path', `Cannot create "${path}": a file is in the way of its folder "${parent}".`));
    }

    return real(path);
  };

  return {
    kind,
    caseInsensitive,

    canCreate: canCreateName,

    async stat(path) {
      const st = await ifMissing(fsp.stat(await real(path)), null);

      return st?.isFile() ? { size: st.size, mtime: Math.floor(st.mtimeMs) } : null;
    },

    async list(dir) {
      const entries = await ifMissing(fsp.readdir(await real(dir), { withFileTypes: true }), []);
      const out: DirEntry[] = [];

      for (const e of entries) {
        const name = e.name.normalize('NFC');

        if (e.isDirectory()) {
          out.push({ name, dir: true });
        } else if (e.isFile()) {
          out.push({ name, dir: false });
        } else if (e.isSymbolicLink()) {
          const target = await fsp.stat(join(e.parentPath, e.name)).catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT' || err.code === 'ELOOP') {
              return null;
            }

            throw err;
          });

          if (target?.isFile()) {
            out.push({ name, dir: false });
          }
        }
      }

      return out;
    },

    async read(path, offset, length) {
      const fh = await fsp.open(await real(path), 'r').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT' || e.code === 'EISDIR' || e.code === 'ENOTDIR') {
          throw new SyncError('not-found', `"${path}" does not exist. Check the path with list().`);
        }

        throw e;
      });

      try {
        const buf = Buffer.alloc(length);
        let got = 0;
        while (got < length) {
          const { bytesRead } = await fh.read(buf, got, length - got, offset + got);

          if (bytesRead === 0) {
            break;
          }

          got += bytesRead;
        }

        return new Uint8Array(buf.buffer, buf.byteOffset, got);
      } finally {
        await fh.close();
      }
    },

    async moveTempInto(temp, path) {
      const dst = await ensureParent(path);
      await fsp.rename(join(tmp, temp), dst);
      const st = await fsp.stat(dst);

      return { size: st.size, mtime: Math.floor(st.mtimeMs) };
    },

    async move(from, to) {
      const src = await real(from);
      await fsp.rename(src, await ensureParent(to));
    },

    async remove(path) {
      await ifMissing(fsp.unlink(await real(path)), undefined);
    },

    async removeEmptyDirs(dir) {
      for (let d = dir; d !== ''; d = parentOf(d)) {
        const key = pathKey(d);

        if (key === HIDDEN_DIR || key.startsWith(HIDDEN_DIR + '/')) {
          return;
        }

        const dirAbs = await real(d);
        const names = await ifMissing(fsp.readdir(dirAbs), null);

        if (names === null) {
          continue;
        } else if (names.some(n => !SYSTEM_LEFTOVERS.has(n.toLowerCase()))) {
          return;
        }

        for (const n of names) {
          await fsp.rm(join(dirAbs, n), { force: true });
        }

        try {
          await fsp.rmdir(dirAbs);
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;

          if (code === 'ENOENT') {
            continue;
          } else if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EBUSY' || code === 'EPERM') {
            // Windows rmdir fails with EBUSY or EPERM while another process holds the folder open.
            return;
          }

          throw e;
        }
      }
    },

    tempSize: temp =>
      ifMissing(
        fsp.stat(join(tmp, temp)).then(st => st.size),
        null
      ),

    async tempAppend(temp, data) {
      await fsp.mkdir(tmp, { recursive: true });
      await fsp.appendFile(join(tmp, temp), data);
    },

    tempTruncate: (temp, size) => fsp.truncate(join(tmp, temp), size),

    tempRemove: temp => fsp.rm(join(tmp, temp), { force: true }),

    tempList: () => ifMissing(fsp.readdir(tmp), []),

    loadState: name => ifMissing(fsp.readFile(join(hidden, name), 'utf8'), null),

    async saveState(name, data) {
      const target = join(hidden, name);
      await fsp.mkdir(hidden, { recursive: true });
      const temp = `${target}.${randomBytes(6).toString('hex')}.saving`;
      const fh = await fsp.open(temp, 'w', 0o600);
      try {
        await fh.writeFile(data, 'utf8');
        await fh.sync();
      } finally {
        await fh.close();
      }

      try {
        await fsp.rename(temp, target);
      } catch (e) {
        await fsp.rm(temp, { force: true });

        throw e;
      }
    },

    async destroy() {
      await fsp.rm(kind === 'private' ? abs : hidden, { recursive: true, force: true });
    },

    watch: kind === 'visible' ? (skipGlobs, onPaths, onDropped) => watchFolder(abs, skipGlobs, onPaths, onDropped) : undefined,
  };
}

export function canCreateName(segment: string, windows = process.platform === 'win32'): boolean {
  if (segment === '' || segment.includes('/') || segment.includes('\0')) {
    return false;
  } else if (!windows) {
    return true;
  }

  return !(WINDOWS_BAD_CHARS.test(segment) || [...segment].some(c => c < ' ') || segment.endsWith('.') || segment.endsWith(' ') || WINDOWS_RESERVED.test(segment));
}

// macOS hands out NFD names, and a Linux disk may hold NFD names copied from a Mac.
async function onDiskName(dir: string, nfc: string): Promise<string> {
  if (await ifMissing(fsp.lstat(join(dir, nfc)), null)) {
    return nfc;
  }

  const names = await ifMissing(fsp.readdir(dir), []);

  return names.find(n => n.normalize('NFC') === nfc) ?? nfc;
}

export async function makeDir(abs: string, fileInTheWay: () => SyncError): Promise<void> {
  try {
    await fsp.mkdir(abs, { recursive: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;

    if (code === 'EEXIST' || code === 'ENOTDIR') {
      throw fileInTheWay();
    }

    throw e;
  }
}

export async function ifMissing<T, M>(op: Promise<T>, missing: M): Promise<T | M> {
  try {
    return await op;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;

    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return missing;
    }

    throw e;
  }
}
