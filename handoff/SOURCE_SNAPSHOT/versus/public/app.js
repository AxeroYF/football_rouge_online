import { evaluateS4LineupBonds } from "./bond-rules.js";

const app = document.querySelector("#app");
const roomStatus = document.querySelector("#room-status");
const leaveButton = document.querySelector("#leave-room");
const accountStatus = document.querySelector("#account-status");
const accountLogoutButton = document.querySelector("#account-logout");
const toastElement = document.querySelector("#toast");
const SESSION_KEY = "football_test1_versus_room_v1";
const ACCOUNT_KEY = "football_test1_versus_account_v1";
const LINE_LABELS = { GK: "门将", DEF: "后场", MID: "中场", ATT: "前场", MIXED:"全位置混池", LEGEND:"随机传奇" };
const ROLE_LABELS = { GK:"门将",CB:"中后卫",LB:"左后卫",RB:"右后卫",LWB:"左边翼卫",RWB:"右边翼卫",DM:"后腰",AM:"前腰",LM:"左中场",RM:"右中场",ST:"中锋",LW:"左边锋",RW:"右边锋" };
const TACTICS = { allOutAttack:"全力进攻",positive:"积极进攻",balanced:"攻守平衡",defensive:"防守反击",parkBus:"全力防守" };
const STYLES = { possession:"密集短传",longBall:"长传冲吊",wingPlay:"两翼齐飞",counterAttack:"防守反击",highPress:"高位压迫",lowBlock:"摆大巴",roughPlay:"伐木" };
const FOCUSES = { balanced:"均衡",left:"左路",center:"中路",right:"右路" };
const WEATHER_ICONS = { sunny:"☀️",rain:"🌧️",storm:"⛈️",snow:"❄️" };
const STAT_LABELS = { finishing:"射门",passing:"传球",tackling:"抢断",pace:"速度",stamina:"耐力",goalkeeping:"守门",reflexes:"反应",dribbling:"盘带",composure:"镇定" };

let session = readSession();
let account = readAccount();
let room = null;
let polling = null;
let roomStream = null;
let roomStreamConnected = false;
let roomStreamReconnectTimer = null;
let localPositions = null;
let localStartingIds = null;
let localTactic = "balanced";
let localStyle = "possession";
let localMarkingTargetId = null;
let localAttackFocus = "balanced";
let localDefenseFocus = "balanced";
let draggingMagnet = false;
let controlInteraction = false;
let controlReleaseTimer = null;
let lineupSeedInput = "";
let exportedLineupCode = "";

function applyEnvironment(config = {}) {
  if (config.environment !== "test") return;
  document.documentElement.dataset.environment = "test";
  document.title = `${config.environmentLabel ?? "S4 测试服"} | ${document.title}`;
}
let publicHosting = false;
let toastTimer = null;
let renderedPhase = null;
let mobileMatchView = "own";
let lastMatchSegment = null;
let networkFailures = 0;
let connectionState = "online";
let actionPending = false;
let roomMutationPending = false;
let roomStateEpoch = 0;
let lastAnimatedEventId = null;
let liveBroadcasts = [];
let spectatorSession = null;
let spectatorPolling = null;
let authMode = "login";
let leagueMode = false;
let league = null;
let leagueTab = "overview";
let leagueBoard = "scorers";
let leagueStatsScope = "league";
let leagueCupPage = "swiss";
let leagueCupRoundPage = null;
let leagueRoundPage = null;
let leagueHistoryTeamId = null;
let leagueStartingIds = null;
let leaguePositions = null;
let leaguePositionPresets = null;
let leagueActivePositionPreset = "position1";
let leagueTacticalDraft = null;
let leagueAutoSaveTimer = null;
let leagueAutoSaveRevision = 0;
let leagueAutoSavePending = false;
let leagueInboxMessageId = null;
let leagueShowChemistry = true;
let leagueMutationPending = false;
let leagueSyncPending = false;
let leagueEditorDirty = false;
let leagueMarketSection = null;
let leagueMarketListingSearch = "";
let leagueMarketWarehouseSearch = "";
let leagueMarketListingPosition = "ALL";
let leagueMarketWarehousePosition = "ALL";
let leagueMarketWarehouseUpgrade = "ALL";
let leagueTradeTargetOwnerId = "";
let leagueTradeOfferedCardIds = new Set();
let leagueTradeRequestedCardIds = new Set();
let leagueTradeCoinAmount = "";
let leaguePlayerInfoSection = null;
let leaguePlayerSearchDraft = "";
let leaguePlayerSearchQuery = "";
let leagueEnhancementRankingSearch = "";
let leagueEnhancementRankingPosition = "ALL";
let leagueEnhancementRankingGrade = "ALL";
let leagueEnhancementRankingLevel = "ALL";
let leagueBackpackSearch = "";
let leagueBackpackPosition = "ALL";
let leagueBackpackUpgrade = "ALL";
let leagueBackpackSort = "upgrade";
let leagueBackpackCompact = true;
let leagueBackpackStacked = false;
let leagueBackpackPage = "packs";
let leagueBackpackPackSearch = "";
let leagueBackpackPackKind = "ALL";
let leagueBackpackPackPool = "ALL";
let leagueBackpackPackSource = "ALL";
let leagueBackpackSearchTimer = null;
let leagueBackpackRecoveryMode = null;
let leagueBackpackSelectedCardIds = new Set();
let leagueBackpackSelectedOwnershipId = null;
let leagueEnhancementMainCardId = null;
let leagueEnhancementMaterialCardId = null;
let leagueEnhancementUseProtection = false;
let leagueEnhancementPhase = "idle";
let leagueEnhancementResult = null;
let leagueEnhancementTraitSelectionOpen = false;
let leagueEnhancementListingFilter = "UNLISTED";
let leagueScheduleClockTimer = null;
let leagueScheduleClockOffset = 0;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) ?? null; } catch { return null; }
}

function readAccount() {
  try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)) ?? null; } catch { return null; }
}

function storeAccount(value) {
  account = value;
  if (value) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(value));
  else localStorage.removeItem(ACCOUNT_KEY);
}

function storeSession(value) {
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}

function showToast(message) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.add("show");
  toastTimer = setTimeout(() => toastElement.classList.remove("show"), 2400);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: { "content-type":"application/json", ...((options.token ?? session?.token) ? { authorization:`Bearer ${options.token ?? session.token}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const value = await response.json();
  if (!response.ok || !value.ok) {
    const error = new Error(value.error ?? "请求失败");
    error.status = response.status;
    throw error;
  }
  return value;
}

function updateChrome() {
  const active = Boolean(room && session);
  const leagueActive = Boolean(leagueMode);
  accountStatus.hidden = !account;
  accountLogoutButton.hidden = !account || active || leagueActive;
  roomStatus.hidden = !active;
  leaveButton.hidden = !active && !leagueActive;
  if (account) accountStatus.innerHTML = `<small>当前账号</small><b>${escapeHtml(account.profile.nickname)}</b>`;
  roomStatus.classList.toggle("reconnecting", connectionState !== "online");
  if (active) roomStatus.innerHTML = `<i></i><span>${connectionState === "online" ? "房间" : "重连中"}</span><b>${escapeHtml(room.code)}</b><span>${({ lobby:"等待好友",draft:"限时选秀",tactics:"战术准备",match:"比赛中",report:"比赛结束" })[room.phase] ?? room.phase}</span>`;
}

function clockText(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds ?? 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}`;
}

function phaseTimer(label) {
  return room.timer ? `<div class="phase-timer"><small>${label}</small><b>${clockText(room.timer.remainingMs)}</b></div>` : "";
}

function weatherIcon(weather) { return WEATHER_ICONS[weather?.key] ?? "🌤️"; }
function refereeText(referee) { return referee ? `裁判尺度：${referee.name}` : "裁判尺度待确认"; }

function ownPlayer() { return room?.players?.[room.viewerIndex] ?? null; }
function rivalPlayer() { return room?.players?.[room.viewerIndex === 0 ? 1 : 0] ?? null; }

function versusStrip() {
  const own = ownPlayer();
  const rival = rivalPlayer();
  return `<div class="versus-strip"><div class="versus-player"><b>${escapeHtml(own.name)}</b><strong>${own.selectionCount}/11</strong></div><div class="versus-mark">VS</div><div class="versus-player"><strong>${rival?.selectionCount ?? 0}/11</strong><b>${escapeHtml(rival?.name ?? "等待加入")}</b></div></div>`;
}

function profileMarkup(profile = account?.profile) {
  if (!profile) return "";
  const summary = profile.summary;
  const recent = profile.matches?.length
    ? profile.matches.slice(0, 8).map((match) => match.hasDetails
      ? `<button class="history-row" data-history-match="${escapeHtml(match.id)}"><span><b>${escapeHtml(match.opponentName)}</b><small>${new Date(match.playedAt).toLocaleDateString()} · ${escapeHtml(match.ownFormation ?? "阵型未知")} vs ${escapeHtml(match.opponentFormation ?? "阵型未知")} · ${match.goals}球 ${match.assists}助</small></span><strong class="result-${match.result}">${match.scoreFor}:${match.scoreAgainst}<small>查看 ›</small></strong></button>`
      : `<div class="history-row history-row-legacy"><span><b>${escapeHtml(match.opponentName)}</b><small>${new Date(match.playedAt).toLocaleDateString()} · ${match.goals}球 ${match.assists}助 · 旧版记录</small></span><strong class="result-${match.result}">${match.scoreFor}:${match.scoreAgainst}</strong></div>`).join("")
    : `<p class="history-empty">还没有比赛记录，完成第一场后会自动统计。</p>`;
  return `<section class="account-history"><header><div><h2>${escapeHtml(profile.nickname)} <small>@${escapeHtml(profile.id)}</small></h2></div><b>${summary.wins}胜 ${summary.losses}负</b></header><div class="career-stats"><span>场次<b>${summary.played}</b></span><span>进球<b>${summary.goals}</b></span><span>助攻<b>${summary.assists}</b></span><span>总比分<b>${summary.goalsFor}:${summary.goalsAgainst}</b></span></div><div class="history-list">${recent}</div></section>`;
}

function historyTeamMarkup(team, hideStrategy = false) {
  const strategy = hideStrategy ? "战术不公开" : `${TACTICS[team.tactic] ?? team.tactic} · ${STYLES[team.style] ?? team.style} · 主攻${FOCUSES[team.attackFocus] ?? team.attackFocus} · 主守${FOCUSES[team.defenseFocus] ?? team.defenseFocus}`;
  const players = [...team.players].sort((left, right) => right.rating - left.rating);
  const averageRating = players.length ? players.reduce((sum, player) => sum + Number(player.rating ?? 0), 0) / players.length : 0;
  const pitch = team.players.map((player) => {
    const position = player.position ?? team.positions?.[player.id] ?? { x:50, y:50 };
    const x = Math.max(4, Math.min(96, Number(position.x ?? 50)));
    const y = Math.max(4, Math.min(96, Number(position.y ?? 50)));
    const status = player.sentOff ? "红牌" : player.injury ? "伤退" : player.active === false ? "离场" : "";
    const role = ROLE_LABELS[player.assignedRole ?? player.role] ?? player.assignedRole ?? player.role;
    const fitness = Math.max(0, Math.min(100, Math.round(player.fitness ?? 100)));
    const upgrade = Number(player.upgradeLevel ?? 0);
    const tooltip = `${player.name} · ${role} · 综合能力 ${player.overall} · 比赛评分 ${Number(player.rating).toFixed(1)}${status ? ` · ${status}` : ""}`;
    return `<div class="magnet league-squad-magnet history-report-magnet grade-${String(player.grade ?? "C").toLowerCase()} fit-primary ${status ? "inactive unavailable" : ""}" style="left:${x}%;top:${y}%" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}"><span class="league-magnet-role">${escapeHtml(role)}${status ? ` · ${status}` : ""}</span><b>${escapeHtml(player.name)}</b><i>${Number(player.overall ?? 0)}</i><span class="league-magnet-fitness" aria-label="体力 ${fitness}"><span style="width:${fitness}%"></span></span><span class="history-report-rating">评分 ${Number(player.rating ?? 0).toFixed(1)}</span>${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}</div>`;
  }).join("");
  return `<section class="history-team"><header><div><h3>${escapeHtml(team.name)}</h3><small>${escapeHtml(team.formation)} · ${escapeHtml(strategy)}</small></div><b>${team.stats.xg} xG · 平均评分 ${averageRating.toFixed(1)}</b></header>${pitchMarkup(pitch, "", "history-pitch s4-readonly-pitch")}<div class="history-player-list">${players.map((player) => `<div><span><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.assignedRole ?? player.role] ?? player.assignedRole ?? player.role}${player.sentOff ? " · 红牌" : player.injury ? " · 伤退" : ""}</small></span><em>${player.stats.goals}球 ${player.stats.assists}助</em><span class="history-player-values"><small>能力</small><b>${Number(player.overall ?? 0)}</b></span><span class="history-player-values rating"><small>评分</small><b>${Number(player.rating ?? 0).toFixed(1)}</b></span></div>`).join("")}</div></section>`;
}

function historyMatchMarkup(detail) {
  const viewerIndex = Number(detail.viewerIndex ?? 0);
  const opponentIndex = viewerIndex === 0 ? 1 : 0;
  const displayScore = detail.aggregateScore ?? detail.score;
  const won = detail.winnerIndex === viewerIndex;
  const timeline = detail.importantEvents?.length ? detail.importantEvents.map(reportTimelineItem).join("") : `<p class="history-empty">本场没有重点事件。</p>`;
  return `<header class="history-detail-head"><button class="icon-button" data-close-history aria-label="关闭">×</button><div><small>${new Date(detail.playedAt).toLocaleString()} · ${escapeHtml(detail.roomCode)} · 第 ${detail.round} 轮</small><h2>${displayScore[viewerIndex] === displayScore[opponentIndex] ? "本场战平" : won ? "本场获胜" : "本场失利"}</h2></div></header><div class="history-detail-score"><span>${escapeHtml(detail.teams[viewerIndex].name)}</span><b>${displayScore[viewerIndex]} : ${displayScore[opponentIndex]}</b><span>${escapeHtml(detail.teams[opponentIndex].name)}</span>${detail.aggregateBaseScore ? `<small>首回合 ${detail.aggregateBaseScore[viewerIndex]}:${detail.aggregateBaseScore[opponentIndex]} · 第二回合 ${detail.score[viewerIndex]}:${detail.score[opponentIndex]}</small>` : ""}${detail.penalties ? `<small>点球 ${detail.penalties[viewerIndex]} : ${detail.penalties[opponentIndex]}</small>` : ""}<em>${weatherIcon(detail.weather)} ${escapeHtml(detail.weather?.name ?? "未知天气")}</em></div><div class="history-detail-grid"><section class="report-panel timeline-panel"><h2>重点事件</h2><div class="match-timeline">${timeline}</div></section><section class="report-panel compact-stats-panel"><h2>比赛统计</h2>${matchStatsMarkup(detail, [viewerIndex, opponentIndex])}</section></div><div class="history-team-grid">${[viewerIndex, opponentIndex].map((index) => historyTeamMarkup(detail.teams[index], Boolean(detail.hideStrategies))).join("")}</div>`;
}

function closeHistoryMatch() {
  document.querySelector("#history-detail-overlay")?.remove();
}

async function openHistoryMatch(matchId) {
  if (!account?.profile?.id || !account?.accountToken) return showToast("请先绑定账号");
  closeHistoryMatch();
  document.body.insertAdjacentHTML("beforeend", `<div class="history-detail-overlay" id="history-detail-overlay"><section class="history-detail-dialog"><header class="history-detail-head"><button class="icon-button" data-close-history aria-label="关闭">×</button><div><small>历史对局</small><h2>正在读取比赛详情…</h2></div></header></section></div>`);
  const overlay = document.querySelector("#history-detail-overlay");
  overlay.addEventListener("click", (event) => { if (event.target === overlay || event.target.closest("[data-close-history]")) closeHistoryMatch(); });
  try {
    const value = await api("/api/versus/profile/match", { method:"POST", body:{ playerId:account.profile.id, accountToken:account.accountToken, matchId } });
    const dialog = overlay.querySelector(".history-detail-dialog");
    if (dialog) {
      dialog.innerHTML = historyMatchMarkup(value.match);
      const environment = dialog.querySelector(".history-detail-score em");
      if (environment) environment.textContent += ` · ⚖ ${refereeText(value.match.referee)}${value.match.blackWhistle ? " · 出现争议判罚" : ""}`;
    }
  } catch (error) {
    closeHistoryMatch();
    showToast(error.message);
  }
}

function broadcastListMarkup(leagueOnly = false) {
  const broadcasts = leagueOnly ? liveBroadcasts.filter((broadcast) => String(broadcast.code).startsWith("YDL-")) : liveBroadcasts;
  const matches = broadcasts.length
    ? broadcasts.map((broadcast) => `<button class="broadcast-card" data-watch-room="${escapeHtml(broadcast.code)}"><span><i>LIVE</i><small>${broadcast.minute}' · ${weatherIcon(broadcast.weather)} ${escapeHtml(broadcast.weather?.name ?? "比赛中")}</small></span><div><b>${escapeHtml(broadcast.teams[0].name)}</b><strong>${broadcast.score[0]} : ${broadcast.score[1]}</strong><b>${escapeHtml(broadcast.teams[1].name)}</b></div><em>${broadcast.spectatorCount} 人正在观看 · 进入直播 ›</em></button>`).join("")
    : `<p class="broadcast-empty">当前没有正在进行的公开比赛。</p>`;
  return `<section class="broadcast-hub ${leagueOnly ? "league-television" : ""}"><header><div><small>${leagueOnly ? "YDL TELEVISION" : "FT1 TELEVISION"}</small><h2>${leagueOnly ? "黄狗联赛电视台" : "比赛电视台"}</h2></div><b>${broadcasts.length} 场直播</b></header><div class="broadcast-list">${matches}</div></section>`;
}

async function refreshBroadcasts() {
  if (spectatorSession) return;
  try {
    const value = await api("/api/versus/broadcasts");
    liveBroadcasts = value.broadcasts ?? [];
    const hub = document.querySelector(".broadcast-hub");
    if (hub) hub.outerHTML = broadcastListMarkup(leagueMode && leagueTab === "television");
  } catch { /* 房间轮询会继续处理网络状态 */ }
}

function broadcastPitchMarkup(team) {
  const magnets = team.players
    .filter((player) => player.active || player.sentOff || player.injury)
    .map(broadcastMagnet)
    .join("");
  return pitchMarkup(magnets, "", "live-pitch broadcast-pitch s4-readonly-pitch");
}

function broadcastTeamPanel(team) {
  const strategy = `${TACTICS[team.tactic]} · ${STYLES[team.style]} · 主攻${FOCUSES[team.attackFocus]} · 主守${FOCUSES[team.defenseFocus]} · 适配 ${Math.round(team.styleFit * 100)}%`;
  return `<section class="live-team-panel broadcast-team-panel"><header><div><h2>${escapeHtml(team.name)}${team.importedLineup ? `<span class="lineup-origin-badge">自带阵容</span>` : ""}</h2><small>${escapeHtml(team.formation)} · ${team.activeCount} 人</small></div><span class="broadcast-strategy">${escapeHtml(strategy)}</span></header>${broadcastPitchMarkup(team)}<footer>${escapeHtml(strategy)}</footer></section>`;
}

function captureEventFeedScroll(root) {
  const feed = root?.querySelector?.(".event-feed");
  if (!feed) return null;
  return { scrollTop: feed.scrollTop, scrollHeight: feed.scrollHeight, followingLatest: feed.scrollTop <= 12 };
}

function restoreEventFeedScroll(root, snapshot) {
  if (!snapshot) return;
  const feed = root?.querySelector?.(".event-feed");
  if (!feed) return;
  feed.scrollTop = snapshot.followingLatest ? 0 : snapshot.scrollTop + Math.max(0, feed.scrollHeight - snapshot.scrollHeight);
}

function broadcastScreenMarkup(broadcast) {
  const match = broadcast.match;
  const latestEvent = match.events.at(-1);
  const latestIcon = latestEvent ? ({ goal:"⚽",yellow:"■",red:"■",injury:"✚",lightning:"ϟ",penaltyAwarded:"P",shootout:"P",tactical:"↔" }[latestEvent.type] ?? "•") : "";
  const centerValue = match.segment === "penalties" ? `${match.penalties?.score?.[0] ?? 0}:${match.penalties?.score?.[1] ?? 0}` : `${match.minute}'`;
  const viewerNames = broadcast.spectators.length ? broadcast.spectators.map((viewer) => escapeHtml(viewer.name)).join("、") : "暂无其他观众";
  return `<section class="broadcast-screen"><header class="broadcast-toolbar"><button class="button secondary" data-leave-broadcast>${broadcast.live ? "退出观赛" : "关闭详情"}</button><div><i>${broadcast.live ? "LIVE" : "FT"}</i><b>FT1 比赛电视台</b><small>房间 ${escapeHtml(broadcast.code)} · 第 ${broadcast.round} 轮</small></div><span><b>${broadcast.spectators.length} 人观看</b><small>${viewerNames}</small></span></header>${broadcast.live ? "" : `<div class="broadcast-ended">比赛已经结束，正在显示最终比赛详情。</div>`}<section class="match-shell broadcast-match-shell"><header class="scoreboard"><div><small>${escapeHtml(match.teams[0].name)}</small><b>${match.score[0]}</b><em>${match.teams[0].activeCount} 人 · ${escapeHtml(match.teams[0].formation)}</em></div><span><small>${broadcast.live ? matchPhaseLabel(match) : "比赛结束"}</small><strong>${centerValue}</strong><em>${weatherIcon(match.weather)} ${escapeHtml(match.weather.name)}</em></span><div><small>${escapeHtml(match.teams[1].name)}</small><b>${match.score[1]}</b><em>${match.teams[1].activeCount} 人 · ${escapeHtml(match.teams[1].formation)}</em></div></header><div class="match-layout match-triple-layout">${broadcastTeamPanel(match.teams[0])}<section class="commentary-panel match-center-panel"><header><h2>${broadcast.live ? "实时战况" : "比赛详情"}</h2><span>${match.events.length}</span></header>${latestEvent ? `<div class="latest-event event-${latestEvent.type}"><i>${latestIcon}</i><b>${latestEvent.minute}'</b><span>${escapeHtml(latestEvent.text)}</span></div>` : ""}<div class="event-feed">${match.events.length ? [...match.events].reverse().map(matchEventMarkup).join("") : `<p class="feed-empty">比赛进行中</p>`}</div>${matchStatsMarkup(match)}</section>${broadcastTeamPanel(match.teams[1])}</div></section></section>`;
}

function renderBroadcast(broadcast) {
  let overlay = document.querySelector("#broadcast-overlay");
  if (!overlay) {
    document.body.insertAdjacentHTML("beforeend", `<div class="broadcast-overlay" id="broadcast-overlay"></div>`);
    overlay = document.querySelector("#broadcast-overlay");
  }
  const feedScroll = captureEventFeedScroll(overlay);
  overlay.innerHTML = broadcastScreenMarkup(broadcast);
  restoreEventFeedScroll(overlay, feedScroll);
  const environment = overlay.querySelector(".scoreboard>span>em");
  if (environment && broadcast.match.referee) environment.textContent += ` · ⚖ ${refereeText(broadcast.match.referee)}`;
  overlay.querySelector("[data-leave-broadcast]").onclick = closeBroadcast;
}

async function startWatching(code) {
  const name = ownPlayer()?.name ?? document.querySelector("#player-name")?.value.trim() ?? account?.profile?.nickname ?? "匿名观众";
  try {
    const value = await api("/api/versus/watch", { method:"POST", body:{ code, name } });
    spectatorSession = { code, token:value.spectatorToken };
    renderBroadcast(value.broadcast);
    scheduleSpectatorPolling();
  } catch (error) { showToast(error.message); }
}

function scheduleSpectatorPolling(delay = 350) {
  clearTimeout(spectatorPolling);
  if (spectatorSession) spectatorPolling = setTimeout(refreshBroadcast, delay);
}

async function refreshBroadcast() {
  if (!spectatorSession) return;
  try {
    const value = await api(`/api/versus/watch/${spectatorSession.code}`, { token:spectatorSession.token });
    renderBroadcast(value.broadcast);
    if (value.broadcast.live) scheduleSpectatorPolling(350);
    else clearTimeout(spectatorPolling);
  } catch (error) {
    closeBroadcast(false);
    showToast(error.message);
  }
}

async function closeBroadcast(notifyServer = true) {
  const active = spectatorSession;
  spectatorSession = null;
  clearTimeout(spectatorPolling);
  document.querySelector("#broadcast-overlay")?.remove();
  if (notifyServer && active) {
    try { await api(`/api/versus/watch/${active.code}/leave-watch`, { method:"POST", token:active.token }); } catch { /* 心跳超时也会自动清理 */ }
  }
  refreshBroadcasts();
}

async function bindIdentity() {
  if (!account?.profile?.id || !account?.accountToken) throw new Error("请先登录账号");
  return { playerId:account.profile.id, accountToken:account.accountToken, name:account.profile.nickname };
}

function renderAuth() {
  room = null;
  updateChrome();
  const registering = authMode === "register";
  app.innerHTML = `<section class="auth-shell"><div class="auth-brand"><p class="eyebrow">PLAYER ACCOUNT</p><h1>${registering ? "创建你的球队身份" : "欢迎回到比赛"}</h1></div><form class="auth-panel" id="auth-form"><div class="auth-tabs" role="tablist"><button type="button" data-auth-mode="login" class="${registering ? "" : "active"}">登录</button><button type="button" data-auth-mode="register" class="${registering ? "active" : ""}">注册</button></div><label class="field"><span>昵称</span><input id="auth-nickname" autocomplete="username" value="${escapeHtml(account?.profile?.nickname ?? "")}" required autofocus /></label><label class="field"><span>密码</span><input id="auth-password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" required /></label><button class="button primary wide" type="submit">${registering ? "注册并进入" : "登录"}</button><p class="auth-error" id="auth-error"></p></form></section>`;
  app.querySelectorAll("[data-auth-mode]").forEach((button) => { button.onclick = () => { authMode = button.dataset.authMode; renderAuth(); }; });
  document.querySelector("#auth-form").onsubmit = authenticate;
}

async function authenticate(event) {
  event.preventDefault();
  const submit = event.currentTarget.querySelector("button[type=submit]");
  const error = document.querySelector("#auth-error");
  submit.disabled = true;
  error.textContent = authMode === "register" ? "正在创建账号…" : "正在登录…";
  try {
    const value = await api(`/api/versus/${authMode}`, { method:"POST", body:{ nickname:document.querySelector("#auth-nickname").value, password:document.querySelector("#auth-password").value, legacyAccountToken:account?.accountToken ?? null } });
    storeAccount({ accountToken:value.accountToken, profile:value.profile });
    renderLanding();
  } catch (authError) {
    error.textContent = authError.message;
    submit.disabled = false;
  }
}

function logoutAccount() {
  clearTimeout(polling);
  stopRoomStream();
  storeSession(null);
  storeAccount(null);
  room = null;
  authMode = "login";
  renderAuth();
}

function renderLanding() {
  leagueMode = false;
  league = null;
  room = null;
  updateChrome();
  const developerControls = publicHosting ? "" : `<div class="divider">开发者测试</div><div class="developer-actions"><button class="button secondary" id="dev-full-flow">单人完整流程</button><button class="button secondary" id="dev-quick-start">快速进入比赛</button></div>`;
  app.innerHTML = `<section class="landing"><div class="landing-copy"><h1>选出你的十一人，<span>决定比赛的方式。</span></h1>${profileMarkup()}</div><section class="room-console mode-console"><h2>${escapeHtml(account.profile.nickname)}</h2><p class="bound-player-id">玩家ID <b>${escapeHtml(account.profile.id)}</b></p><label class="field"><span>自定义分享码</span><input id="custom-room-code" maxlength="20" autocomplete="off" placeholder="快速比赛与锦标赛可选" /></label><div class="competition-create mode-selector"><button class="mode-button mode-quick" id="create-room">快速比赛</button><button class="mode-button mode-cup" id="create-tournament">锦标赛</button><button class="mode-button mode-league" id="open-league">黄狗联赛</button></div><div class="divider">加入已有好友房间</div><label class="field"><span>分享码</span><input id="room-code" maxlength="20" autocomplete="off" placeholder="输入分享码" /></label><button class="button secondary wide" id="join-room">加入房间</button>${developerControls}</section></section>`;
  document.querySelector(".landing-copy")?.insertAdjacentHTML("beforeend", broadcastListMarkup());
  refreshBroadcasts();
  document.querySelector("#create-room").onclick = () => createRoom("quick");
  document.querySelector("#create-tournament").onclick = () => createRoom("tournament");
  document.querySelector("#open-league").onclick = openLeague;
  document.querySelector("#join-room").onclick = () => joinRoom();
  const fullFlowButton = document.querySelector("#dev-full-flow");
  const quickStartButton = document.querySelector("#dev-quick-start");
  if (fullFlowButton) fullFlowButton.onclick = () => createDeveloperRoom(false);
  if (quickStartButton) quickStartButton.onclick = () => createDeveloperRoom(true);
  document.querySelector("#room-code").oninput = (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""); };
  document.querySelector("#custom-room-code").oninput = (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""); };
}

function leagueIdentity(extra = {}) {
  return { playerId:account.profile.id, accountToken:account.accountToken, ...extra };
}

async function leagueRequest(path, body = {}) {
  leagueMutationPending = true;
  try {
    const value = await api(`/api/versus/league${path}`, { method:"POST", body:leagueIdentity(body) });
    league = value.league;
    leagueEditorDirty = false;
    renderLeague();
    return league;
  } finally {
    leagueMutationPending = false;
  }
}

function ensureLeagueTacticalDraft() {
  if (leagueTacticalDraft) return leagueTacticalDraft;
  const plans = league.ownTeam.tacticalPlans ?? {};
  leagueTacticalDraft = {
    fitnessThreshold:Number(league.ownTeam.fitnessThreshold ?? 65),
    attackFocus:league.ownTeam.attackFocus ?? "balanced",
    defenseFocus:league.ownTeam.defenseFocus ?? "balanced",
    tacticalPlans:{
      opening:{ tactic:plans.opening?.tactic ?? league.ownTeam.tactic, style:plans.opening?.style ?? league.ownTeam.style, positionPreset:plans.opening?.positionPreset ?? "position1" },
      leading:{ tactic:plans.leading?.tactic ?? "defensive", style:plans.leading?.style ?? "counterAttack", positionPreset:plans.leading?.positionPreset ?? "position2" },
      trailing:{ tactic:plans.trailing?.tactic ?? "positive", style:plans.trailing?.style ?? "highPress", positionPreset:plans.trailing?.positionPreset ?? "position3" },
    },
  };
  return leagueTacticalDraft;
}

function captureLeagueTacticalControls() {
  const form = document.querySelector("#league-squad-form");
  const draft = ensureLeagueTacticalDraft();
  if (!form) return draft;
  const data = new FormData(form);
  draft.fitnessThreshold = Number(data.get("fitnessThreshold") ?? draft.fitnessThreshold);
  draft.attackFocus = data.get("attackFocus") ?? draft.attackFocus;
  draft.defenseFocus = data.get("defenseFocus") ?? draft.defenseFocus;
  ["opening", "leading", "trailing"].forEach((state) => {
    draft.tacticalPlans[state] = {
      tactic:data.get(`${state}Tactic`) ?? draft.tacticalPlans[state].tactic,
      style:data.get(`${state}Style`) ?? draft.tacticalPlans[state].style,
      positionPreset:state === "opening" ? "position1" : state === "leading" ? "position2" : "position3",
    };
  });
  return draft;
}

function setLeagueAutoSaveStatus(state, textValue) {
  const status = document.querySelector("[data-league-autosave-status]");
  if (!status) return;
  status.dataset.state = state;
  status.textContent = textValue;
}

function leagueTeamSavePayload() {
  const draft = captureLeagueTacticalControls();
  leaguePositionPresets[leagueActivePositionPreset] = leaguePositions;
  return {
    starterIds:[...leagueStartingIds],
    positions:structuredClone(leaguePositionPresets.position1),
    positionPresets:structuredClone(leaguePositionPresets),
    fitnessThreshold:draft.fitnessThreshold,
    tacticalPlans:structuredClone(draft.tacticalPlans),
    attackFocus:draft.attackFocus,
    defenseFocus:draft.defenseFocus,
  };
}

function leaguePositionPresetsAreValid() {
  const roster = league?.ownTeam?.roster ?? [];
  const startingSet = new Set(leagueStartingIds ?? []);
  const starters = roster.filter((player) => startingSet.has(player.id));
  return starters.length === 11 && Object.entries(leaguePositionPresets ?? {}).every(([key, positions]) => {
    return formationFromPositions(starters, positions, { requireOutfieldLines:key === "position1" }).valid;
  });
}

async function saveLeagueTeamNow() {
  clearTimeout(leagueAutoSaveTimer);
  leagueAutoSaveTimer = null;
  if (!leagueMode || leagueTab !== "squad" || !leagueStartingIds || !leaguePositionPresets) return;
  if (!leaguePositionPresetsAreValid()) {
    setLeagueAutoSaveStatus("error", "站位待调整");
    return;
  }
  if (leagueAutoSavePending) {
    leagueAutoSaveTimer = setTimeout(saveLeagueTeamNow, 180);
    return;
  }
  const revision = leagueAutoSaveRevision;
  const payload = leagueTeamSavePayload();
  leagueAutoSavePending = true;
  leagueMutationPending = true;
  setLeagueAutoSaveStatus("saving", "正在自动保存…");
  try {
    const value = await api("/api/versus/league/team", { method:"POST", body:leagueIdentity(payload) });
    league = value.league;
    if (revision === leagueAutoSaveRevision) {
      leagueEditorDirty = false;
      setLeagueAutoSaveStatus("saved", "已实时保存");
    }
  } catch (error) {
    setLeagueAutoSaveStatus("error", "保存失败");
    showToast(error.message);
  } finally {
    leagueAutoSavePending = false;
    leagueMutationPending = false;
    if (revision !== leagueAutoSaveRevision) leagueAutoSaveTimer = setTimeout(saveLeagueTeamNow, 180);
  }
}

function scheduleLeagueTeamAutoSave(delay = 420) {
  if (!leagueMode || leagueTab !== "squad" || !leagueStartingIds || !leaguePositionPresets) return;
  captureLeagueTacticalControls();
  leaguePositionPresets[leagueActivePositionPreset] = leaguePositions;
  leagueEditorDirty = true;
  leagueAutoSaveRevision += 1;
  clearTimeout(leagueAutoSaveTimer);
  if (!leaguePositionPresetsAreValid()) {
    setLeagueAutoSaveStatus("error", "站位待调整");
    return;
  }
  setLeagueAutoSaveStatus("pending", "等待自动保存");
  leagueAutoSaveTimer = setTimeout(saveLeagueTeamNow, delay);
}

