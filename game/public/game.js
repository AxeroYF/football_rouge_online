import {
  DEFAULT_FORMATION_KEY,
  FOOT_LABELS,
  LOCALIZED_PLAYER_NAME_CAPACITY,
  POSITION_GROUPS,
  ROLE_LABELS,
  TEAM_SIZE,
  TACTICS,
  applySharedMatchSubstitution,
  continueSharedMatchShortHanded,
  clamp,
  createMatch,
  createRng,
  formationBoardPositions,
  formationSettings,
  generateDraftChoices,
  generateOpponent,
  generateOpponentSquad,
  pickWeather,
  playerMetric,
  playerOverall,
  randomLocalizedTeamName,
  randomItem,
  roleFitScore,
  roleGroup,
  preferredFootForPosition,
  resolvePenaltyShootout,
  simulateMinute,
  teamRatings,
  traitFitsPlayer,
  traitFitsRole,
  traitGrade,
  updateSharedMatchTactic,
} from "/game/core.js";
import {
  ATTRIBUTE_LABELS,
  INJURY_PROFILES,
  boardZoneFromY,
  inferBoardRoles,
  isPlayerUnavailable,
  normalizePlayerSchema,
  personalityObservation,
} from "/game/schema.js";
import { settlePlayerAfterMatch } from "/game/player-progression.js";
import {
  LEGEND_MATCH_LIMIT,
  LEGEND_PITY_LIMIT,
  LEGEND_PROFILES,
  legendPitySettings,
  createLegendPlayer,
  rollLegend,
} from "/game/legends.js";
import { bondBonusText, computeTeamBonds, inferTraitBondIds } from "/game/bonds.js";
import { DEFAULT_GAME_CONFIG, normalizeGameConfig } from "/game/config.js";
import {
  createSaveId,
  emptySaveStore,
  normalizeSaveStore,
  removeRunSave,
  upsertRunSave,
} from "/game/save-manager.js";

const STORAGE_KEY = "football_test1_demo_v1";
const SAVE_STORE_KEY = "football_test1_demo_saves_v1";
const PRODUCT_VERSION = "v0.2";
const RUN_SCHEMA_VERSION = 12;
const DRAFT_ROLES = ["GK", "DEF", "MID", "ATT", "FLEX", "FLEX", "FLEX"];
const SUBSTITUTION_LIMIT = 3;
const screen = document.querySelector("#game-screen");
const modalBackdrop = document.querySelector("#modal-backdrop");
const modal = document.querySelector("#game-modal");
const runStatus = document.querySelector("#run-status");
const gameNav = document.querySelector("#game-nav");
const toastElement = document.querySelector("#toast");

let catalog = [];
let bondCatalog = [];
let gameConfig = normalizeGameConfig(DEFAULT_GAME_CONFIG);
let run = null;
let draft = null;
let runtime = null;
let toastTimer = null;
let selectedClubPlayerId = null;
let selectedBagTraitId = null;
let activeTraitDrag = null;
let traitDragFinishedAt = 0;
let traitTooltip = null;
let activeMatchSubDrag = null;
let developerCheatQueued = false;
let activeQuickSellPlayerId = null;
let traitDragGhost = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function playerValue(player, key) {
  return playerMetric(player, key);
}

function playerCondition(player) {
  const value = Math.round(playerValue(player, "morale"));
  if (value >= 75) return { value, key: "excellent", arrow: "↑", label: "最佳" };
  if (value >= 60) return { value, key: "good", arrow: "↗", label: "良好" };
  if (value >= 45) return { value, key: "steady", arrow: "−", label: "一般" };
  if (value >= 30) return { value, key: "down", arrow: "↘", label: "较差" };
  return { value, key: "poor", arrow: "↓", label: "极差" };
}

function conditionArrowMarkup(player, compact = false) {
  const condition = playerCondition(player);
  return `<span class="condition-arrow condition-${condition.key}" title="状态 ${condition.label} · ${condition.value}" aria-label="状态${condition.label}"><b>${condition.arrow}</b>${compact ? "" : `<small>${condition.label}</small>`}</span>`;
}

function playerVitalsMarkup(player, compact = false) {
  const fitness = Math.round(playerValue(player, "fitness"));
  return `<span class="player-vitals ${compact ? "compact" : ""}" title="体力 ${fitness} · 状态 ${playerCondition(player).label}"><i>体 ${fitness}</i>${conditionArrowMarkup(player, true)}</span>`;
}

function recruitmentProfile(player) {
  if (player?.legendary) return "传奇球员";
  const profile = player?.recruitment;
  return [profile?.archetypeLabel, profile?.physicalLabel, profile?.careerLabel].filter(Boolean).join(" · ") || "待观察球员";
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove("show"), 1900);
}

function loadSaveStore() {
  try {
    const stored = JSON.parse(localStorage.getItem(SAVE_STORE_KEY));
    if (stored?.saves) return normalizeSaveStore(stored);
  } catch {
    // 损坏的多存档索引不会影响旧版单存档迁移。
  }
  try {
    const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Number(legacy?.version) < 1 || Number(legacy?.version) > RUN_SCHEMA_VERSION) return emptySaveStore();
    const migrated = normalizeRun(structuredClone(legacy));
    const store = upsertRunSave(emptySaveStore(), migrated, migrated.updatedAt || migrated.createdAt);
    localStorage.setItem(SAVE_STORE_KEY, JSON.stringify(store));
    return store;
  } catch {
    return emptySaveStore();
  }
}

function loadSavedRun(saveId = null) {
  const store = loadSaveStore();
  const entry = store.saves.find((item) => item.id === (saveId || store.activeSaveId)) ?? store.saves[0];
  if (!entry) return null;
  const saved = structuredClone(entry.run);
  return Number(saved?.version) >= 1 && Number(saved?.version) <= RUN_SCHEMA_VERSION ? normalizeRun(saved) : null;
}

function loadSavedRuns() {
  return loadSaveStore().saves.map((entry) => ({
    ...entry,
    run: normalizeRun(structuredClone(entry.run)),
  }));
}

function migratePlayerPosition(player, state) {
  const legendProfile = player.legendId ? LEGEND_PROFILES.find((profile) => profile.id === player.legendId) : null;
  if (legendProfile) {
    player.role = legendProfile.role;
    player.secondaryRole = legendProfile.secondaryRole;
    player.preferredFoot = legendProfile.preferredFoot;
    return;
  }
  const currentGroup = roleGroup(player.role);
  if (POSITION_GROUPS[currentGroup].includes(player.role)) {
    if (!player.preferredFoot) player.preferredFoot = preferredFootForPosition(player.role, createRng(`foot-${player.id}`));
    return;
  }
  const position = state.lineupPositions?.[player.id];
  const positions = POSITION_GROUPS[currentGroup];
  const selected = currentGroup === "GK"
    ? "GK"
    : Number.isFinite(position?.x) && Number.isFinite(position?.y)
      ? inferBoardRoles([{ id: player.id, position }])[player.id]
      : randomItem(positions, createRng(`position-${player.id}`));
  const secondaryGroup = roleGroup(player.secondaryRole);
  const secondaryPool = POSITION_GROUPS[secondaryGroup]?.filter((position) => position !== selected) ?? [];
  player.role = selected;
  player.secondaryRole = selected === "GK" || !secondaryPool.length ? null : randomItem(secondaryPool, createRng(`secondary-${player.id}`));
  player.preferredFoot = preferredFootForPosition(selected, createRng(`foot-${player.id}`));
}

function normalizeRun(value) {
  const next = value;
  const previousVersion = Number(next.version) || 1;
  if (previousVersion < 7) {
    if (!next.name || next.name === "社区梦想队") {
      next.name = randomLocalizedTeamName(1, createRng(`club-name-${next.createdAt ?? "legacy"}`));
    }
    // 对手是临时生成数据，升级后立即刷新；不改写玩家可能手动更名过的自有球员。
    next.opponent = null;
  }
  next.version = RUN_SCHEMA_VERSION;
  next.saveId = String(next.saveId || createSaveId(Date.parse(next.createdAt) || Date.now()));
  next.inventory = Array.isArray(next.inventory) ? next.inventory : [];
  next.players = Array.isArray(next.players) ? next.players : [];
  next.history = Array.isArray(next.history) ? next.history : [];
  next.shopRefreshTokens = Number.isFinite(Number(next.shopRefreshTokens)) ? Math.max(0, Number(next.shopRefreshTokens)) : next.history.length;
  next.shopOfferVersion = Number.isFinite(Number(next.shopOfferVersion)) ? Math.max(0, Number(next.shopOfferVersion)) : 0;
  next.shopBought = next.shopBought && typeof next.shopBought === "object" ? next.shopBought : {};
  next.pendingTraitShopChoices = Array.isArray(next.pendingTraitShopChoices) ? next.pendingTraitShopChoices : [];
  next.pendingPlayerShopChoices = Array.isArray(next.pendingPlayerShopChoices) ? next.pendingPlayerShopChoices : [];
  next.shopLegendPity = clamp(Math.floor(Number(next.shopLegendPity) || 0), 0, LEGEND_PITY_LIMIT - 1);
  next.rewardLegendPity = clamp(Math.floor(Number(next.rewardLegendPity) || 0), 0, LEGEND_PITY_LIMIT - 1);
  next.pendingPlayerShopLegendInfo = next.pendingPlayerShopLegendInfo && typeof next.pendingPlayerShopLegendInfo === "object"
    ? next.pendingPlayerShopLegendInfo
    : null;
  next.pendingVictoryReward = next.pendingVictoryReward?.match ? next.pendingVictoryReward : null;
  next.devMode = Boolean(next.devMode);
  next.skipSellConfirmation = Boolean(next.skipSellConfirmation);
  next.usedLegendIds = Array.isArray(next.usedLegendIds) ? [...new Set(next.usedLegendIds)] : [];
  next.lastLegendDepartures = Array.isArray(next.lastLegendDepartures) ? next.lastLegendDepartures : [];
  next.lastRetirements = Array.isArray(next.lastRetirements) ? next.lastRetirements : [];
  next.lastTraitDepartures = Array.isArray(next.lastTraitDepartures) ? next.lastTraitDepartures : [];
  next.lastTraitConsumptions = Array.isArray(next.lastTraitConsumptions) ? next.lastTraitConsumptions : [];
  next.usedTraitEffects = next.usedTraitEffects && typeof next.usedTraitEffects === "object" ? next.usedTraitEffects : {};
  next.lastPlayerSystemReport = Array.isArray(next.lastPlayerSystemReport) ? next.lastPlayerSystemReport : [];
  next.chemistryLinks = next.chemistryLinks && typeof next.chemistryLinks === "object" ? next.chemistryLinks : {};
  next.lineupPositions = next.lineupPositions && typeof next.lineupPositions === "object" ? next.lineupPositions : {};
  const formationMigration = { "121": "231", "112": "222", "211": "321" };
  const migratedFormation = formationMigration[next.formation] ?? next.formation;
  next.formation = /^\d{3}$/.test(String(migratedFormation ?? "")) ? String(migratedFormation) : DEFAULT_FORMATION_KEY;
  for (const player of next.players) {
    migratePlayerPosition(player, next);
    Object.assign(player, normalizePlayerSchema(player));
    player.traits = Array.isArray(player.traits) ? player.traits : [];
    if (!player.traits.some((entry) => entry.innate) && player.traits.length) player.traits[0].innate = true;
    if (!player.traits.length && catalog.length) {
      const compatible = catalog.filter((trait) => traitFitsRole(trait, player.role));
      const rng = createRng(`restore-innate-${player.id}`);
      const innate = randomItem(compatible.length ? compatible : catalog, rng);
      if (innate) player.traits.push({ id: innate.id, innate: true, locked: true });
    }
    for (const entry of player.traits) if (entry.innate) entry.locked = true;
    if (player.legendary) {
      player.legendMatchesRemaining = Number.isFinite(Number(player.legendMatchesRemaining))
        ? clamp(Number(player.legendMatchesRemaining), 0, LEGEND_MATCH_LIMIT)
        : LEGEND_MATCH_LIMIT;
      if (player.legendId && !next.usedLegendIds.includes(player.legendId)) next.usedLegendIds.push(player.legendId);
    }
  }
  const playerIds = new Set(next.players.map((player) => player.id));
  const existingLineup = Array.isArray(next.lineupIds) ? next.lineupIds : [];
  next.lineupIds = [...new Set(existingLineup.filter((id) => playerIds.has(id)))].slice(0, TEAM_SIZE);
  for (const player of next.players) {
    if (next.lineupIds.length >= TEAM_SIZE) break;
    if (!next.lineupIds.includes(player.id)) next.lineupIds.push(player.id);
  }
  ensureLineupPositions(next);
  return next;
}

function lineupZoneFromY(y) {
  return boardZoneFromY(y);
}

function lineupZoneLabel(role) {
  return ROLE_LABELS[role] ?? ({ GK: "门将区", DEF: "后场", MID: "中场", ATT: "前场" })[role] ?? role;
}

function lineupDetailedRoles(state = run, positions = state?.lineupPositions ?? {}) {
  return inferBoardRoles((state?.lineupIds ?? []).map((id) => ({ id, position: positions[id] })));
}

function lineupZoneCounts(state = run, positions = state?.lineupPositions ?? {}) {
  const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const id of state?.lineupIds ?? []) {
    const position = positions[id];
    if (position) counts[lineupZoneFromY(position.y)] += 1;
  }
  return counts;
}

function lineupShapeStatus(state = run, positions = state?.lineupPositions ?? {}) {
  const zones = lineupZoneCounts(state, positions);
  const detailed = lineupDetailedRoles(state, positions);
  const roleCounts = Object.values(detailed).reduce((counts, role) => {
    counts[role] = (counts[role] ?? 0) + 1;
    return counts;
  }, {});
  let message = "";
  if (["GK", "DEF", "MID", "ATT"].some((zone) => zones[zone] < 1)) message = "门将、后场、中场和前场都必须至少保留 1 人";
  else if (zones.DEF > 4) message = "后场最多放置 4 名后卫";
  else if (zones.ATT > 4) message = "前场最多放置 4 名球员";
  else if ((roleCounts.CB ?? 0) > 2) message = "中路最多放置 2 名中后卫，请把多出的球员移到边路";
  else if ((roleCounts.LB ?? 0) + (roleCounts.RB ?? 0) > 2) message = "边路最多放置 2 名边后卫";
  else if ((roleCounts.ST ?? 0) > 2) message = "中路最多放置 2 名中锋，请把多出的球员移到边路";
  else if ((roleCounts.LW ?? 0) + (roleCounts.RW ?? 0) > 2) message = "边路最多放置 2 名边锋";
  return { valid: !message, message, zones, roles: detailed, roleCounts };
}

function injuryStatus(player) {
  const injury = player?.state?.injury;
  if (!injury || injury.matchesRemaining <= 0 || injury.severity === "none") return null;
  return {
    ...injury,
    label: INJURY_PROFILES[injury.severity]?.label ?? "伤病",
    unavailable: isPlayerUnavailable(player),
  };
}

function suspensionStatus(player) {
  const suspension = player?.state?.suspension;
  if (!suspension || suspension.matchesRemaining <= 0) return null;
  return {
    ...suspension,
    type: "suspension",
    label: "红牌停赛",
    unavailable: true,
  };
}

function playerAvailabilityStatus(player) {
  return suspensionStatus(player) ?? injuryStatus(player);
}

function lineupIsValid(state = run, positions = state?.lineupPositions ?? {}) {
  const shape = lineupShapeStatus(state, positions);
  const unavailableStarter = (state?.lineupIds ?? []).some((id) => {
    const player = state?.players?.find((item) => item.id === id);
    return player && isPlayerUnavailable(player);
  });
  return !unavailableStarter && shape.valid;
}

function detectedFormationLabel(state = run) {
  const counts = lineupZoneCounts(state);
  const goalkeeperPrefix = counts.GK > 1 ? `${counts.GK}GK · ` : "";
  return `${goalkeeperPrefix}${counts.DEF}-${counts.MID}-${counts.ATT}`;
}

function syncDetectedFormation(state = run) {
  const counts = lineupZoneCounts(state);
  state.formation = `${counts.DEF}${counts.MID}${counts.ATT}`;
}

function assignDefaultLineupPositions(state) {
  const roles = state.lineupIds.map((id) => state.players.find((item) => item.id === id)?.role ?? "DM");
  const defaults = formationBoardPositions(roles);
  state.lineupPositions = {};
  state.lineupIds.forEach((id, index) => {
    const position = defaults[index] ?? { x: 50, y: 47 };
    state.lineupPositions[id] = { x: Math.round(clamp(position.x, 12, 88)), y: Math.round(position.y) };
  });
}

function ensureLineupPositions(state = run) {
  if (!state) return;
  const ids = new Set(state.lineupIds ?? []);
  for (const id of Object.keys(state.lineupPositions ?? {})) if (!ids.has(id)) delete state.lineupPositions[id];
  const complete = [...ids].every((id) => {
    const position = state.lineupPositions[id];
    return Number.isFinite(position?.x) && Number.isFinite(position?.y);
  });
  if (!complete) assignDefaultLineupPositions(state);
  syncDetectedFormation(state);
}

function assignedLineupRole(playerId, state = run) {
  return lineupDetailedRoles(state)[playerId] ?? "DM";
}

function simulationStarters(players = getStarters()) {
  return players.map((player) => ({
    ...player,
    assignedRole: assignedLineupRole(player.id),
    boardPosition: { ...run.lineupPositions[player.id] },
  }));
}

function chemistryLinkKey(leftId, rightId) {
  return [leftId, rightId].sort().join("::");
}

function teamChemistry(players = getStarters()) {
  if (players.length < 2) return 50;
  let total = 0;
  let pairs = 0;
  for (let left = 0; left < players.length; left += 1) {
    for (let right = left + 1; right < players.length; right += 1) {
      const sharedMatches = Number(run.chemistryLinks?.[chemistryLinkKey(players[left].id, players[right].id)] ?? 0);
      total += 50 + Math.min(50, sharedMatches * 4);
      pairs += 1;
    }
  }
  return Math.round(total / Math.max(1, pairs));
}

function chemistryLabel(value) {
  return value >= 90 ? "心有灵犀" : value >= 76 ? "配合默契" : value >= 62 ? "逐渐磨合" : "初次搭档";
}

function teamChemistryMarkup(players = getStarters(), compact = false) {
  const value = teamChemistry(players);
  return `<section class="team-chemistry ${compact ? "compact" : ""}"><div><p class="kicker">TEAM CHEMISTRY</p><h3>球队默契</h3><small>${chemistryLabel(value)} · 共同出场会持续提高</small></div><strong>${value}<small>/100</small></strong><i><em style="width:${value}%"></em></i></section>`;
}

function updateChemistryLinks(playedIds) {
  const ids = [...playedIds].filter((id) => run.players.some((player) => player.id === id));
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      const key = chemistryLinkKey(ids[left], ids[right]);
      run.chemistryLinks[key] = Math.min(20, Number(run.chemistryLinks[key] ?? 0) + 1);
    }
  }
}

function getStarters() {
  if (!run) return [];
  normalizeRun(run);
  return run.lineupIds.map((id) => run.players.find((player) => player.id === id)).filter(Boolean);
}

function getBench() {
  const starters = new Set(run?.lineupIds ?? []);
  return (run?.players ?? []).filter((player) => !starters.has(player.id));
}

function traitSlotLimit() {
  return run.stage >= 31 ? 3 : 2;
}

function playerTraitSlotLimit(player) {
  return player?.legendary ? 3 : traitSlotLimit();
}

function hasGold(cost) {
  return Boolean(run?.devMode) || run.gold >= cost;
}

function spendGold(cost) {
  if (!run.devMode) run.gold -= cost;
}

function goldLabel() {
  return run?.devMode ? "∞ G" : `${run?.gold ?? 0} G`;
}

function shopRefreshLabel() {
  return run?.devMode ? "∞" : String(run?.shopRefreshTokens ?? 0);
}

function canRefreshShop() {
  return Boolean(run?.devMode) || (run?.shopRefreshTokens ?? 0) > 0;
}

function activateDeveloperCheat() {
  developerCheatQueued = true;
  if (run) {
    run.devMode = true;
    saveRun();
    document.querySelectorAll("#shop-draw, #shop-scout, #refresh-shop-offers, [data-buy-card]:not([data-shop-sold])").forEach((button) => { button.disabled = false; });
    document.querySelectorAll(".shop-balance > span:first-child b").forEach((label) => { label.textContent = "∞ G"; });
    document.querySelectorAll(".shop-balance > span:nth-child(2) b").forEach((label) => { label.textContent = "∞ 次"; });
    const refreshButton = document.querySelector("#refresh-shop-offers");
    if (refreshButton) refreshButton.textContent = "刷新本期卡牌 · ∞";
  } else {
    document.body.classList.add("developer-cheat-active");
  }
  showToast("F8 开发者模式已开启：无限金币 · 比赛必胜");
}

function saveRun() {
  if (!run) return;
  run.updatedAt = new Date().toISOString();
  const store = upsertRunSave(loadSaveStore(), run, run.updatedAt);
  run.saveId = store.activeSaveId;
  localStorage.setItem(SAVE_STORE_KEY, JSON.stringify(store));
  // 保留当前存档的旧格式镜像，确保 v0.1/v0.2 早期版本仍可回读。
  localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
  updateHeader();
  const label = document.querySelector("#save-label");
  if (label) {
    label.textContent = "已保存";
    setTimeout(() => { if (label) label.textContent = `${PRODUCT_VERSION} 本地存档`; }, 900);
  }
}

function updateHeader() {
  runStatus.hidden = !run;
  gameNav.hidden = !run || run.players.length < TEAM_SIZE || Boolean(draft) || Boolean(runtime);
  document.body.classList.toggle("run-nav-visible", !gameNav.hidden);
  document.body.classList.toggle("match-active", Boolean(runtime));
  if (!run) return;
  document.querySelector("#status-stage").textContent = `${String(run.stage).padStart(2, "0")} / 50`;
  document.body.classList.toggle("developer-cheat-active", Boolean(run.devMode));
  document.querySelector("#status-gold").textContent = goldLabel();
}

function setActiveNav(key) {
  document.querySelectorAll("[data-game-nav]").forEach((button) => button.classList.toggle("active", button.dataset.gameNav === key));
}

