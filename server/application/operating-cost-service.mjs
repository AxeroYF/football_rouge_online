import {operatingCosts,OPERATING_RATE_VERSION} from '../../shared/config/operating-costs.mjs';
const HOUR=3600000,SCALE=1000,DENOMINATOR=HOUR*SCALE;
const valid=n=>Number.isSafeInteger(n)&&n>=0;
export class OperatingCostService{
 constructor({economy,now=Date.now,wonders=null}){this.economy=economy;this.wonders=wonders;this.activatedAt=now();}
 costs(account,world,rateVersion=OPERATING_RATE_VERSION){return operatingCosts(account,world,{discount:this.wonders?.modifiers(account).recurringExpenseMultiplier??1,rateVersion});}
 due(accounts,now){return [...accounts.values()].some(a=>a.setupComplete&&(!a.operatingCosts||now-a.operatingCosts.settledAt>=30000));}
 prepare(accounts,world,timestamp){
  if(!valid(timestamp))throw Error('运营费用结算时间无效');
  const snapshots=[];const rollback=()=>{for(const [a,b]of snapshots)for(const [key,value]of Object.entries(b)){if(value===undefined)delete a[key];else a[key]=value;}};
  try{for(const a of accounts.values()){
   if(!a.setupComplete&&!a.operatingCosts)continue;
   snapshots.push([a,{gold:a.gold,goldLedger:a.goldLedger?[...a.goldLedger]:undefined,operatingCosts:a.operatingCosts}]);
   const old=a.operatingCosts;
   if(old&&(old.schemaVersion!==1||![1,OPERATING_RATE_VERSION].includes(old.rateVersion??1)||![old.settledAt,old.remainders?.wages,old.remainders?.maintenance].every(valid)||Object.values(old.remainders).some(n=>n>=DENOMINATOR)||![old.wages,old.maintenance].every(n=>Number.isFinite(n)&&n>=0&&valid(Math.round(n*SCALE)))))throw Error('运营费用存档无效');
   // The first activation starts now, even when construction replays old boundaries.
   const end=Math.max(timestamp,old?.settledAt??this.activatedAt),elapsed=old?end-old.settledAt:0;
   // Keep R9 prices through historical construction/oil replay boundaries. The new
   // tariff begins at this process activation, never at the first old boundary.
   const migrating=old&&(old.rateVersion??1)<OPERATING_RATE_VERSION;
   const oldElapsed=migrating?Math.min(elapsed,Math.max(0,this.activatedAt-old.settledAt)):elapsed;
   const newElapsed=elapsed-oldElapsed,current=this.costs(a,world);
   const remainders={},paid={},waived={};
   for(const kind of ['wages','maintenance']){
    const work=BigInt(Math.round((old?.[kind]??0)*SCALE))*BigInt(oldElapsed)+BigInt(Math.round(current[kind]*SCALE))*BigInt(newElapsed)+BigInt(old?.remainders?.[kind]??0),due=work/BigInt(DENOMINATOR);
    if(due>BigInt(Number.MAX_SAFE_INTEGER))throw Error('运营费用累计超出安全范围');
    remainders[kind]=Number(work%BigInt(DENOMINATOR));paid[kind]=Math.min(Number(due),a.gold??0);waived[kind]=Number(due)-paid[kind];
    if(paid[kind])this.economy.adjust(a,-paid[kind],'club-'+kind);
   }
   const rateVersion=migrating&&end<this.activatedAt?1:OPERATING_RATE_VERSION;
   const future=rateVersion===OPERATING_RATE_VERSION?current:this.costs(a,world,rateVersion);
   a.operatingCosts={schemaVersion:1,rateVersion,settledAt:end,wages:future.wages,maintenance:future.maintenance,remainders,
    ...(elapsed?{lastSettlement:{from:old.settledAt,to:end,paid,waived}}:old?.lastSettlement?{lastSettlement:old.lastSettlement}:{})};
  }return {rollback};}catch(e){rollback();throw e;}
 }
}
