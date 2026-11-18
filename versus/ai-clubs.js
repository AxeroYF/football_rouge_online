import {AI_CLUBS, AI_CLUB_VERSION} from './public/ai-club-config.js';
import {CLUB_BADGES} from './cosmetic-items.js';
import {TEAM_DRAFT_FORMATIONS} from './public/team-draft-config.js';
import {v2OptimalLineupAssignment} from './public/v2-tactical-guidance.js';
import {applyPrinciplePreset} from './public/tactical-principles.js';
import {draftStyleScore} from './team-draft.js';
import {positionFitScore} from '../shared/football/schema.js';
import {deriveFormationLines,inferElevenBoardRoles} from './public/formation-rules.js';
import {selectPrematchLineup} from './prematch-rotation.js';
import {effectivePrematchFitness} from './public/fitness-rules.js';

// Reuse the cosmetic catalogue without granting AI teams cosmetic inventory.
export function aiClubBadge(team) {
  if (!team || team.ownerId) return null;
  const club = AI_CLUBS.find(entry => entry.id === team.aiClub?.clubId || entry.name === team.name);
  return CLUB_BADGES.find(badge => badge.clubName === club?.name) ?? null;
}

export function aiSquadStrength(team, playersById) {
  const players = [...new Set(team.rosterIds ?? [])].map(id => playersById[id]).filter(Boolean);
  const descending = (a, b) => b.overall - a.overall;
  const bestEleven = [
    ...players.filter(player => player.role === 'GK').sort(descending).slice(0, 1),
    ...players.filter(player => player.role !== 'GK').sort(descending).slice(0, 10),
  ];
  // Use permanent squad quality, unaffected by rotation, fatigue or cup position.
  return {
    firstTeam:bestEleven.reduce((sum, player) => sum + player.overall, 0) / 11,
    squad:players.reduce((sum, player) => sum + player.overall, 0) / Math.max(1, players.length),
  };
}

const formations = {...TEAM_DRAFT_FORMATIONS, '4-3-1-2':[
  ['GK',50,90],['LB',18,68],['CB',40,68],['CB',60,68],['RB',82,68],
  ['DM',50,53],['AM',32,45],['AM',68,45],['AM',50,32],['ST',40,18],['ST',60,18],
]};
const presets = ['position1','position2','position3'];
const skillsStyle = style => ({protect:'counter',longBall:'target'})[style] ?? style;
const fit = (p, role) => (p.role === 'GK') !== (role === 'GK') ? -1000 : positionFitScore(p,role);
const suitable = (p,role) => p.role === role || p.secondaryRole === role;
const slotsFor = formation => {
  const slots=formations[formation].map(([role,x,y],slot)=>({slot,id:String(slot),role,position:{x,y}}));
  const roles=inferElevenBoardRoles(slots,deriveFormationLines(slots));
  return slots.map(s=>({...s,role:roles[s.id]??s.role}));
};
const baseScore = (p,style) => p.overall*.7 + draftStyleScore(p,skillsStyle(style))*.3;
const fitness = (team,id) => Number(team.playerState?.[id]?.fitness ?? 100);

export function buildAiClub(club, players) {
  const available = players.filter(p=>p.grade !== 'X' && !p.xPlayer && !['古德温','梅老鼠'].includes(p.name));
  const candidates = available.filter(p=>p.club===club.name || ['S','A'].includes(p.grade));
  // Three keepers, then one complete outfield set for each tactical scheme.
  const slots = [0,1,2].map(slot=>({slot,role:'GK',style:club.styles[0]}));
  club.formations.forEach((formation,i)=>slots.push(...slotsFor(formation).filter(s=>s.role!=='GK').map(s=>({...s,slot:slots.length+s.slot,style:club.styles[i]}))));
  const assignment = v2OptimalLineupAssignment(slots,candidates,(p,s)=>
    suitable(p,s.role) ? (p.club===club.name?10000:0)+(p.club!==club.name&&p.grade==='A'?20:0)+baseScore(p,s.style)*fit(p,s.role) : -1e6);
  if(assignment.length!==23 || assignment.some(({player,slot})=>!suitable(player,slot.role))) throw new Error(`${club.name}无法组成23人双方案名单`);
  const roster=assignment.map(a=>a.player);
  const additions=assignment.filter(a=>a.player.club!==club.name).map(({player,slot})=>({playerId:player.id,name:player.name,role:slot.role,sourceClub:player.club,reason:`补足双方案${slot.role}位置深度`}));
  return {version:AI_CLUB_VERSION,clubId:club.id,rosterIds:roster.map(p=>p.id),additions,
    schemes:club.formations.map((formation,index)=>makeScheme(club,roster,index))};
}

