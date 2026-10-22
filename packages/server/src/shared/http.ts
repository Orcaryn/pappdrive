import type { ErrorBody, ErrorWord } from '@pappdrive/protocol';

export class ApiError extends Error {
  constructor(
    readonly word: ErrorWord,
    readonly details: Omit<ErrorBody, 'error'> = {}
  ) {
    super(word);
  }
}

const ERROR_STATUS: Record<ErrorWord, number> = {
  'bad-request': 400,
  credentials: 401,
  expired: 401,
  'not-allowed': 403,
  unverified: 403,
  'no-app': 404,
  exists: 409,
  gone: 410,
  stale: 412,
  'too-big': 413,
  missing: 422,
  'rate-limited': 429,
  'over-quota': 507,
};
// the rate limit periods in wrangler.jsonc are 60 seconds.
const RETRY_AFTER_SECONDS = '60';
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-None-Match',
  'Access-Control-Expose-Headers': 'Retry-After, ETag',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS } });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function errorResponse(err: ApiError): Response {
  const res = json({ error: err.word, ...err.details }, ERROR_STATUS[err.word]);

  if (err.word === 'rate-limited') {
    res.headers.set('Retry-After', RETRY_AFTER_SECONDS);
  }

  return res;
}
