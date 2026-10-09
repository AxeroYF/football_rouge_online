import crypto from 'node:crypto';
import {EconomyService} from './economy-service.mjs';
import {PVP_ATTACK_BOND_GOLD} from '../../shared/config/conquest.mjs';
const fail=message=>{throw Object.assign(Error(message),{statusCode:409});};
export function bondQuote(accounts,ids,territoryId,defenderId){
 const members=[...new Set(ids)].sort();if(!members.length)fail('进攻费用没有可分摊成员');
 const each=Math.floor(PVP_ATTACK_BOND_GOLD/members.length),extra=PVP_ATTACK_BOND_GOLD%members.length;
 return {total:PVP_ATTACK_BOND_GOLD,territoryId,defenderId,shares:members.map((id,i)=>({ownerId:id,name:accounts.get(id)?.draft?.teamName??accounts.get(id)?.nickname??id,amount:each+(i<extra?1:0),balance:Number(accounts.get(id)?.gold??0)}))};
}
function notice(account,id,text,at){if(!account)return;account.pvpNotices??=[];if(account.pvpNotices.some(n=>n.id===id))return;account.pvpNotices.push({id,text,createdAt:at});account.pvpNotices=account.pvpNotices.slice(-30);}
export function assertBondFunds(accounts,quote){
 for(const share of quote.shares)if(!accounts.get(share.ownerId)?.setupComplete||Number(accounts.get(share.ownerId).gold??0)<share.amount)fail(`${share.name}金币不足，需支付${share.amount}金币保证金`);
}
export function holdBond(world,accounts,quote,at){
 assertBondFunds(accounts,quote);
 const bond={...structuredClone(quote),id:'pvp-bond:'+crypto.randomUUID(),status:'held',createdAt:at};
 const economy=new EconomyService({now:()=>at});
 for(const s of bond.shares){const a=accounts.get(s.ownerId);economy.spend(a,s.amount,'pvp-attack-bond');notice(a,bond.id+':held','玩家领土进攻保证金已扣除 '+s.amount+' 金币；成功返还，失败转给防守方。',at);}
 world.pvpBonds??={};world.pvpBonds[bond.id]=bond;
 // Keep pending escrows; old terminal entries are only idempotency receipts.
 const done=Object.values(world.pvpBonds).filter(b=>b.status!=='held').sort((a,b)=>b.resolvedAt-a.resolvedAt);
 for(const old of done.slice(500))delete world.pvpBonds[old.id];return bond.id;
}
export function resolveBond(world,accounts,id,outcome,at,reason=''){
 const bond=world.pvpBonds?.[id];if(!bond||bond.status!=='held')return null;
 const economy=new EconomyService({now:()=>at}),defender=accounts.get(bond.defenderId);
 const lost=outcome==='loss'&&defender?.setupComplete;
 if(lost){economy.adjust(defender,bond.total,'pvp-defence-bond');notice(defender,id+':defence','防守成功，收到进攻方保证金 '+bond.total+' 金币。',at);}
 for(const s of bond.shares){const a=accounts.get(s.ownerId);if(!a?.setupComplete)continue;
  if(!lost)economy.adjust(a,s.amount,'pvp-bond-refund');
  notice(a,id+':settled',lost?`进攻失败，损失本次保证金 ${s.amount} 金币，已转给防守方；休整20分钟。`:`${reason||'进攻成功'}，退回保证金 ${s.amount} 金币。`,at);
 }
 bond.status=lost?'forfeited':'refunded';bond.resolvedAt=at;bond.reason=reason;return {bondId:id,total:bond.total,status:bond.status,shares:bond.shares.map(({ownerId,amount})=>({ownerId,amount})),defenderId:bond.defenderId};
}

export function prepareOrphanBondRefunds(world,accounts,at){
 const linked=new Set([...Object.values(world?.activeChallenges??{}).map(c=>c.attackBondId),...Object.values(world?.coalitions??{}).map(a=>a.order?.attackBondId)]);
 const orphans=Object.values(world?.pvpBonds??{}).filter(b=>b.status==='held'&&!linked.has(b.id));
 const snapshots=orphans.map(b=>[b,structuredClone(b)]),affected=[...new Set(orphans.flatMap(b=>b.shares.map(s=>accounts.get(s.ownerId))).filter(Boolean))].map(a=>[a,{gold:a.gold,goldLedger:structuredClone(a.goldLedger),pvpNotices:structuredClone(a.pvpNotices)}]);
 const rollback=()=>{for(const [b,s]of snapshots){for(const k of Object.keys(b))delete b[k];Object.assign(b,s);}for(const [a,s]of affected)for(const [k,v]of Object.entries(s)){if(v===undefined)delete a[k];else a[k]=v;}};
 try{for(const b of orphans)resolveBond(world,accounts,b.id,'refund',at,'未能开战或行动取消');}catch(e){rollback();throw e;}
 return {rollback};
}
