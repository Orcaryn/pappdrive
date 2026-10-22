import type { DeltaBody, DeltaPayload, IndexBody, IndexEntry } from '@pappdrive/protocol';
import { SWEEP_GRACE_MS } from '@pappdrive/protocol';
import { baseName, pathKey } from '../../shared/paths.js';
import type { FsAdapter } from '../../shared/platform.js';

export interface Rec {
  path: string;
  entry: IndexEntry;
}

export interface DiskRec extends Rec {
  skipped?: 'bad name';
}

export interface BaseIndex {
  id: string;
  header: Record<string, number>;
  body: IndexBody;
}

interface ViewFields {
  seq: number;
  ops: DeltaBody;
  header: Record<string, number>;
  body: IndexBody;
  map: Map<string, Rec>;
}

export type ServerView = ViewFields & ({ etag: null; base: null } | { etag: string; base: BaseIndex });

export function sameVersion(a: Rec, b: Rec): boolean {
  return a.entry.id === b.entry.id && baseName(a.path) === baseName(b.path);
}

export function serverView(etag: string, base: BaseIndex, blobs: Record<string, number>, delta: DeltaPayload): ServerView {
  const { seq, ops } = delta;
  const body: IndexBody = { ...base.body };

  for (const [path, entry] of Object.entries(ops)) {
    if (entry === null) {
      delete body[path];
    } else {
      body[path] = entry;
    }
  }

  const map = new Map<string, Rec>();

  for (const [path, entry] of Object.entries(body).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const key = pathKey(path);

    if (!map.has(key)) {
      map.set(key, { path, entry });
    }
  }

  return { etag, base, seq, ops, header: { ...base.header, ...blobs }, body, map };
}

const STATE_VERSION = 1;
const UPLOADED_TRUST_MS = SWEEP_GRACE_MS - 3600_000;

export interface LocalState {
  readonly disk: ReadonlyMap<string, DiskRec>;
  readonly synced: ReadonlyMap<string, Rec>;
  server: ServerView | null;
  readonly seenSeq: number;
  load(): Promise<void>;
  setSeenSeq(seq: number): void;
  isKnown(key: string): boolean;
  setDisk(rec: DiskRec): void;
  deleteDisk(key: string): void;
  replaceDisk(map: Map<string, DiskRec>): void;
  setSynced(rec: Rec): void;
  deleteSynced(key: string): void;
  markUploaded(id: string): void;
  dropUploaded(id: string): void;
  isUploaded(id: string): boolean;
  flush(): Promise<void>;
}

export function createLocalState(fs: FsAdapter): LocalState {
  let uploaded = new Map<string, number>();
  const dirty = { disk: false, synced: false, uploaded: false, seenSeq: false };
  let flushing: Promise<void> = Promise.resolve();
  const state = {
    disk: new Map<string, DiskRec>(),
    synced: new Map<string, Rec>(),
    server: null as ServerView | null,
    seenSeq: 0,
    load,
    setSeenSeq,
    isKnown,
    setDisk,
    deleteDisk,
    replaceDisk,
    setSynced,
    deleteSynced,
    markUploaded,
    dropUploaded,
    isUploaded,
    flush,
  };

  async function load(): Promise<void> {
    state.disk = parseFiles(await fs.loadState('disk'));
    state.synced = parseFiles(await fs.loadState('synced'));
    const saved = await fs.loadState('uploaded');
    const blobs = saved === null ? {} : (JSON.parse(saved) as { blobs: Record<string, number> }).blobs;
    const cutoff = Date.now() - UPLOADED_TRUST_MS;
    uploaded = new Map(Object.entries(blobs).filter(([, t]) => t > cutoff));
    const seenSeq = await fs.loadState('seen-seq');
    state.seenSeq = seenSeq === null ? 0 : (JSON.parse(seenSeq) as { seq: number }).seq;
  }

  function setSeenSeq(seq: number): void {
    state.seenSeq = seq;
    dirty.seenSeq = true;
  }

  function isKnown(key: string): boolean {
    return state.synced.has(key) || state.server?.map.has(key) === true;
  }

  function setDisk(rec: DiskRec): void {
    state.disk.set(pathKey(rec.path), rec);
    dirty.disk = true;
  }

  function deleteDisk(key: string): void {
    if (state.disk.delete(key)) {
      dirty.disk = true;
    }
  }

  function replaceDisk(map: Map<string, DiskRec>): void {
    state.disk = map;
    dirty.disk = true;
  }

  function setSynced(rec: Rec): void {
    state.synced.set(pathKey(rec.path), rec);
    dirty.synced = true;
  }

  function deleteSynced(key: string): void {
    if (state.synced.delete(key)) {
      dirty.synced = true;
    }
  }

  function markUploaded(id: string): void {
    uploaded.set(id, Date.now());
    dirty.uploaded = true;
  }

  function dropUploaded(id: string): void {
    if (uploaded.delete(id)) {
      dirty.uploaded = true;
    }
  }

  function isUploaded(id: string): boolean {
    const t = uploaded.get(id);

    return t !== undefined && t > Date.now() - UPLOADED_TRUST_MS;
  }

  function flush(): Promise<void> {
    const run = flushing.then(async () => {
      if (dirty.disk) {
        dirty.disk = false;
        await fs.saveState('disk', serializeFiles(state.disk));
      }

      if (dirty.synced) {
        dirty.synced = false;
        await fs.saveState('synced', serializeFiles(state.synced));
      }

      if (dirty.uploaded) {
        dirty.uploaded = false;
        await fs.saveState('uploaded', JSON.stringify({ v: STATE_VERSION, blobs: Object.fromEntries(uploaded) }));
      }

      if (dirty.seenSeq) {
        dirty.seenSeq = false;
        await fs.saveState('seen-seq', JSON.stringify({ v: STATE_VERSION, seq: state.seenSeq }));
      }
    });
    flushing = run.catch(() => {});

    return run;
  }

  return state;
}

function parseFiles(text: string | null): Map<string, DiskRec> {
  const files = text === null ? {} : (JSON.parse(text) as { files: Record<string, IndexEntry & { skipped?: 'bad name' }> }).files;
  const out = new Map<string, DiskRec>();

  for (const [path, { skipped, ...entry }] of Object.entries(files)) {
    out.set(pathKey(path), skipped ? { path, entry, skipped } : { path, entry });
  }

  return out;
}

function serializeFiles(map: Map<string, DiskRec>): string {
  const files: Record<string, IndexEntry & { skipped?: 'bad name' }> = {};

  for (const rec of map.values()) {
    files[rec.path] = rec.skipped ? { ...rec.entry, skipped: rec.skipped } : rec.entry;
  }

  return JSON.stringify({ v: STATE_VERSION, files });
}
