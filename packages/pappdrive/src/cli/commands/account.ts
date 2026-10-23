import { HOSTED_SERVER, type RefreshResponse, type TokenResponse, type VerifyRequest } from '@pappdrive/protocol';
import { prepareSignUp } from '../../papp/account.js';
import { hashWasmArgon2 } from '../../shared/argon2.js';
import { request } from '../../papp/http.js';
import { foldRecoveryCode } from '../../shared/recovery-code.js';
import { type Ctx, remember } from '../shared/context.js';
import { describeError } from '../shared/errors.js';
import { accessToken, askEmail, askNewPassword, signIn } from '../shared/sign-in.js';

export async function signup(ctx: Ctx): Promise<void> {
  const app = ctx.flags.app;
  ctx.out(`Creating an account on ${ctx.server}.`);
  const email = await askEmail(ctx);
  const password = await askNewPassword(ctx);
  ctx.status('Making the keys...');
  const { signup: req, recoveryCode } = await prepareSignUp(ctx.server, hashWasmArgon2, email, password, { app, read: [] });
  const lastGroup = recoveryCode.slice(recoveryCode.lastIndexOf('-') + 1);
  ctx.out('');
  ctx.out('Your recovery code:');
  ctx.out('');
  ctx.out(`    ${recoveryCode}`);
  ctx.out('');
  ctx.out('It is the only way back in if you forget your password and have no other signed-in device.');
  ctx.out("Nobody can reset the password for you, not even the server's operator.");
  ctx.out('Save it now, in a password manager or on paper. It is not shown again.');
  ctx.out('');

  while (foldRecoveryCode(await ctx.prompter.ask(`To confirm you saved it, type its last group (the ${lastGroup.length} characters after the last dash): `)) !== lastGroup) {
    ctx.out('That does not match. Look at the code above and type the characters after its last dash.');
  }

  ctx.out('Recovery code confirmed.');
  ctx.status('Creating the account...');
  const res = await request<TokenResponse>(ctx.server, 'POST', '/auth/signup', req).finally(() => ctx.status(''));

  await ctx.keyStore.set(ctx.sessionName, res.refreshToken);
  await remember(ctx, email);
  ctx.out('');
  ctx.out(`Account created for ${email}. This computer is signed in.`);
  await enterCode(ctx, res.accessToken);

  if (app !== undefined) {
    const start = ctx.server === HOSTED_SERVER ? `createPapp({ app: "${app}" })` : `createPapp({ server: "${ctx.server}", app: "${app}" })`;
    ctx.out(`The app "${app}" is created. In the app: ${start}, then sign in with this email and password.`);
  } else {
    ctx.out('Next: create an app with `pappdrive apps create <name>`.');
  }
}

export async function verify(ctx: Ctx): Promise<void> {
  const token = await accessToken(ctx);
  await request(ctx.server, 'POST', '/auth/verify/send', undefined, token);
  await enterCode(ctx, token);
}

export async function login(ctx: Ctx): Promise<void> {
  ctx.out(`Signing in to ${ctx.server}.`);
  await signIn(ctx);
  ctx.out('Signed in. Your sign-in is kept in the system keychain; the password is not stored.');
}

export async function logout(ctx: Ctx): Promise<void> {
  const refreshToken = await ctx.keyStore.get(ctx.sessionName);

  if (!refreshToken) {
    ctx.out(`You were not signed in to ${ctx.server}. Nothing to do.`);

    return;
  }

  try {
    const { accessToken } = await request<RefreshResponse>(ctx.server, 'POST', '/auth/refresh', { refreshToken });
    await request(ctx.server, 'POST', '/auth/logout', undefined, accessToken);
  } catch (e) {
    ctx.out(`The server was not told (${describeError(e, ctx.server)}). The sign-in is forgotten on this computer anyway.`);
  }

  await ctx.keyStore.delete(ctx.sessionName);
  ctx.out(`Signed out of ${ctx.server} on this computer.`);
}

async function enterCode(ctx: Ctx, token: string): Promise<void> {
  ctx.out('A 6-digit code is on its way to your email. Nothing syncs until the address is confirmed.');
  const code = await ctx.prompter.ask('Code from the email: ');
  await request(ctx.server, 'POST', '/auth/verify', { code } satisfies VerifyRequest, token);
  ctx.out('Email confirmed.');
}
