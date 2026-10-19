import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import { ignoreRules, isHard, type IgnoreFile } from '../src/papp/folder/scan/ignore.js';

const requireFromParcelWatcher = createRequire(createRequire(import.meta.url).resolve('@parcel/watcher'));
const parcelWatcherPicomatch = requireFromParcelWatcher('picomatch') as { (glob: string, opts: { dot: boolean }): (p: string) => boolean; scan(glob: string): { isGlob: boolean } };
const rules = (files: Record<string, string>) => ignoreRules(Object.entries(files).map(([dir, content]) => ({ dir, content })));

describe('ignoreRules: always ignored', () => {
  it('cannot un-ignore .git or the hidden folder', () => {
    const u = rules({ '': '!.git/\n!.git\n!.pappdrive/\n!**/.git/**' });
    expect(u.ignores('.git/config')).toBe(true);
    expect(u.ignores('.pappdrive/synced')).toBe(true);
    expect(isHard('a/.git/x')).toBe(true);
  });
});

describe('ignoreRules: gitignore semantics', () => {
  it('ignores comments, blank lines and trailing spaces; CRLF files work', () => {
    const r = rules({ '': '# *.md\n\n*.tmp   \r\n\\#hash.txt\r\n' });
    expect(r.ignores('a.md')).toBe(false);
    expect(r.ignores('a.tmp')).toBe(true);
    expect(r.ignores('#hash.txt')).toBe(true);
  });
  it('ignores capital letters, on every device', () => {
    const r = rules({ '': '*.LOG\nBuild/\n', Sub: 'Secret.md' });
    expect(r.ignores('a.log')).toBe(true);
    expect(r.ignores('BUILD/x')).toBe(true);
    expect(r.ignores('build/x')).toBe(true);
    expect(r.ignores('sub/secret.md')).toBe(true);
    expect(r.ignores('SUB/SECRET.MD')).toBe(true);
  });
});

describe('ignoreRules: watcherSkipGlobs', () => {
  const matcher = (globs: string[]) => {
    const ms = globs.map(glob => ({ glob, isGlob: parcelWatcherPicomatch.scan(glob).isGlob, match: parcelWatcherPicomatch(glob, { dot: true }) }));

    return (p: string) => ms.some(m => (m.isGlob ? m.match(p) : p === m.glob || p.startsWith(m.glob + '/')));
  };

  it('passes folder rules, anchored or not, relative to their file', () => {
    const skip = matcher(rules({ '': 'build/\n/dist/\nlogs/old/\n*.log\n', sub: 'cache/\n' }).watcherSkipGlobs());
    expect(skip('build')).toBe(true);
    expect(skip('a/build/x.js')).toBe(true);
    expect(skip('dist/x')).toBe(true);
    expect(skip('a/dist/x')).toBe(false);
    expect(skip('logs/old/1')).toBe(true);
    expect(skip('a/logs/old/1')).toBe(false);
    expect(skip('sub/cache/x')).toBe(true);
    expect(skip('sub/a/cache/x')).toBe(true);
    expect(skip('cache/x')).toBe(false);
    expect(skip('a.log')).toBe(false);
  });
  it('never passes ! rules, nor folder rules a ! could re-include', () => {
    const g = rules({ '': 'build/\n', a: '!build/\n' }).watcherSkipGlobs();
    expect(g.some(x => x.startsWith('!'))).toBe(false);
    expect(matcher(g)('a/build/x')).toBe(false);
    const same = matcher(rules({ '': 'out/\n!out/\n' }).watcherSkipGlobs());
    expect(same('out/x')).toBe(false);
    const other = matcher(rules({ '': '*.log\n', a: 'out/\n', b: '!keep.log\n' }).watcherSkipGlobs());
    expect(other('a/out/x')).toBe(true);
  });
  it('keeps watching node_modules when a rule re-includes it', () => {
    expect(matcher(rules({ '': '!node_modules/' }).watcherSkipGlobs())('node_modules/x')).toBe(false);
    expect(matcher(rules({ deep: '!node_*/' }).watcherSkipGlobs())('deep/node_modules/x')).toBe(false);
    expect(matcher(rules({ '': '*.log\n!keep.log' }).watcherSkipGlobs())('node_modules/x')).toBe(true);
  });
});

