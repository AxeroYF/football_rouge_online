import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expandV2ScenarioMatrix } from "./engine-comparison-v2-scenario-matrix.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const configPath = path.resolve(here, argument("config") ?? "engine-comparison-v2-config.json");
const workerPath = path.resolve(here, "engine-comparison-v2-worker.js");

function shardRanges(total, size) {
  const ranges = [];
  for (let start = 0; start < total; start += size) ranges.push({ start, count:Math.min(size, total - start) });
  return ranges;
}

function mergeNumbers(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) mergeNumbers(target[key] ??= {}, value);
    else target[key] = Number(target[key] ?? 0) + Number(value ?? 0);
  }
  return target;
}

function runWorker(task, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData:task });
    let settled = false;
    worker.on("message", (message) => {
      if (message.type === "progress") {
        onProgress(message.completed);
        return;
      }
      if (message.error) {
        settled = true;
        reject(Object.assign(new Error(message.error.message), message.error));
        return;
      }
      settled = true;
      const { type, ...result } = message;
      resolve(result);
    });
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0 && !settled) reject(new Error(`V1/V2 comparison worker exited with code ${code}`)); });
  });
}

async function runPool(tasks, concurrency, config = {}) {
  const results = [];
  const totalMatches = tasks.reduce((sum, task) => sum + task.count, 0);
  const taskProgress = new Map(tasks.map((task) => [task.taskId, 0]));
  const startedAt = Date.now();
  let previousLength = 0;
  let lastRenderedAt = 0;
  let cursor = 0;
  const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return "计算中";
    const rounded = Math.max(0, Math.round(seconds));
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor(rounded % 3600 / 60);
    const remainingSeconds = rounded % 60;
    return hours ? `${hours}时${minutes}分` : minutes ? `${minutes}分${remainingSeconds}秒` : `${remainingSeconds}秒`;
  };
  const renderProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastRenderedAt < Number(config.progress?.renderIntervalMs ?? 250)) return;
    lastRenderedAt = now;
    const completedMatches = [...taskProgress.values()].reduce((sum, value) => sum + value, 0);
    const progress = completedMatches / Math.max(1, totalMatches);
    const elapsedSeconds = Math.max(0.001, (now - startedAt) / 1000);
    const matchesPerSecond = completedMatches / elapsedSeconds;
    const etaSeconds = completedMatches ? (totalMatches - completedMatches) / Math.max(0.001, matchesPerSecond) : Infinity;
    const width = Math.max(10, Math.min(60, Number(config.progress?.barWidth ?? 30)));
    const filled = Math.min(width, Math.floor(progress * width));
    const bar = `${"#".repeat(filled)}${"-".repeat(width - filled)}`;
    const line = `[${bar}] ${(progress * 100).toFixed(2)}% | ${completedMatches}/${totalMatches}场 | 分片 ${results.length}/${tasks.length} | 已用 ${formatDuration(elapsedSeconds)} | 剩余约 ${formatDuration(etaSeconds)}`;
    process.stdout.write(`\r${line}${" ".repeat(Math.max(0, previousLength - line.length))}`);
    previousLength = line.length;
  };
  renderProgress(true);
  async function consume() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const result = await runWorker(task, (completed) => {
        taskProgress.set(task.taskId, Math.min(task.count, Number(completed ?? 0)));
        renderProgress();
      });
      taskProgress.set(task.taskId, task.count);
      results.push({ taskId:task.taskId, ...result });
      renderProgress(true);
    }
  }
  await Promise.all(Array.from({ length:Math.min(concurrency, tasks.length) }, consume));
  renderProgress(true);
  process.stdout.write("\n");
  return results;
}

function ratio(numerator, denominator, multiplier = 1, digits = 4) {
  return Number((Number(numerator ?? 0) / Math.max(1, Number(denominator ?? 0)) * multiplier).toFixed(digits));
}

