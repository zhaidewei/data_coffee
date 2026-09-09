import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {deleteDraft,execute,insertActivity,load,project,advance} from '../worker/store';
import type {Env,Rules,User} from '../worker/types';
import worker from '../worker/index';
let mf:Miniflare,env:Env;
const user=(id:string):User=>({id,email:`${id}@test.invalid`,nickname:id,publicNickname:false});
const base=():Rules=>{const t=Date.now();return {minPeople:3,maxPeople:3,waitlist:true,recruitmentDeadline:t+3600000,startsAt:t+7200000,endsAt:t+10800000,registrationDeadline:t+6900000,promotionDeadline:t+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:true,continuousCohosts:true,continuousHosts:true,addressVisibility:'participants'};};
beforeAll(async()=>{mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-09-05'}));const DB=await mf.getD1Database('DB');env={DB:DB as unknown as D1Database,APP_ENV:'test',ASSETS:{} as Fetcher};for(const f of ['0001_events.sql','0002_identity.sql','0006_mail_digest.sql','0008_outbox_notice_kind.sql','0004_tags.sql'])for(const s of readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8').split(';').filter(s=>s.trim()))await DB.prepare(s).run();});
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{for(const table of ['activities','audit','outbox','users','tags'])await env.DB.prepare(`DELETE FROM ${table}`).run();});
async function published(){const e=await insertActivity(env,{title:'测试',city:'Amsterdam',description:'',rules:base()},user('owner'));return execute(env,e.id,{action:'publish'},user('owner'),'pub');}
describe('D1事务与公开投影',()=>{
 it('其他用户的200个新草稿不会挤掉公开活动列表',async()=>{
   const e=await published();
   const draft=await insertActivity(env,{title:'私有草稿',city:'Amsterdam',rules:base()},user('another'));
   await env.DB.batch(Array.from({length:199},(_,i)=>{
     const id=`private-draft-${i}`;
     return env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(id,0,JSON.stringify({...draft,id}),id,null,draft.createdAt+i+1);
   }));
   const response=await worker.fetch(new Request('https://test.invalid/api/events'),env);
   expect(response.status).toBe(200);
   const data=await response.json() as {events:{id:string}[]};
   expect(data.events.map(item=>item.id)).toEqual([e.id]);
 });
 it('并发抢名额不超额，幂等不重复审计',async()=>{const e=await published();await Promise.all(Array.from({length:8},(_,i)=>execute(env,e.id,{action:'join'},user(`u${i}`),`join-${i}`)));const after=await load(env,e.id);expect(after.participants.filter(p=>p.status==='joined')).toHaveLength(3);expect(after.participants.filter(p=>p.status==='waitlisted')).toHaveLength(5);await execute(env,e.id,{action:'join'},user('u0'),'join-0',0);expect((await load(env,e.id)).version).toBe(after.version);const audit=await env.DB.prepare('SELECT count(*) n FROM audit WHERE event_id=?').bind(e.id).first<{n:number}>();expect(audit!.n).toBe(10);});
 it('并发退出只向每位入选者通知一次',async()=>{const e=await published();for(const id of ['a','b','support','c','d'])await execute(env,e.id,{action:'join'},user(id),`j${id}`);await Promise.all(['a','b'].map(id=>execute(env,e.id,{action:'leave'},user(id),`l${id}`)));const out=await env.DB.prepare("SELECT user_id,kind,priority,deliver_before FROM outbox WHERE kind='promotion_confirmed'").all<{user_id:string}>();expect(out.results.map(r=>r.user_id).sort()).toEqual(['c','d']);expect(out.results).toEqual(expect.arrayContaining([expect.objectContaining({kind:'promotion_confirmed',priority:0,deliver_before:null})]));});
 it('晚报名不能改变截止判定',async()=>{const e=await published();await expect(execute(env,e.id,{action:'join'},user('late'),'late',undefined,()=>e.rules.recruitmentDeadline+1)).rejects.toThrow();expect((await load(env,e.id)).status).toBe('cancelled');expect((await load(env,e.id)).participants).toHaveLength(0);});
 it('私有地址、邮箱和申请备注不公开',async()=>{const e=await published();await env.DB.prepare('INSERT INTO users(id,email,nickname,public_nickname) VALUES(?,?,?,?)').bind('a','private@test.invalid','私人昵称',0).run();await execute(env,e.id,{action:'join'},user('a'),'ja');let s=await execute(env,e.id,{action:'apply',kind:'venue',title:'场地',detail:'private@test.invalid',address:'SECRET ADDRESS',capacity:3},user('a'),'venue');s=await execute(env,e.id,{action:'review',applicationId:s.applications[0].id,approved:true},user('owner'),'approve');const anon=JSON.stringify(await project(env,s,null));expect(anon).not.toContain('SECRET ADDRESS');expect(anon).not.toContain('private@test.invalid');expect(anon).not.toContain('私人昵称');expect(JSON.stringify(await project(env,s,user('a')))).toContain('SECRET ADDRESS');});
 it('报名留言和回复公开，但成员标识只向发起人投影',async()=>{let e=await published();await env.DB.prepare('INSERT INTO users(id,email,nickname,public_nickname) VALUES(?,?,?,?)').bind('a','a@test.invalid','成员甲',1).run();e=await execute(env,e.id,{action:'join',registrationMessage:'可以带朋友吗？'},user('a'),'join-message');e=await execute(env,e.id,{action:'reply_registration',participantId:'a',reply:'请朋友本人报名。'},user('owner'),'reply-message');const publicView=await project(env,e,null) as any;expect(publicView.participants[0]).toMatchObject({nickname:'成员甲',registrationMessage:'可以带朋友吗？',registrationReply:'请朋友本人报名。'});expect(publicView.participants[0].participantId).toBeUndefined();const ownerView=await project(env,e,user('owner')) as any;expect(ownerView.participants[0].participantId).toBe('a');});
 it('草稿隔离且他人不可查看',async()=>{const e=await published();const draft=await insertActivity(env,{title:'草稿',city:'Rotterdam',description:'',rules:base()},user('another'));await execute(env,e.id,{action:'join'},user('a'),'join');expect((await load(env,draft.id)).participants).toHaveLength(0);await expect(project(env,draft,user('a'))).rejects.toThrow();});
 it('偏好只按汇总公开并向本人回读',async()=>{let e=await published();e=await execute(env,e.id,{action:'join',timePreference:'周六下午',placePreference:'Amsterdam'},user('a'),'pref-a');e=await execute(env,e.id,{action:'join',timePreference:'周六下午',placePreference:'Utrecht'},user('b'),'pref-b');const anon=await project(env,e,null);expect(anon.preferenceSummary).toMatchObject({times:[{label:'周六下午',count:2}],places:[{label:'Amsterdam',count:1},{label:'Utrecht',count:1}]});expect(JSON.stringify(anon.participants)).not.toContain('周六下午');const mine=await project(env,e,user('a'));expect(mine.myParticipation).toMatchObject({timePreference:'周六下午',placePreference:'Amsterdam'});});
});