function leagueInteractionActive() {
  const focused = document.activeElement;
  const editingField = focused && app.contains(focused) && focused.matches("input, select, textarea, [contenteditable='true']");
  return draggingMagnet || controlInteraction || leagueMutationPending || leagueEditorDirty || editingField
    || Boolean(document.querySelector("#league-dialog-overlay")) || Boolean(league?.shop?.offer);
}

async function refreshLeagueSilently() {
  if (!leagueMode || !league || !account?.profile?.id || document.hidden || leagueSyncPending || leagueInteractionActive()) return;
  leagueSyncPending = true;
  try {
    const value = await api("/api/versus/league", { method:"POST", body:leagueIdentity() });
    const changed = value.league?.updatedAt !== league.updatedAt;
    league = value.league;
    if (changed && !leagueInteractionActive()) renderLeague();
  } catch {
    // Background synchronization is retried on the next interval.
  } finally {
    leagueSyncPending = false;
  }
}

async function openLeague() {
  leagueMode = true;
  leagueEditorDirty = false;
  leagueStartingIds = null;
  leaguePositions = null;
  leaguePositionPresets = null;
  leagueActivePositionPreset = "position1";
  leagueTacticalDraft = null;
  clearTimeout(leagueAutoSaveTimer);
  leagueAutoSaveTimer = null;
  room = null;
  storeSession(null);
  updateChrome();
  app.innerHTML = `<section class="league-loading"><p class="eyebrow">YELLOWDOGS LEAGUE</p><h1>正在读取联赛数据…</h1></section>`;
  try { await leagueRequest(""); }
  catch (error) { leagueMode = false; showToast(error.message); renderLanding(); }
}

function leagueStandingRows() {
  return league.teams.map((team) => {
    const badges = (team.championBadges ?? []).map((badge) => { const isCup = badge.competition === "cup" || badge.type === "cup-champion"; const title = `${badge.season}赛季${isCup ? "杯赛" : "联赛"}冠军`; return `<span class="champion-badge ${isCup ? "cup-champion-badge" : ""}" title="${escapeHtml(title)}"><i>${isCup ? "🏆" : "♛"}</i>${escapeHtml(badge.season)}</span>`; }).join("");
    const owner = team.ownerName ? `<small>${escapeHtml(team.ownerName)}${badges}</small>` : "";
    return `<tr class="${league.ownTeam?.id === team.id ? "is-own" : ""}"><td><b>${team.rank}</b></td><td><span class="club-type">${team.isAi ? "AI" : "玩家"}</span><button class="league-team-link" data-league-team-detail="${team.id}">${escapeHtml(team.name)}</button>${owner}</td><td>${team.table.played}</td><td>${team.table.won}</td><td>${team.table.drawn}</td><td>${team.table.lost}</td><td>${team.table.goalsFor}:${team.table.goalsAgainst}</td><td>${team.table.goalsFor - team.table.goalsAgainst > 0 ? "+" : ""}${team.table.goalsFor - team.table.goalsAgainst}</td><td><strong>${team.table.points}</strong></td></tr>`;
  }).join("");
}

function leagueJoinMarkup() {
  const create = league.aiSlotsRemaining > 0
    ? `<form class="league-create-team" id="league-create-team-form"><label class="field"><span>球队名称</span><input name="teamName" maxlength="30" autocomplete="off" required autofocus /></label><button class="button primary wide" type="submit">创建球队并开始选秀</button></form>`
    : `<p class="league-empty">当前10支球队都已由真人创建，新玩家将在后续扩容时加入。</p>`;
  return `<section class="league-shell league-join"><header class="league-hero"><div><p class="eyebrow">S1 · YELLOWDOGS LEAGUE</p><h1>创建你的球队</h1></div><div class="league-clock"><small>比赛时段</small><b>10:00—22:00</b><span>每20分钟一轮 · 服务器离线暂停</span></div></header><div class="league-create-shell"><div><small>CREATE A CLUB</small><h2>球队将加入当前联赛</h2><p>剩余席位 ${league.aiSlotsRemaining}/10</p></div>${create}</div><button class="button secondary" data-league-back>返回首页</button></section>`;
}

function s4UpgradeBand(level) {
  if (level >= 8) return "max";
  if (level >= 5) return "high";
  if (level >= 1) return "mid";
  return "base";
}

function s4PlayerCardMarkup(player, options = {}) {
  const card = options.card ?? null;
  const upgradeLevel = Math.max(0, Number(card?.upgradeLevel ?? options.upgradeLevel ?? 0));
  const displayedOverall = Number(card?.effectiveOverall ?? player.effectiveOverall ?? player.overall ?? 0);
  const band = s4UpgradeBand(upgradeLevel);
  const traits = (card?.traits ?? options.traits ?? []).map((trait) => typeof trait === "string" ? trait : trait?.name).filter(Boolean);
  const traitMarkup = traits.length ? `<strong class="s4-player-card-traits">${traits.map(escapeHtml).join("<br>")}</strong>` : "";
  const upgradeMarkup = upgradeLevel ? `<span class="s4-player-card-upgrade band-${band}">+${upgradeLevel}</span>` : "";
  const attributes = options.attributes ?? "";
  const delay = Number(options.delay ?? 0);
  return `<button type="button" class="s4-player-card grade-${String(player.grade ?? "C").toLowerCase()} band-${band} ${options.compact ? "compact" : ""} ${options.animated ? "animated" : ""}" style="--delay:${delay}ms" ${attributes} aria-label="${escapeHtml(`${player.name}，能力${displayedOverall}，${ROLE_LABELS[player.role] ?? player.role ?? "待选择位置"}${upgradeLevel ? `，强化+${upgradeLevel}` : ""}`)}">
    ${upgradeMarkup}
    <div class="s4-player-card-head"><strong>${displayedOverall}</strong>${player.role ? `<b>${escapeHtml(player.role)}</b>` : ""}</div>
    <div class="s4-player-card-grade"><span>${escapeHtml(player.grade ?? "C")}</span></div>
    <div class="s4-player-card-name"><h3>${escapeHtml(player.name)}</h3></div>
    <footer><b>${escapeHtml(player.club ?? "无俱乐部")} / ${escapeHtml(player.nationality ?? "无国家队")}</b>${traitMarkup}</footer>
  </button>`;
}

function xPlayerDraftMarkup() {
  const draft = league.draft;
  if (!draft.xPlayerId) {
    const cards = draft.xPlayers.map((player, index) => s4PlayerCardMarkup(player, { animated:true, delay:index * 45, attributes:`data-x-player-choose="${player.id}"` })).join("");
    return `<section class="x-draft-stage"><header><small>UNIQUE X PLAYER</small><h2>选择你的X级太子球员</h2><p>每名X球员全服唯一，不占33人大名单名额。</p></header><div class="x-player-choice-grid">${cards}</div></section>`;
  }
  if (!draft.xRole || !draft.xHeightCm) {
    const primaryOptions = draft.xRoles.map((role) => `<option value="${role}">${ROLE_LABELS[role] ?? role}</option>`).join("");
    const secondaryOptions = draft.xRoles.filter((role) => role !== "GK").map((role) => `<option value="${role}">${ROLE_LABELS[role] ?? role}</option>`).join("");
    return `<section class="x-draft-stage x-config-stage"><header><small>DEFINE THE PLAYER</small><h2>设置${escapeHtml(draft.xPlayer.name)}的位置与身高</h2><p>门将不能选择副位置；非门将必须设置不同的副位置。</p></header><div class="x-config-layout">${s4PlayerCardMarkup(draft.xPlayer, {})}<form id="x-player-config-form"><label class="field"><span>主位置</span><select name="role" required><option value="">请选择</option>${primaryOptions}</select></label><label class="field"><span>副位置</span><select name="secondaryRole"><option value="">请选择</option>${secondaryOptions}</select></label><label class="field"><span>身高（${draft.xHeightRange.min}-${draft.xHeightRange.max}cm）</span><input name="heightCm" type="number" min="${draft.xHeightRange.min}" max="${draft.xHeightRange.max}" value="175" required></label><button class="button primary wide" type="submit">确认位置与身高</button></form></div></section>`;
  }
  if (!draft.xTraitId) {
    const traits = draft.xTraits.map((trait) => `<button type="button" class="x-trait-choice" data-x-trait-choose="${trait.id}"><b>${escapeHtml(trait.name)}</b><span>${escapeHtml(trait.summary)}</span></button>`).join("");
    return `<section class="x-draft-stage"><header><small>INITIAL TRAIT</small><h2>选择${escapeHtml(draft.xPlayer.name)}的开局特性</h2><p>当前主位置：${escapeHtml(ROLE_LABELS[draft.xRole] ?? draft.xRole)}。这里只展示全位置及适用于该位置的特性。</p></header><div class="x-trait-choice-grid">${traits}</div></section>`;
  }
  const trait = draft.xTraits.find((entry) => entry.id === draft.xTraitId);
  return `<section class="x-draft-complete"><div>${s4PlayerCardMarkup(draft.xPlayer, { traits:trait ? [trait.name] : [] })}</div><section><small>X PLAYER READY</small><h2>${escapeHtml(draft.xPlayer.name)}配置完成</h2><dl><div><dt>主位置</dt><dd>${escapeHtml(ROLE_LABELS[draft.xRole] ?? draft.xRole)}</dd></div><div><dt>副位置</dt><dd>${escapeHtml(ROLE_LABELS[draft.xSecondaryRole] ?? draft.xSecondaryRole ?? "无")}</dd></div><div><dt>身高</dt><dd>${draft.xHeightCm}cm</dd></div><div><dt>开局特性</dt><dd>${escapeHtml(trait?.name ?? "-")}</dd></div></dl><button class="button primary wide" data-league-finish>确认建队并获得X球员</button></section></section>`;
}

function s4PackVisualMarkup(pack, options = {}) {
  const pool = String(pack.pool ?? "MIXED").toUpperCase();
  const kind = String(pack.kind ?? "");
  const tone = kind === "legend" || pool === "LEGEND" ? "legend"
    : kind === "public" ? "public"
      : pool === "ATT" ? "att"
        : pool === "MID" ? "mid"
          : pool === "DEF" ? "def"
            : pool === "GK" ? "gk"
              : "mixed";
  const code = tone === "legend" ? "LEG" : tone === "public" ? "PUB" : pool === "MIXED" ? "ALL" : pool;
  const label = tone === "legend" ? "传奇" : tone === "public" ? "公共池" : pool === "MIXED" ? "全位置" : LINE_LABELS[pool] ?? pack.name;
  const tag = options.tag === "button" ? "button" : "div";
  const buttonAttributes = tag === "button" ? `type="button"${options.disabled ? " disabled" : ""}` : "";
  const state = options.state ? `<span class="s4-pack-state">${escapeHtml(options.state)}</span>` : "";
  return `<${tag} class="s4-pack-visual tone-${tone} ${options.className ?? ""}" ${buttonAttributes} ${options.attributes ?? ""} aria-label="${escapeHtml(pack.name ?? `${label}卡包`)}">
    <span class="s4-pack-glint" aria-hidden="true"></span>
    <span class="s4-pack-code">${code}</span>
    <span class="s4-pack-emblem" aria-hidden="true"><i></i></span>
    <b>${escapeHtml(label)}</b>
    ${state}
  </${tag}>`;
}

function leagueDraftMarkup() {
  const selected = league.draft.selectedPlayers;
  const counts = league.draft.counts;
  const draftPoolOrder = ["ATT", "MID", "DEF", "GK"];
  const poolButtons = draftPoolOrder.map((pool) => s4PackVisualMarkup(
    { pool, kind:"draft", name:`${LINE_LABELS[pool]}选人卡包` },
    { tag:"button", className:"league-pool-draw", attributes:`data-league-draw="${pool}"`, disabled:!league.draft.allowedPools.includes(pool) },
  )).join("");
  const offer = league.draft.offer.length
    ? `<div class="league-card-offer"><header><small>${LINE_LABELS[league.draft.offerPool]}候选</small><h2>从三张卡牌中签下一人</h2></header><div class="league-flip-grid s4-player-card-choice-grid">${league.draft.offer.map((player,index) => s4PlayerCardMarkup(player, { animated:true, delay:index * 90, attributes:`data-league-choose="${player.id}"` })).join("")}</div></div>`
    : selected.length === 22
      ? xPlayerDraftMarkup()
      : `<div class="league-pool-stage"><header><small>PICK A POSITION</small><h2>选择下一次翻卡的位置</h2></header><div class="league-pool-grid">${poolButtons}</div><p>选择位置后将展示该位置的候选球员。</p></div>`;
  const roster = selected.length ? selected.map((player,index) => `<div class="league-drafted-player"><span>${index + 1}</span><i class="grade grade-${player.grade}">${player.grade}</i><b>${escapeHtml(player.name)}<small>${ROLE_LABELS[player.role] ?? player.role}</small></b><strong>${player.overall}</strong></div>`).join("") : `<p class="league-empty">尚未签下球员</p>`;
  return `<section class="league-shell"><header class="league-work-head"><div><p class="eyebrow">22-PLAYER DRAFT</p><h1>翻卡建立注册名单</h1></div><div class="draft-total"><small>已签下</small><b>${selected.length}<em>/22</em></b></div></header><div class="league-card-draft-layout"><main>${offer}</main><aside class="league-drafted-list"><header><div><small>MY 22</small><h2>已签球员</h2></div><button class="button secondary danger" data-league-reset ${selected.length ? "" : "disabled"}>重置</button></header><div class="league-draft-side-counts"><span>前场 <b>${counts.ATT}</b></span><span>中场 <b>${counts.MID}</b></span><span>后场 <b>${counts.DEF}</b></span><span>门将 <b>${counts.GK}</b></span></div><div class="league-drafted-roster">${roster}</div></aside></div></section>`;
}

function leagueMatchRow(match, historyTeamId = null) {
  const canOpen = match.hasDetails && (!historyTeamId || match.homeId === historyTeamId || match.awayId === historyTeamId);
  const score = match.score ? `${match.score[0]} : ${match.score[1]}` : "-：-";
  const label = match.competition === "friendly" ? "友谊赛" : `第 ${match.round} 轮`;
  return `<button type="button" class="league-result ${match.hasPlayerTeam ? "has-player" : ""}" ${canOpen ? `data-league-match-detail="${escapeHtml(match.id)}"` : "disabled"}><span>${label}</span><b>${escapeHtml(match.homeName)}</b><strong>${score}</strong><b>${escapeHtml(match.awayName)}</b><small>${canOpen ? "查看比赛 ›" : match.pending ? "未开赛" : escapeHtml(match.formations?.join(" vs ") ?? "")}</small></button>`;
}

function leagueMatchCentreMarkup() {
  const rounds = league.matchRounds ?? [];
  if (!rounds.length) return `<p class="league-empty">联赛尚未进行比赛。</p>`;
  const availableRounds = rounds.map((entry) => entry.round).sort((a,b) => a - b);
  if (!availableRounds.includes(leagueRoundPage)) leagueRoundPage = Math.min(league.season.totalRounds, Math.max(1, league.season.currentRound + 1));
  const roundIndex = availableRounds.indexOf(leagueRoundPage);
  const selectedRound = rounds.find((entry) => entry.round === leagueRoundPage);
  if (!league.teams.some((team) => team.id === leagueHistoryTeamId)) leagueHistoryTeamId = league.ownTeam.id;
  const historyTeam = league.teams.find((team) => team.id === leagueHistoryTeamId) ?? league.ownTeam;
  const history = league.recentMatches.filter((match) => match.homeId === historyTeam.id || match.awayId === historyTeam.id);
  const teamOptions = league.teams.map((team) => `<option value="${team.id}" ${team.id === historyTeam.id ? "selected" : ""}>${escapeHtml(team.name)}</option>`).join("");
  const heading = selectedRound.status === "complete" ? "赛果" : "赛程";
  return `<div class="league-match-centre"><section><header><div><small>ROUND RESULTS</small><h3>第 ${leagueRoundPage} 轮${heading}</h3></div><nav class="league-round-pager"><button class="icon-button" data-league-round="${availableRounds[roundIndex - 1] ?? ""}" ${roundIndex <= 0 ? "disabled" : ""} aria-label="上一轮">‹</button><span>${roundIndex + 1}/${availableRounds.length}</span><button class="icon-button" data-league-round="${availableRounds[roundIndex + 1] ?? ""}" ${roundIndex >= availableRounds.length - 1 ? "disabled" : ""} aria-label="下一轮">›</button></nav></header><div>${selectedRound.matches.map((match) => leagueMatchRow(match)).join("")}</div></section><section><header><div><small>TEAM HISTORY</small><h3>${escapeHtml(historyTeam.name)}历史战绩</h3></div><select data-league-history-team aria-label="选择球队">${teamOptions}</select></header><div class="league-history-list">${history.length ? history.map((match) => leagueMatchRow(match, historyTeam.id)).join("") : `<p class="league-empty">这支球队还没有比赛记录。</p>`}</div></section></div>`;
}

function leagueOverviewMarkup() {
  const report = league.report;
  return `<div class="league-dashboard-grid"><section class="league-panel standings-panel"><header><div><small>LEAGUE TABLE</small><h2>积分榜</h2></div><b>${league.season.currentRound}/${league.season.totalRounds} 轮</b></header><div class="league-table-wrap"><table class="league-table"><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进失</th><th>净胜</th><th>分</th></tr></thead><tbody>${leagueStandingRows()}</tbody></table></div></section><aside class="league-report"><header><small>DAILY REPORT</small><h2>${escapeHtml(report.headline)}</h2></header><div class="report-rank"><span>当前排名</span><b>${report.rank}<em>/10</em></b></div><dl><div><dt>赛季战绩</dt><dd>${report.record}</dd></div><div><dt>今日战绩</dt><dd>${report.today.wins}胜 ${report.today.draws}平 ${report.today.losses}负</dd></div><div><dt>积分</dt><dd>${report.points}</dd></div><div><dt>本队最佳</dt><dd>${report.bestPlayer ? `${escapeHtml(report.bestPlayer.name)} · ${report.bestPlayer.averageRating}` : "等待首场比赛"}</dd></div><div><dt>可用球员</dt><dd>${report.availability.available}/${report.availability.total}</dd></div></dl></aside><section class="league-panel recent-panel"><header><div><small>MATCH CENTRE</small><h2>赛果与球队战绩</h2></div>${league.developer && league.season.status === "active" ? `<button class="button secondary" data-league-simulate>模拟下一轮</button>` : ""}</header>${leagueMatchCentreMarkup()}</section>${leagueDailyReportMarkup(report)}</div>`;
}

function scheduleTimeText(value, withDate = true) {
  const date = new Date(Number(value));
  const time = date.toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit", hour12:false });
  if (!withDate) return time;
  return `${date.toLocaleDateString("zh-CN", { month:"numeric", day:"numeric", weekday:"short" })} ${time}`;
}

