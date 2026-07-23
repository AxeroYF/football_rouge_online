import { DEFAULT_GAME_CONFIG } from "../game/public/config.js";
import { positionFitScore, roleGroup } from "../game/public/schema.js";
import { hydratePlayerTraits, traitAdjustedAttribute, traitPositionFit } from "../game/public/trait-runtime.js";
import { analyzeElevenFormation, formationStructureProfile, sanitizePositions } from "./rules.js";
import { VERSUS_TRAIT_CARDS } from "./trait-pool.js";

export const REGULAR_DURATION_MS = 120_000;
export const EXTRA_DURATION_MS = 30_000;
export const TACTICAL_PAUSE_MS = 30_000;
export const HALFTIME_ADJUSTMENT_MS = 30_000;
export const PENALTY_KICK_INTERVAL_MS = 2_000;

const WEATHER = Object.freeze({
  sunny: { name: "晴朗", precipitation: 5, wind: 8, pace: 1, control: 1, fatigue: 1 },
  rain: { name: "雨天", precipitation: 72, wind: 18, pace: 0.97, control: 0.93, fatigue: 1.08 },
  storm: { name: "雷暴", precipitation: 88, wind: 45, pace: 0.94, control: 0.88, fatigue: 1.13 },
  snow: { name: "雪天", precipitation: 58, wind: 20, pace: 0.91, control: 0.9, fatigue: 1.16 },
});

export const VERSUS_REFEREES = Object.freeze({
  lenient: { name: "宽松", description: "允许更多身体对抗，防守和伐木战术更容易发挥。", foul: 0.86, yellow: 0.82, red: 0.84, penalty: 0.88 },
  standard: { name: "标准", description: "判罚尺度均衡，不明显偏向任何比赛方式。", foul: 1, yellow: 1, red: 1, penalty: 1 },
  strict: { name: "严格", description: "严控身体接触，控球与短传体系更容易掌握节奏。", foul: 1.14, yellow: 1.17, red: 1.15, penalty: 1.14 },
});

const TACTICS = Object.freeze({
  allOutAttack: { name: "全力进攻", attack: 1.27, defense: 0.74, tempo: 1.18, press: 1.18, risk: 1.46, width: 1.1, fatigue: 1.2 },
  positive: { name: "积极进攻", attack: 1.09, defense: 0.9, tempo: 1.06, press: 1.07, risk: 1.24, width: 1.03, fatigue: 1.09 },
  balanced: { name: "攻守平衡", attack: 1, defense: 1, tempo: 1, press: 1, risk: 1, width: 1, fatigue: 1 },
  defensive: { name: "防守反击", attack: 0.91, defense: 1.09, tempo: 0.92, press: 0.84, risk: 0.9, width: 0.95, fatigue: 0.94, counter: 1.24 },
  parkBus: { name: "全力防守", attack: 0.72, defense: 1.26, tempo: 0.78, press: 0.58, risk: 0.64, width: 0.88, fatigue: 0.86, counter: 1.35 },
});

const MATCH_STYLES = Object.freeze({
  possession: {
    name: "密集短传", attack: 0.98, midfield: 1.02, defense: 0.98, risk: 0.94, fatigue: 1.03, press: 0.94,
    aerialReliance: 0.12,
    weather: { sunny: 1.01, rain: 0.98, storm: 0.96, snow: 0.97 },
    attackWeights: { throughBall: 1.25, cross: 0.7, cutback: 1.45, counter: 0.65, longShot: 0.8 },
  },
  longBall: {
    name: "长传冲吊", attack: 1.06, midfield: 0.97, defense: 0.98, risk: 1.04, fatigue: 1, press: 0.9,
    aerialReliance: 1,
    weather: { sunny: 1, rain: 1.01, storm: 1.02, snow: 1.02 },
    attackWeights: { throughBall: 1.08, cross: 1.72, cutback: 0.65, counter: 1.05, longShot: 1.18 },
  },
  wingPlay: {
    name: "两翼齐飞", attack: 1.03, midfield: 0.99, defense: 0.97, risk: 1.05, fatigue: 1.04, press: 0.96,
    aerialReliance: 0.78,
    weather: { sunny: 1.01, rain: 0.99, storm: 0.97, snow: 0.97 },
    attackWeights: { throughBall: 0.78, cross: 1.92, cutback: 1.38, counter: 0.88, longShot: 0.72 },
  },
  counterAttack: {
    name: "防守反击", attack: 0.98, midfield: 0.93, defense: 1.01, risk: 0.86, fatigue: 0.95, press: 0.84,
    aerialReliance: 0.28,
    weather: { sunny: 1, rain: 1.01, storm: 1.02, snow: 1.02 },
    attackWeights: { throughBall: 1.28, cross: 0.85, cutback: 0.75, counter: 1.62, longShot: 0.9 },
  },
  highPress: {
    name: "高位压迫", attack: 1, midfield: 1.04, defense: 0.99, risk: 1.22, fatigue: 1.25, press: 1.22,
    aerialReliance: 0.22,
    weather: { sunny: 1.01, rain: 0.98, storm: 0.96, snow: 0.96 },
    attackWeights: { throughBall: 1.05, cross: 0.9, cutback: 1.16, counter: 1.14, longShot: 0.9 },
  },
  lowBlock: {
    name: "摆大巴", attack: 0.78, midfield: 0.9, defense: 1.22, risk: 0.64, fatigue: 0.9, press: 0.6,
    aerialReliance: 0.42,
    weather: { sunny: 1, rain: 1.01, storm: 1.02, snow: 1.02 },
    attackWeights: { throughBall: 0.76, cross: 0.68, cutback: 0.58, counter: 1.55, longShot: 0.78 },
  },
  roughPlay: {
    name: "伐木", attack: 1, midfield: 1, defense: 1.06, risk: 1.3, fatigue: 1.08, press: 1.08,
    aerialReliance: 0.34, foulMultiplier: 2.15, severeMultiplier: 1.9, injuryMultiplier: 2.8, redMultiplier: 1.8, penaltyMultiplier: 2.1,
    weather: { sunny: 1, rain: 1.01, storm: 1.01, snow: 1.01 },
    attackWeights: { throughBall: 0.9, cross: 0.94, cutback: 0.82, counter: 1.15, longShot: 1.1 },
  },
});

const SHOT_BASE = Object.freeze({ throughBall: 0.2, cross: 0.125, cutback: 0.215, counter: 0.225, longShot: 0.078, setPiece: 0.103 });
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const average = (values, fallback = 50) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(match) {
  match.randomState = (Math.imul(match.randomState, 1664525) + 1013904223) >>> 0;
  return match.randomState / 4294967296;
}

function chance(match, probability) {
  return random(match) < clamp(probability, 0, 1);
}

function choose(match, entries, weight = () => 1) {
  if (!entries.length) return null;
  const weights = entries.map((entry) => Math.max(0.01, Number(weight(entry)) || 0.01));
  let roll = random(match) * weights.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < entries.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return entries[index];
  }
  return entries.at(-1);
}

export function drawVersusWeather(rng = Math.random) {
  const weights = DEFAULT_GAME_CONFIG.weatherWeights;
  let roll = rng() * Object.values(weights).reduce((sum, value) => sum + value, 0);
  for (const key of ["sunny", "rain", "storm", "snow"]) {
    roll -= weights[key];
    if (roll <= 0) return { key, ...WEATHER[key] };
  }
  return { key: "sunny", ...WEATHER.sunny };
}

function pickWeather(match) {
  return drawVersusWeather(() => random(match));
}

export function drawVersusReferee(rng = Math.random) {
  const roll = rng();
  const key = roll < 0.28 ? "lenient" : roll < 0.78 ? "standard" : "strict";
  return { key, ...VERSUS_REFEREES[key] };
}

function pickReferee(match) {
  return drawVersusReferee(() => random(match));
}

function refereeTeamModifiers(match, team) {
  const key = match.referee?.key ?? "standard";
  const lineCounts = activePlayers(team).reduce((counts, player) => {
    const group = roleGroup(player.assignedRole);
    counts[group] = (counts[group] ?? 0) + 1;
    return counts;
  }, {});
  const modifiers = { attack: 1, midfield: 1, defense: 1 };
  if (key === "strict") {
    if (team.style === "possession") { modifiers.attack *= 1.02; modifiers.midfield *= 1.03; }
    if (["balanced", "positive"].includes(team.tactic)) { modifiers.attack *= 1.008; modifiers.midfield *= 1.012; }
    if ((lineCounts.MID ?? 0) >= 4) modifiers.midfield *= 1.008;
  }
  if (key === "lenient") {
    if (team.style === "roughPlay") { modifiers.attack *= 1.01; modifiers.midfield *= 1.025; modifiers.defense *= 1.045; }
    if (team.style === "lowBlock" || ["defensive", "parkBus"].includes(team.tactic)) { modifiers.midfield *= 1.008; modifiers.defense *= 1.02; }
    if ((lineCounts.DEF ?? 0) >= 4) modifiers.defense *= 1.006;
  }
  return modifiers;
}

