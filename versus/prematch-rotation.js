import {automaticSubstitutionRank} from './automatic-substitution.js';
import {v2OptimalLineupAssignment} from './public/v2-tactical-guidance.js';
import {normalizeFitnessThreshold,belowFitnessThreshold,prematchUnavailableReason} from './public/fitness-rules.js';
import {passiveEffectiveOverall} from './passive-substitution.js';

const keeperScore=p=>{
  const a=p.attributes??{};
  return (Number(a.goalkeeping??15)*.52+Number(a.reflexes??15)*.32+Number(a.positioning??15)*.16)*(.55+.45*p.state.fitness/100);
};
// Dummy candidates allow a partial assignment without reviving unavailable players.
function assign(slots,players,score){
  const candidates=[...players].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const padded=[...candidates,...slots.map((_,i)=>({id:`empty-${i}`,empty:true}))];
  return v2OptimalLineupAssignment(slots,padded,(p,s)=>p.empty?0:score(p,s))
    .filter(a=>!a.player.empty&&a.score>0);
}

export function selectPrematchLineup({slots,players,threshold=65,competition='league',quality=passiveEffectiveOverall}){
  threshold=normalizeFitnessThreshold(threshold);
  const byId=new Map(players.map(p=>[p.id,p]));
  const available=players.filter(p=>!prematchUnavailableReason(p,competition));
  const usable=new Map(available.map(p=>[p.id,p])),chosen=new Map(),notes=[];
  const fitScore=(p,s,emergency=false)=>{
    if(s.role==='GK')return p.role==='GK'||p.secondaryRole==='GK'?1e6+quality(p):emergency?1000+keeperScore(p):-1e9;
    if(p.role==='GK')return -1e9;
    const rank=automaticSubstitutionRank(s.role,p);
    return 1e8+rank*10000+quality(p);
  };
  // Lock eligible regular starters. Goalkeeper selection precedes every other hole.
  for(const slot of slots){
    const p=usable.get(slot.playerId);
    if(p&&((slot.role==='GK')===(p.role==='GK'||p.secondaryRole==='GK')))chosen.set(slot.id,{slot,player:p});
  }
  const used=()=>new Set([...chosen.values()].map(a=>a.player.id));
  for(const slot of slots.filter(s=>s.role==='GK'&&!chosen.has(s.id))){
    const keepers=available.filter(p=>p.role==='GK'||p.secondaryRole==='GK');
    const p=[...(keepers.length?keepers:available)].sort((a,b)=>
      (keepers.length?quality(b)-quality(a):keeperScore(b)-keeperScore(a))||String(a.id).localeCompare(String(b.id)))[0];
    if(!p)continue;
    for(const [key,value] of chosen)if(value.player.id===p.id)chosen.delete(key);
    chosen.set(slot.id,{slot,player:p,emergency:p.role!=='GK'&&p.secondaryRole!=='GK'});
  }
  const locked=used();
  const holes=slots.filter(s=>!chosen.has(s.id)&&s.role!=='GK');
  for(const a of assign(holes,available.filter(p=>!locked.has(p.id)),(p,s)=>fitScore(p,s)))chosen.set(a.slot.id,a);
  // Only after mandatory holes are filled may healthy, tired starters rest.
  if(competition!=='friendly'){
    const taken=used();
    const tired=[...chosen.values()].filter(a=>a.player.id===a.slot.playerId&&belowFitnessThreshold(a.player.state.fitness,threshold));
    const fresh=available.filter(p=>!taken.has(p.id)&&!belowFitnessThreshold(p.state.fitness,threshold));
    const swaps=assign(tired.map(a=>a.slot),fresh,(p,s)=>automaticSubstitutionRank(s.role,p)>0?fitScore(p,s):-1e9);
    for(const a of swaps)chosen.set(a.slot.id,a);
    for(const a of tired)if(chosen.get(a.slot.id).player.id===a.player.id)notes.push({playerId:a.player.id,reason:'没有达到红线且适配位置的替补，保留首发'});
  }
  const assignments=slots.flatMap(slot=>chosen.has(slot.id)?[chosen.get(slot.id)]:[]);
  const starterIds=new Set(assignments.map(a=>a.player.id));
  const rotations=assignments.filter(a=>a.player.id!==a.slot.playerId).map(a=>{
    const original=byId.get(a.slot.playerId);
    const unavailable=original?prematchUnavailableReason(original,competition):'原首发不可用';
    const reason=a.emergency?'门将不可用，按守门能力应急补位':unavailable??(belowFitnessThreshold(original.state.fitness,threshold)?`体能${original.state.fitness}低于红线${threshold}`:'为门将应急调整位置');
    return {outId:a.slot.playerId,outName:original?.name??'原首发',inId:a.player.id,inName:a.player.name,reason,
      emergencyGoalkeeper:Boolean(a.emergency),crossPosition:a.slot.role!=='GK'&&automaticSubstitutionRank(a.slot.role,a.player)===0};
  });
  for(const slot of slots)if(!chosen.has(slot.id))notes.push({playerId:slot.playerId,reason:`${slot.role}位置没有可用球员`});
  return {assignments,rotations,notes,substitutes:available.filter(p=>!starterIds.has(p.id))};
}
