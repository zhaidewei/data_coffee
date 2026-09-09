import {canDigestNotice,digestEligibleSQL,noticeOrderSQL} from './notices';
import type { Env } from './types';

class MailError extends Error {
  constructor(public readonly code: string, public readonly retryable = false) { super(code); }
}
function configured(env: Env): void {
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/i.test(env.EMAIL_FROM)) throw new MailError('mail_not_configured');
}
async function reserveBudget(env: Env, priority: boolean, prepare = (sql: string) => env.DB.prepare(sql)): Promise<boolean> {
  const parsed = Number(env.MAIL_DAILY_LIMIT || 300);
  const ceiling = Number.isFinite(parsed) ? Math.max(0, Math.min(300, Math.floor(parsed))) : 300;
  const maximum = priority ? ceiling : Math.max(0, ceiling - Math.min(50, Math.ceil(ceiling / 6)));
  if (maximum === 0) return false;
  const day = new Date().toISOString().slice(0, 10);
  const row = await prepare(`INSERT INTO mail_daily_budget(day,used) VALUES (?,1)
    ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<? RETURNING used`).bind(day, maximum).first();
  // Failed/uncertain API attempts retain their reservation to stay below the cap.
  return !!row;
}
function payload(env: Env, to: string, subject: string, text: string, key: string): string {
  return JSON.stringify({ sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME || 'Data Coffee' },
    to: [{ email: to }], subject, textContent: text, headers: { idempotencyKey: key } });
}
async function deliver(env: Env, body: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'api-key': env.BREVO_API_KEY! },
      body,
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
  await deliver(env, payload(env, to, subject, text, crypto.randomUUID()));
}
interface MailRow { id: string; user_id: string; subject: string; body: string; attempts: number; claimed_until: number; kind: string; priority: number; deliver_before: number | null; has_members: number }
const NEVER = 8640000000000000;

/** Claims prevent concurrent sends. Provider keys protect retries after a crash.
 * Brevo deduplicates for 30 minutes; after 25 minutes an unresolved dispatch is
 * terminally failed for operator review, since delivery cannot then be proven.
 * status=sent means provider accepted, not confirmed recipient delivery.
 */
