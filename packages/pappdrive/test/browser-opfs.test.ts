import { describe, expect, it } from 'vitest';
import { openOpfs } from '../src/browser/opfs/index.js';
import type { OpfsDirHandle, OpfsFileHandle, OpfsWritable } from '../src/browser/opfs/handles.js';

const fail = (name: string) => new DOMException(name, name);
let writesFail = false;

interface FakeFile extends OpfsFileHandle {
  name: string;
  parent: FakeDir;
  data: Uint8Array<ArrayBuffer>;
  mtime: number;
}

interface FakeDir extends OpfsDirHandle {
  name: string;
  kids: Map<string, FakeDir | FakeFile>;
  get(n: string): FakeDir | FakeFile | undefined;
  set(n: string, h: FakeDir | FakeFile): void;
  delete(n: string): void;
  entries(): AsyncIterable<[string, FakeDir | FakeFile]>;
}

function createFakeFile(name: string, parent: FakeDir): FakeFile {
  const file: FakeFile = {
    kind: 'file',
    name,
    parent,
    data: new Uint8Array(0),
    mtime: Date.now(),
    async getFile() {
      if (file.parent.get(file.name) !== file) {
        throw fail('NotFoundError');
      }

      return new File([file.data], file.name, { lastModified: file.mtime });
    },
    async createWritable(): Promise<OpfsWritable> {
      const parts: Uint8Array[] = [];

      return {
        write: async d => {
          if (writesFail) {
            throw fail('AbortError');
          }

          parts.push(d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : new Uint8Array(d));
        },
        close: async () => {
          const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
          let o = 0;

          for (const p of parts) {
            out.set(p, o);
            o += p.length;
          }

          file.data = out;
          file.mtime = Date.now();
        },
        abort: async () => {},
      };
    },
    async move(dir: OpfsDirHandle, to: string) {
      const d = dir as FakeDir;
      const there = d.get(to);

      if (there && there.kind === 'directory') {
        throw fail('TypeMismatchError');
      }

      file.parent.delete(file.name);
      d.set(to, file);
      file.parent = d;
      file.name = to;
    },
  };

  return file;
}

function createFakeDir(name: string, ci: boolean): FakeDir {
  const kids = new Map<string, FakeDir | FakeFile>();
  const k = (n: string) => (ci ? n.toLowerCase() : n);
  const dir: FakeDir = {
    kind: 'directory',
    name,
    kids,
    get: n => kids.get(k(n)),
    set: (n, h) => void kids.set(k(n), h),
    delete: n => void kids.delete(k(n)),
    async getDirectoryHandle(child: string, o?: { create?: boolean }) {
      const h = dir.get(child);

      if (h?.kind === 'file') {
        throw fail('TypeMismatchError');
      } else if (h) {
        return h;
      } else if (!o?.create) {
        throw fail('NotFoundError');
      }

      const d = createFakeDir(child, ci);
      dir.set(child, d);

      return d;
    },
    async getFileHandle(child: string, o?: { create?: boolean }) {
      const h = dir.get(child);

      if (h?.kind === 'directory') {
        throw fail('TypeMismatchError');
      } else if (h) {
        return h;
      } else if (!o?.create) {
        throw fail('NotFoundError');
      }

      const f = createFakeFile(child, dir);
      dir.set(child, f);

      return f;
    },
    async removeEntry(child: string, o?: { recursive?: boolean }) {
      const h = dir.get(child);

      if (!h) {
        throw fail('NotFoundError');
      } else if (h.kind === 'directory' && h.kids.size > 0 && !o?.recursive) {
        throw fail('InvalidModificationError');
      }

      dir.delete(child);
    },
    async *entries(): AsyncIterable<[string, FakeDir | FakeFile]> {
      for (const h of [...kids.values()]) {
        yield [h.name, h];
      }
    },
  };

  return dir;
}

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function setup(ci = false) {
  const top = createFakeDir('', ci);
  const fs = await openOpfs('u1', 'notes', undefined, async () => top);

  return { top, fs };
}

describe('OPFS adapter', () => {
  it('a save cut off mid-write leaves no file under its name, and a finished save replaces the old one', async () => {
    const { fs } = await setup();
    writesFail = true;
    await expect(fs.saveState('app', 'notes')).rejects.toThrow('AbortError');
    writesFail = false;
    expect(await fs.loadState('app')).toBeNull();
    await fs.saveState('app', 'notes');
    await fs.saveState('app', 'journal');
    expect(await fs.loadState('app')).toBe('journal');
  });

  it('moves an empty temp file', async () => {
    const { fs } = await setup();
    await fs.tempAppend('e', new Uint8Array(0));
    expect((await fs.moveTempInto('e', 'empty.txt')).size).toBe(0);
  });

  it('moves files and whole folders', async () => {
    const { fs } = await setup();

    for (const [t, p] of [
      ['1', 'notes/a.md'],
      ['2', 'notes/sub/b.md'],
    ] as const) {
      await fs.tempAppend(t, bytes(p));
      await fs.moveTempInto(t, p);
    }

    await fs.move('notes', 'notes (conflict)');
    expect(await fs.list('notes')).toEqual([]);
    expect(text(await fs.read('notes (conflict)/sub/b.md', 0, 99))).toBe('notes/sub/b.md');
    await fs.move('notes (conflict)/a.md', 'Top.md');
    expect(text(await fs.read('Top.md', 0, 99))).toBe('notes/a.md');
    await expect(fs.move('missing', 'x')).rejects.toMatchObject({ code: 'not-found' });
  });

  it("keeps a read-only mirror apart from the app's own store, but destroy keeps the sibling", async () => {
    const top = createFakeDir('', false);
    const own = await openOpfs('u1', 'dash', undefined, async () => top);
    const mirror = await openOpfs('u1', 'dash', 'my-notes', async () => top);
    await own.saveState('disk', 'own');
    await mirror.saveState('disk', 'mirror');
    expect(await own.loadState('disk')).toBe('own');
    await mirror.destroy();
    expect(await own.loadState('disk')).toBe('own');
    const user = await (await top.getDirectoryHandle('pappdrive')).getDirectoryHandle('u1');
    const names: string[] = [];

    for await (const [n] of user.entries()) {
      names.push(n);
    }

    expect(names).toEqual(['dash']);
  });
});

describe('OPFS adapter on a case-insensitive disk (Safari on a Mac)', () => {
  it('detects it', async () => {
    const { fs } = await setup(true);
    expect(fs.caseInsensitive).toBe(true);
  });
});
