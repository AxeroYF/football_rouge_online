import { roleGroup } from "../../game/public/schema.js";
import { resolveV2MatchParameters, V2_MATCH_PARAMETERS } from "./match-parameters-v2.js";
import { buildV21StageDynamicShapeSnapshot, buildV2SpatialMatchup, buildV2StageSpatialCache, buildV2StageSpatialMatchup } from "./spatial-model-v2.js";
import { buildV2TeamSnapshots } from "./team-snapshot-v2.js";
import {
  isV2TargetForward,
  v2DutyDefenderMultiplier,
  v2DutyOffsideMultiplier,
  v2DutyStageMultiplier,
} from "./player-duties-v2.js";
import { v2AttackingCommitmentProfile } from "./tactical-balance-v2.js";

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

function geometryMinimumPairDistance(players) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let leftIndex = 0; leftIndex < players.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < players.length; rightIndex += 1) {
      const left = players[leftIndex].localPosition;
      const right = players[rightIndex].localPosition;
      minimum = Math.min(minimum, Math.hypot(right.x - left.x, right.y - left.y));
    }
  }
  return round(Number.isFinite(minimum) ? minimum : 0, 3);
}

function stableShapeMetrics(team) {
  const players = team.players ?? [];
  const xs = players.map((player) => Number(player.localPosition?.x ?? 50));
  const ys = players.map((player) => Number(player.localPosition?.y ?? 50));
  const centroid = players.length ? {
    x:xs.reduce((sum, value) => sum + value, 0) / players.length,
    y:ys.reduce((sum, value) => sum + value, 0) / players.length,
  } : { x:50, y:50 };
  return {
    centroid:{ x:round(centroid.x, 3), y:round(centroid.y, 3) },
    width:round(players.length ? Math.max(...xs) - Math.min(...xs) : 0, 3),
    depth:round(players.length ? Math.max(...ys) - Math.min(...ys) : 0, 3),
    minimumPairDistance:geometryMinimumPairDistance(players),
    restDefenseCount:players.filter((player) => ["CB", "LB", "RB", "LWB", "RWB", "DM"].includes(player.assignedRole) && Number(player.localPosition?.y ?? 0) >= 48).length,
  };
}

function shapeMetricDelta(dynamicMetrics, stableMetrics) {
  return {
    centroidX:round(Number(dynamicMetrics.centroid.x) - Number(stableMetrics.centroid.x), 3),
    centroidY:round(Number(dynamicMetrics.centroid.y) - Number(stableMetrics.centroid.y), 3),
    width:round(Number(dynamicMetrics.width) - Number(stableMetrics.width), 3),
    depth:round(Number(dynamicMetrics.depth) - Number(stableMetrics.depth), 3),
    minimumPairDistance:round(Number(dynamicMetrics.minimumPairDistance) - Number(stableMetrics.minimumPairDistance), 3),
    restDefenseCount:Number(dynamicMetrics.restDefenseCount) - Number(stableMetrics.restDefenseCount),
  };
}

function compactDynamicShapeTrace(snapshot, stageSpatial) {
  if (!snapshot) return null;
  return {
    modelVersion:snapshot.modelVersion,
    stage:snapshot.stage,
    ballLane:snapshot.ballLane,
    possessionType:snapshot.possessionType,
    teams:snapshot.teams.map((team) => {
      const stable = stableShapeMetrics(stageSpatial.teams[team.teamIndex]);
      const dynamic = { ...team.metrics };
      return {
        teamIndex:team.teamIndex,
        attacking:team.attacking,
        formation:team.formation,
        tactic:stageSpatial.teams[team.teamIndex].tactic,
        style:stageSpatial.teams[team.teamIndex].style,
        stable,
        dynamic,
        delta:shapeMetricDelta(dynamic, stable),
      };
    }),
  };
}

function compactReplayShape(snapshot) {
  if (!snapshot) return null;
  return {
    modelVersion:snapshot.modelVersion,
    stage:snapshot.stage,
    attackingTeamIndex:snapshot.attackingTeamIndex,
    ballLane:snapshot.ballLane,
    possessionType:snapshot.possessionType,
    teams:snapshot.teams.map((team) => ({
      teamIndex:team.teamIndex,
      attacking:team.attacking,
      players:team.players.map((player) => ({
        id:player.id,
        role:player.assignedRole,
        x:round(player.targetPosition.x, 2),
        y:round(player.targetPosition.y, 2),
      })),
    })),
  };
}
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
const MARKING_DEFENDER_METRICS = Object.freeze({
  zonal:Object.freeze({ positioning:.42, decisions:.28, marking:.18, pace:.12 }),
  mixed:Object.freeze({ marking:.28, positioning:.28, tackling:.2, decisions:.14, pace:.1 }),
  man:Object.freeze({ marking:.42, pace:.2, strength:.16, tackling:.14, decisions:.08 }),
});

