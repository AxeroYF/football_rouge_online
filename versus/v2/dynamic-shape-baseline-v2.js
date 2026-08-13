import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, "dynamic-shape-baseline-v2-worker.js");
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

function shardRanges(total, size) {
  const ranges = [];
  for (let start = 0; start < total; start += size) ranges.push({ start, count:Math.min(size, total - start) });
  return ranges;
}

function emptyAggregate() {
  return {
    matches:0,
    traces:0,
    teamShapeSamples:0,
    buckets:{ overall:{}, byStage:{}, byLane:{}, byPossessionType:{}, byStyle:{}, byTactic:{}, byFormation:{}, bySide:{}, byStageLane:{} },
  };
}

function emptyBucket() {
  return { samples:0, sums:{}, minima:{}, maxima:{}, violations:{} };
}

function mergeBucket(target, source) {
  target.samples += Number(source.samples ?? 0);
  for (const [key, value] of Object.entries(source.sums ?? {})) target.sums[key] = Number(target.sums[key] ?? 0) + Number(value ?? 0);
  for (const [key, value] of Object.entries(source.minima ?? {})) target.minima[key] = Math.min(Number(target.minima[key] ?? Number.POSITIVE_INFINITY), Number(value));
  for (const [key, value] of Object.entries(source.maxima ?? {})) target.maxima[key] = Math.max(Number(target.maxima[key] ?? Number.NEGATIVE_INFINITY), Number(value));
  for (const [key, value] of Object.entries(source.violations ?? {})) target.violations[key] = Number(target.violations[key] ?? 0) + Number(value ?? 0);
}

function mergeAggregate(target, source) {
  target.matches += Number(source.matches ?? 0);
  target.traces += Number(source.traces ?? 0);
  target.teamShapeSamples += Number(source.teamShapeSamples ?? 0);
  for (const [dimension, buckets] of Object.entries(source.buckets ?? {})) {
    const targetDimension = target.buckets[dimension] ??= {};
    for (const [key, bucket] of Object.entries(buckets ?? {})) mergeBucket(targetDimension[key] ??= emptyBucket(), bucket);
  }
}

export function summarizeDynamicShapeBucket(bucket) {
  const samples = Number(bucket?.samples ?? 0);
  const average = Object.fromEntries(Object.entries(bucket?.sums ?? {}).map(([key, value]) => [key, samples ? round(value / samples) : null]));
  const minimum = Object.fromEntries(Object.entries(bucket?.minima ?? {}).map(([key, value]) => [key, Number.isFinite(value) ? round(value) : null]));
  const maximum = Object.fromEntries(Object.entries(bucket?.maxima ?? {}).map(([key, value]) => [key, Number.isFinite(value) ? round(value) : null]));
  const violations = Object.fromEntries(Object.entries(bucket?.violations ?? {}).map(([key, count]) => [key, {
    count:Number(count),
    ratePercent:samples ? round(Number(count) / samples * 100, 3) : 0,
  }]));
  return { samples, average, minimum, maximum, violations };
}

function summarizeAggregate(aggregate) {
  return Object.fromEntries(Object.entries(aggregate.buckets).map(([dimension, buckets]) => [
    dimension,
    Object.fromEntries(Object.entries(buckets).sort(([left], [right]) => left.localeCompare(right)).map(([key, bucket]) => [key, summarizeDynamicShapeBucket(bucket)])),
  ]));
}

function metric(summary, dimension, key, pathValue) {
  return String(pathValue).split(".").reduce((value, part) => value?.[part], summary?.[dimension]?.[key]);
}

function checkMaximum(id, label, value, maximum, critical = true) {
  const number = Number(value);
  return { id, label, value:Number.isFinite(number) ? round(number) : null, maximum:Number(maximum), critical, status:Number.isFinite(number) && number <= Number(maximum) ? "pass" : "high" };
}

function worstViolation(summary, dimension, violation, predicate, minimumSamples) {
  const candidates = Object.entries(summary?.[dimension] ?? {})
    .filter(([key, bucket]) => (!predicate || predicate(key, bucket)) && Number(bucket.samples) >= Number(minimumSamples))
    .map(([key, bucket]) => ({ key, value:Number(bucket.violations?.[violation]?.ratePercent ?? 0), samples:Number(bucket.samples) }))
    .sort((left, right) => right.value - left.value || right.samples - left.samples || left.key.localeCompare(right.key));
  return candidates[0] ?? { key:null, value:0, samples:0 };
}

