import { bearerToken, readJsonBody, sendJson } from "./campaign-api-handler.mjs";

export function createAdminApiHandler({ admin, campaign, players } = {}) {
  if (!admin || !players) throw new Error("Admin API requires admin and player library services");
  return async function handleAdminApi(request, response, pathname, url) {
    if (request.method === "POST" && pathname === "/api/admin/login") {
      const body = await readJsonBody(request);
      return sendJson(response, 200, admin.login(body.username, body.password));
    }
    const actor = admin.authenticate(bearerToken(request));
    const requestUrl = new URL(url, "http://localhost");
    if (request.method === "GET" && pathname === "/api/admin/me") return sendJson(response, 200, { profile: admin.publicAdmin(actor) });
    if (request.method === "GET" && pathname === "/api/admin/audit") return sendJson(response, 200, { entries: admin.listAudit(requestUrl.searchParams.get("limit")) });
    if (request.method === "GET" && pathname === "/api/admin/tasks") return sendJson(response, 200, { tasks: admin.listTasks() });
    if (request.method === "GET" && pathname === "/api/admin/player-library") return sendJson(response, 200, players.overview());
    if (request.method === "GET" && pathname === "/api/admin/player-library/players") return sendJson(response, 200, { players: players.listPlayers(Object.fromEntries(requestUrl.searchParams)) });
    if (request.method === "GET" && pathname === "/api/admin/player-library/audit") return sendJson(response, 200, { audit: players.audit() });
    const cardMatch = pathname.match(/^\/api\/admin\/player-library\/cards\/([^/]+)$/);
    if (request.method === "GET" && cardMatch) return sendJson(response, 200, { card: players.getCard(decodeURIComponent(cardMatch[1])) });
    const playerMatch = pathname.match(/^\/api\/admin\/player-library\/players\/([^/]+)$/);
    if (request.method === "GET" && playerMatch) return sendJson(response, 200, { player: players.getPlayer(decodeURIComponent(playerMatch[1])) });
    const body = request.method === "POST" ? await readJsonBody(request, { maximumBytes: pathname.includes("/profiles/") ? 16_000_000 : 4_000_000 }) : {};
    if (request.method === "POST" && pathname === "/api/admin/tasks") return sendJson(response, 200, { task: admin.createTask(actor, body) });
    if (request.method === "POST" && pathname === "/api/admin/tasks/complete") return sendJson(response, 200, { task: admin.completeTask(actor, body.taskId) });
    if (request.method === "POST" && pathname === "/api/admin/players/gold") return sendJson(response, 200, { wallet: admin.adjustPlayerGold(actor, body.accountId, body.delta, body.reason) });
    if (request.method === "POST" && playerMatch) {
      admin.requireRole(actor, ["content", "superadmin"]); const id = decodeURIComponent(playerMatch[1]); const before = players.getPlayer(id);
      const player = before.status === "draft" ? players.updateDraft(id, body) : players.updatePlayer(id, body);
      admin.audit(actor, "player-library.player.update", { playerId:id, before:{ name:before.name, overall:before.overall, grade:before.grade }, after:{ name:player.name, overall:player.overall, grade:player.grade } });
      return sendJson(response, 200, { player });
    }
    if (request.method === "POST" && pathname === "/api/admin/player-library/drafts") {
      admin.requireRole(actor, ["content", "superadmin"]); const created = Array.isArray(body.rows) ? players.createDrafts(body.rows, body.batchId) : [players.createDraft(body)];
      admin.audit(actor, "player-library.draft.create", { playerIds:created.map((player) => player.id), batchId:body.batchId ?? null }); return sendJson(response, 201, { players:created });
    }
    if (request.method === "POST" && pathname === "/api/admin/player-library/publish") {
      admin.requireRole(actor, ["content", "superadmin"]); const published = players.publishDrafts(body.ids);
      admin.audit(actor, "player-library.draft.publish", { playerIds:published.map((player) => player.id) }); return sendJson(response, 200, { players:published });
    }
    if (request.method === "POST" && pathname === "/api/admin/player-library/batches") {
      admin.requireRole(actor, ["content", "superadmin"]); const batch = players.createBatch(body);
      admin.audit(actor, "player-library.batch.create", { batchId:batch.id, name:batch.name }); return sendJson(response, 201, { batch });
    }
    const profileMatch = pathname.match(/^\/api\/admin\/player-library\/profiles\/([^/]+)$/);
    if (request.method === "POST" && profileMatch) {
      admin.requireRole(actor, ["content", "superadmin"]); const playerId = decodeURIComponent(profileMatch[1]); const profile = players.saveProfile(playerId, body);
      admin.audit(actor, "player-library.profile.save", { playerId, fileName:profile.fileName, x:profile.x, y:profile.y, width:profile.width }); return sendJson(response, 200, { profile });
    }
    return sendJson(response, 404, { error: "Admin 接口不存在" });
  };
}
