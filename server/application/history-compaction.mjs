import {archiveFields} from '../infrastructure/history-archive.mjs';
import {createPlayerCardViewModel} from '../../shared/player-card/player-card-contract.js';
const inspected=new WeakSet();
// Replacements only: rollback never needs to duplicate the old payload.
export function prepareHistoryCompaction(c,{maxRecords=32}={}) {
 const undo=[];let visited=0;
 const replace=(owner,key,next)=>{if(owner[key]===next)return;const before=owner[key];undo.push(()=>owner[key]=before);owner[key]=next;};
 const pack=(owner,key,fields)=>{const r=owner?.[key];if(!r||r.archivedFields||inspected.has(r)||visited>=maxRecords)return;visited++;const next=archiveFields(r,fields);if(next===r)inspected.add(r);replace(owner,key,next);};
 try{
 for(const a of c.accounts.values()){
  for(let i=0;i<(a.battleHistory?.length??0);i++)pack(a.battleHistory,i,['broadcasts']);
  pack(a.elite,'lastBattle',['broadcasts']);
  for(const [key,task] of Object.entries(a.scouting?.tasks??{})){
   if(task.claimedAt==null||task.archivedFields||inspected.has(task)||visited>=maxRecords)continue;
   visited++;
   let players=task.claimedPlayers;
   if(!players){const ids=task.selectedCardIds??[task.selectedCardId],rounds=task.rounds?.length?task.rounds:[{candidates:task.candidates}];
    const cards=ids.map((id,i)=>rounds[i]?.candidates?.find(p=>p.id===id));
    if(cards.some(p=>!p))continue;players=cards.map(createPlayerCardViewModel);
   }
   const clean=task.claimedPlayers&&!(task.candidates?.length)&&!(task.rounds?.length)?task:{...task,claimedPlayers:players,candidates:[],rounds:[]};
   const next=archiveFields(clean,['claimedPlayers']);if(next===clean)inspected.add(next);replace(a.scouting.tasks,key,next);
  }
  for(const key of Object.keys(a.enhancement?.requests??{}))pack(a.enhancement.requests,key,['result']);
 }
 for(let i=0;i<(c.world?.eliteRaids?.history?.length??0);i++)pack(c.world.eliteRaids.history,i,['broadcast']);
 for(const m of Object.values(c.world?.diplomacy?.matches??{}))pack(m,'battle',['broadcasts']);
 return {changed:undo.length>0,records:undo.length,rollback(){for(const fn of undo.reverse())fn();}};
 }catch(error){for(const fn of undo.reverse())fn();throw error;}
}
