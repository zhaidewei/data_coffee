import {expect,it} from 'vitest';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
it('0008为旧pending/sending/sent补保守语义，不改正文、分组或冻结发送',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({name:'notice-upgrade',modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-09-05',d1Databases:{DB:'notice-upgrade'}}));
 try{
  const DB=await mf.getD1Database('DB');
  const migrate=async(file:string)=>{for(const sql of (await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8')).replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();};
  for(const f of ['0001_events.sql','0002_identity.sql','0006_mail_digest.sql'])await migrate(f);
  for(const [id,status,digest] of [['p','pending',null],['s','sending',null],['m','bundled','s'],['done','sent',null]])await DB.prepare('INSERT INTO outbox(id,user_id,subject,body,created_at,status,digest_id) VALUES (?,?,?,?,?,?,?)').bind(id,'member','有新的待处理申请','原始正文',123,status,digest).run();
  await DB.prepare('INSERT INTO mail_payload VALUES (?,?)').bind('s','immutable-original-json').run();
  const before=(await DB.prepare('SELECT * FROM outbox ORDER BY id').all()).results;
  await migrate('0008_outbox_notice_kind.sql');
  const after=(await DB.prepare('SELECT * FROM outbox ORDER BY id').all()).results;
  expect(after).toEqual(before.map(row=>({...row,kind:'legacy_unknown',priority:0,deliver_before:null})));
  expect((await DB.prepare('SELECT payload FROM mail_payload').first())!.payload).toBe('immutable-original-json');
 }finally{await mf.dispose();}
});
