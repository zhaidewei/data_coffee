import type {Activity, Command, Env, Notice, User} from './types';
import {applyCommand, conditions, createActivity, DomainError, fail, isManager, joined, nextDue, reconcile} from './engine';
import {decodeActivityDocument,encodeActivityDocument} from './activity-schema';
import {CronBudget,CronBudgetExceeded} from './cron-budget';
// @ts-expect-error Dependency-free JavaScript shared with the browser.
import {canonicalCity} from '../web/city-catalog.js';

async function loadRecord(env:Env,id:string):Promise<{activity:Activity;document:string}> {
  const row=await env.DB.prepare('SELECT id,version,document,created_at FROM activities WHERE id=?').bind(id).first<{id:string;version:number;document:string;created_at:number}>();
  if(!row)return fail('活动不存在',404);
  return {activity:decodeActivityDocument(row.document,{id:row.id,version:row.version,createdAt:row.created_at}),document:row.document};
}
export async function load(env:Env,id:string):Promise<Activity> {return (await loadRecord(env,id)).activity;}
export async function deleteDraft(env:Env,id:string,user:User,version:number):Promise<void>{
  if(!Number.isSafeInteger(version)||version<0)fail('缺少有效活动版本，请刷新',409);
  const {activity:old,document}=await loadRecord(env,id);
  if(old.ownerId!==user.id)fail('活动不存在',404);
  if(old.status!=='draft')fail('仅可删除草稿',409);
  if(old.version!==version)fail('活动状态已变化，请刷新后重新确认',409);
  // D1 batch is transactional: only the exact owner-held draft snapshot can be removed.
  const predicate='id=? AND version=? AND document=?';
  const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO audit(id,event_id,actor_id,action,version,created_at) SELECT ?,?,?,'delete_draft',?,? WHERE EXISTS(SELECT 1 FROM activities WHERE ${predicate})`).bind(crypto.randomUUID(),id,user.id,version+1,Date.now(),id,version,document),
    env.DB.prepare(`DELETE FROM activities WHERE ${predicate}`).bind(id,version,document)
  ]);
  if(!results[1].meta.changes)fail('活动状态已变化，请刷新后重新确认',409);
}
async function commit(env:Env,old:Activity,e:Activity,notices:Notice[],actor:string,action:string,now:number):Promise<boolean> {
  const marker=crypto.randomUUID();e.version=old.version+1;
  const sql=[env.DB.prepare('UPDATE activities SET version=?,document=?,commit_id=?,next_due=? WHERE id=? AND version=?').bind(e.version,encodeActivityDocument(e),marker,nextDue(e),e.id,old.version),
    env.DB.prepare('INSERT INTO audit(id,event_id,actor_id,action,version,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM activities WHERE id=? AND commit_id=?)').bind(marker,e.id,actor,action,e.version,now,e.id,marker)];
  const link=env.APP_URL?`\n\n活动详情：${env.APP_URL}/#event/${e.id}`:'';
  if(notices.length){
    // A single JSON parameter keeps D1 statement use independent of recipient
    // count. The INSERT remains in the same transactional batch and is gated by
    // the successful activity CAS marker.
    const rows=notices.map((n,index)=>[`${marker}:${index}`,n.userId,n.subject,n.text+link,now,n.kind,n.priority,n.deliverBefore]);
    sql.push(env.DB.prepare(`INSERT INTO outbox(id,user_id,subject,body,created_at,kind,priority,deliver_before)
      SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),json_extract(value,'$[3]'),
        json_extract(value,'$[4]'),json_extract(value,'$[5]'),json_extract(value,'$[6]'),json_extract(value,'$[7]')
      FROM json_each(?) WHERE EXISTS(SELECT 1 FROM activities WHERE id=? AND commit_id=?)`).bind(JSON.stringify(rows),e.id,marker));
  }
  if(action==='edit'||action==='describe')for(const tag of e.tags||[])sql.push(env.DB.prepare('INSERT OR IGNORE INTO tags(key,label) SELECT ?,? WHERE EXISTS(SELECT 1 FROM activities WHERE id=? AND commit_id=?)').bind(tag.toLowerCase(),tag,e.id,marker));
  const result=await env.DB.batch(sql);return (result[0].meta.changes??0)>0;
}
const advances=new WeakMap<object,Map<string,Promise<Activity>>>();
export async function advance(env:Env,id:string,clock=Date.now):Promise<Activity>{
  let pending=advances.get(env.DB);if(!pending){pending=new Map();advances.set(env.DB,pending);}
  const existing=pending.get(id);if(existing)return structuredClone(await existing);
  const task=advanceOnce(env,id,clock);pending.set(id,task);
  try{return structuredClone(await task);}finally{if(pending.get(id)===task)pending.delete(id);}
}
async function advanceOnce(env:Env,id:string,clock:()=>number):Promise<Activity> {
  for(let retry=0;retry<12;retry++){
    const old=await load(env,id);const now=clock();const due=nextDue(old);if((due===null||due>now)&&!old.repairs.some(r=>['talks','cohosts','roles'].includes(r.key)))return old;const e=structuredClone(old);const out:Notice[]=[];
    reconcile(e,now,out);
    if(JSON.stringify(e)===JSON.stringify(old))return old;
    if(await commit(env,old,e,out,'system','reconcile',now))return e;
  }
  return fail('活动正在更新，请稍后刷新',409);
}
async function canReplayJoin(env:Env,old:Activity,cmd:Command,user:User,version:number):Promise<boolean>{
  // Only a first registration can ignore unrelated first-party activity versions.
  // Audit history proves that no newer personal intent or management decision is
  // being overwritten, including a time selection before the first load.
  if(cmd.action!=='join'||!Number.isSafeInteger(version)||version<0||version>=old.version||old.participants.some(p=>p.userId===user.id))return false;
  const history=await env.DB.prepare("SELECT count(*) AS total, sum(CASE WHEN action='join' AND actor_id<>? THEN 1 ELSE 0 END) AS safe FROM audit WHERE event_id=? AND version>? AND version<=?").bind(user.id,old.id,version,old.version).first<{total:number;safe:number}>();
  return history?.total===old.version-version&&history.safe===history.total;
}
export async function execute(env:Env,id:string,cmd:Command,user:User,key:string,version?:number,clock=Date.now,options:{strictVersion?:boolean}={}):Promise<Activity>{
  if(!key||key.length>100||!/^[A-Za-z0-9:_-]+$/.test(key))fail('需要有效的操作幂等标识');
  // Ten attempts cost at most 40 statements on the ordinary registration path
  // (load, audit-range check, CAS, audit insert); reconciliation/notices are extra.
  for(let retry=0;retry<10;retry++){
    // Spread competing isolates across a bounded retry window, instead of
    // repeatedly sending all losers back to D1 in the same wave.
    if(retry)await new Promise(resolve=>setTimeout(resolve,Math.floor((0.5+Math.random())*Math.min(2000,100*2**(retry-1)))));
    const old=await advance(env,id,clock);
    if(old.processed.some(p=>p.key===key&&p.userId===user.id))return old;
    if(version!==undefined&&version!==old.version&&(options.strictVersion||!await canReplayJoin(env,old,cmd,user,version)))fail('活动状态已变化，请刷新后重新确认',409);
    const now=clock();
    // Time can cross while loading or retrying: settle again before mutation.
    if(nextDue(old)!==null&&nextDue(old)!<=now)continue;
    const e=structuredClone(old);const out:Notice[]=[];
    applyCommand(e,cmd,user.id,now,out);
    e.processed.push({key,userId:user.id});if(e.processed.length>4000)e.processed.splice(0,e.processed.length-4000);
    if(await commit(env,old,e,out,user.id,cmd.action,now))return e;
  }
  return fail('操作冲突，请刷新后重试',409);
}
export async function insertActivity(env:Env,body:Record<string,unknown>,user:User):Promise<Activity>{
  const now=Date.now();const e=createActivity(body,user.id,now);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(e.id,0,encodeActivityDocument(e),crypto.randomUUID(),null,now),
    env.DB.prepare('INSERT INTO audit(id,event_id,actor_id,action,version,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),e.id,user.id,'create',0,now),
    ...(e.tags||[]).map(tag=>env.DB.prepare('INSERT OR IGNORE INTO tags(key,label) VALUES(?,?)').bind(tag.toLowerCase(),tag))
  ]);return e;
}
export async function project(env:Env,e:Activity,user:User|null,summary=false):Promise<Record<string,unknown>>{
  const manager=!!user&&isManager(e,user.id);const mine=e.participants.find(p=>p.userId===user?.id)??null;
  if(e.status==='draft'&&e.ownerId!==user?.id)fail('活动不存在',404);
  const addressAllowed=e.rules.addressVisibility==='public'||manager||mine?.status==='joined';
  const base:Record<string,unknown>={id:e.id,tags:e.tags||[],title:e.title,city:canonicalCity(e.city)||e.city,description:e.description,selectedSlotId:e.selectedSlotId,rules:e.rules,status:e.status,version:e.version,createdAt:e.createdAt,publishedAt:e.publishedAt,reason:e.reason,counts:{joined:joined(e).length,waitlisted:e.participants.filter(p=>p.status==='waitlisted').length},conditions:conditions(e),repairs:e.repairs,canManage:manager,isOwner:user?.id===e.ownerId};
  if(summary)return base;
  const publisher=await env.DB.prepare('SELECT nickname,public_nickname FROM users WHERE id=?').bind(e.ownerId).first<{nickname:string;public_nickname:number}>();
  base.publisher={nickname:publisher&&(publisher.public_nickname||manager)?publisher.nickname.trim()||'未设置昵称':'匿名成员'};
  const preferenceCounts=(key:'timePreference'|'placePreference')=>[...e.participants.filter(p=>p.status!=='left'&&p[key]).reduce((m,p)=>m.set(p[key]!,1+(m.get(p[key]!)??0)),new Map<string,number>())].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,8).map(([label,count])=>({label,count}));
  base.preferenceSummary={slots:(e.rules.timeSlots||[]).map(slot=>({id:slot.id,label:new Date(slot.startsAt).toISOString(),count:e.participants.filter(p=>p.status!=='left'&&p.availableSlotIds?.includes(slot.id)).length})),times:preferenceCounts('timePreference'),places:preferenceCounts('placePreference'),transport:[['public_transport','公共交通'],['car','开车']].map(([value,label])=>({label,count:e.participants.filter(p=>p.status!=='left'&&p.transportPreferences?.includes(value)).length}))};
  const ids=[...new Set(e.participants.filter(p=>p.status!=='left').map(p=>p.userId))];
  const names=new Map<string,{nickname:string;public_nickname:number}>();
  // D1 variable limit is 100; keep batches below it.
  for(let i=0;i<ids.length;i+=80){const batch=ids.slice(i,i+80);const res=await env.DB.prepare(`SELECT id,nickname,public_nickname FROM users WHERE id IN (${batch.map(()=>'?').join(',')})`).bind(...batch).all<{id:string;nickname:string;public_nickname:number}>();for(const n of res.results)names.set(n.id,n);}
  base.participants=e.participants.filter(p=>p.status!=='left').map(p=>{const n=names.get(p.userId);return {participantId:manager?p.userId:undefined,nickname:n&&(n.public_nickname||manager||user?.id===p.userId)?n.nickname:'匿名成员',registrationMessage:p.registrationMessage,registrationReply:p.registrationReply,registrationRepliedAt:p.registrationRepliedAt,status:p.status,isMe:user?.id===p.userId};});
  base.myParticipation=mine?{status:mine.status,promotionOfferUntil:mine.promotionOfferUntil,availableSlotIds:mine.availableSlotIds||[],appliedAt:mine.appliedAt,timePreference:mine.timePreference,placePreference:mine.placePreference,transportPreferences:mine.transportPreferences||[],registrationMessage:mine.registrationMessage||'',position:mine.status==='waitlisted'?e.participants.filter(p=>p.status==='waitlisted'&&p.order<=mine.order).length:undefined}:null;
  const visible=(a:Activity['applications'][number])=>manager||a.userId===user?.id||(['venue','talk','material','pledge'].includes(a.kind)&&a.status==='approved');
  const appProjection=(a:Activity['applications'][number])=>{
    const own=a.userId===user?.id;
    if(manager||own)return {...a,isMine:own};
    // Proposal notes may contain private contacts: never expose them publicly.
    return {id:a.id,kind:a.kind,title:a.title,status:a.status,capacity:a.capacity,duration:a.duration,amount:a.amount,address:addressAllowed?a.address:undefined};
  };
  base.applications=e.applications.filter(visible).map(appProjection);
  base.myApplications=e.applications.filter(a=>a.userId===user?.id).map(appProjection);
  base.receipts=e.receipts;
  if(manager){base.audit=(await env.DB.prepare('SELECT action,version,created_at FROM audit WHERE event_id=? ORDER BY version DESC LIMIT 50').bind(e.id).all()).results;}
  return base;
}
export interface TickStats {dueScanned:number;attempted:number;settled:number;failed:number;budgetExhausted:boolean;phaseError:string|null}
export async function tick(env:Env,budget?:CronBudget):Promise<TickStats>{
  const bounded=budget?.env(env,'tick')??env;
  const now=Date.now();
  const stats:TickStats={dueScanned:0,attempted:0,settled:0,failed:0,budgetExhausted:false,phaseError:null};
  let rows:{results:{id:string}[]};
  try{rows=await bounded.DB.prepare('SELECT id FROM activities WHERE next_due<=? ORDER BY next_due LIMIT 20').bind(now).all<{id:string}>();stats.dueScanned=rows.results.length;}
  catch(error){if(error instanceof CronBudgetExceeded)stats.budgetExhausted=true;else{stats.phaseError='activity_scan_failed';console.error('activity_scan_failed');}return stats;}
  for(const row of rows.results){
    try{budget?.takeWork('tick');stats.attempted++;await advance(bounded,row.id);stats.settled++;}
    catch(error){if(error instanceof CronBudgetExceeded){stats.budgetExhausted=true;break;}stats.failed++;console.error('activity_reconcile_failed');}
  }
  try{await bounded.DB.prepare('DELETE FROM ai_proposals WHERE expires_at<?').bind(now-86400000).run();}
  catch(error){if(error instanceof CronBudgetExceeded)stats.budgetExhausted=true;else{stats.phaseError='ai_cleanup_failed';console.error('ai_cleanup_failed');}}
  return stats;
}
