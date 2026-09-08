import {localParts,amsterdamMs,weekendCoffeeTemplate,popularity,peopleStops,peopleScale} from './event-models.js';
import {cityPicker} from './city-picker.js';
import {cityCoffee,defaultCoffee} from './city-coffee.js';
import {dagStatuses,dagStatusLabels} from './dag-status.js';
import {attachTimeValidation} from './time-validation.js';
import {renderCliDocs} from './cli-docs.js';
import {mountMap} from './map.js';
import {monthRange,eventSlots,filterEvents} from './overview.js';
import qrcode from './vendor/qrcode/qrcode.mjs';
const $ = (s, root = document) => root.querySelector(s);
const app = $('#app');
const state = {user:null, events:[], event:null, city:'全部',selectedTag:'',period:'all',from:monthRange('current').from,to:monthRange('current').to, loading:0, proposal:null, aiGeneration:0, detailVisible:false, pendingEvent:null, polling:false, aiReviewPending:false};
const statusNames = {draft:'草稿',recruiting:'正在征集',confirmed:'已成行',repairing:'条件补齐中',cancelled:'已取消',completed:'已结束',pending:'待审核',approved:'已通过',rejected:'未通过',withdrawn:'已撤回',joined:'已报名',waitlisted:'候补中',left:'已退出'};
const kinds = {cohost:'协办',host:'帮忙成员',talk:'主题分享',venue:'场地',material:'物资',pledge:'赞助'};
const actions = {join:'报名',leave:'退出报名',apply:'提交申请',withdraw:'撤回申请',publish:'发布活动',cancel:'取消活动',review:'审核申请',revoke:'撤销批准',describe:'更正介绍',edit:'编辑草稿',reply_registration:'回复报名留言'};
function el(tag, props={}, ...children){const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='text')n.textContent=v;else if(v!==null&&v!==undefined){if(k in n)n[k]=v;else n.setAttribute(k,v);}}for(const c of children.flat(Infinity))if(c!==null&&c!==undefined)n.append(c instanceof Node?c:document.createTextNode(String(c)));return n;}
const btn=(text,fn,cls='button')=>el('button',{type:'button',class:cls,onclick:fn},text);
const badge=s=>el('span',{class:`badge ${s}`},statusNames[s]||s);
function toast(message){const n=$('#toast');n.textContent=message;n.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.style.display='none',5500);}
function errorAt(root,error){root.querySelector('.error-box')?.remove();root.append(el('div',{class:'error-box',role:'alert'},error.message||String(error)));}
async function api(path, body, method){let response;try{response=await fetch(path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json',...(path.includes('/actions')||path==='/api/ai/confirm'?{'Idempotency-Key':crypto.randomUUID()}:{})}:{},body:body?JSON.stringify(body):undefined});}catch{throw new Error('网络连接失败，请检查网络后重试。');}let data;try{data=await response.json();}catch{throw new Error(`服务暂时无法响应（${response.status}），请稍后重试。`);}if(!response.ok){const detail=typeof data.error==='string'?data.error:data.error?.message||data.message||'请求失败';throw new Error(response.status===503?`服务尚未配置或暂时不可用：${detail}`:detail);}return data;}
function date(ms,options={}){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Europe/Amsterdam',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',...options}).format(new Date(ms));}
function activityUrl(e){return new URL(`#event/${e.id}`,location.href).href;}
function drawWrapped(ctx,text,x,y,maxWidth,lineHeight,maxLines=3){const chars=[...text];let line='',lines=[];for(const char of chars){const next=line+char;if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=char;}else line=next;}if(line)lines.push(line);for(const [index,value] of lines.slice(0,maxLines).entries())ctx.fillText(index===maxLines-1&&lines.length>maxLines?value.slice(0,-1)+'…':value,x,y+index*lineHeight);return y+Math.min(lines.length,maxLines)*lineHeight;}
function loadImage(src){return new Promise((resolve,reject)=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=reject;image.src=src.startsWith('https://')?src+'?cors=1':src;});}
function tagPicker(initial=[]){
  let chosen=[...initial],sequence=0,timer;
  const selected=el('div',{class:'tag-options'}),suggestions=el('div',{class:'tag-options'}),input=el('input',{type:'text',maxLength:20,placeholder:'搜索标签，或输入新标签','aria-label':'搜索或新建标签'});
  const root=el('fieldset',{class:'tag-picker'},el('legend',{},'本场风味 · 主题标签'),selected,input,suggestions,el('small',{class:'muted'},'最多 5 个。新标签随活动保存，所有成员均可复用。'));
  const normalize=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ');
  function add(value){const tag=normalize(value);if(!tag)return;if(tag.length>20||/[<>]/.test(tag)){toast('标签须为 1–20 字符，不含尖括号');return;}if(chosen.some(t=>t.toLowerCase()===tag.toLowerCase()))return;if(chosen.length>=5){toast('最多选择 5 个标签');return;}chosen.push(tag);input.value='';render();search();}
  function render(){selected.replaceChildren(...chosen.map(tag=>btn(tag+' ×',()=>{chosen=chosen.filter(t=>t!==tag);render();search();},'button tag-chip')));}
  async function search(){const current=++sequence;try{const data=await api('/api/tags?q='+encodeURIComponent(input.value));if(current!==sequence||!root.isConnected)return;const query=normalize(input.value),tags=data.tags.filter(t=>!chosen.some(s=>s.toLowerCase()===t.toLowerCase()));suggestions.replaceChildren(...tags.map(tag=>btn(tag,()=>add(tag),'button tag-chip')));if(query&&!data.tags.some(t=>t.toLowerCase()===query.toLowerCase())&&!chosen.some(t=>t.toLowerCase()===query.toLowerCase()))suggestions.append(btn('新建「'+query+'」',()=>add(query),'button tag-chip'));}catch{if(current===sequence)suggestions.replaceChildren(el('small',{},'标签库暂时不可用，仍可输入标签后按回车添加。'));}}
  input.addEventListener('input',()=>{++sequence;clearTimeout(timer);timer=setTimeout(search,200);});input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();add(input.value);}});
  render();setTimeout(search,0);return {root,read:()=>{const pending=normalize(input.value);if(pending){if(pending.length>20||/[\u0000-\u001f\u007f<>]/.test(pending))throw new Error('标签须为 1–20 字符，不含控制符或尖括号');if(chosen.length>=5&&!chosen.some(t=>t.toLowerCase()===pending.toLowerCase()))throw new Error('最多选择 5 个标签');add(pending);}return [...chosen];}};
}
function shareFlavors(e){
  if(e.tags?.length)return e.tags.slice(0,3);
  const text=`${e.title} ${e.description||''}`;
  const topics=['数据平台','可观测性','数据工程','机器学习','人工智能','数据分析','职业发展','工作','生活','Airflow','DuckDB','Python','SQL'];
  return topics.filter(topic=>text.toLowerCase().includes(topic.toLowerCase())).slice(0,3);
}
async function shareCard(e){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),logo=await loadImage('/logo.svg');
  const coffee=await loadImage(cityCoffee(e.city)).catch(()=>loadImage(defaultCoffee)).catch(()=>null);
  const slots=e.rules.timeSlots||[],selected=slots.find(s=>s.id===e.selectedSlotId),flavors=shareFlavors(e);
  const fmt=(ms,options)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Europe/Amsterdam',...options}).format(new Date(ms));
  const days=[...new Set(slots.map(s=>fmt(s.startsAt,{year:'numeric',month:'numeric',day:'numeric'})))];
  const groups=new Map();
  for(const day of days){const [year,month,date]=day.split('/');const key=year+' 年 '+month+' 月';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(date+' 日');}
  // Lay out in CSS-sized units, then export at 3x. The same pass measures the paper height.
  function paint(draw){
    let y=60;
    const label=(value,x,baseline,size=15,color='#50627a',weight=400)=>{
      ctx.font=weight+' '+size+'px system-ui,sans-serif';ctx.textAlign='center';ctx.fillStyle=color;
      if(draw)ctx.fillText(value,x,baseline);
    };
    const wrap=(value,size,width,weight=400)=>{
      ctx.font=weight+' '+size+'px system-ui,sans-serif';
      const lines=[];let line='';
      for(const ch of value){if(line&&ctx.measureText(line+ch).width>width){lines.push(line);line=ch;}else line+=ch;}if(line)lines.push(line);return lines;
    };
    const rule=()=>{if(draw){ctx.strokeStyle='#bdc7c6';ctx.lineWidth=.8;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(45,y);ctx.lineTo(385,y);ctx.stroke();ctx.setLineDash([]);}};
    if(draw){
      ctx.strokeStyle='#00a873';ctx.lineWidth=1.8;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(132,51);ctx.lineTo(132,62);ctx.quadraticCurveTo(132,69,139,69);ctx.quadraticCurveTo(146,69,146,62);ctx.lineTo(146,51);ctx.closePath();ctx.moveTo(146,53);ctx.bezierCurveTo(155,51,155,62,146,61);ctx.moveTo(130,73);ctx.lineTo(150,73);ctx.moveTo(136,46);ctx.lineTo(136,42);ctx.moveTo(142,46);ctx.lineTo(142,42);ctx.stroke();
    }
    label('DATA COFFEE',237,65,15,'#1769c2',600);y=113;
    if(coffee){if(draw){ctx.save();ctx.beginPath();ctx.arc(345,64,27,0,Math.PI*2);ctx.clip();ctx.drawImage(coffee,coffee.width*.15,coffee.height*.15,coffee.width*.68,coffee.height*.68,318,37,54,54);ctx.restore();}}
    const title=e.title.startsWith(e.city+' ')?[e.city,...wrap(e.title.slice(e.city.length+1),30,340,700)]:wrap(e.title,30,340,700);
    for(const line of title){label(line,215,y,30,'#24364b',700);y+=39;}
    y+=8;
    if(flavors.length){label('本 场 风 味',215,y,11,'#708078');y+=25;label(flavors.join(' · '),215,y,16,'#496652',500);y+=28;}
    else y+=10;
    rule();y+=28;
    for(const [x,name,value,width] of [[99,'城市',e.city,108],[229,'成行人数',e.rules.minPeople+' 人起 · 上限 '+e.rules.maxPeople+' 人',146],[351,'活动状态',statusNames[e.status]||e.status,70]]){
      label(name,x,y,12,'#637386');
      const lines=wrap(value,14,width,500);
      lines.forEach((line,i)=>label(line,x,y+26+i*19,14,name==='活动状态'&&e.status==='recruiting'?'#078048':'#24364b',500));
    }
    y+=55;rule();y+=43;
    label(selected?fmt(selected.startsAt,{month:'long',day:'numeric',weekday:'long'}):'日期待定',215,y,28,'#1769c2',650);y+=32;
    if(selected){label(fmt(selected.startsAt,{year:'numeric'})+' · '+fmt(selected.startsAt,{hour:'2-digit',minute:'2-digit'})+'–'+fmt(selected.endsAt,{hour:'2-digit',minute:'2-digit'}),215,y,15);y+=29;label('时间已确认 · 成行状态以活动页面为准',215,y,12);y+=28;}
    else{
      for(const [month,dates] of groups){
        label(month,215,y,14);y+=27;
        for(let i=0;i<dates.length;i+=4){label(dates.slice(i,i+4).join('   /   '),215,y,19,'#50627a',500);y+=29;}
      }
      label(slots.length+' 个候选时段 · 扫码选择可参加时间',215,y,12);y+=27;
    }
    const qr=qrcode(0,'H');qr.addData(activityUrl(e));qr.make();
    const count=qr.getModuleCount(),cell= Math.max(1,Math.floor(154*3/count))/3,size=count*cell,quiet=cell*4,top=y+quiet,left=(430-size)/2;
    if(draw){ctx.fillStyle='#fff';ctx.fillRect(left-quiet,top-quiet,size+quiet*2,size+quiet*2);ctx.fillStyle='#17263a';for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(qr.isDark(row,col))ctx.fillRect(left+col*cell,top+row*cell,cell,cell);const plate=size*.18,icon=plate*.72;ctx.fillStyle='#fff';ctx.fillRect(215-plate/2,top+size/2-plate/2,plate,plate);ctx.drawImage(logo,215-icon/2,top+size/2-icon/2,icon,icon);}
    y=top+size+quiet+26;label(['completed','cancelled'].includes(e.status)?'扫码查看活动':'扫码查看活动 · 报名',215,y,16,'#24364b',600);y+=24;rule();y+=26;
    label('由成员共同推进，满足成行规则后出发。',215,y,12,'#65776c');y+=21;
    label('活动安排与状态以页面最新信息为准。',215,y,12,'#65776c');
    return Math.ceil(y+48);
  }
  const height=paint(false);canvas.width=1290;canvas.height=height*3;ctx.scale(3,3);
  ctx.fillStyle='#edf4fb';ctx.fillRect(0,0,430,height);ctx.fillStyle='#fffdf7';ctx.fillRect(15,12,400,height-36);ctx.fillStyle='#00b86b';ctx.fillRect(15,12,400,6);
  paint(true);
  ctx.fillStyle='#edf4fb';for(let x=15;x<415;x+=16){ctx.beginPath();ctx.moveTo(x,height-24);ctx.lineTo(x+8,height-32);ctx.lineTo(x+16,height-24);ctx.fill();}
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('分享图生成失败')),'image/png'));
}
async function copyText(value){if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value);const input=el('textarea',{value});document.body.append(input);input.select();document.execCommand('copy');input.remove();}
async function shareEvent(e){const url=activityUrl(e),actions=el('div',{class:'share-actions'}),content=el('div',{class:'share-dialog'},el('h2',{},'分享这场活动'),el('p',{class:'muted'},'把活动链接发给朋友，或分享带二维码的邀请图。'),el('div',{class:'share-preview loading'},'正在生成分享图…'),actions);modal(content);try{const blob=await shareCard(e),objectUrl=URL.createObjectURL(blob),preview=el('img',{src:objectUrl,alt:`${e.title}活动分享图，包含二维码`}),file=new File([blob],`data-coffee-${e.id}.png`,{type:'image/png'}),canShareImage=Boolean(navigator.share&&navigator.canShare?.({files:[file]}));content.querySelector('.share-preview').replaceChildren(preview);const linkAction=navigator.share?btn('分享活动链接',()=>navigator.share({title:e.title,text:`${e.title} · ${e.city}`,url}).catch(error=>{if(error.name!=='AbortError')toast(error.message);})) : btn('复制活动链接',async()=>{await copyText(url);toast('活动链接已复制');});const imageAction=canShareImage?btn('分享二维码图片',()=>navigator.share({files:[file],title:e.title,text:`${e.title} · ${e.city}`}).catch(error=>{if(error.name!=='AbortError')toast(error.message);}), 'button dark') : el('a',{class:'button dark',href:objectUrl,download:file.name},'下载二维码图片');actions.append(linkAction,imageAction);$('#modal').addEventListener('close',()=>URL.revokeObjectURL(objectUrl),{once:true});}catch(error){errorAt(content,error);}}
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
function overviewCardVisual(e,slots){const calendar=overviewCalendar(slots),root=el('div',{class:'overview-card-visual'},calendar);if(calendar.children.length<2){const image=el('img',{class:'city-coffee',crossorigin:'anonymous',src:cityCoffee(e.city)+'?cors=1',alt:'',loading:'lazy'});image.onerror=()=>{if(image.getAttribute('src')!==defaultCoffee)image.src=defaultCoffee;else image.hidden=true;};const info=el('div',{class:'overview-card-info'},el('div',{class:'overview-story'},image,el('p',{class:'overview-description'},e.description)),eventPopularity(e));root.append(info);root.classList.add('single-month');}else root.append(el('div',{class:'overview-card-info'},el('p',{class:'overview-description'},e.description),eventPopularity(e)));return root;}
function eventTags(e){return el('div',{class:'event-tags'},(e.tags||[]).map(tag=>el('span',{},'# '+tag)));}
function eventPopularity(e){
 const {capacity,percent,heat,label,scale,text}=popularity(e);
 return el('div',{class:'event-progress event-popularity '+heat},el('div',{class:'popularity-heading'},el('span',{},text),el('strong',{},label)),el('div',{class:'popularity-track'},el('progress',{max:scale,value:percent,'aria-label':'人气：'+text}),el('span',{class:'capacity-marker',style:'left:'+(100/scale*100)+'%','aria-hidden':'true'})),el('small',{},'上限 '+capacity+' 人 · 刻线表示满额'));
}
function overviewCard(e){const slots=eventSlots(e);return el('a',{class:'overview-event',href:`#event/${e.id}`},el('div',{class:'overview-event-heading'},el('h3',{},e.title),badge(e.status)),el('p',{class:'overview-event-meta'},e.city+' · '+(e.selectedSlotId?'最终时段':slots.length>1?slots.length+' 个候选时段':'活动时间')),eventTags(e),overviewCardVisual(e,slots),el('div',{class:'overview-event-bottom'},el('span',{},`${e.counts?.joined||0} 人报名 · ${e.rules.minPeople} 人起成行`),el('span',{},'查看活动流程 →')));}
function overviewMap(events){const wrapper=el('div',{class:'overview-map-real'});requestAnimationFrame(()=>{if(wrapper.isConnected)mountMap(wrapper,events,state.city,city=>{state.city=city;renderHome();});});return wrapper;}
function renderHome(){state.detailVisible=false;state.pendingEvent=null;const range=overviewRange(),invalid=range&&(!range.from||!range.to||range.from>range.to),timeEvents=invalid?[]:filterEvents(state.events,'全部',range).filter(e=>!state.selectedTag||(e.tags||[]).some(tag=>tag.toLowerCase()===state.selectedTag.toLowerCase())),filtered=filterEvents(timeEvents,state.city,range);const heading=el('header',{class:'overview-heading'},el('div',{},el('span',{class:'eyebrow'},'DATA COFFEE / 活动总览'),el('h1',{class:'coffee-dags-title'},el('s',{class:'airflow-joke'},'Airflow'),' Data Coffee DAGs'),el('p',{class:'muted'},'把相聚调度起来 · 按城市和时间找到你的下一次 coffee chat。')),el('span',{class:'overview-total'},filtered.length+' 场活动'));
const periods=el('div',{class:'overview-periods','aria-label':'按时间筛选'},[['all','全部时间'],['current','本月'],['next','下月'],['custom','自选日期']].map(([key,label])=>btn(label,()=>{state.period=key;renderHome();},'filter'+(state.period===key?' active':''))));periods.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(['all','current','next','custom'][i]===state.period)));
const tags=[...new Map(state.events.flatMap(e=>e.tags||[]).map(tag=>[tag.toLowerCase(),tag])).values()].sort((a,b)=>a.localeCompare(b,'zh-CN'));
const tagFilters=el('div',{class:'overview-tag-filters','aria-label':'按主题标签筛选'},el('span',{class:'muted'},'想聊什么'),['',...tags].map(tag=>el('button',{type:'button',class:'filter'+(state.selectedTag===tag?' active':''),'aria-pressed':String(state.selectedTag===tag),onclick:()=>{state.selectedTag=state.selectedTag===tag?'':tag;renderHome();}},tag||'全部主题')));
const controls=el('section',{class:'overview-controls'},periods);if(state.period==='custom'){const from=el('input',{type:'date',value:state.from,'aria-label':'开始日期'}),to=el('input',{type:'date',value:state.to,'aria-label':'结束日期'});from.onchange=()=>{state.from=from.value;renderHome();};to.onchange=()=>{state.to=to.value;renderHome();};controls.append(el('div',{class:'overview-dates'},el('label',{},'从 ',from),el('label',{},'至 ',to)),invalid?el('p',{class:'error-box',role:'alert'},'请选择完整日期范围，结束日期须不早于开始日期。'):document.createDocumentFragment());}
controls.append(tagFilters);
const cities=['全部',...new Set(timeEvents.map(e=>e.city).filter(Boolean))];const cityButtons=el('div',{class:'overview-cities','aria-label':'按城市筛选'},cities.map(city=>{const count=city==='全部'?timeEvents.length:timeEvents.filter(e=>e.city===city).length;return el('button',{type:'button',class:'overview-city'+(state.city===city?' active':''),'aria-pressed':String(state.city===city),onclick:()=>{state.city=city;renderHome();}},el('span',{},city),el('span',{class:'city-count'},count));}));
const geography=el('section',{class:'overview-geography'},el('h2',{},'城市分布'),overviewMap(timeEvents),cityButtons);const results=el('section',{class:'overview-results','aria-label':'筛选结果','aria-live':'polite'},el('div',{class:'overview-results-heading'},el('h2',{},state.city==='全部'?'所有城市':state.city),el('span',{class:'muted'},filtered.length+' 场')),filtered.length?filtered.map(overviewCard):el('div',{class:'empty'},el('h3',{},invalid?'先选好日期':'No coffee runs found.'),el('p',{},invalid?'补全日期后即可查看结果。':'这个范围还没有咖啡被调度。试试其他城市或时间，或发起一场。'),btn('重置筛选',()=>{state.city='全部';state.period='all';state.selectedTag='';renderHome();})));
app.replaceChildren(el('div',{id:'gatherings',class:'overview'},heading,el('aside',{class:'decision-note overview-intro'},el('strong',{},'想聊就报名，一起把局凑起来 ☕'),el('p',{},'群里的大聚会，刚认识的人还没聊够就散场了？或只是想找几个同频的人，喝杯咖啡，聊聊想法和近况。'),el('p',{},'想约一次 coffee chat，又不想在群里吆喝？这里是给全荷兰华人数据同行准备的低噪声相聚空间。'),el('p',{},'你可以自己攒局，也可以加入感兴趣的一场。推荐场地、搭把手，都欢迎。'),el('p',{},'不用一个人张罗齐所有事情。大家一起凑，条件满足就按约定自动开局。'),el('p',{},'这次没凑成也没关系，下次再约。出发前，记得看看活动的最新安排。')),controls,el('div',{class:'overview-layout'},geography,results)));}

