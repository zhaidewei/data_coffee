import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const APP_DIR=fileURLToPath(new URL('..',import.meta.url));
export const REPO_DIR=fileURLToPath(new URL('../..',import.meta.url));
export const DEFAULT_BASE_URL='https://data-coffee-dev.dewei-zhai.workers.dev';
export const EXPECTED_REPO='zhaidewei/data_coffee';
export const RELEASE_WORKFLOW_PATH='.github/workflows/ci.yml';

export class ReleaseError extends Error {}

function commandFailure(label){
  return new ReleaseError(`${label} 失败；请单独运行该命令查看已脱敏的诊断信息`);
}

export function capture(command,args,{cwd=APP_DIR,label=`${command} ${args.join(' ')}`,trim=true}={}){
  const result=spawnSync(command,args,{cwd,encoding:'utf8',env:process.env});
  if(result.error||result.status!==0)throw commandFailure(label);
  return trim?result.stdout.trim():result.stdout;
}

export function run(command,args,{cwd=APP_DIR,label=`${command} ${args.join(' ')}`}={}){
  const result=spawnSync(command,args,{cwd,stdio:'inherit',env:process.env});
  if(result.error||result.status!==0)throw commandFailure(label);
}

export function currentHead(){
  return capture('git',['rev-parse','HEAD'],{cwd:REPO_DIR,label:'读取当前 Git HEAD'});
}

