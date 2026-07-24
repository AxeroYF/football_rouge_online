import { roleGroup } from "../game/public/schema.js";
import { REAL_PLAYER_BY_ID, REAL_PLAYER_POOLS, VERSUS_LINES, VERSUS_PLAYER_GRADE_WEIGHTS } from "./player-pool.js";

export const VERSUS_TEAM_SIZE = 11;
export const VERSUS_TACTICS = Object.freeze(["allOutAttack", "positive", "balanced", "defensive", "parkBus"]);
export const VERSUS_STYLES = Object.freeze(["possession", "longBall", "wingPlay", "counterAttack", "highPress", "lowBlock", "roughPlay"]);
export const VERSUS_FOCUSES = Object.freeze(["balanced", "left", "center", "right"]);

export function inferElevenBoardRoles(entries = []) {
  const normalized = entries
    .filter((entry) => entry?.id && Number.isFinite(Number(entry?.position?.x)) && Number.isFinite(Number(entry?.position?.y)))
    .map((entry) => ({ id: entry.id, x: Number(entry.position.x), y: Number(entry.position.y) }));
  const roles = {};
  const midfielders = normalized.filter((entry) => entry.y >= 27 && entry.y < 59);
  const wideMidfielders = midfielders.filter((entry) => entry.x < 38 || entry.x > 62);
  const midfieldReferenceY = wideMidfielders.length
    ? wideMidfielders.reduce((sum, entry) => sum + entry.y, 0) / wideMidfielders.length
    : 46;
  for (const entry of normalized) {
    if (entry.y >= 82) roles[entry.id] = "GK";
    else if (entry.y >= 66) roles[entry.id] = entry.x < 30 ? "LB" : entry.x > 70 ? "RB" : "CB";
    else if (entry.y >= 55 && entry.x < 25) roles[entry.id] = "LWB";
    else if (entry.y >= 55 && entry.x > 75) roles[entry.id] = "RWB";
    else if (entry.y >= 59) roles[entry.id] = "CB";
    else if (entry.y < 27) roles[entry.id] = entry.x < 38 ? "LW" : entry.x > 62 ? "RW" : "ST";
    else if (entry.x < 38) roles[entry.id] = "LM";
    else if (entry.x > 62) roles[entry.id] = "RM";
    else roles[entry.id] = entry.y < midfieldReferenceY ? "AM" : "DM";
  }
  return roles;
}

export function availablePoolPlayers(pool, selectedIds = []) {
  if (!VERSUS_LINES[pool]) throw new Error("unknown player pool");
  const selected = new Set(selectedIds);
  return REAL_PLAYER_POOLS[pool].filter((player) => !selected.has(player.id));
}

const DRAFT_ROLE_SLOTS = Object.freeze({
  DEF: Object.freeze([Object.freeze(["LB"]), Object.freeze(["CB"]), Object.freeze(["RB"])]),
  MID: Object.freeze([Object.freeze(["LM"]), Object.freeze(["DM", "AM"]), Object.freeze(["RM"])]),
  ATT: Object.freeze([Object.freeze(["LW"]), Object.freeze(["ST"]), Object.freeze(["RW"])]),
});

function takeWeightedPlayer(available, rng, predicate = () => true) {
  const candidateIndexes = [];
  for (let index = 0; index < available.length; index += 1) {
    if (predicate(available[index])) candidateIndexes.push(index);
  }
  if (!candidateIndexes.length) return null;
  const totalWeight = candidateIndexes.reduce((sum, index) => sum + VERSUS_PLAYER_GRADE_WEIGHTS[available[index].grade], 0);
  let roll = rng() * totalWeight;
  let selectedIndex = candidateIndexes.at(-1);
  for (const index of candidateIndexes) {
    roll -= VERSUS_PLAYER_GRADE_WEIGHTS[available[index].grade];
    if (roll <= 0) {
      selectedIndex = index;
      break;
    }
  }
  return available.splice(selectedIndex, 1)[0];
}

