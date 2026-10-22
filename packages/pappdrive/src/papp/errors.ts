import type { GoneReason } from '@pappdrive/protocol';
import { SyncError } from '../shared/errors.js';
import type { ApiError } from './http.js';

export function goneError(reason: GoneReason): SyncError {
  const what =
    reason === 'account' ?
      'The account was deleted. This device is signed out and its copy of the key is deleted.'
    : "This app's folder was deleted. This device is signed out of the app.";

  return new SyncError('gone', `${what} Sign up or sign in again to start a new, empty folder.`, { reason });
}

export function signedOut(detail = 'Not signed in.'): SyncError {
  return new SyncError('signed-out', `${detail} Sign in first: await papp.signIn(email, password), or the sign-in form.`);
}

export function serverError(e: ApiError, o: { path: string; server: string; app: string; read: string[] }): SyncError {
  switch (e.error) {
    case 'expired':
      return signedOut('The session expired and could not be renewed.');
    case 'network':
      return new SyncError('network', `Could not reach the server at ${o.server}. Check the connection and try again.`);
    case 'credentials':
      return new SyncError(
        'credentials',
        o.path === '/auth/recover' ? 'Wrong email or recovery code. Check both against the saved copy.'
        : o.path === '/auth/verify' ? 'Wrong or expired code. Check the latest email, or send a new code with papp.sendVerificationEmail().'
        : 'Wrong email or password. Try again, or use the recovery code to set a new password.'
      );
    case 'exists':
      return new SyncError('exists', 'An account with this email already exists. Sign in instead, or recover with the recovery code if the password is lost.');
    case 'no-app': {
      const readFolders = o.read.length ? ` or one of the read folders (${o.read.join(', ')})` : '';

      return new SyncError(
        'no-app',
        `The app "${o.app}"${readFolders} does not exist in this account. Create it first with the command-line tool: ` + `npx pappdrive apps create ${o.app}. Then sign in again.`
      );
    }

    case 'rate-limited': {
      const retryAfter = e.retryAfter as number;

      return new SyncError('rate-limited', `Too many tries. Wait ${retryAfter} seconds, then try again.`, { retryAfter });
    }

    case 'not-allowed':
      return new SyncError('not-allowed', 'The server refused this request for this token.');
    case 'unverified':
      return new SyncError(
        'unverified',
        'The email address is not confirmed yet, so nothing is uploaded. Enter the code from the sign-up email with papp.verifyEmail(code); papp.sendVerificationEmail() sends a new one.'
      );
    case 'over-quota':
      return new SyncError('over-quota', "The account's storage is full, so new files wait on this device. Delete files, or upgrade the plan at https://pappdrive.com.");
    default:
      return new SyncError('server', `The server answered ${e.status} ${e.error}. Try again later; if it persists, update pappdrive.`);
  }
}
