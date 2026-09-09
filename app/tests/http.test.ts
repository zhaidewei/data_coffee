import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import worker,{body} from '../worker/index';
import type {Env} from '../worker/types';
describe('HTTP边界',()=>{
 it('health 暴露可核对的部署版本',async()=>{
   const r=await worker.fetch(new Request('https://test.invalid/api/health'),{APP_ENV:'test',APP_VERSION:'a'.repeat(40)} as Env);
   expect(await r.json()).toEqual({ok:true,environment:'test',version:'a'.repeat(40)});
 });
 it('分块请求也限制字节数',async()=>{
   const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(20000));c.enqueue(new Uint8Array(20000));c.close();}});
   const request=new Request('https://test.invalid/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'} as RequestInit);
   await expect(body(request)).rejects.toMatchObject({status:413});
 });
 it('允许完整中文介绍且拒绝非对象JSON',async()=>{
   const request=(value:unknown)=>new Request('https://test.invalid/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
   expect(await body(request({description:'中'.repeat(4000)}))).toEqual({description:'中'.repeat(4000)});
   await expect(body(request([]))).rejects.toThrow('请求格式错误');
 });
 it('跨站写入在触及身份及数据库前拒绝',async()=>{
   const r=await worker.fetch(new Request('https://test.invalid/api/events',{method:'POST',headers:{Origin:'https://evil.invalid'}}),{} as Env);
   expect(r.status).toBe(403);expect(r.headers.get('Cache-Control')).toBe('no-store');
 });
 it('API、静态资产、SPA fallback 和错误响应共用安全策略',async()=>{
   const assets={fetch:async(request:Request)=>{
     const path=new URL(request.url).pathname;
     if(path==='/styles.css')return new Response('body{}',{headers:{'Content-Type':'text/css','Cache-Control':'public, max-age=3600'}});
     if(path==='/event/example')return new Response('<!doctype html>',{headers:{'Content-Type':'text/html'}});
     return new Response('asset failure',{status:500});
   }} as Fetcher;
   const cases=[
     worker.fetch(new Request('https://test.invalid/api/health'),{ASSETS:assets,APP_ENV:'test'} as Env),
     worker.fetch(new Request('https://test.invalid/styles.css'),{ASSETS:assets} as Env),
     worker.fetch(new Request('https://test.invalid/event/example'),{ASSETS:assets} as Env),
     worker.fetch(new Request('https://test.invalid/broken.png'),{ASSETS:assets} as Env),
     worker.fetch(new Request('https://test.invalid/api/missing'),{ASSETS:assets} as Env),
   ];
   const [api,asset,fallback,assetError,apiError]=await Promise.all(cases);
   const expectedCsp=[
     "default-src 'self'",
     "base-uri 'none'",
     "connect-src 'self' https://api.pdok.nl",
     "form-action 'self'",
     "frame-ancestors 'none'",
     "img-src 'self' data: blob: https://tile.openstreetmap.org https://pub-80e888b848404fa086be09be4e975eb8.r2.dev",
     "object-src 'none'",
     "script-src 'self'",
     "style-src 'self' 'unsafe-inline'",
   ].join('; ');
   for(const response of [api,asset,fallback,assetError,apiError]){
     expect(response.headers.get('Content-Security-Policy')).toBe(expectedCsp);
     expect(response.headers.get('Permissions-Policy')).toBe('camera=(), geolocation=(), microphone=(), payment=(), usb=()');
     expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
     expect(response.headers.get('X-Frame-Options')).toBe('DENY');
   }
   expect(api.headers.get('Cache-Control')).toBe('no-store');
   expect(asset.headers.get('Cache-Control')).toBe('public, max-age=3600');
   expect(fallback.headers.get('Cache-Control')).toBeNull();
   expect(assetError.headers.get('Cache-Control')).toBe('no-store');
   expect(apiError.headers.get('Cache-Control')).toBe('no-store');
 });
 it('Cloudflare 先让所有资产请求经过 Worker',async()=>{
   const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
   expect(config.assets).toMatchObject({not_found_handling:'single-page-application',run_worker_first:true});
 });
});
