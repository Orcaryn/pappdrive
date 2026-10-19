import { API_PREFIX, type AccessClaims, type ErrorBody, type GoneReason } from '@pappdrive/protocol';
import { fromBase64, fromUtf8 } from '../shared/bytes.js';
import { SyncError } from '../shared/errors.js';

export class ApiError extends Error {
  readonly status: number;
  readonly error: string;
  readonly missing?: string[];
  readonly reason?: GoneReason;
  readonly retryAfter?: number;

  constructor(status: number, error: string, extra: { missing?: string[]; reason?: GoneReason; retryAfter?: number } = {}) {
    super(`server answered ${status} ${error}`);
    this.name = 'ApiError';
    this.status = status;
    this.error = error;
    this.missing = extra.missing;
    this.reason = extra.reason;
    this.retryAfter = extra.retryAfter;
  }
}

export async function send(
  server: string,
  method: string,
  path: string,
  init: { body?: BodyInit; headers?: Record<string, string>; token?: string; accept?: number[] } = {}
): Promise<Response> {
  const headers = { ...init.headers };

  if (init.token !== undefined) {
    headers['authorization'] = `Bearer ${init.token}`;
  }

  const res = await fetch(server + API_PREFIX + path, { method, headers, body: init.body }).catch(() => {
    throw new ApiError(0, 'network');
  });

  if (!res.ok && !init.accept?.includes(res.status)) {
    throw await apiError(res);
  }

  return res;
}

async function apiError(res: Response): Promise<ApiError> {
  const err = (await res.json().catch(() => null)) as Partial<ErrorBody> | null;

  if (!err?.error) {
    return new ApiError(res.status, 'server');
  }

  const retryAfter = res.headers.get('retry-after');

  return new ApiError(res.status, err.error, { missing: err.missing, reason: err.reason, retryAfter: retryAfter === null ? undefined : Number(retryAfter) });
}

export async function request<T>(server: string, method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await send(server, method, path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    token,
  });

  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function decodeJwt(token: string): AccessClaims {
  const claims = token.split('.')[1];

  if (claims === undefined) {
    throw new SyncError('server', 'The server sent an access token that is not a JWT. Check the server address in createPapp.');
  }

  return JSON.parse(fromUtf8.decode(fromBase64(claims.replace(/-/g, '+').replace(/_/g, '/')))) as AccessClaims;
}