async function command(action,extra={}){if(!requireUser())return;const id=state.event.id;const r=await api(`/api/events/${id}/actions`,{action,version:state.event.version,...extra});closeModal();toast('操作已保存');if(state.event?.id===id)await loadEvent(id);return r;}
function run(action,extra={},node){return command(action,extra).catch(e=>node?errorAt(node,e):toast(e.message));}
function confirmation(title,message,action,extra={},reason=false){const f=el('form',{},el('h2',{},title),el('p',{},message));if(reason)f.append(field('原因（将记入活动记录）','reason','textarea'));const b=el('button',{type:'submit',class:'button dark'},'确认');f.append(b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;try{await command(action,{...extra,...(reason?{reason:f.elements.reason.value}:{})});}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function conditionNode(c){return el('div',{class:`condition ${c.satisfied?'ok':''}`},el('div',{class:'condition-top'},el('span',{},c.label),el('span',{},c.satisfied?'✓ 已满足':'待补齐')),el('strong',{},`${c.current} / ${c.required}`),el('div',{class:'progress-track'},el('span',{style:`width:${c.required?Math.min(100,c.current/c.required*100):100}%`})),el('span',{class:'muted'},c.continuous?'成行后仍需持续满足':'成行时检查'));}
function applyForm(kind){if(!requireUser())return;const f=el('form',{},el('h2',{},kind==='host'?'我可以帮忙':`申请${kinds[kind]}`),field('标题','title','text'),field('具体说明','detail','textarea'));if(kind==='venue')f.append(field('可容纳人数（可留空，确认时补充）','capacity','number'),field('详细地址','address','text'),el('p',{class:'muted'},state.event.rules.addressVisibility==='participants'?'地址仅按活动规则向参与者展示。':'此活动将公开场地地址。'));if(kind==='talk')f.append(field('预计时长（分钟）','duration','number',20));if(kind==='pledge')f.append(field('赞助金额（欧元）','amount','number'));if(kind==='venue')f.elements.capacity.required=false;const b=el('button',{class:'button dark',type:'submit'},'提交申请');f.append(el('p',{class:'form-note'},'申请通过后才计入条件。申请只代表你本人，可以在活动中查看处理结果或撤回。'),b);f.onsubmit=async e=>{e.preventDefault();b.disabled=true;const v=Object.fromEntries(new FormData(f));for(const k of ['capacity','amount','duration'])if(k in v){if(k==='capacity'&&v[k]==='')delete v[k];else v[k]=Number(v[k]);}try{await command('apply',{kind,...v});}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
function confirmVenue(a){const f=el('form',{},el('h2',{},'确认场地 · '+a.title),field('实际可容纳人数','capacity','number',a.capacity||''),el('button',{type:'submit',class:'button dark'},'确认场地'));f.onsubmit=async ev=>{ev.preventDefault();try{await command('review',{applicationId:a.id,approved:true,capacity:Number(f.elements.capacity.value)});}catch(e){errorAt(f,e);}};modal(f);}
function applicationNode(a,e,reviewControls=true,ownControls=true){const own=(e.myApplications||[]).some(x=>x.id===a.id);const mutable=!['cancelled','completed'].includes(e.status)&&Date.now()<e.rules.startsAt;const canReview=reviewControls&&mutable&&(['cohost','venue','host'].includes(a.kind)?e.isOwner:e.canManage);return el('div',{class:'application'},el('h3',{},`${kinds[a.kind]||a.kind} · ${a.title} `,badge(a.status)),el('p',{},a.detail),a.capacity?el('p',{},`容量：${a.capacity} 人`):a.kind==='venue'?el('p',{class:'muted'},'容量待确认'):null,a.address?el('p',{},`地址：${a.address}`):null,a.duration?el('p',{},`分享时长：${a.duration} 分钟`):null,a.amount?el('p',{},`赞助：€${a.amount}`):null,a.reason?el('p',{},`处理说明：${a.reason}`):null,el('div',{class:'inline-actions'},ownControls&&mutable&&own&&['pending','approved'].includes(a.status)?btn('撤回 / 退出',()=>confirmation('撤回这项申请？','撤回已通过的申请可能影响成行条件。','withdraw',{applicationId:a.id}),'button quiet'):null,canReview&&a.status==='pending'?btn('通过',()=>confirmation('通过申请？',`批准「${a.title}」，系统将重新检查成行条件。`,'review',{applicationId:a.id,approved:true})):null,canReview&&a.status==='pending'?btn('拒绝',()=>confirmation('拒绝申请','请向申请人说明原因。','review',{applicationId:a.id,approved:false},true),'button quiet'):null,mutable&&e.isOwner&&a.kind==='cohost'&&a.status==='approved'?btn('撤销协办资格',()=>confirmation('撤销批准','撤销后系统将重新检查活动条件。','revoke',{applicationId:a.id},true),'button danger'):null));}
function decisionSummary(e){
 if(e.status==='draft')return null;
 const titles={recruiting:'正在征集 · 尚未成行',confirmed:'已成行',repairing:'等待补齐',cancelled:'活动已取消',completed:'活动已结束'};
 const slots=e.rules.timeSlots||[],fixed=slots.find(s=>s.id===e.selectedSlotId)||(!slots.length?e.rules:null);
 const venues=(e.applications||[]).filter(a=>a.kind==='venue'&&a.status==='approved'),hosts=(e.conditions||[]).find(c=>c.key==='hosts'&&c.required>0),terminal=['completed','cancelled'].includes(e.status);
 const item=(name,value)=>el('div',{},el('dt',{},name),el('dd',{},value));
 const time=fixed?date(fixed.startsAt)+' — '+date(fixed.endsAt):el('div',{},el('div',{class:'decision-slot-list'},slots.slice(0,3).map(s=>el('span',{},date(s.startsAt)+'–'+date(s.endsAt,{hour:'2-digit',minute:'2-digit',month:undefined,day:undefined})))),slots.length>3?el('small',{},'另有 '+(slots.length-3)+' 个候选时段'):null,el('small',{},'候选时间，最终确认其中一场'));
 const root=el('section',{class:'event-decision decision-'+e.status,'aria-label':'当前活动决策'},el('h2',{},titles[e.status]||statusNames[e.status]),eventTags(e),el('dl',{class:'decision-facts'},item(fixed?'已确认时间':'候选时间',time),item('地点',venues.length?venues.map(v=>v.title+(v.address?' · '+v.address:'')).join('、'):e.city+' · 具体场地待确认'),item('人数',(e.counts?.joined||0)+' 人报名'+(e.counts?.waitlisted?' · '+e.counts.waitlisted+' 人候补':'')+' · '+e.rules.minPeople+'–'+e.rules.maxPeople+' 人'),hosts?item('帮忙成员','已确认 '+hosts.current+' / '+hosts.required+' 人'):null));
 if(terminal)root.append(el('p',{},e.status==='cancelled'?(e.reason||'本场活动已取消。'):'以上为活动结束时的安排。'));
 else if(e.status==='confirmed')root.append(el('p',{class:'decision-deadline'},'已满足成行条件，请按确认的时间和地点参加。'));
 else {const deadline=e.status==='repairing'&&e.repairs?.length?Math.min(...e.repairs.map(r=>r.deadline)):e.rules.recruitmentDeadline;root.append(el('p',{class:'decision-deadline'},(e.status==='repairing'?'补齐截止 · ':'成行决定 · ')+date(deadline)));}
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
  prefForm.append(el('p',{class:'form-note'},slots.length?(selectedSlot?'最终时段已确认，请确认你可以参加该时段。':'勾选所有可以参加的时段，发布者将在征集截止前确认一次最终安排。'):'请确认你可以参加已公布的活动时间。'),prefSubmit);
  prefForm.onsubmit=async ev=>{ev.preventDefault();prefSubmit.disabled=true;try{const availableSlotIds=new FormData(prefForm).getAll('availableSlotIds');if(slots.length&&!availableSlotIds.length)throw new Error('请至少选择一个可以参加的时段。');if(selectedSlot&&!availableSlotIds.includes(selectedSlot.id))throw new Error('报名需要能够参加已确认的最终时段。');await command('join',{availableSlotIds,transportPreferences:new FormData(prefForm).getAll('transportPreferences'),registrationMessage:prefForm.elements.registrationMessage.value});}catch(err){errorAt(prefForm,err);}finally{prefSubmit.disabled=false;}};
  const prefSummary=e.preferenceSummary||{times:[],places:[]};
  const replyRegistration=person=>{const form=el('form',{},el('h2',{},'回复报名留言'),el('p',{class:'registration-message'},person.registrationMessage),field('发起人回复','reply','textarea',person.registrationReply||''),el('button',{class:'button dark',type:'submit'},person.registrationReply?'更新回复':'发布回复'));form.elements.reply.maxLength=500;form.onsubmit=async ev=>{ev.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;try{await command('reply_registration',{participantId:person.participantId,reply:form.elements.reply.value});}catch(error){errorAt(form,error);}finally{submit.disabled=false;}};modal(form);};
  const participantList=people.length
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
    timeDetail.append(el('p',{class:'muted'},selectedSlot?'最终时段已确认。':'发布者须在征集截止前确认一个最终时段；确认后不可修改。'),...slots.map(s=>el('div',{class:'slot-result'},el('span',{},`${date(s.startsAt)} — ${date(s.endsAt)} · ${(prefSummary.slots||[]).find(x=>x.id===s.id)?.count||0} 人可参加`),s.id===e.selectedSlotId?el('strong',{},'已确认'):canSelectTime?btn('确认此时段',()=>confirmation('确认最终时段',`${date(s.startsAt)} — ${date(s.endsAt)}。确认后不可修改。`,'select_time',{slotId:s.id}),'button quiet'):null)));
  }
  timeDetail.append(
    el('section',{id:'detail-participants'},el('h3',{},'报名成员与留言'),participantList),
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

  app.replaceChildren(el('a',{class:'back',href:'#'},'← 所有聚会'),el('header',{class:'detail-header code-header'},el('span',{class:'eyebrow'},'COFFEE DAG / GRAPH'),el('h1',{},e.title),el('p',{class:'muted publisher'},'发布人：'+(e.publisher?.nickname||'匿名成员')),decisionSummary(e),el('div',{class:'detail-primary-actions'},badge(e.status),e.status!=='draft'?registrationButton:null,e.status!=='draft'?btn('分享活动',()=>shareEvent(e),'button share-cta'):null)),draft?el('div',{class:'draft-toolbar'},el('span',{},'草稿预览 · 仅你可见'),btn('返回编辑',()=>renderEventForm(e)),btn('发布活动',()=>publishPreview(e),'button dark'),btn('删除草稿',()=>deleteDraftDialog(e),'button danger')):document.createDocumentFragment(),el('div',{class:'dag-workspace dag-modal-workspace'},el('section',{class:'dag-graph'},el('div',{class:'dag-toolbar'},'点击节点，查看详情或办理事项 · 连线表示活动流程'),canvas,el('p',{class:'muted'},'报名 / 提议 → 发起人确认 → READY · 截止后按规则成行或取消'))));
}

function deleteDraftDialog(e){
 const content=el('div',{},el('h2',{},'删除草稿？'),el('p',{},'将删除「'+e.title+'」。删除后无法在页面恢复。'),btn('保留草稿',closeModal),btn('确认删除',async()=>{try{await api('/api/events/'+e.id,{version:e.version},'DELETE');closeModal();state.event=null;location.hash='';toast('草稿已删除');}catch(err){errorAt(content,err);}},'button danger'));modal(content);
}
function deadlineLabel(e,kind){const hours=e.rules[kind+'LeadHours'];return hours===undefined?date(e.rules[kind+'Deadline']):e.rules.timeSlots&&!e.selectedSlotId?'最终开始前 '+hours+' 小时（定下日期后自动计算）':date(e.rules[kind+'Deadline'])+'（开始前 '+hours+' 小时）';}
function publishPreview(e){const f=el('form',{},el('h2',{},'发布前，最后看一眼'),el('div',{class:'preview'},el('h3',{},e.title),el('p',{},`${e.city} · ${e.rules.timeSlots?.length?'候选时段 '+e.rules.timeSlots.length+' 个':date(e.rules.startsAt)}`),(e.rules.timeSlots||[]).map(s=>el('p',{},`${date(s.startsAt)} — ${date(s.endsAt)}`)),el('p',{class:'prose'},e.description),el('p',{},`成行最低 ${e.rules.minPeople} 人，最多 ${e.rules.maxPeople} 人`),el('p',{},`征集截止：${date(e.rules.recruitmentDeadline)}`),el('p',{},`报名截止：${deadlineLabel(e,'registration')} · 递补截止：${deadlineLabel(e,'promotion')}`),el('p',{},`场地${e.rules.venueRequired?'必需':'非必需'} · 帮忙成员 ${e.rules.minHosts}`),el('p',{},`${e.rules.waitlist?'允许候补':'不开放候补'} · ${e.rules.allowRoleOverlap?'允许角色兼任':'角色不可兼任'} · 补齐 ${e.rules.repairMinutes} 分钟`),el('p',{},`持续检查：${[['continuousVenue','场地'],['continuousTalks','分享'],['continuousCohosts','协办'],['continuousHosts','帮忙成员']].filter(([k])=>e.rules[k]).map(([,v])=>v).join('、')||'无'} · 地址${e.rules.addressVisibility==='public'?'公开':'仅参与者可见'}`)),el('p',{class:'form-note'},'发布后，人数、截止时间与其他成行规则将锁定。活动创建者不会自动报名，也不会自动成为帮忙成员。'),el('button',{type:'submit',class:'button orange'},'确认规则并发布'));f.onsubmit=async ev=>{ev.preventDefault();const b=f.querySelector('button[type=submit]');b.disabled=true;try{await command('publish');}catch(err){errorAt(f,err);}finally{b.disabled=false;}};modal(f);}
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
function slotEditor(initial){
  const slots=initial.map(s=>({...s}));
  let month=localParts(slots[0]?.startsAt||Date.now()).slice(0,7);
  const calendar=el('div',{class:'slot-calendar'}),rows=el('div',{class:'slot-editor-rows'});
  const start=el('input',{type:'time',value:slots.length?localParts(slots[0].startsAt).slice(11):'14:00','aria-label':'批量开始时间'}),duration=el('input',{type:'number',value:slots.length?(slots[0].endsAt-slots[0].startsAt)/60000:120,min:1,max:10080,step:'any','aria-label':'统一预计时长（分钟）'});
  const notice=el('p',{class:'form-note',role:'status','aria-live':'polite'},'修改上方设置会自动应用到所有已选日期，包括下方单独调整过的场次。');
  const root=el('div',{class:'slot-editor'},el('p',{class:'form-note'},'点选多个候选日期，每个日期是一场独立的 coffee chat。结束时间由开始时间和预计时长自动计算。'),el('div',{class:'slot-batch'},el('label',{},'每场开始时间 ',quarterPicker(start)),el('label',{},'预计时长（分钟） ',duration)),notice,calendar,rows);
  const minutes=control=>{const n=Number(control.value);if(!Number.isFinite(n)||n<=0||n>10080)throw new Error('预计时长须大于 0，且不超过 10080 分钟（7 天）。');return n;};
  const apply=()=>{try{const span=minutes(duration)*60000;const updated=slots.map(slot=>{const begins=amsterdamMs(localParts(slot.startsAt).slice(0,10)+'T'+start.value);return {...slot,startsAt:begins,endsAt:begins+span};});slots.splice(0,slots.length,...updated);render();notice.textContent=slots.length?'已应用到全部 '+slots.length+' 个候选日期。仍可在下方单独调整。':'已更新默认时间，接下来选择的日期将使用此设置。';}catch(e){notice.textContent=e.message;}};
  start.addEventListener('change',apply);duration.addEventListener('change',apply);
  function render(){
    const monthInput=el('input',{type:'month',value:month,'aria-label':'选择月份',onchange:ev=>{if(ev.target.value){month=ev.target.value;render();}}});
    const [year,m]=month.split('-').map(Number),days=new Date(Date.UTC(year,m,0)).getUTCDate(),offset=(new Date(Date.UTC(year,m-1,1)).getUTCDay()+6)%7;
    const grid=el('div',{class:'slot-calendar-grid'},['一','二','三','四','五','六','日'].map(d=>el('span',{class:'calendar-weekday'},d)));
    for(let i=0;i<offset;i++)grid.append(el('span'));
    for(let day=1;day<=days;day++){const d=month+'-'+String(day).padStart(2,'0');const found=slots.findIndex(s=>localParts(s.startsAt).slice(0,10)===d);const button=btn(String(day),()=>{try{if(found>=0)slots.splice(found,1);else slots.push({id:crypto.randomUUID(),startsAt:amsterdamMs(d+'T'+start.value),endsAt:amsterdamMs(d+'T'+start.value)+minutes(duration)*60000});render();}catch(e){errorAt(root,e);}},'calendar-day'+(found>=0?' selected':''));button.setAttribute('aria-pressed',String(found>=0));button.setAttribute('aria-label',d);grid.append(button);}
    calendar.replaceChildren(monthInput,grid);
    rows.replaceChildren(...slots.slice().sort((a,b)=>a.startsAt-b.startsAt).map(slot=>{
      const begin=timeField('本场开始','slot-'+slot.id+'-start',slot.startsAt);let endField=timeField('自动计算结束','slot-'+slot.id+'-end',slot.endsAt);
      endField.hidden=true;
      const span=el('input',{type:'number',min:1,max:10080,step:'any',value:(slot.endsAt-slot.startsAt)/60000,'aria-label':'本场预计时长（分钟）'}),output=el('p',{class:'muted'},'预计结束：'+date(slot.endsAt));
      const row=el('div',{class:'slot-editor-row'},el('strong',{},'候选场次 · '+localParts(slot.startsAt).slice(0,10)),begin,el('label',{class:'field'},'预计时长（分钟）',span),endField,output,btn('删除日期',()=>{slots.splice(slots.indexOf(slot),1);render();},'button quiet'));
      row.onchange=()=>{try{const begins=amsterdamMs(begin.querySelector('input[type=datetime-local]').value,begin.querySelector('.time-row > select').value),ends=begins+minutes(span)*60000;slot.startsAt=begins;slot.endsAt=ends;const nextEnd=Object.assign(timeField('自动计算结束','slot-'+slot.id+'-end',ends),{hidden:true});endField.replaceWith(nextEnd);endField=nextEnd;output.textContent='预计结束：'+date(ends);span.setCustomValidity('');root.dispatchEvent(new Event('slots-changed',{bubbles:true}));}catch(e){span.setCustomValidity(e.message);output.textContent=e.message;}};
      return row;
    }));
    if(!slots.length)rows.append(el('p',{class:'form-note'},'尚未选择日期，请点击上方日历添加。'));
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
 const stops=peopleStops,map=peopleScale;
 const fields=[el('input',{type:'hidden',name:'minPeople',value:min}),el('input',{type:'hidden',name:'maxPeople',value:max})];
 const sliders=fields.map((field,i)=>el('input',{type:'range',min:0,max:1000,step:1,value:map(+field.value,0,1)*10,'aria-label':i?'最大人数':'最低成行人数','aria-valuemin':3,'aria-valuemax':100}));
 const output=el('output',{'aria-live':'polite'}),track=el('div',{class:'people-range-track'},sliders);
 const sync=()=>{output.textContent='最低 '+fields[0].value+' 人 — 最多 '+fields[1].value+' 人';sliders.forEach((slider,i)=>{slider.value=map(+fields[i].value,0,1)*10;slider.setAttribute('aria-valuenow',fields[i].value);slider.setAttribute('aria-valuetext',fields[i].value+' 人');});track.style.setProperty('--low',map(+fields[0].value,0,1)+'%');track.style.setProperty('--high',map(+fields[1].value,0,1)+'%');};
 const update=(i,value)=>{fields[i].value=Math.max(i?+fields[0].value:3,Math.min(i?100:+fields[1].value,value));sync();fields[i].dispatchEvent(new Event('input',{bubbles:true}));};
 sliders.forEach((slider,i)=>{slider.oninput=()=>update(i,Math.round(map(+slider.value/10,1,0)));slider.onkeydown=ev=>{const delta={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-5,PageUp:5}[ev.key];if(delta!==undefined||ev.key==='Home'||ev.key==='End'){ev.preventDefault();update(i,ev.key==='Home'?3:ev.key==='End'?100:+fields[i].value+delta);}};});sync();
 const ticks=el('div',{class:'people-range-ticks','aria-hidden':'true'},stops.map(([n,position])=>el('span',{style:'left:'+position+'%'},n+' 人')));
 return el('div',{class:'people-range'},el('strong',{},'活动人数'),output,...fields,track,ticks,el('small',{class:'muted'},'小型聚会刻度更宽，方便微调。方向键每次调整 1 人。'));
}
function hostRange(value){
 const input=el('input',{type:'range',name:'minHosts',min:0,max:10,step:1,value,'aria-label':'最少帮忙成员数'}),output=el('output',{});
 const sync=()=>{output.textContent=input.value==='0'?'0 人 · 不要求帮忙成员':input.value+' 人';input.setAttribute('aria-valuetext',output.textContent);};input.oninput=sync;sync();
 return el('label',{class:'field host-range'},'最少帮忙成员数',output,input,el('small',{class:'muted'},'0 人：不作为成行条件；最多 10 人。'));
}

function renderEventForm(existing,preset){state.detailVisible=false;state.pendingEvent=null;if(!requireUser())return;const day=86400000, start=Math.ceil(Date.now()/900000)*900000+14*day;const defaults={minPeople:10,maxPeople:12,waitlist:true,recruitmentDeadline:start-2*day,startsAt:start,endsAt:start+2*3600000,registrationDeadline:start-3600000,promotionDeadline:start-3600000,repairMinutes:60,venueRequired:true,minTalks:0,minCohosts:0,minHosts:1,allowRoleOverlap:true,continuousVenue:true,continuousTalks:false,continuousCohosts:false,continuousHosts:true,addressVisibility:'public'};const r=existing?.rules||{...defaults,...preset?.rules};const editor=slotEditor(preset?r.timeSlots:existing?(r.timeSlots||[{id:crypto.randomUUID(),startsAt:r.startsAt,endsAt:r.endsAt}]):[]);const f=el('form',{class:'wide-form'},el('a',{class:'back',href:existing?`#event/${existing.id}`:'#',onclick:existing?e=>{e.preventDefault();renderDetail(existing);}:undefined},'← 返回'),el('h1',{},existing?'编辑聚会草稿':'从一个想聊的话题开始'),el('p',{class:'muted'},'先保存为草稿，再预览发布。把成行规则讲清楚，让每个人都知道自己的承诺。'));f.append(el('div',{class:'panel'},field('聚会标题','title','text',existing?.title||''),cityPicker(el,existing?.city||'Amsterdam',state.events.map(e=>e.city)),field('聚会介绍：聊什么，适合谁，如何安排','description','textarea',existing?.description||'')));if(!existing)f.insertBefore(el('div',{class:'form-note'},btn('套用周末 coffee chat 模板',()=>{const values=new FormData(f);renderEventForm(undefined,{rules:weekendCoffeeTemplate(),title:values.get('title')||'周末 coffee chat',city:values.get('city'),description:values.get('description')||'找一个周末下午，一起喝咖啡、聊聊近况。选出你方便的日期，凑齐 3–8 人就相聚。',tags:tags.read()});toast('已套用：4 个周末、8 个候选时段。请确认城市和话题，再预览发布。');},'button'),el('p',{},'未来 4 个周末 · 14:00–17:00 · 3 人起、上限 8 人 · 可候补 · 限时补齐 60 分钟 · 无需帮忙成员')),f.querySelector('.panel'));if(preset){for(const key of ['title','city','description'])if(preset[key])f.elements[key].value=preset[key];}const tags=tagPicker(existing?.tags||preset?.tags||[]);f.querySelector('.panel').append(tags.root);const leadField=(label,name,value)=>{const input=el('input',{type:'number',name,min:0,max:168,step:1,value,required:true});const choices=[2,4,12,24];const select=el('select',{'aria-label':label},choices.map(n=>el('option',{value:n,selected:value===n},'提前 '+n+' 小时')),el('option',{value:'custom',selected:!choices.includes(value)},'自定义'));input.hidden=choices.includes(value);select.onchange=()=>{input.hidden=select.value!=='custom';if(!input.hidden)input.focus();else input.value=select.value;};return el('label',{class:'field'},label,select,input,el('small',{},'距最终开始时间的小时数（0–168）'));};
const advancedTimes=el('details',{class:'advanced-times'},el('summary',{},'高级设置：报名与候补确认'),el('p',{class:'muted'},'以最终确认的开始时间倒推截止时间。候补获得名额后须本人确认，才计入参加人数。'),el('div',{class:'form-grid'},leadField('活动开始前多久停止报名','registrationLeadHours',r.registrationLeadHours??24),leadField('活动开始前多久停止候补确认','promotionLeadHours',r.promotionLeadHours??4)));

const times=el('fieldset',{},el('legend',{},'01 / 相聚时间'),el('p',{class:'muted'},'以下均为荷兰当地时间。'),el('h3',{},'1. 选择候选日期和时段'),editor.root,el('h3',{},'2. 最晚何时决定活动能否成行'),timeField('成行决定期限','recruitmentDeadline',r.recruitmentDeadline),el('p',{class:'muted'},'请在此之前确认最终时段。到期时，系统按人数、场地等条件决定是否成行。'),el('p',{class:'muted'},'报名默认在开始前 24 小时截止，候补确认默认提前 4 小时截止。最终时间确认后自动计算，可在高级设置中调整。'),advancedTimes);const rules=el('fieldset',{},el('legend',{},'02 / 固定成行条件'),el('p',{class:'muted'},'这些规则在发布后锁定。帮忙成员需本人报名并由发起人确认。'),el('div',{class:'form-grid'},peopleRange(r.minPeople,r.maxPeople),hostRange(r.minHosts),el('div',{},field('条件不足后，最多等多久（分钟）','repairMinutes','number',r.repairMinutes),el('small',{class:'muted'},'活动成行后，需补齐的条件不足时开始倒计时。补齐后继续；超时仍不足则自动取消，最迟等到活动开始。'))),repairChoice('满员后允许候补？','waitlist',r.waitlist,'是 · 可加入候补','否 · 满员后停止报名'),repairChoice('成行前必须确认足够大的场地？','venueRequired',r.venueRequired,'是 · 容量须覆盖人数上限','否 · 场地不作为成行条件'),);const continuous=el('fieldset',{},el('legend',{},'03 / 成行后，条件不足怎么办'),repairChoice('场地撤回或容量不足时，自动启动限时补齐？','continuousVenue',r.continuousVenue),repairChoice('已确认帮忙人选人数不足时，自动启动限时补齐？','continuousHosts',r.continuousHosts),el('p',{class:'form-note'},'选择「是」时，使用上方「条件不足后，最多等多久」的时长。选择「否」时，该项不足不会触发自动取消。成行前仍会检查已设定的要求。'),el('div',{},el('input',{type:'hidden',name:'addressVisibility',value:'public'}),el('p',{class:'muted'},'场地地址对所有人可见。')));const save=el('button',{class:'button dark',type:'submit'},existing?'保存草稿':'保存草稿，进入预览 →');f.append(times,rules,continuous,save);const venueNote=el('p',{class:'form-note'});const venueYes=f.querySelector('[name=venueRequired][value=yes]'),venueNo=f.querySelector('[name=venueRequired][value=no]');venueYes.closest('fieldset').append(venueNote);const syncVenue=()=>{const forced=Number(f.elements.maxPeople.value)>8;if(forced)venueYes.checked=true;venueNo.disabled=forced;venueNote.textContent=forced?'人数上限超过 8 人，成行前必须预订场地，并由发起人确认；容量须覆盖人数上限。':'8 人及以下可自行选择是否要求提前确认场地。';};f.elements.maxPeople.addEventListener('input',syncVenue);f.elements.minPeople.addEventListener('input',syncVenue);syncVenue();attachTimeValidation(f,amsterdamMs);f.addEventListener('invalid',ev=>{const details=ev.target.closest('details');if(details)details.open=true;},true);f.querySelectorAll('input[type=number]').forEach(n=>{n.min=['minTalks','minCohosts','minHosts','registrationLeadHours','promotionLeadHours'].includes(n.name)?'0':'1';n.step='1';});f.onsubmit=async ev=>{ev.preventDefault();save.disabled=true;try{const fd=new FormData(f);const rr={};for(const [k,v] of Object.entries(r)){if(['timeSlots','startsAt','endsAt','registrationDeadline','promotionDeadline','registrationLeadHours','promotionLeadHours'].includes(k))continue;if(typeof v==='boolean')rr[k]=['continuousVenue','continuousHosts','waitlist','venueRequired'].includes(k)?fd.get(k)==='yes':fd.has(k);else if(k==='recruitmentDeadline')rr[k]=amsterdamMs(fd.get(k),fd.get(k+'Offset'));else if(typeof v==='number')rr[k]=Number(fd.get(k));else rr[k]=fd.get(k);}if(rr.maxPeople>8)rr.venueRequired=true;rr.minTalks=0;rr.minCohosts=0;rr.continuousTalks=false;rr.continuousCohosts=false;rr.allowRoleOverlap=true;rr.timeSlots=editor.read();rr.startsAt=rr.timeSlots[0].startsAt;rr.endsAt=rr.timeSlots[0].endsAt;rr.registrationLeadHours=Number(fd.get('registrationLeadHours'));rr.promotionLeadHours=Number(fd.get('promotionLeadHours'));rr.registrationDeadline=rr.startsAt-rr.registrationLeadHours*3600000;rr.promotionDeadline=rr.startsAt-rr.promotionLeadHours*3600000;if(!(rr.recruitmentDeadline<rr.startsAt&&rr.startsAt<rr.endsAt))throw new Error('请确保征集截止早于开始时间，结束时间晚于开始时间。');if(['registrationDeadline','promotionDeadline'].some(k=>rr[k]<rr.recruitmentDeadline||rr[k]>rr.startsAt))throw new Error('按最早候选日期计算，报名或候补截止早于成行决定期限。请缩短提前小时数，或提前成行决定期限。');if(rr.minPeople>rr.maxPeople)throw new Error('最低人数不能超过人数上限。');const data={tags:tags.read(),title:fd.get('title').trim(),city:fd.get('city').trim(),description:fd.get('description').trim(),rules:rr};if(existing){await command('edit',data);}else{const response=await api('/api/events',data);location.hash=`event/${response.event.id}`;toast('草稿已保存，请预览并确认发布。');}}catch(err){errorAt(f,err);}finally{save.disabled=false;}};app.replaceChildren(f);window.scrollTo({top:0});}
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
