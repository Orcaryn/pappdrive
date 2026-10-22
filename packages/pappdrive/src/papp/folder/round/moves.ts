import type { IndexEntry } from '@pappdrive/protocol';
import { toHex } from '../../../shared/bytes.js';
import { randomBytes } from '../../../shared/crypto.js';
import { baseName, joinPath, parentOf, pathKey } from '../../../shared/paths.js';
import type { FileStat } from '../../../shared/platform.js';
import type { RoundDeps } from './deps.js';

export async function conflictCopy(r: RoundDeps, key: string, path: string): Promise<boolean> {
  const copy = await r.withLock(key, async () => {
    const live = r.state.disk.get(key);

    return live && moveToConflictCopy(r, live.path, live.entry);
  });

  if (copy) {
    r.fire({ path, origin: 'conflict', copy });
  }

  return copy !== undefined;
}

export async function moveToConflictCopy(r: RoundDeps, path: string, entry: IndexEntry | undefined): Promise<string> {
  const { fs } = r.ctx;
  const when = new Date();
  const onDisk = new Set<string>();
  const taken = (k: string) => r.state.disk.has(k) || r.state.isKnown(k) || onDisk.has(k);
  let copy = conflictName(path, when, taken);
  while (await fs.stat(copy)) {
    onDisk.add(pathKey(copy));
    copy = conflictName(path, when, taken);
  }

  const before = await fs.stat(path);
  await fs.move(path, copy);
  r.state.deleteDisk(pathKey(path));
  const after = await fs.stat(copy);

  if (after && !r.scanner.isIgnored(copy)) {
    r.state.setDisk({ path: copy, entry: carry(entry, before, after) });
  }

  return copy;
}

export async function renameLocal(r: RoundDeps, from: string, to: string): Promise<void> {
  if (from === to) {
    return;
  }

  const { fs } = r.ctx;
  const before = await fs.stat(from);

  if (fs.caseInsensitive && pathKey(from) === pathKey(to)) {
    const tmp = `${from}.pappdrive-rename-${toHex(randomBytes(4))}`;
    await fs.move(from, tmp);
    await fs.move(tmp, to);
  } else {
    await fs.move(from, to);
  }

  const rec = r.state.disk.get(pathKey(from));
  r.state.deleteDisk(pathKey(from));
  const after = await fs.stat(to);

  if (rec && after) {
    r.state.setDisk({ path: to, entry: carry(rec.entry, before, after) });
  }
}

function carry(entry: IndexEntry | undefined, before: FileStat | null, after: FileStat): IndexEntry {
  if (entry && before && before.size === entry.size && before.mtime === entry.mtime) {
    return { ...entry, size: after.size, mtime: after.mtime };
  }

  return { id: '', size: after.size, mtime: -1 };
}

export function conflictName(path: string, when: Date, taken: (key: string) => boolean, isFolder = false): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`;
  const dir = parentOf(path);
  const base = baseName(path);
  const dot = isFolder ? -1 : base.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];

  for (let n = 1; ; n++) {
    const name = `${stem} (conflict ${stamp}${n > 1 ? ` ${n}` : ''})${ext}`;
    const full = joinPath(dir, name);

    if (!taken(pathKey(full))) {
      return full;
    }
  }
}
