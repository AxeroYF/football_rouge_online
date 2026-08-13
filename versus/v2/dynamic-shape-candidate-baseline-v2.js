import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, "dynamic-shape-candidate-baseline-v2-worker.js");
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

function shardRanges(total, size) {
  const ranges = [];
  for (let start = 0; start < total; start += size) ranges.push({ start, count:Math.min(size, total - start) });
  return ranges;
}

function emptyMatchTotals() {
  return { goals:0, xg:0, shots:0, shotsOnTarget:0, zeroZero:0, sixPlusGoals:0, homeWins:0, draws:0, awayWins:0 };
}

function emptyAggregate() {
  return {
    matches:0,
    stable:emptyMatchTotals(),
    candidate:emptyMatchTotals(),
    paired:{ scoreChanged:0, resultChanged:0, absoluteGoalDelta:0, absoluteXgDelta:0 },
    stages:{},
    buckets:{ bySide:{}, byFormation:{}, byTactic:{}, byStyle:{}, byTacticalProfile:{}, byScenarioCategory:{}, byFormationTacticStyle:{} },
  };
}

function mergeNumbers(target, source) {
  for (const [key, value] of Object.entries(source ?? {})) target[key] = Number(target[key] ?? 0) + Number(value ?? 0);
}

function mergeAggregate(target, source) {
  target.matches += Number(source.matches ?? 0);
  mergeNumbers(target.stable, source.stable);
  mergeNumbers(target.candidate, source.candidate);
  mergeNumbers(target.paired, source.paired);
  for (const [stage, variants] of Object.entries(source.stages ?? {})) {
    const targetStage = target.stages[stage] ??= { stable:{ attempts:0, successes:0, probability:0 }, candidate:{ attempts:0, successes:0, probability:0 } };
    mergeNumbers(targetStage.stable, variants.stable);
    mergeNumbers(targetStage.candidate, variants.candidate);
  }
  for (const [dimension, buckets] of Object.entries(source.buckets ?? {})) {
    const targetDimension = target.buckets[dimension] ??= {};
    for (const [key, bucket] of Object.entries(buckets ?? {})) {
      const targetBucket = targetDimension[key] ??= { samples:0, stable:{}, candidate:{} };
      targetBucket.samples += Number(bucket.samples ?? 0);
      mergeNumbers(targetBucket.stable, bucket.stable);
      mergeNumbers(targetBucket.candidate, bucket.candidate);
    }
  }
}

function percentDelta(stable, candidate) {
  return Number(stable) === 0 ? (Number(candidate) === 0 ? 0 : null) : round((Number(candidate) - Number(stable)) / Math.abs(Number(stable)) * 100, 3);
}

function summarizeMatchTotals(totals, matches) {
  return {
    goalsPerMatch:round(totals.goals / matches),
    xgPerMatch:round(totals.xg / matches),
    shotsPerMatch:round(totals.shots / matches),
    shotsOnTargetPerMatch:round(totals.shotsOnTarget / matches),
    goalsPerXg:round(totals.goals / Math.max(0.0001, totals.xg)),
    zeroZeroRatePercent:round(totals.zeroZero / matches * 100, 3),
    sixPlusGoalsRatePercent:round(totals.sixPlusGoals / matches * 100, 3),
    homeWinRatePercent:round(totals.homeWins / matches * 100, 3),
    drawRatePercent:round(totals.draws / matches * 100, 3),
    awayWinRatePercent:round(totals.awayWins / matches * 100, 3),
  };
}

function summarizeBucket(bucket) {
  const samples = Math.max(1, Number(bucket.samples));
  const stable = Object.fromEntries(Object.entries(bucket.stable).map(([key, value]) => [key, round(Number(value) / samples)]));
  const candidate = Object.fromEntries(Object.entries(bucket.candidate).map(([key, value]) => [key, round(Number(value) / samples)]));
  const delta = Object.fromEntries(Object.keys(stable).map((key) => [key, round(Number(candidate[key]) - Number(stable[key]))]));
  return { samples:Number(bucket.samples), stable, candidate, delta };
}

