import type { RpcErrorBody, RpcErrorCode } from './types.js';

export class RpcError extends Error {
  readonly code: RpcErrorCode;
  readonly retryAfter?: number;
  readonly reason?: RpcErrorBody['reason'];

  constructor(body: RpcErrorBody) {
    super(body.message);
    this.name = 'RpcError';
    this.code = body.code;
    this.retryAfter = body.retryAfter;
    this.reason = body.reason;
  }
}