export function v2MarkingDefenderScore(player, marking = "mixed", stage = "chance") {
  const weights = marking === "mixed" ? DEFENSE_METRICS[stage] : MARKING_DEFENDER_METRICS[marking] ?? DEFENSE_METRICS[stage];
  return weightedMetric(player, weights);
}

export function v2MarkingExecutionAdjustment(actor, defender, marking = "mixed") {
  if (!actor || !defender || marking === "mixed") return 0;
  const markingDefense = weightedMetric(defender, MARKING_DEFENDER_METRICS[marking] ?? MARKING_DEFENDER_METRICS.mixed);
  const escape = weightedMetric(actor, marking === "man"
    ? { offBall:.34, acceleration:.24, agility:.18, decisions:.14, strength:.1 }
    : { vision:.28, decisions:.26, offBall:.2, passing:.16, agility:.1 });
  return clamp((markingDefense - escape) / 500, -0.055, 0.055);
}
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

function chooseActor(team, zoneId, stage, rng, previousActorId = null, continuationWeight = 1, connection = null, previousStageContext = null) {
  const candidates = zoneCandidates(team, team, zoneId, "own");
  const outfield = candidates.filter((player) => roleGroup(player.assignedRole) !== "GK");
  const pool = outfield.length ? outfield : candidates;
  const hasPassingOption = Boolean(previousActorId) && pool.some((player) => player.id !== previousActorId);
  return weightedPick(pool, (player) => {
    const targetLayoff = previousStageContext?.targetSupport && previousStageContext?.routeType === "direct"
      ? (player.id === previousActorId ? .46 : 1.34)
      : 1;
    return player.influence * weightedMetric(player, STAGE_METRICS[stage])
      * v2DutyStageMultiplier(player, stage, { routeType:connection?.routeType })
      * (hasPassingOption && player.id === previousActorId ? continuationWeight : 1)
      * targetLayoff;
  }, rng);
}

