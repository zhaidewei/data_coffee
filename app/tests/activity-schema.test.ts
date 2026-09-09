import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {ACTIVITY_SCHEMA_VERSION,ActivityDocumentError,decodeActivityDocument,encodeActivityDocument} from '../worker/activity-schema';
import {createActivity} from '../worker/engine';
import {advance,deleteDraft,execute,load} from '../worker/store';
import {listEvents} from '../worker/list';
import type {Activity,Env,Rules,User} from '../worker/types';

let mf:Miniflare,env:Env;
const now=Date.parse('2026-09-09T08:00:00Z');
const owner:User={id:'owner',email:'owner@test.invalid',nickname:'Owner',publicNickname:false};
const rules:Rules={minPeople:3,maxPeople:8,waitlist:true,recruitmentDeadline:now+3600000,startsAt:now+7200000,endsAt:now+10800000,registrationDeadline:now+6900000,promotionDeadline:now+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:false,continuousCohosts:false,continuousHosts:true,addressVisibility:'participants'};
const activity=()=>createActivity({title:'Schema test',city:'Amsterdam',description:'',rules},owner.id,now,'schema-test');
const withoutVersion=(value:Activity)=>{const {schemaVersion:_,...legacy}=value;return legacy;};
const errorCode=(fn:()=>unknown,code:ActivityDocumentError['code'])=>expect(fn).toThrow(expect.objectContaining({code}));
const migration=()=>readFile(new URL('../migrations/0007_activity_schema.sql',import.meta.url),'utf8').then(sql=>sql.replace(/--[^\n]*/g,'').trim());

