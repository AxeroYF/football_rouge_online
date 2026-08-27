import { applyS4BondBonuses, evaluateS4LineupBonds } from "./bond-rules.js";
import { CAPTAIN_STYLES, DEFAULT_CAPTAIN_STYLE, normalizeCaptainStyle } from "./captain-rules.js";
import { aPlayerProfileForPlayer } from "./a-player-profiles.js";
import { legendaryProfileForPlayer } from "./legendary-profiles.js";
import { xPlayerProfileForPlayer } from "./x-player-profiles.js";
import { DEFAULT_FORMATION_LINES, FORMATION_LINE_KEYS, formationRoleZones, inferElevenBoardRoles, moveFormationLine, sanitizeFormationLines } from "./formation-rules.js";
import { calculateV2TacticalFit } from "./v2-tactical-fit.js";
import { v2PlayerDutyOptionsForRole } from "./v2-player-duty-options.js";
import { v2OptimalLineupAssignment, v2RecommendedPlayerDuties } from "./v2-tactical-guidance.js";
import {
  applyV2TacticalProfiles,
  DEFAULT_IN_POSSESSION_DETAILS,
  DEFAULT_OUT_OF_POSSESSION_DETAILS,
  IN_POSSESSION_DETAIL_OPTIONS,
  OUT_OF_POSSESSION_DETAIL_OPTIONS,
} from "./v2-tactical-profiles.js";

const V2_TACTICAL_DIMENSIONS = Object.freeze({
  tempo:"比赛节奏",
  directness:"传球纵深",
  attackingWidth:"进攻宽度",
  defensiveLine:"防线高度",
  pressing:"压迫强度",
  compactness:"阵型紧凑",
  counterAttack:"反击倾向",
  timeWasting:"比赛控制",
});
const V2_TACTICAL_PRESETS = Object.freeze({
  allOutAttack:{ tempo:72, directness:58, attackingWidth:60, defensiveLine:76, pressing:72, compactness:42, counterAttack:36, timeWasting:0 },
  positive:{ tempo:60, directness:53, attackingWidth:55, defensiveLine:58, pressing:58, compactness:54, counterAttack:44, timeWasting:5 },
  balanced:{ tempo:50, directness:50, attackingWidth:50, defensiveLine:50, pressing:50, compactness:55, counterAttack:50, timeWasting:15 },
  defensive:{ tempo:44, directness:56, attackingWidth:46, defensiveLine:42, pressing:42, compactness:64, counterAttack:62, timeWasting:32 },
  parkBus:{ tempo:36, directness:60, attackingWidth:42, defensiveLine:28, pressing:30, compactness:72, counterAttack:64, timeWasting:55 },
});
const V2_STYLE_DIMENSION_ADJUSTMENTS = Object.freeze({
  possession:{ tempo:-8, directness:-22, attackingWidth:-4, pressing:2, compactness:8, counterAttack:-18 },
  longBall:{ tempo:7, directness:30, attackingWidth:6, counterAttack:8 },
  wingPlay:{ tempo:5, directness:5, attackingWidth:30, compactness:-8 },
  counterAttack:{ tempo:8, directness:14, defensiveLine:-10, pressing:-6, compactness:8, counterAttack:20 },
  highPress:{ tempo:10, directness:-4, defensiveLine:22, pressing:32, compactness:12, counterAttack:4 },
  lowBlock:{ tempo:-10, directness:8, defensiveLine:-20, pressing:-16, compactness:18, counterAttack:8 },
  roughPlay:{ tempo:4, directness:8, pressing:16, compactness:6 },
});
const LEAGUE_ROLE_CORE_ATTRIBUTES = Object.freeze({
  GK:Object.freeze(["goalkeeping", "reflexes", "positioning", "composure"]),
  DEF:Object.freeze(["tackling", "marking", "positioning", "strength", "pace"]),
  MID:Object.freeze(["passing", "vision", "decisions", "firstTouch", "stamina"]),
  ATT:Object.freeze(["finishing", "offBall", "pace", "dribbling", "composure"]),
});

function leagueOverallFromAttributes(attributes, role) {
  const group = role === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(role) ? "DEF" : ["ST", "LW", "RW"].includes(role) ? "ATT" : "MID";
  const keys = LEAGUE_ROLE_CORE_ATTRIBUTES[group];
  return Math.round(keys.reduce((sum, key) => sum + Number(attributes?.[key] ?? 50), 0) / keys.length);
}

const app = document.querySelector("#app");
const roomStatus = document.querySelector("#room-status");
const leaveButton = document.querySelector("#leave-room");
const accountStatus = document.querySelector("#account-status");
const leagueTopbarClub = document.querySelector("#league-topbar-club");
const accountLogoutButton = document.querySelector("#account-logout");
const accountSettingsButton = document.querySelector("#account-settings");
const toastElement = document.querySelector("#toast");
const SESSION_KEY = "football_test1_versus_room_v1";
const ACCOUNT_KEY = "football_test1_versus_account_v1";
const APP_VIEW_KEY = "football_test1_versus_view_v1";
const BROWSER_SESSION_KEY = "football_test1_versus_browser_session_v1";
const LEAGUE_DESKTOP_THEME_KEY = "yellowdogs_league_desktop_theme_v1";
const OFFLINE_SAVE_KEY = "ydl_offline_save_id_v1";
const AI_TEAM_BADGE = Object.freeze({
  imageUrl:"/versus/assets/system-badges/ai-team-badge.png?v=60c73314770c",
  displayName:"AI球队",
  grade:"SYSTEM",
});
const leagueDesktopMediaQuery = window.matchMedia("(min-width: 1051px)");
const LINE_LABELS = { GK: "门将", DEF: "后场", MID: "中场", ATT: "前场", MIXED:"全位置混池", LEGEND:"随机传奇" };
const ROLE_LABELS = { GK:"门将",CB:"中后卫",LB:"左后卫",RB:"右后卫",LWB:"左边翼卫",RWB:"右边翼卫",DM:"后腰",AM:"前腰",LM:"左中场",RM:"右中场",ST:"中锋",LW:"左边锋",RW:"右边锋" };
const LEAGUE_BENCH_ROLE_ORDER = Object.freeze(["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
const LEAGUE_BENCH_ROLE_RANK = new Map(LEAGUE_BENCH_ROLE_ORDER.map((role, index) => [role, index]));
const TACTICS = { allOutAttack:"全力进攻",positive:"积极进攻",balanced:"攻守平衡",defensive:"防守反击",parkBus:"全力防守" };
const STYLES = { possession:"密集短传",longBall:"长传冲吊",wingPlay:"两翼齐飞",counterAttack:"防守反击",highPress:"高位压迫",lowBlock:"摆大巴",roughPlay:"伐木" };
const FOCUSES = { balanced:"均衡",left:"左路",center:"中路",right:"右路" };
const WEATHER_ICONS = { sunny:"☀️",rain:"🌧️",storm:"⛈️",snow:"❄️",superStorm:"🌪️" };
const STAT_LABELS = { finishing:"射门",passing:"传球",tackling:"抢断",pace:"速度",stamina:"耐力",goalkeeping:"守门",reflexes:"反应",dribbling:"盘带",composure:"镇定" };
const X_ATTRIBUTE_LABELS = { passing:"传球",firstTouch:"停球",dribbling:"盘带",crossing:"传中",finishing:"射门",longShots:"远射",heading:"头球",setPieces:"定位球",tackling:"抢断",marking:"盯人",positioning:"站位",vision:"视野",decisions:"决策",composure:"冷静",offBall:"无球",discipline:"纪律",pace:"速度",acceleration:"加速",strength:"力量",stamina:"耐力",agility:"灵活",jumping:"弹跳",workRate:"投入",aggression:"侵略性",goalkeeping:"守门",reflexes:"反应" };

Object.assign(STAT_LABELS, X_ATTRIBUTE_LABELS);

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
  const configuredAttributes = config.offlineAttributeSettings ?? {};
  offlineAttributeSettings = Object.freeze({
    unlocked:Boolean(config.offlineYdl && configuredAttributes.unlocked),
    overflowRate:[1, 0.5, 0.3].includes(Number(configuredAttributes.overflowRate)) ? Number(configuredAttributes.overflowRate) : 0,
  });
  document.documentElement.dataset.attributeUncap = offlineAttributeSettings.unlocked ? "1" : "0";
  if (config.offlineYdl) {
    offlineYdl = true;
    document.documentElement.dataset.offlineYdl = "1";
    document.title = `YDL S4 Offline | ${document.title}`;
  }
  if (config.environment !== "test") return;
  document.documentElement.dataset.environment = "test";
  document.title = `${config.environmentLabel ?? "S4 测试服"} | ${document.title}`;
}
let publicHosting = false;
let offlineYdl = false;
let offlineAttributeSettings = Object.freeze({ unlocked:false, overflowRate:0 });
let toastTimer = null;
let renderedPhase = null;
let mobileMatchView = "own";
let lastMatchSegment = null;
let lastMatchStructureFingerprint = null;
let lastRenderedMatchEventFingerprint = null;
let networkFailures = 0;
let connectionState = "online";
let actionPending = false;
let roomMutationPending = false;
let roomStateEpoch = 0;
let lastAnimatedEventId = null;
let liveBroadcasts = [];
let upcomingBroadcasts = [];
let spectatorSession = null;
let spectatorPolling = null;
let spectatorPollingFailures = 0;
let spectatorJoinPending = false;
let lastBroadcastRenderFingerprint = null;
let authMode = "login";
let leagueMode = false;
let league = null;
let yellowDogsTvMode = false;
let yellowDogsTv = null;
let yellowDogsTvTab = "schedule";
let yellowDogsTvTimer = null;
let leagueTab = "overview";
let leagueClubPage = "construction";
let leagueReviewMatchId = null;
let leagueReviewDetail = null;
let leagueReviewLoading = false;
let leagueReviewReplayFrameIndex = 0;
let leagueReviewReplayPlaying = true;
let leagueReviewReplayAnimationToken = 0;
let leagueBoard = "scorers";
let leagueCupPage = "league";
let leagueTacticsMode = "club";
const leagueTacticsContexts = { club:null };
let leagueCupRoundPage = null;
let leagueRoundPage = null;
let leagueHistoryTeamId = null;
let leagueStartingIds = null;
let leaguePositions = null;
let leaguePositionPresets = null;
let leagueFormationLinePresets = null;
let leagueActivePositionPreset = "position1";
let leagueTacticalDraft = null;
let leagueMobileTacticalPlanState = "opening";
let leagueMobileDutyPlayerId = null;
let leagueAutoSaveTimer = null;
let leagueAutoSaveRevision = 0;
let leagueAutoSavePending = false;
let leagueTacticalShapePreviewPlaying = false;
let leagueTacticalShapePreviewRequestId = 0;
let leagueTacticalShapePreviewSnapshot = null;
let leagueInboxMessageId = null;
let leagueInboxCategory = "all";
let leagueInboxUnreadOnly = false;
let leagueHonorRoomLoading = false;
let leagueHonorRoomRequest = null;
let leaguePlayerDirectoryLoading = false;
let leaguePlayerDirectoryRequest = null;
let leagueShowChemistry = true;
let leagueShowBondBonuses = false;
let leagueShowRoleZones = false;
let leagueMutationPending = false;
let leagueSyncPending = false;
let leagueEditorDirty = false;
let leagueMarketSection = null;
let leagueMarketListingSearch = "";
let leagueMarketWarehouseSearch = "";
let leagueMarketListingPosition = "ALL";
let leagueMarketWarehousePosition = "ALL";
let leagueMarketWarehouseUpgrade = "ALL";
let leagueMarketListingPage = 1;
let leagueMarketWarehousePage = 1;
const LEAGUE_MARKET_PAGE_SIZE = 24;
let leagueTradeTargetOwnerId = "";
let leagueTradeOfferedCardIds = new Set();
let leagueTradeRequestedCardIds = new Set();
let leagueTradeCoinAmount = "";
let leaguePlayerInfoSection = null;
let leaguePlayerSearchDraft = "";
let leaguePlayerSearchQuery = "";
let leaguePlayerSearchView = "list";
let leagueOverviewPlayerSearch = "";
let leagueOverviewPlayerComparison = [];
let leagueEnhancementRankingSearch = "";
let leagueEnhancementRankingPosition = "ALL";
let leagueEnhancementRankingGrade = "ALL";
let leagueEnhancementRankingLevel = "ALL";
let leagueEnhancementRankingView = "list";
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
let leagueBackpackSelectedOwnershipIds = new Set();
let leagueEnhancementMainCardId = null;
let leagueEnhancementMaterialCardId = null;
let leagueEnhancementUseProtection = false;
let leagueEnhancementPhase = "idle";
let leagueEnhancementResult = null;
let leagueEnhancementPendingRequest = null;
let leagueBatchEnhancementResult = null;
let leagueEnhancementTraitSelectionOpen = false;
let leagueXGrowthMutationPending = false;
let leagueXGrowthPendingField = null;
let leagueXGrowthPendingAmount = null;
let leagueXGrowthPendingMode = null;
let leagueXGrowthResetTraitOpen = false;
let leagueXGrowthResetRole = null;
let leagueXGrowthResetSecondaryRole = null;
let leagueMobileNavOpen = false;
let leagueDesktopTheme = readLeagueDesktopTheme();
const PLAYER_GRADE_ORDER = Object.freeze({ X:0, S:1, A:2, B:3, C:4 });
const LEAGUE_TAB_LABELS = Object.freeze({ overview:"联赛总览", cup:"杯赛总览", seasonFinal:"赛季总决赛", predictions:"比赛预测", schedule:"日程表", squad:"阵容战术", coach:"主教练", inbox:"收件箱", backpack:"背包", enhancement:"球员强化", "x-growth":"巨星之路", players:"球员信息", television:"电视台", stats:"数据榜单", club:"俱乐部", shop:"商店", market:"交易市场" });
const LEAGUE_INBOX_CATEGORIES = Object.freeze([
  { id:"all", label:"全部" },
  { id:"action", label:"待处理" },
  { id:"competition", label:"赛事" },
  { id:"rewards", label:"奖励与收益" },
  { id:"trades", label:"交易" },
  { id:"announcements", label:"公告" },
]);
const LEAGUE_INBOX_TYPE_META = Object.freeze({
  "daily-report":{ label:"球队日报", category:"competition" },
  matchweek:{ label:"比赛周", category:"competition" },
  medical:{ label:"队医报告", category:"competition" },
  lineup:{ label:"阵容轮换", category:"competition" },
  friendly:{ label:"友谊赛", category:"competition" },
  "friendly-invite":{ label:"友谊赛邀请", category:"competition" },
  reward:{ label:"阶段奖励", category:"rewards" },
  prediction:{ label:"比赛预测", category:"rewards" },
  "prediction-share":{ label:"系统收益均分", category:"rewards" },
  "mirror-settlement":{ label:"镜像收益", category:"rewards" },
  "mirror-batch-report":{ label:"镜像模拟", category:"competition" },
  "trait-compensation":{ label:"特性补偿", category:"rewards" },
  transfer:{ label:"转会消息", category:"trades" },
  "trade-offer":{ label:"交易报价", category:"trades" },
  "trade-result":{ label:"交易结果", category:"trades" },
  "trade-public":{ label:"重要转会", category:"trades" },
  notice:{ label:"联赛通知", category:"announcements" },
  announcement:{ label:"全服公告", category:"announcements" },
  "admin-update":{ label:"管理员公告", category:"announcements" },
});

function comparePlayerGrade(left, right) {
  return (PLAYER_GRADE_ORDER[left.player?.grade] ?? 99) - (PLAYER_GRADE_ORDER[right.player?.grade] ?? 99);
}
let leagueEnhancementListingFilter = "UNLISTED";
let leagueScheduleClockTimer = null;
let leagueScheduleClockOffset = 0;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function leagueWithCachedLazyViews(nextLeague, previousLeague = league) {
  if (!nextLeague) return nextLeague;
  const withDirectory = !Object.hasOwn(nextLeague, "playerDirectory") && previousLeague?.playerDirectory
    ? { ...nextLeague, playerDirectory:previousLeague.playerDirectory }
    : nextLeague;
  if (Object.hasOwn(withDirectory, "honorRoom")) return withDirectory;
  const cached = previousLeague?.honorRoom;
  const sameHonorVersion = withDirectory.honorRoomUpdatedAt == null || cached?.updatedAt === withDirectory.honorRoomUpdatedAt;
  return cached?.club?.ownerId && cached.club.ownerId === withDirectory.ownTeam?.ownerId && sameHonorVersion
    ? { ...withDirectory, honorRoom:cached }
    : withDirectory;
}

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) ?? null; } catch { return null; }
}

function readAccount() {
  try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)) ?? null; } catch { return null; }
}

function readAppView() {
  try {
    const value = JSON.parse(localStorage.getItem(APP_VIEW_KEY));
    return value?.playerId === account?.profile?.id ? value : null;
  } catch { return null; }
}

function storeAppView(mode, detail = {}) {
  if (!account?.profile?.id) return;
  try {
    localStorage.setItem(APP_VIEW_KEY, JSON.stringify({ playerId:account.profile.id, mode, ...detail, updatedAt:Date.now() }));
  } catch {}
}

function clearAppView() {
  try { localStorage.removeItem(APP_VIEW_KEY); } catch {}
}

function storeLeagueView() {
  storeAppView("league", {
    leagueTab,
    leagueCupPage,
    leagueCupRoundPage,
    leagueRoundPage,
    leagueBackpackPage,
    leagueClubPage,
    leaguePlayerInfoSection,
    leagueInboxMessageId,
    leagueInboxCategory,
    leagueInboxUnreadOnly,
  });
}

function restoreLeagueView(value) {
  const validTabs = new Set(["overview", "cup", "seasonFinal", "predictions", "schedule", "squad", "coach", "inbox", "backpack", "enhancement", "x-growth", "players", "television", "stats", "club", "shop", "market"]);
  leagueTab = value.leagueTab === "honorRoom" ? "club" : validTabs.has(value.leagueTab) ? value.leagueTab : "overview";
  leagueClubPage = value.leagueTab === "honorRoom" || value.leagueClubPage === "honorRoom" ? "honorRoom" : "construction";
  leagueCupPage = value.leagueCupPage === "knockout" ? "knockout" : "league";
  leagueCupRoundPage = Number.isFinite(value.leagueCupRoundPage) ? value.leagueCupRoundPage : null;
  leagueRoundPage = Number.isFinite(value.leagueRoundPage) ? value.leagueRoundPage : null;
  leagueBackpackPage = ["packs", "cards", "items"].includes(value.leagueBackpackPage) ? value.leagueBackpackPage : "packs";
  leaguePlayerInfoSection = typeof value.leaguePlayerInfoSection === "string" ? value.leaguePlayerInfoSection : null;
  leagueInboxMessageId = typeof value.leagueInboxMessageId === "string" ? value.leagueInboxMessageId : null;
  leagueInboxCategory = typeof value.leagueInboxCategory === "string" ? value.leagueInboxCategory : "all";
  leagueInboxUnreadOnly = value.leagueInboxUnreadOnly === true;
}

async function restoreAppView() {
  const value = readAppView();
  if (!value || value.mode === "landing") return false;
  if (value.mode === "league") {
    restoreLeagueView(value);
    await openLeague();
    return true;
  }
  if (value.mode === "yellowDogsTv") {
    yellowDogsTvTab = ["schedule", "history", "television"].includes(value.yellowDogsTvTab) ? value.yellowDogsTvTab : "schedule";
    openYellowDogsTv();
    return true;
  }
  return false;
}

function readLeagueDesktopTheme() {
  try { return localStorage.getItem(LEAGUE_DESKTOP_THEME_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
}


function applyLeagueDesktopTheme() {
  document.documentElement.dataset.leagueTheme = leagueDesktopTheme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = leagueDesktopMediaQuery.matches && leagueDesktopTheme === "light" ? "#eef2f6" : "#071411";
}

function leagueThemeToggleMarkup() {
  const isLight = leagueDesktopTheme === "light";
  return `<button type="button" class="league-theme-toggle" data-league-theme-toggle aria-pressed="${isLight}"><span aria-hidden="true">${isLight ? "☾" : "☀"}</span><b>${isLight ? "深色模式" : "浅色模式"}</b><small>${isLight ? "切换暗色主题" : "切回默认主题"}</small></button>`;
}

function toggleLeagueDesktopTheme() {
  leagueDesktopTheme = leagueDesktopTheme === "light" ? "dark" : "light";
  try { localStorage.setItem(LEAGUE_DESKTOP_THEME_KEY, leagueDesktopTheme); } catch {}
  applyLeagueDesktopTheme();
  const toggle = document.querySelector("[data-league-theme-toggle]");
  if (toggle) toggle.outerHTML = leagueThemeToggleMarkup();
}


leagueDesktopMediaQuery.addEventListener?.("change", applyLeagueDesktopTheme);
applyLeagueDesktopTheme();

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs ?? 10_000));
  let response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: { "content-type":"application/json", ...((options.token ?? session?.token) ? { authorization:`Bearer ${options.token ?? session.token}` } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal:controller.signal,
    });
  } catch (requestError) {
    if (requestError.name === "AbortError") throw new Error("请求超时，请确认本地测试服仍在运行");
    throw new Error("无法连接本地测试服，请确认启动服务的 PowerShell 窗口仍在运行");
  } finally {
    clearTimeout(timeout);
  }
  const value = await response.json();
  if (!response.ok || !value.ok) {
    const error = new Error(value.error ?? "请求失败");
    error.status = response.status;
    error.details = value.details ?? [];
    throw error;
  }
  return value;
}

function updateChrome() {
  const active = Boolean(room && session);
  const leagueActive = Boolean(leagueMode || yellowDogsTvMode);
  accountStatus.hidden = !account;
  accountLogoutButton.hidden = !account || active || leagueActive;
  accountSettingsButton.hidden = !account || active || leagueActive;
  roomStatus.hidden = !active;
  leaveButton.hidden = !active && !leagueActive;
  if (account) accountStatus.innerHTML = `<small>当前账号</small><b>${escapeHtml(account.profile.nickname)}</b>`;
  roomStatus.classList.toggle("reconnecting", connectionState !== "online");
  if (active) roomStatus.innerHTML = `<i></i><span>${connectionState === "online" ? "房间" : "重连中"}</span><b>${escapeHtml(room.code)}</b><span>${({ lobby:"等待好友",draft:"限时选秀",tactics:"战术准备",match:"比赛中",report:"比赛结束" })[room.phase] ?? room.phase}</span>`;
  updateLeagueTopbarClub();
}

function openAccountSettings() {
  const overlay = openLeagueDialog(`<header><div><small>ACCOUNT SECURITY</small><h2>账号设置</h2><p>修改登录密码后，当前账号会继续保持登录。</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><form class="account-settings-form" id="account-password-form"><label class="field"><span>当前密码</span><input name="currentPassword" type="password" autocomplete="current-password" required></label><label class="field"><span>新密码</span><input name="nextPassword" type="password" minlength="6" autocomplete="new-password" required></label><label class="field"><span>确认新密码</span><input name="confirmPassword" type="password" minlength="6" autocomplete="new-password" required></label><p class="auth-error" data-account-password-error></p><footer><button type="button" class="button secondary" data-close-league-dialog>取消</button><button type="submit" class="button primary">保存新密码</button></footer></form>`, "account-settings-dialog");
  overlay.querySelector("#account-password-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const error = overlay.querySelector("[data-account-password-error]");
    const submit = event.currentTarget.querySelector("button[type=submit]");
    if (form.get("nextPassword") !== form.get("confirmPassword")) { error.textContent = "两次输入的新密码不一致"; return; }
    submit.disabled = true;
    try {
      const value = await api("/api/versus/profile/password", { method:"POST", body:{ playerId:account.profile.id, accountToken:account.accountToken, currentPassword:form.get("currentPassword"), nextPassword:form.get("nextPassword") } });
      storeAccount({ accountToken:value.accountToken, profile:value.profile });
      closeLeagueDialog();
      showToast("密码已修改");
    } catch (changeError) { error.textContent = changeError.message; submit.disabled = false; }
  };
}

function updateLeagueTopbarClub() {
  const active = Boolean(leagueMode && league?.ownTeam);
  if (!leagueTopbarClub) return;
  leagueTopbarClub.hidden = !active;
  if (!active) {
    leagueTopbarClub.innerHTML = "";
    return;
  }
  const rosterSlotsUsed = league.ownTeam.s4Assets?.rosterSlotsUsed ?? league.ownTeam.roster.length;
  const rosterLimit = league.ownTeam.s4Assets?.rosterLimit ?? 33;
  leagueTopbarClub.innerHTML = `<div class="league-club-resources"><span><small>大名单</small><b>${rosterSlotsUsed}<i>/</i>${rosterLimit}</b></span><span class="league-wallet-balance"><small>球队金币</small><b>${Number(league.wallet.balance).toLocaleString("zh-CN")}</b></span></div><div class="league-team-mark"><small>球队</small><div class="league-team-name-row"><b>${escapeHtml(league.ownTeam.name)}</b><button type="button" class="league-team-name-edit" data-league-team-name-edit aria-label="修改球队名称" title="修改球队名称">&#9998;</button></div></div>`;
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

function historyStageViews(detail, teamIndex) {
  const views = {};
  for (const snapshot of detail.analysisTimeline ?? []) {
    const team = snapshot?.teams?.[teamIndex];
    const stage = team?.plan ?? (Number(snapshot?.minute) === 0 ? "opening" : null);
    if (!["opening", "leading", "trailing"].includes(stage) || views[stage] || !team?.positions || !Array.isArray(team?.players)) continue;
    views[stage] = team;
  }
  return views;
}

function historyPitchMagnets(team, stage = null, landscape = false, attackingLeft = false) {
  const stagePlayers = new Map((stage?.players ?? []).map((player) => [player.id, player]));
  return team.players.map((player) => {
    const stagePlayer = stagePlayers.get(player.id);
    const position = stage?.positions?.[player.id] ?? player.position ?? team.positions?.[player.id] ?? { x:50, y:50 };
    const boardX = Math.max(4, Math.min(96, Number(position.x ?? 50)));
    const boardY = Math.max(4, Math.min(96, Number(position.y ?? 50)));
    const x = landscape ? (attackingLeft ? boardY : 100 - boardY) : boardX;
    const y = landscape ? (attackingLeft ? 100 - boardX : boardX) : boardY;
    const sentOff = stagePlayer ? stagePlayer.sentOff : player.sentOff;
    const injury = stagePlayer ? stagePlayer.injury : player.injury;
    const active = stagePlayer ? stagePlayer.active : player.active;
    const status = sentOff ? "红牌" : injury ? "伤退" : active === false ? "离场" : "";
    const assignedRole = stagePlayer?.assignedRole ?? player.assignedRole ?? player.role;
    const role = ROLE_LABELS[assignedRole] ?? assignedRole;
    const fitness = Math.max(0, Math.min(100, Math.round(stagePlayer?.fitness ?? player.fitness ?? 100)));
    const upgrade = Number(player.upgradeLevel ?? 0);
    const tooltip = `${player.name} · ${role} · 综合能力 ${player.overall} · 比赛评分 ${Number(player.rating).toFixed(1)}${status ? ` · ${status}` : ""}`;
    return `<div class="magnet league-squad-magnet history-report-magnet grade-${String(player.grade ?? "C").toLowerCase()} fit-primary ${status ? "inactive unavailable" : ""}" style="left:${x}%;top:${y}%" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}">${captainBadgeMarkup(Boolean(player.captain ?? (player.id === team.captainId)))}<span class="league-magnet-role">${escapeHtml(role)}${status ? ` · ${status}` : ""}</span><b>${escapeHtml(player.name)}</b><i>${Number(player.overall ?? 0)}</i><span class="league-magnet-fitness" aria-label="体力 ${fitness}"><span style="width:${fitness}%"></span></span><span class="history-report-rating">评分 ${Number(player.rating ?? 0).toFixed(1)}</span>${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}</div>`;
  }).join("");
}

function historyTeamMarkup(team, hideStrategy = false, stageViews = {}) {
  const strategy = hideStrategy ? "战术不公开" : `${TACTICS[team.tactic] ?? team.tactic} · ${STYLES[team.style] ?? team.style} · 主攻${FOCUSES[team.attackFocus] ?? team.attackFocus} · 主守${FOCUSES[team.defenseFocus] ?? team.defenseFocus}`;
  const players = [...team.players].sort((left, right) => right.rating - left.rating);
  const averageRating = players.length ? players.reduce((sum, player) => sum + Number(player.rating ?? 0), 0) / players.length : 0;
  const stageLabels = { opening:"默认站位", leading:"领先站位", trailing:"落后站位" };
  const availableStages = ["opening", "leading", "trailing"].filter((stage) => stageViews[stage]);
  const activeStage = availableStages[0] ?? null;
  const switches = `<nav class="league-position-tabs history-stage-switch" aria-label="比赛阶段站位">${Object.entries(stageLabels).map(([stage, label]) => {
    const view = stageViews[stage];
    return `<button type="button" data-history-stage="${stage}" class="${stage === activeStage ? "active" : ""}" ${view ? `title="${escapeHtml(view.formation ?? "阵型未知")}"` : `disabled title="本场未出现"`} aria-pressed="${stage === activeStage}">${label}</button>`;
  }).join("")}</nav>`;
  const pitches = availableStages.length
    ? availableStages.map((stage) => `<div class="history-stage-panel ${stage === activeStage ? "active" : ""}" data-history-stage-panel="${stage}">${pitchMarkup(historyPitchMagnets(team, stageViews[stage]), "", "history-pitch s4-readonly-pitch")}</div>`).join("")
    : `<div class="history-stage-panel active">${pitchMarkup(historyPitchMagnets(team), "", "history-pitch s4-readonly-pitch")}</div>`;
  return `<section class="history-team"><header><div class="history-team-title"><h3>${escapeHtml(team.name)}</h3><small>${escapeHtml(team.formation)} · ${escapeHtml(strategy)}</small></div>${switches}<b>${team.stats.xg} xG · 平均评分 ${averageRating.toFixed(1)}</b></header>${pitches}<div class="history-player-list">${players.map((player) => `<div><span><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.assignedRole ?? player.role] ?? player.assignedRole ?? player.role}${player.sentOff ? " · 红牌" : player.injury ? " · 伤退" : ""}</small></span><em>${player.stats.goals}球 ${player.stats.assists}助</em><span class="history-player-values"><small>能力</small><b>${Number(player.overall ?? 0)}</b></span><span class="history-player-values rating"><small>评分</small><b>${Number(player.rating ?? 0).toFixed(1)}</b></span></div>`).join("")}</div></section>`;
}

function historyReviewMetricMarkup(metric) {
    const own = Math.max(0, Number(metric.own ?? 0));
    const rival = Math.max(0, Number(metric.rival ?? 0));
    const maximum = Math.max(own, rival, 1);
  return `<div class="history-review-metric"><header><b>${escapeHtml(metric.label)}</b><small>${metric.edge === "own" ? "本方占优" : metric.edge === "rival" ? "对手占优" : "双方持平"}</small></header><div class="history-review-versus"><strong>${escapeHtml(metric.ownText)}</strong><div><i class="own" style="width:${Math.round((own / maximum) * 100)}%"></i><i class="rival" style="width:${Math.round((rival / maximum) * 100)}%"></i></div><strong>${escapeHtml(metric.rivalText)}</strong></div></div>`;
}

function historyV2ReviewMarkup(review, ownName, rivalName) {
  const facts = review.engineFacts ?? {};
  const guidance = review.guidance ?? {};
  const confidence = guidance.confidence ?? facts.confidence ?? {};
  const primary = guidance.primary ?? { label:"比赛过程", status:"stable", statusLabel:"结论不足", verdict:review.headline, advice:review.summary };
  const isLoss = review.outcome === "loss";
  const reviewQuestion = isLoss ? "为什么会输？" : review.outcome === "draw" ? "为什么没能取胜？" : "下一场还应优化什么？";
  const primaryHeadline = isLoss ? guidance.summary ?? review.headline : review.headline;
  const primaryAdvice = isLoss ? primary.advice ?? review.summary : review.summary;
  const chain = (guidance.causeChain ?? []).map((step, index) => `<li><span>${index + 1}</span><b>${escapeHtml(step)}</b></li>`).join("");
  const diagnoses = (guidance.units ?? []).map((item) => `<article class="history-coach-diagnosis status-${escapeHtml(item.status ?? "stable")}"><header><div><small>${escapeHtml(item.statusLabel ?? "比赛观察")}</small><h4>${escapeHtml(item.label)}</h4></div><span>${item.key === primary.key ? "首要问题" : "分项判断"}</span></header><p>${escapeHtml(item.verdict)}</p><ul>${(item.evidence ?? []).map((evidence) => `<li>${escapeHtml(evidence)}</li>`).join("")}</ul><footer><b>${escapeHtml(item.advice)}</b></footer></article>`).join("");
  const areas = (guidance.problemAreas ?? []).map((area) => `<article class="history-coach-area status-${escapeHtml(area.severity ?? "warning")}"><span>${escapeHtml(area.type === "defense" ? "防守区域" : area.type === "midfield" ? "中场区域" : "进攻区域")}</span><div><h4>${escapeHtml(area.title)}</h4><p>${escapeHtml(area.evidence)}</p><b>${escapeHtml(area.advice)}</b></div></article>`).join("");
  const recommendations = (guidance.recommendations ?? []).map((item) => `<article><span>${Number(item.priority ?? 0)}</span><div><small>${escapeHtml(item.target ?? "调整项")}</small><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.action)}</p><em>${escapeHtml(item.reason)}</em></div></article>`).join("");
  const areaMarkup = areas ? `<section class="history-coach-areas"><header><div><small>WHERE IT BROKE</small><h3>具体问题区域</h3></div><span>基于V2二十区域比赛事件</span></header><div>${areas}</div></section>` : `<section class="history-coach-no-area"><b>没有定位到单一区域的持续性漏洞</b><span>问题更可能来自全队协作、终结波动或关键事件。</span></section>`;
  return `<section class="history-review history-coach-review"><header><div><small>MATCH REVIEW · COACH GUIDANCE</small><h2>赛后教练复盘</h2></div><span>诊断可信度 ${escapeHtml(confidence.label ?? "未知")}</span></header><section class="history-coach-primary status-${escapeHtml(primary.status ?? "stable")}"><div><small>${escapeHtml(ownName)}视角 · ${escapeHtml(primary.statusLabel ?? "比赛结论")}</small><h3>${escapeHtml(primaryHeadline)}</h3><p>${escapeHtml(primaryAdvice)}</p></div><aside><small>先回答这个问题</small><b>${escapeHtml(reviewQuestion)}</b><strong>${escapeHtml(primary.label)}</strong></aside></section>${isLoss && chain ? `<section class="history-coach-chain"><header><small>HOW THE PROBLEM SPREAD</small><h3>问题是怎样传导到比分的</h3></header><ol>${chain}</ol></section>` : ""}<section class="history-coach-diagnoses"><header><div><small>FIVE-PART DIAGNOSIS</small><h3>五项比赛诊断</h3></div><span>结论 → 证据 → 调整</span></header><div>${diagnoses}</div></section>${areaMarkup}<section class="history-coach-recommendations"><header><div><small>NEXT MATCH PLAN</small><h3>下一场优先调整</h3></div><span>按顺序执行，不建议同时大改</span></header><div>${recommendations}</div></section><details class="history-coach-provenance"><summary>查看本次诊断的数据依据</summary><div><span><small>引擎配置</small><b>${escapeHtml(facts.engineProfile ?? "V2")}</b></span><span><small>空间模型</small><b>${escapeHtml(facts.spatialModelVersion ?? "V2 spatial")}</b></span><span><small>控球链样本</small><b>${Number(facts.chainCount ?? 0)} 条</b></span><span><small>覆盖度</small><b>${Math.round(Number(confidence.score ?? 0) * 100)}%</b></span></div><p>诊断使用V2控球链五阶段、二十区域事件、阵地/转换进攻、xG与射门、阵型结构及位置/战术适配；旧版失利百分比不参与页面结论。</p></details></section>`;
}

function historyReviewMarkup(review, ownName, rivalName) {
  if (!review) return "";
  if (Number(review.version) >= 3 && review.source === "v2-engine-report") return historyV2ReviewMarkup(review, ownName, rivalName);
  const metrics = (review.metrics ?? []).map(historyReviewMetricMarkup).join("");
  const conclusions = (review.conclusions ?? []).map((item, index) => `<article class="history-review-point tone-${escapeHtml(item.tone ?? "neutral")}"><span>0${index + 1}</span><div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.text)}</p></div></article>`).join("");
  const attribution = review.lossAttribution;
  const v2Review = Number(review.version) >= 2 || review.source === "v2-engine-report";
  const attributionMarkup = attribution ? `<section class="history-loss-attribution"><header><div><small>${v2Review ? "LOSS ATTRIBUTION · V2 ENGINE FACTS" : "LOSS ATTRIBUTION · LEGACY ESTIMATE"}</small><h3>${escapeHtml(attribution.title)}</h3></div><strong>首要因素：${escapeHtml(attribution.primary?.label)} ${Number(attribution.primary?.percent ?? 0)}%</strong></header><div class="history-loss-bar">${attribution.items.map((item) => `<i class="factor-${escapeHtml(item.key)}" style="width:${Number(item.percent)}%" title="${escapeHtml(item.label)} ${Number(item.percent)}%"></i>`).join("")}</div><div class="history-loss-factors">${attribution.items.map((item) => `<article class="factor-${escapeHtml(item.key)}"><span></span><div><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></div><strong>${Number(item.percent)}%</strong></article>`).join("")}</div>${attribution.note ? `<p>${escapeHtml(attribution.note)}</p>` : ""}</section>` : "";
  return `<section class="history-review"><header><div><small>${v2Review ? "MATCH REVIEW · V2 ENGINE DATA" : "MATCH REVIEW · LEGACY DATA"}</small><h2>赛后复盘</h2></div><span>基于本场实录</span></header><div class="history-review-verdict"><small>${escapeHtml(ownName)}视角</small><h3>${escapeHtml(review.headline)}</h3><p>${escapeHtml(review.summary)}</p><em>射门转化率：本方 ${escapeHtml(review.efficiency?.own ?? "0%")} · 对手 ${escapeHtml(review.efficiency?.rival ?? "0%")}</em></div><div class="history-review-labels"><span>${escapeHtml(ownName)}</span><span>${escapeHtml(rivalName)}</span></div><div class="history-review-metrics">${metrics}</div><div class="history-review-points">${conclusions}</div>${attributionMarkup}</section>`;
}

function historyMatchMarkup(detail) {
  const viewerIndex = Number(detail.viewerIndex ?? 0);
  const opponentIndex = viewerIndex === 0 ? 1 : 0;
  const displayScore = detail.aggregateScore ?? detail.score;
  const won = detail.winnerIndex === viewerIndex;
  const timeline = detail.importantEvents?.length ? detail.importantEvents.map(reportTimelineItem).join("") : `<p class="history-empty">本场没有重点事件。</p>`;
  const matchLabel = detail.matchLabel ?? (detail.competition === "friendly" ? "友谊赛" : Number.isFinite(Number(detail.round)) ? `第${detail.round}轮` : "比赛");
  return `<header class="history-detail-head"><button class="icon-button" data-close-history aria-label="关闭">×</button><div><small>${new Date(detail.playedAt).toLocaleString()} · ${escapeHtml(detail.roomCode)} · ${escapeHtml(matchLabel)}</small><h2>${displayScore[viewerIndex] === displayScore[opponentIndex] ? "本场战平" : won ? "本场获胜" : "本场失利"}</h2></div></header><div class="history-detail-score"><span>${escapeHtml(detail.teams[viewerIndex].name)}</span><b>${displayScore[viewerIndex]} : ${displayScore[opponentIndex]}</b><span>${escapeHtml(detail.teams[opponentIndex].name)}</span>${detail.aggregateBaseScore ? `<small>首回合 ${detail.aggregateBaseScore[viewerIndex]}:${detail.aggregateBaseScore[opponentIndex]} · 第二回合 ${detail.score[viewerIndex]}:${detail.score[opponentIndex]}</small>` : ""}${detail.penalties ? `<small>点球 ${detail.penalties[viewerIndex]} : ${detail.penalties[opponentIndex]}</small>` : ""}<em>${weatherIcon(detail.weather)} ${escapeHtml(detail.weather?.name ?? "未知天气")}</em></div><div class="history-detail-grid"><section class="report-panel timeline-panel"><h2>重点事件</h2><div class="match-timeline">${timeline}</div></section><section class="report-panel compact-stats-panel"><h2>比赛统计</h2>${matchStatsMarkup(detail, [viewerIndex, opponentIndex])}</section></div><div class="history-team-grid">${[viewerIndex, opponentIndex].map((index) => historyTeamMarkup(detail.teams[index], Boolean(detail.hideStrategies), historyStageViews(detail, index))).join("")}</div>${historyReviewMarkup(detail.review, detail.teams[viewerIndex].name, detail.teams[opponentIndex].name)}`;
}

function switchHistoryStage(button) {
  if (!button || button.disabled) return;
  const team = button.closest(".history-team");
  if (!team) return;
  team.querySelectorAll("[data-history-stage]").forEach((item) => {
    item.classList.toggle("active", item === button);
    item.setAttribute("aria-pressed", item === button ? "true" : "false");
  });
  team.querySelectorAll("[data-history-stage-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.historyStagePanel === button.dataset.historyStage));
}

function closeHistoryMatch() {
  document.querySelector("#history-detail-overlay")?.remove();
}

async function openHistoryMatch(matchId) {
  if (!account?.profile?.id || !account?.accountToken) return showToast("请先绑定账号");
  closeHistoryMatch();
  document.body.insertAdjacentHTML("beforeend", `<div class="history-detail-overlay" id="history-detail-overlay"><section class="history-detail-dialog"><header class="history-detail-head"><button class="icon-button" data-close-history aria-label="关闭">×</button><div><small>历史对局</small><h2>正在读取比赛详情…</h2></div></header></section></div>`);
  const overlay = document.querySelector("#history-detail-overlay");
  overlay.addEventListener("click", (event) => {
    const stageButton = event.target.closest("[data-history-stage]");
    if (stageButton) return switchHistoryStage(stageButton);
    if (event.target === overlay || event.target.closest("[data-close-history]")) closeHistoryMatch();
  });
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
  const upcoming = leagueOnly ? upcomingBroadcasts : [];
  const matches = broadcasts.length
    ? broadcasts.map((broadcast) => `<button class="broadcast-card" data-watch-room="${escapeHtml(broadcast.code)}"><span><i>LIVE</i><small>${broadcast.minute}' · ${weatherIcon(broadcast.weather)} ${escapeHtml(broadcast.weather?.name ?? "比赛中")}</small></span><div><b>${escapeHtml(broadcast.teams[0].name)}</b><strong>${broadcast.score[0]} : ${broadcast.score[1]}</strong><b>${escapeHtml(broadcast.teams[1].name)}</b></div><em>${broadcast.spectatorCount} 人正在观看 · 进入直播 ›</em></button>`).join("")
    : upcoming.length
      ? `<div class="broadcast-upcoming-list"><header><b>下一轮直播预告</b><small>${upcoming.length} 场待播</small></header>${upcoming.map((fixture) => `<article class="broadcast-upcoming"><time><b>${yellowDogsTvTime(fixture.startsAt, false)}</b><small>${yellowDogsTvTime(fixture.startsAt)}</small></time><div><small>${escapeHtml(fixture.competitionName)} · ${escapeHtml(fixture.label ?? "下一轮")}</small><strong>${escapeHtml(fixture.homeName)} <i>vs</i> ${escapeHtml(fixture.awayName)}</strong></div></article>`).join("")}</div>`
      : `<p class="broadcast-empty">当前没有正在进行的公开比赛，也没有已确定的下一场赛事。</p>`;
  return `<section class="broadcast-hub ${leagueOnly ? "league-television" : ""}"><header><div><small>${leagueOnly ? "YDL TELEVISION" : "FT1 TELEVISION"}</small><h2>${leagueOnly ? "黄狗联赛电视台" : "比赛电视台"}</h2></div><b>${broadcasts.length} 场直播</b></header><div class="broadcast-list">${matches}</div></section>`;
}

function matchTacticalFitPercent(team) {
  const tacticalFit = Number(team?.tacticalFit);
  if (Number.isFinite(tacticalFit) && tacticalFit > 0) return Math.round(tacticalFit);
  return Math.round(Number(team?.styleFit ?? 0) * 100);
}

async function refreshBroadcasts() {
  if (spectatorSession) return;
  try {
    const value = await api("/api/versus/broadcasts");
    liveBroadcasts = value.broadcasts ?? [];
    upcomingBroadcasts = value.upcomingBroadcasts ?? [];
    const hub = document.querySelector(".broadcast-hub");
    if (hub) hub.outerHTML = broadcastListMarkup(leagueMode && leagueTab === "television");
    if (leagueMode) syncLeagueShellChrome();
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
  const strategy = `${TACTICS[team.tactic]} · ${STYLES[team.style]} · 主攻${FOCUSES[team.attackFocus]} · 主守${FOCUSES[team.defenseFocus]} · 适配 ${matchTacticalFitPercent(team)}%`;
  return `<section class="live-team-panel broadcast-team-panel"><header><div><h2>${escapeHtml(team.name)}${team.importedLineup ? `<span class="lineup-origin-badge">自带阵容</span>` : ""}</h2><small>${escapeHtml(team.formation)} · ${team.activeCount} 人</small></div><span class="broadcast-strategy">${escapeHtml(strategy)}</span></header>${broadcastPitchMarkup(team)}<footer>${escapeHtml(strategy)}</footer></section>`;
}

function broadcastCombinedPosition(position = { x:50, y:50 }, teamIndex = 0) {
  const x = Math.max(4, Math.min(96, Number(position?.x ?? 50)));
  const y = Math.max(4, Math.min(96, Number(position?.y ?? 50)));
  return teamIndex === 0
    ? { x, y:50 + y * .5 }
    : { x:100 - x, y:50 - y * .5 };
}

function broadcastCombinedPitchMarkup(teams) {
  const magnets = teams.flatMap((team, teamIndex) => team.players
    .filter((player) => player.active || player.sentOff || player.injury)
    .map((player) => broadcastMagnet({
      ...player,
      position:broadcastCombinedPosition(player.position, teamIndex),
      broadcastTeamIndex:teamIndex,
    })))
    .join("");
  const labels = `<span class="broadcast-v2-half-label away">${escapeHtml(teams[1].name)} · ${escapeHtml(teams[1].formation)}</span><span class="broadcast-v2-half-label home">${escapeHtml(teams[0].name)} · ${escapeHtml(teams[0].formation)}</span>`;
  return pitchMarkup(`${labels}${magnets}`, "", "broadcast-v2-pitch broadcast-pitch s4-readonly-pitch");
}

function broadcastVenueProfile(match) {
  const source = (match.stadium && typeof match.stadium === "object")
    ? match.stadium
    : (match.venue && typeof match.venue === "object") ? match.venue : {};
  const fallbackName = typeof match.venue === "string" && match.venue.trim() ? match.venue : `${match.teams[0].name} 主场`;
  return {
    name:String(source.name ?? fallbackName),
    standStyle:String(source.standStyle ?? "none"),
    backgroundEffect:String(source.backgroundEffect ?? "none"),
    pitchStyle:String(source.pitchStyle ?? "striped"),
    sponsors:Array.isArray(source.sponsors) ? source.sponsors : [],
  };
}

function broadcastSponsorBoardsMarkup(venue) {
  if (!venue.sponsors.length) return "";
  const boards = venue.sponsors.slice(0, 3).map((sponsor, index) => `<div class="broadcast-v2-sponsor-board sponsor-slot-${index + 1}"><span>${sponsor.icon ? `<img src="${escapeHtml(sponsor.icon)}" alt="${escapeHtml(sponsor.name)}">` : ""}</span></div>`).join("");
  return `<div class="broadcast-v2-ad-layout sponsor-stack" aria-label="普通赞助商广告">${boards}</div>`;
}
function broadcastMeteorParticlesMarkup() {
  return Array.from({ length:48 }, (_, index) => {
    const startX = (index * 47) % 138 - 18;
    const startY = (index * 31) % 130 - 24;
    const delay = -((index * 37) % 100) / 10;
    const duration = 3.4 + (index % 7) * .42;
    const length = 46 + (index % 6) * 12;
    return `<i style="--meteor-x:${startX}%;--meteor-y:${startY}%;--meteor-delay:${delay}s;--meteor-duration:${duration}s;--meteor-length:${length}px;--meteor-opacity:${.24 + index % 5 * .1}"></i>`;
  }).join("");
}

function ensureBroadcastMeteorBackground(overlay, match) {
  const enabled = broadcastVenueProfile(match).backgroundEffect === "meteor";
  let layer = overlay.querySelector(":scope > .broadcast-v2-meteor-background");
  if (!enabled) {
    layer?.remove();
    return;
  }
  if (layer) return;
  layer = document.createElement("div");
  layer.className = "broadcast-v2-meteor-background";
  layer.setAttribute("aria-hidden", "true");
  layer.innerHTML = broadcastMeteorParticlesMarkup();
  overlay.prepend(layer);
}
function broadcastV2MatchLayoutMarkup(match, broadcast) {
  const latestEvent = match.events.at(-1);
  const latestIcon = latestEvent ? ({ goal:"⚽",butterFingers:"🧤",ownGoal:"↩",superWorldie:"★",yellow:"■",red:"■",injury:"✚",lightning:"ϟ",weather:"≈",penaltyAwarded:"P",shootout:"P",tactical:"↔" }[latestEvent.type] ?? "•") : "";
  const venue = broadcastVenueProfile(match);
  const sponsorAds = broadcastSponsorBoardsMarkup(venue);
  const strategies = match.teams.map((team) => `${TACTICS[team.tactic] ?? team.tactic} · ${STYLES[team.style] ?? team.style} · ${team.formation} · 适配 ${matchTacticalFitPercent(team)}%`);
  const eventFeed = match.events.length ? [...match.events].reverse().map(matchEventMarkup).join("") : `<p class="feed-empty">比赛进行中</p>`;
  return `<div class="broadcast-v2-layout"><section class="broadcast-v2-field-column stand-${escapeHtml(venue.standStyle)}"><header class="broadcast-v2-venue-head"><div><small>HOME STADIUM</small><h2>${escapeHtml(venue.name)}</h2></div><span>${weatherIcon(match.weather)} ${escapeHtml(match.weather?.name ?? "比赛天气")} · ${broadcast.live ? "实时比赛阵型" : "最终比赛阵型"}</span></header><div class="broadcast-v2-stadium pitch-${escapeHtml(venue.pitchStyle)}">${sponsorAds}${broadcastCombinedPitchMarkup(match.teams)}</div><footer class="broadcast-v2-team-strategies"><div><i></i><span><b>${escapeHtml(match.teams[0].name)}</b><small>${escapeHtml(strategies[0])}</small></span></div><div><i></i><span><b>${escapeHtml(match.teams[1].name)}</b><small>${escapeHtml(strategies[1])}</small></span></div></footer></section><aside class="broadcast-v2-sidebar"><section class="commentary-panel match-center-panel broadcast-v2-commentary"><header><h2>${broadcast.live ? "实时战况" : "比赛详情"}</h2><span>${match.events.length}</span></header>${latestEvent ? `<div class="latest-event event-${latestEvent.type}"><i>${latestIcon}</i><b>${latestEvent.minute}'</b><span>${escapeHtml(latestEvent.text)}</span></div>` : ""}<div class="event-feed">${eventFeed}</div></section><section class="broadcast-v2-data-panel"><header><div><small>MATCH DATA</small><h2>比赛数据</h2></div><span>${escapeHtml(match.teams[0].name)} / ${escapeHtml(match.teams[1].name)}</span></header>${matchStatsMarkup(match)}</section></aside></div>`;
}


function dockBroadcastTeamStrategies(root) {
  const source = root?.querySelector?.(".broadcast-v2-field-column>.broadcast-v2-team-strategies");
  const heading = root?.querySelector?.(".broadcast-v2-commentary>header>h2");
  if (!source || !heading) return;
  const dock = document.createElement("div");
  dock.className = source.className;
  dock.innerHTML = source.innerHTML;
  heading.after(dock);
  source.remove();
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
  const latestIcon = latestEvent ? ({ goal:"⚽",butterFingers:"🧤",ownGoal:"↩",superWorldie:"★",yellow:"■",red:"■",injury:"✚",lightning:"ϟ",weather:"≈",penaltyAwarded:"P",shootout:"P",tactical:"↔" }[latestEvent.type] ?? "•") : "";
  const centerValue = match.segment === "penalties" ? `${match.penalties?.score?.[0] ?? 0}:${match.penalties?.score?.[1] ?? 0}` : `${match.minute}'`;
  const viewerNames = broadcast.spectators.length ? broadcast.spectators.map((viewer) => escapeHtml(viewer.name)).join("、") : "暂无其他观众";
  const toolbarTitle = broadcast.aiTraining ? "AI 战术训练赛" : "FT1 比赛电视台";
  const toolbarMeta = broadcast.aiTraining
    ? `${escapeHtml(broadcast.aiTrainingConfig?.formation ?? "AI")} · AI 均值 ${escapeHtml(broadcast.aiTrainingConfig?.actualAverageOverall ?? "-")}`
    : `房间 ${escapeHtml(broadcast.code)} · 第 ${broadcast.round} 轮`;
  return `<section class="broadcast-screen ${broadcast.aiTraining ? "ai-training-broadcast" : ""}"><header class="broadcast-toolbar"><button class="button secondary" data-leave-broadcast>${broadcast.aiTraining ? "结束 AI 对战" : broadcast.live ? "退出观赛" : "关闭详情"}</button><div><i>${broadcast.live ? "LIVE" : "FT"}</i><b>${toolbarTitle}</b><small>${toolbarMeta}</small></div><span><b>${broadcast.aiTraining ? "不计正式消耗" : `${broadcast.spectators.length} 人观看`}</b><small>${broadcast.aiTraining ? "不记录体力、伤停与纪律" : viewerNames}</small></span></header>${broadcast.live ? "" : `<div class="broadcast-ended">${broadcast.aiTraining ? "训练赛已经结束，可查看最终赛况或关闭对战。" : "比赛已经结束，正在显示最终比赛详情。"}</div>`}<section class="match-shell broadcast-match-shell"><header class="scoreboard"><div><small>${escapeHtml(match.teams[0].name)}</small><b>${match.score[0]}</b><em>${match.teams[0].activeCount} 人 · ${escapeHtml(match.teams[0].formation)}</em></div><span><small>${broadcast.live ? matchPhaseLabel(match) : "比赛结束"}</small><strong>${centerValue}</strong><em>${weatherIcon(match.weather)} ${escapeHtml(match.weather.name)}</em></span><div><small>${escapeHtml(match.teams[1].name)}</small><b>${match.score[1]}</b><em>${match.teams[1].activeCount} 人 · ${escapeHtml(match.teams[1].formation)}</em></div></header><div class="match-layout match-triple-layout">${broadcastTeamPanel(match.teams[0])}<section class="commentary-panel match-center-panel"><header><h2>${broadcast.live ? "实时战况" : "比赛详情"}</h2><span>${match.events.length}</span></header>${latestEvent ? `<div class="latest-event event-${latestEvent.type}"><i>${latestIcon}</i><b>${latestEvent.minute}'</b><span>${escapeHtml(latestEvent.text)}</span></div>` : ""}<div class="event-feed">${match.events.length ? [...match.events].reverse().map(matchEventMarkup).join("") : `<p class="feed-empty">比赛进行中</p>`}</div>${matchStatsMarkup(match)}</section>${broadcastTeamPanel(match.teams[1])}</div></section></section>`;
}

function renderBroadcast(broadcast) {
  let overlay = document.querySelector("#broadcast-overlay");
  if (!overlay) {
    document.body.insertAdjacentHTML("beforeend", `<div class="broadcast-overlay" id="broadcast-overlay"></div>`);
    overlay = document.querySelector("#broadcast-overlay");
  }
  overlay.classList.remove("broadcast-loading");
  let content = overlay.querySelector(":scope > .broadcast-v2-content");
  if (!content) {
    content = document.createElement("div");
    content.className = "broadcast-v2-content";
    overlay.replaceChildren(content);
  }
  ensureBroadcastMeteorBackground(overlay, broadcast.match);
  const fingerprint = JSON.stringify({
    code:broadcast.code,
    live:broadcast.live,
    minute:broadcast.match.minute,
    segment:broadcast.match.segment,
    score:broadcast.match.score,
    eventCount:broadcast.match.events.length,
    latestEventId:broadcast.match.events.at(-1)?.id ?? null,
    activeCounts:broadcast.match.teams.map((team) => team.activeCount),
    positions:broadcast.match.teams.map((team) => team.positions ?? null),
    spectators:broadcast.spectators.map((viewer) => viewer.name),
    backgroundEffect:broadcastVenueProfile(broadcast.match).backgroundEffect,
  });
  if (fingerprint === lastBroadcastRenderFingerprint && content.querySelector(".broadcast-screen")) return;
  lastBroadcastRenderFingerprint = fingerprint;
  const feedScroll = captureEventFeedScroll(content);
  content.innerHTML = broadcastScreenMarkup(broadcast);
  const legacyLayout = content.querySelector(".match-triple-layout");
  if (legacyLayout) legacyLayout.outerHTML = broadcastV2MatchLayoutMarkup(broadcast.match, broadcast);
  dockBroadcastTeamStrategies(content);
  restoreEventFeedScroll(content, feedScroll);
  const environment = content.querySelector(".scoreboard>span>em");
  if (environment && broadcast.match.referee) environment.textContent += ` · ⚖ ${refereeText(broadcast.match.referee)}`;
  content.querySelector("[data-leave-broadcast]").onclick = closeBroadcast;
}
async function startWatching(code) {
  if (spectatorJoinPending) return;
  const name = ownPlayer()?.name ?? document.querySelector("#player-name")?.value.trim() ?? account?.profile?.nickname ?? "匿名观众";
  spectatorJoinPending = true;
  spectatorPollingFailures = 0;
  lastBroadcastRenderFingerprint = null;
  document.querySelector("#broadcast-overlay")?.remove();
  document.body.insertAdjacentHTML("beforeend", `<div class="broadcast-overlay broadcast-loading" id="broadcast-overlay"><section><i>LIVE</i><h2>正在接入比赛直播…</h2><p>正在读取双方阵容与实时战况</p></section></div>`);
  try {
    const value = await api("/api/versus/watch", { method:"POST", body:{ code, name } });
    spectatorSession = { code, token:value.spectatorToken };
    renderBroadcast(value.broadcast);
    scheduleSpectatorPolling();
  } catch (error) {
    document.querySelector("#broadcast-overlay")?.remove();
    showToast(error.message);
  } finally {
    spectatorJoinPending = false;
  }
}

function scheduleSpectatorPolling(delay = 700) {
  clearTimeout(spectatorPolling);
  if (spectatorSession) spectatorPolling = setTimeout(refreshBroadcast, delay);
}

async function refreshBroadcast() {
  const active = spectatorSession;
  if (!active) return;
  try {
    const value = await api(`/api/versus/watch/${active.code}`, { token:active.token });
    if (spectatorSession !== active) return;
    spectatorPollingFailures = 0;
    renderBroadcast(value.broadcast);
    if (value.broadcast.live) scheduleSpectatorPolling(700);
    else clearTimeout(spectatorPolling);
  } catch (error) {
    if (spectatorSession !== active) return;
    spectatorPollingFailures += 1;
    if (spectatorSession && spectatorPollingFailures <= 5) {
      showToast(`直播连接波动，正在重连（${spectatorPollingFailures}/5）`);
      scheduleSpectatorPolling(Math.min(5_000, 700 * (2 ** spectatorPollingFailures)));
      return;
    }
    closeBroadcast(false);
    showToast(error.message);
  }
}

async function closeBroadcast(notifyServer = true) {
  const active = spectatorSession;
  spectatorSession = null;
  spectatorJoinPending = false;
  spectatorPollingFailures = 0;
  lastBroadcastRenderFingerprint = null;
  clearTimeout(spectatorPolling);
  document.querySelector("#broadcast-overlay")?.remove();
  if (notifyServer && active) {
    try {
      if (active.aiTraining) await api("/api/versus/league/ai-training/end", { method:"POST", body:leagueIdentity({ code:active.code }) });
      else await api(`/api/versus/watch/${active.code}/leave-watch`, { method:"POST", token:active.token });
    } catch { /* 心跳超时或训练会话过期时无需重复处理 */ }
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
  clearAppView();
  storeAccount(null);
  room = null;
  authMode = "login";
  if (offlineYdl) void renderOfflineTeamPicker();
  else renderAuth();
}

async function renderOfflineTeamPicker() {
  clearTimeout(polling);
  stopRoomStream();
  storeSession(null);
  clearAppView();
  leagueMode = false;
  yellowDogsTvMode = false;
  league = null;
  room = null;
  updateChrome();
  app.innerHTML = `<section class="offline-team-picker"><header><div><small>YDL S4 OFFLINE SANDBOX</small><h1>选择要接管的球队</h1><p>进入任意球队后，其他球队继续由本地 AI 管理。你可以随时返回这里切换身份。</p></div><a href="/admin/" target="_blank" rel="noopener">打开本地后台</a></header><p class="league-loading">正在读取停服联赛快照…</p></section>`;
  try {
    const catalog = await api("/api/offline/teams", { timeoutMs:10_000 });
    const cards = catalog.teams.map((team) => `<article><div><small>联赛排名</small><strong>${team.rank ?? "-"}</strong></div><section><small>${escapeHtml(team.ownerName ?? "本地球队")}</small><h2>${escapeHtml(team.name)}</h2><p>${team.played} 场 · ${team.points} 分 · ${team.rosterSize} 名球员</p><span>${escapeHtml(team.formation ?? "默认阵型")} · ${escapeHtml(TACTICS[team.tactic] ?? team.tactic)}</span></section><button type="button" data-offline-team="${escapeHtml(team.id)}">进入球队</button></article>`).join("");
    app.innerHTML = `<section class="offline-team-picker"><header><div><small>YDL S4 OFFLINE SANDBOX</small><h1>选择要接管的球队</h1><p>${escapeHtml(catalog.season.name)} 已完成 · 停服世界线已脱敏导入</p></div><a href="/admin/" target="_blank" rel="noopener">打开本地后台</a></header><div>${cards}</div><footer><b>本地沙盒权限</b><span>可进入任意球队、修改阵容与战术；未接管球队由 AI 继续参赛。</span></footer></section>`;
    app.querySelectorAll("[data-offline-team]").forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          const selected = await api("/api/offline/select-team", { method:"POST", body:{ teamId:button.dataset.offlineTeam } });
          storeAccount({ accountToken:selected.accountToken, profile:selected.profile });
          if (offlineYdl) localStorage.setItem(OFFLINE_SAVE_KEY, new URLSearchParams(window.location.search).get("save") || "default");
          leagueTab = "overview";
          await openLeague();
        } catch (error) {
          button.disabled = false;
          showToast(error.message);
        }
      };
    });
  } catch (error) {
    app.querySelector(".league-loading").textContent = `无法读取离线快照：${error.message}`;
  }
}

function renderLanding() {
  if (offlineYdl) {
    void renderOfflineTeamPicker();
    return;
  }
  clearTimeout(yellowDogsTvTimer);
  yellowDogsTvTimer = null;
  yellowDogsTvMode = false;
  yellowDogsTv = null;
  leagueMode = false;
  league = null;
  room = null;
  storeAppView("landing");
  updateChrome();
  const developerControls = publicHosting ? "" : `<div class="divider">开发者测试</div><div class="developer-actions"><button class="button secondary" id="dev-full-flow">单人完整流程</button><button class="button secondary" id="dev-quick-start">快速进入比赛</button></div>`;
  app.innerHTML = `<section class="landing"><div class="landing-copy"><h1>选出你的十一人，<span>决定比赛的方式。</span></h1>${profileMarkup()}</div><section class="room-console mode-console"><h2>${escapeHtml(account.profile.nickname)}</h2><p class="bound-player-id">玩家ID <b>${escapeHtml(account.profile.id)}</b></p><label class="field"><span>自定义分享码</span><input id="custom-room-code" maxlength="20" autocomplete="off" placeholder="快速比赛与锦标赛可选" /></label><div class="competition-create mode-selector"><button class="mode-button mode-league" id="open-league">黄狗联赛</button><button class="mode-button mode-tv" id="open-yellowdogs-tv">黄狗TV</button><button class="mode-button mode-quick" id="create-room">快速比赛</button><button class="mode-button mode-cup" id="create-tournament">锦标赛</button></div><div class="divider">加入已有好友房间</div><label class="field"><span>分享码</span><input id="room-code" maxlength="20" autocomplete="off" placeholder="输入分享码" /></label><button class="button secondary wide" id="join-room">加入房间</button>${developerControls}</section></section>`;
  document.querySelector(".landing-copy")?.insertAdjacentHTML("beforeend", broadcastListMarkup());
  refreshBroadcasts();
  document.querySelector("#create-room").onclick = () => createRoom("quick");
  document.querySelector("#create-tournament").onclick = () => createRoom("tournament");
  document.querySelector("#open-league").onclick = openLeague;
  document.querySelector("#open-yellowdogs-tv").onclick = openYellowDogsTv;
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

function yellowDogsTvTime(value, withDate = true) {
  const date = new Date(Number(value));
  const time = date.toLocaleTimeString("zh-CN", { hour:"2-digit", minute:"2-digit", hour12:false });
  return withDate ? `${date.toLocaleDateString("zh-CN", { month:"numeric", day:"numeric", weekday:"short" })} ${time}` : time;
}

function yellowDogsTvCountdown(value) {
  const minutes = Math.max(0, Math.ceil((Number(value) - Number(yellowDogsTv.serverTime ?? Date.now())) / 60000));
  if (minutes < 1) return "即将开始";
  if (minutes < 60) return `${minutes}分钟后`;
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分后`;
}

function yellowDogsTvScheduleMarkup() {
  const rows = yellowDogsTv.schedule.map((fixture) => {
    const complete = fixture.status === "complete";
    const live = fixture.status === "live";
    const result = complete ? `${fixture.score[0]} : ${fixture.score[1]}` : live ? "进行中" : yellowDogsTvCountdown(fixture.startsAt);
    const action = live && fixture.broadcastCode ? `<button type="button" class="button primary" data-watch-room="${escapeHtml(fixture.broadcastCode)}">观看直播</button>` : complete && fixture.matchId ? `<button type="button" class="button secondary" data-tv-history-match="${escapeHtml(fixture.matchId)}">比赛详情</button>` : "";
    return `<article class="ydtv-fixture ${escapeHtml(fixture.status)}"><time><small>${yellowDogsTvTime(fixture.startsAt)}</small><b>${yellowDogsTvTime(fixture.startsAt, false)}</b></time><div><small>${escapeHtml(fixture.competitionName)}</small><h3>${escapeHtml(fixture.opponentName)}</h3><span>${fixture.venue === "home" ? "主场" : "客场"} · ${escapeHtml(fixture.label)}</span></div><strong>${result}</strong><aside>${action}</aside></article>`;
  }).join("");
  return `<section class="ydtv-panel"><header><div><small>CLUB CALENDAR</small><h2>我的日程</h2></div><b>${yellowDogsTv.schedule.length} 场</b></header>${rows || `<p class="league-empty">当前没有已确定的球队赛程。</p>`}</section>`;
}

function yellowDogsTvHistoryMarkup() {
  const rows = yellowDogsTv.history.map((match) => {
    const ownHome = match.homeId === yellowDogsTv.team.id;
    const ownScore = match.score[ownHome ? 0 : 1];
    const opponentScore = match.score[ownHome ? 1 : 0];
    const result = ownScore > opponentScore ? "win" : ownScore < opponentScore ? "loss" : "draw";
    const opponent = ownHome ? match.awayName : match.homeName;
    const competition = match.competition === "cup" ? "冠军杯" : match.competition === "friendly" ? "友谊赛" : `联赛第${match.round}轮`;
    const content = `<time>${yellowDogsTvTime(match.playedAt)}</time><div><small>${competition} · ${ownHome ? "主场" : "客场"}</small><h3>${escapeHtml(opponent)}</h3><span>${match.hasDetails ? "点击查看完整比赛详情" : "旧比赛暂无详情"}</span></div><strong>${ownScore} : ${opponentScore}</strong>`;
    return match.hasDetails ? `<button type="button" class="ydtv-history ${result}" data-tv-history-match="${escapeHtml(match.id)}">${content}</button>` : `<article class="ydtv-history ${result} legacy">${content}</article>`;
  }).join("");
  return `<section class="ydtv-panel"><header><div><small>TEAM HISTORY</small><h2>历史战绩</h2></div><b>${yellowDogsTv.history.length} 场</b></header>${rows || `<p class="league-empty">你的球队还没有比赛记录。</p>`}</section>`;
}

function yellowDogsTvBroadcastMarkup() {
  const broadcasts = yellowDogsTv.broadcasts.filter((entry) => String(entry.code).startsWith("YDL-"));
  const cards = broadcasts.map((broadcast) => `<button type="button" class="ydtv-broadcast" data-watch-room="${escapeHtml(broadcast.code)}"><header><b>LIVE</b><small>${escapeHtml(broadcast.competition)} · ${broadcast.minute}'</small></header><div><span>${escapeHtml(broadcast.teams[0].name)}</span><strong>${broadcast.score[0]} : ${broadcast.score[1]}</strong><span>${escapeHtml(broadcast.teams[1].name)}</span></div><footer><span>${broadcast.spectatorCount} 人观看</span><b>进入直播 ›</b></footer></button>`).join("");
  return `<section class="ydtv-panel"><header><div><small>YELLOWDOGS TELEVISION</small><h2>电视台</h2></div><b>${broadcasts.length} 场直播</b></header><div class="ydtv-broadcast-grid">${cards || `<p class="league-empty">当前没有正在进行的联赛直播。</p>`}</div></section>`;
}

function renderYellowDogsTv() {
  yellowDogsTvMode = true;
  leagueMode = false;
  room = null;
  storeAppView("yellowDogsTv", { yellowDogsTvTab });
  updateChrome();
  if (!yellowDogsTv?.team) {
    app.innerHTML = `<section class="ydtv-shell"><header class="ydtv-hero"><button type="button" class="button secondary" data-tv-back>返回</button><div><small>YELLOWDOGS TV</small><h1>黄狗TV</h1></div></header><section class="ydtv-panel"><p class="league-empty">你还没有建立黄狗联赛球队，请先进入黄狗联赛完成建队。</p></section></section>`;
    return;
  }
  const content = yellowDogsTvTab === "history" ? yellowDogsTvHistoryMarkup() : yellowDogsTvTab === "television" ? yellowDogsTvBroadcastMarkup() : yellowDogsTvScheduleMarkup();
  app.innerHTML = `<section class="ydtv-shell"><header class="ydtv-hero"><button type="button" class="button secondary" data-tv-back>返回</button><div><small>${escapeHtml(yellowDogsTv.season.name)} · ROUND ${yellowDogsTv.season.currentRound}/${yellowDogsTv.season.totalRounds}</small><h1>黄狗TV</h1><p>${escapeHtml(yellowDogsTv.team.name)}</p></div><span>每 10 秒自动刷新</span></header><nav class="ydtv-tabs"><button data-tv-tab="schedule" class="${yellowDogsTvTab === "schedule" ? "active" : ""}">我的日程</button><button data-tv-tab="history" class="${yellowDogsTvTab === "history" ? "active" : ""}">历史战绩</button><button data-tv-tab="television" class="${yellowDogsTvTab === "television" ? "active" : ""}">电视台</button></nav>${content}</section>`;
}

async function refreshYellowDogsTv(silent = false) {
  clearTimeout(yellowDogsTvTimer);
  try {
    const value = await api("/api/versus/live", { method:"POST", body:leagueIdentity() });
    yellowDogsTv = value.live;
    const shell = silent && yellowDogsTvMode ? app.querySelector(".ydtv-shell") : null;
    if (shell && yellowDogsTv?.team) {
      const nextContent = yellowDogsTvTab === "history" ? yellowDogsTvHistoryMarkup() : yellowDogsTvTab === "television" ? yellowDogsTvBroadcastMarkup() : yellowDogsTvScheduleMarkup();
      shell.querySelector(".ydtv-panel")?.replaceWith(document.createRange().createContextualFragment(nextContent));
      const seasonLabel = shell.querySelector(".ydtv-hero small");
      if (seasonLabel) seasonLabel.textContent = `${yellowDogsTv.season.name} · ROUND ${yellowDogsTv.season.currentRound}/${yellowDogsTv.season.totalRounds}`;
    } else {
      renderYellowDogsTv();
    }
  } catch (error) {
    if (!silent) showToast(error.message);
    if (!yellowDogsTv) return renderLanding();
  }
  if (yellowDogsTvMode) yellowDogsTvTimer = setTimeout(() => refreshYellowDogsTv(true), 10000);
}

function openYellowDogsTv() {
  yellowDogsTvMode = true;
  yellowDogsTv = null;
  room = null;
  storeSession(null);
  storeAppView("yellowDogsTv", { yellowDogsTvTab });
  updateChrome();
  app.innerHTML = `<section class="league-loading"><p class="eyebrow">YELLOWDOGS TV</p><h1>正在读取比赛中心…</h1></section>`;
  refreshYellowDogsTv();
}

function applyLeagueMutationDeltas(nextLeague) {
  if (Object.hasOwn(nextLeague, "teamBadgeDelta") && league.ownTeam) {
    league.ownTeam.equippedBadge = nextLeague.teamBadgeDelta;
    const standingTeam = league.teams?.find((team) => team.id === league.ownTeam.id);
    if (standingTeam) standingTeam.equippedBadge = nextLeague.teamBadgeDelta;
  }
  if (Object.hasOwn(nextLeague, "clubBadgeDelta") && league.ownTeam) {
    league.ownTeam.equippedClubBadge = nextLeague.clubBadgeDelta;
    const standingTeam = league.teams?.find((team) => team.id === league.ownTeam.id);
    if (standingTeam) standingTeam.equippedClubBadge = nextLeague.clubBadgeDelta;
  }
  const removedCardIds = new Set((nextLeague.removedS4CardIds ?? []).map(String));
  if (removedCardIds.size && league.ownTeam) {
    league.ownTeam.roster.forEach((player) => {
      player.cards = (player.cards ?? []).filter((card) => !removedCardIds.has(String(card.id)));
    });
    if (league.ownTeam.s4Assets) {
      league.ownTeam.s4Assets.cards = (league.ownTeam.s4Assets.cards ?? []).filter((card) => !removedCardIds.has(String(card.id)));
    }
  }
  const returnedOwnershipPlayerIds = new Set((nextLeague.returnedS4OwnershipPlayerIds ?? []).map(String));
  if (returnedOwnershipPlayerIds.size && league.ownTeam) {
    league.ownTeam.roster.forEach((player) => {
      if (returnedOwnershipPlayerIds.has(String(player.id))) player.ownsRights = false;
    });
    if (league.ownTeam.s4Assets) {
      league.ownTeam.s4Assets.ownershipPlayerIds = (league.ownTeam.s4Assets.ownershipPlayerIds ?? [])
        .filter((playerId) => !returnedOwnershipPlayerIds.has(String(playerId)));
    }
  }
  const removedPlayerIds = new Set((nextLeague.removedS4PlayerIds ?? []).map(String));
  if (removedPlayerIds.size && league.ownTeam) {
    league.ownTeam.roster = league.ownTeam.roster.filter((player) => !removedPlayerIds.has(String(player.id)));
  }
  if (Array.isArray(nextLeague.s4CardDeltas) && league.ownTeam) {
    const resultPlayers = [nextLeague.packOpening, nextLeague.marketPurchase, ...(nextLeague.packBatchOpening?.results ?? [])]
      .filter((result) => result?.player)
      .reduce((map, result) => map.set(result.player.id, result.player), new Map());
    nextLeague.s4CardDeltas.forEach((delta) => {
      let player = league.ownTeam.roster.find((entry) => entry.id === delta.playerId);
      if (!player) {
        const summary = resultPlayers.get(delta.playerId);
        if (!summary) return;
        player = {
          ...summary,
          cards:[],
          ownsRights:Boolean(delta.ownershipGranted),
          activeCardId:null,
          upgradeLevel:0,
          baseOverall:summary.overall,
          effectiveOverall:summary.overall,
          effectiveAttributes:summary.attributes ?? {},
          state:{ fitness:100, suspension:0, cupSuspension:0, injuryRounds:0 },
        };
        league.ownTeam.roster.push(player);
        if (!summary.legendary && !summary.xPlayer) {
          league.ownTeam.s4Assets ??= { rosterLimit:33, rosterSlotsUsed:league.ownTeam.roster.length, ownershipPlayerIds:[], cards:[] };
          league.ownTeam.s4Assets.rosterSlotsUsed = Number(league.ownTeam.s4Assets.rosterSlotsUsed ?? 0) + 1;
        }
      }
      player.cards ??= [];
      if (!player.cards.some((card) => card.id === delta.card.id)) player.cards.push(delta.card);
      if (!player.activeCardId || Number(delta.card.upgradeLevel ?? 0) > Number(player.upgradeLevel ?? 0)) {
        player.activeCardId = delta.card.id;
        player.upgradeLevel = Number(delta.card.upgradeLevel ?? 0);
        player.effectiveOverall = delta.card.effectiveOverall ?? player.overall;
      }
      if (delta.ownershipGranted) player.ownsRights = true;
      if (league.ownTeam.s4Assets) {
        league.ownTeam.s4Assets.cards ??= [];
        if (!league.ownTeam.s4Assets.cards.some((card) => card.id === delta.card.id)) league.ownTeam.s4Assets.cards.push(delta.card);
        if (delta.ownershipGranted) {
          league.ownTeam.s4Assets.ownershipPlayerIds ??= [];
          if (!league.ownTeam.s4Assets.ownershipPlayerIds.includes(delta.playerId)) league.ownTeam.s4Assets.ownershipPlayerIds.push(delta.playerId);
        }
      }
    });
  }
  if (Array.isArray(nextLeague.s4PlayerDeltas) && league.ownTeam) {
    nextLeague.s4PlayerDeltas.filter(Boolean).forEach((delta) => {
      const player = league.ownTeam.roster.find((entry) => entry.id === delta.playerId);
      if (!player) return;
      const { playerId, ...assetState } = delta;
      void playerId;
      Object.assign(player, assetState);
    });
  }
  if (Number.isFinite(Number(nextLeague.s4RosterSlotsUsed)) && league.ownTeam?.s4Assets) {
    league.ownTeam.s4Assets.rosterSlotsUsed = Number(nextLeague.s4RosterSlotsUsed);
  }
  if (nextLeague.s4RosterDelta && league.ownTeam) {
    const rosterState = nextLeague.s4RosterDelta;
    const rosterPlayerIds = new Set((rosterState.rosterPlayerIds ?? []).map(String));
    const starterIds = new Set((rosterState.starterIds ?? []).map(String));
    league.ownTeam.roster = league.ownTeam.roster.filter((player) => rosterPlayerIds.has(String(player.id)));
    league.ownTeam.roster.forEach((player) => { player.starter = starterIds.has(String(player.id)); });
    ["positions", "positionPresets", "formationLinePresets", "activeLineupSchemeId", "lineupSchemes", "lineupSchemeAssignments", "chemistryLinks", "formation"].forEach((key) => {
      if (Object.hasOwn(rosterState, key)) league.ownTeam[key] = rosterState[key];
    });
  }
  if (nextLeague.listing) {
    league.listings = [...(league.listings ?? []).filter((item) => item.id !== nextLeague.listing.id), nextLeague.listing];
  }
  const removedListingId = nextLeague.cancelledListingId ?? nextLeague.marketPurchase?.listingId;
  if (removedListingId) league.listings = (league.listings ?? []).filter((item) => item.id !== removedListingId);
}

async function leagueRequest(path, body = {}, options = {}) {
  leagueMutationPending = true;
  try {
    const value = await api(`/api/versus/league${path}`, { method:"POST", body:leagueIdentity(body) });
    const nextLeague = value.league ?? {};
    if (nextLeague.compact) {
      const { packOpening:previousPackOpening, packBatchOpening:previousPackBatchOpening, s4CardDeltas:previousCardDeltas, s4PlayerDeltas:previousPlayerDeltas, s4RosterSlotsUsed:previousRosterSlotsUsed, removedS4CardIds:previousRemovedCardIds, removedS4PlayerIds:previousRemovedPlayerIds, returnedS4OwnershipPlayerIds:previousReturnedOwnershipPlayerIds, s4RosterDelta:previousRosterDelta, cardRecoveryResult:previousCardRecoveryResult, ownershipRecoveryResult:previousOwnershipRecoveryResult, listing:previousListing, cancelledListingId:previousCancelledListingId, marketPurchase:previousMarketPurchase, ...stableLeague } = league;
      void previousPackOpening;
      void previousPackBatchOpening;
      void previousCardDeltas;
      void previousPlayerDeltas;
      void previousRosterSlotsUsed;
      void previousRemovedCardIds;
      void previousRemovedPlayerIds;
      void previousReturnedOwnershipPlayerIds;
      void previousRosterDelta;
      void previousCardRecoveryResult;
      void previousOwnershipRecoveryResult;
      void previousListing;
      void previousCancelledListingId;
      void previousMarketPurchase;
      league = { ...stableLeague, ...nextLeague };
      applyLeagueMutationDeltas(nextLeague);
    } else league = leagueWithCachedLazyViews(nextLeague);
    leagueEditorDirty = false;
    options.beforeRender?.(league);
    if (options.render !== false) renderLeague();
    return league;
  } finally {
    leagueMutationPending = false;
  }
}

async function leagueFriendlyInviteRequest(targetTeamId) {
  if (leagueMutationPending) return null;
  leagueMutationPending = true;
  try {
    const value = await api("/api/versus/league/friendlies/invite", { method:"POST", body:leagueIdentity({ targetTeamId }) });
    const invitation = value.invitation;
    league = { ...league, updatedAt:invitation.updatedAt, serverTime:invitation.serverTime, friendlyInvitations:invitation.friendlyInvitations, inboxUnreadCount:invitation.inboxUnreadCount };
    return invitation;
  } finally {
    leagueMutationPending = false;
  }
}

async function leagueFriendlyRespondRequest(invitationId, action) {
  if (leagueMutationPending) return null;
  leagueMutationPending = true;
  try {
    const value = await api("/api/versus/league/friendlies/respond", { method:"POST", body:leagueIdentity({ invitationId, action }) });
    const receipt = value.league;
    league = {
      ...league,
      updatedAt:receipt.updatedAt,
      serverTime:receipt.serverTime,
      friendlyInvitations:receipt.friendlyInvitations,
      inbox:receipt.inbox ?? league.inbox,
      inboxUnreadCount:receipt.inboxUnreadCount,
      schedule:receipt.schedule ? { ...league.schedule, ...receipt.schedule } : league.schedule,
    };
    leagueInboxMessageId = null;
    updateLeagueTopbarClub();
    const currentInbox = app.querySelector(".league-inbox");
    if (leagueTab === "inbox" && currentInbox) currentInbox.outerHTML = leagueInboxMarkup();
    else if (leagueTab === "inbox") renderLeague();
    return receipt;
  } finally {
    leagueMutationPending = false;
  }
}

async function leagueInboxReadRequest(messageId) {
  const message = league?.inbox?.find((entry) => entry.id === messageId);
  if (!message || message.readAt) return;
  const previousUnreadCount = Number(league.inboxUnreadCount ?? 0);
  const optimisticReadAt = Date.now();
  message.readAt = optimisticReadAt;
  league.inboxUnreadCount = Math.max(0, previousUnreadCount - 1);
  refreshLeagueInboxInPlace();
  requestAnimationFrame(() => document.querySelector(".league-mail-reader")?.scrollIntoView({ behavior:"smooth", block:"start" }));
  try {
    const value = await api("/api/versus/league/inbox/read", { method:"POST", body:leagueIdentity({ messageId }) });
    const receipt = value.inboxRead;
    league = { ...league, updatedAt:receipt.updatedAt, serverTime:receipt.serverTime };
    const current = league.inbox.find((entry) => entry.id === receipt.messageId);
    if (current) current.readAt = receipt.readAt;
    league.inboxUnreadCount = league.inbox.filter((entry) => !entry.readAt).length;
    updateLeagueTopbarClub();
  } catch (error) {
    const current = league?.inbox?.find((entry) => entry.id === messageId);
    if (current?.readAt === optimisticReadAt) current.readAt = null;
    league.inboxUnreadCount = previousUnreadCount;
    if (leagueMode && leagueTab === "inbox") refreshLeagueInboxInPlace();
    showToast(error.message);
  }
}

async function leagueInboxReadBatchRequest(messageIds) {
  const ids = new Set(messageIds.filter(Boolean));
  const targets = (league?.inbox ?? []).filter((message) => ids.has(message.id) && !message.readAt);
  if (!targets.length) return;
  const previousUnreadCount = Number(league.inboxUnreadCount ?? 0);
  const previousReadAt = new Map(targets.map((message) => [message.id, message.readAt]));
  const optimisticReadAt = Date.now();
  targets.forEach((message) => { message.readAt = optimisticReadAt; });
  league.inboxUnreadCount = Math.max(0, previousUnreadCount - targets.length);
  leagueInboxMessageId = null;
  refreshLeagueInboxInPlace();
  try {
    const value = await api("/api/versus/league/inbox/read-batch", { method:"POST", body:leagueIdentity({ messageIds:targets.map((message) => message.id) }) });
    const receipt = value.inboxReadBatch;
    league = { ...league, updatedAt:receipt.updatedAt, serverTime:receipt.serverTime };
    const readIds = new Set(receipt.messageIds ?? []);
    league.inbox.forEach((message) => { if (readIds.has(message.id)) message.readAt = receipt.readAt; });
    league.inboxUnreadCount = receipt.inboxUnreadCount;
    updateLeagueTopbarClub();
    syncLeagueShellChrome();
  } catch (error) {
    targets.forEach((message) => { if (message.readAt === optimisticReadAt) message.readAt = previousReadAt.get(message.id) ?? null; });
    league.inboxUnreadCount = previousUnreadCount;
    refreshLeagueInboxInPlace();
    showToast(error.message);
  }
}

async function leagueDraftRequest(path, body = {}) {
  if (leagueMutationPending) return league?.draft ?? null;
  leagueMutationPending = true;
  renderLeague();
  try {
    const value = await api(`/api/versus/league${path}`, { method:"POST", body:leagueIdentity(body) });
    league = { ...league, updatedAt:value.updatedAt ?? league.updatedAt, serverTime:value.serverTime ?? league.serverTime, draft:value.draft };
    leagueEditorDirty = false;
    return value.draft;
  } finally {
    leagueMutationPending = false;
    if (leagueMode && league?.draft) renderLeague();
  }
}

async function leagueXGrowthRequest(path, body = {}) {
  if (leagueXGrowthMutationPending) return null;
  leagueXGrowthMutationPending = true;
  leagueMutationPending = true;
  syncLeagueXGrowthPendingUi();
  try {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `x-growth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let value;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        value = await api(`/api/versus/league/x-growth${path}`, { method:"POST", body:leagueIdentity({ ...body, requestId }) });
        break;
      } catch (error) {
        if (attempt > 0 || !(error instanceof TypeError)) throw error;
      }
    }
    const growth = value.growth;
    league = { ...league, updatedAt:growth.updatedAt, serverTime:growth.serverTime, wallet:growth.wallet, xGrowth:growth.xGrowth };
    return growth;
  } finally {
    leagueXGrowthMutationPending = false;
    syncLeagueXGrowthMutationUi(path, body.field);
    leagueXGrowthPendingField = null;
    leagueXGrowthPendingAmount = null;
    leagueXGrowthPendingMode = null;
    leagueMutationPending = false;
  }
}

function activeTacticsTeam() {
  return league.ownTeam;
}

function storeLeagueTacticsContext(mode = leagueTacticsMode) {
  if (!leagueStartingIds) return;
  captureLeagueTacticalControls();
  if (leaguePositionPresets && leaguePositions) leaguePositionPresets[leagueActivePositionPreset] = leaguePositions;
  leagueTacticsContexts[mode] = {
    startingIds:[...leagueStartingIds],
    positions:leaguePositions,
    positionPresets:leaguePositionPresets,
    formationLinePresets:leagueFormationLinePresets,
    activePositionPreset:leagueActivePositionPreset,
    tacticalDraft:leagueTacticalDraft,
    mobilePlanState:leagueMobileTacticalPlanState,
  };
}

function restoreLeagueTacticsContext(mode) {
  const context = leagueTacticsContexts[mode];
  leagueStartingIds = context?.startingIds ? [...context.startingIds] : null;
  leaguePositions = context?.positions ?? null;
  leaguePositionPresets = context?.positionPresets ?? null;
  leagueFormationLinePresets = context?.formationLinePresets ?? null;
  leagueActivePositionPreset = context?.activePositionPreset ?? "position1";
  leagueTacticalDraft = context?.tacticalDraft ?? null;
  leagueMobileTacticalPlanState = context?.mobilePlanState ?? "opening";
}

function normalizeLeagueFitnessThreshold(value, fallback = 65) {
  const text = String(value ?? "").trim();
  const numeric = text ? Number(text) : Number.NaN;
  const safeFallback = Math.max(45, Math.min(100, Math.round(Number(fallback) || 65)));
  return Number.isFinite(numeric)
    ? Math.max(45, Math.min(100, Math.round(numeric)))
    : safeFallback;
}

function ensureLeagueTacticalDraft() {
  if (leagueTacticalDraft) return leagueTacticalDraft;
  const team = activeTacticsTeam();
  const plans = team.tacticalPlans ?? {};
  leagueTacticalDraft = {
    fitnessThreshold:normalizeLeagueFitnessThreshold(team.fitnessThreshold, 65),
    captainId:team.captainId ?? null,
    captainStyle:normalizeCaptainStyle(team.captainStyle ?? DEFAULT_CAPTAIN_STYLE),
    attackFocus:team.attackFocus ?? "balanced",
    defenseFocus:team.defenseFocus ?? "balanced",
    tacticalPlans:{
      opening:leagueTacticalPlanDraft(plans.opening, { tactic:team.tactic, style:team.style, positionPreset:"position1" }),
      leading:leagueTacticalPlanDraft(plans.leading, { tactic:"defensive", style:"counterAttack", positionPreset:"position2", triggerGoalDifference:1 }),
      trailing:leagueTacticalPlanDraft(plans.trailing, { tactic:"positive", style:"possession", positionPreset:"position3", triggerGoalDifference:1 }),
    },
  };
  const legacyAttackFocus = leagueTacticalDraft.attackFocus;
  const legacyDefenseFocus = leagueTacticalDraft.defenseFocus;
  Object.values(leagueTacticalDraft.tacticalPlans).forEach((plan) => {
    if (plan.inPossessionDetails.attackDirection === "balanced" && legacyAttackFocus !== "balanced") plan.inPossessionDetails.attackDirection = legacyAttackFocus;
    if (plan.outOfPossessionDetails.defenseDirection === "balanced" && legacyDefenseFocus !== "balanced") plan.outOfPossessionDetails.defenseDirection = legacyDefenseFocus;
  });
  leagueTacticalDraft.attackFocus = "balanced";
  leagueTacticalDraft.defenseFocus = "balanced";
  return leagueTacticalDraft;
}

function defaultV2TacticalDimensions(tactic = "balanced", style = "possession") {
  const preset = V2_TACTICAL_PRESETS[tactic] ?? V2_TACTICAL_PRESETS.balanced;
  const adjustment = V2_STYLE_DIMENSION_ADJUSTMENTS[style] ?? {};
  return Object.fromEntries(Object.keys(V2_TACTICAL_DIMENSIONS).map((key) => [key, Math.max(0, Math.min(100, Math.round(Number(preset[key] ?? 50) + Number(adjustment[key] ?? 0))))]));
}

function migrateLegacyDetailDimensions(dimensions, plan = {}) {
  const migrated = { ...dimensions };
  const legacyAdjustments = {
    tempo:{ patient:-18, cautious:-9, balanced:0, quick:11, extreme:22 }[plan.inPossessionDetails?.tempo] ?? 0,
    directness:{ short:-24, shorter:-12, balanced:0, longer:13, direct:26 }[plan.inPossessionDetails?.directness] ?? 0,
    pressing:{ retreat:-24, low:-12, standard:0, high:14, relentless:27 }[plan.outOfPossessionDetails?.pressing] ?? 0,
    compactness:{ loose:-16, balanced:0, tight:18 }[plan.outOfPossessionDetails?.compactness] ?? 0,
  };
  Object.entries(legacyAdjustments).forEach(([key, adjustment]) => {
    if (adjustment) migrated[key] = Math.max(0, Math.min(100, Math.round(Number(migrated[key] ?? 50) + adjustment)));
  });
  return migrated;
}

function originalV2StyleForPlan(plan = {}, fallbackStyle = "possession") {
  const hasSplitSelection = ["possessionStyle", "defensiveBlock", "transitionStyle", "duelIntensity"].some((key) => Object.hasOwn(plan, key));
  if (hasSplitSelection) {
    if (plan.duelIntensity === "roughPlay") return "roughPlay";
    if (plan.defensiveBlock === "highPress") return "highPress";
    if (plan.defensiveBlock === "lowBlock") return "lowBlock";
    if (plan.transitionStyle === "counterAttack") return "counterAttack";
    if (plan.possessionStyle === "longBall" || plan.possessionStyle === "vertical") return "longBall";
    if (plan.possessionStyle === "wingPlay") return "wingPlay";
    if (plan.possessionStyle === "possession") return "possession";
  }
  if (Object.hasOwn(STYLES, plan.style)) return plan.style;
  return Object.hasOwn(STYLES, fallbackStyle) ? fallbackStyle : "possession";
}

function syncLeagueTacticalPresetControls(control) {
  const match = String(control?.name ?? "").match(/^(opening|leading|trailing)(Tactic|Style)$/);
  const form = control?.closest?.("#league-squad-form");
  if (!match || !form) return false;
  const state = match[1];
  const draft = captureLeagueTacticalControls();
  const tactic = form.elements.namedItem(`${state}Tactic`)?.value ?? draft.tacticalPlans[state].tactic;
  const style = form.elements.namedItem(`${state}Style`)?.value ?? draft.tacticalPlans[state].style;
  const tacticalDimensions = defaultV2TacticalDimensions(tactic, style);
  draft.tacticalPlans[state] = { ...draft.tacticalPlans[state], tactic, style, tacticalDimensions };
  Object.entries(tacticalDimensions).forEach(([key, value]) => {
    const name = `${state}Dimension_${key}`;
    const input = form.elements.namedItem(name);
    if (input) input.value = String(value);
    const output = form.querySelector(`[data-tactical-dimension-output="${name}"]`);
    if (output) output.value = String(value);
  });
  return true;
}

function syncLeagueTacticalDimensionControl(control) {
  const match = String(control?.name ?? "").match(/^(opening|leading|trailing)Dimension_(tempo|directness|attackingWidth|defensiveLine|pressing|compactness|counterAttack|timeWasting)$/);
  if (!match) return false;
  const [, state, key] = match;
  const value = Math.max(0, Math.min(100, Math.round(Number(control.value ?? 50))));
  ensureLeagueTacticalDraft().tacticalPlans[state].tacticalDimensions[key] = value;
  const output = control.form?.querySelector(`[data-tactical-dimension-output="${control.name}"]`);
  if (output) output.value = String(value);
  return true;
}

function leagueTacticalPlanDraft(plan = {}, fallback) {
  const tactic = plan?.tactic ?? fallback.tactic;
  const style = originalV2StyleForPlan(plan, fallback.style);
  const defaults = defaultV2TacticalDimensions(tactic, style);
  const dimensions = migrateLegacyDetailDimensions({ ...defaults, ...(plan?.tacticalDimensions ?? {}) }, plan);
  return {
    tactic,
    style,
    positionPreset:plan?.positionPreset ?? fallback.positionPreset,
    ...(fallback.positionPreset === "position1" ? {} : { triggerGoalDifference:Math.max(1, Math.min(5, Math.round(Number(plan?.triggerGoalDifference ?? fallback.triggerGoalDifference) || 1))) }),
    inPossession:"balanced",
    outOfPossession:"balanced",
    inPossessionDetails:Object.fromEntries(Object.keys(IN_POSSESSION_DETAIL_OPTIONS).map((key) => [key, plan?.inPossessionDetails?.[key] ?? DEFAULT_IN_POSSESSION_DETAILS[key]])),
    outOfPossessionDetails:Object.fromEntries(Object.keys(OUT_OF_POSSESSION_DETAIL_OPTIONS).map((key) => [key, plan?.outOfPossessionDetails?.[key] ?? DEFAULT_OUT_OF_POSSESSION_DETAILS[key]])),
    tacticalDimensions:dimensions,
    playerDuties:structuredClone(plan?.playerDuties ?? {}),
  };
}

function captureLeagueTacticalControls() {
  const form = document.querySelector("#league-squad-form");
  const draft = ensureLeagueTacticalDraft();
  if (!form) return draft;
  const data = new FormData(form);
  draft.fitnessThreshold = normalizeLeagueFitnessThreshold(data.get("fitnessThreshold"), draft.fitnessThreshold);
  draft.attackFocus = data.get("attackFocus") ?? draft.attackFocus;
  draft.captainId = String(data.get("captainId") ?? draft.captainId ?? "") || null;
  draft.captainStyle = normalizeCaptainStyle(data.get("captainStyle") ?? draft.captainStyle);
  draft.defenseFocus = data.get("defenseFocus") ?? draft.defenseFocus;
  ["opening", "leading", "trailing"].forEach((state) => {
    const tactic = data.get(`${state}Tactic`) ?? draft.tacticalPlans[state].tactic;
    const style = data.get(`${state}Style`) ?? draft.tacticalPlans[state].style;
    draft.tacticalPlans[state] = {
      tactic,
      style,
      positionPreset:state === "opening" ? "position1" : state === "leading" ? "position2" : "position3",
      ...(state === "opening" ? {} : { triggerGoalDifference:Math.max(1, Math.min(5, Math.round(Number(data.get(`${state}TriggerGoalDifference`) ?? draft.tacticalPlans[state].triggerGoalDifference) || 1))) }),
      inPossession:"balanced",
      outOfPossession:"balanced",
      inPossessionDetails:Object.fromEntries(Object.keys(IN_POSSESSION_DETAIL_OPTIONS).map((key) => [key, data.get(`${state}InDetail_${key}`) ?? draft.tacticalPlans[state].inPossessionDetails[key]])),
      outOfPossessionDetails:Object.fromEntries(Object.keys(OUT_OF_POSSESSION_DETAIL_OPTIONS).map((key) => [key, data.get(`${state}OutDetail_${key}`) ?? draft.tacticalPlans[state].outOfPossessionDetails[key]])),
      tacticalDimensions:Object.fromEntries(Object.keys(V2_TACTICAL_DIMENSIONS).map((key) => {
        const submitted = data.get(`${state}Dimension_${key}`);
        const fallbackValue = draft.tacticalPlans[state].tacticalDimensions?.[key] ?? defaultV2TacticalDimensions(tactic, style)[key];
        return [key, Math.max(0, Math.min(100, Math.round(Number(submitted ?? fallbackValue))))];
      })),
      playerDuties:structuredClone(draft.tacticalPlans[state].playerDuties ?? {}),
    };
  });
  return draft;
}

function setLeagueAutoSaveStatus(state, textValue) {
  const status = document.querySelector("[data-league-autosave-status]");
  if (!status) return;
  status.dataset.state = state;
  const label = status.querySelector("[data-league-autosave-label]");
  if (label) label.textContent = textValue;
  else status.textContent = textValue;
}

function leagueTeamSavePayload() {
  const draft = captureLeagueTacticalControls();
  leaguePositionPresets[leagueActivePositionPreset] = leaguePositions;
  const team = activeTacticsTeam();
  const activeScheme = team?.lineupSchemes?.find((scheme) => scheme.id === team.activeLineupSchemeId);
  return {
    lineupSchemeId:team?.activeLineupSchemeId,
    lineupSchemeRevision:Number(activeScheme?.revision ?? 0),
    starterIds:[...leagueStartingIds],
    positions:structuredClone(leaguePositionPresets.position1),
    positionPresets:structuredClone(leaguePositionPresets),
    formationLinePresets:structuredClone(leagueFormationLinePresets),
    fitnessThreshold:draft.fitnessThreshold,
    tacticalPlans:structuredClone(draft.tacticalPlans),
    captainId:draft.captainId,
    captainStyle:draft.captainStyle,
    attackFocus:draft.attackFocus,
    defenseFocus:draft.defenseFocus,
  };
}

function leagueTacticalShapePreviewOverlayMarkup(preview, mode) {
  const base = preview.frames?.find((frame) => frame.id === "base");
  const trails = (base?.players ?? []).map((player) => {
    const position = player.targetPosition ?? { x:50, y:50 };
    const duty = player.tacticalDuty ?? "";
    return `<polyline class="${escapeHtml(player.genericRole ?? "")} ${escapeHtml(duty)}" data-league-shape-trail="${escapeHtml(player.id)}" points="${position.x},${position.y}" vector-effect="non-scaling-stroke"></polyline>`;
  }).join("");
  return `<div class="league-tactical-shape-preview-overlay" data-league-tactical-shape-preview-overlay data-phase="${mode}"><svg class="league-tactical-shape-preview-trails" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="league-tactical-shape-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L5,2.5 L0,5 Z" fill="currentColor"></path></marker></defs>${trails}</svg></div>`;
}

function setLeagueTacticalShapePreviewControl(state, mode = null) {
  const control = document.querySelector("[data-league-tactical-shape-preview]");
  if (!control) return;
  const label = control.querySelector("[data-league-tactical-shape-preview-label]");
  control.classList.toggle("is-active", state === "active");
  control.classList.toggle("is-loading", state === "loading");
  control.dataset.activeMode = mode ?? "";
  control.querySelectorAll("[data-league-tactical-shape-mode]").forEach((button) => {
    button.disabled = state === "loading";
    button.classList.toggle("active", state === "active" && button.dataset.leagueTacticalShapeMode === mode);
  });
  if (label) {
    label.textContent = state === "loading"
      ? "正在计算落位"
      : mode === "base"
        ? "默认站位"
        : mode === "attack"
          ? "进攻落位"
          : mode === "defense"
            ? "防守落位"
            : "选择落位预览";
  }
}

function applyLeagueTacticalShapePreviewFrame(frame) {
  const pitch = document.querySelector("#league-tactics-pitch");
  const overlay = pitch?.querySelector("[data-league-tactical-shape-preview-overlay]");
  if (!pitch || !overlay || !frame) return false;
  overlay.dataset.phase = frame.phase;
  const label = overlay.querySelector("[data-league-tactical-shape-preview-phase]");
  if (label) label.textContent = frame.label;
  const ball = overlay.querySelector("[data-league-tactical-shape-preview-ball]");
  if (ball) {
    ball.hidden = !frame.ball;
    if (frame.ball) {
      ball.style.left = `${frame.ball.x}%`;
      ball.style.top = `${frame.ball.y}%`;
    }
  }
  frame.players.forEach((player) => {
    const position = player.targetPosition ?? player.basePosition;
    const magnet = pitch.querySelector(`[data-league-magnet="${CSS.escape(player.id)}"]`);
    if (magnet && position) {
      magnet.style.left = `${position.x}%`;
      magnet.style.top = `${position.y}%`;
      magnet.classList.add("is-tactical-shape-previewing");
    }
    const trail = overlay.querySelector(`[data-league-shape-trail="${CSS.escape(player.id)}"]`);
    if (!trail || !position) return;
    const basePosition = player.basePosition ?? position;
    trail.setAttribute("points", `${basePosition.x},${basePosition.y} ${position.x},${position.y}`);
  });
  return true;
}

function stopLeagueTacticalShapePreview({ restore = true, resetControl = true } = {}) {
  leagueTacticalShapePreviewRequestId += 1;
  leagueTacticalShapePreviewPlaying = false;
  const pitch = document.querySelector("#league-tactics-pitch");
  if (pitch) {
    pitch.querySelectorAll("[data-league-magnet]").forEach((magnet) => {
      const snapshot = leagueTacticalShapePreviewSnapshot?.get(magnet.dataset.leagueMagnet);
      if (restore && snapshot) {
        magnet.style.left = snapshot.left;
        magnet.style.top = snapshot.top;
      }
      magnet.classList.remove("is-tactical-shape-previewing");
    });
  }
  leagueTacticalShapePreviewSnapshot = null;
  pitch?.classList.remove("is-tactical-shape-previewing");
  pitch?.querySelector("[data-league-tactical-shape-preview-overlay]")?.remove();
  if (resetControl) setLeagueTacticalShapePreviewControl("idle");
}

function playLeagueTacticalShapePreview(preview, mode) {
  const pitch = document.querySelector("#league-tactics-pitch");
  const base = preview?.frames?.find((frame) => frame.id === "base");
  const target = preview?.frames?.find((frame) => frame.id === mode);
  if (!pitch || !base || !target) throw new Error("没有可播放的动态阵型数据");
  stopLeagueTacticalShapePreview({ resetControl:false });
  leagueTacticalShapePreviewSnapshot = new Map(
    [...pitch.querySelectorAll("[data-league-magnet]")].map((magnet) => [magnet.dataset.leagueMagnet, {
      left:magnet.style.left,
      top:magnet.style.top,
    }]),
  );
  leagueTacticalShapePreviewPlaying = true;
  pitch.classList.add("is-tactical-shape-previewing");
  pitch.insertAdjacentHTML("afterbegin", leagueTacticalShapePreviewOverlayMarkup(preview, mode));
  applyLeagueTacticalShapePreviewFrame(base);
  setLeagueTacticalShapePreviewControl("active", mode);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (leagueTacticalShapePreviewPlaying) applyLeagueTacticalShapePreviewFrame(target);
  }));
}

async function requestLeagueTacticalShapePreview(mode) {
  document.querySelector("[data-league-tactical-shape-preview]")?.removeAttribute("open");
  stopLeagueTacticalShapePreview({ resetControl:false });
  const requestId = leagueTacticalShapePreviewRequestId;
  if (mode === "base") {
    setLeagueTacticalShapePreviewControl("active", "base");
    return;
  }
  if (!leagueStartingIds || !leaguePositionPresets || !leagueFormationLinePresets) return showToast("请先完成首发阵容设置");
  setLeagueTacticalShapePreviewControl("loading", mode);
  try {
    const payload = leagueTeamSavePayload();
    const planState = leaguePlanStateForPositionPreset();
    const value = await api("/api/versus/league/team/tactical-shape-preview", {
      method:"POST",
      body:leagueIdentity({ ...payload, planState }),
    });
    if (requestId !== leagueTacticalShapePreviewRequestId) return;
    if (leagueMode && leagueTab === "squad") playLeagueTacticalShapePreview(value.tacticalShapePreview, mode);
  } catch (error) {
    if (requestId === leagueTacticalShapePreviewRequestId) {
      setLeagueTacticalShapePreviewControl("idle");
      showToast(error.message);
    }
  }
}

function leaguePositionPresetsAreValid() {
  const roster = activeTacticsTeam()?.roster ?? [];
  const startingSet = new Set(leagueStartingIds ?? []);
  const starters = roster.filter((player) => startingSet.has(player.id));
  return starters.length === 11 && Object.entries(leaguePositionPresets ?? {}).every(([key, positions]) => {
    return formationFromPositions(starters, positions, { requireOutfieldLines:key === "position1", formationLines:leagueFormationLinePresets?.[key] }).valid;
  });
}

function lineupSchemeCompetitionValue(team, schemeId = team?.activeLineupSchemeId) {
  const scheme = team?.lineupSchemes?.find((entry) => entry.id === schemeId);
  if (["all", "league", "cup", "friendly"].includes(scheme?.competitionScope)) return scheme.competitionScope;
  const assignedCompetitions = Object.entries(team?.lineupSchemeAssignments ?? {})
    .filter(([, assignedSchemeId]) => assignedSchemeId === schemeId)
    .map(([competition]) => competition);
  return assignedCompetitions.length === 1 ? assignedCompetitions[0] : "all";
}

async function saveLeagueTeamNow() {
  clearTimeout(leagueAutoSaveTimer);
  leagueAutoSaveTimer = null;
  if (!leagueMode || leagueTab !== "squad" || !leagueStartingIds || !leaguePositionPresets) return false;
  if (!leaguePositionPresetsAreValid()) {
    setLeagueAutoSaveStatus("error", "站位待调整");
    return false;
  }
  if (leagueAutoSavePending) {
    leagueAutoSaveTimer = setTimeout(saveLeagueTeamNow, 180);
    return false;
  }
  const revision = leagueAutoSaveRevision;
  const payload = leagueTeamSavePayload();
  leagueAutoSavePending = true;
  leagueMutationPending = true;
  let autosaveConflict = false;
  setLeagueAutoSaveStatus("saving", "正在自动保存…");
  try {
    const value = await api("/api/versus/league/team", { method:"POST", body:leagueIdentity(payload) });
    const receipt = value.teamSave;
    const sameScheme = !payload.lineupSchemeId || payload.lineupSchemeId === league.ownTeam?.activeLineupSchemeId;
    if (receipt && sameScheme) league = {
      ...league,
      updatedAt:receipt.updatedAt,
      serverTime:receipt.serverTime,
      ownTeam:{ ...league.ownTeam, ...receipt.team },
    };
    else if (!receipt && value.league) league = leagueWithCachedLazyViews(value.league);
    if (sameScheme && revision === leagueAutoSaveRevision) {
      leagueEditorDirty = false;
      setLeagueAutoSaveStatus("saved", "已实时保存");
    }
    return sameScheme;
  } catch (error) {
    const conflicted = String(error.message ?? "").includes("其他设备更新") || String(error.message ?? "").includes("方案已切换");
    if (conflicted) {
      autosaveConflict = true;
      leagueAutoSaveRevision = revision;
      clearTimeout(leagueAutoSaveTimer);
      leagueAutoSaveTimer = null;
    }
    setLeagueAutoSaveStatus("error", conflicted ? "方案已在其他设备更新，请刷新" : "保存失败");
    showToast(error.message);
    return false;
  } finally {
    leagueAutoSavePending = false;
    leagueMutationPending = false;
    if (revision !== leagueAutoSaveRevision && !autosaveConflict) leagueAutoSaveTimer = setTimeout(saveLeagueTeamNow, 180);
  }
}

async function flushLeagueTeamAutoSave() {
  clearTimeout(leagueAutoSaveTimer);
  leagueAutoSaveTimer = null;
  for (let attempt = 0; attempt < 40 && leagueAutoSavePending; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  if (leagueAutoSavePending) throw new Error("当前阵容仍在保存，请稍后再试");
  if (leagueEditorDirty && !await saveLeagueTeamNow()) throw new Error("当前阵容尚未保存，暂时无法切换方案");
  if (leagueEditorDirty || leagueAutoSavePending) throw new Error("当前阵容仍在保存，请稍后再试");
}

function adoptLineupSchemeReceipt(receipt) {
  clearTimeout(leagueAutoSaveTimer);
  leagueAutoSaveTimer = null;
  league = {
    ...league,
    updatedAt:receipt.updatedAt,
    serverTime:receipt.serverTime,
    ownTeam:{
      ...league.ownTeam,
      ...receipt.team,
      roster:(league.ownTeam?.roster ?? []).map((player) => ({ ...player, starter:receipt.team.preferredStarterIds.includes(player.id) })),
    },
  };
  leagueStartingIds = null;
  leaguePositions = null;
  leaguePositionPresets = null;
  leagueFormationLinePresets = null;
  leagueActivePositionPreset = "position1";
  leagueTacticalDraft = null;
  leagueEditorDirty = false;
}

async function mutateLineupScheme(body) {
  await flushLeagueTeamAutoSave();
  const expectedActiveLineupSchemeId = league.ownTeam?.activeLineupSchemeId;
  leagueMutationPending = true;
  try {
    const value = await api("/api/versus/league/team/lineup-scheme", { method:"POST", body:leagueIdentity({ ...body, expectedActiveLineupSchemeId }) });
    adoptLineupSchemeReceipt(value.teamSave);
    renderLeague();
  } finally {
    leagueMutationPending = false;
  }
}

async function exportLeagueLineupShare() {
  const button = document.querySelector("[data-lineup-share-export]");
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await flushLeagueTeamAutoSave();
    const value = await api("/api/versus/league/team/lineup-share/export", { method:"POST", body:leagueIdentity({}) });
    const share = value.lineupShare;
    const expiresAt = new Date(share.expiresAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
    const overlay = openLeagueDialog(`<header><div><small>LINEUP SHARE</small><h2>阵容码已生成</h2><p>包含当前方案的完整战术板、三个阶段站位与球员职责</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="league-lineup-share-result"><strong>${escapeHtml(share.code)}</strong><p>有效期至 ${escapeHtml(expiresAt)}，72小时后自动失效。</p><button type="button" class="button primary" data-lineup-share-copy>复制阵容码</button></div>`, "league-lineup-share-dialog");
    overlay.querySelector("[data-lineup-share-copy]")?.addEventListener("click", async () => {
      await navigator.clipboard?.writeText(share.code);
      showToast("阵容码已复制");
    });
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

function openLeagueLineupImport() {
  const overlay = openLeagueDialog(`<header><div><small>IMPORT LINEUP</small><h2>导入阵容方案</h2><p>请输入分享者提供的9位数字阵容码</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><form class="league-lineup-share-import" data-lineup-share-import-form><input name="code" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" placeholder="000000000" autocomplete="off" required autofocus><footer><button type="button" class="button secondary" data-close-league-dialog>取消</button><button type="submit" class="button primary">确定</button></footer></form>`, "league-lineup-share-dialog");
  overlay.querySelector("[data-lineup-share-import-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    if (!/^\d{9}$/.test(code)) return showToast("请输入有效的9位阵容码");
    closeLeagueDialog();
    openLeagueConfirm({
      title:"确认导入阵容",
      text:"导入阵容将自动覆盖当前方案。当前方案名称和赛事适配设置会保留，原有战术内容无法恢复。",
      confirmText:"确认覆盖",
      onConfirm:async () => {
        await flushLeagueTeamAutoSave();
        const value = await api("/api/versus/league/team/lineup-share/import", { method:"POST", body:leagueIdentity({ code }) });
        adoptLineupSchemeReceipt(value.teamSave);
        renderLeague();
        showToast("阵容已导入并覆盖当前方案");
      },
    });
  });
}

function scheduleLeagueTeamAutoSave(delay = 420, options = {}) {
  if (!leagueMode || leagueTab !== "squad" || !leagueStartingIds || !leaguePositionPresets) return;
  const lightweight = options.lightweight === true;
  if (!lightweight) {
    captureLeagueTacticalControls();
    leaguePositionPresets[leagueActivePositionPreset] = leaguePositions;
  }
  leagueEditorDirty = true;
  leagueAutoSaveRevision += 1;
  clearTimeout(leagueAutoSaveTimer);
  if (!lightweight && !leaguePositionPresetsAreValid()) {
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

function leagueVisibleFingerprint(view = league, tab = leagueTab) {
  if (!view) return "";
  const common = {
    tab,
    wallet: view.wallet,
    unread: view.inboxUnreadCount,
    seasonStatus: view.season?.status,
    ownTeamId: view.ownTeam?.id,
  };
  const contentByTab = {
    overview: { season:view.season, cup:view.cup, teams:view.teams, schedule:view.schedule },
    cup: view.cup,
    seasonFinal: view.seasonFinalTournament,
    predictions: { predictions:view.matchPredictions, season:view.season, cup:view.cup },
    schedule: { season:view.season, cup:view.cup, schedule:view.schedule },
    squad: view.ownTeam,
    inbox: { inbox:view.inbox, tradeOffers:view.cardTradeOffers, friendlyInvitations:view.friendlyInvitations },
    backpack: { ownTeam:view.ownTeam, packs:view.s4Packs, cosmetics:view.cosmetics, listings:view.listings },
    enhancement: {
      ownTeam:view.ownTeam,
      enhancement:view.enhancement,
      listings:view.listings,
      ranking:view.playerDirectory?.enhancementRanking,
    },
    "x-growth": view.xGrowth,
    players: view.playerDirectory,
    television: { season:view.season, cup:view.cup },
    stats: { stats:view.stats, teams:view.teams, season:view.season, cup:view.cup },
    club: { club:view.ownTeam?.clubManagement, honorRoom:leagueClubPage === "honorRoom" ? view.honorRoom : null },
    shop: { shop:view.shop, assets:view.ownTeam?.s4Assets },
    market: {
      listings:view.listings,
      assets:view.ownTeam?.s4Assets,
      ranking:view.playerDirectory?.enhancementRanking,
      tradeOffers:view.cardTradeOffers,
      teams:view.teams,
    },
  };
  return JSON.stringify({ common, content:contentByTab[tab] });
}

async function refreshLeagueSilently() {
  if (!leagueMode || !league || !account?.profile?.id || document.hidden || leagueSyncPending || leagueInteractionActive()) return;
  leagueSyncPending = true;
  try {
    await refreshBroadcasts();
    // 轻量同步：先查 head（几十字节），数据真正变化后才拉完整视图。
    const headValue = await api("/api/versus/league/head", { method:"POST", body:leagueIdentity() });
    const head = headValue.head;
    league.serverTime = head.serverTime;
    const changed = league.updatedAt === undefined
      || Number(head.updatedAt) !== Number(league.updatedAt)
      || head.seasonStatus !== (league.season?.status ?? null)
      || Number(head.seasonCurrentRound ?? 0) !== Number(league.season?.currentRound ?? 0);
    if (!changed) return;
    if (leagueTab === "predictions") {
      await refreshPredictionsSilently();
      return;
    }
    const value = await api("/api/versus/league", { method:"POST", body:leagueIdentity() });
    const before = leagueVisibleFingerprint(league, leagueTab);
    league = leagueWithCachedLazyViews(value.league);
    if (leagueTab === "club" && leagueClubPage === "honorRoom" && !league.honorRoom) {
      const honorValue = await api("/api/versus/league/honor-room", { method:"POST", body:leagueIdentity() });
      league = { ...league, honorRoom:honorValue.honorRoom };
    }
    const after = leagueVisibleFingerprint(league, leagueTab);
    updateLeagueTopbarClub();
    if (before !== after && !leagueInteractionActive()) {
      if (leagueTab === "enhancement") renderLeagueEnhancementInPlace();
      else renderLeague();
    }
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
  leagueFormationLinePresets = null;
  leagueActivePositionPreset = "position1";
  leagueTacticalDraft = null;
  clearTimeout(leagueAutoSaveTimer);
  leagueAutoSaveTimer = null;
  room = null;
  storeSession(null);
  storeLeagueView();
  updateChrome();
  app.innerHTML = `<section class="league-loading"><p class="eyebrow">YELLOWDOGS LEAGUE</p><h1>正在读取联赛数据…</h1></section>`;
  try { await leagueRequest(""); await refreshBroadcasts(); }
  catch (error) { leagueMode = false; showToast(error.message); renderLanding(); }
}

function leagueStandingRows() {
  return league.teams.map((team) => {
    const badges = (team.championBadges ?? []).map((badge) => { const isCup = badge.competition === "cup" || badge.type === "cup-champion"; const title = `${badge.season}赛季${isCup ? "杯赛" : "联赛"}冠军`; return `<span class="champion-badge ${isCup ? "cup-champion-badge" : ""}" title="${escapeHtml(title)}"><i>${isCup ? "🏆" : "♛"}</i>${escapeHtml(badge.season)}</span>`; }).join("");
    const owner = badges ? `<small class="league-team-honors">${badges}</small>` : "";
    const goalDifference = team.table.goalsFor - team.table.goalsAgainst;
    const mobileSummary = `<span class="league-standing-mobile-meta"><b>${team.table.played}场</b><span>${team.table.won}胜 ${team.table.drawn}平 ${team.table.lost}负</span><span>进失 ${team.table.goalsFor}:${team.table.goalsAgainst}</span><span>净胜 ${goalDifference > 0 ? "+" : ""}${goalDifference}</span></span>`;
    const identity = teamBadgeMarkup(team) || `<span class="club-type">玩家</span>`;
    return `<tr class="${league.ownTeam?.id === team.id ? "is-own" : ""}"><td><b>${team.rank}</b></td><td>${identity}<button class="league-team-link" data-league-team-detail="${team.id}"><span class="league-team-name">${escapeHtml(team.name)}</span>${seasonFinalStarMarkup(team.seasonFinalStarCount)}</button>${owner}${mobileSummary}</td><td>${team.table.played}</td><td>${team.table.won}</td><td>${team.table.drawn}</td><td>${team.table.lost}</td><td>${team.table.goalsFor}:${team.table.goalsAgainst}</td><td>${goalDifference > 0 ? "+" : ""}${goalDifference}</td><td><strong>${team.table.points}</strong></td></tr>`;
  }).join("");
}

function teamBadgeMarkup(teamOrId, className = "") {
  const team = typeof teamOrId === "string" ? league?.teams?.find((entry) => entry.id === teamOrId) : teamOrId;
  if (team?.isAi) {
    return `<img class="team-cosmetic-badge team-ai-badge ${escapeHtml(className)}" src="${AI_TEAM_BADGE.imageUrl}" alt="AI球队专属徽章" title="AI球队专属徽章 · 永久佩戴">`;
  }
  return [
    [team?.equippedBadge, "team-country-badge"],
    [team?.equippedClubBadge, "team-club-badge"],
  ].filter(([badge]) => badge?.imageUrl).map(([badge, typeClass]) => {
    const displayName = badge.displayName ?? badge.countryName ?? badge.clubName ?? "球队";
    return `<img class="team-cosmetic-badge ${typeClass} ${escapeHtml(className)}" src="${escapeHtml(badge.imageUrl)}" alt="${escapeHtml(displayName)}徽章" title="${escapeHtml(`${displayName}徽章 · ${badge.grade}级`)}">`;
  }).join("");
}

function competitionTeamNameMarkup(teamId, teamName) {
  return `${teamBadgeMarkup(teamId)}<span class="competition-team-name">${escapeHtml(teamName)}</span>`;
}

function seasonFinalStarMarkup(value) {
  const count = Math.max(0, Math.floor(Number(value) || 0));
  if (!count) return "";
  return `<span class="season-final-champion-stars" title="${count}次赛季总决赛冠军" aria-label="${count}次赛季总决赛冠军">${"★".repeat(count)}</span>`;
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
  const ballonDorWins = Math.max(0, Math.min(99, Math.floor(Number(options.ballonDorWins ?? card?.ballonDorWins ?? player.ballonDorWins ?? 0) || 0)));
  const band = s4UpgradeBand(upgradeLevel);
  const legendary = Boolean(player.legendary ?? player.legend ?? player.grade === "S");
  const legendaryProfile = legendary ? legendaryProfileForPlayer(player) : null;
  const aPlayerProfile = player.grade === "A" ? aPlayerProfileForPlayer(player) : null;
  const xPlayerProfile = (player.xPlayer || player.grade === "X") ? xPlayerProfileForPlayer(player) : null;
  const playerProfile = player.cardProfile ?? legendaryProfile ?? aPlayerProfile ?? xPlayerProfile;
  const traits = (card?.traits ?? options.traits ?? []).map((trait) => typeof trait === "string" ? trait : trait?.name).filter(Boolean);
  const traitMarkup = traits.length ? `<strong class="s4-player-card-traits">${traits.map(escapeHtml).join("<br>")}</strong>` : "";
  const upgradeMarkup = upgradeLevel ? `<span class="s4-player-card-upgrade band-${band}">+${upgradeLevel}</span>` : "";
  const ballonDorMarkup = ballonDorWins ? `<span class="s4-player-card-ballon-dor" title="${ballonDorWins}次赛季金球奖" aria-label="${ballonDorWins}次赛季金球奖">${Array.from({ length:Math.min(5, ballonDorWins) }, () => '<i aria-hidden="true"></i>').join("")}${ballonDorWins > 5 ? `<b>+${ballonDorWins - 5}</b>` : ""}</span>` : "";
  const playerProfileMarkup = playerProfile
    ? `<img class="s4-player-card-profile" src="${escapeHtml(playerProfile.imageUrl)}" alt="" draggable="false" decoding="async"${options.lazyImage ? ' loading="lazy" fetchpriority="low"' : ""} style="--profile-x:${playerProfile.xPercent}%;--profile-y:${playerProfile.yPercent}%;--profile-width:${playerProfile.widthPercent}%">`
    : "";
  const attributes = options.attributes ?? "";
  const delay = Number(options.delay ?? 0);
  return `<button type="button" class="s4-player-card grade-${String(player.grade ?? "C").toLowerCase()} band-${band} ${playerProfile ? "has-player-profile" : ""} ${ballonDorWins ? "has-ballon-dor" : ""} ${options.compact ? "compact" : ""} ${options.animated ? "animated" : ""} ${escapeHtml(options.className ?? "")}" style="--delay:${delay}ms" ${attributes} aria-label="${escapeHtml(`${player.name}，能力${displayedOverall}，${ROLE_LABELS[player.role] ?? player.role ?? "待选择位置"}${upgradeLevel ? `，强化+${upgradeLevel}` : ""}${ballonDorWins ? `，${ballonDorWins}次赛季金球奖` : ""}`)}">
    ${ballonDorMarkup}
    ${upgradeMarkup}
    <div class="s4-player-card-head"><strong>${displayedOverall}</strong>${player.role ? `<b>${escapeHtml(player.role)}</b>` : ""}</div>
    <div class="s4-player-card-grade"><span>${escapeHtml(player.grade ?? "C")}</span></div>
    <div class="s4-player-card-name"><h3>${escapeHtml(player.name)}</h3></div>
    <footer><b>${escapeHtml(player.club ?? "无俱乐部")} / ${escapeHtml(player.nationality ?? "无国家队")}</b>${traitMarkup}</footer>
    ${playerProfileMarkup}
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
  const cosmeticType = String(pack.cosmeticType ?? "");
  const tone = kind === "cosmetic"
    ? cosmeticType === "club-badge" ? "club-badge" : "country-badge"
    : kind === "legend" || pool === "LEGEND" ? "legend"
    : kind === "public" ? "public"
      : pool === "ATT" ? "att"
        : pool === "MID" ? "mid"
          : pool === "DEF" ? "def"
            : pool === "GK" ? "gk"
              : "mixed";
  const code = tone === "country-badge" ? "NAT" : tone === "club-badge" ? "CLB" : tone === "legend" ? "LEG" : tone === "public" ? "PUB" : pool === "MIXED" ? "ALL" : pool;
  const label = tone === "country-badge" ? "国家徽章" : tone === "club-badge" ? "俱乐部徽章" : tone === "legend" ? "传奇" : tone === "public" ? "公共池" : pool === "MIXED" ? "全位置" : LINE_LABELS[pool] ?? pack.name;
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
    { tag:"button", className:"league-pool-draw", attributes:`data-league-draw="${pool}"`, disabled:leagueMutationPending || !league.draft.allowedPools.includes(pool) },
  )).join("");
  const offer = league.draft.offer.length
    ? `<div class="league-card-offer"><header><small>${LINE_LABELS[league.draft.offerPool]}候选</small><h2>从三张卡牌中签下一人</h2></header><div class="league-flip-grid s4-player-card-choice-grid">${league.draft.offer.map((player,index) => s4PlayerCardMarkup(player, { animated:true, delay:index * 90, attributes:`data-league-choose="${player.id}" ${leagueMutationPending ? "disabled" : ""}` })).join("")}</div></div>`
    : selected.length === 22
      ? xPlayerDraftMarkup()
      : `<div class="league-pool-stage"><header><small>PICK A POSITION</small><h2>选择下一次翻卡的位置</h2></header><div class="league-pool-grid">${poolButtons}</div><p>选择位置后将展示该位置的候选球员。</p></div>`;
  const roster = selected.length ? selected.map((player,index) => `<div class="league-drafted-player"><span>${index + 1}</span><i class="grade grade-${player.grade}">${player.grade}</i><b>${escapeHtml(player.name)}<small>${ROLE_LABELS[player.role] ?? player.role}</small></b><strong>${player.overall}</strong></div>`).join("") : `<p class="league-empty">尚未签下球员</p>`;
  return `<section class="league-shell"><header class="league-work-head"><div><p class="eyebrow">22-PLAYER DRAFT</p><h1>翻卡建立注册名单</h1></div><div class="draft-total"><small>已签下</small><b>${selected.length}<em>/22</em></b></div></header><div class="league-card-draft-layout"><main>${offer}</main><aside class="league-drafted-list"><header><div><small>MY 22</small><h2>已签球员</h2></div></header><div class="league-draft-side-counts"><span>前场 <b>${counts.ATT}</b></span><span>中场 <b>${counts.MID}</b></span><span>后场 <b>${counts.DEF}</b></span><span>门将 <b>${counts.GK}</b></span></div><div class="league-drafted-roster">${roster}</div></aside></div></section>`;
}

function leagueMatchRow(match, historyTeamId = null) {
  const canOpen = match.hasDetails && (!historyTeamId || match.homeId === historyTeamId || match.awayId === historyTeamId);
  const score = match.score ? `${match.score[0]} : ${match.score[1]}` : "-：-";
  const label = match.label ?? (match.competition === "friendly" ? "友谊赛" : Number.isFinite(Number(match.round)) ? `第 ${match.round} 轮` : "比赛");
  return `<button type="button" class="league-result ${match.hasPlayerTeam ? "has-player" : ""}" ${canOpen ? `data-league-match-detail="${escapeHtml(match.id)}"` : "disabled"}><span>${label}</span><b>${competitionTeamNameMarkup(match.homeId, match.homeName)}</b><strong>${score}</strong><b>${competitionTeamNameMarkup(match.awayId, match.awayName)}</b><small>${canOpen ? "查看比赛 ›" : match.pending ? "未开赛" : escapeHtml(match.formations?.join(" vs ") ?? "")}</small></button>`;
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
  return `<div class="league-dashboard-grid"><section class="league-panel standings-panel"><header><div><small>LEAGUE TABLE</small><h2>积分榜</h2></div><b>${league.season.currentRound}/${league.season.totalRounds} 轮</b></header><div class="league-table-wrap"><table class="league-table"><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜</th><th>平</th><th>负</th><th>进失</th><th>净胜</th><th>分</th></tr></thead><tbody>${leagueStandingRows()}</tbody></table></div></section><div class="league-dashboard-side"><aside class="league-report"><header><small>DAILY REPORT</small><h2>${escapeHtml(report.headline)}</h2></header><div class="report-rank"><span>当前排名</span><b>${report.rank}<em>/10</em></b></div><dl><div><dt>赛季战绩</dt><dd>${report.record}</dd></div><div><dt>今日战绩</dt><dd>${report.today.wins}胜 ${report.today.draws}平 ${report.today.losses}负</dd></div><div><dt>积分</dt><dd>${report.points}</dd></div><div><dt>本队最佳</dt><dd>${report.bestPlayer ? `${escapeHtml(report.bestPlayer.name)} · ${report.bestPlayer.averageRating}` : "等待首场比赛"}</dd></div><div><dt>可用球员</dt><dd>${report.availability.available}/${report.availability.total}</dd></div></dl></aside>${leagueOverviewPlayerSearchMarkup()}</div><section class="league-panel recent-panel"><header><div><small>MATCH CENTRE</small><h2>赛果与球队战绩</h2></div>${league.developer && league.season.status === "active" ? `<button class="button secondary" data-league-simulate>模拟下一轮</button>` : ""}</header>${leagueMatchCentreMarkup()}</section>${leagueDailyReportMarkup(report)}</div>`;
}

function playerDirectorySearchResults(search) {
  const query = String(search ?? "").trim().toLocaleLowerCase("zh-CN");
  const roleQuery = ["GK", "CB", "LB", "RB", "LWB", "RWB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"].includes(query.toUpperCase()) ? query.toUpperCase() : null;
  return (league.playerDirectory?.players ?? []).filter((player) => roleQuery
    ? [player.role, player.secondaryRole].includes(roleQuery)
    : !query || [player.name, player.club, player.nationality].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(query)));
}

function leagueOverviewPlayerResultsMarkup() {
  const results = playerDirectorySearchResults(leagueOverviewPlayerSearch);
  const rows = results.slice(0, 60).map((player) => {
    const owner = player.ownership ? `${player.ownership.ownerName} · ${player.ownership.teamName}` : player.legend ? "传奇公共球员" : "公共池球员";
    const secondaryRole = player.secondaryRole && player.secondaryRole !== player.role ? ` / ${player.secondaryRole}` : "";
    const selected = leagueOverviewPlayerComparison.some((entry) => entry.playerId === player.id);
    return `<div class="overview-player-result grade-${String(player.grade ?? "C").toLowerCase()} ${selected ? "is-comparing" : ""}" data-overview-player-detail="${escapeHtml(player.id)}" tabindex="0" role="button"><i>${escapeHtml(player.grade)}</i><span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.club)} · ${escapeHtml(player.nationality)}</small></span><strong>${player.overall}<small>${escapeHtml(player.role)}${escapeHtml(secondaryRole)}</small></strong><button type="button" class="overview-player-compare-add ${selected ? "is-selected" : ""}" data-overview-compare-add="${escapeHtml(player.id)}" aria-label="${selected ? "已加入球员对比" : `将${escapeHtml(player.name)}加入球员对比`}" ${selected ? "disabled" : ""}>${selected ? "✓" : "+"}</button><em>${escapeHtml(owner)}</em></div>`;
  }).join("");
  const empty = leaguePlayerDirectoryLoading && !league.playerDirectory ? "正在载入球员数据库…" : "没有找到符合条件的球员";
  const count = leaguePlayerDirectoryLoading && !league.playerDirectory ? "正在同步最新球员资料" : `${results.length} 名球员${results.length > 60 ? " · 输入关键词缩小范围" : ""}`;
  return `<div class="overview-player-results" data-overview-player-results>${rows || `<p>${empty}</p>`}</div><span class="overview-player-count" data-overview-player-count>${count}</span>`;
}

function leagueOverviewPlayerCompareTrayMarkup() {
  const selected = leagueOverviewPlayerComparison.map((entry) => ({ entry, player:(league.playerDirectory?.players ?? []).find((player) => player.id === entry.playerId) })).filter(({ player }) => player);
  if (!selected.length) return "";
  const cards = selected.map(({ entry, player }) => `<div class="overview-player-compare-mini grade-${String(player.grade ?? "C").toLowerCase()}"><i>${escapeHtml(player.grade)}</i><span><b>${escapeHtml(player.name)}</b><small>${entry.upgradeLevel ? `强化 +${entry.upgradeLevel}` : "默认强化"}</small></span><button type="button" data-overview-compare-remove="${escapeHtml(player.id)}" aria-label="移除${escapeHtml(player.name)}">×</button></div>`).join("");
  const action = selected.length === 2
    ? `<button type="button" class="overview-player-compare-open" data-overview-compare-open>打开27项对比</button>`
    : `<small class="overview-player-compare-hint">再添加一名球员</small>`;
  return `<aside class="overview-player-compare-tray" data-overview-compare-tray><div>${cards}</div>${action}</aside>`;
}

function leagueOverviewPlayerSearchMarkup() {
  const active = Boolean(leagueOverviewPlayerSearch.trim());
  const comparing = leagueOverviewPlayerComparison.length > 0;
  return `<section class="overview-player-search ${active ? "has-query" : ""} ${comparing ? "has-comparison" : ""}"><div class="overview-player-search-home"><strong>YOOGLE</strong><label><span aria-hidden="true">⌕</span><input type="search" value="${escapeHtml(leagueOverviewPlayerSearch)}" placeholder="搜索球员" data-overview-player-search aria-label="搜索球员"></label></div>${leagueOverviewPlayerResultsMarkup()}${leagueOverviewPlayerCompareTrayMarkup()}</section>`;
}

function refreshLeagueOverviewPlayerSearch() {
  const panel = document.querySelector(".overview-player-search");
  if (!panel) return;
  panel.classList.toggle("has-query", Boolean(leagueOverviewPlayerSearch.trim()));
  const currentResults = panel.querySelector("[data-overview-player-results]");
  const currentCount = panel.querySelector("[data-overview-player-count]");
  const currentTray = panel.querySelector("[data-overview-compare-tray]");
  const fragment = document.createElement("div");
  fragment.innerHTML = `${leagueOverviewPlayerResultsMarkup()}${leagueOverviewPlayerCompareTrayMarkup()}`;
  currentResults?.replaceWith(fragment.querySelector("[data-overview-player-results]"));
  currentCount?.replaceWith(fragment.querySelector("[data-overview-player-count]"));
  const nextTray = fragment.querySelector("[data-overview-compare-tray]");
  if (currentTray && nextTray) currentTray.replaceWith(nextTray);
  else if (currentTray) currentTray.remove();
  else if (nextTray) panel.append(nextTray);
  panel.classList.toggle("has-comparison", leagueOverviewPlayerComparison.length > 0);
}

function overviewPlayerPreviewValues(player, upgradeLevel = 0, bondPercent = 0) {
  const level = Math.max(0, Math.min(8, Math.floor(Number(upgradeLevel) || 0)));
  const bond = Math.max(-100, Math.min(100, Number(bondPercent) || 0));
  const abilityBonuses = league.enhancement?.abilityBonuses ?? [0, 1, 2, 3, 5, 7, 9, 11, 13];
  const enhancementBonus = Number(abilityBonuses[level] ?? 0);
  const multiplier = 1 + bond / 100;
  const attributes = Object.fromEntries(Object.entries(player.attributes ?? {}).map(([key, value]) => {
    const enhanced = Math.round((Number(value) + enhancementBonus) * multiplier);
    return [key, Math.max(1, offlineAttributeSettings.unlocked ? enhanced : Math.min(99, enhanced))];
  }));
  return { level, bond, enhancementBonus, attributes, overall:Math.round((Number(player.overall) + enhancementBonus) * multiplier) };
}

function addLeagueOverviewPlayerComparison(playerId) {
  if (leagueOverviewPlayerComparison.some((entry) => entry.playerId === playerId)) return;
  const player = (league.playerDirectory?.players ?? []).find((entry) => entry.id === playerId);
  if (!player) return showToast("找不到该球员资料");
  if (leagueOverviewPlayerComparison.length >= 2) return showToast("最多同时对比两名球员，请先移除一名");
  leagueOverviewPlayerComparison.push({ playerId, upgradeLevel:0, bondPercent:0 });
  refreshLeagueOverviewPlayerSearch();
  showToast(leagueOverviewPlayerComparison.length === 2 ? "已添加两名球员，可以打开27项对比" : `已将${player.name}加入对比`);
}

function removeLeagueOverviewPlayerComparison(playerId) {
  leagueOverviewPlayerComparison = leagueOverviewPlayerComparison.filter((entry) => entry.playerId !== playerId);
  refreshLeagueOverviewPlayerSearch();
}

function overviewPlayerComparisonValue(value, opponentValue, suffix = "") {
  const higher = Number(value) > Number(opponentValue);
  return `<strong${higher ? ` class="is-higher"` : ""}>${value}${suffix}</strong>`;
}

function overviewPlayerComparisonBar(leftValue, rightValue, maxDifference = 30) {
  const difference = Number(leftValue) - Number(rightValue);
  const differenceWidth = Math.max(0, Math.min(100, Math.round(Math.abs(difference) / Math.max(1, Number(maxDifference)) * 100)));
  const leftWidth = difference > 0 ? differenceWidth : 0;
  const rightWidth = difference < 0 ? differenceWidth : 0;
  return `<div class="overview-player-comparison-bar" aria-hidden="true"><span class="bar-left"><i style="width:${leftWidth}%"></i></span><span class="bar-right"><i style="width:${rightWidth}%"></i></span></div>`;
}

function overviewPlayerComparisonMarkup() {
  const selected = leagueOverviewPlayerComparison.map((entry) => ({ entry, player:(league.playerDirectory?.players ?? []).find((player) => player.id === entry.playerId) })).filter(({ player }) => player).slice(0, 2);
  if (selected.length !== 2) return `<p class="league-empty">请先从YOOGLE搜索结果中添加两名球员。</p>`;
  const previews = selected.map(({ entry, player }) => overviewPlayerPreviewValues(player, entry.upgradeLevel, entry.bondPercent));
  const playerCard = (index) => {
    const { entry, player } = selected[index];
    const preview = previews[index];
    const displayedCard = { upgradeLevel:preview.level, effectiveOverall:preview.overall };
    return `<aside class="overview-player-comparison-card overview-player-card-column comparison-side-${index === 0 ? "left" : "right"}"><div class="overview-player-card">${s4PlayerCardMarkup(player, { card:displayedCard })}</div><div class="overview-player-preview-controls"><label><span>强化等级预览</span><select data-overview-compare-upgrade="${escapeHtml(player.id)}">${Array.from({ length:9 }, (_, level) => `<option value="${level}" ${level === preview.level ? "selected" : ""}>${level ? `+${level}` : "默认"}</option>`).join("")}</select></label><label><span>羁绊增益预览</span><input type="number" min="-100" max="100" step="0.5" value="${preview.bond}" data-overview-compare-bond="${escapeHtml(player.id)}"><em>%</em></label></div><p class="overview-player-preview-note">强化能力 +${preview.enhancementBonus} · 羁绊 ${preview.bond >= 0 ? "+" : ""}${preview.bond}%</p></aside>`;
  };
  const attributeRows = Object.keys(previews[0].attributes).map((key) => {
    const left = previews[0].attributes[key];
    const right = previews[1].attributes[key];
    return `<div class="overview-player-comparison-stat"><dt>${escapeHtml(STAT_LABELS[key] ?? key)}</dt><dd><span>${overviewPlayerComparisonValue(left, right)}</span>${overviewPlayerComparisonBar(left, right)}<span>${overviewPlayerComparisonValue(right, left)}</span></dd></div>`;
  }).join("");
  const leftHeight = Number(selected[0].player.heightCm) || 0;
  const rightHeight = Number(selected[1].player.heightCm) || 0;
  const heightRow = `<div class="overview-player-comparison-stat is-height"><dt>身高</dt><dd><span>${overviewPlayerComparisonValue(leftHeight || "-", rightHeight)}</span>${overviewPlayerComparisonBar(leftHeight, rightHeight, 30)}<span>${overviewPlayerComparisonValue(rightHeight || "-", leftHeight)}</span></dd></div>`;
  const rows = `${attributeRows}${heightRow}`;
  return `<div class="overview-player-comparison overview-player-comparison-symmetric">${playerCard(0)}<section class="overview-player-attributes overview-player-comparison-attributes"><header><h3>27项数值对比</h3><span>26项能力与身高 · 强化及羁绊均已计入</span></header><div class="overview-player-comparison-legend"><span>${escapeHtml(selected[0].player.name)}</span><i>VS</i><span>${escapeHtml(selected[1].player.name)}</span></div><dl>${rows}</dl></section>${playerCard(1)}</div>`;
}

function openOverviewPlayerComparison() {
  if (leagueOverviewPlayerComparison.length !== 2) return showToast("请先添加两名球员");
  const overlay = openLeagueDialog(`<header><div><small>YOOGLE · PLAYER COMPARISON</small><h2>球员27项数值对比</h2><p>26项能力与身高统一对比；较高数值以浅绿色标记。</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div data-overview-player-comparison>${overviewPlayerComparisonMarkup()}</div>`, "overview-player-comparison-dialog");
  overlay.addEventListener("change", (event) => {
    if (event.target.matches("[data-overview-compare-upgrade]")) refreshOverviewPlayerComparison(event.target);
  });
  overlay.addEventListener("input", (event) => {
    if (event.target.matches("[data-overview-compare-bond]")) refreshOverviewPlayerComparison(event.target);
  });
}

function refreshOverviewPlayerComparison(control) {
  const playerId = control.dataset.overviewCompareUpgrade ?? control.dataset.overviewCompareBond;
  const selected = leagueOverviewPlayerComparison.find((entry) => entry.playerId === playerId);
  const target = control.closest(".league-dialog")?.querySelector("[data-overview-player-comparison]");
  if (!selected || !target) return;
  const isBond = control.matches("[data-overview-compare-bond]");
  const selectionStart = isBond ? control.selectionStart : null;
  if (isBond) selected.bondPercent = Math.max(-100, Math.min(100, Number(control.value) || 0));
  else selected.upgradeLevel = Math.max(0, Math.min(8, Math.floor(Number(control.value) || 0)));
  target.innerHTML = overviewPlayerComparisonMarkup();
  if (selectionStart != null) {
    const nextInput = target.querySelector(`[data-overview-compare-bond="${CSS.escape(playerId)}"]`);
    nextInput?.focus();
    nextInput?.setSelectionRange(selectionStart, selectionStart);
  }
  refreshLeagueOverviewPlayerSearch();
}

function overviewPlayerOwnershipMarkup(player, card = null) {
  const ownership = player.ownership
    ? `<div class="overview-player-owner"><small>球员所有权</small><b>${escapeHtml(player.ownership.ownerName)}</b><span>${escapeHtml(player.ownership.teamName)}</span></div>`
    : `<div class="overview-player-owner"><small>球员所有权</small><b>${player.legend ? "传奇公共球员" : "暂无玩家所有权"}</b><span>${player.legend ? "不设置唯一所有权" : "当前属于公共池"}</span></div>`;
  if (!card) return `<div class="overview-player-ownership">${ownership}<section><small>持卡玩家 · ${player.cardCount ?? 0} 张</small><div>${player.holders?.length ? player.holders.map(leaguePlayerHolderMarkup).join("") : "<em>当前没有玩家持卡</em>"}</div></section></div>`;
  const traits = (card.traits ?? []).filter((trait) => trait?.name);
  const referenceValue = Number(card.referenceValue ?? player.referencePrice ?? 0);
  return `<div class="overview-player-ownership is-card-asset">${ownership}<section class="overview-player-card-asset"><small>当前球员卡</small><div><span><b>${card.upgradeLevel ? `强化 +${card.upgradeLevel}` : "未强化"}</b><small>有效能力 ${card.effectiveOverall ?? player.overall} · 基础 ${card.baseOverall ?? player.overall}</small></span><span><b>参考价值</b><small>${referenceValue.toLocaleString("zh-CN")} 金币</small></span><span><b>获得方式</b><small>${escapeHtml(card.acquisitionSource ?? "未知")}</small></span><span class="wide"><b>强化特性</b><small>${traits.length ? traits.map((trait) => `${escapeHtml(trait.name)}${trait.summary ? `：${escapeHtml(trait.summary)}` : ""}`).join(" · ") : "暂无强化特性"}</small></span></div></section></div>`;
}

function overviewPlayerDetailMarkup(player, { upgradeLevel = 0, bondPercent = 0, card = null } = {}) {
  const cardMode = Boolean(card);
  const preview = overviewPlayerPreviewValues(player, cardMode ? card.upgradeLevel : upgradeLevel, cardMode ? 0 : bondPercent);
  if (cardMode && Number.isFinite(Number(card.effectiveOverall))) preview.overall = Number(card.effectiveOverall);
  const coreGroup = player.role === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(player.role) ? "DEF" : ["ST", "LW", "RW"].includes(player.role) ? "ATT" : "MID";
  const coreAttributes = new Set(LEAGUE_ROLE_CORE_ATTRIBUTES[coreGroup] ?? []);
  const attributeMarkup = Object.entries(preview.attributes).map(([key, value]) => `<div class="${coreAttributes.has(key) ? "core" : ""}"><dt>${escapeHtml(STAT_LABELS[key] ?? key)}</dt><dd class="${Number(value) > 99 ? "is-overcap" : ""}">${value}</dd></div>`).join("");
  const role = `${ROLE_LABELS[player.role] ?? player.role}${player.secondaryRole && player.secondaryRole !== player.role ? ` / ${ROLE_LABELS[player.secondaryRole] ?? player.secondaryRole}` : ""}`;
  const foot = ({ left:"左脚", right:"右脚", both:"双足" })[player.preferredFoot] ?? player.preferredFoot ?? "未知";
  const controls = cardMode
    ? `<div class="overview-player-card-level"><span>当前卡片强化</span><b>${preview.level ? `+${preview.level}` : "未强化"}</b><small>详情已锁定为这张卡的实际强化效果</small></div>`
    : `<div class="overview-player-preview-controls"><label><span>强化等级预览</span><select data-overview-preview-upgrade>${Array.from({ length:9 }, (_, level) => `<option value="${level}" ${level === preview.level ? "selected" : ""}>${level ? `+${level}` : "默认"}</option>`).join("")}</select></label><label><span>羁绊增益预览</span><input type="number" min="-100" max="100" step="0.5" value="${preview.bond}" data-overview-preview-bond><em>%</em></label></div>`;
  const traits = cardMode ? (card.traits ?? []).map((trait) => trait.name).filter(Boolean) : [];
  const facts = cardMode
    ? [["当前综合能力", preview.overall], ["默认能力", player.overall], ["强化等级", preview.level ? `+${preview.level}` : "未强化"], ["评级", player.grade], ["位置", role], ["身高", `${Number(player.heightCm) || "-"} cm`], ["惯用脚", foot], ["俱乐部 / 国家队", `${player.club} / ${player.nationality}`], ["强化特性", traits.length ? traits.join("、") : "暂无"]]
    : [["预览综合能力", preview.overall], ["默认能力", player.overall], ["评级", player.grade], ["位置", role], ["身高", `${Number(player.heightCm) || "-"} cm`], ["惯用脚", foot], ["俱乐部 / 国家队", `${player.club} / ${player.nationality}`]];
  const factMarkup = facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  const displayedCard = cardMode ? { ...card, effectiveOverall:preview.overall } : { upgradeLevel:preview.level, effectiveOverall:preview.overall };
  const capNote = offlineAttributeSettings.unlocked ? ` · 99上限已解除，超限部分按 ${Math.round(offlineAttributeSettings.overflowRate * 100)}% 参与模拟` : "";
  return `<div class="overview-player-detail ${cardMode ? "is-card-detail" : "is-preview"}"><div class="overview-player-card-column"><div class="overview-player-card">${s4PlayerCardMarkup(player, { card:displayedCard })}</div>${controls}</div><section class="overview-player-profile"><dl class="overview-player-facts">${factMarkup}</dl><div class="overview-player-attributes"><header><h3>${cardMode ? "当前26项能力值" : "预览26项能力值"}</h3><span>${cardMode ? `已计入此卡 +${preview.level} 强化，不含阵容羁绊` : "强化与羁绊均已计入"}${capNote}</span></header><dl>${attributeMarkup}</dl></div>${overviewPlayerOwnershipMarkup(player, card)}</section></div>`;
}

function overviewPlayerPreviewMarkup(player, upgradeLevel = 0, bondPercent = 0) {
  return overviewPlayerDetailMarkup(player, { upgradeLevel, bondPercent });
}

function openPlayerProfilePreview(playerId, { directory = false, upgradeLevel = 0, bondPercent = 0 } = {}) {
  const player = (league.playerDirectory?.players ?? []).find((entry) => entry.id === playerId);
  if (!player) return showToast("找不到该球员资料");
  const heading = directory
    ? ["PLAYER PROFILE · GLOBAL DIRECTORY", "球员资料、全服所有权与可调能力预览"]
    : ["PLAYER PROFILE", "默认球员资料与全服所有权信息"];
  const overlay = openLeagueDialog(`<header><div><small>${heading[0]}</small><h2>${escapeHtml(player.name)}</h2><p>${heading[1]}</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div data-overview-player-preview>${overviewPlayerPreviewMarkup(player, upgradeLevel, bondPercent)}</div>`, "overview-player-dialog");
  overlay.classList.add("overview-player-dialog-overlay");
  overlay.querySelector(".league-dialog").dataset.overviewPlayerId = player.id;
  overlay.addEventListener("change", (event) => {
    if (event.target.matches("[data-overview-preview-upgrade]")) refreshOverviewPlayerPreview(event.target);
  });
  overlay.addEventListener("input", (event) => {
    if (event.target.matches("[data-overview-preview-bond]")) refreshOverviewPlayerPreview(event.target);
  });
}

function openOverviewPlayerDetail(playerId) {
  openPlayerProfilePreview(playerId);
}

function openPlayerDirectoryDetail(playerId, upgradeLevel = 0) {
  openPlayerProfilePreview(playerId, { directory:true, upgradeLevel });
}

function refreshOverviewPlayerPreview(control) {
  const dialog = control.closest(".league-dialog");
  const player = (league.playerDirectory?.players ?? []).find((entry) => entry.id === dialog?.dataset.overviewPlayerId);
  const target = dialog?.querySelector("[data-overview-player-preview]");
  if (!player || !target) return;
  const selectionStart = control.matches("[data-overview-preview-bond]") ? control.selectionStart : null;
  const level = dialog.querySelector("[data-overview-preview-upgrade]")?.value ?? 0;
  const bond = dialog.querySelector("[data-overview-preview-bond]")?.value ?? 0;
  target.innerHTML = overviewPlayerPreviewMarkup(player, level, bond);
  if (selectionStart != null) {
    const nextInput = dialog.querySelector("[data-overview-preview-bond]");
    nextInput?.focus();
    nextInput?.setSelectionRange(selectionStart, selectionStart);
  }
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

function predictionCategoryLabel(category) {
  return { result:"胜平负", goals:"总进球", cards:"红黄牌总数", halfFull:"半全场" }[category] ?? category;
}

function predictionSelectionLabel(market, category, selection) {
  return market.options?.[category]?.find((option) => option.id === selection)?.label ?? selection;
}

function predictionPayoutRate(market, category, selection) {
  return Number(market.options?.[category]?.find((option) => option.id === selection)?.payoutRate ?? 0);
}

function predictionPayoutText(rateValue) {
  const rate = Number(rateValue);
  return Number.isFinite(rate) && rate > 0 ? rate.toFixed(2) : "分析中";
}

function predictionHandicapText(market) {
  const handicap = Number(market.resultHandicap);
  if (!Number.isInteger(handicap)) return market.resultHandicapHint ?? "盘口分析中";
  if (handicap < 0) return `主队让 ${Math.abs(handicap)} 球`;
  if (handicap > 0) return `客队让 ${handicap} 球`;
  return "零球盘 · 0球";
}

function predictionMatchCardMarkup(market) {
  const bets = market.myBets?.length
    ? `<div class="prediction-my-bets">${market.myBets.map((bet) => `<span><small>${escapeHtml(predictionCategoryLabel(bet.category))}</small><b>${escapeHtml(predictionSelectionLabel(market, bet.category, bet.selection))}</b><em>${predictionPayoutText(bet.payoutRate)} · ${Number(bet.amount).toLocaleString("zh-CN")}金币</em></span>`).join("")}</div>`
    : `<p>尚未参与本场预测</p>`;
  return `<article class="prediction-match-card ${market.eligible ? "" : "restricted"}" data-prediction-card="${escapeHtml(market.id)}"><header><span>${escapeHtml(market.competitionName)}</span><small>${market.competition === "cup" ? `第${market.round}轮 · ${market.stage ?? ""}${market.leg ? ` · 第${market.leg}回合` : ""}` : `第${market.round}轮`}</small></header><div class="prediction-versus"><b>${escapeHtml(market.homeName)}</b><strong>VS</strong><b>${escapeHtml(market.awayName)}</b></div><div class="prediction-match-meta"><time>${scheduleTimeText(market.startsAt)}</time><strong>${escapeHtml(predictionHandicapText(market))}</strong></div>${bets}<footer><small>${market.eligible ? "各玩法限额详见盘口 · 开赛前2分钟截止" : escapeHtml(market.lockedReason ?? "本场不可参与")}</small><button type="button" class="button ${market.eligible ? "primary" : "secondary"}" data-prediction-market="${escapeHtml(market.id)}">查看预测</button></footer></article>`;
}

function predictionMatchCardsMarkup(markets = league.matchPredictions ?? []) {
  return markets.map(predictionMatchCardMarkup).join("");
}

function predictionLeaderboardMarkup(entries = league.predictionLeaderboard ?? []) {
  return entries.map((entry) => {
    const profit = Number(entry.netProfit ?? 0);
    const profitClass = profit > 0 ? "positive" : profit < 0 ? "negative" : "neutral";
    return `<li class="${profitClass}"><span>${entry.rank}</span><div><b>${escapeHtml(entry.teamName)}</b><small>${entry.betCount ? `${entry.betCount}条投注记录 · ${entry.settledBetCount}条已结算` : "暂无投注记录"}</small></div><strong>${profit > 0 ? "+" : ""}${profit.toLocaleString("zh-CN")}</strong></li>`;
  }).join("");
}

function acceptPredictionSnapshot(snapshot) {
  league = {
    ...league,
    updatedAt:snapshot.updatedAt,
    serverTime:snapshot.serverTime,
    wallet:{ ...league.wallet, ...snapshot.wallet },
    matchPredictions:snapshot.matchPredictions,
    predictionLeaderboard:snapshot.predictionLeaderboard,
  };
}

function renderPredictionsInPlace() {
  if (leagueTab !== "predictions") return;
  const markets = league.matchPredictions ?? [];
  const wallet = app.querySelector("[data-prediction-wallet]");
  const count = app.querySelector("[data-prediction-count]");
  const grid = app.querySelector("[data-prediction-grid]");
  const ranking = app.querySelector("[data-prediction-ranking]");
  if (!wallet || !count || !grid || !ranking) return renderLeague();
  wallet.textContent = Number(league.wallet.balance).toLocaleString("zh-CN");
  count.textContent = `${markets.length}场`;
  const existingCards = new Map([...grid.querySelectorAll("[data-prediction-card]")].map((card) => [card.dataset.predictionCard, card]));
  const nextIds = new Set(markets.map((market) => market.id));
  existingCards.forEach((card, marketId) => { if (!nextIds.has(marketId)) card.remove(); });
  grid.querySelector(".league-empty")?.remove();
  markets.forEach((market) => {
    const markup = predictionMatchCardMarkup(market);
    const current = existingCards.get(market.id);
    if (!current) grid.insertAdjacentHTML("beforeend", markup);
    else if (current.outerHTML !== markup) current.outerHTML = markup;
  });
  if (!markets.length) grid.innerHTML = `<p class="league-empty">下一轮比赛尚未生成，系统会在赛程确定后自动开放预测。</p>`;
  ranking.innerHTML = predictionLeaderboardMarkup() || `<li class="neutral empty"><div><b>暂无玩家</b><small>建立球队后进入排行榜</small></div><strong>0</strong></li>`;
  updateLeagueTopbarClub();
}

async function refreshPredictionsSilently() {
  const value = await api("/api/versus/league/predictions", { method:"POST", body:leagueIdentity() });
  const before = JSON.stringify({ wallet:league.wallet?.balance, markets:league.matchPredictions, ranking:league.predictionLeaderboard });
  acceptPredictionSnapshot(value.predictions);
  const after = JSON.stringify({ wallet:league.wallet?.balance, markets:league.matchPredictions, ranking:league.predictionLeaderboard });
  if (before !== after && !leagueInteractionActive()) renderPredictionsInPlace();
}

async function placePrediction(body) {
  leagueMutationPending = true;
  try {
    const value = await api("/api/versus/league/predictions/bet", { method:"POST", body:leagueIdentity(body) });
    acceptPredictionSnapshot(value.predictions);
    renderPredictionsInPlace();
  } finally {
    leagueMutationPending = false;
  }
}

function leaguePredictionsMarkup() {
  const markets = league.matchPredictions ?? [];
  const cards = predictionMatchCardsMarkup(markets);
  const leaderboard = predictionLeaderboardMarkup();
  return `<section class="prediction-page"><header class="prediction-hero"><div><small>MATCH FORECAST</small><h2>比赛预测</h2><p>选择下一轮联赛或杯赛的比赛进行预测。具体让球数与最终结算赔率均公开。</p></div><aside><small>当前金币</small><b data-prediction-wallet>${Number(league.wallet.balance).toLocaleString("zh-CN")}</b><span>常规玩法限额 10,000 · 半全场限额 2,000</span></aside></header><div class="prediction-notice"><b>预测规则</b><span>赔率由系统赛前分析生成并含风险折扣，提交后锁定；返还金额包含本金。每场各类别只能投资一次，开赛前2分钟截止。</span></div><div class="prediction-layout"><aside class="prediction-fixture-sidebar"><header><small>UPCOMING</small><h3>待预测比赛</h3><span data-prediction-count>${markets.length}场</span></header><div class="prediction-match-grid" data-prediction-grid>${cards || `<p class="league-empty">下一轮比赛尚未生成，系统会在赛程确定后自动开放预测。</p>`}</div></aside><aside class="prediction-ranking"><header><small>PROFIT RANKING</small><h3>预测收益榜</h3></header><ol data-prediction-ranking>${leaderboard || `<li class="neutral empty"><div><b>暂无玩家</b><small>建立球队后进入排行榜</small></div><strong>0</strong></li>`}</ol><footer>按已结算预测的累计返还减累计投入排序</footer></aside></div></section>`;
}

function openPredictionMarket(marketId) {
  const market = (league.matchPredictions ?? []).find((entry) => entry.id === marketId);
  if (!market) return showToast("找不到这场待预测比赛");
  const categoryMarkup = (category) => {
    const existing = market.myBets?.find((bet) => bet.category === category);
    const categoryTitle = category === "result"
      ? `<h3>${escapeHtml(predictionCategoryLabel(category))}<small>盘口：${escapeHtml(predictionHandicapText(market))}</small></h3>`
      : `<h3>${escapeHtml(predictionCategoryLabel(category))}</h3>`;
    if (existing) return `<section class="prediction-category completed"><header>${categoryTitle}<b>已投资</b></header><div class="prediction-existing"><strong>${escapeHtml(predictionSelectionLabel(market, category, existing.selection))}</strong><span>${predictionPayoutText(existing.payoutRate)} · ${Number(existing.amount).toLocaleString("zh-CN")} 金币</span></div></section>`;
    const categoryOptions = market.options?.[category] ?? [];
    const options = categoryOptions.map((option, index) => `<label><input type="radio" name="selection" value="${escapeHtml(option.id)}" data-payout-rate="${Number(option.payoutRate) || 0}" ${index === 0 ? "checked" : ""} ${market.eligible ? "" : "disabled"}><span>${escapeHtml(option.label)}<small>${predictionPayoutText(option.payoutRate)}</small></span></label>`).join("");
    const maxStake = Number(market.maxStakes?.[category] ?? market.maxStake ?? 0);
    return `<form class="prediction-category" data-prediction-form="${escapeHtml(category)}"><header>${categoryTitle}<b>最多 ${maxStake.toLocaleString("zh-CN")}</b></header><div class="prediction-options">${options}</div><div class="prediction-investment"><label><span>投资金币</span><input type="number" name="amount" min="1" max="${maxStake}" value="100" step="1" ${market.eligible ? "" : "disabled"}></label><button type="submit" class="button primary" ${market.eligible ? "" : "disabled"}>确认预测</button></div></form>`;
  };
  const visibleCategories = ["result", "goals", "cards", "halfFull"].filter((category) => market.options?.[category]?.some((option) => Number.isFinite(Number(option.payoutRate)) && Number(option.payoutRate) > 0));
  const overlay = openLeagueDialog(`<header><div><small>${escapeHtml(market.competitionName)} · ${scheduleTimeText(market.startsAt)}</small><h2>${escapeHtml(market.homeName)} vs ${escapeHtml(market.awayName)}</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="prediction-dialog-body">${market.eligible ? "" : `<p class="prediction-lock-message">${escapeHtml(market.lockedReason ?? "本场不可参与")}</p>`}${visibleCategories.map(categoryMarkup).join("")}<p class="prediction-private-note">半全场按主队视角的45分钟结果和90分钟常规时间结果结算，加时赛与点球大战不计入。显示赔率提交后锁定，命中返还包含投入本金；后台模拟概率不公开。</p></div>`, "prediction-dialog");
  overlay.classList.add("prediction-dialog-overlay");
  overlay.querySelectorAll("[data-prediction-form]").forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const data = new FormData(form);
        await placePrediction({
          marketId:market.id,
          category:form.dataset.predictionForm,
          selection:data.get("selection"),
          amount:Number(data.get("amount")),
        });
        closeLeagueDialog();
        showToast("预测投资已提交");
      } catch (error) {
        submit.disabled = false;
        showToast(error.message);
      }
    };
  });
}

function leagueCupOverviewMarkup() {
  const cup = league.cup ?? { status:"waiting", stage:"waiting", standings:[], leagueRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] } };
  if (cup.status === "waiting") return `<section class="league-cup-overview"><header><div><small>YELLOWDOGS CHAMPION CUP</small><h2>黄狗冠军杯</h2><p>等待管理员在后台开启黄狗冠军杯。</p></div><span>等待开启</span></header><div class="league-cup-empty"><b>10支球队进行9轮单循环联赛，前八名晋级两回合淘汰赛；决赛单场决胜。</b></div></section>`;
  const scoreText = (entry) => entry.score ? `${entry.score[0]} : ${entry.score[1]}${entry.penalties ? ` (${entry.penalties[0]} : ${entry.penalties[1]} 点)` : ""}` : "- : -";
  const leagueStatus = { active:"进行中", qualified:"晋级", eliminated:"淘汰" };
  const leagueRows = cup.standings.map((team) => `<tr class="${team.id === league.ownTeam.id ? "is-own" : ""}"><td>${team.rank}</td><td><button type="button" class="league-team-link" data-league-team-detail="${escapeHtml(team.id)}">${teamBadgeMarkup(team.id)}<span class="league-team-name">${escapeHtml(team.name)}</span>${seasonFinalStarMarkup(team.seasonFinalStarCount)}</button><small class="cup-standing-mobile-meta">${team.played}赛 · ${team.won}胜 ${team.drawn}平 ${team.lost}负 · 进失 ${team.goalsFor}:${team.goalsAgainst} · 净胜 ${team.goalsFor - team.goalsAgainst}</small></td><td>${team.played}</td><td>${team.won}-${team.drawn}-${team.lost}</td><td>${team.goalsFor}:${team.goalsAgainst}</td><td><strong>${team.points}</strong></td><td><small class="cup-team-status status-${team.status ?? "active"}">${leagueStatus[team.status] ?? leagueStatus.active}</small></td></tr>`).join("");
  const leagueRounds = cup.leagueRounds ?? [];
  const leagueRoundNumbers = leagueRounds.map((round) => round.number);
  if (!leagueRoundNumbers.includes(leagueCupRoundPage)) leagueCupRoundPage = leagueRoundNumbers.at(-1) ?? 1;
  const leagueRoundIndex = Math.max(0, leagueRoundNumbers.indexOf(leagueCupRoundPage));
  const selectedLeagueRound = leagueRounds.find((round) => round.number === leagueCupRoundPage);
  const leagueResultRows = selectedLeagueRound?.fixtures.map((fixture) => {
    const canOpen = Boolean(fixture.matchId);
    return `<button type="button" class="league-result cup-result ${canOpen ? "has-player" : ""}" ${canOpen ? `data-league-match-detail="${escapeHtml(fixture.matchId)}"` : "disabled"}><span>第 ${selectedLeagueRound.number} 轮</span><b>${competitionTeamNameMarkup(fixture.homeId, fixture.homeName)}</b><strong>${scoreText(fixture)}</strong><b>${competitionTeamNameMarkup(fixture.awayId, fixture.awayName)}</b><small>${canOpen ? "查看比赛 ›" : "等待开赛"}</small></button>`;
  }).join("") ?? `<p class="league-empty">本轮暂无对阵。</p>`;
  const leagueResults = `<section class="cup-rounds"><header><div><small>LEAGUE STAGE RESULTS</small><h3>联赛阶段第 ${leagueCupRoundPage} 轮${selectedLeagueRound?.status === "complete" ? "赛果" : "对阵"}</h3></div><nav class="league-round-pager"><button class="icon-button" data-cup-round="${leagueRoundNumbers[leagueRoundIndex - 1] ?? ""}" ${leagueRoundIndex <= 0 ? "disabled" : ""} aria-label="上一轮">‹</button><span>${leagueRoundIndex + 1}/${leagueRoundNumbers.length}</span><button class="icon-button" data-cup-round="${leagueRoundNumbers[leagueRoundIndex + 1] ?? ""}" ${leagueRoundIndex >= leagueRoundNumbers.length - 1 ? "disabled" : ""} aria-label="下一轮">›</button></nav></header><div>${leagueResultRows}</div></section>`;
  const stageLabel = { quarterfinals:"四分之一决赛", semifinals:"半决赛", final:"决赛" };
  const tieMarkup = (tie, stage, index) => {
    if (!tie) return `<article class="cup-bracket-tie placeholder"><header><small>${stageLabel[stage]}</small><b>待定</b></header></article>`;
    const aggregate = tie.legs.reduce((total, leg, legIndex) => leg.score ? [total[0] + leg.score[legIndex === 0 ? 0 : 1], total[1] + leg.score[legIndex === 0 ? 1 : 0]] : total, [0, 0]);
    const legs = tie.legs.map((leg) => {
      const canOpen = Boolean(leg.matchId);
      const content = `<small>第${leg.number}回合</small><span>${competitionTeamNameMarkup(leg.homeId, leg.homeName)}</span><b>${scoreText(leg)}</b><span>${competitionTeamNameMarkup(leg.awayId, leg.awayName)}</span>`;
      return canOpen ? `<button type="button" data-league-match-detail="${escapeHtml(leg.matchId)}">${content}</button>` : `<div>${content}</div>`;
    }).join("");
    const winner = tie.teams.find((team) => team.id === tie.winnerId);
    return `<article class="cup-bracket-tie"><header><small>${stageLabel[stage]} ${index + 1}</small><b>${tie.legs.some((leg) => leg.score) ? `${stage === "final" ? "全场比分" : "总比分"} ${aggregate[0]} : ${aggregate[1]}` : "未开赛"}</b></header>${legs}${winner ? `<footer>${stage === "final" ? "冠军" : "晋级"}：${competitionTeamNameMarkup(winner.id, winner.name)}</footer>` : ""}</article>`;
  };
  const quarterfinals = cup.knockout.quarterfinals ?? [];
  const semifinals = cup.knockout.semifinals ?? [];
  const finals = cup.knockout.final ?? [];
  const cupTreePositions = { QF1:[70,90], QF2:[70,265], QF3:[70,440], QF4:[70,615], SF1:[570,177], SF2:[570,527], FINAL:[1100,379] };
  const cupTreeCard = (tie, stage, index, id) => {
    const [x,y] = cupTreePositions[id];
    const isFinal = stage === "final";
    const width = isFinal ? 274 : 260;
    const running = Boolean(tie?.legs?.some((leg) => leg.status === "running"));
    const status = tie?.winnerId ? "complete" : running ? "running" : "pending";
    const statusLabel = tie?.winnerId ? "已结束" : running ? "直播中" : tie ? scheduleTimeText(cup.nextRoundAt ?? Date.now(), false) : "";
    const legRow = (legIndex) => {
      const leg = tie?.legs?.[legIndex];
      const label = isFinal ? "比赛" : legIndex === 0 ? "首回合" : "次回合";
      const score = leg?.score ? `${leg.score[0]}:${leg.score[1]}${leg.penalties ? ` (${leg.penalties[0]}:${leg.penalties[1]})` : ""}` : leg ? "VS" : "";
      const row = `<i>${label}</i><span class="${leg && tie?.winnerId === leg.homeId ? "is-tie-winner" : ""}">${leg ? competitionTeamNameMarkup(leg.homeId, leg.homeName) : ""}</span><b>${score}</b><span class="${leg && tie?.winnerId === leg.awayId ? "is-tie-winner" : ""}">${leg ? competitionTeamNameMarkup(leg.awayId, leg.awayName) : ""}</span>`;
      return leg?.matchId
        ? `<button type="button" class="cup-tree-leg-row" data-league-match-detail="${escapeHtml(leg.matchId)}">${row}</button>`
        : `<div class="cup-tree-leg-row ${leg ? "" : "is-empty"}">${row}</div>`;
    };
    const legRows = Array.from({ length:isFinal ? 1 : 2 }, (_, legIndex) => legRow(legIndex)).join("");
    const card = `<div class="sf-match-card ${isFinal ? "sf-match-card-final is-single-leg" : "sf-match-card-winner is-two-leg"} cup-tree-card"><header><span>${escapeHtml(stageLabel[stage])} ${index + 1}</span>${statusLabel ? `<em class="status-${status}">${statusLabel}</em>` : ""}</header><section class="cup-tree-leg-list">${legRows}</section></div>`;
    return `<foreignObject x="${x}" y="${y}" width="${width}" height="${isFinal ? 88 : 142}" class="sf-svg-fo cup-tree-fo">${card}</foreignObject>`;
  };
  const cupTreeCards = [
    ...[0,1,2,3].map((index) => cupTreeCard(quarterfinals[index], "quarterfinals", index, `QF${index + 1}`)),
    ...[0,1].map((index) => cupTreeCard(semifinals[index], "semifinals", index, `SF${index + 1}`)),
    cupTreeCard(finals[0], "final", 0, "FINAL"),
  ].join("");
  const cupTreeRoutes = [
    "M330 159 H430 V334 H330", "M430 246 H570",
    "M330 509 H430 V684 H330", "M430 596 H570",
    "M830 246 H930 V596 H830", "M930 421 H1100",
  ].map((path, index) => `<path class="${index === 5 ? "sf-route-final" : "sf-route-upper"}" d="${path}"/>`).join("");
  const cupChampion = cup.championName ? `<foreignObject x="1100" y="520" width="274" height="70" class="sf-champion-fo"><div class="sf-champion"><span>CUP CHAMPION</span><b>${competitionTeamNameMarkup(cup.championId, cup.championName)}</b></div></foreignObject>` : "";
  const bracket = `<section class="cup-bracket cup-bracket-tree"><header class="cup-bracket-heading"><small>KNOCKOUT BRACKET</small><h2>黄狗冠军杯淘汰赛</h2><p>八强和半决赛两回合，决赛单场决胜。</p></header><section class="cup-tree-wrap"><svg class="cup-tree" viewBox="0 0 1480 830" role="img" aria-label="黄狗冠军杯淘汰赛对阵图"><rect class="cup-tree-band" x="28" y="48" width="970" height="736" rx="18"/><rect class="cup-tree-final-stage" x="1048" y="120" width="378" height="560" rx="20"/><text class="sf-svg-title sf-svg-upper-title" x="70" y="38">QUARTERFINALS · 四分之一决赛</text><text class="sf-svg-title sf-svg-upper-title" x="570" y="126">SEMIFINALS · 半决赛</text><text class="sf-svg-title sf-svg-final-title" x="1100" y="174">GRAND FINAL · 决赛</text><g class="sf-route-layer">${cupTreeRoutes}</g>${cupTreeCards}${cupChampion}</svg></section></section>`;
  const body = leagueCupPage === "league" ? `<div class="cup-swiss"><section class="league-panel"><header><div><small>LEAGUE STAGE · 9 ROUNDS</small><h2>联赛阶段积分榜</h2></div><b>${cup.standings.filter((team) => team.status === "qualified").length}/8 晋级</b></header><table class="league-table cup-standings-table"><thead><tr><th>#</th><th>球队</th><th>赛</th><th>胜-平-负</th><th>进失</th><th>分</th><th>状态</th></tr></thead><tbody>${leagueRows}</tbody></table></section>${leagueResults}</div>` : bracket;
  return `<section class="league-cup-overview active-cup"><header><div><small>YELLOWDOGS CHAMPION CUP</small><h2>${cup.championName ? `${cup.championName} 获得黄狗冠军杯冠军` : "黄狗冠军杯"}</h2><p>${cup.nextRoundAt ? `下一阶段预计 ${scheduleTimeText(cup.nextRoundAt)}` : cup.status === "completed" ? "本届黄狗冠军杯已结束" : "比赛进行中"}</p></div><span>${cup.stage}</span></header><nav class="cup-tabs"><button data-cup-page="league" class="${leagueCupPage === "league" ? "active" : ""}">联赛阶段</button><button data-cup-page="knockout" class="${leagueCupPage === "knockout" ? "active" : ""}">淘汰赛</button></nav>${body}</section>`;
}

function seasonFinalTournamentMarkup() {
  const tournament = league.seasonFinalTournament;
  if (!tournament) return `<section class="season-final-page season-final-empty"><header><small>SEASON FINAL TOURNAMENT</small><h2>赛季总决赛</h2><p>当前赛季总决赛对阵图将在赛事数据准备后显示。</p></header></section>`;
  const nodeById = Object.fromEntries((tournament.bracket ?? []).map((node) => [node.id, node]));
  const nodeMarkup = (id) => {
    const node = nodeById[id];
    if (!node) return "";
    const score = node.score ? `${node.score[0]} : ${node.score[1]}` : node.status === "running" ? "进行中" : "";
    const canOpen = node.matchIds?.at(-1);
    const slotLabel = (source, displayName) => displayName && displayName !== "待定" ? displayName : (tournament.seedSnapshot?.find((entry) => entry.teamId === source)?.seed ? `${tournament.seedSnapshot.find((entry) => entry.teamId === source).seed}号种子` : source?.includes?.(".") ? source.replace(".winner", "胜者").replace(".loser", "负者") : (source ?? ""));
    const sourceLabel = (source) => { const match = String(source ?? "").match(/^([A-Z0-9-]+)\.(winner|loser)$/); return match ? `来自 ${match[1]}${match[2] === "winner" ? "胜者" : "负者"}` : ""; };
    const links = [sourceLabel(node.home), sourceLabel(node.away)].filter(Boolean);
    const body = `<small>${escapeHtml(node.id)} · ${node.status === "complete" ? "已结束" : node.status === "running" ? "进行中" : "待开赛"}</small>${links.length ? `<em class="season-final-node-links">${links.map((link) => escapeHtml(link)).join(" · ")}</em>` : ""}<div class="season-final-teams"><span class="season-final-team-slot">${escapeHtml(slotLabel(node.home, node.homeName))}</span><span class="season-final-score">${escapeHtml(score)}</span><span class="season-final-team-slot">${escapeHtml(slotLabel(node.away, node.awayName))}</span></div>${node.winner ? `<footer>晋级：${escapeHtml(tournament.seedSnapshot.find((entry) => entry.teamId === node.winner)?.teamName ?? node.winner)}</footer>` : ""}`;
    return canOpen ? `<button type="button" class="season-final-node ${node.group}" data-league-match-detail="${escapeHtml(canOpen)}">${body}</button>` : `<article class="season-final-node ${node.group}">${body}</article>`;
  };
  const seedRows = tournament.seedSnapshot.map((seed) => `<li class="${seed.isAi ? "ai" : ""}"><b>${seed.seed}</b><span>${escapeHtml(seed.teamName)}</span><small>联赛 ${seed.leagueRank} (${seed.leaguePoints}) · 杯赛 ${escapeHtml(seed.cupStage)} (${seed.cupPoints})</small><strong>${seed.compositeScore.toFixed(1)}</strong></li>`).join("");
  const final = tournament.finalTie ?? {};
  const champion = final.championId ? tournament.seedSnapshot.find((entry) => entry.teamId === final.championId)?.teamName : null;
  const statusText = tournament.preview ? "对阵图已生成，球队种子将在杯赛决赛结束时按最近已完成的联赛轮次锁定。" : tournament.status === "scheduled" ? `第${tournament.leagueSnapshotRound ?? "最近"}轮排名与杯赛成绩已锁定，赛程以杯赛决赛实际开球时间为锚点。` : tournament.status === "completed" ? "双败赛程和两回合最终决赛均已结束。" : "赛事正在推进，后续对阵将在前置比赛结束后确认。";
  const finalBan = tournament.finalBan;
  const banSelect = (field, line, label) => {
    const candidates = (finalBan?.candidates ?? []).filter((player) => player.line === line);
    return `<label><span>${label}</span><select name="${field}" ${finalBan?.locked ? "disabled" : ""}><option value="">请选择</option>${candidates.map((player) => `<option value="${escapeHtml(player.id)}" ${finalBan.selection?.[field] === player.id ? "selected" : ""}>${escapeHtml(player.name)} · ${escapeHtml(ROLE_LABELS[player.role] ?? player.role)} · ${player.overall}</option>`).join("")}</select></label>`;
  };
  const finalBanMarkup = finalBan ? `<section class="season-final-ban"><header><div><small>GRAND FINAL BAN</small><h3>${escapeHtml(finalBan.nodeId)} · 禁用 ${escapeHtml(finalBan.opponentTeamName)} 球员</h3></div><span>${finalBan.locked ? `已截止 · ${scheduleTimeText(finalBan.deadlineAt, false)}` : finalBan.submitted ? `已提交 · ${scheduleTimeText(finalBan.deadlineAt, false)} 截止` : `${scheduleTimeText(finalBan.deadlineAt, false)} 截止`}</span></header><form data-season-final-ban>${banSelect("forward", "ATT", "前锋")}${banSelect("midfield", "MID", "中场")}${banSelect("defense", "DEF", "后卫")}<button type="submit" class="button primary" ${finalBan.locked ? "disabled" : ""}>${finalBan.submitted ? "更新禁用名单" : "提交禁用名单"}</button></form><p>双方各从对手可用阵容中禁用一名前锋、一名中场和一名后卫；截止后未提交的名单由系统自动选择，并沿用至第二回合。</p></section>` : "";
  const svgPositions = { W1:[70,105], W2:[500,105], B1:[70,350], B2:[70,510], B3:[70,670], B4:[410,650], B5:[410,430], B6:[750,540], B7:[1010,540], B8:[1270,540], "FINAL-1":[1675,240], "FINAL-2":[1675,430] };
  const stageLabels = { W1:"胜者组第一轮", W2:"胜者组决赛", B1:"败者组第一轮", B2:"败者组第一轮", B3:"败者组第一轮", B4:"败者组第二轮", B5:"败者组第二轮", B6:"败者组第三轮", B7:"败者组半决赛", B8:"败者组决赛", "FINAL-1":"最终决赛 · 首回合", "FINAL-2":"最终决赛 · 次回合" };
  const sourceTeamId = (source) => {
    const match = String(source ?? "").match(/^([A-Z0-9-]+)\.(winner|loser)$/);
    return match ? nodeById[match[1]]?.[match[2]] ?? null : source;
  };
  const svgSlot = (source, displayName) => {
    if (displayName && displayName !== "待定") return displayName;
    const match = String(source ?? "").match(/^([A-Z0-9-]+)\.(winner|loser)$/);
    if (match) return "";
    return tournament.seedSnapshot?.find((entry) => entry.teamId === source)?.teamName ?? "待定";
  };
  const svgCard = (id) => {
    const node = nodeById[id]; if (!node) return "";
    const [x,y] = svgPositions[id];
    const width = node.group === "final" ? 274 : 244;
    const participantRow = (source, displayName, teamIndex) => {
      const teamId = sourceTeamId(source);
      if (String(source ?? "").includes(".") && !teamId) return `<span class="sf-match-team is-empty" aria-hidden="true"></span>`;
      const seed = tournament.seedSnapshot?.find((entry) => entry.teamId === teamId)?.seed;
      const isWinner = Boolean(node.winner && node.winner === teamId);
      const teamScore = node.score ? node.score[teamIndex] : null;
      return `<span class="sf-match-team ${isWinner ? "is-winner" : ""}"><i>${seed ? `#${seed}` : "—"}</i><strong>${escapeHtml(svgSlot(source, displayName))}</strong><b>${teamScore ?? "–"}</b></span>`;
    };
    const statusLabel = node.status === "complete" ? "已结束" : node.status === "running" ? "直播中" : node.startsAt != null ? scheduleTimeText(node.startsAt, false) : "";
    const card = `<div class="sf-match-card sf-match-card-${node.group}"><header><span>${escapeHtml(stageLabels[id] ?? id)}</span><em class="status-${node.status}">${statusLabel}</em></header><div>${participantRow(node.home, node.homeName, 0)}${participantRow(node.away, node.awayName, 1)}</div><footer><span>${escapeHtml(id)}</span></footer></div>`;
    const contents = node.matchIds?.at(-1) ? `<button type="button" data-league-match-detail="${escapeHtml(node.matchIds.at(-1))}" aria-label="查看${escapeHtml(stageLabels[id])}比赛详情">${card}</button>` : card;
    return `<foreignObject x="${x}" y="${y}" width="${width}" height="142" class="sf-svg-fo">${contents}</foreignObject>`;
  };
  const routeLines = [
    ["M314 176 H500","sf-route-upper"],
    ["M744 176 H1625 V297 H1675","sf-route-upper"],
    ["M314 421 H360 V581 H314","sf-route-lower"],
    ["M360 501 H410","sf-route-lower"],
    ["M314 741 H410","sf-route-lower"],
    ["M654 501 H700 V711 H654","sf-route-lower"],
    ["M700 606 H750","sf-route-lower"],
    ["M994 611 H1010","sf-route-lower"],
    ["M1254 611 H1270","sf-route-lower"],
    ["M1514 611 H1635 V343 H1675","sf-route-final"],
    ["M192 247 V304 H1132 V540","sf-route-drop"],
    ["M622 247 V316 H1392 V540","sf-route-drop"],
    ["M1812 382 V430","sf-route-leg"],
  ].map(([path, cls]) => `<path class="${cls}" d="${path}"/>`).join("");
  const championDisplay = champion ? `<foreignObject x="1675" y="589" width="274" height="70" class="sf-champion-fo"><div class="sf-champion"><span>SEASON CHAMPION</span><b>${escapeHtml(champion)}</b></div></foreignObject>` : "";
  return `<section class="season-final-page"><header class="season-final-hero"><div><small>SEASON FINAL TOURNAMENT</small><h2>${champion ? `${escapeHtml(champion)} 获得赛季总决赛冠军` : "赛季总决赛"}</h2><p>${statusText}</p></div><aside><small>赛事状态</small><b>${tournament.preview ? "种子待定" : escapeHtml(tournament.status)}</b><span>${tournament.nextMatchAt ? scheduleTimeText(tournament.nextMatchAt) : tournament.status === "completed" ? "赛程已结束" : "比赛进行中"}</span></aside></header>${finalBanMarkup}<section class="season-final-map-head"><div><span class="upper"></span><b>胜者组</b><small>保持不败，直通最终决赛</small></div><div><span class="lower"></span><b>败者组</b><small>第二次失利即被淘汰</small></div><p>横向滚动查看完整赛程 →</p></section><section class="season-final-svg-wrap"><svg class="season-final-svg" viewBox="0 0 2025 850" role="img" aria-label="赛季总决赛双败赛制对阵图"><defs><linearGradient id="sf-final-stage" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#211f10"/><stop offset="1" stop-color="#0b1712"/></linearGradient><filter id="sf-final-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect class="sf-bracket-band sf-bracket-band-upper" x="28" y="62" width="1570" height="224" rx="18"/><rect class="sf-bracket-band sf-bracket-band-lower" x="28" y="310" width="1570" height="510" rx="18"/><rect class="sf-final-stage" x="1645" y="157" width="334" height="536" rx="20"/><text class="sf-svg-title sf-svg-upper-title" x="58" y="48">UPPER BRACKET · 胜者组</text><text class="sf-svg-title sf-svg-lower-title" x="58" y="334">LOWER BRACKET · 败者组</text><text class="sf-svg-title sf-svg-final-title" x="1675" y="203">GRAND FINAL · 最终决赛</text><text class="sf-svg-round-label" x="70" y="92">ROUND 1</text><text class="sf-svg-round-label" x="500" y="92">UPPER FINAL</text><text class="sf-svg-round-label" x="70" y="838">ROUND 1</text><text class="sf-svg-round-label" x="410" y="838">ROUND 2</text><text class="sf-svg-round-label" x="750" y="838">ROUND 3</text><text class="sf-svg-round-label" x="1010" y="838">LOWER SEMI</text><text class="sf-svg-round-label" x="1270" y="838">LOWER FINAL</text><g class="sf-route-layer">${routeLines}</g>${["W1","W2","B1","B2","B3","B4","B5","B6","B7","B8","FINAL-1","FINAL-2"].map(svgCard).join("")}${championDisplay}</svg></section></section>`;
  return `<section class="season-final-page"><header class="season-final-hero"><div><small>SEASON FINAL TOURNAMENT</small><h2>${champion ? `${escapeHtml(champion)} 获得赛季总决赛冠军` : "赛季总决赛"}</h2><p>${statusText}</p></div><aside><small>赛事状态</small><b>${tournament.preview ? "种子待定" : escapeHtml(tournament.status)}</b><span>${tournament.nextMatchAt ? scheduleTimeText(tournament.nextMatchAt) : "赛程已结束"}</span></aside></header><section class="season-final-seeds"><header><div><small>COMPOSITE SEEDING</small><h3>综合种子</h3></div><span>联赛 60% · 杯赛 40%</span></header><ol>${seedRows}</ol></section><section class="season-final-bracket"><svg class="season-final-connectors" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="sf-arrow-blue" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#62b6ff"/></marker><marker id="sf-arrow-red" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#ff7777"/></marker></defs><g class="sf-line-blue" marker-end="url(#sf-arrow-blue)"><path d="M145 100 H330"/><path d="M145 120 H260 V100 H330"/><path d="M430 100 H560"/></g><g class="sf-line-red" marker-end="url(#sf-arrow-red)"><path d="M145 360 H225 V405 H330"/><path d="M145 435 H225 V405 H330"/><path d="M145 510 H225 V470 H330"/><path d="M430 405 H540 V455 H650"/><path d="M430 470 H540 V455 H650"/><path d="M750 455 H850"/></g><g class="sf-line-drop"><path d="M365 135 V330"/><path d="M585 135 V390"/><path d="M805 135 V425"/></g></svg><section class="season-final-lane winner"><header><small>WINNER BRACKET</small><h3>胜者组</h3></header><div>${["W1", "W2"].map(nodeMarkup).join("")}</div></section><section class="season-final-lane loser"><header><small>LOSER BRACKET</small><h3>败者组</h3></header><div>${["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"].map(nodeMarkup).join("")}</div></section><section class="season-final-lane final"><header><small>GRAND FINAL · TWO LEGS</small><h3>最终决赛</h3></header><div>${nodeMarkup("FINAL-1")}${nodeMarkup("FINAL-2")}<aside><span>胜者组冠军</span><b>${escapeHtml(final.winnerBracketChampionName ?? "待定")}</b><span>败者组冠军</span><b>${escapeHtml(final.loserBracketChampionName ?? "待定")}</b>${final.aggregateScore ? `<strong>总比分 ${final.aggregateScore[0]} : ${final.aggregateScore[1]}</strong>` : ""}</aside></div></section></section></section>`;
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
  if (player.state?.seasonFinalBanned) return "赛季总决赛禁用";
  if (player.state?.seasonFinalSuspension) return `赛季总决赛停赛 ${player.state.seasonFinalSuspension}轮`;
  if (player.state?.suspension) return `停赛 ${player.state.suspension}轮`;
  if (player.state?.injuryRounds) return `伤缺 ${player.state.injuryRounds}轮`;
  return `体能 ${Math.round(player.effectiveFitness ?? player.state?.fitness ?? player.fitness ?? 100)}`;
}

function leagueMagnetAvailabilityMarkup(player) {
  if (player.state?.seasonFinalBanned) return `<span class="league-magnet-ban" aria-label="赛季总决赛禁用">禁用</span>`;
  return "";
}

function leaguePlayerUnavailable(player) {
  return Boolean(player.state?.seasonFinalBanned || player.state?.seasonFinalSuspension || player.state?.suspension || player.state?.injuryRounds);
}

function leaguePlayerTooltip(player, assignedRole = player.role) {
  const assignedGroup = assignedRole === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(assignedRole) ? "DEF" : ["ST", "LW", "RW"].includes(assignedRole) ? "ATT" : "MID";
  const keys = LEAGUE_ROLE_CORE_ATTRIBUTES[assignedGroup];
  const attributes = keys.map((key) => `${STAT_LABELS[key] ?? key} ${Math.round(player.effectiveAttributes?.[key] ?? player.attributes?.[key] ?? 0)}`).join(" · ");
  const representativeCard = player.cards?.find((card) => card.id === player.activeCardId) ?? player.cards?.[0] ?? null;
  const enhancementTraits = (representativeCard?.traits ?? []).map((trait) => `\n${trait.name}：${trait.summary ?? "强化获得的YDL特性"}`).join("");
  return `${player.nationality ?? ""}${player.club ? ` · ${player.club}` : ""}\n综合能力：${player.effectiveOverall ?? player.overall}${player.upgradeLevel ? `（基础 ${player.baseOverall ?? player.overall}，强化 +${player.upgradeLevel}）` : ""}\n主位置：${ROLE_LABELS[player.role] ?? player.role} · 副位置：${ROLE_LABELS[player.secondaryRole] ?? "无"}\n当前位置：${ROLE_LABELS[assignedRole] ?? assignedRole}\n身高：${Math.round(player.effectiveHeightCm ?? player.heightCm ?? 0)}cm · ${leaguePlayerStatus(player)}\n${attributes}${enhancementTraits}`;
}

function leagueMagnetFitnessMarkup(fitnessValue) {
  const fitness = Math.max(0, Math.min(100, Math.round(Number(fitnessValue) || 0)));
  const threshold = normalizeLeagueFitnessThreshold(ensureLeagueTacticalDraft().fitnessThreshold, 65);
  const low = fitness < threshold;
  return `<span class="league-magnet-fitness ${low ? "is-below-threshold" : "is-above-threshold"}" data-magnet-fitness="${fitness}" aria-label="体力 ${fitness}，${low ? `低于红线 ${threshold}` : `达到红线 ${threshold}`}"><span style="width:${fitness}%"></span></span>`;
}

function refreshLeagueMagnetFitnessColors(thresholdValue) {
  const threshold = normalizeLeagueFitnessThreshold(thresholdValue, ensureLeagueTacticalDraft().fitnessThreshold);
  app.querySelectorAll("#league-squad-form [data-magnet-fitness]").forEach((bar) => {
    const low = Number(bar.dataset.magnetFitness) < threshold;
    bar.classList.toggle("is-below-threshold", low);
    bar.classList.toggle("is-above-threshold", !low);
    bar.setAttribute("aria-label", `体力 ${bar.dataset.magnetFitness}，${low ? `低于红线 ${threshold}` : `达到红线 ${threshold}`}`);
  });
}

function leaguePlanStateForPositionPreset(positionPreset = leagueActivePositionPreset) {
  return { position1:"opening", position2:"leading", position3:"trailing" }[positionPreset] ?? "opening";
}

function leaguePlayerDutySelection(playerId, assignedRole, state = leaguePlanStateForPositionPreset()) {
  const dutyId = ensureLeagueTacticalDraft().tacticalPlans[state]?.playerDuties?.[playerId] ?? "";
  return v2PlayerDutyOptionsForRole(assignedRole).some((option) => option.id === dutyId) ? dutyId : "";
}

function leagueMagnetDutyMarkup(playerId, assignedRole) {
  const state = leaguePlanStateForPositionPreset();
  if (assignedRole === "GK") return `<span class="league-magnet-duty is-static" aria-label="固定职责：门线门将"><b>门线门将</b></span>`;
  const options = v2PlayerDutyOptionsForRole(assignedRole);
  if (options.length <= 1) return "";
  const selectedId = leaguePlayerDutySelection(playerId, assignedRole, state);
  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  const shared = `data-league-duty-player="${escapeHtml(playerId)}" data-league-duty-role="${escapeHtml(assignedRole)}" data-league-duty-state="${state}"`;
  return `<span class="league-magnet-duty" ${shared} aria-label="当前职责：${escapeHtml(selected.label)}"><span role="button" tabindex="0" data-league-duty-step="-1" ${shared} aria-label="上一个职责">‹</span><b data-league-duty-label>${escapeHtml(selected.label)}</b><span role="button" tabindex="0" data-league-duty-step="1" ${shared} aria-label="下一个职责">›</span></span>`;
}

function leagueMagnetPreviewMarkup(playerId, assignedRole) {
  const options = v2PlayerDutyOptionsForRole(assignedRole);
  const selectedId = leaguePlayerDutySelection(playerId, assignedRole, leaguePlanStateForPositionPreset());
  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  const dutyLabel = selected?.label ?? "默认职责";
  return `<span class="league-tactical-preview-position" aria-hidden="true">${escapeHtml(assignedRole)}</span><span class="league-tactical-preview-duty" aria-hidden="true">${escapeHtml(dutyLabel)}</span>`;
}


function fieldRoleAbbreviation(role) {
  const raw = String(role ?? "").trim();
  const matchedCode = Object.entries(ROLE_LABELS).find(([code, label]) => code === raw.toUpperCase() || label === raw)?.[0];
  return String(matchedCode ?? raw).toUpperCase();
}
function captainBadgeMarkup(visible) {
  return visible ? `<span class="captain-c-badge" aria-label="队长" title="队长">C</span>` : "";
}

function leagueBoardMagnet(player, position, assignedRole) {
  const fit = positionFit(player, assignedRole);
  const tooltip = leaguePlayerTooltip(player, assignedRole);
  const upgrade = Number(player.upgradeLevel ?? 0);
  const fitness = Math.max(0, Math.min(100, Math.round(player.effectiveFitness ?? player.state.fitness ?? 0)));
  return `<div class="magnet league-squad-magnet grade-${player.grade.toLowerCase()} fit-${fit} ${leaguePlayerUnavailable(player) ? "unavailable" : ""}" role="group" tabindex="0" aria-label="${escapeHtml(player.name)}，${ROLE_LABELS[assignedRole] ?? assignedRole}" data-league-magnet="${player.id}" data-assigned-role="${escapeHtml(assignedRole)}" data-primary-role="${escapeHtml(player.role ?? "")}" data-secondary-role="${escapeHtml(player.secondaryRole ?? "")}" data-traits="${escapeHtml(tooltip)}" style="left:${position.x}%;top:${position.y}%">${captainBadgeMarkup(player.id === ensureLeagueTacticalDraft().captainId)}${leagueMagnetAvailabilityMarkup(player)}<span class="league-magnet-role">${ROLE_LABELS[assignedRole] ?? assignedRole}</span><b>${escapeHtml(player.name)}</b><i>${player.effectiveOverall ?? player.overall}</i>${leagueMagnetFitnessMarkup(fitness)}${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}${leagueMagnetDutyMarkup(player.id, assignedRole)}${leagueMagnetPreviewMarkup(player.id, assignedRole)}</div>`;
}

function leagueMobileDutySheetMarkup() {
  if (!leagueMobileDutyPlayerId) return "";
  const team = activeTacticsTeam();
  const player = team.roster.find((candidate) => candidate.id === leagueMobileDutyPlayerId);
  const assignedRole = document.querySelector(`[data-league-magnet="${CSS.escape(leagueMobileDutyPlayerId)}"]`)?.dataset.assignedRole
    ?? formationFromPositions(team.roster.filter((candidate) => leagueStartingIds.includes(candidate.id)), leaguePositions, { formationLines:leagueFormationLinePresets?.[leagueActivePositionPreset] }).roles[leagueMobileDutyPlayerId]
    ?? player?.role;
  if (!player || !assignedRole) return "";
  const state = leaguePlanStateForPositionPreset();
  const phaseLabel = { opening:"默认战术", leading:"领先战术", trailing:"落后战术" }[state];
  const options = assignedRole === "GK"
    ? [{ id:"", label:"门线门将", description:"当前版本的门将固定执行门线防守，不设置专项职责。" }]
    : v2PlayerDutyOptionsForRole(assignedRole);
  const selectedId = assignedRole === "GK" ? "" : leaguePlayerDutySelection(player.id, assignedRole, state);
  const selected = options.find((option) => option.id === selectedId) ?? options[0];
  const shared = `data-league-duty-player="${escapeHtml(player.id)}" data-league-duty-role="${escapeHtml(assignedRole)}" data-league-duty-state="${state}"`;
  return `<div class="league-mobile-duty-backdrop" data-league-duty-backdrop><section class="league-mobile-duty-sheet" data-league-duty-sheet role="dialog" aria-modal="true" aria-label="设置球员职责"><header><div><small>${phaseLabel} · ${ROLE_LABELS[assignedRole] ?? assignedRole}</small><b>${escapeHtml(player.name)}</b></div><button type="button" data-league-duty-close aria-label="关闭职责面板">×</button></header><div class="league-mobile-duty-selector"><button type="button" data-league-duty-step="-1" ${shared} ${assignedRole === "GK" ? "disabled" : ""} aria-label="上一个职责">‹</button><div><small>当前职责</small><b data-league-duty-label>${escapeHtml(selected.label)}</b><p data-league-duty-description>${escapeHtml(selected.description)}</p></div><button type="button" data-league-duty-step="1" ${shared} ${assignedRole === "GK" ? "disabled" : ""} aria-label="下一个职责">›</button></div><footer>职责只应用于${phaseLabel}；切换站位页可分别设置另外两个阶段。</footer></section></div>`;
}

function openLeagueMobileDutySheet(playerId) {
  leagueMobileDutyPlayerId = playerId;
  document.querySelector(".league-mobile-duty-backdrop")?.remove();
  const markup = leagueMobileDutySheetMarkup();
  if (markup) document.querySelector(".league-squad-page")?.insertAdjacentHTML("beforeend", markup);
}

function closeLeagueMobileDutySheet() {
  leagueMobileDutyPlayerId = null;
  document.querySelector(".league-mobile-duty-backdrop")?.remove();
}

function stepLeaguePlayerDuty(playerId, assignedRole, state, direction) {
  if (!playerId || assignedRole === "GK") return;
  const options = v2PlayerDutyOptionsForRole(assignedRole);
  if (options.length <= 1) return;
  const plan = ensureLeagueTacticalDraft().tacticalPlans[state] ?? ensureLeagueTacticalDraft().tacticalPlans.opening;
  plan.playerDuties ??= {};
  const currentId = leaguePlayerDutySelection(playerId, assignedRole, state);
  const currentIndex = Math.max(0, options.findIndex((option) => option.id === currentId));
  const next = options[(currentIndex + Number(direction) + options.length) % options.length];
  if (next.id) plan.playerDuties[playerId] = next.id;
  else delete plan.playerDuties[playerId];
  leagueEditorDirty = true;
  document.querySelectorAll("[data-league-duty-player]").forEach((control) => {
    if (control.dataset.leagueDutyPlayer !== playerId || control.dataset.leagueDutyState !== state) return;
    control.setAttribute("aria-label", `当前职责：${next.label}`);
    const label = control.querySelector?.("[data-league-duty-label]");
    if (label) label.textContent = next.label;
  });
  if (leagueMobileDutyPlayerId === playerId) {
    const current = document.querySelector(".league-mobile-duty-backdrop");
    const template = document.createElement("template");
    template.innerHTML = leagueMobileDutySheetMarkup().trim();
    if (current && template.content.firstElementChild) current.replaceWith(template.content.firstElementChild);
  }
  scheduleLeagueTeamAutoSave(180);
}

function leagueGuidancePositionFitValue(player, assignedRole) {
  return { primary:1, secondary:.9, unfamiliar:.66 }[positionFit(player, assignedRole)] ?? .66;
}

function leagueLineupPositionFitPercent(playerIds, positions, formationLines) {
  const roster = activeTacticsTeam().roster;
  const players = playerIds.map((id) => roster.find((player) => player.id === id)).filter(Boolean);
  const roles = formationFromPositions(players, positions, { formationLines }).roles;
  return Math.round(players.reduce((sum, player) => sum + leagueGuidancePositionFitValue(player, roles[player.id]), 0) / Math.max(1, players.length) * 100);
}

function automaticallyOptimizeLeagueLineup() {
  const team = activeTacticsTeam();
  const roster = team.roster;
  const sourceStarterIds = [...leagueStartingIds];
  const canUseBench = leagueActivePositionPreset === "position1";
  const activePositions = leaguePositionPresets[leagueActivePositionPreset];
  const activeLines = leagueFormationLinePresets[leagueActivePositionPreset];
  const currentPlayers = sourceStarterIds.map((id) => roster.find((player) => player.id === id)).filter(Boolean);
  const activeRoles = formationFromPositions(currentPlayers, activePositions, { formationLines:activeLines }).roles;
  const slots = sourceStarterIds.map((playerId) => ({ playerId, role:activeRoles[playerId] }));
  const candidates = canUseBench ? roster : currentPlayers;
  const assignments = v2OptimalLineupAssignment(slots, candidates, (player, slot) => {
    const unavailable = leaguePlayerUnavailable(player);
    const fit = leagueGuidancePositionFitValue(player, slot.role);
    const overall = Number(player.effectiveOverall ?? player.overall ?? 0);
    const fitness = Number(player.effectiveFitness ?? player.state?.fitness ?? 0);
    return (unavailable ? -10_000_000 : 0) + fit * 100_000 + overall * 100 + fitness;
  });
  if (assignments.length !== sourceStarterIds.length) return showToast("当前名单不足，无法完成自动替换");
  const nextStarterIds = assignments.map((assignment) => assignment.player.id);
  const slotPlayerMap = new Map(assignments.map((assignment) => [assignment.slot.playerId, assignment.player.id]));
  const beforeFit = leagueLineupPositionFitPercent(sourceStarterIds, activePositions, activeLines);
  const sourcePresets = structuredClone(leaguePositionPresets);
  const sourceDuties = Object.fromEntries(Object.entries(ensureLeagueTacticalDraft().tacticalPlans).map(([state, plan]) => [state, structuredClone(plan.playerDuties ?? {})]));
  const stateByPreset = { position1:"opening", position2:"leading", position3:"trailing" };
  const applyAssignmentToPreset = (preset) => {
    const positions = sourcePresets[preset];
    const oldPlayers = sourceStarterIds.map((id) => roster.find((player) => player.id === id)).filter(Boolean);
    const oldRoles = formationFromPositions(oldPlayers, positions, { formationLines:leagueFormationLinePresets[preset] }).roles;
    leaguePositionPresets[preset] = Object.fromEntries(sourceStarterIds.map((oldPlayerId) => {
      const nextPlayerId = slotPlayerMap.get(oldPlayerId);
      return [nextPlayerId, structuredClone(positions[oldPlayerId] ?? { x:50, y:50 })];
    }));
    const state = stateByPreset[preset];
    const nextDuties = {};
    sourceStarterIds.forEach((oldPlayerId) => {
      const dutyId = sourceDuties[state]?.[oldPlayerId];
      const assignedRole = oldRoles[oldPlayerId];
      if (dutyId && v2PlayerDutyOptionsForRole(assignedRole, { includeDefault:false }).some((option) => option.id === dutyId)) nextDuties[slotPlayerMap.get(oldPlayerId)] = dutyId;
    });
    ensureLeagueTacticalDraft().tacticalPlans[state].playerDuties = nextDuties;
  };
  if (canUseBench) {
    Object.keys(sourcePresets).forEach(applyAssignmentToPreset);
    leagueStartingIds = nextStarterIds;
  } else applyAssignmentToPreset(leagueActivePositionPreset);
  leaguePositions = leaguePositionPresets[leagueActivePositionPreset];
  leagueMobileDutyPlayerId = null;
  const afterFit = leagueLineupPositionFitPercent(leagueStartingIds, leaguePositions, activeLines);
  const previousStarterSet = new Set(sourceStarterIds);
  const replacements = canUseBench ? nextStarterIds.filter((id) => !previousStarterSet.has(id)).length : 0;
  const rearrangements = assignments.filter((assignment) => assignment.player.id !== assignment.slot.playerId && previousStarterSet.has(assignment.player.id)).length;
  leagueEditorDirty = true;
  renderLeague();
  scheduleLeagueTeamAutoSave(180);
  if (canUseBench) showToast(`默认站位指导完成：适配度 ${beforeFit} → ${afterFit}，替补更换 ${replacements} 人，场上调整 ${rearrangements} 人`);
  else {
    const phaseLabel = leagueActivePositionPreset === "position2" ? "领先" : "落后";
    showToast(`${phaseLabel}站位指导完成：适配度 ${beforeFit} → ${afterFit}，仅重排默认首发 ${rearrangements} 人`);
  }
}

function automaticallyAdaptLeagueDuties() {
  const team = activeTacticsTeam();
  const players = leagueStartingIds.map((id) => team.roster.find((player) => player.id === id)).filter(Boolean);
  const roles = formationFromPositions(players, leaguePositions, { formationLines:leagueFormationLinePresets[leagueActivePositionPreset] }).roles;
  const recommendations = v2RecommendedPlayerDuties(players, roles, (player, role) => leagueGuidancePositionFitValue(player, role));
  const state = leaguePlanStateForPositionPreset();
  ensureLeagueTacticalDraft().tacticalPlans[state].playerDuties = Object.fromEntries(Object.entries(recommendations).map(([playerId, recommendation]) => [playerId, recommendation.id]));
  const scores = Object.values(recommendations).map((recommendation) => recommendation.score);
  const averageScore = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0;
  leagueMobileDutyPlayerId = null;
  leagueEditorDirty = true;
  renderLeague();
  scheduleLeagueTeamAutoSave(180);
  const phaseLabel = { opening:"默认", leading:"领先", trailing:"落后" }[state];
  showToast(`已为${phaseLabel}战术适配 ${scores.length} 名外场球员职责，平均适合度 ${averageScore}`);
}

function leagueBondDisplayLineup(starters, bonds) {
  if (!leagueShowBondBonuses || !bonds.length) return starters;
  return applyS4BondBonuses(starters.map((player) => ({
    ...player,
    attributes:{ ...(player.effectiveAttributes ?? player.attributes ?? {}) },
  })), bonds, { maximumAttribute:offlineAttributeSettings.unlocked ? Number.POSITIVE_INFINITY : 99 }).map((player) => ({
    ...player,
    effectiveAttributes:player.attributes,
    effectiveOverall:leagueOverallFromAttributes(player.attributes, player.role),
  }));
}

function compareLeagueBenchPlayers(left, right) {
  const leftRole = String(left.role ?? "");
  const rightRole = String(right.role ?? "");
  const roleDifference = (LEAGUE_BENCH_ROLE_RANK.get(leftRole) ?? LEAGUE_BENCH_ROLE_ORDER.length)
    - (LEAGUE_BENCH_ROLE_RANK.get(rightRole) ?? LEAGUE_BENCH_ROLE_ORDER.length);
  if (roleDifference) return roleDifference;
  const overallDifference = Number(right.effectiveOverall ?? right.overall ?? 0) - Number(left.effectiveOverall ?? left.overall ?? 0);
  return overallDifference || String(left.name ?? left.id).localeCompare(String(right.name ?? right.id), "zh-CN");
}
function leagueBenchMagnet(player) {
  const tooltip = leaguePlayerTooltip(player);
  const upgrade = Number(player.upgradeLevel ?? 0);
  const fitness = Math.max(0, Math.min(100, Math.round(player.effectiveFitness ?? player.state.fitness ?? 0)));
  return `<button type="button" class="magnet bench-magnet league-bench-magnet grade-${player.grade.toLowerCase()} fit-primary ${leaguePlayerUnavailable(player) ? "unavailable" : ""}" data-league-bench-magnet="${player.id}" data-primary-role="${escapeHtml(player.role ?? "")}" data-secondary-role="${escapeHtml(player.secondaryRole ?? "")}" data-traits="${escapeHtml(tooltip)}">${leagueMagnetAvailabilityMarkup(player)}<span class="league-magnet-role">${ROLE_LABELS[player.role] ?? player.role}</span><b>${escapeHtml(player.name)}</b><i>${player.effectiveOverall ?? player.overall}</i>${leagueMagnetFitnessMarkup(fitness)}${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}</button>`;
}

function leagueTacticalFit(players, roles, positions, formationLines, plan) {
  const resolved = { ...defaultV2TacticalDimensions(plan.tactic, plan.style), ...(plan.tacticalDimensions ?? {}) };
  const dimensions = applyV2TacticalProfiles(resolved, plan.inPossession, plan.outOfPossession, plan.inPossessionDetails, plan.outOfPossessionDetails);
  return calculateV2TacticalFit(players, roles, positions, formationLines, plan, dimensions);
}

function leagueNextMatchMarkup() {
  const next = league.report?.nextOpponent;
  if (league.season?.status === "registration") return `<section class="league-next-match complete"><span>新赛季报名选人中</span><b>等待管理员开启联赛推进，首轮时间将在开启后确定</b></section>`;
  if (!next) return `<section class="league-next-match complete"><span>赛季赛程已完成</span><b>等待管理员开启新赛季</b></section>`;
  const startsAt = new Date(next.startsAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
  const weather = next.weather
    ? `<strong>${weatherIcon(next.weather)} ${escapeHtml(next.weather.name)}</strong><span>降水 ${next.weather.precipitation}% · 风力 ${next.weather.wind}</span>`
    : `<strong>开赛时生成</strong><span>友谊赛天气将在比赛开始时确定</span>`;
  const referee = next.referee
    ? `<strong>${escapeHtml(next.referee.name)}</strong><span>${escapeHtml(next.referee.description)}</span>`
    : `<strong>开赛时生成</strong><span>友谊赛裁判将在比赛开始时确定</span>`;
  return `<section class="league-next-match"><div><small>NEXT MATCH · ${escapeHtml(next.competitionName)} · ${escapeHtml(next.label)}</small><b>${startsAt}</b></div><div><small>对手</small><strong>${escapeHtml(next.name)}</strong></div><div><small>天气</small>${weather}</div><div><small>裁判尺度</small>${referee}</div></section>`;
}

function leagueBackpackCardEntries() {
  return (league.ownTeam?.roster ?? []).flatMap((player) => (player.cards ?? []).map((card) => ({ player, card })));
}

function leagueRosterOverlimitLocked(player) {
  return Boolean(player?.rosterOverlimitLocked || player?.state?.rosterOverlimitLocked);
}

function leagueBackpackCardCount() {
  return (league.ownTeam?.roster ?? []).reduce((count, player) => count + (player.cards?.length ?? 0), 0);
}

function leagueBackpackCardSectionMarkup(allCards = leagueBackpackCardEntries()) {
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
    if (leagueBackpackSort === "upgrade") {
      const gradeDifference = comparePlayerGrade(left, right);
      if (gradeDifference) return gradeDifference;
    }
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
      const rosterLocked = leagueRosterOverlimitLocked(player);
      if (leagueBackpackRecoveryMode === "single") {
        const listed = activeListings.some((item) => item.cardId === card.id || item.kind === "ownership" && item.playerId === player.id);
        const lastOwnershipCard = player.ownsRights && player.cards.length === 1;
        const tradeLocked = league.tradeLockedCardIds?.includes(card.id);
        const disabled = !card.systemRecyclable || listed || tradeLocked || lastOwnershipCard;
        const reason = rosterLocked ? "超限锁定" : !card.systemRecyclable ? "+7及以上不可回收" : listed ? "资产已挂牌" : tradeLocked ? "交易报价中" : lastOwnershipCard ? "请使用所有权回收" : "";
        const selected = leagueBackpackSelectedCardIds.has(card.id);
        const attributes = disabled ? `aria-disabled="true"` : `data-backpack-recovery-card="${card.id}" data-s4-player-id="${player.id}"`;
        return `<div class="backpack-recovery-card ${disabled ? "disabled" : ""} ${selected ? "selected" : ""}">${s4PlayerCardMarkup(player, { card, compact:leagueBackpackCompact, attributes })}<span>${disabled ? escapeHtml(reason) : selected ? `已选择 · ${card.systemRecoveryValue}金币` : `${card.systemRecoveryValue}金币`}</span></div>`;
      }
      if (leagueBackpackRecoveryMode === "ownership") {
        const listed = activeListings.some((item) => item.playerId === player.id);
        const selected = leagueBackpackSelectedOwnershipIds.has(player.id);
        const attributes = listed ? `aria-disabled="true"` : `data-backpack-recovery-ownership="${player.id}"`;
        return `<div class="backpack-recovery-card ownership ${listed ? "disabled" : ""} ${selected ? "selected" : ""}">${s4PlayerCardMarkup(player, { card, compact:leagueBackpackCompact, attributes })}<span>${listed ? "资产已挂牌" : selected ? "已选择所有权" : `预计 ${player.ownershipReturnPreview?.totalAmount ?? 0}金币`}</span></div>`;
      }
      const cardMarkup = s4PlayerCardMarkup(player, { card, compact:leagueBackpackCompact, attributes:`data-s4-card-detail="${card.id}" data-s4-player-id="${player.id}"` });
      const content = stackCount > 1 ? `<div class="backpack-card-stack">${cardMarkup}<b>×${stackCount}</b></div>` : cardMarkup;
      return rosterLocked ? `<div class="backpack-card-locked">${content}<span>超限锁定 · 无法上场/合卡</span></div>` : content;
    }).join("")
    : `<p class="league-empty backpack-card-empty">${leagueBackpackRecoveryMode === "ownership" ? "当前没有可回收的非传奇球员所有权。" : "没有符合当前筛选条件的球员卡。"}</p>`;

  const selectedSingleCards = allCards.filter(({ card }) => leagueBackpackSelectedCardIds.has(card.id));
  const selectedSingleAmount = selectedSingleCards.reduce((sum, { card }) => sum + Number(card.systemRecoveryValue ?? 0), 0);
  const selectedOwnershipPlayers = (league.ownTeam?.roster ?? []).filter((player) => leagueBackpackSelectedOwnershipIds.has(player.id));
  const selectedOwnershipAmount = selectedOwnershipPlayers.reduce((sum, player) => sum + Number(player.ownershipReturnPreview?.totalAmount ?? 0), 0);
  const lockedPlayers = (league.ownTeam?.roster ?? []).filter(leagueRosterOverlimitLocked);
  const lockedNotice = lockedPlayers.length ? `<div class="backpack-roster-lock-notice"><b>大名单超限</b><span>${lockedPlayers.length} 名球员已被锁定，无法上场或合卡。请使用“所有权回收”将名单降至33人以内后解除锁定。</span><strong>${lockedPlayers.map((player) => escapeHtml(player.name)).join("、")}</strong></div>` : "";
  const recoveryActions = `<div class="backpack-recovery-actions"><label class="backpack-stack-toggle"><input type="checkbox" data-backpack-stack ${leagueBackpackStacked ? "checked" : ""} ${leagueBackpackRecoveryMode ? "disabled" : ""}><span>叠放同名同强化</span></label><button type="button" class="${leagueBackpackRecoveryMode === "single" ? "active" : ""}" data-backpack-recovery-mode="single"><b>单卡回收</b><span>${leagueBackpackRecoveryMode === "single" ? `已选${selectedSingleCards.length}张 · ${selectedSingleAmount}金币` : "批量选择可回收卡片"}</span></button><button type="button" class="${leagueBackpackRecoveryMode === "ownership" ? "active" : ""}" data-backpack-recovery-mode="ownership"><b>所有权回收</b><span>${leagueBackpackRecoveryMode === "ownership" ? selectedOwnershipPlayers.length ? `已选${selectedOwnershipPlayers.length}人 · ${selectedOwnershipAmount}金币` : "选择需要返还的球员" : "返还所有权并清理同名卡"}</span></button>${leagueBackpackRecoveryMode ? `<button type="button" class="backpack-recovery-cancel" data-backpack-recovery-cancel>取消</button>` : ""}</div>`;
  return `<section class="backpack-card-section"><header><div><small>PLAYER CARD MANAGEMENT</small><h2>球员卡管理</h2></div>${recoveryActions}</header><div class="backpack-card-tools"><input type="search" value="${escapeHtml(leagueBackpackSearch)}" placeholder="输入后按回车搜索球员、俱乐部或国家队" data-backpack-search/><select data-backpack-position><option value="ALL" ${leagueBackpackPosition === "ALL" ? "selected" : ""}>全部位置</option><option value="ATT" ${leagueBackpackPosition === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueBackpackPosition === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueBackpackPosition === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueBackpackPosition === "GK" ? "selected" : ""}>门将</option></select><select data-backpack-upgrade ${leagueBackpackRecoveryMode === "ownership" ? "disabled" : ""}><option value="ALL" ${leagueBackpackUpgrade === "ALL" ? "selected" : ""}>全部强化</option><option value="BASE" ${leagueBackpackUpgrade === "BASE" ? "selected" : ""}>未强化</option><option value="MID" ${leagueBackpackUpgrade === "MID" ? "selected" : ""}>+1 ～ +4</option><option value="HIGH" ${leagueBackpackUpgrade === "HIGH" ? "selected" : ""}>+5 ～ +7</option><option value="MAX" ${leagueBackpackUpgrade === "MAX" ? "selected" : ""}>+8</option></select><select data-backpack-sort><option value="upgrade" ${leagueBackpackSort === "upgrade" ? "selected" : ""}>强化等级优先</option><option value="overall" ${leagueBackpackSort === "overall" ? "selected" : ""}>能力值优先</option><option value="name" ${leagueBackpackSort === "name" ? "selected" : ""}>姓名排序</option></select><div class="backpack-density"><button type="button" class="${leagueBackpackCompact ? "" : "active"}" data-backpack-density="normal" title="标准卡片">标准</button><button type="button" class="${leagueBackpackCompact ? "active" : ""}" data-backpack-density="compact" title="紧凑卡片">紧凑</button></div></div><div class="backpack-card-grid ${leagueBackpackCompact ? "compact" : ""}">${cardGrid}</div></section>`;
}

function leagueBackpackPackSectionMarkup(inventory = league.s4Packs?.inventory ?? []) {
  const packSearch = leagueBackpackPackSearch.trim().toLocaleLowerCase("zh-CN");
  const groupedInventory = new Map();
  inventory.forEach((item) => {
    const matchesSearch = !packSearch || [item.name, item.packType].some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(packSearch));
    const matchesKind = leagueBackpackPackKind === "ALL" || item.kind === leagueBackpackPackKind;
    const matchesPool = leagueBackpackPackPool === "ALL" || item.pool === leagueBackpackPackPool;
    const matchesSource = leagueBackpackPackSource === "ALL" || item.source === leagueBackpackPackSource;
    if (!matchesSearch || !matchesKind || !matchesPool || !matchesSource) return;
    const items = groupedInventory.get(item.packType) ?? [];
    items.push(item);
    groupedInventory.set(item.packType, items);
  });
  const groups = [...groupedInventory.entries()].map(([packType, items]) => {
    const openableItems = items.filter((item) => item.status === "unopened");
    const pack = items[0];
    const representative = openableItems[0] ?? items[0];
    const packVisual = s4PackVisualMarkup(pack, {
      tag:"button",
      className:"backpack-pack",
      attributes:representative.status === "unopened" ? `data-s4-pack-open="${representative.id}"` : "",
      disabled:representative.status !== "unopened",
      state:representative.status === "choosing" ? "待选择" : "点击打开1份",
    });
    const batchHint = pack.kind === "cosmetic" ? `<span>连续三选一</span>` : "";
    const actions = `<div class="backpack-tier-actions"><b>${items.length}份</b><input type="number" min="1" max="${Math.max(1, Math.min(100, openableItems.length))}" value="${Math.max(1, Math.min(100, openableItems.length))}" id="backpack-batch-count-${escapeHtml(packType)}" aria-label="批量打开数量" ${openableItems.length ? "" : "disabled"}><button type="button" data-s4-pack-open-batch="${escapeHtml(packType)}" ${openableItems.length && !league.s4Packs?.batchOpening ? "" : "disabled"}>批量打开</button>${batchHint}</div>`;
    return `<section class="backpack-tier"><header><div><small>${pack.kind === "cosmetic" ? "COSMETIC PACK" : "S4 PACK"}</small><h2>${escapeHtml(pack.name)}</h2></div>${actions}</header><div class="backpack-pool-grid"><section class="backpack-pool"><div class="backpack-pack-stack">${packVisual}<strong>×${items.length}</strong><small>同类卡包已合并显示</small></div></section></div></section>`;
  }).join("");
  const packTools = `<div class="backpack-pack-tools">
    <input type="search" value="${escapeHtml(leagueBackpackPackSearch)}" placeholder="搜索卡包名称" data-backpack-pack-search>
    <select data-backpack-pack-kind><option value="ALL" ${leagueBackpackPackKind === "ALL" ? "selected" : ""}>全部类别</option><option value="cosmetic" ${leagueBackpackPackKind === "cosmetic" ? "selected" : ""}>装饰卡包</option><option value="legend" ${leagueBackpackPackKind === "legend" ? "selected" : ""}>传奇卡包</option><option value="private" ${leagueBackpackPackKind === "private" ? "selected" : ""}>私有池卡包</option><option value="public" ${leagueBackpackPackKind === "public" ? "selected" : ""}>公共池卡包</option></select>
    <select data-backpack-pack-pool><option value="ALL" ${leagueBackpackPackPool === "ALL" ? "selected" : ""}>全部定位</option><option value="MIXED" ${leagueBackpackPackPool === "MIXED" ? "selected" : ""}>全位置</option><option value="ATT" ${leagueBackpackPackPool === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueBackpackPackPool === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueBackpackPackPool === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueBackpackPackPool === "GK" ? "selected" : ""}>门将</option><option value="LEGEND" ${leagueBackpackPackPool === "LEGEND" ? "selected" : ""}>传奇</option><option value="COUNTRY_BADGE" ${leagueBackpackPackPool === "COUNTRY_BADGE" ? "selected" : ""}>国家徽章</option><option value="CLUB_BADGE" ${leagueBackpackPackPool === "CLUB_BADGE" ? "selected" : ""}>俱乐部徽章</option></select>
    <select data-backpack-pack-source><option value="ALL" ${leagueBackpackPackSource === "ALL" ? "selected" : ""}>全部来源</option><option value="shop" ${leagueBackpackPackSource === "shop" ? "selected" : ""}>商店购买</option><option value="admin" ${leagueBackpackPackSource === "admin" ? "selected" : ""}>后台发放</option></select>
  </div>`;
  const filteredCount = [...groupedInventory.values()].reduce((count, items) => count + items.length, 0);
  return inventory.length
    ? `<section class="backpack-pack-section"><header><div><small>PACK INVENTORY</small><h2>卡包管理</h2></div><b>${filteredCount}/${inventory.length}份</b></header>${packTools}${filteredCount ? groups : `<div class="backpack-pack-filter-empty">没有符合当前筛选条件的卡包。</div>`}</section>`
    : `<section class="backpack-pack-section"><header><div><small>PACK INVENTORY</small><h2>卡包管理</h2></div><b>0份</b></header>${packTools}<div class="backpack-pack-empty"><small>PACK INVENTORY</small><b>暂无未开启礼包</b><span>商店购买和管理员发放的礼包会出现在这里。</span></div></section>`;
}

function leagueBackpackItemSectionMarkup() {
  const allItems = [...(league.cosmetics?.items ?? [])];
  const totalCount = allItems.reduce((sum, item) => sum + Number(item.count ?? 0), 0);
  const collection = league.cosmetics?.collection ?? { ownedUnique:allItems.length, total:85 };
  const groupMarkup = ({ slot, title, kicker, price, fallbackTotal }) => {
    const items = allItems.filter((item) => item.slot === slot).sort((left, right) => (PLAYER_GRADE_ORDER[left.grade] ?? 99) - (PLAYER_GRADE_ORDER[right.grade] ?? 99) || String(left.displayName ?? "").localeCompare(String(right.displayName ?? ""), "zh-CN"));
    const groupCollection = collection[slot === "clubBadge" ? "club" : "country"] ?? { ownedUnique:items.length, total:fallbackTotal };
    const cards = items.length ? items.map((item) => {
      const displayName = item.displayName ?? item.countryName ?? item.clubName ?? item.name;
      return `<article class="cosmetic-item-card grade-${String(item.grade).toLowerCase()} ${item.equipped ? "is-equipped" : ""}"><div class="cosmetic-item-art"><span>${escapeHtml(item.grade)}</span><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}"></div><div class="cosmetic-item-copy"><small>${escapeHtml(title)} · ${escapeHtml(item.grade)}级</small><h3>${escapeHtml(displayName)}</h3><span>持有 ×${Number(item.count ?? 0)}</span></div><button type="button" class="button ${item.equipped ? "secondary" : "primary"}" data-cosmetic-slot="${slot}" data-cosmetic-equip="${item.equipped ? "" : escapeHtml(item.id)}">${item.equipped ? "取消佩戴" : "佩戴"}</button></article>`;
    }).join("") : `<div class="backpack-item-empty"><b>暂无${escapeHtml(title)}</b><span>前往商店购买${price}金币的${escapeHtml(title)}包，打开后从3枚徽章中选择1枚。</span></div>`;
    return `<section class="cosmetic-item-group"><header><div><small>${escapeHtml(kicker)}</small><h3>${escapeHtml(title)}</h3></div><b>${groupCollection.ownedUnique}/${groupCollection.total}</b></header><div class="cosmetic-item-grid">${cards}</div></section>`;
  };
  return `<section class="backpack-item-section"><header><div><small>COSMETIC ITEM MANAGEMENT</small><h2>道具</h2></div><div><b>${collection.ownedUnique}/${collection.total}</b><span>已收集 · 共${totalCount}件</span></div></header><div class="cosmetic-item-groups">${groupMarkup({ slot:"teamBadge", title:"国家徽章", kicker:"NATIONAL BADGES", price:1000, fallbackTotal:34 })}${groupMarkup({ slot:"clubBadge", title:"俱乐部徽章", kicker:"CLUB BADGES", price:1200, fallbackTotal:51 })}</div></section>`;
}

function leagueBackpackMarkup() {
  const inventory = league.s4Packs?.inventory ?? [];
  const allCards = leagueBackpackPage === "cards" ? leagueBackpackCardEntries() : null;
  const cardCount = allCards?.length ?? leagueBackpackCardCount();
  const itemCount = league.cosmetics?.items?.reduce((sum, item) => sum + Number(item.count ?? 0), 0) ?? 0;
  const content = leagueBackpackPage === "cards"
    ? leagueBackpackCardSectionMarkup(allCards)
    : leagueBackpackPage === "items" ? leagueBackpackItemSectionMarkup() : leagueBackpackPackSectionMarkup(inventory);
  return `<section class="league-backpack"><header><div><small>S4 CLUB INVENTORY</small><h2>球队背包</h2></div><div class="backpack-summary"><span><b data-backpack-card-count>${cardCount}</b>张球员卡</span><span><b data-backpack-pack-count>${inventory.length}</b>份礼包</span><span><b data-backpack-item-count>${itemCount}</b>件道具</span></div></header><nav class="backpack-page-tabs"><button type="button" class="${leagueBackpackPage === "packs" ? "active" : ""}" data-backpack-page="packs">卡包管理<span data-backpack-pack-count>${inventory.length}</span></button><button type="button" class="${leagueBackpackPage === "cards" ? "active" : ""}" data-backpack-page="cards">球员卡管理<span data-backpack-card-count>${cardCount}</span></button><button type="button" class="${leagueBackpackPage === "items" ? "active" : ""}" data-backpack-page="items">道具<span data-backpack-item-count>${itemCount}</span></button></nav>${content}</section>`;
}

function syncLeagueBackpackPackMutationInPlace() {
  const root = leagueTab === "backpack" && leagueBackpackPage === "packs"
    ? app.querySelector(".league-backpack")
    : null;
  const currentSection = root?.querySelector(".backpack-pack-section");
  if (!root || !currentSection) {
    renderLeague();
    return false;
  }
  const inventory = league.s4Packs?.inventory ?? [];
  currentSection.outerHTML = leagueBackpackPackSectionMarkup(inventory);
  root.querySelectorAll("[data-backpack-pack-count]").forEach((element) => { element.textContent = String(inventory.length); });
  const cardCount = leagueBackpackCardCount();
  root.querySelectorAll("[data-backpack-card-count]").forEach((element) => { element.textContent = String(cardCount); });
  const itemCount = league.cosmetics?.items?.reduce((sum, item) => sum + Number(item.count ?? 0), 0) ?? 0;
  root.querySelectorAll("[data-backpack-item-count]").forEach((element) => { element.textContent = String(itemCount); });
  syncLeagueShellChrome();
  syncS4PackChoiceDialog();
  return true;
}

function leagueEnhancementCardEntries() {
  return (league.ownTeam?.roster ?? []).flatMap((player) => (player.cards ?? []).map((card) => ({ player, card })));
}

function openLeagueBatchEnhancementDialog() {
  const players = (league.ownTeam?.roster ?? []).filter((player) => !player.xPlayer && (player.cards ?? []).length > 1);
  if (!players.length) return showToast("没有可批量合卡的普通球员");
  const options = players.map((player) => `<option value="${escapeHtml(player.id)}">${escapeHtml(player.name)} · ${player.cards.length}张卡</option>`).join("");
  const levels = Array.from({ length:3 }, (_, level) => `<option value="${level}">+${level}</option>`).join("");
  const overlay = openLeagueDialog(`<header><div><small>BATCH ENHANCEMENT</small><h2>批量合卡</h2><p>固定主卡和副卡等级，系统按当前仓库库存自动配对。</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="batch-enhancement-form"><label>选择球员<select data-batch-enhancement-player>${options}</select></label><section class="batch-enhancement-distribution"><header><b>该球员强化等级分布</b><small data-batch-enhancement-total></small></header><div data-batch-enhancement-level-distribution></div></section><div class="batch-enhancement-levels"><label>主卡等级<select data-batch-enhancement-main-level>${levels}</select></label><label>副卡等级<select data-batch-enhancement-material-level>${levels}</select></label></div><div class="batch-enhancement-summary" data-batch-enhancement-summary></div><label>合成数量<input type="number" min="1" value="1" data-batch-enhancement-quantity></label><p class="batch-enhancement-note">每次消耗1张主卡和1张副卡；成功卡升一级，失败按现有规则处理。</p></div><footer class="batch-enhancement-footer"><button type="button" class="button secondary" data-close-league-dialog>取消</button><button type="button" class="button primary" data-batch-enhancement-submit>开始合成</button></footer>`, "batch-enhancement-dialog", { dismissOnBackdrop:false });
  const refresh = () => {
    const player = players.find((entry) => entry.id === overlay.querySelector("[data-batch-enhancement-player]").value);
    const mainLevel = Number(overlay.querySelector("[data-batch-enhancement-main-level]").value);
    const materialLevel = Number(overlay.querySelector("[data-batch-enhancement-material-level]").value);
    const mainCount = player?.cards.filter((card) => Number(card.upgradeLevel ?? 0) === mainLevel && !card.pendingTraitOffer).length ?? 0;
    const materialCount = player?.cards.filter((card) => Number(card.upgradeLevel ?? 0) === materialLevel && !card.ownershipAnchorRequired).length ?? 0;
    const levelCounts = Array.from({ length:9 }, (_, level) => player?.cards.filter((card) => Number(card.upgradeLevel ?? 0) === level).length ?? 0);
    const maximum = mainLevel === materialLevel ? Math.floor(Math.min(mainCount, materialCount) / 2) : Math.min(mainCount, materialCount);
    const invalidLevelPair = materialLevel > mainLevel;
    const quantity = overlay.querySelector("[data-batch-enhancement-quantity]");
    quantity.max = String(maximum);
    quantity.value = String(Math.max(1, Math.min(Number(quantity.value) || 1, maximum || 1)));
    overlay.querySelector("[data-batch-enhancement-total]").textContent = `共 ${player?.cards.length ?? 0} 张`;
    overlay.querySelector("[data-batch-enhancement-level-distribution]").innerHTML = levelCounts.map((count, level) => `<span class="${level === mainLevel ? "is-main" : ""} ${level === materialLevel ? "is-material" : ""}"><small>+${level}</small><b>${count}</b></span>`).join("");
    overlay.querySelector("[data-batch-enhancement-summary]").innerHTML = `<span>主卡库存 <b>${mainCount}</b></span><span>副卡库存 <b>${materialCount}</b></span><span>可合成上限 <b>${maximum}</b></span><span>预期概率 <b>${maximum ? leagueEnhancementChance(mainLevel, materialLevel) : 0}%</b></span>`;
    overlay.querySelector("[data-batch-enhancement-submit]").disabled = !maximum || invalidLevelPair;
  };
  overlay.querySelectorAll("[data-batch-enhancement-player], [data-batch-enhancement-main-level], [data-batch-enhancement-material-level], [data-batch-enhancement-quantity]").forEach((input) => input.addEventListener("input", refresh));
  overlay.querySelector("[data-batch-enhancement-submit]").addEventListener("click", async () => {
    const button = overlay.querySelector("[data-batch-enhancement-submit]");
    button.disabled = true;
    button.textContent = "合成中";
    try {
      const value = await api("/api/versus/league/card/enhance-batch", { method:"POST", body:leagueIdentity({ batchPlayerId:overlay.querySelector("[data-batch-enhancement-player]").value, mainLevel:Number(overlay.querySelector("[data-batch-enhancement-main-level]").value), materialLevel:Number(overlay.querySelector("[data-batch-enhancement-material-level]").value), quantity:Number(overlay.querySelector("[data-batch-enhancement-quantity]").value) }) });
      const result = value.batchEnhancement;
      const current = league.ownTeam.roster.find((entry) => entry.id === result.playerId);
      if (current && Array.isArray(result.cards)) current.cards = result.cards;
      if (current) current.pendingTraitOffers = result.pendingTraitOffers ?? current.pendingTraitOffers;
      league.wallet = result.wallet;
      league.updatedAt = result.updatedAt;
      closeLeagueDialog();
      renderLeagueEnhancementInPlace();
      openLeagueBatchEnhancementResultDialog(result);
    } catch (error) { button.disabled = false; button.textContent = "开始合成"; showToast(error.message); }
  });
  refresh();
}

function openLeagueBatchEnhancementResultDialog(result) {
  const levels = Object.entries(result.finalLevelCounts ?? {}).sort((left, right) => Number(left[0]) - Number(right[0])).map(([level, count]) => `<span>+${level} <b>${count}张</b></span>`).join("");
  openLeagueDialog(`<header><div><small>BATCH ENHANCEMENT RESULT</small><h2>${escapeHtml(result.player.name)} · 批量合卡完成</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="batch-enhancement-result"><div class="batch-result-hero"><strong class="is-success">${result.successCount}</strong><strong class="is-failure">${result.failureCount}</strong></div><div class="batch-result-stats"><span>实际合成 <b>${result.quantity}次</b></span><span>预期成功 <b>${result.expectedSuccesses}张</b></span><span>预期概率 <b>${result.chance}%</b></span><span>最终卡片 <b>${result.finalCardCount}张</b></span></div><section><h3>最终库存</h3><div class="batch-result-levels">${levels || "暂无卡片"}</div></section><p>成功卡已按现有规则产生强化特性待绑定状态，请在强化页完成绑定。</p></div><footer class="batch-enhancement-footer"><button type="button" class="button primary" data-close-league-dialog>完成</button></footer>`, "batch-enhancement-result-dialog", { dismissOnBackdrop:false });
}

function leagueEnhancementCardEntry(cardId) {
  return leagueEnhancementCardEntries().find(({ card }) => card.id === cardId) ?? null;
}

function leagueEnhancementChance(mainLevel, materialLevel) {
  const rules = league.enhancement ?? {};
  const equal = rules.equalLevelChances?.[mainLevel] ?? 1;
  const distance = materialLevel - mainLevel;
  const adjusted = distance < 0
    ? equal * ((rules.lowerMaterialMultiplier ?? .6) ** Math.abs(distance))
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

function enhancementHistoryResultText(entry) {
  if (entry.batchQuantity) return `批量完成 · ${entry.batchSuccessCount}成功 / ${entry.batchFailureCount}失败`;
  if (entry.success) return `成功 · +${entry.afterLevel}`;
  return entry.afterLevel < entry.beforeLevel ? `失败 · 降至+${entry.afterLevel}` : `失败 · 保持+${entry.afterLevel}`;
}

function leagueEnhancementHistoryMarkup() {
  const history = league.enhancement?.history ?? [];
  const rows = history.slice(0, 8).map((entry) => {
    const time = new Date(entry.createdAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
    const materialLevel = Number(entry.materialCard?.upgradeLevel ?? 0);
    const protection = entry.protectionUsed ? `<span class="enhancement-history-protection"><small>保卡道具</small><b>${Number(entry.protectionCost ?? 0).toLocaleString("zh-CN")} 金币</b></span>` : `<span class="enhancement-history-protection empty" aria-hidden="true"></span>`;
    return `<li class="${entry.success ? "success" : "failure"}"><time>${escapeHtml(time)}</time><div><b>${escapeHtml(entry.mainPlayer.name)} +${entry.beforeLevel}</b><small>副卡 ${escapeHtml(entry.materialPlayer.name)} +${materialLevel}</small></div>${protection}<span class="enhancement-history-chance">${entry.chance}%</span><strong>${escapeHtml(enhancementHistoryResultText(entry))}</strong></li>`;
  }).join("");
  return `<section class="enhancement-mini-ranking enhancement-history-mini"><header><div><small>RECENT ENHANCEMENTS</small><h3>强化记录</h3></div><button type="button" data-enhancement-history-open ${history.length ? "" : "disabled"}>放大查看</button></header><ol>${rows}</ol></section>`;
}

function openLeagueEnhancementHistory() {
  const history = league.enhancement?.history ?? [];
  if (!history.length) return showToast("还没有强化记录");
  const entries = history.map((entry) => {
    const time = new Date(entry.createdAt).toLocaleString("zh-CN", { year:"numeric", month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false });
    const materialLevel = Number(entry.materialCard?.upgradeLevel ?? 0);
    const protection = entry.protectionUsed ? `<span><small>强化道具</small><b>已使用 · ${Number(entry.protectionCost ?? 0).toLocaleString("zh-CN")} 金币</b></span>` : "";
    return `<article class="enhancement-history-entry ${entry.success ? "success" : "failure"}"><header><div><small>${escapeHtml(time)}</small><h3>${escapeHtml(enhancementHistoryResultText(entry))}</h3></div><strong>${entry.chance}%<small>预期成功率</small></strong></header><div class="enhancement-history-card-pair"><section><b>主卡 · 强化前 +${entry.beforeLevel}</b>${s4PlayerCardMarkup(entry.mainPlayer, { card:entry.mainCard })}</section><i>+</i><section><b>副卡 · +${materialLevel}</b>${s4PlayerCardMarkup(entry.materialPlayer, { card:entry.materialCard })}</section><i>=</i><section class="result-card"><b>结果卡 · +${entry.afterLevel}</b>${s4PlayerCardMarkup(entry.resultPlayer ?? entry.mainPlayer, { card:entry.resultCard ?? { ...entry.mainCard, upgradeLevel:entry.afterLevel } })}</section></div><footer>${protection}<span><small>最终结果</small><b>${escapeHtml(enhancementHistoryResultText(entry))}</b></span></footer></article>`;
  }).join("");
  const overlay = openLeagueDialog(`<header><div><small>ENHANCEMENT HISTORY</small><h2>最近强化记录</h2><p>共保存最近 ${history.length} 次合卡，使用鼠标滚轮浏览。</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="enhancement-history-scroll">${entries}</div>`, "enhancement-history-dialog");
  overlay.classList.add("enhancement-history-overlay");
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
    if (leagueBackpackSort === "upgrade") {
      const gradeDifference = comparePlayerGrade(left, right);
      if (gradeDifference) return gradeDifference;
    }
    const upgradeDifference = right.card.upgradeLevel - left.card.upgradeLevel;
    if (upgradeDifference) return upgradeDifference;
    if (leagueBackpackSort === "overall") return right.player.overall - left.player.overall || left.player.name.localeCompare(right.player.name, "zh-CN");
    if (leagueBackpackSort === "name") return left.player.name.localeCompare(right.player.name, "zh-CN") || right.player.overall - left.player.overall;
    return right.player.overall - left.player.overall || left.player.name.localeCompare(right.player.name, "zh-CN");
  });
  const mainLevel = Number(main?.card.upgradeLevel ?? 0);
  const materialLevel = Number(material?.card.upgradeLevel ?? 0);
  const compatibleCards = Boolean(main && material && !material.player.xPlayer
    && !material.card.ownershipAnchorRequired
    && (main.player.xPlayer ? main.player.role === material.player.role : main.player.id === material.player.id));
  const materialLevelTooHigh = compatibleCards && materialLevel > mainLevel;
  const chance = compatibleCards ? leagueEnhancementChance(mainLevel, materialLevel) : 0;
  const protectionAvailable = Boolean(main && compatibleCards && !materialLevelTooHigh && chance < 100 && mainLevel < Number(league.enhancement?.maxLevel ?? 8));
  if (!protectionAvailable) leagueEnhancementUseProtection = false;
  const failureChance = Math.max(0, 100 - chance);
  const protectionUnit = Number(league.enhancement?.protectionCostUnit ?? 100);
  const protectionBaseCost = protectionAvailable ? Math.ceil((failureChance * failureChance * Number(league.enhancement?.protectionCostFactor ?? .7)) / protectionUnit) * protectionUnit : 0;
  const protectionCost = Math.ceil(protectionBaseCost * Number(league.enhancement?.protectionCostDiscount ?? .75));
  const abilityBonuses = league.enhancement?.abilityBonuses ?? [0, 1, 2, 3, 5, 7, 9, 11, 13];
  const currentOverall = main ? Number(main.player.baseOverall ?? main.player.overall) + Number(abilityBonuses[mainLevel] ?? mainLevel) : null;
  const targetOverall = main ? Number(main.player.baseOverall ?? main.player.overall) + Number(abilityBonuses[mainLevel + 1] ?? mainLevel + 1) : null;
  const insufficientCoins = leagueEnhancementUseProtection && protectionAvailable && league.wallet.balance < protectionCost;
  const canEnhance = compatibleCards && !materialLevelTooHigh && mainLevel < Number(league.enhancement?.maxLevel ?? 8) && !insufficientCoins && leagueEnhancementPhase !== "scanning";
  const enhancementHint = materialLevelTooHigh ? "" : main ? `能力 ${currentOverall} → ${targetOverall}` : "选择主卡后显示能力成长";
  const result = leagueEnhancementResult;
  const traitOffer = result ? result.traitOffer ?? null : league.enhancement?.traitOffer ?? null;
  const traitOfferEntry = traitOffer ? leagueEnhancementCardEntry(traitOffer.cardId) : null;
  const traitPlayer = result?.player ?? traitOfferEntry?.player ?? null;
  const traitRoleLabels = { ANY:"全位置", ATT:"前场", MID:"中场", DEF:"后场", GK:"门将" };
  const traitPicker = "";
  const bindTraitButton = traitOffer ? `<button type="button" class="enhancement-bind-trait" data-enhancement-open-traits>绑定特性</button>` : "";
  const resultCardAttributes = result
    ? traitOffer
      ? `draggable="false" aria-disabled="true" data-enhancement-result-card="${result.card.id}" data-enhancement-result-pending title="请先绑定强化特性"`
      : `draggable="true" data-enhancement-result-card="${result.card.id}" title="双击或拖回球员卡仓库"`
    : "";
  const resultMarkup = result
    ? `${s4PlayerCardMarkup(result.player, { card:result.card, compact:true, attributes:resultCardAttributes })}<h3>${result.success ? "强化成功" : result.afterLevel < result.beforeLevel ? "强化失败 · 降级" : "强化失败 · 保级"}</h3><b>+${result.beforeLevel} → +${result.afterLevel}</b>${bindTraitButton}`
    : traitOffer && traitOfferEntry
      ? `${s4PlayerCardMarkup(traitOfferEntry.player, { card:traitOfferEntry.card, compact:true })}<h3>等待绑定特性</h3>${bindTraitButton}`
    : `<div class="enhancement-result-empty"><span>+</span><b>结果</b></div>`;
  const warehouseMarkup = warehouseCards.length
    ? warehouseCards.map(({ player, card }) => {
      const listed = leagueEnhancementCardListed(player.id, card.id);
      const attributes = listed ? `draggable="false" aria-disabled="true"` : `draggable="true" data-enhancement-card="${card.id}" data-enhancement-player="${player.id}"`;
      return `<div class="enhancement-warehouse-card ${listed ? "listed" : ""} ${card.ownershipAnchorRequired ? "anchor-required" : ""}">${s4PlayerCardMarkup(player, { card, compact:true, attributes })}${listed ? "<span>已挂牌</span>" : card.ownershipAnchorRequired ? "<span>末张锚点 · 仅可作主卡</span>" : ""}</div>`;
    }).join("")
    : `<div class="enhancement-warehouse-empty">没有符合条件的卡片</div>`;
  return `<section class="league-enhancement phase-${leagueEnhancementPhase}">
    <div class="enhancement-left-column"><section class="enhancement-composer">
      <header><h2>球员强化</h2><b>${league.wallet.balance} 金币</b></header>
      <div class="enhancement-flow">
        ${leagueEnhancementSlotMarkup("main", main)}
        ${leagueEnhancementSlotMarkup("material", material)}
        <div class="enhancement-action">
          <strong>${materialLevelTooHigh ? "" : compatibleCards ? `${chance}%` : "—"}</strong>
          <small>${enhancementHint}</small>
          <button type="button" class="enhancement-trigger" data-enhancement-submit ${canEnhance ? "" : "disabled"}>${leagueEnhancementPhase === "scanning" ? "合成中" : "强化"}</button>
          <label class="${protectionAvailable ? "" : "disabled"}"><input type="checkbox" data-enhancement-protection ${leagueEnhancementUseProtection ? "checked" : ""} ${protectionAvailable ? "" : "disabled"}><span>使用保卡道具</span><b>${protectionCost} 金币</b></label>
        </div>
        <div class="enhancement-result-frame">${resultMarkup}</div>
      </div>
      ${traitPicker}
    </section>${leagueEnhancementHistoryMarkup()}</div>
    <section class="enhancement-warehouse" data-enhancement-warehouse>
      <header><h2>球员卡仓库</h2><div class="enhancement-warehouse-header-actions"><button type="button" class="button secondary" data-enhancement-batch-open>批量合卡</button><b>${warehouseCards.length}/${allCards.length}</b></div></header>
      <div class="backpack-card-tools enhancement-tools"><input type="search" value="${escapeHtml(leagueBackpackSearch)}" placeholder="输入后按回车搜索球员、俱乐部或国家队" data-backpack-search><select data-backpack-position><option value="ALL" ${leagueBackpackPosition === "ALL" ? "selected" : ""}>全部位置</option><option value="ATT" ${leagueBackpackPosition === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueBackpackPosition === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueBackpackPosition === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueBackpackPosition === "GK" ? "selected" : ""}>门将</option></select><select data-backpack-upgrade><option value="ALL" ${leagueBackpackUpgrade === "ALL" ? "selected" : ""}>全部强化</option><option value="BASE" ${leagueBackpackUpgrade === "BASE" ? "selected" : ""}>未强化</option><option value="MID" ${leagueBackpackUpgrade === "MID" ? "selected" : ""}>+1 ～ +4</option><option value="HIGH" ${leagueBackpackUpgrade === "HIGH" ? "selected" : ""}>+5 ～ +7</option><option value="MAX" ${leagueBackpackUpgrade === "MAX" ? "selected" : ""}>+8</option></select><select data-enhancement-listing-filter><option value="UNLISTED" ${leagueEnhancementListingFilter === "UNLISTED" ? "selected" : ""}>未挂牌</option><option value="ALL" ${leagueEnhancementListingFilter === "ALL" ? "selected" : ""}>所有</option></select><select data-backpack-sort><option value="upgrade" ${leagueBackpackSort === "upgrade" ? "selected" : ""}>强化等级</option><option value="overall" ${leagueBackpackSort === "overall" ? "selected" : ""}>能力值</option><option value="name" ${leagueBackpackSort === "name" ? "selected" : ""}>姓名</option></select></div>
      <div class="backpack-card-grid compact enhancement-card-grid">${warehouseMarkup}</div>
    </section>
  </section>`;
}

function openS4CardDetail(cardId, playerId) {
  const rosterPlayer = (league.ownTeam?.roster ?? []).find((entry) => entry.id === playerId);
  const card = rosterPlayer?.cards?.find((entry) => entry.id === cardId);
  if (!rosterPlayer || !card) return showToast("找不到这张球员卡");
  const player = {
    ...rosterPlayer,
    ownership:rosterPlayer.ownsRights ? { ownerId:league.ownTeam.ownerId, ownerName:league.ownTeam.ownerName, teamId:league.ownTeam.id, teamName:league.ownTeam.name } : null,
  };
  const overlay = openLeagueDialog(`<header><div><small>PLAYER PROFILE · OWNED CARD</small><h2>${escapeHtml(player.name)}</h2><p>${card.upgradeLevel ? `强化 +${card.upgradeLevel}` : "未强化"} · ${player.ownsRights ? "持有球员所有权" : card.rosterExempt ? "外部获得且免名单额度" : "仅持有单卡"}</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header>${overviewPlayerDetailMarkup(player, { card })}`, "overview-player-dialog s4-card-detail-dialog");
  overlay.classList.add("s4-card-detail-overlay");
}

function openS4PackResult(result) {
  if (result?.item) {
    openLeagueDialog(`<header><div><small>COSMETIC ITEM ACQUIRED</small><h2>获得 ${escapeHtml(result.item.name)}</h2><p>${result.item.equipped ? "这是该类别的第一枚徽章，已自动佩戴。" : "徽章已收入背包的道具栏。"}</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="cosmetic-pack-result grade-${String(result.item.grade).toLowerCase()}"><img src="${escapeHtml(result.item.imageUrl)}" alt="${escapeHtml(result.item.name)}"><section><small>${escapeHtml(result.item.grade)} GRADE ${result.item.slot === "clubBadge" ? "CLUB" : "COUNTRY"} BADGE</small><h3>${escapeHtml(result.item.displayName ?? result.item.countryName ?? result.item.clubName)}</h3><p>当前持有 ×${Number(result.item.count ?? 1)}</p><button type="button" class="button primary wide" data-close-league-dialog>收入道具栏</button></section></div>`);
    return;
  }
  if (!result?.player || !result?.card) return;
  const ownershipText = result.legendaryHit ? "触发1.5%传奇概率，传奇S球员卡已进入背包" : result.cardCount > 1 ? `同时获得该球员所有权及 ${result.cardCount} 张+0基础卡` : result.ownershipGranted ? "同时获得该球员所有权" : result.mode === "direct" ? "球员卡已进入背包" : "传奇球员卡已进入背包";
  openLeagueDialog(`<header><div><small>${result.legendaryHit ? "LEGENDARY HIT · 1.5%" : "PACK OPENING RESULT"}</small><h2>获得 ${escapeHtml(result.player.name)}</h2><p>${escapeHtml(ownershipText)}</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="s4-pack-result ${result.legendaryHit ? "legendary-hit" : ""}"><div>${s4PlayerCardMarkup(result.player, { card:result.card })}</div><section><small>${result.legendaryHit ? "LEGENDARY S PLAYER" : "NEW PLAYER CARD"}</small><h3>${escapeHtml(result.player.name)}</h3><p>${escapeHtml(result.player.club)} / ${escapeHtml(result.player.nationality)}</p><b>${result.card.upgradeLevel ? `强化 +${result.card.upgradeLevel}` : "未强化球员卡"}</b><button type="button" class="button primary wide" data-close-league-dialog>收入背包</button></section></div>`);
}

function openS4PackBatchResults(batch) {
  const results = batch?.results ?? [];
  if (!results.length) return;
  if (batch.mode === "cosmetic-choice") {
    const badgeResults = results.filter((result) => result.item);
    const clubBadgeBatch = badgeResults[0]?.item?.slot === "clubBadge";
    const badgeType = clubBadgeBatch ? "俱乐部徽章" : "国家徽章";
    const cards = badgeResults.map((result, index) => {
      const item = result.item;
      const displayName = item.displayName ?? item.countryName ?? item.clubName ?? item.name;
      return `<article class="cosmetic-batch-result grade-${String(item.grade).toLowerCase()}"><span>${index + 1}</span><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}"><b>${escapeHtml(displayName)}</b><small>${escapeHtml(item.grade)}级${badgeType}</small></article>`;
    }).join("");
    openLeagueDialog(`<header><div><small>BATCH BADGE PACK OPENING</small><h2>批量开启完成</h2><p>已完成 ${badgeResults.length} 份${badgeType}包的三选一，全部徽章均已收入道具栏。</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="cosmetic-batch-results">${cards}</div><footer class="s4-pack-batch-footer"><button type="button" class="button primary" data-close-league-dialog>全部收入背包</button></footer>`, "cosmetic-pack-batch-dialog");
    return;
  }
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  const legendaryHitCount = results.filter((result) => result.legendaryHit).length;
  let page = 0;
  const overlay = openLeagueDialog("", "s4-pack-batch-dialog");
  const renderPage = () => {
    const start = page * pageSize;
    const cards = results.slice(start, start + pageSize).map((result, index) => `<article class="${result.legendaryHit ? "legendary-hit" : ""}"><span>${result.legendaryHit ? "S" : start + index + 1}</span>${s4PlayerCardMarkup(result.player, { card:result.card, compact:true })}</article>`).join("");
    const pager = pageCount > 1 ? `<nav class="s4-pack-batch-pager"><button type="button" class="button secondary" data-pack-batch-page="previous" ${page <= 0 ? "disabled" : ""}>上一页</button><b>${page + 1} / ${pageCount}</b><button type="button" class="button secondary" data-pack-batch-page="next" ${page >= pageCount - 1 ? "disabled" : ""}>下一页</button></nav>` : "";
    overlay.querySelector(".league-dialog").innerHTML = `<header><div><small>BATCH PACK OPENING</small><h2>批量开包完成</h2><p>共获得 ${results.length} 张球员卡${legendaryHitCount ? `，其中触发 ${legendaryHitCount} 次1.5%传奇命中` : ""}；每页最多展示 ${pageSize} 张</p></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="s4-pack-batch-results">${cards}</div><footer class="s4-pack-batch-footer">${pager}<button type="button" class="button primary" data-close-league-dialog>全部收入背包</button></footer>`;
  };
  overlay.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pack-batch-page]");
    if (!button) return;
    page = Math.max(0, Math.min(pageCount - 1, page + (button.dataset.packBatchPage === "next" ? 1 : -1)));
    renderPage();
  });
  renderPage();
}

function leagueRewardPanelMarkup() {
  return "";
}

function leagueBaseMatchPlanMarkup(state, label) {
  const team = activeTacticsTeam();
  const fallback = state === "opening" ? { tactic:team.tactic, style:team.style, positionPreset:"position1" } : state === "leading" ? { tactic:"defensive", style:"counterAttack", positionPreset:"position2" } : { tactic:"positive", style:"possession", positionPreset:"position3" };
  const plan = ensureLeagueTacticalDraft().tacticalPlans[state] ?? fallback;
  return `<section class="league-match-plan"><header><b>${label}</b></header><div class="league-match-plan-fields"><label class="field"><span>比赛心态</span><select name="${state}Tactic">${Object.entries(TACTICS).map(([key,value]) => `<option value="${key}" ${plan.tactic === key ? "selected" : ""}>${value}</option>`).join("")}</select></label><label class="field"><span>基础打法</span><select name="${state}Style">${Object.entries(STYLES).map(([key,value]) => `<option value="${key}" ${plan.style === key ? "selected" : ""}>${value}</option>`).join("")}</select></label></div></section>`;
}

function leagueMatchPlanMarkup(state, label) {
  const plan = ensureLeagueTacticalDraft().tacticalPlans[state];
  const optionMarkup = (options, selected) => Object.entries(options).map(([key, value]) => `<option value="${key}" ${selected === key ? "selected" : ""}>${value}</option>`).join("");
  const presetFields = `<div class="league-match-plan-fields league-match-plan-preset-fields"><label class="field"><span>比赛心态</span><select name="${state}Tactic">${optionMarkup(TACTICS, plan.tactic)}</select></label><label class="field"><span>预设打法</span><select name="${state}Style">${optionMarkup(STYLES, plan.style)}</select></label></div>`;
  const inLabels = { attackDirection:"主攻方向", chanceCreation:"机会选择", longShots:"远射倾向", crossing:"传中倾向" };
  const outLabels = { defensiveWidth:"防守宽度", defenseDirection:"防守方向", marking:"盯人方式", lineStrategy:"防线策略" };
  const inFields = Object.entries(IN_POSSESSION_DETAIL_OPTIONS).map(([key, options]) => `<label class="field"><span>${inLabels[key]}</span><select name="${state}InDetail_${key}">${optionMarkup(options, plan.inPossessionDetails[key])}</select></label>`).join("");
  const outFields = Object.entries(OUT_OF_POSSESSION_DETAIL_OPTIONS).map(([key, options]) => `<label class="field"><span>${outLabels[key]}</span><select name="${state}OutDetail_${key}">${optionMarkup(options, plan.outOfPossessionDetails[key])}</select></label>`).join("");
  const dimensionFields = Object.entries(V2_TACTICAL_DIMENSIONS).map(([key, dimensionLabel]) => {
    const value = Math.max(0, Math.min(100, Math.round(Number(plan.tacticalDimensions?.[key] ?? 50))));
    return `<label class="league-tactical-dimension"><span>${dimensionLabel}<output data-tactical-dimension-output="${state}Dimension_${key}">${value}</output></span><input type="range" name="${state}Dimension_${key}" min="0" max="100" step="1" value="${value}"></label>`;
  }).join("");
  const dimensions = `<div class="league-tactical-dimensions">${dimensionFields}</div>`;
  const phaseInstructions = `<div class="league-phase-instructions"><section><header><b>持球进攻</b></header><div>${inFields}</div></section><section><header><b>无球防守</b></header><div>${outFields}</div></section></div>`;
  return `<section class="league-match-plan" data-plan-state="${state}"><header><b>${label}</b></header>${presetFields}${dimensions}${phaseInstructions}</section>`;
}

function legacyLeagueSquadMarkup() {
  const team = activeTacticsTeam();
  const roster = team.roster;
  if (!leagueStartingIds || leagueStartingIds.length !== 11 || leagueStartingIds.some((id) => !roster.some((player) => player.id === id))) {
    leagueStartingIds = roster.filter((player) => player.starter).map((player) => player.id).slice(0, 11);
    leaguePositionPresets = null;
  }
  if (!leaguePositionPresets) {
    const source = team.positionPresets ?? {};
    const base = structuredClone(team.positions);
    leaguePositionPresets = {
      position1:structuredClone(source.position1 ?? base),
      position2:structuredClone(source.position2 ?? base),
      position3:structuredClone(source.position3 ?? base),
    };
  }
  if (!leagueFormationLinePresets) {
    const source = team.formationLinePresets ?? {};
    leagueFormationLinePresets = Object.fromEntries(["position1", "position2", "position3"]
      .map((key) => [key, sanitizeFormationLines(source[key] ?? DEFAULT_FORMATION_LINES)]));
  }
  leaguePositions = leaguePositionPresets[leagueActivePositionPreset] ?? leaguePositionPresets.position1;
  const formationLines = leagueFormationLinePresets[leagueActivePositionPreset] ?? sanitizeFormationLines(DEFAULT_FORMATION_LINES);
  const startingSet = new Set(leagueStartingIds);
  const starters = roster.filter((player) => startingSet.has(player.id));
  const bench = roster.filter((player) => !startingSet.has(player.id)).sort(compareLeagueBenchPlayers);
  const shape = formationFromPositions(starters, leaguePositions, { requireOutfieldLines:leagueActivePositionPreset === "position1", formationLines });
  const presetShapes = Object.fromEntries(Object.entries(leaguePositionPresets).map(([key, positions]) => [key, formationFromPositions(starters, positions, { requireOutfieldLines:key === "position1", formationLines:leagueFormationLinePresets[key] })]));
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
  const tacticalFit = leagueTacticalFit(starters, shape.roles, leaguePositions, formationLines, activePlan);
  const tacticalLabel = tacticalFit >= 88 ? "高度适配" : tacticalFit >= 78 ? "适配良好" : tacticalFit >= 68 ? "基本适配" : "需要调整";
  const bonds = evaluateS4LineupBonds(starters, league.bondCatalog ?? [], { roles:shape.roles });
  const displayStarters = leagueBondDisplayLineup(starters, bonds);
  const magnets = displayStarters.map((player) => leagueBoardMagnet(player, leaguePositions[player.id] ?? { x:50, y:50 }, shape.roles[player.id])).join("");
  const bondReady = bonds.length
    ? `<div class="league-bond-ready">${bonds.map((bond) => `<span>${escapeHtml(String(bond.name).replace(/羁绊$/u, ""))} ${bond.count}/11 <em>+${(bond.bonus * 100).toFixed(1).replace(".0", "")}%</em></span>`).join("")}</div>`
    : "";
  const presetValidity = Object.fromEntries(Object.entries(presetShapes).map(([key, entry]) => [key, entry.valid]));
  const allPresetsValid = Object.values(presetValidity).every(Boolean);
  const positionLabels = { position1:"默认站位", position2:"领先站位", position3:"落后站位" };
  const positionTabs = `<nav class="league-position-tabs" aria-label="保存站位">${["position1", "position2", "position3"].map((key) => `<button type="button" data-league-position-preset="${key}" class="${leagueActivePositionPreset === key ? "active" : ""} ${presetValidity[key] ? "valid" : "invalid"}" aria-pressed="${leagueActivePositionPreset === key}">${positionLabels[key]}</button>`).join("")}</nav>`;
  const relationshipControls = `<label class="league-board-chemistry"><input type="checkbox" data-league-chemistry-toggle ${leagueShowChemistry ? "checked" : ""}><span>默契连线</span></label><label class="league-board-chemistry"><input type="checkbox" data-league-bond-bonus-toggle ${leagueShowBondBonuses ? "checked" : ""}><span>羁绊增益</span></label><label class="league-board-chemistry league-board-role-zones-toggle"><input type="checkbox" data-league-role-zones-toggle ${leagueShowRoleZones ? "checked" : ""}><span>位置阴影</span></label>`;
  const fitnessThreshold = normalizeLeagueFitnessThreshold(tacticalDraft.fitnessThreshold, 65);
  const fitnessControl = `<label class="league-board-fitness"><span>体力红线</span><input type="number" inputmode="numeric" name="fitnessThreshold" min="45" max="100" step="1" value="${fitnessThreshold}" aria-label="体力红线"><em>%</em></label>`;
  const schemes = team.lineupSchemes ?? [{ id:team.activeLineupSchemeId ?? "lineup-1", name:"方案 1" }];
  const assignmentValue = lineupSchemeCompetitionValue(team);
  const assignmentOptions = { all:"所有比赛", league:"联赛", cup:"杯赛", friendly:"友谊赛" };
  const assignmentSelect = `<label class="league-lineup-assignment"><span>适配赛事</span><select data-lineup-scheme-assignment aria-label="当前方案适配赛事">${Object.entries(assignmentOptions).map(([value, label]) => `<option value="${value}" ${assignmentValue === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
  const schemeSwitcher = `<div class="league-lineup-scheme-switcher"><label><span>阵容方案</span><select data-lineup-scheme-select aria-label="切换阵容方案">${schemes.map((scheme) => `<option value="${escapeHtml(scheme.id)}" ${scheme.id === team.activeLineupSchemeId ? "selected" : ""}>${escapeHtml(scheme.name)}</option>`).join("")}</select></label><button type="button" data-lineup-scheme-rename title="重命名当前方案" aria-label="重命名当前方案">✎</button>${schemes.length < 3 ? `<button type="button" data-lineup-scheme-create title="新增阵容方案" aria-label="新增阵容方案">＋</button>` : ""}<button type="button" class="danger" data-lineup-scheme-delete title="${schemes.length > 1 ? "删除当前方案" : "至少保留一套方案"}" aria-label="删除当前方案" ${schemes.length > 1 ? "" : "disabled"}>×</button>${assignmentSelect}</div>`;
  const boardToolbar = `<div class="league-board-controls"><div class="league-board-tool-stack"><div class="league-relationship-controls">${relationshipControls}${fitnessControl}</div><div class="league-board-toolbar">${positionTabs}</div></div><div class="league-board-side">${bondReady}${schemeSwitcher}</div></div>`;
  const previewMenu = `<details class="league-tactical-shape-preview-menu" data-league-tactical-shape-preview><summary title="仅预览当前所选默认、领先或落后站位对应的动态落位"><span><small>当前站位动态</small><b data-league-tactical-shape-preview-label>选择落位预览</b></span></summary><div class="league-tactical-shape-preview-list" role="list"><button type="button" data-league-tactical-shape-mode="base" role="listitem"><i>01</i><span><b>默认站位</b><small>回到当前战术板位置</small></span></button><button type="button" data-league-tactical-shape-mode="attack" role="listitem"><i>02</i><span><b>进攻落位</b><small>当前职责的持球目标位置</small></span></button><button type="button" data-league-tactical-shape-mode="defense" role="listitem"><i>03</i><span><b>防守落位</b><small>当前职责的禁区保护位置</small></span></button></div></details>`;
  const autosaveFooter = `<footer class="league-autosave-footer"><div class="league-autosave-status" data-league-autosave-status data-state="${leagueEditorDirty ? "pending" : "saved"}" role="status" aria-live="polite"><i aria-hidden="true"></i><span class="league-autosave-copy"><small>战术实时保存</small><b data-league-autosave-label>${leagueEditorDirty ? "等待自动保存" : "已实时保存"}</b></span></div>${previewMenu}</footer>`;
  const guidanceButtons = `<div class="league-bench-guidance" aria-label="阵容系统指导"><button type="button" data-league-auto-lineup title="默认站位可从全队选择首发；领先和落后站位只重排默认首发">自动替换球员</button><button type="button" data-league-auto-duties title="根据当前阶段、球员能力和位置适配度推荐职责">适配职责</button></div>`;
  const benchSummary = `<section class="league-bench-summary"><div class="league-bench-summary-title"><small>AUTO FORMATION</small><b>自动识别阵型</b></div><div class="league-bench-shape"><strong>${shape.name}</strong><span class="${shape.valid ? "valid" : "invalid"}">${shape.valid ? "阵型有效" : "需要调整"}</span></div><div class="league-fit-row"><div class="league-fit-block"><div class="league-fit-heading"><span>阵容适配度</span><b>${fitScore}<small>/100 · ${fitLabel}</small></b></div><div class="league-fit-bar"><span style="width:${fitScore}%"></span></div></div><div class="league-fit-block tactical"><div class="league-fit-heading"><span>战术适配度</span><b>${tacticalFit}<small>/100 · ${tacticalLabel}</small></b></div><div class="league-fit-bar"><span style="width:${tacticalFit}%"></span></div></div></div><div class="league-fit-counts"><span>主位置<b>${fitCounts.primary}</b></span><span>副位置<b>${fitCounts.secondary}</b></span><span>不适配<b>${fitCounts.unfamiliar}</b></span></div>${shape.valid ? "" : `<p>${shape.message}</p>`}</section>`;
  const matchPlans = `<section class="league-match-plans league-bench-match-plans"><header><b>赛中战术</b></header><div class="league-match-plan-grid">${leagueMatchPlanMarkup("opening", "默认战术")}${leagueMatchPlanMarkup("leading", "领先战术")}${leagueMatchPlanMarkup("trailing", "落后战术")}</div></section>`;
  return `<form class="league-tactics-layout" id="league-squad-form" data-tactics-mode="club">${leagueNextMatchMarkup()}<section class="league-lineup-workspace"><section class="board-panel league-board-panel"><header class="league-board-heading">${boardToolbar}</header>${pitchMarkup(`${formationRoleZonesMarkup(formationLines)}${formationReferenceLinesMarkup(formationLines)}${chemistryLines}${magnets}`, "league-tactics-pitch")}</section><aside class="tournament-bench league-bench"><header><div><small>FULL SQUAD</small><b>替补席 · ${bench.length}人</b></div><span>主力与替补磁贴可双向拖动交换</span>${guidanceButtons}</header><div class="bench-magnet-list">${bench.map(leagueBenchMagnet).join("")}</div>${benchSummary}${matchPlans}${autosaveFooter}</aside></section>${allPresetsValid ? "" : `<p class="league-position-save-warning">默认站位需要保持完整阵型；领先与落后站位只要求场上保留一名门将。</p>`}</form>`;
}

function leagueSquadMarkup() {
  const template = document.createElement("template");
  template.innerHTML = legacyLeagueSquadMarkup().trim();
  const workspace = template.content.querySelector(".league-lineup-workspace");
  const board = workspace?.querySelector(".league-board-panel");
  const bench = workspace?.querySelector(".league-bench");
  const summary = bench?.querySelector(".league-bench-summary");
  const plans = bench?.querySelector(".league-bench-match-plans");
  const saveStatus = bench?.querySelector("[data-league-autosave-status]");
  if (!workspace || !board || !bench || !summary || !plans || !saveStatus) return template.innerHTML;

  const detail = document.createElement("aside");
  detail.className = "league-tactics-detail";
  const mobilePlanLabels = { opening:"默认战术", leading:"领先战术", trailing:"落后战术" };
  const mobilePlanTabs = `<nav class="league-mobile-plan-tabs" aria-label="手机端比赛阶段">${Object.entries(mobilePlanLabels).map(([key, label]) => `<button type="button" data-league-mobile-plan="${key}" class="${leagueMobileTacticalPlanState === key ? "active" : ""}" aria-pressed="${leagueMobileTacticalPlanState === key}">${label}</button>`).join("")}</nav>`;
  const mirrorUpload = league?.mirrorMarketplace;
  const lineupShareActions = `<div class="league-lineup-share-actions"><button type="button" class="button secondary" data-lineup-share-export>导出</button><button type="button" class="button secondary" data-lineup-share-import>导入</button></div>`;
  const captainDraft = ensureLeagueTacticalDraft();
  const captainPlayers = leagueStartingIds.map((id) => activeTacticsTeam().roster.find((player) => player.id === id)).filter(Boolean);
  if (!captainPlayers.some((player) => player.id === captainDraft.captainId)) captainDraft.captainId = null;
  const captainOptions = `<option value="">未设置队长</option>${captainPlayers.map((player) => `<option value="${escapeHtml(player.id)}" ${player.id === captainDraft.captainId ? "selected" : ""}>${escapeHtml(player.name)}</option>`).join("")}`;
  const captainStyleOptions = Object.entries(CAPTAIN_STYLES).map(([id, style]) => `<option value="${id}" ${id === captainDraft.captainStyle ? "selected" : ""} title="${escapeHtml(style.summary)}">${escapeHtml(style.name)}</option>`).join("");
  const captainControls = `<div class="league-captain-controls" aria-label="当前阵容方案队长设置"><label><span>场上队长</span><select name="captainId" data-league-captain-select>${captainOptions}</select></label><label><span>队长风格</span><select name="captainStyle" data-league-captain-style>${captainStyleOptions}</select></label></div>`;
  const mirrorUploadLabel = mirrorUpload?.fullUploadLocked
    ? `今日${mirrorUpload.forcedSeed}号种子 · 系统已强制上传${mirrorUpload.fullUploadCount}套战术板`
    : "上传完整战术镜像";
  const aiTrainingButton = `<div class="league-ai-training-actions"><label class="league-mirror-upload"><input type="checkbox" data-mirror-upload ${mirrorUpload?.fullUploadEnabled ? "checked" : ""} ${mirrorUpload?.fullUploadLocked ? "disabled" : ""}><span>${mirrorUploadLabel}</span></label><button type="button" class="button secondary league-ai-training-open" data-ai-training-open title="使用当前已保存阵容进行 V2 AI 对战"><span aria-hidden="true">▶</span> AI 对战</button></div>`;
  const nodeOptions = (selected) => [1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${Number(selected) === value ? "selected" : ""}>${value === 5 ? "5+" : value} 球</option>`).join("");
  const nodeControls = `<div class="league-tactical-node-controls"><label><span>领先战术节点</span><select name="leadingTriggerGoalDifference">${nodeOptions(ensureLeagueTacticalDraft().tacticalPlans.leading.triggerGoalDifference)}</select></label><label><span>落后战术节点</span><select name="trailingTriggerGoalDifference">${nodeOptions(ensureLeagueTacticalDraft().tacticalPlans.trailing.triggerGoalDifference)}</select></label></div>`;
  detail.innerHTML = `<header><div class="league-tactics-detail-title"><span><small>V2 TACTICAL CONTROL</small><b>细节战术</b></span>${nodeControls}${aiTrainingButton}</div></header>${mobilePlanTabs}<div class="league-tactics-detail-scroll"></div>`;
  detail.querySelector(".league-tactics-detail-title>span")?.insertAdjacentHTML("afterend", lineupShareActions);
  detail.querySelector(".league-tactics-detail-title>span")?.insertAdjacentHTML("afterend", captainControls);
  const scroll = detail.querySelector(".league-tactics-detail-scroll");
  scroll.append(summary, plans);
  workspace.append(detail);
  template.content.querySelector("#league-squad-form")?.setAttribute("data-active-mobile-plan", leagueMobileTacticalPlanState);
  return `<section class="league-squad-page">${template.innerHTML}${leagueMobileDutySheetMarkup()}</section>`;
}

function aiTrainingOptionMarkup(options, selected) {
  return Object.entries(options).map(([key, label]) => `<option value="${escapeHtml(key)}" ${key === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function openComputeNodeCredentialDialog(credential, concurrency = 1) {
  const serverUrl = globalThis.location?.origin ?? "https://你的游戏服务器";
  const command = `$env:YDL_MIRROR_WORKER_TOKEN='${credential.token}'\n.\\devtool\\start-mirror-compute-node.ps1 -ServerUrl '${serverUrl}' -WorkerId '${credential.nodeId}' -Concurrency ${concurrency} -AcceptJobs true`;
  const expiresAt = new Date(Number(credential.expiresAt)).toLocaleString("zh-CN", { hour12:false });
  const overlay = openLeagueDialog(`<header><div><small>WORKER CREDENTIAL</small><h2>节点密钥已生成</h2><p>本次密钥有效至${escapeHtml(expiresAt)}（12小时），只显示一次。</p></div><button type="button" class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="compute-node-credential"><ol><li>节点电脑安装Node.js 22，并放置与服务器同版本的完整项目源码。</li><li>在项目根目录打开PowerShell。</li><li>复制并执行以下两行命令；无需公网IP或端口映射。</li><li>终端显示“玩家计算节点已连接”后，返回游戏即可在节点列表使用。</li></ol><code>${escapeHtml(command)}</code><button type="button" class="button primary" data-compute-node-copy>复制启动命令</button></div>`, "compute-node-dialog", { dismissOnBackdrop:false });
  overlay.querySelector("[data-compute-node-copy]")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(command);
    showToast("启动命令已复制");
  });
}

function openComputeNodeMarketDialog() {
  const ownNodes = league.mirrorMarketplace?.ownComputeNodes ?? [];
  const rows = ownNodes.length
    ? ownNodes.map((node) => `<li><span><b>${escapeHtml(node.label)}</b><small>${node.visibility === "public" ? "公开给所有玩家" : "仅自己使用"} · ${node.online ? node.acceptingJobs ? "在线接单" : "在线待机" : "离线"} · ${Number(node.capacity ?? 1)}槽 · ${node.credentialExpiresAt ? `密钥至${new Date(Number(node.credentialExpiresAt)).toLocaleString("zh-CN", { hour12:false })}` : "管理员常驻密钥"}</small></span><div><button type="button" class="button secondary" data-compute-node-rotate="${escapeHtml(node.id)}">重置密钥</button><button type="button" class="button danger" data-compute-node-remove="${escapeHtml(node.id)}">删除</button></div></li>`).join("")
    : "<li class=\"empty\">尚未挂载自己的电脑</li>";
  const overlay = openLeagueDialog(`<header><div><small>COMMUNITY COMPUTE</small><h2>玩家计算节点市场</h2><p>自己的节点免收30%系统服务费；公开节点可供其他玩家选择。玩家密钥单次有效12小时，主任节点为管理员常驻节点。</p></div><button type="button" class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="compute-node-market"><ul>${rows}</ul><form data-compute-node-create><label><span>节点名称</span><input name="label" maxlength="40" required placeholder="我的游戏电脑"></label><label><span>计算槽位</span><select name="maximumConcurrency">${[1,2,3,4,5].map((value) => `<option value="${value}">${value}</option>`).join("")}</select></label><label><span>使用范围</span><select name="visibility"><option value="private">仅自己使用</option><option value="public">公开给所有玩家</option></select></label><footer><button type="submit" class="button primary">生成12小时节点密钥</button></footer></form></div>`, "compute-node-dialog");
  overlay.querySelector("[data-compute-node-create]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const value = await api("/api/versus/league/mirror-marketplace/compute-node/save", { method:"POST", body:leagueIdentity({ label:data.get("label"), maximumConcurrency:Number(data.get("maximumConcurrency")), visibility:data.get("visibility"), rotateToken:true }) });
      league.mirrorMarketplace = value.mirrorMarketplace;
      closeLeagueDialog();
      openComputeNodeCredentialDialog(value.workerCredential, Number(data.get("maximumConcurrency")));
    } catch (error) { showToast(error.message); }
  });
  overlay.querySelectorAll("[data-compute-node-rotate]").forEach((button) => button.addEventListener("click", async () => {
    const node = ownNodes.find((entry) => entry.id === button.dataset.computeNodeRotate);
    try {
      const value = await api("/api/versus/league/mirror-marketplace/compute-node/save", { method:"POST", body:leagueIdentity({ nodeId:node.id, label:node.label, maximumConcurrency:node.capacity, visibility:node.visibility, rotateToken:true }) });
      league.mirrorMarketplace = value.mirrorMarketplace;
      closeLeagueDialog();
      openComputeNodeCredentialDialog(value.workerCredential, node.capacity);
    } catch (error) { showToast(error.message); }
  }));
  overlay.querySelectorAll("[data-compute-node-remove]").forEach((button) => button.addEventListener("click", async () => {
    if (!globalThis.confirm("确定删除这个计算节点并撤销密钥吗？")) return;
    try {
      const value = await api("/api/versus/league/mirror-marketplace/compute-node/remove", { method:"POST", body:leagueIdentity({ nodeId:button.dataset.computeNodeRemove }) });
      league.mirrorMarketplace = value.mirrorMarketplace;
      closeLeagueDialog();
      openComputeNodeMarketDialog();
    } catch (error) { showToast(error.message); }
  }));
}
function openMirrorBatchCapacityDialog(entries = []) {
  const nodeId = entries[0]?.executionNode ?? "cloud";
  const node = (league.mirrorMarketplace?.batchNodes ?? []).find((entry) => entry.id === nodeId);
  const capacity = Number(node?.capacity ?? (nodeId === "cloud" ? 2 : 1));
  const nodeLabel = node?.label ?? "计算节点";
  const rows = entries.map((entry) => `<li><span><b>${escapeHtml(entry.ownerName ?? "未知玩家")}</b><small>${escapeHtml(entry.teamName ?? "未知球队")}</small></span><strong>还剩 ${Number(entry.remainingMatches ?? 0)} 场</strong></li>`).join("");
  openLeagueDialog(`<header><div><small>MIRROR BATCH QUEUE</small><h2>${nodeLabel}任务已满</h2><p>${nodeLabel}当前最多并发处理${capacity}名玩家的批量模拟任务。</p></div><button type="button" class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="mirror-batch-capacity-body"><p>以下玩家的批量模拟正在进行，请等待其中一份完成后再试。你的金币尚未扣除。</p><ul>${rows}</ul><footer><button type="button" class="button primary" data-close-league-dialog>知道了</button></footer></div>`, "mirror-batch-capacity-dialog", { dismissOnBackdrop:false });
}
function aiTrainingDialogMarkup() {
  const defaults = ensureLeagueTacticalDraft()?.tacticalPlans ?? {};
  const formationOptions = aiTrainingOptionMarkup({"4-3-3":"4-3-3", "4-4-2":"4-4-2", "4-2-3-1":"4-2-3-1", "4-1-4-1":"4-1-4-1", "3-4-3":"3-4-3", "3-5-2":"3-5-2", "5-3-2":"5-3-2", "5-4-1":"5-4-1"}, "4-3-3");
  const mirrorEntries = league.season?.status === "active" ? [] : (league.mirrorMarketplace?.entries ?? []);
  const mirrorOptions = mirrorEntries.map((entry) => `<option value="mirror:${escapeHtml(entry.teamId)}:${escapeHtml(entry.kind)}:${escapeHtml(entry.mirrorSchemeId ?? "")}" data-price="${entry.price}">${entry.forcedSeed ? `${entry.forcedSeed}号种子 · ` : ""}${escapeHtml(entry.ownerName ?? entry.teamName)} · ${entry.kind === "full" ? `完整战术镜像${entry.mirrorSchemeName ? ` · ${escapeHtml(entry.mirrorSchemeName)}` : ""}` : "基础镜像"} · ${entry.price}金币</option>`).join("");
  const opponentOptions = `<optgroup label="系统阵型 · 免费">${formationOptions}</optgroup>${mirrorOptions ? `<optgroup label="休赛期玩家镜像">${mirrorOptions}</optgroup>` : ""}`;
  const phases = [["opening", "默认战术"], ["leading", "领先战术"], ["trailing", "落后战术"]];
  const phaseMarkup = phases.map(([state, label]) => {
    const plan = defaults[state] ?? {};
    return `<section class="ai-training-phase"><header><b>${label}</b></header><div><label><span>比赛心态</span><select name="${state}Tactic">${aiTrainingOptionMarkup(TACTICS, plan.tactic ?? "balanced")}</select></label><label><span>基础打法</span><select name="${state}Style">${aiTrainingOptionMarkup(STYLES, plan.style ?? "possession")}</select></label></div></section>`;
  }).join("");
  const batchDefaultCount = Number(league.mirrorMarketplace?.batchMatchCount ?? 10);
  const batchMinimumCount = Number(league.mirrorMarketplace?.batchMinimumMatchCount ?? 10);
  const batchMaximumCount = Number(league.mirrorMarketplace?.batchMaximumMatchCount ?? 50);
  const batchFeePercent = Math.round(Number(league.mirrorMarketplace?.batchServiceFeeRate ?? .3) * 100);
  const activeBatch = league.mirrorMarketplace?.activeBatchJob;
  const selectedBatchCount = Number(activeBatch?.totalMatches ?? batchDefaultCount);
  const batchCountOptions = Array.from({ length:Math.floor((batchMaximumCount - batchMinimumCount) / 10) + 1 }, (_, index) => batchMinimumCount + index * 10)
    .map((count) => `<option value="${count}" ${count === selectedBatchCount ? "selected" : ""}>${count}场</option>`).join("");
  const batchCopy = activeBatch
    ? `队列进行中 · ${Number(activeBatch.completedMatches ?? 0)}/${Number(activeBatch.totalMatches ?? selectedBatchCount)}`
    : "批量模拟";
  const batchControl = `<label class="ai-training-batch-option ${activeBatch ? "is-running" : ""}"><input type="checkbox" name="batchSimulation" value="true" data-ai-training-batch ${activeBatch ? "disabled" : ""}><span><b>${batchCopy}</b><small>10–50场 · 批量单场价为普通单场1/3 · 自有节点免${batchFeePercent}%服务费</small></span><select name="batchMatchCount" data-ai-training-batch-count aria-label="批量模拟场次" ${activeBatch ? "disabled" : ""}>${batchCountOptions}</select></label>`;
  const batchNodes = league.mirrorMarketplace?.batchNodes ?? [{ id:"cloud", label:"云服务器", online:true, acceptingJobs:true, status:"accepting", capacity:2, availableSlots:2, estimatedSeconds:1_350, surchargePerMatch:0 }];
  const batchNodeStateText = (node) => !node.online ? "离线" : node.acceptingJobs === false ? "在线待机" : Number(node.availableSlots ?? 0) <= 0 ? "任务已满" : `可接单 · ${Number(node.availableSlots ?? 0)}/${Number(node.capacity ?? 0)}空闲`;
  const batchNodeOptions = batchNodes.map((node) => `<option value="${escapeHtml(node.id)}" ${node.id !== "cloud" && (!node.online || node.acceptingJobs === false) ? "disabled" : ""}>${node.isOwned ? "我的节点 · " : ""}${escapeHtml(node.label)} · ${batchNodeStateText(node)}${node.isOwned ? " · 免服务费" : ""}${node.online && node.acceptingJobs !== false && Number(node.availableSlots ?? 0) > 0 ? ` · 约${Number(node.estimatedSeconds ?? 0) <= 180 ? "2分钟" : "22–25分钟"}` : ""}</option>`).join("");
  const batchNodeControl = `<label class="ai-training-node-option" data-ai-training-node hidden><span>运行节点</span><select name="executionNode" data-ai-training-node-select>${batchNodeOptions}</select><small data-ai-training-node-status></small></label>`;
  const computeNodeSettingsControl = `<button type="button" class="button secondary ai-training-compute-node-open" data-compute-nodes-open>管理计算节点</button>`;
  return `<header><div><small>AI TACTICAL MATCH</small><h2>AI 对战</h2><p>系统阵型免费；玩家镜像按列表价格收费。</p></div><button type="button" class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><form class="ai-training-form"><section class="ai-training-basics"><label><span>AI 阵型 / 镜像</span><select name="formation" data-ai-training-opponent>${opponentOptions}</select></label><label data-ai-training-average><span>AI 平均能力</span><output data-ai-training-overall-output>82</output><input type="range" name="averageOverall" min="62" max="95" step="1" value="82"></label><label><span>主攻方向</span><select name="attackFocus">${aiTrainingOptionMarkup(FOCUSES, "balanced")}</select></label><label><span>主守方向</span><select name="defenseFocus">${aiTrainingOptionMarkup(FOCUSES, "balanced")}</select></label></section><div class="ai-training-phases">${phaseMarkup}</div><footer><span data-ai-training-price>系统阵型免费 · 当前金币 ${Number(league.wallet.balance).toLocaleString("zh-CN")}</span>${batchControl}${batchNodeControl}${computeNodeSettingsControl}<button type="submit" class="button primary" data-ai-training-submit><span aria-hidden="true">▶</span> 开始对战</button></footer></form>`;
}

function openAiTrainingDialog() {
  const overlay = openLeagueDialog(aiTrainingDialogMarkup(), "ai-training-dialog");
  overlay.querySelector("[data-compute-nodes-open]")?.addEventListener("click", openComputeNodeMarketDialog);
  const form = overlay.querySelector(".ai-training-form");
  const overall = form?.elements.namedItem("averageOverall");
  const output = overlay.querySelector("[data-ai-training-overall-output]");
  const opponent = form?.elements.namedItem("formation");
  const averageField = overlay.querySelector("[data-ai-training-average]");
  const priceText = overlay.querySelector("[data-ai-training-price]");
  const batch = overlay.querySelector("[data-ai-training-batch]");
  const batchCountSelect = overlay.querySelector("[data-ai-training-batch-count]");
  const nodeField = overlay.querySelector("[data-ai-training-node]");
  const nodeSelect = overlay.querySelector("[data-ai-training-node-select]");
  const nodeStatus = overlay.querySelector("[data-ai-training-node-status]");
  const submit = form?.querySelector("[data-ai-training-submit]");
  const activeBatch = league.mirrorMarketplace?.activeBatchJob;
  const batchNodes = league.mirrorMarketplace?.batchNodes ?? [];
  const selectedBatchCount = () => Math.max(10, Math.min(50, Number(batchCountSelect?.value ?? league.mirrorMarketplace?.batchMatchCount ?? 10)));
  const batchFeeRate = Number(league.mirrorMarketplace?.batchServiceFeeRate ?? .3);
  let batchRequestId = null;
  const batchPriceDivisor = Number(league.mirrorMarketplace?.batchPriceDivisor ?? 3);
  const selectedNode = () => batchNodes.find((node) => node.id === String(nodeSelect?.value ?? "cloud")) ?? { id:"cloud", label:"云服务器", online:true, acceptingJobs:true, status:"accepting", capacity:2, activeJobs:[], surchargePerMatch:0 };
  const selectedNodeHasCapacity = (showDialog = false) => {
    const node = selectedNode();
    if (!node.online || node.acceptingJobs === false) {
      if (showDialog) showToast(node.online ? `${node.label}当前在线待机，尚未开启接受计算服务` : `${node.label}当前离线，请选择云服务器`);
      return false;
    }
    const activeJobs = node.activeJobs ?? [];
    if (activeJobs.length >= Number(node.capacity ?? 0)) {
      if (showDialog) openMirrorBatchCapacityDialog(activeJobs);
      return false;
    }
    return true;
  };
  const syncOpponentType = () => {
    const mirror = String(opponent?.value ?? "").startsWith("mirror:");
    if (overall) overall.disabled = mirror;
    averageField?.classList.toggle("mirror-selected", mirror);
    if (output) output.textContent = mirror ? "镜像" : overall.value;
    if (batch) batch.disabled = Boolean(activeBatch);
    const price = Number(opponent?.selectedOptions?.[0]?.dataset.price ?? 0);
    const batched = Boolean(batch?.checked);
    const batchCount = selectedBatchCount();
    if (nodeField) nodeField.hidden = !batched;
    if (nodeSelect) nodeSelect.disabled = !batched;
    const node = selectedNode();
    const nodeState = !node.online ? "offline" : node.acceptingJobs === false ? "standby" : Number(node.availableSlots ?? 0) <= 0 ? "full" : "accepting";
    if (nodeStatus) {
      nodeStatus.dataset.state = nodeState;
      nodeStatus.textContent = ({ offline:"● 离线", standby:"● 在线待机 · 未接受任务", full:"● 在线 · 任务已满", accepting:`● 在线 · 接受任务 · ${Number(node.availableSlots ?? 0)}/${Number(node.capacity ?? 0)}空闲` })[nodeState];
    }
    const batchSubtotal = Math.round(price * batchCount / batchPriceDivisor);
    const selectedServiceFeeRate = Number(node.serviceFeeRate ?? batchFeeRate);
    const serviceFee = batched ? Math.round(batchSubtotal * selectedServiceFeeRate) : 0;
    const batchTotal = batchSubtotal + serviceFee;
    if (priceText) priceText.textContent = batched
      ? mirror
        ? `${price}金币单场 × ${batchCount}场 ÷ ${batchPriceDivisor} = ${batchSubtotal.toLocaleString("zh-CN")}金币${serviceFee ? ` + ${Math.round(selectedServiceFeeRate * 100)}%系统服务费${serviceFee.toLocaleString("zh-CN")}金币` : " · 自有节点免服务费"}，共${batchTotal.toLocaleString("zh-CN")}金币 · 当前金币 ${Number(league.wallet.balance).toLocaleString("zh-CN")}`
        : `系统AI批量模拟${batchCount}场免费 · 使用${node.label} · 当前金币 ${Number(league.wallet.balance).toLocaleString("zh-CN")}`
      : mirror ? `本次调用 ${price} 金币 · 当前金币 ${Number(league.wallet.balance).toLocaleString("zh-CN")}`
      : `系统阵型免费 · 当前金币 ${Number(league.wallet.balance).toLocaleString("zh-CN")}`;
    if (submit) submit.innerHTML = batched ? `<span aria-hidden="true">≡</span> 加入${escapeHtml(node.label)}队列` : `<span aria-hidden="true">▶</span> 开始对战`;
  };
  overall?.addEventListener("input", () => { if (output) output.textContent = overall.value; });
  opponent?.addEventListener("change", syncOpponentType);
  batch?.addEventListener("change", syncOpponentType);
  batchCountSelect?.addEventListener("change", syncOpponentType);
  nodeSelect?.addEventListener("change", () => {
    selectedNodeHasCapacity(true);
    syncOpponentType();
  });
  syncOpponentType();
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit) submit.disabled = true;
    try {
      clearTimeout(leagueAutoSaveTimer);
      await saveLeagueTeamNow();
      for (let attempt = 0; attempt < 30 && (leagueAutoSavePending || leagueEditorDirty); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 80));
      if (leagueEditorDirty || leagueAutoSavePending) throw new Error("当前阵容仍在保存，请稍后再试");
      const data = new FormData(form);
      const opponentValue = String(data.get("formation") ?? "4-3-3");
      const mirrorParts = opponentValue.startsWith("mirror:") ? opponentValue.split(":") : [];
      const mirrorTeamId = mirrorParts[1] ?? null;
      const mirrorKind = mirrorParts[2] ?? "basic";
      const mirrorSchemeId = mirrorParts[3] || null;
      const tacticalPlans = Object.fromEntries(["opening", "leading", "trailing"].map((state) => [state, { tactic:data.get(`${state}Tactic`), style:data.get(`${state}Style`) }]));
      const payload = leagueIdentity({
        formation:mirrorTeamId ? null : opponentValue,
        mirrorTeamId,
        mirrorKind,
        mirrorSchemeId,
        averageOverall:mirrorTeamId ? null : Number(data.get("averageOverall")),
        attackFocus:data.get("attackFocus"),
        defenseFocus:data.get("defenseFocus"),
        tacticalPlans,
      });
      if (data.get("batchSimulation")) {
        if (!selectedNodeHasCapacity(true)) throw new Error(`${selectedNode().label}当前不可用`);
        batchRequestId ??= globalThis.crypto?.randomUUID?.() ?? `mirror-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const executionNode = String(data.get("executionNode") ?? "cloud");
        const value = await api("/api/versus/league/mirror-marketplace/batch-simulate", { method:"POST", body:{ ...payload, requestId:batchRequestId, executionNode, totalMatches:Number(data.get("batchMatchCount") ?? 10) } });
        if (value.wallet) league.wallet = value.wallet;
        league.inboxUnreadCount = Number(value.inboxUnreadCount ?? league.inboxUnreadCount);
        league.mirrorMarketplace = { ...league.mirrorMarketplace, activeBatchJob:value.mirrorBatchJob };
        closeLeagueDialog();
        const nodeLabel = selectedNode().label;
        showToast(`${Number(value.mirrorBatchJob.totalMatches)}场批量模拟已加入${nodeLabel}，已扣除${Number(value.mirrorBatchJob.totalCost).toLocaleString("zh-CN")}金币；完成后将发送系统邮件`);
        return;
      }
      const value = await api("/api/versus/league/ai-training/start", { method:"POST", body:payload });
      if (Number.isFinite(Number(value.walletBalance))) league.wallet.balance = Number(value.walletBalance);
      closeLeagueDialog();
      spectatorSession = { code:value.broadcast.code, token:value.spectatorToken, aiTraining:true };
      spectatorPollingFailures = 0;
      lastBroadcastRenderFingerprint = null;
      renderBroadcast(value.broadcast);
      scheduleSpectatorPolling();
      showToast(`AI 对战已开始，实际平均能力 ${value.actualAverageOverall}`);
    } catch (error) {
      if (submit) submit.disabled = false;
      if (error.status === 409 && Array.isArray(error.details) && error.details.length) {
        openMirrorBatchCapacityDialog(error.details);
        return;
      }
      showToast(error.message);
    }
  });
}
function formationReferenceLinesMarkup(lines) {
  const labels = { attack:"锋线", midfield:"中场线", defense:"后卫线", goalkeeper:"门将线" };
  return FORMATION_LINE_KEYS.map((key) => `<button type="button" class="formation-reference-line line-${key}" data-formation-line="${key}" style="top:${lines[key]}%" aria-label="拖动${labels[key]}"><i></i></button>`).join("");
}

function formationRoleZonesMarkup(lines) {
  if (!leagueShowRoleZones) return "";
  const zones = formationRoleZones(lines).map((zone) => {
    const style = `left:${zone.xMin}%;top:${zone.yMin}%;width:${zone.xMax - zone.xMin}%;height:${zone.yMax - zone.yMin}%`;
    return `<span class="formation-role-zone role-${zone.role.toLowerCase()}" style="${style}" data-formation-role-zone="${zone.role}"><b>${escapeHtml(ROLE_LABELS[zone.role] ?? zone.role)}</b><small>${zone.role}</small></span>`;
  }).join("");
  return `<div class="formation-role-zones" aria-label="位置自动识别区域">${zones}</div>`;
}

function leagueChemistryLinesMarkup(starters, positions, roles) {
  if (!leagueShowChemistry) return "";
  const starterIds = new Set(starters.map((player) => player.id));
  const group = (role) => role === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(role) ? "DEF" : ["ST", "LW", "RW"].includes(role) ? "ATT" : "MID";
  const lines = (activeTacticsTeam().chemistryLinks ?? []).filter((link) => {
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

function refreshLeagueSquadPositionUi() {
  const currentForm = document.querySelector("#league-squad-form");
  if (!currentForm) return renderLeague();
  const template = document.createElement("template");
  template.innerHTML = leagueSquadMarkup().trim();
  const nextForm = template.content.querySelector("#league-squad-form");
  const currentPitch = currentForm.querySelector("#league-tactics-pitch");
  const nextPitch = nextForm?.querySelector("#league-tactics-pitch");
  if (!nextForm || !currentPitch || !nextPitch) return renderLeague();

  const currentMagnets = new Map([...currentPitch.querySelectorAll("[data-league-magnet]")]
    .map((magnet) => [magnet.dataset.leagueMagnet, magnet]));
  for (const nextMagnet of nextPitch.querySelectorAll("[data-league-magnet]")) {
    const currentMagnet = currentMagnets.get(nextMagnet.dataset.leagueMagnet);
    if (!currentMagnet) return renderLeague();
    for (const attribute of [...currentMagnet.attributes]) {
      if (!nextMagnet.hasAttribute(attribute.name)) currentMagnet.removeAttribute(attribute.name);
    }
    for (const attribute of nextMagnet.attributes) currentMagnet.setAttribute(attribute.name, attribute.value);
    currentMagnet.innerHTML = nextMagnet.innerHTML;
  }

  const nextReferenceLines = new Map([...nextPitch.querySelectorAll("[data-formation-line]")]
    .map((line) => [line.dataset.formationLine, line]));
  for (const line of currentPitch.querySelectorAll("[data-formation-line]")) {
    const nextLine = nextReferenceLines.get(line.dataset.formationLine);
    if (!nextLine) continue;
    line.style.top = nextLine.style.top;
    line.setAttribute("aria-label", nextLine.getAttribute("aria-label"));
    line.removeAttribute("title");
  }

  const currentLines = currentPitch.querySelector(".league-chemistry-lines");
  const nextLines = nextPitch.querySelector(".league-chemistry-lines");
  if (currentLines && nextLines) currentLines.replaceWith(nextLines.cloneNode(true));
  else if (currentLines) currentLines.remove();
  else if (nextLines) currentPitch.insertBefore(nextLines.cloneNode(true), currentPitch.firstChild);

  const currentZones = currentPitch.querySelector(".formation-role-zones");
  const nextZones = nextPitch.querySelector(".formation-role-zones");
  if (currentZones && nextZones) currentZones.replaceWith(nextZones.cloneNode(true));
  else if (currentZones) currentZones.remove();
  else if (nextZones) currentPitch.insertBefore(nextZones.cloneNode(true), currentPitch.firstChild);

  const currentSummary = currentForm.querySelector(".league-bench-summary");
  const nextSummary = nextForm.querySelector(".league-bench-summary");
  if (currentSummary && nextSummary) currentSummary.replaceWith(nextSummary.cloneNode(true));

  const currentControls = currentForm.querySelector(".league-board-controls");
  const currentBond = currentControls?.querySelector(".league-bond-ready");
  const nextBond = nextForm.querySelector(".league-bond-ready");
  if (currentBond && nextBond) currentBond.replaceWith(nextBond.cloneNode(true));
  else if (currentBond) currentBond.remove();
  else if (nextBond) {
    const currentSide = currentControls?.querySelector(".league-board-side");
    if (currentSide) currentSide.insertBefore(nextBond.cloneNode(true), currentSide.firstChild);
  }

  const nextPresetButtons = new Map([...nextForm.querySelectorAll("[data-league-position-preset]")]
    .map((button) => [button.dataset.leaguePositionPreset, button]));
  for (const button of currentForm.querySelectorAll("[data-league-position-preset]")) {
    const nextButton = nextPresetButtons.get(button.dataset.leaguePositionPreset);
    if (!nextButton) continue;
    button.className = nextButton.className;
    button.setAttribute("aria-pressed", nextButton.getAttribute("aria-pressed"));
  }

  const currentWarning = currentForm.querySelector(".league-position-save-warning");
  const nextWarning = nextForm.querySelector(".league-position-save-warning");
  if (currentWarning && nextWarning) currentWarning.replaceWith(nextWarning.cloneNode(true));
  else if (currentWarning) currentWarning.remove();
  else if (nextWarning) currentForm.appendChild(nextWarning.cloneNode(true));
}

function swapLeagueStarter(benchId, starterId) {
  const index = leagueStartingIds.indexOf(starterId);
  if (index < 0) return;
  leagueStartingIds[index] = benchId;
  Object.values(leaguePositionPresets ?? {}).forEach((positions) => {
    positions[benchId] = { ...(positions[starterId] ?? { x:50, y:45 }) };
    delete positions[starterId];
  });
  Object.values(ensureLeagueTacticalDraft().tacticalPlans).forEach((plan) => {
    if (!Object.hasOwn(plan.playerDuties ?? {}, starterId)) return;
    plan.playerDuties[benchId] = plan.playerDuties[starterId];
    delete plan.playerDuties[starterId];
  });
  leaguePositions = leaguePositionPresets?.[leagueActivePositionPreset] ?? leaguePositions;
  renderLeague();
  scheduleLeagueTeamAutoSave(180);
}

function bindLeagueMagnetTooltips() {
  document.querySelector(".league-magnet-tooltip")?.remove();
  if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
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

function frameThrottlePointerMove(handler) {
  let animationFrame = null;
  let pendingPoint = null;
  const applyPending = () => {
    animationFrame = null;
    const point = pendingPoint;
    pendingPoint = null;
    if (point) handler(point);
  };
  const listener = (event) => {
    pendingPoint = { clientX:event.clientX, clientY:event.clientY };
    if (animationFrame === null) animationFrame = requestAnimationFrame(applyPending);
  };
  listener.flush = (event) => {
    pendingPoint = { clientX:event.clientX, clientY:event.clientY };
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    applyPending();
  };
  listener.cancel = () => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    pendingPoint = null;
  };
  return listener;
}

function bindLeagueSquad() {
  bindLeagueMagnetTooltips();
  document.querySelector("[data-lineup-scheme-select]")?.addEventListener("change", async (event) => {
    event.stopPropagation();
    const select = event.currentTarget;
    select.disabled = true;
    try {
      await mutateLineupScheme({ action:"select", lineupSchemeId:select.value });
      showToast("已切换阵容方案");
    } catch (error) {
      select.value = league.ownTeam.activeLineupSchemeId;
      select.disabled = false;
      showToast(error.message);
    }
  });
  document.querySelector("[data-lineup-scheme-rename]")?.addEventListener("click", async () => {
    const current = league.ownTeam.lineupSchemes?.find((scheme) => scheme.id === league.ownTeam.activeLineupSchemeId);
    const name = window.prompt("输入新的方案名称（最多20个字符）", current?.name ?? "");
    if (name === null) return;
    try {
      await mutateLineupScheme({ action:"rename", lineupSchemeId:league.ownTeam.activeLineupSchemeId, name });
      showToast("方案名称已更新");
    } catch (error) { showToast(error.message); }
  });
  document.querySelector("[data-lineup-scheme-create]")?.addEventListener("click", async () => {
    const defaultName = `方案 ${(league.ownTeam.lineupSchemes?.length ?? 1) + 1}`;
    const name = window.prompt("为新方案命名（最多20个字符）", defaultName);
    if (name === null) return;
    try {
      await mutateLineupScheme({ action:"create", name });
      showToast("已创建并切换到新方案");
    } catch (error) { showToast(error.message); }
  });
  document.querySelector("[data-lineup-scheme-delete]")?.addEventListener("click", () => {
    const schemes = league.ownTeam.lineupSchemes ?? [];
    const current = schemes.find((scheme) => scheme.id === league.ownTeam.activeLineupSchemeId);
    if (!current || schemes.length <= 1) return showToast("至少需要保留一套有效阵容方案");
    openLeagueConfirm({
      title:"删除阵容方案",
      text:`确定删除“${current.name}”吗？删除后无法恢复，并会自动切换到剩余方案。`,
      confirmText:"删除方案",
      onConfirm:async () => {
        closeLeagueDialog();
        await mutateLineupScheme({ action:"delete", lineupSchemeId:current.id });
        showToast("阵容方案已删除");
      },
    });
  });
  document.querySelector("[data-lineup-share-export]")?.addEventListener("click", () => {
    exportLeagueLineupShare().catch((error) => showToast(error.message));
  });
  document.querySelector("[data-lineup-share-import]")?.addEventListener("click", openLeagueLineupImport);
  document.querySelector("[data-lineup-scheme-assignment]")?.addEventListener("change", async (event) => {
    event.stopPropagation();
    const select = event.currentTarget;
    const previousValue = lineupSchemeCompetitionValue(league.ownTeam);
    const competition = select.value;
    const labels = { all:"所有比赛", league:"联赛", cup:"杯赛", friendly:"友谊赛" };
    select.disabled = true;
    try {
      await mutateLineupScheme({ action:"assign", lineupSchemeId:league.ownTeam.activeLineupSchemeId, competition });
      showToast(`当前方案已适配${labels[competition]}`);
    } catch (error) {
      select.value = previousValue;
      select.disabled = false;
      showToast(error.message);
    }
  });
  const pitch = document.querySelector("#league-tactics-pitch");
  document.querySelectorAll("[data-formation-line]").forEach((handle) => handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !pitch) return;
    event.preventDefault();
    const key = handle.dataset.formationLine;
    const original = { ...leagueFormationLinePresets[leagueActivePositionPreset] };
    const pitchRect = pitch.getBoundingClientRect();
    let moved = false;
    let animationFrame = null;
    let pendingClientY = event.clientY;
    draggingMagnet = true;
    handle.classList.add("dragging");
    const applyPosition = (clientY) => {
      const y = ((clientY - pitchRect.top) / pitchRect.height) * 100;
      const next = moveFormationLine(leagueFormationLinePresets[leagueActivePositionPreset], key, y);
      moved ||= next[key] !== original[key];
      leagueFormationLinePresets[leagueActivePositionPreset] = next;
      handle.style.top = `${next[key]}%`;
    };
    const move = (moveEvent) => {
      pendingClientY = moveEvent.clientY;
      if (animationFrame !== null) return;
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        applyPosition(pendingClientY);
      });
    };
    const finish = (finishEvent) => {
      pendingClientY = finishEvent.clientY;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      applyPosition(pendingClientY);
      draggingMagnet = false;
      handle.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (moved) {
        leagueEditorDirty = true;
        refreshLeagueSquadPositionUi();
        scheduleLeagueTeamAutoSave(180);
      }
    };
    const cancel = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = null;
      draggingMagnet = false;
      handle.classList.remove("dragging");
      leagueFormationLinePresets[leagueActivePositionPreset] = original;
      handle.style.top = `${original[key]}%`;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      refreshLeagueSquadPositionUi();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once:true });
    window.addEventListener("pointercancel", cancel, { once:true });
  }));
  const clearRoleSwapHighlights = () => document.querySelectorAll(".role-swap-primary,.role-swap-secondary").forEach((candidate) => candidate.classList.remove("role-swap-primary", "role-swap-secondary"));
  const showRoleSwapHighlights = (sourceMagnet) => {
    clearRoleSwapHighlights();
    const primaryRole = sourceMagnet.dataset.primaryRole ?? "";
    const secondaryRole = sourceMagnet.dataset.secondaryRole ?? "";
    document.querySelectorAll("[data-league-magnet],[data-league-bench-magnet]").forEach((candidate) => {
      if (candidate === sourceMagnet) return;
      const candidateRole = candidate.dataset.primaryRole ?? "";
      if (primaryRole && candidateRole === primaryRole) candidate.classList.add("role-swap-primary");
      else if (secondaryRole && candidateRole === secondaryRole) candidate.classList.add("role-swap-secondary");
    });
  };
  const benchTargetSnapshot = () => {
    const list = document.querySelector(".league-bench .bench-magnet-list");
    if (!list) return null;
    return {
      listRect:list.getBoundingClientRect(),
      candidates:[...list.querySelectorAll("[data-league-bench-magnet]")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { element, rect, centerX:rect.left + rect.width / 2, centerY:rect.top + rect.height / 2 };
      }),
    };
  };
  const benchTargetAt = (clientX, clientY, snapshot) => {
    if (!snapshot) return null;
    const { listRect, candidates } = snapshot;
    if (clientX < listRect.left || clientX > listRect.right || clientY < listRect.top || clientY > listRect.bottom) return null;
    const direct = candidates.find(({ rect }) => clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
    if (direct) return direct.element;
    let nearest = null;
    let nearestDistance = Infinity;
    candidates.forEach((candidate) => {
      const distance = Math.hypot(clientX - candidate.centerX, clientY - candidate.centerY);
      if (distance < nearestDistance) { nearest = candidate.element; nearestDistance = distance; }
    });
    return nearest;
  };
  document.querySelectorAll("[data-league-magnet]").forEach((magnet) => magnet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("[data-league-duty-step]")) return;
    event.preventDefault();
    const playerId = magnet.dataset.leagueMagnet;
    const startPosition = { ...leaguePositions[playerId] };
    const pointerStart = { x:event.clientX, y:event.clientY };
    let moved = false;
    let benchTarget = null;
    let ghost = null;
    const pitchRect = pitch.getBoundingClientRect();
    const benchTargets = benchTargetSnapshot();
    draggingMagnet = true;
    showRoleSwapHighlights(magnet);
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
        clone.removeAttribute("tabindex");
        clone.setAttribute("aria-hidden", "true");
        clone.querySelector(".league-magnet-duty")?.remove();
        clone.classList.remove("dragging");
        clone.classList.add("bench-drag-ghost", "league-field-drag-ghost");
        document.body.appendChild(clone);
        return clone;
      })();
      magnet.classList.add("league-drag-source-hidden");
      ghost.style.left = `${moveEvent.clientX}px`;
      ghost.style.top = `${moveEvent.clientY}px`;
    };
    const applyMove = (moveEvent) => {
      moved ||= Math.hypot(moveEvent.clientX - pointerStart.x, moveEvent.clientY - pointerStart.y) >= 3;
      if (!moved) return;
      const nextBenchTarget = benchTargetAt(moveEvent.clientX, moveEvent.clientY, benchTargets);
      if (nextBenchTarget !== benchTarget) {
        benchTarget?.classList.remove("swap-target");
        benchTarget = nextBenchTarget;
        benchTarget?.classList.add("swap-target");
      }
      const rect = pitchRect;
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
    const move = frameThrottlePointerMove(applyMove);
    const finish = (pointerEvent) => {
      move.flush(pointerEvent);
      draggingMagnet = false;
      clearRoleSwapHighlights();
      magnet.classList.remove("dragging");
      benchTarget?.classList.remove("swap-target");
      removeGhost();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      if (!moved && window.matchMedia("(max-width: 1050px), (pointer: coarse)").matches) {
        openLeagueMobileDutySheet(playerId);
        return;
      }
      if (benchTarget) {
        leaguePositions[playerId] = startPosition;
        leagueEditorDirty = true;
        swapLeagueStarter(benchTarget.dataset.leagueBenchMagnet, playerId);
        return;
      }
      if (moved && hasMultipleGoalkeepers(leaguePositions, playerId, leaguePositions[playerId], leagueFormationLinePresets?.[leagueActivePositionPreset])) {
        leaguePositions[playerId] = startPosition;
        showToast("门将位置最多只能安排一名球员");
      }
      if (moved) {
        leagueEditorDirty = true;
        refreshLeagueSquadPositionUi();
        scheduleLeagueTeamAutoSave(180);
      }
    };
    const cancel = () => {
      move.cancel();
      draggingMagnet = false;
      clearRoleSwapHighlights();
      leaguePositions[playerId] = startPosition;
      benchTarget?.classList.remove("swap-target");
      removeGhost();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      refreshLeagueSquadPositionUi();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once:true });
    window.addEventListener("pointercancel", cancel, { once:true });
  }));
  document.querySelectorAll("[data-league-bench-magnet]").forEach((magnet) => magnet.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingMagnet = true;
    showRoleSwapHighlights(magnet);
    const ghost = magnet.cloneNode(true);
    let target = null;
    const fieldTargets = [...document.querySelectorAll("[data-league-magnet]")].map((element) => ({ element, rect:element.getBoundingClientRect() }));
    ghost.removeAttribute("data-league-bench-magnet");
    ghost.classList.remove("bench-magnet", "league-bench-magnet");
    ghost.classList.add("bench-drag-ghost");
    document.body.appendChild(ghost);
    magnet.classList.add("league-bench-source-removed");
    const applyMove = (pointerEvent) => {
      ghost.style.left = `${pointerEvent.clientX}px`; ghost.style.top = `${pointerEvent.clientY}px`;
      const next = fieldTargets.find(({ rect }) => pointerEvent.clientX >= rect.left && pointerEvent.clientX <= rect.right && pointerEvent.clientY >= rect.top && pointerEvent.clientY <= rect.bottom)?.element ?? null;
      if (next !== target) { target?.classList.remove("swap-target"); target = next; target?.classList.add("swap-target"); }
    };
    const move = frameThrottlePointerMove(applyMove);
    const finish = (pointerEvent) => {
      draggingMagnet = false;
      clearRoleSwapHighlights();
      move.flush(pointerEvent); target?.classList.remove("swap-target"); ghost.remove();
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
      move.cancel();
      draggingMagnet = false;
      clearRoleSwapHighlights();
      target?.classList.remove("swap-target"); ghost.remove();
      magnet.classList.remove("league-bench-source-removed");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
    move.flush(event);
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
  const scopes = [
    { key:"league", eyebrow:"LEAGUE", name:"联赛", entries:league.leaderboards?.[leagueBoard] ?? [] },
    { key:"cup", eyebrow:"CHAMPION CUP", name:"杯赛", entries:league.cupLeaderboards?.[leagueBoard] ?? [] },
    { key:"team", eyebrow:"MY CLUB", name:"本队", entries:league.teamLeaderboards?.[leagueBoard] ?? [] },
  ];
  const cards = scopes.map((scope) => `<section class="league-panel leaderboard-panel league-stats-card scope-${scope.key}"><header><div><small>${scope.eyebrow}</small><h2>${scope.name}${title}</h2></div><b>${scope.entries.length}人</b></header><div class="league-stats-scroll"><table class="league-table"><thead><tr><th>#</th><th>球员</th><th>出场</th><th>${label}</th></tr></thead><tbody>${leagueLeaderboardRows(scope.entries, metric)}</tbody></table></div></section>`).join("");
  return `<section class="league-stats-page"><header class="league-stats-heading"><div><small>COMPETITION STATS</small><h2>数据榜</h2></div><div class="league-board-tabs">${Object.entries(configs).map(([key,value]) => `<button type="button" data-league-board="${key}" class="${leagueBoard === key ? "active" : ""}">${value[0]}</button>`).join("")}</div></header><div class="league-stats-grid">${cards}</div></section>`;
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

function marketPage(entries, requestedPage) {
  const pageCount = Math.max(1, Math.ceil(entries.length / LEAGUE_MARKET_PAGE_SIZE));
  const page = Math.max(1, Math.min(pageCount, Number(requestedPage) || 1));
  const start = (page - 1) * LEAGUE_MARKET_PAGE_SIZE;
  return { page, pageCount, items:entries.slice(start, start + LEAGUE_MARKET_PAGE_SIZE), total:entries.length };
}

function marketPagerMarkup(side, pageState) {
  if (pageState.pageCount <= 1) return `<div class="s4-market-page-summary">共 ${pageState.total} 项</div>`;
  return `<nav class="s4-market-pager"><button type="button" class="button secondary" data-market-page-side="${side}" data-market-page="${pageState.page - 1}" ${pageState.page <= 1 ? "disabled" : ""}>上一页</button><b>${pageState.page} / ${pageState.pageCount}<small>共 ${pageState.total} 项</small></b><button type="button" class="button secondary" data-market-page-side="${side}" data-market-page="${pageState.page + 1}" ${pageState.page >= pageState.pageCount ? "disabled" : ""}>下一页</button></nav>`;
}

function leaguePlayerHolderMarkup(holder) {
  return `<span><b>${escapeHtml(holder.ownerName)}</b><small>${escapeHtml(holder.teamName)} · ${holder.cardCount}张 · 最高+${holder.highestUpgradeLevel}</small></span>`;
}

function playerDirectoryViewToggle(view, attribute) {
  return `<div class="player-directory-view-toggle" aria-label="展示方式"><button type="button" class="${view === "list" ? "active" : ""}" ${attribute}="list">列表</button><button type="button" class="${view === "cards" ? "active" : ""}" ${attribute}="cards">卡片</button></div>`;
}

function playerDirectoryCard(player, upgradeLevel = 0, traits = []) {
  const level = Math.max(0, Math.min(8, Number(upgradeLevel ?? 0)));
  const bonus = [0, 1, 2, 3, 5, 7, 9, 11, 13][level];
  return { playerId:player.id, upgradeLevel:level, effectiveOverall:Number(player.overall) + bonus, traits };
}

function leaguePlayerSearchMarkup() {
  if (leaguePlayerDirectoryLoading && !league.playerDirectory) return `<section class="player-info-shell"><header><button type="button" class="button secondary" data-player-info-section="back">返回功能选择</button><div><small>GLOBAL PLAYER DATABASE</small><h2>球员搜索</h2></div></header><p class="league-empty">正在载入最新球员数据库…</p></section>`;
  const query = leaguePlayerSearchQuery.trim().toLocaleLowerCase("zh-CN");
  const results = query ? playerDirectorySearchResults(leaguePlayerSearchQuery) : [];
  const listMarkup = results.length ? results.map((player) => {
    const ownership = player.ownership
      ? `<b>${escapeHtml(player.ownership.ownerName)}</b><small>${escapeHtml(player.ownership.teamName)}</small>`
      : `<b>暂无玩家所有权</b><small>${player.legend ? "传奇球员不设置唯一所有权" : "当前属于公共池"}</small>`;
    const holders = player.holders.length ? player.holders.map(leaguePlayerHolderMarkup).join("") : `<em>当前没有玩家持卡</em>`;
    const primaryRole = ROLE_LABELS[player.role] ?? player.role;
    const secondaryRole = player.secondaryRole && player.secondaryRole !== player.role ? ROLE_LABELS[player.secondaryRole] ?? player.secondaryRole : null;
    const roleDisplay = secondaryRole ? `${primaryRole} / ${secondaryRole}` : primaryRole;
    return `<article class="player-directory-row grade-${String(player.grade ?? "C").toLowerCase()}" data-player-directory-detail="${escapeHtml(player.id)}" data-player-directory-upgrade="${player.highestUpgradeLevel}" tabindex="0" role="button"><div class="player-directory-identity"><i>${escapeHtml(player.role)}</i><span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.club)} · ${escapeHtml(player.nationality)}</small></span></div><dl><div><dt>默认能力</dt><dd>${player.overall}</dd></div><div><dt>主位置 / 副位置</dt><dd>${escapeHtml(roleDisplay)}</dd></div><div><dt>评级</dt><dd>${escapeHtml(player.grade)}</dd></div><div><dt>最高强化</dt><dd>+${player.highestUpgradeLevel}</dd></div></dl><section><small>球员所有权</small>${ownership}</section><section class="player-directory-holders"><small>持卡玩家</small><div>${holders}</div></section></article>`;
  }).join("") : query ? `<p class="player-directory-empty">没有找到符合“${escapeHtml(leaguePlayerSearchQuery)}”的球员。</p>` : `<p class="player-directory-empty">输入球员、俱乐部或国家队名称开始搜索。</p>`;
  const cardMarkup = results.length ? results.map((player) => {
    const primaryRole = ROLE_LABELS[player.role] ?? player.role;
    const secondaryRole = player.secondaryRole && player.secondaryRole !== player.role ? ROLE_LABELS[player.secondaryRole] ?? player.secondaryRole : null;
    const owner = player.ownership ? `${player.ownership.ownerName} · ${player.ownership.teamName}` : player.legend ? "传奇公共球员" : "公共池球员";
    return `<article class="player-directory-card-item" data-player-directory-detail="${escapeHtml(player.id)}" data-player-directory-upgrade="${player.highestUpgradeLevel}" tabindex="0" role="button">${s4PlayerCardMarkup(player, { card:playerDirectoryCard(player, player.highestUpgradeLevel), compact:true })}<div><b>${escapeHtml(owner)}</b><small>${escapeHtml(secondaryRole ? `${primaryRole} / ${secondaryRole}` : primaryRole)} · ${player.cardCount}张卡 · ${player.holders.length}名持卡玩家</small></div></article>`;
  }).join("") : listMarkup;
  const resultMarkup = leaguePlayerSearchView === "cards" ? `<div class="player-directory-card-grid">${cardMarkup}</div>` : `<div class="player-directory-list">${listMarkup}</div>`;
  return `<section class="player-info-shell player-search-page"><header><button type="button" class="button secondary" data-player-info-section="back">返回功能选择</button><div><small>GLOBAL PLAYER DATABASE</small><h2>球员搜索</h2></div><b>${results.length} 条结果</b></header><div class="player-search-hero"><small>YDL PLAYER SEARCH</small><form data-player-directory-search><input type="search" value="${escapeHtml(leaguePlayerSearchDraft)}" placeholder="搜索球员、俱乐部、国家队或位置（如 ST、GK）" data-player-directory-search-input><button type="submit">搜索</button></form><div class="player-search-options"><p>支持主位置和副位置英文代码 · 按回车或点击按钮搜索</p>${playerDirectoryViewToggle(leaguePlayerSearchView, "data-player-search-view")}</div></div>${resultMarkup}</section>`;
}

function leagueEnhancementRankingMarkup() {
  if (leaguePlayerDirectoryLoading && !league.playerDirectory) return `<section class="player-info-shell"><header><button type="button" class="button secondary" data-player-info-section="back">返回功能选择</button><div><small>S4 ENHANCEMENT RANKING</small><h2>强化排行榜</h2></div></header><p class="league-empty">正在载入最新强化排行…</p></section>`;
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
  const cards = ranking.length ? ranking.map((entry) => `<article class="enhancement-ranking-card-item" data-player-directory-detail="${escapeHtml(entry.player.id)}" data-player-directory-upgrade="${entry.upgradeLevel}" tabindex="0" role="button"><strong class="enhancement-ranking-card-rank">#${entry.rank}</strong>${s4PlayerCardMarkup(entry.player, { card:playerDirectoryCard(entry.player, entry.upgradeLevel, entry.traits), compact:true })}<div><b>${escapeHtml(entry.ownerName)}</b><small>${escapeHtml(entry.teamName)}</small></div></article>`).join("") : `<p class="player-directory-empty">当前筛选条件下没有球员卡。</p>`;
  const rankingMarkup = leagueEnhancementRankingView === "cards" ? `<div class="enhancement-ranking-card-grid">${cards}</div>` : `<div class="enhancement-ranking-table"><table><thead><tr><th>排名</th><th>球员</th><th>位置</th><th>默认能力</th><th>强化</th><th>持有玩家</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return `<section class="player-info-shell enhancement-ranking-page"><header><button type="button" class="button secondary" data-player-info-section="back">返回功能选择</button><div><small>S4 ENHANCEMENT RANKING</small><h2>强化排行榜</h2></div><b>${ranking.length} 张卡</b></header><div class="enhancement-ranking-filters"><input type="search" value="${escapeHtml(leagueEnhancementRankingSearch)}" placeholder="搜索球员、持有玩家或球队" data-enhancement-ranking-search><select data-enhancement-ranking-position><option value="ALL" ${leagueEnhancementRankingPosition === "ALL" ? "selected" : ""}>全部位置</option><option value="ATT" ${leagueEnhancementRankingPosition === "ATT" ? "selected" : ""}>前场</option><option value="MID" ${leagueEnhancementRankingPosition === "MID" ? "selected" : ""}>中场</option><option value="DEF" ${leagueEnhancementRankingPosition === "DEF" ? "selected" : ""}>后场</option><option value="GK" ${leagueEnhancementRankingPosition === "GK" ? "selected" : ""}>门将</option></select><select data-enhancement-ranking-grade><option value="ALL" ${leagueEnhancementRankingGrade === "ALL" ? "selected" : ""}>全部评级</option>${["X", "S", "A", "B", "C"].map((grade) => `<option value="${grade}" ${leagueEnhancementRankingGrade === grade ? "selected" : ""}>${grade}级</option>`).join("")}</select><select data-enhancement-ranking-level><option value="ALL" ${leagueEnhancementRankingLevel === "ALL" ? "selected" : ""}>全部等级</option><option value="ENHANCED" ${leagueEnhancementRankingLevel === "ENHANCED" ? "selected" : ""}>+1以上</option><option value="HIGH" ${leagueEnhancementRankingLevel === "HIGH" ? "selected" : ""}>+5以上</option><option value="MAX" ${leagueEnhancementRankingLevel === "MAX" ? "selected" : ""}>仅+8</option></select>${playerDirectoryViewToggle(leagueEnhancementRankingView, "data-enhancement-ranking-view")}</div>${rankingMarkup}</section>`;
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
    : `${item.player.pool === "LEGEND" ? "传奇单卡" : "强化单卡"} · +${card?.upgradeLevel ?? 0}${item.includesOwnership ? " · 附带所有权" : ""}`;
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
  if (leaguePlayerDirectoryLoading && !league.playerDirectory) return `<section class="card-trade-shell"><header><button type="button" class="button secondary" data-market-section="back">返回市场选择</button><div><small>PLAYER TO PLAYER TRADE</small><h2>发起交易</h2></div></header><p class="s4-market-empty">正在载入其他玩家的可交易卡片…</p></section>`;
  const targetTeam = league.teams.find((team) => team.ownerId === leagueTradeTargetOwnerId && !team.isAi);
  const playerOptions = league.teams.filter((team) => !team.isAi && team.ownerId && team.ownerId !== account.profile.id).map((team) => `<option value="${escapeHtml(team.ownerId)}" ${team.ownerId === leagueTradeTargetOwnerId ? "selected" : ""}>${escapeHtml(team.ownerName)} · ${escapeHtml(team.name)}</option>`).join("");
  const ownCards = league.ownTeam.roster.flatMap((player) => player.cards.filter((card) => player.xPlayer || Number(card.upgradeLevel ?? 0) >= 1).map((card) => ({ player, card })))
    .sort((left, right) => comparePlayerGrade(left, right) || right.card.upgradeLevel - left.card.upgradeLevel || right.player.overall - left.player.overall);
  const targetCards = targetTeam ? (league.playerDirectory?.enhancementRanking ?? []).filter((entry) => entry.ownerId === targetTeam.ownerId && (entry.player.xPlayer || Number(entry.upgradeLevel ?? 0) >= 1)).map((entry) => ({ player:entry.player, card:{ id:entry.cardId, upgradeLevel:entry.upgradeLevel, traits:entry.traits ?? [] } }))
    .sort((left, right) => comparePlayerGrade(left, right) || right.card.upgradeLevel - left.card.upgradeLevel || right.player.overall - left.player.overall) : [];
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

function cosmeticMarketVisualMarkup(item) {
  const categoryLabel = item.slot === "clubBadge" ? "俱乐部徽章" : "国家队徽章";
  return `<div class="cosmetic-market-visual category-${item.slot === "clubBadge" ? "club" : "country"} grade-${String(item.grade).toLowerCase()}"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}"><i>${escapeHtml(item.grade)}</i><small>${categoryLabel}</small></div>`;
}

function cosmeticMarketListingMarkup(listing) {
  const item = listing.item;
  if (!item) return "";
  const action = listing.sellerId === account.profile.id
    ? `<button class="button secondary" data-market-cancel="${escapeHtml(listing.id)}">撤回挂牌</button>`
    : `<button class="button primary" data-market-buy="${escapeHtml(listing.id)}">立即购买</button>`;
  return `<article class="s4-market-listing cosmetic-market-listing">${cosmeticMarketVisualMarkup(item)}<div class="cosmetic-market-copy"><b>${Number(listing.price).toLocaleString("zh-CN")} 金币</b><strong>${escapeHtml(item.displayName ?? item.name)}</strong><small>${escapeHtml(listing.sellerTeamName)} · ${escapeHtml(item.grade)}级${item.slot === "clubBadge" ? "俱乐部" : "国家队"}徽章</small>${action}</div></article>`;
}

function leagueCosmeticMarketMarkup() {
  const gradeOrder = { S:0, A:1, B:2, C:3 };
  const listings = (league.listings ?? []).filter((listing) => listing.kind === "cosmetic" && listing.item)
    .sort((left, right) => Number(left.price) - Number(right.price) || (gradeOrder[left.item.grade] ?? 9) - (gradeOrder[right.item.grade] ?? 9) || String(left.item.name).localeCompare(String(right.item.name), "zh-CN"));
  const inventory = [...(league.cosmetics?.items ?? [])].filter((item) => Number(item.count ?? 0) > 0)
    .sort((left, right) => (gradeOrder[left.grade] ?? 9) - (gradeOrder[right.grade] ?? 9) || String(left.name).localeCompare(String(right.name), "zh-CN"));
  const listingPage = marketPage(listings, leagueMarketListingPage);
  const warehousePage = marketPage(inventory, leagueMarketWarehousePage);
  leagueMarketListingPage = listingPage.page;
  leagueMarketWarehousePage = warehousePage.page;
  const listingCards = listingPage.items.length ? listingPage.items.map(cosmeticMarketListingMarkup).join("") : `<p class="s4-market-empty">当前没有徽章道具挂牌。</p>`;
  const warehouseCards = warehousePage.items.length ? warehousePage.items.map((item) => `<article class="s4-market-warehouse-card cosmetic-market-warehouse-card">${cosmeticMarketVisualMarkup(item)}<div class="cosmetic-market-copy"><strong>${escapeHtml(item.displayName ?? item.name)}</strong><small>${escapeHtml(item.grade)}级 · 当前持有 ×${Number(item.count)}${item.equipped ? " · 正在佩戴" : ""}</small></div><button type="button" class="button secondary s4-market-list-button" data-market-list-kind="cosmetic" data-market-list-asset="${escapeHtml(item.id)}">挂牌一枚</button></article>`).join("") : `<p class="s4-market-empty">你当前没有可挂牌的徽章道具。</p>`;
  return `<section class="s4-market-shell cosmetic-market-shell"><header><button type="button" class="button secondary" data-market-section="back">返回市场选择</button><div><small>COSMETIC ITEM MARKET</small><h2>道具交易</h2></div><b>${league.wallet.balance} 金币</b></header><div class="s4-market-columns"><section class="s4-market-board"><header><div><small>ITEM LISTINGS</small><h3>徽章挂牌</h3></div><span>国家队与俱乐部徽章均可交易</span></header><div class="s4-market-card-grid cosmetic-market-grid">${listingCards}</div>${marketPagerMarkup("listing", listingPage)}</section><aside class="s4-market-warehouse"><header><div><small>MY COSMETIC ITEMS</small><h3>我的徽章道具</h3></div><span>每次挂牌1枚 · 成交收取5%手续费</span></header><div class="s4-market-card-grid cosmetic-market-grid">${warehouseCards}</div>${marketPagerMarkup("warehouse", warehousePage)}</aside></div></section>`;
}

function leagueMarketMarkup() {
  if (!leagueMarketSection) return `<section class="s4-market-entry market-entry-four"><header><small>S4 TRANSFER MARKET</small><h2>交易市场</h2><p>选择需要进入的资产市场</p></header><div><button type="button" data-market-section="card"><i>+8</i><b>传奇 / 强化单卡市场</b><span>购买或挂牌传奇卡及强化球员卡</span></button><button type="button" data-market-section="ownership"><i>OWN</i><b>球员所有权市场</b><span>转移非传奇球员的全服唯一所有权</span></button><button type="button" data-market-section="trade"><i>⇄</i><b>发起交易</b><span>与其他真人玩家交换强化卡并附带金币</span></button><button type="button" data-market-section="cosmetic"><i>BDG</i><b>道具交易</b><span>挂牌或购买国家队与俱乐部徽章</span></button></div></section>`;
  if (leagueMarketSection === "trade") return leagueCardTradeMarkup();
  if (leagueMarketSection === "cosmetic") return leagueCosmeticMarketMarkup();
  const ownership = leagueMarketSection === "ownership";
  const listings = league.listings.filter((item) => item.kind === (ownership ? "ownership" : "card"))
    .filter((item) => marketMatches(item.player, leagueMarketListingSearch, leagueMarketListingPosition));
  const warehouseEntries = ownership
    ? league.ownTeam.roster.filter((player) => player.ownsRights && player.pool !== "LEGEND" && !player.xPlayer).map((player) => ({ player, card:{ upgradeLevel:0, traits:[] } }))
    : league.ownTeam.roster.filter((player) => !player.xPlayer).flatMap((player) => player.cards.filter((card) => player.legendary || player.grade === "S" || Number(card.upgradeLevel) >= 1).map((card) => ({ player, card })));
  const filteredWarehouse = warehouseEntries.filter(({ player, card }) => marketMatches(player, leagueMarketWarehouseSearch, leagueMarketWarehousePosition)
    && (ownership || leagueMarketWarehouseUpgrade === "ALL" || leagueMarketWarehouseUpgrade === "MID" && card.upgradeLevel <= 4 || leagueMarketWarehouseUpgrade === "HIGH" && card.upgradeLevel >= 5 && card.upgradeLevel <= 7 || leagueMarketWarehouseUpgrade === "MAX" && card.upgradeLevel >= 8))
    .sort((left, right) => comparePlayerGrade(left, right) || right.card.upgradeLevel - left.card.upgradeLevel || right.player.overall - left.player.overall);
  const listingPage = marketPage(listings, leagueMarketListingPage);
  const warehousePage = marketPage(filteredWarehouse, leagueMarketWarehousePage);
  leagueMarketListingPage = listingPage.page;
  leagueMarketWarehousePage = warehousePage.page;
  const listingCards = listingPage.items.length ? listingPage.items.map(marketListingCard).join("") : `<p class="s4-market-empty">当前没有符合条件的挂牌资产。</p>`;
  const ownActiveListings = (league.listings ?? []).filter((item) => item.sellerId === account.profile.id);
  const listedCardIds = new Set(ownActiveListings.map((item) => item.cardId).filter(Boolean));
  const listedPlayerIds = new Set(ownActiveListings.filter((item) => item.kind === "ownership").map((item) => item.playerId));
  const warehouseCards = warehousePage.items.length ? warehousePage.items.map(({ player, card }) => {
    const listed = ownership ? listedPlayerIds.has(player.id) : listedPlayerIds.has(player.id) || listedCardIds.has(card.id);
    const attributes = ownership
      ? `draggable="${!listed}" data-market-drag-ownership="${player.id}"`
      : `draggable="${!listed}" data-market-drag-card="${card.id}"`;
    const listButton = listed ? `<span>已挂牌</span>` : `<button type="button" class="button secondary s4-market-list-button" data-market-list-kind="${ownership ? "ownership" : "card"}" data-market-list-asset="${ownership ? player.id : card.id}">按键挂牌</button>`;
    return `<div class="s4-market-warehouse-card ${listed ? "listed" : ""}">${s4PlayerCardMarkup(player, { card, compact:true, attributes })}${listButton}</div>`;
  }).join("") : `<p class="s4-market-empty">当前筛选条件下没有可挂牌资产。</p>`;
  return `<section class="s4-market-shell"><header><button type="button" class="button secondary" data-market-section="back">返回市场选择</button><div><small>${ownership ? "PLAYER OWNERSHIP" : "LEGEND / ENHANCED CARDS"}</small><h2>${ownership ? "球员所有权市场" : "传奇 / 强化单卡市场"}</h2></div><b>${league.wallet.balance} 金币</b></header><div class="s4-market-columns"><section class="s4-market-board" data-market-drop-zone="${ownership ? "ownership" : "card"}"><header><div><small>MARKET LISTINGS</small><h3>市场挂牌</h3></div><span>拖动右侧卡片到这里挂牌</span></header>${marketFilterMarkup("listing", leagueMarketListingSearch, leagueMarketListingPosition)}<div class="s4-market-card-grid">${listingCards}</div>${marketPagerMarkup("listing", listingPage)}</section><aside class="s4-market-warehouse"><header><div><small>MY CARD WAREHOUSE</small><h3>${ownership ? "我的球员所有权" : "我的可交易单卡"}</h3></div><span>成交收取5%手续费</span></header>${marketFilterMarkup("warehouse", leagueMarketWarehouseSearch, leagueMarketWarehousePosition, !ownership)}<div class="s4-market-card-grid">${warehouseCards}</div>${marketPagerMarkup("warehouse", warehousePage)}</aside></div></section>`;
}

function leagueInboxMessageNeedsAction(message) {
  if (message.type === "trade-offer") return (league.cardTradeOffers ?? []).some((offer) => offer.id === message.payload?.tradeOfferId && offer.status === "pending");
  if (message.type === "friendly-invite") {
    const invitation = (league.friendlyInvitations ?? []).find((item) => item.id === message.payload?.friendlyInvitationId);
    return invitation?.status === "pending" && (!invitation.expiresAt || Date.now() + leagueScheduleClockOffset < Number(invitation.expiresAt));
  }
  return message.type === "trait-compensation" && !message.payload?.resolvedAt;
}

function leagueInboxMessageCategory(message) {
  return LEAGUE_INBOX_TYPE_META[message.type]?.category ?? "announcements";
}

function leagueInboxFilteredMessages(messages = league.inbox ?? []) {
  return messages.filter((message) => {
    const matchesCategory = leagueInboxCategory === "all"
      || leagueInboxCategory === "action" && leagueInboxMessageNeedsAction(message)
      || leagueInboxMessageCategory(message) === leagueInboxCategory;
    const matchesUnread = !leagueInboxUnreadOnly || !message.readAt || message.id === leagueInboxMessageId;
    return matchesCategory && matchesUnread;
  });
}

function refreshLeagueInboxInPlace() {
  if (!leagueMode || leagueTab !== "inbox") return;
  const current = app.querySelector(".league-inbox, .league-inbox-empty");
  if (!current) return renderLeague();
  const scrollTop = current.querySelector("[data-league-mail-scroll]")?.scrollTop ?? 0;
  current.outerHTML = leagueInboxMarkup();
  const nextScroll = app.querySelector("[data-league-mail-scroll]");
  if (nextScroll) nextScroll.scrollTop = scrollTop;
  syncLeagueShellChrome();
}

function leagueInboxMarkup() {
  const messages = league.inbox ?? [];
  if (!messages.length) return `<section class="league-panel league-inbox-empty"><h2>收件箱暂无消息</h2><p>比赛周战报、球队日报、伤停和奖励通知会发送到这里。</p></section>`;
  const counts = Object.fromEntries(LEAGUE_INBOX_CATEGORIES.map((category) => [category.id, 0]));
  counts.all = messages.length;
  let unreadCount = 0;
  let readCount = 0;
  messages.forEach((message) => {
    counts[leagueInboxMessageCategory(message)] += 1;
    if (leagueInboxMessageNeedsAction(message)) counts.action += 1;
    if (message.readAt) readCount += 1;
    else unreadCount += 1;
  });
  if (!LEAGUE_INBOX_CATEGORIES.some((category) => category.id === leagueInboxCategory)) leagueInboxCategory = "all";
  const filteredMessages = leagueInboxFilteredMessages(messages);
  if (!filteredMessages.some((message) => message.id === leagueInboxMessageId)) leagueInboxMessageId = null;
  const selected = filteredMessages.find((message) => message.id === leagueInboxMessageId) ?? null;
  const filteredUnreadIds = filteredMessages.filter((message) => !message.readAt).map((message) => message.id);
  const categoryTabs = LEAGUE_INBOX_CATEGORIES.map((category) => `<button type="button" class="${leagueInboxCategory === category.id ? "active" : ""}" data-league-inbox-category="${category.id}"><span>${category.label}</span><b>${counts[category.id]}</b></button>`).join("");
  const list = filteredMessages.length ? filteredMessages.map((message) => {
    const time = new Date(message.createdAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
    const meta = LEAGUE_INBOX_TYPE_META[message.type] ?? { label:"联赛通知" };
    const action = leagueInboxMessageNeedsAction(message);
    return `<button type="button" class="league-mail-item ${message.id === selected?.id ? "active" : ""} ${message.readAt ? "read" : "unread"} ${action ? "needs-action" : ""}" data-league-inbox-message="${escapeHtml(message.id)}"><span><i>${escapeHtml(meta.label)}${action ? " · 待处理" : ""}</i><time>${time}</time></span><b>${escapeHtml(message.title)}</b><small>${escapeHtml(message.summary)}</small></button>`;
  }).join("") : `<div class="league-mail-filter-empty"><b>${leagueInboxUnreadOnly ? "当前筛选没有未读邮件" : "当前分类暂无邮件"}</b><p>可以切换分类或关闭“仅看未读”。</p></div>`;
  const reader = selected ? leagueInboxDetailMarkup(selected) : `<div class="league-mail-placeholder"><b>选择一封邮件</b><p>点击左侧邮件后会标记为已读并显示完整内容。</p></div>`;
  return `<div class="league-inbox"><aside class="league-mail-list"><header><div><small>CLUB INBOX</small><h2>收件箱</h2></div><b title="当前筛选 / 全部邮件">${filteredMessages.length}<small>/${messages.length}</small></b></header><nav class="league-mail-categories">${categoryTabs}</nav><div class="league-mail-filter-tools"><button type="button" class="${leagueInboxUnreadOnly ? "active" : ""}" data-league-inbox-unread aria-pressed="${leagueInboxUnreadOnly}"><span>仅看未读</span><b>${unreadCount}</b></button><button type="button" data-league-inbox-read-batch ${filteredUnreadIds.length ? "" : "disabled"}>当前分类全部已读</button></div><nav class="league-mail-batch-actions"><button type="button" class="button secondary" data-league-inbox-delete-batch="read" ${readCount ? "" : "disabled"}>删除已读</button><button type="button" class="button secondary danger" data-league-inbox-delete-batch="all">清空可删除邮件</button></nav><div data-league-mail-scroll>${list}</div></aside><main class="league-mail-reader">${reader}</main></div>`;
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

function mirrorBatchReportMarkup(report) {
  const resultLabels = { W:"胜", D:"平", L:"负" };
  const focusLabel = (value) => FOCUSES[value] ?? value ?? "均衡";
  const tacticLabel = (value) => TACTICS[value] ?? value ?? "未记录";
  const styleLabel = (value) => STYLES[value] ?? value ?? "未记录";
  const decimal = (value, digits = 1) => Number(value ?? 0).toFixed(digits);
  const leaderMarkup = (leaders = []) => leaders.length
    ? leaders.map((player) => `<span><b>${escapeHtml(player.name)}</b><small>${decimal(player.rating, 1)}分 · ${Number(player.goals ?? 0)}球 ${Number(player.assists ?? 0)}助</small></span>`).join("")
    : `<span><small>无球员明细</small></span>`;
  const results = (report.results ?? []).map((result) => {
    const own = result.own ?? {};
    const opponent = result.opponent ?? {};
    return `<article class="mirror-batch-result result-${String(result.result).toLowerCase()}"><header><i>第 ${String(result.number).padStart(2, "0")} 场</i><b>${resultLabels[result.result] ?? result.result}</b><strong>${result.scoreFor} : ${result.scoreAgainst}</strong><span>${escapeHtml(own.formation ?? "-")} vs ${escapeHtml(opponent.formation ?? "-")}</span></header><div class="mirror-batch-result-stats"><span><small>xG</small><b>${decimal(own.xg, 2)} : ${decimal(opponent.xg, 2)}</b></span><span><small>射门 / 射正</small><b>${Number(own.shots ?? 0)}/${Number(own.shotsOnTarget ?? 0)} : ${Number(opponent.shots ?? 0)}/${Number(opponent.shotsOnTarget ?? 0)}</b></span><span><small>控球</small><b>${decimal(own.possession, 1)}% : ${decimal(opponent.possession, 1)}%</b></span><span><small>角球 / 犯规</small><b>${Number(own.corners ?? 0)}/${Number(own.fouls ?? 0)} : ${Number(opponent.corners ?? 0)}/${Number(opponent.fouls ?? 0)}</b></span></div><div class="mirror-batch-result-tactics"><span><small>本队</small><b>${escapeHtml(tacticLabel(own.tactic))} · ${escapeHtml(styleLabel(own.style))}</b></span><span><small>对手</small><b>${escapeHtml(tacticLabel(opponent.tactic))} · ${escapeHtml(styleLabel(opponent.style))}</b></span></div><div class="mirror-batch-result-leaders"><section><small>本队表现前列</small>${leaderMarkup(own.leaders ?? (result.topPlayer ? [result.topPlayer] : []))}</section><section><small>对手表现前列</small>${leaderMarkup(opponent.leaders ?? (result.opponentTopPlayer ? [result.opponentTopPlayer] : []))}</section></div></article>`;
  }).join("");
  const bestPlayer = report.bestPlayer ? `<section class="mirror-batch-best"><small>${Number(report.totalMatches ?? 10)}场突出球员</small><b>${escapeHtml(report.bestPlayer.name)}</b><span>入选单场前三 ${Number(report.bestPlayer.appearances ?? 0)} 次 · 平均评分 ${decimal(report.bestPlayer.averageRating, 2)} · ${Number(report.bestPlayer.goals ?? 0)}球 ${Number(report.bestPlayer.assists ?? 0)}助攻</span></section>` : "";
  const phaseMarkup = (profile = {}) => `<article><header><span><small>${escapeHtml(profile.name ?? "球队")}</small><b>平均能力 ${decimal(profile.averageOverall, 1)}</b></span><em>主攻${escapeHtml(focusLabel(profile.attackFocus))} · 主守${escapeHtml(focusLabel(profile.defenseFocus))}</em></header><div>${(profile.phases ?? []).map((phase) => `<section><small>${escapeHtml(phase.label)}方案${phase.triggerGoalDifference ? ` · 净胜球触发 ${phase.triggerGoalDifference}` : ""}</small><b>${escapeHtml(phase.formation ?? "未知阵型")}</b><span>${escapeHtml(tacticLabel(phase.tactic))} · ${escapeHtml(styleLabel(phase.style))}</span></section>`).join("") || `<section><span>旧报告未保存阶段战术</span></section>`}</div></article>`;
  const tacticalProfiles = report.tacticalProfiles ? `<section class="mirror-batch-tactical"><header><h3>双方阵型与三阶段战术</h3><span>默认 / 领先 / 落后方案对照</span></header><div>${phaseMarkup(report.tacticalProfiles.own)}${phaseMarkup(report.tacticalProfiles.opponent)}</div></section>` : "";
  const analysis = report.analysis ?? { verdict:report.summary, recommendations:[] };
  const analysisMarkup = `<section class="mirror-batch-analysis"><header><h3>数据剖析</h3><span>基于全部 ${Number(report.totalMatches ?? 10)} 场样本</span></header><div><article><small>进攻产出</small><p>${escapeHtml(analysis.attack ?? "旧报告暂无进攻效率拆解。")}</p></article><article><small>防守质量</small><p>${escapeHtml(analysis.defense ?? "旧报告暂无防守质量拆解。")}</p></article><article><small>比赛控制</small><p>${escapeHtml(analysis.control ?? "旧报告暂无比赛控制拆解。")}</p></article><article><small>稳定程度</small><p>${escapeHtml(analysis.consistency ?? "旧报告暂无稳定性拆解。")}</p></article></div><aside><b>调整建议</b><ol>${(analysis.recommendations ?? [report.summary]).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol></aside></section>`;
  const stability = report.stability ?? {};
  const efficiency = report.efficiency ?? {};
  const directorFee = Number(report.pricing?.directorSurcharge ?? 0) ? `<span>主任高速服务费 ${Number(report.pricing.directorSurcharge).toLocaleString("zh-CN")}金币</span>` : "";
  const nodeFee = Number(report.pricing?.playerComputeNodeServiceFeeRevenue ?? 0) ? `<span>玩家节点服务费 ${Number(report.pricing.playerComputeNodeServiceFeeRevenue).toLocaleString("zh-CN")}金币</span>` : "";
  return `<div class="league-mail-body mirror-batch-mail"><section class="mirror-batch-hero"><div><small>BATCH SIMULATION DEEP REPORT · V${Number(report.schemaVersion ?? 1)}</small><h3>${escapeHtml(report.opponentName)}</h3><p>${escapeHtml(analysis.verdict ?? report.summary)}</p></div><strong>${report.wins}胜${report.draws}平${report.losses}负</strong></section><div class="mirror-batch-kpis"><span><small>总比分</small><b>${report.goalsFor} : ${report.goalsAgainst}</b></span><span><small>场均xG</small><b>${decimal(report.average?.xgFor, 2)} : ${decimal(report.average?.xgAgainst, 2)}</b></span><span><small>场均射正</small><b>${decimal(report.average?.shotsOnTargetFor, 1)} : ${decimal(report.average?.shotsOnTargetAgainst, 1)}</b></span><span><small>平均控球</small><b>${decimal(report.average?.possession, 1)}% : ${decimal(report.average?.possessionAgainst ?? 100 - Number(report.average?.possession ?? 0), 1)}%</b></span><span><small>射门转化率</small><b>${decimal(efficiency.conversionFor, 1)}% : ${decimal(efficiency.conversionAgainst, 1)}%</b></span><span><small>零封 / 被零封</small><b>${Number(stability.cleanSheets ?? 0)} : ${Number(stability.failedToScore ?? 0)}</b></span></div>${bestPlayer}${tacticalProfiles}${analysisMarkup}<section class="mirror-batch-results"><header><h3>${Number(report.totalMatches ?? 10)}场逐场比赛数据</h3><span>比分、xG、射门、控球、战术与表现球员</span></header><div>${results}</div></section><footer><span>模拟基础价 ${Number(report.pricing?.subtotal ?? 0).toLocaleString("zh-CN")}金币</span><span>系统服务费 ${Number(report.pricing?.serviceFee ?? 0).toLocaleString("zh-CN")}金币</span>${directorFee}${nodeFee}<b>合计 ${Number(report.pricing?.totalCost ?? 0).toLocaleString("zh-CN")}金币</b></footer></div>`;
}
function leagueInboxDetailMarkup(message) {
  const sentAt = new Date(message.createdAt).toLocaleString("zh-CN", { year:"numeric", month:"long", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
  const needsAction = leagueInboxMessageNeedsAction(message);
  const pendingTradeOffer = message.type === "trade-offer" && needsAction;
  const friendlyInvitation = message.type === "friendly-invite" ? (league.friendlyInvitations ?? []).find((item) => item.id === message.payload?.friendlyInvitationId) : null;
  const friendlyInvitationExpired = Boolean(friendlyInvitation?.expiresAt && Date.now() + leagueScheduleClockOffset >= Number(friendlyInvitation.expiresAt));
  const pendingFriendlyInvitation = message.type === "friendly-invite" && needsAction;
  const pendingTraitCompensation = message.type === "trait-compensation" && needsAction;
  const header = `<header><div><small>${escapeHtml(sentAt)}</small><h2>${escapeHtml(message.title)}</h2><p>${escapeHtml(message.summary)}</p></div><div class="league-mail-actions">${message.matchId ? `<button type="button" class="button secondary" data-league-match-detail="${message.matchId}">查看比赛</button>` : ""}${pendingTradeOffer || pendingFriendlyInvitation || pendingTraitCompensation ? "" : `<button type="button" class="button secondary danger" data-league-inbox-delete="${escapeHtml(message.id)}">删除邮件</button>`}</div></header>`;
  if (message.type === "daily-report" && message.report) return `${header}${leagueDailyReportMarkup(message.report)}`;
  if (message.type === "mirror-batch-report" && message.report) return `${header}${mirrorBatchReportMarkup(message.report)}`;
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
    const status = friendlyInvitationExpired ? "expired" : friendlyInvitation?.status;
    const labels = { pending:"等待你处理", accepted:"已接受并排期", rejected:"已拒绝", expired:"已超时，无法接受" };
    const expiresAtText = friendlyInvitation?.expiresAt ? new Date(Number(friendlyInvitation.expiresAt)).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }) : null;
    const validityText = status === "expired" ? "邀请已超过两小时时限" : expiresAtText ? `两小时内有效 · 有效至 ${expiresAtText}` : "两小时内有效";
    return `${header}<div class="league-mail-body friendly-invite-mail"><p>${escapeHtml(message.body)}</p><section><small>友谊赛邀请</small><h3>${escapeHtml(friendlyInvitation?.fromTeamName ?? "对方球队")} vs ${escapeHtml(friendlyInvitation?.toTeamName ?? league.ownTeam.name)}</h3><span>默认100体力 · 不消耗体力 · 红黄牌不计入正式赛事 · 伤病正常生效</span><span>${escapeHtml(validityText)}</span></section><footer><b>${labels[status] ?? "邀请已失效"}</b>${pendingFriendlyInvitation ? `<div><button type="button" class="button secondary danger" data-friendly-respond="reject" data-friendly-invitation="${friendlyInvitation.id}">拒绝</button><button type="button" class="button primary" data-friendly-respond="accept" data-friendly-invitation="${friendlyInvitation.id}">接受邀请</button></div>` : ""}</footer></div>`;
  }
  if (message.type === "trait-compensation") {
    const payload = message.payload ?? {};
    const offer = payload.traitOffer;
    const chosen = offer?.traits?.find((trait) => trait.id === payload.chosenTraitId);
    const traitRoleLabels = { ANY:"全位置", ATT:"前场", MID:"中场", DEF:"后场", GK:"门将" };
    const choices = !payload.resolvedAt && offer?.traits?.length ? offer.traits.map((trait, index) => {
      const roles = (trait.eligibleRoleGroups ?? ["ANY"]).map((role) => traitRoleLabels[role] ?? role).join(" · ");
      return `<button type="button" class="enhancement-trait-card tone-${index + 1}" data-enhancement-trait="${escapeHtml(trait.id)}" data-enhancement-trait-offer="${escapeHtml(offer.id)}"><span class="enhancement-trait-card-index">0${index + 1}</span><i></i><h3>${escapeHtml(trait.name)}</h3><p>${escapeHtml(trait.summary)}</p><b>${escapeHtml(roles)}</b><strong>选择并自动绑定</strong></button>`;
    }).join("") : "";
    return `${header}<div class="league-mail-body trait-compensation-mail"><p>${escapeHtml(message.body)}</p><section><small>受影响球员卡</small><h3>${escapeHtml(payload.playerName ?? "球员")} · +${Number(payload.upgradeLevel ?? 0)}</h3><span>对应新门槛 +${Number(payload.unlockLevel ?? 0)} · 卡片 ${escapeHtml(payload.cardId ?? "-")}</span></section>${payload.resolvedAt ? `<footer><b>已选择并绑定：${escapeHtml(chosen?.name ?? "特性")}</b></footer>` : `<div class="enhancement-trait-card-grid">${choices}</div>`}</div>`;
  }  if (message.type === "matchweek") {
    const payload = message.payload ?? {};
    const results = (payload.results ?? []).map((match) => leagueMatchRow(match, league.ownTeam.id)).join("");
    const alerts = [...(payload.injured ?? []).map((player) => `${escapeHtml(player.name)}伤缺${player.rounds}轮`), ...(payload.suspended ?? []).map((player) => `${escapeHtml(player.name)}停赛${player.rounds}轮`)];
    const next = payload.next ? `<section class="mail-next-match"><small>${escapeHtml(payload.next.competitionName ?? "黄狗联赛")} · ${escapeHtml(payload.next.label ?? `第${payload.next.round}轮`)}</small><b>${escapeHtml(payload.next.name)}</b><span>${weatherIcon(payload.next.weather)} ${escapeHtml(payload.next.weather.name)} · 裁判 ${escapeHtml(payload.next.referee.name)}</span></section>` : "";
    const income = payload.homeTicketIncome;
    const homeIncome = income ? `<section class="mail-home-income"><header><div><small>HOME MATCH REVENUE</small><h3>主场比赛日收入</h3></div><strong>+${Number(income.amount ?? 0).toLocaleString("zh-CN")} 金币</strong></header><dl><div><dt>入场观众</dt><dd>${Number(income.attendance ?? 0).toLocaleString("zh-CN")}</dd></div><div><dt>球场容量</dt><dd>${Number(income.capacity ?? 0).toLocaleString("zh-CN")}</dd></div><div><dt>上座率</dt><dd>${Math.round(Number(income.attendanceRate ?? 0) * 100)}%</dd></div></dl></section>` : "";
    return `${header}<div class="league-mail-body"><p>${escapeHtml(message.body)}</p><div class="mail-kpis"><span><small>当前排名</small><b>${payload.rank ?? "-"}</b></span><span><small>联赛积分</small><b>${payload.points ?? "-"}</b></span><span><small>阵容提醒</small><b>${alerts.length}</b></span></div>${homeIncome}${next}${alerts.length ? `<section class="mail-alert"><b>阵容可用性</b><p>${alerts.join("；")}</p></section>` : ""}<section class="mail-round-results"><h3>本轮全部赛果</h3>${results}</section></div>`;
  }
  return `${header}<div class="league-mail-body"><p>${escapeHtml(message.body)}</p>${message.type === "reward" && (message.payload?.offerId || message.payload?.offerIds?.length) ? `<button type="button" class="button primary" data-league-tab="backpack">前往背包查看卡包</button>` : ""}</div>`;
}

function leagueShopMarkup() {
  const rosterSlotsUsed = league.ownTeam.s4Assets?.rosterSlotsUsed ?? league.ownTeam.roster.length;
  const rosterLimit = league.ownTeam.s4Assets?.rosterLimit ?? 33;
  const packs = league.shop.catalog.map((pack) => {
    const limited = pack.seasonPurchaseLimit != null;
    const soldOut = limited && pack.remainingQuantity < 1;
    const limitText = limited ? `<small class="league-pack-limit">赛季限购 ${pack.purchasedQuantity}/${pack.seasonPurchaseLimit}</small>` : "";
    return `<article class="league-pack-product tone-${pack.cosmeticType ?? pack.kind} ${soldOut ? "sold-out" : ""}">${s4PackVisualMarkup(pack, { className:"league-shop-pack-visual", state:soldOut ? "已购完" : limited ? "限购1份" : "" })}<div class="league-pack-product-copy"><h3>${escapeHtml(pack.name)}</h3><p>${escapeHtml(pack.description)}</p><strong>${pack.price}<small>金币</small></strong>${limitText}</div><div class="league-pack-purchase"><label for="s4-pack-quantity-${pack.id}">购买数量</label><input type="number" min="1" max="${limited ? 1 : league.shop.maxPurchaseQuantity}" value="1" id="s4-pack-quantity-${pack.id}" aria-label="购买数量" ${limited ? "disabled" : ""}><button class="button primary" type="button" data-s4-pack-buy="${pack.id}" ${soldOut || league.wallet.balance < pack.price ? "disabled" : ""}>${soldOut ? "本赛季已购买" : "购买"}</button></div></article>`;
  }).join("");
  const growth = league.xGrowth;
  const growthProduct = growth ? `<article class="league-pack-product tone-x-growth ${leagueXGrowthMutationPending ? "is-pending" : ""}"><div class="x-growth-shop-icon">★<small>+${growth.shop.points}</small></div><div class="league-pack-product-copy"><h3>${escapeHtml(growth.shop.name)}</h3><p>${escapeHtml(growth.shop.description)}</p><strong>${growth.shop.price}<small>金币</small></strong></div><div class="league-pack-purchase"><label for="x-growth-quantity">购买数量</label><input type="number" min="1" max="20" value="1" id="x-growth-quantity" ${leagueXGrowthMutationPending ? "disabled" : ""}><button class="button primary" type="button" data-x-growth-buy ${league.wallet.balance < growth.shop.price || leagueXGrowthMutationPending ? "disabled" : ""}>${leagueXGrowthPendingField === "buy" ? "购买中…" : "购买"}</button></div></article>` : "";
  const expansion = league.shop.rosterExpansion?.retired ? null : league.shop.rosterExpansion;
  const expansionSoldOut = !expansion || expansion.remainingQuantity < 1;
  const expansionProduct = expansion ? `<article class="league-pack-product tone-roster-expansion ${expansionSoldOut ? "sold-out" : ""}"><div class="roster-expansion-shop-icon"><b>+1</b><small>大名单</small></div><div class="league-pack-product-copy"><h3>${escapeHtml(expansion.name)}</h3><p>${escapeHtml(expansion.description)}</p><strong>${expansion.price}<small>金币 / 个</small></strong><small class="league-pack-limit">永久已购买 ${expansion.purchasedQuantity}/${expansion.purchaseLimit} · 当前上限 ${expansion.currentRosterLimit}</small></div><div class="league-pack-purchase"><label for="roster-expansion-quantity">购买数量</label><input type="number" min="1" max="${Math.max(1, expansion.remainingQuantity)}" value="1" id="roster-expansion-quantity" ${expansionSoldOut ? "disabled" : ""}><button class="button primary" type="button" data-roster-expansion-buy ${expansionSoldOut || league.wallet.balance < expansion.price ? "disabled" : ""}>${expansionSoldOut ? "已达永久上限" : "购买"}</button></div></article>` : "";
  const meteorStand = league.shop.meteorStand;
  const meteorProduct = meteorStand ? `<article class="league-pack-product tone-meteor-stand ${meteorStand.owned ? "sold-out" : ""}"><div class="meteor-stand-shop-icon"><b>☄</b><small>STADIUM FX</small></div><div class="league-pack-product-copy"><h3>${escapeHtml(meteorStand.name)}</h3><p>${escapeHtml(meteorStand.description)}</p><strong>${meteorStand.price.toLocaleString("zh-CN")}<small>金币</small></strong><small class="league-pack-limit">永久解锁 · 账号唯一</small></div><div class="league-pack-purchase"><button class="button primary" type="button" data-meteor-stand-buy ${meteorStand.owned || league.wallet.balance < meteorStand.price ? "disabled" : ""}>${meteorStand.owned ? "已拥有" : "购买并解锁"}</button></div></article>` : "";
  return `<section class="league-panel league-shop"><header><div><small>S4 PLAYER PACKS</small><h2>S4礼包商店</h2></div><b>${league.wallet.balance} 金币</b></header><div class="league-shop-intro"><div><strong>新赛季卡包与俱乐部道具</strong><span>礼包进入背包；成长点和永久直播背景会立即解锁。</span></div><span>名单额度 ${rosterSlotsUsed}/${rosterLimit}</span></div><div class="league-pack-product-grid">${growthProduct}${packs}${meteorProduct}${expansionProduct}</div></section>`;
}

function leagueXGrowthFieldValueMarkup(field) {
  const isHeight = field.key === "heightCm";
  const bonusPoints = Number(field.bonusPoints ?? 0);
  const initialValue = Number(field.value) - bonusPoints;
  return `${initialValue}${bonusPoints ? `<em>+${bonusPoints}</em>` : ""}${isHeight ? "<small>cm</small>" : ""}`;
}

function leagueXGrowthFieldMarkup(field, growth) {
  const isHeight = field.key === "heightCm";
  const maximum = Math.max(0, Math.min(Number(growth.points ?? 0), Number(field.maxValue ?? (isHeight ? 230 : 99)) - Number(field.value ?? 0)));
  const pending = leagueXGrowthMutationPending && leagueXGrowthPendingField === field.key;
  const disabled = (amount) => maximum < amount || leagueXGrowthMutationPending ? "disabled" : "";
  return `<article class="x-growth-field ${isHeight ? "height" : ""} ${field.countsTowardOverall ? "overall-contributor" : ""} ${pending ? "is-pending" : ""}" data-x-growth-field="${field.key}"><span>${escapeHtml(X_ATTRIBUTE_LABELS[field.key] ?? field.label)}</span><b data-x-growth-value>${leagueXGrowthFieldValueMarkup(field)}</b><div class="x-growth-field-actions"><button type="button" data-x-growth-spend="${field.key}" data-x-growth-mode="one" data-x-growth-amount="1" ${disabled(1)}>+1</button><button type="button" data-x-growth-spend="${field.key}" data-x-growth-mode="five" data-x-growth-amount="5" ${disabled(5)}>+5</button><button type="button" data-x-growth-spend="${field.key}" data-x-growth-mode="max" data-x-growth-amount="${maximum}" ${disabled(1)}>最大</button></div></article>`;
}

function leagueXGrowthTasksMarkup(growth) {
  return growth.tasks.map((task) => {
    const target = task.complete ? task.milestones.at(-1) : task.nextTarget;
    const progress = Math.min(100, target ? task.value / target * 100 : 100);
    const reward = task.complete ? 0 : task.rewards[task.completed];
    return `<article class="x-growth-task ${task.complete ? "complete" : ""}"><header><b>${escapeHtml(task.label)}</b><span>${task.complete ? "全部完成" : `下一阶段 +${reward}点`}</span></header><div><i style="width:${progress}%"></i></div><p>${task.value} / ${target}<small>已完成 ${task.completed}/${task.milestones.length} 阶段</small></p></article>`;
  }).join("");
}

function leagueXGrowthMarkup() {
  const growth = league.xGrowth;
  if (!growth) return `<section class="league-panel x-growth-empty"><header><div><small>SUPERSTAR PATH</small><h2>巨星之路</h2></div></header><p class="league-empty">当前球队没有X球员。获得X球员后，成长面板会自动识别球员及位置。</p></section>`;
  const player = growth.player;
  const fields = [...growth.attributes, growth.height].map((field) => leagueXGrowthFieldMarkup(field, growth)).join("");
  const tasks = leagueXGrowthTasksMarkup(growth);
  return `<section class="x-growth-page"><header class="x-growth-hero"><div><small>SUPERSTAR PATH · ${escapeHtml(ROLE_LABELS[player.role] ?? player.role)}</small><h2>★ ${escapeHtml(player.name)}</h2><p>X级 · ${escapeHtml(ROLE_LABELS[player.role] ?? player.role)} · 当前总评 <b data-x-growth-overall>${growth.effectiveOverall ?? player.overall}</b></p></div><aside><small>可用加成点数</small><strong data-x-growth-points>${growth.points}</strong><span data-x-growth-summary>任务 ${growth.earnedPoints} · 购买 ${growth.purchasedPoints} · 已用 ${growth.spentPoints}</span></aside></header><section class="league-panel x-growth-abilities"><header><div><small>27 ADJUSTABLE VALUES</small><h2>能力与身体</h2></div><span>加点会提升能力基础值，身高不影响总评</span></header><div class="x-growth-field-grid">${fields}</div></section><section class="league-panel x-growth-tasks"><header><div><small>LEAGUE & CUP ONLY</small><h2>成长任务</h2></div><span>仅联赛与杯赛计入，友谊赛无进度</span></header><div class="x-growth-task-grid">${tasks}</div></section></section>`;
}

/* coach system deferred to a future branch */
function leagueCoachMarkup() {
  return "";
  const coach = league.coach ?? { cards:[], contract:null, catalog:[] };
  const contract = coach.contract;
  const cards = coach.cards.map((card) => `<article class="coach-card-tile grade-${String(card.coach.grade).toLowerCase()}"><div class="coach-card-art">${card.coach.imageUrl ? `<img src="${escapeHtml(card.coach.imageUrl)}" alt="">` : `<span>${card.coach.grade}</span>`}</div><div class="coach-card-copy"><small>${escapeHtml(card.coach.englishName)}</small><h3>${escapeHtml(card.coach.name)}</h3><p>${escapeHtml(card.coach.clubs)}</p><div class="coach-card-tags">${card.coach.styles.map((style) => `<span>${escapeHtml(style)}</span>`).join("")}</div>${card.signed ? `<b class="coach-card-status">执教中</b>` : `<button type="button" class="button primary" data-coach-sign="${escapeHtml(card.id)}">签约 · ${card.coach.signingFee.toLocaleString()} 金币</button>`}</div></article>`).join("") || `<div class="coach-empty"><strong>暂无教练卡</strong><span>购买教练卡包后，未持有的教练才会进入你的卡库。</span></div>`;
  const recent = contract?.recentOfficialResults?.map((entry) => `<li class="${entry.result}"><b>${entry.result === "win" ? "胜" : entry.result === "draw" ? "平" : "负"}</b><span>${dateText(entry.playedAt)}</span></li>`).join("") || `<li class="empty">暂无正式比赛记录</li>`;
  const active = contract ? `<section class="coach-active-panel"><div class="coach-active-top"><div class="coach-active-badge grade-${String(contract.coach.grade).toLowerCase()}">${contract.coach.grade}</div><div><small>当前主教练</small><h2>${escapeHtml(contract.coach.name)}</h2><p>${escapeHtml(contract.coach.englishName)} · ${escapeHtml(contract.coach.styles.join(" / "))}</p></div><div class="coach-contract-count"><b>${contract.matchesRemaining}</b><span>场正式比赛</span></div></div><div class="coach-active-grid"><div><small>最近五场</small><ol class="coach-form-list">${recent}</ol></div><div><small>当前解雇费用</small><strong class="coach-fee">${contract.terminationFee.toLocaleString()} <i>金币</i></strong><p>五连败可免费解雇。</p></div><div class="coach-active-actions"><label><input type="checkbox" data-coach-auto-renew ${contract.autoRenew ? "checked" : ""}> 到期自动续约</label><button type="button" class="button secondary danger" data-coach-terminate>强行解雇</button></div></div></section>` : `<section class="coach-vacant-panel"><div><small>主教练席位</small><h2>当前空缺</h2><p>签约主教练后，球队正式比赛体力消耗降低30%。</p></div></section>`;
  return `<section class="coach-page"><header class="coach-page-header"><div><small>HEAD COACH OFFICE</small><h2>主教练办公室</h2><p>签约、续约、解雇和管理教练卡资产。</p></div><div class="coach-page-kpis"><span><b>${coach.cards.length}</b><small>教练卡 / 3</small></span><span><b>${contract ? "1" : "0"}</b><small>当前签约</small></span><button type="button" class="button primary" data-coach-pack-buy>购买教练卡包 · 9,000</button></div></header>${active}<section class="coach-library-section"><header><div><small>COACH CARD LIBRARY</small><h2>教练卡库</h2></div><span>未签约卡每场正式比赛收取 ${coach.unsignedCardFee} 金币</span></header><div class="coach-card-grid">${cards}</div></section></section>`;
}

function leagueXGrowthResetMarkup(growth) {
  if (!growth) return "";
  const player = growth.player;
  const xGrowthRoles = ["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"];
  const selectedRole = leagueXGrowthResetRole ?? player.role;
  const selectedSecondaryRole = leagueXGrowthResetSecondaryRole ?? player.secondaryRole ?? "";
  const roleOptions = xGrowthRoles.map((role) => `<option value="${role}" ${role === selectedRole ? "selected" : ""}>${escapeHtml(ROLE_LABELS[role] ?? role)}</option>`).join("");
  const secondaryOptions = xGrowthRoles.filter((role) => role !== "GK").map((role) => `<option value="${role}" ${role === selectedSecondaryRole ? "selected" : ""}>${escapeHtml(ROLE_LABELS[role] ?? role)}</option>`).join("");
  const traitSelection = leagueXGrowthResetTraitOpen ? `<section class="x-growth-reset-traits"><header><div><small>ALL ELIGIBLE TRAITS</small><h3>选择新的初始特性卡</h3></div><span>显示已确认主位置适用的全部特性，只能选择一张</span></header><div data-x-growth-trait-list>${leagueXGrowthTraitChoicesMarkup(growth, selectedRole, growth.initialTraitId)}</div><footer><button class="button primary" type="button" data-x-growth-reset ${leagueXGrowthMutationPending ? "disabled" : ""}>${leagueXGrowthMutationPending && leagueXGrowthPendingField === "reset" ? "正在洗点…" : `选择特性并支付${growth.resetCost ?? 8000}金币`}</button></footer></section>` : "";
  const positionAction = leagueXGrowthResetTraitOpen ? `<button class="button secondary" type="button" data-x-growth-position-edit ${leagueXGrowthMutationPending ? "disabled" : ""}>重新选择位置</button>` : `<button class="button primary" type="button" data-x-growth-position-confirm ${leagueXGrowthMutationPending ? "disabled" : ""}>确认位置并选择特性</button>`;
  return `<section class="league-panel x-growth-reset ${leagueXGrowthMutationPending ? "is-pending" : ""}"><header><div><small>POSITION & TRAIT RESET</small><h2>洗点、位置与特性</h2></div><span>花费 ${growth.resetCost ?? 8000} 金币，返还全部已用加成点并重选初始特性</span></header><div class="x-growth-reset-controls"><label>主位置<select data-x-growth-role ${leagueXGrowthResetTraitOpen || leagueXGrowthMutationPending ? "disabled" : ""}>${roleOptions}</select></label><label>副位置<select data-x-growth-secondary ${leagueXGrowthResetTraitOpen || selectedRole === "GK" || leagueXGrowthMutationPending ? "disabled" : ""}><option value="">无</option>${secondaryOptions}</select></label>${positionAction}</div>${traitSelection}</section>`;
}

function leagueXGrowthTraitChoicesMarkup(growth, role, selectedTraitId = null) {
  const group = role === "GK" ? "GK" : ["ST", "LW", "RW"].includes(role) ? "ATT" : ["CB", "LB", "RB"].includes(role) ? "DEF" : "MID";
  return (growth.traitCatalog ?? []).filter((trait) => trait.eligibleRoleGroups?.includes("ANY") || trait.eligibleRoleGroups?.includes(group)).map((trait) => `<label class="x-growth-reset-trait"><input type="radio" name="x-growth-reset-trait" value="${escapeHtml(trait.id)}" ${trait.id === selectedTraitId ? "checked" : ""} ${leagueXGrowthMutationPending ? "disabled" : ""}><span><b>${escapeHtml(trait.name)}</b><small>${escapeHtml(trait.summary)}</small></span></label>`).join("");
}

function renderLeagueXGrowthSection() {
  const pageContent = app.querySelector(":scope > .league-shell > .league-main-layout > .league-page-content");
  if (!pageContent) return;
  if (leagueTab === "x-growth") {
    pageContent.innerHTML = leagueXGrowthMarkup();
    if (league.xGrowth) pageContent.querySelector(".x-growth-hero")?.insertAdjacentHTML("afterend", leagueXGrowthResetMarkup(league.xGrowth));
  } else if (leagueTab === "shop") pageContent.innerHTML = leagueShopMarkup();
  syncLeagueShellChrome();
}

function syncLeagueXGrowthPendingUi() {
  if (!leagueMode || !leagueXGrowthMutationPending) return;
  app.querySelectorAll("[data-x-growth-spend], [data-x-growth-buy], [data-x-growth-reset], [data-x-growth-position-confirm], [data-x-growth-position-edit]").forEach((button) => { button.disabled = true; });
  app.querySelectorAll("#x-growth-quantity, [data-x-growth-role], [data-x-growth-secondary], input[name=x-growth-reset-trait]").forEach((control) => { control.disabled = true; });
  if (leagueXGrowthPendingField === "buy") {
    const button = app.querySelector("[data-x-growth-buy]");
    if (button) button.textContent = "购买中…";
    app.querySelector(".tone-x-growth")?.classList.add("is-pending");
    return;
  }
  if (leagueXGrowthPendingField === "reset") {
    const button = app.querySelector("[data-x-growth-reset]");
    if (button) button.textContent = "正在洗点…";
    app.querySelector(".x-growth-reset")?.classList.add("is-pending");
    return;
  }
  const field = app.querySelector(`[data-x-growth-field="${CSS.escape(String(leagueXGrowthPendingField ?? ""))}"]`);
  field?.classList.add("is-pending");
  const pendingButton = [...(field?.querySelectorAll("[data-x-growth-spend]") ?? [])].find((button) => button.dataset.xGrowthMode === leagueXGrowthPendingMode);
  if (pendingButton) pendingButton.textContent = "处理中…";
}

function syncLeagueXGrowthMutationUi(path, fieldKey) {
  if (!leagueMode || !league?.xGrowth || !["x-growth", "shop"].includes(leagueTab)) return;
  if (leagueTab !== "x-growth" || path !== "/spend") {
    renderLeagueXGrowthSection();
    return;
  }

  const growth = league.xGrowth;
  const points = app.querySelector("[data-x-growth-points]");
  const summary = app.querySelector("[data-x-growth-summary]");
  const overall = app.querySelector("[data-x-growth-overall]");
  if (points) points.textContent = growth.points;
  if (summary) summary.textContent = `任务 ${growth.earnedPoints} · 购买 ${growth.purchasedPoints} · 已用 ${growth.spentPoints}`;
  if (overall) overall.textContent = growth.effectiveOverall ?? growth.player.overall;

  const fields = [...growth.attributes, growth.height];
  fields.forEach((field) => {
    const article = app.querySelector(`[data-x-growth-field="${CSS.escape(field.key)}"]`);
    if (!article) return;
    article.classList.remove("is-pending");
    if (field.key === fieldKey) {
      const value = article.querySelector("[data-x-growth-value]");
      if (value) value.innerHTML = leagueXGrowthFieldValueMarkup(field);
    }
    const maximum = Math.max(0, Math.min(Number(growth.points ?? 0), Number(field.maxValue ?? (field.key === "heightCm" ? 230 : 99)) - Number(field.value ?? 0)));
    article.querySelectorAll("[data-x-growth-spend]").forEach((button) => {
      const mode = button.dataset.xGrowthMode;
      const amount = mode === "one" ? 1 : mode === "five" ? 5 : maximum;
      button.dataset.xGrowthAmount = String(amount);
      button.disabled = maximum < (mode === "five" ? 5 : 1);
      button.textContent = mode === "one" ? "+1" : mode === "five" ? "+5" : "最大";
    });
  });
  const taskGrid = app.querySelector(".x-growth-task-grid");
  if (taskGrid) taskGrid.innerHTML = leagueXGrowthTasksMarkup(growth);
  app.querySelectorAll("[data-x-growth-role], [data-x-growth-secondary], input[name=x-growth-reset-trait], [data-x-growth-reset], [data-x-growth-position-confirm], [data-x-growth-position-edit]").forEach((control) => {
    if (control.matches("[data-x-growth-role]")) control.disabled = leagueXGrowthResetTraitOpen;
    else if (control.matches("[data-x-growth-secondary]")) control.disabled = leagueXGrowthResetTraitOpen || (leagueXGrowthResetRole ?? growth.player.role) === "GK";
    else control.disabled = false;
  });
  app.querySelector(".x-growth-reset")?.classList.remove("is-pending");
  syncLeagueShellChrome();
}

function leagueReviewMatchListMarkup() {
  const matches = (league.reviewHistory ?? []).filter((match) => match.hasDotReplay);
  if (!matches.length) return `<p class="league-empty">还没有完成的 V2.1d 友谊赛。新友谊赛完场后，小圆点关键事件会保存在这里。</p>`;
  return matches.map((match) => {
    const ownIsHome = match.homeId === league.ownTeam.id;
    const opponent = ownIsHome ? match.awayName : match.homeName;
    const ownScore = match.score?.[ownIsHome ? 0 : 1];
    const rivalScore = match.score?.[ownIsHome ? 1 : 0];
    const result = ownScore > rivalScore ? "win" : ownScore < rivalScore ? "loss" : "draw";
    return `<button type="button" class="league-review-match result-${result} ${match.id === leagueReviewMatchId ? "active" : ""}" data-review-match="${escapeHtml(match.id)}"><span><small>V2.1D DOT REPLAY</small><b>${escapeHtml(opponent)}</b><em>${new Date(match.playedAt).toLocaleDateString()} · 动态关键事件</em></span><strong>${ownScore}:${rivalScore}</strong></button>`;
  }).join("");
}

const DOT_REPLAY_TYPE_LABELS = Object.freeze({ kickoff:"开球", goal:"进球", ownGoal:"乌龙球", save:"扑救", miss:"射偏", block:"封堵", penalty:"点球", penaltyAwarded:"判罚点球", offside:"越位", yellow:"黄牌", red:"红牌", injury:"受伤", substitution:"换人", fulltime:"完场" });
const DOT_REPLAY_BODY_PART_LABELS = Object.freeze({ header:"头球", leftFoot:"左脚", rightFoot:"右脚", other:"其他部位" });
const DOT_REPLAY_ATTACK_TYPE_LABELS = Object.freeze({ throughBall:"直塞配合", cross:"传中", cutback:"倒三角回敲", counter:"快速反击", longShot:"远射", setPiece:"定位球", freeKick:"直接任意球", rebound:"补射", penalty:"点球", individual:"个人突破", soloCounter:"抢断后单刀" });

function leagueReviewGoalFrames(detail) {
  return (detail?.dotReplay?.frames ?? []).filter((frame) => ["goal", "ownGoal"].includes(frame.type));
}

function leagueReviewDotReplayMarkup(detail) {
  const frames = leagueReviewGoalFrames(detail);
  if (!frames.length) return "";
  const frameIndex = Math.max(0, Math.min(frames.length - 1, leagueReviewReplayFrameIndex));
  const frame = frames[frameIndex];
  const percent = (value) => Math.max(1, Math.min(99, Number(value) || 50));
  const highlightedIds = new Set([frame.actorId, frame.assistId, frame.opponentId, frame.targetId].filter(Boolean));
  const dots = (frame.teams ?? []).flatMap((team) => (team.players ?? []).map((player) => {
    const highlighted = highlightedIds.has(player.id);
    const shortName = String(player.name ?? player.id ?? "球员").replaceAll("·", "").slice(-2);
    return `<span class="dot-replay-player team-${team.teamIndex} ${highlighted ? "is-highlighted" : ""}" data-dot-replay-player="${team.teamIndex}:${escapeHtml(player.id)}" style="left:${percent(player.y)}%;top:${percent(player.x)}%" title="${escapeHtml(`${player.name ?? player.id} · ${ROLE_LABELS[player.role] ?? player.role ?? ""}`)}"><b>${escapeHtml(shortName)}</b></span>`;
  })).join("");
  const goals = `<span class="dot-replay-goal goal-left" aria-hidden="true"><i></i></span><span class="dot-replay-goal goal-right" aria-hidden="true"><i></i></span>`;
  const players = new Map((frame.teams ?? []).flatMap((team) => team.players ?? []).map((player) => [player.id, player]));
  const eventPlayer = players.get(frame.actorId);
  const assistPlayer = players.get(frame.assistId);
  const goalkeeper = players.get(frame.opponentId);
  const effects = `<span class="dot-replay-offside-line" data-dot-replay-offside-line aria-hidden="true"></span><span class="dot-replay-ball-trail" data-dot-replay-trail aria-hidden="true"></span><span class="dot-replay-goal-effect" data-dot-replay-goal-effect><small>GOAL</small><b>${escapeHtml(eventPlayer?.name ?? "进球")}</b></span>`;
  const ball = `<span class="dot-replay-ball" data-dot-replay-ball style="left:${percent(frame.ball?.y)}%;top:${percent(frame.ball?.x)}%" title="足球"></span>`;
  const pitch = pitchMarkup(`${goals}${dots}${effects}${ball}`, "", "league-review-pitch s4-readonly-pitch league-review-dot-pitch");
  const timeline = frames.map((entry, index) => {
    const entryPlayers = new Map((entry.teams ?? []).flatMap((team) => team.players ?? []).map((player) => [player.id, player]));
    const scorer = entryPlayers.get(entry.actorId)?.name ?? (entry.type === "ownGoal" ? "乌龙球" : "进球");
    return `<button type="button" class="${index === frameIndex ? "active" : ""}" data-review-replay-frame="${index}" title="${escapeHtml(entry.text ?? "")}"><b>${Math.ceil(Number(entry.minute) || 0)}'</b><span><strong>第${index + 1}球</strong><small>${escapeHtml(scorer)}</small></span><em>${entry.score?.join(":") ?? ""}</em></button>`;
  }).join("");
  const xg = Number.isFinite(Number(frame.xg)) ? ` · xG ${Number(frame.xg).toFixed(2)}` : "";
  const bodyPart = frame.bodyPart ? ` · ${DOT_REPLAY_BODY_PART_LABELS[frame.bodyPart] ?? frame.bodyPart}` : "";
  const attackType = DOT_REPLAY_ATTACK_TYPE_LABELS[frame.attackType] ?? frame.attackType ?? "运动战配合";
  const finish = DOT_REPLAY_BODY_PART_LABELS[frame.bodyPart] ?? frame.bodyPartLabel ?? "射门";
  const organization = (frame.sequence ?? []).filter((phase) => phase.actorId && phase.action !== "shotOutcome").map((phase, index) => {
    const actor = players.get(phase.actorId)?.name ?? phase.actorId;
    const defender = players.get(phase.defenderId)?.name;
    const action = { control:"控球", pass:"传球", carry:"带球推进", keyPass:"送出助攻", shot:"完成射门" }[phase.action] ?? "参与组织";
    return `<li class="${phase.role ? `is-${escapeHtml(phase.role)}` : ""}"><i>${index + 1}</i><span><b>${escapeHtml(actor)}</b><small>${escapeHtml(action)}${defender ? ` · 面对 ${escapeHtml(defender)}` : ""}</small></span></li>`;
  }).join("");
  const assistLabel = assistPlayer?.name ?? (frame.attackType === "penalty" ? "点球直接得分" : "无助攻");
  return `<section class="league-review-dot-replay"><header><div><small>V2.1D GOAL REPLAY</small><b>${Math.ceil(Number(frame.minute) || 0)}' · ${escapeHtml(DOT_REPLAY_TYPE_LABELS[frame.type] ?? frame.type)} · ${frame.score?.join(":") ?? "-"}${xg}${bodyPart}</b><span data-dot-replay-phase>${escapeHtml(frame.stage ?? "进球组织")}</span></div><div><button type="button" data-review-replay-step="-1" ${frameIndex === 0 ? "disabled" : ""}>‹</button><button type="button" data-review-replay-toggle>${leagueReviewReplayPlaying ? "暂停" : "播放"}</button><button type="button" data-review-replay-step="1" ${frameIndex === frames.length - 1 ? "disabled" : ""}>›</button></div></header><div class="dot-replay-goal-meta"><article><small>进球者</small><b>${escapeHtml(eventPlayer?.name ?? "未知")}</b></article><article class="is-assist"><small>助攻</small><b>${escapeHtml(assistLabel)}</b></article><article><small>终结</small><b>${escapeHtml(`${attackType} · ${finish}`)}</b></article><article class="is-defense"><small>最后防线</small><b>${escapeHtml(goalkeeper?.name ?? "防线未能阻止")}</b></article></div><div class="dot-replay-layout"><nav class="dot-replay-timeline">${timeline}</nav><div class="dot-replay-stage"><div class="dot-replay-pitch-wrap">${pitch}</div><ol class="dot-replay-organization" aria-label="进球组织与攻防过程">${organization}</ol><p>${escapeHtml(frame.detail ?? frame.text ?? "")}</p></div></div></section>`;
}

function leagueReviewPanelMarkup() {
  if (leagueReviewLoading) return `<div class="league-review-state"><span></span><h2>正在读取动态回放…</h2><p>加载本场 V2.1d 关键事件轨迹。</p></div>`;
  const detail = leagueReviewDetail;
  if (!detail) return `<div class="league-review-state"><h2>暂无小圆点复盘</h2><p>完成一场 V2.1d 友谊赛后，动态关键事件会显示在这里。</p></div>`;
  if (!detail.dotReplay?.frames?.length || detail.teams?.length !== 2) return `<div class="league-review-state"><h2>这场比赛没有 V2.1d 回放</h2><p>赛后复盘仅展示 V2.1d 友谊赛的小圆点数据。</p></div>`;
  const displayScore = detail.aggregateScore ?? detail.score ?? [0, 0];
  if (!leagueReviewGoalFrames(detail).length) return `<section class="league-review-detail has-dot-replay"><header><div><small>V2.1D FRIENDLY · GOAL REPLAY</small><h2>${escapeHtml(detail.teams[0].name)} <strong>${displayScore[0]} : ${displayScore[1]}</strong> ${escapeHtml(detail.teams[1].name)}</h2></div></header><div class="league-review-state"><h2>本场没有进球回放</h2><p>时间轴只保留进球节点；零进球比赛不会用普通事件填充。</p></div></section>`;
  const dotReplay = leagueReviewDotReplayMarkup(detail);
  return `<section class="league-review-detail has-dot-replay"><header><div><small>V2.1D FRIENDLY · SINGLE MATCH VIEW</small><h2>${escapeHtml(detail.teams[0].name)} <strong>${displayScore[0]} : ${displayScore[1]}</strong> ${escapeHtml(detail.teams[1].name)}</h2></div></header><div class="league-review-board is-dot-replay">${dotReplay}</div></section>`;
}

function leagueReviewMarkup() {
  return `<section class="league-review-page"><aside><header><small>V2.1D REPLAYS</small><h2>赛后复盘</h2><p>仅保存友谊赛动态小圆点回放</p></header><div class="league-review-match-list">${leagueReviewMatchListMarkup()}</div></aside><main data-league-review-panel>${leagueReviewPanelMarkup()}</main></section>`;
}

const DOT_REPLAY_STAGE_LABELS = Object.freeze({ static:"阵型落位", buildUp:"后场组织", progression:"整体推进", finalThird:"进入进攻三区", chance:"制造机会", assist:"送出关键助攻", shot:"完成射门", goal:"射门入网", ownGoal:"乌龙球", save:"门将扑救", miss:"射门偏出", block:"防守封堵" });

function stopLeagueReviewDotReplay() {
  leagueReviewReplayAnimationToken += 1;
}

function leagueReviewReplaySequence(frames, frameIndex) {
  const frame = frames[frameIndex];
  const current = Array.isArray(frame?.sequence) && frame.sequence.length ? frame.sequence : [frame];
  if (current.length > 1 || frameIndex === 0) return current;
  const previous = frames[frameIndex - 1];
  const previousSequence = Array.isArray(previous?.sequence) && previous.sequence.length ? previous.sequence : [previous];
  return [previousSequence.at(-1), current[0]].filter(Boolean);
}

function mountLeagueReviewDotReplay() {
  stopLeagueReviewDotReplay();
  const root = app.querySelector(".league-review-dot-replay");
  const frames = leagueReviewGoalFrames(leagueReviewDetail);
  if (!root || !frames.length) return;
  const frameIndex = Math.max(0, Math.min(frames.length - 1, leagueReviewReplayFrameIndex));
  const frame = frames[frameIndex];
  const sequence = leagueReviewReplaySequence(frames, frameIndex);
  const token = leagueReviewReplayAnimationToken;
  const playerElements = new Map([...root.querySelectorAll("[data-dot-replay-player]")].map((element) => [element.dataset.dotReplayPlayer, element]));
  const ballElement = root.querySelector("[data-dot-replay-ball]");
  const trailElement = root.querySelector("[data-dot-replay-trail]");
  const offsideLineElement = root.querySelector("[data-dot-replay-offside-line]");
  const goalEffectElement = root.querySelector("[data-dot-replay-goal-effect]");
  const pitchElement = root.querySelector(".league-review-dot-pitch");
  const phaseElement = root.querySelector("[data-dot-replay-phase]");
  const fallbackPositions = new Map((frame.teams ?? []).flatMap((team) => (team.players ?? []).map((player) => [`${team.teamIndex}:${player.id}`, player])));
  const playerNames = new Map((frame.teams ?? []).flatMap((team) => (team.players ?? []).map((player) => [player.id, player.name ?? player.id])));
  const positions = (phase) => new Map((phase?.teams ?? []).flatMap((team) => (team.players ?? []).map((player) => [`${team.teamIndex}:${player.id}`, player])));
  const clampPosition = (value, ball = false) => Math.max(ball ? -4 : 1, Math.min(ball ? 104 : 99, Number(value) || 50));
  const mix = (from, to, progress) => Number(from) + (Number(to) - Number(from)) * progress;
  const smooth = (progress) => progress * progress * (3 - 2 * progress);
  const segmentDuration = 900;
  const finalHold = 850;
  const segmentCount = Math.max(1, sequence.length - 1);
  const cycleDuration = segmentCount * segmentDuration + finalHold;
  let elapsed = 0;
  let lastTime = performance.now();

  const draw = () => {
    const movingDuration = segmentCount * segmentDuration;
    const movingElapsed = Math.min(elapsed, Math.max(0, movingDuration - .001));
    const segmentIndex = sequence.length <= 1 ? 0 : Math.min(sequence.length - 2, Math.floor(movingElapsed / segmentDuration));
    const rawProgress = sequence.length <= 1 || elapsed >= movingDuration ? 1 : (movingElapsed % segmentDuration) / segmentDuration;
    const progress = smooth(rawProgress);
    const from = sequence[segmentIndex] ?? frame;
    const to = sequence[Math.min(sequence.length - 1, segmentIndex + 1)] ?? from;
    const fromPositions = positions(from);
    const toPositions = positions(to);
    const pressureId = to.defensiveRoles?.pressureId ?? to.defenderId ?? null;
    const coverIds = new Set(to.defensiveRoles?.coverIds ?? []);
    const markerIds = new Set(to.defensiveRoles?.markerIds ?? []);
    if (offsideLineElement) {
      const line = Number(to.offside?.line);
      offsideLineElement.classList.toggle("active", Number.isFinite(line));
      if (Number.isFinite(line)) offsideLineElement.style.left = `${clampPosition(line)}%`;
    }
    playerElements.forEach((element, key) => {
      const start = fromPositions.get(key) ?? fallbackPositions.get(key);
      const end = toPositions.get(key) ?? start ?? fallbackPositions.get(key);
      if (!start || !end) return;
      element.style.left = `${clampPosition(mix(start.y, end.y, progress))}%`;
      element.style.top = `${clampPosition(mix(start.x, end.x, progress))}%`;
      element.classList.toggle("is-current-actor", Boolean(to.actorId) && key.endsWith(`:${to.actorId}`));
      element.classList.toggle("is-current-defender", Boolean(pressureId) && key.endsWith(`:${pressureId}`));
      element.classList.toggle("is-current-cover", [...coverIds].some((playerId) => key.endsWith(`:${playerId}`)));
      element.classList.toggle("is-current-marker", [...markerIds].some((playerId) => key.endsWith(`:${playerId}`)));
    });
    let currentBall = null;
    if (ballElement) {
      const start = from.ball ?? frame.ball ?? { x:50, y:50 };
      const end = to.ball ?? start;
      const arc = sequence.length > 1 ? Math.sin(progress * Math.PI) * (to.stage === "goal" || to.stage === "miss" ? 4 : 2.2) : 0;
      currentBall = { x:clampPosition(mix(start.x, end.x, progress) - arc, true), y:clampPosition(mix(start.y, end.y, progress), true) };
      ballElement.style.left = `${currentBall.y}%`;
      ballElement.style.top = `${currentBall.x}%`;
      if (trailElement && pitchElement) {
        const bounds = pitchElement.getBoundingClientRect();
        const startX = Number(start.y) / 100 * bounds.width;
        const startY = Number(start.x) / 100 * bounds.height;
        const endX = currentBall.y / 100 * bounds.width;
        const endY = currentBall.x / 100 * bounds.height;
        const distance = Math.hypot(endX - startX, endY - startY);
        trailElement.style.left = `${startX}px`;
        trailElement.style.top = `${startY}px`;
        trailElement.style.width = `${distance}px`;
        trailElement.style.transform = `rotate(${Math.atan2(endY - startY, endX - startX)}rad)`;
        trailElement.style.opacity = progress > .04 && progress < .98 ? String(Math.sin(progress * Math.PI) * .78) : "0";
      }
    }
    const goalActive = ["goal", "ownGoal"].includes(frame.type) && ["goal", "ownGoal"].includes(to.stage) && (progress > .58 || elapsed >= movingDuration);
    root.classList.toggle("is-goal-active", goalActive);
    goalEffectElement?.classList.toggle("active", goalActive);
    root.querySelector(".dot-replay-goal.goal-left")?.classList.toggle("active", goalActive && Number(frame.attackingTeamIndex) !== 1);
    root.querySelector(".dot-replay-goal.goal-right")?.classList.toggle("active", goalActive && Number(frame.attackingTeamIndex) === 1);
    if (phaseElement) {
      const actionLabel = { control:"控球", pass:"传球", carry:"带球推进", keyPass:"关键助攻", shot:"起脚射门", shotOutcome:"射门结果" }[to.action] ?? "";
      const actorLabel = to.actorId && playerNames.get(to.actorId) ? ` · ${playerNames.get(to.actorId)}` : "";
      const defenseLabel = to.defensiveRoles?.pressureId
        ? ` · 防守：压迫 + ${to.defensiveRoles.coverIds?.length ?? 0}人保护 + ${to.defensiveRoles.markerIds?.length ?? 0}人盯防`
        : "";
      phaseElement.textContent = `${DOT_REPLAY_STAGE_LABELS[to.stage] ?? to.stage ?? "关键节点"}${actionLabel ? ` · ${actionLabel}` : ""}${actorLabel}${defenseLabel}`;
    }
  };

  const animate = (time) => {
    if (token !== leagueReviewReplayAnimationToken || !root.isConnected) return;
    const delta = Math.min(100, Math.max(0, time - lastTime));
    lastTime = time;
    if (leagueReviewReplayPlaying && sequence.length > 1) elapsed = (elapsed + delta) % cycleDuration;
    draw();
    requestAnimationFrame(animate);
  };
  root.querySelector("[data-review-replay-frame].active")?.scrollIntoView({ block:"nearest" });
  draw();
  requestAnimationFrame(animate);
}

function renderLeagueReviewPanel() {
  const panel = app.querySelector("[data-league-review-panel]");
  if (panel) panel.innerHTML = leagueReviewPanelMarkup();
  app.querySelectorAll("[data-review-match]").forEach((button) => button.classList.toggle("active", button.dataset.reviewMatch === leagueReviewMatchId));
  mountLeagueReviewDotReplay();
}

async function loadLeaguePlayerDirectory({ force = false } = {}) {
  if (!league?.ownTeam || !force && league.playerDirectory) return league?.playerDirectory ?? null;
  if (leaguePlayerDirectoryRequest) return leaguePlayerDirectoryRequest;
  const ownerId = league.ownTeam.ownerId;
  leaguePlayerDirectoryLoading = true;
  const request = api("/api/versus/league/player-directory", { method:"POST", body:leagueIdentity() })
    .then((value) => {
      if (league?.ownTeam?.ownerId === ownerId) league = { ...league, playerDirectory:value.playerDirectory };
      return value.playerDirectory;
    })
    .catch((error) => {
      showToast(error.message);
      return league?.playerDirectory ?? null;
    })
    .finally(() => {
      if (leaguePlayerDirectoryRequest === request) leaguePlayerDirectoryRequest = null;
      leaguePlayerDirectoryLoading = false;
      if (!leagueMode || league?.ownTeam?.ownerId !== ownerId) return;
      if (leagueTab === "overview") refreshLeagueOverviewPlayerSearch();
      else if (leagueTab === "players" || leagueTab === "market") renderLeague();
    });
  leaguePlayerDirectoryRequest = request;
  return request;
}

async function loadLeagueHonorRoom({ force = false } = {}) {
  if (!league?.ownTeam || !force && league.honorRoom) return league?.honorRoom ?? null;
  if (leagueHonorRoomRequest) return leagueHonorRoomRequest;
  const shouldRenderLoading = leagueTab === "club" && leagueClubPage === "honorRoom" && !league.honorRoom && !leagueHonorRoomLoading;
  const ownerId = league.ownTeam.ownerId;
  leagueHonorRoomLoading = true;
  if (shouldRenderLoading) renderLeague();
  const request = api("/api/versus/league/honor-room", { method:"POST", body:leagueIdentity() })
    .then((value) => {
      if (league?.ownTeam?.ownerId === ownerId) league = { ...league, honorRoom:value.honorRoom };
      return value.honorRoom;
    })
    .catch((error) => {
      showToast(error.message);
      return league?.honorRoom ?? null;
    })
    .finally(() => {
      if (leagueHonorRoomRequest === request) leagueHonorRoomRequest = null;
      leagueHonorRoomLoading = false;
      if (leagueMode && leagueTab === "club" && leagueClubPage === "honorRoom" && league?.ownTeam?.ownerId === ownerId) renderLeague();
    });
  leagueHonorRoomRequest = request;
  return request;
}

const HONOR_TROPHY_ASSETS = Object.freeze({
  league:"/versus/honor_assets/trophy-league-v2.webp",
  cup:"/versus/honor_assets/trophy-cup-v2.webp",
  worldCup:"/versus/honor_assets/trophy-world-cup-v2.webp",
  ballonDor:"/versus/honor_assets/trophy-ballon-dor-v2.webp",
});
const HONOR_TROPHY_DIMENSIONS = Object.freeze({
  league:[585, 1200],
  cup:[744, 1200],
  worldCup:[445, 1200],
  ballonDor:[791, 1200],
});
const HONOR_CLUB_ACCENTS = Object.freeze({
  "P-A927135074":["#d7b06f","#7d4e92"],
  "P-C0ACCAAD1C":["#cfcfd8","#385da8"],
  "P-5CF850B13B":["#f1efe8","#b8a064"],
  "P-F17F668064":["#8bd7ff","#2879c7"],
  "P-A9C66353D3":["#f0d75c","#2474a6"],
  "P-23D50182AD":["#75c9d7","#455a78"],
  "P-269ABD614F":["#d0b48b","#673d38"],
  "P-A3FCAA6528":["#e9c258","#8c292c"],
  "P-F162C8A606":["#f1df4d","#8c7819"],
});

function honorTrophyMarkup(type, season, index) {
  const label = type === "league" ? "联赛冠军" : type === "cup" ? "杯赛冠军" : "世界杯冠军";
  const [width, height] = HONOR_TROPHY_DIMENSIONS[type];
  return `<figure class="honor-trophy type-${type}" style="--trophy-delay:${index * 45}ms" title="${escapeHtml(`${season} ${label}`)}"><div class="trophy-model"><img class="trophy-render" src="${HONOR_TROPHY_ASSETS[type]}" alt="" draggable="false" decoding="async" loading="lazy" fetchpriority="low" width="${width}" height="${height}"></div><figcaption><b>${escapeHtml(season)}</b></figcaption></figure>`;
}

function honorTrophyGalleryMarkup(type, seasons) {
  const title = type === "league" ? "联赛冠军" : type === "cup" ? "杯赛冠军" : "世界杯";
  const english = type === "league" ? "LEAGUE" : type === "cup" ? "CUP" : "WORLD CUP";
  const trophies = seasons.length
    ? seasons.map((season, index) => honorTrophyMarkup(type, season, index)).join("")
    : `<div class="empty-trophy-case"><span>◇</span><b>尚待镌刻</b><small>NO ${english} TROPHY YET</small></div>`;
  return `<article class="trophy-gallery type-${type}"><header><div><small>${english} HONOURS</small><h3>${title}</h3></div><strong>${seasons.length}<small>座</small></strong></header><div class="trophy-shelf">${trophies}</div></article>`;
}

function honorPlayerCardMarkup(record) {
  return record ? s4PlayerCardMarkup(record.player, { card:record.card, className:"honor-history-card", lazyImage:true }) : "";
}

function honorPodiumMarkup(record, rank) {
  if (!record) return "";
  return `<article class="podium-entry rank-${rank}"><div class="podium-rank"><span>0${rank}</span><small>${rank === 1 ? "CLUB RECORD" : "APPEARANCES"}</small></div><div class="podium-card">${honorPlayerCardMarkup(record)}</div><footer><strong>${record.appearances}<small>场</small></strong><div><b>${escapeHtml(record.player.name)}</b><span>${record.goals}球 · ${record.assists}助 · ${Number(record.averageRating).toFixed(2)}评分</span></div></footer></article>`;
}

function honorMetricPodiumMarkup(record, rank, metric, unit) {
  if (!record) return "";
  return `<article class="podium-entry rank-${rank}"><div class="podium-rank"><span>0${rank}</span><small>${rank === 1 ? "CLUB RECORD" : "TOP THREE"}</small></div><div class="podium-card">${honorPlayerCardMarkup(record)}</div><footer><strong>${record[metric]}<small>${unit}</small></strong><div><b>${escapeHtml(record.player.name)}</b><span>${record.appearances}场 · ${record.goals}球 · ${record.assists}助${record.redCards ? ` · ${record.redCards}红牌` : ""}</span></div></footer></article>`;
}

function honorMetricPodium(entries, metric, unit) {
  const podium = [entries[1], entries[0], entries[2]].map((record, index) => honorMetricPodiumMarkup(record, [2, 1, 3][index], metric, unit)).join("");
  return podium || '<div class="honor-record-empty">暂无队史记录</div>';
}

function honorRecordFeatureMarkup(record, kind, awardCount = 0) {
  if (!record) return `<div class="honor-record-empty">暂无队史记录</div>`;
  const ballonDor = kind === "ballonDor";
  const assister = kind === "assister";
  const redCardLeader = kind === "redCardLeader";
  const headline = ballonDor
    ? `金球奖<small>×${Math.max(1, awardCount)}</small>`
    : assister
      ? `${record.assists}<small>助攻</small>`
      : redCardLeader
        ? `${record.redCards}<small>红牌</small>`
        : `${record.goals}<small>球</small>`;
  const [awardWidth, awardHeight] = HONOR_TROPHY_DIMENSIONS.ballonDor;
  const award = ballonDor ? `<div class="ballon-award-trophy" aria-label="金球奖奖杯"><img class="trophy-render" src="${HONOR_TROPHY_ASSETS.ballonDor}" alt="" draggable="false" decoding="async" loading="lazy" fetchpriority="low" width="${awardWidth}" height="${awardHeight}"></div>` : "";
  const recordLabel = ballonDor ? "俱乐部金球奖得主" : assister ? "队史助攻纪录" : redCardLeader ? "队史红牌纪录" : "队史进球纪录";
  return `<div class="record-feature-content"><div class="record-feature-card">${honorPlayerCardMarkup(record)}</div><div class="record-feature-copy">${award}<span>${recordLabel}</span><h3>${escapeHtml(record.player.name)}</h3><strong>${headline}</strong><p>${record.appearances}场 · ${record.goals}球 · ${record.assists}助攻${record.redCards ? ` · ${record.redCards}红牌` : ""}</p><dl><div><dt>场均评分</dt><dd>${Number(record.averageRating).toFixed(2)}</dd></div><div><dt>最高强化</dt><dd>${record.upgradeLevel ? `+${record.upgradeLevel}` : "未强化"}</dd></div></dl></div></div>`;
}

function honorBallonDorWinnersMarkup(winners) {
  if (!winners.length) return `<div class="empty-ballon"><div class="empty-ballon-model"><img class="trophy-render" src="${HONOR_TROPHY_ASSETS.ballonDor}" alt="" draggable="false" decoding="async" loading="lazy" fetchpriority="low" width="${HONOR_TROPHY_DIMENSIONS.ballonDor[0]}" height="${HONOR_TROPHY_DIMENSIONS.ballonDor[1]}"></div><div><small>THE NEXT BALLON D'OR</small><h3>金色展台仍在等待</h3></div></div>`;
  return `<div class="ballon-winners-grid">${winners.map((winner) => `<article class="ballon-winner"><div>${honorPlayerCardMarkup(winner.record)}</div><section><small>${escapeHtml(winner.seasons.join(" · "))}</small><h3>${escapeHtml(winner.record.player.name)}</h3><strong>金球奖 <b>×${winner.awardCount}</b></strong><p>${winner.record.appearances}场 · ${winner.record.goals}球 · ${winner.record.assists}助攻</p></section></article>`).join("")}</div>`;
}

function leagueHonorRoomMarkup() {
  const history = league.honorRoom;
  if (leagueHonorRoomLoading && !history) return `<section class="league-panel honor-room-loading"><span></span><h2>正在载入荣誉档案</h2><p>奖杯与球员卡将在进入页面后按需加载。</p></section>`;
  if (!history) return `<section class="league-panel"><p class="league-empty">荣誉室数据尚未建立，将在下一次每日联赛结算后自动生成。</p></section>`;
  const honors = history.honors ?? { league:[], cup:[], worldCup:[] };
  const totalTrophies = honors.league.length + honors.cup.length + honors.worldCup.length;
  const accent = HONOR_CLUB_ACCENTS[history.club.ownerId] ?? ["#d7b06f","#7d4e92"];
  const worldCupGallery = honors.worldCup.length ? honorTrophyGalleryMarkup("worldCup", honors.worldCup) : "";
  const appearances = history.appearances ?? [];
  const podium = [appearances[1], appearances[0], appearances[2]].map((record, index) => honorPodiumMarkup(record, [2, 1, 3][index])).join("");
  const scorers = history.scorers ?? (history.scorer ? [history.scorer] : []);
  const assisters = history.assisters ?? (history.assister ? [history.assister] : []);
  const redCardLeaders = history.redCardLeaders ?? (history.redCardLeader ? [history.redCardLeader] : []);
  const ballonContent = honorBallonDorWinnersMarkup(history.ballonDorWinners ?? (history.ballonDor ? [{ ...history.ballonDor, seasons:[history.ballonDor.season] }] : []));
  return `<section class="honor-room league-honor-room" style="--club-accent:${accent[0]};--club-accent-2:${accent[1]}"><section class="honor-hero"><div class="honor-hero-copy"><small>CLUB LEGACY · ${history.seasonCount} SEASONS</small><h1>${escapeHtml(history.club.teamName)}</h1><p>经理 ${escapeHtml(history.club.ownerName)} 的俱乐部荣誉档案</p><div class="hero-stat-line"><span><b>${totalTrophies}</b>冠军奖杯</span><span><b>${appearances[0]?.appearances ?? 0}</b>队史出场纪录</span><span><b>${history.scorer?.goals ?? 0}</b>队史进球纪录</span></div></div></section><section class="honor-section trophy-gallery-section"><header class="honor-section-heading"><div><small>TROPHY GALLERY</small><h2>冠军陈列馆</h2></div></header><div class="honor-trophy-galleries ${honors.worldCup.length ? "has-world-cup" : ""}">${honorTrophyGalleryMarkup("league", honors.league)}${honorTrophyGalleryMarkup("cup", honors.cup)}${worldCupGallery}</div></section><section class="honor-section appearances-section"><header class="honor-section-heading"><div><small>ALL-TIME APPEARANCES</small><h2>队史出场殿堂</h2></div></header><div class="appearance-podium">${podium || '<div class="honor-record-empty">暂无队史出场数据</div>'}</div></section><section class="honor-section metric-podium-section"><header class="honor-section-heading"><div><small>ALL-TIME TOP SCORERS</small><h2>队史射手榜</h2></div></header><div class="appearance-podium metric-podium">${honorMetricPodium(scorers, "goals", "球")}</div></section><section class="honor-section metric-podium-section"><header class="honor-section-heading"><div><small>ALL-TIME TOP ASSISTERS</small><h2>队史助攻榜</h2></div></header><div class="appearance-podium metric-podium">${honorMetricPodium(assisters, "assists", "助")}</div></section><section class="honor-section metric-podium-section"><header class="honor-section-heading"><div><small>ALL-TIME RED CARD LEADERS</small><h2>队史红牌榜</h2></div></header><div class="appearance-podium metric-podium">${honorMetricPodium(redCardLeaders, "redCards", "张")}</div></section><section class="honor-section ballon-dor-section"><article class="record-feature ballon-feature"><header><div><small>SEASON BALLON D'OR</small><h2>金球奖荣誉</h2></div><span>GOLDEN LEGACY</span></header><div>${ballonContent}</div></article></section></section>`;
}

async function loadLeagueReviewMatch(matchId = leagueReviewMatchId) {
  if (!matchId) {
    leagueReviewDetail = null;
    leagueReviewLoading = false;
    renderLeagueReviewPanel();
    return;
  }
  leagueReviewMatchId = matchId;
  leagueReviewDetail = null;
  leagueReviewLoading = true;
  leagueReviewReplayFrameIndex = 0;
  leagueReviewReplayPlaying = true;
  renderLeagueReviewPanel();
  try {
    const value = await api("/api/versus/league/match/detail", { method:"POST", body:leagueIdentity({ matchId }) });
    if (leagueReviewMatchId !== matchId) return;
    leagueReviewDetail = value.match;
    const firstDynamicFrame = leagueReviewGoalFrames(leagueReviewDetail).findIndex((frame) => frame.sequence?.length > 1);
    leagueReviewReplayFrameIndex = firstDynamicFrame >= 0 ? firstDynamicFrame : 0;
  } catch (error) {
    if (leagueReviewMatchId === matchId) showToast(error.message);
  } finally {
    if (leagueReviewMatchId === matchId) {
      leagueReviewLoading = false;
      renderLeagueReviewPanel();
    }
  }
}

function leagueNavMarkup() {
  const club = league.ownTeam?.clubManagement;
  const activeSponsor = club?.sponsorship?.activeSponsor;
  const clubBadge = activeSponsor ? `<span class="league-nav-club-dot" title="${escapeHtml(activeSponsor.name)}赞助合同生效中"></span>` : "";
  const liveBadge = liveBroadcasts.some((broadcast) => String(broadcast.code).startsWith("YDL-")) ? `<span class="league-nav-live-badge">LIVE</span>` : "";
  return `<nav class="league-nav" id="league-primary-nav"><button class="${leagueTab === "overview" ? "active" : ""}" data-league-tab="overview">联赛总览</button><button class="${leagueTab === "cup" ? "active" : ""}" data-league-tab="cup">杯赛总览</button><button class="${leagueTab === "seasonFinal" ? "active" : ""}" data-league-tab="seasonFinal">赛季总决赛</button><button class="${leagueTab === "predictions" ? "active" : ""}" data-league-tab="predictions">比赛预测</button><button class="${leagueTab === "schedule" ? "active" : ""}" data-league-tab="schedule">日程表</button><button class="${leagueTab === "squad" ? "active" : ""}" data-league-tab="squad">阵容战术</button><button class="${leagueTab === "inbox" ? "active" : ""}" data-league-tab="inbox">收件箱${league.inboxUnreadCount ? `<span>${league.inboxUnreadCount}</span>` : ""}</button><button class="${leagueTab === "backpack" ? "active" : ""}" data-league-tab="backpack">背包</button><button class="${leagueTab === "enhancement" ? "active" : ""}" data-league-tab="enhancement">球员强化</button><button class="${leagueTab === "x-growth" ? "active" : ""}" data-league-tab="x-growth">巨星之路</button><button class="${leagueTab === "players" ? "active" : ""}" data-league-tab="players">球员信息</button><button class="${leagueTab === "television" ? "active" : ""}" data-league-tab="television">电视台${liveBadge}</button><button class="${leagueTab === "stats" ? "active" : ""}" data-league-tab="stats">数据榜单</button><button class="${leagueTab === "club" ? "active" : ""}" data-league-tab="club">俱乐部${clubBadge}</button><button class="${leagueTab === "shop" ? "active" : ""}" data-league-tab="shop">商店</button><button class="${leagueTab === "market" ? "active" : ""}" data-league-tab="market">交易市场</button></nav>`;
}

function leagueClubConstructionMarkup() {
  const club = league.ownTeam?.clubManagement;
  if (!club) return `<section class="league-panel"><p class="league-empty">俱乐部资料尚未建立。</p></section>`;
  const stadium = club.stadium;
  const sponsorship = club.sponsorship;
  const next = stadium.nextExpansion;
  const pendingOffers = (sponsorship.offers ?? []).filter((offer) => offer.status === "pending");
  const activeContracts = sponsorship.activeSponsors ?? [];
  const meteorUnlocked = (stadium.unlockedBackgroundEffects ?? []).includes("meteor");
  const meteorOption = meteorUnlocked
    ? `<option value="meteor" ${stadium.backgroundEffect === "meteor" ? "selected" : ""}>流星雨背景</option>`
    : `<option value="meteor" disabled>流星雨背景（商店解锁）</option>`;
  const activeMarkup = activeContracts.length
    ? activeContracts.map((contract) => `<section class="active-sponsor-contract"><img src="${escapeHtml(contract.sponsor?.icon ?? "")}" alt=""><div><small>${escapeHtml(contract.typeName)}</small><h3>${escapeHtml(contract.sponsorName)}</h3><p>剩余 ${contract.remainingSeasons} 个赛季 · 签约奖金 ${Number(contract.bonus).toLocaleString("zh-CN")} 金币</p></div></section>`).join("")
    : `<p class="league-empty">当前没有生效中的赞助合同。</p>`;
  const offersMarkup = pendingOffers.length
    ? pendingOffers.map((offer) => `<article class="club-sponsor-offer"><img src="${escapeHtml(offer.sponsorIcon ?? "")}" alt=""><div><small>${escapeHtml(offer.typeName)} · ${offer.durationSeasons} 个赛季</small><h3>${escapeHtml(offer.sponsorName)}</h3><p>签约奖金 ${Number(offer.bonus).toLocaleString("zh-CN")} 金币</p></div><footer><button class="button primary" type="button" data-club-sponsor-offer="${escapeHtml(offer.id)}" data-club-sponsor-action="accept">接受</button><button class="button secondary" type="button" data-club-sponsor-offer="${escapeHtml(offer.id)}" data-club-sponsor-action="reject">拒绝</button></footer></article>`).join("")
    : `<p class="league-empty">暂无待处理报价。完成联赛、杯赛或赛季总决赛后，有机会收到新的赞助合同。</p>`;
  return `<section class="club-construction">
    <header class="club-construction-hero"><div><small>CLUB DEVELOPMENT</small><h1>球队建设</h1><p>通过主场建设与商业合作，沉淀长期俱乐部资产。</p></div><dl><div><dt>俱乐部资金</dt><dd>${Number(league.wallet?.balance ?? 0).toLocaleString("zh-CN")}<small>金币</small></dd></div><div><dt>主场容量</dt><dd>${stadium.capacity.toLocaleString("zh-CN")}<small>座</small></dd></div><div><dt>预计门票收入</dt><dd>${stadium.estimatedTicketIncome.toLocaleString("zh-CN")}<small>/主场</small></dd></div></dl></header>
    <div class="club-management-grid">
      <article class="club-management-card stadium-management"><header><span>01</span><div><small>HOME GROUND</small><h2>球场管理</h2></div><b>${escapeHtml(stadium.displayName)}</b></header><form data-club-stadium-form><label class="club-wide-field">主场名称<input name="name" maxlength="30" value="${escapeHtml(stadium.name)}" ${stadium.nameLocked ? "disabled" : ""}></label><label>看台样式<select name="standStyle"><option value="none" ${stadium.standStyle === "none" ? "selected" : ""}>无看台效果</option><option value="classic" ${stadium.standStyle === "classic" ? "selected" : ""}>经典分层看台</option><option value="steep" ${stadium.standStyle === "steep" ? "selected" : ""}>陡峭压迫看台</option><option value="continuous" ${stadium.standStyle === "continuous" ? "selected" : ""}>连续环形看台</option></select></label><label>草皮样式<select name="pitchStyle"><option value="striped" ${stadium.pitchStyle === "striped" ? "selected" : ""}>纵向条纹</option><option value="checker" ${stadium.pitchStyle === "checker" ? "selected" : ""}>棋盘草纹</option><option value="plain" ${stadium.pitchStyle === "plain" ? "selected" : ""}>纯色草皮</option></select></label><label>直播背景效果<select name="backgroundEffect"><option value="none" ${stadium.backgroundEffect !== "meteor" ? "selected" : ""}>无背景效果</option>${meteorOption}</select></label><button class="button primary" type="submit">保存球场外观</button></form>${stadium.nameLocked ? `<p class="club-contract-lock">冠名合同生效中，主场名称锁定为 ${escapeHtml(stadium.displayName)}</p>` : ""}<footer><div><small>当前容量 · 上座率 ${Math.round(Number(stadium.attendanceRate ?? .82) * 100)}%</small><strong>${stadium.capacity.toLocaleString("zh-CN")} 座</strong></div>${next ? `<button class="button secondary" type="button" data-club-stadium-expand>增加 5,000 座<br><small>${next.cost.toLocaleString("zh-CN")} 金币 · 升至 ${next.capacity.toLocaleString("zh-CN")}</small></button>` : `<b>已达到最高容量</b>`}</footer></article>
      <article class="club-management-card sponsor-management"><header><span>02</span><div><small>COMMERCIAL</small><h2>赞助商管理</h2></div><b class="${activeContracts.length ? "is-active" : ""}">${activeContracts.length} 份生效 · ${pendingOffers.length} 份待处理</b></header><section class="club-sponsor-section"><h3>待处理报价</h3><div class="club-sponsor-offers">${offersMarkup}</div></section><section class="club-sponsor-section"><h3>生效中的合同</h3><div class="club-active-contracts">${activeMarkup}</div></section><p class="club-sponsor-rules">普通赞助最多同时 3 家；球场冠名与球队冠名分别最多 1 家。报价只会在正式赛事结束后随机送达。</p></article>
    </div>
  </section>`;
}
function leagueClubMarkup() {
  const content = leagueClubPage === "honorRoom" ? leagueHonorRoomMarkup() : leagueClubConstructionMarkup();
  return `<section class="league-club-page"><header class="league-club-header"><div><small>THE CLUB</small><h1>${escapeHtml(league.ownTeam?.name ?? "俱乐部")}</h1></div><nav><button type="button" class="${leagueClubPage === "construction" ? "active" : ""}" data-club-page="construction">球队建设</button><button type="button" class="${leagueClubPage === "honorRoom" ? "active" : ""}" data-club-page="honorRoom">荣誉室</button></nav></header>${content}</section>`;
}

function leagueShellMarkup(content) {
  return `<section class="league-shell"><button type="button" class="league-mobile-nav-toggle" data-league-mobile-nav aria-expanded="${leagueMobileNavOpen}" aria-controls="league-primary-nav"><span>☰</span><b>${escapeHtml(LEAGUE_TAB_LABELS[leagueTab] ?? "功能导航")}</b><small>${leagueMobileNavOpen ? "收起" : "展开"}</small></button><div class="league-main-layout ${leagueMobileNavOpen ? "mobile-nav-open" : "mobile-nav-collapsed"}">${leagueNavMarkup()}${leagueThemeToggleMarkup()}<main class="league-page-content">${content}</main></div></section>`;
}

function syncLeagueShellChrome() {
  const shell = app.querySelector(":scope > .league-shell");
  const nav = shell?.querySelector("#league-primary-nav");
  const layout = shell?.querySelector(":scope > .league-main-layout");
  const mobileToggle = shell?.querySelector("[data-league-mobile-nav]");
  if (!layout || !mobileToggle) return false;
  layout.classList.toggle("mobile-nav-open", leagueMobileNavOpen);
  layout.classList.toggle("mobile-nav-collapsed", !leagueMobileNavOpen);
  mobileToggle.setAttribute("aria-expanded", String(leagueMobileNavOpen));
  const mobileLabel = mobileToggle.querySelector("b");
  const mobileState = mobileToggle.querySelector("small");
  if (mobileLabel) mobileLabel.textContent = LEAGUE_TAB_LABELS[leagueTab] ?? "功能导航";
  if (mobileState) mobileState.textContent = leagueMobileNavOpen ? "收起" : "展开";
  shell.querySelectorAll("[data-league-tab]").forEach((button) => button.classList.toggle("active", button.dataset.leagueTab === leagueTab));
  const inboxButton = shell.querySelector('[data-league-tab="inbox"]');
  inboxButton?.querySelector(":scope > span")?.remove();
  if (inboxButton && league.inboxUnreadCount) inboxButton.insertAdjacentHTML("beforeend", `<span>${league.inboxUnreadCount}</span>`);
  const growthButton = shell.querySelector('[data-league-tab="x-growth"]');
  growthButton?.querySelector(':scope > span[title="可用加成点数"]')?.remove();
  const xGrowthPoints = Number(league.xGrowth?.points ?? 0);
  if (growthButton && xGrowthPoints > 0) growthButton.insertAdjacentHTML("beforeend", `<span title="可用加成点数">${xGrowthPoints}</span>`);
  const televisionButton = shell.querySelector('[data-league-tab="television"]');
  televisionButton?.querySelector(":scope > .league-nav-live-badge")?.remove();
  if (televisionButton && liveBroadcasts.some((broadcast) => String(broadcast.code).startsWith("YDL-"))) televisionButton.insertAdjacentHTML("beforeend", `<span class="league-nav-live-badge">LIVE</span>`);
  return true;
}

function renderLeague() {
  if (leagueTacticalShapePreviewPlaying) stopLeagueTacticalShapePreview({ restore:false });
  if (leagueTab === "review") leagueTab = "overview";
  const inboxScrollTop = leagueTab === "inbox"
    ? app.querySelector("[data-league-mail-scroll]")?.scrollTop
    : undefined;
  clearInterval(leagueScheduleClockTimer);
  leagueScheduleClockTimer = null;
  leagueMode = true;
  storeLeagueView();
  stopLeagueReviewDotReplay();
  updateChrome();
  if (league.draft) app.innerHTML = leagueDraftMarkup();
  else if (!league.ownTeam) app.innerHTML = leagueJoinMarkup();
  else {
    const content = leagueTab === "cup" ? leagueCupOverviewMarkup() : leagueTab === "seasonFinal" ? seasonFinalTournamentMarkup() : leagueTab === "predictions" ? leaguePredictionsMarkup() : leagueTab === "schedule" ? leagueScheduleMarkup() : leagueTab === "squad" ? leagueSquadMarkup() : leagueTab === "coach" ? leagueCoachMarkup() : leagueTab === "inbox" ? leagueInboxMarkup() : leagueTab === "backpack" ? leagueBackpackMarkup() : leagueTab === "enhancement" ? leagueEnhancementMarkup() : leagueTab === "x-growth" ? leagueXGrowthMarkup() : leagueTab === "television" ? broadcastListMarkup(true) : leagueTab === "stats" ? leagueStatsMarkup() : leagueTab === "players" ? leaguePlayerInfoMarkup() : leagueTab === "club" ? leagueClubMarkup() : leagueTab === "market" ? leagueMarketMarkup() : leagueTab === "shop" ? leagueShopMarkup() : leagueOverviewMarkup();
    const pageContent = app.querySelector(":scope > .league-shell > .league-main-layout > .league-page-content");
    if (pageContent) pageContent.innerHTML = content;
    else app.innerHTML = leagueShellMarkup(content);
    syncLeagueShellChrome();
    if (leagueTab === "x-growth" && league.xGrowth) document.querySelector(".x-growth-hero")?.insertAdjacentHTML("afterend", leagueXGrowthResetMarkup(league.xGrowth));
    if (leagueTab === "squad") bindLeagueSquad();
    if (leagueTab === "television") refreshBroadcasts();
    if (leagueTab === "schedule") {
      leagueScheduleClockOffset = Number(league.serverTime ?? Date.now()) - Date.now();
      updateLeagueScheduleClock();
      leagueScheduleClockTimer = setInterval(updateLeagueScheduleClock, 1000);
    }
    if (inboxScrollTop !== undefined) {
      const mailScroll = app.querySelector("[data-league-mail-scroll]");
      if (mailScroll) mailScroll.scrollTop = inboxScrollTop;
    }
    syncS4PackChoiceDialog();
  }
}

function closeLeagueDialog() {
  document.querySelector("#league-dialog-overlay")?.remove();
}

function openLeagueDialog(content, className = "", { dismissOnBackdrop = true } = {}) {
  closeLeagueDialog();
  const overlayClass = className ? `${className.split(" ")[0]}-overlay` : "";
  document.body.insertAdjacentHTML("beforeend", `<div class="league-dialog-overlay ${overlayClass}" id="league-dialog-overlay"><section class="league-dialog ${className}">${content}</section></div>`);
  const overlay = document.querySelector("#league-dialog-overlay");
  overlay.addEventListener("click", (event) => {
    const stageButton = event.target.closest("[data-history-stage]");
    if (stageButton) return switchHistoryStage(stageButton);
    if (event.target.closest("[data-close-league-dialog]") || dismissOnBackdrop && event.target === overlay) closeLeagueDialog();
  });
  return overlay;
}

function openS4PackChoiceDialog(offer) {
  if (offer.kind === "cosmetic") {
    const isClubBadge = offer.cosmeticType === "club-badge";
    const badgeType = isClubBadge ? "俱乐部徽章" : "国家徽章";
    const progress = offer.batchTotal ? `<b class="backpack-batch-progress">第 ${offer.batchIndex}/${offer.batchTotal} 份</b>` : "";
    const choiceNote = offer.batchTotal ? "选择1枚后自动进入下一份徽章包，全部完成后统一展示结果。" : "选择1枚徽章永久收入道具栏；同一包内不会出现重复选项。";
    const cards = (offer.items ?? []).map((item, index) => {
      const displayName = item.displayName ?? item.countryName ?? item.clubName ?? item.name;
      return `<button type="button" class="cosmetic-choice-card grade-${String(item.grade).toLowerCase()}" style="--delay:${index * 80}ms" data-s4-pack-choice="${escapeHtml(item.id)}" data-s4-offer-id="${escapeHtml(offer.id)}"><span>${escapeHtml(item.grade)}</span><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}"><b>${escapeHtml(displayName)}</b><small>${escapeHtml(item.grade)}级${badgeType}</small></button>`;
    }).join("");
    const overlay = openLeagueDialog(`<header><div><small>${isClubBadge ? "CLUB" : "COUNTRY"} BADGE PACK</small><h2>${badgeType}三选一</h2><p>${choiceNote}</p></div>${progress}</header><div class="cosmetic-choice-grid">${cards}</div><footer class="s4-pack-choice-footer"><span>S 5% · A 15% · B 30% · C 50%（每个展示位独立抽取等级）</span></footer>`, "cosmetic-pack-choice-dialog", { dismissOnBackdrop:false });
    overlay.classList.add("s4-pack-choice-overlay");
    overlay.querySelector(".league-dialog").dataset.s4PackChoiceDialog = offer.id;
    overlay.querySelectorAll("[data-s4-pack-choice]").forEach((button) => { button.onclick = () => chooseS4PackCard(button); });
    return;
  }
  const designated = offer.choiceMode === "all";
  const title = designated ? offer.packType === "admin-private-choice-plus3" ? "私有池指定球员+3礼包" : `指定传奇球员卡+${offer.packType.endsWith("plus2") ? "2" : "1"}礼包` : offer.kind === "legend" ? "传奇随机卡包" : "公共池随机礼包";
  const progress = offer.batchTotal
    ? `<b class="backpack-batch-progress">第 ${offer.batchIndex}/${offer.batchTotal} 份</b>`
    : "";
  const note = designated ? "从全部可用球员中选择一名，确认后立即获得指定强化等级的球员卡。" : offer.batchTotal
    ? "选择一名球员后，将自动展示下一份礼包。"
    : "从三张悬浮卡牌中选择一名球员。";
  const overlay = openLeagueDialog(
    `<header><div><small>S4 PACK OPENING</small><h2>${title}</h2><p>${designated ? "请选择一名球员完成定向开包。" : "选择一名球员完成开包；名单已满时可先清理球员卡。"}</p></div>${progress}</header><div class="s4-pack-choice-stage"><div class="s4-player-card-choice-grid">${offer.players.map((player, index) => s4PlayerCardMarkup(player, { animated:true, delay:index * 30, attributes:`data-s4-pack-choice="${player.id}" data-s4-offer-id="${offer.id}"` })).join("")}</div></div><footer class="s4-pack-choice-footer"><span>${note}</span><button type="button" class="button secondary" data-s4-pack-manage-roster>先去球员卡管理</button></footer>`,
    "s4-pack-choice-dialog",
    { dismissOnBackdrop:false },
  );
  overlay.classList.add("s4-pack-choice-overlay");
  overlay.querySelector(".league-dialog").dataset.s4PackChoiceDialog = offer.id;
  overlay.querySelectorAll("[data-s4-pack-choice]").forEach((button) => {
    button.onclick = () => chooseS4PackCard(button);
  });
  overlay.querySelector("[data-s4-pack-manage-roster]")?.addEventListener("click", () => {
    leagueBackpackPage = "cards";
    closeLeagueDialog();
    renderLeague();
  });
}

function syncS4PackChoiceDialog() {
  const existing = document.querySelector("[data-s4-pack-choice-dialog]");
  const offer = leagueTab === "backpack" && leagueBackpackPage === "packs" ? league.s4Packs?.offer : null;
  if (!offer) {
    if (existing) closeLeagueDialog();
    return;
  }
  if (existing?.dataset.s4PackChoiceDialog === offer.id) return;
  openS4PackChoiceDialog(offer);
}

async function chooseS4PackCard(button) {
  const choices = [...button.closest(".league-dialog").querySelectorAll("[data-s4-pack-choice]")];
  choices.forEach((choice) => { choice.disabled = true; });
  try {
    const value = await leagueRequest("/packs/choose", {
      offerId:button.dataset.s4OfferId,
      choiceId:button.dataset.s4PackChoice,
    }, { render:false });
    syncLeagueBackpackPackMutationInPlace();
    if (value.packBatchOpening?.complete) openS4PackBatchResults(value.packBatchOpening);
    else if (value.packBatchOpening || value.s4Packs?.batchOpening) showToast(`已完成第${value.s4Packs?.batchOpening?.completed ?? value.packBatchOpening?.completed ?? 0}份选择`);
    else if (value.packOpening?.player || value.packOpening?.item) openS4PackResult(value.packOpening);
  } catch (error) {
    choices.forEach((choice) => { choice.disabled = false; });
    showToast(error.message);
  }
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
    return `<button type="button" class="magnet league-squad-magnet league-public-magnet grade-${player.grade.toLowerCase()} fit-primary" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}" style="left:${player.position.x}%;top:${player.position.y}%">${captainBadgeMarkup(Boolean(player.captain))}<span class="league-magnet-role">${ROLE_LABELS[player.role] ?? player.role}</span><b>${escapeHtml(player.name)}</b><i>${player.overall}</i><span class="league-magnet-fitness" aria-label="体力 100"><span style="width:100%"></span></span>${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}</button>`;
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
      const value = await leagueRequest("/cards/release", { cardIds:entries.map(({ card }) => card.id) }, { render:false });
      leagueBackpackSelectedCardIds.clear();
      leagueBackpackRecoveryMode = null;
      closeLeagueDialog();
      renderLeague();
      showToast(`已回收${value.cardRecoveryResult?.cardCount ?? entries.length}张卡，获得${value.cardRecoveryResult?.amount ?? amount}金币`);
    } catch (error) { event.currentTarget.disabled = false; showToast(error.message); }
  };
}

function openBackpackOwnershipRecoveryConfirm() {
  const players = (league.ownTeam?.roster ?? []).filter((entry) => leagueBackpackSelectedOwnershipIds.has(entry.id) && entry.ownsRights && entry.grade !== "S" && entry.ownershipReturnPreview);
  if (!players.length) return showToast("请先选择需要回收的球员所有权");
  const totalAmount = players.reduce((sum, player) => sum + Number(player.ownershipReturnPreview.totalAmount ?? 0), 0);
  const recoveredCardCount = players.reduce((sum, player) => sum + Number(player.ownershipReturnPreview.recoveredCardCount ?? 0), 0);
  const details = players.map((player) => {
    const preview = player.ownershipReturnPreview;
    const retainedText = preview.retainedCardCount ? `保留${preview.retainedCardCount}张最高等级 +${preview.retainedUpgradeLevel} 卡` : "不保留+0基础卡";
    return `<div><dt>${escapeHtml(player.name)}</dt><dd>${escapeHtml(retainedText)} · 回收${preview.recoveredCardCount}张 · ${preview.totalAmount}金币</dd></div>`;
  }).join("");
  const overlay = openLeagueDialog(`<header><div><small>OWNERSHIP RECOVERY</small><h2>确认批量回收 ${players.length} 名球员所有权</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><div class="backpack-recovery-confirm"><p>提交前会统一检查全部球员。任意一项不满足条件时，本次批量回收不会产生任何变更。</p><dl>${details}<div><dt>系统回收卡片</dt><dd>${recoveredCardCount} 张</dd></div></dl><div class="backpack-recovery-total"><span>预计共获得</span><b>${totalAmount} 金币</b></div><footer><button type="button" class="button secondary" data-close-league-dialog>取消</button><button type="button" class="button primary" data-confirm-ownership-recovery>确认批量回收</button></footer></div>`, "backpack-recovery-dialog");
  overlay.querySelector("[data-confirm-ownership-recovery]").onclick = async (event) => {
    event.currentTarget.disabled = true;
    try {
      const value = await leagueRequest("/ownership/return-batch", { leaguePlayerIds:players.map((player) => player.id) }, { render:false });
      leagueBackpackSelectedOwnershipIds.clear();
      leagueBackpackRecoveryMode = null;
      closeLeagueDialog();
      renderLeague();
      showToast(`已回收${value.ownershipRecoveryResult?.playerCount ?? players.length}名球员所有权，获得${value.ownershipRecoveryResult?.amount ?? totalAmount}金币`);
    } catch (error) { event.currentTarget.disabled = false; showToast(error.message); }
  };
}
function openCosmeticMarketListingDialog(itemId) {
  const item = league.cosmetics?.items?.find((entry) => entry.id === itemId);
  if (!item || Number(item.count ?? 0) < 1) return;
  const minimumPrice = Number(item.minimumListingPrice ?? 100);
  const overlay = openLeagueDialog(`<header><div><small>COSMETIC ITEM MARKET</small><h2>挂牌 ${escapeHtml(item.name)}</h2></div><button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></header><form id="market-listing-form" class="s4-market-sale-form" data-market-kind="cosmetic" data-market-asset="${escapeHtml(item.id)}"><div class="cosmetic-market-dialog-item">${cosmeticMarketVisualMarkup(item)}<p>本次挂牌1枚，当前持有${Number(item.count)}枚。${item.equipped && Number(item.count) === 1 ? "这是正在佩戴的最后一枚，挂牌后将自动卸下。" : "挂牌后道具会进入市场托管。"}</p></div><label><span>挂牌金币价格</span><input name="price" type="number" min="${minimumPrice}" value="${minimumPrice}" required><small>最低挂牌价 ${minimumPrice} 金币，成交后收取 5% 手续费。</small></label><footer><button type="button" class="button secondary" data-close-league-dialog>取消</button><button type="submit" class="button primary">确认挂牌</button></footer></form>`, "s4-market-sale-dialog");
  const form = overlay.querySelector("#market-listing-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    leagueTab = "market";
    leagueMarketSection = "cosmetic";
    try {
      await leagueRequest("/market/list-cosmetic", { cosmeticItemId:item.id, price:new FormData(form).get("price") });
      leagueTab = "market";
      leagueMarketSection = "cosmetic";
      closeLeagueDialog();
      showToast(`${item.name}已挂牌`);
    } catch (error) {
      submit.disabled = false;
      showToast(error.message);
    }
  });
  form.querySelector('[name="price"]')?.select();
}

function openMarketListingDialog(kind, assetId) {
  if (kind === "cosmetic") return openCosmeticMarketListingDialog(assetId);
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
    if (!overlay.isConnected) return;
    const team = value.team;
    const friendlyAction = team.canInviteFriendly ? `<button type="button" class="button primary league-friendly-invite" data-friendly-invite="${escapeHtml(team.id)}">发起友谊赛</button>` : "";
    const recentHistory = team.recentHistory ?? [];
    const historyPanel = team.historyTotal
      ? `<section class="league-team-history"><header><h3>历史战绩</h3><small>已显示最近 ${recentHistory.length} 场 · 共 ${team.historyTotal} 场</small></header><div data-team-history-list>${recentHistory.map((match) => leagueMatchRow(match, team.id)).join("")}</div>${recentHistory.length < team.historyTotal ? `<button type="button" class="button secondary league-team-history-load" data-team-history-load>加载更多比赛（剩余 ${team.historyTotal - recentHistory.length} 场）</button>` : ""}</section>`
      : `<section class="league-team-history"><header><h3>历史战绩</h3></header><p class="league-empty">还没有比赛记录。</p></section>`;
    overlay.querySelector(".league-dialog").innerHTML = `<header><div><small>${team.isAi ? "AI CLUB" : "PLAYER CLUB"}</small><h2>${escapeHtml(team.name)}</h2><p>${escapeHtml(team.formation ?? "阵型待定")} · ${team.table.won}胜 ${team.table.drawn}平 ${team.table.lost}负</p></div><div class="league-team-detail-actions">${friendlyAction}<button class="icon-button" data-close-league-dialog aria-label="关闭">×</button></div></header><div class="league-team-detail-grid"><section><h3>当前阵型</h3>${leaguePublicPitch(team)}</section><section><h3>现有球员名单 · ${team.roster.length}人</h3><div class="league-public-roster">${team.roster.map((player) => `<div><span class="grade grade-${player.grade}">${player.grade}</span><b>${escapeHtml(player.name)}<small>${ROLE_LABELS[player.role] ?? player.role}${player.upgradeLevel ? ` · +${player.upgradeLevel}` : ""}</small></b><strong>${player.overall}</strong></div>`).join("")}</div></section></div>${historyPanel}`;
    overlay.querySelector("[data-friendly-invite]")?.addEventListener("click", () => openLeagueConfirm({ title:"发起友谊赛", text:`向 ${team.ownerName ?? team.name} 发出友谊赛邀请？邀请两小时内有效，对方接受后系统会自动安排最近场次。`, confirmText:"发送邀请", onConfirm:() => leagueFriendlyInviteRequest(team.id).then(() => { closeLeagueDialog(); showToast("友谊赛邀请已发送"); }) }));
    const historyList = overlay.querySelector("[data-team-history-list]");
    historyList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-league-match-detail]");
      if (button) openLeagueMatch(button.dataset.leagueMatchDetail);
    });
    let historyOffset = recentHistory.length;
    overlay.querySelector("[data-team-history-load]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "正在加载…";
      try {
        const historyValue = await api("/api/versus/league/team/history", { method:"POST", body:leagueIdentity({ teamId:team.id, offset:historyOffset, limit:8 }) });
        if (!overlay.isConnected) return;
        const page = historyValue.teamHistory;
        historyList.insertAdjacentHTML("beforeend", page.history.map((match) => leagueMatchRow(match, team.id)).join(""));
        historyOffset = page.nextOffset ?? page.total;
        if (page.nextOffset === null) button.remove();
        else {
          button.disabled = false;
          button.textContent = `继续加载（剩余 ${Math.max(0, page.total - page.nextOffset)} 场）`;
        }
      } catch (error) {
        button.disabled = false;
        button.textContent = "重新加载历史战绩";
        showToast(error.message);
      }
    });
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

function inferAssignedRoles(roster, positions, formationLines = null) {
  return inferElevenBoardRoles(roster.map((player) => ({ id:player.id, position:positions[player.id] })), formationLines);
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
  const activeCard = player.cards?.find((card) => card.id === player.activeCardId) ?? player.cards?.[0];
  const traits = [...(player.traits ?? []), ...(activeCard?.traits ?? [])];
  const traitFit = player.traitPositionFit ?? {};
  const assignedGroup = assignedRole === "GK" ? "GK" : ["CB", "LB", "RB", "LWB", "RWB"].includes(assignedRole) ? "DEF" : ["ST", "LW", "RW"].includes(assignedRole) ? "ATT" : "MID";
  const traitFamiliar = traitFit.familiarRoles?.includes(assignedRole);
  const traitIgnoresPenalty = traitFit.ignoreOutOfPositionPenalty
    && (traitFit.eligibleRoleGroups?.includes("ANY") || traitFit.eligibleRoleGroups?.includes(assignedRole) || traitFit.eligibleRoleGroups?.includes(assignedGroup));
  if (traitFamiliar || traitIgnoresPenalty || (assignedRole !== "GK" && traits.some((trait) => (typeof trait === "string" ? trait : trait?.id) === "utility-player"))) return "primary";
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
  const roles = inferAssignedRoles(roster, positions, options.formationLines);
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

function hasMultipleGoalkeepers(positions, playerId, nextPosition, formationLines = null) {
  const next = { ...positions, [playerId]:nextPosition };
  const entries = Object.entries(next).map(([id, position]) => ({ id, position }));
  return Object.values(inferElevenBoardRoles(entries, formationLines)).filter((role) => role === "GK").length > 1;
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
  const marks = { kickoff:"开",duel:"对抗",attack:"推进",counter:"反击",save:"扑救",miss:"射门",block:"封堵",tackle:"抢断",interception:"拦截",goal:"进球",butterFingers:"黄油手",ownGoal:"乌龙球",superWorldie:"超级世界波",foul:"犯规",yellow:"黄牌",red:"红牌",injury:"伤退",substitution:"换人",lightning:"雷击",weather:"天气",blackWhistle:"争议判罚",corner:"角球",setPiece:"定位球",setPieceDuel:"争顶",clearance:"解围",penaltyAwarded:"点球",halftime:"半场",extra:"加时",extraTimeEnd:"加时结束",penaltyShootoutStart:"点球大战",penaltyShootoutEqualise:"人数调整",penaltyShootoutKick:"点球主罚",penalties:"点球结束",tactical:"战术",penalty:"点球",shootout:"点球大战",fulltime:"结束",abandoned:"终止" };
  const icons = { goal:"⚽",butterFingers:"🧤",ownGoal:"↩",superWorldie:"★",yellow:"■",red:"■",injury:"✚",substitution:"↔",lightning:"ϟ",weather:"≈",blackWhistle:"⚖",penaltyAwarded:"P",penalty:"P",shootout:"P",penaltyShootoutStart:"P",penaltyShootoutEqualise:"↔",penaltyShootoutKick:"P",penalties:"■",save:"◆",block:"◆",tackle:"◆",interception:"◆",setPiece:"◆",setPieceDuel:"◆",clearance:"◇",corner:"◇",miss:"○",tactical:"↔",halftime:"Ⅱ",extraTimeEnd:"Ⅱ",fulltime:"■",abandoned:"!" };
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
  const position = player.position ?? { x:50, y:50 };
  const status = player.sentOff ? "红牌" : player.injury ? "伤退" : "";
  const tooltip = playerTooltip(player, assignedRole);
  const fitness = Math.max(0, Math.min(100, Math.round(player.fitness ?? 100)));
  const upgrade = Number(player.upgradeLevel ?? 0);
  const overall = Math.round(player.overall ?? player.rating ?? 0);
  const broadcastSide = Number.isInteger(player.broadcastTeamIndex) ? ` broadcast-side-${player.broadcastTeamIndex}` : "";
  return `<button type="button" class="magnet live-magnet league-squad-magnet s4-broadcast-magnet${broadcastSide} grade-${String(player.grade ?? "C").toLowerCase()} fit-primary ${status ? "inactive unavailable" : ""}" data-traits="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}" style="left:${position.x}%;top:${position.y}%" disabled>${captainBadgeMarkup(Boolean(player.captain && player.active))}${liveStatusMarkers(player)}<span class="league-magnet-role">${escapeHtml(fieldRoleAbbreviation(assignedRole))}</span><b>${escapeHtml(player.name)}</b><i>${overall}</i><span class="league-magnet-fitness" aria-label="体力 ${fitness}"><span style="width:${fitness}%"></span></span><span class="s4-broadcast-rating">评分 ${Number(player.rating ?? 0).toFixed(1)}</span>${upgrade ? `<em class="league-magnet-upgrade level-${Math.min(8, upgrade)}">+${upgrade}</em>` : ""}</button>`;
}

function matchStatsMarkup(match, teamOrder = [0, 1]) {
  const left = match.teams[teamOrder[0]].stats;
  const right = match.teams[teamOrder[1]].stats;
  const possessionTotal = left.possession + right.possession || 1;
  const hasPossessionSources = [left, right].every((stats) => Number.isFinite(Number(stats.normalPossessions)) && Number.isFinite(Number(stats.transitionPossessions)));
  const sourceRows = hasPossessionSources ? [
    ["正常控球回合", left.normalPossessions, right.normalPossessions],
    ["断球转换回合", left.transitionPossessions, right.transitionPossessions],
    ["转换射门", left.transitionShots ?? 0, right.transitionShots ?? 0],
  ] : [];
  const rows = [
    ["控球", `${Math.round(left.possession / possessionTotal * 100)}%`, `${Math.round(right.possession / possessionTotal * 100)}%`],
    ...sourceRows,
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
    ? `${TACTICS[team.tactic]} · ${STYLES[team.style]} · 适配 ${matchTacticalFitPercent(team)}%`
    : "对方比赛策略保密";
  const opponent = room.match.teams[room.viewerIndex === 0 ? 1 : 0];
  const markingOptions = opponent.players.filter((player) => player.active).map((player) => `<option value="${escapeHtml(player.id)}" ${localMarkingTargetId === player.id ? "selected" : ""}>${escapeHtml(player.name)} · ${ROLE_LABELS[player.assignedRole] ?? player.assignedRole} · ${player.rating.toFixed(1)}</option>`).join("");
  const submitted = Boolean(room.match.pause?.submitted?.[room.viewerIndex]);
  const displayedFormation = own && adjusting && !submitted ? inferFormationName(team.players.filter((player) => player.active), localPositions) : team.formation;
  return `<section class="live-team-panel ${own ? "own-team-panel" : "opponent-team-panel"}"><header><div><h2>${escapeHtml(team.name)}${team.importedLineup ? `<span class="lineup-origin-badge">自带阵容</span>` : ""}</h2><small>${displayedFormation} · ${team.activeCount} 人</small></div>${own ? `<button class="button pause-button" id="pause-match" ${canPause ? "" : "disabled"}>${room.match.pauseUsed[room.viewerIndex] ? "暂停已使用" : room.match.pause ? "调整中" : "战术暂停"}</button>` : `<span class="strategy-private">${title}</span>`}</header>${livePitchMarkup(team, { own, paused:Boolean(room.match.pause) })}${own && !adjusting ? `<footer>${title} · 主攻${FOCUSES[team.attackFocus]} · 主守${FOCUSES[team.defenseFocus]}</footer>` : ""}${adjusting && own ? `<div class="pause-move-hint">拖动球员并调整双方策略；完整保留 30 秒</div><div class="live-tactic-controls"><label class="field"><span>比赛思路</span><select id="live-tactic-select" ${submitted ? "disabled" : ""}>${Object.entries(TACTICS).map(([key,label]) => `<option value="${key}" ${localTactic === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>比赛战术</span><select id="live-style-select" ${submitted ? "disabled" : ""}>${Object.entries(STYLES).map(([key,label]) => `<option value="${key}" ${localStyle === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>主攻方向</span><select id="live-attack-focus" ${submitted ? "disabled" : ""}>${focusOptions(localAttackFocus)}</select></label><label class="field"><span>主守方向</span><select id="live-defense-focus" ${submitted ? "disabled" : ""}>${focusOptions(localDefenseFocus)}</select></label><label class="field marking-target-field"><span>重点盯防</span><select id="live-marking-select" ${submitted ? "disabled" : ""}><option value="">不设置</option>${markingOptions}</select></label><button class="button primary" id="apply-live-tactics" ${submitted ? "disabled" : ""}>${submitted ? "已提交，等待继续" : "提交本次调整"}</button></div>` : ""}</section>`;
}

function matchStructureFingerprint(match) {
  return JSON.stringify({
    viewerIndex:room.viewerIndex,
    segment:match.segment,
    phase:match.phase,
    pause:match.pause ? {
      kind:match.pause.kind,
      submitted:match.pause.submitted,
    } : null,
    pauseUsed:match.pauseUsed,
    teams:match.teams.map((team) => ({
      id:team.id,
      name:team.name,
      importedLineup:Boolean(team.importedLineup),
      tactic:team.tactic,
      style:team.style,
      attackFocus:team.attackFocus,
      defenseFocus:team.defenseFocus,
      formation:team.formation,
      activePlayerIds:team.players.filter((player) => player.active).map((player) => player.id),
      shownPlayerIds:team.players.filter((player) => player.active || player.sentOff || player.injury).map((player) => player.id),
    })),
  });
}

function matchEventFingerprint(match) {
  const latest = match.events.at(-1);
  return `${match.events.length}:${latest?.id ?? ""}:${latest?.text ?? ""}`;
}

function latestMatchEventMarkup(entry) {
  if (!entry) return "";
  const icon = ({ goal:"⚽",butterFingers:"🧤",ownGoal:"↩",superWorldie:"★",yellow:"■",red:"■",injury:"✚",substitution:"↔",lightning:"ϟ",weather:"≈",abandoned:"!",penaltyAwarded:"P",shootout:"P",tactical:"↔" }[entry.type] ?? "•");
  return `<div class="latest-event event-${entry.type}"><i>${icon}</i><b>${entry.minute}'</b><span>${escapeHtml(entry.text)}</span></div>`;
}

function replaceElementMarkup(element, markup) {
  if (!element) return null;
  const fragment = document.createRange().createContextualFragment(markup);
  const replacement = fragment.firstElementChild;
  element.replaceWith(fragment);
  return replacement;
}

function updateLiveTeamPanel(panel, team, options = {}) {
  if (!panel) return;
  const { own = false, adjusting = false } = options;
  const submitted = Boolean(room.match.pause?.submitted?.[room.viewerIndex]);
  const activePlayers = team.players.filter((player) => player.active);
  const previewing = own && adjusting && !submitted;
  const previewRoles = previewing ? inferAssignedRoles(activePlayers, localPositions) : {};
  const displayedFormation = previewing ? inferFormationName(activePlayers, localPositions) : team.formation;
  const teamSummary = panel.querySelector("header small");
  if (teamSummary) teamSummary.textContent = `${displayedFormation} · ${team.activeCount} 人`;
  const strategy = `${TACTICS[team.tactic]} · ${STYLES[team.style]} · 适配 ${matchTacticalFitPercent(team)}%`;
  const footer = panel.querySelector(":scope > footer");
  if (footer && own) footer.textContent = `${strategy} · 主攻${FOCUSES[team.attackFocus]} · 主守${FOCUSES[team.defenseFocus]}`;
  const pitch = panel.querySelector(".live-pitch");
  const shownPlayers = team.players.filter((player) => player.active || player.sentOff || player.injury);
  shownPlayers.forEach((player) => {
    const magnet = pitch?.querySelector(`[data-live-magnet="${CSS.escape(player.id)}"]`);
    if (!magnet) return;
    const status = player.sentOff ? "红牌" : player.injury ? "伤退" : "";
    const position = previewing ? (localPositions?.[player.id] ?? player.position) : player.position;
    const assignedRole = previewRoles[player.id] ?? player.assignedRole;
    const tooltip = playerTooltip(player, assignedRole);
    [...magnet.classList].filter((name) => name.startsWith("rating-")).forEach((name) => magnet.classList.remove(name));
    magnet.classList.add(`rating-${Math.floor(player.rating)}`);
    magnet.classList.toggle("inactive", Boolean(status));
    magnet.disabled = !(previewing && player.active);
    magnet.dataset.traits = tooltip;
    magnet.title = tooltip;
    magnet.style.left = `${position.x}%`;
    magnet.style.top = `${position.y}%`;
    const markers = magnet.querySelector(".live-status-markers");
    if (markers) markers.outerHTML = liveStatusMarkers(player);
    const detail = magnet.querySelector("small");
    if (detail) detail.textContent = status || `${ROLE_LABELS[assignedRole] ?? assignedRole} · 体能 ${Math.round(player.fitness)}`;
    const rating = magnet.querySelector(".live-rating");
    if (rating) rating.textContent = player.rating.toFixed(1);
  });
  const pauseRibbon = pitch?.querySelector(".pause-ribbon");
  const pauseClock = pauseRibbon?.querySelector("strong");
  if (pauseClock && room.match.pause) pauseClock.textContent = clockText(room.match.pause.remainingMs);
}

function updateMatchInPlace(match) {
  const shell = app.querySelector(".match-shell");
  if (!shell) return false;
  const ownTeam = match.teams[room.viewerIndex];
  const opponent = match.teams[room.viewerIndex === 0 ? 1 : 0];
  const scoreboardSides = shell.querySelectorAll(".scoreboard > div");
  const ownScore = scoreboardSides[0]?.querySelector("b");
  const awayScore = scoreboardSides[1]?.querySelector("b");
  if (ownScore) ownScore.textContent = match.score[room.viewerIndex];
  if (awayScore) awayScore.textContent = match.score[room.viewerIndex === 0 ? 1 : 0];
  const scoreboardCenter = shell.querySelector(".scoreboard > span");
  const phase = scoreboardCenter?.querySelector(":scope > small:not(.scoreboard-referee)");
  const clock = scoreboardCenter?.querySelector("strong");
  if (phase) phase.textContent = matchPhaseLabel(match);
  if (clock) clock.textContent = match.segment === "penalties" ? `${match.penalties?.score?.[0] ?? 0}:${match.penalties?.score?.[1] ?? 0}` : `${match.minute}'`;

  const audienceNames = (room.spectators ?? []).map((spectator) => spectator.name);
  const audience = shell.querySelector(".match-audience");
  const audienceCount = audience?.querySelector("b");
  const audienceList = audience?.querySelector("small");
  if (audienceCount) audienceCount.textContent = `${audienceNames.length} 人观战`;
  if (audienceList) audienceList.textContent = audienceNames.length ? audienceNames.join("、") : "当前暂无观众";

  const adjusting = Boolean(match.pause);
  updateLiveTeamPanel(shell.querySelector(".own-team-panel"), ownTeam, { own:true, adjusting });
  updateLiveTeamPanel(shell.querySelector(".opponent-team-panel"), opponent, { own:false, adjusting });

  const center = shell.querySelector(".match-center-panel");
  const eventCount = center?.querySelector("header span");
  if (eventCount) eventCount.textContent = match.events.length;
  const eventFingerprint = matchEventFingerprint(match);
  if (eventFingerprint !== lastRenderedMatchEventFingerprint) {
    const feedScroll = captureEventFeedScroll(center);
    const latestEvent = match.events.at(-1);
    const previousLatest = center?.querySelector(".latest-event");
    if (previousLatest && latestEvent) replaceElementMarkup(previousLatest, latestMatchEventMarkup(latestEvent));
    else if (previousLatest) previousLatest.remove();
    else if (latestEvent) center?.querySelector("header")?.insertAdjacentHTML("afterend", latestMatchEventMarkup(latestEvent));
    const feed = center?.querySelector(".event-feed");
    if (feed) feed.innerHTML = match.events.length ? [...match.events].reverse().map(matchEventMarkup).join("") : `<p class="feed-empty">比赛进行中</p>`;
    restoreEventFeedScroll(center, feedScroll);
    if (latestEvent && latestEvent.id !== lastAnimatedEventId && ["goal", "butterFingers", "ownGoal", "superWorldie", "red", "penalty", "penaltyAwarded", "lightning", "blackWhistle"].includes(latestEvent.type)) center?.querySelector(".latest-event")?.classList.add("critical-arrival");
    if (latestEvent) lastAnimatedEventId = latestEvent.id;
    lastRenderedMatchEventFingerprint = eventFingerprint;
  }
  replaceElementMarkup(center?.querySelector(".live-stats"), matchStatsMarkup(match, [room.viewerIndex, room.viewerIndex === 0 ? 1 : 0]));
  return true;
}

function renderMatch(options = {}) {
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
  const structureFingerprint = matchStructureFingerprint(match);
  if (!options.force && structureFingerprint === lastMatchStructureFingerprint && updateMatchInPlace(match)) return;
  const canPause = ["regular", "extra"].includes(match.segment) && !match.pauseUsed[room.viewerIndex] && !match.pause;
  const ownScore = match.score[room.viewerIndex];
  const opponentScore = match.score[room.viewerIndex === 0 ? 1 : 0];
  const latestEvent = match.events.at(-1);
  const centerValue = match.segment === "penalties" ? `${match.penalties?.score?.[0] ?? 0}:${match.penalties?.score?.[1] ?? 0}` : `${match.minute}'`;
  const firstLegText = match.aggregateBaseScore ? `首回合 ${match.aggregateBaseScore[room.viewerIndex]}:${match.aggregateBaseScore[room.viewerIndex === 0 ? 1 : 0]} · ` : "";
  const centerDetail = match.segment === "penalties" ? "点球比分" : `${firstLegText}${weatherIcon(match.weather)} ${escapeHtml(match.weather.name)}`;
  app.innerHTML = `<section class="match-shell"><header class="scoreboard"><div><small>${escapeHtml(ownTeam.name)}</small><b>${ownScore}</b><em>${ownTeam.activeCount} 人 · ${ownTeam.formation}</em></div><span><small>${matchPhaseLabel(match)}</small><strong>${centerValue}</strong><em>${centerDetail}</em></span><div><small>${escapeHtml(opponent.name)}</small><b>${opponentScore}</b><em>${opponent.activeCount} 人 · ${opponent.formation}</em></div></header><div class="match-layout match-triple-layout">${liveTeamPanel(ownTeam, { own:true, adjusting, canPause })}<section class="commentary-panel match-center-panel"><header><h2>实时战况</h2><span>${match.events.length}</span></header>${latestMatchEventMarkup(latestEvent)}<div class="event-feed">${match.events.length ? [...match.events].reverse().map(matchEventMarkup).join("") : `<p class="feed-empty">比赛进行中</p>`}</div>${matchStatsMarkup(match, [room.viewerIndex, room.viewerIndex === 0 ? 1 : 0])}</section>${liveTeamPanel(opponent, { own:false, adjusting, canPause:false })}</div></section>`;
  lastMatchStructureFingerprint = structureFingerprint;
  lastRenderedMatchEventFingerprint = matchEventFingerprint(match);
  restoreEventFeedScroll(app, feedScroll);
  document.querySelector(".scoreboard>span")?.insertAdjacentHTML("beforeend", `<small class="scoreboard-referee">⚖ ${escapeHtml(refereeText(match.referee))}</small>`);
  const pauseHint = document.querySelector(".pause-move-hint");
  if (pauseHint) pauseHint.textContent = "拖动球员并调整双方策略；双方都提交后立即继续";
  if (latestEvent && latestEvent.id !== lastAnimatedEventId && ["goal", "butterFingers", "ownGoal", "superWorldie", "red", "penalty", "penaltyAwarded", "lightning", "blackWhistle"].includes(latestEvent.type)) document.querySelector(".latest-event")?.classList.add("critical-arrival");
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
    const up = () => { draggingMagnet = false; magnet.classList.remove("dragging"); magnet.removeEventListener("pointermove",move); magnet.removeEventListener("pointerup",up); if (moved && hasMultipleGoalkeepers(localPositions, playerId, localPositions[playerId])) { localPositions[playerId] = startPosition; showToast("门将位置最多只能安排一名球员"); } if (moved) renderMatch({ force:true }); };
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
  return team.players.map((player) => `<tr><td><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.role] ?? player.role}${player.sentOff ? " · 红牌" : player.injury ? " · 伤退" : player.enteredAsSubstitute ? " · 替补登场" : ""}</small></td><td>${player.rating.toFixed(1)}</td><td>${Math.round(player.fitness)}</td><td>${player.stats.goals}</td><td>${player.stats.assists}</td><td>${player.stats.shotsOnTarget}</td><td>${Number(player.stats.tackles ?? 0)}</td><td>${Number(player.stats.interceptions ?? 0)}</td><td>${Number(player.stats.clearances ?? 0)}</td><td>${Number(player.stats.blocks ?? 0)}</td><td>${Number(player.stats.pressuresWon ?? 0)}</td><td>${player.stats.saves}</td></tr>`).join("");
}

function reportTimelineItem(entry) {
  const icons = { goal:"⚽",butterFingers:"🧤",ownGoal:"↩",superWorldie:"★",red:"■",injury:"✚",substitution:"↔",lightning:"ϟ",weather:"≈",abandoned:"!",blackWhistle:"⚖",penaltyAwarded:"P",penalty:"P",shootout:"P",penaltyShootoutStart:"P",penaltyShootoutEqualise:"↔",penaltyShootoutKick:"P",penalties:"■",extraTimeEnd:"Ⅱ",halftime:"Ⅱ",fulltime:"■",tactical:"↔" };
  const labels = { goal:"进球",butterFingers:"黄油手",ownGoal:"乌龙球",superWorldie:"超级世界波",red:"红牌",injury:"伤退",substitution:"伤病换人",lightning:"雷击",weather:"天气影响",abandoned:"比赛终止",blackWhistle:"争议判罚",penaltyAwarded:"判罚点球",penalty:"点球",shootout:"点球大战",penaltyShootoutStart:"点球大战开始",penaltyShootoutEqualise:"点球人数调整",penaltyShootoutKick:"点球主罚",penalties:"点球大战结束",extraTimeEnd:"加时赛结束",halftime:"中场",fulltime:"终场",tactical:"战术调整" };
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
  app.innerHTML = `<section class="report-screen"><header class="report-hero"><h1>${winner}</h1><div class="report-score"><span>${escapeHtml(report.teams[0].name)}</span><b>${report.score[0]} : ${report.score[1]}</b><span>${escapeHtml(report.teams[1].name)}</span></div>${report.penalties ? `<p>点球 ${report.penalties[0]} : ${report.penalties[1]}</p>` : ""}<small>${escapeHtml(report.weather.name)} · ${report.teams[0].activeCount} 对 ${report.teams[1].activeCount} 人</small><button class="button primary rematch-button" id="rematch" ${ownRematchReady ? "disabled" : ""}>${rematchText}</button></header><section class="lineup-export-panel"><h2>保存本场阵容</h2>${exportContent}</section><div class="report-grid"><section class="report-panel"><h2>比赛统计</h2>${matchStatsMarkup({ teams:report.teams })}</section><section class="report-panel"><h2>重要事件</h2><div class="report-events">${report.importantEvents.map(matchEventMarkup).join("")}</div></section></div>${report.teams.map((team,index) => `<section class="player-report"><header><h2>${escapeHtml(team.name)}${team.importedLineup ? `<span class="lineup-origin-badge">自带阵容</span>` : ""}</h2><strong>${team.formation} · ${index === room.viewerIndex ? `${TACTICS[team.tactic]} · ${STYLES[team.style]} · 主攻${FOCUSES[team.attackFocus]} · 主守${FOCUSES[team.defenseFocus]} · 适配 ${matchTacticalFitPercent(team)}%` : "战术保密"}</strong></header><div class="table-wrap"><table><thead><tr><th>球员</th><th>评分</th><th>体能</th><th>进球</th><th>助攻</th><th>射正</th><th>抢断</th><th>拦截</th><th>解围</th><th>封堵</th><th>压迫成功</th><th>扑救</th></tr></thead><tbody>${reportPlayerRows(team)}</tbody></table></div></section>`).join("")}</section>`;
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

leaveButton.onclick = () => { clearTimeout(polling); clearTimeout(yellowDogsTvTimer); stopRoomStream(); storeSession(null); room = null; leagueMode = false; league = null; yellowDogsTvMode = false; yellowDogsTv = null; localPositions = null; localStartingIds = null; localTactic = "balanced"; localStyle = "possession"; localAttackFocus = "balanced"; localDefenseFocus = "balanced"; lineupSeedInput = ""; exportedLineupCode = ""; renderLanding(); };
accountSettingsButton.onclick = openAccountSettings;
accountLogoutButton.onclick = logoutAccount;
leagueTopbarClub?.addEventListener("click", (event) => {
  if (event.target.closest("[data-league-team-name-edit]")) openLeagueTeamNameEditor();
});

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
    if (entry.player.xPlayer) return showToast("X级球员只能作为强化主卡");
    if (entry.card.ownershipAnchorRequired) return showToast("这是该球员所有权的最后一张锚点卡，只能作为主卡");
    if (main && (main.player.xPlayer ? main.player.role !== entry.player.role : main.player.id !== entry.player.id)) return showToast(main.player.xPlayer ? "副卡必须与X级主卡位置相同" : "副卡必须是同名球员卡");
    leagueEnhancementMaterialCardId = cardId;
  } else {
    if (leagueEnhancementMaterialCardId === cardId) leagueEnhancementMaterialCardId = null;
    leagueEnhancementMainCardId = cardId;
    const material = leagueEnhancementCardEntry(leagueEnhancementMaterialCardId);
    if (material && (material.player.xPlayer || (entry.player.xPlayer ? entry.player.role !== material.player.role : entry.player.id !== material.player.id))) leagueEnhancementMaterialCardId = null;
  }
  leagueEnhancementResult = null;
  leagueEnhancementTraitSelectionOpen = false;
  leagueEnhancementPhase = "idle";
  renderLeagueEnhancementInPlace();
}

function enhancementCardDomKey(card) {
  return card?.dataset?.enhancementCard ?? card?.dataset?.enhancementCardId ?? card?.dataset?.enhancementResultCard ?? null;
}

function syncEnhancementCardAttributes(card, source) {
  card.getAttributeNames().forEach((name) => card.removeAttribute(name));
  source.getAttributeNames().forEach((name) => card.setAttribute(name, source.getAttribute(name)));
  if (card.innerHTML !== source.innerHTML) card.innerHTML = source.innerHTML;
}

function renderLeagueEnhancementInPlace() {
  const current = app.querySelector(".league-enhancement");
  if (leagueTab !== "enhancement" || !current) return renderLeague();
  const scrollTop = current.querySelector(".enhancement-card-grid")?.scrollTop ?? 0;
  const reusableCards = new Map([...current.querySelectorAll(".s4-player-card")]
    .map((card) => [enhancementCardDomKey(card), card])
    .filter(([key]) => key));
  const template = document.createElement("template");
  template.innerHTML = leagueEnhancementMarkup().trim();
  const next = template.content.firstElementChild;
  next.querySelectorAll(".s4-player-card").forEach((card) => {
    const existing = reusableCards.get(enhancementCardDomKey(card));
    if (!existing) return;
    syncEnhancementCardAttributes(existing, card);
    card.replaceWith(existing);
  });
  current.replaceWith(next);
  const warehouse = next.querySelector(".enhancement-card-grid");
  if (warehouse) warehouse.scrollTop = scrollTop;
}

function syncLeagueEnhancementPhaseInPlace({ clearResult = false, restoreSubmit = false } = {}) {
  const current = app.querySelector(".league-enhancement");
  if (leagueTab !== "enhancement" || !current) return;
  [...current.classList].filter((name) => name.startsWith("phase-")).forEach((name) => current.classList.remove(name));
  current.classList.add(`phase-${leagueEnhancementPhase}`);
  const trigger = current.querySelector("[data-enhancement-submit]");
  if (trigger) {
    trigger.textContent = leagueEnhancementPhase === "scanning" ? "合成中" : "强化";
    if (leagueEnhancementPhase === "scanning") trigger.disabled = true;
    else if (restoreSubmit) trigger.disabled = false;
  }
  if (clearResult) {
    const result = current.querySelector(".enhancement-result-frame");
    if (result) result.innerHTML = `<div class="enhancement-result-empty"><span>+</span><b>结果</b></div>`;
  }
}

function returnLeagueEnhancementResultToWarehouse(cardId) {
  if (!leagueEnhancementResult?.card || leagueEnhancementResult.card.id !== cardId) return false;
  const pendingTraitOffer = leagueEnhancementResult.traitOffer ?? league.enhancement?.traitOffer ?? null;
  if (pendingTraitOffer?.cardId === cardId) {
    showToast("请先为这张强化卡绑定特性");
    return false;
  }
  leagueEnhancementResult = null;
  leagueEnhancementPhase = "idle";
  renderLeagueEnhancementInPlace();
  return true;
}

function leagueEnhancementRevealDelay(afterLevel) {
  const level = Number(afterLevel ?? 0);
  if (level < 4) return 420;
  return 1440 + Math.min(4, level - 4) * 360;
}

function applyLeagueEnhancementTraitMutation(mutation) {
  const chosen = mutation?.enhancementTraitResult;
  if (!chosen) return null;
  const roster = (league.ownTeam?.roster ?? []).map((player) => {
    if (player.id !== chosen.player.id) return player;
    const cards = (player.cards ?? []).map((card) => card.id === chosen.card.id ? { ...card, ...chosen.card } : card);
    return { ...player, cards };
  });
  league = {
    ...league,
    updatedAt:mutation.updatedAt,
    serverTime:mutation.serverTime,
    wallet:mutation.wallet ?? league.wallet,
    ownTeam:{ ...league.ownTeam, roster },
    enhancement:{ ...league.enhancement, history:mutation.enhancementHistory ?? league.enhancement?.history ?? [], traitOffer:null },
    enhancementTraitResult:chosen,
  };
  return chosen;
}

function recoverPendingLeagueEnhancementResult() {
  const traitOffer = league.enhancement?.traitOffer ?? null;
  if (!traitOffer) return null;
  const entry = leagueEnhancementCardEntry(traitOffer.cardId);
  if (!entry) return null;
  const level = Number(traitOffer.upgradeLevel ?? entry.card.upgradeLevel ?? 0);
  return {
    id:traitOffer.id,
    success:true,
    beforeLevel:level,
    afterLevel:level,
    player:entry.player,
    card:entry.card,
    traitOffer,
  };
}

function showLeagueEnhancementCelebration(result) {
  const level = Number(result?.afterLevel ?? 0);
  if (!result?.success || level < 4) return;
  document.querySelector(".enhancement-celebration")?.remove();
  const celebration = document.createElement("div");
  celebration.className = `enhancement-celebration ${level >= 8 ? "is-max" : "is-high"}`;
  celebration.setAttribute("role", "status");
  celebration.setAttribute("aria-live", "polite");
  const meteors = Array.from({ length:48 }, (_, index) => {
    const startX = (index * 47) % 142 - 21;
    const startY = (index * 31) % 136 - 52;
    const delay = -((index * 37) % 120) / 10;
    const duration = 2.5 + (index % 7) * .3;
    const length = 62 + (index % 6) * 22;
    return `<i style="--meteor-x:${startX}vw;--meteor-y:${startY}vh;--meteor-delay:${delay}s;--meteor-duration:${duration}s;--meteor-length:${length}px;--meteor-opacity:${.38 + index % 5 * .12}"></i>`;
  }).join("");
  const cardMarkup = s4PlayerCardMarkup(result.player, { card:result.card });
  const traitOffer = result.traitOffer ?? null;
  const traitRoleLabels = { ANY:"全位置", ATT:"前场", MID:"中场", DEF:"后场", GK:"门将" };
  const traitCards = traitOffer ? traitOffer.traits.map((trait, index) => {
    const roles = (trait.eligibleRoleGroups ?? ["ANY"]).map((role) => traitRoleLabels[role] ?? role).join(" · ");
    return `<button type="button" class="enhancement-celebration-trait tone-${index + 1}" style="--trait-index:${index}" data-celebration-trait="${escapeHtml(trait.id)}"><span>0${index + 1}</span><i></i><h3>${escapeHtml(trait.name)}</h3><p>${escapeHtml(trait.summary ?? "特性效果由联赛后台配置。")}</p><b>${escapeHtml(roles)}</b><strong>选择并绑定</strong></button>`;
  }).join("") : "";
  const bindButton = traitOffer ? `<button type="button" class="enhancement-celebration-bind" data-celebration-bind><span>✦</span><b>绑定强化特性</b><small>从三张特性卡中选择一张</small></button>` : "";
  celebration.innerHTML = `<div class="enhancement-celebration-aurora"></div><div class="enhancement-celebration-meteors">${meteors}</div><div class="enhancement-celebration-flare"></div><div class="enhancement-celebration-stage"><small>${level >= 8 ? "ULTIMATE ENHANCEMENT" : "ENHANCEMENT SUCCESS"}</small><div class="enhancement-celebration-card"><div class="enhancement-celebration-card-glint"></div>${cardMarkup}</div><h2>${escapeHtml(result.player?.name ?? "球员")} 强化成功</h2>${bindButton}</div>${traitOffer ? `<section class="enhancement-celebration-traits"><header><small>SELECT ONE TRAIT</small><h2>选择强化特性</h2></header><div>${traitCards}</div></section>` : ""}`;
  celebration.addEventListener("click", (event) => {
    if (event.target.closest("[data-celebration-bind], [data-celebration-trait]") || celebration.classList.contains("traits-open") || celebration.classList.contains("trait-resolving")) return;
    celebration.classList.add("closing");
    celebration.classList.remove("show");
    setTimeout(() => celebration.remove(), 320);
  });
  celebration.querySelector("[data-celebration-bind]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    celebration.classList.add("traits-open");
  });
  celebration.querySelectorAll("[data-celebration-trait]").forEach((traitCard) => {
    traitCard.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (celebration.classList.contains("trait-resolving")) return;
      celebration.classList.add("trait-resolving");
      traitCard.classList.add("is-selected");
      celebration.querySelectorAll("[data-celebration-trait]").forEach((card) => { if (card !== traitCard) card.classList.add("is-dismissed"); });
      try {
        const value = await api("/api/versus/league/card/enhancement-trait", {
          method:"POST",
          body:leagueIdentity({ offerId:traitOffer.id, traitId:traitCard.dataset.celebrationTrait }),
        });
        const chosen = applyLeagueEnhancementTraitMutation(value.enhancementTrait);
        leagueEnhancementResult = chosen ? { id:chosen.offerId, success:true, beforeLevel:chosen.card.upgradeLevel, afterLevel:chosen.card.upgradeLevel, player:chosen.player, card:chosen.card } : null;
        leagueEnhancementTraitSelectionOpen = false;
        leagueEnhancementPhase = "success";
        renderLeagueEnhancementInPlace();
        const nextCard = chosen ? s4PlayerCardMarkup(chosen.player, { card:chosen.card }) : cardMarkup;
        const cardShell = celebration.querySelector(".enhancement-celebration-card");
        if (cardShell) cardShell.innerHTML = `<div class="enhancement-celebration-card-glint"></div>${nextCard}`;
        celebration.querySelector(".enhancement-celebration-traits")?.remove();
        celebration.querySelector("[data-celebration-bind]")?.remove();
        celebration.classList.remove("traits-open", "trait-resolving");
        celebration.classList.add("trait-bound");
        showToast(chosen ? `已绑定特性：${chosen.trait.name}` : "特性绑定完成");
      } catch (error) {
        celebration.classList.remove("trait-resolving");
        traitCard.classList.remove("is-selected");
        celebration.querySelectorAll("[data-celebration-trait]").forEach((card) => card.classList.remove("is-dismissed"));
        showToast(error.message);
      }
    });
  });
  document.body.append(celebration);
  requestAnimationFrame(() => celebration.classList.add("show"));
}

async function performLeagueEnhancement() {
  const main = leagueEnhancementCardEntry(leagueEnhancementMainCardId);
  const material = leagueEnhancementCardEntry(leagueEnhancementMaterialCardId);
  if (!main || !material || material.player.xPlayer || material.card.ownershipAnchorRequired || (main.player.xPlayer ? main.player.role !== material.player.role : main.player.id !== material.player.id) || leagueEnhancementPhase === "scanning") return;
  if (Number(main.card.upgradeLevel ?? 0) < Number(material.card.upgradeLevel ?? 0)) return showToast("主卡等级不能低于副卡等级，请交换主副卡");
  leagueEnhancementPhase = "scanning";
  leagueEnhancementResult = null;
  leagueMutationPending = true;
  syncLeagueEnhancementPhaseInPlace({ clearResult:true });
  const startedAt = performance.now();
  const requestKey = `${main.card.id}:${material.card.id}:${leagueEnhancementUseProtection ? 1 : 0}`;
  if (leagueEnhancementPendingRequest?.key !== requestKey) {
    leagueEnhancementPendingRequest = {
      key:requestKey,
      requestId:globalThis.crypto?.randomUUID?.() ?? `enhancement-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
  }
  try {
    const requestBody = leagueIdentity({
      mainCardId:main.card.id,
      materialCardId:material.card.id,
      useProtection:leagueEnhancementUseProtection,
      requestId:leagueEnhancementPendingRequest.requestId,
    });
    let value;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        value = await api("/api/versus/league/card/enhance", { method:"POST", body:requestBody });
        break;
      } catch (error) {
        if (attempt > 0 || !String(error.message).startsWith("请求超时")) throw error;
      }
    }
    const enhancement = value.enhancement;
    leagueEnhancementResult = enhancement.enhancementResult ?? null;
    const elapsed = performance.now() - startedAt;
    const revealDelay = leagueEnhancementRevealDelay(leagueEnhancementResult?.afterLevel);
    if (elapsed < revealDelay) await new Promise((resolve) => setTimeout(resolve, revealDelay - elapsed));
    const resultCard = leagueEnhancementResult?.card;
    const roster = (league.ownTeam?.roster ?? []).filter((player) => player.id !== enhancement.removedPlayerId);
    roster.forEach((player) => {
      player.cards = (player.cards ?? []).filter((card) => card.id !== enhancement.removedCardId);
      if (resultCard && player.id === resultCard.playerId) {
        const currentCard = player.cards.find((card) => card.id === resultCard.id);
        if (currentCard) Object.assign(currentCard, resultCard);
        else player.cards.push(resultCard);
      }
    });
    league = {
      ...league,
      updatedAt:enhancement.updatedAt,
      serverTime:enhancement.serverTime,
      wallet:enhancement.wallet,
      ownTeam:{ ...league.ownTeam, roster },
      enhancement:{ ...league.enhancement, history:enhancement.enhancementHistory ?? league.enhancement?.history ?? [], traitOffer:leagueEnhancementResult?.traitOffer ?? null },
    };
    leagueEnhancementTraitSelectionOpen = false;
    leagueEnhancementMainCardId = null;
    leagueEnhancementMaterialCardId = null;
    leagueEnhancementPendingRequest = null;
    leagueEnhancementPhase = leagueEnhancementResult?.success ? "success" : "failure";
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    renderLeagueEnhancementInPlace();
    showLeagueEnhancementCelebration(leagueEnhancementResult);
    showToast(leagueEnhancementResult?.success ? "强化成功" : "强化失败");
    const resultId = leagueEnhancementResult?.id;
    setTimeout(() => {
      if (leagueTab === "enhancement" && leagueEnhancementResult?.id === resultId && leagueEnhancementPhase !== "scanning") {
        leagueEnhancementPhase = "idle";
        syncLeagueEnhancementPhaseInPlace();
      }
    }, 1300);
  } catch (error) {
    leagueEnhancementPhase = "idle";
    syncLeagueEnhancementPhaseInPlace({ restoreSubmit:true });
    showToast(error.message);
  } finally {
    leagueMutationPending = false;
  }
}

app.addEventListener("keydown", (event) => {
  const dutyStep = event.target.closest?.("[data-league-duty-step][role=button]");
  if (!dutyStep || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  stepLeaguePlayerDuty(dutyStep.dataset.leagueDutyPlayer, dutyStep.dataset.leagueDutyRole, dutyStep.dataset.leagueDutyState, dutyStep.dataset.leagueDutyStep);
});

app.addEventListener("click", async (event) => {
  const tacticalShapeMode = event.target.closest("[data-league-tactical-shape-mode]")?.dataset.leagueTacticalShapeMode;
  if (tacticalShapeMode) {
    requestLeagueTacticalShapePreview(tacticalShapeMode);
    return;
  }
  if (event.target.closest("[data-league-auto-lineup]")) {
    automaticallyOptimizeLeagueLineup();
    return;
  }
  if (event.target.closest("[data-league-auto-duties]")) {
    automaticallyAdaptLeagueDuties();
    return;
  }
  const dutyStep = event.target.closest("[data-league-duty-step]");
  if (dutyStep) {
    event.preventDefault();
    stepLeaguePlayerDuty(dutyStep.dataset.leagueDutyPlayer, dutyStep.dataset.leagueDutyRole, dutyStep.dataset.leagueDutyState, dutyStep.dataset.leagueDutyStep);
    return;
  }
  if (event.target.closest("[data-league-duty-close]") || event.target.matches("[data-league-duty-backdrop]")) {
    closeLeagueMobileDutySheet();
    return;
  }
  if (event.target.closest("[data-tv-back]")) return renderLanding();
  const tvTab = event.target.closest("[data-tv-tab]");
  if (tvTab) {
    yellowDogsTvTab = tvTab.dataset.tvTab;
    renderYellowDogsTv();
    return;
  }
  const tvHistoryMatch = event.target.closest("[data-tv-history-match]");
  if (tvHistoryMatch) {
    openLeagueMatch(tvHistoryMatch.dataset.tvHistoryMatch);
    return;
  }
  const historyButton = event.target.closest("[data-history-match]");
  if (historyButton) openHistoryMatch(historyButton.dataset.historyMatch);
  const watchButton = event.target.closest("[data-watch-room]");
  if (watchButton) startWatching(watchButton.dataset.watchRoom);
  const draftDraw = event.target.closest("[data-league-draw]");
  if (draftDraw) leagueDraftRequest("/draft/draw", { pool:draftDraw.dataset.leagueDraw }).catch((error) => showToast(error.message));
  const draftChoice = event.target.closest("[data-league-choose]");
  if (draftChoice) leagueDraftRequest("/draft/choose", { leaguePlayerId:draftChoice.dataset.leagueChoose }).catch((error) => showToast(error.message));
  const xPlayerChoose = event.target.closest("[data-x-player-choose]");
  if (xPlayerChoose) leagueDraftRequest("/draft/x-player", { leaguePlayerId:xPlayerChoose.dataset.xPlayerChoose }).catch((error) => showToast(error.message));
  const xTraitChoose = event.target.closest("[data-x-trait-choose]");
  if (xTraitChoose) leagueDraftRequest("/draft/x-trait", { traitId:xTraitChoose.dataset.xTraitChoose }).catch((error) => showToast(error.message));
  if (event.target.closest("[data-league-finish]")) leagueRequest("/draft/finish").then(() => { leagueTab = "overview"; showToast("球队接管完成，将从下一轮开始参赛"); }).catch((error) => showToast(error.message));
  if (event.target.closest("[data-league-back]")) renderLanding();
  if (event.target.closest("[data-league-team-name-edit]")) openLeagueTeamNameEditor();
  if (event.target.closest("[data-league-theme-toggle]")) {
    toggleLeagueDesktopTheme();
    return;
  }
  if (event.target.closest("[data-compute-nodes-open]")) {
    openComputeNodeMarketDialog();
    return;
  }
  if (event.target.closest("[data-ai-training-open]")) {
    openAiTrainingDialog();
    return;
  }

  if (event.target.closest("[data-league-mobile-nav]")) {
    leagueMobileNavOpen = !leagueMobileNavOpen;
    syncLeagueShellChrome();
    return;
  }
  const leagueTabButton = event.target.closest("[data-league-tab]");
  if (leagueTabButton) {
    const nextTab = leagueTabButton.dataset.leagueTab;
    if (leagueTab === "squad" && nextTab !== "squad") {
      storeLeagueTacticsContext();
      if (leagueEditorDirty) saveLeagueTeamNow();
    }
    if (nextTab === "squad" && leagueTab !== "squad") {
      restoreLeagueTacticsContext(leagueTacticsMode);
    }
    if (nextTab === "backpack") leagueBackpackPage = "packs";
    if (leagueTabButton.matches("[data-open-player-ranking]")) leaguePlayerInfoSection = "ranking";
    else if (nextTab === "players" && leagueTab !== "players") leaguePlayerInfoSection = null;
    leagueEditorDirty = false;
    leagueTab = nextTab;
    leagueMobileNavOpen = false;
    if (nextTab === "club" && leagueClubPage === "honorRoom" && !league.honorRoom) leagueHonorRoomLoading = true;
    renderLeague();
    if (nextTab === "club" && leagueClubPage === "honorRoom") void loadLeagueHonorRoom();
  }
  const playerInfoSection = event.target.closest("[data-player-info-section]");
  const clubPageButton = event.target.closest("[data-club-page]");
  if (clubPageButton) {
    leagueClubPage = clubPageButton.dataset.clubPage === "honorRoom" ? "honorRoom" : "construction";
    if (leagueClubPage === "honorRoom" && !league.honorRoom) leagueHonorRoomLoading = true;
    renderLeague();
    if (leagueClubPage === "honorRoom") void loadLeagueHonorRoom();
    return;
  }
  if (event.target.closest("[data-club-stadium-expand]")) {
    leagueRequest("/club/stadium/expand").then(() => showToast("球场扩建完成")).catch((error) => showToast(error.message));
    return;
  }
  const sponsorOfferButton = event.target.closest("[data-club-sponsor-offer]");
  if (sponsorOfferButton) {
    const action = sponsorOfferButton.dataset.clubSponsorAction;
    leagueRequest("/club/sponsor/respond", { offerId:sponsorOfferButton.dataset.clubSponsorOffer, action })
      .then(() => showToast(action === "accept" ? "赞助合同已生效，签约奖金已经到账" : "已拒绝这份赞助报价"))
      .catch((error) => showToast(error.message));
    return;
  }
  if (playerInfoSection) {
    leaguePlayerInfoSection = playerInfoSection.dataset.playerInfoSection === "back" ? null : playerInfoSection.dataset.playerInfoSection;
    const needsDirectory = ["search", "ranking"].includes(leaguePlayerInfoSection);
    if (needsDirectory && !league.playerDirectory) leaguePlayerDirectoryLoading = true;
    renderLeague();
    if (needsDirectory) void loadLeaguePlayerDirectory();
    return;
  }
  const playerDirectoryDetail = event.target.closest("[data-player-directory-detail]");
  if (playerDirectoryDetail) {
    openPlayerDirectoryDetail(playerDirectoryDetail.dataset.playerDirectoryDetail, playerDirectoryDetail.dataset.playerDirectoryUpgrade);
    return;
  }
  const playerSearchView = event.target.closest("[data-player-search-view]");
  if (playerSearchView) {
    leaguePlayerSearchView = playerSearchView.dataset.playerSearchView === "cards" ? "cards" : "list";
    renderLeague();
    return;
  }
  const enhancementRankingView = event.target.closest("[data-enhancement-ranking-view]");
  if (enhancementRankingView) {
    leagueEnhancementRankingView = enhancementRankingView.dataset.enhancementRankingView === "cards" ? "cards" : "list";
    renderLeague();
    return;
  }
  const backpackPageButton = event.target.closest("[data-backpack-page]");
  if (backpackPageButton) {
    leagueBackpackPage = ["packs", "cards", "items"].includes(backpackPageButton.dataset.backpackPage) ? backpackPageButton.dataset.backpackPage : "packs";
    renderLeague();
    return;
  }
  const cosmeticEquip = event.target.closest("[data-cosmetic-equip]");
  if (cosmeticEquip) {
    const itemId = cosmeticEquip.dataset.cosmeticEquip;
    const slot = cosmeticEquip.dataset.cosmeticSlot;
    const label = slot === "clubBadge" ? "俱乐部徽章" : "国家徽章";
    leagueRequest("/cosmetics/equip", { itemId, slot }).then(() => showToast(itemId ? `${label}已佩戴` : `已取消佩戴${label}`)).catch((error) => showToast(error.message));
    return;
  }
  const inboxCategory = event.target.closest("[data-league-inbox-category]");
  if (inboxCategory) {
    leagueInboxCategory = inboxCategory.dataset.leagueInboxCategory;
    leagueInboxMessageId = null;
    refreshLeagueInboxInPlace();
    return;
  }
  if (event.target.closest("[data-league-inbox-unread]")) {
    leagueInboxUnreadOnly = !leagueInboxUnreadOnly;
    leagueInboxMessageId = null;
    refreshLeagueInboxInPlace();
    return;
  }
  if (event.target.closest("[data-league-inbox-read-batch]")) {
    const messageIds = leagueInboxFilteredMessages().filter((message) => !message.readAt).map((message) => message.id);
    leagueInboxReadBatchRequest(messageIds);
    return;
  }
  const inboxMessage = event.target.closest("[data-league-inbox-message]");
  if (inboxMessage) {
    leagueInboxMessageId = inboxMessage.dataset.leagueInboxMessage;
    const message = league.inbox.find((entry) => entry.id === leagueInboxMessageId);
    if (message && !message.readAt) leagueInboxReadRequest(leagueInboxMessageId);
    else {
      renderLeague();
      requestAnimationFrame(() => document.querySelector(".league-mail-reader")?.scrollIntoView({ behavior:"smooth", block:"start" }));
    }
    return;
  }
  const inboxDelete = event.target.closest("[data-league-inbox-delete]");
  if (inboxDelete) {
    const messageId = inboxDelete.dataset.leagueInboxDelete;
    const message = league.inbox.find((entry) => entry.id === messageId);
    if (message) openLeagueConfirm({ title:"删除邮件", text:`确定删除“${message.title}”吗？删除后无法恢复。`, confirmText:"删除", onConfirm:() => { leagueInboxMessageId = null; return leagueRequest("/inbox/delete", { messageId }); } });
  }
  const leagueBoardButton = event.target.closest("[data-league-board]");
  if (leagueBoardButton) { leagueBoard = leagueBoardButton.dataset.leagueBoard; renderLeague(); }

  const cupPage = event.target.closest("[data-cup-page]");
  if (cupPage) { leagueCupPage = cupPage.dataset.cupPage === "knockout" ? "knockout" : "league"; renderLeague(); }
  const cupRound = event.target.closest("[data-cup-round]");
  if (cupRound?.dataset.cupRound) { leagueCupRoundPage = Number(cupRound.dataset.cupRound); renderLeague(); }
  const leagueRound = event.target.closest("[data-league-round]");
  if (leagueRound?.dataset.leagueRound) { leagueRoundPage = Number(leagueRound.dataset.leagueRound); renderLeague(); }
  const leagueTeamDetail = event.target.closest("[data-league-team-detail]");
  if (leagueTeamDetail) openLeagueTeam(leagueTeamDetail.dataset.leagueTeamDetail);
  const overviewCompareAdd = event.target.closest("[data-overview-compare-add]");
  if (overviewCompareAdd) {
    addLeagueOverviewPlayerComparison(overviewCompareAdd.dataset.overviewCompareAdd);
    return;
  }
  const overviewCompareRemove = event.target.closest("[data-overview-compare-remove]");
  if (overviewCompareRemove) {
    removeLeagueOverviewPlayerComparison(overviewCompareRemove.dataset.overviewCompareRemove);
    return;
  }
  if (event.target.closest("[data-overview-compare-open]")) {
    openOverviewPlayerComparison();
    return;
  }
  const overviewPlayerDetail = event.target.closest("[data-overview-player-detail]");
  if (overviewPlayerDetail) {
    openOverviewPlayerDetail(overviewPlayerDetail.dataset.overviewPlayerDetail);
    return;
  }
  const leagueMatchDetail = event.target.closest("[data-league-match-detail]");
  if (leagueMatchDetail) openLeagueMatch(leagueMatchDetail.dataset.leagueMatchDetail);
  const reviewMatch = event.target.closest("[data-review-match]");
  if (reviewMatch) {
    loadLeagueReviewMatch(reviewMatch.dataset.reviewMatch);
    return;
  }
  const reviewReplayFrame = event.target.closest("[data-review-replay-frame]");
  if (reviewReplayFrame) {
    leagueReviewReplayFrameIndex = Math.max(0, Number(reviewReplayFrame.dataset.reviewReplayFrame) || 0);
    leagueReviewReplayPlaying = true;
    renderLeagueReviewPanel();
    return;
  }
  const reviewReplayStep = event.target.closest("[data-review-replay-step]");
  if (reviewReplayStep) {
    const frameCount = leagueReviewGoalFrames(leagueReviewDetail).length;
    leagueReviewReplayFrameIndex = Math.max(0, Math.min(frameCount - 1, leagueReviewReplayFrameIndex + Number(reviewReplayStep.dataset.reviewReplayStep)));
    leagueReviewReplayPlaying = true;
    renderLeagueReviewPanel();
    return;
  }
  const reviewReplayToggle = event.target.closest("[data-review-replay-toggle]");
  if (reviewReplayToggle) {
    leagueReviewReplayPlaying = !leagueReviewReplayPlaying;
    reviewReplayToggle.textContent = leagueReviewReplayPlaying ? "暂停" : "播放";
    return;
  }
  const predictionMarket = event.target.closest("[data-prediction-market]");
  if (predictionMarket) openPredictionMarket(predictionMarket.dataset.predictionMarket);
  const enhancementCard = event.target.closest("[data-enhancement-card]");
  if (enhancementCard) {
    assignLeagueEnhancementCard(enhancementCard.dataset.enhancementCard);
    return;
  }
  if (event.target.closest("[data-enhancement-batch-open]")) {
    openLeagueBatchEnhancementDialog();
    return;
  }
  const inboxDeleteBatch = event.target.closest("[data-league-inbox-delete-batch]");
  if (inboxDeleteBatch) {
    const mode = inboxDeleteBatch.dataset.leagueInboxDeleteBatch;
    openLeagueConfirm({ title:mode === "read" ? "删除已读邮件" : "清空收件箱", text:mode === "read" ? "确定删除全部已读且无需处理的邮件吗？" : "确定删除全部可删除邮件吗？尚待处理的交易报价、友谊赛邀请和特性补偿会被保留。", confirmText:"确认删除", onConfirm:() => { leagueInboxMessageId = null; return leagueRequest("/inbox/delete-batch", { mode }); } });
  }
  const enhancementSlotCard = event.target.closest("[data-enhancement-slot-card]");
  if (enhancementSlotCard) {
    if (enhancementSlotCard.dataset.enhancementSlotCard === "main") leagueEnhancementMainCardId = null;
    else leagueEnhancementMaterialCardId = null;
    leagueEnhancementResult = null;
    leagueEnhancementPhase = "idle";
    renderLeagueEnhancementInPlace();
    return;
  }
  if (event.target.closest("[data-enhancement-history-open]")) {
    openLeagueEnhancementHistory();
    return;
  }
  if (event.target.closest("[data-enhancement-submit]")) {
    performLeagueEnhancement();
    return;
  }
  if (event.target.closest("[data-enhancement-open-traits]")) {
    const recovered = !leagueEnhancementResult;
    const pendingResult = leagueEnhancementResult ?? recoverPendingLeagueEnhancementResult();
    if (pendingResult) {
      showLeagueEnhancementCelebration(pendingResult);
      if (recovered) document.querySelector(".enhancement-celebration")?.classList.add("traits-open");
    }
    else showToast(league.enhancement?.traitOffer ? "待绑定特性对应的球员卡不存在，请刷新页面后重试" : "当前没有待绑定的强化特性");
    return;
  }
  if (event.target.closest("[data-enhancement-close-traits]")) {
    leagueEnhancementTraitSelectionOpen = false;
    renderLeague();
    return;
  }
  const enhancementTrait = event.target.closest("[data-enhancement-trait]");
  if (enhancementTrait) {
    leagueMutationPending = true;
    api("/api/versus/league/card/enhancement-trait", {
      method:"POST",
      body:leagueIdentity({
        offerId:enhancementTrait.dataset.enhancementTraitOffer,
        traitId:enhancementTrait.dataset.enhancementTrait,
      }),
    }).then((value) => {
      const chosen = applyLeagueEnhancementTraitMutation(value.enhancementTrait);
      leagueEnhancementResult = chosen ? { id:chosen.offerId, success:true, beforeLevel:chosen.card.upgradeLevel, afterLevel:chosen.card.upgradeLevel, player:chosen.player, card:chosen.card } : null;
      leagueEnhancementTraitSelectionOpen = false;
      leagueEnhancementPhase = "success";
      renderLeague();
      showToast(chosen ? `已绑定特性：${chosen.trait.name}` : "特性绑定完成");
    }).catch((error) => showToast(error.message)).finally(() => { leagueMutationPending = false; });
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
    if (leagueBackpackSelectedOwnershipIds.has(playerId)) leagueBackpackSelectedOwnershipIds.delete(playerId);
    else leagueBackpackSelectedOwnershipIds.add(playerId);
    renderLeague();
    return;
  }
  const backpackRecoveryMode = event.target.closest("[data-backpack-recovery-mode]");
  if (backpackRecoveryMode) {
    const mode = backpackRecoveryMode.dataset.backpackRecoveryMode;
    if (leagueBackpackRecoveryMode !== mode) {
      leagueBackpackRecoveryMode = mode;
      leagueBackpackSelectedCardIds.clear();
      leagueBackpackSelectedOwnershipIds.clear();
      renderLeague();
    } else if (mode === "single") openBackpackSingleRecoveryConfirm();
    else openBackpackOwnershipRecoveryConfirm();
    return;
  }
  if (event.target.closest("[data-backpack-recovery-cancel]")) {
    leagueBackpackRecoveryMode = null;
    leagueBackpackSelectedCardIds.clear();
    leagueBackpackSelectedOwnershipIds.clear();
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
      leagueMobileDutyPlayerId = null;
      captureLeagueTacticalControls();
      leaguePositionPresets[leagueActivePositionPreset] = leaguePositions;
      leagueActivePositionPreset = nextPreset;
      leaguePositions = leaguePositionPresets[nextPreset];
      renderLeague();
    }
    return;
  }
  const mobilePlanButton = event.target.closest("[data-league-mobile-plan]");
  if (mobilePlanButton) {
    leagueMobileTacticalPlanState = ["opening", "leading", "trailing"].includes(mobilePlanButton.dataset.leagueMobilePlan) ? mobilePlanButton.dataset.leagueMobilePlan : "opening";
    const form = mobilePlanButton.closest("#league-squad-form");
    if (form) form.dataset.activeMobilePlan = leagueMobileTacticalPlanState;
    form?.querySelectorAll("[data-league-mobile-plan]").forEach((button) => {
      const active = button.dataset.leagueMobilePlan === leagueMobileTacticalPlanState;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    return;
  }
  const s4PackOpen = event.target.closest("[data-s4-pack-open]");
  if (s4PackOpen) {
    s4PackOpen.disabled = true;
    leagueRequest("/packs/open", { packId:s4PackOpen.dataset.s4PackOpen }, { render:false }).then((value) => {
      syncLeagueBackpackPackMutationInPlace();
      if (value.packOpening?.player || value.packOpening?.item) openS4PackResult(value.packOpening);
    }).catch((error) => {
      s4PackOpen.disabled = false;
      showToast(error.message);
    });
    return;
  }
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
    if (packIds.length) {
      s4PackBatchOpen.disabled = true;
      leagueRequest("/packs/open-batch", { packIds }, { render:false }).then((value) => {
        syncLeagueBackpackPackMutationInPlace();
        if (value.packBatchOpening?.complete) openS4PackBatchResults(value.packBatchOpening);
        else if (value.s4Packs?.batchOpening) showToast(`批量开包已开始，共${value.s4Packs.batchOpening.total}份`);
      }).catch((error) => {
        s4PackBatchOpen.disabled = false;
        showToast(error.message);
      });
    }
    return;
  }
  const s4PackChoice = event.target.closest("[data-s4-pack-choice]");
  if (s4PackChoice) chooseS4PackCard(s4PackChoice);
  if (event.target.closest("[data-league-simulate]")) leagueRequest("/simulate").then(() => showToast("下一轮模拟完成")).catch((error) => showToast(error.message));
  const marketSection = event.target.closest("[data-market-section]");
  if (marketSection) {
    leagueMarketSection = marketSection.dataset.marketSection === "back" ? null : marketSection.dataset.marketSection;
    leagueMarketListingPage = 1;
    leagueMarketWarehousePage = 1;
    if (leagueMarketSection === "trade" && !league.playerDirectory) leaguePlayerDirectoryLoading = true;
    renderLeague();
    if (leagueMarketSection === "trade") void loadLeaguePlayerDirectory();
    return;
  }
  const marketPageButton = event.target.closest("[data-market-page]");
  if (marketPageButton) {
    const page = Math.max(1, Number(marketPageButton.dataset.marketPage) || 1);
    if (marketPageButton.dataset.marketPageSide === "listing") leagueMarketListingPage = page;
    else leagueMarketWarehousePage = page;
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
    leagueRequest("/card-trades/create", { targetOwnerId:leagueTradeTargetOwnerId, offeredCardIds:[...leagueTradeOfferedCardIds], requestedCardIds:[...leagueTradeRequestedCardIds], coinAmount:leagueTradeCoinAmount }, { beforeRender:() => {
      leagueTradeOfferedCardIds.clear();
      leagueTradeRequestedCardIds.clear();
      leagueTradeCoinAmount = "";
    } }).then(() => {
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
    openLeagueConfirm({ title:action === "accept" ? "接受友谊赛邀请" : "拒绝友谊赛邀请", text:action === "accept" ? "接受后比赛会自动排到最近的友谊赛时间，并向全服玩家发送直播预告。" : "拒绝后本次邀请将关闭。", confirmText:action === "accept" ? "接受邀请" : "确认拒绝", onConfirm:() => leagueFriendlyRespondRequest(friendlyRespond.dataset.friendlyInvitation, action).then(() => showToast(action === "accept" ? "友谊赛已经排定" : "友谊赛邀请已拒绝")) });
    return;
  }
  const marketCancel = event.target.closest("[data-market-cancel]");
  if (marketCancel) leagueRequest("/market/cancel", { listingId:marketCancel.dataset.marketCancel }).then(() => showToast("挂牌已撤回")).catch((error) => showToast(error.message));
  const marketBuy = event.target.closest("[data-market-buy]");
  if (marketBuy) leagueRequest("/market/buy", { listingId:marketBuy.dataset.marketBuy }).then(() => showToast("交易完成")).catch((error) => showToast(error.message));
  const marketList = event.target.closest("[data-market-list-asset]");
  if (marketList) {
    openMarketListingDialog(marketList.dataset.marketListKind, marketList.dataset.marketListAsset);
    return;
  }
  const s4PackBuy = event.target.closest("[data-s4-pack-buy]");
  if (s4PackBuy) {
    const pack = league.shop.catalog.find((entry) => entry.id === s4PackBuy.dataset.s4PackBuy);
    if (pack) {
      const quantity = pack.seasonPurchaseLimit ? 1 : Math.max(1, Math.min(league.shop.maxPurchaseQuantity, Number(document.querySelector(`#s4-pack-quantity-${CSS.escape(pack.id)}`)?.value ?? 1)));
      const total = pack.price * quantity;
      openLeagueConfirm({ title:"确认购买S4礼包", text:`花费 ${total} 金币购买 ${quantity} 份${pack.name}？礼包将进入背包。`, confirmText:"确认购买", onConfirm:() => leagueRequest("/shop/buy-s4", { packType:pack.id, quantity }) });
    }
    return;
  }
  const meteorStandBuy = event.target.closest("[data-meteor-stand-buy]");
  if (meteorStandBuy) {
    const item = league.shop.meteorStand;
    if (!item || item.owned) return;
    openLeagueConfirm({ title:"购买流星雨看台", text:`花费 ${item.price.toLocaleString("zh-CN")} 金币永久解锁流星雨看台？购买后可在俱乐部球场管理中选择直播背景，并使主场上座率提升至100%。`, confirmText:"确认购买", onConfirm:() => leagueRequest("/shop/buy-meteor-stand").then(() => showToast("流星雨看台已永久解锁")) });
    return;
  }
  const rosterExpansionBuy = event.target.closest("[data-roster-expansion-buy]");
  if (rosterExpansionBuy) {
    const expansion = league.shop.rosterExpansion;
    if (!expansion || expansion.retired || expansion.remainingQuantity < 1) return;
    const quantity = Math.max(1, Math.min(expansion.remainingQuantity, Math.floor(Number(document.querySelector("#roster-expansion-quantity")?.value ?? 1))));
    const total = expansion.price * quantity;
    openLeagueConfirm({ title:"确认购买付费大名单", text:`花费 ${total} 金币购买 ${quantity} 个付费大名单？购买后球队大名单上限将立即永久增加 ${quantity} 人。`, confirmText:"确认购买", onConfirm:() => leagueRequest("/shop/buy-roster-expansion", { quantity }).then(() => showToast(`大名单上限已增加 ${quantity} 人`)) });
    return;
  }
  const xGrowthBuy = event.target.closest("[data-x-growth-buy]");
  if (xGrowthBuy) {
    if (leagueXGrowthMutationPending) return;
    const quantity = Math.max(1, Math.min(20, Number(document.querySelector("#x-growth-quantity")?.value ?? 1)));
    const total = Number(league.xGrowth?.shop.price ?? 0) * quantity;
    openLeagueConfirm({ title:"购买X球员加成点数", text:`花费 ${total} 金币购买 ${quantity * Number(league.xGrowth.shop.points)} 点加成点数？`, confirmText:"确认购买", onConfirm:async () => {
      leagueXGrowthPendingField = "buy";
      await leagueXGrowthRequest("/buy", { quantity });
      showToast("加成点数已到账");
    } });
    return;
  }
  const xGrowthSpend = event.target.closest("[data-x-growth-spend]");
  if (xGrowthSpend) {
    if (leagueXGrowthMutationPending) return;
    leagueXGrowthPendingField = xGrowthSpend.dataset.xGrowthSpend;
    leagueXGrowthPendingAmount = Math.max(1, Number(xGrowthSpend.dataset.xGrowthAmount ?? 1));
    leagueXGrowthPendingMode = xGrowthSpend.dataset.xGrowthMode ?? "one";
    leagueXGrowthRequest("/spend", { field:leagueXGrowthPendingField, amount:leagueXGrowthPendingAmount }).catch((error) => showToast(error.message));
    return;
  }
  const xGrowthPositionConfirm = event.target.closest("[data-x-growth-position-confirm]");
  if (xGrowthPositionConfirm) {
    const role = document.querySelector("[data-x-growth-role]")?.value;
    const secondaryRole = document.querySelector("[data-x-growth-secondary]")?.value || null;
    if (!role) return showToast("请选择主位置");
    if (role !== "GK" && secondaryRole === role) return showToast("主位置和副位置不能相同");
    leagueXGrowthResetRole = role;
    leagueXGrowthResetSecondaryRole = role === "GK" ? null : secondaryRole;
    leagueXGrowthResetTraitOpen = true;
    renderLeague();
    return;
  }
  const xGrowthPositionEdit = event.target.closest("[data-x-growth-position-edit]");
  if (xGrowthPositionEdit) {
    leagueXGrowthResetTraitOpen = false;
    renderLeague();
    return;
  }
  const xGrowthReset = event.target.closest("[data-x-growth-reset]");
  if (xGrowthReset) {
    const role = leagueXGrowthResetRole;
    const secondaryRole = leagueXGrowthResetSecondaryRole;
    const traitId = document.querySelector('input[name="x-growth-reset-trait"]:checked')?.value;
    if (!leagueXGrowthResetTraitOpen || !role) return showToast("请先确认球员位置");
    if (!traitId) return showToast("请选择一张适用于新主位置的特性卡");
    openLeagueConfirm({ title:"确认洗点与重选特性", text:`花费 ${league.xGrowth?.resetCost ?? 8000} 金币，返还全部已使用的加成点，并切换位置与初始特性？`, confirmText:"支付8000金币", onConfirm:async () => {
      leagueXGrowthPendingField = "reset";
      await leagueXGrowthRequest("/reset", { role, secondaryRole, traitId });
      leagueXGrowthResetTraitOpen = false;
      leagueXGrowthResetRole = null;
      leagueXGrowthResetSecondaryRole = null;
      renderLeagueXGrowthSection();
      showToast("X球员已完成洗点并更换特性");
    } });
    return;
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

app.addEventListener("dblclick", (event) => {
  const resultCard = event.target.closest("[data-enhancement-result-card]");
  if (!resultCard || leagueEnhancementPhase === "scanning") return;
  event.preventDefault();
  returnLeagueEnhancementResultToWarehouse(resultCard.dataset.enhancementResultCard);
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
    if (leagueEnhancementResult?.card?.id === cardId) return returnLeagueEnhancementResultToWarehouse(cardId);
    leagueEnhancementPhase = "idle";
    renderLeagueEnhancementInPlace();
    return;
  }
  const slot = target.dataset.enhancementDrop;
  if (slot === "main" || slot === "material") assignLeagueEnhancementCard(cardId, slot);
});

app.addEventListener("change", (event) => {
  if (leagueTacticalShapePreviewPlaying && event.target.closest("#league-squad-form")) stopLeagueTacticalShapePreview();
  if (event.target.matches("[data-lineup-scheme-select], [data-lineup-scheme-assignment]")) return;
  if (event.target.matches("[data-league-captain-select], [data-league-captain-style]")) {
    const draft = captureLeagueTacticalControls();
    draft.captainId = leagueStartingIds.includes(draft.captainId) ? draft.captainId : null;
    leagueEditorDirty = true;
    renderLeague();
    scheduleLeagueTeamAutoSave(180);
    return;
  }
  if (event.target.matches("[data-mirror-upload]")) {
    const input = event.target;
    input.disabled = true;
    (async () => {
      try {
        if (input.checked) {
          clearTimeout(leagueAutoSaveTimer);
          await saveLeagueTeamNow();
          if (leagueEditorDirty || leagueAutoSavePending) throw new Error("当前战术板仍在保存，请稍后再试");
        }
        const value = await api("/api/versus/league/mirror-marketplace/upload", { method:"POST", body:leagueIdentity({ enabled:input.checked }) });
        league = { ...league, updatedAt:value.updatedAt, serverTime:value.serverTime, wallet:value.wallet, mirrorMarketplace:value.mirrorMarketplace };
        showToast(input.checked ? "完整战术镜像已上传" : "完整战术镜像已关闭");
        renderLeague();
      } catch (error) {
        input.checked = !input.checked;
        input.disabled = false;
        showToast(error.message);
      }
    })();
    return;
  }
  if (event.target.matches("[data-x-growth-role]")) {
    leagueXGrowthResetTraitOpen = false;
    leagueXGrowthResetRole = null;
    leagueXGrowthResetSecondaryRole = null;
    const secondary = document.querySelector("[data-x-growth-secondary]");
    if (secondary) {
      secondary.disabled = event.target.value === "GK" || leagueXGrowthMutationPending;
      if (event.target.value === "GK" || secondary.value === event.target.value) secondary.value = "";
    }
    return;
  }
  if (event.target.matches("[data-x-growth-secondary]")) {
    leagueXGrowthResetTraitOpen = false;
    leagueXGrowthResetRole = null;
    leagueXGrowthResetSecondaryRole = null;
    return;
  }
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
    if (event.target.dataset.marketFilterPosition === "listing") {
      leagueMarketListingPosition = event.target.value;
      leagueMarketListingPage = 1;
    } else {
      leagueMarketWarehousePosition = event.target.value;
      leagueMarketWarehousePage = 1;
    }
    renderLeague();
    return;
  }
  if (event.target.matches("[data-market-filter-upgrade]")) {
    leagueMarketWarehouseUpgrade = event.target.value;
    leagueMarketWarehousePage = 1;
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
  if (event.target.matches("[data-league-bond-bonus-toggle]")) {
    leagueShowBondBonuses = event.target.checked;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-league-role-zones-toggle]")) {
    leagueShowRoleZones = event.target.checked;
    renderLeague();
    return;
  }
  if (event.target.matches("[data-league-history-team]")) {
    leagueHistoryTeamId = event.target.value;
    renderLeague();
  }
  if (syncLeagueTacticalPresetControls(event.target)) {
    scheduleLeagueTeamAutoSave(260);
    return;
  }
  if (event.target.matches('[name="fitnessThreshold"]')) {
    const draft = ensureLeagueTacticalDraft();
    const threshold = normalizeLeagueFitnessThreshold(event.target.value, draft.fitnessThreshold);
    event.target.value = String(threshold);
    draft.fitnessThreshold = threshold;
    refreshLeagueMagnetFitnessColors(threshold);
    scheduleLeagueTeamAutoSave(260, { lightweight:true });
    return;
  }
  if (event.target.closest("#league-squad-form") && event.target.matches("select, input")) scheduleLeagueTeamAutoSave(260);
});

app.addEventListener("input", (event) => {
  if (leagueTacticalShapePreviewPlaying && event.target.closest("#league-squad-form")) stopLeagueTacticalShapePreview();
  if (event.target.matches("[data-overview-player-search]")) {
    leagueOverviewPlayerSearch = event.target.value;
    if (!league.playerDirectory) {
      leaguePlayerDirectoryLoading = true;
      void loadLeaguePlayerDirectory();
    }
    refreshLeagueOverviewPlayerSearch();
    return;
  }
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
    const text = String(event.target.value ?? "").trim();
    const numeric = text ? Number(text) : Number.NaN;
    if (!Number.isFinite(numeric) || numeric < 45 || numeric > 100) return;
    const threshold = Math.round(numeric);
    ensureLeagueTacticalDraft().fitnessThreshold = threshold;
    refreshLeagueMagnetFitnessColors(threshold);
    scheduleLeagueTeamAutoSave(420, { lightweight:true });
    return;
  }
  if (event.target.matches('.league-tactical-dimension input[type="range"]') && syncLeagueTacticalDimensionControl(event.target)) {
    scheduleLeagueTeamAutoSave(420, { lightweight:true });
    return;
  }
  if (leagueMode && event.target.closest("form")) leagueEditorDirty = true;
});

app.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-overview-player-search]") && !league?.playerDirectory) void loadLeaguePlayerDirectory();
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
    if (event.target.dataset.marketFilterSearch === "listing") {
      leagueMarketListingSearch = event.target.value;
      leagueMarketListingPage = 1;
    } else {
      leagueMarketWarehouseSearch = event.target.value;
      leagueMarketWarehousePage = 1;
    }
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
    if (event.target.dataset.marketFilterSearch === "listing") {
      leagueMarketListingSearch = "";
      leagueMarketListingPage = 1;
    } else {
      leagueMarketWarehouseSearch = "";
      leagueMarketWarehousePage = 1;
    }
    renderLeague();
    return;
  }
  if (!event.target.matches("[data-backpack-search]") || event.target.value) return;
  leagueBackpackSearch = "";
  renderLeague();
});

app.addEventListener("submit", (event) => {
  if (event.target.matches("[data-club-stadium-form]")) {
    event.preventDefault();
    const form = new FormData(event.target);
    leagueRequest("/club/stadium", { name:form.get("name"), standStyle:form.get("standStyle"), pitchStyle:form.get("pitchStyle"), backgroundEffect:form.get("backgroundEffect") }).then(() => showToast("球场设置已保存")).catch((error) => showToast(error.message));
    return;
  }
  if (event.target.matches("[data-season-final-ban]")) {
    event.preventDefault();
    const form = new FormData(event.target);
    leagueRequest("/season-final/ban", { selection:{ forward:form.get("forward"), midfield:form.get("midfield"), defense:form.get("defense") } }).then(() => showToast("赛季总决赛禁用名单已保存")).catch((error) => showToast(error.message));
    return;
  }
  if (event.target.matches("[data-player-directory-search]")) {
    event.preventDefault();
    leaguePlayerSearchQuery = leaguePlayerSearchDraft;
    renderLeague();
    return;
  }
  if (event.target.id === "league-create-team-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    leagueDraftRequest("/draft/start", { teamName:form.get("teamName") }).catch((error) => showToast(error.message));
    return;
  }
  if (event.target.id === "x-player-config-form") {
    event.preventDefault();
    const form = new FormData(event.target);
    const role = String(form.get("role") ?? "");
    const secondaryRole = role === "GK" ? null : String(form.get("secondaryRole") ?? "");
    leagueDraftRequest("/draft/x-configure", { role, secondaryRole, heightCm:Number(form.get("heightCm")) }).catch((error) => showToast(error.message));
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
  let sameBrowserTab = false;
  try { sameBrowserTab = sessionStorage.getItem(BROWSER_SESSION_KEY) === "1"; sessionStorage.setItem(BROWSER_SESSION_KEY, "1"); } catch {}
  if (!sameBrowserTab) {
    storeSession(null);
    clearAppView();
  }
  try {
    const config = await api("/api/versus/config", { timeoutMs:5_000 });
    publicHosting = Boolean(config.publicOnly);
    applyEnvironment(config);
  } catch { publicHosting = false; }
  if (account?.profile?.id && account?.accountToken) {
    try {
      const value = await api("/api/versus/profile", { method:"POST", body:{ playerId:account.profile.id, accountToken:account.accountToken } });
      storeAccount({ ...account, profile:value.profile });
    } catch (error) {
      if (error.status === 401) {
        storeAccount(null);
        storeSession(null);
      }
    }
  }
  if (offlineYdl) {
    const activeSaveId = new URLSearchParams(window.location.search).get("save") || "default";
    const storedSaveId = localStorage.getItem(OFFLINE_SAVE_KEY);
    if (storedSaveId !== activeSaveId) {
      storeAccount(null);
      storeSession(null);
      clearAppView();
      account = null;
      session = null;
      localStorage.setItem(OFFLINE_SAVE_KEY, activeSaveId);
    }
    if (!account) return renderOfflineTeamPicker();
    if (!(await restoreAppView())) await openLeague();
    return;
  }
  if (account && !account.profile?.passwordSet) {
    authMode = "register";
    storeSession(null);
    renderAuth();
  } else if (!account) renderAuth();
  else if (session) { startRoomStream(); refresh(); }
  else if (!(await restoreAppView())) renderLanding();
}

bootstrap();
setInterval(() => {
  if (!spectatorSession && (!room || room.phase === "lobby")) refreshBroadcasts();
}, 3000);
setInterval(refreshLeagueSilently, 12_000);