function duty(role,style) {
  if(role==='GK')return null;
  if(role==='CB')return style==='control'?'ballPlayingDefender':'coverDefender';
  if(role==='DM')return style==='control'?'deepLyingPlaymaker':'anchor';
  if(['LB','RB'].includes(role))return style==='counter'||style==='protect'?'holdingFullback':'overlappingFullback';
  if(['LM','RM'].includes(role))return style==='counter'||style==='protect'?'defensiveWideMidfielder':'wideMidfielder';
  if(['LW','RW'].includes(role))return style==='control'?'insideForward':'bylineWinger';
  if(role==='ST')return style==='counter'||style==='vertical'?'advancedForward':'deepLyingForward';
  return 'advancedPlaymaker';
}

function makeScheme(club,roster,index) {
  const formation=club.formations[index], style=club.styles[index];
  const assigned=v2OptimalLineupAssignment(slotsFor(formation),roster,(p,s)=>(suitable(p,s.role)?1000:0)+baseScore(p,style)*fit(p,s.role));
  const positions=Object.fromEntries(assigned.map(({player,slot})=>[player.id,slot.position]));
  return {id:`ai-${index+1}`,name:`方案${index+1} · ${formation}`,formation,style,
    preferredStarterIds:assigned.map(a=>a.player.id),positions};
}

export function installAiClub(team, index, players) {
  if(team.ownerId)return false;
  if(team.aiClub?.version===AI_CLUB_VERSION && team.rosterIds?.length===23 && team.rosterIds.every(id=>players.some(p=>p.id===id)))return false;
  const club=AI_CLUBS[index%AI_CLUBS.length], built=buildAiClub(club,players);
  team.name=club.name;
  team.aiClub={version:built.version,clubId:club.id,label:club.label,additions:built.additions};
  team.rosterIds=built.rosterIds;
  team.lineupSchemes=built.schemes;
  team.activeLineupSchemeId=built.schemes[0].id;
  team.playerState=Object.fromEntries(team.rosterIds.map(id=>[id,{fitness:100,suspension:0,cupSuspension:0,seasonFinalSuspension:0,injuryRounds:0,...team.playerState?.[id]}]));
  Object.assign(team,planAiClub(team,players).configuration);
  return true;
}

