import {afterEach,expect,it,vi} from 'vitest';
import {api} from '../web/ui/api.js';

afterEach(()=>vi.unstubAllGlobals());
it('活动命令和助手确认使用独立幂等键，读取不携带写入参数',async()=>{
 const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({saved:true})});vi.stubGlobal('fetch',fetch);
 await expect(api('/api/events/a')).resolves.toEqual({saved:true});
 expect(fetch.mock.calls[0][1]).toEqual({method:'GET',headers:{},body:undefined});
 await api('/api/events/a/actions',{action:'join',version:3});
 await api('/api/events/a/actions',{action:'join',version:3});
 await api('/api/ai/confirm',{proposalId:'p'});
 const writes=fetch.mock.calls.slice(1).map(call=>call[1]);
 expect(new Set(writes.map(r=>r.headers['Idempotency-Key'])).size).toBe(3);
 expect(writes.every(r=>r.headers['Idempotency-Key']&&r.method==='POST')).toBe(true);
 expect(JSON.parse(writes[0].body)).toEqual({action:'join',version:3});
});
it('PATCH保留显式方法，服务与网络错误仍提供原有中文说明',async()=>{
 const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({user:{nickname:'甲'}})})
  .mockResolvedValueOnce({ok:false,status:503,json:async()=>({error:{message:'mail_not_configured'}})})
  .mockRejectedValueOnce(new Error('offline'))
  .mockResolvedValueOnce({ok:false,status:502,json:async()=>{throw new Error('html');}});
 vi.stubGlobal('fetch',fetch);
 await api('/api/me',{nickname:'甲'},'PATCH');expect(fetch.mock.calls[0][1].method).toBe('PATCH');
 await expect(api('/api/auth/request',{email:'test@example.com'})).rejects.toThrow('服务尚未配置或暂时不可用：mail_not_configured');
 await expect(api('/api/me')).rejects.toThrow('网络连接失败，请检查网络后重试。');
 await expect(api('/api/me')).rejects.toThrow('服务暂时无法响应（502），请稍后重试。');
});