function hydrateTeam(seat, index, seed) {
  const players = seat.players.map((source) => {
    const position = seat.positions[source.id];
    const formation = analyzeElevenFormation(seat.players, seat.positions);
    const assignedRole = formation.roles[source.id] ?? source.role;
    const hydrated = hydratePlayerTraits({
      ...source,
      assignedRole,
      boardPosition: { ...position },
      state: { ...source.state, fitness: 100 },
    }, VERSUS_TRAIT_CARDS, seed);
    return {
      ...hydrated,
      active: true,
      sentOff: false,
      injury: null,
      rating: 6,
      matchStats: { goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, keyPasses: 0, duelsWon: 0, duelsLost: 0, tackles: 0, saves: 0, fouls: 0, yellowCards: 0, redCards: 0 },
    };
  });
  return {
    index,
    name: seat.name,
    importedLineup: Boolean(seat.importedLineup),
    tactic: seat.tactic,
    style: seat.style ?? "possession",
    attackFocus: seat.attackFocus ?? "balanced",
    defenseFocus: seat.defenseFocus ?? "balanced",
    markingTargetId: null,
    adjustmentBoostUntilMinute: 0,
    positions: structuredClone(seat.positions),
    players,
    score: 0,
    stats: { possession: 0, attacks: 0, shots: 0, shotsOnTarget: 0, xg: 0, fouls: 0, yellowCards: 0, redCards: 0, injuries: 0, corners: 0 },
  };
}

function activePlayers(team) {
  return team.players.filter((player) => player.active);
}

function scoreState(match, team) {
  const opponent = match.teams[team.index === 0 ? 1 : 0];
  return team.score > opponent.score ? "leading" : team.score < opponent.score ? "trailing" : "tied";
}

function attribute(match, team, player, key) {
  return traitAdjustedAttribute(player, key, player.attributes?.[key] ?? 50, {
    minute: match.minute,
    weather: { type: match.weather.key, precipitation: match.weather.precipitation },
    scoreState: scoreState(match, team),
    scoreDifference: team.score - match.teams[team.index === 0 ? 1 : 0].score,
    tactics: TACTICS[team.tactic],
    playerDeficit: 11 - activePlayers(team).length,
  });
}

export function versusPositionFit(player, assignedRole = player.assignedRole) {
  const baseFit = positionFitScore(player, assignedRole);
  const assignedGroup = roleGroup(assignedRole);
  const primaryGroup = roleGroup(player.role);
  if (assignedRole === player.role) return 1;
  if (assignedRole === player.secondaryRole) return 0.9;
  if ((assignedRole === "LWB" && [player.role, player.secondaryRole].includes("LB")) || (assignedRole === "RWB" && [player.role, player.secondaryRole].includes("RB"))) return 0.94;
  if (assignedGroup === "GK") return Math.min(baseFit, 0.38);
  if (primaryGroup === "GK") return 0.52;
  if (assignedGroup === primaryGroup) return Math.min(baseFit, 0.78);
  return Math.min(baseFit, 0.56);
}

function familiarity(player) {
  return traitPositionFit(player, versusPositionFit(player));
}

function playerMetric(match, team, player, weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const raw = Object.entries(weights).reduce((sum, [key, weight]) => sum + attribute(match, team, player, key) * weight, 0) / total;
  const fitness = Number(player.state?.fitness ?? 100);
  const competitiveValue = 72 + (raw - 72) * 0.45;
  const positionFactor = 1 - (1 - familiarity(player)) * 0.25;
  const opponent = match.teams[team.index === 0 ? 1 : 0];
  const markingFactor = opponent?.markingTargetId === player.id && player.active ? 0.86 : 1;
  return competitiveValue * positionFactor * markingFactor * clamp(0.62 + fitness / 265, 0.62, 1);
}

function squadMetric(match, team, players, weights, fallback = 55) {
  return average(players.map((player) => playerMetric(match, team, player, weights)), fallback);
}

function teamStyleProfile(match, team, groups) {
  const style = MATCH_STYLES[team.style] ?? MATCH_STYLES.possession;
  const outfield = groups.players.filter((player) => roleGroup(player.assignedRole) !== "GK");
  const widePlayers = outfield.filter((player) => {
    const x = Number(team.positions[player.id]?.x ?? 50);
    return x <= 34 || x >= 66;
  });
  const averageWideDistance = average(outfield.map((player) => Math.abs(Number(team.positions[player.id]?.x ?? 50) - 50)), 0);
  const wideStretch = clamp((averageWideDistance - 12) / 20, 0, 1);
  const heightRating = clamp(50 + (average(groups.attackers.map((player) => Number(player.heightCm ?? 180)), 178) - 175) * 2.1, 45, 96);
  const scores = {
    possession: squadMetric(match, team, outfield, { passing: 0.27, firstTouch: 0.24, decisions: 0.2, dribbling: 0.17, composure: 0.12 }),
    longBall: squadMetric(match, team, outfield, { passing: 0.28, vision: 0.22, crossing: 0.18, decisions: 0.16, strength: 0.08, pace: 0.08 }) * 0.57
      + squadMetric(match, team, groups.attackers, { heading: 0.38, jumping: 0.24, offBall: 0.16, strength: 0.14, composure: 0.08 }) * 0.35
      + heightRating * 0.08,
    wingPlay: squadMetric(match, team, widePlayers, { crossing: 0.28, pace: 0.2, acceleration: 0.16, dribbling: 0.16, passing: 0.12, stamina: 0.08 }) * 0.72
      + squadMetric(match, team, groups.attackers, { offBall: 0.28, heading: 0.2, pace: 0.18, finishing: 0.18, composure: 0.16 }) * 0.2
      + clamp(42 + widePlayers.length * 5 + wideStretch * 24, 42, 92) * 0.08,
    counterAttack: squadMetric(match, team, outfield, { pace: 0.3, acceleration: 0.18, decisions: 0.18, passing: 0.14, offBall: 0.12, composure: 0.08 }) * 0.58
      + squadMetric(match, team, groups.attackers, { pace: 0.28, acceleration: 0.2, offBall: 0.2, finishing: 0.18, composure: 0.14 }) * 0.24
      + squadMetric(match, team, groups.defenders, { tackling: 0.3, positioning: 0.28, passing: 0.18, decisions: 0.14, pace: 0.1 }) * 0.18,
    highPress: squadMetric(match, team, outfield, { stamina: 0.26, workRate: 0.24, pace: 0.16, tackling: 0.14, aggression: 0.1, decisions: 0.1 }),
    lowBlock: squadMetric(match, team, [...groups.defenders, ...groups.keepers], { positioning: 0.24, marking: 0.2, tackling: 0.18, strength: 0.13, heading: 0.1, goalkeeping: 0.1, reflexes: 0.05 }),
    roughPlay: squadMetric(match, team, outfield, { aggression: 0.28, tackling: 0.24, strength: 0.18, workRate: 0.13, stamina: 0.1, discipline: 0.07 }),
  };
  const score = scores[team.style] ?? scores.possession;
  const fit = clamp(0.92 + (score - 72) / 120, 0.82, 1.12);
  const weather = style.weather[match.weather.key] ?? 1;
  const effectiveFit = fit * weather;
  const fitFactor = clamp(1 + (effectiveFit - 1) * 0.58, 0.84, 1.09);
  return { ...style, key: team.style, score, fit, weather, effectiveFit, fitFactor, wideStretch };
}

function teamSnapshot(match, team) {
  const players = activePlayers(team);
  const structure = formationStructureProfile(players, team.positions);
  const roles = players.map((player) => roleGroup(player.assignedRole));
  const defenders = players.filter((player) => roleGroup(player.assignedRole) === "DEF");
  const midfielders = players.filter((player) => roleGroup(player.assignedRole) === "MID");
  const attackers = players.filter((player) => roleGroup(player.assignedRole) === "ATT");
  const keepers = players.filter((player) => roleGroup(player.assignedRole) === "GK");
  const tactic = TACTICS[team.tactic] ?? TACTICS.balanced;
  const opponent = match.teams[team.index === 0 ? 1 : 0];
  const markingTarget = opponent?.players.find((player) => player.id === team.markingTargetId && player.active) ?? null;
  const style = teamStyleProfile(match, team, { players, defenders, midfielders, attackers, keepers });
  const referee = refereeTeamModifiers(match, team);
  const adjustmentBoost = match.minute <= Number(team.adjustmentBoostUntilMinute ?? 0) ? 1.035 : 1;
  const deficit = 11 - players.length;
  const countPenalty = Math.pow(0.87, deficit);
  const linePenalty = ["GK", "DEF", "MID", "ATT"].reduce((value, group) => value * (roles.includes(group) ? 1 : 0.78), 1);
  const outfield = players.filter((player) => roleGroup(player.assignedRole) !== "GK");
  const width = outfield.length ? Math.max(...outfield.map((player) => team.positions[player.id]?.x ?? 50)) - Math.min(...outfield.map((player) => team.positions[player.id]?.x ?? 50)) : 0;
  const attack = average(attackers.map((player) => playerMetric(match, team, player, { finishing: 0.3, offBall: 0.2, dribbling: 0.16, pace: 0.14, composure: 0.12, passing: 0.08 })), 35);
  const midfield = average(midfielders.map((player) => playerMetric(match, team, player, { passing: 0.25, vision: 0.19, decisions: 0.16, firstTouch: 0.12, stamina: 0.12, tackling: 0.1, workRate: 0.06 })), 34);
  const defense = average(defenders.map((player) => playerMetric(match, team, player, { tackling: 0.24, marking: 0.21, positioning: 0.21, pace: 0.12, strength: 0.12, heading: 0.1 })), 30);
  const goalkeeping = average(keepers.map((player) => playerMetric(match, team, player, { goalkeeping: 0.55, reflexes: 0.3, positioning: 0.1, composure: 0.05 })), 18);
  const aerial = average(players.map((player) => playerMetric(match, team, player, { heading: 0.38, jumping: 0.27, strength: 0.2, positioning: 0.15 }) + (Number(player.heightCm ?? 180) - 180) * 0.55));
  const pace = average(players.map((player) => playerMetric(match, team, player, { pace: 0.58, acceleration: 0.3, agility: 0.12 })));
  return {
    players, defenders, midfielders, attackers, keepers, tactic, style, deficit, countPenalty, linePenalty, structure,
    width,
    attack: attack * tactic.attack * style.attack * style.fitFactor * referee.attack * adjustmentBoost * countPenalty * linePenalty * structure.multipliers.attack * structure.multipliers.coherence,
    midfield: midfield * Math.sqrt(tactic.attack * tactic.defense) * style.midfield * style.fitFactor * referee.midfield * adjustmentBoost * countPenalty * linePenalty * structure.multipliers.midfield * structure.multipliers.coherence,
    defense: defense * tactic.defense * style.defense * (0.82 + style.fitFactor * 0.18) * referee.defense * adjustmentBoost * countPenalty * linePenalty * structure.multipliers.defense * structure.multipliers.coherence,
    goalkeeping: goalkeeping * (deficit ? 0.96 : 1) * structure.multipliers.goalkeeper,
    aerial, pace,
    transitionRisk: tactic.risk * style.risk * structure.multipliers.transitionRisk * (1 + Math.max(0, attackers.length - 3) * 0.08 + deficit * 0.13) * (markingTarget ? 1.035 : 1),
  };
}

