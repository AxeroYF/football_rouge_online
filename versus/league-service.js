import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { advanceVersusMatch, createVersusMatch, drawVersusReferee, drawVersusWeather, publicMatch, REGULAR_DURATION_MS, HALFTIME_ADJUSTMENT_MS } from "./match-engine.js";
import { hydrateHistoricalMatchDetail } from "./history-detail.js";
import { REAL_PLAYER_BY_ID, REAL_PLAYER_POOLS, REAL_PLAYERS } from "./player-pool.js";
import { analyzeElevenFormation, drawUniqueMixedPlayers, drawUniquePlayers, inferElevenBoardRoles, sanitizePositions } from "./rules.js";
import { roleGroup } from "../game/public/schema.js";
import { YDL_TRAIT_BY_ID } from "./trait-pool.js";
import { applyS4BondBonuses, createS4BondCatalog, evaluateS4LineupBonds } from "./public/bond-rules.js";
import {
  assertS4AssetInvariants,
  cardsForOwner,
  createS4Card,
  ensureS4Assets,
  isRosterExemptCard,
  ownershipOwner,
  publicS4AssetsForOwner,
  publicS4Card,
  recordS4AssetTransaction,
  recycleS4Card,
  representativeCard,
  returnPlayerOwnershipToSystem,
  rosterFamilyUsesSlot,
  rosterSlotUsage,
  S4_ROSTER_LIMIT,
  transferPlayerOwnership,
  transferS4Card,
} from "./s4-assets.js";

const DEFAULT_STATE_PATH = process.env.YELLOWDOGS_LEAGUE_PATH
  ? path.resolve(process.env.YELLOWDOGS_LEAGUE_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/yellowdogs-league.json");
const TEAM_COUNT = 10;
const DRAFT_ROSTER_SIZE = 22;
const CLUB_ROSTER_LIMIT = 33;
const POSITION_PRESET_KEYS = Object.freeze(["position1", "position2", "position3"]);
export const S4_PACK_CATALOG = Object.freeze([
  Object.freeze({ id:"legend-random", name:"传奇随机卡包", price:12000, kind:"legend", pool:"LEGEND", selectionMode:"choice", description:"随机展示3名传奇球员，选择其中1张球员卡。" }),
  Object.freeze({ id:"private-mixed", name:"私有池全位置随机礼包", price:2200, kind:"private", pool:"MIXED", selectionMode:"direct", description:"从你拥有所有权的全部非传奇球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-att", name:"私有池前场随机礼包", price:1800, kind:"private", pool:"ATT", selectionMode:"direct", description:"从你拥有所有权的前场球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-mid", name:"私有池中场随机礼包", price:1800, kind:"private", pool:"MID", selectionMode:"direct", description:"从你拥有所有权的中场球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-def", name:"私有池后场随机礼包", price:1800, kind:"private", pool:"DEF", selectionMode:"direct", description:"从你拥有所有权的后场球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-gk", name:"私有池门将随机礼包", price:1600, kind:"private", pool:"GK", selectionMode:"direct", description:"从你拥有所有权的门将中随机获得1张卡。" }),
  Object.freeze({ id:"public-random", name:"公共池随机礼包", price:6000, kind:"public", pool:"MIXED", selectionMode:"choice", description:"从尚未被占用所有权的非传奇球员中随机展示3人，选择1张卡并获得其所有权。" }),
]);
const S4_PACK_BY_ID = Object.freeze(Object.fromEntries(S4_PACK_CATALOG.map((pack) => [pack.id, pack])));
const S4_MAX_PACK_PURCHASE_QUANTITY = 100;
const PACK_TIERS = Object.freeze({
  standard:Object.freeze({ id:"standard", name:"基础卡包", price:3500, guaranteeGrades:[], guarantee:"全位置混池·随机品质" }),
  advanced:Object.freeze({ id:"advanced", name:"进阶卡包", price:5000, guaranteeGrades:["S", "A", "B"], guarantee:"全位置混池·至少1名B级以上" }),
  elite:Object.freeze({ id:"elite", name:"精英卡包", price:6500, guaranteeGrades:["S", "A"], guarantee:"全位置混池·至少1名A级以上" }),
});
const ADMIN_LEGEND_TIER = Object.freeze({ id:"legend", name:"随机传奇卡包", price:0, guarantee:"随机1名可用S级传奇球员" });
const ADMIN_PACK_TYPES = Object.freeze([
  Object.freeze({ id:"position-standard", name:"指定位置基础卡包", poolMode:"position", tierId:"standard" }),
  Object.freeze({ id:"position-advanced", name:"指定位置进阶卡包", poolMode:"position", tierId:"advanced" }),
  Object.freeze({ id:"position-elite", name:"指定位置高级卡包", poolMode:"position", tierId:"elite" }),
  Object.freeze({ id:"mixed-standard", name:"全位置基础卡包", pool:"MIXED", tierId:"standard" }),
  Object.freeze({ id:"mixed-advanced", name:"全位置进阶卡包", pool:"MIXED", tierId:"advanced" }),
  Object.freeze({ id:"mixed-elite", name:"全位置高级卡包", pool:"MIXED", tierId:"elite" }),
  Object.freeze({ id:"random-legend", name:"随机传奇卡包", pool:"LEGEND", tierId:"legend" }),
]);
const BACKUP_RETENTION_DAYS = 7;
const ROUND_INTERVAL_MS = 20 * 60 * 1000;
const CUP_INTERVAL_MS = 20 * 60 * 1000;
const COMPLETED_BROADCAST_RETENTION_MS = 2 * 60 * 60 * 1000;
const ACTIVE_START_HOUR = 10;
const ACTIVE_END_HOUR = 22;
const LEAGUE_FITNESS_DRAIN_FACTOR = 0.36;
const CHEMISTRY_GAIN_PER_MATCH = 6;
const CHEMISTRY_VISIBLE_THRESHOLD = 30;
const CHEMISTRY_MAX_BONUS = 0.015;
export const S4_BOND_CATALOG = Object.freeze(createS4BondCatalog(REAL_PLAYERS));
const INITIAL_WALLET_BALANCE = 10000;
const DEFAULT_FITNESS_THRESHOLD = 65;
const REWARD_MULTIPLIER = 5;
const CUP_ADVANCE_COIN_REWARD = 2200;
const CUP_CHAMPION_COIN_REWARD = 12000;
const S4_SINGLE_CARD_RELEASE_RATE = 0.45;
const S4_FORCED_CARD_RECOVERY_RATE = 0.25;
const S4_OWNERSHIP_RETURN_RATE = 0.1;
export const S4_ENHANCEMENT_MAX_LEVEL = 8;
export const S4_ENHANCEMENT_EQUAL_CHANCES = Object.freeze([100, 90, 78, 65, 52, 40, 30, 22]);
export const S4_ENHANCEMENT_PROTECTION_COSTS = Object.freeze([0, 0, 0, 500, 900, 1600, 2800, 5000]);
const CHAMPION_BADGE_SEASONS = Object.freeze(["S0", "S1", "S2"]);
const CUP_CHAMPION_BADGE_SEASONS = Object.freeze(["S2", "S3"]);
const TEAM_NAMES = ["上海海港", "上海申花", "北京国安", "山东泰山", "成都蓉城", "天津津门虎", "浙江队", "河南队", "武汉三镇", "深圳新鹏城"];
const TACTICS = new Set(["allOutAttack", "positive", "balanced", "defensive", "parkBus"]);
const STYLES = new Set(["possession", "longBall", "wingPlay", "counterAttack", "highPress", "lowBlock", "roughPlay"]);
const FOCUSES = new Set(["balanced", "left", "center", "right"]);
const CUP_STAGE_NAMES = Object.freeze({ quarterfinals:"四分之一决赛", semifinals:"半决赛", final:"决赛" });

const clone = (value) => structuredClone(value);
const localDateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const playerSummary = (player) => ({ id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole, pool:player.pool, overall:player.overall, grade:player.grade, nationality:player.nationality, club:player.club, heightCm:player.heightCm, preferredFoot:player.preferredFoot, attributes:clone(player.attributes ?? {}), legendAbility:clone(player.legendAbility ?? null) });
const publicLeagueS4Card = (state, card) => ({
  ...publicS4Card(state, card),
  traits:(card.traitIds ?? []).filter((id) => YDL_TRAIT_BY_ID[id]).map((id) => ({ id, name:YDL_TRAIT_BY_ID[id].name })),
});
const publicPackTier = (tier) => ({ id:tier.id, name:tier.name, price:tier.price, guarantee:tier.guarantee });
const rewardPackTier = (tierId) => tierId === ADMIN_LEGEND_TIER.id ? ADMIN_LEGEND_TIER : PACK_TIERS[tierId] ?? PACK_TIERS.standard;

function settleAutomatedMatch(match, startedAt) {
  let now = startedAt + REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS + 1;
  for (let attempt = 0; attempt < 5 && !match.finished; attempt += 1) {
    advanceVersusMatch(match, now);
    now += 60_000;
  }
  if (!match.finished || !match.report) throw new Error("自动比赛未能完成结算");
  return match;
}

function makeId(prefix, value) {
  return `${prefix}-${String(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(-28)}-${Date.now().toString(36)}`;
}

export function s4EnhancementChance(mainLevelValue, materialLevelValue) {
  const mainLevel = Math.max(0, Math.min(S4_ENHANCEMENT_MAX_LEVEL - 1, Math.floor(Number(mainLevelValue) || 0)));
  const materialLevel = Math.max(0, Math.min(S4_ENHANCEMENT_MAX_LEVEL, Math.floor(Number(materialLevelValue) || 0)));
  const equalChance = S4_ENHANCEMENT_EQUAL_CHANCES[mainLevel];
  const distance = materialLevel - mainLevel;
  const adjusted = distance < 0
    ? equalChance * (.52 ** Math.abs(distance))
    : equalChance * (1.35 ** distance);
  return Math.max(1, Math.min(100, Math.round(adjusted)));
}

function roundRobin(teamIds) {
  const rotation = [...teamIds];
  const firstHalf = [];
  for (let round = 0; round < rotation.length - 1; round += 1) {
    const fixtures = [];
    for (let index = 0; index < rotation.length / 2; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];
      fixtures.push({ homeId:round % 2 === 0 ? left : right, awayId:round % 2 === 0 ? right : left, matchId:null });
    }
    firstHalf.push(fixtures);
    rotation.splice(1, 0, rotation.pop());
  }
  return [...firstHalf, ...firstHalf.map((fixtures) => fixtures.map((fixture) => ({ homeId:fixture.awayId, awayId:fixture.homeId, matchId:null })))]
    .map((fixtures, index) => ({ number:index + 1, status:"pending", fixtures }));
}

function freshTable() {
  return { played:0, won:0, drawn:0, lost:0, goalsFor:0, goalsAgainst:0, points:0 };
}

function initialTeam(index) {
  return {
    id:`ydl-team-${index + 1}`,
    name:TEAM_NAMES[index],
    ownerId:null,
    ownerName:null,
    joinedAt:null,
    rosterIds:[],
    preferredStarterIds:[],
    positions:{},
    positionPresets:{},
    tactic:["positive", "balanced", "defensive", "balanced", "allOutAttack"][index % 5],
    style:["possession", "wingPlay", "counterAttack", "highPress", "longBall", "lowBlock"][index % 6],
    attackFocus:["balanced", "left", "center", "right"][index % 4],
    defenseFocus:"balanced",
    fitnessThreshold:DEFAULT_FITNESS_THRESHOLD,
    tacticalPlans:{
      opening:{ tactic:["positive", "balanced", "defensive", "balanced", "allOutAttack"][index % 5], style:["possession", "wingPlay", "counterAttack", "highPress", "longBall", "lowBlock"][index % 6], positionPreset:"position1" },
      leading:{ tactic:"defensive", style:"counterAttack", positionPreset:"position2" },
      trailing:{ tactic:"positive", style:"highPress", positionPreset:"position3" },
    },
    playerState:{},
    chemistry:{},
    championBadges:[],
    table:freshTable(),
    form:[],
  };
}

function createState(now, seasonName = "S1") {
  const teams = Array.from({ length:TEAM_COUNT }, (_, index) => initialTeam(index));
  return {
    version:2,
    ruleset:"S4",
    season:{ id:`${seasonName}-${localDateKey(new Date(now))}`, name:seasonName, date:localDateKey(new Date(now)), status:"active", currentRound:0, totalRounds:18, nextRoundAt:null, firstRoundAt:null, startedAt:now, completedAt:null },
    teams,
    rounds:roundRobin(teams.map((team) => team.id)),
    matches:[],
    playerStats:{},
    drafts:{},
    wallets:{},
    ledger:[],
    listings:[],
    reports:{},
    inbox:{},
    inboxDeleted:{},
    shopOffers:{},
    rewardOffers:{},
    adminPackGrants:[],
    s4Assets:{ schemaVersion:1, nextCardSequence:1, ownerships:{}, cards:{}, traitOffers:{}, transactions:[] },
    s4Packs:{ schemaVersion:1, nextSequence:1, inventory:{}, offers:{}, batchOpenings:{}, grants:[], cardGrants:[], legacyRetiredAt:now },
    liveRound:null,
    liveCupRound:null,
    cup:{ status:"waiting", stage:"waiting", participants:[], table:{}, swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, completedAt:null },
    completedBroadcasts:[],
    archives:[],
    updatedAt:now,
  };
}

function nextSlot(now) {
  const date = new Date(now);
  const start = new Date(date); start.setHours(ACTIVE_START_HOUR, 0, 0, 0);
  const end = new Date(date); end.setHours(ACTIVE_END_HOUR, 0, 0, 0);
  if (date < start) return start.getTime();
  if (date >= end) { start.setDate(start.getDate() + 1); return start.getTime(); }
  const elapsed = date.getTime() - start.getTime();
  return start.getTime() + (Math.floor(elapsed / ROUND_INTERVAL_MS) + 1) * ROUND_INTERVAL_MS;
}

function nextCupSlot(now, leagueFirstRoundAt = null) {
  const anchor = Number(leagueFirstRoundAt);
  if (Number.isFinite(anchor) && anchor > 0) {
    const firstCupAt = anchor + 10 * 60 * 1000;
    if (now < firstCupAt) return firstCupAt;
    return firstCupAt + (Math.floor((now - firstCupAt) / CUP_INTERVAL_MS) + 1) * CUP_INTERVAL_MS;
  }
  const date = new Date(now);
  const start = new Date(date); start.setHours(ACTIVE_START_HOUR, 10, 0, 0);
  const end = new Date(date); end.setHours(ACTIVE_END_HOUR, 0, 0, 0);
  if (date < start) return start.getTime();
  if (date >= end) { start.setDate(start.getDate() + 1); return start.getTime(); }
  const minute = date.getMinutes();
  const slotMinute = minute < 10 ? 10 : minute < 30 ? 30 : minute < 50 ? 50 : 70;
  start.setMinutes(slotMinute, 0, 0);
  return start.getTime();
}

function activeTime(now) {
  const date = new Date(now);
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= ACTIVE_START_HOUR * 60 && minutes <= ACTIVE_END_HOUR * 60;
}

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  if (existsSync(filePath)) copyFileSync(filePath, `${filePath}.bak`);
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, 2), "utf8");
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  renameSync(temporary, filePath);
}

function loadState(filePath, now) {
  if (!filePath || !existsSync(filePath)) return createState(now);
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      const state = JSON.parse(readFileSync(candidate, "utf8"));
      if ([1, 2].includes(state?.version) && state?.teams?.length === TEAM_COUNT) return state;
    } catch { /* 尝试备份文件 */ }
  }
  throw new Error("YellowDogs League 存档损坏，主文件和备份均无法读取");
}

function minimumPrice(player) {
  const base = { S:9000, A:4500, B:1800, C:800 }[player.grade] ?? 800;
  return Math.ceil((base + Math.max(0, player.overall - 75) * 120) / 100) * 100;
}

function minimumListingPrice(player) {
  return Math.ceil(minimumPrice(player) * .5);
}

function s4CardReferenceValue(player, upgradeLevel = 0) {
  return Math.floor(minimumPrice(player) * (1 + Math.max(0, Number(upgradeLevel)) * .55));
}

function s4SingleCardReleaseValue(player, upgradeLevel = 0) {
  return Math.floor(s4CardReferenceValue(player, upgradeLevel) * S4_SINGLE_CARD_RELEASE_RATE);
}

function s4ForcedCardRecoveryValue(player, upgradeLevel = 0) {
  return Math.floor(s4CardReferenceValue(player, upgradeLevel) * S4_FORCED_CARD_RECOVERY_RATE);
}

function chemistryPairKey(firstId, secondId) {
  return [firstId, secondId].sort().join("::");
}

function eligibleChemistryPairs(players, positions) {
  const roles = inferElevenBoardRoles(players.map((player) => ({ id:player.id, position:positions[player.id] })));
  const pairs = [];
  for (let first = 0; first < players.length; first += 1) {
    for (let second = first + 1; second < players.length; second += 1) {
      const left = players[first];
      const right = players[second];
      const leftPosition = positions[left.id];
      const rightPosition = positions[right.id];
      const group = roleGroup(roles[left.id]);
      if (!leftPosition || !rightPosition || group === "GK" || group !== roleGroup(roles[right.id])) continue;
      const xDistance = Math.abs(leftPosition.x - rightPosition.x);
      const yDistance = Math.abs(leftPosition.y - rightPosition.y);
      if (yDistance > 12 || Math.hypot(xDistance, yDistance) > 36) continue;
      pairs.push({ key:chemistryPairKey(left.id, right.id), playerIds:[left.id, right.id].sort(), group });
    }
  }
  return pairs;
}

function publicChemistryLinks(team, starterIds = team.preferredStarterIds, positions = team.positions) {
  const starters = starterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean);
  const eligibleKeys = new Set(eligibleChemistryPairs(starters, positions).map((pair) => pair.key));
  return Object.entries(team.chemistry ?? {})
    .filter(([key, relation]) => eligibleKeys.has(key) && Number(relation.value ?? 0) >= CHEMISTRY_VISIBLE_THRESHOLD)
    .map(([, relation]) => ({
      playerIds:[...relation.playerIds],
      appearances:Number(relation.appearances ?? 0),
      value:Number(relation.value ?? 0),
      bonus:Number(Math.min(CHEMISTRY_MAX_BONUS, Number(relation.value ?? 0) / 100 * CHEMISTRY_MAX_BONUS).toFixed(4)),
    }))
    .sort((left, right) => right.value - left.value);
}

function removePlayerChemistry(team, playerId) {
  Object.entries(team.chemistry ?? {}).forEach(([key, relation]) => {
    if (relation.playerIds?.includes(playerId)) delete team.chemistry[key];
  });
}

function mostCommon(values) {
  const counts = new Map();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]), "zh-CN"))[0]?.[0] ?? null;
}

function draftCounts(ids) {
  return ids.reduce((counts, id) => {
    const pool = REAL_PLAYER_BY_ID[id]?.pool;
    if (pool) counts[pool] += 1;
    return counts;
  }, { GK:0, DEF:0, MID:0, ATT:0 });
}

function validDraft(ids) {
  return ids.length === DRAFT_ROSTER_SIZE && new Set(ids).size === DRAFT_ROSTER_SIZE;
}

function seededConditions(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const rng = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return { weather:drawVersusWeather(rng), referee:drawVersusReferee(rng) };
}

function pickStartingIds(rosterIds) {
  const chosen = [];
  const take = (pool, count) => rosterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter((player) => player?.pool === pool && !chosen.includes(player.id)).sort((a,b) => b.overall - a.overall).slice(0, count).forEach((player) => chosen.push(player.id));
  take("GK", 1); take("DEF", 4); take("MID", 3); take("ATT", 3);
  if (chosen.length < 11) rosterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean).sort((a,b) => b.overall - a.overall).forEach((player) => { if (chosen.length < 11 && !chosen.includes(player.id)) chosen.push(player.id); });
  return chosen;
}

function leagueBoardPositions(players) {
  const slots = [
    { x:50, y:90 },
    { x:18, y:69 }, { x:39, y:69 }, { x:61, y:69 }, { x:82, y:69 },
    { x:24, y:45 }, { x:50, y:45 }, { x:76, y:45 },
    { x:22, y:19 }, { x:50, y:19 }, { x:78, y:19 },
  ];
  return Object.fromEntries(players.slice(0, 11).map((player, index) => [player.id, slots[index]]));
}

function playerRoleFit(player, assignedRole) {
  if (player.role === assignedRole) return 4;
  if (player.secondaryRole === assignedRole) return 3;
  if ((assignedRole === "LWB" && [player.role, player.secondaryRole].includes("LB")) || (assignedRole === "RWB" && [player.role, player.secondaryRole].includes("RB"))) return 3;
  return roleGroup(player.role) === roleGroup(assignedRole) ? 2 : 0;
}

function removeRosterPlayerPreservingShape(team, playerId) {
  const wasStarter = team.preferredStarterIds.includes(playerId);
  const presets = team.positionPresets ?? Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(team.positions ?? {})]));
  const vacatedPositions = Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, presets[key]?.[playerId] ? { ...presets[key][playerId] } : null]));
  const roles = inferElevenBoardRoles(team.preferredStarterIds.map((id) => ({ id, position:team.positions[id] })));
  const assignedRole = roles[playerId] ?? REAL_PLAYER_BY_ID[playerId]?.role;
  team.rosterIds = team.rosterIds.filter((id) => id !== playerId);
  team.preferredStarterIds = team.preferredStarterIds.filter((id) => id !== playerId);
  POSITION_PRESET_KEYS.forEach((key) => { delete presets[key][playerId]; });
  team.positionPresets = presets;
  team.positions = clone(presets.position1);
  if (!wasStarter) return;
  const replacement = team.rosterIds
    .filter((id) => !team.preferredStarterIds.includes(id))
    .map((id) => REAL_PLAYER_BY_ID[id])
    .filter(Boolean)
    .sort((left, right) => playerRoleFit(right, assignedRole) - playerRoleFit(left, assignedRole) || right.overall - left.overall)[0];
  if (!replacement) return;
  team.preferredStarterIds.push(replacement.id);
  POSITION_PRESET_KEYS.forEach((key) => { presets[key][replacement.id] = vacatedPositions[key] ?? { x:50, y:50 }; });
  team.positions = clone(presets.position1);
}

function aiLineup(teamIndex, roundNumber, humanOwned) {
  const choose = (pool, count, offset) => {
    const candidates = REAL_PLAYER_POOLS[pool].filter((player) => !humanOwned.has(player.id));
    return Array.from({ length:count }, (_, index) => candidates[(offset + index * 7) % candidates.length]);
  };
  const offset = teamIndex * 13 + roundNumber * 5;
  return [...choose("GK", 1, offset), ...choose("DEF", 4, offset + 3), ...choose("MID", 3, offset + 6), ...choose("ATT", 3, offset + 9)];
}

