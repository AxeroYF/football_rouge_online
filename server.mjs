import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";
import { CampaignService } from "./campaign-service.mjs";
import { createMaritimeRoutePlanner } from "./maritime-routes.mjs";
import { createCampaignApiHandler, sendJson } from "./server/http/campaign-api-handler.mjs";
import { createChallengeScheduler } from "./server/scheduler/challenge-scheduler.mjs";
import { AdminService } from "./server/application/admin-service.mjs";
import { createAdminApiHandler } from "./server/http/admin-api-handler.mjs";
import { PlayerLibraryService } from "./server/application/player-library-service.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4370);
const host = process.env.HOST ?? "127.0.0.1";
const catalog = JSON.parse(await readFile(path.join(root, "assets", "data", "s4-player-catalog.json"), "utf8"));
const territoryIndex = JSON.parse(await readFile(path.join(root, "assets", "data", "territory-index.json"), "utf8"));
const territoryGeoJson = JSON.parse(await readFile(path.join(root, "assets", "data", "campaign-territories.geojson"), "utf8"));
const coastlineData = JSON.parse(await readFile(path.join(root, "assets", "data", "campaign-coastlines.json"), "utf8"));
const maritimePlanner = createMaritimeRoutePlanner({ coastlineData, territoryGeoJson, territoryIndex });
const campaign = new CampaignService({ dataPath: path.join(root, "data", "campaign-accounts.json"), catalog, territoryIndex, maritimePlanner });
const handleCampaignApi = createCampaignApiHandler({ campaign });
const admin = new AdminService({ dataPath: path.join(root, "data", "admin-state.json"), campaign });
const playerLibrary = new PlayerLibraryService({ root, catalog, campaign });
const handleAdminApi = createAdminApiHandler({ admin, campaign, players: playerLibrary });
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".geojson", "application/geo+json; charset=utf-8"],
  [".webp", "image/webp"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const entrypoints = new Map([
    ["/game", "index.html"],
    ["/game/", "index.html"],
    ["/admin", "admin-v2.html"],
    ["/admin/", "admin-v2.html"],
    ["/admin.html", "admin-v2.html"],
  ]);
  const requested = entrypoints.get(pathname) ?? pathname.replace(/^\/+/, "");
  const target = path.resolve(root, requested);
  return target.startsWith(root + path.sep) || target === root ? target : null;
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  try {
    if (pathname.startsWith("/api/campaign/")) {
      await handleCampaignApi(request, response, pathname, request.url ?? pathname);
      return;
    }
    if (pathname.startsWith("/api/admin/")) {
      await handleAdminApi(request, response, pathname, request.url ?? pathname);
      return;
    }
    if (pathname === "/") {
      response.writeHead(302, { location: "/game", "cache-control": "no-store" });
      response.end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }
    const target = resolveRequestPath(request.url ?? "/");
    if (!target) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }
    const details = await stat(target);
    const filePath = details.isDirectory() ? path.join(target, "index.html") : target;
    const body = await readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "content-type": mimeTypes.get(extension) ?? "application/octet-stream",
      "cache-control": [".html", ".js", ".mjs", ".css"].includes(extension) ? "no-cache" : "public, max-age=604800, immutable",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (pathname.startsWith("/api/campaign/") || pathname.startsWith("/api/admin/")) {
      sendJson(response, Number(error.statusCode ?? 400), { error: error.message || "请求失败" });
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

createChallengeScheduler({ campaign });

server.listen(port, host, () => {
  console.log(`YellowDogs Chronicles game: http://${host}:${port}/game`);
  console.log(`YellowDogs Chronicles admin: http://${host}:${port}/admin`);
});
