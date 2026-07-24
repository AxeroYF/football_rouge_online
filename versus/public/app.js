const app = document.querySelector("#app");
const roomStatus = document.querySelector("#room-status");
const leaveButton = document.querySelector("#leave-room");
const accountStatus = document.querySelector("#account-status");
const accountLogoutButton = document.querySelector("#account-logout");
const toastElement = document.querySelector("#toast");
const SESSION_KEY = "football_test1_versus_room_v1";
const ACCOUNT_KEY = "football_test1_versus_account_v1";
const LINE_LABELS = { GK: "门将", DEF: "后场", MID: "中场", ATT: "前场" };
const ROLE_LABELS = { GK:"门将",CB:"中后卫",LB:"左后卫",RB:"右后卫",LWB:"左边翼卫",RWB:"右边翼卫",DM:"后腰",AM:"前腰",LM:"左中场",RM:"右中场",ST:"中锋",LW:"左边锋",RW:"右边锋" };
const TACTICS = { allOutAttack:"全力进攻",positive:"积极进攻",balanced:"攻守平衡",defensive:"防守反击",parkBus:"全力防守" };
const STYLES = { possession:"密集短传",longBall:"长传冲吊",wingPlay:"两翼齐飞",counterAttack:"防守反击",highPress:"高位压迫",lowBlock:"摆大巴",roughPlay:"伐木" };
const FOCUSES = { balanced:"均衡",left:"左路",center:"中路",right:"右路" };
const WEATHER_ICONS = { sunny:"☀️",rain:"🌧️",storm:"⛈️",snow:"❄️" };
const STAT_LABELS = { finishing:"射门",passing:"传球",tackling:"抢断",pace:"速度",stamina:"耐力",goalkeeping:"守门",reflexes:"反应",dribbling:"盘带" };

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
let leagueRoundPage = null;
let leagueHistoryTeamId = null;
let leagueStartingIds = null;
let leaguePositions = null;
let leagueInboxMessageId = null;
let leagueShowChemistry = true;

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
    return `<div class="history-magnet ${status ? "inactive" : ""}" style="left:${x}%;top:${y}%" title="${escapeHtml(`${player.name} · ${role} · 综合能力 ${player.overall} · 比赛评分 ${Number(player.rating).toFixed(1)}${status ? ` · ${status}` : ""}`)}"><b>${escapeHtml(player.name)}</b><small>${escapeHtml(role)}${status ? ` · ${status}` : ""}</small><span><em>能力</em>${Number(player.overall ?? 0)}</span><strong><em>评分</em>${Number(player.rating ?? 0).toFixed(1)}</strong></div>`;
  }).join("");
  return `<section class="history-team"><header><div><h3>${escapeHtml(team.name)}</h3><small>${escapeHtml(team.formation)} · ${escapeHtml(strategy)}</small></div><b>${team.stats.xg} xG · 平均评分 ${averageRating.toFixed(1)}</b></header><div class="history-pitch"><div class="pitch-lines"></div><span class="zone-label att">前场</span><span class="zone-label mid">中场</span><span class="zone-label def">后场</span><span class="zone-label gk">门将</span>${pitch}</div><div class="history-player-list">${players.map((player) => `<div><span><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.assignedRole ?? player.role] ?? player.assignedRole ?? player.role}${player.sentOff ? " · 红牌" : player.injury ? " · 伤退" : ""}</small></span><em>${player.stats.goals}球 ${player.stats.assists}助</em><span class="history-player-values"><small>能力</small><b>${Number(player.overall ?? 0)}</b></span><span class="history-player-values rating"><small>评分</small><b>${Number(player.rating ?? 0).toFixed(1)}</b></span></div>`).join("")}</div></section>`;
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
  return `<div class="pitch live-pitch broadcast-pitch"><div class="pitch-lines"></div><span class="zone-label att">前场</span><span class="zone-label mid">中场</span><span class="zone-label def">后场</span><span class="zone-label gk">门将</span>${team.players.filter((player) => player.active || player.sentOff || player.injury).map((player) => liveMagnet(player, false)).join("")}</div>`;
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
  return `<section class="broadcast-screen"><header class="broadcast-toolbar"><button class="button secondary" data-leave-broadcast>退出观赛</button><div><i>LIVE</i><b>FT1 比赛电视台</b><small>房间 ${escapeHtml(broadcast.code)} · 第 ${broadcast.round} 局</small></div><span><b>${broadcast.spectators.length} 人观看</b><small>${viewerNames}</small></span></header>${broadcast.live ? "" : `<div class="broadcast-ended">比赛已经结束，可以查看最终赛果后退出直播。</div>`}<section class="match-shell broadcast-match-shell"><header class="scoreboard"><div><small>${escapeHtml(match.teams[0].name)}</small><b>${match.score[0]}</b><em>${match.teams[0].activeCount} 人 · ${escapeHtml(match.teams[0].formation)}</em></div><span><small>${broadcast.live ? matchPhaseLabel(match) : "比赛结束"}</small><strong>${centerValue}</strong><em>${weatherIcon(match.weather)} ${escapeHtml(match.weather.name)}</em></span><div><small>${escapeHtml(match.teams[1].name)}</small><b>${match.score[1]}</b><em>${match.teams[1].activeCount} 人 · ${escapeHtml(match.teams[1].formation)}</em></div></header><div class="match-layout match-triple-layout">${broadcastTeamPanel(match.teams[0])}<section class="commentary-panel match-center-panel"><header><h2>实时战况</h2><span>${match.events.length}</span></header>${latestEvent ? `<div class="latest-event event-${latestEvent.type}"><i>${latestIcon}</i><b>${latestEvent.minute}'</b><span>${escapeHtml(latestEvent.text)}</span></div>` : ""}<div class="event-feed">${match.events.length ? [...match.events].reverse().map(matchEventMarkup).join("") : `<p class="feed-empty">比赛进行中</p>`}</div>${matchStatsMarkup(match)}</section>${broadcastTeamPanel(match.teams[1])}</div></section></section>`;
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
    scheduleSpectatorPolling(value.broadcast.live ? 350 : 1500);
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
  const value = await api(`/api/versus/league${path}`, { method:"POST", body:leagueIdentity(body) });
  league = value.league;
  renderLeague();
  return league;
}

