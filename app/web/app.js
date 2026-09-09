import {$,closeModal,toast,errorAt,el,btn} from './ui/dom.js';
import {monthRange} from './shared/time-rules.js';
import {countdown,eventTimePhase} from './ui/display.js';
import {api} from './ui/api.js';
import {overviewQuery} from './overview.js';
import {renderCliDocs} from './cli-docs.js';
import {createAccount} from './ui/account.js';
import {createHome} from './ui/home.js';
import {createEventDetail} from './ui/event-detail.js';
import {createEventForm} from './ui/event-form.js';
import {createAssistant} from './ui/assistant.js';

const app = $('#app');
const state = {user:null, page:1, pagination:null, overview:null, overviewLoading:false, overviewError:null, events:[], event:null, city:'全部',selectedTag:'',period:'all',from:monthRange('current').from,to:monthRange('current').to, loading:0, proposal:null, aiGeneration:0, detailVisible:false, pendingEvent:null, polling:false, aiReviewPending:false};

const {requireUser,updateAccount}=createAccount({state,route:(...args)=>route(...args)});
const {overviewRange,renderHome}=createHome({state,changeOverview:(...args)=>changeOverview(...args),loadOverview:(...args)=>loadOverview(...args),app});
const {renderDetail}=createEventDetail({command:(...args)=>command(...args),requireUser:(...args)=>requireUser(...args),state,renderEventForm:(...args)=>renderEventForm(...args),app});
const {renderEventForm}=createEventForm({state,requireUser:(...args)=>requireUser(...args),renderDetail:(...args)=>renderDetail(...args),command:(...args)=>command(...args),app});
const {invalidateAIProposal,closeAI}=createAssistant({state,requireUser:(...args)=>requireUser(...args),applyPendingEvent:(...args)=>applyPendingEvent(...args),loadEvent:(...args)=>loadEvent(...args)});

