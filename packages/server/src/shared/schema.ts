import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const plans = sqliteTable('plans', {
  id: text().primaryKey(),
  quotaBytes: integer('quota_bytes').notNull(), // sum of every app's folder
});

export const users = sqliteTable('users', {
  id: text().primaryKey(), // UUIDv7, also the R2 prefix
  email: text().notNull().unique(), // trimmed and lowercased
  loginHash: text('login_hash').notNull(), // SHA-256 hex of the login key bytes
  recoveryHash: text('recovery_hash').notNull(), // SHA-256 hex of the recovery login key bytes
  m: integer().notNull(), // Argon2id memory, KiB
  t: integer().notNull(), // Argon2id passes
  p: integer().notNull(), // Argon2id lanes
  plan: text()
    .notNull()
    .default('free')
    .references(() => plans.id),
  verified: integer(), // ms since epoch the email was confirmed; NULL until then
  created: integer().notNull(), // ms since epoch
});

export const apps = sqliteTable(
  'apps',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    bytes: integer().notNull().default(0), // the folder's size after its last commit
    created: integer().notNull(),
  },
  t => [primaryKey({ columns: [t.userId, t.name] })]
);

// One row per installed copy. Kept after a deletion (stopped set), so a
// refresh can answer 410 gone with the reason. refreshHash is NULL after
// sign-out, so a refresh answers 401 credentials.
export const installs = sqliteTable(
  'installs',
  {
    id: text().primaryKey(), // install id, UUIDv7
    userId: text('user_id').notNull(),
    app: text().notNull().default(''), // '' for a token without an app
    refreshHash: text('refresh_hash').unique(), // SHA-256 hex of the refresh token
    read: text({ mode: 'json' }).$type<string[]>().notNull(), // app names
    stopped: text({ enum: ['app', 'account'] }),
    created: integer().notNull(),
  },
  t => [index('installs_user_app').on(t.userId, t.app)]
);
