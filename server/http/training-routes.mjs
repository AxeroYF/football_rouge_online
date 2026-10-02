// Returns null only for unmatched routes. Responses are sent by the HTTP adapter.
export function trainingRoute({campaign, account, method, pathname, url, body}) {
  if (method === "GET" && pathname === "/api/campaign/training/center") {
    const params = new URL(url, "http://localhost").searchParams;
    return {value: campaign.trainingDetails(account, params.get("territoryId"), params.get("buildingId"))};
  }
  if (method === "POST" && pathname === "/api/campaign/training/finish") {
    return {value: campaign.finishTraining(account, body.taskId)};
  }
  if (method === "POST" && pathname === "/api/campaign/training/cancel") {
    return {value: campaign.cancelTraining(account, body.taskId)};
  }
  if (method === "POST" && pathname === "/api/campaign/training/start") {
    return {value: campaign.startTraining(account, body)};
  }
  return null;
}
