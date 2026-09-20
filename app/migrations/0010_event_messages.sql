-- 活动内成员交流独立于活动状态文档，避免并发留言争用活动版本。
CREATE TABLE event_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  deleted_by TEXT,
  UNIQUE(event_id,author_id,idempotency_key)
);
CREATE INDEX event_messages_page ON event_messages(event_id,created_at DESC,id DESC);
