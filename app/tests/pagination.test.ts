import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync} from 'node:fs';
import {listEvents} from '../worker/list';
import {createActivity,nextDue} from '../worker/engine';
import type {Activity,Env,Rules,User} from '../worker/types';
// @ts-expect-error Browser query builder shared with overview.
import {overviewQuery} from '../web/overview.js';
// @ts-expect-error CLI is dependency-free JavaScript.
import {run} from '../cli/dc-flow.mjs';
let mf:Miniflare,env:Env;
const now=Date.parse('2026-09-08T12:00:00Z');
const user:User={id:'owner',email:'owner@test.invalid',nickname:'发起人',publicNickname:false};
const rules:Rules={minPeople:3,maxPeople:8,waitlist:true,recruitmentDeadline:now+3600000,startsAt:now+7200000,endsAt:now+10800000,registrationDeadline:now+6900000,promotionDeadline:now+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:false,continuousCohosts:false,continuousHosts:true,addressVisibility:'participants'};
const item=(i:number,extra:Partial<Activity>={}):Activity=>({...createActivity({title:'聚会 '+i,city:'Amsterdam',rules,tags:['AI']},user.id,now),id:'event-'+String(i).padStart(3,'0'),status:'recruiting',...extra});
async function seed(events:Activity[]){await env.DB.batch(events.map(e=>env.DB.prepare('INSERT INTO activities(id,version,document,commit_id,next_due,created_at) VALUES(?,?,?,?,?,?)').bind(e.id,e.version,JSON.stringify(e),e.id,nextDue(e),e.createdAt)));}
const list=(query='',actor:User|null=null)=>listEvents(env,actor,new URLSearchParams(query));
beforeAll(async()=>{mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-09-05'}));env={DB:await mf.getD1Database('DB') as unknown as D1Database,APP_ENV:'test',ASSETS:{} as Fetcher};for(const f of ['0001_events.sql','0002_identity.sql','0006_mail_digest.sql','0008_outbox_notice_kind.sql','0004_tags.sql'])for(const s of readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8').split(';').filter(s=>s.trim()))await env.DB.prepare(s).run();});
afterAll(async()=>{await mf?.dispose();});
beforeEach(async()=>{vi.restoreAllMocks();for(const table of ['activities','audit','outbox','users','tags'])await env.DB.prepare(`DELETE FROM ${table}`).run();});
describe('活动服务端分页',()=>{
 it('默认12、上限20；相同时间使用ID稳定排序、三页无重漏',async()=>{
  await seed(Array.from({length:25},(_,i)=>item(i)));const pages=await Promise.all([list(),list('page=2'),list('page=3')]);
  expect(pages.map(p=>p.events.length)).toEqual([12,12,1]);expect(pages[0].pagination).toEqual({page:1,pageSize:12,total:25,totalPages:3,nextPage:2});
  expect(pages.flatMap(p=>p.events.map(e=>e.id))).toEqual(Array.from({length:25},(_,i)=>'event-'+String(24-i).padStart(3,'0')));
  expect((await list('pageSize=100')).events).toHaveLength(20);expect((await list('page=999')).pagination.page).toBe(3);
 });
 it('筛选早于分页，城市地图和标签计数不被当前页截断，私人草稿不进入任何统计',async()=>{
  await seed([...Array.from({length:25},(_,i)=>item(i)),item(30,{city:'Utrecht',tags:['SQL']}),item(31,{status:'draft',ownerId:'other',city:'SECRET',tags:['SECRET']}),item(32,{status:'draft',city:'Rotterdam',tags:['Owner']})]);
  const all=await list();expect(all.pagination.total).toBe(26);expect(all.overview.cities).toContainEqual({city:'Amsterdam',count:25});expect(all.overview.tags).toContainEqual({label:'AI',count:25});expect(JSON.stringify(all)).not.toContain('SECRET');expect(all.overview.allCities).not.toContain('Rotterdam');
  const filtered=await list('city=Utrecht&tag=sql');expect(filtered.events.map(e=>e.id)).toEqual(['event-030']);expect(filtered.pagination.total).toBe(1);
  const aiCity=await list('city=Utrecht');expect(aiCity.overview.cities).toContainEqual({city:'Amsterdam',count:25});expect(aiCity.overview.tags).toContainEqual({label:'AI',count:0});
  const own=await list('city=Rotterdam',user);expect(own.events.map(e=>e.id)).toEqual(['event-032']);expect(JSON.stringify(own)).not.toContain('SECRET');
 });
 it('候选时段与最终时段遵循Amsterdam跨日匹配，并且过滤能命中后续页',async()=>{
  const slot={id:'future',startsAt:Date.parse('2026-10-31T23:00:00Z'),endsAt:Date.parse('2026-11-01T02:00:00Z')};
  await seed([item(0,{rules:{...rules,timeSlots:[{id:'first',startsAt:rules.startsAt,endsAt:rules.endsAt},slot]}}),...Array.from({length:20},(_,i)=>item(i+1))]);
  expect((await list('from=2026-11-01&to=2026-11-01')).events.map(e=>e.id)).toEqual(['event-000']);
  const e=item(0,{selectedSlotId:'first',rules:{...rules,timeSlots:[{id:'first',startsAt:rules.startsAt,endsAt:rules.endsAt},slot]}});await env.DB.prepare('UPDATE activities SET document=? WHERE id=?').bind(JSON.stringify(e),e.id).run();expect((await list('from=2026-11-01&to=2026-11-01')).events).toHaveLength(0);
 });
 it('未到期活动只需一次文档批量查询，卡片增加不增加逐条查询',async()=>{
  await seed(Array.from({length:25},(_,i)=>item(i)));const spy=vi.fn((sql:string)=>env.DB.prepare(sql));const counted={...env,DB:{prepare:spy} as unknown as D1Database};await listEvents(counted,null,new URLSearchParams());expect(spy).toHaveBeenCalledTimes(1);spy.mockClear();await listEvents(counted,null,new URLSearchParams('pageSize=20'));expect(spy).toHaveBeenCalledTimes(1);
 });
 it('到期活动列表只返回存储快照，不触发结算、审计或通知写入',async()=>{
  await seed([item(0)]);const before=await env.DB.prepare('SELECT document FROM activities WHERE id=?').bind('event-000').first<{document:string}>();const r=await list();expect(r.events[0].status).toBe('recruiting');const stored=await env.DB.prepare('SELECT document FROM activities WHERE id=?').bind('event-000').first<{document:string}>();expect(stored!.document).toBe(before!.document);expect((await env.DB.prepare('SELECT count(*) n FROM audit').first<{n:number}>())!.n).toBe(0);expect((await env.DB.prepare('SELECT count(*) n FROM outbox').first<{n:number}>())!.n).toBe(0);
 });
 it.each(['page=0','page=1.2','pageSize=-1','from=2026-02-30&to=2026-03-01','from=2026-10-01','from=2026-10-02&to=2026-10-01'])('拒绝非法查询 %s',async query=>{await expect(list(query)).rejects.toMatchObject({status:400});});
 it('前端请求完整保留城市、主题与日期',()=>{const q=new URLSearchParams(overviewQuery({page:2,city:'Den Haag',selectedTag:'AI & SQL'},{from:'2026-10-01',to:'2026-10-31'}));expect(Object.fromEntries(q)).toEqual({page:'2',pageSize:'12',city:'Den Haag',tag:'AI & SQL',from:'2026-10-01',to:'2026-10-31'});});
});
async function cli(responses:unknown[]){let stdout='',stderr='';const fetch=vi.fn();for(const data of responses)fetch.mockResolvedValueOnce(new Response(JSON.stringify(data)));const code=await run(['events','list'],{env:{},fetch,stdout:(s:string)=>stdout+=s,stderr:(s:string)=>stderr+=s});return {code,stdout,stderr,fetch};}
const page=(n:number)=>({events:[{id:'event-'+n}],user:null,pagination:{page:n,pageSize:1,total:3,totalPages:3,nextPage:n===3?null:n+1}});
describe('CLI完整列表',()=>{
 it('跟随分页返回所有活动',async()=>{const r=await cli([page(1),page(2),page(3)]);expect(r.code).toBe(0);expect(JSON.parse(r.stdout)).toEqual({events:[{id:'event-1'},{id:'event-2'},{id:'event-3'}],user:null,total:3,complete:true});expect(r.fetch).toHaveBeenCalledTimes(3);expect(String(r.fetch.mock.calls[1][0])).toContain('page=2&pageSize=1');});
 it('后续页失败不输出部分列表',async()=>{const r=await cli([page(1),{error:'broken'}]);expect(r.code).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).toContain('分页');});
 it.each([{...page(2),events:[{id:'event-1'}]},{...page(2),pagination:{...page(2).pagination,nextPage:2}},{...page(2),pagination:{...page(2).pagination,total:4}},{...page(2),events:[]}])('拒绝重复、回环或变化分页',async broken=>{const r=await cli([page(1),broken]);expect(r.code).toBe(1);expect(r.stdout).toBe('');});
});
