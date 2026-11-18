import {selectPrematchLineup} from '../prematch-rotation.js';
import {effectivePrematchFitness} from '../public/fitness-rules.js';
import {inferElevenBoardRoles} from '../public/formation-rules.js';
import {resolvePositionPresetLinks} from '../public/position-preset-links.js';
import {normalizeCaptainStyle} from '../public/captain-rules.js';
import {applyS4Enhancement,s4EffectiveOverall} from '../s4-balance.js';
import {evaluateS4LineupBonds,applyS4BondBonuses} from '../public/bond-rules.js';
import {planAiClub} from '../ai-clubs.js';
import {roleGroup,playerOverallFromAttributes} from '../../shared/football/schema.js';

const clone=value=>structuredClone(value);
const attributeSettings=Object.freeze({unlocked:false,overflowRate:0,baseMaximum:99});
function competitionTeam(source,competition){
  const team=clone(source),scheme=team.humanOwned?team.lineupSchemes?.find(s=>s.id===team.lineupSchemeAssignments?.[competition]):null;
  if(!scheme)return team;
  team.activeLineupSchemeId=scheme.id;
  const linked={...scheme,...resolvePositionPresetLinks(scheme)};
  for(const key of ['preferredStarterIds','positionPresets','positionPresetOverrides','formationLinePresets'])team[key]=clone(linked[key]??(key==='preferredStarterIds'?[]:{}));
  team.positions=clone(linked.positions??team.positionPresets.position1??{});
  for(const key of ['tactic','style','attackFocus','defenseFocus','fitnessThreshold','tacticalPlans'])team[key]=clone(linked[key]??team[key]);
  team.captainId=linked.captainId??null;team.captainStyle=normalizeCaptainStyle(linked.captainStyle);return team;
}
function chemistryPlayers(team,players,positions,roles){
  const values=new Map();
  const add=(id,n)=>values.set(id,[...(values.get(id)??[]),n]);
  for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++){
    const a=players[i],b=players[j],pa=positions[a.id],pb=positions[b.id],group=roleGroup(roles[a.id]);
    if(!pa||!pb||group==='GK'||group!==roleGroup(roles[b.id])||Math.abs(pa.y-pb.y)>12||Math.hypot(pa.x-pb.x,pa.y-pb.y)>36)continue;
    const relation=team.humanOwned?team.chemistry?.[[a.id,b.id].sort().join('::')]:null;
    if(Number(relation?.value??0)>=30)for(const id of [a.id,b.id])add(id,Number(relation.value));
    const trait=[a,b].flatMap(p=>p.traitDefinitions??[]).flatMap(t=>t.rules??[]).find(r=>r.hook==='chemistry'&&r.linkNearby);
    if(trait)for(const id of [a.id,b.id])add(id,Number(trait.value??100));
  }
  return players.map(p=>{
    const ns=values.get(p.id)??[],bonus=ns.length?Math.min(.015,ns.reduce((a,b)=>a+b,0)/ns.length/100*.015):0;
    const attributes=Object.fromEntries(Object.entries(p.attributes).map(([key,n])=>[key,Math.min(99,Number((n*(1+bonus)).toFixed(2)))]));
    return {...p,attributes,ydlBondBaseAttributes:clone(attributes),leagueChemistryBonus:bonus};
  });
}

