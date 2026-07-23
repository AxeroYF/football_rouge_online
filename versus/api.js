import { versusRooms } from "./room-service.js";

function bearerToken(request) {
  const value = request.headers.authorization ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export async function handleVersusApi(request, response, pathname, readJson, sendJson) {
  const body = request.method === "POST" ? await readJson(request) : {};
  const code = body.code ?? pathname.split("/")[4];
  const playerToken = bearerToken(request) || body.token;
  let result;
  if (request.method === "GET" && pathname === "/api/versus/broadcasts") result = { broadcasts: versusRooms.broadcasts() };
  else if (request.method === "POST" && pathname === "/api/versus/watch") result = versusRooms.watch(body.code, body.name, body.spectatorToken);
  else if (request.method === "GET" && /^\/api\/versus\/watch\/[^/]+$/.test(pathname)) result = { broadcast: versusRooms.watchView(code, playerToken) };
  else if (request.method === "POST" && pathname.endsWith("/leave-watch")) result = versusRooms.leaveWatch(code, playerToken);
  else if (request.method === "POST" && pathname === "/api/versus/identity") result = versusRooms.bindAccount(body.playerId, body.accountToken, body.name);
  else if (request.method === "POST" && pathname === "/api/versus/profile") result = { profile: versusRooms.profile(body.playerId, body.accountToken) };
  else if (request.method === "POST" && pathname === "/api/versus/profile/match") result = { match: versusRooms.profileMatch(body.playerId, body.accountToken, body.matchId) };
  else if (request.method === "POST" && pathname === "/api/versus/rooms") result = versusRooms.create(body.name, body.customCode, body.playerId, body.accountToken, body.competitionMode);
  else if (request.method === "POST" && pathname === "/api/versus/dev-room") result = versusRooms.createDeveloperRoom(body.name, Boolean(body.quickStart));
  else if (request.method === "POST" && pathname === "/api/versus/join") result = versusRooms.join(body.code, body.name, body.playerId, body.accountToken);
  else if (request.method === "GET" && /^\/api\/versus\/rooms\/[^/]+$/.test(pathname)) result = { room: versusRooms.view(versusRooms.getRoom(code), playerToken) };
  else if (request.method === "POST" && pathname.endsWith("/draw-player")) result = { room: versusRooms.drawPlayers(code, playerToken, body.pool) };
  else if (request.method === "POST" && pathname.endsWith("/choose-player")) result = { room: versusRooms.choosePlayer(code, playerToken, body.playerId) };
  else if (request.method === "POST" && pathname.endsWith("/import-lineup")) result = { room: versusRooms.importLineup(code, playerToken, body.seed) };
  else if (request.method === "POST" && pathname.endsWith("/export-lineup")) result = versusRooms.exportLineup(code, playerToken);
  else if (request.method === "POST" && pathname.endsWith("/rematch")) result = { room: versusRooms.requestRematch(code, playerToken) };
  else if (request.method === "POST" && pathname.endsWith("/choose-trait")) result = { room: versusRooms.chooseTrait(code, playerToken, body.traitId) };
  else if (request.method === "POST" && pathname.endsWith("/pause")) result = { room: versusRooms.requestPause(code, playerToken) };
  else if (request.method === "POST" && pathname.endsWith("/live-tactics")) result = { room: versusRooms.saveLiveTactics(code, playerToken, body) };
  else if (request.method === "POST" && pathname.endsWith("/resume")) result = { room: versusRooms.resumeMatch(code, playerToken) };
  else if (request.method === "POST" && pathname.endsWith("/tactics")) result = { room: versusRooms.saveTactics(code, playerToken, body) };
  else return sendJson(response, 404, { ok: false, error: "versus API not found" });
  return sendJson(response, 200, { ok: true, ...result });
}
