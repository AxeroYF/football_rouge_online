const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const STORAGE_KEY = "yellowdogs-tv-app-v1";
const PRODUCTION_SERVER_URL = "https://yellowdogsleague.online";
const CLIENT_VERSION = "mobile0.6";

const state = {
  tab:"tv",
  tvSection:"live",
  predictionSection:"markets",
  loading:false,
  demo:false,
  account:null,
  live:null,
  broadcasts:[],
  upcoming:[],
  predictions:null,
  honorRoom:null,
  honorRoomLoading:false,
  honorRoomRequest:null,
  playerDirectory:null,
  playerDirectoryLoading:false,
  playerDirectoryRequest:null,
  yoogleQuery:"",
  yoogleDetailId:null,
  watch:null,
  watchTimer:null,
  selectedBet:null,
  activeMarketId:null,
  matchDetail:null,
  matchDetailRequest:null,
  serverUrl:PRODUCTION_SERVER_URL,
};

const navigationStack = [];
const NAVIGATION_DEPTH_KEY = "yellowdogsTvDepth";

const demoNow = Date.now();
const DEMO = {
  account:{ accountToken:"demo", profile:{ id:"YD-DEMO", nickname:"铁血蓝白AFA", passwordSet:true } },
  live:{
    team:{ name:"铁血蓝白AFA" },
    season:{ name:"S4 黄狗联赛", currentRound:22, totalRounds:33 },
    schedule:[
      { id:"s1", startsAt:demoNow + 32*60*1000, competitionName:"黄狗甲级联赛", label:"第23轮", homeName:"铁血蓝白AFA", awayName:"海港竞技" },
      { id:"s2", startsAt:demoNow + 2*86400000, competitionName:"黄狗杯", label:"四分之一决赛", homeName:"南城联队", awayName:"铁血蓝白AFA" },
    ],
    history:[],
  },
  broadcasts:[
    { code:"YDL-DEMO-01", minute:67, competition:"黄狗甲级联赛", weather:{ name:"晴朗" }, teams:[{name:"葡萄牙竞技"},{name:"高空轰炸"}], score:[2,1], spectatorCount:38 },
    { code:"YDL-DEMO-02", minute:31, competition:"黄狗杯", weather:{ name:"小雨" }, teams:[{name:"绿茵之心"},{name:"钢铁防线"}], score:[0,0], spectatorCount:21 },
  ],
  upcoming:[
    { startsAt:demoNow + 55*60*1000, competitionName:"黄狗甲级联赛", label:"第23轮", homeName:"铁血蓝白AFA", awayName:"海港竞技" },
    { startsAt:demoNow + 80*60*1000, competitionName:"黄狗甲级联赛", label:"第23轮", homeName:"伦敦之星", awayName:"北境联队" },
  ],
  predictions:{
    wallet:{ balance:11221 },
    matchPredictions:[
      { id:"m1", competitionName:"黄狗甲级联赛", round:23, homeName:"伦敦之星", awayName:"北境联队", startsAt:demoNow + 80*60*1000, closesAt:demoNow + 65*60*1000, status:"open", eligible:true, resultHandicap:0, resultHandicapHint:"平手盘", maxStakes:{result:100}, myBets:[], options:{ result:[{id:"home",label:"伦敦之星胜",payoutRate:2.15},{id:"draw",label:"平局",payoutRate:3.4},{id:"away",label:"北境联队胜",payoutRate:2.72}] } },
      { id:"m2", competitionName:"黄狗杯", round:"1/4", homeName:"绿茵之心", awayName:"钢铁防线", startsAt:demoNow + 3*3600000, closesAt:demoNow + 2.75*3600000, status:"open", eligible:true, resultHandicap:-1, resultHandicapHint:"主队 -1", maxStakes:{result:100}, myBets:[], options:{ result:[{id:"home",label:"绿茵之心胜",payoutRate:3.1},{id:"draw",label:"平局",payoutRate:3.55},{id:"away",label:"钢铁防线胜",payoutRate:1.83}] } },
    ],
    predictionLeaderboard:[{rank:1,teamName:"Axero",netProfit:386},{rank:2,teamName:"海港竞技",netProfit:242}],
  },
};

DEMO.live.team.id = "demo-team";
DEMO.live.schedule = [
  { id:"s-live", startsAt:demoNow - 35*60000, status:"live", competitionName:"黄狗甲级联赛", label:"第23轮", opponentName:"海港竞技", venue:"home", broadcastCode:"YDL-DEMO-01" },
  { id:"s-next", startsAt:demoNow + 2*86400000, status:"scheduled", competitionName:"黄狗冠军杯", label:"四分之一决赛 · 第1回合", opponentName:"南城联队", venue:"away" },
  { id:"s-done", startsAt:demoNow - 2*86400000, status:"complete", competitionName:"黄狗甲级联赛", label:"第22轮", opponentName:"伦敦之星", venue:"away", matchId:"demo-match-1", score:[3,1] },
];
DEMO.live.history = [
  { id:"demo-match-1", competition:"league", round:22, playedAt:demoNow - 2*86400000, homeId:"demo-team", awayId:"london", homeName:"铁血蓝白AFA", awayName:"伦敦之星", score:[3,1], hasDetails:true },
  { id:"demo-match-2", competition:"cup", round:4, playedAt:demoNow - 5*86400000, homeId:"harbor", awayId:"demo-team", homeName:"海港竞技", awayName:"铁血蓝白AFA", score:[2,2], hasDetails:false },
];
DEMO.predictions.matchPredictions.forEach((market) => {
  market.maxStakes = { result:10000, goals:10000, cards:10000, halfFull:2000 };
  market.options = {
    ...market.options,
    goals:[{id:"0-3",label:"0–3球",payoutRate:1.88},{id:"4-5",label:"4–5球",payoutRate:2.75},{id:"6+",label:"6球及以上",payoutRate:4.6}],
    cards:[{id:"0",label:"0张",payoutRate:5.1},{id:"1",label:"1张",payoutRate:3.25},{id:"2",label:"2张",payoutRate:2.35},{id:"3",label:"3张",payoutRate:3.1},{id:"4+",label:"4张及以上",payoutRate:4.2}],
    halfFull:[
      {id:"home-home",label:"胜胜",payoutRate:3.1},{id:"home-draw",label:"胜平",payoutRate:8.2},{id:"home-away",label:"胜负",payoutRate:13.5},
      {id:"draw-home",label:"平胜",payoutRate:4.7},{id:"draw-draw",label:"平平",payoutRate:5.4},{id:"draw-away",label:"平负",payoutRate:5.2},
      {id:"away-home",label:"负胜",payoutRate:12.8},{id:"away-draw",label:"负平",payoutRate:8.6},{id:"away-away",label:"负负",payoutRate:3.8},
    ],
  };
});
DEMO.predictions.predictionHistory = [];
const demoHonorRecords = [
  { player:{ id:"demo-p1", name:"马奎尔", role:"CB", grade:"S", overall:96 }, card:{ effectiveOverall:99, upgradeLevel:6 }, appearances:86, goals:12, assists:8, redCards:2, averageRating:7.42, upgradeLevel:6 },
  { player:{ id:"demo-p2", name:"罗德里·巴乔", role:"CM", grade:"S", overall:98 }, card:{ effectiveOverall:100, upgradeLevel:5 }, appearances:91, goals:31, assists:42, redCards:0, averageRating:7.68, upgradeLevel:5 },
  { player:{ id:"demo-p3", name:"马尔蒂尼", role:"CB", grade:"S", overall:97 }, card:{ effectiveOverall:100, upgradeLevel:7 }, appearances:79, goals:7, assists:5, redCards:1, averageRating:7.55, upgradeLevel:7 },
];
DEMO.honorRoom = {
  updatedAt:demoNow,
  seasonCount:4,
  club:{ ownerId:"P-DEMO", ownerName:"Axero", teamId:"demo-team", teamName:"铁血蓝白AFA" },
  honors:{ league:["S1", "S3"], cup:["S2"], worldCup:[] },
  appearances:[demoHonorRecords[1], demoHonorRecords[0], demoHonorRecords[2]],
  scorers:[demoHonorRecords[1], demoHonorRecords[0], demoHonorRecords[2]],
  assisters:[demoHonorRecords[1], demoHonorRecords[0]],
  redCardLeaders:[demoHonorRecords[0], demoHonorRecords[2]],
  scorer:demoHonorRecords[1],
  assister:demoHonorRecords[1],
  redCardLeader:demoHonorRecords[0],
  ballonDorWinners:[{ playerId:"demo-p2", playerName:"罗德里·巴乔", awardCount:2, seasons:["S2", "S3"], latestSeason:"S3", record:demoHonorRecords[1] }],
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[char]));
}

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved) return;
    if (saved.demo === true) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    state.account = saved.account ?? null;
    state.serverUrl = PRODUCTION_SERVER_URL;
    state.demo = false;
  } catch {}
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ account:state.account }));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function pushNavigation(entry) {
  navigationStack.push(entry);
  history.pushState({ ...(history.state ?? {}), [NAVIGATION_DEPTH_KEY]:navigationStack.length }, "");
}

function closeNavigationEntry(entry) {
  if (!entry) return;
  if (entry.kind === "view") {
    state.tab = entry.tab;
    state.tvSection = entry.tvSection;
    state.predictionSection = entry.predictionSection;
    render();
    return;
  }
  if (entry.kind === "watch") {
    void closeWatch();
    return;
  }
  if (entry.kind === "market") {
    document.querySelector(".market-sheet")?.remove();
    state.activeMarketId = null;
    return;
  }
  if (entry.kind === "bet") {
    document.querySelector(".bet-sheet")?.remove();
    state.selectedBet = null;
    return;
  }
  if (entry.kind === "match-detail") {
    document.querySelector(".match-detail-overlay")?.remove();
    state.matchDetail = null;
    state.matchDetailRequest = null;
  }
  if (entry.kind === "yoogle-detail") {
    document.querySelector(".yoogle-detail-overlay")?.remove();
    state.yoogleDetailId = null;
  }
}

