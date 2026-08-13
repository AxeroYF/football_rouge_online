import { parentPort, workerData } from "node:worker_threads";
import { buildS4BalanceSeat, createS4BalanceRng, pickS4BalanceArchetype } from "../s4-balance-report.js";
import { simulateV2Match } from "./match-engine-v2.js";
import { resolveV2MatchParameters } from "./match-parameters-v2.js";
import { v2ScenarioForMatch, v2ScenarioSeatOptions } from "./engine-comparison-v2-scenario-matrix.js";

const TEAM_METRICS = Object.freeze([
  "points", "wins", "draws", "goalsFor", "goalsAgainst", "xg", "shots", "shotsOnTarget",
  "possessions", "possessionShare", "normalPossessions", "transitionPossessions", "transitionShots",
]);

function emptyMetrics() {
  return Object.fromEntries(TEAM_METRICS.map((key) => [key, 0]));
}

function emptyBucket() {
  return { samples:0, stable:emptyMetrics(), candidate:emptyMetrics() };
}

function teamMetrics(match, teamIndex) {
  const own = match.teams[teamIndex];
  const opponent = match.teams[1 - teamIndex];
  const goalsFor = Number(match.score[teamIndex]);
  const goalsAgainst = Number(match.score[1 - teamIndex]);
  const ownSeconds = Number(own.stats.possessionSeconds ?? own.stats.possessions ?? 0);
  const totalSeconds = ownSeconds + Number(opponent.stats.possessionSeconds ?? opponent.stats.possessions ?? 0);
  return {
    points:goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0,
    wins:Number(goalsFor > goalsAgainst),
    draws:Number(goalsFor === goalsAgainst),
    goalsFor,
    goalsAgainst,
    xg:Number(own.stats.xg ?? 0),
    shots:Number(own.stats.shots ?? 0),
    shotsOnTarget:Number(own.stats.shotsOnTarget ?? 0),
    possessions:Number(own.stats.possessions ?? 0),
    possessionShare:totalSeconds > 0 ? ownSeconds / totalSeconds : 0.5,
    normalPossessions:Number(own.stats.normalPossessions ?? 0),
    transitionPossessions:Number(own.stats.transitionPossessions ?? 0),
    transitionShots:Number(own.stats.transitionShots ?? 0),
  };
}

function addBucket(map, key, stableValues, candidateValues) {
  const bucket = map[key] ??= emptyBucket();
  bucket.samples += 1;
  for (const metric of TEAM_METRICS) {
    bucket.stable[metric] += Number(stableValues[metric] ?? 0);
    bucket.candidate[metric] += Number(candidateValues[metric] ?? 0);
  }
}

function addMatchTotals(target, match) {
  const goals = Number(match.score[0]) + Number(match.score[1]);
  target.goals += goals;
  target.xg += match.teams.reduce((sum, team) => sum + Number(team.stats.xg ?? 0), 0);
  target.shots += match.teams.reduce((sum, team) => sum + Number(team.stats.shots ?? 0), 0);
  target.shotsOnTarget += match.teams.reduce((sum, team) => sum + Number(team.stats.shotsOnTarget ?? 0), 0);
  target.zeroZero += Number(goals === 0);
  target.sixPlusGoals += Number(goals >= 6);
  target.homeWins += Number(match.score[0] > match.score[1]);
  target.draws += Number(match.score[0] === match.score[1]);
  target.awayWins += Number(match.score[0] < match.score[1]);
}

function addStageTotals(target, match, variant) {
  for (const chain of match.chains ?? []) {
    for (const stage of chain.stages?.slice(1) ?? []) {
      const bucket = target[stage.stage] ??= {
        stable:{ attempts:0, successes:0, probability:0 },
        candidate:{ attempts:0, successes:0, probability:0 },
      };
      bucket[variant].attempts += 1;
      bucket[variant].successes += Number(stage.success);
      bucket[variant].probability += Number(stage.probability ?? 0);
    }
  }
}

function matchSummary(match) {
  return {
    score:[...match.score],
    teams:match.teams.map((team, teamIndex) => ({
      teamIndex,
      goals:Number(match.score[teamIndex]),
      xg:Number(team.stats.xg ?? 0),
      shots:Number(team.stats.shots ?? 0),
      shotsOnTarget:Number(team.stats.shotsOnTarget ?? 0),
      possessionSeconds:Number(team.stats.possessionSeconds ?? 0),
      possessions:Number(team.stats.possessions ?? 0),
      transitionShots:Number(team.stats.transitionShots ?? 0),
    })),
  };
}

function emptyAggregate() {
  return {
    matches:0,
    stable:{ goals:0, xg:0, shots:0, shotsOnTarget:0, zeroZero:0, sixPlusGoals:0, homeWins:0, draws:0, awayWins:0 },
    candidate:{ goals:0, xg:0, shots:0, shotsOnTarget:0, zeroZero:0, sixPlusGoals:0, homeWins:0, draws:0, awayWins:0 },
    paired:{ scoreChanged:0, resultChanged:0, absoluteGoalDelta:0, absoluteXgDelta:0 },
    stages:{},
    buckets:{ bySide:{}, byFormation:{}, byTactic:{}, byStyle:{}, byTacticalProfile:{}, byScenarioCategory:{}, byFormationTacticStyle:{} },
  };
}

