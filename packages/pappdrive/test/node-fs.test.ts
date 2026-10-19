import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { SyncError } from '../src/shared/errors.js';
import { canCreateName, openNodeFs } from '../src/node/fs.js';
import { nodeKeyStore } from '../src/node/keystore.js';
import { openVisibleFolder, privateStorePath } from '../src/node/platform.js';
import { toRelative } from '../src/node/watcher.js';
import { must } from './helpers/must.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const scratch: string[] = [];

const tmp = (label: string) => {
  const d = mkdtempSync(join(tmpdir(), `pappdrive-${label}-`));
  scratch.push(d);

  return d;
};

afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })));

const freshFs = async () => {
  const root = join(tmp('fs'), 'folder');

  return { root, fs: await openNodeFs(root, 'visible') };
};

describe('node FsAdapter', () => {
  it('creates the folder, the hidden folder and its tmp folder, and leaves no probe behind', async () => {
    const { root } = await freshFs();
    expect(statSync(join(root, '.pappdrive', 'tmp')).isDirectory()).toBe(true);
    expect(readdirSync(join(root, '.pappdrive'))).toEqual(['tmp']);
  });

  it('lists links to files as files, leaves out links to folders', async () => {
    const { root, fs } = await freshFs();
    await fsp.writeFile(join(root, 'real.md'), 'x');
    await fsp.mkdir(join(root, 'd'));

    if (!(await createSymlinksUnlessWindowsForbids(root))) {
      return;
    }

    const names = (await fs.list('')).map(e => `${e.name}:${e.dir}`).sort();
    expect(names).toEqual(['.pappdrive:true', 'd:true', 'link.md:false', 'real.md:false']);
  });

  it('maps NFD names on disk to NFC paths, both ways', async () => {
    const { root, fs } = await freshFs();
    const nfc = 'Café/résumé.md'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    await fsp.mkdir(join(root, 'Café'.normalize('NFD')));
    await fsp.writeFile(join(root, nfd), 'bonjour');
    const top = await fs.list('');
    expect(top.map(e => e.name)).toContain('Café'.normalize('NFC'));
    const inner = await fs.list('Café'.normalize('NFC'));
    expect(inner).toEqual([{ name: 'résumé.md'.normalize('NFC'), dir: false }]);
    expect((await fs.stat(nfc))?.size).toBe(7);
    expect(dec.decode(await fs.read(nfc, 0, 100))).toBe('bonjour');
    await fs.tempAppend('t1', enc.encode('salut'));
    await fs.moveTempInto('t1', nfc);
    expect(await fs.list('Café'.normalize('NFC'))).toHaveLength(1);
    expect(dec.decode(await fs.read(nfc, 0, 100))).toBe('salut');
    await fs.remove(nfc);
    expect(await fs.stat(nfc)).toBeNull();
    await fs.removeEmptyDirs('Café'.normalize('NFC'));
    expect((await fs.list('')).map(e => e.name)).toEqual(['.pappdrive']);
  });

  it("canCreate follows the system's rules", () => {
    expect(canCreateName('a:b.md', false)).toBe(true);
    expect(canCreateName('what?.md', false)).toBe(true);
    expect(canCreateName('CON', false)).toBe(true);
    expect(canCreateName('a/b', false)).toBe(false);
    expect(canCreateName('a\0b', false)).toBe(false);

    for (const bad of ['a:b.md', 'x<y', 'q?', 's*', 'quote"', 'pipe|', 'back\\slash', 'dot.', 'space ', 'CON', 'con.txt', 'NUL', 'com1', 'LPT9.log', 'COM¹', 'aux.md']) {
      expect(canCreateName(bad, true), bad).toBe(false);
    }

    for (const good of ['todo.md', 'console.md', 'com10', 'a.b.c', '.hidden', 'café']) {
      expect(canCreateName(good, true), good).toBe(true);
    }
  });

  it('moves files and folders, and renames when only capitals change', async () => {
    const { root, fs } = await freshFs();
    await fsp.mkdir(join(root, 'notes'));
    await fsp.writeFile(join(root, 'notes', 'a.md'), 'a');
    await fs.move('notes/a.md', 'other/b.md');
    expect(await fs.stat('notes/a.md')).toBeNull();
    expect((await fs.stat('other/b.md'))?.size).toBe(1);
    await fs.move('other', 'notes (conflict)/inner');
    expect((await fs.stat('notes (conflict)/inner/b.md'))?.size).toBe(1);
    await fs.move('notes (conflict)/inner/b.md', 'notes (conflict)/inner/B.md');
    expect(readdirSync(join(root, 'notes (conflict)', 'inner'))).toEqual(['B.md']);
    await fs.move('notes (conflict)', 'Notes (Conflict)');
    expect(readdirSync(root).sort()).toEqual(['.pappdrive', 'Notes (Conflict)', 'notes']);
  });

  it('removes empty folders up to the first non-empty one, never the top or the hidden folder', async () => {
    const { root, fs } = await freshFs();
    await fsp.mkdir(join(root, 'a', 'b', 'c'), { recursive: true });
    await fsp.writeFile(join(root, 'a', 'keep.md'), 'k');
    await fs.removeEmptyDirs('a/b/c');
    expect(existsSync(join(root, 'a', 'b'))).toBe(false);
    expect(existsSync(join(root, 'a', 'keep.md'))).toBe(true);
    await fsp.rm(join(root, 'a', 'keep.md'));
    await fsp.mkdir(join(root, 'x', 'y'), { recursive: true });
    await fsp.writeFile(join(root, 'x', 'y', '.DS_Store'), 'junk');
    await fs.removeEmptyDirs('x/y');
    expect(existsSync(join(root, 'x'))).toBe(false);
    await fs.removeEmptyDirs('a');
    await fs.removeEmptyDirs('');
    await fs.removeEmptyDirs('missing/deeper');
    expect(existsSync(root)).toBe(true);
    await fs.removeEmptyDirs('.pappdrive/tmp');
    expect(existsSync(join(root, '.pappdrive', 'tmp'))).toBe(true);
  });

  it('saves state atomically and loads it back', async () => {
    const { root, fs } = await freshFs();
    expect(await fs.loadState('synced')).toBeNull();
    await fs.saveState('synced', '{"a":1}');
    await fs.saveState('synced', '{"a":2}');
    expect(await fs.loadState('synced')).toBe('{"a":2}');
    expect(readdirSync(join(root, '.pappdrive')).sort()).toEqual(['synced', 'tmp']);
    await Promise.all(Array.from({ length: 20 }, (_, i) => fs.saveState('disk', JSON.stringify({ i }))));
    expect(JSON.parse(must(await fs.loadState('disk')))).toHaveProperty('i');
  });

  it('destroy: a visible folder loses only its hidden folder', async () => {
    const { root, fs } = await freshFs();
    await fsp.writeFile(join(root, 'mine.md'), "the user's file");
    await fs.saveState('synced', '{}');
    await fs.destroy();
    expect(readdirSync(root)).toEqual(['mine.md']);
  });
});