function navigateBack() {
  if (!navigationStack.length) return false;
  history.back();
  return true;
}

function pushViewNavigation() {
  pushNavigation({
    kind:"view",
    tab:state.tab,
    tvSection:state.tvSection,
    predictionSection:state.predictionSection,
  });
}

function serverBase() {
  return PRODUCTION_SERVER_URL;
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 12000);
  try {
    const response = await fetch(`${serverBase()}${path}`, {
      method:options.method ?? "GET",
      headers:{ "content-type":"application/json", ...(options.token ? { authorization:`Bearer ${options.token}` } : {}) },
      body:options.body ? JSON.stringify(options.body) : undefined,
      cache:"no-store",
      signal:controller.signal,
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok || value.ok === false) throw new Error(value.error ?? `请求失败（${response.status}）`);
    return value;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("连接服务器超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function identity(extra = {}) {
  return { playerId:state.account.profile.id, accountToken:state.account.accountToken, ...extra };
}

function time(value, withDate = true) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "时间待定";
  const clock = date.toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit", hour12:false });
  return withDate ? `${date.toLocaleDateString("zh-CN", { month:"numeric", day:"numeric", weekday:"short" })} ${clock}` : clock;
}

function countdown(value) {
  const minutes = Math.max(0, Math.ceil((Number(value) - Date.now()) / 60000));
  if (minutes < 60) return `${minutes}分钟后`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时${minutes % 60}分后`;
  return `${Math.floor(minutes / 1440)}天后`;
}

const PREDICTION_CATEGORIES = ["result", "goals", "cards", "halfFull"];
const PREDICTION_CATEGORY_LABELS = { result:"胜平负", goals:"总进球", cards:"红黄牌", halfFull:"半全场" };
const BET_STATUS_LABELS = { pending:"等待结算", won:"预测命中", lost:"未命中" };

function marketOption(market, category, selection) {
  return market.options?.[category]?.find((option) => option.id === selection) ?? null;
}

function marketHandicap(market) {
  const handicap = Number(market.resultHandicap);
  if (!Number.isInteger(handicap)) return market.resultHandicapHint ?? "盘口分析中";
  if (handicap < 0) return `主队让 ${Math.abs(handicap)} 球`;
  if (handicap > 0) return `客队让 ${handicap} 球`;
  return "零球盘 · 0球";
}

function availablePredictionCategories(market) {
  return PREDICTION_CATEGORIES.filter((category) => market.options?.[category]?.some((option) => Number(option.payoutRate) > 0));
}

function ownMatchResult(match) {
  const ownHome = match.homeId === state.live?.team?.id;
  const ownScore = Number(match.score?.[ownHome ? 0 : 1] ?? 0);
  const opponentScore = Number(match.score?.[ownHome ? 1 : 0] ?? 0);
  return { ownHome, ownScore, opponentScore, result:ownScore > opponentScore ? "win" : ownScore < opponentScore ? "loss" : "draw" };
}

function loginMarkup() {
  return `<main class="login-shell"><section><div class="login-brand"><div class="brand-mark">YD</div><small>YELLOWDOGS TELEVISION</small><h1>黄狗TV</h1><p>登录球队账号，观看直播并参与赛事预测。</p></div><form class="login-panel" data-login-form><label class="field"><span>昵称</span><input name="nickname" autocomplete="username" required /></label><label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required /></label><div class="login-actions"><button class="button primary wide" type="submit">登录黄狗TV</button></div><p class="login-note">正在连接 YellowDogs League 正式服务器</p></form></section></main>`;
}

function standingsTableMarkup(rows, ownTeamId, options = {}) {
  const entries = Array.isArray(rows) ? rows : [];
  if (!entries.length) return `<p class="empty">${escapeHtml(options.emptyText ?? "排名数据尚未生成。")}</p>`;
  const statusLabels = { qualified:"晋级", eliminated:"出局", active:"进行中" };
  const body = entries.map((entry) => {
    const goalDifference = Number(entry.goalsFor ?? 0) - Number(entry.goalsAgainst ?? 0);
    const status = options.showStatus && entry.status ? `<small>${escapeHtml(statusLabels[entry.status] ?? entry.status)}</small>` : "";
    return `<div class="standing-row ${entry.id === ownTeamId ? "own" : ""}"><b class="standing-rank">${Number(entry.rank ?? 0) || "-"}</b><span class="standing-team"><b>${escapeHtml(entry.name ?? "未知球队")}</b>${status}</span><span>${Number(entry.played ?? 0)}</span><span>${Number(entry.won ?? 0)}-${Number(entry.drawn ?? 0)}-${Number(entry.lost ?? 0)}</span><span>${goalDifference > 0 ? "+" : ""}${goalDifference}</span><strong>${Number(entry.points ?? 0)}</strong></div>`;
  }).join("");
  return `<div class="standings-table"><div class="standing-row standing-header"><span>#</span><span>球队</span><span>赛</span><span>胜-平-负</span><span>净</span><span>分</span></div>${body}</div>`;
}

function knockoutTieMarkup(tie, ownTeamId, index) {
  const teams = tie?.teams ?? [];
  const scoreByTeam = new Map(teams.map((team) => [team.id, 0]));
  let playedLegs = 0;
  (tie?.legs ?? []).forEach((leg) => {
    if (!Array.isArray(leg.score)) return;
    playedLegs += 1;
    scoreByTeam.set(leg.homeId, Number(scoreByTeam.get(leg.homeId) ?? 0) + Number(leg.score[0] ?? 0));
    scoreByTeam.set(leg.awayId, Number(scoreByTeam.get(leg.awayId) ?? 0) + Number(leg.score[1] ?? 0));
  });
  const teamRows = teams.map((team) => `<div class="knockout-team ${team.id === ownTeamId ? "own" : ""} ${tie.winnerId === team.id ? "winner" : ""}"><span>${escapeHtml(team.name ?? "待定")}</span><b>${playedLegs ? Number(scoreByTeam.get(team.id) ?? 0) : "-"}</b></div>`).join("");
  return `<article class="knockout-tie"><header><small>对阵 ${index + 1}</small><span>${tie.winnerId ? "已结束" : playedLegs ? "进行中" : "待比赛"}</span></header>${teamRows}</article>`;
}

function clubRecordMarkup() {
  const ownTeamId = state.live?.team?.id;
  const cup = state.live?.cup ?? {};
  const stageLabels = { quarterfinals:"四分之一决赛", semifinals:"半决赛", final:"决赛" };
  const knockoutStages = Object.entries(stageLabels).map(([key, label]) => {
    const ties = cup.knockout?.[key] ?? [];
    if (!ties.length) return "";
    return `<section class="knockout-stage"><header><b>${label}</b><span>${ties.length} 组对阵</span></header><div class="knockout-list">${ties.map((tie, index) => knockoutTieMarkup(tie, ownTeamId, index)).join("")}</div></section>`;
  }).join("");
  const cupStatus = cup.status === "completed" ? `冠军：${escapeHtml(cup.championName ?? "待定")}` : cup.status === "active" ? "赛事进行中" : "尚未开始";
  return `<section class="panel standings-panel"><header class="panel-head"><div><small>LEAGUE TABLE</small><b>联赛排名</b></div><strong>${state.live?.season?.currentRound ?? 0}/${state.live?.season?.totalRounds ?? 0} 轮</strong></header>${standingsTableMarkup(state.live?.leagueStandings, ownTeamId, { emptyText:"联赛排名尚未生成。" })}</section><section class="panel standings-panel"><header class="panel-head"><div><small>CUP LEAGUE STAGE</small><b>杯赛小组赛排名</b></div><strong>${cupStatus}</strong></header>${standingsTableMarkup(cup.standings, ownTeamId, { showStatus:true, emptyText:cup.status === "waiting" ? "冠军杯尚未开始。" : "杯赛排名尚未生成。" })}</section><section class="panel knockout-panel"><header class="panel-head"><div><small>CUP KNOCKOUT</small><b>杯赛淘汰赛</b></div><strong>${escapeHtml(stageLabels[cup.stage] ?? (cup.status === "completed" ? "已结束" : "待开始"))}</strong></header>${knockoutStages || `<p class="empty">淘汰赛对阵尚未生成。</p>`}</section>`;
}

const HONOR_TROPHY_META = Object.freeze({
  league:{ label:"联赛冠军", english:"LEAGUE HONOURS", asset:"trophy-league-v2.webp" },
  cup:{ label:"杯赛冠军", english:"CUP HONOURS", asset:"trophy-cup-v2.webp" },
  worldCup:{ label:"世界杯冠军", english:"WORLD CUP HONOURS", asset:"trophy-world-cup-v2.webp" },
});
const HONOR_ROLE_LABELS = Object.freeze({ GK:"门将", CB:"中卫", LB:"左后卫", RB:"右后卫", DM:"后腰", CM:"中场", AM:"前腰", LM:"左中场", RM:"右中场", LW:"左边锋", RW:"右边锋", ST:"中锋" });
const PLAYER_ATTRIBUTE_LABELS = Object.freeze({ passing:"传球", firstTouch:"停球", dribbling:"盘带", crossing:"传中", finishing:"射门", longShots:"远射", heading:"头球", setPieces:"定位球", tackling:"抢断", marking:"盯人", positioning:"站位", vision:"视野", decisions:"决策", composure:"冷静", offBall:"无球", discipline:"纪律", pace:"速度", acceleration:"加速", strength:"力量", stamina:"耐力", agility:"灵活", jumping:"弹跳", workRate:"投入", aggression:"侵略性", goalkeeping:"守门", reflexes:"反应" });
const PLAYER_ROLE_LABELS = Object.freeze({ GK:"门将", CB:"中卫", LB:"左后卫", RB:"右后卫", LWB:"左翼卫", RWB:"右翼卫", DM:"后腰", CM:"中场", AM:"前腰", LM:"左中场", RM:"右中场", LW:"左边锋", RW:"右边锋", ST:"中锋" });

function mobileHonorTrophyGallery(type, seasons = []) {
  const meta = HONOR_TROPHY_META[type];
  const trophies = seasons.length
    ? seasons.map((season) => `<figure class="mobile-honor-trophy"><img src="${PRODUCTION_SERVER_URL}/versus/honor_assets/${meta.asset}" alt="${escapeHtml(meta.label)}" loading="lazy" decoding="async"/><figcaption>${escapeHtml(season)}</figcaption></figure>`).join("")
    : `<div class="mobile-honor-empty-trophy"><span>◇</span><b>尚待镌刻</b></div>`;
  return `<article class="mobile-trophy-gallery type-${type}"><header><div><small>${meta.english}</small><b>${meta.label}</b></div><strong>${seasons.length}<small>座</small></strong></header><div class="mobile-trophy-shelf">${trophies}</div></article>`;
}

function mobileHonorRecordRow(record, rank, metric, unit) {
  if (!record?.player) return "";
  const overall = Number(record.card?.effectiveOverall ?? record.player.effectiveOverall ?? record.player.overall ?? 0);
  const upgrade = Number(record.upgradeLevel ?? record.card?.upgradeLevel ?? 0);
  return `<article class="mobile-honor-record ${rank === 1 ? "rank-one" : ""}"><span class="mobile-honor-rank">${String(rank).padStart(2, "0")}</span><span class="mobile-honor-rating">${overall}</span><div><b>${escapeHtml(record.player.name)}</b><small>${escapeHtml(HONOR_ROLE_LABELS[record.player.role] ?? record.player.role ?? "球员")} · ${record.appearances ?? 0}场 · 评分 ${Number(record.averageRating ?? 0).toFixed(2)}${upgrade ? ` · +${upgrade}` : ""}</small></div><strong>${Number(record[metric] ?? 0)}<small>${unit}</small></strong></article>`;
}

function mobileHonorRecordSection(english, title, entries, metric, unit) {
  const records = (entries ?? []).slice(0, 3);
  return `<section class="panel mobile-honor-records"><header class="panel-head"><div><small>${english}</small><b>${title}</b></div><strong>TOP 3</strong></header><div>${records.map((record, index) => mobileHonorRecordRow(record, index + 1, metric, unit)).join("") || `<p class="empty">暂无队史记录。</p>`}</div></section>`;
}

function mobileHonorBallonDorMarkup(winners = []) {
  const content = winners.length
    ? winners.map((winner) => `<article class="mobile-ballon-winner"><img src="${PRODUCTION_SERVER_URL}/versus/honor_assets/trophy-ballon-dor-v2.webp" alt="金球奖" loading="lazy" decoding="async"/><div><small>${escapeHtml((winner.seasons ?? []).join(" · "))}</small><b>${escapeHtml(winner.record?.player?.name ?? winner.playerName ?? "历史球员")}</b><strong>金球奖 ×${Number(winner.awardCount ?? 1)}</strong><span>${winner.record?.appearances ?? 0}场 · ${winner.record?.goals ?? 0}球 · ${winner.record?.assists ?? 0}助</span></div></article>`).join("")
    : `<p class="empty">金色展台仍在等待第一位得主。</p>`;
  return `<section class="panel mobile-ballon-panel"><header class="panel-head"><div><small>SEASON BALLON D'OR</small><b>金球奖荣誉</b></div><strong>GOLDEN LEGACY</strong></header><div class="mobile-ballon-list">${content}</div></section>`;
}

function honorRoomMarkup() {
  const history = state.honorRoom;
  if (state.honorRoomLoading && !history) return `<header class="view-head"><div><small>CLUB LEGACY</small><h1>荣誉室</h1></div></header><div class="loading">正在载入俱乐部荣誉档案…</div>`;
  if (!history) return `<header class="view-head"><div><small>CLUB LEGACY</small><h1>荣誉室</h1></div></header><section class="panel"><p class="empty">荣誉室数据尚未建立，将在联赛赛季结算后自动生成。</p><div class="action-stack"><button class="button secondary wide" data-refresh-honor>重新载入</button></div></section>`;
  const honors = history.honors ?? { league:[], cup:[], worldCup:[] };
  const totalTrophies = (honors.league?.length ?? 0) + (honors.cup?.length ?? 0) + (honors.worldCup?.length ?? 0);
  const topAppearance = history.appearances?.[0]?.appearances ?? 0;
  const topGoals = history.scorer?.goals ?? history.scorers?.[0]?.goals ?? 0;
  const trophyPanels = ["league", "cup", ...(honors.worldCup?.length ? ["worldCup"] : [])].map((type) => mobileHonorTrophyGallery(type, honors[type] ?? [])).join("");
  return `<header class="view-head honor-view-head"><div><small>CLUB LEGACY · ${history.seasonCount ?? 0} SEASONS</small><h1>荣誉室</h1></div><button class="honor-refresh" data-refresh-honor aria-label="刷新荣誉室">↻</button></header><section class="mobile-honor-hero"><small>CLUB LEGACY</small><h2>${escapeHtml(history.club?.teamName ?? state.live?.team?.name ?? "我的球队")}</h2><p>经理 ${escapeHtml(history.club?.ownerName ?? state.account.profile.nickname)} 的俱乐部荣誉档案</p><div><span><b>${totalTrophies}</b><small>冠军奖杯</small></span><span><b>${topAppearance}</b><small>出场纪录</small></span><span><b>${topGoals}</b><small>进球纪录</small></span></div></section><section class="mobile-honor-section"><header><small>TROPHY GALLERY</small><h2>冠军陈列馆</h2></header><div class="mobile-trophy-galleries">${trophyPanels}</div></section>${mobileHonorRecordSection("ALL-TIME APPEARANCES", "队史出场殿堂", history.appearances, "appearances", "场")}${mobileHonorRecordSection("ALL-TIME TOP SCORERS", "队史射手榜", history.scorers ?? (history.scorer ? [history.scorer] : []), "goals", "球")}${mobileHonorRecordSection("ALL-TIME TOP ASSISTERS", "队史助攻榜", history.assisters ?? (history.assister ? [history.assister] : []), "assists", "助")}${mobileHonorRecordSection("ALL-TIME RED CARD LEADERS", "队史红牌榜", history.redCardLeaders ?? (history.redCardLeader ? [history.redCardLeader] : []), "redCards", "张")}${mobileHonorBallonDorMarkup(history.ballonDorWinners ?? [])}`;
}

function shellMarkup(content) {
  const teamName = state.live?.team?.name ?? state.account?.profile?.nickname ?? "黄狗TV";
  const balance = state.predictions?.wallet?.balance;
  return `<div class="app-shell"><header class="topbar"><div class="brand-mark">YD</div><div class="brand-copy"><b>黄狗TV</b><small>YELLOWDOGS TELEVISION</small></div><div class="topbar-status"><b>${escapeHtml(teamName)}</b><small>${Number.isFinite(Number(balance)) ? `${Number(balance).toLocaleString("zh-CN")} 金币` : state.demo ? "演示模式" : "已登录"}</small></div></header><main class="content">${content}</main><nav class="bottom-nav"><button data-tab="tv" class="${state.tab === "tv" ? "active" : ""}"><span>◉</span>黄狗TV</button><button data-tab="yoogle" class="${state.tab === "yoogle" ? "active" : ""}"><span>⌕</span>YOOGLE</button><button data-tab="predictions" class="${state.tab === "predictions" ? "active" : ""}"><span>◆</span>预测</button><button data-tab="honor" class="${state.tab === "honor" ? "active" : ""}"><span>♛</span>荣誉</button><button data-tab="mine" class="${state.tab === "mine" ? "active" : ""}"><span>●</span>我的</button></nav></div>`;
}

function yoogleResults() {
  const query = state.yoogleQuery.trim().toLocaleLowerCase("zh-CN");
  if (!query) return [];
  const role = query.toUpperCase();
  return (state.playerDirectory?.players ?? []).filter((player) => [player.name, player.club, player.nationality, player.role, player.secondaryRole]
    .some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(query)) || [player.role, player.secondaryRole].includes(role)).slice(0, 40);
}

