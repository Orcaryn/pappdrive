import {
  APP_NAME_RE,
  DEFAULT_ARGON2,
  ID_RE,
  MAX_BLOB_SIZE,
  normalizeEmail,
  type Argon2Params,
  type CheckpointRequest,
  type DeltaCommitRequest,
  type DeltaFile,
} from '@pappdrive/protocol';
import { fromBase64 } from './bytes';
import { ApiError } from './http';

type Obj = Record<string, unknown>;

export async function body(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError('bad-request');
  }
}

export function obj(v: unknown): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ApiError('bad-request');
  }

  return v as Obj;
}

export function email(v: unknown): string {
  if (typeof v !== 'string') {
    throw new ApiError('bad-request');
  }

  const e = normalizeEmail(v);

  if (e.length < 3 || e.length > 254 || !e.includes('@') || /\s/.test(e)) {
    throw new ApiError('bad-request');
  }

  return e;
}

export function text(v: unknown): string {
  if (typeof v !== 'string') {
    throw new ApiError('bad-request');
  }

  return v;
}

export function appName(v: unknown): string {
  if (typeof v !== 'string' || !APP_NAME_RE.test(v)) {
    throw new ApiError('bad-request');
  }

  return v;
}

export function readList(v: unknown): string[] {
  if (v === undefined) {
    return [];
  } else if (!Array.isArray(v) || v.length > 100) {
    throw new ApiError('bad-request');
  }

  return [...new Set(v.map(appName))];
}

export function keyBytes(v: unknown): Uint8Array {
  const b = typeof v === 'string' ? fromBase64(v) : null;

  if (!b || b.length < 16 || b.length > 128) {
    throw new ApiError('bad-request');
  }

  return b;
}

export function lockedCopy(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 4096 || !fromBase64(v)) {
    throw new ApiError('bad-request');
  }

  return v;
}

export function deltaCommit(v: unknown): DeltaCommitRequest {
  const o = obj(v);
  const etag = etagOf(o.etag);

  if (etag === null) {
    throw new ApiError('bad-request');
  }

  return { delta: deltaFile(o.delta), etag };
}

export function checkpointCommit(v: unknown): CheckpointRequest {
  const o = obj(v);
  const delta = deltaFile(o.delta);

  if (Object.keys(delta.blobs).length > 0) {
    throw new ApiError('bad-request');
  }

  const index = obj(o.index);

  if (index.v !== 1 || typeof index.body !== 'string') {
    throw new ApiError('bad-request');
  }

  return { index: { v: 1, blobs: header(index.blobs), body: index.body }, delta, etag: etagOf(o.etag) };
}

function etagOf(v: unknown): string | null {
  if (v !== null && (typeof v !== 'string' || v.length === 0 || v.length > 200)) {
    throw new ApiError('bad-request');
  }

  return v;
}

function deltaFile(v: unknown): DeltaFile {
  const o = obj(v);

  if (o.v !== 1 || typeof o.body !== 'string') {
    throw new ApiError('bad-request');
  }

  return { v: 1, base: blobId(o.base), blobs: header(o.blobs), body: o.body };
}

function header(v: unknown): Record<string, number> {
  const blobs: Record<string, number> = {};

  for (const [key, size] of Object.entries(obj(v))) {
    const id = blobId(key);

    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
      throw new ApiError('bad-request');
    } else if (size > MAX_BLOB_SIZE) {
      throw new ApiError('too-big');
    }

    blobs[id] = size;
  }

  return blobs;
}

const ARGON2_MAX: Argon2Params = { m: 4 * 1024 * 1024, t: 1000, p: 255 };

export function argon2Params(v: unknown): Argon2Params {
  if (v === undefined) {
    return DEFAULT_ARGON2;
  }

  const o = obj(v);

  const param = (k: keyof Argon2Params): number => {
    const n = o[k];

    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < DEFAULT_ARGON2[k] || n > ARGON2_MAX[k]) {
      throw new ApiError('bad-request');
    }

    return n;
  };

  return { m: param('m'), t: param('t'), p: param('p') };
}

function blobId(v: unknown): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    throw new ApiError('bad-request');
  }

  return v;
}
