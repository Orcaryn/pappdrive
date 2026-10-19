import type { DeltaBody, IndexBody, IndexEntry } from '@pappdrive/protocol';
import { SWEEP_GRACE_MS } from '@pappdrive/protocol';
import { pathKey } from '../../../shared/paths.js';
import type { FsAdapter } from '../../../shared/platform.js';

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
  ops: DeltaBody;
  header: Record<string, number>;
  body: IndexBody;
  map: Map<string, Rec>;
}

export type ServerView = ViewFields & ({ etag: null; base: null } | { etag: string; base: BaseIndex });

export function emptyView(): ServerView {
  return { etag: null, base: null, ops: {}, header: {}, body: {}, map: new Map() };
}

export function serverView(etag: string, base: BaseIndex, blobs: Record<string, number>, ops: DeltaBody): ServerView {
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

  return { etag, base, ops, header: { ...base.header, ...blobs }, body, map };
}

const STATE_VERSION = 1;
const UPLOADED_TRUST_MS = SWEEP_GRACE_MS - 3600_000;

export type LocalState = ReturnType<typeof createLocalState>;

export function createLocalState(fs: FsAdapter) {
  let uploaded = new Map<string, number>();
  const dirty = { disk: false, synced: false, uploaded: false };
  let flushing: Promise<void> = Promise.resolve();
  const state = {
    disk: new Map<string, DiskRec>(),
    synced: new Map<string, Rec>(),
    server: null as ServerView | null,
    load,
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
    const run = flushing.then(flushNow);
    flushing = run.catch(() => {});

    return run;
  }

  async function flushNow(): Promise<void> {
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
