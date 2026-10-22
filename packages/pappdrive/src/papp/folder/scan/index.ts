import { fromUtf8 } from '../../../shared/bytes.js';
import { SyncError } from '../../../shared/errors.js';
import { IGNORE_FILE, type IgnoreFile, ignoreRules, isHard } from './ignore.js';
import { baseName, dirKeysOf, HIDDEN_DIR, joinPath, parentOf, pathKey, pathProblem } from '../../../shared/paths.js';
import { readAll } from '../files/read.js';
import { hashFile } from '../hash.js';
import type { DiskRec, LocalState } from '../state.js';
import type { Change } from '../../../shared/types.js';
import type { FolderContext } from '../types.js';

interface FoundIgnoreFile extends IgnoreFile {
  path: string;
}

export type Scanner = ReturnType<typeof createScanner>;

export function createScanner(ctx: FolderContext, partSize: number, state: LocalState, fire: (change: Change) => void) {
  let rules = ignoreRules();
  let ignoreFiles: FoundIgnoreFile[] = [];
  let needsFullScan = false;
  const reportedDups = new Set<string>();

  function isIgnored(path: string): boolean {
    return isHard(path) || (!state.isKnown(pathKey(path)) && rules.ignores(path));
  }

  async function refreshRules(): Promise<void> {
    const candidates = new Map(ignoreFiles.map(f => [f.dir, f.path]));

    for (const rec of state.disk.values()) {
      if (baseName(rec.path).toLowerCase() === IGNORE_FILE) {
        candidates.set(parentOf(rec.path), rec.path);
      }
    }

    const files: FoundIgnoreFile[] = [];

    for (const [dir, path] of candidates) {
      const file = await readIgnoreFile(dir, path);

      if (file) {
        files.push(file);
      }
    }

    if (rulesSignature(files) === rulesSignature(ignoreFiles)) {
      return;
    }

    ignoreFiles = files;
    rules = ignoreRules(files);
    needsFullScan = true;
  }

  async function scan(root = ''): Promise<string[]> {
    const rootKey = pathKey(root);
    const under = (key: string) => root === '' || key === rootKey || key.startsWith(rootKey + '/');
    const found = await walk(root, under);
    const before = state.disk;
    const after = new Map([...[...before].filter(([k]) => !under(k)), ...found.disk]);
    state.replaceDisk(after);
    ignoreFiles = found.ignoreFiles;
    rules = found.rules;
    reportDups(found.caseDuplicates);

    if (root === '') {
      needsFullScan = false;
    }

    const changed: string[] = [];

    for (const [k, r] of after) {
      const b = before.get(k);

      if (under(k) && (!b || b.path !== r.path || b.entry.id !== r.entry.id || b.skipped !== r.skipped)) {
        changed.push(r.path);
      }
    }

    for (const [k, r] of before) {
      if (under(k) && !after.has(k)) {
        changed.push(r.path);
      }
    }

    return changed;
  }

  async function processPaths(paths: string[]): Promise<{ changed: string[]; changing: string[] }> {
    const { fs, keys } = ctx;
    const changed: string[] = [];
    const changing: string[] = [];
    let ignoreFileTouched = false;

    for (const path of paths) {
      if (isHard(path)) {
        continue;
      } else if (baseName(path).toLowerCase() === IGNORE_FILE) {
        ignoreFileTouched = true;
      }

      const key = pathKey(path);
      const rec = state.disk.get(key);
      const st = await fs.stat(path);

      if (st) {
        if (isIgnored(path)) {
          continue;
        } else if (pathProblem(path)) {
          if (!rec?.skipped) {
            state.setDisk({ path, entry: { id: '', size: 0, mtime: 0 }, skipped: 'bad name' });
            changed.push(path);
          }

          continue;
        } else if (rec && rec.path === path && !rec.skipped && st.size === rec.entry.size && st.mtime === rec.entry.mtime) {
          continue;
        } else if (rec && rec.path !== path && !fs.caseInsensitive && (await fs.stat(rec.path))) {
          reportDups([path]);
          continue;
        }

        const h = await hashFile(fs, keys, path, partSize);

        if (h.state === 'changing') {
          changing.push(path);
          continue;
        } else if (h.state === 'hashed') {
          state.setDisk({ path, entry: h.entry });
          changed.push(path);
          continue;
        }
      }

      if ((await fs.list(path)).length > 0) {
        changed.push(...(await scan(path)));
        continue;
      }

      for (const [k, r] of [...state.disk]) {
        if ((k === key || k.startsWith(key + '/')) && !(await fs.stat(r.path))) {
          state.deleteDisk(k);
          changed.push(r.path);
        }
      }
    }

    if (ignoreFileTouched) {
      await refreshRules();
    }

    return { changed, changing };
  }

  async function walk(root: string, under: (key: string) => boolean) {
    const { fs, keys } = ctx;
    const known = new Map<string, string>();

    for (const [k, r] of [...(state.server?.map ?? []), ...state.synced]) {
      known.set(k, r.path);
    }

    const knownDirs = dirKeysOf(known.values());
    const walkIgnoreFiles = ignoreFiles.filter(f => !under(pathKey(f.dir)));
    let walkRules = ignoreRules(walkIgnoreFiles);
    const found: DiskRec[] = [];

    const visit = async (dir: string): Promise<void> => {
      const entries = await fs.list(dir);
      const ignoreFile = entries.find(e => !e.dir && e.name.toLowerCase() === IGNORE_FILE);
      const file = ignoreFile && (await readIgnoreFile(dir, joinPath(dir, ignoreFile.name)));

      if (file) {
        walkIgnoreFiles.push(file);
        walkRules = ignoreRules(walkIgnoreFiles);
      }

      for (const e of entries) {
        const path = joinPath(dir, e.name);

        if (e.dir && e.name.toLowerCase() === HIDDEN_DIR) {
          if (dir !== '' && fs.kind === 'visible') {
            throw new SyncError(
              'folder-taken',
              `"${path}" is another app's hidden folder, so another app's folder is inside this one. ` +
                `Two apps cannot sync the same files. Open a folder that does not contain "${dir}", or move that folder out.`
            );
          }

          continue;
        } else if (isHard(path) || (!(e.dir ? knownDirs : known).has(pathKey(path)) && walkRules.ignores(path, e.dir))) {
          continue;
        } else if (e.dir) {
          await visit(path);
          continue;
        } else if (pathProblem(path)) {
          found.push({ path, entry: { id: '', size: 0, mtime: 0 }, skipped: 'bad name' });
          continue;
        }

        const prev = state.disk.get(pathKey(path));
        const st = await fs.stat(path);

        if (!st) {
          continue;
        } else if (prev && !prev.skipped && prev.path === path && st.size === prev.entry.size && st.mtime === prev.entry.mtime) {
          found.push(prev);
          continue;
        }

        const h = await hashFile(fs, keys, path, partSize);

        if (h.state === 'changing') {
          if (prev) {
            found.push(prev);
          }
        } else if (h.state === 'hashed') {
          found.push({ path, entry: h.entry });
        }
      }
    };

    await visit(root);

    const disk = new Map<string, DiskRec>();
    const caseDuplicates: string[] = [];

    for (const rec of found) {
      const key = pathKey(rec.path);
      const had = disk.get(key);

      if (!had) {
        disk.set(key, rec);
      } else if (rec.path === known.get(key)) {
        disk.set(key, rec);
        caseDuplicates.push(had.path);
      } else {
        caseDuplicates.push(rec.path);
      }
    }

    for (const key of dirKeysOf(disk.keys())) {
      const rec = disk.get(key);

      if (rec) {
        disk.delete(key);
        caseDuplicates.push(rec.path);
      }
    }

    return { disk, ignoreFiles: walkIgnoreFiles, rules: walkRules, caseDuplicates };
  }

  async function readIgnoreFile(dir: string, path: string): Promise<FoundIgnoreFile | null> {
    const st = await ctx.fs.stat(path);

    return st && { dir, path, content: fromUtf8.decode(await readAll(ctx.fs, path, st.size, partSize)) };
  }

  function reportDups(paths: string[]): void {
    for (const p of paths) {
      if (reportedDups.has(p)) {
        continue;
      }

      reportedDups.add(p);
      fire({ path: p, origin: 'case-duplicate' });
    }
  }

  return {
    watcherSkipGlobs: () => rules.watcherSkipGlobs(),
    get needsFullScan() {
      return needsFullScan;
    },
    isIgnored,
    refreshRules,
    scan,
    processPaths,
  };
}

function rulesSignature(files: IgnoreFile[]): string {
  return JSON.stringify([...files].sort((a, b) => (a.dir < b.dir ? -1 : 1)).map(f => [f.dir, f.content]));
}
