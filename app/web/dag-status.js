export const dagStatusLabels={draft:'草稿',waiting:'待确认',running:'征集中',success:'已满足',repairing:'待补齐',cancelled:'已取消',optional:'可选'};
export function dagStatuses(event){
 const satisfied=key=>event.conditions?.find(c=>c.key===key)?.satisfied===true;
 const repair=key=>event.repairs?.some(r=>r.key===key);
 if(event.status==='draft')return Array(8).fill('draft');
 if(event.status==='cancelled')return Array(8).fill('cancelled');
 const venue=event.applications?.some(a=>a.kind==='venue'&&a.status==='approved')||satisfied('venue');
 const hosts=satisfied('hosts');
 const requirement=(key,required,met)=>repair(key)?'repairing':met?'success':required?'waiting':'optional';
 return ['success',repair('people')?'repairing':satisfied('people')?'success':'running',event.selectedSlotId||!event.rules.timeSlots?.length?'success':'waiting',venue?'success':'running',requirement('venue',event.rules.venueRequired,venue),hosts?'success':'running',requirement('hosts',event.rules.minHosts>0,hosts),event.status==='repairing'?'repairing':event.conditions?.every(c=>c.satisfied)?'success':'waiting'];
}
