import { acceptsGzip, createStaticAssetCache } from "./static-asset-cache.js";
import { resolveMatchEngines } from "../src/runtime-config.js";
import { V3_ENGINE_VERSION, V3_ENGINE_PROFILE } from "../versus/v3/model-config.js";
import http from "node:http";
import {handlePreviewAssets} from "../versus/v4-host/preview-assets.js";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { measureRuntimeAsync, measureRuntimeSync, recordRuntimeMetric, snapshotRuntimeMetrics } from "../src/runtime-metrics.js";
// 必须先于 api.js/league-service.js 加载：运营评级覆盖（ydl-content-overrides.json）
// 会把一批退役名宿从 A/B 升级为 S（传奇）。联赛服务单例在 league-service.js
// 模块求值期间即构造并执行 33 人大名单校验，若覆盖未先行应用，这些球员会按
// 静态评级占用名单名额，导致线上超限启动崩溃。
import "../versus/ydl-content-store.js";
import { handleVersusApi } from "../versus/api.js";
import { handleAdminApi } from "../versus/admin-api.js";
import { handleOfflineApi } from "../offline/api.js";
import { versusRooms } from "../versus/room-service.js";
import { yellowDogsLeague, YellowDogsLeagueService, S4_BOND_CATALOG } from "../versus/league-service.js";
import { REAL_PLAYERS, X_PLAYERS } from "../versus/player-pool.js";
import { YDL_TRAIT_CARDS } from "../versus/trait-pool.js";
import { openFormalSchedule } from "../versus/v4-host/formal-schedule.js";
import { OFFLINE_ATTRIBUTE_SETTINGS } from "../versus/offline-attribute-settings.js";
import { openConfiguredStreamHost } from "../versus/v4-host/configured-host.js";

// Explicit server-owned opt-in for read-only shadow archives. The default
// creates no V4 routes, producers or settlement jobs and keeps the formal engine.
const v4StreamHost = await openConfiguredStreamHost(process.env.YDL_V4_STREAM_MANIFEST, {
  rooms:versusRooms, league:yellowDogsLeague,
});
const v4ScheduleEnabled = process.env.YDL_V4_SCHEDULE !== "0";
const hasActiveV4 = () => Boolean(yellowDogsLeague.state.v4LocalLeagueRounds?.active || yellowDogsLeague.state.v4LocalCupEvents?.active);
const scheduledHost = v4ScheduleEnabled || hasActiveV4() ? await openFormalSchedule({
  service:yellowDogsLeague, rooms:versusRooms,
  getCatalog:() => ({ catalog:REAL_PLAYERS, traitCatalog:YDL_TRAIT_CARDS, bondCatalog:S4_BOND_CATALOG }),
  createService(options) {
    // The in-memory constructor initializes the shared X player catalog for an
    // empty league. Keep the active league's configured player attributes.
    const configured = X_PLAYERS.map(player => ({ ...player }));
    try { return new YellowDogsLeagueService(options); }
    finally { X_PLAYERS.forEach((player, index) => Object.assign(player, configured[index])); }
  },
}) : null;
if (v4ScheduleEnabled) {
  yellowDogsLeague.scheduledHost = scheduledHost;
  yellowDogsLeague.actualMatchEngine = "v4";
  versusRooms.actualMatchEngine = "v4";
}

