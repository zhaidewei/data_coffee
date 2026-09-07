import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';
import { handleAI } from '../worker/ai';
import { execute, insertActivity, load } from '../worker/store';
import type { Env, Rules, User } from '../worker/types';
let mf: Miniflare, env: Env;
const user = (id: string): User => ({ id, email: `${id}@test.invalid`, nickname: id, publicNickname: false });
const member = user('member'), owner = user('owner');
const rules = (): Rules => { const now=Date.now(); return {
  minPeople: 3, maxPeople: 3, waitlist: true, recruitmentDeadline: now+3600000,
  startsAt: now+7200000, endsAt: now+10800000, registrationDeadline: now+6900000,
  promotionDeadline: now+6900000, repairMinutes: 10, venueRequired: false,
  minTalks: 0, minCohosts: 0, minHosts: 0, allowRoleOverlap: true, continuousVenue: true,
  continuousTalks: true, continuousCohosts: true, continuousHosts: true, addressVisibility: 'participants',
}; };
beforeAll(async()=>{
  mf = new Miniflare(convertV4MiniflareOptions({ modules:true, script:'export default {fetch(){return new Response("ok")}}', d1Databases:['DB'], compatibilityDate:'2026-09-05' }));
  const DB=await mf.getD1Database('DB'); env={ DB:DB as unknown as D1Database, APP_ENV:'test', ASSETS:{} as Fetcher, DEEPSEEK_API_KEY:'test-placeholder-only' };
  for(const file of ['0001_events.sql','0002_identity.sql']) {
    const sql=readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8').replace(/--[^\n]*/g,'');
    for(const statement of sql.split(';').filter(s=>s.trim())) await DB.prepare(statement).run();
  }
});
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{
  // All model calls are trapped. Individual tests opt in to deterministic responses.
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Unexpected external request in AI test');}));
  for(const table of ['activities','audit','outbox','ai_proposals','ai_limits','users'])await env.DB.prepare(`DELETE FROM ${table}`).run();
});
afterEach(()=>vi.unstubAllGlobals());
const req=(path:string,data:unknown)=>new Request(`https://example.test${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
async function published(){const e=await insertActivity(env,{title:'Data Coffee 测试',city:'Amsterdam',description:'讨论数据',rules:rules()},owner);return execute(env,e.id,{action:'publish'},owner,'publish');}
function modelCall(action='join',args='{}'){
  const model=vi.fn(async()=>Response.json({choices:[{message:{content:null,tool_calls:[{id:'tool-test',type:'function',function:{name:action,arguments:args}}]}}]}));
  vi.stubGlobal('fetch',model);return model;
}
async function propose(eventId:string,actor=member){
  const response=await handleAI(req('/api/ai',{eventId,message:'我想参加'}),env,actor);
  return (await response!.json() as {proposal:{id:string;action:string;eventTitle:string;expiresAt:number}}).proposal;
}
const confirm=(proposalId:string,actor=member)=>handleAI(req('/api/ai/confirm',{proposalId}),env,actor);
async function count(table:string){return (await env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first<{n:number}>())!.n;}
describe('AI confirmation boundaries',()=>{
  it.each(['/api/ai','/api/ai/confirm'])('rejects and cancels an oversized stream before database or provider work: %s',async(path)=>{
    const cancel=vi.fn();let reads=0;
    const stream=new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(5000));},cancel});
    const request=new Request(`https://example.test${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'} as RequestInit);
    expect(request.headers.has('Content-Length')).toBe(false);
    // No DB binding: rejection must happen before any database work.
    await expect(handleAI(request,{} as Env,member)).rejects.toMatchObject({status:413});
    expect(cancel).toHaveBeenCalledTimes(1);expect(reads).toBeLessThanOrEqual(3);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('unconfigured AI does not call the provider, create proposals, or settle activity state',async()=>{
    const e=await published(); const expired={...e,rules:{...e.rules,recruitmentDeadline:Date.now()-1}};
    await env.DB.prepare('UPDATE activities SET document=? WHERE id=?').bind(JSON.stringify(expired),e.id).run();
    const audit=await count('audit');
    await expect(handleAI(req('/api/ai',{eventId:e.id,message:'帮我参加'}),{...env,DEEPSEEK_API_KEY:undefined},member)).rejects.toMatchObject({status:503});
    expect(fetch).not.toHaveBeenCalled();expect(await count('ai_proposals')).toBe(0);expect(await count('ai_limits')).toBe(0);
    expect(await load(env,e.id)).toEqual(expired);expect(await count('audit')).toBe(audit);
  });
  it('tool calls create a user/event/version-bound proposal without executing membership changes',async()=>{
    const e=await published();const model=modelCall();const before=await load(env,e.id);const audit=await count('audit');
    const proposal=await propose(e.id);expect(proposal).toMatchObject({action:'join',eventTitle:e.title});expect(model).toHaveBeenCalledTimes(1);
    expect(await load(env,e.id)).toEqual(before);expect(await count('audit')).toBe(audit);expect(await count('outbox')).toBe(0);
    const stored=await env.DB.prepare('SELECT * FROM ai_proposals WHERE id=?').bind(proposal.id).first();
    expect(stored).toMatchObject({user_id:member.id,event_id:e.id,version:e.version,action:'join'});
    const response=await confirm(proposal.id);expect(response!.status).toBe(200);
    expect((await load(env,e.id)).participants).toMatchObject([{userId:member.id,status:'joined'}]);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it('another user cannot confirm a proposal',async()=>{
    const e=await published();modelCall();const proposal=await propose(e.id);
    await expect(confirm(proposal.id,user('intruder'))).rejects.toMatchObject({status:409});
    expect((await load(env,e.id)).participants).toHaveLength(0);
    await expect(handleAI(req('/api/ai/confirm',{proposalId:proposal.id}),env,null)).rejects.toMatchObject({status:401});
  });
  it('activity version changes require a fresh proposal',async()=>{
    const e=await published();modelCall();const proposal=await propose(e.id);
    await execute(env,e.id,{action:'join'},user('other'),'other-join');const before=await load(env,e.id);
    await expect(confirm(proposal.id)).rejects.toMatchObject({status:409});expect(await load(env,e.id)).toEqual(before);
  });
  it('concurrent and repeated confirmations create exactly one membership/audit',async()=>{
    const e=await published();modelCall();const proposal=await propose(e.id);const audit=await count('audit');
    const confirmations=await Promise.all([confirm(proposal.id),confirm(proposal.id)]);expect(confirmations.map(r=>r!.status)).toEqual([200,200]);
    const after=await load(env,e.id);await confirm(proposal.id);expect(await load(env,e.id)).toEqual(after);
    expect(after.participants).toHaveLength(1);expect(await count('audit')).toBe(audit+1);
  });
  it('expired proposals and unsupported model tools cannot mutate activities',async()=>{
    const e=await published();modelCall();const proposal=await propose(e.id);
    await env.DB.prepare('UPDATE ai_proposals SET expires_at=0 WHERE id=?').bind(proposal.id).run();
    await expect(confirm(proposal.id)).rejects.toMatchObject({status:409});
    modelCall('cancel');await expect(propose(e.id)).rejects.toMatchObject({status:400});
    expect(await count('ai_proposals')).toBe(1);expect((await load(env,e.id)).participants).toHaveLength(0);
  });
  it('provider failure offers button fallback without storing a proposal',async()=>{
    const e=await published();vi.stubGlobal('fetch',vi.fn(async()=>new Response('unavailable',{status:503})));
    await expect(propose(e.id)).rejects.toMatchObject({status:503});expect(await count('ai_proposals')).toBe(0);
    expect((await load(env,e.id)).participants).toHaveLength(0);
  });
});