function yoogleResultMarkup(player) {
  const owner = player.ownership ? `${player.ownership.ownerName} · ${player.ownership.teamName}` : player.legend ? "传奇公共球员" : "公共池球员";
  const secondaryRole = player.secondaryRole && player.secondaryRole !== player.role ? ` / ${player.secondaryRole}` : "";
  return `<button type="button" class="yoogle-result grade-${escapeHtml(String(player.grade ?? "C").toLowerCase())}" data-yoogle-player="${escapeHtml(player.id)}"><i>${escapeHtml(player.grade ?? "C")}</i><span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.club)} · ${escapeHtml(player.nationality)}</small></span><strong>${Number(player.overall ?? 0)}<small>${escapeHtml(player.role ?? "-")}${escapeHtml(secondaryRole)}</small></strong><em>${escapeHtml(owner)}</em></button>`;
}

function yoogleMarkup() {
  const query = state.yoogleQuery.trim();
  const results = yoogleResults();
  const resultContent = !query
    ? ""
    : state.playerDirectoryLoading && !state.playerDirectory
      ? `<p class="yoogle-status">正在连接球员数据库…</p>`
      : `<div class="yoogle-results">${results.map(yoogleResultMarkup).join("") || `<p class="yoogle-status">没有找到符合条件的球员</p>`}</div>`;
  return `<section class="yoogle-page"><div class="yoogle-home"><strong>YOOGLE</strong><label><span aria-hidden="true">⌕</span><input type="search" value="${escapeHtml(state.yoogleQuery)}" placeholder="搜索球员、俱乐部、国家队或位置" data-yoogle-search autocomplete="off" enterkeyhint="search"></label></div><div data-yoogle-results>${resultContent}</div></section>`;
}