function chooseDefender(team, opponent, zoneId, stage, rng) {
  const candidates = zoneCandidates(team, opponent, zoneId, "opponent");
  if (stage === "shot") {
    const goalkeepers = opponent.players.filter((player) => roleGroup(player.assignedRole) === "GK");
    if (goalkeepers.length) return weightedPick(goalkeepers, (player) => weightedMetric(player, GOALKEEPER_METRICS), rng);
  }
  const outfield = candidates.filter((player) => roleGroup(player.assignedRole) !== "GK");
  const pool = outfield.length ? outfield : candidates;
  const marking = opponent.outOfPossessionDetails?.marking ?? "mixed";
  return weightedPick(pool, (player) => player.influence * (stage === "shot" ? weightedMetric(player, DEFENSE_METRICS[stage]) : v2MarkingDefenderScore(player, marking, stage)) * v2DutyDefenderMultiplier(player, stage), rng);
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

function lowBlockOutletAvailability(team, parameters) {
  if ((team.styleIdentity?.style ?? team.style) !== "lowBlock") return 1;
  const config = parameters.tactics?.styleIdentity?.lowBlock ?? {};
  const outlets = (team.players ?? []).filter((player) => ["ST", "LW", "RW", "LM", "RM", "AM"].includes(player.assignedRole));
  const minimumAttackers = Math.max(1, Number(config.outletMinimumAttackers ?? 2));
  const countMultiplier = clamp(outlets.length / minimumAttackers, 0, 1);
  const outletScore = outlets.length
    ? outlets.reduce((total, player) => total
      + Number(player.metrics?.movement ?? 55) * 0.5
      + Number(player.metrics?.pressResistance ?? 55) * 0.25
      + Number(player.metrics?.finishing ?? 55) * 0.25, 0) / outlets.length
    : 0;
  const scoreFloor = Number(config.outletScoreFloor ?? 55);
  const scoreCeiling = Math.max(scoreFloor + 1, Number(config.outletScoreCeiling ?? 86));
  const qualityMultiplier = clamp((outletScore - scoreFloor) / (scoreCeiling - scoreFloor), 0, 1);
  const minimumMultiplier = clamp(Number(config.outletMinimumMultiplier ?? 0.45), 0, 1);
  return minimumMultiplier + (1 - minimumMultiplier) * countMultiplier * qualityMultiplier;
}

function chooseRoute(team, currentZone, targetBand, stage, rng, parameters, transition) {
  const directness = team.tacticalDimensions.directness;
  const counter = team.tacticalDimensions.counterAttack;
  const routeParameters = parameters.chain.route;
  const commitmentConfig = parameters.tactics.attackingCommitment ?? {};
  const commitment = v2AttackingCommitmentProfile(team.tacticalDimensions, parameters);
  const deepSeverity = Number(team.deepDefensiveSeverity ?? commitment.deepDefensiveSeverity);
  const outletAvailability = lowBlockOutletAvailability(team, parameters);
  const counterRouteMultiplier = 1 - deepSeverity * (1 - Number(commitmentConfig.counterRouteMinimumMultiplier ?? 0.66));
  const counterChance = transition?.wonZone
    ? clamp((routeParameters.counterMinimumChance + counter / 100 * (routeParameters.counterMaximumChance - routeParameters.counterMinimumChance)) * counterRouteMultiplier * outletAvailability, 0, 1)
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
      ? (() => {
          const bonusMultiplier = 1 - deepSeverity * (1 - Number(commitmentConfig.counterConnectionBonusMinimumMultiplier ?? 0.25));
          const structuralPenalty = deepSeverity * Number(commitmentConfig.counterConnectionPenaltyMaximum ?? 0.045);
          return clamp(
            selected.quality
            + routeParameters.counterConnectionBonus * bonusMultiplier
            + team.zones[selected.target].exploitableSpace * routeParameters.counterSpaceReward * counterRouteMultiplier * outletAvailability
            + (Number(team.styleIdentity?.outletMultiplier ?? 1) - 1) * 0.18
            - structuralPenalty,
            0.04,
            1,
          );
        })()
        : selected.quality;
    return { ...selected, quality:round(quality), routeType };
  }
  const fallbackZones = Object.values(team.zones).filter((zone) => zone.band === routeTargetBand && zone.own.occupancy > 0);
  const target = weightedPick(fallbackZones, (zone) => Math.max(0.01, zone.controlShare + zone.exploitableSpace + (zone.progressionEdge + 1) / 2), rng);
  const fallbackCounterQuality = clamp(
    0.24 * counterRouteMultiplier * outletAvailability - deepSeverity * Number(commitmentConfig.counterConnectionPenaltyMaximum ?? 0.045),
    0.04,
    0.24,
  );
  return target ? { from:currentZone, to:target.zone, via:target.zone, target:target.zone, distance:null, quality:routeType === "direct" ? 0.08 : routeType === "counter" ? fallbackCounterQuality : 0.12, fallback:true, routeType } : null;
}

function startingZone(team, rng) {
  const zones = Object.values(team.zones).filter((zone) => zone.band === "defensiveThird" && zone.own.occupancy > 0);
  return weightedPick(zones, (zone) => zone.own.control * 0.45 + zone.own.support * 0.25 + zone.own.occupancy * 20 + zone.controlShare * 15, rng)?.zone ?? "defensiveThird:center";
}

function possessionWeight(team, parameters) {
  const midfield = Object.values(team.zones).filter((zone) => zone.band === "buildUp");
  const spatial = midfield.reduce((sum, zone) => sum + zone.own.control * 0.4 + zone.own.support * 0.2 + zone.controlShare * 30, 0);
  const dimensions = team.tacticalDimensions;
  // Ball retention must have an observable identity. Lower directness keeps the
  // ball, while tempo and pressing can recover it; time wasting no longer
  // incorrectly means surrendering possession in a fixed-chain simulation.
  const retention = 1
    + (50 - dimensions.directness) / 520
    + (50 - dimensions.tempo) / 1400
    + (dimensions.pressing - 50) / 1800;
  const midfieldConfig = parameters.spatial.midfieldStructure ?? {};
  const midfieldIntegrity = clamp(Number(team.midfieldIntegrity ?? 1), 0, 1);
  const minimumMultiplier = clamp(Number(midfieldConfig.possessionMinimumMultiplier ?? 0.16), 0, 1);
  const structureMultiplier = minimumMultiplier + (1 - minimumMultiplier) * Math.pow(midfieldIntegrity, Math.max(0.1, Number(midfieldConfig.possessionIntegrityExponent ?? 1.15)));
  const backlineConfig = parameters.spatial.backlineExposure ?? {};
  const underThreeDefenderFailure = clamp(Number(team.underThreeDefenderFailure ?? 0), 0, 1);
  const underThreeDefenderPossessionMultiplier = 1 - underThreeDefenderFailure * (1 - Number(backlineConfig.underThreeDefenderPossessionMultiplierMinimum ?? 1));
  return Math.max(1, spatial * clamp(retention, 0.86, 1.14) * structureMultiplier) * underThreeDefenderPossessionMultiplier;
}