function scheduleCountdownText(target, now) {
  const minutes = Math.max(0, Math.ceil((target - now) / 60_000));
  if (minutes < 1) return "即将开始";
  if (minutes < 60) return `${minutes} 分钟后`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟后`;
}

function resolvedLeagueScheduleFixtures() {
  if (league.season?.status === "registration") return [];
  if (league.schedule?.fixtures?.length) return league.schedule.fixtures;
  const ownTeamId = league.ownTeam?.id;
  const interval = Number(league.schedule?.intervalMinutes ?? 20) * 60_000;
  const firstPendingAt = Number(league.season?.nextRoundAt ?? league.serverTime ?? Date.now());
  let pendingIndex = 0;
  return (league.matchRounds ?? []).map((round) => {
    const match = round.matches?.find((entry) => entry.homeId === ownTeamId || entry.awayId === ownTeamId);
    if (!match) return null;
    const ownIsHome = match.homeId === ownTeamId;
    const complete = Boolean(match.score);
    const live = !complete && round.status === "running";
    const startsAt = complete ? Number(match.playedAt) : live ? Number(league.serverTime ?? Date.now()) : firstPendingAt + pendingIndex++ * interval;
    return {
      id:`league:${league.season.id}:${round.round}:${ownTeamId}`,
      competition:"league",
      competitionName:"YellowDogs League",
      round:round.round,
      label:`联赛第${round.round}轮`,
      startsAt,
      status:complete ? "complete" : live ? "live" : "scheduled",
      opponentId:ownIsHome ? match.awayId : match.homeId,
      opponentName:ownIsHome ? match.awayName : match.homeName,
      venue:ownIsHome ? "home" : "away",
      matchId:match.id ?? null,
      broadcastCode:null,
      score:complete ? (ownIsHome ? [...match.score] : [match.score[1], match.score[0]]) : null,
    };
  }).filter(Boolean);
}

function leagueScheduleMarkup() {
  const fixtures = resolvedLeagueScheduleFixtures();
  const now = Number(league.serverTime ?? Date.now());
  const next = fixtures.find((fixture) => fixture.status !== "complete");
  const cards = fixtures.map((fixture) => {
    const isComplete = fixture.status === "complete";
    const isLive = fixture.status === "live";
    const result = isComplete ? `${fixture.score[0]} : ${fixture.score[1]}` : isLive ? "进行中" : scheduleCountdownText(fixture.startsAt, now);
    const action = isLive && fixture.broadcastCode
      ? `<button type="button" class="button primary" data-watch-room="${escapeHtml(fixture.broadcastCode)}">观看直播</button>`
      : isComplete && fixture.matchId
        ? `<button type="button" class="button secondary" data-league-match-detail="${escapeHtml(fixture.matchId)}">比赛详情</button>`
        : "";
    return `<article class="league-schedule-item ${isComplete ? "complete" : isLive ? "live" : "scheduled"}" data-schedule-start="${fixture.startsAt}"><time><small>${scheduleTimeText(fixture.startsAt, true)}</small><b>${scheduleTimeText(fixture.startsAt, false)}</b></time><div class="league-schedule-match"><span class="league-schedule-competition">${escapeHtml(fixture.competitionName)}</span><h2>${escapeHtml(fixture.opponentName)}</h2><small>${escapeHtml(fixture.label)}</small></div><strong>${result}</strong><div class="league-schedule-action">${action}</div></article>`;
  }).join("");
  const nextText = league.season?.status === "registration"
    ? "报名选人阶段：等待管理员开启联赛推进"
    : next
    ? next.status === "live" ? `正在进行：${next.competitionName} ${next.label} 对阵 ${next.opponentName}` : `下一场：${scheduleTimeText(next.startsAt)} ${next.competitionName} ${next.label} 对阵 ${next.opponentName}`
    : "本赛季全部赛程已结束";
  return `<section class="league-schedule"><header class="league-schedule-head"><div><small>CLUB CALENDAR</small><h2>球队日程表</h2><p>只显示已确定的本队比赛；服务器离线时赛程会暂停并顺延。</p></div><div class="league-schedule-now"><small>现在时间</small><b data-schedule-now-time>${scheduleTimeText(now)}</b><span data-schedule-next>${escapeHtml(nextText)}</span></div></header><div class="league-schedule-summary"><span>${fixtures.length} 场已排定比赛</span><b data-schedule-next-countdown>${next && next.status === "scheduled" ? scheduleCountdownText(next.startsAt, now) : next?.status === "live" ? "比赛进行中" : "赛季结束"}</b></div><div class="league-schedule-timeline" data-schedule-timeline>${cards || `<p class="league-empty">暂时没有已确定的比赛。</p>`}</div></section>`;
}

function leagueCupOverviewMarkup() {
  const cup = league.cup ?? { status:"waiting", stage:"waiting", standings:[], swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] } };
  if (cup.status === "waiting") return `<section class="league-cup-overview"><header><div><small>YELLOWDOGS CHAMPION CUP</small><h2>黄狗冠军杯</h2><p>等待管理员在后台开启黄狗冠军杯。</p></div><span>等待开启</span></header><div class="league-cup-empty"><b>黄狗冠军杯开启后将由10支球队进行4轮瑞士轮，再由前八名进入两回合淘汰赛。</b></div></section>`;
  const scoreText = (entry) => entry.score ? `${entry.score[0]} : ${entry.score[1]}${entry.penalties ? ` (${entry.penalties[0]} : ${entry.penalties[1]} 点)` : ""}` : "- : -";
  const swissStatus = { active:"进行中", qualified:"晋级", eliminated:"淘汰" };
  const swissRows = cup.standings.map((team) => `<tr class="${team.id === league.ownTeam.id ? "is-own" : ""}"><td>${team.rank}</td><td><button type="button" class="league-team-link" data-league-team-detail="${escapeHtml(team.id)}">${escapeHtml(team.name)}</button></td><td>${team.played}</td><td>${team.won}-${team.lost}</td><td>${team.goalsFor}:${team.goalsAgainst}</td><td><strong>${team.points}</strong></td><td><small class="cup-team-status status-${team.status ?? "active"}">${swissStatus[team.status] ?? swissStatus.active}</small></td></tr>`).join("");
  const swissRounds = cup.swissRounds ?? [];
  const swissRoundNumbers = swissRounds.map((round) => round.number);
  if (!swissRoundNumbers.includes(leagueCupRoundPage)) leagueCupRoundPage = swissRoundNumbers.at(-1) ?? 1;
  const swissRoundIndex = Math.max(0, swissRoundNumbers.indexOf(leagueCupRoundPage));
  const selectedSwissRound = swissRounds.find((round) => round.number === leagueCupRoundPage);
  const swissResultRows = selectedSwissRound?.fixtures.map((fixture) => {
    const canOpen = Boolean(fixture.matchId);
    return `<button type="button" class="league-result cup-result ${canOpen ? "has-player" : ""}" ${canOpen ? `data-league-match-detail="${escapeHtml(fixture.matchId)}"` : "disabled"}><span>第 ${selectedSwissRound.number} 轮</span><b>${escapeHtml(fixture.homeName)}</b><strong>${scoreText(fixture)}</strong><b>${escapeHtml(fixture.awayName)}</b><small>${canOpen ? "查看比赛 ›" : "等待对阵"}</small></button>`;
  }).join("") ?? `<p class="league-empty">下一轮对阵将在上一轮全部结束后生成。</p>`;
  const swissResults = `<section class="cup-rounds"><header><div><small>SWISS ROUND RESULTS</small><h3>瑞士轮第 ${leagueCupRoundPage} 轮${selectedSwissRound?.status === "complete" ? "赛果" : "对阵"}</h3></div><nav class="league-round-pager"><button class="icon-button" data-cup-round="${swissRoundNumbers[swissRoundIndex - 1] ?? ""}" ${swissRoundIndex <= 0 ? "disabled" : ""} aria-label="上一轮">‹</button><span>${swissRoundIndex + 1}/${swissRoundNumbers.length}</span><button class="icon-button" data-cup-round="${swissRoundNumbers[swissRoundIndex + 1] ?? ""}" ${swissRoundIndex >= swissRoundNumbers.length - 1 ? "disabled" : ""} aria-label="下一轮">›</button></nav></header><div>${swissResultRows}</div></section>`;
  const stageLabel = { quarterfinals:"四分之一决赛", semifinals:"半决赛", final:"决赛" };
  const tieMarkup = (tie, stage, index) => {
    if (!tie) return `<article class="cup-bracket-tie placeholder"><header><small>${stageLabel[stage]}</small><b>待定</b></header></article>`;
    const aggregate = tie.legs.reduce((total, leg, legIndex) => leg.score ? [total[0] + leg.score[legIndex === 0 ? 0 : 1], total[1] + leg.score[legIndex === 0 ? 1 : 0]] : total, [0, 0]);
    const legs = tie.legs.map((leg) => {
      const canOpen = Boolean(leg.matchId);
      const content = `<small>第${leg.number}回合</small><span>${escapeHtml(leg.homeName)}</span><b>${scoreText(leg)}</b><span>${escapeHtml(leg.awayName)}</span>`;
      return canOpen ? `<button type="button" data-league-match-detail="${escapeHtml(leg.matchId)}">${content}</button>` : `<div>${content}</div>`;
    }).join("");
    const winner = tie.teams.find((team) => team.id === tie.winnerId)?.name;
    return `<article class="cup-bracket-tie"><header><small>${stageLabel[stage]} ${index + 1}</small><b>${tie.legs.some((leg) => leg.score) ? `${stage === "final" ? "全场比分" : "总比分"} ${aggregate[0]} : ${aggregate[1]}` : "未开赛"}</b></header>${legs}${winner ? `<footer>${stage === "final" ? "冠军" : "晋级"}：${escapeHtml(winner)}</footer>` : ""}</article>`;
  };
  const quarterfinals = cup.knockout.quarterfinals ?? [];
  const semifinals = cup.knockout.semifinals ?? [];
  const finals = cup.knockout.final ?? [];
  const bracket = `<section class="cup-bracket cup-bracket-vertical"><header class="cup-bracket-heading"><small>KNOCKOUT BRACKET</small><h2>黄狗冠军杯淘汰赛</h2><p>八强和半决赛两回合，决赛单场决胜。</p></header><section class="cup-bracket-stage-stack stage-quarterfinals"><header><span>01</span><h3>四分之一决赛</h3><small>两回合</small></header><div>${[0,1,2,3].map((index) => tieMarkup(quarterfinals[index], "quarterfinals", index)).join("")}</div></section><section class="cup-bracket-stage-stack stage-semifinals"><header><span>02</span><h3>半决赛</h3><small>两回合</small></header><div>${[0,1].map((index) => tieMarkup(semifinals[index], "semifinals", index)).join("")}</div></section><section class="cup-bracket-stage-stack stage-final"><header><span>03</span><h3>决赛</h3><small>单场决胜</small></header><div>${tieMarkup(finals[0], "final", 0)}</div></section></section>`;
  const body = leagueCupPage === "swiss" ? `<div class="cup-swiss"><section class="league-panel"><header><div><small>SWISS STAGE</small><h2>瑞士轮积分榜</h2></div><b>${cup.standings.filter((team) => team.status === "qualified").length}/8 晋级</b></header><table class="league-table"><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜-负</th><th>进失</th><th>分</th><th>状态</th></tr></thead><tbody>${swissRows}</tbody></table></section>${swissResults}</div>` : bracket;
  return `<section class="league-cup-overview active-cup"><header><div><small>YELLOWDOGS CHAMPION CUP</small><h2>${cup.championName ? `${cup.championName} 获得黄狗冠军杯冠军` : "黄狗冠军杯"}</h2><p>${cup.nextRoundAt ? `下一阶段预计 ${scheduleTimeText(cup.nextRoundAt)}` : cup.status === "completed" ? "本届黄狗冠军杯已结束" : "比赛进行中"}</p></div><span>${cup.stage}</span></header><nav class="cup-tabs"><button data-cup-page="swiss" class="${leagueCupPage === "swiss" ? "active" : ""}">瑞士轮</button><button data-cup-page="knockout" class="${leagueCupPage === "knockout" ? "active" : ""}">淘汰赛</button></nav>${body}</section>`;
}

function updateLeagueScheduleClock() {
  if (leagueTab !== "schedule" || !league?.schedule) return;
  const now = Date.now() + leagueScheduleClockOffset;
  const nowText = document.querySelector("[data-schedule-now-time]");
  if (nowText) nowText.textContent = scheduleTimeText(now);
  const timeline = document.querySelector("[data-schedule-timeline]");
  if (!timeline) return;
  timeline.querySelector(".league-schedule-now-marker")?.remove();
  const marker = document.createElement("div");
  marker.className = "league-schedule-now-marker";
  marker.innerHTML = `<i></i><span>现在 ${scheduleTimeText(now, false)}</span>`;
  const nextItem = [...timeline.querySelectorAll("[data-schedule-start]")].find((item) => Number(item.dataset.scheduleStart) > now);
  if (nextItem) timeline.insertBefore(marker, nextItem);
  else timeline.append(marker);
  const next = resolvedLeagueScheduleFixtures().find((fixture) => fixture.status === "scheduled");
  const countdown = document.querySelector("[data-schedule-next-countdown]");
  if (countdown && next) countdown.textContent = scheduleCountdownText(next.startsAt, now);
}

function leagueDailyReportMarkup(report) {
  const results = report.today.results.length ? report.today.results.map((match) => `<div class="daily-result result-${match.result}"><span>第${match.round}轮 · ${match.venue === "home" ? "主场" : "客场"}</span><b>${escapeHtml(match.opponentName)}</b><strong>${match.scoreFor}:${match.scoreAgainst}</strong><small>${escapeHtml(match.formation)}</small></div>`).join("") : `<p class="league-empty">今日尚无比赛。</p>`;
  const topPlayers = report.topPlayers.length ? report.topPlayers.map((player,index) => `<div class="daily-player"><span>${index + 1}</span><b>${escapeHtml(player.name)}<small>${player.goals}球 · ${player.assists}助</small></b><strong>${player.averageRating.toFixed(2)}</strong></div>`).join("") : `<p class="league-empty">比赛后生成今日球员表现。</p>`;
  const unavailable = [
    ...report.availability.injured.map((player) => `<div class="availability-item injury"><b>${escapeHtml(player.name)}</b><span>伤缺 ${player.rounds} 轮</span></div>`),
    ...report.availability.suspended.map((player) => `<div class="availability-item suspension"><b>${escapeHtml(player.name)}</b><span>停赛 ${player.rounds} 轮</span></div>`),
    ...report.availability.lowFitness.slice(0, 6).map((player) => `<div class="availability-item low-fitness"><b>${escapeHtml(player.name)}</b><span>体能 ${player.fitness}</span></div>`),
  ].join("") || `<div class="availability-item all-available"><b>阵容完整</b><span>全队均可正常出场</span></div>`;
  const history = league.reportHistory.filter((entry) => entry.date !== report.date).slice(0, 6).map((entry) => `<span><b>${escapeHtml(entry.date.slice(5))}</b>${entry.today.wins}胜${entry.today.draws}平${entry.today.losses}负</span>`).join("");
  return `<section class="league-panel league-daily-report"><header><div><small>CLUB DAILY BRIEF · ${escapeHtml(report.date)}</small><h2>球队当日报告</h2></div><b>${escapeHtml(report.headline)}</b></header><div class="daily-kpis"><span><small>今日比赛</small><b>${report.today.played}</b></span><span><small>今日进失</small><b>${report.today.goalsFor}:${report.today.goalsAgainst}</b></span><span><small>平均体能</small><b>${report.availability.averageFitness}</b></span><span><small>金币变化</small><b>${report.economy.coinChange > 0 ? "+" : ""}${report.economy.coinChange}</b></span></div><div class="daily-report-grid"><section><h3>今日赛果</h3><div class="daily-results-list">${results}</div></section><section><h3>球员表现</h3>${topPlayers}</section><section><h3>球队可用性</h3><div class="daily-availability">${unavailable}</div></section><section><h3>战术与下一步</h3><dl class="daily-tactics"><div><dt>主要阵型</dt><dd>${escapeHtml(report.tactics.formation ?? "尚未确定")}</dd></div><div><dt>比赛思路</dt><dd>${escapeHtml(TACTICS[report.tactics.tactic] ?? report.tactics.tactic)}</dd></div><div><dt>主要打法</dt><dd>${escapeHtml(STYLES[report.tactics.style] ?? report.tactics.style)}</dd></div></dl><p>${escapeHtml(report.managerNote)}</p></section></div>${history ? `<footer class="daily-history"><small>近期日报</small>${history}</footer>` : ""}</section>`;
}

function leaguePlayerStatus(player) {
  if (player.state?.suspension) return `停赛 ${player.state.suspension}轮`;
  if (player.state?.injuryRounds) return `伤缺 ${player.state.injuryRounds}轮`;
  return `体能 ${Math.round(player.state?.fitness ?? player.fitness ?? 100)}`;
}

function leaguePlayerTooltip(player, assignedRole = player.role) {
  const keys = player.pool === "GK" ? ["goalkeeping", "reflexes", "passing", "composure"] : player.pool === "DEF" ? ["tackling", "pace", "stamina", "passing"] : player.pool === "MID" ? ["passing", "dribbling", "stamina", "tackling"] : ["finishing", "pace", "dribbling", "composure"];
  const attributes = keys.map((key) => `${STAT_LABELS[key] ?? key} ${Math.round(player.effectiveAttributes?.[key] ?? player.attributes?.[key] ?? 0)}`).join(" · ");
  const representativeCard = player.cards?.find((card) => card.id === player.activeCardId) ?? player.cards?.[0] ?? null;
  const enhancementTraits = (representativeCard?.traits ?? []).map((trait) => `\n${trait.name}：${trait.summary ?? "强化获得的YDL特性"}`).join("");
  return `${player.nationality ?? ""}${player.club ? ` · ${player.club}` : ""}\n综合能力：${player.effectiveOverall ?? player.overall}${player.upgradeLevel ? `（基础 ${player.baseOverall ?? player.overall}，强化 +${player.upgradeLevel}）` : ""}\n主位置：${ROLE_LABELS[player.role] ?? player.role} · 副位置：${ROLE_LABELS[player.secondaryRole] ?? "无"}\n当前位置：${ROLE_LABELS[assignedRole] ?? assignedRole}\n身高：${Math.round(player.heightCm ?? 0)}cm · ${leaguePlayerStatus(player)}\n${attributes}${enhancementTraits}`;
}

function leagueBoardMagnet(player, position, assignedRole) {
  const fit = positionFit(player, assignedRole);
  const tooltip = leaguePlayerTooltip(player, assignedRole);
  const upgrade = Number(player.upgradeLevel ?? 0);
  const fitness = Math.max(0, Math.min(100, Math.round(player.state.fitness ?? 0)));
  return `<button type="button" class="magnet league-squad-magnet grade-${player.grade.toLowerCase()} fit-${fit} ${player.state.suspension || player.state.injuryRounds ? "unavailable" : ""}" data-league-magnet="${player.id}" data-traits="${escapeHtml(tooltip)}" style="left:${position.x}%;top:${position.y}%"><span class="league-magnet-role">${ROLE_LABELS[assignedRole] ?? assignedRole}</span><b>${escapeHtml(player.name)}</b><i>${player.effectiveOverall ?? player.overall}</i><span class="league-magnet-fitness" aria-label="体力 ${fitness}"><span style="width:${fitness}%"></span></span>${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}</button>`;
}

function leagueBenchMagnet(player) {
  const tooltip = leaguePlayerTooltip(player);
  const upgrade = Number(player.upgradeLevel ?? 0);
  const fitness = Math.max(0, Math.min(100, Math.round(player.state.fitness ?? 0)));
  return `<button type="button" class="magnet bench-magnet league-bench-magnet grade-${player.grade.toLowerCase()} fit-primary ${player.state.suspension || player.state.injuryRounds ? "unavailable" : ""}" data-league-bench-magnet="${player.id}" data-traits="${escapeHtml(tooltip)}"><span class="league-magnet-role">${ROLE_LABELS[player.role] ?? player.role}</span><b>${escapeHtml(player.name)}</b><i>${player.effectiveOverall ?? player.overall}</i><span class="league-magnet-fitness" aria-label="体力 ${fitness}"><span style="width:${fitness}%"></span></span>${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}</button>`;
}

function leagueTacticalFit(players, roles, positions, plan) {
  players = players.map((player) => player.effectiveAttributes ? { ...player, attributes:player.effectiveAttributes } : player);
  const group = (role) => role === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(role) ? "DEF" : ["ST", "LW", "RW"].includes(role) ? "ATT" : "MID";
  const grouped = {
    GK:players.filter((player) => group(roles[player.id]) === "GK"),
    DEF:players.filter((player) => group(roles[player.id]) === "DEF"),
    MID:players.filter((player) => group(roles[player.id]) === "MID"),
    ATT:players.filter((player) => group(roles[player.id]) === "ATT"),
  };
  const outfield = players.filter((player) => group(roles[player.id]) !== "GK");
  const wide = outfield.filter((player) => {
    const x = Number(positions[player.id]?.x ?? 50);
    return x <= 34 || x >= 66;
  });
  const metric = (entries, weights) => {
    if (!entries.length) return 55;
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
    return entries.reduce((sum, player) => {
      const score = Object.entries(weights).reduce((value, [key, weight]) => value + Number(player.attributes?.[key] ?? player.overall ?? 60) * weight, 0) / totalWeight;
      return sum + score;
    }, 0) / entries.length;
  };
  const styleScores = {
    possession:metric(outfield, { passing:.28, firstTouch:.24, decisions:.2, dribbling:.16, composure:.12 }),
    longBall:metric(outfield, { passing:.28, vision:.22, crossing:.18, decisions:.16, strength:.08, pace:.08 }) * .62 + metric(grouped.ATT, { heading:.38, jumping:.24, offBall:.16, strength:.14, composure:.08 }) * .38,
    wingPlay:metric(wide, { crossing:.28, pace:.2, acceleration:.16, dribbling:.16, passing:.12, stamina:.08 }) * .76 + metric(grouped.ATT, { offBall:.28, heading:.2, pace:.18, finishing:.18, composure:.16 }) * .24,
    counterAttack:metric(outfield, { pace:.3, acceleration:.18, decisions:.18, passing:.14, offBall:.12, composure:.08 }) * .7 + metric(grouped.DEF, { tackling:.3, positioning:.28, passing:.18, decisions:.14, pace:.1 }) * .3,
    highPress:metric(outfield, { stamina:.26, workRate:.24, pace:.16, tackling:.14, aggression:.1, decisions:.1 }),
    lowBlock:metric([...grouped.DEF, ...grouped.GK], { positioning:.24, marking:.2, tackling:.18, strength:.13, heading:.1, goalkeeping:.1, reflexes:.05 }),
    roughPlay:metric(outfield, { aggression:.28, tackling:.24, strength:.18, workRate:.13, stamina:.1, discipline:.07 }),
  };
  const tacticScores = {
    allOutAttack:metric([...grouped.MID, ...grouped.ATT], { finishing:.24, offBall:.2, passing:.18, pace:.14, stamina:.12, decisions:.12 }),
    positive:metric([...grouped.MID, ...grouped.ATT], { passing:.24, decisions:.2, offBall:.18, finishing:.16, dribbling:.12, stamina:.1 }),
    balanced:(metric(grouped.DEF, { positioning:.3, tackling:.28, passing:.2, decisions:.22 }) + metric(grouped.MID, { passing:.28, decisions:.26, stamina:.24, tackling:.22 }) + metric(grouped.ATT, { finishing:.3, offBall:.28, pace:.22, composure:.2 })) / 3,
    defensive:metric([...grouped.DEF, ...grouped.MID], { positioning:.25, tackling:.24, decisions:.2, stamina:.14, passing:.1, pace:.07 }),
    parkBus:metric([...grouped.DEF, ...grouped.GK], { positioning:.27, marking:.2, tackling:.18, strength:.13, heading:.1, goalkeeping:.08, reflexes:.04 }),
  };
  const averageValue = (values, fallback) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
  const lineHeight = (groupKey, fallback) => averageValue(players.filter((player) => group(roles[player.id]) === groupKey).map((player) => Number(positions[player.id]?.y ?? fallback)), fallback);
  const defenseHeight = lineHeight("DEF", 69);
  const midfieldHeight = lineHeight("MID", 45);
  const attackHeight = lineHeight("ATT", 19);
  const maximumGap = Math.max(defenseHeight - midfieldHeight, midfieldHeight - attackHeight);
  const teamLength = defenseHeight - attackHeight;
  const midfieldPositions = grouped.MID.map((player) => positions[player.id]).filter(Boolean);
  const midfieldSpacing = midfieldPositions.length > 1 ? averageValue(midfieldPositions.map((position, index) => Math.min(...midfieldPositions.filter((_, otherIndex) => otherIndex !== index).map((other) => Math.hypot((position.x - other.x) * .78, position.y - other.y)))), 24) : 34;
  const lineConnection = Math.max(.72, Math.min(1.055, 1.055 - Math.max(0, maximumGap - 20) / 58));
  const verticalCompactness = Math.max(.76, Math.min(1.045, 1.045 - Math.max(0, teamLength - 44) / 90 - Math.max(0, 34 - teamLength) / 120));
  const midfieldCompactness = Math.max(.76, Math.min(1.055, 1.055 - Math.max(0, midfieldSpacing - 18) / 70));
  const deepDefense = Math.max(0, Math.min(1, (defenseHeight - 61) / 25));
  const highDefense = Math.max(0, Math.min(1, (68 - defenseHeight) / 27));
  const boxProtection = Math.max(.9, Math.min(1.09, .965 + deepDefense * .105 - highDefense * .045 + (verticalCompactness - .9) * .08));
  const pressingCohesion = Math.max(.8, Math.min(1.11, .91 + highDefense * .13 + (lineConnection - .9) * .24 + (verticalCompactness - .9) * .2));
  const spatialStyle = {
    possession:Math.max(.78, Math.min(1.09, .94 + (lineConnection - .9) * .38 + (midfieldCompactness - .9) * .32 + (verticalCompactness - .9) * .22)),
    longBall:Math.max(.94, Math.min(1.11, .965 + Math.max(0, maximumGap - 22) * .004 + Math.max(0, teamLength - 47) * .0025)),
    wingPlay:Math.max(.93, Math.min(1.06, .98 + (lineConnection - .9) * .14)),
    counterAttack:Math.max(.94, Math.min(1.09, .96 + deepDefense * .055 + Math.max(0, teamLength - 44) * .002)),
    highPress:pressingCohesion,
    lowBlock:boxProtection,
    roughPlay:Math.max(.95, Math.min(1.04, .98 + (verticalCompactness - .9) * .08)),
  };
  const tacticSpatial = ["defensive", "parkBus"].includes(plan.tactic) ? boxProtection : ["positive", "allOutAttack"].includes(plan.tactic) ? pressingCohesion : 1;
  const spatialFit = (spatialStyle[plan.style] ?? 1) * .76 + tacticSpatial * .24;
  const raw = ((styleScores[plan.style] ?? styleScores.possession) * .72 + (tacticScores[plan.tactic] ?? tacticScores.balanced) * .28) * spatialFit;
  return Math.round(Math.max(50, Math.min(99, raw)));
}

function leagueNextMatchMarkup() {
  const next = league.report?.nextOpponent;
  if (league.season?.status === "registration") return `<section class="league-next-match complete"><span>新赛季报名选人中</span><b>等待管理员开启联赛推进，首轮时间将在开启后确定</b></section>`;
  if (!next) return `<section class="league-next-match complete"><span>赛季赛程已完成</span><b>等待管理员开启新赛季</b></section>`;
  const startsAt = new Date(next.startsAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
  return `<section class="league-next-match"><div><small>NEXT MATCH · ${escapeHtml(next.competitionName)} · ${escapeHtml(next.label)}</small><b>${startsAt}</b></div><div><small>对手</small><strong>${escapeHtml(next.name)}</strong></div><div><small>天气</small><strong>${weatherIcon(next.weather)} ${escapeHtml(next.weather.name)}</strong><span>降水 ${next.weather.precipitation}% · 风力 ${next.weather.wind}</span></div><div><small>裁判尺度</small><strong>${escapeHtml(next.referee.name)}</strong><span>${escapeHtml(next.referee.description)}</span></div></section>`;
}

function leagueBackpackMarkup() {
  const inventory = league.s4Packs?.inventory ?? [];
  const offer = league.s4Packs?.offer ?? null;
  const allCards = (league.ownTeam?.roster ?? []).flatMap((player) => (player.cards ?? []).map((card) => ({ player, card })));
  const search = leagueBackpackSearch.trim().toLocaleLowerCase("zh-CN");
  const filteredCards = allCards.filter(({ player, card }) => {
    const matchesSearch = !search || [player.name, player.club, player.nationality].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(search));
    const matchesPosition = leagueBackpackPosition === "ALL" || player.pool === leagueBackpackPosition;
    const level = Number(card.upgradeLevel ?? 0);
    const matchesUpgrade = leagueBackpackUpgrade === "ALL"
      || leagueBackpackUpgrade === "BASE" && level === 0
      || leagueBackpackUpgrade === "MID" && level >= 1 && level <= 4
      || leagueBackpackUpgrade === "HIGH" && level >= 5 && level <= 7
      || leagueBackpackUpgrade === "MAX" && level >= 8;
    return matchesSearch && matchesPosition && matchesUpgrade;
  }).sort((left, right) => {
    const upgradeDifference = right.card.upgradeLevel - left.card.upgradeLevel;
    if (upgradeDifference) return upgradeDifference;
    if (leagueBackpackSort === "overall") return right.player.overall - left.player.overall || left.player.name.localeCompare(right.player.name, "zh-CN");
    if (leagueBackpackSort === "name") return left.player.name.localeCompare(right.player.name, "zh-CN") || right.player.overall - left.player.overall;
    return right.player.overall - left.player.overall || left.player.name.localeCompare(right.player.name, "zh-CN");
  });
  const activeListings = league.listings.filter((item) => item.sellerId === account.profile.id);
  const cardGridEntries = leagueBackpackRecoveryMode === "ownership"
    ? (league.ownTeam?.roster ?? []).filter((player) => player.ownsRights && player.grade !== "S").filter((player) => {
      const matchesSearch = !search || [player.name, player.club, player.nationality].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(search));
      return matchesSearch && (leagueBackpackPosition === "ALL" || player.pool === leagueBackpackPosition);
    }).map((player) => ({ player, card:{ ...(player.cards[0] ?? {}), id:`ownership-${player.id}`, upgradeLevel:0 } }))
    : filteredCards;
  const displayCardEntries = leagueBackpackStacked && !leagueBackpackRecoveryMode
    ? [...cardGridEntries.reduce((groups, entry) => {
      const key = `${entry.player.id}:${entry.card.upgradeLevel ?? 0}`;
      const group = groups.get(key) ?? { ...entry, stackCount:0 };
      group.stackCount += 1;
      groups.set(key, group);
      return groups;
    }, new Map()).values()]
    : cardGridEntries.map((entry) => ({ ...entry, stackCount:1 }));
  const cardGrid = displayCardEntries.length
    ? displayCardEntries.map(({ player, card, stackCount }) => {
      if (leagueBackpackRecoveryMode === "single") {
        const listed = activeListings.some((item) => item.cardId === card.id || item.kind === "ownership" && item.playerId === player.id);
        const lastOwnershipCard = player.ownsRights && player.cards.length === 1;
        const tradeLocked = league.tradeLockedCardIds?.includes(card.id);
        const disabled = !card.systemRecyclable || listed || tradeLocked || lastOwnershipCard;
        const reason = !card.systemRecyclable ? "+4及以上不可回收" : listed ? "资产已挂牌" : tradeLocked ? "交易报价中" : lastOwnershipCard ? "请使用所有权回收" : "";
        const selected = leagueBackpackSelectedCardIds.has(card.id);
        const attributes = disabled ? `aria-disabled="true"` : `data-backpack-recovery-card="${card.id}" data-s4-player-id="${player.id}"`;
        return `<div class="backpack-recovery-card ${disabled ? "disabled" : ""} ${selected ? "selected" : ""}">${s4PlayerCardMarkup(player, { card, compact:leagueBackpackCompact, attributes })}<span>${disabled ? escapeHtml(reason) : selected ? `已选择 · ${card.systemRecoveryValue}金币` : `${card.systemRecoveryValue}金币`}</span></div>`;
      }
      if (leagueBackpackRecoveryMode === "ownership") {
        const listed = activeListings.some((item) => item.playerId === player.id);
        const selected = leagueBackpackSelectedOwnershipId === player.id;
        const attributes = listed ? `aria-disabled="true"` : `data-backpack-recovery-ownership="${player.id}"`;
        return `<div class="backpack-recovery-card ownership ${listed ? "disabled" : ""} ${selected ? "selected" : ""}">${s4PlayerCardMarkup(player, { card, compact:leagueBackpackCompact, attributes })}<span>${listed ? "资产已挂牌" : selected ? "已选择所有权" : `预计 ${player.ownershipReturnPreview?.totalAmount ?? 0}金币`}</span></div>`;
      }
      const cardMarkup = s4PlayerCardMarkup(player, { card, compact:leagueBackpackCompact, attributes:`data-s4-card-detail="${card.id}" data-s4-player-id="${player.id}"` });
      return stackCount > 1 ? `<div class="backpack-card-stack">${cardMarkup}<b>×${stackCount}</b></div>` : cardMarkup;
    }).join("")
    : `<p class="league-empty backpack-card-empty">${leagueBackpackRecoveryMode === "ownership" ? "当前没有可回收的非传奇球员所有权。" : "没有符合当前筛选条件的球员卡。"}</p>`;

  const packSearch = leagueBackpackPackSearch.trim().toLocaleLowerCase("zh-CN");
  const filteredInventory = inventory.filter((item) => {
    const matchesSearch = !packSearch || [item.name, item.packType].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(packSearch));
    const matchesKind = leagueBackpackPackKind === "ALL" || item.kind === leagueBackpackPackKind;
    const matchesPool = leagueBackpackPackPool === "ALL" || item.pool === leagueBackpackPackPool;
    const matchesSource = leagueBackpackPackSource === "ALL" || item.source === leagueBackpackPackSource;
    return matchesSearch && matchesKind && matchesPool && matchesSource;
  });
  const groups = [...new Set(filteredInventory.map((item) => item.packType))].map((packType) => {
    const items = filteredInventory.filter((item) => item.packType === packType);
    const openableItems = items.filter((item) => item.status === "unopened");
    const pack = items[0];
    return `<section class="backpack-tier"><header><div><small>S4 PACK</small><h2>${escapeHtml(pack.name)}</h2></div><div class="backpack-tier-actions"><b>${items.length}份</b><input type="number" min="1" max="${Math.max(1, Math.min(100, openableItems.length))}" value="${Math.max(1, Math.min(100, openableItems.length))}" id="backpack-batch-count-${escapeHtml(packType)}" aria-label="批量打开数量" ${openableItems.length ? "" : "disabled"}><button type="button" data-s4-pack-open-batch="${escapeHtml(packType)}" ${openableItems.length && !league.s4Packs?.batchOpening ? "" : "disabled"}>批量打开</button></div></header><div class="backpack-pool-grid"><section class="backpack-pool"><div>${items.map((item) => s4PackVisualMarkup(
      pack,
      {
        tag:"button",
        className:"backpack-pack",
        attributes:`data-s4-pack-open="${item.id}"`,
        disabled:item.status === "choosing",
        state:item.status === "choosing" ? "待选择" : "",
      },
    )).join("")}</div></section></div></section>`;
  }).join("");
  const choice = offer ? `<section class="league-panel league-shop backpack-choice"><header><div><small>S4 PACK OPENING</small><h2>${offer.kind === "legend" ? "传奇随机卡包" : "公共池随机礼包"}</h2></div>${offer.batchTotal ? `<b class="backpack-batch-progress">第 ${offer.batchIndex}/${offer.batchTotal} 份</b>` : ""}</header><div class="league-shop-offer s4-player-card-choice-grid">${offer.players.map((player,index) => s4PlayerCardMarkup(player, { animated:true, delay:index * 90, attributes:`data-s4-pack-choice="${player.id}" data-s4-offer-id="${offer.id}"` })).join("")}</div><p class="league-shop-note">${offer.batchTotal ? "完成本次选择后将自动开启下一份礼包。" : "选择一名球员完成本次开包。"}</p></section>` : "";
  const packTools = `<div class="backpack-pack-tools">
    <input type="search" value="${escapeHtml(leagueBackpackPackSearch)}" placeholder="搜索卡包名称" data-backpack-pack-search>
    <select data-backpack-pack-kind><option value="ALL" ${leagueBackpackPackKind === "ALL" ? "selected" : ""}>全部类别</option><option value="legend" ${leagueBackpackPackKind === "legend" ? "selected" : ""}>传奇卡包</option><option value="private" ${leagueBackpackPackKind === "private" ? "selected" : ""}>私有池卡包</option><option value="public" ${leagueBackpackPackKind === "public" ? "selected" : ""}>公共池卡包</option></select>
    <select data-backpack-pack-pool><option value="ALL" ${leagueBackpackPackPool === "ALL" ? "selected" : ""}>全部定位</option><option value="MIXED" ${leagueBackpackPackPool === "MIXED" ? "selected" : ""}>全位置</option><option value="ATT" ${leagueBackpackPackPool === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueBackpackPackPool === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueBackpackPackPool === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueBackpackPackPool === "GK" ? "selected" : ""}>门将</option><option value="LEGEND" ${leagueBackpackPackPool === "LEGEND" ? "selected" : ""}>传奇</option></select>
    <select data-backpack-pack-source><option value="ALL" ${leagueBackpackPackSource === "ALL" ? "selected" : ""}>全部来源</option><option value="shop" ${leagueBackpackPackSource === "shop" ? "selected" : ""}>商店购买</option><option value="admin" ${leagueBackpackPackSource === "admin" ? "selected" : ""}>后台发放</option></select>
  </div>`;
  const packSection = inventory.length
    ? `<section class="backpack-pack-section"><header><div><small>PACK INVENTORY</small><h2>卡包管理</h2></div><b>${filteredInventory.length}/${inventory.length}份</b></header>${packTools}${filteredInventory.length ? groups : `<div class="backpack-pack-filter-empty">没有符合当前筛选条件的卡包。</div>`}</section>`
    : `<section class="backpack-pack-section"><header><div><small>PACK INVENTORY</small><h2>卡包管理</h2></div><b>0份</b></header>${packTools}<div class="backpack-pack-empty"><small>PACK INVENTORY</small><b>暂无未开启礼包</b><span>商店购买和管理员发放的礼包会出现在这里。</span></div></section>`;
  const selectedSingleCards = allCards.filter(({ card }) => leagueBackpackSelectedCardIds.has(card.id));
  const selectedSingleAmount = selectedSingleCards.reduce((sum, { card }) => sum + Number(card.systemRecoveryValue ?? 0), 0);
  const recoveryActions = `<div class="backpack-recovery-actions"><label class="backpack-stack-toggle"><input type="checkbox" data-backpack-stack ${leagueBackpackStacked ? "checked" : ""} ${leagueBackpackRecoveryMode ? "disabled" : ""}><span>叠放同名同强化</span></label><button type="button" class="${leagueBackpackRecoveryMode === "single" ? "active" : ""}" data-backpack-recovery-mode="single"><b>单卡回收</b><span>${leagueBackpackRecoveryMode === "single" ? `已选${selectedSingleCards.length}张 · ${selectedSingleAmount}金币` : "批量选择可回收卡片"}</span></button><button type="button" class="${leagueBackpackRecoveryMode === "ownership" ? "active" : ""}" data-backpack-recovery-mode="ownership"><b>所有权回收</b><span>${leagueBackpackRecoveryMode === "ownership" ? leagueBackpackSelectedOwnershipId ? "已选择1名球员" : "选择需要返还的球员" : "返还所有权并清理同名卡"}</span></button>${leagueBackpackRecoveryMode ? `<button type="button" class="backpack-recovery-cancel" data-backpack-recovery-cancel>取消</button>` : ""}</div>`;
  const cardSection = `<section class="backpack-card-section"><header><div><small>PLAYER CARD MANAGEMENT</small><h2>球员卡管理</h2></div>${recoveryActions}</header><div class="backpack-card-tools"><input type="search" value="${escapeHtml(leagueBackpackSearch)}" placeholder="输入后按回车搜索球员、俱乐部或国家队" data-backpack-search/><select data-backpack-position><option value="ALL" ${leagueBackpackPosition === "ALL" ? "selected" : ""}>全部位置</option><option value="ATT" ${leagueBackpackPosition === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueBackpackPosition === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueBackpackPosition === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueBackpackPosition === "GK" ? "selected" : ""}>门将</option></select><select data-backpack-upgrade ${leagueBackpackRecoveryMode === "ownership" ? "disabled" : ""}><option value="ALL" ${leagueBackpackUpgrade === "ALL" ? "selected" : ""}>全部强化</option><option value="BASE" ${leagueBackpackUpgrade === "BASE" ? "selected" : ""}>未强化</option><option value="MID" ${leagueBackpackUpgrade === "MID" ? "selected" : ""}>+1 ～ +4</option><option value="HIGH" ${leagueBackpackUpgrade === "HIGH" ? "selected" : ""}>+5 ～ +7</option><option value="MAX" ${leagueBackpackUpgrade === "MAX" ? "selected" : ""}>+8</option></select><select data-backpack-sort><option value="upgrade" ${leagueBackpackSort === "upgrade" ? "selected" : ""}>强化等级优先</option><option value="overall" ${leagueBackpackSort === "overall" ? "selected" : ""}>能力值优先</option><option value="name" ${leagueBackpackSort === "name" ? "selected" : ""}>姓名排序</option></select><div class="backpack-density"><button type="button" class="${leagueBackpackCompact ? "" : "active"}" data-backpack-density="normal" title="标准卡片">标准</button><button type="button" class="${leagueBackpackCompact ? "active" : ""}" data-backpack-density="compact" title="紧凑卡片">紧凑</button></div></div><div class="backpack-card-grid ${leagueBackpackCompact ? "compact" : ""}">${cardGrid}</div></section>`;
  return `<section class="league-backpack"><header><div><small>S4 CLUB INVENTORY</small><h2>球队背包</h2></div><div class="backpack-summary"><span><b>${allCards.length}</b>张球员卡</span><span><b>${inventory.length}</b>份礼包</span></div></header><nav class="backpack-page-tabs"><button type="button" class="${leagueBackpackPage === "packs" ? "active" : ""}" data-backpack-page="packs">卡包管理<span>${inventory.length}</span></button><button type="button" class="${leagueBackpackPage === "cards" ? "active" : ""}" data-backpack-page="cards">球员卡管理<span>${allCards.length}</span></button></nav>${leagueBackpackPage === "cards" ? cardSection : `${choice}${packSection}`}</section>`;
}

function leagueEnhancementCardEntries() {
  return (league.ownTeam?.roster ?? []).flatMap((player) => (player.cards ?? []).map((card) => ({ player, card })));
}

function leagueEnhancementCardEntry(cardId) {
  return leagueEnhancementCardEntries().find(({ card }) => card.id === cardId) ?? null;
}

function leagueEnhancementChance(mainLevel, materialLevel) {
  const rules = league.enhancement ?? {};
  const equal = rules.equalLevelChances?.[mainLevel] ?? 1;
  const distance = materialLevel - mainLevel;
  const adjusted = distance < 0
    ? equal * ((rules.lowerMaterialMultiplier ?? .52) ** Math.abs(distance))
    : equal * ((rules.higherMaterialMultiplier ?? 1.35) ** distance);
  return Math.max(1, Math.min(100, Math.round(adjusted)));
}

function leagueEnhancementSlotMarkup(slot, entry) {
  if (!entry) return `<div class="enhancement-card-slot empty" data-enhancement-drop="${slot}"><b>${slot === "main" ? "主卡" : "副卡"}</b><span>+</span></div>`;
  return `<div class="enhancement-card-slot filled" data-enhancement-drop="${slot}"><b>${slot === "main" ? "主卡" : "副卡"}</b>${s4PlayerCardMarkup(entry.player, { card:entry.card, compact:true, attributes:`draggable="true" data-enhancement-slot-card="${slot}" data-enhancement-card-id="${entry.card.id}" title="点击移回仓库"` })}</div>`;
}

function leagueEnhancementCardListed(playerId, cardId) {
  return league.listings.some((item) => item.sellerId === account.profile.id
    && (item.cardId === cardId || item.kind === "ownership" && item.playerId === playerId));
}

function leagueEnhancementMiniRankingMarkup() {
  const ranking = (league.playerDirectory?.enhancementRanking ?? []).map((entry, index) => ({ ...entry, rank:index + 1 })).filter((entry) => {
    const player = entry.player;
    const level = Number(entry.upgradeLevel ?? 0);
    const matchesPosition = leagueEnhancementRankingPosition === "ALL" || marketRoleGroup(player) === leagueEnhancementRankingPosition;
    const matchesGrade = leagueEnhancementRankingGrade === "ALL" || player.grade === leagueEnhancementRankingGrade;
    const matchesLevel = leagueEnhancementRankingLevel === "ALL"
      || leagueEnhancementRankingLevel === "ENHANCED" && level > 0
      || leagueEnhancementRankingLevel === "HIGH" && level >= 5
      || leagueEnhancementRankingLevel === "MAX" && level >= 8;
    return level > 0 && matchesPosition && matchesGrade && matchesLevel;
  }).slice(0, 8);
  const rows = ranking.length ? ranking.map((entry) => `<li>
    <strong>${entry.rank}</strong>
    <div><b>${escapeHtml(entry.player.name)}</b><small>${escapeHtml(entry.ownerName)} · ${escapeHtml(entry.teamName)}</small></div>
    <span>+${entry.upgradeLevel}</span>
  </li>`).join("") : `<li class="empty">暂无强化卡数据</li>`;
  return `<section class="enhancement-mini-ranking">
    <header><div><small>SERVER TOP CARDS</small><h3>全服强化排行榜</h3></div><button type="button" data-league-tab="players" data-open-player-ranking>查看全部</button></header>
    <div class="enhancement-mini-ranking-filters"><select data-enhancement-ranking-position><option value="ALL" ${leagueEnhancementRankingPosition === "ALL" ? "selected" : ""}>全部位置</option><option value="ATT" ${leagueEnhancementRankingPosition === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueEnhancementRankingPosition === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueEnhancementRankingPosition === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueEnhancementRankingPosition === "GK" ? "selected" : ""}>门将</option></select><select data-enhancement-ranking-grade><option value="ALL" ${leagueEnhancementRankingGrade === "ALL" ? "selected" : ""}>全部评级</option>${["S", "A", "B", "C"].map((grade) => `<option value="${grade}" ${leagueEnhancementRankingGrade === grade ? "selected" : ""}>${grade}级</option>`).join("")}</select><select data-enhancement-ranking-level><option value="ALL" ${leagueEnhancementRankingLevel === "ALL" ? "selected" : ""}>全部等级</option><option value="ENHANCED" ${leagueEnhancementRankingLevel === "ENHANCED" ? "selected" : ""}>+1以上</option><option value="HIGH" ${leagueEnhancementRankingLevel === "HIGH" ? "selected" : ""}>+5以上</option><option value="MAX" ${leagueEnhancementRankingLevel === "MAX" ? "selected" : ""}>仅+8</option></select></div>
    <ol>${rows}</ol>
  </section>`;
}

function leagueEnhancementMarkup() {
  const allCards = leagueEnhancementCardEntries();
  let main = leagueEnhancementCardEntry(leagueEnhancementMainCardId);
  let material = leagueEnhancementCardEntry(leagueEnhancementMaterialCardId);
  if (main && leagueEnhancementCardListed(main.player.id, main.card.id)) main = null;
  if (material && leagueEnhancementCardListed(material.player.id, material.card.id)) material = null;
  if (!main) leagueEnhancementMainCardId = null;
  if (!material) leagueEnhancementMaterialCardId = null;
  const selectedIds = new Set([leagueEnhancementMainCardId, leagueEnhancementMaterialCardId, leagueEnhancementResult?.card?.id, league.enhancement?.traitOffer?.cardId].filter(Boolean));
  const search = leagueBackpackSearch.trim().toLocaleLowerCase("zh-CN");
  const warehouseCards = allCards.filter(({ player, card }) => {
    if (selectedIds.has(card.id)) return false;
    const matchesSearch = !search || [player.name, player.club, player.nationality].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(search));
    const matchesPosition = leagueBackpackPosition === "ALL" || player.pool === leagueBackpackPosition;
    const level = Number(card.upgradeLevel ?? 0);
    const matchesUpgrade = leagueBackpackUpgrade === "ALL"
      || leagueBackpackUpgrade === "BASE" && level === 0
      || leagueBackpackUpgrade === "MID" && level >= 1 && level <= 4
      || leagueBackpackUpgrade === "HIGH" && level >= 5 && level <= 7
      || leagueBackpackUpgrade === "MAX" && level >= 8;
    const listed = leagueEnhancementCardListed(player.id, card.id);
    const matchesListing = leagueEnhancementListingFilter === "ALL" || !listed;
    return matchesSearch && matchesPosition && matchesUpgrade && matchesListing;
  }).sort((left, right) => {
    const upgradeDifference = right.card.upgradeLevel - left.card.upgradeLevel;
    if (upgradeDifference) return upgradeDifference;
    if (leagueBackpackSort === "overall") return right.player.overall - left.player.overall || left.player.name.localeCompare(right.player.name, "zh-CN");
    if (leagueBackpackSort === "name") return left.player.name.localeCompare(right.player.name, "zh-CN") || right.player.overall - left.player.overall;
    return right.player.overall - left.player.overall || left.player.name.localeCompare(right.player.name, "zh-CN");
  });
  const mainLevel = Number(main?.card.upgradeLevel ?? 0);
  const materialLevel = Number(material?.card.upgradeLevel ?? 0);
  const samePlayer = Boolean(main && material && main.player.id === material.player.id);
  const chance = samePlayer ? leagueEnhancementChance(mainLevel, materialLevel) : 0;
  const protectionAvailable = Boolean(main && samePlayer && chance < 100 && mainLevel < Number(league.enhancement?.maxLevel ?? 8));
  if (!protectionAvailable) leagueEnhancementUseProtection = false;
  const failureChance = Math.max(0, 100 - chance);
  const protectionCost = protectionAvailable ? Math.ceil((failureChance * failureChance * Number(league.enhancement?.protectionCostFactor ?? .7)) / Number(league.enhancement?.protectionCostUnit ?? 100)) * Number(league.enhancement?.protectionCostUnit ?? 100) : 0;
  const abilityBonuses = league.enhancement?.abilityBonuses ?? [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const currentOverall = main ? (main.player.grade === "S" ? Number(main.player.baseOverall ?? main.player.overall) + Number(abilityBonuses[mainLevel] ?? mainLevel) : Math.min(99, Number(main.player.baseOverall ?? main.player.overall) + Number(abilityBonuses[mainLevel] ?? mainLevel))) : null;
  const targetOverall = main ? (main.player.grade === "S" ? Number(main.player.baseOverall ?? main.player.overall) + Number(abilityBonuses[mainLevel + 1] ?? mainLevel + 1) : Math.min(99, Number(main.player.baseOverall ?? main.player.overall) + Number(abilityBonuses[mainLevel + 1] ?? mainLevel + 1))) : null;
  const insufficientCoins = leagueEnhancementUseProtection && protectionAvailable && league.wallet.balance < protectionCost;
  const canEnhance = samePlayer && mainLevel < Number(league.enhancement?.maxLevel ?? 8) && !insufficientCoins && leagueEnhancementPhase !== "scanning";
  const result = leagueEnhancementResult;
  const traitOffer = result?.traitOffer ?? league.enhancement?.traitOffer ?? null;
  const traitOfferEntry = traitOffer ? leagueEnhancementCardEntry(traitOffer.cardId) : null;
  const traitPlayer = result?.player ?? traitOfferEntry?.player ?? null;
  const traitRoleLabels = { ANY:"全位置", ATT:"前场", MID:"中场", DEF:"后场", GK:"门将" };
  const traitCards = traitOffer ? traitOffer.traits.map((trait, index) => {
    const roles = (trait.eligibleRoleGroups ?? ["ANY"]).map((role) => traitRoleLabels[role] ?? role).join(" · ");
    return `<button type="button" class="enhancement-trait-card tone-${index + 1}" data-enhancement-trait="${trait.id}" data-enhancement-trait-offer="${traitOffer.id}">
      <span class="enhancement-trait-card-index">0${index + 1}</span>
      <i></i>
      <h3>${escapeHtml(trait.name)}</h3>
      <p>${escapeHtml(trait.summary ?? "特性效果由联赛后台配置。")}</p>
      <b>${escapeHtml(roles)}</b>
      <strong>选择并绑定</strong>
    </button>`;
  }).join("") : "";
  const traitPicker = traitOffer && leagueEnhancementTraitSelectionOpen ? `<div class="enhancement-trait-picker">
    <header><div><h2>选择绑定特性</h2><b>${escapeHtml(traitPlayer?.name ?? traitOffer.playerName ?? "球员")} · +${traitOffer.upgradeLevel}</b></div><button type="button" data-enhancement-close-traits aria-label="关闭">×</button></header>
    <div class="enhancement-trait-card-grid">${traitCards}</div>
  </div>` : "";
  const bindTraitButton = traitOffer ? `<button type="button" class="enhancement-bind-trait" data-enhancement-open-traits>绑定特性</button>` : "";
  const resultCardAttributes = result && !traitOffer ? `draggable="true" data-enhancement-result-card="${result.card.id}" title="拖回球员卡仓库"` : "";
  const resultMarkup = result
    ? `${s4PlayerCardMarkup(result.player, { card:result.card, compact:true, attributes:resultCardAttributes })}<h3>${result.success ? "强化成功" : result.afterLevel < result.beforeLevel ? "强化失败 · 降级" : "强化失败 · 保级"}</h3><b>+${result.beforeLevel} → +${result.afterLevel}</b>${bindTraitButton}`
    : traitOffer && traitOfferEntry
      ? `${s4PlayerCardMarkup(traitOfferEntry.player, { card:traitOfferEntry.card, compact:true })}<h3>等待绑定特性</h3>${bindTraitButton}`
    : `<div class="enhancement-result-empty"><span>+</span><b>结果</b></div>`;
  const warehouseMarkup = warehouseCards.length
    ? warehouseCards.map(({ player, card }) => {
      const listed = leagueEnhancementCardListed(player.id, card.id);
      const attributes = listed ? `draggable="false" aria-disabled="true"` : `draggable="true" data-enhancement-card="${card.id}" data-enhancement-player="${player.id}"`;
      return `<div class="enhancement-warehouse-card ${listed ? "listed" : ""}">${s4PlayerCardMarkup(player, { card, compact:true, attributes })}${listed ? "<span>已挂牌</span>" : ""}</div>`;
    }).join("")
    : `<div class="enhancement-warehouse-empty">没有符合条件的卡片</div>`;
  return `<section class="league-enhancement phase-${leagueEnhancementPhase}">
    <div class="enhancement-left-column"><section class="enhancement-composer">
      <header><h2>球员强化</h2><b>${league.wallet.balance} 金币</b></header>
      <div class="enhancement-flow">
        ${leagueEnhancementSlotMarkup("main", main)}
        ${leagueEnhancementSlotMarkup("material", material)}
        <div class="enhancement-action">
          <strong>${samePlayer ? `${chance}%` : "—"}</strong>
          <small>${main ? `能力 ${currentOverall} → ${targetOverall}` : "选择主卡后显示能力成长"}</small>
          <button type="button" class="enhancement-trigger" data-enhancement-submit ${canEnhance ? "" : "disabled"}>${leagueEnhancementPhase === "scanning" ? "合成中" : "强化"}</button>
          <label class="${protectionAvailable ? "" : "disabled"}"><input type="checkbox" data-enhancement-protection ${leagueEnhancementUseProtection ? "checked" : ""} ${protectionAvailable ? "" : "disabled"}><span>使用保卡道具</span><b>${protectionCost} 金币</b></label>
        </div>
        <div class="enhancement-result-frame">${resultMarkup}</div>
      </div>
      ${traitPicker}
    </section>${leagueEnhancementMiniRankingMarkup()}</div>
    <section class="enhancement-warehouse" data-enhancement-warehouse>
      <header><h2>球员卡仓库</h2><b>${warehouseCards.length}/${allCards.length}</b></header>
      <div class="backpack-card-tools enhancement-tools"><input type="search" value="${escapeHtml(leagueBackpackSearch)}" placeholder="输入后按回车搜索球员、俱乐部或国家队" data-backpack-search><select data-backpack-position><option value="ALL" ${leagueBackpackPosition === "ALL" ? "selected" : ""}>全部位置</option><option value="ATT" ${leagueBackpackPosition === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueBackpackPosition === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueBackpackPosition === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueBackpackPosition === "GK" ? "selected" : ""}>门将</option></select><select data-backpack-upgrade><option value="ALL" ${leagueBackpackUpgrade === "ALL" ? "selected" : ""}>全部强化</option><option value="BASE" ${leagueBackpackUpgrade === "BASE" ? "selected" : ""}>未强化</option><option value="MID" ${leagueBackpackUpgrade === "MID" ? "selected" : ""}>+1 ～ +4</option><option value="HIGH" ${leagueBackpackUpgrade === "HIGH" ? "selected" : ""}>+5 ～ +7</option><option value="MAX" ${leagueBackpackUpgrade === "MAX" ? "selected" : ""}>+8</option></select><select data-enhancement-listing-filter><option value="UNLISTED" ${leagueEnhancementListingFilter === "UNLISTED" ? "selected" : ""}>未挂牌</option><option value="ALL" ${leagueEnhancementListingFilter === "ALL" ? "selected" : ""}>所有</option></select><select data-backpack-sort><option value="upgrade" ${leagueBackpackSort === "upgrade" ? "selected" : ""}>强化等级</option><option value="overall" ${leagueBackpackSort === "overall" ? "selected" : ""}>能力值</option><option value="name" ${leagueBackpackSort === "name" ? "selected" : ""}>姓名</option></select></div>
      <div class="backpack-card-grid compact enhancement-card-grid">${warehouseMarkup}</div>
    </section>
  </section>`;
}

function openS4CardDetail(cardId, playerId) {
  const player = (league.ownTeam?.roster ?? []).find((entry) => entry.id === playerId);
  const card = player?.cards?.find((entry) => entry.id === cardId);
  if (!player || !card) return showToast("找不到这张球员卡");
  const traits = (card.traits ?? []).map((trait) => trait.name).filter(Boolean);
  openLeagueDialog(`<header><div><small>S4 PLAYER CARD</small><h2>${escapeHtml(player.name)}</h2><p>${card.upgradeLevel ? `强化 +${card.upgradeLevel}` : "未强化"} · ${player.ownsRights ? "持有球员所有权" : card.rosterExempt ? "外部获得且免名单额度" : "仅持有单卡"}</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="s4-card-detail"><div>${s4PlayerCardMarkup(player, { card })}</div><section><h3>卡片信息</h3><dl><div><dt>能力值</dt><dd>${card.effectiveOverall ?? player.overall}${card.upgradeBonus ? `（基础${card.baseOverall} +${card.upgradeBonus}）` : ""}</dd></div><div><dt>位置</dt><dd>${ROLE_LABELS[player.role] ?? player.role}${player.secondaryRole ? ` / ${ROLE_LABELS[player.secondaryRole] ?? player.secondaryRole}` : ""}</dd></div><div><dt>强化等级</dt><dd>${card.upgradeLevel ? `+${card.upgradeLevel}` : "未强化"}</dd></div><div><dt>特性</dt><dd>${traits.length ? traits.map(escapeHtml).join("、") : "暂无特性"}</dd></div><div><dt>参考价值</dt><dd>${Number(card.referenceValue ?? player.referencePrice).toLocaleString("zh-CN")} 金币</dd></div><div><dt>获得方式</dt><dd>${escapeHtml(card.acquisitionSource ?? "未知")}</dd></div></dl></section></div>`);
}

function openS4PackResult(result) {
  if (!result?.player || !result?.card) return;
  const ownershipText = result.cardCount > 1 ? `同时获得该球员所有权及 ${result.cardCount} 张+0基础卡` : result.ownershipGranted ? "同时获得该球员所有权" : result.mode === "direct" ? "球员卡已进入背包" : "传奇球员卡已进入背包";
  openLeagueDialog(`<header><div><small>PACK OPENING RESULT</small><h2>获得 ${escapeHtml(result.player.name)}</h2><p>${escapeHtml(ownershipText)}</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="s4-pack-result"><div>${s4PlayerCardMarkup(result.player, { card:result.card })}</div><section><small>NEW PLAYER CARD</small><h3>${escapeHtml(result.player.name)}</h3><p>${escapeHtml(result.player.club)} / ${escapeHtml(result.player.nationality)}</p><b>${result.card.upgradeLevel ? `强化 +${result.card.upgradeLevel}` : "未强化球员卡"}</b><button type="button" class="button primary wide" data-close-league-dialog>收入背包</button></section></div>`);
}

function openS4PackBatchResults(batch) {
  const results = batch?.results ?? [];
  if (!results.length) return;
  const cards = results.map((result, index) => `<article><span>${index + 1}</span>${s4PlayerCardMarkup(result.player, { card:result.card, compact:true })}</article>`).join("");
  openLeagueDialog(`<header><div><small>BATCH PACK OPENING</small><h2>批量开包完成</h2><p>共获得 ${results.length} 张球员卡</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="s4-pack-batch-results">${cards}</div><footer class="s4-pack-batch-footer"><button type="button" class="button primary" data-close-league-dialog>全部收入背包</button></footer>`, "s4-pack-batch-dialog");
}

function leagueRewardPanelMarkup() {
  return "";
}

function leagueMatchPlanMarkup(state, label) {
  const fallback = state === "opening" ? { tactic:league.ownTeam.tactic, style:league.ownTeam.style, positionPreset:"position1" } : state === "leading" ? { tactic:"defensive", style:"counterAttack", positionPreset:"position2" } : { tactic:"positive", style:"highPress", positionPreset:"position3" };
  const plan = ensureLeagueTacticalDraft().tacticalPlans[state] ?? fallback;
  return `<section class="league-match-plan"><header><b>${label}</b></header><div class="league-match-plan-fields"><label class="field"><span>比赛思路</span><select name="${state}Tactic">${Object.entries(TACTICS).map(([key,value]) => `<option value="${key}" ${plan.tactic === key ? "selected" : ""}>${value}</option>`).join("")}</select></label><label class="field"><span>战术打法</span><select name="${state}Style">${Object.entries(STYLES).map(([key,value]) => `<option value="${key}" ${plan.style === key ? "selected" : ""}>${value}</option>`).join("")}</select></label></div></section>`;
}

function leagueSquadMarkup() {
  const roster = league.ownTeam.roster;
  if (!leagueStartingIds || leagueStartingIds.length !== 11 || leagueStartingIds.some((id) => !roster.some((player) => player.id === id))) {
    leagueStartingIds = roster.filter((player) => player.starter).map((player) => player.id).slice(0, 11);
    leaguePositionPresets = null;
  }
  if (!leaguePositionPresets) {
    const source = league.ownTeam.positionPresets ?? {};
    const base = structuredClone(league.ownTeam.positions);
    leaguePositionPresets = {
      position1:structuredClone(source.position1 ?? base),
      position2:structuredClone(source.position2 ?? base),
      position3:structuredClone(source.position3 ?? base),
    };
  }
  leaguePositions = leaguePositionPresets[leagueActivePositionPreset] ?? leaguePositionPresets.position1;
  const startingSet = new Set(leagueStartingIds);
  const starters = roster.filter((player) => startingSet.has(player.id));
  const bench = roster.filter((player) => !startingSet.has(player.id));
  const shape = formationFromPositions(starters, leaguePositions, { requireOutfieldLines:leagueActivePositionPreset === "position1" });
  const presetShapes = Object.fromEntries(Object.entries(leaguePositionPresets).map(([key, positions]) => [key, formationFromPositions(starters, positions, { requireOutfieldLines:key === "position1" })]));
  const magnets = starters.map((player) => leagueBoardMagnet(player, leaguePositions[player.id] ?? { x:50, y:50 }, shape.roles[player.id])).join("");
  const chemistryLines = leagueChemistryLinesMarkup(starters, leaguePositions, shape.roles);
  const fitCounts = { primary:0, secondary:0, unfamiliar:0 };
  const fitScore = Math.round(starters.reduce((total, player) => {
    const fit = positionFit(player, shape.roles[player.id]);
    fitCounts[fit] += 1;
    return total + (fit === "primary" ? 100 : fit === "secondary" ? 90 : 66);
  }, 0) / Math.max(1, starters.length));
  const fitLabel = fitScore >= 94 ? "极佳" : fitScore >= 86 ? "良好" : fitScore >= 76 ? "尚可" : "需要调整";
  const tacticalDraft = ensureLeagueTacticalDraft();
  const openingPlan = tacticalDraft.tacticalPlans.opening;
  const activePlan = Object.values(tacticalDraft.tacticalPlans).find((plan) => plan.positionPreset === leagueActivePositionPreset) ?? openingPlan;
  const tacticalFit = leagueTacticalFit(starters, shape.roles, leaguePositions, activePlan);
  const tacticalLabel = tacticalFit >= 88 ? "高度适配" : tacticalFit >= 78 ? "适配良好" : tacticalFit >= 68 ? "基本适配" : "需要调整";
  const bonds = evaluateS4LineupBonds(starters, league.bondCatalog ?? [], { roles:shape.roles });
  const bondReady = bonds.length
    ? `<div class="league-bond-ready"><b>羁绊已可用</b>${bonds.map((bond) => `<span>${escapeHtml(bond.name)}羁绊 ${bond.count}/11 <em>+${(bond.bonus * 100).toFixed(1).replace(".0", "")}%</em></span>`).join("")}</div>`
    : "";
  const presetValidity = Object.fromEntries(Object.entries(presetShapes).map(([key, entry]) => [key, entry.valid]));
  const allPresetsValid = Object.values(presetValidity).every(Boolean);
  const positionLabels = { position1:"开局/平局站位", position2:"领先站位", position3:"落后站位" };
  const positionTabs = `<nav class="league-position-tabs" aria-label="保存站位">${["position1", "position2", "position3"].map((key) => `<button type="button" data-league-position-preset="${key}" class="${leagueActivePositionPreset === key ? "active" : ""} ${presetValidity[key] ? "valid" : "invalid"}" aria-pressed="${leagueActivePositionPreset === key}">${positionLabels[key]}</button>`).join("")}</nav>`;
  const boardToolbar = `<div class="league-board-toolbar"><label class="league-board-chemistry"><input type="checkbox" data-league-chemistry-toggle ${leagueShowChemistry ? "checked" : ""}><span>默契连线</span></label>${positionTabs}<label class="league-board-fitness"><span>体力红线</span><input type="range" name="fitnessThreshold" min="45" max="90" step="5" value="${tacticalDraft.fitnessThreshold}"><output data-fitness-threshold-output>${tacticalDraft.fitnessThreshold}</output></label></div>`;
  const boardFooter = `<footer class="league-board-footer"><div class="league-board-directions"><label class="field"><span>主攻方向</span><select name="attackFocus">${focusOptions(tacticalDraft.attackFocus)}</select></label><label class="field"><span>主守方向</span><select name="defenseFocus">${focusOptions(tacticalDraft.defenseFocus)}</select></label></div><span class="league-autosave-status" data-league-autosave-status data-state="${leagueEditorDirty ? "pending" : "saved"}">${leagueEditorDirty ? "等待自动保存" : "已实时保存"}</span></footer>`;
  const benchSummary = `<section class="league-bench-summary"><div class="league-bench-summary-title"><small>AUTO FORMATION</small><b>自动识别阵型</b></div><div class="league-bench-shape"><strong>${shape.name}</strong><span class="${shape.valid ? "valid" : "invalid"}">${shape.valid ? "阵型有效" : "需要调整"}</span></div><div class="league-fit-row"><div class="league-fit-block"><div class="league-fit-heading"><span>阵容适配度</span><b>${fitScore}<small>/100 · ${fitLabel}</small></b></div><div class="league-fit-bar"><span style="width:${fitScore}%"></span></div></div><div class="league-fit-block tactical"><div class="league-fit-heading"><span>战术适配度</span><b>${tacticalFit}<small>/100 · ${tacticalLabel}</small></b></div><div class="league-fit-bar"><span style="width:${tacticalFit}%"></span></div></div></div><div class="league-fit-counts"><span>主位置<b>${fitCounts.primary}</b></span><span>副位置<b>${fitCounts.secondary}</b></span><span>不适配<b>${fitCounts.unfamiliar}</b></span></div>${shape.valid ? "" : `<p>${shape.message}</p>`}</section>`;
  const matchPlans = `<section class="league-match-plans league-bench-match-plans"><header><b>赛中战术</b></header><div class="league-match-plan-grid">${leagueMatchPlanMarkup("opening", "开局 / 平局")}${leagueMatchPlanMarkup("leading", "领先")}${leagueMatchPlanMarkup("trailing", "落后")}</div></section>`;
  return `<form class="league-tactics-layout" id="league-squad-form">${leagueNextMatchMarkup()}<section class="league-lineup-workspace"><section class="board-panel league-board-panel"><header class="league-board-heading"><div><small>STARTING XI · POSITION AUTO DETECTION</small><h2>首发战术板</h2>${bondReady}</div>${boardToolbar}</header>${pitchMarkup(`${chemistryLines}${magnets}`, "league-tactics-pitch")}${boardFooter}</section><aside class="tournament-bench league-bench"><header><div><small>FULL SQUAD</small><b>替补席 · ${bench.length}人</b></div><span>主力与替补磁贴可双向拖动交换</span></header><div class="bench-magnet-list">${bench.map(leagueBenchMagnet).join("")}</div>${benchSummary}${matchPlans}</aside></section>${allPresetsValid ? "" : `<p class="league-position-save-warning">开局/平局站位需要保持完整阵型；领先与落后站位只要求场上保留一名门将。</p>`}</form>`;
}

function leagueChemistryLinesMarkup(starters, positions, roles) {
  if (!leagueShowChemistry) return "";
  const starterIds = new Set(starters.map((player) => player.id));
  const group = (role) => role === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(role) ? "DEF" : ["ST", "LW", "RW"].includes(role) ? "ATT" : "MID";
  const lines = (league.ownTeam.chemistryLinks ?? []).filter((link) => {
    const [firstId, secondId] = link.playerIds;
    const first = positions[firstId];
    const second = positions[secondId];
    return starterIds.has(firstId) && starterIds.has(secondId) && first && second
      && group(roles[firstId]) !== "GK" && group(roles[firstId]) === group(roles[secondId])
      && Math.abs(first.y - second.y) <= 12 && Math.hypot(first.x - second.x, first.y - second.y) <= 36;
  }).map((link) => {
    const [firstId, secondId] = link.playerIds;
    return `<line x1="${positions[firstId].x}" y1="${positions[firstId].y}" x2="${positions[secondId].x}" y2="${positions[secondId].y}" data-chemistry="${link.value}"><title>默契度 ${link.value} · 加成 ${(link.bonus * 100).toFixed(2)}%</title></line>`;
  }).join("");
  return lines ? `<svg class="league-chemistry-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="球员默契连线">${lines}</svg>` : "";
}

