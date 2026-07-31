import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildS4BalanceReportFromAggregate,
  createS4BalanceAggregate,
  mergeS4BalanceAggregates,
  splitS4BalanceReportOutput,
} from "./s4-balance-report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const configPath = path.resolve(here, argument("config") ?? "s4-balance-config.json");
const outputPathArgument = argument("output");
const workerPath = path.resolve(here, "s4-balance-report-worker.js");

const zeroExperiments = (experiments = {}) => Object.fromEntries(Object.keys(experiments).map((key) => [key, 0]));

function shardRanges(total, count) {
  const ranges = [];
  const size = Math.ceil(total / Math.max(1, count));
  for (let start = 0; start < total; start += size) ranges.push({ start, count:Math.min(size, total - start) });
  return ranges;
}

function taskConfig(config, overrides = {}) {
  return { ...config, matches:0, rawMatchSampleLimit:0, experiments:zeroExperiments(config.experiments), ...overrides };
}

function buildTasks(config, workerCount) {
  const tasks = [];
  const primaryRanges = shardRanges(Number(config.matches ?? 0), Math.max(1, workerCount));
  primaryRanges.forEach((range, index) => {
    const sampleStart = Math.max(range.start, 0);
    const sampleEnd = Math.min(range.start + range.count, Number(config.rawMatchSampleLimit ?? 0));
    tasks.push({
      taskId:`primary-${index}`,
      kind:"primary",
      config:taskConfig(config, {
        matches:range.count,
        matchStart:range.start,
        rawSampleStart:sampleStart,
        rawMatchSampleLimit:Math.max(0, sampleEnd - sampleStart),
      }),
    });
  });

  const experiments = config.experiments ?? {};
  const addExperiment = (experimentKey, values) => {
    const isolated = zeroExperiments(experiments);
    Object.assign(isolated, values);
    tasks.push({ taskId:`experiment-${experimentKey}`, kind:"experiment", experimentKey, config:taskConfig(config, { experiments:isolated }) });
  };
  addExperiment("xTaskStudy", { xTaskMatchesPerRole:experiments.xTaskMatchesPerRole });
  addExperiment("formationMatrix", { formationMatchesPerCell:experiments.formationMatchesPerCell });
  addExperiment("tacticMatrix", { tacticMatchesPerCell:experiments.tacticMatchesPerCell });
  addExperiment("styleMatrix", { styleMatchesPerCell:experiments.styleMatchesPerCell });
  addExperiment("tacticalCombinationStudy", { tacticalCombinationMatchesPerCell:experiments.tacticalCombinationMatchesPerCell });
  addExperiment("upgradeMatrix", { upgradeMatchesPerCell:experiments.upgradeMatchesPerCell });
  addExperiment("traitCountMatrix", { traitMatchesPerCell:experiments.traitMatchesPerCell });
  addExperiment("legendDensityMatrix", { legendMatchesPerCell:experiments.legendMatchesPerCell });
  addExperiment("weatherStyleMatrix", { weatherStyleMatchesPerCell:experiments.weatherStyleMatchesPerCell });
  addExperiment("refereeStyleMatrix", { refereeStyleMatchesPerCell:experiments.refereeStyleMatchesPerCell });
  addExperiment("dynamicPlansVsStatic", { dynamicPlanMatches:experiments.dynamicPlanMatches });
  return tasks.filter((task) => task.kind === "primary" || Object.values(task.config.experiments).some((value) => Number(value) > 0));
}

function runWorker(task) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData:task });
    worker.once("message", (result) => result.error ? reject(Object.assign(new Error(result.error.message), result.error)) : resolve(result));
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`S4 balance worker exited with code ${code}`)); });
  });
}

async function runPool(tasks, concurrency) {
  const results = [];
  let cursor = 0;
  async function consume() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      process.stdout.write(`\rS4 parallel tasks ${results.length}/${tasks.length} | ${task.taskId}`);
      results.push(await runWorker(task));
    }
  }
  await Promise.all(Array.from({ length:Math.min(concurrency, tasks.length) }, consume));
  process.stdout.write(`\rS4 parallel tasks ${tasks.length}/${tasks.length}\n`);
  return results;
}

function assemble(config, workerResults) {
  const aggregate = createS4BalanceAggregate();
  const rawMatchSamples = [];
  const experimentalResults = {};
  for (const result of workerResults) {
    mergeS4BalanceAggregates(aggregate, result.internalAggregate);
    rawMatchSamples.push(...(result.rawMatchSamples ?? []));
    if (result.kind === "experiment" && result.experimentKey) experimentalResults[result.experimentKey] = result.experiments[result.experimentKey];
  }
  rawMatchSamples.sort((left, right) => left.seed.localeCompare(right.seed));
  const report = buildS4BalanceReportFromAggregate(config, aggregate, experimentalResults, rawMatchSamples);
  return report;
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const requestedWorkers = Number(argument("workers") ?? 0);
  const workerCount = Math.max(1, Math.min(requestedWorkers || Math.max(1, os.cpus().length - 1), 32));
  const tasks = buildTasks(config, workerCount);
  console.log(`S4 parallel balance: ${workerCount} workers, ${tasks.length} independent tasks`);
  const results = await runPool(tasks, workerCount);
  const data = assemble(config, results);
  const outputPath = outputPathArgument ? path.resolve(outputPathArgument) : path.resolve(here, `../outputs/S4赛季比赛模拟-${config.outputVersion}-parallel.json`);
  await mkdir(path.dirname(outputPath), { recursive:true });
  const rawSamplesPath = outputPath.replace(/\.json$/i, "-raw-samples.json");
  const separated = splitS4BalanceReportOutput(data, path.basename(rawSamplesPath));
  await writeFile(outputPath, `${JSON.stringify(separated.mainReport, null, 2)}\n`, "utf8");
  await writeFile(rawSamplesPath, `${JSON.stringify(separated.rawReport, null, 2)}\n`, "utf8");
  console.log(`S4 parallel balance core JSON generated: ${outputPath}`);
  console.log(`S4 parallel diagnostic samples generated: ${rawSamplesPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