const here = path.dirname(fileURLToPath(import.meta.url));
const versusDirectory = path.resolve(here, "../versus/public");
const aPlayerProfileDirectory = path.resolve(here, "../A_profile");
const legendaryProfileDirectory = path.resolve(here, "../legendary_profile");
const xPlayerProfileDirectory = path.resolve(here, "../x_profile");
const playerProfileDirectory = path.resolve(process.env.YDL_PLAYER_PROFILE_ROOT ?? path.join(here, "../player_profiles"));
const adminDirectory = path.resolve(here, "../admin/public");
const port = Number(process.env.DEVTOOL_PORT ?? 4310);
const host = process.env.VERSUS_HOST ?? "127.0.0.1";
const publicOnly = process.env.VERSUS_PUBLIC_ONLY === "1";
const offlineYdl = process.env.YDL_OFFLINE_MODE === "1";
const environment = process.env.APP_ENV ?? "development";
const environmentLabel = process.env.APP_LABEL ?? (environment === "production" ? "正式服" : "开发环境");
const legacyEngines = resolveMatchEngines();
const matchEngines = v4ScheduleEnabled ? { default:"v4", league:"v4", cup:"v4", friendly:"v4", room:"v4", training:"v4", mirror:"v4", prediction:"v1" } : legacyEngines;
const matchEngine = matchEngines.league;
const maximumBodyBytes = 18 * 1024 * 1024;
const metricsToken = process.env.YDL_METRICS_TOKEN ?? "";
const mirrorWorkerToken = process.env.YDL_MIRROR_WORKER_TOKEN ?? "";

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
  if (offlineYdl && pathname.startsWith("/api/worker/")) {
    return sendJson(response, 404, { ok:false, error:"offline mode does not expose worker APIs" });
  }
  if (offlineYdl && pathname.startsWith("/api/offline/")) {
    return handleOfflineApi(request, response, pathname, readJson, sendJson);
  }
  if (pathname.startsWith("/api/worker/mirror-batches/")) {
    if (request.method !== "POST") return sendJson(response, 405, { ok:false, error:"worker API requires POST" });
    const body = await readJson(request);
    const authorization = String(request.headers.authorization ?? "");
    const presentedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const legacyDirector = Boolean(mirrorWorkerToken && presentedToken === mirrorWorkerToken);
    const registeredNode = legacyDirector ? null : yellowDogsLeague.authenticateMirrorComputeNode(body.workerId, presentedToken);
    if (!legacyDirector && !registeredNode) return sendJson(response, 401, { ok:false, error:"unauthorized worker node" });
    body.workerId = legacyDirector ? "director" : registeredNode.id;
    let result;
    if (pathname === "/api/worker/mirror-batches/heartbeat") result = { worker:yellowDogsLeague.registerDirectorMirrorWorker(body) };
    else if (pathname === "/api/worker/mirror-batches/lease") result = { job:yellowDogsLeague.leaseDirectorMirrorBatchJob(body) };
    else if (pathname === "/api/worker/mirror-batches/progress") result = { job:yellowDogsLeague.updateDirectorMirrorBatchProgress(body) };
    else if (pathname === "/api/worker/mirror-batches/complete") result = yellowDogsLeague.completeDirectorMirrorBatchJob(body);
    else if (pathname === "/api/worker/mirror-batches/fail") result = { job:yellowDogsLeague.failDirectorMirrorBatchJob(body) };
    else return sendJson(response, 404, { ok:false, error:"worker API not found" });
    return sendJson(response, 200, { ok:true, ...result });
  }
  if (pathname.startsWith("/api/admin/")) return handleAdminApi(request, response, pathname, readJson, sendJson, readBuffer);
  if (request.method === "GET" && pathname === "/api/versus/config") {
    return sendJson(response, 200, { ok: true, publicOnly, offlineYdl, environment, environmentLabel, matchEngine, matchEngines, engineVersion:v4ScheduleEnabled ? scheduledHost.engineVersion : matchEngine === "v3" ? V3_ENGINE_VERSION : matchEngine === "v2" ? "2.1.0" : "1", engineProfile:v4ScheduleEnabled ? "v4-spatial" : matchEngine === "v3" ? V3_ENGINE_PROFILE : matchEngine === "v2" ? "v2.1-stable-dynamic.2" : "v1", offlineAttributeSettings:OFFLINE_ATTRIBUTE_SETTINGS });
  }
  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { ok: true, publicOnly, localOnly:isLoopback(host), offlineYdl, environment, environmentLabel, offlineAttributeSettings:OFFLINE_ATTRIBUTE_SETTINGS });
  }
  if (publicOnly && pathname === "/api/versus/dev-room") return sendJson(response, 404, { ok: false, error: "API not found" });
  if (pathname.startsWith("/api/versus/")) {
    return handleVersusApi(request, response, pathname, readJson, sendJson);
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

const staticAssets = createStaticAssetCache();

async function serveStatic(response, pathname, searchParams = new URLSearchParams(), request = response.req) {
  if (!["GET", "HEAD"].includes(request?.method ?? "GET")) { response.writeHead(405, { allow:"GET, HEAD" }); response.end(); return; }
  if (pathname === "/") {
    response.writeHead(302, { location: "/versus/", "cache-control": "no-store" });
    return response.end();
  }
  const servesVersus = pathname === "/versus" || pathname.startsWith("/versus/");
  const servesAPlayerProfile = pathname.startsWith("/versus/A_profile/");
  const servesLegendaryProfile = pathname.startsWith("/versus/legendary_profile/");
  const servesXPlayerProfile = pathname.startsWith("/versus/x_profile/");
  const servesPlayerProfile = pathname.startsWith("/versus/player_profiles/");
  const servesAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  if (!servesVersus && !servesAdmin) return sendJson(response, 404, { ok: false, error: "not found" });
  const directory = servesAdmin ? adminDirectory : servesAPlayerProfile ? aPlayerProfileDirectory : servesLegendaryProfile ? legendaryProfileDirectory : servesXPlayerProfile ? xPlayerProfileDirectory : servesPlayerProfile ? playerProfileDirectory : versusDirectory;
  const versusPath = pathname.slice("/versus".length) || "/";
  const aPlayerProfilePath = pathname.slice("/versus/A_profile".length) || "/";
  const legendaryProfilePath = pathname.slice("/versus/legendary_profile".length) || "/";
  const xPlayerProfilePath = pathname.slice("/versus/x_profile".length) || "/";
  const playerProfilePath = pathname.slice("/versus/player_profiles".length) || "/";
  const adminPath = pathname.slice("/admin".length) || "/";
  const requestedPath = servesAdmin ? adminPath : servesAPlayerProfile ? aPlayerProfilePath : servesLegendaryProfile ? legendaryProfilePath : servesXPlayerProfile ? xPlayerProfilePath : servesPlayerProfile ? playerProfilePath : versusPath;
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
    const hasImmutableVersion = /^[a-f0-9]{12}$/.test(searchParams.get("v") ?? "");
    const isVersionedPlayerProfile = (
      servesAPlayerProfile
      || servesLegendaryProfile
      || servesXPlayerProfile
      || servesPlayerProfile
    ) && path.extname(filePath).toLowerCase() === ".webp"
      && hasImmutableVersion;
    const isVersionedBadgeAsset = servesVersus
      && (
        path.extname(filePath).toLowerCase() === ".webp"
          && /^\/assets\/(?:country|club)-badges\/[a-z0-9-]+\.webp$/.test(versusPath)
        || [".png", ".svg"].includes(path.extname(filePath).toLowerCase())
          && /^\/assets\/system-badges\/ai-team-badge\.(?:png|svg)$/.test(versusPath)
      )
      && hasImmutableVersion;
    const isImmutableAsset = isVersionedPlayerProfile || isVersionedBadgeAsset;
    const contentType = mimeTypes[path.extname(filePath)] ?? "application/octet-stream";
    const compressible = /^(text\/|application\/json|application\/javascript)/.test(contentType);
    const asset = await staticAssets.get(filePath, fileStat, compressible);
    const encoded = acceptsGzip(request?.headers["accept-encoding"]) && asset.gzip;
    const body = encoded || asset.content;
    const etag = `W/"${asset.hash}${encoded ? "-gzip" : ""}"`;
    const headers = {
      "content-type": contentType,
      "cache-control":isImmutableAsset ? "public, max-age=31536000, immutable" : "no-cache",
      etag,
      vary:"Accept-Encoding",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    };
    if (encoded) headers["content-encoding"] = "gzip";
    if (String(request?.headers["if-none-match"] ?? "").split(",").map(s => s.trim()).some(tag => tag === "*" || tag.replace(/^W\//, "") === etag.replace(/^W\//, ""))) {
      response.writeHead(304, headers); response.end(); return;
    }
    headers["content-length"] = body.length;
    response.writeHead(200, headers);
    response.end(request?.method === "HEAD" ? undefined : body);
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
    // Historical replays also decode frames when the live host is offline.
    if (url.pathname === "/v4-preview/v4-stream/codec.js") return await handlePreviewAssets(request, response);
    if (scheduledHost && await scheduledHost.handle(request, response)) return;
    if (v4StreamHost.enabled && await v4StreamHost.handle(request, response)) return;
    if (handleVersusStream(request, response, url)) {
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
    } else {
      await serveStatic(response, url.pathname, url.searchParams, request);
    }
  } catch (error) {
    sendJson(response, error.statusCode ?? 400, {
      ok: false,
      error: error.message,
      errorCode: error.code,
      details: error.details ?? [],
    });
  }
});

server.listen(port, host, () => {
  const listeningPort = server.address().port;
  console.log("YFFM1 已启动：http://" + host + ":" + listeningPort);
  if (offlineYdl) {
    console.log("YFFM1 离线版：http://" + host + ":" + listeningPort + "/versus/");
    console.log("本地管理员后台：http://" + host + ":" + listeningPort + "/admin/");
    console.log("仅允许本机访问；好友对战、计算节点与线上运营接口均未开放。");
  } else {
    console.log("YFFM1 游戏：http://" + host + ":" + listeningPort + "/versus/");
    console.log("管理员后台：http://" + host + ":" + listeningPort + "/admin/");
    if (publicOnly) console.log("公开模式：开放 YFFM1 及需要密码认证的管理员后台。");
    else console.log(host === "127.0.0.1" ? "仅允许本机访问，按 Ctrl+C 停止。" : "已开放网络访问，请仅在可信局域网中使用。");
  }
});

let ticking = false;
const leagueTimer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try { await measureRuntimeAsync("league.tick", () => yellowDogsLeague.tick(v4ScheduleEnabled || hasActiveV4() ? scheduledHost : null)); }
  catch (error) { console.error("YFFM1 定时任务失败：", error); }
  finally { ticking = false; }
}, 15_000);
leagueTimer.unref();

const liveSliceIntervalMs = Math.max(100, Math.min(2_000, Number(process.env.YDL_LIVE_SLICE_INTERVAL_MS ?? 100)));
const liveSliceTimer = setInterval(() => {
  try { measureRuntimeSync("league.liveSlice", () => yellowDogsLeague.advanceLiveSlice()); }
  catch (error) { console.error("YFFM1 直播切片失败：", error); }
}, liveSliceIntervalMs);
liveSliceTimer.unref();