export function evaluateDynamicShapeGuardrails(results, summary, config) {
  const limits = config.guardrails;
  const attacking = summary.overall.attacking;
  const defending = summary.overall.defending;
  const localMinimum = Number(limits.minimumLocalBucketSamples);
  const worstLocalSeparation = worstViolation(summary, "byStageLane", "separation", null, localMinimum);
  const worstLocalDisplacement = worstViolation(summary, "byStageLane", "displacement", null, localMinimum);
  const lateWideAttack = worstViolation(
    summary,
    "byStageLane",
    "restDefense",
    (key) => /^attacking:(chance|shot):(farLeft|farRight)$/.test(key),
    localMinimum,
  );
  const criticalRestRegression = worstViolation(summary, "byStageLane", "criticalRestDefenseRegression", null, localMinimum);
  const checks = [
    checkMaximum("nonFinite", "Non-finite dynamic shape metrics", Number(attacking?.violations.nonFinite.ratePercent ?? 100) + Number(defending?.violations.nonFinite.ratePercent ?? 100), limits.maximumNonFiniteRatePercent),
    checkMaximum("separation", "Minimum-distance violation rate", Math.max(Number(attacking?.violations.separation.ratePercent ?? 100), Number(defending?.violations.separation.ratePercent ?? 100)), limits.maximumSeparationViolationRatePercent),
    checkMaximum("attackingRestDefense", "Attacking rest-defense shortage rate", attacking?.violations.restDefense.ratePercent, limits.maximumAttackingRestDefenseShortageRatePercent),
    checkMaximum("defendingRestDefense", "Defending rest-defense shortage rate", defending?.violations.restDefense.ratePercent, limits.maximumDefendingRestDefenseShortageRatePercent),
    checkMaximum("displacement", "Extreme player-displacement rate", Math.max(Number(attacking?.violations.displacement.ratePercent ?? 100), Number(defending?.violations.displacement.ratePercent ?? 100)), limits.maximumDisplacementViolationRatePercent),
    checkMaximum("width", "Extreme team-width rate", Math.max(Number(attacking?.violations.width.ratePercent ?? 100), Number(defending?.violations.width.ratePercent ?? 100)), limits.maximumWidthViolationRatePercent),
    checkMaximum("centroid", "Extreme lateral-centroid rate", Math.max(Number(attacking?.violations.centroid.ratePercent ?? 100), Number(defending?.violations.centroid.ratePercent ?? 100)), limits.maximumCentroidViolationRatePercent),
    { ...checkMaximum("stageLaneSeparation", "Worst stage/lane minimum-distance violation rate", worstLocalSeparation.value, limits.maximumStageLaneSeparationViolationRatePercent), bucket:worstLocalSeparation.key, samples:worstLocalSeparation.samples },
    { ...checkMaximum("stageLaneDisplacement", "Worst stage/lane extreme-displacement rate", worstLocalDisplacement.value, limits.maximumStageLaneDisplacementViolationRatePercent), bucket:worstLocalDisplacement.key, samples:worstLocalDisplacement.samples },
    { ...checkMaximum("lateWideAttackingRestDefense", "Worst late wide-attack rest-defense shortage rate", lateWideAttack.value, limits.maximumLateWideAttackingRestDefenseShortageRatePercent), bucket:lateWideAttack.key, samples:lateWideAttack.samples },
    { ...checkMaximum("criticalRestDefenseRegression", "Worst stable-safe to dynamic-unsafe rest-defense regression rate", criticalRestRegression.value, limits.maximumCriticalRestDefenseRegressionRatePercent), bucket:criticalRestRegression.key, samples:criticalRestRegression.samples },
  ];
  const farLeft = Number(metric(summary, "byLane", "attacking:farLeft", "average.deltaCentroidX"));
  const farRight = Number(metric(summary, "byLane", "attacking:farRight", "average.deltaCentroidX"));
  const leftHalf = Number(metric(summary, "byLane", "attacking:leftHalfSpace", "average.deltaCentroidX"));
  const rightHalf = Number(metric(summary, "byLane", "attacking:rightHalfSpace", "average.deltaCentroidX"));
  checks.push(checkMaximum("wideLaneMirror", "Far-left/right centroid mirror residual", Math.abs(farLeft + farRight), limits.maximumLaneMirrorResidual));
  checks.push(checkMaximum("halfSpaceMirror", "Half-space centroid mirror residual", Math.abs(leftHalf + rightHalf), limits.maximumLaneMirrorResidual));
  const sideMetrics = ["deltaCentroidX", "deltaCentroidY", "deltaWidth", "deltaDepth"];
  const sideGap = Math.max(...sideMetrics.flatMap((key) => ["attacking", "defending"].map((perspective) => Math.abs(
    Number(metric(summary, "bySide", `${perspective}:side0`, `average.${key}`))
      - Number(metric(summary, "bySide", `${perspective}:side1`, `average.${key}`)),
  ))));
  checks.push(checkMaximum("neutralSideSymmetry", "First/second-side average geometry gap", sideGap, limits.maximumNeutralSideAverageGap));
  const sampleRequirement = {
    minimumMatches:Number(config.minimumMatches),
    actualMatches:Number(results.matches),
    minimumTeamShapeSamples:Number(config.minimumTeamShapeSamples),
    actualTeamShapeSamples:Number(results.teamShapeSamples),
  };
  sampleRequirement.met = sampleRequirement.actualMatches >= sampleRequirement.minimumMatches
    && sampleRequirement.actualTeamShapeSamples >= sampleRequirement.minimumTeamShapeSamples;
  const criticalFailures = checks.filter((check) => check.critical && check.status !== "pass").map((check) => check.id);
  return {
    verdict:sampleRequirement.met && criticalFailures.length === 0 ? "pass" : "review",
    sampleRequirement,
    criticalFailures,
    checks,
  };
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
    worker.once("exit", (code) => { if (code !== 0 && !settled) reject(new Error(`V2.1d baseline worker exited with code ${code}`)); });
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
      process.stdout.write(`V2.1d shadow baseline: ${complete}/${total} (${percent}%)\n`);
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

export async function runDynamicShapeBaseline(options = {}) {
  const configPath = path.resolve(here, options.configPath ?? argument("config") ?? "dynamic-shape-baseline-v2.config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const matches = Number(options.matches ?? argument("matches") ?? config.matches);
  const requestedWorkers = Number(options.workers ?? argument("workers") ?? 0);
  const workerCount = Math.max(1, Math.min(requestedWorkers || Math.max(1, os.cpus().length - 1), Number(config.maximumWorkers ?? 16)));
  const ranges = shardRanges(matches, Number(config.shardMatches ?? 40));
  const tasks = ranges.map((range, taskId) => ({ taskId, config, ...range }));
  const startedAt = Date.now();
  const workerResults = await runPool(tasks, workerCount);
  const aggregate = emptyAggregate();
  const rawSamples = [];
  workerResults.sort((left, right) => left.aggregate.matches - right.aggregate.matches);
  for (const result of workerResults) {
    mergeAggregate(aggregate, result.aggregate);
    rawSamples.push(...(result.rawSamples ?? []));
  }
  rawSamples.sort((left, right) => left.index - right.index);
  const summary = summarizeAggregate(aggregate);
  const evaluation = evaluateDynamicShapeGuardrails(aggregate, summary, config);
  const report = {
    outputVersion:config.outputVersion,
    generatedAt:new Date().toISOString(),
    branch:"V2.1d shadow",
    comparison:"stable V2.1 stage geometry versus V2.1d dynamic geometry; no V1 comparison",
    config:{ ...config, matches },
    runtime:{ workers:workerCount, elapsedSeconds:round((Date.now() - startedAt) / 1000, 2) },
    samples:{ matches:aggregate.matches, traces:aggregate.traces, teamShapeSamples:aggregate.teamShapeSamples },
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
  const result = await runDynamicShapeBaseline();
  process.stdout.write(`V2.1d shadow baseline JSON generated: ${result.outputPath}\n`);
  process.stdout.write(`V2.1d shadow diagnostic samples generated: ${result.rawOutputPath}\n`);
  process.stdout.write(`Verdict: ${result.report.evaluation.verdict}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
