import {setTimeout as delay} from 'node:timers/promises';

import {execFileSync} from 'node:child_process';
import {readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assertRemoteMigrationsCurrent} from './release-common.mjs';

const app=fileURLToPath(new URL('../',import.meta.url));
const {DAMS_D1_ID, DAMS_PUBLIC_URL, WORKERS_CI_BRANCH, WORKERS_CI_COMMIT_SHA}=process.env;
const account='f1dc30bb93206c310ab2b840baceb857';
const base=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const target='data-coffee-preview';
if(process.env.WRANGLER_CI_OVERRIDE_NAME&&process.env.WRANGLER_CI_OVERRIDE_NAME!==target)throw new Error('Cloudflare Builds Worker 名称与演练目标不一致');

const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim();
if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(DAMS_D1_ID||'')||DAMS_D1_ID===base.d1_databases[0].database_id)throw new Error('需要 DAMS 账号独立的 D1 ID');
const url=new URL(DAMS_PUBLIC_URL||'');
if(DAMS_PUBLIC_URL!==url.origin||url.protocol!=='https:'||
 !/^data-coffee-preview\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname))throw new Error('DAMS 发布地址与阶段不匹配');
const dry=process.argv[2]==='--dry-run';
if(!dry&&(WORKERS_CI_BRANCH!=='main'||WORKERS_CI_COMMIT_SHA!==sha))throw new Error('仅发布 Cloudflare Builds 签出的 main 提交');

const config={...base,name:target,account_id:account,workers_dev:true,preview_urls:false,
 d1_databases:[{...base.d1_databases[0],database_name:target,database_id:DAMS_D1_ID}],
 routes:[],
 triggers:{crons:[]},
 vars:{...base.vars,APP_ENV:'migration-preview',APP_URL:url.origin,APP_VERSION:sha}};
const path=new URL('../.wrangler-dams-'+process.pid+'.json',import.meta.url);
writeFileSync(path,JSON.stringify(config),{flag:'wx'});
const opts=['--config',fileURLToPath(path)];
try{
 if(!dry)assertRemoteMigrationsCurrent(opts);
 execFileSync('npx',['--no-install','wrangler','deploy',...opts,...(dry?['--dry-run']:['--strict','--message','Data Coffee '+sha])],{cwd:app,stdio:'inherit'});
 if(!dry){
  let lastError;
  for(let attempt=0;attempt<10;attempt++){
   try{
    const health=await fetch(url.origin+"/api/health",{signal:AbortSignal.timeout(10000)});
    const body=await health.json();
    if(!health.ok||!body.ok||body.version!==sha||body.environment!==config.vars.APP_ENV)throw new Error("DAMS 发布后健康检查未确认本次版本");
    const list=await fetch(url.origin+"/api/events?pageSize=1",{signal:AbortSignal.timeout(10000)});
    if(!list.ok||!Array.isArray((await list.json()).events))throw new Error("DAMS 活动列表读回失败");
    lastError=null;break;
   }catch(error){lastError=error;if(attempt<9)await delay(3000);}
  }
  if(lastError)throw lastError;

 }
}finally{rmSync(path);}