function refreshYoogleResults() {
  const container = document.querySelector("[data-yoogle-results]");
  if (!container) return;
  const query = state.yoogleQuery.trim();
  if (!query) { container.innerHTML = ""; return; }
  if (state.playerDirectoryLoading && !state.playerDirectory) { container.innerHTML = `<p class="yoogle-status">正在连接球员数据库…</p>`; return; }
  const results = yoogleResults();
  container.innerHTML = `<div class="yoogle-results">${results.map(yoogleResultMarkup).join("") || `<p class="yoogle-status">没有找到符合条件的球员</p>`}</div>`;
}

function yoogleCardMarkup(player) {
  const profileData = player.cardProfile ?? {};
  const profileUrl = profileData.imageUrl ? (String(profileData.imageUrl).startsWith("http") ? String(profileData.imageUrl) : `${PRODUCTION_SERVER_URL}${String(profileData.imageUrl).startsWith("/") ? "" : "/"}${profileData.imageUrl}`) : "";
  const profile = profileUrl ? `<img src="${escapeHtml(profileUrl)}" alt="" loading="lazy" decoding="async" style="--profile-x:${Number(profileData.xPercent ?? 50)}%;--profile-y:${Number(profileData.yPercent ?? 18)}%;--profile-width:${Number(profileData.widthPercent ?? 100)}%">` : "";
  const secondary = player.secondaryRole && player.secondaryRole !== player.role ? ` / ${player.secondaryRole}` : "";
  return `<article class="yoogle-card grade-${escapeHtml(String(player.grade ?? "C").toLowerCase())}">${profile}<div class="yoogle-card-glow"></div><small>${escapeHtml(player.grade ?? "C")} RATED</small><strong>${Number(player.overall ?? 0)}</strong><b>${escapeHtml(player.name)}</b><span>${escapeHtml(player.role ?? "-")}${escapeHtml(secondary)}</span><em>${escapeHtml(player.club ?? "YellowDogs League")}</em></article>`;
}

function openYooglePlayer(playerId) {
  const player = (state.playerDirectory?.players ?? []).find((entry) => entry.id === playerId);
  if (!player) return showToast("球员资料尚未加载");
  state.yoogleDetailId = playerId;
  pushNavigation({ kind:"yoogle-detail" });
  const attributes = Object.entries(PLAYER_ATTRIBUTE_LABELS).map(([key, label]) => `<div><dt>${label}</dt><dd>${Number(player.attributes?.[key] ?? 0)}</dd></div>`).join("");
  const ownership = player.ownership ? `${player.ownership.ownerName} · ${player.ownership.teamName}` : player.legend ? "传奇公共球员" : "公共池球员";
  document.body.insertAdjacentHTML("beforeend", `<section class="yoogle-detail-overlay"><header class="watch-toolbar"><button data-close-yoogle-player aria-label="返回">←</button><div><b>${escapeHtml(player.name)}</b><small>GLOBAL PLAYER DIRECTORY</small></div></header><main class="yoogle-detail"><section class="yoogle-card-stage">${yoogleCardMarkup(player)}</section><section class="yoogle-player-meta"><span>${escapeHtml(PLAYER_ROLE_LABELS[player.role] ?? player.role ?? "球员")}</span><span>${escapeHtml(player.nationality ?? "-")}</span><span>${Number(player.heightCm ?? 0) || "-"} cm</span><span>${escapeHtml(player.preferredFoot ?? "-")}</span></section><section class="panel"><header class="panel-head"><div><small>PLAYER OWNERSHIP</small><b>球员归属</b></div></header><p class="yoogle-ownership">${escapeHtml(ownership)}</p></section><section class="panel"><header class="panel-head"><div><small>PLAYER ATTRIBUTES</small><b>26 项能力值</b></div><strong>MAX +${Number(player.highestUpgradeLevel ?? 0)}</strong></header><dl class="yoogle-attributes">${attributes}</dl></section></main></section>`);
}

function tvMarkup() {
  const leagueBroadcasts = state.broadcasts.filter((entry) => String(entry.code ?? "").startsWith("YDL-"));
  const liveCards = leagueBroadcasts.map((broadcast) => `<button class="live-card" data-watch="${escapeHtml(broadcast.code)}"><header><span class="live-pill">LIVE</span><small>${escapeHtml(broadcast.competition ?? broadcast.competitionName ?? "黄狗联赛")} · ${Number(broadcast.minute ?? 0)}'</small></header><div class="live-score"><b>${escapeHtml(broadcast.teams?.[0]?.name)}</b><strong>${Number(broadcast.score?.[0] ?? 0)} : ${Number(broadcast.score?.[1] ?? 0)}</strong><b>${escapeHtml(broadcast.teams?.[1]?.name)}</b></div><footer><span>${Number(broadcast.spectatorCount ?? 0)} 人正在观看</span><b>进入直播 ›</b></footer></button>`).join("");
  const scheduleRows = (state.live?.schedule ?? []).map((fixture) => {
    const statusText = fixture.status === "complete" ? `${Number(fixture.score?.[0] ?? 0)} : ${Number(fixture.score?.[1] ?? 0)}` : fixture.status === "live" ? "进行中" : countdown(fixture.startsAt);
    const action = fixture.status === "live" && fixture.broadcastCode
      ? `<button class="mini-action live" data-watch="${escapeHtml(fixture.broadcastCode)}">观看直播</button>`
      : fixture.status === "complete" && fixture.matchId
        ? `<button class="mini-action" data-match-detail="${escapeHtml(fixture.matchId)}">比赛详情</button>`
        : `<strong>${escapeHtml(statusText)}</strong>`;
    return `<article class="schedule-card ${escapeHtml(fixture.status ?? "scheduled")}"><time><b>${time(fixture.startsAt, false)}</b><small>${time(fixture.startsAt)}</small></time><div><b>${fixture.venue === "home" ? "主场" : "客场"} · ${escapeHtml(fixture.opponentName ?? "待定球队")}</b><small>${escapeHtml(fixture.competitionName ?? "黄狗联赛")} · ${escapeHtml(fixture.label ?? "待开赛")}</small></div>${action}</article>`;
  }).join("");
  const historyRows = (state.live?.history ?? []).map((match) => {
    const result = ownMatchResult(match);
    const opponent = result.ownHome ? match.awayName : match.homeName;
    return `<button class="history-card ${result.result}" ${match.hasDetails ? `data-match-detail="${escapeHtml(match.id)}"` : "disabled"}><span><small>${time(match.playedAt)}</small><b>${escapeHtml(opponent)}</b><em>${escapeHtml(match.label ?? (match.competition === "cup" ? "黄狗冠军杯" : `联赛第${match.round}轮`))} · ${result.ownHome ? "主场" : "客场"}</em></span><strong>${result.ownScore} : ${result.opponentScore}</strong><i>${match.hasDetails ? "查看详情 ›" : "旧比赛无详情"}</i></button>`;
  }).join("");
  const upcomingRows = state.upcoming.slice(0, 6).map((fixture) => `<article class="schedule-card"><time><b>${time(fixture.startsAt, false)}</b><small>${countdown(fixture.startsAt)}</small></time><div><b>${escapeHtml(fixture.homeName)} vs ${escapeHtml(fixture.awayName)}</b><small>${escapeHtml(fixture.competitionName ?? "黄狗联赛")} · ${escapeHtml(fixture.label ?? "待开赛")}</small></div><strong>待播</strong></article>`).join("");
  const season = state.live?.season;
  const liveNowContent = `<section class="panel"><header class="panel-head"><div><small>LIVE NOW</small><b>正在直播</b></div><strong>${leagueBroadcasts.length} 场</strong></header><div class="live-list">${liveCards || `<p class="empty">当前没有正在进行的黄狗联赛直播。</p>`}</div></section>`;
  const nextBroadcastContent = `<section class="panel"><header class="panel-head"><div><small>NEXT BROADCASTS</small><b>全场直播预告</b></div><strong>自动更新</strong></header><div class="schedule-list">${upcomingRows || `<p class="empty">暂时没有已确定的直播。</p>`}</div></section>`;
  const scheduleContent = `<section class="panel"><header class="panel-head"><div><small>CLUB CALENDAR</small><b>我的完整日程</b></div><strong>${state.live?.schedule?.length ?? 0} 场</strong></header><div class="schedule-list">${scheduleRows || `<p class="empty">当前没有已确定的球队赛程。</p>`}</div></section>`;
  const historyContent = `<section class="panel"><header class="panel-head"><div><small>TEAM HISTORY</small><b>历史战绩</b></div><strong>${state.live?.history?.length ?? 0} 场</strong></header><div class="history-list">${historyRows || `<p class="empty">你的球队还没有比赛记录。</p>`}</div></section>`;
  const recordContent = clubRecordMarkup();
  const content = state.tvSection === "schedule" ? scheduleContent : state.tvSection === "history" ? historyContent : state.tvSection === "records" ? recordContent : `${liveNowContent}${quickTeamSummaryMarkup()}${nextBroadcastContent}`;
  return `<header class="view-head"><div><small>YDL TELEVISION</small><h1>黄狗TV</h1></div><span>${season ? `${escapeHtml(season.name)}<br>第 ${season.currentRound}/${season.totalRounds} 轮` : "实时更新"}</span></header><section class="panel hero"><small>YOUR CLUB</small><h2>${escapeHtml(state.live?.team?.name ?? state.account.profile.nickname)}</h2><p>赛程、直播、历史战绩和比赛详情集中在这里。</p><div class="hero-stats"><span><b>${leagueBroadcasts.length}</b><small>正在直播</small></span><span><b>${(state.live?.schedule ?? []).length}</b><small>我的赛程</small></span><span><b>${(state.live?.history ?? []).length}</b><small>历史比赛</small></span></div></section><nav class="section-tabs tv-tabs"><button data-tv-section="live" class="${state.tvSection === "live" ? "active" : ""}">电视台</button><button data-tv-section="records" class="${state.tvSection === "records" ? "active" : ""}">球队战绩</button><button data-tv-section="schedule" class="${state.tvSection === "schedule" ? "active" : ""}">我的日程</button><button data-tv-section="history" class="${state.tvSection === "history" ? "active" : ""}">历史战绩</button></nav>${content}`;
}

