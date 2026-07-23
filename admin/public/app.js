const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const logoutButton = document.querySelector("#logout");
const TOKEN_KEY = "ft1-admin-session";
const TACTICS = { allOutAttack:"全力进攻",positive:"积极进攻",balanced:"攻守平衡",defensive:"防守反击",parkBus:"全力防守" };
const STYLES = { possession:"密集短传",longBall:"长传冲吊",wingPlay:"两翼齐飞",counterAttack:"防守反击",highPress:"高位压迫",lowBlock:"摆大巴",roughPlay:"伐木" };
let token = sessionStorage.getItem(TOKEN_KEY);
let dashboard = null;
let competitionTab = "formations";

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
  bindPlayerRows(); bindMatchRows();
}

function bindPlayerRows() { document.querySelectorAll("[data-player]").forEach((row) => { row.onclick = () => openPlayer(row.dataset.player); }); }
function bindMatchRows() { document.querySelectorAll("[data-match]").forEach((row) => { row.onclick = () => openMatch(row.dataset.match); }); }

function renderDashboard() {
  const value = dashboard.overview;
  logoutButton.hidden = false;
  app.innerHTML = `<header class="page-head"><div><h1>运营总览</h1><p>注册玩家、历史比赛与竞技平衡数据</p></div><button id="refresh">刷新数据</button></header><section class="kpis"><article class="kpi"><small>注册玩家</small><b>${value.registeredPlayers}</b></article><article class="kpi"><small>7日活跃</small><b>${value.activePlayers7d}</b></article><article class="kpi"><small>独立比赛</small><b>${value.matches}</b></article><article class="kpi"><small>场均进球</small><b>${value.averageGoals}</b></article><article class="kpi"><small>黑哨事件</small><b>${value.blackWhistles}</b></article></section><div class="grid"><section class="panel"><header class="panel-head"><div><h2>竞技统计</h2><small>每场比赛仅统计一次，主客双方各计一个阵型样本</small></div><div class="tabs"><button data-tab="formations">阵型</button><button data-tab="tactics">思路</button><button data-tab="styles">战术</button></div></header><div class="table-wrap"><table><thead><tr><th>项目</th><th>场次</th><th>胜率</th><th>进球</th><th>失球</th></tr></thead><tbody id="competition-body">${competitionRows()}</tbody></table></div></section><section class="panel"><header class="panel-head"><div><h2>最近比赛</h2><small>${value.detailedMatches} 场含完整详情</small></div></header><div class="match-list">${matchRows(dashboard.matches) || `<p class="empty">暂无比赛</p>`}</div></section><section class="panel" style="grid-column:1/-1"><header class="panel-head"><div><h2>玩家管理</h2><small>不展示任何账号登录凭证</small></div><input class="search" id="player-search" placeholder="搜索昵称或玩家ID" /></header><div class="table-wrap"><table><thead><tr><th>玩家</th><th>场次</th><th>胜/负</th><th>进球</th><th>助攻</th><th>最后活跃</th></tr></thead><tbody id="players-body">${playerRows(dashboard.players)}</tbody></table></div></section></div>`;
  renderCompetitionTable(); bindDashboard();
}

async function loadDashboard() {
  app.innerHTML = `<section class="loading">正在读取玩家与比赛数据…</section>`;
  try { dashboard = (await api("/api/admin/dashboard")).dashboard; renderDashboard(); }
  catch (error) { if (error.status === 401) renderLogin("登录已失效，请重新输入密码"); else app.innerHTML = `<section class="loading">${escapeHtml(error.message)}</section>`; }
}

function showModal(content) { modal.hidden = false; modal.innerHTML = `<section class="dialog">${content}</section>`; modal.querySelector("[data-close]").onclick = closeModal; }
function closeModal() { modal.hidden = true; modal.innerHTML = ""; }

async function openPlayer(id) {
  showModal(`<header class="dialog-head"><button data-close>×</button><div><small>玩家详情</small><h2>正在读取…</h2></div></header>`);
  try { const player = (await api(`/api/admin/players/${encodeURIComponent(id)}`)).player; const s = player.summary; showModal(`<header class="dialog-head"><button data-close>×</button><div><small>${escapeHtml(player.id)} · 注册于 ${dateText(player.createdAt)}</small><h2>${escapeHtml(player.nickname)}</h2></div></header><div class="dialog-body"><div class="detail-kpis"><span><small>比赛</small><b>${s.played}</b></span><span><small>胜 / 负</small><b>${s.wins} / ${s.losses}</b></span><span><small>进球</small><b>${s.goals}</b></span><span><small>助攻</small><b>${s.assists}</b></span></div><section class="panel"><header class="panel-head"><h2>历史比赛</h2></header><div class="match-list">${player.matches.map((match) => `<button class="match-row" ${match.matchId ? `data-match="${escapeHtml(match.matchId)}"` : "disabled"}><time>${shortDate(match.playedAt)}</time><span><b>对阵 ${escapeHtml(match.opponentName)}</b><small>${escapeHtml(match.ownFormation ?? "阵型未知")} vs ${escapeHtml(match.opponentFormation ?? "阵型未知")} · ${match.goals}球 ${match.assists}助</small></span><strong>${match.scoreFor}:${match.scoreAgainst}</strong></button>`).join("") || `<p class="empty">暂无比赛</p>`}</div></section></div>`); bindMatchRows(); }
  catch (error) { closeModal(); alert(error.message); }
}

function teamMarkup(team) { return `<section class="team"><header><div><h3>${escapeHtml(team.name)}</h3><strong class="formation-badge">阵型 ${escapeHtml(team.formation ?? "未知")}</strong></div><small>${escapeHtml(TACTICS[team.tactic] ?? team.tactic)} · ${escapeHtml(STYLES[team.style] ?? team.style)}</small></header><div class="lineup">${(team.players ?? []).map((player) => `<span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.role)} · ${Number(player.rating ?? 0).toFixed(1)}分 · ${player.stats?.goals ?? 0}球 ${player.stats?.assists ?? 0}助</small></span>`).join("")}</div></section>`; }

async function openMatch(id) {
  showModal(`<header class="dialog-head"><button data-close>×</button><div><small>比赛详情</small><h2>正在读取…</h2></div></header>`);
  try { const match = (await api(`/api/admin/matches/${encodeURIComponent(id)}`)).match; if (!match.teams) throw new Error("该旧版比赛没有完整详情"); showModal(`<header class="dialog-head"><button data-close>×</button><div><small>${dateText(match.playedAt)} · 房间 ${escapeHtml(match.roomCode)} · 第 ${match.round} 局</small><h2>比赛详情</h2></div></header><div class="scoreline"><span>${escapeHtml(match.teams[0].name)}</span><b>${match.score[0]} : ${match.score[1]}</b><span>${escapeHtml(match.teams[1].name)}</span></div><div class="dialog-body"><div class="teams">${match.teams.map(teamMarkup).join("")}</div><div class="events">${(match.importantEvents ?? []).map((event) => `<article class="event ${event.importance === "major" ? "major" : ""}"><span><b>${event.minute}'</b>${escapeHtml(event.text)}</span>${event.detail ? `<small>${escapeHtml(event.detail)}</small>` : ""}</article>`).join("")}</div></div>`); }
  catch (error) { closeModal(); alert(error.message); }
}

logoutButton.onclick = async () => { try { await api("/api/admin/logout", { method:"POST" }); } catch {} renderLogin(); };
modal.onclick = (event) => { if (event.target === modal) closeModal(); };
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) closeModal(); });
if (token) loadDashboard(); else renderLogin();
