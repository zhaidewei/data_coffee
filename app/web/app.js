import {dagStatuses,dagStatusLabels} from './dag-status.js';
import {attachTimeValidation} from './time-validation.js';
import {renderCliDocs} from './cli-docs.js';
import {mountMap} from './map.js';
import {monthRange,eventSlots,filterEvents} from './overview.js';
const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const state = {user:null, events:[], event:null, city:'全部',period:'all',from:monthRange('current').from,to:monthRange('current').to, loading:0, proposal:null, aiGeneration:0, detailVisible:false, pendingEvent:null, polling:false, aiReviewPending:false};
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
function updateAccount(){$('#account-button .account-label').textContent=state.user?'账户':'登录';$('#account-button').title=state.user?state.user.nickname:'登录 / 注册';}
function modal(content){$('#modal-content').replaceChildren(content);$('#modal').showModal();}
function closeModal(){$('#modal').close();}
$('.modal-close').onclick=closeModal;
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
function field(label,name,type='text',value='',required=true){const input=el(type==='textarea'?'textarea':'input',{name,id:name,type:type==='textarea'?undefined:type,value,required,rows:type==='textarea'?4:undefined});return el('label',{class:'field',htmlFor:name},label,input);}
function check(label,name,value=false){return el('label',{class:'check'},el('input',{type:'checkbox',name,checked:value}),label);}
async function login(){const form=el('form',{},el('span',{class:'eyebrow'},'WELCOME TO THE TABLE'),el('h2',{},'登录 Data Coffee'),el('p',{class:'muted'},'使用邮箱验证码登录。首次登录验证成功后，再设置昵称。'),field('邮箱','email','email'));const code=field('验证码','code','text');code.hidden=true;code.querySelector('input').required=false;const submit=el('button',{class:'button dark',type:'submit'},'发送验证码');form.append(code,submit);let sent=false;form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const v=Object.fromEntries(new FormData(form));if(!sent){const r=await api('/api/auth/request',{email:v.email});sent=true;code.hidden=false;code.querySelector('input').required=true;form.elements.email.readOnly=true;submit.textContent='验证并登录';if(r.developmentCode)form.append(el('p',{class:'form-note'},`开发环境验证码：${r.developmentCode}`));else toast('验证码已发送，请检查邮箱。');code.querySelector('input').focus();}else{const r=await api('/api/auth/verify',v);state.user=r.user;updateAccount();closeModal();await route();if(!state.user.nickname)setupNickname();else toast('登录成功，欢迎回来。');}}catch(err){errorAt(form,err);}finally{submit.disabled=false;}};modal(form);}
function requireUser(){if(state.user)return true;login();return false;}
function setupNickname(){
 const f=el('form',{},el('h2',{},'邮箱已验证，留个名字吧'),el('p',{class:'muted'},'这个名字用于社区交流，之后可以在账户 → 个人资料修改。'),field('昵称','nickname','text',''),el('button',{class:'button dark',type:'submit'},'保存昵称'));
 f.onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/me',{nickname:f.elements.nickname.value},'PATCH');state.user=r.user;updateAccount();closeModal();await route();}catch(err){errorAt(f,err);}};modal(f);
}
async function tokenSettings(){
 const root=el('div',{},el('h2',{},'个人 API Tokens'),el('p',{class:'muted'},'供 dc-flow 和 Agent 使用。Token 继承你的活动权限，可随时撤销。'));
 modal(root);
 async function refresh(){try{const data=await api('/api/tokens');list.replaceChildren(...data.tokens.filter(t=>!t.revokedAt).map(t=>el('div',{class:'token-row'},el('div',{},el('strong',{},t.name),el('small',{},(t.scope==='read'?'只读':'读写')+' · 到期 '+date(t.expiresAt))),btn('撤销',async()=>{try{await api('/api/tokens/'+t.id,undefined,'DELETE');await refresh();}catch(e){errorAt(root,e);}},'button danger'))));if(!data.tokens.some(t=>!t.revokedAt))list.append(el('p',{class:'muted'},'暂无 Token'));}catch(e){errorAt(root,e);}}
 const list=el('div',{class:'token-list'}),form=el('form',{},field('名称','name','text','dc-flow'),el('label',{class:'field'},'权限',el('select',{name:'scope'},el('option',{value:'read'},'只读 · 查询活动'),el('option',{value:'write'},'读写 · 报名和管理本人活动'))),field('有效天数（1–365）','expiresDays','number',30),el('button',{type:'submit',class:'button dark'},'创建 Token'));
 form.elements.expiresDays.min=1;form.elements.expiresDays.max=365;form.elements.expiresDays.step=1;
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const d=await api('/api/tokens',{name:form.elements.name.value,scope:form.elements.scope.value,expiresDays:Number(form.elements.expiresDays.value)});const secret=el('textarea',{readOnly:true,rows:3,value:d.token,'aria-label':'新建 API Token'});const box=el('div',{class:'form-note'},el('strong',{},'只显示这一次，请存入本地 secret。'),secret,btn('复制 Token',async()=>{try{await navigator.clipboard.writeText(d.token);toast('已复制');}catch{secret.select();}},'button'),el('p',{},'终端运行 secret add data-coffee-api-token，按提示粘贴。'),btn('已保存，隐藏 Token',()=>box.remove()));root.querySelector('.token-secret')?.remove();box.classList.add('token-secret');root.insertBefore(box,list);await refresh();}catch(err){errorAt(root,err);}finally{button.disabled=false;}};
 root.append(form,list);await refresh();
}
function account(){if(!state.user)return login();const f=el('form',{},el('h2',{},'我的社区名片'),el('p',{class:'muted'},state.user.email),field('昵称','nickname','text',state.user.nickname),check('公开显示我的昵称（关闭后，活动管理者仍可查看）','publicNickname',state.user.publicNickname),el('button',{class:'button dark',type:'submit'},'保存设置'),btn('退出登录',async()=>{try{await api('/api/auth/logout',{});state.user=null;updateAccount();closeModal();route();}catch(e){errorAt(f,e);}},'button quiet'));f.onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/me',{nickname:f.elements.nickname.value,publicNickname:f.elements.publicNickname.checked},'PATCH');state.user=r.user;updateAccount();closeModal();toast('设置已保存');route();}catch(err){errorAt(f,err);}};modal(f);}
$('#account-button').onclick=()=>{
  const old=$('#account-menu');if(old){old.remove();return;}
  const close=()=>{$('#account-menu')?.remove();$('#account-button').setAttribute('aria-expanded','false');};
  const themeChoices=el('div',{class:'appearance-options'},...['light','dark','system'].map((value,i)=>{const b=btn(['☀ 浅色模式','☾ 深色模式','▣ 跟随系统'][i],()=>{window.coffeeTheme.set(value);themeChoices.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));},'account-menu-item');b.setAttribute('aria-pressed',String(window.coffeeTheme.get()===value));return b;}));
  const menu=el('aside',{id:'account-menu',class:'account-menu','aria-label':'账户菜单'},el('div',{class:'account-menu-heading'},el('small',{},state.user?'Signed in as':'Data Coffee'),el('strong',{},state.user?.nickname||'尚未登录')),btn(state.user?'♙ 个人资料':'♙ 登录 / 注册',()=>{close();account();},'account-menu-item'),el('details',{},el('summary',{},'☼ 外观'),themeChoices));
  if(state.user)menu.append(btn('⚿ API Tokens',()=>{close();tokenSettings();},'account-menu-item'));
  if(state.user)menu.append(btn('↪ 退出登录',async()=>{try{await api('/api/auth/logout',{});state.user=null;updateAccount();close();route();}catch(e){errorAt(menu,e);}},'account-menu-item'));
  document.body.append(menu);$('#account-button').setAttribute('aria-expanded','true');
};
document.addEventListener('click',e=>{if(!e.target.closest('#account-menu, #account-button')){$('#account-menu')?.remove();$('#account-button').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#account-menu')){$('#account-menu').remove();$('#account-button').setAttribute('aria-expanded','false');$('#account-button').focus();}});
$('#create-button').onclick=()=>{if(requireUser())location.hash='new';};
function hero(){return el('section',{class:'hero'},el('div',{},el('span',{class:'eyebrow'},'GOOD COFFEE. REAL CONNECTIONS.'),el('h1',{},'数据之外，',el('br'),'还有一杯 ',el('em',{},'Coffee.')),el('p',{},'把屏幕里的同行，变成咖啡桌旁的朋友。\n在荷兰，和做数据、做 AI 的人聊一个真实问题。'),el('div',{class:'hero-actions'},el('a',{href:'#gatherings',class:'button dark',onclick:e=>{e.preventDefault();$('#gatherings')?.scrollIntoView({behavior:'smooth'});}},'找到下一场聚会 ↗'),el('span',{class:'muted'},'小规模 · 有话聊 · 一起办'))),el('div',{class:'hero-art','aria-label':'Data Coffee 咖啡杯插画',role:'img'},el('span',{class:'steam','aria-hidden':'true'},'∿ ∿'),el('span',{class:'orbit','aria-hidden':'true'},'✳'),el('div',{class:'cup','aria-hidden':'true'},'dc.'),el('span',{class:'art-note'},'BREW IDEAS, TOGETHER.')));}
function overviewRange(){return state.period==='all'?null:state.period==='custom'?{from:state.from,to:state.to}:monthRange(state.period);}
function overviewCalendar(slots){
 const dates=[...new Set(slots.map(s=>localParts(s.startsAt).slice(0,10)))].sort();
 const months=[...new Set(dates.map(d=>d.slice(0,7)))];
 return el('div',{class:'overview-calendars'},months.map(month=>{
 const [year,m]=month.split('-').map(Number),offset=(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7,days=new Date(Date.UTC(year,m,0)).getUTCDate();
 const grid=el('div',{class:'mini-calendar-grid','aria-hidden':'true'},['一','二','三','四','五','六','日'].map(d=>el('span',{class:'mini-weekday'},d)));
 for(let i=0;i<offset;i++)grid.append(el('span'));
 for(let day=1;day<=days;day++){const key=month+'-'+String(day).padStart(2,'0');grid.append(el('span',{class:dates.includes(key)?'mini-day available':'mini-day'},day));}
 return el('div',{class:'mini-calendar',role:'img','aria-label':year+'年'+m+'月，活动日期：'+dates.filter(d=>d.startsWith(month)).map(d=>Number(d.slice(-2))+'日').join('、')},el('strong',{},year+' / '+String(m).padStart(2,'0')),grid);
 }));
}
function overviewCard(e){const slots=eventSlots(e);return el('a',{class:'overview-event',href:`#event/${e.id}`},el('div',{class:'overview-event-heading'},el('h3',{},e.title),badge(e.status)),el('p',{class:'overview-event-meta'},e.city+' · '+(e.selectedSlotId?'最终时段':slots.length>1?slots.length+' 个候选时段':'活动时间')),overviewCalendar(slots),el('p',{class:'overview-description'},e.description),el('div',{class:'overview-event-bottom'},el('span',{},`${e.counts?.joined||0} 人报名 · ${e.rules.minPeople} 人起成行`),el('span',{},'查看活动流程 →')));}
function overviewMap(events){const wrapper=el('div',{class:'overview-map-real'});requestAnimationFrame(()=>{if(wrapper.isConnected)mountMap(wrapper,events,state.city,city=>{state.city=city;renderHome();});});return wrapper;}
function renderHome(){state.detailVisible=false;state.pendingEvent=null;const range=overviewRange(),invalid=range&&(!range.from||!range.to||range.from>range.to),timeEvents=invalid?[]:filterEvents(state.events,'全部',range),filtered=invalid?[]:filterEvents(state.events,state.city,range);const heading=el('header',{class:'overview-heading'},el('div',{},el('span',{class:'eyebrow'},'DATA COFFEE / 活动总览'),el('h1',{class:'coffee-dags-title'},el('s',{class:'airflow-joke'},'Airflow'),' Data Coffee DAGs'),el('p',{class:'muted'},'把相聚调度起来 · 按城市和时间找到你的下一杯咖啡。')),el('span',{class:'overview-total'},filtered.length+' 场活动'));
const periods=el('div',{class:'overview-periods','aria-label':'按时间筛选'},[['all','全部时间'],['current','本月'],['next','下月'],['custom','自选日期']].map(([key,label])=>btn(label,()=>{state.period=key;renderHome();},'filter'+(state.period===key?' active':''))));periods.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(['all','current','next','custom'][i]===state.period)));
const controls=el('section',{class:'overview-controls'},periods);if(state.period==='custom'){const from=el('input',{type:'date',value:state.from,'aria-label':'开始日期'}),to=el('input',{type:'date',value:state.to,'aria-label':'结束日期'});from.onchange=()=>{state.from=from.value;renderHome();};to.onchange=()=>{state.to=to.value;renderHome();};controls.append(el('div',{class:'overview-dates'},el('label',{},'从 ',from),el('label',{},'至 ',to)),invalid?el('p',{class:'error-box',role:'alert'},'请选择完整日期范围，结束日期须不早于开始日期。'):document.createDocumentFragment());}
const cities=['全部',...new Set(timeEvents.map(e=>e.city).filter(Boolean))];const cityButtons=el('div',{class:'overview-cities','aria-label':'按城市筛选'},cities.map(city=>{const count=city==='全部'?timeEvents.length:timeEvents.filter(e=>e.city===city).length;return el('button',{type:'button',class:'overview-city'+(state.city===city?' active':''),'aria-pressed':String(state.city===city),onclick:()=>{state.city=city;renderHome();}},el('span',{},city),el('span',{class:'city-count'},count));}));
const geography=el('section',{class:'overview-geography'},el('h2',{},'城市分布'),overviewMap(timeEvents),cityButtons);const results=el('section',{class:'overview-results','aria-label':'筛选结果','aria-live':'polite'},el('div',{class:'overview-results-heading'},el('h2',{},state.city==='全部'?'所有城市':state.city),el('span',{class:'muted'},filtered.length+' 场')),filtered.length?filtered.map(overviewCard):el('div',{class:'empty'},el('h3',{},invalid?'先选好日期':'No coffee runs found.'),el('p',{},invalid?'补全日期后即可查看结果。':'这个范围还没有咖啡被调度。试试其他城市或时间，或发起一场。'),btn('重置筛选',()=>{state.city='全部';state.period='all';renderHome();})));
app.replaceChildren(el('div',{id:'gatherings',class:'overview'},heading,controls,el('div',{class:'overview-layout'},geography,results)));}

async function command(action,extra={}){if(!requireUser())return;const id=state.event.id;const r=await api(`/api/events/${id}/actions`,{action,version:state.event.version,...extra});closeModal();toast('操作已保存');if(state.event?.id===id)await loadEvent(id);return r;}
function run(action,extra={},node){return command(action,extra).catch(e=>node?errorAt(node,e):toast(e.message));}
function confirmation(title,message,action,extra={},reason=false){const f=el('form',{},el('h2',{},title),el('p',{},message));if(reason)f.append(field('原因（将记入活动记录）','reason','textarea'));const b=el('button',{type:'submit',class:'button dark'},'确认');f.append(b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await command(action,{...extra,...(reason?{reason:f.elements.reason.value}:{})});}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function conditionNode(c){return el('div',{class:`condition ${c.satisfied?'ok':''}`},el('div',{class:'condition-top'},el('span',{},c.label),el('span',{},c.satisfied?'✓ 已满足':'待补齐')),el('strong',{},`${c.current} / ${c.required}`),el('div',{class:'progress-track'},el('span',{style:`width:${c.required?Math.min(100,c.current/c.required*100):100}%`})),el('span',{class:'muted'},c.continuous?'成行后仍需持续满足':'成行时检查'));}
function applyForm(kind){if(!requireUser())return;const f=el('form',{},el('h2',{},`申请${kinds[kind]}`),field('标题','title','text'),field('具体说明','detail','textarea'));if(kind==='venue')f.append(field('可容纳人数','capacity','number'),field('详细地址','address','text'),el('p',{class:'muted'},state.event.rules.addressVisibility==='participants'?'地址仅按活动规则向参与者展示。':'此活动将公开场地地址。'));if(kind==='talk')f.append(field('预计时长（分钟）','duration','number',20));if(kind==='pledge')f.append(field('赞助金额（欧元）','amount','number'));const b=el('button',{class:'button dark',type:'submit'},'提交申请');f.append(el('p',{class:'form-note'},'申请通过后才计入条件。申请只代表你本人，可以在活动中查看处理结果或撤回。'),b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;const v=Object.fromEntries(new FormData(f));for(const k of ['capacity','amount','duration'])if(k in v)v[k]=Number(v[k]);try{await command('apply',{kind,...v});}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function applicationNode(a,e,reviewControls=true,ownControls=true){const own=(e.myApplications||[]).some(x=>x.id===a.id);const mutable=!['cancelled','completed'].includes(e.status)&&Date.now()<e.rules.startsAt;const canReview=reviewControls&&mutable&&(['cohost','venue','host'].includes(a.kind)?e.isOwner:e.canManage);return el('div',{class:'application'},el('h3',{},`${kinds[a.kind]||a.kind} · ${a.title} `,badge(a.status)),el('p',{},a.detail),a.capacity?el('p',{},`容量：${a.capacity} 人`):null,a.address?el('p',{},`地址：${a.address}`):null,a.duration?el('p',{},`分享时长：${a.duration} 分钟`):null,a.amount?el('p',{},`赞助：€${a.amount}`):null,a.reason?el('p',{},`处理说明：${a.reason}`):null,el('div',{class:'inline-actions'},ownControls&&mutable&&own&&['pending','approved'].includes(a.status)?btn('撤回 / 退出',()=>confirmation('撤回这项申请？','撤回已通过的申请可能影响成行条件。','withdraw',{applicationId:a.id}),'button quiet'):null,canReview&&a.status==='pending'?btn('通过',()=>confirmation('通过申请？',`批准「${a.title}」，系统将重新检查成行条件。`,'review',{applicationId:a.id,approved:true})):null,canReview&&a.status==='pending'?btn('拒绝',()=>confirmation('拒绝申请','请向申请人说明原因。','review',{applicationId:a.id,approved:false},true),'button quiet'):null,mutable&&e.isOwner&&a.kind==='cohost'&&a.status==='approved'?btn('撤销协办资格',()=>confirmation('撤销批准','撤销后系统将重新检查活动条件。','revoke',{applicationId:a.id},true),'button danger'):null));}
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
  if(slots.length)prefForm.append(registrationCalendar(slots,p?.availableSlotIds||[],e.selectedSlotId));
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
  const canvas=el('div',{class:'dag-canvas'}),panel=el('aside',{class:'dag-panel','aria-label':'节点详情'});
  const positions=[[50,20],[16.7,180],[16.7,350],[50,180],[50,350],[83.3,180],[83.3,350],[50,520]];
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 1000 630');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('class','dag-links');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','M500 116 V146 H167 V180 M500 146 V180 M500 146 H833 V180 M167 276 V350 M500 276 V350 M833 276 V350 M167 446 V483 H500 V520 M500 446 V520 M833 446 V483 H500');svg.append(path);canvas.append(svg);
  const nodes=[...flow.querySelectorAll('.code-node')];
  const nodeStates=dagStatuses({...e,conditions,applications});
  const taskLabels=['create_coffee','join','confirm_time','propose_venue','confirm_venue','apply_host','confirm_host','ready'];
  nodes.forEach((box,i)=>{const button=el('button',{class:'dag-node state-'+nodeStates[i]+' '+(box.classList.contains('editable')?'dag-open':'dag-locked'),type:'button','aria-pressed':'false'},el('code',{class:'dag-task-id'},taskLabels[i]),el('strong',{},box.dataset.flowKey),el('small',{},dagStatusLabels[nodeStates[i]]+' · '+box.querySelector('.node-status').textContent.replace('状态：','')));button.setAttribute('aria-label',box.dataset.flowKey+' · '+dagStatusLabels[nodeStates[i]]);button.title=dagStatusLabels[nodeStates[i]];button.style.left=positions[i][0]+'%';button.style.top=positions[i][1]+'px';button.style.setProperty('--node-y',positions[i][1]);canvas.append(button);box._dagButton=button;});
  // Keep each form alive when switching nodes; never duplicate API action controls.
  const details=new Map(nodes.map(box=>[box,box.querySelector('.code-node-detail')]));
  const draft=e.status==='draft'&&e.isOwner;
  const editStage=i=>{renderEventForm(e);const targets=['[name=title]','.slot-editor','.slot-editor','[name=venueRequired]','[name=venueRequired]','[name=minHosts]','[name=minHosts]','[name=repairMinutes]'];const target=app.querySelector(targets[i]);target?.closest('fieldset, .panel')?.scrollIntoView({block:'start'});(target?.type==='radio'?target.closest('label'):target)?.focus({preventScroll:true});};
  if(draft)nodes.forEach((box,i)=>{box._dagButton.querySelector('small').textContent='草稿 · 点击编辑设置';details.set(box,el('div',{class:'code-node-detail'},el('p',{},'活动尚未发布。现在可以编辑这一阶段的设置，发布后才开放报名与提议。'),btn('编辑此阶段',()=>editStage(i),'button dark')));});
  nodes.forEach(box=>{box._dagButton.onclick=()=>{panel.querySelector('.code-node-detail')?.remove();canvas.querySelectorAll('.dag-node').forEach(n=>n.setAttribute('aria-pressed',String(n===box._dagButton)));state.dagSelection={eventId:e.id,stage:box.dataset.flowKey};panel.replaceChildren(el('small',{},'节点详情'),el('h2',{},box.dataset.flowKey),el('p',{class:'muted'},draft?'草稿 · 尚未开放参与':box.querySelector('.node-status').textContent),details.get(box));};});
  const selected=nodes.find(box=>state.dagSelection?.eventId===e.id&&box.dataset.flowKey===state.dagSelection.stage)||nodes[1]||nodes[0];selected._dagButton.click();
  app.replaceChildren(el('a',{class:'back',href:'#'},'← 所有聚会'),el('header',{class:'detail-header code-header'},el('span',{class:'eyebrow'},'COFFEE DAG / GRAPH'),el('h1',{},e.title),badge(e.status)),draft?el('div',{class:'draft-toolbar'},el('span',{},'草稿预览 · 仅你可见'),btn('返回编辑',()=>renderEventForm(e)),btn('发布活动',()=>publishPreview(e),'button dark'),btn('删除草稿',()=>deleteDraftDialog(e),'button danger')):document.createDocumentFragment(),el('div',{class:'dag-workspace'},el('section',{class:'dag-graph'},el('div',{class:'dag-toolbar'},'Graph · 每个节点，都是相聚的一步 · 点击查看或参与'),canvas,el('p',{class:'muted'},'报名 / 提议 → 发起人确认 → READY · 截止后按规则成行或取消')),panel));
}

function deleteDraftDialog(e){
 const content=el('div',{},el('h2',{},'删除草稿？'),el('p',{},'将删除「'+e.title+'」。删除后无法在页面恢复。'),btn('保留草稿',closeModal),btn('确认删除',async()=>{try{await api('/api/events/'+e.id,{version:e.version},'DELETE');closeModal();state.event=null;location.hash='';toast('草稿已删除');}catch(err){errorAt(content,err);}},'button danger'));modal(content);
}
function publishPreview(e){const f=el('form',{},el('h2',{},'发布前，最后看一眼'),el('div',{class:'preview'},el('h3',{},e.title),el('p',{},`${e.city} · ${e.rules.timeSlots?.length?'候选时段 '+e.rules.timeSlots.length+' 个':date(e.rules.startsAt)}`),(e.rules.timeSlots||[]).map(s=>el('p',{},`${date(s.startsAt)} — ${date(s.endsAt)}`)),el('p',{class:'prose'},e.description),el('p',{},`成行最低 ${e.rules.minPeople} 人，最多 ${e.rules.maxPeople} 人`),el('p',{},`征集截止：${date(e.rules.recruitmentDeadline)}`),el('p',{},`结束：${date(e.rules.endsAt)} · 报名截止：${date(e.rules.registrationDeadline)} · 递补截止：${date(e.rules.promotionDeadline)}`),el('p',{},`场地${e.rules.venueRequired?'必需':'非必需'} · 现场负责人 ${e.rules.minHosts}`),el('p',{},`${e.rules.waitlist?'允许候补':'不开放候补'} · ${e.rules.allowRoleOverlap?'允许角色兼任':'角色不可兼任'} · 补齐 ${e.rules.repairMinutes} 分钟`),el('p',{},`持续检查：${[['continuousVenue','场地'],['continuousTalks','分享'],['continuousCohosts','协办'],['continuousHosts','现场负责人']].filter(([k])=>e.rules[k]).map(([,v])=>v).join('、')||'无'} · 地址${e.rules.addressVisibility==='public'?'公开':'仅参与者可见'}`)),el('p',{class:'form-note'},'发布后，人数、截止时间与其他成行规则将锁定。活动创建者不会自动报名，也不会自动成为现场负责人。'),el('button',{type:'submit',class:'button orange'},'确认规则并发布'));f.onsubmit=async ev=>{ev.preventDefault();const b=f.querySelector('button[type=submit]');b.disabled=true;try{await command('publish');}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function registrationCalendar(slots,selected,finalId){
 const root=el('fieldset',{class:'slot-options registration-calendar'},el('legend',{},'点选可参加日期（可多选）'));
 const groups=new Map();for(const slot of slots){const day=localParts(slot.startsAt).slice(0,10);if(!groups.has(day))groups.set(day,[]);groups.get(day).push(slot);}
 const months=[...new Set([...groups.keys()].map(d=>d.slice(0,7)))].sort();
 for(const month of months){const [year,m]=month.split('-').map(Number),offset=(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7,days=new Date(Date.UTC(year,m,0)).getUTCDate();
 const grid=el('div',{class:'registration-calendar-grid'},...['一','二','三','四','五','六','日'].map(d=>el('span',{class:'calendar-weekday'},d)));
 for(let i=0;i<offset;i++)grid.append(el('span'));
 for(let n=1;n<=days;n++){const key=month+'-'+String(n).padStart(2,'0'),choices=groups.get(key);if(!choices){grid.append(el('span',{class:'registration-day-unavailable'},n));continue;}
 const cell=el('div',{class:'registration-day'},el('strong',{},n));
 for(const slot of choices){const input=el('input',{type:'checkbox',name:'availableSlotIds',value:slot.id,checked:selected.includes(slot.id),'aria-label':date(slot.startsAt)+' 至 '+date(slot.endsAt)});const start=localParts(slot.startsAt),end=localParts(slot.endsAt);const text=start.slice(11)+'–'+(start.slice(0,10)===end.slice(0,10)?'':end.slice(5,10)+' ')+end.slice(11);
 cell.append(el('label',{},input,el('span',{},text+(slot.id===finalId?' · 已定':''))));}grid.append(cell);}
 root.append(el('h3',{},year+' 年 '+m+' 月'),grid);
 }
 root.append(el('small',{class:'muted'},'蓝色为已选。时间均为荷兰当地时间。'));return root;
}
function localParts(ms){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]));return`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
function quarterPicker(input){
 const dateOnly=input.type==='datetime-local';
 const day=dateOnly?el('input',{type:'date',value:input.value.slice(0,10),'aria-label':'日期',required:true}):null;
 const time=input.value.slice(-5),hour=el('select',{'aria-label':'小时'},...Array.from({length:24},(_,i)=>{const v=String(i).padStart(2,'0');return el('option',{value:v,selected:v===time.slice(0,2)},v);}));
 const minute=el('select',{'aria-label':'分钟'},...['00','15','30','45'].map(v=>el('option',{value:v,selected:v===time.slice(3)},v)));
 // Preserve existing off-grid values until the user explicitly changes the time.
 if(!['00','15','30','45'].includes(time.slice(3))){minute.prepend(el('option',{value:time.slice(3),selected:true,disabled:true},time.slice(3)+'（原值）'));}
 input.style.display='none';
 const sync=()=>{input.value=(day?day.value+'T':'')+hour.value+':'+minute.value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
 for(const control of [day,hour,minute].filter(Boolean))control.addEventListener('change',sync);
 return el('div',{class:'quarter-picker'},input,day,hour,el('span',{},':'),minute);
}
function timeField(label,name,value){const input=el('input',{id:name,name,type:'datetime-local',required:true,value:localParts(value)});const offset=el('select',{name:`${name}Offset`,'aria-label':`${label}重复时间选择`},el('option',{value:'early'},'首次（夏令时优先）'),el('option',{value:'late'},'第二次（冬令时）'));if(amsterdamMs(localParts(value),'late')!==amsterdamMs(localParts(value),'early')&&amsterdamMs(localParts(value),'late')===Math.floor(value/60000)*60000)offset.value='late';const syncOffset=()=>{try{offset.hidden=amsterdamMs(input.value,'early')===amsterdamMs(input.value,'late');}catch{offset.hidden=true;}};input.addEventListener('input',syncOffset);syncOffset();return el('label',{class:'field'},label,el('div',{class:'time-row'},quarterPicker(input),offset));}
function amsterdamMs(value,which){const naive=Date.parse(value+'Z');const candidates=[naive-3600000,naive-7200000].filter(t=>localParts(t)===value).sort((a,b)=>a-b);if(!candidates.length)throw new Error('所选荷兰时间不存在（可能处于夏令时切换），请选择其他时间。');return which==='late'?candidates.at(-1):candidates[0];}
function slotEditor(initial){
  const slots=initial.map(s=>({...s}));
  let month=localParts(slots[0]?.startsAt||Date.now()).slice(0,7);
  const calendar=el('div',{class:'slot-calendar'}),rows=el('div',{class:'slot-editor-rows'});
  const start=el('input',{type:'time',value:'14:00','aria-label':'批量开始时间'}),end=el('input',{type:'time',value:'16:00','aria-label':'批量结束时间'});
  const root=el('div',{class:'slot-editor'},el('p',{class:'form-note'},'点击日历多选日期，统一设置时间；下方可逐日修改。全部采用荷兰当地时间。'),el('div',{class:'slot-batch'},el('label',{},'开始 ',quarterPicker(start)),el('label',{},'结束 ',quarterPicker(end)),btn('应用到所有日期',()=>{try{for(const slot of slots){const d=localParts(slot.startsAt).slice(0,10);slot.startsAt=amsterdamMs(d+'T'+start.value);slot.endsAt=amsterdamMs(d+'T'+end.value);}render();}catch(e){errorAt(root,e);}},'button quiet')),calendar,rows);
  function render(){
    const monthInput=el('input',{type:'month',value:month,'aria-label':'选择月份',onchange:ev=>{if(ev.target.value){month=ev.target.value;render();}}});
    const [year,m]=month.split('-').map(Number),days=new Date(Date.UTC(year,m,0)).getUTCDate(),offset=(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7;
    const grid=el('div',{class:'slot-calendar-grid'},['一','二','三','四','五','六','日'].map(d=>el('span',{class:'calendar-weekday'},d)));
    for(let i=0;i<offset;i++)grid.append(el('span'));
    for(let day=1;day<=days;day++){const d=month+'-'+String(day).padStart(2,'0');const found=slots.findIndex(s=>localParts(s.startsAt).slice(0,10)===d);const button=btn(String(day),()=>{try{if(found>=0)slots.splice(found,1);else slots.push({id:crypto.randomUUID(),startsAt:amsterdamMs(d+'T'+start.value),endsAt:amsterdamMs(d+'T'+end.value)});render();}catch(e){errorAt(root,e);}},'calendar-day'+(found>=0?' selected':''));button.setAttribute('aria-pressed',String(found>=0));button.setAttribute('aria-label',d);grid.append(button);}
    calendar.replaceChildren(monthInput,grid);
    rows.replaceChildren(...slots.slice().sort((a,b)=>a.startsAt-b.startsAt).map(slot=>{const row=el('div',{class:'slot-editor-row'},timeField('开始','slot-'+slot.id+'-start',slot.startsAt),timeField('结束','slot-'+slot.id+'-end',slot.endsAt),btn('删除日期',()=>{slots.splice(slots.indexOf(slot),1);render();},'button quiet'));row.onchange=()=>{try{const inputs=row.querySelectorAll('input[type=datetime-local]'),offsets=row.querySelectorAll('.time-row > select');slot.startsAt=amsterdamMs(inputs[0].value,offsets[0].value);slot.endsAt=amsterdamMs(inputs[1].value,offsets[1].value);}catch(e){/* Inline time validation explains invalid field values. */}};return row;}));
    root.dispatchEvent(new Event('slots-changed',{bubbles:true}));
  }
  render();
  return {root,read(){if(!slots.length||slots.length>20)throw new Error('请选择 1–20 个候选日期。');for(const s of slots)if(!(s.startsAt<s.endsAt))throw new Error('每个时段的结束时间须晚于开始时间。');return slots.slice().sort((a,b)=>a.startsAt-b.startsAt).map(s=>({...s}));}};
}
function repairChoice(label,name,value,yesText='是 · 限时补齐，超时取消',noText='否 · 由发起人处理'){
  const yes=el('input',{type:'radio',name,value:'yes',checked:value}),no=el('input',{type:'radio',name,value:'no',checked:!value});
  return el('fieldset',{class:'repair-choice'},el('legend',{},label),el('div',{class:'yes-no-options'},el('label',{},yes,el('span',{},yesText)),el('label',{},no,el('span',{},noText))));
}
function peopleRange(min,max){
 const low=el('input',{type:'range',name:'minPeople',min:3,max:100,step:1,value:min,'aria-label':'最低成行人数'}),high=el('input',{type:'range',name:'maxPeople',min:3,max:100,step:1,value:max,'aria-label':'最大人数'});
 const output=el('output',{'aria-live':'polite'}),track=el('div',{class:'people-range-track'},low,high);
 const sync=changed=>{if(+low.value>+high.value){if(changed===low)low.value=high.value;else high.value=low.value;}output.textContent='最低 '+low.value+' 人 — 最多 '+high.value+' 人';low.setAttribute('aria-valuetext','最低 '+low.value+' 人');high.setAttribute('aria-valuetext','最多 '+high.value+' 人');track.style.setProperty('--low',((low.value-3)/97*100)+'%');track.style.setProperty('--high',((high.value-3)/97*100)+'%');};
 low.oninput=()=>sync(low);high.oninput=()=>sync(high);sync();
 return el('div',{class:'people-range'},el('strong',{},'活动人数'),output,track,el('div',{class:'range-limits'},el('span',{},'3 人'),el('span',{},'100 人')),el('small',{class:'muted'},'左侧：最低成行人数 · 右侧：人数上限。也可聚焦滑块后用方向键调整。'));
}
function hostRange(value){
 const input=el('input',{type:'range',name:'minHosts',min:0,max:10,step:1,value,'aria-label':'最少现场负责人数'}),output=el('output',{});
 const sync=()=>{output.textContent=input.value==='0'?'0 人 · 不要求现场负责人':input.value+' 人';input.setAttribute('aria-valuetext',output.textContent);};input.oninput=sync;sync();
 return el('label',{class:'field host-range'},'最少现场负责人数',output,input,el('small',{class:'muted'},'0 人：不作为成行条件；最多 10 人。'));
}
function renderEventForm(existing){state.detailVisible=false;state.pendingEvent=null;if(!requireUser())return;const day=86400000, start=Math.ceil(Date.now()/900000)*900000+14*day;const defaults={minPeople:10,maxPeople:12,waitlist:true,recruitmentDeadline:start-2*day,startsAt:start,endsAt:start+2*3600000,registrationDeadline:start-3600000,promotionDeadline:start-3600000,repairMinutes:60,venueRequired:true,minTalks:0,minCohosts:0,minHosts:1,allowRoleOverlap:true,continuousVenue:true,continuousTalks:false,continuousCohosts:false,continuousHosts:true,addressVisibility:'participants'};const r=existing?.rules||defaults;const editor=slotEditor(r.timeSlots||[{id:crypto.randomUUID(),startsAt:r.startsAt,endsAt:r.endsAt}]);const f=el('form',{class:'wide-form'},el('a',{class:'back',href:existing?`#event/${existing.id}`:'#',onclick:existing?e=>{e.preventDefault();renderDetail(existing);}:undefined},'← 返回'),el('h1',{},existing?'编辑聚会草稿':'从一个想聊的话题开始'),el('p',{class:'muted'},'先保存为草稿，再预览发布。把成行规则讲清楚，让每个人都知道自己的承诺。'));f.append(el('div',{class:'panel'},field('聚会标题','title','text',existing?.title||''),field('城市','city','text',existing?.city||'Amsterdam'),field('聚会介绍：聊什么，适合谁，如何安排','description','textarea',existing?.description||'')));const advancedTimes=el('details',{class:'advanced-times'},el('summary',{},'高级设置：报名与递补截止'),el('p',{class:'muted'},'成行后仍可报名；有人退出时，可在递补截止前自动邀请候补。'),el('div',{class:'form-grid'},timeField('停止接受报名','registrationDeadline',r.registrationDeadline),timeField('停止自动递补','promotionDeadline',r.promotionDeadline)));
const times=el('fieldset',{},el('legend',{},'01 / 相聚时间'),el('p',{class:'muted'},'以下均为荷兰当地时间。'),el('h3',{},'1. 选择候选日期和时段'),editor.root,el('h3',{},'2. 最晚何时决定活动能否成行'),timeField('成行决定期限','recruitmentDeadline',r.recruitmentDeadline),el('p',{class:'muted'},'请在此之前确认最终时段。到期时，系统按人数、场地等条件决定是否成行。'),el('p',{class:'muted'},'报名截止：'+date(r.registrationDeadline)+'；递补截止：'+date(r.promotionDeadline)+'。可在高级设置中调整。'),advancedTimes);const rules=el('fieldset',{},el('legend',{},'02 / 固定成行条件'),el('p',{class:'muted'},'这些规则在发布后锁定。主持人需本人报名并由发起人确认。'),el('div',{class:'form-grid'},peopleRange(r.minPeople,r.maxPeople),hostRange(r.minHosts),el('div',{},field('条件不足后，最多等多久（分钟）','repairMinutes','number',r.repairMinutes),el('small',{class:'muted'},'活动成行后，需补齐的条件不足时开始倒计时。补齐后继续；超时仍不足则自动取消，最迟等到活动开始。'))),repairChoice('满员后允许候补？','waitlist',r.waitlist,'是 · 可加入候补','否 · 满员后停止报名'),repairChoice('成行前必须确认足够大的场地？','venueRequired',r.venueRequired,'是 · 容量须覆盖人数上限','否 · 场地不作为成行条件'),);const continuous=el('fieldset',{},el('legend',{},'03 / 成行后，条件不足怎么办'),repairChoice('场地撤回或容量不足时，自动启动限时补齐？','continuousVenue',r.continuousVenue),repairChoice('已确认主持人人数不足时，自动启动限时补齐？','continuousHosts',r.continuousHosts),el('p',{class:'form-note'},'选择「是」时，使用上方「条件不足后，最多等多久」的时长。选择「否」时，该项不足不会触发自动取消。成行前仍会检查已设定的要求。'),el('label',{class:'field'},'场地地址可见范围',el('select',{name:'addressVisibility'},el('option',{value:'participants',selected:r.addressVisibility==='participants'},'有权限的活动参与者'),el('option',{value:'public',selected:r.addressVisibility==='public'},'所有人'))));const save=el('button',{class:'button dark',type:'submit'},existing?'保存草稿':'保存草稿，进入预览 →');f.append(times,rules,continuous,save);attachTimeValidation(f,amsterdamMs);f.addEventListener('invalid',ev=>{const details=ev.target.closest('details');if(details)details.open=true;},true);f.querySelectorAll('input[type=number]').forEach(n=>{n.min=['minTalks','minCohosts','minHosts'].includes(n.name)?'0':'1';n.step='1';});f.onsubmit=async ev=>{ev.preventDefault();save.disabled=true;try{const fd=new FormData(f);const rr={};for(const [k,v] of Object.entries(r)){if(['timeSlots','startsAt','endsAt'].includes(k))continue;if(typeof v==='boolean')rr[k]=['continuousVenue','continuousHosts','waitlist','venueRequired'].includes(k)?fd.get(k)==='yes':fd.has(k);else if(['startsAt','endsAt','recruitmentDeadline','registrationDeadline','promotionDeadline'].includes(k))rr[k]=amsterdamMs(fd.get(k),fd.get(k+'Offset'));else if(typeof v==='number')rr[k]=Number(fd.get(k));else rr[k]=fd.get(k);}rr.minTalks=0;rr.minCohosts=0;rr.continuousTalks=false;rr.continuousCohosts=false;rr.allowRoleOverlap=true;rr.timeSlots=editor.read();rr.startsAt=rr.timeSlots[0].startsAt;rr.endsAt=rr.timeSlots[0].endsAt;if(!(rr.recruitmentDeadline<rr.startsAt&&rr.startsAt<rr.endsAt))throw new Error('请确保征集截止早于开始时间，结束时间晚于开始时间。');if(['registrationDeadline','promotionDeadline'].some(k=>rr[k]<rr.recruitmentDeadline||rr[k]>=rr.startsAt))throw new Error('报名和递补截止须不早于征集截止，且早于最早候选时段。');if(rr.minPeople>rr.maxPeople)throw new Error('最低人数不能超过人数上限。');const data={title:fd.get('title').trim(),city:fd.get('city').trim(),description:fd.get('description').trim(),rules:rr};if(existing){await command('edit',data);}else{const response=await api('/api/events',data);location.hash=`event/${response.event.id}`;toast('草稿已保存，请预览并确认发布。');}}catch(err){errorAt(f,err);}finally{save.disabled=false;}};app.replaceChildren(f);window.scrollTo({top:0});}
function closeAI(){state.aiGeneration++;state.aiReviewPending=false;$('#ai-panel').hidden=true;state.proposal=null;$('#ai-messages').replaceChildren();$('#ai-input').value='';}
function openAI(){if(!requireUser())return;$('#ai-panel').hidden=false;$('#ai-input').focus();}
$('#ai-close').onclick=()=>{closeAI();applyPendingEvent();};
$('#ai-form').onsubmit=async e=>{e.preventDefault();if(!state.event)return;const id=state.event.id;const generation=state.aiGeneration;const input=$('#ai-input');const message=input.value.trim();if(!message)return;const root=$('#ai-messages');root.append(el('div',{class:'ai-message user'},message));input.value='';const submit=$('#ai-form button');submit.disabled=true;try{const result=await api('/api/ai',{eventId:id,message});if(state.event?.id!==id||generation!==state.aiGeneration||$('#ai-panel').hidden)return;root.append(el('div',{class:'ai-message'},result.reply));root.querySelectorAll('.ai-proposal').forEach(x=>x.remove());state.proposal=null;if(result.proposal){const p=result.proposal;p.eventVersion=state.event.version;state.proposal=p;state.aiReviewPending=false;const card=el('div',{class:'ai-proposal'},el('strong',{},'等待你的确认'),el('p',{},`活动：${p.eventTitle}`),el('p',{},`操作：${actions[p.action?.action||p.action]||p.action?.action||'活动操作'}`),el('pre',{class:'prose'},typeof p.action==='object'?JSON.stringify(p.action,null,2):''),el('p',{class:'muted'},`有效至 ${date(p.expiresAt)}`));card.append(btn('确认执行',async ev=>{ev.currentTarget.disabled=true;try{if(state.proposal?.id!==p.id||state.event?.id!==id)throw new Error('活动或确认卡已变化，请重新向助手提出请求。');if(Date.now()>=p.expiresAt)throw new Error('确认卡已过期，请重新生成。');await api('/api/ai/confirm',{proposalId:p.id});state.proposal=null;card.replaceChildren(el('strong',{},'✓ 操作已完成'));await loadEvent(id);toast('助手操作已执行');}catch(err){errorAt(card,err);}finally{if(ev.target.isConnected)ev.target.disabled=false;}},'button dark'),btn('不执行',()=>{state.proposal=null;card.remove();applyPendingEvent();},'button quiet'));root.append(card);}root.scrollTop=root.scrollHeight;}catch(err){if(state.event?.id===id&&generation===state.aiGeneration)errorAt(root,err);}finally{submit.disabled=false;}};
async function loadEvent(id){const token=++state.loading;try{const r=await api(`/api/events/${encodeURIComponent(id)}`);if(token!==state.loading)return;const e=r.event;for(const k of ['canManage','isOwner','myParticipation','myApplications','conditions','counts','participants','applications','receipts','preferenceSummary'])if(r[k]!==undefined)e[k]=r[k];if(state.event?.id===e.id&&state.event.version!==e.version)invalidateAIProposal();state.event=e;renderDetail(e);}catch(err){if(token!==state.loading)return;app.replaceChildren(el('a',{class:'back',href:'#'},'← 返回聚会列表'));errorAt(app,err);app.append(btn('重试',()=>loadEvent(id)));}}
async function route(){state.detailVisible=false;state.pendingEvent=null;const path=location.hash.slice(1);const previous=state.event?.id;const id=path.startsWith('event/')?path.slice(6):null;if(id!==previous)closeAI();if(path==='cli'||path.startsWith('cli/')){state.loading++;state.event=null;renderCliDocs(app);return;}if(path==='new'){state.loading++;state.event=null;renderEventForm();return;}app.replaceChildren(el('div',{class:'loading',role:'status'},'正在准备这张咖啡桌…'));if(id)return loadEvent(id);state.event=null;const token=++state.loading;try{const r=await api('/api/events');if(token!==state.loading)return;state.events=r.events||[];if(r.user!==undefined){state.user=r.user?{...state.user,...r.user}:null;updateAccount();}renderHome();}catch(err){if(token!==state.loading)return;app.replaceChildren(hero());errorAt(app,err);app.append(btn('重新加载活动',route));}}

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

// Keep the overview reading position while visiting an activity or another page.
let overviewScrollY=0,navigationGeneration=0,restoringOverview=false;
const atOverview=()=>!location.hash||location.hash==='#';
history.scrollRestoration='manual';
window.addEventListener('scroll',()=>{
  if(atOverview()&&!restoringOverview&&app.querySelector('.overview'))overviewScrollY=window.scrollY;
},{passive:true});
document.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href]');
  if(atOverview()&&app.querySelector('.overview')&&link?.hash){
    overviewScrollY=window.scrollY;
  }
},true);
window.addEventListener('hashchange',async()=>{
  const generation=++navigationGeneration,returning=atOverview();
  restoringOverview=true;
  await route();
  // Map mounting is scheduled on the first frame; restore after its container exists.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(generation!==navigationGeneration)return;
    window.scrollTo({top:returning?overviewScrollY:0,behavior:'instant'});
    restoringOverview=false;
  }));
});
(async()=>{try{const r=await api('/api/me');state.user=r.user;updateAccount();}catch(e){toast(e.message);}await route();})();
