import type {Env,User} from './types';
import {DomainError,fail,textValue} from './engine';
import {advance,deleteDraft,execute,insertActivity,project,tick} from './store';
import {currentUser,handleAuth,handleTokens} from './auth';
import {drainMail} from './mail';
import {handleAI} from './ai';
import {body} from './http';
export {body} from './http';

const json=(data:unknown,status=200)=>Response.json(data,{status});
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
    let res:Response;
    try{
      if(!['GET','HEAD'].includes(request.method)){
        const origin=request.headers.get('origin');
        if(origin&&origin!==url.origin)fail('请求来源不允许',403);
        const site=request.headers.get('sec-fetch-site');if(site==='cross-site')fail('请求来源不允许',403);
        if(Number(request.headers.get('content-length')??0)>32000)fail('请求过大',413);
      }
      if(request.headers.has('Authorization')) await currentUser(request,env);
      const auth=await handleTokens(request,env) ?? await handleAuth(request,env);
      if(auth)res=auth;
      else if(url.pathname==='/api/health')res=json({ok:true,environment:env.APP_ENV});
      else {
        const user=await currentUser(request,env);
        const context={...env,APP_URL:env.APP_URL||url.origin};
        const ai=url.pathname.startsWith('/api/ai')?await handleAI(request,context,user):null;
        if(ai)res=ai;
        else if(url.pathname==='/api/events'&&request.method==='GET'){
          const rows=await env.DB.prepare("SELECT id FROM activities WHERE json_extract(document,'$.status')!='draft' OR json_extract(document,'$.ownerId')=? ORDER BY created_at DESC LIMIT 200").bind(user?.id??null).all<{id:string}>();
          const events=[];
          for(const row of rows.results){const e=await advance(context,row.id);if(e.status!=='draft'||e.ownerId===user?.id)events.push(await project(context,e,user,true));}
          res=json({events,user:user?{id:user.id,nickname:user.nickname,publicNickname:user.publicNickname}:null});
        }else if(url.pathname==='/api/events'&&request.method==='POST'){
          if(!user)fail('请先验证邮箱登录',401);
          const b=await body(request);
          const e=await insertActivity(context,b,user!);res=json({event:await project(context,e,user)},201);
        }else{
          const m=url.pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)(\/actions)?$/);
          if(!m)fail('接口不存在',404);
          if(!m[2]&&request.method==='GET'){const e=await advance(context,m[1]);res=json({event:await project(context,e,user)});}
          else if(!m[2]&&request.method==='DELETE'){
            if(!user)fail('请先验证邮箱登录',401);
            const b=await body(request);
            if(typeof b.version!=='number')fail('缺少有效活动版本，请刷新',409);
            await deleteDraft(context,m[1],user!,b.version as number);res=json({deleted:true,id:m[1]});
          }
          else if(m[2]&&request.method==='POST'){
            if(!user)fail('请先验证邮箱登录',401);
            const b=await body(request);const action=textValue(b.action,'操作',30);
            if(!Number.isInteger(b.version))fail('缺少活动版本，请刷新',409);
            const e=await execute(context,m[1],{...b,action},user!,request.headers.get('Idempotency-Key')??'',Number(b.version));res=json({event:await project(context,e,user)});
          }else fail('请求方法不支持',405);
        }
      }
    }catch(error){
      if(error instanceof DomainError)res=json({error:error.message},error.status);
      else {console.error('request_failed');res=json({error:'服务暂时不可用，请稍后重试'},503);}
    }
    const secured=new Response(res.body,res);secured.headers.set('Cache-Control','no-store');secured.headers.set('X-Content-Type-Options','nosniff');secured.headers.set('Referrer-Policy','same-origin');return secured;
  },
  async scheduled(_event:ScheduledController,env:Env,_ctx:ExecutionContext){await tick(env);await drainMail(env,10);}
} satisfies ExportedHandler<Env>;