export function prepareSourceTeam(snapshot,teamId,{competition='league',bannedPlayerIds=[],opponentStyle=null}={}){
  if(!['league','cup','season-final','friendly'].includes(competition))throw new Error('未知赛事');
  const source=snapshot.teams.find(t=>t.id===teamId);if(!source)throw new Error('来源球队不存在');
  const team=competitionTeam(source,competition),bans=new Set(bannedPlayerIds);
  const roster=team.roster.map(source=>{
    let p=clone(source);
    if(p.xPlayer){if(!p.xConfig?.attributes||!p.xConfig.role)throw new Error('X球员配置缺失');p={...p,...clone(p.xConfig)};p.overall=playerOverallFromAttributes(p.attributes,p.role);}
    const fixed=(p.traitDefinitions??[]).flatMap(t=>t.rules??[]).filter(r=>r.hook==='fixedFitness').reduce((n,r)=>Math.max(n,Number(r.value)||0),0)||null;
    const state=clone(team.playerState?.[p.id]??{});
    return {...p,traits:[...(p.card?.traitIds??[])],blockedReason:bans.has(p.id)?'赛事禁用':state.rosterOverlimitLocked?'名单超限锁定':null,
      state:{...state,fitness:effectivePrematchFitness(state,competition,fixed)}};
  });
  let selection;
  if(!team.humanOwned&&team.aiClub){selection=planAiClub(team,roster,{competition,bannedPlayerIds,opponentStyle});Object.assign(team,selection.configuration);}
  else if(team.humanOwned){
    const desired=team.preferredStarterIds.slice(0,11),preset=team.tacticalPlans?.opening?.positionPreset??'position1';
    const board=team.positionPresets?.[preset]??team.positions;
    const roles=inferElevenBoardRoles(desired.map(id=>({id,position:board[id]})),team.formationLinePresets?.[preset]);
    const chosen=selectPrematchLineup({slots:desired.map(id=>({id,playerId:id,role:roles[id]??roster.find(p=>p.id===id)?.role,position:board[id]})),players:roster,threshold:team.fitnessThreshold,competition,
      quality:p=>s4EffectiveOverall(p,p.card?.upgradeLevel??0)*(.55+.45*p.state.fitness/100)});
    selection={lineup:chosen.assignments.map(({player,slot,emergency})=>({...player,assignedRole:slot.role,lineupSlotId:slot.playerId,emergencyGoalkeeper:Boolean(emergency)})),substitutes:chosen.substitutes,rotations:chosen.rotations,rotationNotes:chosen.notes};
  }else throw new Error('未配置的旧式AI球队不能静默生成替代名单');
  if(selection.lineup.length!==11)throw new Error('可用球员不足十一人，不能恢复伤停球员补齐');
  const positionPresets=Object.fromEntries(['position1','position2','position3'].map(key=>{
    const saved=team.positionPresets?.[key]??team.positions;
    return [key,Object.fromEntries(selection.lineup.map(p=>{
      const position=saved?.[p.lineupSlotId??p.id];if(!position)throw new Error(`缺少站位：${key}/${p.id}`);
      return [p.id,clone(position)];
    }))];
  }));
  const preset=team.tacticalPlans?.opening?.positionPreset??'position1',positions=positionPresets[preset];
  const enhance=p=>applyS4Enhancement(p,p.card?.upgradeLevel??0,{attributeSettings});
  const roles=inferElevenBoardRoles(selection.lineup.map(p=>({id:p.id,position:positions[p.id]})),team.formationLinePresets?.[preset]);
  const starters=chemistryPlayers(team,selection.lineup.map(enhance),positions,roles);
  const bonds=evaluateS4LineupBonds(starters,snapshot.bondCatalog,{roles});
  const plans=clone(team.tacticalPlans);
  for(const plan of Object.values(plans??{}))for(const rotation of selection.rotations??[])if(plan.playerDuties?.[rotation.outId]&&!plan.playerDuties?.[rotation.inId])plan.playerDuties[rotation.inId]=plan.playerDuties[rotation.outId];
  return {schema:'yffm-v4-prepared-team-1',sourceFingerprint:snapshot.fingerprint,id:team.id,name:team.name,competition,
    lineupSchemeId:team.humanOwned?team.activeLineupSchemeId??null:null,
    players:applyS4BondBonuses(starters,bonds),substitutes:selection.substitutes.map(enhance),positions,positionPresets,formationLinePresets:clone(team.formationLinePresets),
    tactic:team.tactic,style:team.style,attackFocus:team.attackFocus,defenseFocus:team.defenseFocus,tacticalPlans:plans,captainId:starters.some(p=>p.id===team.captainId)?team.captainId:null,captainStyle:team.captainStyle,
    rotations:clone(selection.rotations??[]),rotationNotes:clone(selection.rotationNotes??[]),bonds};
}