function swapLeagueStarter(benchId, starterId) {
  const index = leagueStartingIds.indexOf(starterId);
  if (index < 0) return;
  leagueStartingIds[index] = benchId;
  Object.values(leaguePositionPresets ?? {}).forEach((positions) => {
    positions[benchId] = { ...(positions[starterId] ?? { x:50, y:45 }) };
    delete positions[starterId];
  });
  leaguePositions = leaguePositionPresets?.[leagueActivePositionPreset] ?? leaguePositions;
  renderLeague();
  scheduleLeagueTeamAutoSave(180);
}

function bindLeagueMagnetTooltips() {
  document.querySelector(".league-magnet-tooltip")?.remove();
  let tooltip = null;
  const hide = () => {
    tooltip?.remove();
    tooltip = null;
  };
  const show = (magnet, clientX, clientY) => {
    hide();
    tooltip = document.createElement("div");
    tooltip.className = "league-magnet-tooltip";
    tooltip.textContent = magnet.dataset.traits ?? "";
    document.body.appendChild(tooltip);
    const place = (x, y) => {
      const rect = tooltip.getBoundingClientRect();
      const left = Math.max(10, Math.min(window.innerWidth - rect.width - 10, x - rect.width / 2));
      const preferredTop = y - rect.height - 14;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${preferredTop >= 10 ? preferredTop : Math.min(window.innerHeight - rect.height - 10, y + 18)}px`;
    };
    place(clientX, clientY);
    return place;
  };
  document.querySelectorAll(".league-squad-magnet[data-traits],.league-bench-magnet[data-traits]").forEach((magnet) => {
    let place = null;
    magnet.addEventListener("pointerenter", (event) => { if (!draggingMagnet) place = show(magnet, event.clientX, event.clientY); });
    magnet.addEventListener("pointermove", (event) => { if (place && !draggingMagnet) place(event.clientX, event.clientY); });
    magnet.addEventListener("pointerleave", () => { place = null; hide(); });
    magnet.addEventListener("pointerdown", () => { place = null; hide(); });
    magnet.addEventListener("focus", () => {
      const rect = magnet.getBoundingClientRect();
      place = show(magnet, rect.left + rect.width / 2, rect.top);
    });
    magnet.addEventListener("blur", () => { place = null; hide(); });
  });
}

function bindLeagueSquad() {
  bindLeagueMagnetTooltips();
  const pitch = document.querySelector("#league-tactics-pitch");
  const benchTargetAt = (clientX, clientY, ignoredMagnet) => {
    ignoredMagnet.style.pointerEvents = "none";
    const element = document.elementFromPoint(clientX, clientY);
    ignoredMagnet.style.pointerEvents = "";
    const direct = element?.closest("[data-league-bench-magnet]") ?? null;
    if (direct) return direct;
    const list = element?.closest(".league-bench .bench-magnet-list");
    if (!list) return null;
    const candidates = [...list.querySelectorAll("[data-league-bench-magnet]")];
    return candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return Math.hypot(clientX - (leftRect.left + leftRect.width / 2), clientY - (leftRect.top + leftRect.height / 2))
        - Math.hypot(clientX - (rightRect.left + rightRect.width / 2), clientY - (rightRect.top + rightRect.height / 2));
    })[0] ?? null;
  };
  document.querySelectorAll("[data-league-magnet]").forEach((magnet) => magnet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const playerId = magnet.dataset.leagueMagnet;
    const startPosition = { ...leaguePositions[playerId] };
    const pointerStart = { x:event.clientX, y:event.clientY };
    let moved = false;
    let benchTarget = null;
    let ghost = null;
    draggingMagnet = true;
    magnet.classList.add("dragging");
    const removeGhost = () => {
      ghost?.remove();
      ghost = null;
      magnet.classList.remove("league-drag-source-hidden");
    };
    const moveGhost = (moveEvent) => {
      ghost ??= (() => {
        const clone = magnet.cloneNode(true);
        clone.removeAttribute("data-league-magnet");
        clone.removeAttribute("style");
        clone.classList.remove("league-squad-magnet", "dragging");
        clone.classList.add("bench-drag-ghost", "league-field-drag-ghost");
        document.body.appendChild(clone);
        return clone;
      })();
      magnet.classList.add("league-drag-source-hidden");
      ghost.style.left = `${moveEvent.clientX}px`;
      ghost.style.top = `${moveEvent.clientY}px`;
    };
    const move = (moveEvent) => {
      moved ||= Math.hypot(moveEvent.clientX - pointerStart.x, moveEvent.clientY - pointerStart.y) >= 3;
      if (!moved) return;
      const nextBenchTarget = benchTargetAt(moveEvent.clientX, moveEvent.clientY, magnet);
      if (nextBenchTarget !== benchTarget) {
        benchTarget?.classList.remove("swap-target");
        benchTarget = nextBenchTarget;
        benchTarget?.classList.add("swap-target");
      }
      const rect = pitch.getBoundingClientRect();
      const insidePitch = moveEvent.clientX >= rect.left && moveEvent.clientX <= rect.right && moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom;
      if (benchTarget || !insidePitch) {
        moveGhost(moveEvent);
        return;
      }
      removeGhost();
      const x = Math.max(8, Math.min(92, ((moveEvent.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(6, Math.min(94, ((moveEvent.clientY - rect.top) / rect.height) * 100));
      leaguePositions[playerId] = { x:Math.round(x), y:Math.round(y) };
      magnet.style.left = `${x}%`; magnet.style.top = `${y}%`;
    };
    const finish = (pointerEvent) => {
      move(pointerEvent);
      draggingMagnet = false;
      magnet.classList.remove("dragging");
      benchTarget?.classList.remove("swap-target");
      removeGhost();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (benchTarget) {
        leaguePositions[playerId] = startPosition;
        leagueEditorDirty = true;
        swapLeagueStarter(benchTarget.dataset.leagueBenchMagnet, playerId);
        return;
      }
      if (moved && hasMultipleGoalkeepers(leaguePositions, playerId, leaguePositions[playerId])) {
        leaguePositions[playerId] = startPosition;
        showToast("门将位置最多只能安排一名球员");
      }
      if (moved) {
        leagueEditorDirty = true;
        renderLeague();
        scheduleLeagueTeamAutoSave(180);
      }
    };
    const cancel = () => {
      draggingMagnet = false;
      leaguePositions[playerId] = startPosition;
      benchTarget?.classList.remove("swap-target");
      removeGhost();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      renderLeague();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once:true });
    window.addEventListener("pointercancel", cancel, { once:true });
  }));
  document.querySelectorAll("[data-league-bench-magnet]").forEach((magnet) => magnet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingMagnet = true;
    const ghost = magnet.cloneNode(true);
    let target = null;
    ghost.removeAttribute("data-league-bench-magnet");
    ghost.classList.remove("bench-magnet", "league-bench-magnet");
    ghost.classList.add("bench-drag-ghost");
    document.body.appendChild(ghost);
    magnet.classList.add("league-bench-source-removed");
    const move = (pointerEvent) => {
      ghost.style.left = `${pointerEvent.clientX}px`; ghost.style.top = `${pointerEvent.clientY}px`;
      const next = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest("[data-league-magnet]") ?? null;
      if (next !== target) { target?.classList.remove("swap-target"); target = next; target?.classList.add("swap-target"); }
    };
    const finish = (pointerEvent) => {
      draggingMagnet = false;
      move(pointerEvent); target?.classList.remove("swap-target"); ghost.remove();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (target) {
        leagueEditorDirty = true;
        swapLeagueStarter(magnet.dataset.leagueBenchMagnet, target.dataset.leagueMagnet);
        return;
      }
      magnet.classList.remove("league-bench-source-removed");
    };
    const cancel = () => {
      draggingMagnet = false;
      target?.classList.remove("swap-target"); ghost.remove();
      magnet.classList.remove("league-bench-source-removed");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
    move(event);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once:true });
    window.addEventListener("pointercancel", cancel, { once:true });
  }));
}

function leagueLeaderboardRows(entries, metric) {
  return entries.length ? entries.map((entry,index) => `<tr><td>${index + 1}</td><td><b>${escapeHtml(entry.playerName)}</b><small>${escapeHtml(entry.teamName)}</small></td><td>${entry.appearances}</td><td><strong>${metric(entry)}</strong></td></tr>`).join("") : `<tr><td colspan="4" class="league-empty">完成比赛后生成数据。</td></tr>`;
}

function leagueStatsMarkup() {
  const configs = { scorers:["射手榜","进球",(entry) => entry.goals], assists:["助攻榜","助攻",(entry) => entry.assists], ratings:["评分榜","评分",(entry) => entry.averageRating.toFixed(2)], saves:["扑救榜","扑救",(entry) => entry.saves], cards:["纪律榜","红 / 黄",(entry) => `${entry.redCards} / ${entry.yellowCards}`] };
  const [title,label,metric] = configs[leagueBoard];
  const entries = leagueStatsScope === "team" ? league.teamLeaderboards[leagueBoard] : leagueStatsScope === "cup" ? (league.cupLeaderboards?.[leagueBoard] ?? []) : league.leaderboards[leagueBoard];
  return `<section class="league-panel leaderboard-panel"><header><div><small>COMPETITION STATS</small><h2>${title}</h2></div><div class="league-scope-toggle"><button data-league-stats-scope="league" class="${leagueStatsScope === "league" ? "active" : ""}">全联赛</button><button data-league-stats-scope="cup" class="${leagueStatsScope === "cup" ? "active" : ""}">全杯赛</button><button data-league-stats-scope="team" class="${leagueStatsScope === "team" ? "active" : ""}">本球队</button></div></header><div class="league-board-tabs">${Object.entries(configs).map(([key,value]) => `<button type="button" data-league-board="${key}" class="${leagueBoard === key ? "active" : ""}">${value[0]}</button>`).join("")}</div><table class="league-table"><thead><tr><th>#</th><th>球员</th><th>出场</th><th>${label}</th></tr></thead><tbody>${leagueLeaderboardRows(entries, metric)}</tbody></table></section>`;
}

function marketRoleGroup(player) {
  return player.role === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(player.role) ? "DEF" : ["ST", "LW", "RW"].includes(player.role) ? "ATT" : "MID";
}

function marketMatches(player, search, position) {
  const query = String(search ?? "").trim().toLocaleLowerCase("zh-CN");
  return (!query || [player.name, player.club, player.nationality].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(query)))
    && (position === "ALL" || marketRoleGroup(player) === position);
}

function marketFilterMarkup(prefix, search, position, includeUpgrade = false) {
  return `<div class="s4-market-filters"><input type="search" value="${escapeHtml(search)}" placeholder="搜索球员、俱乐部或国家队" data-market-filter-search="${prefix}"><select data-market-filter-position="${prefix}"><option value="ALL" ${position === "ALL" ? "selected" : ""}>全部位置</option><option value="ATT" ${position === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${position === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${position === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${position === "GK" ? "selected" : ""}>门将</option></select>${includeUpgrade ? `<select data-market-filter-upgrade><option value="ALL" ${leagueMarketWarehouseUpgrade === "ALL" ? "selected" : ""}>全部强化</option><option value="MID" ${leagueMarketWarehouseUpgrade === "MID" ? "selected" : ""}>+1 ～ +4</option><option value="HIGH" ${leagueMarketWarehouseUpgrade === "HIGH" ? "selected" : ""}>+5 ～ +7</option><option value="MAX" ${leagueMarketWarehouseUpgrade === "MAX" ? "selected" : ""}>+8</option></select>` : ""}</div>`;
}

function leaguePlayerHolderMarkup(holder) {
  return `<span><b>${escapeHtml(holder.ownerName)}</b><small>${escapeHtml(holder.teamName)} · ${holder.cardCount}张 · 最高+${holder.highestUpgradeLevel}</small></span>`;
}

function leaguePlayerSearchMarkup() {
  const query = leaguePlayerSearchQuery.trim().toLocaleLowerCase("zh-CN");
  const roleQuery = ["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"].includes(query.toUpperCase()) ? query.toUpperCase() : null;
  const results = query ? (league.playerDirectory?.players ?? []).filter((player) => roleQuery
    ? [player.role, player.secondaryRole].includes(roleQuery)
    : [player.name, player.club, player.nationality].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(query))) : [];
  const resultMarkup = results.length ? results.map((player) => {
    const ownership = player.ownership
      ? `<b>${escapeHtml(player.ownership.ownerName)}</b><small>${escapeHtml(player.ownership.teamName)}</small>`
      : `<b>暂无玩家所有权</b><small>${player.legend ? "传奇球员不设置唯一所有权" : "当前属于公共池"}</small>`;
    const holders = player.holders.length ? player.holders.map(leaguePlayerHolderMarkup).join("") : `<em>当前没有玩家持卡</em>`;
    return `<article class="player-directory-row grade-${String(player.grade ?? "C").toLowerCase()}"><div class="player-directory-identity"><i>${escapeHtml(player.role)}</i><span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.club)} · ${escapeHtml(player.nationality)}</small></span></div><dl><div><dt>默认能力</dt><dd>${player.overall}</dd></div><div><dt>位置</dt><dd>${escapeHtml(ROLE_LABELS[player.role] ?? player.role)}</dd></div><div><dt>评级</dt><dd>${escapeHtml(player.grade)}</dd></div><div><dt>最高强化</dt><dd>+${player.highestUpgradeLevel}</dd></div></dl><section><small>球员所有权</small>${ownership}</section><section class="player-directory-holders"><small>持卡玩家</small><div>${holders}</div></section></article>`;
  }).join("") : query ? `<p class="player-directory-empty">没有找到符合“${escapeHtml(leaguePlayerSearchQuery)}”的球员。</p>` : `<p class="player-directory-empty">输入球员、俱乐部或国家队名称开始搜索。</p>`;
  return `<section class="player-info-shell"><header><button type="button" class="button secondary" data-player-info-section="back">返回功能选择</button><div><small>GLOBAL PLAYER DATABASE</small><h2>球员搜索</h2></div><b>${results.length} 条结果</b></header><div class="player-search-hero"><small>YDL PLAYER SEARCH</small><form data-player-directory-search><input type="search" value="${escapeHtml(leaguePlayerSearchDraft)}" placeholder="搜索球员、俱乐部、国家队或位置（如 ST、GK）" data-player-directory-search-input><button type="submit">搜索</button></form><p>支持主位置和副位置英文代码 · 按回车或点击按钮搜索</p></div><div class="player-directory-list">${resultMarkup}</div></section>`;
}

