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
let contentData = null;
let contentTab = "players";
let selectedContentPlayerId = null;
let selectedContentTraitId = null;

async function loadEnvironment() {
  try {
    const response = await fetch("/api/versus/config", { cache:"no-store" });
    const config = await response.json();
    if (config.environment !== "test") return;
    document.documentElement.dataset.environment = "test";
    document.title = `${config.environmentLabel ?? "S4 测试服"} | ${document.title}`;
  } catch {}
}

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
  return `<nav class="admin-section-nav"><button data-admin-view="dashboard" class="${active === "dashboard" ? "active" : ""}">运营总览</button><button data-admin-view="league" class="${active === "league" ? "active" : ""}">黄狗联赛</button><button data-admin-view="content" class="${active === "content" ? "active" : ""}">球员与特性</button></nav>`;
}

function bindAdminNav() {
  document.querySelectorAll("[data-admin-view]").forEach((button) => {
    button.onclick = () => button.dataset.adminView === "league"
      ? loadLeagueAdmin()
      : button.dataset.adminView === "content" ? loadContentAdmin() : loadDashboard();
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
const BADGE_OPTIONS = [
  { competition:"league", season:"S0", label:"S0 联赛冠军徽章" },
  { competition:"league", season:"S1", label:"S1 联赛冠军徽章" },
  { competition:"league", season:"S2", label:"S2 联赛冠军徽章" },
  { competition:"cup", season:"S2", label:"S2 杯赛冠军徽章" },
  { competition:"cup", season:"S3", label:"S3 杯赛冠军徽章" },
];
const DEFAULT_ADMIN_PACK_TYPES = [
  { id:"position-standard", name:"指定位置基础卡包", poolMode:"position", tierId:"standard", tier:{ guarantee:"随机品质" } },
  { id:"position-advanced", name:"指定位置进阶卡包", poolMode:"position", tierId:"advanced", tier:{ guarantee:"至少 1 名 B 级以上" } },
  { id:"position-elite", name:"指定位置高级卡包", poolMode:"position", tierId:"elite", tier:{ guarantee:"至少 1 名 A 级以上" } },
  { id:"mixed-standard", name:"全位置基础卡包", pool:"MIXED", tierId:"standard", tier:{ guarantee:"全位置混池" } },
  { id:"mixed-advanced", name:"全位置进阶卡包", pool:"MIXED", tierId:"advanced", tier:{ guarantee:"全位置混池，至少 1 名 B 级以上" } },
  { id:"mixed-elite", name:"全位置高级卡包", pool:"MIXED", tierId:"elite", tier:{ guarantee:"全位置混池，至少 1 名 A 级以上" } },
  { id:"random-legend", name:"随机传奇卡包", pool:"LEGEND", tierId:"legend", tier:{ guarantee:"随机 1 名可用传奇球员" } },
];

function leagueTeamRows() {
  return leagueData.teams.map((team) => `<tr><td><strong>${team.rank}</strong></td><td><b>${escapeHtml(team.name)}</b><small>${team.isAi ? "AI 球队" : `${escapeHtml(team.ownerName)} · ${escapeHtml(team.ownerId)}`}</small></td><td>${team.rosterCount}/33</td><td>${team.table.played}</td><td>${team.table.won}-${team.table.drawn}-${team.table.lost}</td><td>${team.table.goalsFor}:${team.table.goalsAgainst}</td><td><strong>${team.table.points}</strong></td></tr>`).join("");
}

function leagueAllocationRows(entries = leagueData.allocations) {
  return entries.map((player) => `<tr><td><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.id)}</small></td><td>${LEAGUE_POOL_LABELS[player.pool]} · ${escapeHtml(ROLES[player.role] ?? player.role)}</td><td>${player.overall}</td><td>${player.status === "owned" ? "正式签约" : "选秀保留"}</td><td><b>${escapeHtml(player.teamName)}</b><small>${escapeHtml(player.ownerName ?? "尚未完成选秀")}</small></td></tr>`).join("") || `<tr><td colspan="5">当前没有真人球队占用球员</td></tr>`;
}

const coinText = (value) => `${Number(value ?? 0).toLocaleString()} 金币`;

function leagueEconomyDetail(accountId) {
  if (!Array.isArray(leagueData.economy)) return `<p class="empty">后台服务仍在运行旧版本。请重启本地服务或 tunnel 服务后刷新页面，经济数据不会丢失。</p>`;
  const economy = leagueData.economy?.find((entry) => entry.accountId === accountId) ?? leagueData.economy?.[0];
  if (!economy) return `<p class="empty">当前赛季还没有玩家球队经济数据</p>`;
  const playerText = (entry) => entry.player ? `${escapeHtml(entry.player.name)} <small>${entry.player.grade}级 · 能力 ${entry.player.overall}</small>` : `<span class="muted">旧流水未记录球员</span>`;
  const signingRows = economy.signings.map((entry) => `<tr><td>${dateText(entry.createdAt)}</td><td>${escapeHtml(entry.label)}</td><td>${escapeHtml(entry.tierName ?? "奖励卡包")}</td><td><b>${playerText(entry)}</b></td></tr>`).join("") || `<tr><td colspan="4">本赛季暂无卡包签约</td></tr>`;
  const movementRows = [...economy.releases, ...economy.transfers].sort((left,right) => right.createdAt - left.createdAt).map((entry) => `<tr><td>${dateText(entry.createdAt)}</td><td>${escapeHtml(entry.label)}</td><td>${playerText(entry)}</td><td class="${entry.amount >= 0 ? "economy-income" : "economy-expense"}">${entry.amount >= 0 ? "+" : "−"}${coinText(Math.abs(entry.amount))}</td></tr>`).join("") || `<tr><td colspan="4">本赛季暂无解约或交易</td></tr>`;
  const ledgerRows = economy.ledger.map((entry) => `<tr><td>${dateText(entry.createdAt)}</td><td>${escapeHtml(entry.label)}</td><td>${entry.tierName ? escapeHtml(entry.tierName) : "—"}</td><td>${entry.player ? `${escapeHtml(entry.player.name)}（${entry.player.overall}）` : "—"}</td><td class="${entry.amount > 0 ? "economy-income" : entry.amount < 0 ? "economy-expense" : ""}">${entry.amount > 0 ? "+" : entry.amount < 0 ? "−" : ""}${coinText(Math.abs(entry.amount))}</td></tr>`).join("") || `<tr><td colspan="5">本赛季暂无金币流水</td></tr>`;
  return `<div class="economy-kpis"><article><small>当前金币</small><b>${coinText(economy.balance)}</b></article><article><small>本赛季收入</small><b class="economy-income">+${coinText(economy.income)}</b></article><article><small>本赛季支出</small><b class="economy-expense">−${coinText(economy.expense)}</b></article><article><small>净流水</small><b>${economy.net >= 0 ? "+" : "−"}${coinText(Math.abs(economy.net))}</b></article></div><div class="economy-pack-counts">${economy.shopPackCounts.map((tier) => `<span><small>${escapeHtml(tier.tierName)}商店包</small><b>${tier.count} 个</b></span>`).join("")}</div><div class="economy-tables"><section><h3>卡包获得球员</h3><div class="table-wrap"><table><thead><tr><th>时间</th><th>来源</th><th>档位</th><th>球员</th></tr></thead><tbody>${signingRows}</tbody></table></div></section><section><h3>解约与转会</h3><div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>球员</th><th>金币</th></tr></thead><tbody>${movementRows}</tbody></table></div></section><section class="economy-ledger"><h3>完整金币流水</h3><div class="table-wrap"><table><thead><tr><th>时间</th><th>事项</th><th>卡包档位</th><th>球员</th><th>金额</th></tr></thead><tbody>${ledgerRows}</tbody></table></div></section></div>`;
}

function renderLeagueAdmin() {
  const season = leagueData.season;
  const registrationOpen = season.status === "registration";
  const seasonStatusLabel = registrationOpen ? "报名选人中" : season.status === "active" ? "进行中" : "已完成";
  const humanTeams = leagueData.teams.filter((team) => !team.isAi).length;
  const assetSummary = leagueData.s4Assets ?? { ownershipCount:0, activeCardCount:0, recycledCardCount:0 };
  const economyVersionReady = Array.isArray(leagueData.economy);
  const economyOptions = (leagueData.economy ?? []).map((entry) => `<option value="${escapeHtml(entry.accountId)}">${escapeHtml(entry.ownerName)} · ${escapeHtml(entry.teamName)}</option>`).join("");
  const poolRows = Object.entries(leagueData.pools).map(([pool, value]) => `<tr><td><b>${LEAGUE_POOL_LABELS[pool]}</b><small>${pool}</small></td><td>${value.total}</td><td><strong>${value.selected}</strong></td><td>${value.drafting}</td><td>${value.available}</td></tr>`).join("");
  const drafts = leagueData.drafts.map((draft) => `<tr><td><b>${escapeHtml(draft.teamName)}</b><small>${escapeHtml(draft.accountId)}</small></td><td>${draft.selectedCount}/22</td><td>${dateText(draft.startedAt)}</td></tr>`).join("") || `<tr><td colspan="3">当前没有进行中的选秀</td></tr>`;
  const archives = leagueData.archives.slice().reverse().map((archive) => `<tr><td><b>${escapeHtml(archive.season.name)}</b><small>${escapeHtml(archive.season.id)}</small></td><td>${archive.reason === "new-season" ? "开启新赛季" : "重启赛季"}</td><td>${archive.season.currentRound}/${archive.season.totalRounds}</td><td>${archive.matchCount}</td><td>${dateText(archive.archivedAt)}</td></tr>`).join("") || `<tr><td colspan="5">尚无赛季归档</td></tr>`;
  const backupRows = leagueData.backups.files.map((name) => `<tr><td><b>${escapeHtml(name)}</b></td><td>${name.startsWith("before-full-reset-") ? "完全重置前快照" : "每日自动备份"}</td></tr>`).join("") || `<tr><td colspan="2">首次保存联赛数据后生成备份</td></tr>`;
  const s4PackCatalog = leagueData.s4PackCatalog ?? [];
  const s4PackTypeOptions = s4PackCatalog.map((pack) => `<option value="${escapeHtml(pack.id)}">${escapeHtml(pack.name)} · ${pack.selectionMode === "choice" ? "三选一" : "直接随机发放"}</option>`).join("");
  const s4GrantRows = (leagueData.s4PackGrants ?? []).map((grant) => {
    const pack = s4PackCatalog.find((entry) => entry.id === grant.packType);
    return `<tr><td><b>${escapeHtml(pack?.name ?? grant.packType)}</b><small>${escapeHtml(grant.id)}</small></td><td>${grant.quantity}份/人</td><td>${grant.recipientMode === "all" ? "全体玩家" : "指定玩家"}</td><td>${grant.recipientCount}人</td><td>${dateText(grant.createdAt)}</td></tr>`;
  }).join("") || `<tr><td colspan="5">尚未发放S4礼包</td></tr>`;
  const s4RecipientOptions = leagueData.teams.filter((team) => !team.isAi).map((team) => `<option value="${escapeHtml(team.ownerId)}">${escapeHtml(team.ownerName)} · ${escapeHtml(team.name)} · ${escapeHtml(team.ownerId)}</option>`).join("");
  const s4PlayerCatalog = leagueData.s4PlayerCatalog ?? [];
  const s4PlayerOptions = s4PlayerCatalog.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${escapeHtml(player.club ?? "自由球员")} · ${escapeHtml(ROLES[player.role] ?? player.role)} · ${player.overall} · ${player.grade}</option>`).join("");
  const s4CardGrantRows = (leagueData.s4CardGrants ?? []).slice(0, 30).map((grant) => `<tr><td><b>${escapeHtml(grant.playerName)}</b><small>${escapeHtml(grant.playerId)}</small></td><td>${grant.upgradeLevel ? `+${grant.upgradeLevel}` : "无强化"}</td><td>${grant.quantity}张</td><td><b>${escapeHtml(grant.ownerName)}</b><small>${escapeHtml(grant.teamName)}</small></td><td>${grant.ownershipGranted ? "同时获得所有权" : "所有权不变"}</td><td>${dateText(grant.createdAt)}</td></tr>`).join("") || `<tr><td colspan="6">尚未发放指定球员卡</td></tr>`;
  const badgePlayerOptions = leagueData.teams.filter((team) => !team.isAi).map((team) => `<option value="${escapeHtml(team.ownerId)}">${escapeHtml(team.ownerName)} · ${escapeHtml(team.name)} · ${escapeHtml(team.ownerId)}</option>`).join("");
  const badgeRows = leagueData.teams.flatMap((team) => (team.championBadges ?? []).map((badge) => ({ ...badge, ownerId:team.ownerId, ownerName:team.ownerName, teamName:team.name }))).sort((left,right) => Number(right.awardedAt) - Number(left.awardedAt)).map((badge) => { const isCup = badge.competition === "cup" || badge.type === "cup-champion"; return `<tr><td><span class="admin-champion-badge ${isCup ? "cup-champion-badge" : ""}"><i>${isCup ? "🏆" : "♛"}</i>${escapeHtml(badge.season)}${isCup ? " 杯赛" : " 联赛"}</span></td><td><b>${escapeHtml(badge.ownerName)}</b><small>${escapeHtml(badge.ownerId)}</small></td><td>${escapeHtml(badge.teamName)}</td><td>${dateText(badge.awardedAt)}</td></tr>`; }).join("") || `<tr><td colspan="4">尚未发放冠军徽章</td></tr>`;
  logoutButton.hidden = false;
  app.innerHTML = `${adminNavMarkup("league")}<header class="page-head"><div><h1>YellowDogs League</h1><p>${escapeHtml(season.name)} · ${season.status === "active" ? "进行中" : "已完成"} · 下一轮 ${dateText(season.nextRoundAt)}</p></div><button id="league-refresh">刷新联赛</button></header><section class="kpis league-admin-kpis"><article class="kpi"><small>当前赛季</small><b>${escapeHtml(season.name)}</b></article><article class="kpi"><small>联赛轮次</small><b>${season.currentRound}/${season.totalRounds}</b></article><article class="kpi"><small>已赛场次</small><b>${leagueData.matches}</b></article><article class="kpi"><small>真人球队</small><b>${humanTeams}/10</b></article><article class="kpi"><small>进行中选秀</small><b>${leagueData.drafts.length}</b></article></section><section class="league-admin-actions"><div><small>LEAGUE CONTROL</small><b>赛季运行控制</b><span>重启与新赛季都会保留真人球队、球员名单、金币和交易资产。</span></div><button id="league-simulate">立即模拟下一轮</button><button class="warning" id="league-restart">重启当前赛季</button><button class="danger" id="league-new-season">开启新赛季</button></section><div class="grid league-admin-grid"><section class="panel league-team-panel"><header class="panel-head"><div><h2>联赛球队</h2><small>积分与注册名单状态</small></div></header><div class="table-wrap"><table><thead><tr><th>#</th><th>球队</th><th>名单</th><th>赛</th><th>胜-平-负</th><th>进失</th><th>分</th></tr></thead><tbody>${leagueTeamRows()}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>球员池占用</h2><small>真人球队全服唯一，AI 不计入</small></div></header><div class="table-wrap"><table><thead><tr><th>位置池</th><th>总数</th><th>已签</th><th>选秀中</th><th>可用</th></tr></thead><tbody>${poolRows}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>进行中的选秀</h2><small>尚未确认 22 人名单的球队</small></div></header><div class="table-wrap"><table><thead><tr><th>球队/玩家</th><th>进度</th><th>开始时间</th></tr></thead><tbody>${drafts}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>赛季归档</h2><small>最近 12 次重启或换季记录</small></div></header><div class="table-wrap"><table><thead><tr><th>赛季</th><th>原因</th><th>轮次</th><th>比赛</th><th>归档时间</th></tr></thead><tbody>${archives}</tbody></table></div></section><section class="panel league-allocation-panel"><header class="panel-head"><div><h2>真人球员归属</h2><small>查看每名已签或选秀保留球员</small></div><input class="search" id="league-player-search" placeholder="搜索球员、球队或玩家" /></header><div class="table-wrap"><table><thead><tr><th>球员</th><th>位置</th><th>能力</th><th>状态</th><th>归属</th></tr></thead><tbody id="league-allocation-body">${leagueAllocationRows()}</tbody></table></div></section></div>`;
  document.querySelector(".league-admin-kpis").insertAdjacentHTML("beforeend", `<article class="kpi"><small>S4所有权</small><b>${assetSummary.ownershipCount}</b></article><article class="kpi"><small>流通球员卡</small><b>${assetSummary.activeCardCount}</b></article><article class="kpi"><small>系统回收卡</small><b>${assetSummary.recycledCardCount}</b></article>`);
  document.querySelector(".page-head p").textContent = `${season.name} · ${seasonStatusLabel} · ${registrationOpen ? "等待管理员开启联赛推进" : `下一轮 ${dateText(season.nextRoundAt)}`}`;
  const simulateButton = document.querySelector("#league-simulate");
  simulateButton.disabled = registrationOpen || season.status === "completed";
  if (registrationOpen) simulateButton.textContent = "等待开启联赛推进";
  document.querySelector(".league-admin-actions").insertAdjacentHTML("beforeend", `<button class="primary" id="league-start-simulation" ${registrationOpen ? "" : "disabled"}>${registrationOpen ? "开启联赛推进" : season.status === "active" ? "联赛推进已开启" : "赛季已结束"}</button>`);
  document.querySelector(".league-admin-actions").insertAdjacentHTML("beforeend", `<button class="danger full-reset" id="league-full-reset">完全重置联赛</button>`);
  document.querySelector(".league-admin-actions").insertAdjacentHTML("beforeend", `<button class="danger full-reset" id="league-fresh-season">开启全新赛季</button>`);
  document.querySelector(".league-admin-actions").insertAdjacentHTML("beforeend", `<button id="league-cup-start" ${leagueData.cup?.status === "waiting" && season.status === "active" ? "" : "disabled"}>${registrationOpen ? "联赛推进后可开启杯赛" : leagueData.cup?.status === "waiting" ? "开启黄狗冠军杯" : `黄狗冠军杯：${leagueData.cup?.stage ?? "进行中"}`}</button>`);
  document.querySelector(".league-allocation-panel").insertAdjacentHTML("beforebegin", `<section class="panel league-backup-panel"><header class="panel-head"><div><h2>联赛数据备份</h2><small>每天一份，自动保留最近 ${leagueData.backups.retentionDays} 天；完全重置前额外保存快照</small></div></header><div class="table-wrap"><table><thead><tr><th>文件</th><th>类型</th></tr></thead><tbody>${backupRows}</tbody></table></div></section>`);
  document.querySelector(".league-backup-panel").insertAdjacentHTML("beforebegin", `<section class="panel league-economy-panel"><header class="panel-head"><div><h2>玩家经济明细</h2><small>当前赛季商店开包、卡包签约、解约、转会与完整金币流水</small></div><select id="league-economy-team" ${economyOptions ? "" : "disabled"}>${economyOptions || `<option>${economyVersionReady ? "暂无玩家球队" : "等待服务重启"}</option>`}</select></header><div id="league-economy-detail">${leagueEconomyDetail(leagueData.economy?.[0]?.accountId)}</div></section>`);
  document.querySelector(".league-team-panel").insertAdjacentHTML("afterend", `<section class="panel league-reward-mail-panel"><header class="panel-head"><div><h2>S4礼包发放</h2><small>旧赛季礼包已经下架；可向所有已建队玩家或指定玩家立即发放新礼包。</small></div></header><form id="league-s4-pack-grant-form" class="league-reward-mail-form"><label><span>礼包类型</span><select name="packType">${s4PackTypeOptions}</select></label><label><span>每人数量</span><input name="quantity" type="number" min="1" max="50" value="1" required></label><label><span>发放范围</span><select name="recipientMode"><option value="all">所有玩家</option><option value="specified">指定玩家</option></select></label><label id="league-s4-recipient-field" hidden><span>指定玩家</span><select name="accountIds" multiple size="5">${s4RecipientOptions}</select></label><button type="submit" ${s4PackTypeOptions ? "" : "disabled"}>立即发放礼包</button></form><div class="table-wrap"><table><thead><tr><th>礼包</th><th>数量</th><th>范围</th><th>接收人数</th><th>时间</th></tr></thead><tbody>${s4GrantRows}</tbody></table></div></section>`);
  document.querySelector(".league-reward-mail-panel").insertAdjacentHTML("afterend", `<section class="panel league-card-grant-panel"><header class="panel-head"><div><h2>指定球员卡发放</h2><small>向任意已建队玩家发放指定球员、指定强化等级的测试卡；强化等级支持0至8级。</small></div></header><form id="league-s4-card-grant-form" class="league-card-grant-form"><label><span>接收玩家</span><select name="accountId" ${s4RecipientOptions ? "" : "disabled"}>${s4RecipientOptions || `<option>暂无真人玩家</option>`}</select></label><label><span>搜索球员</span><input id="league-s4-player-search" placeholder="输入中文名、俱乐部、位置或ID"></label><label><span>指定球员</span><select id="league-s4-player-select" name="playerId" ${s4PlayerOptions ? "" : "disabled"}>${s4PlayerOptions || `<option>暂无球员数据</option>`}</select></label><label><span>强化等级</span><select name="upgradeLevel">${Array.from({ length:9 }, (_, level) => `<option value="${level}">${level ? `+${level}` : "无强化"}</option>`).join("")}</select></label><label><span>发放数量</span><input name="quantity" type="number" min="1" max="50" value="1" required></label><button type="submit" ${s4RecipientOptions && s4PlayerOptions ? "" : "disabled"}>发放指定球员卡</button></form><div class="table-wrap"><table><thead><tr><th>球员</th><th>强化</th><th>数量</th><th>接收玩家</th><th>所有权</th><th>时间</th></tr></thead><tbody>${s4CardGrantRows}</tbody></table></div></section>`);
  document.querySelector(".league-card-grant-panel").insertAdjacentHTML("afterend", `<section class="panel league-badge-panel"><header class="panel-head"><div><h2>冠军徽章发放</h2><small>可发放皇冠联赛冠军徽章，或带赛季标记的奖杯杯赛冠军徽章</small></div></header><form id="league-badge-form" class="league-badge-form"><label><span>联赛玩家</span><select name="accountId" ${badgePlayerOptions ? "" : "disabled"}>${badgePlayerOptions || `<option>暂无真人玩家</option>`}</select></label><label><span>冠军荣誉</span><select name="badge">${BADGE_OPTIONS.map((badge) => `<option value="${badge.competition}:${badge.season}">${badge.label}</option>`).join("")}</select></label><button type="submit" ${badgePlayerOptions ? "" : "disabled"}>发放徽章</button></form><div class="table-wrap"><table><thead><tr><th>徽章</th><th>玩家</th><th>球队</th><th>发放时间</th></tr></thead><tbody>${badgeRows}</tbody></table></div></section>`);
  bindAdminNav();
  document.querySelector("#league-refresh").onclick = loadLeagueAdmin;
  document.querySelector("#league-player-search").oninput = (event) => {
    const term = event.target.value.trim().toLowerCase();
    const filtered = leagueData.allocations.filter((player) => `${player.name} ${player.id} ${player.teamName} ${player.ownerName ?? ""}`.toLowerCase().includes(term));
    document.querySelector("#league-allocation-body").innerHTML = leagueAllocationRows(filtered);
  };
  const economySelect = document.querySelector("#league-economy-team");
  economySelect.onchange = () => { document.querySelector("#league-economy-detail").innerHTML = leagueEconomyDetail(economySelect.value); };
  document.querySelector("#league-simulate").onclick = () => runLeagueAdminAction("/api/admin/league/simulate", {}, "下一轮联赛及期间杯赛已模拟完成");
  document.querySelector("#league-start-simulation").onclick = () => {
    if (window.confirm(`确认结束 ${season.name} 报名选人阶段并开启联赛推进？首轮会安排在开启后的下一个20分钟时间档。当前已有 ${humanTeams} 支玩家球队，其余席位由AI球队保留。`)) runLeagueAdminAction("/api/admin/league/start-simulation", { confirm:"START_LEAGUE_SIMULATION" }, "联赛推进已开启，首轮时间已经安排");
  };
  const s4GrantForm = document.querySelector("#league-s4-pack-grant-form");
  const s4RecipientMode = s4GrantForm.querySelector("[name=recipientMode]");
  const s4RecipientField = document.querySelector("#league-s4-recipient-field");
  const syncS4Recipients = () => {
    const specified = s4RecipientMode.value === "specified";
    s4RecipientField.hidden = !specified;
    s4RecipientField.querySelector("select").disabled = !specified;
  };
  s4RecipientMode.onchange = syncS4Recipients;
  syncS4Recipients();
  s4GrantForm.onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const packType = String(form.get("packType"));
    const quantity = Number(form.get("quantity"));
    const recipientMode = String(form.get("recipientMode"));
    const accountIds = form.getAll("accountIds").map(String);
    const pack = s4PackCatalog.find((entry) => entry.id === packType);
    const scope = recipientMode === "all" ? "所有已建队玩家" : `${accountIds.length}名指定玩家`;
    if (recipientMode === "specified" && !accountIds.length) return window.alert("请至少选择一名玩家");
    if (window.confirm(`确认向${scope}每人发放${quantity}份${pack?.name ?? "S4礼包"}？`)) {
      runLeagueAdminAction("/api/admin/league/s4-packs/grant", { packType, quantity, recipientMode, accountIds }, "S4礼包已经发放并进入玩家背包");
    }
  };
  const s4PlayerSelect = document.querySelector("#league-s4-player-select");
  const s4PlayerSearch = document.querySelector("#league-s4-player-search");
  const s4PlayerSearchField = s4PlayerSearch.closest("label");
  s4PlayerSearchField.classList.add("league-card-player-search-field");
  s4PlayerSearch.insertAdjacentHTML("afterend", `<div id="league-s4-player-candidates" class="league-card-player-candidates" hidden></div>`);
  s4PlayerSearch.autocomplete = "off";
  const s4PlayerCandidates = document.querySelector("#league-s4-player-candidates");
  const s4PlayerSearchText = (player) => [
    player.name,
    player.id,
    player.club,
    player.nationality,
    player.role,
    player.secondaryRole,
    ROLES[player.role],
    ROLES[player.secondaryRole],
  ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
  const renderS4PlayerCandidates = (players, term) => {
    const visible = players.slice(0, 12);
    s4PlayerCandidates.innerHTML = visible.length
      ? visible.map((player) => `<button type="button" data-s4-player-candidate="${escapeHtml(player.id)}"><b>${escapeHtml(player.name)}</b><span>${escapeHtml(player.club ?? "自由球员")} · ${escapeHtml(ROLES[player.role] ?? player.role)} · ${player.overall}</span></button>`).join("")
      : `<div class="league-card-player-candidate-empty">没有找到“${escapeHtml(term)}”</div>`;
    s4PlayerCandidates.hidden = !term;
  };
  s4PlayerSearch.oninput = (event) => {
    const term = event.target.value.trim().toLowerCase();
    const players = s4PlayerCatalog.filter((player) => s4PlayerSearchText(player).includes(term));
    s4PlayerSelect.innerHTML = players.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${escapeHtml(player.club ?? "自由球员")} · ${escapeHtml(ROLES[player.role] ?? player.role)} · ${player.overall} · ${player.grade}</option>`).join("") || `<option value="">没有匹配球员</option>`;
    renderS4PlayerCandidates(players, event.target.value.trim());
  };
  s4PlayerCandidates.onclick = (event) => {
    const candidate = event.target.closest("[data-s4-player-candidate]");
    if (!candidate) return;
    const player = s4PlayerCatalog.find((entry) => entry.id === candidate.dataset.s4PlayerCandidate);
    if (!player) return;
    s4PlayerSelect.innerHTML = `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${escapeHtml(player.club ?? "自由球员")} · ${escapeHtml(ROLES[player.role] ?? player.role)} · ${player.overall} · ${player.grade}</option>`;
    s4PlayerSelect.value = player.id;
    s4PlayerSearch.value = player.name;
    s4PlayerCandidates.hidden = true;
  };
  s4PlayerSearch.onfocus = () => {
    if (s4PlayerSearch.value.trim()) s4PlayerSearch.dispatchEvent(new Event("input"));
  };
  document.querySelector("#league-s4-card-grant-form").onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const accountId = String(form.get("accountId"));
    const playerId = String(form.get("playerId"));
    const upgradeLevel = Number(form.get("upgradeLevel"));
    const quantity = Number(form.get("quantity"));
    const team = leagueData.teams.find((entry) => entry.ownerId === accountId);
    const player = s4PlayerCatalog.find((entry) => entry.id === playerId);
    if (!player) return window.alert("请选择有效的球员");
    const levelText = upgradeLevel ? `+${upgradeLevel}` : "无强化";
    if (window.confirm(`确认向 ${team?.ownerName ?? accountId} 发放 ${quantity}张 ${player.name}（${levelText}）球员卡？`)) {
      runLeagueAdminAction("/api/admin/league/s4-cards/grant", { accountId, playerId, upgradeLevel, quantity }, "指定球员卡已经发放并进入玩家背包");
    }
  };
  document.querySelector("#league-badge-form").onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const accountId = String(form.get("accountId"));
    const [competition, seasonName] = String(form.get("badge")).split(":");
    const team = leagueData.teams.find((entry) => entry.ownerId === accountId);
    const competitionName = competition === "cup" ? "杯赛" : "联赛";
    if (window.confirm(`确认向 ${team?.ownerName ?? accountId} 发放 ${seasonName}${competitionName}冠军徽章？`)) {
      runLeagueAdminAction("/api/admin/league/champion-badge", { accountId, season:seasonName, competition }, `${seasonName}${competitionName}冠军徽章已发放`);
    }
  };
  document.querySelector("#league-restart").onclick = () => {
    if (window.confirm("确认重启当前赛季？积分、赛果和伤停会重置，真人球队、名单、金币和交易资产保留。")) runLeagueAdminAction("/api/admin/league/restart", { confirm:"RESTART" }, "当前赛季已重启");
  };
  document.querySelector("#league-new-season").onclick = () => {
    if (window.confirm("确认结束并归档当前赛季，立即开启下一赛季？真人球队、名单、金币和交易资产保留。")) runLeagueAdminAction("/api/admin/league/new-season", { confirm:"NEW_SEASON" }, "新赛季已开启");
  };
  document.querySelector("#league-cup-start").onclick = () => {
    if (window.confirm("确认开启黄狗冠军杯？将由当前10支球队进行4轮瑞士轮，前八名进入两回合淘汰赛。")) runLeagueAdminAction("/api/admin/league/cup/start", {}, "黄狗冠军杯已开启，首轮将在下一个杯赛时间档开始");
  };
  document.querySelector("#league-full-reset").onclick = () => {
    const confirmation = window.prompt("此操作会移除全部玩家的YDL球队、球员、金币、交易、选秀和比赛数据。玩家账号本身保留。\n\n请输入：完全重置黄狗联赛");
    if (confirmation === "完全重置黄狗联赛") runLeagueAdminAction("/api/admin/league/full-reset", { confirm:"FULL_RESET_YDL" }, "YellowDogs League 已完全重置，所有玩家可以重新建队");
    else if (confirmation !== null) window.alert("确认文字不正确，操作已取消");
  };
  document.querySelector("#league-fresh-season").onclick = () => {
    const confirmation = window.prompt("此操作会开启下一个赛季，并移除全部玩家的YDL球队、球员、金币、背包、交易、选秀和比赛数据。玩家账号本身保留，所有玩家需要重新建队选卡。\n\n请输入：开启全新黄狗联赛赛季");
    if (confirmation === "开启全新黄狗联赛赛季") runLeagueAdminAction("/api/admin/league/fresh-season", { confirm:"FRESH_SEASON_YDL" }, "YellowDogs League 全新赛季已开启，所有玩家可以重新建队");
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

const CONTENT_ROLE_LABELS = { ANY:"全位置", GK:"门将", DEF:"后场", MID:"中场", ATT:"前场" };
const CONTENT_ATTRIBUTE_LABELS = {
  passing:"传球", firstTouch:"停球", dribbling:"盘带", crossing:"传中", finishing:"射门",
  longShots:"远射", heading:"头球", setPieces:"定位球", tackling:"抢断", marking:"盯人",
  positioning:"站位", vision:"视野", decisions:"决策", composure:"冷静", offBall:"无球",
  discipline:"纪律", pace:"速度", acceleration:"加速", strength:"力量", stamina:"耐力",
  agility:"灵活", jumping:"弹跳", workRate:"投入", aggression:"侵略性", goalkeeping:"守门", reflexes:"反应",
};

function selectedContentPlayer() {
  return contentData?.players.find((player) => player.id === selectedContentPlayerId) ?? null;
}

function selectedContentTrait() {
  return contentData?.traits.find((trait) => trait.id === selectedContentTraitId) ?? null;
}

function contentPlayerRows(entries = contentData.players) {
  return entries.map((player) => `<button class="content-list-row ${player.id === selectedContentPlayerId ? "active" : ""}" data-content-player="${escapeHtml(player.id)}"><span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.sourceName)} · ${escapeHtml(player.club)}</small></span><em>${escapeHtml(player.pool)} / ${escapeHtml(player.role)}</em><strong>${player.overall}<small>${escapeHtml(player.grade)}</small></strong></button>`).join("");
}

function contentTraitRows(entries = contentData.traits) {
  return entries.map((trait) => `<button class="content-list-row trait-row ${trait.id === selectedContentTraitId ? "active" : ""}" data-content-trait="${escapeHtml(trait.id)}"><span><b>${escapeHtml(trait.name)}</b><small>${escapeHtml(trait.summary || "尚未填写效果说明")}</small></span><em>${escapeHtml((trait.eligibleRoleGroups ?? []).map((role) => CONTENT_ROLE_LABELS[role] ?? role).join(" / "))}</em></button>`).join("");
}

function bindContentLists() {
  document.querySelectorAll("[data-content-player]").forEach((button) => {
    button.onclick = () => { selectedContentPlayerId = button.dataset.contentPlayer; renderContentPlayerEditor(); filterContentPlayers(); };
  });
  document.querySelectorAll("[data-content-trait]").forEach((button) => {
    button.onclick = () => { selectedContentTraitId = button.dataset.contentTrait; renderContentTraitEditor(); filterContentTraits(); };
  });
}

function filterContentPlayers() {
  const search = document.querySelector("#content-player-search")?.value.trim().toLowerCase() ?? "";
  const pool = document.querySelector("#content-player-pool")?.value ?? "all";
  const grade = document.querySelector("#content-player-grade")?.value ?? "all";
  const entries = contentData.players.filter((player) =>
    (pool === "all" || player.pool === pool)
    && (grade === "all" || player.grade === grade)
    && `${player.name} ${player.sourceName} ${player.club} ${player.nationality} ${player.id}`.toLowerCase().includes(search)
  );
  document.querySelector("#content-player-list").innerHTML = contentPlayerRows(entries) || `<p class="empty">没有匹配的球员</p>`;
  bindContentLists();
}

function filterContentTraits() {
  const search = document.querySelector("#content-trait-search")?.value.trim().toLowerCase() ?? "";
  const role = document.querySelector("#content-trait-role")?.value ?? "all";
  const entries = contentData.traits.filter((trait) =>
    (role === "all" || trait.eligibleRoleGroups.includes("ANY") || trait.eligibleRoleGroups.includes(role))
    && `${trait.name} ${trait.summary} ${trait.id}`.toLowerCase().includes(search)
  );
  document.querySelector("#content-trait-list").innerHTML = contentTraitRows(entries) || `<p class="empty">没有匹配的特性卡</p>`;
  bindContentLists();
}

function renderContentPlayerEditor() {
  const player = selectedContentPlayer();
  const editor = document.querySelector("#content-editor");
  if (!player) return void (editor.innerHTML = `<p class="empty">请选择一名球员</p>`);
  const availableRoles = contentData.playerRoles ?? Object.keys(ROLES);
  const roleOptions = availableRoles.map((role) => `<option value="${role}"${player.role === role ? " selected" : ""}>${escapeHtml(ROLES[role] ?? role)}（${role}）</option>`).join("");
  const secondaryOptions = `<option value="">无副位置</option>${availableRoles.filter((role) => role !== player.role).map((role) => `<option value="${role}"${player.secondaryRole === role ? " selected" : ""}>${escapeHtml(ROLES[role] ?? role)}（${role}）</option>`).join("")}`;
  const attributes = contentData.attributeNames.map((key) => `<label class="content-attribute"><span>${escapeHtml(CONTENT_ATTRIBUTE_LABELS[key] ?? key)}<small>${escapeHtml(key)}</small></span><input type="number" min="1" max="99" value="${player.attributes[key]}" data-content-attribute="${escapeHtml(key)}" /></label>`).join("");
  editor.innerHTML = `<form id="content-player-form" class="content-editor-form">
    <header><div><small>${escapeHtml(player.id)} · ${player.isLegend ? "传奇球员" : "S4正式球员"}</small><h2>${escapeHtml(player.name)}</h2></div><strong>${player.overall}<small>${escapeHtml(player.grade)}级</small></strong></header>
    <section><h3>基础资料与评级</h3><div class="content-form-grid">
      <label><span>中文显示名</span><input name="name" value="${escapeHtml(player.name)}" required /></label>
      <label><span>游戏能力</span><input name="overall" type="number" min="1" max="99" value="${player.overall}" required /></label>
      <label><span>评级</span><select name="grade">${["S","A","B","C"].map((grade) => `<option${player.grade === grade ? " selected" : ""}>${grade}</option>`).join("")}</select></label>
      <label><span>主位置</span><select name="role">${roleOptions}</select></label>
      <label><span>副位置</span><select name="secondaryRole">${secondaryOptions}</select></label>
      <label><span>国家队 / 国籍</span><input name="nationality" value="${escapeHtml(player.nationality)}" required /></label>
      <label><span>俱乐部</span><input name="club" value="${escapeHtml(player.club)}" required /></label>
      <label><span>身高（cm）</span><input name="heightCm" type="number" min="140" max="220" value="${player.heightCm}" required /></label>
      <label><span>EAFC参考能力</span><input value="${player.referenceOverall}" disabled /></label>
    </div></section>
    <section><h3>模拟核心能力</h3><div class="content-attribute-grid">${attributes}</div></section>
    <footer><span id="content-save-status">修改会立即进入当前YDL服务，并保存为独立覆盖数据。</span><button class="content-save-button">保存球员</button></footer>
  </form>`;
  document.querySelector("#content-player-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const attributesPatch = Object.fromEntries([...document.querySelectorAll("[data-content-attribute]")].map((input) => [input.dataset.contentAttribute, Number(input.value)]));
    const patch = {
      name:form.get("name"), overall:Number(form.get("overall")), grade:form.get("grade"), role:form.get("role"),
      secondaryRole:form.get("secondaryRole") || null, nationality:form.get("nationality"), club:form.get("club"),
      heightCm:Number(form.get("heightCm")), attributes:attributesPatch,
    };
    const status = document.querySelector("#content-save-status");
    status.textContent = "正在保存…";
    try {
      const saved = (await api(`/api/admin/content/players/${encodeURIComponent(player.id)}`, { method:"POST", body:patch })).player;
      contentData.players[contentData.players.findIndex((entry) => entry.id === saved.id)] = saved;
      status.textContent = "已保存并立即生效";
      filterContentPlayers();
      renderContentPlayerEditor();
    } catch (error) { status.textContent = error.message; }
  };
}

function renderContentTraitEditor() {
  const trait = selectedContentTrait();
  const editor = document.querySelector("#content-editor");
  if (!trait) return void (editor.innerHTML = `<p class="empty">请选择一张特性卡</p>`);
  const roles = contentData.roleGroups.map((role) => `<label class="content-role-check"><input type="checkbox" value="${role}"${trait.eligibleRoleGroups.includes(role) ? " checked" : ""} /><span>${escapeHtml(CONTENT_ROLE_LABELS[role])}</span></label>`).join("");
  editor.innerHTML = `<form id="content-trait-form" class="content-editor-form">
    <header><div><small>${escapeHtml(trait.id)} · YDL特性卡</small><h2>${escapeHtml(trait.name)}</h2></div><strong class="role-only">位置制<small>无稀有度</small></strong></header>
    <section><h3>卡牌内容</h3><div class="content-form-grid">
      <label><span>特性名称</span><input name="name" value="${escapeHtml(trait.name)}" required /></label>
      <label><span>内部分类</span><input value="${escapeHtml(trait.category)}" disabled /></label>
      <label class="span-all"><span>效果说明</span><textarea name="summary" rows="4" placeholder="在这里填写玩家看到的特性效果">${escapeHtml(trait.summary)}</textarea></label>
    </div></section>
    <section><h3>适用位置</h3><p class="content-help">选择“全位置”后会自动忽略其他位置；YDL特性卡不设置任何等级或稀有度。</p><div class="content-role-grid">${roles}</div></section>
    <section><h3>效果规则 JSON</h3><p class="content-help">使用七人制后台相同的规则结构。可以先只填写效果说明，规则留为 []，之后再补。</p><textarea id="content-trait-rules" class="rules-editor" rows="14">${escapeHtml(JSON.stringify(trait.rules ?? [], null, 2))}</textarea></section>
    <footer><span id="content-save-status">保存后新抽取及后续比赛立即使用新效果。</span><button class="content-save-button">保存特性</button></footer>
  </form>`;
  document.querySelector("#content-trait-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const checkedRoles = [...document.querySelectorAll(".content-role-check input:checked")].map((input) => input.value);
    const status = document.querySelector("#content-save-status");
    try {
      const rules = JSON.parse(document.querySelector("#content-trait-rules").value || "[]");
      const patch = { name:form.get("name"), summary:form.get("summary"), eligibleRoleGroups:checkedRoles, rules };
      status.textContent = "正在保存…";
      const saved = (await api(`/api/admin/content/traits/${encodeURIComponent(trait.id)}`, { method:"POST", body:patch })).trait;
      contentData.traits[contentData.traits.findIndex((entry) => entry.id === saved.id)] = saved;
      status.textContent = "已保存并立即生效";
      filterContentTraits();
      renderContentTraitEditor();
    } catch (error) { status.textContent = error.message.includes("JSON") ? "规则JSON格式错误" : error.message; }
  };
}

function renderContentAdmin() {
  logoutButton.hidden = false;
  const playerActive = contentTab === "players";
  app.innerHTML = `${adminNavMarkup("content")}<header class="page-head"><div><h1>S4球员与特性管理</h1><p>正式550人球员池与YDL位置制特性卡；保存后立即进入当前服务。</p></div><button id="content-refresh">刷新数据</button></header>
    <section class="kpis content-kpis"><article class="kpi"><small>正式球员</small><b>${contentData.players.length}</b></article><article class="kpi"><small>传奇球员</small><b>${contentData.players.filter((player) => player.isLegend).length}</b></article><article class="kpi"><small>YDL特性卡</small><b>${contentData.traits.length}</b></article><article class="kpi"><small>特性等级</small><b>无</b></article><article class="kpi"><small>适用位置分类</small><b>${contentData.roleGroups.length}</b></article></section>
    <div class="content-tabs"><button data-content-tab="players" class="${playerActive ? "active" : ""}">球员库管理</button><button data-content-tab="traits" class="${playerActive ? "" : "active"}">特性卡管理</button></div>
    <section class="content-workspace">
      <aside class="content-browser panel">
        <header class="panel-head"><div><h2>${playerActive ? "S4正式球员库" : "YDL特性卡"}</h2><small>${playerActive ? "姓名、能力、评级、位置与26项属性" : "仅按适用位置分类，不区分等级"}</small></div></header>
        ${playerActive ? `<div class="content-filters"><input class="search" id="content-player-search" placeholder="搜索姓名、俱乐部或国籍" /><select id="content-player-pool"><option value="all">全部位置池</option>${Object.entries(LEAGUE_POOL_LABELS).map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}</select><select id="content-player-grade"><option value="all">全部评级</option>${["S","A","B","C"].map((grade) => `<option>${grade}</option>`).join("")}</select></div><div class="content-list" id="content-player-list">${contentPlayerRows()}</div>`
          : `<div class="content-filters"><input class="search" id="content-trait-search" placeholder="搜索特性名称或说明" /><select id="content-trait-role"><option value="all">全部适用位置</option>${contentData.roleGroups.map((role) => `<option value="${role}">${CONTENT_ROLE_LABELS[role]}</option>`).join("")}</select></div><div class="content-list" id="content-trait-list">${contentTraitRows()}</div>`}
      </aside>
      <main class="content-editor panel" id="content-editor"></main>
    </section>`;
  bindAdminNav();
  document.querySelector("#content-refresh").onclick = loadContentAdmin;
  document.querySelectorAll("[data-content-tab]").forEach((button) => {
    button.onclick = () => { contentTab = button.dataset.contentTab; renderContentAdmin(); };
  });
  if (playerActive) {
    document.querySelector("#content-player-search").oninput = filterContentPlayers;
    document.querySelector("#content-player-pool").onchange = filterContentPlayers;
    document.querySelector("#content-player-grade").onchange = filterContentPlayers;
    renderContentPlayerEditor();
  } else {
    document.querySelector("#content-trait-search").oninput = filterContentTraits;
    document.querySelector("#content-trait-role").onchange = filterContentTraits;
    renderContentTraitEditor();
  }
  bindContentLists();
}

async function loadContentAdmin() {
  app.innerHTML = `<section class="loading">正在读取S4球员与YDL特性数据…</section>`;
  try {
    contentData = (await api("/api/admin/content")).content;
    selectedContentPlayerId = contentData.players.some((player) => player.id === selectedContentPlayerId) ? selectedContentPlayerId : contentData.players[0]?.id;
    selectedContentTraitId = contentData.traits.some((trait) => trait.id === selectedContentTraitId) ? selectedContentTraitId : contentData.traits[0]?.id;
    renderContentAdmin();
  } catch (error) {
    if (error.status === 401) renderLogin("登录已失效，请重新输入密码");
    else app.innerHTML = `<section class="loading">${escapeHtml(error.message)}</section>`;
  }
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
await loadEnvironment();
if (token) loadDashboard(); else renderLogin();
