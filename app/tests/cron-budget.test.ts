import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index';
import {operations} from '../worker/operations';
import {CronBudget} from '../worker/cron-budget';
import {load,tick} from '../worker/store';
import type {Activity,Env} from '../worker/types';

let mf:Miniflare,env:Env;
beforeAll(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({name:'cron-budget',modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-05',d1Databases:{DB:'cron-budget-test'}}));
  const DB=await mf.getD1Database('DB') as unknown as D1Database;
  for(const file of ['0001_events.sql','0002_identity.sql','0006_mail_digest.sql','0008_outbox_notice_kind.sql'])for(const sql of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
  env={DB,ASSETS:{} as Fetcher,APP_ENV:'test',BREVO_API_KEY:'fake',EMAIL_FROM:'sender@example.com'};
});
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{for(const table of ['mail_payload','mail_dispatch','mail_daily_budget','outbox','users','activities','audit','ai_proposals'])await env.DB.prepare(`DELETE FROM ${table}`).run();});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
async function urgent(id='urgent'){
  const now=Date.now();
  await env.DB.prepare('INSERT OR IGNORE INTO users(id,email,nickname) VALUES (?,?,?)').bind('member','member@example.com','member').run();
  await env.DB.prepare('INSERT INTO outbox(id,user_id,subject,body,created_at,kind,priority,deliver_before) VALUES (?,?,?,?,?,?,?,?)').bind(id,'member','候补确认','请及时确认',now-30_000,'promotion_offer',0,now+60_000).run();
}
function failPrepare(match:(sql:string)=>boolean){
  let failed=false;
  return new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{if(!failed&&match(sql)){failed=true;throw new Error('injected_d1_failure');}return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
}
async function scheduled(DB:D1Database=env.DB){
  const logs:string[]=[];const log=vi.spyOn(console,'log').mockImplementation(value=>logs.push(String(value)));const error=vi.spyOn(console,'error').mockImplementation(()=>{});
  await worker.scheduled!({} as ScheduledController,{...env,DB},{} as ExecutionContext);
  const report=JSON.parse(logs.at(-1)!);log.mockRestore();error.mockRestore();return report;
}

it('同一轮大量到期活动仍保留邮件预算，并输出可核对的共享账本',async()=>{
  const now=Date.now();
  await env.DB.prepare('INSERT INTO users(id,email,nickname) VALUES (?,?,?)').bind('member','member@example.com','member').run();
  await env.DB.batch(Array.from({length:20},(_,i)=>env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(`broken-${i}`,0,'{',`seed-${i}`,now-60_000-i,now-120_000-i)));
  await env.DB.prepare('INSERT INTO outbox(id,user_id,subject,body,created_at,kind,priority,deliver_before) VALUES (?,?,?,?,?,?,?,?)').bind('urgent','member','候补确认','请及时确认',now-30_000,'promotion_offer',0,now+60_000).run();
  let statements=0;
  const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{statements++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const bodies:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{bodies.push(String(init.body));return new Response('{}',{status:201});}));
  const report=await scheduled(DB);
  expect(bodies).toHaveLength(1);
  expect((await env.DB.prepare("SELECT status FROM outbox WHERE id='urgent'").first())!.status).toBe('sent');
  expect(statements).toBeLessThanOrEqual(50);
  expect(report).toMatchObject({event:'cron_completed',activity:{attempted:8,failed:8,budgetExhausted:true},mail:{claimed:1,sent:1}});
  expect(report.budget.d1.used).toBeLessThanOrEqual(report.budget.d1.limit);
  expect(report.budget.work.used).toBeLessThanOrEqual(report.budget.work.limit);
  expect(report.budget.d1.mailReserve).toBe(20);
});

it.each([
  ['到期扫描', (sql:string)=>sql.includes('SELECT id FROM activities'), 'activity_scan_failed'],
  ['AI清理', (sql:string)=>sql.includes('DELETE FROM ai_proposals'), 'ai_cleanup_failed'],
])('%s失败不会跳过邮件，账本保留已执行阶段',async(_name,match,error)=>{
  await urgent();const bodies:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{bodies.push(String(init.body));return new Response('{}',{status:201});}));
  const report=await scheduled(failPrepare(match));
  expect(report.activity.phaseError).toBe(error);expect(report.mail.sent).toBe(1);expect(bodies).toHaveLength(1);
  expect(report.budget.d1.tick).toBeGreaterThan(0);expect(report.budget.d1.mail).toBeGreaterThan(0);
});

