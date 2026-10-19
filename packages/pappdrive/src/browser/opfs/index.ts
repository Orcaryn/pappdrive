import { utf8, withPlainBuffer } from '../../shared/bytes.js';
import { SyncError } from '../../shared/errors.js';
import { baseName, HIDDEN_DIR, parentOf } from '../../shared/paths.js';
import type { DirEntry, FileStat, FsAdapter } from '../../shared/platform.js';
import { chunksOf, isEmpty, makeDirs, moveDir, nullIfMissing, type OpfsDirHandle, type OpfsFileHandle, type Part } from './handles.js';
import { writeViaWorker, writeWithWritable, type WriteFile } from './write.js';

type RootSegs = [string, string, string];

const TMP = `${HIDDEN_DIR}/tmp`;
const PROBE = 'case-Probe';
// WHATWG File System forbids the platform's path separator in a name; backslash is one on Windows, and a page cannot tell its platform.
const canCreate = (segment: string): boolean => !segment.includes('\\');

export async function openOpfs(userId: string, app: string, readFor?: string, getRoot = opfsRoot): Promise<FsAdapter> {
  const rootSegs: RootSegs = ['pappdrive', userId, readFor ? `${app}.read-${readFor}` : app];
  const top = await getRoot();
  const root = await makeDirs(top, rootSegs.join('/'));
  const hidden = await root.getDirectoryHandle(HIDDEN_DIR, { create: true });
  const probe = await hidden.getFileHandle(PROBE, { create: true });
  // WebKit's OPFS is case-insensitive on a case-insensitive disk.
  const caseInsensitive = (await hidden.getFileHandle(PROBE.toUpperCase()).catch(nullIfMissing)) !== null;
  await removeAbandonedSaves(hidden);

  return opfsFolder(top, rootSegs, root, caseInsensitive, probe.createWritable === undefined ? writeViaWorker : writeWithWritable);
}

async function removeAbandonedSaves(hidden: OpfsDirHandle): Promise<void> {
  const hourAgo = Date.now() - 3600_000;

  for await (const [name, h] of hidden.entries()) {
    if (h.kind === 'file' && name.endsWith('.saving') && (await h.getFile()).lastModified < hourAgo) {
      await hidden.removeEntry(name).catch(nullIfMissing);
    }
  }
}

async function opfsRoot(): Promise<OpfsDirHandle> {
  try {
    return (await navigator.storage.getDirectory()) as unknown as OpfsDirHandle;
  } catch (e) {
    throw new SyncError(
      'not-allowed',
      `The browser gives this page no private file storage (OPFS): ${String(e)}. It needs a secure page (https or localhost), ` +
        'and private windows often turn it off. Open the app in a normal window over https.'
    );
  }
}

