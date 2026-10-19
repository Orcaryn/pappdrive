import { describe, expect, it } from 'vitest';
import { decide, type Decision } from '../src/papp/folder/round/decide.js';
import { pathKey } from '../src/shared/paths.js';
import type { Rec } from '../src/papp/folder/shared/state.js';

const ID = (c: string) => c.repeat(64);
const rec = (path: string, id: string): Rec => ({ path, entry: { id, size: 1, mtime: 1 } });
const map = (...recs: (Rec | undefined)[]) => new Map(recs.filter((r): r is Rec => !!r).map(r => [pathKey(r.path), r]));

function one(d?: Rec, s?: Rec, v?: Rec, readOnly = false, frozen: string[] = []): Decision['action'] | null {
  const out = decide({ disk: map(d), synced: map(s), server: map(v), frozen: new Set(frozen), readOnly });
  expect(out.length).toBeLessThanOrEqual(1);

  return out[0]?.action ?? null;
}

describe('decision table', () => {
  const A = ID('a');
  const B = ID('b');
  const C = ID('c');
  const p = 'notes/todo.md';

  it('path in synced: the nine cases', () => {
    expect(one(rec(p, A), rec(p, A), rec(p, A))).toBe(null);
    expect(one(rec(p, A), rec(p, A), rec(p, B))).toBe('download');
    expect(one(rec(p, A), rec(p, A), undefined)).toBe('delete-here');
    expect(one(rec(p, B), rec(p, A), rec(p, A))).toBe('upload');
    expect(one(rec(p, B), rec(p, A), rec(p, B))).toBe('adopt');
    expect(one(rec(p, B), rec(p, A), rec(p, C))).toBe('conflict');
    expect(one(rec(p, B), rec(p, A), undefined)).toBe('upload');
    expect(one(undefined, rec(p, A), rec(p, A))).toBe('delete-server');
    expect(one(undefined, rec(p, A), rec(p, B))).toBe('download');
    expect(one(undefined, rec(p, A), undefined)).toBe('forget');
  });

  it('path not in synced: the three cases', () => {
    expect(one(rec(p, A), undefined, undefined)).toBe('upload');
    expect(one(undefined, undefined, rec(p, A))).toBe('download');
    expect(one(rec(p, A), undefined, rec(p, A))).toBe('adopt');
    expect(one(rec(p, A), undefined, rec(p, B))).toBe('conflict');
  });

  it('matches paths without capitals, and a change of capitals is a rename', () => {
    expect(one(rec('Notes/Todo.md', A), undefined, rec('notes/todo.md', A))).toBe('adopt');
    expect(one(rec('Notes/Todo.md', A), undefined, rec('notes/todo.md', B))).toBe('conflict');
    expect(one(rec('notes/Todo.md', A), rec('notes/todo.md', A), rec('notes/todo.md', A))).toBe('upload');
    expect(one(rec('Notes/todo.md', A), rec('notes/todo.md', A), rec('notes/todo.md', A))).toBe(null);
    expect(one(rec('notes/todo.md', A), rec('notes/todo.md', A), rec('notes/TODO.md', A))).toBe('download');
  });

  it('frozen paths get no action at all', () => {
    expect(one(rec(p, B), rec(p, A), rec(p, C), false, [pathKey(p)])).toBe(null);
    expect(one(undefined, rec(p, A), rec(p, A), false, [pathKey(p)])).toBe(null);
  });

  it('read-only folders only download or delete here', () => {
    expect(one(undefined, undefined, rec(p, A), true)).toBe('download');
    expect(one(rec(p, B), rec(p, A), rec(p, A), true)).toBe('download');
    expect(one(rec(p, A), rec(p, A), undefined, true)).toBe('delete-here');
    expect(one(rec(p, A), undefined, rec(p, A), true)).toBe('adopt');
    expect(one(rec(p, A), rec(p, A), rec(p, A), true)).toBe(null);
    expect(one(undefined, rec(p, A), undefined, true)).toBe('forget');
  });
});
