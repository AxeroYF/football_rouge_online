import {prepareHistoryCompaction} from './history-compaction.mjs';
import {pruneReceipts} from './receipt-retention.mjs';
// Reference-level journal: history values are never mutated, rollback restores exact originals.
export function maintainCampaignHistory(c,{accountLimit=20}={}) {
 const undo=[];const assign=(owner,key,value)=>{const had=Object.hasOwn(owner,key),old=owner[key];undo.push(()=>{if(had)owner[key]=old;else delete owner[key];});owner[key]=value;};
 const prune=(owner,bucket,options)=>{if(!owner)return;const shadow={...owner};if(pruneReceipts(shadow,bucket,c.now(),options)){assign(owner,bucket,shadow[bucket]);if(shadow.receiptRetention!==owner.receiptRetention)assign(owner,'receiptRetention',shadow.receiptRetention);}};
 const accounts=[...c.accounts.values()],cursor=c.historyCursor??0;
 try{
  for(let i=0;i<Math.min(accountLimit,accounts.length);i++){
   const a=accounts[(cursor+i)%accounts.length];
   for(const key of ['airportRequests','coalitionRequests','raidRequests','facilityUpgradeRequests'])prune(a,key);
   prune(a.elite,'requests');
  }
  const d=c.world?.diplomacy;
  if(d){
   prune(d,'receipts',{compound:true,limit:Math.max(256,c.accounts.size*256)});
   const requests=Object.entries(d.requests??{}),pending=requests.filter(([,r])=>r.status==='pending'&&r.expiresAt>c.now());
   const terminal=requests.filter(([,r])=>!(r.status==='pending'&&r.expiresAt>c.now())).sort((a,b)=>(b[1].resolvedAt??b[1].expiresAt??0)-(a[1].resolvedAt??a[1].expiresAt??0));
   const kept=terminal.filter(([,r])=>c.now()-(r.resolvedAt??r.expiresAt??0)<7*86400000).slice(0,Math.max(100,c.accounts.size*50));
   if(pending.length+kept.length!==requests.length)assign(d,'requests',Object.fromEntries([...pending,...kept]));
   // Keep the latest 20 completed reports for each participant, at most 40/account globally.
   const counts=new Map(),matches={},all=Object.entries(d.matches??{});
   const done=all.filter(([,m])=>m.battle).sort((a,b)=>(b[1].battle.settledAt??0)-(a[1].battle.settledAt??0));
   let changed=false;
   for(const [key,m] of all)if(!m.battle)matches[key]=m;
   for(const [key,m] of done){const ids=[m.from??m.attackerId,m.to??m.defenderId];
    if(ids.every(id=>(counts.get(id)??0)>=20)){changed=true;continue;}
    for(const id of ids)counts.set(id,(counts.get(id)??0)+1);
    const {leg,...record}=m;matches[key]=record;if(leg)changed=true;
   }
   if(changed)assign(d,'matches',matches);
  }
  const compact=prepareHistoryCompaction(c);if(compact.changed)undo.push(compact.rollback);
  if(undo.length)c.persist();
  c.historyCursor=accounts.length?(cursor+accountLimit)%accounts.length:0;
  return {changed:undo.length>0,accounts:Math.min(accountLimit,accounts.length)};
 }catch(error){for(const rollback of undo.reverse())rollback();throw error;}
}
