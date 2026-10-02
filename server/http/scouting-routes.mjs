import {sendJson} from "./json.mjs";
import {UNHANDLED} from "./route-result.mjs";

export function scoutingRoutes({campaign, account, request, response, pathname, url, body}) {
    if (request.method === "GET" && pathname === "/api/campaign/scouting/unit") {
      return sendJson(response, 200, campaign.scoutUnitDetails(account, new URL(url, "http://localhost").searchParams.get("scoutId")));
    }
    if (request.method === "GET" && pathname === "/api/campaign/scouting/task") {
      return sendJson(response, 200, campaign.scoutingTaskDetails(account, new URL(url, "http://localhost").searchParams.get("taskId")));
    }
    if (request.method === "POST" && pathname === "/api/campaign/scouting/rename") return sendJson(response, 200, campaign.renameScout(account, body));
    if (request.method === "POST" && pathname === "/api/campaign/scouting/recruit") return sendJson(response, 200, campaign.recruitScouts(account, body));
    if (request.method === "POST" && pathname === "/api/campaign/scouting/estimate") return sendJson(response, 200, campaign.estimateScoutMove(account, body));
    if (request.method === "POST" && pathname === "/api/campaign/scouting/move") return sendJson(response, 200, campaign.moveScout(account, body));
    if (request.method === "POST" && pathname === "/api/campaign/scouting/cancel-move") return sendJson(response, 200, campaign.cancelScoutMove(account, body.scoutId, body.movementId,{compact:body.compact===true}));
    if (request.method === "GET" && pathname === "/api/campaign/scouting/center") {
      const params = new URL(url, "http://localhost").searchParams;
      return sendJson(response, 200, campaign.scoutingDetails(account, params.get("territoryId"), params.get("buildingId")));
    }
    if (request.method === "POST" && pathname === "/api/campaign/scouting/start") {
      return sendJson(response, 200, campaign.startScouting(account, body));
    }
    if(request.method==="POST"&&pathname==="/api/campaign/scouting/claim-queue")return sendJson(response,200,campaign.claimScoutingQueue(account,body.taskId,body.cardIds,{compact:body.view==='compact'}));
    if (request.method === "POST" && pathname === "/api/campaign/scouting/choose") {
      return sendJson(response, 200, campaign.chooseScoutingPlayer(account, body.taskId, body.cardId,{compact:body.view==='compact'}));
    }
  return UNHANDLED;
}
