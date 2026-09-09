import {beforeAll,afterAll,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {execute,insertActivity,load} from '../worker/store';
import {hash} from '../worker/auth';
import worker from '../worker/index';
import type {Env,Rules,User} from '../worker/types';
let mf:Miniflare,env:Env;
beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-09-05'}));
 const DB=await mf.getD1Database('DB');env={DB:DB as unknown as D1Database,APP_ENV:'test',ASSETS:{} as Fetcher};
 for(const f of ['0001_events.sql','0002_identity.sql','0004_tags.sql'])for(const sql of readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8').split(';').filter(s=>s.trim()))await DB.prepare(sql).run();
});
afterAll(async()=>{await mf?.dispose();});
it('真实 HTTP 入口携版本同时报名：20 人全部得到结果且重放不重复',async()=>{
 const now=Date.now();
 const rules:Rules={minPeople:3,maxPeople:3,waitlist:true,recruitmentDeadline:now+3600000,startsAt:now+7200000,endsAt:now+10800000,registrationDeadline:now+6900000,promotionDeadline:now+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:true,continuousCohosts:true,continuousHosts:true,addressVisibility:'participants'};
 const owner:User={id:'owner',email:'owner@test.invalid',nickname:'owner',publicNickname:false};
 const draft=await insertActivity(env,{title:'并发 HTTP 验收',city:'Amsterdam',description:'',rules},owner);
 const event=await execute(env,draft.id,{action:'publish'},owner,'publish',draft.version);
 const sessions=Array.from({length:20},(_,i)=>(i+1).toString(16).padStart(64,'0'));
 for(let i=0;i<sessions.length;i++)await env.DB.batch([
   env.DB.prepare('INSERT INTO users(id,email,nickname) VALUES(?,?,?)').bind('u'+i,`u${i}@test.invalid`,'成员'+i),
   env.DB.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(sessions[i]!),'u'+i,now+3600000)
 ]);
 const request=(i:number)=>worker.fetch(new Request(`https://test.invalid/api/events/${event.id}/actions`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:'dc_session='+sessions[i],'Idempotency-Key':'join-http-'+i},body:JSON.stringify({action:'join',version:event.version})}),env);
 const responses=await Promise.all(sessions.map((_,i)=>request(i)));
 expect(responses.map(r=>r.status)).toEqual(Array(20).fill(200));
 const final=await load(env,event.id);
 expect(final.participants.filter(p=>p.status==='joined')).toHaveLength(3);
 expect(final.participants.filter(p=>p.status==='waitlisted')).toHaveLength(17);
 const audit=await env.DB.prepare("SELECT count(*) AS n FROM audit WHERE event_id=? AND action='join'").bind(event.id).first<{n:number}>();
 expect(audit?.n).toBe(20);
 expect((await request(0)).status).toBe(200);
 expect((await load(env,event.id)).version).toBe(final.version);
});