function updateRating(player, delta) {
  player.rating = Number(clamp(player.rating + delta, 1, 10).toFixed(1));
}

function event(match, type, teamIndex, text, data = {}) {
  const entry = {
    id: `${match.minute}-${type}-${match.events.length + 1}`,
    minute: Math.max(1, Math.ceil(match.minute)),
    phase: match.segment,
    type,
    teamIndex,
    text,
    importance: data.importance ?? (['goal','red','injury','lightning','penalty'].includes(type) ? "major" : "normal"),
    ...data,
  };
  if (match.recordEvents) match.events.push(entry);
  return entry;
}

function nextChainId(match) {
  match.sequenceCounter = Number(match.sequenceCounter ?? 0) + 1;
  return `chain-${match.sequenceCounter}`;
}

function shotDescription(match, attackType, shooter) {
  if (attackType === "cross") return chance(match, 0.62) ? "抢点头槌" : "凌空垫射";
  if (attackType === "longShot") return chance(match, 0.55) ? "大力抽射" : "弧线远射";
  if (attackType === "counter") return chance(match, 0.48) ? "低射远角" : "单刀推射";
  if (attackType === "cutback") return chance(match, 0.58) ? "迎球推射" : "不停球抽射";
  return attribute(match, match.teams[shooter.teamIndex], shooter, "composure") >= 88 ? "冷静搓射" : "快速低射";
}

function saveDescription(match, goalkeeper, xg) {
  const reflexes = Number(goalkeeper?.attributes?.reflexes ?? 50);
  if (xg >= 0.3) return chance(match, 0.5) ? "近距离封堵" : "舒展身体单掌托出";
  if (reflexes >= 90 && chance(match, 0.55)) return "飞身指尖改变线路";
  return chance(match, 0.5) ? "稳健侧扑" : "倒地将球挡出";
}

function playerLabel(player) {
  return `${player.name}（${player.assignedRole}）`;
}

function laneFromPosition(position = {}) {
  const x = Number(position.x ?? 50);
  return x < 38 ? "left" : x > 62 ? "right" : "center";
}

function focusMultiplier(focus, lane, selected = 1.18, unselected = 0.93) {
  if (!focus || focus === "balanced") return 1;
  return focus === lane ? selected : unselected;
}

function oppositeLane(lane) {
  return lane === "left" ? "right" : lane === "right" ? "left" : lane;
}

function chooseCreator(match, team, snapshot) {
  return choose(match, snapshot.players.filter((player) => roleGroup(player.assignedRole) !== "GK"), (player) =>
    playerMetric(match, team, player, { passing: 0.35, vision: 0.28, decisions: 0.2, dribbling: 0.17 })
      * focusMultiplier(team.attackFocus, laneFromPosition(team.positions[player.id]), 1.55, 0.78));
}

function chooseDefender(match, team, snapshot, creator) {
  return choose(match, snapshot.players, (player) => {
    const position = team.positions[player.id] ?? { x: 50, y: 50 };
    const creatorPosition = match.teams[creator.teamIndex]?.positions?.[creator.id] ?? { x: 50, y: 50 };
    const proximity = 1 + (100 - Math.abs(position.x - creatorPosition.x)) / 180;
    return proximity * playerMetric(match, team, player, { tackling: 0.3, positioning: 0.26, pace: 0.2, strength: 0.14, marking: 0.1 });
  });
}

function restartControlMultiplier(match, teamIndex) {
  if (!Number.isFinite(match.lastGoalMinute) || !Number.isInteger(match.lastGoalTeamIndex)) return 1;
  const elapsed = match.minute - match.lastGoalMinute;
  if (elapsed < 1 || elapsed > 4) return 1;
  const concedingIndex = match.lastGoalTeamIndex === 0 ? 1 : 0;
  const recovery = { 1:1.3, 2:1.18, 3:1.09, 4:1.03 }[elapsed] ?? 1;
  return teamIndex === concedingIndex ? recovery : 1 / Math.sqrt(recovery);
}

function applyFatigue(match, team, minutes = 3) {
  const tactic = TACTICS[team.tactic] ?? TACTICS.balanced;
  const snapshot = teamSnapshot(match, team);
  const weather = match.weather;
  activePlayers(team).forEach((player) => {
    const stamina = attribute(match, team, player, "stamina");
    const drain = minutes * 0.16 * tactic.fatigue * snapshot.style.fatigue * weather.fatigue * (1.28 - stamina / 260);
    player.state.fitness = Number(clamp(player.state.fitness - drain, 18, 100).toFixed(1));
  });
}

function removePlayer(match, team, player, reason, details = {}) {
  player.active = false;
  player.sentOff = reason === "red";
  player.injury = reason === "red" ? null : { reason, severity: details.severity ?? "severe" };
  updateRating(player, reason === "red" ? -2 : -0.8);
}

function maybeDiscipline(match, attacking, defending, creator, defender, defenseSnapshot) {
  const aggression = attribute(match, defending, defender, "aggression");
  const discipline = attribute(match, defending, defender, "discipline");
  const tackle = attribute(match, defending, defender, "tackling");
  const stylePress = defenseSnapshot.style.press * defenseSnapshot.style.fitFactor;
  const rough = defenseSnapshot.style;
  const referee = match.referee ?? VERSUS_REFEREES.standard;
  const probability = (0.045 + Math.max(0, aggression - discipline) / 620 + TACTICS[defending.tactic].press * stylePress * 0.025) * (rough.foulMultiplier ?? 1) * referee.foul;
  if (!chance(match, probability)) return false;
  defending.stats.fouls += 1;
  defender.matchStats.fouls += 1;
  const severe = chance(match, clamp((0.015 + Math.max(0, aggression - 72) / 330 + Math.max(0, 58 - tackle) / 480) * (rough.severeMultiplier ?? 1), 0.01, 0.38));
  const yellow = severe || chance(match, (0.33 + Math.max(0, aggression - discipline) / 230) * (rough.redMultiplier ?? 1) * referee.yellow);
  event(match, "foul", defending.index, `${defender.name}在${creator.name}完成突破前将他放倒，裁判鸣哨。`, {
    actorId: defender.id, opponentId: creator.id,
    detail: `${defender.name}侵略性 ${Math.round(aggression)} / 纪律 ${Math.round(discipline)}；${creator.name}盘带 ${Math.round(attribute(match, attacking, creator, "dribbling"))}；本场为${match.referee.name}尺度。`,
  });
  if (yellow) {
    defender.matchStats.yellowCards += 1;
    defending.stats.yellowCards += 1;
    const secondYellow = defender.matchStats.yellowCards >= 2;
    const directRed = severe && chance(match, 0.22 * (rough.redMultiplier ?? 1) * referee.red);
    if (secondYellow || directRed) {
      defender.matchStats.redCards += 1;
      defending.stats.redCards += 1;
      removePlayer(match, defending, defender, "red");
      event(match, "red", defending.index, `${defender.name}${secondYellow ? "两黄变一红" : "被直接出示红牌"}，球队无法换人，只能少一人继续。`, {
        actorId: defender.id, importance: "major", consequence: `${defending.name}剩余 ${activePlayers(defending).length} 人`, rating: defender.rating,
      });
      return true;
    }
    updateRating(defender, -0.18);
    event(match, "yellow", defending.index, `裁判向${defender.name}出示黄牌。`, { actorId: defender.id, rating: defender.rating });
  }
  if (chance(match, (0.08 + Math.max(0, aggression - discipline) / 700) * (rough.penaltyMultiplier ?? 1) * referee.penalty)) {
    event(match, "penaltyAwarded", attacking.index, `${defender.name}在禁区内的防守动作过大，裁判判给${attacking.name}点球！`, {
      actorId: defender.id, opponentId: creator.id, importance: "major",
    });
    takePenalty(match, attacking, defending);
  }
  if (severe && chance(match, 0.2 * (rough.injuryMultiplier ?? 1))) {
    attacking.stats.injuries += 1;
    removePlayer(match, attacking, creator, "injury", { severity: "moderate" });
    event(match, "injury", attacking.index, `${creator.name}在对抗后无法继续比赛。没有替补，${attacking.name}将以 ${activePlayers(attacking).length} 人作战。`, {
      actorId: creator.id, opponentId: defender.id, importance: "major", severity: "moderate", rating: creator.rating,
    });
  }
  return true;
}