setInterval(()=>document.querySelectorAll('[data-countdown]').forEach(n=>n.textContent=countdown(Number(n.dataset.countdown))),1000);
$('.modal-close').onclick=closeModal;
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
$('#create-button').onclick=()=>{if(requireUser())location.hash='new';};
async function command(action,extra={}){if(!requireUser())return;const id=state.event.id;const r=await api(`/api/events/${id}/actions`,{action,version:state.event.version,...extra});closeModal();toast('操作已保存');if(state.event?.id===id)await loadEvent(id);return r;}
function run(action,extra={},node){return command(action,extra).catch(e=>node?errorAt(node,e):toast(e.message));}
async function loadEvent(id){const token=++state.loading;try{const r=await api(`/api/events/${encodeURIComponent(id)}`);if(token!==state.loading)return;const e=r.event;for(const k of ['canManage','isOwner','myParticipation','myApplications','conditions','counts','participants','applications','receipts','preferenceSummary'])if(r[k]!==undefined)e[k]=r[k];if(state.event?.id===e.id&&state.event.version!==e.version)invalidateAIProposal();state.event=e;renderDetail(e);}catch(err){if(token!==state.loading)return;app.replaceChildren(el('a',{class:'back',href:'#'},'← 返回聚会列表'));errorAt(app,err);app.append(btn('重试',()=>loadEvent(id)));}}
function changeOverview(){state.page=1;return loadOverview();}
async function loadOverview(){
 const token=++state.loading,range=overviewRange();state.overviewError=null;
 if(range&&(!range.from||!range.to||range.from>range.to)){state.overviewLoading=false;state.events=[];renderHome();return;}
 state.overviewLoading=true;renderHome();
 try{const r=await api('/api/events?'+overviewQuery(state,range));if(token!==state.loading)return;
 state.events=r.events||[];state.pagination=r.pagination;state.page=r.pagination.page;state.overview=r.overview;state.overviewLoading=false;
 if(r.user!==undefined){state.user=r.user?{...state.user,...r.user}:null;updateAccount();}renderHome();
 }catch(err){if(token!==state.loading)return;state.overviewLoading=false;state.events=[];state.overviewError=err.message;renderHome();}
}
function updateNavigation(){
 const path=location.hash.slice(1);
 const active=path==='new'?'create-button':path==='cli'||path.startsWith('cli/')?'docs-link':'nav-explore';
 document.querySelectorAll('.workspace-nav nav > a,.workspace-nav nav > button').forEach(item=>{
  if(item.id===active||item.classList.contains(active))item.setAttribute('aria-current','page');
  else item.removeAttribute('aria-current');
 });
}
async function route(){updateNavigation();state.detailVisible=false;state.pendingEvent=null;const path=location.hash.slice(1);const previous=state.event?.id;const id=path.startsWith('event/')?path.slice(6):null;if(id!==previous)closeAI();if(path==='cli'||path.startsWith('cli/')){state.loading++;state.event=null;renderCliDocs(app);return;}if(path==='new'){state.loading++;state.event=null;renderEventForm();return;}app.replaceChildren(el('div',{class:'loading',role:'status'},'正在准备这张咖啡桌…'));if(id)return loadEvent(id);state.event=null;await loadOverview();}
function detailCanRefresh(){
  return state.detailVisible&&!document.hidden&&!$('#modal').open&&!state.proposal&&!state.aiReviewPending&&!$('#ai-form button').disabled&&!document.activeElement?.matches('input,textarea,select')&&!$('#app form');
}
function applyPendingEvent(){
  if(!state.pendingEvent||!detailCanRefresh())return;
  const next=state.pendingEvent;
  if(state.event?.id!==next.id||location.hash!=='#event/'+next.id){state.pendingEvent=null;return;}
  if(next.version<state.event.version){state.pendingEvent=null;return;}
  const openDetails=[...document.querySelectorAll('#app details[id][open]')].map(n=>n.id);
  const pinnedNodes=[...document.querySelectorAll('#app .code-node.pinned[data-flow-key]')].map(n=>n.dataset.flowKey);
  state.event=next;renderDetail(next);
  for(const id of openDetails){const detail=document.getElementById(id);if(detail)detail.open=true;}
  for(const key of pinnedNodes){const node=[...document.querySelectorAll('#app .code-node[data-flow-key]')].find(n=>n.dataset.flowKey===key);if(node){node.classList.add('pinned');node.querySelector('.flow-trigger')?.setAttribute('aria-expanded','true');}}
  toast('活动状态已更新');
}
async function pollDetail(){
  if(document.hidden||state.polling||!state.detailVisible||!state.event||location.hash!=='#event/'+state.event.id)return;
  applyPendingEvent();
  const id=state.event.id,token=state.loading;
  state.polling=true;
  try{
    const result=await api('/api/events/'+encodeURIComponent(id));
    if(token!==state.loading||!state.detailVisible||state.event?.id!==id||location.hash!=='#event/'+id)return;
    const next=result.event;
    for(const k of ['canManage','isOwner','myParticipation','myApplications','conditions','counts','participants','applications','receipts','preferenceSummary'])if(result[k]!==undefined)next[k]=result[k];
    if(next.version!==state.event.version||eventTimePhase(next)!==state.renderedPhase){state.pendingEvent=next;if(next.version!==state.event.version)invalidateAIProposal();applyPendingEvent();}
    $('#refresh-error')?.remove();
  }catch(error){
    if(state.event?.id===id&&state.detailVisible&&!$('#refresh-error')){
      const notice=el('div',{id:'refresh-error',class:'error-box',role:'status'},'自动更新暂时失败，当前显示的是上次读取的状态。'+error.message,btn('重试',pollDetail,'button quiet'));
      $('.detail-header')?.append(notice);
    }
  }finally{state.polling=false;}
}
setInterval(pollDetail,30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollDetail();});
$('#modal').addEventListener('close',applyPendingEvent);
document.addEventListener('focusout',()=>setTimeout(applyPendingEvent,0));
// Keep the overview reading position while visiting an activity or another page.
let overviewScrollY=0,navigationGeneration=0,restoringOverview=false;
const atOverview=()=>!location.hash||location.hash==='#';
history.scrollRestoration='manual';
window.addEventListener('scroll',()=>{
  if(atOverview()&&!restoringOverview&&app.querySelector('.overview'))overviewScrollY=window.scrollY;
},{passive:true});
document.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href]');
  if(atOverview()&&app.querySelector('.overview')&&link?.hash){
    overviewScrollY=window.scrollY;
  }
},true);
window.addEventListener('hashchange',async()=>{
  const generation=++navigationGeneration,returning=atOverview();
  restoringOverview=true;
  await route();
  // Map mounting is scheduled on the first frame; restore after its container exists.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(generation!==navigationGeneration)return;
    window.scrollTo({top:returning?overviewScrollY:0,behavior:'instant'});
    restoringOverview=false;
  }));
});
(async()=>{try{const r=await api('/api/me');state.user=r.user;updateAccount();}catch(e){toast(e.message);}await route();})();
