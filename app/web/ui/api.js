

async function api(path, body, method){let response;try{response=await fetch(path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json',...(path.includes('/actions')||path==='/api/ai/confirm'?{'Idempotency-Key':crypto.randomUUID()}:{})}:{},body:body?JSON.stringify(body):undefined});}catch{throw new Error('网络连接失败，请检查网络后重试。');}let data;try{data=await response.json();}catch{throw new Error(`服务暂时无法响应（${response.status}），请稍后重试。`);}if(!response.ok){const detail=typeof data.error==='string'?data.error:data.error?.message||data.message||'请求失败';throw new Error(response.status===503?`服务尚未配置或暂时不可用：${detail}`:detail);}return data;}

export {api};
