import { PART_SIZE, type GoneReason } from '@pappdrive/protocol';
import { SyncError } from '../../shared/errors.js';
import type { Status } from '../../shared/types.js';
import { goneError } from '../errors.js';
import { createFiles } from './files/index.js';
import { createPathLocks } from './locks.js';
import { createSyncEngine } from './round/index.js';
import { createScanner } from './scan/index.js';
import { createScheduler } from './scheduler.js';
import { createLocalState } from './state.js';
import { createStatus } from './status.js';
import { createTabs } from './tabs.js';
import type { Folder, FolderContext, Tuning } from './types.js';

export function openFolder(ctx: FolderContext, tuningOverrides?: Partial<Tuning>): Folder {
  const tuning: Tuning = { partSize: PART_SIZE, quietMs: 2_000, maxWaitMs: 10_000, watchQuietMs: 2_000, watchMaxMs: 10_000, ...tuningOverrides };
  const { partSize } = tuning;
  const stop = new AbortController();
  const { signal } = stop;
  const withLock = createPathLocks();
  const state = createLocalState(ctx.fs);
  const tabs = createTabs(ctx, signal);
  const status = createStatus({ readOnly: ctx.readOnly, state, broadcast: tabs.post, signal });
  const scanner = createScanner(ctx, partSize, state, status.fire);
  const engine = createSyncEngine({ ctx, partSize, state, scanner, withLock, fire: status.fire, signal });
  const scheduler = createScheduler({ ctx, tuning, state, scanner, engine, status, isLeading: () => tabs.leading, signal });
  const { removeCrashedWriteTemps, ...files } = createFiles({
    ctx,
    partSize,
    state,
    scanner,
    withLock,
    isLeading: () => tabs.leading,
    assertOpen,
    changedHere: path => {
      if (tabs.leading) {
        scheduler.localChanged([path]);
      } else {
        status.deliver({ path, origin: 'local' });
        tabs.tellLeader(path);
      }
    },
  });

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

    if (signal.aborted) {
      return;
    }

    tabs.leading = true;
    status.refresh();
    await scheduler.start();
    void scheduler.request(true);
  }

  function follow(received: Status): void {
    status.replace(received);

    if (received.deleted !== null) {
      stop.abort();
    }
  }

  async function sync(): Promise<void> {
    if (status.live.deleted) {
      return;
    }

    assertOpen();

    if (!tabs.leading) {
      return tabs.askLeaderToSync();
    }

    const failure = await scheduler.flush();

    if (failure) {
      throw failure;
    }
  }

  async function close(): Promise<void> {
    if (signal.aborted) {
      return;
    }

    stop.abort();
    try {
      await scheduler.stop();
      await scheduler.idle();

      if (tabs.leading) {
        await state.flush();
      }
    } finally {
      tabs.close();
    }
  }

  async function markDeleted(reason: GoneReason): Promise<void> {
    if (signal.aborted) {
      return;
    }

    stop.abort();
    status.markDeleted(reason);
    try {
      await scheduler.stop();
      await ctx.fs.destroy();
    } finally {
      status.notify();
      tabs.close();
    }
  }

  function assertOpen(): void {
    if (status.live.deleted) {
      throw goneError(status.live.deleted);
    } else if (signal.aborted) {
      throw new SyncError('signed-out', 'This folder was closed (sign-out or close). Sign in and open it again with papp.open().');
    }
  }

  return {
    readOnly: ctx.readOnly,
    get status(): Status {
      return status.snapshot();
    },
    start: () =>
      tabs.start({
        lead: becomeLeader,
        onError: status.setError,
        deliver: status.deliver,
        setStatus: follow,
        followerChanged: paths => (paths.length === 0 ? void scheduler.flush() : scheduler.lookAt(paths)),
      }),
    close,
    markDeleted,
    stopFailed: status.stopFailed,
    watch: status.watch,
    onStatus: status.onStatus,
    sync,
    ...files,
  };
}
