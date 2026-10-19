import { WATCH_PROTOCOL } from '@pappdrive/protocol';
import { decodeJwt } from './http.js';

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 60_000;
const REOPEN_BEFORE_EXPIRY_MS = 30_000;

export function watchIndex(url: string, freshToken: () => Promise<string>, onChange: () => void): () => void {
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  let retryMs = RETRY_MIN_MS;
  let stopped = false;

  connect();

  function connect(): void {
    void freshToken().then(open, retryLater);
  }

  function open(token: string): void {
    if (stopped) {
      return;
    }

    const ws = new WebSocket(url, [WATCH_PROTOCOL, token]);
    socket = ws;
    ws.onopen = () => {
      retryMs = RETRY_MIN_MS;
      schedule(() => ws.close(), decodeJwt(token).exp * 1000 - REOPEN_BEFORE_EXPIRY_MS - Date.now());
    };

    ws.onmessage = onChange;
    ws.onclose = () => {
      socket = null;
      retryLater();
    };
  }

  function retryLater(): void {
    if (stopped) {
      return;
    }

    schedule(connect, retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  }

  function schedule(fn: () => void, ms: number): void {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
    (timer as { unref?: () => void }).unref?.();
  }

  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}