try {
  const { config, start, count } = workerData;
  const stableParameters = resolveV2MatchParameters({ dynamicShape:{ mode:"off" } });
  const candidateParameters = resolveV2MatchParameters({
    dynamicShape:{ mode:"candidate", diagnostics:{ sampleEveryChains:Number(config.possessionChainsPerMatch) + 1 } },
  });
  const aggregate = emptyAggregate();
  const rawSamples = [];
  const progressInterval = Math.max(1, Number(config.progressIntervalMatches ?? 1));
  for (let index = start; index < start + count; index += 1) {
    const seed = `${config.seed}:candidate:${index}`;
    const rng = createS4BalanceRng(seed);
    const scenario = config.scenarioMatrix ? v2ScenarioForMatch(config, index) : null;
    const archetypes = scenario
      ? [scenario.home.archetype, scenario.away.archetype]
      : [pickS4BalanceArchetype(rng, config.ecosystemWeights), pickS4BalanceArchetype(rng, config.ecosystemWeights)];
    const seats = scenario
      ? [scenario.home, scenario.away].map((side, teamIndex) => buildS4BalanceSeat(
        seed,
        teamIndex === 0 ? "home" : "away",
        side.archetype,
        v2ScenarioSeatOptions(config.scenarioMatrix, side),
      ))
      : archetypes.map((archetype, teamIndex) => buildS4BalanceSeat(seed, teamIndex === 0 ? "home" : "away", archetype));
    const matchSeed = `${seed}:paired-v2.1d`;
    const stable = simulateV2Match(structuredClone(seats), {
      seed:matchSeed,
      possessionChains:Number(config.possessionChainsPerMatch),
      parameters:stableParameters,
      ...(scenario?.environment ?? {}),
    });
    const candidate = simulateV2Match(structuredClone(seats), {
      seed:matchSeed,
      possessionChains:Number(config.possessionChainsPerMatch),
      parameters:candidateParameters,
      ...(scenario?.environment ?? {}),
    });
    addMatchTotals(aggregate.stable, stable);
    addMatchTotals(aggregate.candidate, candidate);
    addStageTotals(aggregate.stages, stable, "stable");
    addStageTotals(aggregate.stages, candidate, "candidate");
    aggregate.matches += 1;
    aggregate.paired.scoreChanged += Number(stable.score[0] !== candidate.score[0] || stable.score[1] !== candidate.score[1]);
    const stableResult = Math.sign(stable.score[0] - stable.score[1]);
    const candidateResult = Math.sign(candidate.score[0] - candidate.score[1]);
    aggregate.paired.resultChanged += Number(stableResult !== candidateResult);
    aggregate.paired.absoluteGoalDelta += Math.abs((stable.score[0] + stable.score[1]) - (candidate.score[0] + candidate.score[1]));
    const stableXg = stable.teams.reduce((sum, team) => sum + Number(team.stats.xg ?? 0), 0);
    const candidateXg = candidate.teams.reduce((sum, team) => sum + Number(team.stats.xg ?? 0), 0);
    aggregate.paired.absoluteXgDelta += Math.abs(stableXg - candidateXg);
    for (let teamIndex = 0; teamIndex < 2; teamIndex += 1) {
      const stableValues = teamMetrics(stable, teamIndex);
      const candidateValues = teamMetrics(candidate, teamIndex);
      const seat = seats[teamIndex];
      const dimensions = {
        bySide:`side${teamIndex}`,
        byFormation:seat.simulationFormation ?? "unknown",
        byTactic:seat.tactic ?? "unknown",
        byStyle:seat.style ?? "unknown",
        byTacticalProfile:seat.simulationTacticalProfile ?? `${seat.tactic ?? "unknown"}:${seat.style ?? "unknown"}`,
        byScenarioCategory:scenario?.category ?? "random",
        byFormationTacticStyle:`${seat.simulationFormation ?? "unknown"}:${seat.tactic ?? "unknown"}:${seat.style ?? "unknown"}`,
      };
      for (const [dimension, key] of Object.entries(dimensions)) addBucket(aggregate.buckets[dimension], key, stableValues, candidateValues);
    }
    if (index < Number(config.rawMatchSampleLimit ?? 0)) {
      rawSamples.push({
        index,
        seed,
        archetypes,
        scenario:scenario ? { id:scenario.id, category:scenario.category, mirrored:scenario.mirrored } : null,
        teams:seats.map((seat) => ({ formation:seat.simulationFormation, tactic:seat.tactic, style:seat.style })),
        stable:matchSummary(stable),
        candidate:matchSummary(candidate),
      });
    }
    const completed = index - start + 1;
    if (completed % progressInterval === 0 || completed === count) parentPort.postMessage({ type:"progress", completed, total:count });
  }
  parentPort.postMessage({ type:"result", aggregate, rawSamples });
} catch (error) {
  parentPort.postMessage({ error:{ name:error.name, message:error.message, stack:error.stack } });
}
