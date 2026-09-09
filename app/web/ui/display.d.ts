interface DisplayEvent {
 id?: string;
 selectedSlotId?: string;
 rules: {
  recruitmentDeadline?: number;
  registrationDeadline?: number;
  promotionDeadline?: number;
  startsAt?: number;
  endsAt?: number;
  registrationLeadHours?: number;
  promotionLeadHours?: number;
  timeSlots?: unknown[];
 };
}
export function date(ms: number, options?: Intl.DateTimeFormatOptions): string;
export function activityUrl(event: {id: string}): string;
export function countdown(ms: number): string;
export function eventTimePhase(event: DisplayEvent): string;
export function deadlineLabel(event: DisplayEvent, kind: 'registration' | 'promotion'): string;
