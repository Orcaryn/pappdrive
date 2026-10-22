import { API_PREFIX, ID_RE, type CommitResponse } from '@pappdrive/protocol';
import { activeWriter, bearer, readableApp, watchBearer } from '../shared/access';
import type { FolderCommit } from '../folder-queue/commit';
import { keys } from '../shared/bucket';
import type { Env } from '../shared/env';
import { ApiError, CORS_HEADERS, json } from '../shared/http';
import * as v from '../shared/validate';

export async function getDelta(env: Env, request: Request, url: URL): Promise<Response> {
  const claims = await bearer(env, request);
  const app = readableApp(claims, url);
  const delta = await env.BUCKET.get(keys.delta(claims.sub, app), { onlyIf: request.headers });

  if (!delta) {
    return new Response(null, { status: 404, headers: CORS_HEADERS });
  } else if (!('body' in delta)) {
    return new Response(null, { status: 304, headers: CORS_HEADERS });
  }

  // no-transform keeps Cloudflare from compressing the response, which would
  // turn the ETag into a weak W/"..." validator the commit could not use.
  return new Response(delta.body, { headers: { ...CORS_HEADERS, ETag: delta.httpEtag, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-transform' } });
}

export async function getIndex(env: Env, request: Request, url: URL): Promise<Response> {
  const claims = await bearer(env, request);
  const app = readableApp(claims, url);
  const id = url.pathname.slice(`${API_PREFIX}/index/`.length);

  if (!ID_RE.test(id)) {
    throw new ApiError('bad-request');
  }

  const index = await env.BUCKET.get(keys.index(claims.sub, app, id));

  if (!index) {
    return new Response(null, { status: 404, headers: CORS_HEADERS });
  }

  return new Response(index.body, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function watchFolder(env: Env, request: Request, url: URL): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    throw new ApiError('bad-request');
  }

  const claims = await watchBearer(env, request);
  const app = readableApp(claims, url);

  return env.FOLDER.getByName(`${claims.sub}/${app}`).fetch(request);
}

export async function commitDelta(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  const { delta, etag } = v.deltaCommit(await v.body(request));
  const { app, room } = await activeWriter(env, claims);

  return commitResponse(await env.FOLDER.getByName(`${claims.sub}/${app}`).commitDelta(delta, etag, room));
}

export async function commitCheckpoint(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  const { index, delta, etag } = v.checkpointCommit(await v.body(request));
  const { app, room } = await activeWriter(env, claims);

  return commitResponse(await env.FOLDER.getByName(`${claims.sub}/${app}`).commitCheckpoint(index, delta, etag, room));
}

function commitResponse(result: FolderCommit): Response {
  if (result.ok) {
    return json({ etag: result.etag } satisfies CommitResponse);
  } else if (result.error === 'missing') {
    throw new ApiError('missing', { missing: result.missing });
  } else if (result.error === 'over-quota') {
    throw new ApiError('over-quota');
  }

  throw new ApiError('stale');
}
