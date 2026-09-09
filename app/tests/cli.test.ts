import {describe,it,expect,vi} from 'vitest';
// @ts-expect-error CLI is deliberately dependency-free JavaScript.
import {run} from '../cli/dc-flow.mjs';

async function invoke(args:string[],response=new Response('{"ok":true}'),env={},input=''){
  let stdout='',stderr='';const fetch=vi.fn().mockResolvedValue(response);
  const code=await run(args,{env,fetch,stdin:async()=>input,stdout:(s:string)=>stdout+=s,stderr:(s:string)=>stderr+=s});
  return {code,stdout,stderr,fetch};
}
describe('Agent CLI HTTP contract',()=>{
  it('reads the same events API and refuses redirects',async()=>{
    const r=await invoke(['events','list']);expect(r.code).toBe(0);
    expect(String(r.fetch.mock.calls[0][0])).toBe('http://localhost:8787/api/events');
    expect(r.fetch.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'error'});
    expect(JSON.parse(r.stdout)).toEqual({ok:true});expect(r.stderr).toBe('');
  });
  it('sends exact version/key and session cookie without printing token',async()=>{
    const token='a'.repeat(64);
    const r=await invoke(['events','action','abc','join','--version','7','--key','join-unique','--data','{"registrationMessage":"你好"}','--session-stdin'],undefined,{},JSON.stringify({sessionToken:token}));
    expect(r.code).toBe(0);expect(r.fetch.mock.calls[0][1].headers).toMatchObject({Cookie:`dc_session=${token}`,'Idempotency-Key':'join-unique'});
    expect(JSON.parse(r.fetch.mock.calls[0][1].body)).toEqual({action:'join',version:7,registrationMessage:'你好'});
    expect(r.stdout+r.stderr).not.toContain(token);
  });
  it('原样提交 raise_capacity 的新人数上限',async()=>{
    const r=await invoke(['events','action','abc','raise_capacity','--version','7','--key','capacity-12','--data','{"maxPeople":12}']);
    expect(r.code).toBe(0);expect(JSON.parse(r.fetch.mock.calls[0][1].body)).toEqual({action:'raise_capacity',version:7,maxPeople:12});
  });
  it('only exposes login session with explicit session-only flag',async()=>{
    const response=()=>new Response('{"user":{"id":"u"}}',{headers:{'Set-Cookie':`dc_session=${'b'.repeat(64)}; HttpOnly`}});
    const args=['auth','verify','--data','{"email":"fake@example.test","code":"123456","nickname":"测试"}'];
    expect(JSON.parse((await invoke(args,response())).stdout)).toEqual({user:{id:'u'}});
    expect(JSON.parse((await invoke([...args,'--session-only'],response())).stdout)).toEqual({sessionToken:'b'.repeat(64)});
  });
  it('creates draft through POST without pretending idempotency',async()=>{
    const r=await invoke(['events','create','--data','{"title":"草稿"}']);expect(r.code).toBe(0);
    expect(r.fetch.mock.calls[0][1]).toMatchObject({method:'POST',body:'{"title":"草稿"}'});
    expect(r.fetch.mock.calls[0][1].headers['Idempotency-Key']).toBeUndefined();
  });
  it.each([['--version','-1','--key','abcdefgh'],['--version','1'],['--version','9007199254740992','--key','abcdefgh']])('rejects unsafe mutation inputs %j',async(...options)=>{
    const r=await invoke(['events','action','abc','join',...options]);expect(r.code).toBe(2);expect(r.fetch).not.toHaveBeenCalled();
  });
  it.each([401,403,409,503])('reports HTTP %i only on stderr',async(status)=>{
    const r=await invoke(['events','list'],new Response('{"error":"失败"}',{status}));
    expect(r.code).toBe(status===409?4:status===503?1:3);expect(r.stdout).toBe('');expect(JSON.parse(r.stderr)).toEqual({error:'失败',status});expect(r.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not send token to insecure remote URL',async()=>{
    const r=await invoke(['events','list','--base-url','http://example.com'],undefined,{DATA_COFFEE_SESSION:'a'.repeat(64)});expect(r.code).toBe(2);expect(r.fetch).not.toHaveBeenCalled();
  });
  it('rejects competing stdin consumers',async()=>{
    const r=await invoke(['events','create','--data','-','--session-stdin']);expect(r.code).toBe(2);expect(r.fetch).not.toHaveBeenCalled();
  });
  it('requests auth code exclusively via injected HTTP mock',async()=>{
    const r=await invoke(['auth','request','--data','{"email":"fake@example.test"}']);expect(r.code).toBe(0);expect(String(r.fetch.mock.calls[0][0])).toContain('/api/auth/request');
  });
});

