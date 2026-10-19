import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index';
import {cleanupExpired,MAINTENANCE_CRON,MINUTE_CRON} from '../worker/maintenance';
import {currentUser,handleAuth,hash} from '../worker/auth';
import {handleAI} from '../worker/ai';
import type {Env} from '../worker/types';

let mf:Miniflare,env:Env;
const DAY=86400000,now=Date.parse('2026-10-19T10:17:00Z');
beforeAll(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-05',d1Databases:{DB:'maintenance-test'}}));
  const DB=await mf.getD1Database('DB') as unknown as D1Database;
  for(const file of ['0001_events.sql','0002_identity.sql','0006_mail_digest.sql','0008_outbox_notice_kind.sql','0009_organizer_mail.sql'])for(const sql of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
  env={DB,ASSETS:{} as Fetcher,APP_ENV:'test'};
});
afterAll(async()=>{await mf?.dispose();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
beforeEach(async()=>{
  for(const table of ['ai_proposals','auth_sessions','auth_codes','auth_rate_limits','mail_daily_budget','outbox','users'])await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.prepare("INSERT INTO users(id,email,nickname) VALUES ('u','u@example.com','u')").run();
});

it('清理保持原保留阈值，只删除阈值之前的数据，重复执行安全',async()=>{
  for(const delta of [-1,0,1]){
    const id=String(delta);
    await env.DB.prepare('INSERT INTO ai_proposals VALUES (?,?,?,?,?,?,?)').bind(id,'u','e','join',0,now-DAY+delta,now-2*DAY).run();
    await env.DB.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').bind(id,'u',now+delta).run();
    await env.DB.prepare('INSERT INTO auth_codes VALUES (?,?,?,?,0,NULL)').bind(id,'n','h',now-DAY+delta).run();
    await env.DB.prepare('INSERT INTO auth_rate_limits VALUES (?,?,1)').bind(id,now-DAY+delta).run();
  }
  for(const day of ['2026-10-11','2026-10-12','2026-10-13','2026-10-19'])await env.DB.prepare('INSERT INTO mail_daily_budget VALUES (?,1)').bind(day).run();
  const results=await cleanupExpired(env,now);
  expect(results.map(x=>x.deleted)).toEqual([1,1,1,1,1]);
  expect(results.every(x=>!x.failed&&!x.hasMore)).toBe(true);
  for(const table of ['ai_proposals','auth_sessions','auth_codes','auth_rate_limits'])expect((await env.DB.prepare(`SELECT count(*) n FROM ${table}`).first())!.n).toBe(2);
  expect((await env.DB.prepare('SELECT day FROM mail_daily_budget ORDER BY day').all()).results).toEqual([{day:'2026-10-12'},{day:'2026-10-13'},{day:'2026-10-19'}]);
  expect((await cleanupExpired(env,now)).every(x=>x.deleted===0)).toBe(true);
});

it('每张表最多清理100条，下一轮继续，单表失败不阻断其他表',async()=>{
  await env.DB.batch(Array.from({length:105},(_,i)=>env.DB.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').bind(`s${i}`,'u',now-1)));
  await env.DB.prepare("INSERT INTO auth_codes VALUES ('old','n','h',?,0,NULL)").bind(now-2*DAY).run();
  const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{if(sql.startsWith('DELETE FROM ai_proposals'))throw new Error('private failure detail');return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const first=await cleanupExpired({...env,DB},now);
  expect(first[0]).toMatchObject({table:'ai_proposals',failed:true});
  expect(first[1]).toMatchObject({deleted:100,hasMore:true,failed:false});
  expect(first[2]).toMatchObject({deleted:1,failed:false});
  expect(JSON.stringify(first)).not.toContain('private');
  expect((await cleanupExpired(env,now))[1]).toMatchObject({deleted:5,hasMore:false});
});

it('清理前并发刷新同一key时，不误删已更新的会话、验证码和限流窗口',async()=>{
  await env.DB.prepare("INSERT INTO auth_sessions VALUES ('same','u',?)").bind(now-1).run();
  await env.DB.prepare("INSERT INTO auth_codes VALUES ('same','n','h',?,0,NULL)").bind(now-2*DAY).run();
  await env.DB.prepare("INSERT INTO auth_rate_limits VALUES ('same',?,1)").bind(now-2*DAY).run();
  const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{
    const statement=target.prepare(sql);
    return new Proxy(statement,{get(prepared,method){if(method==='bind')return(...args:unknown[])=>{
      const bound=prepared.bind(...args);
      return new Proxy(bound,{get(b,m){if(m==='run')return async()=>{
        const table=sql.match(/^DELETE FROM (auth_sessions|auth_codes|auth_rate_limits) /)?.[1];
        if(table){const column=table==='auth_rate_limits'?'window_start':'expires_at';await target.prepare(`UPDATE ${table} SET ${column}=?`).bind(now+DAY).run();}
        return b.run();
      };const v=Reflect.get(b,m);return typeof v==='function'?v.bind(b):v;}});
    };const value=Reflect.get(prepared,method);return typeof value==='function'?value.bind(prepared):value;}});
  };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const result=await cleanupExpired({...env,DB},now);
  expect(result.every(x=>!x.failed&&x.deleted===0)).toBe(true);
});

it('小时入口只清理，分钟空闲入口只有两条SQL，未知表达式拒绝执行',async()=>{
  const statements:string[]=[],log=vi.spyOn(console,'log').mockImplementation(()=>{});
  const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{statements.push(sql);return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const bounded={...env,DB};
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await worker.scheduled!({cron:MAINTENANCE_CRON} as ScheduledController,bounded,{} as ExecutionContext);
  expect(statements).toHaveLength(5);
  expect(statements.every(sql=>sql.startsWith('DELETE FROM'))).toBe(true);
  expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toMatchObject({event:'maintenance_completed',d1Statements:5});
  statements.length=0;
  await worker.scheduled!({cron:MINUTE_CRON} as ScheduledController,bounded,{} as ExecutionContext);
  expect(statements).toHaveLength(2);
  expect(fetcher).not.toHaveBeenCalled();
  statements.length=0;
  await expect(worker.scheduled!({cron:'0 * * * *'} as ScheduledController,bounded,{} as ExecutionContext)).rejects.toThrow('unknown_cron');
  expect(statements).toHaveLength(0);
});

it('小时入口完成所有表后报告失败，下一次可恢复',async()=>{
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  let statements=0;
  const DB=new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>{statements++;if(sql.startsWith('DELETE FROM auth_codes'))throw new Error('failure');return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  await expect(worker.scheduled!({cron:MAINTENANCE_CRON} as ScheduledController,{...env,DB},{} as ExecutionContext)).rejects.toThrow('maintenance_cleanup_failed');
  expect(statements).toBe(5);
  expect(JSON.parse(String(log.mock.calls.at(-1)![0])).cleanup[2].failed).toBe(true);
  await worker.scheduled!({cron:MAINTENANCE_CRON} as ScheduledController,env,{} as ExecutionContext);
});

it('物理清理尚未执行时，过期会话、验证码和AI建议仍被请求校验拒绝',async()=>{
  const raw='a'.repeat(64),past=Date.now()-1000;
  await env.DB.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').bind(await hash(raw),'u',past).run();
  expect(await currentUser(new Request('https://test.invalid/api/me',{headers:{Cookie:`dc_session=${raw}`}}),env)).toBeNull();
  await env.DB.prepare('INSERT INTO auth_codes VALUES (?,?,?,?,0,NULL)').bind(await hash('u@example.com'),'nonce',await hash('nonce:123456'),past).run();
  const response=await handleAuth(new Request('https://test.invalid/api/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'u@example.com',code:'123456',nickname:'u'})}),env);
  expect(response?.status).toBe(400);
  await env.DB.prepare('INSERT INTO ai_proposals VALUES (?,?,?,?,?,?,?)').bind('expired','u','e','join',0,past,past-1000).run();
  await expect(handleAI(new Request('https://test.invalid/api/ai/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposalId:'expired'})}),env,{id:'u',email:'u@example.com',nickname:'u',publicNickname:false})).rejects.toMatchObject({status:409});
  expect((await env.DB.prepare('SELECT count(*) n FROM auth_sessions').first())!.n).toBe(1);
  expect((await env.DB.prepare('SELECT count(*) n FROM ai_proposals').first())!.n).toBe(1);
});
