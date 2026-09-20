import type {Activity,Env,User} from './types';
import {fail,textValue} from './engine';
import {advance} from './store';

const member=(event:Activity,user:User)=>event.ownerId===user.id||event.participants.some(p=>p.userId===user.id&&p.status!=='left');
async function permitted(env:Env,eventId:string,user:User){
  const event=await advance(env,eventId);
  if(event.status==='draft'||!member(event,user))fail('仅本场参与者可查看成员交流',403);
  return event;
}
function writable(event:Activity){
  if(['cancelled','completed'].includes(event.status)||Date.now()>=event.rules.endsAt)fail('活动已结束，成员交流现为只读',409);
}
function validKey(key:string){
  if(!key||key.length>100||!/^[A-Za-z0-9:_-]+$/.test(key))fail('需要有效的操作幂等标识');
}
type MessageRow={id:string;author_id:string;body:string;created_at:number;deleted_at:number|null;nickname:string|null;public_nickname:number|null};
const present=(row:MessageRow,user:User,event:Activity)=>({
  id:row.id,
  author:row.author_id===user.id?'我':row.public_nickname?row.nickname||'匿名成员':'匿名成员',
  isMine:row.author_id===user.id,
  canDelete:row.author_id===user.id||event.ownerId===user.id,
  body:row.deleted_at===null?row.body:null,
  createdAt:row.created_at,
});
export async function listMessages(env:Env,eventId:string,user:User,before:string|null){
  const event=await permitted(env,eventId,user);
  let cursor:{created_at:number;id:string}|null=null;
  if(before){
    if(!/^[a-f0-9-]{36}$/.test(before))fail('分页标识无效');
    cursor=await env.DB.prepare('SELECT created_at,id FROM event_messages WHERE event_id=? AND id=?').bind(eventId,before).first<{created_at:number;id:string}>();
    if(!cursor)fail('分页标识无效');
  }
  const rows=await env.DB.prepare(`SELECT m.id,m.author_id,m.body,m.created_at,m.deleted_at,u.nickname,u.public_nickname
    FROM event_messages m LEFT JOIN users u ON u.id=m.author_id
    WHERE m.event_id=? AND (? IS NULL OR m.created_at<? OR (m.created_at=? AND m.id<?))
    ORDER BY m.created_at DESC,m.id DESC LIMIT 31`).bind(eventId,cursor?.created_at??null,cursor?.created_at??null,cursor?.created_at??null,cursor?.id??null).all<MessageRow>();
  const page=rows.results.slice(0,30);
  return {messages:page.map(row=>present(row,user,event)),nextCursor:rows.results.length>30?page.at(-1)!.id:null,readOnly:['cancelled','completed'].includes(event.status)||Date.now()>=event.rules.endsAt};
}
export async function postMessage(env:Env,eventId:string,user:User,input:Record<string,unknown>,key:string){
  validKey(key);
  const event=await permitted(env,eventId,user);
  writable(event);
  const body=textValue(input.body,'留言',500);
  const existing=await env.DB.prepare('SELECT id FROM event_messages WHERE event_id=? AND author_id=? AND idempotency_key=?').bind(eventId,user.id,key).first<{id:string}>();
  if(existing)return {id:existing.id};
  const now=Date.now(),id=crypto.randomUUID();
  try{
    // Recheck membership and activity state in the same statement that writes the
    // message. A member may leave or the activity may close after permitted().
    const inserted=await env.DB.prepare(`INSERT INTO event_messages(id,event_id,author_id,idempotency_key,body,created_at)
      SELECT ?,?,?,?,?,? FROM activities AS a
      WHERE a.id=? AND json_extract(a.document,'$.status') IN ('recruiting','confirmed','repairing')
        AND json_extract(a.document,'$.rules.endsAt')>?
        AND (json_extract(a.document,'$.ownerId')=? OR EXISTS (
          SELECT 1 FROM json_each(a.document,'$.participants') AS p
          WHERE json_extract(p.value,'$.userId')=?
            AND json_extract(p.value,'$.status') IN ('joined','waitlisted')
        ))`).bind(id,eventId,user.id,key,body,now,eventId,now,user.id,user.id).run();
    if(!inserted.meta.changes)fail('活动或成员状态已变化，请刷新后重试',409);
    return {id};
  }catch(error){
    const replay=await env.DB.prepare('SELECT id FROM event_messages WHERE event_id=? AND author_id=? AND idempotency_key=?').bind(eventId,user.id,key).first<{id:string}>();
    if(replay)return {id:replay.id};
    throw error;
  }
}
export async function deleteMessage(env:Env,eventId:string,messageId:string,user:User){
  const event=await permitted(env,eventId,user);
  const result=await env.DB.prepare(`UPDATE event_messages SET body='',deleted_at=?,deleted_by=?
    WHERE event_id=? AND id=? AND deleted_at IS NULL AND (author_id=? OR ?=?)`).bind(Date.now(),user.id,eventId,messageId,user.id,user.id,event.ownerId).run();
  if(!result.meta.changes)fail('留言不存在或无权删除',404);
  return {deleted:true};
}
