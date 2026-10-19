import { describe, expect, it } from 'vitest';
import { WATCH_PROTOCOL } from '@pappdrive/protocol';
import { watchBearer } from '../src/shared/access';
import type { Env } from '../src/shared/env';
import type { ApiError } from '../src/shared/http';
import { signToken } from '../src/shared/tokens';

const env = { TOKEN_KEY: 'k1' } as Env;
const claims = { sub: 'u1', app: 'notes', install: 'i1', read: [] };
const upgrade = (protocols: string) => new Request('https://x/v1/index/watch', { headers: { 'Sec-WebSocket-Protocol': protocols } });

describe('watchBearer (token in the subprotocol list)', () => {
  it('reads the token offered after the protocol name', async () => {
    const token = await signToken(claims, 'k1');
    expect((await watchBearer(env, upgrade(`${WATCH_PROTOCOL}, ${token}`))).sub).toBe('u1');
  });

  it('answers expired without the protocol name, without a token, or with a bad one', async () => {
    const token = await signToken(claims, 'k1');

    for (const header of [token, `other, ${token}`, WATCH_PROTOCOL, `${WATCH_PROTOCOL}, ${await signToken(claims, 'wrong')}`]) {
      await expect(watchBearer(env, upgrade(header))).rejects.toMatchObject({ word: 'expired' } satisfies Partial<ApiError>);
    }

    await expect(watchBearer(env, new Request('https://x/v1/index/watch'))).rejects.toMatchObject({ word: 'expired' });
  });
});
