import {beforeAll,afterAll,beforeEach,it,expect} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import worker from '../worker/index';
import {hash} from '../worker/auth';
import type {Env} from '../worker/types';
let mf:Miniflare,env:Env;
const raw='a'.repeat(64);
beforeAll(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({name:'tokens',modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-09-05',d1Databases:{DB:'tokens'}}));
 const DB=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of ['0001_events.sql','0002_identity.sql','0006_mail_digest.sql','0008_outbox_notice_kind.sql','0003_personal_tokens.sql'])for(const sql of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
 env={DB,ASSETS:{} as Fetcher,APP_ENV:'development'};
 await DB.prepare("INSERT INTO users(id,email,nickname) VALUES ('u','u@example.com','成员'),('other','other@example.com','他人')").run();
 await DB.prepare('INSERT INTO auth_sessions VALUES (?,?,?)').bind(await hash(raw),'u',Date.now()+86400000).run();
});
afterAll(async()=>{await mf?.dispose()});
beforeEach(async()=>{await env.DB.prepare('DELETE FROM personal_tokens').run()});
function call(path:string,method='GET',data?:unknown,bearer?:string,cookie=true){return worker.fetch(new Request(`http://localhost${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:`dc_session=${raw}`} : {}),...(bearer!==undefined?{Authorization:`Bearer ${bearer}`} : {})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env)}
async function issue(scope='write'){const r=await call('/api/tokens','POST',{name:'终端',scope});expect(r.status).toBe(201);return await r.json() as any}
it('issues once, stores only digest, and lists safe metadata',async()=>{
 const t=await issue();expect(t.token).toMatch(/^dcf_[a-f0-9]{64}$/);expect(t.expiresAt-t.createdAt).toBe(30*86400000);
 const row=await env.DB.prepare('SELECT * FROM personal_tokens').first();expect(row!.token_hash).toBe(await hash(t.token));expect(JSON.stringify(row)).not.toContain(t.token);
 const list=await (await call('/api/tokens')).json() as any;expect(list.tokens[0].id).toBe(t.id);expect(JSON.stringify(list)).not.toContain('token_hash');expect(JSON.stringify(list)).not.toContain(t.token);
});
it('rejects expired, revoked and invalid bearer without cookie fallback',async()=>{
 const t=await issue();expect((await call('/api/me','GET',undefined,t.token,false)).status).toBe(200);
 expect((await call('/api/me','GET',undefined,'invalid')).status).toBe(401);
 await env.DB.prepare('UPDATE personal_tokens SET expires_at=0').run();expect((await call('/api/me','GET',undefined,t.token)).status).toBe(401);
 const next=await issue();expect((await call(`/api/tokens/${next.id}`,'DELETE')).status).toBe(200);expect((await call('/api/me','GET',undefined,next.token)).status).toBe(401);
});
it('enforces read scope before every write including AI confirmation and profile',async()=>{
 const t=await issue('read');
 for(const [path,method] of [['/api/me','PATCH'],['/api/auth/logout','POST'],['/api/ai/confirm','POST'],['/api/events','POST']])expect((await call(path!,method!,{},t.token)).status).toBe(403);
 expect((await call('/api/events','GET',undefined,t.token,false)).status).toBe(200);
});
it('reserves management for cookie and keeps ownership checks',async()=>{
 const t=await issue();
 for(const [path,method,data] of [['/api/tokens','GET',undefined],['/api/tokens','POST',{name:'x',scope:'write'}],[`/api/tokens/${t.id}`,'DELETE',undefined]] as const)expect((await call(path,method,data,t.token)).status).toBe(403);
 expect((await call('/api/tokens','GET',undefined,undefined,false)).status).toBe(401);
 await env.DB.prepare("UPDATE personal_tokens SET user_id='other' WHERE id=?").bind(t.id).run();expect((await call(`/api/tokens/${t.id}`,'DELETE')).status).toBe(404);
 const r=await call('/api/me','PATCH',{nickname:'通过终端'},t.token,false);expect(r.status).toBe(200);expect((await r.json() as any).user.id).toBe('other');
});
it('validates scope and expiry bounds',async()=>{
 for(const data of [{name:'x',scope:'admin'},{name:'x',scope:'read',expiresDays:0},{name:'x',scope:'write',expiresDays:366},{name:'x',scope:'write',expiresDays:1.5},{name:'',scope:'read'}])expect((await call('/api/tokens','POST',data)).status).toBe(400);
});
