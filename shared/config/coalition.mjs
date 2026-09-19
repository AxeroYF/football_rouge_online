import {allianceMembers} from './diplomacy.mjs';
export const COALITION_RULES=Object.freeze({maxRoster:18});
export const coalitionPlayerId=(ownerId,playerId)=>JSON.stringify([ownerId,playerId]);
export const coalitionContributors=army=>[...new Set((army?.loans??[]).map(p=>p.ownerId))].sort();
export const coalitionMembers=(world,army)=>allianceMembers(world,army.commanderId);
export function coalitionOilShares(memberIds,total,cursor=0){
 const ids=[...new Set(memberIds)].sort();
 if(!ids.length||!Number.isSafeInteger(total)||total<0)throw Error('联军石油分摊无效');
 const base=Math.floor(total/ids.length),remainder=total%ids.length,start=((cursor%ids.length)+ids.length)%ids.length;
 return ids.map((ownerId,i)=>({ownerId,amount:base+Number((i-start+ids.length)%ids.length<remainder)}));
}
