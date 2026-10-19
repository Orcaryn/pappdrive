import { afterEach, describe, expect, it } from 'vitest';
import type { Coordinator, CoordinatorMessage, FsAdapter } from '../src/shared/platform.js';
import { closeDevices, device, setup } from './helpers/device.js';
import { createMemFs } from './helpers/memfs.js';
import { must } from './helpers/must.js';

afterEach(closeDevices);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function until(cond: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) {
      throw new Error('timed out waiting');
    }

    await sleep(5);
  }
}

interface FakeWatcher {
  watch: NonNullable<FsAdapter['watch']>;
  onPaths: ((p: string[]) => void) | null;
  onDropped: (() => void) | null;
  globs: string[];
}

function createFakeWatcher(): FakeWatcher {
  const watcher: FakeWatcher = {
    onPaths: null,
    onDropped: null,
    globs: [],
    async watch(globs, onPaths, onDropped) {
      watcher.globs = globs;
      watcher.onPaths = onPaths;
      watcher.onDropped = onDropped;

      return async () => {
        watcher.onPaths = null;
      };
    },
  };

  return watcher;
}

describe('files API', () => {
  it('refuses paths outside the folder, into the hidden folder, or through a file', async () => {
    const { server, keys } = await setup(0);
    const { folder } = await device(server, keys);
    await folder.write('notes/a.md', 'a');
    await folder.write('c.txt', 'c');
    await expect(folder.write('/abs.md', 'x')).rejects.toMatchObject({ code: 'bad-path' });
    await expect(folder.write('a/../b.md', 'x')).rejects.toMatchObject({ code: 'bad-path' });
    await expect(folder.write('.pappdrive/x', 'x')).rejects.toMatchObject({ code: 'bad-path' });
    await expect(folder.write('notes', 'x')).rejects.toThrow('is a folder');
    await expect(folder.write('c.txt/inside.md', 'x')).rejects.toThrow('is a file');
  });
});

describe('scheduling', () => {
  it('going to the background ends the debounce and syncs', async () => {
    const { server, keys } = await setup(0);
    const backgroundListeners = new Set<() => void>();
    const d = await device(server, keys, { tuning: { quietMs: 60_000, maxWaitMs: 60_000 } }, false);
    (d.ctx.platform as { onBackground?: (cb: () => void) => () => void }).onBackground = cb => {
      backgroundListeners.add(cb);

      return () => backgroundListeners.delete(cb);
    };

    await d.folder.start();
    await d.folder.sync();
    await d.folder.write('x.md', 'x');
    expect(Object.keys(await server.body(keys))).toEqual([]);
    expect(backgroundListeners.size).toBe(1);
    backgroundListeners.forEach(cb => cb());
    await until(async () => Object.keys(await server.body(keys)).length === 1);
  });
});

describe('push from the server', () => {
  it('a message on the watch socket runs a server-only round; closing the folder stops watching', async () => {
    const { server, keys } = await setup(0);
    const a = await device(server, keys);
    const b = await device(server, keys);
    expect(server.watchers.size).toBe(2);
    await a.folder.write('pushed.md', 'p');
    await a.folder.sync();
    await b.folder.write('held.md', 'h');
    expect(b.changes.map(c => c.path)).not.toContain('pushed.md');
    server.notify();
    await until(() => b.changes.some(c => c.path === 'pushed.md'));
    expect(Object.keys(await server.body(keys))).toEqual(['pushed.md']);
    await b.folder.close();
    expect(server.watchers.size).toBe(1);
  });
});

