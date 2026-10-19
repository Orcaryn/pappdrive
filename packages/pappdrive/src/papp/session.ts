import type { TokenResponse } from '@pappdrive/protocol';
import { toBase64 } from '../shared/bytes.js';
import { SyncError } from '../shared/errors.js';
import type { KeyStore } from '../shared/types.js';
import type { Platform } from '../shared/platform.js';
import type { Api } from './api.js';
import { signedOut } from './errors.js';
import { decodeJwt } from './http.js';

interface StoredSession {
  email: string;
  userId: string;
  refreshToken: string;
  dataKey: string;
  recoveryCode: string | null;
}

export function createSession(keyStore: KeyStore, keyName: string, api: Api, platform: Platform) {
  let current: StoredSession | null = null;

  async function restore(): Promise<void> {
    const raw = await keyStore.get(keyName);

    if (!raw) {
      return;
    }

    current = JSON.parse(raw) as StoredSession;
    api.setSession(current.refreshToken, null);
  }

  async function save(email: string, res: TokenResponse, dataKey: Uint8Array, recoveryCode: string | null): Promise<void> {
    const saved: StoredSession = { email, userId: decodeJwt(res.accessToken).sub, refreshToken: res.refreshToken, dataKey: toBase64(dataKey), recoveryCode };
    await keyStore.set(keyName, JSON.stringify(saved));
    current = saved;
    api.setSession(res.refreshToken, res.accessToken);
    await platform.persist?.();
  }

  async function confirmRecoveryCode(): Promise<void> {
    if (!current) {
      throw signedOut();
    }

    const confirmed: StoredSession = { ...current, recoveryCode: null };
    await keyStore.set(keyName, JSON.stringify(confirmed));
    current = confirmed;
  }

  function confirmed(): StoredSession {
    if (!current) {
      throw signedOut();
    } else if (current.recoveryCode !== null) {
      throw new SyncError(
        'signed-out',
        'The recovery code is not confirmed yet. Show the code from papp.pendingSignUp() and call papp.confirmRecoveryCode() once the user saved it.'
      );
    }

    return current;
  }

  async function clear(): Promise<void> {
    current = null;
    api.clear();
    await keyStore.delete(keyName);
  }

  return {
    get current() {
      return current;
    },
    restore,
    save,
    confirmRecoveryCode,
    confirmed,
    clear,
  };
}
