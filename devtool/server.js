import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDatabase, resetDatabase, saveDatabase } from "./store.js";
import { runSimulation } from "./simulation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(here, "public");
const gameDirectory = path.resolve(here, "../game/public");
const sourceDirectory = path.resolve(here, "../src");
const port = Number(process.env.DEVTOOL_PORT ?? 4310);
const host = "127.0.0.1";
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

async function serveStatic(response, pathname) {
  const servesGame = pathname === "/game" || pathname.startsWith("/game/");
  const servesSource = pathname.startsWith("/src/");
  const directory = servesSource ? sourceDirectory : servesGame ? gameDirectory : publicDirectory;
  const gamePath = pathname === "/game"
    ? "/"
    : pathname.startsWith("/game/public/")
      ? pathname.slice("/game/public".length)
      : pathname.slice(5);
  const requestedPath = servesSource ? pathname.slice(4) : servesGame ? gamePath : pathname;
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
  if (!isLoopback(request.socket.remoteAddress)) {
    return sendJson(response, 403, { ok: false, error: "local access only" });
  }
  const url = new URL(request.url, "http://localhost");
  try {
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
  console.log("仅允许本机访问，按 Ctrl+C 停止。");
});
