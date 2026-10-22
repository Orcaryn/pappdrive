import { APP_NAME_RE, WATCH_PROTOCOL, type AccessClaims } from '@pappdrive/protocol';
import { and, eq, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { Env } from './env';
import { ApiError } from './http';
import { apps, installs, plans, users } from './schema';
import { verifyToken } from './tokens';

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

export async function activeWriter(env: Env, claims: AccessClaims): Promise<{ app: string; room: number }> {
  if (!claims.app) {
    throw new ApiError('not-allowed');
  }

  const d = drizzle(env.DB);
  const [[install], otherApps] = await d.batch([
    d
      .select({ stopped: installs.stopped, refreshHash: installs.refreshHash, verified: users.verified, quota: plans.quotaBytes })
      .from(installs)
      .innerJoin(users, eq(users.id, installs.userId))
      .innerJoin(plans, eq(plans.id, users.plan))
      .where(eq(installs.id, claims.install)),
    d
      .select({ bytes: apps.bytes })
      .from(apps)
      .where(and(eq(apps.userId, claims.sub), ne(apps.name, claims.app))),
  ]);

  if (!install) {
    throw new ApiError('expired');
  } else if (install.stopped) {
    throw new ApiError('gone', { reason: install.stopped });
  } else if (install.refreshHash === null) {
    throw new ApiError('expired');
  } else if (install.verified === null) {
    throw new ApiError('unverified');
  }

  return { app: claims.app, room: otherApps.reduce((room, other) => room - other.bytes, install.quota) };
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
