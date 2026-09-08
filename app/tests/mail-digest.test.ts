import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {drainMail,sendEmail} from '../worker/mail';
import type {Env} from '../worker/types';
let mf:Miniflare,env:Env;
beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({name:'digest',modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-05',d1Databases:{DB:'digest-test'}}));
 const DB=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of ['0001_events.sql','0002_identity.sql','0006_mail_digest.sql'])for(const sql of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
 env={DB,ASSETS:{} as Fetcher,APP_ENV:'development',BREVO_API_KEY:'fake',EMAIL_FROM:'sender@example.com'};
});
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{
 for(const table of ['mail_payload','mail_dispatch','mail_daily_budget','outbox','users'])await env.DB.prepare(`DELETE FROM ${table}`).run();
 for(const id of ['a','b'])await env.DB.prepare('INSERT INTO users(id,email,nickname) VALUES (?,?,?)').bind(id,`${id}@example.com`,id).run();
});
afterEach(()=>vi.unstubAllGlobals());
async function enqueue(id:string,user='a',subject='有新的待处理申请'){
 await env.DB.prepare('INSERT INTO outbox(id,user_id,subject,body,created_at) VALUES (?,?,?,?,?)').bind(id,user,subject,`变更 ${id}\nhttps://coffee.example/events/${id}`,Date.now()).run();
}
function provider(statuses:number[]=[201]){
 const bodies:string[]=[];
 const fn=vi.fn(async(_url:string,init:RequestInit)=>{bodies.push(init.body as string);return new Response('{}',{status:statuses[Math.min(bodies.length-1,statuses.length-1)]});});
 vi.stubGlobal('fetch',fn);return {fn,bodies};
}
it('同收件人合并，完整保留每项正文和链接，每封只占一次预算',async()=>{
 await enqueue('one');await enqueue('two');await enqueue('other','b');const {bodies}=provider();await drainMail(env);
 expect(bodies).toHaveLength(2);const a=bodies.map(x=>JSON.parse(x)).find(x=>x.to[0].email==='a@example.com');
 for(const id of ['one','two'])expect(a.textContent).toContain(`变更 ${id}\nhttps://coffee.example/events/${id}`);
 expect(a.textContent).not.toContain('other');expect((await env.DB.prepare("SELECT count(*) n FROM outbox WHERE status='sent'").first())!.n).toBe(3);
 expect((await env.DB.prepare('SELECT used FROM mail_daily_budget').first())!.used).toBe(2);
});
it('有期限及未知通知保持独立优先，无聚合等待窗口',async()=>{
 await enqueue('normal');await enqueue('normal2');await enqueue('offer','a','有候补名额，请确认参加');await enqueue('deadline','a','候补确认期限已更新');await enqueue('repair','a','活动等待补齐');await enqueue('unknown','a','未知通知');
 const {bodies}=provider();await drainMail(env,4);
 expect(bodies.map(x=>JSON.parse(x).subject)).toEqual(['有候补名额，请确认参加','候补确认期限已更新','活动等待补齐','未知通知']);
 expect((await env.DB.prepare("SELECT count(*) n FROM outbox WHERE status='pending'").first())!.n).toBe(2);
});
it('并发 drain 无重复领取，每个链接只发一次',async()=>{
 for(let i=0;i<20;i++)await enqueue(`notice-${i}`);const {bodies}=provider();await Promise.all(Array.from({length:5},()=>drainMail(env)));
 const links=bodies.map(x=>JSON.parse(x).textContent).join('\n').match(/https:\/\/coffee\.example\/events\/notice-\d+/g)!;
 expect(links).toHaveLength(20);expect(new Set(links).size).toBe(20);
 expect((await env.DB.prepare("SELECT count(*) n FROM outbox WHERE status='sent'").first())!.n).toBe(20);
});
it('失败重试冻结完整 payload 与收件人，新通知不加入旧发送',async()=>{
 await enqueue('one');await enqueue('two');const {bodies}=provider([503,201]);await drainMail(env);
 await env.DB.prepare("UPDATE users SET email='changed@example.com' WHERE id='a'").run();await env.DB.prepare("UPDATE outbox SET body='changed',next_attempt=0 WHERE digest_id IS NULL").run();await enqueue('new');
 await drainMail({...env,EMAIL_FROM:'changed-sender@example.com'},1);expect(bodies).toHaveLength(2);expect(bodies[1]).toBe(bodies[0]);expect(JSON.parse(bodies[1]).to[0].email).toBe('a@example.com');expect(bodies[1]).not.toContain('/new');
 expect((await env.DB.prepare("SELECT status FROM outbox WHERE id='new'").first())!.status).toBe('pending');
});
it('成功发送但确认失败，重试保持原 payload 与幂等键',async()=>{
 await enqueue('one');await enqueue('two');const {bodies}=provider();let failAck=true;
 const DB=new Proxy(env.DB,{get(target,key){if(key==='batch')return async(statements:D1PreparedStatement[])=>{if(bodies.length===1&&failAck&&statements.length===2){failAck=false;throw new Error('simulated acknowledgement failure');}return target.batch(statements);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await drainMail({...env,DB});await env.DB.prepare('UPDATE outbox SET next_attempt=0').run();await drainMail(env);expect(bodies).toHaveLength(2);expect(bodies[1]).toBe(bodies[0]);
 expect((await env.DB.prepare("SELECT count(*) n FROM outbox WHERE status='sent'").first())!.n).toBe(2);
});
it('恢复崩溃前分组，旧未决发送因无原payload进入人工核对',async()=>{
 await enqueue('one');await enqueue('two');await env.DB.prepare("UPDATE outbox SET status='sending',attempts=1,claimed_until=0 WHERE id='one'").run();await env.DB.prepare("UPDATE outbox SET status='bundled',digest_id='one' WHERE id='two'").run();const {bodies}=provider();await drainMail(env);expect(bodies).toHaveLength(1);expect(bodies[0]).toContain('/two');
 await enqueue('legacy');await env.DB.prepare('INSERT INTO mail_dispatch VALUES (?,?,?)').bind('legacy',crypto.randomUUID(),Date.now()).run();await drainMail(env);expect(bodies).toHaveLength(1);expect((await env.DB.prepare("SELECT last_error FROM outbox WHERE id='legacy'").first())!.last_error).toBe('legacy_delivery_manual_review');
});
it('预算耗尽保留分组，登录预留有效，预算恢复后可发送',async()=>{
 await enqueue('one');await enqueue('two');await env.DB.prepare('INSERT INTO mail_daily_budget VALUES (?,250)').bind(new Date().toISOString().slice(0,10)).run();const {bodies}=provider();await drainMail(env);expect(bodies).toHaveLength(0);
 await sendEmail(env,'a@example.com','验证码','123456');expect(bodies).toHaveLength(1);await env.DB.prepare('DELETE FROM mail_daily_budget').run();await env.DB.prepare('UPDATE outbox SET next_attempt=0').run();await drainMail(env);expect(bodies).toHaveLength(2);expect(JSON.parse(bodies[1]).subject).toBe('有 2 项新的待处理申请');
});
it('已持久19个成员的崩溃恢复不会再扩大分组',async()=>{
 await enqueue('leader');for(let i=0;i<25;i++)await enqueue(`member-${i}`);
 await env.DB.prepare("UPDATE outbox SET status='sending',attempts=1 WHERE id='leader'").run();await env.DB.prepare("UPDATE outbox SET status='bundled',digest_id='leader' WHERE id IN (SELECT id FROM outbox WHERE id!='leader' ORDER BY id LIMIT 19)").run();
 const {bodies}=provider();await drainMail(env,1);expect(bodies).toHaveLength(1);expect(JSON.parse(bodies[0]).subject).toBe('有 20 项新的待处理申请');expect((await env.DB.prepare("SELECT count(*) n FROM outbox WHERE status='pending'").first())!.n).toBe(6);
});
it('普通通知每批5封且SQL在40以内，调用者可进一步限制预算',async()=>{
 for(let i=0;i<8;i++)await enqueue(`single-${i}`,'a','未知通知');let queries=0;
 const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{queries++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const {bodies}=provider();await drainMail({...env,DB},50);expect(bodies).toHaveLength(5);expect(queries).toBeLessThanOrEqual(40);
 queries=0;await drainMail({...env,DB},50,20);expect(bodies).toHaveLength(7);expect(queries).toBeLessThanOrEqual(20);
});
it('有效租约期间另一drain无法重复发送正在执行的组',async()=>{
 await enqueue('one');await enqueue('two');let release!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{entered=resolve;});
 const fetcher=vi.fn(async()=>{entered();await waiting;return new Response('{}',{status:201});});vi.stubGlobal('fetch',fetcher);
 const first=drainMail(env,1);await started;await drainMail(env);expect(fetcher).toHaveBeenCalledTimes(1);release();await first;
 expect((await env.DB.prepare("SELECT count(*) n FROM outbox WHERE status='sent'").first())!.n).toBe(2);
});
it('20条普通通知积压时，新候补确认及期限更新率先发出',async()=>{
 for(let i=0;i<20;i++)await enqueue(`backlog-${i}`,'a',i%2?'活动已成团':'发起人回复了你的报名留言');
 await enqueue('offer','a','有候补名额，请确认参加');await enqueue('deadline','a','候补确认期限已更新');await enqueue('repair','a','活动等待补齐');await enqueue('promoted','a','候补已入选');
 const {bodies}=provider();await drainMail(env,4);
 expect(bodies.map(x=>JSON.parse(x).subject)).toEqual(['有候补名额，请确认参加','候补确认期限已更新','活动等待补齐','候补已入选']);
 expect((await env.DB.prepare("SELECT count(*) n FROM outbox WHERE status='pending'").first())!.n).toBe(20);
});
