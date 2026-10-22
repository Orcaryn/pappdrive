import { SyncError } from '../../shared/errors.js';
import { createDebounce } from './debounce.js';
import type { SyncEngine } from './round/index.js';
import type { Scanner } from './scan/index.js';
import type { LocalState } from './state.js';
import type { FolderStatus } from './status.js';
import type { FolderContext, Tuning } from './types.js';

interface SchedulerDeps {
  ctx: FolderContext;
  tuning: Tuning;
  state: LocalState;
  scanner: Scanner;
  engine: SyncEngine;
  status: FolderStatus;
  isLeading: () => boolean;
  signal: AbortSignal;
}

export function createScheduler(d: SchedulerDeps) {
  const { ctx, tuning, state, scanner, engine, status, isLeading, signal } = d;
  let mutex: Promise<unknown> = Promise.resolve();
  let queued: { local: boolean; done: Promise<Error | null> } | null = null;
  let updateNeeded: SyncError | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let stopIndexWatch: (() => void) | undefined = undefined;
  let stopDiskWatch: (() => Promise<void>) | undefined = undefined;
  let offBackground: (() => void) | undefined = undefined;
  let diskWatchSkipGlobs = '';
  const diskChanges = new Set<string>();
  const localQuiet = createDebounce(tuning.quietMs, tuning.maxWaitMs, () => void request(true));
  const diskQuiet = createDebounce(tuning.watchQuietMs, tuning.watchMaxMs, () => {
    const paths = [...diskChanges];
    diskChanges.clear();
    lookAt(paths);
  });

  function exclusive<T>(fn: () => Promise<T>): Promise<T | null> {
    const run = mutex.then(() => (signal.aborted ? null : fn()));
    mutex = run.catch((e: unknown) => status.setError(e));

    return run;
  }

  function request(local: boolean): Promise<Error | null> {
    if (updateNeeded) {
      return Promise.resolve(updateNeeded);
    } else if (signal.aborted || !isLeading()) {
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
    const outcome = await engine.round(local).catch((e: unknown) => e as Error);

    if (outcome === 'stopped') {
      return null;
    } else if (outcome instanceof SyncError && outcome.code === 'update-needed') {
      updateNeeded = outcome;
    } else if (outcome instanceof SyncError && outcome.code === 'rate-limited') {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void request(true), (outcome.retryAfter as number) * 1000);
      (retryTimer as { unref?: () => void }).unref?.();
    }

    status.roundEnded(outcome);

    if (!signal.aborted) {
      await restartDiskWatchIfRulesChanged();
    }

    return outcome instanceof Error ? outcome : null;
  }

  function flush(): Promise<Error | null> {
    localQuiet.reset();

    return request(true);
  }

  async function start(): Promise<void> {
    await watchDisk();
    stopIndexWatch = ctx.api.watchIndex(() => void request(!localQuiet.waiting));
    offBackground = ctx.syncOnBackground ? ctx.platform.onBackground?.(flush) : undefined;
  }

  async function watchDisk(): Promise<void> {
    if (!ctx.fs.watch) {
      return;
    }

    const skipGlobs = scanner.watcherSkipGlobs();
    diskWatchSkipGlobs = JSON.stringify(skipGlobs);
    stopDiskWatch = await ctx.fs.watch(
      skipGlobs,
      paths => {
        for (const p of paths) {
          diskChanges.add(p);
        }

        diskQuiet.poke();
      },
      rescan
    );
  }

  async function restartDiskWatchIfRulesChanged(): Promise<void> {
    const stopping = stopDiskWatch;

    if (!stopping || JSON.stringify(scanner.watcherSkipGlobs()) === diskWatchSkipGlobs) {
      return;
    }

    stopDiskWatch = undefined;
    await stopping();
    await watchDisk();
  }

  function localChanged(paths: string[]): void {
    const shown = paths.filter(p => !scanner.isIgnored(p));

    if (shown.length === 0) {
      return;
    }

    for (const p of shown) {
      status.fire({ path: p, origin: 'local' });
    }

    localQuiet.poke();
    saveTimer ??= setTimeout(() => {
      saveTimer = undefined;

      if (!signal.aborted) {
        state.flush().catch((e: unknown) => status.setError(e));
      }
    }, 1000);
    status.scheduleRefresh();
  }

  function lookAt(paths: string[]): void {
    void exclusive(async () => {
      const { changed, changing } = await scanner.processPaths(paths);
      localChanged(changed);

      for (const p of changing) {
        diskChanges.add(p);
      }

      if (changing.length > 0) {
        diskQuiet.poke();
      }
    });
  }

  function rescan(): void {
    void exclusive(async () => localChanged(await scanner.scan()));
  }

  async function stop(): Promise<void> {
    stopIndexWatch?.();
    stopIndexWatch = undefined;
    offBackground?.();
    offBackground = undefined;
    localQuiet.cancel();
    diskQuiet.cancel();
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    const stopping = stopDiskWatch;
    stopDiskWatch = undefined;
    await stopping?.();
  }

  return { request, flush, start, stop, localChanged, lookAt, rescan, idle: () => mutex };
}