export function v2RepeatYellowCardProbability(cardProbability, directRedProbability, yellowCards = 0, parameters = V2_MATCH_PARAMETERS) {
  const directRed = clamp(Number(directRedProbability), 0, 1);
  const card = clamp(Number(cardProbability), directRed, 1);
  if (Number(yellowCards) < 1) return card;
  return clamp(
    directRed + (card - directRed) * Number(parameters.events.secondYellowCardMultiplier ?? 1),
    directRed,
    card,
  );
}

function normalizeExecution(actor, defender, stage, connection = null, marking = "mixed") {
  const targetSupportWeights = connection?.routeType === "direct" && isV2TargetForward(actor) && ["progression", "finalThird", "chance"].includes(stage)
    ? { aerialFinishing:.34, pressResistance:.32, buildUp:.2, movement:.14 }
    : null;
  const attack = weightedMetric(actor, targetSupportWeights ?? STAGE_METRICS[stage]);
  const defenseWeights = stage === "shot" && roleGroup(defender?.assignedRole) === "GK" ? GOALKEEPER_METRICS : DEFENSE_METRICS[stage];
  const defense = defender ? weightedMetric(defender, defenseWeights) : 50;
  const baseline = clamp(0.5 + (attack - defense) / 150, 0, 1);
  if (marking === "mixed") return baseline;
  const markingAdjustment = v2MarkingExecutionAdjustment(actor, defender, marking);
  return clamp(baseline - markingAdjustment, 0, 1);
}

function stageFactors(team, opponent, zone, actor, defender, connection, stage) {
  const pressure = zone.opponent.pressure;
  const resistance = zone.own.pressResistance;
  const marking = opponent.outOfPossessionDetails?.marking ?? "mixed";
  const markingSpace = marking === "man" ? 0.035 : marking === "zonal" ? -0.018 : 0;
  return {
    execution:normalizeExecution(actor, defender, stage, connection, marking),
    control:zone.controlShare,
    connection:connection?.quality ?? team.connectionQuality,
    pressureSafety:resistance + pressure > 0 ? resistance / (resistance + pressure) : 0.5,
    space:marking === "mixed" ? zone.exploitableSpace : clamp(zone.exploitableSpace + markingSpace, 0, 1),
    progression:(zone.progressionEdge + 1) / 2,
    overload:clamp(0.5 + zone.numericalAdvantage / 3, 0, 1),
  };
}

