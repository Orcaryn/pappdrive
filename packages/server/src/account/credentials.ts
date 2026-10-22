import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { sha256Hex } from '../shared/bytes';
import type { Env } from '../shared/env';
import { ApiError } from '../shared/http';
import { users } from '../shared/schema';

type UserRow = typeof users.$inferSelect;

export function userByEmail(env: Env, email: string): Promise<UserRow | undefined> {
  return drizzle(env.DB).select().from(users).where(eq(users.email, email)).get();
}

export async function rateLimit(env: Env, request: Request, email: string): Promise<void> {
  const results = await Promise.all([env.RL_IP.limit({ key: `ip:${request.headers.get('CF-Connecting-IP')}` }), env.RL_EMAIL.limit({ key: `email:${email}` })]);

  if (results.some(r => !r.success)) {
    throw new ApiError('rate-limited');
  }
}

const ZERO_KEY_HASH = '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925';

export async function checkCredentials(env: Env, email: string, key: Uint8Array, hashColumn: 'loginHash' | 'recoveryHash'): Promise<UserRow> {
  const user = await userByEmail(env, email);
  const hash = await sha256Hex(key);
  const expected = user ? user[hashColumn] : ZERO_KEY_HASH;
  let diff = 0;

  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  if (!user || diff !== 0) {
    throw new ApiError('credentials');
  }

  return user;
}
