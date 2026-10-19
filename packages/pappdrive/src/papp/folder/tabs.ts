import type { Change, Status } from '../../shared/types.js';
import type { Coordinator, CoordinatorMessage } from '../../shared/platform.js';
import type { FolderContext } from './shared/types.js';

interface TabHooks {
  isStopped: () => boolean;
  deliver: (change: Change) => void;
  setStatus: (status: Status) => void;
  followerChanged: (paths: string[]) => void;
}

const OWN_WRITE_ECHO_MS = 10_000;

export function createTabs(ctx: FolderContext, hooks: TabHooks) {
  let coord: Coordinator | undefined = undefined;
  const recentWrites = new Map<string, number>();
  const tabs = {
    leading: false,
    get shared(): boolean {
      return coord !== undefined;
    },
    start,
    broadcast,
    tellLeader,
    askLeaderToSync,
    close,
  };

  async function start(lead: () => Promise<void>, onError: (e: unknown) => void): Promise<void> {
    const coordinator = ctx.platform.coordinator?.(`${ctx.app}${ctx.readOnly ? ':read' : ''}`);

    if (!coordinator) {
      return lead();
    }

    coord = coordinator;
    coordinator.onMessage(onMessage);
    const granted = coordinator.waitForLead().then(() => true);
    const now = await Promise.race([granted, new Promise<boolean>(r => setTimeout(() => r(false), 50))]);

    if (now || coordinator.isLeader()) {
      return lead();
    }

    void granted.then(() => {
      if (!hooks.isStopped()) {
        lead().catch(onError);
      }
    });
  }

  function broadcast(msg: CoordinatorMessage): void {
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

  function onMessage(m: CoordinatorMessage): void {
    if (hooks.isStopped()) {
      return;
    } else if (tabs.leading) {
      if (m.type === 'local-change') {
        hooks.followerChanged(m.paths);
      }

      return;
    } else if (m.type === 'change') {
      const wrote = recentWrites.get(m.change.path);

      if (m.change.origin === 'local' && wrote !== undefined && Date.now() - wrote < OWN_WRITE_ECHO_MS) {
        return;
      }

      hooks.deliver(m.change);
    } else if (m.type === 'status') {
      hooks.setStatus(m.status);
    }
  }

  return tabs;
}