export interface MailDrainStats {claimed:number;sent:number;retryableFailures:number;terminalFailures:number;manualReviewFailures:number;d1Statements:number;budgetExhausted:boolean;phaseError:string|null}
export async function drainMail(env: Env, limit = 10, queryBudget = 40): Promise<MailDrainStats> {
  // Count actual SQL statements, reserving the worst-case recovery cost before
  // claiming: 8 for an independent mail, 12 for a digest, plus 4 for cleanup.
  const budget = Math.max(0,Math.min(40,Number.isFinite(queryBudget)?Math.floor(queryBudget):40));
  const count = Math.max(0, Math.min(50, Math.floor(Number.isFinite(limit) ? limit : 10)));
  const stats:MailDrainStats={claimed:0,sent:0,retryableFailures:0,terminalFailures:0,manualReviewFailures:0,d1Statements:0,budgetExhausted:false,phaseError:null};
  if (budget < 4) {stats.budgetExhausted=true;return stats;}
  let queries = 0;
  const prepare = (sql: string) => { queries++; return env.DB.prepare(sql); };
  try{
  for (let index = 0; index < count; index++) {
    const remaining = budget - queries - 4;
    if (remaining < 8) {stats.budgetExhausted=true;break;}
    const now = Date.now(), lease = now + 120_000;
    const row = await prepare(`UPDATE outbox SET status='sending',claimed_until=?,attempts=attempts+1
      WHERE id=(SELECT id FROM outbox WHERE digest_id IS NULL
        AND (? >= 12 OR (NOT (${digestEligibleSQL}) AND NOT EXISTS(SELECT 1 FROM outbox m WHERE m.digest_id=outbox.id))) AND
        ((status IN ('pending','failed') AND next_attempt<=? AND attempts<5)
          OR (status='sending' AND claimed_until<=?))
        ORDER BY ${noticeOrderSQL} LIMIT 1)
      RETURNING id,user_id,subject,body,attempts,claimed_until,kind,priority,deliver_before,
        EXISTS(SELECT 1 FROM outbox m WHERE m.digest_id=outbox.id) AS has_members`).bind(lease, remaining, now, now).first<MailRow>();
    if (!row) break;
    stats.claimed++;
    const eligible = canDigestNotice(row.kind,row.priority,row.deliver_before);
    const grouped = eligible || !!row.has_members;
    const finish = async (status: string, error: string | null, next: number, decrement = false) => {
      await env.DB.batch([
        // Only terminal results propagate to members; retries use the leader.
        ...(grouped ? [prepare(`UPDATE outbox SET status=?,last_error=?,next_attempt=?,sent_at=?
          WHERE digest_id=? AND (?='sent' OR ?=?) AND EXISTS
          (SELECT 1 FROM outbox WHERE id=? AND status='sending' AND attempts=? AND claimed_until=?)`)
          .bind(status, error, next, status === 'sent' ? Date.now() : null, row.id, status, next, NEVER, row.id, row.attempts, lease)] : []),
        prepare(`UPDATE outbox SET status=?,last_error=?,next_attempt=?,claimed_until=0,
        attempts=attempts-?,sent_at=? WHERE id=? AND status='sending' AND attempts=? AND claimed_until=?`)
        .bind(status, error, next, +decrement, status === 'sent' ? Date.now() : null, row.id, row.attempts, lease),
      ]);
    };
    try {
      configured(env);
      const context = await prepare(`SELECT u.email,d.provider_key,d.first_attempt,p.payload FROM outbox o
        LEFT JOIN users u ON u.id=o.user_id LEFT JOIN mail_dispatch d ON d.outbox_id=o.id
        LEFT JOIN mail_payload p ON p.outbox_id=o.id WHERE o.id=?`).bind(row.id)
        .first<{email:string|null;provider_key:string|null;first_attempt:number;payload:string|null}>();
      if (!context) throw new MailError('outbox_missing');
      const prior = context.provider_key ? context : null;
      if (prior && now - prior.first_attempt >= 25 * 60_000) throw new MailError('delivery_uncertain_manual_review');
      if (row.attempts > 5) throw new MailError('retry_limit_manual_review');
      let frozen = context.payload ? {payload:context.payload} : null;
      // A pre-migration uncertain send has no provable original recipient/body.
      if (prior && !frozen) throw new MailError('legacy_delivery_manual_review');
      if (!frozen) {
        if (!context.email) throw new MailError('recipient_missing');
        if (eligible) {
          // Atomically take only never-attempted, due notices. A concurrently
          // claimed leader is excluded. Membership survives a crash before freeze.
          await prepare(`UPDATE outbox SET status='bundled',digest_id=? WHERE id IN
            (SELECT id FROM outbox WHERE user_id=? AND (${digestEligibleSQL}) AND status='pending'
              AND attempts=0 AND next_attempt<=? AND digest_id IS NULL AND id!=?
              AND NOT EXISTS(SELECT 1 FROM mail_dispatch WHERE outbox_id=outbox.id)
              ORDER BY created_at,id LIMIT max(0,19-(SELECT count(*) FROM outbox WHERE digest_id=?)))
            AND EXISTS(SELECT 1 FROM outbox WHERE id=? AND status='sending' AND attempts=? AND claimed_until=?)`)
            .bind(row.id,row.user_id,now,row.id,row.id,row.id,row.attempts,lease).run();
        }
        const members = grouped ? (await prepare('SELECT subject,body FROM outbox WHERE digest_id=? ORDER BY created_at,id')
          .bind(row.id).all<{subject:string;body:string}>()).results : [];
        const items = [{subject:row.subject,body:row.body},...members];
        const subject = items.length > 1 ? `有 ${items.length} 项活动通知` : row.subject;
        const body = items.length > 1 ? items.map((item,i)=>`${i+1}. ${item.subject}\n${item.body}`).join('\n\n') : row.body;
        const stable = payload(env,context.email,subject,body,crypto.randomUUID());
        frozen = await prepare(`INSERT INTO mail_payload(outbox_id,payload) SELECT ?,? WHERE EXISTS
          (SELECT 1 FROM outbox WHERE id=? AND status='sending' AND attempts=? AND claimed_until=?)
          ON CONFLICT(outbox_id) DO UPDATE SET payload=mail_payload.payload RETURNING payload`)
          .bind(row.id,stable,row.id,row.attempts,lease).first<{payload:string}>();
        if (!frozen) continue; // Lease was lost; its new owner will recover.
      }
      const owned = await prepare(`SELECT id FROM outbox WHERE id=? AND status='sending'
        AND attempts=? AND claimed_until=? AND claimed_until>?`).bind(row.id,row.attempts,lease,Date.now()+15_000).first();
      if (!owned) continue;
      if (!await reserveBudget(env, false, prepare)) {
        const tomorrow = Math.floor(now / 86400000) * 86400000 + 86400000;
        await finish('pending', 'daily_budget_exhausted', tomorrow, true);
        stats.d1Statements=queries;
        return stats;
      }
      // Persist before external side effect, so a worker crash preserves the key.
      const dispatch = prior || await prepare(`INSERT INTO mail_dispatch(outbox_id,provider_key,first_attempt) VALUES (?,?,?)
        ON CONFLICT(outbox_id) DO UPDATE SET outbox_id=excluded.outbox_id RETURNING provider_key,first_attempt`)
        .bind(row.id, (JSON.parse(frozen.payload) as {headers:{idempotencyKey:string}}).headers.idempotencyKey, Date.now()).first<{ provider_key: string; first_attempt: number }>();
      if (!dispatch) throw new MailError('dispatch_missing');
      await deliver(env, frozen.payload);
      await finish('sent', null, 0);
      stats.sent++;
    } catch (error) {
      const known = error instanceof MailError ? error : new MailError('internal_mail_error', true);
      const retry = known.retryable && row.attempts < 5;
      await finish('failed', known.code, retry ? now + Math.min(600_000, 30_000 * 2 ** (row.attempts - 1)) : NEVER);
      if(retry)stats.retryableFailures++;else stats.terminalFailures++;
      if(known.code.endsWith('_manual_review'))stats.manualReviewFailures++;
    }
  }
  // Bounded cleanup carries no PII into logs and keeps auth auxiliary tables small.
  const now = Date.now();
  await env.DB.batch([
    prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(now),
    prepare('DELETE FROM auth_codes WHERE expires_at<?').bind(now - 86400000),
    prepare('DELETE FROM auth_rate_limits WHERE window_start<?').bind(now - 86400000),
    prepare('DELETE FROM mail_daily_budget WHERE day<?').bind(new Date(now - 7 * 86400000).toISOString().slice(0, 10)),
  ]);
  stats.d1Statements=queries;
  return stats;
  }catch{
    stats.d1Statements=queries;stats.phaseError='mail_drain_failed';
    console.error('mail_drain_failed');
    return stats;
  }
}
