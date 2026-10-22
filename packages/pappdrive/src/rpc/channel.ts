import { SyncError } from '../shared/errors.js';
import { RpcError } from './errors.js';
import type { Message, MethodMap, Transport } from './types.js';

export type Handlers<In extends MethodMap> = { [M in keyof In]: (params: In[M]['params']) => Promise<In[M]['result']> | In[M]['result'] };

export interface Channel<Out extends MethodMap, In extends MethodMap> {
  request<M extends keyof Out & string>(method: M, params: Out[M]['params']): Promise<Out[M]['result']>;
  notify<M extends keyof Out & string>(method: M, params: Out[M]['params']): void;
  on(handlers: Partial<Handlers<In>>): void;
}

type Handler = (params: unknown) => Promise<unknown> | unknown;
type Pending = { resolve: (value: unknown) => void; reject: (error: RpcError) => void };

export function createChannel<Out extends MethodMap, In extends MethodMap>(transport: Transport): Channel<Out, In> {
  const handlers = new Map<string, Handler>();
  const pending = new Map<number, Pending>();
  let nextId = 1;
  const send = (msg: Message) => transport.send(JSON.stringify(msg));

  transport.onMessage(text => {
    const msg = JSON.parse(text) as Message;

    if ('method' in msg) {
      const { id, method, params } = msg;
      const handler = handlers.get(method);

      if (id === undefined) {
        handler?.(params);

        return;
      }

      void Promise.resolve()
        .then(() => {
          if (!handler) {
            throw new RpcError({ code: 'bad-request', message: `bad-request: Unknown method "${method}".` });
          }

          return handler(params);
        })
        .then(
          // JSON.stringify drops undefined; the envelope says null.
          value => send({ id, ok: true, value: value === undefined ? null : value }),
          (e: unknown) =>
            send({
              id,
              ok: false,
              error:
                e instanceof SyncError || e instanceof RpcError ?
                  { code: e.code, message: e.message, retryAfter: e.retryAfter, reason: e.reason }
                : { code: 'internal', message: String(e) },
            })
        );

      return;
    }

    const waiting = pending.get(msg.id);

    if (!waiting) {
      return;
    }

    pending.delete(msg.id);

    if (msg.ok) {
      waiting.resolve(msg.value);
    } else {
      waiting.reject(new RpcError(msg.error));
    }
  });

  return {
    request(method, params) {
      const id = nextId++;

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ id, method, params });
      });
    },
    notify(method, params) {
      send({ method, params });
    },
    on(incoming) {
      for (const [method, handler] of Object.entries(incoming) as [string, Handler][]) {
        handlers.set(method, handler);
      }
    },
  };
}
