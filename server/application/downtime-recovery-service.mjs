import {DOWNTIME_RECOVERY_PLAN as PLAN} from './downtime-recovery-plan.mjs';
import {publishWorldNews} from './world-news.mjs';
const keys=['gold','oil','fans'];
const valid=value=>Number.isSafeInteger(value)&&value>=0;
export function prepareDowntimeRecovery({accounts,world,economy,now}) {
 if(!world||world.economyRecoveries?.[PLAN.planId])return {changed:false,rollback(){}};
 const matched=PLAN.players.filter(p=>accounts.has(p.accountId));
 if(!matched.length)return {changed:false,rollback(){}};
 const snapshots=[],previous={records:world.economyRecoveries,news:world.news},rows=[];
 function rollback(){for(const [a,fields]of snapshots)for(const [key,entry]of Object.entries(fields)){if(entry.exists)a[key]=entry.value;else delete a[key];}
  if(previous.records===undefined)delete world.economyRecoveries;else world.economyRecoveries=previous.records;
  if(previous.news===undefined)delete world.news;else world.news=previous.news;
 }
 try{
  for(const p of matched){
   const a=accounts.get(p.accountId),prior=a.downtimeRecoveryReceipts?.[PLAN.planId];
   if(prior){rows.push(structuredClone(prior));continue;}
   if(!a.setupComplete)throw Error('停服收益回收账号状态异常：'+p.accountId);
   snapshots.push([a,Object.fromEntries(['gold','goldLedger','oil','resources','downtimeRecoveryReceipts'].map(key=>[key,{exists:Object.hasOwn(a,key),value:structuredClone(a[key])}]))]);
   const before={gold:a.gold,oil:a.oil?.balance,fans:a.resources?.fans};
   if(!keys.every(key=>valid(before[key])&&valid(p.proposed[key])))throw Error('停服收益回收资源无效：'+p.accountId);
   const deducted=Object.fromEntries(keys.map(key=>[key,Math.min(before[key],p.proposed[key])])),after=Object.fromEntries(keys.map(key=>[key,before[key]-deducted[key]]));
   if(deducted.gold)economy.adjust(a,-deducted.gold,'downtime-recovery:20260914-20260918');
   a.oil={...a.oil,balance:after.oil};a.resources={...a.resources,fans:after.fans};
   const row={accountId:a.id,teamName:a.draft?.teamName??a.nickname??p.teamName,appliedAt:now,requested:{...p.proposed},deducted,before,after,
     waived:Object.fromEntries(keys.map(key=>[key,p.proposed[key]-deducted[key]]))};
   a.downtimeRecoveryReceipts={...a.downtimeRecoveryReceipts,[PLAN.planId]:row};rows.push(row);
  }
  const record={planId:PLAN.planId,sourceSha256:PLAN.sourceSha256,appliedAt:now,players:rows,
    missingAccountIds:PLAN.players.filter(p=>!accounts.has(p.accountId)).map(p=>p.accountId),
    totals:Object.fromEntries(keys.map(key=>[key,rows.reduce((sum,r)=>sum+r.deducted[key],0)]))};
  world.economyRecoveries={...world.economyRecoveries,[PLAN.planId]:record};
  world.news=[...(world.news??[])];publishWorldNews(world,{key:PLAN.planId,type:'economy',text:'停服收益修正已完成：回收异常金币、石油及球迷增长的一半，保留其余收益。停服暂停结算机制已启用。',createdAt:now});
  return {changed:true,record,rollback};
 }catch(error){rollback();throw error;}
}
