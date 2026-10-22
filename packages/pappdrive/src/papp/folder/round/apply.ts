import type { IndexEntry } from '@pappdrive/protocol';
import { ID_RE } from '@pappdrive/protocol';
import { dirKeysOf, parentOf, pathKey } from '../../../shared/paths.js';
import { hashFile } from '../hash.js';
import type { DiskRec } from '../state.js';
import type { Decision } from './decide.js';
import { downloadAll } from './download.js';
import { conflictCopy, moveToConflictCopy, renameLocal } from './moves.js';
import { folderSpellings, localTarget, respell } from './spelling.js';
import type { RoundDeps } from './deps.js';

type DeleteHere = Extract<Decision, { action: 'delete-here' }>;

// some disks keep mtime to the second, so a file saved this recently is compared by hash too.
const RECENT_MS = 2_000;

interface Job {
  key: string;
  path: string;
  entry: IndexEntry;
  target: string;
  expected: DiskRec | undefined;
  quiet: boolean;
}

export async function applyServer(r: RoundDeps, decisions: Decision[]): Promise<Error | null> {
  const spell = folderSpellings([...r.state.disk.values()].map(rec => rec.path));
  const jobs: Job[] = [];
  const deletes: DeleteHere[] = [];

  for (const dec of decisions) {
    r.signal.throwIfAborted();

    const { key } = dec;

    switch (dec.action) {
      case 'conflict': {
        const { server } = dec;
        const moved = await conflictCopy(r, key, server.path);
        jobs.push({ key, path: server.path, entry: server.entry, target: respell(server.path, spell), expected: undefined, quiet: moved });
        break;
      }

      case 'download': {
        const { disk, server } = dec;

        if (disk?.entry.id === server.entry.id) {
          await adopt(r, key, server.path, server.entry, spell);
        } else {
          jobs.push({ key, path: server.path, entry: server.entry, target: localTarget(server.path, disk, spell), expected: disk, quiet: false });
        }

        break;
      }

      case 'adopt':
        await adopt(r, key, dec.server.path, dec.server.entry, spell);
        break;
      case 'forget':
        r.state.deleteSynced(key);
        break;
      case 'delete-here':
        deletes.push(dec);
        break;
      case 'upload':
      case 'delete-server':
        break;
    }
  }

  let firstError: Error | null = null;
  const keepTemps = new Set<string>();

  const download = async (list: Job[]) => {
    let flushed = Date.now();
    await downloadAll(
      r,
      list,
      async (job, temp) => {
        await land(r, job, temp);

        if (Date.now() - flushed > 2000) {
          flushed = Date.now();
          await r.state.flush();
        }
      },
      (job, e) => {
        keepTemps.add(job.entry.id);
        firstError ??= e;
      }
    );

    r.signal.throwIfAborted();
  };

  const blocked = blockedChecker(r);
  const ready: Job[] = [];
  const later: Job[] = [];

  for (const j of jobs) {
    (blocked(j.target) ? later : ready).push(j);
  }

  await download(ready);

  const emptied = new Set<string>();

  for (const dec of deletes) {
    await deleteHere(r, dec, emptied);
  }

  for (const dir of emptied) {
    await r.ctx.fs.removeEmptyDirs(dir);
  }

  const stillBlocked = blockedChecker(r);
  const unblocked: Job[] = [];

  for (const j of later) {
    if (stillBlocked(j.target)) {
      keepTemps.add(j.entry.id);
    } else {
      unblocked.push(j);
    }
  }

  await download(unblocked);

  for (const t of await r.ctx.fs.tempList()) {
    if (ID_RE.test(t) && !keepTemps.has(t)) {
      await r.ctx.fs.tempRemove(t);
    }
  }

  await r.state.flush();

  return firstError;
}

async function adopt(r: RoundDeps, key: string, path: string, entry: IndexEntry, spell: Map<string, string>): Promise<void> {
  await r.withLock(key, async () => {
    const live = r.state.disk.get(key);

    if (!live || live.entry.id !== entry.id) {
      return;
    }

    await renameLocal(r, live.path, localTarget(path, live, spell));
    r.state.setSynced({ path, entry });
  });
}

