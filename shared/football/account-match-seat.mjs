import {biologyReduction} from '../config/advanced-research.mjs';
import { initializePositionInheritance } from '../config/position-inheritance.mjs';
import { prepareFitnessSeat } from './fitness-lineup.mjs';
import { fitnessRedline } from '../config/fitness.mjs';
import { confirmedResearchFormation, matchesResearchFormation, formationResearchLevels } from '../config/formation-research.mjs';
import { sponsoredTeamName } from '../config/sponsorship.mjs';
import { repairTacticsLineups } from '../config/tactics-repair.mjs';
import { representativePlayers } from '../config/representative-players.mjs';
import { optimalLineupAssignment } from '../../tactics-lineup-rules.js';
import { isPlayerTraining } from '../config/training.mjs';
import { assertExpeditionCapacity, autoCompletePlayerSquads, PLAYER_SQUAD_IDS } from '../config/player-squads.mjs';
import { DEFAULT_FORMATION_LINES } from '../../formation-rules.js';

// Pure squad projection shared by the match engine and expedition inspection.
export const DEFAULT_PLAN = Object.freeze({
  tactic: "balanced",
  style: "possession",
  positionPreset: "position1",
  inPossessionDetails: { attackDirection: "balanced", chanceCreation: "balanced", longShots: "balanced", crossing: "balanced" },
  outOfPossessionDetails: { defensiveWidth: "balanced", defenseDirection: "balanced", marking: "mixed", lineStrategy: "hold" },
  tacticalDimensions: { tempo:50, directness:50, attackingWidth:50, defensiveLine:50, pressing:50, compactness:55, counterAttack:50, timeWasting:15 },
  playerDuties: {},
});

export function clonePlayer(player, { idPrefix = "" } = {}) {
  return {
    ...structuredClone(player),
    id: `${idPrefix}${player.id}`,
    active: true,
    state: { ...structuredClone(player.state ?? {}), fitness: Number(player.state?.fitness ?? player.fitness ?? 100) },
  };
}

function sortedPlayers(players) {
  return [...players].sort((left, right) => Number(right.effectiveOverall ?? right.overall ?? 0) - Number(left.effectiveOverall ?? left.overall ?? 0));
}

export function defaultStartingEleven(roster) {
  const available = sortedPlayers(roster);
  const selected = [];
  const take = (pool, count) => {
    available.filter((player) => player.pool === pool && !selected.includes(player)).slice(0, count).forEach((player) => selected.push(player));
  };
  take("GK", 1);
  take("DEF", 4);
  take("MID", 3);
  take("ATT", 3);
  for (const pool of ["DEF", "MID", "ATT"]) {
    if (!selected.some((player) => player.pool === pool)) take(pool, 1);
  }
  available.filter((player) => player.pool !== "GK" && !selected.includes(player)).forEach((player) => {
    if (selected.length < 11) selected.push(player);
  });
  return selected.slice(0, 11);
}

export function defaultPositions(players) {
  const groups = { GK: [], DEF: [], MID: [], ATT: [] };
  players.forEach((player) => (groups[player.pool] ?? groups.MID).push(player));
  const positions = {};
  for (const [pool, y] of [["GK", 90], ["DEF", 68], ["MID", 44], ["ATT", 20]]) {
    groups[pool].forEach((player, index) => {
      positions[player.id] = { x: Math.round(12 + (index + 1) * 76 / (groups[pool].length + 1)), y };
    });
  }
  return positions;
}

function validSavedStarters(roster, ids) {
  const byId = new Map(roster.map((player) => [player.id, player]));
  const unique = [...new Set(Array.isArray(ids) ? ids.map(String) : [])];
  const players = unique.map((id) => byId.get(id)).filter(Boolean);
  return players.length === 11 && players.filter((player) => player.pool === "GK").length === 1 ? players : null;
}

