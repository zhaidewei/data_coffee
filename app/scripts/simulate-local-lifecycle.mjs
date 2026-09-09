import {spawnSync} from 'node:child_process';

const base='http://localhost:8787',hour=3600000,day=86400000,startedAt=Date.now();
const emails={alice:'alice@data-coffee.local',bob:'bob@data-coffee.local',chen:'chen@data-coffee.local',dana:'dana@data-coffee.local'};

async function request(path,{method='GET',cookie,body,key}={}){
  const headers={};
  if(cookie)headers.cookie=cookie;
  if(body)headers['content-type']='application/json';
  if(key)headers['idempotency-key']=key;
  const response=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${data.error}`);
  return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function login(email){
  const issued=await request('/api/auth/request',{method:'POST',body:{email}});
  if(!issued.data.developmentCode)throw new Error('本地开发验证码未启用，请先运行 npm run dev');
  return (await request('/api/auth/verify',{method:'POST',body:{email,code:issued.data.developmentCode}})).cookie;
}
function sql(statement){
  const result=spawnSync('npx',['wrangler','d1','execute','DB','--local','--command',statement],{encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr||result.stdout);
}

const sessions={};
for(const [name,email] of Object.entries(emails))sessions[name]=await login(email);
const slots=[
  {id:'life-a',startsAt:startedAt+7*day,endsAt:startedAt+7*day+2*hour},
  {id:'life-b',startsAt:startedAt+14*day,endsAt:startedAt+14*day+2*hour},
];
const rules={timeSlots:slots,minPeople:3,maxPeople:3,waitlist:true,recruitmentDeadline:startedAt+4*day,startsAt:slots[0].startsAt,endsAt:slots[0].endsAt,registrationDeadline:startedAt+6*day,promotionDeadline:startedAt+6*day,repairMinutes:120,venueRequired:true,minTalks:0,minCohosts:0,minHosts:1,allowRoleOverlap:true,continuousVenue:true,continuousTalks:false,continuousCohosts:false,continuousHosts:true,addressVisibility:'participants'};
let event=(await request('/api/events',{method:'POST',cookie:sessions.alice,body:{title:'完整生命周期模拟咖啡',city:'Amsterdam',description:'四个模拟账户执行创建、报名、成行、补齐与结束。',rules}})).data.event;
let sequence=0;
const act=async(user,action,extra={})=>{
  event=(await request(`/api/events/${event.id}/actions`,{method:'POST',cookie:sessions[user],key:`lifecycle-${event.id}-${++sequence}`,body:{action,version:event.version,...extra}})).data.event;
};
const steps=[];
const note=label=>steps.push({step:label,status:event.status,joined:event.counts.joined,waitlisted:event.counts.waitlisted,version:event.version});

note('Alice 创建草稿');
await act('alice','publish');note('Alice 发布活动');
for(const user of ['alice','bob','chen','dana'])await act(user,'join',{availableSlotIds:['life-a','life-b'],transportPreferences:[user==='dana'?'car':'public_transport'],registrationMessage:`${user} 参加完整流程测试`});
note('四人报名，第四人进入候补');
await act('bob','apply',{kind:'venue',title:'场地 A',detail:'靠近车站',address:'Amsterdam 测试地址 A',capacity:3});
const venueA=event.applications.find(item=>item.userId==='dev-bob'&&item.kind==='venue').id;
await act('dana','apply',{kind:'venue',title:'备用场地 B',detail:'备用空间',address:'Amsterdam 测试地址 B',capacity:4});
const venueB=event.applications.find(item=>item.userId==='dev-dana'&&item.kind==='venue').id;
await act('chen','apply',{kind:'host',title:'主持人 Chen',detail:'负责现场节奏'});
const host=event.applications.find(item=>item.userId==='dev-chen'&&item.kind==='host').id;
note('提交两个场地和主持人申请');
await act('alice','select_time',{slotId:'life-a'});
await act('alice','review',{applicationId:venueA,approved:true});
await act('alice','review',{applicationId:host,approved:true});note('确认时间、场地与主持人');

const deadline=Date.now()-1000;
sql(`UPDATE activities SET document=json_set(document,'$.rules.recruitmentDeadline',${deadline}),next_due=${deadline} WHERE id='${event.id}'`);
event=(await request(`/api/events/${event.id}`,{cookie:sessions.alice})).data.event;note('征集截止，自动成行');
await act('bob','leave');note('Bob 退出，候补自动递补');
await act('bob','withdraw',{applicationId:venueA});note('场地撤回，进入限时补齐');
await act('alice','review',{applicationId:venueB,approved:true});note('确认备用场地，恢复成行');

const startsAt=Date.now()-2*hour,endsAt=Date.now()-hour;
sql(`UPDATE activities SET document=json_set(document,'$.rules.startsAt',${startsAt},'$.rules.endsAt',${endsAt},'$.rules.timeSlots[0].startsAt',${startsAt},'$.rules.timeSlots[0].endsAt',${endsAt}),next_due=${endsAt} WHERE id='${event.id}'`);
event=(await request(`/api/events/${event.id}`,{cookie:sessions.alice})).data.event;note('活动时间结束，自动完成');
if(event.status!=='completed')throw new Error(`最终状态应为 completed，实际为 ${event.status}`);
console.log(JSON.stringify({eventId:event.id,title:event.title,steps},null,2));
