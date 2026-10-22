import type { Argon2 } from './crypto.js';
import type { Change, Status } from './types.js';

export interface FileStat {
  size: number;
  mtime: number;
}

export interface DirEntry {
  name: string;
  dir: boolean;
}

export interface FsAdapter {
  readonly kind: 'visible' | 'private';
  readonly caseInsensitive: boolean;
  canCreate(segment: string): boolean;

  stat(path: string): Promise<FileStat | null>;
  list(dir: string): Promise<DirEntry[]>;
  read(path: string, offset: number, length: number): Promise<Uint8Array>;
  moveTempInto(temp: string, path: string): Promise<FileStat>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  removeEmptyDirs(dir: string): Promise<void>;

  tempSize(temp: string): Promise<number | null>;
  tempAppend(temp: string, data: Uint8Array): Promise<void>;
  tempTruncate(temp: string, size: number): Promise<void>;
  tempRemove(temp: string): Promise<void>;
  tempList(): Promise<string[]>;

  loadState(name: string): Promise<string | null>;
  saveState(name: string, data: string): Promise<void>;

  destroy(): Promise<void>;

  watch?(skipGlobs: string[], onPaths: (paths: string[]) => void, onDropped: () => void): Promise<() => Promise<void>>;
}

export interface Coordinator {
  waitForLead(): Promise<void>;
  isLeader(): boolean;
  post(msg: CoordinatorMessage): void;
  onMessage(cb: (msg: CoordinatorMessage) => void): () => void;
  close(): void;
}
export type CoordinatorMessage = { type: 'local-change'; paths: string[] } | { type: 'change'; change: Change } | { type: 'status'; status: Status };

export interface Platform {
  argon2: Argon2;
  openPrivate(userId: string, app: string, readFor?: string): Promise<FsAdapter>;
  openVisible(path: string): Promise<FsAdapter>;
  coordinator?(name: string): Coordinator;
  persist?(): Promise<void>;
  onBackground?(cb: () => Promise<unknown>): () => void;
}
