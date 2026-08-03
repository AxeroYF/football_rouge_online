import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { buildS4BalanceSeat } from "../s4-balance-report.js";
import { advanceYdlLeagueV2Match, createYdlLeagueV2Match, publicYdlLeagueV2Match } from "./ydl-league-engine-adapter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

function positiveInteger(name, fallback, maximum = 10_000) {
  const value = Number(argument(name, fallback));
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`--${name} 必须是 1-${maximum} 的整数`);
  return value;
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function timings(values) {
  return {
    samples:values.length,
    minimumMs:round(Math.min(...values)),
    medianMs:round(percentile(values, 0.5)),
    p95Ms:round(percentile(values, 0.95)),
    maximumMs:round(Math.max(...values)),
    averageMs:round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function mib(bytes) {
  return round(Number(bytes) / 1024 / 1024);
}

function verdict(p95TickMs, maximumTickMs, rssBytes, intervalMs, matchCount, chainCount) {
  const intervalShare = p95TickMs / intervalMs;
  const rssShare = rssBytes / (4 * 1024 ** 3);
  if (maximumTickMs >= intervalMs || rssShare >= 0.8) return {
    level:"critical",
    label:"压力过大",
    summary:"一次推进可能挤满调度周期，或内存接近 4G 上限，不建议直接上线 180 链。",
  };
  if (p95TickMs >= 4_000 || intervalShare >= 0.35 || rssShare >= 0.6) return {
    level:"high",
    label:"高压力",
    summary:"联赛能够运行，但会明显阻塞同一 Node 进程中的邮件、战术保存和直播轮询。",
  };
  if (p95TickMs >= 1_000 || intervalShare >= 0.1 || rssShare >= 0.35) return {
    level:"moderate",
    label:"中等压力",
    summary:"吞吐量足够，但直播推进时可能出现可感知的接口延迟，建议先灰度并监控。",
  };
  return {
    level:"low",
    label:"低压力",
    summary:`在当前测试条件下，${matchCount} 场 × ${chainCount} 链对 2 核 4G 留有较充足余量。`,
  };
}

async function persistenceBenchmark(matches, statePath, repeats) {
  let baseState = {};
  let sourceBytes = 0;
  if (statePath && existsSync(statePath)) {
    const source = await readFile(statePath, "utf8");
    sourceBytes = Buffer.byteLength(source);
    baseState = JSON.parse(source);
  }
  const benchmarkState = {
    ...baseState,
    liveRound:{
      roundNumber:"benchmark",
      startedAt:Date.now(),
      matches:matches.map((match, index) => ({ code:`BENCH-${index + 1}`, fixtureIndex:index, spectators:{}, match })),
    },
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), "ydl-v2-pressure-"));
  const target = path.join(directory, "state.json");
  const encodeMs = [];
  const writeMs = [];
  let bytes = 0;
  try {
    for (let index = 0; index < repeats; index += 1) {
      let started = performance.now();
      const json = `${JSON.stringify(benchmarkState, null, 2)}\n`;
      encodeMs.push(performance.now() - started);
      bytes = Buffer.byteLength(json);
      const temporary = `${target}.${index}.tmp`;
      started = performance.now();
      await writeFile(temporary, json, "utf8");
      await rename(temporary, target);
      writeMs.push(performance.now() - started);
    }
  } finally {
    await rm(directory, { recursive:true, force:true });
  }
  return { sourceStateMiB:mib(sourceBytes), benchmarkStateMiB:mib(bytes), encode:timings(encodeMs), atomicWrite:timings(writeMs) };
}

