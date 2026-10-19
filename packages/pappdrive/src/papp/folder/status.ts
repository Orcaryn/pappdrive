import type { GoneReason } from '@pappdrive/protocol';
import type { CoordinatorMessage } from '../../shared/platform.js';
import type { Change, Status } from '../../shared/types.js';
import { sameVersion } from './round/decide.js';
import { pathKey } from '../../shared/paths.js';
import type { LocalState } from './shared/state.js';

export type FolderStatus = ReturnType<typeof createStatus>;

interface StatusDeps {
  readOnly: boolean;
  state: LocalState;
  skippedPaths: () => string[];
  broadcast: (msg: CoordinatorMessage) => void;
  isStopped: () => boolean;
}

export function createStatus(d: StatusDeps) {
  let live: Status = { syncing: false, lastSync: null, pending: 0, skipped: [], deleted: null, error: null };
  let refreshTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  const changeListeners = new Set<(c: Change) => void>();
  const statusListeners = new Set<(s: Status) => void>();

  function snapshot(): Status {
    return { ...live, skipped: [...live.skipped] };
  }

  function notify(): void {
    const s = snapshot();

    for (const cb of statusListeners) {
      callApp(() => cb(s));
    }

    d.broadcast({ type: 'status', status: s });
  }

  function replace(s: Status): void {
    live = s;
    notify();
  }

  function setError(e: unknown): void {
    if (d.isStopped()) {
      return;
    }

    live.error = (e as Error).message;
    notify();
  }

  function refresh(): void {
    live.pending = countPending(d.readOnly, d.state, d.skippedPaths());
    live.skipped = d.skippedPaths();
    notify();
  }

  function roundStarted(): void {
    live.syncing = true;
    notify();
  }

  function roundEnded(outcome: { downloadError: Error | null } | Error): void {
    if (d.isStopped()) {
      return;
    } else if (outcome instanceof Error) {
      live.error = outcome.message;
    } else {
      live.lastSync = Date.now();
      live.error = outcome.downloadError === null ? null : outcome.downloadError.message;
    }

    live.syncing = false;
    refresh();
  }

  function markDeleted(reason: GoneReason): void {
    live.deleted = reason;
    live.syncing = false;
    live.pending = 0;
  }

  function scheduleRefresh(): void {
    if (refreshTimer) {
      return;
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;

      if (!d.isStopped()) {
        refresh();
      }
    }, 20);
  }

  function fire(change: Change): void {
    deliver(change);
    d.broadcast({ type: 'change', change });
  }

  function deliver(change: Change): void {
    for (const cb of changeListeners) {
      callApp(() => cb({ ...change }));
    }
  }

  function watch(cb: (change: Change) => void): () => void {
    changeListeners.add(cb);

    return () => void changeListeners.delete(cb);
  }

  function onStatus(cb: (status: Status) => void): () => void {
    statusListeners.add(cb);

    return () => void statusListeners.delete(cb);
  }

  return {
    get live(): Readonly<Status> {
      return live;
    },
    snapshot,
    notify,
    replace,
    setError,
    refresh,
    roundStarted,
    roundEnded,
    markDeleted,
    scheduleRefresh,
    stopRefresh: () => clearTimeout(refreshTimer),
    fire,
    deliver,
    watch,
    onStatus,
  };
}

function countPending(readOnly: boolean, state: LocalState, skippedPaths: string[]): number {
  if (readOnly) {
    return 0;
  }

  const { disk, synced } = state;
  const frozen = new Set(skippedPaths.map(pathKey));
  let n = 0;

  for (const [key, d] of disk) {
    const s = synced.get(key);

    if (!d.skipped && !frozen.has(key) && (!s || !sameVersion(s, d))) {
      n++;
    }
  }

  for (const key of synced.keys()) {
    if (!disk.has(key) && !frozen.has(key)) {
      n++;
    }
  }

  return n;
}

function callApp(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error('pappdrive: a watch or onStatus callback threw:', e);
  }
}
