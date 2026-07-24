const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const logoutButton = document.querySelector("#logout");
const TOKEN_KEY = "ft1-admin-session";
const TACTICS = { allOutAttack:"全力进攻",positive:"积极进攻",balanced:"攻守平衡",defensive:"防守反击",parkBus:"全力防守" };
const STYLES = { possession:"密集短传",longBall:"长传冲吊",wingPlay:"两翼齐飞",counterAttack:"防守反击",highPress:"高位压迫",lowBlock:"摆大巴",roughPlay:"伐木" };
const ROLES = { GK:"门将",CB:"中后卫",LB:"左后卫",RB:"右后卫",LWB:"左边翼卫",RWB:"右边翼卫",DM:"后腰",AM:"前腰",LM:"左中场",RM:"右中场",ST:"中锋",LW:"左边锋",RW:"右边锋" };
let token = sessionStorage.getItem(TOKEN_KEY);
let dashboard = null;
let competitionTab = "formations";
let leagueData = null;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;" })[character]);
const dateText = (value) => value ? new Date(Number(value)).toLocaleString() : "—";
const shortDate = (value) => value ? new Date(Number(value)).toLocaleDateString() : "—";

async function api(path, options = {}) {
  const response = await fetch(path, { method:options.method ?? "GET",headers:{ "content-type":"application/json",...(token ? { authorization:`Bearer ${token}` } : {}) },body:options.body ? JSON.stringify(options.body) : undefined,cache:"no-store" });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error ?? "请求失败"), { status:response.status });
  return value;
}

function renderLogin(message = "") {
  token = null; sessionStorage.removeItem(TOKEN_KEY); logoutButton.hidden = true;
  app.innerHTML = `<section class="login-shell"><form class="login-card" id="login-form"><small>SECURE ACCESS</small><h1>管理员登录</h1><p>玩家与比赛数据仅对管理员开放。</p><label>管理密码<input id="password" type="password" autocomplete="current-password" required autofocus /></label><button>进入后台</button><p class="login-error" id="login-error">${escapeHtml(message)}</p></form></section>`;
  document.querySelector("#login-form").onsubmit = async (event) => {
    event.preventDefault(); const error = document.querySelector("#login-error"); error.textContent = "正在验证…";
    try { const value = await api("/api/admin/login", { method:"POST",body:{ password:document.querySelector("#password").value } }); token = value.token; sessionStorage.setItem(TOKEN_KEY, token); await loadDashboard(); }
    catch (reason) { error.textContent = reason.message; }
  };
}

function competitionRows() {
  const labels = competitionTab === "formations" ? {} : competitionTab === "tactics" ? TACTICS : STYLES;
  return dashboard[competitionTab].map((row) => `<tr><td><b>${escapeHtml(labels[row.key] ?? row.key)}</b><small>${escapeHtml(row.key)}</small></td><td>${row.matches}</td><td class="rate-cell"><strong>${row.winRate}%</strong><div class="rate"><i style="width:${row.winRate}%"></i></div></td><td>${row.goalsForPerMatch}</td><td>${row.goalsAgainstPerMatch}</td></tr>`).join("");
}

function renderCompetitionTable() {
  document.querySelector("#competition-body").innerHTML = competitionRows() || `<tr><td colspan="5">暂无完整比赛数据</td></tr>`;
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === competitionTab));
}

function playerRows(players) {
  return players.map((player) => `<tr data-player="${escapeHtml(player.id)}"><td><b>${escapeHtml(player.nickname)}</b><small>${escapeHtml(player.id)}</small></td><td>${player.summary?.played ?? 0}</td><td><strong>${player.summary?.wins ?? 0}</strong> / ${player.summary?.losses ?? 0}</td><td>${player.summary?.goals ?? 0}</td><td>${player.summary?.assists ?? 0}</td><td>${dateText(player.lastSeenAt)}</td></tr>`).join("");
}