function predictionsMarkup() {
  const markets = state.predictions?.matchPredictions ?? [];
  const cards = markets.map((market) => {
    const resultOdds = (market.options?.result ?? []).map((option) => `<span class="odds-preview"><small>${escapeHtml(option.label)}</small><b>${Number(option.payoutRate ?? 0).toFixed(2)}</b></span>`).join("");
    const betSummary = market.myBets?.length ? `<div class="market-bet-summary">${market.myBets.map((bet) => `<span><small>${PREDICTION_CATEGORY_LABELS[bet.category] ?? bet.category}</small><b>${escapeHtml(marketOption(market, bet.category, bet.selection)?.label ?? bet.selection)}</b><em>${Number(bet.amount).toLocaleString("zh-CN")}金币 · ${BET_STATUS_LABELS[bet.status] ?? bet.status}</em></span>`).join("")}</div>` : "";
    return `<article class="market-card"><header><small>${escapeHtml(market.competitionName ?? market.competition ?? "黄狗联赛")} · 第${escapeHtml(market.round ?? "-")}轮</small><span>${market.status === "open" ? `${countdown(market.closesAt)}截止` : "已截止"}</span></header><div class="market-teams"><b>${escapeHtml(market.homeName)}</b><i>VS</i><b>${escapeHtml(market.awayName)}</b></div><p class="market-hint">${escapeHtml(marketHandicap(market))}</p><div class="odds-preview-grid">${resultOdds}</div>${betSummary}<footer class="market-footer"><span>${market.eligible ? `${availablePredictionCategories(market).length}种玩法已开放` : escapeHtml(market.lockedReason ?? "暂不可预测")}</span><button class="mini-action" data-open-market="${escapeHtml(market.id)}">查看全部盘口</button></footer></article>`;
  }).join("");
  const activeRecords = markets.flatMap((market) => (market.myBets ?? []).map((bet) => ({ ...bet, homeName:market.homeName, awayName:market.awayName, categoryLabel:PREDICTION_CATEGORY_LABELS[bet.category] ?? bet.category, selectionLabel:marketOption(market, bet.category, bet.selection)?.label ?? bet.selection })));
  const records = (state.predictions?.predictionHistory ?? activeRecords).slice().sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0));
  const recordRows = records.map((bet) => `<article class="bet-record ${escapeHtml(bet.status)}"><header><small>${escapeHtml(bet.categoryLabel ?? PREDICTION_CATEGORY_LABELS[bet.category] ?? bet.category)}</small><b>${escapeHtml(BET_STATUS_LABELS[bet.status] ?? bet.status)}</b></header><strong>${escapeHtml(bet.homeName)} vs ${escapeHtml(bet.awayName)}</strong><p>${escapeHtml(bet.selectionLabel ?? bet.selection)} · 赔率 ${Number(bet.payoutRate).toFixed(2)}</p><footer><span>投入 ${Number(bet.amount).toLocaleString("zh-CN")} 金币</span><b>${bet.status === "won" ? `返还 ${Number(bet.payout).toLocaleString("zh-CN")}` : bet.status === "lost" ? "返还 0" : "等待比赛结束"}</b></footer></article>`).join("");
  const ranking = (state.predictions?.predictionLeaderboard ?? []).map((entry) => { const profit = Number(entry.netProfit ?? 0); return `<li class="${profit > 0 ? "positive" : profit < 0 ? "negative" : "neutral"}"><span>${entry.rank}</span><div><b>${escapeHtml(entry.teamName)}</b><small>${Number(entry.betCount ?? 0)}条记录 · ${Number(entry.settledBetCount ?? 0)}条已结算</small></div><strong>${profit > 0 ? "+" : ""}${profit.toLocaleString("zh-CN")}</strong></li>`; }).join("");
  const content = state.predictionSection === "records"
    ? `<div class="bet-record-list">${recordRows || `<section class="panel"><p class="empty">你还没有提交过比赛预测。</p></section>`}</div>`
    : state.predictionSection === "ranking"
      ? `<section class="panel ranking-panel"><header class="panel-head"><div><small>PROFIT RANKING</small><b>预测收益榜</b></div></header><ol class="ranking-list">${ranking || `<li class="neutral"><span>-</span><div><b>暂无玩家</b><small>等待首批预测结算</small></div><strong>0</strong></li>`}</ol><p class="ranking-note">按已结算预测的累计返还减累计投入排序</p></section>`
      : `<div class="prediction-list">${cards || `<section class="panel"><p class="empty">当前没有开放中的预测场次。</p></section>`}</div>`;
  return `<header class="view-head"><div><small>PREDICTION V9</small><h1>赛事预测</h1></div><span>余额<br>${Number(state.predictions?.wallet?.balance ?? 0).toLocaleString("zh-CN")} 金币</span></header><section class="prediction-rule"><b>预测规则</b><span>每场各类别只能投入一次，开赛前2分钟截止；赔率提交后锁定，命中返还包含本金。</span></section><nav class="section-tabs"><button data-prediction-section="markets" class="${state.predictionSection === "markets" ? "active" : ""}">预测场次</button><button data-prediction-section="records" class="${state.predictionSection === "records" ? "active" : ""}">我的记录</button><button data-prediction-section="ranking" class="${state.predictionSection === "ranking" ? "active" : ""}">收益榜</button></nav>${content}`;
}

function mineMarkup() {
  return `<header class="view-head"><div><small>MY YELLOWDOGS</small><h1>我的</h1></div><span>${CLIENT_VERSION}</span></header><section class="panel hero"><small>CLUB ACCOUNT</small><h2>${escapeHtml(state.live?.team?.name ?? state.account.profile.nickname)}</h2><p>玩家ID ${escapeHtml(state.account.profile.id)}</p></section><section class="panel"><header class="panel-head"><div><small>CONNECTION</small><b>连接信息</b></div><strong>ONLINE</strong></header><div class="profile-list"><div class="profile-row"><span>账号昵称</span><b>${escapeHtml(state.account.profile.nickname)}</b></div><div class="profile-row"><span>服务器</span><b>YellowDogs League 正式服</b></div><div class="profile-row"><span>客户端版本</span><b>${CLIENT_VERSION}</b></div></div><div class="action-stack"><button class="button secondary wide" data-refresh>立即刷新数据</button><button class="button danger wide" data-logout>退出账号</button></div></section><section class="panel"><p class="empty">赛程、直播、历史战绩和赛事预测均与正式服务器同步。</p></section>`;
}

function quickTeamSummaryMarkup() {
  const live = state.live ?? {};
  const team = live.team ?? {};
  const standing = (live.leagueStandings ?? []).find((entry) => entry.id === team.id);
  const history = (live.history ?? []).slice().sort((a, b) => Number(b.playedAt ?? 0) - Number(a.playedAt ?? 0)).slice(0, 5);
  const form = history.map((match) => { const home = match.homeId === team.id; const own = Number(match.score?.[home ? 0 : 1] ?? 0); const rival = Number(match.score?.[home ? 1 : 0] ?? 0); return own > rival ? "W" : own < rival ? "L" : "D"; });
  const next = (live.schedule ?? []).find((fixture) => fixture.status === "scheduled" || fixture.status === "live");
  const nextOpponent = next ? `${next.venue === "home" ? "主场" : "客场"} · ${next.opponentName ?? "待定"}` : "暂无下一场比赛";
  const nextMeta = next ? `${next.status === "live" ? "正在进行" : countdown(next.startsAt)} · ${next.competitionName ?? "黄狗联赛"}` : "赛程尚未生成";
  const rank = standing?.rank ? `第 ${standing.rank} 名` : "暂无排名";
  const record = standing ? `${standing.won ?? 0}胜 ${standing.drawn ?? 0}平 ${standing.lost ?? 0}负` : "暂无战绩";
  const cup = live.cup ?? {};
  const cupStatus = cup.status === "completed" ? `冠军：${cup.championName ?? "已结束"}` : cup.status === "active" ? `${cup.stage ?? "赛事进行中"}` : "尚未开始";
  const liveCount = (live.broadcasts ?? []).filter((entry) => entry.live !== false).length;
  return `<section class="panel quick-team-summary"><header class="panel-head"><div><small>TEAM SNAPSHOT</small><b>${escapeHtml(team.name ?? "我的球队")}</b><span class="quick-team-subtitle">我的球队快速摘要</span></div><strong>${escapeHtml(rank)}</strong></header><div class="quick-team-next"><small>下一场比赛</small><b>${escapeHtml(nextOpponent)}</b><span>${escapeHtml(nextMeta)}</span></div><div class="quick-team-overview"><div><small>近五场战绩</small><div class="quick-form">${form.length ? form.map((result) => `<i class="${result.toLowerCase()}">${result}</i>`).join("") : "<em>暂无记录</em>"}</div></div><div><small>杯赛状态</small><b>${escapeHtml(cupStatus)}</b></div></div><div class="quick-team-stats"><span><b>${Number(standing?.points ?? 0)}</b><small>联赛积分</small></span><span><b>${escapeHtml(record)}</b><small>赛季战绩</small></span><span><b>${Number(standing?.goalsFor ?? 0)}:${Number(standing?.goalsAgainst ?? 0)}</b><small>进失球</small></span></div><div class="quick-team-foot"><span>今日赛程 <b>${Number((live.schedule ?? []).length)}</b></span><span>历史比赛 <b>${Number((live.history ?? []).length)}</b></span><span>全服直播 <b>${liveCount}</b></span></div></section>`;
}

