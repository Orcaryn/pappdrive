import {
  APP_NAME_RE,
  DEFAULT_ARGON2,
  type GoneReason,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  type PasswordRequest,
  type TokenResponse,
  type VerifyRequest,
} from '@pappdrive/protocol';
import { fromBase64, toBase64 } from '../shared/bytes.js';
import { deriveFromPassword, lockDataKey } from '../shared/crypto.js';
import { SyncError } from '../shared/errors.js';
import type { Platform } from '../shared/platform.js';
import { parseRecoveryCode } from '../shared/recovery-code.js';
import type { Files, KeyStore, Papp, PappOptions, PendingSignUp } from '../shared/types.js';
import { deleteAccountWithPassword, deleteAppWithPassword, logInWithPassword, logInWithRecoveryCode, prepareSignUp } from './account.js';
import { createApi } from './api.js';
import { serverError } from './errors.js';
import type { Folder } from './folder/types.js';
import { ApiError, request } from './http.js';
import { createOpenFolders } from './open-folders.js';
import { createSession } from './session.js';

export function createPappCore(opts: PappOptions & { server: string }, platform: Platform, keyStore: KeyStore): Papp {
  const { app } = opts;
  const server = opts.server.replace(/\/+$/, '');
  const read = opts.read ?? [];
  const bad = [app, ...read].find(n => !APP_NAME_RE.test(n));

  if (bad !== undefined) {
    throw new SyncError('no-app', `"${bad}" is not a valid app name. App names are lowercase letters, digits, - and _, 1 to 64 characters.`);
  }

  let own: Folder | null = null;
  const api = createApi(server, read, {
    onGone: async reason => {
      void folders.stopAll(f => f.markDeleted(reason).catch(f.stopFailed));
      await session.clear();
    },
    onSignedOut: async () => {
      own = null;
      void folders.stopAll(f => f.close().catch(f.stopFailed));
      await session.clear();
    },
  });
  const session = createSession(keyStore, `pappdrive:${server}:${app}`, api, platform);
  const folders = createOpenFolders(api, platform, opts.syncOnBackground);
  const ready = session.restore();

  async function signUp(email: string, password: string): Promise<{ recoveryCode: string }> {
    await ready;
    checkPassword(password);

    if (session.current) {
      await signOut();
    }

    const address = normalizeEmail(email);
    const { signup, dataKey, recoveryCode } = await onServer('/auth/signup', () => prepareSignUp(server, platform.argon2, address, password, { app, read }));
    const tokens = await onServer('/auth/signup', () => request<TokenResponse>(server, 'POST', '/auth/signup', signup));
    await session.save(address, tokens, dataKey, recoveryCode);

    return { recoveryCode };
  }

  async function pendingSignUp(): Promise<PendingSignUp | null> {
    await ready;
    const s = session.current;

    return s && s.recoveryCode !== null ? { email: s.email, recoveryCode: s.recoveryCode } : null;
  }

  async function confirmRecoveryCode(): Promise<void> {
    await ready;
    await session.confirmRecoveryCode();
  }

  async function verifyEmail(code: string): Promise<void> {
    await ready;
    await onServer('/auth/verify', () => api.authed(token => request<void>(server, 'POST', '/auth/verify', { code } satisfies VerifyRequest, token)));
  }

  async function sendVerificationEmail(): Promise<void> {
    await ready;
    await onServer('/auth/verify/send', () => api.authed(token => request<void>(server, 'POST', '/auth/verify/send', undefined, token)));
  }

  async function signIn(email: string, password: string): Promise<void> {
    await ready;

    if (session.current) {
      await signOut();
    }

    const address = normalizeEmail(email);
    const res = await onServer('/auth/login', () => logInWithPassword(server, platform.argon2, address, password, { app, read }));
    await session.save(address, res, res.dataKey, null);
  }

  async function recover(email: string, recoveryCode: string, newPassword: string): Promise<void> {
    await ready;
    checkPassword(newPassword);
    const code = parseRecoveryCode(recoveryCode);

    if (session.current) {
      await signOut();
    }

    const address = normalizeEmail(email);
    const res = await onServer('/auth/recover', () => logInWithRecoveryCode(server, address, code, { app, read }));
    await session.save(address, res, res.dataKey, null);
    await setPassword(newPassword);
  }

  async function setPassword(newPassword: string): Promise<void> {
    await ready;
    checkPassword(newPassword);
    const s = session.confirmed();
    const pk = await deriveFromPassword(platform.argon2, s.email, newPassword, DEFAULT_ARGON2);
    const req: PasswordRequest = { loginKey: toBase64(pk.loginKey), passwordCopy: await lockDataKey(fromBase64(s.dataKey), pk.passwordKey), params: DEFAULT_ARGON2 };
    await onServer('/auth/password', () => api.authed(token => request<void>(server, 'POST', '/auth/password', req, token)));
  }

  async function signOut(): Promise<void> {
    await ready;

    if (session.current) {
      await api
        .authed(token => request<void>(server, 'POST', '/auth/logout', undefined, token))
        .catch((e: unknown) =>
          console.warn(`pappdrive: signed out on this device, but the server was not told (${String(e)}). The sign-in stops working there once the account's password changes.`)
        );
    }

    own = null;
    await Promise.all([folders.stopAll(f => f.close()), session.clear()]);
  }

  async function deleteWith(password: string, reason: GoneReason): Promise<void> {
    await ready;
    const { email } = session.confirmed();

    if (reason === 'app') {
      await onServer('/app/delete', () => deleteAppWithPassword(server, platform.argon2, email, password, app));
    } else {
      await onServer('/account/delete', () => deleteAccountWithPassword(server, platform.argon2, email, password));
    }

    await Promise.all([folders.stopAll(f => f.markDeleted(reason)), session.clear()]);
  }

  async function close(): Promise<void> {
    own = null;
    await folders.stopAll(f => f.sync().finally(() => f.close()));
  }

  async function open(where: { mode: 'visible'; path: string } | { mode: 'private' }): Promise<Files> {
    await ready;
    const s = session.confirmed();
    own = await folders.open(s.dataKey, app, false, () => (where.mode === 'visible' ? platform.openVisible(where.path) : platform.openPrivate(s.userId, app)));

    return own;
  }

  async function openReadOnly(other: string): Promise<Files> {
    await ready;

    if (!read.includes(other)) {
      throw new SyncError(
        'not-allowed',
        `"${other}" is not in read. Add it to read in createPapp({ ..., read: [${[...read, other].map(n => `"${n}"`).join(', ')}] }). The next token refresh sends it, no new sign-in needed.`
      );
    }

    const s = session.confirmed();

    return folders.open(s.dataKey, other, true, () => platform.openPrivate(s.userId, app, other));
  }

  async function onServer<T>(path: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (e) {
      if (!(e instanceof ApiError)) {
        throw e;
      }

      throw serverError(e, { path, server, app, read });
    }
  }

  return {
    ready,
    get signedIn() {
      return session.current !== null && session.current.recoveryCode === null;
    },
    get files(): Files {
      if (!own) {
        throw new SyncError('signed-out', 'papp.files is ready only after open. Call await papp.open({ mode: "private" }) or await papp.open({ mode: "visible", path }) first.');
      }

      return own;
    },
    open,
    openReadOnly,
    signUp,
    pendingSignUp,
    confirmRecoveryCode,
    verifyEmail,
    sendVerificationEmail,
    signIn,
    recover,
    setPassword,
    signOut,
    deleteApp: password => deleteWith(password, 'app'),
    deleteAccount: password => deleteWith(password, 'account'),
    close,
  };
}

function checkPassword(password: string): void {
  if ([...password.normalize('NFC')].length < MIN_PASSWORD_LENGTH) {
    throw new SyncError('weak-password', `The password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters; a few random words work well.`);
  }
}
