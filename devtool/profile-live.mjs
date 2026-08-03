// 对运行中的 node 进程抓 60 秒 CPU 采样并直接打印占用最高的函数（服务无需重启）
// 用法: node devtool/profile-live.mjs <PID> [秒数=60]
import fs from "node:fs";

const pid = Number(process.argv[2]);
const seconds = Number(process.argv[3] ?? 60);
if (!pid) {
  console.error("用法: node devtool/profile-live.mjs <PID> [秒数]");
  process.exit(1);
}

process.kill(pid, "SIGUSR1");
await new Promise((resolve) => setTimeout(resolve, 1200));
const list = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const target = list.find((entry) => entry.type === "node") ?? list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
let messageId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++messageId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

await send("Profiler.enable");
await send("Profiler.start");
console.log(`采样中（${seconds}s）... 期间请照常操作/观战`);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const { profile } = await send("Profiler.stop");

const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const total = profile.samples?.length ?? 0;
const selfHits = new Map();
for (const nodeId of profile.samples ?? []) {
  const frame = nodes.get(nodeId)?.callFrame;
  if (!frame) continue;
  const key = `${frame.functionName || "(anonymous)"} @ ${frame.url ?? ""}:${frame.lineNumber ?? 0}`;
  selfHits.set(key, (selfHits.get(key) ?? 0) + 1);
}
console.log(`总样本: ${total}`);
[...selfHits.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 25)
  .forEach(([key, hits]) => console.log(`${(hits / total * 100).toFixed(1).padStart(5)}%  ${hits.toString().padStart(7)}  ${key}`));
process.exit(0);
