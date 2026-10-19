import type { Change } from '../../../../shared/types.js';
import type { Scanner } from '../../scan/index.js';
import type { WithLock } from '../../shared/locks.js';
import type { LocalState } from '../../shared/state.js';
import type { FolderContext } from '../../shared/types.js';

export interface RoundDeps {
  ctx: FolderContext;
  partSize: number;
  state: LocalState;
  scanner: Scanner;
  withLock: WithLock;
  fire: (change: Change) => void;
  isStopped: () => boolean;
}

export class Stopped extends Error {}
