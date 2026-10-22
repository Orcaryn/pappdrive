import { API_PREFIX } from '@pappdrive/protocol';
import { createApp, listApps } from './account/apps';
import { changePassword, login, logout, passwordParams, recover, refresh, signup } from './account/auth';
import { deleteAccount, deleteApp } from './account/deletion';
import { sendVerificationEmail, verifyEmail } from './account/verify';
import type { Env } from './shared/env';
import { ApiError, errorResponse, json, noContent } from './shared/http';
import { getBlob, putBlob } from './storage/blobs';
import { commitCheckpoint, commitDelta, getDelta, getIndex, watchFolder } from './storage/folder';

export { FolderQueue } from './folder-queue/index';

type Handler = (env: Env, request: Request, url: URL) => Promise<Response>;

const ROUTES: Record<string, Handler> = {
  'POST /auth/params': passwordParams,
  'POST /auth/signup': signup,
  'POST /auth/login': login,
  'POST /auth/recover': recover,
  'POST /auth/refresh': refresh,
  'POST /auth/password': changePassword,
  'POST /auth/logout': logout,
  'POST /auth/verify': verifyEmail,
  'POST /auth/verify/send': sendVerificationEmail,
  'GET /apps': listApps,
  'POST /apps': createApp,
  'PUT /blobs/*': putBlob,
  'GET /blobs/*': getBlob,
  'GET /delta': getDelta,
  'PUT /delta': commitDelta,
  'GET /index/*': getIndex,
  'GET /index/watch': watchFolder,
  'PUT /index': commitCheckpoint,
  'POST /app/delete': deleteApp,
  'POST /account/delete': deleteAccount,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return noContent();
    }

    const url = new URL(request.url);
    const path = url.pathname.startsWith(API_PREFIX + '/') ? url.pathname.slice(API_PREFIX.length) : '';
    const exact = `${request.method} ${path}`;
    const handler = ROUTES[exact in ROUTES ? exact : `${request.method} ${path.slice(0, path.indexOf('/', 1) + 1)}*`];

    if (!handler) {
      return json({ error: 'no-route' }, 404);
    }

    try {
      return await handler(env, request, url);
    } catch (e) {
      if (e instanceof ApiError) {
        return errorResponse(e);
      }

      console.error(e);

      return json({ error: 'server-error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