it('100次并发读取只提交一次到期结算与通知',async()=>{let e=await published();for(const id of ['a','b','c'])e=await execute(env,e.id,{action:'join'},user(id),'join-'+id);const before=e.version;const results=await Promise.all(Array.from({length:100},()=>advance(env,e.id,()=>e.rules.recruitmentDeadline)));expect(results.every(r=>r.status==='confirmed'&&r.version===before+1)).toBe(true);const audit=await env.DB.prepare("SELECT count(*) n FROM audit WHERE event_id=? AND action='reconcile'").bind(e.id).first<{n:number}>();expect(audit!.n).toBe(1);const out=await env.DB.prepare("SELECT user_id FROM outbox WHERE subject='活动已成团'").all<{user_id:string}>();expect(out.results.map(r=>r.user_id).sort()).toEqual(['a','b','c','owner']);});

// Every database below is an isolated Miniflare D1 database.
describe('删除草稿',()=>{
 const draft=()=>insertActivity(env,{title:'待删除草稿',city:'Amsterdam',rules:base()},user('owner'));
 it('仅owner可删除，保留删除审计且重复请求404',async()=>{
  const e=await draft();
  await expect(deleteDraft(env,e.id,user('other'),e.version)).rejects.toMatchObject({status:404});
  await deleteDraft(env,e.id,user('owner'),e.version);
  await expect(load(env,e.id)).rejects.toMatchObject({status:404});
  await expect(deleteDraft(env,e.id,user('owner'),e.version)).rejects.toMatchObject({status:404});
  const audit=await env.DB.prepare("SELECT action,version FROM audit WHERE event_id=? ORDER BY version").bind(e.id).all();
  expect(audit.results).toEqual([{action:'create',version:0},{action:'delete_draft',version:1}]);
 });
 it('拒绝无效和旧版本，发布后不能删除',async()=>{
  const e=await draft();
  for(const v of [-1,0.5,NaN,1])await expect(deleteDraft(env,e.id,user('owner'),v)).rejects.toMatchObject({status:409});
  const published=await execute(env,e.id,{action:'publish'},user('owner'),'publish',e.version);
  await expect(deleteDraft(env,e.id,user('owner'),published.version)).rejects.toMatchObject({status:409});
  expect((await load(env,e.id)).status).toBe('recruiting');
 });
 it('并发发布与删除只有一个成功，审计与最终状态一致',async()=>{
  const e=await draft();
  const result=await Promise.allSettled([deleteDraft(env,e.id,user('owner'),e.version),execute(env,e.id,{action:'publish'},user('owner'),'publish',e.version)]);
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const actions=await env.DB.prepare('SELECT action FROM audit WHERE event_id=? AND version=1').bind(e.id).all<{action:string}>();
  expect(actions.results).toHaveLength(1);
  if(result[0].status==='fulfilled'){expect(actions.results[0].action).toBe('delete_draft');await expect(load(env,e.id)).rejects.toMatchObject({status:404});}
  else{expect(actions.results[0].action).toBe('publish');expect((await load(env,e.id)).status).toBe('recruiting');}
 });
});