function matchRows(matches) {
  return matches.map((match) => { const teams = match.teams ?? []; return `<button class="match-row" data-match="${escapeHtml(match.id)}"><time>${shortDate(match.playedAt)}</time><span><b>${escapeHtml(teams[0]?.name ?? match.roomCode)} vs ${escapeHtml(teams[1]?.name ?? "历史对手")}</b><small>${teams.length ? `${escapeHtml(teams[0].formation)} · ${escapeHtml(teams[1].formation)}` : "旧版比赛记录"}</small></span><strong>${match.score?.[0] ?? 0}:${match.score?.[1] ?? 0}</strong></button>`; }).join("");
}

function bindDashboard() {
  document.querySelector("#refresh").onclick = loadDashboard;
  document.querySelectorAll("[data-tab]").forEach((button) => { button.onclick = () => { competitionTab = button.dataset.tab; renderCompetitionTable(); }; });
  const search = document.querySelector("#player-search");
  search.oninput = () => { const term = search.value.trim().toLowerCase(); const players = dashboard.players.filter((player) => `${player.nickname} ${player.id}`.toLowerCase().includes(term)); document.querySelector("#players-body").innerHTML = playerRows(players); bindPlayerRows(); };
  bindPlayerRows(); bindMatchRows(); bindAdminNav();
}

function adminNavMarkup(active) {
  return `<nav class="admin-section-nav"><button data-admin-view="dashboard" class="${active === "dashboard" ? "active" : ""}">运营总览</button><button data-admin-view="league" class="${active === "league" ? "active" : ""}">黄狗联赛</button></nav>`;
}

function bindAdminNav() {
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    button.onclick = () => button.dataset.adminView === "league" ? loadLeagueAdmin() : loadDashboard();
  });
}

function bindPlayerRows() { document.querySelectorAll("[data-player]").forEach((row) => { row.onclick = () => openPlayer(row.dataset.player); }); }
function bindMatchRows() { document.querySelectorAll("[data-match]").forEach((row) => { row.onclick = () => openMatch(row.dataset.match); }); }

function renderDashboard() {
  const value = dashboard.overview;
  logoutButton.hidden = false;
  app.innerHTML = `<header class="page-head"><div><h1>运营总览</h1><p>注册玩家、历史比赛与竞技平衡数据</p></div><button id="refresh">刷新数据</button></header><section class="kpis"><article class="kpi"><small>注册玩家</small><b>${value.registeredPlayers}</b></article><article class="kpi"><small>7日活跃</small><b>${value.activePlayers7d}</b></article><article class="kpi"><small>独立比赛</small><b>${value.matches}</b></article><article class="kpi"><small>场均进球</small><b>${value.averageGoals}</b></article><article class="kpi"><small>黑哨事件</small><b>${value.blackWhistles}</b></article></section><div class="grid"><section class="panel"><header class="panel-head"><div><h2>竞技统计</h2><small>每场比赛仅统计一次，主客双方各计一个阵型样本</small></div><div class="tabs"><button data-tab="formations">阵型</button><button data-tab="tactics">思路</button><button data-tab="styles">战术</button></div></header><div class="table-wrap"><table><thead><tr><th>项目</th><th>场次</th><th>胜率</th><th>进球</th><th>失球</th></tr></thead><tbody id="competition-body">${competitionRows()}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>最近比赛</h2><small>${value.detailedMatches} 场含完整详情</small></div></header><div class="match-list">${matchRows(dashboard.matches) || `<p class="empty">暂无比赛</p>`}</div></section><section class="panel" style="grid-column:1/-1"><header class="panel-head"><div><h2>玩家管理</h2><small>不展示任何账号登录凭证</small></div><input class="search" id="player-search" placeholder="搜索昵称或玩家ID" /></header><div class="table-wrap"><table><thead><tr><th>玩家</th><th>场次</th><th>胜/负</th><th>进球</th><th>助攻</th><th>最后活跃</th></tr></thead><tbody id="players-body">${playerRows(dashboard.players)}</tbody></table></div></section></div>`;
  app.insertAdjacentHTML("afterbegin", adminNavMarkup("dashboard"));
  renderCompetitionTable(); bindDashboard();
}

async function loadDashboard() {
  app.innerHTML = `<section class="loading">正在读取玩家与比赛数据…</section>`;
  try { dashboard = (await api("/api/admin/dashboard")).dashboard; renderDashboard(); }
  catch (error) { if (error.status === 401) renderLogin("登录已失效，请重新输入密码"); else app.innerHTML = `<section class="loading">${escapeHtml(error.message)}</section>`; }
}

