

function date(ms,options={}){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Europe/Amsterdam',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',...options}).format(new Date(ms));}
function activityUrl(e){return new URL(`#event/${e.id}`,location.href).href;}
function countdown(ms){let sec=Math.floor((ms-Date.now())/1000);if(sec<=0)return'已到截止时间';const d=Math.floor(sec/86400);sec%=86400;return`${d?d+' 天 ':''}${String(Math.floor(sec/3600)).padStart(2,'0')} : ${String(Math.floor(sec%3600/60)).padStart(2,'0')} : ${String(sec%60).padStart(2,'0')}`;}
function deadlineLabel(e,kind){const hours=e.rules[kind+'LeadHours'];return hours===undefined?date(e.rules[kind+'Deadline']):e.rules.timeSlots&&!e.selectedSlotId?'最终开始前 '+hours+' 小时（定下日期后自动计算）':date(e.rules[kind+'Deadline'])+'（开始前 '+hours+' 小时）';}
function eventTimePhase(e){const now=Date.now();return [e.rules.recruitmentDeadline,e.rules.registrationDeadline,e.rules.promotionDeadline,e.rules.startsAt,e.rules.endsAt].map(t=>now>=t?'1':'0').join('');}

export {activityUrl,date,eventTimePhase,deadlineLabel,countdown};