async function openLeague() {
  leagueMode = true;
  leagueStartingIds = null;
  leaguePositions = null;
  room = null;
  storeSession(null);
  updateChrome();
  app.innerHTML = `<section class="league-loading"><p class="eyebrow">YELLOWDOGS LEAGUE</p><h1>正在读取联赛数据…</h1></section>`;
  try { await leagueRequest(""); }
  catch (error) { leagueMode = false; showToast(error.message); renderLanding(); }
}

function leagueStandingRows() {
  return league.teams.map((team) => {
    const badges = (team.championBadges ?? []).map((badge) => `<span class="champion-badge" title="${escapeHtml(`${badge.season}赛季冠军`)}"><i>♛</i>${escapeHtml(badge.season)}</span>`).join("");
    const owner = team.ownerName ? `<small>${escapeHtml(team.ownerName)} · <span class="league-owner-id">${escapeHtml(team.ownerId)}</span>${badges}</small>` : "";
    return `<tr class="${league.ownTeam?.id === team.id ? "is-own" : ""}"><td><b>${team.rank}</b></td><td><span class="club-type">${team.isAi ? "AI" : "玩家"}</span><button class="league-team-link" data-league-team-detail="${team.id}">${escapeHtml(team.name)}</button>${owner}</td><td>${team.table.played}</td><td>${team.table.won}</td><td>${team.table.drawn}</td><td>${team.table.lost}</td><td>${team.table.goalsFor}:${team.table.goalsAgainst}</td><td>${team.table.goalsFor - team.table.goalsAgainst > 0 ? "+" : ""}${team.table.goalsFor - team.table.goalsAgainst}</td><td><strong>${team.table.points}</strong></td></tr>`;
  }).join("");
}

function leagueJoinMarkup() {
  const create = league.aiSlotsRemaining > 0
    ? `<form class="league-create-team" id="league-create-team-form"><label class="field"><span>球队名称</span><input name="teamName" maxlength="30" autocomplete="off" required autofocus /></label><button class="button primary wide" type="submit">创建球队并开始选秀</button></form>`
    : `<p class="league-empty">当前10支球队都已由真人创建，新玩家将在后续扩容时加入。</p>`;
  return `<section class="league-shell league-join"><header class="league-hero"><div><p class="eyebrow">S1 · YELLOWDOGS LEAGUE</p><h1>创建你的球队</h1></div><div class="league-clock"><small>比赛时段</small><b>10:00—22:00</b><span>每20分钟一轮 · 服务器离线暂停</span></div></header><div class="league-create-shell"><div><small>CREATE A CLUB</small><h2>球队将加入当前联赛</h2><p>剩余席位 ${league.aiSlotsRemaining}/10</p></div>${create}</div><button class="button secondary" data-league-back>返回首页</button></section>`;
}

function leagueDraftMarkup() {
  const selected = league.draft.selectedPlayers;
  const counts = league.draft.counts;
  const draftPoolOrder = ["ATT", "MID", "DEF", "GK"];
  const poolButtons = draftPoolOrder.map((pool) => `<button class="league-pool-draw pool-${pool}" data-league-draw="${pool}" ${league.draft.allowedPools.includes(pool) ? "" : "disabled"}><span>${pool}</span><b>${LINE_LABELS[pool]}</b><small>翻开3张球员卡</small></button>`).join("");
  const offer = league.draft.offer.length
    ? `<div class="league-card-offer"><header><small>${LINE_LABELS[league.draft.offerPool]}候选</small><h2>从三张卡牌中签下一人</h2></header><div class="league-flip-grid">${league.draft.offer.map((player,index) => `<button class="league-flip-card" style="--delay:${index * 90}ms" data-league-choose="${player.id}"><span class="grade grade-${player.grade}">${player.grade}</span><small>${ROLE_LABELS[player.role] ?? player.role}</small><h3>${escapeHtml(player.name)}</h3><p>${escapeHtml(player.nationality)} · ${escapeHtml(player.club)}</p><strong>${player.overall}<em>能力</em></strong><b>签下球员</b></button>`).join("")}</div></div>`
    : selected.length === 22
      ? `<div class="league-draft-complete"><span>22/22</span><h2>注册名单已经选满</h2><p>确认后将接管球队并从下一轮开始比赛。</p><button class="button primary" data-league-finish>确认22人名单</button></div>`
      : `<div class="league-pool-stage"><header><small>PICK A POSITION</small><h2>选择下一次翻卡的位置</h2></header><div class="league-pool-grid">${poolButtons}</div><p>每次由服务器随机翻开3张未被真人拥有的球员卡。该模式不提供传奇保底。</p></div>`;
  const roster = selected.length ? selected.map((player,index) => `<div class="league-drafted-player"><span>${index + 1}</span><i class="grade grade-${player.grade}">${player.grade}</i><b>${escapeHtml(player.name)}<small>${ROLE_LABELS[player.role] ?? player.role}</small></b><strong>${player.overall}</strong></div>`).join("") : `<p class="league-empty">尚未签下球员</p>`;
  return `<section class="league-shell"><header class="league-work-head"><div><p class="eyebrow">22-PLAYER DRAFT · 3 CHOICES</p><h1>翻卡建立注册名单</h1></div><div class="draft-total"><small>已签下</small><b>${selected.length}<em>/22</em></b></div></header><div class="league-card-draft-layout"><main>${offer}</main><aside class="league-drafted-list"><header><div><small>MY 22</small><h2>已签球员</h2></div><button class="button secondary danger" data-league-reset ${selected.length ? "" : "disabled"}>重置</button></header><div class="league-draft-side-counts"><span>前场 <b>${counts.ATT}</b></span><span>中场 <b>${counts.MID}</b></span><span>后场 <b>${counts.DEF}</b></span><span>门将 <b>${counts.GK}</b></span></div><div class="league-drafted-roster">${roster}</div></aside></div></section>`;
}

function leagueMatchRow(match, historyTeamId = null) {
  const canOpen = match.hasDetails && (!historyTeamId || match.homeId === historyTeamId || match.awayId === historyTeamId);
  return `<button type="button" class="league-result ${match.hasPlayerTeam ? "has-player" : ""}" ${canOpen ? `data-league-match-detail="${escapeHtml(match.id)}"` : "disabled"}><span>第 ${match.round} 轮</span><b>${escapeHtml(match.homeName)}</b><strong>${match.score[0]} : ${match.score[1]}</strong><b>${escapeHtml(match.awayName)}</b><small>${canOpen ? "查看比赛 ›" : escapeHtml(match.formations?.join(" vs ") ?? "")}</small></button>`;
}