const LEAGUE_POOL_LABELS = { ATT:"前场", MID:"中场", DEF:"后场", GK:"门将" };
const CHAMPION_BADGE_SEASONS = ["S0", "S1", "S2"];

function leagueTeamRows() {
  return leagueData.teams.map((team) => `<tr><td><strong>${team.rank}</strong></td><td><b>${escapeHtml(team.name)}</b><small>${team.isAi ? "AI 球队" : `${escapeHtml(team.ownerName)} · ${escapeHtml(team.ownerId)}`}</small></td><td>${team.rosterCount}/33</td><td>${team.table.played}</td><td>${team.table.won}-${team.table.drawn}-${team.table.lost}</td><td>${team.table.goalsFor}:${team.table.goalsAgainst}</td><td><strong>${team.table.points}</strong></td></tr>`).join("");
}

function leagueAllocationRows(entries = leagueData.allocations) {
  return entries.map((player) => `<tr><td><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.id)}</small></td><td>${LEAGUE_POOL_LABELS[player.pool]} · ${escapeHtml(ROLES[player.role] ?? player.role)}</td><td>${player.overall}</td><td>${player.status === "owned" ? "正式签约" : "选秀保留"}</td><td><b>${escapeHtml(player.teamName)}</b><small>${escapeHtml(player.ownerName ?? "尚未完成选秀")}</small></td></tr>`).join("") || `<tr><td colspan="5">当前没有真人球队占用球员</td></tr>`;
}

