import { dirKeysOf } from '../../../shared/paths.js';
import type { ServerView } from '../shared/state.js';
import { deleteHere } from './apply.js';
import type { Decision } from './decide.js';
import { conflictCopy, conflictName } from './shared/moves.js';
import { Stopped, type RoundDeps } from './shared/types.js';

export async function resolveClashes(r: RoundDeps, decisions: Decision[], view: ServerView): Promise<boolean> {
  const uploads = decisions.filter(d => d.action === 'upload');

  if (uploads.length === 0) {
    return false;
  }

  const mine = new Set(decisions.filter(d => d.action === 'upload' || d.action === 'delete-server').map(d => d.key));
  const paths: CommitPath[] = [];

  for (const [key, v] of view.map) {
    if (!mine.has(key)) {
      paths.push({ key, path: v.path, local: false });
    }
  }

  for (const d of uploads) {
    paths.push({ key: d.key, path: d.disk.path, local: true });
  }

  const clashes = findClashes(paths);

  if (clashes.length === 0) {
    return false;
  }

  const when = new Date();

  for (const c of clashes) {
    if (r.isStopped()) {
      throw new Stopped();
    } else if (c.move === 'file') {
      await conflictCopy(r, c.file.key, c.file.path);
      continue;
    }

    const prefix = c.file.key + '/';
    const localDir = c.inside[0].path.split('/').slice(0, c.file.key.split('/').length).join('/');
    const emptied = new Set<string>();

    for (const d of decisions) {
      if (d.action === 'delete-here' && d.key.startsWith(prefix)) {
        await deleteHere(r, d, emptied);
      }
    }

    const dirs = dirKeysOf([...r.state.disk.values(), ...view.map.values(), ...r.state.synced.values()].map(rec => rec.path));
    const newDir = conflictName(localDir, when, k => r.state.disk.has(k) || r.state.isKnown(k) || dirs.has(k), true);
    await r.ctx.fs.move(localDir, newDir);

    for (const [k, rec] of [...r.state.disk]) {
      if (k.startsWith(prefix)) {
        r.state.deleteDisk(k);
        r.state.setDisk({ ...rec, path: newDir + rec.path.slice(localDir.length) });
      }
    }

    r.fire({ path: c.file.path, origin: 'conflict', copy: newDir });
  }

  await r.state.flush();

  return true;
}

interface CommitPath {
  key: string;
  path: string;
  local: boolean;
}

interface Clash {
  file: CommitPath;
  inside: [CommitPath, ...CommitPath[]];
  move: 'file' | 'folder';
}

export function findClashes(paths: CommitPath[]): Clash[] {
  const clashes = new Map<string, { file: CommitPath; inside: CommitPath[] }>(paths.map(file => [file.key, { file, inside: [] }]));

  for (const p of paths) {
    const segs = p.key.split('/');

    for (let i = 1; i < segs.length; i++) {
      clashes.get(segs.slice(0, i).join('/'))?.inside.push(p);
    }
  }

  const out: Clash[] = [];

  for (const { file, inside } of clashes.values()) {
    const [first, ...rest] = inside;
    const [firstLocal, ...restLocal] = inside.filter(p => p.local);

    if (first === undefined) {
      continue;
    } else if (file.local && firstLocal === undefined) {
      out.push({ file, inside: [first, ...rest], move: 'file' });
    } else if (!file.local && firstLocal !== undefined) {
      out.push({ file, inside: [firstLocal, ...restLocal], move: 'folder' });
    }
  }

  return out;
}