function makeNewRun() {
  const createdAt = new Date().toISOString();
  return {
    version: RUN_SCHEMA_VERSION,
    saveId: createSaveId(Date.parse(createdAt)),
    name: randomLocalizedTeamName(1, Math.random),
    stage: 1,
    gold: 0,
    players: [],
    lineupIds: [],
    lineupPositions: {},
    inventory: [],
    shopRefreshTokens: 0,
    shopOfferVersion: 0,
    shopBought: {},
    pendingTraitShopChoices: [],
    pendingPlayerShopChoices: [],
    shopLegendPity: 0,
    rewardLegendPity: 0,
    pendingPlayerShopLegendInfo: null,
    pendingVictoryReward: null,
    devMode: developerCheatQueued,
    skipSellConfirmation: false,
    usedLegendIds: [],
    lastLegendDepartures: [],
    lastRetirements: [],
    lastTraitDepartures: [],
    lastTraitConsumptions: [],
    usedTraitEffects: {},
    lastPlayerSystemReport: [],
    chemistryLinks: {},
    tactic: "balanced",
    formation: DEFAULT_FORMATION_KEY,
    opponent: null,
    history: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function getTrait(id) {
  return catalog.find((trait) => trait.id === id);
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error("特性卡接口不可用");
    const payload = await response.json();
    catalog = payload.state?.traitCards ?? [];
    bondCatalog = payload.state?.bonds ?? [];
    gameConfig = normalizeGameConfig(payload.state?.globalConfig);
  } catch (error) {
    catalog = [];
    bondCatalog = [];
    gameConfig = normalizeGameConfig(DEFAULT_GAME_CONFIG);
    showToast("未读取到开发卡池，球员将暂时没有先天特性");
    console.warn(error);
  }
}

function stopRuntime() {
  for (const timer of runtime?.visualTimers ?? []) clearTimeout(timer);
  if (runtime?.animationFrame) cancelAnimationFrame(runtime.animationFrame);
  runtime = null;
}

function formatSaveTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function saveCardMarkup(entry) {
  const saved = entry.run;
  const status = saved.players.length < TEAM_SIZE
    ? `阵容 ${saved.players.length}/${TEAM_SIZE}`
    : saved.pendingVictoryReward?.match
      ? "待领取奖励"
      : `第 ${saved.stage} 关`;
  return `<article class="save-slot ${entry.id === loadSaveStore().activeSaveId ? "active" : ""}">
    <div class="save-slot-main"><span class="save-club-mark">${escapeHtml(saved.name?.slice(0, 1) || "队")}</span><div><small>${status} · ${formatSaveTime(entry.updatedAt)}</small><h3>${escapeHtml(saved.name || "未命名球队")}</h3><p>${saved.players.length} 名球员 · ${saved.history?.length ?? 0} 场记录 · ${saved.gold ?? 0} G</p></div></div>
    <div class="save-slot-actions"><button class="secondary-button compact" data-save-continue="${escapeHtml(entry.id)}">继续</button><button class="icon-button danger" data-save-delete="${escapeHtml(entry.id)}" aria-label="删除 ${escapeHtml(saved.name || "未命名球队")}">删除</button></div>
  </article>`;
}

function continueSavedRun(saveId) {
  run = loadSavedRun(saveId);
  if (!run) return renderWelcome();
  if (developerCheatQueued) run.devMode = true;
  if (run.players.length < TEAM_SIZE) {
    startRosterCompletionDraft();
    return;
  }
  if (run.pendingVictoryReward?.match) {
    updateHeader();
    gameNav.hidden = true;
    document.body.classList.remove("run-nav-visible");
    renderVictory(run.pendingVictoryReward.match, run.pendingVictoryReward.round ?? 1, run.pendingVictoryReward.pickedTraitIds ?? []);
    return;
  }
  prepareOpponent();
  updateHeader();
  renderSquadScreen();
}

function confirmDeleteSave(saveId) {
  const entry = loadSaveStore().saves.find((item) => item.id === saveId);
  if (!entry) return;
  openModal(`
    <p class="kicker">SAVE MANAGEMENT</p>
    <h2>删除“${escapeHtml(entry.run.name || "未命名球队")}”？</h2>
    <p>这个存档的阵容、赛程和奖励进度会从本机移除。</p>
    <div class="button-row"><button class="primary-button danger-button" id="confirm-delete-save">删除存档</button><button class="secondary-button" data-close-modal>返回</button></div>`, () => {
    document.querySelector("#confirm-delete-save").addEventListener("click", () => {
      const store = removeRunSave(loadSaveStore(), saveId);
      localStorage.setItem(SAVE_STORE_KEY, JSON.stringify(store));
      const active = store.saves.find((item) => item.id === store.activeSaveId)?.run;
      if (active) localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
      else localStorage.removeItem(STORAGE_KEY);
      closeModal();
      renderWelcome();
      showToast("存档已删除");
    });
  });
}

function renderWelcome() {
  stopRuntime();
  run = null;
  updateHeader();
  setActiveNav("");
  const saves = loadSavedRuns();
  screen.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <p class="kicker">FROM THE COMMUNITY TO THE WORLD</p>
        <h1 class="display-title">从野球场<br /><span class="outline">到世界之巅</span></h1>
        <p class="lede">挑出七名没人认识的球员，用奇怪但有效的特性组建球队。五十场比赛之后，看看谁还敢叫你“社区临时教练”。</p>
        <div class="button-row">
          <button class="primary-button" id="new-run">开始新征程</button>
          <a class="text-button" href="/" style="text-decoration:none">进入开发者后台</a>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="hero-number">50</div>
        <div class="hero-card">
          <div class="shirt">7</div>
          <div class="hero-card-label"><span><strong>草根首发</strong><small>STARTING SEVEN</small></span><b>?</b></div>
        </div>
      </div>
    </section>
    <section class="save-manager">
      <header><div><p class="kicker">LOCAL SAVES</p><h2>存档管理</h2></div><span>${saves.length} 个存档</span></header>
      <div class="save-slot-list">${saves.length ? saves.map(saveCardMarkup).join("") : `<div class="save-empty"><b>还没有球队</b><small>建立第一支七人阵容吧。</small></div>`}</div>
    </section>`;
  document.querySelector("#new-run").addEventListener("click", beginNewRun);
  document.querySelectorAll("[data-save-continue]").forEach((button) => button.addEventListener("click", () => continueSavedRun(button.dataset.saveContinue)));
  document.querySelectorAll("[data-save-delete]").forEach((button) => button.addEventListener("click", () => confirmDeleteSave(button.dataset.saveDelete)));
}

function beginNewRun() {
  startDraft();
}

function startDraft() {
  run = makeNewRun();
  draft = { index: 0, roles: [...DRAFT_ROLES], choices: [], selected: null, rng: createRng(`draft-${Date.now()}`), mode: "new" };
  updateHeader();
  makeDraftChoices();
  renderDraft();
}

function missingRosterDraftRoles(players) {
  const roles = [];
  const counts = players.reduce((map, player) => { const group = roleGroup(player.role); map[group] = (map[group] ?? 0) + 1; return map; }, {});
  for (const role of ["GK", "DEF", "MID", "ATT"]) {
    if ((counts[role] ?? 0) === 0) {
      roles.push(role);
      counts[role] = 1;
    }
  }
  while (players.length + roles.length < TEAM_SIZE) roles.push("FLEX");
  return roles;
}

function startRosterCompletionDraft() {
  const roles = missingRosterDraftRoles(run.players);
  if (!roles.length) return renderSquadScreen();
  draft = { index: 0, roles, choices: [], selected: null, rng: createRng(`seven-a-side-migration-${Date.now()}`), mode: "migration" };
  updateHeader();
  makeDraftChoices();
  renderDraft();
  showToast("旧存档升级为七人制：请补齐首发阵容");
}

function makeDraftChoices() {
  const role = draft.roles[draft.index];
  if (role === "FLEX") {
    const names = new Set(run.players.map((player) => player.name));
    draft.choices = ["DEF", "MID", "ATT"].map((lineRole) => {
      const choices = generateDraftChoices(lineRole, catalog, draft.rng, { stage: run.stage, usedNames: names });
      const choice = choices.find((player) => !names.has(player.name)) ?? choices[0];
      names.add(choice.name);
      return choice;
    });
  } else {
    draft.choices = generateDraftChoices(role, catalog, draft.rng, { stage: run.stage, usedNames: run.players.map((player) => player.name) });
  }
  draft.selected = null;
}

function draftRoleLabel(role) {
  return role === "FLEX" ? "自由位置" : ROLE_LABELS[role];
}

function statBar(label, value) {
  return `<div class="stat-row"><span>${label}</span><div class="stat-line"><i style="width:${value}%"></i></div><b>${value}</b></div>`;
}

function renderDraftCard(player, index) {
  const trait = getTrait(player.traits[0]?.id);
  return `
    <button class="player-card draft-pick-card ${draft.selected === index ? "selected" : ""}" data-draft-choice="${index}" data-number="${index + 1}" aria-pressed="${draft.selected === index}">
      <span class="player-top"><span class="role-chip">${ROLE_LABELS[player.role]}</span><span class="grade-chip">先天 ${traitGrade(trait?.rarity)}</span></span>
      <h2 class="player-name">${escapeHtml(player.name)}</h2>
      <span class="player-sub">${player.heightCm} CM · ${FOOT_LABELS[player.preferredFoot]} · 副位置 ${ROLE_LABELS[player.secondaryRole] ?? "无"}</span>
      <span class="player-scouting-profile">${escapeHtml(recruitmentProfile(player))}</span>
      <span class="overall"><b>${playerOverall(player)}</b><small>综合评估</small></span>
      <div class="stat-bars">
        ${statBar("进攻", playerValue(player, "attack"))}
        ${statBar("传球", playerValue(player, "passing"))}
        ${statBar("防守", playerValue(player, "defense"))}
        ${statBar(player.role === "GK" ? "守门" : "速度", playerValue(player, player.role === "GK" ? "goalkeeping" : "pace"))}
      </div>
      <div class="trait-ribbon" ${trait ? `tabindex="0" role="button" data-trait-card-id="${escapeHtml(trait.id)}"` : ""}><small>先天特性卡</small><strong>${escapeHtml(trait?.name ?? "朴实无华")}</strong><p>${escapeHtml(trait?.summary ?? "没有读取到特性卡数据。")}</p></div>
    </button>`;
}

function draftRosterPreviewMarkup() {
  const selected = draft.selected === null ? null : draft.choices[draft.selected];
  const players = [...run.players, ...(selected ? [{ ...selected, pending: true }] : [])];
  return players.length ? players.map((player, index) => {
    const trait = getTrait(player.traits[0]?.id);
    return `<article class="draft-signed-card ${player.pending ? "pending" : ""}" tabindex="0" aria-label="查看 ${escapeHtml(player.name)} 的球员信息"><span>${player.pending ? "待签" : String(index + 1).padStart(2,"0")}</span><div><small>${ROLE_LABELS[player.role]} · ${trait ? `${traitGrade(trait.rarity)}级先天` : "无特性"}</small><b>${escapeHtml(player.name)}</b></div><strong>${playerOverall(player)}</strong>
      <section class="draft-player-popover"><header><div><small>${ROLE_LABELS[player.role]}${player.secondaryRole ? ` / ${ROLE_LABELS[player.secondaryRole]}` : ""}</small><b>${escapeHtml(player.name)}</b></div><strong>${playerOverall(player)}</strong></header><p>${player.heightCm} CM · ${FOOT_LABELS[player.preferredFoot]} · ${escapeHtml(recruitmentProfile(player))}</p><div class="draft-popover-stats"><span>攻 <b>${playerValue(player, "attack")}</b></span><span>传 <b>${playerValue(player, "passing")}</b></span><span>防 <b>${playerValue(player, "defense")}</b></span><span>${player.role === "GK" ? "门" : "速"} <b>${playerValue(player, player.role === "GK" ? "goalkeeping" : "pace")}</b></span></div><footer>${playerVitalsMarkup(player)}<span><small>先天</small><b>${escapeHtml(trait?.name ?? "无")}</b></span></footer></section>
    </article>`;
  }).join("") : `<p class="draft-roster-empty">尚未签下球员</p>`;
}

function draftPositionStatsMarkup() {
  const selected = draft.selected === null ? null : draft.choices[draft.selected];
  const players = [...run.players, ...(selected ? [selected] : [])];
  const counts = players.reduce((total, player) => {
    total[roleGroup(player.role)] += 1;
    return total;
  }, { GK: 0, DEF: 0, MID: 0, ATT: 0 });
  return `<div class="draft-position-stats"><span><small>门将</small><b>${counts.GK}</b></span><span><small>后卫</small><b>${counts.DEF}</b></span><span><small>中场</small><b>${counts.MID}</b></span><span><small>前锋</small><b>${counts.ATT}</b></span></div>`;
}

function renderDraft() {
  const role = draft.roles[draft.index];
  screen.innerHTML = `
    <section class="draft-screen">
      <header class="screen-head">
        <div><p class="kicker">${draft.mode === "migration" ? "SEVEN-A-SIDE UPGRADE" : "ROOKIE DRAFT"} · ${draft.index + 1}/${draft.roles.length}</p><h1>选择你的${draftRoleLabel(role)}</h1></div>
        <div class="draft-progress">${draft.roles.map((_, index) => `<i class="${index < draft.index ? "done" : index === draft.index ? "current" : ""}"></i>`).join("")}</div>
      </header>
      <div class="card-grid">${draft.choices.map(renderDraftCard).join("")}</div>
      <section class="draft-signed-roster"><header><div><p class="kicker">YOUR SEVEN</p><h3>已选阵容</h3></div>${draftPositionStatsMarkup()}<span>${run.players.length} / ${TEAM_SIZE} 已签下</span></header><div id="draft-roster-preview">${draftRosterPreviewMarkup()}</div></section>
      <div class="draft-action">
        <span class="picked-list" id="draft-selection-label">${draft.selected === null ? "尚未选择" : `已选择 ${escapeHtml(draft.choices[draft.selected].name)}`}</span>
        <button class="primary-button" id="confirm-draft" ${draft.selected === null ? "disabled" : ""}>${draft.selected === null ? "选择一名球员" : `签下 ${escapeHtml(draft.choices[draft.selected].name)}`}</button>
      </div>
    </section>`;
  const cards = [...document.querySelectorAll("[data-draft-choice]")];
  const selectCard = (card) => {
    draft.selected = Number(card.dataset.draftChoice);
    const player = draft.choices[draft.selected];
    cards.forEach((item) => { const active = item === card; item.classList.toggle("selected", active); item.setAttribute("aria-pressed", String(active)); });
    document.querySelector("#confirm-draft").disabled = false;
    document.querySelector("#confirm-draft").textContent = `签下 ${player.name}`;
    document.querySelector("#draft-selection-label").textContent = `已选择 ${player.name}`;
    document.querySelector("#draft-roster-preview").innerHTML = draftRosterPreviewMarkup();
    document.querySelector(".draft-position-stats").outerHTML = draftPositionStatsMarkup();
  };
  cards.forEach((card) => {
    card.addEventListener("click", () => selectCard(card));
    card.addEventListener("dblclick", (event) => { if (event.target.closest("[data-trait-card-id]")) return; event.preventDefault(); selectCard(card); confirmDraftChoice(); });
  });
  document.querySelector("#confirm-draft").addEventListener("click", confirmDraftChoice);
  bindTraitCardInteractions(screen);
}

function confirmDraftChoice() {
  if (draft.selected === null) return;
  run.players.push(structuredClone(draft.choices[draft.selected]));
  draft.index += 1;
  if (draft.index >= draft.roles.length) {
    run.lineupIds = run.players.slice(0, TEAM_SIZE).map((player) => player.id);
    assignDefaultLineupPositions(run);
    syncDetectedFormation(run);
    prepareOpponent();
    saveRun();
    draft = null;
    renderSquadScreen();
    showToast(`七人到齐。${run.name}正式成立！`);
    return;
  }
  makeDraftChoices();
  renderDraft();
}

function tierName(stage) {
  return ["社区赛场", "省级联赛", "全国大赛", "洲际赛场", "国际舞台"][Math.min(4, Math.floor((stage - 1) / 10))];
}

function prepareOpponent(force = false) {
  if (!run.opponent || run.opponent.stage !== run.stage || !run.opponent.formation || !Array.isArray(run.opponent.squad) || run.opponent.squad.length < TEAM_SIZE || run.opponent.squad.slice(0, TEAM_SIZE).some((player) => !player.assignedRole || !player.boardPosition) || force) {
    const rng = createRng(`opponent-${run.stage}-${run.history.length}-${Date.now()}`);
    run.opponent = { ...generateOpponent(run.stage, rng, [run.name]), stage: run.stage };
    run.opponent.squad = generateOpponentSquad(run.opponent, rng, 4);
    saveRun();
  }
}

function opponentIntelPlayerMarkup(player) {
  const values = [
    ["进攻", playerValue(player, "attack")],
    ["传球", playerValue(player, "passing")],
    ["防守", playerValue(player, "defense")],
    ["速度", playerValue(player, "pace")],
    ["耐力", playerValue(player, "stamina")],
    ["冷静", playerValue(player, "composure")],
    ["制空", playerValue(player, "aerial")],
    ["身体", playerValue(player, "physical")],
    ["精神", playerValue(player, "mental")],
  ];
  return `<details class="opponent-player-intel"><summary><span>${ROLE_LABELS[player.assignedRole ?? player.role]}</span><b>${escapeHtml(player.name)}</b><small>本职 ${ROLE_LABELS[player.role]}</small><strong>${playerOverall(player)}</strong></summary><div>${values.map(([label, value]) => `<span><small>${label}</small><b>${value}</b></span>`).join("")}</div></details>`;
}

function openOpponentIntel() {
  prepareOpponent();
  const starters = run.opponent.squad.slice(0, TEAM_SIZE);
  const shape = formationSettings(starters, run.opponent.formation);
  openModal(`
    <div class="opponent-intel-head"><div><p class="kicker">OPPOSITION REPORT</p><h2>${escapeHtml(run.opponent.name)}</h2><p>${tierName(run.stage)} · 系统识别 ${shape.name} · ${TACTICS[run.opponent.tactic]?.name ?? "攻守平衡"}</p></div><button class="secondary-button" data-close-modal>关闭</button></div>
    <div class="opponent-shape-strip"><span><small>整体评级</small><b>${run.opponent.rating}</b></span><span><small>阵型结构</small><b>${shape.coherence}</b></span><span><small>进攻投入</small><b>${shape.attackingNumbers}</b></span><span><small>防守保护</small><b>${shape.defensiveBalance}</b></span><span><small>中场密度</small><b>${shape.midfieldDensity}</b></span></div>
    <div class="opponent-intel-layout">
      <section class="opponent-scout-pitch" aria-label="对手${shape.name}阵型">
        <div class="chalk-pitch" aria-hidden="true"><i class="chalk-half"></i><i class="chalk-circle"></i><i class="chalk-box top"></i><i class="chalk-box bottom"></i></div>
        <span class="board-direction">对手进攻方向 ↑</span>
        ${starters.map((player) => `<div class="opponent-scout-token" style="left:${player.boardPosition.x}%;top:${player.boardPosition.y}%"><i>${player.number}</i><b>${ROLE_LABELS[player.assignedRole]}</b><small>${escapeHtml(player.name)}</small></div>`).join("")}
      </section>
      <section class="opponent-roster-intel"><header><h3>首发能力</h3><small>展开球员可查看主要比赛数值</small></header>${starters.map(opponentIntelPlayerMarkup).join("")}</section>
    </div>`,
  () => modal.classList.add("opponent-intel-modal"));
}

function tacticsBoardPositions(players = getStarters()) {
  ensureLineupPositions(run);
  return players.map((player) => {
    const position = run.lineupPositions[player.id] ?? { x: 50, y: 47 };
    return [position.x, position.y];
  });
}

function freeBoardZonesMarkup() {
  return `<div class="free-tactics-zones" aria-hidden="true"><span class="zone-att"><b>前场</b></span><span class="zone-mid"><b>中场</b></span><span class="zone-def"><b>后场</b></span></div>`;
}

function playerPositionFit(player, requiredRole) {
  if (!requiredRole) return { key: "bench", label: "替补", score: 1 };
  const score = roleFitScore(player, requiredRole);
  return score >= 0.98
    ? { key: "primary", label: "主位置", score }
    : score >= 0.87
      ? { key: "secondary", label: "副位置", score }
      : { key: "out", label: score >= 0.76 ? "同线客串" : "客串", score };
}

function substituteSpecialties(player) {
  const owned = new Set((player?.traits ?? []).map((entry) => entry.id));
  const specialties = [];
  if (player?.legendary) specialties.push({ key: "legend", mark: "★", label: "传奇替补" });
  if (owned.has("impact-sub")) specialties.push({ key: "impact", mark: "⚡", label: "冲击替补" });
  if (owned.has("bench-oracle")) specialties.push({ key: "oracle", mark: "◉", label: "替补先知" });
  if (owned.has("utility-player")) specialties.push({ key: "utility", mark: "∞", label: "万金油" });
  if (owned.has("emergency-gloves")) specialties.push({ key: "keeper", mark: "✚", label: "应急门将" });
  return specialties;
}

function substituteSpecialtyMarkup(player, compact = false) {
  const specialties = substituteSpecialties(player);
  if (!specialties.length) return "";
  return `<span class="special-sub-badges ${compact ? "compact" : ""}">${specialties.slice(0, compact ? 1 : 2).map((item) => `<i class="special-${item.key}" title="${item.label}">${item.mark}${compact ? "" : `<em>${item.label}</em>`}</i>`).join("")}</span>`;
}

function benchFilterMarkup(targetId, compact = false) {
  const positions = ["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"];
  return `<label class="bench-filter ${compact ? "compact" : ""}"><span>筛选</span><select data-bench-filter data-bench-target="${targetId}"><option value="all">全部位置</option><option value="GK">门将</option><option value="DEF">全部后卫</option><option value="MID">全部中场</option><option value="ATT">全部前锋</option>${positions.slice(1).map((position) => `<option value="${position}">${ROLE_LABELS[position]}</option>`).join("")}</select></label>`;
}

function bindBenchFilters(root = document) {
  root.querySelectorAll("[data-bench-filter]").forEach((select) => select.addEventListener("change", () => {
    const target = document.getElementById(select.dataset.benchTarget);
    if (!target) return;
    target.querySelectorAll("[data-player-position]").forEach((item) => {
      const wrapper = item.closest(".loadout-player") ?? item;
      const visible = select.value === "all" || item.dataset.playerPosition === select.value || item.dataset.playerGroup === select.value;
      wrapper.hidden = !visible;
    });
  }));
}

function tacticsMagnet(player, slotIndex = null, requiredRole = null) {
  const fit = playerPositionFit(player, requiredRole);
  const status = playerAvailabilityStatus(player);
  const special = substituteSpecialties(player).length > 0;
  return `<button type="button" class="tactics-magnet fit-${fit.key} ${special ? "special-substitute" : ""} ${status ? `${status.type === "suspension" ? "suspended" : "injured"} ${status.unavailable ? "unavailable" : "playable-injury"}` : ""}" data-board-player="${player.id}" data-player-position="${player.role}" data-player-group="${roleGroup(player.role)}" data-required-position="${requiredRole ?? ""}" ${slotIndex === null ? "" : `data-board-slot="${slotIndex}"`} aria-label="${escapeHtml(player.name)}，${ROLE_LABELS[player.role]}，${fit.label}，体力${Math.round(playerValue(player, "fitness"))}，状态${playerCondition(player).label}${status ? `，${status.label}` : ""}" title="${escapeHtml(player.name)} · ${ROLE_LABELS[player.role]} · ${FOOT_LABELS[player.preferredFoot]} · ${fit.label} · 综合 ${playerOverall(player)}${status ? ` · ${status.label} ${status.matchesRemaining}场` : ""}">
    <span class="magnet-number">${status ? (status.type === "suspension" ? "禁" : "+") : slotIndex === null ? "B" : slotIndex + 1}</span><span class="magnet-copy"><b>${escapeHtml(player.name)}</b><small>${status ? `${status.label} · 剩余 ${status.matchesRemaining} 场` : `${ROLE_LABELS[requiredRole ?? player.role]} · ${fit.label} · ${playerOverall(player)}`}</small></span>${playerVitalsMarkup(player, true)}
    ${special ? substituteSpecialtyMarkup(player, true) : ""}
  </button>`;
}

let selectedBoardPlayerId = null;
let suppressBoardClick = false;
let tacticsBoardRenderer = null;

function animateBoardPlayers(ids) {
  requestAnimationFrame(() => {
    document.querySelectorAll("[data-board-player]").forEach((item) => {
      if (!ids.includes(item.dataset.boardPlayer)) return;
      item.classList.add("drop-land");
      setTimeout(() => item.classList.remove("drop-land"), 420);
    });
  });
}

function applyTacticsBoardSwap(sourceId, targetPlayerId) {
  const sourceSlot = run.lineupIds.indexOf(sourceId);
  const targetSlot = run.lineupIds.indexOf(targetPlayerId);
  if (!targetPlayerId || sourceId === targetPlayerId) return false;
  const sourcePlayer = run.players.find((player) => player.id === sourceId);
  const targetPlayer = run.players.find((player) => player.id === targetPlayerId);
  if (sourceSlot < 0 && sourcePlayer && isPlayerUnavailable(sourcePlayer)) return void showToast(`${sourcePlayer.name}${playerAvailabilityStatus(sourcePlayer)?.label ?? "当前不可用"}，不能进入首发`);
  if (targetSlot < 0 && sourceSlot >= 0 && targetPlayer && isPlayerUnavailable(targetPlayer)) return void showToast(`${targetPlayer.name}${playerAvailabilityStatus(targetPlayer)?.label ?? "当前不可用"}，不能进入首发`);
  if (sourceSlot >= 0 && targetSlot >= 0) {
    const sourcePosition = run.lineupPositions[sourceId];
    run.lineupPositions[sourceId] = run.lineupPositions[targetPlayerId];
    run.lineupPositions[targetPlayerId] = sourcePosition;
  } else if (sourceSlot < 0 && targetSlot >= 0) {
    run.lineupIds[targetSlot] = sourceId;
    run.lineupPositions[sourceId] = run.lineupPositions[targetPlayerId];
    delete run.lineupPositions[targetPlayerId];
  } else if (sourceSlot >= 0 && targetSlot < 0) {
    run.lineupIds[sourceSlot] = targetPlayerId;
    run.lineupPositions[targetPlayerId] = run.lineupPositions[sourceId];
    delete run.lineupPositions[sourceId];
  } else {
    return false;
  }
  syncDetectedFormation(run);
  saveRun();
  selectedBoardPlayerId = null;
  (tacticsBoardRenderer ?? renderHub)();
  animateBoardPlayers([sourceId, targetPlayerId]);
  showToast("战术板已更新");
  return true;
}

function moveTacticsPlayer(sourceId, board, clientX, clientY) {
  if (!run.lineupIds.includes(sourceId)) return showToast("替补球员请拖到一名场上球员身上完成替换");
  const rect = board.getBoundingClientRect();
  const x = clamp(((clientX - rect.left) / rect.width) * 100, 12, 88);
  const y = clamp(((clientY - rect.top) / rect.height) * 100, 8, 94);
  const nextPositions = { ...run.lineupPositions, [sourceId]: { x: Math.round(x), y: Math.round(y) } };
  const currentShape = lineupShapeStatus(run);
  const nextShape = lineupShapeStatus(run, nextPositions);
  if (!nextShape.valid && (currentShape.valid || nextShape.message !== currentShape.message)) {
    document.querySelector(`[data-board-player="${sourceId}"]`)?.classList.add("invalid-drop");
    setTimeout(() => document.querySelector(`[data-board-player="${sourceId}"]`)?.classList.remove("invalid-drop"), 420);
    showToast(currentShape.valid ? nextShape.message : `请先修正阵型：${currentShape.message}`);
    return false;
  }
  run.lineupPositions = nextPositions;
  syncDetectedFormation(run);
  saveRun();
  (tacticsBoardRenderer ?? renderHub)();
  animateBoardPlayers([sourceId]);
  showToast(`已移动到${lineupZoneLabel(assignedLineupRole(sourceId))} · 系统识别 ${detectedFormationLabel()}`);
  return true;
}

function bindTacticsBoard(renderer = renderHub) {
  tacticsBoardRenderer = renderer;
  document.querySelectorAll("[data-board-player]").forEach((magnet) => {
    magnet.addEventListener("click", (event) => {
      if (event.target.closest("[data-trait-card-id], [data-trait-drop-player]")) return;
      if (suppressBoardClick) return;
      const playerId = magnet.dataset.boardPlayer;
      if (!selectedBoardPlayerId) {
        selectedBoardPlayerId = playerId;
        document.querySelectorAll("[data-board-player]").forEach((item) => item.classList.toggle("selected", item.dataset.boardPlayer === playerId));
        showToast("已拿起球员磁贴，再点一名球员即可互换");
        return;
      }
      if (selectedBoardPlayerId === playerId) {
        selectedBoardPlayerId = null;
        magnet.classList.remove("selected");
        return;
      }
      applyTacticsBoardSwap(selectedBoardPlayerId, playerId);
    });
    magnet.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.altKey) openLineupEditor();
    });
    magnet.addEventListener("pointerdown", (event) => {
      if (event.target.closest("[data-trait-card-id], [data-trait-drop-player]")) return;
      if (event.button !== undefined && event.button !== 0) return;
      const sourceId = magnet.dataset.boardPlayer;
      const startX = event.clientX;
      const startY = event.clientY;
      let ghost = null;
      let moved = false;
      const move = (moveEvent) => {
        const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
        if (distance < 7 && !moved) return;
        moveEvent.preventDefault();
        moved = true;
        if (!ghost) {
          ghost = magnet.cloneNode(true);
          ghost.classList.add("drag-ghost");
          ghost.removeAttribute("style");
          document.body.appendChild(ghost);
          magnet.classList.add("drag-source");
          document.body.classList.add("board-dragging");
          highlightBoardSwapTargets(sourceId);
        }
        ghost.style.left = `${moveEvent.clientX}px`;
        ghost.style.top = `${moveEvent.clientY}px`;
        document.querySelectorAll("[data-free-tactics-board], .bench-magnets, [data-quick-sell-dock]").forEach((target) => target.classList.remove("drag-over"));
        document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest("[data-free-tactics-board], .bench-magnets, [data-quick-sell-dock]")?.classList.add("drag-over");
      };
      const up = (upEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        magnet.classList.remove("drag-source");
        document.body.classList.remove("board-dragging");
        clearPositionHighlights();
        ghost?.remove();
        document.querySelectorAll(".drag-over").forEach((target) => target.classList.remove("drag-over"));
        if (!moved) return;
        suppressBoardClick = true;
        setTimeout(() => { suppressBoardClick = false; }, 80);
        const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const quickSellTarget = target?.closest("[data-quick-sell-dock]");
        if (quickSellTarget) {
          requestQuickSellPlayer(sourceId, tacticsBoardRenderer ?? renderSquadScreen);
          return;
        }
        const targetMagnet = target?.closest("[data-board-player]");
        if (targetMagnet && targetMagnet.dataset.boardPlayer !== sourceId) return void applyTacticsBoardSwap(sourceId, targetMagnet.dataset.boardPlayer);
        const freeBoard = target?.closest("[data-free-tactics-board]");
        if (freeBoard) return void moveTacticsPlayer(sourceId, freeBoard, upEvent.clientX, upEvent.clientY);
        showToast("拖到球场区域自由站位，或拖到另一名球员身上替换");
      };
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up, { once: true });
      window.addEventListener("pointercancel", up, { once: true });
    });
  });
}

function clearPositionHighlights() {
  document.querySelectorAll(".position-match,.position-secondary").forEach((item) => item.classList.remove("position-match", "position-secondary"));
}

function highlightBoardSwapTargets(sourceId) {
  clearPositionHighlights();
  const source = run.players.find((player) => player.id === sourceId);
  if (!source) return;
  const sourceIsStarter = run.lineupIds.includes(sourceId);
  document.querySelectorAll("[data-board-player]").forEach((item) => {
    if (item.dataset.boardPlayer === sourceId) return;
    const targetIsStarter = item.hasAttribute("data-board-slot");
    if (sourceIsStarter === targetIsStarter) return;
    const requiredPosition = sourceIsStarter ? assignedLineupRole(sourceId) : item.dataset.requiredPosition;
    const candidate = sourceIsStarter ? run.players.find((player) => player.id === item.dataset.boardPlayer) : source;
    if (!candidate || !requiredPosition) return;
    const score = roleFitScore(candidate, requiredPosition);
    if (candidate.role === requiredPosition) item.classList.add("position-match");
    else if (score >= 0.87) item.classList.add("position-secondary");
  });
}

function renderHub() {
  stopRuntime();
  selectedBoardPlayerId = null;
  prepareOpponent();
  updateHeader();
  setActiveNav("matchday");
  const starters = getStarters();
  const bench = getBench();
  const ratings = teamRatings(simulationStarters(starters), run.tactic, catalog, run.formation, { chemistry: teamChemistry(starters), bonds: bondCatalog });
  const boardPositions = tacticsBoardPositions(starters);
  screen.innerHTML = `
    <section>
      <header class="screen-head">
        <div><p class="kicker">${tierName(run.stage)} · MATCH ${String(run.stage).padStart(2, "0")}</p><h1>比赛日，更衣室</h1></div>
        <div class="button-row"><button class="secondary-button" id="open-club">特性阵容</button><button class="secondary-button" id="open-shop">卡牌商店</button><button class="secondary-button" id="back-title">返回标题</button></div>
      </header>
      <div class="hub-layout">
        <section class="panel tactics-panel">
          <header class="panel-heading"><div><h2>自由战术板</h2><small>当前阵型 ${detectedFormationLabel()} · 左右决定边路，中场纵深决定前腰/后腰</small></div><span>综合 ${Math.round((ratings.attack + ratings.midfield + ratings.defense + ratings.goalkeeping) / 4)}</span></header>
          <div class="tactics-board-wrap">
            <div class="tactics-board" data-free-tactics-board aria-label="可自由拖动的七人首发战术板">
              <div class="chalk-pitch" aria-hidden="true"><i class="chalk-half"></i><i class="chalk-circle"></i><i class="chalk-box top"></i><i class="chalk-box bottom"></i></div>
              ${freeBoardZonesMarkup()}
              ${starters.map((player, index) => `<div class="board-drop-slot free-board-player" style="left:${boardPositions[index][0]}%;top:${boardPositions[index][1]}%">${tacticsMagnet(player, index, assignedLineupRole(player.id))}</div>`).join("")}
            </div>
            <div class="bench-board"><header><div><b>替补长凳</b></div>${benchFilterMarkup("hub-bench", true)}</header><div class="bench-magnets" id="hub-bench">${bench.length ? bench.map((player) => tacticsMagnet(player)).join("") : `<p>替补席为空</p>`}</div></div>
          </div>
          ${teamBondsMarkup(simulationStarters(starters))}
          ${teamChemistryMarkup(starters)}
          <div class="lineup-footer"><span></span><button class="secondary-button" id="edit-lineup">管理首发七人</button></div>
        </section>
        <aside class="side-stack">
          <section class="panel stage-card" data-stage="${run.stage}">
            <p class="kicker">NEXT OPPONENT</p><h3>${escapeHtml(run.opponent.name)}</h3><p>${tierName(run.stage)}第 ${((run.stage - 1) % 10) + 1} 轮</p>
            <div class="opponent-line"><span><small>对手评级</small><b>${run.opponent.rating}</b></span><span><small>对手阵型</small><b>${run.opponent.formation?.split("").join("-")}</b></span><span style="text-align:right"><small>预计战术</small><b>${TACTICS[run.opponent.tactic]?.name}</b></span></div>
            <button class="secondary-button wide" id="open-opponent-intel">查看阵型与球员能力</button>
          </section>
          <section class="panel control-card">
            <label class="field-label">系统识别阵型</label>
            <div class="detected-formation"><b>${detectedFormationLabel()}</b><small>结构 ${ratings.formation.coherence} · 攻势 ${ratings.formation.attackingNumbers} · 防守 ${ratings.formation.defensiveBalance}</small></div>
            <label class="field-label" for="tactic">比赛策略</label>
            <select class="select-control" id="tactic">${Object.entries(TACTICS).map(([key, item]) => `<option value="${key}" ${run.tactic === key ? "selected" : ""}>${item.name}</option>`).join("")}</select>
            <p class="tactic-note" id="tactic-note">${TACTICS[run.tactic].note}</p>
            <label class="field-label" for="tactics-rename-player">球员更名</label>
            <div class="tactics-rename-control"><select class="select-control" id="tactics-rename-player">${run.players.map((player) => `<option value="${escapeHtml(player.id)}">${ROLE_LABELS[player.role]} · ${escapeHtml(player.name)}</option>`).join("")}</select><button class="secondary-button wide" id="tactics-rename">修改所选球员名字</button></div>
            <button class="primary-button wide" id="start-match" ${starters.length !== TEAM_SIZE || !lineupIsValid(run) ? "disabled" : ""}>进入球场</button>
          </section>
        </aside>
      </div>
    </section>`;
  document.querySelector("#back-title").addEventListener("click", renderWelcome);
  document.querySelector("#open-club").addEventListener("click", renderSquadScreen);
  document.querySelector("#open-shop").addEventListener("click", renderShop);
  document.querySelector("#open-opponent-intel").addEventListener("click", openOpponentIntel);
  document.querySelector("#edit-lineup").addEventListener("click", openLineupEditor);
  document.querySelector("#tactics-rename").addEventListener("click", () => openRename(document.querySelector("#tactics-rename-player").value, renderHub));
  document.querySelector("#tactic").addEventListener("change", (event) => {
    run.tactic = event.target.value;
    saveRun();
    document.querySelector("#tactic-note").textContent = TACTICS[run.tactic].note;
  });
  document.querySelector("#start-match").addEventListener("click", startMatch);
  bindTacticsBoard(renderHub);
  bindBenchFilters(screen);
}

function inventoryCardGroups() {
  const rarityRank = { legendary: 4, epic: 3, rare: 2, common: 1 };
  const counts = run.inventory.reduce((map, id) => map.set(id, (map.get(id) ?? 0) + 1), new Map());
  return [...counts.entries()]
    .map(([id, count]) => ({ trait: getTrait(id), count }))
    .filter((item) => item.trait)
    .sort((a, b) => (rarityRank[b.trait.rarity] ?? 0) - (rarityRank[a.trait.rarity] ?? 0) || a.trait.name.localeCompare(b.trait.name, "zh-CN"));
}

function traitRoleLabels(trait) {
  return (trait.eligibleRoleGroups ?? ["ANY"])
    .map((role) => role === "ANY" ? "全位置" : ROLE_LABELS[role] ?? role)
    .join(" · ");
}

function traitBondNames(trait) {
  return inferTraitBondIds(trait, bondCatalog)
    .map((id) => bondCatalog.find((bond) => bond.id === id)?.name ?? id)
    .join(" · ") || "未加入羁绊";
}

function teamBondsMarkup(players = simulationStarters(), { compact = false } = {}) {
  const bonds = computeTeamBonds(players, catalog, bondCatalog);
  const activeCount = bonds.filter((bond) => bond.active).length;
  return `<section class="team-bonds-panel ${compact ? "compact" : ""}">
    <header><div><p class="kicker">TEAM BONDS</p><h3>球队羁绊</h3></div><span>${activeCount} 个已激活</span></header>
    <div class="team-bonds-grid">${bonds.length ? bonds.map((bond) => {
      const target = bond.nextThreshold ?? bond.thresholds.at(-1);
      const progress = Math.min(100, Math.round((bond.carriers / Math.max(1, target)) * 100));
      return `<article class="team-bond-card ${bond.active ? "active" : "building"}" data-bond-id="${bond.id}"><div class="bond-card-mark">${escapeHtml(bond.short)}</div><div class="bond-card-copy"><span><b>${escapeHtml(bond.name)}</b><strong>${bond.active ? `${bond.tier} 级` : `${bond.carriers}/${target}`}</strong></span><p>${escapeHtml(bond.description)}</p><i><em style="width:${progress}%"></em></i><small>${bond.active ? bondBonusText(bond.bonus, bond.effectText) : `再需 ${Math.max(0, target - bond.carriers)} 名不同首发球员携带`}</small></div></article>`;
    }).join("") : `<p class="team-bonds-empty">首发球员尚未携带可形成羁绊的特性卡。</p>`}</div>
  </section>`;
}

function traitCardMarkup(trait, { count = null, source = null, playerId = null, slotIndex = null, compact = false, locked = false } = {}) {
  const grade = traitGrade(trait.rarity);
  const sourceAttributes = source && !locked ? `draggable="true" data-trait-source="${source}"${playerId ? ` data-trait-player="${escapeHtml(playerId)}"` : ""}${slotIndex === null ? "" : ` data-trait-slot="${slotIndex}"`}` : "";
  const targetAttributes = source === "equipped" && !locked ? `data-trait-drop-player="${escapeHtml(playerId)}" data-trait-drop-index="${slotIndex}"` : "";
  return `<article class="rogue-trait-card rarity-${grade.toLowerCase()} ${compact ? "compact" : ""} ${locked ? "locked-trait-card" : ""}" tabindex="0" role="button" aria-label="查看特性卡 ${escapeHtml(trait.name)}" data-trait-card-id="${escapeHtml(trait.id)}" data-card-grade="${grade}" ${sourceAttributes} ${targetAttributes}>
    <div class="rogue-card-top"><span class="rogue-grade">${locked ? "锁" : grade}</span><small>${locked ? "先天固定" : count === null ? trait.category : `×${count}`}</small></div>
    <div class="rogue-card-sigil" aria-hidden="true">${grade}</div>
    <h3>${escapeHtml(trait.name)}</h3>
    <span class="trait-bond-chip">羁绊 · ${escapeHtml(traitBondNames(trait))}</span>
    <p>${escapeHtml(trait.summary)}</p>
    <footer><span>${escapeHtml(traitRoleLabels(trait))}</span>${(trait.tags ?? []).slice(0, 2).map((tag) => `<i>${escapeHtml(tag)}</i>`).join("")}</footer>
  </article>`;
}

function playerLoadoutSlots(player) {
  const limit = playerTraitSlotLimit(player);
  return Array.from({ length: limit }, (_, index) => {
    const entry = player.traits[index];
    const trait = entry ? getTrait(entry.id) : null;
    if (!trait) return `<div class="trait-slot-empty" data-trait-drop-player="${escapeHtml(player.id)}" data-trait-drop-index="${index}"><b>+</b><span>拖入特性卡</span></div>`;
    return traitCardMarkup(trait, { source: "equipped", playerId: player.id, slotIndex: index, compact: true, locked: Boolean(entry.innate || entry.locked) });
  }).join("");
}

function loadoutPlayerPiece(player, slotIndex = null, requiredRole = null, positionY = 50) {
  const isStarter = slotIndex !== null;
  const fit = playerPositionFit(player, requiredRole);
  const status = playerAvailabilityStatus(player);
  const gradePips = player.traits.map((entry) => getTrait(entry.id)).filter(Boolean).map((trait) => `<i class="grade-${traitGrade(trait.rarity).toLowerCase()}">${traitGrade(trait.rarity)}</i>`).join("");
  const special = substituteSpecialties(player).length > 0;
  return `<div class="loadout-player ${positionY < 34 ? "popover-below" : ""} ${status ? status.type === "suspension" ? "suspended" : "injured" : ""}" data-trait-player-target="${escapeHtml(player.id)}">
    <button type="button" class="loadout-player-token fit-${fit.key} ${special ? "special-substitute" : ""} ${status?.unavailable ? "unavailable" : ""}" data-board-player="${escapeHtml(player.id)}" data-player-position="${player.role}" data-player-group="${roleGroup(player.role)}" data-required-position="${requiredRole ?? ""}" ${isStarter ? `data-board-slot="${slotIndex}"` : ""} aria-label="${escapeHtml(player.name)}，${ROLE_LABELS[player.role]}，${fit.label}，体力${Math.round(playerValue(player, "fitness"))}，状态${playerCondition(player).label}${status ? `，${status.label}` : ""}">
      <span class="loadout-rating"><b>${playerOverall(player)}</b><small>能力</small></span>
      <span class="loadout-player-copy"><b>${escapeHtml(player.name)}</b><small>${status ? `${status.label} · ${status.matchesRemaining} 场` : `${ROLE_LABELS[requiredRole ?? player.role]} · ${fit.label}`}</small></span>
      <span class="loadout-token-side">${playerVitalsMarkup(player, true)}<span class="loadout-card-pips">${gradePips || `<i class="empty">+</i>`}</span></span>
      ${special ? substituteSpecialtyMarkup(player, true) : ""}
    </button>
    <section class="player-trait-popover" aria-label="${escapeHtml(player.name)}的已装备特性">
      <header><span><b>${escapeHtml(player.name)}</b><small>${status ? `${status.label} · 还需 ${status.matchesRemaining} 场` : `${ROLE_LABELS[player.role]} · ${FOOT_LABELS[player.preferredFoot]} · ${player.traits.length}/${playerTraitSlotLimit(player)} 卡槽${player.legendary ? ` · 传奇剩余 ${player.legendMatchesRemaining} 场` : ""}`}</small></span><em>${fit.label}</em></header>
      <div class="popover-vitals">${playerVitalsMarkup(player)}</div>
      <div class="player-trait-slots slots-${playerTraitSlotLimit(player)}">${playerLoadoutSlots(player)}</div>
    </section>
  </div>`;
}

function ensureTraitTooltip() {
  if (traitTooltip?.isConnected) return traitTooltip;
  traitTooltip = document.createElement("div");
  traitTooltip.className = "trait-hover-tooltip";
  traitTooltip.hidden = true;
  document.body.appendChild(traitTooltip);
  return traitTooltip;
}

function positionTraitTooltip(event) {
  if (!traitTooltip || traitTooltip.hidden) return;
  const padding = 16;
  const width = traitTooltip.offsetWidth;
  const height = traitTooltip.offsetHeight;
  let left = event.clientX + 18;
  let top = event.clientY + 18;
  if (left + width + padding > window.innerWidth) left = event.clientX - width - 18;
  if (top + height + padding > window.innerHeight) top = event.clientY - height - 18;
  traitTooltip.style.left = `${Math.max(padding, left)}px`;
  traitTooltip.style.top = `${Math.max(padding, top)}px`;
}

function showTraitTooltip(trait, event) {
  const tooltip = ensureTraitTooltip();
  tooltip.innerHTML = `<div><span>${traitGrade(trait.rarity)}</span><small>${escapeHtml(trait.category)}</small></div><h4>${escapeHtml(trait.name)}</h4><p>${escapeHtml(trait.summary)}</p><footer>${escapeHtml(traitBondNames(trait))} · ${escapeHtml(traitRoleLabels(trait))}</footer>`;
  tooltip.hidden = false;
  positionTraitTooltip(event);
}

function hideTraitTooltip() {
  if (traitTooltip) traitTooltip.hidden = true;
}

function openTraitCardDetail(traitId) {
  const trait = getTrait(traitId);
  if (!trait) return;
  hideTraitTooltip();
  const grade = traitGrade(trait.rarity);
  openModal(`<div class="trait-detail-modal rarity-${grade.toLowerCase()}">
    <div class="trait-detail-card"><div class="trait-detail-grade">${grade}</div><p class="kicker">${escapeHtml(trait.category)} · TRAIT CARD</p><h2>${escapeHtml(trait.name)}</h2><p class="trait-detail-summary">${escapeHtml(trait.summary)}</p><div class="trait-detail-meta"><span><small>羁绊分类</small><b>${escapeHtml(traitBondNames(trait))}</b></span><span><small>适用位置</small><b>${escapeHtml(traitRoleLabels(trait))}</b></span><span><small>协同标签</small><b>${(trait.tags ?? []).map(escapeHtml).join(" · ") || "无"}</b></span></div></div>
    <div class="button-row"><button class="primary-button" data-close-modal>收起卡牌</button></div>
  </div>`);
}

function completeTraitMove(message) {
  activeTraitDrag = null;
  traitDragGhost?.remove();
  traitDragGhost = null;
  document.body.classList.remove("trait-dragging");
  hideTraitTooltip();
  saveRun();
  renderSquadScreen();
  showToast(message);
}

function dropTraitIntoInventory(payload) {
  if (payload.source !== "equipped") return;
  const player = run.players.find((item) => item.id === payload.playerId);
  const entry = player?.traits[payload.slotIndex];
  if (!entry || entry.id !== payload.traitId) return showToast("这张卡已经不在原来的槽位");
  if (entry.innate || entry.locked) return showToast("先天特性已锁定，不能卸下或替换");
  player.traits.splice(payload.slotIndex, 1);
  run.inventory.push(entry.id);
  completeTraitMove(`「${getTrait(entry.id)?.name ?? "特性卡"}」已放回背包`);
}

function dropTraitOnPlayer(payload, targetPlayerId, requestedIndex = null) {
  const targetPlayer = run.players.find((item) => item.id === targetPlayerId);
  if (!targetPlayer) return;
  const movingTrait = getTrait(payload.traitId);
  if (!traitFitsPlayer(movingTrait, targetPlayer)) return showToast(`「${movingTrait?.name ?? "该特性"}」不适用于 ${targetPlayer.name} 的主位置或副位置`);
  const limit = playerTraitSlotLimit(targetPlayer);
  const targetIndex = requestedIndex === null ? targetPlayer.traits.length : Number(requestedIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= limit) return showToast("该球员的卡槽已满；请把卡拖到一张已装备卡上完成替换");
  const targetEntry = targetPlayer.traits[targetIndex] ?? null;
  if (targetEntry?.innate || targetEntry?.locked) return showToast("先天特性占用固定槽位，不能被替换");
  const duplicatesTarget = targetPlayer.traits.some((entry, index) => {
    const isOriginalSlot = payload.source === "equipped" && payload.playerId === targetPlayerId && index === payload.slotIndex;
    return entry.id === payload.traitId && index !== targetIndex && !isOriginalSlot;
  });
  if (duplicatesTarget) return showToast("同一名球员不能重复装备同一张特性卡");

  if (payload.source === "inventory") {
    const inventoryIndex = run.inventory.indexOf(payload.traitId);
    if (inventoryIndex < 0) return showToast("背包中已经没有这张卡");
    if (targetEntry?.id === payload.traitId) return showToast("这张卡已经装备在该槽位");
    run.inventory.splice(inventoryIndex, 1);
    const nextEntry = { id: payload.traitId, innate: false };
    if (targetEntry) {
      targetPlayer.traits[targetIndex] = nextEntry;
      run.inventory.push(targetEntry.id);
    } else {
      targetPlayer.traits.push(nextEntry);
    }
    return completeTraitMove(targetEntry ? `已为 ${targetPlayer.name} 更换特性卡` : `已为 ${targetPlayer.name} 装备特性卡`);
  }

  const sourcePlayer = run.players.find((item) => item.id === payload.playerId);
  const sourceEntry = sourcePlayer?.traits[payload.slotIndex];
  if (!sourceEntry || sourceEntry.id !== payload.traitId) return showToast("这张卡已经不在原来的槽位");
  if (sourceEntry.innate || sourceEntry.locked) return showToast("先天特性已锁定，不能移动");
  if (sourcePlayer.id === targetPlayer.id) {
    if (payload.slotIndex === targetIndex) return;
    if (targetEntry) {
      [sourcePlayer.traits[payload.slotIndex], sourcePlayer.traits[targetIndex]] = [sourcePlayer.traits[targetIndex], sourcePlayer.traits[payload.slotIndex]];
    } else {
      const [moved] = sourcePlayer.traits.splice(payload.slotIndex, 1);
      sourcePlayer.traits.push(moved);
    }
    return completeTraitMove(`已调整 ${sourcePlayer.name} 的卡牌顺序`);
  }
  if (targetEntry && sourcePlayer.traits.some((entry, index) => entry.id === targetEntry.id && index !== payload.slotIndex)) return showToast("交换后会产生重复特性，无法完成");
  if (targetEntry && !traitFitsPlayer(getTrait(targetEntry.id), sourcePlayer)) return showToast(`交换后的特性不适用于 ${sourcePlayer.name} 的主位置或副位置`);
  if (targetEntry) {
    sourcePlayer.traits[payload.slotIndex] = targetEntry;
    targetPlayer.traits[targetIndex] = sourceEntry;
  } else {
    sourcePlayer.traits.splice(payload.slotIndex, 1);
    targetPlayer.traits.push(sourceEntry);
  }
  completeTraitMove(targetEntry ? `已交换两名球员的特性卡` : `已把特性卡交给 ${targetPlayer.name}`);
}

function bindTraitCardInteractions(root = screen) {
  root.querySelectorAll("[data-trait-card-id]").forEach((card) => {
    const trait = getTrait(card.dataset.traitCardId);
    if (!trait) return;
    card.addEventListener("mouseenter", (event) => showTraitTooltip(trait, event));
    card.addEventListener("mousemove", positionTraitTooltip);
    card.addEventListener("mouseleave", hideTraitTooltip);
    card.addEventListener("focus", () => {
      const rect = card.getBoundingClientRect();
      showTraitTooltip(trait, { clientX: rect.right, clientY: rect.top });
    });
    card.addEventListener("blur", hideTraitTooltip);
    card.addEventListener("click", (event) => {
      event.stopPropagation();
      if (Date.now() - traitDragFinishedAt < 180) return;
      openTraitCardDetail(trait.id);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openTraitCardDetail(trait.id);
      }
    });
    if (!card.dataset.traitSource) return;
    card.addEventListener("dragstart", (event) => {
      activeTraitDrag = {
        source: card.dataset.traitSource,
        traitId: trait.id,
        playerId: card.dataset.traitPlayer ?? null,
        slotIndex: card.dataset.traitSlot === undefined ? null : Number(card.dataset.traitSlot),
      };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", trait.id);
      const rect = card.getBoundingClientRect();
      traitDragGhost?.remove();
      traitDragGhost = card.cloneNode(true);
      traitDragGhost.classList.add("trait-drag-ghost");
      traitDragGhost.style.width = `${rect.width}px`;
      document.body.appendChild(traitDragGhost);
      event.dataTransfer.setDragImage(traitDragGhost, rect.width / 2, Math.min(50, rect.height / 3));
      card.classList.add("dragging");
      document.body.classList.add("trait-dragging");
      hideTraitTooltip();
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document.body.classList.remove("trait-dragging");
      document.querySelectorAll(".trait-drop-over").forEach((target) => target.classList.remove("trait-drop-over"));
      document.querySelectorAll(".trait-drag-hover").forEach((target) => target.classList.remove("trait-drag-hover"));
      traitDragGhost?.remove();
      traitDragGhost = null;
      activeTraitDrag = null;
      traitDragFinishedAt = Date.now();
    });
  });

  root.querySelectorAll("[data-trait-drop-player]").forEach((target) => {
    target.addEventListener("dragover", (event) => { if (activeTraitDrag) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; target.classList.add("trait-drop-over"); } });
    target.addEventListener("dragleave", () => target.classList.remove("trait-drop-over"));
    target.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      target.classList.remove("trait-drop-over");
      if (activeTraitDrag) dropTraitOnPlayer(activeTraitDrag, target.dataset.traitDropPlayer, target.dataset.traitDropIndex);
    });
  });
  root.querySelectorAll("[data-trait-player-target]").forEach((target) => {
    target.addEventListener("dragover", (event) => { if (activeTraitDrag) { event.preventDefault(); target.classList.add("trait-drag-hover"); } });
    target.addEventListener("dragleave", (event) => { if (!target.contains(event.relatedTarget)) target.classList.remove("trait-drag-hover"); });
    target.addEventListener("drop", (event) => {
      event.preventDefault();
      target.classList.remove("trait-drag-hover");
      if (!event.target.closest("[data-trait-drop-player]") && activeTraitDrag) dropTraitOnPlayer(activeTraitDrag, target.dataset.traitPlayerTarget);
    });
  });
  const inventoryTarget = root.querySelector("[data-trait-inventory-drop]");
  inventoryTarget?.addEventListener("dragover", (event) => {
    if (activeTraitDrag?.source === "equipped") { event.preventDefault(); inventoryTarget.classList.add("trait-drop-over"); }
  });
  inventoryTarget?.addEventListener("dragleave", (event) => { if (!inventoryTarget.contains(event.relatedTarget)) inventoryTarget.classList.remove("trait-drop-over"); });
  inventoryTarget?.addEventListener("drop", (event) => {
    event.preventDefault();
    inventoryTarget.classList.remove("trait-drop-over");
    if (activeTraitDrag) dropTraitIntoInventory(activeTraitDrag);
  });
}

function renderSquadScreen() {
  stopRuntime();
  selectedBoardPlayerId = null;
  hideTraitTooltip();
  updateHeader();
  setActiveNav("loadout");
  const starters = getStarters();
  const bench = getBench();
  const positions = tacticsBoardPositions(starters);
  const inventoryCards = inventoryCardGroups();
  const categories = [...new Set(inventoryCards.map((item) => item.trait.category))];
  screen.innerHTML = `<section class="trait-loadout-screen">
    <header class="screen-head card-first-head"><div><p class="kicker">BUILD YOUR TEAM · BUILD YOUR DECK</p><h1>特性阵容</h1></div><div class="loadout-head-actions"><span><small>未装备</small><b>${run.inventory.length}</b></span><span><small>每人槽位</small><b>${traitSlotLimit()}</b></span><button class="primary-button" id="squad-start-match" ${starters.length !== TEAM_SIZE || !lineupIsValid(run) ? "disabled" : ""}>带着这套构筑比赛</button></div></header>
    <div class="trait-loadout-workbench">
      <section class="loadout-lineup-panel">
        <header class="loadout-panel-head"><div><p class="kicker">LEFT · FREE LINEUP</p><h2>球队阵容</h2></div><div class="compact-controls"><div class="detected-formation compact"><span>系统识别</span><b>${detectedFormationLabel()}</b></div><label><span>进攻策略</span><select id="loadout-tactic">${Object.entries(TACTICS).map(([key,item]) => `<option value="${key}" ${run.tactic === key ? "selected" : ""}>${item.name}</option>`).join("")}</select></label><button class="secondary-button" id="squad-precise">管理首发</button></div></header>
        <div class="loadout-pitch" data-free-tactics-board aria-label="可自由拖动的七人首发阵容结构图">
          <div class="chalk-pitch" aria-hidden="true"><i class="chalk-half"></i><i class="chalk-circle"></i><i class="chalk-box top"></i><i class="chalk-box bottom"></i></div>${freeBoardZonesMarkup()}
          ${starters.map((player, index) => `<div class="loadout-pitch-slot free-board-player" style="left:${positions[index][0]}%;top:${positions[index][1]}%">${loadoutPlayerPiece(player,index,assignedLineupRole(player.id),positions[index][1])}</div>`).join("")}
        </div>
        <section class="loadout-bench"><header><div><b>替补席</b><small>${bench.length} 名球员</small></div>${benchFilterMarkup("loadout-bench", true)}</header><div class="bench-magnets loadout-bench-list" id="loadout-bench">${bench.length ? bench.map((player) => loadoutPlayerPiece(player)).join("") : `<p>当前没有替补球员</p>`}</div></section>
        ${teamChemistryMarkup(starters)}
      </section>
      <aside class="loadout-right-stack">
        <section class="trait-deck-panel" data-trait-inventory-drop>
          <header class="loadout-panel-head"><div><p class="kicker">RIGHT · TRAIT DECK</p><h2>特性卡背包</h2></div><div class="deck-count"><b>${inventoryCards.length}</b><small>种卡牌</small></div></header>
          <div class="trait-deck-toolbar"><label><span>⌕</span><input id="trait-deck-search" type="search" placeholder="搜索名称、效果或标签" /></label><select id="trait-deck-rarity"><option value="all">全部等级</option><option value="A">A 传奇</option><option value="B">B 史诗</option><option value="C">C 稀有</option><option value="D">D 普通</option></select><select id="trait-deck-category"><option value="all">全部类型</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}</select></div>
          <div class="trait-deck-grid">${inventoryCards.length ? inventoryCards.map(({trait,count}) => `<div class="trait-deck-item" data-deck-card data-search="${escapeHtml(`${trait.name} ${trait.summary} ${(trait.tags ?? []).join(" ")}`.toLowerCase())}" data-rarity="${traitGrade(trait.rarity)}" data-category="${escapeHtml(trait.category)}">${traitCardMarkup(trait,{count,source:"inventory"})}</div>`).join("") : `<div class="deck-empty"><span>+</span><h3>背包暂时为空</h3><p>把球员身上的卡拖到这里即可卸下；新卡可从比赛奖励和商店获得。</p><button class="secondary-button" id="loadout-shop">前往卡牌商店</button></div>`}</div>
          <footer class="inventory-drop-hint"><span>↓</span><b>将已装备卡牌拖到这里卸下</b></footer>
          ${quickSellDockMarkup("拖入背包卡、后天卡或球员磁贴")}
        </section>
        ${teamBondsMarkup(simulationStarters(starters))}
      </aside>
    </div>
  </section>`;
  bindTacticsBoard(renderSquadScreen);
  bindBenchFilters(screen);
  bindTraitCardInteractions(screen);
  bindQuickSellDock(screen, renderSquadScreen);
  document.querySelector("#loadout-tactic").addEventListener("change", (event) => { run.tactic = event.target.value; saveRun(); renderSquadScreen(); });
  document.querySelector("#squad-precise").addEventListener("click", () => openLineupEditor(renderSquadScreen));
  document.querySelector("#squad-start-match").addEventListener("click", startMatch);
  document.querySelector("#loadout-shop")?.addEventListener("click", renderShop);
  const filterDeck = () => {
    const query = document.querySelector("#trait-deck-search").value.trim().toLowerCase();
    const rarity = document.querySelector("#trait-deck-rarity").value;
    const category = document.querySelector("#trait-deck-category").value;
    document.querySelectorAll("[data-deck-card]").forEach((card) => {
      card.hidden = !(card.dataset.search.includes(query) && (rarity === "all" || card.dataset.rarity === rarity) && (category === "all" || card.dataset.category === category));
    });
  };
  document.querySelector("#trait-deck-search")?.addEventListener("input", filterDeck);
  document.querySelector("#trait-deck-rarity")?.addEventListener("change", filterDeck);
  document.querySelector("#trait-deck-category")?.addEventListener("change", filterDeck);
}

function openLineupEditor(afterSave = renderHub) {
  const currentIds = [...run.lineupIds];
  openModal(`
    <div class="lineup-editor">
      <p class="kicker">STARTING SEVEN</p><h2>管理首发七人</h2>
      <p>这里只决定谁进入首发。保存后可在战术板把球员自由拖到门将、后场、中场和前场区域。</p>
      <div class="lineup-slot-list">
        ${Array.from({ length: TEAM_SIZE }, (_, index) => `<label class="lineup-slot"><span><b>${String(index + 1).padStart(2, "0")}</b><small>${currentIds[index] ? lineupZoneLabel(assignedLineupRole(currentIds[index])) : "首发"}</small></span><select class="select-control" data-lineup-slot="${index}">${run.players.map((player) => { const status = playerAvailabilityStatus(player); return `<option value="${player.id}" ${currentIds[index] === player.id ? "selected" : ""} ${status?.unavailable ? "disabled" : ""}>${escapeHtml(player.name)} · 本职 ${ROLE_LABELS[player.role]} · 综合 ${playerOverall(player)}${status ? ` · ${status.label}${status.unavailable ? "（不可出场）" : "（可带伤）"}` : ""}</option>`; }).join("")}</select></label>`).join("")}
      </div>
      <div class="button-row"><button class="primary-button" id="save-lineup">保存首发</button><button class="secondary-button" data-close-modal>取消</button></div>
    </div>`, () => document.querySelector("#save-lineup").addEventListener("click", () => {
      const ids = [...document.querySelectorAll("[data-lineup-slot]")].map((select) => select.value);
      if (ids.length !== TEAM_SIZE || new Set(ids).size !== TEAM_SIZE) return showToast("首发七人必须是七名不同球员");
      const unavailable = ids.map((id) => run.players.find((player) => player.id === id)).find((player) => player && isPlayerUnavailable(player));
      if (unavailable) return showToast(`${unavailable.name}${playerAvailabilityStatus(unavailable)?.label ?? "当前不可用"}，请调整首发`);
      const oldPositions = { ...run.lineupPositions };
      const nextPositions = {};
      ids.forEach((id, index) => {
        nextPositions[id] = oldPositions[id] ?? oldPositions[currentIds[index]];
      });
      run.lineupIds = ids;
      run.lineupPositions = nextPositions;
      ensureLineupPositions(run);
      saveRun();
      closeModal();
      afterSave();
      showToast("首发名单已更新");
    }));
}

function renderTeamInfo() {
  stopRuntime();
  updateHeader();
  setActiveNav("team");
  const starters = getStarters();
  const ratings = teamRatings(simulationStarters(starters), run.tactic, catalog, run.formation, { chemistry: teamChemistry(starters), bonds: bondCatalog });
  if (!run.players.some((player) => player.id === selectedClubPlayerId)) selectedClubPlayerId = starters[0]?.id ?? run.players[0]?.id;
  const player = run.players.find((item) => item.id === selectedClubPlayerId) ?? run.players[0];
  const selectedSlot = run.lineupIds.indexOf(player.id);
  const selectedRole = selectedSlot >= 0 ? assignedLineupRole(player.id) : null;
  const equipped = player.traits.map((entry) => getTrait(entry.id)).filter(Boolean);
  const averageOverall = Math.round(run.players.reduce((sum, item) => sum + playerOverall(item), 0) / Math.max(1, run.players.length));
  const averageFitness = Math.round(run.players.reduce((sum, item) => sum + playerValue(item, "fitness"), 0) / Math.max(1, run.players.length));
  const wins = run.history.filter((item) => item.won).length;
  const losses = run.history.length - wins;
  const equippedCount = run.players.reduce((sum, item) => sum + item.traits.length, 0);
  const personality = personalityObservation(player);
  const availability = playerAvailabilityStatus(player);
  const development = player.development;
  const nextDevelopmentThreshold = 90 + development.level * 25;
  const teamMental = Math.round(run.players.reduce((sum, item) => sum + playerValue(item, "mental"), 0) / Math.max(1, run.players.length));
  const teamPhysical = Math.round(run.players.reduce((sum, item) => sum + playerValue(item, "physical"), 0) / Math.max(1, run.players.length));
  const attributes = [
    ["进攻", playerValue(player, "attack")], ["传球", playerValue(player, "passing")], ["防守", playerValue(player, "defense")],
    ["速度", playerValue(player, "pace")], ["耐力", playerValue(player, "stamina")], ["冷静", playerValue(player, "composure")],
    ["侵略性", playerValue(player, "aggression")], ["守门", playerValue(player, "goalkeeping")], ["体能", playerValue(player, "fitness")],
    ["制空", playerValue(player, "aerial")], ["身体", playerValue(player, "physical")], ["精神", playerValue(player, "mental")],
  ];
  const teamMetrics = [["进攻", ratings.attack], ["组织", ratings.midfield], ["防守", ratings.defense], ["门将", ratings.goalkeeping]];
  screen.innerHTML = `<section class="team-info-screen">
    <header class="screen-head product-head"><div><p class="kicker">TEAM DATABASE</p><h1>球队信息</h1><p>这里集中显示球队和球员的实际数值；特性装备仍在“特性阵容”中完成。</p></div><button class="primary-button" id="team-to-loadout">前往特性阵容</button></header>
    <section class="team-value-strip">
      ${teamMetrics.map(([label,value]) => `<article><span>${label}</span><b>${value}</b><i><em style="width:${clamp(value,0,100)}%"></em></i></article>`).join("")}
      <article><span>全队平均</span><b>${averageOverall}</b><small>${run.players.length} 名球员</small></article>
      <article><span>平均体能</span><b>${averageFitness}</b><small>当前状态</small></article>
      <article><span>球队精神</span><b>${teamMental}</b><small>关键时刻与逆境表现</small></article>
      <article><span>身体基础</span><b>${teamPhysical}</b><small>对抗、疲劳与伤病抗性</small></article>
    </section>
    <div class="team-info-layout">
      <aside class="team-roster-panel">
        <header><div><p class="kicker">ROSTER</p><h2>${escapeHtml(run.name)}</h2></div><span>系统识别 ${detectedFormationLabel()}</span></header>
        <div class="team-record"><span><small>战绩</small><b>${wins} 胜 · ${losses} 负</b></span><span><small>战术</small><b>${TACTICS[run.tactic].name}</b></span><span><small>卡牌</small><b>${equippedCount} 装备 · ${run.inventory.length} 背包</b></span></div>
        <div class="team-roster-list">${run.players.map((item) => {
          const lineupIndex = run.lineupIds.indexOf(item.id);
          const itemStatus = playerAvailabilityStatus(item);
          return `<button class="team-roster-row ${item.id === player.id ? "active" : ""} ${itemStatus ? itemStatus.type === "suspension" ? "suspended" : "injured" : ""}" draggable="true" data-team-player="${escapeHtml(item.id)}" data-quick-sell-player="${escapeHtml(item.id)}"><span class="mini-role">${itemStatus ? itemStatus.type === "suspension" ? "禁" : "+" : ROLE_LABELS[item.role]}</span><span><b>${escapeHtml(item.name)}</b><small>${itemStatus ? `${itemStatus.label} · 剩余 ${itemStatus.matchesRemaining} 场` : lineupIndex >= 0 ? `首发 · ${lineupZoneLabel(assignedLineupRole(item.id))}` : "替补席"}${item.legendary ? ` · 传奇剩余 ${item.legendMatchesRemaining} 场` : ""}</small></span><i>${item.traits.length} 卡</i><strong>${playerOverall(item)}</strong></button>`;
        }).join("")}</div>
      </aside>
      <main class="player-value-sheet">
        <header class="player-value-hero"><div class="player-value-number">${availability ? availability.type === "suspension" ? "禁" : "+" : selectedSlot >= 0 ? selectedSlot + 1 : "B"}</div><div><p class="kicker">${availability ? availability.type === "suspension" ? "DISCIPLINARY SUSPENSION" : "MEDICAL WATCH" : selectedSlot >= 0 ? "STARTING SEVEN" : "BENCH"}</p><h2>${escapeHtml(player.name)}</h2><p>${ROLE_LABELS[player.role]} · ${FOOT_LABELS[player.preferredFoot]} · 副位置 ${ROLE_LABELS[player.secondaryRole] ?? "无"} · ${player.heightCm} CM · ${development.age} 岁</p><span class="player-scouting-profile">${escapeHtml(recruitmentProfile(player))}</span></div><div class="player-value-actions"><strong>${playerOverall(player)}<small>综合</small></strong><button class="secondary-button" id="team-info-rename">球员改名</button></div></header>
        <div class="player-value-context"><span><small>场上职责</small><b>${selectedRole ? ROLE_LABELS[selectedRole] : "替补待命"}</b></span><span><small>参赛状态</small><b>${availability ? `${availability.label} · ${availability.matchesRemaining} 场` : "可以出场"}</b></span><span><small>状态</small><b>${playerValue(player, "morale")} ${conditionArrowMarkup(player, true)}</b></span><span><small>性格观察</small><b>${escapeHtml(personality.label)}</b></span></div>
        <section class="player-values"><header><h3>球员具体数值</h3><small>所有数值均直接参与比赛模拟</small></header><div>${attributes.map(([label,value]) => `<article><span>${label}</span><i><em style="width:${clamp(value,0,100)}%"></em></i><b>${value}</b></article>`).join("")}</div></section>
        <section class="player-development-panel"><article><p class="kicker">PERSONALITY OBSERVATION</p><h3>${escapeHtml(personality.label)} · ${escapeHtml(personality.mentalBand)}</h3><p>${escapeHtml(personality.summary)}</p></article><article><p class="kicker">PLAYER DEVELOPMENT</p><h3>成长等级 ${development.level} · 潜力 ${development.potential}</h3><i><em style="width:${Math.min(100, Math.round((development.experience / nextDevelopmentThreshold) * 100))}%"></em></i><p>${development.experience}/${nextDevelopmentThreshold} 经验 · 已出场 ${development.matchesPlayed} 次</p></article></section>
        <section class="player-equipped-readonly"><header><h3>已装备特性卡</h3><small>${equipped.length}/${playerTraitSlotLimit(player)} 槽位</small></header><div>${equipped.length ? player.traits.map((entry) => ({ entry, trait: getTrait(entry.id) })).filter((item) => item.trait).map(({entry,trait}) => traitCardMarkup(trait,{compact:true,locked:Boolean(entry.innate || entry.locked)})).join("") : `<p>当前没有装备特性卡。</p>`}</div></section>
      </main>
    </div>
    ${quickSellDockMarkup("从左侧名单拖入球员")}
  </section>`;
  document.querySelector("#team-to-loadout").addEventListener("click", renderSquadScreen);
  document.querySelector("#team-info-rename").addEventListener("click", () => openRename(player.id, renderTeamInfo));
  document.querySelectorAll("[data-team-player]").forEach((button) => button.addEventListener("click", () => {
    selectedClubPlayerId = button.dataset.teamPlayer;
    renderTeamInfo();
  }));
  bindTraitCardInteractions(screen);
  bindQuickSellDock(screen, renderTeamInfo);
}

function renderClub(activeTab = "players") {
  stopRuntime();
  updateHeader();
  setActiveNav(activeTab === "traits" ? "bag" : "players");
  const inventoryCounts = run.inventory.reduce((map, id) => map.set(id, (map.get(id) ?? 0) + 1), new Map());
  const inventoryCards = [...inventoryCounts.entries()].map(([id, count]) => ({ trait: getTrait(id), count })).filter((item) => item.trait);
  const starters = new Set(run.lineupIds);
  if (activeTab === "players") {
    if (!run.players.some((player) => player.id === selectedClubPlayerId)) selectedClubPlayerId = getStarters()[0]?.id ?? run.players[0]?.id;
    const player = run.players.find((item) => item.id === selectedClubPlayerId);
    const equipped = player.traits.map((entry) => ({ ...entry, trait: getTrait(entry.id) })).filter((entry) => entry.trait);
    const playerSlot = run.lineupIds.indexOf(player.id);
    const requiredRole = playerSlot >= 0 ? assignedLineupRole(player.id) : null;
    const availability = playerAvailabilityStatus(player);
    screen.innerHTML = `<section><header class="screen-head product-head"><div><p class="kicker">PLAYER ROOM</p><h1>球员中心</h1><p>先看状态与位置，再决定特性和首发职责。</p></div><button class="primary-button" id="players-to-squad">前往阵容工作台</button></header>
      <div class="player-workspace">
        <aside class="panel roster-browser"><header><b>全部球员</b><span>${run.players.length}</span></header><div>${run.players.map((item) => { const status = playerAvailabilityStatus(item); return `<button class="roster-browser-row ${item.id === player.id ? "active" : ""} ${status ? status.type === "suspension" ? "suspended" : "injured" : ""}" data-select-club-player="${item.id}"><span class="mini-role">${status?.type === "suspension" ? "禁" : status ? "+" : ROLE_LABELS[item.role]}</span><span><b>${escapeHtml(item.name)}</b><small>${status ? `${status.label} · ${status.matchesRemaining} 场` : starters.has(item.id) ? `首发 · ${lineupZoneLabel(assignedLineupRole(item.id))}` : "替补"}</small></span><i><b style="width:${playerValue(item, "fitness")}%"></b></i><strong>${playerOverall(item)}</strong></button>`; }).join("")}</div></aside>
        <main class="panel player-dossier"><div class="dossier-hero"><span class="dossier-number">${availability?.type === "suspension" ? "禁" : availability ? "+" : playerSlot >= 0 ? playerSlot + 1 : "B"}</span><div><p class="kicker">${availability ? availability.type === "suspension" ? "DISCIPLINARY SUSPENSION" : "MEDICAL WATCH" : playerSlot >= 0 ? "STARTING SEVEN" : "BENCH PLAYER"}</p><h2>${escapeHtml(player.name)}</h2><span>${ROLE_LABELS[player.role]} · ${FOOT_LABELS[player.preferredFoot]} · 副位置 ${ROLE_LABELS[player.secondaryRole] ?? "无"} · ${player.heightCm} CM${availability ? ` · ${availability.label} ${availability.matchesRemaining} 场` : ""}</span></div><strong>${playerOverall(player)}<small>综合</small></strong></div>
          <div class="dossier-status"><span><small>体力</small><b>${playerValue(player, "fitness")}</b><i><em style="width:${playerValue(player, "fitness")}%"></em></i></span><span><small>状态</small><b>${playerValue(player, "morale")} ${conditionArrowMarkup(player, true)}</b><i><em style="width:${playerValue(player, "morale")}%"></em></i></span><span><small>当前位置</small><b>${requiredRole ? ROLE_LABELS[requiredRole] : "替补"}</b><i class="fit-text">${requiredRole ? playerPositionFit(player, requiredRole).label : "等待出场"}</i></span></div>
          <section class="dossier-section"><header><h3>能力雷达</h3><small>由统一的26项能力计算</small></header><div class="attribute-board">${[["进攻",playerValue(player,"attack")],["传球",playerValue(player,"passing")],["防守",playerValue(player,"defense")],["速度",playerValue(player,"pace")],["耐力",playerValue(player,"stamina")],["冷静",playerValue(player,"composure")],["守门",playerValue(player,"goalkeeping")]].map(([label,value]) => `<div><span>${label}</span><i><b style="width:${value}%"></b></i><strong>${value}</strong></div>`).join("")}</div></section>
          <section class="dossier-section"><header><h3>特性槽位</h3><small>${player.traits.length}/${playerTraitSlotLimit(player)} · 先天特性不可替换</small></header><div class="dossier-traits">${equipped.map((entry) => `<article class="${entry.innate ? "innate" : ""}"><span>${entry.innate ? "锁" : traitGrade(entry.trait.rarity)}</span><div><b>${escapeHtml(entry.trait.name)}</b><small>${escapeHtml(entry.trait.summary)}</small></div></article>`).join("")}${Array.from({length:Math.max(0,playerTraitSlotLimit(player)-equipped.length)},()=>`<article class="empty"><span>+</span><div><b>空槽位</b><small>从特性仓库装备卡牌</small></div></article>`).join("")}</div></section>
          <div class="dossier-actions"><button class="primary-button" id="dossier-traits">修改特性</button><button class="secondary-button" id="dossier-rename">球员改名</button></div>
        </main>
        <aside class="player-context"><section class="panel context-card"><p class="kicker">MATCH ROLE</p><h3>${playerSlot >= 0 ? `阵型 ${detectedFormationLabel()} · ${lineupZoneLabel(requiredRole)}` : "替补待命"}</h3><p>${escapeHtml(player.quirk)}</p></section><section class="panel context-card"><p class="kicker">LOADOUT EFFECT</p><h3>${equipped.length} 项特性生效</h3><div>${equipped.map((entry) => `<span><b>${entry.innate ? "先天" : traitGrade(entry.trait.rarity)}</b>${escapeHtml(entry.trait.name)}</span>`).join("")}</div><button class="text-button" id="context-bag">打开特性仓库</button></section></aside>
      </div></section>`;
    document.querySelectorAll("[data-select-club-player]").forEach((button) => button.addEventListener("click", () => { selectedClubPlayerId = button.dataset.selectClubPlayer; renderClub("players"); }));
    document.querySelector("#players-to-squad").addEventListener("click", renderSquadScreen);
    document.querySelector("#dossier-traits").addEventListener("click", () => openTraitManager(player.id));
    document.querySelector("#dossier-rename").addEventListener("click", () => openRename(player.id, () => renderClub("players")));
    document.querySelector("#context-bag").addEventListener("click", () => renderClub("traits"));
    return;
  }

  if (!inventoryCards.some((item) => item.trait.id === selectedBagTraitId)) selectedBagTraitId = inventoryCards[0]?.trait.id ?? null;
  const selectedItem = inventoryCards.find((item) => item.trait.id === selectedBagTraitId);
  const selectedTrait = selectedItem?.trait;
  screen.innerHTML = `<section><header class="screen-head product-head"><div><p class="kicker">TRAIT VAULT</p><h1>特性仓库</h1><p>按稀有度和类型浏览卡组，再把卡牌分配给最合适的球员。</p></div><div class="vault-count"><small>未装备卡牌</small><b>${run.inventory.length}</b></div></header>
    ${inventoryCards.length ? `<div class="vault-workspace"><main class="panel vault-browser"><div class="vault-toolbar"><label class="search-vault"><span>⌕</span><input id="vault-search" type="search" placeholder="搜索卡牌、效果或标签" /></label><select id="vault-rarity"><option value="all">全部等级</option><option value="D">D 普通</option><option value="C">C 稀有</option><option value="B">B 史诗</option><option value="A">A 传奇</option></select><select id="vault-category"><option value="all">全部类型</option>${[...new Set(inventoryCards.map((item)=>item.trait.category))].map((category)=>`<option value="${category}">${category}</option>`).join("")}</select></div><div class="vault-grid">${inventoryCards.map(({trait,count}) => `<button class="vault-card rarity-${traitGrade(trait.rarity).toLowerCase()} ${trait.id === selectedBagTraitId ? "selected" : ""}" data-vault-card="${trait.id}" data-search="${escapeHtml(`${trait.name} ${trait.summary} ${(trait.tags??[]).join(" ")}`.toLowerCase())}" data-rarity="${traitGrade(trait.rarity)}" data-category="${trait.category}"><span class="vault-grade">${traitGrade(trait.rarity)}</span><small>持有 ×${count}</small><h3>${escapeHtml(trait.name)}</h3><p>${escapeHtml(trait.summary)}</p><footer>${(trait.tags??[]).slice(0,3).map((tag)=>`<i>${escapeHtml(tag)}</i>`).join("")}</footer></button>`).join("")}</div></main>
      <aside class="panel vault-inspector"><div class="inspector-grade">${traitGrade(selectedTrait.rarity)}</div><p class="kicker">${selectedTrait.category} · 持有 ${selectedItem.count}</p><h2>${escapeHtml(selectedTrait.name)}</h2><p class="trait-full-copy">${escapeHtml(selectedTrait.summary)}</p><div class="bond-tags"><small>羁绊分类</small>${inferTraitBondIds(selectedTrait,bondCatalog).map((id)=>`<span>${escapeHtml(bondCatalog.find((bond)=>bond.id===id)?.name??id)}</span>`).join("") || "<span>未加入羁绊</span>"}</div><div class="eligible-roles"><small>适用位置</small>${selectedTrait.eligibleRoleGroups.map((role)=>`<span>${role === "ANY" ? "全位置" : ROLE_LABELS[role]}</span>`).join("")}</div><div class="synergy-tags"><small>协同标签</small>${(selectedTrait.tags??[]).map((tag)=>`<span>${escapeHtml(tag)}</span>`).join("")}</div><div class="equip-list"><header><b>装备给球员</b><small>优先显示位置适配</small></header>${[...run.players].sort((a,b)=>Number(traitFitsRole(selectedTrait,b.role))-Number(traitFitsRole(selectedTrait,a.role))).map((player)=>{const limit=playerTraitSlotLimit(player);const full=player.traits.length>=limit;const duplicate=player.traits.some((entry)=>entry.id===selectedTrait.id);return `<div><span class="mini-role">${ROLE_LABELS[player.role]}</span><span><b>${escapeHtml(player.name)}</b><small>${traitFitsRole(selectedTrait,player.role)?"适配":"低收益"} · ${player.traits.length}/${limit} 槽位</small></span><button class="${full||duplicate?"secondary-button":"primary-button"}" data-vault-equip="${player.id}" ${full||duplicate?"disabled":""}>${duplicate?"已拥有":full?"已满":"装备"}</button></div>`;}).join("")}</div></aside></div>` : `<div class="panel vault-empty"><span>0</span><h2>仓库目前是空的</h2><p>比赛奖励、商店直购和盲盒卡牌会出现在这里。</p><button class="primary-button" id="empty-shop">去商店补货</button></div>`}
  </section>`;
  document.querySelectorAll("[data-vault-equip]").forEach((button) => {
    const player = run.players.find((item) => item.id === button.dataset.vaultEquip);
    if (!selectedTrait || traitFitsPlayer(selectedTrait, player)) return;
    button.disabled = true;
    button.textContent = "不适用";
    const status = button.parentElement?.querySelector("small");
    if (status) status.textContent = `主位置 ${ROLE_LABELS[player.role]} · 副位置 ${ROLE_LABELS[player.secondaryRole] ?? "无"} · 不适用`;
  });
  document.querySelector("#empty-shop")?.addEventListener("click", renderShop);
  document.querySelectorAll("[data-vault-card]").forEach((button) => button.addEventListener("click", () => { selectedBagTraitId = button.dataset.vaultCard; renderClub("traits"); }));
  document.querySelectorAll("[data-vault-equip]").forEach((button) => button.addEventListener("click", () => equipTraitToPlayer(selectedTrait.id, button.dataset.vaultEquip)));
  const filterVault = () => { const query=document.querySelector("#vault-search").value.trim().toLowerCase();const rarity=document.querySelector("#vault-rarity").value;const category=document.querySelector("#vault-category").value;document.querySelectorAll("[data-vault-card]").forEach((card)=>{card.hidden=!(card.dataset.search.includes(query)&&(rarity==="all"||card.dataset.rarity===rarity)&&(category==="all"||card.dataset.category===category));}); };
  document.querySelector("#vault-search")?.addEventListener("input", filterVault);
  document.querySelector("#vault-rarity")?.addEventListener("change", filterVault);
  document.querySelector("#vault-category")?.addEventListener("change", filterVault);
}

function equipTraitToPlayer(traitId, playerId) {
  const player = run.players.find((item) => item.id === playerId);
  if (!player || player.traits.length >= playerTraitSlotLimit(player) || player.traits.some((entry) => entry.id === traitId)) return;
  const trait = getTrait(traitId);
  if (!traitFitsPlayer(trait, player)) return showToast(`「${trait?.name ?? "该特性"}」不适用于 ${player.name} 的主位置或副位置`);
  player.traits.push({ id: traitId, innate: false });
  removeOneInventoryCard(traitId);
  saveRun();
  renderClub("traits");
  showToast(`已装备给 ${player.name}`);
}

function removeOneInventoryCard(traitId) {
  const index = run.inventory.indexOf(traitId);
  if (index >= 0) run.inventory.splice(index, 1);
}

function traitSellPrice(trait) {
  return Math.max(30, Math.round((shopPrice(trait) * 0.45) / 10) * 10);
}

function playerSellPrice(player) {
  if (player.legendary) return 1200;
  return Math.max(120, Math.round((playerOverall(player) * 3.2) / 10) * 10);
}

function quickSellDockMarkup(note = "拖入卡牌或球员") {
  return `<section class="quick-sell-dock ${run.skipSellConfirmation ? "confirmation-skipped" : ""}" data-quick-sell-dock><span>↘</span><div><small>QUICK SELL</small><b>快捷出售</b><p>${note} · ${run.skipSellConfirmation ? "当前松手即售" : "松手后确认"}</p></div><div class="quick-sell-actions"><button type="button" data-open-bulk-sell>批量出售</button>${run.skipSellConfirmation ? `<button type="button" data-restore-sell-confirmation>恢复确认</button>` : ""}</div></section>`;
}

function saleConfirmationPreferenceMarkup() {
  return `<label class="sell-confirmation-preference"><input type="checkbox" id="skip-future-sell-confirmation" /><span><b>以后不再显示出售确认框</b><small>开启后拖入快捷出售区会立即成交；仍可在出售区恢复确认。</small></span></label>`;
}

function resolveTraitSale(payload) {
  const trait = getTrait(payload.traitId);
  if (!trait) return null;
  let entry = null;
  let player = null;
  if (payload.source === "equipped") {
    player = run.players.find((item) => item.id === payload.playerId);
    entry = player?.traits[payload.slotIndex];
    if (!entry || entry.id !== payload.traitId) return null;
    if (entry.innate || entry.locked) return { error: "先天特性不能被单独出售" };
  } else if (payload.source === "inventory" && !run.inventory.includes(payload.traitId)) {
    return null;
  }
  return { trait, player, price: traitSellPrice(trait) };
}

function completeTraitSale(payload, renderer = renderSquadScreen) {
  const sale = resolveTraitSale(payload);
  if (!sale || sale.error) return false;
  if (payload.source === "inventory") removeOneInventoryCard(payload.traitId);
  else {
    const currentPlayer = run.players.find((item) => item.id === payload.playerId);
    const currentEntry = currentPlayer?.traits[payload.slotIndex];
    if (!currentEntry || currentEntry.id !== payload.traitId || currentEntry.innate || currentEntry.locked) return false;
    currentPlayer.traits.splice(payload.slotIndex, 1);
  }
  run.gold += sale.price;
  saveRun();
  closeModal();
  renderer();
  showToast(`已出售「${sale.trait.name}」，获得 ${sale.price} G`);
  return true;
}

function requestQuickSellTrait(payload, renderer = renderSquadScreen) {
  const sale = resolveTraitSale(payload);
  if (!sale) return showToast("这张卡已经不在原来的位置");
  if (sale.error) return showToast(sale.error);
  if (run.skipSellConfirmation) return completeTraitSale(payload, renderer);
  openModal(`<div class="quick-sell-confirm"><p class="kicker">QUICK SELL · TRAIT</p><h2>出售「${escapeHtml(sale.trait.name)}」？</h2><p>${sale.player ? `这张后天特性会从 ${escapeHtml(sale.player.name)} 身上直接卸下并出售。` : "将从背包中出售 1 张；相同卡牌的其他副本不受影响。"}</p><div class="quick-sell-value"><span>${traitGrade(sale.trait.rarity)} 级特性卡</span><b>+${sale.price} G</b></div>${saleConfirmationPreferenceMarkup()}<div class="button-row"><button class="primary-button" id="confirm-quick-sell-trait">确认出售</button><button class="secondary-button" data-close-modal>取消</button></div></div>`, () => {
    document.querySelector("#confirm-quick-sell-trait").addEventListener("click", () => {
      run.skipSellConfirmation = document.querySelector("#skip-future-sell-confirmation").checked;
      completeTraitSale(payload, renderer);
    });
  });
}

function completePlayerSale(playerId, renderer = renderSquadScreen) {
  const current = run.players.find((item) => item.id === playerId);
  if (!current || run.players.length <= TEAM_SIZE) return false;
  const starterIndex = run.lineupIds.indexOf(playerId);
  const replacement = starterIndex >= 0 ? run.players.find((item) => item.id !== playerId && !run.lineupIds.includes(item.id)) : null;
  if (starterIndex >= 0 && !replacement) return false;
  current.traits.filter((entry) => !entry.innate && !entry.locked).forEach((entry) => run.inventory.push(entry.id));
  if (starterIndex >= 0) {
    run.lineupIds[starterIndex] = replacement.id;
    run.lineupPositions[replacement.id] = run.lineupPositions[playerId];
  }
  delete run.lineupPositions[playerId];
  run.players = run.players.filter((item) => item.id !== playerId);
  const price = playerSellPrice(current);
  run.gold += price;
  selectedClubPlayerId = run.lineupIds[0] ?? run.players[0]?.id ?? null;
  saveRun();
  closeModal();
  renderer();
  showToast(`已出售 ${current.name}，获得 ${price} G`);
  return true;
}

function requestQuickSellPlayer(playerId, renderer = renderSquadScreen) {
  const player = run.players.find((item) => item.id === playerId);
  if (!player) return;
  if (run.players.length <= TEAM_SIZE) return showToast(`至少要保留 ${TEAM_SIZE} 名球员，当前不能出售`);
  const price = playerSellPrice(player);
  const returnedTraits = player.traits.filter((entry) => !entry.innate && !entry.locked).length;
  if (run.skipSellConfirmation) return completePlayerSale(playerId, renderer) || showToast("没有可接替首发位置的球员");
  openModal(`<div class="quick-sell-confirm"><p class="kicker">QUICK SELL · PLAYER</p><h2>出售 ${escapeHtml(player.name)}？</h2><p>先天特性会随球员离队；${returnedTraits ? `${returnedTraits} 张可替换特性会自动回到背包。` : "没有可返还的后天特性。"}</p><div class="quick-sell-value"><span>${player.legendary ? `传奇球星 · 剩余 ${player.legendMatchesRemaining} 场` : `${ROLE_LABELS[player.role]} · 综合 ${playerOverall(player)}`}</span><b>+${price} G</b></div>${saleConfirmationPreferenceMarkup()}<div class="button-row"><button class="primary-button danger-button" id="confirm-quick-sell-player">确认出售球员</button><button class="secondary-button" data-close-modal>取消</button></div></div>`, () => {
    document.querySelector("#confirm-quick-sell-player").addEventListener("click", () => {
      run.skipSellConfirmation = document.querySelector("#skip-future-sell-confirmation").checked;
      if (!completePlayerSale(playerId, renderer)) showToast("没有可接替首发位置的球员");
    });
  });
}

function openBulkSell(renderer = renderSquadScreen) {
  const traitGroups = inventoryCardGroups();
  const benchPlayers = getBench();
  const playerLimit = Math.max(0, run.players.length - TEAM_SIZE);
  openModal(`<div class="bulk-sell-dialog"><p class="kicker">BULK SELL</p><h2>批量出售</h2><p>背包卡牌可以按数量出售；为保护有效首发，球员批量出售仅列出替补席。</p><div class="bulk-sell-grid"><section><header><b>特性卡背包</b><small>${run.inventory.length} 张</small></header><div class="bulk-sell-list">${traitGroups.length ? traitGroups.map(({ trait, count }) => `<label class="bulk-sell-row"><input type="checkbox" data-bulk-trait="${escapeHtml(trait.id)}" /><span><b>${escapeHtml(trait.name)}</b><small>${traitGrade(trait.rarity)} 级 · ${traitSellPrice(trait)} G/张</small></span><input type="number" min="1" max="${count}" value="${count}" data-bulk-trait-count="${escapeHtml(trait.id)}" /><em>×${count}</em></label>`).join("") : `<p class="bulk-sell-empty">背包中没有可出售卡牌。</p>`}</div></section><section><header><b>替补球员</b><small>最多出售 ${playerLimit} 人</small></header><div class="bulk-sell-list">${benchPlayers.length ? benchPlayers.map((player) => `<label class="bulk-sell-row player"><input type="checkbox" data-bulk-player="${escapeHtml(player.id)}" /><span><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.role]} · 综合 ${playerOverall(player)}${player.legendary ? " · 传奇" : ""}</small></span><strong>+${playerSellPrice(player)} G</strong></label>`).join("") : `<p class="bulk-sell-empty">替补席没有可出售球员。</p>`}</div></section></div><div class="bulk-sell-footer"><span>预计收入 <b id="bulk-sell-total">0 G</b></span><div class="button-row"><button class="primary-button danger-button" id="confirm-bulk-sell" disabled>出售所选内容</button><button class="secondary-button" data-close-modal>取消</button></div></div></div>`, () => {
    modal.classList.add("bulk-sell-modal");
    const update = () => {
      let total = 0;
      document.querySelectorAll("[data-bulk-trait]:checked").forEach((input) => {
        const trait = getTrait(input.dataset.bulkTrait);
        const countInput = document.querySelector(`[data-bulk-trait-count="${CSS.escape(input.dataset.bulkTrait)}"]`);
        total += traitSellPrice(trait) * Math.max(1, Number(countInput?.value ?? 1));
      });
      const selectedPlayers = [...document.querySelectorAll("[data-bulk-player]:checked")];
      if (selectedPlayers.length > playerLimit) {
        selectedPlayers.at(-1).checked = false;
        showToast(`至少保留 ${TEAM_SIZE} 名球员，本次最多出售 ${playerLimit} 人`);
        return update();
      }
      selectedPlayers.forEach((input) => { const player = run.players.find((item) => item.id === input.dataset.bulkPlayer); if (player) total += playerSellPrice(player); });
      document.querySelector("#bulk-sell-total").textContent = `${total} G`;
      document.querySelector("#confirm-bulk-sell").disabled = total <= 0;
    };
    document.querySelectorAll("[data-bulk-trait],[data-bulk-player],[data-bulk-trait-count]").forEach((input) => input.addEventListener("input", update));
    document.querySelector("#confirm-bulk-sell").addEventListener("click", () => {
      let total = 0;
      let soldCards = 0;
      const traitSales = [...document.querySelectorAll("[data-bulk-trait]:checked")].map((input) => ({ id: input.dataset.bulkTrait, count: Math.max(1, Number(document.querySelector(`[data-bulk-trait-count="${CSS.escape(input.dataset.bulkTrait)}"]`)?.value ?? 1)) }));
      traitSales.forEach(({ id, count }) => {
        const trait = getTrait(id);
        const available = run.inventory.filter((item) => item === id).length;
        const quantity = Math.min(count, available);
        for (let index = 0; index < quantity; index += 1) removeOneInventoryCard(id);
        total += traitSellPrice(trait) * quantity;
        soldCards += quantity;
      });
      const playerIds = [...document.querySelectorAll("[data-bulk-player]:checked")].map((input) => input.dataset.bulkPlayer).slice(0, playerLimit);
      let soldPlayers = 0;
      playerIds.forEach((id) => {
        const player = run.players.find((item) => item.id === id);
        if (!player || run.lineupIds.includes(id) || run.players.length <= TEAM_SIZE) return;
        player.traits.filter((entry) => !entry.innate && !entry.locked).forEach((entry) => run.inventory.push(entry.id));
        total += playerSellPrice(player);
        run.players = run.players.filter((item) => item.id !== id);
        delete run.lineupPositions[id];
        soldPlayers += 1;
      });
      if (!total) return;
      run.gold += total;
      saveRun();
      closeModal();
      renderer();
      showToast(`批量出售完成：${soldCards} 张卡牌、${soldPlayers} 名球员，获得 ${total} G`);
    });
  });
}

function bindQuickSellDock(root = screen, renderer = renderSquadScreen) {
  const dock = root.querySelector("[data-quick-sell-dock]");
  if (!dock) return;
  dock.querySelector("[data-open-bulk-sell]")?.addEventListener("click", (event) => { event.stopPropagation(); openBulkSell(renderer); });
  dock.querySelector("[data-restore-sell-confirmation]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    run.skipSellConfirmation = false;
    saveRun();
    renderer();
    showToast("出售确认框已恢复");
  });
  dock.addEventListener("dragover", (event) => {
    if (!activeTraitDrag && !activeQuickSellPlayerId) return;
    event.preventDefault();
    event.stopPropagation();
    dock.classList.add("drag-over");
    event.dataTransfer.dropEffect = "move";
  });
  dock.addEventListener("dragleave", () => dock.classList.remove("drag-over"));
  dock.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dock.classList.remove("drag-over");
    if (activeTraitDrag) requestQuickSellTrait({ ...activeTraitDrag }, renderer);
    else if (activeQuickSellPlayerId) requestQuickSellPlayer(activeQuickSellPlayerId, renderer);
  });
  root.querySelectorAll("[data-quick-sell-player]").forEach((source) => {
    source.addEventListener("dragstart", (event) => {
      activeQuickSellPlayerId = source.dataset.quickSellPlayer;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", activeQuickSellPlayerId);
    });
    source.addEventListener("dragend", () => {
      activeQuickSellPlayerId = null;
      dock.classList.remove("drag-over");
    });
  });
}

function equipInventoryTrait(traitId) {
  const target = document.querySelector(`[data-equip-target="${traitId}"]`);
  const player = run.players.find((item) => item.id === target?.value);
  if (!player) return;
  const trait = getTrait(traitId);
  if (!traitFitsPlayer(trait, player)) return showToast(`「${trait?.name ?? "该特性"}」不适用于 ${player.name} 的主位置或副位置`);
  if (player.traits.length >= playerTraitSlotLimit(player)) return showToast("该球员的特性槽位已满，请先替换或卸下后天特性");
  if (player.traits.some((entry) => entry.id === traitId)) return showToast("该球员已经拥有这项特性");
  player.traits.push({ id: traitId, innate: false });
  removeOneInventoryCard(traitId);
  saveRun();
  renderClub("traits");
  showToast(`已装备给 ${player.name}`);
}

function openTraitManager(playerId, preferredTraitId = null) {
  const player = run.players.find((item) => item.id === playerId);
  const entries = player.traits.map((entry, index) => ({ entry, index, trait: getTrait(entry.id) })).filter((item) => item.trait);
  const inventoryIds = [...new Set(run.inventory)].filter((id) => traitFitsPlayer(getTrait(id), player));
  const inventoryOptions = inventoryIds.map((id) => {
    const trait = getTrait(id);
    return `<option value="${id}" ${preferredTraitId === id ? "selected" : ""}>${traitGrade(trait.rarity)} · ${escapeHtml(trait.name)} · 主/副位置适配</option>`;
  }).join("");
  openModal(`
    <p class="kicker">TRAIT LOADOUT</p><h2>${escapeHtml(player.name)}的特性</h2><p>先天特性永久锁定。后天特性可以卸下或直接替换，卸下的卡会返回背包。</p>
    <div class="trait-manager-list">${entries.map(({ entry, index, trait }) => `<div class="trait-equipped-row"><span class="inventory-grade">${entry.innate ? "锁" : traitGrade(trait.rarity)}</span><span><b>${escapeHtml(trait.name)}</b><small>${entry.innate ? "先天特性 · 不可替换" : escapeHtml(trait.summary)}</small></span>${entry.innate ? `<i>固定</i>` : `<div><select class="select-control" data-replace-select="${index}" ${inventoryIds.length ? "" : "disabled"}>${inventoryOptions || `<option>背包无卡</option>`}</select><button class="secondary-button" data-replace-trait="${index}" ${inventoryIds.length ? "" : "disabled"}>替换</button><button class="text-button" data-remove-trait="${index}">卸下</button></div>`}</div>`).join("")}</div>
    ${player.traits.length < playerTraitSlotLimit(player) ? `<div class="trait-add-row"><select class="select-control" id="add-trait-select" ${inventoryIds.length ? "" : "disabled"}>${inventoryOptions || `<option>背包无卡</option>`}</select><button class="primary-button" id="add-trait" ${inventoryIds.length ? "" : "disabled"}>装备新特性</button></div>` : `<p>当前槽位已满（${player.traits.length}/${playerTraitSlotLimit(player)}）。</p>`}
    <div class="button-row"><button class="secondary-button" id="close-traits">完成</button></div>`, () => {
      document.querySelector("#close-traits").addEventListener("click", () => { closeModal(); renderClub("players"); });
      document.querySelector("#add-trait")?.addEventListener("click", () => {
        const id = document.querySelector("#add-trait-select").value;
        if (player.traits.some((entry) => entry.id === id)) return showToast("不能重复装备同一特性");
        player.traits.push({ id, innate: false }); removeOneInventoryCard(id); saveRun(); openTraitManager(playerId);
      });
      document.querySelectorAll("[data-remove-trait]").forEach((button) => button.addEventListener("click", () => {
        const index = Number(button.dataset.removeTrait); const [removed] = player.traits.splice(index, 1); run.inventory.push(removed.id); saveRun(); openTraitManager(playerId);
      }));
      document.querySelectorAll("[data-replace-trait]").forEach((button) => button.addEventListener("click", () => {
        const index = Number(button.dataset.replaceTrait);
        const nextId = document.querySelector(`[data-replace-select="${index}"]`).value;
        if (player.traits.some((entry, entryIndex) => entry.id === nextId && entryIndex !== index)) return showToast("不能重复装备同一特性");
        const oldId = player.traits[index].id;
        player.traits[index] = { id: nextId, innate: false };
        removeOneInventoryCard(nextId); run.inventory.push(oldId); saveRun(); openTraitManager(playerId);
      }));
    });
}

function shopPrice(trait) {
  return ({ common: 80, rare: 180, epic: 420, legendary: 900 })[trait.rarity] ?? 100;
}

function featuredShopCards() {
  const rng = createRng(`shop-${run.stage}-${run.shopOfferVersion ?? 0}`);
  const pool = [...catalog];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, 4);
}

function drawWeightedTrait(pool, rng) {
  const weights = { common: 62, rare: 27, epic: 9, legendary: 2 };
  const total = pool.reduce((sum, trait) => sum + (weights[trait.rarity] ?? 1), 0);
  let roll = rng() * total;
  for (const trait of pool) {
    roll -= weights[trait.rarity] ?? 1;
    if (roll <= 0) return trait;
  }
  return pool[0];
}

function generateShopTraitChoices() {
  const rng = createRng(`shop-trait-choice-${Date.now()}-${run.history.length}-${run.inventory.length}`);
  const pool = [...catalog];
  const choices = [];
  while (choices.length < 3 && pool.length) {
    const trait = drawWeightedTrait(pool, rng);
    choices.push(trait);
    pool.splice(pool.indexOf(trait), 1);
  }
  return choices;
}

function generatePlayerRewardChoices(rng, roles = ["GK", "DEF", "MID", "ATT"], pity = legendPitySettings(0, "shop")) {
  const choices = [];
  const names = new Set(run.players.map((player) => player.name));
  const reservedLegendIds = [];
  while (choices.length < 3) {
    const chance = pity.guaranteed && choices.length === 0 ? 1 : pity.chance;
    const legend = rollLegend(catalog, rng, run.usedLegendIds, reservedLegendIds, choices.length, chance);
    if (legend) {
      reservedLegendIds.push(legend.legendId);
      names.add(legend.name);
      choices.push(legend);
      continue;
    }
    const role = randomItem(roles, rng);
    const candidate = generateDraftChoices(role, catalog, rng, { stage: run.stage, usedNames: names }).find((player) => !names.has(player.name));
    if (!candidate) continue;
    names.add(candidate.name);
    choices.push(candidate);
  }
  return choices;
}

function generateShopPlayerChoices() {
  const rng = createRng(`shop-player-choice-${Date.now()}-${run.players.length}-${run.history.length}`);
  const pity = legendPitySettings(run.shopLegendPity, "shop");
  const choices = generatePlayerRewardChoices(rng, ["GK", "DEF", "MID", "ATT"], pity);
  const hit = choices.some((player) => player.legendary);
  run.pendingPlayerShopLegendInfo = { ...pity, hit };
  run.shopLegendPity = hit ? 0 : Math.min(LEGEND_PITY_LIMIT - 1, pity.misses + 1);
  return choices;
}

function legendPityCopy(info) {
  if (!info) return "传奇保底记录将在本轮开始后建立。";
  if (info.guaranteed) return `第 ${info.round}/${info.limit} 轮 · 本轮已触发传奇保底`;
  return `第 ${info.round}/${info.limit} 轮 · 每个候选位传奇率 ${Math.round(info.chance * 100)}%`;
}

function registerAcquiredPlayer(player) {
  player.traits.forEach((entry) => { if (entry.innate) entry.locked = true; });
  run.players.push(player);
  if (player.legendary && player.legendId && !run.usedLegendIds.includes(player.legendId)) run.usedLegendIds.push(player.legendId);
}

function playerLockedTraitsMarkup(player) {
  const traits = player.traits.map((entry) => getTrait(entry.id)).filter(Boolean);
  return traits.map((trait) => `<span><b>${escapeHtml(trait.name)}</b><small>${escapeHtml(trait.summary)}</small></span>`).join("");
}

function shopPlayerChoiceMarkup(player, index) {
  const trait = getTrait(player.traits[0]?.id);
  return `<article class="shop-player-choice shop-pick-option ${player.legendary ? "legend-player-choice" : ""}" tabindex="0" role="button" aria-selected="false" data-shop-player-choice="${index}" data-number="${index + 1}"><header><span class="mini-role">${player.legendary ? "传奇 · " : ""}${ROLE_LABELS[player.role]}</span><b>${playerOverall(player)}</b></header><div class="shop-player-identity"><small>${player.legendary ? `LEGEND · 限 ${player.legendMatchesRemaining} 场` : `候选 ${String(index + 1).padStart(2,"0")}`}</small><h3>${escapeHtml(player.name)}</h3><p>${ROLE_LABELS[player.role]} · ${FOOT_LABELS[player.preferredFoot]} · 副位置 ${ROLE_LABELS[player.secondaryRole] ?? "无"} · ${player.heightCm} CM</p><p class="shop-player-profile">${escapeHtml(recruitmentProfile(player))}</p></div><div class="shop-player-values"><span>进攻 <b>${playerValue(player,"attack")}</b></span><span>传球 <b>${playerValue(player,"passing")}</b></span><span>防守 <b>${playerValue(player,"defense")}</b></span><span>${player.role === "GK" ? "守门" : "速度"} <b>${playerValue(player,player.role === "GK" ? "goalkeeping" : "pace")}</b></span></div><footer><small>${player.legendary ? "3 张强力锁定特性" : "先天特性 · 永久锁定"}</small>${player.legendary ? `<div class="legend-locked-traits">${playerLockedTraitsMarkup(player)}</div>` : `<b>${escapeHtml(trait?.name ?? "无")}</b><p>${escapeHtml(trait?.summary ?? "")}</p>`}</footer><span class="shop-pick-hint">单击选择 · 双击直接签下</span></article>`;
}

function openTraitBlindBox() {
  if (!hasGold(110)) return showToast("资金不足");
  let choices = run.pendingTraitShopChoices.map(getTrait).filter(Boolean);
  if (choices.length !== 3) {
    choices = generateShopTraitChoices();
    run.pendingTraitShopChoices = choices.map((trait) => trait.id);
    saveRun();
  }
  let selected = null;
  openModal(`<div class="shop-choice-dialog"><p class="kicker">TRAIT BOX · PICK ONE</p><h2>特性盲盒三选一</h2><p>直接操作卡面：单击选择，双击立即购买；也可以选择后使用下方支付按钮。</p><div class="shop-choice-grid">${choices.map((trait,index) => `<section class="reward-choice shop-pick-option" tabindex="0" role="button" aria-selected="false" data-shop-trait-choice="${index}">${traitCardMarkup(trait)}<span class="shop-pick-hint">单击选择 · 双击购买</span></section>`).join("")}</div><div class="shop-choice-purchase"><button class="primary-button" id="claim-shop-trait" disabled>选择一张卡牌</button><button class="text-button" data-close-modal>暂不购买</button><small>购买后其余两张候选消失</small></div></div>`, () => {
    modal.classList.add("shop-choice-modal");
    const cards = [...document.querySelectorAll("[data-shop-trait-choice]")];
    const claimButton = document.querySelector("#claim-shop-trait");
    let purchasing = false;
    const selectChoice = (card) => {
      selected = choices[Number(card.dataset.shopTraitChoice)];
      cards.forEach((item) => {
        const active = item === card;
        item.classList.toggle("selected", active);
        item.setAttribute("aria-selected", String(active));
      });
      claimButton.disabled = false;
      claimButton.textContent = `支付 110 G · 购买「${selected.name}」`;
    };
    const purchase = () => {
      if (!selected || !hasGold(110)) return;
      if (purchasing) return;
      purchasing = true;
      spendGold(110);
      run.inventory.push(selected.id);
      run.pendingTraitShopChoices = [];
      saveRun();
      closeModal();
      renderShop();
      showToast(`已选择 ${traitGrade(selected.rarity)} 级「${selected.name}」`);
    };
    cards.forEach((card) => {
      card.querySelectorAll("[data-trait-card-id]").forEach((innerCard) => { innerCard.tabIndex = -1; });
      card.addEventListener("click", () => selectChoice(card));
      card.addEventListener("dblclick", (event) => { event.preventDefault(); selectChoice(card); purchase(); });
      card.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); selectChoice(card); } });
    });
    claimButton.addEventListener("click", purchase);
  });
}

function openPlayerBlindBox() {
  if (!hasGold(320)) return showToast("资金不足");
  let choices = run.pendingPlayerShopChoices.filter((player) => player?.id && player?.attributes);
  if (choices.length !== 3) {
    choices = generateShopPlayerChoices();
    run.pendingPlayerShopChoices = structuredClone(choices);
    saveRun();
  }
  if (!run.pendingPlayerShopLegendInfo) {
    const pity = legendPitySettings(run.shopLegendPity, "shop");
    const hit = choices.some((player) => player.legendary);
    run.pendingPlayerShopLegendInfo = { ...pity, hit };
    run.shopLegendPity = hit ? 0 : Math.min(LEGEND_PITY_LIMIT - 1, pity.misses + 1);
    saveRun();
  }
  let selected = null;
  openModal(`<div class="shop-choice-dialog"><p class="kicker">PLAYER BOX · PICK ONE</p><h2>球员盲盒三选一</h2><p>直接操作球员卡：单击选择，双击立即签下；也可以选择后使用下方支付按钮。</p><p class="legend-pity-note"><b>传奇追逐</b><span>${legendPityCopy(run.pendingPlayerShopLegendInfo)}</span></p><div class="shop-player-choice-grid">${choices.map(shopPlayerChoiceMarkup).join("")}</div><div class="shop-choice-purchase"><button class="primary-button" id="claim-shop-player" disabled>选择一名球员</button><button class="text-button" data-close-modal>暂不签约</button><small>签约后球员直接加入替补席</small></div></div>`, () => {
    modal.classList.add("shop-choice-modal");
    const cards = [...document.querySelectorAll("[data-shop-player-choice]")];
    const claimButton = document.querySelector("#claim-shop-player");
    let purchasing = false;
    const selectChoice = (card) => {
      selected = choices[Number(card.dataset.shopPlayerChoice)];
      cards.forEach((item) => {
        const active = item === card;
        item.classList.toggle("selected", active);
        item.setAttribute("aria-selected", String(active));
      });
      claimButton.disabled = false;
      claimButton.textContent = `支付 320 G · 签下 ${selected.name}`;
    };
    const purchase = () => {
      if (!selected || !hasGold(320)) return;
      if (purchasing) return;
      purchasing = true;
      spendGold(320);
      registerAcquiredPlayer(selected);
      run.pendingPlayerShopChoices = [];
      run.pendingPlayerShopLegendInfo = null;
      saveRun();
      closeModal();
      renderShop();
      showToast(`${selected.name} 已加入替补席`);
    };
    cards.forEach((card) => {
      card.addEventListener("click", () => selectChoice(card));
      card.addEventListener("dblclick", (event) => { event.preventDefault(); selectChoice(card); purchase(); });
      card.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); selectChoice(card); } });
    });
    claimButton.addEventListener("click", purchase);
  });
}

function renderShop() {
  stopRuntime(); normalizeRun(run); updateHeader(); setActiveNav("shop");
  const offerKey = `${run.stage}-${run.shopOfferVersion}`;
  const bought = run.shopBought[offerKey] ?? [];
  const offers = featuredShopCards();
  const shopLegendInfo = run.pendingPlayerShopLegendInfo ?? legendPitySettings(run.shopLegendPity, "shop");
  screen.innerHTML = `<section><header class="screen-head"><div><p class="kicker">CARD MARKET</p><h1>卡牌商店</h1><p>直售卡牌可以用赛后刷新次数重置；两种盲盒都采用随机三选一。</p></div><div class="shop-balance"><span><small>可用资金</small><b>${goldLabel()}</b></span><span><small>直售刷新</small><b>${shopRefreshLabel()} 次</b></span><button class="secondary-button" id="shop-back">返回特性阵容</button></div></header>
    <section class="shop-direct-sale"><header class="shop-section-head"><div><p class="kicker">DIRECT SALE</p><h2>本期特性卡直售</h2><span>每完成一场比赛获得 1 次刷新，可以累计；F8 开发者模式下无限。</span></div><button class="secondary-button" id="refresh-shop-offers" ${!canRefreshShop() ? "disabled" : ""}>刷新本期卡牌 · ${shopRefreshLabel()}</button></header><div class="shop-grid card-shop-grid">${offers.map((trait) => { const price = shopPrice(trait); const sold = bought.includes(trait.id); return `<section class="shop-card-v2">${traitCardMarkup(trait)}<button class="primary-button wide" data-buy-card="${trait.id}" ${sold ? "data-shop-sold" : ""} ${sold || !hasGold(price) ? "disabled" : ""}>${sold ? "已售出" : `${price} G · 收入背包`}</button></section>`; }).join("")}</div></section>
    <div class="shop-services"><article class="panel service-card"><p class="kicker">TRAIT BOX · PICK ONE</p><h2>特性盲盒三选一</h2><p>随机展示三张不重复的特性卡，从中选择一张收入背包。</p><button class="primary-button" id="shop-draw" ${!hasGold(110) ? "disabled" : ""}>110 G · 开启三选一</button></article><article class="panel service-card"><p class="kicker">PLAYER BOX · PICK ONE</p><h2>球员盲盒三选一</h2><p>${legendPityCopy(shopLegendInfo)}；普通球员来自 ${LOCALIZED_PLAYER_NAME_CAPACITY.total.toLocaleString("zh-CN")} 种译名组合与程序化能力模板，另有 ${LEGEND_PROFILES.length} 位传奇。</p><button class="primary-button" id="shop-scout" ${!hasGold(320) ? "disabled" : ""}>320 G · 开启三选一</button></article></div>
  </section>`;
  document.querySelector("#shop-back").addEventListener("click", renderSquadScreen);
  bindTraitCardInteractions(screen);
  document.querySelectorAll("[data-buy-card]").forEach((button) => button.addEventListener("click", () => {
    const trait = getTrait(button.dataset.buyCard); const price = shopPrice(trait);
    if (!hasGold(price)) return; spendGold(price); run.inventory.push(trait.id); run.shopBought[offerKey] = [...bought, trait.id]; saveRun(); renderShop(); showToast(`${trait.name} 已放入背包`);
  }));
  document.querySelector("#refresh-shop-offers").addEventListener("click", () => {
    if (!canRefreshShop()) return;
    if (!run.devMode) run.shopRefreshTokens -= 1;
    run.shopOfferVersion += 1;
    saveRun();
    renderShop();
    showToast(run.devMode ? "开发者模式：直售刷新次数无限" : `直售卡牌已刷新，剩余 ${run.shopRefreshTokens} 次`);
  });
  document.querySelector("#shop-draw").addEventListener("click", openTraitBlindBox);
  document.querySelector("#shop-scout").addEventListener("click", openPlayerBlindBox);
}

function openRename(playerId, afterSave = renderHub) {
  const player = run.players.find((item) => item.id === playerId);
  openModal(`
    <p class="kicker">PLAYER IDENTITY</p><h2>球衣背后写什么？</h2>
    <p>${escapeHtml(player.quirk)}</p>
    <label class="field-label" for="player-name">新名字（队内不可重复）</label>
    <input class="modal-input" id="player-name" maxlength="12" value="${escapeHtml(player.name)}" />
    <div class="button-row" style="margin-top:22px"><button class="primary-button" id="save-name">确认改名</button><button class="secondary-button" data-close-modal>取消</button></div>`,
  () => document.querySelector("#save-name").addEventListener("click", () => {
    const name = document.querySelector("#player-name").value.trim();
    if (!name) return showToast("名字不能为空");
    if (run.players.some((item) => item.id !== player.id && item.name === name)) return showToast("队里已经有人叫这个名字了");
    player.name = name;
    saveRun();
    closeModal();
    afterSave();
  }));
}

function startMatch() {
  const unavailable = getStarters().find(isPlayerUnavailable);
  if (unavailable) return showToast(`${unavailable.name}${playerAvailabilityStatus(unavailable)?.label ?? "当前不可用"}，请先调整首发`);
  if (getStarters().length !== TEAM_SIZE || !lineupIsValid(run)) {
    return showToast(getStarters().length !== TEAM_SIZE ? "首发必须正好有七人" : lineupShapeStatus(run).message || "当前首发阵型不合法");
  }
  prepareOpponent();
  const rng = createRng(`match-${run.stage}-${run.history.length}-${Date.now()}`);
  const weather = pickWeather(rng, gameConfig.weatherWeights);
  const homeRoster = simulationStarters();
  const awayRoster = run.opponent.squad.slice(0, TEAM_SIZE);
  const homeBench = getBench().filter((player) => !isPlayerUnavailable(player)).slice(0, 4);
  const awayBench = run.opponent.squad.slice(TEAM_SIZE);
  const match = createMatch(run, run.opponent, {
    weather,
    rng,
    seed: `match-engine-${run.stage}-${run.history.length}-${Date.now()}`,
    homeRoster,
    awayRoster,
    homeBench,
    awayBench,
    chemistry: teamChemistry(homeRoster),
    traitCatalog: catalog,
    bondDefinitions: bondCatalog,
    gameConfig,
  });
  runtime = {
    rng,
    match,
    ratings: teamRatings(homeRoster, run.tactic, catalog, run.formation, { chemistry: teamChemistry(homeRoster), bonds: bondCatalog }),
    homeBench,
    awayBench,
    playedIds: new Set(homeRoster.map((player) => player.id)),
    running: true,
    speed: 1,
    targetMinute: 0,
    lastTime: null,
    halftimeDone: false,
    extraAnnounced: false,
    lastMotionMinute: -1,
    lastMovementEvent: null,
    tokenPositions: [],
    visualTimers: [],
    eventAnimationUntil: 0,
    handlingInjury: false,
  };
  updateHeader();
  renderMatch();
  runtime.animationFrame = requestAnimationFrame(matchLoop);
}

function renderMatch() {
  const match = runtime.match;
  screen.innerHTML = `
    <section class="match-wrap">
      <div class="match-main">
        <header class="scoreboard">
          <span class="team-name">${escapeHtml(run.name)}</span>
          <span class="score-center"><span class="score" id="score">0 — 0</span><span class="clock" id="clock">00:00 · 上半场</span></span>
          <span class="team-name away">${escapeHtml(run.opponent.name)}</span>
        </header>
        <div class="pitch-frame">
          <div class="pitch" id="pitch"><i class="penalty-box left"></i><i class="penalty-box right"></i>${makeTokens()}<i class="ball" id="ball" style="left:50%;top:50%"></i></div>
          <div class="match-flash" id="match-flash">进球！</div>
          <div class="goal-celebration" id="goal-celebration"><span>GOAL</span><strong id="goal-player"></strong><small id="goal-assist"></small><i></i><i></i><i></i><i></i><i></i><i></i></div>
        </div>
        <div class="match-toolbar">
          <div class="button-row"><button class="secondary-button" id="pause-match">暂停与调整</button><span style="color:var(--muted);font-size:13px">标准比赛 3 分钟 · 中场自动暂停</span></div>
          <div class="speed-controls"><button class="speed-button active" data-speed="1">×1</button><button class="speed-button" data-speed="2">×2</button><button class="speed-button" data-speed="4">×4</button></div>
        </div>
        <section class="match-insights">
          <div id="match-bonds">${teamBondsMarkup(match.homeRoster, { compact: true })}</div>
          <div id="match-chemistry">${teamChemistryMarkup(match.homeRoster, true)}</div>
        </section>
        <section class="match-rosters" id="match-rosters">${matchRosterPanel()}</section>
      </div>
      <aside class="match-side">
        <section class="panel weather-card"><span><small>比赛天气 · ${match.weather.weight}%</small><b>${match.weather.name}</b>${match.weather.key === "storm" ? `<em>⚡ 雷击将导致固定伤停5场</em>` : ""}</span><span><small>本场主裁</small><b>${escapeHtml(match.referee.name)}</b></span><span class="weather-code">${match.weather.icon}</span></section>
        <section class="panel stats-card" id="match-stats"></section>
        <section class="panel feed-card"><header class="feed-head"><h3>场边记录</h3><small id="event-feed-count">0 条 · 可滚动回看</small></header><div class="event-feed" id="event-feed" role="log" aria-label="比赛场边记录"><div class="event empty">双方正在互相观察，顺便确认球门在哪边。</div></div></section>
      </aside>
    </section>`;
  document.querySelector("#pause-match").addEventListener("click", () => pauseMatch(false));
  document.querySelectorAll("[data-speed]").forEach((button) => button.addEventListener("click", () => {
    runtime.speed = Number(button.dataset.speed);
    document.querySelectorAll("[data-speed]").forEach((item) => item.classList.toggle("active", item === button));
  }));
  updateMatchUi();
  moveTokens(true);
}

function makeTokens() {
  return [...runtime.match.homeRoster, ...runtime.match.awayRoster].map((player, index) => `<i class="player-token ${index < TEAM_SIZE ? "home" : "away"}" data-token="${index}" data-player-id="${escapeHtml(player.id)}" title="${escapeHtml(player.name)}">${player.number ?? index % TEAM_SIZE + 1}</i>`).join("");
}

function rosterChips(players, emptyText, bench = false) {
  return players.length ? players.map((player) => {
    const special = bench && substituteSpecialties(player).length > 0;
    return `<span class="${special ? "special-substitute" : ""}"><b>${player.number ?? "·"}</b>${escapeHtml(player.name)}<small>${ROLE_LABELS[player.role]}</small>${special ? substituteSpecialtyMarkup(player, true) : ""}</span>`;
  }).join("") : `<em>${emptyText}</em>`;
}

function matchRosterPanel() {
  return `<div class="match-roster-team"><header><b>${escapeHtml(run.name)}</b><small>${detectedFormationLabel()} · ${TACTICS[run.tactic]?.name}</small></header><div class="roster-chips">${rosterChips(runtime.match.homeRoster, "暂无球员")}</div><footer><small>替补席</small><div class="roster-chips bench">${rosterChips(runtime.homeBench, "无替补", true)}</div></footer></div><div class="roster-divider">VS</div><div class="match-roster-team away"><header><b>${escapeHtml(run.opponent.name)}</b><small>${run.opponent.formation?.split("").join("-")} · ${TACTICS[run.opponent.tactic]?.name}</small></header><div class="roster-chips">${rosterChips(runtime.match.awayRoster, "暂无球员")}</div><footer><small>替补席</small><div class="roster-chips bench">${rosterChips(runtime.awayBench, "无替补", true)}</div></footer></div>`;
}

function matchBasePositions(players, home = true) {
  const groups = { GK: [], DEF: [], MID: [], ATT: [] };
  players.forEach((player, index) => {
    const role = roleGroup(player.assignedRole ?? player.role);
    groups[role].push(index);
  });
  const fallbackX = { GK: 8, DEF: 30, MID: 52, ATT: 76 };
  const fallback = [];
  Object.entries(groups).forEach(([role, indices]) => indices.forEach((playerIndex, groupIndex) => {
    const y = indices.length === 1 ? 50 : 20 + (60 * groupIndex) / Math.max(1, indices.length - 1);
    fallback[playerIndex] = [fallbackX[role], y];
  }));
  return players.map((player, index) => {
    const position = player.boardPosition
      ? [100 - player.boardPosition.y, player.boardPosition.x]
      : fallback[index];
    return home ? position : [100 - position[0], 100 - position[1]];
  });
}

function moveTokens(force = false, event = null) {
  if (!runtime) return;
  if (!force && performance.now() < runtime.eventAnimationUntil) return;
  const minute = Math.floor(runtime.match.minute);
  if (!force && !event && minute === runtime.lastMotionMinute) return;
  runtime.lastMotionMinute = minute;
  if (event) runtime.lastMovementEvent = event;
  const recentEvent = event ?? (runtime.lastMovementEvent && minute - runtime.lastMovementEvent.minute <= 3 ? runtime.lastMovementEvent : null);
  const home = matchBasePositions(runtime.match.homeRoster, true);
  const away = matchBasePositions(runtime.match.awayRoster, false);
  const bases = [...home, ...away];
  const foulEvent = recentEvent && ["foul", "card", "red"].includes(recentEvent.type);
  const possessionHome = recentEvent
    ? foulEvent ? recentEvent.side !== "home" : recentEvent.side === "home"
    : runtime.match.possession.home >= 50;
  const possessionOffset = possessionHome ? 0 : TEAM_SIZE;
  let carrierIndex = recentEvent && !foulEvent
    ? [...runtime.match.homeRoster, ...runtime.match.awayRoster].findIndex((player) => player.id === recentEvent.playerId)
    : -1;
  if (carrierIndex < 0 || (possessionHome ? carrierIndex >= TEAM_SIZE : carrierIndex < TEAM_SIZE)) {
    const possessionRoster = possessionHome ? runtime.match.homeRoster : runtime.match.awayRoster;
    let preferredIndex = possessionRoster.findIndex((player) => !runtime.match.sentOffIds?.includes(player.id) && ["DM", "AM", "LM", "RM", "LW", "RW", "ST"].includes(player.assignedRole ?? player.role));
    if (preferredIndex < 0) preferredIndex = possessionRoster.findIndex((player) => !runtime.match.sentOffIds?.includes(player.id));
    carrierIndex = possessionOffset + Math.max(0, preferredIndex);
  }
  const carrierBase = bases[carrierIndex] ?? [50, 50];
  const direction = possessionHome ? 1 : -1;
  const eventAdvance = recentEvent?.type === "counter" ? 18
    : recentEvent?.type === "attack" ? 12
      : recentEvent?.type === "corner" ? 20
        : recentEvent?.type === "duel" ? 4
          : 7;
  const targetX = clamp(carrierBase[0] + direction * eventAdvance, 7, 93);
  const targetY = recentEvent?.type === "corner" ? (carrierBase[1] < 50 ? 13 : 87) : carrierBase[1];
  const nextPositions = [];
  bases.forEach(([baseX, baseY], index) => {
    const token = document.querySelector(`[data-token="${index}"]`);
    if (!token) return;
    const tokenPlayer = index < TEAM_SIZE ? runtime.match.homeRoster[index] : runtime.match.awayRoster[index - TEAM_SIZE];
    const unavailableOnPitch = runtime.match.sentOffIds?.includes(tokenPlayer?.id) || runtime.match.injuredOutIds?.includes(tokenPlayer?.id);
    token.style.display = unavailableOnPitch ? "none" : "grid";
    token.classList.toggle("event-involved", Boolean(recentEvent?.playerId) && (index < TEAM_SIZE ? runtime.match.homeRoster[index]?.id : runtime.match.awayRoster[index - TEAM_SIZE]?.id) === recentEvent.playerId);
    const sameSide = possessionHome ? index < TEAM_SIZE : index >= TEAM_SIZE;
    const laneWave = Math.sin((minute + index * 2.4) * 0.34) * 1.8;
    const x = index === carrierIndex
      ? targetX
      : sameSide
        ? clamp(baseX + direction * (recentEvent ? 7 : 3) + (targetX - baseX) * 0.08, 5, 95)
        : clamp(baseX + (targetX - baseX) * 0.14, 5, 95);
    const y = index === carrierIndex
      ? targetY
      : clamp(baseY + (targetY - baseY) * (sameSide ? 0.1 : 0.16) + laneWave, 7, 93);
    nextPositions[index] = [x, y];
    token.style.left = `${x}%`;
    token.style.top = `${y}%`;
  });
  runtime.tokenPositions = nextPositions;
  const ball = document.querySelector("#ball");
  if (ball) {
    const [x, y] = nextPositions[carrierIndex] ?? [50, 50];
    ball.style.transitionDuration = ".7s";
    ball.style.left = `${x + (possessionHome ? 1.7 : -1.7)}%`;
    ball.style.top = `${y + 1}%`;
  }
}

function scheduleVisual(callback, delay) {
  const timer = setTimeout(callback, delay);
  runtime?.visualTimers.push(timer);
}

function playMatchEvent(event) {
  if (!runtime) return;
  runtime.lastMovementEvent = event;
  if (event.type === "lightning") {
    runtime.eventAnimationUntil = performance.now() + 950;
    const pitchFrame = document.querySelector(".pitch-frame");
    pitchFrame?.classList.remove("lightning-strike");
    void pitchFrame?.offsetWidth;
    pitchFrame?.classList.add("lightning-strike");
    flash(`⚡ ${event.playerName} 雷击重伤 · 伤停5场`);
    moveTokens(false, event);
    scheduleVisual(() => pitchFrame?.classList.remove("lightning-strike"), 900);
    return;
  }
  if (event.type === "injury") {
    runtime.eventAnimationUntil = performance.now() + 1050;
    flash(event.retired
      ? `✚ ${event.playerName} 生涯终结伤病`
      : `✚ ${event.playerName} ${event.causedByFoul ? "被踢伤" : INJURY_PROFILES[event.severity]?.label ?? "受伤"} · 预计伤停${event.matchesOut ?? 1}场`);
    moveTokens(false, event);
    if (event.side === "away") scheduleVisual(rebuildLiveMatchPitch, 700);
    return;
  }
  if (event.type === "substitution") {
    moveTokens(false, event);
    if (event.side === "away") scheduleVisual(rebuildLiveMatchPitch, 350);
    return;
  }
  if (!["goal", "save", "miss", "penalty-goal", "penalty-miss"].includes(event.type)) {
    moveTokens(false, event);
    return;
  }
  runtime.eventAnimationUntil = performance.now() + 1100;
  const allPlayers = [...runtime.match.homeRoster, ...runtime.match.awayRoster];
  const shooterIndex = allPlayers.findIndex((player) => player.id === event.playerId);
  const assistIndex = allPlayers.findIndex((player) => player.id === event.assistId);
  const attackingHome = event.side === "home";
  const shotX = attackingHome ? 86 : 14;
  const goalX = attackingHome ? 98 : 2;
  const shotY = 38 + runtime.rng() * 24;
  const shooter = document.querySelector(`[data-token="${shooterIndex}"]`);
  const assister = document.querySelector(`[data-token="${assistIndex}"]`);
  const ball = document.querySelector("#ball");
  if (!ball || shooterIndex < 0) return moveTokens(true);
  if (shooter) { shooter.style.left = `${shotX}%`; shooter.style.top = `${shotY}%`; }
  if (assister) { assister.style.left = `${attackingHome ? 67 : 33}%`; assister.style.top = `${shotY > 50 ? 30 : 70}%`; }
  const start = assistIndex >= 0 ? runtime.tokenPositions[assistIndex] : runtime.tokenPositions[shooterIndex];
  if (start) { ball.style.left = `${start[0]}%`; ball.style.top = `${start[1]}%`; }
  ball.style.transitionDuration = ".34s";
  requestAnimationFrame(() => {
    ball.style.left = `${shotX}%`;
    ball.style.top = `${shotY}%`;
  });
  scheduleVisual(() => {
    if (!runtime) return;
    ball.style.transitionDuration = ".42s";
    const missed = ["miss", "penalty-miss"].includes(event.type);
    ball.style.left = `${missed ? goalX : event.type === "save" ? (attackingHome ? 93 : 7) : goalX}%`;
    ball.style.top = `${missed ? (runtime.rng() < .5 ? 15 : 85) : 50}%`;
  }, 350);
  if (["goal", "penalty-goal"].includes(event.type)) scheduleVisual(() => showGoalCelebration(event), 650);
}

function showGoalCelebration(event) {
  const celebration = document.querySelector("#goal-celebration");
  const scoreboard = document.querySelector(".scoreboard");
  if (!celebration) return;
  document.querySelector("#goal-player").textContent = event.playerName;
  document.querySelector("#goal-assist").textContent = event.assistName ? `助攻 · ${event.assistName}` : "个人突破 · 无助攻";
  celebration.classList.remove("show");
  void celebration.offsetWidth;
  celebration.classList.add("show");
  scoreboard?.classList.add("goal-pulse");
  scheduleVisual(() => { celebration.classList.remove("show"); scoreboard?.classList.remove("goal-pulse"); moveTokens(true); }, 1500);
}

function matchLoop(timestamp) {
  if (!runtime) return;
  if (runtime.lastTime === null) runtime.lastTime = timestamp;
  const delta = Math.min(0.12, (timestamp - runtime.lastTime) / 1000);
  runtime.lastTime = timestamp;
  if (runtime.running) {
    runtime.targetMinute += delta * 0.5 * runtime.speed;
    const target = Math.floor(runtime.targetMinute);
    while (runtime.match.minute < target) {
      runtime.match.minute += 1;
      const event = simulateMinute(runtime.match, runtime.ratings, runtime.rng);
      runtime.homeBench = runtime.match.homeBench ?? runtime.homeBench;
      runtime.awayBench = runtime.match.awayBench ?? runtime.awayBench;
      runtime.match.homeRoster.forEach((player) => runtime.playedIds.add(player.id));
      if (event) playMatchEvent(event);
      else moveTokens();
      if (runtime.match.pendingInjury?.side === "home") {
        runtime.running = false;
        runtime.handlingInjury = true;
        updateMatchUi();
        scheduleVisual(showForcedInjuryModal, event?.type === "lightning" ? 950 : 600);
        break;
      }
      if (runtime.match.minute === 45 && !runtime.halftimeDone) {
        runtime.halftimeDone = true;
        runtime.running = false;
        updateMatchUi();
        pauseMatch(true);
        break;
      }
      if (runtime.match.minute === 90 && !runtime.extraAnnounced) {
        if (runtime.match.homeScore === runtime.match.awayScore) {
          runtime.extraAnnounced = true;
          runtime.match.phase = "extraTime";
          flash("加时赛！");
        } else {
          finishMatch();
          return;
        }
      }
      if (runtime.match.minute >= 120) {
        if (runtime.match.homeScore === runtime.match.awayScore) {
          const composure = runtime.match.homeRoster.reduce((sum, player) => sum + playerValue(player, "composure") * 0.62 + playerValue(player, "mental") * 0.28 + playerValue(player, "morale") * 0.1, 0) / Math.max(1, runtime.match.homeRoster.length);
          runtime.match.penalties = resolvePenaltyShootout(composure, run.opponent.rating, runtime.rng);
        }
        finishMatch();
        return;
      }
    }
    updateMatchUi();
  }
  runtime.animationFrame = requestAnimationFrame(matchLoop);
}

function updateMatchUi() {
  if (!runtime) return;
  const match = runtime.match;
  const clock = document.querySelector("#clock");
  const scoreValue = document.querySelector("#score");
  if (!clock || !scoreValue) return;
  const phase = match.minute < 45 ? "上半场" : match.minute < 90 ? "下半场" : "加时赛";
  clock.textContent = `${String(Math.floor(match.minute)).padStart(2,"0")}:00 · ${phase}`;
  scoreValue.textContent = `${match.homeScore} — ${match.awayScore}`;
  document.querySelector("#match-stats").innerHTML = `
    <small>实时数据</small>
    <div class="match-stat"><b>${match.possession.home}%</b><span>控球</span><b>${match.possession.away}%</b></div>
    <div class="match-stat"><b>${match.homeShots}</b><span>射门</span><b>${match.awayShots}</b></div>
    <div class="match-stat"><b>${match.homeXg.toFixed(2)}</b><span>预期进球</span><b>${match.awayXg.toFixed(2)}</b></div>
    <div class="match-stat"><b>${match.fouls.home}</b><span>犯规</span><b>${match.fouls.away}</b></div>
    <div class="match-stat"><b>${match.cards.home}</b><span>黄牌</span><b>${match.cards.away}</b></div>`;
  if (match.reds.home + match.reds.away > 0) {
    document.querySelector("#match-stats").insertAdjacentHTML("beforeend", `<div class="match-stat"><b>${match.reds.home}</b><span>红牌</span><b>${match.reds.away}</b></div>`);
  }
  if (match.penaltiesAwarded.home + match.penaltiesAwarded.away > 0) {
    document.querySelector("#match-stats").insertAdjacentHTML("beforeend", `<div class="match-stat"><b>${match.penaltiesAwarded.home}</b><span>点球</span><b>${match.penaltiesAwarded.away}</b></div>`);
  }
  if ((match.lightningHits?.home ?? 0) + (match.lightningHits?.away ?? 0) > 0) {
    document.querySelector("#match-stats").insertAdjacentHTML("beforeend", `<div class="match-stat lightning-stat"><b>${match.lightningHits.home}</b><span>雷击</span><b>${match.lightningHits.away}</b></div>`);
  }
  updateMatchFeed(match);
}

const MATCH_EVENT_MARKS = {
  goal: { icon: "⚽", label: "进球" },
  card: { icon: "■", label: "黄牌" },
  red: { icon: "■", label: "红牌" },
  foul: { icon: "!", label: "犯规" },
  "penalty-goal": { icon: "P", label: "点球命中" },
  "penalty-miss": { icon: "P", label: "点球罚失" },
  "penalty-awarded": { icon: "P", label: "判罚点球" },
  injury: { icon: "+", label: "伤病" },
  save: { icon: "◆", label: "扑救" },
  miss: { icon: "↗", label: "射偏" },
  substitution: { icon: "⇄", label: "换人" },
  corner: { icon: "⌜", label: "角球" },
  counter: { icon: "»", label: "反击" },
  duel: { icon: "◇", label: "对抗" },
  attack: { icon: "→", label: "推进" },
  "build-up": { icon: "·", label: "组织" },
  lightning: { icon: "⚡", label: "雷击" },
};

function matchEventMarkup(event) {
  const mark = MATCH_EVENT_MARKS[event.type] ?? { icon: "·", label: "比赛动态" };
  return `<div class="event ${escapeHtml(event.side ?? "neutral")} ${escapeHtml(event.type)} ${event.specialSubstitution ? "special-sub-event" : ""}">
    <b class="event-minute"><span>${event.minute}'</span><i class="event-mark mark-${escapeHtml(event.type)}" title="${mark.label}" aria-label="${mark.label}">${mark.icon}</i></b>
    <span>${escapeHtml(event.text)}</span>
  </div>`;
}

function updateMatchFeed(match) {
  const feed = document.querySelector("#event-feed");
  if (!feed) return;
  const count = match.events.length;
  const countLabel = document.querySelector("#event-feed-count");
  if (countLabel) countLabel.textContent = `${count} 条 · 可滚动回看`;
  if (feed.dataset.eventCount === String(count)) return;
  const firstRender = feed.dataset.eventCount === undefined;
  const previousTop = feed.scrollTop;
  const followingLatest = firstRender || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 42;
  feed.innerHTML = count
    ? match.events.map(matchEventMarkup).join("")
    : `<div class="event empty">双方正在互相观察，顺便确认球门在哪边。</div>`;
  feed.dataset.eventCount = String(count);
  feed.scrollTop = followingLatest ? feed.scrollHeight : previousTop;
}

function flash(text) {
  const element = document.querySelector("#match-flash");
  if (!element) return;
  element.textContent = text;
  element.classList.remove("show");
  void element.offsetWidth;
  element.classList.add("show");
}

function rebuildLiveMatchPitch() {
  const pitch = document.querySelector("#pitch");
  if (pitch) pitch.innerHTML = `<i class="penalty-box left"></i><i class="penalty-box right"></i>${makeTokens()}<i class="ball" id="ball" style="left:50%;top:50%"></i>`;
  const rosterPanel = document.querySelector("#match-rosters");
  if (rosterPanel) rosterPanel.innerHTML = matchRosterPanel();
  moveTokens(true);
}

function resumeAfterInjury() {
  if (!runtime) return;
  runtime.handlingInjury = false;
  closeModal();
  rebuildLiveMatchPitch();
  updateMatchUi();
  runtime.running = true;
  runtime.lastTime = performance.now();
}

function showForcedInjuryModal() {
  if (!runtime?.handlingInjury || !runtime.match.pendingInjury) return;
  const pending = runtime.match.pendingInjury;
  const injured = runtime.match.homeRoster.find((player) => player.id === pending.playerId);
  if (!injured) return;
  const canSubstitute = runtime.match.substitutions < SUBSTITUTION_LIMIT && runtime.homeBench.length > 0;
  const severityLabel = INJURY_PROFILES[pending.severity]?.label ?? "伤病";
  const outcome = pending.retired ? "队医确认这是生涯终结伤病，球员将在赛后退役。" : `预计伤停 ${pending.matchesOut ?? 1} 场。`;
  const source = pending.cause === "lightning"
    ? "雷击导致受伤，固定伤停 5 场。"
    : pending.causedByFoul
      ? `${pending.offender ? `${escapeHtml(pending.offender)} 的犯规` : "对手犯规"}导致受伤，裁判判罚概率已提高。`
      : "球员在比赛中出现常规伤病。";
  openModal(`
    <section class="forced-injury-dialog">
      <p class="kicker">MATCH STOPPED · INJURY</p>
      <h2>比赛暂停：必须换下 ${escapeHtml(injured.name)}</h2>
      <div class="forced-injury-summary"><strong>${escapeHtml(severityLabel)}</strong><span>${outcome}</span><small>${source}</small></div>
      ${canSubstitute ? `<div class="forced-injury-options"><span class="field-label">选择替补球员</span>${runtime.homeBench.map((player, index) => `<button type="button" class="forced-injury-player" data-forced-injury-sub="${escapeHtml(player.id)}" data-bench-index="${index}"><span>${ROLE_LABELS[player.role]}</span><b>${escapeHtml(player.name)}</b><small>综合 ${playerOverall(player)} · 体力 ${Math.round(playerValue(player, "fitness"))}</small></button>`).join("")}</div>` : `<div class="forced-injury-empty"><b>${runtime.homeBench.length ? "换人名额已经用完" : "替补席无人可换"}</b><span>受伤球员仍须离场，球队只能少一人继续比赛。</span></div>`}
      ${canSubstitute ? "" : `<div class="button-row"><button class="primary-button danger-button" id="continue-short-handed">确认少一人继续</button></div>`}
    </section>`,
  () => {
    modal.classList.add("forced-injury-modal");
    document.querySelectorAll("[data-forced-injury-sub]").forEach((button) => button.addEventListener("click", () => {
      const outIndex = runtime.match.homeRoster.findIndex((player) => player.id === pending.playerId);
      performMatchSubstitution(
        { playerId: pending.playerId, side: "field", index: outIndex },
        { playerId: button.dataset.forcedInjurySub, side: "bench", index: Number(button.dataset.benchIndex) },
        { resumeAfter: true },
      );
    }));
    document.querySelector("#continue-short-handed")?.addEventListener("click", () => {
      if (!continueSharedMatchShortHanded(runtime.match, pending.playerId)) return showToast("伤病状态已经变化，请重新确认");
      const event = {
        id: `${Math.floor(runtime.match.minute)}-short-handed-${runtime.match.timeline.length + 1}`,
        minute: Math.floor(runtime.match.minute), side: "home", type: "substitution", playerId: pending.playerId,
        playerName: injured.name, score: { home: runtime.match.homeScore, away: runtime.match.awayScore },
        text: `${injured.name} 受伤离场，球队少一人继续比赛`,
      };
      runtime.match.events.push(event);
      runtime.match.timeline.push(event);
      resumeAfterInjury();
    });
  }, false);
}

function pauseMatch(halftime) {
  if (!runtime) return;
  runtime.running = false;
  openModal(`
    <p class="kicker">${halftime ? "HALF TIME" : "TOUCHLINE PAUSE"}</p>
    <h2>${halftime ? "中场休息" : "比赛已暂停"}</h2>
    <p>${halftime ? "球员喝水，教练可以假装刚才的一切都在计划之中。" : "比赛时间不会流动。你可以调整进攻策略或完成换人。"}</p>
    <div class="modal-grid">
      <div><span class="field-label">系统识别阵型</span><div class="detected-formation"><b>${detectedFormationLabel()}</b><small>站位在赛前战术板自由调整</small></div></div>
      <label><span class="field-label">比赛策略</span><select class="select-control" id="pause-tactic">${Object.entries(TACTICS).map(([key, item]) => `<option value="${key}" ${run.tactic === key ? "selected" : ""}>${item.name}</option>`).join("")}</select></label>
    </div>
    ${substitutionControls()}
    <div class="button-row"><button class="primary-button" id="resume-match">应用并继续</button></div>`,
  () => {
    modal.classList.add("match-pause-modal");
    bindMatchSubstitutionBoard();
    document.querySelector("#resume-match").addEventListener("click", applyPauseChanges);
  }, false);
}

function matchSubstitutionMagnet(player, side, index, requiredRole = null) {
  const locked = runtime.match.substitutions >= SUBSTITUTION_LIMIT;
  const fit = playerPositionFit(player, requiredRole);
  const special = side === "bench" && substituteSpecialties(player).length > 0;
  return `<button type="button" class="match-sub-magnet fit-${fit.key} ${special ? "special-substitute" : ""} ${locked ? "locked" : ""}" data-match-sub-player="${escapeHtml(player.id)}" data-match-sub-side="${side}" data-match-sub-index="${index}" data-player-position="${player.role}" data-player-group="${roleGroup(player.role)}" data-required-position="${requiredRole ?? ""}" draggable="${locked ? "false" : "true"}" aria-label="${escapeHtml(player.name)}，${side === "field" ? "场上" : "替补"}球员，拖动完成换人"><span>${side === "field" ? index + 1 : "B"}</span><b>${escapeHtml(player.name)}</b><small>${ROLE_LABELS[player.role]} · ${FOOT_LABELS[player.preferredFoot]}</small>${special ? substituteSpecialtyMarkup(player, true) : ""}</button>`;
}

function substitutionControls() {
  const bench = runtime.homeBench;
  const positions = matchBasePositions(runtime.match.homeRoster, true).map(([x, y]) => [y, 100 - x]);
  const slots = runtime.match.homeRoster.map((player) => player.assignedRole ?? assignedLineupRole(player.id));
  return `<section class="match-substitution-board" id="match-substitution-board">
    <header><div><span class="field-label">磁贴换人</span><b>把替补拖到要换下的场上球员</b></div><strong>${runtime.match.substitutions}<small>/ ${SUBSTITUTION_LIMIT}</small></strong></header>
    ${bench.length ? `<div class="match-substitution-layout">
      <div class="match-sub-pitch"><div class="chalk-pitch" aria-hidden="true"><i class="chalk-half"></i><i class="chalk-circle"></i><i class="chalk-box top"></i><i class="chalk-box bottom"></i></div>${runtime.match.homeRoster.map((player,index) => `<div class="match-sub-field-slot" style="left:${positions[index][0]}%;top:${positions[index][1]}%"><em>${ROLE_LABELS[slots[index]]}</em>${matchSubstitutionMagnet(player,"field",index,slots[index])}</div>`).join("")}</div>
      <aside class="match-sub-bench"><header><div><b>替补席</b><small>${bench.length} 人</small></div>${benchFilterMarkup("match-sub-bench", true)}</header><div id="match-sub-bench">${bench.map((player,index) => matchSubstitutionMagnet(player,"bench",index)).join("")}</div></aside>
    </div>` : `<div class="match-sub-empty">替补席为空，本场无法换人。</div>`}
    <p class="match-sub-help">${runtime.match.substitutions >= SUBSTITUTION_LIMIT ? "本场换人名额已经用完。" : "拖动场上球员到替补也可以完成同一操作；每次交换消耗一个换人名额。"}</p>
  </section>`;
}

function performMatchSubstitution(source, target, options = {}) {
  if (!runtime || runtime.match.substitutions >= SUBSTITUTION_LIMIT || source.side === target.side) return false;
  const fieldPayload = source.side === "field" ? source : target;
  const benchPayload = source.side === "bench" ? source : target;
  const outIndex = Number(fieldPayload.index);
  const inIndex = Number(benchPayload.index);
  const outgoing = runtime.match.homeRoster[outIndex];
  const incoming = runtime.homeBench[inIndex];
  if (!outgoing || !incoming || outgoing.id !== fieldPayload.playerId || incoming.id !== benchPayload.playerId) { showToast("换人磁贴已经发生变化，请重新拖动"); return false; }
  const forcedPending = runtime.match.pendingInjury?.side === "home" && runtime.match.pendingInjury.playerId === outgoing.id;
  if (runtime.match.pendingInjury && !forcedPending) { showToast("必须先换下受伤球员"); return false; }
  if (!applySharedMatchSubstitution(runtime.match, outgoing.id, incoming.id)) { showToast("共享七人制模型拒绝了这次换人，请重新选择"); return false; }
  incoming.assignedRole = outgoing.assignedRole ?? assignedLineupRole(outgoing.id);
  incoming.boardPosition = outgoing.boardPosition ? { ...outgoing.boardPosition } : { ...run.lineupPositions[outgoing.id] };
  runtime.match.homeRoster[outIndex] = incoming;
  if (forcedPending) runtime.homeBench.splice(inIndex, 1);
  else runtime.homeBench[inIndex] = outgoing;
  runtime.playedIds.add(incoming.id);
  runtime.match.substitutions += 1;
  runtime.ratings = teamRatings(runtime.match.homeRoster, run.tactic, catalog, run.formation, { chemistry: teamChemistry(runtime.match.homeRoster), bonds: bondCatalog });
  const substitutionEvent = {
    id: `${Math.floor(runtime.match.minute)}-substitution-${runtime.match.timeline.length + 1}`,
    minute: Math.floor(runtime.match.minute),
    side: "home",
    type: "substitution",
    playerId: incoming.id,
    playerName: incoming.name,
    playerOutId: outgoing.id,
    playerInId: incoming.id,
    score: { home: runtime.match.homeScore, away: runtime.match.awayScore },
    specialSubstitution: substituteSpecialties(incoming).length > 0,
    text: `${forcedPending ? "伤病换人 · " : ""}${substituteSpecialties(incoming).length ? "✨ " : ""}${incoming.name}${substituteSpecialties(incoming)[0] ? `（${substituteSpecialties(incoming)[0].label}）` : ""} 换下 ${outgoing.name}`,
  };
  runtime.match.events.push(substitutionEvent);
  runtime.match.timeline.push(substitutionEvent);
  const board = document.querySelector("#match-substitution-board");
  if (board) board.outerHTML = substitutionControls();
  const bondPanel = document.querySelector("#match-bonds");
  if (bondPanel) bondPanel.innerHTML = teamBondsMarkup(runtime.match.homeRoster, { compact: true });
  const chemistryPanel = document.querySelector("#match-chemistry");
  if (chemistryPanel) chemistryPanel.innerHTML = teamChemistryMarkup(runtime.match.homeRoster, true);
  const rosterPanel = document.querySelector("#match-rosters");
  if (rosterPanel) rosterPanel.innerHTML = matchRosterPanel();
  bindMatchSubstitutionBoard();
  showToast(`${incoming.name} 换下 ${outgoing.name}`);
  if (forcedPending || options.resumeAfter) resumeAfterInjury();
  return true;
}

function bindMatchSubstitutionBoard() {
  bindBenchFilters(modal);
  document.querySelectorAll("[data-match-sub-player]").forEach((magnet) => {
    magnet.addEventListener("dragstart", (event) => {
      if (runtime.match.substitutions >= SUBSTITUTION_LIMIT) return event.preventDefault();
      activeMatchSubDrag = { playerId: magnet.dataset.matchSubPlayer, side: magnet.dataset.matchSubSide, index: Number(magnet.dataset.matchSubIndex) };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", activeMatchSubDrag.playerId);
      magnet.classList.add("dragging");
      highlightMatchSubstitutionTargets(activeMatchSubDrag);
    });
    magnet.addEventListener("dragover", (event) => {
      if (!activeMatchSubDrag || activeMatchSubDrag.side === magnet.dataset.matchSubSide) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      magnet.classList.add("drag-over");
    });
    magnet.addEventListener("dragleave", () => magnet.classList.remove("drag-over"));
    magnet.addEventListener("drop", (event) => {
      event.preventDefault();
      magnet.classList.remove("drag-over");
      if (!activeMatchSubDrag) return;
      performMatchSubstitution(activeMatchSubDrag, { playerId: magnet.dataset.matchSubPlayer, side: magnet.dataset.matchSubSide, index: Number(magnet.dataset.matchSubIndex) });
      activeMatchSubDrag = null;
    });
    magnet.addEventListener("dragend", () => {
      magnet.classList.remove("dragging");
      document.querySelectorAll(".match-sub-magnet.drag-over").forEach((item) => item.classList.remove("drag-over"));
      clearPositionHighlights();
      activeMatchSubDrag = null;
    });
  });
}

function highlightMatchSubstitutionTargets(source) {
  clearPositionHighlights();
  const sourcePlayer = source.side === "field" ? runtime.match.homeRoster[source.index] : runtime.homeBench[source.index];
  if (!sourcePlayer) return;
  const requiredPosition = source.side === "field"
    ? runtime.match.homeRoster[source.index].assignedRole
    : null;
  document.querySelectorAll(".match-sub-magnet").forEach((item) => {
    if (item.dataset.matchSubSide === source.side) return;
    const candidate = source.side === "field"
      ? runtime.homeBench[Number(item.dataset.matchSubIndex)]
      : sourcePlayer;
    const targetPosition = source.side === "field" ? requiredPosition : item.dataset.requiredPosition;
    if (!candidate || !targetPosition) return;
    const score = roleFitScore(candidate, targetPosition);
    if (candidate.role === targetPosition) item.classList.add("position-match");
    else if (score >= 0.87) item.classList.add("position-secondary");
  });
}

function applyPauseChanges() {
  run.tactic = document.querySelector("#pause-tactic").value;
  updateSharedMatchTactic(runtime.match, run.tactic);
  runtime.ratings = teamRatings(runtime.match.homeRoster, run.tactic, catalog, run.formation, { chemistry: teamChemistry(runtime.match.homeRoster), bonds: bondCatalog });
  saveRun();
  closeModal();
  runtime.running = true;
  runtime.lastTime = performance.now();
  const pitch = document.querySelector("#pitch");
  if (pitch) pitch.innerHTML = `<i class="penalty-box left"></i><i class="penalty-box right"></i>${makeTokens()}<i class="ball" id="ball" style="left:50%;top:50%"></i>`;
  const rosterPanel = document.querySelector("#match-rosters");
  if (rosterPanel) rosterPanel.innerHTML = matchRosterPanel();
  moveTokens(true);
}

function forceDeveloperVictory(match) {
  if (!run.devMode || match.homeScore > match.awayScore) return;
  match.homeScore = match.awayScore + 1;
  match.penalties = null;
  match.homeShots += 1;
  match.homeXg += 0.85;
  const scorer = match.homeRoster.find((player) => roleGroup(player.role) === "ATT") ?? match.homeRoster[0];
  const assist = match.homeRoster.find((player) => player.id !== scorer?.id && roleGroup(player.role) === "MID") ?? null;
  match.timeline.push({
    id: `90-goal-dev-${match.timeline.length + 1}`,
    minute: 90,
    type: "goal",
    side: "home",
    playerId: scorer?.id ?? "developer",
    playerName: scorer?.name ?? "开发者模式",
    assistId: assist?.id ?? null,
    assistName: assist?.name ?? null,
    score: { home: match.homeScore, away: match.awayScore },
    xg: 0.85,
    text: "F8 开发者模式锁定胜局。",
  });
}

function applyLossToWinTrait(match, playedIds) {
  const penaltyWin = match.penalties && match.penalties.home > match.penalties.away;
  if (match.homeScore > match.awayScore || penaltyWin || run.usedTraitEffects?.["last-ticket"]) return null;
  const carrier = run.players.find((player) => playedIds.has(player.id) && player.traits.some((entry) => entry.id === "last-ticket"));
  if (!carrier) return null;
  const trait = getTrait("last-ticket");
  run.usedTraitEffects ??= {};
  run.usedTraitEffects["last-ticket"] = true;
  match.homeScore = match.awayScore + 1;
  match.penalties = null;
  match.traitResultOverride = { traitId: trait.id, traitName: trait.name, playerId: carrier.id, playerName: carrier.name };
  match.timeline.push({
    id: `90-result-override-${match.timeline.length + 1}`,
    minute: 90,
    type: "result-override",
    side: "home",
    playerId: carrier.id,
    playerName: carrier.name,
    score: { home: match.homeScore, away: match.awayScore },
    xg: 0,
    text: `「${trait.name}」生效，本场失败被改写为成功。`,
  });
  return match.traitResultOverride;
}

function consumeTriggeredTrait(trigger) {
  run.lastTraitConsumptions = [];
  if (!trigger) return;
  const player = run.players.find((item) => item.id === trigger.playerId);
  if (!player) return;
  const index = player.traits.findIndex((entry) => entry.id === trigger.traitId);
  if (index >= 0) player.traits.splice(index, 1);
  run.lastTraitConsumptions.push(trigger);
}

function processLegendAppearances(playedIds) {
  const expired = [];
  run.lastLegendDepartures = [];
  run.players.forEach((player) => {
    if (!player.legendary || !playedIds.has(player.id)) return;
    player.legendMatchesRemaining = Math.max(0, (player.legendMatchesRemaining ?? LEGEND_MATCH_LIMIT) - 1);
    if (player.legendMatchesRemaining === 0) expired.push(player);
  });
  expired.forEach((player, index) => {
    let replacement = run.players.find((item) => item.id !== player.id && !run.lineupIds.includes(item.id));
    let replacementName = null;
    if (run.players.length <= TEAM_SIZE || (run.lineupIds.includes(player.id) && !replacement)) {
      const rng = createRng(`legend-return-${player.legendId}-${run.history.length}-${index}`);
      replacement = generateDraftChoices(player.role, catalog, rng, { stage: run.stage, usedNames: run.players.map((item) => item.name) })[0];
      run.players.push(replacement);
      replacementName = replacement.name;
    }
    const starterIndex = run.lineupIds.indexOf(player.id);
    if (starterIndex >= 0 && replacement) {
      run.lineupIds[starterIndex] = replacement.id;
      run.lineupPositions[replacement.id] = run.lineupPositions[player.id];
    }
    delete run.lineupPositions[player.id];
    run.players = run.players.filter((item) => item.id !== player.id);
    run.lastLegendDepartures.push({ name: player.name, replacementName });
  });
}

function processCareerEndingInjuries(reports) {
  const retiredIds = new Set(reports.filter((report) => report.retired).map((report) => report.playerId));
  run.lastRetirements = [];
  for (const playerId of retiredIds) {
    const player = run.players.find((item) => item.id === playerId);
    if (!player) continue;
    run.lineupIds = run.lineupIds.filter((id) => id !== player.id);
    delete run.lineupPositions[player.id];
    run.players = run.players.filter((item) => item.id !== player.id);
    run.chemistryLinks = Object.fromEntries(Object.entries(run.chemistryLinks).filter(([key]) => !key.split("::").includes(player.id)));
    run.lastRetirements.push({ name: player.name });
  }
}

function retirementMarkup() {
  if (!run.lastRetirements?.length) return "";
  return `<section class="legend-departure retirement-departure"><p class="kicker">CAREER ENDING INJURY</p>${run.lastRetirements.map((item) => `<p><b>${escapeHtml(item.name)}</b> 因本场重伤结束球员生涯并离队。球队不会自动补人，请通过商店自行补充名单。</p>`).join("")}</section>`;
}

function legendDepartureMarkup() {
  if (!run.lastLegendDepartures?.length) return "";
  return `<section class="legend-departure"><p class="kicker">LEGEND LOAN COMPLETE</p>${run.lastLegendDepartures.map((item) => `<p><b>${escapeHtml(item.name)}</b> 已完成 10 场传奇之旅并离队。${item.replacementName ? `青训球员 ${escapeHtml(item.replacementName)} 已补入名单。` : ""}</p>`).join("")}</section>`;
}

function playerMatchContexts(match, playedIds, won) {
  const totalMinutes = Math.max(90, Math.round(Number(match.minute) || 90));
  const minutes = new Map(run.lineupIds.map((id) => [id, totalMinutes]));
  for (const event of match.timeline ?? []) {
    if (event.side !== "home" || event.type !== "substitution") continue;
    if (event.playerOutId) minutes.set(event.playerOutId, Math.min(minutes.get(event.playerOutId) ?? totalMinutes, Math.max(1, event.minute)));
    if (event.playerInId) minutes.set(event.playerInId, Math.max(minutes.get(event.playerInId) ?? 0, totalMinutes - Math.max(0, event.minute)));
  }
  for (const id of playedIds) if (!minutes.has(id)) minutes.set(id, Math.round(totalMinutes * 0.3));
  const contexts = new Map(run.players.map((player) => [player.id, {
    played: playedIds.has(player.id),
    minutesPlayed: minutes.get(player.id) ?? 0,
    won,
    draw: false,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    newInjury: null,
    stage: run.stage,
    tacticLoad: Math.max(0, ((TACTICS[run.tactic]?.values?.pressing ?? 50) + (TACTICS[run.tactic]?.values?.tempo ?? 50) - 105) / 24),
  }]));
  for (const event of match.timeline ?? []) {
    if (event.side !== "home") continue;
    if (["goal", "penalty-goal"].includes(event.type) && contexts.has(event.playerId)) contexts.get(event.playerId).goals += 1;
    if (event.assistId && contexts.has(event.assistId)) contexts.get(event.assistId).assists += 1;
    if (event.type === "card" && contexts.has(event.playerId)) contexts.get(event.playerId).yellowCards += 1;
    if (event.type === "red" && contexts.has(event.playerId)) contexts.get(event.playerId).redCards += 1;
    if (event.type === "injury" && contexts.has(event.playerId)) contexts.get(event.playerId).newInjury = {
      severity: event.severity ?? "minor",
      matchesOut: event.matchesOut ?? 1,
      cause: event.cause ?? "match",
      retired: Boolean(event.retired),
      causedByFoul: Boolean(event.causedByFoul),
      offenderId: event.offenderId ?? null,
    };
    if (event.type === "lightning" && contexts.has(event.playerId)) contexts.get(event.playerId).newInjury = {
      severity: "severe",
      matchesOut: 5,
      cause: "lightning",
      forceUnavailable: true,
    };
  }
  if (match.traitResultOverride && contexts.has(match.traitResultOverride.playerId) && !contexts.get(match.traitResultOverride.playerId).newInjury) {
    contexts.get(match.traitResultOverride.playerId).newInjury = {
      severity: "moderate",
      matchesOut: 3,
      cause: "trait",
      forceUnavailable: true,
    };
  }
  for (const player of run.players) {
    const context = contexts.get(player.id);
    if (!context?.played || context.newInjury) continue;
    const postMatchInjury = player.traits
      .map((entry) => getTrait(entry.id))
      .filter(Boolean)
      .flatMap((trait) => trait.rules ?? [])
      .find((rule) => rule.hook === "postMatchInjury");
    if (postMatchInjury) context.newInjury = {
      severity: postMatchInjury.severity ?? "severe",
      matchesOut: postMatchInjury.matchesOut ?? 5,
      cause: postMatchInjury.cause ?? "trait",
      forceUnavailable: true,
    };
  }
  return contexts;
}

function processTraitContractDepartures(playedIds) {
  run.lastTraitDepartures = [];
  const departures = [];
  for (const player of run.players) {
    if (!playedIds.has(player.id)) continue;
    const entry = player.traits.find((item) => getTrait(item.id)?.rules?.some((rule) => rule.hook === "campaignDeparture"));
    if (!entry) continue;
    const rule = getTrait(entry.id).rules.find((item) => item.hook === "campaignDeparture");
    entry.appearancesRemaining = Math.max(0, Number(entry.appearancesRemaining ?? rule.appearances ?? 3) - 1);
    if (entry.appearancesRemaining === 0) departures.push({ player, trait: getTrait(entry.id) });
  }
  for (const { player, trait } of departures) {
    run.lineupIds = run.lineupIds.filter((id) => id !== player.id);
    delete run.lineupPositions[player.id];
    run.players = run.players.filter((item) => item.id !== player.id);
    run.chemistryLinks = Object.fromEntries(Object.entries(run.chemistryLinks).filter(([key]) => !key.split("::").includes(player.id)));
    run.lastTraitDepartures.push({ name: player.name, traitName: trait.name });
  }
}

function traitDepartureMarkup() {
  if (!run.lastTraitDepartures?.length) return "";
  return `<section class="legend-departure"><p class="kicker">TRAIT CONTRACT COMPLETE</p>${run.lastTraitDepartures.map((item) => `<p><b>${escapeHtml(item.name)}</b> 的「${escapeHtml(item.traitName)}」三场期限已满，球员按卡片效果离队。</p>`).join("")}</section>`;
}

function traitConsumptionMarkup() {
  if (!run.lastTraitConsumptions?.length) return "";
  return `<section class="legend-departure"><p class="kicker">ONE-TIME TRAIT ACTIVATED</p>${run.lastTraitConsumptions.map((item) => `<p><b>${escapeHtml(item.playerName)}</b> 使用「${escapeHtml(item.traitName)}」把失败改写为成功；卡片已永久销毁，球员固定伤停3场。</p>`).join("")}</section>`;
}

function settlePlayerSystems(match, playedIds, won) {
  const contexts = playerMatchContexts(match, playedIds, won);
  const reports = [];
  const newlyInjured = [];
  for (const player of run.players) {
    const context = contexts.get(player.id);
    if (context?.newInjury) newlyInjured.push(player);
    else reports.push(settlePlayerAfterMatch(player, context, createRng(`post-match-${run.stage}-${player.id}-${run.history.length}`)));
  }
  for (const player of newlyInjured) {
    const context = contexts.get(player.id);
    context.allowUnavailable = true;
    const report = settlePlayerAfterMatch(player, context, createRng(`post-match-injury-${run.stage}-${player.id}-${run.history.length}`));
    reports.push(report);
  }
  run.lastPlayerSystemReport = reports;
  return reports;
}

function playerSystemsReportMarkup() {
  const reports = run.lastPlayerSystemReport ?? [];
  const notable = reports.filter((report) => report.played || report.retired || report.suspension || report.suspensionServed || report.injury || report.recovered || report.growth?.levelUps);
  if (!notable.length) return "";
  const signed = (value) => `${value > 0 ? "+" : ""}${Math.round(value)}`;
  return `<section class="player-system-report"><div class="timeline-head"><h3>球员赛后结算</h3><small>体力、状态、伤病与成长</small></div><div>${notable.map((report) => {
    const player = run.players.find((item) => item.id === report.playerId);
    const playerName = player?.name ?? report.playerName ?? "未知球员";
    const growth = Object.entries(report.growth?.attributes ?? {}).map(([name, value]) => `${ATTRIBUTE_LABELS[name] ?? name} +${value}`).join(" · ");
    const status = report.retired
      ? "生涯终结伤病 · 已结束球员生涯"
      : report.suspension
      ? "红牌停赛 · 下一场不可出场"
      : report.suspensionServed
        ? "停赛已经执行 · 下一场可以复出"
        : report.injury
          ? `${INJURY_PROFILES[report.injury.severity]?.label ?? "伤病"} · 预计 ${report.injury.matchesRemaining} 场`
          : report.recovered
            ? "已经恢复健康"
            : report.growth?.levelUps
              ? `训练成长${growth ? ` · ${growth}` : ""}`
              : "本场出战";
    const kind = report.retired ? "injury retirement" : report.suspension ? "suspension" : report.suspensionServed ? "available" : report.injury ? "injury" : report.growth?.levelUps ? "growth" : "morale";
    const icon = report.retired ? "×" : report.suspension ? "禁" : report.suspensionServed ? "✓" : report.injury ? "+" : report.growth?.levelUps ? "↑" : player ? playerCondition(player).arrow : "–";
    const fitness = player ? playerValue(player, "fitness") : report.finalFitness;
    const morale = player ? playerValue(player, "morale") : report.finalMorale;
    return `<article class="${kind}"><span>${icon}</span><div><b>${escapeHtml(playerName)}</b><small>${escapeHtml(status)}</small><em><i>体力 ${Math.round(fitness ?? 0)} (${signed(report.fitnessDelta)})</i><i>状态 ${Math.round(morale ?? 0)} (${signed(report.moraleDelta)})</i></em></div></article>`;
  }).join("")}</div></section>`;
}

function finishMatch() {
  if (!runtime) return;
  runtime.running = false;
  for (const timer of runtime.visualTimers) clearTimeout(timer);
  if (runtime.animationFrame) cancelAnimationFrame(runtime.animationFrame);
  const match = structuredClone(runtime.match);
  const playedIds = new Set(runtime.playedIds);
  for (const event of match.timeline ?? []) if (event.side === "home" && event.type === "substitution" && event.playerInId) playedIds.add(event.playerInId);
  forceDeveloperVictory(match);
  const traitResultOverride = applyLossToWinTrait(match, playedIds);
  const penaltyWin = match.penalties && match.penalties.home > match.penalties.away;
  const won = match.homeScore > match.awayScore || penaltyWin;
  const playerSystemReport = settlePlayerSystems(match, playedIds, won);
  consumeTriggeredTrait(traitResultOverride);
  updateChemistryLinks(playedIds);
  processCareerEndingInjuries(playerSystemReport);
  processTraitContractDepartures(playedIds);
  processLegendAppearances(playedIds);
  run.history.push({
    stage: run.stage,
    opponent: run.opponent.name,
    score: `${match.homeScore}-${match.awayScore}`,
    penalties: match.penalties ?? null,
    won,
    weather: match.weather.key,
    timeline: match.timeline,
    playerSystemReport,
  });
  run.shopRefreshTokens = (run.shopRefreshTokens ?? 0) + 1;
  run.pendingVictoryReward = won ? { match, round: 1, pickedTraitIds: [] } : null;
  runtime = null;
  saveRun();
  if (won) {
    gameNav.hidden = true;
    document.body.classList.remove("run-nav-visible");
  }
  if (won) renderVictory(match);
  else renderDefeat(match);
}

function weightedRewardChoices(excludedIds = [], rewardRound = 1) {
  const owned = new Set(run.players.flatMap((player) => player.traits.map((entry) => entry.id)));
  const excluded = new Set(excludedIds);
  const pool = catalog.filter((trait) => !owned.has(trait.id) && !excluded.has(trait.id));
  const rng = createRng(`reward-${run.stage}-${run.history.length}-round-${rewardRound}`);
  const rarityWeight = { common: 62, rare: 27, epic: 9, legendary: 2 };
  const choices = [];
  while (choices.length < 3 && pool.length > choices.length) {
    const available = pool.filter((trait) => !choices.includes(trait));
    const total = available.reduce((sum, trait) => sum + (rarityWeight[trait.rarity] ?? 1), 0);
    let roll = rng() * total;
    let selected = available[0];
    for (const trait of available) {
      roll -= rarityWeight[trait.rarity] ?? 1;
      if (roll <= 0) { selected = trait; break; }
    }
    choices.push(selected);
  }
  return choices;
}

function victoryGoldReward(stage) {
  return gameConfig.economy.victoryBaseGold + stage * gameConfig.economy.victoryGoldPerStage;
}

function matchReportEventMarkup(event) {
  const isGoal = ["goal", "penalty-goal"].includes(event.type);
  const isPenalty = event.type.startsWith("penalty-");
  const isInjury = event.type === "injury";
  const isLightning = event.type === "lightning";
  const isResultOverride = event.type === "result-override";
  const title = isResultOverride
    ? `${escapeHtml(event.playerName)} · 最后一张票`
    : isPenalty
    ? `${escapeHtml(event.playerName)} · ${event.type === "penalty-goal" ? "点球命中" : "点球罚失"}`
    : event.type === "goal"
      ? `${escapeHtml(event.playerName)} · 进球`
      : event.type === "red"
        ? `${escapeHtml(event.playerName)} · 红牌`
        : isLightning
          ? `${escapeHtml(event.playerName)} · 雷击重伤`
          : isInjury
            ? `${escapeHtml(event.playerName)} · ${INJURY_PROFILES[event.severity]?.label ?? "伤病"}`
            : `${escapeHtml(event.playerName)} · 黄牌`;
  const detail = isResultOverride
    ? `${escapeHtml(event.text)} · 改写后比分 ${event.score.home}:${event.score.away}`
    : isGoal
    ? `${event.assistName ? `助攻 ${escapeHtml(event.assistName)}` : isPenalty ? "裁判判罚点球" : "无助攻"} · 当时比分 ${event.score.home}:${event.score.away} · xG ${event.xg}`
    : isLightning
      ? `强制伤停 5 场 · ${escapeHtml(event.text)}`
      : isInjury
        ? `预计影响 ${event.matchesOut ?? 1} 场 · ${escapeHtml(event.text)}`
        : event.type === "red"
          ? `${escapeHtml(event.text)} · 下一场自动停赛`
          : escapeHtml(event.text);
  return `<div class="timeline-event ${event.side} ${event.type}"><b>${event.minute}'</b><i></i><span><strong>${title}</strong><small>${detail}</small></span></div>`;
}

