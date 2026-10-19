const EXIT_WAIT_MS = 10_000;
const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
const callbacks = new Set<() => Promise<unknown>>();
let exiting = false;
let ranBeforeExit = false;

function runAll(): Promise<unknown> {
  const results = [...callbacks].map(cb => cb());
  const timeout = new Promise(r => setTimeout(r, EXIT_WAIT_MS).unref());

  return Promise.race([Promise.allSettled(results), timeout]);
}

function onSignal(signal: NodeJS.Signals) {
  if (exiting) {
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }

  exiting = true;
  void runAll().finally(() => {
    process.removeListener(signal, onSignal);

    // any SIGINT/SIGTERM listener replaces Node's default exit; re-raising the signal with none left restores it.
    if (process.listenerCount(signal) === 0) {
      process.kill(process.pid, signal);
    }
  });
}

function onBeforeExit() {
  // Node fires beforeExit again after a callback starts new work.
  if (ranBeforeExit) {
    return;
  }

  ranBeforeExit = true;
  void runAll();
}

export function onProcessEnd(cb: () => Promise<unknown>): () => void {
  if (callbacks.size === 0) {
    process.on('beforeExit', onBeforeExit);

    for (const s of SIGNALS) {
      process.on(s, onSignal);
    }
  }

  callbacks.add(cb);

  return () => {
    callbacks.delete(cb);

    if (callbacks.size === 0) {
      process.removeListener('beforeExit', onBeforeExit);

      for (const s of SIGNALS) {
        process.removeListener(s, onSignal);
      }
    }
  };
}
