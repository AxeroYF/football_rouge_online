import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const MAX_SAMPLES = 512;
const metrics = new Map();
const startedAt = Date.now();
const eventLoop = monitorEventLoopDelay({ resolution:20 });
eventLoop.enable();

let previousCpuUsage = process.cpuUsage();
let previousCpuSampleAt = performance.now();

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function round(value, digits = 2) {
  return Number(Number(value ?? 0).toFixed(digits));
}

export function recordRuntimeMetric(name, value, options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  const entry = metrics.get(name) ?? { count:0, errors:0, total:0, max:0, samples:[], unit:options.unit ?? "ms" };
  entry.count += 1;
  entry.errors += options.error ? 1 : 0;
  entry.total += numeric;
  entry.max = Math.max(entry.max, numeric);
  entry.samples.push(numeric);
  if (entry.samples.length > MAX_SAMPLES) entry.samples.splice(0, entry.samples.length - MAX_SAMPLES);
  metrics.set(name, entry);
}

export function measureRuntimeSync(name, operation) {
  const start = performance.now();
  try {
    const result = operation();
    recordRuntimeMetric(name, performance.now() - start);
    return result;
  } catch (error) {
    recordRuntimeMetric(name, performance.now() - start, { error:true });
    throw error;
  }
}

export async function measureRuntimeAsync(name, operation) {
  const start = performance.now();
  try {
    const result = await operation();
    recordRuntimeMetric(name, performance.now() - start);
    return result;
  } catch (error) {
    recordRuntimeMetric(name, performance.now() - start, { error:true });
    throw error;
  }
}

function metricSnapshot(entry) {
  const sorted = [...entry.samples].sort((left, right) => left - right);
  const suffix = entry.unit === "percent" ? "Percent" : "Ms";
  return {
    count:entry.count,
    errors:entry.errors,
    [`avg${suffix}`]:round(entry.count ? entry.total / entry.count : 0),
    [`p50${suffix}`]:round(percentile(sorted, 0.5)),
    [`p95${suffix}`]:round(percentile(sorted, 0.95)),
    [`p99${suffix}`]:round(percentile(sorted, 0.99)),
    [`max${suffix}`]:round(entry.max),
    recentSamples:sorted.length,
  };
}

export function snapshotRuntimeMetrics() {
  const memory = process.memoryUsage();
  const delayScale = 1e6;
  return {
    generatedAt:Date.now(),
    startedAt,
    uptimeSec:round(process.uptime()),
    process:{
      pid:process.pid,
      node:process.version,
      rssMb:round(memory.rss / 1024 / 1024),
      heapUsedMb:round(memory.heapUsed / 1024 / 1024),
      heapTotalMb:round(memory.heapTotal / 1024 / 1024),
      externalMb:round(memory.external / 1024 / 1024),
    },
    eventLoop:{
      minMs:round(eventLoop.min / delayScale),
      meanMs:round(eventLoop.mean / delayScale),
      p50Ms:round(eventLoop.percentile(50) / delayScale),
      p95Ms:round(eventLoop.percentile(95) / delayScale),
      p99Ms:round(eventLoop.percentile(99) / delayScale),
      maxMs:round(eventLoop.max / delayScale),
    },
    timings:Object.fromEntries([...metrics.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, entry]) => [name, metricSnapshot(entry)])),
  };
}

const resourceSampler = setInterval(() => {
  const now = performance.now();
  const elapsedMs = Math.max(1, now - previousCpuSampleAt);
  const usage = process.cpuUsage(previousCpuUsage);
  const cpuMs = (usage.user + usage.system) / 1000;
  recordRuntimeMetric("process.cpu", cpuMs / elapsedMs * 100, { unit:"percent" });
  previousCpuUsage = process.cpuUsage();
  previousCpuSampleAt = now;
}, 10_000);
resourceSampler.unref();

export function resetRuntimeMetricsForTest() {
  metrics.clear();
}
