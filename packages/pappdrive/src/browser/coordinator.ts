import type { Coordinator, CoordinatorMessage } from '../shared/platform.js';

export interface LockManagerLike {
  request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
}

export function browserCoordinator(name: string, locks: LockManagerLike = navigator.locks): Coordinator {
  const key = `pappdrive:${name}`;
  const channel = new BroadcastChannel(key);
  const listeners = new Set<(msg: CoordinatorMessage) => void>();
  const abort = new AbortController();
  let leader = false;
  let closed = false;
  const held = Promise.withResolvers<void>();
  const lead = Promise.withResolvers<void>();

  // a Web Lock passes to the next waiting tab when its holder's tab goes away.
  locks
    .request(key, { signal: abort.signal }, async () => {
      if (closed) {
        return;
      }

      leader = true;
      lead.resolve();
      await held.promise;
    })
    .catch((e: unknown) => {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        throw e;
      }
    });

  // a BroadcastChannel never delivers a message to its sender.
  channel.onmessage = (e: MessageEvent<CoordinatorMessage>) => {
    for (const cb of listeners) {
      cb(e.data);
    }
  };

  return {
    waitForLead: () => lead.promise,
    isLeader: () => leader,
    post(msg) {
      if (!closed) {
        channel.postMessage(msg);
      }
    },
    onMessage(cb) {
      listeners.add(cb);

      return () => listeners.delete(cb);
    },
    close() {
      closed = true;
      leader = false;
      listeners.clear();
      abort.abort();
      held.resolve();
      channel.close();
    },
  };
}