it('发布人昵称遵循公开设置，不返回邮箱',async()=>{
 const e=await published();
 await env.DB.prepare('INSERT INTO users(id,email,nickname,public_nickname) VALUES(?,?,?,?)').bind('owner','owner-private@example.com','咖啡发起人',0).run();
 expect((await project(env,e,null)).publisher).toEqual({nickname:'匿名成员'});
 expect((await project(env,e,user('owner'))).publisher).toEqual({nickname:'咖啡发起人'});
 await env.DB.prepare('UPDATE users SET public_nickname=1 WHERE id=?').bind('owner').run();
 const view=await project(env,e,null);expect(view.publisher).toEqual({nickname:'咖啡发起人'});expect(JSON.stringify(view)).not.toContain('owner-private@example.com');
});

 it('标签跨账号复用、去重并随公开活动返回',async()=>{
  let e=await insertActivity(env,{title:'标签测试',city:'Amsterdam',rules:base(),tags:[' SQL ','ＡＩ']},user('owner'));
  await insertActivity(env,{title:'另一场',city:'Amsterdam',rules:base(),tags:['sql','咖啡']},user('another'));
  const response=await worker.fetch(new Request('https://test.invalid/api/tags?q=sql'),env);
  expect(await response.json()).toEqual({tags:['SQL']});
  e=await execute(env,e.id,{action:'edit',title:e.title,city:e.city,rules:e.rules,tags:['数据平台']},user('owner'),'edit-tags');
  expect(e.tags).toEqual(['数据平台']);
  e=await execute(env,e.id,{action:'publish'},user('owner'),'publish-tags');
  expect((await project(env,e,null)).tags).toEqual(['数据平台']);
  expect((await env.DB.prepare('SELECT label FROM tags').all()).results).toHaveLength(4);
 });
it('候补确认期限从领域状态原值写入outbox',async()=>{
 let e=await insertActivity(env,{title:'期限语义',city:'Amsterdam',rules:{...base(),promotionLeadHours:1,registrationLeadHours:1}},user('owner'));
 e=await execute(env,e.id,{action:'publish'},user('owner'),'pub-deadline');
 for(const id of ['a','b','c','d'])e=await execute(env,e.id,{action:'join'},user(id),`deadline-${id}`);
 e=await execute(env,e.id,{action:'leave'},user('a'),'deadline-leave');
 const row=await env.DB.prepare("SELECT kind,priority,deliver_before FROM outbox WHERE kind='promotion_offer'").first();
 expect(row).toEqual({kind:'promotion_offer',priority:0,deliver_before:e.participants.find(p=>p.userId==='d')!.promotionOfferUntil});
});
