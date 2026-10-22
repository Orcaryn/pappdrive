import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { bearer } from '../shared/access';
import type { Env } from '../shared/env';
import { ApiError, noContent } from '../shared/http';
import { users } from '../shared/schema';
import * as v from '../shared/validate';
import { rateLimit } from './credentials';

const CODE_WINDOW_MS = 3600_000;
const encoder = new TextEncoder();

export async function sendCode(env: Env, user: string, email: string): Promise<void> {
  const code = await codeFor(env, user, Math.floor(Date.now() / CODE_WINDOW_MS));
  await env.EMAIL.send({
    from: { email: 'noreply@pappdrive.com', name: 'Pappdrive' },
    to: email,
    subject: `Your Pappdrive code: ${code}`,
    text: `Your Pappdrive code is ${code}\n\nType it where you signed up. It works for an hour.\nIf you did not sign up for Pappdrive, ignore this email.\n`,
  });
}

export async function verifyEmail(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  const typed = v.text(v.obj(await v.body(request)).code).trim();
  const user = await emailRow(env, claims.sub);
  await rateLimit(env, request, user.email);
  const window = Math.floor(Date.now() / CODE_WINDOW_MS);
  const valid = await Promise.all([codeFor(env, claims.sub, window), codeFor(env, claims.sub, window - 1)]);

  if (!valid.includes(typed)) {
    throw new ApiError('credentials');
  }

  await drizzle(env.DB)
    .update(users)
    .set({ verified: Date.now() })
    .where(and(eq(users.id, claims.sub), isNull(users.verified)));

  return noContent();
}

export async function sendVerificationEmail(env: Env, request: Request): Promise<Response> {
  const claims = await bearer(env, request);
  const user = await emailRow(env, claims.sub);
  await rateLimit(env, request, user.email);

  if (user.verified === null) {
    await sendCode(env, claims.sub, user.email);
  }

  return noContent();
}

async function emailRow(env: Env, user: string) {
  const row = await drizzle(env.DB).select({ email: users.email, verified: users.verified }).from(users).where(eq(users.id, user)).get();

  if (!row) {
    throw new ApiError('gone', { reason: 'account' });
  }

  return row;
}

async function codeFor(env: Env, user: string, window: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.TOKEN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new DataView(await crypto.subtle.sign('HMAC', key, encoder.encode(`verify:${user}:${window}`)));

  return String(mac.getUint32(0) % 1_000_000).padStart(6, '0');
}
