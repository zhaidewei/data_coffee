import {api} from './api.js';
import {el,btn,modal,errorAt,toast} from './dom.js';

const displayTime=value=>new Date(value).toLocaleString('zh-CN',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Amsterdam'});

export function openEventMessages(event){
  const path=`/api/events/${encodeURIComponent(event.id)}/messages`;
  const registrationList=el('div',{class:'member-messages registration-notes'});
  const registrationSection=el('section',{class:'registration-note-section'},el('h3',{},'报名时留言'),registrationList);
  const list=el('div',{class:'member-messages',role:'feed','aria-label':'后续留言'});
  const form=el('form',{class:'member-message-form'},el('label',{class:'field'},'给这场活动的成员留言',el('textarea',{name:'body',maxLength:500,required:true,rows:3,placeholder:'例如：我会在咖啡厅门口等大家。'})),el('button',{class:'button dark',type:'submit'},'发送留言'));
  const older=btn('查看更早留言',()=>load(false),'button quiet');older.hidden=true;
  const root=el('section',{class:'member-discussion'},el('h2',{},'消息线'),el('p',{class:'muted'},'报名留言与发起人回复公开展示；发起人回复会通知留言者。后续留言仅发起人、当前报名者和候补者可见，不发送邮件。'),registrationSection,el('h3',{},'后续留言'),list,older,form,btn('刷新留言',()=>load(true),'button quiet'));
  const messages=new Map();
  let cursor=null,busy=false,closed=false,renderedMessages='';
  const dialog=document.querySelector('#modal');
  const onClose=()=>{closed=true;clearInterval(timer);dialog.removeEventListener('close',onClose);};

  function renderRegistration(current){
    const notes=(current.participants||[]).filter(person=>person.registrationMessage).sort((a,b)=>(a.appliedAt||0)-(b.appliedAt||0));
    registrationSection.hidden=!notes.length;
    registrationList.replaceChildren(...notes.map(person=>el('article',{class:'member-message'},
      el('div',{class:'member-message-meta'},el('strong',{},person.nickname),el('span',{class:'message-source'},'报名时留言'),person.appliedAt?el('time',{},displayTime(person.appliedAt)):null),
      el('p',{},person.registrationMessage),
      person.registrationReply?el('p',{class:'registration-reply'},el('strong',{},'发起人回复：'),person.registrationReply):null)));
  }
  function renderMessages(){
    const ordered=[...messages.values()].sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id));
    const signature=JSON.stringify(ordered);
    if(signature===renderedMessages)return;
    renderedMessages=signature;
    const scrollTop=list.scrollTop;
    list.replaceChildren(...(ordered.length?ordered.map(renderMessage):[el('p',{class:'muted'},'还没有后续留言，来打个招呼吧。')]));
    list.scrollTop=scrollTop;
  }
  const renderMessage=message=>el('article',{class:'member-message'},el('div',{class:'member-message-meta'},el('strong',{},message.author),el('time',{},displayTime(message.createdAt)),message.canDelete&&message.body?btn(message.isMine?'删除':'隐藏',async()=>{try{await api(`${path}/${message.id}`,undefined,'DELETE');messages.set(message.id,{...message,body:null,canDelete:false});renderMessages();await load(true);}catch(error){errorAt(root,error);}},'button quiet'):null),el('p',{},message.body??'留言已删除'));
  async function load(latest){
    if(busy||closed)return;
    busy=true;
    try{
      const [result,detail]=await Promise.all([
        api(path+(!latest&&cursor?`?before=${encodeURIComponent(cursor)}`:'')),
        latest?api(`/api/events/${encodeURIComponent(event.id)}`).then(data=>data.event):Promise.resolve(null),
      ]);
      if(closed)return;
      if(detail)renderRegistration(detail);
      for(const message of result.messages)messages.set(message.id,message);
      renderMessages();
      if(!latest||cursor===null)cursor=result.nextCursor;
      older.hidden=!cursor;
      form.hidden=result.readOnly;
      if(result.readOnly&&!root.querySelector('.member-readonly'))root.append(el('p',{class:'muted member-readonly'},'活动已结束，留言区只读。'));
      root.querySelector('.error-box')?.remove();
    }catch(error){errorAt(root,error);}finally{busy=false;}
  }
  form.onsubmit=async input=>{
    input.preventDefault();
    const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try{await api(path,{body:form.elements.body.value});form.reset();await load(true);toast('留言已发布');}
    catch(error){errorAt(root,error);}finally{submit.disabled=false;}
  };
  renderRegistration(event);
  modal(root);
  dialog.addEventListener('close',onClose);
  const timer=setInterval(()=>{if(!document.hidden&&dialog.open)load(true);},30000);
  load(true);
}
