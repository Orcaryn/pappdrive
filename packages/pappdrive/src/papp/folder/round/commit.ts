import type { CommitResult, DeltaBody, DeltaFile, DeltaPayload, IndexBody, IndexEntry, IndexFile } from '@pappdrive/protocol';
import { BLOB_OVERHEAD, blobIdsOf, DELTA_MAX } from '@pappdrive/protocol';
import { toHex } from '../../../shared/bytes.js';
import { encodeBody, randomBytes } from '../../../shared/crypto.js';
import { pathKey } from '../../../shared/paths.js';
import { hashFile } from '../hash.js';
import { serverView, type BaseIndex, type Rec, type ServerView } from '../state.js';
import { findClashes } from './clashes.js';
import type { Decision } from './decide.js';
import { folderSpellings, respell } from './spelling.js';
import type { RoundDeps } from './deps.js';
import { createUploader, type Uploader } from './upload.js';

export async function commitLocal(r: RoundDeps, view: ServerView, decisions: Decision[]): Promise<'done' | 'stale'> {
  const uploads = decisions.filter(d => d.action === 'upload');
  const deletes = decisions.filter(d => d.action === 'delete-server');

  if (uploads.length === 0 && deletes.length === 0) {
    return 'done';
  }

  const uploader = createUploader(r.ctx, r.state, r.partSize, view.header);
  const uploaded = await uploadFiles(
    r,
    uploader,
    uploads.map(d => d.key)
  );
  await uploader.flush();

  r.signal.throwIfAborted();

  const { body, ops, changes } = nextIndex(
    view,
    deletes.map(d => d.server.path),
    uploaded
  );

  if (changes.length === 0 && deletes.length === 0) {
    return 'done';
  }

  const next = await publish(r, uploader, view, body, ops);

  if (next === 'stale') {
    return 'stale';
  }

  for (const c of changes) {
    r.state.setSynced(c);
  }

  for (const d of deletes) {
    r.state.deleteSynced(d.key);
  }

  for (const id of Object.keys(next.header)) {
    r.state.dropUploaded(id);
  }

  r.state.server = next;
  r.state.setSeenSeq(next.seq);
  await r.state.flush();

  return 'done';
}

async function uploadFiles(r: RoundDeps, uploader: Uploader, keys: string[]): Promise<Rec[]> {
  const uploaded: Rec[] = [];

  for (const key of keys) {
    r.signal.throwIfAborted();

    let rec = r.state.disk.get(key);

    for (let tries = 0; rec && tries < 4; tries++) {
      const result = await uploader.addFile(rec.path, rec.entry);

      if (result === 'ok') {
        uploaded.push(rec);
        break;
      } else if (result === 'missing') {
        break;
      }

      const h = await hashFile(r.ctx.fs, r.ctx.keys, rec.path, r.partSize);

      if (h.state !== 'hashed') {
        break;
      }

      rec = { path: rec.path, entry: h.entry };
      r.state.setDisk(rec);
    }
  }

  return uploaded;
}

function nextIndex(view: ServerView, deleted: string[], uploaded: Rec[]): { body: IndexBody; ops: DeltaBody; changes: Rec[] } {
  const body: IndexBody = { ...view.body };

  for (const path of deleted) {
    delete body[path];
  }

  const spell = folderSpellings(Object.keys(body));
  const respelled: Rec[] = [];

  for (const rec of uploaded) {
    const old = view.map.get(pathKey(rec.path));

    if (old) {
      delete body[old.path];
    }

    const path = respell(rec.path, spell);
    body[path] = rec.entry;
    respelled.push({ path, entry: rec.entry });
  }

  const changed = new Set(respelled.map(c => c.path));
  const held = new Set<string>();

  for (const c of findClashes(Object.keys(body).map(p => ({ key: pathKey(p), path: p, local: changed.has(p) })))) {
    for (const p of [c.file, ...c.inside]) {
      if (p.local) {
        held.add(p.path);
      }
    }
  }

  for (const path of held) {
    delete body[path];
    const old = view.map.get(pathKey(path));

    if (old) {
      body[old.path] = old.entry;
    }
  }

  const changes = respelled.filter(c => !held.has(c.path));
  const ops: DeltaBody = { ...view.ops };

  for (const path of Object.keys(view.body)) {
    if (body[path] === undefined) {
      ops[path] = null;
    }
  }

  for (const c of changes) {
    ops[c.path] = c.entry;
  }

  return { body, ops, changes };
}

async function publish(r: RoundDeps, uploader: Uploader, view: ServerView, body: IndexBody, ops: DeltaBody): Promise<ServerView | 'stale'> {
  const { keys, api, app } = r.ctx;
  const seq = view.seq + 1;

  if (view.base !== null) {
    const { base, etag } = view;
    const changed = Object.values(ops).filter(entry => entry !== null);
    const blobs = Object.fromEntries(Object.entries(headerOf(changed, view.header, r.partSize)).filter(([id]) => base.header[id] === undefined));

    if (Object.keys(ops).length <= DELTA_MAX && Object.keys(blobs).length <= DELTA_MAX) {
      const payload: DeltaPayload = { seq, ops };
      const delta: DeltaFile = { v: 1, base: base.id, blobs, body: await encodeBody(keys, { kind: 'delta', app, base: base.id }, payload) };
      const sent = await send(r, uploader, () => api.commitDelta(delta, etag));

      return sent === 'stale' ? 'stale' : serverView(sent.etag, base, blobs, payload);
    }
  }

  const base: BaseIndex = { id: toHex(randomBytes(32)), header: headerOf(Object.values(body), view.header, r.partSize), body };
  const payload: DeltaPayload = { seq, ops: {} };
  const index: IndexFile = { v: 1, blobs: base.header, body: await encodeBody(keys, { kind: 'index', app, base: base.id }, body) };
  const delta: DeltaFile = { v: 1, base: base.id, blobs: {}, body: await encodeBody(keys, { kind: 'delta', app, base: base.id }, payload) };
  const sent = await send(r, uploader, () => api.commitCheckpoint(index, delta, view.etag));

  return sent === 'stale' ? 'stale' : serverView(sent.etag, base, {}, payload);
}

function headerOf(entries: IndexEntry[], known: Record<string, number>, partSize: number): Record<string, number> {
  const header: Record<string, number> = {};

  for (const entry of entries) {
    for (const [i, id] of blobIdsOf(entry).entries()) {
      const stored = known[id];
      header[id] = stored === undefined ? Math.min(partSize, entry.size - i * partSize) + BLOB_OVERHEAD : stored;
    }
  }

  return header;
}

async function send(r: RoundDeps, uploader: Uploader, attempt: () => Promise<CommitResult>): Promise<{ etag: string } | 'stale'> {
  for (let tries = 0; ; tries++) {
    r.signal.throwIfAborted();

    const result = await attempt();

    if (result.ok) {
      return { etag: result.etag };
    } else if (result.error === 'stale' || tries >= 3 || !(await uploader.reupload(result.missing))) {
      return 'stale';
    }
  }
}
