import type { IndexEntry } from '@pappdrive/protocol';
import { concat, utf8 } from '../../../shared/bytes.js';
import { blobId, type DataKeys } from '../../../shared/crypto.js';
import { SyncError } from '../../../shared/errors.js';
import { HIDDEN_DIR, joinPath, pathKey } from '../../../shared/paths.js';
import type { FsAdapter } from '../../../shared/platform.js';
import type { WriteData } from '../../../shared/types.js';
import { entryFromParts } from '../shared/hash.js';

export async function streamToTemp(fs: FsAdapter, keys: DataKeys, partSize: number, temp: string, data: WriteData): Promise<IndexEntry> {
  const ids: string[] = [];
  let chunks: Uint8Array[] = [];
  let buffered = 0;
  let size = 0;

  const joined = () => {
    const [only, ...more] = chunks;

    return only !== undefined && more.length === 0 ? only : concat(...chunks);
  };

  const emit = async (part: Uint8Array) => {
    ids.push(await blobId(keys, part));
    await fs.tempAppend(temp, part);
  };

  const add = async (chunk: Uint8Array) => {
    size += chunk.length;
    chunks.push(chunk);
    buffered += chunk.length;
    while (buffered >= partSize) {
      const all = joined();
      await emit(all.subarray(0, partSize));
      chunks = [all.subarray(partSize)];
      buffered -= partSize;
    }
  };

  if (data instanceof Uint8Array) {
    await add(data);
  } else if (data instanceof Blob || data instanceof ReadableStream) {
    const reader = (data instanceof Blob ? data.stream() : data).getReader();

    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      await add(r.value);
    }
  } else {
    await add(utf8.encode(data));
  }

  if (buffered > 0 || size === 0) {
    await emit(joined());
  }

  return entryFromParts(keys, ids, size, 0);
}

export async function checkNames(fs: FsAdapter, p: string): Promise<void> {
  const segs = p.split('/');

  if (segs.some(s => s.toLowerCase() === HIDDEN_DIR)) {
    throw new SyncError('bad-path', `"${p}" has a folder named ${HIDDEN_DIR}, the library's hidden folder. Use another name.`);
  }

  let dir = '';

  for (const [i, name] of segs.entries()) {
    const last = i === segs.length - 1;
    const match = (await fs.list(dir)).find(e => pathKey(e.name) === pathKey(name));

    if (!match) {
      return;
    }

    const spelled = match.name.normalize('NFC');
    const existing = joinPath(dir, spelled);

    if (spelled !== name) {
      if (last && !match.dir) {
        throw new SyncError('case-clash', `"${existing}" already exists. Write to "${existing}", or remove it first.`);
      }

      const fixed = [existing, ...segs.slice(i + 1)].join('/');

      throw new SyncError('case-clash', `The folder "${existing}" already exists with other capitals. Write to "${fixed}" instead.`);
    } else if (last && match.dir) {
      throw new SyncError('bad-path', `"${p}" is a folder. A file and a folder cannot share a name. Write inside it, like "${p}/name", or pick another name.`);
    } else if (!last && !match.dir) {
      throw new SyncError('bad-path', `"${existing}" is a file, so "${p}" cannot be inside it. A file and a folder cannot share a name. Rename or remove "${existing}" first.`);
    }

    dir = existing;
  }
}