async function main() {
  const matchCount = positiveInteger("matches", 5, 100);
  const chainCount = positiveInteger("chains", 180, 1_000);
  const batchSize = positiveInteger("batch", 8, chainCount);
  const rounds = positiveInteger("rounds", 2, 20);
  const persistRepeats = positiveInteger("persist-repeats", 3, 20);
  const intervalMs = positiveInteger("interval-ms", 15_000, 300_000);
  const defaultStatePath = path.resolve(projectRoot, "data/yellowdogs-league.json");
  const requestedStatePath = argument("state", existsSync(defaultStatePath) ? defaultStatePath : "");
  const statePath = requestedStatePath ? path.resolve(requestedStatePath) : null;
  const outputPath = argument("output") ? path.resolve(argument("output")) : null;
  const startedAt = 1_800_000_000_000;
  const templates = [
    buildS4BalanceSeat("server-pressure", "home", "traitHeavy"),
    buildS4BalanceSeat("server-pressure", "away", "enhanced"),
  ];
  const tickSamples = [];
  const roundSamples = [];
  let retainedMatches = [];
  const memoryBefore = process.memoryUsage();

  console.log(`YDL V2 服务器压力测试：${matchCount} 场 × ${chainCount} 链，单次每场最多 ${batchSize} 链，共 ${rounds} 轮`);
  for (let roundIndex = 0; roundIndex < rounds; roundIndex += 1) {
    const matches = Array.from({ length:matchCount }, (_, matchIndex) => {
      const match = createYdlLeagueV2Match(structuredClone(templates), {
        now:startedAt,
        seed:`server-pressure:${roundIndex}:${matchIndex}`,
        competitionMode:"league",
      });
      match.possessionChainCount = chainCount;
      return match;
    });
    const roundStarted = performance.now();
    while (matches.some((match) => !match.finished)) {
      const tickStarted = performance.now();
      for (const match of matches) advanceYdlLeagueV2Match(match, startedAt + 10 * 60_000, { maximumChains:batchSize });
      tickSamples.push(performance.now() - tickStarted);
    }
    const elapsed = performance.now() - roundStarted;
    roundSamples.push(elapsed);
    retainedMatches = matches;
    console.log(`第 ${roundIndex + 1}/${rounds} 轮完成：${round(elapsed)} ms`);
  }

  const publicStarted = performance.now();
  const publicViews = retainedMatches.map((match) => publicYdlLeagueV2Match(match, startedAt + 10 * 60_000, null, true));
  const publicViewMs = performance.now() - publicStarted;
  const publicJsonStarted = performance.now();
  const publicJson = JSON.stringify(publicViews);
  const publicJsonMs = performance.now() - publicJsonStarted;
  const persistence = await persistenceBenchmark(retainedMatches, statePath, persistRepeats);
  const memoryAfter = process.memoryUsage();
  const tickStats = timings(tickSamples);
  const assessment = verdict(tickStats.p95Ms, tickStats.maximumMs, memoryAfter.rss, intervalMs, matchCount, chainCount);
  const cpu = os.cpus();
  const report = {
    generatedAt:new Date().toISOString(),
    environment:{
      platform:process.platform,
      release:os.release(),
      architecture:process.arch,
      node:process.version,
      cpuModel:cpu[0]?.model ?? "unknown",
      logicalCpuCount:cpu.length,
      totalMemoryMiB:mib(os.totalmem()),
      freeMemoryMiB:mib(os.freemem()),
    },
    configuration:{ matchCount, chainCount, batchSize, rounds, schedulerIntervalMs:intervalMs, statePath },
    engine:{
      liveTickAllMatches:tickStats,
      completeRound:timings(roundSamples),
      estimatedTickCpuSharePercent:round(tickStats.p95Ms / intervalMs * 100),
      generatedChains:matchCount * chainCount * rounds,
    },
    memory:{
      rssBeforeMiB:mib(memoryBefore.rss),
      rssAfterMiB:mib(memoryAfter.rss),
      rssGrowthMiB:mib(memoryAfter.rss - memoryBefore.rss),
      heapUsedAfterMiB:mib(memoryAfter.heapUsed),
      externalAfterMiB:mib(memoryAfter.external),
    },
    responseAndPersistence:{
      publicViewMs:round(publicViewMs),
      publicJsonMs:round(publicJsonMs),
      publicJsonMiB:mib(Buffer.byteLength(publicJson)),
      persistence,
    },
    assessment,
    interpretation:{
      httpBlocking:"引擎当前在 Node 主线程同步执行；liveTickAllMatches.maximumMs 近似该时刻其他接口可能被阻塞的上限。",
      scheduler:"线上定时器每 15 秒推进一次；estimatedTickCpuSharePercent 反映单轮推进占调度周期的比例。",
      persistence:"如果传入真实 --state，测试会把其内容复制到系统临时目录后注入 5 场比赛，绝不会改写正式存档。",
    },
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await writeFile(outputPath, serialized, "utf8");
    console.log(`完整报告已写入：${outputPath}`);
  }
  console.log(serialized);
  console.log(`结论：${assessment.label}。${assessment.summary}`);
}

await main();
