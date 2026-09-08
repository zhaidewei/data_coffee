import {describe,it,expect} from 'vitest';
import {applyCommand,conditions,createActivity,normalizeTags,reconcile,isManager,nextDue} from '../worker/engine';
import type {Activity,Notice,Rules} from '../worker/types';
const t=Date.UTC(2026,8,5,10);
const rules=(r:Partial<Rules>={}):Rules=>({minPeople:3,maxPeople:3,waitlist:true,recruitmentDeadline:t+3600000,startsAt:t+7200000,endsAt:t+10800000,registrationDeadline:t+6900000,promotionDeadline:t+6900000,repairMinutes:10,venueRequired:false,minTalks:0,minCohosts:0,minHosts:0,allowRoleOverlap:true,continuousVenue:true,continuousTalks:true,continuousCohosts:true,continuousHosts:true,addressVisibility:'participants',...r});
function event(r:Partial<Rules>={}):Activity{const e=createActivity({title:'测试咖啡',city:'Amsterdam',description:'',rules:rules(r)},'owner',t);applyCommand(e,{action:'publish'},'owner',t,[]);return e;}
function act(e:Activity,action:string,user:string,at=t+1000,more:Record<string,unknown>={}){const out:Notice[]=[];reconcile(e,at,out);applyCommand(e,{action,...more},user,at,out);return out;}
describe('确定性业务规则',()=>{
 it('校验规则与发布锁定',()=>{expect(()=>event({minPeople:4})).toThrow();const e=event();expect(()=>act(e,'edit','owner')).toThrow('锁定');});
 it('截止满足则成团，不足则取消且不能救活',()=>{const e=event();act(e,'join','a');act(e,'join','b');act(e,'join','support');reconcile(e,t+3600001,[]);expect(e.status).toBe('confirmed');expect(e.receipts.at(-1)?.at).toBe(t+3600000);const bad=event();reconcile(bad,t+3600001,[]);expect(bad.status).toBe('cancelled');expect(()=>act(bad,'join','a',t+3600002)).toThrow();});
 it('退出优先候补并发入选通知',()=>{const e=event({maxPeople:3});for(const u of ['a','b','support','c'])act(e,'join',u);reconcile(e,t+3600000,[]);const out=act(e,'leave','a',t+3700000);expect(e.participants.find(p=>p.userId==='c')?.status).toBe('joined');expect(out.some(n=>n.userId==='c'&&n.subject.includes('入选'))).toBe(true);expect(e.repairs).toHaveLength(0);});
 it('始终维持最低人数，不足新报名不延长倒计时，补齐才解除',()=>{const e=event({minPeople:3,maxPeople:5});for(const u of ['a','b','c'])act(e,'join',u);reconcile(e,t+3600000,[]);act(e,'leave','a',t+3700000);const deadline=e.repairs[0].deadline;act(e,'leave','b',t+3701000);act(e,'join','d',t+3702000);expect(e.repairs[0].deadline).toBe(deadline);act(e,'join','f',t+3703000);expect(e.status).toBe('confirmed');expect(e.repairs).toHaveLength(0);});
 it('报名截止不阻止人数补齐，到期不足取消',()=>{const e=event({registrationDeadline:t+3600000});act(e,'join','a');act(e,'join','b');act(e,'join','support');reconcile(e,t+3600000,[]);act(e,'leave','a',t+3700000);act(e,'join','c',t+3700100);expect(e.status).toBe('confirmed');act(e,'leave','b',t+3700200);reconcile(e,t+4400000,[]);expect(e.status).toBe('cancelled');});
 it('场地和人数独立异常，未审核提案无效',()=>{const e=event({venueRequired:true});act(e,'apply','v',t+1000,{kind:'venue',title:'场地',detail:'',address:'地址',capacity:3});act(e,'review','owner',t+2000,{applicationId:e.applications[0].id,approved:true});act(e,'join','a');act(e,'join','b');act(e,'join','support');reconcile(e,t+3600000,[]);act(e,'withdraw','v',t+3700000,{applicationId:e.applications[0].id});act(e,'leave','a',t+3700100);expect(e.repairs.map(r=>r.key).sort()).toEqual(['people','venue']);act(e,'apply','v2',t+3700200,{kind:'venue',title:'新场地',detail:'',address:'地址2',capacity:3});expect(e.repairs).toHaveLength(2);act(e,'review','owner',t+3700300,{applicationId:e.applications[1].id,approved:true});expect(e.repairs.map(r=>r.key)).toEqual(['people']);});
  it('报名时保存偏好且已报名者可以更新',()=>{const e=event();act(e,'join','a',t+1000,{timePreference:'周六下午',placePreference:'Amsterdam'});expect(e.participants[0]).toMatchObject({timePreference:'周六下午',placePreference:'Amsterdam'});act(e,'join','a',t+2000,{timePreference:'周日下午',placePreference:'Utrecht'});expect(e.participants).toHaveLength(1);expect(e.participants[0]).toMatchObject({timePreference:'周日下午',placePreference:'Utrecht'});});
 it('活动结束是终态',()=>{const e=event();act(e,'join','a');act(e,'join','b');act(e,'join','support');reconcile(e,t+10800001,[]);expect(e.status).toBe('completed');expect(()=>act(e,'join','c',t+10800002)).toThrow();});
 it('候补截止不递补、可以退出',()=>{const e=event({maxPeople:3,promotionDeadline:t+3600000});for(const u of ['a','b','support','c'])act(e,'join',u);reconcile(e,t+3600000,[]);act(e,'leave','a',t+3700000);expect(e.participants.find(p=>p.userId==='c')?.status).toBe('waitlisted');act(e,'leave','c',t+3700010);expect(e.participants.find(p=>p.userId==='c')?.status).toBe('left');});
});