function renderLeagueAdmin() {
  const season = leagueData.season;
  const humanTeams = leagueData.teams.filter((team) => !team.isAi).length;
  const poolRows = Object.entries(leagueData.pools).map(([pool, value]) => `<tr><td><b>${LEAGUE_POOL_LABELS[pool]}</b><small>${pool}</small></td><td>${value.total}</td><td><strong>${value.selected}</strong></td><td>${value.drafting}</td><td>${value.available}</td></tr>`).join("");
  const drafts = leagueData.drafts.map((draft) => `<tr><td><b>${escapeHtml(draft.teamName)}</b><small>${escapeHtml(draft.accountId)}</small></td><td>${draft.selectedCount}/22</td><td>${dateText(draft.startedAt)}</td></tr>`).join("") || `<tr><td colspan="3">当前没有进行中的选秀</td></tr>`;
  const archives = leagueData.archives.slice().reverse().map((archive) => `<tr><td><b>${escapeHtml(archive.season.name)}</b><small>${escapeHtml(archive.season.id)}</small></td><td>${archive.reason === "new-season" ? "开启新赛季" : "重启赛季"}</td><td>${archive.season.currentRound}/${archive.season.totalRounds}</td><td>${archive.matchCount}</td><td>${dateText(archive.archivedAt)}</td></tr>`).join("") || `<tr><td colspan="5">尚无赛季归档</td></tr>`;
  const backupRows = leagueData.backups.files.map((name) => `<tr><td><b>${escapeHtml(name)}</b></td><td>${name.startsWith("before-full-reset-") ? "完全重置前快照" : "每日自动备份"}</td></tr>`).join("") || `<tr><td colspan="2">首次保存联赛数据后生成备份</td></tr>`;
  const rewardRoundOptions = Array.from({ length:season.totalRounds }, (_, index) => index + 1).map((round) => `<option value="${round}" ${round === Math.min(season.totalRounds, season.currentRound + 1) ? "selected" : ""}>第 ${round} 轮${round <= season.currentRound ? "（立即补发）" : ""}</option>`).join("");
  const rewardTierOptions = leagueData.packTiers.map((tier) => `<option value="${tier.id}">${escapeHtml(tier.name)} · ${escapeHtml(tier.guarantee)}</option>`).join("");
  const rewardGrantRows = leagueData.rewardGrants.map((grant) => `<tr><td><b>第 ${grant.round} 轮</b><small>${escapeHtml(grant.id)}</small></td><td>${LEAGUE_POOL_LABELS[grant.pool]} · ${escapeHtml(leagueData.packTiers.find((tier) => tier.id === grant.tierId)?.name ?? grant.tierId)}</td><td>${grant.status === "sent" ? "已发送" : "等待轮次"}</td><td>${grant.status === "sent" ? `${grant.recipientCount} 成功 / ${grant.failedCount} 失败` : "-"}</td><td>${dateText(grant.sentAt ?? grant.createdAt)}</td></tr>`).join("") || `<tr><td colspan="5">尚未安排全服卡包邮件</td></tr>`;
  const badgePlayerOptions = leagueData.teams.filter((team) => !team.isAi).map((team) => `<option value="${escapeHtml(team.ownerId)}">${escapeHtml(team.ownerName)} · ${escapeHtml(team.name)} · ${escapeHtml(team.ownerId)}</option>`).join("");
  const badgeRows = leagueData.teams.flatMap((team) => (team.championBadges ?? []).map((badge) => ({ ...badge, ownerId:team.ownerId, ownerName:team.ownerName, teamName:team.name }))).sort((left,right) => Number(right.awardedAt) - Number(left.awardedAt)).map((badge) => `<tr><td><span class="admin-champion-badge"><i>♛</i>${escapeHtml(badge.season)}</span></td><td><b>${escapeHtml(badge.ownerName)}</b><small>${escapeHtml(badge.ownerId)}</small></td><td>${escapeHtml(badge.teamName)}</td><td>${dateText(badge.awardedAt)}</td></tr>`).join("") || `<tr><td colspan="4">尚未发放冠军徽章</td></tr>`;
  logoutButton.hidden = false;
  app.innerHTML = `${adminNavMarkup("league")}<header class="page-head"><div><h1>YellowDogs League</h1><p>${escapeHtml(season.name)} · ${season.status === "active" ? "进行中" : "已完成"} · 下一轮 ${dateText(season.nextRoundAt)}</p></div><button id="league-refresh">刷新联赛</button></header><section class="kpis league-admin-kpis"><article class="kpi"><small>当前赛季</small><b>${escapeHtml(season.name)}</b></article><article class="kpi"><small>联赛轮次</small><b>${season.currentRound}/${season.totalRounds}</b></article><article class="kpi"><small>已赛场次</small><b>${leagueData.matches}</b></article><article class="kpi"><small>真人球队</small><b>${humanTeams}/10</b></article><article class="kpi"><small>进行中选秀</small><b>${leagueData.drafts.length}</b></article></section><section class="league-admin-actions"><div><small>LEAGUE CONTROL</small><b>赛季运行控制</b><span>重启与新赛季都会保留真人球队、球员名单、金币和交易资产。</span></div><button id="league-simulate">立即模拟下一轮</button><button class="warning" id="league-restart">重启当前赛季</button><button class="danger" id="league-new-season">开启新赛季</button></section><div class="grid league-admin-grid"><section class="panel league-team-panel"><header class="panel-head"><div><h2>联赛球队</h2><small>积分与注册名单状态</small></div></header><div class="table-wrap"><table><thead><tr><th>#</th><th>球队</th><th>名单</th><th>赛</th><th>胜-平-负</th><th>进失</th><th>分</th></tr></thead><tbody>${leagueTeamRows()}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>球员池占用</h2><small>真人球队全服唯一，AI 不计入</small></div></header><div class="table-wrap"><table><thead><tr><th>位置池</th><th>总数</th><th>已签</th><th>选秀中</th><th>可用</th></tr></thead><tbody>${poolRows}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>进行中的选秀</h2><small>尚未确认 22 人名单的球队</small></div></header><div class="table-wrap"><table><thead><tr><th>球队/玩家</th><th>进度</th><th>开始时间</th></tr></thead><tbody>${drafts}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>赛季归档</h2><small>最近 12 次重启或换季记录</small></div></header><div class="table-wrap"><table><thead><tr><th>赛季</th><th>原因</th><th>轮次</th><th>比赛</th><th>归档时间</th></tr></thead><tbody>${archives}</tbody></table></div></section><section class="panel league-allocation-panel"><header class="panel-head"><div><h2>真人球员归属</h2><small>查看每名已签或选秀保留球员</small></div><input class="search" id="league-player-search" placeholder="搜索球员、球队或玩家" /></header><div class="table-wrap"><table><thead><tr><th>球员</th><th>位置</th><th>能力</th><th>状态</th><th>归属</th></tr></thead><tbody id="league-allocation-body">${leagueAllocationRows()}</tbody></table></div></section></div>`;
  document.querySelector(".league-admin-actions").insertAdjacentHTML("beforeend", `<button class="danger full-reset" id="league-full-reset">完全重置联赛</button>`);
  document.querySelector(".league-allocation-panel").insertAdjacentHTML("beforebegin", `<section class="panel league-backup-panel"><header class="panel-head"><div><h2>联赛数据备份</h2><small>每天一份，自动保留最近 ${leagueData.backups.retentionDays} 天；完全重置前额外保存快照</small></div></header><div class="table-wrap"><table><thead><tr><th>文件</th><th>类型</th></tr></thead><tbody>${backupRows}</tbody></table></div></section>`);
  document.querySelector(".league-team-panel").insertAdjacentHTML("afterend", `<section class="panel league-reward-mail-panel"><header class="panel-head"><div><h2>全服邮件卡包奖励</h2><small>在指定轮次为当时所有真人球队分别生成唯一三选一卡包</small></div></header><form id="league-reward-mail-form" class="league-reward-mail-form"><label><span>发放轮次</span><select name="round">${rewardRoundOptions}</select></label><label><span>位置卡包</span><select name="pool">${Object.entries(LEAGUE_POOL_LABELS).map(([pool,label]) => `<option value="${pool}">${label}</option>`).join("")}</select></label><label><span>卡包档位</span><select name="tierId">${rewardTierOptions}</select></label><button type="submit">安排邮件奖励</button></form><div class="table-wrap"><table><thead><tr><th>轮次</th><th>卡包</th><th>状态</th><th>发放结果</th><th>时间</th></tr></thead><tbody>${rewardGrantRows}</tbody></table></div></section>`);
  document.querySelector(".league-reward-mail-panel").insertAdjacentHTML("afterend", `<section class="panel league-badge-panel"><header class="panel-head"><div><h2>冠军徽章发放</h2><small>为指定玩家授予带赛季标记的皇冠冠军徽章</small></div></header><form id="league-badge-form" class="league-badge-form"><label><span>联赛玩家</span><select name="accountId" ${badgePlayerOptions ? "" : "disabled"}>${badgePlayerOptions || `<option>暂无真人玩家</option>`}</select></label><label><span>冠军赛季</span><select name="season">${CHAMPION_BADGE_SEASONS.map((season) => `<option value="${season}">${season} 冠军徽章</option>`).join("")}</select></label><button type="submit" ${badgePlayerOptions ? "" : "disabled"}>发放徽章</button></form><div class="table-wrap"><table><thead><tr><th>徽章</th><th>玩家</th><th>球队</th><th>发放时间</th></tr></thead><tbody>${badgeRows}</tbody></table></div></section>`);
  bindAdminNav();
  document.querySelector("#league-refresh").onclick = loadLeagueAdmin;
  document.querySelector("#league-player-search").oninput = (event) => {
    const term = event.target.value.trim().toLowerCase();
    const filtered = leagueData.allocations.filter((player) => `${player.name} ${player.id} ${player.teamName} ${player.ownerName ?? ""}`.toLowerCase().includes(term));
    document.querySelector("#league-allocation-body").innerHTML = leagueAllocationRows(filtered);
  };
  document.querySelector("#league-simulate").onclick = () => runLeagueAdminAction("/api/admin/league/simulate", {}, "下一轮已模拟完成");
  document.querySelector("#league-reward-mail-form").onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const round = Number(form.get("round"));
    const pool = String(form.get("pool"));
    const tierId = String(form.get("tierId"));
    const tier = leagueData.packTiers.find((entry) => entry.id === tierId);
    if (window.confirm(`确认在第 ${round} 轮向所有玩家发放一份${tier?.name ?? "球员卡包"}（${LEAGUE_POOL_LABELS[pool]}）？`)) {
      runLeagueAdminAction("/api/admin/league/reward-pack", { round, pool, tierId }, round <= season.currentRound ? "卡包奖励已立即通过邮件发放" : `卡包奖励已安排在第 ${round} 轮发放`);
    }
  };
  document.querySelector("#league-badge-form").onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const accountId = String(form.get("accountId"));
    const seasonName = String(form.get("season"));
    const team = leagueData.teams.find((entry) => entry.ownerId === accountId);
    if (window.confirm(`确认向 ${team?.ownerName ?? accountId} 发放 ${seasonName} 冠军徽章？`)) {
      runLeagueAdminAction("/api/admin/league/champion-badge", { accountId, season:seasonName }, `${seasonName}冠军徽章已发放`);
    }
  };
  document.querySelector("#league-restart").onclick = () => {
    if (window.confirm("确认重启当前赛季？积分、赛果和伤停会重置，真人球队、名单、金币和交易资产保留。")) runLeagueAdminAction("/api/admin/league/restart", { confirm:"RESTART" }, "当前赛季已重启");
  };
  document.querySelector("#league-new-season").onclick = () => {
    if (window.confirm("确认结束并归档当前赛季，立即开启下一赛季？真人球队、名单、金币和交易资产保留。")) runLeagueAdminAction("/api/admin/league/new-season", { confirm:"NEW_SEASON" }, "新赛季已开启");
  };
  document.querySelector("#league-full-reset").onclick = () => {
    const confirmation = window.prompt("此操作会移除全部玩家的YDL球队、球员、金币、交易、选秀和比赛数据。玩家账号本身保留。\n\n请输入：完全重置黄狗联赛");
    if (confirmation === "完全重置黄狗联赛") runLeagueAdminAction("/api/admin/league/full-reset", { confirm:"FULL_RESET_YDL" }, "YellowDogs League 已完全重置，所有玩家可以重新建队");
    else if (confirmation !== null) window.alert("确认文字不正确，操作已取消");
  };
}