function takePenalty(match, attacking, defending) {
  const taker = choose(match, activePlayers(attacking).filter((player) => roleGroup(player.assignedRole) !== "GK"), (player) =>
    (attribute(match, attacking, player, "finishing") * 0.45 + attribute(match, attacking, player, "composure") * 0.4 + attribute(match, attacking, player, "setPieces") * 0.15)
      * ({ ATT: 2.4, MID: 1, DEF: 0.32 }[roleGroup(player.assignedRole)] ?? 0.2));
  const keeper = activePlayers(defending).find((player) => roleGroup(player.assignedRole) === "GK") ?? activePlayers(defending)[0];
  const finishing = attribute(match, attacking, taker, "finishing") * 0.45 + attribute(match, attacking, taker, "composure") * 0.4 + attribute(match, attacking, taker, "setPieces") * 0.15;
  const saving = attribute(match, defending, keeper, "goalkeeping") * 0.58 + attribute(match, defending, keeper, "reflexes") * 0.42;
  const scored = chance(match, clamp(0.72 + (finishing - saving) / 260, 0.56, 0.89));
  attacking.stats.shots += 1;
  attacking.stats.shotsOnTarget += 1;
  attacking.stats.xg += 0.76;
  taker.matchStats.shots += 1;
  taker.matchStats.shotsOnTarget += 1;
  if (scored) {
    attacking.score += 1;
    match.lastGoalMinute = match.minute;
    match.lastGoalTeamIndex = attacking.index;
    taker.matchStats.goals += 1;
    updateRating(taker, 0.72);
    updateRating(keeper, -0.16);
  } else {
    keeper.matchStats.saves += 1;
    updateRating(keeper, 0.42);
    updateRating(taker, -0.38);
  }
  event(match, "penalty", attacking.index, `${taker.name}主罚点球${scored ? "命中" : `被${keeper.name}扑出`}！`, {
    actorId: taker.id, opponentId: keeper.id, scored, xg: 0.76, attackType: "penalty",
    score: [match.teams[0].score, match.teams[1].score], importance: "major",
    detail: `裁判鸣哨后由${taker.name}主罚；点球能力 ${Math.round(finishing)} / ${keeper.name}扑救能力 ${Math.round(saving)}。${scored ? `皮球入网，比分 ${match.teams[0].score}:${match.teams[1].score}。` : "门将判断对方向并完成扑救。"}`,
  });
}

function chooseAttackType(match, attack, defense) {
  const attacking = attack.snapshot;
  const defending = defense.snapshot;
  const entries = [
    { key: "throughBall", weight: 1 + attacking.pace / 120 + defending.transitionRisk * 0.45 },
    { key: "cross", weight: 0.85 + attacking.width / 80 + attacking.aerial / 150 * attacking.style.aerialReliance },
    { key: "cutback", weight: 0.95 + attacking.midfield / 110 },
    { key: "counter", weight: 0.42 + (attacking.tactic.counter ?? 1) * defending.transitionRisk },
    { key: "longShot", weight: 0.9 + Math.max(0, defending.defense - attacking.attack) / 85 },
  ];
  return choose(match, entries, (entry) => entry.weight * (attacking.style.attackWeights[entry.key] ?? 1)
    * (entry.key === "cross" && attacking.style.key === "wingPlay" ? 1 + attacking.style.wideStretch * 0.55 : 1)).key;
}

function simulatePossession(match) {
  const snapshots = match.teams.map((team) => teamSnapshot(match, team));
  if (snapshots.some((snapshot) => !snapshot.players.length)) return finishByAbandonment(match);
  const restartControl = [restartControlMultiplier(match, 0), restartControlMultiplier(match, 1)];
  const control0 = snapshots[0].midfield * snapshots[0].tactic.tempo * restartControl[0];
  const control1 = snapshots[1].midfield * snapshots[1].tactic.tempo * restartControl[1];
  const attackingIndex = chance(match, control0 / Math.max(1, control0 + control1)) ? 0 : 1;
  const defendingIndex = attackingIndex === 0 ? 1 : 0;
  const attacking = match.teams[attackingIndex];
  const defending = match.teams[defendingIndex];
  const chainId = nextChainId(match);
  const attackSnapshot = snapshots[attackingIndex];
  const defenseSnapshot = snapshots[defendingIndex];
  attacking.stats.possession += 1;
  attacking.stats.attacks += 1;
  applyFatigue(match, attacking);
  applyFatigue(match, defending, 2.2);
  const creator = chooseCreator(match, attacking, attackSnapshot);
  creator.teamIndex = attackingIndex;
  const attackLane = laneFromPosition(attacking.positions[creator.id]);
  const defender = chooseDefender(match, defending, defenseSnapshot, creator);
  const creatorValue = playerMetric(match, attacking, creator, { passing: 0.28, vision: 0.22, dribbling: 0.2, decisions: 0.16, pace: 0.14 }) * match.weather.control;
  const defenderValue = playerMetric(match, defending, defender, { tackling: 0.29, positioning: 0.24, marking: 0.17, pace: 0.16, strength: 0.14 });
  const creatorBreakdown = {
    passing: attribute(match, attacking, creator, "passing"), vision: attribute(match, attacking, creator, "vision"),
    dribbling: attribute(match, attacking, creator, "dribbling"), pace: attribute(match, attacking, creator, "pace"),
  };
  const defenderBreakdown = {
    tackling: attribute(match, defending, defender, "tackling"), positioning: attribute(match, defending, defender, "positioning"),
    marking: attribute(match, defending, defender, "marking"), strength: attribute(match, defending, defender, "strength"),
  };
  const attackFocusEdge = focusMultiplier(attacking.attackFocus, attackLane, 1.09, 0.96);
  const defenseFocusEdge = focusMultiplier(defending.defenseFocus, oppositeLane(attackLane), 1.13, 0.96);
  const tacticalEdge = (attackSnapshot.midfield - defenseSnapshot.midfield) / 85
    + (attackSnapshot.attack * attackFocusEdge - defenseSnapshot.defense * defenseFocusEdge) / 120
    + Math.max(0, defenseSnapshot.transitionRisk - 1) * 0.1;
  const duelProbability = clamp(0.62 + (creatorValue - defenderValue) / 115 + tacticalEdge, 0.2, 0.88);
  const laneLabel = { left:"左路", center:"中路", right:"右路" }[attackLane] ?? "中路";
  const focusNames = { balanced:"均衡", left:"左路", center:"中路", right:"右路" };
  const restartText = restartControl[attackingIndex] > 1.01
    ? `；丢球后的开球组织使控球权重提升至 ${restartControl[attackingIndex].toFixed(2)}`
    : restartControl[attackingIndex] < 0.99 ? `；对手开球后的反扑使本方控球权重暂降至 ${restartControl[attackingIndex].toFixed(2)}` : "";
  const duelDetail = `${laneLabel}对抗：${creator.name}传球 ${Math.round(creatorBreakdown.passing)}、视野 ${Math.round(creatorBreakdown.vision)}、盘带 ${Math.round(creatorBreakdown.dribbling)}、速度 ${Math.round(creatorBreakdown.pace)}；${defender.name}抢断 ${Math.round(defenderBreakdown.tackling)}、站位 ${Math.round(defenderBreakdown.positioning)}、盯人 ${Math.round(defenderBreakdown.marking)}、力量 ${Math.round(defenderBreakdown.strength)}。推进成功率 ${Math.round(duelProbability * 100)}%，战术边际 ${tacticalEdge >= 0 ? "+" : ""}${tacticalEdge.toFixed(2)}；主攻${focusNames[attacking.attackFocus] ?? "均衡"}对主守${focusNames[defending.defenseFocus] ?? "均衡"}${restartText}。`;
  if (maybeDiscipline(match, attacking, defending, creator, defender, defenseSnapshot)) return;
  if (!chance(match, duelProbability)) {
    defender.matchStats.duelsWon += 1;
    defender.matchStats.tackles += 1;
    creator.matchStats.duelsLost += 1;
    updateRating(defender, 0.07);
    updateRating(creator, -0.04);
    event(match, "duel", defendingIndex, `${creator.name}试图从${defender.name}身边推进，${defender.name}判断准确并完成拦截。`, {
      chainId,
      actorId: defender.id, opponentId: creator.id,
      creatorRole: creator.assignedRole, defenderRole: defender.assignedRole, attackLane, duelProbability: Number(duelProbability.toFixed(3)),
      detail: `${duelDetail} ${creator.name}位置熟悉度 ${Math.round(familiarity(creator) * 100)}%、体能 ${Math.round(creator.state.fitness)}；${defender.name}体能 ${Math.round(defender.state.fitness)}。`,
      ratings: { [defender.id]: defender.rating, [creator.id]: creator.rating },
    });
    return;
  }
  creator.matchStats.duelsWon += 1;
  defender.matchStats.duelsLost += 1;
  updateRating(creator, 0.05);
  const attackType = chooseAttackType(match, { team: attacking, snapshot: attackSnapshot }, { team: defending, snapshot: defenseSnapshot });
  const typeText = { throughBall: "送出穿透防线的直塞", cross: "把球转移到边路准备传中", cutback: "沿肋部推进寻找倒三角", counter: "带队高速反击", longShot: "在禁区外获得起脚空间" }[attackType];
  event(match, attackType === "counter" ? "counter" : "attack", attackingIndex, `${creator.name}摆脱${defender.name}后${typeText}。`, {
    chainId,
    actorId: creator.id, opponentId: defender.id,
    creatorRole: creator.assignedRole, defenderRole: defender.assignedRole, attackLane, attackType, duelProbability: Number(duelProbability.toFixed(3)),
    detail: `${duelDetail} ${creator.name}赢下对抗后选择“${typeText}”；本方转换风险 ${attackSnapshot.transitionRisk.toFixed(2)}，对方防线强度 ${Math.round(defenseSnapshot.defense)}。`,
  });
  const creationProbability = clamp(0.52 + (attackSnapshot.attack * attackFocusEdge - defenseSnapshot.defense * defenseFocusEdge) / 105
    + (attackSnapshot.tactic.attack - 1) * 0.32 + Math.max(0, defenseSnapshot.transitionRisk - 1) * 0.08, 0.16, 0.9);
  if (!chance(match, creationProbability)) {
    const coveringDefender = choose(match, activePlayers(defending).filter((player) => player.id !== defender.id), (player) =>
      playerMetric(match, defending, player, { positioning: 0.35, marking: 0.25, pace: 0.2, decisions: 0.2 }));
    if (coveringDefender) {
      coveringDefender.matchStats.duelsWon += 1;
      updateRating(coveringDefender, 0.04);
      event(match, "cover", defendingIndex, `${coveringDefender.name}及时补位，封住了${creator.name}准备送出的最后一传。`, {
        chainId, actorId: coveringDefender.id, opponentId: creator.id, attackType, attackLane,
        detail: `第一道防线被突破后，${coveringDefender.name}依靠站位和决策完成第二次防守对抗，进攻没有形成射门。`,
      });
    }
    return;
  }
  takeShot(match, attacking, defending, attackSnapshot, defenseSnapshot, creator, attackType, attackLane, chainId);
}

