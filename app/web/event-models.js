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
 const [heat,label]=percent>=150?['hot','火爆']:percent>=100?['warm','热门']:percent>=50?['steady','渐热']:['quiet','邀你加入'];
 const scale=Math.max(200,Math.ceil(percent/100)*100),text=people+' 人报名'+(e.counts?.waitlisted?'（含 '+e.counts.waitlisted+' 人候补）':'')+' · '+percent+'%';
 return {people,capacity,percent,heat,label,scale,text};
}

export const peopleStops=[[3,0],[10,55],[20,80],[50,94],[100,100]];
export const peopleScale=(value,from,to)=>{const i=peopleStops.findIndex((point,index)=>index>0&&value<=point[from]);const [a,b]=i<0?peopleStops.slice(-2):[peopleStops[i-1],peopleStops[i]];return a[to]+(value-a[from])/(b[from]-a[from])*(b[to]-a[to]);};
