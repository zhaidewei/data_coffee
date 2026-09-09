import type {Env} from './types';

const NEVER=8640000000000000;
export interface OperationsProjection {
  observedAt:number;
  activities:{due:number;oldestDueAt:number|null;oldestAgeMs:number};
  mail:{due:number;oldestCreatedAt:number|null;oldestAgeMs:number;manualReviewFailures:number;terminalFailures:number};
}

/** Aggregate-only operational view: no activity, user, address or mail content. */
export async function operations(env:Env,now=Date.now()):Promise<OperationsProjection>{
  const [activities,mail]=await Promise.all([
    env.DB.prepare(`SELECT count(*) AS due,min(next_due) AS oldest FROM activities WHERE next_due<=?`).bind(now).first<{due:number;oldest:number|null}>(),
    env.DB.prepare(`SELECT
      sum(CASE WHEN digest_id IS NULL AND ((status IN ('pending','failed') AND next_attempt<=? AND attempts<5) OR (status='sending' AND claimed_until<=?)) THEN 1 ELSE 0 END) AS due,
      min(CASE WHEN digest_id IS NULL AND ((status IN ('pending','failed') AND next_attempt<=? AND attempts<5) OR (status='sending' AND claimed_until<=?)) THEN created_at END) AS oldest,
      sum(CASE WHEN status='failed' AND last_error LIKE '%manual_review' THEN 1 ELSE 0 END) AS manual_review,
      sum(CASE WHEN status='failed' AND next_attempt=? THEN 1 ELSE 0 END) AS terminal
      FROM outbox`).bind(now,now,now,now,NEVER).first<{due:number|null;oldest:number|null;manual_review:number|null;terminal:number|null}>(),
  ]);
  const oldestDueAt=activities?.oldest??null,oldestCreatedAt=mail?.oldest??null;
  return {observedAt:now,
    activities:{due:Number(activities?.due??0),oldestDueAt,oldestAgeMs:oldestDueAt===null?0:Math.max(0,now-oldestDueAt)},
    mail:{due:Number(mail?.due??0),oldestCreatedAt,oldestAgeMs:oldestCreatedAt===null?0:Math.max(0,now-oldestCreatedAt),manualReviewFailures:Number(mail?.manual_review??0),terminalFailures:Number(mail?.terminal??0)}};
}
