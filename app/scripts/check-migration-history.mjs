#!/usr/bin/env node
import {capture,parseMigrationDiff,REPO_DIR,ReleaseError,reportError} from './release-common.mjs';

try{
  const [base,head]=process.argv.slice(2);
  if(!/^[0-9a-f]{40}$/.test(base??'')||!/^[0-9a-f]{40}$/.test(head??''))throw new ReleaseError('migration history check 需要 base 和 head 两个完整 Git SHA');
  if(/^0+$/.test(base)){console.log(JSON.stringify({ok:true,skipped:'initial push'}));}
  else {
    const output=capture('git',['diff','--name-status','-z','--find-renames',base,head,'--','app/migrations'],{cwd:REPO_DIR,label:'读取 migration diff',trim:false});
    const changes=parseMigrationDiff(output),forbidden=changes.filter(change=>change.status!=='A');
    if(forbidden.length)throw new ReleaseError(`已有 migration 不可修改、删除或重命名：${forbidden.flatMap(change=>change.paths).join(', ')}`);
    console.log(JSON.stringify({ok:true,added:changes.flatMap(change=>change.paths)}));
  }
}catch(error){reportError(error);}
