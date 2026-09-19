import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { CampaignService } from "./campaign-service.mjs";
import { createMaritimeRoutePlanner } from "./maritime-routes.mjs";
import { createCampaignApiHandler, sendJson } from "./server/http/campaign-api-handler.mjs";
import { createChallengeScheduler } from "./server/scheduler/challenge-scheduler.mjs";
import { AdminService } from "./server/application/admin-service.mjs";
import { createAdminApiHandler } from "./server/http/admin-api-handler.mjs";
import { PlayerLibraryService } from "./server/application/player-library-service.mjs";
import { createStaticHandler } from "./server/http/static-handler.mjs";
import { campaignRequestPath, campaignEntryRedirect } from "./server/http/public-entry.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4370);
const host = process.env.HOST ?? "127.0.0.1";
const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
if (process.env.NODE_ENV === "production" && String(process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "").length < 16) {
  throw new Error("Production requires ADMIN_BOOTSTRAP_PASSWORD with at least 16 characters");
}
const catalog = JSON.parse(await readFile(path.join(root, "assets", "data", "s4-player-catalog.json"), "utf8"));
const territoryIndex = JSON.parse(await readFile(path.join(root, "assets", "data", "territory-index.json"), "utf8"));
const territoryGeoJson = JSON.parse(await readFile(path.join(root, "assets", "data", "campaign-territories.geojson"), "utf8"));
const coastlineData = JSON.parse(await readFile(path.join(root, "assets", "data", "campaign-coastlines.json"), "utf8"));
const maritimePlanner = createMaritimeRoutePlanner({ coastlineData, territoryGeoJson, territoryIndex });
const territoryResources = JSON.parse(await readFile(path.join(root, "assets", "data", "territory-resources.json"), "utf8"));
const campaign = new CampaignService({ developmentTools: process.env.NODE_ENV !== 'production' && (process.env.CAMPAIGN_DEV_TOOLS === '1' || ['127.0.0.1','localhost','::1'].includes(host)), dataPath: path.join(dataDirectory, "campaign-accounts.json"), catalog, territoryIndex, territoryGeoJson, territoryResources, maritimePlanner });
const handleCampaignApi = createCampaignApiHandler({ campaign });
const wonderCatalog = JSON.parse(await readFile(path.join(root, "assets", "wonders", "catalog.json"), "utf8"));
const wonderProposals = JSON.parse(await readFile(path.join(root, "shared/config/wonder-design-drafts.json"), "utf8")).items;
const admin = new AdminService({ wonderProposals, playerCatalog: catalog, dataPath: path.join(dataDirectory, "admin-state.json"), campaign, wonderCatalog });
campaign.wonders.getConstruction = id => { const item = wonderCatalog.items.find(w => w.assetId === id); return item ? admin.wonderView(item).construction : null; };
const playerLibrary = new PlayerLibraryService({ root, catalog, campaign, dataDirectory });
const handleAdminApi = createAdminApiHandler({ admin, campaign, players: playerLibrary });
const handleStatic = createStaticHandler(root);

const server = http.createServer(async (request, response) => {
  let pathname;
  try { pathname = campaignRequestPath(new URL(request.url ?? "/", "http://localhost").pathname); }
  catch { response.writeHead(400); response.end("Bad request"); return; }
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "same-origin");
  try {
    if (pathname === "/healthz" && ["GET", "HEAD"].includes(request.method)) {
      response.writeHead(200, { "content-type":"application/json", "cache-control":"no-store" });
      response.end(request.method === "HEAD" ? undefined : JSON.stringify({ status:"ok", version:"0.1.0" }));
      return;
    }
    if (pathname.startsWith("/api/campaign/")) {
      await handleCampaignApi(request, response, pathname, request.url ?? pathname);
      return;
    }
    if (pathname.startsWith("/api/admin/")) {
      await handleAdminApi(request, response, pathname, request.url ?? pathname);
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { allow:"GET, HEAD" }); response.end("Method not allowed"); return;
    }
    const redirect = campaignEntryRedirect(pathname);
    if (redirect) {
      response.writeHead(308, { location:redirect, "cache-control":"no-store" }); response.end(); return;
    }
    await handleStatic(request, response);
  } catch (error) {
    if (response.headersSent) { response.destroy(); return; }
    const status = Number(error.statusCode ?? 400);
    sendJson(response, status, { error: error.message || "请求失败" });
  }
});

const scheduler = createChallengeScheduler({ campaign });
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 500;
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  try { scheduler.stop(); campaign.save(); } catch (error) { console.error("Final save failed:", error.message); process.exitCode = 1; }
  server.close(() => process.exit(process.exitCode ?? 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
server.listen(port, host, () => {
  const listeningPort = server.address().port;
  console.log(`YellowDogs Chronicles V0.1 game: http://${host}:${listeningPort}/versus/`);
  console.log(`YellowDogs Chronicles admin: http://${host}:${listeningPort}/admin`);
});
