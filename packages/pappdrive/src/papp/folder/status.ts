import type { GoneReason } from '@pappdrive/protocol';
import { pathKey } from '../../shared/paths.js';
import type { CoordinatorMessage } from '../../shared/platform.js';
import type { Change, Status } from '../../shared/types.js';
import type { RoundOutcome } from './round/index.js';
import { sameVersion, type LocalState } from './state.js';

export type FolderStatus = ReturnType<typeof createStatus>;

interface StatusDeps {
  readOnly: boolean;
  state: LocalState;
  broadcast: (msg: CoordinatorMessage) => void;
  signal: AbortSignal;
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
    if (d.signal.aborted) {
      return;
    }

    live.error = (e as Error).message;
    notify();
  }

  function stopFailed(e: unknown): void {
    live.error = (e as Error).message;
    notify();
  }

  function refresh(): void {
    const { disk, synced } = d.state;
    const frozen = new Set(live.skipped.map(pathKey));
    const changedHere = [...disk].filter(([key, rec]) => {
      const was = synced.get(key);

      return !rec.skipped && !frozen.has(key) && (!was || !sameVersion(was, rec));
    });
    const removedHere = [...synced.keys()].filter(key => !disk.has(key) && !frozen.has(key));
    live.pending = d.readOnly ? 0 : changedHere.length + removedHere.length;
    notify();
  }

  function roundStarted(): void {
    live.syncing = true;
    notify();
  }

  function roundEnded(outcome: Exclude<RoundOutcome, 'stopped'> | Error): void {
    if (d.signal.aborted) {
      return;
    } else if (outcome instanceof Error) {
      live.error = outcome.message;
    } else {
      live.lastSync = Date.now();
      live.error = outcome.downloadError === null ? null : outcome.downloadError.message;
      live.skipped = outcome.skipped;
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
    refreshTimer ??= setTimeout(() => {
      refreshTimer = undefined;

      if (!d.signal.aborted) {
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
    stopFailed,
    refresh,
    roundStarted,
    roundEnded,
    markDeleted,
    scheduleRefresh,
    fire,
    deliver,
    watch,
    onStatus,
  };
}

function callApp(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error('pappdrive: a watch or onStatus callback threw:', e);
  }
}
