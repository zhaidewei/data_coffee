import {fail} from './engine';

const CONTENT_SECURITY_POLICY=[
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob: https://pub-80e888b848404fa086be09be4e975eb8.r2.dev",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join('; ');

export function secureResponse(response:Response,noStore=false):Response{
  const headers=new Headers(response.headers);
  headers.set('Content-Security-Policy',CONTENT_SECURITY_POLICY);
  headers.set('Permissions-Policy','camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  headers.set('Referrer-Policy','same-origin');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','DENY');
  if(noStore||response.status>=400)headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

export async function body(request:Request,maxBytes=32000):Promise<Record<string,unknown>>{
  if(!request.headers.get('content-type')?.includes('application/json'))fail('请使用 JSON 请求',415);
  const reader=request.body?.getReader();if(!reader)fail('请求内容为空');
  const parts:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('请求过大',413);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  const raw=new TextDecoder().decode(bytes);
  try{const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))fail('请求格式错误');return b;}catch{fail('请求格式错误');}
}
