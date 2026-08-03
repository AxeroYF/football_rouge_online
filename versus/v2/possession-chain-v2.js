import { roleGroup } from "../../game/public/schema.js";
import { resolveV2MatchParameters, V2_MATCH_PARAMETERS } from "./match-parameters-v2.js";
import { buildV2SpatialMatchup, buildV2StageSpatialCache } from "./spatial-model-v2.js";
import { buildV2TeamSnapshots } from "./team-snapshot-v2.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const STAGE_TARGET_BAND = Object.freeze({ buildUp:"buildUp", progression:"finalThird", finalThird:"box" });
const TRANSITION_START_STAGE = Object.freeze({ defensiveThird:"buildUp", buildUp:"progression", finalThird:"finalThird", box:"chance" });
const STAGE_OWNER = Object.freeze({
  buildUp:"buildUpSuccess",
  progression:"progressionSuccess",
  finalThird:"finalThirdEntry",
  chance:"chanceQuality",
  shot:"goalProbability",
});
const STAGE_METRICS = Object.freeze({
  buildUp:Object.freeze({ buildUp:0.58, pressResistance:0.42 }),
  progression:Object.freeze({ progression:0.58, pressResistance:0.24, buildUp:0.18 }),
  finalThird:Object.freeze({ progression:0.34, chanceCreation:0.42, movement:0.24 }),
  chance:Object.freeze({ chanceCreation:0.48, movement:0.32, pressResistance:0.2 }),
  shot:Object.freeze({ finishing:0.58, movement:0.2, chanceCreation:0.12, pressResistance:0.1 }),
});
const DEFENSE_METRICS = Object.freeze({
  buildUp:Object.freeze({ pressing:0.58, defensiveDuel:0.22, shotPrevention:0.2 }),
  progression:Object.freeze({ pressing:0.42, defensiveDuel:0.4, shotPrevention:0.18 }),
  finalThird:Object.freeze({ defensiveDuel:0.46, shotPrevention:0.36, pressing:0.18 }),
  chance:Object.freeze({ shotPrevention:0.52, defensiveDuel:0.36, pressing:0.12 }),
  shot:Object.freeze({ shotPrevention:0.7, defensiveDuel:0.3 }),
});
const GOALKEEPER_METRICS = Object.freeze({ goalkeeping:0.82, pressResistance:0.18 });

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function weightedMetric(player, weights) {
  return Object.entries(weights).reduce((sum, [metric, weight]) => sum + Number(player?.metrics?.[metric] ?? 50) * weight, 0);
}

function safeRoll(rng) {
  const value = Number(rng());
  if (!Number.isFinite(value)) throw new Error("V2控球链随机函数必须返回有限数值");
  return clamp(value, 0, 0.999999999999);
}