function matchReport(match) {
  const important = (match.timeline ?? []).filter((event) => ["goal", "penalty-goal", "penalty-miss", "red", "card", "injury", "lightning", "result-override"].includes(event.type));
  return `<section class="result-report">
    <div class="result-stat-strip"><span><b>${match.possession.home}%</b><small>控球</small><b>${match.possession.away}%</b></span><span><b>${match.homeShots}</b><small>射门</small><b>${match.awayShots}</b></span><span><b>${match.fouls?.home ?? 0}</b><small>犯规</small><b>${match.fouls?.away ?? 0}</b></span></div>
    <div class="timeline-head"><h3>重要时间轴</h3><small>进球、助攻与判罚记录</small></div>
    <div class="result-timeline">${important.length ? important.map(matchReportEventMarkup).join("") : `<p>本场没有进球或重大判罚，录像组可以提前下班。</p>`}</div>
  </section>`;
}

function renderVictory(match, rewardRound = 1, pickedTraitIds = []) {
  const choices = weightedRewardChoices(pickedTraitIds, rewardRound);
  const gold = victoryGoldReward(run.stage);
  let selected = null;
  let claiming = false;
  screen.innerHTML = `
    <section class="result-shell">
      <div class="result-score"><div><p class="kicker">MATCH WON · +${gold} G · +1 直售刷新</p><h1>拿下<br />这一场</h1></div><div><div class="final-score">${match.homeScore}:${match.awayScore}</div>${match.penalties ? `<b>点球 ${match.penalties.home}:${match.penalties.away}</b>` : ""}</div></div>
      <div class="result-detail">
        ${legendDepartureMarkup()}
        ${retirementMarkup()}
        ${traitDepartureMarkup()}
        ${traitConsumptionMarkup()}
        ${matchReport(match)}
        ${playerSystemsReportMarkup()}
        <p class="kicker">TRAIT REWARD · ${rewardRound} / 2</p><h2>${rewardRound === 1 ? "第一张，挑一个方向" : "第二张，补完整套构筑"}</h2><p>每场胜利连续进行两轮三选一，共带走两张特性卡。悬停查看信息，单击选中，双击直接领取。</p>
        <div class="reward-options rogue-reward-options">${choices.map((trait,index) => `<section class="reward-choice reward-pick-option" tabindex="0" role="button" data-reward="${index}" aria-label="选择特性卡 ${escapeHtml(trait.name)}">${traitCardMarkup(trait)}<span class="direct-pick-hint">单击选中 · 双击领取</span></section>`).join("")}</div>
        <div class="reward-assign card-reward-claim"><span id="reward-destination">第 ${rewardRound} 张卡牌将进入背包</span><button class="primary-button" id="claim-reward" disabled>${rewardRound === 1 ? "收入背包并选择第二张" : "收入背包并继续"}</button></div>
      </div>
    </section>`;
  const cards = [...document.querySelectorAll("[data-reward]")];
  const selectReward = (card) => {
    selected = choices[Number(card.dataset.reward)];
    cards.forEach((item) => {
      const isSelected = item === card;
      item.classList.toggle("selected", isSelected);
      item.setAttribute("aria-pressed", String(isSelected));
    });
    document.querySelector("#reward-destination").textContent = `已选「${selected.name}」· 双击卡牌或点击按钮领取`;
    document.querySelector("#claim-reward").disabled = false;
  };
  const claimReward = () => {
    if (!selected || claiming) return;
    claiming = true;
    run.inventory.push(selected.id);
    if (rewardRound === 1) {
      run.pendingVictoryReward = { match, round: 2, pickedTraitIds: [...pickedTraitIds, selected.id] };
      saveRun();
      renderVictory(match, 2, [...pickedTraitIds, selected.id]);
      return;
    }
    const completedStage = run.stage;
    run.gold += gold;
    run.stage += 1;
    run.opponent = null;
    run.pendingVictoryReward = null;
    run.lastLegendDepartures = [];
    saveRun();
    if (completedStage % 3 === 0) renderRecruitReward(completedStage);
    else { prepareOpponent(); renderSquadScreen(); }
  };
  cards.forEach((card) => {
    const trait = choices[Number(card.dataset.reward)];
    card.addEventListener("mouseenter", (event) => showTraitTooltip(trait, event));
    card.addEventListener("mousemove", positionTraitTooltip);
    card.addEventListener("mouseleave", hideTraitTooltip);
    card.addEventListener("click", () => selectReward(card));
    card.addEventListener("dblclick", (event) => { event.preventDefault(); selectReward(card); claimReward(); });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectReward(card); }
    });
  });
  document.querySelector("#claim-reward").addEventListener("click", claimReward);
}

