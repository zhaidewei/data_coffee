#!/usr/bin/env node
import {readFile,realpath} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const help = `Data Coffee CLI（Node.js 22+）
用法：dc-flow <命令> [选项]
  events list
  events get <id>
  events create --data <JSON|@文件|->       创建草稿
  events action <id> <action> --version <整数> --key <幂等键> [--data <JSON|@文件|->]
  auth request --data <JSON|@文件|->       {email}，发送验证码
  auth verify --data <JSON|@文件|->        {email,code,nickname}，返回用户
  auth verify --data ... --session-only   仅输出会话 JSON，供管道捕获
  auth me | auth logout
选项：--base-url <URL>（或 DATA_COFFEE_BASE_URL，默认 http://localhost:8787）
      --session-stdin 从 stdin 读取会话（64位 token 或 {sessionToken} JSON）
      DATA_COFFEE_SESSION 环境变量提供会话；不接受命令行 token，不保存凭证。
      --help
action：edit describe publish select_time join leave apply review withdraw revoke cancel
成功 stdout JSON；错误 stderr JSON。退出码：0成功，1网络/服务端，2输入，3认证/权限，4冲突。
请求不自动重试。create API 不支持幂等；action 重试必须复用 --key 和原始参数。`;

class CliError extends Error {constructor(message,exitCode=2,status){super(message);this.exitCode=exitCode;this.status=status;}}
export async function run(argv, io={}) {
  const env=io.env??process.env, fetcher=io.fetch??fetch;
  const out=io.stdout??(s=>process.stdout.write(s)), err=io.stderr??(s=>process.stderr.write(s));
  const stdin=io.stdin??(async()=>{let s='';for await(const chunk of process.stdin)s+=chunk;return s;});
  try {
    if(argv.includes('--help')||argv.length===0){out(help+'\n');return 0;}
    const opts={},pos=[];
    for(let i=0;i<argv.length;i++){
      const arg=argv[i];
      if(!arg.startsWith('--')){pos.push(arg);continue;}
      if(['--session-stdin','--session-only'].includes(arg)){opts[arg]=true;continue;}
      if(!['--base-url','--data','--version','--key'].includes(arg))throw new CliError('未知选项');
      if(opts[arg]!==undefined||!argv[i+1]||argv[i+1].startsWith('--'))throw new CliError('选项缺少值或重复');
      opts[arg]=argv[++i];
    }
    const [group,command,id,action]=pos;
    let path,method='GET',payload;
    if(group==='events'&&command==='list'&&pos.length===2)path='/api/events';
    else if(group==='events'&&command==='get'&&pos.length===3)path=`/api/events/${id}`;
    else if(group==='events'&&command==='create'&&pos.length===2){path='/api/events';method='POST';}
    else if(group==='events'&&command==='action'&&pos.length===4){path=`/api/events/${id}/actions`;method='POST';}
    else if(group==='auth'&&['request','verify','logout','me'].includes(command)&&pos.length===2){path=command==='me'?'/api/me':`/api/auth/${command}`;method=command==='me'?'GET':'POST';}
    else throw new CliError('命令无效，请使用 --help');
    if(id&&!/^[a-zA-Z0-9-]+$/.test(id))throw new CliError('活动 ID 格式无效');
    if(opts['--session-only']&&!(group==='auth'&&command==='verify'))throw new CliError('--session-only 仅用于 auth verify');
    if((opts['--key']!==undefined||opts['--version']!==undefined)&&!(group==='events'&&command==='action'))throw new CliError('--key 和 --version 仅用于 events action');
    const base=new URL(opts['--base-url']??env.DATA_COFFEE_BASE_URL??'http://localhost:8787');
    if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||!['https:','http:'].includes(base.protocol))throw new CliError('base-url 必须是无路径、凭证或查询参数的 HTTP(S) 地址');
    if(base.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw new CliError('远程 API 必须使用 HTTPS');
    if(opts['--session-stdin']&&opts['--data']==='-')throw new CliError('会话和请求体不能同时读取 stdin');
    let session=env.DATA_COFFEE_SESSION;
    if(opts['--session-stdin']){const raw=(await stdin()).trim();try{session=JSON.parse(raw).sessionToken;}catch{session=raw;}}
    if(session&&!/^[a-f0-9]{64}$/.test(session))throw new CliError('会话格式无效');
    if(opts['--data']!==undefined){
      if(method==='GET'||command==='logout')throw new CliError('此命令不接受 --data');
      const source=opts['--data'];
      let raw;try{raw=source==='-'?await stdin():source.startsWith('@')?await readFile(source.slice(1),'utf8'):source;payload=JSON.parse(raw);}catch{throw new CliError('请求体读取失败或 JSON 无效');}
      if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new CliError('请求体必须是 JSON 对象');
    }
    if(['create','request','verify'].includes(command)&&!payload)throw new CliError('缺少 --data');
    const headers={'Accept':'application/json'};
    if(session)headers.Cookie=`dc_session=${session}`;
    if(group==='events'&&command==='action'){
      if(!/^\d+$/.test(opts['--version']??'')||!Number.isSafeInteger(Number(opts['--version'])))throw new CliError('action 必须提供非负整数 --version');
      if(!/^[A-Za-z0-9:_-]{1,100}$/.test(opts['--key']??''))throw new CliError('action 必须提供 1–100 字符的字母、数字、冒号、下划线或连字符 --key');
      payload={...payload,action,version:Number(opts['--version'])};headers['Idempotency-Key']=opts['--key'];
    }
    const body=payload?JSON.stringify(payload):undefined;
    if(body&&Buffer.byteLength(body)>(group==='auth'?4096:32000))throw new CliError('请求体过大');
    if(body)headers['Content-Type']='application/json';
    let response;try{response=await fetcher(new URL(path,base),{method,headers,body,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw new CliError('网络请求失败或超时；写入结果可能未知，请核实后重试',1);}
    let data;try{data=await response.json();}catch{throw new CliError('API 未返回 JSON',1,response.status);}
    if(!response.ok)throw new CliError(typeof data.error==='string'?data.error:'API 请求失败',[401,403].includes(response.status)?3:response.status===409?4:1,response.status);
    if(opts['--session-only']){
      const token=response.headers.get('set-cookie')?.match(/(?:^|;\s*)dc_session=([a-f0-9]{64})(?:;|$)/)?.[1];
      if(!token)throw new CliError('登录响应缺少会话',1);
      data={sessionToken:token};
    }
    out(JSON.stringify(data)+'\n');return 0;
  }catch(error){err(JSON.stringify({error:error instanceof CliError?error.message:'CLI 输入或执行失败',...(error.status?{status:error.status}:{})})+'\n');return error instanceof CliError?error.exitCode:2;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(await realpath(process.argv[1])).href)process.exitCode=await run(process.argv.slice(2));