function stateProbabilityAdjustment(parameters, team, stage, state, environment, chainIndex, possessionType = "normal") {
  const snapshot = team.v2Snapshot ?? {};
  const score = state?.score;
  const scoreState = Array.isArray(score)
    ? score[team.teamIndex] > score[1 - team.teamIndex] ? "leading" : score[team.teamIndex] < score[1 - team.teamIndex] ? "trailing" : "level"
    : snapshot.scoreState ?? "level";
  const commitment = v2AttackingCommitmentProfile(team.tacticalDimensions, parameters);
  const stateBonusMultiplier = commitment.stateBonusMultiplier;
  const urgency = (scoreState === "trailing" ? parameters.state.trailingUrgencyMaximum * Number(state?.minute ?? snapshot.minute ?? 0) / parameters.state.regulationMinutes : 0) * stateBonusMultiplier;
  const control = (scoreState === "leading" && ["buildUp", "progression"].includes(stage) ? parameters.state.leadingControlMaximum : 0) * stateBonusMultiplier;
  const minute = Number(state?.minute ?? snapshot.minute ?? 0);
  const decisivenessStart = Number(parameters.state.levelDecisivenessStartMinute ?? parameters.state.regulationMinutes);
  const decisivenessProgress = clamp((minute - decisivenessStart) / Math.max(1, parameters.state.regulationMinutes - decisivenessStart), 0, 1);
  const decisiveness = (scoreState === "level" && ["finalThird", "chance"].includes(stage)
    ? Number(parameters.state.levelDecisivenessMaximum ?? 0) * decisivenessProgress
    : 0) * stateBonusMultiplier;
  const weather = parameters.environment.weatherExecution[environment?.weather ?? snapshot.weather ?? "sunny"] ?? 1;
  const weatherImpact = (weather - 1) * Number(parameters.environment.weatherStageImpact?.[stage] ?? 1);
  const patience = team.inPossessionDetails?.chanceCreation === "patient"
    ? Number({ buildUp:0.004, progression:0.006, finalThird:0.01, chance:0.014, shot:0 }[stage] ?? 0)
    : 0;
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
  }, 0) + Number(parameters.tactics.stageProbabilityStyleAdjustments?.[team.splitTacticsExplicit ? team.defensiveBlock : team.style]?.[stage] ?? 0);
  const highIntensityConfig = parameters.tactics.highIntensityOverlap ?? {};
  const highIntensityWeights = highIntensityConfig.weights ?? {};
  const highIntensityWeightTotal = Object.values(highIntensityWeights).reduce((total, weight) => total + Math.max(0, Number(weight) || 0), 0) || 1;
  const highIntensity = Object.entries(highIntensityWeights).reduce((total, [dimension, weight]) => {
    const definition = parameters.tactics.dimensions?.[dimension];
    if (!definition) return total;
    const range = Math.max(1, Number(definition.maximum) - Number(definition.default));
    return total + clamp((Number(team.tacticalDimensions?.[dimension] ?? definition.default) - Number(definition.default)) / range, 0, 1) * Math.max(0, Number(weight) || 0);
  }, 0) / highIntensityWeightTotal;
  const highIntensityThreshold = clamp(Number(highIntensityConfig.threshold ?? 0.56), 0, 1);
  const highIntensitySeverity = clamp((highIntensity - highIntensityThreshold) / Math.max(0.01, 1 - highIntensityThreshold), 0, 1);
  const highIntensityPenalty = highIntensitySeverity * Number(highIntensityConfig.stagePenaltyMaximum?.[stage] ?? 0);
  const commitmentConfig = parameters.tactics.attackingCommitment ?? {};
  const transitionPenaltyMultiplier = possessionType === "transition" ? Number(commitmentConfig.transitionStagePenaltyMultiplier ?? 1.12) : 1;
  const deepAttackPenalty = commitment.deepDefensiveSeverity * Number(commitmentConfig.stagePenaltyMaximum?.[stage] ?? 0) * transitionPenaltyMultiplier;
  const midfieldIntegrity = clamp(Number(team.midfieldIntegrity ?? 1), 0, 1);
  const midfieldPenalty = (1 - midfieldIntegrity) * Number(parameters.spatial.midfieldStructure?.stagePenaltyMaximum?.[stage] ?? 0);
  const underThreeDefenderFailure = clamp(Number(team.underThreeDefenderFailure ?? 0), 0, 1);
  const backlineConfig = parameters.spatial.backlineExposure ?? {};
  const underThreeDefenderPenalty = underThreeDefenderFailure * Number(backlineConfig.underThreeDefenderStagePenaltyMaximum?.[stage] ?? 0);
  const styleProgressionBonus = stage === "progression"
    ? (Number(team.styleIdentity?.progressionMultiplier ?? 1) - 1) * 0.1
    : 0;
  const styleTransitionBonus = possessionType === "transition"
    ? (Number(team.styleIdentity?.transitionMultiplier ?? 1) - 1) * (stage === "progression" ? 0.12 : stage === "chance" ? 0.08 : 0.04)
    : 0;
  const highPressRecoveryBonus = stage === "progression"
    ? (Number(team.styleIdentity?.recoveryMultiplier ?? 1) - 1) * 0.08
    : 0;
  return {
    urgency,
    control,
    decisiveness,
    patience,
    tactical,
    weather,
    weatherImpact,
    fatigue,
    attackingCommitment:commitment.commitment,
    deepDefensiveSeverity:commitment.deepDefensiveSeverity,
    stateBonusMultiplier,
    deepAttackPenalty,
    midfieldIntegrity,
    midfieldPenalty,
    underThreeDefenderFailure,
    underThreeDefenderPenalty,
    highIntensityPenalty,
    styleProgressionBonus,
    styleTransitionBonus,
    highPressRecoveryBonus,
    total:urgency + control + decisiveness + patience + tactical + weatherImpact + styleProgressionBonus + styleTransitionBonus + highPressRecoveryBonus - fatigue - highIntensityPenalty - deepAttackPenalty - midfieldPenalty - underThreeDefenderPenalty,
  };
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
  const { team, opponent, parameters, rng, recordRandomRolls, state, environment, chainIndex, possessionType, deferShotResolution, previousActorId, continuationWeight, previousStageContext } = context;
  const zone = team.zones[currentZone];
  const actor = chooseActor(team, currentZone, stage, rng, previousActorId, continuationWeight, connection, previousStageContext);
  const defender = chooseDefender(team, opponent, currentZone, stage, rng);
  const factors = stageFactors(team, opponent, zone, actor, defender, connection, stage);
  const stateAdjustment = stateProbabilityAdjustment(parameters, team, stage, state, environment, chainIndex, possessionType);
  const probability = stageProbability(parameters, stage, factors, stateAdjustment);
  const roll = safeRoll(rng);
  const success = stage === "shot" && deferShotResolution ? true : roll < probability;
  const referee = environment?.referee ?? "standard";
  const refereeFactor = parameters.environment.refereeDiscipline[referee] ?? 1;
  const roughPlay = parameters.events.roughPlay ?? {};
  const duelIntensity = opponent.splitTacticsExplicit ? opponent.duelIntensity : opponent.style;
  const usesRoughPlay = duelIntensity === "roughPlay";
  const foulIntensityFactor = usesRoughPlay ? Number(roughPlay.foulMultiplier ?? 1.9) : duelIntensity === "cautious" ? 0.72 : 1;
  const defenderDiscipline = Number(defender?.metrics?.discipline ?? 70);
  const defenderAggression = Number(defender?.metrics?.pressing ?? 60);
  const penaltyDraw = actor?.v2TraitHooks?.find((rule) => rule.hook === "penaltyDraw");
  const foulProbability = !success && defender && stage !== "shot"
    ? clamp((Number(parameters.events.baseFoulProbability ?? 0.025) + Math.max(0, defenderAggression - 65) / 700 + Math.max(0, 68 - defenderDiscipline) / 600) * refereeFactor * foulIntensityFactor * Number(penaltyDraw?.foulMultiplier ?? 1), 0.01, 0.32)
    : 0;
  const foul = foulProbability > 0 && safeRoll(rng) < foulProbability;
  const penalty = foul && zone.band === "box" && safeRoll(rng) < clamp(
    (Number(parameters.events.penaltyFoulBaseProbability ?? 0.025) + zone.own.attack * Number(parameters.events.penaltyFoulAttackWeight ?? (1 / 3000))) * Number(penaltyDraw?.penaltyMultiplier ?? 1),
    Number(parameters.events.minimumPenaltyFoulProbability ?? 0.04),
    Number(parameters.events.maximumPenaltyFoulProbability ?? 0.24),
  );
  const cardProbability = foul ? clamp((parameters.environment.cardProbability[referee] ?? 0.2) * (usesRoughPlay ? Number(roughPlay.cardMultiplier ?? 1.55) : duelIntensity === "cautious" ? 0.76 : 1), 0, 0.9) : 0;
  const directRedProbability = foul ? clamp((parameters.environment.directRedProbability[referee] ?? 0.02) * (usesRoughPlay ? Number(roughPlay.directRedMultiplier ?? 2.2) : duelIntensity === "cautious" ? 0.68 : 1), 0, 0.35) : 0;
  const effectiveCardProbability = v2RepeatYellowCardProbability(cardProbability, directRedProbability, defender?.matchStats?.yellowCards, parameters);
  const cardRoll = foul ? safeRoll(rng) : 1;
  const card = cardRoll < directRedProbability ? "red" : cardRoll < effectiveCardProbability ? "yellow" : null;
  const simulationYellowChance = Number(penaltyDraw?.simulationYellowChance ?? 0)
    * (Number(actor?.matchStats?.yellowCards ?? 0) >= 1 ? Number(parameters.events.secondYellowCardMultiplier ?? 1) : 1);
  const simulationYellow = Boolean(foul && simulationYellowChance > 0 && safeRoll(rng) < simulationYellowChance);
  const failureOutcome = foul ? (penalty ? "penaltyWon" : "setPieceWon") : defender ? "defensiveTurnover" : "unforcedTurnover";
  return {
    stage,
    owner:parameters.stacking.effectOwnership[STAGE_OWNER[stage]],
    teamIndex:team.teamIndex,
    zone:currentZone,
    worldZone:zone.worldZone,
    actor:actor ? { id:actor.id, name:actor.name, role:actor.assignedRole, tacticalDuty:actor.tacticalDuty ?? null } : null,
    defender:defender ? { id:defender.id, name:defender.name, role:defender.assignedRole, tacticalDuty:defender.tacticalDuty ?? null } : null,
    dutyAction:connection?.routeType === "direct" && isV2TargetForward(actor)
      ? "targetHoldUp"
      : previousStageContext?.targetSupport && previousStageContext?.routeType === "direct" && actor?.id !== previousStageContext.actorId
        ? "targetLayoff" : null,
    probability,
    defendingBacklineExposure:Number(opponent.backlineExposure ?? 0),
    defendingBacklineExposureBreakdown:opponent.backlineExposureBreakdown ?? null,
    defendingLine:Number(opponent.tacticalDimensions?.defensiveLine ?? 50),
    defendingStyle:opponent.style ?? null,
    defendingTacticalDimensions:opponent.tacticalDimensions ?? null,
    defendingStyleIdentity:opponent.styleIdentity ?? null,
    defendingMidfieldIntegrity:Number(opponent.midfieldIntegrity ?? 1),
    defendingLongShotExposure:Number(opponent.longShotExposure ?? 0),
    attackingStyleIdentity:team.styleIdentity ?? null,
    ...(recordRandomRolls ? { roll:round(roll) } : {}),
    success,
    foul:{ occurred:foul, probability:round(foulProbability), referee, penalty, card, cardProbability:round(effectiveCardProbability), baseCardProbability:round(cardProbability), simulationYellow, traitId:penaltyDraw?.traitId ?? null, actorId:actor?.id ?? null },
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
  const selectionExponent = Number(parameters.chain.possessionDuration?.selectionExponent ?? 1);
  const weights = spatial.teams.map((team) => Math.pow(possessionWeight(team, parameters), selectionExponent));
  const possessionShare = weights[0] / (weights[0] + weights[1]);
  const transitionAttackingIndex = Number(options.transition?.attackingTeamIndex);
  const counterOpportunity = (transitionAttackingIndex === 0 || transitionAttackingIndex === 1) && options.transition?.counterOpportunity !== false;
  const possessionType = counterOpportunity ? "transition" : "normal";
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
  const dynamicShapeSampleEvery = Number(parameters.dynamicShape.diagnostics.sampleEveryChains);
  const recordDynamicShape = ["shadow", "candidate"].includes(parameters.dynamicShape.mode)
    && Number(options.chainIndex ?? 0) % dynamicShapeSampleEvery === 0;
  let replayShape = null;
  const replaySequence = [];
  let previousActorId = null;
  let previousStageContext = null;
  for (const stage of parameters.chain.stages.slice(firstStageIndex)) {
    const stageSpatial = stageSpatials[attackingIndex]?.[stage];
    if (!stageSpatial) throw new Error(`V2控球链缺少${stage}阶段空间快照`);
    let team = stageSpatial.teams[attackingIndex];
    const targetBand = STAGE_TARGET_BAND[stage];
    const connection = targetBand ? chooseRoute(team, currentZone, targetBand, stage, rng, parameters, counterOpportunity ? options.transition : null) : null;
    if (targetBand && !connection) break;
    if (connection) currentZone = connection.target;
    const ballLane = currentZone.split(":")[1] ?? "center";
    const effectiveStageSpatial = ["stable", "candidate"].includes(parameters.dynamicShape.mode)
      ? buildV2StageSpatialMatchup(snapshotTeams, attackingIndex, stage, {
        parameters,
        parametersResolved:true,
        ballLane,
        possessionType,
      })
      : stageSpatial;
    const stageReplayShape = options.recordReplayShape && ["stable", "candidate"].includes(parameters.dynamicShape.mode)
      ? compactReplayShape(effectiveStageSpatial.dynamicShape)
      : null;
    if (stageReplayShape) replayShape = stageReplayShape;
    team = effectiveStageSpatial.teams[attackingIndex];
    const opponent = effectiveStageSpatial.teams[attackingIndex === 0 ? 1 : 0];
    const continuationWeight = parameters.dynamicShape.mode === "candidate"
      ? Number(parameters.dynamicShape.teamPlay?.sameActorContinuationWeight ?? 0.5)
      : 1;
    const context = { team, opponent, parameters, rng, recordRandomRolls, state:options.state, environment:options.environment, chainIndex:options.chainIndex, possessionType, deferShotResolution:Boolean(options.deferShotResolution), previousActorId, previousStageContext, continuationWeight };
    const dynamicShape = recordDynamicShape
      ? compactDynamicShapeTrace(effectiveStageSpatial.dynamicShape ?? buildV21StageDynamicShapeSnapshot(snapshotTeams, attackingIndex, stage, {
        parameters,
        parametersResolved:true,
        ballLane,
        possessionType,
      }), stageSpatial)
      : null;
    if (stage === "finalThird") {
      const offside = parameters.chain.offside ?? {};
      const offsideProbability = clamp(
        Number(offside.baseProbability ?? 0.018)
          + (opponent.outOfPossessionDetails?.lineStrategy === "offside" ? Number(offside.trapBonus ?? 0.035) : 0)
          + Math.max(0, Number(opponent.tacticalDimensions.defensiveLine ?? 50) - 50) * Number(offside.defensiveLineWeight ?? 0.0008)
          + Math.max(0, Number(team.tacticalDimensions.directness ?? 50) - 50) * Number(offside.directnessWeight ?? 0.0005),
        Number(offside.minimumProbability ?? 0.006),
        Number(offside.maximumProbability ?? 0.14),
      ) * (() => {
        const runners = team.players.filter((player) => ["ST", "LW", "RW", "AM"].includes(player.assignedRole));
        return runners.length ? runners.reduce((sum, player) => sum + v2DutyOffsideMultiplier(player), 0) / runners.length : 1;
      })();
      const boundedOffsideProbability = clamp(offsideProbability, Number(offside.minimumProbability ?? 0.006), Number(offside.maximumProbability ?? 0.14));
      const offsideRoll = safeRoll(rng);
      const usesOffsideTrap = opponent.outOfPossessionDetails?.lineStrategy === "offside";
      if ((usesOffsideTrap && offsideRoll < boundedOffsideProbability) || (!usesOffsideTrap && offsideRoll > 0 && offsideRoll < boundedOffsideProbability)) {
        if (stageReplayShape) replaySequence.push({ ...stageReplayShape, zone:currentZone, success:false, outcome:"offside" });
        stages.push({ stage, owner:"finalThirdEntry", teamIndex:attackingIndex, zone:currentZone, probability:round(boundedOffsideProbability), success:false, outcome:"offside", connection, turnover:null, factors:{}, ...(dynamicShape ? { dynamicShape } : {}) });
        break;
      }
    }
    const result = attemptStage(context, stage, currentZone, connection);
    if (result.actor?.id) {
      previousActorId = result.actor.id;
      previousStageContext = {
        actorId:result.actor.id,
        tacticalDuty:result.actor.tacticalDuty ?? null,
        targetSupport:result.actor.tacticalDuty === "targetForward",
        routeType:connection?.routeType ?? null,
      };
    }
    result.stageSpatialModelVersion = effectiveStageSpatial.modelVersion;
    if (dynamicShape) result.dynamicShape = dynamicShape;
    if (stageReplayShape) replaySequence.push({
      ...stageReplayShape,
      zone:currentZone,
      success:Boolean(result.success),
      outcome:result.outcome,
      actorId:result.actor?.id ?? null,
      defenderId:result.defender?.id ?? result.turnover?.playerId ?? null,
    });
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
    modelVersion:"possession-chain-v2.1",
    spatialModelVersion:spatial.modelVersion,
    context:{ state:options.state ?? null, environment:options.environment ?? null, transition:options.transition ?? null, chainIndex:Number(options.chainIndex ?? 0) },
    possessionType,
    attackingTeamIndex:attackingIndex,
    defendingTeamIndex:attackingIndex === 0 ? 1 : 0,
    startZone:stages[0].zone,
    endZone:finalStage.zone,
    completedStages:stages.filter((stage) => stage.success).map((stage) => stage.stage),
    terminalOutcome:finalStage.outcome,
    goal:finalStage.stage === "shot" && finalStage.success && !options.deferShotResolution,
    xg:finalStage.stage === "shot" ? finalStage.probability : 0,
    independentEvents:weatherEvent ? [weatherEvent] : [],
    ...(replayShape ? { replayShape } : {}),
    ...(replaySequence.length ? { replaySequence } : {}),
    stages,
  });
}
