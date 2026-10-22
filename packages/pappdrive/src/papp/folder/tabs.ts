import type { Coordinator, CoordinatorMessage } from '../../shared/platform.js';
import type { Change, Status } from '../../shared/types.js';
import type { FolderContext } from './types.js';

interface TabHooks {
  lead: () => Promise<void>;
  onError: (e: unknown) => void;
  deliver: (change: Change) => void;
  setStatus: (status: Status) => void;
  followerChanged: (paths: string[]) => void;
}

const OWN_WRITE_ECHO_MS = 10_000;

export function createTabs(ctx: FolderContext, signal: AbortSignal) {
  let coord: Coordinator | undefined = undefined;
  const recentWrites = new Map<string, number>();
  const tabs = {
    leading: false,
    get shared(): boolean {
      return coord !== undefined;
    },
    start,
    post,
    tellLeader,
    askLeaderToSync,
    close,
  };

  async function start(hooks: TabHooks): Promise<void> {
    const coordinator = ctx.platform.coordinator?.(`${ctx.app}${ctx.readOnly ? ':read' : ''}`);

    if (!coordinator) {
      return hooks.lead();
    }

    coord = coordinator;
    coordinator.onMessage(m => {
      if (signal.aborted) {
        return;
      } else if (tabs.leading) {
        if (m.type === 'local-change') {
          hooks.followerChanged(m.paths);
        }
      } else if (m.type === 'change') {
        const wrote = recentWrites.get(m.change.path);

        if (m.change.origin !== 'local' || wrote === undefined || Date.now() - wrote >= OWN_WRITE_ECHO_MS) {
          hooks.deliver(m.change);
        }
      } else if (m.type === 'status') {
        hooks.setStatus(m.status);
      }
    });
    const granted = coordinator.waitForLead().then(() => true);
    const now = await Promise.race([granted, new Promise<boolean>(r => setTimeout(() => r(false), 50))]);

    if (now || coordinator.isLeader()) {
      return hooks.lead();
    }

    void granted.then(() => {
      if (!signal.aborted) {
        hooks.lead().catch(hooks.onError);
      }
    });
  }

  function post(msg: CoordinatorMessage): void {
    if (tabs.leading) {
      coord?.post(msg);
    }
  }

  function tellLeader(path: string): void {
    recentWrites.set(path, Date.now());
    coord?.post({ type: 'local-change', paths: [path] });
  }

  async function askLeaderToSync(): Promise<void> {
    const leader = coord;

    if (!leader) {
      return;
    }

    await new Promise<void>(resolve => {
      let sawSyncing = false;
      const timer = setTimeout(done, 30_000);
      const off = leader.onMessage(m => {
        if (m.type !== 'status') {
          return;
        } else if (m.status.syncing) {
          sawSyncing = true;
        } else if (sawSyncing) {
          done();
        }
      });

      function done() {
        clearTimeout(timer);
        off();
        resolve();
      }

      leader.post({ type: 'local-change', paths: [] });
    });
  }

  function close(): void {
    coord?.close();
  }

  return tabs;
}
