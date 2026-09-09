import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {execute,insertActivity,load,advance} from '../worker/store';
import type {Env,Rules,User} from '../worker/types';
let mf:Miniflare,env:Env;
const user=(id:string):User=>({id,email:`${id}@test.invalid`,nickname:id,publicNickname:false});
const base=():Rules=>{const t=Date.now();return {minPeople:3,maxPeople:3,waitlist:true,recruitmentDeadline:t+3600000,startsAt:t+7200000,endsAt:t+10800000,registrationDeadline:t+6900000,promotionDeadline:t+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:true,continuousCohosts:true,continuousHosts:true,addressVisibility:'participants'};};
beforeAll(async()=>{mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-09-05'}));const DB=await mf.getD1Database('DB');env={DB:DB as unknown as D1Database,APP_ENV:'test',ASSETS:{} as Fetcher};for(const f of ['0001_events.sql','0002_identity.sql','0004_tags.sql'])for(const s of readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8').split(';').filter(s=>s.trim()))await DB.prepare(s).run();});
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{for(const table of ['activities','audit','outbox','users','tags'])await env.DB.prepare(`DELETE FROM ${table}`).run();});
async function published(){const e=await insertActivity(env,{title:'测试',city:'Amsterdam',description:'',rules:base()},user('owner'));return execute(env,e.id,{action:'publish'},user('owner'),'pub');}

it('100用户下20人携同版本报名全部成功，3席位和17候补',async()=>{
 await env.DB.batch(Array.from({length:100},(_,i)=>env.DB.prepare('INSERT INTO users(id,email,nickname) VALUES(?,?,?)').bind('u'+i,'u'+i+'@test.invalid','用户'+i)));
 const e=await published(),started=performance.now();
 const budgets=Array.from({length:20},()=>({queries:0,attempts:0}));
 const results=await Promise.allSettled(Array.from({length:20},(_,i)=>{
   // Separate bindings simulate requests in distinct isolates without advance() coalescing.
   const DB={prepare(sql:string){budgets[i].queries++;if(sql.startsWith('UPDATE activities'))budgets[i].attempts++;return env.DB.prepare(sql);},batch(statements:D1PreparedStatement[]){return env.DB.batch(statements);}} as unknown as D1Database;
   return execute({...env,DB},e.id,{action:'join'},user('u'+i),'load-join-'+i,e.version);
 }));
 const success=results.filter(r=>r.status==='fulfilled').length,conflicts=results.filter(r=>r.status==='rejected'&&r.reason.status===409).length;
 console.log(JSON.stringify({scenario:'same_activity_same_version',success,conflicts,totalMs:Math.round(performance.now()-started)}));
 console.log(JSON.stringify({scenario:'per_request_d1_budget',budgets}));
 expect(success).toBe(20);expect(conflicts).toBe(0);
 expect(Math.max(...budgets.map(b=>b.queries))).toBeLessThanOrEqual(40);
 const audit=await env.DB.prepare("SELECT count(*) n FROM audit WHERE event_id=? AND action='join'").bind(e.id).first<{n:number}>();expect(audit!.n).toBe(20);
 const final=await load(env,e.id);expect(final.participants.filter(p=>p.status==='joined')).toHaveLength(3);expect(final.participants.filter(p=>p.status==='waitlisted')).toHaveLength(17);
 const startedRead=performance.now();await Promise.all(Array.from({length:100},()=>advance(env,e.id)));console.log(JSON.stringify({scenario:'100_concurrent_reads',totalMs:Math.round(performance.now()-startedRead)}));
},20000);
it('20人操作不同活动可独立成功',async()=>{const events=[];for(let i=0;i<20;i++)events.push(await published());const started=performance.now();const results=await Promise.allSettled(events.map((e,i)=>execute(env,e.id,{action:'join'},user('u'+i),'independent-'+i,e.version)));console.log(JSON.stringify({scenario:'20_independent_activities',success:results.filter(r=>r.status==='fulfilled').length,totalMs:Math.round(performance.now()-started)}));expect(results.every(r=>r.status==='fulfilled')).toBe(true);},20000);

it('同一幂等键并发重试只记一次报名和审计',async()=>{
 const e=await published();
 await Promise.all(Array.from({length:20},()=>execute(env,e.id,{action:'join',registrationMessage:'一次'},user('a'),'same-key',e.version)));
 const current=await load(env,e.id);expect(current.version).toBe(e.version+1);expect(current.participants).toHaveLength(1);
 expect((await env.DB.prepare("SELECT count(*) n FROM audit WHERE event_id=? AND action='join'").bind(e.id).first<{n:number}>())!.n).toBe(1);
 expect((await env.DB.prepare('SELECT count(*) n FROM outbox').first<{n:number}>())!.n).toBe(0);
});