it('邮件领取失败仍输出部分账本，后续 invocation 可恢复',async()=>{
  await urgent();const fetcher=vi.fn(async()=>new Response('{}',{status:201}));vi.stubGlobal('fetch',fetcher);
  const failed=await scheduled(failPrepare(sql=>sql.includes("UPDATE outbox SET status='sending'")));
  expect(failed.mail).toMatchObject({claimed:0,sent:0,phaseError:'mail_drain_failed',d1Statements:1});
  expect(failed.budget.d1.mail).toBe(1);expect((await env.DB.prepare("SELECT status FROM outbox WHERE id='urgent'").first())!.status).toBe('pending');
  const recovered=await scheduled();
  expect(recovered.mail).toMatchObject({sent:1,phaseError:null});expect(fetcher).toHaveBeenCalledTimes(1);
});

it('邮件已发送后的最终清理失败不丢账本，下一轮不重复发送',async()=>{
  await urgent();const fetcher=vi.fn(async()=>new Response('{}',{status:201}));vi.stubGlobal('fetch',fetcher);
  const failed=await scheduled(failPrepare(sql=>sql.includes('DELETE FROM auth_sessions')));
  expect(failed.mail).toMatchObject({claimed:1,sent:1,phaseError:'mail_drain_failed'});
  expect(failed.budget.d1.mail).toBe(failed.mail.d1Statements);
  const recovered=await scheduled();
  expect(recovered.mail.phaseError).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
});

it('单个活动产生2001条通知时仍只占一条写入语句，且不会阻塞后续到期活动',async()=>{
  const now=Date.now();
  const activity=(id:string,participants:number,due:number):Activity=>({
    schemaVersion:1,id,ownerId:`${id}-owner`,title:id,city:'Amsterdam',description:'',status:'recruiting',version:0,createdAt:now-200_000,publishedAt:now-190_000,
    rules:{minPeople:100,maxPeople:100,waitlist:true,recruitmentDeadline:due,startsAt:now+3600_000,endsAt:now+7200_000,registrationDeadline:now+3600_000,promotionDeadline:now+3600_000,repairMinutes:10,venueRequired:true,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:true,continuousCohosts:true,continuousHosts:true,addressVisibility:'participants'},
    participants:Array.from({length:participants},(_,i)=>({userId:`${id}-member-${i}`,status:'joined',appliedAt:now-180_000+i,order:i+1})),applications:[],repairs:[],receipts:[],sequence:participants,processed:[],
  });
  const large=activity('large',2000,now-120_000),later=activity('later',0,now-60_000);
  await env.DB.batch([large,later].map(item=>env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(item.id,item.version,JSON.stringify(item),`seed-${item.id}`,item.rules.recruitmentDeadline,item.createdAt)));
  let statements=0;const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{statements++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const stats=await tick({...env,DB},new CronBudget());
  expect(stats).toMatchObject({dueScanned:2,attempted:2,settled:2,failed:0,budgetExhausted:false});
  expect(statements).toBe(10);
  expect((await load(env,'large')).status).toBe('cancelled');
  expect((await load(env,'later')).status).toBe('cancelled');
  expect((await env.DB.prepare("SELECT count(*) AS n FROM outbox WHERE kind='activity_cancelled'").first())!.n).toBe(2002);
});

it('运维投影暴露积压年龄、到期活动及人工核对终态，且不返回内容',async()=>{
  const now=Date.now();
  await env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind('due',0,'{}','seed',now-90_000,now-100_000).run();
  await env.DB.prepare(`INSERT INTO outbox(id,user_id,subject,body,status,attempts,next_attempt,claimed_until,last_error,created_at,kind,priority)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind('manual','private-user','private subject','private body','failed',6,8640000000000000,0,'delivery_uncertain_manual_review',now-120_000,'legacy_unknown',0).run();
  await env.DB.prepare(`INSERT INTO outbox(id,user_id,subject,body,status,attempts,next_attempt,claimed_until,last_error,created_at,kind,priority)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind('retry-exhausted','private-user','private subject','private body','failed',5,0,0,'provider_http_503',now-180_000,'legacy_unknown',0).run();
  const projection=await operations(env,now);
  expect(projection).toEqual({observedAt:now,activities:{due:1,oldestDueAt:now-90_000,oldestAgeMs:90_000},mail:{due:0,oldestCreatedAt:null,oldestAgeMs:0,manualReviewFailures:1,terminalFailures:1}});
  expect(JSON.stringify(projection)).not.toContain('private');
  const response=await worker.fetch(new Request('https://test.invalid/api/health/operations'),env);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({activities:{due:1},mail:{manualReviewFailures:1,terminalFailures:1}});
});
