import type { DeltaPayload, IndexBody } from '@pappdrive/protocol';
import { decodeBody } from '../../../shared/crypto.js';
import { SyncError } from '../../../shared/errors.js';
import { serverView, type ServerView } from '../state.js';
import { applyServer } from './apply.js';
import { resolveClashes } from './clashes.js';
import { commitLocal } from './commit.js';
import { decide, frozenKeys } from './decide.js';
import type { RoundDeps } from './deps.js';

const ROUND_TRIES = 8;

export type RoundOutcome = { downloadError: Error | null; skipped: string[] } | 'stopped';
export type SyncEngine = ReturnType<typeof createSyncEngine>;

export function createSyncEngine(r: RoundDeps) {
  let reportedSkipped = new Set<string>();

  async function round(local: boolean): Promise<RoundOutcome> {
    try {
      let downloadError: Error | null = null;

      for (let i = 0; i < ROUND_TRIES; i++) {
        const attempt = await roundOnce(local);
        downloadError ??= attempt.downloadError;

        if (attempt.commit === 'done') {
          return { downloadError, skipped: attempt.skipped };
        }
      }

      throw new SyncError('server', "Other devices kept committing first, so this device's changes wait. The next sync tries again.");
    } catch (e) {
      if (r.signal.aborted) {
        return 'stopped';
      }

      throw e;
    } finally {
      if (!r.signal.aborted) {
        await r.state.flush();
      }
    }
  }

  async function roundOnce(local: boolean): Promise<{ commit: 'done' | 'stale'; downloadError: Error | null; skipped: string[] }> {
    const { readOnly, fs } = r.ctx;
    const view = await fetchIndex();
    await r.scanner.refreshRules();

    if (r.scanner.needsFullScan || (fs.kind === 'visible' && !fs.watch)) {
      for (const p of await r.scanner.scan()) {
        if (!r.scanner.isIgnored(p)) {
          r.fire({ path: p, origin: 'local' });
        }
      }
    }

    r.signal.throwIfAborted();
    const { frozen, skipped } = frozenKeys(r.state.disk, view, fs);

    for (const p of skipped) {
      if (!reportedSkipped.has(p)) {
        r.fire({ path: p, origin: 'skipped', reason: 'bad name' });
      }
    }

    reportedSkipped = new Set(skipped);
    const decideNow = () => decide({ disk: r.state.disk, synced: r.state.synced, server: view.map, frozen, readOnly });
    const first = decideNow();
    const decisions = !readOnly && (await resolveClashes(r, first, view)) ? decideNow() : first;
    const downloadError = await applyServer(r, decisions);

    if (!local || readOnly) {
      return { commit: 'done', downloadError, skipped };
    }

    return { commit: await commitLocal(r, view, decideNow()), downloadError, skipped };
  }

  async function fetchIndex(): Promise<ServerView> {
    const { keys, readOnly, api, app } = r.ctx;
    const { state } = r;
    const known = state.server;
    const fetched = await api.getDelta(known);
    r.signal.throwIfAborted();

    if (fetched.kind === 'unchanged') {
      return fetched.known;
    } else if (fetched.kind === 'found') {
      const { delta, etag } = fetched;
      const payload = await decodeBody<DeltaPayload>(keys, { kind: 'delta', app, base: delta.base }, delta.body);

      if (payload.seq < state.seenSeq) {
        throw new SyncError(
          'server',
          `The server sent version ${payload.seq} of the folder's index, older than version ${state.seenSeq} this device already saw. ` +
            'Sync stopped so no change is undone. The next sync checks again.'
        );
      }

      state.setSeenSeq(payload.seq);

      if (known?.base?.id === delta.base) {
        return (state.server = serverView(etag, known.base, delta.blobs, payload));
      }

      const index = await api.getIndex(delta.base);
      const base = { id: delta.base, header: index.blobs, body: await decodeBody<IndexBody>(keys, { kind: 'index', app, base: delta.base }, index.body) };

      return (state.server = serverView(etag, base, delta.blobs, payload));
    }

    state.server = null;

    if (readOnly || state.synced.size === 0) {
      return { etag: null, base: null, seq: state.seenSeq, ops: {}, header: {}, body: {}, map: new Map() };
    }

    // the server answers a deleted folder's /delta with 404 too; only a token refresh reports the deletion.
    await r.ctx.noticeGone();
    r.signal.throwIfAborted();

    throw new SyncError(
      'server',
      "The folder's index is missing on the server although this device synced before. " +
        'Nothing was uploaded, so the folder is not rebuilt by mistake. The next sync checks again.'
    );
  }

  return { round };
}
