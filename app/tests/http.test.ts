import {describe,it,expect} from 'vitest';
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
     return new Response('missing',{status:404});
   }} as Fetcher;
   const cases=[
     worker.fetch(new Request('https://test.invalid/api/health'),{ASSETS:assets,APP_ENV:'test'} as Env),
     worker.fetch(new Request('https://test.invalid/styles.css'),{ASSETS:assets} as Env),
     worker.fetch(new Request('https://test.invalid/event/example'),{ASSETS:assets} as Env),
     worker.fetch(new Request('https://test.invalid/missing.png'),{ASSETS:assets} as Env),
     worker.fetch(new Request('https://test.invalid/api/missing'),{ASSETS:assets} as Env),
   ];
   const [api,asset,fallback,assetError,apiError]=await Promise.all(cases);
   for(const response of [api,asset,fallback,assetError,apiError]){
     const csp=response.headers.get('Content-Security-Policy')!;
     expect(csp).toContain("frame-ancestors 'none'");
     expect(csp).toContain("script-src 'self'");
     expect(csp).toContain("style-src 'self' 'unsafe-inline'");
     expect(csp).toContain('connect-src \'self\' https://api.pdok.nl');
     expect(csp).toContain('https://tile.openstreetmap.org');
     expect(csp).toContain('https://pub-80e888b848404fa086be09be4e975eb8.r2.dev');
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
});