async function runLeagueAdminAction(path, body, message) {
  try {
    leagueData = (await api(path, { method:"POST", body })).league;
    renderLeagueAdmin();
    window.alert(message);
  } catch (error) { window.alert(error.message); }
}

async function loadLeagueAdmin() {
  app.innerHTML = `<section class="loading">正在读取黄狗联赛数据…</section>`;
  try { leagueData = (await api("/api/admin/league")).league; renderLeagueAdmin(); }
  catch (error) { if (error.status === 401) renderLogin("登录已失效，请重新输入密码"); else app.innerHTML = `<section class="loading">${escapeHtml(error.message)}</section>`; }
}

function showModal(content) { modal.hidden = false; modal.innerHTML = `<section class="dialog">${content}</section>`; modal.querySelector("[data-close]").onclick = closeModal; }
function closeModal() { modal.hidden = true; modal.innerHTML = ""; }

async function openPlayer(id) {
  showModal(`<header class="dialog-head"><button data-close>×</button><div><small>玩家详情</small><h2>正在读取…</h2></div></header>`);
  try { const player = (await api(`/api/admin/players/${encodeURIComponent(id)}`)).player; const s = player.summary; showModal(`<header class="dialog-head"><button data-close>×</button><div><small>${escapeHtml(player.id)} · 注册于 ${dateText(player.createdAt)}</small><h2>${escapeHtml(player.nickname)}</h2></div></header><div class="dialog-body"><div class="detail-kpis"><span><small>比赛</small><b>${s.played}</b></span><span><small>胜 / 负</small><b>${s.wins} / ${s.losses}</b></span><span><small>进球</small><b>${s.goals}</b></span><span><small>助攻</small><b>${s.assists}</b></span></div><section class="panel"><header class="panel-head"><h2>历史比赛</h2></header><div class="match-list">${player.matches.map((match) => `<button class="match-row" ${match.matchId ? `data-match="${escapeHtml(match.matchId)}"` : "disabled"}><time>${shortDate(match.playedAt)}</time><span><b>对阵 ${escapeHtml(match.opponentName)}</b><small>${escapeHtml(match.ownFormation ?? "阵型未知")} vs ${escapeHtml(match.opponentFormation ?? "阵型未知")} · ${match.goals}球 ${match.assists}助</small></span><strong>${match.scoreFor}:${match.scoreAgainst}</strong></button>`).join("") || `<p class="empty">暂无比赛</p>`}</div></section></div>`); bindMatchRows(); }
  catch (error) { closeModal(); alert(error.message); }
}

