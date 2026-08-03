// YDL 服务器 HTTP 压测（在服务器本机或本地运行）
//
// 用法：
//   node devtool/loadtest-http.mjs --endpoint head --concurrency 6 --duration 45
//   node devtool/loadtest-http.mjs --endpoint league --concurrency 3 --duration 30
//   node devtool/loadtest-http.mjs --endpoint broadcasts --concurrency 10 --duration 30
//   node devtool/loadtest-http.mjs --endpoint static --concurrency 10 --duration 30
//
// 环境变量：
//   YDL_LOADTEST_BASE       默认 http://127.0.0.1:4318
//   YDL_LOADTEST_PLAYER_ID / YDL_LOADTEST_TOKEN   指定测试账号（默认读取 data/versus-accounts.json 第一个账号）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.YDL_LOADTEST_BASE ?? "http://127.0.0.1:4318";
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const endpoint = flag("--endpoint", "head");
const concurrency = Math.max(1, Number(flag("--concurrency", "6")));
const durationSec = Math.max(5, Number(flag("--duration", "45")) || 45);
const durationMs = durationSec * 1000;
const requestTimeoutMs = Math.max(3_000, Number(flag("--timeout", "15000")));

let account = null;
if (process.env.YDL_LOADTEST_PLAYER_ID && process.env.YDL_LOADTEST_TOKEN) {
  account = { playerId: process.env.YDL_LOADTEST_PLAYER_ID, accountToken: process.env.YDL_LOADTEST_TOKEN };
} else {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(HERE, "../data/versus-accounts.json"), "utf8"));
    const list = Object.values(saved.accounts ?? {});
    if (list.length) account = { playerId: list[0].id, accountToken: list[0].token };
  } catch { /* 无账号文件时仅可测无需账号的端点 */ }
}

const targets = {
  head: { method: "POST", path: "/api/versus/league/head", needsAccount: true },
  league: { method: "POST", path: "/api/versus/league", needsAccount: true },
  broadcasts: { method: "GET", path: "/api/versus/broadcasts", needsAccount: false },
  static: { method: "GET", path: "/versus/app.js", needsAccount: false },
};
const target = targets[endpoint];
if (!target) {
  console.error(`未知端点 ${endpoint}，可选: ${Object.keys(targets).join(" | ")}`);
  process.exit(1);
}
if (target.needsAccount && !account) {
  console.error(`${endpoint} 需要有效账号，请设置 YDL_LOADTEST_PLAYER_ID / YDL_LOADTEST_TOKEN`);
  process.exit(1);
}

async function hit() {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const options = { method: target.method, signal: controller.signal, headers: {} };
    if (target.needsAccount) {
      options.headers["content-type"] = "application/json";
      options.body = JSON.stringify({ playerId: account.playerId, accountToken: account.accountToken });
    }
    const response = await fetch(BASE + target.path, options);
    const text = await response.text();
    return { ms: Date.now() - started, status: response.status, bytes: text.length, aborted: false };
  } catch (error) {
    return { ms: Date.now() - started, status: 0, bytes: 0, aborted: error?.name === "AbortError" };
  } finally {
    clearTimeout(timer);
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function report(label, samples) {
  if (!samples.length) return console.log(`${label}: 无样本`);
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const errors = samples.filter((s) => s.status !== 200 || s.aborted).length;
  const totalBytes = samples.reduce((sum, s) => sum + s.bytes, 0);
  const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
  const statuses = {};
  samples.forEach((s) => { const key = s.aborted ? "abort" : String(s.status); statuses[key] = (statuses[key] ?? 0) + 1; });
  const statusText = Object.entries(statuses).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(
    `${label}: n=${samples.length} | avg=${avg.toFixed(0)}ms | p50=${percentile(ms, 0.5)}ms | p95=${percentile(ms, 0.95)}ms | p99=${percentile(ms, 0.99)}ms | max=${ms[ms.length - 1]}ms | 非200/失败=${errors} | 状态分布: ${statusText} | ${(totalBytes / 1024 / 1024).toFixed(1)}MB`,
  );
}

console.log(`== 压测 ${target.path} | 并发 ${concurrency} | 时长 ${durationSec}s | 超时阈值 ${requestTimeoutMs}ms`);
if (account && target.needsAccount) console.log(`== 使用账号: ${account.playerId}`);
const startedAt = Date.now();
let running = true;
let samples = [];
let windows = [];

const workers = Array.from({ length: concurrency }, async () => {
  while (running) {
    const result = await hit();
    samples.push(result);
    windows.push(result);
  }
});

const interval = setInterval(() => {
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed >= durationMs / 1000) {
    running = false;
    clearInterval(interval);
    return;
  }
  if (windows.length) {
    report(`  [${elapsed.toFixed(0)}s] 近10s`, windows);
    windows = [];
  }
}, 10_000);

await Promise.all(workers);
report(`== 总计 ${target.path}`, samples);
console.log("== 压测结束");
process.exit(0);
