import {fail} from './engine';

export async function body(request:Request,maxBytes=32000):Promise<Record<string,unknown>>{
  if(!request.headers.get('content-type')?.includes('application/json'))fail('请使用 JSON 请求',415);
  const reader=request.body?.getReader();if(!reader)fail('请求内容为空');
  const parts:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('请求过大',413);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  const raw=new TextDecoder().decode(bytes);
  try{const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))fail('请求格式错误');return b;}catch{fail('请求格式错误');}
}
