import type {Notice} from './types';

// Stable machine identities. Display copy is deliberately not part of this policy.
export const noticePolicies = {
  activity_cancelled: {priority: 1},
  promotion_offer: {priority: 0},
  promotion_confirmed: {priority: 0},
  activity_confirmed: {priority: 1},
  repair_required: {priority: 0},
  promotion_deadline_changed: {priority: 0},
  repair_resolved: {priority: 1},
  registration_not_selected: {priority: 1},
  activity_time_selected: {priority: 1},
  candidate_time_expired: {priority: 0},
  registration_reply: {priority: 1},
  application_submitted: {priority: 2},
  venue_standby: {priority: 1},
  application_reviewed: {priority: 1},
  application_withdrawn: {priority: 1},
} as const;
export type NoticeKind = keyof typeof noticePolicies;
export type NoticePriority = 0 | 1 | 2;
export type NoticeSemantics = Pick<Notice, 'kind' | 'priority' | 'deliverBefore'>;
type DeadlineKind = 'promotion_offer' | 'promotion_deadline_changed' | 'repair_required' | 'candidate_time_expired';
export function noticeSemantics(kind: DeadlineKind, deliverBefore: number): NoticeSemantics;
export function noticeSemantics(kind: Exclude<NoticeKind, DeadlineKind>, deliverBefore?: number): NoticeSemantics;
export function noticeSemantics(kind: NoticeKind, deliverBefore?: number): NoticeSemantics {
  if (deliverBefore !== undefined && (!Number.isSafeInteger(deliverBefore) || deliverBefore <= 0)) throw new Error('invalid_notice_deadline');
  return {kind,priority:noticePolicies[kind].priority,deliverBefore:deliverBefore ?? null};
}

// Central SQL policy: only known informational applications without a deadline
// may become a new digest. Legacy/unknown kinds are never classified by subject.
const DIGEST_KIND = 'application_submitted';
export function canDigestNotice(kind: string, priority: number, deliverBefore: number | null): boolean {
  return kind === DIGEST_KIND && priority === noticePolicies[DIGEST_KIND].priority && deliverBefore === null;
}
export const digestEligibleSQL = `kind='${DIGEST_KIND}' AND priority=${noticePolicies[DIGEST_KIND].priority} AND deliver_before IS NULL`;
export const noticeOrderSQL = 'priority,deliver_before IS NULL,deliver_before,created_at,id';
