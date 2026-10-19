import { baseName, joinPath, parentOf, pathKey } from '../../../../shared/paths.js';
import type { DiskRec } from '../../shared/state.js';

export function localTarget(serverPath: string, d: DiskRec | undefined, spell: Map<string, string>): string {
  return d ? joinPath(parentOf(d.path), baseName(serverPath)) : respell(serverPath, spell);
}

export function folderSpellings(paths: string[]): Map<string, string> {
  const spell = new Map<string, string>();

  for (const p of paths) {
    const segs = p.split('/');

    for (let i = 1; i < segs.length; i++) {
      const dir = segs.slice(0, i).join('/');

      if (!spell.has(pathKey(dir))) {
        spell.set(pathKey(dir), dir);
      }
    }
  }

  return spell;
}

export function respell(path: string, spell: Map<string, string>): string {
  let out = '';

  for (const seg of path.split('/').slice(0, -1)) {
    const key = pathKey(joinPath(out, seg));
    const known = spell.get(key);
    out = known === undefined ? joinPath(out, seg) : known;
    spell.set(key, out);
  }

  return joinPath(out, baseName(path));
}
