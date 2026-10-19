import type {Env} from './types';

export const MINUTE_CRON = '* * * * *';
export const MAINTENANCE_CRON = '17 * * * *';
const DAY = 86400000;
const BATCH_LIMIT = 100;

export interface CleanupResult {table:string;deleted:number;hasMore:boolean;failed:boolean}

/** Physical retention only. Request handlers continue to enforce expiry. */
export async function cleanupExpired(env:Env,now=Date.now()):Promise<CleanupResult[]> {
  const jobs = [
    {table:'ai_proposals',key:'id',column:'expires_at',cutoff:now-DAY},
    {table:'auth_sessions',key:'token_hash',column:'expires_at',cutoff:now},
    {table:'auth_codes',key:'email_hash',column:'expires_at',cutoff:now-DAY},
    {table:'auth_rate_limits',key:'key',column:'window_start',cutoff:now-DAY},
    {table:'mail_daily_budget',key:'day',column:'day',cutoff:new Date(now-7*DAY).toISOString().slice(0,10)},
  ];
  const results:CleanupResult[]=[];
  for(const {table,key,column,cutoff} of jobs){
    try{
      // Identifiers are fixed above. Recheck expiry outside the key selection,
      // so a refreshed credential/limit cannot be deleted by a stale key match.
      const result=await env.DB.prepare(`DELETE FROM ${table} WHERE ${column}<? AND ${key} IN
        (SELECT ${key} FROM ${table} WHERE ${column}<? ORDER BY ${column},${key} LIMIT ?)`)
        .bind(cutoff,cutoff,BATCH_LIMIT).run();
      const deleted=Number(result.meta.changes??0);
      // Reaching the cap means more work may remain, without an extra scan.
      results.push({table,deleted,hasMore:deleted===BATCH_LIMIT,failed:false});
    }catch{
      results.push({table,deleted:0,hasMore:false,failed:true});
    }
  }
  return results;
}
