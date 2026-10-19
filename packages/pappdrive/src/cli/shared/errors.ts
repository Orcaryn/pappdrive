import { ApiError } from '../../papp/http.js';
import { SyncError } from '../../shared/errors.js';
import type { Command } from './args.js';

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1
  ) {
    super(message);
  }
}

export function describeError(e: unknown, server: string, during?: Command | 'recover', app?: string): string {
  if (e instanceof ApiError) {
    switch (e.error) {
      case 'network':
        return `Could not reach ${server}. Check the address (--server) and the connection, then try again.`;
      case 'credentials':
        return during === 'recover' ?
            'Wrong email or recovery code. Check both against your saved copy and try again.'
          : 'Wrong email or password. Try again. If you forgot the password, `pappdrive export <app> <dir> --recovery` still works with the recovery code.';
      case 'expired':
        return 'Your sign-in on this computer has ended. Run `pappdrive login`, then the command again.';
      case 'rate-limited':
        return `Too many tries. Wait ${e.retryAfter ?? 60} seconds, then run the command again.`;
      case 'exists':
        return during === 'signup' ?
            'An account with this email already exists. Run `pappdrive login` instead.'
          : `You already have an app named "${app}". Pick another name, or use that app. See them with \`pappdrive apps list\`.`;
      case 'no-app':
        return `There is no app named "${app}" in this account. See your apps with \`pappdrive apps list\`, or create it with \`pappdrive apps create ${app}\`.`;
      case 'gone':
        return e.reason === 'account' ? 'This account was deleted. Create a new one with `pappdrive signup`.' : "The app's folder was deleted.";
      case 'not-allowed':
        return 'The server did not allow this with the current sign-in. Run `pappdrive login`, then the command again.';
      case 'bad-request':
        return during === 'apps create' ?
            'The server refused the app name. App names use lowercase letters, digits and -, 1 to 64 characters, like my-notes.'
          : 'The server refused the request as malformed. Update pappdrive, then try again.';
      default:
        return `The server answered ${e.status} ${e.error}. Try again in a minute; if it keeps happening, the server may be down.`;
    }
  }

  if (e instanceof SyncError) {
    return e.message.replace(/^[a-z-]+: /, '');
  } else if (e instanceof CliError) {
    return e.message;
  }

  return `Unexpected error: ${(e as Error).stack}`;
}