function render() {
  if (!state.account) {
    app.innerHTML = loginMarkup();
    return;
  }
  if (state.loading && !state.live && !state.demo) {
    app.innerHTML = shellMarkup(`<div class="loading">正在连接黄狗TV…</div>`);
    return;
  }
  const content = state.tab === "yoogle" ? yoogleMarkup() : state.tab === "predictions" ? predictionsMarkup() : state.tab === "honor" ? honorRoomMarkup() : state.tab === "mine" ? mineMarkup() : tvMarkup();
  app.innerHTML = shellMarkup(content);
}

async function loadHonorRoom(force = false) {
  if (!state.account || state.honorRoomRequest || state.honorRoom && !force) return state.honorRoom;
  if (state.demo) {
    state.honorRoom = structuredClone(DEMO.honorRoom);
    state.honorRoomLoading = false;
    render();
    return state.honorRoom;
  }
  state.honorRoomLoading = true;
  if (state.tab === "honor") render();
  const request = api("/api/versus/league/honor-room", { method:"POST", body:identity() })
    .then((value) => {
      state.honorRoom = value.honorRoom ?? null;
      return state.honorRoom;
    })
    .catch((error) => {
      showToast(error.message);
      return state.honorRoom;
    })
    .finally(() => {
      if (state.honorRoomRequest === request) state.honorRoomRequest = null;
      state.honorRoomLoading = false;
      if (state.tab === "honor") render();
    });
  state.honorRoomRequest = request;
  return request;
}

async function loadPlayerDirectory() {
  if (!state.account || state.playerDirectory) return state.playerDirectory;
  if (state.playerDirectoryRequest) return state.playerDirectoryRequest;
  state.playerDirectoryLoading = true;
  if (state.tab === "yoogle") render();
  const request = api("/api/versus/league/player-directory", { method:"POST", body:identity(), timeout:20000 })
    .then((value) => {
      state.playerDirectory = value.playerDirectory ?? { players:[] };
      return state.playerDirectory;
    })
    .catch((error) => {
      showToast(error.message);
      return null;
    })
    .finally(() => {
      if (state.playerDirectoryRequest === request) state.playerDirectoryRequest = null;
      state.playerDirectoryLoading = false;
      if (state.tab === "yoogle") render();
    });
  state.playerDirectoryRequest = request;
  return request;
}

async function refreshData(silent = false) {
  if (!state.account) return;
  if (state.demo) {
    state.live = structuredClone(DEMO.live);
    state.broadcasts = structuredClone(DEMO.broadcasts);
    state.upcoming = structuredClone(DEMO.upcoming);
    state.predictions = structuredClone(DEMO.predictions);
    state.honorRoom = structuredClone(DEMO.honorRoom);
    render();
    return;
  }
  if (!silent) { state.loading = true; render(); }
  try {
    const [broadcastValue, liveValue, predictionValue] = await Promise.all([
      api("/api/versus/broadcasts"),
      api("/api/versus/live", { method:"POST", body:identity() }),
      api("/api/versus/league/predictions", { method:"POST", body:identity() }),
    ]);
    state.broadcasts = broadcastValue.broadcasts ?? [];
    state.upcoming = broadcastValue.upcomingBroadcasts ?? [];
    state.live = liveValue.live ?? null;
    state.predictions = predictionValue.predictions ?? null;
    render();
  } catch (error) {
    if (!silent) showToast(error.message);
  } finally {
    state.loading = false;
  }
}

async function login(form) {
  const data = new FormData(form);
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  state.serverUrl = PRODUCTION_SERVER_URL;
  try {
    const value = await api("/api/versus/login", { method:"POST", body:{ nickname:data.get("nickname"), password:data.get("password") } });
    state.account = { accountToken:value.accountToken, profile:value.profile };
    state.demo = false;
    saveState();
    render();
    await refreshData();
  } catch (error) {
    showToast(error.message);
    submit.disabled = false;
  }
}

function enterDemo() {
  state.account = structuredClone(DEMO.account);
  state.demo = true;
  saveState();
  refreshData();
}

function watchDemo(code) {
  const listed = state.broadcasts.find((entry) => entry.code === code) ?? DEMO.broadcasts[0];
  const players = (prefix, reverse = false) => Array.from({length:11}, (_, index) => {
    const row = index === 0 ? 86 : index < 5 ? 68 : index < 8 ? 45 : 20;
    const groupIndex = index === 0 ? 0 : index < 5 ? index - 1 : index < 8 ? index - 5 : index - 8;
    const groupSize = index === 0 ? 1 : index < 5 ? 4 : 3;
    return { id:`${prefix}${index}`, name:index === 0 ? "门将" : `${prefix}球员${index}`, overall:92 + index % 6, rating:6.4 + (index % 5) * .2, active:true, position:{ x:groupSize === 1 ? 50 : 15 + groupIndex * (70 / Math.max(1, groupSize - 1)), y:reverse ? 100-row : row } };
  });
  pushNavigation({ kind:"watch" });
  state.watch = { code, token:"demo", live:true, match:{ minute:listed.minute, score:listed.score, segment:"secondHalf", weather:{name:"晴朗"}, teams:[{name:listed.teams[0].name,players:players("A"),stats:{possession:56,shots:12,shotsOnTarget:6,xg:1.8}},{name:listed.teams[1].name,players:players("B",true),stats:{possession:44,shots:8,shotsOnTarget:3,xg:1.1}}], events:[{id:"e1",minute:64,text:"左路传中制造威胁，门将将球托出横梁。"},{id:"e2",minute:67,text:"禁区外远射破门，主队扩大领先优势。"}] } };
  renderWatch();
}

function playerPitchMarkup(team) {
  return `<div class="mobile-pitch">${(team.players ?? []).filter((player) => player.active !== false || player.sentOff || player.injury).map((player) => `<span class="pitch-player" style="left:${Number(player.position?.x ?? 50)}%;top:${Number(player.position?.y ?? 50)}%"><b>${escapeHtml(player.name)}</b><small>${Math.round(player.overall ?? 0)} · ${Number(player.rating ?? 0).toFixed(1)}</small></span>`).join("")}</div>`;
}

function matchEventPresentation(event = {}) {
  const type = String(event.type ?? "").toLowerCase();
  const text = String(event.text ?? "").toLowerCase();
  const matches = (...values) => values.some((value) => type.includes(value) || text.includes(value));
  if (matches("goal", "进球", "破门", "扳平", "绝杀", "世界波", "乌龙")) return { tone:"goal", icon:"⚽", label:"进球" };
  if (matches("red", "红牌", "罚下")) return { tone:"red", icon:"■", label:"红牌" };
  if (matches("yellow", "黄牌", "警告")) return { tone:"yellow", icon:"■", label:"黄牌" };
  if (matches("injury", "伤病", "受伤", "伤退")) return { tone:"injury", icon:"✚", label:"伤病" };
  if (matches("penalty", "点球")) return { tone:"penalty", icon:"P", label:"点球" };
  if (matches("substitution", "换人", "替补")) return { tone:"substitution", icon:"↔", label:"换人" };
  if (matches("save", "扑救")) return { tone:"save", icon:"◆", label:"扑救" };
  return { tone:"normal", icon:"•", label:"比赛事件" };
}

function matchEventRowMarkup(event) {
  const presentation = matchEventPresentation(event);
  return `<article class="event-row event-${presentation.tone}"><b class="event-minute">${Number(event.minute ?? 0)}'</b><i class="event-icon" aria-hidden="true">${presentation.icon}</i><div><small>${presentation.label}</small><span>${escapeHtml(event.text ?? "比赛事件")}</span></div></article>`;
}

