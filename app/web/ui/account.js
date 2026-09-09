import {$,el,field,toast,closeModal,errorAt,modal,btn,check} from './dom.js';
import {api} from './api.js';
import {date} from './display.js';

// 页面状态与跨页面动作由入口注入；导入模块本身不注册事件。
export function createAccount({state,route}) {
function updateAccount(){$('#account-button .account-label').textContent=state.user?'账户':'登录';$('#account-button').title=state.user?state.user.nickname:'登录 / 注册';}
async function login(){const form=el('form',{},el('span',{class:'eyebrow'},'WELCOME TO THE TABLE'),el('h2',{},'登录 Data Coffee'),el('p',{class:'muted'},'使用邮箱验证码登录。首次登录验证成功后，再设置昵称。'),field('邮箱','email','email'));const code=field('验证码','code','text');code.hidden=true;code.querySelector('input').required=false;const submit=el('button',{class:'button dark',type:'submit'},'发送验证码');form.append(code,submit);let sent=false;form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const v=Object.fromEntries(new FormData(form));if(!sent){const r=await api('/api/auth/request',{email:v.email});sent=true;code.hidden=false;code.querySelector('input').required=true;form.elements.email.readOnly=true;submit.textContent='验证并登录';if(r.developmentCode)form.append(el('p',{class:'form-note'},`开发环境验证码：${r.developmentCode}`));else toast('验证码已发送，请检查邮箱。');code.querySelector('input').focus();}else{const r=await api('/api/auth/verify',v);state.user=r.user;updateAccount();closeModal();await route();if(!state.user.nickname)setupNickname();else toast('登录成功，欢迎回来。');}}catch(err){errorAt(form,err);}finally{submit.disabled=false;}};modal(form);}
function requireUser(){if(state.user)return true;login();return false;}
function setupNickname(){
 const f=el('form',{},el('h2',{},'邮箱已验证，留个名字吧'),el('p',{class:'muted'},'这个名字用于社区交流，之后可以在账户 → 个人资料修改。'),field('昵称','nickname','text',''),el('button',{class:'button dark',type:'submit'},'保存昵称'));
 f.onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/me',{nickname:f.elements.nickname.value},'PATCH');state.user=r.user;updateAccount();closeModal();await route();}catch(err){errorAt(f,err);}};modal(f);
}
async function downloadMyData(){
 const data=await api('/api/me/export');
 const blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=`data-coffee-${new Date(data.exportedAt).toISOString().slice(0,10)}.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);toast('个人数据已下载');
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
function account(){if(!state.user)return login();const f=el('form',{},el('h2',{},'我的社区名片'),el('p',{class:'muted'},state.user.email),field('昵称','nickname','text',state.user.nickname),check('公开显示我的昵称（关闭后，活动管理者仍可查看）','publicNickname',state.user.publicNickname),el('button',{class:'button dark',type:'submit'},'保存设置'),btn('下载我的数据',async()=>{try{await downloadMyData();}catch(e){errorAt(f,e);}},'button quiet'),btn('退出登录',async()=>{try{await api('/api/auth/logout',{});state.user=null;updateAccount();closeModal();route();}catch(e){errorAt(f,e);}},'button quiet'));f.onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/me',{nickname:f.elements.nickname.value,publicNickname:f.elements.publicNickname.checked},'PATCH');state.user=r.user;updateAccount();closeModal();toast('设置已保存');route();}catch(err){errorAt(f,err);}};modal(f);}
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
return {requireUser,updateAccount};
}
