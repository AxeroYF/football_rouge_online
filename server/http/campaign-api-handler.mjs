export function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

export async function readJsonBody(request, { maximumBytes = 1_000_000 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw Object.assign(new Error("请求内容过大"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("请求格式无效"), { statusCode: 400 });
  }
}

export function bearerToken(request) {
  const header = String(request.headers.authorization ?? "");
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function createCampaignApiHandler({ campaign } = {}) {
  if (!campaign) throw new Error("Campaign API handler requires a campaign service");
  return async function handleCampaignApi(request, response, pathname, url) {
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    if (request.method === "POST" && pathname === "/api/campaign/register") {
      return sendJson(response, 200, campaign.register(body.nickname, body.password));
    }
    if (request.method === "POST" && pathname === "/api/campaign/login") {
      return sendJson(response, 200, campaign.login(body.nickname, body.password));
    }
    const account = campaign.authenticate(bearerToken(request));
    if (request.method === "GET" && pathname === "/api/campaign/state") {
      return sendJson(response, 200, {
        profile: { id: account.id, nickname: account.nickname },
        state: campaign.state(account),
      });
    }
    if (request.method === "GET" && pathname === "/api/campaign/player-directory") {
      return sendJson(response, 200, { playerDirectory: campaign.playerDirectory(account) });
    }
    if (request.method === "GET" && pathname === "/api/campaign/territory/intel") {
      return sendJson(response, 200, campaign.territoryIntel(account, new URL(url, "http://localhost").searchParams.get("id")));
    }
    if (request.method === "GET" && pathname === "/api/campaign/territory/challenge") {
      return sendJson(response, 200, campaign.challengeStatus(account, new URL(url, "http://localhost").searchParams.get("id")));
    }
    if (request.method === "GET" && pathname === "/api/campaign/buildings/catalog") {
      return sendJson(response, 200, { catalog: campaign.buildingCatalog() });
    }
    if (request.method === "GET" && pathname === "/api/campaign/territory/buildings") {
      return sendJson(response, 200, campaign.territoryBuildings(account, new URL(url, "http://localhost").searchParams.get("id")));
    }
    if (request.method === "POST" && pathname === "/api/campaign/draft/start") {
      return sendJson(response, 200, { state: campaign.beginDraft(account, body.teamName) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/draft/choose") {
      return sendJson(response, 200, { state: campaign.choose(account, body.playerId) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/home/claim") {
      return sendJson(response, 200, { state: campaign.chooseHome(account, body.territoryId) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/tactics") {
      return sendJson(response, 200, { state: campaign.saveTactics(account, body) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/maritime/routes") {
      return sendJson(response, 200, campaign.maritimeRoutes(account, body.sourceTerritoryId, body.sourcePoint));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/challenge") {
      return sendJson(response, 200, campaign.challengeTerritory(account, body.territoryId, { maritimeRoute: body.maritimeRoute }));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/challenge/complete") {
      return sendJson(response, 200, campaign.completeTerritoryChallenge(account, body.challengeId));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/buildings/build") {
      return sendJson(response, 200, campaign.buildTerritoryBuilding(account, body.territoryId, body.type));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/buildings/upgrade") {
      return sendJson(response, 200, campaign.upgradeTerritoryBuilding(account, body.territoryId, body.buildingId));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/buildings/rename") {
      return sendJson(response, 200, campaign.renameTerritoryBuilding(account, body.territoryId, body.buildingId, body.name));
    }
    return sendJson(response, 404, { error: "接口不存在" });
  };
}