function takeShot(match, attacking, defending, attackSnapshot, defenseSnapshot, creator, attackType, attackLane, chainId) {
  const attackLabel = { throughBall: "中路直塞", cross: "边路传中", cutback: "肋部倒三角", counter: "快速反击", longShot: "禁区外远射" }[attackType] ?? "阵地进攻";
  const laneLabel = { left: "左路", center: "中路", right: "右路" }[attackLane] ?? "中路";
  const candidates = activePlayers(attacking).filter((player) => roleGroup(player.assignedRole) !== "GK");
  const shooter = choose(match, candidates, (player) => {
    const groupWeight = { ATT: 3.2, MID: 1.1, DEF: 0.35 }[roleGroup(player.assignedRole)] ?? 0.2;
    return groupWeight * playerMetric(match, attacking, player, attackType === "cross"
      ? { heading: 0.36, jumping: 0.2, strength: 0.14, offBall: 0.18, composure: 0.12 }
      : { finishing: 0.36, offBall: 0.2, pace: 0.14, composure: 0.18, dribbling: 0.12 });
  });
  shooter.teamIndex = attacking.index;
  const goalkeeper = activePlayers(defending).find((player) => roleGroup(player.assignedRole) === "GK") ?? activePlayers(defending)[0];
  const marker = choose(match, activePlayers(defending).filter((player) => player.id !== goalkeeper.id), (player) => playerMetric(match, defending, player, { positioning: 0.3, marking: 0.25, pace: 0.2, strength: 0.15, jumping: 0.1 }));
  const finishing = playerMetric(match, attacking, shooter, attackType === "cross"
    ? { heading: 0.42, jumping: 0.2, strength: 0.16, composure: 0.12, offBall: 0.1 }
    : attackType === "longShot" ? { longShots: 0.48, composure: 0.2, finishing: 0.18, firstTouch: 0.14 }
      : { finishing: 0.44, composure: 0.22, offBall: 0.18, firstTouch: 0.16 });
  const markerDefense = marker ? playerMetric(match, defending, marker, { positioning: 0.28, marking: 0.24, pace: 0.18, strength: 0.15, jumping: 0.15 }) : 25;
  const keeperValue = goalkeeper ? playerMetric(match, defending, goalkeeper, { goalkeeping: 0.5, reflexes: 0.3, positioning: 0.12, composure: 0.08 }) : 12;
  const heightEdge = attackType === "cross"
    ? (Number(shooter.heightCm ?? 180) - Number(marker?.heightCm ?? 180)) * 0.8 * attackSnapshot.style.aerialReliance
    : 0;
  const crossWidthBoost = attackType === "cross" && attacking.style === "wingPlay"
    ? 1 + attackSnapshot.style.wideStretch * 0.18 + (attribute(match, attacking, creator, "crossing") - 70) / 420
    : 1;
  const baseXg = SHOT_BASE[attackType] ?? 0.11;
  const xg = clamp(baseXg * crossWidthBoost * (1 + (attackSnapshot.attack - defenseSnapshot.defense) / 95 + (finishing + heightEdge - markerDefense) / 150), 0.015, 0.62);
  const goalProbability = clamp(xg * (0.97 + finishing / 116) * (1.48 - keeperValue / 190), 0.01, 0.78);
  attacking.stats.shots += 1;
  attacking.stats.xg += xg;
  shooter.matchStats.shots += 1;
  const onTarget = chance(match, clamp(0.31 + finishing / 210, 0.32, 0.72));
  const technique = shotDescription(match, attackType, shooter);
  if (onTarget) {
    attacking.stats.shotsOnTarget += 1;
    shooter.matchStats.shotsOnTarget += 1;
  }
  if (onTarget && chance(match, goalProbability)) {
    attacking.score += 1;
    match.lastGoalMinute = match.minute;
    match.lastGoalTeamIndex = attacking.index;
    shooter.matchStats.goals += 1;
    const assister = creator.id === shooter.id ? null : creator;
    if (assister) assister.matchStats.assists += 1;
    updateRating(shooter, 0.9);
    if (assister) updateRating(assister, 0.45);
    if (goalkeeper) updateRating(goalkeeper, -0.22);
    const finishText = attackType === "cross" ? `力压${marker?.name ?? "防守球员"}头球攻门` : attackType === "longShot" ? "禁区外果断起脚" : `摆脱${marker?.name ?? "盯防者"}后冷静施射`;
    event(match, "goal", attacking.index, `${attacking.name}从${laneLabel}发动${attackLabel}，${shooter.name}${finishText}得分！${assister ? ` ${assister.name}送出助攻。` : ""}`, {
      chainId, technique,
      actorId: shooter.id, opponentId: marker?.id ?? goalkeeper?.id, assistId: assister?.id ?? null,
      creatorId: creator.id, shooterRole: shooter.assignedRole, attackLane,
      score: [match.teams[0].score, match.teams[1].score], xg: Number(xg.toFixed(2)), attackType, importance: "major",
      detail: `进攻方式：${attackLabel}；推进方向：${laneLabel}；机会质量 xG ${xg.toFixed(2)}。${shooter.name}终结 ${Math.round(finishing + heightEdge)} / ${marker?.name ?? "防线"}限制 ${Math.round(markerDefense)} / ${goalkeeper?.name ?? "临时门将"}扑救 ${Math.round(keeperValue)}。比分来到 ${match.teams[0].score}:${match.teams[1].score}。`,
      ratings: { [shooter.id]: shooter.rating, ...(assister ? { [assister.id]: assister.rating } : {}) },
    });
    return;
  }
  if (onTarget) {
    if (goalkeeper) { goalkeeper.matchStats.saves += 1; updateRating(goalkeeper, 0.13 + xg * 0.25); }
    updateRating(shooter, xg > 0.25 ? -0.12 : -0.03);
    const saveStyle = saveDescription(match, goalkeeper, xg);
    const looseBall = Boolean(goalkeeper && chance(match, clamp(0.12 + xg * 0.35 - keeperValue / 900, 0.08, 0.28)));
    event(match, "save", defending.index, `${shooter.name}以${technique}完成攻门，${goalkeeper?.name ?? "防守球员"}${saveStyle}${looseBall ? "，但皮球脱手留在禁区内" : "并控制住皮球"}。`, {
      chainId, technique, saveStyle, looseBall,
      actorId: goalkeeper?.id, opponentId: shooter.id, creatorId: creator.id, shooterRole: shooter.assignedRole,
      xg: Number(xg.toFixed(2)), attackType, attackLane,
      detail: `${laneLabel}推进；机会质量 xG ${xg.toFixed(2)}。${shooter.name}终结 ${Math.round(finishing + heightEdge)} / ${goalkeeper?.name ?? "防线"}扑救 ${Math.round(keeperValue)}。`,
      ratings: { ...(goalkeeper ? { [goalkeeper.id]: goalkeeper.rating } : {}), [shooter.id]: shooter.rating },
    });
    if (looseBall) {
      const rebounder = choose(match, candidates.filter((player) => player.id !== shooter.id), (player) =>
        ({ ATT: 3.6, MID: 1.2, DEF: 0.25 }[roleGroup(player.assignedRole)] ?? 0.2)
        * playerMetric(match, attacking, player, { offBall: 0.35, acceleration: 0.2, finishing: 0.25, composure: 0.2 }));
      const clearer = choose(match, activePlayers(defending).filter((player) => player.id !== goalkeeper?.id), (player) =>
        playerMetric(match, defending, player, { positioning: 0.35, decisions: 0.25, strength: 0.2, aggression: 0.2 }));
      const reboundAttack = rebounder ? playerMetric(match, attacking, rebounder, { finishing: 0.4, offBall: 0.3, composure: 0.3 }) : 0;
      const clearance = clearer ? playerMetric(match, defending, clearer, { positioning: 0.4, decisions: 0.3, strength: 0.3 }) : 30;
      if (rebounder && chance(match, clamp(0.5 + (reboundAttack - clearance) / 130, 0.22, 0.78))) {
        const reboundXg = clamp(xg * 0.62 + 0.08, 0.08, 0.38);
        attacking.stats.shots += 1;
        attacking.stats.xg += reboundXg;
        rebounder.matchStats.shots += 1;
        const reboundOnTarget = chance(match, clamp(0.4 + reboundAttack / 220, 0.42, 0.78));
        if (reboundOnTarget) {
          attacking.stats.shotsOnTarget += 1;
          rebounder.matchStats.shotsOnTarget += 1;
        }
        const reboundGoal = reboundOnTarget && chance(match, clamp(reboundXg * (1.05 + reboundAttack / 135) * (1.4 - keeperValue / 210), 0.04, 0.62));
        if (reboundGoal) {
          attacking.score += 1;
          match.lastGoalMinute = match.minute;
          match.lastGoalTeamIndex = attacking.index;
          rebounder.matchStats.goals += 1;
          updateRating(rebounder, 0.82);
          if (goalkeeper) updateRating(goalkeeper, -0.16);
          event(match, "goal", attacking.index, `${goalkeeper?.name ?? "门将"}扑出第一点后，${rebounder.name}抢在${clearer?.name ?? "防线"}之前补射得分！`, {
            chainId, actorId: rebounder.id, opponentId: goalkeeper?.id, creatorId: creator.id,
            shooterRole: rebounder.assignedRole, score: [match.teams[0].score, match.teams[1].score],
            xg: Number(reboundXg.toFixed(2)), attackType: "rebound", importance: "major",
            detail: `连续事件：首次扑救脱手 → ${rebounder.name}赢下二点球 → 近距离补射。`,
          });
          return;
        }
        event(match, reboundOnTarget ? "save" : "miss", reboundOnTarget ? defending.index : attacking.index,
          `${rebounder.name}跟进补射，${reboundOnTarget ? `${goalkeeper?.name ?? "门将"}完成连续第二次扑救` : "仓促起脚将球打偏"}。`, {
            chainId, actorId: reboundOnTarget ? goalkeeper?.id : rebounder.id, opponentId: rebounder.id,
            xg: Number(reboundXg.toFixed(2)), attackType: "rebound",
            detail: `连续事件：首次扑救脱手 → 二点球争夺 → 补射${reboundOnTarget ? "再次被扑" : "偏出"}。`,
          });
        return;
      }
      if (clearer) {
        clearer.matchStats.duelsWon += 1;
        updateRating(clearer, 0.05);
        event(match, "clearance", defending.index, `${clearer.name}抢先卡住落点，将${goalkeeper?.name ?? "门将"}扑出的第二点解围。`, {
          chainId, actorId: clearer.id, opponentId: rebounder?.id, attackType: "rebound",
          detail: "连续事件：扑救脱手 → 禁区二点对抗 → 防守方完成解围。",
        });
      }
    } else if (chance(match, 0.22)) {
      attacking.stats.corners += 1;
      event(match, "corner", attacking.index, `${goalkeeper?.name ?? "防守球员"}把球挡出底线，${attacking.name}获得角球。`, { chainId, actorId: goalkeeper?.id, importance: "normal" });
    }
  } else {
    updateRating(shooter, -0.05 - xg * 0.2);
    const blocked = Boolean(marker && chance(match, clamp(0.16 + markerDefense / 420, 0.18, 0.38)));
    if (blocked) {
      marker.matchStats.duelsWon += 1;
      marker.matchStats.tackles += 1;
      updateRating(marker, 0.07);
    }
    event(match, blocked ? "block" : "miss", blocked ? defending.index : attacking.index, blocked
      ? `${shooter.name}的${technique}刚刚离脚，${marker.name}倒地封堵改变了皮球线路。`
      : `${attacking.name}从${laneLabel}完成${attackLabel}，${shooter.name}以${technique}攻门偏出。`, {
      chainId, technique,
      actorId: shooter.id, opponentId: marker?.id, creatorId: creator.id, shooterRole: shooter.assignedRole,
      xg: Number(xg.toFixed(2)), attackType, attackLane,
      detail: `机会质量 xG ${xg.toFixed(2)}。${shooter.name}终结 ${Math.round(finishing + heightEdge)} / ${marker?.name ?? "防线"}限制 ${Math.round(markerDefense)}。`,
      rating: shooter.rating,
    });
  }
}

