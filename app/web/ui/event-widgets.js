import {el,btn,errorAt} from './dom.js';
import {popularity,participationSummary,localParts,amsterdamMs,peopleStops,peopleScale} from '../event-models.js';
import {date} from './display.js';

function eventTags(e){return el('div',{class:'event-tags'},(e.tags||[]).map(tag=>el('span',{},'# '+tag)));}
function eventPopularity(e){
 const {people,capacity,percent,heat,label}=popularity(e),{headline,minimum}=participationSummary(e),marker=Math.min(100,minimum/capacity*100);
 return el('div',{class:'event-progress event-popularity '+heat},el('div',{class:'popularity-heading'},el('strong',{},headline),el('span',{},label)),el('div',{class:'popularity-track'},el('progress',{max:capacity,value:Math.min(people,capacity),'aria-label':'活动人气','aria-valuetext':`${headline} · 人气 ${percent}%`}),el('span',{class:'quorum-marker',style:'left:'+marker+'%','aria-hidden':'true'})),el('small',{},`成行 ${minimum} 人 · 右侧为上限 ${capacity} 人`));
}
function conditionNode(c){return el('div',{class:`condition ${c.satisfied?'ok':''}`},el('div',{class:'condition-top'},el('span',{},c.label),el('span',{},c.satisfied?'✓ 已满足':'待补齐')),el('strong',{},`${c.current} / ${c.required}`),el('div',{class:'progress-track'},el('span',{style:`width:${c.required?Math.min(100,c.current/c.required*100):100}%`})),el('span',{class:'muted'},c.continuous?'成行后仍需持续满足':'成行时检查'));}
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

export {eventPopularity,eventTags,registrationCalendar,conditionNode,slotEditor,timeField,peopleRange,hostRange,repairChoice};