function summarizeGroup(group, options = {}) {
  const summary = {
    teamSamples:group.teamSamples,
    v2:{
      pointsPerMatch:ratio(group.v2Points, group.teamSamples),
      winRatePercent:ratio(group.v2Wins, group.teamSamples, 100, 2),
      drawRatePercent:ratio(group.v2Draws, group.teamSamples, 100, 2),
      possessionSharePercent:ratio(group.v2PossessionControl, group.v2PossessionControl + group.v2OpponentPossessionControl, 100, 2),
      chainSharePercent:ratio(group.v2Possessions, group.v2Possessions + group.v2OpponentPossessions, 100, 2),
      expectedGoalsPerMatch:ratio(group.v2Xg, group.teamSamples),
      expectedGoalsAgainstPerMatch:ratio(group.v2XgAgainst, group.teamSamples),
      chainGoalsPerMatch:ratio(group.v2Goals, group.teamSamples),
      goalsAgainstPerMatch:ratio(group.v2GoalsAgainst, group.teamSamples),
      shotsPerMatch:ratio(group.v2Shots, group.teamSamples),
      shotsOnTargetPerMatch:ratio(group.v2ShotsOnTarget, group.teamSamples),
      shotsOnTargetRatePercent:ratio(group.v2ShotsOnTarget, group.v2Shots, 100, 2),
      goalConversionRatePercent:ratio(group.v2Goals, group.v2Shots, 100, 2),
      shotReachRatePercent:ratio(group.v2Shots, group.v2Possessions, 100, 2),
      turnoverRatePercent:ratio(group.v2Turnovers, group.v2Possessions, 100, 2),
      transitionPossessionSharePercent:ratio(group.v2TransitionPossessions, group.v2NormalPossessions + group.v2TransitionPossessions, 100, 2),
      transitionShotsPerMatch:ratio(group.v2TransitionShots, group.teamSamples),
      foulsPerMatch:ratio(group.v2Fouls, group.teamSamples),
      yellowCardsPerMatch:ratio(group.v2YellowCards, group.teamSamples),
      redCardsPerMatch:ratio(group.v2RedCards, group.teamSamples),
      injuriesPerMatch:ratio(group.v2Injuries, group.teamSamples),
      injuryAbsenceRoundsPerMatch:ratio(group.v2InjuryAbsenceRounds, group.teamSamples),
      foulInjuriesSufferedPerMatch:ratio(group.v2FoulInjuriesSuffered, group.teamSamples),
      foulInjuriesCausedPerMatch:ratio(group.v2FoulInjuriesCaused, group.teamSamples),
      substitutionsPerMatch:ratio(group.v2Substitutions, group.teamSamples),
      averageBacklineExposure:ratio(group.v2BacklineExposure, group.teamSamples),
    },
  };
  if (!options.v2Only) summary.v1 = {
    pointsPerMatch:ratio(group.v1Points, group.teamSamples),
    winRatePercent:ratio(group.v1Wins, group.teamSamples, 100, 2),
    drawRatePercent:ratio(group.v1Draws, group.teamSamples, 100, 2),
    goalsForPerMatch:ratio(group.v1GoalsFor, group.teamSamples),
    goalsAgainstPerMatch:ratio(group.v1GoalsAgainst, group.teamSamples),
    xgForPerMatch:ratio(group.v1XgFor, group.teamSamples),
  };
  return summary;
}

function valueAtPath(source, pathValue) {
  return String(pathValue).split(".").reduce((value, key) => value?.[key], source);
}

