import { describe, expect, it } from 'vitest';
import { DEFAULT_ARGON2 } from '@pappdrive/protocol';
import { ApiError } from '../src/shared/http';
import * as v from '../src/shared/validate';

function word(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) {
      return e.word;
    }

    throw e;
  }

  return 'ok';
}

describe('argon2Params', () => {
  it('refuses anything weaker than the defaults', () => {
    for (const k of ['m', 't', 'p'] as const) {
      expect(word(() => v.argon2Params({ ...DEFAULT_ARGON2, [k]: DEFAULT_ARGON2[k] - 1 }))).toBe('bad-request');
    }

    expect(word(() => v.argon2Params({ m: DEFAULT_ARGON2.m }))).toBe('bad-request');
  });
});
