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
  return players.map((player) => {
    const punishments = [player.moderation?.loginCooldownActive ? "登录冷却" : "", player.league?.rewardsSuspended ? "奖励暂停" : ""].filter(Boolean);
    return `<tr data-player="${escapeHtml(player.id)}"><td><b>${escapeHtml(player.nickname)}</b><small>${escapeHtml(player.id)}${punishments.length ? ` · ${punishments.join(" / ")}` : ""}</small></td><td>${player.summary?.played ?? 0}</td><td><strong>${player.summary?.wins ?? 0}</strong> / ${player.summary?.losses ?? 0}</td><td>${player.summary?.goals ?? 0}</td><td>${player.summary?.assists ?? 0}</td><td>${dateText(player.lastSeenAt)}</td></tr>`;
  }).join("");
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
  const coinGrantRows = (leagueData.coinGrants ?? []).slice(0, 30).map((grant) => `<tr><td><b>${coinText(grant.amount)}</b><small>${escapeHtml(grant.id)}</small></td><td>${grant.recipientMode === "all" ? "全体玩家" : "指定玩家"}</td><td>${grant.recipientCount}人</td><td>${dateText(grant.createdAt)}</td></tr>`).join("") || `<tr><td colspan="4">尚未发放金币</td></tr>`;
  const xGrowthGrantRows = (leagueData.xGrowthGrants ?? []).slice(0, 30).map((grant) => `<tr><td><b>${grant.points}点</b><small>${escapeHtml(grant.id)}</small></td><td>全体X球员玩家</td><td>${grant.recipientCount}人</td><td>${dateText(grant.createdAt)}</td></tr>`).join("") || `<tr><td colspan="4">尚未发放X球员加成点数</td></tr>`;
  const mailBroadcastRows = (leagueData.mailBroadcasts ?? []).slice(0, 30).map((mail) => `<tr><td><b>${escapeHtml(mail.title)}</b><small>${escapeHtml(mail.id)}</small></td><td>${escapeHtml(mail.summary)}</td><td>${mail.recipientCount}人</td><td>${dateText(mail.createdAt)}</td></tr>`).join("") || `<tr><td colspan="4">尚未发送全服邮件</td></tr>`;
  const badgePlayerOptions = leagueData.teams.filter((team) => !team.isAi).map((team) => `<option value="${escapeHtml(team.ownerId)}">${escapeHtml(team.ownerName)} · ${escapeHtml(team.name)} · ${escapeHtml(team.ownerId)}</option>`).join("");
  const badgeRows = leagueData.teams.flatMap((team) => (team.championBadges ?? []).map((badge) => ({ ...badge, ownerId:team.ownerId, ownerName:team.ownerName, teamName:team.name }))).sort((left,right) => Number(right.awardedAt) - Number(left.awardedAt)).map((badge) => { const isCup = badge.competition === "cup" || badge.type === "cup-champion"; return `<tr><td><span class="admin-champion-badge ${isCup ? "cup-champion-badge" : ""}"><i>${isCup ? "🏆" : "♛"}</i>${escapeHtml(badge.season)}${isCup ? " 杯赛" : " 联赛"}</span></td><td><b>${escapeHtml(badge.ownerName)}</b><small>${escapeHtml(badge.ownerId)}</small></td><td>${escapeHtml(badge.teamName)}</td><td>${dateText(badge.awardedAt)}</td></tr>`; }).join("") || `<tr><td colspan="4">尚未发放冠军徽章</td></tr>`;
  const worldCup = leagueData.worldCup;
  const worldCupOps = leagueData.worldCupOperations ?? {};
  const worldCupStartValue = new Date(Number(worldCup?.nextEventAt ?? Date.now() + 30 * 60 * 1000)).toLocaleString("sv-SE", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).replace(" ", "T");
  logoutButton.hidden = false;
  app.innerHTML = `${adminNavMarkup("league")}<header class="page-head"><div><h1>YellowDogs League</h1><p>${escapeHtml(season.name)} · ${season.status === "active" ? "进行中" : "已完成"} · 下一轮 ${dateText(season.nextRoundAt)}</p></div><button id="league-refresh">刷新联赛</button></header><section class="kpis league-admin-kpis"><article class="kpi"><small>当前赛季</small><b>${escapeHtml(season.name)}</b></article><article class="kpi"><small>联赛轮次</small><b>${season.currentRound}/${season.totalRounds}</b></article><article class="kpi"><small>已赛场次</small><b>${leagueData.matches}</b></article><article class="kpi"><small>真人球队</small><b>${humanTeams}/10</b></article><article class="kpi"><small>进行中选秀</small><b>${leagueData.drafts.length}</b></article></section><section class="league-admin-actions"><div><small>LEAGUE CONTROL</small><b>赛季运行控制</b><span>重启与新赛季都会保留真人球队、球员名单、金币和交易资产。</span></div><button id="league-simulate">立即模拟下一轮</button><button class="warning" id="league-restart">重启当前赛季</button><button class="danger" id="league-new-season">开启新赛季</button></section><div class="grid league-admin-grid"><section class="panel league-team-panel"><header class="panel-head"><div><h2>联赛球队</h2><small>积分与注册名单状态</small></div></header><div class="table-wrap"><table><thead><tr><th>#</th><th>球队</th><th>名单</th><th>赛</th><th>胜-平-负</th><th>进失</th><th>分</th></tr></thead><tbody>${leagueTeamRows()}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>球员池占用</h2><small>真人球队全服唯一，AI 不计入</small></div></header><div class="table-wrap"><table><thead><tr><th>位置池</th><th>总数</th><th>已签</th><th>选秀中</th><th>可用</th></tr></thead><tbody>${poolRows}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>进行中的选秀</h2><small>尚未确认 22 人名单的球队</small></div></header><div class="table-wrap"><table><thead><tr><th>球队/玩家</th><th>进度</th><th>开始时间</th></tr></thead><tbody>${drafts}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>赛季归档</h2><small>最近 12 次重启或换季记录</small></div></header><div class="table-wrap"><table><thead><tr><th>赛季</th><th>原因</th><th>轮次</th><th>比赛</th><th>归档时间</th></tr></thead><tbody>${archives}</tbody></table></div></section><section class="panel league-allocation-panel"><header class="panel-head"><div><h2>真人球员归属</h2><small>查看每名已签或选秀保留球员</small></div><input class="search" id="league-player-search" placeholder="搜索球员、球队或玩家" /></header><div class="table-wrap"><table><thead><tr><th>球员</th><th>位置</th><th>能力</th><th>状态</th><th>归属</th></tr></thead><tbody id="league-allocation-body">${leagueAllocationRows()}</tbody></table></div></section></div>`;
  document.querySelector(".league-admin-actions").insertAdjacentHTML("afterend", `<section class="panel league-world-cup-control"><header class="panel-head"><div><h2>今日世界杯运行控制</h2><small>错过杯赛决赛触发后，可独立补建并恢复今日赛事</small></div><b class="world-cup-status">${worldCup ? escapeHtml(worldCup.status) : "尚未创建"}</b></header><div class="world-cup-control-kpis"><span><small>杯赛决赛</small><b>${worldCupOps.cupFinalCompleted ? "已完成" : "未完成"}</b></span><span><small>赛程</small><b>${worldCup?.teams?.length ?? 0}队 / ${worldCup?.groups?.length ?? 0}组</b></span><span><small>场次</small><b>${worldCupOps.completedFixtures ?? 0}完 / ${worldCupOps.pendingFixtures ?? 0}待</b></span><span><small>直播</small><b>${worldCupOps.live ? "进行中" : "无"}</b></span><span><small>下一轮</small><b>${worldCup?.nextEventAt ? dateText(worldCup.nextEventAt) : "—"}</b></span><span><small>临时补位</small><b>${worldCupOps.temporaryFillerCount ?? 0}人</b></span></div><div class="world-cup-control-actions"><label><span>首轮/重排开球时间</span><input id="world-cup-starts-at" type="datetime-local" value="${worldCupStartValue}"></label><button class="primary" id="world-cup-bootstrap">补建今日世界杯</button><button id="world-cup-reanchor" ${worldCup && !worldCupOps.live ? "" : "disabled"}>重排未开赛时间</button><button class="warning" id="world-cup-start-next" ${worldCup && !worldCupOps.live && worldCupOps.pendingFixtures ? "" : "disabled"}>立即启动下一轮</button><button id="world-cup-repair" ${worldCup && !worldCupOps.live ? "" : "disabled"}>修复赛程名单</button><button class="danger" id="world-cup-close" ${worldCup && !worldCupOps.live && !["closed", "completed"].includes(worldCup.status) ? "" : "disabled"}>关闭今日世界杯</button></div></section>`);
  const automation = leagueData.dailyAutomation ?? {};
  document.querySelector(".league-admin-actions div span").textContent = automation.enabled
    ? `每日自动化已启用：北京时间09:51重置，10:01自动开启杯赛；联赛沿用10:00起每20分钟整点网格。上次奖励赛季：${automation.lastRewardedSeasonId ?? "暂无"}；上次自动重置：${automation.lastResetDate ?? "暂无"}。`
    : "每日自动化尚未启用；只有执行一次“完全重置联赛”后才会开始，并从次日按北京时间运行。";
  document.querySelector(".league-admin-kpis").insertAdjacentHTML("beforeend", `<article class="kpi"><small>S4所有权</small><b>${assetSummary.ownershipCount}</b></article><article class="kpi"><small>流通球员卡</small><b>${assetSummary.activeCardCount}</b></article><article class="kpi"><small>系统回收卡</small><b>${assetSummary.recycledCardCount}</b></article>`);
  document.querySelector(".page-head p").textContent = `${season.name} · ${seasonStatusLabel} · ${registrationOpen ? "等待管理员开启联赛推进" : `下一轮 ${dateText(season.nextRoundAt)}`}`;
  const simulateButton = document.querySelector("#league-simulate");
  simulateButton.disabled = registrationOpen || season.status === "completed";
  if (registrationOpen) simulateButton.textContent = "等待开启联赛推进";
  document.querySelector(".league-admin-actions").insertAdjacentHTML("beforeend", `<button class="primary" id="league-start-simulation" ${registrationOpen ? "" : "disabled"}>${registrationOpen ? "开启联赛推进" : season.status === "active" ? "联赛推进已开启" : "赛季已结束"}</button>`);
  document.querySelector(".league-admin-actions").insertAdjacentHTML("beforeend", `<button class="danger full-reset" id="league-full-reset">完全重置联赛</button>`);
  document.querySelector(".league-admin-actions").insertAdjacentHTML("beforeend", `<button class="danger full-reset" id="league-fresh-season">开启全新赛季</button>`);
  document.querySelector(".league-admin-actions").insertAdjacentHTML("beforeend", `<button id="league-cup-start" ${leagueData.cup?.status === "waiting" && season.status === "active" ? "" : "disabled"}>${registrationOpen ? "联赛推进后可开启杯赛" : leagueData.cup?.status === "waiting" ? "开启黄狗冠军杯" : `黄狗冠军杯：${leagueData.cup?.stage ?? "进行中"}`}</button><button class="warning" id="league-daily-reward">手动补发当日排名奖励</button><button class="danger" id="league-daily-reset">手动立即重置联赛与杯赛</button>`);
  document.querySelector(".league-allocation-panel").insertAdjacentHTML("beforebegin", `<section class="panel league-backup-panel"><header class="panel-head"><div><h2>联赛数据备份</h2><small>每天一份，自动保留最近 ${leagueData.backups.retentionDays} 天；完全重置前额外保存快照</small></div></header><div class="table-wrap"><table><thead><tr><th>文件</th><th>类型</th></tr></thead><tbody>${backupRows}</tbody></table></div></section>`);
  document.querySelector(".league-backup-panel").insertAdjacentHTML("beforebegin", `<section class="panel league-economy-panel"><header class="panel-head"><div><h2>玩家经济明细</h2><small>当前赛季商店开包、卡包签约、解约、转会与完整金币流水</small></div><select id="league-economy-team" ${economyOptions ? "" : "disabled"}>${economyOptions || `<option>${economyVersionReady ? "暂无玩家球队" : "等待服务重启"}</option>`}</select></header><div id="league-economy-detail">${leagueEconomyDetail(leagueData.economy?.[0]?.accountId)}</div></section>`);
  document.querySelector(".league-team-panel").insertAdjacentHTML("afterend", `<section class="panel league-reward-mail-panel"><header class="panel-head"><div><h2>S4礼包发放</h2><small>旧赛季礼包已经下架；可向所有已建队玩家或指定玩家立即发放新礼包。</small></div></header><form id="league-s4-pack-grant-form" class="league-reward-mail-form"><label><span>礼包类型</span><select name="packType">${s4PackTypeOptions}</select></label><label><span>每人数量</span><input name="quantity" type="number" min="1" max="50" value="1" required></label><label><span>发放范围</span><select name="recipientMode"><option value="all">所有玩家</option><option value="specified">指定玩家</option></select></label><label id="league-s4-recipient-field" hidden><span>指定玩家</span><select name="accountIds" multiple size="5">${s4RecipientOptions}</select></label><button type="submit" ${s4PackTypeOptions ? "" : "disabled"}>立即发放礼包</button></form><div class="table-wrap"><table><thead><tr><th>礼包</th><th>数量</th><th>范围</th><th>接收人数</th><th>时间</th></tr></thead><tbody>${s4GrantRows}</tbody></table></div></section>`);
  document.querySelector(".league-reward-mail-panel").insertAdjacentHTML("afterend", `<section class="panel league-admin-mail-panel"><header class="panel-head"><div><h2>全服更新邮件</h2><small>向所有已建队玩家发送管理员公告，邮件会立即出现在玩家收件箱。</small></div></header><form id="league-admin-mail-form" class="league-reward-mail-form league-admin-mail-form"><label><span>邮件标题</span><input name="title" maxlength="80" placeholder="例如：V2引擎与阵型线更新" required></label><label><span>邮件摘要（可选）</span><input name="summary" maxlength="200" placeholder="留空时自动截取正文"></label><label class="league-admin-mail-body"><span>邮件正文</span><textarea name="body" maxlength="5000" rows="7" placeholder="填写完整更新内容" required></textarea></label><button type="submit" ${humanTeams ? "" : "disabled"}>发送给全体玩家</button></form><div class="table-wrap"><table><thead><tr><th>标题</th><th>摘要</th><th>接收人数</th><th>发送时间</th></tr></thead><tbody>${mailBroadcastRows}</tbody></table></div></section>`);
  document.querySelector(".league-reward-mail-panel").insertAdjacentHTML("beforebegin", `<section class="panel league-coin-grant-panel"><header class="panel-head"><div><h2>金币即时发放</h2><small>向所有已建队玩家或指定玩家发放金币，提交后余额立即到账并发送邮件通知。</small></div></header><form id="league-coin-grant-form" class="league-reward-mail-form"><label><span>每人金币数量</span><input name="amount" type="number" min="1" max="1000000000" step="1" value="1000" required></label><label><span>发放范围</span><select name="recipientMode"><option value="all">所有玩家</option><option value="specified">指定玩家</option></select></label><label id="league-coin-recipient-field" hidden><span>指定玩家</span><select name="accountIds" multiple size="5">${s4RecipientOptions}</select></label><button type="submit" ${s4RecipientOptions ? "" : "disabled"}>立即发放金币</button></form><div class="table-wrap"><table><thead><tr><th>每人金额</th><th>范围</th><th>接收人数</th><th>时间</th></tr></thead><tbody>${coinGrantRows}</tbody></table></div></section>`);
  document.querySelector(".league-coin-grant-panel").insertAdjacentHTML("afterend", `<section class="panel league-x-growth-grant-panel"><header class="panel-head"><div><h2>X球员加成点数发放</h2><small>向所有已经拥有X球员的玩家统一发放加成点数，提交后立即到账并发送邮件通知。</small></div></header><form id="league-x-growth-grant-form" class="league-reward-mail-form"><label><span>每名X球员获得点数</span><input name="points" type="number" min="1" max="1000" step="1" value="1" required></label><button type="submit" ${humanTeams ? "" : "disabled"}>向全部X球员发放</button></form><div class="table-wrap"><table><thead><tr><th>每人点数</th><th>范围</th><th>接收人数</th><th>时间</th></tr></thead><tbody>${xGrowthGrantRows}</tbody></table></div></section>`);
  document.querySelector(".league-reward-mail-panel").insertAdjacentHTML("afterend", `<section class="panel league-card-grant-panel"><header class="panel-head"><div><h2>指定球员卡发放</h2><small>向任意已建队玩家发放指定球员、指定强化等级的测试卡；强化等级支持0至8级。</small></div></header><form id="league-s4-card-grant-form" class="league-card-grant-form"><label><span>接收玩家</span><select name="accountId" ${s4RecipientOptions ? "" : "disabled"}>${s4RecipientOptions || `<option>暂无真人玩家</option>`}</select></label><label><span>搜索球员</span><input id="league-s4-player-search" placeholder="输入中文名、俱乐部、位置或ID"></label><label><span>指定球员</span><select id="league-s4-player-select" name="playerId" ${s4PlayerOptions ? "" : "disabled"}>${s4PlayerOptions || `<option>暂无球员数据</option>`}</select></label><label><span>强化等级</span><select name="upgradeLevel">${Array.from({ length:9 }, (_, level) => `<option value="${level}">${level ? `+${level}` : "无强化"}</option>`).join("")}</select></label><label><span>发放数量</span><input name="quantity" type="number" min="1" max="50" value="1" required></label><button type="submit" ${s4RecipientOptions && s4PlayerOptions ? "" : "disabled"}>发放指定球员卡</button></form><div class="table-wrap"><table><thead><tr><th>球员</th><th>强化</th><th>数量</th><th>接收玩家</th><th>所有权</th><th>时间</th></tr></thead><tbody>${s4CardGrantRows}</tbody></table></div></section>`);
  document.querySelector(".league-card-grant-panel").insertAdjacentHTML("afterend", `<section class="panel league-badge-panel"><header class="panel-head"><div><h2>冠军徽章发放</h2><small>可发放皇冠联赛冠军徽章，或带赛季标记的奖杯杯赛冠军徽章</small></div></header><form id="league-badge-form" class="league-badge-form"><label><span>联赛玩家</span><select name="accountId" ${badgePlayerOptions ? "" : "disabled"}>${badgePlayerOptions || `<option>暂无真人玩家</option>`}</select></label><label><span>冠军荣誉</span><select name="badge">${BADGE_OPTIONS.map((badge) => `<option value="${badge.competition}:${badge.season}">${badge.label}</option>`).join("")}</select></label><button type="submit" ${badgePlayerOptions ? "" : "disabled"}>发放徽章</button></form><div class="table-wrap"><table><thead><tr><th>徽章</th><th>玩家</th><th>球队</th><th>发放时间</th></tr></thead><tbody>${badgeRows}</tbody></table></div></section>`);
  bindAdminNav();
  document.querySelector("#league-refresh").onclick = loadLeagueAdmin;
  const worldCupStartsAt = () => new Date(document.querySelector("#world-cup-starts-at").value).toISOString();
  document.querySelector("#world-cup-bootstrap").onclick = () => runLeagueAdminAction("/api/admin/league/world-cup/bootstrap", { startsAt:worldCupStartsAt() }, "今日世界杯已补建，系统会按设定时间自动开赛");
  document.querySelector("#world-cup-reanchor").onclick = () => runLeagueAdminAction("/api/admin/league/world-cup/reanchor", { startsAt:worldCupStartsAt() }, "世界杯未开赛轮次已重新定时");
  document.querySelector("#world-cup-start-next").onclick = () => { if (window.confirm("确认立即启动下一轮世界杯比赛并接入电视台？")) runLeagueAdminAction("/api/admin/league/world-cup/start-next", {}, "下一轮世界杯已经启动"); };
  document.querySelector("#world-cup-repair").onclick = () => runLeagueAdminAction("/api/admin/league/world-cup/repair", {}, "世界杯赛程与名单已完成修复");
  document.querySelector("#world-cup-close").onclick = () => { if (window.confirm("确认关闭今日世界杯？未赛场次将不再启动，临时补位球员会立即清理。")) runLeagueAdminAction("/api/admin/league/world-cup/close", {}, "今日世界杯已关闭"); };
  document.querySelector("#league-player-search").oninput = (event) => {
    const term = event.target.value.trim().toLowerCase();
    const filtered = leagueData.allocations.filter((player) => `${player.name} ${player.id} ${player.teamName} ${player.ownerName ?? ""}`.toLowerCase().includes(term));
    document.querySelector("#league-allocation-body").innerHTML = leagueAllocationRows(filtered);
  };
  const economySelect = document.querySelector("#league-economy-team");
  economySelect.onchange = () => { document.querySelector("#league-economy-detail").innerHTML = leagueEconomyDetail(economySelect.value); };
  const coinGrantForm = document.querySelector("#league-coin-grant-form");
  const coinRecipientMode = coinGrantForm.querySelector("[name=recipientMode]");
  const coinRecipientField = document.querySelector("#league-coin-recipient-field");
  const syncCoinRecipients = () => {
    const specified = coinRecipientMode.value === "specified";
    coinRecipientField.hidden = !specified;
    coinRecipientField.querySelector("select").disabled = !specified;
  };
  coinRecipientMode.onchange = syncCoinRecipients;
  syncCoinRecipients();
  coinGrantForm.onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const amount = Number(form.get("amount"));
    const recipientMode = String(form.get("recipientMode"));
    const accountIds = form.getAll("accountIds").map(String);
    const scope = recipientMode === "all" ? "所有已建队玩家" : `${accountIds.length}名指定玩家`;
    if (recipientMode === "specified" && !accountIds.length) return window.alert("请至少选择一名玩家");
    if (window.confirm(`确认向${scope}每人发放${amount.toLocaleString()}金币？金币会立即到账。`)) runLeagueAdminAction("/api/admin/league/coins/grant", { amount, recipientMode, accountIds }, "金币已经发放并立即到账");
  };
  document.querySelector("#league-admin-mail-form").onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const title = String(form.get("title") ?? "").trim();
    const summary = String(form.get("summary") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    if (window.confirm(`确认向全部 ${humanTeams} 名已建队玩家发送“${title}”？`)) {
      runLeagueAdminAction("/api/admin/league/mail/broadcast", { title, summary, body }, "全服更新邮件已经发送");
    }
  };
  const xGrowthGrantForm = document.querySelector("#league-x-growth-grant-form");
  xGrowthGrantForm.onsubmit = (event) => {
    event.preventDefault();
    const points = Number(new FormData(event.target).get("points"));
    if (window.confirm(`确认向所有拥有X球员的玩家每人发放${points}点加成点数？点数会立即到账。`)) runLeagueAdminAction("/api/admin/league/x-growth/grant", { points }, "X球员加成点数已经发放并立即到账");
  };
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
      runLeagueAdminAction("/api/admin/league/s4-cards/grant", { accountId, playerId, upgradeLevel, quantity }, "指定球员卡已经发放并进入玩家背包", {
        apply:(value) => {
          const grant = value.cardGrant?.grant;
          if (grant) leagueData.s4CardGrants = [grant, ...(leagueData.s4CardGrants ?? []).filter((entry) => entry.id !== grant.id)];
        },
      });
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
  document.querySelector("#league-daily-reward").onclick = () => {
    if (window.confirm("确认按当前已完成赛季排名补发每日奖励？已发放的赛季不会重复发奖。")) runLeagueAdminAction("/api/admin/league/daily-settlement/reward", {}, "当日排名奖励已补发或已确认发放");
  };
  document.querySelector("#league-daily-reset").onclick = () => {
    const confirmation = window.prompt("此操作只重置联赛和杯赛进度，并恢复球员体力、伤病和停赛状态；球队、球员、金币、邮件、卡包、卡牌与交易资产均保留。\n\n请输入：立即重置每日联赛");
    if (confirmation === "立即重置每日联赛") runLeagueAdminAction("/api/admin/league/daily-reset", { confirm:"DAILY_RESET_YDL" }, "每日联赛与杯赛已重置，玩家资产保持不变");
    else if (confirmation !== null) window.alert("确认文字不正确，操作已取消");
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

async function runLeagueAdminAction(path, body, message, options = {}) {
  try {
    const value = await api(path, { method:"POST", body });
    if (value.league) leagueData = value.league;
    options.apply?.(value);
    renderLeagueAdmin();
    window.alert(message);
  } catch (error) { window.alert(error.message); }
}

function renderLeagueRecovery(error) {
  logoutButton.hidden = false;
  app.innerHTML = `${adminNavMarkup("league")}<section class="league-recovery"><small>SEASON DATA CONFLICT</small><h1>旧赛季数据与新球员评级冲突</h1><p>${escapeHtml(error.message)}</p><p class="league-recovery-note">当前旧赛季不会被迁移。开启全新赛季后，球队、球员卡、金币、背包、交易和比赛数据将清空，玩家账号会保留。</p><label><span>输入“开启全新黄狗联赛赛季”确认</span><input id="league-recovery-confirmation" autocomplete="off" placeholder="开启全新黄狗联赛赛季"></label><div><button id="league-recovery-dashboard">返回运营总览</button><button class="danger" id="league-recovery-fresh" disabled>开启全新赛季</button></div><p class="league-recovery-feedback" id="league-recovery-feedback"></p></section>`;
  bindAdminNav();
  document.querySelector("#league-recovery-dashboard").onclick = loadDashboard;
  const confirmationInput = document.querySelector("#league-recovery-confirmation");
  const freshButton = document.querySelector("#league-recovery-fresh");
  confirmationInput.oninput = () => { freshButton.disabled = confirmationInput.value.trim() !== "开启全新黄狗联赛赛季"; };
  freshButton.onclick = async () => {
    const feedback = document.querySelector("#league-recovery-feedback");
    freshButton.disabled = true;
    feedback.textContent = "正在建立全新赛季…";
    try {
      leagueData = (await api("/api/admin/league/fresh-season", { method:"POST", body:{ confirm:"FRESH_SEASON_YDL" } })).league;
      renderLeagueAdmin();
    } catch (reason) {
      feedback.textContent = reason.message;
      freshButton.disabled = false;
    }
  };
}

async function loadLeagueAdmin() {
  app.innerHTML = `<section class="loading">正在读取黄狗联赛数据…</section>`;
  try { leagueData = (await api("/api/admin/league")).league; renderLeagueAdmin(); }
  catch (error) { if (error.status === 401) renderLogin("登录已失效，请重新输入密码"); else renderLeagueRecovery(error); }
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
  return entries.map((trait) => `<button class="content-list-row trait-row ${trait.id === selectedContentTraitId ? "active" : ""}" data-content-trait="${escapeHtml(trait.id)}"><span><b>${escapeHtml(trait.name)}${trait.status === "draft" ? `<i class="content-status-badge">待实现</i>` : ""}</b><small>${escapeHtml(trait.summary || "尚未填写效果说明")}</small></span><em>${escapeHtml((trait.eligibleRoleGroups ?? []).map((role) => CONTENT_ROLE_LABELS[role] ?? role).join(" / "))}</em></button>`).join("");
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
  const isDraft = trait.status === "draft";
  editor.innerHTML = `<form id="content-trait-form" class="content-editor-form">
    <header><div><small>${escapeHtml(trait.id)} · ${isDraft ? "自定义特性草稿" : "YDL正式特性卡"}</small><h2>${escapeHtml(trait.name)}</h2></div><strong class="role-only">${isDraft ? "待实现" : "已生效"}<small>${isDraft ? "不进入强化池" : "比赛运行中"}</small></strong></header>
    <section><h3>卡牌内容</h3><div class="content-form-grid">
      <label><span>特性名称</span><input name="name" value="${escapeHtml(trait.name)}" required /></label>
      <label><span>内部分类</span><input value="${escapeHtml(trait.category)}" disabled /></label>
      <label class="span-all"><span>效果说明</span><textarea name="summary" rows="4" placeholder="在这里填写玩家看到的特性效果">${escapeHtml(trait.summary)}</textarea></label>
    </div></section>
    <section><h3>适用位置</h3><p class="content-help">选择“全位置”后会自动忽略其他位置；YDL特性卡不设置任何等级或稀有度。</p><div class="content-role-grid">${roles}</div></section>
    <section><h3>效果规则 JSON</h3><p class="content-help">${isDraft ? "新建卡暂不进入强化候选池。程序规则由开发实现并验证后再转为正式卡。" : "这里显示当前比赛运行时实际读取的 S4 规则；保存后新比赛立即使用。"}</p><textarea id="content-trait-rules" class="rules-editor" rows="14"${isDraft ? " disabled" : ""}>${escapeHtml(JSON.stringify(trait.rules ?? [], null, 2))}</textarea></section>
    <footer><span id="content-save-status">${isDraft ? "可继续修改名称、效果说明和适用位置。" : "保存后新抽取及后续比赛立即使用新效果。"}</span><button class="content-save-button">保存特性</button></footer>
  </form>`;
  document.querySelector("#content-trait-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const checkedRoles = [...document.querySelectorAll(".content-role-check input:checked")].map((input) => input.value);
    const status = document.querySelector("#content-save-status");
    try {
      const rules = isDraft ? undefined : JSON.parse(document.querySelector("#content-trait-rules").value || "[]");
      const patch = { name:form.get("name"), summary:form.get("summary"), eligibleRoleGroups:checkedRoles, ...(isDraft ? {} : { rules }) };
      status.textContent = "正在保存…";
      const saved = (await api(`/api/admin/content/traits/${encodeURIComponent(trait.id)}`, { method:"POST", body:patch })).trait;
      contentData.traits[contentData.traits.findIndex((entry) => entry.id === saved.id)] = saved;
      status.textContent = "已保存并立即生效";
      filterContentTraits();
      renderContentTraitEditor();
    } catch (error) { status.textContent = error.message.includes("JSON") ? "规则JSON格式错误" : error.message; }
  };
}

function openCreateContentTrait() {
  const roles = contentData.roleGroups.map((role) => `<label class="content-role-check"><input name="eligibleRoleGroups" type="checkbox" value="${role}"${role === "ANY" ? " checked" : ""} /><span>${escapeHtml(CONTENT_ROLE_LABELS[role])}</span></label>`).join("");
  showModal(`<form id="content-trait-create-form" class="content-editor-form content-create-form">
    <header><div><small>NEW YDL TRAIT</small><h2>手动添加特性卡</h2></div><button type="button" data-close>×</button></header>
    <section><div class="content-form-grid">
      <label><span>特性名称</span><input name="name" required autofocus /></label>
      <label class="span-all"><span>效果说明</span><textarea name="summary" rows="5" required placeholder="清楚描述触发条件、作用对象和具体效果"></textarea></label>
    </div></section>
    <section><h3>适用位置</h3><div class="content-role-grid">${roles}</div></section>
    <section class="content-draft-notice"><b>新卡会先保存为“待实现”草稿</b><p>系统自动生成内部 ID。草稿不会进入强化候选池或比赛；开发补齐程序规则并通过测试后再正式启用。</p></section>
    <footer><span id="content-create-status">只需填写名称、效果和适用位置。</span><button class="content-save-button">创建特性卡</button></footer>
  </form>`);
  document.querySelector("#content-trait-create-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const status = document.querySelector("#content-create-status");
    const eligibleRoleGroups = form.getAll("eligibleRoleGroups");
    status.textContent = "正在创建…";
    try {
      const created = (await api("/api/admin/content/traits", {
        method:"POST",
        body:{ name:form.get("name"), summary:form.get("summary"), eligibleRoleGroups },
      })).trait;
      contentData.traits.push(created);
      selectedContentTraitId = created.id;
      closeModal();
      renderContentAdmin();
    } catch (error) { status.textContent = error.message; }
  };
}

function renderContentAdmin() {
  logoutButton.hidden = false;
  const playerActive = contentTab === "players";
  app.innerHTML = `${adminNavMarkup("content")}<header class="page-head"><div><h1>S4球员与特性管理</h1><p>正式550人球员池与YDL位置制特性卡；保存后立即进入当前服务。</p></div><button id="content-refresh">刷新数据</button></header>
    <section class="kpis content-kpis"><article class="kpi"><small>正式球员</small><b>${contentData.players.length}</b></article><article class="kpi"><small>传奇球员</small><b>${contentData.players.filter((player) => player.isLegend).length}</b></article><article class="kpi"><small>正式特性卡</small><b>${contentData.traits.filter((trait) => trait.status === "active").length}</b></article><article class="kpi"><small>待实现草稿</small><b>${contentData.traits.filter((trait) => trait.status === "draft").length}</b></article><article class="kpi"><small>适用位置分类</small><b>${contentData.roleGroups.length}</b></article></section>
    <div class="content-tabs"><button data-content-tab="players" class="${playerActive ? "active" : ""}">球员库管理</button><button data-content-tab="traits" class="${playerActive ? "" : "active"}">特性卡管理</button></div>
    <section class="content-workspace">
      <aside class="content-browser panel">
        <header class="panel-head"><div><h2>${playerActive ? "S4正式球员库" : "YDL特性卡"}</h2><small>${playerActive ? "姓名、能力、评级、位置与26项属性" : "正式运行卡与待实现草稿"}</small></div>${playerActive ? "" : `<button class="content-add-button" id="content-trait-create">+ 添加特性</button>`}</header>
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
    document.querySelector("#content-trait-create").onclick = openCreateContentTrait;
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
  try { renderPlayerDetail((await api(`/api/admin/players/${encodeURIComponent(id)}`)).player); }
  catch (error) { closeModal(); alert(error.message); }
}

function playerDisciplineMarkup(player) {
  const cooldown = player.moderation ?? {};
  const league = player.league ?? {};
  const cooldownStatus = cooldown.loginCooldownActive
    ? `<p class="discipline-status active">登录已暂停至 ${dateText(cooldown.loginCooldownUntil)}<small>${escapeHtml(cooldown.loginCooldownReason)}</small></p>`
    : `<p class="discipline-status">当前允许正常登录</p>`;
  const rewardStatus = league.rewardsSuspended
    ? `<p class="discipline-status active">联赛及杯赛奖励已暂停<small>${escapeHtml(league.rewardSuspension?.reason ?? "")}</small></p>`
    : `<p class="discipline-status">联赛及杯赛奖励正常发放</p>`;
  return `<section class="panel discipline-panel"><header class="panel-head"><div><h2>纪律处罚</h2><small>所有操作均写入服务端记录；常规处罚可选择全服通告，强制解散会固定全服通告</small></div></header><div class="discipline-grid">
    <form id="discipline-coins"><h3>移除金币</h3><p>当前余额：<b>${league.balance == null ? "尚未建队" : `${Number(league.balance).toLocaleString()} 金币`}</b></p><label><span>扣除数量</span><input name="amount" type="number" min="1" max="${Math.max(1, Number(league.balance ?? 1))}" value="1000" required ${league.balance == null ? "disabled" : ""}></label><label><span>处罚原因</span><textarea name="reason" maxlength="200" required></textarea></label><label class="discipline-announce"><input name="announce" type="checkbox" checked>发送全服邮件通告</label><button class="danger" ${league.balance == null ? "disabled" : ""}>确认扣除金币</button></form>
    <form id="discipline-login"><h3>登录冷却</h3>${cooldownStatus}${cooldown.loginCooldownActive ? `<label><span>解除原因</span><textarea name="reason" maxlength="200">处罚期结束</textarea></label><input name="mode" type="hidden" value="clear">` : `<label><span>冷却时长</span><select name="durationMinutes"><option value="30">30分钟</option><option value="60">1小时</option><option value="360">6小时</option><option value="1440">1天</option><option value="4320">3天</option><option value="10080">7天</option><option value="43200">30天</option></select></label><label><span>处罚原因</span><textarea name="reason" maxlength="200" required></textarea></label>`}<label class="discipline-announce"><input name="announce" type="checkbox" checked>发送全服邮件通告</label><button class="${cooldown.loginCooldownActive ? "" : "danger"}">${cooldown.loginCooldownActive ? "解除登录限制" : "执行登录冷却"}</button></form>
    <form id="discipline-rewards"><h3>赛事奖励</h3>${rewardStatus}<input name="suspended" type="hidden" value="${league.rewardsSuspended ? "false" : "true"}"><label><span>${league.rewardsSuspended ? "恢复原因" : "处罚原因"}</span><textarea name="reason" maxlength="200" ${league.rewardsSuspended ? "" : "required"}>${league.rewardsSuspended ? "处罚期结束" : ""}</textarea></label><label class="discipline-announce"><input name="announce" type="checkbox" checked>发送全服邮件通告</label><button class="${league.rewardsSuspended ? "" : "danger"}" ${league.teamId ? "" : "disabled"}>${league.rewardsSuspended ? "恢复后续奖励" : "暂停联赛及杯赛奖励"}</button><small>暂停期间错过的奖励不会在恢复后补发。</small></form>
    <form id="discipline-dissolve" class="discipline-dissolve"><h3>强制解散球队（最高处罚）</h3><p>系统将回收该账户的金币、全部球员卡、所有权、强化资产、未开启礼包、未结算预测投入及X球员；清算所得金币全部补偿给其他玩家。原席位由AI接替，并立即按每日重置规则重开联赛与杯赛。</p><label><span>严重违规原因</span><textarea name="reason" maxlength="200" required></textarea></label><button class="danger" ${league.teamId ? "" : "disabled"}>强制解散并全服通告</button><small>此操作会自动创建服务端备份。提交后还需要输入“强制解散球队”进行二次确认。</small></form>
  </div></section>`;
}

function renderPlayerDetail(player) {
  const s = player.summary;
  showModal(`<header class="dialog-head"><button data-close>×</button><div><small>${escapeHtml(player.id)} · 注册于 ${dateText(player.createdAt)}</small><h2>${escapeHtml(player.nickname)}</h2></div></header><div class="dialog-body"><div class="detail-kpis"><span><small>比赛</small><b>${s.played}</b></span><span><small>胜 / 负</small><b>${s.wins} / ${s.losses}</b></span><span><small>进球</small><b>${s.goals}</b></span><span><small>助攻</small><b>${s.assists}</b></span></div>${playerDisciplineMarkup(player)}<section class="panel"><header class="panel-head"><h2>历史比赛</h2></header><div class="match-list">${player.matches.map((match) => `<button class="match-row" ${match.matchId ? `data-match="${escapeHtml(match.matchId)}"` : "disabled"}><time>${shortDate(match.playedAt)}</time><span><b>对阵 ${escapeHtml(match.opponentName)}</b><small>${escapeHtml(match.ownFormation ?? "阵型未知")} vs ${escapeHtml(match.opponentFormation ?? "阵型未知")} · ${match.goals}球 ${match.assists}助</small></span><strong>${match.scoreFor}:${match.scoreAgainst}</strong></button>`).join("") || `<p class="empty">暂无比赛</p>`}</div></section></div>`);
  bindMatchRows();
  bindPlayerDiscipline(player);
}

function bindPlayerDiscipline(player) {
  const run = async (path, body, confirmation) => {
    if (!window.confirm(confirmation)) return;
    try {
      const value = await api(path, { method:"POST", body });
      if (dashboard) {
        const index = dashboard.players.findIndex((entry) => entry.id === player.id);
        if (index >= 0) dashboard.players[index] = { ...dashboard.players[index], moderation:value.player.moderation, league:value.player.league };
      }
      renderPlayerDetail(value.player);
    } catch (error) { window.alert(error.message); }
  };
  document.querySelector("#discipline-coins").onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const amount = Number(form.get("amount"));
    run(`/api/admin/players/${encodeURIComponent(player.id)}/coins/remove`, { amount, reason:String(form.get("reason")), announce:form.has("announce") }, `确认从${player.nickname}账户扣除${amount.toLocaleString()}金币？`);
  };
  document.querySelector("#discipline-login").onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const clearing = form.get("mode") === "clear";
    const path = `/api/admin/players/${encodeURIComponent(player.id)}/login-cooldown${clearing ? "/clear" : ""}`;
    const body = { reason:String(form.get("reason")), announce:form.has("announce"), ...(clearing ? {} : { durationMinutes:Number(form.get("durationMinutes")) }) };
    run(path, body, clearing ? `确认解除${player.nickname}的登录限制？` : `确认暂停${player.nickname}登录？当前账号凭证会立即失效。`);
  };
  document.querySelector("#discipline-rewards").onsubmit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const suspended = form.get("suspended") === "true";
    run(`/api/admin/players/${encodeURIComponent(player.id)}/rewards/suspension`, { suspended, reason:String(form.get("reason")), announce:form.has("announce") }, suspended ? `确认暂停向${player.nickname}发放联赛及杯赛奖励？` : `确认恢复${player.nickname}后续赛事奖励？`);
  };
  document.querySelector("#discipline-dissolve").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    if (window.prompt(`这是最高等级且不可撤销的处罚。请输入“强制解散球队”以解散${player.nickname}的球队：`) !== "强制解散球队") return;
    try {
      const value = await api(`/api/admin/players/${encodeURIComponent(player.id)}/team/dissolve`, {
        method:"POST",
        body:{ reason:String(form.get("reason")), confirm:"DISSOLVE_YDL_TEAM" },
      });
      if (dashboard) {
        const index = dashboard.players.findIndex((entry) => entry.id === player.id);
        if (index >= 0) dashboard.players[index] = { ...dashboard.players[index], moderation:value.player.moderation, league:value.player.league };
      }
      window.alert(`球队已强制解散，共清算${Number(value.action.totalRecoveryAmount).toLocaleString()}金币并补偿给${value.action.recipientCount}位玩家。`);
      renderPlayerDetail(value.player);
    } catch (error) { window.alert(error.message); }
  };
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
