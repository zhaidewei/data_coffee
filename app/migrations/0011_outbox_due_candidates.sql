-- Only active candidates enter the minute mail-claim query; terminal history
-- stays in outbox with its original payload, dispatch identity and audit value.
CREATE INDEX outbox_pending_due ON outbox(status,next_attempt)
  WHERE digest_id IS NULL AND status IN ('pending','failed') AND attempts<5;
CREATE INDEX outbox_sending_due ON outbox(status,claimed_until)
  WHERE digest_id IS NULL AND status='sending';
