import {digestEligibleSQL,noticeOrderSQL} from './notices';

/** Each branch can use a due-only partial index, excluding terminal history.
 * Selection and lease acquisition remain one atomic D1 statement.
 * Bind: now, now, lease, remaining statement budget.
 */
export const CLAIM_MAIL_SQL = `WITH candidates AS (
  SELECT id,kind,priority,deliver_before,created_at FROM outbox
    WHERE digest_id IS NULL AND status IN ('pending','failed') AND attempts<5 AND next_attempt<=?
  UNION ALL
  SELECT id,kind,priority,deliver_before,created_at FROM outbox
    WHERE digest_id IS NULL AND status='sending' AND claimed_until<=?
)
UPDATE outbox SET status='sending',claimed_until=?,attempts=attempts+1
  WHERE id=(SELECT id FROM candidates
    WHERE (? >= 12 OR (NOT (${digestEligibleSQL}) AND NOT EXISTS(SELECT 1 FROM outbox m WHERE m.digest_id=candidates.id)))
    ORDER BY ${noticeOrderSQL} LIMIT 1)
  RETURNING id,user_id,subject,body,attempts,claimed_until,kind,priority,deliver_before,
    EXISTS(SELECT 1 FROM outbox m WHERE m.digest_id=outbox.id) AS has_members`;