export function assertCleanAndCurrent(){
  const dirty=capture('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:REPO_DIR,label:'检查工作树',trim:false});
  const changes=dirty.split('\n').filter(Boolean);
  if(changes.length){
    const paths=changes.slice(0,8).map(line=>line.slice(3)).join(', ');
    throw new ReleaseError(`工作树不干净（${paths}${changes.length>8?', …':''}）`);
  }
  const ignoredAssets=ignoredAssetPaths(capture('git',['ls-files','--others','--ignored','--exclude-standard','--','app/web'],{cwd:REPO_DIR,label:'检查静态资源中的 ignored 文件',trim:false}));
  if(ignoredAssets.length)throw new ReleaseError(`静态资源目录包含不会出现在 Git SHA 中的 ignored 文件（${ignoredAssets.slice(0,8).join(', ')}${ignoredAssets.length>8?', …':''}）`);
  run('git',['fetch','--quiet','origin','main'],{cwd:REPO_DIR,label:'刷新 origin/main'});
  const head=currentHead();
  const originMain=capture('git',['rev-parse','origin/main'],{cwd:REPO_DIR,label:'读取 origin/main'});
  if(head!==originMain)throw new ReleaseError(`当前 HEAD ${head} 与 origin/main ${originMain} 不一致`);
  return {head,originMain};
}

export function ignoredAssetPaths(output){
  return output.split('\n').map(path=>path.trim()).filter(Boolean);
}

function parseJson(value,label){
  try{return JSON.parse(value);}catch{throw new ReleaseError(`${label} 返回了无法解析的 JSON`);}
}

export function repoFromRemote(value){
  const scp=value.match(/^[^@]+@[^:]+:(.+?)(?:\.git)?$/);
  if(scp)return scp[1].replace(/\.git$/,'');
  try{return new URL(value).pathname.replace(/^\//,'').replace(/\.git$/,'');}catch{throw new ReleaseError('origin remote URL 无法识别');}
}

function allowanceCount(allowances){
  if(!allowances||typeof allowances!=='object')return 0;
  return ['users','teams','apps'].reduce((sum,key)=>sum+(Array.isArray(allowances[key])?allowances[key].length:0),0);
}

export function validateGitHubReleaseReady(protection,checks,pulls,head,workflow,runs,jobs){
  if(protection?.enforce_admins?.enabled!==true)throw new ReleaseError('GitHub main 尚未对管理员执行分支保护');
  if(!protection?.required_pull_request_reviews)throw new ReleaseError('GitHub main 尚未要求 pull request review');
  if(allowanceCount(protection.required_pull_request_reviews.bypass_pull_request_allowances)>0)throw new ReleaseError('GitHub main 仍配置了 pull request review bypass allowance');
  const required=protection?.required_status_checks;
  const requiredEntry=Array.isArray(required?.checks)?required.checks.find(check=>check?.context==='App Worker'):null;
  if(!requiredEntry||!Number.isSafeInteger(requiredEntry.app_id)||requiredEntry.app_id<=0)throw new ReleaseError('GitHub main 尚未把 App Worker 的 GitHub App 身份固定为 required check');
  const candidates=Array.isArray(checks?.check_runs)?checks.check_runs.filter(check=>check?.name==='App Worker'&&check?.app?.id===requiredEntry.app_id):[];
  const latest=candidates.sort((a,b)=>Number(b.id)-Number(a.id))[0];
  if(!latest)throw new ReleaseError(`GitHub 上找不到 ${head} 的 App Worker check`);
  if(latest.status!=='completed'||latest.conclusion!=='success')throw new ReleaseError(`App Worker check 尚未成功（status=${latest.status}, conclusion=${latest.conclusion}）`);
  if(workflow?.path!==RELEASE_WORKFLOW_PATH)throw new ReleaseError(`发布 workflow 路径不是 ${RELEASE_WORKFLOW_PATH}`);
  const workflowRun=Array.isArray(runs?.workflow_runs)?runs.workflow_runs.filter(run=>run?.workflow_id===workflow.id&&run?.head_sha===head).sort((a,b)=>Number(b.id)-Number(a.id))[0]:null;
  if(!workflowRun)throw new ReleaseError(`${RELEASE_WORKFLOW_PATH} 在 ${head} 上没有 workflow run`);
  if(workflowRun.status!=='completed'||workflowRun.conclusion!=='success')throw new ReleaseError(`最新发布 workflow run 尚未成功（status=${workflowRun.status}, conclusion=${workflowRun.conclusion}）`);
  if(jobs?.workflowRunId!==workflowRun.id)throw new ReleaseError('App Worker jobs 不属于已验证的发布 workflow run');
  const workflowJob=Array.isArray(jobs?.jobs)?jobs.jobs.filter(job=>job?.name==='App Worker').sort((a,b)=>Number(b.id)-Number(a.id))[0]:null;
  if(!workflowJob)throw new ReleaseError('已验证的发布 workflow run 中没有成功的 App Worker job');
  if(workflowJob.status!=='completed'||workflowJob.conclusion!=='success')throw new ReleaseError(`发布 workflow 的 App Worker job 尚未成功（status=${workflowJob.status}, conclusion=${workflowJob.conclusion}）`);
  if(workflowJob.id!==latest.id)throw new ReleaseError('required App Worker check 与发布 workflow job 不是同一次检查');
  const pullRequest=Array.isArray(pulls)?pulls.find(pr=>pr?.base?.ref==='main'&&typeof pr.merged_at==='string'&&pr.merge_commit_sha===head):null;
  if(!pullRequest)throw new ReleaseError(`GitHub 上找不到生成 ${head} 的已合并 main pull request`);
  return {adminsEnforced:true,pullRequestReviewsRequired:true,requiredCheck:'App Worker',workflow:{id:workflow.id,path:workflow.path,runId:workflowRun.id},pullRequest:Number(pullRequest.number),check:{name:latest.name,status:latest.status,conclusion:latest.conclusion,appId:latest.app?.id??null}};
}

export function assertGitHubReleaseReady(head){
  const branchName=capture('git',['branch','--show-current'],{cwd:REPO_DIR,label:'读取当前分支'});
  if(branchName!=='main')throw new ReleaseError(`发布必须从 main 分支执行，当前为 ${branchName||'detached HEAD'}`);
  const originRepo=repoFromRemote(capture('git',['remote','get-url','origin'],{cwd:REPO_DIR,label:'读取 origin remote'}));
  if(originRepo!==EXPECTED_REPO)throw new ReleaseError(`origin 指向 ${originRepo}，预期为 ${EXPECTED_REPO}`);
  const repo=capture('gh',['repo','view','--json','nameWithOwner','--jq','.nameWithOwner'],{cwd:REPO_DIR,label:'解析 GitHub 仓库'});
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw new ReleaseError('gh 返回的 GitHub 仓库名无效');
  if(repo!==EXPECTED_REPO)throw new ReleaseError(`gh 当前仓库为 ${repo}，预期为 ${EXPECTED_REPO}`);
  const protection=parseJson(capture('gh',['api',`repos/${repo}/branches/main/protection`],{cwd:REPO_DIR,label:'读取 GitHub main 分支保护'}),'GitHub protection API');
  const checks=parseJson(capture('gh',['api',`repos/${repo}/commits/${head}/check-runs`],{cwd:REPO_DIR,label:'读取 GitHub check runs'}),'GitHub checks API');
  const pulls=parseJson(capture('gh',['api',`repos/${repo}/commits/${head}/pulls`],{cwd:REPO_DIR,label:'读取 GitHub commit pull requests'}),'GitHub pulls API');
  const workflow=parseJson(capture('gh',['api',`repos/${repo}/actions/workflows/ci.yml`],{cwd:REPO_DIR,label:'读取发布 workflow'}),'GitHub workflow API');
  const runs=parseJson(capture('gh',['api',`repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${head}&per_page=20`],{cwd:REPO_DIR,label:'读取发布 workflow runs'}),'GitHub workflow runs API');
  const latestRun=Array.isArray(runs?.workflow_runs)?runs.workflow_runs.filter(run=>run?.workflow_id===workflow.id&&run?.head_sha===head).sort((a,b)=>Number(b.id)-Number(a.id))[0]:null;
  if(!latestRun)throw new ReleaseError(`${RELEASE_WORKFLOW_PATH} 在 ${head} 上没有 workflow run`);
  const jobs=parseJson(capture('gh',['api',`repos/${repo}/actions/runs/${latestRun.id}/jobs`],{cwd:REPO_DIR,label:'读取发布 workflow jobs'}),'GitHub workflow jobs API');
  return {repo,...validateGitHubReleaseReady(protection,checks,pulls,head,workflow,runs,{workflowRunId:latestRun.id,...jobs})};
}

export function parseD1Rows(output){
  let parsed;
  try{parsed=JSON.parse(output);}catch{throw new ReleaseError('Wrangler 返回了无法解析的 D1 JSON');}
  if(!Array.isArray(parsed)||parsed.some(result=>result?.success!==true||!Array.isArray(result.results)))throw new ReleaseError('D1 查询未完整成功');
  return parsed.flatMap(result=>result.results);
}

export function remoteRows(sql){
  const output=capture('npx',['--no-install','wrangler','d1','execute','DB','--remote','--json','--command',sql],{label:'读取远端 D1'});
  return parseD1Rows(output);
}

export function migrationDelta(local,applied){
  const localSet=new Set(local),appliedSet=new Set(applied);
  return {
    pending:local.filter(name=>!appliedSet.has(name)),
    unexpectedRemote:applied.filter(name=>!localSet.has(name)),
  };
}

export function assertRemoteMigrationsCurrent(){
  const local=readdirSync(new URL('../migrations/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort();
  const applied=remoteRows('SELECT name FROM d1_migrations ORDER BY id').map(row=>row.name);
  if(applied.some(name=>typeof name!=='string'))throw new ReleaseError('远端 migration 记录格式无效');
  const delta=migrationDelta(local,applied);
  if(delta.pending.length)throw new ReleaseError(`远端 D1 尚未应用 migration：${delta.pending.join(', ')}`);
  if(delta.unexpectedRemote.length)throw new ReleaseError(`远端 D1 包含当前代码没有的 migration：${delta.unexpectedRemote.join(', ')}`);
  return {local,applied};
}

export function normalizeBaseUrl(value){
  let url;
  try{url=new URL(value);}catch{throw new ReleaseError('readback base URL 无效');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new ReleaseError('readback 仅接受不含凭据、查询参数或片段的 HTTPS URL');
  url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString().replace(/\/$/,'');
}

async function getJson(url,fetchImpl){
  let response;
  try{response=await fetchImpl(url,{headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new ReleaseError(`readback 请求失败：${new URL(url).pathname}`);}
  if(!response.ok)throw new ReleaseError(`readback HTTP ${response.status}：${new URL(url).pathname}`);
  try{return await response.json();}catch{throw new ReleaseError(`readback 返回非 JSON：${new URL(url).pathname}`);}
}

export function validateHealth(data,expectedVersion,expectedEnvironment){
  if(data?.ok!==true||typeof data.environment!=='string'||typeof data.version!=='string')throw new ReleaseError('health 响应缺少 ok、environment 或 version');
  if(data.version!==expectedVersion)throw new ReleaseError(`线上版本 ${data.version} 与预期 ${expectedVersion} 不一致`);
  if(expectedEnvironment&&data.environment!==expectedEnvironment)throw new ReleaseError(`线上环境 ${data.environment} 与预期 ${expectedEnvironment} 不一致`);
  return {environment:data.environment,version:data.version};
}

export async function readEventPagination(baseUrl,fetchImpl=fetch){
  const data=await getJson(`${baseUrl}/api/events?page=1&pageSize=1`,fetchImpl);
  const p=data?.pagination,items=data?.events;
  if(!Array.isArray(items)||!p||p.page!==1||p.pageSize!==1||!Number.isSafeInteger(p.total)||p.total<0||!Number.isSafeInteger(p.totalPages)||p.totalPages!==Math.max(1,p.total))throw new ReleaseError('分页 API 响应格式无效');
  const expectedItems=p.total===0?0:1,expectedNext=p.totalPages>1?2:null;
  if(items.length!==expectedItems||p.nextPage!==expectedNext||items.some(event=>typeof event?.id!=='string'))throw new ReleaseError('分页 API 第一页与 pagination 元数据不一致');
  return {total:p.total,totalPages:p.totalPages,pageSize:p.pageSize,nextPage:p.nextPage};
}

export function summarizeOutbox(rows){
  const summary={};
  for(const row of rows){
    if(typeof row?.status!=='string'||!Number.isSafeInteger(Number(row.count))||Number(row.count)<0)throw new ReleaseError('outbox 汇总格式无效');
    summary[row.status]=Number(row.count);
  }
  return summary;
}

export async function collectReadback({baseUrl=DEFAULT_BASE_URL,expectedVersion=currentHead(),expectedEnvironment,fetchImpl=fetch}={}){
  const normalized=normalizeBaseUrl(baseUrl);
  const health=validateHealth(await getJson(`${normalized}/api/health`,fetchImpl),expectedVersion,expectedEnvironment);
  const events=await readEventPagination(normalized,fetchImpl);
  const outbox=summarizeOutbox(remoteRows('SELECT status, COUNT(*) AS count FROM outbox GROUP BY status ORDER BY status'));
  const dueRows=remoteRows('SELECT COUNT(*) AS count FROM activities WHERE next_due <= unixepoch()*1000');
  const due=Number(dueRows[0]?.count);
  if(dueRows.length!==1||!Number.isSafeInteger(due)||due<0)throw new ReleaseError('到期活动汇总格式无效');
  return {ok:true,baseUrl:normalized,health,events,d1:{outbox,dueActivities:due}};
}

export function parseReadbackArgs(args){
  let baseUrl=process.env.DATA_COFFEE_BASE_URL||DEFAULT_BASE_URL,expectedVersion;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--base-url'&&args[i+1])baseUrl=args[++i];
    else if(args[i]==='--expected-version'&&args[i+1])expectedVersion=args[++i];
    else throw new ReleaseError(`未知或缺值参数：${args[i]}`);
  }
  expectedVersion??=currentHead();
  if(!/^[0-9a-f]{40}$/.test(expectedVersion))throw new ReleaseError('expected version 必须是完整的 40 位 Git SHA');
  return {baseUrl,expectedVersion};
}

export function reportError(error){
  console.error(JSON.stringify({ok:false,error:error instanceof ReleaseError?error.message:'发布脚本发生未知错误'}));
  process.exitCode=1;
}

export function parseMigrationDiff(output){
  const fields=output.split('\0').filter(Boolean),changes=[];
  for(let i=0;i<fields.length;){
    const status=fields[i++];
    if(/^R|^C/.test(status))changes.push({status,paths:[fields[i++],fields[i++]]});
    else changes.push({status,paths:[fields[i++]]});
  }
  if(changes.some(change=>change.paths.some(path=>typeof path!=='string')))throw new ReleaseError('migration diff 格式无效');
  return changes;
}
