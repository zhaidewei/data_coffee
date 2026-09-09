import type {Activity,Env,User} from './types';
import {fail,nextDue} from './engine';
import {advance,project} from './store';
// @ts-expect-error Shared browser calendar logic keeps Amsterdam/DST filtering identical.
import {matchesTime} from '../web/overview.js';

const positive=(value:string|null,fallback:number)=>{if(value===null)return fallback;if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))fail('分页参数须为正整数');return Number(value);};
function rangeOf(params:URLSearchParams){
  const from=params.get('from'),to=params.get('to');if(from===null&&to===null)return null;
  const valid=(s:string|null)=>!!s&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  if(!valid(from)||!valid(to)||from!>to!)fail('请选择有效日期范围');
  return {from:from!,to:to!};
}
/** Read documents in one query; only rule transitions need a per-event CAS read/write. */
export async function listEvents(env:Env,user:User|null,params:URLSearchParams,clock=Date.now){
  const requestedPage=positive(params.get('page'),1),pageSize=Math.min(20,positive(params.get('pageSize'),12));
  const range=rangeOf(params),city=params.get('city')||'',tag=(params.get('tag')||'').toLowerCase();
  const rows=await env.DB.prepare("SELECT document FROM activities WHERE json_extract(document,'$.status')!='draft' OR json_extract(document,'$.ownerId')=? ORDER BY created_at DESC,id DESC").bind(user?.id??null).all<{document:string}>();
  const visible:Activity[]=[];
  for(const row of rows.results){
    let e:Activity=JSON.parse(row.document);const due=nextDue(e);
    if((due!==null&&due<=clock())||e.repairs.some(r=>['talks','cohosts','roles'].includes(r.key)))e=await advance(env,e.id,clock);
    if(e.status!=='draft'||e.ownerId===user?.id)visible.push(e);
  }
  const dated=visible.filter(e=>matchesTime(e,range));
  const themed=dated.filter(e=>!tag||(e.tags||[]).some(t=>t.toLowerCase()===tag));
  const matches=themed.filter(e=>!city||city==='全部'||e.city===city);
  const cityCounts=new Map<string,number>();for(const e of themed)cityCounts.set(e.city,(cityCounts.get(e.city)||0)+1);
  const tagCounts=new Map<string,{label:string;count:number}>();
  for(const e of visible)for(const label of e.tags||[])if(!tagCounts.has(label.toLowerCase()))tagCounts.set(label.toLowerCase(),{label,count:0});
  for(const e of dated.filter(e=>!city||city==='全部'||e.city===city))for(const key of new Set((e.tags||[]).map(t=>t.toLowerCase())))tagCounts.get(key)!.count++;
  const total=matches.length,totalPages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(requestedPage,totalPages);
  const events=await Promise.all(matches.slice((page-1)*pageSize,page*pageSize).map(e=>project(env,e,user,true)));
  return {events,user:user?{id:user.id,nickname:user.nickname,publicNickname:user.publicNickname}:null,
    pagination:{page,pageSize,total,totalPages,nextPage:page<totalPages?page+1:null},
    overview:{total:themed.length,cities:[...cityCounts].map(([city,count])=>({city,count})),tags:[...tagCounts.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-CN')),allCities:[...new Set(visible.map(e=>e.city))]}};
}