function replaceTrainingStarters(planned, roster, squadId) {
  const replacements = new Map();
  if (squadId !== PLAYER_SQUAD_IDS.EXPEDITION) return replacements;
  const unavailable = planned.filter(isPlayerTraining);
  const starters = new Set(planned.map((player) => player.id));
  const candidates = sortedPlayers(roster.filter((player) => !starters.has(player.id) && !player.coalitionLoan && !player.medical && !isPlayerTraining(player)
    && !(Number(player.state?.injury?.matchesRemaining ?? player.state?.injuryMatches ?? player.status?.injuryMatches ?? 0) > 0)
    && !(Number(player.state?.suspension?.matchesRemaining ?? player.state?.suspensionMatches ?? player.status?.suspensionMatches ?? 0) > 0)));
  // Assign keeper and outfield slots separately so a high score cannot put an outfielder in goal.
  for (const keeper of [true, false]) {
    const slots = unavailable.filter((player) => (player.pool === "GK") === keeper);
    if (!slots.length) continue;
    const eligible = candidates.filter((player) => (player.pool === "GK") === keeper);
    if (eligible.length < slots.length) throw new Error(`训练球员的${keeper ? "门将" : "外场"}替补不足，请补充远征队替补或取消训练`);
    const assignments = optimalLineupAssignment(slots, eligible, (candidate, original) => {
      const positionScore = candidate.role === original.role ? 1000000 : candidate.secondaryRole === original.role ? 500000 : candidate.pool === original.pool ? 100000 : 0;
      return positionScore + Number(candidate.effectiveOverall ?? candidate.overall ?? 0);
    });
    for (const { slot, player } of assignments) replacements.set(slot.id, player);
  }
  return replacements;
}

