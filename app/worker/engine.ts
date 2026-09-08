import type { Activity, Application, Command, Condition, Notice, Participant, Rules } from './types';

export class DomainError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function fail(message: string, status = 400): never { throw new DomainError(message, status); }
export function textValue(value: unknown, label: string, max = 500, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) return fail(`${label}须为 ${min}–${max} 字符`);
  return value.trim();
}
export function validateRules(input: unknown, now: number): Rules {
  if (!input || typeof input !== 'object') return fail('请填写活动规则');
  const r = {...input,minTalks:0,minCohosts:0,continuousTalks:false,continuousCohosts:false,allowRoleOverlap:true} as Rules;
  const ints: [keyof Rules, number, number][] = [['minPeople',3,100],['maxPeople',3,100],['minTalks',0,20],['minCohosts',0,20],['minHosts',0,10],['repairMinutes',1,10080]];
  for (const [key,min,max] of ints) if (!Number.isInteger(r[key]) || Number(r[key]) < min || Number(r[key]) > max) fail(`${key} 超出有效范围`);
  for(const [lead,deadline] of [['registrationLeadHours','registrationDeadline'],['promotionLeadHours','promotionDeadline']] as const){if(r[lead]!==undefined){if(!Number.isInteger(r[lead])||r[lead]! < 0||r[lead]! > 168)fail('提前截止须为 0–168 小时');r[deadline]=r.startsAt-r[lead]!*3600000;}}
  for (const key of ['recruitmentDeadline','startsAt','endsAt','registrationDeadline','promotionDeadline'] as const) if (!Number.isSafeInteger(r[key])) fail('请填写有效日期时间');
  for (const key of ['waitlist','venueRequired','allowRoleOverlap','continuousVenue','continuousTalks','continuousCohosts','continuousHosts'] as const) if (typeof r[key] !== 'boolean') fail('规则开关必须明确选择');
  if (r.addressVisibility !== 'public' && r.addressVisibility !== 'participants') fail('地址可见范围无效');
  if(r.maxPeople>8)r.venueRequired=true;
  if (r.minPeople > r.maxPeople) fail('最低人数不能超过容量');
  if (!(now < r.recruitmentDeadline && r.recruitmentDeadline < r.startsAt && r.startsAt < r.endsAt)) fail('须满足：当前时间 < 征集截止 < 活动开始 < 活动结束');
  for (const key of ['registrationDeadline','promotionDeadline'] as const) if (r[key] < r.recruitmentDeadline || r[key] > r.startsAt) fail('报名和递补截止须在征集截止与活动开始之间');
  if (r.endsAt - r.startsAt > 7 * 86400000 || r.startsAt - now > 366 * 86400000) fail('活动时间超出支持范围');
  if(r.timeSlots!==undefined){
    if(!Array.isArray(r.timeSlots)||r.timeSlots.length<1||r.timeSlots.length>20)fail('请选择 1–20 个候选时段');
    const ids=new Set<string>(),times=new Set<number>();
    for(const slot of r.timeSlots){
      if(!slot||typeof slot.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(slot.id)||ids.has(slot.id)||times.has(slot.startsAt))fail('候选时段重复或标识无效');
      if(!Number.isSafeInteger(slot.startsAt)||!Number.isSafeInteger(slot.endsAt)||slot.startsAt<r.startsAt||slot.endsAt<=slot.startsAt||slot.endsAt-slot.startsAt>7*86400000||slot.startsAt-now>366*86400000)fail('候选时段日期无效');
      ids.add(slot.id);times.add(slot.startsAt);
    }
    if(!r.timeSlots.some(slot=>slot.startsAt===r.startsAt&&slot.endsAt===r.endsAt))fail('默认时间须为最早候选时段');
  }
  return Object.fromEntries([...ints.map(x=>x[0]), 'recruitmentDeadline','startsAt','endsAt','registrationDeadline','promotionDeadline',...(r.registrationLeadHours!==undefined?['registrationLeadHours']:[]),...(r.promotionLeadHours!==undefined?['promotionLeadHours']:[]),'waitlist','venueRequired','allowRoleOverlap','continuousVenue','continuousTalks','continuousCohosts','continuousHosts','addressVisibility',...(r.timeSlots?['timeSlots']:[])].map(k => [k,(r as any)[k]])) as unknown as Rules;
}
export function createActivity(input: Record<string,unknown>, ownerId: string, now: number, id = crypto.randomUUID()): Activity {
  return {id,ownerId,tags:normalizeTags(input.tags),title:textValue(input.title,'标题',100),city:textValue(input.city,'城市',80),description:textValue(input.description??'','介绍',4000,0),rules:validateRules(input.rules,now),status:'draft',version:0,createdAt:now,participants:[],applications:[],repairs:[],receipts:[],sequence:0,processed:[]};
}
export function normalizeTags(input:unknown):string[]{
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>5)fail('最多选择 5 个标签');
  const unique=new Map<string,string>();
  for(const value of input){
    if(typeof value!=='string')fail('标签须为文字');
    const label=(value as string).normalize('NFKC').trim().replace(/\s+/g,' ');
    if(!label||label.length>20||/[\u0000-\u001f\u007f<>]/.test(label))fail('标签须为 1–20 字符，不含控制符或尖括号');
    unique.set(label.toLowerCase(),label);
  }
  return [...unique.values()];
}
export const joined = (e: Activity) => e.participants.filter(p=>p.status==='joined');
export const isManager = (e: Activity, userId: string) => userId===e.ownerId;
export function conditions(e: Activity): Condition[] {
  const approved = e.applications.filter(a=>a.status==='approved');
  const cohosts = new Set(approved.filter(a=>a.kind==='cohost').map(a=>a.userId));
  const hosts = new Set(approved.filter(a=>a.kind==='host').map(a=>a.userId));
  const r=e.rules;
  const result: Condition[] = [];
  const add=(key:string,label:string,current:number,required:number,continuous:boolean)=>{if(required>0)result.push({key,label,current,required,satisfied:current>=required,continuous});};
  add('people','参与人数',r.timeSlots&&!e.selectedSlotId?0:joined(e).filter(p=>!e.selectedSlotId||p.availableSlotIds?.includes(e.selectedSlotId)).length,r.minPeople,true);
  if(r.timeSlots)add('time','最终时间已确认',e.selectedSlotId?1:0,1,false);
  add('venue','已确认场地容量',Math.max(0,...approved.filter(a=>a.kind==='venue').map(a=>a.capacity??0)),r.venueRequired?r.maxPeople:0,r.continuousVenue);
  add('hosts','已确认现场负责人',hosts.size,r.minHosts,r.continuousHosts);
  return result;
}
function recipients(e:Activity) {return [...new Set([e.ownerId,...e.participants.filter(p=>p.status!=='left').map(p=>p.userId),...e.applications.filter(a=>a.status==='approved').map(a=>a.userId)])];}
function announce(e:Activity,out:Notice[],subject:string,body:string) {for(const userId of recipients(e))out.push({userId,subject,text:`${e.title}（${e.city}）\n${body}`});}
function record(e:Activity,at:number,kind:string,reason:string) {e.receipts.push({at,kind,conditions:conditions(e),reason});}
function cancel(e:Activity,now:number,reason:string,out:Notice[]) {e.status='cancelled';e.reason=reason;e.repairs=[];record(e,now,'cancelled',reason);announce(e,out,'活动已取消',reason);}
function promote(e:Activity,now:number,out:Notice[]) {
  if (!e.rules.waitlist || now>=e.rules.promotionDeadline || now>=e.rules.startsAt) return;
  let free=e.rules.maxPeople-joined(e).length-e.participants.filter(p=>p.status==='waitlisted'&&(p.promotionOfferUntil||0)>now).length;
  for (const p of e.participants.filter(p=>p.status==='waitlisted'&&(!e.selectedSlotId||p.availableSlotIds?.includes(e.selectedSlotId))).sort((a,b)=>a.order-b.order)) {
    if(p.promotionOfferUntil)continue;
    if(free--<=0)break;
    if(e.rules.promotionLeadHours!==undefined){p.promotionOfferUntil=Math.min(e.rules.promotionDeadline,...e.repairs.filter(r=>r.key==='people').map(r=>r.deadline),(['confirmed','repairing'].includes(e.status)&&joined(e).length<e.rules.minPeople?now+e.rules.repairMinutes*60000:Infinity));out.push({userId:p.userId,subject:'有候补名额，请确认参加',text:`「${e.title}」有名额为你保留。请在 ${new Date(p.promotionOfferUntil).toISOString()} 前打开活动页面确认报名；未确认不计入参加人数。`});continue;}
    p.status='joined';
    out.push({userId:p.userId,subject:'候补已入选',text:`你已正式报名「${e.title}」。请查看活动时间和地点，如无法参加请及时退出。`});
  }
}
/** All overdue deadlines are resolved BEFORE a new command. No client-supplied time. */
export function reconcile(e:Activity,now:number,out:Notice[]):void {
  e.repairs=e.repairs.filter(r=>!['talks','cohosts','roles'].includes(r.key));
  if(e.status==='draft'||e.status==='cancelled'||e.status==='completed')return;
  for(const p of e.participants)if(p.status==='waitlisted'&&p.promotionOfferUntil!==undefined&&p.promotionOfferUntil<=now)p.promotionOfferExpired=true;
  if(e.status==='recruiting' && now>=e.rules.recruitmentDeadline) {
    const missing=conditions(e).filter(c=>!c.satisfied);
    if(missing.length){cancel(e,e.rules.recruitmentDeadline,`征集截止条件不足：${missing.map(c=>`${c.label} ${c.current}/${c.required}`).join('、')}`,out);return;}
    e.status='confirmed';record(e,e.rules.recruitmentDeadline,'confirmed','全部成团条件满足');announce(e,out,'活动已成团','已按发布规则成团，请查看活动详情。');
  }
  if(e.status==='confirmed'||e.status==='repairing') {
    const expired=e.repairs.filter(r=>r.deadline<=now);
    if(expired.length){cancel(e,Math.min(...expired.map(r=>r.deadline)),`补齐期限已到：${expired.map(r=>r.label).join('、')}仍不足`,out);return;}
    if(now>=e.rules.endsAt){e.status='completed';record(e,e.rules.endsAt,'completed','活动时间已结束');return;}
    if(now>=e.rules.startsAt)return;
    promote(e,now,out);
    syncRepairs(e,now,out);
  }
}
function syncRepairs(e:Activity,now:number,out:Notice[]) {
  if(e.status!=='confirmed'&&e.status!=='repairing')return;
  if(now>=e.rules.startsAt)return;
  const missing=conditions(e).filter(c=>c.continuous&&!c.satisfied);
  const cleared=e.repairs.filter(r=>!missing.some(c=>c.key===r.key));
  e.repairs=e.repairs.filter(r=>missing.some(c=>c.key===r.key));
  for(const c of missing) if(!e.repairs.some(r=>r.key===c.key)) {
    const deadline=Math.min(now+e.rules.repairMinutes*60000,e.rules.startsAt);
    e.repairs.push({key:c.key,label:c.label,openedAt:now,deadline});
    record(e,now,'repair_opened',`${c.label}不足，限时补齐`);
    announce(e,out,'活动等待补齐',`${c.label}不足；补齐截止时间：${new Date(deadline).toISOString()}。到期未补齐将自动取消。`);
  }
  const peopleDeadline=e.repairs.find(r=>r.key==='people')?.deadline;
  if(peopleDeadline!==undefined)for(const p of e.participants)if(p.status==='waitlisted'&&(p.promotionOfferUntil||0)>peopleDeadline){
    p.promotionOfferUntil=peopleDeadline;
    out.push({userId:p.userId,subject:'候补确认期限已更新',text:`「${e.title}」正在等待人数补齐，请在 ${new Date(peopleDeadline).toISOString()} 前确认参加；到期人数不足将取消活动。`});
  }
  if(cleared.length){record(e,now,'repair_resolved',`${cleared.map(c=>c.label).join('、')}已补齐`);announce(e,out,'活动条件已补齐',`${cleared.map(c=>c.label).join('、')}已恢复。请查看其他条件和最新状态。`);}
  e.status=e.repairs.length?'repairing':'confirmed';
}
function manager(e:Activity,id:string){if(!isManager(e,id))fail('仅发布者或已批准协办可操作',403);}
function owner(e:Activity,id:string){if(e.ownerId!==id)fail('仅本场发布者可操作',403);}
export function applyCommand(e:Activity,cmd:Command,userId:string,now:number,out:Notice[]):void {
  if(e.status==='cancelled'||e.status==='completed')fail('活动已结束或取消，不能修改',409);
  const afterStartException=cmd.action==='cancel'||(cmd.action==='leave'&&e.participants.some(p=>p.userId===userId&&p.status==='waitlisted'));
  if(now>=e.rules.startsAt && e.status!=='draft'&&!afterStartException)fail('活动已开始，参与和规则变更已关闭',409);
  switch(cmd.action) {
    case 'edit': {
      owner(e,userId);if(e.status!=='draft')fail('发布后规则已锁定',409);
      const edited=createActivity(cmd,userId,now,e.id);e.title=edited.title;e.city=edited.city;e.description=edited.description;e.tags=cmd.tags===undefined?(e.tags||[]):edited.tags;e.rules=edited.rules;break;
    }
    case 'describe': {
      owner(e,userId);
      const before=e.description,after=textValue(cmd.description,'介绍',4000,0);
      e.description=after;
      if(cmd.tags!==undefined)e.tags=normalizeTags(cmd.tags);
      e.receipts.push({at:now,kind:'description',conditions:conditions(e),reason:'介绍文字已更正，成团规则保持不变',descriptionChange:{before,after}});
      break;
    }
    case 'publish': owner(e,userId);if(e.status!=='draft')fail('活动已经发布',409);e.rules=validateRules(e.rules,now);e.status='recruiting';e.publishedAt=now;record(e,now,'published','征集已发布，规则锁定');break;
    case 'select_time': {
      owner(e,userId);
      if(e.status!=='recruiting'||now>=e.rules.recruitmentDeadline||e.selectedSlotId)fail('只能在征集截止前确认一次最终时间',409);
      const slot=e.rules.timeSlots?.find(s=>s.id===cmd.slotId);if(!slot)fail('候选时段不存在');
      e.selectedSlotId=slot.id;e.rules.startsAt=slot.startsAt;e.rules.endsAt=slot.endsAt;
      if(e.rules.registrationLeadHours!==undefined)e.rules.registrationDeadline=slot.startsAt-e.rules.registrationLeadHours*3600000;
      if(e.rules.promotionLeadHours!==undefined)e.rules.promotionDeadline=slot.startsAt-e.rules.promotionLeadHours*3600000;
      let seats=e.rules.maxPeople;
      for(const p of e.participants.filter(p=>p.status!=='left').sort((a,b)=>a.order-b.order)){
        const canAttend=p.availableSlotIds?.includes(slot.id);
        p.status=canAttend&&seats>0?'joined':canAttend&&e.rules.waitlist?'waitlisted':'left';
        if(p.status==='joined')seats--;
        if(p.status==='left')out.push({userId:p.userId,subject:'报名未入选',text:canAttend?'最终时段席位已满，本场不开放候补；本次报名已结束。':'最终时段不在你选择的可参加时间内，本次报名已结束。'});
      }
      record(e,now,'time_selected','最终时段已确认');
      announce(e,out,'活动时间已确认',new Date(slot.startsAt).toISOString()+'；仅能参加该时段的报名者计入成行人数，请查看报名状态。');
      break;
    }
    case 'join': {
      if(e.status==='draft')fail('征集尚未发布',409);
      let p=e.participants.find(p=>p.userId===userId);
      let availableSlotIds=p?.availableSlotIds;
      if(e.rules.timeSlots){
        const input=cmd.availableSlotIds??availableSlotIds;
        if(!Array.isArray(input)||input.length<1||input.length>20||input.some(id=>typeof id!=='string'||!e.rules.timeSlots!.some(s=>s.id===id)))fail('请至少选择一个有效候选时段');
        availableSlotIds=[...new Set(input)] as string[];
        if(e.selectedSlotId&&!availableSlotIds.includes(e.selectedSlotId))fail('最终时间已确定；无法参加请退出报名');
      }
      const timePreference=cmd.timePreference===undefined?undefined:textValue(cmd.timePreference,'时间偏好',80,0);
      const placePreference=cmd.placePreference===undefined?undefined:textValue(cmd.placePreference,'地点偏好',80,0);
      if(cmd.transportPreferences!==undefined&&(!Array.isArray(cmd.transportPreferences)||cmd.transportPreferences.length>2||cmd.transportPreferences.some(v=>!['public_transport','car'].includes(String(v)))))fail('交通偏好无效');
      const transportPreferences=cmd.transportPreferences===undefined?undefined:[...new Set(cmd.transportPreferences as string[])];
      const registrationMessage=cmd.registrationMessage===undefined?undefined:textValue(cmd.registrationMessage,'报名留言',500,0);
      const savePreferences=(participant:Participant)=>{
        if(availableSlotIds!==undefined)participant.availableSlotIds=availableSlotIds;
        if(transportPreferences!==undefined)participant.transportPreferences=transportPreferences;
        if(registrationMessage!==undefined)participant.registrationMessage=registrationMessage;
        if(timePreference!==undefined)participant.timePreference=timePreference;
        if(placePreference!==undefined)participant.placePreference=placePreference;
      };
      if(p?.status==='joined'){savePreferences(p);break;}
      if(p?.status==='waitlisted'&&(p.promotionOfferUntil||0)>now){p.status='joined';delete p.promotionOfferUntil;savePreferences(p);break;}
      if(p?.status==='waitlisted'&&p.promotionOfferUntil&&now>=p.promotionOfferUntil)fail('候补确认已截止',409);
      const peopleRepair=e.repairs.some(r=>r.key==='people');
      if(now>=e.rules.registrationDeadline&&!peopleRepair)fail('报名已截止',409);
      // Existing eligible waitlist always has priority over a new arrival.
      promote(e,now,out);
      p=e.participants.find(p=>p.userId===userId);
      if(p?.status==='waitlisted'&&(p.promotionOfferUntil||0)>now){p.status='joined';delete p.promotionOfferUntil;savePreferences(p);break;}
      if(p?.status==='joined'){savePreferences(p);break;}
      const full=!(e.rules.timeSlots&&!e.selectedSlotId)&&joined(e).length+e.participants.filter(x=>x.status==='waitlisted'&&(x.promotionOfferUntil||0)>now).length>=e.rules.maxPeople;
      if(full&&(!e.rules.waitlist||now>=e.rules.promotionDeadline))fail('名额已满，候补已关闭',409);
      if(p?.status==='waitlisted'&&full){savePreferences(p);break;}
      const status=full?'waitlisted':'joined';
      if(p){p.status=status;p.appliedAt=now;p.order=++e.sequence;savePreferences(p);}else e.participants.push({userId,status,appliedAt:now,order:++e.sequence,availableSlotIds,timePreference,placePreference,transportPreferences,registrationMessage});
      if(e.participants.length>2000)fail('本场报名记录已达上限');
      break;
    }
    case 'leave': {
      const p=e.participants.find(p=>p.userId===userId);if(p){p.status='left';delete p.promotionOfferUntil;delete p.promotionOfferExpired;}promote(e,now,out);break;
    }
    case 'reply_registration': {
      owner(e,userId);
      const p=e.participants.find(p=>p.userId===cmd.participantId&&p.status!=='left');
      if(!p)fail('报名成员不存在',404);
      p.registrationReply=textValue(cmd.reply,'回复',500);
      p.registrationRepliedAt=now;
      out.push({userId:p.userId,subject:'发起人回复了你的报名留言',text:`「${e.title}」的发起人回复：${p.registrationReply}`});
      break;
    }
    case 'apply': {
      if(e.status==='draft')fail('发布征集后才能申请',409);
      const kind=cmd.kind as Application['kind'];
      if(['cohost','talk'].includes(kind))fail('MVP 暂不支持分享和协办申请');
      if(!['cohost','host','talk','venue','material','pledge'].includes(kind))fail('申请类型无效');
      if(kind!=='venue'&&e.applications.filter(a=>a.userId===userId&&a.kind===kind&&a.status!=='withdrawn'&&a.status!=='rejected').length)fail('已有同类型申请，请先撤回再提交',409);
      if(e.applications.length>=1000)fail('本场申请记录已达上限');
      const a:Application={id:crypto.randomUUID(),userId,kind,title:textValue(cmd.title,'申请标题',120),detail:textValue(cmd.detail??'','申请说明',2000,0),status:'pending',updatedAt:now};
      if(kind==='venue'){if(cmd.capacity!==undefined){if(!Number.isInteger(cmd.capacity)||Number(cmd.capacity)<1||Number(cmd.capacity)>10000)fail('请填写有效场地容量');a.capacity=Number(cmd.capacity);}a.address=textValue(cmd.address,'详细地址',400);if(e.applications.some(v=>v.kind==='venue'&&v.userId===userId&&!['withdrawn','rejected'].includes(v.status)&&v.address?.trim().toLowerCase()===a.address?.toLowerCase()))fail('你已提交这个候选场地',409);}
      if(kind==='pledge'){if(typeof cmd.amount!=='number'||!Number.isFinite(cmd.amount)||cmd.amount<1||cmd.amount>100000)fail('请填写有效赞助意向金额');a.amount=cmd.amount;}
      if(kind==='talk'){if(!Number.isInteger(cmd.duration)||Number(cmd.duration)<1||Number(cmd.duration)>180)fail('分享时长须为1–180分钟');a.duration=Number(cmd.duration);}
      e.applications.push(a);
      const reviewers=[e.ownerId];
      for(const reviewer of new Set(reviewers))out.push({userId:reviewer,subject:'有新的待处理申请',text:`「${e.title}」有新的${kind}申请，请进入活动管理查看。`});break;
    }
    case 'review': {
      const a=e.applications.find(a=>a.id===cmd.applicationId);if(!a)fail('申请不存在',404);
      if(['cohost','talk'].includes(a.kind))fail('MVP 不再审批分享和协办申请');
      if(['cohost','venue','host'].includes(a.kind))owner(e,userId);else manager(e,userId);
      if(a.status!=='pending')fail('申请已处理或撤回',409);
      if(typeof cmd.approved!=='boolean')fail('请选择批准或拒绝');
      if(a.kind==='venue'&&cmd.approved){const capacity=cmd.capacity??a.capacity;if(!Number.isInteger(capacity)||Number(capacity)<1||Number(capacity)>10000)fail('确认场地前请填写实际可容纳人数');a.capacity=Number(capacity);for(const other of e.applications)if(other.kind==='venue'&&other.status==='approved'&&other.id!==a.id){other.status='pending';other.updatedAt=now;other.reviewedBy=userId;other.reason='已选择其他最终场地，本提议保留备用';out.push({userId:other.userId,subject:'场地已转为备用',text:`「${e.title}」已确认其他场地，你提供的「${other.title}」保留备用，无需按最终场地继续准备。`});}}
      a.status=cmd.approved?'approved':'rejected';a.reviewedBy=userId;a.reason=textValue(cmd.reason??'','审核说明',500,0);a.updatedAt=now;
      out.push({userId:a.userId,subject:'申请审批结果',text:`你在「${e.title}」的申请已${cmd.approved?'通过':'拒绝'}。${a.reason}`});break;
    }
    case 'withdraw': case 'revoke': {
      const a=e.applications.find(a=>a.id===cmd.applicationId);if(!a)fail('申请不存在',404);
      if(cmd.action==='withdraw'){if(a.userId!==userId)fail('只能撤回本人的申请',403);}else{owner(e,userId);if(a.kind!=='cohost')fail('本入口仅撤销协办资格');}
      if(a.status==='withdrawn')break;
      a.status='withdrawn';a.updatedAt=now;
      for(const id of new Set([a.userId,e.ownerId]))out.push({userId:id,subject:'申请或资格已撤回',text:`「${e.title}」的${a.kind}申请或资格已撤回。`});break;
    }
    case 'cancel': owner(e,userId);cancel(e,now,textValue(cmd.reason,'取消原因',500),out);return;
    default: fail('不支持的操作');
  }
  if(e.status==='confirmed'||e.status==='repairing')syncRepairs(e,now,out);
}
export function nextDue(e:Activity):number|null {
  const offers=e.participants.filter(p=>p.status==='waitlisted'&&p.promotionOfferUntil!==undefined&&!p.promotionOfferExpired).map(p=>p.promotionOfferUntil!);
  if(e.status==='recruiting')return Math.min(e.rules.recruitmentDeadline,...offers);
  if(e.status==='confirmed'||e.status==='repairing')return Math.min(e.rules.endsAt,...e.repairs.map(r=>r.deadline),...offers);
  return null;
}
