-- Pappdrive D1 schema. Three tables: users, apps, device tokens (installs).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,           -- random UUID, also the R2 prefix
  email         TEXT NOT NULL UNIQUE,       -- trimmed and lowercased
  login_hash    TEXT NOT NULL,              -- SHA-256 hex of the login key bytes
  recovery_hash TEXT NOT NULL,              -- SHA-256 hex of the recovery login key bytes
  m             INTEGER NOT NULL,           -- Argon2id memory, KiB
  t             INTEGER NOT NULL,           -- Argon2id passes
  p             INTEGER NOT NULL,           -- Argon2id lanes
  created       INTEGER NOT NULL            -- ms since epoch
);

CREATE TABLE apps (
  user_id TEXT NOT NULL,
  name    TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (user_id, name)
);

-- One row per installed copy. Kept after a deletion (stopped set), so a
-- refresh can answer 410 gone with the reason. refresh_hash is NULL after
-- sign-out, so a refresh answers 401 credentials.
CREATE TABLE installs (
  id           TEXT PRIMARY KEY,            -- install id, random UUID
  user_id      TEXT NOT NULL,
  app          TEXT NOT NULL DEFAULT '',    -- '' for a token without an app
  refresh_hash TEXT UNIQUE,                 -- SHA-256 hex of the refresh token
  read         TEXT NOT NULL DEFAULT '[]',  -- JSON array of app names
  stopped      TEXT CHECK (stopped IS NULL OR stopped IN ('app', 'account')),
  created      INTEGER NOT NULL
);

CREATE INDEX installs_user_app ON installs (user_id, app);
