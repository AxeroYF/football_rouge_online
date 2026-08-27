import { offlineTeamCatalog, selectOfflineTeam } from "./local-identity-service.js";

export async function handleOfflineApi(request, response, pathname, readJson, sendJson) {
  try {
    if (request.method === "GET" && pathname === "/api/offline/teams") {
      return sendJson(response, 200, { ok:true, ...offlineTeamCatalog() });
    }
    if (request.method === "POST" && pathname === "/api/offline/select-team") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, ...selectOfflineTeam(body.teamId) });
    }
    return sendJson(response, 404, { ok:false, error:"offline API not found" });
  } catch (error) {
    return sendJson(response, error.statusCode ?? 400, { ok:false, error:error.message });
  }
}
