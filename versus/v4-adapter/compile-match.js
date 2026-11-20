import {matchEnvironment,matchIncidentRules} from '../match-conditions.js';
import {createHash} from 'node:crypto';
import {prepareSourceTeam} from './prepare-teams.js';
import {compilePrincipleDimensions,isPrinciplesPlan} from '../public/tactical-principles.js';
import {V2_PLAYER_DUTY_OPTIONS,resolveBoardDuty} from '../public/v2-player-duty-options.js';
import {inferElevenBoardRoles} from '../public/formation-rules.js';
import {captainStyleModifiers} from '../public/captain-rules.js';
import {ATTRIBUTE_NAMES,positionFitScore,roleGroup} from '../../shared/football/schema.js';
import {compileInput} from '../v4/fixtures.js';
import {VERSION} from '../v4/world.js';
import {SUPPORTED_TRAIT_HOOKS,TRAIT_CONDITIONS} from '../v4/player-effects.js';

export const ADAPTER_VERSION='v4-league-adapter-1';
const roles={GK:'GK',CB:'CB',LB:'LB',RB:'RB',LWB:'LB',RWB:'RB',DM:'DM',AM:'CM',LM:'CM',RM:'CM',CM:'CM',LW:'LW',RW:'RW',ST:'ST'};
const modes={normal:'opening',leading:'leading',trailing:'trailing'};
const implementedAttributes=new Set(ATTRIBUTE_NAMES);
const instructionKeys=['pressTrigger','pressAssignment','buildUpRoute','buildUpOutlet','pressureEscape','defensiveFocus','setPieceRoutine','setPieceCommitment','duelIntensity'];
const point=position=>{
  if(![position?.x,position?.y].every(Number.isFinite)||position.x<0||position.x>100||position.y<0||position.y>100)throw new Error('来源阵型坐标无效');
  return {x:105*(1-position.y/100),y:68*position.x/100};
};
function instructions(plan,fallback){
  const merged={...fallback,...plan},d=isPrinciplesPlan(plan)?compilePrincipleDimensions(merged):plan.tacticalDimensions??fallback.tacticalDimensions;
  if(!d||['attackingWidth','pressing','directness','defensiveLine','compactness','tempo','counterAttack'].some(k=>!Number.isFinite(d[k])||d[k]<0||d[k]>100))throw new Error('来源战术维度缺失或超限');
  const out={width:.45+d.attackingWidth/100*.75,press:d.pressing/100,directness:d.directness/100,lineHeight:d.defensiveLine/100,compactness:d.compactness/100,
    tempo:d.tempo/100,mentality:(d.mentality??({parkBus:20,defensive:34,balanced:50,positive:66,allOutAttack:92})[merged.tactic]??50)/100,counterAttack:d.counterAttack/100,
    route:merged.inPossessionDetails?.attackDirection&&merged.inPossessionDetails.attackDirection!=='balanced'?merged.inPossessionDetails.attackDirection:merged.attackFocus??'balanced',lossReaction:merged.lossTransition??'balanced',restDefense:merged.restDefense??'balanced',clockManagement:plan.clockManagement??(d.timeWasting>=30?'slow':d.timeWasting<=8?'quick':merged.clockManagement??'normal')};
  for(const key of instructionKeys)if(merged[key]!==undefined)out[key]=merged[key];
  for(const key of ['chanceCreation','longShots','crossing'])if(merged.inPossessionDetails?.[key])out[key]=merged.inPossessionDetails[key];
  for(const key of ['defensiveWidth','defenseDirection','marking','lineStrategy'])if(merged.outOfPossessionDetails?.[key])out[key]=merged.outOfPossessionDetails[key];
  if((!out.defenseDirection||out.defenseDirection==='balanced')&&merged.defenseFocus)out.defenseDirection=merged.defenseFocus;
  return out;
}
export function compileTeam(team,coverage){
  const opening=team.tacticalPlans?.opening??{tactic:team.tactic,style:team.style};
  const plans=Object.fromEntries(Object.entries(modes).map(([mode,key])=>{
    const supplied=team.tacticalPlans?.[key];return [mode,supplied?{...supplied,tactic:supplied.tactic??opening.tactic??team.tactic??'balanced',style:supplied.style??supplied.possessionStyle??opening.style??team.style??'balanced'}:{...opening}];
  }));
  const boards=Object.fromEntries(Object.entries(plans).map(([mode,plan])=>[mode,team.positionPresets[plan.positionPreset??'position1']]));
  const rolePlans=Object.fromEntries(Object.entries(boards).map(([mode,board])=>[mode,inferElevenBoardRoles(team.players.map(p=>({id:p.id,position:board[p.id]})),team.formationLinePresets?.[plans[mode].positionPreset??'position1'])]));
  const preparePlayer=(p,index,starter)=>{
    const assigned=starter?rolePlans.normal[p.id]:p.role,role=roles[assigned];if(!role)throw new Error(`位置无法映射：${assigned}`);
    for(const trait of p.traitDefinitions??[])for(const rule of trait.rules??[]){if(!SUPPORTED_TRAIT_HOOKS.includes(rule.hook))coverage.blockers.push(`trait:${rule.hook}`);for(const condition of Object.keys(rule.when??{}))if(!TRAIT_CONDITIONS.includes(condition))coverage.blockers.push(`trait-condition:${condition}`);}
    const dutyPlans=Object.fromEntries(Object.entries(plans).map(([mode,plan])=>{
      const duty=plan.playerDuties?.[p.id]??null,sourceRole=starter?rolePlans[mode][p.id]:p.role;
      if(duty&&!Object.hasOwn(V2_PLAYER_DUTY_OPTIONS,duty))throw new Error(`未知职责：${duty}`);
      if(duty&&!resolveBoardDuty(sourceRole,duty)){coverage.warnings.push(`不适用的职责已按原位置规则忽略：${p.id}/${mode}/${duty}`);return [mode,null];}
      return [mode,duty];
    }));
    const positionRules=(p.traitDefinitions??[]).flatMap(t=>t.rules??[]).filter(r=>r.hook==='position'&&!r.when);
    const positionFitByRole=Object.fromEntries(Object.keys(roles).map(assigned=>{
      const fit=positionRules.some(r=>r.familiarRoles?.includes(assigned)||r.ignoreOutOfPositionPenalty&&r.eligibleRoleGroups?.includes(roleGroup(assigned)))?1:positionFitScore(p,assigned);
      return [assigned,fit];
    }));
    return {id:p.id,name:p.name,grade:p.grade,...(p.spiritForm ? {spiritForm:p.spiritForm} : {}),number:index+1,role,sourceRole:assigned,naturalRole:p.role,secondaryRole:roles[p.secondaryRole]??null,
      anchor:starter?point(boards.normal[p.id]):{x:role==='GK'?5:45,y:34},
      ...(starter?{anchorPlans:Object.fromEntries(Object.entries(boards).map(([mode,board])=>[mode,point(board[p.id])])),rolePlans:Object.fromEntries(Object.keys(modes).map(mode=>[mode,roles[rolePlans[mode][p.id]]])),sourceRolePlans:Object.fromEntries(Object.keys(modes).map(mode=>[mode,rolePlans[mode][p.id]])),dutyPlans}:{}),
      attributes:structuredClone(p.ydlBondBaseAttributes??p.attributes),heightCm:p.heightCm??180,baseHeightCm:p.heightCm??180,fitness:p.state.fitness,overall:p.overall,positionFitByRole,
      carrierBaseOverall:p.carrierBaseOverall ?? p.baseOverall ?? p.overall,matchCardId:p.matchCardId ?? p.card?.id,
      nationality:p.nationality,club:p.club,upgradeLevel:p.upgradeLevel??0,...(p.bondIdentity?{bondIdentity:{...p.bondIdentity}}:{}),
      traitDefinitions:structuredClone(p.traitDefinitions??[]),sourceCard:structuredClone(p.card),baseAttributes:structuredClone(p.ydlBondBaseAttributes??p.attributes)};
  };
  const keepers=team.substitutes.filter(p=>p.role==='GK'),outfield=team.substitutes.filter(p=>p.role!=='GK').sort((a,b)=>b.overall-a.overall||a.id.localeCompare(b.id));
  const bench=[...keepers.slice(0,2),...outfield,...keepers.slice(2)].slice(0,12);
  coverage.excludedBench.push(...team.substitutes.filter(p=>!bench.includes(p)).map(p=>({team:team.id,player:p.id,reason:'十二人比赛替补席上限，优先保留门将与可用能力'})));
  const fallback={attackFocus:team.attackFocus??'balanced',defenseFocus:team.defenseFocus??'balanced',...opening};
  return {id:team.id,name:team.name,preset:'balanced',instructions:instructions(opening,fallback),scorePlans:{leading:instructions(plans.leading,fallback),trailing:instructions(plans.trailing,fallback)},
    scoreTriggers:Object.fromEntries(['leading','trailing'].map(mode=>[mode,{goalDifference:Number(plans[mode].triggerGoalDifference??1),afterMinute:Number(plans[mode].planAfter??0)}])),
    players:team.players.map((p,i)=>preparePlayer(p,i,true)),bench:bench.map((p,i)=>preparePlayer(p,11+i,false)),
    captainId:team.captainId,captainStyle:team.captainStyle,captainPlans:Object.fromEntries(['level','leading','trailing'].map(mode=>[mode,captainStyleModifiers(team,mode)])),sourcePlans:plans,sourceBonds:team.bonds};
}

