export function localParts(ms){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(x=>[x.type,x.value]));return`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
export function amsterdamMs(value,which){const naive=Date.parse(value+'Z');const candidates=[naive-3600000,naive-7200000].filter(t=>localParts(t)===value).sort((a,b)=>a-b);if(!candidates.length)throw new Error('所选荷兰时间不存在（可能处于夏令时切换），请选择其他时间。');return which==='late'?candidates.at(-1):candidates[0];}
export function weekendCoffeeTemplate(now=Date.now()){
 const day=86400000;let saturday=new Date(localParts(now).slice(0,10)+'T12:00:00Z');saturday.setUTCDate(saturday.getUTCDate()+(6-saturday.getUTCDay()+7)%7);
 if(amsterdamMs(saturday.toISOString().slice(0,10)+'T14:00')-25*3600000<=now)saturday.setUTCDate(saturday.getUTCDate()+7);
 const timeSlots=Array.from({length:8},(_,i)=>{const date=new Date(saturday.getTime()+(Math.floor(i/2)*7+i%2)*day).toISOString().slice(0,10);const startsAt=amsterdamMs(date+'T14:00');return {id:crypto.randomUUID(),startsAt,endsAt:startsAt+3*3600000};});
 const startsAt=timeSlots[0].startsAt;return {timeSlots,startsAt,endsAt:timeSlots[0].endsAt,recruitmentDeadline:Math.max(now+3600000,startsAt-2*day),registrationLeadHours:24,promotionLeadHours:4,minPeople:3,maxPeople:8,waitlist:true,repairMinutes:60,venueRequired:false,minHosts:0,continuousVenue:true,continuousHosts:true};
}
export function popularity(e){
 const people=(e.counts?.joined||0)+(e.counts?.waitlisted||0),capacity=e.rules.maxPeople,percent=capacity?Math.round(people/capacity*100):0;
 const [heat,label]=percent>=150?['hot','火爆']:percent>=100?['warm','热门']:percent>=50?['steady','渐热']:['quiet','刚开始'];
 const scale=Math.max(200,Math.ceil(percent/100)*100),text=people+' 人报名'+(e.counts?.waitlisted?'（含 '+e.counts.waitlisted+' 人候补）':'')+' · '+percent+'%';
 return {people,capacity,percent,heat,label,scale,text};
}

export function participationSummary(e){
 const joined=e.counts?.joined||0,waitlisted=e.counts?.waitlisted||0,minimum=e.rules.minPeople,maximum=e.rules.maxPeople;
 if(e.rules.timeSlots?.length&&!e.selectedSlotId)return {joined,waitlisted,minimum,maximum,needed:null,headline:`${joined} 人已报名 · 最终时段需 ${minimum} 人可参加`,limit:`最多 ${maximum} 人`};
 const needed=Math.max(0,minimum-joined);
 const headline=needed?`${joined} 人已报名 · 还差 ${needed} 人成行`:waitlisted?`${joined} 人已报名 · ${waitlisted} 人候补`:`${joined} 人已报名 · 已达到成行人数`;
 return {joined,waitlisted,minimum,maximum,needed,headline,limit:`最多 ${maximum} 人`};
}

export function overviewAction(e,now=Date.now()){
 if(e.status==='draft')return '查看草稿';
 const closed=['completed','cancelled','rejected'].includes(e.status)||now>=e.rules.startsAt;
 if(closed)return e.status==='completed'?'查看结果':'查看活动';
 const repairingPeople=e.repairs?.some(repair=>repair.key==='people'&&now<Math.min(repair.deadline,e.rules.startsAt));
 const registrationOpen=now<e.rules.registrationDeadline||repairingPeople;
 const capacityOpen=(e.rules.timeSlots?.length&&!e.selectedSlotId)||(e.counts?.joined||0)<e.rules.maxPeople||(e.rules.waitlist&&now<e.rules.promotionDeadline);
 return registrationOpen&&capacityOpen?'查看并报名':'查看活动';
}

export function overviewTiming(slots=[]){
 const valid=slots.filter(slot=>Number.isFinite(slot?.startsAt)&&Number.isFinite(slot?.endsAt)).sort((a,b)=>a.startsAt-b.startsAt);
 if(!valid.length)return {dates:'时间待确认',rhythm:''};
 const days=[...new Map(valid.map(slot=>{const local=localParts(slot.startsAt),day=local.slice(0,10);return [day,{day,year:+day.slice(0,4),month:+day.slice(5,7),date:+day.slice(8,10)}];})).values()];
 const first=days[0],sameYear=days.every(day=>day.year===first.year),sameMonth=days.every(day=>day.year===first.year&&day.month===first.month),shown=days.slice(0,3);
 const dates=sameMonth
  ?`${first.month}月${shown.map(day=>day.date).join('、')}日${days.length>3?`等 ${days.length} 个日期`:''}`
  :`${shown.map(day=>`${sameYear?'':day.year+'年'}${day.month}月${day.date}日`).join('、')}${days.length>3?`等 ${days.length} 个日期`:''}`;
 const signatures=valid.map(slot=>{const start=localParts(slot.startsAt),end=localParts(slot.endsAt);const day=start.slice(0,10),weekday=new Intl.DateTimeFormat('zh-CN',{timeZone:'Europe/Amsterdam',weekday:'short'}).format(new Date(slot.startsAt));return `${weekday}|${start.slice(11)}|${end.slice(11)}|${day===end.slice(0,10)}`;});
 const sameRhythm=signatures.every(signature=>signature===signatures[0]);
 const [weekday,start,end,sameDay]=signatures[0].split('|');
 const rhythm=sameRhythm&&sameDay==='true'?`${weekday} · ${start}–${end}`:`${valid.length} 个候选时段`;
 return {dates,rhythm};
}

export const peopleStops=[[3,0],[10,55],[20,80],[50,94],[100,100]];
export const peopleScale=(value,from,to)=>{const i=peopleStops.findIndex((point,index)=>index>0&&value<=point[from]);const [a,b]=i<0?peopleStops.slice(-2):[peopleStops[i-1],peopleStops[i]];return a[to]+(value-a[from])/(b[from]-a[from])*(b[to]-a[to]);};
