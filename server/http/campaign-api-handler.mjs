import { campaignTacticalPreview } from "../application/tactical-preview.mjs";
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
    if(pathname==='/api/campaign/airport'&&request.method==='POST'){
      if(!account.setupComplete)throw Object.assign(Error('请先建队'),{statusCode:403});campaign.save();
      if(body.action==='view')return sendJson(response,200,{view:campaign.airports.view(account,body.territoryId)});
      if(body.action==='quote')return sendJson(response,200,{quote:campaign.airports.quote(account,body)});
      if(body.action==='move'){const result=campaign.airports.move(account,body);return sendJson(response,200,{result,state:campaign.state(account)});}
      throw Object.assign(Error('未知机场操作'),{statusCode:400});
    }
    if(pathname==='/api/campaign/raids'&&['GET','POST'].includes(request.method)){
      if(!account.setupComplete)throw Object.assign(Error('请先完成建队'),{statusCode:403});
      if(request.method==='GET'){campaign.eliteRaids.ensureDay();return sendJson(response,200,{activity:campaign.eliteRaids.view(account,{detail:true}),view:campaign.eliteRaids.armyView(account)});}
      if(body.action==='presence'){campaign.eliteRaids.touch(account,{foreground:true});return sendJson(response,200,{ok:true});}
      if(body.action==='dismiss'){account.raidNoticeDay=campaign.eliteRaids.day()?.id;campaign.save();return sendJson(response,200,{ok:true});}
      if(body.action==='preview')return sendJson(response,200,{tacticalShapePreview:campaign.eliteRaids.preview(account,body)});
      const result=campaign.eliteRaids.mutate(account,body);campaign.eliteRaids.touch(account,{foreground:true});return sendJson(response,200,{result,activity:campaign.eliteRaids.view(account,{detail:true}),view:campaign.eliteRaids.armyView(account),state:campaign.state(account)});
    }
    if(request.method==='GET'&&pathname==='/api/campaign/raids/match'){if(!account.setupComplete)throw Object.assign(Error('请先完成建队'),{statusCode:403});return sendJson(response,200,campaign.eliteRaids.snapshot(account,new URL(url,'http://localhost').searchParams.get('id')));}
    if(request.method==='POST'&&!['estimate','preview','routes','read','read-news'].includes(body.action))response.once?.('finish',()=>{if(response.statusCode>=200&&response.statusCode<300)campaign.eliteRaids?.touch(account,{foreground:true});});
    if(pathname==='/api/campaign/coalition'&&['GET','POST'].includes(request.method)) {
      if(request.method==='GET')return sendJson(response,200,{view:campaign.coalitions.view(account)});
      if(body.action==='estimate'){campaign.save();const army=campaign.coalitions.require(account,body.armyId);campaign.coalitions.command(account,army);return sendJson(response,200,{estimate:campaign.coalitions.estimate(army,body)});}
      if(body.action==='preview')return sendJson(response,200,{tacticalShapePreview:campaign.coalitions.preview(account,body)});
      if(body.action==='routes'){const army=campaign.coalitions.require(account,body.armyId);campaign.coalitions.command(account,army);const routes=campaign.coalitions.routes(army,body.beneficiaryId,body.sourcePoint);campaign.fog.survey(account,campaign.world,routes,{coalitionId:army.id});return sendJson(response,200,{...routes,state:campaign.state(account)});}
      const result=campaign.coalitions.mutate(account,body);return sendJson(response,200,{result,view:campaign.coalitions.view(account),state:campaign.state(account)});
    }
    if(pathname==='/api/campaign/oil'&&['GET','POST'].includes(request.method)){
      campaign.save();
      const result=request.method==='POST'?campaign.oil.mutate(account,body):null;
      return sendJson(response,200,{result,oil:campaign.oil.market(account),state:campaign.state(account)});
    }
    if(request.method==='GET'&&pathname==='/api/campaign/players')return sendJson(response,200,{interactions:campaign.diplomacy.summary(account)});
    if(request.method==='GET'&&pathname==='/api/campaign/interactions')return sendJson(response,200,{view:campaign.diplomacy.details(account,new URL(url,'http://localhost').searchParams.get('playerId'))});
    if(request.method==='GET'&&pathname==='/api/campaign/interactions/match')return sendJson(response,200,campaign.diplomacy.snapshot(account,new URL(url,'http://localhost').searchParams.get('id')));
    if(request.method==='POST'&&pathname==='/api/campaign/interactions') {
      if(['read-news','read'].includes(body.action))return sendJson(response,200,{...campaign.diplomacy.mutate(account,body),acknowledged:true});
      campaign.settleDueChallenges();
      const result=campaign.diplomacy.mutate(account,body);
      return sendJson(response,200,{...result,view:campaign.diplomacy.details(account,body.targetId),state:campaign.state(account)});
    }

    if(request.method==='GET'&&pathname==='/api/campaign/elite')return sendJson(response,200,{elite:campaign.eliteChallenges.view(account,new URL(url,'http://localhost').searchParams.get('clubId'))});
    if(request.method==='GET'&&pathname==='/api/campaign/elite/match')return sendJson(response,200,campaign.eliteChallenges.snapshot(account,new URL(url,'http://localhost').searchParams.get('id')));
    if(request.method==='POST'&&pathname==='/api/campaign/elite/begin'){const result=campaign.eliteChallenges.begin(account,body);return sendJson(response,200,{...result,state:campaign.state(account),elite:campaign.eliteChallenges.view(account,body.clubId)});}
    if(request.method==='POST'&&pathname==='/api/campaign/elite/claim'){const result=campaign.eliteChallenges.claim(account,body);return sendJson(response,200,{...result,state:campaign.state(account),elite:campaign.eliteChallenges.view(account,body.clubId)});}

    if(request.method==='GET'&&pathname==='/api/campaign/shop')return sendJson(response,200,campaign.shopView(account));
    if(request.method==='POST'&&pathname==='/api/campaign/shop/buy')return sendJson(response,200,campaign.buyShop(account,body));
    if (request.method === "GET" && pathname === "/api/campaign/wonders") return sendJson(response,200,campaign.wonderPreview(account));
    if (request.method === 'POST' && pathname === '/api/campaign/resources/fans/preference') return sendJson(response,200,campaign.setFanPreference(account,body.preference));
    if (request.method === 'POST' && pathname === '/api/campaign/development/fog') return sendJson(response,200,campaign.setDevelopmentFog(account,body.enabled));
    if (request.method === 'POST' && pathname === '/api/campaign/rewards/research') return sendJson(response,200,campaign.assignNeutralResearch(account,body));
    if (request.method === 'POST' && pathname === '/api/campaign/rewards/production') return sendJson(response,200,campaign.assignNeutralProduction(account,body));
    if (request.method === "GET" && pathname === "/api/campaign/cards") return sendJson(response, 200, campaign.cardManagementDetails(account));
    if (request.method === "POST" && pathname === "/api/campaign/cards/preview") return sendJson(response, 200, campaign.previewCardManagement(account, body));
    const cardAction = { "/api/campaign/cards/recycle": "recycle", "/api/campaign/cards/trade-up": "trade-up", "/api/campaign/cards/list": "list", "/api/campaign/cards/buy": "buy", "/api/campaign/cards/cancel": "cancel" }[pathname];
    if (request.method === "POST" && cardAction) return sendJson(response, 200, campaign.mutateCardManagement(account, cardAction, body));
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
    if (request.method === "GET" && pathname === "/api/campaign/enhancement") {
      return sendJson(response, 200, campaign.enhancementDetails(account));
    }
    const enhancementAction = { "/api/campaign/enhancement/enhance": "single", "/api/campaign/enhancement/batch": "batch", "/api/campaign/enhancement/trait": "trait" }[pathname];
    if (request.method === "POST" && enhancementAction) {
      return sendJson(response, 200, campaign.mutateEnhancement(account, enhancementAction, body));
    }
    if (request.method === "GET" && pathname === "/api/campaign/training/center") {
      const params = new URL(url, "http://localhost").searchParams;
      return sendJson(response, 200, campaign.trainingDetails(account, params.get("territoryId"), params.get("buildingId")));
    }
    if (request.method === "POST" && pathname === "/api/campaign/training/finish") {
      return sendJson(response, 200, campaign.finishTraining(account, body.taskId));
    }
    if (request.method === "POST" && pathname === "/api/campaign/training/cancel") {
      return sendJson(response, 200, campaign.cancelTraining(account, body.taskId));
    }
    if (request.method === "POST" && pathname === "/api/campaign/training/start") {
      return sendJson(response, 200, campaign.startTraining(account, body));
    }
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
    if (request.method === "POST" && pathname === "/api/campaign/scouting/cancel-move") return sendJson(response, 200, campaign.cancelScoutMove(account, body.scoutId, body.movementId));
    if (request.method === "GET" && pathname === "/api/campaign/scouting/center") {
      const params = new URL(url, "http://localhost").searchParams;
      return sendJson(response, 200, campaign.scoutingDetails(account, params.get("territoryId"), params.get("buildingId")));
    }
    if (request.method === "POST" && pathname === "/api/campaign/scouting/start") {
      return sendJson(response, 200, campaign.startScouting(account, body));
    }
    if(request.method==="POST"&&pathname==="/api/campaign/scouting/claim-queue")return sendJson(response,200,campaign.claimScoutingQueue(account,body.taskId,body.cardIds));
    if (request.method === "POST" && pathname === "/api/campaign/scouting/choose") {
      return sendJson(response, 200, campaign.chooseScoutingPlayer(account, body.taskId, body.cardId));
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
    if (request.method === "POST" && pathname === "/api/campaign/draft/open") {
      return sendJson(response, 200, { state: campaign.openDraftPool(account, body.pool, body.pickNumber) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/draft/choose") {
      return sendJson(response, 200, { state: campaign.choose(account, body.playerId, body.offerId) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/inventory/packs/open") {
      return sendJson(response, 200, campaign.openPlayerPack(account, body.packType));
    }
    if (request.method === "POST" && pathname === "/api/campaign/inventory/packs/choose") {
      return sendJson(response, 200, campaign.choosePlayerPackCard(account, body.openingId, body.playerId));
    }
    if (request.method === "POST" && pathname === "/api/campaign/squads/assign") {
      return sendJson(response, 200, { state:campaign.assignPlayerSquad(account, body.playerId, body.squadId) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/home/claim") {
      return sendJson(response, 200, { state: campaign.chooseHome(account, body.territoryId) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/expedition/appearance") {
      return sendJson(response, 200, campaign.selectExpeditionAppearance(account, body.tokenId));
    }
    if (request.method === "POST" && pathname === "/api/campaign/expedition/move") {
      return sendJson(response, 200, campaign.moveExpedition(account, body.territoryId, {useOil:body.useOil}));
    }
    if (request.method === "POST" && pathname === "/api/campaign/expedition/estimate") {
      return sendJson(response, 200, campaign.estimateExpedition(account, body.territoryId, {useOil:body.useOil}));
    }
    if (request.method === "POST" && pathname === "/api/campaign/expedition/cancel") {
      return sendJson(response, 200, campaign.cancelExpedition(account));
    }
    if (request.method === "POST" && /^\/api\/campaign\/research\/(confirm|rename|start|start-topic|cancel)$/.test(pathname)) {
      campaign.formationResearch.mutate(account,pathname.split('/').at(-1),body);
      return sendJson(response,200,{state:campaign.state(account)});
    }
    if (request.method === "POST" && pathname === "/api/campaign/tactics/preview") return sendJson(response, 200, { tacticalShapePreview:campaignTacticalPreview(account, body) });
    if (request.method === "POST" && pathname === "/api/campaign/tactics") {
      return sendJson(response, 200, { state: campaign.saveTactics(account, body) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/maritime/preview") {
      return sendJson(response, 200, campaign.maritimePreview(account, body.previewId, body.action));
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
    if (request.method === "POST" && pathname === "/api/campaign/sponsorship/respond") {
      return sendJson(response, 200, campaign.respondSponsorship(account, body.offerId, body.action));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/buildings/build") {
      return sendJson(response, 200, campaign.buildTerritoryBuilding(account, body.territoryId, body.type, body.buildMethod));
    }
    if (request.method === "POST" && pathname === "/api/campaign/wonders/notifications/read") {
      return sendJson(response,200,campaign.acknowledgeWonderCompetition(account,body.noticeId));
    }
    if (request.method === "POST" && pathname === "/api/campaign/wonders/cancel") {
      return sendJson(response,200,campaign.cancelWonderConstruction(account,body.territoryId,body.buildingId));
    }
    if(request.method === "POST" && pathname === "/api/campaign/medical/start")return sendJson(response,200,campaign.startMedical(account,body));
    if(request.method === "POST" && pathname === "/api/campaign/medical/cancel")return sendJson(response,200,campaign.cancelMedical(account,body));
    if(request.method === "POST" && pathname === "/api/campaign/territory/buildings/cancel-upgrade") return sendJson(response,200,campaign.cancelBuildingUpgrade(account,body.territoryId,body.buildingId));
    if (request.method === "POST" && pathname === "/api/campaign/territory/buildings/upgrade") {
      return sendJson(response, 200, campaign.upgradeTerritoryBuilding(account, body.territoryId, body.buildingId, body));
    }
    if (request.method === "GET" && pathname === "/api/campaign/territory/buildings/demolish-preview") {
      const params = new URL(url, "http://localhost").searchParams;
      return sendJson(response, 200, campaign.previewBuildingDemolition(account, params.get("territoryId"), params.get("buildingId")));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/buildings/demolish") {
      return sendJson(response, 200, campaign.demolishTerritoryBuilding(account, body));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/buildings/rename") {
      return sendJson(response, 200, campaign.renameTerritoryBuilding(account, body.territoryId, body.buildingId, body.name));
    }
    return sendJson(response, 404, { error: "接口不存在" });
  };
}
