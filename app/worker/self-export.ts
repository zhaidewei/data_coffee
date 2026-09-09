import {decodeActivityDocument} from './activity-schema';
import type {Activity,Env,User} from './types';

interface ActivityRow {id:string;version:number;document:string;created_at:number}

function personalActivity(activity:Activity,userId:string) {
  const {ownerId,...event}=activity;
  return {
    ...event,
    ...(ownerId===userId?{ownerId}:{}),
    participants:activity.participants.filter(item=>item.userId===userId).map(item=>{
      const {registrationRepliedBy,...participant}=item;
      return {...participant,...(registrationRepliedBy===userId?{registrationRepliedBy}: {})};
    }),
    applications:activity.applications.filter(item=>item.userId===userId).map(item=>{
      const {reviewedBy,...application}=item;
      return {...application,...(reviewedBy===userId?{reviewedBy}: {})};
    }),
    processed:activity.processed.filter(item=>item.userId===userId),
    authoredRegistrationReplies:activity.participants.filter(item=>item.registrationReply&&(item.registrationRepliedBy===userId||(!item.registrationRepliedBy&&ownerId===userId))).map(item=>({reply:item.registrationReply,repliedAt:item.registrationRepliedAt})),
    authoredApplicationReviews:activity.applications.filter(item=>item.reviewedBy===userId).map(item=>({applicationId:item.id,kind:item.kind,status:item.status,reason:item.reason,reviewedAt:item.updatedAt})),
  };
}

async function activitiesFor(env:Env,userId:string) {
  const history=await env.DB.prepare('SELECT DISTINCT event_id FROM audit WHERE actor_id=? ORDER BY event_id').bind(userId).all<{event_id:string}>();
  const ids=history.results.map(row=>row.event_id);
  const activities:ReturnType<typeof personalActivity>[]=[];
  for(let offset=0;offset<ids.length;offset+=80){
    const batch=ids.slice(offset,offset+80);
    const rows=await env.DB.prepare(`SELECT id,version,document,created_at FROM activities WHERE id IN (${batch.map(()=>'?').join(',')}) ORDER BY created_at,id`).bind(...batch).all<ActivityRow>();
    for(const row of rows.results){
      const activity=decodeActivityDocument(row.document,{id:row.id,version:row.version,createdAt:row.created_at});
      if(activity.ownerId===userId||activity.participants.some(item=>item.userId===userId)||activity.applications.some(item=>item.userId===userId)||activity.processed.some(item=>item.userId===userId))activities.push(personalActivity(activity,userId));
    }
  }
  return activities.sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
}

export async function exportUserData(env:Env,user:User,exportedAt=Date.now()) {
  const [activities,audit,notifications,tokens,sessions,aiProposals]=await Promise.all([
    activitiesFor(env,user.id),
    env.DB.prepare('SELECT event_id AS eventId,action,version,created_at AS createdAt FROM audit WHERE actor_id=? ORDER BY created_at,id').bind(user.id).all(),
    env.DB.prepare('SELECT id,subject,body,status,attempts,created_at AS createdAt,sent_at AS sentAt,kind,priority,deliver_before AS deliverBefore FROM outbox WHERE user_id=? ORDER BY created_at,id').bind(user.id).all(),
    env.DB.prepare('SELECT id,name,scope,created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt FROM personal_tokens WHERE user_id=? ORDER BY created_at,id').bind(user.id).all(),
    env.DB.prepare('SELECT expires_at AS expiresAt FROM auth_sessions WHERE user_id=? ORDER BY expires_at').bind(user.id).all(),
    env.DB.prepare('SELECT id,event_id AS eventId,action,version,expires_at AS expiresAt,created_at AS createdAt FROM ai_proposals WHERE user_id=? ORDER BY created_at,id').bind(user.id).all(),
  ]);
  return {
    schemaVersion:1,
    exportedAt,
    profile:{id:user.id,email:user.email,nickname:user.nickname,publicNickname:user.publicNickname},
    activities,
    audit:audit.results,
    notifications:notifications.results,
    tokens:tokens.results,
    sessions:sessions.results,
    aiProposals:aiProposals.results,
  };
}
