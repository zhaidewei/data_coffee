// Pure calendar rules shared by the browser and Worker. Keep this module free of DOM APIs.
const calendar = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'});

export function localDay(ms){const p=Object.fromEntries(calendar.formatToParts(new Date(ms)).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`;}

export function monthRange(mode,now=Date.now()) {const [year,month]=localDay(now).split('-').map(Number);const offset=mode==='next'?1:0;const start=new Date(Date.UTC(year,month-1+offset,1)),end=new Date(Date.UTC(year,month+offset,0));return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};}

export function eventSlots(event){const slots=event.rules.timeSlots||[];if(event.selectedSlotId){const selected=slots.find(s=>s.id===event.selectedSlotId);return selected?[selected]:[{startsAt:event.rules.startsAt,endsAt:event.rules.endsAt}];}return slots.length?slots:[{startsAt:event.rules.startsAt,endsAt:event.rules.endsAt}];}

export function matchesTime(event,range){if(!range)return true;return eventSlots(event).some(s=>Number.isFinite(s.startsAt)&&Number.isFinite(s.endsAt)&&localDay(s.startsAt)<=range.to&&localDay(s.endsAt-1)>=range.from);}