describe('CLI 输入边界与失败处理',()=>{
  it.each([['events','get','event-123','/api/events/event-123','GET'],['auth','me','','/api/me','GET'],['auth','export','','/api/me/export','GET'],['auth','logout','','/api/auth/logout','POST']])('路由 %s %s',async(group,command,id,path,method)=>{
    const r=await invoke([group,command,...(id?[id]:[])]);expect(r.code).toBe(0);expect(new URL(r.fetch.mock.calls[0][0]).pathname).toBe(path);expect(r.fetch.mock.calls[0][1].method).toBe(method);
  });
  it('帮助不请求网络',async()=>{const r=await invoke(['--help']);expect(r.code).toBe(0);expect(r.stdout).toContain('events action');expect(r.fetch).not.toHaveBeenCalled();});
  it.each([
    ['events','get','../secret'],['events','list','--unknown'],['events','list','--base-url'],
    ['events','list','--data','{}'],['events','create'],['events','create','--data','[]'],
    ['events','create','--data','null'],['events','create','--data','{bad'],
    ['events','list','--session-only'],['events','list','--version','1'],
    ['events','list','--base-url','https://example.com/path'],
    ['events','list','--base-url','https://user:password@example.com'],
    ['events','list','--base-url','https://example.com?token=secret'],
    ['events','list','--base-url','https://example.com','--base-url','https://other.test'],
  ])('非法输入不发送请求 %j',async(...args)=>{const r=await invoke(args);expect(r.code).toBe(2);expect(r.stdout).toBe('');expect(r.fetch).not.toHaveBeenCalled();expect(()=>JSON.parse(r.stderr)).not.toThrow();});
  it('stdin JSON 保留中文与多选字段',async()=>{const payload={availableSlotIds:['sat','sun'],registrationMessage:'你好\n一起喝咖啡'};const r=await invoke(['events','action','abc','join','--version','0','--key','retry-1','--data','-'],undefined,{},JSON.stringify(payload));expect(r.code).toBe(0);expect(JSON.parse(r.fetch.mock.calls[0][1].body)).toEqual({...payload,action:'join',version:0});});
  it('命令行版本和动作优先于请求体',async()=>{const r=await invoke(['events','action','abc','join','--version','2','--key','retry-2','--data','{"action":"cancel","version":99}']);expect(JSON.parse(r.fetch.mock.calls[0][1].body)).toEqual({action:'join',version:2});});
  it('显式 URL 优先于环境变量，环境会话仅用于 Cookie',async()=>{const token='c'.repeat(64);const r=await invoke(['events','list','--base-url','https://api.example.test'],undefined,{DATA_COFFEE_BASE_URL:'https://ignored.test',DATA_COFFEE_SESSION:token});expect(String(r.fetch.mock.calls[0][0])).toBe('https://api.example.test/api/events');expect(r.fetch.mock.calls[0][1].headers.Cookie).toBe('dc_session='+token);expect(r.stdout+r.stderr).not.toContain(token);});
  it('无效会话不会泄漏或发请求',async()=>{const r=await invoke(['events','list'],undefined,{DATA_COFFEE_SESSION:'private-invalid-token'});expect(r.code).toBe(2);expect(r.fetch).not.toHaveBeenCalled();expect(r.stderr).not.toContain('private-invalid-token');});
  it.each([['events','create',32000],['auth','request',4096]])('限制 %s 请求字节数',async(group,command,size)=>{const r=await invoke([String(group),String(command),'--data',JSON.stringify({text:'中'.repeat(Number(size)/2)})]);expect(r.code).toBe(2);expect(r.fetch).not.toHaveBeenCalled();});
  it('网络失败只尝试一次且不泄漏底层错误',async()=>{const fetch=vi.fn().mockRejectedValue(new Error('private-token'));let stdout='',stderr='';const code=await run(['events','list'],{env:{},fetch,stdout:(s:string)=>stdout+=s,stderr:(s:string)=>stderr+=s});expect(code).toBe(1);expect(fetch).toHaveBeenCalledTimes(1);expect(stdout).toBe('');expect(stderr).not.toContain('private-token');});
  it('非 JSON 响应返回服务错误',async()=>{const r=await invoke(['events','list'],new Response('<html>bad gateway</html>',{status:502}));expect(r.code).toBe(1);expect(r.stdout).toBe('');expect(JSON.parse(r.stderr).status).toBe(502);});
  it('显式会话输出缺少 cookie 时失败',async()=>{const r=await invoke(['auth','verify','--data','{}','--session-only']);expect(r.code).toBe(1);expect(r.stdout).toBe('');});
});

