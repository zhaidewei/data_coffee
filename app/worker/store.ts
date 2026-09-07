import type {Activity, Command, Env, Notice, User} from './types';
import {applyCommand, conditions, createActivity, DomainError, fail, isManager, joined, nextDue, reconcile} from './engine';

export async function load(env:Env,id:string):Promise<Activity> {
  const row=await env.DB.prepare('SELECT document FROM activities WHERE id=?').bind(id).first<{document:string}>();
  if(!row)return fail('活动不存在',404);
  return JSON.parse(row.document);
}
async function commit(env:Env,old:Activity,e:Activity,notices:Notice[],actor:string,action:string,now:number):Promise<boolean> {
  const marker=crypto.randomUUID();e.version=old.version+1;
  const sql=[env.DB.prepare('UPDATE activities SET version=?,document=?,commit_id=?,next_due=? WHERE id=? AND version=?').bind(e.version,JSON.stringify(e),marker,nextDue(e),e.id,old.version),
    env.DB.prepare('INSERT INTO audit(id,event_id,actor_id,action,version,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM activities WHERE id=? AND commit_id=?)').bind(marker,e.id,actor,action,e.version,now,e.id,marker)];
  for(let i=0;i<notices.length;i++){
    const n=notices[i];
    const link=env.APP_URL?`\n\n活动详情：${env.APP_URL}/#event/${e.id}`:'';
    sql.push(env.DB.prepare('INSERT INTO outbox(id,user_id,subject,body,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM activities WHERE id=? AND commit_id=?)').bind(`${marker}:${i}`,n.userId,n.subject,n.text+link,now,e.id,marker));
  }
  const result=await env.DB.batch(sql);return (result[0].meta.changes??0)>0;
}
export async function advance(env:Env,id:string,clock=Date.now):Promise<Activity> {
  for(let retry=0;retry<12;retry++){
    const old=await load(env,id);const e=structuredClone(old);const out:Notice[]=[];const now=clock();
    reconcile(e,now,out);
    if(JSON.stringify(e)===JSON.stringify(old))return old;
    if(await commit(env,old,e,out,'system','reconcile',now))return e;
  }
  return fail('活动正在更新，请稍后刷新',409);
}
export async function execute(env:Env,id:string,cmd:Command,user:User,key:string,version?:number,clock=Date.now):Promise<Activity>{
  if(!key||key.length>100||!/^[A-Za-z0-9:_-]+$/.test(key))fail('需要有效的操作幂等标识');
  for(let retry=0;retry<12;retry++){
    const old=await advance(env,id,clock);
    if(old.processed.some(p=>p.key===key&&p.userId===user.id))return old;
    if(version!==undefined&&version!==old.version)fail('活动状态已变化，请刷新后重新确认',409);
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
    env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(e.id,0,JSON.stringify(e),crypto.randomUUID(),null,now),
    env.DB.prepare('INSERT INTO audit(id,event_id,actor_id,action,version,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),e.id,user.id,'create',0,now)
  ]);return e;
}
export async function project(env:Env,e:Activity,user:User|null,summary=false):Promise<Record<string,unknown>>{
  const manager=!!user&&isManager(e,user.id);const mine=e.participants.find(p=>p.userId===user?.id)??null;
  if(e.status==='draft'&&e.ownerId!==user?.id)fail('活动不存在',404);
  const addressAllowed=e.rules.addressVisibility==='public'||manager||mine?.status==='joined';
  const base:Record<string,unknown>={id:e.id,title:e.title,city:e.city,description:e.description,rules:e.rules,status:e.status,version:e.version,createdAt:e.createdAt,publishedAt:e.publishedAt,reason:e.reason,counts:{joined:joined(e).length,waitlisted:e.participants.filter(p=>p.status==='waitlisted').length},conditions:conditions(e),repairs:e.repairs,canManage:manager,isOwner:user?.id===e.ownerId};
  if(summary)return base;
  const preferenceCounts=(key:'timePreference'|'placePreference')=>[...e.participants.filter(p=>p.status!=='left'&&p[key]).reduce((m,p)=>m.set(p[key]!,1+(m.get(p[key]!)??0)),new Map<string,number>())].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,8).map(([label,count])=>({label,count}));
  base.preferenceSummary={times:preferenceCounts('timePreference'),places:preferenceCounts('placePreference')};
  const ids=[...new Set(e.participants.filter(p=>p.status!=='left').map(p=>p.userId))];
  const names=new Map<string,{nickname:string;public_nickname:number}>();
  // D1 variable limit is 100; keep batches below it.
  for(let i=0;i<ids.length;i+=80){const batch=ids.slice(i,i+80);const res=await env.DB.prepare(`SELECT id,nickname,public_nickname FROM users WHERE id IN (${batch.map(()=>'?').join(',')})`).bind(...batch).all<{id:string;nickname:string;public_nickname:number}>();for(const n of res.results)names.set(n.id,n);}
  base.participants=e.participants.filter(p=>p.status!=='left').map(p=>{const n=names.get(p.userId);return {nickname:n&&(n.public_nickname||manager||user?.id===p.userId)?n.nickname:'匿名成员',status:p.status,isMe:user?.id===p.userId};});
  base.myParticipation=mine?{status:mine.status,appliedAt:mine.appliedAt,timePreference:mine.timePreference,placePreference:mine.placePreference,position:mine.status==='waitlisted'?e.participants.filter(p=>p.status==='waitlisted'&&p.order<=mine.order).length:undefined}:null;
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
export async function tick(env:Env){
  const rows=await env.DB.prepare('SELECT id FROM activities WHERE next_due<=? ORDER BY next_due LIMIT 20').bind(Date.now()).all<{id:string}>();
  for(const row of rows.results){try{await advance(env,row.id);}catch{console.error('activity_reconcile_failed');}}
  await env.DB.prepare('DELETE FROM ai_proposals WHERE expires_at<?').bind(Date.now()-86400000).run();
}