export function evaluateV2RealismBenchmarks(v2Results, benchmarkConfig = {}) {
  const metrics = Object.entries(benchmarkConfig.metrics ?? {}).map(([pathValue, target]) => {
    const value = Number(valueAtPath(v2Results, pathValue));
    const minimum = Number(target.minimum);
    const maximum = Number(target.maximum);
    const status = !Number.isFinite(value) ? "missing" : value < minimum ? "low" : value > maximum ? "high" : "pass";
    return { path:pathValue, label:target.label ?? pathValue, value:Number.isFinite(value) ? value : null, unit:target.unit ?? null, minimum, maximum, status, critical:Boolean(target.critical), weight:Number(target.weight ?? 1) };
  });
  const comparisons = (benchmarkConfig.comparisons ?? []).map((target) => {
    const leftValue = Number(valueAtPath(v2Results, target.leftPath));
    const rightValue = Number(valueAtPath(v2Results, target.rightPath));
    const difference = leftValue - rightValue;
    const minimum = Number(target.minimumDifference);
    const maximum = Number(target.maximumDifference);
    const status = !Number.isFinite(leftValue) || !Number.isFinite(rightValue) ? "missing" : difference < minimum ? "low" : difference > maximum ? "high" : "pass";
    return { id:target.id, label:target.label ?? target.id, leftPath:target.leftPath, rightPath:target.rightPath, leftValue:Number.isFinite(leftValue) ? leftValue : null, rightValue:Number.isFinite(rightValue) ? rightValue : null, difference:Number.isFinite(difference) ? Number(difference.toFixed(4)) : null, unit:target.unit ?? null, minimumDifference:minimum, maximumDifference:maximum, status, critical:Boolean(target.critical), weight:Number(target.weight ?? 1) };
  });
  const checks = [...metrics, ...comparisons];
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0) || 1;
  const passedWeight = checks.filter((check) => check.status === "pass").reduce((sum, check) => sum + check.weight, 0);
  const overallPassRatePercent = Number((passedWeight / totalWeight * 100).toFixed(2));
  const sampleRequirement = { minimumMatches:Number(benchmarkConfig.minimumMatches ?? 5000), actualMatches:Number(v2Results.matches ?? 0), met:Number(v2Results.matches ?? 0) >= Number(benchmarkConfig.minimumMatches ?? 5000) };
  const criticalFailures = checks.filter((check) => check.critical && check.status !== "pass").map((check) => check.path ?? check.id);
  const minimumPassRatePercent = Number(benchmarkConfig.minimumPassRatePercent ?? 80);
  return {
    version:benchmarkConfig.version ?? "v1",
    reference:benchmarkConfig.reference ?? null,
    verdict:sampleRequirement.met && criticalFailures.length === 0 && overallPassRatePercent >= minimumPassRatePercent ? "pass" : "review",
    minimumPassRatePercent,
    sampleRequirement,
    overallPassRatePercent,
    passed:checks.filter((check) => check.status === "pass").length,
    failed:checks.filter((check) => check.status !== "pass").length,
    criticalFailures,
    metrics,
    comparisons,
  };
}