describe('node platform', () => {
  const saved = process.env.PAPPDRIVE_DATA_DIR;
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.PAPPDRIVE_DATA_DIR;
    } else {
      process.env.PAPPDRIVE_DATA_DIR = saved;
    }
  });

  it("openVisible creates the folder and refuses one inside another app's folder", async () => {
    const base = tmp('vis');
    const outer = await openVisibleFolder(join(base, 'outer'));
    expect(outer.kind).toBe('visible');
    await openVisibleFolder(join(base, 'sibling', 'deep'));
    await expect(openVisibleFolder(join(base, 'outer', 'sub', 'inner'))).rejects.toMatchObject({
      code: 'folder-taken',
      message: expect.stringContaining(`Open a folder outside "${join(base, 'outer')}"`),
    });
    expect(existsSync(join(base, 'outer', 'sub'))).toBe(false);
    await openVisibleFolder(join(base, 'outer'));
  });

  it('keeps a read-only mirror next to the own store, never inside it', () => {
    process.env.PAPPDRIVE_DATA_DIR = '/data';
    const own = privateStorePath('u1', 'dashboard');
    const mirror = privateStorePath('u1', 'dashboard', 'my-notes');
    expect(own).toBe(join('/data', 'u1', 'dashboard'));
    expect(mirror).toBe(join('/data', 'u1', 'dashboard.read', 'my-notes'));
    expect(mirror.startsWith(own + '/')).toBe(false);
    expect(() => privateStorePath('../x', 'a')).toThrow(SyncError);
  });
});

describe('watcher paths', () => {
  it('keeps names starting with .., and matches a root spelled in NFD', () => {
    expect(toRelative('/r/folder', '/r/folder/..x.md')).toBe('..x.md');
    expect(toRelative('/r/Café', '/r/Café/é.md'.normalize('NFC'))).toBe('é.md'.normalize('NFC'));
  });
});

describe('key store, file fallback', () => {
  it('stores keys in a 0600 file in a 0700 folder', async () => {
    const dir = join(tmp('keys'), 'pappdrive');
    const ks = nodeKeyStore({ backend: 'file', dir });
    expect(await ks.get('pappdrive:https://x.example:app')).toBeNull();
    await ks.set('pappdrive:https://x.example:app', '{"k":1}');
    expect(await ks.get('pappdrive:https://x.example:app')).toBe('{"k":1}');
    await ks.set('pappdrive:https://x.example:app', '{"k":2}');
    expect(await ks.get('pappdrive:https://x.example:app')).toBe('{"k":2}');
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);

    if (process.platform !== 'win32') {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, must(files[0]))).mode & 0o777).toBe(0o600);
    }

    await ks.delete('pappdrive:https://x.example:app');
    await ks.delete('pappdrive:https://x.example:app');
    expect(await ks.get('pappdrive:https://x.example:app')).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });
});

async function createSymlinksUnlessWindowsForbids(root: string): Promise<boolean> {
  return Promise.all([
    fsp.symlink(join(root, 'real.md'), join(root, 'link.md')),
    fsp.symlink(join(root, 'd'), join(root, 'dlink')),
    fsp.symlink(join(root, 'gone'), join(root, 'broken')),
  ]).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (process.platform === 'win32' && e.code === 'EPERM') {
        return false;
      }

      throw e;
    }
  );
}
