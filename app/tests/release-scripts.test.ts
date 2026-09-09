import {describe,expect,it,vi} from 'vitest';
// @ts-expect-error Release scripts are dependency-free JavaScript CLIs.
import {ignoredAssetPaths,migrationDelta,normalizeBaseUrl,parseD1Rows,parseMigrationDiff,readEventPagination,repoFromRemote,summarizeOutbox,validateGitHubReleaseReady,validateHealth} from '../scripts/release-common.mjs';

describe('发布脚本安全门禁',()=>{
  it('识别未应用和远端多出的 migration',()=>{
    expect(migrationDelta(['0001.sql','0002.sql'],['0001.sql','0003.sql'])).toEqual({pending:['0002.sql'],unexpectedRemote:['0003.sql']});
  });
  it('要求受保护 main 上最新的 App Worker check 成功',()=>{
    const head='a'.repeat(40),checks={check_runs:[{id:1,name:'App Worker',status:'completed',conclusion:'failure',app:{id:7}},{id:2,name:'App Worker',status:'completed',conclusion:'success',app:{id:7}}]};
    const protection={enforce_admins:{enabled:true},required_pull_request_reviews:{required_approving_review_count:1,bypass_pull_request_allowances:{users:[],teams:[],apps:[]}},required_status_checks:{checks:[{context:'App Worker',app_id:7}]}};
    const pulls=[{number:9,base:{ref:'main'},merged_at:'2026-09-09T00:00:00Z',merge_commit_sha:head}];
    const workflow={id:42,path:'.github/workflows/ci.yml'};
    const runs={workflow_runs:[{id:81,workflow_id:42,head_sha:head,status:'completed',conclusion:'success'}]};
    const jobs={workflowRunId:81,jobs:[{name:'App Worker',head_sha:head,status:'completed',conclusion:'success'}]};
    expect(validateGitHubReleaseReady(protection,checks,pulls,head,workflow,runs,jobs)).toEqual({adminsEnforced:true,pullRequestReviewsRequired:true,requiredCheck:'App Worker',workflow:{id:42,path:'.github/workflows/ci.yml',runId:81},pullRequest:9,check:{name:'App Worker',status:'completed',conclusion:'success',appId:7}});
    expect(()=>validateGitHubReleaseReady({...protection,enforce_admins:{enabled:false}},checks,pulls,head,workflow,runs,jobs)).toThrow('管理员');
    expect(()=>validateGitHubReleaseReady({...protection,required_pull_request_reviews:{...protection.required_pull_request_reviews,bypass_pull_request_allowances:{users:[{}]}}},checks,pulls,head,workflow,runs,jobs)).toThrow('bypass');
    expect(()=>validateGitHubReleaseReady({...protection,required_status_checks:{contexts:['App Worker']}},checks,pulls,head,workflow,runs,jobs)).toThrow('GitHub App');
    expect(()=>validateGitHubReleaseReady({...protection,required_status_checks:{checks:[{context:'App Worker',app_id:8}]}},checks,pulls,head,workflow,runs,jobs)).toThrow('找不到');
    expect(()=>validateGitHubReleaseReady(protection,checks,[],head,workflow,runs,jobs)).toThrow('已合并');
    expect(()=>validateGitHubReleaseReady(protection,checks,pulls,head,{...workflow,path:'.github/workflows/other.yml'},runs,jobs)).toThrow('路径');
    expect(()=>validateGitHubReleaseReady(protection,checks,pulls,head,workflow,{workflow_runs:[{...runs.workflow_runs[0],workflow_id:99}]},jobs)).toThrow('workflow run');
    expect(()=>validateGitHubReleaseReady(protection,checks,pulls,head,workflow,runs,{workflowRunId:82,jobs:jobs.jobs})).toThrow('不属于');
  });
  it('枚举静态资源目录中的 ignored 文件',()=>{
    expect(ignoredAssetPaths('app/web/.DS_Store\napp/web/private.txt\n')).toEqual(['app/web/.DS_Store','app/web/private.txt']);
  });
  it('从 SSH alias 或 HTTPS origin 解析仓库身份',()=>{
    expect(repoFromRemote('git@github-personal:zhaidewei/data_coffee.git')).toBe('zhaidewei/data_coffee');
    expect(repoFromRemote('https://github.com/zhaidewei/data_coffee.git')).toBe('zhaidewei/data_coffee');
  });
  it('migration history 能区分新增和重命名',()=>{
    expect(parseMigrationDiff('A\0app/migrations/0007.sql\0')).toEqual([{status:'A',paths:['app/migrations/0007.sql']}]);
    expect(parseMigrationDiff('R100\0app/migrations/0001.sql\0app/migrations/renamed.sql\0')).toEqual([{status:'R100',paths:['app/migrations/0001.sql','app/migrations/renamed.sql']}]);
  });
  it('只接受无凭据的 HTTPS readback 地址',()=>{
    expect(normalizeBaseUrl('https://example.com/')).toBe('https://example.com');
    expect(()=>normalizeBaseUrl('http://example.com')).toThrow('HTTPS');
    expect(()=>normalizeBaseUrl('https://token@example.com')).toThrow('凭据');
  });
  it('验证部署版本并只保留安全 health 字段',()=>{
    expect(validateHealth({ok:true,environment:'production',version:'a'.repeat(40),extra:'ignored'},'a'.repeat(40),'production')).toEqual({environment:'production',version:'a'.repeat(40)});
    expect(()=>validateHealth({ok:true,environment:'production',version:'b'.repeat(40)},'a'.repeat(40))).toThrow('不一致');
    expect(()=>validateHealth({ok:true,environment:'development',version:'a'.repeat(40)},'a'.repeat(40),'production')).toThrow('环境');
  });
  it('解析 D1 JSON 和 outbox 聚合，不读取明细',()=>{
    const rows=parseD1Rows(JSON.stringify([{success:true,results:[{status:'pending',count:2}]}]));
    expect(summarizeOutbox(rows)).toEqual({pending:2});
    expect(()=>parseD1Rows(JSON.stringify([{success:false,results:[]}]))).toThrow('未完整成功');
  });
  it('用一页核对线上 pagination 元数据',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({events:[{id:'event-1'}],pagination:{page:1,pageSize:1,total:2,totalPages:2,nextPage:2}})));
    await expect(readEventPagination('https://example.com',fetch)).resolves.toEqual({total:2,totalPages:2,pageSize:1,nextPage:2});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('拒绝第一页与 pagination 元数据不一致',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({events:[],pagination:{page:1,pageSize:1,total:2,totalPages:2,nextPage:2}})));
    await expect(readEventPagination('https://example.com',fetch)).rejects.toThrow('不一致');
  });
});
