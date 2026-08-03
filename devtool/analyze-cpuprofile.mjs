// 分析 Node --cpu-prof 生成的 .cpuprofile，打印占用最多的函数
// 用法: node devtool/analyze-cpuprofile.mjs /tmp/ydl-prof/CPU.xxx.cpuprofile
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("用法: node devtool/analyze-cpuprofile.mjs <文件.cpuprofile>");
  process.exit(1);
}
const profile = JSON.parse(fs.readFileSync(file, "utf8"));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const totalSamples = profile.samples?.length ?? 0;
const selfHits = new Map();
for (const nodeId of profile.samples ?? []) {
  const node = nodes.get(nodeId);
  if (!node) continue;
  const frame = node.callFrame;
  const key = `${frame.functionName || "(anonymous)"} @ ${frame.url ?? ""}:${frame.lineNumber ?? 0}`;
  selfHits.set(key, (selfHits.get(key) ?? 0) + 1);
}
const rows = [...selfHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log(`总样本: ${totalSamples}`);
for (const [key, hits] of rows) {
  console.log(`${(hits / totalSamples * 100).toFixed(1).padStart(5)}%  ${hits.toString().padStart(7)}  ${key}`);
}
