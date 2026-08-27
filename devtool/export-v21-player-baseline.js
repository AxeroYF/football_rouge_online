import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = String(process.env.YDL_SERVER_URL ?? "http://127.0.0.1:4310").replace(/\/$/, "");
const password = process.env.VERSUS_ADMIN_PASSWORD;
const outputPath = path.resolve(process.env.YDL_BASELINE_OUTPUT ?? "history/v21-player-baseline.json");

if (!password) throw new Error("请先设置环境变量 VERSUS_ADMIN_PASSWORD");

async function request(url, options = {}) {
  const response = await fetch(`${baseUrl}${url}`, options);
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error ?? `请求失败: ${response.status}`);
  return body;
}

const login = await request("/api/admin/login", {
  method:"POST",
  headers:{ "content-type":"application/json" },
  body:JSON.stringify({ password }),
});

const baseline = await request("/api/admin/league/simulation-baseline", {
  headers:{ authorization:`Bearer ${login.token}` },
});

await mkdir(path.dirname(outputPath), { recursive:true });
await writeFile(outputPath, `${JSON.stringify(baseline.baseline, null, 2)}\n`, "utf8");
console.log(`V2.1玩家基准快照已导出: ${outputPath}`);
console.log(`真人球队: ${baseline.baseline.teams.length}`);