function leagueEnhancementRankingMarkup() {
  const query = leagueEnhancementRankingSearch.trim().toLocaleLowerCase("zh-CN");
  const ranking = (league.playerDirectory?.enhancementRanking ?? []).map((entry, index) => ({ ...entry, rank:index + 1 })).filter((entry) => {
    const player = entry.player;
    const matchesSearch = !query || [player.name, player.club, player.nationality, entry.ownerName, entry.teamName].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(query));
    const matchesPosition = leagueEnhancementRankingPosition === "ALL" || marketRoleGroup(player) === leagueEnhancementRankingPosition;
    const matchesGrade = leagueEnhancementRankingGrade === "ALL" || player.grade === leagueEnhancementRankingGrade;
    const level = Number(entry.upgradeLevel ?? 0);
    const matchesLevel = leagueEnhancementRankingLevel === "ALL"
      || leagueEnhancementRankingLevel === "ENHANCED" && level > 0
      || leagueEnhancementRankingLevel === "HIGH" && level >= 5
      || leagueEnhancementRankingLevel === "MAX" && level >= 8;
    return matchesSearch && matchesPosition && matchesGrade && matchesLevel;
  });
  const rows = ranking.length ? ranking.map((entry) => `<tr><td><strong>${entry.rank}</strong></td><td><div class="enhancement-ranking-player"><i class="grade-${String(entry.player.grade).toLowerCase()}">${escapeHtml(entry.player.grade)}</i><span><b>${escapeHtml(entry.player.name)}</b><small>${escapeHtml(entry.player.club)} · ${escapeHtml(entry.player.nationality)}</small></span></div></td><td>${escapeHtml(ROLE_LABELS[entry.player.role] ?? entry.player.role)}</td><td>${entry.player.overall}</td><td><strong class="enhancement-ranking-level level-${Math.min(8, entry.upgradeLevel)}">+${entry.upgradeLevel}</strong></td><td><b>${escapeHtml(entry.ownerName)}</b><small class="ranking-team-name">${escapeHtml(entry.teamName)}</small></td></tr>`).join("") : `<tr><td colspan="6" class="league-empty">当前筛选条件下没有球员卡。</td></tr>`;
  return `<section class="player-info-shell"><header><button type="button" class="button secondary" data-player-info-section="back">返回功能选择</button><div><small>S4 ENHANCEMENT RANKING</small><h2>强化排行榜</h2></div><b>${ranking.length} 张卡</b></header><div class="enhancement-ranking-filters"><input type="search" value="${escapeHtml(leagueEnhancementRankingSearch)}" placeholder="搜索球员、持有玩家或球队" data-enhancement-ranking-search><select data-enhancement-ranking-position><option value="ALL" ${leagueEnhancementRankingPosition === "ALL" ? "selected" : ""}>全部位置</option><option value="ATT" ${leagueEnhancementRankingPosition === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueEnhancementRankingPosition === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueEnhancementRankingPosition === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueEnhancementRankingPosition === "GK" ? "selected" : ""}>门将</option></select><select data-enhancement-ranking-grade><option value="ALL" ${leagueEnhancementRankingGrade === "ALL" ? "selected" : ""}>全部评级</option>${["S", "A", "B", "C"].map((grade) => `<option value="${grade}" ${leagueEnhancementRankingGrade === grade ? "selected" : ""}>${grade}级</option>`).join("")}</select><select data-enhancement-ranking-level><option value="ALL" ${leagueEnhancementRankingLevel === "ALL" ? "selected" : ""}>全部等级</option><option value="ENHANCED" ${leagueEnhancementRankingLevel === "ENHANCED" ? "selected" : ""}>+1以上</option><option value="HIGH" ${leagueEnhancementRankingLevel === "HIGH" ? "selected" : ""}>+5以上</option><option value="MAX" ${leagueEnhancementRankingLevel === "MAX" ? "selected" : ""}>仅+8</option></select></div><div class="enhancement-ranking-table"><table><thead><tr><th>排名</th><th>球员</th><th>位置</th><th>默认能力</th><th>强化</th><th>持有玩家</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function leaguePlayerInfoMarkup() {
  if (leaguePlayerInfoSection === "search") return leaguePlayerSearchMarkup();
  if (leaguePlayerInfoSection === "ranking") return leagueEnhancementRankingMarkup();
  return `<section class="s4-market-entry player-info-entry"><header><small>YDL PLAYER INFORMATION</small><h2>球员信息</h2><p>查询全服球员资产与强化情况</p></header><div><button type="button" data-player-info-section="search"><i>⌕</i><b>球员搜索</b><span>搜索球员、俱乐部或国家队并查看资产归属</span></button><button type="button" data-player-info-section="ranking"><i>TOP</i><b>强化排行榜</b><span>查看全服玩家持有球员卡的强化排名</span></button></div></section>`;
}

function marketListingCard(item) {
  const ownership = item.kind === "ownership";
  const card = ownership ? { upgradeLevel:0, traits:[] } : item.card;
  const meta = ownership
    ? item.retainedUpgradeLevel == null
      ? "球员所有权 · 卖家不保留基础卡"
      : `球员所有权 · 卖家保留 ${item.retainedCardCount ?? 0} 张 +${item.retainedUpgradeLevel}`
    : `${item.player.pool === "LEGEND" ? "传奇单卡" : "强化单卡"} · +${card?.upgradeLevel ?? 0}`;
  return `<article class="s4-market-listing">${s4PlayerCardMarkup(item.player, { card, compact:true })}<div><b>${item.price} 金币</b><small>${escapeHtml(item.sellerTeamName)} · ${escapeHtml(meta)}</small>${item.sellerId === account.profile.id ? `<button class="button secondary" data-market-cancel="${item.id}">撤回挂牌</button>` : `<button class="button primary" data-market-buy="${item.id}">立即购买</button>`}</div></article>`;
}

function tradeCardChoiceMarkup(entry, side) {
  const card = entry.card;
  const player = entry.player;
  const selectedSet = side === "offered" ? leagueTradeOfferedCardIds : leagueTradeRequestedCardIds;
  const selected = selectedSet.has(card.id);
  const listed = league.listings.some((item) => item.cardId === card.id || item.kind === "ownership" && item.playerId === player.id);
  const locked = league.tradeLockedCardIds?.includes(card.id);
  const ownLastAnchor = side === "offered" && !player.xPlayer && player.ownsRights && player.cards.length === 1;
  const disabled = listed || locked || ownLastAnchor;
  const reason = listed ? "已挂牌" : locked ? "交易中" : ownLastAnchor ? "所有权锚点" : "";
  return `<div class="card-trade-choice ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}">${s4PlayerCardMarkup(player, { card, compact:true, attributes:disabled ? `aria-disabled="true"` : `data-card-trade-choice="${card.id}" data-card-trade-side="${side}" data-card-trade-x="${player.xPlayer ? "true" : "false"}"` })}${disabled ? `<span>${escapeHtml(reason)}</span>` : selected ? `<span>已选择</span>` : ""}</div>`;
}

function leagueCardTradeMarkup() {
  const targetTeam = league.teams.find((team) => team.ownerId === leagueTradeTargetOwnerId && !team.isAi);
  const playerOptions = league.teams.filter((team) => !team.isAi && team.ownerId && team.ownerId !== account.profile.id).map((team) => `<option value="${escapeHtml(team.ownerId)}" ${team.ownerId === leagueTradeTargetOwnerId ? "selected" : ""}>${escapeHtml(team.ownerName)} · ${escapeHtml(team.name)}</option>`).join("");
  const ownCards = league.ownTeam.roster.flatMap((player) => player.cards.filter((card) => player.xPlayer || Number(card.upgradeLevel ?? 0) >= 1).map((card) => ({ player, card })));
  const targetCards = targetTeam ? (league.playerDirectory?.enhancementRanking ?? []).filter((entry) => entry.ownerId === targetTeam.ownerId && (entry.player.xPlayer || Number(entry.upgradeLevel ?? 0) >= 1)).map((entry) => ({ player:entry.player, card:{ id:entry.cardId, upgradeLevel:entry.upgradeLevel, traits:entry.traits ?? [] } })) : [];
  const selectedEntries = [...ownCards, ...targetCards].filter(({ card }) => leagueTradeOfferedCardIds.has(card.id) || leagueTradeRequestedCardIds.has(card.id));
  const xTradeSelected = selectedEntries.some(({ player }) => player.xPlayer);
  const xTradeReady = xTradeSelected && selectedEntries.length === 2 && selectedEntries.every(({ player }) => player.xPlayer) && leagueTradeOfferedCardIds.size === 1 && leagueTradeRequestedCardIds.size === 1;
  const tradeReady = targetTeam && leagueTradeRequestedCardIds.size && leagueTradeOfferedCardIds.size && (!xTradeSelected || xTradeReady);
  const statusLabels = { pending:"等待接受", rejected:"被拒绝", accepted:"交易成功", withdrawn:"已撤回", failed:"交易失败" };
  const outgoing = (league.cardTradeOffers ?? []).filter((offer) => offer.fromOwnerId === account.profile.id);
  const history = outgoing.length ? outgoing.map((offer) => `<article class="card-trade-status status-${offer.status}"><div><small>${new Date(offer.createdAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false })}</small><b>与 ${escapeHtml(offer.toOwnerName)} 的交易</b><span>我方${offer.offeredCards.length}张 · 对方${offer.requestedCards.length}张${offer.coinAmount ? ` · 附带${offer.coinAmount}金币` : ""}</span></div><strong>${statusLabels[offer.status] ?? offer.status}</strong>${offer.status === "pending" ? `<button type="button" class="button secondary" data-card-trade-withdraw="${offer.id}">撤回</button>` : ""}</article>`).join("") : `<p class="s4-market-empty">你还没有发起过球员卡交易。</p>`;
  const targetGrid = targetTeam ? targetCards.length ? targetCards.map((entry) => tradeCardChoiceMarkup(entry, "requested")).join("") : `<p class="s4-market-empty">该玩家没有可交易的强化卡。</p>` : `<p class="s4-market-empty">请先选择一名其他真人玩家。</p>`;
  const ownGrid = ownCards.length ? ownCards.map((entry) => tradeCardChoiceMarkup(entry, "offered")).join("") : `<p class="s4-market-empty">你没有可用于交易的强化卡。</p>`;
  return `<section class="card-trade-shell"><header><button type="button" class="button secondary" data-market-section="back">返回市场选择</button><div><small>PLAYER TO PLAYER TRADE</small><h2>发起交易</h2></div><b>${league.wallet.balance} 金币</b></header><div class="card-trade-target"><label><span>交易对象</span><select data-card-trade-target><option value="">请选择真人玩家</option>${playerOptions}</select></label><div><span>已选择</span><b>对方 ${leagueTradeRequestedCardIds.size} 张 / 我方 ${leagueTradeOfferedCardIds.size} 张</b></div></div>${xTradeSelected ? `<p class="card-trade-x-notice">X级球员交易仅支持双方各选择1名X级球员，且不能附带金币。</p>` : ""}<div class="card-trade-columns"><section><header><div><small>REQUESTED CARDS</small><h3>${targetTeam ? `${escapeHtml(targetTeam.ownerName)}的强化卡 / X球员` : "对方强化卡 / X球员"}</h3></div></header><div class="s4-market-card-grid">${targetGrid}</div></section><section><header><div><small>MY OFFER</small><h3>我的强化卡 / X球员</h3></div></header><div class="s4-market-card-grid">${ownGrid}</div><footer><label><span>附带金币</span><input type="number" min="0" step="1" value="${xTradeSelected ? "0" : escapeHtml(leagueTradeCoinAmount)}" placeholder="0" data-card-trade-coins ${xTradeSelected ? "disabled" : ""}></label><button type="button" class="button primary" data-card-trade-submit ${tradeReady ? "" : "disabled"}>发起交易</button></footer></section></div><section class="card-trade-history"><header><div><small>MY TRADE OFFERS</small><h3>我发起的交易</h3></div></header><div>${history}</div></section></section>`;
}

function leagueMarketMarkup() {
  if (!leagueMarketSection) return `<section class="s4-market-entry market-entry-three"><header><small>S4 TRANSFER MARKET</small><h2>交易市场</h2><p>选择需要进入的资产市场</p></header><div><button type="button" data-market-section="card"><i>+8</i><b>传奇 / 强化单卡市场</b><span>购买或挂牌传奇卡及强化球员卡</span></button><button type="button" data-market-section="ownership"><i>OWN</i><b>球员所有权市场</b><span>转移非传奇球员的全服唯一所有权</span></button><button type="button" data-market-section="trade"><i>⇄</i><b>发起交易</b><span>与其他真人玩家交换强化卡并附带金币</span></button></div></section>`;
  if (leagueMarketSection === "trade") return leagueCardTradeMarkup();
  const ownership = leagueMarketSection === "ownership";
  const listings = league.listings.filter((item) => (item.kind === "ownership") === ownership)
    .filter((item) => marketMatches(item.player, leagueMarketListingSearch, leagueMarketListingPosition));
  const warehouseEntries = ownership
    ? league.ownTeam.roster.filter((player) => player.ownsRights && player.pool !== "LEGEND" && !player.xPlayer).map((player) => ({ player, card:{ upgradeLevel:0, traits:[] } }))
    : league.ownTeam.roster.filter((player) => !player.xPlayer).flatMap((player) => player.cards.filter((card) => player.pool === "LEGEND" || Number(card.upgradeLevel) >= 1).map((card) => ({ player, card })));
  const filteredWarehouse = warehouseEntries.filter(({ player, card }) => marketMatches(player, leagueMarketWarehouseSearch, leagueMarketWarehousePosition)
    && (ownership || leagueMarketWarehouseUpgrade === "ALL" || leagueMarketWarehouseUpgrade === "MID" && card.upgradeLevel <= 4 || leagueMarketWarehouseUpgrade === "HIGH" && card.upgradeLevel >= 5 && card.upgradeLevel <= 7 || leagueMarketWarehouseUpgrade === "MAX" && card.upgradeLevel >= 8));
  const listingCards = listings.length ? listings.map(marketListingCard).join("") : `<p class="s4-market-empty">当前没有符合条件的挂牌资产。</p>`;
  const warehouseCards = filteredWarehouse.length ? filteredWarehouse.map(({ player, card }) => {
    const listed = league.listings.some((item) => item.sellerId === account.profile.id
      && (ownership ? item.playerId === player.id : item.kind === "ownership" && item.playerId === player.id || item.cardId === card.id));
    const attributes = ownership
      ? `draggable="${!listed}" data-market-drag-ownership="${player.id}"`
      : `draggable="${!listed}" data-market-drag-card="${card.id}"`;
    return `<div class="s4-market-warehouse-card ${listed ? "listed" : ""}">${s4PlayerCardMarkup(player, { card, compact:true, attributes })}${listed ? `<span>已挂牌</span>` : ""}</div>`;
  }).join("") : `<p class="s4-market-empty">当前筛选条件下没有可挂牌资产。</p>`;
  return `<section class="s4-market-shell"><header><button type="button" class="button secondary" data-market-section="back">返回市场选择</button><div><small>${ownership ? "PLAYER OWNERSHIP" : "LEGEND / ENHANCED CARDS"}</small><h2>${ownership ? "球员所有权市场" : "传奇 / 强化单卡市场"}</h2></div><b>${league.wallet.balance} 金币</b></header><div class="s4-market-columns"><section class="s4-market-board" data-market-drop-zone="${ownership ? "ownership" : "card"}"><header><div><small>MARKET LISTINGS</small><h3>市场挂牌</h3></div><span>拖动右侧卡片到这里挂牌</span></header>${marketFilterMarkup("listing", leagueMarketListingSearch, leagueMarketListingPosition)}<div class="s4-market-card-grid">${listingCards}</div></section><aside class="s4-market-warehouse"><header><div><small>MY CARD WAREHOUSE</small><h3>${ownership ? "我的球员所有权" : "我的可交易单卡"}</h3></div><span>成交收取5%手续费</span></header>${marketFilterMarkup("warehouse", leagueMarketWarehouseSearch, leagueMarketWarehousePosition, !ownership)}<div class="s4-market-card-grid">${warehouseCards}</div></aside></div></section>`;
}

function leagueInboxMarkup() {
  const messages = league.inbox ?? [];
  if (!messages.length) return `<section class="league-panel league-inbox-empty"><h2>收件箱暂无消息</h2><p>比赛周战报、球队日报、伤停和奖励通知会发送到这里。</p></section>`;
  if (!messages.some((message) => message.id === leagueInboxMessageId)) leagueInboxMessageId = null;
  const selected = messages.find((message) => message.id === leagueInboxMessageId) ?? null;
  const typeLabels = { "daily-report":"球队日报", matchweek:"比赛周", medical:"队医报告", reward:"阶段奖励", transfer:"转会消息", "trade-result":"交易结果", "trade-public":"重要转会", lineup:"阵容轮换", notice:"联赛通知", friendly:"友谊赛", "friendly-invite":"友谊赛邀请" };
  const list = messages.map((message) => {
    const time = new Date(message.createdAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
    return `<button type="button" class="league-mail-item ${message.id === selected?.id ? "active" : ""} ${message.readAt ? "read" : "unread"}" data-league-inbox-message="${escapeHtml(message.id)}"><span>${escapeHtml(typeLabels[message.type] ?? "联赛通知")}<time>${time}</time></span><b>${escapeHtml(message.title)}</b><small>${escapeHtml(message.summary)}</small></button>`;
  }).join("");
  const reader = selected ? leagueInboxDetailMarkup(selected) : `<div class="league-mail-placeholder"><b>选择一封邮件</b><p>点击左侧邮件后会标记为已读并显示完整内容。</p></div>`;
  const readCount = messages.filter((message) => message.readAt).length;
  return `<div class="league-inbox"><aside class="league-mail-list"><header><div><small>CLUB INBOX</small><h2>收件箱</h2></div><b>${messages.length}</b></header><nav class="league-mail-batch-actions"><button type="button" class="button secondary" data-league-inbox-delete-batch="read" ${readCount ? "" : "disabled"}>删除已读</button><button type="button" class="button secondary danger" data-league-inbox-delete-batch="all">清空可删除邮件</button></nav><div>${list}</div></aside><main class="league-mail-reader">${reader}</main></div>`;
}

function tradeOfferCardsMarkup(entries = []) {
  return entries.map((entry) => {
    const player = entry.player;
    const card = entry.card;
    const roles = [player.role, player.secondaryRole].filter(Boolean).map((role) => ROLE_LABELS[role] ?? role).join(" / ");
    const traits = [...(card.traits ?? [])];
    const traitMarkup = traits.length
      ? `<div class="trade-offer-card-traits">${traits.map((trait) => `<span class="${trait.legend ? "legend" : ""}"><b>${escapeHtml(trait.name)}</b><small>${escapeHtml(trait.summary ?? "强化获得的YDL特性")}</small></span>`).join("")}</div>`
      : `<div class="trade-offer-card-traits empty">无特性</div>`;
    return `<li class="trade-offer-card-detail"><header><i class="grade-${String(player.grade).toLowerCase()}">${escapeHtml(player.grade)}</i><span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.club ?? "无俱乐部")} · ${escapeHtml(player.nationality ?? "无国家队")}</small></span><strong>+${card.upgradeLevel}</strong></header><dl><div><dt>默认能力</dt><dd>${player.overall}</dd></div><div><dt>位置</dt><dd>${escapeHtml(roles)}</dd></div><div><dt>评级</dt><dd>${escapeHtml(player.grade)}</dd></div><div><dt>特性</dt><dd>${traits.length}项</dd></div></dl>${traitMarkup}</li>`;
  }).join("");
}

function leagueInboxDetailMarkup(message) {
  const sentAt = new Date(message.createdAt).toLocaleString("zh-CN", { year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
  const pendingTradeOffer = message.type === "trade-offer" && (league.cardTradeOffers ?? []).some((offer) => offer.id === message.payload?.tradeOfferId && offer.status === "pending");
  const friendlyInvitation = message.type === "friendly-invite" ? (league.friendlyInvitations ?? []).find((item) => item.id === message.payload?.friendlyInvitationId) : null;
  const pendingFriendlyInvitation = friendlyInvitation?.status === "pending";
  const header = `<header><div><small>${escapeHtml(sentAt)}</small><h2>${escapeHtml(message.title)}</h2><p>${escapeHtml(message.summary)}</p></div><div class="league-mail-actions">${message.matchId ? `<button type="button" class="button secondary" data-league-match-detail="${message.matchId}">查看比赛</button>` : ""}${pendingTradeOffer || pendingFriendlyInvitation ? "" : `<button type="button" class="button secondary danger" data-league-inbox-delete="${escapeHtml(message.id)}">删除邮件</button>`}</div></header>`;
  if (message.type === "daily-report" && message.report) return `${header}${leagueDailyReportMarkup(message.report)}`;
  if (message.type === "trade-offer") {
    const offer = (league.cardTradeOffers ?? []).find((entry) => entry.id === message.payload?.tradeOfferId);
    if (!offer) return `${header}<div class="league-mail-body"><p>该交易报价已经不存在。</p></div>`;
    const statusLabels = { pending:"等待你处理", rejected:"已拒绝", accepted:"交易成功", withdrawn:"发起方已撤回", failed:"交易失败" };
    return `${header}<div class="league-mail-body trade-offer-mail"><p>${escapeHtml(message.body)}</p><div class="trade-offer-mail-grid"><section><h3>对方提供</h3><ul>${tradeOfferCardsMarkup(offer.offeredCards)}</ul>${offer.coinAmount ? `<strong>附带 ${offer.coinAmount} 金币</strong>` : ""}</section><section><h3>对方希望获得</h3><ul>${tradeOfferCardsMarkup(offer.requestedCards)}</ul></section></div><footer><b>${statusLabels[offer.status] ?? offer.status}</b>${offer.status === "pending" && offer.toOwnerId === account.profile.id ? `<div><button type="button" class="button secondary danger" data-card-trade-respond="reject" data-card-trade-offer="${offer.id}">拒绝</button><button type="button" class="button primary" data-card-trade-respond="accept" data-card-trade-offer="${offer.id}">接受交易</button></div>` : ""}</footer></div>`;
  }
  if (message.type === "trade-public" || message.type === "trade-result") {
    const offer = message.payload?.tradeOffer;
    if (!offer) return `${header}<div class="league-mail-body"><p>该转会公示缺少交易快照。</p></div>`;
    return `${header}<div class="league-mail-body trade-offer-mail trade-public-mail"><p>${escapeHtml(message.body)}</p><section class="trade-public-parties"><div><small>交易发起方</small><b>${escapeHtml(offer.fromOwnerName)}</b><span>${escapeHtml(offer.fromTeamName)}</span></div><strong>完成交易</strong><div><small>交易接收方</small><b>${escapeHtml(offer.toOwnerName)}</b><span>${escapeHtml(offer.toTeamName)}</span></div></section><div class="trade-offer-mail-grid"><section><h3>${escapeHtml(offer.fromOwnerName)} 转出</h3><ul>${tradeOfferCardsMarkup(offer.offeredCards)}</ul>${offer.coinAmount ? `<strong>另付 ${Number(offer.coinAmount).toLocaleString("zh-CN")} 金币</strong>` : ""}</section><section><h3>${escapeHtml(offer.toOwnerName)} 转出</h3><ul>${tradeOfferCardsMarkup(offer.requestedCards)}</ul></section></div><footer><b>${message.type === "trade-public" ? "交易已完成 · 全服公示" : "交易已完成 · 双方结果通知"}</b></footer></div>`;
  }
  if (message.type === "friendly-invite") {
    const labels = { pending:"等待你处理", accepted:"已接受并排期", rejected:"已拒绝" };
    return `${header}<div class="league-mail-body friendly-invite-mail"><p>${escapeHtml(message.body)}</p><section><small>友谊赛邀请</small><h3>${escapeHtml(friendlyInvitation?.fromTeamName ?? "对方球队")} vs ${escapeHtml(friendlyInvitation?.toTeamName ?? league.ownTeam.name)}</h3><span>默认100体力 · 不消耗体力 · 红黄牌不计入正式赛事 · 伤病正常生效</span></section><footer><b>${labels[friendlyInvitation?.status] ?? "邀请已失效"}</b>${pendingFriendlyInvitation ? `<div><button type="button" class="button secondary danger" data-friendly-respond="reject" data-friendly-invitation="${friendlyInvitation.id}">拒绝</button><button type="button" class="button primary" data-friendly-respond="accept" data-friendly-invitation="${friendlyInvitation.id}">接受邀请</button></div>` : ""}</footer></div>`;
  }
  if (message.type === "matchweek") {
    const payload = message.payload ?? {};
    const results = (payload.results ?? []).map((match) => leagueMatchRow(match, league.ownTeam.id)).join("");
    const alerts = [...(payload.injured ?? []).map((player) => `${escapeHtml(player.name)}伤缺${player.rounds}轮`), ...(payload.suspended ?? []).map((player) => `${escapeHtml(player.name)}停赛${player.rounds}轮`)];
    const next = payload.next ? `<section class="mail-next-match"><small>${escapeHtml(payload.next.competitionName ?? "黄狗联赛")} · ${escapeHtml(payload.next.label ?? `第${payload.next.round}轮`)}</small><b>${escapeHtml(payload.next.name)}</b><span>${weatherIcon(payload.next.weather)} ${escapeHtml(payload.next.weather.name)} · 裁判 ${escapeHtml(payload.next.referee.name)}</span></section>` : "";
    return `${header}<div class="league-mail-body"><p>${escapeHtml(message.body)}</p><div class="mail-kpis"><span><small>当前排名</small><b>${payload.rank ?? "-"}</b></span><span><small>联赛积分</small><b>${payload.points ?? "-"}</b></span><span><small>阵容提醒</small><b>${alerts.length}</b></span></div>${next}${alerts.length ? `<section class="mail-alert"><b>阵容可用性</b><p>${alerts.join("；")}</p></section>` : ""}<section class="mail-round-results"><h3>本轮全部赛果</h3>${results}</section></div>`;
  }
  return `${header}<div class="league-mail-body"><p>${escapeHtml(message.body)}</p>${message.type === "reward" && (message.payload?.offerId || message.payload?.offerIds?.length) ? `<button type="button" class="button primary" data-league-tab="backpack">前往背包查看卡包</button>` : ""}</div>`;
}

function leagueShopMarkup() {
  const rosterSlotsUsed = league.ownTeam.s4Assets?.rosterSlotsUsed ?? league.ownTeam.roster.length;
  const packs = league.shop.catalog.map((pack) => {
    const limited = pack.seasonPurchaseLimit != null;
    const soldOut = limited && pack.remainingQuantity < 1;
    const limitText = limited ? `<small class="league-pack-limit">赛季限购 ${pack.purchasedQuantity}/${pack.seasonPurchaseLimit}</small>` : "";
    return `<article class="league-pack-product tone-${pack.kind} ${soldOut ? "sold-out" : ""}">${s4PackVisualMarkup(pack, { className:"league-shop-pack-visual", state:soldOut ? "已购完" : limited ? "限购1份" : "" })}<div class="league-pack-product-copy"><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.description)}</p><strong>${pack.price}<small>金币</small></strong>${limitText}</div><div class="league-pack-purchase"><label for="s4-pack-quantity-${pack.id}">购买数量</label><input type="number" min="1" max="${limited ? 1 : league.shop.maxPurchaseQuantity}" value="1" id="s4-pack-quantity-${pack.id}" aria-label="购买数量" ${limited ? "disabled" : ""}><button class="button primary" type="button" data-s4-pack-buy="${pack.id}" ${soldOut || league.wallet.balance < pack.price ? "disabled" : ""}>${soldOut ? "本赛季已购买" : "购买"}</button></div></article>`;
  }).join("");
  return `<section class="league-panel league-shop"><header><div><small>S4 PLAYER PACKS</small><h2>S4礼包商店</h2></div><b>${league.wallet.balance} 金币</b></header><div class="league-shop-intro"><div><strong>新赛季卡包</strong><span>购买的卡包会统一进入球队背包，支持单份或批量购买。</span></div><span>名单额度 ${rosterSlotsUsed}/33</span></div><div class="league-pack-product-grid">${packs}</div></section>`;
}

function renderLeague() {
  clearInterval(leagueScheduleClockTimer);
  leagueScheduleClockTimer = null;
  leagueMode = true;
  updateChrome();
  if (league.draft) app.innerHTML = leagueDraftMarkup();
  else if (!league.ownTeam) app.innerHTML = leagueJoinMarkup();
  else {
    const content = leagueTab === "cup" ? leagueCupOverviewMarkup() : leagueTab === "schedule" ? leagueScheduleMarkup() : leagueTab === "squad" ? leagueSquadMarkup() : leagueTab === "inbox" ? leagueInboxMarkup() : leagueTab === "backpack" ? leagueBackpackMarkup() : leagueTab === "enhancement" ? leagueEnhancementMarkup() : leagueTab === "television" ? broadcastListMarkup(true) : leagueTab === "stats" ? leagueStatsMarkup() : leagueTab === "players" ? leaguePlayerInfoMarkup() : leagueTab === "market" ? leagueMarketMarkup() : leagueTab === "shop" ? leagueShopMarkup() : leagueOverviewMarkup();
    const rosterSlotsUsed = league.ownTeam.s4Assets?.rosterSlotsUsed ?? league.ownTeam.roster.length;
    const rosterLimit = league.ownTeam.s4Assets?.rosterLimit ?? 33;
    const resourceMarkup = `<div class="league-club-resources"><span><small>大名单</small><b>${rosterSlotsUsed}<i>/</i>${rosterLimit}</b></span><span class="league-wallet-balance"><small>球队金币</small><b>${Number(league.wallet.balance).toLocaleString("zh-CN")}</b></span></div>`;
    app.innerHTML = `<section class="league-shell"><header class="league-top"><div><p class="eyebrow">${escapeHtml(league.season.name)} · ROUND ${league.season.currentRound}/${league.season.totalRounds}</p><h1>YellowDogs League</h1></div>${resourceMarkup}<div class="league-team-mark"><small>${escapeHtml(account.profile.nickname)}</small><div class="league-team-name-row"><b>${escapeHtml(league.ownTeam.name)}</b><button type="button" class="league-team-name-edit" data-league-team-name-edit aria-label="修改球队名称" title="修改球队名称">&#9998;</button></div></div></header><div class="league-main-layout"><nav class="league-nav"><button class="${leagueTab === "overview" ? "active" : ""}" data-league-tab="overview">联赛总览</button><button class="${leagueTab === "cup" ? "active" : ""}" data-league-tab="cup">杯赛总览</button><button class="${leagueTab === "schedule" ? "active" : ""}" data-league-tab="schedule">日程表</button><button class="${leagueTab === "squad" ? "active" : ""}" data-league-tab="squad">阵容战术</button><button class="${leagueTab === "inbox" ? "active" : ""}" data-league-tab="inbox">收件箱${league.inboxUnreadCount ? `<span>${league.inboxUnreadCount}</span>` : ""}</button><button class="${leagueTab === "backpack" ? "active" : ""}" data-league-tab="backpack">背包</button><button class="${leagueTab === "enhancement" ? "active" : ""}" data-league-tab="enhancement">球员强化</button><button class="${leagueTab === "players" ? "active" : ""}" data-league-tab="players">球员信息</button><button class="${leagueTab === "television" ? "active" : ""}" data-league-tab="television">电视台</button><button class="${leagueTab === "stats" ? "active" : ""}" data-league-tab="stats">数据榜单</button><button class="${leagueTab === "shop" ? "active" : ""}" data-league-tab="shop">球员商店</button><button class="${leagueTab === "market" ? "active" : ""}" data-league-tab="market">交易市场</button></nav><main class="league-page-content">${content}</main></div></section>`;
    if (leagueTab === "squad") bindLeagueSquad();
    if (leagueTab === "television") refreshBroadcasts();
    if (leagueTab === "schedule") {
      leagueScheduleClockOffset = Number(league.serverTime ?? Date.now()) - Date.now();
      updateLeagueScheduleClock();
      leagueScheduleClockTimer = setInterval(updateLeagueScheduleClock, 1000);
    }
  }
}

function closeLeagueDialog() {
  document.querySelector("#league-dialog-overlay")?.remove();
}

function openLeagueDialog(content, className = "") {
  closeLeagueDialog();
  document.body.insertAdjacentHTML("beforeend", `<div class="league-dialog-overlay" id="league-dialog-overlay"><section class="league-dialog ${className}">${content}</section></div>`);
  const overlay = document.querySelector("#league-dialog-overlay");
  overlay.addEventListener("click", (event) => { if (event.target === overlay || event.target.closest("[data-close-league-dialog]")) closeLeagueDialog(); });
  return overlay;
}

function openLeagueConfirm({ title, text, confirmText = "确认", onConfirm }) {
  const overlay = openLeagueDialog(`<header><div><small>YELLOWDOGS LEAGUE</small><h2>${escapeHtml(title)}</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="league-confirm-body"><p>${escapeHtml(text)}</p><div><button class="button secondary" data-close-league-dialog>取消</button><button class="button primary" data-confirm-league-action>${escapeHtml(confirmText)}</button></div></div>`, "league-confirm-dialog");
  overlay.querySelector("[data-confirm-league-action]").onclick = async (event) => {
    event.currentTarget.disabled = true;
    try { await onConfirm(); closeLeagueDialog(); }
    catch (error) { event.currentTarget.disabled = false; showToast(error.message); }
  };
}

function openLeagueTeamNameEditor() {
  const overlay = openLeagueDialog(`<header><div><small>CLUB SETTINGS</small><h2>修改球队名称</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><form class="league-team-name-dialog" id="league-team-name-form"><label class="field"><span>球队名称</span><input name="teamName" maxlength="30" value="${escapeHtml(league.ownTeam.name)}" required autofocus></label><div><button type="button" class="button secondary" data-close-league-dialog>取消</button><button type="submit" class="button primary">保存名称</button></div></form>`, "league-team-name-dialog");
  overlay.querySelector("input[name=teamName]")?.select();
}

