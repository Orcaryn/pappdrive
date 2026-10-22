import { fromUtf8, toHex } from '../../../shared/bytes.js';
import { randomBytes } from '../../../shared/crypto.js';
import { SyncError } from '../../../shared/errors.js';
import { baseName, HIDDEN_DIR, parentOf, pathKey, pathProblem } from '../../../shared/paths.js';
import type { FileInfo, Files, WriteData } from '../../../shared/types.js';
import { IGNORE_FILE } from '../scan/ignore.js';
import type { Scanner } from '../scan/index.js';
import type { WithLock } from '../locks.js';
import type { LocalState } from '../state.js';
import type { FolderContext } from '../types.js';
import { fileStream, listFolder, notFound, readAll } from './read.js';
import { checkNames, streamToTemp } from './write.js';

type FileOps = Pick<Files, 'write' | 'read' | 'readText' | 'readStream' | 'list' | 'remove'>;

interface FilesDeps {
  ctx: FolderContext;
  partSize: number;
  state: LocalState;
  scanner: Scanner;
  withLock: WithLock;
  isLeading: () => boolean;
  assertOpen: () => void;
  changedHere: (path: string) => void;
}

export function createFiles(d: FilesDeps): FileOps & { removeCrashedWriteTemps(): Promise<void> } {
  const { ctx, partSize, state, scanner, withLock } = d;
  const { fs, keys } = ctx;
  const activeWriteTemps = new Set<string>();

  async function write(path: string, data: WriteData): Promise<void> {
    d.assertOpen();

    if (ctx.readOnly) {
      throw readOnlyError('write');
    }

    const p = devicePath(path);
    await checkNames(fs, p);
    const temp = `w-${toHex(randomBytes(8))}`;
    activeWriteTemps.add(temp);
    try {
      const entry = await streamToTemp(fs, keys, partSize, temp, data);
      await withLock(pathKey(p), async () => {
        const st = await fs.moveTempInto(temp, p);

        if (!d.isLeading()) {
          return;
        } else if (scanner.isIgnored(p)) {
          state.deleteDisk(pathKey(p));
        } else {
          state.setDisk({ path: p, entry: { ...entry, size: st.size, mtime: st.mtime } });
        }
      });
    } catch (e) {
      await fs.tempRemove(temp);

      throw e;
    } finally {
      activeWriteTemps.delete(temp);
    }

    if (d.isLeading() && baseName(p).toLowerCase() === IGNORE_FILE) {
      await scanner.refreshRules();
    }

    d.changedHere(p);
  }

  async function read(path: string): Promise<Uint8Array> {
    d.assertOpen();
    const p = devicePath(path);
    const st = await fs.stat(p);

    if (!st) {
      throw notFound(path);
    }

    return readAll(fs, p, st.size, partSize);
  }

  function readStream(path: string): ReadableStream<Uint8Array> {
    d.assertOpen();

    return fileStream(fs, devicePath(path));
  }

  async function list(dir?: string): Promise<FileInfo[]> {
    d.assertOpen();

    return listFolder(fs, dir === undefined ? '' : devicePath(dir));
  }

  async function remove(path: string): Promise<void> {
    d.assertOpen();

    if (ctx.readOnly) {
      throw readOnlyError('remove');
    }

    const p = devicePath(path);

    if (!(await fs.stat(p))) {
      throw new SyncError('not-found', `"${path}" does not exist, so there is nothing to remove. List files with files.list(); a folder goes away once its files are removed.`);
    }

    await withLock(pathKey(p), async () => {
      await fs.remove(p);

      if (d.isLeading()) {
        state.deleteDisk(pathKey(p));
      }

      await fs.removeEmptyDirs(parentOf(p));
    });
    d.changedHere(p);
  }

  async function removeCrashedWriteTemps(): Promise<void> {
    for (const t of await fs.tempList()) {
      if (t.startsWith('w-') && !activeWriteTemps.has(t)) {
        await fs.tempRemove(t);
      }
    }
  }

  function devicePath(path: string): string {
    const p = path.normalize('NFC');
    const problem = pathProblem(p);
    const key = pathKey(p);

    if (problem) {
      throw new SyncError('bad-path', `"${path}" is not a valid path: ${problem}.`);
    } else if (key === HIDDEN_DIR || key.startsWith(HIDDEN_DIR + '/')) {
      throw new SyncError('bad-path', `"${path}" is inside the library's hidden folder ${HIDDEN_DIR}/. Use another path.`);
    }

    const bad = p.split('/').find(seg => !fs.canCreate(seg));

    if (bad !== undefined) {
      throw new SyncError(
        'bad-path',
        `"${path}" cannot be made on this device: the system refuses the name "${bad}". Avoid \\, and for Windows also < > : " | ? * and names like CON or NUL.`
      );
    }

    return p;
  }

  function readOnlyError(what: string): SyncError {
    return new SyncError(
      'read-only',
      `"${ctx.app}" is open read-only, so ${what} is not allowed. Change files through papp.files, the app's own folder, or in the "${ctx.app}" app itself.`
    );
  }

  return { write, read, readText: async path => fromUtf8.decode(await read(path)), readStream, list, remove, removeCrashedWriteTemps };
}