function leagueMatchCentreMarkup() {
  const rounds = league.matchRounds ?? [];
  if (!rounds.length) return `<p class="league-empty">联赛尚未进行比赛。</p>`;
  const availableRounds = rounds.map((entry) => entry.round).sort((a,b) => a - b);
  if (!availableRounds.includes(leagueRoundPage)) leagueRoundPage = availableRounds.at(-1);
  const roundIndex = availableRounds.indexOf(leagueRoundPage);
  const selectedRound = rounds.find((entry) => entry.round === leagueRoundPage);
  if (!league.teams.some((team) => team.id === leagueHistoryTeamId)) leagueHistoryTeamId = league.ownTeam.id;
  const historyTeam = league.teams.find((team) => team.id === leagueHistoryTeamId) ?? league.ownTeam;
  const history = league.recentMatches.filter((match) => match.homeId === historyTeam.id || match.awayId === historyTeam.id);
  const teamOptions = league.teams.map((team) => `<option value="${team.id}" ${team.id === historyTeam.id ? "selected" : ""}>${escapeHtml(team.name)}</option>`).join("");
  return `<div class="league-match-centre"><section><header><div><small>ROUND RESULTS</small><h3>第 ${leagueRoundPage} 轮赛果</h3></div><nav class="league-round-pager"><button class="icon-button" data-league-round="${availableRounds[roundIndex - 1] ?? ""}" ${roundIndex <= 0 ? "disabled" : ""} aria-label="上一轮">‹</button><span>${roundIndex + 1}/${availableRounds.length}</span><button class="icon-button" data-league-round="${availableRounds[roundIndex + 1] ?? ""}" ${roundIndex >= availableRounds.length - 1 ? "disabled" : ""} aria-label="下一轮">›</button></nav></header><div>${selectedRound.matches.map((match) => leagueMatchRow(match)).join("")}</div></section><section><header><div><small>TEAM HISTORY</small><h3>${escapeHtml(historyTeam.name)}历史战绩</h3></div><select data-league-history-team aria-label="选择球队">${teamOptions}</select></header><div class="league-history-list">${history.length ? history.map((match) => leagueMatchRow(match, historyTeam.id)).join("") : `<p class="league-empty">这支球队还没有比赛记录。</p>`}</div></section></div>`;
}

function leagueOverviewMarkup() {
  const report = league.report;
  return `<div class="league-dashboard-grid"><section class="league-panel standings-panel"><header><div><small>LEAGUE TABLE</small><h2>积分榜</h2></div><b>${league.season.currentRound}/${league.season.totalRounds} 轮</b></header><div class="league-table-wrap"><table class="league-table"><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进失</th><th>净胜</th><th>分</th></tr></thead><tbody>${leagueStandingRows()}</tbody></table></div></section><aside class="league-report"><header><small>DAILY REPORT</small><h2>${escapeHtml(report.headline)}</h2></header><div class="report-rank"><span>当前排名</span><b>${report.rank}<em>/10</em></b></div><dl><div><dt>赛季战绩</dt><dd>${report.record}</dd></div><div><dt>今日战绩</dt><dd>${report.today.wins}胜 ${report.today.draws}平 ${report.today.losses}负</dd></div><div><dt>积分</dt><dd>${report.points}</dd></div><div><dt>本队最佳</dt><dd>${report.bestPlayer ? `${escapeHtml(report.bestPlayer.name)} · ${report.bestPlayer.averageRating}` : "等待首场比赛"}</dd></div><div><dt>可用球员</dt><dd>${report.availability.available}/${report.availability.total}</dd></div></dl></aside><section class="league-panel recent-panel"><header><div><small>MATCH CENTRE</small><h2>赛果与球队战绩</h2></div>${league.developer && league.season.status === "active" ? `<button class="button secondary" data-league-simulate>模拟下一轮</button>` : ""}</header>${leagueMatchCentreMarkup()}</section>${leagueDailyReportMarkup(report)}</div>`;
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
  if (player.state.suspension) return `停赛 ${player.state.suspension}轮`;
  if (player.state.injuryRounds) return `伤缺 ${player.state.injuryRounds}轮`;
  return `体能 ${Math.round(player.state.fitness)}`;
}

function leaguePlayerTooltip(player, assignedRole = player.role) {
  const keys = player.pool === "GK" ? ["goalkeeping", "reflexes", "passing", "composure"] : player.pool === "DEF" ? ["tackling", "pace", "stamina", "passing"] : player.pool === "MID" ? ["passing", "dribbling", "stamina", "tackling"] : ["finishing", "pace", "dribbling", "composure"];
  const attributes = keys.map((key) => `${STAT_LABELS[key] ?? key} ${Math.round(player.attributes?.[key] ?? 0)}`).join(" · ");
  return `${player.nationality ?? ""}${player.club ? ` · ${player.club}` : ""}\n综合能力：${player.overall}\n主位置：${ROLE_LABELS[player.role] ?? player.role} · 副位置：${ROLE_LABELS[player.secondaryRole] ?? "无"}\n当前位置：${ROLE_LABELS[assignedRole] ?? assignedRole}\n身高：${Math.round(player.heightCm ?? 0)}cm · ${leaguePlayerStatus(player)}\n${attributes}`;
}

function leagueBoardMagnet(player, position, assignedRole) {
  const fit = positionFit(player, assignedRole);
  const status = leaguePlayerStatus(player);
  const tooltip = leaguePlayerTooltip(player, assignedRole);
  return `<button type="button" class="magnet league-squad-magnet grade-${player.grade.toLowerCase()} fit-${fit} ${player.state.suspension || player.state.injuryRounds ? "unavailable" : ""}" data-league-magnet="${player.id}" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}" style="left:${position.x}%;top:${position.y}%"><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[assignedRole] ?? assignedRole} · ${status}</small><i>${player.overall}</i></button>`;
}

function leagueBenchMagnet(player) {
  const tooltip = leaguePlayerTooltip(player);
  return `<button type="button" class="magnet bench-magnet league-bench-magnet grade-${player.grade.toLowerCase()} fit-primary ${player.state.suspension || player.state.injuryRounds ? "unavailable" : ""}" data-league-bench-magnet="${player.id}" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}"><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.role] ?? player.role} · ${leaguePlayerStatus(player)}</small><i>${player.overall}</i></button>`;
}