function teamMarkup(team) {
  const players = team.players ?? [];
  const averageRating = players.length ? players.reduce((sum, player) => sum + Number(player.rating ?? 0), 0) / players.length : 0;
  const magnets = players.map((player) => {
    const position = player.position ?? team.positions?.[player.id] ?? { x:50, y:50 };
    const x = Math.max(4, Math.min(96, Number(position.x ?? 50)));
    const y = Math.max(4, Math.min(96, Number(position.y ?? 50)));
    const status = player.sentOff ? "红牌" : player.injury ? "伤退" : player.active === false ? "离场" : "";
    const role = ROLES[player.assignedRole ?? player.role] ?? player.assignedRole ?? player.role;
    return `<div class="admin-magnet ${status ? "inactive" : ""}" style="left:${x}%;top:${y}%" title="${escapeHtml(`${player.name} · ${role} · 综合能力 ${player.overall} · 比赛评分 ${Number(player.rating).toFixed(1)}${status ? ` · ${status}` : ""}`)}"><b>${escapeHtml(player.name)}</b><small>${escapeHtml(role)}${status ? ` · ${status}` : ""}</small><span><em>能力</em>${Number(player.overall ?? 0)}</span><strong><em>评分</em>${Number(player.rating ?? 0).toFixed(1)}</strong></div>`;
  }).join("");
  const lineup = [...players].sort((left, right) => Number(right.rating) - Number(left.rating)).map((player) => `<span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(ROLES[player.assignedRole ?? player.role] ?? player.assignedRole ?? player.role)} · 综合能力 ${Number(player.overall ?? 0)} · 比赛评分 ${Number(player.rating ?? 0).toFixed(1)} · ${player.stats?.goals ?? 0}球 ${player.stats?.assists ?? 0}助</small></span>`).join("");
  return `<section class="team"><header><div><h3>${escapeHtml(team.name)}</h3><strong class="formation-badge">阵型 ${escapeHtml(team.formation ?? "未知")}</strong></div><small>${escapeHtml(TACTICS[team.tactic] ?? team.tactic)} · ${escapeHtml(STYLES[team.style] ?? team.style)} · 平均评分 ${averageRating.toFixed(1)}</small></header><div class="admin-pitch"><div class="admin-pitch-lines"></div><span class="admin-zone att">前场</span><span class="admin-zone mid">中场</span><span class="admin-zone def">后场</span><span class="admin-zone gk">门将</span>${magnets}</div><div class="lineup">${lineup}</div></section>`;
}