async function openLeagueMatch(matchId) {
  const overlay = openLeagueDialog(`<header><div><small>LEAGUE MATCH</small><h2>正在读取比赛详情…</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header>`, "league-match-dialog");
  try {
    const value = await api("/api/versus/league/match/detail", { method:"POST", body:leagueIdentity({ matchId }) });
    value.match.hideStrategies = true;
    const dialog = overlay.querySelector(".league-dialog");
    if (dialog) dialog.innerHTML = historyMatchMarkup(value.match).replaceAll("data-close-history", "data-close-league-dialog");
  } catch (error) { closeLeagueDialog(); showToast(error.message); }
}

function leaguePublicPitch(team) {
  const magnets = team.starters.map((player) => {
    const publicPlayer = { ...player, state:{ fitness:100, suspension:0, injuryRounds:0 } };
    const tooltip = leaguePlayerTooltip(publicPlayer, player.role);
    const upgrade = Number(player.upgradeLevel ?? 0);
    return `<button type="button" class="magnet league-squad-magnet league-public-magnet grade-${player.grade.toLowerCase()} fit-primary" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}" style="left:${player.position.x}%;top:${player.position.y}%"><span class="league-magnet-role">${ROLE_LABELS[player.role] ?? player.role}</span><b>${escapeHtml(player.name)}</b><i>${player.overall}</i><span class="league-magnet-fitness" aria-label="体力 100"><span style="width:100%"></span></span>${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}</button>`;
  }).join("");
  return pitchMarkup(magnets, "", "league-public-pitch s4-readonly-pitch");
}

function openBackpackSingleRecoveryConfirm() {
  const entries = (league.ownTeam?.roster ?? []).flatMap((player) => (player.cards ?? []).filter((card) => leagueBackpackSelectedCardIds.has(card.id)).map((card) => ({ player, card })));
  if (!entries.length) return showToast("请先选择需要回收的球员卡");
  const amount = entries.reduce((sum, { card }) => sum + Number(card.systemRecoveryValue ?? 0), 0);
  const rows = entries.map(({ player, card }) => `<li><span><b>${escapeHtml(player.name)} +${card.upgradeLevel}</b><small>${escapeHtml(player.club)} · ${escapeHtml(ROLE_LABELS[player.role] ?? player.role)}</small></span><strong>${card.systemRecoveryValue}金币</strong></li>`).join("");
  const overlay = openLeagueDialog(`<header><div><small>SINGLE CARD RECOVERY</small><h2>确认回收 ${entries.length} 张球员卡</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="backpack-recovery-confirm"><p>确认后这些卡片会永久由系统回收，无法恢复。</p><ul>${rows}</ul><div class="backpack-recovery-total"><span>预计获得</span><b>${amount} 金币</b></div><footer><button type="button" class="button secondary" data-close-league-dialog>取消</button><button type="button" class="button primary" data-confirm-card-recovery>确认单卡回收</button></footer></div>`, "backpack-recovery-dialog");
  overlay.querySelector("[data-confirm-card-recovery]").onclick = async (event) => {
    event.currentTarget.disabled = true;
    try {
      const value = await leagueRequest("/cards/release", { cardIds:entries.map(({ card }) => card.id) });
      leagueBackpackSelectedCardIds.clear();
      leagueBackpackRecoveryMode = null;
      closeLeagueDialog();
      renderLeague();
      showToast(`已回收${value.cardRecoveryResult?.cardCount ?? entries.length}张卡，获得${value.cardRecoveryResult?.amount ?? amount}金币`);
    } catch (error) { event.currentTarget.disabled = false; showToast(error.message); }
  };
}

function openBackpackOwnershipRecoveryConfirm() {
  const player = (league.ownTeam?.roster ?? []).find((entry) => entry.id === leagueBackpackSelectedOwnershipId && entry.ownsRights && entry.grade !== "S");
  if (!player?.ownershipReturnPreview) return showToast("请先选择需要回收的球员所有权");
  const preview = player.ownershipReturnPreview;
  const retainedText = preview.retainedCardCount ? `保留${preview.retainedCardCount}张最高等级 +${preview.retainedUpgradeLevel} ${player.name}` : "没有强化卡，不保留+0基础卡";
  const overlay = openLeagueDialog(`<header><div><small>OWNERSHIP RECOVERY</small><h2>确认回收 ${escapeHtml(player.name)} 所有权</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="backpack-recovery-confirm"><p>所有权返还系统后，该球员会移出你的私有池，无法再从私有池卡包获得同名卡。</p><dl><div><dt>保留球员卡</dt><dd>${escapeHtml(retainedText)}</dd></div><div><dt>系统回收卡片</dt><dd>${preview.recoveredCardCount} 张</dd></div><div><dt>卡片回收补偿</dt><dd>${preview.recoveryAmount} 金币</dd></div><div><dt>所有权回收补偿</dt><dd>${preview.ownershipAmount} 金币</dd></div></dl><div class="backpack-recovery-total"><span>预计共获得</span><b>${preview.totalAmount} 金币</b></div><footer><button type="button" class="button secondary" data-close-league-dialog>取消</button><button type="button" class="button primary" data-confirm-ownership-recovery>确认所有权回收</button></footer></div>`, "backpack-recovery-dialog");
  overlay.querySelector("[data-confirm-ownership-recovery]").onclick = async (event) => {
    event.currentTarget.disabled = true;
    try {
      await leagueRequest("/ownership/return", { leaguePlayerId:player.id });
      leagueBackpackSelectedOwnershipId = null;
      leagueBackpackRecoveryMode = null;
      closeLeagueDialog();
      renderLeague();
      showToast(`已回收${player.name}所有权，获得${preview.totalAmount}金币`);
    } catch (error) { event.currentTarget.disabled = false; showToast(error.message); }
  };
}

function openMarketListingDialog(kind, assetId) {
  const ownership = kind === "ownership";
  const player = ownership
    ? league.ownTeam.roster.find((entry) => entry.id === assetId)
    : league.ownTeam.roster.find((entry) => entry.cards.some((card) => card.id === assetId));
  const card = ownership ? null : player?.cards.find((entry) => entry.id === assetId);
  if (!player || (!ownership && !card)) return;
  const levels = player.cards.map((entry) => Number(entry.upgradeLevel ?? 0));
  const highestLevel = Math.max(...levels);
  const highestCount = highestLevel > 0 ? levels.filter((level) => level === highestLevel).length : 0;
  const recycledCount = levels.length - highestCount;
  const warning = ownership
    ? `<div class="s4-market-sale-warning"><b>所有权成交规则</b><p>${highestCount ? `如果出售成功，你将保留 ${escapeHtml(player.name)} 最高等级的 ${highestCount} 张 +${highestLevel} 强化卡，其余 ${recycledCount} 张球员卡将被系统回收` : `你没有强化过的 ${escapeHtml(player.name)} 球员卡；出售成功后，现有 ${recycledCount} 张 +0 基础卡将被系统回收，不会保留` }；该球员所有权及私有池归属会转移给买家。</p></div>`
    : "";
  const minimumPrice = ownership ? player.minimumPrice : Number(card.minimumListingPrice ?? player.minimumPrice);
  const title = ownership ? `挂牌 ${player.name} 的所有权` : `挂牌 ${player.name} +${card.upgradeLevel ?? 0}`;
  const overlay = openLeagueDialog(`<header><div><small>S4 TRANSFER MARKET</small><h2>${escapeHtml(title)}</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><form id="market-listing-form" class="s4-market-sale-form" data-market-kind="${kind}" data-market-asset="${escapeHtml(assetId)}">${warning}<label><span>挂牌金币价格</span><input name="price" type="number" min="${minimumPrice}" value="${minimumPrice}" required><small>最低挂牌价 ${minimumPrice} 金币，成交后收取 5% 手续费。</small></label><footer><button type="button" class="button secondary" data-close-league-dialog>取消</button><button type="submit" class="button primary">确认挂牌</button></footer></form>`, "s4-market-sale-dialog");
  const form = overlay.querySelector("#market-listing-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const action = ownership ? "/market/list-ownership" : "/market/list-card";
    const body = ownership
      ? { leaguePlayerId:assetId, price:data.get("price") }
      : { cardId:assetId, price:data.get("price") };
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    leagueTab = "market";
    leagueMarketSection = kind;
    try {
      await leagueRequest(action, body);
      leagueTab = "market";
      leagueMarketSection = kind;
      closeLeagueDialog();
      renderLeague();
      showToast(ownership ? "球员所有权已挂牌" : "球员卡已挂牌");
    } catch (error) {
      submit.disabled = false;
      showToast(error.message);
    }
  });
  form.querySelector('[name="price"]')?.select();
}

async function openLeagueTeam(teamId) {
  const overlay = openLeagueDialog(`<header><div><small>CLUB PROFILE</small><h2>正在读取球队资料…</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header>`, "league-team-dialog");
  try {
    const value = await api("/api/versus/league/team/detail", { method:"POST", body:leagueIdentity({ teamId }) });
    const team = value.team;
    const history = team.history.length ? team.history.map((match) => leagueMatchRow(match, team.id)).join("") : `<p class="league-empty">还没有比赛记录。</p>`;
    const friendlyAction = team.canInviteFriendly ? `<button type="button" class="button primary league-friendly-invite" data-friendly-invite="${escapeHtml(team.id)}">发起友谊赛</button>` : "";
    overlay.querySelector(".league-dialog").innerHTML = `<header><div><small>${team.isAi ? "AI CLUB" : "PLAYER CLUB"}</small><h2>${escapeHtml(team.name)}</h2><p>${escapeHtml(team.formation ?? "阵型待定")} · ${team.table.won}胜 ${team.table.drawn}平 ${team.table.lost}负</p></div><div class="league-team-detail-actions">${friendlyAction}<button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></div></header><div class="league-team-detail-grid"><section><h3>当前阵型</h3>${leaguePublicPitch(team)}</section><section><h3>现有球员名单 · ${team.roster.length}人</h3><div class="league-public-roster">${team.roster.map((player) => `<div><span class="grade grade-${player.grade}">${player.grade}</span><b>${escapeHtml(player.name)}<small>${ROLE_LABELS[player.role] ?? player.role}${player.upgradeLevel ? ` · +${player.upgradeLevel}` : ""}</small></b><strong>${player.overall}</strong></div>`).join("")}</div></section></div><section class="league-team-history"><h3>历史战绩</h3>${history}</section>`;
    overlay.querySelector("[data-friendly-invite]")?.addEventListener("click", () => openLeagueConfirm({ title:"发起友谊赛", text:`向 ${team.ownerName ?? team.name} 发出友谊赛邀请？对方接受后系统会自动安排最近场次。`, confirmText:"发送邀请", onConfirm:() => leagueRequest("/friendlies/invite", { targetTeamId:team.id }).then(() => { closeLeagueDialog(); showToast("友谊赛邀请已发送"); }) }));
    overlay.querySelectorAll("[data-league-match-detail]").forEach((button) => button.onclick = () => openLeagueMatch(button.dataset.leagueMatchDetail));
  } catch (error) { closeLeagueDialog(); showToast(error.message); }
}

async function openLeagueReward(offerId) {
  let offer = league.rewardOffers.find((entry) => entry.id === offerId);
  if (!offer) return;
  if (!offer.players?.length) {
    try {
      await leagueRequest("/reward/open", { offerId });
      offer = league.rewardOffers.find((entry) => entry.id === offerId);
    } catch (error) { showToast(error.message); return; }
  }
  if (!offer?.players?.length) return;
  const overlay = openLeagueDialog(`<header><div><small>ROUND ${offer.round} REWARD</small><h2>${escapeHtml(offer.tier.name)} · ${LINE_LABELS[offer.pool] ?? offer.pool}</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="league-reward-choices s4-player-card-choice-grid">${offer.players.map((player,index) => s4PlayerCardMarkup(player, { animated:true, delay:index * 90, attributes:`data-reward-choose="${player.id}"` })).join("")}</div>`, "league-reward-dialog");
  overlay.querySelectorAll("[data-reward-choose]").forEach((button) => button.onclick = async () => {
    button.disabled = true;
    try { await leagueRequest("/reward/choose", { offerId, leaguePlayerId:button.dataset.rewardChoose }); closeLeagueDialog(); showToast("奖励球员已加入球队"); }
    catch (error) { button.disabled = false; showToast(error.message); }
  });
}

async function createDeveloperRoom(quickStart) {
  try {
    const value = await api("/api/versus/dev-room", { method:"POST", body:{ name:account?.profile?.nickname ?? "开发者",quickStart } });
    storeSession({ code:value.room.code, token:value.token });
    room = value.room;
    localPositions = null;
    localStartingIds = null;
    localTactic = "balanced";
    localStyle = "possession";
    localAttackFocus = "balanced";
    localDefenseFocus = "balanced";
    lineupSeedInput = "";
    exportedLineupCode = "";
    render();
    startPolling();
  } catch (error) { showToast(error.message); }
}

async function createRoom(competitionMode = "quick") {
  try {
    const identity = await bindIdentity();
    const value = await api("/api/versus/rooms", { method:"POST", body:{ ...identity, customCode:document.querySelector("#custom-room-code").value, competitionMode } });
    storeSession({ code:value.room.code, token:value.token, playerId:identity.playerId });
    room = value.room;
    localStartingIds = null;
    lineupSeedInput = "";
    exportedLineupCode = "";
    render();
    startPolling();
  } catch (error) { showToast(error.message); }
}

async function joinRoom() {
  try {
    const identity = await bindIdentity();
    const value = await api("/api/versus/join", { method:"POST", body:{ code:document.querySelector("#room-code").value, ...identity } });
    storeSession({ code:value.room.code, token:value.token, playerId:identity.playerId });
    room = value.room;
    localStartingIds = null;
    lineupSeedInput = "";
    exportedLineupCode = "";
    render();
    startPolling();
  } catch (error) { showToast(error.message); }
}

function renderWaiting() {
  if (room.profile && account) storeAccount({ ...account, profile:room.profile });
  app.innerHTML = `<section class="waiting waiting-with-profile"><div class="waiting-box"><h1>等待好友加入</h1><div class="room-code">${escapeHtml(room.code)}</div><button class="button primary" id="copy-code">复制邀请</button><div class="connection-note"><i></i><span>连接正常</span></div></div>${profileMarkup(room.profile)}</section>`;
  document.querySelector(".account-history")?.insertAdjacentHTML("afterend", broadcastListMarkup());
  refreshBroadcasts();
  document.querySelector("#copy-code").onclick = async () => { await navigator.clipboard?.writeText(`${location.origin}/versus/\n分享码：${room.code}`); showToast("地址和分享码已复制"); };
}

function playerStats(player) {
  const keys = player.pool === "GK" ? ["goalkeeping","reflexes","passing","composure"] : player.pool === "DEF" ? ["tackling","pace","stamina","passing"] : player.pool === "MID" ? ["passing","dribbling","stamina","tackling"] : ["finishing","pace","dribbling","composure"];
  return keys.map((key) => `<span>${STAT_LABELS[key] ?? key}<b>${player.attributes[key]}</b></span>`).join("");
}

function playerCard(player) {
  const identity = [player.nationality, player.club].filter((value) => value && !value.startsWith("未登记")).map(escapeHtml).join(" · ");
  const signature = player.signature ? `<small class="player-signature">${escapeHtml(player.signature)}</small>` : "";
  return `<button class="player-card grade-${player.grade.toLowerCase()}" data-player-choice="${player.id}" data-rating="${player.overall}"><div class="card-top"><span class="rating">${player.overall}</span><span class="position">${player.grade} · ${ROLE_LABELS[player.role]}</span></div><h3>${escapeHtml(player.name)}</h3>${signature}<p>${identity || `副位置 ${ROLE_LABELS[player.secondaryRole] ?? "无"}`} · ${Math.round(player.heightCm)}cm</p><div class="stat-row">${playerStats(player)}</div><span class="card-action">选择球员</span></button>`;
}

function rosterList(player) {
  if (!player.roster.length) return `<div class="roster-empty">尚未签下球员<br />从左侧四个位置池开始选秀</div>`;
  return player.roster.map((entry) => `<div class="roster-item"><span>${entry.grade}</span><div><b>${escapeHtml(entry.name)}</b><small>${ROLE_LABELS[entry.role]} / ${ROLE_LABELS[entry.secondaryRole] ?? "无副位置"} · ${entry.traits.map((trait) => escapeHtml(trait.name)).join(" / ")}</small></div><strong>${entry.overall}</strong></div>`).join("");
}

function draftBoardPositions(roster) {
  const lines = { GK:[], DEF:[], MID:[], ATT:[] };
  roster.forEach((player) => lines[player.pool].push(player));
  const positions = {};
  Object.entries({ GK:88, DEF:68, MID:45, ATT:18 }).forEach(([pool,y]) => {
    lines[pool].forEach((player,index) => {
      positions[player.id] = { x:Math.round(((index + 1) / (lines[pool].length + 1)) * 76 + 12), y };
    });
  });
  return positions;
}

function pitchMarkup(content, id = "", extraClass = "") {
  return `<div class="pitch ${extraClass}" ${id ? `id="${id}"` : ""}><div class="pitch-lines"><span class="pitch-halfway"></span><span class="pitch-center-circle"></span><span class="pitch-center-mark"></span><span class="pitch-penalty-box pitch-penalty-box-top"></span><span class="pitch-goal-box pitch-goal-box-top"></span><span class="pitch-penalty-arc pitch-penalty-arc-top"></span><span class="pitch-penalty-mark pitch-penalty-mark-top"></span><span class="pitch-penalty-box pitch-penalty-box-bottom"></span><span class="pitch-goal-box pitch-goal-box-bottom"></span><span class="pitch-penalty-arc pitch-penalty-arc-bottom"></span><span class="pitch-penalty-mark pitch-penalty-mark-bottom"></span></div><span class="zone-label att">前场</span><span class="zone-label mid">中场</span><span class="zone-label def">后场</span><span class="zone-label gk">门将</span>${content}</div>`;
}

function inferAssignedRoles(roster, positions) {
  const entries = roster.map((player) => ({ id:player.id, x:Number(positions[player.id]?.x), y:Number(positions[player.id]?.y) })).filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
  const midfielders = entries.filter((entry) => entry.y >= 27 && entry.y < 59);
  const wideMidfielders = midfielders.filter((entry) => entry.x < 38 || entry.x > 62);
  const midfieldReferenceY = wideMidfielders.length ? wideMidfielders.reduce((sum,entry) => sum + entry.y, 0) / wideMidfielders.length : 46;
  return Object.fromEntries(entries.map((entry) => {
    let role;
    if (entry.y >= 82) role = "GK";
    else if (entry.y >= 66) role = entry.x < 30 ? "LB" : entry.x > 70 ? "RB" : "CB";
    else if (entry.y >= 52 && entry.x < 30) role = "LWB";
    else if (entry.y >= 52 && entry.x > 70) role = "RWB";
    else if (entry.y >= 59) role = "CB";
    else if (entry.y < 27) role = entry.x < 38 ? "LW" : entry.x > 62 ? "RW" : "ST";
    else if (entry.x < 38) role = "LM";
    else if (entry.x > 62) role = "RM";
    else role = entry.y < midfieldReferenceY ? "AM" : "DM";
    return [entry.id, role];
  }));
}

function inferFormationName(roster, positions) {
  const roles = inferAssignedRoles(roster, positions);
  const roleGroup = (role) => role === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(role) ? "DEF" : ["ST", "LW", "RW"].includes(role) ? "ATT" : "MID";
  const counts = { GK:0, DEF:0, MID:0, ATT:0 };
  Object.values(roles).forEach((role) => { counts[roleGroup(role)] += 1; });
  const midfieldY = roster.filter((player) => roleGroup(roles[player.id]) === "MID").map((player) => Number(positions[player.id]?.y)).filter(Number.isFinite).sort((left, right) => left - right);
  const midfieldLines = midfieldY.length ? [1] : [];
  for (let index = 1; index < midfieldY.length; index += 1) {
    if (midfieldY[index] - midfieldY[index - 1] >= 8) midfieldLines.push(1);
    else midfieldLines[midfieldLines.length - 1] += 1;
  }
  return midfieldLines.length > 1
    ? [counts.DEF, ...midfieldLines.reverse(), counts.ATT].join("-")
    : `${counts.DEF}-${counts.MID}-${counts.ATT}`;
}

function positionFit(player, assignedRole) {
  if (assignedRole === player.role) return "primary";
  if (assignedRole === player.secondaryRole) return "secondary";
  if ((assignedRole === "LWB" && [player.role, player.secondaryRole].includes("LB")) || (assignedRole === "RWB" && [player.role, player.secondaryRole].includes("RB"))) return "secondary";
  return "unfamiliar";
}

function playerTooltip(player, assignedRole) {
  const secondary = ROLE_LABELS[player.secondaryRole] ?? "无";
  const traits = playerTraitText(player);
  const identity = [player.nationality, player.club].filter((value) => value && !value.startsWith("未登记")).join(" · ");
  return `${identity ? `${identity}\n` : ""}身高：${Math.round(player.heightCm)}cm\n主位置：${ROLE_LABELS[player.role]}\n副位置：${secondary}\n当前位置：${ROLE_LABELS[assignedRole] ?? assignedRole}\n${traits}`;
}

function boardMagnet(player, position, assignedRole, options = {}) {
  const { draggable = false, live = false } = options;
  const fit = positionFit(player, assignedRole);
  const dataAttribute = draggable ? `data-magnet="${player.id}"` : "";
  return `<button class="magnet grade-${player.grade.toLowerCase()} fit-${fit} ${live ? "live-magnet" : ""}" ${dataAttribute} data-traits="${escapeHtml(playerTooltip(player, assignedRole))}" title="${escapeHtml(playerTooltip(player, assignedRole))}" style="left:${position.x}%;top:${position.y}%"><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[assignedRole] ?? assignedRole}</small><i>${player.overall}</i></button>`;
}

function benchMagnet(player, interactive = true) {
  const role = ROLE_LABELS[player.role] ?? player.role;
  const tag = interactive ? "button" : "span";
  const attributes = interactive ? `type="button" data-bench-magnet="${player.id}" title="拖到场上球员磁贴进行替换"` : "";
  return `<${tag} class="magnet bench-magnet ${interactive ? "" : "bench-magnet-static"} grade-${player.grade.toLowerCase()} fit-primary" ${attributes}><b>${escapeHtml(player.name)}</b><small>${role}</small><i>${player.overall}</i></${tag}>`;
}

function renderDraft() {
  const own = ownPlayer();
  const offer = room.offer;
  const poolOrder = ["ATT", "MID", "DEF", "GK"];
  const reinforcement = room.competitionMode === "tournament" && room.legNumber === 2;
  const pickedThisStage = reinforcement ? own.selectionCount - 11 : own.selectionCount;
  const stageTarget = reinforcement ? 5 : 11;
  const completedPicks = Math.max(0, Math.min(stageTarget, pickedThisStage));
  const displayedPick = Math.min(stageTarget, completedPicks + 1);
  const draftComplete = completedPicks >= stageTarget;
  const stageTitle = reinforcement ? "第二回合补强选秀" : "组建首发";
  let content;
  if (own.importedLineup && !reinforcement) {
    content = `<div class="imported-waiting"><span class="lineup-origin-badge">自带阵容</span><h2>等待对手完成选秀</h2><div class="pulse"></div></div>`;
  } else if (draftComplete) {
    content = `<div class="imported-waiting"><h2>本阶段选秀已完成</h2><p>等待对手完成选择</p><div class="pulse"></div></div>`;
  } else if (!offer) {
    const importPanel = !reinforcement && own.selectionCount === 0 ? `<section class="lineup-import-panel draft-import-compact"><h3>导入阵容</h3><label class="field"><span>11位阵容ID</span><input id="lineup-seed-input" value="${escapeHtml(lineupSeedInput)}" autocomplete="off" spellcheck="false" maxlength="11" placeholder="输入11位阵容ID" aria-label="11位阵容ID" /></label><button class="button seed-button" id="import-lineup">导入并跳过选秀</button></section>` : "";
    content = `<div class="draft-pool-heading"><h2>${reinforcement ? "选择补强位置" : "选择球员池"}</h2><b>${displayedPick} / ${stageTarget}</b></div>${reinforcement ? `<p class="reinforcement-note">原首发已保留。本阶段获得5次选人机会，并保证出现传奇球员。</p>` : ""}<div class="pool-grid draft-pool-stack">${poolOrder.map((key) => { const label = LINE_LABELS[key]; const available = own.draftLines.availablePools.includes(key); const reason = !reinforcement && key === "GK" && own.draftLines.counts.GK >= 1 ? "名额已满" : "暂不可选"; return `<button class="pool-button" data-pool="${key}" ${available ? "" : "disabled"}><b>${label}</b><small>${available ? "抽取三名球员" : reason}</small></button>`; }).join("")}</div><div class="line-counts draft-counts">${Object.entries(own.draftLines.counts).map(([key,count]) => `<span>${LINE_LABELS[key]}<b>${count}</b></span>`).join("")}</div>${importPanel}`;
  } else {
    content = `<div class="draft-pool-heading"><h2>选择一名${LINE_LABELS[offer.pool]}球员</h2><b>${displayedPick} / ${stageTarget}</b></div><div class="choice-grid">${offer.choices.map(playerCard).join("")}</div>`;
  }
  const previewRoster = reinforcement ? own.roster.filter((player) => player.starter) : own.roster;
  const draftPositions = reinforcement ? Object.fromEntries(previewRoster.map((player) => [player.id, player.position])) : draftBoardPositions(previewRoster);
  const draftRoles = inferAssignedRoles(previewRoster, draftPositions);
  const draftMagnets = previewRoster.map((player) => boardMagnet(player, draftPositions[player.id], draftRoles[player.id])).join("");
  const additions = reinforcement ? own.roster.filter((player) => !player.starter).map((player) => benchMagnet(player, false)).join("") : "";
  app.innerHTML = `<section class="phase-head"><div><h1>${stageTitle}</h1>${reinforcement ? `<small>首回合 ${room.firstLegScore[0]}:${room.firstLegScore[1]}</small>` : ""}</div>${phaseTimer("选秀倒计时")}</section>${versusStrip()}<div class="draft-stage-layout"><section class="draft-board-panel"><header><h2>${reinforcement ? "保留首发" : "阵容预览"}</h2><span>${completedPicks} / ${stageTarget}</span></header>${pitchMarkup(draftMagnets)}${reinforcement ? `<div class="reinforcement-bench">${additions || "尚未选择补强球员"}</div>` : ""}</section><div class="draft-side-column"><section class="draft-main">${content}</section></div></div>`;
  document.querySelectorAll("[data-pool]").forEach((button) => button.onclick = () => act("draw-player", { pool:button.dataset.pool }, button));
  document.querySelectorAll("[data-player-choice]").forEach((button) => button.onclick = () => act("choose-player", { playerId:button.dataset.playerChoice }, button));
  const seedInput = document.querySelector("#lineup-seed-input");
  if (seedInput) seedInput.oninput = (event) => { lineupSeedInput = event.target.value; };
  const importButton = document.querySelector("#import-lineup");
  if (importButton) importButton.onclick = importLineup;
}

async function importLineup() {
  const seed = document.querySelector("#lineup-seed-input")?.value.trim() ?? lineupSeedInput.trim();
  if (!seed) return showToast("请输入阵容种子码");
  try {
    const value = await api(`/api/versus/rooms/${session.code}/import-lineup`, { method:"POST", body:{ seed } });
    room = value.room;
    lineupSeedInput = "";
    localPositions = null;
    localStartingIds = null;
    localTactic = ownPlayer()?.tactic ?? "balanced";
    localStyle = ownPlayer()?.style ?? "possession";
    localAttackFocus = ownPlayer()?.attackFocus ?? "balanced";
    localDefenseFocus = ownPlayer()?.defenseFocus ?? "balanced";
    showToast("阵容导入成功，已跳过选秀");
    render();
  } catch (error) { showToast(error.message); }
}

function playerTraitText(player) {
  const effects = [
    player.legendAbility?.summary ? `${player.legendAbility.name}：${player.legendAbility.summary}` : null,
    ...(player.traits ?? []).map((trait) => `${trait.name}：${trait.summary}`),
  ].filter(Boolean);
  return effects.join("\n") || "无特性";
}

async function act(action, body, sourceButton = null) {
  if (actionPending || roomMutationPending) return;
  actionPending = true;
  roomMutationPending = true;
  roomStateEpoch += 1;
  clearTimeout(polling);
  controlInteraction = true;
  if (sourceButton) {
    sourceButton.classList.add("action-pending");
    sourceButton.closest(".choice-grid,.pool-grid")?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  }
  try {
    const value = await api(`/api/versus/rooms/${session.code}/${action}`, { method:"POST", body });
    room = value.room;
    render();
  } catch (error) { showToast(error.message); }
  finally {
    actionPending = false;
    roomMutationPending = false;
    controlInteraction = false;
    if (session) schedulePolling(100);
  }
}

function formationFromPositions(roster, positions, options = {}) {
  const counts = { GK:0, DEF:0, MID:0, ATT:0 };
  const roles = inferAssignedRoles(roster, positions);
  roster.forEach((player) => {
    const role = roles[player.id];
    const group = role === "GK" ? "GK" : ["CB","LB","RB","LWB","RWB"].includes(role) ? "DEF" : ["DM","AM","LM","RM"].includes(role) ? "MID" : "ATT";
    counts[group] += 1;
  });
  const validOutfieldLines = [counts.DEF, counts.MID, counts.ATT].every((count) => count >= 1);
  const valid = roster.length === 11 && counts.GK === 1 && (options.requireOutfieldLines === false || validOutfieldLines);
  const message = counts.GK !== 1
    ? "门将位置必须且只能有一人。"
    : options.requireOutfieldLines !== false && !validOutfieldLines
      ? "后场、中场、前场必须各至少一人。"
      : "阵型有效";
  return { roles, counts, name:`${counts.DEF}-${counts.MID}-${counts.ATT}`, valid, message };
}

function hasMultipleGoalkeepers(positions, playerId, nextPosition) {
  return Object.entries(positions).filter(([id, position]) => (id === playerId ? nextPosition : position)?.y >= 82).length > 1;
}

function focusOptions(selected) {
  return Object.entries(FOCUSES).map(([key, label]) => `<option value="${key}" ${selected === key ? "selected" : ""}>${label}</option>`).join("");
}

function renderTactics() {
  const own = ownPlayer();
  if (!localStartingIds) localStartingIds = own.roster.filter((player) => player.starter !== false).map((player) => player.id).slice(0, 11);
  const startingSet = new Set(localStartingIds);
  const starterRoster = own.roster.filter((player) => startingSet.has(player.id));
  const benchRoster = own.roster.filter((player) => !startingSet.has(player.id));
  if (!localPositions) localPositions = Object.fromEntries(starterRoster.map((player) => [player.id, player.position]));
  localTactic ||= own.tactic;
  localStyle ||= own.style;
  const shape = formationFromPositions(starterRoster, localPositions);
  const magnets = starterRoster.map((player) => boardMagnet(player, localPositions[player.id], shape.roles[player.id], { draggable:true })).join("");
  const benchPanel = benchRoster.length ? `<section class="tournament-bench"><header><b>替补席</b><small>拖动磁贴覆盖场上球员完成替换</small></header><div class="bench-magnet-list">${benchRoster.map((player) => benchMagnet(player)).join("")}</div></section>` : "";
  app.innerHTML = `<section class="phase-head"><div><h1>${room.competitionMode === "tournament" ? `第${room.legNumber}回合战术设置` : "战术设置"}</h1>${room.firstLegScore ? `<small>首回合比分 ${room.firstLegScore[0]}:${room.firstLegScore[1]}</small>` : ""}</div>${phaseTimer("准备倒计时")}</section>${versusStrip()}<div class="tactics-layout"><section class="board-panel">${pitchMarkup(magnets, "tactics-pitch")}${benchPanel}</section><aside class="control-panel"><div class="weather-forecast"><div><b>${escapeHtml(room.weather?.name ?? "待确认")}</b><p>降水 ${room.weather?.precipitation ?? "--"}% · 风力 ${room.weather?.wind ?? "--"}</p></div></div><div class="shape-box"><span><b>${shape.valid ? "阵型有效" : "需要调整"}</b></span><strong>${shape.name}</strong></div><div class="line-counts">${Object.entries(shape.counts).map(([key,count]) => `<span>${LINE_LABELS[key]}<b>${count}</b></span>`).join("")}</div>${shape.valid ? "" : `<p class="valid-note bad">${shape.message}</p>`}<label class="field"><span>比赛思路</span><select id="tactic-select">${Object.entries(TACTICS).map(([key,label]) => `<option value="${key}" ${localTactic === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>比赛战术</span><select id="style-select">${Object.entries(STYLES).map(([key,label]) => `<option value="${key}" ${localStyle === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><div class="direction-fields"><label class="field"><span>主攻方向</span><select id="attack-focus-select">${focusOptions(localAttackFocus)}</select></label><label class="field"><span>主守方向</span><select id="defense-focus-select">${focusOptions(localDefenseFocus)}</select></label></div><button class="button primary wide" id="ready-button" ${shape.valid ? "" : "disabled"}>${own.ready ? "更新并保持准备" : "保存并准备"}</button><div class="ready-list">${room.players.map((player,index) => `<div class="ready-row"><span>${index === room.viewerIndex ? "你" : "好友"} · ${escapeHtml(player.name)}</span><b class="${player.ready ? "ready" : ""}">${player.ready ? "已准备" : "调整中"}</b></div>`).join("")}</div>${room.bothReady ? `<div class="locked-message"><b>双方已准备</b></div>` : ""}</aside></div>`;
  document.querySelector("#tactic-select").onchange = (event) => { localTactic = event.target.value; };
  const weatherPanel = document.querySelector(".weather-forecast");
  if (weatherPanel) {
    const icon = document.createElement("span");
    icon.className = "weather-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = weatherIcon(room.weather);
    weatherPanel.prepend(icon);
    weatherPanel.insertAdjacentHTML("afterend", `<div class="referee-forecast"><span>⚖</span><div><small>本场裁判</small><b>${escapeHtml(room.referee?.name ?? "待确认")}尺度</b><p>${escapeHtml(room.referee?.description ?? "比赛开始前公布判罚尺度。")}</p></div></div>`);
  }
  document.querySelector("#style-select").onchange = (event) => { localStyle = event.target.value; };
  document.querySelector("#attack-focus-select").onchange = (event) => { localAttackFocus = event.target.value; };
  document.querySelector("#defense-focus-select").onchange = (event) => { localDefenseFocus = event.target.value; };
  document.querySelector("#ready-button").onclick = () => persistTactics(true, true);
  bindMagnets();
  bindBenchMagnets();
}

function swapStarter(benchId, starterId) {
  if (!benchId || !starterId) return;
  const index = localStartingIds.indexOf(starterId);
  if (index < 0) return;
  localStartingIds[index] = benchId;
  localPositions[benchId] = { ...(localPositions[starterId] ?? { x:50, y:45 }) };
  delete localPositions[starterId];
  renderTactics();
}

function bindMagnets() {
  const pitch = document.querySelector("#tactics-pitch");
  document.querySelectorAll("[data-magnet]").forEach((magnet) => magnet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const playerId = magnet.dataset.magnet;
    const startPosition = { ...localPositions[playerId] };
    draggingMagnet = true;
    let moved = false;
    magnet.setPointerCapture(event.pointerId);
    magnet.classList.add("dragging");
    const move = (moveEvent) => {
      moved = true;
      const rect = pitch.getBoundingClientRect();
      const x = Math.max(8,Math.min(92,((moveEvent.clientX-rect.left)/rect.width)*100));
      const y = Math.max(6,Math.min(94,((moveEvent.clientY-rect.top)/rect.height)*100));
      localPositions[playerId] = { x:Math.round(x), y:Math.round(y) };
      magnet.style.left = `${x}%`;
      magnet.style.top = `${y}%`;
    };
    const up = () => { magnet.classList.remove("dragging"); magnet.removeEventListener("pointermove",move); magnet.removeEventListener("pointerup",up); draggingMagnet = false; if (moved && hasMultipleGoalkeepers(localPositions, playerId, localPositions[playerId])) { localPositions[playerId] = startPosition; showToast("门将位置最多只能安排一名球员"); return renderTactics(); } if (moved) renderTactics(); };
    magnet.addEventListener("pointermove",move);
    magnet.addEventListener("pointerup",up,{once:true});
  }));
}

function bindBenchMagnets() {
  document.querySelectorAll("[data-bench-magnet]").forEach((magnet) => magnet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || roomMutationPending) return;
    event.preventDefault();
    const benchId = magnet.dataset.benchMagnet;
    const ghost = magnet.cloneNode(true);
    let target = null;
    draggingMagnet = true;
    ghost.removeAttribute("data-bench-magnet");
    ghost.classList.remove("bench-magnet");
    ghost.classList.add("bench-drag-ghost");
    document.body.appendChild(ghost);
    const moveGhost = (pointerEvent) => {
      ghost.style.left = `${pointerEvent.clientX}px`;
      ghost.style.top = `${pointerEvent.clientY}px`;
      const nextTarget = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest("[data-magnet]") ?? null;
      if (nextTarget !== target) {
        target?.classList.remove("swap-target");
        target = nextTarget;
        target?.classList.add("swap-target");
      }
    };
    const finish = (pointerEvent) => {
      moveGhost(pointerEvent);
      magnet.removeEventListener("pointermove", moveGhost);
      magnet.removeEventListener("pointerup", finish);
      magnet.removeEventListener("pointercancel", cancel);
      target?.classList.remove("swap-target");
      ghost.remove();
      draggingMagnet = false;
      if (target) swapStarter(benchId, target.dataset.magnet);
    };
    const cancel = () => {
      magnet.removeEventListener("pointermove", moveGhost);
      magnet.removeEventListener("pointerup", finish);
      magnet.removeEventListener("pointercancel", cancel);
      target?.classList.remove("swap-target");
      ghost.remove();
      draggingMagnet = false;
    };
    magnet.setPointerCapture(event.pointerId);
    moveGhost(event);
    magnet.addEventListener("pointermove", moveGhost);
    magnet.addEventListener("pointerup", finish, { once:true });
    magnet.addEventListener("pointercancel", cancel, { once:true });
  }));
}