function summarizeStages(stages, matches) {
  return Object.fromEntries(Object.entries(stages).map(([stage, variants]) => {
    const summarize = (value) => ({
      attemptsPerMatch:round(value.attempts / matches),
      successRatePercent:round(value.successes / Math.max(1, value.attempts) * 100, 3),
      averageProbability:round(value.probability / Math.max(1, value.attempts)),
    });
    const stable = summarize(variants.stable);
    const candidate = summarize(variants.candidate);
    return [stage, {
      stable,
      candidate,
      delta:{
        attemptsPerMatchPercent:percentDelta(stable.attemptsPerMatch, candidate.attemptsPerMatch),
        successRatePoints:round(candidate.successRatePercent - stable.successRatePercent, 3),
        averageProbability:round(candidate.averageProbability - stable.averageProbability),
      },
    }];
  }));
}

function summarizeAggregate(aggregate) {
  const matches = Math.max(1, aggregate.matches);
  const stable = summarizeMatchTotals(aggregate.stable, matches);
  const candidate = summarizeMatchTotals(aggregate.candidate, matches);
  return {
    overall:{
      stable,
      candidate,
      delta:{
        totalGoalsPercent:percentDelta(stable.goalsPerMatch, candidate.goalsPerMatch),
        totalXgPercent:percentDelta(stable.xgPerMatch, candidate.xgPerMatch),
        totalShotsPercent:percentDelta(stable.shotsPerMatch, candidate.shotsPerMatch),
        shotsOnTargetPercent:percentDelta(stable.shotsOnTargetPerMatch, candidate.shotsOnTargetPerMatch),
        goalsPerXg:round(candidate.goalsPerXg - stable.goalsPerXg),
        zeroZeroRatePoints:round(candidate.zeroZeroRatePercent - stable.zeroZeroRatePercent, 3),
        sixPlusGoalsRatePoints:round(candidate.sixPlusGoalsRatePercent - stable.sixPlusGoalsRatePercent, 3),
      },
    },
    paired:{
      scoreChangedRatePercent:round(aggregate.paired.scoreChanged / matches * 100, 3),
      resultChangedRatePercent:round(aggregate.paired.resultChanged / matches * 100, 3),
      meanAbsoluteGoalDelta:round(aggregate.paired.absoluteGoalDelta / matches),
      meanAbsoluteXgDelta:round(aggregate.paired.absoluteXgDelta / matches),
    },
    stages:summarizeStages(aggregate.stages, matches),
    buckets:Object.fromEntries(Object.entries(aggregate.buckets).map(([dimension, buckets]) => [
      dimension,
      Object.fromEntries(Object.entries(buckets).sort(([left], [right]) => left.localeCompare(right)).map(([key, bucket]) => [key, summarizeBucket(bucket)])),
    ])),
  };
}

function checkMaximum(id, label, value, maximum) {
  const number = Number(value);
  return { id, label, value:Number.isFinite(number) ? round(number) : null, maximum:Number(maximum), status:Number.isFinite(number) && number <= Number(maximum) ? "pass" : "high" };
}

function worstAbsoluteBucketDelta(summary, dimension, metric) {
  return Object.entries(summary.buckets[dimension] ?? {})
    .map(([key, bucket]) => ({ key, samples:bucket.samples, value:Math.abs(Number(bucket.delta?.[metric] ?? 0)) }))
    .sort((left, right) => right.value - left.value || right.samples - left.samples)[0] ?? { key:null, samples:0, value:0 };
}

function candidateSpread(summary, dimension, metric) {
  const entries = Object.entries(summary.buckets[dimension] ?? {}).map(([key, bucket]) => ({ key, value:Number(bucket.candidate?.[metric] ?? 0) }));
  if (!entries.length) return { value:0, minimum:null, maximum:null };
  const minimum = [...entries].sort((left, right) => left.value - right.value)[0];
  const maximum = [...entries].sort((left, right) => right.value - left.value)[0];
  return { value:maximum.value - minimum.value, minimum, maximum };
}

