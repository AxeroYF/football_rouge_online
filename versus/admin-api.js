import { randomBytes, timingSafeEqual } from "node:crypto";
import { versusRooms } from "./room-service.js";
import { hydrateHistoricalMatchDetail } from "./history-detail.js";
import { yellowDogsLeague } from "./league-service.js";

const ADMIN_PASSWORD = process.env.VERSUS_ADMIN_PASSWORD ?? "19971027";
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

export async function handleAdminApi(request, response, pathname, readJson, sendJson) {
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
    if (request.method === "POST" && pathname === "/api/admin/league/simulate") {
      yellowDogsLeague.simulateNextRound();
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.adminView() });
    }
    if (request.method === "POST" && pathname === "/api/admin/league/reward-pack") {
      const body = await readJson(request);
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.scheduleAdminRewardPack(body) });
    }
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
    if (request.method === "POST" && pathname === "/api/admin/league/full-reset") {
      const body = await readJson(request);
      if (body.confirm !== "FULL_RESET_YDL") throw new Error("需要确认完全重置联赛");
      return sendJson(response, 200, { ok:true, league:yellowDogsLeague.fullReset() });
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
