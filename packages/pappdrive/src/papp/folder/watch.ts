import type { Scanner } from './scan/index.js';
import { createDebounce } from './shared/debounce.js';
import type { FolderContext, Tuning } from './shared/types.js';

export type WatchHints = ReturnType<typeof createWatchHints>;

export function createWatchHints(ctx: FolderContext, tuning: Tuning, scanner: Scanner, onQuiet: (paths: string[]) => void, onDropped: () => void) {
  let stopWatcher: (() => Promise<void>) | undefined = undefined;
  let skipGlobsJson = '';
  const pending = new Set<string>();
  const quiet = createDebounce(tuning.watchQuietMs, tuning.watchMaxMs, () => {
    const paths = [...pending];
    pending.clear();
    onQuiet(paths);
  });

  async function start(): Promise<void> {
    if (!ctx.fs.watch) {
      return;
    }

    const skipGlobs = scanner.watcherSkipGlobs();
    skipGlobsJson = JSON.stringify(skipGlobs);
    stopWatcher = await ctx.fs.watch(skipGlobs, add, onDropped);
  }

  async function stop(): Promise<void> {
    quiet.cancel();
    const stopping = stopWatcher;
    stopWatcher = undefined;
    await stopping?.();
  }

  async function restartIfRulesChanged(): Promise<void> {
    const stopping = stopWatcher;

    if (!stopping || JSON.stringify(scanner.watcherSkipGlobs()) === skipGlobsJson) {
      return;
    }

    stopWatcher = undefined;
    await stopping();
    await start();
  }

  function add(paths: string[]): void {
    for (const p of paths) {
      pending.add(p);
    }

    quiet.poke();
  }

  return { start, stop, restartIfRulesChanged, add };
}