function leagueNextMatchMarkup() {
  const next = league.report?.nextOpponent;
  if (!next) return `<section class="league-next-match complete"><span>赛季赛程已完成</span><b>等待管理员开启新赛季</b></section>`;
  const startsAt = new Date(next.startsAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
  return `<section class="league-next-match"><div><small>NEXT MATCH · 第${next.round}轮</small><b>${startsAt}</b></div><div><small>${next.venue === "home" ? "主场" : "客场"}对手</small><strong>${escapeHtml(next.name)}</strong></div><div><small>天气</small><strong>${weatherIcon(next.weather)} ${escapeHtml(next.weather.name)}</strong><span>降水 ${next.weather.precipitation}% · 风力 ${next.weather.wind}</span></div><div><small>裁判尺度</small><strong>${escapeHtml(next.referee.name)}</strong><span>${escapeHtml(next.referee.description)}</span></div></section>`;
}

function leagueBackpackMarkup() {
  const offers = league.rewardOffers ?? [];
  const tiers = league.shop.tiers;
  if (!offers.length) return `<section class="league-panel league-backpack-empty"><small>PLAYER PACK INVENTORY</small><h2>背包中暂无卡包</h2><p>每轮比赛奖励和开发者邮件发放的卡包都会存放在这里。</p></section>`;
  const sections = tiers.map((tier) => {
    const tierOffers = offers.filter((offer) => (offer.tierId ?? "standard") === tier.id);
    if (!tierOffers.length) return "";
    const pools = ["ATT", "MID", "DEF", "GK"].map((pool) => {
      const poolOffers = tierOffers.filter((offer) => offer.pool === pool);
      if (!poolOffers.length) return "";
      return `<section class="backpack-pool"><header><b>${LINE_LABELS[pool]}</b><span>${poolOffers.length}份</span></header><div>${poolOffers.map((offer) => `<button type="button" class="backpack-pack tier-${tier.id}" data-league-reward-open="${offer.id}"><span>${pool}</span><b>${escapeHtml(tier.name)}</b><small>${offer.source === "admin" ? "邮件奖励" : `第${offer.round}轮奖励`}</small><em>打开卡包 ›</em></button>`).join("")}</div></section>`;
    }).join("");
    return `<section class="backpack-tier"><header><div><small>${tier.id.toUpperCase()} PACKS</small><h2>${escapeHtml(tier.name)}</h2></div><b>${tierOffers.length}份</b></header><p>${escapeHtml(tier.guarantee)}</p><div class="backpack-pool-grid">${pools}</div></section>`;
  }).join("");
  return `<section class="league-backpack"><header><div><small>PLAYER PACK INVENTORY</small><h2>球员卡包背包</h2></div><b>${offers.length}份待开启</b></header>${sections}</section>`;
}

function leagueRewardPanelMarkup() {
  return "";
}

function leagueMatchPlanMarkup(state, label, note) {
  const fallback = state === "opening" ? { tactic:league.ownTeam.tactic, style:league.ownTeam.style } : state === "leading" ? { tactic:"defensive", style:"counterAttack" } : { tactic:"positive", style:"highPress" };
  const plan = league.ownTeam.tacticalPlans?.[state] ?? fallback;
  return `<section class="league-match-plan"><header><b>${label}</b><small>${note}</small></header><label class="field"><span>比赛思路</span><select name="${state}Tactic">${Object.entries(TACTICS).map(([key,value]) => `<option value="${key}" ${plan.tactic === key ? "selected" : ""}>${value}</option>`).join("")}</select></label><label class="field"><span>战术打法</span><select name="${state}Style">${Object.entries(STYLES).map(([key,value]) => `<option value="${key}" ${plan.style === key ? "selected" : ""}>${value}</option>`).join("")}</select></label></section>`;
}

function leagueSquadMarkup() {
  const roster = league.ownTeam.roster;
  if (!leagueStartingIds || leagueStartingIds.length !== 11 || leagueStartingIds.some((id) => !roster.some((player) => player.id === id))) {
    leagueStartingIds = roster.filter((player) => player.starter).map((player) => player.id).slice(0, 11);
    leaguePositions = structuredClone(league.ownTeam.positions);
  }
  const startingSet = new Set(leagueStartingIds);
  const starters = roster.filter((player) => startingSet.has(player.id));
  const bench = roster.filter((player) => !startingSet.has(player.id));
  leaguePositions ??= structuredClone(league.ownTeam.positions);
  const shape = formationFromPositions(starters, leaguePositions);
  const magnets = starters.map((player) => leagueBoardMagnet(player, leaguePositions[player.id] ?? { x:50, y:50 }, shape.roles[player.id])).join("");
  const chemistryLines = leagueChemistryLinesMarkup(starters, leaguePositions, shape.roles);
  return `<form class="league-tactics-layout tactics-layout" id="league-squad-form">${leagueNextMatchMarkup()}<section class="board-panel league-board-panel">${pitchMarkup(`${chemistryLines}${magnets}`, "league-tactics-pitch")}<section class="tournament-bench league-bench"><header><b>替补席 · ${bench.length}人</b><small>拖动磁贴覆盖场上球员完成替换</small></header><div class="bench-magnet-list">${bench.map(leagueBenchMagnet).join("")}</div></section></section><aside class="control-panel league-plan-controls"><div class="shape-box"><span><b>${shape.valid ? "阵型有效" : "需要调整"}</b></span><strong>${shape.name}</strong></div><div class="line-counts">${Object.entries(shape.counts).map(([key,count]) => `<span>${LINE_LABELS[key]}<b>${count}</b></span>`).join("")}</div>${shape.valid ? "" : `<p class="valid-note bad">${shape.message}</p>`}<label class="chemistry-toggle"><input type="checkbox" data-league-chemistry-toggle ${leagueShowChemistry ? "checked" : ""}><span><b>默契连线</b><small>${league.ownTeam.chemistryLinks.length ? `已形成 ${league.ownTeam.chemistryLinks.length} 组默契` : "共同比赛后逐步形成"}</small></span></label><label class="league-fitness-threshold"><span><b>体力红线</b><output data-fitness-threshold-output>${league.ownTeam.fitnessThreshold ?? 65}</output></span><input type="range" name="fitnessThreshold" min="45" max="90" step="5" value="${league.ownTeam.fitnessThreshold ?? 65}"><small>低于红线时，有对应位置且体力充足的替补将自动出场。</small></label><section class="league-match-plans"><header><b>赛中战术</b><small>根据实时比分自动切换</small></header>${leagueMatchPlanMarkup("opening", "开局 / 平局", "开场与追平后")}${leagueMatchPlanMarkup("leading", "领先", "比分领先时")}${leagueMatchPlanMarkup("trailing", "落后", "比分落后时")}</section><div class="direction-fields"><label class="field"><span>主攻方向</span><select name="attackFocus">${focusOptions(league.ownTeam.attackFocus)}</select></label><label class="field"><span>主要防区</span><select name="defenseFocus">${focusOptions(league.ownTeam.defenseFocus)}</select></label></div><button class="button primary wide" type="submit" ${shape.valid ? "" : "disabled"}>保存下一轮阵容与计划</button><p class="league-auto-note">伤停与体力轮换只改变本轮实际出场阵容，不会改变你保存的主力阵容。默契只在相邻的同一阵线球员之间积累。</p>${leagueRewardPanelMarkup()}</aside></form>`;
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
  leaguePositions[benchId] = { ...(leaguePositions[starterId] ?? { x:50, y:45 }) };
  delete leaguePositions[starterId];
  renderLeague();
}

function bindLeagueSquad() {
  const pitch = document.querySelector("#league-tactics-pitch");
  document.querySelectorAll("[data-league-magnet]").forEach((magnet) => magnet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const playerId = magnet.dataset.leagueMagnet;
    const startPosition = { ...leaguePositions[playerId] };
    let moved = false;
    magnet.setPointerCapture(event.pointerId);
    magnet.classList.add("dragging");
    const move = (moveEvent) => {
      moved = true;
      const rect = pitch.getBoundingClientRect();
      const x = Math.max(8, Math.min(92, ((moveEvent.clientX - rect.left) / rect.width) * 100));
      const y = Math.max(6, Math.min(94, ((moveEvent.clientY - rect.top) / rect.height) * 100));
      leaguePositions[playerId] = { x:Math.round(x), y:Math.round(y) };
      magnet.style.left = `${x}%`; magnet.style.top = `${y}%`;
    };
    const up = () => {
      magnet.classList.remove("dragging");
      magnet.removeEventListener("pointermove", move);
      if (moved && hasMultipleGoalkeepers(leaguePositions, playerId, leaguePositions[playerId])) {
        leaguePositions[playerId] = startPosition;
        showToast("门将位置最多只能安排一名球员");
      }
      if (moved) renderLeague();
    };
    magnet.addEventListener("pointermove", move);
    magnet.addEventListener("pointerup", up, { once:true });
  }));
  document.querySelectorAll("[data-league-bench-magnet]").forEach((magnet) => magnet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const ghost = magnet.cloneNode(true);
    let target = null;
    ghost.removeAttribute("data-league-bench-magnet");
    ghost.classList.remove("bench-magnet", "league-bench-magnet");
    ghost.classList.add("bench-drag-ghost");
    document.body.appendChild(ghost);
    const move = (pointerEvent) => {
      ghost.style.left = `${pointerEvent.clientX}px`; ghost.style.top = `${pointerEvent.clientY}px`;
      const next = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest("[data-league-magnet]") ?? null;
      if (next !== target) { target?.classList.remove("swap-target"); target = next; target?.classList.add("swap-target"); }
    };
    const finish = (pointerEvent) => {
      move(pointerEvent); target?.classList.remove("swap-target"); ghost.remove();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (target) swapLeagueStarter(magnet.dataset.leagueBenchMagnet, target.dataset.leagueMagnet);
    };
    const cancel = () => {
      target?.classList.remove("swap-target"); ghost.remove();
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
  const entries = leagueStatsScope === "team" ? league.teamLeaderboards[leagueBoard] : league.leaderboards[leagueBoard];
  return `<section class="league-panel leaderboard-panel"><header><div><small>COMPETITION STATS</small><h2>${title}</h2></div><div class="league-scope-toggle"><button data-league-stats-scope="league" class="${leagueStatsScope === "league" ? "active" : ""}">全联赛</button><button data-league-stats-scope="team" class="${leagueStatsScope === "team" ? "active" : ""}">本球队</button></div></header><div class="league-board-tabs">${Object.entries(configs).map(([key,value]) => `<button type="button" data-league-board="${key}" class="${leagueBoard === key ? "active" : ""}">${value[0]}</button>`).join("")}</div><table class="league-table"><thead><tr><th>#</th><th>球员</th><th>出场</th><th>${label}</th></tr></thead><tbody>${leagueLeaderboardRows(entries, metric)}</tbody></table></section>`;
}

function leagueMarketMarkup() {
  const listings = league.listings.length ? league.listings.map((item) => `<div class="market-row"><span class="grade grade-${item.player.grade}">${item.player.grade}</span><b>${escapeHtml(item.player.name)}<small>${escapeHtml(item.sellerTeamName)} · ${ROLE_LABELS[item.player.role] ?? item.player.role} · 能力 ${item.player.overall}</small></b><strong>${item.price}<small>金币</small></strong>${item.sellerId === account.profile.id ? `<button class="button secondary" data-market-cancel="${item.id}">撤回</button>` : `<button class="button primary" data-market-buy="${item.id}">购买</button>`}</div>`).join("") : `<p class="league-empty">目前没有真人球队挂牌球员。</p>`;
  const own = league.ownTeam.roster.map((player) => `<div class="market-own-row"><b>${escapeHtml(player.name)}<small>${ROLE_LABELS[player.role] ?? player.role} · 能力 ${player.overall} · 参考 ${player.referencePrice} · 最低 ${player.minimumPrice}</small></b><input type="number" min="${player.minimumPrice}" value="${player.minimumPrice}" id="market-price-${player.id}"/><button class="button secondary" data-market-list="${player.id}" ${player.listed ? "disabled" : ""}>${player.listed ? "已挂牌" : "挂牌"}</button><button class="button secondary danger" data-market-release="${player.id}" data-release-value="${player.releaseValue}">解约</button></div>`).join("");
  return `<div class="league-market"><section class="league-panel"><header><div><small>TRANSFER MARKET</small><h2>真人交易市场</h2></div><b>${league.wallet.balance} 金币</b></header><div>${listings}</div></section><section class="league-panel"><header><div><small>SELL PLAYERS</small><h2>我的球员</h2></div><span>成交收取5%手续费</span></header><div class="market-own-list">${own}</div></section></div>`;
}

function leagueInboxMarkup() {
  const messages = league.inbox ?? [];
  if (!messages.length) return `<section class="league-panel league-inbox-empty"><h2>收件箱暂无消息</h2><p>比赛周战报、球队日报、伤停和奖励通知会发送到这里。</p></section>`;
  if (!messages.some((message) => message.id === leagueInboxMessageId)) leagueInboxMessageId = null;
  const selected = messages.find((message) => message.id === leagueInboxMessageId) ?? null;
  const typeLabels = { "daily-report":"球队日报", matchweek:"比赛周", medical:"队医报告", reward:"阶段奖励", transfer:"转会消息", lineup:"阵容轮换", notice:"联赛通知" };
  const list = messages.map((message) => {
    const time = new Date(message.createdAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
    return `<button type="button" class="league-mail-item ${message.id === selected?.id ? "active" : ""} ${message.readAt ? "read" : "unread"}" data-league-inbox-message="${escapeHtml(message.id)}"><span>${escapeHtml(typeLabels[message.type] ?? "联赛通知")}<time>${time}</time></span><b>${escapeHtml(message.title)}</b><small>${escapeHtml(message.summary)}</small></button>`;
  }).join("");
  const reader = selected ? leagueInboxDetailMarkup(selected) : `<div class="league-mail-placeholder"><b>选择一封邮件</b><p>点击左侧邮件后会标记为已读并显示完整内容。</p></div>`;
  return `<div class="league-inbox"><aside class="league-mail-list"><header><div><small>CLUB INBOX</small><h2>收件箱</h2></div><b>${messages.length}</b></header><div>${list}</div></aside><main class="league-mail-reader">${reader}</main></div>`;
}

function leagueInboxDetailMarkup(message) {
  const sentAt = new Date(message.createdAt).toLocaleString("zh-CN", { year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
  const header = `<header><div><small>${escapeHtml(sentAt)}</small><h2>${escapeHtml(message.title)}</h2><p>${escapeHtml(message.summary)}</p></div><div class="league-mail-actions">${message.matchId ? `<button type="button" class="button secondary" data-league-match-detail="${message.matchId}">查看比赛</button>` : ""}<button type="button" class="button secondary danger" data-league-inbox-delete="${escapeHtml(message.id)}">删除邮件</button></div></header>`;
  if (message.type === "daily-report" && message.report) return `${header}${leagueDailyReportMarkup(message.report)}`;
  if (message.type === "matchweek") {
    const payload = message.payload ?? {};
    const results = (payload.results ?? []).map((match) => leagueMatchRow(match, league.ownTeam.id)).join("");
    const alerts = [...(payload.injured ?? []).map((player) => `${escapeHtml(player.name)}伤缺${player.rounds}轮`), ...(payload.suspended ?? []).map((player) => `${escapeHtml(player.name)}停赛${player.rounds}轮`)];
    const next = payload.next ? `<section class="mail-next-match"><small>下一轮</small><b>${payload.next.venue === "home" ? "主场" : "客场"} · ${escapeHtml(payload.next.name)}</b><span>${weatherIcon(payload.next.weather)} ${escapeHtml(payload.next.weather.name)} · 裁判 ${escapeHtml(payload.next.referee.name)}</span></section>` : "";
    return `${header}<div class="league-mail-body"><p>${escapeHtml(message.body)}</p><div class="mail-kpis"><span><small>当前排名</small><b>${payload.rank ?? "-"}</b></span><span><small>联赛积分</small><b>${payload.points ?? "-"}</b></span><span><small>阵容提醒</small><b>${alerts.length}</b></span></div>${next}${alerts.length ? `<section class="mail-alert"><b>阵容可用性</b><p>${alerts.join("；")}</p></section>` : ""}<section class="mail-round-results"><h3>本轮全部赛果</h3>${results}</section></div>`;
  }
  return `${header}<div class="league-mail-body"><p>${escapeHtml(message.body)}</p>${message.type === "reward" && (message.payload?.offerId || message.payload?.offerIds?.length) ? `<button type="button" class="button primary" data-league-tab="backpack">前往背包查看卡包</button>` : ""}</div>`;
}

function leagueShopMarkup() {
  const offer = league.shop.offer;
  const rosterFull = league.ownTeam.roster.length >= 33;
  const pools = ["ATT", "MID", "DEF", "GK"];
  if (offer) return `<section class="league-panel league-shop"><header><div><small>OPENED PACK · ${escapeHtml(offer.tier.guarantee)}</small><h2>${escapeHtml(offer.tier.name)} · ${LINE_LABELS[offer.pool]}三选一</h2></div><b>${league.wallet.balance} 金币</b></header><div class="league-shop-offer">${offer.players.map((player,index) => `<button class="league-flip-card" style="--delay:${index * 90}ms" data-shop-choose="${player.id}"><span class="grade grade-${player.grade}">${player.grade}</span><small>${ROLE_LABELS[player.role] ?? player.role}</small><h3>${escapeHtml(player.name)}</h3><p>${escapeHtml(player.nationality)} · ${escapeHtml(player.club)}</p><strong>${player.overall}<em>能力</em></strong><b>签下球员</b></button>`).join("")}</div><p class="league-shop-note">选择一人加入球队，其余两张卡将返回公共球员池。</p></section>`;
  const tiers = league.shop.tiers.map((tier) => `<section class="league-pack-tier tier-${tier.id}"><header><div><b>${escapeHtml(tier.name)}</b><small>${escapeHtml(tier.guarantee)}</small></div><strong>${tier.price}<small>金币</small></strong></header><div class="league-pack-grid">${pools.map((pool) => `<button class="league-pack" data-shop-buy="${pool}" data-shop-tier="${tier.id}" ${rosterFull || league.wallet.balance < tier.price ? "disabled" : ""}><span>${pool}</span><div><b>${LINE_LABELS[pool]}</b><small>随机3张 · 选择1人</small></div><strong>${tier.price}<small>金币</small></strong></button>`).join("")}</div></section>`).join("");
  return `<section class="league-panel league-shop"><header><div><small>PLAYER PACKS</small><h2>球员卡包商店</h2></div><b>${league.wallet.balance} 金币</b></header><div class="league-shop-intro"><div><strong>选择卡包档位和位置</strong><span>每包翻开3名未被其他玩家拥有的球员，并从中签下1人；购买次数不限。</span></div><span>球队名单 ${league.ownTeam.roster.length}/33</span></div>${rosterFull ? `<p class="league-shop-warning">当前33人名单已满。请先在交易市场出售或解约一名球员，再购买卡包。</p>` : ""}<div class="league-tier-list">${tiers}</div></section>`;
}

function renderLeague() {
  leagueMode = true;
  updateChrome();
  if (league.draft) app.innerHTML = leagueDraftMarkup();
  else if (!league.ownTeam) app.innerHTML = leagueJoinMarkup();
  else {
    const content = leagueTab === "squad" ? leagueSquadMarkup() : leagueTab === "inbox" ? leagueInboxMarkup() : leagueTab === "backpack" ? leagueBackpackMarkup() : leagueTab === "television" ? broadcastListMarkup(true) : leagueTab === "stats" ? leagueStatsMarkup() : leagueTab === "market" ? leagueMarketMarkup() : leagueTab === "shop" ? leagueShopMarkup() : leagueOverviewMarkup();
    const teamSettings = leagueTab === "overview" ? `<form class="league-team-settings" id="league-team-name-form"><div><small>球队设置</small><b>修改球队名称</b></div><input name="teamName" maxlength="30" value="${escapeHtml(league.ownTeam.name)}" required><button class="button secondary" type="submit">保存名称</button></form>` : "";
    app.innerHTML = `<section class="league-shell"><header class="league-top"><div><p class="eyebrow">${escapeHtml(league.season.name)} · ROUND ${league.season.currentRound}/${league.season.totalRounds}</p><h1>YellowDogs League</h1></div><div class="league-team-mark"><small>${escapeHtml(account.profile.nickname)}</small><b>${escapeHtml(league.ownTeam.name)}</b><span>${league.wallet.balance} 金币</span></div></header><nav class="league-nav"><button class="${leagueTab === "overview" ? "active" : ""}" data-league-tab="overview">联赛总览</button><button class="${leagueTab === "squad" ? "active" : ""}" data-league-tab="squad">阵容战术</button><button class="${leagueTab === "inbox" ? "active" : ""}" data-league-tab="inbox">收件箱${league.inboxUnreadCount ? `<span>${league.inboxUnreadCount}</span>` : ""}</button><button class="${leagueTab === "backpack" ? "active" : ""}" data-league-tab="backpack">背包${league.rewardOffers.length ? `<span>${league.rewardOffers.length}</span>` : ""}</button><button class="${leagueTab === "television" ? "active" : ""}" data-league-tab="television">电视台</button><button class="${leagueTab === "stats" ? "active" : ""}" data-league-tab="stats">数据榜单</button><button class="${leagueTab === "shop" ? "active" : ""}" data-league-tab="shop">球员商店</button><button class="${leagueTab === "market" ? "active" : ""}" data-league-tab="market">交易市场</button></nav>${teamSettings}${content}</section>`;
    if (leagueTab === "squad") bindLeagueSquad();
    if (leagueTab === "television") refreshBroadcasts();
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
  return `<div class="league-public-pitch"><div class="pitch-lines"></div>${team.starters.map((player) => { const tooltip = leaguePlayerTooltip({ ...player, state:{ fitness:100, suspension:0, injuryRounds:0 } }, player.role); return `<button type="button" class="league-public-magnet grade-${player.grade.toLowerCase()}" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}" style="left:${player.position.x}%;top:${player.position.y}%"><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.role] ?? player.role} · ${player.overall}</small></button>`; }).join("")}</div>`;
}

async function openLeagueTeam(teamId) {
  const overlay = openLeagueDialog(`<header><div><small>CLUB PROFILE</small><h2>正在读取球队资料…</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header>`, "league-team-dialog");
  try {
    const value = await api("/api/versus/league/team/detail", { method:"POST", body:leagueIdentity({ teamId }) });
    const team = value.team;
    const history = team.history.length ? team.history.map((match) => leagueMatchRow(match, team.id)).join("") : `<p class="league-empty">还没有比赛记录。</p>`;
    overlay.querySelector(".league-dialog").innerHTML = `<header><div><small>${team.isAi ? "AI CLUB" : "PLAYER CLUB"}</small><h2>${escapeHtml(team.name)}</h2><p>${escapeHtml(team.formation ?? "阵型待定")} · ${team.table.won}胜 ${team.table.drawn}平 ${team.table.lost}负</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="league-team-detail-grid"><section><h3>当前阵型</h3>${leaguePublicPitch(team)}</section><section><h3>现有球员名单 · ${team.roster.length}人</h3><div class="league-public-roster">${team.roster.map((player) => `<div><span class="grade grade-${player.grade}">${player.grade}</span><b>${escapeHtml(player.name)}<small>${ROLE_LABELS[player.role] ?? player.role}</small></b><strong>${player.overall}</strong></div>`).join("")}</div></section></div><section class="league-team-history"><h3>历史战绩</h3>${history}</section>`;
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
  const overlay = openLeagueDialog(`<header><div><small>ROUND ${offer.round} REWARD</small><h2>${LINE_LABELS[offer.pool]}随机球员卡包</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="league-reward-choices">${offer.players.map((player,index) => `<button class="league-flip-card" style="--delay:${index * 90}ms" data-reward-choose="${player.id}"><span class="grade grade-${player.grade}">${player.grade}</span><small>${ROLE_LABELS[player.role] ?? player.role}</small><h3>${escapeHtml(player.name)}</h3><p>${escapeHtml(player.nationality)} · ${escapeHtml(player.club)}</p><strong>${player.overall}<em>能力</em></strong><b>签下球员</b></button>`).join("")}</div>`, "league-reward-dialog");
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

function pitchMarkup(content, id = "") {
  return `<div class="pitch" ${id ? `id="${id}"` : ""}><div class="pitch-lines"></div><span class="zone-label att">前场</span><span class="zone-label mid">中场</span><span class="zone-label def">后场</span><span class="zone-label gk">门将</span>${content}</div>`;
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
  return `${identity ? `${identity}\n` : ""}身高：${Math.round(player.heightCm)}cm\n主位置：${ROLE_LABELS[player.role]}\n副位置：${secondary}\n当前位置：${ROLE_LABELS[assignedRole] ?? assignedRole}\n特性：${traits}`;
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
  return player.traits.map((trait) => `${trait.name}：${trait.summary}`).join("\n") || "无特性";
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

function formationFromPositions(roster, positions) {
  const counts = { GK:0, DEF:0, MID:0, ATT:0 };
  const roles = inferAssignedRoles(roster, positions);
  roster.forEach((player) => {
    const role = roles[player.id];
    const group = role === "GK" ? "GK" : ["CB","LB","RB","LWB","RWB"].includes(role) ? "DEF" : ["DM","AM","LM","RM"].includes(role) ? "MID" : "ATT";
    counts[group] += 1;
  });
  const valid = roster.length === 11 && counts.GK === 1 && [counts.DEF, counts.MID, counts.ATT].every((count) => count >= 1);
  const message = counts.GK !== 1 ? "门将位置必须且只能有一人。" : "后场、中场、前场必须各至少一人。";
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

app.addEventListener("click", (event) => {
  const historyButton = event.target.closest("[data-history-match]");
  if (historyButton) openHistoryMatch(historyButton.dataset.historyMatch);
  const watchButton = event.target.closest("[data-watch-room]");
  if (watchButton) startWatching(watchButton.dataset.watchRoom);
  const draftDraw = event.target.closest("[data-league-draw]");
  if (draftDraw) leagueRequest("/draft/draw", { pool:draftDraw.dataset.leagueDraw }).catch((error) => showToast(error.message));
  const draftChoice = event.target.closest("[data-league-choose]");
  if (draftChoice) leagueRequest("/draft/choose", { leaguePlayerId:draftChoice.dataset.leagueChoose }).catch((error) => showToast(error.message));
  if (event.target.closest("[data-league-reset]") && window.confirm("重置后会释放已经签下的全部球员，确定重新选秀？")) leagueRequest("/draft/reset").catch((error) => showToast(error.message));
  if (event.target.closest("[data-league-finish]")) leagueRequest("/draft/finish").then(() => { leagueTab = "overview"; showToast("球队接管完成，将从下一轮开始参赛"); }).catch((error) => showToast(error.message));
  if (event.target.closest("[data-league-back]")) renderLanding();
  const leagueTabButton = event.target.closest("[data-league-tab]");
  if (leagueTabButton) {
    const nextTab = leagueTabButton.dataset.leagueTab;
    if (nextTab === "squad" && leagueTab !== "squad") { leagueStartingIds = null; leaguePositions = null; }
    leagueTab = nextTab;
    renderLeague();
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
  const leagueRound = event.target.closest("[data-league-round]");
  if (leagueRound?.dataset.leagueRound) { leagueRoundPage = Number(leagueRound.dataset.leagueRound); renderLeague(); }
  const leagueTeamDetail = event.target.closest("[data-league-team-detail]");
  if (leagueTeamDetail) openLeagueTeam(leagueTeamDetail.dataset.leagueTeamDetail);
  const leagueMatchDetail = event.target.closest("[data-league-match-detail]");
  if (leagueMatchDetail) openLeagueMatch(leagueMatchDetail.dataset.leagueMatchDetail);
  const rewardOpen = event.target.closest("[data-league-reward-open]");
  if (rewardOpen) openLeagueReward(rewardOpen.dataset.leagueRewardOpen);
  if (event.target.closest("[data-league-simulate]")) leagueRequest("/simulate").then(() => showToast("下一轮模拟完成")).catch((error) => showToast(error.message));
  const marketList = event.target.closest("[data-market-list]");
  if (marketList) { const leaguePlayerId = marketList.dataset.marketList; const price = document.querySelector(`#market-price-${CSS.escape(leaguePlayerId)}`)?.value; leagueRequest("/market/list", { leaguePlayerId, price }).then(() => showToast("球员已挂牌")).catch((error) => showToast(error.message)); }
  const marketCancel = event.target.closest("[data-market-cancel]");
  if (marketCancel) leagueRequest("/market/cancel", { listingId:marketCancel.dataset.marketCancel }).then(() => showToast("挂牌已撤回")).catch((error) => showToast(error.message));
  const marketBuy = event.target.closest("[data-market-buy]");
  if (marketBuy) leagueRequest("/market/buy", { listingId:marketBuy.dataset.marketBuy }).then(() => showToast("交易完成")).catch((error) => showToast(error.message));
  const marketRelease = event.target.closest("[data-market-release]");
  if (marketRelease && window.confirm(`解约后获得参考身价60%的金币（${marketRelease.dataset.releaseValue}金币），确定继续？`)) leagueRequest("/player/release", { leaguePlayerId:marketRelease.dataset.marketRelease }).then(() => showToast("球员已解约")).catch((error) => showToast(error.message));
  const shopBuy = event.target.closest("[data-shop-buy]");
  if (shopBuy) {
    const tier = league.shop.tiers.find((entry) => entry.id === shopBuy.dataset.shopTier);
    if (tier) openLeagueConfirm({ title:"确认购买卡包", text:`花费 ${tier.price} 金币购买${tier.name}（${LINE_LABELS[shopBuy.dataset.shopBuy]}）？`, confirmText:"购买并开包", onConfirm:() => leagueRequest("/shop/buy", { pool:shopBuy.dataset.shopBuy, tierId:tier.id }) });
  }
  const shopChoice = event.target.closest("[data-shop-choose]");
  if (shopChoice) leagueRequest("/shop/choose", { leaguePlayerId:shopChoice.dataset.shopChoose }).then(() => showToast("新球员已加入注册名单")).catch((error) => showToast(error.message));
});

app.addEventListener("change", (event) => {
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
});

app.addEventListener("submit", (event) => {
  if (event.target.id === "league-create-team-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    leagueRequest("/draft/start", { teamName:form.get("teamName") }).catch((error) => showToast(error.message));
    return;
  }
  if (event.target.id === "league-team-name-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    leagueRequest("/team/rename", { teamName:form.get("teamName") }).then(() => showToast("球队名称已更新")).catch((error) => showToast(error.message));
    return;
  }
  if (event.target.id !== "league-squad-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  leagueRequest("/team", { starterIds:leagueStartingIds, positions:leaguePositions, fitnessThreshold:form.get("fitnessThreshold"), tacticalPlans:{ opening:{ tactic:form.get("openingTactic"), style:form.get("openingStyle") }, leading:{ tactic:form.get("leadingTactic"), style:form.get("leadingStyle") }, trailing:{ tactic:form.get("trailingTactic"), style:form.get("trailingStyle") } }, attackFocus:form.get("attackFocus"), defenseFocus:form.get("defenseFocus") }).then(() => showToast("下一轮阵容、体力红线和赛中战术已保存")).catch((error) => showToast(error.message));
});

document.addEventListener("visibilitychange", () => { if (session) schedulePolling(document.hidden ? 3000 : 0); });
window.addEventListener("online", () => { connectionState = "online"; networkFailures = 0; if (session) schedulePolling(0); });
window.addEventListener("offline", () => { connectionState = "reconnecting"; updateChrome(); });

async function bootstrap() {
  try {
    const response = await fetch("/api/versus/config", { cache:"no-store" });
    const config = await response.json();
    publicHosting = Boolean(config.publicOnly);
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
