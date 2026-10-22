import type { CommitResult, DeltaFile, GoneReason, IndexFile } from '@pappdrive/protocol';
import type { DataKeys } from '../../shared/crypto.js';
import type { Files } from '../../shared/types.js';
import type { FsAdapter, Platform } from '../../shared/platform.js';

type DeltaFetch<K> = { kind: 'unchanged'; known: K } | { kind: 'missing' } | { kind: 'found'; delta: DeltaFile; etag: string };

export interface FolderApi {
  getDelta<K extends { etag: string | null }>(known: K | null): Promise<DeltaFetch<K>>;
  getIndex(id: string): Promise<IndexFile>;
  getBlob(id: string): Promise<Uint8Array>;
  putBlob(id: string, data: Uint8Array): Promise<void>;
  commitDelta(delta: DeltaFile, etag: string): Promise<CommitResult>;
  commitCheckpoint(index: IndexFile, delta: DeltaFile, etag: string | null): Promise<CommitResult>;
  watchIndex(check: () => void): () => void;
}

export interface FolderContext {
  app: string;
  readOnly: boolean;
  fs: FsAdapter;
  keys: DataKeys;
  api: FolderApi;
  platform: Platform;
  syncOnBackground?: boolean;
  noticeGone(): Promise<void>;
}

export interface Folder extends Files {
  start(): Promise<void>;
  close(): Promise<void>;
  markDeleted(reason: GoneReason): Promise<void>;
  stopFailed: (e: unknown) => void;
}

export interface Tuning {
  partSize: number;
  quietMs: number;
  maxWaitMs: number;
  watchQuietMs: number;
  watchMaxMs: number;
}