async function persistTactics(ready, notify = false) {
  if (roomMutationPending) return;
  roomMutationPending = true;
  roomStateEpoch += 1;
  clearTimeout(polling);
  try {
    const value = await api(`/api/versus/rooms/${session.code}/tactics`, { method:"POST", body:{ positions:localPositions,startingIds:localStartingIds,tactic:localTactic,style:localStyle,attackFocus:localAttackFocus,defenseFocus:localDefenseFocus,ready } });
    const previousPhase = room?.phase;
    room = value.room;
    if (previousPhase !== room.phase) {
      localPositions = null;
      localStartingIds = null;
      draggingMagnet = false;
      controlInteraction = false;
    }
    if (notify) showToast("战术已保存，等待好友准备");
    render();
  } catch (error) { showToast(error.message); }
  finally {
    roomMutationPending = false;
    if (session) schedulePolling(100);
  }
}

function matchPhaseLabel(match) {
  if (match.phase === "finished") return "比赛结束";
  if (match.pause?.kind === "halftime") return "中场调整";
  if (match.segment === "penalties") return "点球大战";
  if (match.segment === "extra") return "加时赛";
  return match.minute <= 45 ? "上半场" : "下半场";
}

function matchEventMarkup(entry) {
  const marks = { kickoff:"开",duel:"对抗",attack:"推进",counter:"反击",save:"扑救",miss:"射门",goal:"进球",foul:"犯规",yellow:"黄牌",red:"红牌",injury:"伤退",lightning:"雷击",blackWhistle:"争议判罚",corner:"角球",penaltyAwarded:"点球",halftime:"半场",extra:"加时",tactical:"战术",penalty:"点球",shootout:"点球大战",fulltime:"结束" };
  const icons = { goal:"⚽",yellow:"■",red:"■",injury:"✚",lightning:"ϟ",blackWhistle:"⚖",penaltyAwarded:"P",penalty:"P",shootout:"P",save:"◆",tactical:"↔",halftime:"Ⅱ",fulltime:"■" };
  return `<details class="match-event event-${entry.type} importance-${entry.importance}" ${entry.importance === "major" ? "open" : ""}><summary><b>${entry.minute}'</b><span class="event-icon" aria-hidden="true">${icons[entry.type] ?? "•"}</span><i>${marks[entry.type] ?? "动态"}</i><span>${escapeHtml(entry.text)}${entry.assistId ? `<mark class="assist-mark">助攻</mark>` : ""}</span></summary>${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ""}${Number.isFinite(entry.xg) ? `<small>xG ${entry.xg}</small>` : ""}</details>`;
}

function liveStatusMarkers(player) {
  const stats = player.stats ?? {};
  const marker = (type, symbol, count, label) => count > 0 ? `<span class="live-status-marker status-${type}" title="${label}${count > 1 ? ` × ${count}` : ""}" aria-label="${label}${count > 1 ? ` ${count}次` : ""}">${symbol}${count > 1 ? `<em>${count}</em>` : ""}</span>` : "";
  return `<span class="live-status-markers">${[
    marker("goal", "⚽", Number(stats.goals ?? 0), "进球"),
    marker("assist", "👟", Number(stats.assists ?? 0), "助攻"),
    marker("yellow", "", Number(stats.yellowCards ?? 0), "黄牌"),
    marker("red", "", Math.max(Number(stats.redCards ?? 0), player.sentOff ? 1 : 0), "红牌"),
    marker("injury", "+", player.injury ? 1 : 0, "受伤"),
  ].join("")}</span>`;
}

function liveMagnet(player, editable, position = player.position ?? { x:50,y:50 }, assignedRole = player.assignedRole) {
  const status = player.sentOff ? "红牌" : player.injury ? "伤退" : "";
  const tooltip = playerTooltip(player, assignedRole);
  return `<button class="magnet live-magnet grade-${String(player.grade ?? "C").toLowerCase()} rating-${Math.floor(player.rating)} ${status ? "inactive" : ""}" data-live-magnet="${player.id}" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}" style="left:${position.x}%;top:${position.y}%" ${editable && player.active ? "" : "disabled"}>${liveStatusMarkers(player)}<b>${escapeHtml(player.name)}</b><small>${status || `${ROLE_LABELS[assignedRole] ?? assignedRole} · 体能 ${Math.round(player.fitness)}`}</small><i class="live-rating">${player.rating.toFixed(1)}</i></button>`;
}

function broadcastMagnet(player) {
  const assignedRole = player.assignedRole ?? player.role;
  const status = player.sentOff ? "红牌" : player.injury ? "伤退" : "";
  const tooltip = playerTooltip(player, assignedRole);
  const fitness = Math.max(0, Math.min(100, Math.round(player.fitness ?? 100)));
  const upgrade = Number(player.upgradeLevel ?? 0);
  const overall = Math.round(player.overall ?? player.rating ?? 0);
  return `<button type="button" class="magnet live-magnet league-squad-magnet s4-broadcast-magnet grade-${String(player.grade ?? "C").toLowerCase()} fit-primary ${status ? "inactive unavailable" : ""}" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}" style="left:${player.position.x}%;top:${player.position.y}%" disabled>${liveStatusMarkers(player)}<span class="league-magnet-role">${ROLE_LABELS[assignedRole] ?? assignedRole}</span><b>${escapeHtml(player.name)}</b><i>${overall}</i><span class="league-magnet-fitness" aria-label="体力 ${fitness}"><span style="width:${fitness}%"></span></span><span class="s4-broadcast-rating">评分 ${Number(player.rating ?? 0).toFixed(1)}</span>${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}</button>`;
}

function matchStatsMarkup(match, teamOrder = [0, 1]) {
  const left = match.teams[teamOrder[0]].stats;
  const right = match.teams[teamOrder[1]].stats;
  const possessionTotal = left.possession + right.possession || 1;
  const rows = [
    ["控球", `${Math.round(left.possession / possessionTotal * 100)}%`, `${Math.round(right.possession / possessionTotal * 100)}%`],
    ["射门", left.shots, right.shots], ["射正", left.shotsOnTarget, right.shotsOnTarget],
    ["xG", left.xg, right.xg], ["犯规", left.fouls, right.fouls], ["红牌", left.redCards, right.redCards],
  ];
  return `<div class="live-stats">${rows.map(([label,a,b]) => `<div><b>${a}</b><span>${label}</span><b>${b}</b></div>`).join("")}</div>`;
}

function livePitchMarkup(team, options = {}) {
  const { own = false, paused = false } = options;
  const pauseTitle = room.match.pause?.kind === "halftime" ? "中场调整" : "双方战术调整";
  const submitted = Boolean(room.match.pause?.submitted?.[room.viewerIndex]);
  const pauseNote = own ? (submitted ? "已提交，等待倒计时结束" : "双方均可调整，倒计时不会提前结束") : "比赛将在倒计时结束后继续";
  const shownPlayers = team.players.filter((player) => player.active || player.sentOff || player.injury);
  const activePlayers = team.players.filter((player) => player.active);
  const previewing = own && paused && !submitted;
  const previewRoles = previewing ? inferAssignedRoles(activePlayers, localPositions) : {};
  return `<div class="pitch live-pitch ${own ? "own-live-pitch" : "opponent-live-pitch"}" id="${own ? "live-pitch" : "opponent-live-pitch"}"><div class="pitch-lines"></div><span class="zone-label att">前场</span><span class="zone-label mid">中场</span><span class="zone-label def">后场</span><span class="zone-label gk">门将</span>${shownPlayers.map((player) => liveMagnet(player, previewing, previewing ? (localPositions?.[player.id] ?? player.position) : player.position, previewRoles[player.id] ?? player.assignedRole)).join("")}${paused ? `<div class="pause-ribbon"><b>${pauseTitle}</b><strong>${clockText(room.match.pause.remainingMs)}</strong><small>${pauseNote}</small></div>` : ""}</div>`;
}

function liveTeamPanel(team, options = {}) {
  const { own = false, adjusting = false, canPause = false } = options;
  const title = own
    ? `${TACTICS[team.tactic]} · ${STYLES[team.style]} · 适配 ${Math.round(team.styleFit * 100)}%`
    : "对方比赛策略保密";
  const opponent = room.match.teams[room.viewerIndex === 0 ? 1 : 0];
  const markingOptions = opponent.players.filter((player) => player.active).map((player) => `<option value="${escapeHtml(player.id)}" ${localMarkingTargetId === player.id ? "selected" : ""}>${escapeHtml(player.name)} · ${ROLE_LABELS[player.assignedRole] ?? player.assignedRole} · ${player.rating.toFixed(1)}</option>`).join("");
  const submitted = Boolean(room.match.pause?.submitted?.[room.viewerIndex]);
  const displayedFormation = own && adjusting && !submitted ? inferFormationName(team.players.filter((player) => player.active), localPositions) : team.formation;
  return `<section class="live-team-panel ${own ? "own-team-panel" : "opponent-team-panel"}"><header><div><h2>${escapeHtml(team.name)}${team.importedLineup ? `<span class="lineup-origin-badge">自带阵容</span>` : ""}</h2><small>${displayedFormation} · ${team.activeCount} 人</small></div>${own ? `<button class="button pause-button" id="pause-match" ${canPause ? "" : "disabled"}>${room.match.pauseUsed[room.viewerIndex] ? "暂停已使用" : room.match.pause ? "调整中" : "战术暂停"}</button>` : `<span class="strategy-private">${title}</span>`}</header>${livePitchMarkup(team, { own, paused:Boolean(room.match.pause) })}${own && !adjusting ? `<footer>${title} · 主攻${FOCUSES[team.attackFocus]} · 主守${FOCUSES[team.defenseFocus]}</footer>` : ""}${adjusting && own ? `<div class="pause-move-hint">拖动球员并调整双方策略；完整保留 30 秒</div><div class="live-tactic-controls"><label class="field"><span>比赛思路</span><select id="live-tactic-select" ${submitted ? "disabled" : ""}>${Object.entries(TACTICS).map(([key,label]) => `<option value="${key}" ${localTactic === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>比赛战术</span><select id="live-style-select" ${submitted ? "disabled" : ""}>${Object.entries(STYLES).map(([key,label]) => `<option value="${key}" ${localStyle === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>主攻方向</span><select id="live-attack-focus" ${submitted ? "disabled" : ""}>${focusOptions(localAttackFocus)}</select></label><label class="field"><span>主守方向</span><select id="live-defense-focus" ${submitted ? "disabled" : ""}>${focusOptions(localDefenseFocus)}</select></label><label class="field marking-target-field"><span>重点盯防</span><select id="live-marking-select" ${submitted ? "disabled" : ""}><option value="">不设置</option>${markingOptions}</select></label><button class="button primary" id="apply-live-tactics" ${submitted ? "disabled" : ""}>${submitted ? "已提交，等待继续" : "提交本次调整"}</button></div>` : ""}</section>`;
}

function renderMatch() {
  const feedScroll = captureEventFeedScroll(app);
  const match = room.match;
  if (match.segment !== lastMatchSegment) {
    if (match.segment === "penalties") mobileMatchView = "commentary";
    lastMatchSegment = match.segment;
  }
  const ownTeam = match.teams[room.viewerIndex];
  const opponent = match.teams[room.viewerIndex === 0 ? 1 : 0];
  const adjusting = Boolean(match.pause);
  const ownSubmitted = Boolean(match.pause?.submitted?.[room.viewerIndex]);
  if (adjusting) mobileMatchView = "own";
  if (!localPositions) localPositions = Object.fromEntries(ownTeam.players.filter((player) => player.active).map((player) => [player.id, player.position]));
  localTactic = localTactic || ownTeam.tactic;
  localStyle = localStyle || ownTeam.style;
  localAttackFocus = localAttackFocus || ownTeam.attackFocus || "balanced";
  localDefenseFocus = localDefenseFocus || ownTeam.defenseFocus || "balanced";
  const canPause = ["regular", "extra"].includes(match.segment) && !match.pauseUsed[room.viewerIndex] && !match.pause;
  const ownScore = match.score[room.viewerIndex];
  const opponentScore = match.score[room.viewerIndex === 0 ? 1 : 0];
  const latestEvent = match.events.at(-1);
  const latestIcon = latestEvent ? ({ goal:"⚽",yellow:"■",red:"■",injury:"✚",lightning:"ϟ",penaltyAwarded:"P",shootout:"P",tactical:"↔" }[latestEvent.type] ?? "•") : "";
  const centerValue = match.segment === "penalties" ? `${match.penalties?.score?.[0] ?? 0}:${match.penalties?.score?.[1] ?? 0}` : `${match.minute}'`;
  const firstLegText = match.aggregateBaseScore ? `首回合 ${match.aggregateBaseScore[room.viewerIndex]}:${match.aggregateBaseScore[room.viewerIndex === 0 ? 1 : 0]} · ` : "";
  const centerDetail = match.segment === "penalties" ? "点球比分" : `${firstLegText}${weatherIcon(match.weather)} ${escapeHtml(match.weather.name)}`;
  app.innerHTML = `<section class="match-shell"><header class="scoreboard"><div><small>${escapeHtml(ownTeam.name)}</small><b>${ownScore}</b><em>${ownTeam.activeCount} 人 · ${ownTeam.formation}</em></div><span><small>${matchPhaseLabel(match)}</small><strong>${centerValue}</strong><em>${centerDetail}</em></span><div><small>${escapeHtml(opponent.name)}</small><b>${opponentScore}</b><em>${opponent.activeCount} 人 · ${opponent.formation}</em></div></header><div class="match-layout match-triple-layout">${liveTeamPanel(ownTeam, { own:true, adjusting, canPause })}<section class="commentary-panel match-center-panel"><header><h2>实时战况</h2><span>${match.events.length}</span></header>${latestEvent ? `<div class="latest-event event-${latestEvent.type}"><i>${latestIcon}</i><b>${latestEvent.minute}'</b><span>${escapeHtml(latestEvent.text)}</span></div>` : ""}<div class="event-feed">${match.events.length ? [...match.events].reverse().map(matchEventMarkup).join("") : `<p class="feed-empty">比赛进行中</p>`}</div>${matchStatsMarkup(match, [room.viewerIndex, room.viewerIndex === 0 ? 1 : 0])}</section>${liveTeamPanel(opponent, { own:false, adjusting, canPause:false })}</div></section>`;
  restoreEventFeedScroll(app, feedScroll);
  document.querySelector(".scoreboard>span")?.insertAdjacentHTML("beforeend", `<small class="scoreboard-referee">⚖ ${escapeHtml(refereeText(match.referee))}</small>`);
  const pauseHint = document.querySelector(".pause-move-hint");
  if (pauseHint) pauseHint.textContent = "拖动球员并调整双方策略；双方都提交后立即继续";
  if (latestEvent && latestEvent.id !== lastAnimatedEventId && ["goal", "red", "penalty", "penaltyAwarded", "lightning", "blackWhistle"].includes(latestEvent.type)) document.querySelector(".latest-event")?.classList.add("critical-arrival");
  if (latestEvent) lastAnimatedEventId = latestEvent.id;
  const spectatorNames = (room.spectators ?? []).map((spectator) => escapeHtml(spectator.name));
  document.querySelector(".match-shell")?.insertAdjacentHTML("afterbegin", `<aside class="match-audience"><i>LIVE</i><span><b>${spectatorNames.length} 人观战</b><small>${spectatorNames.length ? spectatorNames.join("、") : "当前暂无观众"}</small></span></aside>`);
  const matchLayout = document.querySelector(".match-triple-layout");
  if (matchLayout) {
    matchLayout.classList.add(`match-view-${mobileMatchView}`);
    const mobileTabs = document.createElement("nav");
    mobileTabs.className = "mobile-match-tabs";
    mobileTabs.setAttribute("aria-label", "比赛视图");
    mobileTabs.innerHTML = [
      ["own", "己方"],
      ["commentary", "战况"],
      ["opponent", "对方"],
    ].map(([view, label]) => `<button type="button" data-match-view="${view}" class="${mobileMatchView === view ? "active" : ""}">${label}</button>`).join("");
    matchLayout.before(mobileTabs);
    mobileTabs.querySelectorAll("[data-match-view]").forEach((button) => button.onclick = () => {
      mobileMatchView = button.dataset.matchView;
      matchLayout.classList.remove("match-view-own", "match-view-commentary", "match-view-opponent");
      matchLayout.classList.add(`match-view-${mobileMatchView}`);
      mobileTabs.querySelectorAll("button").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    });
  }
  const pauseButton = document.querySelector("#pause-match");
  if (pauseButton && canPause) pauseButton.onclick = requestPause;
  if (adjusting && !ownSubmitted) {
    document.querySelector("#live-tactic-select").onchange = (event) => { localTactic = event.target.value; };
    document.querySelector("#live-style-select").onchange = (event) => { localStyle = event.target.value; };
    document.querySelector("#live-marking-select").onchange = (event) => { localMarkingTargetId = event.target.value || null; };
    document.querySelector("#live-attack-focus").onchange = (event) => { localAttackFocus = event.target.value; };
    document.querySelector("#live-defense-focus").onchange = (event) => { localDefenseFocus = event.target.value; };
    document.querySelector("#apply-live-tactics").onclick = applyLiveTactics;
    bindLiveMagnets();
  }
}

function bindLiveMagnets() {
  const pitch = document.querySelector("#live-pitch");
  document.querySelectorAll("[data-live-magnet]:not(:disabled)").forEach((magnet) => magnet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    draggingMagnet = true;
    const playerId = magnet.dataset.liveMagnet;
    const startPosition = { ...localPositions[playerId] };
    let moved = false;
    magnet.setPointerCapture(event.pointerId);
    magnet.classList.add("dragging");
    const move = (moveEvent) => {
      const rect = pitch.getBoundingClientRect();
      const x = Math.max(8,Math.min(92,((moveEvent.clientX-rect.left)/rect.width)*100));
      const y = Math.max(6,Math.min(94,((moveEvent.clientY-rect.top)/rect.height)*100));
      localPositions[playerId] = { x:Math.round(x),y:Math.round(y) };
      moved = true;
      magnet.style.left = `${x}%`; magnet.style.top = `${y}%`;
    };
    const up = () => { draggingMagnet = false; magnet.classList.remove("dragging"); magnet.removeEventListener("pointermove",move); magnet.removeEventListener("pointerup",up); if (moved && hasMultipleGoalkeepers(localPositions, playerId, localPositions[playerId])) { localPositions[playerId] = startPosition; showToast("门将位置最多只能安排一名球员"); } if (moved) renderMatch(); };
    magnet.addEventListener("pointermove",move);
    magnet.addEventListener("pointerup",up,{once:true});
  }));
}

async function requestPause() {
  try {
    const value = await api(`/api/versus/rooms/${session.code}/pause`, { method:"POST" });
    room = value.room; localPositions = null; localTactic = room.match.teams[room.viewerIndex].tactic; localStyle = room.match.teams[room.viewerIndex].style; localAttackFocus = room.match.teams[room.viewerIndex].attackFocus; localDefenseFocus = room.match.teams[room.viewerIndex].defenseFocus; localMarkingTargetId = room.match.teams[room.viewerIndex].markingTargetId; render();
  } catch (error) { showToast(error.message); }
}

async function applyLiveTactics() {
  try {
    let value = await api(`/api/versus/rooms/${session.code}/live-tactics`, { method:"POST",body:{ positions:localPositions,tactic:localTactic,style:localStyle,attackFocus:localAttackFocus,defenseFocus:localDefenseFocus,markingTargetId:localMarkingTargetId } });
    room = value.room;
    value = await api(`/api/versus/rooms/${session.code}/resume`, { method:"POST" });
    room = value.room; localPositions = null; localMarkingTargetId = null; showToast("调整已提交，比赛将在倒计时结束后继续"); render();
  } catch (error) { showToast(error.message); }
}

function reportPlayerRows(team) {
  return team.players.map((player) => `<tr><td><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.role] ?? player.role}${player.sentOff ? " · 红牌" : player.injury ? " · 伤退" : ""}</small></td><td>${player.rating.toFixed(1)}</td><td>${Math.round(player.fitness)}</td><td>${player.stats.goals}</td><td>${player.stats.assists}</td><td>${player.stats.shotsOnTarget}</td><td>${player.stats.tackles}</td><td>${player.stats.saves}</td></tr>`).join("");
}

function reportTimelineItem(entry) {
  const icons = { goal:"⚽",red:"■",injury:"✚",lightning:"ϟ",blackWhistle:"⚖",penaltyAwarded:"P",penalty:"P",shootout:"P",halftime:"Ⅱ",fulltime:"■",tactical:"↔" };
  const labels = { goal:"进球",red:"红牌",injury:"伤退",lightning:"雷击",blackWhistle:"争议判罚",penaltyAwarded:"判罚点球",penalty:"点球",shootout:"点球大战",halftime:"中场",fulltime:"终场",tactical:"战术调整" };
  return `<article class="timeline-event event-${entry.type}"><time>${entry.minute}'</time><i>${icons[entry.type] ?? "•"}</i><div><b>${labels[entry.type] ?? "比赛事件"}</b><p>${escapeHtml(entry.text)}</p>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ""}</div></article>`;
}

function teamHighlightsMarkup(team, index) {
  const leaders = [...team.players].sort((left, right) => right.rating - left.rating).slice(0, 3);
  const strategy = index === room.viewerIndex
    ? `${TACTICS[team.tactic]} · ${STYLES[team.style]} · 主攻${FOCUSES[team.attackFocus]} · 主守${FOCUSES[team.defenseFocus]}`
    : "对方战术保密";
  return `<section class="team-highlights"><header><div><h2>${escapeHtml(team.name)}</h2><small>${team.formation} · ${strategy}</small></div><b>${team.stats.xg} xG</b></header><div class="highlight-players">${leaders.map((player, rank) => `<div><span>${rank + 1}</span><p><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.role] ?? player.role} · ${player.stats.goals}球 ${player.stats.assists}助</small></p><strong>${player.rating.toFixed(1)}</strong></div>`).join("")}</div></section>`;
}

function renderReport() {
  const report = room.match.report;
  const firstTournamentLeg = room.competitionMode === "tournament" && room.legNumber === 1;
  const displayScore = report.aggregateScore ?? report.score;
  const winner = firstTournamentLeg ? "首回合结束" : report.winnerIndex === null ? "双方战平" : `${escapeHtml(report.teams[report.winnerIndex].name)}获胜`;
  const ownRematchReady = Boolean(room.rematchReady?.[room.viewerIndex]);
  const rivalRematchReady = Boolean(room.rematchReady?.[room.viewerIndex === 0 ? 1 : 0]);
  const rematchText = ownRematchReady ? (rivalRematchReady ? (firstTournamentLeg ? "正在进入第二回合" : "正在重新开局") : "已确认，等待好友") : (rivalRematchReady ? (firstTournamentLeg ? "好友已准备，进入第二回合" : "好友已确认，再来一局") : (firstTournamentLeg ? "准备第二回合" : "再来一局"));
  const exportContent = exportedLineupCode ? `<div class="seed-result"><textarea id="exported-lineup-code" readonly>${escapeHtml(exportedLineupCode)}</textarea><button class="button primary" id="copy-lineup-seed">复制阵容码</button></div>` : `<button class="button export-lineup-button" id="export-lineup">导出我的阵容</button>`;
  app.innerHTML = `<section class="report-screen"><header class="report-hero"><h1>${winner}</h1><div class="report-score"><span>${escapeHtml(report.teams[0].name)}</span><b>${report.score[0]} : ${report.score[1]}</b><span>${escapeHtml(report.teams[1].name)}</span></div>${report.penalties ? `<p>点球 ${report.penalties[0]} : ${report.penalties[1]}</p>` : ""}<small>${escapeHtml(report.weather.name)} · ${report.teams[0].activeCount} 对 ${report.teams[1].activeCount} 人</small><button class="button primary rematch-button" id="rematch" ${ownRematchReady ? "disabled" : ""}>${rematchText}</button></header><section class="lineup-export-panel"><h2>保存本场阵容</h2>${exportContent}</section><div class="report-grid"><section class="report-panel"><h2>比赛统计</h2>${matchStatsMarkup({ teams:report.teams })}</section><section class="report-panel"><h2>重要事件</h2><div class="report-events">${report.importantEvents.map(matchEventMarkup).join("")}</div></section></div>${report.teams.map((team,index) => `<section class="player-report"><header><h2>${escapeHtml(team.name)}${team.importedLineup ? `<span class="lineup-origin-badge">自带阵容</span>` : ""}</h2><strong>${team.formation} · ${index === room.viewerIndex ? `${TACTICS[team.tactic]} · ${STYLES[team.style]} · 主攻${FOCUSES[team.attackFocus]} · 主守${FOCUSES[team.defenseFocus]} · 适配 ${Math.round(team.styleFit * 100)}%` : "战术保密"}</strong></header><div class="table-wrap"><table><thead><tr><th>球员</th><th>评分</th><th>体能</th><th>进球</th><th>助攻</th><th>射正</th><th>抢断</th><th>扑救</th></tr></thead><tbody>${reportPlayerRows(team)}</tbody></table></div></section>`).join("")}</section>`;
  const timeline = report.importantEvents.length ? report.importantEvents.map(reportTimelineItem).join("") : `<p class="history-empty">本场没有需要特别记录的事件。</p>`;
  app.innerHTML = `<section class="report-screen"><header class="report-hero compact-report-hero"><h1>${winner}</h1><div class="report-score"><span>${escapeHtml(report.teams[0].name)}</span><b>${displayScore[0]} : ${displayScore[1]}</b><span>${escapeHtml(report.teams[1].name)}</span></div>${report.aggregateBaseScore ? `<p>首回合 ${report.aggregateBaseScore[0]} : ${report.aggregateBaseScore[1]} · 次回合 ${report.score[0]} : ${report.score[1]}</p>` : ""}${report.penalties ? `<p>点球 ${report.penalties[0]} : ${report.penalties[1]}</p>` : ""}<small>${weatherIcon(report.weather)} ${escapeHtml(report.weather.name)} · ${report.teams[0].activeCount} 对 ${report.teams[1].activeCount} 人</small><button class="button primary rematch-button" id="rematch" ${ownRematchReady ? "disabled" : ""}>${rematchText}</button></header><div class="report-story-layout"><section class="report-panel timeline-panel"><h2>比赛时间轴</h2><div class="match-timeline">${timeline}</div></section><section class="report-panel compact-stats-panel"><h2>比赛统计</h2>${matchStatsMarkup({ teams:report.teams })}</section></div><div class="team-highlights-grid">${report.teams.map(teamHighlightsMarkup).join("")}</div><section class="lineup-export-panel compact-export-panel"><h2>保存本场阵容</h2>${exportContent}</section></section>`;
  document.querySelector(".compact-report-hero>small")?.insertAdjacentHTML("beforeend", ` · ⚖ ${escapeHtml(refereeText(report.referee))}${report.blackWhistle ? " · 本场出现争议判罚" : ""}`);
  document.querySelector("#rematch")?.insertAdjacentHTML("afterend", `<button class="button secondary return-main-button" id="return-main">返回主菜单</button>`);
  const exportButton = document.querySelector("#export-lineup");
  if (exportButton) exportButton.onclick = exportLineup;
  const copyButton = document.querySelector("#copy-lineup-seed");
  if (copyButton) copyButton.onclick = async () => {
    await navigator.clipboard?.writeText(exportedLineupCode);
    showToast("阵容码已复制");
  };
  const rematchButton = document.querySelector("#rematch");
  if (rematchButton && !ownRematchReady) rematchButton.onclick = requestRematch;
  document.querySelector("#return-main").onclick = returnToMain;
}

function returnToMain() {
  clearTimeout(polling);
  storeSession(null);
  room = null;
  localPositions = null;
  localStartingIds = null;
  lineupSeedInput = "";
  exportedLineupCode = "";
  renderLanding();
}

async function requestRematch() {
  try {
    const value = await api(`/api/versus/rooms/${session.code}/rematch`, { method:"POST" });
    room = value.room;
    if (room.phase === "draft") {
      exportedLineupCode = "";
      lineupSeedInput = "";
      localPositions = null;
      localStartingIds = null;
      lastMatchSegment = null;
      showToast(room.competitionMode === "tournament" && room.legNumber === 2 ? "双方已确认，开始第二回合补强选秀" : "双方已确认，开始新一轮选秀");
    } else showToast("已确认，等待好友");
    render();
  } catch (error) { showToast(error.message); }
}

async function exportLineup() {
  try {
    const value = await api(`/api/versus/rooms/${session.code}/export-lineup`, { method:"POST" });
    exportedLineupCode = value.seed;
    renderReport();
    showToast(`阵容已保存 · ${value.formation}`);
  } catch (error) { showToast(error.message); }
}

function render() {
  if (!account || !account.profile?.passwordSet) return renderAuth();
  const nextPhase = room?.phase ?? "landing";
  const phaseChanged = nextPhase !== renderedPhase;
  renderedPhase = nextPhase;
  updateChrome();
  if (!room) renderLanding();
  else if (room.phase === "lobby") renderWaiting();
  else if (room.phase === "draft") renderDraft();
  else if (room.phase === "tactics") renderTactics();
  else if (room.phase === "match") renderMatch();
  else renderReport();
  if (phaseChanged) requestAnimationFrame(() => window.scrollTo(0, 0));
}

function acceptRoomSnapshot(nextRoom) {
  const previousPhase = room?.phase;
  const previousUpdatedAt = room?.updatedAt;
  room = nextRoom;
  if (room.profile && account) storeAccount({ ...account, profile:room.profile });
  if (previousPhase !== room.phase) {
    localPositions = null;
    localStartingIds = null;
    localTactic = ownPlayer()?.tactic ?? "balanced";
    localStyle = ownPlayer()?.style ?? "possession";
    localAttackFocus = ownPlayer()?.attackFocus ?? "balanced";
    localDefenseFocus = ownPlayer()?.defenseFocus ?? "balanced";
  }
  const roomChanged = previousPhase !== room.phase || previousUpdatedAt !== room.updatedAt || room.phase === "match";
  if (!draggingMagnet && !controlInteraction && roomChanged) render();
  else if (!roomChanged) {
    const timer = document.querySelector(".phase-timer b");
    if (timer && room.timer) timer.textContent = clockText(room.timer.remainingMs);
  }
}

function stopRoomStream() {
  clearTimeout(roomStreamReconnectTimer);
  roomStreamReconnectTimer = null;
  const activeStream = roomStream;
  roomStream = null;
  roomStreamConnected = false;
  activeStream?.abort();
}