it('同用户不同报名意图仅一个成功，旧报名不能覆盖新留言或重新加入',async()=>{
 const e=await published();
 const results=await Promise.allSettled(['甲','乙'].map((message,i)=>execute(env,e.id,{action:'join',registrationMessage:message},user('a'),'intent-'+i,e.version)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const joined=await load(env,e.id);
 await expect(execute(env,e.id,{action:'join',registrationMessage:'旧留言'},user('a'),'old-message',e.version)).rejects.toMatchObject({status:409});
 expect((await load(env,e.id)).participants[0].registrationMessage).toBe(joined.participants[0].registrationMessage);
 await execute(env,e.id,{action:'leave'},user('a'),'leave',joined.version);
 await expect(execute(env,e.id,{action:'join'},user('a'),'old-rejoin',e.version)).rejects.toMatchObject({status:409});
 expect((await load(env,e.id)).participants[0].status).toBe('left');
});

it('已有参与者操作和管理操作继续要求准确版本',async()=>{
 const e=await published();const joined=await execute(env,e.id,{action:'join'},user('a'),'join-a',e.version);
 await execute(env,e.id,{action:'join'},user('b'),'join-b',e.version);
 for(const action of ['join','leave'])await expect(execute(env,e.id,{action},user('a'),'stale-'+action,joined.version)).rejects.toMatchObject({status:409});
 await expect(execute(env,e.id,{action:'cancel',reason:'旧决定'},user('owner'),'stale-cancel',joined.version)).rejects.toMatchObject({status:409});
 const latest=await load(env,e.id);await execute(env,e.id,{action:'describe',description:'更新介绍'},user('owner'),'describe',latest.version);
 await expect(execute(env,e.id,{action:'join'},user('c'),'after-decision',latest.version)).rejects.toMatchObject({status:409});
});

it('最终时段变化阻止旧页面首次报名',async()=>{
 const rules=base();rules.timeSlots=[{id:'first',startsAt:rules.startsAt,endsAt:rules.endsAt},{id:'second',startsAt:rules.startsAt+3600000,endsAt:rules.endsAt+3600000}];
 let e=await insertActivity(env,{title:'选时间',city:'Amsterdam',rules},user('owner'));e=await execute(env,e.id,{action:'publish'},user('owner'),'publish');
 await execute(env,e.id,{action:'select_time',slotId:'first'},user('owner'),'select',e.version);
 await expect(execute(env,e.id,{action:'join',availableSlotIds:['first']},user('a'),'old-time',e.version)).rejects.toMatchObject({status:409});
});

it('重放仍校验报名截止，取消活动不接受旧报名',async()=>{
 const e=await published();for(const id of ['a','b','c'])await execute(env,e.id,{action:'join'},user(id),'join-'+id,e.version);
 // Confirm first so registration cutoff is tested independently of recruitment failure.
 const confirmed=await advance(env,e.id,()=>e.rules.recruitmentDeadline);
 await execute(env,e.id,{action:'join'},user('d'),'join-d',confirmed.version,()=>e.rules.recruitmentDeadline+1);
 await expect(execute(env,e.id,{action:'join'},user('late'),'late',confirmed.version,()=>e.rules.registrationDeadline)).rejects.toMatchObject({status:409});
 const current=await load(env,e.id);await execute(env,e.id,{action:'cancel',reason:'取消活动'},user('owner'),'cancel',current.version);
 await expect(execute(env,e.id,{action:'join'},user('new'),'after-cancel',current.version)).rejects.toMatchObject({status:409});
 expect((await load(env,e.id)).participants.some(p=>p.userId==='late'||p.userId==='new')).toBe(false);
});

it('审计缺失或无效版本不会放宽冲突',async()=>{
 const e=await published();await execute(env,e.id,{action:'join'},user('a'),'join-a',e.version);
 await env.DB.prepare("DELETE FROM audit WHERE event_id=? AND action='join'").bind(e.id).run();
 for(const version of [e.version,-1,0.5,NaN,999])await expect(execute(env,e.id,{action:'join'},user('b'),'invalid-version',version)).rejects.toMatchObject({status:409});
});
