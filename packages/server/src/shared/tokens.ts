import type { AccessClaims } from '@pappdrive/protocol';
import { fromBase64, toBase64Url } from './bytes';

export const ACCESS_TOKEN_SECONDS = 3600;
const encoder = new TextEncoder();
const HEADER = toBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

export async function signToken(claims: Omit<AccessClaims, 'exp'>, secret: string, nowMs = Date.now()): Promise<string> {
  const full: AccessClaims = { ...claims, exp: Math.floor(nowMs / 1000) + ACCESS_TOKEN_SECONDS };
  const input = `${HEADER}.${toBase64Url(encoder.encode(JSON.stringify(full)))}`;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(input));

  return `${input}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifyToken(token: string, secrets: (string | undefined)[], nowMs = Date.now()): Promise<AccessClaims | null> {
  const parts = token.split('.');

  if (parts.length !== 3) {
    return null;
  }

  const [header, payload, signature] = parts as [string, string, string];
  const sig = fromBase64(signature);
  const claimBytes = fromBase64(payload);

  if (!sig || !claimBytes) {
    return null;
  }

  const input = encoder.encode(`${header}.${payload}`);

  for (const secret of secrets) {
    if (!secret || !(await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, input))) {
      continue;
    }

    const claims = JSON.parse(new TextDecoder().decode(claimBytes)) as AccessClaims;

    return claims.exp * 1000 > nowMs ? claims : null;
  }

  return null;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
