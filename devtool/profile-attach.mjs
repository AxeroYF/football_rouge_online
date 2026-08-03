// 给运行中的 node 进程附加 CPU profiler（无需重启服务）
// 用法: node devtool/profile-attach.mjs <PID> [秒数=60] [输出路径=/tmp/ydl-prof/attached.cpuprofile]
import fs from "node:fs";
import path from "node:path";

const pid = Number(process.argv[2]);
const seconds = Number(process.argv[3] ?? 60);
const output = process.argv[4] ?? "/tmp/ydl-prof/attached.cpuprofile";
if (!pid) {
  console.error("用法: node devtool/profile-attach.mjs <PID> [秒数] [输出路径]");
  process.exit(1);
}

process.kill(pid, "SIGUSR1"); // 激活 inspector
await new Promise((resolve) => setTimeout(resolve, 1200));

const list = await (await fetch("http://127.0.0.1:9229/json/list")).json();
const target = list.find((entry) => entry.type === "node") ?? list[0];
if (!target?.webSocketDebuggerUrl) {
  console.error("无法连接 inspector，请确认进程已激活（SIGUSR1）");
  process.exit(1);
}

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
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

await send("Profiler.enable");
await send("Profiler.start");
console.log(`开始采样 ${seconds}s（服务保持在线，请照常操作复现卡顿）...`);
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const { profile } = await send("Profiler.stop");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(profile));
console.log("已保存:", output, `(${(fs.statSync(output).size / 1024).toFixed(0)}KB)`);
process.exit(0);