export function evaluateCandidateGuardrails(aggregate, summary, config) {
  const limits = config.guardrails;
  const formationDelta = worstAbsoluteBucketDelta(summary, "byFormation", "points");
  const tacticDelta = worstAbsoluteBucketDelta(summary, "byTactic", "points");
  const styleDelta = worstAbsoluteBucketDelta(summary, "byStyle", "points");
  const formationSpread = candidateSpread(summary, "byFormation", "points");
  const tacticSpread = candidateSpread(summary, "byTactic", "points");
  const styleSpread = candidateSpread(summary, "byStyle", "points");
  const stageProbability = Object.entries(summary.stages).map(([key, value]) => ({ key, value:Math.abs(Number(value.delta.averageProbability)) })).sort((left, right) => right.value - left.value)[0] ?? { key:null, value:0 };
  const stageAttempts = Object.entries(summary.stages).map(([key, value]) => ({ key, value:Math.abs(Number(value.delta.attemptsPerMatchPercent)) })).sort((left, right) => right.value - left.value)[0] ?? { key:null, value:0 };
  const side0 = Number(summary.buckets.bySide.side0?.candidate.points ?? 0);
  const side1 = Number(summary.buckets.bySide.side1?.candidate.points ?? 0);
  const checks = [
    checkMaximum("totalGoals", "Absolute total-goals delta", Math.abs(summary.overall.delta.totalGoalsPercent), limits.maximumTotalGoalsDeltaPercent),
    checkMaximum("totalXg", "Absolute total-xG delta", Math.abs(summary.overall.delta.totalXgPercent), limits.maximumTotalXgDeltaPercent),
    checkMaximum("totalShots", "Absolute total-shots delta", Math.abs(summary.overall.delta.totalShotsPercent), limits.maximumTotalShotsDeltaPercent),
    checkMaximum("shotsOnTarget", "Absolute shots-on-target delta", Math.abs(summary.overall.delta.shotsOnTargetPercent), limits.maximumShotsOnTargetDeltaPercent),
    checkMaximum("goalsPerXg", "Absolute goals-per-xG delta", Math.abs(summary.overall.delta.goalsPerXg), limits.maximumGoalsPerXgDelta),
    checkMaximum("zeroZero", "Absolute 0-0 rate delta", Math.abs(summary.overall.delta.zeroZeroRatePoints), limits.maximumZeroZeroRateDeltaPoints),
    checkMaximum("sixPlusGoals", "Absolute six-plus-goal rate delta", Math.abs(summary.overall.delta.sixPlusGoalsRatePoints), limits.maximumSixPlusGoalsRateDeltaPoints),
    { ...checkMaximum("stageProbability", "Largest stage average-probability delta", stageProbability.value, limits.maximumStageAverageProbabilityDelta), bucket:stageProbability.key },
    { ...checkMaximum("stageAttempts", "Largest stage attempt-rate delta", stageAttempts.value, limits.maximumStageAttemptRateDeltaPercent), bucket:stageAttempts.key },
    checkMaximum("sideSymmetry", "Candidate first/second-side points gap", Math.abs(side0 - side1), limits.maximumSidePointsPerTeamGap),
    { ...checkMaximum("formationDelta", "Largest formation points-per-team delta", formationDelta.value, limits.maximumFormationPointsPerTeamDelta), bucket:formationDelta.key, samples:formationDelta.samples },
    { ...checkMaximum("tacticDelta", "Largest tactic points-per-team delta", tacticDelta.value, limits.maximumTacticPointsPerTeamDelta), bucket:tacticDelta.key, samples:tacticDelta.samples },
    { ...checkMaximum("styleDelta", "Largest style points-per-team delta", styleDelta.value, limits.maximumStylePointsPerTeamDelta), bucket:styleDelta.key, samples:styleDelta.samples },
    { ...checkMaximum("formationSpread", "Candidate formation points spread", formationSpread.value, limits.maximumFormationCandidatePointsSpread), minimum:formationSpread.minimum, maximumBucket:formationSpread.maximum },
    { ...checkMaximum("tacticSpread", "Candidate tactic points spread", tacticSpread.value, limits.maximumTacticCandidatePointsSpread), minimum:tacticSpread.minimum, maximumBucket:tacticSpread.maximum },
    { ...checkMaximum("styleSpread", "Candidate style points spread", styleSpread.value, limits.maximumStyleCandidatePointsSpread), minimum:styleSpread.minimum, maximumBucket:styleSpread.maximum },
  ];
  const sampleRequirement = { minimumMatches:Number(config.minimumMatches), actualMatches:Number(aggregate.matches) };
  sampleRequirement.met = sampleRequirement.actualMatches >= sampleRequirement.minimumMatches;
  const criticalFailures = checks.filter((check) => check.status !== "pass").map((check) => check.id);
  return { verdict:sampleRequirement.met && criticalFailures.length === 0 ? "pass" : "review", sampleRequirement, criticalFailures, checks };
}

