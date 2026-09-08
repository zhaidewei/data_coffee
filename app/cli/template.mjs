import {amsterdamMs} from '../web/event-models.js';
/** Build candidate Sundays as one event; never publishes or reserves a venue. */
export function monthlyTemplate(input,now=Date.now()){
 const {month,start='13:00',durationMinutes=150}=input;
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('month 须为 YYYY-MM');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start))throw Error('start 须为 HH:mm');
 if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>10080)throw Error('时长须为 1–10080 分钟');
 const minPeople=input.minPeople??4,maxPeople=input.maxPeople??8;
 if(!Number.isInteger(minPeople)||!Number.isInteger(maxPeople)||minPeople<3||maxPeople>100||minPeople>maxPeople)throw Error('人数须满足 3 ≤ 最低人数 ≤ 上限 ≤ 100');
 if(!input.city?.trim()||!input.title?.trim())throw Error('请填写 city 和 title');
 const timeSlots=[],skipped=[];
 for(let day=1;day<=31;day++){const date=month+'-'+String(day).padStart(2,'0');const d=new Date(date+'T12:00:00Z');if(d.toISOString().slice(0,7)!==month||d.getUTCDay()!==0)continue;const startsAt=amsterdamMs(date+'T'+start);if(startsAt-25*3600000<=now){skipped.push(date);continue;}timeSlots.push({id:'sun-'+date,startsAt,endsAt:startsAt+durationMinutes*60000});}
 if(!timeSlots.length)throw Error('本月没有可征集的未来周日（至少提前 25 小时）');
 const first=timeSlots[0],recruitmentDeadline=Math.max(now+3600000,first.startsAt-2*86400000);
 return {event:{title:input.title.trim(),city:input.city.trim(),description:input.description||'',tags:input.tags||[],rules:{timeSlots,startsAt:first.startsAt,endsAt:first.endsAt,recruitmentDeadline,registrationLeadHours:24,promotionLeadHours:4,registrationDeadline:first.startsAt-24*3600000,promotionDeadline:first.startsAt-4*3600000,minPeople,maxPeople,waitlist:true,repairMinutes:60,venueRequired:maxPeople>8,minHosts:0,minTalks:0,minCohosts:0,allowRoleOverlap:true,continuousVenue:true,continuousHosts:true,continuousTalks:false,continuousCohosts:false,addressVisibility:'public'}},skippedDates:skipped};
}