function weightedPick(entries, weight, rng) {
  if (!entries.length) return null;
  const weighted = entries.map((entry) => ({ entry, weight:Math.max(0, Number(weight(entry)) || 0) }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return entries[Math.floor(safeRoll(rng) * entries.length)];
  let roll = safeRoll(rng) * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.entry;
  }
  return weighted.at(-1).entry;
}

function playerById(team) {
  return Object.fromEntries(team.players.map((player) => [player.id, player]));
}

function zoneCandidates(zoneTeam, playerTeam, zoneId, side) {
  const players = playerById(playerTeam);
  const contributors = zoneTeam.zones[zoneId]?.[side]?.contributors ?? [];
  return contributors.map((contributor) => ({
    ...players[contributor.id],
    influence:contributor.influence,
  })).filter((player) => player.id);
}

function chooseActor(team, zoneId, stage, rng) {
  const candidates = zoneCandidates(team, team, zoneId, "own");
  const outfield = candidates.filter((player) => roleGroup(player.assignedRole) !== "GK");
  const pool = outfield.length ? outfield : candidates;
  return weightedPick(pool, (player) => player.influence * weightedMetric(player, STAGE_METRICS[stage]), rng);
}

function chooseDefender(team, opponent, zoneId, stage, rng) {
  const candidates = zoneCandidates(team, opponent, zoneId, "opponent");
  if (stage === "shot") {
    const goalkeepers = opponent.players.filter((player) => roleGroup(player.assignedRole) === "GK");
    if (goalkeepers.length) return weightedPick(goalkeepers, (player) => weightedMetric(player, GOALKEEPER_METRICS), rng);
  }
  const outfield = candidates.filter((player) => roleGroup(player.assignedRole) !== "GK");
  const pool = outfield.length ? outfield : candidates;
  return weightedPick(pool, (player) => player.influence * weightedMetric(player, DEFENSE_METRICS[stage]), rng);
}

function connectionFrom(team, currentZone, targetBand) {
  return team.connections.filter((connection) => {
    const target = connection.from === currentZone ? connection.to : connection.to === currentZone ? connection.from : null;
    return target && team.zones[target]?.band === targetBand;
  }).map((connection) => ({
    ...connection,
    target:connection.from === currentZone ? connection.to : connection.from,
  }));
}

function routeScore(team, connection) {
  const target = team.zones[connection.target];
  const direction = team.inPossessionDetails?.attackDirection ?? "balanced";
  const lane = target?.lane ?? connection.target?.split(":")[1];
  const preferredLanes = {
    left:{ farLeft:.16, leftHalfSpace:.1 }, leftHalf:{ leftHalfSpace:.16, farLeft:.06, center:.04 }, center:{ center:.16, leftHalfSpace:.05, rightHalfSpace:.05 },
    rightHalf:{ rightHalfSpace:.16, farRight:.06, center:.04 }, right:{ farRight:.16, rightHalfSpace:.1 }, balanced:{},
  }[direction] ?? {};
  return connection.quality * 0.34
    + target.controlShare * 0.18
    + target.exploitableSpace * 0.18
    + (target.progressionEdge + 1) / 2 * 0.2
    + (target.overload ? 0.1 : 0)
    + Number(preferredLanes[lane] ?? 0);
}

function chooseRoute(team, currentZone, targetBand, stage, rng, parameters, transition) {
  const directness = team.tacticalDimensions.directness;
  const counter = team.tacticalDimensions.counterAttack;
  const routeParameters = parameters.chain.route;
  const counterChance = transition?.wonZone
    ? clamp(routeParameters.counterMinimumChance + counter / 100 * (routeParameters.counterMaximumChance - routeParameters.counterMinimumChance), 0, 1)
    : 0;
  const directChance = directness >= routeParameters.directThreshold
    ? (directness - routeParameters.directThreshold) / Math.max(1, 100 - routeParameters.directThreshold) * routeParameters.directMaximumChance
    : 0;
  const roll = safeRoll(rng);
  const routeType = roll < counterChance ? "counter" : roll < counterChance + directChance ? "direct" : "structured";
  const routeTargetBand = routeType === "direct" && stage === "progression" ? "box" : targetBand;
  const connections = connectionFrom(team, currentZone, routeTargetBand);
  if (connections.length) {
    const selected = weightedPick(connections, (connection) => Math.pow(Math.max(0.01, routeScore(team, connection)), 2), rng);
    const quality = routeType === "direct"
      ? clamp(selected.quality - routeParameters.directConnectionPenalty + team.zones[selected.target].exploitableSpace * routeParameters.directSpaceReward, 0.04, 1)
      : routeType === "counter"
        ? clamp(selected.quality + routeParameters.counterConnectionBonus + team.zones[selected.target].exploitableSpace * routeParameters.counterSpaceReward, 0.04, 1)
        : selected.quality;
    return { ...selected, quality:round(quality), routeType };
  }
  const fallbackZones = Object.values(team.zones).filter((zone) => zone.band === routeTargetBand && zone.own.occupancy > 0);
  const target = weightedPick(fallbackZones, (zone) => Math.max(0.01, zone.controlShare + zone.exploitableSpace + (zone.progressionEdge + 1) / 2), rng);
  return target ? { from:currentZone, to:target.zone, via:target.zone, target:target.zone, distance:null, quality:routeType === "direct" ? 0.08 : routeType === "counter" ? 0.24 : 0.12, fallback:true, routeType } : null;
}

function startingZone(team, rng) {
  const zones = Object.values(team.zones).filter((zone) => zone.band === "defensiveThird" && zone.own.occupancy > 0);
  return weightedPick(zones, (zone) => zone.own.control * 0.45 + zone.own.support * 0.25 + zone.own.occupancy * 20 + zone.controlShare * 15, rng)?.zone ?? "defensiveThird:center";
}

function possessionWeight(team) {
  const midfield = Object.values(team.zones).filter((zone) => zone.band === "buildUp");
  const spatial = midfield.reduce((sum, zone) => sum + zone.own.control * 0.4 + zone.own.support * 0.2 + zone.controlShare * 30, 0);
  const dimensions = team.tacticalDimensions;
  // Ball retention must have an observable identity. Lower directness keeps the
  // ball, while tempo and pressing can recover it; time wasting no longer
  // incorrectly means surrendering possession in a fixed-chain simulation.
  const retention = 1
    + (50 - dimensions.directness) / 360
    + (50 - dimensions.tempo) / 900
    + (dimensions.pressing - 50) / 1200;
  return Math.max(1, spatial * clamp(retention, 0.78, 1.22));
}

function normalizeExecution(actor, defender, stage) {
  const attack = weightedMetric(actor, STAGE_METRICS[stage]);
  const defenseWeights = stage === "shot" && roleGroup(defender?.assignedRole) === "GK" ? GOALKEEPER_METRICS : DEFENSE_METRICS[stage];
  const defense = defender ? weightedMetric(defender, defenseWeights) : 50;
  return clamp(0.5 + (attack - defense) / 150, 0, 1);
}

function stageFactors(team, zone, actor, defender, connection, stage) {
  const pressure = zone.opponent.pressure;
  const resistance = zone.own.pressResistance;
  return {
    execution:normalizeExecution(actor, defender, stage),
    control:zone.controlShare,
    connection:connection?.quality ?? team.connectionQuality,
    pressureSafety:resistance + pressure > 0 ? resistance / (resistance + pressure) : 0.5,
    space:zone.exploitableSpace,
    progression:(zone.progressionEdge + 1) / 2,
    overload:clamp(0.5 + zone.numericalAdvantage / 3, 0, 1),
  };
}

function stateProbabilityAdjustment(parameters, team, stage, state, environment, chainIndex) {
  const snapshot = team.v2Snapshot ?? {};
  const score = state?.score;
  const scoreState = Array.isArray(score)
    ? score[team.teamIndex] > score[1 - team.teamIndex] ? "leading" : score[team.teamIndex] < score[1 - team.teamIndex] ? "trailing" : "level"
    : snapshot.scoreState ?? "level";
  const urgency = scoreState === "trailing" ? parameters.state.trailingUrgencyMaximum * Number(state?.minute ?? snapshot.minute ?? 0) / parameters.state.regulationMinutes : 0;
  const control = scoreState === "leading" && ["buildUp", "progression"].includes(stage) ? parameters.state.leadingControlMaximum : 0;
  const weather = parameters.environment.weatherExecution[environment?.weather ?? snapshot.weather ?? "sunny"] ?? 1;
  // Fitness is already applied to every player's metrics in the spatial
  // snapshot. A second chain-index penalty used to double-charge fatigue and
  // collapse attacking probabilities late in matches.
  const fatigue = 0;
  const tacticalWeights = parameters.tactics.stageProbabilityDimensionWeights?.[stage] ?? {};
  const tactical = Object.entries(tacticalWeights).reduce((total, [dimension, weight]) => {
    const definition = parameters.tactics.dimensions?.[dimension];
    if (!definition) return total;
    const halfRange = Math.max(1, (Number(definition.maximum) - Number(definition.minimum)) / 2);
    const offset = clamp((Number(team.tacticalDimensions?.[dimension] ?? definition.default) - Number(definition.default)) / halfRange, -1, 1);
    return total + offset * Number(weight);
  }, 0) + Number(parameters.tactics.stageProbabilityStyleAdjustments?.[team.style]?.[stage] ?? 0);
  return { urgency, control, tactical, weather, fatigue, total:urgency + control + tactical + (weather - 1) - fatigue };
}

function stageProbability(parameters, stage, factors, adjustment) {
  const weights = parameters.chain.factorWeights[stage];
  const factorScore = Object.entries(weights).reduce((sum, [factor, weight]) => sum + factors[factor] * weight, 0);
  const baseline = parameters.chain.baseProbabilities[stage];
  const raw = baseline + (factorScore - 0.5) * 0.52 + adjustment.total;
  const bounds = parameters.chain.probabilityBounds[stage];
  return round(clamp(raw, bounds.minimum, bounds.maximum));
}

function attemptStage(context, stage, currentZone, connection = null) {
  const { team, opponent, parameters, rng, recordRandomRolls, state, environment, chainIndex, deferShotResolution } = context;
  const zone = team.zones[currentZone];
  const actor = chooseActor(team, currentZone, stage, rng);
  const defender = chooseDefender(team, opponent, currentZone, stage, rng);
  const factors = stageFactors(team, zone, actor, defender, connection, stage);
  const stateAdjustment = stateProbabilityAdjustment(parameters, team, stage, state, environment, chainIndex);
  const probability = stageProbability(parameters, stage, factors, stateAdjustment);
  const roll = safeRoll(rng);
  const success = stage === "shot" && deferShotResolution ? true : roll < probability;
  const referee = environment?.referee ?? "standard";
  const refereeFactor = parameters.environment.refereeDiscipline[referee] ?? 1;
  const roughFactor = opponent.style === "roughPlay" ? 1.9 : 1;
  const defenderDiscipline = Number(defender?.metrics?.discipline ?? 70);
  const defenderAggression = Number(defender?.metrics?.pressing ?? 60);
  const penaltyDraw = actor?.v2TraitHooks?.find((rule) => rule.hook === "penaltyDraw");
  const foulProbability = !success && defender && stage !== "shot"
    ? clamp((0.025 + Math.max(0, defenderAggression - 65) / 700 + Math.max(0, 68 - defenderDiscipline) / 600) * refereeFactor * roughFactor * Number(penaltyDraw?.foulMultiplier ?? 1), 0.01, 0.32)
    : 0;
  const foul = foulProbability > 0 && safeRoll(rng) < foulProbability;
  const penalty = foul && zone.band === "box" && safeRoll(rng) < clamp((0.025 + zone.own.attack / 3000) * Number(penaltyDraw?.penaltyMultiplier ?? 1), 0.04, 0.24);
  const cardProbability = foul ? (parameters.environment.cardProbability[referee] ?? 0.2) * (opponent.style === "roughPlay" ? 1.16 : 1) : 0;
  const cardRoll = foul ? safeRoll(rng) : 1;
  const directRedProbability = foul ? parameters.environment.directRedProbability[referee] ?? 0.02 : 0;
  const card = cardRoll < directRedProbability ? "red" : cardRoll < cardProbability ? "yellow" : null;
  const simulationYellow = Boolean(foul && Number(penaltyDraw?.simulationYellowChance ?? 0) > 0 && safeRoll(rng) < Number(penaltyDraw.simulationYellowChance));
  const failureOutcome = foul ? (penalty ? "penaltyWon" : "setPieceWon") : defender ? "defensiveTurnover" : "unforcedTurnover";
  return {
    stage,
    owner:parameters.stacking.effectOwnership[STAGE_OWNER[stage]],
    teamIndex:team.teamIndex,
    zone:currentZone,
    worldZone:zone.worldZone,
    actor:actor ? { id:actor.id, name:actor.name, role:actor.assignedRole } : null,
    defender:defender ? { id:defender.id, name:defender.name, role:defender.assignedRole } : null,
    probability,
    ...(recordRandomRolls ? { roll:round(roll) } : {}),
    success,
    foul:{ occurred:foul, probability:round(foulProbability), referee, penalty, card, cardProbability:round(cardProbability), simulationYellow, traitId:penaltyDraw?.traitId ?? null, actorId:actor?.id ?? null },
    factors:Object.fromEntries(Object.entries(factors).map(([key, value]) => [key, round(value)])),
    stateAdjustment:Object.fromEntries(Object.entries(stateAdjustment).map(([key, value]) => [key, round(value)])),
    connection:connection ? { from:connection.from, to:connection.to, via:connection.via, target:connection.target, quality:connection.quality, fallback:Boolean(connection.fallback), routeType:connection.routeType ?? "structured" } : null,
    outcome:success
      ? (stage === "shot" ? (deferShotResolution ? "shotCreated" : "goal") : "retained")
      : stage === "shot"
        ? "savedOrMissed"
        : failureOutcome,
    turnover:success || !defender || foul ? null : { teamIndex:opponent.teamIndex, playerId:defender.id, playerRole:defender.assignedRole, zone:currentZone },
  };
}

export function simulateV2PossessionChain(teams, options = {}) {
  if (!Array.isArray(teams) || teams.length !== 2) throw new Error("V2控球链需要恰好两支球队");
  const parameters = options.parameters ? resolveV2MatchParameters(options.parameters) : V2_MATCH_PARAMETERS;
  const rng = options.rng ?? Math.random;
  if (typeof rng !== "function") throw new Error("V2控球链需要随机函数");
  const snapshotTeams = options.snapshotTeams ?? buildV2TeamSnapshots(teams, { parameters, state:options.state, environment:options.environment });
  const spatial = options.spatial ?? buildV2SpatialMatchup(snapshotTeams, { parameters });
  const stageSpatials = options.stageSpatials ?? buildV2StageSpatialCache(snapshotTeams, { parameters });
  const weights = spatial.teams.map(possessionWeight);
  const possessionShare = weights[0] / (weights[0] + weights[1]);
  const transitionAttackingIndex = Number(options.transition?.attackingTeamIndex);
  const attackingIndex = transitionAttackingIndex === 0 || transitionAttackingIndex === 1
    ? transitionAttackingIndex
    : safeRoll(rng) < possessionShare ? 0 : 1;
  const openingTeam = spatial.teams[attackingIndex];
  let currentZone = options.transition?.wonZone ?? startingZone(openingTeam, rng);
  const recordRandomRolls = options.recordRandomRolls ?? parameters.events.recordRandomRolls;
  const stages = [{
    stage:"possession",
    owner:parameters.stacking.effectOwnership.possessionSelection,
    teamIndex:attackingIndex,
    zone:currentZone,
    probability:round(attackingIndex === 0 ? possessionShare : 1 - possessionShare),
    success:true,
    outcome:"selected",
  }];
  const transitionBand = options.transition?.wonZone?.split(":")[0];
  const firstStage = TRANSITION_START_STAGE[transitionBand] ?? "buildUp";
  const firstStageIndex = parameters.chain.stages.indexOf(firstStage);
  for (const stage of parameters.chain.stages.slice(firstStageIndex)) {
    const stageSpatial = stageSpatials[attackingIndex]?.[stage];
    if (!stageSpatial) throw new Error(`V2控球链缺少${stage}阶段空间快照`);
    const team = stageSpatial.teams[attackingIndex];
    const opponent = stageSpatial.teams[attackingIndex === 0 ? 1 : 0];
    const context = { team, opponent, parameters, rng, recordRandomRolls, state:options.state, environment:options.environment, chainIndex:options.chainIndex, deferShotResolution:Boolean(options.deferShotResolution) };
    const targetBand = STAGE_TARGET_BAND[stage];
    const connection = targetBand ? chooseRoute(team, currentZone, targetBand, stage, rng, parameters, options.transition) : null;
    if (targetBand && !connection) break;
    if (connection) currentZone = connection.target;
    if (stage === "finalThird" && opponent.outOfPossessionDetails?.lineStrategy === "offside") {
      const offsideProbability = clamp(0.055 + (Number(opponent.tacticalDimensions.defensiveLine ?? 50) - 50) * 0.0014 + Math.max(0, Number(team.tacticalDimensions.directness ?? 50) - 50) * 0.0007, 0.025, 0.19);
      if (safeRoll(rng) < offsideProbability) {
        stages.push({ stage, owner:"finalThirdEntry", teamIndex:attackingIndex, zone:currentZone, probability:round(offsideProbability), success:false, outcome:"offside", connection, turnover:null });
        break;
      }
    }
    const result = attemptStage(context, stage, currentZone, connection);
    result.stageSpatialModelVersion = stageSpatial.modelVersion;
    stages.push(result);
    if (!result.success) break;
  }

  const finalStage = stages.at(-1);
  const weather = options.environment?.weather ?? "sunny";
  const weatherEventProbability = parameters.environment.weatherEventPerChain[weather] ?? 0;
  const weatherEvent = safeRoll(rng) < weatherEventProbability
    ? { type:weather === "storm" ? "lightningInjury" : "weatherInjury", weather, probability:weatherEventProbability }
    : null;
  return deepFreeze({
    engineVersion:parameters.engineVersion,
    modelVersion:"possession-chain-v2-alpha.1",
    spatialModelVersion:spatial.modelVersion,
    context:{ state:options.state ?? null, environment:options.environment ?? null, transition:options.transition ?? null, chainIndex:Number(options.chainIndex ?? 0) },
    attackingTeamIndex:attackingIndex,
    defendingTeamIndex:attackingIndex === 0 ? 1 : 0,
    startZone:stages[0].zone,
    endZone:finalStage.zone,
    completedStages:stages.filter((stage) => stage.success).map((stage) => stage.stage),
    terminalOutcome:finalStage.outcome,
    goal:finalStage.stage === "shot" && finalStage.success && !options.deferShotResolution,
    xg:finalStage.stage === "shot" ? finalStage.probability : 0,
    independentEvents:weatherEvent ? [weatherEvent] : [],
    stages,
  });
}
