import type { CommitResult, DeltaFile, IndexFile } from '@pappdrive/protocol';
import { deleteKeys, keys, listAll, listIndexes, R2_MAX_KEYS_PER_CALL, type Folder, type FolderBucket, type KeptIndex } from '../shared/bucket';

export const KEPT_RECENT_MS = 3600_000;
export const KEPT_RECENT_MAX = 60;
export const KEPT_DAYS = 7;
const KEPT_INDEX_MIN = 5;
const DAY_MS = 24 * 3600_000;
const HEAD_PARALLEL = 20;

type Header = Record<string, number>;

export async function commitDelta(bucket: FolderBucket, f: Folder, delta: DeltaFile, etag: string): Promise<CommitResult> {
  const deltaKey = keys.delta(f.user, f.app);
  const current = await bucket.get(deltaKey);

  if (current === null || current.httpEtag !== etag) {
    return { ok: false, error: 'stale' };
  }

  const before = JSON.parse(await current.text()) as DeltaFile;

  if (before.base !== delta.base) {
    return { ok: false, error: 'stale' };
  }

  const { added, missing } = diffHeader(before.blobs, delta.blobs);
  missing.push(...(await headMissing(bucket, f, added)));

  if (missing.length > 0) {
    return { ok: false, error: 'missing', missing };
  }

  const written = await bucket.put(deltaKey, JSON.stringify(delta), { onlyIf: new Headers({ 'If-Match': etag }) });

  if (written === null) {
    return { ok: false, error: 'stale' };
  }

  return { ok: true, etag: written.httpEtag };
}

export async function commitCheckpoint(bucket: FolderBucket, f: Folder, index: IndexFile, delta: DeltaFile, etag: string | null, nowMs = Date.now()): Promise<CommitResult> {
  const deltaKey = keys.delta(f.user, f.app);
  const current = await bucket.get(deltaKey);

  if ((current === null ? null : current.httpEtag) !== etag) {
    return { ok: false, error: 'stale' };
  }

  const before = current === null ? {} : await liveHeader(bucket, f, JSON.parse(await current.text()) as DeltaFile);
  const { added, missing } = diffHeader(before, index.blobs);
  missing.push(...(await findMissing(bucket, f, added, Object.keys(index.blobs).length)));

  if (missing.length > 0) {
    return { ok: false, error: 'missing', missing };
  }

  const indexWritten = await bucket.put(keys.index(f.user, f.app, delta.base), JSON.stringify(index), { onlyIf: new Headers({ 'If-None-Match': '*' }) });

  if (indexWritten === null) {
    return { ok: false, error: 'stale' };
  }

  const onlyIf = new Headers(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': etag });
  const written = await bucket.put(deltaKey, JSON.stringify(delta), { onlyIf });

  if (written === null) {
    return { ok: false, error: 'stale' };
  }

  const older = (await listIndexes(bucket, f)).filter(k => k.id !== delta.base);
  await deleteKeys(bucket, expiredKept(older, nowMs));

  return { ok: true, etag: written.httpEtag };
}

export function expiredKept(kept: KeptIndex[], nowMs: number): string[] {
  const coveredDays = new Set<number>();
  const expired: string[] = [];
  let keptFromHour = 0;

  kept.forEach((copy, i) => {
    const day = Math.floor(copy.time / DAY_MS);
    const withinHour = copy.time >= nowMs - KEPT_RECENT_MS;
    const withinWeek = copy.time >= nowMs - KEPT_DAYS * DAY_MS;

    if (i < KEPT_INDEX_MIN || (withinHour && keptFromHour < KEPT_RECENT_MAX) || (withinWeek && !coveredDays.has(day))) {
      keptFromHour += withinHour ? 1 : 0;
      coveredDays.add(day);
    } else {
      expired.push(copy.key);
    }
  });

  return expired;
}

async function liveHeader(bucket: FolderBucket, f: Folder, delta: DeltaFile): Promise<Header> {
  const key = keys.index(f.user, f.app, delta.base);
  const base = await bucket.get(key);

  if (base === null) {
    throw new Error(`The delta points at the index ${key}, which is missing.`);
  }

  return { ...(JSON.parse(await base.text()) as IndexFile).blobs, ...delta.blobs };
}

function diffHeader(before: Header, after: Header): { added: [string, number][]; missing: string[] } {
  const added: [string, number][] = [];
  const missing: string[] = [];

  for (const [id, size] of Object.entries(after)) {
    if (before[id] === undefined) {
      added.push([id, size]);
    } else if (before[id] !== size) {
      missing.push(id);
    }
  }

  return { added, missing };
}

async function findMissing(bucket: FolderBucket, f: Folder, added: [string, number][], indexBlobCount: number): Promise<string[]> {
  if (added.length <= Math.ceil(indexBlobCount / R2_MAX_KEYS_PER_CALL)) {
    return headMissing(bucket, f, added);
  }

  const prefix = keys.folderPrefix(f.user, f.app);
  const stored = new Map<string, number>();

  for await (const o of listAll(bucket, prefix)) {
    stored.set(o.key.slice(prefix.length), o.size);
  }

  return added.filter(([id, size]) => stored.get(id) !== size).map(([id]) => id);
}

async function headMissing(bucket: FolderBucket, f: Folder, added: [string, number][]): Promise<string[]> {
  const missing: string[] = [];

  for (let i = 0; i < added.length; i += HEAD_PARALLEL) {
    const batch = added.slice(i, i + HEAD_PARALLEL);
    const heads = await Promise.all(batch.map(([id]) => bucket.head(keys.blob(f.user, f.app, id))));
    missing.push(...batch.filter(([, size], j) => heads[j]?.size !== size).map(([id]) => id));
  }

  return missing;
}
