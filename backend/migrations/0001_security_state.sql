CREATE TABLE IF NOT EXISTS notes_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt_hex TEXT NOT NULL,
  hash_hex TEXT NOT NULL,
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS active_sessions (
  token_digest TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS active_sessions_expiry ON active_sessions(expires_at);

CREATE TABLE IF NOT EXISTS invitations (
  token_digest TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumed_by TEXT
);