describe('visible folders and the watcher', () => {
  it('events are hints: after quiet, each file is looked at; a rename-save is one change', async () => {
    const { server, keys } = await setup(0);
    const watcher = createFakeWatcher();
    const a = await device(server, keys, { kind: 'visible', watch: watcher.watch, tuning: { watchQuietMs: 20, watchMaxMs: 200, quietMs: 20, maxWaitMs: 200 } });
    expect(watcher.globs).toEqual(expect.arrayContaining(['**/.git', '.pappdrive', '**/node_modules']));
    a.fs.put('doc.md', 'v1');
    must(watcher.onPaths)(['doc.md']);
    await until(async () => Object.keys(await server.body(keys)).includes('doc.md'));
    const before = a.changes.length;
    await a.fs.remove('doc.md');
    must(watcher.onPaths)(['doc.md']);
    a.fs.put('doc.md', 'version 2');
    must(watcher.onPaths)(['doc.md']);
    await until(async () => (await server.body(keys))['doc.md']?.size === 9);
    expect(a.changes.slice(before)).toEqual([{ path: 'doc.md', origin: 'local' }]);
    await a.fs.remove('doc.md');
    must(watcher.onPaths)(['doc.md']);
    await until(async () => !(await server.body(keys))['doc.md']);
  });

  it('dropped events mean a full scan', async () => {
    const { server, keys } = await setup(0);
    const watcher = createFakeWatcher();
    const a = await device(server, keys, { kind: 'visible', watch: watcher.watch, tuning: { quietMs: 20, maxWaitMs: 200 } });
    a.fs.put('x/a.md', 'a');
    a.fs.put('x/b.md', 'b');
    must(watcher.onDropped)();
    await until(async () => Object.keys(await server.body(keys)).length === 2);
  });

  it('a folder event scans the folder; downloads do not look like local changes', async () => {
    const { server, keys } = await setup(0);
    const watcher = createFakeWatcher();
    const other = await device(server, keys);
    const a = await device(server, keys, { kind: 'visible', watch: watcher.watch, tuning: { watchQuietMs: 10, quietMs: 10, maxWaitMs: 100 } });
    a.fs.put('dir/one.md', '1');
    a.fs.put('dir/two.md', '2');
    must(watcher.onPaths)(['dir']);
    await until(async () => Object.keys(await server.body(keys)).length === 2);
    await other.folder.write('dir/three.md', '3');
    await other.folder.sync();
    const commits = server.commits;
    await a.folder.sync();
    must(watcher.onPaths)(['dir/three.md']);
    await sleep(80);
    expect(server.commits).toBe(commits);
    expect(a.changes.filter(c => c.path === 'dir/three.md').map(c => c.origin)).toEqual(['remote']);
  });

  it('without a watcher, a visible folder is scanned each round', async () => {
    const { server, keys } = await setup(0);
    const a = await device(server, keys, { kind: 'visible' });
    a.fs.put('x.md', 'x');
    await a.folder.sync();
    expect(Object.keys(await server.body(keys))).toEqual(['x.md']);
    expect(a.changes).toContainEqual({ path: 'x.md', origin: 'local' });
  });
});

describe('browser tabs', () => {
  function bus() {
    const subs = new Set<(m: CoordinatorMessage) => void>();
    let leader: object | null = null;
    const waiting: (() => void)[] = [];

    const make = (): Coordinator => {
      const me = {};
      const mine = new Set<(m: CoordinatorMessage) => void>();
      let closed = false;

      return {
        waitForLead: () =>
          new Promise<void>(resolve => {
            const tryTake = () => {
              if (closed) {
                return;
              } else if (!leader) {
                leader = me;
                resolve();
              } else {
                waiting.push(tryTake);
              }
            };

            tryTake();
          }),
        isLeader: () => leader === me,
        post: m => {
          for (const s of subs) {
            if (!mine.has(s)) {
              s(structuredClone(m));
            }
          }
        },
        onMessage: cb => {
          subs.add(cb);
          mine.add(cb);

          return () => {
            subs.delete(cb);
            mine.delete(cb);
          };
        },
        close: () => {
          closed = true;

          for (const s of mine) {
            subs.delete(s);
          }

          if (leader === me) {
            leader = null;
            waiting.splice(0).forEach(f => f());
          }
        },
      };
    };

    return make;
  }

  it("only the leader syncs; a follower's writes reach it, and the follower hears the leader", async () => {
    const { server, keys } = await setup(0);
    const coordinator = bus();
    const shared = createMemFs();
    const lead = await device(server, keys, { fs: shared, coordinator, tuning: { quietMs: 10, maxWaitMs: 100 } });
    const follow = await device(server, keys, { fs: shared, coordinator });
    await follow.folder.write('from-follower.md', 'f');
    expect(follow.changes).toContainEqual({ path: 'from-follower.md', origin: 'local' });
    await until(async () => Object.keys(await server.body(keys)).includes('from-follower.md'));
    expect(follow.folder.status.lastSync).not.toBeNull();
    const other = await device(server, keys);
    await other.folder.write('remote.md', 'r');
    await other.folder.sync();
    await follow.folder.sync();
    expect(follow.changes).toContainEqual({ path: 'remote.md', origin: 'remote' });
    expect(follow.changes.filter(c => c.path === 'from-follower.md')).toHaveLength(1);
    await lead.folder.close();
    await other.folder.write('later.md', 'l');
    await other.folder.sync();
    await until(async () => {
      await follow.folder.sync();

      return shared.text('later.md') === 'l';
    });
  });
});
