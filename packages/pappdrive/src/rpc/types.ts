import type { GoneReason } from '@pappdrive/protocol';
import type { SyncErrorCode } from '../shared/errors.js';
import type { Change, Files, Papp, Status } from '../shared/types.js';

export interface Transport {
  send(text: string): void;
  onMessage(cb: (text: string) => void): void;
}

export type RpcErrorCode = SyncErrorCode | 'bad-request' | 'internal';

export interface RpcErrorBody {
  code: RpcErrorCode;
  message: string;
  retryAfter?: number;
  reason?: GoneReason;
}

export type Message = { id?: number; method: string; params: unknown } | { id: number; ok: true; value: unknown } | { id: number; ok: false; error: RpcErrorBody };

export type MethodMap = Record<string, { params: unknown; result: unknown }>;

export type FilesHandle = string;
export type OpenWhere = Parameters<Papp['open']>[0];

type Result<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;
// TypeScript types carry no parameter names, and the wire sends parameters by name.
type Params<Calls, Named extends Record<keyof Calls, object>> = Named;

type PappCalls = Omit<Papp, 'ready' | 'signedIn' | 'files'>;
type PappParams = Params<
  PappCalls,
  {
    open: { where: OpenWhere };
    openReadOnly: { app: string };
    signUp: { email: string; password: string };
    pendingSignUp: Record<string, never>;
    confirmRecoveryCode: Record<string, never>;
    verifyEmail: { code: string };
    sendVerificationEmail: Record<string, never>;
    signIn: { email: string; password: string };
    recover: { email: string; recoveryCode: string; newPassword: string };
    setPassword: { newPassword: string };
    signOut: Record<string, never>;
    deleteApp: { password: string };
    deleteAccount: { password: string };
    close: Record<string, never>;
  }
>;

type FileCalls = Pick<Files, 'readText' | 'list' | 'remove'>;
type FileParams = Params<FileCalls, { readText: { path: string }; list: { dir?: string }; remove: { path: string } }>;

export type PappMethods = { [K in keyof PappCalls]: { params: PappParams[K]; result: K extends 'open' | 'openReadOnly' ? FilesHandle : Result<PappCalls[K]> } } & {
  [K in keyof FileCalls as `files.${K}`]: { params: { files: FilesHandle } & FileParams[K]; result: Result<FileCalls[K]> };
} & {
  signedIn: { params: Record<string, never>; result: boolean };
  'files.readOnly': { params: { files: FilesHandle }; result: boolean };
  'files.status': { params: { files: FilesHandle }; result: Status };
  'files.sync': { params: { files: FilesHandle }; result: void };
  'files.writeText': { params: { files: FilesHandle; path: string; text: string }; result: void };
  'files.writeStart': { params: { files: FilesHandle; path: string }; result: number };
  'files.writeChunk': { params: { id: number; base64: string }; result: void };
  'files.writeEnd': { params: { id: number }; result: void };
  'files.readStart': { params: { files: FilesHandle; path: string }; result: number };
  'files.readChunk': { params: { id: number }; result: string | null };
  'files.cancel': { params: { id: number }; result: void };
};

export type HostMethods = {
  'host.keystore.get': { params: { name: string }; result: string | null };
  'host.keystore.set': { params: { name: string; value: string }; result: void };
  'host.keystore.delete': { params: { name: string }; result: void };
};

export type PappEvents = {
  ready: { params: Record<string, never>; result: void };
  change: { params: { files: FilesHandle; change: Change }; result: void };
  status: { params: { files: FilesHandle; status: Status }; result: void };
};