function triggerLightning(match) {
  const candidates = match.teams.flatMap((team) => activePlayers(team).map((player) => ({ team, player })));
  if (!candidates.length) return;
  const target = choose(match, candidates, ({ player }) => 1 + Math.max(0, Number(player.heightCm ?? 180) - 185) / 30);
  target.team.stats.injuries += 1;
  removePlayer(match, target.team, target.player, "lightning", { severity: "severe" });
  match.lightningTriggered = true;
  event(match, "lightning", target.team.index, `雷电击中${target.player.name}附近的草地！${target.player.name}重伤离场，球队没有替补，只能以 ${activePlayers(target.team).length} 人继续。`, {
    actorId: target.player.id, importance: "major", severity: "severe", rating: target.player.rating,
  });
}

function maybeRegularInjury(match) {
  if (!chance(match, match.weather.key === "sunny" ? 0.006 : 0.012)) return;
  const team = match.teams[chance(match, 0.5) ? 0 : 1];
  const candidates = activePlayers(team);
  if (candidates.length <= 7) return;
  const player = choose(match, candidates, (entry) => 1.2 - Number(entry.hidden?.injuryResistance ?? 60) / 120);
  team.stats.injuries += 1;
  removePlayer(match, team, player, "injury", { severity: "minor" });
  event(match, "injury", team.index, `${player.name}在无球跑动中拉伤，无法继续比赛。${team.name}只能以 ${activePlayers(team).length} 人作战。`, {
    actorId: player.id, importance: "major", severity: "minor", rating: player.rating,
  });
}

function argentinaCount(team) {
  return team.players.filter((player) => ["Argentina", "阿根廷"].includes(player.nationality)).length;
}

function triggerBlackWhistle(match) {
  if (match.blackWhistleTriggered) return;
  const counts = match.teams.map(argentinaCount);
  if (counts[0] === counts[1]) return;
  const favoredIndex = counts[0] > counts[1] ? 0 : 1;
  const punishedIndex = favoredIndex === 0 ? 1 : 0;
  const favored = match.teams[favoredIndex];
  const punished = match.teams[punishedIndex];
  const candidates = activePlayers(punished).filter((player) => roleGroup(player.assignedRole) !== "GK");
  const dismissed = choose(match, candidates.length ? candidates : activePlayers(punished));
  if (!dismissed || !activePlayers(favored).length) return;
  match.blackWhistleTriggered = true;
  event(match, "blackWhistle", favoredIndex, `VAR画面出现异常，裁判做出明显偏向${favored.name}的连续判罚！`, {
    importance: "major", argentinaCounts: counts, punishedTeamIndex: punishedIndex,
    detail: `${favored.name}拥有 ${counts[favoredIndex]} 名阿根廷球员，${punished.name}只有 ${counts[punishedIndex]} 名。`,
  });
  dismissed.matchStats.redCards += 1;
  punished.stats.redCards += 1;
  removePlayer(match, punished, dismissed, "red");
  event(match, "red", punishedIndex, `${dismissed.name}在争议判罚中被直接罚下！${punished.name}被迫少一人作战。`, {
    actorId: dismissed.id, importance: "major", consequence: `${punished.name}剩余 ${activePlayers(punished).length} 人`, blackWhistle: true, rating: dismissed.rating,
  });
  event(match, "penaltyAwarded", favoredIndex, `裁判随后又判给${favored.name}一粒极具争议的点球！`, {
    importance: "major", blackWhistle: true,
  });
  takePenalty(match, favored, punished);
}

function processMinute(match, minute) {
  match.minute = minute;
  if (minute === 1) event(match, "kickoff", null, `比赛开始。${match.teams[0].name}与${match.teams[1].name}进入对抗，本场裁判尺度为${match.referee.name}。`, { detail: match.referee.description });
  if (!match.blackWhistleTriggered && match.blackWhistleMinute && minute >= match.blackWhistleMinute) triggerBlackWhistle(match);
  if (match.weather.key === "storm" && !match.lightningTriggered && minute >= match.lightningMinute) triggerLightning(match);
  // 每个比赛分钟都进行一次节奏判定，平均约每两分钟形成一次可播报攻防。
  if (chance(match, 0.5)) simulatePossession(match);
  if (minute % 11 === 0) maybeRegularInjury(match);
}

function processUntil(match, targetMinute) {
  const capped = Math.min(targetMinute, match.segment === "regular" ? 90 : 120);
  for (let minute = match.lastProcessedMinute + 1; minute <= capped && !match.finished; minute += 1) processMinute(match, minute);
  match.lastProcessedMinute = Math.max(match.lastProcessedMinute, capped);
  match.minute = capped;
}

function finishByAbandonment(match) {
  const emptyIndex = match.teams.findIndex((team) => activePlayers(team).length === 0);
  if (emptyIndex < 0) return;
  match.teams[emptyIndex === 0 ? 1 : 0].score = Math.max(3, match.teams[emptyIndex === 0 ? 1 : 0].score);
  finishMatch(match, "abandonment");
}

function beginPenaltyShootout(match, now) {
  match.segment = "penalties";
  match.phase = "penalties";
  match.segmentStartedAt = now;
  match.penalties = { score: [0, 0], kicks: [] };
  event(match, "shootout", null, `加时赛仍是 ${match.teams[0].score}:${match.teams[1].score}，点球大战开始。`, { importance: "stage", score: [0, 0] });
}

function shootoutDecided(penalties) {
  const attempts = [0, 0];
  penalties.kicks.forEach((kick) => { attempts[kick.teamIndex] += 1; });
  const remaining = attempts.map((count) => Math.max(0, 5 - count));
  if (penalties.score[0] > penalties.score[1] + remaining[1]) return true;
  if (penalties.score[1] > penalties.score[0] + remaining[0]) return true;
  return attempts[0] >= 5 && attempts[0] === attempts[1] && penalties.score[0] !== penalties.score[1];
}