function summarize(config, aggregate) {
  const matches = aggregate.matches;
  const possessions = aggregate.v2.possessions;
  const stageSummary = Object.fromEntries(Object.entries(aggregate.v2.stages).map(([stage, value]) => [stage, {
    attempts:value.attempts,
    successes:value.successes,
    successRatePercent:ratio(value.successes, value.attempts, 100, 2),
    averageProbability:ratio(value.probabilitySum, value.attempts),
    factors:Object.fromEntries(Object.entries(value.factors ?? {}).map(([factor, total]) => [factor, ratio(total, value.attempts)])),
  }]));
  const shotQuality = Object.fromEntries(Object.entries(aggregate.v2.shotQuality ?? {}).map(([bucket, value]) => [bucket, {
    shots:value.shots,
    goals:value.goals,
    xg:Number(Number(value.xg ?? 0).toFixed(3)),
    shareOfShotsPercent:ratio(value.shots, aggregate.v2.shots, 100, 2),
    conversionRatePercent:ratio(value.goals, value.shots, 100, 3),
    goalsPerExpectedGoal:ratio(value.goals, value.xg),
    shareOfGoalsPercent:ratio(value.goals, aggregate.v2.goals, 100, 2),
  }]));
  const shotTypes = Object.fromEntries(Object.entries(aggregate.v2.shotTypes ?? {}).map(([type, value]) => [type, {
    shots:value.shots,
    goals:value.goals,
    xg:Number(Number(value.xg ?? 0).toFixed(3)),
    shotsPerMatch:ratio(value.shots, matches),
    shareOfShotsPercent:ratio(value.shots, aggregate.v2.shots, 100, 2),
    conversionRatePercent:ratio(value.goals, value.shots, 100, 3),
    goalsPerExpectedGoal:ratio(value.goals, value.xg),
  }]));
  const shotBucketAbsoluteError = Object.values(aggregate.v2.shotQuality ?? {}).reduce((sum, value) => sum + Math.abs(Number(value.goals ?? 0) - Number(value.xg ?? 0)), 0);
  const goalTotal = Object.values(aggregate.v2.goalMinutes ?? {}).reduce((sum, value) => sum + Number(value), 0);
  const goalMinutes = Object.fromEntries(Object.entries(aggregate.v2.goalMinutes ?? {}).map(([bucket, count]) => [bucket, { count, sharePercent:ratio(count, goalTotal, 100, 2) }]));
  const goalBodyParts = Object.fromEntries(Object.entries(aggregate.v2.goalBodyParts ?? {}).map(([bodyPart, count]) => [bodyPart, { count, sharePercent:ratio(count, goalTotal, 100, 2) }]));
  const report = {
    schemaVersion:config.v2Only ? "yellowdogs-v2-realism-balance-v3" : "yellowdogs-v1-v2-engine-comparison-v2",
    engineVersion:config.engineVersion ?? "V2",
    outputVersion:config.outputVersion,
    seed:config.seed,
    comparisonContract:{
      sharedInputs:["same deterministic player lineups", "same board coordinates", "same opening mentality and style", "same ecosystem archetype weights"],
      v2ConsumedInputs:["enhancement-adjusted 26 attributes", "fitness snapshot", "primary and secondary position fit", "board coordinates", "opening mentality and style", "attribute and conditional trait rules", "nationality and club bonds", "S and X player attributes", "weather and referee", "live minute and score state", "turnover transition zone"],
      v2InputsPresentButNotYetConsumed:[],
      ...(config.v2Only ? { scope:"V2-only realism and balance validation; V1 is not executed" } : { v1:"complete current 90-minute match engine" }),
      v2:"stage-dynamic spatial model plus stateful six-stage possession chains",
      directlyComparable:["goals or expected goals per match", "team and tactical direction", "initial position interactions", "attacking and defending player role participation"],
      notYetComparable:[],
    },
    analysisMethod:{
      mode:config.v2Only ? "V2 seeded ecosystem impact study" : "paired V1/V2 comparison",
      dimensions:config.analysisDimensions ?? [],
      interpretation:"Dimension and head-to-head win rates are seeded ecosystem associations. Use sample counts and opposing-group splits before treating a difference as causal.",
      reproducibility:"Every match uses root seed + paired match index; the same config and engine revision reproduce the same inputs and outcomes.",
    },
    config:{ engineVersion:config.engineVersion ?? "V2", matches, v2PossessionChainsPerMatch:config.v2PossessionChainsPerMatch, rawMatchSampleLimit:config.rawMatchSampleLimit, v2ShotXgBucketUpperBounds:config.v2ShotXgBucketUpperBounds, ecosystemWeights:config.ecosystemWeights, analysisDimensions:config.analysisDimensions, realismBenchmarks:config.realismBenchmarks, scenarioMatrix:config.scenarioMatrix ? { scenarioCount:config.scenarioCount, repetitionsPerScenario:config.scenarioMatrix.repetitionsPerScenario, mirrorHomeAway:config.scenarioMatrix.mirrorHomeAway, archetypePairing:config.scenarioMatrix.archetypePairing ?? "rotatedSame", environmentSampling:config.scenarioMatrix.environmentSampling ?? (config.scenarioMatrix.environmentRotation ? "rotation" : "weighted"), archetypeRotation:config.scenarioMatrix.archetypeRotation, environmentRotation:config.scenarioMatrix.environmentRotation, suiteIds:(config.scenarioMatrix.suites ?? []).filter((suite) => suite.enabled !== false).map((suite) => suite.id), disabledSuiteIds:(config.scenarioMatrix.suites ?? []).filter((suite) => suite.enabled === false).map((suite) => suite.id) } : null, outputLimits:config.outputLimits },
    results:{
      matches,
      ...(config.v2Only ? {} : { v1:{
        goalsPerMatch:ratio(aggregate.v1.goals, matches),
        shotsPerMatch:ratio(aggregate.v1.shots, matches),
        shotsOnTargetPerMatch:ratio(aggregate.v1.shotsOnTarget, matches),
        xgPerMatch:ratio(aggregate.v1.xg, matches),
        goalsPerXg:ratio(aggregate.v1.goals, aggregate.v1.xg),
        drawRatePercent:ratio(aggregate.v1.draws, matches, 100, 2),
      } }),
      v2:{
        possessions,
        possessionsPerMatch:ratio(possessions, matches),
        expectedGoalsPerMatch:ratio(aggregate.v2.xg, matches),
        chainGoalsPerMatch:ratio(aggregate.v2.goals, matches),
        goalsPerExpectedGoal:ratio(aggregate.v2.goals, aggregate.v2.xg),
        shotsPerMatch:ratio(aggregate.v2.shots, matches),
        shotsOnTargetPerMatch:ratio(aggregate.v2.shotsOnTarget, matches),
        shotsOnTargetRatePercent:ratio(aggregate.v2.shotsOnTarget, aggregate.v2.shots, 100, 2),
        shotReachRatePercent:ratio(aggregate.v2.shots, possessions, 100, 2),
        cornersPerMatch:ratio(aggregate.v2.corners, matches),
        savesPerMatch:ratio(aggregate.v2.saves, matches),
        blockedShotsPerMatch:ratio(aggregate.v2.blockedShots, matches),
        offsidesPerMatch:ratio(aggregate.v2.offsides, matches),
        matchDistribution:{
          ...aggregate.v2.matchDistribution,
          homeWinRatePercent:ratio(aggregate.v2.matchDistribution.homeWins, matches, 100, 2),
          drawRatePercent:ratio(aggregate.v2.matchDistribution.draws, matches, 100, 2),
          awayWinRatePercent:ratio(aggregate.v2.matchDistribution.awayWins, matches, 100, 2),
          sideWinRateGapPercent:Number(Math.abs(
            ratio(aggregate.v2.matchDistribution.homeWins, matches, 100, 2)
              - ratio(aggregate.v2.matchDistribution.awayWins, matches, 100, 2),
          ).toFixed(2)),
          zeroZeroRatePercent:ratio(aggregate.v2.matchDistribution.zeroZero, matches, 100, 2),
          sixPlusGoalsRatePercent:ratio(aggregate.v2.matchDistribution.sixPlusGoals, matches, 100, 2),
          eightPlusGoalsRatePercent:ratio(aggregate.v2.matchDistribution.eightPlusGoals, matches, 100, 2),
          threePlusGoalMarginRatePercent:ratio(aggregate.v2.matchDistribution.threePlusGoalMargin, matches, 100, 2),
          fourPlusGoalMarginRatePercent:ratio(aggregate.v2.matchDistribution.fourPlusGoalMargin, matches, 100, 2),
          bothTeamsScoredRatePercent:ratio(aggregate.v2.matchDistribution.bothTeamsScored, matches, 100, 2),
          cleanSheetMatchRatePercent:ratio(aggregate.v2.matchDistribution.cleanSheetMatches, matches, 100, 2),
          oneGoalMarginRatePercent:ratio(aggregate.v2.matchDistribution.oneGoalMargin, matches, 100, 2),
          totalGoals:aggregate.v2.matchDistribution.totalGoals ?? {},
          scorelines:aggregate.v2.matchDistribution.scorelines ?? {},
        },
        goalMinutes,
        goalBodyParts,
        xgCalibration:{
          meanAbsoluteMatchError:ratio(aggregate.v2.xgCalibration.absoluteMatchErrorSum, matches),
          rootMeanSquaredMatchError:Number(Math.sqrt(Number(aggregate.v2.xgCalibration.squaredMatchErrorSum ?? 0) / Math.max(1, matches)).toFixed(4)),
          shotBucketAbsoluteErrorRatioPercent:ratio(shotBucketAbsoluteError, aggregate.v2.xg, 100, 2),
          overperformanceRatePercent:ratio(aggregate.v2.xgCalibration.overperformanceMatches, matches, 100, 2),
          underperformanceRatePercent:ratio(aggregate.v2.xgCalibration.underperformanceMatches, matches, 100, 2),
        },
        possessionDistribution:{
          averageHomePossessionPercent:ratio(aggregate.v2.possessionDistribution.homePossessionPercent, matches),
          averageAbsoluteDifferencePercent:ratio(aggregate.v2.possessionDistribution.absoluteDifferencePercent, matches),
          matchesWith55PlusPercent:ratio(aggregate.v2.possessionDistribution.matchesWith55Plus, matches, 100, 2),
          matchesWith60PlusPercent:ratio(aggregate.v2.possessionDistribution.matchesWith60Plus, matches, 100, 2),
          matchesWith70PlusPercent:ratio(aggregate.v2.possessionDistribution.matchesWith70Plus, matches, 100, 2),
        },
        defensiveActions:Object.fromEntries(Object.entries(aggregate.v2.defensiveActions ?? {}).map(([key, value]) => [key, { total:value, perMatch:ratio(value, matches) }])),
        shotQuality,
        shotTypes,
        terminalOutcomes:aggregate.v2.terminalOutcomes,
        turnoverDefenderRoles:aggregate.v2.turnoverDefenderRoles,
        turnoverBands:aggregate.v2.turnoverBands,
        routeTypes:aggregate.v2.routeTypes,
        discipline:{
          ...aggregate.v2.discipline,
          foulsPerMatch:ratio(aggregate.v2.discipline.fouls, matches),
          penaltiesPerMatch:ratio(aggregate.v2.discipline.penalties, matches),
          yellowCardsPerMatch:ratio(aggregate.v2.discipline.yellowCards, matches),
          redCardsPerMatch:ratio(aggregate.v2.discipline.redCards, matches),
          matchesWithYellowCardRatePercent:ratio(aggregate.v2.discipline.matchesWithYellowCard, matches, 100, 2),
          matchesWithRedCardRatePercent:ratio(aggregate.v2.discipline.matchesWithRedCard, matches, 100, 2),
          simulationYellowCardSharePercent:ratio(aggregate.v2.discipline.simulationYellowCards, aggregate.v2.discipline.yellowCards, 100, 2),
          directRedCardSharePercent:ratio(aggregate.v2.discipline.directRedCards, aggregate.v2.discipline.redCards, 100, 2),
          secondYellowRedCardSharePercent:ratio(aggregate.v2.discipline.secondYellowRedCards, aggregate.v2.discipline.redCards, 100, 2),
        },
        injuries:{
          ...aggregate.v2.injuries,
          injuriesPerMatch:ratio(aggregate.v2.injuries.total, matches),
          matchesWithInjuryRatePercent:ratio(aggregate.v2.injuries.matchesWithInjury, matches, 100, 2),
          absenceRoundsPerInjury:ratio(aggregate.v2.injuries.totalAbsenceRounds, aggregate.v2.injuries.total),
          foulInjurySharePercent:ratio(aggregate.v2.injuries.causedByFoul, aggregate.v2.injuries.total, 100, 2),
          transferredByTraitRatePercent:ratio(aggregate.v2.injuries.transferredByTrait, aggregate.v2.injuries.total, 100, 2),
          unreplacedInjuryRatePercent:ratio(aggregate.v2.injuries.unreplacedInjuries, aggregate.v2.injuries.total, 100, 2),
        },
        matchExecution:{
          ...aggregate.v2.matchExecution,
          completedMatches:aggregate.v2.matchExecution.completed,
          abandonedMatches:aggregate.v2.matchExecution.abandoned,
          tacticalSwitchesPerMatch:ratio(aggregate.v2.matchExecution.tacticalSwitches, matches),
          injuriesPerMatch:ratio(aggregate.v2.matchExecution.injuries, matches),
          suspensionsPerMatch:ratio(aggregate.v2.matchExecution.suspensions, matches),
          commentaryEntriesPerMatch:ratio(aggregate.v2.matchExecution.commentaryEntries, matches),
        },
        independentEvents:aggregate.v2.independentEvents,
        sources:{
          ...aggregate.v2.sources,
          activeBondsPerMatch:ratio(aggregate.v2.sources.activeBonds, matches),
          legendsPerMatch:ratio(aggregate.v2.sources.legends, matches),
          xPlayersPerMatch:ratio(aggregate.v2.sources.xPlayers, matches),
          traitAssignmentsPerMatch:ratio(aggregate.v2.sources.traitAssignments, matches),
        },
        startZones:aggregate.v2.startZones,
        endZones:aggregate.v2.endZones,
        stages:stageSummary,
      },
      ...(config.v2Only ? {} : { pairedDifferences:{
        v2ExpectedGoalsMinusV1GoalsPerMatch:ratio(aggregate.v2.xg - aggregate.v1.goals, matches),
        v2ExpectedGoalsMinusV1XgPerMatch:ratio(aggregate.v2.xg - aggregate.v1.xg, matches),
        v2ChainGoalsMinusV1GoalsPerMatch:ratio(aggregate.v2.goals - aggregate.v1.goals, matches),
      } }),
      dimensions:Object.fromEntries(Object.entries(aggregate.dimensions).map(([dimension, groups]) => [dimension,
        Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, summarizeGroup(group, { v2Only:config.v2Only })]))
      ])),
      headToHead:Object.fromEntries(Object.entries(aggregate.headToHead).map(([dimension, groups]) => [dimension,
        Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, summarizeGroup(group, { v2Only:config.v2Only })]))
      ])),
    },
  };
  report.realismBenchmark = evaluateV2RealismBenchmarks({ matches, ...report.results.v2, dimensions:report.results.dimensions, headToHead:report.results.headToHead }, config.realismBenchmarks);
  return report;
}

