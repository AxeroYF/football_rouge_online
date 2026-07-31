import { versusRooms } from "./room-service.js";
import { yellowDogsLeague } from "./league-service.js";

function bearerToken(request) {
  const value = request.headers.authorization ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

const isLeagueBroadcast = (code) => String(code ?? "").toUpperCase().startsWith("YDL-");

export async function handleVersusApi(request, response, pathname, readJson, sendJson) {
  const body = request.method === "POST" ? await readJson(request) : {};
  const code = body.code ?? pathname.split("/")[4];
  const playerToken = bearerToken(request) || body.token;
  let result;
  if (pathname.startsWith("/api/versus/league")) {
    if (request.method !== "POST") return sendJson(response, 405, { ok:false, error:"league API requires POST" });
    const account = versusRooms.account(body.playerId, body.accountToken);
    const developer = process.env.VERSUS_PUBLIC_ONLY !== "1";
    if (pathname === "/api/versus/league") result = { league:yellowDogsLeague.view(account, { developer }) };
    else if (pathname === "/api/versus/league/draft/start") result = yellowDogsLeague.beginDraft(account, body.teamName);
    else if (pathname === "/api/versus/league/draft/draw") result = yellowDogsLeague.drawDraft(account, body.pool);
    else if (pathname === "/api/versus/league/draft/choose") result = yellowDogsLeague.chooseDraft(account, body.leaguePlayerId);
    else if (pathname === "/api/versus/league/draft/x-player") result = yellowDogsLeague.chooseXPlayer(account, body.leaguePlayerId);
    else if (pathname === "/api/versus/league/draft/x-configure") result = yellowDogsLeague.configureXPlayer(account, body);
    else if (pathname === "/api/versus/league/draft/x-trait") result = yellowDogsLeague.chooseXPlayerTrait(account, body.traitId);
    else if (pathname === "/api/versus/league/draft/reset") result = { league:yellowDogsLeague.resetDraft(account) };
    else if (pathname === "/api/versus/league/draft/auto" && developer) result = yellowDogsLeague.autoDraft(account);
    else if (pathname === "/api/versus/league/draft/finish") result = { league:yellowDogsLeague.finishDraft(account) };
    else if (pathname === "/api/versus/league/team") result = { league:yellowDogsLeague.saveTeam(account, body) };
    else if (pathname === "/api/versus/league/team/rename") result = { league:yellowDogsLeague.renameTeam(account, body.teamName) };
    else if (pathname === "/api/versus/league/team/detail") result = { team:yellowDogsLeague.teamDetail(account, body.teamId) };
    else if (pathname === "/api/versus/league/match/detail") result = { match:yellowDogsLeague.matchDetail(account, body.matchId) };
    else if (pathname === "/api/versus/league/predictions/bet") result = { league:yellowDogsLeague.placeMatchPrediction(account, body.marketId, body.category, body.selection, body.amount) };
    else if (pathname === "/api/versus/league/inbox/read") result = { league:yellowDogsLeague.readInbox(account, body.messageId) };
    else if (pathname === "/api/versus/league/inbox/delete") result = { league:yellowDogsLeague.deleteInbox(account, body.messageId) };
    else if (pathname === "/api/versus/league/inbox/delete-batch") result = { league:yellowDogsLeague.deleteInboxBatch(account, body.mode) };
    else if (pathname === "/api/versus/league/friendlies/invite") result = { invitation:yellowDogsLeague.createFriendlyInvitation(account, body.targetTeamId, { compact:true }) };
    else if (pathname === "/api/versus/league/friendlies/respond") result = { league:yellowDogsLeague.resolveFriendlyInvitation(account, body.invitationId, body.action) };
    else if (pathname === "/api/versus/league/shop/buy-s4") result = { league:yellowDogsLeague.buyS4Packs(account, body.packType, body.quantity) };
    else if (pathname === "/api/versus/league/x-growth/buy") result = { growth:yellowDogsLeague.buyXGrowthPoints(account, body.quantity, { compact:true, requestId:body.requestId }) };
    else if (pathname === "/api/versus/league/x-growth/spend") result = { growth:yellowDogsLeague.spendXGrowthPoints(account, body.field, body.amount, { compact:true, requestId:body.requestId }) };
    else if (pathname === "/api/versus/league/x-growth/reset") result = { growth:yellowDogsLeague.resetXGrowth(account, body.role, body.secondaryRole, { compact:true, requestId:body.requestId, traitId:body.traitId }) };
    else if (pathname === "/api/versus/league/packs/open") result = { league:yellowDogsLeague.openS4Pack(account, body.packId) };
    else if (pathname === "/api/versus/league/packs/open-batch") result = { league:yellowDogsLeague.openS4PacksBatch(account, body.packIds) };
    else if (pathname === "/api/versus/league/packs/choose") result = { league:yellowDogsLeague.chooseS4Pack(account, body.offerId, body.leaguePlayerId) };
    else if (["/api/versus/league/shop/buy", "/api/versus/league/shop/choose", "/api/versus/league/reward/open", "/api/versus/league/reward/choose"].includes(pathname)) throw new Error("旧赛季卡包已经全部下架");
    else if (pathname === "/api/versus/league/market/list") result = { league:yellowDogsLeague.listPlayer(account, body.leaguePlayerId, body.price) };
    else if (pathname === "/api/versus/league/market/list-card") result = { league:yellowDogsLeague.listCard(account, body.cardId, body.price) };
    else if (pathname === "/api/versus/league/market/list-ownership") result = { league:yellowDogsLeague.listOwnership(account, body.leaguePlayerId, body.price, body.retainedCardId) };
    else if (pathname === "/api/versus/league/market/cancel") result = { league:yellowDogsLeague.cancelListing(account, body.listingId) };
    else if (pathname === "/api/versus/league/market/buy") result = { league:yellowDogsLeague.buyListing(account, body.listingId) };
    else if (pathname === "/api/versus/league/player/release") result = { league:yellowDogsLeague.releasePlayer(account, body.leaguePlayerId) };
    else if (pathname === "/api/versus/league/card/release") result = { league:yellowDogsLeague.releaseCard(account, body.cardId, body.confirmOwnershipReturn === true) };
    else if (pathname === "/api/versus/league/cards/release") result = { league:yellowDogsLeague.releaseCards(account, body.cardIds) };
    else if (pathname === "/api/versus/league/card-trades/create") result = { league:yellowDogsLeague.createCardTradeOffer(account, body.targetOwnerId, body.offeredCardIds, body.requestedCardIds, body.coinAmount) };
    else if (pathname === "/api/versus/league/card-trades/respond") result = { league:yellowDogsLeague.resolveCardTradeOffer(account, body.tradeOfferId, body.action) };
    else if (pathname === "/api/versus/league/card-trades/withdraw") result = { league:yellowDogsLeague.withdrawCardTradeOffer(account, body.tradeOfferId) };
    else if (pathname === "/api/versus/league/card/enhance") result = { enhancement:yellowDogsLeague.enhanceS4Card(account, body.mainCardId, body.materialCardId, body.useProtection === true, { compact:true }) };
    else if (pathname === "/api/versus/league/card/enhancement-trait") result = { league:yellowDogsLeague.chooseS4EnhancementTrait(account, body.offerId, body.traitId) };
    else if (pathname === "/api/versus/league/ownership/return") result = { league:yellowDogsLeague.returnOwnership(account, body.leaguePlayerId) };
    else if (pathname === "/api/versus/league/ownership/return-batch") result = { league:yellowDogsLeague.returnOwnerships(account, body.leaguePlayerIds) };
    else if (pathname === "/api/versus/league/simulate" && developer) { yellowDogsLeague.simulateNextRound(); result = { league:yellowDogsLeague.view(account, { developer }) }; }
    else return sendJson(response, 404, { ok:false, error:"league API not found" });
  }
  else if (request.method === "POST" && pathname === "/api/versus/live") {
    const account = versusRooms.account(body.playerId, body.accountToken);
    result = { live:yellowDogsLeague.liveView(account) };
  }
  else if (request.method === "GET" && pathname === "/api/versus/broadcasts") result = { broadcasts:[...versusRooms.broadcasts(), ...yellowDogsLeague.broadcasts()] };
  else if (request.method === "POST" && pathname === "/api/versus/register") result = versusRooms.register(body.nickname, body.password, body.legacyAccountToken);
  else if (request.method === "POST" && pathname === "/api/versus/login") result = versusRooms.login(body.nickname, body.password);
  else if (request.method === "POST" && pathname === "/api/versus/watch") result = isLeagueBroadcast(body.code) ? yellowDogsLeague.watch(body.code, body.name, body.spectatorToken) : versusRooms.watch(body.code, body.name, body.spectatorToken);
  else if (request.method === "GET" && /^\/api\/versus\/watch\/[^/]+$/.test(pathname)) result = { broadcast:isLeagueBroadcast(code) ? yellowDogsLeague.watchView(code, playerToken) : versusRooms.watchView(code, playerToken) };
  else if (request.method === "POST" && pathname.endsWith("/leave-watch")) result = isLeagueBroadcast(code) ? yellowDogsLeague.leaveWatch(code, playerToken) : versusRooms.leaveWatch(code, playerToken);
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