function takeShootoutKick(match) {
  const penalties = match.penalties;
  const kickIndex = penalties.kicks.length;
  const teamIndex = kickIndex % 2;
  const round = Math.floor(kickIndex / 2);
  const team = match.teams[teamIndex];
  const takers = activePlayers(team).sort((left, right) => attribute(match, team, right, "composure") + attribute(match, team, right, "finishing") - attribute(match, team, left, "composure") - attribute(match, team, left, "finishing"));
  const taker = takers[round % takers.length];
  const opponent = match.teams[teamIndex === 0 ? 1 : 0];
  const keeper = activePlayers(opponent).find((player) => roleGroup(player.assignedRole) === "GK") ?? activePlayers(opponent)[0];
  const conversion = clamp(0.7 + (attribute(match, team, taker, "composure") - attribute(match, opponent, keeper, "reflexes")) / 260, 0.52, 0.88);
  const directions = ["左下角", "右下角", "左上角", "右上角", "中路"];
  const shotDirection = directions[Math.floor(random(match) * directions.length)];
  const keeperDirection = directions[Math.floor(random(match) * directions.length)];
  const scored = chance(match, conversion);
  if (scored) penalties.score[teamIndex] += 1;
  const kick = { teamIndex, round: round + 1, playerId: taker.id, playerName: taker.name, keeperId: keeper.id, keeperName: keeper.name, scored, shotDirection, keeperDirection, score: [...penalties.score] };
  penalties.kicks.push(kick);
  const outcome = scored ? `射向${shotDirection}命中` : `射向${shotDirection}，被${keeper.name}扑出`;
  event(match, "shootout", teamIndex, `第${round + 1}轮，${taker.name}${outcome}。点球比分 ${penalties.score[0]}:${penalties.score[1]}。`, {
    actorId: taker.id, opponentId: keeper.id, scored, score: [...penalties.score], round: round + 1,
    detail: `${keeper.name}判断${keeperDirection}；本次点球不计入球员进球统计。`, importance: "major",
  });
  if (shootoutDecided(penalties)) {
    const winnerIndex = penalties.score[0] > penalties.score[1] ? 0 : 1;
    event(match, "shootout", winnerIndex, `点球大战结束，${match.teams[winnerIndex].name}以 ${penalties.score[0]}:${penalties.score[1]} 获胜。`, { score: [...penalties.score], importance: "stage" });
    finishMatch(match);
  }
}

function finishMatch(match, reason = "normal") {
  if (match.finished) return;
  match.finished = true;
  match.phase = "finished";
  match.reason = reason;
  match.finishedAt = match.lastAdvancedAt;
  const decidingScore = match.aggregateBaseScore
    ? match.teams.map((team, index) => team.score + match.aggregateBaseScore[index])
    : match.teams.map((team) => team.score);
  const winnerIndex = match.penalties ? (match.penalties.score[0] > match.penalties.score[1] ? 0 : 1) : decidingScore[0] === decidingScore[1] ? null : decidingScore[0] > decidingScore[1] ? 0 : 1;
  match.winnerIndex = winnerIndex;
  event(match, "fulltime", winnerIndex, winnerIndex === null ? `比赛结束，双方 ${match.teams[0].score}:${match.teams[1].score} 战平。` : `比赛结束，${match.teams[winnerIndex].name}获胜。`, { importance: "stage" });
  match.report = buildReport(match);
}

function buildReport(match) {
  const possessionTotal = match.teams.reduce((sum, team) => sum + team.stats.possession, 0) || 1;
  return {
    score: match.teams.map((team) => team.score),
    aggregateBaseScore: match.aggregateBaseScore ? [...match.aggregateBaseScore] : null,
    aggregateScore: match.aggregateBaseScore ? match.teams.map((team, index) => team.score + match.aggregateBaseScore[index]) : null,
    competitionMode: match.competitionMode,
    legNumber: match.legNumber,
    penalties: match.penalties?.score ?? null,
    winnerIndex: match.winnerIndex,
    weather: match.weather,
    referee: match.referee,
    blackWhistle: match.blackWhistleTriggered,
    teams: match.teams.map((team) => ({
      name: team.name,
      importedLineup: team.importedLineup,
      tactic: team.tactic,
      style: team.style,
      attackFocus: team.attackFocus,
      defenseFocus: team.defenseFocus,
      styleFit: Number(teamSnapshot(match, team).style.effectiveFit.toFixed(3)),
      markingTargetId: team.markingTargetId,
      markingTargetName: match.teams[team.index === 0 ? 1 : 0].players.find((player) => player.id === team.markingTargetId)?.name ?? null,
      formation: analyzeElevenFormation(activePlayers(team), team.positions).name,
      activeCount: activePlayers(team).length,
      stats: { ...team.stats, possession: Number((team.stats.possession / possessionTotal * 100).toFixed(1)), xg: Number(team.stats.xg.toFixed(2)) },
      players: team.players.map((player) => ({
        id: player.id, name: player.name, role: player.assignedRole, rating: player.rating,
        heightCm: player.heightCm, nationality: player.nationality, club: player.club,
        fitness: Number(player.state.fitness.toFixed(1)), active: player.active, sentOff: player.sentOff, injury: player.injury,
        stats: player.matchStats,
      })).sort((left, right) => right.rating - left.rating),
    })),
    importantEvents: match.events.filter((entry) => ["goal", "red", "injury", "lightning", "blackWhistle", "penaltyAwarded", "penalty", "shootout", "halftime", "fulltime", "tactical"].includes(entry.type)),
    events: match.events,
  };
}

export function createVersusMatch(seats, options = {}) {
  const now = options.now ?? Date.now();
  const seed = options.seed ?? `${seats[0].name}:${seats[1].name}:${now}`;
  const match = {
    version: 1,
    phase: "playing",
    segment: "regular",
    minute: 0,
    lastProcessedMinute: 0,
    segmentStartedAt: now,
    lastAdvancedAt: now,
    randomState: hashSeed(seed),
    competitionMode: options.competitionMode ?? "quick",
    legNumber: Number(options.legNumber ?? 1),
    regulationOnly: Boolean(options.regulationOnly),
    aggregateBaseScore: Array.isArray(options.aggregateBaseScore) ? options.aggregateBaseScore.map(Number) : null,
    weather: null,
    referee: null,
    teams: seats.map((seat, index) => hydrateTeam(seat, index, seed)),
    events: [],
    recordEvents: options.recordEvents !== false,
    pauseUsed: [false, false],
    pause: null,
    halftimeTaken: false,
    lightningMinute: null,
    lightningTriggered: false,
    blackWhistleMinute: null,
    blackWhistleTriggered: false,
    lastGoalMinute: null,
    lastGoalTeamIndex: null,
    penalties: null,
    report: null,
    finished: false,
  };
  match.weather = options.weather && WEATHER[options.weather] ? { key: options.weather, ...WEATHER[options.weather] } : pickWeather(match);
  match.referee = options.referee && VERSUS_REFEREES[options.referee] ? { key: options.referee, ...VERSUS_REFEREES[options.referee] } : pickReferee(match);
  if (match.weather.key === "storm") match.lightningMinute = 18 + Math.floor(random(match) * 58);
  const argentinaCounts = match.teams.map(argentinaCount);
  if (argentinaCounts[0] !== argentinaCounts[1] && chance(match, 0.08)) match.blackWhistleMinute = 20 + Math.floor(random(match) * 56);
  return match;
}

function completePauseIfNeeded(match, now) {
  if (!match.pause || now < match.pause.expiresAt) return;
  match.segmentStartedAt += match.pause.expiresAt - match.pause.startedAt;
  const pause = match.pause;
  const text = pause.kind === "halftime" ? "中场调整时间结束，下半场开始。" : "30 秒战术暂停结束，比赛继续。";
  event(match, "tactical", pause.ownerIndex, text, { importance: "stage" });
  match.pause = null;
}

export function advanceVersusMatch(match, now = Date.now()) {
  if (!match || match.finished) return match;
  match.lastAdvancedAt = now;
  completePauseIfNeeded(match, now);
  if (match.pause) return match;
  if (match.segment === "penalties") {
    const kicksDue = Math.floor(Math.max(0, now - match.segmentStartedAt) / PENALTY_KICK_INTERVAL_MS);
    while (!match.finished && match.penalties.kicks.length < kicksDue) takeShootoutKick(match);
    return match;
  }
  let duration = match.segment === "regular" ? REGULAR_DURATION_MS : EXTRA_DURATION_MS;
  const startMinute = match.segment === "regular" ? 0 : 90;
  const segmentMinutes = match.segment === "regular" ? 90 : 30;
  let elapsed = Math.max(0, now - match.segmentStartedAt);
  if (match.segment === "regular" && !match.halftimeTaken && elapsed >= REGULAR_DURATION_MS / 2) {
    processUntil(match, 45);
    match.halftimeTaken = true;
    const startedAt = match.segmentStartedAt + REGULAR_DURATION_MS / 2;
    match.pause = { kind: "halftime", ownerIndex: null, startedAt, expiresAt: startedAt + HALFTIME_ADJUSTMENT_MS, submitted: [false, false] };
    event(match, "halftime", null, `上半场结束，比分 ${match.teams[0].score}:${match.teams[1].score}。双方拥有 30 秒调整时间。`, { importance: "stage" });
    if (now < match.pause.expiresAt) return match;
    completePauseIfNeeded(match, now);
    elapsed = Math.max(0, now - match.segmentStartedAt);
  }
  const targetMinute = startMinute + Math.min(segmentMinutes, Math.floor(elapsed / duration * segmentMinutes));
  processUntil(match, targetMinute);
  if (match.finished || elapsed < duration) return match;
  if (match.segment === "regular") {
    if (match.regulationOnly) return finishMatch(match);
    const decidingScore = match.aggregateBaseScore
      ? match.teams.map((team, index) => team.score + match.aggregateBaseScore[index])
      : match.teams.map((team) => team.score);
    if (decidingScore[0] !== decidingScore[1]) return finishMatch(match);
    match.segment = "extra";
    match.segmentStartedAt = now;
    event(match, "extra", null, match.aggregateBaseScore
      ? `两回合总比分 ${decidingScore[0]}:${decidingScore[1]}，比赛进入加时赛。`
      : `常规时间 ${match.teams[0].score}:${match.teams[1].score}，比赛进入加时赛。`, { importance: "stage" });
    return match;
  }
  const extraDecidingScore = match.aggregateBaseScore
    ? match.teams.map((team, index) => team.score + match.aggregateBaseScore[index])
    : match.teams.map((team) => team.score);
  if (extraDecidingScore[0] === extraDecidingScore[1]) {
    beginPenaltyShootout(match, now);
    return match;
  }
  finishMatch(match);
  return match;
}