async function land(r: RoundDeps, j: Job, temp: string): Promise<void> {
  const { fs, keys } = r.ctx;
  await r.withLock(j.key, async () => {
    r.signal.throwIfAborted();

    const live = r.state.disk.get(j.key);
    const here =
      live ? live.path
      : j.expected ? j.expected.path
      : j.target;
    const saved = (await unchangedSince(r, j.expected, live, j.target)) ? null : await hashFile(fs, keys, here, r.partSize);

    if (saved?.state === 'hashed' && saved.entry.id === j.entry.id) {
      r.state.setDisk({ path: here, entry: saved.entry });
      r.state.setSynced({ path: j.path, entry: j.entry });
      await fs.tempRemove(temp);

      return;
    }

    const copy = saved === null || saved.state === 'missing' ? undefined : await moveToConflictCopy(r, here, saved.state === 'hashed' ? saved.entry : undefined);
    const old = saved === null ? live : undefined;
    const respelled = old !== undefined && old.path !== j.target;

    if (respelled && fs.caseInsensitive) {
      await renameLocal(r, old.path, j.target);
    }

    const st = await fs.moveTempInto(temp, j.target);

    if (respelled && !fs.caseInsensitive) {
      await fs.remove(old.path);
    }

    r.state.setDisk({ path: j.target, entry: { ...j.entry, size: st.size, mtime: st.mtime } });
    r.state.setSynced({ path: j.path, entry: j.entry });

    if (copy) {
      r.fire({ path: j.target, origin: 'conflict', copy });
    } else if (!j.quiet) {
      r.fire({ path: j.target, origin: 'remote' });
    }
  });
}

export async function deleteHere(r: RoundDeps, dec: DeleteHere, emptied: Set<string>): Promise<void> {
  const { fs, keys } = r.ctx;
  const expected = dec.disk;
  await r.withLock(dec.key, async () => {
    r.signal.throwIfAborted();

    const live = r.state.disk.get(dec.key);

    if (!live) {
      r.state.deleteSynced(dec.key);

      return;
    } else if (await unchangedSince(r, expected, live, expected.path)) {
      await fs.remove(expected.path);
      r.state.deleteDisk(dec.key);
      r.state.deleteSynced(dec.key);
      emptied.add(parentOf(expected.path));
      r.fire({ path: expected.path, origin: 'remote' });

      return;
    }

    const h = await hashFile(fs, keys, live.path, r.partSize);

    if (h.state === 'hashed') {
      r.state.setDisk({ path: live.path, entry: h.entry });
    }
  });
}

async function unchangedSince(r: RoundDeps, expected: DiskRec | undefined, live: DiskRec | undefined, target: string): Promise<boolean> {
  const { fs, keys } = r.ctx;

  if (!expected) {
    return !live && (await fs.stat(target)) === null;
  } else if (!live || live.entry.id !== expected.entry.id || live.path !== expected.path) {
    return false;
  }

  const st = await fs.stat(expected.path);

  if (!st || st.size !== expected.entry.size || st.mtime !== expected.entry.mtime) {
    return false;
  } else if (Date.now() - st.mtime >= RECENT_MS) {
    return true;
  }

  const h = await hashFile(fs, keys, expected.path, r.partSize);

  return h.state === 'hashed' && h.entry.id === expected.entry.id;
}

function blockedChecker(r: RoundDeps): (target: string) => boolean {
  const dirs = dirKeysOf([...r.state.disk.values()].map(rec => rec.path));

  return target => {
    const key = pathKey(target);

    if (dirs.has(key)) {
      return true;
    }

    const segs = key.split('/');

    for (let i = 1; i < segs.length; i++) {
      if (r.state.disk.has(segs.slice(0, i).join('/'))) {
        return true;
      }
    }

    return false;
  };
}