function renderWatch() {
  const broadcast = state.watch;
  if (!broadcast?.match) return;
  const match = broadcast.match;
  const previousOverlay = document.querySelector(".watch-overlay");
  const previousEventList = previousOverlay?.querySelector(".live-event-list");
  const previousOverlayScrollTop = Number(previousOverlay?.scrollTop ?? 0);
  const previousEventScrollTop = Number(previousEventList?.scrollTop ?? 0);
  const previousEventScrollHeight = Number(previousEventList?.scrollHeight ?? 0);
  const followingLatestEvent = previousEventScrollTop <= 12;
  const possessionTotal = Number(match.teams[0].stats?.possession ?? 0) + Number(match.teams[1].stats?.possession ?? 0) || 1;
  const stats = [
    ["控球", `${Math.round(Number(match.teams[0].stats?.possession ?? 0) / possessionTotal * 100)}%`, `${Math.round(Number(match.teams[1].stats?.possession ?? 0) / possessionTotal * 100)}%`],
    ["射门", match.teams[0].stats?.shots ?? 0, match.teams[1].stats?.shots ?? 0],
    ["射正", match.teams[0].stats?.shotsOnTarget ?? 0, match.teams[1].stats?.shotsOnTarget ?? 0],
    ["xG", match.teams[0].stats?.xg ?? 0, match.teams[1].stats?.xg ?? 0],
  ];
  previousOverlay?.remove();
  document.body.insertAdjacentHTML("beforeend", `<section class="watch-overlay"><header class="watch-toolbar"><button data-close-watch>←</button><div><b>${escapeHtml(broadcast.code)}</b><small>${broadcast.live ? "● LIVE 直播中" : "比赛结束"}</small></div></header><div class="scoreboard"><span><b>${escapeHtml(match.teams[0].name)}</b><small>主队</small></span><span><strong>${Number(match.score?.[0] ?? 0)} : ${Number(match.score?.[1] ?? 0)}</strong><i>${Number(match.minute ?? 0)}'</i></span><span><b>${escapeHtml(match.teams[1].name)}</b><small>客队</small></span></div><main class="watch-content live-watch-content"><section class="panel live-events-panel"><header class="panel-head"><div><small>LIVE EVENTS</small><b>比赛播报</b></div><strong>${match.events?.length ?? 0}</strong></header><div class="event-list live-event-list">${[...(match.events ?? [])].reverse().map(matchEventRowMarkup).join("") || `<p class="empty">比赛正在进行中…</p>`}</div></section><section class="panel live-stats-panel"><header class="panel-head"><div><small>MATCH STATS</small><b>比赛数据</b></div></header><div class="stats-grid">${stats.map(([label,left,right]) => `<div class="stat-row"><b>${left}</b><span>${label}</span><b>${right}</b></div>`).join("")}</div></section><section class="lineup-grid"><section class="panel"><header class="panel-head"><div><small>HOME TACTICS</small><b>${escapeHtml(match.teams[0].name)}</b></div></header>${playerPitchMarkup(match.teams[0])}</section><section class="panel"><header class="panel-head"><div><small>AWAY TACTICS</small><b>${escapeHtml(match.teams[1].name)}</b></div></header>${playerPitchMarkup(match.teams[1])}</section></section></main></section>`);
  const nextOverlay = document.querySelector(".watch-overlay");
  const nextEventList = nextOverlay?.querySelector(".live-event-list");
  if (nextOverlay) nextOverlay.scrollTop = previousOverlayScrollTop;
  if (nextEventList) {
    const insertedHeight = Math.max(0, nextEventList.scrollHeight - previousEventScrollHeight);
    nextEventList.scrollTop = followingLatestEvent ? 0 : previousEventScrollTop + insertedHeight;
  }
}

async function startWatch(code) {
  if (state.demo) return watchDemo(code);
  try {
    const value = await api("/api/versus/watch", { method:"POST", body:{ code, name:state.account.profile.nickname } });
    pushNavigation({ kind:"watch" });
    state.watch = { ...value.broadcast, token:value.spectatorToken };
    renderWatch();
    scheduleWatchRefresh();
  } catch (error) { showToast(error.message); }
}

function scheduleWatchRefresh() {
  clearTimeout(state.watchTimer);
  if (state.watch?.live && !state.demo) state.watchTimer = setTimeout(refreshWatch, 1000);
}

async function refreshWatch() {
  if (!state.watch || state.demo) return;
  try {
    const value = await api(`/api/versus/watch/${encodeURIComponent(state.watch.code)}`, { token:state.watch.token, timeout:7000 });
    state.watch = { ...value.broadcast, token:state.watch.token };
    renderWatch();
    scheduleWatchRefresh();
  } catch (error) {
    showToast(`直播连接波动：${error.message}`);
    state.watchTimer = setTimeout(refreshWatch, 3000);
  }
}

async function closeWatch() {
  const active = state.watch;
  state.watch = null;
  clearTimeout(state.watchTimer);
  document.querySelector(".watch-overlay")?.remove();
  if (active && !state.demo) {
    try { await api(`/api/versus/watch/${encodeURIComponent(active.code)}/leave-watch`, { method:"POST", token:active.token }); } catch {}
  }
}

function showPredictionMarket(marketId) {
  const market = state.predictions?.matchPredictions?.find((entry) => entry.id === marketId);
  if (!market) return showToast("找不到这场预测比赛");
  state.activeMarketId = marketId;
  document.querySelector(".market-sheet")?.remove();
  const categories = availablePredictionCategories(market).map((category) => {
    const existing = market.myBets?.find((bet) => bet.category === category);
    const options = (market.options?.[category] ?? []).map((option) => `<button class="market-option" data-bet-option data-market="${escapeHtml(market.id)}" data-category="${escapeHtml(category)}" data-selection="${escapeHtml(option.id)}" ${existing || !market.eligible ? "disabled" : ""}><span>${escapeHtml(option.label)}</span><b>${Number(option.payoutRate).toFixed(2)}</b></button>`).join("");
    const maxStake = Number(market.maxStakes?.[category] ?? market.maxStake ?? 0);
    return `<section class="market-category ${existing ? "completed" : ""}"><header><div><small>${category === "result" ? escapeHtml(marketHandicap(market)) : "提交后赔率锁定"}</small><b>${escapeHtml(PREDICTION_CATEGORY_LABELS[category] ?? category)}</b></div><strong>${existing ? "已投入" : `上限 ${maxStake.toLocaleString("zh-CN")}`}</strong></header>${existing ? `<div class="existing-bet"><span>${escapeHtml(marketOption(market, category, existing.selection)?.label ?? existing.selection)}</span><b>${Number(existing.payoutRate).toFixed(2)} · ${Number(existing.amount).toLocaleString("zh-CN")}金币</b><small>${escapeHtml(BET_STATUS_LABELS[existing.status] ?? existing.status)}</small></div>` : `<div class="market-options category-${escapeHtml(category)}">${options}</div>`}</section>`;
  }).join("");
  document.body.insertAdjacentHTML("beforeend", `<div class="market-sheet"><section class="market-dialog"><header class="sheet-toolbar"><button data-close-market>←</button><div><small>${escapeHtml(market.competitionName ?? "黄狗联赛")} · ${time(market.startsAt)}</small><b>${escapeHtml(market.homeName)} vs ${escapeHtml(market.awayName)}</b></div></header>${market.eligible ? "" : `<p class="market-lock">${escapeHtml(market.lockedReason ?? "本场暂不可预测")}</p>`}<main>${categories || `<p class="empty">本场盘口仍在生成中。</p>`}<p class="prediction-footnote">半全场按照主队视角的45分钟和90分钟常规时间结果结算；加时赛与点球大战不计入。命中返还包含投入本金。</p></main></section></div>`);
}

function openPredictionMarket(marketId) {
  if (!state.predictions?.matchPredictions?.some((entry) => entry.id === marketId)) return showToast("找不到这场预测比赛");
  pushNavigation({ kind:"market" });
  showPredictionMarket(marketId);
}

function matchDetailMarkup(detail) {
  const teams = detail.teams ?? [];
  const left = teams[0] ?? { name:"主队", stats:{}, players:[] };
  const right = teams[1] ?? { name:"客队", stats:{}, players:[] };
  const possessionTotal = Number(left.stats?.possession ?? 0) + Number(right.stats?.possession ?? 0) || 1;
  const statRows = [
    ["控球", `${Math.round(Number(left.stats?.possession ?? 0) / possessionTotal * 100)}%`, `${Math.round(Number(right.stats?.possession ?? 0) / possessionTotal * 100)}%`],
    ["射门", left.stats?.shots ?? 0, right.stats?.shots ?? 0],
    ["射正", left.stats?.shotsOnTarget ?? 0, right.stats?.shotsOnTarget ?? 0],
    ["xG", left.stats?.xg ?? 0, right.stats?.xg ?? 0],
    ["黄牌", left.stats?.yellowCards ?? 0, right.stats?.yellowCards ?? 0],
    ["红牌", left.stats?.redCards ?? 0, right.stats?.redCards ?? 0],
  ];
  const importantEvents = detail.importantEvents ?? [];
  return `<section class="match-detail-overlay"><header class="watch-toolbar"><button data-close-match-detail>←</button><div><b>${escapeHtml(detail.matchLabel ?? "比赛详情")}</b><small>${time(detail.playedAt)}</small></div></header><div class="scoreboard"><span><b>${escapeHtml(left.name)}</b><small>${escapeHtml(left.formation ?? "主队")}</small></span><span><strong>${Number(detail.score?.[0] ?? 0)} : ${Number(detail.score?.[1] ?? 0)}</strong><i>FT</i></span><span><b>${escapeHtml(right.name)}</b><small>${escapeHtml(right.formation ?? "客队")}</small></span></div><main class="watch-content"><section class="panel"><header class="panel-head"><div><small>HOME LINEUP</small><b>${escapeHtml(left.name)}</b></div></header>${playerPitchMarkup(left)}</section><section class="panel"><header class="panel-head"><div><small>AWAY LINEUP</small><b>${escapeHtml(right.name)}</b></div></header>${playerPitchMarkup(right)}</section><section class="panel"><header class="panel-head"><div><small>IMPORTANT EVENTS</small><b>重点事件</b></div><strong>${importantEvents.length}</strong></header><div class="event-list">${[...importantEvents].reverse().map(matchEventRowMarkup).join("") || `<p class="empty">本场没有重要比赛事件。</p>`}</div></section><section class="panel"><header class="panel-head"><div><small>MATCH STATS</small><b>技术统计</b></div></header><div class="stats-grid">${statRows.map(([label,a,b]) => `<div class="stat-row"><b>${a}</b><span>${label}</span><b>${b}</b></div>`).join("")}</div></section></main></section>`;
}