it('交通多选与留言可更新清空，拒绝无效输入',()=>{const e=event();act(e,'join','a',t+1000,{transportPreferences:['public_transport','car'],registrationMessage:'大家好'});expect(e.participants[0]).toMatchObject({transportPreferences:['public_transport','car'],registrationMessage:'大家好'});act(e,'join','a',t+2000,{transportPreferences:[],registrationMessage:''});expect(e.participants[0]).toMatchObject({transportPreferences:[],registrationMessage:''});expect(()=>act(e,'join','a',t+3000,{transportPreferences:['plane']})).toThrow();expect(()=>act(e,'join','a',t+3000,{registrationMessage:'a'.repeat(501)})).toThrow();});

it('只有发起人可以公开回复报名留言并通知成员',()=>{const e=event();act(e,'join','a',t+1000,{registrationMessage:'需要自带电脑吗？'});expect(()=>act(e,'reply_registration','b',t+2000,{participantId:'a',reply:'需要'})).toThrow('发布者');const out=act(e,'reply_registration','owner',t+3000,{participantId:'a',reply:'不用带，现场会准备。'});expect(e.participants[0]).toMatchObject({registrationReply:'不用带，现场会准备。',registrationRepliedAt:t+3000});expect(out).toContainEqual(expect.objectContaining({userId:'a',subject:'发起人回复了你的报名留言'}));expect(()=>act(e,'reply_registration','owner',t+4000,{participantId:'missing',reply:'回复'})).toThrow('不存在');expect(()=>act(e,'reply_registration','owner',t+4000,{participantId:'a',reply:'a'.repeat(501)})).toThrow();});