export function buildAccountMatchSeat(account, squadId = PLAYER_SQUAD_IDS.EXPEDITION, now = Date.now(), { fitness = false, allowShortHanded = false, bondCatalog = [] } = {}) {
  const fullRoster = account?.draft?.roster ?? [];
  const completed = autoCompletePlayerSquads(account?.playerSquads,fullRoster,{allowTransfers:!account.tactics?.squads});
  if (squadId === PLAYER_SQUAD_IDS.EXPEDITION) assertExpeditionCapacity(completed.playerSquads, fullRoster);
  const roster = representativePlayers(fullRoster).filter((player) => completed.playerSquads.assignments[String(player.id)] === squadId);
  if (roster.length < 11) throw new Error("球队阵容不足，无法参加地块比赛");
  const tacticsRoot = repairTacticsLineups(account.tactics ?? {},fullRoster,completed.playerSquads);
  const tactics = tacticsRoot.squads?.[squadId] ?? tacticsRoot;
  const embedded = tactics.planSnapshots?.__s4V2 ?? {};
  const savedIds = embedded.starters ?? tactics.starters;
  const plannedPlayers = Array.isArray(savedIds) ? validSavedStarters(roster, savedIds) : defaultStartingEleven(roster);
  if (!plannedPlayers || tactics.vacantSlots?.length) throw new Error("首发阵容有空缺，请在对应编队补充可用替补后再参赛");
  const replacements = replaceTrainingStarters(plannedPlayers, roster, squadId);
  const sourcePlayers = plannedPlayers.map((player) => replacements.get(player.id) ?? player);
  const matchPlayerId = (id) => replacements.get(id)?.id ?? id;
  const remapPositions = (positions) => Object.fromEntries(plannedPlayers.map((player) => [matchPlayerId(player.id), structuredClone(positions[player.id])]));
  const remapPlan = (plan) => ({ ...structuredClone(plan), playerDuties: Object.fromEntries(plannedPlayers.filter((player) => Object.hasOwn(plan.playerDuties ?? {}, player.id)).map((player) => [matchPlayerId(player.id), plan.playerDuties[player.id]])) });
  if (sourcePlayers.length !== 11 || sourcePlayers.filter((player) => player.pool === "GK").length !== 1) {
    throw new Error("首发阵容必须包含11名球员且只能有1名门将");
  }
  const players = sourcePlayers.map((player) => clonePlayer(player));
  const fallbackPositions = defaultPositions(plannedPlayers);
  let savedPositionPresets = embedded.positionPresets ?? {};
  const plannedPositions = { ...fallbackPositions, ...(tactics.positions ?? {}), ...(savedPositionPresets.position1 ?? {}) };
  const position1 = remapPositions(plannedPositions);
  const baseLines = embedded.formationLinePresets?.position1 ?? tactics.formationLines ?? DEFAULT_FORMATION_LINES;
  const inherited = initializePositionInheritance({
    customPositionPresets: embedded.customPositionPresets,
    positionPresets: { position1:plannedPositions, position2:savedPositionPresets.position2, position3:savedPositionPresets.position3 },
    formationLinePresets: { position1:baseLines, position2:embedded.formationLinePresets?.position2 ?? baseLines, position3:embedded.formationLinePresets?.position3 ?? baseLines },
    researchFormationIds: structuredClone(embedded.researchFormationIds ?? {}),
  }, { generatedPositions:defaultPositions(roster), defaultLines:DEFAULT_FORMATION_LINES });
  savedPositionPresets = inherited.positionPresets;
  const formationLines = inherited.formationLinePresets;
  const opening = embedded.tacticalPlans?.opening ?? tactics.planSnapshots?.opening ?? {
    ...structuredClone(DEFAULT_PLAN),
    tactic: tactics.attackStyle ?? DEFAULT_PLAN.tactic,
    style: tactics.defenseStyle ?? DEFAULT_PLAN.style,
    tacticalDimensions: { ...DEFAULT_PLAN.tacticalDimensions, ...(tactics.tacticalBars ?? {}) },
  };
  const seat = {
    biologyFatigueReduction:squadId===PLAYER_SQUAD_IDS.EXPEDITION?biologyReduction(account):0,
    id: account.id,
    name: sponsoredTeamName(account, now),
    bondCatalog,
    players,
    fitnessThreshold:fitnessRedline(embedded.fitnessThreshold),
    captainId: players.some((player) => player.id === matchPlayerId(embedded.captainId)) ? matchPlayerId(embedded.captainId) : players[0].id,
    formation: tactics.formation ?? "4-3-3",
    positions: position1,
    positionPresets: { position1, position2: remapPositions({ ...plannedPositions, ...savedPositionPresets.position2 }), position3: remapPositions({ ...plannedPositions, ...savedPositionPresets.position3 }) },
    formationResearchPresets:Object.fromEntries(['position1','position2','position3'].map(key=>{
      const slot=confirmedResearchFormation(account,inherited.researchFormationIds?.[key]);
      const positions=remapPositions({...plannedPositions,...savedPositionPresets[key]});
      const lines=formationLines[key]??formationLines.position1??tactics.formationLines??DEFAULT_FORMATION_LINES;
      return [key,matchesResearchFormation(slot,positions,lines)?formationResearchLevels(slot.levels):{}];
    })),
    formationLines: formationLines.position1 ?? tactics.formationLines ?? DEFAULT_FORMATION_LINES,
    formationLinePresets: {
      position1: formationLines.position1 ?? tactics.formationLines ?? DEFAULT_FORMATION_LINES,
      position2: formationLines.position2 ?? formationLines.position1 ?? tactics.formationLines ?? DEFAULT_FORMATION_LINES,
      position3: formationLines.position3 ?? formationLines.position1 ?? tactics.formationLines ?? DEFAULT_FORMATION_LINES,
    },
    tactic: opening.tactic ?? "balanced",
    style: opening.style ?? "possession",
    tacticalPlans: {
      opening: remapPlan(opening),
      leading: remapPlan(embedded.tacticalPlans?.leading ?? tactics.planSnapshots?.leading ?? { ...structuredClone(DEFAULT_PLAN), tactic:"defensive", style:"counterAttack", positionPreset:"position2", triggerGoalDifference:1 }),
      trailing: remapPlan(embedded.tacticalPlans?.trailing ?? tactics.planSnapshots?.trailing ?? { ...structuredClone(DEFAULT_PLAN), tactic:"positive", style:"possession", positionPreset:"position3", triggerGoalDifference:1 }),
    },
  };
  if (!fitness) return seat;
  seat.substitutes=roster.filter(p=>!sourcePlayers.some(s=>s.id===p.id)&&!isPlayerTraining(p)).map(p=>({...clonePlayer(p),active:false}));
  const prepared=prepareFitnessSeat(seat,{full:squadId===PLAYER_SQUAD_IDS.GARRISON,allowShortHanded});
  prepared.selectionSource=structuredClone(seat);
  return prepared;
}

