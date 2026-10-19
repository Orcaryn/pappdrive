import type { DeltaBody, IndexBody } from '@pappdrive/protocol';
import { decodeBody } from '../../../shared/crypto.js';
import { SyncError } from '../../../shared/errors.js';
import { pathProblem } from '../../../shared/paths.js';
import { isHard } from '../scan/ignore.js';
import type { FsAdapter } from '../../../shared/platform.js';
import { emptyView, serverView, type BaseIndex, type DiskRec, type ServerView } from '../shared/state.js';
import { applyServer } from './apply.js';
import { resolveClashes } from './clashes.js';
import { commitLocal } from './commit.js';
import { decide } from './decide.js';
import { Stopped, type RoundDeps } from './shared/types.js';

const ROUND_TRIES = 8;

export type SyncEngine = ReturnType<typeof createSyncEngine>;

export function createSyncEngine(r: RoundDeps) {
  let skippedPaths: string[] = [];

  async function round(local: boolean): Promise<{ downloadError: Error | null } | 'stopped'> {
    try {
      let downloadError: Error | null = null;

      for (let i = 0; i < ROUND_TRIES; i++) {
        const once = await roundOnce(local);
        downloadError ??= once.downloadError;

        if (once.commit === 'done') {
          return { downloadError };
        }
      }

      throw new SyncError('server', "Other devices kept committing first, so this device's changes wait. The next sync tries again.");
    } catch (e) {
      if (e instanceof Stopped) {
        return 'stopped';
      }

      throw e;
    } finally {
      if (!r.isStopped()) {
        await r.state.flush();
      }
    }
  }

  async function roundOnce(local: boolean): Promise<{ commit: 'done' | 'stale'; downloadError: Error | null }> {
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

    if (r.isStopped()) {
      throw new Stopped();
    }

    const { frozen, skipped } = frozenKeys(r.state.disk, view, fs);
    reportSkipped(skipped);
    const decideNow = () => decide({ disk: r.state.disk, synced: r.state.synced, server: view.map, frozen, readOnly });
    const first = decideNow();
    const decisions = !readOnly && (await resolveClashes(r, first, view)) ? decideNow() : first;
    const downloadError = await applyServer(r, decisions);

    if (!local || readOnly) {
      return { commit: 'done', downloadError };
    }

    return { commit: await commitLocal(r, view, decideNow()), downloadError };
  }

  async function fetchIndex(): Promise<ServerView> {
    const { keys, readOnly, api } = r.ctx;
    const { state } = r;
    const known = state.server;
    const fetched = await api.getDelta(known);

    if (r.isStopped()) {
      throw new Stopped();
    } else if (fetched.kind === 'unchanged') {
      return fetched.known;
    } else if (fetched.kind === 'found') {
      const { delta, etag } = fetched;
      const base = known?.base?.id === delta.base ? known.base : await loadBase(delta.base);

      return (state.server = serverView(etag, base, delta.blobs, await decodeBody<DeltaBody>(keys, delta.body)));
    }

    state.server = null;

    if (readOnly || state.synced.size === 0) {
      return emptyView();
    } else if ((await r.ctx.checkGone()) === 'gone' || r.isStopped()) {
      throw new Stopped();
    }

    throw new SyncError(
      'server',
      "The folder's index is missing on the server although this device synced before. " +
        'Nothing was uploaded, so the folder is not rebuilt by mistake. The next sync checks again.'
    );
  }

  async function loadBase(id: string): Promise<BaseIndex> {
    const index = await r.ctx.api.getIndex(id);

    return { id, header: index.blobs, body: await decodeBody<IndexBody>(r.ctx.keys, index.body) };
  }

  function reportSkipped(skipped: string[]): void {
    const reported = new Set(skippedPaths);

    for (const p of skipped) {
      if (!reported.has(p)) {
        r.fire({ path: p, origin: 'skipped', reason: 'bad name' });
      }
    }

    skippedPaths = skipped.sort();
  }

  return {
    round,
    get skippedPaths() {
      return skippedPaths;
    },
  };
}

function frozenKeys(disk: Map<string, DiskRec>, view: ServerView, fs: FsAdapter): { frozen: Set<string>; skipped: string[] } {
  const frozen = new Set<string>();
  const skipped: string[] = [];

  for (const [key, d] of disk) {
    if (!d.skipped) {
      continue;
    }

    frozen.add(key);
    skipped.push(d.path);
  }

  for (const [key, v] of view.map) {
    if (frozen.has(key)) {
      continue;
    } else if (isHard(v.path)) {
      frozen.add(key);
    } else if (pathProblem(v.path) || v.path.split('/').some(seg => !fs.canCreate(seg))) {
      frozen.add(key);
      skipped.push(v.path);
    }
  }

  return { frozen, skipped };
}