const slots=[{id:'sat',startsAt:t+7200000,endsAt:t+10800000},{id:'sun',startsAt:t+86400000,endsAt:t+90000000}];
it('时段投票不能替代最终确认，人数按最终时段计算',()=>{const e=event({timeSlots:slots});act(e,'join','a',t+1000,{availableSlotIds:['sat']});act(e,'join','b',t+1100,{availableSlotIds:['sun']});expect(conditions(e).find(c=>c.key==='people')?.current).toBe(0);expect(()=>act(e,'select_time','a',t+1200,{slotId:'sat'})).toThrow();act(e,'select_time','owner',t+1300,{slotId:'sun'});expect(e.rules.startsAt).toBe(slots[1].startsAt);expect(conditions(e).find(c=>c.key==='people')?.current).toBe(1);expect(e.participants[0].status).toBe('left');expect(()=>act(e,'select_time','owner',t+1400,{slotId:'sat'})).toThrow();reconcile(e,t+3600000,[]);expect(e.status).toBe('cancelled');});
it('未确认时间即使投票充足仍取消',()=>{const e=event({timeSlots:slots});for(const u of ['a','b','c'])act(e,'join',u,t+1000,{availableSlotIds:['sat','sun']});reconcile(e,t+3600000,[]);expect(e.status).toBe('cancelled');});
it('候选时段独立收集意向，最终席位与候补遵循顺序和可参加时间',()=>{const e=event({timeSlots:slots,maxPeople:3});act(e,'join','a',t+1000,{availableSlotIds:['sun']});for(const u of ['b','c','support','d'])act(e,'join',u,t+1000,{availableSlotIds:['sat']});act(e,'select_time','owner',t+2000,{slotId:'sat'});expect(e.participants.map(p=>p.status)).toEqual(['left','joined','joined','joined','waitlisted']);act(e,'leave','b',t+2100);expect(e.participants[0].status).toBe('left');expect(e.participants[4].status).toBe('joined');expect(()=>act(e,'join','a',t+2200,{availableSlotIds:['sun']})).toThrow();reconcile(e,t+3600000,[]);expect(e.status).toBe('confirmed');});
it('拒绝无效时段和空投票，允许多选及修改',()=>{expect(()=>event({timeSlots:[slots[0],slots[0]]})).toThrow();const e=event({timeSlots:slots});expect(()=>act(e,'join','a',t+1000,{availableSlotIds:[]})).toThrow();expect(()=>act(e,'join','a',t+1000,{availableSlotIds:['missing']})).toThrow();act(e,'join','a',t+1000,{availableSlotIds:['sat','sun']});act(e,'join','a',t+2000,{availableSlotIds:['sun']});expect(e.participants[0].availableSlotIds).toEqual(['sun']);});

it('发起人发布不自动报名，主动报名才计入人数',()=>{const e=event();expect(e.participants).toHaveLength(0);expect(conditions(e).find(c=>c.key==='people')?.current).toBe(0);act(e,'join','owner');expect(conditions(e).find(c=>c.key==='people')?.current).toBe(1);act(e,'join','owner');expect(e.participants).toHaveLength(1);});

it('不开放候补时超额意向结束报名并通知',()=>{const e=event({timeSlots:slots,maxPeople:3,waitlist:false});for(const u of ['a','b','support','c'])act(e,'join',u,t+1000,{availableSlotIds:['sat']});const out=act(e,'select_time','owner',t+2000,{slotId:'sat'});expect(e.participants.map(p=>p.status)).toEqual(['joined','joined','joined','left']);expect(out.some(n=>n.userId==='c'&&n.subject==='报名未入选')).toBe(true);});
it('退休类型不能新申请或批准，历史协办没有管理权',()=>{const e=event();for(const kind of ['talk','cohost'])expect(()=>act(e,'apply','a',t+1000,{kind,title:'申请',detail:''})).toThrow('MVP');e.applications.push({id:'old',userId:'co',kind:'cohost',title:'历史',detail:'',status:'pending',updatedAt:t});expect(()=>act(e,'review','owner',t+1000,{applicationId:'old',approved:true})).toThrow('MVP');e.applications[0].status='approved';expect(isManager(e,'co')).toBe(false);});
it('切换场地更新备用记录并通知原提供人',()=>{const e=event();for(const u of ['a','b'])act(e,'apply',u,t+1000,{kind:'venue',title:u,detail:'',address:'地址',capacity:3});act(e,'review','owner',t+2000,{applicationId:e.applications[0].id,approved:true});const out=act(e,'review','owner',t+3000,{applicationId:e.applications[1].id,approved:true});expect(e.applications[0]).toMatchObject({status:'pending',updatedAt:t+3000,reviewedBy:'owner'});expect(out.some(n=>n.userId==='a'&&n.subject==='场地已转为备用')).toBe(true);});


