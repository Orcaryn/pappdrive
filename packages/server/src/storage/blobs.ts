import { API_PREFIX, BLOB_OVERHEAD, ID_RE, MAX_BLOB_SIZE } from '@pappdrive/protocol';
import { activeWriter, bearer, readableApp } from '../shared/access';
import { keys } from '../shared/bucket';
import type { Env } from '../shared/env';
import { ApiError, CORS_HEADERS, noContent } from '../shared/http';

export async function putBlob(env: Env, request: Request, url: URL): Promise<Response> {
  const claims = await bearer(env, request);
  const { success } = await env.RL_UPLOAD.limit({ key: claims.sub });

  if (!success) {
    throw new ApiError('rate-limited');
  }

  const { app } = await activeWriter(env, claims);
  const id = blobIdIn(url);
  const size = Number(request.headers.get('Content-Length'));

  if (!Number.isSafeInteger(size) || size < BLOB_OVERHEAD) {
    throw new ApiError('bad-request');
  } else if (size > MAX_BLOB_SIZE) {
    throw new ApiError('too-big');
  }

  await env.BUCKET.put(keys.blob(claims.sub, app, id), request.body);

  return noContent();
}

export async function getBlob(env: Env, request: Request, url: URL): Promise<Response> {
  const claims = await bearer(env, request);
  const app = readableApp(claims, url);
  const id = blobIdIn(url);
  const blob = await env.BUCKET.get(keys.blob(claims.sub, app, id));

  if (!blob) {
    throw new ApiError('missing', { missing: [id] });
  }

  return new Response(blob.body, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
}

function blobIdIn(url: URL): string {
  const id = url.pathname.slice(`${API_PREFIX}/blobs/`.length);

  if (!ID_RE.test(id)) {
    throw new ApiError('bad-request');
  }

  return id;
}
