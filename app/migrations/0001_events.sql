CREATE TABLE IF NOT EXISTS activities (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL,
 commit_id TEXT NOT NULL, next_due INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS activities_due ON activities(next_due);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 action TEXT NOT NULL, version INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_event ON audit(event_id,created_at);
CREATE TABLE IF NOT EXISTS outbox (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0, claimed_until INTEGER NOT NULL DEFAULT 0,
 last_error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status,next_attempt);
CREATE TABLE IF NOT EXISTS ai_proposals (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_id TEXT NOT NULL,
 action TEXT NOT NULL, version INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_proposals_expiry ON ai_proposals(expires_at);
CREATE TABLE IF NOT EXISTS ai_limits (user_id TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL);
