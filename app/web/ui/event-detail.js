import {el,field,errorAt,modal,badge,btn,closeModal,toast} from './dom.js';
import {kinds,statusNames} from './labels.js';
import {date,eventTimePhase,deadlineLabel,countdown} from './display.js';
import {eventTags,registrationCalendar,conditionNode} from './event-widgets.js';
import {tagPicker} from './tag-picker.js';
import {dagStatuses} from '../dag-status.js';
import {shareEvent} from './sharing.js';
import {api} from './api.js';

// 页面状态与跨页面动作由入口注入；导入模块本身不注册事件。
export function createEventDetail({command,requireUser,state,renderEventForm,app}) {
function confirmation(title,message,action,extra={},reason=false){const f=el('form',{},el('h2',{},title),el('p',{},message));if(reason)f.append(field('原因（将记入活动记录）','reason','textarea'));const b=el('button',{type:'submit',class:'button dark'},'确认');f.append(b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await command(action,{...extra,...(reason?{reason:f.elements.reason.value}:{})});}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function applyForm(kind){if(!requireUser())return;const f=el('form',{},el('h2',{},kind==='host'?'我可以帮忙':`申请${kinds[kind]}`),field('标题','title','text'),field('具体说明','detail','textarea'));if(kind==='venue')f.append(field('可容纳人数（可留空，确认时补充）','capacity','number'),field('详细地址','address','text'),el('p',{class:'muted'},state.event.rules.addressVisibility==='participants'?'地址仅按活动规则向参与者展示。':'此活动将公开场地地址。'));if(kind==='talk')f.append(field('预计时长（分钟）','duration','number',20));if(kind==='pledge')f.append(field('赞助金额（欧元）','amount','number'));if(kind==='venue')f.elements.capacity.required=false;const b=el('button',{class:'button dark',type:'submit'},'提交申请');f.append(el('p',{class:'form-note'},'申请通过后才计入条件。申请只代表你本人，可以在活动中查看处理结果或撤回。'),b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;const v=Object.fromEntries(new FormData(f));for(const k of ['capacity','amount','duration'])if(k in v){if(k==='capacity'&&v[k]==='')delete v[k];else v[k]=Number(v[k]);}try{await command('apply',{kind,...v});}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function confirmVenue(a){const f=el('form',{},el('h2',{},'确认场地 · '+a.title),field('实际可容纳人数','capacity','number',a.capacity||''),el('button',{type:'submit',class:'button dark'},'确认场地'));f.onsubmit=async ev=>{ev.preventDefault();try{await command('review',{applicationId:a.id,approved:true,capacity:Number(f.elements.capacity.value)});}catch(e){errorAt(f,e);}};modal(f);}
function applicationNode(a,e,reviewControls=true,ownControls=true){const own=(e.myApplications||[]).some(x=>x.id===a.id);const mutable=!['cancelled','completed'].includes(e.status)&&Date.now()<e.rules.startsAt;const canReview=reviewControls&&mutable&&(['cohost','venue','host'].includes(a.kind)?e.isOwner:e.canManage);return el('div',{class:'application'},el('h3',{},`${kinds[a.kind]||a.kind} · ${a.title} `,badge(a.status)),el('p',{},a.detail),a.capacity?el('p',{},`容量：${a.capacity} 人`):a.kind==='venue'?el('p',{class:'muted'},'容量待确认'):null,a.address?el('p',{},`地址：${a.address}`):null,a.duration?el('p',{},`分享时长：${a.duration} 分钟`):null,a.amount?el('p',{},`赞助：€${a.amount}`):null,a.reason?el('p',{},`处理说明：${a.reason}`):null,el('div',{class:'inline-actions'},ownControls&&mutable&&own&&['pending','approved'].includes(a.status)?btn('撤回 / 退出',()=>confirmation('撤回这项申请？','撤回已通过的申请可能影响成行条件。','withdraw',{applicationId:a.id}),'button quiet'):null,canReview&&a.status==='pending'?btn('通过',()=>a.kind==='venue'?confirmVenue(a):confirmation('通过申请？',`批准「${a.title}」，系统将重新检查成行条件。`,'review',{applicationId:a.id,approved:true})):null,canReview&&a.status==='pending'?btn('拒绝',()=>confirmation('拒绝申请','请向申请人说明原因。','review',{applicationId:a.id,approved:false},true),'button quiet'):null,mutable&&e.isOwner&&a.kind==='cohost'&&a.status==='approved'?btn('撤销协办资格',()=>confirmation('撤销批准','撤销后系统将重新检查活动条件。','revoke',{applicationId:a.id},true),'button danger'):null));}
function decisionSummary(e,openParticipants){
 if(e.status==='draft')return null;
 const titles={recruiting:'正在征集 · 尚未成行',confirmed:'已成行',repairing:'等待补齐',cancelled:'活动已取消',completed:'活动已结束'};
 const slots=e.rules.timeSlots||[],fixed=slots.find(s=>s.id===e.selectedSlotId)||(!slots.length?e.rules:null);
 const venues=(e.applications||[]).filter(a=>a.kind==='venue'&&a.status==='approved'),hosts=(e.conditions||[]).find(c=>c.key==='hosts'&&c.required>0),terminal=['completed','cancelled'].includes(e.status);
 const item=(name,value)=>el('div',{},el('dt',{},name),el('dd',{},value));
 const time=fixed?date(fixed.startsAt)+' — '+date(fixed.endsAt):el('div',{},el('div',{class:'decision-slot-list'},slots.slice(0,3).map(s=>el('span',{},date(s.startsAt)+'–'+date(s.endsAt,{hour:'2-digit',minute:'2-digit',month:undefined,day:undefined})))),slots.length>3?el('small',{},'另有 '+(slots.length-3)+' 个候选时段'):null,el('small',{},'候选时间，最终确认其中一场'));
 const root=el('section',{class:'event-decision decision-'+e.status,'aria-label':'当前活动决策'},el('h2',{},titles[e.status]||statusNames[e.status]),eventTags(e),el('dl',{class:'decision-facts'},item(fixed?'已确认时间':'候选时间',time),item('地点',venues.length?venues.map(v=>v.title+(v.address?' · '+v.address:'')).join('、'):e.city+' · 具体场地待确认'),item('人数',el('div',{},el('span',{},(e.counts?.joined||0)+' 人报名'+(e.counts?.waitlisted?' · '+e.counts.waitlisted+' 人候补':'')+' · '+e.rules.minPeople+'–'+e.rules.maxPeople+' 人'),btn('查看报名与留言',openParticipants,'button participant-entry'))),hosts?item('帮忙成员','已确认 '+hosts.current+' / '+hosts.required+' 人'):null));
 if(terminal)root.append(el('p',{},e.status==='cancelled'?(e.reason||'本场活动已取消。'):'以上为活动结束时的安排。'));
 else if(e.status==='confirmed')root.append(el('p',{class:'decision-deadline'},'已满足成行条件，请按确认的时间和地点参加。'));
 else {const deadline=e.status==='repairing'&&e.repairs?.length?Math.min(...e.repairs.map(r=>r.deadline)):e.rules.recruitmentDeadline;const pendingCandidates=e.status==='recruiting'&&!e.selectedSlotId&&slots.length>1;root.append(el('p',{class:'decision-deadline'},(e.status==='repairing'?'补齐截止 · ':pendingCandidates?'下个候选确认期限 · ':'成行决定 · ')+date(deadline)));}
 return root;
}
function renderDetail(e){
  state.renderedPhase=eventTimePhase(e);state.detailVisible=true;state.pendingEvent=null;
  const p=e.myParticipation,joined=typeof p==='string'?p:p?.status;
  const active=['recruiting','confirmed','repairing'].includes(e.status),beforeStart=Date.now()<e.rules.startsAt;
  const applications=e.applications||[],conditions=e.conditions||[],people=e.participants||[];
  const flow=el('div',{class:'code-flow parallel-flow','aria-label':'活动规则与参与流程'});
  const arrow=()=>el('span',{class:'code-arrow','aria-hidden':'true'});
  const node=(stage,status,open,label,detail,current=false)=>{
    const trigger=el('button',{class:'button flow-trigger',type:'button','aria-expanded':'false'},label);
    const box=el('section',{class:`code-node ${open?'editable':'locked'}${current?' current':''}`,'data-flow-key':stage,'aria-current':current?'step':undefined},
      el('div',{class:'code-node-core'},el('div',{},el('p',{class:'node-purpose'},`阶段：${stage}`),el('p',{class:'node-status'},'状态：',el('strong',{},status))),trigger),
      el('div',{class:'code-node-detail'},detail));
    trigger.onclick=()=>{const pinned=box.classList.toggle('pinned');trigger.setAttribute('aria-expanded',String(pinned));};
    return box;
  };
  const appsFor=(ks)=>applications.filter(a=>ks.includes(a.kind));
  const contributions=(ks,empty)=>el('div',{},active&&beforeStart?el('div',{class:'inline-actions'},ks.map(k=>btn(`＋ ${k==='host'?'我可以帮忙':'提供场地'}`,()=>applyForm(k)))):null,
    appsFor(ks).some(a=>(e.myApplications||[]).some(m=>m.id===a.id))?appsFor(ks).filter(a=>(e.myApplications||[]).some(m=>m.id===a.id)).map(a=>applicationNode(a,e,false)):el('p',{class:'muted'},empty));
  const summaryChart=(title,items=[])=>{
    const max=Math.max(1,...items.map(x=>x.count));
    return el('div',{class:'preference-chart'},el('strong',{},title),items.length?items.map(x=>el('div',{class:'preference-row'},el('span',{},x.label),el('i',{},el('b',{style:`width:${x.count/max*100}%`})),el('em',{},x.count))):el('p',{class:'muted'},'等待第一份偏好'));
  };

  flow.append(el('div',{class:'code-terminal'},'START · 发起活动'),arrow());
  const topicDetail=el('div',{},eventTags(e),el('div',{class:'prose'},e.description||'发起人尚未填写介绍。'));
  if(e.isOwner&&!['cancelled','completed'].includes(e.status)){
    const row=el('div',{class:'inline-actions'});
    if(e.status==='draft')row.append(btn('编辑草稿',()=>renderEventForm(e)),btn('预览并发布',()=>publishPreview(e),'button dark'));
    else if(beforeStart)row.append(btn('更正活动介绍',()=>{const tags=tagPicker(e.tags||[]);const f=el('form',{},el('h2',{},'更正活动介绍'),tags.root,field('介绍','description','textarea',e.description),el('button',{class:'button dark',type:'submit'},'保存更正'));f.onsubmit=async ev=>{ev.preventDefault();try{await command('describe',{description:f.elements.description.value,tags:tags.read()});}catch(err){errorAt(f,err);}};modal(f);}));
    topicDetail.append(row);
  }
  flow.append(node('发起活动',e.description?'主题与规则已设定':'等待填写主题',e.status==='draft',e.status==='draft'?'参与':'查看',topicDetail,e.status==='draft'),arrow(),el('div',{class:'parallel-fork','aria-hidden':'true'}));

  const repair=(e.repairs||[]).find(r=>r.key==='people'),full=(e.counts?.joined||0)>=e.rules.maxPeople;
  const registrationOpen=active&&beforeStart&&((p?.promotionOfferUntil||0)>Date.now()||Date.now()<e.rules.registrationDeadline||!!repair);
  const waitOpen=e.rules.waitlist&&Date.now()<e.rules.promotionDeadline;
  const slots=e.rules.timeSlots||[], selectedSlot=slots.find(s=>s.id===e.selectedSlotId);
  const prefForm=el('form',{class:'preference-form'},el('p',{class:'form-note'},`活动城市：${e.city}`));
  if((p?.promotionOfferUntil||0)>Date.now())prefForm.append(el('p',{class:'form-note'},'有名额为你保留，请在 '+date(p.promotionOfferUntil)+' 前确认参加。'));
  if(slots.length)prefForm.append(registrationCalendar(slots,p?.availableSlotIds||[],e.selectedSlotId));
  else prefForm.append(el('p',{class:'form-note'},`活动时间：${date(e.rules.startsAt)} — ${date(e.rules.endsAt)}`));
  const transport=el('fieldset',{class:'transport-preferences'},el('legend',{},'交通偏好（可多选）'),[['public_transport','公共交通'],['car','开车']].map(([value,label])=>el('label',{class:'check'},el('input',{type:'checkbox',name:'transportPreferences',value,checked:p?.transportPreferences?.includes(value)||false}),label)));
  const message=field('报名留言（选填，最多 500 字）','registrationMessage','textarea',p?.registrationMessage||'',false);
  message.style.gridColumn='1 / -1';message.querySelector('textarea').maxLength=500;
  prefForm.append(transport,message,el('p',{class:'form-note'},'可以介绍自己或说点什么。留言会随参与名单公开展示；交通偏好按人数汇总，用于场地安排。'));
  if(e.isOwner&&(!joined||joined==='left'))prefForm.append(el('p',{class:'form-note'},'你是发起人，也需要在这里报名并选择可参加时段，才会计入参与人数。'));
  const prefSubmit=el('button',{class:'button orange',type:'submit'},(p?.promotionOfferUntil||0)>Date.now()?'确认接受候补名额':joined&&joined!=='left'?'保存偏好':'报名并保存偏好');
  prefForm.append(el('p',{class:'form-note'},slots.length?(selectedSlot?'最终时段已确认，请确认你可以参加该时段。':'勾选所有可以参加的时段。每个候选日期到期后会单独移除，发布者可从剩余日期中确认最终安排。'):'请确认你可以参加已公布的活动时间。'),prefSubmit);
  prefForm.onsubmit=async ev=>{ev.preventDefault();prefSubmit.disabled=true;try{const availableSlotIds=new FormData(prefForm).getAll('availableSlotIds');if(slots.length&&!availableSlotIds.length)throw new Error('请至少选择一个可以参加的时段。');if(selectedSlot&&!availableSlotIds.includes(selectedSlot.id))throw new Error('报名需要能够参加已确认的最终时段。');await command('join',{availableSlotIds,transportPreferences:new FormData(prefForm).getAll('transportPreferences'),registrationMessage:prefForm.elements.registrationMessage.value});}catch(err){errorAt(prefForm,err);}finally{prefSubmit.disabled=false;}};
  const prefSummary=e.preferenceSummary||{times:[],places:[]};
  const replyRegistration=person=>{const form=el('form',{},el('h2',{},'回复报名留言'),el('p',{class:'registration-message'},person.registrationMessage),field('发起人回复','reply','textarea',person.registrationReply||''),el('button',{class:'button dark',type:'submit'},person.registrationReply?'更新回复':'发布回复'));form.elements.reply.maxLength=500;form.onsubmit=async ev=>{ev.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;try{await command('reply_registration',{participantId:person.participantId,reply:form.elements.reply.value});}catch(error){errorAt(form,error);}finally{submit.disabled=false;}};modal(form);};
  const renderParticipantList=()=>people.length
    ?el('div',{class:'participant-list'},people.map(person=>{
      const conversation=person.registrationMessage
        ?el('div',{class:'registration-thread'},
          el('p',{class:'registration-message'},person.registrationMessage),
          person.registrationReply?el('p',{class:'registration-reply'},el('strong',{},'发起人回复：'),person.registrationReply):null,
          e.isOwner&&active&&person.participantId?btn(person.registrationReply?'修改回复':'回复留言',()=>replyRegistration(person),'button quiet'):null)
        :el('p',{class:'muted'},'没有填写报名留言。');
      return el('article',{class:'person'},el('strong',{},`${person.nickname||'匿名参与者'}${person.isMe?'（我）':''} · ${statusNames[person.status]||person.status}`),conversation);
    }))
    :el('p',{class:'muted'},'还没有人报名。');
  const joinDetail=el('div',{class:'registration-detail'},el('div',{class:'registration-actions'},el('p',{class:'muted'},`最低 ${e.rules.minPeople} 人，最多 ${e.rules.maxPeople} 人；报名截止：${deadlineLabel(e,'registration')}`),
    registrationOpen&&((slots.length&&!selectedSlot)||!full||waitOpen||['joined','waitlisted'].includes(joined))?prefForm:el('p',{class:'form-note'},'报名已关闭。'),
    joined&&joined!=='left'?el('div',{class:'inline-actions'},el('span',{class:'form-note'},`我的状态：${statusNames[joined]}`),active&&(beforeStart||joined==='waitlisted')?btn(joined==='waitlisted'?'退出候补':'退出报名',()=>confirmation('退出这场聚会？','席位将按规则释放。','leave'),'button quiet'):null):null));

  const canSelectTime=e.isOwner&&e.status==='recruiting'&&!e.selectedSlotId&&Date.now()<e.rules.recruitmentDeadline;
  const timeDetail=el('div',{},el('p',{class:'journey-lead'},`${e.city} · ${slots.length&&!selectedSlot?'等待确认最终时段':date(e.rules.startsAt)+' — '+date(e.rules.endsAt)}`));
  if(slots.length){
    timeDetail.append(el('p',{class:'muted'},selectedSlot?'最终时段已确认。':'请在下个候选确认期限前选定一场；未选定时只移除到期日期，后面的候选日期继续征集。'),...slots.map(s=>el('div',{class:'slot-result'},el('span',{},`${date(s.startsAt)} — ${date(s.endsAt)} · ${(prefSummary.slots||[]).find(x=>x.id===s.id)?.count||0} 人可参加`),s.id===e.selectedSlotId?el('strong',{},'已确认'):canSelectTime?btn('确认此时段',()=>confirmation('确认最终时段',`${date(s.startsAt)} — ${date(s.endsAt)}。确认后不可修改。`,'select_time',{slotId:s.id}),'button quiet'):null)));
  }
  timeDetail.append(
    el('section',{id:'detail-participants'},el('h3',{},'报名成员与留言'),renderParticipantList()),
    el('div',{class:'preference-summary'},slots.length?summaryChart('可参加时段人数（可多选）',slots.map(slot=>({id:slot.id,label:date(slot.startsAt)+' — '+date(slot.endsAt),count:(prefSummary.slots||[]).find(x=>x.id===slot.id)?.count||0}))):null,summaryChart('交通汇总（可多选）',prefSummary.transport)));
  const peopleCondition=conditions.find(c=>c.key==='people');
  const venueCondition=conditions.find(c=>c.key==='venue');
  const hostCondition=conditions.find(c=>c.key==='hosts');
  const parallel=el('section',{class:'parallel-lanes','aria-label':'并行参与阶段'},
    el('div',{class:'parallel-lane'},el('span',{class:'lane-label'},'并行 A'),node('报名并提交偏好',`${slots.length&&!selectedSlot?'意向报名 '+((e.counts?.joined||0)+(e.counts?.waitlisted||0))+' 人':(e.counts?.joined||0)+'/'+e.rules.minPeople+' 人'}${joined&&joined!=='left'?' · 我'+statusNames[joined]:''}`,registrationOpen,'参与',joinDetail,e.status==='recruiting'),arrow(),node('确认最终时段',`${slots.length&&!selectedSlot?'等待确认时间':date(e.rules.startsAt)} · ${e.city}`,canSelectTime,canSelectTime?'确认':'查看',timeDetail)),
    el('div',{class:'parallel-lane'},el('span',{class:'lane-label'},'并行 B'),node('提议场地',appsFor(['venue']).filter(a=>a.status==='pending').length+' 个候选场地',active&&beforeStart,'参与',contributions(['venue'],'尚无场地提议。')),arrow(),node('发起人确认场地',venueCondition?.satisfied?'场地已确认':e.rules.venueRequired?'等待确认场地':'场地非必需',e.isOwner&&active&&beforeStart,e.isOwner?'确认':'查看',el('div',{},el('p',{class:'muted'},'发起人确认一个最终场地；其他提议保留备用。'),appsFor(['venue']).map(a=>applicationNode(a,e,true,false))))),
    el('div',{class:'parallel-lane'},el('span',{class:'lane-label'},'并行 C'),node('我可以帮忙',appsFor(['host']).filter(a=>a.status==='pending').length+' 人待确认',active&&beforeStart,'参与',contributions(['host'],'还没有帮忙成员报名。')),arrow(),node('确认帮忙人选',hostCondition?.satisfied?'帮忙成员已确认':e.rules.minHosts?'等待确认帮忙人选':'帮忙成员非必需',e.isOwner&&active&&beforeStart,e.isOwner?'确认':'查看',el('div',{},el('p',{class:'muted'},'发起人审核报名，已确认人数计入 READY。'),appsFor(['host']).map(a=>applicationNode(a,e,true,false))))));
  flow.append(parallel,el('div',{class:'parallel-join','aria-hidden':'true'}));

  const readyDetail=el('div',{class:'ready-detail'},conditions.map(conditionNode));
  for(const r of e.repairs||[])readyDetail.append(el('div',{class:'repair'},`${r.label} · 补齐截止 ${date(r.deadline)}`,el('div',{'data-countdown':r.deadline},countdown(r.deadline))));
  readyDetail.append(el('details',{id:'detail-audit'},el('summary',{},'查看状态与评估记录'),el('p',{class:'muted'},`当前版本 v${e.version}`),(e.receipts||[]).slice().reverse().map(r=>el('div',{class:'receipt'},el('strong',{},`${date(r.at)} · ${r.kind}`),el('p',{},r.reason)))));
  if(e.isOwner&&!['cancelled','completed'].includes(e.status))readyDetail.append(el('div',{class:'inline-actions'},btn('取消活动',()=>confirmation('取消这场活动','此操作会通知参与者并记录原因。','cancel',{},true),'button danger')));
  flow.append(node('READY 判断',conditions.every(c=>c.satisfied)?'全部条件已满足':`${conditions.filter(c=>!c.satisfied).length} 项条件待满足`,active&&beforeStart,'查看',readyDetail,e.status==='repairing'));
  flow.append(el('div',{class:'code-diamond-wrap compact'},el('div',{class:'code-diamond'},el('div',{},el('strong',{},'READY?'),el('span',{},date(e.rules.recruitmentDeadline))))));
  const yesActive=e.status!=='cancelled',noActive=e.status==='cancelled';
  flow.append(el('div',{class:'code-branches final-branches'},el('div',{class:`code-branch ${yesActive?'active':'muted'}`},el('span',{},'YES'),el('strong',{},e.status==='completed'?'活动已结束':'活动成行')),el('div',{class:`code-branch ${noActive?'active':'muted'}`},el('span',{},'NO'),el('strong',{},'活动未成行'))));
  flow.append(el('div',{class:`code-terminal code-end ${e.status==='cancelled'?'muted-terminal':''}`},e.status==='cancelled'?'END · 已取消':'END · 线下相聚'));
  const canvas=el('div',{class:'dag-canvas'}),panel=el('aside',{class:'dag-panel','aria-label':'节点详情'});
  const positions=[[50,20],[16.7,180],[16.7,350],[50,180],[50,350],[83.3,180],[83.3,350],[50,520]];
  const deadlineLabels=[
    '发布前设置',
    '报名截止 '+date(repair?Math.min(repair.deadline,e.rules.startsAt):e.rules.registrationDeadline),
    '确认期限 '+date(e.rules.recruitmentDeadline),
    '提交截至 '+date(e.rules.startsAt),
    '成行检查 '+date(e.rules.recruitmentDeadline),
    '报名截至 '+date(e.rules.startsAt),
    '成行检查 '+date(e.rules.recruitmentDeadline),
    '成行决定 '+date(e.rules.recruitmentDeadline)
  ];
  const deadlines=[null,repair?Math.min(repair.deadline,e.rules.startsAt):e.rules.registrationDeadline,e.rules.recruitmentDeadline,e.rules.startsAt,e.rules.recruitmentDeadline,e.rules.startsAt,e.rules.recruitmentDeadline,e.rules.recruitmentDeadline];
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1000 630');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('class','dag-links');svg.setAttribute('aria-hidden','true');
  const defs=document.createElementNS(svg.namespaceURI,'defs'),marker=document.createElementNS(svg.namespaceURI,'marker'),tip=document.createElementNS(svg.namespaceURI,'path');marker.id='dag-direction';marker.setAttribute('viewBox','0 0 10 10');marker.setAttribute('refX','9');marker.setAttribute('refY','5');marker.setAttribute('markerWidth','8');marker.setAttribute('markerHeight','8');marker.setAttribute('orient','auto');tip.setAttribute('d','M 1 1 L 9 5 L 1 9 Z');tip.setAttribute('style','fill:#698aaf;stroke:none');marker.append(tip);defs.append(marker);svg.append(defs);
  const connections=[
    ['M500 116 V146 M167 146 H833',false],
    ['M167 146 V180',true],['M500 146 V180',true],['M833 146 V180',true],
    ['M167 276 V350',true],['M500 276 V350',true],['M833 276 V350',true],
    ['M167 446 V483 H833 V446 M500 446 V483',false],
    ['M500 483 V520',true]
  ];
  for(const [d,directed] of connections){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);if(directed)path.setAttribute('marker-end','url(#dag-direction)');svg.append(path);}canvas.append(svg);
  const nodes=[...flow.querySelectorAll('.code-node')];
  const nodeStates=dagStatuses({...e,conditions,applications});
  const nodeTitles=['活动规则','报名','确认时间','提议场地','确认场地','我可以帮忙','确认帮忙人选','成行检查'];
  const nodeSummaries=[
    e.status==='draft'?'待发布':'已发布',
    `${(e.counts?.joined||0)+(e.counts?.waitlisted||0)} 人报名`,
    selectedSlot?'已确定':'待确定',
    `${appsFor(['venue']).filter(a=>a.status==='pending').length} 个待确认`,
    venueCondition?.satisfied?(e.rules.venueRequired?'已确认':'非必需'):'待确认',
    `${appsFor(['host']).filter(a=>a.status==='pending').length} 人待确认`,
    !e.rules.minHosts?'非必需':hostCondition?.satisfied?'已确认':'待确认',
    conditions.every(c=>c.satisfied)?'条件已齐':`还差 ${conditions.filter(c=>!c.satisfied).length} 项`
  ];
  const progressFor=i=>{
    const c=i===1?peopleCondition:i===6?hostCondition:null;
    if(c&&c.required>0)return [Math.min(1,c.current/c.required),c.current+'/'+c.required+' 人'];
    if(i===7)return [conditions.length?conditions.filter(c=>c.satisfied).length/conditions.length:0,conditions.filter(c=>c.satisfied).length+'/'+conditions.length+' 项'];
    if((i===4&&!e.rules.venueRequired)||(i===6&&!e.rules.minHosts))return [null,'非必需'];
    if(i===3||i===5)return [null,nodeSummaries[i]];
    const done=nodeStates[i]==='success';return [done?1:0,done?'已完成':'待完成'];
  };
  nodes.forEach((box,i)=>{
    const button=el('button',{class:'dag-node state-'+nodeStates[i],type:'button','aria-pressed':'false'},el('strong',{},nodeTitles[i]),el('small',{},nodeSummaries[i]),el('span',{class:'dag-entry','aria-hidden':'true'},'→'));
    button.setAttribute('aria-label',box.dataset.flowKey+'，点击查看详情');button.style.left=positions[i][0]+'%';button.style.top=positions[i][1]+'px';button.style.setProperty('--node-y',positions[i][1]);canvas.append(button);
    if(e.status!=='draft'){
      const [ratio,label]=progressFor(i);
      const metrics=el('span',{class:'dag-metrics'});
      if(deadlines[i]){const remaining=Math.max(0,deadlines[i]-Date.now()),hours=Math.ceil(remaining/3600000);const time=remaining===0?'已到期':hours>=24?'剩 '+Math.ceil(hours/24)+' 天':'剩 '+hours+' 小时';metrics.append(el('span',{class:'dag-time',title:deadlineLabels[i]},'⌛ '+time));}
      metrics.append(el('span',{class:'dag-completion'},ratio!==null?el('progress',{max:1,value:ratio,'aria-label':'完成度：'+label}):null,el('span',{},label)));
      button.querySelector('small').remove();button.insertBefore(metrics,button.querySelector('.dag-entry'));
    }
    box._dagButton=button;
  });
  // Keep each form alive when switching nodes; never duplicate API action controls.
  const details=new Map(nodes.map(box=>[box,box.querySelector('.code-node-detail')]));
  const draft=e.status==='draft'&&e.isOwner;
  const editStage=i=>{closeModal();renderEventForm(e);const targets=['[name=title]','.slot-editor','.slot-editor','[name=venueRequired]','[name=venueRequired]','[name=minHosts]','[name=minHosts]','[name=repairMinutes]'];const target=app.querySelector(targets[i]);target?.closest('fieldset, .panel')?.scrollIntoView({block:'start'});(target?.type==='radio'?target.closest('label'):target)?.focus({preventScroll:true});};
  if(draft)nodes.forEach((box,i)=>{box._dagButton.querySelector('small').textContent='草稿 · 点击编辑设置';details.set(box,el('div',{class:'code-node-detail'},el('p',{},'活动尚未发布。现在可以编辑这一阶段的设置，发布后才开放报名与提议。'),btn('编辑此阶段',()=>editStage(i),'button dark')));});
  panel.classList.add('node-dialog');
  nodes.forEach(box=>{box._dagButton.onclick=()=>{panel.querySelector('.code-node-detail')?.remove();canvas.querySelectorAll('.dag-node').forEach(n=>n.setAttribute('aria-pressed',String(n===box._dagButton)));state.dagSelection={eventId:e.id,stage:box.dataset.flowKey};panel.replaceChildren(el('h2',{},box.dataset.flowKey),el('p',{class:'muted'},draft?'草稿 · 尚未开放参与':box.querySelector('.node-status').textContent),details.get(box));modal(panel);};});
  const registrationAvailable=registrationOpen&&((slots.length&&!selectedSlot)||!full||waitOpen||['joined','waitlisted'].includes(joined));
  const registrationButton=btn(['joined','waitlisted'].includes(joined)?'查看我的报名':'去报名',()=>{
    nodes[1]._dagButton.click();
  },'button registration-cta');
  const hasRegistration=['joined','waitlisted'].includes(joined);
  registrationButton.disabled=!registrationAvailable&&!hasRegistration;
  if(registrationButton.disabled)registrationButton.textContent='报名已关闭';
  const selected=nodes.find(box=>state.dagSelection?.eventId===e.id&&box.dataset.flowKey===state.dagSelection.stage);selected?._dagButton.setAttribute('aria-pressed','true');

  app.replaceChildren(el('a',{class:'back',href:'#'},'← 所有聚会'),el('header',{class:'detail-header code-header'},el('span',{class:'eyebrow'},'COFFEE DAG / GRAPH'),el('h1',{},e.title),el('p',{class:'muted publisher'},'发布人：'+(e.publisher?.nickname||'匿名成员')),decisionSummary(e,()=>modal(el('section',{},el('h2',{},'报名成员与留言'),renderParticipantList()))),el('div',{class:'detail-primary-actions'},badge(e.status),e.status!=='draft'?registrationButton:null,e.status!=='draft'?btn('分享活动',()=>shareEvent(e),'button share-cta'):null)),draft?el('div',{class:'draft-toolbar'},el('span',{},'草稿预览 · 仅你可见'),btn('返回编辑',()=>renderEventForm(e)),btn('发布活动',()=>publishPreview(e),'button dark'),btn('删除草稿',()=>deleteDraftDialog(e),'button danger')):document.createDocumentFragment(),el('div',{class:'dag-workspace dag-modal-workspace'},el('section',{class:'dag-graph'},el('div',{class:'dag-toolbar'},'点击节点，查看详情或办理事项 · 连线表示活动流程'),canvas,el('p',{class:'muted'},'报名 / 提议 → 发起人确认 → READY · 截止后按规则成行或取消'))));
}
function deleteDraftDialog(e){
 const content=el('div',{},el('h2',{},'删除草稿？'),el('p',{},'将删除「'+e.title+'」。删除后无法在页面恢复。'),btn('保留草稿',closeModal),btn('确认删除',async()=>{try{await api('/api/events/'+e.id,{version:e.version},'DELETE');closeModal();state.event=null;location.hash='';toast('草稿已删除');}catch(err){errorAt(content,err);}},'button danger'));modal(content);
}
function publishPreview(e){const f=el('form',{},el('h2',{},'发布前，最后看一眼'),el('div',{class:'preview'},el('h3',{},e.title),el('p',{},`${e.city} · ${e.rules.timeSlots?.length?'候选时段 '+e.rules.timeSlots.length+' 个':date(e.rules.startsAt)}`),(e.rules.timeSlots||[]).map(s=>el('p',{},`${date(s.startsAt)} — ${date(s.endsAt)}`)),el('p',{class:'prose'},e.description),el('p',{},`成行最低 ${e.rules.minPeople} 人，最多 ${e.rules.maxPeople} 人`),el('p',{},`${e.rules.timeSlots?.length>1?'首个候选确认期限':'成行决定期限'}：${date(e.rules.recruitmentDeadline)}`),el('p',{},`报名截止：${deadlineLabel(e,'registration')} · 递补截止：${deadlineLabel(e,'promotion')}`),el('p',{},`场地${e.rules.venueRequired?'必需':'非必需'} · 帮忙成员 ${e.rules.minHosts}`),el('p',{},`${e.rules.waitlist?'允许候补':'不开放候补'} · ${e.rules.allowRoleOverlap?'允许角色兼任':'角色不可兼任'} · 补齐 ${e.rules.repairMinutes} 分钟`),el('p',{},`持续检查：${[['continuousVenue','场地'],['continuousTalks','分享'],['continuousCohosts','协办'],['continuousHosts','帮忙成员']].filter(([k])=>e.rules[k]).map(([,v])=>v).join('、')||'无'} · 地址${e.rules.addressVisibility==='public'?'公开':'仅参与者可见'}`)),el('p',{class:'form-note'},'多个候选日期会按同一提前量逐个过期；还有后续日期时活动继续征集。发布后，人数与其他成行规则将锁定。'),el('button',{type:'submit',class:'button orange'},'确认规则并发布'));f.onsubmit=async ev=>{ev.preventDefault();const b=f.querySelector('button[type=submit]');b.disabled=true;try{await command('publish');}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
return {renderDetail};
}
