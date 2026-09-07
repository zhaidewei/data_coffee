import {describe,it,expect} from 'vitest';
import {applyCommand,createActivity,reconcile} from '../worker/engine';
import type {Activity,Command,Notice,Rules} from '../worker/types';

const t=Date.UTC(2026,8,5,10);
const rules:Rules={minPeople:1,maxPeople:1,waitlist:true,recruitmentDeadline:t+3600000,startsAt:t+7200000,endsAt:t+10800000,registrationDeadline:t+6900000,promotionDeadline:t+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:true,continuousCohosts:true,continuousHosts:true,addressVisibility:'participants'};
function act(e:Activity,cmd:Command,userId:string,at:number){const out:Notice[]=[];reconcile(e,at,out);applyCommand(e,cmd,userId,at,out);return out;}
function event(){
  const e=createActivity({title:'回归活动',city:'Amsterdam',description:'第一版介绍',rules},'owner',t);
  act(e,{action:'publish'},'owner',t);
  act(e,{action:'join'},'member',t+1);
  act(e,{action:'join'},'waiting',t+2);
  return e;
}
describe('独立评审回归',()=>{
  it('开始后发布者仍可紧急取消并通知成员',()=>{
    const e=event();const out=act(e,{action:'cancel',reason:'现场发生紧急情况'},'owner',rules.startsAt+1);
    expect(e.status).toBe('cancelled');expect(e.reason).toBe('现场发生紧急情况');
    expect(out.filter(n=>n.subject==='活动已取消').map(n=>n.userId).sort()).toEqual(['member','owner','waiting']);
  });
  it('开始后取消仍仅允许发布者',()=>{
    const e=event();
    expect(()=>act(e,{action:'cancel',reason:'未经授权'},'member',rules.startsAt+1)).toThrow('仅本场发布者');
    expect(e.status).toBe('confirmed');
  });
  it('开始后候补可以退出且不改变正式名额',()=>{
    const e=event();act(e,{action:'leave'},'waiting',rules.startsAt+1);
    expect(e.participants.find(p=>p.userId==='waiting')?.status).toBe('left');
    expect(e.participants.find(p=>p.userId==='member')?.status).toBe('joined');
    expect(e.repairs).toHaveLength(0);
  });
  it('开始后正式报名退出、新报名和介绍修改仍关闭',()=>{
    const e=event();
    for(const [cmd,userId] of [[{action:'leave'},'member'],[{action:'join'},'new'],[{action:'describe',description:'修改'},'owner']] as [Command,string][]){
      expect(()=>act(e,cmd,userId,rules.startsAt+1)).toThrow('活动已开始');
    }
  });
  it('已结束和已取消的活动仍保持终态',()=>{
    const completed=event();expect(()=>act(completed,{action:'cancel',reason:'结束后取消'},'owner',rules.endsAt)).toThrow('活动已结束或取消');
    expect(()=>act(completed,{action:'leave'},'waiting',rules.endsAt)).toThrow('活动已结束或取消');
    const cancelled=event();act(cancelled,{action:'cancel',reason:'提前取消'},'owner',t+3);
    expect(()=>act(cancelled,{action:'leave'},'waiting',t+4)).toThrow('活动已结束或取消');
  });
  it('连续介绍更正保留每次前后正文和时间且不改变规则',()=>{
    const e=event();const originalRules=structuredClone(e.rules);
    act(e,{action:'describe',description:'第二版介绍'},'owner',t+3);
    act(e,{action:'describe',description:'第三版介绍'},'owner',t+4);
    const restored=JSON.parse(JSON.stringify(e)) as Activity;
    expect(restored.receipts.filter(r=>r.kind==='description').map(r=>({at:r.at,...r.descriptionChange}))).toEqual([
      {at:t+3,before:'第一版介绍',after:'第二版介绍'},
      {at:t+4,before:'第二版介绍',after:'第三版介绍'},
    ]);
    expect(restored.description).toBe('第三版介绍');expect(restored.rules).toEqual(originalRules);
  });
});