export function requestTacticalPause(match, ownerIndex, now = Date.now()) {
  advanceVersusMatch(match, now);
  if (match.finished || !["regular", "extra"].includes(match.segment)) throw new Error("当前不能申请战术暂停");
  if (match.pause) throw new Error("比赛已经处于暂停状态");
  if (match.pauseUsed[ownerIndex]) throw new Error("本场战术暂停机会已经使用");
  match.pauseUsed[ownerIndex] = true;
  match.pause = { kind: "tactical", ownerIndex, startedAt: now, expiresAt: now + TACTICAL_PAUSE_MS, submitted: [false, false] };
  event(match, "tactical", ownerIndex, `${match.teams[ownerIndex].name}申请战术暂停，双方都有 30 秒调整阵型和战术。`, { importance: "stage" });
  return match;
}

export function updatePausedTactics(match, ownerIndex, payload = {}) {
  if (!match.pause) throw new Error("当前不在调整时间");
  const team = match.teams[ownerIndex];
  const players = activePlayers(team);
  const nextPositions = { ...team.positions, ...sanitizePositions(players, payload.positions) };
  const formation = analyzeElevenFormation(players, nextPositions);
  if (formation.counts.GK > 1) throw new Error("门将位置最多只能安排一名球员");
  if (!TACTICS[payload.tactic]) throw new Error("无效比赛思路");
  if (!MATCH_STYLES[payload.style]) throw new Error("无效比赛战术");
  const attackFocus = payload.attackFocus ?? team.attackFocus ?? "balanced";
  const defenseFocus = payload.defenseFocus ?? team.defenseFocus ?? "balanced";
  if (!["balanced", "left", "center", "right"].includes(attackFocus)) throw new Error("无效主攻方向");
  if (!["balanced", "left", "center", "right"].includes(defenseFocus)) throw new Error("无效主守方向");
  const opponent = match.teams[ownerIndex === 0 ? 1 : 0];
  const markingTargetId = payload.markingTargetId || null;
  const markingTarget = markingTargetId ? opponent.players.find((player) => player.id === markingTargetId && player.active) : null;
  if (markingTargetId && !markingTarget) throw new Error("重点盯防目标必须是对方仍在场的球员");
  team.positions = nextPositions;
  team.tactic = payload.tactic;
  team.style = payload.style;
  team.attackFocus = attackFocus;
  team.defenseFocus = defenseFocus;
  team.markingTargetId = markingTarget?.id ?? null;
  const receivesAdjustmentBoost = match.pause.kind === "tactical";
  if (receivesAdjustmentBoost) team.adjustmentBoostUntilMinute = Math.max(Number(team.adjustmentBoostUntilMinute ?? 0), match.minute + 15);
  team.players.forEach((player) => {
    if (!player.active) return;
    player.boardPosition = { ...team.positions[player.id] };
    player.assignedRole = formation.roles[player.id] ?? player.assignedRole;
  });
  const markingText = markingTarget ? `，并安排重点盯防${markingTarget.name}（压缩其约14%的比赛能力，己方转换风险增加约3.5%）` : "，未设置重点盯防";
  const boostText = receivesAdjustmentBoost ? "；主动暂停调整使球队在随后15分钟获得小幅战术执行力加成" : "";
  const focusNames = { balanced:"均衡", left:"左路", center:"中路", right:"右路" };
  event(match, "tactical", ownerIndex, `${team.name}完成临场调整：阵型改为${formation.name}，比赛思路调整为${TACTICS[team.tactic].name}，改打${MATCH_STYLES[team.style].name}，主攻${focusNames[attackFocus]}、主守${focusNames[defenseFocus]}${markingText}${boostText}。`, {
    importance: "stage", formation: formation.name, tactic: team.tactic, style: team.style, attackFocus, defenseFocus,
    markingTargetId: markingTarget?.id ?? null, markingTargetName: markingTarget?.name ?? null,
    markingTargetFactor: markingTarget ? 0.86 : null, markingTransitionCost: markingTarget ? 1.035 : null,
    detail: markingTarget ? `专人盯防将限制${markingTarget.name}的接球、处理球和终结空间，但会轻微拉扯己方防守站位。目标离场后效果自动失效。` : null,
  });
  return match;
}

export function resumeVersusMatch(match, ownerIndex, now = Date.now()) {
  if (!match.pause) throw new Error("当前不在调整时间");
  if (match.pause.submitted?.[ownerIndex]) throw new Error("你已经完成本次调整");
  match.pause.submitted ??= [false, false];
  match.pause.submitted[ownerIndex] = true;
  event(match, "tactical", ownerIndex, `${match.teams[ownerIndex].name}已完成调整。`, { importance: "stage" });
  if (match.pause.submitted.every(Boolean)) {
    const pause = match.pause;
    match.segmentStartedAt += Math.max(0, now - pause.startedAt);
    match.pause = null;
    match.lastAdvancedAt = now;
    event(match, "tactical", null, pause.kind === "halftime" ? "双方均已确认调整，下半场提前开始。" : "双方均已确认调整，比赛立即继续。", { importance: "stage" });
  }
  return match;
}

export function publicMatch(match, now = Date.now(), viewerIndex = null, revealAllStrategies = false) {
  advanceVersusMatch(match, now);
  const duration = match.segment === "regular" ? REGULAR_DURATION_MS : match.segment === "extra" ? EXTRA_DURATION_MS : PENALTY_KICK_INTERVAL_MS * 10;
  const segmentElapsed = match.pause ? match.pause.startedAt - match.segmentStartedAt : now - match.segmentStartedAt;
  const report = match.report ? {
    ...match.report,
    teams: match.report.teams.map((team, index) => ({
      ...team,
      tactic: revealAllStrategies || index === viewerIndex ? team.tactic : null,
      style: revealAllStrategies || index === viewerIndex ? team.style : null,
      attackFocus: revealAllStrategies || index === viewerIndex ? team.attackFocus : null,
      defenseFocus: revealAllStrategies || index === viewerIndex ? team.defenseFocus : null,
      styleFit: revealAllStrategies || index === viewerIndex ? team.styleFit : null,
    })),
  } : null;
  return structuredClone({
    phase: match.phase,
    segment: match.segment,
    minute: match.minute,
    score: match.teams.map((team) => team.score),
    competitionMode: match.competitionMode,
    legNumber: match.legNumber,
    aggregateBaseScore: match.aggregateBaseScore,
    aggregateScore: match.aggregateBaseScore ? match.teams.map((team, index) => team.score + match.aggregateBaseScore[index]) : null,
    weather: match.weather,
    referee: match.referee,
    blackWhistle: match.blackWhistleTriggered,
    teams: match.teams.map((team, index) => ({
      name: team.name,
      importedLineup: team.importedLineup,
      tactic: revealAllStrategies || index === viewerIndex ? team.tactic : null,
      style: revealAllStrategies || index === viewerIndex ? team.style : null,
      attackFocus: revealAllStrategies || index === viewerIndex ? team.attackFocus : null,
      defenseFocus: revealAllStrategies || index === viewerIndex ? team.defenseFocus : null,
      styleFit: revealAllStrategies || index === viewerIndex ? Number(teamSnapshot(match, team).style.effectiveFit.toFixed(3)) : null,
      markingTargetId: team.markingTargetId,
      formation: analyzeElevenFormation(activePlayers(team), team.positions).name,
      activeCount: activePlayers(team).length,
      positions: team.positions,
      stats: { ...team.stats, xg: Number(team.stats.xg.toFixed(2)) },
      players: team.players.map((player) => ({
        id: player.id, name: player.name, role: player.role, assignedRole: player.assignedRole,
        secondaryRole: player.secondaryRole, grade: player.grade,
        heightCm: player.heightCm, nationality: player.nationality, club: player.club,
        traits: player.traitDefinitions?.map(({ id, name, summary }) => ({ id, name, summary })) ?? [],
        overall: player.overall, position: team.positions[player.id], active: player.active,
        sentOff: player.sentOff, injury: player.injury, fitness: Number(player.state.fitness.toFixed(1)),
        rating: player.rating, stats: player.matchStats,
      })),
    })),
    events: match.events,
    pauseUsed: match.pauseUsed,
    pause: match.pause ? { kind: match.pause.kind, ownerIndex: match.pause.ownerIndex, submitted: [...(match.pause.submitted ?? [false, false])], remainingMs: Math.max(0, match.pause.expiresAt - now) } : null,
    remainingMs: match.finished || match.segment === "penalties" ? 0 : Math.max(0, duration - segmentElapsed),
    penalties: match.penalties,
    winnerIndex: match.winnerIndex ?? null,
    report,
  });
}