export function drawUniquePlayers(pool, selectedIds, rng = Math.random, count = 3, pinnedPlayers = []) {
  const pinned = pinnedPlayers.filter((player) => player?.pool === pool && !selectedIds.includes(player.id)).slice(0, count);
  const pinnedIds = new Set(pinned.map((player) => player.id));
  const available = availablePoolPlayers(pool, selectedIds).filter((player) => !pinnedIds.has(player.id));
  const slots = count === 3 ? DRAFT_ROLE_SLOTS[pool] : null;
  if (slots) {
    const choices = Array(slots.length).fill(null);
    for (const player of pinned) {
      const slotIndex = slots.findIndex((roles, index) => !choices[index] && roles.includes(player.role));
      if (slotIndex >= 0) choices[slotIndex] = player;
    }
    for (let index = 0; index < slots.length; index += 1) {
      if (!choices[index]) choices[index] = takeWeightedPlayer(available, rng, (player) => slots[index].includes(player.role));
    }
    const balancedChoices = choices.filter(Boolean);
    for (const player of pinned) {
      if (!balancedChoices.some((choice) => choice.id === player.id)) balancedChoices.push(player);
    }
    while (balancedChoices.length < count && available.length) balancedChoices.push(takeWeightedPlayer(available, rng));
    for (const player of pinned) {
      const currentIndex = balancedChoices.findIndex((choice) => choice.id === player.id);
      if (currentIndex < 0) continue;
      balancedChoices.splice(currentIndex, 1);
      balancedChoices.splice(Math.floor(rng() * (balancedChoices.length + 1)), 0, player);
    }
    return balancedChoices.slice(0, count);
  }
  const choices = [...pinned];
  while (choices.length < count && available.length) {
    choices.push(takeWeightedPlayer(available, rng));
  }
  return choices;
}

export function defaultElevenPositions(players = []) {
  const byGroup = { GK: [], DEF: [], MID: [], ATT: [] };
  players.forEach((player) => byGroup[roleGroup(player.role)].push(player));
  const positions = {};
  const placeLine = (entries, y) => entries.forEach((player, index) => {
    positions[player.id] = { x: Math.round(((index + 1) / (entries.length + 1)) * 76 + 12), y };
  });
  placeLine(byGroup.GK, 90);
  placeLine(byGroup.DEF, 69);
  placeLine(byGroup.MID, 45);
  placeLine(byGroup.ATT, 19);
  return positions;
}

export function analyzeElevenFormation(players = [], positions = {}) {
  const roles = inferElevenBoardRoles(players.map((player) => ({ id: player.id, position: positions[player.id] })));
  const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  Object.values(roles).forEach((role) => { counts[roleGroup(role)] += 1; });
  const midfieldY = players
    .filter((player) => roleGroup(roles[player.id]) === "MID")
    .map((player) => Number(positions[player.id]?.y))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  let name = `${counts.DEF}-${counts.MID}-${counts.ATT}`;
  if (midfieldY.length >= 3) {
    const midfieldLines = [1];
    for (let index = 1; index < midfieldY.length; index += 1) {
      if (midfieldY[index] - midfieldY[index - 1] >= 8) midfieldLines.push(1);
      else midfieldLines[midfieldLines.length - 1] += 1;
    }
    if (midfieldLines.length > 1) {
      name = [counts.DEF, ...midfieldLines.reverse(), counts.ATT].join("-");
    }
  }
  const validCount = players.length === VERSUS_TEAM_SIZE && Object.keys(roles).length === VERSUS_TEAM_SIZE;
  const hasSingleGoalkeeper = counts.GK === 1;
  const validOutfieldLines = [counts.DEF, counts.MID, counts.ATT].every((count) => count >= 1);
  return {
    roles,
    counts,
    valid: validCount && hasSingleGoalkeeper && validOutfieldLines,
    name,
    message: !validCount
      ? `需要恰好 ${VERSUS_TEAM_SIZE} 名场上球员`
      : !hasSingleGoalkeeper
        ? "门将位置必须且只能有一人"
        : !validOutfieldLines
          ? "后场、中场和前场都必须至少一人"
          : "阵型有效",
  };
}

