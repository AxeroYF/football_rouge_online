import {initializePositionInheritance} from '../../shared/config/position-inheritance.mjs';
import {fitnessRedline} from '../../shared/config/fitness.mjs';
import {representativePlayers, representativeTactics} from '../../shared/config/representative-players.mjs';
import {repairSquadTactics} from '../../shared/config/tactics-repair.mjs';
import {sanitizeFormationLines} from '../../formation-rules.js';
import {PLAY_STYLE_LABELS as STYLES, TACTIC_LABELS as TACTICS} from '../../shared/football/labels.js';
import {autoCompletePlayerSquads, PLAYER_SQUAD_DEFINITIONS, PLAYER_SQUAD_IDS} from '../../shared/config/player-squads.mjs';
const clone = value => structuredClone(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const DIMENSIONS = { tempo:"比赛节奏", directness:"传球纵深", attackingWidth:"进攻宽度", defensiveLine:"防线高度", pressing:"压迫强度", compactness:"阵型紧凑", counterAttack:"反击倾向", timeWasting:"比赛控制" };
const DIMENSION_PRESETS = {
  allOutAttack:{ tempo:72,directness:58,attackingWidth:60,defensiveLine:76,pressing:72,compactness:42,counterAttack:36,timeWasting:0 },
  positive:{ tempo:60,directness:53,attackingWidth:55,defensiveLine:58,pressing:58,compactness:54,counterAttack:44,timeWasting:5 },
  balanced:{ tempo:50,directness:50,attackingWidth:50,defensiveLine:50,pressing:50,compactness:55,counterAttack:50,timeWasting:15 },
  defensive:{ tempo:44,directness:56,attackingWidth:46,defensiveLine:42,pressing:42,compactness:64,counterAttack:62,timeWasting:32 },
  parkBus:{ tempo:36,directness:60,attackingWidth:42,defensiveLine:28,pressing:30,compactness:72,counterAttack:64,timeWasting:55 },
};
const STYLE_ADJUSTMENTS = {
  possession:{ tempo:-8,directness:-22,attackingWidth:-4,compactness:8,counterAttack:-18 },
  longBall:{ tempo:7,directness:30,attackingWidth:6,counterAttack:8 }, wingPlay:{ tempo:5,directness:5,attackingWidth:30,compactness:-8 },
  counterAttack:{ tempo:8,directness:14,defensiveLine:-10,pressing:-6,compactness:8,counterAttack:20 },
  highPress:{ tempo:10,directness:-4,defensiveLine:22,pressing:32,compactness:12 }, lowBlock:{ tempo:-10,directness:8,defensiveLine:-20,pressing:-16,compactness:18,counterAttack:8 },
  roughPlay:{ tempo:4,directness:8,pressing:16,compactness:6 },
};
const DEFAULT_IN = { attackDirection:"balanced",chanceCreation:"balanced",longShots:"balanced",crossing:"balanced" };
const DEFAULT_OUT = { defensiveWidth:"balanced",defenseDirection:"balanced",marking:"mixed",lineStrategy:"hold" };

export function defaultDimensions(tactic="balanced", style="possession") {
  const base = DIMENSION_PRESETS[tactic] ?? DIMENSION_PRESETS.balanced;
  const adjustment = STYLE_ADJUSTMENTS[style] ?? {};
  return Object.fromEntries(Object.keys(DIMENSIONS).map((key) => [key,clamp(Math.round(base[key] + Number(adjustment[key] ?? 0)),0,100)]));
}
export function defaultPositions(roster) {
  const groups = { GK:[],DEF:[],MID:[],ATT:[] };
  roster.forEach((player) => (groups[player.pool] ?? groups.MID).push(player));
  const result = {};
  [["GK",90],["DEF",68],["MID",44],["ATT",20]].forEach(([key,y]) => groups[key].forEach((player,index) => { result[player.id] = { x:Math.round(12 + (index + 1) * 76 / (groups[key].length + 1)),y }; }));
  return result;
}
function defaultPlan(tactic, style, positionPreset, triggerGoalDifference) {
  return { tactic,style,positionPreset,...(triggerGoalDifference ? { triggerGoalDifference } : {}),inPossessionDetails:{...DEFAULT_IN},outOfPossessionDetails:{...DEFAULT_OUT},tacticalDimensions:defaultDimensions(tactic,style),playerDuties:{} };
}
function normalizePlan(value, fallback) {
  const tactic = TACTICS[value?.tactic] ? value.tactic : fallback.tactic;
  const style = STYLES[value?.style] ? value.style : fallback.style;
  return { ...fallback,...value,tactic,style,inPossessionDetails:{...DEFAULT_IN,...value?.inPossessionDetails},outOfPossessionDetails:{...DEFAULT_OUT,...value?.outOfPossessionDetails},tacticalDimensions:{...defaultDimensions(tactic,style),...value?.tacticalDimensions},playerDuties:{...value?.playerDuties} };
}
export function defaultStarterIds(roster) {
  const available=[...roster].sort((left,right)=>Number(right.effectiveOverall??right.overall??0)-Number(left.effectiveOverall??left.overall??0));
  const selected=[];
  const take=(pool,count)=>available.filter((player)=>player.pool===pool&&!selected.includes(player)).slice(0,count).forEach((player)=>selected.push(player));
  take("GK",1); take("DEF",4); take("MID",3); take("ATT",3);
  available.filter((player)=>player.pool!=="GK"&&!selected.includes(player)).forEach((player)=>{if(selected.length<11)selected.push(player);});
  return selected.slice(0,11).map((player)=>player.id);
}
export function normalizeSquadState(saved, roster) {
  saved = repairSquadTactics(saved, roster);
  const embedded = saved?.planSnapshots?.__s4V2 ?? {};
  const ids = new Set(roster.map((player) => player.id));
  const savedStarters = [...new Set((embedded.starters ?? saved?.starters ?? []).filter((id) => ids.has(id)))].slice(0,11);
  const hasSavedLineup = Array.isArray(embedded.starters ?? saved?.starters);
  const starters = hasSavedLineup ? savedStarters : defaultStarterIds(roster);
  const basePositions = { ...defaultPositions(roster),...(saved?.positions ?? {}),...(embedded.positionPresets?.position1 ?? {}) };
  const state = {
    starters, vacantSlots:clone(saved?.vacantSlots ?? []), activePositionPreset:embedded.activePositionPreset ?? "position1", activePlan:embedded.activePlan ?? saved?.activePlan ?? "opening",
    researchFormationIds:clone(embedded.researchFormationIds??{}),
    researchFormationBackups:clone(embedded.researchFormationBackups??{}),
    customPositionPresets:clone(embedded.customPositionPresets??{}),
    positionPresets:{ position1:clone(basePositions),position2:clone(embedded.positionPresets?.position2 ?? basePositions),position3:clone(embedded.positionPresets?.position3 ?? basePositions) },
    formationLinePresets:{ position1:sanitizeFormationLines(embedded.formationLinePresets?.position1 ?? saved?.formationLines),position2:sanitizeFormationLines(embedded.formationLinePresets?.position2 ?? saved?.formationLines),position3:sanitizeFormationLines(embedded.formationLinePresets?.position3 ?? saved?.formationLines) },
    tacticalPlans:{
      opening:normalizePlan(embedded.tacticalPlans?.opening ?? saved?.planSnapshots?.opening,defaultPlan(saved?.attackStyle ?? "balanced",saved?.defenseStyle ?? "possession","position1")),
      leading:normalizePlan(embedded.tacticalPlans?.leading ?? saved?.planSnapshots?.leading,defaultPlan("defensive","counterAttack","position2",1)),
      trailing:normalizePlan(embedded.tacticalPlans?.trailing ?? saved?.planSnapshots?.trailing,defaultPlan("positive","possession","position3",1)),
    },
    captainId:starters.includes(embedded.captainId) ? embedded.captainId : starters[0] ?? null, fitnessThreshold:fitnessRedline(embedded.fitnessThreshold), showRoleZones:Boolean(embedded.showRoleZones), showReferenceLines:embedded.showReferenceLines !== false,
  };
  return initializePositionInheritance(state,{generatedPositions:defaultPositions(roster),defaultLines:sanitizeFormationLines()});
}
export function normalizeTacticsSquads(saved, roster, playerSquads) {
  saved=representativeTactics(saved,roster);
  const completed=autoCompletePlayerSquads(playerSquads,roster,{allowTransfers:!saved?.squads});
  roster=representativePlayers(roster);
  const assignments=completed.playerSquads.assignments;
  const squadRoster=(squadId)=>roster.filter((player)=>assignments[String(player.id)]===squadId);
  const activeSquadId=PLAYER_SQUAD_DEFINITIONS.some((squad)=>squad.id===saved?.activeSquadId)?saved.activeSquadId:PLAYER_SQUAD_IDS.EXPEDITION;
  const hasFixedSquads=Boolean(saved?.squads&&typeof saved.squads==="object");
  return {
    activeSquadId,
    assignments,
    ready:completed.ready,
    autoAssignedPlayerIds:completed.autoAssignedPlayerIds,
    hasFixedSquads,
    squads:{
      [PLAYER_SQUAD_IDS.EXPEDITION]:normalizeSquadState(hasFixedSquads?saved.squads?.[PLAYER_SQUAD_IDS.EXPEDITION]:saved,squadRoster(PLAYER_SQUAD_IDS.EXPEDITION)),
      [PLAYER_SQUAD_IDS.GARRISON]:normalizeSquadState(saved?.squads?.[PLAYER_SQUAD_IDS.GARRISON],squadRoster(PLAYER_SQUAD_IDS.GARRISON)),
    },
  };
}