beforeAll(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({name:'activity-schema',modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-05',d1Databases:{DB:'activity-schema-test'}}));
  const DB=await mf.getD1Database('DB') as unknown as D1Database;
  for(const file of ['0001_events.sql','0002_identity.sql','0004_tags.sql'])for(const sql of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
  env={DB,ASSETS:{} as Fetcher,APP_ENV:'test'};
});
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{for(const table of ['activities','audit','outbox','users','tags'])await env.DB.prepare(`DELETE FROM ${table}`).run();});

describe('Activity document codec',()=>{
  it('新文档以 v1 往返，领域修订号保持独立',()=>{
    const e=activity();e.version=17;
    expect(e.schemaVersion).toBe(ACTIVITY_SCHEMA_VERSION);
    expect(decodeActivityDocument(encodeActivityDocument(e))).toEqual(e);
    expect(e.version).toBe(17);
  });

  it('缺少 schemaVersion 的 v0 文档在内存升级为 v1',()=>{
    const legacy=withoutVersion(activity());
    const decoded=decodeActivityDocument(JSON.stringify(legacy));
    expect(decoded).toEqual({...legacy,schemaVersion:ACTIVITY_SCHEMA_VERSION});
    expect(decodeActivityDocument(JSON.stringify({...legacy,schemaVersion:0}))).toEqual(decoded);
  });

  it('行元数据与聚合不一致时拒绝读取',()=>{
    const e=activity();
    errorCode(()=>decodeActivityDocument(JSON.stringify(e),{id:e.id,version:e.version+1,createdAt:e.createdAt}),'activity_document_invalid');
  });

  it('未来版本和畸形文档 fail closed',()=>{
    const e=activity();
    errorCode(()=>decodeActivityDocument(JSON.stringify({...e,schemaVersion:2})),'activity_schema_unsupported');
    for(const broken of ['{',JSON.stringify({...e,schemaVersion:null}),JSON.stringify({...e,participants:{}}),JSON.stringify({...e,rules:{...e.rules,startsAt:'tomorrow'}})])
      errorCode(()=>decodeActivityDocument(broken),'activity_document_invalid');
  });
  it('扩容回执只接受结构化安全整数',()=>{
    const e=activity();e.receipts.push({at:now+1,kind:'capacity_expanded',conditions:[],reason:'扩容',capacityChange:{before:8,after:12}});
    expect(decodeActivityDocument(encodeActivityDocument(e)).receipts.at(-1)?.capacityChange).toEqual({before:8,after:12});
    for(const capacityChange of [{before:8.5,after:12},{before:8,after:'12'},{before:8},{before:8,after:8},{before:8,after:101}])
      errorCode(()=>decodeActivityDocument(JSON.stringify({...e,receipts:[{...e.receipts.at(-1),capacityChange}]})),'activity_document_invalid');
  });
});

it('0007 持久化升级缺失或显式为 0 的 v0，保留未来和畸形版本且可重复执行',async()=>{
  const legacy=withoutVersion(activity());
  const explicit={...legacy,id:'explicit-v0',schemaVersion:0};
  const future={...legacy,id:'future-v2',schemaVersion:2};
  const malformed={...legacy,id:'malformed-version',schemaVersion:false};
  for(const item of [legacy,explicit,future,malformed])await env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(item.id,item.version,JSON.stringify(item),'seed',null,item.createdAt).run();
  const sql=await migration();await env.DB.prepare(sql).run();
  const first=(await env.DB.prepare('SELECT document FROM activities WHERE id=?').bind(legacy.id).first<{document:string}>())!.document;
  await env.DB.prepare(sql).run();
  const second=(await env.DB.prepare('SELECT document FROM activities WHERE id=?').bind(legacy.id).first<{document:string}>())!.document;
  expect(JSON.parse(first).schemaVersion).toBe(1);expect(second).toBe(first);expect((await load(env,legacy.id)).schemaVersion).toBe(1);
  expect(JSON.parse((await env.DB.prepare('SELECT document FROM activities WHERE id=?').bind(explicit.id).first<{document:string}>())!.document).schemaVersion).toBe(1);
  expect(JSON.parse((await env.DB.prepare('SELECT document FROM activities WHERE id=?').bind(future.id).first<{document:string}>())!.document).schemaVersion).toBe(2);
  await expect(load(env,future.id)).rejects.toMatchObject({code:'activity_schema_unsupported'});
  expect(JSON.parse((await env.DB.prepare('SELECT document FROM activities WHERE id=?').bind(malformed.id).first<{document:string}>())!.document).schemaVersion).toBe(false);
  await expect(load(env,malformed.id)).rejects.toMatchObject({code:'activity_document_invalid'});
});

it('0007 遇到非法 JSON 时失败且不改原文档',async()=>{
  await env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind('broken',0,'{','seed',null,now).run();
  await expect(env.DB.prepare(await migration()).run()).rejects.toThrow();
  expect((await env.DB.prepare('SELECT document FROM activities WHERE id=?').bind('broken').first<{document:string}>())!.document).toBe('{');
});

it('v0 经正常 CAS 写入后持久化为 v1且业务版本只增加一次',async()=>{
  const legacy=withoutVersion(activity());
  await env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(legacy.id,legacy.version,JSON.stringify(legacy),'seed',null,legacy.createdAt).run();
  const updated=await execute(env,legacy.id,{action:'publish'},owner,'upgrade-v0',legacy.version,()=>now+1);
  expect(updated).toMatchObject({schemaVersion:1,version:1,status:'recruiting'});
  const stored=(await env.DB.prepare('SELECT document,version FROM activities WHERE id=?').bind(legacy.id).first<{document:string;version:number}>())!;
  expect(stored.version).toBe(1);expect(JSON.parse(stored.document).schemaVersion).toBe(1);
});

it('v0 草稿按已解码的原始 document 快照安全删除',async()=>{
  const legacy=withoutVersion(activity());const document=JSON.stringify(legacy);
  await env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(legacy.id,legacy.version,document,'seed',null,legacy.createdAt).run();
  await deleteDraft(env,legacy.id,owner,legacy.version);
  expect(await env.DB.prepare('SELECT id FROM activities WHERE id=?').bind(legacy.id).first()).toBeNull();
  expect((await env.DB.prepare("SELECT action,version FROM audit WHERE event_id=?").bind(legacy.id).first())!).toEqual({action:'delete_draft',version:1});
});

it('load、advance 和列表共用 fail-closed 解码，损坏数据不产生副作用',async()=>{
  const future={...activity(),schemaVersion:2,status:'recruiting'};
  await env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(future.id,0,JSON.stringify(future),'seed',now-1,now).run();
  await expect(load(env,future.id)).rejects.toMatchObject({code:'activity_schema_unsupported'});
  await expect(advance(env,future.id,()=>now)).rejects.toMatchObject({code:'activity_schema_unsupported'});
  await expect(listEvents(env,null,new URLSearchParams())).rejects.toMatchObject({code:'activity_schema_unsupported'});
  expect((await env.DB.prepare('SELECT version,document FROM activities WHERE id=?').bind(future.id).first())!).toMatchObject({version:0,document:JSON.stringify(future)});
  expect((await env.DB.prepare('SELECT count(*) count FROM audit').first<{count:number}>())!.count).toBe(0);
  expect((await env.DB.prepare('SELECT count(*) count FROM outbox').first<{count:number}>())!.count).toBe(0);
});
