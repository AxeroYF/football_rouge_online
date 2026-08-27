import { createServer, request as httpRequest } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../www/", import.meta.url));
const port = Number(process.env.YDTV_PORT ?? 4320);
const apiTarget = new URL(process.env.YDTV_API_TARGET ?? "http://127.0.0.1:4310");
const mimeTypes = {
  ".css":"text/css; charset=utf-8",
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml",
  ".webmanifest":"application/manifest+json; charset=utf-8",
};

function proxyApi(request, response) {
  const target = new URL(request.url, apiTarget);
  const headers = { ...request.headers, host:apiTarget.host };
  const upstream = httpRequest(target, { method:request.method, headers }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    response.writeHead(502, { "content-type":"application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok:false, error:`无法连接游戏服务器 ${apiTarget.origin}` }));
  });
  request.pipe(upstream);
}

createServer((request, response) => {
  if (request.url?.startsWith("/api/")) return proxyApi(request, response);
  const rawPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const relative = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "");
  const safePath = normalize(join(root, relative));
  if (!safePath.startsWith(root) || !existsSync(safePath) || !statSync(safePath).isFile()) {
    response.writeHead(404, { "content-type":"text/plain; charset=utf-8" });
    return response.end("Not found");
  }
  response.writeHead(200, {
    "content-type":mimeTypes[extname(safePath)] ?? "application/octet-stream",
    "cache-control":"no-store",
  });
  createReadStream(safePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`黄狗TV Windows 预览：http://127.0.0.1:${port}`);
  console.log(`API 代理目标：${apiTarget.origin}`);
});
