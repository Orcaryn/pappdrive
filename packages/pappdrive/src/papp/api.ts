import {
  API_PREFIX,
  type CheckpointRequest,
  type CommitResponse,
  type CommitResult,
  type DeltaCommitRequest,
  type DeltaFile,
  type GoneReason,
  type IndexFile,
  type RefreshRequest,
  type RefreshResponse,
} from '@pappdrive/protocol';
import { withPlainBuffer } from '../shared/bytes.js';
import { SyncError } from '../shared/errors.js';
import { goneError, serverError, signedOut } from './errors.js';
import { ApiError, decodeJwt, request, send } from './http.js';
import { watchIndex } from './index-watch.js';
import type { FolderApi } from './folder/types.js';

const REFRESH_MARGIN_SECONDS = 60;

interface ApiHooks {
  onGone(reason: GoneReason): Promise<void>;
  onSignedOut(): Promise<void>;
}

export type Api = ReturnType<typeof createApi>;

export function createApi(server: string, read: string[], hooks: ApiHooks) {
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  let refreshing: Promise<string> | null = null;

  function setSession(nextRefresh: string, nextAccess: string | null): void {
    refreshToken = nextRefresh;
    accessToken = nextAccess;
  }

  function clear(): void {
    refreshToken = null;
    accessToken = null;
    refreshing = null;
  }

  function refresh(): Promise<string> {
    refreshing ??= (async () => {
      const sent = refreshToken;

      if (!sent) {
        throw signedOut();
      }

      try {
        const res = await request<RefreshResponse>(server, 'POST', '/auth/refresh', { refreshToken: sent, read } satisfies RefreshRequest);

        if (refreshToken === sent) {
          accessToken = res.accessToken;
        }

        return res.accessToken;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await hooks.onSignedOut();

          throw signedOut('This device was signed out on the server.');
        }

        return rethrow(e);
      }
    })().finally(() => {
      refreshing = null;
    });

    return refreshing;
  }

  async function authed<T>(call: (token: string) => Promise<T>): Promise<T> {
    const current = accessToken;
    const token = current !== null && decodeJwt(current).exp - REFRESH_MARGIN_SECONDS >= Date.now() / 1000 ? current : await refresh();

    try {
      return await call(token);
    } catch (e) {
      if (!(e instanceof ApiError && e.error === 'expired')) {
        return rethrow(e);
      }

      return call(await refresh()).catch((e2: unknown) => rethrow(e2));
    }
  }

  async function rethrow(e: unknown): Promise<never> {
    if (e instanceof ApiError && e.status === 410 && e.reason !== undefined) {
      await hooks.onGone(e.reason);

      throw goneError(e.reason);
    }

    throw e;
  }

  function folderApi(app: string, readOnly: boolean): FolderApi {
    const q = readOnly ? `?app=${encodeURIComponent(app)}` : '';

    function translated<T>(path: string, call: (token: string) => Promise<T>): Promise<T> {
      return authed(call).catch((e: unknown) => {
        throw e instanceof ApiError ? serverError(e, { path, server, app, read }) : e;
      });
    }

    return {
      getDelta: known =>
        translated('/delta', async token => {
          const res = await send(server, 'GET', `/delta${q}`, { headers: known === null || known.etag === null ? {} : { 'if-none-match': known.etag }, token, accept: [304, 404] });

          if (res.status === 304 && known !== null) {
            return { kind: 'unchanged', known };
          } else if (res.status === 404) {
            return { kind: 'missing' };
          }

          const etag = res.headers.get('ETag');
          const delta = (await res.json()) as Omit<DeltaFile, 'v'> & { v: number };

          if (etag === null) {
            throw new SyncError('server', 'The server sent the delta without its ETag. Update the server.');
          }

          checkVersion(delta.v);

          return { kind: 'found', delta: { v: 1, base: delta.base, blobs: delta.blobs, body: delta.body }, etag };
        }),

      getIndex: id =>
        translated('/index', async token => {
          const index = (await (await send(server, 'GET', `/index/${id}${q}`, { token })).json()) as Omit<IndexFile, 'v'> & { v: number };
          checkVersion(index.v);

          return { v: 1, blobs: index.blobs, body: index.body };
        }),

      getBlob: id => translated('/blobs', async token => new Uint8Array(await (await send(server, 'GET', `/blobs/${id}${q}`, { token })).arrayBuffer())),

      putBlob: (id, data) =>
        translated('/blobs', async token => {
          await send(server, 'PUT', `/blobs/${id}`, { body: withPlainBuffer(data), headers: { 'content-type': 'application/octet-stream' }, token });
        }),

      commitDelta: (delta, etag) => translated('/delta', token => commit(server, '/delta', { delta, etag } satisfies DeltaCommitRequest, token)),

      commitCheckpoint: (index, delta, etag) => translated('/index', token => commit(server, '/index', { index, delta, etag } satisfies CheckpointRequest, token)),

      watchIndex: check => watchIndex(`${server.replace(/^http/, 'ws')}${API_PREFIX}/index/watch${q}`, () => authed(async token => token), check),
    };
  }

  return { setSession, clear, refresh, authed, folderApi };
}

function checkVersion(v: number): void {
  if (v !== 1) {
    throw new SyncError(
      'update-needed',
      `The folder's index has format version ${String(v)}, which this version of pappdrive does not know. ` +
        `Sync has stopped so nothing is overwritten. Update the pappdrive package, then open the folder again.`
    );
  }
}

async function commit(server: string, path: '/delta' | '/index', body: DeltaCommitRequest | CheckpointRequest, token: string): Promise<CommitResult> {
  try {
    return { ok: true, etag: (await request<CommitResponse>(server, 'PUT', path, body, token)).etag };
  } catch (e) {
    if (e instanceof ApiError && e.error === 'stale') {
      return { ok: false, error: 'stale' };
    } else if (e instanceof ApiError && e.error === 'missing' && e.missing !== undefined) {
      return { ok: false, error: 'missing', missing: e.missing };
    }

    throw e;
  }
}
