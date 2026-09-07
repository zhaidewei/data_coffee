const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const state = {user:null, events:[], event:null, city:'全部', loading:0, proposal:null, aiGeneration:0, detailVisible:false, pendingEvent:null, polling:false, aiReviewPending:false};
const statusNames = {draft:'草稿',recruiting:'正在征集',confirmed:'已成行',repairing:'条件补齐中',cancelled:'已取消',completed:'已结束',pending:'待审核',approved:'已通过',rejected:'未通过',withdrawn:'已撤回',joined:'已报名',waitlisted:'候补中',left:'已退出'};
const kinds = {cohost:'协办',host:'现场负责人',talk:'主题分享',venue:'场地',material:'物资',pledge:'赞助'};
const actions = {join:'报名',leave:'退出报名',apply:'提交申请',withdraw:'撤回申请',publish:'发布活动',cancel:'取消活动',review:'审核申请',revoke:'撤销批准',describe:'更正介绍',edit:'编辑草稿'};
function el(tag, props={}, ...children){const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='text')n.textContent=v;else if(v!==null&&v!==undefined){if(k in n)n[k]=v;else n.setAttribute(k,v);}}for(const c of children.flat(Infinity))if(c!==null&&c!==undefined)n.append(c instanceof Node?c:document.createTextNode(String(c)));return n;}
const btn=(text,fn,cls='button')=>el('button',{type:'button',class:cls,onclick:fn},text);
const badge=s=>el('span',{class:`badge ${s}`},statusNames[s]||s);
function toast(message){const n=$('#toast');n.textContent=message;n.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.style.display='none',5500);}
function errorAt(root,error){root.querySelector('.error-box')?.remove();root.append(el('div',{class:'error-box',role:'alert'},error.message||String(error)));}
async function api(path, body, method){let response;try{response=await fetch(path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json',...(path.includes('/actions')||path==='/api/ai/confirm'?{'Idempotency-Key':crypto.randomUUID()}:{})}:{},body:body?JSON.stringify(body):undefined});}catch{throw new Error('网络连接失败，请检查网络后重试。');}let data;try{data=await response.json();}catch{throw new Error(`服务暂时无法响应（${response.status}），请稍后重试。`);}if(!response.ok){const detail=typeof data.error==='string'?data.error:data.error?.message||data.message||'请求失败';throw new Error(response.status===503?`服务尚未配置或暂时不可用：${detail}`:detail);}return data;}
function date(ms,options={}){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Europe/Amsterdam',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',...options}).format(new Date(ms));}
function countdown(ms){let sec=Math.floor((ms-Date.now())/1000);if(sec<=0)return'已到截止时间';const d=Math.floor(sec/86400);sec%=86400;return`${d?d+' 天 ':''}${String(Math.floor(sec/3600)).padStart(2,'0')} : ${String(Math.floor(sec%3600/60)).padStart(2,'0')} : ${String(sec%60).padStart(2,'0')}`;}
setInterval(()=>document.querySelectorAll('[data-countdown]').forEach(n=>n.textContent=countdown(Number(n.dataset.countdown))),1000);
function updateAccount(){$('#account-button').textContent=state.user?state.user.nickname:'登录 / 注册';}
function modal(content){$('#modal-content').replaceChildren(content);$('#modal').showModal();}
function closeModal(){$('#modal').close();}
$('.modal-close').onclick=closeModal;
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
function field(label,name,type='text',value='',required=true){const input=el(type==='textarea'?'textarea':'input',{name,id:name,type:type==='textarea'?undefined:type,value,required,rows:type==='textarea'?4:undefined});return el('label',{class:'field',htmlFor:name},label,input);}
function check(label,name,value=false){return el('label',{class:'check'},el('input',{type:'checkbox',name,checked:value}),label);}
async function login(){const form=el('form',{},el('span',{class:'eyebrow'},'WELCOME TO THE TABLE'),el('h2',{},'留个名字，一起喝咖啡'),el('p',{class:'muted'},'使用邮箱验证码登录。昵称由你选择；报名只代表你本人。'),field('邮箱','email','email'),field('昵称','nickname','text',''));const code=field('验证码','code','text');code.hidden=true;code.querySelector('input').required=false;const submit=el('button',{class:'button dark',type:'submit'},'发送验证码');form.append(code,submit);let sent=false;form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const v=Object.fromEntries(new FormData(form));if(!sent){const r=await api('/api/auth/request',{email:v.email});sent=true;code.hidden=false;code.querySelector('input').required=true;form.elements.email.readOnly=true;submit.textContent='验证并登录';if(r.developmentCode)form.append(el('p',{class:'form-note'},`开发环境验证码：${r.developmentCode}`));else toast('验证码已发送，请检查邮箱。');code.querySelector('input').focus();}else{const r=await api('/api/auth/verify',v);state.user=r.user;updateAccount();closeModal();await route();toast('登录成功，欢迎加入。');}}catch(err){errorAt(form,err);}finally{submit.disabled=false;}};modal(form);}
function requireUser(){if(state.user)return true;login();return false;}
function account(){if(!state.user)return login();const f=el('form',{},el('h2',{},'我的社区名片'),el('p',{class:'muted'},state.user.email),field('昵称','nickname','text',state.user.nickname),check('公开显示我的昵称（关闭后，活动管理者仍可查看）','publicNickname',state.user.publicNickname),el('button',{class:'button dark',type:'submit'},'保存设置'),btn('退出登录',async()=>{try{await api('/api/auth/logout',{});state.user=null;updateAccount();closeModal();route();}catch(e){errorAt(f,e);}},'button quiet'));f.onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/me',{nickname:f.elements.nickname.value,publicNickname:f.elements.publicNickname.checked},'PATCH');state.user=r.user;updateAccount();closeModal();toast('设置已保存');route();}catch(err){errorAt(f,err);}};modal(f);}
$('#account-button').onclick=account;
$('#create-button').onclick=()=>{if(requireUser())location.hash='new';};
function hero(){return el('section',{class:'hero'},el('div',{},el('span',{class:'eyebrow'},'GOOD COFFEE. REAL CONNECTIONS.'),el('h1',{},'数据之外，',el('br'),'还有一杯 ',el('em',{},'Coffee.')),el('p',{},'把屏幕里的同行，变成咖啡桌旁的朋友。\n在荷兰，和做数据、做 AI 的人聊一个真实问题。'),el('div',{class:'hero-actions'},el('a',{href:'#gatherings',class:'button dark',onclick:e=>{e.preventDefault();$('#gatherings')?.scrollIntoView({behavior:'smooth'});}},'找到下一场聚会 ↗'),el('span',{class:'muted'},'小规模 · 有话聊 · 一起办'))),el('div',{class:'hero-art','aria-label':'Data Coffee 咖啡杯插画',role:'img'},el('span',{class:'steam','aria-hidden':'true'},'∿ ∿'),el('span',{class:'orbit','aria-hidden':'true'},'✳'),el('div',{class:'cup','aria-hidden':'true'},'dc.'),el('span',{class:'art-note'},'BREW IDEAS, TOGETHER.')));}
function eventCard(e){const count=e.counts?.joined||0;return el('a',{class:'event-card',href:`#event/${e.id}`},el('div',{class:'card-art'},el('div',{class:'date-block'},date(e.rules.startsAt,{month:'short',day:undefined,hour:undefined,minute:undefined}),el('strong',{},date(e.rules.startsAt,{month:undefined,day:'2-digit',hour:undefined,minute:undefined}))),el('span',{class:'card-symbol','aria-hidden':'true'},'{ ☕ }'),badge(e.status)),el('div',{class:'card-body'},el('div',{class:'card-city'},`↗ ${e.city}  ·  荷兰当地时间 ${date(e.rules.startsAt,{month:undefined,day:undefined})}`),el('h3',{},e.title),el('p',{},e.description),el('div',{class:'mini-progress'},el('span',{style:`width:${Math.min(100,count/e.rules.minPeople*100)}%`})),el('div',{class:'card-bottom'},el('span',{},`${count} 人报名 · ${e.rules.minPeople} 人起成行`),el('span',{},'看看聚会 ↗'))));}
function renderHome(){state.detailVisible=false;state.pendingEvent=null;app.replaceChildren(el('section',{id:'gatherings'}));const section=$('#gatherings');const cities=['全部',...new Set(state.events.map(e=>e.city))];section.append(el('div',{class:'section-heading'},el('div',{},el('h2',{},'下一杯，在哪里？'),el('p',{},'看看附近正在发生什么，也可以发起属于你的那一场。')),el('div',{class:'filters','aria-label':'按城市筛选'},cities.map(c=>btn(c,()=>{state.city=c;renderHome();},`filter ${state.city===c?'active':''}`)))));const filtered=state.events.filter(e=>state.city==='全部'||e.city===state.city);section.append(el('div',{class:'grid'},filtered.length?filtered.map(eventCard):el('div',{class:'empty'},el('span',{class:'eyebrow'},'A TABLE WAITING FOR YOU'),el('h3',{},'第一杯咖啡，等你来约'),el('p',{},'这里还没有公开聚会。选一个话题，邀请同频的人坐下来聊聊。'),el('p',{class:'muted'},'点击右上角「发起聚会」创建活动。'))));}
async function command(action,extra={}){if(!requireUser())return;const id=state.event.id;const r=await api(`/api/events/${id}/actions`,{action,version:state.event.version,...extra});closeModal();toast('操作已保存');if(state.event?.id===id)await loadEvent(id);return r;}
function run(action,extra={},node){return command(action,extra).catch(e=>node?errorAt(node,e):toast(e.message));}
function confirmation(title,message,action,extra={},reason=false){const f=el('form',{},el('h2',{},title),el('p',{},message));if(reason)f.append(field('原因（将记入活动记录）','reason','textarea'));const b=el('button',{type:'submit',class:'button dark'},'确认');f.append(b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await command(action,{...extra,...(reason?{reason:f.elements.reason.value}:{})});}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function conditionNode(c){return el('div',{class:`condition ${c.satisfied?'ok':''}`},el('div',{class:'condition-top'},el('span',{},c.label),el('span',{},c.satisfied?'✓ 已满足':'待补齐')),el('strong',{},`${c.current} / ${c.required}`),el('div',{class:'progress-track'},el('span',{style:`width:${c.required?Math.min(100,c.current/c.required*100):100}%`})),el('span',{class:'muted'},c.continuous?'成行后仍需持续满足':'成行时检查'));}
function applyForm(kind){if(!requireUser())return;const f=el('form',{},el('h2',{},`申请${kinds[kind]}`),field('标题','title','text'),field('具体说明','detail','textarea'));if(kind==='venue')f.append(field('可容纳人数','capacity','number'),field('详细地址','address','text'),el('p',{class:'muted'},state.event.rules.addressVisibility==='participants'?'地址仅按活动规则向参与者展示。':'此活动将公开场地地址。'));if(kind==='talk')f.append(field('预计时长（分钟）','duration','number',20));if(kind==='pledge')f.append(field('赞助金额（欧元）','amount','number'));const b=el('button',{class:'button dark',type:'submit'},'提交申请');f.append(el('p',{class:'form-note'},'申请通过后才计入条件。申请只代表你本人，可以在活动中查看处理结果或撤回。'),b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;const v=Object.fromEntries(new FormData(f));for(const k of ['capacity','amount','duration'])if(k in v)v[k]=Number(v[k]);try{await command('apply',{kind,...v});}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function applicationNode(a,e,reviewControls=true,ownControls=true){const own=(e.myApplications||[]).some(x=>x.id===a.id);const mutable=!['cancelled','completed'].includes(e.status)&&Date.now()<e.rules.startsAt;const canReview=reviewControls&&mutable&&(['cohost','venue','host'].includes(a.kind)?e.isOwner:e.canManage);return el('div',{class:'application'},el('h3',{},`${kinds[a.kind]||a.kind} · ${a.title} `,badge(a.status)),el('p',{},a.detail),a.capacity?el('p',{},`容量：${a.capacity} 人`):null,a.address?el('p',{},`地址：${a.address}`):null,a.duration?el('p',{},`分享时长：${a.duration} 分钟`):null,a.amount?el('p',{},`赞助：€${a.amount}`):null,a.reason?el('p',{},`处理说明：${a.reason}`):null,el('div',{class:'inline-actions'},ownControls&&mutable&&own&&['pending','approved'].includes(a.status)?btn('撤回 / 退出',()=>confirmation('撤回这项申请？','撤回已通过的申请可能影响成行条件。','withdraw',{applicationId:a.id}),'button quiet'):null,canReview&&a.status==='pending'?btn('通过',()=>confirmation('通过申请？',`批准「${a.title}」，系统将重新检查成行条件。`,'review',{applicationId:a.id,approved:true})):null,canReview&&a.status==='pending'?btn('拒绝',()=>confirmation('拒绝申请','请向申请人说明原因。','review',{applicationId:a.id,approved:false},true),'button quiet'):null,mutable&&e.isOwner&&a.kind==='cohost'&&a.status==='approved'?btn('撤销协办资格',()=>confirmation('撤销批准','撤销后系统将重新检查活动条件。','revoke',{applicationId:a.id},true),'button danger'):null));}
function renderDetailLegacy(e){
  state.renderedPhase=eventTimePhase(e);state.detailVisible=true;state.pendingEvent=null;
  const p=e.myParticipation,joined=typeof p==='string'?p:p?.status;
  const active=['recruiting','confirmed','repairing'].includes(e.status),beforeStart=Date.now()<e.rules.startsAt;
  const cs=e.conditions||[],applications=e.applications||[];
  const timeline=el('div',{class:'gathering-flow','aria-label':'从主题到举办的活动流程'});
  const stage=(number,title,current=false,extra='')=>{const n=el('section',{class:'journey-node '+extra+(current?' current':''),...(current?{'aria-current':'step'}:{})},el('div',{class:'journey-heading'},el('span',{class:'journey-number','aria-hidden':'true'},number),el('h2',{},title),current?el('span',{class:'journey-current'},'当前阶段'):null));timeline.append(n);return n;};
  const conditionAt=(node,keys)=>{const found=cs.filter(c=>keys.includes(c.key));if(found.length)node.append(el('div',{class:'conditions'},found.map(conditionNode)));};
  const contributions=(node,ks)=>{if(active&&beforeStart)node.append(el('div',{class:'inline-actions'},ks.map(k=>btn('＋ 申请'+kinds[k],()=>applyForm(k)))));const found=applications.filter(a=>ks.includes(a.kind));if(found.length)node.append(found.map(a=>applicationNode(a,e)));else node.append(el('p',{class:'muted'},state.user?'尚无申请，可以从这里提供帮助。':'尚无公开申请；登录后可申请并查看进度。'));};
  const topic=stage('01','这次，我们聊什么',e.status==='draft');
  topic.append(el('div',{class:'prose'},e.description||'发起人尚未填写介绍。'));
  if(e.isOwner&&!['cancelled','completed'].includes(e.status)){
    const edits=el('div',{class:'inline-actions'});
    if(e.status==='draft')edits.append(btn('编辑草稿',()=>renderEventForm(e)),btn('预览并发布',()=>publishPreview(e),'button dark'));
    else if(beforeStart)edits.append(btn('更正活动介绍',()=>{const f=el('form',{},el('h2',{},'更正活动介绍'),el('p',{class:'muted'},'活动规则已锁定。介绍更正不会改变已公布的规则。'),field('介绍','description','textarea',e.description),el('button',{class:'button dark',type:'submit'},'保存更正'));f.onsubmit=async ev=>{ev.preventDefault();try{await command('describe',{description:f.elements.description.value});}catch(err){errorAt(f,err);}};modal(f);}));
    topic.append(edits);
  }
  const place=stage('02','约好时间与地点'+(e.rules.venueRequired?'':' · 场地可选'));
  place.append(el('p',{class:'journey-lead'},date(e.rules.startsAt)+' — '+date(e.rules.endsAt)),el('p',{class:'muted'},'↗ '+e.city+' · Europe/Amsterdam · 荷兰当地时间'),el('p',{class:'muted'},'场地地址'+(e.rules.addressVisibility==='public'?'公开展示。':'仅向有权限的参与者展示。')));
  conditionAt(place,['venue']);contributions(place,['venue']);
  place.append(el('p',{class:'muted'},'报名与资源征集同步进行，可以直接在下一节点报名。'));
  const join=stage('03','留一个位置给自己',e.status==='recruiting');
  join.append(el('p',{class:'journey-lead'},(e.counts?.joined||0)+' 人报名 · '+(e.counts?.waitlisted||0)+' 人候补'),el('p',{class:'muted'},'最低 '+e.rules.minPeople+' 人，最多 '+e.rules.maxPeople+' 人；'+(e.rules.waitlist?'满员后进入候补，按报名顺序递补。':'不开放候补。')+'仅限本人报名。'),el('p',{class:'muted'},'报名截止：'+date(e.rules.registrationDeadline)));
  conditionAt(join,['people']);
  if(joined&&joined!=='left')join.append(el('p',{class:'form-note'},'我的状态：'+statusNames[joined]+(joined==='waitlisted'&&p?.position?' · 候补第 '+p.position+' 位':'')));
  if(active&&beforeStart){
    const repair=(e.repairs||[]).find(r=>r.key==='people');
    const deadline=repair?.deadline||(e.status==='recruiting'?e.rules.recruitmentDeadline:e.rules.registrationDeadline);
    join.append(el('p',{class:'muted'},repair?'人数补齐剩余时间':e.status==='recruiting'?'距离征集截止':'距离报名截止'),el('div',{class:'countdown','data-countdown':deadline},countdown(deadline)));
    if(['joined','waitlisted'].includes(joined))join.append(btn(joined==='waitlisted'?'退出候补':'退出报名',()=>confirmation('退出这场聚会？','你的席位将按规则释放；退出可能影响成行人数。','leave'),'button quiet'));
    else{
      const full=(e.counts?.joined||0)>=e.rules.maxPeople;
      const open=Date.now()<e.rules.registrationDeadline||!!repair;
      const waitingAllowed=e.rules.waitlist&&Date.now()<e.rules.promotionDeadline;
      if(open&&(!full||waitingAllowed))join.append(btn(full?'加入候补':'我要参加 ↗',()=>confirmation('确认本人报名',e.title+' · '+date(e.rules.startsAt)+'。请确认你可以到场；满员时将按规则处理候补。','join'),'button orange'));
      else join.append(el('p',{class:'form-note'},!open?'报名已截止。':e.rules.waitlist?'名额已满，候补已截止。':'名额已满，本场不开放候补。'));
    }
  }else{join.append(el('p',{class:'muted'},active?'活动已开始，报名已关闭。':'当前状态不开放报名。'));if(active&&joined==='waitlisted')join.append(btn('退出候补',()=>confirmation('退出候补？','活动已经开始，你仍可退出候补名单。','leave'),'button quiet'));}

  const people=(e.participants||[]).filter(x=>x.status!=='left');
  join.append(el('details',{id:'detail-participants',class:'node-details'},el('summary',{},'谁会坐在这张桌旁 · 查看名单'),people.length?el('div',{class:'participant-list'},people.map(x=>el('span',{class:'person'},(x.nickname||'匿名参与者')+(x.isMe?'（我）':'')+' · '+(statusNames[x.status]||x.status)))):el('p',{class:'muted'},'还没有人入座，期待你的加入。')),el('div',{class:'inline-actions'},btn('问问活动助手 ✳',()=>openAI(),'button')));
  const resource=stage('04','一起凑齐分享、角色与资源');
  resource.append(el('p',{class:'muted'},'申请通过后才计入条件。审核与撤回都在对应申请旁完成。'));
  const roles=el('div',{class:'contribution-group'},el('h3',{},'有人张罗，有人照应'+(!e.rules.minHosts&&!e.rules.minCohosts?' · 可选':'')),el('p',{class:'muted'},e.rules.allowRoleOverlap?'允许同一人兼任角色。':'现场负责人与协办等角色按独立人数核验。'));conditionAt(roles,['cohosts','hosts','roles']);contributions(roles,['cohost','host']);
  const talks=el('div',{class:'contribution-group'},el('h3',{},'带一段分享来'+(!e.rules.minTalks?' · 可选':'')));conditionAt(talks,['talks']);contributions(talks,['talk']);
  const supplies=el('details',{id:'detail-supplies',class:'node-details'},el('summary',{},'物资与赞助 · 可选'));contributions(supplies,['material','pledge']);resource.append(roles,talks,supplies);
  const gate=stage('05','征集截止，决定是否成行',false,'decision-stage');
  gate.append(el('p',{class:'journey-lead'},date(e.rules.recruitmentDeadline)),el('div',{class:'journey-question'},'最低人数与全部成行条件都满足？'),el('div',{class:'journey-branches'},el('div',{class:'journey-branch positive'},el('span',{class:'branch-label'},'是 ↓'),el('strong',{},'确认成团'),el('p',{},'沿主线继续准备聚会')),el('div',{class:'journey-branch negative'},el('span',{class:'branch-label'},'否 → 终止'),el('strong',{},'取消活动'),el('p',{},'记录原因，并通知参与者'))));
  if(!cs.length)gate.append(el('p',{class:'muted'},'暂无条件评估记录。'));
  const care=stage('06','成团后，继续照应这张桌',active&&e.status!=='recruiting'&&beforeStart);
  care.append(el('p',{class:'muted'},'有人退出或持续条件变化时，系统重新检查。'),el('div',{class:'journey-inline-step'},'有可递补的候补 → 按报名顺序递补'),el('p',{class:'muted'},'递补截止：'+date(e.rules.promotionDeadline)+'。'+(e.rules.waitlist?'仅在递补截止前、活动开始前递补。':'此活动不开放候补。')),el('div',{class:'journey-question'},'递补后，人数或持续条件仍不足？'),el('div',{class:'journey-branches'},el('div',{class:'journey-branch positive'},el('span',{class:'branch-label'},'否 ↓'),el('strong',{},'活动继续')),el('div',{class:'journey-branch warning'},el('span',{class:'branch-label'},'是 ↓'),el('strong',{},'进入补齐'),el('p',{},'补齐窗口 '+e.rules.repairMinutes+' 分钟，最晚到活动开始。'))));
  for(const r of e.repairs||[])care.append(el('div',{class:'repair'},r.label+' · 补齐截止 '+date(r.deadline),el('div',{'data-countdown':r.deadline},countdown(r.deadline))));
  care.append(el('div',{class:'repair-decision'},el('p',{class:'muted'},'进入补齐后，以实际倒计时为准'),el('div',{class:'journey-question'},'截止前，全部待补条件已满足？'),el('div',{class:'journey-branches'},el('div',{class:'journey-branch positive'},el('span',{class:'branch-label'},'是 ↓'),el('strong',{},'恢复成行')),el('div',{class:'journey-branch negative'},el('span',{class:'branch-label'},'到期仍不足 → 终止'),el('strong',{},'取消活动')))));
  const finish=stage('07',e.status==='cancelled'?'活动已取消':e.status==='completed'?'相聚结束，留下记录':'线下相聚',e.status==='cancelled'||e.status==='completed'||active&&!beforeStart,'finish-stage');
  finish.append(el('p',{class:'journey-lead'},date(e.rules.startsAt)+' — '+date(e.rules.endsAt)),e.reason?el('p',{class:'error-box'},e.reason):el('p',{class:'muted'},'按约定时间相聚，活动结束后保留状态与评估记录。'));
  const audit=el('details',{id:'detail-audit',class:'node-details'},el('summary',{},'查看状态与评估记录'),el('p',{class:'muted'},'当前版本 v'+e.version),(e.receipts||[]).slice().reverse().map(r=>el('div',{class:'receipt'},el('strong',{},date(r.at)+' · '+r.kind),el('p',{},r.reason),r.descriptionChange?el('details',{id:'detail-description-'+r.at+'-'+r.kind,class:'description-history'},el('summary',{},'查看介绍更正前后'),el('h3',{},'更正前'),el('div',{class:'prose'},r.descriptionChange.before||'（空）'),el('h3',{},'更正后'),el('div',{class:'prose'},r.descriptionChange.after||'（空）')):null,el('p',{class:'muted'},(r.conditions||[]).map(c=>c.label+' '+c.current+'/'+c.required).join(' · ')))));
  finish.append(audit);
  if(e.isOwner&&!['cancelled','completed'].includes(e.status))finish.append(el('details',{id:'detail-cancel',class:'node-details'},el('summary',{},'提前终止活动'),el('p',{class:'muted'},'取消会通知参与者，并保留取消原因。'),btn('取消活动',()=>confirmation('取消这场活动','此操作会通知参与者并记录取消原因。','cancel',{},true),'button danger')));
  app.replaceChildren(el('a',{class:'back',href:'#'},'← 所有聚会'),el('header',{class:'detail-header unified-header'},el('span',{class:'eyebrow'},'一场聚会，一起凑成'),el('h1',{},e.title),badge(e.status)),timeline);
}
function renderDetailPrevious(e){
  state.renderedPhase=eventTimePhase(e);state.detailVisible=true;state.pendingEvent=null;
  const p=e.myParticipation,joined=typeof p==='string'?p:p?.status;
  const active=['recruiting','confirmed','repairing'].includes(e.status),beforeStart=Date.now()<e.rules.startsAt;
  const applications=e.applications||[],conditions=e.conditions||[],people=(e.participants||[]).filter(x=>x.status!=='left');
  const flow=el('div',{class:'code-flow','aria-label':'活动规则与参与流程'});
  const arrow=()=>el('span',{class:'code-arrow','aria-hidden':'true'});
  const actionsFor=(kindsList)=>applications.filter(a=>kindsList.includes(a.kind));
  const node=(purpose,status,open,buttonLabel,detail,current=false)=>{
    const trigger=el('button',{class:'button flow-trigger',type:'button','aria-expanded':'false'},buttonLabel);
    const box=el('section',{class:`code-node ${open?'editable':'locked'}${current?' current':''}`,'data-flow-key':purpose,'aria-current':current?'step':undefined},
      el('div',{class:'code-node-core'},el('div',{},el('p',{class:'node-purpose'},`目的：${purpose}`),el('p',{class:'node-status'},'状态：',el('strong',{},status))),trigger),
      el('div',{class:'code-node-detail'},detail));
    const syncExpanded=()=>trigger.setAttribute('aria-expanded',String(box.classList.contains('pinned')||box.classList.contains('preview')));
    trigger.onpointerenter=ev=>{if(ev.pointerType==='mouse'){box.classList.add('preview');syncExpanded();}};
    box.onpointerleave=()=>{box.classList.remove('preview');syncExpanded();};
    trigger.onfocus=()=>{box.classList.add('preview');syncExpanded();};
    box.onfocusout=ev=>{if(!box.contains(ev.relatedTarget)){box.classList.remove('preview');syncExpanded();}};
    trigger.onclick=()=>{box.classList.remove('preview');box.classList.toggle('pinned');syncExpanded();};
    box.onkeydown=ev=>{if(ev.key==='Escape'){box.classList.remove('preview','pinned');syncExpanded();trigger.focus();box.classList.remove('preview');syncExpanded();}};
    flow.append(box);return box;
  };
  const contributionDetail=(kindsList)=>el('div',{},active&&beforeStart?el('div',{class:'inline-actions'},kindsList.map(k=>btn(`＋ 申请${kinds[k]}`,()=>applyForm(k)))):null,
    actionsFor(kindsList).length?actionsFor(kindsList).map(a=>applicationNode(a,e)):el('p',{class:'muted'},state.user?'尚无申请，可以从这里提供帮助。':'尚无公开申请；登录后可申请并查看进度。'));


  const topicActions=el('div',{},el('div',{class:'prose'},e.description||'发起人尚未填写介绍。'));
  if(e.isOwner&&!['cancelled','completed'].includes(e.status)){
    const row=el('div',{class:'inline-actions'});
    if(e.status==='draft')row.append(btn('编辑草稿',()=>renderEventForm(e)),btn('预览并发布',()=>publishPreview(e),'button dark'));
    else if(beforeStart)row.append(btn('更正活动介绍',()=>{const f=el('form',{},el('h2',{},'更正活动介绍'),field('介绍','description','textarea',e.description),el('button',{class:'button dark',type:'submit'},'保存更正'));f.onsubmit=async ev=>{ev.preventDefault();try{await command('describe',{description:f.elements.description.value});}catch(err){errorAt(f,err);}};modal(f);}));
    topicActions.append(row);
  }
  node('明确交流主题',e.description?'主题已发布':'等待填写主题',e.status==='draft',e.status==='draft'?'参与':'查看',topicActions,e.status==='draft');flow.append(arrow());

  const venueCondition=conditions.find(c=>c.key==='venue');
  const venueStatus=e.rules.venueRequired?(venueCondition?.satisfied?'场地已确认':`场地待确认 · ${venueCondition?.current||0}/${venueCondition?.required||e.rules.maxPeople}`):'时间已确定 · 场地可选';
  const placeDetail=el('div',{},el('p',{class:'journey-lead'},`${date(e.rules.startsAt)} — ${date(e.rules.endsAt)}`),el('p',{class:'muted'},`${e.city} · Europe/Amsterdam · 场地地址${e.rules.addressVisibility==='public'?'公开':'仅向有权限的参与者展示'}`),contributionDetail(['venue']));
  node('确定时间与地点',venueStatus,active&&beforeStart,'参与',placeDetail);flow.append(arrow());

  const repair=(e.repairs||[]).find(r=>r.key==='people'),full=(e.counts?.joined||0)>=e.rules.maxPeople;
  const registrationOpen=active&&beforeStart&&(Date.now()<e.rules.registrationDeadline||!!repair);
  const waitOpen=e.rules.waitlist&&Date.now()<e.rules.promotionDeadline;
  const joinDetail=el('div',{},el('p',{class:'muted'},`最低 ${e.rules.minPeople} 人，最多 ${e.rules.maxPeople} 人；${e.rules.waitlist?'满员后按顺序候补':'不开放候补'}。报名截止：${date(e.rules.registrationDeadline)}`));
  if(joined&&joined!=='left'){
    joinDetail.append(el('p',{class:'form-note'},`我的状态：${statusNames[joined]}${joined==='waitlisted'&&p?.position?' · 候补第 '+p.position+' 位':''}`));
    if(active&&(beforeStart||joined==='waitlisted'))joinDetail.append(btn(joined==='waitlisted'?'退出候补':'退出报名',()=>confirmation('退出这场聚会？','席位将按规则释放。','leave'),'button quiet'));
  }
  else if(registrationOpen&&(!full||waitOpen))joinDetail.append(btn(full?'加入候补':'我要参加',()=>confirmation('确认本人报名',`${e.title} · ${date(e.rules.startsAt)}`,'join'),'button orange'));
  else joinDetail.append(el('p',{class:'form-note'},registrationOpen?'名额已满，候补不可用。':'报名已关闭。'));
  joinDetail.append(el('details',{id:'detail-participants'},el('summary',{},'查看参与名单'),people.length?el('div',{class:'participant-list'},people.map(x=>el('div',{class:'person'},el('strong',{},`${x.nickname||'匿名参与者'}${x.isMe?'（我）':''} · ${statusNames[x.status]||x.status}`),x.registrationMessage?el('p',{class:'registration-message'},x.registrationMessage):null))):el('p',{class:'muted'},'还没有人报名。')),el('div',{class:'inline-actions'},btn('问问活动助手 ✳',()=>openAI(),'button')));
  const countStatus=`${e.counts?.joined||0}/${e.rules.minPeople} 人${joined&&joined!=='left'?' · 我'+statusNames[joined]:''}`;
  const participationOpen=registrationOpen||(active&&beforeStart&&joined==='joined')||(active&&joined==='waitlisted');
  node('达到最低参与人数',countStatus,participationOpen,'参与',joinDetail,e.status==='recruiting');flow.append(arrow());

  const resourceKeys=['talks','cohosts','hosts','roles'],resourceConditions=conditions.filter(c=>resourceKeys.includes(c.key));
  const missingResources=resourceConditions.filter(c=>!c.satisfied).length;
  const continuousLabels=resourceConditions.filter(c=>c.continuous).map(c=>c.label);
  const resourceDetail=el('div',{},el('p',{class:'muted'},`分享 ${e.rules.minTalks} · 协办 ${e.rules.minCohosts} · 现场负责人 ${e.rules.minHosts}。${e.rules.allowRoleOverlap?'允许角色兼任':'角色需由不同成员承担'}。申请通过后计入条件。`),el('p',{class:'muted'},`成团后持续检查：${continuousLabels.join('、')||'仅人数'}`),
    contributionDetail(['cohost','host','talk']),el('details',{id:'detail-supplies'},el('summary',{},'物资与赞助'),contributionDetail(['material','pledge'])));
  node('补齐分享、角色与资源',missingResources?`还有 ${missingResources} 项条件未满足`:'必要条件已满足',active&&beforeStart,'参与',resourceDetail);flow.append(arrow());

  flow.append(el('div',{class:'code-diamond-wrap'},el('div',{class:'code-diamond'},el('div',{},el('strong',{},'截止时全部条件满足？'),el('span',{},date(e.rules.recruitmentDeadline))))));
  const mainActive=!['cancelled'].includes(e.status),cancelActive=e.status==='cancelled';
  flow.append(el('div',{class:'code-branches'},
    el('div',{class:`code-branch ${mainActive?'active':'muted'}`},el('span',{},'YES'),el('strong',{},'确认成团')),
    el('div',{class:`code-branch ${cancelActive?'active':'muted'}`},el('span',{},'NO'),el('strong',{},'取消活动'))));
  flow.append(el('div',{class:'code-main-path'},arrow()));

  const careDetail=el('div',{},el('p',{class:'muted'},`退出先递补；递补截止 ${date(e.rules.promotionDeadline)}。仍不足时进入 ${e.rules.repairMinutes} 分钟补齐倒计时，最晚到活动开始。`));
  for(const r of e.repairs||[])careDetail.append(el('div',{class:'repair'},`${r.label} · 补齐截止 ${date(r.deadline)}`,el('div',{'data-countdown':r.deadline},countdown(r.deadline))));
  const careOpen=e.status==='confirmed'||e.status==='repairing';
  node('处理退出与资源变化',e.status==='repairing'?`补齐中 · ${(e.repairs||[]).length} 项异常`:'候补优先，必要时补齐',careOpen,careOpen?'参与':'查看',careDetail,careOpen);flow.append(arrow());

  const finishDetail=el('div',{},e.reason?el('p',{class:'error-box'},e.reason):el('p',{class:'muted'},`${date(e.rules.startsAt)} — ${date(e.rules.endsAt)} · ${e.city}`));
  finishDetail.append(el('details',{id:'detail-audit'},el('summary',{},'查看状态与评估记录'),el('p',{class:'muted'},`当前版本 v${e.version}`),(e.receipts||[]).slice().reverse().map(r=>el('div',{class:'receipt'},el('strong',{},`${date(r.at)} · ${r.kind}`),el('p',{},r.reason),r.descriptionChange?el('details',{id:`detail-description-${r.at}-${r.kind}`,class:'description-history'},el('summary',{},'查看介绍更正前后'),el('h3',{},'更正前'),el('div',{class:'prose'},r.descriptionChange.before||'（空）'),el('h3',{},'更正后'),el('div',{class:'prose'},r.descriptionChange.after||'（空）')):null,el('p',{class:'muted'},(r.conditions||[]).map(c=>`${c.label} ${c.current}/${c.required}`).join(' · '))))));
  if(e.isOwner&&!['cancelled','completed'].includes(e.status))finishDetail.append(el('details',{id:'detail-cancel'},el('summary',{},'提前终止活动'),btn('取消活动',()=>confirmation('取消这场活动','此操作会通知参与者并记录原因。','cancel',{},true),'button danger')));
  node('完成线下相聚',e.status==='cancelled'?'活动已取消':e.status==='completed'?'活动已结束':`等待 ${date(e.rules.startsAt)}`,false,'查看',finishDetail,e.status==='completed');
  flow.append(arrow(),el('div',{class:'code-terminal code-end'},e.status==='cancelled'?'END · 已取消':'END · 线下相聚'));
  app.replaceChildren(el('a',{class:'back',href:'#'},'← 所有聚会'),el('header',{class:'detail-header code-header'},el('span',{class:'eyebrow'},'ACTIVITY FLOW'),el('h1',{},e.title),badge(e.status)),flow);
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
  const contributions=(ks,empty)=>el('div',{},active&&beforeStart?el('div',{class:'inline-actions'},ks.map(k=>btn(`＋ ${k==='host'?'报名主持人':'提供场地'}`,()=>applyForm(k)))):null,
    appsFor(ks).some(a=>(e.myApplications||[]).some(m=>m.id===a.id))?appsFor(ks).filter(a=>(e.myApplications||[]).some(m=>m.id===a.id)).map(a=>applicationNode(a,e,false)):el('p',{class:'muted'},empty));
  const summaryChart=(title,items=[])=>{
    const max=Math.max(1,...items.map(x=>x.count));
    return el('div',{class:'preference-chart'},el('strong',{},title),items.length?items.map(x=>el('div',{class:'preference-row'},el('span',{},x.label),el('i',{},el('b',{style:`width:${x.count/max*100}%`})),el('em',{},x.count))):el('p',{class:'muted'},'等待第一份偏好'));
  };

  flow.append(el('div',{class:'code-terminal'},'START · 发起活动'),arrow());
  const topicDetail=el('div',{},el('div',{class:'prose'},e.description||'发起人尚未填写介绍。'));
  if(e.isOwner&&!['cancelled','completed'].includes(e.status)){
    const row=el('div',{class:'inline-actions'});
    if(e.status==='draft')row.append(btn('编辑草稿',()=>renderEventForm(e)),btn('预览并发布',()=>publishPreview(e),'button dark'));
    else if(beforeStart)row.append(btn('更正活动介绍',()=>{const f=el('form',{},el('h2',{},'更正活动介绍'),field('介绍','description','textarea',e.description),el('button',{class:'button dark',type:'submit'},'保存更正'));f.onsubmit=async ev=>{ev.preventDefault();try{await command('describe',{description:f.elements.description.value});}catch(err){errorAt(f,err);}};modal(f);}));
    topicDetail.append(row);
  }
  flow.append(node('发起活动',e.description?'主题与规则已设定':'等待填写主题',e.status==='draft',e.status==='draft'?'参与':'查看',topicDetail,e.status==='draft'),arrow(),el('div',{class:'parallel-fork','aria-hidden':'true'}));

  const repair=(e.repairs||[]).find(r=>r.key==='people'),full=(e.counts?.joined||0)>=e.rules.maxPeople;
  const registrationOpen=active&&beforeStart&&(Date.now()<e.rules.registrationDeadline||!!repair);
  const waitOpen=e.rules.waitlist&&Date.now()<e.rules.promotionDeadline;
  const slots=e.rules.timeSlots||[], selectedSlot=slots.find(s=>s.id===e.selectedSlotId);
  const prefForm=el('form',{class:'preference-form'},el('p',{class:'form-note'},`活动城市：${e.city}`));
  if(slots.length)prefForm.append(el('fieldset',{class:'slot-options'},el('legend',{},'可以参加的时段（可多选）'),slots.map(s=>el('label',{class:'check'},el('input',{type:'checkbox',name:'availableSlotIds',value:s.id,checked:p?.availableSlotIds?.includes(s.id)||false}),`${date(s.startsAt)} — ${date(s.endsAt)}${s.id===e.selectedSlotId?' · 最终时段':''}`))));
  else prefForm.append(el('p',{class:'form-note'},`活动时间：${date(e.rules.startsAt)} — ${date(e.rules.endsAt)}`));
  const transport=el('fieldset',{class:'transport-preferences'},el('legend',{},'交通偏好（可多选）'),[['public_transport','公共交通'],['car','开车']].map(([value,label])=>el('label',{class:'check'},el('input',{type:'checkbox',name:'transportPreferences',value,checked:p?.transportPreferences?.includes(value)||false}),label)));
  const message=field('报名留言（选填，最多 500 字）','registrationMessage','textarea',p?.registrationMessage||'',false);
  message.style.gridColumn='1 / -1';message.querySelector('textarea').maxLength=500;
  prefForm.append(transport,message,el('p',{class:'form-note'},'可以介绍自己或说点什么。留言会随参与名单公开展示；交通偏好按人数汇总，用于场地安排。'));
  if(e.isOwner&&(!joined||joined==='left'))prefForm.append(el('p',{class:'form-note'},'你是发起人，也需要在这里报名并选择可参加时段，才会计入参与人数。'));
  const prefSubmit=el('button',{class:'button orange',type:'submit'},joined&&joined!=='left'?'保存偏好':'报名并保存偏好');
  prefForm.append(el('p',{class:'form-note'},slots.length?(selectedSlot?'最终时段已确认，请确认你可以参加该时段。':'勾选所有可以参加的时段，发布者将在征集截止前确认一次最终安排。'):'请确认你可以参加已公布的活动时间。'),prefSubmit);
  prefForm.onsubmit=async ev=>{ev.preventDefault();prefSubmit.disabled=true;try{const availableSlotIds=new FormData(prefForm).getAll('availableSlotIds');if(slots.length&&!availableSlotIds.length)throw new Error('请至少选择一个可以参加的时段。');if(selectedSlot&&!availableSlotIds.includes(selectedSlot.id))throw new Error('报名需要能够参加已确认的最终时段。');await command('join',{availableSlotIds,transportPreferences:new FormData(prefForm).getAll('transportPreferences'),registrationMessage:prefForm.elements.registrationMessage.value});}catch(err){errorAt(prefForm,err);}finally{prefSubmit.disabled=false;}};
  const prefSummary=e.preferenceSummary||{times:[],places:[]};
  const joinDetail=el('div',{class:'registration-detail'},el('div',{class:'registration-actions'},el('p',{class:'muted'},`最低 ${e.rules.minPeople} 人，最多 ${e.rules.maxPeople} 人；报名截止：${date(e.rules.registrationDeadline)}`),
    registrationOpen&&((slots.length&&!selectedSlot)||!full||waitOpen||['joined','waitlisted'].includes(joined))?prefForm:el('p',{class:'form-note'},'报名已关闭。'),
    joined&&joined!=='left'?el('div',{class:'inline-actions'},el('span',{class:'form-note'},`我的状态：${statusNames[joined]}`),active&&(beforeStart||joined==='waitlisted')?btn(joined==='waitlisted'?'退出候补':'退出报名',()=>confirmation('退出这场聚会？','席位将按规则释放。','leave'),'button quiet'):null):null,
    el('details',{id:'detail-participants'},el('summary',{},'查看参与名单'),people.length?el('div',{class:'participant-list'},people.map(x=>el('div',{class:'person'},el('strong',{},`${x.nickname||'匿名参与者'}${x.isMe?'（我）':''} · ${statusNames[x.status]||x.status}`),x.registrationMessage?el('p',{class:'registration-message'},x.registrationMessage):null))):el('p',{class:'muted'},'还没有人报名。'))),
    el('div',{class:'preference-summary'},slots.length?summaryChart('可参加时段人数（可多选）',slots.map(slot=>({id:slot.id,label:date(slot.startsAt)+' — '+date(slot.endsAt),count:(prefSummary.slots||[]).find(x=>x.id===slot.id)?.count||0}))):null,summaryChart('交通汇总（可多选）',prefSummary.transport)));

  const canSelectTime=e.isOwner&&e.status==='recruiting'&&!e.selectedSlotId&&Date.now()<e.rules.recruitmentDeadline;
  const timeDetail=el('div',{},el('p',{class:'journey-lead'},`${e.city} · ${slots.length&&!selectedSlot?'等待确认最终时段':date(e.rules.startsAt)+' — '+date(e.rules.endsAt)}`));
  if(slots.length){
    timeDetail.append(el('p',{class:'muted'},selectedSlot?'最终时段已确认。':'发布者须在征集截止前确认一个最终时段；确认后不可修改。'),...slots.map(s=>el('div',{class:'slot-result'},el('span',{},`${date(s.startsAt)} — ${date(s.endsAt)} · ${(prefSummary.slots||[]).find(x=>x.id===s.id)?.count||0} 人可参加`),s.id===e.selectedSlotId?el('strong',{},'已确认'):canSelectTime?btn('确认此时段',()=>confirmation('确认最终时段',`${date(s.startsAt)} — ${date(s.endsAt)}。确认后不可修改。`,'select_time',{slotId:s.id}),'button quiet'):null)));
  }
  const peopleCondition=conditions.find(c=>c.key==='people');
  const venueCondition=conditions.find(c=>c.key==='venue');
  const hostCondition=conditions.find(c=>c.key==='hosts');
  const parallel=el('section',{class:'parallel-lanes','aria-label':'并行参与阶段'},
    el('div',{class:'parallel-lane'},el('span',{class:'lane-label'},'并行 A'),node('报名并提交偏好',`${slots.length&&!selectedSlot?'意向报名 '+((e.counts?.joined||0)+(e.counts?.waitlisted||0))+' 人':(e.counts?.joined||0)+'/'+e.rules.minPeople+' 人'}${joined&&joined!=='left'?' · 我'+statusNames[joined]:''}`,registrationOpen,'参与',joinDetail,e.status==='recruiting'),arrow(),node('确认最终时段',`${slots.length&&!selectedSlot?'等待确认时间':date(e.rules.startsAt)} · ${e.city}`,canSelectTime,canSelectTime?'确认':'查看',timeDetail)),
    el('div',{class:'parallel-lane'},el('span',{class:'lane-label'},'并行 B'),node('提议场地',appsFor(['venue']).filter(a=>a.status==='pending').length+' 个候选场地',active&&beforeStart,'参与',contributions(['venue'],'尚无场地提议。')),arrow(),node('发起人确认场地',venueCondition?.satisfied?'场地已确认':e.rules.venueRequired?'等待确认场地':'场地非必需',e.isOwner&&active&&beforeStart,e.isOwner?'确认':'查看',el('div',{},el('p',{class:'muted'},'发起人确认一个最终场地；其他提议保留备用。'),appsFor(['venue']).map(a=>applicationNode(a,e,true,false))))),
    el('div',{class:'parallel-lane'},el('span',{class:'lane-label'},'并行 C'),node('报名主持人',appsFor(['host']).filter(a=>a.status==='pending').length+' 人待确认',active&&beforeStart,'参与',contributions(['host'],'尚无主持人报名。')),arrow(),node('发起人确认主持人',hostCondition?.satisfied?'主持人已确认':e.rules.minHosts?'等待确认主持人':'主持人非必需',e.isOwner&&active&&beforeStart,e.isOwner?'确认':'查看',el('div',{},el('p',{class:'muted'},'发起人审核报名，已确认人数计入 READY。'),appsFor(['host']).map(a=>applicationNode(a,e,true,false))))));
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
  app.replaceChildren(el('a',{class:'back',href:'#'},'← 所有聚会'),el('header',{class:'detail-header code-header'},el('span',{class:'eyebrow'},'ACTIVITY FLOW'),el('h1',{},e.title),badge(e.status)),flow);
}

function publishPreview(e){const f=el('form',{},el('h2',{},'发布前，最后看一眼'),el('div',{class:'preview'},el('h3',{},e.title),el('p',{},`${e.city} · ${e.rules.timeSlots?.length?'候选时段 '+e.rules.timeSlots.length+' 个':date(e.rules.startsAt)}`),(e.rules.timeSlots||[]).map(s=>el('p',{},`${date(s.startsAt)} — ${date(s.endsAt)}`)),el('p',{class:'prose'},e.description),el('p',{},`成行最低 ${e.rules.minPeople} 人，最多 ${e.rules.maxPeople} 人`),el('p',{},`征集截止：${date(e.rules.recruitmentDeadline)}`),el('p',{},`结束：${date(e.rules.endsAt)} · 报名截止：${date(e.rules.registrationDeadline)} · 递补截止：${date(e.rules.promotionDeadline)}`),el('p',{},`场地${e.rules.venueRequired?'必需':'非必需'} · 现场负责人 ${e.rules.minHosts}`),el('p',{},`${e.rules.waitlist?'允许候补':'不开放候补'} · ${e.rules.allowRoleOverlap?'允许角色兼任':'角色不可兼任'} · 补齐 ${e.rules.repairMinutes} 分钟`),el('p',{},`持续检查：${[['continuousVenue','场地'],['continuousTalks','分享'],['continuousCohosts','协办'],['continuousHosts','现场负责人']].filter(([k])=>e.rules[k]).map(([,v])=>v).join('、')||'无'} · 地址${e.rules.addressVisibility==='public'?'公开':'仅参与者可见'}`)),el('p',{class:'form-note'},'发布后，人数、截止时间与其他成行规则将锁定。活动创建者不会自动报名，也不会自动成为现场负责人。'),el('button',{type:'submit',class:'button orange'},'确认规则并发布'));f.onsubmit=async ev=>{ev.preventDefault();const b=f.querySelector('button[type=submit]');b.disabled=true;try{await command('publish');}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function localParts(ms){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]));return`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
function timeField(label,name,value){const input=el('input',{id:name,name,type:'datetime-local',required:true,value:localParts(value)});const offset=el('select',{name:`${name}Offset`,'aria-label':`${label}重复时间选择`},el('option',{value:'early'},'首次（夏令时优先）'),el('option',{value:'late'},'第二次（冬令时）'));if(amsterdamMs(localParts(value),'late')!==amsterdamMs(localParts(value),'early')&&amsterdamMs(localParts(value),'late')===Math.floor(value/60000)*60000)offset.value='late';const syncOffset=()=>{try{offset.hidden=amsterdamMs(input.value,'early')===amsterdamMs(input.value,'late');}catch{offset.hidden=true;}};input.addEventListener('input',syncOffset);syncOffset();return el('label',{class:'field'},label,el('div',{class:'time-row'},input,offset));}
function amsterdamMs(value,which){const naive=Date.parse(value+'Z');const candidates=[naive-3600000,naive-7200000].filter(t=>localParts(t)===value).sort((a,b)=>a-b);if(!candidates.length)throw new Error('所选荷兰时间不存在（可能处于夏令时切换），请选择其他时间。');return which==='late'?candidates.at(-1):candidates[0];}
function slotEditor(initial){
  const slots=initial.map(s=>({...s}));
  let month=localParts(slots[0]?.startsAt||Date.now()).slice(0,7);
  const calendar=el('div',{class:'slot-calendar'}),rows=el('div',{class:'slot-editor-rows'});
  const start=el('input',{type:'time',value:'14:00','aria-label':'批量开始时间'}),end=el('input',{type:'time',value:'16:00','aria-label':'批量结束时间'});
  const root=el('div',{class:'slot-editor'},el('p',{class:'form-note'},'点击日历多选日期，统一设置时间；下方可逐日修改。全部采用荷兰当地时间。'),el('div',{class:'slot-batch'},el('label',{},'开始 ',start),el('label',{},'结束 ',end),btn('应用到所有日期',()=>{try{for(const slot of slots){const d=localParts(slot.startsAt).slice(0,10);slot.startsAt=amsterdamMs(d+'T'+start.value);slot.endsAt=amsterdamMs(d+'T'+end.value);}render();}catch(e){errorAt(root,e);}},'button quiet')),calendar,rows);
  function render(){
    const monthInput=el('input',{type:'month',value:month,'aria-label':'选择月份',onchange:ev=>{if(ev.target.value){month=ev.target.value;render();}}});
    const [year,m]=month.split('-').map(Number),days=new Date(Date.UTC(year,m,0)).getUTCDate(),offset=(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7;
    const grid=el('div',{class:'slot-calendar-grid'},['一','二','三','四','五','六','日'].map(d=>el('span',{class:'calendar-weekday'},d)));
    for(let i=0;i<offset;i++)grid.append(el('span'));
    for(let day=1;day<=days;day++){const d=month+'-'+String(day).padStart(2,'0');const found=slots.findIndex(s=>localParts(s.startsAt).slice(0,10)===d);const button=btn(String(day),()=>{try{if(found>=0)slots.splice(found,1);else slots.push({id:crypto.randomUUID(),startsAt:amsterdamMs(d+'T'+start.value),endsAt:amsterdamMs(d+'T'+end.value)});render();}catch(e){errorAt(root,e);}},'calendar-day'+(found>=0?' selected':''));button.setAttribute('aria-pressed',String(found>=0));button.setAttribute('aria-label',d);grid.append(button);}
    calendar.replaceChildren(monthInput,grid);
    rows.replaceChildren(...slots.slice().sort((a,b)=>a.startsAt-b.startsAt).map(slot=>{const row=el('div',{class:'slot-editor-row'},timeField('开始','slot-'+slot.id+'-start',slot.startsAt),timeField('结束','slot-'+slot.id+'-end',slot.endsAt),btn('删除日期',()=>{slots.splice(slots.indexOf(slot),1);render();},'button quiet'));row.onchange=()=>{try{const inputs=row.querySelectorAll('input'),offsets=row.querySelectorAll('select');slot.startsAt=amsterdamMs(inputs[0].value,offsets[0].value);slot.endsAt=amsterdamMs(inputs[1].value,offsets[1].value);}catch(e){errorAt(root,e);}};return row;}));
  }
  render();
  return {root,read(){if(!slots.length||slots.length>20)throw new Error('请选择 1–20 个候选日期。');for(const s of slots)if(!(s.startsAt<s.endsAt))throw new Error('每个时段的结束时间须晚于开始时间。');return slots.slice().sort((a,b)=>a.startsAt-b.startsAt).map(s=>({...s}));}};
}
function renderEventForm(existing){state.detailVisible=false;state.pendingEvent=null;if(!requireUser())return;const day=86400000, start=Date.now()+14*day;const defaults={minPeople:10,maxPeople:12,waitlist:true,recruitmentDeadline:start-2*day,startsAt:start,endsAt:start+2*3600000,registrationDeadline:start-3600000,promotionDeadline:start-3600000,repairMinutes:60,venueRequired:true,minTalks:0,minCohosts:0,minHosts:1,allowRoleOverlap:true,continuousVenue:true,continuousTalks:false,continuousCohosts:false,continuousHosts:true,addressVisibility:'participants'};const r=existing?.rules||defaults;const editor=slotEditor(r.timeSlots||[{id:crypto.randomUUID(),startsAt:r.startsAt,endsAt:r.endsAt}]);const f=el('form',{class:'wide-form'},el('a',{class:'back',href:existing?`#event/${existing.id}`:'#',onclick:existing?e=>{e.preventDefault();renderDetail(existing);}:undefined},'← 返回'),el('span',{class:'eyebrow'},'MAKE ROOM FOR A GOOD CONVERSATION'),el('h1',{},existing?'编辑聚会草稿':'从一个想聊的话题开始'),el('p',{class:'muted'},'先保存为草稿，再预览发布。把成行规则讲清楚，让每个人都知道自己的承诺。'));f.append(el('div',{class:'panel'},field('聚会标题','title','text',existing?.title||''),field('城市','city','text',existing?.city||'Amsterdam'),field('聚会介绍：聊什么，适合谁，如何安排','description','textarea',existing?.description||'')));const advancedTimes=el('details',{class:'advanced-times'},el('summary',{},'高级设置：报名与递补截止'),el('p',{class:'muted'},'成行后仍可报名；有人退出时，可在递补截止前自动邀请候补。'),el('div',{class:'form-grid'},timeField('停止接受报名','registrationDeadline',r.registrationDeadline),timeField('停止自动递补','promotionDeadline',r.promotionDeadline)));
const times=el('fieldset',{},el('legend',{},'01 / 相聚时间'),el('p',{class:'muted'},'以下均为荷兰当地时间。'),el('h3',{},'1. 选择候选日期和时段'),editor.root,el('h3',{},'2. 最晚何时决定活动能否成行'),timeField('成行决定期限','recruitmentDeadline',r.recruitmentDeadline),el('p',{class:'muted'},'请在此之前确认最终时段。到期时，系统按人数、场地等条件决定是否成行。'),el('p',{class:'muted'},'报名截止：'+date(r.registrationDeadline)+'；递补截止：'+date(r.promotionDeadline)+'。可在高级设置中调整。'),advancedTimes);const rules=el('fieldset',{},el('legend',{},'02 / 固定成行条件'),el('p',{class:'muted'},'这些规则在发布后锁定。主持人需本人报名并由发起人确认。'),el('div',{class:'form-grid'},field('最低成行人数','minPeople','number',r.minPeople),field('最大人数','maxPeople','number',r.maxPeople),field('最少现场负责人数','minHosts','number',r.minHosts),field('条件补齐窗口（分钟）','repairMinutes','number',r.repairMinutes)),check('满员后允许候补','waitlist',r.waitlist),check('成行需要已确认场地，容量覆盖人数上限','venueRequired',r.venueRequired),);const continuous=el('fieldset',{},el('legend',{},'03 / 成行后持续检查'),check('场地持续满足','continuousVenue',r.continuousVenue),check('现场负责人持续满足','continuousHosts',r.continuousHosts),el('label',{class:'field'},'场地地址可见范围',el('select',{name:'addressVisibility'},el('option',{value:'participants',selected:r.addressVisibility==='participants'},'有权限的活动参与者'),el('option',{value:'public',selected:r.addressVisibility==='public'},'所有人'))));const save=el('button',{class:'button dark',type:'submit'},existing?'保存草稿':'保存草稿，进入预览 →');f.append(times,rules,continuous,save);f.addEventListener('invalid',ev=>{const details=ev.target.closest('details');if(details)details.open=true;},true);f.querySelectorAll('input[type=number]').forEach(n=>{n.min=['minTalks','minCohosts','minHosts'].includes(n.name)?'0':'1';n.step='1';});f.onsubmit=async ev=>{ev.preventDefault();save.disabled=true;try{const fd=new FormData(f);const rr={};for(const [k,v] of Object.entries(r)){if(['timeSlots','startsAt','endsAt'].includes(k))continue;if(typeof v==='boolean')rr[k]=fd.has(k);else if(['startsAt','endsAt','recruitmentDeadline','registrationDeadline','promotionDeadline'].includes(k))rr[k]=amsterdamMs(fd.get(k),fd.get(k+'Offset'));else if(typeof v==='number')rr[k]=Number(fd.get(k));else rr[k]=fd.get(k);}rr.minTalks=0;rr.minCohosts=0;rr.continuousTalks=false;rr.continuousCohosts=false;rr.allowRoleOverlap=true;rr.timeSlots=editor.read();rr.startsAt=rr.timeSlots[0].startsAt;rr.endsAt=rr.timeSlots[0].endsAt;if(!(rr.recruitmentDeadline<rr.startsAt&&rr.startsAt<rr.endsAt))throw new Error('请确保征集截止早于开始时间，结束时间晚于开始时间。');if(['registrationDeadline','promotionDeadline'].some(k=>rr[k]<rr.recruitmentDeadline||rr[k]>=rr.startsAt))throw new Error('报名和递补截止须不早于征集截止，且早于最早候选时段。');if(rr.minPeople>rr.maxPeople)throw new Error('最低人数不能超过人数上限。');const data={title:fd.get('title').trim(),city:fd.get('city').trim(),description:fd.get('description').trim(),rules:rr};if(existing){await command('edit',data);}else{const response=await api('/api/events',data);location.hash=`event/${response.event.id}`;toast('草稿已保存，请预览并确认发布。');}}catch(err){errorAt(f,err);}finally{save.disabled=false;}};app.replaceChildren(f);window.scrollTo({top:0});}
function closeAI(){state.aiGeneration++;state.aiReviewPending=false;$('#ai-panel').hidden=true;state.proposal=null;$('#ai-messages').replaceChildren();$('#ai-input').value='';}
function openAI(){if(!requireUser())return;$('#ai-panel').hidden=false;$('#ai-input').focus();}
$('#ai-close').onclick=()=>{closeAI();applyPendingEvent();};
$('#ai-form').onsubmit=async e=>{e.preventDefault();if(!state.event)return;const id=state.event.id;const generation=state.aiGeneration;const input=$('#ai-input');const message=input.value.trim();if(!message)return;const root=$('#ai-messages');root.append(el('div',{class:'ai-message user'},message));input.value='';const submit=$('#ai-form button');submit.disabled=true;try{const result=await api('/api/ai',{eventId:id,message});if(state.event?.id!==id||generation!==state.aiGeneration||$('#ai-panel').hidden)return;root.append(el('div',{class:'ai-message'},result.reply));root.querySelectorAll('.ai-proposal').forEach(x=>x.remove());state.proposal=null;if(result.proposal){const p=result.proposal;p.eventVersion=state.event.version;state.proposal=p;state.aiReviewPending=false;const card=el('div',{class:'ai-proposal'},el('strong',{},'等待你的确认'),el('p',{},`活动：${p.eventTitle}`),el('p',{},`操作：${actions[p.action?.action||p.action]||p.action?.action||'活动操作'}`),el('pre',{class:'prose'},typeof p.action==='object'?JSON.stringify(p.action,null,2):''),el('p',{class:'muted'},`有效至 ${date(p.expiresAt)}`));card.append(btn('确认执行',async ev=>{ev.currentTarget.disabled=true;try{if(state.proposal?.id!==p.id||state.event?.id!==id)throw new Error('活动或确认卡已变化，请重新向助手提出请求。');if(Date.now()>=p.expiresAt)throw new Error('确认卡已过期，请重新生成。');await api('/api/ai/confirm',{proposalId:p.id});state.proposal=null;card.replaceChildren(el('strong',{},'✓ 操作已完成'));await loadEvent(id);toast('助手操作已执行');}catch(err){errorAt(card,err);}finally{if(ev.target.isConnected)ev.target.disabled=false;}},'button dark'),btn('不执行',()=>{state.proposal=null;card.remove();applyPendingEvent();},'button quiet'));root.append(card);}root.scrollTop=root.scrollHeight;}catch(err){if(state.event?.id===id&&generation===state.aiGeneration)errorAt(root,err);}finally{submit.disabled=false;}};
async function loadEvent(id){const token=++state.loading;try{const r=await api(`/api/events/${encodeURIComponent(id)}`);if(token!==state.loading)return;const e=r.event;for(const k of ['canManage','isOwner','myParticipation','myApplications','conditions','counts','participants','applications','receipts','preferenceSummary'])if(r[k]!==undefined)e[k]=r[k];if(state.event?.id===e.id&&state.event.version!==e.version)invalidateAIProposal();state.event=e;renderDetail(e);}catch(err){if(token!==state.loading)return;app.replaceChildren(el('a',{class:'back',href:'#'},'← 返回聚会列表'));errorAt(app,err);app.append(btn('重试',()=>loadEvent(id)));}}
async function route(){state.detailVisible=false;state.pendingEvent=null;const path=location.hash.slice(1);const previous=state.event?.id;const id=path.startsWith('event/')?path.slice(6):null;if(id!==previous)closeAI();if(path==='new'){state.loading++;state.event=null;renderEventForm();return;}app.replaceChildren(el('div',{class:'loading',role:'status'},'正在准备这张咖啡桌…'));if(id)return loadEvent(id);state.event=null;const token=++state.loading;try{const r=await api('/api/events');if(token!==state.loading)return;state.events=r.events||[];if(r.user!==undefined){state.user=r.user?{...state.user,...r.user}:null;updateAccount();}renderHome();}catch(err){if(token!==state.loading)return;app.replaceChildren(hero());errorAt(app,err);app.append(btn('重新加载活动',route));}}

function eventTimePhase(e){const now=Date.now();return [e.rules.recruitmentDeadline,e.rules.registrationDeadline,e.rules.promotionDeadline,e.rules.startsAt,e.rules.endsAt].map(t=>now>=t?'1':'0').join('');}
function invalidateAIProposal(){
  if(!state.proposal)return;
  state.proposal=null;state.aiReviewPending=true;
  const card=$('#ai-messages .ai-proposal');
  if(card)card.replaceChildren(el('strong',{},'活动已更新，需要重新确认'),el('p',{},'这张确认卡已失效，尚未执行任何操作。请刷新活动后，再向助手提出请求。'),btn('查看最新活动',()=>{state.aiReviewPending=false;card.remove();applyPendingEvent();},'button dark'));
}
function detailCanRefresh(){
  return state.detailVisible&&!document.hidden&&!$('#modal').open&&!state.proposal&&!state.aiReviewPending&&!$('#ai-form button').disabled&&!document.activeElement?.matches('input,textarea,select')&&!$('#app form');
}
function applyPendingEvent(){
  if(!state.pendingEvent||!detailCanRefresh())return;
  const next=state.pendingEvent;
  if(state.event?.id!==next.id||location.hash!=='#event/'+next.id){state.pendingEvent=null;return;}
  if(next.version<state.event.version){state.pendingEvent=null;return;}
  const openDetails=[...document.querySelectorAll('#app details[id][open]')].map(n=>n.id);
  const pinnedNodes=[...document.querySelectorAll('#app .code-node.pinned[data-flow-key]')].map(n=>n.dataset.flowKey);
  state.event=next;renderDetail(next);
  for(const id of openDetails){const detail=document.getElementById(id);if(detail)detail.open=true;}
  for(const key of pinnedNodes){const node=[...document.querySelectorAll('#app .code-node[data-flow-key]')].find(n=>n.dataset.flowKey===key);if(node){node.classList.add('pinned');node.querySelector('.flow-trigger')?.setAttribute('aria-expanded','true');}}
  toast('活动状态已更新');
}
async function pollDetail(){
  if(document.hidden||state.polling||!state.detailVisible||!state.event||location.hash!=='#event/'+state.event.id)return;
  applyPendingEvent();
  const id=state.event.id,token=state.loading;
  state.polling=true;
  try{
    const result=await api('/api/events/'+encodeURIComponent(id));
    if(token!==state.loading||!state.detailVisible||state.event?.id!==id||location.hash!=='#event/'+id)return;
    const next=result.event;
    for(const k of ['canManage','isOwner','myParticipation','myApplications','conditions','counts','participants','applications','receipts','preferenceSummary'])if(result[k]!==undefined)next[k]=result[k];
    if(next.version!==state.event.version||eventTimePhase(next)!==state.renderedPhase){state.pendingEvent=next;if(next.version!==state.event.version)invalidateAIProposal();applyPendingEvent();}
    $('#refresh-error')?.remove();
  }catch(error){
    if(state.event?.id===id&&state.detailVisible&&!$('#refresh-error')){
      const notice=el('div',{id:'refresh-error',class:'error-box',role:'status'},'自动更新暂时失败，当前显示的是上次读取的状态。'+error.message,btn('重试',pollDetail,'button quiet'));
      $('.detail-header')?.append(notice);
    }
  }finally{state.polling=false;}
}
setInterval(pollDetail,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollDetail();});
$('#modal').addEventListener('close',applyPendingEvent);
document.addEventListener('focusout',()=>setTimeout(applyPendingEvent,0));

window.addEventListener('hashchange',()=>{route();window.scrollTo({top:0});});
(async()=>{try{const r=await api('/api/me');state.user=r.user;updateAccount();}catch(e){toast(e.message);}await route();})();