function runWorker(task, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData:task });
    let settled = false;
    worker.on("message", (message) => {
      if (message.type === "progress") return onProgress(message.completed);
      if (message.error) {
        settled = true;
        return reject(Object.assign(new Error(message.error.message), message.error));
      }
      settled = true;
      resolve(message);
    });
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0 && !settled) reject(new Error(`V2.1d candidate baseline worker exited with code ${code}`)); });
  });
}

async function runPool(tasks, concurrency) {
  const results = [];
  const progress = new Map(tasks.map((task) => [task.taskId, 0]));
  const total = tasks.reduce((sum, task) => sum + task.count, 0);
  let cursor = 0;
  let lastPercent = -1;
  const report = () => {
    const complete = [...progress.values()].reduce((sum, value) => sum + value, 0);
    const percent = Math.floor(complete / Math.max(1, total) * 100);
    if (percent >= lastPercent + 2 || complete === total) {
      lastPercent = percent;
      process.stdout.write(`V2.1d candidate baseline: ${complete}/${total} (${percent}%)\n`);
    }
  };
  async function consume() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const result = await runWorker(task, (completed) => { progress.set(task.taskId, completed); report(); });
      progress.set(task.taskId, task.count);
      results.push(result);
      report();
    }
  }
  await Promise.all(Array.from({ length:Math.min(concurrency, tasks.length) }, consume));
  return results;
}

export async function runCandidateBaseline(options = {}) {
  const configPath = path.resolve(here, options.configPath ?? argument("config") ?? "dynamic-shape-candidate-baseline-v2.config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.scenarioMatrixFile) {
    const scenarioConfig = JSON.parse(await readFile(path.resolve(here, config.scenarioMatrixFile), "utf8"));
    config.scenarioMatrix = scenarioConfig.scenarioMatrix;
  }
  const matches = Number(options.matches ?? argument("matches") ?? config.matches);
  const requestedWorkers = Number(options.workers ?? argument("workers") ?? 0);
  const workerCount = Math.max(1, Math.min(requestedWorkers || Math.max(1, os.cpus().length - 1), Number(config.maximumWorkers ?? 10)));
  const ranges = shardRanges(matches, Number(config.shardMatches ?? 20));
  const tasks = ranges.map((range, taskId) => ({ taskId, config, ...range }));
  const startedAt = Date.now();
  const workerResults = await runPool(tasks, workerCount);
  const aggregate = emptyAggregate();
  const rawSamples = [];
  for (const result of workerResults) {
    mergeAggregate(aggregate, result.aggregate);
    rawSamples.push(...(result.rawSamples ?? []));
  }
  rawSamples.sort((left, right) => left.index - right.index);
  const summary = summarizeAggregate(aggregate);
  const evaluation = evaluateCandidateGuardrails(aggregate, summary, config);
  const { scenarioMatrix, ...reportConfig } = config;
  const report = {
    outputVersion:config.outputVersion,
    generatedAt:new Date().toISOString(),
    branch:"V2.1d candidate",
    comparison:"paired stable V2.1 off versus V2.1d candidate spatial execution; no V1 comparison",
    config:{ ...reportConfig, matches, scenarioCount:scenarioMatrix ? "loaded-from-scenarioMatrixFile" : 0 },
    runtime:{ workers:workerCount, elapsedSeconds:round((Date.now() - startedAt) / 1000, 2) },
    samples:{ matches:aggregate.matches, teamSamples:aggregate.matches * 2 },
    evaluation,
    summary,
  };
  const outputPath = path.resolve(here, argument("output") ?? config.outputFile);
  const rawOutputPath = path.resolve(here, argument("raw-output") ?? config.rawOutputFile);
  await mkdir(path.dirname(outputPath), { recursive:true });
  await mkdir(path.dirname(rawOutputPath), { recursive:true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(rawOutputPath, `${JSON.stringify({ outputVersion:config.outputVersion, generatedAt:report.generatedAt, samples:rawSamples }, null, 2)}\n`, "utf8");
  return { outputPath, rawOutputPath, report };
}

async function main() {
  const result = await runCandidateBaseline();
  process.stdout.write(`V2.1d candidate baseline JSON generated: ${result.outputPath}\n`);
  process.stdout.write(`V2.1d candidate diagnostic samples generated: ${result.rawOutputPath}\n`);
  process.stdout.write(`Verdict: ${result.report.evaluation.verdict}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
