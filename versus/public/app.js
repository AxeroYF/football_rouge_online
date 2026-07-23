const app = document.querySelector("#app");
const roomStatus = document.querySelector("#room-status");
const leaveButton = document.querySelector("#leave-room");
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
  roomStatus.hidden = !active;
  leaveButton.hidden = !active;
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
      ? `<button class="history-row" data-history-match="${escapeHtml(match.id)}"><span><b>${escapeHtml(match.opponentName)}</b><small>${new Date(match.playedAt).toLocaleDateString()} · ${match.goals}球 ${match.assists}助 · 点击查看详情</small></span><strong class="result-${match.result}">${match.scoreFor}:${match.scoreAgainst}<small>查看 ›</small></strong></button>`
      : `<div class="history-row history-row-legacy"><span><b>${escapeHtml(match.opponentName)}</b><small>${new Date(match.playedAt).toLocaleDateString()} · ${match.goals}球 ${match.assists}助 · 旧版记录</small></span><strong class="result-${match.result}">${match.scoreFor}:${match.scoreAgainst}</strong></div>`).join("")
    : `<p class="history-empty">还没有比赛记录，完成第一场后会自动统计。</p>`;
  return `<section class="account-history"><header><div><h2>${escapeHtml(profile.nickname)} <small>@${escapeHtml(profile.id)}</small></h2></div><b>${summary.wins}胜 ${summary.losses}负</b></header><div class="career-stats"><span>场次<b>${summary.played}</b></span><span>进球<b>${summary.goals}</b></span><span>助攻<b>${summary.assists}</b></span><span>总比分<b>${summary.goalsFor}:${summary.goalsAgainst}</b></span></div><div class="history-list">${recent}</div></section>`;
}

function historyTeamMarkup(team) {
  const strategy = `${TACTICS[team.tactic] ?? team.tactic} · ${STYLES[team.style] ?? team.style} · 主攻${FOCUSES[team.attackFocus] ?? team.attackFocus} · 主守${FOCUSES[team.defenseFocus] ?? team.defenseFocus}`;
  const players = [...team.players].sort((left, right) => right.rating - left.rating);
  return `<section class="history-team"><header><div><h3>${escapeHtml(team.name)}</h3><small>${escapeHtml(team.formation)} · ${escapeHtml(strategy)}</small></div><b>${team.stats.xg} xG</b></header><div class="history-player-list">${players.map((player) => `<div><span><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.role] ?? player.role}${player.sentOff ? " · 红牌" : player.injury ? " · 伤退" : ""}</small></span><em>${player.stats.goals}球 ${player.stats.assists}助</em><strong>${Number(player.rating).toFixed(1)}</strong></div>`).join("")}</div></section>`;
}

