import ignore from 'ignore';
import { HIDDEN_DIR, parentOf } from '../../../shared/paths.js';

export const IGNORE_FILE = '.pappignore';

const HARD_DIRS = ['.git', HIDDEN_DIR];
const SOFT_DEFAULTS = ['node_modules/', '.DS_Store', 'Thumbs.db', 'desktop.ini', '*.swp', '*.swo', '*~', '.#*', '~$*'];

export interface IgnoreFile {
  dir: string;
  content: string;
}

const GLOB_CHARS = /[*?[\]{}()!+@\\]/;

interface Level {
  dir: string;
  key: string;
  depth: number;
  rules: RuleList;
  lines: string[];
  negations: string[];
}

interface RuleList {
  test(path: string, checkUnignored: boolean, mode: 'regex'): { ignored: boolean; unignored: boolean };
}

export function isHard(path: string): boolean {
  return path.split('/').some(seg => HARD_DIRS.includes(seg.toLowerCase()));
}

export function ignoreRules(files: IgnoreFile[] = []) {
  const byDir = new Map([['', ''], ...files.map(f => [f.dir, f.content] as const)]);
  const levels: Level[] = [...byDir]
    .map(([dir, content]) => {
      const ig = ignore({ ignorecase: true });

      if (dir === '') {
        ig.add(SOFT_DEFAULTS);
      }

      ig.add(content);
      const lines = content.split(/\r?\n/);

      return {
        dir,
        key: dir.toLowerCase(),
        depth: dir === '' ? 0 : dir.split('/').length,
        // ignore 7's public test() also checks parent folders, within one file only; that breaks git's layering across .pappignore files. Only the private rule list tests one path.
        rules: (ig as unknown as { _rules: RuleList })._rules,
        lines,
        negations: lines.filter(x => x.startsWith('!')).map(x => x.slice(1)),
      };
    })
    .sort((a, b) => a.depth - b.depth);
  const dirCache = new Map<string, boolean>();

  function ignores(path: string, isDir = false): boolean {
    if (isHard(path)) {
      return true;
    }

    const parent = parentOf(path);

    if (parent !== '' && dirIgnored(parent)) {
      return true;
    }

    return ownMatch(path, isDir);
  }

  function dirIgnored(dir: string): boolean {
    let ignored = dirCache.get(dir);

    if (ignored === undefined) {
      ignored = ignores(dir, true);
      dirCache.set(dir, ignored);
    }

    return ignored;
  }

  function ownMatch(path: string, isDir: boolean): boolean {
    const segs = path.split('/');
    const key = path.toLowerCase();
    let ignored = false;

    for (const level of levels) {
      if (level.key !== '' && !key.startsWith(level.key + '/')) {
        continue;
      }

      const rel = segs.slice(level.depth).join('/');
      const r = level.rules.test(isDir ? rel + '/' : rel, true, 'regex');

      if (r.ignored) {
        ignored = true;
      } else if (r.unignored) {
        ignored = false;
      }
    }

    return ignored;
  }

  // @parcel/watcher's `ignore` cannot un-ignore and matches globs against whole relative paths, so each folder glob needs a `/**` twin.
  function watcherSkipGlobs(): string[] {
    const globs = ['.git', '**/.git', '**/.git/**', HIDDEN_DIR, `**/${HIDDEN_DIR}`, `**/${HIDDEN_DIR}/**`];

    if (!nodeModulesReincluded()) {
      globs.push('node_modules', '**/node_modules', '**/node_modules/**');
    }

    for (const level of levels) {
      if (GLOB_CHARS.test(level.dir)) {
        continue;
      }

      const below = levels.filter(l => level.key === '' || l.key === level.key || l.key.startsWith(level.key + '/'));

      if (below.some(l => l.negations.length > 0)) {
        continue;
      }

      const prefix = level.dir ? level.dir + '/' : '';

      for (const raw of level.lines) {
        // gitignore strips trailing spaces only.
        const line = raw.trimEnd();

        if (!line.endsWith('/') || line.startsWith('#') || line.includes('\\')) {
          continue;
        }

        let pat = line.slice(0, -1);

        if (pat === '' || pat === '/') {
          continue;
        }

        const anchored = pat.includes('/');
        pat = pat.replace(/^\//, '');
        const glob = anchored ? prefix + pat : `${prefix}**/${pat}`;
        globs.push(glob, glob + '/**');
      }
    }

    return [...new Set(globs)];
  }

  function nodeModulesReincluded(): boolean {
    return levels.some(level => {
      if (level.negations.length === 0) {
        return false;
      }

      const ig = ignore({ ignorecase: true }).add(level.negations);

      return ['node_modules/', 'a/node_modules/', 'a/b/node_modules/'].some(p => ig.ignores(p));
    });
  }

  return { ignores, watcherSkipGlobs };
}
