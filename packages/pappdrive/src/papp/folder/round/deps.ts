import type { Change } from '../../../shared/types.js';
import type { WithLock } from '../locks.js';
import type { Scanner } from '../scan/index.js';
import type { LocalState } from '../state.js';
import type { FolderContext } from '../types.js';

export interface RoundDeps {
  ctx: FolderContext;
  partSize: number;
  state: LocalState;
  scanner: Scanner;
  withLock: WithLock;
  fire: (change: Change) => void;
  signal: AbortSignal;
}
