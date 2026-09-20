import {beforeAll,afterAll,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {execute,insertActivity,load} from '../worker/store';
import {deleteMessage,listMessages,postMessage} from '../worker/messages';
import type {Env,Rules,User} from '../worker/types';

let mf:Miniflare,env:Env;
const user=(id:string,publicNickname=false):User=>({id,email:`${id}@test.invalid`,nickname:id,publicNickname});
beforeAll(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-09-05'}));
  const DB=await mf.getD1Database('DB');env={DB:DB as unknown as D1Database,APP_ENV:'test',ASSETS:{} as Fetcher};
  for(const file of ['0001_events.sql','0002_identity.sql','0006_mail_digest.sql','0008_outbox_notice_kind.sql','0009_organizer_mail.sql','0004_tags.sql','0010_event_messages.sql']){
    const source=readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8').replace(/--[^\n]*/g,'');
    for(const sql of source.split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
  }
});
afterAll(async()=>{await mf?.dispose();});
it('成员与候补可交流，访客不可见；重复发送不改活动版本，也不产生邮件',async()=>{
  const now=Date.now();
  const rules:Rules={minPeople:3,maxPeople:3,waitlist:true,recruitmentDeadline:now+3600000,startsAt:now+7200000,endsAt:now+10800000,registrationDeadline:now+6900000,promotionDeadline:now+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:true,continuousCohosts:true,continuousHosts:true,addressVisibility:'participants'};
  for(const u of [user('owner'),user('joined'),user('waiting')])await env.DB.prepare('INSERT INTO users(id,email,nickname,public_nickname) VALUES(?,?,?,?)').bind(u.id,u.email,u.nickname,Number(u.id==='joined')).run();
  let event=await insertActivity(env,{title:'成员交流',city:'Amsterdam',rules},user('owner'));
  event=await execute(env,event.id,{action:'publish'},user('owner'),'publish');
  event=await execute(env,event.id,{action:'join'},user('joined'),'join');
  event=await execute(env,event.id,{action:'join'},user('seat2'),'seat2');
  event=await execute(env,event.id,{action:'join'},user('seat3'),'seat3');
  event=await execute(env,event.id,{action:'join'},user('waiting'),'wait');
  const version=event.version;
  await expect(listMessages(env,event.id,user('stranger'),null)).rejects.toMatchObject({status:403});
  await expect(postMessage(env,event.id,user('stranger'),{body:'不该出现'},'stranger')).rejects.toMatchObject({status:403});
  const first=await postMessage(env,event.id,user('joined'),{body:'周六见'},'first');
  expect(await postMessage(env,event.id,user('joined'),{body:'周六见'},'first')).toEqual(first);
  await postMessage(env,event.id,user('waiting'),{body:'我在候补'},'waiting');
  const page=await listMessages(env,event.id,user('owner'),null);
  expect(page.messages).toHaveLength(2);
  expect(page.messages.map(m=>m.author)).toContain('匿名成员');
  expect(page.messages.map(m=>m.author)).toContain('joined');
  expect(JSON.stringify(page)).not.toContain('@test.invalid');
  expect((await load(env,event.id)).version).toBe(version);
  const outbox=await env.DB.prepare('SELECT count(*) AS n FROM outbox').first<{n:number}>();
  expect(outbox?.n).toBe(0);
  const second=await postMessage(env,event.id,user('joined'),{body:'接着补充集合方式'},'second');
  expect((await listMessages(env,event.id,user('joined'),null)).messages.find(m=>m.id===second.id)?.body).toBe('接着补充集合方式');
  await expect(deleteMessage(env,event.id,first.id,user('waiting'))).rejects.toMatchObject({status:404});
  await deleteMessage(env,event.id,first.id,user('owner'));
  expect((await listMessages(env,event.id,user('joined'),null)).messages.find(m=>m.id===first.id)?.body).toBeNull();
  await execute(env,event.id,{action:'leave'},user('waiting'),'leave');
  await expect(listMessages(env,event.id,user('waiting'),null)).rejects.toMatchObject({status:403});
});

it('成员在权限检查后退出，待写入留言不能越过退出状态',async()=>{
  const now=Date.now();
  const rules:Rules={minPeople:3,maxPeople:3,waitlist:true,recruitmentDeadline:now+3600000,startsAt:now+7200000,endsAt:now+10800000,registrationDeadline:now+6900000,promotionDeadline:now+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:true,continuousCohosts:true,continuousHosts:true,addressVisibility:'participants'};
  let event=await insertActivity(env,{title:'退出竞态',city:'Amsterdam',rules},user('owner'));
  event=await execute(env,event.id,{action:'publish'},user('owner'),'race-publish');
  await execute(env,event.id,{action:'join'},user('joined'),'race-join');
  let reached!:()=>void,release!:()=>void;
  const atQuery=new Promise<void>(resolve=>{reached=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const gatedDB=new Proxy(env.DB,{
    get(target,property){
      if(property!=='prepare')return Reflect.get(target,property,target);
      return (sql:string)=>{
        const statement=target.prepare(sql);
        if(!sql.startsWith('SELECT id FROM event_messages WHERE event_id='))return statement;
        return {bind:(...args:any[])=>{
          const bound=statement.bind(...args);
          return {first:async()=>{reached();await gate;return bound.first();}};
        }};
      };
    },
  }) as D1Database;
  const pending=postMessage({...env,DB:gatedDB},event.id,user('joined'),{body:'退出后不能发送'},'race-post');
  await atQuery;
  await execute(env,event.id,{action:'leave'},user('joined'),'race-leave');
  release();
  await expect(pending).rejects.toMatchObject({status:409});
  const row=await env.DB.prepare('SELECT count(*) AS n FROM event_messages WHERE event_id=?').bind(event.id).first<{n:number}>();
  expect(row?.n).toBe(0);
});