export function compileRealMatch(snapshot,{homeId,awayId,fixtureId,seed,competition='league',resolution='draw',aggregate=[0,0],duration=5400,allowPartial=false,environment={weather:'sunny',precipitation:0}}={}){
  if(!fixtureId||!seed||homeId===awayId)throw new Error('真实球队输入需要不同球队、固定比赛ID和种子');
  environment=matchEnvironment(environment.weather,environment.referee);
  const source=id=>snapshot.teams.find(t=>t.id===id);
  const prepared=[prepareSourceTeam(snapshot,homeId,{competition,seed,side:0,opponentStyle:source(awayId)?.style}),prepareSourceTeam(snapshot,awayId,{competition,seed,side:1,opponentStyle:source(homeId)?.style})];
  const coverage={blockers:ATTRIBUTE_NAMES.filter(k=>!implementedAttributes.has(k)).map(k=>`attribute:${k}`),warnings:[],excludedBench:[],scope:'shadow-only'};
  const input=compileInput(JSON.parse(JSON.stringify({seed:String(seed),duration,format:'full',competitionMode:competition,competition:{resolution,aggregate},environment,matchIncidents:matchIncidentRules,adapterVersion:ADAPTER_VERSION,sourceFingerprint:snapshot.fingerprint,fixtureId,
    teams:prepared.map(team=>({...compileTeam(team,coverage),sourceBondCatalog:structuredClone(snapshot.bondCatalog)})),passiveSubstitutions:true,playerEffects:true,publishGoalAssists:true})));
  coverage.blockers=[...new Set(coverage.blockers)].sort();
  if(coverage.blockers.length&&!allowPartial)throw Object.assign(new Error(`真实球队映射尚未覆盖：${coverage.blockers.join(', ')}`),{code:'V4_UNSUPPORTED_COVERAGE'});
  const fingerprint=createHash('sha256').update(JSON.stringify({engineVersion:VERSION,input})).digest('hex');
  return {schema:'yffm-v4-match-input-1',engineVersion:VERSION,adapterVersion:ADAPTER_VERSION,fingerprint,sourceFingerprint:snapshot.fingerprint,
    lineupSchemeIds:prepared.map(team=>team.lineupSchemeId),input,coverage};
}

export function resultEnvelope(envelope,match){
  if(match.state.phase!=='finished'||match.state.version!==envelope.engineVersion||match.state.input.fixtureId!==envelope.input.fixtureId||match.state.input.sourceFingerprint!==envelope.sourceFingerprint)throw new Error('结果与锁定输入不匹配或尚未完赛');
  const fingerprint=createHash('sha256').update(JSON.stringify({engineVersion:match.state.version,input:match.state.input})).digest('hex');
  if(fingerprint!==envelope.fingerprint)throw new Error('结果输入指纹不匹配');
  return {schema:'yffm-v4-match-result-1',engineVersion:match.state.version,adapterVersion:ADAPTER_VERSION,fixtureId:envelope.input.fixtureId,inputFingerprint:envelope.fingerprint,
    sourceFingerprint:envelope.sourceFingerprint,score:[...match.state.score],result:structuredClone(match.state.result),stats:structuredClone(match.state.stats),settlementAllowed:false,coverage:structuredClone(envelope.coverage)};
}
