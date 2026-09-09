-- Digest members remain durable and are never claimed independently.
ALTER TABLE outbox ADD COLUMN digest_id TEXT;
CREATE INDEX outbox_digest ON outbox(digest_id);
-- Freeze the complete provider request before any external side effect.
CREATE TABLE mail_payload (
  outbox_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
