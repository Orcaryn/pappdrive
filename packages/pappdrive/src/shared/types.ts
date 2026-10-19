import type { GoneReason } from '@pappdrive/protocol';

export interface PappOptions {
  server: string;
  app: string;
  read?: string[];
  keyStore?: KeyStore;
}

export interface Papp {
  readonly ready: Promise<void>;
  readonly signedIn: boolean;
  readonly files: Files;
  open(opts: { mode: 'visible'; path: string } | { mode: 'private' }): Promise<Files>;
  openReadOnly(app: string): Promise<Files>;
  signUp(email: string, password: string): Promise<{ recoveryCode: string }>;
  pendingSignUp(): Promise<PendingSignUp | null>;
  confirmRecoveryCode(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  recover(email: string, recoveryCode: string, newPassword: string): Promise<void>;
  setPassword(newPassword: string): Promise<void>;
  signOut(): Promise<void>;
  deleteApp(password: string): Promise<void>;
  deleteAccount(password: string): Promise<void>;
  close(): Promise<void>;
}

export interface PendingSignUp {
  email: string;
  recoveryCode: string;
}

export interface FileInfo {
  path: string;
  size: number;
  mtime: number;
  dir: boolean;
}

export type WriteData = string | Uint8Array | Blob | ReadableStream<Uint8Array>;

export interface Change {
  path: string;
  origin: 'local' | 'remote' | 'conflict' | 'skipped' | 'case-duplicate';
  copy?: string;
  reason?: 'bad name';
}

export interface Status {
  syncing: boolean;
  lastSync: number | null;
  pending: number;
  skipped: string[];
  deleted: GoneReason | null;
  error: string | null;
}

export interface Files {
  readonly readOnly: boolean;
  write(path: string, data: WriteData): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  readStream(path: string): ReadableStream<Uint8Array>;
  list(dir?: string): Promise<FileInfo[]>;
  remove(path: string): Promise<void>;
  watch(cb: (change: Change) => void): () => void;
  readonly status: Status;
  onStatus(cb: (status: Status) => void): () => void;
  sync(): Promise<void>;
}

export interface KeyStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}
