import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
      shotReachRatePercent:ratio(group.v2Shots, group.v2Possessions, 100, 2),
      turnoverRatePercent:ratio(group.v2Turnovers, group.v2Possessions, 100, 2),
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
  return {
    schemaVersion:"yellowdogs-v1-v2-engine-comparison-v2",
    outputVersion:config.outputVersion,
    seed:config.seed,
    comparisonContract:{
      sharedInputs:["same deterministic player lineups", "same board coordinates", "same opening mentality and style", "same ecosystem archetype weights"],
      v2ConsumedInputs:["enhancement-adjusted 26 attributes", "fitness snapshot", "primary and secondary position fit", "board coordinates", "opening mentality and style", "attribute and conditional trait rules", "nationality and club bonds", "S and X player attributes", "weather and referee", "live minute and score state", "turnover transition zone"],
      v2InputsPresentButNotYetConsumed:["substitution plans"],
      v1:"complete current 90-minute match engine",
      v2:"stage-dynamic spatial model plus stateful six-stage possession chains",
      directlyComparable:["goals or expected goals per match", "team and tactical direction", "initial position interactions", "attacking and defending player role participation"],
      notYetComparable:["substitutions"],
    },
    analysisMethod:{
      mode:config.v2Only ? "V2 seeded ecosystem impact study" : "paired V1/V2 comparison",
      dimensions:config.analysisDimensions ?? [],
      interpretation:"Dimension and head-to-head win rates are seeded ecosystem associations. Use sample counts and opposing-group splits before treating a difference as causal.",
      reproducibility:"Every match uses root seed + paired match index; the same config and engine revision reproduce the same inputs and outcomes.",
    },
    config:{ matches, v2PossessionChainsPerMatch:config.v2PossessionChainsPerMatch, rawMatchSampleLimit:config.rawMatchSampleLimit, v2ShotXgBucketUpperBounds:config.v2ShotXgBucketUpperBounds, ecosystemWeights:config.ecosystemWeights, analysisDimensions:config.analysisDimensions, outputLimits:config.outputLimits },
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
        shotReachRatePercent:ratio(aggregate.v2.shots, possessions, 100, 2),
        matchDistribution:{
          ...aggregate.v2.matchDistribution,
          homeWinRatePercent:ratio(aggregate.v2.matchDistribution.homeWins, matches, 100, 2),
          drawRatePercent:ratio(aggregate.v2.matchDistribution.draws, matches, 100, 2),
          awayWinRatePercent:ratio(aggregate.v2.matchDistribution.awayWins, matches, 100, 2),
          zeroZeroRatePercent:ratio(aggregate.v2.matchDistribution.zeroZero, matches, 100, 2),
          sixPlusGoalsRatePercent:ratio(aggregate.v2.matchDistribution.sixPlusGoals, matches, 100, 2),
          eightPlusGoalsRatePercent:ratio(aggregate.v2.matchDistribution.eightPlusGoals, matches, 100, 2),
          threePlusGoalMarginRatePercent:ratio(aggregate.v2.matchDistribution.threePlusGoalMargin, matches, 100, 2),
          fourPlusGoalMarginRatePercent:ratio(aggregate.v2.matchDistribution.fourPlusGoalMargin, matches, 100, 2),
        },
        goalMinutes:aggregate.v2.goalMinutes,
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
}

async function main() {
  const sourceConfig = JSON.parse(await readFile(configPath, "utf8"));
  const outputArgument = argument("output");
  const config = {
    ...sourceConfig,
    outputVersion:argument("version") ?? (outputArgument ? path.basename(outputArgument, path.extname(outputArgument)) : sourceConfig.outputVersion),
    matches:Number(argument("matches") ?? sourceConfig.matches),
    v2PossessionChainsPerMatch:Number(argument("chains") ?? sourceConfig.v2PossessionChainsPerMatch),
    rawMatchSampleLimit:Number(argument("samples") ?? sourceConfig.rawMatchSampleLimit),
    v2Only:String(argument("v2-only") ?? sourceConfig.v2Only ?? "false").toLowerCase() === "true",
    shardMatches:Number(argument("shard") ?? sourceConfig.shardMatches),
  };
  const outputPath = path.resolve(outputArgument ?? path.resolve(here, `../../outputs/${config.outputVersion}.json`));
  if (path.extname(outputPath).toLowerCase() !== ".json") throw new Error(`V1/V2 comparison output must use the .json extension: ${outputPath}`);
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
  let retainedRawSamples = rawMatchSamples;
  let rawPayload = `${JSON.stringify({ schemaVersion:report.schemaVersion, outputVersion:report.outputVersion, seed:report.seed, rawMatchSamples:retainedRawSamples }, null, 2)}\n`;
  while (Buffer.byteLength(rawPayload) > maximumRawBytes && retainedRawSamples.length > 1) {
    retainedRawSamples = retainedRawSamples.slice(0, Math.max(1, Math.floor(retainedRawSamples.length / 2)));
    rawPayload = `${JSON.stringify({ schemaVersion:report.schemaVersion, outputVersion:report.outputVersion, seed:report.seed, rawMatchSamples:retainedRawSamples }, null, 2)}\n`;
  }
  const corePayload = `${JSON.stringify({ ...report, outputProtection:{ rawSamplesSeparated:true, requestedRawMatchSampleCount:rawMatchSamples.length, retainedRawMatchSampleCount:retainedRawSamples.length, rawMatchSamplesFile:path.basename(rawPath), maximumCoreBytes, maximumRawBytes } }, null, 2)}\n`;
  const coreBytes = Buffer.byteLength(corePayload);
  if (coreBytes > maximumCoreBytes) throw new Error(`Core result JSON ${coreBytes} bytes exceeds configured limit ${maximumCoreBytes}`);
  await writeFile(outputPath, corePayload, "utf8");
  await writeFile(rawPath, rawPayload, "utf8");
  console.log(`V1/V2 comparison core JSON generated: ${outputPath}`);
  console.log(`V1/V2 comparison diagnostic samples generated: ${rawPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
