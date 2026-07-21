import { Random } from "./random.js";
import {
  SEVEN_A_SIDE,
  heightAerialModifier,
  normalizePlayerSchema,
  positionFitScore,
  roleGroup,
} from "../game/public/schema.js";
import {
  hasTraitRule,
  injuryImmune,
  teamTraitRules,
  traitAdjustedAttribute,
  traitConditionMatches,
  traitPositionFit,
  traitRuleProduct,
  traitRules,
  weatherPenaltyMultiplier,
} from "../game/public/trait-runtime.js";

const DEFAULT_CONTEXT = {
  minutes: 90,
  basePossessions: 160,
  homeAdvantage: 3.2,
  weather: {
    type: "sunny",
    precipitation: 10,
    wind: 10,
    temperature: 18,
    lightningChance: 0,
    lightningFitnessLossMin: 8,
    lightningFitnessLossMax: 16,
    lightningMoraleLossMin: 2,
    lightningMoraleLossMax: 6,
  },
  pitchQuality: 85,
  referee: {
    strictness: 50,
    penaltyBias: 50,
    homeBias: 50,
  },
};

const DEFAULT_TACTICS = {
  tempo: 50,
  directness: 50,
  width: 50,
  pressing: 50,
  defensiveLine: 50,
  risk: 50,
  tackleIntensity: 50,
  counterAttack: 50,
  crossing: 50,
  setPieceFocus: 50,
  timeWasting: 20,
};

const DEFAULT_FORMATION = {
  name: "2-3-1",
  defensiveBalance: 50,
  midfieldDensity: 50,
  attackingNumbers: 50,
  width: 50,
  transitionRisk: 50,
  coherence: 70,
};

const DEFAULT_COACH = {
  attack: 50,
  defense: 50,
  adaptability: 50,
  substitutions: 50,
};

const ATTRIBUTE_DEFAULT = 50;
const EPSILON = 1e-9;
const INJURY_PERFORMANCE = Object.freeze({ none: 1, knock: 0.96, minor: 0.9, moderate: 0.76, severe: 0.58, careerEnding: 0 });

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function logistic(value) {
  return 1 / (1 + Math.exp(-value));
}

function logit(probability) {
  const bounded = clamp(probability, EPSILON, 1 - EPSILON);
  return Math.log(bounded / (1 - bounded));
}

