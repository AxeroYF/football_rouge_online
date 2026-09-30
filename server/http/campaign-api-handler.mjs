import {scoutingRoutes} from "./scouting-routes.mjs";
import {cardRoutes} from "./card-routes.mjs";
import {interactionRoutes} from './interaction-routes.mjs';
import {leagueRoutes} from "./league-routes.mjs";
import {UNHANDLED} from "./route-result.mjs";
import {trainingRoute} from './training-routes.mjs';
import {PlayerLadderService} from '../application/player-ladder-service.mjs';
import {stateDelta} from './state-delta.mjs';
import { campaignTacticalPreview } from "../application/tactical-preview.mjs";
import {sendJson, readJsonBody, bearerToken} from "./json.mjs";
export {sendJson, readJsonBody, bearerToken} from "./json.mjs";

export function createCampaignApiHandler({ campaign } = {}) {
  if (!campaign) throw new Error("Campaign API handler requires a campaign service");
  const ladder=new PlayerLadderService({accounts:campaign.accounts,now:()=>campaign.now?.()??Date.now()});
  return async function handleCampaignApi(request, response, pathname, url) {
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    if (request.method === "POST" && pathname === "/api/campaign/register") {
      return sendJson(response, 200, campaign.register(body.nickname, body.password));
    }
    if (request.method === "POST" && pathname === "/api/campaign/login") {
      return sendJson(response, 200, campaign.login(body.nickname, body.password));
    }
    const account = campaign.authenticate(bearerToken(request));
    if(request.method==='GET'&&pathname==='/api/campaign/player-ladder'){
      if(!account.setupComplete)throw Object.assign(Error('请先完成建队'),{statusCode:403});
      return sendJson(response,200,{ladder:ladder.get(),serverNow:campaign.now?.()??Date.now()});
    }
    const league = leagueRoutes({campaign, account, request, response, pathname, url, body});
    if (league !== UNHANDLED) return league;
    if(request.method==='POST'&&pathname==='/api/campaign/pvp-notice/read')return sendJson(response,200,campaign.dismissPvpNotice(account,body.noticeId));
    if(request.method==='POST'&&pathname==='/api/campaign/battle-report/read')return sendJson(response,200,campaign.dismissBattleReport(account,body.challengeId));
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
      if(body.action==='dismiss'){const day=campaign.eliteRaids.day()?.id;if(body.day!==undefined&&body.day!==day)throw Object.assign(Error('活动日期已变化，请刷新'),{statusCode:409});const previous=account.raidNoticeDay;account.raidNoticeDay=day;try{campaign.persist();}catch(error){if(previous===undefined)delete account.raidNoticeDay;else account.raidNoticeDay=previous;throw error;}return sendJson(response,200,{ok:true});}
      if(body.action==='preview')return sendJson(response,200,{tacticalShapePreview:campaign.eliteRaids.preview(account,body)});
      const result=campaign.eliteRaids.mutate(account,body);campaign.eliteRaids.touch(account,{foreground:true});
      if(body.action==='tactics'&&body.responseMode==='tactics')return sendJson(response,200,{result,view:campaign.eliteRaids.armyView(account),tacticsUpdate:{eliteRaids:campaign.eliteRaids.view(account)}});
      return sendJson(response,200,{result,activity:campaign.eliteRaids.view(account,{detail:true}),view:campaign.eliteRaids.armyView(account),state:campaign.state(account)});
    }
    if(request.method==='GET'&&pathname==='/api/campaign/raids/match'){if(!account.setupComplete)throw Object.assign(Error('请先完成建队'),{statusCode:403});return sendJson(response,200,campaign.eliteRaids.snapshot(account,new URL(url,'http://localhost').searchParams.get('id')));}
    if(request.method==='POST'&&!['estimate','preview','routes','read','read-news'].includes(body.action))response.once?.('finish',()=>{if(response.statusCode>=200&&response.statusCode<300)campaign.eliteRaids?.touch(account,{foreground:true});});
    if(pathname==='/api/campaign/coalition'&&['GET','POST'].includes(request.method)) {
      if(request.method==='GET')return sendJson(response,200,{view:campaign.coalitions.view(account,{includeTactics:new URL(request.url,'http://localhost').searchParams.get('view')!=='management'})});
      if(body.action==='estimate'){campaign.save();const army=campaign.coalitions.require(account,body.armyId);campaign.coalitions.command(account,army);return sendJson(response,200,{estimate:campaign.coalitions.estimate(army,body)});}
      if(body.action==='loan-cards')return sendJson(response,200,{view:campaign.coalitions.loanCards(account,String(body.ownerId??''))});
      if(body.action==='preview')return sendJson(response,200,{tacticalShapePreview:campaign.coalitions.preview(account,body)});
      if(body.action==='routes'){const army=campaign.coalitions.require(account,body.armyId);campaign.coalitions.command(account,army);const routes=campaign.coalitions.routes(army,body.beneficiaryId,body.sourcePoint);campaign.fog.survey(account,campaign.world,routes,{coalitionId:army.id});return sendJson(response,200,{...routes,state:campaign.state(account)});}
      const result=campaign.coalitions.mutate(account,body),view=campaign.coalitions.view(account,{includeTactics:body.view!=='management'});
      if(body.action==='tactics'&&body.responseMode==='tactics')return sendJson(response,200,{result,view,tacticsUpdate:{coalition:campaign.coalitions.view(account,{detail:false})}});
      if(body.view==='management'&&campaign.coalitions.isManagementAction(body.action))return sendJson(response,200,{result,view,statePatch:{...campaign.actionState(account,{includeRoster:['lend','withdraw','accept-loan'].includes(body.action)}),coalition:campaign.coalitions.view(account,{detail:false}),coalitionLoanRequests:campaign.coalitions.loanNotices(account),coalitionCommandRequests:campaign.coalitions.commandNotices(account),coalitionTargetRequests:campaign.coalitions.targetNotices(account)}});
      return sendJson(response,200,{result,view,state:campaign.state(account)});
    }
    if(pathname==='/api/campaign/oil'&&['GET','POST'].includes(request.method)){
      campaign.save();
      const result=request.method==='POST'?campaign.oil.mutate(account,body):null;
      return sendJson(response,200,{result,oil:campaign.oil.market(account),state:campaign.state(account)});
    }
    const interaction = interactionRoutes({campaign, account, request, response, pathname, url, body});
    if (interaction !== UNHANDLED) return interaction;
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
    const cards = cardRoutes({campaign, account, request, response, pathname, url, body});
    if (cards !== UNHANDLED) return cards;
    if (request.method === "GET" && pathname === "/api/campaign/state") {
      return sendJson(response, 200, {
        profile: { id: account.id, nickname: account.nickname },
        ...(request.headers['x-campaign-delta']==='1'?stateDelta(campaign.state(account),request.headers['x-campaign-versions']):{state:campaign.state(account)}),
        ...(request.headers['x-campaign-delta']==='1'?{serverNow:campaign.now?.()??Date.now()}:{}),
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
    const training = trainingRoute({campaign, account, method:request.method, pathname, url, body});
    if (training) return sendJson(response, 200, training.value);
    const scouting = scoutingRoutes({campaign, account, request, response, pathname, url, body});
    if (scouting !== UNHANDLED) return scouting;
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
    if (request.method === "GET" && pathname === "/api/campaign/squads/batch") return sendJson(response,200,{snapshot:campaign.squadBatchDetails(account)});
    if (request.method === "POST" && pathname === "/api/campaign/squads/batch-preview") return sendJson(response,200,campaign.previewSquadBatch(account,body));
    if (request.method === "POST" && pathname === "/api/campaign/squads/batch") return sendJson(response,200,campaign.saveSquadBatch(account,body));
    if (request.method === "POST" && pathname === "/api/campaign/squads/assign") {
      return sendJson(response, 200, { [body.compact === true ? "statePatch" : "state"]:campaign.assignPlayerSquad(account, body.playerId, body.squadId, {compact:body.compact}) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/home/claim") {
      return sendJson(response, 200, { state: campaign.chooseHome(account, body.territoryId) });
    }
    if (request.method === "POST" && pathname === "/api/campaign/expedition/appearance") {
      return sendJson(response, 200, campaign.selectExpeditionAppearance(account, body.tokenId));
    }
    if (request.method === "POST" && pathname === "/api/campaign/expedition/move") {
      return sendJson(response, 200, campaign.moveExpedition(account, body.territoryId, {useOil:body.useOil,compact:body.compact}));
    }
    if (request.method === "POST" && pathname === "/api/campaign/expedition/estimate") {
      return sendJson(response, 200, campaign.estimateExpedition(account, body.territoryId, {useOil:body.useOil}));
    }
    if (request.method === "POST" && pathname === "/api/campaign/expedition/cancel") {
      return sendJson(response, 200, campaign.cancelExpedition(account,{compact:body.compact===true,movementId:body.movementId}));
    }
    if (request.method === "POST" && /^\/api\/campaign\/research\/(confirm|rename|start|start-topic|cancel|read-notice|continue-notice)$/.test(pathname)) {
      const research=campaign.formationResearch.mutate(account,pathname.split('/').at(-1),body);
      return sendJson(response,200,body.compact===true?{statePatch:{playerId:account.id,formationResearch:research}}:{state:campaign.state(account)});
    }
    if (request.method === "POST" && pathname === "/api/campaign/tactics/preview") return sendJson(response, 200, { tacticalShapePreview:campaignTacticalPreview(account, body) });
    if (request.method === "POST" && pathname === "/api/campaign/tactics") {
      const compact=body.responseMode==='tactics';
      const result=campaign.saveTactics(account,body,{compact});
      return sendJson(response,200,compact?{tacticsUpdate:result}:{state:result});
    }
    if (request.method === "POST" && pathname === "/api/campaign/maritime/preview") {
      return sendJson(response, 200, campaign.maritimePreview(account, body.previewId, body.action));
    }
    if (request.method === "POST" && pathname === "/api/campaign/maritime/routes") {
      return sendJson(response, 200, campaign.maritimeRoutes(account, body.sourceTerritoryId, body.sourcePoint));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/liberation") {
      return sendJson(response, 200, campaign.resolveTerritoryLiberation(account, body));
    }
    if (request.method === "POST" && pathname === "/api/campaign/territory/challenge") {
      return sendJson(response, 200, campaign.challengeTerritory(account, body.territoryId, { maritimeRoute: body.maritimeRoute, requirePvpConfirmation:true,pvpConfirmed:body.pvpConfirmed===true,expectedOwnerId:body.expectedOwnerId }));
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
      return sendJson(response,200,campaign.acknowledgeWonderCompetition(account,body.noticeId,{compact:body.compact===true}));
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
