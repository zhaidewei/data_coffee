import {el,toast,btn} from './dom.js';
import {api} from './api.js';

function tagPicker(initial=[]){
  let chosen=[...initial],sequence=0,timer;
  const selected=el('div',{class:'tag-options'}),suggestions=el('div',{class:'tag-options'}),input=el('input',{type:'text',maxLength:20,placeholder:'搜索标签，或输入新标签','aria-label':'搜索或新建标签'});
  const root=el('fieldset',{class:'tag-picker'},el('legend',{},'本场风味 · 主题标签'),selected,input,suggestions,el('small',{class:'muted'},'最多 5 个。新标签随活动保存，所有成员均可复用。'));
  const normalize=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ');
  function add(value){const tag=normalize(value);if(!tag)return;if(tag.length>20||/[<>]/.test(tag)){toast('标签须为 1–20 字符，不含尖括号');return;}if(chosen.some(t=>t.toLowerCase()===tag.toLowerCase()))return;if(chosen.length>=5){toast('最多选择 5 个标签');return;}chosen.push(tag);input.value='';render();search();}
  function render(){selected.replaceChildren(...chosen.map(tag=>btn(tag+' ×',()=>{chosen=chosen.filter(t=>t!==tag);render();search();},'button tag-chip')));}
  async function search(){const current=++sequence;try{const data=await api('/api/tags?q='+encodeURIComponent(input.value));if(current!==sequence||!root.isConnected)return;const query=normalize(input.value),tags=data.tags.filter(t=>!chosen.some(s=>s.toLowerCase()===t.toLowerCase()));suggestions.replaceChildren(...tags.map(tag=>btn(tag,()=>add(tag),'button tag-chip')));if(query&&!data.tags.some(t=>t.toLowerCase()===query.toLowerCase())&&!chosen.some(t=>t.toLowerCase()===query.toLowerCase()))suggestions.append(btn('新建「'+query+'」',()=>add(query),'button tag-chip'));}catch{if(current===sequence)suggestions.replaceChildren(el('small',{},'标签库暂时不可用，仍可输入标签后按回车添加。'));}}
  input.addEventListener('input',()=>{++sequence;clearTimeout(timer);timer=setTimeout(search,200);});input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();add(input.value);}});
  render();setTimeout(search,0);return {root,read:()=>{const pending=normalize(input.value);if(pending){if(pending.length>20||/[\u0000-\u001f\u007f<>]/.test(pending))throw new Error('标签须为 1–20 字符，不含控制符或尖括号');if(chosen.length>=5&&!chosen.some(t=>t.toLowerCase()===pending.toLowerCase()))throw new Error('最多选择 5 个标签');add(pending);}return [...chosen];}};
}

export {tagPicker};
