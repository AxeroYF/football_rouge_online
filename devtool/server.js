import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { measureRuntimeSync, recordRuntimeMetric, snapshotRuntimeMetrics } from "../src/runtime-metrics.js";
// 必须先于 api.js/league-service.js 加载：运营评级覆盖（ydl-content-overrides.json）
// 会把一批退役名宿从 A/B 升级为 S（传奇）。联赛服务单例在 league-service.js
// 模块求值期间即构造并执行 33 人大名单校验，若覆盖未先行应用，这些球员会按
// 静态评级占用名单名额，导致线上超限启动崩溃。
import "../versus/ydl-content-store.js";
import { loadDatabase, resetDatabase, saveDatabase } from "./store.js";
import { runSimulation } from "./simulation.js";
import { handleVersusApi } from "../versus/api.js";
import { handleAdminApi } from "../versus/admin-api.js";
import { VERSUS_TRAIT_CARDS } from "../versus/trait-pool.js";
import { versusRooms } from "../versus/room-service.js";
import { yellowDogsLeague } from "../versus/league-service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(here, "public");
const gameDirectory = path.resolve(here, "../game/public");
const sourceDirectory = path.resolve(here, "../src");
const versusDirectory = path.resolve(here, "../versus/public");
const aPlayerProfileDirectory = path.resolve(here, "../A_profile");
const legendaryProfileDirectory = path.resolve(here, "../legendary_profile");
const xPlayerProfileDirectory = path.resolve(here, "../x_profile");
const playerProfileDirectory = path.resolve(process.env.YDL_PLAYER_PROFILE_ROOT ?? path.join(here, "../player_profiles"));
const adminDirectory = path.resolve(here, "../admin/public");
const port = Number(process.env.DEVTOOL_PORT ?? 4310);
const host = process.env.VERSUS_HOST ?? "127.0.0.1";
const publicOnly = process.env.VERSUS_PUBLIC_ONLY === "1";
const environment = process.env.APP_ENV ?? "production";
const environmentLabel = process.env.APP_LABEL ?? "正式服";
const matchEngine = process.env.APP_ENV === "test" && process.env.YDL_MATCH_ENGINE === "v2" ? "v2" : "v1";
const maximumBodyBytes = 18 * 1024 * 1024;
const metricsToken = process.env.YDL_METRICS_TOKEN ?? "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function isLoopback(address = "") {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function sendJson(response, statusCode, value) {
  const payload = Buffer.from(JSON.stringify(value));
  const acceptsGzip = /\bgzip\b/i.test(response.req?.headers?.["accept-encoding"] ?? "");
  const body = acceptsGzip && payload.length >= 1024 ? gzipSync(payload, { level:6 }) : payload;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": body.length,
    "vary": "accept-encoding",
    ...(body !== payload ? { "content-encoding":"gzip" } : {}),
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readBuffer(request, limit = maximumBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/diagnostics/metrics") {
    if (!metricsToken) return sendJson(response, 404, { ok:false, error:"API not found" });
    if (request.headers.authorization !== `Bearer ${metricsToken}`) return sendJson(response, 401, { ok:false, error:"unauthorized" });
    return sendJson(response, 200, { ok:true, metrics:snapshotRuntimeMetrics() });
  }
  if (pathname.startsWith("/api/admin/")) return handleAdminApi(request, response, pathname, readJson, sendJson, readBuffer);
  if (request.method === "GET" && pathname === "/api/versus/config") {
    return sendJson(response, 200, { ok: true, publicOnly, environment, environmentLabel, matchEngine });
  }
  if (publicOnly) {
    if (request.method === "GET" && pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, publicOnly:true, environment, environmentLabel });
    }
    if (pathname === "/api/versus/dev-room" || !pathname.startsWith("/api/versus/")) {
      return sendJson(response, 404, { ok: false, error: "API not found" });
    }
    return handleVersusApi(request, response, pathname, readJson, sendJson);
  }
  if (request.method === "GET" && pathname === "/api/versus-traits") {
    return sendJson(response, 200, { ok: true, traits: VERSUS_TRAIT_CARDS });
  }
  if (pathname.startsWith("/api/versus/")) {
    return handleVersusApi(request, response, pathname, readJson, sendJson);
  }
  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { ok: true, localOnly:true, environment, environmentLabel });
  }
  if (request.method === "GET" && pathname === "/api/state") {
    return sendJson(response, 200, { ok: true, state: await loadDatabase() });
  }
  if (request.method === "POST" && pathname === "/api/state") {
    const body = await readJson(request);
    const state = await saveDatabase(body.state ?? body);
    return sendJson(response, 200, { ok: true, state });
  }
  if (request.method === "POST" && pathname === "/api/reset") {
    const state = await resetDatabase();
    return sendJson(response, 200, { ok: true, state });
  }
  if (request.method === "POST" && pathname === "/api/simulate") {
    const body = await readJson(request);
    const state = await loadDatabase();
    return sendJson(response, 200, { ok: true, result: runSimulation(state, body) });
  }
  return sendJson(response, 404, { ok: false, error: "API not found" });
}