function renderRecruitReward(completedStage) {
  const rng = createRng(`recruit-${completedStage}-${run.players.length}`);
  const pity = legendPitySettings(run.rewardLegendPity, "reward");
  const choices = generatePlayerRewardChoices(rng, ["DEF", "MID", "ATT"], pity);
  const legendHit = choices.some((player) => player.legendary);
  run.rewardLegendPity = legendHit ? 0 : Math.min(LEGEND_PITY_LIMIT - 1, pity.misses + 1);
  saveRun();
  let selected = null;
  let claiming = false;
  screen.innerHTML = `
    <section><header class="screen-head"><div><p class="kicker">MILESTONE REWARD · LEVEL ${completedStage}</p><h1>有人想加入球队</h1><p>每三场胜利一次球员三选一；通关招募拥有独立传奇保底。</p><p class="legend-pity-note"><b>征程传奇</b><span>${legendPityCopy(pity)}</span></p></div></header>
    <div class="card-grid">${choices.map((player,index) => {
      const trait = getTrait(player.traits[0]?.id);
      const legendTraits = player.traits.map((entry) => getTrait(entry.id)).filter(Boolean);
      return `<button class="player-card reward-player-option ${player.legendary ? "legend-player-card" : ""}" data-recruit="${index}" data-number="${index+1}"><span class="player-top"><span class="role-chip">${player.legendary ? "传奇 · " : ""}${ROLE_LABELS[player.role]}</span><span class="grade-chip">${playerOverall(player)}</span></span><h2 class="player-name">${escapeHtml(player.name)}</h2><span class="player-sub">${ROLE_LABELS[player.role]} · ${FOOT_LABELS[player.preferredFoot]} · ${player.heightCm} CM${player.legendary ? ` · 限出战 ${player.legendMatchesRemaining} 场` : ""}</span><span class="player-scouting-profile">${escapeHtml(recruitmentProfile(player))}</span><div class="stat-bars">${statBar("进攻",playerValue(player,"attack"))}${statBar("传球",playerValue(player,"passing"))}${statBar("防守",playerValue(player,"defense"))}</div>${player.legendary ? `<div class="trait-ribbon legend-trait-ribbon"><small>3 张强力先天特性 · 全部锁定</small>${legendTraits.map((item) => `<span tabindex="0" role="button" data-trait-card-id="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><i>${traitGrade(item.rarity)}</i></span>`).join("")}</div>` : `<div class="trait-ribbon" ${trait ? `tabindex="0" role="button" data-trait-card-id="${escapeHtml(trait.id)}"` : ""}><small>先天特性卡 · 永久锁定 · 点击放大</small><strong>${escapeHtml(trait?.name ?? "无")}</strong><p>${escapeHtml(trait?.summary ?? "")}</p></div>`}<span class="direct-pick-hint">单击选中 · 双击签下</span></button>`;
    }).join("")}</div>
    <div class="draft-action"><span class="picked-list">选择后加入替补席</span><button class="primary-button" id="claim-recruit" disabled>签下球员</button></div></section>`;
  const cards = [...document.querySelectorAll("[data-recruit]")];
  bindTraitCardInteractions(screen);
  const selectRecruit = (card) => {
    selected = Number(card.dataset.recruit);
    cards.forEach((item) => item.classList.toggle("selected", item === card));
    document.querySelector("#claim-recruit").disabled = false;
  };
  const claimRecruit = () => {
    if (selected === null || claiming) return;
    claiming = true;
    registerAcquiredPlayer(choices[selected]);
    saveRun();
    prepareOpponent();
    renderSquadScreen();
  };
  cards.forEach((card) => {
    card.addEventListener("click", () => selectRecruit(card));
    card.addEventListener("dblclick", (event) => {
      if (event.target.closest("[data-trait-card-id]")) return;
      event.preventDefault();
      selectRecruit(card);
      claimRecruit();
    });
  });
  document.querySelector("#claim-recruit").addEventListener("click", claimRecruit);
}

function renderDefeat(match) {
  screen.innerHTML = `
    <section class="result-shell">
      <div class="result-score" style="background:var(--orange)"><div><p class="kicker">MATCH LOST</p><h1>这次<br />没踢过</h1></div><div><div class="final-score">${match.homeScore}:${match.awayScore}</div>${match.penalties ? `<b>点球 ${match.penalties.home}:${match.penalties.away}</b>` : ""}</div></div>
      <div class="result-detail"><p class="kicker">RUN CONTINUES · +1 直售刷新</p><h2>征程没有重置</h2><p>失败不会清空进度，并且本场仍获得 1 次可累计的商店直售刷新。</p>
        ${legendDepartureMarkup()}
        ${retirementMarkup()}
        ${traitDepartureMarkup()}
        ${traitConsumptionMarkup()}
        ${matchReport(match)}
        ${playerSystemsReportMarkup()}
        <div class="loss-actions button-row"><button class="primary-button" id="retry-stage">回更衣室重试</button><button class="secondary-button" id="title-after-loss">先回标题</button></div>
      </div>
    </section>`;
  document.querySelector("#retry-stage").addEventListener("click", () => { run.lastLegendDepartures = []; saveRun(); prepareOpponent(true); renderSquadScreen(); });
  document.querySelector("#title-after-loss").addEventListener("click", renderWelcome);
}

function openModal(content, afterOpen, closeOnBackdrop = true) {
  modal.className = "modal";
  modal.innerHTML = content;
  modalBackdrop.hidden = false;
  modal.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeModal));
  modalBackdrop.onclick = closeOnBackdrop ? (event) => { if (event.target === modalBackdrop) closeModal(); } : null;
  afterOpen?.();
}

function closeModal() {
  modalBackdrop.hidden = true;
  modal.className = "modal";
  modal.innerHTML = "";
  modalBackdrop.onclick = null;
}

async function init() {
  await loadCatalog();
  window.addEventListener("keydown", (event) => {
    if (event.key !== "F8") return;
    event.preventDefault();
    activateDeveloperCheat();
  });
  document.querySelectorAll("[data-game-nav]").forEach((button) => button.addEventListener("click", () => {
    const target = button.dataset.gameNav;
    if (target === "matchday") renderHub();
    if (target === "loadout") renderSquadScreen();
    if (target === "team") renderTeamInfo();
    if (target === "squad") renderSquadScreen();
    if (target === "players") renderClub("players");
    if (target === "bag") renderClub("traits");
    if (target === "shop") renderShop();
  }));
  renderWelcome();
}

init();
