export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ENV: string;
  APP_URL?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  MAIL_DAILY_LIMIT?: string;
}
export interface User { id: string; email: string; nickname: string; publicNickname: boolean }
export type Status = 'draft' | 'recruiting' | 'confirmed' | 'repairing' | 'cancelled' | 'completed';
export type Role = 'host' | 'cohost';
export interface TimeSlot { id:string; startsAt:number; endsAt:number }
export interface Rules {
  timeSlots?: TimeSlot[];
  minPeople: number; maxPeople: number; waitlist: boolean;
  recruitmentDeadline: number; startsAt: number; endsAt: number;
  registrationDeadline: number; promotionDeadline: number;
  repairMinutes: number;
  venueRequired: boolean; minTalks: number; minCohosts: number; minHosts: number;
  allowRoleOverlap: boolean; continuousVenue: boolean; continuousTalks: boolean;
  continuousCohosts: boolean; continuousHosts: boolean;
  addressVisibility: 'public' | 'participants';
}
export interface Participant {
  userId: string; status: 'joined'|'waitlisted'|'left'; appliedAt: number; order: number;
  availableSlotIds?: string[]; timePreference?: string; placePreference?: string; transportPreferences?: string[]; registrationMessage?: string;
  registrationReply?: string; registrationRepliedAt?: number;
}
export interface Application { id: string; userId: string; kind: 'cohost'|'host'|'talk'|'venue'|'material'|'pledge'; title: string; detail: string; capacity?: number; address?: string; amount?: number; duration?: number; status: 'pending'|'approved'|'rejected'|'withdrawn'; reason?: string; reviewedBy?: string; updatedAt: number }
export interface Condition { key: string; label: string; current: number; required: number; satisfied: boolean; continuous: boolean }
export interface Repair { key: string; label: string; openedAt: number; deadline: number }
export interface Receipt { at: number; kind: string; conditions: Condition[]; reason: string; descriptionChange?: {before: string; after: string} }
export interface Activity {
  tags?: string[];
  id: string; ownerId: string; title: string; city: string; description: string;
  selectedSlotId?: string; rules: Rules; status: Status; version: number; createdAt: number; publishedAt?: number;
  participants: Participant[]; applications: Application[]; repairs: Repair[];
  receipts: Receipt[]; sequence: number; reason?: string;
  processed: {key: string; userId: string}[];
}
export interface Notice { userId: string; subject: string; text: string }
export interface Command { action: string; [key: string]: unknown }