export function planAiClub(team,players,{competition='league',bannedPlayerIds=[],schemeIndex=null,opponentStyle=null}={}) {
  const club=AI_CLUBS.find(c=>c.id===team.aiClub?.clubId);
  if(!club)throw new Error('AI俱乐部尚未初始化');
  const bans=new Set(bannedPlayerIds);
  const roster=players.filter(p=>team.rosterIds.includes(p.id)).map(p=>({...p,
    blockedReason:bans.has(p.id)?'赛事禁用':null,
    state:{...p.state,...team.playerState?.[p.id],fitness:effectivePrematchFitness(team.playerState?.[p.id],competition)}}));
  // Never silently revive an injured/banned player to complete the eleven.
  const plans=club.formations.map((formation,index)=>{
    const style=club.styles[index], slots=slotsFor(formation);
    const baseline=team.lineupSchemes.find(s=>s.id===`ai-${index+1}`)?.preferredStarterIds??[];
    const selection=selectPrematchLineup({slots:slots.map((slot,i)=>({...slot,playerId:baseline[i]})),players:roster,
      threshold:team.fitnessThreshold,competition,quality:p=>baseScore(p,style)*(.55+.45*p.state.fitness/100)});
    const assignments=selection.assignments;
    const score=assignments.length*1e6+assignments.reduce((sum,{player,slot})=>sum+fit(player,slot.role)*baseScore(player,style)*(player.state.fitness/100),0)
      +(index===0?8:0)+(opponentStyle==='highPress'&&['counter','vertical'].includes(style)?12:0);
    return {index,formation,style,assignments,score,selection};
  });
  const chosen=schemeIndex==null?[...plans].sort((a,b)=>b.score-a.score)[0]:plans[Math.max(0,Math.min(1,Number(schemeIndex)||0))];
  const baseline=team.lineupSchemes.find(s=>s.id===`ai-${chosen.index+1}`)?.preferredStarterIds??[];
  const positionPresets={},formationLinePresets={},tacticalPlans={};
  for(const [i,key] of presets.entries()) {
    positionPresets[key]=Object.fromEntries(chosen.assignments.map(({player,slot})=>[player.id,{x:slot.position.x,y:Math.max(12,Math.min(90,slot.position.y+(slot.role==='GK'?0:i===1?5:i===2?-4:0)))}]));
    formationLinePresets[key]=deriveFormationLines(Object.entries(positionPresets[key]).map(([id,position])=>({id,position})));
    const style=i===1?(chosen.style==='control'?'control':'protect'):i===2?(chosen.style==='counter'||chosen.style==='protect'?'vertical':chosen.style):chosen.style;
    const plan=applyPrinciplePreset({},style);
    if(i===1)plan.tactic='defensive';
    if(i===2)plan.tactic='positive';
    Object.assign(plan,{positionPreset:key,triggerGoalDifference:1,planAfter:i===1?'60':'0',
      buildUpOutlet:style==='control'?'pivot':'balanced',pressureEscape:style==='control'?'switch':'direct',pressTrigger:style==='press'?'backPass':'balanced',pressAssignment:style==='counter'?'screen':'closeDown',setPieceCommitment:i===1?'protect':i===2?'attack':'balanced',
      playerDuties:Object.fromEntries(chosen.assignments.map(({player,slot})=>[player.id,duty(slot.role,style)]).filter(([,value])=>value))});
    tacticalPlans[['opening','leading','trailing'][i]]=plan;
  }
  const ids=chosen.assignments.map(a=>a.player.id);
  const reasons=[`${club.label}；采用${chosen.formation}`, ...baseline.filter(id=>!ids.includes(id)).map(id=>{
    const p=players.find(p=>p.id===id),s=team.playerState?.[id]??{};
    return `${p?.name??id}轮休：${bans.has(id)?'禁用':s.injuryRounds?'伤缺':s.suspension||s.cupSuspension||s.seasonFinalSuspension?'停赛':`体能${Math.round(fitness(team,id))}／位置适配`}`;
  })];
  const forMatch=p=>({...p,aiPlayer:true});
  return {
    lineup:chosen.assignments.map(a=>({...forMatch(a.player),assignedRole:a.slot.role,emergencyGoalkeeper:Boolean(a.emergency)})),
    substitutes:chosen.selection.substitutes.map(forMatch),rotations:chosen.selection.rotations,rotationNotes:chosen.selection.notes,
    configuration:{preferredStarterIds:ids,positions:positionPresets.position1,positionPresets,formationLinePresets,tacticalPlans,
      tactic:tacticalPlans.opening.tactic,style:({control:'possession',press:'highPress',wing:'wingPlay',counter:'counterAttack',protect:'lowBlock',vertical:'possession'})[chosen.style]??'possession',
      attackFocus:chosen.style==='wing'?'balanced':chosen.style==='control'?'center':'balanced',defenseFocus:'balanced',captainId:ids.find(id=>players.find(p=>p.id===id)?.role==='DM')??ids[0],
      activeLineupSchemeId:`ai-${chosen.index+1}`,aiDecision:{formation:chosen.formation,schemeIndex:chosen.index,reasons}},
  };
}

export function seededAiRandom(seed) {
  let state=2166136261;
  for(const c of String(seed))state=Math.imul(state^c.charCodeAt(0),16777619)>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
