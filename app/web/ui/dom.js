import {statusNames} from './labels.js';

const $ = (s, root = document) => root.querySelector(s);
function el(tag, props={}, ...children){const n=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='text')n.textContent=v;else if(v!==null&&v!==undefined){if(k in n)n[k]=v;else n.setAttribute(k,v);}}for(const c of children.flat(Infinity))if(c!==null&&c!==undefined)n.append(c instanceof Node?c:document.createTextNode(String(c)));return n;}
const btn=(text,fn,cls='button')=>el('button',{type:'button',class:cls,onclick:fn},text);
const badge=s=>el('span',{class:`badge ${s}`},statusNames[s]||s);
function toast(message){const n=$('#toast');n.textContent=message;n.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.style.display='none',5500);}
function errorAt(root,error){root.querySelector('.error-box')?.remove();root.append(el('div',{class:'error-box',role:'alert'},error.message||String(error)));}
function modal(content){$('#modal-content').replaceChildren(content);$('#modal').showModal();}
function closeModal(){$('#modal').close();}
function field(label,name,type='text',value='',required=true){const input=el(type==='textarea'?'textarea':'input',{name,id:name,type:type==='textarea'?undefined:type,value,required,rows:type==='textarea'?4:undefined});return el('label',{class:'field',htmlFor:name},label,input);}
function check(label,name,value=false){return el('label',{class:'check'},el('input',{type:'checkbox',name,checked:value}),label);}

export {el,modal,btn,toast,$,errorAt,field,closeModal,check,badge};
