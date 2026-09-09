import type {Env} from './types';

export type CronPhase = 'tick' | 'mail';

export class CronBudgetExceeded extends Error {
  constructor(public readonly phase:CronPhase){super(`cron_${phase}_budget_exhausted`);}
}

export interface CronBudgetSnapshot {
  d1:{limit:number;used:number;tick:number;mail:number;mailReserve:number};
  work:{limit:number;used:number;tick:number;mail:number;mailReserve:number};
}

/** One invocation-wide ledger. Tick may not spend the capacity reserved for mail. */
export class CronBudget {
  private readonly d1Used:Record<CronPhase,number>={tick:0,mail:0};
  private readonly workUsed:Record<CronPhase,number>={tick:0,mail:0};
  constructor(
    readonly d1Limit=50,
    readonly workLimit=12,
    readonly mailD1Reserve=20,
    readonly mailWorkReserve=4,
  ){}
  remainingD1(phase:CronPhase):number{
    const ceiling=phase==='tick'?this.d1Limit-this.mailD1Reserve:this.d1Limit;
    return Math.max(0,ceiling-this.d1Used.tick-this.d1Used.mail);
  }
  remainingWork(phase:CronPhase):number{
    const ceiling=phase==='tick'?this.workLimit-this.mailWorkReserve:this.workLimit;
    return Math.max(0,ceiling-this.workUsed.tick-this.workUsed.mail);
  }
  takeWork(phase:CronPhase):void{
    if(this.remainingWork(phase)<1)throw new CronBudgetExceeded(phase);
    this.workUsed[phase]++;
  }
  recordWork(phase:CronPhase,count:number):void{
    if(count<0||count>this.remainingWork(phase))throw new CronBudgetExceeded(phase);
    this.workUsed[phase]+=count;
  }
  env(env:Env,phase:CronPhase):Env{
    const budget=this;
    const DB=new Proxy(env.DB,{get(target,key){
      if(key==='prepare')return(sql:string)=>{
        if(budget.remainingD1(phase)<1)throw new CronBudgetExceeded(phase);
        budget.d1Used[phase]++;
        return target.prepare(sql);
      };
      const value=Reflect.get(target,key);
      return typeof value==='function'?value.bind(target):value;
    }});
    return {...env,DB};
  }
  snapshot():CronBudgetSnapshot{
    const d1=this.d1Used.tick+this.d1Used.mail,work=this.workUsed.tick+this.workUsed.mail;
    return {d1:{limit:this.d1Limit,used:d1,tick:this.d1Used.tick,mail:this.d1Used.mail,mailReserve:this.mailD1Reserve},work:{limit:this.workLimit,used:work,tick:this.workUsed.tick,mail:this.workUsed.mail,mailReserve:this.mailWorkReserve}};
  }
}