function historyMatchMarkup(detail) {
  const viewerIndex = Number(detail.viewerIndex ?? 0);
  const opponentIndex = viewerIndex === 0 ? 1 : 0;
  const displayScore = detail.aggregateScore ?? detail.score;
  const won = detail.winnerIndex === viewerIndex;
  const timeline = detail.importantEvents?.length ? detail.importantEvents.map(reportTimelineItem).join("") : `<p class="history-empty">本场没有重点事件。</p>`;
  return `<header class="history-detail-head"><button class="icon-button" data-close-history aria-label="关闭">×</button><div><small>${new Date(detail.playedAt).toLocaleString()} · 房间 ${escapeHtml(detail.roomCode)} · 第 ${detail.round} 局</small><h2>${won ? "本场获胜" : "本场失利"}</h2></div></header><div class="history-detail-score"><span>${escapeHtml(detail.teams[viewerIndex].name)}</span><b>${displayScore[viewerIndex]} : ${displayScore[opponentIndex]}</b><span>${escapeHtml(detail.teams[opponentIndex].name)}</span>${detail.aggregateBaseScore ? `<small>首回合 ${detail.aggregateBaseScore[viewerIndex]}:${detail.aggregateBaseScore[opponentIndex]} · 第二回合 ${detail.score[viewerIndex]}:${detail.score[opponentIndex]}</small>` : ""}${detail.penalties ? `<small>点球 ${detail.penalties[viewerIndex]} : ${detail.penalties[opponentIndex]}</small>` : ""}<em>${weatherIcon(detail.weather)} ${escapeHtml(detail.weather?.name ?? "未知天气")}</em></div><div class="history-detail-grid"><section class="report-panel timeline-panel"><h2>重点事件</h2><div class="match-timeline">${timeline}</div></section><section class="report-panel compact-stats-panel"><h2>比赛统计</h2>${matchStatsMarkup(detail, [viewerIndex, opponentIndex])}</section></div><div class="history-team-grid">${[viewerIndex, opponentIndex].map((index) => historyTeamMarkup(detail.teams[index])).join("")}</div>`;
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

function broadcastListMarkup() {
  const matches = liveBroadcasts.length
    ? liveBroadcasts.map((broadcast) => `<button class="broadcast-card" data-watch-room="${escapeHtml(broadcast.code)}"><span><i>LIVE</i><small>${broadcast.minute}' · ${weatherIcon(broadcast.weather)} ${escapeHtml(broadcast.weather?.name ?? "比赛中")}</small></span><div><b>${escapeHtml(broadcast.teams[0].name)}</b><strong>${broadcast.score[0]} : ${broadcast.score[1]}</strong><b>${escapeHtml(broadcast.teams[1].name)}</b></div><em>${broadcast.spectatorCount} 人正在观看 · 进入直播 ›</em></button>`).join("")
    : `<p class="broadcast-empty">当前没有正在进行的公开比赛。</p>`;
  return `<section class="broadcast-hub"><header><div><small>FT1 TELEVISION</small><h2>比赛电视台</h2></div><b>${liveBroadcasts.length} 场直播</b></header><div class="broadcast-list">${matches}</div></section>`;
}

async function refreshBroadcasts() {
  if (spectatorSession) return;
  try {
    const value = await api("/api/versus/broadcasts");
    liveBroadcasts = value.broadcasts ?? [];
    const hub = document.querySelector(".broadcast-hub");
    if (hub) hub.outerHTML = broadcastListMarkup();
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
  const name = document.querySelector("#player-name")?.value.trim() ?? account?.profile?.nickname ?? "";
  const value = await api("/api/versus/identity", { method:"POST", body:{ name, accountToken:account?.accountToken ?? null } });
  storeAccount({ accountToken:value.accountToken, profile:value.profile });
  return { playerId:value.profile.id, accountToken:value.accountToken, name:name || value.profile.nickname };
}

function renderLanding() {
  room = null;
  updateChrome();
  const developerControls = publicHosting ? "" : `<div class="divider">开发者测试</div><div class="developer-actions"><button class="button secondary" id="dev-full-flow">单人完整流程</button><button class="button secondary" id="dev-quick-start">快速进入比赛</button></div>`;
  app.innerHTML = `<section class="landing"><div class="landing-copy"><h1>选出你的十一人，<span>和好友正面对决。</span></h1>${profileMarkup()}</div><section class="room-console"><h2>好友对战</h2><label class="field"><span>昵称</span><input id="player-name" maxlength="18" autocomplete="nickname" value="${escapeHtml(account?.profile?.nickname ?? "")}" placeholder="输入昵称" /></label>${account?.profile ? `<p class="bound-player-id">玩家ID <b>${escapeHtml(account.profile.id)}</b></p>` : ""}<label class="field"><span>自定义分享码</span><input id="custom-room-code" maxlength="20" autocomplete="off" placeholder="可选，至少6位" /></label><div class="competition-create"><button class="button primary wide" id="create-room">快速比赛<small>一回合决胜</small></button><button class="button secondary wide" id="create-tournament">锦标赛<small>两回合 · 次回合补强</small></button></div><div class="divider">加入已有房间</div><label class="field"><span>分享码</span><input id="room-code" maxlength="20" autocomplete="off" placeholder="输入分享码" /></label><button class="button secondary wide" id="join-room">加入房间</button>${developerControls}</section></section>`;
  document.querySelector(".landing-copy")?.insertAdjacentHTML("beforeend", broadcastListMarkup());
  refreshBroadcasts();
  document.querySelector("#create-room").onclick = () => createRoom("quick");
  document.querySelector("#create-tournament").onclick = () => createRoom("tournament");
  document.querySelector("#join-room").onclick = () => joinRoom();
  const fullFlowButton = document.querySelector("#dev-full-flow");
  const quickStartButton = document.querySelector("#dev-quick-start");
  if (fullFlowButton) fullFlowButton.onclick = () => createDeveloperRoom(false);
  if (quickStartButton) quickStartButton.onclick = () => createDeveloperRoom(true);
  document.querySelector("#room-code").oninput = (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""); };
  document.querySelector("#custom-room-code").oninput = (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""); };
}