describe('人数与主持人数边界',()=>{
 it.each([{minPeople:3,maxPeople:3,minHosts:0},{minPeople:100,maxPeople:100,minHosts:10}])('接受包含端点的合法规则 %j',r=>{expect(()=>event(r)).not.toThrow();});
 it.each([{minPeople:2},{minPeople:101,maxPeople:101},{maxPeople:2},{maxPeople:101},{minPeople:3.5,maxPeople:4},{maxPeople:3.5},{minHosts:-1},{minHosts:11},{minHosts:0.5},{minPeople:4,maxPeople:3}])('拒绝越界、小数或倒置规则 %j',r=>{expect(()=>event(r)).toThrow();});
});

it('规范化标签并拒绝无效输入',()=>{
 expect(normalizeTags([' SQL ','sql','ＡＩ','数据  平台'])).toEqual(['sql','AI','数据 平台']);
 expect(normalizeTags(undefined)).toEqual([]);
 for(const value of ['SQL',[''],['<script>'],['a'.repeat(21)],Array(6).fill('a')])expect(()=>normalizeTags(value)).toThrow();
});
it('介绍更新可复用标签且不改变成行规则',()=>{const e=event(),before=structuredClone(e.rules);act(e,'describe','owner',t+1000,{description:'聊 AI',tags:['AI','ai','职场']});expect(e.tags).toEqual(['ai','职场']);expect(e.rules).toEqual(before);expect(()=>act(e,'describe','other',t+2000,{description:'改写',tags:['创业']})).toThrow();expect(e.tags).toEqual(['ai','职场']);act(e,'describe','owner',t+3000,{description:'继续聊'});expect(e.tags).toEqual(['ai','职场']);});
it('超过8人必须确认场地，8人可选',()=>{expect(event({maxPeople:8}).rules.venueRequired).toBe(false);const e=event({maxPeople:9});expect(e.rules.venueRequired).toBe(true);expect(conditions(e).find(c=>c.key==='venue')?.required).toBe(9);for(const u of ['a','b','c'])act(e,'join',u);reconcile(e,t+3600000,[]);expect(e.status).toBe('cancelled');});
it('旧草稿发布时补上大场地要求',()=>{const e=createActivity({title:'旧草稿',city:'Amsterdam',rules:rules({maxPeople:9})},'owner',t);e.rules.venueRequired=false;applyCommand(e,{action:'publish'},'owner',t,[]);expect(e.rules.venueRequired).toBe(true);});

describe('相对截止与候补确认',()=>{
 const hour=3600000;
 const relative=()=>event({startsAt:t+72*hour,endsAt:t+74*hour,registrationLeadHours:24,promotionLeadHours:4,repairMinutes:10080});
 it('按最终候选日期重新计算截止',()=>{
  const timeSlots=[{id:'early',startsAt:t+72*hour,endsAt:t+74*hour},{id:'late',startsAt:t+144*hour,endsAt:t+146*hour}];
  const e=event({...relative().rules,timeSlots});
  expect(e.rules.registrationDeadline).toBe(t+48*hour);
  act(e,'select_time','owner',t+2000,{slotId:'late'});
  expect(e.rules.registrationDeadline).toBe(t+120*hour);
  expect(e.rules.promotionDeadline).toBe(t+140*hour);
 });
 it('候补名额保留但不计入人数，报名截止后仍可本人确认',()=>{
  const e=relative();for(const u of ['a','b','c','d'])act(e,'join',u);
  const out=act(e,'leave','a',t+49*hour);
  expect(e.participants[3]).toMatchObject({status:'waitlisted',promotionOfferUntil:t+68*hour});
  expect(conditions(e).find(c=>c.key==='people')?.current).toBe(2);
  expect(out.filter(n=>n.subject==='有候补名额，请确认参加')).toHaveLength(1);
  const repeated:Notice[]=[];reconcile(e,t+49*hour+1,repeated);expect(repeated).toHaveLength(0);
  act(e,'join','newcomer',t+49*hour+2);expect(e.participants.at(-1)?.status).toBe('waitlisted');
  act(e,'join','d',t+49*hour+3);
  expect(e.participants[3].status).toBe('joined');expect(e.participants[3].promotionOfferUntil).toBeUndefined();
  expect(e.status).toBe('confirmed');
 });
 it('退出候补立即释放保留名额给下一位',()=>{
  const e=relative();for(const u of ['a','b','c','d','f'])act(e,'join',u);
  act(e,'leave','a',t+2*hour);act(e,'leave','d',t+2*hour+1);
  expect(e.participants[3].promotionOfferUntil).toBeUndefined();
  expect(e.participants[4]).toMatchObject({status:'waitlisted',promotionOfferUntil:t+68*hour});
 });
 it('截止之后不会凭过期邀请接受名额',()=>{
  const e=relative();for(const u of ['a','b','c','d'])act(e,'join',u);
  act(e,'leave','a',t+67*hour);
  expect(()=>act(e,'join','d',t+68*hour)).toThrow('候补确认已截止');
 });
 it.each([-1,169,1.5,NaN])('拒绝无效提前小时数 %s',n=>expect(()=>event({...relative().rules,registrationLeadHours:n})).toThrow());
});

