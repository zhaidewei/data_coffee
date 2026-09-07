import {describe,it,expect} from 'vitest';
import worker,{body} from '../worker/index';
import type {Env} from '../worker/types';
describe('HTTP边界',()=>{
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
});
