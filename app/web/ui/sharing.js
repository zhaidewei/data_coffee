import {cityCoffee,defaultCoffee} from '../city-coffee.js';
import {statusNames} from './labels.js';
import qrcode from '../vendor/qrcode/qrcode.mjs';
import {activityUrl} from './display.js';
import {el,modal,btn,toast,$,errorAt} from './dom.js';
import {copyPng,sharePng} from '../image-sharing.js';

function drawWrapped(ctx,text,x,y,maxWidth,lineHeight,maxLines=3){const chars=[...text];let line='',lines=[];for(const char of chars){const next=line+char;if(ctx.measureText(next).width>maxWidth&&line){lines.push(line);line=char;}else line=next;}if(line)lines.push(line);for(const [index,value] of lines.slice(0,maxLines).entries())ctx.fillText(index===maxLines-1&&lines.length>maxLines?value.slice(0,-1)+'…':value,x,y+index*lineHeight);return y+Math.min(lines.length,maxLines)*lineHeight;}
function loadImage(src){return new Promise((resolve,reject)=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=reject;image.src=src.startsWith('https://')?src+'?cors=1':src;});}
function shareFlavors(e){
  if(e.tags?.length)return e.tags.slice(0,3);
  const text=`${e.title} ${e.description||''}`;
  const topics=['数据平台','可观测性','数据工程','机器学习','人工智能','数据分析','职业发展','工作','生活','Airflow','DuckDB','Python','SQL'];
  return topics.filter(topic=>text.toLowerCase().includes(topic.toLowerCase())).slice(0,3);
}
async function shareCard(e){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),logo=await loadImage('/logo.svg');
  const coffee=await loadImage(cityCoffee(e.city)).catch(()=>loadImage(defaultCoffee)).catch(()=>null);
  const slots=e.rules.timeSlots||[],selected=slots.find(s=>s.id===e.selectedSlotId),flavors=shareFlavors(e);
  const fmt=(ms,options)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Europe/Amsterdam',...options}).format(new Date(ms));
  const days=[...new Set(slots.map(s=>fmt(s.startsAt,{year:'numeric',month:'numeric',day:'numeric'})))];
  const groups=new Map();
  for(const day of days){const [year,month,date]=day.split('/');const key=year+' 年 '+month+' 月';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(date+' 日');}
  // Lay out in CSS-sized units, then export at 3x. The same pass measures the paper height.
  function paint(draw){
    let y=60;
    const label=(value,x,baseline,size=15,color='#50627a',weight=400)=>{
      ctx.font=weight+' '+size+'px system-ui,sans-serif';ctx.textAlign='center';ctx.fillStyle=color;
      if(draw)ctx.fillText(value,x,baseline);
    };
    const wrap=(value,size,width,weight=400)=>{
      ctx.font=weight+' '+size+'px system-ui,sans-serif';
      const lines=[];let line='';
      for(const ch of value){if(line&&ctx.measureText(line+ch).width>width){lines.push(line);line=ch;}else line+=ch;}if(line)lines.push(line);return lines;
    };
    const rule=()=>{if(draw){ctx.strokeStyle='#bdc7c6';ctx.lineWidth=.8;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(45,y);ctx.lineTo(385,y);ctx.stroke();ctx.setLineDash([]);}};
    if(draw){
      ctx.strokeStyle='#00a873';ctx.lineWidth=1.8;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(132,51);ctx.lineTo(132,62);ctx.quadraticCurveTo(132,69,139,69);ctx.quadraticCurveTo(146,69,146,62);ctx.lineTo(146,51);ctx.closePath();ctx.moveTo(146,53);ctx.bezierCurveTo(155,51,155,62,146,61);ctx.moveTo(130,73);ctx.lineTo(150,73);ctx.moveTo(136,46);ctx.lineTo(136,42);ctx.moveTo(142,46);ctx.lineTo(142,42);ctx.stroke();
    }
    label('DATA COFFEE',237,65,15,'#1769c2',600);y=113;
    if(coffee){if(draw){ctx.save();ctx.beginPath();ctx.arc(345,64,27,0,Math.PI*2);ctx.clip();ctx.drawImage(coffee,coffee.width*.15,coffee.height*.15,coffee.width*.68,coffee.height*.68,318,37,54,54);ctx.restore();}}
    const title=e.title.startsWith(e.city+' ')?[e.city,...wrap(e.title.slice(e.city.length+1),30,340,700)]:wrap(e.title,30,340,700);
    for(const line of title){label(line,215,y,30,'#24364b',700);y+=39;}
    y+=8;
    if(flavors.length){label('本 场 风 味',215,y,11,'#708078');y+=25;label(flavors.join(' · '),215,y,16,'#496652',500);y+=28;}
    else y+=10;
    rule();y+=28;
    for(const [x,name,value,width] of [[99,'城市',e.city,108],[229,'成行人数',e.rules.minPeople+' 人起 · 上限 '+e.rules.maxPeople+' 人',146],[351,'活动状态',statusNames[e.status]||e.status,70]]){
      label(name,x,y,12,'#637386');
      const lines=wrap(value,14,width,500);
      lines.forEach((line,i)=>label(line,x,y+26+i*19,14,name==='活动状态'&&e.status==='recruiting'?'#078048':'#24364b',500));
    }
    y+=55;rule();y+=43;
    label(selected?fmt(selected.startsAt,{month:'long',day:'numeric',weekday:'long'}):'日期待定',215,y,28,'#1769c2',650);y+=32;
    if(selected){label(fmt(selected.startsAt,{year:'numeric'})+' · '+fmt(selected.startsAt,{hour:'2-digit',minute:'2-digit'})+'–'+fmt(selected.endsAt,{hour:'2-digit',minute:'2-digit'}),215,y,15);y+=29;label('时间已确认 · 成行状态以活动页面为准',215,y,12);y+=28;}
    else{
      for(const [month,dates] of groups){
        label(month,215,y,14);y+=27;
        for(let i=0;i<dates.length;i+=4){label(dates.slice(i,i+4).join('   /   '),215,y,19,'#50627a',500);y+=29;}
      }
      label(slots.length+' 个候选时段 · 扫码选择可参加时间',215,y,12);y+=27;
    }
    const qr=qrcode(0,'H');qr.addData(activityUrl(e));qr.make();
    const count=qr.getModuleCount(),cell= Math.max(1,Math.floor(154*3/count))/3,size=count*cell,quiet=cell*4,top=y+quiet,left=(430-size)/2;
    if(draw){ctx.fillStyle='#fff';ctx.fillRect(left-quiet,top-quiet,size+quiet*2,size+quiet*2);ctx.fillStyle='#17263a';for(let row=0;row<count;row++)for(let col=0;col<count;col++)if(qr.isDark(row,col))ctx.fillRect(left+col*cell,top+row*cell,cell,cell);const plate=size*.18,icon=plate*.72;ctx.fillStyle='#fff';ctx.fillRect(215-plate/2,top+size/2-plate/2,plate,plate);ctx.drawImage(logo,215-icon/2,top+size/2-icon/2,icon,icon);}
    y=top+size+quiet+26;label(['completed','cancelled'].includes(e.status)?'扫码查看活动':'扫码查看活动 · 报名',215,y,16,'#24364b',600);y+=24;rule();y+=26;
    label('由成员共同推进，满足成行规则后出发。',215,y,12,'#65776c');y+=21;
    label('活动安排与状态以页面最新信息为准。',215,y,12,'#65776c');
    return Math.ceil(y+48);
  }
  const height=paint(false);canvas.width=1200;canvas.height=(height-36)*3;ctx.scale(3,3);ctx.translate(-15,-12);
  ctx.fillStyle='#fffdf7';ctx.fillRect(15,12,400,height-36);ctx.fillStyle='#00b86b';ctx.fillRect(15,12,400,6);
  paint(true);
  ctx.save();ctx.globalCompositeOperation='destination-out';for(let x=15;x<415;x+=16){ctx.beginPath();ctx.moveTo(x,height-24);ctx.lineTo(x+8,height-32);ctx.lineTo(x+16,height-24);ctx.fill();}ctx.restore();
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('分享图生成失败')),'image/png'));
}
async function copyText(value){if(navigator.clipboard?.writeText)return navigator.clipboard.writeText(value);const input=el('textarea',{value});document.body.append(input);input.select();document.execCommand('copy');input.remove();}
async function shareEvent(e){
 const url=activityUrl(e),actions=el('div',{class:'share-actions'}),content=el('div',{class:'share-dialog'},el('h2',{},'分享这场活动'),el('p',{class:'muted'},'复制邀请图发给朋友，或分享活动链接。'),el('div',{class:'share-preview loading'},'正在生成分享图…'),actions);modal(content);
 try{
  const blob=await shareCard(e),objectUrl=URL.createObjectURL(blob),file=new File([blob],`data-coffee-${e.id}.png`,{type:'image/png'});
  content.querySelector('.share-preview').replaceChildren(el('img',{src:objectUrl,alt:`${e.title}活动分享图，包含二维码`}));
  const action=(label,task,cls='button')=>{const button=btn(label,async()=>{if(button.disabled)return;button.disabled=true;try{await task();}catch(error){if(error.name!=='AbortError')toast(error.message);}finally{button.disabled=false;}},cls);return button;};
  actions.append(action('复制活动链接',async()=>{await copyText(url);toast('活动链接已复制');}));
  if(navigator.clipboard?.write&&globalThis.ClipboardItem)actions.append(action('复制图片',async()=>{await copyPng(blob);toast('已复制一张邀请图');},'button dark'));
  if(navigator.share&&navigator.canShare?.({files:[file]}))actions.append(action('更多分享方式',()=>sharePng(file)));
  actions.append(el('a',{class:'button',href:objectUrl,download:file.name},'下载图片'));
  $('#modal').addEventListener('close',()=>URL.revokeObjectURL(objectUrl),{once:true});
 }catch(error){errorAt(content,error);}
}

export {shareEvent};