function startRoomStream() {
  stopRoomStream();
  if (!session || typeof ReadableStream === "undefined") return;
  const controller = new AbortController();
  roomStream = controller;
  void (async () => {
    try {
      const response = await fetch(`/api/versus/stream/${encodeURIComponent(session.code)}`, {
        headers: { authorization:`Bearer ${session.token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("实时连接建立失败");
      if (roomStream !== controller) return;
      roomStreamConnected = true;
      networkFailures = 0;
      connectionState = "online";
      updateChrome();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (roomStream === controller) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream:true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const eventName = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
          if (eventName === "room" && data) {
            try {
              const payload = JSON.parse(data);
              if (payload.room && session) acceptRoomSnapshot(payload.room);
            } catch {}
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      throw new Error("实时连接已关闭");
    } catch (error) {
      if (controller.signal.aborted || roomStream !== controller) return;
    } finally {
      if (roomStream !== controller) return;
      roomStream = null;
      roomStreamConnected = false;
      connectionState = "reconnecting";
      updateChrome();
      if (session) {
        schedulePolling(300);
        roomStreamReconnectTimer = setTimeout(startRoomStream, 1500);
      }
    }
  })();
}

async function refresh() {
  if (!session) return;
  if (roomMutationPending) return schedulePolling(100);
  const requestEpoch = roomStateEpoch;
  try {
    const value = await api(`/api/versus/rooms/${session.code}`);
    if (requestEpoch !== roomStateEpoch || roomMutationPending) return;
    networkFailures = 0;
    connectionState = "online";
    acceptRoomSnapshot(value.room);
  } catch (error) {
    networkFailures += 1;
    connectionState = "reconnecting";
    updateChrome();
    if (networkFailures === 1) showToast("连接暂时中断，正在自动重连");
  } finally {
    if (session && !roomMutationPending) schedulePolling(networkFailures ? Math.min(8000, 1000 * (2 ** Math.min(networkFailures, 3))) : pollDelay());
  }
}

function pollDelay() {
  if (roomStreamConnected) return 5000;
  if (document.hidden) return 3000;
  if (room?.phase === "match") return 250;
  if (room?.phase === "lobby") return 750;
  return 500;
}

function schedulePolling(delay = pollDelay()) {
  clearTimeout(polling);
  polling = setTimeout(refresh, delay);
}

function startPolling() {
  startRoomStream();
  schedulePolling(200);
}

leaveButton.onclick = () => { clearTimeout(polling); stopRoomStream(); storeSession(null); room = null; leagueMode = false; league = null; localPositions = null; localStartingIds = null; localTactic = "balanced"; localStyle = "possession"; localAttackFocus = "balanced"; localDefenseFocus = "balanced"; lineupSeedInput = ""; exportedLineupCode = ""; renderLanding(); };
accountLogoutButton.onclick = logoutAccount;

app.addEventListener("focusin", (event) => {
  if (!event.target.matches("select, input")) return;
  clearTimeout(controlReleaseTimer);
  controlInteraction = true;
});
app.addEventListener("focusout", () => {
  clearTimeout(controlReleaseTimer);
  controlReleaseTimer = setTimeout(() => { controlInteraction = false; }, 300);
});
app.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("select, input")) return;
  clearTimeout(controlReleaseTimer);
  controlInteraction = true;
});

function assignLeagueEnhancementCard(cardId, slot = null) {
  const entry = leagueEnhancementCardEntry(cardId);
  if (!entry || leagueEnhancementPhase === "scanning") return;
  if (leagueEnhancementCardListed(entry.player.id, entry.card.id)) return showToast("该球员卡已挂牌，请先撤回挂牌");
  let targetSlot = slot;
  if (!targetSlot) targetSlot = leagueEnhancementMainCardId ? "material" : "main";
  if (targetSlot === "material") {
    const main = leagueEnhancementCardEntry(leagueEnhancementMainCardId);
    if (main?.card.id === cardId) return showToast("主卡和副卡不能是同一张卡");
    if (main && main.player.id !== entry.player.id) return showToast("副卡必须是同名球员卡");
    leagueEnhancementMaterialCardId = cardId;
  } else {
    if (leagueEnhancementMaterialCardId === cardId) leagueEnhancementMaterialCardId = null;
    leagueEnhancementMainCardId = cardId;
    const material = leagueEnhancementCardEntry(leagueEnhancementMaterialCardId);
    if (material && material.player.id !== entry.player.id) leagueEnhancementMaterialCardId = null;
  }
  leagueEnhancementResult = null;
  leagueEnhancementTraitSelectionOpen = false;
  leagueEnhancementPhase = "idle";
  renderLeague();
}

async function performLeagueEnhancement() {
  const main = leagueEnhancementCardEntry(leagueEnhancementMainCardId);
  const material = leagueEnhancementCardEntry(leagueEnhancementMaterialCardId);
  if (!main || !material || main.player.id !== material.player.id || leagueEnhancementPhase === "scanning") return;
  leagueEnhancementPhase = "scanning";
  leagueEnhancementResult = null;
  leagueMutationPending = true;
  renderLeague();
  try {
    const request = api("/api/versus/league/card/enhance", {
      method:"POST",
      body:leagueIdentity({
        mainCardId:main.card.id,
        materialCardId:material.card.id,
        useProtection:leagueEnhancementUseProtection,
      }),
    }).then((value) => ({ value }), (error) => ({ error }));
    const [outcome] = await Promise.all([request, new Promise((resolve) => setTimeout(resolve, 1000))]);
    if (outcome.error) throw outcome.error;
    league = outcome.value.league;
    leagueEnhancementResult = league.enhancementResult ?? null;
    leagueEnhancementTraitSelectionOpen = false;
    leagueEnhancementMainCardId = null;
    leagueEnhancementMaterialCardId = null;
    leagueEnhancementPhase = leagueEnhancementResult?.success ? "success" : "failure";
    renderLeague();
    showToast(leagueEnhancementResult?.success ? "强化成功" : "强化失败");
    const resultId = leagueEnhancementResult?.id;
    setTimeout(() => {
      if (leagueTab === "enhancement" && leagueEnhancementResult?.id === resultId && leagueEnhancementPhase !== "scanning") {
        leagueEnhancementPhase = "idle";
        renderLeague();
      }
    }, 1300);
  } catch (error) {
    leagueEnhancementPhase = "idle";
    renderLeague();
    showToast(error.message);
  } finally {
    leagueMutationPending = false;
  }
}

app.addEventListener("click", (event) => {
  const historyButton = event.target.closest("[data-history-match]");
  if (historyButton) openHistoryMatch(historyButton.dataset.historyMatch);
  const watchButton = event.target.closest("[data-watch-room]");
  if (watchButton) startWatching(watchButton.dataset.watchRoom);
  const draftDraw = event.target.closest("[data-league-draw]");
  if (draftDraw) leagueRequest("/draft/draw", { pool:draftDraw.dataset.leagueDraw }).catch((error) => showToast(error.message));
  const draftChoice = event.target.closest("[data-league-choose]");
  if (draftChoice) leagueRequest("/draft/choose", { leaguePlayerId:draftChoice.dataset.leagueChoose }).catch((error) => showToast(error.message));
  const xPlayerChoose = event.target.closest("[data-x-player-choose]");
  if (xPlayerChoose) leagueRequest("/draft/x-player", { leaguePlayerId:xPlayerChoose.dataset.xPlayerChoose }).catch((error) => showToast(error.message));
  const xTraitChoose = event.target.closest("[data-x-trait-choose]");
  if (xTraitChoose) leagueRequest("/draft/x-trait", { traitId:xTraitChoose.dataset.xTraitChoose }).catch((error) => showToast(error.message));
  if (event.target.closest("[data-league-reset]") && window.confirm("重置后会释放已经签下的全部球员，确定重新选秀？")) leagueRequest("/draft/reset").catch((error) => showToast(error.message));
  if (event.target.closest("[data-league-finish]")) leagueRequest("/draft/finish").then(() => { leagueTab = "overview"; showToast("球队接管完成，将从下一轮开始参赛"); }).catch((error) => showToast(error.message));
  if (event.target.closest("[data-league-back]")) renderLanding();
  if (event.target.closest("[data-league-team-name-edit]")) openLeagueTeamNameEditor();
  const leagueTabButton = event.target.closest("[data-league-tab]");
  if (leagueTabButton) {
    const nextTab = leagueTabButton.dataset.leagueTab;
    if (leagueTab === "squad" && nextTab !== "squad" && leagueEditorDirty) saveLeagueTeamNow();
    if (nextTab === "squad" && leagueTab !== "squad") {
      leagueStartingIds = null;
      leaguePositions = null;
      leaguePositionPresets = null;
      leagueActivePositionPreset = "position1";
      leagueTacticalDraft = null;
    }
    if (nextTab === "backpack") leagueBackpackPage = "packs";
    if (leagueTabButton.matches("[data-open-player-ranking]")) leaguePlayerInfoSection = "ranking";
    else if (nextTab === "players" && leagueTab !== "players") leaguePlayerInfoSection = null;
    leagueEditorDirty = false;
    leagueTab = nextTab;
    renderLeague();
  }
  const playerInfoSection = event.target.closest("[data-player-info-section]");
  if (playerInfoSection) {
    leaguePlayerInfoSection = playerInfoSection.dataset.playerInfoSection === "back" ? null : playerInfoSection.dataset.playerInfoSection;
    renderLeague();
    return;
  }
  const backpackPageButton = event.target.closest("[data-backpack-page]");
  if (backpackPageButton) {
    leagueBackpackPage = backpackPageButton.dataset.backpackPage === "cards" ? "cards" : "packs";
    renderLeague();
    return;
  }
  const inboxMessage = event.target.closest("[data-league-inbox-message]");
  if (inboxMessage) {
    leagueInboxMessageId = inboxMessage.dataset.leagueInboxMessage;
    const message = league.inbox.find((entry) => entry.id === leagueInboxMessageId);
    if (message && !message.readAt) leagueRequest("/inbox/read", { messageId:leagueInboxMessageId }).catch((error) => showToast(error.message));
    else renderLeague();
  }
  const inboxDelete = event.target.closest("[data-league-inbox-delete]");
  if (inboxDelete) {
    const messageId = inboxDelete.dataset.leagueInboxDelete;
    const message = league.inbox.find((entry) => entry.id === messageId);
    if (message) openLeagueConfirm({ title:"删除邮件", text:`确定删除“${message.title}”吗？删除后无法恢复。`, confirmText:"删除", onConfirm:() => { leagueInboxMessageId = null; return leagueRequest("/inbox/delete", { messageId }); } });
  }
  const leagueBoardButton = event.target.closest("[data-league-board]");
  if (leagueBoardButton) { leagueBoard = leagueBoardButton.dataset.leagueBoard; renderLeague(); }
  const statsScope = event.target.closest("[data-league-stats-scope]");
  if (statsScope) { leagueStatsScope = statsScope.dataset.leagueStatsScope; renderLeague(); }
  const cupPage = event.target.closest("[data-cup-page]");
  if (cupPage) { leagueCupPage = cupPage.dataset.cupPage === "knockout" ? "knockout" : "swiss"; renderLeague(); }
  const cupRound = event.target.closest("[data-cup-round]");
  if (cupRound?.dataset.cupRound) { leagueCupRoundPage = Number(cupRound.dataset.cupRound); renderLeague(); }
  const leagueRound = event.target.closest("[data-league-round]");
  if (leagueRound?.dataset.leagueRound) { leagueRoundPage = Number(leagueRound.dataset.leagueRound); renderLeague(); }
  const leagueTeamDetail = event.target.closest("[data-league-team-detail]");
  if (leagueTeamDetail) openLeagueTeam(leagueTeamDetail.dataset.leagueTeamDetail);
  const leagueMatchDetail = event.target.closest("[data-league-match-detail]");
  if (leagueMatchDetail) openLeagueMatch(leagueMatchDetail.dataset.leagueMatchDetail);
  const enhancementCard = event.target.closest("[data-enhancement-card]");
  if (enhancementCard) {
    assignLeagueEnhancementCard(enhancementCard.dataset.enhancementCard);
    return;
  }
  const inboxDeleteBatch = event.target.closest("[data-league-inbox-delete-batch]");
  if (inboxDeleteBatch) {
    const mode = inboxDeleteBatch.dataset.leagueInboxDeleteBatch;
    openLeagueConfirm({ title:mode === "read" ? "删除已读邮件" : "清空收件箱", text:mode === "read" ? "确定删除全部已读且无需处理的邮件吗？" : "确定删除全部可删除邮件吗？尚待处理的交易报价和友谊赛邀请会被保留。", confirmText:"确认删除", onConfirm:() => { leagueInboxMessageId = null; return leagueRequest("/inbox/delete-batch", { mode }); } });
  }
  const enhancementSlotCard = event.target.closest("[data-enhancement-slot-card]");
  if (enhancementSlotCard) {
    if (enhancementSlotCard.dataset.enhancementSlotCard === "main") leagueEnhancementMainCardId = null;
    else leagueEnhancementMaterialCardId = null;
    leagueEnhancementResult = null;
    leagueEnhancementPhase = "idle";
    renderLeague();
    return;
  }
  if (event.target.closest("[data-enhancement-submit]")) {
    performLeagueEnhancement();
    return;
  }
  if (event.target.closest("[data-enhancement-open-traits]")) {
    leagueEnhancementTraitSelectionOpen = true;
    renderLeague();
    return;
  }
  if (event.target.closest("[data-enhancement-close-traits]")) {
    leagueEnhancementTraitSelectionOpen = false;
    renderLeague();
    return;
  }
  const enhancementTrait = event.target.closest("[data-enhancement-trait]");
  if (enhancementTrait) {
    leagueRequest("/card/enhancement-trait", {
      offerId:enhancementTrait.dataset.enhancementTraitOffer,
      traitId:enhancementTrait.dataset.enhancementTrait,
    }).then((value) => {
      const chosen = value.enhancementTraitResult;
      leagueEnhancementResult = chosen ? { id:chosen.offerId, success:true, beforeLevel:chosen.card.upgradeLevel, afterLevel:chosen.card.upgradeLevel, player:chosen.player, card:chosen.card } : null;
      leagueEnhancementTraitSelectionOpen = false;
      leagueEnhancementPhase = "success";
      renderLeague();
      showToast(chosen ? `已绑定特性：${chosen.trait.name}` : "特性绑定完成");
    }).catch((error) => showToast(error.message));
    return;
  }
  const s4CardDetail = event.target.closest("[data-s4-card-detail]");
  if (s4CardDetail) openS4CardDetail(s4CardDetail.dataset.s4CardDetail, s4CardDetail.dataset.s4PlayerId);
  const backpackRecoveryCard = event.target.closest("[data-backpack-recovery-card]");
  if (backpackRecoveryCard) {
    const cardId = backpackRecoveryCard.dataset.backpackRecoveryCard;
    const player = league.ownTeam.roster.find((entry) => entry.id === backpackRecoveryCard.dataset.s4PlayerId);
    if (leagueBackpackSelectedCardIds.has(cardId)) leagueBackpackSelectedCardIds.delete(cardId);
    else {
      const selectedFamilyCount = player.cards.filter((card) => leagueBackpackSelectedCardIds.has(card.id)).length;
      if (player.ownsRights && selectedFamilyCount + 1 >= player.cards.length) return showToast(`${player.name}必须保留至少一张卡，请使用所有权回收`);
      leagueBackpackSelectedCardIds.add(cardId);
    }
    renderLeague();
    return;
  }
  const backpackRecoveryOwnership = event.target.closest("[data-backpack-recovery-ownership]");
  if (backpackRecoveryOwnership) {
    const playerId = backpackRecoveryOwnership.dataset.backpackRecoveryOwnership;
    leagueBackpackSelectedOwnershipId = leagueBackpackSelectedOwnershipId === playerId ? null : playerId;
    renderLeague();
    return;
  }
  const backpackRecoveryMode = event.target.closest("[data-backpack-recovery-mode]");
  if (backpackRecoveryMode) {
    const mode = backpackRecoveryMode.dataset.backpackRecoveryMode;
    if (leagueBackpackRecoveryMode !== mode) {
      leagueBackpackRecoveryMode = mode;
      leagueBackpackSelectedCardIds.clear();
      leagueBackpackSelectedOwnershipId = null;
      renderLeague();
    } else if (mode === "single") openBackpackSingleRecoveryConfirm();
    else openBackpackOwnershipRecoveryConfirm();
    return;
  }
  if (event.target.closest("[data-backpack-recovery-cancel]")) {
    leagueBackpackRecoveryMode = null;
    leagueBackpackSelectedCardIds.clear();
    leagueBackpackSelectedOwnershipId = null;
    renderLeague();
    return;
  }
  const backpackDensity = event.target.closest("[data-backpack-density]");
  if (backpackDensity) {
    leagueBackpackCompact = backpackDensity.dataset.backpackDensity === "compact";
    renderLeague();
  }
  const positionPresetButton = event.target.closest("[data-league-position-preset]");
  if (positionPresetButton && leaguePositionPresets) {
    const nextPreset = positionPresetButton.dataset.leaguePositionPreset;
    if (leaguePositionPresets[nextPreset] && nextPreset !== leagueActivePositionPreset) {
      captureLeagueTacticalControls();
      leaguePositionPresets[leagueActivePositionPreset] = leaguePositions;
      leagueActivePositionPreset = nextPreset;
      leaguePositions = leaguePositionPresets[nextPreset];
      renderLeague();
    }
    return;
  }
  const s4PackOpen = event.target.closest("[data-s4-pack-open]");
  if (s4PackOpen) leagueRequest("/packs/open", { packId:s4PackOpen.dataset.s4PackOpen }).then((value) => {
    if (value.packOpening?.player) openS4PackResult(value.packOpening);
  }).catch((error) => showToast(error.message));
  const s4PackBatchOpen = event.target.closest("[data-s4-pack-open-batch]");
  if (s4PackBatchOpen) {
    const packType = s4PackBatchOpen.dataset.s4PackOpenBatch;
    const openable = (league.s4Packs?.inventory ?? []).filter((item) =>
      item.packType === packType
      && item.status === "unopened"
      && (leagueBackpackPackSource === "ALL" || item.source === leagueBackpackPackSource));
    const input = document.querySelector(`#backpack-batch-count-${CSS.escape(packType)}`);
    const quantity = Math.max(1, Math.min(100, openable.length, Math.floor(Number(input?.value ?? openable.length))));
    const packIds = openable.slice(0, quantity).map((item) => item.id);
    if (packIds.length) leagueRequest("/packs/open-batch", { packIds }).then((value) => {
      if (value.packBatchOpening?.complete) openS4PackBatchResults(value.packBatchOpening);
      else if (value.s4Packs?.batchOpening) showToast(`批量开包已开始，共${value.s4Packs.batchOpening.total}份`);
    }).catch((error) => showToast(error.message));
  }
  const s4PackChoice = event.target.closest("[data-s4-pack-choice]");
  if (s4PackChoice) leagueRequest("/packs/choose", { offerId:s4PackChoice.dataset.s4OfferId, leaguePlayerId:s4PackChoice.dataset.s4PackChoice }).then((value) => {
    if (value.packBatchOpening?.complete) openS4PackBatchResults(value.packBatchOpening);
    else if (value.packBatchOpening || value.s4Packs?.batchOpening) showToast(`已完成第${value.s4Packs?.batchOpening?.completed ?? value.packBatchOpening?.completed ?? 0}份选择`);
    else if (value.packOpening?.player) openS4PackResult(value.packOpening);
  }).catch((error) => showToast(error.message));
  if (event.target.closest("[data-league-simulate]")) leagueRequest("/simulate").then(() => showToast("下一轮模拟完成")).catch((error) => showToast(error.message));
  const marketSection = event.target.closest("[data-market-section]");
  if (marketSection) {
    leagueMarketSection = marketSection.dataset.marketSection === "back" ? null : marketSection.dataset.marketSection;
    renderLeague();
    return;
  }
  const cardTradeChoice = event.target.closest("[data-card-trade-choice]");
  if (cardTradeChoice) {
    const selected = cardTradeChoice.dataset.cardTradeSide === "offered" ? leagueTradeOfferedCardIds : leagueTradeRequestedCardIds;
    const cardId = cardTradeChoice.dataset.cardTradeChoice;
    const xPlayer = cardTradeChoice.dataset.cardTradeX === "true";
    if (selected.has(cardId)) selected.delete(cardId);
    else if (xPlayer) {
      selected.clear();
      selected.add(cardId);
      leagueTradeCoinAmount = "";
    } else {
      const xCardSelected = [...document.querySelectorAll("[data-card-trade-choice][data-card-trade-x='true']")]
        .some((element) => leagueTradeOfferedCardIds.has(element.dataset.cardTradeChoice) || leagueTradeRequestedCardIds.has(element.dataset.cardTradeChoice));
      if (xCardSelected) {
        leagueTradeOfferedCardIds.clear();
        leagueTradeRequestedCardIds.clear();
      }
      selected.add(cardId);
    }
    renderLeague();
    return;
  }
  if (event.target.closest("[data-card-trade-submit]")) {
    leagueRequest("/card-trades/create", { targetOwnerId:leagueTradeTargetOwnerId, offeredCardIds:[...leagueTradeOfferedCardIds], requestedCardIds:[...leagueTradeRequestedCardIds], coinAmount:leagueTradeCoinAmount }).then(() => {
      leagueTradeOfferedCardIds.clear();
      leagueTradeRequestedCardIds.clear();
      leagueTradeCoinAmount = "";
      renderLeague();
      showToast("交易报价已发送，附带金币已进入托管");
    }).catch((error) => showToast(error.message));
    return;
  }
  const cardTradeWithdraw = event.target.closest("[data-card-trade-withdraw]");
  if (cardTradeWithdraw) {
    openLeagueConfirm({ title:"撤回交易报价", text:"撤回后交易关闭，托管金币会立即退回，对方将收到撤回邮件。", confirmText:"确认撤回", onConfirm:() => leagueRequest("/card-trades/withdraw", { tradeOfferId:cardTradeWithdraw.dataset.cardTradeWithdraw }).then(() => showToast("交易报价已撤回")) });
    return;
  }
  const cardTradeRespond = event.target.closest("[data-card-trade-respond]");
  if (cardTradeRespond) {
    const action = cardTradeRespond.dataset.cardTradeRespond;
    openLeagueConfirm({ title:action === "accept" ? "接受球员卡交易" : "拒绝球员卡交易", text:action === "accept" ? "接受后系统会重新检查双方卡片状态，检查通过后立即完成结算。" : "拒绝后交易关闭，托管金币将退回发起方。", confirmText:action === "accept" ? "确认接受" : "确认拒绝", onConfirm:() => leagueRequest("/card-trades/respond", { tradeOfferId:cardTradeRespond.dataset.cardTradeOffer, action }).then((result) => { leagueInboxMessageId = null; showToast(result.cardTradeResult?.status === "failed" ? `交易失败：${result.cardTradeResult.reason}` : action === "accept" ? "交易已经达成" : "交易报价已拒绝"); }) });
    return;
  }
  const friendlyRespond = event.target.closest("[data-friendly-respond]");
  if (friendlyRespond) {
    const action = friendlyRespond.dataset.friendlyRespond;
    openLeagueConfirm({ title:action === "accept" ? "接受友谊赛邀请" : "拒绝友谊赛邀请", text:action === "accept" ? "接受后比赛会自动排到最近的友谊赛时间，并向全服玩家发送直播预告。" : "拒绝后本次邀请将关闭。", confirmText:action === "accept" ? "接受邀请" : "确认拒绝", onConfirm:() => leagueRequest("/friendlies/respond", { invitationId:friendlyRespond.dataset.friendlyInvitation, action }).then(() => { leagueInboxMessageId = null; showToast(action === "accept" ? "友谊赛已经排定" : "友谊赛邀请已拒绝"); }) });
    return;
  }
  const marketCancel = event.target.closest("[data-market-cancel]");
  if (marketCancel) leagueRequest("/market/cancel", { listingId:marketCancel.dataset.marketCancel }).then(() => showToast("挂牌已撤回")).catch((error) => showToast(error.message));
  const marketBuy = event.target.closest("[data-market-buy]");
  if (marketBuy) leagueRequest("/market/buy", { listingId:marketBuy.dataset.marketBuy }).then(() => showToast("交易完成")).catch((error) => showToast(error.message));
  const s4PackBuy = event.target.closest("[data-s4-pack-buy]");
  if (s4PackBuy) {
    const pack = league.shop.catalog.find((entry) => entry.id === s4PackBuy.dataset.s4PackBuy);
    if (pack) {
      const quantity = pack.seasonPurchaseLimit ? 1 : Math.max(1, Math.min(league.shop.maxPurchaseQuantity, Number(document.querySelector(`#s4-pack-quantity-${CSS.escape(pack.id)}`)?.value ?? 1)));
      const total = pack.price * quantity;
      openLeagueConfirm({ title:"确认购买S4礼包", text:`花费 ${total} 金币购买 ${quantity} 份${pack.name}？礼包将进入背包。`, confirmText:"确认购买", onConfirm:() => leagueRequest("/shop/buy-s4", { packType:pack.id, quantity }) });
    }
  }
});

app.addEventListener("dragstart", (event) => {
  const marketCard = event.target.closest("[data-market-drag-card], [data-market-drag-ownership]");
  if (marketCard) {
    const ownership = marketCard.matches("[data-market-drag-ownership]");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(ownership ? "text/market-ownership" : "text/market-card", ownership ? marketCard.dataset.marketDragOwnership : marketCard.dataset.marketDragCard);
    marketCard.classList.add("is-dragging");
    return;
  }
  const card = event.target.closest("[data-enhancement-card], [data-enhancement-slot-card], [data-enhancement-result-card]");
  if (!card || leagueEnhancementPhase === "scanning") return;
  const cardId = card.dataset.enhancementCard ?? card.dataset.enhancementCardId ?? card.dataset.enhancementResultCard;
  if (!cardId) return;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/enhancement-card", cardId);
  card.classList.add("is-dragging");
});

app.addEventListener("dragend", (event) => {
  event.target.closest("[data-market-drag-card], [data-market-drag-ownership]")?.classList.remove("is-dragging");
  document.querySelectorAll(".s4-market-drag-over").forEach((element) => element.classList.remove("s4-market-drag-over"));
  event.target.closest("[data-enhancement-card], [data-enhancement-slot-card], [data-enhancement-result-card]")?.classList.remove("is-dragging");
  document.querySelectorAll(".enhancement-drag-over").forEach((element) => element.classList.remove("enhancement-drag-over"));
});

app.addEventListener("dragover", (event) => {
  const marketTarget = event.target.closest("[data-market-drop-zone]");
  if (marketTarget) {
    const mime = marketTarget.dataset.marketDropZone === "ownership" ? "text/market-ownership" : "text/market-card";
    if (Array.from(event.dataTransfer.types).includes(mime)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      marketTarget.classList.add("s4-market-drag-over");
    }
    return;
  }
  const target = event.target.closest("[data-enhancement-drop], [data-enhancement-warehouse]");
  if (!target || leagueEnhancementPhase === "scanning") return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  target.classList.add("enhancement-drag-over");
});

app.addEventListener("dragleave", (event) => {
  const marketTarget = event.target.closest("[data-market-drop-zone]");
  if (marketTarget) {
    if (!marketTarget.contains(event.relatedTarget)) marketTarget.classList.remove("s4-market-drag-over");
    return;
  }
  const target = event.target.closest("[data-enhancement-drop], [data-enhancement-warehouse]");
  if (target && !target.contains(event.relatedTarget)) target.classList.remove("enhancement-drag-over");
});

app.addEventListener("drop", (event) => {
  const marketTarget = event.target.closest("[data-market-drop-zone]");
  if (marketTarget) {
    event.preventDefault();
    marketTarget.classList.remove("s4-market-drag-over");
    const kind = marketTarget.dataset.marketDropZone;
    const assetId = event.dataTransfer.getData(kind === "ownership" ? "text/market-ownership" : "text/market-card");
    if (assetId) openMarketListingDialog(kind, assetId);
    return;
  }
  const target = event.target.closest("[data-enhancement-drop], [data-enhancement-warehouse]");
  if (!target || leagueEnhancementPhase === "scanning") return;
  event.preventDefault();
  target.classList.remove("enhancement-drag-over");
  const cardId = event.dataTransfer.getData("text/enhancement-card");
  if (!cardId) return;
  if (target.matches("[data-enhancement-warehouse]")) {
    if (leagueEnhancementMainCardId === cardId) leagueEnhancementMainCardId = null;
    if (leagueEnhancementMaterialCardId === cardId) leagueEnhancementMaterialCardId = null;
    if (leagueEnhancementResult?.card?.id === cardId) leagueEnhancementResult = null;
    leagueEnhancementPhase = "idle";
    renderLeague();
    return;
  }
  const slot = target.dataset.enhancementDrop;
  if (slot === "main" || slot === "material") assignLeagueEnhancementCard(cardId, slot);
});

app.addEventListener("change", (event) => {
  if (event.target.matches("[data-card-trade-target]")) {
    leagueTradeTargetOwnerId = event.target.value;
    leagueTradeRequestedCardIds.clear();
    renderLeague();
    return;
  }
  if (event.target.matches("[data-enhancement-ranking-position]")) {
    leagueEnhancementRankingPosition = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-enhancement-ranking-grade]")) {
    leagueEnhancementRankingGrade = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-enhancement-ranking-level]")) {
    leagueEnhancementRankingLevel = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-market-filter-position]")) {
    if (event.target.dataset.marketFilterPosition === "listing") leagueMarketListingPosition = event.target.value;
    else leagueMarketWarehousePosition = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-market-filter-upgrade]")) {
    leagueMarketWarehouseUpgrade = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-enhancement-protection]")) {
    leagueEnhancementUseProtection = event.target.checked;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-backpack-stack]")) {
    leagueBackpackStacked = event.target.checked;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-enhancement-listing-filter]")) {
    leagueEnhancementListingFilter = event.target.value === "ALL" ? "ALL" : "UNLISTED";
    renderLeague();
    return;
  }
  if (event.target.matches("[data-backpack-position]")) {
    leagueBackpackPosition = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-backpack-upgrade]")) {
    leagueBackpackUpgrade = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-backpack-sort]")) {
    leagueBackpackSort = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-backpack-pack-kind]")) {
    leagueBackpackPackKind = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-backpack-pack-pool]")) {
    leagueBackpackPackPool = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-backpack-pack-source]")) {
    leagueBackpackPackSource = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-league-chemistry-toggle]")) {
    leagueShowChemistry = event.target.checked;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-league-history-team]")) {
    leagueHistoryTeamId = event.target.value;
    renderLeague();
  }
  if (event.target.matches('[name="fitnessThreshold"]')) {
    const output = document.querySelector("[data-fitness-threshold-output]");
    if (output) output.value = event.target.value;
  }
  if (event.target.closest("#league-squad-form") && event.target.matches("select, input")) scheduleLeagueTeamAutoSave(260);
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-card-trade-coins]")) {
    leagueTradeCoinAmount = event.target.value;
    return;
  }
  if (event.target.matches("[data-player-directory-search-input]")) {
    leaguePlayerSearchDraft = event.target.value;
    return;
  }
  if (event.target.matches("[data-enhancement-ranking-search]")) {
    leagueEnhancementRankingSearch = event.target.value;
    return;
  }
  if (event.target.matches("[data-backpack-pack-search]")) {
    leagueBackpackPackSearch = event.target.value;
    clearTimeout(leagueBackpackSearchTimer);
    leagueBackpackSearchTimer = setTimeout(() => {
      renderLeague();
      const input = document.querySelector("[data-backpack-pack-search]");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }, 140);
    return;
  }
  if (event.target.matches("[data-backpack-search]")) {
    return;
  }
  if (event.target.matches('[name="fitnessThreshold"]')) {
    const output = document.querySelector("[data-fitness-threshold-output]");
    if (output) output.value = event.target.value;
  }
  if (event.target.closest("#league-squad-form") && event.target.matches("select, input")) {
    scheduleLeagueTeamAutoSave(420);
    return;
  }
  if (leagueMode && event.target.closest("form")) leagueEditorDirty = true;
});

app.addEventListener("keydown", (event) => {
  if (event.target.matches("[data-enhancement-ranking-search]") && event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    leagueEnhancementRankingSearch = event.target.value;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-market-filter-search]") && event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    if (event.target.dataset.marketFilterSearch === "listing") leagueMarketListingSearch = event.target.value;
    else leagueMarketWarehouseSearch = event.target.value;
    renderLeague();
    return;
  }
  if (!event.target.matches("[data-backpack-search]") || event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  leagueBackpackSearch = event.target.value;
  renderLeague();
});

app.addEventListener("search", (event) => {
  if (event.target.matches("[data-enhancement-ranking-search]") && !event.target.value) {
    leagueEnhancementRankingSearch = "";
    renderLeague();
    return;
  }
  if (event.target.matches("[data-market-filter-search]") && !event.target.value) {
    if (event.target.dataset.marketFilterSearch === "listing") leagueMarketListingSearch = "";
    else leagueMarketWarehouseSearch = "";
    renderLeague();
    return;
  }
  if (!event.target.matches("[data-backpack-search]") || event.target.value) return;
  leagueBackpackSearch = "";
  renderLeague();
});

app.addEventListener("submit", (event) => {
  if (event.target.matches("[data-player-directory-search]")) {
    event.preventDefault();
    leaguePlayerSearchQuery = leaguePlayerSearchDraft;
    renderLeague();
    return;
  }
  if (event.target.id === "league-create-team-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    leagueRequest("/draft/start", { teamName:form.get("teamName") }).catch((error) => showToast(error.message));
    return;
  }
  if (event.target.id === "x-player-config-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const role = String(form.get("role") ?? "");
    const secondaryRole = role === "GK" ? null : String(form.get("secondaryRole") ?? "");
    leagueRequest("/draft/x-configure", { role, secondaryRole, heightCm:Number(form.get("heightCm")) }).catch((error) => showToast(error.message));
    return;
  }
  if (event.target.id === "league-team-name-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    leagueRequest("/team/rename", { teamName:form.get("teamName") }).then(() => { closeLeagueDialog(); showToast("球队名称已更新"); }).catch((error) => showToast(error.message));
    return;
  }
  if (event.target.id !== "league-squad-form") return;
  event.preventDefault();
  scheduleLeagueTeamAutoSave(0);
});

document.addEventListener("visibilitychange", () => { if (session) schedulePolling(document.hidden ? 3000 : 0); });
window.addEventListener("online", () => { connectionState = "online"; networkFailures = 0; if (session) schedulePolling(0); });
window.addEventListener("offline", () => { connectionState = "reconnecting"; updateChrome(); });

async function bootstrap() {
  try {
    const response = await fetch("/api/versus/config", { cache:"no-store" });
    const config = await response.json();
    publicHosting = Boolean(config.publicOnly);
    applyEnvironment(config);
  } catch { publicHosting = false; }
  if (account?.profile?.id && account?.accountToken) {
    try {
      const value = await api("/api/versus/profile", { method:"POST", body:{ playerId:account.profile.id, accountToken:account.accountToken } });
      storeAccount({ ...account, profile:value.profile });
    } catch {
      storeAccount(null);
      storeSession(null);
    }
  }
  if (account && !account.profile?.passwordSet) {
    authMode = "register";
    storeSession(null);
    renderAuth();
  } else if (!account) renderAuth();
  else if (session) { startRoomStream(); refresh(); }
  else renderLanding();
}

bootstrap();
setInterval(() => {
  if (!spectatorSession && (!room || room.phase === "lobby")) refreshBroadcasts();
}, 3000);
setInterval(refreshLeagueSilently, 12_000);
