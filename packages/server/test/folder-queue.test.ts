import { describe, expect, it } from 'vitest';
import { SWEEP_GRACE_MS, type DeltaFile, type IndexFile } from '@pappdrive/protocol';
import { commitCheckpoint, commitDelta, expiredKept, KEPT_DAYS, KEPT_RECENT_MAX, KEPT_RECENT_MS } from '../src/folder-queue/commit';
import { createSerialQueue } from '../src/folder-queue/serial-queue';
import { deleteFolder, sweep } from '../src/folder-queue/sweep';
import { keys, listIndexes } from '../src/shared/bucket';
import { createFakeBucket, type FakeBucket } from './fake-bucket';

const f = { user: 'u1', app: 'notes' };
const id = (n: number) => n.toString(16).padStart(64, '0');
const base = (n: number) => `b${n}`.padStart(64, '0');
const idx = (blobs: Record<string, number>, body = 'b'): IndexFile => ({ v: 1, blobs, body });
const dlt = (b: string, blobs: Record<string, number>, body = 'd'): DeltaFile => ({ v: 1, base: b, blobs, body });
const blobKey = (n: number) => keys.blob(f.user, f.app, id(n));
const deltaKey = keys.delta(f.user, f.app);
const DAY_MS = 24 * 3600_000;
const ROOM = Number.MAX_SAFE_INTEGER;

async function checkpointed(b: FakeBucket, index: IndexFile, baseId: string, etag: string | null, nowMs?: number): Promise<string> {
  const r = await commitCheckpoint(b, f, index, dlt(baseId, {}), etag, ROOM, nowMs);

  if (!r.ok) {
    throw new Error(`checkpoint failed: ${r.error}`);
  }

  return r.etag;
}

async function deltaCommitted(b: FakeBucket, delta: DeltaFile, etag: string): Promise<string> {
  const r = await commitDelta(b, f, delta, etag, ROOM);

  if (!r.ok) {
    throw new Error(`delta commit failed: ${r.error}`);
  }

  return r.etag;
}

describe('commitCheckpoint', () => {
  it('writes the first index under its id and an empty delta pointing at it', async () => {
    const b = createFakeBucket();
    b.blob(blobKey(1), 100);
    const etag = await checkpointed(b, idx({ [id(1)]: 100 }), base(1), null);
    expect(b.objects.get(keys.index(f.user, f.app, base(1)))?.value).toBe(JSON.stringify(idx({ [id(1)]: 100 })));
    expect(b.objects.get(deltaKey)).toMatchObject({ value: JSON.stringify(dlt(base(1), {})), etag });
  });

  it('is stale when a delta exists and etag is null, when the etag differs, or when no delta exists but an etag is sent', async () => {
    const b = createFakeBucket();
    expect(await commitCheckpoint(b, f, idx({}), dlt(base(1), {}), '"x"', ROOM)).toEqual({ ok: false, error: 'stale' });
    await checkpointed(b, idx({}), base(1), null);
    expect(await commitCheckpoint(b, f, idx({}), dlt(base(2), {}), null, ROOM)).toEqual({ ok: false, error: 'stale' });
    expect(await commitCheckpoint(b, f, idx({}), dlt(base(2), {}), '"nope"', ROOM)).toEqual({ ok: false, error: 'stale' });
  });

  it('refuses new ids that are missing or have the wrong size', async () => {
    const b = createFakeBucket();
    b.blob(blobKey(1), 100);
    b.blob(blobKey(2), 99);
    const r = await commitCheckpoint(b, f, idx({ [id(1)]: 100, [id(2)]: 100, [id(3)]: 5 }), dlt(base(1), {}), null, ROOM);
    expect(r).toEqual({ ok: false, error: 'missing', missing: [id(2), id(3)] });
    expect(b.objects.has(deltaKey)).toBe(false);
    expect(b.objects.has(keys.index(f.user, f.app, base(1)))).toBe(false);
  });

  it('trusts ids the base index or the delta already hold, and refuses one whose size changed, without asking R2', async () => {
    const b = createFakeBucket();
    b.blob(blobKey(1), 100);
    b.blob(blobKey(2), 50);
    let etag = await checkpointed(b, idx({ [id(1)]: 100 }), base(1), null);
    etag = await deltaCommitted(b, dlt(base(1), { [id(2)]: 50 }), etag);
    b.calls.head = 0;
    expect(await commitCheckpoint(b, f, idx({ [id(1)]: 100, [id(2)]: 50 }), dlt(base(2), {}), etag, ROOM)).toMatchObject({ ok: true });
    expect(b.calls.head).toBe(0);
    const etag2 = (b.objects.get(deltaKey) as { etag: string }).etag;
    expect(await commitCheckpoint(b, f, idx({ [id(1)]: 101 }), dlt(base(3), {}), etag2, ROOM)).toEqual({ ok: false, error: 'missing', missing: [id(1)] });
    expect(b.calls.head).toBe(0);
  });

  it('answers stale when the conditional write loses a race, leaving the new index for the sweep', async () => {
    const b = createFakeBucket();
    const etag = await checkpointed(b, idx({}), base(1), null);
    const realGet = b.get.bind(b);
    b.get = async key => {
      const o = await realGet(key);

      if (key === deltaKey) {
        await b.put(key, JSON.stringify(dlt(base(1), {}, 'other')));
      }

      return o;
    };

    expect(await commitCheckpoint(b, f, idx({}, 'mine'), dlt(base(2), {}), etag, ROOM)).toEqual({ ok: false, error: 'stale' });
  });

  it('thins older indexes but never the one the delta points at', async () => {
    const b = createFakeBucket();
    const t0 = 100 * DAY_MS;
    let etag: string | null = null;

    for (let i = 0; i < 8; i++) {
      b.now = () => new Date(t0 + i * 60_000);
      etag = await checkpointed(b, idx({}, String(i)), base(i), etag, t0 + i * 60_000);
    }

    expect((await listIndexes(b, f)).length).toBe(8);
    b.now = () => new Date(t0 + 3 * KEPT_RECENT_MS);
    await checkpointed(b, idx({}, 'late'), base(9), etag, t0 + 3 * KEPT_RECENT_MS);
    expect((await listIndexes(b, f)).map(k => k.id)).toEqual([base(9), base(7), base(6), base(5), base(4), base(3)]);
  });
});