function opfsFolder(top: OpfsDirHandle, rootSegs: RootSegs, root: OpfsDirHandle, caseInsensitive: boolean, writeFile: WriteFile): FsAdapter {
  async function stat(path: string): Promise<FileStat | null> {
    const f = await getFile(path);

    return f && { size: f.size, mtime: f.lastModified };
  }

  async function list(dir: string): Promise<DirEntry[]> {
    const d = await findDir(dir);
    const out: DirEntry[] = [];

    if (d) {
      for await (const [name, h] of d.entries()) {
        out.push({ name, dir: h.kind === 'directory' });
      }
    }

    return out;
  }

  async function read(path: string, offset: number, length: number): Promise<Uint8Array> {
    const f = await getFile(path);

    if (!f) {
      throw new SyncError('not-found', `"${path}" does not exist. List the folder to see what is there.`);
    }

    return new Uint8Array(await f.slice(offset, offset + length).arrayBuffer());
  }

  async function moveTempInto(temp: string, path: string): Promise<FileStat> {
    const tdirPath = `${TMP}/${temp}`;
    const tdir = await findDir(tdirPath);

    if (!tdir) {
      throw new Error(`pappdrive: the temp file ${temp} is missing, so "${path}" cannot be written.`);
    }

    const chunks = await chunksOf(tdir);
    const [only, ...more] = chunks;
    const source = only && more.length === 0 ? only : await write(tdirPath, 'joined', await Promise.all(chunks.map(c => c.getFile())));
    await source.move(await makeDirs(root, parentOf(path)), baseName(path));
    await tempRemove(temp);
    // a moved handle points at its new place.
    const f = await source.getFile();

    return { size: f.size, mtime: f.lastModified };
  }

  async function move(from: string, to: string): Promise<void> {
    const name = baseName(from);
    const fromParent = await findDir(parentOf(from));
    const file = fromParent && (await fromParent.getFileHandle(name).catch(nullIfMissing));
    const dir = fromParent && !file ? await fromParent.getDirectoryHandle(name).catch(nullIfMissing) : null;

    if (file) {
      await file.move(await makeDirs(root, parentOf(to)), baseName(to));
    } else if (fromParent && dir) {
      await moveDir(dir, await makeDirs(root, to));
      await fromParent.removeEntry(name);
    } else {
      throw new SyncError('not-found', `"${from}" does not exist, so it cannot be moved.`);
    }
  }

  async function remove(path: string): Promise<void> {
    const name = baseName(path);
    const parent = await findDir(parentOf(path));

    if (parent && (await parent.getFileHandle(name).catch(nullIfMissing))) {
      await parent.removeEntry(name);
    }
  }

  async function removeEmptyDirs(dir: string): Promise<void> {
    for (let d = dir; d !== ''; d = parentOf(d)) {
      const name = baseName(d);
      const parent = await findDir(parentOf(d));
      const handle = parent && (await parent.getDirectoryHandle(name).catch(nullIfMissing));

      if (!parent || !handle) {
        continue;
      } else if (!(await isEmpty(handle))) {
        return;
      }

      await parent.removeEntry(name);
    }
  }

  async function tempSize(temp: string): Promise<number | null> {
    const tdir = await findDir(`${TMP}/${temp}`);

    if (!tdir) {
      return null;
    }

    let size = 0;

    for (const c of await chunksOf(tdir)) {
      size += (await c.getFile()).size;
    }

    return size;
  }

  // createWritable({ keepExistingData: true }) copies the whole file into its swap file on every call, so a temp file is a folder of chunks.
  async function tempAppend(temp: string, data: Uint8Array): Promise<void> {
    const tdirPath = `${TMP}/${temp}`;
    const nextChunk = (await chunksOf(await makeDirs(root, tdirPath))).length;
    await write(tdirPath, String(nextChunk).padStart(8, '0'), [withPlainBuffer(data)]);
  }

  async function tempTruncate(temp: string, size: number): Promise<void> {
    const tdirPath = `${TMP}/${temp}`;
    const tdir = await findDir(tdirPath);

    if (!tdir) {
      return;
    }

    let start = 0;

    for (const c of await chunksOf(tdir)) {
      const f = await c.getFile();

      if (start >= size) {
        await tdir.removeEntry(c.name);
      } else if (start + f.size > size) {
        await write(tdirPath, c.name, [f.slice(0, size - start)]);
      }

      start += f.size;
    }
  }

  async function tempRemove(temp: string): Promise<void> {
    const tmp = await findDir(TMP);
    await tmp?.removeEntry(temp, { recursive: true }).catch(nullIfMissing);
  }

  async function tempList(): Promise<string[]> {
    const tmp = await findDir(TMP);
    const out: string[] = [];

    if (tmp) {
      for await (const [name, h] of tmp.entries()) {
        if (h.kind === 'directory') {
          out.push(name);
        }
      }
    }

    return out;
  }

  async function loadState(name: string): Promise<string | null> {
    const f = await getFile(`${HIDDEN_DIR}/${name}`);

    return f ? f.text() : null;
  }

  async function saveState(name: string, data: string): Promise<void> {
    await write(HIDDEN_DIR, name, [utf8.encode(data)]);
  }

  async function destroy(): Promise<void> {
    const [pappdriveName, userName, folderName] = rootSegs;
    const pappdrive = await top.getDirectoryHandle(pappdriveName);
    const user = await pappdrive.getDirectoryHandle(userName);
    await user.removeEntry(folderName, { recursive: true }).catch(nullIfMissing);

    if (await isEmpty(user)) {
      await pappdrive.removeEntry(userName);

      if (await isEmpty(pappdrive)) {
        await top.removeEntry(pappdriveName);
      }
    }
  }

  async function write(dirPath: string, name: string, parts: Part[]): Promise<OpfsFileHandle> {
    return writeFile(await makeDirs(root, dirPath), [...rootSegs, ...dirPath.split('/')], name, parts);
  }

  async function getFile(path: string): Promise<File | null> {
    const parent = await findDir(parentOf(path));
    const handle = parent && (await parent.getFileHandle(baseName(path)).catch(nullIfMissing));

    return handle && handle.getFile().catch(nullIfMissing);
  }

  async function findDir(dirPath: string): Promise<OpfsDirHandle | null> {
    let d = root;
    try {
      for (const s of dirPath === '' ? [] : dirPath.split('/')) {
        d = await d.getDirectoryHandle(s);
      }

      return d;
    } catch (e) {
      return nullIfMissing(e);
    }
  }

  return {
    kind: 'private',
    caseInsensitive,
    canCreate,
    stat,
    list,
    read,
    moveTempInto,
    move,
    remove,
    removeEmptyDirs,
    tempSize,
    tempAppend,
    tempTruncate,
    tempRemove,
    tempList,
    loadState,
    saveState,
    destroy,
  };
}
