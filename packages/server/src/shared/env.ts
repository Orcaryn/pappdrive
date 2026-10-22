import type { FolderQueue } from '../folder-queue/index';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  FOLDER: DurableObjectNamespace<FolderQueue>;
  RL_EMAIL: RateLimit;
  RL_IP: RateLimit;
  RL_UPLOAD: RateLimit;
  EMAIL: SendEmail;
  TOKEN_KEY: string;
  TOKEN_KEY_OLD?: string;
}
