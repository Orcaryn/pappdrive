import { sha256Hex } from '../shared/bytes';
import type { Env } from '../shared/env';
import { ApiError } from '../shared/http';

export interface UserRow {
  id: string;
  login_hash: string;
  recovery_hash: string;
  m: number;
  t: number;
  p: number;
}

export function userByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
}

export async function rateLimit(env: Env, request: Request, email: string): Promise<void> {
  const results = await Promise.all([env.RL_IP.limit({ key: `ip:${request.headers.get('CF-Connecting-IP')}` }), env.RL_EMAIL.limit({ key: `email:${email}` })]);

  if (results.some(r => !r.success)) {
    throw new ApiError('rate-limited');
  }
}

const ZERO_KEY_HASH = '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925';

export async function checkCredentials(env: Env, email: string, key: Uint8Array, hashColumn: 'login_hash' | 'recovery_hash'): Promise<UserRow> {
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
