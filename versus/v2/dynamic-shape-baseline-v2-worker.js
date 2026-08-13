import { parentPort, workerData } from "node:worker_threads";
import { buildS4BalanceSeat, createS4BalanceRng, pickS4BalanceArchetype } from "../s4-balance-report.js";
import { simulateV2Match } from "./match-engine-v2.js";
import { resolveV2MatchParameters } from "./match-parameters-v2.js";

const METRIC_KEYS = Object.freeze([
  "stableCentroidX", "stableCentroidY", "stableWidth", "stableDepth", "stableMinimumPairDistance", "stableRestDefenseCount",
  "dynamicCentroidX", "dynamicCentroidY", "dynamicWidth", "dynamicDepth", "dynamicMinimumPairDistance", "dynamicRestDefenseCount",
  "dynamicMaximumDisplacement", "dynamicAverageDisplacement",
  "deltaCentroidX", "deltaCentroidY", "deltaWidth", "deltaDepth", "deltaMinimumPairDistance", "deltaRestDefenseCount",
]);

function emptyBucket() {
  return {
    samples:0,
    sums:Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])),
    minima:Object.fromEntries(METRIC_KEYS.map((key) => [key, Number.POSITIVE_INFINITY])),
    maxima:Object.fromEntries(METRIC_KEYS.map((key) => [key, Number.NEGATIVE_INFINITY])),
    violations:{ nonFinite:0, separation:0, restDefense:0, criticalRestDefenseRegression:0, displacement:0, width:0, centroid:0 },
  };
}

function metricValues(team) {
  return {
    stableCentroidX:Number(team.stable.centroid.x),
    stableCentroidY:Number(team.stable.centroid.y),
    stableWidth:Number(team.stable.width),
    stableDepth:Number(team.stable.depth),
    stableMinimumPairDistance:Number(team.stable.minimumPairDistance),
    stableRestDefenseCount:Number(team.stable.restDefenseCount),
    dynamicCentroidX:Number(team.dynamic.centroid.x),
    dynamicCentroidY:Number(team.dynamic.centroid.y),
    dynamicWidth:Number(team.dynamic.width),
    dynamicDepth:Number(team.dynamic.depth),
    dynamicMinimumPairDistance:Number(team.dynamic.minimumPairDistance),
    dynamicRestDefenseCount:Number(team.dynamic.restDefenseCount),
    dynamicMaximumDisplacement:Number(team.dynamic.maximumDisplacement),
    dynamicAverageDisplacement:Number(team.dynamic.averageDisplacement),
    deltaCentroidX:Number(team.delta.centroidX),
    deltaCentroidY:Number(team.delta.centroidY),
    deltaWidth:Number(team.delta.width),
    deltaDepth:Number(team.delta.depth),
    deltaMinimumPairDistance:Number(team.delta.minimumPairDistance),
    deltaRestDefenseCount:Number(team.delta.restDefenseCount),
  };
}

function addBucket(map, key, team, guardrails) {
  const bucket = map[key] ??= emptyBucket();
  const values = metricValues(team);
  bucket.samples += 1;
  const finite = Object.values(values).every(Number.isFinite);
  bucket.violations.nonFinite += Number(!finite);
  for (const metric of METRIC_KEYS) {
    const value = values[metric];
    if (!Number.isFinite(value)) continue;
    bucket.sums[metric] += value;
    bucket.minima[metric] = Math.min(bucket.minima[metric], value);
    bucket.maxima[metric] = Math.max(bucket.maxima[metric], value);
  }
  const restMinimum = team.attacking ? Number(guardrails.attackingRestDefenseMinimum) : Number(guardrails.defendingRestDefenseMinimum);
  bucket.violations.separation += Number(values.dynamicMinimumPairDistance < Number(guardrails.minimumPairDistance));
  bucket.violations.restDefense += Number(values.dynamicRestDefenseCount < restMinimum);
  bucket.violations.criticalRestDefenseRegression += Number(values.stableRestDefenseCount >= restMinimum && values.dynamicRestDefenseCount < restMinimum);
  bucket.violations.displacement += Number(values.dynamicMaximumDisplacement > Number(guardrails.maximumPlayerDisplacement));
  bucket.violations.width += Number(values.dynamicWidth < Number(guardrails.minimumTeamWidth) || values.dynamicWidth > Number(guardrails.maximumTeamWidth));
  bucket.violations.centroid += Number(Math.abs(values.dynamicCentroidX - 50) > Number(guardrails.maximumAbsoluteCentroidX));
}

function addTrace(aggregate, trace, guardrails) {
  aggregate.traces += 1;
  for (const team of trace.teams) {
    aggregate.teamShapeSamples += 1;
    const perspective = team.attacking ? "attacking" : "defending";
    const dimensions = {
      overall:perspective,
      byStage:`${perspective}:${trace.stage}`,
      byLane:`${perspective}:${trace.ballLane}`,
      byPossessionType:`${perspective}:${trace.possessionType}`,
      byStyle:`${perspective}:${team.style ?? "unknown"}`,
      byTactic:`${perspective}:${team.tactic ?? "unknown"}`,
      byFormation:`${perspective}:${team.formation ?? "unknown"}`,
      bySide:`${perspective}:side${team.teamIndex}`,
      byStageLane:`${perspective}:${trace.stage}:${trace.ballLane}`,
    };
    for (const [dimension, key] of Object.entries(dimensions)) addBucket(aggregate.buckets[dimension], key, team, guardrails);
  }
}

try {
  const { config, start, count } = workerData;
  const parameters = resolveV2MatchParameters({
    dynamicShape:{
      mode:"shadow",
      diagnostics:{ sampleEveryChains:Number(config.sampleEveryChains) },
    },
  });
  const aggregate = {
    matches:0,
    traces:0,
    teamShapeSamples:0,
    buckets:{ overall:{}, byStage:{}, byLane:{}, byPossessionType:{}, byStyle:{}, byTactic:{}, byFormation:{}, bySide:{}, byStageLane:{} },
  };
  const rawSamples = [];
  const progressInterval = Math.max(1, Number(config.progressIntervalMatches ?? 1));
  for (let index = start; index < start + count; index += 1) {
    const seed = `${config.seed}:dynamic-shape:${index}`;
    const rng = createS4BalanceRng(seed);
    const archetypes = [
      pickS4BalanceArchetype(rng, config.ecosystemWeights),
      pickS4BalanceArchetype(rng, config.ecosystemWeights),
    ];
    const seats = archetypes.map((archetype, teamIndex) => buildS4BalanceSeat(seed, teamIndex === 0 ? "home" : "away", archetype));
    const match = simulateV2Match(seats, {
      seed:`${seed}:v2.1d-shadow`,
      possessionChains:Number(config.possessionChainsPerMatch),
      parameters,
    });
    const traces = (match.chains ?? []).flatMap((chain) => (chain.stages ?? []).map((stage) => stage.dynamicShape).filter(Boolean));
    traces.forEach((trace) => addTrace(aggregate, trace, config.guardrails));
    aggregate.matches += 1;
    if (index < Number(config.rawMatchSampleLimit ?? 0)) {
      rawSamples.push({
        index,
        seed,
        archetypes,
        score:[...match.score],
        traceCount:traces.length,
        traces,
      });
    }
    const completed = index - start + 1;
    if (completed % progressInterval === 0 || completed === count) parentPort.postMessage({ type:"progress", completed, total:count });
  }
  parentPort.postMessage({ type:"result", aggregate, rawSamples });
} catch (error) {
  parentPort.postMessage({ error:{ name:error.name, message:error.message, stack:error.stack } });
}
