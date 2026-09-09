import {$,el,btn,toast,errorAt} from './dom.js';
import {api} from './api.js';
import {actions} from './labels.js';
import {date} from './display.js';

// 页面状态与跨页面动作由入口注入；导入模块本身不注册事件。
export function createAssistant({state,requireUser,applyPendingEvent,loadEvent}) {
function closeAI(){state.aiGeneration++;state.aiReviewPending=false;$('#ai-panel').hidden=true;state.proposal=null;$('#ai-messages').replaceChildren();$('#ai-input').value='';}
function openAI(){if(!requireUser())return;$('#ai-panel').hidden=false;$('#ai-input').focus();}
$('#ai-close').onclick=()=>{closeAI();applyPendingEvent();};
$('#ai-form').onsubmit=async e=>{e.preventDefault();if(!state.event)return;const id=state.event.id;const generation=state.aiGeneration;const input=$('#ai-input');const message=input.value.trim();if(!message)return;const root=$('#ai-messages');root.append(el('div',{class:'ai-message user'},message));input.value='';const submit=$('#ai-form button');submit.disabled=true;try{const result=await api('/api/ai',{eventId:id,message});if(state.event?.id!==id||generation!==state.aiGeneration||$('#ai-panel').hidden)return;root.append(el('div',{class:'ai-message'},result.reply));root.querySelectorAll('.ai-proposal').forEach(x=>x.remove());state.proposal=null;if(result.proposal){const p=result.proposal;p.eventVersion=state.event.version;state.proposal=p;state.aiReviewPending=false;const card=el('div',{class:'ai-proposal'},el('strong',{},'等待你的确认'),el('p',{},`活动：${p.eventTitle}`),el('p',{},`操作：${actions[p.action?.action||p.action]||p.action?.action||'活动操作'}`),el('pre',{class:'prose'},typeof p.action==='object'?JSON.stringify(p.action,null,2):''),el('p',{class:'muted'},`有效至 ${date(p.expiresAt)}`));card.append(btn('确认执行',async ev=>{ev.currentTarget.disabled=true;try{if(state.proposal?.id!==p.id||state.event?.id!==id)throw new Error('活动或确认卡已变化，请重新向助手提出请求。');if(Date.now()>=p.expiresAt)throw new Error('确认卡已过期，请重新生成。');await api('/api/ai/confirm',{proposalId:p.id});state.proposal=null;card.replaceChildren(el('strong',{},'✓ 操作已完成'));await loadEvent(id);toast('助手操作已执行');}catch(err){errorAt(card,err);}finally{if(ev.target.isConnected)ev.target.disabled=false;}},'button dark'),btn('不执行',()=>{state.proposal=null;card.remove();applyPendingEvent();},'button quiet'));root.append(card);}root.scrollTop=root.scrollHeight;}catch(err){if(state.event?.id===id&&generation===state.aiGeneration)errorAt(root,err);}finally{submit.disabled=false;}};
function invalidateAIProposal(){
  if(!state.proposal)return;
  state.proposal=null;state.aiReviewPending=true;
  const card=$('#ai-messages .ai-proposal');
  if(card)card.replaceChildren(el('strong',{},'活动已更新，需要重新确认'),el('p',{},'这张确认卡已失效，尚未执行任何操作。请刷新活动后，再向助手提出请求。'),btn('查看最新活动',()=>{state.aiReviewPending=false;card.remove();applyPendingEvent();},'button dark'));
}
return {invalidateAIProposal,closeAI};
}
