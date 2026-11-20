import {hasSpiritPossession} from '../spirit-possession.js';
import {createHash} from 'node:crypto';

export const SOURCE_SCHEMA='yffm-v4-league-source-1';
const copy=value=>structuredClone(value);
const fields=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,copy(value[key])]));
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const strength=card=>Number(card.upgradeLevel??0)*1000+Number(card.traitIds?.length??0)*10-Number(card.acquiredAt??0)/1e15;
const playerFields=['id','name','grade','role','secondaryRole','preferredFoot','pool','overall','baseOverall','heightCm','nationality','club','attributes','legendary','xPlayer'];
const teamFields=['id','name','division','rosterIds','preferredStarterIds','positions','positionPresets','formationLinePresets','tactic','style','attackFocus','defenseFocus',
  'fitnessThreshold','captainId','captainStyle','tacticalPlans','playerState','chemistry','lineupSchemes','activeLineupSchemeId','lineupSchemeAssignments','aiClub','rosterEnforcement'];

// Capture only match-related values. The caller supplies a resolved catalogue;
// loading/migrating a live service is deliberately outside this pure boundary.
export function createSourceSnapshot({league,catalog,traitCatalog,bondCatalog=[],sourceRevisions={}}){
  if(!Array.isArray(league?.teams)||!Array.isArray(catalog)||!Array.isArray(traitCatalog))throw new Error('只读球队快照输入无效');
  const players=new Map(catalog.map(p=>[p.id,p])),traits=new Map(traitCatalog.map(t=>[t.id,t]));
  const cards=Object.values(league.s4Assets?.cards??{}).filter(c=>c.status!=='recycled');
  const teams=league.teams.map(team=>{
    if(!Array.isArray(team.rosterIds)||new Set(team.rosterIds).size!==team.rosterIds.length)throw new Error('球队名单缺失或重复');
    return {...fields(team,teamFields),humanOwned:Boolean(team.ownerId),roster:team.rosterIds.map(id=>{
      const source=players.get(id);if(!source)throw new Error(`球队名单缺少球员定义：${id}`);
      const card=team.ownerId?cards.filter(c=>c.ownerId===team.ownerId&&c.playerId===id).sort((a,b)=>strength(b)-strength(a)||String(a.id).localeCompare(String(b.id)))[0]:null;
      const traitIds=card?.traitIds??[];
      const definitions=traitIds.map(id=>{const trait=traits.get(id);if(!trait)throw new Error(`未知特性：${id}`);return fields(trait,['id','name','eligibleRoleGroups','rules']);});
      return {...fields(source,playerFields),card:card?fields(card,['id','upgradeLevel','traitIds','permanentOverallPenalty']):null,
        traitDefinitions:definitions,xConfig:source.xPlayer?copy(league.xPlayers?.configs?.[id]??null):null};
    })};
  });
  const payload={schema:SOURCE_SCHEMA,access:'server-only',season:fields(league.season??{},['id','currentRound']),sourceRevisions:copy(sourceRevisions),bondCatalog:copy(bondCatalog),teams};
  if (teams.some(team => team.roster.some(hasSpiritPossession))) {
    payload.spiritCatalog = catalog.filter(p => p.grade === 'S').map(p => fields(p,[...playerFields,'cardProfile','hidden']));
  }
  return freeze({...payload,fingerprint:createHash('sha256').update(JSON.stringify(payload)).digest('hex')});
}

export function sourceCoverage(snapshot){
  const hooks={},roles={},tacticalFields=new Set();
  for(const team of snapshot.teams){
    for(const plan of Object.values(team.tacticalPlans??{}))Object.keys(plan).forEach(key=>tacticalFields.add(key));
    for(const p of team.roster){roles[p.role]=(roles[p.role]??0)+1;for(const t of p.traitDefinitions)for(const rule of t.rules??[])hooks[rule.hook]=(hooks[rule.hook]??0)+1;}
  }
  return {schema:SOURCE_SCHEMA,fingerprint:snapshot.fingerprint,teams:snapshot.teams.length,rosterEntries:snapshot.teams.reduce((n,t)=>n+t.roster.length,0),roles,hooks,tacticalFields:[...tacticalFields].sort(),
    scope:'Read-only source capture. This is not a compiled V4 match input or a claim that every captured rule is implemented.'};
}
