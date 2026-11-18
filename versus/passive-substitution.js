import {automaticSubstitutionRank} from './automatic-substitution.js';
import {resolveV2PlayerDuty} from './v2/player-duties-v2.js';
import {MINIMUM_MATCH_FITNESS} from './public/fitness-rules.js';

export const PASSIVE_SUBSTITUTION_LIMIT = 5;
export const MINIMUM_SUBSTITUTE_FITNESS = MINIMUM_MATCH_FITNESS;
export const PASSIVE_FAILURE_LABELS = Object.freeze({
  disabled:'本场已关闭换人', limit:'5 个换人名额已用完',
  noEligibleSubstitute:'替补席没有健康且未登场的可用球员',
  noPositionMatch:'替补席没有符合位置要求的球员',
  lowFitness:'符合位置要求的替补体能均低于 45',
  noOutfieldPlayer:'场上没有可换下的外场球员',
});
const role = player => player.assignedRole ?? player.role;
const active = team => team.players.filter(p=>p.active && !p.injury && !p.sentOff);
export const passiveFitness = player => Math.max(0,Math.min(100,Number(player.state?.fitness ?? 100)));
export const passiveEffectiveOverall = player => Number(player.overall ?? 0) * (.55 + .45 * passiveFitness(player)/100);
export function comparePassiveSubstitutes(targetRole,a,b){
  return automaticSubstitutionRank(targetRole,b)-automaticSubstitutionRank(targetRole,a)
    || passiveEffectiveOverall(b)-passiveEffectiveOverall(a)
    || passiveFitness(b)-passiveFitness(a)
    || Number(b.overall??0)-Number(a.overall??0) || String(a.id).localeCompare(String(b.id));
}
function replacementChoice(match,team,targetRole){
  if(!match.parameters.state.substitutionsEnabled)return {failureReason:'disabled'};
  if(Number(team.stats.substitutions??0)>=PASSIVE_SUBSTITUTION_LIMIT)return {failureReason:'limit'};
  const eligible=team.players.filter(p=>p.active===false&&!p.injury&&!p.sentOff&&!p.substitutedOut);
  if(!eligible.length)return {failureReason:'noEligibleSubstitute'};
  const fitting=eligible.filter(p=>automaticSubstitutionRank(targetRole,p)>0);
  if(!fitting.length)return {failureReason:'noPositionMatch'};
  const ready=fitting.filter(p=>passiveFitness(p)>=MINIMUM_SUBSTITUTE_FITNESS);
  if(!ready.length)return {failureReason:'lowFitness'};
  return {incoming:ready.sort((a,b)=>comparePassiveSubstitutes(targetRole,a,b))[0]};
}
const rating = p => Math.max(4,Math.min(10,6.5+Number(p.matchStats?.goals??0)*.8+Number(p.matchStats?.assists??0)*.5+Number(p.matchStats?.saves??0)*.12-Number(p.matchStats?.redCards??0)*1.5));
function sacrifice(team){
  const players=active(team).filter(p=>role(p)!=='GK');
  const centerBacks=players.filter(p=>role(p)==='CB');
  // Keep two centre-backs when another outfield player can make way.
  const pool=centerBacks.length>2?centerBacks:players.filter(p=>role(p)!=='CB');
  return (pool.length?pool:players).sort((a,b)=>rating(a)-rating(b)||passiveEffectiveOverall(a)-passiveEffectiveOverall(b)||String(a.id).localeCompare(String(b.id)))[0];
}
function keeperAbility(player){
  const a=player.attributes??{};
  return (Number(a.goalkeeping??15)*.52+Number(a.reflexes??15)*.32+Number(a.positioning??15)*.16)*(.55+.45*passiveFitness(player)/100);
}
function transferSlot(match,team,source,incoming,removed=[]){
  const assignedRole=role(source),fallback=source.boardPosition??{x:50,y:assignedRole==='GK'?90:50};
  const erased=new Set([source.id,...removed.map(p=>p.id)]);
  for(const positions of [team.positions,...Object.values(team.positionPresets??{})]){
    if(!positions)continue;
    const destination=structuredClone(positions[source.id]??fallback);
    for(const id of erased)delete positions[id];
    if(incoming)positions[incoming.id]=destination;
  }
  for(const plan of [team,...Object.values(team.tacticalPlans??{}),team.openingPlan]){
    if(!plan)continue;
    plan.playerDuties??={};
    const duty=resolveV2PlayerDuty(assignedRole,plan.playerDuties[source.id]??source.tacticalDuty);
    for(const id of erased)delete plan.playerDuties[id];
    if(incoming)plan.playerDuties[incoming.id]=duty;
  }
  team.structureRoles??={};
  for(const id of erased)delete team.structureRoles[id];
  if(incoming){
    incoming.assignedRole=assignedRole;
    incoming.tacticalDuty=resolveV2PlayerDuty(assignedRole,source.tacticalDuty);
    incoming.boardPosition=structuredClone(team.positions?.[incoming.id]??fallback);
    team.structureRoles[incoming.id]=assignedRole;
  }
  const flow=match.flowState,shape=flow?.shapes?.[team.index];
  if(shape){
    const destination=structuredClone(shape[source.id]??fallback);
    for(const id of erased)delete shape[id];
    if(incoming)shape[incoming.id]=destination;
  }
  // Player IDs can be shared by the two independent club rosters.
  if(flow?.owner===team.index&&erased.has(flow.carrierId))flow.carrierId=null;
}

export function applyPassivePlayerExit(match,team,departed,cause){
  if(!departed || departed.active || departed.passiveExitResolution
    || (cause==='injury'?!departed.injury||departed.sentOff:cause!=='red'||!departed.sentOff))return {status:'ignored'};
  const goalkeeper=role(departed)==='GK';
  let result={status:'shortHanded',cause};
  if(cause==='injury'||goalkeeper){
    const choice=replacementChoice(match,team,role(departed));
    const outgoing=cause==='red'?sacrifice(team):departed;
    if(choice.incoming&&outgoing){
      const incoming=choice.incoming;
      transferSlot(match,team,departed,incoming,cause==='red'?[outgoing]:[]);
      outgoing.active=false;outgoing.substitutedOut=true;
      incoming.active=true;incoming.enteredAsSubstitute=true;incoming.substitutedForId=outgoing.id;
      if(goalkeeper)incoming.emergencyGoalkeeper=true;
      team.stats.substitutions=Number(team.stats.substitutions??0)+1;
      result={status:'substituted',cause,incoming,outgoing};
    }else{
      result.failureReason=choice.failureReason??'noOutfieldPlayer';
      if(goalkeeper){
        const candidates=active(team);
        const existing=candidates.find(p=>role(p)==='GK');
        const emergency=existing??candidates.sort((a,b)=>keeperAbility(b)-keeperAbility(a)||passiveFitness(b)-passiveFitness(a)||String(a.id).localeCompare(String(b.id)))[0];
        if(emergency){
          transferSlot(match,team,departed,emergency,[emergency]);
          emergency.emergencyGoalkeeper=true;
          result.status='emergencyGoalkeeper';result.emergencyGoalkeeper=emergency;
        }else transferSlot(match,team,departed,null);
      }else transferSlot(match,team,departed,null);
    }
  }else transferSlot(match,team,departed,null);
  departed.passiveExitResolution={status:result.status,cause,failureReason:result.failureReason??null,incomingId:result.incoming?.id??null,emergencyGoalkeeperId:result.emergencyGoalkeeper?.id??null};
  return result;
}
