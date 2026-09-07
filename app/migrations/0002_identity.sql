CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nickname TEXT NOT NULL,
  public_nickname INTEGER NOT NULL DEFAULT 0 CHECK(public_nickname IN (0,1))
);
CREATE TABLE IF NOT EXISTS auth_codes (
  email_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_daily_budget (
  day TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0
);
-- Stable provider idempotency identity survives an outbox lease/crash/retry.
CREATE TABLE IF NOT EXISTS mail_dispatch (
  outbox_id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE,
  first_attempt INTEGER NOT NULL
);
