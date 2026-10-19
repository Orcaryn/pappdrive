import { afterEach, describe, expect, it } from 'vitest';
import { browserCoordinator, type LockManagerLike } from '../src/browser/coordinator.js';
import type { Coordinator } from '../src/shared/platform.js';

function fakeLocks(): LockManagerLike {
  const queues = new Map<string, { cb: () => Promise<void>; done: (v: unknown) => void; fail: (e: unknown) => void }[]>();
  const held = new Set<string>();

  const pump = (name: string) => {
    if (held.has(name)) {
      return;
    }

    const q = queues.get(name) ?? [];
    const next = q.shift();

    if (!next) {
      return;
    }

    held.add(name);
    next
      .cb()
      .then(next.done, next.fail)
      .finally(() => {
        held.delete(name);
        pump(name);
      });
  };

  return {
    request(name, options, cb) {
      return new Promise((done, fail) => {
        const item = { cb, done, fail };
        options.signal.addEventListener('abort', () => {
          const q = queues.get(name) ?? [];
          const i = q.indexOf(item);

          if (i >= 0) {
            q.splice(i, 1);
            fail(new DOMException('aborted', 'AbortError'));
          }
        });
        queues.set(name, [...(queues.get(name) ?? []), item]);
        pump(name);
      });
    },
  };
}

const open: Coordinator[] = [];
afterEach(() => {
  for (const c of open.splice(0)) {
    c.close();
  }
});

describe('browser coordinator', () => {
  it('a follower that closes while waiting never leads, and frees its place', async () => {
    const locks = fakeLocks();
    const a = browserCoordinator('t2', locks);
    const b = browserCoordinator('t2', locks);
    const c = browserCoordinator('t2', locks);
    open.push(a, b, c);
    await a.waitForLead();
    b.close();
    a.close();
    await c.waitForLead();
    expect(c.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
  });
});
