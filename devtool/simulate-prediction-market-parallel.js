import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./simulate-prediction-market.js", import.meta.url));
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const seasons = Math.max(1, Math.floor(Number(process.env.YDL_PREDICTION_SIM_SEASONS ?? 15)));
const workers = Math.max(1, Math.min(seasons, Math.floor(Number(process.env.YDL_PREDICTION_SIM_WORKERS ?? 15))));
const outputPath = path.resolve(projectRoot, process.env.YDL_PREDICTION_SIM_OUTPUT ?? "outputs/prediction-market-simulation.json");
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "ydl-prediction-sim-"));
const activeChildren = new Set();
const shardResults = new Array(seasons);
const startedAt = Date.now();
let nextSeasonIndex = 0;
let completedSeasons = 0;

function stopChildren(signal) {
  activeChildren.forEach((child) => child.kill());
  try { rmSync(temporaryDirectory, { recursive:true, force:true }); } catch {}
  if (signal) process.exit(130);
}

process.once("SIGINT", () => stopChildren("SIGINT"));
process.once("SIGTERM", () => stopChildren("SIGTERM"));

function durationText(milliseconds) {
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function renderProgress() {
  const elapsed = Date.now() - startedAt;
  const remaining = completedSeasons > 0 ? elapsed * (seasons - completedSeasons) / completedSeasons : Number.NaN;
  const progress = completedSeasons / seasons;
  const width = 30;
  const filled = Math.round(progress * width);
  const eta = Number.isFinite(remaining) ? durationText(remaining) : "--:--:--";
  process.stdout.write(`\r[${"=".repeat(filled)}${"-".repeat(width - filled)}] ${(progress * 100).toFixed(1).padStart(5)}% ${completedSeasons}/${seasons}赛季 已用 ${durationText(elapsed)} 剩余 ${eta}`);
}

function runSeasonShard(seasonIndex) {
  return new Promise((resolve, reject) => {
    const shardPath = path.join(temporaryDirectory, `season-${String(seasonIndex).padStart(3, "0")}.json`);
    const child = spawn(process.execPath, [scriptPath], {
      cwd:projectRoot,
      env:{
        ...process.env,
        YDL_PREDICTION_SIM_SEASONS:"1",
        YDL_PREDICTION_SIM_SEASON_OFFSET:String(seasonIndex),
        YDL_PREDICTION_SIM_OUTPUT:shardPath,
        YDL_PREDICTION_SIM_QUIET:"1",
      },
      stdio:["ignore", "ignore", "pipe"],
      windowsHide:true,
    });
    activeChildren.add(child);
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.on("error", (error) => {
      activeChildren.delete(child);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      activeChildren.delete(child);
      if (code !== 0) {
        reject(new Error(`赛季${seasonIndex + 1}模拟失败（${signal ? `信号 ${signal}` : `退出码 ${code}`}）${errorOutput ? `\n${errorOutput.trim()}` : ""}`));
        return;
      }
      try {
        resolve(JSON.parse(readFileSync(shardPath, "utf8")));
      } catch (error) {
        reject(new Error(`无法读取赛季${seasonIndex + 1}的模拟结果：${error.message}`));
      }
    });
  });
}

async function workerLoop() {
  while (true) {
    const seasonIndex = nextSeasonIndex;
    nextSeasonIndex += 1;
    if (seasonIndex >= seasons) return;
    shardResults[seasonIndex] = await runSeasonShard(seasonIndex);
    completedSeasons += 1;
    renderProgress();
  }
}

function marketRtp(rates) {
  const inverseTotal = Object.values(rates ?? {}).reduce((sum, rateValue) => {
    const rate = Number(rateValue);
    return Number.isFinite(rate) && rate > 0 ? sum + 1 / rate : sum;
  }, 0);
  return inverseTotal > 0 ? 1 / inverseTotal : 0;
}

function combinedSummary(shards, records) {
  const base = shards[0].summary;
  const enabledCategories = [...base.enabledCategories];
  const markets = records.filter((record) => record.actual);
  const summary = {
    ...base,
    generatedAt:new Date().toISOString(),
    seasons,
    parallelWorkers:workers,
    markets,
    handicaps:{},
    marketRtp:{},
    categories:{},
  };
  summary.handicaps = Object.fromEntries([...new Set(markets.map((record) => record.resultHandicap))]
    .sort((left, right) => left - right)
    .map((handicap) => [String(handicap), markets.filter((record) => record.resultHandicap === handicap).length]));
  for (const category of enabledCategories) {
    const rtpValues = markets.map((record) => marketRtp(record.payoutRates[category])).filter(Number.isFinite);
    summary.marketRtp[category] = {
      markets:rtpValues.length,
      average:rtpValues.reduce((sum, value) => sum + value, 0) / Math.max(1, rtpValues.length),
      minimum:rtpValues.length ? Math.min(...rtpValues) : null,
      maximum:rtpValues.length ? Math.max(...rtpValues) : null,
    };
    const selections = new Set(markets.flatMap((record) => Object.keys(record.payoutRates[category])));
    summary.categories[category] = Object.fromEntries([...selections].map((selection) => {
      const rows = markets.map((record) => ({ record, rate:record.payoutRates[category][selection] })).filter((row) => Number.isFinite(row.rate));
      const wins = rows.filter(({ record }) => record.actual[category] === selection).length;
      const payout = rows.reduce((sum, { record, rate }) => sum + (record.actual[category] === selection ? rate : 0), 0);
      const averageRawPayoutRate = rows.reduce((sum, { record }) => sum + Number(record.rawPayoutRates[category][selection]), 0) / Math.max(1, rows.length);
      const averagePayoutRate = rows.reduce((sum, { rate }) => sum + rate, 0) / Math.max(1, rows.length);
      const theoreticalRoi = rows.reduce((sum, { record, rate }) => {
        const probability = Number(record.pricingForecast?.[category]?.[selection] ?? record.forecast?.[category]?.[selection] ?? 0);
        return sum + probability * rate - 1;
      }, 0) / Math.max(1, rows.length);
      return [selection, {
        bets:rows.length,
        wins,
        hitRate:wins / Math.max(1, rows.length),
        theoreticalRoi,
        realizedRoi:(payout - rows.length) / Math.max(1, rows.length),
        averageRawPayoutRate,
        averagePayoutRate,
        averageDiscount:averagePayoutRate / Math.max(.001, averageRawPayoutRate),
      }];
    }));
  }
  return summary;
}

renderProgress();
try {
  await Promise.all(Array.from({ length:workers }, () => workerLoop()));
  const records = shardResults.flatMap((shard) => shard.records).sort((left, right) => left.seasonIndex - right.seasonIndex || left.round - right.round || left.marketId.localeCompare(right.marketId));
  const summary = combinedSummary(shardResults, records);
  mkdirSync(path.dirname(outputPath), { recursive:true });
  writeFileSync(outputPath, `${JSON.stringify({ summary, records }, null, 2)}\n`, "utf8");
  process.stdout.write("\n");
  console.log(JSON.stringify({
    output:outputPath,
    schemaVersion:summary.schemaVersion,
    pricingVersion:summary.pricingVersion,
    seasons,
    workers,
    markets:summary.markets.length,
    enabledCategories:summary.enabledCategories,
    handicaps:summary.handicaps,
    marketRtp:summary.marketRtp,
    categories:summary.categories,
  }, null, 2));
} catch (error) {
  activeChildren.forEach((child) => child.kill());
  process.stdout.write("\n");
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  rmSync(temporaryDirectory, { recursive:true, force:true });
}
