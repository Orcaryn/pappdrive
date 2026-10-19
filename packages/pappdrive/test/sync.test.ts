import { afterEach, describe, expect, it } from 'vitest';
import { DELTA_MAX, type DeltaFile } from '@pappdrive/protocol';
import { withPlainBuffer } from '../src/shared/bytes.js';
import { closeDevices, device, PS, setup, type Device } from './helpers/device.js';
import { createMemFs, type MemFs } from './helpers/memfs.js';
import { must } from './helpers/must.js';

afterEach(closeDevices);

const conflictCopies = (fs: MemFs) => fs.paths().filter(p => p.includes('(conflict '));

describe('two devices', () => {
  it('the server sees no plaintext; an idle sync commits nothing', async () => {
    const { server, devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('notes/todo.md', 'buy milk');
    await a.folder.sync();
    await b.folder.sync();

    for (const blob of server.blobs.values()) {
      expect(new TextDecoder().decode(blob)).not.toContain('milk');
    }

    expect(server.texts()).not.toContain('todo');
    const commits = server.commits;
    await a.folder.sync();
    await b.folder.sync();
    expect(server.commits).toBe(commits);
  });

  it("both change a file: the server keeps the path, this device's version becomes a conflict copy", async () => {
    const { devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('todo.md', 'v1');
    await a.folder.sync();
    await b.folder.sync();
    await a.folder.write('todo.md', 'from a');
    await b.folder.write('todo.md', 'from b');
    await a.folder.sync();
    await b.folder.sync();
    expect(await b.folder.readText('todo.md')).toBe('from a');
    const copies = conflictCopies(b.fs);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/^todo \(conflict \d{4}-\d\d-\d\d \d\d-\d\d-\d\d\)\.md$/);
    expect(b.fs.text(must(copies[0]))).toBe('from b');
    const conflict = b.changes.find(c => c.origin === 'conflict');
    expect(conflict).toEqual({ path: 'todo.md', origin: 'conflict', copy: copies[0] });
    await a.folder.sync();
    expect(a.fs.text(must(copies[0]))).toBe('from b');
  });

  it('both new with the same contents is not a conflict; different contents is', async () => {
    const { devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('same.md', 'x');
    await b.folder.write('same.md', 'x');
    await a.folder.write('diff.md', 'a');
    await b.folder.write('diff.md', 'b');
    await a.folder.sync();
    await b.folder.sync();
    expect(b.fs.text('same.md')).toBe('x');
    expect(b.fs.text('diff.md')).toBe('a');
    expect(conflictCopies(b.fs).map(p => b.fs.text(p))).toEqual(['b']);
  });

  it('edit beats delete, in both directions', async () => {
    const { devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('x.md', 'v1');
    await a.folder.write('y.md', 'v1');
    await a.folder.sync();
    await b.folder.sync();
    await a.folder.remove('x.md');
    await a.folder.sync();
    await b.folder.write('x.md', 'edited');
    await b.folder.sync();
    expect(b.fs.text('x.md')).toBe('edited');
    await a.folder.sync();
    expect(a.fs.text('x.md')).toBe('edited');
    await a.folder.write('y.md', 'edited');
    await a.folder.sync();
    await b.folder.remove('y.md');
    await b.folder.sync();
    expect(b.fs.text('y.md')).toBe('edited');
  });

  it('a save during the download becomes a conflict copy, not lost', async () => {
    const { server, devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('n.md', 'v1');
    await a.folder.sync();
    await b.folder.sync();
    await a.folder.write('n.md', 'from a');
    await a.folder.sync();
    server.beforeBlobGet = () => {
      b.fs.put('n.md', 'saved on b');
      server.beforeBlobGet = null;
    };

    await b.folder.sync();
    expect(b.fs.text('n.md')).toBe('from a');
    expect(conflictCopies(b.fs).map(p => b.fs.text(p))).toEqual(['saved on b']);
  });
});

describe('the delta file', () => {
  const deltaOf = (server: { delta: { text: string } | null }) => JSON.parse(must(server.delta).text) as DeltaFile;

  it('the first commit is a checkpoint; later small commits only rewrite the delta', async () => {
    const { server, keys, devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('a.md', 'one');
    await a.folder.sync();
    expect(server.indexes.size).toBe(1);
    expect(deltaOf(server).blobs).toEqual({});
    await a.folder.write('b.md', 'two');
    await a.folder.sync();
    await a.folder.remove('a.md');
    await a.folder.sync();
    expect(server.indexes.size).toBe(1);
    expect(Object.keys(deltaOf(server).blobs)).toHaveLength(1);
    expect(await server.body(keys)).toEqual({ 'b.md': expect.objectContaining({ size: 3 }) });
    await b.folder.sync();
    expect(b.fs.paths()).toEqual(['b.md']);
    expect(b.fs.text('b.md')).toBe('two');
  });

  it('a device that already holds the base index applies the delta without fetching the index again', async () => {
    const { devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('a.md', 'x');
    await a.folder.sync();
    await b.folder.sync();
    const realGetIndex = b.ctx.api.getIndex;
    let indexFetches = 0;
    b.ctx.api.getIndex = id => {
      indexFetches++;

      return realGetIndex(id);
    };

    await a.folder.write('b.md', 'y');
    await a.folder.sync();
    await b.folder.sync();
    expect(indexFetches).toBe(0);
    expect(b.fs.paths().sort()).toEqual(['a.md', 'b.md']);
  });

  it('a delta past the cap becomes a checkpoint, and the delta starts empty again', async () => {
    const { server, keys, devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('first.md', 'x');
    await a.folder.sync();

    for (let i = 0; i < DELTA_MAX; i++) {
      await a.folder.write(`n/${i}.md`, String(i));
    }

    await a.folder.sync();
    expect(server.indexes.size).toBe(1);
    expect(Object.keys(deltaOf(server).blobs)).toHaveLength(DELTA_MAX);
    await a.folder.write('one-more.md', 'y');
    await a.folder.sync();
    expect(server.indexes.size).toBe(2);
    expect(deltaOf(server).blobs).toEqual({});
    expect(Object.keys(await server.body(keys))).toHaveLength(DELTA_MAX + 2);
    await b.folder.sync();
    expect(b.fs.paths()).toHaveLength(DELTA_MAX + 2);
  });
});

describe('local deletes', () => {
  it('a file edited after the decision is kept and uploaded, not deleted', async () => {
    const { server, keys, devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('gone.md', 'v1');
    await a.folder.write('other.md', 'v1');
    await a.folder.sync();
    await b.folder.sync();
    await a.folder.remove('gone.md');
    await a.folder.write('other.md', 'v2');
    await a.folder.sync();
    server.beforeBlobGet = () => {
      b.fs.put('gone.md', 'edited on b');
      server.beforeBlobGet = null;
    };

    await b.folder.sync();
    expect(b.fs.text('gone.md')).toBe('edited on b');
    await b.folder.sync();
    expect(Object.keys(await server.body(keys)).sort()).toEqual(['gone.md', 'other.md']);
    await a.folder.sync();
    expect(a.fs.text('gone.md')).toBe('edited on b');
  });
});

describe('a file and a folder with the same name', () => {
  it('this device made the file: the file moves', async () => {
    const { devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('notes/a.md', 'in folder');
    await a.folder.sync();
    await b.folder.write('notes', 'a file');
    await b.folder.sync();
    expect(b.fs.text('notes/a.md')).toBe('in folder');
    const copies = conflictCopies(b.fs);
    expect(copies).toEqual([expect.stringMatching(/^notes \(conflict .*\)$/)]);
    expect(b.fs.text(must(copies[0]))).toBe('a file');
    expect(b.changes.filter(c => c.origin === 'conflict')).toEqual([{ path: 'notes', origin: 'conflict', copy: copies[0] }]);
    await a.folder.sync();
    expect(a.fs.text(must(copies[0]))).toBe('a file');
  });

  it('this device made the folder: the folder moves, with every file in it', async () => {
    const { server, devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('notes', 'a file');
    await a.folder.sync();
    await b.folder.write('notes/a.md', 'one');
    await b.folder.write('notes/sub/b.md', 'two');
    await b.folder.sync();
    expect(b.fs.text('notes')).toBe('a file');
    const dir = must(b.changes.find(c => c.origin === 'conflict')?.copy);
    expect(dir).toMatch(/^notes \(conflict .*\)$/);
    expect(b.fs.text(`${dir}/a.md`)).toBe('one');
    expect(b.fs.text(`${dir}/sub/b.md`)).toBe('two');
    await a.folder.sync();
    expect(a.fs.text(`${dir}/sub/b.md`)).toBe('two');
    expect(new Set(server.puts).size).toBe(server.puts.length);
  });
});

describe('capital letters', () => {
  it('a case-insensitive device sees two new spellings as one path: a conflict, not two files', async () => {
    const { server, keys } = await setup(0);
    const linux = await device(server, keys);
    const mac = await device(server, keys, { caseInsensitive: true });
    await linux.folder.write('Todo.md', 'linux');
    await linux.folder.sync();
    await mac.folder.write('todo.md', 'mac');
    await mac.folder.sync();
    expect(mac.fs.text('todo.md')).toBe('linux');
    expect(mac.fs.paths().filter(p => p.toLowerCase() === 'todo.md')).toEqual(['Todo.md']);
    expect(conflictCopies(mac.fs).map(p => mac.fs.text(p))).toEqual(['mac']);
  });

  it('a case-sensitive disk with two spellings syncs the first and reports the second', async () => {
    const { server, keys } = await setup(0);
    const fs = createMemFs({ kind: 'visible' });
    fs.put('Todo.md', 'first');
    fs.put('todo.md', 'second');
    const a = await device(server, keys, { fs });
    const body = await server.body(keys);
    expect(Object.keys(body)).toHaveLength(1);
    const dup = must(a.changes.find(c => c.origin === 'case-duplicate'));
    expect(Object.keys(body)[0]).not.toBe(dup.path);
  });

  it('write refuses a second spelling', async () => {
    const { devs } = await setup(1);
    const [a] = devs as [Device];
    await a.folder.write('Notes/Todo.md', 'x');
    await expect(a.folder.write('Notes/todo.md', 'y')).rejects.toMatchObject({ code: 'case-clash' });
  });

  it('a change of capitals only is a rename that syncs', async () => {
    const { server, keys } = await setup(0);
    const a = await device(server, keys, { kind: 'visible' });
    const mac = await device(server, keys, { caseInsensitive: true });
    await a.folder.write('todo.md', 'x');
    await a.folder.sync();
    await mac.folder.sync();
    await a.fs.move('todo.md', 'TODO.md');
    await a.folder.sync();
    await mac.folder.sync();
    expect(mac.fs.paths()).toEqual(['TODO.md']);
    expect(Object.keys(await server.body(keys))).toEqual(['TODO.md']);
  });
});

describe('skipped paths', () => {
  it('a name this system cannot create freezes the path everywhere', async () => {
    const { server, keys } = await setup(0);
    const mac = await device(server, keys);
    const win = await device(server, keys, { canCreate: s => !s.includes(':') });
    await mac.folder.write('a:b.md', 'v1');
    await mac.folder.write('ok.md', 'fine');
    await mac.folder.sync();
    await win.folder.sync();
    expect(win.fs.paths()).toEqual(['ok.md']);
    expect(win.folder.status.skipped).toEqual(['a:b.md']);
    expect(win.changes).toContainEqual({ path: 'a:b.md', origin: 'skipped', reason: 'bad name' });
    await win.folder.write('ok.md', 'changed');
    await win.folder.sync();
    expect(Object.keys(await server.body(keys)).sort()).toEqual(['a:b.md', 'ok.md']);
    await mac.folder.write('a:b.md', 'v2');
    await mac.folder.sync();
    await win.folder.sync();
    expect(win.fs.paths()).toEqual(['ok.md']);
    expect(Object.keys(await server.body(keys)).sort()).toEqual(['a:b.md', 'ok.md']);
  });

  it('a bad name made by another program is skipped, never uploaded', async () => {
    const { server, keys } = await setup(0);
    const fs = createMemFs({ kind: 'visible' });
    fs.put('bad\u0001name.md', 'x');
    fs.put('good.md', 'y');
    const a = await device(server, keys, { fs });
    expect(Object.keys(await server.body(keys))).toEqual(['good.md']);
    expect(a.folder.status.skipped).toEqual(['bad\u0001name.md']);
    expect(a.changes).toContainEqual({ path: 'bad\u0001name.md', origin: 'skipped', reason: 'bad name' });
  });
});

describe('missing local state', () => {
  it('same contents are adopted, different contents become a conflict copy, nothing is deleted', async () => {
    const { server, keys, devs } = await setup(1);
    const [a] = devs as [Device];
    await a.folder.write('same.md', 'same');
    await a.folder.write('diff.md', 'server');
    await a.folder.write('only-server.md', 's');
    await a.folder.sync();
    const puts = server.puts.length;
    const fs = createMemFs();
    fs.put('same.md', 'same');
    fs.put('diff.md', 'local');
    fs.put('only-local.md', 'l');
    const b = await device(server, keys, { fs });
    expect(fs.text('same.md')).toBe('same');
    expect(fs.text('diff.md')).toBe('server');
    expect(fs.text('only-server.md')).toBe('s');
    expect(conflictCopies(fs).map(p => fs.text(p))).toEqual(['local']);
    expect(Object.keys(await server.body(keys)).sort()).toEqual(['diff.md', 'only-local.md', 'only-server.md', 'same.md', must(conflictCopies(fs)[0])].sort());
    expect(server.puts.length).toBe(puts + 2);
    expect(b.changes.filter(c => c.origin === 'conflict')).toHaveLength(1);
  });
});

describe('ignore rules', () => {
  it('ignored files stay here; a synced file keeps syncing when a new rule matches it (the git rule)', async () => {
    const { server, keys, devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('build.log', 'synced before the rule');
    await a.folder.sync();
    await a.folder.write('.pappignore', '*.log\ncache/\n');
    await a.folder.write('new.log', 'never uploaded');
    await a.folder.write('cache/x.bin', 'local cache');
    await a.folder.write('node_modules/pkg/index.js', 'always ignored');
    expect(a.changes.map(c => c.path)).not.toContain('new.log');
    await a.folder.sync();
    expect(Object.keys(await server.body(keys)).sort()).toEqual(['.pappignore', 'build.log']);
    expect(await a.folder.readText('new.log')).toBe('never uploaded');
    await a.folder.write('build.log', 'edited after the rule');
    await a.folder.sync();
    await b.folder.sync();
    expect(b.fs.text('build.log')).toBe('edited after the rule');
    expect(b.fs.text('.pappignore')).toBe('*.log\ncache/\n');
    await b.folder.write('b.log', 'b only');
    await b.folder.sync();
    expect(Object.keys(await server.body(keys)).sort()).toEqual(['.pappignore', 'build.log']);
  });
});

describe('big files', () => {
  it('are cut into parts; the header lists every part but not the file id', async () => {
    const { server, keys, devs } = await setup();
    const [a, b] = devs as [Device, Device];
    const data = new Uint8Array(PS * 2 + 100).map((_, i) => (i * 7) % 251);
    await a.folder.write('video.bin', new Blob([data]));
    await a.folder.sync();
    const body = await server.body(keys);
    const e = must(body['video.bin']);
    const parts = must(e.parts);
    expect(parts).toHaveLength(3);
    expect(e.size).toBe(data.length);
    expect(Object.keys(server.header()).sort()).toEqual([...parts].sort());
    expect(server.header()[e.id]).toBeUndefined();
    expect(server.header()[must(parts[2])]).toBe(100 + 29);
    await b.folder.sync();
    expect(await b.folder.read('video.bin')).toEqual(data);
    const chunks: Uint8Array[] = [];
    const r = b.folder.readStream('video.bin').getReader();

    for (;;) {
      const { done, value } = await r.read();

      if (done) {
        break;
      }

      chunks.push(value);
    }

    expect(new Uint8Array(await new Blob(chunks.map(c => withPlainBuffer(c))).arrayBuffer())).toEqual(data);
    const puts = server.puts.length;
    const changed = data.slice();
    changed[changed.length - 1] = 0;
    await a.folder.write('video.bin', changed);
    await a.folder.sync();
    expect(server.puts.length).toBe(puts + 1);
  });

  it('a download that stopped halfway continues from the last whole part', async () => {
    const { server, keys, devs } = await setup(1);
    const [a] = devs as [Device];
    const data = new Uint8Array(PS * 3 + 5).map((_, i) => i % 256);
    await a.folder.write('big.bin', data);
    await a.folder.sync();
    const e = must((await server.body(keys))['big.bin']);
    const fs = createMemFs();
    await fs.tempAppend(e.id, data.slice(0, PS + 10));
    const fetched: string[] = [];
    server.beforeBlobGet = id => void fetched.push(id);
    await device(server, keys, { fs });
    expect(fetched).toEqual(must(e.parts).slice(1));
    expect(fs.files.get('big.bin')?.data).toEqual(data);
    expect(fs.temps.size).toBe(0);
  });

  it('uploads every blob of a burst of files once', async () => {
    const { server, devs } = await setup(1);
    const [a] = devs as [Device];

    for (let i = 0; i < 230; i++) {
      await a.folder.write(`f/${i}.md`, `file ${i}`);
    }

    await a.folder.sync();
    expect(server.puts).toHaveLength(230);
  });
});

describe('commits', () => {
  it('a stale commit (412) runs the round again and keeps both changes', async () => {
    const { server, keys, devs } = await setup();
    const [a, b] = devs as [Device, Device];
    await a.folder.write('a.md', 'a');
    await b.folder.write('b.md', 'b');
    server.beforeCommit = async () => {
      server.beforeCommit = null;
      await b.folder.sync();
    };

    await a.folder.sync();
    expect(Object.keys(await server.body(keys)).sort()).toEqual(['a.md', 'b.md']);
    expect(a.fs.text('b.md')).toBe('b');
    expect(a.folder.status.error).toBeNull();
  });

  it('missing blobs (422) are uploaded again and the commit is resent', async () => {
    const { server, keys, devs } = await setup(1);
    const [a] = devs as [Device];
    await a.folder.write('a.md', 'hello');
    server.beforeCommit = n => {
      if (n === 1) {
        server.blobs.clear();
      }
    };

    await a.folder.sync();
    expect(Object.keys(await server.body(keys))).toEqual(['a.md']);
    expect(server.blobs.size).toBe(1);
    expect(a.folder.status.error).toBeNull();
  });

  it('an upload stopped before its commit is not sent again', async () => {
    const { server, devs } = await setup(1);
    const [a] = devs as [Device];
    await a.folder.write('a.md', 'hello');
    server.beforeCommit = () => {
      throw new TypeError('network down');
    };

    await expect(a.folder.sync()).rejects.toThrow('network down');
    expect(a.folder.status.error).toContain('network down');
    server.beforeCommit = null;
    const attempts = server.putAttempts;
    await a.folder.sync();
    expect(server.putAttempts).toBe(attempts);
    expect(a.folder.status.pending).toBe(0);
  });
});

describe('failures and deletion', () => {
  it('a failed fetch is never an empty server', async () => {
    const { server, devs } = await setup(1);
    const [a] = devs as [Device];
    await a.folder.write('a.md', 'x');
    await a.folder.sync();
    server.offline = true;
    await a.folder.write('b.md', 'y');
    await expect(a.folder.sync()).rejects.toMatchObject({ code: 'network' });
    expect(a.folder.status.error).toMatch(/^network: /);
    expect(a.fs.paths()).toEqual(['a.md', 'b.md']);
    expect(a.folder.status.pending).toBe(1);
    server.offline = false;
    await a.folder.sync();
    expect(a.folder.status.error).toBeNull();
    expect(a.folder.status.pending).toBe(0);
  });

  it('a vanished index: ask the account layer, upload nothing', async () => {
    const { server, devs } = await setup(1);
    const [a] = devs as [Device];
    await a.folder.write('a.md', 'x');
    await a.folder.sync();
    server.delta = null;
    server.blobs.clear();
    const puts = server.putAttempts;
    await expect(a.folder.sync()).rejects.toThrow('index is missing');
    expect(a.gone.calls).toBe(1);
    expect(server.putAttempts).toBe(puts);
    expect(server.delta).toBeNull();
    expect(a.fs.paths()).toEqual(['a.md']);
    expect(a.folder.status.error).toContain('index is missing');
  });

  it('a deleted folder stops syncing and deletes the hidden folder', async () => {
    const { server, keys } = await setup(0);
    const a = await device(server, keys, { kind: 'visible', gone: 'app' });
    await a.folder.write('a.md', 'x');
    await a.folder.sync();
    const statuses: (string | null)[] = [];
    a.folder.onStatus(s => statuses.push(s.deleted));
    server.delta = null;
    await a.folder.sync();
    expect(a.folder.status.deleted).toBe('app');
    expect(statuses).toContain('app');
    expect(a.fs.destroyed).toBe(true);
    expect(a.fs.paths()).toEqual(['a.md']);
    await expect(a.folder.write('b.md', 'y')).rejects.toMatchObject({ code: 'gone', reason: 'app' });
  });

  it('an unknown index version stops sync and asks for an update', async () => {
    const { server, devs } = await setup(1);
    const [a] = devs as [Device];
    server.writeDelta({ v: 2, base: '', blobs: {}, body: '' } as never);
    await a.folder.write('a.md', 'x');
    await expect(a.folder.sync()).rejects.toMatchObject({ code: 'update-needed' });
    expect(a.folder.status.error).toMatch(/^update-needed: .*Update the pappdrive package/);
    const commits = server.commits;
    await expect(a.folder.sync()).rejects.toMatchObject({ code: 'update-needed' });
    expect(server.commits).toBe(commits);
  });
});

describe('read-only folders', () => {
  it('mirror the server and refuse writes', async () => {
    const { server, keys } = await setup(0);
    const a = await device(server, keys);
    const r0 = await device(server, keys, { readOnly: true });
    expect(r0.folder.status.error).toBeNull();
    await a.folder.write('todo.md', 'x');
    await a.folder.write('old.md', 'y');
    await a.folder.sync();
    const r = await device(server, keys, { readOnly: true });
    expect(await r.folder.readText('todo.md')).toBe('x');
    await expect(r.folder.write('n.md', 'z')).rejects.toMatchObject({ code: 'read-only' });
    await expect(r.folder.remove('todo.md')).rejects.toMatchObject({ code: 'read-only' });
    await a.folder.remove('old.md');
    await a.folder.sync();
    await r.folder.sync();
    expect(r.fs.paths()).toEqual(['todo.md']);
    const commits = server.commits;
    await r.folder.sync();
    expect(server.commits).toBe(commits);
    server.delta = null;
    await r.folder.sync();
    expect(r.gone.calls).toBe(0);
    expect(r.fs.paths()).toEqual([]);
  });
});

describe('opening', () => {
  it("refuses a visible folder with another app's folder inside it", async () => {
    const { server, keys } = await setup(0);
    const fs = createMemFs({ kind: 'visible' });
    fs.dirs.set('sub/.pappdrive', 'sub/.pappdrive');
    const d = await device(server, keys, { fs }, false);
    await expect(d.folder.start()).rejects.toMatchObject({ code: 'folder-taken' });
  });

  it('refuses a folder that belongs to another app', async () => {
    const { server, keys } = await setup(0);
    const fs = createMemFs({ kind: 'visible' });
    fs.state.set('app', 'journal');
    const d = await device(server, keys, { fs }, false);
    await expect(d.folder.start()).rejects.toMatchObject({ code: 'folder-taken' });
  });
});