function publicTeam(team, includeRoster = false) {
  return {
    id:team.id, name:team.name, isAi:!team.ownerId, ownerId:team.ownerId, ownerName:team.ownerName, championBadges:clone(team.championBadges ?? []), table:{ ...team.table }, form:[...team.form], tactic:team.tactic, style:team.style, attackFocus:team.attackFocus, defenseFocus:team.defenseFocus,
    fitnessThreshold:team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD,
    tacticalPlans:clone(team.tacticalPlans ?? { opening:{ tactic:team.tactic, style:team.style, positionPreset:"position1" }, leading:{ tactic:"defensive", style:"counterAttack", positionPreset:"position2" }, trailing:{ tactic:"positive", style:"highPress", positionPreset:"position3" } }),
    roster:includeRoster ? team.rosterIds.map((id) => ({ ...playerSummary(REAL_PLAYER_BY_ID[id]), state:{ fitness:100, suspension:0, cupSuspension:0, injuryRounds:0, ...(team.playerState[id] ?? {}) }, starter:team.preferredStarterIds.includes(id), listed:false })) : undefined,
    positions:includeRoster ? { ...team.positions } : undefined,
    positionPresets:includeRoster ? clone(team.positionPresets ?? Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, team.positions ?? {}]))) : undefined,
    chemistryLinks:includeRoster ? publicChemistryLinks(team) : undefined,
    formation:team.preferredStarterIds.length === 11 ? analyzeElevenFormation(team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]), team.positions).name : null,
  };
}

