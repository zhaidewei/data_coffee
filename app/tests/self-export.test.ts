import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index';
import {createActivity} from '../worker/engine';
import {encodeActivityDocument} from '../worker/activity-schema';
import {hash} from '../worker/auth';
import type {Env,Rules} from '../worker/types';

let mf:Miniflare,env:Env;
const now=Date.parse('2026-09-09T08:00:00Z'),credentialExpires=Date.now()+86400000,rawToken='dcf_'+'a'.repeat(64);
const rules:Rules={minPeople:3,maxPeople:8,waitlist:true,recruitmentDeadline:now+3600000,startsAt:now+7200000,endsAt:now+10800000,registrationDeadline:now+6900000,promotionDeadline:now+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:false,continuousCohosts:false,continuousHosts:true,addressVisibility:'participants'};

beforeAll(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({name:'self-export',modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-05',d1Databases:{DB:'self-export-test'}}));
  const DB=await mf.getD1Database('DB') as unknown as D1Database;
  for(const file of ['0001_events.sql','0002_identity.sql','0003_personal_tokens.sql','0006_mail_digest.sql','0008_outbox_notice_kind.sql'])for(const sql of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
  env={DB,ASSETS:{} as Fetcher,APP_ENV:'test'};
});
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{for(const table of ['activities','audit','outbox','ai_proposals','personal_tokens','auth_sessions','users'])await env.DB.prepare(`DELETE FROM ${table}`).run();});

async function seed(){
  await env.DB.prepare("INSERT INTO users(id,email,nickname,public_nickname) VALUES ('mine','mine@example.com','我',1),('other','other@example.com','他人',0)").run();
  await env.DB.prepare('INSERT INTO personal_tokens(id,user_id,name,scope,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').bind('token','mine','导出','read',await hash(rawToken),now,credentialExpires).run();
  const activity=createActivity({title:'隐私边界测试',city:'Amsterdam',description:'活动介绍',rules},'mine',now,'event');
  activity.participants=[
    {userId:'mine',status:'joined',appliedAt:now,order:1,registrationMessage:'我的留言'},
    {userId:'other',status:'joined',appliedAt:now+1,order:2,registrationMessage:'他人的秘密留言',registrationReply:'我写给他的回复',registrationRepliedAt:now+2,registrationRepliedBy:'mine'},
  ];
  activity.applications=[
    {id:'mine-app',userId:'mine',kind:'venue',title:'我的场地',detail:'我的联系方式',status:'approved',reviewedBy:'other',updatedAt:now},
    {id:'other-app',userId:'other',kind:'venue',title:'他人场地',detail:'他人的联系方式',status:'pending',updatedAt:now},
    {id:'reviewed-app',userId:'other',kind:'material',title:'他人物资',detail:'他人的更多信息',status:'rejected',reason:'我写的审核说明',reviewedBy:'mine',updatedAt:now+3},
  ];
  activity.processed=[{key:'mine-key',userId:'mine'},{key:'other-key',userId:'other'}];
  const joined=createActivity({title:'我参加的活动',city:'Delft',description:'公开介绍',rules},'other',now+10,'joined-event');
  joined.participants=[{userId:'mine',status:'joined',appliedAt:now+11,order:1,registrationMessage:'我给别人的留言',registrationReply:'别人写给我的回复',registrationRepliedAt:now+12,registrationRepliedBy:'other'}];
  await env.DB.batch([
    env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES (?,?,?,?,?,?)').bind(activity.id,activity.version,encodeActivityDocument(activity),'commit',null,activity.createdAt),
    env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES (?,?,?,?,?,?)').bind(joined.id,joined.version,encodeActivityDocument(joined),'joined-commit',null,joined.createdAt),
    env.DB.prepare("INSERT INTO audit(id,event_id,actor_id,action,version,created_at) VALUES ('mine-audit','event','mine','create',0,?),('other-audit','event','other','join',1,?),('mine-join','joined-event','mine','join',0,?)").bind(now,now+1,now+11),
    env.DB.prepare("INSERT INTO outbox(id,user_id,subject,body,created_at,kind,priority) VALUES ('notice','mine','我的通知','只属于我的通知',?,'legacy_unknown',0)").bind(now),
    env.DB.prepare("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES ('private-session-hash','mine',?)").bind(credentialExpires),
    env.DB.prepare("INSERT INTO ai_proposals(id,user_id,event_id,action,version,expires_at,created_at) VALUES ('proposal','mine','event','join',0,?,?)").bind(now+3600000,now),
  ]);
}

it('认证用户可导出本人完整关系，且不会导出凭证和其他成员隐私',async()=>{
  await seed();
  const response=await worker.fetch(new Request('http://localhost/api/me/export',{headers:{Authorization:`Bearer ${rawToken}`}}),env);
  expect(response.status).toBe(200);
  const data=await response.json() as any,text=JSON.stringify(data);
  expect(data).toMatchObject({schemaVersion:1,profile:{id:'mine',email:'mine@example.com'}});
  expect(data.activities[0]).toMatchObject({id:'event',ownerId:'mine',participants:[{userId:'mine',registrationMessage:'我的留言'}],applications:[{id:'mine-app'}],processed:[{key:'mine-key'}]});
  expect(data.activities[0].applications[0]).not.toHaveProperty('reviewedBy');
  expect(data.activities[0].authoredRegistrationReplies).toEqual([{reply:'我写给他的回复',repliedAt:now+2}]);
  expect(data.activities[0].authoredApplicationReviews).toEqual([{applicationId:'reviewed-app',kind:'material',status:'rejected',reason:'我写的审核说明',reviewedAt:now+3}]);
  expect(data.activities[1]).toMatchObject({id:'joined-event',participants:[{userId:'mine',registrationMessage:'我给别人的留言',registrationReply:'别人写给我的回复'}]});
  expect(data.activities[1]).not.toHaveProperty('ownerId');expect(data.activities[1].participants[0]).not.toHaveProperty('registrationRepliedBy');
  expect(data.audit).toHaveLength(2);expect(data.notifications).toHaveLength(1);expect(data.tokens[0]).toMatchObject({id:'token',scope:'read'});expect(data.sessions).toEqual([{expiresAt:credentialExpires}]);expect(data.aiProposals).toHaveLength(1);
  for(const secret of [rawToken,await hash(rawToken),'private-session-hash','他人的秘密留言','他人的联系方式','他人的更多信息','other-key'])expect(text).not.toContain(secret);
});

it('匿名用户不能导出数据',async()=>{
  const response=await worker.fetch(new Request('http://localhost/api/me/export'),env);
  expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'请先验证邮箱登录'});
});
