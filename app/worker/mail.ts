import type { Env } from './types';

class MailError extends Error {
  constructor(public readonly code: string, public readonly retryable = false) { super(code); }
}
function configured(env: Env): void {
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM || !/^[^\s@<>]+@zhaidewei\.com$/i.test(env.EMAIL_FROM)) throw new MailError('mail_not_configured');
}
async function reserveBudget(env: Env, priority: boolean): Promise<boolean> {
  const parsed = Number(env.MAIL_DAILY_LIMIT || 300);
  const ceiling = Number.isFinite(parsed) ? Math.max(0, Math.min(300, Math.floor(parsed))) : 300;
  const maximum = priority ? ceiling : Math.max(0, ceiling - Math.min(50, Math.ceil(ceiling / 6)));
  if (maximum === 0) return false;
  const day = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(`INSERT INTO mail_daily_budget(day,used) VALUES (?,1)
    ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<? RETURNING used`).bind(day, maximum).first();
  // Failed/uncertain API attempts retain their reservation to stay below the cap.
  return !!row;
}
async function deliver(env: Env, to: string, subject: string, text: string, key: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'api-key': env.BREVO_API_KEY! },
      body: JSON.stringify({ sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME || 'Data Coffee' },
        to: [{ email: to }], subject, textContent: text, headers: { idempotencyKey: key } }),
    });
    if (response.ok) return;
    // Only inspect the structured code; never retain provider text containing PII.
    const detail = await response.json().catch(() => ({})) as { code?: string };
    if (detail.code === 'duplicate_parameter') return;
    throw new MailError(`provider_http_${response.status}`, response.status === 429 || response.status >= 500);
  } catch (error) {
    if (error instanceof MailError) throw error;
    throw new MailError('provider_result_uncertain', true);
  } finally { clearTimeout(timeout); }
}
/** Direct authentication mail; notification mail must use the durable outbox. */
export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  configured(env);
  if (!await reserveBudget(env, true)) throw new MailError('daily_budget_exhausted', true);
  await deliver(env, to, subject, text, crypto.randomUUID());
}
interface MailRow { id: string; user_id: string; subject: string; body: string; attempts: number; claimed_until: number }
const NEVER = 8640000000000000;
/** Claims prevent concurrent sends. Provider keys protect retries after a crash.
 * Brevo deduplicates for 30 minutes; after 25 minutes an unresolved dispatch is
 * terminally failed for operator review, since delivery cannot then be proven.
 * status=sent means provider accepted, not confirmed recipient delivery.
 */
export async function drainMail(env: Env, limit = 10): Promise<void> {
  const count = Math.max(0, Math.min(50, Math.floor(Number.isFinite(limit) ? limit : 10)));
  for (let index = 0; index < count; index++) {
    const now = Date.now(), lease = now + 120_000;
    const row = await env.DB.prepare(`UPDATE outbox SET status='sending',claimed_until=?,attempts=attempts+1
      WHERE id=(SELECT id FROM outbox WHERE
        ((status IN ('pending','failed') AND next_attempt<=? AND attempts<5)
          OR (status='sending' AND claimed_until<=?))
        ORDER BY created_at,id LIMIT 1)
      RETURNING id,user_id,subject,body,attempts,claimed_until`).bind(lease, now, now).first<MailRow>();
    if (!row) break;
    const finish = async (status: string, error: string | null, next: number, decrement = false) => {
      await env.DB.prepare(`UPDATE outbox SET status=?,last_error=?,next_attempt=?,claimed_until=0,
        attempts=attempts-?,sent_at=? WHERE id=? AND status='sending' AND attempts=? AND claimed_until=?`)
        .bind(status, error, next, +decrement, status === 'sent' ? Date.now() : null, row.id, row.attempts, lease).run();
    };
    try {
      configured(env);
      const recipient = await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(row.user_id).first<{ email: string }>();
      if (!recipient) throw new MailError('recipient_missing');
      const prior = await env.DB.prepare('SELECT provider_key,first_attempt FROM mail_dispatch WHERE outbox_id=?').bind(row.id).first<{ provider_key: string; first_attempt: number }>();
      if (prior && now - prior.first_attempt >= 25 * 60_000) throw new MailError('delivery_uncertain_manual_review');
      if (row.attempts > 5) throw new MailError('retry_limit_manual_review');
      if (!await reserveBudget(env, false)) {
        const tomorrow = Math.floor(now / 86400000) * 86400000 + 86400000;
        await finish('pending', 'daily_budget_exhausted', tomorrow, true);
        return;
      }
      // Persist before external side effect, so a worker crash preserves the key.
      const dispatch = prior || await env.DB.prepare(`INSERT INTO mail_dispatch(outbox_id,provider_key,first_attempt) VALUES (?,?,?)
        ON CONFLICT(outbox_id) DO UPDATE SET outbox_id=excluded.outbox_id RETURNING provider_key,first_attempt`)
        .bind(row.id, crypto.randomUUID(), now).first<{ provider_key: string; first_attempt: number }>();
      if (!dispatch) throw new MailError('dispatch_missing');
      await deliver(env, recipient.email, row.subject, row.body, dispatch.provider_key);
      await finish('sent', null, 0);
    } catch (error) {
      const known = error instanceof MailError ? error : new MailError('internal_mail_error', true);
      const retry = known.retryable && row.attempts < 5;
      await finish('failed', known.code, retry ? now + Math.min(600_000, 30_000 * 2 ** (row.attempts - 1)) : NEVER);
    }
  }
  // Bounded cleanup carries no PII into logs and keeps auth auxiliary tables small.
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(now),
    env.DB.prepare('DELETE FROM auth_codes WHERE expires_at<?').bind(now - 86400000),
    env.DB.prepare('DELETE FROM auth_rate_limits WHERE window_start<?').bind(now - 86400000),
    env.DB.prepare('DELETE FROM mail_daily_budget WHERE day<?').bind(new Date(now - 7 * 86400000).toISOString().slice(0, 10)),
  ]);
}