function handleVersusStream(request, response, url) {
  const match = url.pathname.match(/^\/api\/versus\/stream\/([^/]+)$/);
  if (request.method !== "GET" || !match) return false;
  const code = decodeURIComponent(match[1]);
  const authorization = request.headers.authorization ?? "";
  const playerToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  let closed = false;
  let lastPayload = "";
  let interval = null;
  const sendSnapshot = () => {
    if (closed) return;
    try {
      const room = versusRooms.view(versusRooms.getRoom(code), playerToken);
      const payload = JSON.stringify({ ok: true, room });
      if (payload === lastPayload) return;
      lastPayload = payload;
      response.write(`event: room\ndata: ${payload}\n\n`);
    } catch (error) {
      response.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      response.end();
      closed = true;
      if (interval) clearInterval(interval);
    }
  };
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  response.flushHeaders?.();
  response.write("retry: 1500\n\n");
  sendSnapshot();
  interval = setInterval(sendSnapshot, 400);
  request.on("close", () => {
    closed = true;
    if (interval) clearInterval(interval);
  });
  return true;
}

async function serveStatic(response, pathname, searchParams = new URLSearchParams()) {
  if (publicOnly && pathname === "/") {
    response.writeHead(302, { location: "/versus/", "cache-control": "no-store" });
    return response.end();
  }
  const servesGame = pathname === "/game" || pathname.startsWith("/game/");
  const servesVersus = pathname === "/versus" || pathname.startsWith("/versus/");
  const servesAPlayerProfile = pathname.startsWith("/versus/A_profile/");
  const servesLegendaryProfile = pathname.startsWith("/versus/legendary_profile/");
  const servesXPlayerProfile = pathname.startsWith("/versus/x_profile/");
  const servesPlayerProfile = pathname.startsWith("/versus/player_profiles/");
  const servesAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const servesSource = pathname.startsWith("/src/");
  if (publicOnly && !servesVersus && !servesAdmin) return sendJson(response, 404, { ok: false, error: "not found" });
  const directory = servesSource ? sourceDirectory : servesAdmin ? adminDirectory : servesAPlayerProfile ? aPlayerProfileDirectory : servesLegendaryProfile ? legendaryProfileDirectory : servesXPlayerProfile ? xPlayerProfileDirectory : servesPlayerProfile ? playerProfileDirectory : servesVersus ? versusDirectory : servesGame ? gameDirectory : publicDirectory;
  const gamePath = pathname === "/game"
    ? "/"
    : pathname.startsWith("/game/public/")
      ? pathname.slice("/game/public".length)
      : pathname.slice(5);
  const versusPath = pathname.slice("/versus".length) || "/";
  const aPlayerProfilePath = pathname.slice("/versus/A_profile".length) || "/";
  const legendaryProfilePath = pathname.slice("/versus/legendary_profile".length) || "/";
  const xPlayerProfilePath = pathname.slice("/versus/x_profile".length) || "/";
  const playerProfilePath = pathname.slice("/versus/player_profiles".length) || "/";
  const adminPath = pathname.slice("/admin".length) || "/";
  const requestedPath = servesSource ? pathname.slice(4) : servesAdmin ? adminPath : servesAPlayerProfile ? aPlayerProfilePath : servesLegendaryProfile ? legendaryProfilePath : servesXPlayerProfile ? xPlayerProfilePath : servesPlayerProfile ? playerProfilePath : servesVersus ? versusPath : servesGame ? gamePath : pathname;
  const decodedRequestedPath = decodeURIComponent(requestedPath);
  const requested = decodedRequestedPath === "/" ? "/index.html" : decodedRequestedPath;
  const safeRelative = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(directory, "." + path.sep + safeRelative);
  if (filePath !== directory && !filePath.startsWith(directory + path.sep)) {
    return sendJson(response, 403, { ok: false, error: "forbidden" });
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const content = await readFile(filePath);
    const isVersionedPlayerProfile = (
      servesAPlayerProfile
      || servesLegendaryProfile
      || servesXPlayerProfile
      || servesPlayerProfile
    ) && path.extname(filePath).toLowerCase() === ".webp"
      && /^[a-f0-9]{12}$/.test(searchParams.get("v") ?? "");
    const contentType = mimeTypes[path.extname(filePath)] ?? "application/octet-stream";
    const compressible = /^(text\/|application\/json|application\/javascript)/.test(contentType);
    let body = content;
    const headers = {
      "content-type": contentType,
      "cache-control":isVersionedPlayerProfile ? "public, max-age=31536000, immutable" : "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    };
    // 文本类静态资源（js/css/html/json）gzip 传输，香港链路下显著减少页面加载时间
    if (compressible && content.length >= 1024) {
      const gzipped = gzipSync(content);
      if (gzipped.length < content.length) {
        body = gzipped;
        headers["content-encoding"] = "gzip";
      }
    }
    headers["content-length"] = body.length;
    response.writeHead(200, headers);
    response.end(body);
  } catch {
    sendJson(response, 404, { ok: false, error: "file not found" });
  }
}

const server = http.createServer(async (request, response) => {
  if (host === "127.0.0.1" && !isLoopback(request.socket.remoteAddress)) {
    return sendJson(response, 403, { ok: false, error: "local access only" });
  }
  const url = new URL(request.url, "http://localhost");
  const requestStartedAt = performance.now();
  response.once("finish", () => {
    const route = url.pathname.startsWith("/api/versus/stream/")
      ? "/api/versus/stream/:code"
      : url.pathname.startsWith("/api/") ? url.pathname : `static:${path.extname(url.pathname) || "html"}`;
    recordRuntimeMetric(`http.${request.method}.${route}`, performance.now() - requestStartedAt, { error:response.statusCode >= 400 });
  });
  try {
    if (handleVersusStream(request, response, url)) {
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
    } else {
      await serveStatic(response, url.pathname, url.searchParams);
    }
  } catch (error) {
    sendJson(response, error.statusCode ?? 400, {
      ok: false,
      error: error.message,
      details: error.details ?? [],
    });
  }
});

server.listen(port, host, () => {
  console.log("本地足球项目已启动：http://" + host + ":" + port);
  console.log("游戏 Demo：http://" + host + ":" + port + "/game/");
  console.log("好友对战：http://" + host + ":" + port + "/versus/");
  console.log("管理员后台：http://" + host + ":" + port + "/admin/");
  if (publicOnly) console.log("公网试玩安全模式：开放好友对战及需要密码认证的管理员后台。");
  else console.log(host === "127.0.0.1" ? "仅允许本机访问，按 Ctrl+C 停止。" : "已开放网络访问，请仅在可信局域网中使用。");
});

const leagueTimer = setInterval(() => {
  try { measureRuntimeSync("league.tick", () => yellowDogsLeague.tick()); }
  catch (error) { console.error("YellowDogs League 定时任务失败：", error); }
}, 15_000);
leagueTimer.unref();

const liveSliceIntervalMs = Math.max(100, Math.min(2_000, Number(process.env.YDL_LIVE_SLICE_INTERVAL_MS ?? 100)));
const liveSliceTimer = setInterval(() => {
  try { measureRuntimeSync("league.liveSlice", () => yellowDogsLeague.advanceLiveSlice()); }
  catch (error) { console.error("YellowDogs League 直播切片失败：", error); }
}, liveSliceIntervalMs);
liveSliceTimer.unref();
