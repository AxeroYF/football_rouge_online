import { randomBytes, timingSafeEqual } from "node:crypto";
import { versusRooms } from "./room-service.js";
import { hydrateHistoricalMatchDetail } from "./history-detail.js";
import { yellowDogsLeague } from "./league-service.js";
import { createYdlTraitDraft, updateYdlPlayer, updateYdlTrait, ydlContentSection, ydlContentView } from "./ydl-content-store.js";
import {
  createPlayerCardBatch,
  createPlayerCardDraft,
  createPlayerCardDrafts,
  publishPlayerCardBatch,
  publishPlayerCardDrafts,
  regressPlayerAttributes,
  savePlayerCardProfile,
  updatePlayerCardBatch,
  updatePlayerCardDraft,
} from "./player-card-studio-store.js";
import { buildPlayerImportWorkbook, parsePlayerImportWorkbook } from "./player-card-excel.js";

const ADMIN_PASSWORD = process.env.VERSUS_ADMIN_PASSWORD ?? "19971019";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const sessions = new Map();
const loginFailures = new Map();

function bearerToken(request) {
  const value = request.headers.authorization ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function clientKey(request) {
  return String(request.headers["cf-connecting-ip"] ?? request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "unknown").split(",")[0].trim();
}

function cleanExpiredSessions(now = Date.now()) {
  for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
}

function requireAdmin(request) {
  cleanExpiredSessions();
  const token = bearerToken(request);
  const session = sessions.get(token);
  if (!session) throw Object.assign(new Error("管理员登录已失效，请重新登录"), { statusCode: 401 });
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return token;
}

function summaryMatch(record) {
  return {
    id: record.id ?? null,
    roomCode: record.roomCode,
    round: record.round ?? 1,
    playedAt: record.playedAt,
    score: record.score,
    penalties: record.penalties ?? null,
    winnerIndex: record.winnerIndex,
    weather: record.weather ?? null,
    referee: record.referee ?? null,
    blackWhistle: Boolean(record.blackWhistle),
    teams: (record.teams ?? []).map((team) => ({
      name: team.name,
      formation: team.formation,
      tactic: team.tactic,
      style: team.style,
      goals: team.stats?.goals ?? 0,
      xg: team.stats?.xg ?? 0,
    })),
    hasDetails: Boolean(record.teams),
  };
}

function uniqueMatches() {
  const matches = new Map();
  for (const account of versusRooms.accounts.values()) {
    for (const record of account.matches ?? []) {
      if (record.detail?.id) {
        if (!matches.has(record.detail.id)) matches.set(record.detail.id, record.detail);
        continue;
      }
      const key = `legacy:${record.roomCode}:${record.playedAt}`;
      if (!matches.has(key)) matches.set(key, {
        id: key,
        roomCode: record.roomCode,
        round: 1,
        playedAt: record.playedAt,
        score: [record.scoreFor, record.scoreAgainst],
        winnerIndex: record.result === "win" ? 0 : 1,
        teams: null,
      });
    }
  }
  return [...matches.values()].sort((left, right) => Number(right.playedAt) - Number(left.playedAt));
}

function addCompetitiveRow(map, key, won, goalsFor, goalsAgainst) {
  const label = key || "未知";
  const row = map.get(label) ?? { key: label, matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
  row.matches += 1;
  row.wins += Number(won === true);
  row.draws += Number(won === null);
  row.losses += Number(won === false);
  row.goalsFor += Number(goalsFor ?? 0);
  row.goalsAgainst += Number(goalsAgainst ?? 0);
  map.set(label, row);
}

function finishCompetitiveRows(map) {
  return [...map.values()].map((row) => ({
    ...row,
    winRate: Number((row.wins / Math.max(1, row.matches) * 100).toFixed(1)),
    goalsForPerMatch: Number((row.goalsFor / Math.max(1, row.matches)).toFixed(2)),
    goalsAgainstPerMatch: Number((row.goalsAgainst / Math.max(1, row.matches)).toFixed(2)),
  })).sort((left, right) => right.matches - left.matches || right.winRate - left.winRate);
}

function buildDashboard() {
  const accounts = [...versusRooms.accounts.values()];
  const matches = uniqueMatches();
  const formations = new Map();
  const tactics = new Map();
  const styles = new Map();
  let totalGoals = 0;
  let blackWhistles = 0;
  for (const match of matches) {
    if (!match.teams?.length) continue;
    totalGoals += Number(match.score?.[0] ?? 0) + Number(match.score?.[1] ?? 0);
    blackWhistles += Number(Boolean(match.blackWhistle));
    match.teams.forEach((team, index) => {
      const won = match.winnerIndex === null ? null : match.winnerIndex === index;
      addCompetitiveRow(formations, team.formation, won, match.score?.[index], match.score?.[index === 0 ? 1 : 0]);
      addCompetitiveRow(tactics, team.tactic, won, match.score?.[index], match.score?.[index === 0 ? 1 : 0]);
      addCompetitiveRow(styles, team.style, won, match.score?.[index], match.score?.[index === 0 ? 1 : 0]);
    });
  }
  const now = Date.now();
  return {
    generatedAt: now,
    overview: {
      registeredPlayers: accounts.length,
      activePlayers7d: accounts.filter((account) => now - Number(account.lastSeenAt ?? account.createdAt ?? 0) <= 7 * 86400_000).length,
      matches: matches.length,
      detailedMatches: matches.filter((match) => match.teams?.length).length,
      averageGoals: Number((totalGoals / Math.max(1, matches.filter((match) => match.teams?.length).length)).toFixed(2)),
      blackWhistles,
    },
    players: accounts.map((account) => ({
      id: account.id,
      nickname: account.nickname,
      createdAt: account.createdAt,
      lastSeenAt: account.lastSeenAt,
      summary: account.summary,
      historyCount: account.matches?.length ?? 0,
      moderation:versusRooms.adminAccountModeration(account.id),
      league:yellowDogsLeague.adminPlayerStatus(account.id),
    })).sort((left, right) => Number(right.lastSeenAt) - Number(left.lastSeenAt)),
    matches: matches.slice(0, 200).map(summaryMatch),
    formations: finishCompetitiveRows(formations),
    tactics: finishCompetitiveRows(tactics),
    styles: finishCompetitiveRows(styles),
  };
}

function playerDetail(playerId) {
  const account = [...versusRooms.accounts.values()].find((candidate) => candidate.id === playerId);
  if (!account) throw Object.assign(new Error("玩家不存在"), { statusCode: 404 });
  return {
    id: account.id,
    nickname: account.nickname,
    createdAt: account.createdAt,
    lastSeenAt: account.lastSeenAt,
    summary: account.summary,
    moderation:versusRooms.adminAccountModeration(account.id),
    league:yellowDogsLeague.adminPlayerStatus(account.id),
    matches: (account.matches ?? []).map(({ detail, viewerIndex, ...record }) => ({
      ...record,
      matchId: detail?.id ?? record.id ?? null,
      hasDetails: Boolean(detail),
      viewerIndex,
      ownFormation: detail?.teams?.[viewerIndex]?.formation ?? null,
      opponentFormation: detail?.teams?.[viewerIndex === 0 ? 1 : 0]?.formation ?? null,
    })),
  };
}

function matchDetail(matchId) {
  const match = uniqueMatches().find((candidate) => candidate.id === matchId);
  if (!match) throw Object.assign(new Error("比赛记录不存在"), { statusCode: 404 });
  return hydrateHistoricalMatchDetail(match);
}

export async function handleAdminApi(request, response, pathname, readJson, sendJson, readBuffer = null) {
  try {
    if (request.method === "POST" && pathname === "/api/admin/login") {
      const key = clientKey(request);
      const now = Date.now();
      const failure = loginFailures.get(key);
      if (failure && now - failure.startedAt < LOGIN_WINDOW_MS && failure.count >= MAX_LOGIN_FAILURES) {
        return sendJson(response, 429, { ok: false, error: "登录尝试过多，请稍后再试" });
      }
      const body = await readJson(request);
      if (!safeEqual(body.password ?? "", ADMIN_PASSWORD)) {
        const next = !failure || now - failure.startedAt >= LOGIN_WINDOW_MS ? { count: 1, startedAt: now } : { ...failure, count: failure.count + 1 };
        loginFailures.set(key, next);
        return sendJson(response, 401, { ok: false, error: "管理员密码错误" });
      }
      loginFailures.delete(key);
      const token = randomBytes(32).toString("base64url");
      sessions.set(token, { expiresAt: now + SESSION_TTL_MS });
      return sendJson(response, 200, { ok: true, token, expiresInMs: SESSION_TTL_MS });
    }
    const token = requireAdmin(request);
    if (request.method === "POST" && pathname === "/api/admin/logout") {
      sessions.delete(token);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "GET" && pathname === "/api/admin/dashboard") return sendJson(response, 200, { ok: true, dashboard: buildDashboard() });
    if (request.method === "GET" && pathname === "/api/admin/league") return sendJson(response, 200, { ok:true, league:yellowDogsLeague.adminView() });
    if (request.method === "GET" && pathname === "/api/admin/league/roster-enforcement/preview") return sendJson(response, 200, { ok:true, enforcement:yellowDogsLeague.rosterEnforcementPreview() });
    if (request.method === "POST" && pathname === "/api/admin/league/roster-enforcement/apply") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, enforcement:yellowDogsLeague.applyRosterEnforcement(body) });
    }
    if (request.method === "GET" && pathname === "/api/admin/league/simulation-baseline") return sendJson(response, 200, { ok:true, baseline:yellowDogsLeague.adminSimulationBaseline() });
    if (request.method === "GET" && pathname === "/api/admin/league/predictions/today") return sendJson(response, 200, { ok:true, predictions:yellowDogsLeague.adminPredictionBetsToday() });
    if (request.method === "GET" && pathname === "/api/admin/content") return sendJson(response, 200, { ok:true, content:ydlContentView() });
    const contentSectionMatch = pathname.match(/^\/api\/admin\/content\/(summary|players|studio|analytics|traits)$/);
    if (request.method === "GET" && contentSectionMatch) return sendJson(response, 200, { ok:true, content:ydlContentSection(contentSectionMatch[1]) });
    if (request.method === "GET" && pathname === "/api/admin/content/player-import/template") {
      const workbook = await buildPlayerImportWorkbook();
      response.writeHead(200, {
        "content-type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition":"attachment; filename=ydl-player-import-template.xlsx",
        "content-length":workbook.length,
        "cache-control":"no-store",
      });
      return response.end(workbook);
    }
    if (request.method === "POST" && pathname === "/api/admin/content/player-import/preview") {
      if (!readBuffer) throw new Error("当前服务不支持Excel上传");
      const preview = await parsePlayerImportWorkbook(await readBuffer(request, 8 * 1024 * 1024));
      return sendJson(response, 200, { ok:true, preview });
    }
    if (request.method === "POST" && pathname === "/api/admin/content/player-import/commit") {
      const body = await readJson(request);
      const drafts = await createPlayerCardDrafts(body.rows, body.batchId);
      return sendJson(response, 201, { ok:true, drafts, studio:ydlContentSection("studio"), summary:ydlContentSection("summary") });
    }
    if (request.method === "POST" && pathname === "/api/admin/content/player-batches") {
      const body = await readJson(request);
      const batch = await createPlayerCardBatch(body);
      return sendJson(response, 201, { ok:true, batch, studio:ydlContentSection("studio") });
    }
    const contentBatchMatch = pathname.match(/^\/api\/admin\/content\/player-batches\/([^/]+)$/);
    if (request.method === "POST" && contentBatchMatch) {
      const body = await readJson(request);
      const batch = await updatePlayerCardBatch(decodeURIComponent(contentBatchMatch[1]), body);
      return sendJson(response, 200, { ok:true, batch, studio:ydlContentSection("studio") });
    }
    const contentBatchPublishMatch = pathname.match(/^\/api\/admin\/content\/player-batches\/([^/]+)\/publish$/);
    if (request.method === "POST" && contentBatchPublishMatch) {
      const result = await publishPlayerCardBatch(decodeURIComponent(contentBatchPublishMatch[1]));
      return sendJson(response, 200, { ok:true, ...result, studio:ydlContentSection("studio"), summary:ydlContentSection("summary") });
    }
    if (request.method === "POST" && pathname === "/api/admin/content/traits") {
      const body = await readJson(request);
      return sendJson(response, 201, { ok:true, trait:await createYdlTraitDraft(body) });
    }
    if (request.method === "POST" && pathname === "/api/admin/content/player-drafts") {
      const body = await readJson(request);
      const draft = await createPlayerCardDraft(body);
      return sendJson(response, 201, { ok:true, draft, summary:ydlContentSection("summary") });
    }
    if (request.method === "POST" && pathname === "/api/admin/content/player-drafts/regress") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, regression:regressPlayerAttributes(body.role, body.overall) });
    }
    if (request.method === "POST" && pathname === "/api/admin/content/player-drafts/publish") {
      const body = await readJson(request);
      const players = await publishPlayerCardDrafts(body.ids);
      return sendJson(response, 200, {
        ok:true,
        players,
        studio:ydlContentSection("studio"),
        summary:ydlContentSection("summary"),
      });
    }
    const contentDraftMatch = pathname.match(/^\/api\/admin\/content\/player-drafts\/([^/]+)$/);
    if (request.method === "POST" && contentDraftMatch) {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, draft:await updatePlayerCardDraft(decodeURIComponent(contentDraftMatch[1]), body) });
    }
    const contentProfileMatch = pathname.match(/^\/api\/admin\/content\/player-profiles\/([^/]+)$/);
    if (request.method === "POST" && contentProfileMatch) {
      const body = await readJson(request);
      const profile = await savePlayerCardProfile(decodeURIComponent(contentProfileMatch[1]), body);
      return sendJson(response, 200, { ok:true, profile, summary:ydlContentSection("summary") });
    }
    const contentProfileImageMatch = pathname.match(/^\/api\/admin\/content\/player-profiles\/([^/]+)\/image$/);
    if (request.method === "POST" && contentProfileImageMatch) {
      if (!readBuffer) throw new Error("当前服务不支持二进制卡画上传");
      const contentType = String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!['image/png', 'image/webp'].includes(contentType)) throw new Error("请上传PNG或WebP卡画");
      const rawFileName = String(request.headers["x-ydl-file-name"] ?? "player.png");
      let sourceFileName = rawFileName;
      try { sourceFileName = decodeURIComponent(rawFileName); } catch {}
      const profile = await savePlayerCardProfile(decodeURIComponent(contentProfileImageMatch[1]), {
        imageBuffer:await readBuffer(request, 12 * 1024 * 1024),
        mimeType:contentType,
        sourceFileName,
        xPercent:request.headers["x-ydl-profile-x"],
        yPercent:request.headers["x-ydl-profile-y"],
        widthPercent:request.headers["x-ydl-profile-width"],
      });
      return sendJson(response, 200, { ok:true, profile, summary:ydlContentSection("summary") });
    }
    const contentPlayerMatch = pathname.match(/^\/api\/admin\/content\/players\/([^/]+)$/);
    if (request.method === "POST" && contentPlayerMatch) {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, player:await updateYdlPlayer(decodeURIComponent(contentPlayerMatch[1]), body) });
    }
    const contentTraitMatch = pathname.match(/^\/api\/admin\/content\/traits\/([^/]+)$/);
    if (request.method === "POST" && contentTraitMatch) {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, trait:await updateYdlTrait(decodeURIComponent(contentTraitMatch[1]), body) });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/simulate") {
      yellowDogsLeague.simulateNextRound();
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.adminView() });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/start-simulation") {
      const body = await readJson(request);
      if (body.confirm !== "START_LEAGUE_SIMULATION") throw new Error("需要确认开启联赛推进");
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.startLeagueSimulation() });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/cup/start") {
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.startCup() });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/daily-settlement/reward") {
      return sendJson(response, 200, { ok:true, settlement:yellowDogsLeague.settleDailySeason({ manual:true }), league:yellowDogsLeague.adminView() });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/daily-reset") {
      const body = await readJson(request);
      if (body.confirm !== "DAILY_RESET_YDL") throw new Error("需要确认立即重置每日联赛");
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.resetDailyCompetitions({ manual:true }) });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/s4-packs/grant") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.grantS4PacksFromAdmin(body) });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/coins/grant") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.grantCoinsFromAdmin(body) });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/x-growth/grant") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.grantXGrowthPointsFromAdmin(body) });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/mail/broadcast") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.broadcastAdminMail(body) });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/s4-cards/grant") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, cardGrant:yellowDogsLeague.grantS4PlayerCardsFromAdmin(body, { compact:true }) });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/reward-pack") throw new Error("旧赛季礼包发放逻辑已经下架");
    if (request.method === "POST" && pathname === "/api/admin/league/champion-badge") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.awardChampionBadge(body) });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/restart") {
      const body = await readJson(request);
      if (body.confirm !== "RESTART") throw new Error("需要确认重启当前赛季");
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.restartSeason() });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/new-season") {
      const body = await readJson(request);
      if (body.confirm !== "NEW_SEASON") throw new Error("需要确认开启新赛季");
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.startNewSeason() });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/fresh-season") {
      const body = await readJson(request);
      if (body.confirm !== "FRESH_SEASON_YDL") throw new Error("需要确认开启全新赛季");
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.startFreshSeason() });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/full-reset") {
      const body = await readJson(request);
      if (body.confirm !== "FULL_RESET_YDL") throw new Error("需要确认完全重置联赛");
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.fullReset() });
    }
    const coinPenaltyMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/coins\/remove$/);
    if (request.method === "POST" && coinPenaltyMatch) {
      const accountId = decodeURIComponent(coinPenaltyMatch[1]);
      const body = await readJson(request);
      const league = yellowDogsLeague.removeCoinsFromAdmin({ ...body, accountId });
      return sendJson(response, 200, { ok:true, league, player:playerDetail(accountId) });
    }
    const loginCooldownMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/login-cooldown$/);
    if (request.method === "POST" && loginCooldownMatch) {
      const accountId = decodeURIComponent(loginCooldownMatch[1]);
      const body = await readJson(request);
      const account = [...versusRooms.accounts.values()].find((candidate) => candidate.id === accountId);
      if (!account) throw new Error("玩家不存在");
      const moderation = versusRooms.applyLoginCooldown(accountId, body.durationMinutes, body.reason);
      yellowDogsLeague.recordLoginDisciplineFromAdmin({
        accountId,
        playerName:account.nickname,
        durationMinutes:Number(body.durationMinutes),
        cooldownUntil:moderation.loginCooldownUntil,
        reason:body.reason,
        announce:body.announce === true,
      });
      return sendJson(response, 200, { ok:true, player:playerDetail(accountId) });
    }
    const clearLoginCooldownMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/login-cooldown\/clear$/);
    if (request.method === "POST" && clearLoginCooldownMatch) {
      const accountId = decodeURIComponent(clearLoginCooldownMatch[1]);
      const body = await readJson(request);
      const account = [...versusRooms.accounts.values()].find((candidate) => candidate.id === accountId);
      if (!account) throw new Error("玩家不存在");
      versusRooms.clearLoginCooldown(accountId);
      yellowDogsLeague.recordLoginDisciplineFromAdmin({
        accountId,
        playerName:account.nickname,
        suspended:false,
        reason:body.reason,
        announce:body.announce === true,
      });
      return sendJson(response, 200, { ok:true, player:playerDetail(accountId) });
    }
    const rewardSuspensionMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/rewards\/suspension$/);
    if (request.method === "POST" && rewardSuspensionMatch) {
      const accountId = decodeURIComponent(rewardSuspensionMatch[1]);
      const body = await readJson(request);
      const league = yellowDogsLeague.setRewardSuspensionFromAdmin({ ...body, accountId });
      return sendJson(response, 200, { ok:true, league, player:playerDetail(accountId) });
    }
    const teamDissolutionMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/team\/dissolve$/);
    if (request.method === "POST" && teamDissolutionMatch) {
      const accountId = decodeURIComponent(teamDissolutionMatch[1]);
      const body = await readJson(request);
      const result = yellowDogsLeague.dissolveTeamFromAdmin({ ...body, accountId });
      return sendJson(response, 200, { ok:true, ...result, player:playerDetail(accountId) });
    }
    const playerMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)$/);
    if (request.method === "GET" && playerMatch) return sendJson(response, 200, { ok: true, player: playerDetail(decodeURIComponent(playerMatch[1])) });
    const historyMatch = pathname.match(/^\/api\/admin\/matches\/([^/]+)$/);
    if (request.method === "GET" && historyMatch) return sendJson(response, 200, { ok: true, match: matchDetail(decodeURIComponent(historyMatch[1])) });
    return sendJson(response, 404, { ok: false, error: "admin API not found" });
  } catch (error) {
    return sendJson(response, error.statusCode ?? 400, { ok: false, error: error.message });
  }
}
