import { PART_SIZE, type GoneReason } from '@pappdrive/protocol';
import { SyncError } from '../../shared/errors.js';
import type { Status } from '../../shared/types.js';
import { goneError } from '../errors.js';
import { createFiles } from './files/index.js';
import { createSyncEngine } from './round/index.js';
import { createRounds } from './rounds.js';
import { createScanner } from './scan/index.js';
import { createPathLocks } from './shared/locks.js';
import { createLocalState } from './shared/state.js';
import type { Folder, FolderContext, Tuning } from './shared/types.js';
import { createStatus } from './status.js';
import { createTabs } from './tabs.js';
import { createWatchHints } from './watch.js';

export function openFolder(ctx: FolderContext, tuningOverrides?: Partial<Tuning>): Folder {
  const tuning: Tuning = { partSize: PART_SIZE, pollMs: 10_000, quietMs: 2_000, maxWaitMs: 10_000, watchQuietMs: 2_000, watchMaxMs: 10_000, ...tuningOverrides };
  const { partSize } = tuning;
  let closed = false;
  let offBackground: (() => void) | undefined = undefined;
  const isLeading = () => tabs.leading;
  const withLock = createPathLocks();
  const state = createLocalState(ctx.fs);
  const status = createStatus({ readOnly: ctx.readOnly, state, skippedPaths: () => engine.skippedPaths, broadcast: msg => tabs.broadcast(msg), isStopped });
  const scanner = createScanner(ctx, partSize, state, status.fire);
  const engine = createSyncEngine({ ctx, partSize, state, scanner, withLock, fire: status.fire, isStopped });
  const watcher = createWatchHints(
    ctx,
    tuning,
    scanner,
    paths => rounds.lookAt(paths),
    () => rounds.rescan()
  );
  const rounds = createRounds({ tuning, state, scanner, engine, watcher, status, watchIndex: ctx.api.watchIndex, isLeading, isStopped });
  const tabs = createTabs(ctx, {
    isStopped,
    deliver: status.deliver,
    setStatus: status.replace,
    followerChanged: paths => (paths.length === 0 ? void rounds.flush() : rounds.lookAt(paths)),
  });
  const { removeCrashedWriteTemps, ...files } = createFiles({
    ctx,
    partSize,
    state,
    scanner,
    withLock,
    isLeading,
    assertOpen,
    changedHere: path => {
      if (tabs.leading) {
        return rounds.localChanged([path]);
      }

      status.deliver({ path, origin: 'local' });
      tabs.tellLeader(path);
    },
  });

  function isStopped(): boolean {
    return closed || status.live.deleted !== null;
  }

  async function becomeLeader(): Promise<void> {
    const { fs, app } = ctx;
    const owner = await fs.loadState('app');

    if (owner !== null && owner !== app) {
      throw new SyncError(
        'folder-taken',
        `This folder belongs to the app "${owner}". Two apps cannot sync the same files. ` +
          `Open another folder for "${app}", or open "${owner}"'s folder read-only with papp.openReadOnly("${owner}").`
      );
    }

    await state.load();

    if (!tabs.shared) {
      await removeCrashedWriteTemps();
    }

    await scanner.scan();

    if (owner === null) {
      await fs.saveState('app', app);
    }

    await state.flush();

    if (isStopped()) {
      return;
    }

    tabs.leading = true;
    status.refresh();
    await watcher.start();
    rounds.start();
    offBackground = ctx.platform.onBackground?.(() => rounds.flush());
    void rounds.request(true);
  }

  async function sync(): Promise<void> {
    if (status.live.deleted) {
      return;
    }

    assertOpen();

    if (!tabs.leading) {
      return tabs.askLeaderToSync();
    }

    const failure = await rounds.flush();

    if (failure) {
      throw failure;
    }
  }

  async function close(): Promise<void> {
    if (closed) {
      return;
    }

    closed = true;
    stopTimers();
    await watcher.stop();
    await rounds.idle();

    if (tabs.leading && !status.live.deleted) {
      await state.flush();
    }

    tabs.close();
  }

  async function markDeleted(reason: GoneReason): Promise<void> {
    if (status.live.deleted) {
      return;
    }

    status.markDeleted(reason);
    stopTimers();
    await watcher.stop();
    await ctx.fs.destroy();
    status.notify();
    tabs.close();
  }

  function stopTimers(): void {
    rounds.stop();
    status.stopRefresh();
    offBackground?.();
    offBackground = undefined;
  }

  function assertOpen(): void {
    if (status.live.deleted) {
      throw goneError(status.live.deleted);
    } else if (closed) {
      throw new SyncError('signed-out', 'This folder was closed (sign-out or close). Sign in and open it again with papp.open().');
    }
  }

  return {
    readOnly: ctx.readOnly,
    get status(): Status {
      return status.snapshot();
    },
    start: () => tabs.start(becomeLeader, status.setError),
    close,
    markDeleted,
    watch: status.watch,
    onStatus: status.onStatus,
    sync,
    ...files,
  };
}
