import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDatabase, resetDatabase, saveDatabase } from "./store.js";
import { runSimulation } from "./simulation.js";
import { handleVersusApi } from "../versus/api.js";
import { handleAdminApi } from "../versus/admin-api.js";
import { VERSUS_TRAIT_CARDS } from "../versus/trait-pool.js";
import { versusRooms } from "../versus/room-service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(here, "public");
const gameDirectory = path.resolve(here, "../game/public");
const sourceDirectory = path.resolve(here, "../src");
const versusDirectory = path.resolve(here, "../versus/public");
const adminDirectory = path.resolve(here, "../admin/public");
const port = Number(process.env.DEVTOOL_PORT ?? 4310);
const host = process.env.VERSUS_HOST ?? "127.0.0.1";
const publicOnly = process.env.VERSUS_PUBLIC_ONLY === "1";
const maximumBodyBytes = 8 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function isLoopback(address = "") {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
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

async function handleApi(request, response, pathname) {
  if (pathname.startsWith("/api/admin/")) return handleAdminApi(request, response, pathname, readJson, sendJson);
  if (request.method === "GET" && pathname === "/api/versus/config") {
    return sendJson(response, 200, { ok: true, publicOnly });
  }
  if (publicOnly) {
    if (request.method === "GET" && pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, publicOnly: true });
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
    return sendJson(response, 200, { ok: true, localOnly: true });
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

async function serveStatic(response, pathname) {
  if (publicOnly && pathname === "/") {
    response.writeHead(302, { location: "/versus/", "cache-control": "no-store" });
    return response.end();
  }
  const servesGame = pathname === "/game" || pathname.startsWith("/game/");
  const servesVersus = pathname === "/versus" || pathname.startsWith("/versus/");
  const servesAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  const servesSource = pathname.startsWith("/src/");
  if (publicOnly && !servesVersus && !servesAdmin) return sendJson(response, 404, { ok: false, error: "not found" });
  const directory = servesSource ? sourceDirectory : servesAdmin ? adminDirectory : servesVersus ? versusDirectory : servesGame ? gameDirectory : publicDirectory;
  const gamePath = pathname === "/game"
    ? "/"
    : pathname.startsWith("/game/public/")
      ? pathname.slice("/game/public".length)
      : pathname.slice(5);
  const versusPath = pathname.slice("/versus".length) || "/";
  const adminPath = pathname.slice("/admin".length) || "/";
  const requestedPath = servesSource ? pathname.slice(4) : servesAdmin ? adminPath : servesVersus ? versusPath : servesGame ? gamePath : pathname;
  const requested = requestedPath === "/" ? "/index.html" : requestedPath;
  const safeRelative = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(directory, "." + path.sep + safeRelative);
  if (filePath !== directory && !filePath.startsWith(directory + path.sep)) {
    return sendJson(response, 403, { ok: false, error: "forbidden" });
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { ok: false, error: "file not found" });
  }
}

const server = http.createServer(async (request, response) => {
  if (host === "127.0.0.1" && !isLoopback(request.socket.remoteAddress)) {
    return sendJson(response, 403, { ok: false, error: "local access only" });
  }
  const url = new URL(request.url, "http://localhost");
  try {
    if (handleVersusStream(request, response, url)) {
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
    } else {
      await serveStatic(response, url.pathname);
    }
  } catch (error) {
    sendJson(response, 400, {
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
