-- 发起人每场最多发送 5 次站内邮件；幂等键防止重复点击重复投递。
CREATE TABLE organizer_mail_campaigns (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
  subject TEXT NOT NULL,
  recipient_count INTEGER NOT NULL CHECK (recipient_count BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL,
  UNIQUE(event_id,idempotency_key),
  UNIQUE(event_id,ordinal)
);
CREATE INDEX organizer_mail_event ON organizer_mail_campaigns(event_id,created_at);
