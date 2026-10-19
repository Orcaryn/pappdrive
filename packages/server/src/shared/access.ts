import { APP_NAME_RE, WATCH_PROTOCOL, type AccessClaims, type GoneReason } from '@pappdrive/protocol';
import type { Env } from './env';
import { ApiError } from './http';
import { verifyToken } from './tokens';

export interface InstallRow {
  id: string;
  user_id: string;
  app: string;
  refresh_hash: string | null;
  read: string;
  stopped: GoneReason | null;
}

export function bearer(env: Env, request: Request): Promise<AccessClaims> {
  const header = request.headers.get('Authorization');

  return verified(env, header === null ? undefined : /^Bearer\s+(\S+)$/i.exec(header)?.[1]);
}

// a browser cannot set WebSocket headers; RFC 6455 lets it offer several subprotocols, so the token rides as the second one.
export function watchBearer(env: Env, request: Request): Promise<AccessClaims> {
  const offered = request.headers.get('Sec-WebSocket-Protocol');

  return verified(env, offered === null ? undefined : new RegExp(`^${WATCH_PROTOCOL},\\s*(\\S+)$`).exec(offered)?.[1]);
}

async function verified(env: Env, token: string | undefined): Promise<AccessClaims> {
  const claims = token === undefined ? null : await verifyToken(token, [env.TOKEN_KEY, env.TOKEN_KEY_OLD]);

  if (!claims) {
    throw new ApiError('expired');
  }

  return claims;
}

export async function activeWriter(env: Env, claims: AccessClaims): Promise<string> {
  if (!claims.app) {
    throw new ApiError('not-allowed');
  }

  const row = await env.DB.prepare('SELECT * FROM installs WHERE id = ?').bind(claims.install).first<InstallRow>();

  if (!row) {
    throw new ApiError('expired');
  } else if (row.stopped) {
    throw new ApiError('gone', { reason: row.stopped });
  } else if (row.refresh_hash === null) {
    throw new ApiError('expired');
  }

  return claims.app;
}

export function readableApp(claims: AccessClaims, url: URL): string {
  const asked = url.searchParams.get('app');
  const app = asked === null ? claims.app : asked;

  if (!app) {
    throw new ApiError('not-allowed');
  } else if (!APP_NAME_RE.test(app)) {
    throw new ApiError('bad-request');
  } else if (app !== claims.app && !claims.read.includes(app)) {
    throw new ApiError('not-allowed');
  }

  return app;
}