async function main() {
  const sourceConfig = JSON.parse(await readFile(configPath, "utf8"));
  const outputArgument = argument("output");
  const scenarios = sourceConfig.scenarioMatrix ? expandV2ScenarioMatrix(sourceConfig.scenarioMatrix) : [];
  const configuredMatches = scenarios.length
    ? scenarios.length * Math.max(1, Number(sourceConfig.scenarioMatrix.repetitionsPerScenario ?? 1))
    : sourceConfig.matches;
  const config = {
    ...sourceConfig,
    seed:argument("seed") ?? sourceConfig.seed,
    outputVersion:argument("version") ?? (outputArgument ? path.basename(outputArgument, path.extname(outputArgument)) : sourceConfig.outputVersion),
    matches:Number(argument("matches") ?? configuredMatches),
    v2PossessionChainsPerMatch:Number(argument("chains") ?? sourceConfig.v2PossessionChainsPerMatch),
    rawMatchSampleLimit:Number(argument("samples") ?? sourceConfig.rawMatchSampleLimit),
    v2Only:String(argument("v2-only") ?? sourceConfig.v2Only ?? "false").toLowerCase() === "true",
    shardMatches:Number(argument("shard") ?? sourceConfig.shardMatches),
    scenarioCount:scenarios.length,
  };
  const outputPath = path.resolve(outputArgument ?? path.resolve(here, `../../outputs/${config.outputVersion}.json`));
  if (path.extname(outputPath).toLowerCase() !== ".json") throw new Error(`Engine simulation output must use the .json extension: ${outputPath}`);
  const requestedWorkers = Number(argument("workers") ?? 0);
  const workerCount = Math.max(1, Math.min(requestedWorkers || Math.max(1, os.cpus().length - 1), Number(config.maximumWorkers ?? 32)));
  const ranges = shardRanges(Number(config.matches), Number(config.shardMatches ?? 250));
  const tasks = ranges.map((range, index) => ({ taskId:index, ...range, config }));
  console.log(`${config.v2Only ? "V2 balance smoke" : "V1/V2 full comparison"}: ${config.matches} matches, ${config.v2PossessionChainsPerMatch} V2 chains per match, ${workerCount} workers`);
  const results = (await runPool(tasks, workerCount, config)).sort((left, right) => left.taskId - right.taskId);
  const aggregate = { matches:0, v1:{}, v2:{ stages:{}, discipline:{}, sources:{} }, dimensions:{}, headToHead:{} };
  const rawMatchSamples = [];
  for (const result of results) {
    mergeNumbers(aggregate, result.aggregate);
    rawMatchSamples.push(...result.rawMatchSamples);
  }
  rawMatchSamples.sort((left, right) => left.index - right.index);
  const report = summarize(config, aggregate);
  const rawPath = outputPath.replace(/\.json$/i, "-raw-samples.json");
  await mkdir(path.dirname(outputPath), { recursive:true });
  const maximumCoreBytes = Math.max(100_000, Number(config.outputLimits?.coreBytes ?? 2_000_000));
  const maximumRawBytes = Math.max(100_000, Number(config.outputLimits?.rawSamplesBytes ?? 8_000_000));
  const maximumDimensionShardBytes = Math.max(100_000, Number(config.outputLimits?.dimensionShardBytes ?? maximumCoreBytes));
  let retainedRawSamples = rawMatchSamples;
  let rawPayload = `${JSON.stringify({ schemaVersion:report.schemaVersion, engineVersion:report.engineVersion, outputVersion:report.outputVersion, seed:report.seed, rawMatchSamples:retainedRawSamples }, null, 2)}\n`;
  while (Buffer.byteLength(rawPayload) > maximumRawBytes && retainedRawSamples.length > 1) {
    retainedRawSamples = retainedRawSamples.slice(0, Math.max(1, Math.floor(retainedRawSamples.length / 2)));
    rawPayload = `${JSON.stringify({ schemaVersion:report.schemaVersion, engineVersion:report.engineVersion, outputVersion:report.outputVersion, seed:report.seed, rawMatchSamples:retainedRawSamples }, null, 2)}\n`;
  }
  const dimensionNames = [...new Set([
    ...Object.keys(report.results.dimensions ?? {}),
    ...Object.keys(report.results.headToHead ?? {}),
  ])].sort();
  let dimensionFiles = [];
  let reportForCore = report;
  const baseProtection = {
    rawSamplesSeparated:true,
    requestedRawMatchSampleCount:rawMatchSamples.length,
    retainedRawMatchSampleCount:retainedRawSamples.length,
    rawMatchSamplesFile:path.basename(rawPath),
    maximumCoreBytes,
    maximumRawBytes,
    maximumDimensionShardBytes,
  };
  const fullCorePayload = `${JSON.stringify({ ...report, outputProtection:{ ...baseProtection, dimensionsSeparated:false, dimensionFiles:[] } }, null, 2)}\n`;
  if (config.outputLimits?.separateDimensions === true || Buffer.byteLength(fullCorePayload) > maximumCoreBytes) {
    const dimensionChunks = [];
    let current = [];
    const chunkPayload = (entries) => `${JSON.stringify({
      schemaVersion:report.schemaVersion,
      engineVersion:report.engineVersion,
      outputVersion:report.outputVersion,
      seed:report.seed,
      dimensions:Object.fromEntries(entries.map((name) => [name, report.results.dimensions?.[name] ?? {}])),
      headToHead:Object.fromEntries(entries.map((name) => [name, report.results.headToHead?.[name] ?? {}])),
    }, null, 2)}\n`;
    for (const name of dimensionNames) {
      const candidate = [...current, name];
      if (current.length && Buffer.byteLength(chunkPayload(candidate)) > maximumDimensionShardBytes) {
        dimensionChunks.push(current);
        current = [name];
      } else current = candidate;
    }
    if (current.length) dimensionChunks.push(current);
    dimensionFiles = [];
    for (let index = 0; index < dimensionChunks.length; index += 1) {
      const dimensionPath = outputPath.replace(/\.json$/i, `-dimensions-${String(index + 1).padStart(3, "0")}.json`);
      const payload = chunkPayload(dimensionChunks[index]);
      await writeFile(dimensionPath, payload, "utf8");
      dimensionFiles.push({
        file:path.basename(dimensionPath),
        bytes:Buffer.byteLength(payload),
        dimensions:dimensionChunks[index],
      });
    }
    reportForCore = {
      ...report,
      results:{ ...report.results, dimensions:{}, headToHead:{} },
    };
  }
  const protectedReport = {
    ...reportForCore,
    outputProtection:{
      ...baseProtection,
      dimensionsSeparated:dimensionFiles.length > 0,
      dimensionFiles,
    },
  };
  let corePayload = `${JSON.stringify(protectedReport, null, 2)}\n`;
  if (Buffer.byteLength(corePayload) > maximumCoreBytes) corePayload = `${JSON.stringify({ ...protectedReport, outputProtection:{ ...protectedReport.outputProtection, compactCore:true } })}\n`;
  const coreBytes = Buffer.byteLength(corePayload);
  await writeFile(outputPath, corePayload, "utf8");
  await writeFile(rawPath, rawPayload, "utf8");
  const outputLabel = config.v2Only ? "V2 realism/balance" : "V1/V2 comparison";
  console.log(`${outputLabel} core JSON generated: ${outputPath}`);
  if (dimensionFiles.length) console.log(`${outputLabel} dimension JSON shards generated: ${dimensionFiles.map((entry) => entry.file).join(", ")}`);
  console.log(`${outputLabel} diagnostic samples generated: ${rawPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