describe('个人访问令牌认证',()=>{
  const token='dcf_'+'a'.repeat(64);
  it.each(['env','stdin'])('从 %s 发送 Bearer 且不打印令牌',async(source)=>{
    const r=await invoke(['auth','me',...(source==='stdin'?['--token-stdin']:[])],undefined,source==='env'?{DATA_COFFEE_TOKEN:token}:{},token+'\n');
    expect(r.code).toBe(0);expect(r.fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${token}`);
    expect(r.fetch.mock.calls[0][1].headers.Cookie).toBeUndefined();expect(r.stdout+r.stderr).not.toContain(token);
  });
  it.each(['','dcf_invalid','a'.repeat(64),'dcf_'+'A'.repeat(64)])('拒绝无效 token %s',async(value)=>{
    const r=await invoke(['auth','me'],undefined,{DATA_COFFEE_TOKEN:value});expect(r.code).toBe(2);expect(r.fetch).not.toHaveBeenCalled();
    if(value)expect(r.stderr).not.toContain(value);
  });
  it.each([
    {args:[],env:{DATA_COFFEE_TOKEN:token,DATA_COFFEE_SESSION:'b'.repeat(64)}},
    {args:['--session-stdin'],env:{DATA_COFFEE_TOKEN:token}},
    {args:['--token-stdin'],env:{DATA_COFFEE_SESSION:'b'.repeat(64)}},
    {args:['--token-stdin','--session-stdin'],env:{}},
    {args:['--token-stdin'],env:{DATA_COFFEE_TOKEN:token}},
    {args:['--token',token],env:{}},
    {args:['--token-stdin','--token-stdin'],env:{}},
  ])('拒绝冲突来源及明文 argv $args',async({args,env})=>{
    const r=await invoke(['auth','me',...args],undefined,env,token);expect(r.code).toBe(2);expect(r.fetch).not.toHaveBeenCalled();expect(r.stdout+r.stderr).not.toContain(token);
  });
  it('凭证和请求体不能共用 stdin',async()=>{
    const r=await invoke(['events','create','--token-stdin','--data','-'],undefined,{},token);expect(r.code).toBe(2);expect(r.fetch).not.toHaveBeenCalled();
  });
  it('环境 token 可以与 stdin 请求体共用',async()=>{
    const r=await invoke(['events','create','--data','-'],undefined,{DATA_COFFEE_TOKEN:token},'{"title":"草稿"}');expect(r.code).toBe(0);expect(r.fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${token}`);
  });
  it('token 不能发送到远端 HTTP',async()=>{
    const r=await invoke(['auth','me','--base-url','http://example.com'],undefined,{DATA_COFFEE_TOKEN:token});expect(r.code).toBe(2);expect(r.fetch).not.toHaveBeenCalled();
  });
});

it('CLI 保留相对截止、人数和候选时段数据',async()=>{
 const payload={title:'周末 coffee chat',city:'Amstelveen',tags:['AI'],rules:{minPeople:3,maxPeople:8,minHosts:0,waitlist:true,repairMinutes:60,registrationLeadHours:24,promotionLeadHours:4,addressVisibility:'public',timeSlots:[{id:'sat',startsAt:1790416800000,endsAt:1790427600000}]}};
 const r=await invoke(['events','create','--data','-'],undefined,{},JSON.stringify(payload));
 expect(r.code).toBe(0);expect(JSON.parse(r.fetch.mock.calls[0][1].body)).toEqual(payload);
});

it('CLI 模板只生成未来周日，不联网或自动发布',async()=>{
 let output='';const fetch=vi.fn();const code=await run(['events','template','--data',JSON.stringify({title:'周日下午咖啡',city:'Amstelveen',month:'2026-09',start:'13:00',durationMinutes:150,minPeople:4,maxPeople:8})],{now:Date.parse('2026-09-08T19:00Z'),env:{},fetch,stdout:(s:string)=>output+=s});
 expect(code).toBe(0);expect(fetch).not.toHaveBeenCalled();const result=JSON.parse(output);expect(result.skippedDates).toEqual(['2026-09-06']);expect(result.event.rules.timeSlots.map((s:any)=>new Date(s.startsAt).toISOString())).toEqual(['2026-09-13T11:00:00.000Z','2026-09-20T11:00:00.000Z','2026-09-27T11:00:00.000Z']);expect(result.event.rules.timeSlots.every((s:any)=>s.endsAt-s.startsAt===9000000)).toBe(true);
});
it('CLI 模板拒绝无效人数和日期',async()=>{for(const changes of [{month:'2026-13'},{maxPeople:2},{durationMinutes:0}]){const result=await invoke(['events','template','--data',JSON.stringify({title:'咖啡',city:'Amstelveen',month:'2026-09',...changes})]);expect(result.code).toBe(2);expect(result.fetch).not.toHaveBeenCalled();}});
