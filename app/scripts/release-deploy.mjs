#!/usr/bin/env node
import {setTimeout as delay} from 'node:timers/promises';
import {assertCleanAndCurrent,assertGitHubReleaseReady,assertRemoteMigrationsCurrent,collectReadback,DEFAULT_BASE_URL,ReleaseError,reportError,run} from './release-common.mjs';

try{
  const initial=assertCleanAndCurrent();
  assertGitHubReleaseReady(initial.head);
  assertRemoteMigrationsCurrent();
  run('npm',['ci'],{label:'npm ci'});
  run('npm',['run','check'],{label:'npm run check'});
  run('npm',['test'],{label:'npm test'});
  run('npm',['run','build'],{label:'npm run build'});
  const verified=assertCleanAndCurrent();
  assertGitHubReleaseReady(verified.head);
  assertRemoteMigrationsCurrent();
  if(verified.head!==initial.head)throw new ReleaseError('验证期间 Git HEAD 发生变化');
  run('npx',['--no-install','wrangler','deploy','--strict','--message',`Data Coffee ${verified.head}`,'--var',`APP_VERSION:${verified.head}`],{label:'Wrangler deploy'});
  let result,lastError;
  for(let attempt=1;attempt<=20;attempt++){
    try{result=await collectReadback({baseUrl:DEFAULT_BASE_URL,expectedVersion:verified.head,expectedEnvironment:'production'});break;}
    catch(error){lastError=error;if(attempt<20)await delay(3000);}
  }
  if(!result)throw lastError;
  console.log(JSON.stringify(result,null,2));
}catch(error){reportError(error);}
