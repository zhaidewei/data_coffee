-- 旧通知无法可靠重建类型或期限，保留原内容及发送状态，采用最高优先且独立发送。
ALTER TABLE outbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy_unknown';
ALTER TABLE outbox ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK (priority IN (0,1,2));
ALTER TABLE outbox ADD COLUMN deliver_before INTEGER CHECK (deliver_before IS NULL OR deliver_before > 0);
CREATE INDEX outbox_notice_order ON outbox(priority,deliver_before,created_at,id) WHERE digest_id IS NULL;