describe('commitDelta', () => {
  it('rewrites the delta with If-Match and checks only the ids new since the last delta', async () => {
    const b = createFakeBucket();
    b.blob(blobKey(1), 100);
    b.blob(blobKey(2), 50);
    b.blob(blobKey(3), 7);
    let etag = await checkpointed(b, idx({ [id(1)]: 100 }), base(1), null);
    b.calls.head = 0;
    etag = await deltaCommitted(b, dlt(base(1), { [id(2)]: 50 }), etag);
    expect(b.calls.head).toBe(1);
    await deltaCommitted(b, dlt(base(1), { [id(2)]: 50, [id(3)]: 7 }), etag);
    expect(b.calls.head).toBe(2);
    expect(b.objects.get(deltaKey)?.value).toBe(JSON.stringify(dlt(base(1), { [id(2)]: 50, [id(3)]: 7 })));
    expect(await listIndexes(b, f)).toHaveLength(1);
  });

  it('is stale without a delta, with the wrong etag, or with another base', async () => {
    const b = createFakeBucket();
    expect(await commitDelta(b, f, dlt(base(1), {}), '"x"', ROOM)).toEqual({ ok: false, error: 'stale' });
    const etag = await checkpointed(b, idx({}), base(1), null);
    expect(await commitDelta(b, f, dlt(base(1), {}), '"nope"', ROOM)).toEqual({ ok: false, error: 'stale' });
    expect(await commitDelta(b, f, dlt(base(2), {}), etag, ROOM)).toEqual({ ok: false, error: 'stale' });
  });

  it('refuses new ids that are missing, and kept ids whose size changed', async () => {
    const b = createFakeBucket();
    b.blob(blobKey(2), 50);
    let etag = await checkpointed(b, idx({}), base(1), null);
    etag = await deltaCommitted(b, dlt(base(1), { [id(2)]: 50 }), etag);
    expect(await commitDelta(b, f, dlt(base(1), { [id(2)]: 51, [id(3)]: 1 }), etag, ROOM)).toEqual({ ok: false, error: 'missing', missing: [id(2), id(3)] });
  });
});

describe('quota', () => {
  it('reports the folder size: the base index plus the delta', async () => {
    const b = createFakeBucket();
    b.blob(blobKey(1), 100);
    b.blob(blobKey(2), 50);
    const first = await commitCheckpoint(b, f, idx({ [id(1)]: 100 }), dlt(base(1), {}), null, ROOM);
    expect(first).toMatchObject({ ok: true, bytes: 100 });
    expect(await commitDelta(b, f, dlt(base(1), { [id(2)]: 50 }), (first as { etag: string }).etag, ROOM)).toMatchObject({ ok: true, bytes: 150 });
  });

  it('refuses a commit that grows the folder past the room, before asking R2', async () => {
    const b = createFakeBucket();
    b.blob(blobKey(1), 100);
    const etag = await checkpointed(b, idx({}), base(1), null);
    b.calls.head = 0;
    expect(await commitDelta(b, f, dlt(base(1), { [id(1)]: 100 }), etag, 99)).toEqual({ ok: false, error: 'over-quota' });
    expect(await commitCheckpoint(b, f, idx({ [id(1)]: 100 }), dlt(base(2), {}), etag, 99)).toEqual({ ok: false, error: 'over-quota' });
    expect(b.calls.head).toBe(0);
  });

  it('lets a folder already over the room shrink', async () => {
    const b = createFakeBucket();
    b.blob(blobKey(1), 100);
    b.blob(blobKey(2), 50);
    const etag = await checkpointed(b, idx({ [id(1)]: 100, [id(2)]: 50 }), base(1), null);
    expect(await commitCheckpoint(b, f, idx({ [id(2)]: 50 }), dlt(base(2), {}), etag, 10)).toMatchObject({ ok: true, bytes: 50 });
  });
});

