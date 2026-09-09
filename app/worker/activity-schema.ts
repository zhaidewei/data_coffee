import type {Activity} from './types';

export const ACTIVITY_SCHEMA_VERSION = 1 as const;

export class ActivityDocumentError extends Error {
  constructor(public readonly code:'activity_document_invalid'|'activity_schema_unsupported') {super(code);}
}

type Data = Record<string,unknown>;
const own=(value:Data,key:string)=>Object.prototype.hasOwnProperty.call(value,key);
const record=(value:unknown):value is Data=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const string=(value:unknown)=>typeof value==='string';
const boolean=(value:unknown)=>typeof value==='boolean';
const integer=(value:unknown)=>Number.isSafeInteger(value);
const optional=(value:unknown,check:(item:unknown)=>boolean)=>value===undefined||check(value);
const list=(value:unknown,check:(item:unknown)=>boolean)=>Array.isArray(value)&&value.every(check);
const oneOf=(value:unknown,values:readonly string[])=>typeof value==='string'&&values.includes(value);

function validSlot(value:unknown):boolean {
  return record(value)&&string(value.id)&&integer(value.startsAt)&&integer(value.endsAt);
}
function validRules(value:unknown):boolean {
  if(!record(value))return false;
  return optional(value.timeSlots,item=>list(item,validSlot))&&
    integer(value.minPeople)&&integer(value.maxPeople)&&boolean(value.waitlist)&&
    integer(value.recruitmentDeadline)&&integer(value.startsAt)&&integer(value.endsAt)&&
    integer(value.registrationDeadline)&&integer(value.promotionDeadline)&&
    optional(value.registrationLeadHours,integer)&&optional(value.promotionLeadHours,integer)&&
    integer(value.repairMinutes)&&boolean(value.venueRequired)&&integer(value.minTalks)&&
    integer(value.minCohosts)&&integer(value.minHosts)&&boolean(value.allowRoleOverlap)&&
    boolean(value.continuousVenue)&&boolean(value.continuousTalks)&&boolean(value.continuousCohosts)&&
    boolean(value.continuousHosts)&&oneOf(value.addressVisibility,['public','participants']);
}
function validParticipant(value:unknown):boolean {
  if(!record(value))return false;
  return string(value.userId)&&oneOf(value.status,['joined','waitlisted','left'])&&integer(value.appliedAt)&&integer(value.order)&&
    optional(value.availableSlotIds,item=>list(item,string))&&optional(value.timePreference,string)&&
    optional(value.placePreference,string)&&optional(value.transportPreferences,item=>list(item,string))&&
    optional(value.registrationMessage,string)&&optional(value.promotionOfferUntil,integer)&&
    optional(value.promotionOfferExpired,boolean)&&optional(value.registrationReply,string)&&optional(value.registrationRepliedAt,integer);
}
function validApplication(value:unknown):boolean {
  if(!record(value))return false;
  return string(value.id)&&string(value.userId)&&oneOf(value.kind,['cohost','host','talk','venue','material','pledge'])&&
    string(value.title)&&string(value.detail)&&optional(value.capacity,integer)&&optional(value.address,string)&&
    optional(value.amount,item=>typeof item==='number'&&Number.isFinite(item))&&optional(value.duration,item=>typeof item==='number'&&Number.isFinite(item))&&
    oneOf(value.status,['pending','approved','rejected','withdrawn'])&&optional(value.reason,string)&&
    optional(value.reviewedBy,string)&&integer(value.updatedAt);
}
function validCondition(value:unknown):boolean {
  return record(value)&&string(value.key)&&string(value.label)&&typeof value.current==='number'&&Number.isFinite(value.current)&&
    typeof value.required==='number'&&Number.isFinite(value.required)&&boolean(value.satisfied)&&boolean(value.continuous);
}
function validRepair(value:unknown):boolean {
  return record(value)&&string(value.key)&&string(value.label)&&integer(value.openedAt)&&integer(value.deadline);
}
function validReceipt(value:unknown):boolean {
  if(!record(value)||!integer(value.at)||!string(value.kind)||!list(value.conditions,validCondition)||!string(value.reason))return false;
  return optional(value.descriptionChange,item=>record(item)&&string(item.before)&&string(item.after));
}
function validProcessed(value:unknown):boolean {
  return record(value)&&string(value.key)&&string(value.userId);
}
function validActivity(value:unknown):value is Activity {
  if(!record(value)||value.schemaVersion!==ACTIVITY_SCHEMA_VERSION)return false;
  return optional(value.tags,item=>list(item,string))&&string(value.id)&&string(value.ownerId)&&string(value.title)&&
    string(value.city)&&string(value.description)&&optional(value.selectedSlotId,string)&&validRules(value.rules)&&
    oneOf(value.status,['draft','recruiting','confirmed','repairing','cancelled','completed'])&&integer(value.version)&&
    integer(value.createdAt)&&optional(value.publishedAt,integer)&&list(value.participants,validParticipant)&&
    list(value.applications,validApplication)&&list(value.repairs,validRepair)&&list(value.receipts,validReceipt)&&
    integer(value.sequence)&&optional(value.reason,string)&&list(value.processed,validProcessed);
}

/** The only entrypoint for decoding and upgrading persisted Activity JSON. */
export function decodeActivityDocument(document:string,expected?:{id:string;version:number;createdAt:number}):Activity {
  let value:unknown;
  try{value=JSON.parse(document);}catch{throw new ActivityDocumentError('activity_document_invalid');}
  if(!record(value))throw new ActivityDocumentError('activity_document_invalid');
  if(!own(value,'schemaVersion')||value.schemaVersion===0)value={...value,schemaVersion:ACTIVITY_SCHEMA_VERSION};
  else if(value.schemaVersion!==ACTIVITY_SCHEMA_VERSION){
    if(integer(value.schemaVersion)&&Number(value.schemaVersion)>ACTIVITY_SCHEMA_VERSION)throw new ActivityDocumentError('activity_schema_unsupported');
    throw new ActivityDocumentError('activity_document_invalid');
  }
  if(!validActivity(value))throw new ActivityDocumentError('activity_document_invalid');
  if(expected&&(value.id!==expected.id||value.version!==expected.version||value.createdAt!==expected.createdAt))throw new ActivityDocumentError('activity_document_invalid');
  return value;
}

export function encodeActivityDocument(activity:Activity):string {
  if(!validActivity(activity))throw new ActivityDocumentError('activity_document_invalid');
  return JSON.stringify(activity);
}