async function openMatch(id) {
  showModal(`<header class="dialog-head"><button data-close>×</button><div><small>比赛详情</small><h2>正在读取…</h2></div></header>`);
  try { const match = (await api(`/api/admin/matches/${encodeURIComponent(id)}`)).match; if (!match.teams) throw new Error("该旧版比赛没有完整详情"); showModal(`<header class="dialog-head"><button data-close>×</button><div><small>${dateText(match.playedAt)} · 房间 ${escapeHtml(match.roomCode)} · 第 ${match.round} 局</small><h2>比赛详情</h2></div></header><div class="scoreline"><span>${escapeHtml(match.teams[0].name)}</span><b>${match.score[0]} : ${match.score[1]}</b><span>${escapeHtml(match.teams[1].name)}</span></div><div class="dialog-body"><div class="teams">${match.teams.map(teamMarkup).join("")}</div><div class="events">${(match.importantEvents ?? []).map((event) => `<article class="event ${event.importance === "major" ? "major" : ""}"><span><b>${event.minute}'</b>${escapeHtml(event.text)}</span>${event.detail ? `<small>${escapeHtml(event.detail)}</small>` : ""}</article>`).join("")}</div></div>`); }
  catch (error) { closeModal(); alert(error.message); }
}

logoutButton.onclick = async () => { try { await api("/api/admin/logout", { method:"POST" }); } catch {} renderLogin(); };
modal.onclick = (event) => { if (event.target === modal) closeModal(); };
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) closeModal(); });
if (token) loadDashboard(); else renderLogin();