describe('expiredKept', () => {
  const DAY = DAY_MS;
  const kept = (times: number[]) => times.sort((a, b) => b - a).map(t => ({ key: String(t), id: String(t), time: t }));

  const surviving = (times: number[], now: number) => {
    const expired = new Set(expiredKept(kept(times), now));

    return times.filter(t => !expired.has(String(t))).sort((a, b) => b - a);
  };

  it('keeps every copy from the last hour, up to the cap, and nothing older from the same day', () => {
    const now = 100 * DAY + 12 * 3600_000;
    const times = Array.from({ length: 90 }, (_, i) => now - i * 30_000);
    expect(surviving(times, now)).toEqual(times.slice(0, KEPT_RECENT_MAX));
  });

  it('keeps the newest copy of each day for a week, plus the newest five', () => {
    const now = 109 * DAY + 12 * 3600_000;
    const times = Array.from({ length: 10 }, (_, d) => [(100 + d) * DAY + 10 * 3600_000, (100 + d) * DAY + 11 * 3600_000]).flat();
    const newestOfDay = (d: number) => d * DAY + 11 * 3600_000;
    const olderOfDay = (d: number) => d * DAY + 10 * 3600_000;
    expect(surviving(times, now)).toEqual([newestOfDay(109), olderOfDay(109), newestOfDay(108), olderOfDay(108), ...[107, 106, 105, 104, 103].map(newestOfDay)]);
  });

  it('drops everything older than the week beyond the newest five', () => {
    const now = 200 * DAY;
    const times = [now - 30 * DAY, now - 20 * DAY, now - 10 * DAY, now - 9 * DAY, now - 8 * DAY, now - KEPT_DAYS * DAY + 1, now - 1];
    expect(surviving(times, now)).toEqual([now - 1, now - KEPT_DAYS * DAY + 1, now - 8 * DAY, now - 9 * DAY, now - 10 * DAY]);
  });
});

describe('sweep', () => {
  it('keeps blobs the delta or any kept index mentions and deletes the rest past the grace period', async () => {
    const b = createFakeBucket();
    let clock = 0;
    b.now = () => new Date(clock);
    b.blob(blobKey(1), 1);
    b.blob(blobKey(2), 2);
    b.blob(blobKey(3), 3);
    b.blob(blobKey(4), 4);
    let etag = await checkpointed(b, idx({ [id(1)]: 1, [id(2)]: 2 }), base(1), null, clock);
    clock = 1;
    etag = await checkpointed(b, idx({ [id(1)]: 1 }), base(2), etag, clock);
    await deltaCommitted(b, dlt(base(2), { [id(4)]: 4 }), etag);
    clock = 2 * SWEEP_GRACE_MS;
    b.blob(blobKey(5), 5);
    const before = [...b.objects.keys()];
    expect(await sweep(b, f, clock)).toBe(true);
    expect([...b.objects.keys()]).toEqual(before.filter(k => k !== blobKey(3)));
  });

  it('deletes everything of any age when there is no delta, and stops', async () => {
    const b = createFakeBucket();
    b.blob(blobKey(1), 1);
    b.blob(keys.index(f.user, f.app, base(1)), 1);
    b.blob('u1/other/' + id(1), 1);
    expect(await sweep(b, f)).toBe(false);
    expect([...b.objects.keys()]).toEqual(['u1/other/' + id(1)]);
  });

  it('deletes nothing when a kept index cannot be read', async () => {
    const b = createFakeBucket();
    await checkpointed(b, idx({}), base(1), null, 0);
    await b.put(keys.index(f.user, f.app, base(2)), 'not json');
    b.blob(blobKey(9), 9, new Date(0));
    await expect(sweep(b, f, 10 * SWEEP_GRACE_MS)).rejects.toThrow();
    expect(b.objects.has(blobKey(9))).toBe(true);
  });
});

describe('deleteFolder', () => {
  it('removes the delta, every index and every blob, and nothing else', async () => {
    const b = createFakeBucket();

    for (let i = 1; i <= 1500; i++) {
      b.blob(blobKey(i), 1);
    }

    await checkpointed(b, idx({}), base(1), null);
    b.blob('u1/key', 1);
    b.blob('u1/notes2/' + id(1), 1);
    await deleteFolder(b, f);
    expect([...b.objects.keys()].sort()).toEqual(['u1/key', 'u1/notes2/' + id(1)]);
  });
});

describe('createSerialQueue', () => {
  it('keeps going after a failed job', async () => {
    const run = createSerialQueue();
    await expect(run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await run(async () => 1)).toBe(1);
  });
});
