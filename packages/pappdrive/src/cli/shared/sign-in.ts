import { MIN_PASSWORD_LENGTH, normalizeEmail, type RefreshResponse } from '@pappdrive/protocol';
import { logInWithPassword } from '../../papp/account.js';
import { hashWasmArgon2 } from '../../shared/argon2.js';
import { ApiError, request } from '../../papp/http.js';
import { type Ctx, remember } from './context.js';
import { describeError } from './errors.js';

export async function askEmail(ctx: Ctx): Promise<string> {
  if (ctx.flags.email) {
    return normalizeEmail(ctx.flags.email);
  }

  const last = ctx.config.email;

  for (;;) {
    const typed = await ctx.prompter.ask(last ? `Email [${last}]: ` : 'Email: ');
    const email = typed === '' && last !== undefined ? last : typed;

    if (/^[^\s@]+@[^\s@]+$/.test(email)) {
      return normalizeEmail(email);
    }

    ctx.out('That does not look like an email address. Type it like name@example.com.');
  }
}

export async function askNewPassword(ctx: Ctx): Promise<string> {
  for (;;) {
    const pw = await ctx.prompter.askHidden(`Password (at least ${MIN_PASSWORD_LENGTH} characters): `);
    const length = [...pw].length;

    if (length < MIN_PASSWORD_LENGTH) {
      ctx.out(`That is ${length} characters. Use at least ${MIN_PASSWORD_LENGTH}; a short sentence works well.`);
      continue;
    }

    const again = await ctx.prompter.askHidden('Type it again: ');

    if (again === pw) {
      return pw;
    }

    ctx.out('The two passwords differ. Try again.');
  }
}

export async function withPassword<T>(ctx: Ctx, step: (password: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const password = await ctx.prompter.askHidden('Password: ');
    ctx.status('Checking the password...');
    try {
      return await step(password);
    } catch (e) {
      if (!(e instanceof ApiError && e.error === 'credentials' && attempt < 3)) {
        throw e;
      }

      ctx.out(describeError(e, ctx.server));
    } finally {
      ctx.status('');
    }
  }
}

export async function signIn(ctx: Ctx): Promise<string> {
  const email = await askEmail(ctx);
  const res = await withPassword(ctx, pw => logInWithPassword(ctx.server, hashWasmArgon2, email, pw, { read: [] }));
  await ctx.keyStore.set(ctx.sessionName, res.refreshToken);
  await remember(ctx, email);

  return res.accessToken;
}

export async function accessToken(ctx: Ctx): Promise<string> {
  const refreshToken = await ctx.keyStore.get(ctx.sessionName);

  if (!refreshToken) {
    ctx.out(`You are not signed in to ${ctx.server}. Sign in:`);

    return signIn(ctx);
  }

  try {
    return (await request<RefreshResponse>(ctx.server, 'POST', '/auth/refresh', { refreshToken })).accessToken;
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 401 || e.status === 410))) {
      throw e;
    }

    await ctx.keyStore.delete(ctx.sessionName);

    if (e.status === 410) {
      throw e;
    }

    ctx.out('The saved sign-in no longer works. Sign in again.');

    return signIn(ctx);
  }
}