async function openMatchDetail(matchId) {
  const requestId = `${matchId}-${Date.now()}`;
  state.matchDetailRequest = requestId;
  pushNavigation({ kind:"match-detail" });
  document.querySelector(".match-detail-overlay")?.remove();
  document.body.insertAdjacentHTML("beforeend", `<section class="match-detail-overlay"><header class="watch-toolbar"><button data-close-match-detail>←</button><div><b>比赛详情</b><small>正在读取完整比赛记录…</small></div></header><div class="loading">正在加载比赛详情…</div></section>`);
  try {
    let detail;
    if (state.demo) {
      detail = { matchLabel:"联赛第22轮", playedAt:demoNow - 2*86400000, score:[3,1], teams:[{name:"铁血蓝白AFA",formation:"4-3-3",players:[],stats:{possession:57,shots:14,shotsOnTarget:7,xg:2.4,yellowCards:1,redCards:0}},{name:"伦敦之星",formation:"4-4-2",players:[],stats:{possession:43,shots:8,shotsOnTarget:3,xg:1.0,yellowCards:2,redCards:0}}], importantEvents:[{minute:18,text:"主队通过连续短传取得进球。"},{minute:52,text:"客队快速反击扳回一球。"},{minute:81,text:"禁区外远射锁定胜局。"}] };
    } else {
      const value = await api("/api/versus/league/match/detail", { method:"POST", body:identity({ matchId }) });
      detail = value.match;
    }
    if (state.matchDetailRequest !== requestId) return;
    state.matchDetail = detail;
    document.querySelector(".match-detail-overlay")?.remove();
    document.body.insertAdjacentHTML("beforeend", matchDetailMarkup(detail));
  } catch (error) {
    if (state.matchDetailRequest !== requestId) return;
    document.querySelector(".match-detail-overlay")?.remove();
    state.matchDetailRequest = null;
    showToast(error.message);
    navigateBack();
  }
}

function openBet(marketId, category, selection) {
  const market = state.predictions?.matchPredictions?.find((entry) => entry.id === marketId);
  const option = market?.options?.[category]?.find((entry) => entry.id === selection);
  if (!market?.eligible) return showToast(market?.lockedReason ?? "本场暂不可预测");
  if (market.myBets?.some((bet) => bet.category === category)) return showToast("本场该类别已经预测过");
  state.selectedBet = { marketId, category, selection };
  pushNavigation({ kind:"bet" });
  document.body.insertAdjacentHTML("beforeend", `<div class="bet-sheet"><form class="bet-dialog" data-bet-form><h2>确认赛事预测</h2><p>${escapeHtml(market.homeName)} vs ${escapeHtml(market.awayName)}</p><div class="bet-summary"><span>${escapeHtml(option.label)}</span><b>${Number(option.payoutRate).toFixed(2)}</b></div><label class="field"><span>投入金币（最多 ${Number(market.maxStakes?.[category] ?? market.maxStake ?? 100)}）</span><input name="amount" type="number" inputmode="numeric" min="1" max="${Number(market.maxStakes?.[category] ?? market.maxStake ?? 100)}" value="10" required /></label><div class="login-actions"><button class="button primary wide" type="submit">确认投入</button><button class="button secondary wide" type="button" data-cancel-bet>取消</button></div></form></div>`);
}

async function placeBet(form) {
  const data = new FormData(form);
  const bet = state.selectedBet;
  if (!bet) return;
  const amount = Number(data.get("amount"));
  if (state.demo) {
    const market = state.predictions.matchPredictions.find((entry) => entry.id === bet.marketId);
    const option = marketOption(market, bet.category, bet.selection);
    const record = { id:`demo-bet-${Date.now()}`, marketId:market.id, homeName:market.homeName, awayName:market.awayName, category:bet.category, categoryLabel:PREDICTION_CATEGORY_LABELS[bet.category], selection:bet.selection, selectionLabel:option?.label ?? bet.selection, amount, payoutRate:Number(option?.payoutRate ?? 0), status:"pending", payout:0, createdAt:Date.now(), settledAt:null };
    market.myBets.push(record);
    state.predictions.predictionHistory.unshift(record);
    state.predictions.wallet.balance -= amount;
    document.querySelector(".bet-sheet")?.remove();
    state.selectedBet = null;
    render();
    showPredictionMarket(bet.marketId);
    navigateBack();
    return showToast("演示预测已提交");
  }
  try {
    const value = await api("/api/versus/league/predictions/bet", { method:"POST", body:identity({ ...bet, amount }) });
    state.predictions = value.predictions;
    document.querySelector(".bet-sheet")?.remove();
    state.selectedBet = null;
    render();
    showPredictionMarket(bet.marketId);
    navigateBack();
    showToast("预测提交成功");
  } catch (error) { showToast(error.message); }
}

function logout() {
  closeWatch();
  document.querySelector(".market-sheet")?.remove();
  document.querySelector(".bet-sheet")?.remove();
  document.querySelector(".match-detail-overlay")?.remove();
  state.account = null;
  state.live = null;
  state.predictions = null;
  state.honorRoom = null;
  state.honorRoomLoading = false;
  state.honorRoomRequest = null;
  state.playerDirectory = null;
  state.playerDirectoryLoading = false;
  state.playerDirectoryRequest = null;
  state.yoogleQuery = "";
  state.yoogleDetailId = null;
  state.broadcasts = [];
  state.upcoming = [];
  state.demo = false;
  localStorage.removeItem(STORAGE_KEY);
  render();
}

document.addEventListener("submit", (event) => {
  if (event.target.matches("[data-login-form]")) { event.preventDefault(); login(event.target); }
  if (event.target.matches("[data-bet-form]")) { event.preventDefault(); placeBet(event.target); }
});

document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) { if (state.tab !== tab.dataset.tab) pushViewNavigation(); state.tab = tab.dataset.tab; state.selectedBet = null; document.querySelector(".market-sheet")?.remove(); render(); if (state.tab === "honor") void loadHonorRoom(); return; }
  const tvSection = event.target.closest("[data-tv-section]");
  if (tvSection) { if (state.tvSection !== tvSection.dataset.tvSection) pushViewNavigation(); state.tvSection = tvSection.dataset.tvSection; render(); return; }
  const predictionSection = event.target.closest("[data-prediction-section]");
  if (predictionSection) { if (state.predictionSection !== predictionSection.dataset.predictionSection) pushViewNavigation(); state.predictionSection = predictionSection.dataset.predictionSection; render(); return; }
  if (event.target.closest("[data-logout]")) return logout();
  if (event.target.closest("[data-refresh]")) return refreshData();
  if (event.target.closest("[data-refresh-honor]")) return loadHonorRoom(true);
  if (event.target.closest("[data-close-watch]")) return navigateBack();
  if (event.target.closest("[data-close-market]")) return navigateBack();
  if (event.target.closest("[data-close-match-detail]")) return navigateBack();
  if (event.target.closest("[data-close-yoogle-player]")) return navigateBack();
  if (event.target.closest("[data-cancel-bet]")) return navigateBack();
  const watch = event.target.closest("[data-watch]");
  if (watch) return startWatch(watch.dataset.watch);
  const matchDetail = event.target.closest("[data-match-detail]");
  if (matchDetail) return openMatchDetail(matchDetail.dataset.matchDetail);
  const market = event.target.closest("[data-open-market]");
  if (market) return openPredictionMarket(market.dataset.openMarket);
  const option = event.target.closest("[data-bet-option]");
  if (option) return openBet(option.dataset.market, option.dataset.category, option.dataset.selection);
  const yooglePlayer = event.target.closest("[data-yoogle-player]");
  if (yooglePlayer) return openYooglePlayer(yooglePlayer.dataset.yooglePlayer);
});

document.addEventListener("input", (event) => {
  if (!event.target.matches("[data-yoogle-search]")) return;
  state.yoogleQuery = event.target.value;
  if (!state.playerDirectory && !state.playerDirectoryLoading && state.yoogleQuery.trim()) void loadPlayerDirectory();
  refreshYoogleResults();
});

document.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-yoogle-search]") && !state.playerDirectory && !state.playerDirectoryLoading) void loadPlayerDirectory();
});

window.addEventListener("popstate", (event) => {
  const requestedDepth = Number(event.state?.[NAVIGATION_DEPTH_KEY]);
  const targetDepth = Number.isInteger(requestedDepth) ? Math.max(0, requestedDepth) : Math.max(0, navigationStack.length - 1);
  while (navigationStack.length > targetDepth) closeNavigationEntry(navigationStack.pop());
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(state.watchTimer);
  else if (state.watch) scheduleWatchRefresh();
  else if (state.account && !state.demo) refreshData(true);
});

history.replaceState({ ...(history.state ?? {}), [NAVIGATION_DEPTH_KEY]:0 }, "");
loadSavedState();
render();
if (state.account) refreshData();
setInterval(() => {
  if (!state.account || state.demo || document.hidden) return;
  if (state.watch) api("/api/versus/activity", { method:"POST", body:identity(), timeout:7000 }).catch(() => {});
  else refreshData(true);
}, 15000);