let git = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  git = false;
}

describe.runIf(git)('ignoreRules agrees with git check-ignore', () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach(r => rmSync(r, { recursive: true, force: true })));

  function gitIgnored(files: IgnoreFile[], paths: string[]): Set<string> {
    const root = mkdtempSync(join(tmpdir(), 'pappignore-git-'));
    roots.push(root);
    execFileSync('git', ['init', '-q', root]);

    for (const p of paths) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), 'x');
    }

    for (const f of files) {
      const content = f.dir === '' ? 'node_modules/\n.DS_Store\n*.swp\n*~\n' + f.content : f.content;
      mkdirSync(join(root, f.dir), { recursive: true });
      writeFileSync(join(root, f.dir, '.gitignore'), content);
    }

    const out = execFileSync('git', ['-C', root, '-c', 'core.ignorecase=true', 'ls-files', '-o', '-i', '--exclude-standard', '-z'], { encoding: 'utf8' });

    return new Set(out.split('\0').filter(Boolean));
  }

  const scenarios: { name: string; files: IgnoreFile[]; paths: string[] }[] = [
    {
      name: 'nested files, ! and folder rules',
      files: [
        { dir: '', content: '*.log\nbuild/\n/out\ndocs/*\n!docs/keep/\n' },
        { dir: 'a', content: '!keep.log\n!build/\n/local.md\n' },
        { dir: 'a/b', content: 'keep.log\n*.md\n!readme.md\n' },
      ],
      paths: [
        'x.log',
        'keep.log',
        'a/keep.log',
        'a/x.log',
        'a/b/keep.log',
        'a/b/c/keep.log',
        'a/c/keep.log',
        'build/o.js',
        'a/build/o.js',
        'a/b/build/o.js',
        'c/build/o.js',
        'x/build',
        'out',
        'out2',
        'c/out',
        'docs/a.md',
        'docs/keep/b.md',
        'docs/keep/x/c.md',
        'a/local.md',
        'a/b/local.md',
        'a/b/readme.md',
        'a/b/notes.md',
        'notes.md',
        'node_modules/m/index.js',
        'a/node_modules/x.js',
        'a/b/.DS_Store',
        'x.swp',
        'x.txt~',
        'src/main.ts',
      ],
    },
    {
      name: 'capital letters',
      files: [
        { dir: '', content: '*.TMP\nCache/\n/Top.md\n' },
        { dir: 'Sub', content: 'Secret.*\n' },
      ],
      paths: ['a.tmp', 'b/C.Tmp', 'cache/x', 'x/CACHE/y', 'top.md', 'x/top.md', 'Sub/secret.txt', 'Sub/x/SECRET.md', 'secret.txt'],
    },
    {
      name: 'excluded folders and re-includes',
      files: [
        { dir: '', content: 'vendor/\n!vendor/keep.js\ntmp/*\n!tmp/.gitkeep\n**/gen/**\n!**/gen/keep/\n' },
        { dir: 'vendor', content: '!*\n' },
      ],
      paths: ['vendor/a.js', 'vendor/keep.js', 'tmp/x', 'tmp/.gitkeep', 'tmp/sub/y', 'gen/a', 'p/gen/b', 'p/gen/keep/c', 'gen.txt'],
    },
  ];

  for (const s of scenarios) {
    it(s.name, () => {
      const expected = gitIgnored(s.files, s.paths);
      const r = ignoreRules(s.files);

      for (const p of s.paths) {
        expect(r.ignores(p), `${p} (git says ${expected.has(p) ? 'ignored' : 'kept'})`).toBe(expected.has(p));
      }
    });
  }
});