function midfieldStructureProfile(players, positions, roles) {
  const midfielders = players
    .filter((player) => roleGroup(roles[player.id]) === "MID")
    .map((player) => ({ id:player.id, x:Number(positions[player.id]?.x), y:Number(positions[player.id]?.y) }))
    .filter((player) => Number.isFinite(player.x) && Number.isFinite(player.y))
    .sort((left, right) => right.y - left.y);
  const lines = [];
  midfielders.forEach((player) => {
    const line = lines.at(-1);
    if (!line || line.averageY - player.y >= 8) lines.push({ players:[player], averageY:player.y });
    else {
      line.players.push(player);
      line.averageY = line.players.reduce((sum, entry) => sum + entry.y, 0) / line.players.length;
    }
  });
  const leftCovered = midfielders.some((player) => player.x <= 32);
  const rightCovered = midfielders.some((player) => player.x >= 68);
  const wideCoverage = (Number(leftCovered) + Number(rightCovered)) / 2;
  const extraLines = Math.max(0, lines.length - 1);
  const uncoveredWideRisk = extraLines * (1 - wideCoverage);
  return {
    lineCount: lines.length,
    lineSizes: lines.map((line) => line.players.length),
    layered: lines.length > 1,
    leftCovered,
    rightCovered,
    wideCoverage,
    buildupMultiplier: 1 + Math.min(0.045, extraLines * 0.018),
    wideDefenseMultiplier: Math.max(0.9, 1 - uncoveredWideRisk * 0.022),
    transitionRiskMultiplier: 1 + uncoveredWideRisk * 0.045,
  };
}

export function formationStructureProfile(players = [], positions = {}) {
  const formation = analyzeElevenFormation(players, positions);
  const assignedGroups = Object.fromEntries(Object.entries(formation.roles).map(([id, role]) => [id, roleGroup(role)]));
  const assignedKeepers = players.filter((player) => assignedGroups[player.id] === "GK");
  const naturalKeeperInGoal = assignedKeepers.some((player) => roleGroup(player.role) === "GK");
  const emergencyKeepers = assignedKeepers.filter((player) => roleGroup(player.role) !== "GK").length;
  const displacedKeepers = players.filter((player) => roleGroup(player.role) === "GK" && assignedGroups[player.id] !== "GK").length;
  const crossLineMismatches = players.filter((player) => {
    const natural = roleGroup(player.role);
    const assigned = assignedGroups[player.id];
    return natural !== assigned && natural !== "GK" && assigned !== "GK";
  }).length;
  const midfieldStructure = midfieldStructureProfile(players, positions, formation.roles);
  const lineValue = (values, count) => values[Math.min(count, values.length - 1)];
  const goalkeeper = assignedKeepers.length === 0
    ? 0.28
    : (naturalKeeperInGoal ? 1 : 0.38) * Math.pow(0.82, Math.max(0, assignedKeepers.length - 1));
  const defense = lineValue([0.38, 0.56, 0.78, 0.95, 1, 1, 0.94, 0.85, 0.74, 0.62, 0.5, 0.4], formation.counts.DEF) * midfieldStructure.wideDefenseMultiplier;
  const midfield = lineValue([0.55, 0.72, 0.92, 1, 1.02, 1, 0.94, 0.84, 0.73, 0.62, 0.52, 0.44], formation.counts.MID) * midfieldStructure.buildupMultiplier;
  const attack = lineValue([0.58, 0.94, 1, 1.02, 0.99, 0.9, 0.78, 0.67, 0.57, 0.48, 0.41, 0.35], formation.counts.ATT);
  const coherence = Math.pow(0.72, emergencyKeepers) * Math.pow(0.92, displacedKeepers) * Math.pow(0.97, crossLineMismatches);
  const transitionRisk = 1
    + Math.max(0, 1 - defense) * 1.9
    + Math.max(0, 1 - midfield) * 0.75
    + Math.max(0, 1 - goalkeeper) * 0.55
    + Math.max(0, 1 - coherence) * 0.8;
  return {
    ...formation,
    midfieldStructure,
    multipliers: { goalkeeper, defense, midfield, attack, coherence, transitionRisk: transitionRisk * midfieldStructure.transitionRiskMultiplier },
    mismatches: { emergencyKeepers, displacedKeepers, crossLineMismatches },
  };
}

export function sanitizePositions(players, positions = {}) {
  const fallback = defaultElevenPositions(players);
  return Object.fromEntries(players.map((player) => {
    const value = positions[player.id] ?? fallback[player.id];
    return [player.id, {
      x: Math.round(Math.max(8, Math.min(92, Number(value?.x) || 50))),
      y: Math.round(Math.max(6, Math.min(94, Number(value?.y) || 50))),
    }];
  }));
}

export function hydrateSelectedPlayers(selections = []) {
  return selections.map((selection) => ({ ...REAL_PLAYER_BY_ID[selection.playerId], traits: [...selection.traitIds] }));
}