export class YellowDogsLeagueService {
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.rng = options.rng ?? Math.random;
    this.statePath = options.statePath === undefined ? DEFAULT_STATE_PATH : options.statePath;
    this.backupDir = options.backupDir === undefined && this.statePath
      ? path.join(path.dirname(this.statePath), "yellowdogs-league-backups")
      : options.backupDir;
    this.lastBackupMaintenanceDate = null;
    this.state = loadState(this.statePath, this.now());
    ensureS4Assets(this.state);
    if (!this.state.s4Packs) {
      this.state.s4Packs = { schemaVersion:1, nextSequence:1, inventory:{}, offers:{}, batchOpenings:{}, grants:[], legacyRetiredAt:this.now() };
      this.state.shopOffers = {};
      this.state.rewardOffers = {};
      this.state.adminPackGrants = [];
    }
    this.state.version = 2;
    this.state.ruleset = "S4";
    this.state.s4Packs.schemaVersion = 1;
    this.state.s4Packs.nextSequence = Math.max(1, Number(this.state.s4Packs.nextSequence ?? 1));
    this.state.s4Packs.inventory ??= {};
    this.state.s4Packs.offers ??= {};
    this.state.s4Packs.batchOpenings ??= {};
    this.state.s4Packs.grants ??= [];
    this.state.s4Packs.cardGrants ??= [];
    for (const team of this.state.teams) {
      if (!team.ownerId) continue;
      for (const playerId of team.rosterIds ?? []) {
        if (!cardsForOwner(this.state, team.ownerId, playerId).length) this.grantS4Card(team, playerId, {
          grantOwnership:true,
          acquisitionSource:"legacy-migration",
          acquiredAt:team.joinedAt ?? this.now(),
        });
      }
    }
    this.state.shopOffers ??= {};
    this.state.rewardOffers ??= {};
    this.state.adminPackGrants ??= [];
    this.state.adminPackGrants.forEach((grant) => {
      grant.trigger ??= "round";
      grant.recipientIds ??= [];
    });
    this.state.liveRound ??= null;
    this.state.liveCupRound ??= null;
    this.state.cup ??= { status:"waiting", stage:"waiting", participants:[], table:{}, swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, completedAt:null };
    Object.values(this.state.cup.table ?? {}).forEach((entry) => { entry.status ??= "active"; entry.drawn = 0; });
    this.state.completedBroadcasts ??= [];
    this.state.reports ??= {};
    this.state.inbox ??= {};
    this.state.inboxDeleted ??= {};
    this.state.teams.forEach((team) => {
      team.chemistry ??= {};
      team.championBadges ??= [];
      team.fitnessThreshold = Math.max(45, Math.min(90, Number(team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD)));
      team.positionPresets ??= Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(team.positions ?? {})]));
      POSITION_PRESET_KEYS.forEach((key) => { team.positionPresets[key] ??= clone(team.positions ?? {}); });
      team.tacticalPlans ??= { opening:{ tactic:team.tactic, style:team.style, positionPreset:"position1" }, leading:{ tactic:"defensive", style:"counterAttack", positionPreset:"position2" }, trailing:{ tactic:"positive", style:"highPress", positionPreset:"position3" } };
      ["opening", "leading", "trailing"].forEach((state, index) => {
        team.tacticalPlans[state] ??= state === "opening" ? { tactic:team.tactic, style:team.style } : state === "leading" ? { tactic:"defensive", style:"counterAttack" } : { tactic:"positive", style:"highPress" };
        team.tacticalPlans[state].positionPreset = POSITION_PRESET_KEYS.includes(team.tacticalPlans[state].positionPreset) ? team.tacticalPlans[state].positionPreset : POSITION_PRESET_KEYS[index];
      });
    });
    if (this.state.season.status === "active" && (!this.state.season.nextRoundAt || this.state.season.nextRoundAt < this.now())) this.state.season.nextRoundAt = nextSlot(this.now());
    if (this.state.season.status === "registration") this.state.season.nextRoundAt = null;
    if (this.state.cup.status === "active" && this.state.season.firstRoundAt) {
      const earliestCupAt = this.state.season.firstRoundAt + 10 * 60 * 1000;
      if (!this.state.cup.nextRoundAt || this.state.cup.nextRoundAt < earliestCupAt) this.state.cup.nextRoundAt = nextCupSlot(this.now(), this.state.season.firstRoundAt);
    }
  }

  backupFile(name) {
    if (!this.statePath || !this.backupDir || !existsSync(this.statePath)) return null;
    mkdirSync(this.backupDir, { recursive:true });
    const target = path.join(this.backupDir, name);
    if (!existsSync(target)) copyFileSync(this.statePath, target);
    return target;
  }

  maintainBackups() {
    if (!this.backupDir) return [];
    const date = localDateKey(new Date(this.now()));
    const dailyName = `${date}.json`;
    if (this.lastBackupMaintenanceDate === date && existsSync(path.join(this.backupDir, dailyName))) {
      return readdirSync(this.backupDir).filter((name) => name.endsWith(".json")).sort();
    }
    this.backupFile(dailyName);
    if (!existsSync(this.backupDir)) return [];
    const cutoff = new Date(this.now());
    cutoff.setDate(cutoff.getDate() - (BACKUP_RETENTION_DAYS - 1));
    const cutoffKey = localDateKey(cutoff);
    for (const name of readdirSync(this.backupDir)) {
      const match = name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
      if (match && match[1] < cutoffKey) unlinkSync(path.join(this.backupDir, name));
    }
    this.lastBackupMaintenanceDate = date;
    return readdirSync(this.backupDir).filter((name) => name.endsWith(".json")).sort();
  }

  save(options = {}) {
    assertS4AssetInvariants(this.state);
    this.state.updatedAt = Math.max(this.now(), Number(this.state.updatedAt ?? 0) + 1);
    if (this.statePath) {
      atomicWrite(this.statePath, this.state);
      if (!options.skipDailyBackup) this.maintainBackups();
    }
  }

  playerCards(accountId, playerId = null) {
    return cardsForOwner(this.state, accountId, playerId);
  }

  representativeCard(accountId, playerId) {
    return representativeCard(this.state, accountId, playerId);
  }

  rosterSlotsUsed(accountId) {
    return rosterSlotUsage(this.state, accountId);
  }

  ensureRosterFamily(team, playerId) {
    if (!team.rosterIds.includes(playerId)) team.rosterIds.push(playerId);
    team.playerState[playerId] ??= { fitness:100, suspension:0, cupSuspension:0, injuryRounds:0 };
  }

  removeEmptyRosterFamily(team, playerId) {
    if (this.playerCards(team.ownerId, playerId).length) return false;
    removeRosterPlayerPreservingShape(team, playerId);
    delete team.playerState[playerId];
    removePlayerChemistry(team, playerId);
    return true;
  }

  grantS4Card(team, playerId, options = {}) {
    const alreadyUsesSlot = rosterFamilyUsesSlot(this.state, team.ownerId, playerId);
    const willOwnRights = options.grantOwnership !== false && !REAL_PLAYER_BY_ID[playerId]?.legendAbility;
    const externalExempt = Boolean(options.externalAcquisition)
      && Number(options.upgradeLevel ?? 0) >= 3
      && !willOwnRights;
    if (!alreadyUsesSlot && !externalExempt && this.rosterSlotsUsed(team.ownerId) >= S4_ROSTER_LIMIT) {
      throw new Error("33人名单已满，请先出售或解约一名占用名额的球员");
    }
    const card = createS4Card(this.state, {
      playerId,
      ownerId:team.ownerId,
      upgradeLevel:options.upgradeLevel ?? 0,
      traitIds:options.traitIds ?? [],
      acquisitionSource:options.acquisitionSource ?? "system",
      externalAcquisition:Boolean(options.externalAcquisition),
      acquiredAt:options.acquiredAt ?? this.now(),
      grantOwnership:willOwnRights,
    });
    this.ensureRosterFamily(team, playerId);
    recordS4AssetTransaction(this.state, {
      id:makeId("asset", `${team.ownerId}-${card.id}`),
      type:"card-created",
      playerId,
      cardIds:[card.id],
      toOwnerId:team.ownerId,
      metadata:{ acquisitionSource:card.acquisitionSource, grantOwnership:willOwnRights },
      createdAt:this.now(),
    });
    return card;
  }

  s4PackInventory(accountId) {
    return this.state.s4Packs.inventory[accountId] ?? (this.state.s4Packs.inventory[accountId] = []);
  }

  publicS4PackItem(item) {
    const pack = S4_PACK_BY_ID[item.packType];
    return {
      id:item.id,
      packType:item.packType,
      name:pack?.name ?? item.packType,
      kind:pack?.kind ?? "unknown",
      pool:pack?.pool ?? null,
      selectionMode:pack?.selectionMode ?? "direct",
      description:pack?.description ?? "",
      source:item.source,
      grantId:item.grantId ?? null,
      status:item.status,
      createdAt:item.createdAt,
      openedAt:item.openedAt ?? null,
    };
  }

  grantS4Pack(accountId, packType, quantity = 1, options = {}) {
    const pack = S4_PACK_BY_ID[String(packType ?? "")];
    const count = Math.floor(Number(quantity));
    if (!pack) throw new Error("请选择有效的S4礼包");
    if (!Number.isInteger(count) || count < 1 || count > S4_MAX_PACK_PURCHASE_QUANTITY) throw new Error(`单次礼包数量必须为1至${S4_MAX_PACK_PURCHASE_QUANTITY}`);
    const team = this.accountTeam(accountId);
    if (!team) throw new Error("礼包接收者尚未完成建队");
    const inventory = this.s4PackInventory(accountId);
    const created = [];
    for (let index = 0; index < count; index += 1) {
      const sequence = this.state.s4Packs.nextSequence++;
      const item = {
        id:`s4-pack-${pack.id}-${String(accountId).replace(/[^a-zA-Z0-9_-]/g, "")}-${this.now().toString(36)}-${sequence.toString(36)}`,
        packType:pack.id,
        ownerId:accountId,
        source:options.source ?? "admin",
        grantId:options.grantId ?? null,
        status:"unopened",
        createdAt:this.now(),
      };
      inventory.push(item);
      created.push(item);
    }
    return created;
  }

  randomS4Players(candidates, count) {
    const available = [...candidates];
    const selected = [];
    while (selected.length < count && available.length) {
      const index = Math.floor(this.rng() * available.length);
      selected.push(available.splice(Math.max(0, Math.min(available.length - 1, index)), 1)[0]);
    }
    return selected;
  }

  privatePackCandidates(accountId, pack) {
    return Object.entries(this.state.s4Assets.ownerships)
      .filter(([, ownerId]) => ownerId === accountId)
      .map(([playerId]) => REAL_PLAYER_BY_ID[playerId])
      .filter((player) => player && (pack.pool === "MIXED" || player.pool === pack.pool));
  }

  publicPackCandidates() {
    const reserved = new Set(Object.values(this.state.s4Packs.offers)
      .filter((offer) => offer?.kind === "public" && offer.status === "pending")
      .flatMap((offer) => offer.playerIds ?? []));
    return REAL_PLAYERS.filter((player) => !player.legendAbility && !ownershipOwner(this.state, player.id) && !reserved.has(player.id));
  }

  legendPackCandidates() {
    return REAL_PLAYERS.filter((player) => player.legendAbility);
  }

  buyS4Packs(account, packType, quantity = 1) {
    const team = this.accountTeam(account.id);
    const pack = S4_PACK_BY_ID[String(packType ?? "")];
    const count = Math.floor(Number(quantity));
    if (!team) throw new Error("你还没有加入联赛");
    if (!pack) throw new Error("该礼包已下架或不存在");
    if (!Number.isInteger(count) || count < 1 || count > S4_MAX_PACK_PURCHASE_QUANTITY) throw new Error(`单次最多购买${S4_MAX_PACK_PURCHASE_QUANTITY}份礼包`);
    const total = pack.price * count;
    if (this.wallet(account.id).balance < total) throw new Error("金币不足");
    this.wallet(account.id).balance -= total;
    const items = this.grantS4Pack(account.id, pack.id, count, { source:"shop" });
    this.state.ledger.push({
      id:makeId("ledger", `${account.id}-${pack.id}-${count}`),
      accountId:account.id,
      amount:-total,
      type:"s4-pack-buy",
      packType:pack.id,
      quantity:count,
      packIds:items.map((item) => item.id),
      createdAt:this.now(),
    });
    this.save();
    return this.view(account);
  }

  openS4Pack(account, packIdValue) {
    const team = this.accountTeam(account.id);
    const item = this.s4PackInventory(account.id).find((candidate) => candidate.id === String(packIdValue ?? ""));
    const pack = S4_PACK_BY_ID[item?.packType];
    if (!team || !item || item.status !== "unopened" || !pack) throw new Error("找不到可开启的S4礼包");
    if (this.state.s4Packs.offers[account.id]?.status === "pending") throw new Error("请先完成当前礼包的三选一");
    if (this.state.s4Packs.batchOpenings[account.id]?.status === "active") throw new Error("请先完成当前批量开包");

    if (pack.selectionMode === "direct") {
      const result = this.openDirectS4Pack(account, team, item, pack);
      this.save();
      return { ...this.view(account), packOpening:result };
    }

    this.createS4ChoiceOffer(account, item, pack);
    this.save();
    return this.view(account);
  }

  openDirectS4Pack(account, team, item, pack) {
    const candidates = this.privatePackCandidates(account.id, pack);
    if (!candidates.length) throw new Error(`${pack.name}当前没有可抽取的私有池球员`);
    const player = this.randomS4Players(candidates, 1)[0];
    const card = this.grantS4Card(team, player.id, {
      grantOwnership:false,
      acquisitionSource:"private-pack",
    });
    item.status = "opened";
    item.openedAt = this.now();
    item.resultPlayerId = player.id;
    item.resultCardId = card.id;
    this.state.ledger.push({ id:makeId("ledger", item.id), accountId:account.id, amount:0, type:"s4-pack-open", packType:pack.id, packId:item.id, playerId:player.id, cardId:card.id, createdAt:this.now() });
    recordS4AssetTransaction(this.state, {
      id:makeId("asset-pack", item.id),
      type:"private-pack-card",
      playerId:player.id,
      cardIds:[card.id],
      toOwnerId:account.id,
      metadata:{ packId:item.id, packType:pack.id },
      createdAt:this.now(),
    });
    return { mode:"direct", packId:item.id, player:playerSummary(player), card:publicLeagueS4Card(this.state, card) };
  }

  createS4ChoiceOffer(account, item, pack, batch = null) {
    const candidates = pack.kind === "legend" ? this.legendPackCandidates() : this.publicPackCandidates();
    const choices = this.randomS4Players(candidates, 3);
    if (choices.length !== 3) throw new Error(`${pack.name}当前不足3名可选球员`);
    const offer = {
      id:makeId("s4-pack-offer", item.id),
      packId:item.id,
      packType:pack.id,
      ownerId:account.id,
      kind:pack.kind,
      playerIds:choices.map((player) => player.id),
      status:"pending",
      createdAt:this.now(),
      batchId:batch?.id ?? null,
      batchIndex:batch ? batch.results.length + 1 : null,
      batchTotal:batch?.packIds.length ?? null,
    };
    item.status = "choosing";
    this.state.s4Packs.offers[account.id] = offer;
    return offer;
  }

  publicS4BatchResult(result) {
    const player = REAL_PLAYER_BY_ID[result.playerId];
    const card = this.state.s4Assets.cards[result.cardId];
    return {
      mode:result.mode,
      packId:result.packId,
      player:playerSummary(player),
      card:publicLeagueS4Card(this.state, card),
      ownershipGranted:Boolean(result.ownershipGranted),
    };
  }

  openS4PacksBatch(account, packIdValues) {
    const team = this.accountTeam(account.id);
    const packIds = [...new Set((Array.isArray(packIdValues) ? packIdValues : []).map(String).filter(Boolean))];
    if (!team) throw new Error("你还没有加入联赛");
    if (!packIds.length || packIds.length > S4_MAX_PACK_PURCHASE_QUANTITY) throw new Error(`每次批量打开1至${S4_MAX_PACK_PURCHASE_QUANTITY}份礼包`);
    if (this.state.s4Packs.offers[account.id]?.status === "pending" || this.state.s4Packs.batchOpenings[account.id]?.status === "active") throw new Error("请先完成当前开包流程");
    const inventory = this.s4PackInventory(account.id);
    const items = packIds.map((packId) => inventory.find((item) => item.id === packId));
    if (items.some((item) => !item || item.status !== "unopened")) throw new Error("批量打开中包含不可用的礼包");
    const packTypes = new Set(items.map((item) => item.packType));
    if (packTypes.size !== 1) throw new Error("每次只能批量打开同一种礼包");
    const pack = S4_PACK_BY_ID[items[0].packType];
    if (!pack) throw new Error("礼包已下架或不存在");

    if (pack.selectionMode === "direct") {
      const results = items.map((item) => this.openDirectS4Pack(account, team, item, pack));
      this.save();
      return {
        ...this.view(account),
        packBatchOpening:{ id:makeId("s4-pack-batch", `${account.id}-${pack.id}`), mode:"direct", complete:true, packType:pack.id, total:results.length, results },
      };
    }

    const batch = {
      id:makeId("s4-pack-batch", `${account.id}-${pack.id}`),
      ownerId:account.id,
      packType:pack.id,
      packIds,
      results:[],
      status:"active",
      createdAt:this.now(),
    };
    this.state.s4Packs.batchOpenings[account.id] = batch;
    this.createS4ChoiceOffer(account, items[0], pack, batch);
    this.save();
    return this.view(account);
  }

  chooseS4Pack(account, offerIdValue, playerIdValue) {
    const team = this.accountTeam(account.id);
    const offer = this.state.s4Packs.offers[account.id];
    const playerId = String(playerIdValue ?? "");
    const item = this.s4PackInventory(account.id).find((candidate) => candidate.id === offer?.packId);
    const pack = S4_PACK_BY_ID[offer?.packType];
    if (!team || !offer || offer.status !== "pending" || offer.id !== String(offerIdValue ?? "") || !offer.playerIds.includes(playerId) || !item || !pack) {
      throw new Error("只能选择当前礼包展示的球员");
    }
    if (offer.kind === "public" && ownershipOwner(this.state, playerId)) throw new Error("该球员所有权已经被其他玩家获得，请重新开启礼包");
    const card = this.grantS4Card(team, playerId, {
      grantOwnership:offer.kind === "public",
      acquisitionSource:offer.kind === "public" ? "public-pack" : "legend-pack",
    });
    offer.status = "selected";
    offer.selectedPlayerId = playerId;
    offer.cardId = card.id;
    offer.closedAt = this.now();
    item.status = "opened";
    item.openedAt = this.now();
    item.resultPlayerId = playerId;
    item.resultCardId = card.id;
    delete this.state.s4Packs.offers[account.id];
    this.state.ledger.push({ id:makeId("ledger", item.id), accountId:account.id, amount:0, type:"s4-pack-open", packType:pack.id, packId:item.id, playerId, cardId:card.id, ownershipGranted:offer.kind === "public", createdAt:this.now() });
    const packOpening = { mode:"choice", packId:item.id, player:playerSummary(REAL_PLAYER_BY_ID[playerId]), card:publicLeagueS4Card(this.state, card), ownershipGranted:offer.kind === "public" };
    const batch = offer.batchId ? this.state.s4Packs.batchOpenings[account.id] : null;
    if (batch?.id === offer.batchId && batch.status === "active") {
      batch.results.push({ mode:"choice", packId:item.id, playerId, cardId:card.id, ownershipGranted:offer.kind === "public" });
      if (batch.results.length < batch.packIds.length) {
        const nextPackId = batch.packIds[batch.results.length];
        const nextItem = this.s4PackInventory(account.id).find((candidate) => candidate.id === nextPackId);
        if (!nextItem || nextItem.status !== "unopened") throw new Error("批量开包队列中的下一份礼包不可用");
        this.createS4ChoiceOffer(account, nextItem, pack, batch);
        this.save();
        return { ...this.view(account), packOpening, packBatchOpening:{ id:batch.id, mode:"choice", complete:false, packType:batch.packType, total:batch.packIds.length, completed:batch.results.length } };
      }
      batch.status = "complete";
      batch.completedAt = this.now();
      const batchResult = {
        id:batch.id,
        mode:"choice",
        complete:true,
        packType:batch.packType,
        total:batch.packIds.length,
        results:batch.results.map((result) => this.publicS4BatchResult(result)),
      };
      delete this.state.s4Packs.batchOpenings[account.id];
      this.save();
      return { ...this.view(account), packOpening, packBatchOpening:batchResult };
    }
    this.save();
    return { ...this.view(account), packOpening };
  }

  grantS4PacksFromAdmin(body = {}) {
    const pack = S4_PACK_BY_ID[String(body.packType ?? "")];
    const quantity = Math.floor(Number(body.quantity ?? 1));
    if (!pack) throw new Error("请选择有效的S4礼包");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > S4_MAX_PACK_PURCHASE_QUANTITY) throw new Error(`单次最多发放${S4_MAX_PACK_PURCHASE_QUANTITY}份礼包`);
    const mode = body.recipientMode === "specified" ? "specified" : "all";
    const requestedIds = [...new Set((Array.isArray(body.accountIds) ? body.accountIds : String(body.accountIds ?? "").split(/[\s,，;；]+/)).map(String).filter(Boolean))];
    const teams = this.state.teams.filter((team) => team.ownerId && (mode === "all" || requestedIds.includes(team.ownerId)));
    if (!teams.length) throw new Error(mode === "all" ? "当前没有已完成建队的玩家" : "没有找到指定的已建队玩家");
    if (mode === "specified") {
      const found = new Set(teams.map((team) => team.ownerId));
      const missing = requestedIds.filter((id) => !found.has(id));
      if (missing.length) throw new Error(`以下玩家尚未完成建队或不存在：${missing.join("、")}`);
    }
    const grant = {
      id:makeId("s4-pack-grant", `${pack.id}-${mode}`),
      packType:pack.id,
      quantity,
      recipientMode:mode,
      recipientIds:teams.map((team) => team.ownerId),
      recipientCount:teams.length,
      createdAt:this.now(),
    };
    teams.forEach((team) => {
      this.grantS4Pack(team.ownerId, pack.id, quantity, { source:"admin", grantId:grant.id });
      this.pushInbox(team, {
        id:`s4-pack-grant:${grant.id}:${team.ownerId}`,
        type:"reward",
        title:"S4礼包已经发放",
        summary:`管理员向你发放了${quantity}份${pack.name}。`,
        body:`${quantity}份${pack.name}已经进入礼包背包，可以随时开启。`,
        payload:{ grantId:grant.id, packType:pack.id, quantity },
      });
    });
    this.state.s4Packs.grants.push(grant);
    this.save();
    return this.adminView();
  }

  grantS4PlayerCardsFromAdmin(body = {}) {
    const accountId = String(body.accountId ?? "");
    const playerId = String(body.playerId ?? "");
    const upgradeLevel = Number(body.upgradeLevel);
    const quantity = Number(body.quantity ?? 1);
    const team = this.accountTeam(accountId);
    const player = REAL_PLAYER_BY_ID[playerId];
    if (!team) throw new Error("请选择已经完成建队的玩家");
    if (!player) throw new Error("请选择有效的球员");
    if (!Number.isInteger(upgradeLevel) || upgradeLevel < 0 || upgradeLevel > 8) throw new Error("强化等级必须为0至8的整数");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > S4_MAX_PACK_PURCHASE_QUANTITY) throw new Error(`单次最多发放${S4_MAX_PACK_PURCHASE_QUANTITY}张球员卡`);
    const currentOwner = ownershipOwner(this.state, playerId);
    const grantOwnership = !player.legendAbility && !currentOwner;
    const grant = {
      id:makeId("s4-card-grant", `${accountId}-${playerId}-${upgradeLevel}`),
      accountId,
      teamId:team.id,
      teamName:team.name,
      ownerName:team.ownerName,
      playerId,
      playerName:player.name,
      upgradeLevel,
      quantity,
      ownershipGranted:grantOwnership,
      createdAt:this.now(),
    };
    const cards = Array.from({ length:quantity }, () => this.grantS4Card(team, playerId, {
      upgradeLevel,
      grantOwnership,
      externalAcquisition:true,
      acquisitionSource:"admin-player-card",
    }));
    this.state.ledger.push({
      id:makeId("ledger", grant.id),
      accountId,
      amount:0,
      type:"admin-player-card-grant",
      playerId,
      cardIds:cards.map((card) => card.id),
      upgradeLevel,
      quantity,
      grantId:grant.id,
      createdAt:this.now(),
    });
    this.pushInbox(team, {
      id:`s4-card-grant:${grant.id}:${accountId}`,
      type:"reward",
      title:"指定球员卡已经发放",
      summary:`管理员向你发放了${quantity}张${player.name}${upgradeLevel ? ` +${upgradeLevel}` : ""}球员卡。`,
      body:`球员卡已经进入背包。${grantOwnership ? "你同时获得了该非传奇球员的所有权。" : "本次发放没有改变该球员的所有权归属。"}`,
      payload:{ grantId:grant.id, playerId, playerName:player.name, upgradeLevel, quantity, cardIds:cards.map((card) => card.id), ownershipGranted:grantOwnership },
    });
    (this.state.s4Packs.cardGrants ??= []).push(grant);
    this.save();
    return this.adminView();
  }

  ownedPlayerIds(exceptAccountId = null) {
    return new Set(Object.entries(this.state.s4Assets.ownerships)
      .filter(([, ownerId]) => ownerId !== exceptAccountId)
      .map(([playerId]) => playerId));
  }

  reservedPlayerIds(exceptAccountId = null) {
    return new Set([
      ...Object.entries(this.state.drafts).filter(([accountId]) => accountId !== exceptAccountId).flatMap(([, draft]) => draft.selectedIds),
      ...Object.entries(this.state.shopOffers).filter(([accountId]) => accountId !== exceptAccountId).flatMap(([, offer]) => offer.playerIds ?? []),
      ...Object.entries(this.state.rewardOffers).filter(([accountId]) => accountId !== exceptAccountId).flatMap(([, offers]) => (offers ?? []).flatMap((offer) => offer.playerIds ?? [])),
      ...Object.entries(this.state.s4Packs.offers).filter(([accountId, offer]) => accountId !== exceptAccountId && offer?.status === "pending").flatMap(([, offer]) => offer.playerIds ?? []),
    ]);
  }

  unavailablePlayerIds(exceptAccountId = null) {
    return new Set([...this.ownedPlayerIds(exceptAccountId), ...this.reservedPlayerIds(exceptAccountId)]);
  }

  accountTeam(accountId) {
    return this.state.teams.find((team) => team.ownerId === accountId) ?? null;
  }

  wallet(accountId) {
    if (!this.state.wallets[accountId]) this.state.wallets[accountId] = { balance:INITIAL_WALLET_BALANCE };
    return this.state.wallets[accountId];
  }

  pushInbox(team, message) {
    if (!team?.ownerId) return null;
    const inbox = this.state.inbox[team.id] ?? (this.state.inbox[team.id] = []);
    const deletedIds = new Set(this.state.inboxDeleted[team.id] ?? []);
    const messageId = message.id ?? makeId("mail", `${team.id}-${message.type}`);
    if (deletedIds.has(messageId)) return null;
    const entry = {
      id:messageId,
      type:message.type ?? "notice",
      title:String(message.title ?? "联赛通知"),
      summary:String(message.summary ?? ""),
      body:String(message.body ?? ""),
      createdAt:Number(message.createdAt ?? this.now()),
      round:message.round ?? null,
      matchId:message.matchId ?? null,
      report:message.report ? clone(message.report) : null,
      payload:message.payload ? clone(message.payload) : null,
      readAt:null,
    };
    const index = inbox.findIndex((item) => item.id === entry.id);
    if (index >= 0) inbox[index] = entry;
    else inbox.push(entry);
    this.state.inbox[team.id] = inbox.sort((left, right) => left.createdAt - right.createdAt).slice(-120);
    return entry;
  }

  notifyEnhancementSuccess(team, player, card, details) {
    const upgradeLevel = Number(card?.upgradeLevel ?? 0);
    if (!team?.ownerId || !details?.success || upgradeLevel < 5 || upgradeLevel > 8) return;
    const chance = Number(details.chance ?? 0);
    const ownerName = team.ownerName ?? "玩家";
    const playerInfo = `${player.club ?? "自由球员"} / ${player.nationality ?? "未知国家队"} / ${player.role} / 能力 ${player.overall}`;
    this.state.teams.filter((recipient) => recipient.ownerId && recipient.ownerId !== team.ownerId).forEach((recipient) => this.pushInbox(recipient, {
      id:`enhancement-success:${details.resultId}:${recipient.ownerId}`,
      type:"announcement",
      title:`${player.name}强化至+${upgradeLevel}`,
      summary:`${ownerName}以${chance}%的成功率，将${player.name}强化至+${upgradeLevel}。`,
      body:`玩家${ownerName}（${team.name}）完成了${player.name}的+${upgradeLevel}强化。本次使用+${details.beforeLevel}主卡与+${details.materialLevel}副卡，合成成功率为${chance}%。球员信息：${playerInfo}。`,
      payload:{
        accountId:team.ownerId,
        ownerName,
        teamId:team.id,
        teamName:team.name,
        playerId:player.id,
        playerName:player.name,
        club:player.club,
        nationality:player.nationality,
        role:player.role,
        overall:player.overall,
        beforeLevel:Number(details.beforeLevel),
        materialLevel:Number(details.materialLevel),
        upgradeLevel,
        chance,
      },
    }));
  }

  notifyEnhancementTraitBinding(team, player, card, trait, offer) {
    if (!team?.ownerId || !trait || ![5, 8].includes(Number(card?.upgradeLevel))) return;
    const ownerName = team.ownerName ?? "玩家";
    const chance = Number(offer?.chance ?? 0);
    this.state.teams.filter((recipient) => recipient.ownerId && recipient.ownerId !== team.ownerId).forEach((recipient) => this.pushInbox(recipient, {
      id:`enhancement-trait:${offer.id}:${recipient.ownerId}`,
      type:"announcement",
      title:`${player.name} +${card.upgradeLevel}绑定特性`,
      summary:`${ownerName}为${player.name}绑定了特性“${trait.name}”。`,
      body:`玩家${ownerName}（${team.name}）为+${card.upgradeLevel}的${player.name}绑定了特性“${trait.name}”。特性效果：${trait.summary ?? "特性效果由联赛后台配置。"}${chance ? ` 本次关键等级强化的成功率为${chance}%。` : ""}`,
      payload:{
        accountId:team.ownerId,
        ownerName,
        teamId:team.id,
        teamName:team.name,
        playerId:player.id,
        playerName:player.name,
        club:player.club,
        nationality:player.nationality,
        role:player.role,
        overall:player.overall,
        upgradeLevel:Number(card.upgradeLevel),
        chance,
        traitId:trait.id,
        traitName:trait.name,
        traitSummary:trait.summary ?? "",
      },
    }));
  }

  inbox(team) {
    return clone((this.state.inbox[team.id] ?? []).slice().sort((left, right) => right.createdAt - left.createdAt));
  }

  readInbox(account, messageIdValue) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const message = (this.state.inbox[team.id] ?? []).find((entry) => entry.id === String(messageIdValue ?? ""));
    if (!message) throw new Error("找不到这封邮件");
    if (!message.readAt) {
      message.readAt = this.now();
      this.save();
    }
    return this.view(account);
  }

  deleteInbox(account, messageIdValue) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const messageId = String(messageIdValue ?? "");
    const inbox = this.state.inbox[team.id] ?? [];
    if (!inbox.some((entry) => entry.id === messageId)) throw new Error("找不到这封邮件");
    this.state.inbox[team.id] = inbox.filter((entry) => entry.id !== messageId);
    const deleted = this.state.inboxDeleted[team.id] ?? (this.state.inboxDeleted[team.id] = []);
    if (!deleted.includes(messageId)) deleted.push(messageId);
    this.state.inboxDeleted[team.id] = deleted.slice(-500);
    this.save();
    return this.view(account);
  }

  cupStandings() {
    const cup = this.state.cup;
    return cup.participants.map((teamId) => {
      const team = this.state.teams.find((entry) => entry.id === teamId);
      return { id:teamId, name:team?.name ?? "未知球队", ...(cup.table[teamId] ?? { played:0, won:0, drawn:0, lost:0, goalsFor:0, goalsAgainst:0, points:0, seed:TEAM_COUNT, status:"active" }) };
    }).sort((left, right) => {
      const leftPerfectQualifier = left.won >= 3 && left.lost === 0 ? 1 : 0;
      const rightPerfectQualifier = right.won >= 3 && right.lost === 0 ? 1 : 0;
      return rightPerfectQualifier - leftPerfectQualifier || right.points - left.points || (right.goalsFor - right.goalsAgainst) - (left.goalsFor - left.goalsAgainst) || right.goalsFor - left.goalsFor || left.seed - right.seed || left.name.localeCompare(right.name, "zh-CN");
    })
      .map((entry, index) => ({ ...entry, rank:index + 1 }));
  }

  cupView() {
    const cup = this.state.cup;
    const teamName = (id) => this.state.teams.find((team) => team.id === id)?.name ?? "待定";
    const decorateTie = (tie) => ({ ...tie, teams:tie.teams.map((id) => ({ id, name:teamName(id) })), legs:tie.legs.map((leg) => ({ ...leg, homeName:teamName(leg.homeId), awayName:teamName(leg.awayId) })) });
    return clone({
      status:cup.status,
      stage:cup.stage,
      startedAt:cup.startedAt,
      completedAt:cup.completedAt,
      nextRoundAt:cup.nextRoundAt,
      championId:cup.championId,
      championName:cup.championId ? teamName(cup.championId) : null,
      swissRounds:cup.swissRounds.map((round) => ({ ...round, fixtures:round.fixtures.map((fixture) => ({ ...fixture, homeName:teamName(fixture.homeId), awayName:teamName(fixture.awayId) })) })),
      standings:this.cupStandings(),
      knockout:{ quarterfinals:cup.knockout.quarterfinals.map(decorateTie), semifinals:cup.knockout.semifinals.map(decorateTie), final:cup.knockout.final.map(decorateTie) },
    });
  }

  startCup() {
    if (this.state.season.status !== "active") throw new Error("请先在后台开启联赛推进，再开启黄狗冠军杯");
    if (this.state.cup.status !== "waiting") throw new Error("杯赛已经开启，请先完成或重置当前杯赛");
    const participants = this.state.teams.map((team) => team.id);
    if (participants.length !== TEAM_COUNT) throw new Error("杯赛需要10支球队");
    const seedOrder = this.standings();
    const table = Object.fromEntries(seedOrder.map((entry) => [entry.id, { played:0, won:0, drawn:0, lost:0, goalsFor:0, goalsAgainst:0, points:0, seed:entry.rank, status:"active" }]));
    this.state.cup = { status:"active", stage:"swiss", participants, table, swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:nextCupSlot(this.now(), this.state.season.firstRoundAt ?? this.state.season.nextRoundAt), championId:null, startedAt:this.now(), completedAt:null };
    this.createSwissRound();
    this.save();
    return this.adminView();
  }

  createSwissRound() {
    const cup = this.state.cup;
    const number = Math.max(0, ...cup.swissRounds.map((round) => Number(round.number) || 0)) + 1;
    const standings = this.cupStandings().filter((team) => team.status === "active");
    if (standings.length < 2) return null;
    const played = new Set(cup.swissRounds.flatMap((round) => round.fixtures.map((fixture) => [fixture.homeId, fixture.awayId].sort().join(":"))));
    const remaining = [...standings];
    const fixtures = [];
    while (remaining.length) {
      const home = remaining.shift();
      let index = remaining.findIndex((candidate) => !played.has([home.id, candidate.id].sort().join(":")));
      if (index < 0) index = 0;
      const away = remaining.splice(index, 1)[0];
      fixtures.push({ id:`cup-swiss-${number}-${home.id}-${away.id}`, homeId:home.id, awayId:away.id, matchId:null, status:"pending" });
    }
    const round = { number, status:"pending", fixtures };
    cup.swissRounds.push(round);
    cup.events.push({ id:`cup-swiss-${number}`, stage:"swiss", round:number, leg:1, status:"pending", fixtureIds:fixtures.map((fixture) => fixture.id) });
    return round;
  }

  normalizeSwissField(round) {
    let standings = this.cupStandings();
    const active = standings.filter((team) => team.status === "active");
    const eliminatedCount = standings.filter((team) => team.status === "eliminated").length;
    if (eliminatedCount < 2 && active.length % 2 === 1) {
      const automaticElimination = standings.find((team) => team.rank === 9 && team.status === "active") ?? active.at(-1);
      if (automaticElimination) {
        this.state.cup.table[automaticElimination.id].status = "eliminated";
        round.automaticEliminationId = automaticElimination.id;
        round.automaticEliminationRank = automaticElimination.rank;
        round.requiresFinalSeedingRound = true;
        standings = this.cupStandings();
      }
    }
    return standings;
  }

  view(account, options = {}) {
    const team = this.accountTeam(account.id);
    const draft = this.state.drafts[account.id] ?? null;
    const pendingTraitOffer = Object.values(this.state.s4Assets.traitOffers ?? {}).find((offer) => offer.ownerId === account.id && offer.status === "pending") ?? null;
    const listingByPlayer = new Map(this.state.listings.filter((item) => item.status === "active").map((item) => [item.playerId, item]));
    const ownTeam = team ? publicTeam(team, true) : null;
    if (ownTeam) ownTeam.roster.forEach((player) => {
      const source = REAL_PLAYER_BY_ID[player.id];
      const cards = this.playerCards(account.id, player.id);
      const activeCard = cards[0] ?? null;
      player.listed = listingByPlayer.has(player.id);
      player.referencePrice = minimumPrice(source);
      player.minimumPrice = minimumListingPrice(source);
      player.cards = cards.map((card) => publicLeagueS4Card(this.state, card));
      player.activeCardId = activeCard?.id ?? null;
      player.upgradeLevel = Number(activeCard?.upgradeLevel ?? 0);
      player.ownsRights = ownershipOwner(this.state, player.id) === account.id;
      player.rosterSlotUsed = rosterFamilyUsesSlot(this.state, account.id, player.id);
      player.releaseValue = Number(activeCard?.upgradeLevel ?? 0) <= 1
        ? s4SingleCardReleaseValue(source, activeCard?.upgradeLevel)
          + (player.ownsRights && cards.length === 1 ? Math.floor(minimumPrice(source) * S4_OWNERSHIP_RETURN_RATE) : 0)
        : null;
    });
    if (ownTeam) ownTeam.s4Assets = publicS4AssetsForOwner(this.state, account.id);
    if (ownTeam) {
      const starters = ownTeam.roster.filter((player) => team.preferredStarterIds.includes(player.id)).map((player) => {
        const activeCard = player.cards.find((card) => card.id === player.activeCardId) ?? player.cards[0];
        return { ...player, traits:(activeCard?.traits ?? []).map((trait) => trait.id) };
      });
      ownTeam.bonds = evaluateS4LineupBonds(starters, S4_BOND_CATALOG);
    }
    return clone({
      updatedAt:this.state.updatedAt,
      season:this.state.season,
      cup:this.cupView(),
      serverTime:this.now(),
      schedule:{ activeHours:"10:00 - 22:00", intervalMinutes:20, serverPause:true, fixtures:team ? this.teamSchedule(team.id) : [] },
      teams:this.standings().map((entry) => ({ ...publicTeam(this.state.teams.find((teamEntry) => teamEntry.id === entry.id)), rank:entry.rank })),
      ownTeam,
      bondCatalog:S4_BOND_CATALOG,
      draft:draft ? {
        teamId:draft.teamId,
        selectedIds:[...draft.selectedIds],
        selectedPlayers:draft.selectedIds.map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
        counts:draftCounts(draft.selectedIds),
        offerPool:draft.offerPool ?? null,
        offer:(draft.offerIds ?? []).map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
        allowedPools:this.allowedDraftPools(draft),
      } : null,
      aiSlotsRemaining:this.state.teams.filter((entry) => !entry.ownerId && !Object.values(this.state.drafts).some((item) => item.teamId === entry.id)).length,
      wallet:this.wallet(account.id),
      shop:{
        catalog:S4_PACK_CATALOG.map((pack) => ({ ...pack })),
        maxPurchaseQuantity:S4_MAX_PACK_PURCHASE_QUANTITY,
      },
      enhancement:{
        maxLevel:S4_ENHANCEMENT_MAX_LEVEL,
        equalLevelChances:[...S4_ENHANCEMENT_EQUAL_CHANCES],
        protectionCosts:[...S4_ENHANCEMENT_PROTECTION_COSTS],
        lowerMaterialMultiplier:.52,
        higherMaterialMultiplier:1.35,
        traitOffer:pendingTraitOffer ? {
          id:pendingTraitOffer.id,
          cardId:pendingTraitOffer.cardId,
          playerId:pendingTraitOffer.playerId,
          playerName:REAL_PLAYER_BY_ID[pendingTraitOffer.playerId]?.name,
          upgradeLevel:pendingTraitOffer.upgradeLevel,
          traits:pendingTraitOffer.traitIds.map((id) => ({
            id,
            name:YDL_TRAIT_BY_ID[id]?.name ?? id,
            summary:YDL_TRAIT_BY_ID[id]?.summary ?? "特性效果由联赛后台配置。",
            eligibleRoleGroups:[...(YDL_TRAIT_BY_ID[id]?.eligibleRoleGroups ?? ["ANY"])],
          })),
        } : null,
      },
      s4Packs:{
        inventory:this.s4PackInventory(account.id).filter((item) => ["unopened", "choosing"].includes(item.status)).map((item) => this.publicS4PackItem(item)),
        offer:this.state.s4Packs.offers[account.id]?.status === "pending" ? {
          ...clone(this.state.s4Packs.offers[account.id]),
          players:this.state.s4Packs.offers[account.id].playerIds.map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
          playerIds:undefined,
        } : null,
        batchOpening:this.state.s4Packs.batchOpenings[account.id]?.status === "active" ? {
          id:this.state.s4Packs.batchOpenings[account.id].id,
          packType:this.state.s4Packs.batchOpenings[account.id].packType,
          total:this.state.s4Packs.batchOpenings[account.id].packIds.length,
          completed:this.state.s4Packs.batchOpenings[account.id].results.length,
          remaining:this.state.s4Packs.batchOpenings[account.id].packIds.length - this.state.s4Packs.batchOpenings[account.id].results.length,
          status:"active",
        } : null,
      },
      leaderboards:this.leaderboards(),
      cupLeaderboards:this.cupLeaderboards(),
      teamLeaderboards:team ? this.leaderboards(team.id) : { scorers:[], assists:[], ratings:[], saves:[], cards:[] },
      matchRounds:this.matchRounds(),
      recentMatches:this.state.matches.slice().reverse().map((match) => this.matchSummary(match)),
      rewardOffers:[],
      listings:this.state.listings.filter((item) => item.status === "active").map((item) => ({
        ...item,
        player:playerSummary(REAL_PLAYER_BY_ID[item.playerId]),
        card:item.cardId && this.state.s4Assets.cards[item.cardId] ? publicLeagueS4Card(this.state, this.state.s4Assets.cards[item.cardId]) : null,
        sellerTeamName:this.state.teams.find((entry) => entry.id === item.sellerTeamId)?.name ?? "未知球队",
      })),
      inbox:team ? this.inbox(team) : [],
      inboxUnreadCount:team ? (this.state.inbox[team.id] ?? []).filter((message) => !message.readAt).length : 0,
      report:team ? this.teamReport(team) : null,
      reportHistory:team ? clone((this.state.reports[team.id] ?? []).slice(-7).reverse()) : [],
      developer:Boolean(options.developer),
    });
  }

  standings() {
    return [...this.state.teams].sort((a,b) => b.table.points - a.table.points || (b.table.goalsFor - b.table.goalsAgainst) - (a.table.goalsFor - a.table.goalsAgainst) || b.table.goalsFor - a.table.goalsFor || a.name.localeCompare(b.name, "zh-CN"))
      .map((team, index) => ({ id:team.id, rank:index + 1 }));
  }

  leaderboards(teamId = null) {
    const entries = Object.values(this.state.playerStats).filter((entry) => !teamId || entry.teamId === teamId).map((entry) => ({ ...entry, averageRating:entry.appearances ? Number((entry.ratingTotal / entry.appearances).toFixed(2)) : 0 }));
    const limit = teamId ? CLUB_ROSTER_LIMIT : 20;
    const sort = (field) => [...entries].filter((entry) => entry[field] > 0).sort((a,b) => b[field] - a[field] || b.averageRating - a.averageRating).slice(0, limit);
    return { scorers:sort("goals"), assists:sort("assists"), ratings:[...entries].filter((entry) => entry.appearances >= Math.max(1, Math.ceil(this.state.season.currentRound * .25))).sort((a,b) => b.averageRating - a.averageRating).slice(0,limit), saves:sort("saves"), cards:[...entries].filter((entry) => entry.yellowCards || entry.redCards).sort((a,b) => b.redCards - a.redCards || b.yellowCards - a.yellowCards).slice(0,limit) };
  }

  cupLeaderboards() {
    const entries = Object.values(this.state.cup?.playerStats ?? {}).map((entry) => ({ ...entry, averageRating:entry.appearances ? Number((entry.ratingTotal / entry.appearances).toFixed(2)) : 0 }));
    const sort = (field) => [...entries].filter((entry) => entry[field] > 0).sort((a,b) => b[field] - a[field] || b.averageRating - a.averageRating).slice(0, 20);
    return { scorers:sort("goals"), assists:sort("assists"), ratings:[...entries].filter((entry) => entry.appearances > 0).sort((a,b) => b.averageRating - a.averageRating).slice(0,20), saves:sort("saves"), cards:[...entries].filter((entry) => entry.yellowCards || entry.redCards).sort((a,b) => b.redCards - a.redCards || b.yellowCards - a.yellowCards).slice(0,20) };
  }

  matchSummary(match) {
    const home = this.state.teams.find((team) => team.id === match.homeId);
    const away = this.state.teams.find((team) => team.id === match.awayId);
    return {
      id:match.id,
      round:match.round,
      playedAt:match.playedAt,
      homeId:match.homeId,
      awayId:match.awayId,
      homeName:home?.name ?? match.homeName ?? "未知球队",
      awayName:away?.name ?? match.awayName ?? "未知球队",
      score:[...(match.score ?? [0, 0])],
      formations:[...(match.formations ?? [])],
      hasPlayerTeam:Boolean(home?.ownerId || away?.ownerId),
      hasDetails:Boolean(match.report),
    };
  }

  matchRounds() {
    const byFixture = new Map(this.state.matches.map((match) => [`${match.round}:${match.homeId}:${match.awayId}`, match]));
    return this.state.rounds.slice().sort((left, right) => left.number - right.number).map((round) => ({
      round:round.number,
      status:round.status,
      matches:round.fixtures.map((fixture) => {
        const match = byFixture.get(`${round.number}:${fixture.homeId}:${fixture.awayId}`);
        if (match) return this.matchSummary(match);
        const home = this.state.teams.find((team) => team.id === fixture.homeId);
        const away = this.state.teams.find((team) => team.id === fixture.awayId);
        return {
          id:null,
          round:round.number,
          homeId:fixture.homeId,
          awayId:fixture.awayId,
          homeName:home?.name ?? "未知球队",
          awayName:away?.name ?? "未知球队",
          score:null,
          formations:[],
          hasPlayerTeam:Boolean(home?.ownerId || away?.ownerId),
          hasDetails:false,
          pending:true,
        };
      }),
    }));
  }

  teamSchedule(teamId) {
    if (this.state.season.status === "registration") return [];
    const rounds = this.state.rounds.slice().sort((left, right) => left.number - right.number);
    const runningRound = rounds.find((round) => round.status === "running");
    let nextScheduledAt = runningRound ? nextSlot(this.now()) : Number(this.state.season.nextRoundAt ?? nextSlot(this.now()));
    let pendingIndex = 0;
    const leagueFixtures = rounds.map((round) => {
      const fixture = round.fixtures.find((entry) => entry.homeId === teamId || entry.awayId === teamId);
      if (!fixture) return null;
      const ownIsHome = fixture.homeId === teamId;
      const opponentId = ownIsHome ? fixture.awayId : fixture.homeId;
      const opponent = this.state.teams.find((team) => team.id === opponentId);
      const match = fixture.matchId ? this.state.matches.find((entry) => entry.id === fixture.matchId) : null;
      const conditions = this.fixtureConditions(fixture, round.number);
      const live = round.status === "running"
        ? this.state.liveRound?.matches.find((entry) => entry.fixtureIndex === round.fixtures.indexOf(fixture) && !entry.completed)
        : null;
      let startsAt;
      if (match) startsAt = match.playedAt;
      else if (round.status === "running") startsAt = Number(this.state.liveRound?.startedAt ?? this.now());
      else { startsAt = nextScheduledAt + pendingIndex * ROUND_INTERVAL_MS; pendingIndex += 1; }
      return {
        id:`league:${this.state.season.id}:${round.number}:${teamId}`,
        competition:"league",
        competitionName:"黄狗联赛",
        round:round.number,
        label:`第${round.number}轮`,
        startsAt,
        status:match ? "complete" : round.status === "running" ? "live" : "scheduled",
        opponentId,
        opponentName:opponent?.name ?? "待定球队",
        venue:ownIsHome ? "home" : "away",
        matchId:match?.id ?? null,
        broadcastCode:live?.code ?? null,
        score:match ? (ownIsHome ? [...match.score] : [match.score[1], match.score[0]]) : null,
        weather:conditions.weather,
        referee:conditions.referee,
      };
    }).filter(Boolean);
    const cupFixtures = this.state.cup.events.flatMap((event) => this.cupEventFixtures(event).map((fixture) => {
      if (fixture.homeId !== teamId && fixture.awayId !== teamId) return null;
      const ownIsHome = fixture.homeId === teamId;
      const match = fixture.matchId ? this.state.matches.find((entry) => entry.id === fixture.matchId) : null;
      const live = this.state.liveCupRound?.matches.find((entry) => entry.fixtureId === fixture.id && !entry.completed);
      const conditions = this.fixtureConditions(fixture, event.round);
      const label = event.stage === "swiss" ? `瑞士轮第${event.round}轮` : `${CUP_STAGE_NAMES[event.stage] ?? event.stage} · 第${event.leg}回合`;
      return { id:`cup:${fixture.id}`, competition:"cup", competitionName:"黄狗冠军杯", round:event.round, stage:event.stage, leg:event.leg, label, startsAt:match?.playedAt ?? (live ? this.state.liveCupRound.startedAt : event.status === "pending" ? this.state.cup.nextRoundAt : this.now()), status:match ? "complete" : live ? "live" : "scheduled", opponentId:ownIsHome ? fixture.awayId : fixture.homeId, opponentName:this.state.teams.find((team) => team.id === (ownIsHome ? fixture.awayId : fixture.homeId))?.name ?? "待定", venue:ownIsHome ? "home" : "away", matchId:match?.id ?? null, broadcastCode:live?.code ?? null, score:match ? (ownIsHome ? [...match.score] : [match.score[1], match.score[0]]) : null, weather:conditions.weather, referee:conditions.referee };
    }).filter(Boolean));
    return [...leagueFixtures, ...cupFixtures].sort((left, right) => left.startsAt - right.startsAt || left.competition.localeCompare(right.competition));
  }

  teamHistory(teamId) {
    return this.state.matches
      .filter((match) => match.homeId === teamId || match.awayId === teamId)
      .sort((left, right) => right.round - left.round || right.playedAt - left.playedAt)
      .map((match) => this.matchSummary(match));
  }

  teamDetail(account, teamIdValue) {
    const team = this.state.teams.find((entry) => entry.id === String(teamIdValue ?? ""));
    if (!team) throw new Error("找不到这支球队");
    const lineup = team.ownerId
      ? team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean)
      : this.actualLineup(team, Math.max(1, this.state.season.currentRound + 1));
    const positions = this.actualPositions(team, lineup);
    const publicPlayer = (player) => ({
      ...playerSummary(player),
      upgradeLevel:Number(this.representativeCard(team.ownerId, player.id)?.upgradeLevel ?? 0),
    });
    const roster = team.ownerId
      ? team.rosterIds.map((id) => publicPlayer(REAL_PLAYER_BY_ID[id]))
      : lineup.map(publicPlayer);
    return clone({
      id:team.id,
      name:team.name,
      isAi:!team.ownerId,
      ownerName:team.ownerName,
      table:{ ...team.table },
      formation:lineup.length === 11 ? analyzeElevenFormation(lineup, positions).name : null,
      starters:lineup.map((player) => ({ ...publicPlayer(player), position:{ ...positions[player.id] } })),
      roster,
      history:this.teamHistory(team.id),
      isOwn:team.ownerId === account.id,
    });
  }

  matchDetail(account, matchIdValue) {
    const match = this.state.matches.find((entry) => entry.id === String(matchIdValue ?? ""));
    if (!match?.report) throw new Error("找不到这场比赛的详细记录");
    const ownTeam = this.accountTeam(account.id);
    const viewerIndex = ownTeam?.id === match.awayId ? 1 : 0;
    const detail = hydrateHistoricalMatchDetail({
      ...match.report,
      playedAt:match.playedAt,
      roomCode:`YDL · 第${match.round}轮`,
      round:match.round,
      viewerIndex,
    });
    if (detail.teams?.[0]) detail.teams[0].name = this.state.teams.find((team) => team.id === match.homeId)?.name ?? detail.teams[0].name;
    if (detail.teams?.[1]) detail.teams[1].name = this.state.teams.find((team) => team.id === match.awayId)?.name ?? detail.teams[1].name;
    return clone(detail);
  }

  beginDraft(account, teamNameValue) {
    if (this.accountTeam(account.id)) throw new Error("你已经拥有一支 YellowDogs League 球队");
    if (this.state.drafts[account.id]) return this.view(account);
    const teamName = String(teamNameValue ?? "").trim();
    if (!teamName) throw new Error("球队名称不能为空");
    if (teamName.length > 30) throw new Error("球队名称最多30个字符");
    const normalizedName = teamName.toLocaleLowerCase("zh-CN");
    if (this.state.teams.some((team) => team.name.toLocaleLowerCase("zh-CN") === normalizedName)
      || Object.values(this.state.drafts).some((draft) => draft.teamName.toLocaleLowerCase("zh-CN") === normalizedName)) throw new Error("该球队名称已经被使用");
    const reservedTeamIds = new Set(Object.values(this.state.drafts).map((draft) => draft.teamId));
    const availableTeams = this.state.teams.filter((entry) => !entry.ownerId && !reservedTeamIds.has(entry.id));
    const cupRanks = new Map(this.cupStandings().map((entry) => [entry.id, entry.rank]));
    const team = this.state.cup.status === "waiting"
      ? availableTeams[0]
      : availableTeams.sort((left, right) => (cupRanks.get(left.id) ?? TEAM_COUNT) - (cupRanks.get(right.id) ?? TEAM_COUNT))[0];
    if (!team) throw new Error("当前10支球队都已由真人接管");
    this.state.drafts[account.id] = { teamId:team.id, teamName, selectedIds:[], offerIds:[], offerPool:null, startedAt:this.now() };
    this.save();
    return this.view(account);
  }

  allowedDraftPools(draft) {
    return draft.selectedIds.length < DRAFT_ROSTER_SIZE ? ["ATT", "MID", "DEF", "GK"] : [];
  }

  drawDraft(account, pool) {
    const draft = this.state.drafts[account.id];
    if (!draft || !REAL_PLAYER_POOLS[pool]) throw new Error("当前没有可用的选秀位置");
    if (draft.offerIds?.length) throw new Error("请先从当前三张卡牌中签下一人");
    if (!this.allowedDraftPools(draft).includes(pool)) throw new Error("注册名单已经选满22人");
    const unavailable = [...this.unavailablePlayerIds(account.id), ...draft.selectedIds];
    const choices = drawUniquePlayers(pool, unavailable, this.rng, 3);
    if (choices.length !== 3) throw new Error("该位置已经没有足够的唯一球员可供翻卡");
    draft.offerPool = pool;
    draft.offerIds = choices.map((player) => player.id);
    this.save();
    return this.view(account);
  }

  chooseDraft(account, playerId) {
    const draft = this.state.drafts[account.id];
    if (!draft?.offerIds?.includes(playerId)) throw new Error("只能选择本次翻开的三张卡牌");
    if (draft.selectedIds.length >= DRAFT_ROSTER_SIZE) throw new Error("建队选秀最多22人");
    if (this.unavailablePlayerIds(account.id).has(playerId)) {
      draft.offerIds = [];
      draft.offerPool = null;
      this.save();
      throw new Error("该球员刚刚被其他真人球队签下，请重新翻卡");
    }
    draft.selectedIds.push(playerId);
    draft.offerIds = [];
    draft.offerPool = null;
    this.save();
    return this.view(account);
  }

  resetDraft(account) {
    const draft = this.state.drafts[account.id];
    if (!draft) throw new Error("当前没有可重置的选秀");
    draft.selectedIds = [];
    draft.offerIds = [];
    draft.offerPool = null;
    draft.startedAt = this.now();
    this.save();
    return this.view(account);
  }

  autoDraft(account) {
    const draft = this.state.drafts[account.id];
    if (!draft) throw new Error("当前没有可用的选秀");
    const targets = { GK:2, DEF:8, MID:7, ATT:5 };
    draft.offerIds = [];
    draft.offerPool = null;
    while (draft.selectedIds.length < DRAFT_ROSTER_SIZE) {
      const counts = draftCounts(draft.selectedIds);
      const pool = Object.keys(targets).find((key) => counts[key] < targets[key]) ?? this.allowedDraftPools(draft)[0];
      const unavailable = [...this.unavailablePlayerIds(account.id), ...draft.selectedIds];
      const choices = drawUniquePlayers(pool, unavailable, this.rng, 3);
      if (!choices.length) throw new Error("自动选秀无法补齐阵容");
      choices.sort((a,b) => b.overall - a.overall);
      draft.selectedIds.push(choices[0].id);
    }
    this.save();
    return this.view(account);
  }

  finishDraft(account) {
    const draft = this.state.drafts[account.id];
    if (!draft || draft.offerIds?.length || !validDraft(draft.selectedIds)) throw new Error("需要完成全部22次三选一");
    if (draft.selectedIds.some((id) => this.unavailablePlayerIds(account.id).has(id))) throw new Error("选秀期间有球员被其他球队签下，请重新选择");
    const team = this.state.teams.find((entry) => entry.id === draft.teamId && !entry.ownerId);
    if (!team) throw new Error("AI球队席位已经不可用");
    const replacedTeamName = team.name;
    const existingPlayerTeams = this.state.teams.filter((entry) => entry.ownerId && entry.ownerId !== account.id);
    const joinRound = Math.min(this.state.season.totalRounds, this.state.season.currentRound + 1);
    team.name = draft.teamName;
    team.ownerId = account.id;
    team.ownerName = account.nickname;
    team.joinedAt = this.now();
    team.rosterIds = [...draft.selectedIds];
    team.preferredStarterIds = pickStartingIds(team.rosterIds);
    team.positions = leagueBoardPositions(team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]));
    team.positionPresets = Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(team.positions)]));
    team.playerState = Object.fromEntries(team.rosterIds.map((id) => [id, { fitness:100, suspension:0, injuryRounds:0 }]));
    team.rosterIds.forEach((playerId) => this.grantS4Card(team, playerId, {
      grantOwnership:true,
      acquisitionSource:"initial-draft",
    }));
    delete this.state.drafts[account.id];
    this.wallet(account.id);
    if (this.state.season.currentRound > 0) {
      existingPlayerTeams.forEach((recipient) => this.pushInbox(recipient, {
        id:`league-join:${this.state.season.id}:${account.id}`,
        type:"notice",
        title:`新玩家将于第${joinRound}轮加入联赛`,
        summary:`${team.name}接管了原AI球队${replacedTeamName}的联赛席位。`,
        body:`玩家${account.nickname}创建的${team.name}将于第${joinRound}轮加入联赛，接管原AI球队${replacedTeamName}的席位，并继承该席位此前的战绩和积分。`,
        round:joinRound,
        payload:{ accountId:account.id, ownerName:account.nickname, teamId:team.id, teamName:team.name, replacedTeamName, joinRound },
      }));
    }
    this.updateDailyReports();
    this.save();
    return this.view(account);
  }

  saveTeam(account, body) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const starters = [...new Set(body.starterIds ?? [])];
    if (starters.length !== 11 || starters.some((id) => !team.rosterIds.includes(id))) throw new Error("必须从注册名单中选择11名首发");
    const players = starters.map((id) => REAL_PLAYER_BY_ID[id]);
    const submittedPresets = body.positionPresets;
    const positionPresets = Object.fromEntries(POSITION_PRESET_KEYS.map((key) => {
      const source = submittedPresets?.[key] ?? (!submittedPresets ? body.positions : null) ?? team.positionPresets?.[key] ?? team.positions;
      const sanitized = sanitizePositions(players, source);
      const formation = analyzeElevenFormation(players, sanitized);
      if (!formation.valid) throw new Error(`${key === "position1" ? "站位1" : key === "position2" ? "站位2" : "站位3"}：${formation.message}`);
      return [key, sanitized];
    }));
    team.preferredStarterIds = starters;
    team.positionPresets = positionPresets;
    team.positions = clone(positionPresets.position1);
    if (TACTICS.has(body.tactic)) team.tactic = body.tactic;
    if (STYLES.has(body.style)) team.style = body.style;
    if (FOCUSES.has(body.attackFocus)) team.attackFocus = body.attackFocus;
    if (FOCUSES.has(body.defenseFocus)) team.defenseFocus = body.defenseFocus;
    const threshold = Number(body.fitnessThreshold);
    if (Number.isFinite(threshold)) team.fitnessThreshold = Math.max(45, Math.min(90, Math.round(threshold / 5) * 5));
    const plans = body.tacticalPlans ?? {};
    team.tacticalPlans = Object.fromEntries(["opening", "leading", "trailing"].map((state, index) => {
      const fallback = state === "opening" ? { tactic:team.tactic, style:team.style, positionPreset:"position1" } : team.tacticalPlans?.[state] ?? { tactic:state === "leading" ? "defensive" : "positive", style:state === "leading" ? "counterAttack" : "highPress", positionPreset:POSITION_PRESET_KEYS[index] };
      return [state, {
        tactic:TACTICS.has(plans[state]?.tactic) ? plans[state].tactic : fallback.tactic,
        style:STYLES.has(plans[state]?.style) ? plans[state].style : fallback.style,
        positionPreset:POSITION_PRESET_KEYS.includes(plans[state]?.positionPreset) ? plans[state].positionPreset : fallback.positionPreset ?? POSITION_PRESET_KEYS[index],
      }];
    }));
    team.tactic = team.tacticalPlans.opening.tactic;
    team.style = team.tacticalPlans.opening.style;
    this.save();
    return this.view(account);
  }

  renameTeam(account, nameValue) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const name = String(nameValue ?? "").trim();
    if (!name) throw new Error("球队名称不能为空");
    if (name.length > 30) throw new Error("球队名称最多30个字符");
    const normalizedName = name.toLocaleLowerCase("zh-CN");
    if (this.state.teams.some((entry) => entry.id !== team.id && entry.name.toLocaleLowerCase("zh-CN") === normalizedName)
      || Object.values(this.state.drafts).some((draft) => draft.teamName.toLocaleLowerCase("zh-CN") === normalizedName)) throw new Error("该球队名称已经被使用");
    team.name = name;
    Object.values(this.state.playerStats).forEach((entry) => { if (entry.teamId === team.id) entry.teamName = name; });
    this.state.listings.forEach((entry) => { if (entry.sellerTeamId === team.id) entry.sellerTeamName = name; });
    (this.state.reports[team.id] ?? []).forEach((report) => { report.teamName = name; });
    this.save();
    return this.view(account);
  }

  drawPackChoices(pool, tier, unavailable) {
    const mixed = pool === "MIXED";
    const legendary = pool === "LEGEND";
    const candidates = legendary ? REAL_PLAYERS.filter((player) => player.grade === "S") : mixed ? REAL_PLAYERS : REAL_PLAYER_POOLS[pool];
    if (!tier || !candidates) throw new Error("请选择有效的卡包档位和球员池");
    if (legendary) {
      const available = candidates.filter((player) => !unavailable.includes(player.id));
      if (!available.length) throw new Error("当前没有可用的S级传奇球员");
      return [available[Math.floor(this.rng() * available.length)]];
    }
    const guaranteedCandidates = tier.guaranteeGrades.length
      ? candidates.filter((player) => tier.guaranteeGrades.includes(player.grade) && !unavailable.includes(player.id))
      : [];
    if (tier.guaranteeGrades.length && !guaranteedCandidates.length) throw new Error(`${mixed ? "混合" : pool}球员池暂时没有符合保底品质的唯一球员`);
    const guaranteed = guaranteedCandidates.length ? guaranteedCandidates[Math.floor(this.rng() * guaranteedCandidates.length)] : null;
    const choices = mixed
      ? drawUniqueMixedPlayers(unavailable, this.rng, 3, guaranteed ? [guaranteed] : [])
      : drawUniquePlayers(pool, unavailable, this.rng, 3, guaranteed ? [guaranteed] : []);
    if (choices.length !== 3) throw new Error(`${mixed ? "混合" : pool}球员池暂时没有足够的唯一球员可供开包`);
    return choices;
  }

  buyPack(account, _pool, tierId = "standard") {
    const team = this.accountTeam(account.id);
    const tier = PACK_TIERS[tierId];
    if (!team) throw new Error("你还没有加入联赛");
    if (!tier) throw new Error("请选择有效的卡包档位");
    if (this.state.shopOffers[account.id]) return this.view(account);
    if (this.rosterSlotsUsed(account.id) >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，请先出售或解约一名球员");
    const wallet = this.wallet(account.id);
    if (wallet.balance < tier.price) throw new Error("金币不足");
    const unavailable = [...this.unavailablePlayerIds(account.id), ...team.rosterIds];
    const choices = this.drawPackChoices("MIXED", tier, unavailable);
    wallet.balance -= tier.price;
    this.state.shopOffers[account.id] = { pool:"MIXED", tierId:tier.id, playerIds:choices.map((player) => player.id), purchasedAt:this.now() };
    this.state.ledger.push({ id:makeId("ledger", `${account.id}-pack`), accountId:account.id, amount:-tier.price, type:"pack-buy", pool:"MIXED", tierId:tier.id, createdAt:this.now() });
    this.save();
    return this.view(account);
  }

  choosePack(account, playerId) {
    const team = this.accountTeam(account.id);
    const offer = this.state.shopOffers[account.id];
    if (!team || !offer?.playerIds.includes(playerId)) throw new Error("只能选择当前卡包中的球员");
    if (this.rosterSlotsUsed(account.id) >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，请先腾出一个位置");
    if (this.unavailablePlayerIds(account.id).has(playerId)) throw new Error("该球员已经被其他玩家签下");
    this.grantS4Card(team, playerId, { grantOwnership:true, acquisitionSource:"new-player-pack" });
    delete this.state.shopOffers[account.id];
    this.state.ledger.push({ id:makeId("ledger", `${account.id}-${playerId}`), accountId:account.id, amount:0, type:"pack-sign", playerId, tierId:offer.tierId ?? "standard", source:"shop", createdAt:this.now() });
    this.save();
    return this.view(account);
  }

  listPlayer(account, playerId, priceValue) {
    const card = this.representativeCard(account.id, playerId);
    if (!card) throw new Error("球员不在你的卡片资产中");
    return this.listCard(account, card.id, priceValue);
  }

  listCard(account, cardIdValue, priceValue) {
    const team = this.accountTeam(account.id);
    const card = this.state.s4Assets.cards[String(cardIdValue ?? "")];
    const player = REAL_PLAYER_BY_ID[card?.playerId];
    const price = Math.floor(Number(priceValue));
    if (!team || !card || card.status !== "active" || card.ownerId !== account.id || !player) throw new Error("球员卡不在你的资产中");
    if (!Number.isFinite(price) || price < minimumListingPrice(player)) throw new Error(`挂牌价不能低于参考身价的50%（${minimumListingPrice(player)}金币）`);
    if (this.state.listings.some((item) => item.status === "active" && item.playerId === card.playerId)) throw new Error("该球员已有一项资产正在挂牌");
    const includesOwnership = ownershipOwner(this.state, card.playerId) === account.id
      && this.playerCards(account.id, card.playerId).length === 1;
    this.state.listings.push({
      id:makeId("listing", card.id),
      kind:"card",
      cardId:card.id,
      playerId:card.playerId,
      includesOwnership,
      sellerId:account.id,
      sellerTeamId:team.id,
      price,
      status:"active",
      createdAt:this.now(),
    });
    this.save();
    return this.view(account);
  }

  listOwnership(account, playerId, priceValue, retainedCardId = null) {
    const team = this.accountTeam(account.id);
    const player = REAL_PLAYER_BY_ID[playerId];
    const cards = this.playerCards(account.id, playerId);
    const price = Math.floor(Number(priceValue));
    if (!team || !player || ownershipOwner(this.state, playerId) !== account.id || !cards.length) throw new Error("你不拥有该球员所有权");
    if (!Number.isFinite(price) || price < minimumListingPrice(player)) throw new Error(`所有权挂牌价不能低于${minimumListingPrice(player)}金币`);
    if (this.state.listings.some((item) => item.status === "active" && item.playerId === playerId)) throw new Error("请先撤回该球员的其他挂牌");
    const retained = retainedCardId ? cards.find((card) => card.id === retainedCardId) : cards[0];
    if (!retained) throw new Error("请选择所有权成交后希望保留的球员卡");
    this.state.listings.push({
      id:makeId("ownership-listing", playerId),
      kind:"ownership",
      playerId,
      retainedCardId:retained.id,
      sellerId:account.id,
      sellerTeamId:team.id,
      price,
      status:"active",
      createdAt:this.now(),
    });
    this.save();
    return this.view(account);
  }

  cancelListing(account, listingId) {
    const listing = this.state.listings.find((item) => item.id === listingId && item.status === "active");
    if (!listing || listing.sellerId !== account.id) throw new Error("找不到你的这笔挂牌");
    listing.status = "cancelled";
    listing.closedAt = this.now();
    this.save();
    return this.view(account);
  }

  enhanceS4Card(account, mainCardIdValue, materialCardIdValue, useProtection = false) {
    const team = this.accountTeam(account.id);
    const mainCard = this.state.s4Assets.cards[String(mainCardIdValue ?? "")];
    const materialCard = this.state.s4Assets.cards[String(materialCardIdValue ?? "")];
    if (!team) throw new Error("你还没有加入联赛");
    if (!mainCard || mainCard.status !== "active" || mainCard.ownerId !== account.id) throw new Error("请选择有效的主卡");
    if (!materialCard || materialCard.status !== "active" || materialCard.ownerId !== account.id) throw new Error("请选择有效的副卡");
    if (mainCard.id === materialCard.id) throw new Error("主卡和副卡不能是同一张卡");
    if (mainCard.playerId !== materialCard.playerId) throw new Error("强化只允许使用同名球员卡");
    if (Object.values(this.state.s4Assets.traitOffers ?? {}).some((offer) => offer.status === "pending" && offer.cardId === mainCard.id)) throw new Error("请先为主卡选择强化特性");
    const mainLevel = Number(mainCard.upgradeLevel ?? 0);
    const materialLevel = Number(materialCard.upgradeLevel ?? 0);
    if (mainLevel >= S4_ENHANCEMENT_MAX_LEVEL) throw new Error("主卡已经达到最高强化等级");
    const blockedByListing = this.state.listings.some((item) => item.status === "active"
      && (item.cardId === mainCard.id
        || item.cardId === materialCard.id
        || item.kind === "ownership" && item.playerId === mainCard.playerId));
    if (blockedByListing) throw new Error("请先撤回相关球员资产挂牌");

    const protectionUsed = Boolean(useProtection) && mainLevel >= 3;
    const protectionCost = protectionUsed ? S4_ENHANCEMENT_PROTECTION_COSTS[mainLevel] : 0;
    if (this.wallet(account.id).balance < protectionCost) throw new Error("金币不足，无法自动购买当前等级的保卡道具");
    const chance = s4EnhancementChance(mainLevel, materialLevel);
    const success = this.rng() * 100 < chance;
    if (protectionCost) this.wallet(account.id).balance -= protectionCost;
    recycleS4Card(this.state, materialCard.id, "enhancement-material", this.now());
    mainCard.upgradeLevel = success ? mainLevel + 1 : mainLevel >= 3 && !protectionUsed ? mainLevel - 1 : mainLevel;
    const player = REAL_PLAYER_BY_ID[mainCard.playerId];
    const resultId = makeId("enhancement", `${account.id}-${mainCard.id}`);
    let traitOffer = null;
    const requiredTraitCount = mainCard.upgradeLevel >= 8 ? 2 : mainCard.upgradeLevel >= 5 ? 1 : 0;
    if (success && requiredTraitCount > mainCard.traitIds.length && [5, 8].includes(mainCard.upgradeLevel)) {
      const eligibleTraits = Object.values(YDL_TRAIT_BY_ID)
        .filter((trait) => !mainCard.traitIds.includes(trait.id))
        .filter((trait) => trait.eligibleRoleGroups?.includes("ANY") || trait.eligibleRoleGroups?.includes(roleGroup(player.role)));
      const traitIds = [];
      const available = [...eligibleTraits];
      while (traitIds.length < 3 && available.length) {
        const index = Math.floor(this.rng() * available.length);
        traitIds.push(available.splice(index, 1)[0].id);
      }
      traitOffer = {
        id:makeId("enhancement-trait", mainCard.id),
        ownerId:account.id,
        cardId:mainCard.id,
        playerId:mainCard.playerId,
        upgradeLevel:mainCard.upgradeLevel,
        chance,
        beforeLevel:mainLevel,
        materialLevel,
        traitIds,
        status:"pending",
        createdAt:this.now(),
      };
      this.state.s4Assets.traitOffers[traitOffer.id] = traitOffer;
    }
    this.state.ledger.push({
      id:makeId("ledger", resultId),
      accountId:account.id,
      amount:-protectionCost,
      type:"s4-card-enhancement",
      playerId:mainCard.playerId,
      mainCardId:mainCard.id,
      materialCardId:materialCard.id,
      beforeLevel:mainLevel,
      materialLevel,
      afterLevel:mainCard.upgradeLevel,
      chance,
      success,
      protectionUsed,
      createdAt:this.now(),
    });
    recordS4AssetTransaction(this.state, {
      id:resultId,
      type:"card-enhancement",
      playerId:mainCard.playerId,
      cardIds:[mainCard.id, materialCard.id],
      fromOwnerId:account.id,
      amount:-protectionCost,
      metadata:{ beforeLevel:mainLevel, materialLevel, afterLevel:mainCard.upgradeLevel, chance, success, protectionUsed },
      createdAt:this.now(),
    });
    this.notifyEnhancementSuccess(team, player, mainCard, {
      resultId,
      success,
      chance,
      beforeLevel:mainLevel,
      materialLevel,
    });
    assertS4AssetInvariants(this.state);
    this.save();
    return {
      ...this.view(account),
      enhancementResult:{
        id:resultId,
        success,
        chance,
        beforeLevel:mainLevel,
        materialLevel,
        afterLevel:Number(mainCard.upgradeLevel),
        protectionUsed,
        protectionCost,
        player:playerSummary(player),
        card:publicLeagueS4Card(this.state, mainCard),
        traitOffer:traitOffer ? {
          id:traitOffer.id,
          cardId:traitOffer.cardId,
          upgradeLevel:traitOffer.upgradeLevel,
          traits:traitOffer.traitIds.map((id) => ({
            id,
            name:YDL_TRAIT_BY_ID[id]?.name ?? id,
            summary:YDL_TRAIT_BY_ID[id]?.summary ?? "特性效果由联赛后台配置。",
            eligibleRoleGroups:[...(YDL_TRAIT_BY_ID[id]?.eligibleRoleGroups ?? ["ANY"])],
          })),
        } : null,
      },
    };
  }

  chooseS4EnhancementTrait(account, offerIdValue, traitIdValue) {
    const offer = this.state.s4Assets.traitOffers?.[String(offerIdValue ?? "")];
    const traitId = String(traitIdValue ?? "");
    const card = this.state.s4Assets.cards[offer?.cardId];
    if (!offer || offer.status !== "pending" || offer.ownerId !== account.id) throw new Error("强化特性候选不存在或已经完成");
    if (!offer.traitIds.includes(traitId) || !YDL_TRAIT_BY_ID[traitId]) throw new Error("请选择有效的强化特性");
    if (!card || card.status !== "active" || card.ownerId !== account.id) throw new Error("对应球员卡已经不可用");
    card.traitIds = [...new Set([...(card.traitIds ?? []), traitId])];
    offer.status = "chosen";
    offer.chosenTraitId = traitId;
    offer.chosenAt = this.now();
    const player = REAL_PLAYER_BY_ID[card.playerId];
    const trait = YDL_TRAIT_BY_ID[traitId];
    this.notifyEnhancementTraitBinding(this.accountTeam(account.id), player, card, trait, offer);
    recordS4AssetTransaction(this.state, {
      id:makeId("enhancement-trait-choice", offer.id),
      type:"enhancement-trait-choice",
      playerId:card.playerId,
      cardIds:[card.id],
      fromOwnerId:account.id,
      metadata:{ offerId:offer.id, traitId, upgradeLevel:card.upgradeLevel },
      createdAt:this.now(),
    });
    this.save();
    return {
      ...this.view(account),
      enhancementTraitResult:{
        offerId:offer.id,
        player:playerSummary(player),
        card:publicLeagueS4Card(this.state, card),
        trait:{ id:trait.id, name:trait.name },
      },
    };
  }

  releaseCard(account, cardIdValue, confirmOwnershipReturn = false) {
    const team = this.accountTeam(account.id);
    const card = this.state.s4Assets.cards[String(cardIdValue ?? "")];
    const player = REAL_PLAYER_BY_ID[card?.playerId];
    if (!team || !card || card.status !== "active" || card.ownerId !== account.id || !player) throw new Error("不能解约该球员卡");
    if (Number(card.upgradeLevel ?? 0) >= 2) throw new Error("+2及以上强化卡无法解约");
    if (this.state.listings.some((item) => item.status === "active" && (item.cardId === card.id || item.playerId === card.playerId && item.kind === "ownership"))) throw new Error("请先撤回球员资产挂牌");
    const familyCards = this.playerCards(account.id, card.playerId);
    const returnsOwnership = ownershipOwner(this.state, card.playerId) === account.id && familyCards.length === 1;
    if (returnsOwnership && !confirmOwnershipReturn) throw new Error("这是该球员最后一张卡，解约将同时返还球员所有权，请确认");
    if (team.rosterIds.length <= 11 && familyCards.length === 1) throw new Error("不能解约该球员，球队必须保留至少11名可用球员");
    const cardAmount = s4SingleCardReleaseValue(player, card.upgradeLevel);
    const ownershipAmount = returnsOwnership ? Math.floor(minimumPrice(player) * S4_OWNERSHIP_RETURN_RATE) : 0;
    if (returnsOwnership) returnPlayerOwnershipToSystem(this.state, card.playerId, account.id);
    recycleS4Card(this.state, card.id, returnsOwnership ? "last-card-and-ownership-return" : "single-card-release", this.now());
    this.removeEmptyRosterFamily(team, card.playerId);
    const amount = cardAmount + ownershipAmount;
    this.wallet(account.id).balance += amount;
    this.state.ledger.push({ id:makeId("ledger", card.id), accountId:account.id, amount, type:"release", playerId:card.playerId, cardId:card.id, ownershipReturned:returnsOwnership, createdAt:this.now() });
    recordS4AssetTransaction(this.state, {
      id:makeId("asset-release", card.id),
      type:returnsOwnership ? "last-card-release-and-ownership-return" : "single-card-release",
      playerId:card.playerId,
      cardIds:[card.id],
      fromOwnerId:account.id,
      amount,
      createdAt:this.now(),
    });
    this.save();
    return this.view(account);
  }

  directTradeCard(sellerAccount, buyerAccount, cardId, priceValue) {
    this.listCard(sellerAccount, cardId, priceValue);
    const listing = this.state.listings.find((item) => item.status === "active" && item.cardId === cardId && item.sellerId === sellerAccount.id);
    if (!listing) throw new Error("无法创建单卡交易");
    listing.channel = "direct-trade";
    try {
      return this.buyListing(buyerAccount, listing.id);
    } catch (error) {
      listing.status = "cancelled";
      listing.closedAt = this.now();
      this.save();
      throw error;
    }
  }

  directTradeOwnership(sellerAccount, buyerAccount, playerId, priceValue, retainedCardId = null) {
    this.listOwnership(sellerAccount, playerId, priceValue, retainedCardId);
    const listing = this.state.listings.find((item) => item.status === "active" && item.kind === "ownership" && item.playerId === playerId && item.sellerId === sellerAccount.id);
    if (!listing) throw new Error("无法创建所有权交易");
    listing.channel = "direct-trade";
    try {
      return this.buyListing(buyerAccount, listing.id);
    } catch (error) {
      listing.status = "cancelled";
      listing.closedAt = this.now();
      this.save();
      throw error;
    }
  }

  releasePlayer(account, playerId) {
    const card = this.representativeCard(account.id, playerId);
    if (!card) throw new Error("不能解约该球员");
    return this.releaseCard(account, card.id, true);
  }

  returnOwnership(account, playerId) {
    const team = this.accountTeam(account.id);
    const player = REAL_PLAYER_BY_ID[playerId];
    const cards = this.playerCards(account.id, playerId);
    if (!team || !player || ownershipOwner(this.state, playerId) !== account.id || !cards.length) throw new Error("你不拥有该球员所有权");
    if (this.state.listings.some((item) => item.status === "active" && item.playerId === playerId)) throw new Error("请先撤回该球员的全部挂牌");
    const retained = cards[0];
    const recovered = cards.slice(1);
    const recoveryAmount = recovered.reduce((sum, card) => sum + s4ForcedCardRecoveryValue(player, card.upgradeLevel), 0);
    recovered.forEach((card) => recycleS4Card(this.state, card.id, "ownership-return-liquidation", this.now()));
    returnPlayerOwnershipToSystem(this.state, playerId, account.id);
    const ownershipAmount = Math.floor(minimumPrice(player) * S4_OWNERSHIP_RETURN_RATE);
    const amount = recoveryAmount + ownershipAmount;
    this.wallet(account.id).balance += amount;
    this.state.ledger.push({ id:makeId("ledger", `ownership-return-${playerId}`), accountId:account.id, amount, type:"ownership-return", playerId, retainedCardId:retained.id, recoveredCardIds:recovered.map((card) => card.id), createdAt:this.now() });
    recordS4AssetTransaction(this.state, {
      id:makeId("asset-ownership-return", playerId),
      type:"ownership-return",
      playerId,
      cardIds:recovered.map((card) => card.id),
      fromOwnerId:account.id,
      amount,
      metadata:{ retainedCardId:retained.id },
      createdAt:this.now(),
    });
    this.save();
    return this.view(account);
  }

  buyListing(account, listingId) {
    const buyer = this.accountTeam(account.id);
    const listing = this.state.listings.find((item) => item.id === listingId && item.status === "active");
    if (!buyer || !listing || listing.sellerId === account.id) throw new Error("当前无法购买这名球员");
    const seller = this.state.teams.find((team) => team.id === listing.sellerTeamId && team.ownerId === listing.sellerId);
    if (!seller?.rosterIds.includes(listing.playerId)) throw new Error("卖方已不再持有这名球员");
    if (this.wallet(account.id).balance < listing.price) throw new Error("金币不足");
    const player = REAL_PLAYER_BY_ID[listing.playerId];
    let transferredCard = null;
    let recoveredCards = [];
    let recoveryAmount = 0;
    let ownershipTransferred = false;

    if (listing.kind === "ownership") {
      if (ownershipOwner(this.state, listing.playerId) !== listing.sellerId) throw new Error("卖方已不再拥有该球员所有权");
      const sellerCards = this.playerCards(listing.sellerId, listing.playerId);
      const buyerCards = this.playerCards(account.id, listing.playerId);
      if (!sellerCards.length) throw new Error("卖方所有权缺少锚点卡");
      if (!buyerCards.length && sellerCards.length === 1 && seller.rosterIds.length <= 11) throw new Error("卖方必须保留至少11名可用球员");
      const buyerAlreadyUsesSlot = rosterFamilyUsesSlot(this.state, account.id, listing.playerId);
      if (!buyerAlreadyUsesSlot && this.rosterSlotsUsed(account.id) >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，无法接收该球员所有权");
      let retained = sellerCards.find((card) => card.id === listing.retainedCardId) ?? sellerCards[0];
      if (!buyerCards.length) {
        const candidates = sellerCards.filter((card) => card.id !== retained.id);
        transferredCard = candidates.at(-1) ?? sellerCards[0];
        if (transferredCard.id === retained.id) retained = null;
        transferS4Card(this.state, transferredCard.id, account.id, listing.channel === "direct-trade" ? "direct-trade" : "market", this.now());
        this.ensureRosterFamily(buyer, listing.playerId);
      }
      const retainedId = retained?.id ?? null;
      recoveredCards = sellerCards.filter((card) => card.id !== retainedId && card.id !== transferredCard?.id);
      recoveredCards.forEach((card) => recycleS4Card(this.state, card.id, "ownership-sale-liquidation", this.now()));
      recoveryAmount = recoveredCards.reduce((sum, card) => sum + s4ForcedCardRecoveryValue(player, card.upgradeLevel), 0);
      transferPlayerOwnership(this.state, listing.playerId, listing.sellerId, account.id);
      ownershipTransferred = true;
      this.removeEmptyRosterFamily(seller, listing.playerId);
    } else {
      const card = this.state.s4Assets.cards[listing.cardId];
      if (!card || card.status !== "active" || card.ownerId !== listing.sellerId) throw new Error("挂牌球员卡已不可交易");
      const sellerCards = this.playerCards(listing.sellerId, listing.playerId);
      if (sellerCards.length === 1 && seller.rosterIds.length <= 11) throw new Error("卖方必须保留至少11名可用球员");
      const includesOwnership = ownershipOwner(this.state, listing.playerId) === listing.sellerId && sellerCards.length === 1;
      const buyerAlreadyUsesSlot = rosterFamilyUsesSlot(this.state, account.id, listing.playerId);
      const willUseSlot = includesOwnership || Number(card.upgradeLevel ?? 0) < 3;
      if (!buyerAlreadyUsesSlot && willUseSlot && this.rosterSlotsUsed(account.id) >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，无法接收这张球员卡");
      transferS4Card(this.state, card.id, account.id, listing.channel === "direct-trade" ? "direct-trade" : "market", this.now());
      transferredCard = card;
      this.ensureRosterFamily(buyer, listing.playerId);
      if (includesOwnership) {
        transferPlayerOwnership(this.state, listing.playerId, listing.sellerId, account.id);
        ownershipTransferred = true;
      }
      this.removeEmptyRosterFamily(seller, listing.playerId);
    }

    this.wallet(account.id).balance -= listing.price;
    const saleIncome = Math.floor(listing.price * .95);
    this.wallet(listing.sellerId).balance += saleIncome + recoveryAmount;
    listing.status = "sold";
    listing.buyerId = account.id;
    listing.transferredCardId = transferredCard?.id ?? null;
    listing.ownershipTransferred = ownershipTransferred;
    listing.recoveredCardIds = recoveredCards.map((card) => card.id);
    listing.recoveryAmount = recoveryAmount;
    listing.closedAt = this.now();
    this.state.ledger.push(
      { id:makeId("ledger", listing.id), accountId:account.id, amount:-listing.price, type:ownershipTransferred ? "ownership-buy" : "card-buy", playerId:listing.playerId, cardId:transferredCard?.id ?? null, counterpartyId:listing.sellerId, listingId:listing.id, createdAt:this.now() },
      { id:makeId("ledger", `${listing.id}-seller`), accountId:listing.sellerId, amount:saleIncome + recoveryAmount, type:ownershipTransferred ? "ownership-sale" : "card-sale", playerId:listing.playerId, cardId:transferredCard?.id ?? null, counterpartyId:account.id, listingId:listing.id, createdAt:this.now() },
    );
    recordS4AssetTransaction(this.state, {
      id:makeId("asset-market", listing.id),
      type:ownershipTransferred ? "ownership-market-transfer" : "single-card-market-transfer",
      playerId:listing.playerId,
      cardIds:[...(transferredCard ? [transferredCard.id] : []), ...recoveredCards.map((card) => card.id)],
      fromOwnerId:listing.sellerId,
      toOwnerId:account.id,
      amount:listing.price,
      metadata:{ listingId:listing.id, ownershipTransferred, recoveryAmount },
      createdAt:this.now(),
    });
    this.pushInbox(buyer, {
      id:`transfer-buy:${listing.id}`,
      type:"transfer",
      title:`签下 ${player.name}`,
      summary:`支付 ${listing.price} 金币，${ownershipTransferred ? "球员所有权及对应卡片" : "球员卡"}已到账。`,
      body:`${player.name}已从${seller.name}转入球队。${transferredCard && isRosterExemptCard(this.state, transferredCard) ? "该卡强化等级达到+3且来自市场，不占用33人大名单额度。" : "该资产计入当前名单规则。"}`,
    });
    this.pushInbox(seller, {
      id:`transfer-sale:${listing.id}`,
      type:"transfer",
      title:`${player.name} 转会完成`,
      summary:`扣除手续费并计入强制回收补偿后到账 ${saleIncome + recoveryAmount} 金币。`,
      body:`${player.name}相关资产已转移至${buyer.name}。${ownershipTransferred ? "球员所有权也已同步转移。" : "你仍保有该球员所有权及剩余卡片。"}`,
    });
    this.save();
    return this.view(account);
  }

  selectActualLineup(team, roundNumber, competition = "league") {
    const humanOwned = this.ownedPlayerIds();
    if (!team.ownerId) return { lineup:aiLineup(this.state.teams.indexOf(team), roundNumber, humanOwned), rotations:[] };
    const desired = team.preferredStarterIds.filter((id) => team.rosterIds.includes(id));
    const threshold = Number(team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD);
    const hardAvailable = (id) => {
      const state = team.playerState[id] ?? {};
      const suspension = competition === "cup" ? Number(state.cupSuspension ?? 0) : Number(state.suspension ?? 0);
      return suspension <= 0 && Number(state.injuryRounds ?? 0) <= 0 && Number(state.fitness ?? 100) >= 45;
    };
    const assignedRoles = inferElevenBoardRoles(desired.map((id) => ({ id, position:team.positions[id] })));
    const selected = [];
    const rotations = [];
    const bench = team.rosterIds.filter((id) => !desired.includes(id) && hardAvailable(id));
    const takeReplacement = (starterId, requireFresh) => {
      const assignedRole = assignedRoles[starterId] ?? REAL_PLAYER_BY_ID[starterId]?.role;
      const candidates = bench
        .filter((id) => !requireFresh || Number(team.playerState[id]?.fitness ?? 100) > threshold)
        .map((id) => REAL_PLAYER_BY_ID[id])
        .filter((player) => player && (!requireFresh || playerRoleFit(player, assignedRole) >= 2))
        .sort((left, right) => playerRoleFit(right, assignedRole) - playerRoleFit(left, assignedRole)
          || Number(team.playerState[right.id]?.fitness ?? 100) - Number(team.playerState[left.id]?.fitness ?? 100)
          || right.overall - left.overall)[0];
      if (!candidates) return null;
      bench.splice(bench.indexOf(candidates.id), 1);
      return candidates.id;
    };
    for (const starterId of desired) {
      const state = team.playerState[starterId] ?? {};
      const fitness = Number(state.fitness ?? 100);
      const forcedOut = !hardAvailable(starterId);
      const atRedLine = !forcedOut && fitness <= threshold;
      const substitute = forcedOut ? takeReplacement(starterId, false) : atRedLine ? takeReplacement(starterId, true) : null;
      if (substitute) {
        selected.push(substitute);
        rotations.push({ outId:starterId, outName:REAL_PLAYER_BY_ID[starterId]?.name, inId:substitute, inName:REAL_PLAYER_BY_ID[substitute]?.name, reason:forcedOut ? ((competition === "cup" ? Number(state.cupSuspension ?? 0) : Number(state.suspension ?? 0)) > 0 ? "停赛" : Number(state.injuryRounds ?? 0) > 0 ? "伤缺" : "体能不足45") : `体能${Math.round(fitness)}达到红线${threshold}` });
      } else if (!forcedOut) selected.push(starterId);
    }
    while (selected.length < 11 && bench.length) selected.push(bench.shift());
    return {
      lineup:selected.slice(0,11).map((id) => ({ ...REAL_PLAYER_BY_ID[id], state:{ ...REAL_PLAYER_BY_ID[id].state, fitness:team.playerState[id]?.fitness ?? 100 } })),
      rotations,
    };
  }

  actualLineup(team, roundNumber) {
    return this.selectActualLineup(team, roundNumber).lineup;
  }

  actualPositions(team, lineup, positionPreset = "position1") {
    const fallback = leagueBoardPositions(lineup);
    if (!team.ownerId) return fallback;
    const savedPositions = team.positionPresets?.[positionPreset] ?? team.positions;
    const lineupIds = new Set(lineup.map((player) => player.id));
    const replacementSlots = team.preferredStarterIds
      .filter((id) => !lineupIds.has(id) && savedPositions[id])
      .map((id) => ({ ...savedPositions[id] }));
    return Object.fromEntries(lineup.map((player) => [player.id, savedPositions[player.id]
      ? { ...savedPositions[player.id] }
      : replacementSlots.shift() ?? fallback[player.id]]));
  }

  recordChemistry(team, lineup, positions) {
    if (!team.ownerId) return;
    team.chemistry ??= {};
    eligibleChemistryPairs(lineup, positions).forEach((pair) => {
      const relation = team.chemistry[pair.key] ?? { playerIds:pair.playerIds, appearances:0, value:0 };
      relation.appearances += 1;
      relation.value = Math.min(100, relation.value + CHEMISTRY_GAIN_PER_MATCH);
      relation.updatedAt = this.now();
      team.chemistry[pair.key] = relation;
    });
  }

  chemistryAdjustedLineup(team, lineup, positions) {
    const links = team.ownerId ? publicChemistryLinks(team, lineup.map((player) => player.id), positions) : [];
    const valuesByPlayer = new Map();
    links.forEach((link) => link.playerIds.forEach((id) => {
      const values = valuesByPlayer.get(id) ?? [];
      values.push(link.value);
      valuesByPlayer.set(id, values);
    }));
    const lineupWithCards = lineup.map((player) => {
      const card = this.representativeCard(team.ownerId, player.id);
      return {
        ...player,
        upgradeLevel:Number(card?.upgradeLevel ?? 0),
        traits:(card?.traitIds ?? []).filter((id) => YDL_TRAIT_BY_ID[id]),
      };
    });
    eligibleChemistryPairs(lineupWithCards, positions).forEach((pair) => {
      const pairPlayers = pair.playerIds.map((id) => lineupWithCards.find((player) => player.id === id)).filter(Boolean);
      const traitRule = pairPlayers.flatMap((player) => player.traits.map((id) => YDL_TRAIT_BY_ID[id]))
        .filter(Boolean)
        .flatMap((trait) => trait.rules ?? [])
        .find((rule) => rule.hook === "chemistry" && rule.linkNearby);
      if (!traitRule) return;
      pair.playerIds.forEach((id) => {
        const values = valuesByPlayer.get(id) ?? [];
        values.push(Number(traitRule.value ?? 100));
        valuesByPlayer.set(id, values);
      });
    });
    const bonds = evaluateS4LineupBonds(lineupWithCards, S4_BOND_CATALOG);
    const bondedLineup = applyS4BondBonuses(lineupWithCards, bonds);
    return bondedLineup.map((player) => {
      const values = valuesByPlayer.get(player.id) ?? [];
      if (!values.length) return player;
      const chemistry = values.reduce((sum, value) => sum + value, 0) / values.length;
      const bonus = Math.min(CHEMISTRY_MAX_BONUS, chemistry / 100 * CHEMISTRY_MAX_BONUS);
      return {
        ...player,
        attributes:Object.fromEntries(Object.entries(player.attributes).map(([key, value]) => [key, Number.isFinite(value) ? Math.min(99, Number((value * (1 + bonus)).toFixed(2))) : value])),
        leagueChemistryBonus:Number(bonus.toFixed(4)),
      };
    });
  }

  fixtureSeed(fixture, roundNumber) {
    return `${this.state.season.id}:${roundNumber}:${fixture.homeId}:${fixture.awayId}`;
  }

  fixtureConditions(fixture, roundNumber) {
    return seededConditions(this.fixtureSeed(fixture, roundNumber));
  }

  createFixtureMatch(fixture, roundNumber, startedAt = this.now(), options = {}) {
    const home = this.state.teams.find((team) => team.id === fixture.homeId);
    const away = this.state.teams.find((team) => team.id === fixture.awayId);
    const selections = [home, away].map((team) => this.selectActualLineup(team, roundNumber, options.competitionMode ?? "league"));
    const lineups = selections.map((selection) => selection.lineup);
    const teams = [home, away];
    const positionPresets = teams.map((team, index) => Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, this.actualPositions(team, lineups[index], key)])));
    const positions = teams.map((team, index) => {
      const openingPreset = team.tacticalPlans?.opening?.positionPreset ?? "position1";
      return clone(positionPresets[index][openingPreset] ?? positionPresets[index].position1);
    });
    const seats = teams.map((team, index) => ({ name:team.name, players:this.chemistryAdjustedLineup(team, lineups[index], positions[index]), positions:positions[index], positionPresets:positionPresets[index], tactic:team.tacticalPlans?.opening?.tactic ?? team.tactic, style:team.tacticalPlans?.opening?.style ?? team.style, tacticalPlans:team.tacticalPlans, attackFocus:team.attackFocus, defenseFocus:team.defenseFocus, preserveFitness:true }));
    const conditions = this.fixtureConditions(fixture, roundNumber);
    const match = createVersusMatch(seats, { now:startedAt, seed:options.seed ?? this.fixtureSeed(fixture, roundNumber), weather:conditions.weather.key, referee:conditions.referee.key, regulationOnly:options.regulationOnly ?? true, competitionMode:options.competitionMode ?? "league", legNumber:options.legNumber ?? 1, aggregateBaseScore:options.aggregateBaseScore ?? null, recordEvents:options.recordEvents ?? this.recordMatchEvents !== false });
    match.leagueAutoRotations = selections.map((selection) => selection.rotations);
    return { home, away, match, startedAt };
  }

  finalizeFixture(fixture, roundNumber, match) {
    const home = this.state.teams.find((team) => team.id === fixture.homeId);
    const away = this.state.teams.find((team) => team.id === fixture.awayId);
    const report = match.report;
    const id = `${this.state.season.id}-R${roundNumber}-${home.id}-${away.id}`;
    const record = { id, round:roundNumber, playedAt:this.now(), homeId:home.id, awayId:away.id, homeName:home.name, awayName:away.name, score:[...report.score], formations:report.teams.map((team) => team.formation), autoRotations:clone(match.leagueAutoRotations ?? [[], []]), report };
    this.state.matches.push(record);
    fixture.matchId = id;
    [home, away].forEach((team, index) => {
      const own = report.score[index]; const against = report.score[index === 0 ? 1 : 0];
      team.table.played += 1; team.table.goalsFor += own; team.table.goalsAgainst += against;
      if (own > against) { team.table.won += 1; team.table.points += 3; team.form.push("W"); }
      else if (own === against) { team.table.drawn += 1; team.table.points += 1; team.form.push("D"); }
      else { team.table.lost += 1; team.form.push("L"); }
      team.form = team.form.slice(-5);
      report.teams[index].players.forEach((player) => {
        const key = `${team.id}:${player.id}`;
        const stat = this.state.playerStats[key] ?? { key, playerId:player.id, playerName:player.name, teamId:team.id, teamName:team.name, appearances:0, goals:0, assists:0, saves:0, yellowCards:0, redCards:0, ratingTotal:0 };
        stat.appearances += 1; stat.goals += player.stats.goals; stat.assists += player.stats.assists; stat.saves += player.stats.saves; stat.yellowCards += player.stats.yellowCards; stat.redCards += player.stats.redCards; stat.ratingTotal += player.rating;
        this.state.playerStats[key] = stat;
        if (team.ownerId && team.playerState[player.id]) {
          const state = team.playerState[player.id];
          const beforeMatch = Number(state.fitness ?? 100);
          const engineFitness = Number(player.fitness ?? beforeMatch);
          const matchDrain = Math.max(0, beforeMatch - engineFitness);
          state.fitness = Math.max(35, Math.min(100, Number((beforeMatch - matchDrain * LEAGUE_FITNESS_DRAIN_FACTOR).toFixed(1))));
          if (player.stats.redCards) state.suspension = Math.max(state.suspension ?? 0, 1);
          if (player.stats.redCards) this.roundNewUnavailable?.add(`${team.id}:${player.id}:suspension`);
          if (player.injury) {
            state.injuryRounds = Math.max(state.injuryRounds ?? 0, 1 + (roundNumber % 3));
            this.roundNewUnavailable?.add(`${team.id}:${player.id}:injury`);
          }
        }
      });
      const chemistryLineup = report.teams[index].players.map((player) => REAL_PLAYER_BY_ID[player.id]).filter(Boolean);
      const chemistryPositions = Object.fromEntries(report.teams[index].players.map((player) => [player.id, player.position]));
      this.recordChemistry(team, chemistryLineup, chemistryPositions);
    });
    return record;
  }

  simulateFixture(fixture, roundNumber) {
    const created = this.createFixtureMatch(fixture, roundNumber);
    settleAutomatedMatch(created.match, created.startedAt);
    return this.finalizeFixture(fixture, roundNumber, created.match);
  }

  finalizeCupFixture(fixture, event, match) {
    const cup = this.state.cup;
    const home = this.state.teams.find((team) => team.id === fixture.homeId);
    const away = this.state.teams.find((team) => team.id === fixture.awayId);
    const report = match.report;
    const id = `${this.state.season.id}-CUP-${event.stage}-${event.round}-L${event.leg}-${home.id}-${away.id}`;
    const record = { id, competition:"cup", cupStage:event.stage, cupRound:event.round, legNumber:event.leg, playedAt:this.now(), homeId:home.id, awayId:away.id, homeName:home.name, awayName:away.name, score:[...report.score], penalties:report.penalties ?? null, formations:report.teams.map((team) => team.formation), autoRotations:clone(match.leagueAutoRotations ?? [[], []]), report };
    this.state.matches.push(record);
    fixture.matchId = id;
    fixture.status = "complete";
    fixture.score = [...report.score];
    fixture.penalties = report.penalties ?? null;
    fixture.winnerId = Number.isInteger(match.winnerIndex) ? [fixture.homeId, fixture.awayId][match.winnerIndex] : null;
    [home, away].forEach((team, index) => {
      report.teams[index].players.forEach((player) => {
        const key = `${team.id}:${player.id}`;
        const stat = cup.playerStats[key] ?? { key, playerId:player.id, playerName:player.name, teamId:team.id, teamName:team.name, appearances:0, goals:0, assists:0, saves:0, yellowCards:0, redCards:0, ratingTotal:0 };
        stat.appearances += 1; stat.goals += player.stats.goals; stat.assists += player.stats.assists; stat.saves += player.stats.saves; stat.yellowCards += player.stats.yellowCards; stat.redCards += player.stats.redCards; stat.ratingTotal += player.rating;
        cup.playerStats[key] = stat;
        if (team.ownerId && team.playerState[player.id]) {
          const state = team.playerState[player.id];
          const beforeMatch = Number(state.fitness ?? 100);
          const drain = Math.max(0, beforeMatch - Number(player.fitness ?? beforeMatch));
          state.fitness = Math.max(35, Math.min(100, Number((beforeMatch - drain * LEAGUE_FITNESS_DRAIN_FACTOR).toFixed(1))));
          if (player.stats.redCards) state.cupSuspension = Math.max(state.cupSuspension ?? 0, 1);
          if (player.stats.redCards) { this.cupNewUnavailable ??= new Set(); this.cupNewUnavailable.add(`${team.id}:${player.id}`); }
          if (player.injury) state.injuryRounds = Math.max(state.injuryRounds ?? 0, 1 + (event.round % 3));
        }
      });
      this.recordChemistry(team, report.teams[index].players.map((player) => REAL_PLAYER_BY_ID[player.id]).filter(Boolean), Object.fromEntries(report.teams[index].players.map((player) => [player.id, player.position])));
    });
    if (event.stage === "swiss") {
      [home, away].forEach((team, index) => {
        const table = cup.table[team.id]; const own = report.score[index]; const against = report.score[index === 0 ? 1 : 0];
        table.played += 1; table.goalsFor += own; table.goalsAgainst += against;
        const won = fixture.winnerId === team.id;
        if (won) { table.won += 1; table.points += 3; }
        else table.lost += 1;
        if (table.won >= 3) table.status = "qualified";
        if (table.lost >= 3) table.status = "eliminated";
      });
    }
    this.createCupMatchInbox(home, away, record, event);
    return record;
  }

  createCupMatchInbox(home, away, record, event) {
    [home, away].forEach((team, ownIndex) => {
      if (!team.ownerId) return;
      const opponent = ownIndex === 0 ? away : home;
      const ownScore = record.score[ownIndex];
      const opponentScore = record.score[ownIndex === 0 ? 1 : 0];
      const resultText = ownScore > opponentScore ? "取胜" : ownScore === opponentScore ? "战平" : "失利";
      const stageLabel = event.stage === "swiss" ? `瑞士轮第${event.round}轮` : `${CUP_STAGE_NAMES[event.stage] ?? event.stage} · 第${event.leg}回合`;
      const rank = this.standings().find((entry) => entry.id === team.id)?.rank ?? TEAM_COUNT;
      const injured = team.rosterIds.filter((id) => Number(team.playerState[id]?.injuryRounds ?? 0) > 0).map((id) => ({ id, name:REAL_PLAYER_BY_ID[id].name, rounds:team.playerState[id].injuryRounds }));
      const suspended = team.rosterIds.filter((id) => Number(team.playerState[id]?.cupSuspension ?? 0) > 0).map((id) => ({ id, name:REAL_PLAYER_BY_ID[id].name, rounds:team.playerState[id].cupSuspension }));
      const next = this.nextOpponent(team.id);
      this.pushInbox(team, {
        id:`cup-matchweek:${this.state.season.id}:${event.id}:${record.id}:${team.id}`,
        type:"matchweek",
        title:`黄狗冠军杯 · ${stageLabel}战报`,
        summary:`${team.name} ${ownScore}:${opponentScore} ${opponent.name}，本场${resultText}。`,
        body:`黄狗冠军杯${stageLabel}结束。${next ? `下一场为${next.competitionName} ${next.label}，对阵 ${next.name}。` : "当前没有已确定的后续比赛。"}`,
        round:event.round,
        matchId:record.id,
        payload:{ results:[this.matchSummary(record)], rank, points:team.table.points, injured, suspended, next, autoRotations:record.autoRotations?.[ownIndex] ?? [], competition:"cup", stage:event.stage, leg:event.leg },
      });
    });
  }

  cupEventFixtures(event) {
    if (event.stage === "swiss") return this.state.cup.swissRounds.find((round) => round.number === event.round)?.fixtures ?? [];
    return (this.state.cup.knockout[event.stage] ?? []).flatMap((tie) => tie.legs.filter((leg) => leg.number === event.leg));
  }

  createKnockoutStage(stage, teamIds) {
    const cup = this.state.cup;
    const ties = [];
    for (let index = 0; index < teamIds.length; index += 2) {
      const first = teamIds[index]; const second = teamIds[index + 1];
      const id = `cup-${stage}-${index / 2 + 1}`;
      const legs = [
        { id:`${id}-leg1`, number:1, homeId:first, awayId:second, status:"pending", matchId:null, score:null },
      ];
      if (stage !== "final") legs.push({ id:`${id}-leg2`, number:2, homeId:second, awayId:first, status:"pending", matchId:null, score:null });
      ties.push({ id, stage, teams:[first, second], winnerId:null, legs });
    }
    cup.knockout[stage] = ties;
    cup.events.push({ id:`cup-${stage}-leg1`, stage, round:stage === "quarterfinals" ? 5 : stage === "semifinals" ? 6 : 7, leg:1, status:"pending", fixtureIds:ties.map((tie) => tie.legs[0].id) });
    return ties;
  }

  completeCupEvent(event) {
    if (event.transitionedAt) return;
    const alreadySettled = event.status === "complete";
    const cup = this.state.cup;
    if (!alreadySettled) this.advanceCupAvailability();
    if (event.stage === "swiss") {
      const round = cup.swissRounds.find((entry) => entry.number === event.round); round.status = "complete";
      const standings = this.normalizeSwissField(round);
      const qualifiedCount = standings.filter((entry) => entry.status === "qualified").length;
      const eliminatedCount = standings.filter((entry) => entry.status === "eliminated").length;
      if (round.requiresFinalSeedingRound) {
        this.createSwissRound();
      } else if (qualifiedCount >= 8 || eliminatedCount >= 2) {
        // Fixtures in a Swiss round settle together. If that final batch produces more
        // than two 3-loss teams, the eighth seed is still needed to complete the bracket.
        const qualified = this.cupStandings().slice(0, 8).map((entry) => entry.id);
        const qualifiedSet = new Set(qualified);
        Object.entries(cup.table).forEach(([teamId, table]) => {
          table.status = qualifiedSet.has(teamId) ? "qualified" : "eliminated";
        });
        this.createKnockoutStage("quarterfinals", [qualified[0], qualified[7], qualified[3], qualified[4], qualified[2], qualified[5], qualified[1], qualified[6]]);
        cup.stage = "quarterfinals";
      } else this.createSwissRound();
    } else {
      const ties = cup.knockout[event.stage];
      if (event.stage !== "final" && event.leg === 1) cup.events.push({ id:`cup-${event.stage}-leg2`, stage:event.stage, round:event.round, leg:2, status:"pending", fixtureIds:ties.map((tie) => tie.legs[1].id) });
      else {
        ties.forEach((tie) => {
          if (event.stage === "final") { tie.winnerId = tie.legs[0].winnerId ?? tie.teams[0]; return; }
          const [first, second] = tie.legs;
          const aggregate = [first.score[0] + second.score[1], first.score[1] + second.score[0]];
          tie.winnerId = aggregate[0] > aggregate[1] ? tie.teams[0] : aggregate[1] > aggregate[0] ? tie.teams[1] : (second.winnerId ?? tie.teams[0]);
        });
        const winners = ties.map((tie) => tie.winnerId);
        if (event.stage === "quarterfinals") {
          winners.forEach((teamId) => this.grantCupReward(teamId, event, "advance"));
          this.createKnockoutStage("semifinals", winners); cup.stage = "semifinals";
        } else if (event.stage === "semifinals") {
          winners.forEach((teamId) => this.grantCupReward(teamId, event, "advance"));
          this.createKnockoutStage("final", winners); cup.stage = "final";
        } else {
          this.grantCupReward(winners[0], event, "champion");
          cup.status = "completed"; cup.stage = "completed"; cup.championId = winners[0]; cup.completedAt = this.now();
        }
      }
    }
    event.status = "complete";
    event.transitionedAt = this.now();
    if (cup.status === "completed") cup.nextRoundAt = null;
    else {
      if (this.state.season.status === "active" && Number(this.state.season.nextRoundAt) <= this.now()) this.state.season.nextRoundAt = nextSlot(this.now());
      const leagueAnchor = Number(this.state.season.nextRoundAt);
      const cupAfterLeague = Number.isFinite(leagueAnchor) ? leagueAnchor + 10 * 60 * 1000 : 0;
      cup.nextRoundAt = Math.max(nextCupSlot(this.now(), this.state.season.firstRoundAt ?? leagueAnchor), cupAfterLeague);
    }
  }

  startScheduledCupEvent() {
    const cup = this.state.cup;
    const event = cup.events.find((entry) => entry.status === "pending");
    if (!event) return false;
    event.status = "running";
    const fixtures = this.cupEventFixtures(event);
    const liveMatches = [];
    fixtures.forEach((fixture, index) => {
      const tie = event.stage === "swiss" ? null : cup.knockout[event.stage].find((entry) => entry.legs.includes(fixture));
      const firstLeg = tie?.legs[0];
      const aggregateBaseScore = event.leg === 2 && firstLeg ? [firstLeg.score[1], firstLeg.score[0]] : null;
      const created = this.createFixtureMatch(fixture, event.round, this.now(), { seed:`${this.state.season.id}:${event.id}:${fixture.id}`, competitionMode:"cup", legNumber:event.leg, regulationOnly:event.stage === "swiss" || event.stage === "final" ? false : event.leg === 1, aggregateBaseScore });
      if (created.home.ownerId || created.away.ownerId) liveMatches.push({ code:`YDL-CUP-${this.state.season.name}-${event.stage}-${event.leg}-M${index + 1}`, round:event.round, fixtureId:fixture.id, match:created.match, spectators:{} });
      else {
        settleAutomatedMatch(created.match, created.startedAt);
        this.finalizeCupFixture(fixture, event, created.match);
      }
    });
    if (!liveMatches.length) { this.completeCupEvent(event); this.save(); return true; }
    this.state.liveCupRound = { eventId:event.id, startedAt:this.now(), matches:liveMatches };
    this.save();
    return true;
  }

  simulatePendingCupEvent() {
    const cup = this.state.cup;
    if (cup.status !== "active" || this.state.liveCupRound) return null;
    const event = cup.events.find((entry) => entry.status === "pending");
    if (!event) return null;
    event.status = "running";
    this.cupNewUnavailable = new Set();
    this.cupEventFixtures(event).forEach((fixture) => {
      const tie = event.stage === "swiss" ? null : cup.knockout[event.stage].find((entry) => entry.legs.includes(fixture));
      const firstLeg = tie?.legs[0];
      const aggregateBaseScore = event.leg === 2 && firstLeg ? [firstLeg.score[1], firstLeg.score[0]] : null;
      const created = this.createFixtureMatch(fixture, event.round, this.now(), {
        seed:`${this.state.season.id}:${event.id}:${fixture.id}`,
        competitionMode:"cup",
        legNumber:event.leg,
        regulationOnly:event.stage === "swiss" || event.stage === "final" ? false : event.leg === 1,
        aggregateBaseScore,
      });
      settleAutomatedMatch(created.match, created.startedAt);
      this.finalizeCupFixture(fixture, event, created.match);
    });
    this.completeCupEvent(event);
    this.save();
    return event;
  }

  advanceLiveCupRound(now = this.now()) {
    const liveRound = this.state.liveCupRound;
    if (!liveRound) return false;
    const cup = this.state.cup;
    const event = cup.events.find((entry) => entry.id === liveRound.eventId);
    for (const live of liveRound.matches) {
      if (live.completed) continue;
      advanceVersusMatch(live.match, now);
      if (live.match.report) {
        const fixture = this.cupEventFixtures(event).find((entry) => entry.id === live.fixtureId);
        this.finalizeCupFixture(fixture, event, live.match);
        live.completed = true;
      }
    }
    if (liveRound.matches.every((entry) => entry.completed)) {
      this.archiveCompletedBroadcasts({ roundNumber:event.round, matches:liveRound.matches });
      this.completeCupEvent(event);
      this.state.liveCupRound = null;
      this.save();
    } else this.save({ skipDailyBackup:true });
    return true;
  }

  recoverFitness() {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => team.rosterIds.forEach((id) => {
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, injuryRounds:0 });
      const current = Number(state.fitness ?? 100);
      const starterRecovery = current < 70 ? 12 : 6;
      state.fitness = Math.min(100, current + (team.preferredStarterIds.includes(id) ? starterRecovery : 18));
    }));
  }

  advanceAvailability() {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => team.rosterIds.forEach((id) => {
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, injuryRounds:0 });
      if (!this.roundNewUnavailable?.has(`${team.id}:${id}:suspension`)) state.suspension = Math.max(0, Number(state.suspension ?? 0) - 1);
      if (!this.roundNewUnavailable?.has(`${team.id}:${id}:injury`)) state.injuryRounds = Math.max(0, Number(state.injuryRounds ?? 0) - 1);
    }));
  }

  advanceCupAvailability() {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => team.rosterIds.forEach((id) => {
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, cupSuspension:0, injuryRounds:0 });
      if (!this.cupNewUnavailable?.has(`${team.id}:${id}`)) state.cupSuspension = Math.max(0, Number(state.cupSuspension ?? 0) - 1);
    }));
    this.cupNewUnavailable = null;
  }

  payRewards(roundNumber) {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      let amount = 0; let wins = 0; let draws = 0;
      if (roundNumber % 3 === 0) {
        const recent = this.state.matches.filter((match) => match.round > roundNumber - 3 && (match.homeId === team.id || match.awayId === team.id));
        recent.forEach((match) => { const index = match.homeId === team.id ? 0 : 1; if (match.score[index] > match.score[index === 0 ? 1 : 0]) wins += 1; else if (match.score[0] === match.score[1]) draws += 1; });
        amount = (300 + wins * 90 + draws * 35) * REWARD_MULTIPLIER;
        this.wallet(team.ownerId).balance += amount;
        this.state.ledger.push({ id:makeId("ledger", `${team.id}-${roundNumber}`), accountId:team.ownerId, amount, type:"three-round-reward", round:roundNumber, createdAt:this.now() });
      }
      if (amount) this.pushInbox(team, {
        id:`reward:${this.state.season.id}:${roundNumber}`,
        type:"reward",
        title:`第${roundNumber}轮阶段金币已结算`,
        summary:`最近三轮取得 ${wins} 胜 ${draws} 平，获得 ${amount} 金币。`,
        body:"旧赛季每轮球员卡包已经下架；S4礼包只通过新商店、活动或管理员发放。",
        round:roundNumber,
        payload:{ amount, wins, draws },
      });
    });
  }

  createRewardPack(accountId, roundNumber, slot = 0) {
    void accountId;
    void roundNumber;
    void slot;
    return null;
  }

  grantCupReward(teamId, event, kind) {
    const team = this.state.teams.find((entry) => entry.id === teamId);
    if (!team?.ownerId) return null;
    const awardKey = `${event.id}:${kind}`;
    if (this.state.ledger.some((entry) => entry.type === "cup-coin-reward" && entry.accountId === team.ownerId && entry.grantId === awardKey)) return null;
    const amount = kind === "champion" ? CUP_CHAMPION_COIN_REWARD : CUP_ADVANCE_COIN_REWARD;
    const ledgerEntry = {
      id:makeId("ledger", `${team.id}-${awardKey}`),
      accountId:team.ownerId,
      amount,
      type:"cup-coin-reward",
      grantId:awardKey,
      competition:"cup",
      stage:event.stage,
      award:kind,
      round:event.round,
      createdAt:this.now(),
    };
    this.wallet(team.ownerId).balance += amount;
    this.state.ledger.push(ledgerEntry);
    const stageName = CUP_STAGE_NAMES[event.stage] ?? "决赛";
    this.pushInbox(team, {
      id:`cup-reward:${this.state.season.id}:${awardKey}:${team.id}`,
      type:"reward",
      title:kind === "champion" ? "黄狗冠军杯冠军奖励已送达" : `黄狗冠军杯${stageName}晋级奖励已送达`,
      summary:`获得 ${amount} 金币。`,
      body:kind === "champion"
        ? `恭喜夺得黄狗冠军杯冠军，冠军奖励 ${amount} 金币已经发放到账。`
        : `恭喜晋级黄狗冠军杯${stageName === "四分之一决赛" ? "半决赛" : "决赛"}，晋级奖励 ${amount} 金币已经发放到账。`,
      round:event.round,
      payload:{ amount, competition:"cup", stage:event.stage, award:kind, grantId:awardKey },
    });
    return ledgerEntry;
  }

  openRewardPack(account, offerIdValue) {
    const team = this.accountTeam(account.id);
    const offer = (this.state.rewardOffers[account.id] ?? []).find((entry) => entry.id === offerIdValue);
    if (!team || !offer) throw new Error("找不到这份赠送卡包");
    const choiceCount = offer.pool === "LEGEND" ? 1 : 3;
    if ((offer.playerIds ?? []).length === choiceCount) return this.view(account);
    const ownReserved = [
      ...(this.state.shopOffers[account.id]?.playerIds ?? []),
      ...(this.state.rewardOffers[account.id] ?? []).filter((entry) => entry.id !== offer.id).flatMap((entry) => entry.playerIds ?? []),
    ];
    const unavailable = [...this.unavailablePlayerIds(account.id), ...team.rosterIds, ...ownReserved];
    const tier = rewardPackTier(offer.tierId);
    const choices = this.drawPackChoices(offer.pool, tier, unavailable);
    offer.playerIds = choices.map((player) => player.id);
    offer.openedAt = this.now();
    this.save();
    return this.view(account);
  }

  rewardPackSlots(accountId, roundNumber) {
    const issued = [
      ...(this.state.rewardOffers[accountId] ?? []).filter((offer) => offer.round === roundNumber && !offer.source),
      ...this.state.ledger.filter((entry) => entry.accountId === accountId && ["round-pack-sign", "three-round-pack-sign"].includes(entry.type) && entry.round === roundNumber && entry.source !== "admin"),
    ];
    const slots = new Set(issued.map((entry) => Number(entry.slot ?? entry.rewardSlot)).filter(Number.isInteger));
    const legacyCount = issued.filter((entry) => !Number.isInteger(Number(entry.slot ?? entry.rewardSlot))).length;
    for (let index = 0; index < legacyCount; index += 1) {
      let slot = 0;
      while (slots.has(slot)) slot += 1;
      slots.add(slot);
    }
    return slots;
  }

  ensureRewardPacks(accountId) {
    void accountId;
    return false;
  }

  createAdminRewardPack(accountId, grant) {
    const team = this.accountTeam(accountId);
    const tier = rewardPackTier(grant.tierId);
    if (!team || !tier || !["MIXED", "LEGEND"].includes(grant.pool) && !REAL_PLAYER_POOLS[grant.pool]) return null;
    this.state.rewardOffers[accountId] ??= [];
    if (this.state.rewardOffers[accountId].some((offer) => offer.grantId === grant.id)) return null;
    const offer = {
      id:makeId("admin-reward", `${grant.id}-${accountId}`),
      round:grant.round,
      pool:grant.pool,
      tierId:tier.id,
      source:"admin",
      grantId:grant.id,
      playerIds:[],
      createdAt:this.now(),
    };
    this.state.rewardOffers[accountId].push(offer);
    return offer;
  }

  dispatchAdminRewardGrantToTeam(grant, team) {
    grant.recipientIds ??= [];
    if (!team?.ownerId || grant.recipientIds.includes(team.ownerId)) return false;
    const offer = this.createAdminRewardPack(team.ownerId, grant);
    if (!offer) return false;
    const tier = rewardPackTier(grant.tierId);
    const teamCreated = grant.trigger === "team-created";
    this.pushInbox(team, {
      id:`admin-pack:${grant.id}:${team.id}`,
      type:"reward",
      title:teamCreated ? "建队完成卡包奖励" : `第${grant.round}轮全服卡包奖励`,
      summary:`开发者发放了1份${tier.name}${grant.pool === "MIXED" ? "（全位置混池）" : grant.pool === "LEGEND" ? "" : `（${grant.pool}）`}。`,
      body:grant.pool === "LEGEND" ? "这份奖励已进入背包。打开后将随机获得1名当前仍可用的S级传奇球员。" : `这份奖励已进入背包，打开后可以从${grant.pool === "MIXED" ? "全位置混池" : grant.pool}中的三名球员选择一人签下。`,
      round:teamCreated ? null : grant.round,
      payload:{ offerId:offer.id, grantId:grant.id, pool:grant.pool, tierId:grant.tierId },
    });
    grant.recipientIds.push(team.ownerId);
    grant.recipientCount = grant.recipientIds.length;
    return true;
  }

  dispatchTeamCreatedRewardGrants(team = null) {
    const teams = team ? [team] : this.state.teams.filter((entry) => entry.ownerId);
    this.state.adminPackGrants
      .filter((grant) => grant.trigger === "team-created" && grant.status === "active")
      .forEach((grant) => teams.forEach((entry) => this.dispatchAdminRewardGrantToTeam(grant, entry)));
  }

  dispatchAdminRewardGrants(roundNumber) {
    this.state.adminPackGrants.filter((grant) => grant.status === "scheduled" && grant.round === roundNumber).forEach((grant) => {
      let failedCount = 0;
      this.state.teams.filter((team) => team.ownerId).forEach((team) => {
        if (this.dispatchAdminRewardGrantToTeam(grant, team)) return;
        failedCount += 1;
      });
      grant.status = "sent";
      grant.sentAt = this.now();
      grant.failedCount = failedCount;
    });
  }

  scheduleAdminRewardPack(body = {}) {
    const trigger = body.trigger === "team-created" ? "team-created" : "round";
    const round = trigger === "team-created" ? 1 : Math.floor(Number(body.round));
    const type = ADMIN_PACK_TYPES.find((entry) => entry.id === String(body.packType ?? ""));
    const pool = type?.pool ?? String(body.pool ?? "");
    const tierId = type?.tierId ?? String(body.tierId ?? "standard");
    if (!Number.isInteger(round) || round < 1 || round > this.state.season.totalRounds) throw new Error("请选择有效的联赛轮次");
    if (!type && !REAL_PLAYER_POOLS[pool]) throw new Error("请选择有效的位置卡包");
    if (type?.poolMode === "position" && !REAL_PLAYER_POOLS[pool]) throw new Error("请选择有效的位置卡包");
    if (!type && !PACK_TIERS[tierId]) throw new Error("请选择有效的卡包档位");
    const grant = {
      id:makeId("admin-pack-grant", `${this.state.season.id}-${trigger}-${trigger === "round" ? round : this.now()}-${pool}-${tierId}`),
      seasonId:this.state.season.id,
      trigger,
      round:trigger === "round" ? round : 0,
      pool,
      tierId,
      packType:type?.id ?? null,
      status:trigger === "round" ? "scheduled" : "active",
      createdAt:this.now(),
      sentAt:null,
      recipientCount:0,
      failedCount:0,
      recipientIds:[],
    };
    this.state.adminPackGrants.push(grant);
    if (trigger === "team-created") this.dispatchTeamCreatedRewardGrants();
    else if (round <= this.state.season.currentRound) this.dispatchAdminRewardGrants(round);
    this.save();
    return this.adminView();
  }

  awardChampionBadge(body = {}) {
    const accountId = String(body.accountId ?? "");
    const season = String(body.season ?? "").toUpperCase();
    const competition = body.competition === "cup" ? "cup" : "league";
    const team = this.accountTeam(accountId);
    if (!team) throw new Error("请选择已经加入联赛的玩家");
    const supportedSeasons = competition === "cup" ? CUP_CHAMPION_BADGE_SEASONS : CHAMPION_BADGE_SEASONS;
    if (!supportedSeasons.includes(season)) throw new Error(competition === "cup" ? "杯赛冠军徽章只支持S2或S3赛季" : "联赛冠军徽章只支持S0、S1或S2赛季");
    team.championBadges ??= [];
    if (team.championBadges.some((badge) => badge.season === season && (badge.competition ?? "league") === competition)) throw new Error(`该玩家已经拥有${season}${competition === "cup" ? "杯赛" : "联赛"}冠军徽章`);
    const badge = { id:`${competition}-champion-${season.toLowerCase()}`, type:competition === "cup" ? "cup-champion" : "champion", competition, season, awardedAt:this.now() };
    team.championBadges.push(badge);
    const competitionName = competition === "cup" ? "黄狗冠军杯" : "联赛";
    this.pushInbox(team, {
      id:`champion-badge:${competition}:${season}:${team.id}`,
      type:"notice",
      title:`${season}${competitionName}冠军徽章已授予`,
      summary:`${team.ownerName}获得${season}赛季${competitionName}冠军徽章。`,
      body:`这枚${competition === "cup" ? "奖杯" : "皇冠"}冠军徽章已经加入你的联赛荣誉，并会展示在积分榜玩家昵称旁。`,
      payload:{ badge },
    });
    this.save();
    return this.adminView();
  }

  chooseRewardPack(account, offerIdValue, playerId) {
    const team = this.accountTeam(account.id);
    const offers = this.state.rewardOffers[account.id] ?? [];
    const offer = offers.find((entry) => entry.id === offerIdValue);
    if (!team || !offer?.playerIds.includes(playerId)) throw new Error("只能选择赠送卡包中的球员");
    if (this.rosterSlotsUsed(account.id) >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，请先腾出一个位置");
    if (team.rosterIds.includes(playerId) || this.unavailablePlayerIds(account.id).has(playerId)) throw new Error("该球员已经被其他玩家签下");
    this.grantS4Card(team, playerId, {
      grantOwnership:true,
      acquisitionSource:offer.source === "admin" ? "admin-pack" : offer.source === "cup" ? "cup-pack" : "round-pack",
    });
    this.state.rewardOffers[account.id] = offers.filter((entry) => entry.id !== offer.id);
    this.state.ledger.push({ id:makeId("ledger", `${offer.id}-${playerId}`), accountId:account.id, amount:0, type:offer.source === "admin" ? "three-round-pack-sign" : offer.source === "cup" ? "cup-pack-sign" : "round-pack-sign", round:offer.round, source:offer.source, grantId:offer.grantId, rewardSlot:Number.isInteger(Number(offer.slot)) ? Number(offer.slot) : undefined, playerId, createdAt:this.now() });
    this.save();
    return this.view(account);
  }

  finishRound(round) {
    this.advanceAvailability();
    this.roundNewUnavailable = null;
    round.status = "complete";
    this.state.season.currentRound = round.number;
    this.payRewards(round.number);
    if (round.number >= this.state.season.totalRounds) { this.state.season.status = "completed"; this.state.season.completedAt = this.now(); }
    else this.state.season.nextRoundAt = nextSlot(this.now());
    this.createRoundInbox(round.number);
    this.updateDailyReports();
    this.archiveCompletedBroadcasts(this.state.liveRound);
    this.state.liveRound = null;
    this.save();
  }

  createRoundInbox(roundNumber) {
    const results = this.state.matches.filter((match) => match.round === roundNumber).map((match) => this.matchSummary(match));
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      const ownMatch = results.find((match) => match.homeId === team.id || match.awayId === team.id);
      if (!ownMatch) return;
      const ownIndex = ownMatch.homeId === team.id ? 0 : 1;
      const opponentName = ownIndex === 0 ? ownMatch.awayName : ownMatch.homeName;
      const ownScore = ownMatch.score[ownIndex];
      const opponentScore = ownMatch.score[ownIndex === 0 ? 1 : 0];
      const matchRecord = this.state.matches.find((match) => match.id === ownMatch.id);
      const autoRotations = matchRecord?.autoRotations?.[ownIndex] ?? [];
      const resultText = ownScore > opponentScore ? "取胜" : ownScore === opponentScore ? "战平" : "失利";
      const rank = this.standings().find((entry) => entry.id === team.id)?.rank ?? TEAM_COUNT;
      const injured = team.rosterIds.filter((id) => Number(team.playerState[id]?.injuryRounds ?? 0) > 0).map((id) => ({ id, name:REAL_PLAYER_BY_ID[id].name, rounds:team.playerState[id].injuryRounds }));
      const suspended = team.rosterIds.filter((id) => Number(team.playerState[id]?.suspension ?? 0) > 0).map((id) => ({ id, name:REAL_PLAYER_BY_ID[id].name, rounds:team.playerState[id].suspension }));
      const next = this.nextOpponent(team.id);
      this.pushInbox(team, {
        id:`matchweek:${this.state.season.id}:${roundNumber}`,
        type:"matchweek",
        title:`第${roundNumber}轮比赛周战报`,
        summary:`${team.name} ${ownScore}:${opponentScore} ${opponentName}，本轮${resultText}。`,
        body:`球队目前排名第 ${rank}，积 ${team.table.points} 分。${next ? `下一轮将${next.venue === "home" ? "主场" : "客场"}迎战 ${next.name}。` : "本赛季赛程已经完成。"}`,
        round:roundNumber,
        matchId:ownMatch.id,
        payload:{ results, rank, points:team.table.points, injured, suspended, next, autoRotations },
      });
      if (autoRotations.length) {
        const details = autoRotations.map((rotation) => `${rotation.outName}因${rotation.reason}由${rotation.inName}自动替换`).join("；");
        this.pushInbox(team, {
          id:`rotation:${this.state.season.id}:${roundNumber}`,
          type:"lineup",
          title:`第${roundNumber}轮自动轮换报告`,
          summary:`系统在赛前完成 ${autoRotations.length} 处自动换人。`,
          body:`${details}。这些调整只对本轮实际出场阵容生效，不会改变你保存的主力阵容。`,
          round:roundNumber,
          matchId:ownMatch.id,
          payload:{ autoRotations },
        });
      }
      if (injured.length || suspended.length) {
        this.pushInbox(team, {
          id:`availability:${this.state.season.id}:${roundNumber}`,
          type:"medical",
          title:"下一轮阵容可用性提醒",
          summary:`${injured.length}人伤缺，${suspended.length}人停赛。`,
          body:`${[...injured.map((player) => `${player.name}伤缺${player.rounds}轮`), ...suspended.map((player) => `${player.name}停赛${player.rounds}轮`)].join("；")}。系统会按位置从替补席自动补位。`,
          round:roundNumber,
          payload:{ injured, suspended },
        });
      }
    });
  }

  simulateNextRound() {
    if (this.state.season.status === "registration") throw new Error("联赛仍在报名选人阶段，请先在后台开启联赛推进");
    if (this.state.season.status === "completed") throw new Error("本赛季已经结束");
    const round = this.state.rounds[this.state.season.currentRound];
    if (!round || round.status === "complete") throw new Error("没有可模拟的轮次");
    round.status = "running";
    this.recoverFitness();
    this.roundNewUnavailable = new Set();
    round.fixtures.forEach((fixture) => this.simulateFixture(fixture, round.number));
    this.finishRound(round);
    this.simulatePendingCupEvent();
    return round.number;
  }

  startScheduledRound() {
    const round = this.state.rounds[this.state.season.currentRound];
    if (!round || round.status !== "pending") return false;
    round.status = "running";
    this.recoverFitness();
    this.roundNewUnavailable = new Set();
    const liveMatches = [];
    round.fixtures.forEach((fixture, fixtureIndex) => {
      const created = this.createFixtureMatch(fixture, round.number);
      if (created.home.ownerId || created.away.ownerId) {
        liveMatches.push({ code:`YDL-${this.state.season.name}-R${round.number}-M${fixtureIndex + 1}`, fixtureIndex, match:created.match, spectators:{} });
      } else {
        settleAutomatedMatch(created.match, created.startedAt);
        this.finalizeFixture(fixture, round.number, created.match);
      }
    });
    if (!liveMatches.length) {
      this.finishRound(round);
      return true;
    }
    this.state.liveRound = { roundNumber:round.number, startedAt:this.now(), matches:liveMatches, newUnavailable:[...this.roundNewUnavailable] };
    this.save();
    return true;
  }

  advanceLiveRound(now = this.now()) {
    const liveRound = this.state.liveRound;
    if (!liveRound) return false;
    const round = this.state.rounds.find((entry) => entry.number === liveRound.roundNumber);
    this.roundNewUnavailable = new Set(liveRound.newUnavailable ?? []);
    for (const live of liveRound.matches) {
      if (live.completed) continue;
      advanceVersusMatch(live.match, now);
      if (live.match.report) {
        this.finalizeFixture(round.fixtures[live.fixtureIndex], round.number, live.match);
        live.completed = true;
      }
    }
    liveRound.newUnavailable = [...this.roundNewUnavailable];
    if (liveRound.matches.every((entry) => entry.completed)) this.finishRound(round);
    else this.save({ skipDailyBackup:true });
    return true;
  }

  liveMatch(codeValue) {
    this.advanceLiveRound(this.now());
    const code = String(codeValue ?? "").toUpperCase();
    const live = [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? [])].find((entry) => entry.code.toUpperCase() === code && !entry.completed);
    if (!live) throw new Error("这场联赛直播已经结束");
    return live;
  }

  archiveCompletedBroadcasts(liveRound) {
    if (!liveRound?.matches?.length) return;
    this.purgeCompletedBroadcasts();
    const round = this.state.rounds.find((entry) => entry.number === liveRound.roundNumber);
    liveRound.matches.filter((live) => live.completed).forEach((live) => {
      if (this.state.completedBroadcasts.some((entry) => entry.code === live.code)) return;
      const fixture = round?.fixtures[live.fixtureIndex];
      this.state.completedBroadcasts.push({
        code:live.code,
        round:liveRound.roundNumber,
        matchId:fixture?.matchId ?? null,
        completedAt:this.now(),
        spectators:clone(live.spectators ?? {}),
        match:publicMatch(live.match, this.now(), null, true),
      });
    });
  }

  purgeCompletedBroadcasts() {
    const cutoff = this.now() - COMPLETED_BROADCAST_RETENTION_MS;
    this.state.completedBroadcasts = (this.state.completedBroadcasts ?? []).filter((entry) => entry.completedAt >= cutoff);
  }

  completedBroadcast(codeValue) {
    this.purgeCompletedBroadcasts();
    const code = String(codeValue ?? "").toUpperCase();
    return this.state.completedBroadcasts.find((entry) => entry.code.toUpperCase() === code) ?? null;
  }

  cleanupLiveSpectators(live) {
    const cutoff = this.now() - 30_000;
    Object.entries(live.spectators ?? {}).forEach(([token, spectator]) => {
      if (spectator.lastSeenAt < cutoff) delete live.spectators[token];
    });
  }

  broadcasts() {
    this.advanceLiveRound(this.now());
    this.purgeCompletedBroadcasts();
    return clone([...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? [])].filter((live) => !live.completed).map((live) => {
      this.cleanupLiveSpectators(live);
      const snapshot = publicMatch(live.match, this.now(), null, true);
      return {
        code:live.code,
        round:live.round ?? this.state.liveRound?.roundNumber ?? this.state.cup?.stage,
        teams:snapshot.teams.map((team) => ({ name:team.name, formation:team.formation })),
        score:[...snapshot.score],
        minute:snapshot.minute,
        segment:snapshot.segment,
        weather:snapshot.weather,
        spectatorCount:Object.keys(live.spectators ?? {}).length,
        competition:live.code.startsWith("YDL-CUP-") ? "YellowDogs Champion Cup" : "YellowDogs League",
      };
    }));
  }

  broadcastView(live) {
    this.cleanupLiveSpectators(live);
    return clone({
      code:live.code,
      round:live.round ?? this.state.liveRound?.roundNumber ?? this.state.cup?.stage ?? 0,
      live:!live.completed && !live.match.report,
      spectators:Object.values(live.spectators ?? {}).map(({ name }) => ({ name })),
      match:publicMatch(live.match, this.now(), null, true),
      competition:live.code.startsWith("YDL-CUP-") ? "YellowDogs Champion Cup" : "YellowDogs League",
    });
  }

  watch(code, spectatorName, existingToken = null) {
    const live = this.liveMatch(code);
    live.spectators ??= {};
    const spectatorToken = existingToken && live.spectators[existingToken] ? existingToken : makeId("viewer", code);
    live.spectators[spectatorToken] = { name:String(spectatorName ?? "匿名观众").trim().slice(0, 30) || "匿名观众", lastSeenAt:this.now() };
    return { spectatorToken, broadcast:this.broadcastView(live) };
  }

  watchView(code, spectatorToken) {
    this.advanceLiveRound(this.now());
    const codeKey = String(code ?? "").toUpperCase();
    const live = [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? [])].find((entry) => entry.code.toUpperCase() === codeKey && !entry.completed);
    if (live) {
      if (!live.spectators?.[spectatorToken]) throw new Error("观赛会话已过期，请重新进入直播");
      live.spectators[spectatorToken].lastSeenAt = this.now();
      return this.broadcastView(live);
    }
    const completed = this.completedBroadcast(code);
    if (!completed?.spectators?.[spectatorToken]) throw new Error("这场联赛直播已经结束");
    return clone({
      code:completed.code,
      round:completed.round,
      matchId:completed.matchId,
      live:false,
      spectators:Object.values(completed.spectators).map(({ name }) => ({ name })),
      match:completed.match,
      competition:completed.code.startsWith("YDL-CUP-") ? "YellowDogs Champion Cup" : "YellowDogs League",
    });
  }

  leaveWatch(code, spectatorToken) {
    this.advanceLiveRound(this.now());
    const codeKey = String(code ?? "").toUpperCase();
    const live = [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? [])].find((entry) => entry.code.toUpperCase() === codeKey && !entry.completed);
    if (live) delete live.spectators?.[spectatorToken];
    const completed = this.completedBroadcast(code);
    if (completed) delete completed.spectators?.[spectatorToken];
    return { left:true };
  }

  tick() {
    const now = this.now();
    if (this.statePath && localDateKey(new Date(now)) !== this.lastBackupMaintenanceDate) this.maintainBackups();
    if (this.state.liveRound) return this.advanceLiveRound(now);
    if (this.state.liveCupRound) return this.advanceLiveCupRound(now);
    if (this.state.cup.status === "active" && activeTime(now) && now >= Number(this.state.cup.nextRoundAt ?? Infinity)) return this.startScheduledCupEvent();
    if (this.state.season.status !== "active" || !activeTime(now) || now < this.state.season.nextRoundAt) return false;
    return this.startScheduledRound();
  }

  buildDailyReport(team, date = localDateKey(new Date(this.now()))) {
    const rank = this.standings().find((entry) => entry.id === team.id)?.rank ?? TEAM_COUNT;
    const matches = this.state.matches.filter((match) => localDateKey(new Date(match.playedAt)) === date && (match.homeId === team.id || match.awayId === team.id));
    const playerTotals = new Map();
    const results = matches.map((match) => {
      const index = match.homeId === team.id ? 0 : 1;
      const opponentIndex = index === 0 ? 1 : 0;
      const own = match.score[index];
      const against = match.score[opponentIndex];
      const reportTeam = match.report?.teams?.[index];
      reportTeam?.players?.forEach((player) => {
        const current = playerTotals.get(player.id) ?? { id:player.id, name:player.name, appearances:0, goals:0, assists:0, ratingTotal:0 };
        current.appearances += 1;
        current.goals += Number(player.stats?.goals ?? 0);
        current.assists += Number(player.stats?.assists ?? 0);
        current.ratingTotal += Number(player.rating ?? 0);
        playerTotals.set(player.id, current);
      });
      return {
        matchId:match.id,
        round:match.round,
        opponentName:index === 0 ? match.awayName : match.homeName,
        venue:index === 0 ? "home" : "away",
        scoreFor:own,
        scoreAgainst:against,
        result:own > against ? "W" : own === against ? "D" : "L",
        formation:reportTeam?.formation ?? match.formations?.[index] ?? "未知",
        tactic:reportTeam?.tactic ?? team.tactic,
        style:reportTeam?.style ?? team.style,
      };
    });
    const topPlayers = [...playerTotals.values()].map((player) => ({
      ...player,
      averageRating:Number((player.ratingTotal / Math.max(1, player.appearances)).toFixed(2)),
    })).sort((left, right) => right.averageRating - left.averageRating || right.goals - left.goals || right.assists - left.assists).slice(0, 3);
    const wins = results.filter((entry) => entry.result === "W").length;
    const draws = results.filter((entry) => entry.result === "D").length;
    const losses = results.length - wins - draws;
    const goalsFor = results.reduce((sum, entry) => sum + entry.scoreFor, 0);
    const goalsAgainst = results.reduce((sum, entry) => sum + entry.scoreAgainst, 0);
    const players = team.rosterIds.map((id) => ({ ...playerSummary(REAL_PLAYER_BY_ID[id]), state:{ fitness:100, suspension:0, injuryRounds:0, ...(team.playerState[id] ?? {}) } }));
    const injured = players.filter((player) => player.state.injuryRounds > 0).map((player) => ({ id:player.id, name:player.name, rounds:player.state.injuryRounds }));
    const suspended = players.filter((player) => player.state.suspension > 0).map((player) => ({ id:player.id, name:player.name, rounds:player.state.suspension }));
    const lowFitness = players.filter((player) => player.state.fitness < 60 && !player.state.injuryRounds && !player.state.suspension).sort((left, right) => left.state.fitness - right.state.fitness).map((player) => ({ id:player.id, name:player.name, fitness:Math.round(player.state.fitness) }));
    const coinChange = this.state.ledger.filter((entry) => entry.accountId === team.ownerId && localDateKey(new Date(entry.createdAt)) === date).reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
    const headline = !results.length ? "备战日" : wins > losses ? "状态上扬" : losses > wins ? "需要调整" : "表现平稳";
    const managerNote = injured.length || suspended.length
      ? `下一轮有${injured.length + suspended.length}名球员无法出场，系统将优先从替补席按位置补位。`
      : lowFitness.length
        ? `有${lowFitness.length}名球员体能低于60，建议检查首发和轮换安排。`
        : results.length
          ? `今日${wins}胜${draws}平${losses}负，球队阵容完整，可以继续围绕当前战术准备下一轮。`
          : "今日尚无比赛，球队阵容完整，可以调整首发和战术等待下一轮。";
    return {
      date,
      generatedAt:this.now(),
      teamId:team.id,
      teamName:team.name,
      headline,
      rank,
      points:team.table.points,
      record:`${team.table.won}胜 ${team.table.drawn}平 ${team.table.lost}负`,
      goalDifference:team.table.goalsFor - team.table.goalsAgainst,
      today:{ played:results.length, wins, draws, losses, goalsFor, goalsAgainst, results },
      bestPlayer:topPlayers[0] ? { name:topPlayers[0].name, averageRating:topPlayers[0].averageRating } : null,
      topPlayers,
      tactics:{ formation:mostCommon(results.map((entry) => entry.formation)) ?? (team.preferredStarterIds.length === 11 ? analyzeElevenFormation(team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]), team.positions).name : null), tactic:mostCommon(results.map((entry) => entry.tactic)) ?? team.tactic, style:mostCommon(results.map((entry) => entry.style)) ?? team.style },
      availability:{ total:players.length, available:players.length - injured.length - suspended.length, averageFitness:players.length ? Math.round(players.reduce((sum, player) => sum + Number(player.state.fitness ?? 100), 0) / players.length) : 0, injured, suspended, lowFitness },
      economy:{ coinChange },
      managerNote,
      nextOpponent:this.nextOpponent(team.id),
    };
  }

  updateDailyReports(date = localDateKey(new Date(this.now()))) {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      const reports = this.state.reports[team.id] ?? (this.state.reports[team.id] = []);
      const report = this.buildDailyReport(team, date);
      const index = reports.findIndex((entry) => entry.date === date);
      if (index >= 0) reports[index] = report;
      else reports.push(report);
      this.state.reports[team.id] = reports.sort((left, right) => left.date.localeCompare(right.date)).slice(-14);
      this.pushInbox(team, {
        id:`daily:${this.state.season.id}:${date}`,
        type:"daily-report",
        title:`${date} 球队当日报告`,
        summary:`${report.headline} · 今日 ${report.today.wins}胜${report.today.draws}平${report.today.losses}负`,
        body:report.managerNote,
        report,
      });
    });
  }

  teamReport(team) {
    return this.buildDailyReport(team);
  }

  nextOpponent(teamId) {
    const fixture = this.teamSchedule(teamId).find((entry) => entry.status !== "complete");
    if (!fixture) return null;
    return {
      round:fixture.round,
      startsAt:fixture.startsAt,
      name:fixture.opponentName,
      opponentId:fixture.opponentId,
      competition:fixture.competition,
      competitionName:fixture.competitionName,
      label:fixture.label,
      stage:fixture.stage ?? null,
      leg:fixture.leg ?? null,
      weather:fixture.weather,
      referee:fixture.referee,
    };
  }

  archiveSeason(reason) {
    this.state.archives ??= [];
    this.state.archives.push({
      reason,
      archivedAt:this.now(),
      season:clone(this.state.season),
      standings:this.standings().map((entry) => ({ ...entry, team:publicTeam(this.state.teams.find((team) => team.id === entry.id)) })),
      matches:clone(this.state.matches),
      playerStats:clone(this.state.playerStats),
    });
    this.state.archives = this.state.archives.slice(-12);
  }

  resetCompetition(name, reason, status = "active") {
    this.archiveSeason(reason);
    this.state.teams.forEach((team) => {
      team.table = freshTable();
      team.form = [];
      if (team.ownerId) {
        this.wallet(team.ownerId).balance = INITIAL_WALLET_BALANCE;
        team.rosterIds.forEach((id) => {
          team.playerState[id] = { fitness:100, suspension:0, injuryRounds:0 };
        });
      }
    });
    const startedAt = this.now();
    const firstRoundAt = status === "active" ? nextSlot(startedAt) : null;
    this.state.season = { id:`${name}-${localDateKey(new Date(startedAt))}-${startedAt.toString(36)}`, name, date:localDateKey(new Date(startedAt)), status, currentRound:0, totalRounds:18, nextRoundAt:firstRoundAt, firstRoundAt, startedAt:status === "active" ? startedAt : null, registrationOpenedAt:status === "registration" ? startedAt : null, completedAt:null };
    this.state.rounds = roundRobin(this.state.teams.map((team) => team.id));
    this.state.matches = [];
    this.state.playerStats = {};
    this.state.ledger = [];
    this.state.adminPackGrants = [];
    this.state.reports = {};
    this.state.liveRound = null;
    this.state.liveCupRound = null;
    this.state.cup = { status:"waiting", stage:"waiting", participants:[], table:{}, swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, completedAt:null };
    this.save();
    return this.adminView();
  }

  restartSeason() {
    return this.resetCompetition(this.state.season.name, "restarted");
  }

  startNewSeason() {
    const current = Number(String(this.state.season.name).match(/\d+/)?.[0] ?? 1);
    return this.resetCompetition(`S${current + 1}`, "new-season", "registration");
  }

  fullReset() {
    const resetAt = this.now();
    this.backupFile(`before-full-reset-${localDateKey(new Date(resetAt))}-${resetAt}.json`);
    this.state = createState(resetAt);
    this.state.season.status = "registration";
    this.state.season.nextRoundAt = null;
    this.state.season.startedAt = null;
    this.state.season.registrationOpenedAt = resetAt;
    this.state.lastFullResetAt = resetAt;
    this.save();
    return this.adminView();
  }

  startFreshSeason() {
    const resetAt = this.now();
    const current = Number(String(this.state.season.name).match(/\d+/)?.[0] ?? 0);
    const seasonName = `S${current + 1}`;
    this.backupFile(`before-fresh-season-${seasonName.toLowerCase()}-${localDateKey(new Date(resetAt))}-${resetAt}.json`);
    this.state = createState(resetAt, seasonName);
    this.state.season.status = "registration";
    this.state.season.nextRoundAt = null;
    this.state.season.startedAt = null;
    this.state.season.registrationOpenedAt = resetAt;
    this.state.lastFreshSeasonAt = resetAt;
    this.save();
    return this.adminView();
  }

  startLeagueSimulation() {
    if (this.state.season.status !== "registration") throw new Error(this.state.season.status === "active" ? "联赛推进已经开启" : "当前赛季无法开启推进");
    const startedAt = this.now();
    this.state.season.status = "active";
    this.state.season.startedAt = startedAt;
    this.state.season.nextRoundAt = nextSlot(startedAt);
    this.state.season.firstRoundAt = this.state.season.nextRoundAt;
    this.save();
    return this.adminView();
  }

  backupView() {
    if (!this.backupDir || !existsSync(this.backupDir)) return { directory:this.backupDir, retentionDays:BACKUP_RETENTION_DAYS, files:[] };
    return {
      directory:this.backupDir,
      retentionDays:BACKUP_RETENTION_DAYS,
      files:readdirSync(this.backupDir).filter((name) => name.endsWith(".json")).sort().reverse().slice(0, 14),
    };
  }

  adminEconomyView() {
    const tierName = (tierId) => rewardPackTier(tierId)?.name ?? tierId ?? "未知档位";
    const playerData = (playerId) => {
      const player = REAL_PLAYER_BY_ID[playerId];
      return player ? { id:player.id, name:player.name, overall:player.overall, grade:player.grade, pool:player.pool } : null;
    };
    const ledgerLabel = {
      "pack-buy":"商店购买卡包",
      "pack-sign":"商店卡包签约",
      "release":"球员解约",
      "transfer-buy":"转会市场买入",
      "transfer-sale":"转会市场售出",
      "card-buy":"单卡买入",
      "card-sale":"单卡售出",
      "ownership-buy":"球员所有权买入",
      "ownership-sale":"球员所有权售出",
      "ownership-return":"球员所有权返还系统",
      "three-round-reward":"联赛金币奖励",
      "cup-coin-reward":"杯赛金币奖励",
      "round-pack-reward":"每轮卡包奖励",
      "round-pack-sign":"每轮卡包签约",
      "three-round-pack-sign":"后台奖励包签约",
      "cup-pack-sign":"杯赛奖励包签约",
      "admin-player-card-grant":"后台指定球员卡发放",
    };
    return this.state.teams.filter((team) => team.ownerId).map((team) => {
      const entries = this.state.ledger.filter((entry) => entry.accountId === team.ownerId).map((entry) => {
        let playerId = entry.playerId ?? null;
        if (!playerId && ["transfer-buy", "transfer-sale"].includes(entry.type)) {
          const listing = this.state.listings.find((item) => item.id === entry.listingId || item.closedAt === entry.createdAt && (item.sellerId === team.ownerId || item.buyerId === team.ownerId));
          playerId = listing?.playerId ?? null;
        }
        return {
          ...entry,
          label:ledgerLabel[entry.type] ?? entry.type,
          tierName:entry.tierId ? tierName(entry.tierId) : null,
          player:playerData(playerId),
        };
      }).sort((left, right) => right.createdAt - left.createdAt);
      const income = entries.reduce((total, entry) => total + Math.max(0, Number(entry.amount) || 0), 0);
      const expense = entries.reduce((total, entry) => total + Math.abs(Math.min(0, Number(entry.amount) || 0)), 0);
      const shopPacks = entries.filter((entry) => entry.type === "s4-pack-buy");
      const signings = entries.filter((entry) => ["pack-sign", "round-pack-sign", "three-round-pack-sign", "cup-pack-sign", "admin-player-card-grant"].includes(entry.type));
      const releases = entries.filter((entry) => entry.type === "release");
      const transfers = entries.filter((entry) => ["transfer-buy", "transfer-sale", "card-buy", "card-sale", "ownership-buy", "ownership-sale", "ownership-return"].includes(entry.type));
      return {
        accountId:team.ownerId,
        ownerName:team.ownerName,
        teamId:team.id,
        teamName:team.name,
        balance:this.wallet(team.ownerId).balance,
        income,
        expense,
        net:income - expense,
        shopPackCounts:S4_PACK_CATALOG.map((pack) => ({
          tierId:pack.id,
          tierName:pack.name,
          count:shopPacks.filter((entry) => entry.packType === pack.id).reduce((sum, entry) => sum + Number(entry.quantity ?? 1), 0),
        })),
        signings,
        releases,
        transfers,
        ledger:entries,
      };
    }).sort((left, right) => right.balance - left.balance || left.teamName.localeCompare(right.teamName, "zh-CN"));
  }

  adminView() {
    ensureS4Assets(this.state);
    const owned = new Map();
    Object.entries(this.state.s4Assets.ownerships).forEach(([playerId, accountId]) => {
      const team = this.accountTeam(accountId);
      if (team) owned.set(playerId, team);
    });
    const reserved = new Map();
    Object.entries(this.state.drafts).forEach(([accountId, draft]) => draft.selectedIds.forEach((id) => reserved.set(id, { accountId, teamName:draft.teamName })));
    const pools = Object.fromEntries(Object.entries(REAL_PLAYER_POOLS).map(([pool, players]) => {
      const selected = players.filter((player) => owned.has(player.id)).length;
      const drafting = players.filter((player) => reserved.has(player.id)).length;
      return [pool, { total:players.length, selected, drafting, available:players.length - selected - drafting }];
    }));
    const allocations = REAL_PLAYERS.filter((player) => owned.has(player.id) || reserved.has(player.id) || Object.values(this.state.s4Assets.cards).some((card) => card.status === "active" && card.playerId === player.id)).map((player) => {
      const team = owned.get(player.id);
      const draft = reserved.get(player.id);
      const circulating = Object.values(this.state.s4Assets.cards).filter((card) => card.status === "active" && card.playerId === player.id);
      return {
        ...playerSummary(player),
        status:team ? "owned" : draft ? "drafting" : "cards-circulating",
        teamId:team?.id ?? null,
        teamName:team?.name ?? draft?.teamName ?? null,
        ownerName:team?.ownerName ?? null,
        cardCount:circulating.length,
        cardHolderCount:new Set(circulating.map((card) => card.ownerId)).size,
        highestUpgrade:Math.max(0, ...circulating.map((card) => Number(card.upgradeLevel ?? 0))),
      };
    });
    return clone({
      season:this.state.season,
      cup:this.cupView(),
      schedule:{ activeHours:"10:00 - 22:00", intervalMinutes:20 },
      teams:this.standings().map((entry) => {
        const team = this.state.teams.find((candidate) => candidate.id === entry.id);
        return { ...entry, ...publicTeam(team), ownerId:team.ownerId, rosterCount:team.ownerId ? this.rosterSlotsUsed(team.ownerId) : team.rosterIds.length, rosterFamilyCount:team.rosterIds.length };
      }),
      pools,
      allocations,
      drafts:Object.entries(this.state.drafts).map(([accountId, draft]) => ({ accountId, teamName:draft.teamName, selectedCount:draft.selectedIds.length, startedAt:draft.startedAt })),
      matches:this.state.matches.length,
      backups:this.backupView(),
      s4PackCatalog:S4_PACK_CATALOG.map((pack) => ({ ...pack })),
      s4PackGrants:this.state.s4Packs.grants.slice().sort((left, right) => right.createdAt - left.createdAt),
      s4PlayerCatalog:REAL_PLAYERS.map((player) => ({ id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole, pool:player.pool, overall:player.overall, grade:player.grade, nationality:player.nationality, club:player.club })),
      s4CardGrants:(this.state.s4Packs.cardGrants ?? []).slice().sort((left, right) => right.createdAt - left.createdAt),
      economy:this.adminEconomyView(),
      s4Assets:{
        schemaVersion:this.state.s4Assets.schemaVersion,
        ownershipCount:Object.keys(this.state.s4Assets.ownerships).length,
        activeCardCount:Object.values(this.state.s4Assets.cards).filter((card) => card.status === "active").length,
        recycledCardCount:Object.values(this.state.s4Assets.cards).filter((card) => card.status === "recycled").length,
        recentTransactions:this.state.s4Assets.transactions.slice(-100).reverse(),
      },
      rewardGrants:[],
      lastFullResetAt:this.state.lastFullResetAt ?? null,
      archives:(this.state.archives ?? []).map((archive) => ({ reason:archive.reason, archivedAt:archive.archivedAt, season:archive.season, matchCount:archive.matches?.length ?? 0 })),
    });
  }
}

export const yellowDogsLeague = new YellowDogsLeagueService();