it('候补邀请的确认期限不晚于人数补齐期限',()=>{const h=3600000;const e=event({startsAt:t+72*h,endsAt:t+74*h,registrationLeadHours:24,promotionLeadHours:4,repairMinutes:60});for(const u of ['a','b','c','d'])act(e,'join',u);act(e,'leave','a',t+2*h);expect(e.participants[3].promotionOfferUntil).toBe(t+3*h);expect(e.repairs[0].deadline).toBe(t+3*h);});

describe('候补邀请的容量与提前过期边界',()=>{
 const h=3600000;
 const setup=()=>{const e=event({maxPeople:4,startsAt:t+72*h,endsAt:t+74*h,registrationLeadHours:24,promotionLeadHours:4,repairMinutes:60});for(const u of ['a','b','c','d','e','f','g'])act(e,'join',u);return e;};
 it('后续人数不足会收紧已有邀请期限并通知，未确认邀请不能解除补齐',()=>{
  const e=setup();act(e,'leave','a',t+2*h);
  expect(e.participants[4].promotionOfferUntil).toBe(t+68*h);
  const out=act(e,'leave','b',t+2*h+1000),deadline=t+3*h+1000;
  expect(e.participants[4].promotionOfferUntil).toBe(deadline);
  expect(e.participants[5].promotionOfferUntil).toBe(deadline);
  expect(e.status).toBe('repairing');expect(conditions(e).find(c=>c.key==='people')?.current).toBe(2);
  expect(out.some(n=>n.userId==='e'&&n.subject==='候补确认期限已更新')).toBe(true);
  const repeated:Notice[]=[];reconcile(e,t+2*h+1001,repeated);expect(repeated).toHaveLength(0);
  expect(()=>act(e,'join','e',deadline)).toThrow('结束或取消');
  expect(e.status).toBe('cancelled');expect(e.receipts.at(-1)?.at).toBe(deadline);
 });
 it('恢复人数后提前过期的保留名额自动递给下一位，不重复唤醒或通知',()=>{
  const e=setup();act(e,'leave','a',t+2*h);act(e,'leave','b',t+2*h+1000);
  act(e,'join','e',t+2*h+2000);expect(e.status).toBe('confirmed');
  const deadline=t+3*h+1000;expect(nextDue(e)).toBe(deadline);
  const out:Notice[]=[];reconcile(e,deadline,out);
  expect(e.participants[5]).toMatchObject({status:'waitlisted',promotionOfferUntil:deadline});
  expect(e.participants[6]).toMatchObject({status:'waitlisted',promotionOfferUntil:t+68*h});
  expect(out.filter(n=>n.subject==='有候补名额，请确认参加')).toHaveLength(1);
  expect(nextDue(e)).toBe(t+68*h);
  const repeated:Notice[]=[];reconcile(e,deadline+1,repeated);expect(repeated).toHaveLength(0);
  expect(()=>act(e,'join','f',deadline+2)).toThrow('候补确认已截止');
  act(e,'join','new',deadline+3);expect(e.participants.at(-1)?.status).toBe('waitlisted');
  act(e,'join','g',deadline+4);expect(e.participants.filter(p=>p.status==='joined')).toHaveLength(4);
  expect(nextDue(e)).toBe(e.rules.endsAt);
 });
 it('过期者退出再报名会清理旧邀请标记，重新排队后的邀请仍安排定时器',()=>{
  const e=setup();act(e,'leave','a',t+2*h);act(e,'leave','b',t+2*h+1000);act(e,'join','e',t+2*h+2000);
  const deadline=t+3*h+1000;reconcile(e,deadline,[]);
  act(e,'leave','f',deadline+1);act(e,'join','f',deadline+2);
  expect(e.participants[5].promotionOfferExpired).toBeUndefined();
  act(e,'leave','g',deadline+3);
  expect(e.participants[5].promotionOfferUntil).toBe(t+68*h);expect(nextDue(e)).toBe(t+68*h);
 });
 it('征集阶段发出的邀请在征集截止同步过期，不留下过去的定时器',()=>{
  const e=event({maxPeople:4,promotionLeadHours:1});for(const u of ['a','b','c','d','e'])act(e,'join',u);
  act(e,'leave','a',t+2000);expect(nextDue(e)).toBe(e.rules.recruitmentDeadline);
  reconcile(e,e.rules.recruitmentDeadline,[]);expect(e.status).toBe('confirmed');
  expect(e.participants[4]).toMatchObject({status:'waitlisted',promotionOfferExpired:true});
  expect(nextDue(e)).toBe(e.rules.endsAt);
 });
 it('到邀请截止时间解除保留后，定时器推进到下一业务截止',()=>{
  const e=setup();act(e,'leave','a',t+2*h);expect(nextDue(e)).toBe(t+68*h);
  const out:Notice[]=[];reconcile(e,t+68*h,out);
  expect(nextDue(e)).toBe(e.rules.endsAt);
  expect(out.filter(n=>n.subject==='有候补名额，请确认参加')).toHaveLength(0);
  expect(()=>act(e,'join','e',t+68*h)).toThrow('候补确认已截止');
 });
 it('提前小时数为零允许到开始前确认，开始时拒绝',()=>{
  const e=event({maxPeople:4,promotionLeadHours:0,registrationLeadHours:0});
  for(const u of ['a','b','c','d','e'])act(e,'join',u);
  act(e,'leave','a',t+3700000);expect(e.participants[4].promotionOfferUntil).toBe(e.rules.startsAt);
  const justBefore=structuredClone(e);act(justBefore,'join','e',e.rules.startsAt-1);
  expect(justBefore.participants[4].status).toBe('joined');
  expect(()=>act(e,'join','e',e.rules.startsAt)).toThrow('活动已开始');
 });
});

it('同一人可提交多个容量待确认的候选场地，确认时补容量',()=>{const e=event();for(const address of ['地址A','地址B'])act(e,'apply','owner',t+1000,{kind:'venue',title:address,address});expect(e.applications).toHaveLength(2);expect(e.applications[0].capacity).toBeUndefined();expect(()=>act(e,'review','owner',t+2000,{applicationId:e.applications[0].id,approved:true})).toThrow('实际可容纳人数');act(e,'review','owner',t+3000,{applicationId:e.applications[0].id,approved:true,capacity:8});expect(e.applications[0].capacity).toBe(8);expect(e.applications[1].status).toBe('pending');expect(()=>act(e,'apply','owner',t+4000,{kind:'venue',title:'重复',address:'地址B'})).toThrow('已提交');});
it('候选场地容量如提供则必须有效',()=>{for(const capacity of [0,-1,1.5,null])expect(()=>act(event(),'apply','owner',t+1000,{kind:'venue',title:'咖啡厅',address:'地址',capacity})).toThrow('容量');});
