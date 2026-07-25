import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import "./test-environment.js";

await import("./server.js");

const candidates = [
  process.env.CLOUDFLARED_PATH,
  "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
  "C:\\Program Files\\cloudflared\\cloudflared.exe",
].filter(Boolean);
const executable = candidates.find((candidate) => existsSync(candidate)) ?? "cloudflared";
const port = Number(process.env.DEVTOOL_PORT);
const child = spawn(executable, ["tunnel", "--url", `http://127.0.0.1:${port}`], { stdio:"inherit" });

child.on("error", (error) => {
  console.error(`无法启动测试服 cloudflared：${error.message}`);
  process.exit(1);
});
child.on("exit", (code) => { process.exit(code ?? 1); });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
    setTimeout(() => process.exit(0), 100).unref();
  });
}