async function createDeveloperRoom(quickStart) {
  try {
    const value = await api("/api/versus/dev-room", { method:"POST", body:{ name:document.querySelector("#player-name").value || "开发者",quickStart } });
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
  return `<button class="player-card grade-${player.grade.toLowerCase()}" data-player-choice="${player.id}" data-rating="${player.overall}"><div class="card-top"><span class="rating">${player.overall}</span><span class="position">${player.grade} · ${ROLE_LABELS[player.role]}</span></div><h3>${escapeHtml(player.name)}</h3><p>${identity || `副位置 ${ROLE_LABELS[player.secondaryRole] ?? "无"}`} · ${Math.round(player.heightCm)}cm</p><div class="stat-row">${playerStats(player)}</div><span class="card-action">选择球员</span></button>`;
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

function liveMagnet(player, editable, useLocalPosition = false) {
  const position = useLocalPosition ? (localPositions?.[player.id] ?? player.position ?? { x:50,y:50 }) : (player.position ?? { x:50,y:50 });
  const status = player.sentOff ? "红牌" : player.injury ? "伤退" : "";
  const tooltip = playerTooltip(player, player.assignedRole);
  return `<button class="magnet live-magnet grade-${String(player.grade ?? "C").toLowerCase()} rating-${Math.floor(player.rating)} ${status ? "inactive" : ""}" data-live-magnet="${player.id}" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}" style="left:${position.x}%;top:${position.y}%" ${editable && player.active ? "" : "disabled"}>${liveStatusMarkers(player)}<b>${escapeHtml(player.name)}</b><small>${status || `${ROLE_LABELS[player.assignedRole] ?? player.assignedRole} · 体能 ${Math.round(player.fitness)}`}</small><i class="live-rating">${player.rating.toFixed(1)}</i></button>`;
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
  return `<div class="pitch live-pitch ${own ? "own-live-pitch" : "opponent-live-pitch"}" id="${own ? "live-pitch" : "opponent-live-pitch"}"><div class="pitch-lines"></div><span class="zone-label att">前场</span><span class="zone-label mid">中场</span><span class="zone-label def">后场</span><span class="zone-label gk">门将</span>${team.players.filter((player) => player.active || player.sentOff || player.injury).map((player) => liveMagnet(player, own && paused && !submitted, own)).join("")}${paused ? `<div class="pause-ribbon"><b>${pauseTitle}</b><strong>${clockText(room.match.pause.remainingMs)}</strong><small>${pauseNote}</small></div>` : ""}</div>`;
}

function liveTeamPanel(team, options = {}) {
  const { own = false, adjusting = false, canPause = false } = options;
  const title = own
    ? `${TACTICS[team.tactic]} · ${STYLES[team.style]} · 适配 ${Math.round(team.styleFit * 100)}%`
    : "对方比赛策略保密";
  const opponent = room.match.teams[room.viewerIndex === 0 ? 1 : 0];
  const markingOptions = opponent.players.filter((player) => player.active).map((player) => `<option value="${escapeHtml(player.id)}" ${localMarkingTargetId === player.id ? "selected" : ""}>${escapeHtml(player.name)} · ${ROLE_LABELS[player.assignedRole] ?? player.assignedRole} · ${player.rating.toFixed(1)}</option>`).join("");
  const submitted = Boolean(room.match.pause?.submitted?.[room.viewerIndex]);
  return `<section class="live-team-panel ${own ? "own-team-panel" : "opponent-team-panel"}"><header><div><h2>${escapeHtml(team.name)}${team.importedLineup ? `<span class="lineup-origin-badge">自带阵容</span>` : ""}</h2><small>${team.formation} · ${team.activeCount} 人</small></div>${own ? `<button class="button pause-button" id="pause-match" ${canPause ? "" : "disabled"}>${room.match.pauseUsed[room.viewerIndex] ? "暂停已使用" : room.match.pause ? "调整中" : "战术暂停"}</button>` : `<span class="strategy-private">${title}</span>`}</header>${livePitchMarkup(team, { own, paused:Boolean(room.match.pause) })}${own && !adjusting ? `<footer>${title} · 主攻${FOCUSES[team.attackFocus]} · 主守${FOCUSES[team.defenseFocus]}</footer>` : ""}${adjusting && own ? `<div class="pause-move-hint">拖动球员并调整双方策略；完整保留 30 秒</div><div class="live-tactic-controls"><label class="field"><span>比赛思路</span><select id="live-tactic-select" ${submitted ? "disabled" : ""}>${Object.entries(TACTICS).map(([key,label]) => `<option value="${key}" ${localTactic === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>比赛战术</span><select id="live-style-select" ${submitted ? "disabled" : ""}>${Object.entries(STYLES).map(([key,label]) => `<option value="${key}" ${localStyle === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>主攻方向</span><select id="live-attack-focus" ${submitted ? "disabled" : ""}>${focusOptions(localAttackFocus)}</select></label><label class="field"><span>主守方向</span><select id="live-defense-focus" ${submitted ? "disabled" : ""}>${focusOptions(localDefenseFocus)}</select></label><label class="field marking-target-field"><span>重点盯防</span><select id="live-marking-select" ${submitted ? "disabled" : ""}><option value="">不设置</option>${markingOptions}</select></label><button class="button primary" id="apply-live-tactics" ${submitted ? "disabled" : ""}>${submitted ? "已提交，等待继续" : "提交本次调整"}</button></div>` : ""}</section>`;
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
    magnet.setPointerCapture(event.pointerId);
    magnet.classList.add("dragging");
    const move = (moveEvent) => {
      const rect = pitch.getBoundingClientRect();
      const x = Math.max(8,Math.min(92,((moveEvent.clientX-rect.left)/rect.width)*100));
      const y = Math.max(6,Math.min(94,((moveEvent.clientY-rect.top)/rect.height)*100));
      localPositions[playerId] = { x:Math.round(x),y:Math.round(y) };
      magnet.style.left = `${x}%`; magnet.style.top = `${y}%`;
    };
    const up = () => { draggingMagnet = false; magnet.classList.remove("dragging"); magnet.removeEventListener("pointermove",move); magnet.removeEventListener("pointerup",up); if (hasMultipleGoalkeepers(localPositions, playerId, localPositions[playerId])) { localPositions[playerId] = startPosition; showToast("门将位置最多只能安排一名球员"); renderMatch(); } };
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

async function refresh() {
  if (!session) return;
  if (roomMutationPending) return schedulePolling(100);
  const requestEpoch = roomStateEpoch;
  try {
    const value = await api(`/api/versus/rooms/${session.code}`);
    if (requestEpoch !== roomStateEpoch || roomMutationPending) return;
    networkFailures = 0;
    connectionState = "online";
    const previousPhase = room?.phase;
    const previousUpdatedAt = room?.updatedAt;
    room = value.room;
    if (room.profile && account) storeAccount({ ...account, profile:room.profile });
    if (previousPhase !== room.phase) { localPositions = null; localStartingIds = null; localTactic = ownPlayer()?.tactic ?? "balanced"; localStyle = ownPlayer()?.style ?? "possession"; localAttackFocus = ownPlayer()?.attackFocus ?? "balanced"; localDefenseFocus = ownPlayer()?.defenseFocus ?? "balanced"; }
    const roomChanged = previousPhase !== room.phase || previousUpdatedAt !== room.updatedAt || room.phase === "match";
    if (!draggingMagnet && !controlInteraction && roomChanged) render();
    else if (!roomChanged) {
      const timer = document.querySelector(".phase-timer b");
      if (timer && room.timer) timer.textContent = clockText(room.timer.remainingMs);
    }
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
  schedulePolling(200);
}

leaveButton.onclick = () => { clearTimeout(polling); storeSession(null); room = null; localPositions = null; localStartingIds = null; localTactic = "balanced"; localStyle = "possession"; localAttackFocus = "balanced"; localDefenseFocus = "balanced"; lineupSeedInput = ""; exportedLineupCode = ""; renderLanding(); };

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
  if (session) refresh(); else renderLanding();
}

bootstrap();
setInterval(() => {
  if (!spectatorSession && (!room || room.phase === "lobby")) refreshBroadcasts();
}, 3000);