function average(values, fallback = 50) {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function attribute(player, name, traitContext = {}) {
  return traitAdjustedAttribute(player, name, player.attributes?.[name] ?? ATTRIBUTE_DEFAULT, traitContext);
}

function mentalStrength(player) {
  const h = player.hidden ?? {};
  return attribute(player, "composure") * 0.23 + attribute(player, "decisions") * 0.18 + attribute(player, "discipline") * 0.08 + Number(h.mentality ?? 50) * 0.2 + Number(h.pressure ?? 50) * 0.13 + Number(h.consistency ?? 50) * 0.1 + Number(h.leadership ?? 50) * 0.08;
}

function physicalQuality(player) {
  return attribute(player, "strength") * 0.23 + attribute(player, "stamina") * 0.2 + attribute(player, "pace") * 0.14 + attribute(player, "acceleration") * 0.1 + attribute(player, "agility") * 0.12 + attribute(player, "jumping") * 0.12 + attribute(player, "workRate") * 0.09;
}

function injuryAvailability(player) {
  return INJURY_PERFORMANCE[player.state?.injury?.severity ?? "none"] ?? 1;
}

function mergeContext(context = {}) {
  return {
    ...DEFAULT_CONTEXT,
    ...context,
    weather: { ...DEFAULT_CONTEXT.weather, ...context.weather },
    referee: { ...DEFAULT_CONTEXT.referee, ...context.referee },
  };
}

function teamSettings(team) {
  return {
    tactics: { ...DEFAULT_TACTICS, ...team.tactics },
    formation: { ...DEFAULT_FORMATION, ...team.formation },
    coach: { ...DEFAULT_COACH, ...team.coach },
  };
}

function playerStateAdjustment(player) {
  const state = player.state ?? {};
  const volatility = Number(player.hidden?.volatility ?? 50);
  const moraleSensitivity = 0.72 + volatility / 180;
  const consistency = Number(player.hidden?.consistency ?? 50);
  return (
    ((state.form ?? 50) - 50) * (0.035 + consistency / 2600) +
    ((state.morale ?? 50) - 50) * 0.04 * moraleSensitivity +
    (mentalStrength(player) - 50) * 0.018 +
    ((state.fitness ?? 100) - 100) * 0.16
  );
}

function fatiguePenalty(player, minute, tactics, context) {
  const traitContext = { ...context, minute, tactics };
  const stamina = attribute(player, "stamina", traitContext);
  const physical = physicalQuality(player);
  const pressLoad = 0.75 + tactics.pressing / 180;
  const tempoLoad = 0.8 + tactics.tempo / 250;
  const weatherLoad =
    1 +
    (context.weather.precipitation / 500 + Math.max(0, context.weather.temperature - 25) / 100) * weatherPenaltyMultiplier(player);
  const staminaLoad = 3.2 + (100 - stamina) * 0.055 + (62 - physical) * 0.025;
  const injuryLoad = (1 - injuryAvailability(player)) * 5.5;
  let penalty = (minute / context.minutes) * pressLoad * tempoLoad * weatherLoad * staminaLoad + injuryLoad;
  for (const rule of traitRules(player, "fatigue")) {
    if (!traitConditionMatches(rule.when, player, traitContext)) continue;
    penalty = penalty * (Number(rule.multiplyPenalty) || 1) + (Number(rule.addPenalty) || 0);
  }
  return penalty;
}

function playerMetric(player, weights, minute, tactics, context) {
  let totalWeight = 0;
  let value = 0;
  for (const [name, weight] of Object.entries(weights)) {
    value += attribute(player, name, { ...context, minute, tactics }) * weight;
    totalWeight += weight;
  }
  const base = totalWeight > 0 ? value / totalWeight : ATTRIBUTE_DEFAULT;
  const adjusted = (base + playerStateAdjustment(player) - fatiguePenalty(player, minute, tactics, context)) * injuryAvailability(player);
  return adjusted * traitPositionFit(player, positionFitScore(player, player.assignedRole ?? player.role));
}

function aerialPlayerMetric(player, minute, tactics, context, defensive = false) {
  const weights = defensive
    ? { heading: 0.34, jumping: 0.27, strength: 0.19, positioning: 0.13, composure: 0.07 }
    : { heading: 0.39, jumping: 0.27, strength: 0.17, offBall: 0.11, composure: 0.06 };
  return playerMetric(player, weights, minute, tactics, context) + heightAerialModifier(player.heightCm);
}

function groupMetric(players, groups, weights, minute, tactics, context) {
  let selected = players.filter((player) => groups.includes(roleGroup(player.assignedRole ?? player.role)));
  if (selected.length === 0) selected = players;
  return average(
    selected.map((player) => playerMetric(player, weights, minute, tactics, context)),
  );
}

function topMetric(players, weights, count, minute, tactics, context) {
  const values = players
    .map((player) => playerMetric(player, weights, minute, tactics, context))
    .sort((left, right) => right - left)
    .slice(0, count);
  return average(values);
}

function activePlayers(runtime) {
  return runtime.lineup.filter(
    (player) => !runtime.sentOff.has(player.id) && !runtime.injuredOut.has(player.id),
  );
}

function applyTeamTraitMetrics(metrics, runtime, players, minute, context, tactics) {
  const phaseMap = {
    attacking: ["chanceCreation", "finishing"],
    buildUp: ["buildUp"],
    progression: ["progression"],
    chanceCreation: ["chanceCreation"],
    press: ["press"],
    defending: ["defending", "midfieldDefense"],
    transitionDefense: ["transitionDefense"],
    shotStopping: ["shotStopping"],
    setPieceAttack: ["setPieceAttack"],
    setPieceDefense: ["setPieceDefense"],
    secondBall: ["aerialAttack", "aerialDefense"],
  };
  const ruleContext = { ...context, minute, tactics };
  for (const { player, ...rule } of teamTraitRules(players, "phase", ruleContext)) {
    const phases = Array.isArray(rule.phase) ? rule.phase : [rule.phase];
    const amount = Number(rule.addRating ?? rule.addTeamRating) || 0;
    for (const phase of phases) for (const metric of phaseMap[phase] ?? []) metrics[metric] = (metrics[metric] ?? 0) + amount;
  }

  for (const rule of teamTraitRules(runtime.bench ?? [], "benchAura", ruleContext)) {
    for (const [metric, amount] of Object.entries(rule.addTeamRating ?? {})) {
      const targets = metric === "attack" ? ["chanceCreation", "finishing", "progression"] : [metric];
      for (const target of targets) metrics[target] = (metrics[target] ?? 0) + Number(amount || 0);
    }
  }

  const wolfCarriers = players.filter((player) => traitRules(player, "stackingMetric").some((rule) => rule.metric === "pressDefense"));
  for (const player of wolfCarriers) {
    const rule = traitRules(player, "stackingMetric").find((entry) => entry.metric === "pressDefense");
    const multiplier = Math.min(Number(rule.maximum) || 1.3, (Number(rule.baseMultiplier) || 1.1) + Math.max(0, wolfCarriers.length - 1) * (Number(rule.addPerCarrier) || 0));
    const contribution = playerMetric(player, { workRate: 0.32, stamina: 0.24, aggression: 0.18, tackling: 0.14, positioning: 0.12 }, minute, tactics, context) / Math.max(1, players.length);
    const bonus = contribution * (multiplier - 1);
    metrics.press += bonus;
    metrics.defending += bonus * 0.75;
    metrics.midfieldDefense += bonus * 0.55;
  }

  for (const player of players) {
    for (const rule of traitRules(player, "metricContribution")) {
      if (!traitConditionMatches(rule.when, player, ruleContext)) continue;
      const multiplier = Number(rule.multiply) || 1;
      if (rule.metric === "defense") {
        const contribution = playerMetric(player, { tackling: 0.3, marking: 0.24, positioning: 0.2, strength: 0.12, pace: 0.08, workRate: 0.06 }, minute, tactics, context) / Math.max(1, players.length);
        const delta = contribution * (multiplier - 1);
        metrics.defending += delta;
        metrics.transitionDefense += delta * 0.8;
        metrics.midfieldDefense += delta * 0.55;
      }
    }
  }

  const flankOf = (player) => {
    const x = Number(player.boardPosition?.x);
    const role = player.assignedRole ?? player.role;
    if (Number.isFinite(x)) return x <= 38 ? "left" : x >= 62 ? "right" : null;
    if (["LB", "LM", "LW"].includes(role)) return "left";
    if (["RB", "RM", "RW"].includes(role)) return "right";
    return null;
  };
  for (const player of players) {
    const flank = flankOf(player);
    if (!flank || roleGroup(player.assignedRole ?? player.role) !== "ATT") continue;
    for (const rule of traitRules(player, "flankIsolation")) {
      const sameFlankTeammates = players.filter((candidate) => candidate.id !== player.id && flankOf(candidate) === flank).length;
      const multiplier = sameFlankTeammates === 0
        ? Number(rule.soloMultiplier) || 1
        : (Number(rule.multiplyPerTeammate) || 1) ** sameFlankTeammates;
      const contribution = playerMetric(player, { offBall: 0.24, pace: 0.2, dribbling: 0.18, crossing: 0.15, finishing: 0.13, decisions: 0.1 }, minute, tactics, context) / Math.max(1, players.length);
      const delta = contribution * (multiplier - 1);
      metrics.progression += delta * 0.75;
      metrics.chanceCreation += delta;
      metrics.finishing += delta * 0.65;
    }
  }

  const bond = runtime.team.bondBonus ?? {};
  metrics.chanceCreation += Number(bond.attack ?? 0);
  metrics.finishing += Number(bond.attack ?? 0);
  metrics.buildUp += Number(bond.midfield ?? 0);
  metrics.progression += Number(bond.midfield ?? 0);
  metrics.midfieldControl += Number(bond.midfield ?? 0);
  metrics.defending += Number(bond.defense ?? 0);
  metrics.transitionDefense += Number(bond.defense ?? 0);
  metrics.shotStopping += Number(bond.goalkeeping ?? 0);
  metrics.goalkeeper += Number(bond.goalkeeping ?? 0);
  metrics.press += Number(bond.pressing ?? 0);
}

export function deriveTeamMetrics(runtime, minute, rawContext = {}) {
  const context = mergeContext(rawContext);
  const cacheKey = [
    runtime.version ?? 0,
    Math.floor(minute / 4),
    context.minutes,
    context.pitchQuality,
    context.weather.precipitation,
    context.weather.wind,
    context.weather.temperature,
    context.weather.type,
    context.weather.lightningChance,
    runtime.stats?.goals ?? 0,
    runtime.opponent?.stats?.goals ?? 0,
  ].join(":");
  if (runtime.metricCache?.has(cacheKey)) {
    return runtime.metricCache.get(cacheKey);
  }
  const { tactics, formation, coach } = teamSettings(runtime.team);
  const players = activePlayers(runtime);
  const initialSize = runtime.initialLineupSize;
  const missingPlayers = Math.max(0, initialSize - players.length);
  const teamState =
    ((runtime.team.chemistry ?? 50) - 50) * 0.055 +
    ((runtime.team.morale ?? 50) - 50) * 0.04 +
    ((runtime.team.form ?? 50) - 50) * 0.035;
  const teamMentalStrength = average(players.map(mentalStrength), 50);
  const teamPhysicalQuality = average(players.map(physicalQuality), 50);
  const leaderAura = average(players.filter((player) => player.hidden?.personality === "leader").map((player) => Number(player.hidden?.leadership ?? 50)), 0);
  const teamworkAura = average(players.filter((player) => player.hidden?.personality === "teamPlayer").map((player) => Number(player.hidden?.teamwork ?? 50)), 0);
  const scoreDifference = (runtime.stats?.goals ?? 0) - (runtime.opponent?.stats?.goals ?? 0);
  Object.assign(context, {
    minute,
    tactics,
    scoreDifference,
    scoreState: scoreDifference > 0 ? "leading" : scoreDifference < 0 ? "trailing" : "tied",
    playerDeficit: missingPlayers,
    venue: runtime.side === "home" ? "home" : "away",
  });
  const matchProgress = clamp(minute / Math.max(1, context.minutes), 0, 1.35);
  const trailingResponse = scoreDifference < 0
    ? (teamMentalStrength - 55) * (0.025 + matchProgress * 0.055) + players.filter((player) => player.hidden?.personality === "resilient").length * 0.45
    : 0;
  const leadingResponse = scoreDifference > 0
    ? (teamMentalStrength - 55) * (0.018 + matchProgress * 0.032)
    : 0;
  const pressureResponse = (teamMentalStrength - 55) * Math.max(0, matchProgress - 0.72) * 0.045;
  const mentalResponse = (teamMentalStrength - 55) * 0.025 + trailingResponse + leadingResponse + pressureResponse + leaderAura * 0.012 + teamworkAura * 0.008;

  const goalkeeper = groupMetric(
    players,
    ["GK"],
    { goalkeeping: 0.46, reflexes: 0.27, positioning: 0.17, composure: 0.1 },
    minute,
    tactics,
    context,
  );
  const defenderCore = groupMetric(
    players,
    ["DEF"],
    { tackling: 0.25, marking: 0.25, positioning: 0.21, decisions: 0.11, strength: 0.1, pace: 0.08 },
    minute,
    tactics,
    context,
  );
  const midfieldDefense = groupMetric(
    players,
    ["MID"],
    { tackling: 0.24, positioning: 0.22, workRate: 0.2, decisions: 0.15, stamina: 0.11, strength: 0.08 },
    minute,
    tactics,
    context,
  );
  const midfield = groupMetric(
    players,
    ["MID"],
    { passing: 0.25, firstTouch: 0.16, vision: 0.2, decisions: 0.17, composure: 0.1, stamina: 0.12 },
    minute,
    tactics,
    context,
  );
  const defenderBuildUp = groupMetric(
    players,
    ["DEF"],
    { passing: 0.34, firstTouch: 0.16, decisions: 0.24, composure: 0.16, vision: 0.1 },
    minute,
    tactics,
    context,
  );
  const attackReception = groupMetric(
    players,
    ["ATT"],
    { firstTouch: 0.25, offBall: 0.23, strength: 0.12, pace: 0.13, decisions: 0.14, composure: 0.13 },
    minute,
    tactics,
    context,
  );
  const progression = groupMetric(
    players,
    ["MID", "ATT"],
    { passing: 0.2, dribbling: 0.18, vision: 0.18, firstTouch: 0.13, pace: 0.11, decisions: 0.13, offBall: 0.07 },
    minute,
    tactics,
    context,
  );
  const creation = groupMetric(
    players,
    ["MID", "ATT"],
    { vision: 0.23, passing: 0.2, dribbling: 0.15, offBall: 0.16, decisions: 0.16, crossing: 0.1 },
    minute,
    tactics,
    context,
  );
  const finishing = groupMetric(
    players,
    ["ATT"],
    { finishing: 0.43, composure: 0.21, offBall: 0.18, firstTouch: 0.08, heading: 0.1 },
    minute,
    tactics,
    context,
  );
  const press = groupMetric(
    players,
    ["DEF", "MID", "ATT"],
    { workRate: 0.27, stamina: 0.23, aggression: 0.14, pace: 0.14, decisions: 0.12, positioning: 0.1 },
    minute,
    tactics,
    context,
  );
  const pressResistance = groupMetric(
    players,
    ["DEF", "MID"],
    { firstTouch: 0.24, passing: 0.24, composure: 0.2, decisions: 0.2, agility: 0.12 },
    minute,
    tactics,
    context,
  );
  const transitionDefense = groupMetric(
    players,
    ["DEF", "MID"],
    { positioning: 0.23, pace: 0.2, decisions: 0.19, workRate: 0.16, tackling: 0.14, stamina: 0.08 },
    minute,
    tactics,
    context,
  );
  let aerialPlayers = players.filter((player) => ["DEF", "ATT"].includes(roleGroup(player.assignedRole ?? player.role)));
  if (!aerialPlayers.length) aerialPlayers = players;
  const aerialAttack = average(aerialPlayers.map((player) => aerialPlayerMetric(player, minute, tactics, context)));
  let aerialDefenders = players.filter((player) => ["GK", "DEF"].includes(roleGroup(player.assignedRole ?? player.role)));
  if (!aerialDefenders.length) aerialDefenders = players;
  const aerialDefense = average(aerialDefenders.map((player) => aerialPlayerMetric(player, minute, tactics, context, true)));
  const discipline = groupMetric(
    players,
    ["DEF", "MID", "ATT"],
    { composure: 0.32, decisions: 0.3, discipline: 0.25, aggression: -0.13 },
    minute,
    tactics,
    context,
  );
  const setPieceTaker = topMetric(
    players,
    { setPieces: 0.56, crossing: 0.18, longShots: 0.13, composure: 0.13 },
    3,
    minute,
    tactics,
    context,
  );
  const stamina = groupMetric(
    players,
    ["DEF", "MID", "ATT"],
    { stamina: 0.65, workRate: 0.35 },
    minute,
    tactics,
    context,
  );

  const shared = teamState + mentalResponse;
  const shortHandAttack = missingPlayers * 4.7;
  const shortHandDefense = missingPlayers * 6.2;
  const weatherProtected = players.filter((player) => weatherPenaltyMultiplier(player) === 0).length / Math.max(1, players.length);
  const rainPassingPenalty =
    (context.weather.precipitation / 100) * (100 - context.pitchQuality) * 0.07 * (1 - weatherProtected);
  const coachAttack = (coach.attack - 50) * 0.045;
  const coachDefense = (coach.defense - 50) * 0.045;

  const metrics = {
    goalkeeper: goalkeeper + shared - missingPlayers * 1.4,
    defending:
      defenderCore * 0.77 +
      midfieldDefense * 0.23 +
      shared +
      (formation.defensiveBalance - 50) * 0.12 +
      (formation.coherence - 50) * 0.04 +
      coachDefense -
      shortHandDefense,
    midfieldDefense:
      midfieldDefense +
      shared +
      (formation.midfieldDensity - 50) * 0.08 +
      (formation.defensiveBalance - 50) * 0.03 +
      (formation.coherence - 50) * 0.035 -
      missingPlayers * 5.2,
    midfieldControl:
      midfield +
      shared +
      (formation.midfieldDensity - 50) * 0.11 +
      (formation.coherence - 50) * 0.05 +
      (coach.adaptability - 50) * 0.025 -
      missingPlayers * 5.4 -
      rainPassingPenalty,
    buildUp:
      defenderBuildUp * 0.34 +
      midfield * 0.47 +
      pressResistance * 0.11 +
      goalkeeper * 0.08 +
      shared +
      (formation.midfieldDensity - 50) * 0.04 +
      (formation.coherence - 50) * 0.04 -
      (formation.transitionRisk - 50) * 0.02 +
      coachAttack -
      shortHandAttack -
      rainPassingPenalty,
    progression:
      progression * 0.72 +
      attackReception * 0.28 +
      shared +
      (formation.attackingNumbers - 50) * 0.05 +
      (formation.width - 50) * 0.03 -
      (formation.transitionRisk - 50) * 0.015 +
      coachAttack -
      shortHandAttack -
      rainPassingPenalty * 0.7,
    chanceCreation:
      creation +
      shared +
      (formation.attackingNumbers - 50) * 0.12 +
      (formation.width - 50) * 0.035 +
      (formation.coherence - 50) * 0.025 +
      coachAttack -
      shortHandAttack,
    finishing: finishing + shared + (formation.attackingNumbers - 50) * 0.07 + coachAttack - missingPlayers * 2.8,
    press:
      press +
      shared +
      (formation.attackingNumbers - 50) * 0.03 +
      (teamPhysicalQuality - 55) * 0.045 +
      (coach.defense - 50) * 0.025 -
      missingPlayers * 5.6,
    pressResistance: pressResistance + shared - missingPlayers * 4.3,
    transitionDefense:
      transitionDefense +
      shared +
      (teamPhysicalQuality - 55) * 0.035 +
      (formation.defensiveBalance - 50) * 0.1 -
      (formation.transitionRisk - 50) * 0.08 +
      (formation.coherence - 50) * 0.04 +
      coachDefense -
      shortHandDefense,
    shotStopping: goalkeeper * 0.86 + defenderCore * 0.14 + shared + (formation.defensiveBalance - 50) * 0.03 + coachDefense,
    aerialAttack: aerialAttack + shared - shortHandAttack,
    setPieceAttack:
      setPieceTaker * 0.58 +
      aerialAttack * 0.42 +
      (tactics.setPieceFocus - 50) * 0.045 +
      shared,
    setPieceDefense:
      defenderCore * 0.39 +
      goalkeeper * 0.24 +
      aerialDefense * 0.37 +
      shared -
      missingPlayers * 5.5,
    discipline: discipline + shared,
    stamina: stamina * 0.78 + teamPhysicalQuality * 0.22 + shared,
    mentalStrength: teamMentalStrength,
    physicalQuality: teamPhysicalQuality,
    mentalResponse,
    activePlayers: players.length,
  };
  applyTeamTraitMetrics(metrics, runtime, players, minute, context, tactics);
  runtime.metricCache?.set(cacheKey, metrics);
  return metrics;
}

function clonePlayer(player) {
  return normalizePlayerSchema(player);
}

function makeRuntime(team, side) {
  if (team.lineup.length !== SEVEN_A_SIDE.starters) {
    throw new Error(`${team.name ?? side} must have exactly ${SEVEN_A_SIDE.starters} starters for seven-a-side simulation`);
  }
  if ((team.bench ?? []).length > SEVEN_A_SIDE.benchLimit) {
    throw new Error(`${team.name ?? side} may have at most ${SEVEN_A_SIDE.benchLimit} bench players for seven-a-side simulation`);
  }
  return {
    side,
    team,
    lineup: team.lineup.map(clonePlayer),
    bench: (team.bench ?? []).map(clonePlayer),
    initialLineupSize: team.lineup.length,
    sentOff: new Set(),
    injuredOut: new Set(),
    injuriesByPlayer: new Map(),
    pendingInjury: null,
    autoInjurySubstitution: true,
    yellowsByPlayer: new Map(),
    guaranteedInjuriesTriggered: new Set(),
    traitTriggers: new Set(),
    substitutionIndex: 0,
    version: 0,
    metricCache: new Map(),
    stats: {
      goals: 0,
      xg: 0,
      shots: 0,
      shotsOnTarget: 0,
      possessionSequences: 0,
      fouls: 0,
      yellows: 0,
      reds: 0,
      corners: 0,
      substitutions: 0,
      injuries: 0,
      lightningHits: 0,
    },
  };
}

function touchRuntime(runtime) {
  runtime.version += 1;
  runtime.metricCache.clear();
}

function tacticsFor(runtime) {
  return { ...DEFAULT_TACTICS, ...runtime.team.tactics };
}

function matchBehavior(runtime, opponent, minute, context) {
  const goalDifference = runtime.stats.goals - opponent.stats.goals;
  const progress = minute / context.minutes;
  let attack = 0;
  let control = 0;
  let defense = 0;
  let counter = 0;

  if (goalDifference < 0 && progress > 0.55) {
    const urgency = Math.min(2, -goalDifference) * (progress - 0.45);
    attack += 5.2 * urgency;
    control += 2.8 * urgency;
    defense -= 3.4 * urgency;
  }
  if (goalDifference > 0 && progress > 0.65) {
    const protection = Math.min(2, goalDifference) * (progress - 0.55);
    attack -= 2.4 * protection;
    control -= 1.5 * protection;
    defense += 3.5 * protection;
    counter += 3.2 * protection;
  }

  return { attack, control, defense, counter };
}

function pickOffender(runtime, rng) {
  const players = activePlayers(runtime).filter((player) => (player.assignedRole ?? player.role) !== "GK");
  return rng.weighted(
    players,
    (player) =>
      0.4 + attribute(player, "aggression") / 45 + attribute(player, "tackling") / 120,
  );
}

function pickVictim(runtime, rng) {
  const players = activePlayers(runtime).filter((player) => (player.assignedRole ?? player.role) !== "GK");
  return rng.weighted(
    players,
    (player) =>
      0.5 + attribute(player, "dribbling") / 55 + attribute(player, "pace") / 100,
  );
}

function shooterWeight(player) {
  const roleWeights = {
    GK: 0.03,
    CB: 0.35,
    LB: 0.7,
    RB: 0.7,
    FB: 0.7,
    WB: 1.0,
    DM: 0.8,
    CM: 1.25,
    AM: 2.35,
    LM: 1.8,
    RM: 1.8,
    WM: 2.0,
    LW: 2.8,
    RW: 2.8,
    W: 2.8,
    CF: 4.2,
    ST: 4.8,
  };
  return (
    (roleWeights[player.assignedRole ?? player.role] ?? 1.8) *
    (0.45 + attribute(player, "offBall") / 100) *
    (0.6 + attribute(player, "finishing") / 160)
  );
}

function pickShooter(runtime, type, rng) {
  const players = activePlayers(runtime);
  if (type === "penalty" || type === "freeKick") {
    return rng.weighted(
      players,
      (player) => {
        const specialist = traitRules(player, "setPieceTaker")
          .filter((rule) => !rule.shotType || rule.shotType === type)
          .reduce((value, rule) => value * (Number(rule.multiplyWeight) || 1), 1);
        return Math.max(attribute(player, "setPieces"), attribute(player, "finishing")) ** 2 * specialist;
      },
    );
  }
  if (type === "corner" || type === "cross") {
    return rng.weighted(
      players,
      (player) => shooterWeight(player) * (0.35 + (attribute(player, "heading") + attribute(player, "jumping") * 0.55 + heightAerialModifier(player.heightCm)) / 72) * traitRules(player, "shooterSelection").filter((rule) => !rule.shotTypes || rule.shotTypes.includes(type)).reduce((value, rule) => value * (Number(rule.multiplyWeight) || 1), 1),
    );
  }
  return rng.weighted(players, (player) => shooterWeight(player) * traitRules(player, "shooterSelection").filter((rule) => !rule.shotTypes || rule.shotTypes.includes(type)).reduce((value, rule) => value * (Number(rule.multiplyWeight) || 1), 1));
}

function pickAssister(runtime, shooter, type, rng) {
  if (["penalty", "freeKick"].includes(type) || !rng.bool(0.72)) return null;
  const candidates = activePlayers(runtime).filter((player) => player.id !== shooter.id);
  return rng.weighted(candidates, (player) =>
    0.35 + attribute(player, "passing") / 80 + attribute(player, "vision") / 75 + attribute(player, "decisions") / 120,
  );
}

function chooseShotType(attacking, defending, rng) {
  const attackTactics = tacticsFor(attacking);
  const defenseTactics = tacticsFor(defending);
  const weights = [
    {
      type: "throughBall",
      weight: 0.28 + (100 - attackTactics.directness) / 500,
    },
    {
      type: "cutback",
      weight: 0.19 + attackTactics.width / 650,
    },
    {
      type: "cross",
      weight:
        0.11 + attackTactics.crossing / 300 + attackTactics.width / 700,
    },
    {
      type: "longShot",
      weight:
        0.08 + attackTactics.directness / 650 + defenseTactics.defensiveLine / 1200,
    },
    {
      type: "counter",
      weight:
        0.08 +
        attackTactics.counterAttack / 380 +
        defenseTactics.defensiveLine / 700 +
        defenseTactics.risk / 1000,
    },
  ];
  return rng.weighted(weights, (entry) => entry.weight).type;
}

const BASE_XG = {
  throughBall: 0.145,
  cutback: 0.16,
  cross: 0.075,
  longShot: 0.035,
  counter: 0.18,
  freeKick: 0.06,
  corner: 0.085,
  penalty: 0.76,
};

function recordEvent(events, enabled, event) {
  if (enabled) events.push(event);
}

function maybeLightningStrike(session, minute) {
  const { context, rng, events, recordEvents } = session;
  if (context.weather.type !== "storm") return null;
  const chance = clamp(Number(context.weather.lightningChance ?? 0.006), 0, 1);
  if (!rng.bool(chance)) return null;
  const affected = rng.bool(0.5) ? session.home : session.away;
  const candidates = activePlayers(affected).filter((candidate) => !injuryImmune(candidate));
  if (!candidates.length) return null;
  const player = rng.weighted(candidates, (candidate) => traitRules(candidate, "lightningTarget").reduce((value, rule) => value * (Number(rule.multiplyWeight) || 1), 1));
  const fitnessMinimum = clamp(Number(context.weather.lightningFitnessLossMin ?? 8), 0, 100);
  const fitnessMaximum = clamp(Number(context.weather.lightningFitnessLossMax ?? 16), fitnessMinimum, 100);
  const moraleMinimum = clamp(Number(context.weather.lightningMoraleLossMin ?? 2), 0, 100);
  const moraleMaximum = clamp(Number(context.weather.lightningMoraleLossMax ?? 6), moraleMinimum, 100);
  const fitnessLoss = Math.round(rng.range(fitnessMinimum, fitnessMaximum + 1));
  const moraleLoss = Math.round(rng.range(moraleMinimum, moraleMaximum + 1));
  player.state = { ...player.state, morale: Math.max(1, Number(player.state?.morale ?? 50) - moraleLoss) };
  affected.stats.lightningHits += 1;
  const injury = registerMatchInjury(affected, player, minute, { severity: "severe", matchesOut: 5 }, {
    cause: "lightning", forceUnavailable: true, fitnessLoss, events, recordEvents,
  });
  const eventIndex = events.findLastIndex((entry) => entry.type === "injury" && entry.playerId === player.id);
  if (eventIndex >= 0) {
    events[eventIndex] = {
      ...events[eventIndex],
      type: "lightning",
      fitnessLoss,
      moraleLoss,
    };
  }
  return injury ? events[eventIndex] ?? injury : null;
}

function takeShot({
  attacking,
  defending,
  attackMetrics,
  defenseMetrics,
  minute,
  type,
  context,
  rng,
  events,
  recordEvents,
  allowCorner = true,
}) {
  const shooter = pickShooter(attacking, type, rng);
  if (!shooter) return;

  const shooterFinishing = playerMetric(
    shooter,
    type === "corner" || type === "cross"
      ? { heading: 0.48, strength: 0.18, offBall: 0.2, composure: 0.14 }
      : type === "longShot" || type === "freeKick"
        ? { longShots: 0.43, finishing: 0.2, composure: 0.22, setPieces: 0.15 }
        : { finishing: 0.5, composure: 0.24, offBall: 0.16, firstTouch: 0.1 },
    minute,
    tacticsFor(attacking),
    context,
  );
  const heightFinishingBonus = ["corner", "cross"].includes(type) ? heightAerialModifier(shooter.heightCm) : 0;

  const windPenalty =
    ["cross", "longShot", "freeKick", "corner"].includes(type)
      ? context.weather.wind / 450
      : 0;
  const creationEdge =
    type === "penalty"
      ? 0
      : (attackMetrics.chanceCreation - defenseMetrics.defending) / 58;
  let chanceXg = clamp(
    logistic(logit(BASE_XG[type]) + creationEdge - windPenalty),
    0.008,
    type === "penalty" ? 0.82 : 0.52,
  );
  for (const rule of traitRules(shooter, "shotType")) {
    if (rule.shotType === type && traitConditionMatches(rule.when, shooter, { ...context, minute, shotType: type, xg: chanceXg })) {
      chanceXg *= Number(rule.multiplyXg) || 1;
    }
  }
  chanceXg = clamp(chanceXg, 0.004, type === "penalty" ? 0.9 : 0.65);
  const finishingEdge =
    type === "penalty"
      ? (shooterFinishing - 65) / 70
      : ["corner", "cross"].includes(type)
        ? (shooterFinishing + heightFinishingBonus - (defenseMetrics.setPieceDefense * 0.58 + defenseMetrics.shotStopping * 0.42)) / 34
        : (shooterFinishing - defenseMetrics.shotStopping) / 34;
  let goalProbability = clamp(
    logistic(logit(chanceXg) + finishingEdge),
    0.004,
    type === "penalty" ? 0.88 : 0.64,
  );
  const shotRuleContext = { ...context, minute, shotType: type, xg: chanceXg };
  for (const rule of traitRules(shooter, "shot")) {
    if ((!rule.shotType || rule.shotType === type) && traitConditionMatches(rule.when, shooter, shotRuleContext)) {
      goalProbability = goalProbability * (Number(rule.multiplyGoalProbability) || 1) + (Number(rule.addGoalProbability) || 0);
    }
  }
  if (type === "penalty") {
    goalProbability *= clamp(1 + Number(attacking.team.bondBonus?.penaltyConversion ?? 0) / 100, 0.1, 2);
  }
  const defendingGoalkeeper = activePlayers(defending).find((player) => (player.assignedRole ?? player.role) === "GK");
  const forcedLowXgSave = defendingGoalkeeper && traitRules(defendingGoalkeeper, "opponentShot").some((rule) => Number(rule.forceSaveWhenXgLt) > chanceXg);
  const concededLimit = activePlayers(defending).some((player) => traitRules(player, "goalLimit").some((rule) => defending.stats.goals >= Number(rule.maximumConceded)));
  if (forcedLowXgSave || concededLimit) goalProbability = 0;
  goalProbability = clamp(goalProbability, 0, type === "penalty" ? 0.92 : 0.78);

  attacking.stats.shots += 1;
  attacking.stats.xg += chanceXg;
  let goal = rng.bool(goalProbability);
  let forcedGoalLineBlock = false;
  if (goal && type !== "penalty") {
    const blocker = activePlayers(defending).find((player) =>
      traitRules(player, "goalLineSacrifice").some((rule) =>
        !(rule.excludeShotTypes ?? []).includes(type) && !defending.traitTriggers.has(`${player.id}:goalLineSacrifice`),
      ),
    );
    if (blocker) {
      const rule = traitRules(blocker, "goalLineSacrifice").find((entry) => !(entry.excludeShotTypes ?? []).includes(type));
      defending.traitTriggers.add(`${blocker.id}:goalLineSacrifice`);
      goal = false;
      forcedGoalLineBlock = true;
      const minimum = Math.max(1, Math.round(Number(rule.matchesOutMin) || 1));
      const maximum = Math.max(minimum, Math.round(Number(rule.matchesOutMax) || minimum));
      const matchesOut = Math.round(rng.range(minimum, maximum + 1));
      registerMatchInjury(defending, blocker, minute, {
        severity: matchesOut >= 3 ? "moderate" : "minor",
        matchesOut,
      }, {
        cause: "trait",
        traitName: rule.traitName,
        forceUnavailable: true,
        ignoreImmunity: true,
        events,
        recordEvents,
      });
    }
  }
  const targetRate = clamp(
    0.25 + shooterFinishing * 0.0022 - (type === "longShot" ? 0.06 : 0),
    0.24,
    0.58,
  );
  const nonGoalOnTarget = clamp(
    (targetRate - goalProbability) / Math.max(EPSILON, 1 - goalProbability),
    0,
    0.8,
  );
  const onTarget = goal || forcedGoalLineBlock || rng.bool(nonGoalOnTarget);
  if (onTarget) attacking.stats.shotsOnTarget += 1;

  if (goal) {
    attacking.stats.goals += 1;
    if (traitRules(shooter, "afterGoalBuff").length) {
      shooter.matchTraitState = { ...shooter.matchTraitState, scored: true };
    }
    touchRuntime(attacking);
    touchRuntime(defending);
    const assister = pickAssister(attacking, shooter, type, rng);
    const homeGoals = attacking.side === "home" ? attacking.stats.goals : defending.stats.goals;
    const awayGoals = attacking.side === "away" ? attacking.stats.goals : defending.stats.goals;
    recordEvent(events, recordEvents, {
      minute: Math.ceil(minute),
      type: "goal",
      team: attacking.team.name,
      player: shooter.name,
      playerId: shooter.id,
      assist: assister?.name ?? null,
      assistId: assister?.id ?? null,
      shotType: type,
      xg: Number(chanceXg.toFixed(3)),
      score: homeGoals + "-" + awayGoals,
    });
    return;
  }

  recordEvent(events, recordEvents, {
    minute: Math.ceil(minute),
    type: type === "penalty" ? "penaltyMiss" : onTarget ? "save" : "miss",
    team: attacking.team.name,
    player: shooter.name,
    playerId: shooter.id,
    shotType: type,
    xg: Number(chanceXg.toFixed(3)),
  });

  if (allowCorner && type !== "penalty" && rng.bool(0.115)) {
    attacking.stats.corners += 1;
    if (rng.bool(0.19)) {
      takeShot({
        attacking,
        defending,
        attackMetrics,
        defenseMetrics,
        minute: Math.min(context.minutes, minute + rng.range(0.1, 0.6)),
        type: "corner",
        context,
        rng,
        events,
        recordEvents,
        allowCorner: false,
      });
    }
  }
}

function tryForcedSubstitution(runtime, player, minute, events, recordEvents) {
  if (!player || runtime.stats.substitutions >= SEVEN_A_SIDE.substitutionLimit) return false;
  const group = roleGroup(player.assignedRole ?? player.role);
  let replacementIndex = runtime.bench.findIndex(
    (candidate) => roleGroup(candidate.role) === group,
  );
  if (replacementIndex < 0) replacementIndex = runtime.bench.length ? 0 : -1;
  if (replacementIndex < 0) return false;
  const lineupIndex = runtime.lineup.findIndex((candidate) => candidate.id === player.id);
  if (lineupIndex < 0) return false;

  const [replacement] = runtime.bench.splice(replacementIndex, 1);
  replacement.assignedRole = player.assignedRole ?? player.role;
  replacement.boardPosition = player.boardPosition ? { ...player.boardPosition } : replacement.boardPosition;
  runtime.lineup[lineupIndex] = replacement;
  runtime.stats.substitutions += 1;
  touchRuntime(runtime);
  recordEvent(events, recordEvents, {
    minute: Math.ceil(minute),
    type: "substitution",
    team: runtime.team.name,
    playerOut: player.name,
    playerOutId: player.id,
    playerIn: replacement.name,
    playerInId: replacement.id,
    reason: "injury",
  });
  return true;
}

function injuryOutcome(victim, rng, source = "match", offender = null) {
  const proneness = victim.state?.injuryProneness ?? 30;
  const fitness = victim.state?.fitness ?? 100;
  const physical = physicalQuality(victim);
  const resistance = Number(victim.hidden?.injuryResistance ?? 60);
  const offenderAggression = offender ? attribute(offender, "aggression") : 50;
  const severityPressure = proneness * 0.0022 + Math.max(0, 70 - physical) * 0.004 + Math.max(0, 70 - resistance) * 0.003 + Math.max(0, 82 - fitness) * 0.004 + (source === "foul" ? Math.max(0, offenderAggression - 55) * 0.003 : 0);
  const severityRoll = rng.next() + severityPressure;
  const retirementChance = clamp(0.0015 + Math.max(0, severityPressure - 0.18) * 0.012 + (source === "foul" ? Math.max(0, offenderAggression - 82) * 0.00035 : 0), 0.0015, 0.012);
  if (severityRoll > 1.08 && rng.bool(retirementChance)) return { severity: "careerEnding", matchesOut: null, retired: true };
  const severity = severityRoll > 1.16 ? "severe" : severityRoll > 0.9 ? "moderate" : severityRoll > 0.52 ? "minor" : "knock";
  const matchesOut = severity === "severe" ? Math.round(rng.range(6, 13)) : severity === "moderate" ? Math.round(rng.range(3, 7)) : severity === "minor" ? Math.round(rng.range(1, 4)) : 1;
  return { severity, matchesOut, retired: false };
}

function registerMatchInjury(runtime, victim, minute, outcome, options = {}) {
  if (!victim || (!options.ignoreImmunity && injuryImmune(victim)) || runtime.injuriesByPlayer.has(victim.id)) return null;
  const severity = outcome.severity;
  const retired = Boolean(outcome.retired || severity === "careerEnding");
  const matchesOut = retired ? null : Math.max(1, Math.round(Number(outcome.matchesOut) || 1));
  const cause = options.cause ?? "match";
  const record = {
    severity,
    matchesOut,
    minute: Math.ceil(minute),
    cause,
    retired,
    causedByFoul: Boolean(options.causedByFoul),
    offenderId: options.offender?.id ?? null,
    offender: options.offender?.name ?? null,
    forceUnavailable: Boolean(options.forceUnavailable),
    traitName: options.traitName ?? null,
  };
  runtime.injuriesByPlayer.set(victim.id, record);
  runtime.injuredOut.add(victim.id);
  victim.state = {
    ...victim.state,
    retired,
    fitness: Math.max(0, Number(victim.state?.fitness ?? 100) - (Number(options.fitnessLoss) || (retired ? 45 : severity === "severe" ? 28 : severity === "moderate" ? 18 : severity === "minor" ? 10 : 5))),
    injury: { severity, matchesRemaining: retired ? 999 : matchesOut, totalMatches: retired ? 999 : matchesOut, cause, sufferedAtStage: null },
  };
  runtime.stats.injuries += 1;
  touchRuntime(runtime);
  const event = {
    minute: Math.ceil(minute),
    type: "injury",
    team: runtime.team.name,
    player: victim.name,
    playerId: victim.id,
    severity,
    matchesOut,
    cause,
    retired,
    causedByFoul: record.causedByFoul,
    offenderId: record.offenderId,
    offender: record.offender,
    forceUnavailable: record.forceUnavailable,
    traitName: record.traitName,
  };
  recordEvent(options.events ?? [], options.recordEvents ?? true, event);
  if (runtime.autoInjurySubstitution) {
    tryForcedSubstitution(runtime, victim, minute, options.events ?? [], options.recordEvents ?? true);
  } else {
    runtime.pendingInjury = { ...record, playerId: victim.id, player: victim.name, side: runtime.side };
  }
  return record;
}

function maybeKickedInjury(victim, attacking, offender, defending, minute, context, rng, events, recordEvents) {
  if (!victim || !offender) return null;
  const proneness = victim.state?.injuryProneness ?? 30;
  const fitness = victim.state?.fitness ?? 100;
  const aggression = attribute(offender, "aggression");
  const tackling = attribute(offender, "tackling");
  const resistanceMultiplier = clamp(1 - Number(attacking.team.bondBonus?.injuryResistance ?? 0) / 100, 0.05, 2);
  const probability = clamp((0.0045 + proneness / 9000 + Math.max(0, 88 - fitness) / 5000 + Math.max(0, aggression - 55) / 4200 + Math.max(0, 55 - tackling) / 6500 + tacticsFor(defending).tackleIntensity / 9000) * resistanceMultiplier, 0.0003, 0.045);
  if (!rng.bool(probability)) return null;
  return registerMatchInjury(attacking, victim, minute, injuryOutcome(victim, rng, "foul", offender), {
    cause: "foul", causedByFoul: true, offender, events, recordEvents,
  });
}

function maybeRegularInjury(runtime, minute, context, rng, events, recordEvents) {
  const candidates = activePlayers(runtime).filter((candidate) => !injuryImmune(candidate));
  if (!candidates.length) return null;
  const victim = candidates[Math.floor(rng.next() * candidates.length)];
  const proneness = victim.state?.injuryProneness ?? 30;
  const fitness = victim.state?.fitness ?? 100;
  const weatherRisk = ["rain", "snow", "storm"].includes(context.weather.type) ? 0.0003 : 0;
  const resistanceMultiplier = clamp(1 - Number(runtime.team.bondBonus?.injuryResistance ?? 0) / 100, 0.05, 2);
  const probability = clamp((0.00025 + proneness / 190000 + Math.max(0, 86 - fitness) / 70000 + minute / 1200000 + weatherRisk) * resistanceMultiplier, 0.00002, 0.0022);
  if (!rng.bool(probability)) return null;
  return registerMatchInjury(runtime, victim, minute, injuryOutcome(victim, rng, "match"), {
    cause: "match", events, recordEvents,
  });
}

function maybeGuaranteedTraitInjury(session, minute) {
  if (minute < 55) return null;
  for (const offending of [session.home, session.away]) {
    const victimRuntime = offending === session.home ? session.away : session.home;
    const offender = activePlayers(offending).find((player) =>
      traitRules(player, "guaranteedInjury").length && !offending.guaranteedInjuriesTriggered.has(player.id));
    if (!offender) continue;
    const victims = activePlayers(victimRuntime).filter((player) => !injuryImmune(player));
    if (!victims.length) {
      offending.guaranteedInjuriesTriggered.add(offender.id);
      continue;
    }
    const victim = session.rng.weighted(victims, (player) => 0.5 + attribute(player, "dribbling") / 80 + attribute(player, "pace") / 140);
    offending.stats.fouls += 1;
    recordEvent(session.events, session.recordEvents, {
      minute: Math.ceil(minute), type: "foul", team: offending.team.name,
      player: offender.name, playerId: offender.id, victim: victim.name, victimId: victim.id,
      reason: "guaranteedInjuryTrait",
    });
    const injury = registerMatchInjury(victimRuntime, victim, minute, injuryOutcome(victim, session.rng, "foul", offender), {
      cause: "foul", causedByFoul: true, offender, events: session.events, recordEvents: session.recordEvents,
    });
    offending.guaranteedInjuriesTriggered.add(offender.id);
    handleCard(offending, offender, minute, session.context, session.rng, session.events, session.recordEvents, injury);
    if (injury) return injury;
  }
  return null;
}

export function foulCardProbabilities(offender, defending, context, injury = null) {
  const tactics = tacticsFor(defending);
  const strictness = context.referee.strictness;
  const aggression = attribute(offender, "aggression");
  const discipline = attribute(offender, "discipline");
  const injuryBoost = injury ? ({ knock: 0.14, minor: 0.2, moderate: 0.29, severe: 0.4, careerEnding: 0.52 })[injury.severity] ?? 0.18 : 0;
  const traitCardMultiplier = traitRuleProduct(offender, "card", "multiplyProbability", context);
  const bondCardMultiplier = clamp(1 - Number(defending.team.bondBonus?.cardAvoidance ?? 0) / 100, 0.1, 2);
  return {
    card: clamp((0.075 + strictness * 0.00135 + tactics.tackleIntensity * 0.00065 + Math.max(0, aggression - discipline) * 0.0012 + injuryBoost) * traitCardMultiplier * bondCardMultiplier, 0.01, injury ? 0.94 : 0.72),
    directRed: clamp((0.008 + Math.max(0, aggression - 65) * 0.001 + (strictness - 50) * 0.00015 + (injury ? ({ knock: 0.015, minor: 0.035, moderate: 0.075, severe: 0.16, careerEnding: 0.28 })[injury.severity] ?? 0.03 : 0)) * bondCardMultiplier, 0.001, injury ? 0.45 : 0.075),
  };
}

function handleCard(defending, offender, minute, context, rng, events, recordEvents, injury = null) {
  if (!offender) return;
  const { card: cardProbability, directRed: directRedProbability } = foulCardProbabilities(offender, defending, context, injury);
  if (!rng.bool(cardProbability)) return;

  const priorYellows = defending.yellowsByPlayer.get(offender.id) ?? 0;
  if (rng.bool(directRedProbability)) {
    defending.stats.reds += 1;
    defending.sentOff.add(offender.id);
    touchRuntime(defending);
    recordEvent(events, recordEvents, {
      minute: Math.ceil(minute),
      type: "redCard",
      team: defending.team.name,
      player: offender.name,
      playerId: offender.id,
      reason: "direct",
    });
    return;
  }

  defending.stats.yellows += 1;
  defending.yellowsByPlayer.set(offender.id, priorYellows + 1);
  recordEvent(events, recordEvents, {
    minute: Math.ceil(minute),
    type: "yellowCard",
    team: defending.team.name,
    player: offender.name,
    playerId: offender.id,
  });
  if (priorYellows + 1 >= 2) {
    defending.stats.reds += 1;
    defending.sentOff.add(offender.id);
    touchRuntime(defending);
    recordEvent(events, recordEvents, {
      minute: Math.ceil(minute),
      type: "redCard",
      team: defending.team.name,
      player: offender.name,
      playerId: offender.id,
      reason: "secondYellow",
    });
  }
}

function handleFoul({
  stage,
  attacking,
  defending,
  attackMetrics,
  defenseMetrics,
  minute,
  context,
  rng,
  events,
  recordEvents,
}) {
  const baseByStage = { buildUp: 0.075, progression: 0.16, finalThird: 0.195 };
  const defenseTactics = tacticsFor(defending);
  const foulProbability = clamp(
    baseByStage[stage] +
      (defenseTactics.tackleIntensity - 50) * 0.0008 +
      (50 - defenseMetrics.discipline) * 0.001 +
      (context.referee.strictness - 50) * 0.0005,
    0.035,
    0.3,
  );
  if (!rng.bool(foulProbability)) return false;

  defending.stats.fouls += 1;
  const offender = pickOffender(defending, rng);
  const victim = pickVictim(attacking, rng);
  recordEvent(events, recordEvents, {
    minute: Math.ceil(minute),
    type: "foul",
    team: defending.team.name,
    player: offender?.name ?? "未知球员",
    playerId: offender?.id ?? null,
    victim: victim?.name ?? null,
    victimId: victim?.id ?? null,
  });
  const injury = maybeKickedInjury(victim, attacking, offender, defending, minute, context, rng, events, recordEvents);
  handleCard(defending, offender, minute, context, rng, events, recordEvents, injury);

  if (stage === "finalThird") {
    const penaltyTraitMultiplier = teamTraitRules(activePlayers(attacking), "penalty", { ...context, minute })
      .reduce((value, rule) => value * (Number(rule.multiplyAwardProbability) || 1), 1);
    const penaltyBondMultiplier = clamp(1 + Number(attacking.team.bondBonus?.penaltyChance ?? 0) / 100, 0.1, 3);
    const penaltyProbability = clamp((0.018 + (context.referee.penaltyBias - 50) * 0.00018) * penaltyTraitMultiplier * penaltyBondMultiplier, 0.002, 0.18);
    if (rng.bool(penaltyProbability)) {
      recordEvent(events, recordEvents, {
        minute: Math.ceil(minute),
        type: "penaltyAwarded",
        team: attacking.team.name,
        victim: victim?.name ?? null,
        victimId: victim?.id ?? null,
      });
      takeShot({
        attacking,
        defending,
        attackMetrics,
        defenseMetrics,
        minute,
        type: "penalty",
        context,
        rng,
        events,
        recordEvents,
        allowCorner: false,
      });
      return true;
    }
    if (rng.bool(0.22)) {
      takeShot({
        attacking,
        defending,
        attackMetrics,
        defenseMetrics,
        minute,
        type: "freeKick",
        context,
        rng,
        events,
        recordEvents,
      });
      return true;
    }
  }

  if (stage === "progression" && rng.bool(0.07)) {
    takeShot({
      attacking,
      defending,
      attackMetrics,
      defenseMetrics,
      minute,
      type: "freeKick",
      context,
      rng,
      events,
      recordEvents,
    });
    return true;
  }
  return true;
}

function maybeScheduledSubstitution(runtime, minute, context, events, recordEvents) {
  const coach = { ...DEFAULT_COACH, ...runtime.team.coach };
  const earlyShift = (coach.substitutions - 50) * 0.06;
  const schedule = [62 - earlyShift, 72 - earlyShift, 81 - earlyShift];
  if (runtime.substitutionIndex >= schedule.length) return;
  if (minute < schedule[runtime.substitutionIndex]) return;
  runtime.substitutionIndex += 1;
  if (runtime.stats.substitutions >= SEVEN_A_SIDE.substitutionLimit || runtime.bench.length === 0) return;

  const candidates = activePlayers(runtime).filter((player) => (player.assignedRole ?? player.role) !== "GK");
  const outgoing = candidates
    .filter((player) => runtime.bench.some((bench) => roleGroup(bench.role) === roleGroup(player.assignedRole ?? player.role)))
    .sort((left, right) => {
      const leftEnergy = attribute(left, "stamina") + (left.state?.fitness ?? 100) * 0.45;
      const rightEnergy = attribute(right, "stamina") + (right.state?.fitness ?? 100) * 0.45;
      return leftEnergy - rightEnergy;
    })[0];
  if (!outgoing) return;

  const group = roleGroup(outgoing.assignedRole ?? outgoing.role);
  const replacementIndex = runtime.bench
    .map((player, index) => ({ player, index }))
    .filter((entry) => roleGroup(entry.player.role) === group)
    .sort(
      (left, right) =>
        attribute(right.player, "stamina") + attribute(right.player, "workRate") -
        attribute(left.player, "stamina") - attribute(left.player, "workRate"),
    )[0]?.index;
  if (replacementIndex === undefined) return;
  const lineupIndex = runtime.lineup.findIndex((player) => player.id === outgoing.id);
  const [replacement] = runtime.bench.splice(replacementIndex, 1);
  replacement.assignedRole = outgoing.assignedRole ?? outgoing.role;
  replacement.boardPosition = outgoing.boardPosition ? { ...outgoing.boardPosition } : replacement.boardPosition;
  runtime.lineup[lineupIndex] = replacement;
  runtime.stats.substitutions += 1;
  touchRuntime(runtime);
  recordEvent(events, recordEvents, {
    minute: Math.ceil(minute),
    type: "substitution",
    team: runtime.team.name,
    playerOut: outgoing.name,
    playerOutId: outgoing.id,
    playerIn: replacement.name,
    playerInId: replacement.id,
    reason: "tactical",
  });
}

function simulatePossession({
  attacking,
  defending,
  minute,
  context,
  rng,
  events,
  recordEvents,
}) {
  attacking.stats.possessionSequences += 1;
  const attackMetrics = deriveTeamMetrics(attacking, minute, context);
  const defenseMetrics = deriveTeamMetrics(defending, minute, context);
  const attackTactics = tacticsFor(attacking);
  const defenseTactics = tacticsFor(defending);
  const attackBehavior = matchBehavior(attacking, defending, minute, context);
  const defenseBehavior = matchBehavior(defending, attacking, minute, context);

  const weatherPassPenalty =
    context.weather.precipitation / 380 + context.weather.wind / 520;
  const extremeTempoPenalty = Math.abs(attackTactics.tempo - 52) / 520;
  const directEscape = (attackTactics.directness - 50) / 420;
  const buildProbability = clamp(
    logistic(
      logit(0.835) +
        (attackMetrics.buildUp - defenseMetrics.press) / 23 +
        directEscape -
        (defenseTactics.pressing - 50) / 260 -
        weatherPassPenalty -
        extremeTempoPenalty,
    ),
    0.48,
    0.96,
  );
  if (!rng.bool(buildProbability)) {
    handleFoul({
      stage: "buildUp",
      attacking,
      defending,
      attackMetrics,
      defenseMetrics,
      minute,
      context,
      rng,
      events,
      recordEvents,
    });
    return;
  }

  const widthMatchup =
    (attackTactics.width - 50) / 600 -
    (defenseTactics.width - 50) / 900;
  const progressProbability = clamp(
    logistic(
      logit(0.555) +
        (attackMetrics.progression - defenseMetrics.midfieldDefense) / 21 +
        (attackMetrics.pressResistance - defenseMetrics.press) / 55 +
        widthMatchup +
        attackBehavior.control / 45,
    ),
    0.25,
    0.84,
  );
  if (!rng.bool(progressProbability)) {
    handleFoul({
      stage: "progression",
      attacking,
      defending,
      attackMetrics,
      defenseMetrics,
      minute,
      context,
      rng,
      events,
      recordEvents,
    });
    return;
  }

  const lineRisk =
    (defenseTactics.defensiveLine - 50) / 650 +
    (defenseTactics.risk - 50) / 850;
  const createProbability = clamp(
    logistic(
      logit(0.295) +
        (attackMetrics.chanceCreation - defenseMetrics.defending) / 20 +
        (attackTactics.risk - 50) / 300 +
        attackBehavior.attack / 34 -
        defenseBehavior.defense / 42 +
        lineRisk,
    ),
    0.1,
    0.62,
  );
  if (!rng.bool(createProbability)) {
    handleFoul({
      stage: "finalThird",
      attacking,
      defending,
      attackMetrics,
      defenseMetrics,
      minute,
      context,
      rng,
      events,
      recordEvents,
    });
    return;
  }

  takeShot({
    attacking,
    defending,
    attackMetrics,
    defenseMetrics,
    minute,
    type: chooseShotType(attacking, defending, rng),
    context,
    rng,
    events,
    recordEvents,
  });
}

function possessionProbability(home, away, minute, context) {
  const homeMetrics = deriveTeamMetrics(home, minute, context);
  const awayMetrics = deriveTeamMetrics(away, minute, context);
  const homeBehavior = matchBehavior(home, away, minute, context);
  const awayBehavior = matchBehavior(away, home, minute, context);
  const refereeHomeBias = (context.referee.homeBias - 50) * 0.012;
  const edge =
    homeMetrics.midfieldControl -
    awayMetrics.midfieldControl +
    context.homeAdvantage +
    refereeHomeBias +
    homeBehavior.control -
    awayBehavior.control;
  return clamp(logistic(edge / 17), 0.27, 0.73);
}

function publicStats(runtime, totalPossessions) {
  return {
    goals: runtime.stats.goals,
    xg: Number(runtime.stats.xg.toFixed(3)),
    shots: runtime.stats.shots,
    shotsOnTarget: runtime.stats.shotsOnTarget,
    possession: Number(
      ((runtime.stats.possessionSequences / Math.max(1, totalPossessions)) * 100).toFixed(1),
    ),
    fouls: runtime.stats.fouls,
    yellowCards: runtime.stats.yellows,
    redCards: runtime.stats.reds,
    corners: runtime.stats.corners,
    substitutions: runtime.stats.substitutions,
    injuries: runtime.stats.injuries,
    lightningHits: runtime.stats.lightningHits,
  };
}

export function createMatchSession(homeTeam, awayTeam, options = {}) {
  const context = mergeContext(options.context);
  const rng = new Random(options.seed ?? Date.now());
  const home = makeRuntime(homeTeam, "home");
  const away = makeRuntime(awayTeam, "away");
  home.opponent = away;
  away.opponent = home;
  home.autoInjurySubstitution = options.autoSubstitutions?.home ?? true;
  away.autoInjurySubstitution = options.autoSubstitutions?.away ?? true;
  const averageTempo = (tacticsFor(home).tempo + tacticsFor(away).tempo) / 2;
  const possessionCount = Math.max(
    80,
    Math.round(
      context.basePossessions *
        (0.84 + averageTempo / 310) *
        (1 - (tacticsFor(home).timeWasting + tacticsFor(away).timeWasting) / 1600) +
        rng.normal(0, 5),
    ),
  );
  const stoppage = clamp(2 + rng.normal(0, 1.1), 1, 7);
  return {
    context,
    rng,
    home,
    away,
    events: [],
    recordEvents: options.recordEvents ?? true,
    possessionCount,
    possessionIndex: 0,
    nextPossessionMinute: null,
    totalMinutes: context.minutes + stoppage,
    autoSubstitutions: {
      home: options.autoSubstitutions?.home ?? true,
      away: options.autoSubstitutions?.away ?? true,
    },
  };
}

function prepareNextPossession(session) {
  if (session.possessionIndex >= session.possessionCount) return null;
  if (session.nextPossessionMinute === null) {
    session.nextPossessionMinute =
      ((session.possessionIndex + session.rng.range(0.15, 0.85)) / session.possessionCount) * session.totalMinutes;
  }
  return session.nextPossessionMinute;
}

export function advanceMatchSession(session, targetMinute) {
  const before = session.events.length;
  if (session.home.pendingInjury || session.away.pendingInjury) return [];
  const target = Math.max(0, Number(targetMinute));
  let minute = prepareNextPossession(session);
  while (minute !== null && minute <= target) {
    maybeLightningStrike(session, minute);
    if (session.home.pendingInjury || session.away.pendingInjury) break;
    maybeGuaranteedTraitInjury(session, minute);
    if (session.home.pendingInjury || session.away.pendingInjury) break;
    if (session.autoSubstitutions.home) maybeScheduledSubstitution(session.home, minute, session.context, session.events, session.recordEvents);
    if (session.autoSubstitutions.away) maybeScheduledSubstitution(session.away, minute, session.context, session.events, session.recordEvents);
    maybeRegularInjury(session.home, minute, session.context, session.rng, session.events, session.recordEvents);
    maybeRegularInjury(session.away, minute, session.context, session.rng, session.events, session.recordEvents);
    if (session.home.pendingInjury || session.away.pendingInjury) break;
    const homeHasBall = session.rng.bool(possessionProbability(session.home, session.away, minute, session.context));
    simulatePossession({
      attacking: homeHasBall ? session.home : session.away,
      defending: homeHasBall ? session.away : session.home,
      minute,
      context: session.context,
      rng: session.rng,
      events: session.events,
      recordEvents: session.recordEvents,
    });
    session.possessionIndex += 1;
    session.nextPossessionMinute = null;
    if (session.home.pendingInjury || session.away.pendingInjury) break;
    minute = prepareNextPossession(session);
  }
  return session.events.slice(before);
}

export function updateMatchSessionTactics(session, side, tactics = {}) {
  const runtime = side === "away" ? session.away : session.home;
  runtime.team = { ...runtime.team, tactics: { ...runtime.team.tactics, ...tactics } };
  touchRuntime(runtime);
}

export function substituteMatchSessionPlayer(session, side, outgoingId, incomingId, minute = 0) {
  const runtime = side === "away" ? session.away : session.home;
  if (runtime.stats.substitutions >= SEVEN_A_SIDE.substitutionLimit) return null;
  const outgoingIndex = runtime.lineup.findIndex((player) => player.id === outgoingId);
  const incomingIndex = runtime.bench.findIndex((player) => player.id === incomingId);
  if (outgoingIndex < 0 || incomingIndex < 0) return null;
  const outgoing = runtime.lineup[outgoingIndex];
  const incoming = runtime.bench[incomingIndex];
  if (runtime.pendingInjury && runtime.pendingInjury.playerId !== outgoing.id) return null;
  incoming.assignedRole = outgoing.assignedRole ?? outgoing.role;
  incoming.boardPosition = outgoing.boardPosition ? { ...outgoing.boardPosition } : incoming.boardPosition;
  runtime.lineup[outgoingIndex] = incoming;
  if (runtime.pendingInjury) runtime.bench.splice(incomingIndex, 1);
  else runtime.bench[incomingIndex] = outgoing;
  runtime.stats.substitutions += 1;
  const forcedByInjury = Boolean(runtime.pendingInjury);
  runtime.pendingInjury = null;
  touchRuntime(runtime);
  const event = {
    minute: Math.max(0, Math.round(minute)),
    type: "substitution",
    team: runtime.team.name,
    playerOut: outgoing.name,
    playerOutId: outgoing.id,
    playerIn: incoming.name,
    playerInId: incoming.id,
    reason: forcedByInjury ? "injury" : "manual",
  };
  if (session.recordEvents) session.events.push(event);
  return event;
}

export function resolveMatchSessionInjuryShortHanded(session, side, playerId) {
  const runtime = side === "away" ? session.away : session.home;
  if (!runtime.pendingInjury || runtime.pendingInjury.playerId !== playerId) return false;
  runtime.pendingInjury = null;
  touchRuntime(runtime);
  return true;
}

export function inflictMatchSessionInjury(session, side, playerId, options = {}) {
  const runtime = side === "away" ? session.away : session.home;
  const player = runtime.lineup.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  const severity = options.severity ?? "minor";
  const outcome = {
    severity,
    matchesOut: options.matchesOut ?? (severity === "severe" ? 8 : severity === "moderate" ? 4 : 1),
    retired: Boolean(options.retired || severity === "careerEnding"),
  };
  return registerMatchInjury(runtime, player, options.minute ?? 1, outcome, {
    cause: options.cause ?? "match",
    causedByFoul: Boolean(options.causedByFoul),
    offender: options.offender ?? null,
    forceUnavailable: Boolean(options.forceUnavailable),
    events: session.events,
    recordEvents: session.recordEvents,
  });
}

export function matchSessionSnapshot(session) {
  const totalPossessions = session.home.stats.possessionSequences + session.away.stats.possessionSequences;
  return {
    homeTeam: session.home.team.name,
    awayTeam: session.away.team.name,
    score: { home: session.home.stats.goals, away: session.away.stats.goals },
    stats: {
      home: publicStats(session.home, totalPossessions),
      away: publicStats(session.away, totalPossessions),
    },
    lineups: {
      home: session.home.lineup.map(clonePlayer),
      away: session.away.lineup.map(clonePlayer),
    },
    benches: {
      home: session.home.bench.map(clonePlayer),
      away: session.away.bench.map(clonePlayer),
    },
    discipline: {
      sentOff: { home: [...session.home.sentOff], away: [...session.away.sentOff] },
      injuredOut: { home: [...session.home.injuredOut], away: [...session.away.injuredOut] },
      injuries: {
        home: Object.fromEntries(session.home.injuriesByPlayer),
        away: Object.fromEntries(session.away.injuriesByPlayer),
      },
    },
    pendingInjury: session.home.pendingInjury || session.away.pendingInjury
      ? { ...(session.home.pendingInjury ?? session.away.pendingInjury) }
      : null,
    complete: session.possessionIndex >= session.possessionCount,
  };
}

function sessionResult(session, seed = null) {
  const snapshot = matchSessionSnapshot(session);
  return {
    seed,
    homeTeam: snapshot.homeTeam,
    awayTeam: snapshot.awayTeam,
    score: snapshot.score,
    outcome: snapshot.score.home > snapshot.score.away ? "home" : snapshot.score.home < snapshot.score.away ? "away" : "draw",
    minutes: Math.round(session.totalMinutes),
    stats: snapshot.stats,
    events: session.events,
  };
}

export function simulateMatch(homeTeam, awayTeam, options = {}) {
  const session = createMatchSession(homeTeam, awayTeam, options);
  advanceMatchSession(session, Number.POSITIVE_INFINITY);
  return sessionResult(session, options.seed ?? null);
}

export function simulateMany(homeTeam, awayTeam, options = {}) {
  const matches = options.matches ?? 1000;
  const seed = options.seed ?? "batch";
  const totals = {
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    homeGoals: 0,
    awayGoals: 0,
    homeXg: 0,
    awayXg: 0,
    homeShots: 0,
    awayShots: 0,
    homeCards: 0,
    awayCards: 0,
    homeInjuries: 0,
    awayInjuries: 0,
  };
  const scorelines = new Map();

  for (let index = 0; index < matches; index += 1) {
    const result = simulateMatch(homeTeam, awayTeam, {
      ...options,
      seed: seed + ":" + index,
      recordEvents: false,
    });
    if (result.outcome === "home") totals.homeWins += 1;
    else if (result.outcome === "away") totals.awayWins += 1;
    else totals.draws += 1;
    totals.homeGoals += result.score.home;
    totals.awayGoals += result.score.away;
    totals.homeXg += result.stats.home.xg;
    totals.awayXg += result.stats.away.xg;
    totals.homeShots += result.stats.home.shots;
    totals.awayShots += result.stats.away.shots;
    totals.homeCards += result.stats.home.yellowCards + result.stats.home.redCards;
    totals.awayCards += result.stats.away.yellowCards + result.stats.away.redCards;
    totals.homeInjuries += result.stats.home.injuries;
    totals.awayInjuries += result.stats.away.injuries;
    const key = result.score.home + "-" + result.score.away;
    scorelines.set(key, (scorelines.get(key) ?? 0) + 1);
  }

  const probability = (count) => Number((count / matches).toFixed(4));
  const mean = (total) => Number((total / matches).toFixed(3));
  return {
    matches,
    teams: { home: homeTeam.name, away: awayTeam.name },
    probabilities: {
      homeWin: probability(totals.homeWins),
      draw: probability(totals.draws),
      awayWin: probability(totals.awayWins),
    },
    averages: {
      homeGoals: mean(totals.homeGoals),
      awayGoals: mean(totals.awayGoals),
      totalGoals: mean(totals.homeGoals + totals.awayGoals),
      homeXg: mean(totals.homeXg),
      awayXg: mean(totals.awayXg),
      homeShots: mean(totals.homeShots),
      awayShots: mean(totals.awayShots),
      homeCards: mean(totals.homeCards),
      awayCards: mean(totals.awayCards),
      homeInjuries: mean(totals.homeInjuries),
      awayInjuries: mean(totals.awayInjuries),
    },
    commonScorelines: [...scorelines.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([score, count]) => ({ score, probability: probability(count) })),
  };
}
