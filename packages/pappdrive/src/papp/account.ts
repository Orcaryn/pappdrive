import type { LoginRequest, LoginResponse, ParamsResponse, RecoverRequest, RecoverResponse, SignupRequest } from '@pappdrive/protocol';
import { toBase64 } from '../shared/bytes.js';
import { deriveFromPassword, deriveFromRecovery, lockDataKey, randomBytes, unlockDataKey } from '../shared/crypto.js';
import { formatRecoveryCode } from '../shared/recovery-code.js';
import { request } from './http.js';

export interface Scope {
  app?: string;
  read: string[];
}

export async function prepareSignUp(server: string, email: string, password: string, scope: Scope): Promise<{ signup: SignupRequest; dataKey: Uint8Array; recoveryCode: string }> {
  const pk = await passwordKeys(server, email, password);
  const dataKey = randomBytes(32);
  const code = randomBytes(16);
  const rk = await deriveFromRecovery(code);
  const signup: SignupRequest = {
    email,
    ...scope,
    loginKey: toBase64(pk.loginKey),
    recoveryLoginKey: toBase64(rk.recoveryLoginKey),
    passwordCopy: await lockDataKey(dataKey, pk.passwordKey),
    recoveryCopy: await lockDataKey(dataKey, rk.recoveryKey),
  };

  return { signup, dataKey, recoveryCode: formatRecoveryCode(code) };
}

export async function logInWithPassword(server: string, email: string, password: string, scope: Scope): Promise<LoginResponse & { dataKey: Uint8Array }> {
  const pk = await passwordKeys(server, email, password);
  const login: LoginRequest = { email, ...scope, loginKey: toBase64(pk.loginKey) };
  const res = await request<LoginResponse>(server, 'POST', '/auth/login', login);

  return { ...res, dataKey: await unlockDataKey(res.passwordCopy, pk.passwordKey) };
}

export async function logInWithRecoveryCode(server: string, email: string, code: Uint8Array, scope: Scope): Promise<RecoverResponse & { dataKey: Uint8Array }> {
  const rk = await deriveFromRecovery(code);
  const recover: RecoverRequest = { email, ...scope, recoveryLoginKey: toBase64(rk.recoveryLoginKey) };
  const res = await request<RecoverResponse>(server, 'POST', '/auth/recover', recover);

  return { ...res, dataKey: await unlockDataKey(res.recoveryCopy, rk.recoveryKey) };
}

export async function deleteAppWithPassword(server: string, email: string, password: string, app: string): Promise<void> {
  await request<void>(server, 'POST', '/app/delete', { email, app, loginKey: toBase64((await passwordKeys(server, email, password)).loginKey) });
}

export async function deleteAccountWithPassword(server: string, email: string, password: string): Promise<void> {
  await request<void>(server, 'POST', '/account/delete', { email, loginKey: toBase64((await passwordKeys(server, email, password)).loginKey) });
}

async function passwordKeys(server: string, email: string, password: string) {
  return deriveFromPassword(email, password, await request<ParamsResponse>(server, 'POST', '/auth/params', { email }));
}
