import { SyncError } from '../../shared/errors.js';
import type { SyncEngine } from './round/index.js';
import type { Scanner } from './scan/index.js';
import { createDebounce } from './shared/debounce.js';
import type { LocalState } from './shared/state.js';
import type { FolderApi, Tuning } from './shared/types.js';
import type { FolderStatus } from './status.js';
import type { WatchHints } from './watch.js';

interface RoundsDeps {
  tuning: Tuning;
  state: LocalState;
  scanner: Scanner;
  engine: SyncEngine;
  watcher: WatchHints;
  status: FolderStatus;
  watchIndex: FolderApi['watchIndex'];
  isLeading: () => boolean;
  isStopped: () => boolean;
}

export function createRounds(d: RoundsDeps) {
  const { tuning, state, scanner, status } = d;
  let mutex: Promise<unknown> = Promise.resolve();
  let queued: { local: boolean; done: Promise<Error | null> } | null = null;
  let updateNeeded: SyncError | null = null;
  let pollTimer: ReturnType<typeof setInterval> | undefined = undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let stopWatching: (() => void) | undefined = undefined;
  const debounce = createDebounce(tuning.quietMs, tuning.maxWaitMs, () => void request(true));

  function exclusive<T>(fn: () => Promise<T>): Promise<T | null> {
    const run = mutex.then(() => (d.isStopped() ? null : fn()));
    mutex = run.catch((e: unknown) => status.setError(e));

    return run;
  }

  function request(local: boolean): Promise<Error | null> {
    if (updateNeeded) {
      return Promise.resolve(updateNeeded);
    } else if (d.isStopped() || !d.isLeading()) {
      return Promise.resolve(null);
    } else if (queued) {
      queued.local ||= local;

      return queued.done;
    }

    const round = {
      local,
      done: exclusive((): Promise<Error | null> => {
        queued = null;

        return run(round.local);
      }),
    };
    queued = round;

    return round.done;
  }

  async function run(local: boolean): Promise<Error | null> {
    if (updateNeeded) {
      return updateNeeded;
    }

    status.roundStarted();
    const outcome = await d.engine.round(local).catch((e: unknown) => e as Error);

    if (outcome === 'stopped') {
      return null;
    } else if (outcome instanceof SyncError && outcome.code === 'update-needed') {
      updateNeeded = outcome;
    }

    status.roundEnded(outcome);

    if (!d.isStopped()) {
      await d.watcher.restartIfRulesChanged();
    }

    return outcome instanceof Error ? outcome : null;
  }

  function flush(): Promise<Error | null> {
    debounce.reset();

    return request(true);
  }

  function start(): void {
    if (tuning.pollMs > 0) {
      pollTimer = setInterval(() => void request(!debounce.waiting), tuning.pollMs);
      (pollTimer as { unref?: () => void }).unref?.();
    }

    stopWatching = d.watchIndex(() => void request(false));
  }

  function scheduleSave(): void {
    if (saveTimer) {
      return;
    }

    saveTimer = setTimeout(() => {
      saveTimer = undefined;

      if (!d.isStopped()) {
        state.flush().catch((e: unknown) => status.setError(e));
      }
    }, 1000);
  }

  function localChanged(paths: string[]): void {
    const shown = paths.filter(p => !scanner.isIgnored(p));

    if (shown.length === 0) {
      return;
    }

    for (const p of shown) {
      status.fire({ path: p, origin: 'local' });
    }

    debounce.poke();
    scheduleSave();
    status.scheduleRefresh();
  }

  function lookAt(paths: string[]): void {
    void exclusive(async () => {
      const { changed, changing } = await scanner.processPaths(paths);
      localChanged(changed);

      if (changing.length) {
        d.watcher.add(changing);
      }
    });
  }

  function stop(): void {
    clearInterval(pollTimer);
    stopWatching?.();
    stopWatching = undefined;
    debounce.cancel();
    clearTimeout(saveTimer);
  }

  return { request, flush, start, localChanged, lookAt, rescan: () => void exclusive(async () => localChanged(await scanner.scan())), idle: () => mutex, stop };
}
