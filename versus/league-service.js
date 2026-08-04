import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTrackedState, LEAGUE_SHARD_SCOPES, LeagueShardStore, isLeagueShardPath, unwrapTracked } from "./league-shard-store.js";
import { advanceVersusMatch, createVersusMatch, drawVersusReferee, drawVersusWeather, publicMatch, REGULAR_DURATION_MS, HALFTIME_ADJUSTMENT_MS } from "./match-engine.js";
import { hydrateHistoricalMatchDetail } from "./history-detail.js";
import { isS4Legend, isXPlayer, REAL_PLAYER_BY_ID, REAL_PLAYER_POOLS, REAL_PLAYERS, X_PLAYERS } from "./player-pool.js";
import { analyzeElevenFormation, drawUniqueMixedPlayers, drawUniquePlayers, inferElevenBoardRoles, sanitizePositions } from "./rules.js";
import { ATTRIBUTE_LABELS, ATTRIBUTE_NAMES, PLAYER_OVERALL_ATTRIBUTE_KEYS, playerOverallFromAttributes, roleGroup } from "../game/public/schema.js";
import { YDL_TRAIT_BY_ID, YDL_TRAIT_CARDS } from "./trait-pool.js";
import { advanceYdlLeagueV2Match, createYdlLeagueV2Match, publicYdlLeagueV2Match } from "./v2/ydl-league-engine-adapter.js";
import { createV2MatchRng } from "./v2/match-engine-v2.js";
import { applyS4Enhancement, S4_ECONOMY, S4_ENHANCEMENT, S4_PACK_PRICES, S4_PRICING, s4BaseCardReferenceValue, s4CardValueMultiplier, s4EffectiveOverall, s4EnhancementChanceForLevels, s4EnhancementProtectionCost, s4OwnershipReferenceValue } from "./s4-balance.js";
import { applyS4BondBonuses, createS4BondCatalog, evaluateS4LineupBonds } from "./public/bond-rules.js";
import { analyzeElevenBoardFormation, deriveFormationLines, sanitizeFormationLines } from "./public/formation-rules.js";
import { DEFAULT_IN_POSSESSION_DETAILS, DEFAULT_OUT_OF_POSSESSION_DETAILS, IN_POSSESSION_DETAIL_OPTIONS, OUT_OF_POSSESSION_DETAIL_OPTIONS } from "./public/v2-tactical-profiles.js";
import { measureRuntimeSync } from "../src/runtime-metrics.js";
import {
  assertS4AssetInvariants,
  cardsForOwner,
  createS4Card,
  ensureS4Assets,
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
const V2_REVIEW_DEMO_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/v2-review-demo-alpha7.json");
const TEAM_COUNT = 10;
const DRAFT_ROSTER_SIZE = 22;
const X_PLAYER_HEIGHT_MIN = 160;
const X_PLAYER_INITIAL_HEIGHT_MAX = 186;
const X_PLAYER_GROWTH_HEIGHT_MAX = 230;
const X_GROWTH_RESET_COST = 8000;
const X_PLAYER_ROLES = Object.freeze(["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
const X_GROWTH_PACK = Object.freeze({ id:"x-growth-1", name:"X球员加成点数", points:1, price:3000, description:"获得1点X球员加成点数。" });
const X_GROWTH_TASKS = Object.freeze([
  Object.freeze({ id:"appearances", label:"正式比赛出场", stat:"appearances", groups:["GK", "DEF", "MID", "ATT"], milestones:[1, 3, 5, 10, 18, 25, 35, 50, 70, 90], rewards:[1, 1, 2, 3, 5, 2, 3, 4, 5, 6] }),
  Object.freeze({ id:"goals", label:"进球", stat:"goals", groups:["ATT"], milestones:[1, 2, 3, 5, 8, 12, 18, 25], rewards:[2, 3, 5, 2, 3, 4, 5, 6] }),
  Object.freeze({ id:"assists", label:"助攻", stat:"assists", groups:["MID"], milestones:[1, 2, 4, 7, 11, 16, 22], rewards:[3, 7, 2, 3, 4, 5, 6] }),
  Object.freeze({ id:"tackles", label:"抢断与拦截", stat:"tackles", groups:["DEF"], milestones:[2, 5, 8, 11, 16, 22, 30, 40, 52], rewards:[2, 3, 4, 5, 2, 3, 4, 5, 6] }),
  Object.freeze({ id:"saves", label:"扑救", stat:"saves", groups:["GK"], milestones:[5, 10, 20, 30, 45, 65, 90, 120, 160], rewards:[1, 2, 3, 5, 2, 3, 4, 5, 6] }),
]);
const CLUB_ROSTER_LIMIT = 33;
const POSITION_PRESET_KEYS = Object.freeze(["position1", "position2", "position3"]);
const V2_TACTICAL_DIMENSION_KEYS = Object.freeze(["tempo", "directness", "attackingWidth", "defensiveLine", "pressing", "compactness", "counterAttack", "timeWasting"]);
const FRIENDLY_INVITATION_TTL_MS = 2 * 60 * 60 * 1000;

function sanitizeV2TacticalDimensions(value = {}, fallback = {}) {
  return Object.fromEntries(V2_TACTICAL_DIMENSION_KEYS.flatMap((key) => {
    const submitted = Number(value?.[key]);
    const retained = Number(fallback?.[key]);
    const resolved = Number.isFinite(submitted) ? submitted : retained;
    return Number.isFinite(resolved) ? [[key, Math.max(0, Math.min(100, Math.round(resolved)))]] : [];
  }));
}

function v2TacticalDimensionsProperty(value, fallback) {
  const tacticalDimensions = sanitizeV2TacticalDimensions(value, fallback);
  return Object.keys(tacticalDimensions).length ? { tacticalDimensions } : {};
}

function sanitizeV2TacticalDetailGroup(value, fallback, options, defaults) {
  const source = { ...defaults, ...(fallback ?? {}), ...(value ?? {}) };
  return Object.fromEntries(Object.entries(options).map(([key, choices]) => [key, Object.hasOwn(choices, source[key]) ? source[key] : defaults[key]]));
}

function v2TacticalDetailsProperty(plan, fallback = {}) {
  if (!plan?.inPossessionDetails && !plan?.outOfPossessionDetails && !fallback?.inPossessionDetails && !fallback?.outOfPossessionDetails) return {};
  return {
    inPossessionDetails:sanitizeV2TacticalDetailGroup(plan?.inPossessionDetails, fallback?.inPossessionDetails, IN_POSSESSION_DETAIL_OPTIONS, DEFAULT_IN_POSSESSION_DETAILS),
    outOfPossessionDetails:sanitizeV2TacticalDetailGroup(plan?.outOfPossessionDetails, fallback?.outOfPossessionDetails, OUT_OF_POSSESSION_DETAIL_OPTIONS, DEFAULT_OUT_OF_POSSESSION_DETAILS),
  };
}
export const S4_PACK_CATALOG = Object.freeze([
  Object.freeze({ id:"legend-random", name:"传奇随机卡包", price:S4_PACK_PRICES["legend-random"], kind:"legend", pool:"LEGEND", selectionMode:"choice", description:"随机展示3名传奇球员，选择其中1张球员卡。" }),
  Object.freeze({ id:"private-mixed", name:"私有池全位置随机礼包", price:S4_PACK_PRICES["private-mixed"], kind:"private", pool:"MIXED", selectionMode:"direct", description:"从你拥有所有权的全部非传奇球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-att", name:"私有池前场随机礼包", price:S4_PACK_PRICES["private-att"], kind:"private", pool:"ATT", selectionMode:"direct", description:"从你拥有所有权的前场球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-mid", name:"私有池中场随机礼包", price:S4_PACK_PRICES["private-mid"], kind:"private", pool:"MID", selectionMode:"direct", description:"从你拥有所有权的中场球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-def", name:"私有池后场随机礼包", price:S4_PACK_PRICES["private-def"], kind:"private", pool:"DEF", selectionMode:"direct", description:"从你拥有所有权的后场球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-gk", name:"私有池门将随机礼包", price:S4_PACK_PRICES["private-gk"], kind:"private", pool:"GK", selectionMode:"direct", description:"从你拥有所有权的门将中随机获得1张卡。" }),
  Object.freeze({ id:"public-random", name:"公共池随机礼包", price:S4_PACK_PRICES["public-random"], kind:"public", pool:"MIXED", selectionMode:"choice", description:"从尚未被占用所有权的非传奇球员中随机展示3人，选择1张卡并获得其所有权。" }),
  Object.freeze({ id:"public-carnival", name:"公开池狂欢礼包", price:S4_PACK_PRICES["public-carnival"], kind:"public", pool:"MIXED", selectionMode:"choice", seasonPurchaseLimit:1, cardQuantity:50, description:"赛季限购1次。从公开池随机展示3人，选择1人并获得其所有权及50张+0基础卡。" }),
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
const WORLD_CUP_INTERVAL_MS = 20 * 60 * 1000;
const WORLD_CUP_COUNTRIES = Object.freeze([
  ["西班牙", "es"], ["巴西", "br"], ["法国", "fr"], ["阿根廷", "ar"],
  ["英格兰", "gb-eng"], ["意大利", "it"], ["葡萄牙", "pt"], ["荷兰", "nl"],
  ["德国", "de"], ["比利时", "be"], ["克罗地亚", "hr"], ["哥伦比亚", "co"],
]);
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAILY_RESET_HOUR = 9;
const DAILY_RESET_MINUTE = 51;
const DAILY_CUP_HOUR = 10;
const DAILY_CUP_MINUTE = 1;
const DAILY_SETTLEMENT_DELAY_MS = 10 * 60 * 1000;
const DAILY_SETTLEMENT_PACK_TYPE = "legend-random";
const DAILY_SETTLEMENT_PACK_QUANTITY = 2;
const COMPLETED_BROADCAST_RETENTION_MS = 2 * 60 * 60 * 1000;
const LIVE_MATCH_PERSIST_INTERVAL_MS = Math.max(10_000, Math.min(120_000, Number(process.env.YDL_LIVE_MATCH_PERSIST_INTERVAL_MS ?? 30_000)));
const LIVE_SETTLEMENT_PERSIST_DELAY_MS = 1_500;
const FRIENDLY_MINUTE_MARKS = Object.freeze([5, 15, 25, 35, 45, 55]);
const ACTIVE_START_HOUR = 10;
const ACTIVE_END_HOUR = 22;
const LEAGUE_FITNESS_DRAIN_FACTOR = 0.36;
const CHEMISTRY_GAIN_PER_MATCH = 6;
const CHEMISTRY_VISIBLE_THRESHOLD = 30;
const CHEMISTRY_MAX_BONUS = 0.015;
const MATCH_PREDICTION_SIMULATIONS = Math.max(20, Math.min(200, Number(process.env.YDL_PREDICTION_SIMULATIONS ?? 24)));
const MATCH_PREDICTION_MAX_STAKE = 5000;
const configuredMatchEngine = (value, fallback = "v2") => String(value ?? fallback).toLowerCase() === "v1" ? "v1" : "v2";
const DEFAULT_MATCH_ENGINE = configuredMatchEngine(process.env.YDL_MATCH_ENGINE);
const LEAGUE_MATCH_ENGINE = configuredMatchEngine(process.env.YDL_LEAGUE_MATCH_ENGINE, DEFAULT_MATCH_ENGINE);
const CUP_MATCH_ENGINE = configuredMatchEngine(process.env.YDL_CUP_MATCH_ENGINE, DEFAULT_MATCH_ENGINE);
const FRIENDLY_MATCH_ENGINE = configuredMatchEngine(process.env.YDL_FRIENDLY_MATCH_ENGINE, DEFAULT_MATCH_ENGINE);
const MATCH_ENGINE_BY_COMPETITION = Object.freeze({ league:LEAGUE_MATCH_ENGINE, cup:CUP_MATCH_ENGINE, friendly:FRIENDLY_MATCH_ENGINE });
const createLeagueMatch = (seats, options) => options?.matchEngine === "v2" ? createYdlLeagueV2Match(seats, options) : createVersusMatch(seats, options);
const advanceLeagueMatch = (match, now, options) => match?.version === 2 ? advanceYdlLeagueV2Match(match, now, options) : advanceVersusMatch(match, now);
const publicLeagueMatch = (match, now, viewerIndex = null, revealAllStrategies = false) => {
  const plainMatch = unwrapTracked(match);
  return plainMatch?.version === 2
    ? publicYdlLeagueV2Match(plainMatch, now, viewerIndex, revealAllStrategies)
    : publicMatch(plainMatch, now, viewerIndex, revealAllStrategies);
};
const MATCH_PREDICTION_LOCK_LEAD_MS = 2 * 60 * 1000;
const MATCH_PREDICTION_MARGIN = 0.1;
const MATCH_PREDICTION_MAX_PAYOUT_RATE = 12;
const MATCH_PREDICTION_OPTIONS = Object.freeze({
  result:Object.freeze(["home", "draw", "away"]),
  goals:Object.freeze(["0-5", "6-10", "11+"]),
  cards:Object.freeze(["0", "1", "2", "3", "4+"]),
});
export const S4_BOND_CATALOG = Object.freeze(createS4BondCatalog(REAL_PLAYERS));
const INITIAL_WALLET_BALANCE = S4_ECONOMY.initialWalletBalance;
const DEFAULT_FITNESS_THRESHOLD = 65;
const LEAGUE_MATCH_REWARDS = S4_ECONOMY.leagueMatchRewards;
const CUP_ADVANCE_PACK_TYPE = S4_ECONOMY.cupAdvancePackType;
const CUP_ADVANCE_PACK_QUANTITY = S4_ECONOMY.cupAdvancePackQuantity;
const S4_SINGLE_CARD_RELEASE_RATE = S4_ECONOMY.singleCardRecoveryRate;
const S4_FORCED_CARD_RECOVERY_RATE = S4_ECONOMY.forcedCardRecoveryRate;
const S4_OWNERSHIP_RETURN_RATE = S4_ECONOMY.ownershipRecoveryRate;
export const S4_ENHANCEMENT_MAX_LEVEL = S4_ENHANCEMENT.maxLevel;
export const S4_ENHANCEMENT_EQUAL_CHANCES = S4_ENHANCEMENT.equalLevelChances;
const CHAMPION_BADGE_SEASONS = Object.freeze(["S0", "S1", "S2"]);
const CUP_CHAMPION_BADGE_SEASONS = Object.freeze(["S2", "S3"]);
const TEAM_NAMES = ["上海海港", "上海申花", "北京国安", "山东泰山", "成都蓉城", "天津津门虎", "浙江队", "河南队", "武汉三镇", "深圳新鹏城"];
const TACTICS = new Set(["allOutAttack", "positive", "balanced", "defensive", "parkBus"]);
const STYLES = new Set(["possession", "longBall", "wingPlay", "counterAttack", "highPress", "lowBlock", "roughPlay"]);
const FOCUSES = new Set(["balanced", "left", "center", "right"]);
const IN_POSSESSION_PLANS = new Set(["balanced", "shortPassing", "vertical", "wideOverload", "centralCombination", "longBall"]);
const OUT_OF_POSSESSION_PLANS = new Set(["balanced", "highPress", "midBlock", "lowBlock", "zonal", "manMark"]);
const CUP_STAGE_NAMES = Object.freeze({ quarterfinals:"四分之一决赛", semifinals:"半决赛", final:"决赛" });

const clone = (value) => structuredClone(unwrapTracked(value));
const beijingDate = (value) => new Date(Number(value instanceof Date ? value.getTime() : value) + BEIJING_OFFSET_MS);
const localDateKey = (date) => {
  const shifted = beijingDate(date);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
};
const beijingTimestamp = (dateKey, hour, minute = 0) => {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0);
};
const S4_TRAIT_COMPENSATION_ID = "trait-threshold-4-7-20260730";
const S4_TRAIT_COMPENSATION_AT = beijingTimestamp("2026-07-30", 9, 30);
const S4_LEAGUE_ROUND_PACK_REWARD_START_AT = beijingTimestamp("2026-07-30", DAILY_RESET_HOUR, DAILY_RESET_MINUTE);
const S4_LEAGUE_ROUND_PACK_REWARD_TYPE = "private-mixed";
const S4_LEAGUE_ROUND_PACK_REWARD_QUANTITY = 8;
const beijingMinutes = (value) => {
  const shifted = beijingDate(value);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};
const clampAttribute = (value) => Math.max(1, Math.min(99, Math.round(Number(value) || 1)));
const xPlayerAttributeTemplate = (role) => {
  const template = REAL_PLAYERS
    .filter((player) => !isXPlayer(player) && player.role === role)
    .sort((left, right) => Math.abs(left.overall - 62) - Math.abs(right.overall - 62) || left.id.localeCompare(right.id))[0];
  if (!template) throw new Error("找不到适用于该位置的球员能力模板");
  const overallDelta = 62 - Number(template.overall);
  return {
    templatePlayerId:template.id,
    attributes:Object.fromEntries(Object.entries(template.attributes ?? {}).map(([key, value]) => [key, clampAttribute(Number(value) + overallDelta)])),
  };
};
const xPlayerInitialAbilityOverall = (config) => {
  if (config?.baseAttributes && config.role) return playerOverallFromAttributes(config.baseAttributes, config.role);
  const storedTemplate = REAL_PLAYER_BY_ID[config?.templatePlayerId];
  if (storedTemplate && !isXPlayer(storedTemplate) && storedTemplate.role === config.role) {
    const overallDelta = 62 - Number(storedTemplate.overall);
    const attributes = Object.fromEntries(Object.entries(storedTemplate.attributes ?? {}).map(([key, value]) => [key, clampAttribute(Number(value) + overallDelta)]));
    return playerOverallFromAttributes(attributes, config.role);
  }
  return playerOverallFromAttributes(xPlayerAttributeTemplate(config.role).attributes, config.role);
};
const playerSummary = (player, xConfig = null) => ({ id:player.id, name:player.name, role:xConfig?.role ?? player.role, secondaryRole:xConfig?.secondaryRole ?? player.secondaryRole, pool:xConfig ? roleGroup(xConfig.role) : player.pool, overall:player.overall, grade:player.grade, nationality:player.nationality, club:player.club, heightCm:xConfig?.heightCm ?? player.heightCm, preferredFoot:player.preferredFoot, attributes:clone(xConfig?.attributes ?? player.attributes ?? {}), legendary:isS4Legend(player), xPlayer:isXPlayer(player) });
const playerDirectorySummary = (player) => ({ id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole, pool:player.pool, overall:player.overall, grade:player.grade, nationality:player.nationality, club:player.club, legendary:isS4Legend(player), legend:isS4Legend(player), xPlayer:isXPlayer(player) });
const fixedFitnessFromTraitIds = (traitIds = []) => traitIds
  .map((id) => YDL_TRAIT_BY_ID[id])
  .filter(Boolean)
  .flatMap((trait) => trait.rules ?? [])
  .filter((rule) => rule.hook === "fixedFitness")
  .reduce((value, rule) => Math.max(value, Number(rule.value) || 0), 0) || null;
const traitBoardPresentation = (player, traitIds = []) => {
  const rules = traitIds
    .map((id) => YDL_TRAIT_BY_ID[id])
    .filter(Boolean)
    .flatMap((trait) => trait.rules ?? []);
  const heightDeltaCm = rules
    .filter((rule) => rule.hook === "height")
    .reduce((sum, rule) => sum + (Number(rule.addCm) || 0), 0);
  const positionRules = rules.filter((rule) => rule.hook === "position");
  const baseHeightCm = Number(player?.heightCm ?? 180);
  const fixedFitness = fixedFitnessFromTraitIds(traitIds);
  return {
    baseHeightCm,
    effectiveHeightCm:Math.max(140, Math.min(240, baseHeightCm + heightDeltaCm)),
    fixedFitness,
    effectiveFitness:fixedFitness ?? Number(player?.state?.fitness ?? player?.fitness ?? 100),
    traitPositionFit:{
      familiarRoles:[...new Set(positionRules.flatMap((rule) => rule.familiarRoles ?? []))],
      ignoreOutOfPositionPenalty:positionRules.some((rule) => rule.ignoreOutOfPositionPenalty),
      eligibleRoleGroups:[...new Set(positionRules.filter((rule) => rule.ignoreOutOfPositionPenalty).flatMap((rule) => rule.eligibleRoleGroups ?? ["ANY"]))],
    },
  };
};
const publicLeagueS4Card = (state, card) => {
  const player = REAL_PLAYER_BY_ID[card.playerId];
  const effectiveOverall = player ? s4EffectiveOverall(player, card.upgradeLevel) : null;
  const referenceValue = player ? s4CardReferenceValue(player, card.upgradeLevel) : null;
  const ownershipAnchorRequired = !isS4Legend(player)
    && ownershipOwner(state, card.playerId) === card.ownerId
    && cardsForOwner(state, card.ownerId, card.playerId).length === 1;
  return {
    ...publicS4Card(state, card),
    baseOverall:player?.overall ?? null,
    effectiveOverall,
    upgradeBonus:player ? effectiveOverall - player.overall : 0,
    referenceValue,
    minimumListingPrice:referenceValue == null ? null : Math.ceil(referenceValue * S4_PRICING.cardListingFloorRate / 100) * 100,
    ownershipAnchorRequired,
    traits:(card.traitIds ?? []).filter((id) => YDL_TRAIT_BY_ID[id]).map((id) => ({
      id,
      name:YDL_TRAIT_BY_ID[id].name,
      summary:YDL_TRAIT_BY_ID[id].summary,
    })),
  };
};
const publicS4PlayerDirectory = (state) => {
  const teamByOwner = new Map(state.teams.filter((team) => team.ownerId).map((team) => [team.ownerId, team]));
  const activeCards = Object.values(state.s4Assets.cards ?? {}).filter((card) => card.status === "active" && REAL_PLAYER_BY_ID[card.playerId]);
  const cardsByPlayer = new Map();
  activeCards.forEach((card) => {
    if (!cardsByPlayer.has(card.playerId)) cardsByPlayer.set(card.playerId, []);
    cardsByPlayer.get(card.playerId).push(card);
  });
  const players = REAL_PLAYERS.map((player) => {
    const cards = cardsByPlayer.get(player.id) ?? [];
    const holderMap = new Map();
    cards.forEach((card) => {
      const team = teamByOwner.get(card.ownerId);
      const holder = holderMap.get(card.ownerId) ?? {
        ownerId:card.ownerId,
        ownerName:team?.ownerName ?? "未知玩家",
        teamId:team?.id ?? null,
        teamName:team?.name ?? "未知球队",
        cardCount:0,
        highestUpgradeLevel:0,
      };
      holder.cardCount += 1;
      holder.highestUpgradeLevel = Math.max(holder.highestUpgradeLevel, Number(card.upgradeLevel ?? 0));
      holderMap.set(card.ownerId, holder);
    });
    const ownershipOwnerId = ownershipOwner(state, player.id);
    const ownershipTeam = ownershipOwnerId ? teamByOwner.get(ownershipOwnerId) : null;
    const highestUpgradeLevel = cards.reduce((highest, card) => Math.max(highest, Number(card.upgradeLevel ?? 0)), 0);
    return {
      ...playerDirectorySummary(player),
      ownership:ownershipOwnerId ? {
        ownerId:ownershipOwnerId,
        ownerName:ownershipTeam?.ownerName ?? "未知玩家",
        teamId:ownershipTeam?.id ?? null,
        teamName:ownershipTeam?.name ?? "未知球队",
      } : null,
      holders:[...holderMap.values()].sort((left, right) => right.highestUpgradeLevel - left.highestUpgradeLevel || left.ownerName.localeCompare(right.ownerName, "zh-CN")),
      cardCount:cards.length,
      highestUpgradeLevel,
    };
  });
  const enhancementRanking = activeCards
    .map((card) => {
      const player = REAL_PLAYER_BY_ID[card.playerId];
      const team = teamByOwner.get(card.ownerId);
      return {
        cardId:card.id,
        player:playerDirectorySummary(player),
        upgradeLevel:Number(card.upgradeLevel ?? 0),
        traits:publicLeagueS4Card(state, card).traits,
        ownerId:card.ownerId,
        ownerName:team?.ownerName ?? "未知玩家",
        teamId:team?.id ?? null,
        teamName:team?.name ?? "未知球队",
      };
    })
    .sort((left, right) => right.upgradeLevel - left.upgradeLevel || right.player.overall - left.player.overall || left.player.name.localeCompare(right.player.name, "zh-CN"));
  return { players, enhancementRanking };
};
const publicPackTier = (tier) => ({ id:tier.id, name:tier.name, price:tier.price, guarantee:tier.guarantee });
const rewardPackTier = (tierId) => tierId === ADMIN_LEGEND_TIER.id ? ADMIN_LEGEND_TIER : PACK_TIERS[tierId] ?? PACK_TIERS.standard;

function settleAutomatedMatch(match, startedAt) {
  let now = startedAt + REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS + 1;
  for (let attempt = 0; attempt < 5 && !match.finished; attempt += 1) {
    advanceLeagueMatch(match, now, { maximumChains:Infinity });
    now += 60_000;
  }
  if (!match.finished || !match.report) throw new Error("自动比赛未能完成结算");
  return match;
}

function makeId(prefix, value) {
  return `${prefix}-${String(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(-28)}-${Date.now().toString(36)}`;
}

export function s4EnhancementChance(mainLevelValue, materialLevelValue) {
  return s4EnhancementChanceForLevels(mainLevelValue, materialLevelValue);
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
      trailing:{ tactic:"positive", style:"possession", positionPreset:"position3" },
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
    xPlayers:{ assignments:{}, configs:{} },
    wallets:{},
    ledger:[],
    listings:[],
    reports:{},
    inbox:{},
    inboxDeleted:{},
    cardTradeOffers:[],
    friendlyInvitations:[],
    friendlyFixtures:[],
    matchPredictions:{ schemaVersion:1, markets:{}, bets:[], distributions:[] },
    shopOffers:{},
    rewardOffers:{},
    adminPackGrants:[],
    adminCoinGrants:[],
    adminCoinPenalties:[],
    adminXGrowthGrants:[],
    adminMailBroadcasts:[],
    discipline:{ rewardSuspensions:{}, actions:[], withheldRewards:[] },
    s4Assets:{ schemaVersion:1, nextCardSequence:1, ownerships:{}, cards:{}, traitOffers:{}, transactions:[] },
    s4Packs:{ schemaVersion:1, nextSequence:1, inventory:{}, offers:{}, batchOpenings:{}, grants:[], cardGrants:[], legacyRetiredAt:now },
    liveRound:null,
    liveCupRound:null,
    liveWorldCupRound:null,
    liveFriendlies:[],
    cup:{ status:"waiting", stage:"waiting", participants:[], table:{}, swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, completedAt:null },
    worldCup:null,
    completedBroadcasts:[],
    archives:[],
    dailyAutomation:{
      enabled:false,
      activatedAt:null,
      initializedDate:localDateKey(new Date(now)),
      lastRewardedSeasonId:null,
      lastResetDate:null,
      lastCupStartDate:null,
      settlements:[],
    },
    updatedAt:now,
  };
}

function nextSlot(now) {
  const dateKey = localDateKey(new Date(now));
  const start = beijingTimestamp(dateKey, ACTIVE_START_HOUR);
  const end = beijingTimestamp(dateKey, ACTIVE_END_HOUR);
  if (now < start) return start;
  if (now >= end) return beijingTimestamp(localDateKey(new Date(now + 24 * 60 * 60 * 1000)), ACTIVE_START_HOUR);
  return start + (Math.floor((now - start) / ROUND_INTERVAL_MS) + 1) * ROUND_INTERVAL_MS;
}

function nextCupSlot(now, leagueFirstRoundAt = null) {
  const anchor = Number(leagueFirstRoundAt);
  if (Number.isFinite(anchor) && anchor > 0) {
    const firstCupAt = anchor + 10 * 60 * 1000;
    if (now < firstCupAt) return firstCupAt;
    return firstCupAt + (Math.floor((now - firstCupAt) / CUP_INTERVAL_MS) + 1) * CUP_INTERVAL_MS;
  }
  const dateKey = localDateKey(new Date(now));
  const start = beijingTimestamp(dateKey, ACTIVE_START_HOUR, 10);
  const end = beijingTimestamp(dateKey, ACTIVE_END_HOUR);
  if (now < start) return start;
  if (now >= end) return beijingTimestamp(localDateKey(new Date(now + 24 * 60 * 60 * 1000)), ACTIVE_START_HOUR, 10);
  return start + (Math.floor((now - start) / CUP_INTERVAL_MS) + 1) * CUP_INTERVAL_MS;
}

function activeTime(now) {
  const minutes = beijingMinutes(now);
  return minutes >= ACTIVE_START_HOUR * 60 && minutes <= ACTIVE_END_HOUR * 60;
}

function atomicWrite(filePath, value, options = {}) {
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  if (options.copyBackup !== false && existsSync(filePath)) copyFileSync(filePath, `${filePath}.bak`);
  const descriptor = openSync(temporary, "w");
  try {
    writeFileSync(descriptor, JSON.stringify(value, null, options.compact ? undefined : 2), "utf8");
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

function ownershipMinimumListingPrice(player) {
  return Math.ceil(s4OwnershipReferenceValue(player) * S4_PRICING.ownershipListingFloorRate / 100) * 100;
}

function nextFriendlySlot(now) {
  const date = new Date(now);
  date.setSeconds(0, 0);
  const currentMinute = new Date(now).getMinutes();
  const nextMinute = FRIENDLY_MINUTE_MARKS.find((minute) => minute > currentMinute);
  if (nextMinute != null) {
    date.setMinutes(nextMinute, 0, 0);
    return date.getTime();
  }
  date.setHours(date.getHours() + 1, FRIENDLY_MINUTE_MARKS[0], 0, 0);
  return date.getTime();
}

function s4CardReferenceValue(player, upgradeLevel = 0) {
  return Math.floor(s4BaseCardReferenceValue(player) * s4CardValueMultiplier(upgradeLevel));
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

function seededShuffle(values, seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
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
    tacticalPlans:clone(team.tacticalPlans ?? { opening:{ tactic:team.tactic, style:team.style, positionPreset:"position1" }, leading:{ tactic:"defensive", style:"counterAttack", positionPreset:"position2" }, trailing:{ tactic:"positive", style:"possession", positionPreset:"position3" } }),
    roster:includeRoster ? team.rosterIds.map((id) => ({ ...playerSummary(REAL_PLAYER_BY_ID[id]), state:{ fitness:100, suspension:0, cupSuspension:0, injuryRounds:0, ...(team.playerState[id] ?? {}) }, starter:team.preferredStarterIds.includes(id), listed:false })) : undefined,
    positions:includeRoster ? { ...team.positions } : undefined,
    positionPresets:includeRoster ? clone(team.positionPresets ?? Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, team.positions ?? {}]))) : undefined,
    formationLinePresets:includeRoster ? clone(team.formationLinePresets ?? {}) : undefined,
    chemistryLinks:includeRoster ? publicChemistryLinks(team) : undefined,
    formation:team.preferredStarterIds.length === 11 ? analyzeElevenBoardFormation(team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]), team.positions, team.formationLinePresets?.position1).name : null,
  };
}

export class YellowDogsLeagueService {
  constructor(options = {}) {
    this.now = options.now ?? Date.now;
    this.rng = options.rng ?? Math.random;
    this.statePath = options.statePath === undefined ? DEFAULT_STATE_PATH : options.statePath;
    this.shardStore = options.shardStore ?? (this.statePath && isLeagueShardPath(this.statePath) ? new LeagueShardStore(this.statePath, { backupDir:options.backupDir }) : null);
    this.backupDir = options.backupDir === undefined && this.statePath
      ? path.join(this.shardStore ? this.statePath : path.dirname(this.statePath), "yellowdogs-league-backups")
      : options.backupDir;
    this.lastBackupMaintenanceDate = null;
    this.liveCheckpointPersistedAt = new Map();
    this.pendingLiveCheckpointCleanup = new Set();
    this.liveSettlementPersistTimer = null;
    this.cachedV2ReviewDemo = null;
    this.liveAdvanceCursors = { league:0, cup:0, worldcup:0, friendly:0 };
    this.liveAdvanceRunning = false;
    this.dirtyScopes = new Set(["core"]);
    if (this.shardStore) {
      if (this.shardStore.exists()) this.state = this.shardStore.load();
      else if (this.shardStore.hasUninitializedData()) throw new Error(`YellowDogs League shard directory is missing manifest.json: ${this.shardStore.root}`);
      else this.state = createState(this.now());
    } else {
      this.state = loadState(this.statePath, this.now());
    }
    this.state.xPlayers ??= { assignments:{}, configs:{} };
    this.state.xPlayers.assignments ??= {};
    this.state.xPlayers.configs ??= {};
    this.state.xPlayers.growth ??= {};
    X_PLAYERS.forEach((player) => {
      player.role = null;
      player.secondaryRole = null;
      player.heightCm = null;
      player.pool = "X";
      player.attributes = Object.fromEntries(Object.keys(player.attributes ?? {}).map((key) => [key, 62]));
      player.referenceAttributes = clone(player.attributes);
    });
    Object.entries(this.state.xPlayers.configs).forEach(([playerId, config]) => {
      const player = REAL_PLAYER_BY_ID[playerId];
      if (!player || !isXPlayer(player) || !config?.role) return;
      player.role = config.role;
      player.secondaryRole = config.secondaryRole ?? null;
      player.heightCm = config.heightCm;
      player.pool = roleGroup(config.role);
      const template = config.attributes ? { attributes:config.attributes } : xPlayerAttributeTemplate(config.role);
      config.baseAbilityOverall = xPlayerInitialAbilityOverall(config);
      config.overall = Math.max(1, Math.min(99, 62 + playerOverallFromAttributes(template.attributes, config.role) - config.baseAbilityOverall));
      player.attributes = clone(template.attributes);
      player.referenceAttributes = clone(template.attributes);
      player.overall = config.overall;
    });
    ensureS4Assets(this.state);
    this.state.s4Assets.traitThresholdCompensations ??= {};
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
    this.state.adminCoinGrants ??= [];
    this.state.adminCoinPenalties ??= [];
    this.state.adminXGrowthGrants ??= [];
    this.state.adminMailBroadcasts ??= [];
    this.state.discipline ??= { rewardSuspensions:{}, actions:[], withheldRewards:[] };
    this.state.discipline.rewardSuspensions ??= {};
    this.state.discipline.actions ??= [];
    this.state.discipline.withheldRewards ??= [];
    this.state.adminPackGrants.forEach((grant) => {
      grant.trigger ??= "round";
      grant.recipientIds ??= [];
    });
    this.state.liveRound ??= null;
    this.state.liveCupRound ??= null;
    this.state.liveWorldCupRound ??= null;
    this.state.liveFriendlies ??= [];
    this.restoreLiveCheckpoints();
    const resumedLiveEntries = [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveWorldCupRound?.matches ?? []), ...this.state.liveFriendlies];
    resumedLiveEntries.forEach((live) => {
      const match = live?.match;
      if (match?.version !== 2 || match.finished) return;
      match.rng = createV2MatchRng(`${match.simulationSeed ?? "ydl-v2"}:resume:${match.nextChainIndex ?? 0}:${match.events?.length ?? 0}`);
    });
    this.state.cup ??= { status:"waiting", stage:"waiting", participants:[], table:{}, swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, completedAt:null };
    this.state.worldCup ??= null;
    Object.values(this.state.cup.table ?? {}).forEach((entry) => { entry.status ??= "active"; entry.drawn = 0; });
    this.state.completedBroadcasts ??= [];
    this.state.reports ??= {};
    this.state.inbox ??= {};
    this.state.inboxDeleted ??= {};
    this.state.cardTradeOffers ??= [];
    this.state.friendlyInvitations ??= [];
    this.state.friendlyFixtures ??= [];
    this.state.matchPredictions ??= { schemaVersion:1, markets:{}, bets:[], distributions:[] };
    this.state.matchPredictions.schemaVersion = 1;
    this.state.matchPredictions.markets ??= {};
    this.state.matchPredictions.bets ??= [];
    this.state.matchPredictions.distributions ??= [];
    this.state.dailyAutomation ??= {};
    this.state.dailyAutomation.enabled ??= false;
    this.state.dailyAutomation.activatedAt ??= null;
    this.state.dailyAutomation.initializedDate ??= localDateKey(new Date(this.now()));
    this.state.dailyAutomation.lastRewardedSeasonId ??= null;
    this.state.dailyAutomation.lastResetDate ??= null;
    this.state.dailyAutomation.lastCupStartDate ??= null;
    this.state.dailyAutomation.settlements ??= [];
    this.state.teams.forEach((team) => {
      team.chemistry ??= {};
      team.championBadges ??= [];
      team.fitnessThreshold = Math.max(45, Math.min(100, Math.round(Number(team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD))));
      team.positionPresets ??= Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(team.positions ?? {})]));
      POSITION_PRESET_KEYS.forEach((key) => { team.positionPresets[key] ??= clone(team.positions ?? {}); });
      team.formationLinePresets ??= {};
      POSITION_PRESET_KEYS.forEach((key) => {
        const entries = (team.preferredStarterIds ?? []).map((id) => ({ id, position:team.positionPresets[key]?.[id] }));
        team.formationLinePresets[key] = sanitizeFormationLines(team.formationLinePresets[key] ?? deriveFormationLines(entries));
      });
      team.tacticalPlans ??= { opening:{ tactic:team.tactic, style:team.style, positionPreset:"position1" }, leading:{ tactic:"defensive", style:"counterAttack", positionPreset:"position2" }, trailing:{ tactic:"positive", style:"possession", positionPreset:"position3" } };
      ["opening", "leading", "trailing"].forEach((state, index) => {
        team.tacticalPlans[state] ??= state === "opening" ? { tactic:team.tactic, style:team.style } : state === "leading" ? { tactic:"defensive", style:"counterAttack" } : { tactic:"positive", style:"possession" };
        team.tacticalPlans[state].positionPreset = POSITION_PRESET_KEYS[index];
      });
    });
    if (this.state.season.status === "active" && (!this.state.season.nextRoundAt || this.state.season.nextRoundAt < this.now())) this.state.season.nextRoundAt = nextSlot(this.now());
    if (this.state.season.status === "registration") this.state.season.nextRoundAt = null;
    if (this.state.cup.status === "active" && this.state.season.firstRoundAt) {
      const earliestCupAt = this.state.season.firstRoundAt + 10 * 60 * 1000;
      if (!this.state.cup.nextRoundAt || this.state.cup.nextRoundAt < earliestCupAt) this.state.cup.nextRoundAt = nextCupSlot(this.now(), this.state.season.firstRoundAt);
    }
    this.adoptState(this.state, false);
  }

  adoptState(nextState, markAll = true) {
    this.state = this.shardStore
      ? createTrackedState(nextState, (scope) => this.dirtyScopes.add(scope))
      : nextState;
    if (this.shardStore && markAll) this.dirtyScopes = new Set(LEAGUE_SHARD_SCOPES);
    return this.state;
  }

  backupFile(name) {
    if (this.shardStore) {
      if (!this.backupDir) return null;
      mkdirSync(this.backupDir, { recursive:true });
      const backupName = /\.manifest\.json$/i.test(name) ? name : name.replace(/\.json$/i, ".manifest.json");
      return this.shardStore.backupSnapshot(path.join(this.backupDir, backupName));
    }
    if (!this.statePath || !this.backupDir || !existsSync(this.statePath)) return null;
    mkdirSync(this.backupDir, { recursive:true });
    const target = path.join(this.backupDir, name);
    if (!existsSync(target)) copyFileSync(this.statePath, target);
    return target;
  }

  maintainBackups() {
    return measureRuntimeSync("league.backupMaintenance", () => this.maintainBackupsUnmeasured());
  }

  maintainBackupsUnmeasured() {
    if (!this.backupDir) return [];
    const date = localDateKey(new Date(this.now()));
    const dailyName = this.shardStore ? `${date}.manifest.json` : `${date}.json`;
    if (this.lastBackupMaintenanceDate === date && existsSync(path.join(this.backupDir, dailyName))) {
      return readdirSync(this.backupDir).filter((name) => name.endsWith(".json")).sort();
    }
    this.backupFile(dailyName);
    if (!existsSync(this.backupDir)) return [];
    const cutoff = new Date(this.now());
    cutoff.setDate(cutoff.getDate() - (BACKUP_RETENTION_DAYS - 1));
    const cutoffKey = localDateKey(cutoff);
    for (const name of readdirSync(this.backupDir)) {
      const match = name.match(this.shardStore ? /^(\d{4}-\d{2}-\d{2})\.manifest\.json$/ : /^(\d{4}-\d{2}-\d{2})\.json$/);
      if (match && match[1] < cutoffKey) unlinkSync(path.join(this.backupDir, name));
    }
    this.lastBackupMaintenanceDate = date;
    return readdirSync(this.backupDir).filter((name) => name.endsWith(".json")).sort();
  }

  save(options = {}) {
    return measureRuntimeSync("league.save", () => this.saveUnmeasured(options));
  }

  saveUnmeasured(options = {}) {
    if (this.inboxReadPersistTimer) {
      clearTimeout(this.inboxReadPersistTimer);
      this.inboxReadPersistTimer = null;
    }
    assertS4AssetInvariants(this.state);
    this.state.updatedAt = Math.max(this.now(), Number(this.state.updatedAt ?? 0) + 1);
    if (this.shardStore) {
      this.shardStore.save(this.state, {
        scopes:options.scopes ?? [...this.dirtyScopes],
        forceFull:options.forceFull,
        matchIds:options.matchIds,
      });
      if (options.scopes) options.scopes.forEach((scope) => this.dirtyScopes.delete(scope));
      else this.dirtyScopes.clear();
      if (!options.skipDailyBackup) this.maintainBackups();
    } else if (this.statePath) {
      atomicWrite(this.statePath, this.state, { copyBackup:options.skipLiveBackupCopy !== true, compact:options.compact !== false });
      if (!options.skipDailyBackup) this.maintainBackups();
    }
    if (this.state.liveRound || this.state.liveCupRound || this.state.liveWorldCupRound || this.state.liveFriendlies?.length) {
      this.lastLiveStatePersistedAt = Math.max(this.lastLiveStatePersistedAt, this.now());
    }
  }

  liveCheckpointDirectory() {
    if (this.shardStore) return path.join(this.statePath, ".live");
    return this.statePath ? `${this.statePath}.live` : null;
  }

  liveCheckpointPath(code) {
    const directory = this.liveCheckpointDirectory();
    if (!directory) return null;
    const fileName = String(code ?? "live").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
    return path.join(directory, `${fileName}.json`);
  }

  restoreLiveCheckpoints() {
    const directory = this.liveCheckpointDirectory();
    if (!directory || !existsSync(directory)) return 0;
    const liveByCode = new Map([...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveWorldCupRound?.matches ?? []), ...this.state.liveFriendlies].map((live) => [String(live.code).toUpperCase(), live]));
    let restored = 0;
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(".json")) continue;
      try {
        const checkpoint = JSON.parse(readFileSync(path.join(directory, name), "utf8"));
        const live = liveByCode.get(String(checkpoint.code ?? "").toUpperCase());
        if (!live || checkpoint.version !== 1 || checkpoint.match?.version !== 2) continue;
        if (Number(checkpoint.match.nextChainIndex ?? 0) < Number(live.match?.nextChainIndex ?? 0)) continue;
        live.match = checkpoint.match;
        live.completed = false;
        this.liveCheckpointPersistedAt.set(live.code, Number(checkpoint.persistedAt ?? this.now()));
        restored += 1;
      } catch { /* ignore an incomplete or stale live checkpoint */ }
    }
    return restored;
  }

  persistLiveMatch(live, now = this.now(), force = false) {
    const checkpointPath = this.liveCheckpointPath(live?.code);
    if (!checkpointPath || !live?.match) return false;
    const lastPersistedAt = Number(this.liveCheckpointPersistedAt.get(live.code) ?? 0);
    if (!force && now - lastPersistedAt < LIVE_MATCH_PERSIST_INTERVAL_MS) return false;
    mkdirSync(path.dirname(checkpointPath), { recursive:true });
    atomicWrite(checkpointPath, { version:1, code:live.code, persistedAt:now, match:live.match }, { copyBackup:false, compact:true });
    this.liveCheckpointPersistedAt.set(live.code, now);
    return true;
  }

  clearLiveCheckpoints(codes) {
    for (const code of codes) {
      const checkpointPath = this.liveCheckpointPath(code);
      if (checkpointPath && existsSync(checkpointPath)) unlinkSync(checkpointPath);
      this.liveCheckpointPersistedAt.delete(code);
    }
  }

  scheduleLiveSettlementSave(codes = []) {
    if (!this.statePath) return false;
    codes.forEach((code) => this.pendingLiveCheckpointCleanup.add(code));
    if (this.liveSettlementPersistTimer) return true;
    this.liveSettlementPersistTimer = setTimeout(() => {
      this.liveSettlementPersistTimer = null;
      const completedCodes = [...this.pendingLiveCheckpointCleanup];
      try {
        this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
        this.clearLiveCheckpoints(completedCodes);
        completedCodes.forEach((code) => this.pendingLiveCheckpointCleanup.delete(code));
      } catch (error) {
        console.error("YDL直播结算存档失败，已保留逐场检查点", error);
      }
    }, LIVE_SETTLEMENT_PERSIST_DELAY_MS);
    this.liveSettlementPersistTimer.unref?.();
    return true;
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

  xPlayerConfig(playerId) {
    return this.state.xPlayers.configs[playerId] ?? null;
  }

  xPlayerSummary(playerId) {
    const player = REAL_PLAYER_BY_ID[playerId];
    return player && isXPlayer(player) ? playerSummary(player, this.xPlayerConfig(playerId)) : null;
  }

  xGrowthState(playerId) {
    this.state.xPlayers.growth ??= {};
    return this.state.xPlayers.growth[playerId] ??= { points:0, earnedPoints:0, purchasedPoints:0, spentPoints:0, taskClaims:{}, growthEpoch:0 };
  }

  accountXPlayer(accountId) {
    const entry = Object.entries(this.state.xPlayers.assignments).find(([, ownerId]) => ownerId === accountId);
    return entry ? REAL_PLAYER_BY_ID[entry[0]] : null;
  }

  xFormalStats(playerId) {
    const totals = { appearances:0, goals:0, assists:0, saves:0, tackles:0, penaltiesWon:0, yellowCards:0 };
    [this.state.playerStats, this.state.cup?.playerStats].forEach((source) => Object.values(source ?? {}).filter((entry) => entry.playerId === playerId).forEach((entry) => {
      Object.keys(totals).forEach((key) => { totals[key] += Number(entry[key] ?? 0); });
    }));
    return totals;
  }

  settleXGrowthTasks(playerId) {
    const player = REAL_PLAYER_BY_ID[playerId];
    const config = this.xPlayerConfig(playerId);
    if (!player || !config) return 0;
    const growth = this.xGrowthState(playerId);
    const stats = this.xFormalStats(playerId);
    const group = roleGroup(config.role);
    let awarded = 0;
    X_GROWTH_TASKS.filter((task) => task.groups.includes(group)).forEach((task) => {
      const completed = task.milestones.filter((milestone) => stats[task.stat] >= milestone).length;
      const claimed = Math.max(0, Number(growth.taskClaims[task.id] ?? 0));
      if (completed <= claimed) return;
      const reward = task.rewards.slice(claimed, completed).reduce((sum, value) => sum + value, 0);
      growth.taskClaims[task.id] = completed;
      growth.points += reward;
      growth.earnedPoints += reward;
      awarded += reward;
    });
    return awarded;
  }

  publicXGrowth(accountId) {
    const player = this.accountXPlayer(accountId);
    if (!player) return null;
    const config = this.xPlayerConfig(player.id);
    const growth = this.xGrowthState(player.id);
    const stats = this.xFormalStats(player.id);
    const group = roleGroup(config.role);
    const overallAttributes = new Set(PLAYER_OVERALL_ATTRIBUTE_KEYS[group] ?? []);
    const xCard = this.representativeCard(accountId, player.id);
    const upgradeLevel = Number(xCard?.upgradeLevel ?? 0);
    const effectivePlayer = applyS4Enhancement({ ...playerSummary(player, config), overall:player.overall, attributes:clone(config.attributes) }, upgradeLevel);
    const spentByField = this.state.ledger
      .filter((entry) => entry.type === "x-growth-spend" && entry.playerId === player.id && Number(entry.growthEpoch ?? 0) === Number(growth.growthEpoch ?? 0))
      .reduce((totals, entry) => {
        totals[entry.field] = Number(totals[entry.field] ?? 0) + Math.abs(Number(entry.points ?? 0));
        return totals;
      }, {});
    const tasks = X_GROWTH_TASKS.filter((task) => task.groups.includes(group)).map((task) => {
      const claimed = Number(growth.taskClaims[task.id] ?? 0);
      const nextIndex = Math.min(claimed, task.milestones.length - 1);
      return { id:task.id, label:task.label, value:stats[task.stat], milestones:[...task.milestones], rewards:[...task.rewards], completed:claimed, complete:claimed >= task.milestones.length, nextTarget:task.milestones[nextIndex] };
    });
    const traitCatalog = YDL_TRAIT_CARDS.map((trait) => ({ id:trait.id, name:trait.name, summary:trait.summary, eligibleRoleGroups:[...(trait.eligibleRoleGroups ?? [])] }));
    return { resetCost:X_GROWTH_RESET_COST, growthEpoch:Number(growth.growthEpoch ?? 0), roles:[...X_PLAYER_ROLES], player:effectivePlayer, baseOverall:player.overall, effectiveOverall:effectivePlayer.overall, upgradeLevel, points:growth.points, earnedPoints:growth.earnedPoints, purchasedPoints:growth.purchasedPoints, grantedPoints:Number(growth.grantedPoints ?? 0), spentPoints:growth.spentPoints, initialTraitId:xCard?.traitIds?.[0] ?? null, traitCatalog, attributes:ATTRIBUTE_NAMES.map((key) => ({ key, label:ATTRIBUTE_LABELS[key], value:config.attributes[key], effectiveValue:effectivePlayer.attributes[key], bonusPoints:Number(spentByField[key] ?? 0), countsTowardOverall:overallAttributes.has(key), maxValue:99 })), height:{ key:"heightCm", label:"身高", value:config.heightCm, effectiveValue:config.heightCm, bonusPoints:Number(spentByField.heightCm ?? 0), countsTowardOverall:false, maxValue:X_PLAYER_GROWTH_HEIGHT_MAX }, tasks, shop:{ ...X_GROWTH_PACK } };
  }

  xGrowthMutationView(account) {
    return clone({
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      wallet:this.wallet(account.id),
      xGrowth:this.publicXGrowth(account.id),
    });
  }

  repeatedXGrowthMutation(account, type, requestId, options = {}) {
    if (!requestId || !this.state.ledger.some((entry) => entry.accountId === account.id && entry.type === type && entry.requestId === requestId)) return null;
    return options.compact ? this.xGrowthMutationView(account) : this.view(account);
  }

  buyXGrowthPoints(account, quantity = 1, options = {}) {
    if (!this.accountTeam(account.id)) throw new Error("你还没有加入联赛");
    const player = this.accountXPlayer(account.id);
    if (!player) throw new Error("当前球队没有X球员");
    const repeated = this.repeatedXGrowthMutation(account, "x-growth-buy", options.requestId, options);
    if (repeated) return repeated;
    const count = Math.floor(Number(quantity));
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("单次最多购买20份加成点数");
    const total = X_GROWTH_PACK.price * count;
    if (this.wallet(account.id).balance < total) throw new Error("金币不足");
    this.settleXGrowthTasks(player.id);
    const growth = this.xGrowthState(player.id);
    this.wallet(account.id).balance -= total;
    growth.points += X_GROWTH_PACK.points * count;
    growth.purchasedPoints += X_GROWTH_PACK.points * count;
    this.state.ledger.push({ id:makeId("ledger", `${account.id}-x-growth-${count}`), accountId:account.id, playerId:player.id, amount:-total, points:X_GROWTH_PACK.points * count, quantity:count, type:"x-growth-buy", requestId:options.requestId ?? null, createdAt:this.now() });
    this.save();
    if (options.compact) return this.xGrowthMutationView(account);
    return this.view(account);
  }

  spendXGrowthPoints(account, field, amount = 1, options = {}) {
    if (!this.accountTeam(account.id)) throw new Error("你还没有加入联赛");
    const player = this.accountXPlayer(account.id);
    if (!player) throw new Error("当前球队没有X球员");
    const repeated = this.repeatedXGrowthMutation(account, "x-growth-spend", options.requestId, options);
    if (repeated) return repeated;
    const count = Math.floor(Number(amount));
    if (!Number.isInteger(count) || count < 1) throw new Error("加点数量必须是正整数");
    const config = this.xPlayerConfig(player.id);
    if (field === "heightCm") {
      if (config.heightCm + count > X_PLAYER_GROWTH_HEIGHT_MAX) throw new Error(`身高最高为${X_PLAYER_GROWTH_HEIGHT_MAX}cm`);
    } else {
      if (!ATTRIBUTE_NAMES.includes(field)) throw new Error("未知能力项");
      if (Number(config.attributes[field]) + count > 99) throw new Error("单项能力最高为99");
    }
    this.settleXGrowthTasks(player.id);
    const growth = this.xGrowthState(player.id);
    if (growth.points < count) throw new Error("加成点数不足");
    if (field === "heightCm") {
      config.heightCm += count;
      player.heightCm = config.heightCm;
    } else {
      config.attributes[field] += count;
      player.attributes[field] = config.attributes[field];
      player.referenceAttributes[field] = config.attributes[field];
      player.overall = Math.max(1, Math.min(99, 62 + playerOverallFromAttributes(config.attributes, config.role) - Number(config.baseAbilityOverall ?? 62)));
      config.overall = player.overall;
    }
    growth.points -= count;
    growth.spentPoints += count;
    this.state.ledger.push({ id:makeId("ledger", `${account.id}-x-spend-${field}-${count}`), accountId:account.id, playerId:player.id, amount:0, points:-count, field, growthEpoch:Number(growth.growthEpoch ?? 0), type:"x-growth-spend", requestId:options.requestId ?? null, createdAt:this.now() });
    this.save();
    if (options.compact) return this.xGrowthMutationView(account);
    return this.view(account);
  }

  resetXGrowth(account, role, secondaryRole = null, options = {}) {
    if (!this.accountTeam(account.id)) throw new Error("浣犺繕娌℃湁鍔犲叆鑱旇禌");
    const player = this.accountXPlayer(account.id);
    if (!player) throw new Error("褰撳墠鐞冮槦娌℃湁X鐞冨憳");
    const repeated = this.repeatedXGrowthMutation(account, "x-growth-reset", options.requestId, options);
    if (repeated) return repeated;
    const nextRole = String(role ?? "");
    const nextSecondary = secondaryRole ? String(secondaryRole) : null;
    const nextTraitId = String(options.traitId ?? "");
    if (!X_PLAYER_ROLES.includes(nextRole)) throw new Error("请选择有效的主位置");
    if (nextRole === "GK" && nextSecondary) throw new Error("门将无法选择副位置");
    if (nextRole !== "GK" && nextSecondary && (!X_PLAYER_ROLES.includes(nextSecondary) || nextSecondary === nextRole || nextSecondary === "GK")) throw new Error("请选择不同且有效的非门将副位置");
    if (!this.eligibleXTraits(nextRole).some((trait) => trait.id === nextTraitId)) throw new Error("请选择适用于新主位置的特性卡");
    const growth = this.xGrowthState(player.id);
    if (this.wallet(account.id).balance < X_GROWTH_RESET_COST) throw new Error("金币不足");
    const config = this.xPlayerConfig(player.id);
    const xCard = this.representativeCard(account.id, player.id);
    if (!xCard) throw new Error("找不到X球员卡");
    this.settleXGrowthTasks(player.id);
    const currentEpoch = Number(growth.growthEpoch ?? 0);
    if (!config.baseAttributes) {
      config.baseAttributes = clone(config.attributes);
      this.state.ledger.filter((entry) => entry.type === "x-growth-spend" && entry.playerId === player.id && Number(entry.growthEpoch ?? 0) === currentEpoch).forEach((entry) => {
        if (entry.field === "heightCm") return;
        config.baseAttributes[entry.field] = Math.max(1, Number(config.baseAttributes[entry.field] ?? 0) - Math.abs(Number(entry.points ?? 0)));
      });
    }
    if (config.baseHeightCm == null) config.baseHeightCm = Number(config.heightCm) - this.state.ledger.filter((entry) => entry.type === "x-growth-spend" && entry.playerId === player.id && entry.field === "heightCm" && Number(entry.growthEpoch ?? 0) === currentEpoch).reduce((sum, entry) => sum + Math.abs(Number(entry.points ?? 0)), 0);
    this.wallet(account.id).balance -= X_GROWTH_RESET_COST;
    const oldRole = config.role;
    config.role = nextRole;
    config.secondaryRole = nextSecondary;
    if (nextRole !== oldRole) config.baseAttributes = clone(xPlayerAttributeTemplate(nextRole).attributes);
    config.attributes = clone(config.baseAttributes);
    config.heightCm = Number(config.baseHeightCm);
    config.baseAbilityOverall = playerOverallFromAttributes(config.attributes, nextRole);
    config.overall = 62;
    player.role = nextRole;
    player.secondaryRole = nextSecondary;
    player.pool = roleGroup(nextRole);
    player.attributes = clone(config.attributes);
    player.referenceAttributes = clone(config.attributes);
    player.heightCm = config.heightCm;
    player.overall = config.overall;
    const previousInitialTraitId = xCard.traitIds?.[0] ?? null;
    const additionalTraitIds = (xCard.traitIds ?? []).slice(1);
    if (additionalTraitIds.includes(nextTraitId)) {
      xCard.traitIds = [nextTraitId, ...additionalTraitIds.map((traitId) => traitId === nextTraitId ? previousInitialTraitId : traitId).filter(Boolean)];
    } else {
      xCard.traitIds = [nextTraitId, ...additionalTraitIds];
    }
    growth.points += Number(growth.spentPoints ?? 0);
    growth.spentPoints = 0;
    growth.growthEpoch = Number(growth.growthEpoch ?? 0) + 1;
    this.state.ledger.push({ id:makeId("ledger", `${account.id}-x-reset-${growth.growthEpoch}`), accountId:account.id, playerId:player.id, amount:-X_GROWTH_RESET_COST, type:"x-growth-reset", role:nextRole, secondaryRole:nextSecondary, traitId:nextTraitId, previousTraitId:previousInitialTraitId, growthEpoch:growth.growthEpoch, requestId:options.requestId ?? null, createdAt:this.now() });
    this.save();
    if (options.compact) return this.xGrowthMutationView(account);
    return this.view(account);
  }

  availableXPlayers(accountId) {
    const reservedByOthers = new Set(Object.entries(this.state.drafts)
      .filter(([draftAccountId]) => draftAccountId !== accountId)
      .map(([, draft]) => draft.xPlayerId)
      .filter(Boolean));
    return X_PLAYERS.filter((player) => !this.state.xPlayers.assignments[player.id] && !reservedByOthers.has(player.id));
  }

  eligibleXTraits(role) {
    const group = roleGroup(role);
    return YDL_TRAIT_CARDS.filter((trait) => trait.eligibleRoleGroups?.includes("ANY") || trait.eligibleRoleGroups?.includes(group));
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
    const willOwnRights = options.grantOwnership !== false && !isS4Legend(REAL_PLAYER_BY_ID[playerId]);
    const externalExempt = isS4Legend(REAL_PLAYER_BY_ID[playerId])
      || Boolean(options.externalAcquisition)
        && Number(options.upgradeLevel ?? 0) >= 5
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

  randomPublicS4Players(candidates, count) {
    const available = [...candidates];
    const selected = [];
    const targetRates = { A:0.35, B:0.45, C:0.20 };
    while (selected.length < count && available.length) {
      const byGrade = Object.fromEntries(Object.keys(targetRates).map((grade) => [grade, available.filter((player) => player.grade === grade)]));
      const activeGrades = Object.entries(byGrade).filter(([, players]) => players.length);
      const targetTotal = activeGrades.reduce((sum, [grade]) => sum + targetRates[grade], 0) || 1;
      const weights = new Map();
      activeGrades.forEach(([grade, players]) => {
        const gradeRate = targetRates[grade] / targetTotal;
        const playerWeight = gradeRate / players.length;
        players.forEach((player) => weights.set(player.id, playerWeight));
      });
      const totalWeight = [...weights.values()].reduce((sum, value) => sum + value, 0);
      let roll = this.rng() * totalWeight;
      let selectedIndex = available.length - 1;
      for (let index = 0; index < available.length; index += 1) {
        roll -= weights.get(available[index].id) ?? 0;
        if (roll <= 0) {
          selectedIndex = index;
          break;
        }
      }
      selected.push(available.splice(selectedIndex, 1)[0]);
    }
    return selected;
  }

  privatePackCandidates(accountId, pack) {
    return Object.entries(this.state.s4Assets.ownerships)
      .filter(([, ownerId]) => ownerId === accountId)
      .map(([playerId]) => REAL_PLAYER_BY_ID[playerId])
      .filter((player) => player && !isXPlayer(player) && (pack.pool === "MIXED" || player.pool === pack.pool));
  }

  publicPackCandidates() {
    const reserved = new Set(Object.values(this.state.s4Packs.offers)
      .filter((offer) => offer?.kind === "public" && offer.status === "pending")
      .flatMap((offer) => offer.playerIds ?? []));
    return REAL_PLAYERS.filter((player) => !isS4Legend(player) && !isXPlayer(player) && !ownershipOwner(this.state, player.id) && !reserved.has(player.id));
  }

  legendPackCandidates() {
    return REAL_PLAYERS.filter(isS4Legend);
  }

  buyS4Packs(account, packType, quantity = 1, options = {}) {
    const team = this.accountTeam(account.id);
    const pack = S4_PACK_BY_ID[String(packType ?? "")];
    const count = Math.floor(Number(quantity));
    if (!team) throw new Error("你还没有加入联赛");
    if (!pack) throw new Error("该礼包已下架或不存在");
    if (!Number.isInteger(count) || count < 1 || count > S4_MAX_PACK_PURCHASE_QUANTITY) throw new Error(`单次最多购买${S4_MAX_PACK_PURCHASE_QUANTITY}份礼包`);
    const purchasedQuantity = this.state.ledger
      .filter((entry) => entry.accountId === account.id && entry.type === "s4-pack-buy" && entry.packType === pack.id)
      .reduce((sum, entry) => sum + Number(entry.quantity ?? 1), 0);
    if (pack.seasonPurchaseLimit && (count > pack.seasonPurchaseLimit || purchasedQuantity + count > pack.seasonPurchaseLimit)) throw new Error(`${pack.name}整个赛季限购${pack.seasonPurchaseLimit}份`);
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
    if (options.compact) return this.compactMutationView(account, { shop:true, s4Packs:true });
    return this.view(account);
  }

  assertChoicePackRosterCapacity(accountId, pack, requestedCount = 1) {
    if (pack?.selectionMode !== "choice") return;
    const availableSlots = Math.max(0, S4_ROSTER_LIMIT - this.rosterSlotsUsed(accountId));
    if (availableSlots <= 0) throw new Error("33人名单已满，暂时无法打开需要选人的礼包。请先前往背包的球员卡管理回收、解约或出售球员；礼包不会被消耗");
    if (requestedCount > availableSlots) throw new Error(`大名单仅剩${availableSlots}个名额，本次最多打开${availableSlots}份需要选人的礼包；请减少数量或先清理名单`);
  }

  openS4Pack(account, packIdValue, options = {}) {
    const team = this.accountTeam(account.id);
    const item = this.s4PackInventory(account.id).find((candidate) => candidate.id === String(packIdValue ?? ""));
    const pack = S4_PACK_BY_ID[item?.packType];
    if (!team || !item || item.status !== "unopened" || !pack) throw new Error("找不到可开启的S4礼包");
    if (this.state.s4Packs.offers[account.id]?.status === "pending") throw new Error("请先完成当前礼包的三选一");
    if (this.state.s4Packs.batchOpenings[account.id]?.status === "active") throw new Error("请先完成当前批量开包");
    this.assertChoicePackRosterCapacity(account.id, pack);

    if (pack.selectionMode === "direct") {
      const result = this.openDirectS4Pack(account, team, item, pack);
      this.save();
      if (options.compact) return this.compactMutationView(account, { ownTeam:true, s4Packs:true, extra:{ packOpening:result } });
      return { ...this.view(account), packOpening:result };
    }

    this.createS4ChoiceOffer(account, item, pack);
    this.save();
    if (options.compact) return this.compactMutationView(account, { s4Packs:true });
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
    const choices = pack.kind === "public"
      ? this.randomPublicS4Players(candidates, 3)
      : this.randomS4Players(candidates, 3);
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

  openS4PacksBatch(account, packIdValues, options = {}) {
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
    this.assertChoicePackRosterCapacity(account.id, pack, packIds.length);

    if (pack.selectionMode === "direct") {
      const results = items.map((item) => this.openDirectS4Pack(account, team, item, pack));
      this.save();
      const packBatchOpening = { id:makeId("s4-pack-batch", `${account.id}-${pack.id}`), mode:"direct", complete:true, packType:pack.id, total:results.length, results };
      if (options.compact) return this.compactMutationView(account, { ownTeam:true, s4Packs:true, extra:{ packBatchOpening } });
      return {
        ...this.view(account),
        packBatchOpening,
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
    if (options.compact) return this.compactMutationView(account, { s4Packs:true });
    return this.view(account);
  }

  chooseS4Pack(account, offerIdValue, playerIdValue, options = {}) {
    const team = this.accountTeam(account.id);
    const offer = this.state.s4Packs.offers[account.id];
    const playerId = String(playerIdValue ?? "");
    const item = this.s4PackInventory(account.id).find((candidate) => candidate.id === offer?.packId);
    const pack = S4_PACK_BY_ID[offer?.packType];
    if (!team || !offer || offer.status !== "pending" || offer.id !== String(offerIdValue ?? "") || !offer.playerIds.includes(playerId) || !item || !pack) {
      throw new Error("只能选择当前礼包展示的球员");
    }
    if (offer.kind === "public" && ownershipOwner(this.state, playerId)) throw new Error("该球员所有权已经被其他玩家获得，请重新开启礼包");
    const cardQuantity = Math.max(1, Number(pack.cardQuantity ?? 1));
    const cards = Array.from({ length:cardQuantity }, (_, index) => this.grantS4Card(team, playerId, {
      grantOwnership:offer.kind === "public" && index === 0,
      acquisitionSource:offer.kind === "public" ? "public-pack" : "legend-pack",
    }));
    const card = cards[0];
    offer.status = "selected";
    offer.selectedPlayerId = playerId;
    offer.cardId = card.id;
    offer.cardIds = cards.map((entry) => entry.id);
    offer.closedAt = this.now();
    item.status = "opened";
    item.openedAt = this.now();
    item.resultPlayerId = playerId;
    item.resultCardId = card.id;
    delete this.state.s4Packs.offers[account.id];
    this.state.ledger.push({ id:makeId("ledger", item.id), accountId:account.id, amount:0, type:"s4-pack-open", packType:pack.id, packId:item.id, playerId, cardId:card.id, cardIds:cards.map((entry) => entry.id), cardQuantity, ownershipGranted:offer.kind === "public", createdAt:this.now() });
    const packOpening = { mode:"choice", packId:item.id, player:playerSummary(REAL_PLAYER_BY_ID[playerId]), card:publicLeagueS4Card(this.state, card), cardCount:cardQuantity, ownershipGranted:offer.kind === "public" };
    const batch = offer.batchId ? this.state.s4Packs.batchOpenings[account.id] : null;
    if (batch?.id === offer.batchId && batch.status === "active") {
      batch.results.push({ mode:"choice", packId:item.id, playerId, cardId:card.id, ownershipGranted:offer.kind === "public" });
      if (batch.results.length < batch.packIds.length) {
        const nextPackId = batch.packIds[batch.results.length];
        const nextItem = this.s4PackInventory(account.id).find((candidate) => candidate.id === nextPackId);
        if (!nextItem || nextItem.status !== "unopened") throw new Error("批量开包队列中的下一份礼包不可用");
        this.createS4ChoiceOffer(account, nextItem, pack, batch);
        this.save();
        const packBatchOpening = { id:batch.id, mode:"choice", complete:false, packType:batch.packType, total:batch.packIds.length, completed:batch.results.length };
        if (options.compact) return this.compactMutationView(account, { ownTeam:true, s4Packs:true, extra:{ packOpening, packBatchOpening } });
        return { ...this.view(account), packOpening, packBatchOpening };
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
      if (options.compact) return this.compactMutationView(account, { ownTeam:true, s4Packs:true, extra:{ packOpening, packBatchOpening:batchResult } });
      return { ...this.view(account), packOpening, packBatchOpening:batchResult };
    }
    this.save();
    if (options.compact) return this.compactMutationView(account, { ownTeam:true, s4Packs:true, extra:{ packOpening } });
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

  grantS4PlayerCardsFromAdmin(body = {}, options = {}) {
    const accountId = String(body.accountId ?? "");
    const playerId = String(body.playerId ?? "");
    const upgradeLevel = Number(body.upgradeLevel);
    const quantity = Number(body.quantity ?? 1);
    const team = this.accountTeam(accountId);
    const player = REAL_PLAYER_BY_ID[playerId];
    if (!team) throw new Error("请选择已经完成建队的玩家");
    if (!player) throw new Error("请选择有效的球员");
    if (isXPlayer(player)) throw new Error("X级球员只能通过建队选择获得，不能由后台发放副本");
    if (!Number.isInteger(upgradeLevel) || upgradeLevel < 0 || upgradeLevel > 8) throw new Error("强化等级必须为0至8的整数");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > S4_MAX_PACK_PURCHASE_QUANTITY) throw new Error(`单次最多发放${S4_MAX_PACK_PURCHASE_QUANTITY}张球员卡`);
    const currentOwner = ownershipOwner(this.state, playerId);
    const grantOwnership = !isS4Legend(player) && !currentOwner;
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
    if (options.compact) {
      return clone({
        updatedAt:this.state.updatedAt,
        serverTime:this.now(),
        grant,
        cards:cards.map((card) => publicLeagueS4Card(this.state, card)),
      });
    }
    return this.adminView();
  }

  grantCoinsFromAdmin(body = {}) {
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000) throw new Error("单次金币发放数量必须为1至10亿的整数");
    const mode = body.recipientMode === "specified" ? "specified" : "all";
    const requestedIds = [...new Set((Array.isArray(body.accountIds) ? body.accountIds : [body.accountIds]).map(String).filter(Boolean))];
    const teams = this.state.teams.filter((team) => team.ownerId && (mode === "all" || requestedIds.includes(team.ownerId)));
    if (!teams.length) throw new Error(mode === "all" ? "当前没有已完成建队的玩家" : "没有找到指定的已建队玩家");
    if (mode === "specified") {
      const found = new Set(teams.map((team) => team.ownerId));
      const missing = requestedIds.filter((id) => !found.has(id));
      if (missing.length) throw new Error(`以下玩家尚未完成建队或不存在：${missing.join("、")}`);
    }
    const grant = {
      id:makeId("coin-grant", `${mode}-${amount}`),
      amount,
      recipientMode:mode,
      recipientIds:teams.map((team) => team.ownerId),
      recipientCount:teams.length,
      createdAt:this.now(),
    };
    teams.forEach((team) => {
      this.wallet(team.ownerId).balance += amount;
      this.state.ledger.push({ id:makeId("ledger", `${grant.id}-${team.ownerId}`), accountId:team.ownerId, amount, type:"admin-coin-grant", grantId:grant.id, createdAt:this.now() });
      this.pushInbox(team, {
        id:`admin-coin-grant:${grant.id}:${team.ownerId}`,
        type:"reward",
        title:"管理员金币已到账",
        summary:`管理员向你发放了${amount.toLocaleString("zh-CN")}金币。`,
        body:`本次发放的${amount.toLocaleString("zh-CN")}金币已经立即进入你的账户，可直接用于商店、强化和交易。`,
        payload:{ grantId:grant.id, amount },
      });
    });
    this.state.adminCoinGrants.push(grant);
    this.save();
    return this.adminView();
  }

  adminPlayerStatus(accountIdValue) {
    this.ensureDisciplineState();
    const accountId = String(accountIdValue ?? "");
    const team = this.accountTeam(accountId);
    const suspension = this.state.discipline?.rewardSuspensions?.[accountId] ?? null;
    return clone({
      teamId:team?.id ?? null,
      teamName:team?.name ?? null,
      balance:team ? this.wallet(accountId).balance : null,
      rewardsSuspended:Boolean(suspension),
      rewardSuspension:suspension,
    });
  }

  announceDiscipline(action, message) {
    if (!action.announce) return;
    this.state.teams.filter((team) => team.ownerId).forEach((team) => this.pushInbox(team, {
      id:`discipline-announcement:${action.id}:${team.id}`,
      type:"notice",
      title:message.title,
      summary:message.summary,
      body:message.body,
      payload:{ disciplineActionId:action.id, actionType:action.type, accountId:action.accountId },
    }));
  }

  removeCoinsFromAdmin(body = {}) {
    this.ensureDisciplineState();
    const accountId = String(body.accountId ?? "");
    const amount = Number(body.amount);
    const reason = String(body.reason ?? "").trim().slice(0, 200);
    const team = this.accountTeam(accountId);
    if (!team) throw new Error("请选择已经完成建队的玩家");
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000) throw new Error("单次移除金币数量必须为1至10亿的整数");
    if (reason.length < 2) throw new Error("请填写至少2个字符的处罚原因");
    const wallet = this.wallet(accountId);
    if (wallet.balance < amount) throw new Error(`玩家当前只有${wallet.balance.toLocaleString("zh-CN")}金币，不能扣除更多金币`);
    const action = {
      id:makeId("discipline", `coin-${accountId}-${amount}`),
      type:"coin-removal",
      accountId,
      teamId:team.id,
      playerName:team.ownerName,
      teamName:team.name,
      amount,
      reason,
      announce:body.announce === true,
      createdAt:this.now(),
    };
    wallet.balance -= amount;
    this.state.ledger.push({ id:makeId("ledger", action.id), accountId, amount:-amount, type:"admin-coin-penalty", disciplineActionId:action.id, reason, createdAt:action.createdAt });
    this.state.adminCoinPenalties.push(action);
    this.state.discipline.actions.push(action);
    this.pushInbox(team, {
      id:`discipline-private:${action.id}:${team.id}`,
      type:"notice",
      title:"违规处罚：金币已扣除",
      summary:`管理员已扣除${amount.toLocaleString("zh-CN")}金币。`,
      body:`处罚原因：${reason}。处理后的账户余额为${wallet.balance.toLocaleString("zh-CN")}金币。`,
      payload:{ disciplineActionId:action.id, actionType:action.type, amount, reason },
    });
    this.announceDiscipline(action, {
      title:"全服纪律处罚通告",
      summary:`玩家${team.ownerName}因违规被扣除${amount.toLocaleString("zh-CN")}金币。`,
      body:`处罚对象：${team.ownerName}（${team.name}）。处罚内容：扣除${amount.toLocaleString("zh-CN")}金币。处罚原因：${reason}。请所有玩家共同维护公平的游戏环境。`,
    });
    this.state.adminCoinPenalties = this.state.adminCoinPenalties.slice(-500);
    this.state.discipline.actions = this.state.discipline.actions.slice(-1000);
    this.save();
    return this.adminView();
  }

  setRewardSuspensionFromAdmin(body = {}) {
    this.ensureDisciplineState();
    const accountId = String(body.accountId ?? "");
    const suspended = body.suspended !== false;
    const reason = String(body.reason ?? "").trim().slice(0, 200);
    const team = this.accountTeam(accountId);
    if (!team) throw new Error("请选择已经完成建队的玩家");
    if (suspended && reason.length < 2) throw new Error("请填写至少2个字符的处罚原因");
    const action = {
      id:makeId("discipline", `rewards-${accountId}-${suspended ? "suspend" : "restore"}`),
      type:suspended ? "reward-suspension" : "reward-restoration",
      accountId,
      teamId:team.id,
      playerName:team.ownerName,
      teamName:team.name,
      reason:suspended ? reason : String(body.reason ?? "处罚期结束").trim().slice(0, 200) || "处罚期结束",
      announce:body.announce === true,
      createdAt:this.now(),
    };
    if (suspended) {
      this.state.discipline.rewardSuspensions[accountId] = {
        accountId,
        reason,
        suspendedAt:action.createdAt,
        actionId:action.id,
      };
    } else {
      delete this.state.discipline.rewardSuspensions[accountId];
    }
    this.state.discipline.actions.push(action);
    this.pushInbox(team, {
      id:`discipline-private:${action.id}:${team.id}`,
      type:"notice",
      title:suspended ? "违规处罚：赛事奖励已暂停" : "赛事奖励发放资格已恢复",
      summary:suspended ? "暂停发放联赛及杯赛奖励，暂停期间错过的奖励不予补发。" : "后续联赛及杯赛奖励将恢复正常发放。",
      body:suspended ? `处罚原因：${reason}。本处罚不影响正常参赛，但处罚期间的联赛轮次奖励、联赛排名奖励及杯赛晋级奖励均不发放。` : `恢复原因：${action.reason}。本次恢复仅影响后续奖励，已被扣留的历史奖励不补发。`,
      payload:{ disciplineActionId:action.id, actionType:action.type, reason:action.reason },
    });
    this.announceDiscipline(action, {
      title:suspended ? "全服纪律处罚通告" : "全服纪律处罚解除通告",
      summary:suspended ? `玩家${team.ownerName}的联赛及杯赛奖励发放已暂停。` : `玩家${team.ownerName}的联赛及杯赛奖励发放资格已恢复。`,
      body:suspended
        ? `处罚对象：${team.ownerName}（${team.name}）。处罚内容：暂停发放联赛及杯赛奖励。处罚原因：${reason}。暂停期间错过的奖励不予补发。`
        : `玩家${team.ownerName}（${team.name}）的联赛及杯赛奖励资格已经恢复。恢复原因：${action.reason}。`,
    });
    this.state.discipline.actions = this.state.discipline.actions.slice(-1000);
    this.save();
    return this.adminView();
  }

  recordLoginDisciplineFromAdmin(body = {}) {
    this.ensureDisciplineState();
    const accountId = String(body.accountId ?? "");
    const team = this.accountTeam(accountId);
    const suspended = body.suspended !== false;
    const reason = String(body.reason ?? (suspended ? "" : "处罚期结束")).trim().slice(0, 200);
    if (suspended && reason.length < 2) throw new Error("请填写至少2个字符的处罚原因");
    const action = {
      id:makeId("discipline", `login-${accountId}-${suspended ? "cooldown" : "restore"}`),
      type:suspended ? "login-cooldown" : "login-restoration",
      accountId,
      teamId:team?.id ?? null,
      playerName:String(body.playerName ?? team?.ownerName ?? accountId),
      teamName:team?.name ?? null,
      durationMinutes:suspended ? Number(body.durationMinutes) : null,
      cooldownUntil:suspended ? Number(body.cooldownUntil) : null,
      reason:reason || "处罚期结束",
      announce:body.announce === true,
      createdAt:this.now(),
    };
    this.state.discipline.actions.push(action);
    if (team) this.pushInbox(team, {
      id:`discipline-private:${action.id}:${team.id}`,
      type:"notice",
      title:suspended ? "违规处罚：账号登录已暂停" : "账号登录限制已解除",
      summary:suspended ? `账号登录暂停至${new Date(action.cooldownUntil).toLocaleString("zh-CN", { hour12:false })}。` : "账号现在可以正常登录。",
      body:suspended ? `处罚原因：${action.reason}。处罚到期后可使用原昵称和密码重新登录。` : `解除原因：${action.reason}。`,
      payload:{ disciplineActionId:action.id, actionType:action.type, cooldownUntil:action.cooldownUntil, reason:action.reason },
    });
    this.announceDiscipline(action, {
      title:suspended ? "全服纪律处罚通告" : "全服纪律处罚解除通告",
      summary:suspended ? `玩家${action.playerName}被暂停登录${action.durationMinutes}分钟。` : `玩家${action.playerName}的登录限制已经解除。`,
      body:suspended
        ? `处罚对象：${action.playerName}${action.teamName ? `（${action.teamName}）` : ""}。处罚内容：暂停登录${action.durationMinutes}分钟，至${new Date(action.cooldownUntil).toLocaleString("zh-CN", { hour12:false })}。处罚原因：${action.reason}。`
        : `玩家${action.playerName}${action.teamName ? `（${action.teamName}）` : ""}的登录限制已经解除。解除原因：${action.reason}。`,
    });
    this.state.discipline.actions = this.state.discipline.actions.slice(-1000);
    this.save();
    return this.adminView();
  }

  dissolveTeamFromAdmin(body = {}) {
    this.ensureDisciplineState();
    const accountId = String(body.accountId ?? "");
    const reason = String(body.reason ?? "").trim().slice(0, 200);
    const team = this.accountTeam(accountId);
    if (!team) throw new Error("请选择已经完成建队的玩家");
    if (body.confirm !== "DISSOLVE_YDL_TEAM") throw new Error("需要确认强制解散球队");
    if (reason.length < 2) throw new Error("请填写至少2个字符的处罚原因");
    const recipients = this.state.teams.filter((entry) => entry.ownerId && entry.ownerId !== accountId);
    const now = this.now();
    const teamIndex = this.state.teams.indexOf(team);
    const originalState = clone(this.state);
    this.backupFile(`before-team-dissolution-${localDateKey(new Date(now))}-${now}.json`);

    try {
      this.archiveSeason("admin-team-dissolution");

      // 先关闭所有交易，避免被解散账户或交易对手的托管金币、锁定卡片遗留。
      this.state.cardTradeOffers
        .filter((offer) => offer.status === "pending" && [offer.fromOwnerId, offer.toOwnerId].includes(accountId))
        .forEach((offer) => this.failCardTradeOffer(offer, "相关球队已被管理员强制解散"));
      this.state.listings.forEach((listing) => {
        if (listing.status === "active" && listing.sellerId === accountId) {
          listing.status = "cancelled";
          listing.closedAt = now;
          listing.cancelReason = "admin-team-dissolution";
        }
      });

      const walletAmount = Math.max(0, Number(this.wallet(accountId).balance ?? 0));
      const cards = this.playerCards(accountId);
      const cardRecoveryAmount = cards.reduce((sum, card) => {
        const player = REAL_PLAYER_BY_ID[card.playerId];
        return sum + (player ? s4ForcedCardRecoveryValue(player, card.upgradeLevel) : 0);
      }, 0);
      const ownershipIds = Object.entries(this.state.s4Assets.ownerships)
        .filter(([, ownerId]) => ownerId === accountId)
        .map(([playerId]) => playerId);
      const ownershipRecoveryAmount = ownershipIds.reduce((sum, playerId) => {
        const player = REAL_PLAYER_BY_ID[playerId];
        return sum + (player && !isXPlayer(player) ? Math.floor(s4OwnershipReferenceValue(player) * S4_OWNERSHIP_RETURN_RATE) : 0);
      }, 0);
      const packItems = this.s4PackInventory(accountId).filter((item) => ["unopened", "choosing"].includes(item.status));
      const packRecoveryAmount = packItems.reduce((sum, item) => sum + Number(S4_PACK_BY_ID[item.packType]?.price ?? 0), 0);
      const pendingBets = this.state.matchPredictions.bets.filter((bet) => bet.accountId === accountId && bet.status === "pending");
      const predictionRecoveryAmount = pendingBets.reduce((sum, bet) => sum + Number(bet.amount ?? 0), 0);
      pendingBets.forEach((bet) => {
        bet.originalAmount = bet.amount;
        bet.amount = 0;
        bet.status = "voided-by-team-dissolution";
        bet.settledAt = now;
      });

      cards.forEach((card) => {
        recycleS4Card(this.state, card.id, "admin-team-dissolution", now);
        recordS4AssetTransaction(this.state, {
          id:makeId("asset-dissolution", card.id),
          type:"admin-team-dissolution-card-recovery",
          playerId:card.playerId,
          cardIds:[card.id],
          fromOwnerId:accountId,
          amount:s4ForcedCardRecoveryValue(REAL_PLAYER_BY_ID[card.playerId], card.upgradeLevel),
          createdAt:now,
        });
      });
      ownershipIds.forEach((playerId) => returnPlayerOwnershipToSystem(this.state, playerId, accountId));

      const xPlayerEntry = Object.entries(this.state.xPlayers.assignments).find(([, ownerId]) => ownerId === accountId);
      const xPlayerId = xPlayerEntry?.[0] ?? null;
      if (xPlayerId) {
        delete this.state.xPlayers.assignments[xPlayerId];
        delete this.state.xPlayers.configs[xPlayerId];
        delete this.state.xPlayers.growth[xPlayerId];
        const reclaimedXPlayer = REAL_PLAYER_BY_ID[xPlayerId];
        reclaimedXPlayer.role = null;
        reclaimedXPlayer.secondaryRole = null;
        reclaimedXPlayer.heightCm = null;
        reclaimedXPlayer.pool = "X";
        reclaimedXPlayer.overall = 62;
        reclaimedXPlayer.attributes = Object.fromEntries(Object.keys(reclaimedXPlayer.attributes ?? {}).map((key) => [key, 62]));
        reclaimedXPlayer.referenceAttributes = clone(reclaimedXPlayer.attributes);
      }
      Object.entries(this.state.s4Assets.traitOffers).forEach(([offerId, offer]) => {
        if (offer.ownerId === accountId) delete this.state.s4Assets.traitOffers[offerId];
      });
      delete this.state.s4Packs.inventory[accountId];
      delete this.state.s4Packs.offers[accountId];
      delete this.state.s4Packs.batchOpenings[accountId];
      delete this.state.shopOffers[accountId];
      delete this.state.rewardOffers[accountId];
      delete this.state.drafts[accountId];
      delete this.state.discipline.rewardSuspensions[accountId];
      this.state.friendlyInvitations = this.state.friendlyInvitations.filter((entry) => ![entry.fromOwnerId, entry.toOwnerId].includes(accountId));
      const removedFriendlyFixtureIds = new Set(this.state.friendlyFixtures
        .filter((fixture) => [fixture.homeId, fixture.awayId].includes(team.id))
        .map((fixture) => fixture.id));
      this.state.friendlyFixtures = this.state.friendlyFixtures.filter((fixture) => !removedFriendlyFixtureIds.has(fixture.id));
      this.state.liveFriendlies = this.state.liveFriendlies.filter((entry) => !removedFriendlyFixtureIds.has(entry.fixtureId));

      const totalRecoveryAmount = walletAmount + cardRecoveryAmount + ownershipRecoveryAmount + packRecoveryAmount + predictionRecoveryAmount;
      this.wallet(accountId).balance = 0;
      const action = {
        id:makeId("discipline", `team-dissolution-${accountId}`),
        type:"team-dissolution",
        accountId,
        teamId:team.id,
        playerName:team.ownerName,
        teamName:team.name,
        reason,
        announce:true,
        totalRecoveryAmount,
        valuation:{
          walletAmount,
          cardRecoveryAmount,
          ownershipRecoveryAmount,
          packRecoveryAmount,
          predictionRecoveryAmount,
          cardCount:cards.length,
          ownershipCount:ownershipIds.filter((playerId) => !isXPlayer(REAL_PLAYER_BY_ID[playerId])).length,
          packCount:packItems.length,
          xPlayerId,
        },
        recipientCount:recipients.length,
        createdAt:now,
      };
      this.state.ledger.push({
        id:makeId("ledger", action.id),
        accountId,
        amount:-walletAmount,
        type:"admin-team-dissolution-liquidation",
        disciplineActionId:action.id,
        totalRecoveryAmount,
        reason,
        createdAt:now,
      });

      this.state.teams[teamIndex] = initialTeam(teamIndex);
      delete this.state.inbox[team.id];
      delete this.state.inboxDeleted[team.id];

      const baseCompensation = recipients.length ? Math.floor(totalRecoveryAmount / recipients.length) : 0;
      let remainder = recipients.length ? totalRecoveryAmount % recipients.length : totalRecoveryAmount;
      action.compensations = recipients.map((recipient) => {
        const amount = baseCompensation + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        this.wallet(recipient.ownerId).balance += amount;
        this.state.ledger.push({
          id:makeId("ledger", `${action.id}-${recipient.ownerId}`),
          accountId:recipient.ownerId,
          amount,
          type:"admin-team-dissolution-compensation",
          disciplineActionId:action.id,
          dissolvedAccountId:accountId,
          createdAt:now,
        });
        return { accountId:recipient.ownerId, teamId:recipient.id, amount };
      });
      action.distributedAmount = action.compensations.reduce((sum, entry) => sum + entry.amount, 0);
      action.undistributedAmount = totalRecoveryAmount - action.distributedAmount;
      this.state.discipline.actions.push(action);
      this.state.discipline.actions = this.state.discipline.actions.slice(-1000);

      // 与每日重置共用同一套联赛、杯赛、体能和赛程初始化逻辑。
      this.resetDailyCompetitions({
        manual:true,
        reason:"admin-team-dissolution",
        skipRewardCheck:true,
        skipBackup:true,
        skipArchive:true,
        skipSave:true,
        skipView:true,
      });

      action.compensations.forEach((compensation) => {
        const recipient = this.accountTeam(compensation.accountId);
        if (!recipient) return;
        this.pushInbox(recipient, {
          id:`team-dissolution-compensation:${action.id}:${recipient.id}`,
          type:"notice",
          title:"严重违规球队强制解散及补偿公告",
          summary:`${action.teamName}因严重违规被管理员强制解散，你获得${compensation.amount.toLocaleString("zh-CN")}金币补偿。`,
          body:`原球队${action.teamName}（玩家${action.playerName}）因严重违规已被强制解散，原席位现由AI球队暂时接替。该账户的金币、球员卡、球员所有权、未开启礼包、未结算预测投入及X球员等资产已由系统统一回收估值，共计${totalRecoveryAmount.toLocaleString("zh-CN")}金币，并向其余${recipients.length}位玩家分配；你获得${compensation.amount.toLocaleString("zh-CN")}金币。处罚原因：${reason}。联赛及杯赛进度已按每日重置规则重新开始。`,
          payload:{ disciplineActionId:action.id, actionType:action.type, dissolvedAccountId:accountId, dissolvedTeamName:action.teamName, compensation:compensation.amount, totalRecoveryAmount },
        });
      });
      assertS4AssetInvariants(this.state);
      this.save();
      return { league:this.adminView(), action:clone(action) };
    } catch (error) {
      this.adoptState(originalState);
      throw error;
    }
  }

  rewardsSuspended(accountId) {
    this.ensureDisciplineState();
    return Boolean(this.state.discipline?.rewardSuspensions?.[accountId]);
  }

  withholdReward(accountId, competition, grantId, details = {}) {
    this.ensureDisciplineState();
    const existing = this.state.discipline.withheldRewards.find((entry) => entry.accountId === accountId && entry.grantId === grantId);
    if (existing) return existing;
    const entry = {
      id:makeId("withheld-reward", `${accountId}-${grantId}`),
      accountId,
      competition,
      grantId,
      reason:this.state.discipline.rewardSuspensions[accountId]?.reason ?? "纪律处罚",
      createdAt:this.now(),
      ...clone(details),
    };
    this.state.discipline.withheldRewards.push(entry);
    this.state.discipline.withheldRewards = this.state.discipline.withheldRewards.slice(-2000);
    this.state.ledger.push({ id:entry.id, accountId, amount:0, type:"discipline-reward-withheld", competition, grantId, reason:entry.reason, createdAt:entry.createdAt });
    return entry;
  }

  grantXGrowthPointsFromAdmin(body = {}) {
    const points = Number(body.points);
    if (!Number.isInteger(points) || points < 1 || points > 1000) throw new Error("单次X球员加成点数必须为1至1000的整数");
    const recipients = this.state.teams
      .filter((team) => team.ownerId)
      .map((team) => ({ team, player:this.accountXPlayer(team.ownerId) }))
      .filter((entry) => entry.player);
    if (!recipients.length) throw new Error("当前没有拥有X球员的玩家");
    const grant = {
      id:makeId("x-growth-grant", `all-${points}`),
      points,
      recipientMode:"all",
      recipientIds:recipients.map(({ team }) => team.ownerId),
      recipientCount:recipients.length,
      createdAt:this.now(),
    };
    recipients.forEach(({ team, player }) => {
      const growth = this.xGrowthState(player.id);
      growth.points += points;
      growth.grantedPoints = Number(growth.grantedPoints ?? 0) + points;
      this.state.ledger.push({ id:makeId("ledger", `${grant.id}-${team.ownerId}`), accountId:team.ownerId, playerId:player.id, amount:0, points, type:"admin-x-growth-grant", grantId:grant.id, createdAt:this.now() });
      this.pushInbox(team, {
        id:`admin-x-growth-grant:${grant.id}:${team.ownerId}`,
        type:"reward",
        title:"X球员加成点数已到账",
        summary:`管理员向你的X球员发放了${points}点加成点数。`,
        body:`本次发放的${points}点加成点数已经立即到账，可前往X球员成长界面使用。`,
        payload:{ grantId:grant.id, playerId:player.id, points },
      });
    });
    this.state.adminXGrowthGrants.push(grant);
    this.save();
    return this.adminView();
  }

  broadcastAdminMail(body = {}) {
    const title = String(body.title ?? "").trim();
    const mailBody = String(body.body ?? "").trim();
    const requestedSummary = String(body.summary ?? "").trim();
    if (!title) throw new Error("邮件标题不能为空");
    if (title.length > 80) throw new Error("邮件标题最多80个字符");
    if (!mailBody) throw new Error("邮件正文不能为空");
    if (mailBody.length > 5000) throw new Error("邮件正文最多5000个字符");
    if (requestedSummary.length > 200) throw new Error("邮件摘要最多200个字符");
    const recipients = this.state.teams.filter((team) => team.ownerId);
    if (!recipients.length) throw new Error("当前没有可接收邮件的玩家球队");
    const createdAt = this.now();
    const summary = requestedSummary || mailBody.replace(/\s+/g, " ").slice(0, 120);
    const broadcast = {
      id:makeId("admin-mail", title),
      title,
      summary,
      body:mailBody,
      recipientCount:recipients.length,
      recipientIds:recipients.map((team) => team.ownerId),
      createdAt,
    };
    recipients.forEach((team) => this.pushInbox(team, {
      id:`${broadcast.id}:${team.id}`,
      type:"admin-update",
      title,
      summary,
      body:mailBody,
      createdAt,
      payload:{ adminMailBroadcastId:broadcast.id },
    }));
    this.state.adminMailBroadcasts.push(broadcast);
    this.state.adminMailBroadcasts = this.state.adminMailBroadcasts.slice(-100);
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

  ensureDisciplineState() {
    this.state.adminCoinPenalties ??= [];
    this.state.discipline ??= { rewardSuspensions:{}, actions:[], withheldRewards:[] };
    this.state.discipline.rewardSuspensions ??= {};
    this.state.discipline.actions ??= [];
    this.state.discipline.withheldRewards ??= [];
    return this.state.discipline;
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
    if (!team?.ownerId || !trait || offer?.source === "threshold-compensation" || !S4_ENHANCEMENT.traitUnlockLevels.includes(Number(offer?.unlockLevel ?? card?.upgradeLevel))) return;
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

  publicS4EnhancementTraitOffer(offer) {
    if (!offer) return null;
    return {
      id:offer.id,
      cardId:offer.cardId,
      playerId:offer.playerId,
      playerName:REAL_PLAYER_BY_ID[offer.playerId]?.name,
      upgradeLevel:Number(offer.upgradeLevel ?? 0),
      unlockLevel:Number(offer.unlockLevel ?? 0),
      traits:offer.traitIds.map((id) => ({
        id,
        name:YDL_TRAIT_BY_ID[id]?.name ?? id,
        summary:YDL_TRAIT_BY_ID[id]?.summary ?? "特性效果由联赛后台配置。",
        eligibleRoleGroups:[...(YDL_TRAIT_BY_ID[id]?.eligibleRoleGroups ?? ["ANY"])],
      })),
    };
  }

  sendS4TraitCompensationMail(team, offer, followUp = false) {
    const player = REAL_PLAYER_BY_ID[offer?.playerId];
    if (!team?.ownerId || !player || !offer) return null;
    return this.pushInbox(team, {
      id:`trait-compensation:${S4_TRAIT_COMPENSATION_ID}:${offer.id}`,
      type:"trait-compensation",
      title:followUp ? `${player.name}仍有一项特性待补发` : "强化特性门槛调整补偿",
      summary:`${player.name} +${offer.upgradeLevel}受 +4/+7 新门槛影响，可免费选择并绑定1项特性。`,
      body:`新版将强化特性的获得门槛由 +5/+8 调整为 +4/+7。系统确认你的${player.name} +${offer.upgradeLevel}球员卡（${offer.cardId}）受到影响，现补发1次三选一特性机会。选择后会自动绑定到这张指定球员卡，不会消耗金币或材料。`,
      payload:{
        compensationId:S4_TRAIT_COMPENSATION_ID,
        offerId:offer.id,
        cardId:offer.cardId,
        playerId:offer.playerId,
        playerName:player.name,
        upgradeLevel:Number(offer.upgradeLevel ?? 0),
        unlockLevel:Number(offer.unlockLevel ?? 0),
        traitOffer:this.publicS4EnhancementTraitOffer(offer),
        resolvedAt:null,
        chosenTraitId:null,
      },
    });
  }

  dispatchS4TraitThresholdCompensation() {
    if (this.now() < S4_TRAIT_COMPENSATION_AT) return false;
    const compensations = this.state.s4Assets.traitThresholdCompensations ??= {};
    if (compensations[S4_TRAIT_COMPENSATION_ID]?.dispatchedAt) return false;
    const affectedCards = Object.values(this.state.s4Assets.cards ?? {})
      .filter((card) => card.status === "active" && card.ownerId && this.nextS4EnhancementTraitUnlockLevel(card) != null)
      .sort((left, right) => String(left.ownerId).localeCompare(String(right.ownerId)) || String(left.id).localeCompare(String(right.id)));
    const batch = compensations[S4_TRAIT_COMPENSATION_ID] = {
      id:S4_TRAIT_COMPENSATION_ID,
      scheduledAt:S4_TRAIT_COMPENSATION_AT,
      dispatchedAt:this.now(),
      cardIds:affectedCards.map((card) => card.id),
      recipientIds:[...new Set(affectedCards.map((card) => card.ownerId))],
      offerIds:[],
    };
    affectedCards.forEach((card) => {
      const team = this.accountTeam(card.ownerId);
      const offer = this.createS4EnhancementTraitOffer(card.ownerId, card, { source:"threshold-compensation" });
      if (!team || !offer) return;
      offer.unlockLevel ??= this.nextS4EnhancementTraitUnlockLevel(card);
      if (!batch.offerIds.includes(offer.id)) batch.offerIds.push(offer.id);
      this.sendS4TraitCompensationMail(team, offer);
    });
    this.save();
    return true;
  }
  inbox(team) {
    return clone((this.state.inbox[team.id] ?? []).slice().sort((left, right) => right.createdAt - left.createdAt));
  }

  scheduleInboxReadPersist() {
    if (!this.statePath) return;
    clearTimeout(this.inboxReadPersistTimer);
    this.inboxReadPersistTimer = setTimeout(() => {
      this.inboxReadPersistTimer = null;
      this.save({ skipDailyBackup:true });
    }, 500);
    this.inboxReadPersistTimer.unref?.();
  }

  readInbox(account, messageIdValue, options = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const message = (this.state.inbox[team.id] ?? []).find((entry) => entry.id === String(messageIdValue ?? ""));
    if (!message) throw new Error("找不到这封邮件");
    if (!message.readAt) {
      message.readAt = this.now();
      this.state.updatedAt = Math.max(this.now(), Number(this.state.updatedAt ?? 0) + 1);
      this.scheduleInboxReadPersist();
    }
    if (options.compact) return clone({
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      messageId:message.id,
      readAt:message.readAt,
      inboxUnreadCount:(this.state.inbox[team.id] ?? []).filter((entry) => !entry.readAt).length,
    });
    return this.view(account);
  }

  deleteInbox(account, messageIdValue) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const messageId = String(messageIdValue ?? "");
    const inbox = this.state.inbox[team.id] ?? [];
    const message = inbox.find((entry) => entry.id === messageId);
    if (!message) throw new Error("找不到这封邮件");
    if (!this.inboxMessageDeletable(message)) throw new Error("请先处理这封邮件中的待办事项");
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

  draftView(account) {
    const draft = this.state.drafts[account.id] ?? null;
    if (!draft) return null;
    const regularDraftComplete = validDraft(draft.selectedIds);
    return clone({
      teamId:draft.teamId,
      selectedIds:[...draft.selectedIds],
      selectedPlayers:draft.selectedIds.map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
      counts:draftCounts(draft.selectedIds),
      offerPool:draft.offerPool ?? null,
      offer:(draft.offerIds ?? []).map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
      allowedPools:this.allowedDraftPools(draft),
      xPlayerId:draft.xPlayerId ?? null,
      xPlayer:draft.xPlayerId ? playerSummary(REAL_PLAYER_BY_ID[draft.xPlayerId], { role:draft.xRole, secondaryRole:draft.xSecondaryRole, heightCm:draft.xHeightCm, attributes:draft.xAttributes }) : null,
      xRole:draft.xRole ?? null,
      xSecondaryRole:draft.xSecondaryRole ?? null,
      xHeightCm:draft.xHeightCm ?? null,
      xTraitId:draft.xTraitId ?? null,
      xPlayers:regularDraftComplete ? this.availableXPlayers(account.id).map((player) => playerSummary(player)) : [],
      xRoles:regularDraftComplete ? [...X_PLAYER_ROLES] : [],
      xHeightRange:regularDraftComplete ? { min:X_PLAYER_HEIGHT_MIN, max:X_PLAYER_INITIAL_HEIGHT_MAX } : null,
      xTraits:draft.xRole ? this.eligibleXTraits(draft.xRole).map((trait) => ({ id:trait.id, name:trait.name, summary:trait.summary, eligibleRoleGroups:[...(trait.eligibleRoleGroups ?? [])] })) : [],
    });
  }

  draftMutationView(account) {
    return {
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      draft:this.draftView(account),
    };
  }

  ownTeamView(account) {
    const team = this.accountTeam(account.id);
    if (!team) return null;
    const listingByPlayer = new Map(this.state.listings.filter((item) => item.status === "active").map((item) => [item.playerId, item]));
    const ownTeam = publicTeam(team, true);
    ownTeam.roster.forEach((player) => {
      const source = REAL_PLAYER_BY_ID[player.id];
      const cards = this.playerCards(account.id, player.id);
      const activeCard = cards[0] ?? null;
      player.listed = listingByPlayer.has(player.id);
      player.referencePrice = s4OwnershipReferenceValue(source);
      player.minimumPrice = ownershipMinimumListingPrice(source);
      player.cards = cards.map((card) => publicLeagueS4Card(this.state, card));
      player.cards.forEach((card) => {
        card.baseOverall = source.overall;
        card.effectiveOverall = s4EffectiveOverall(source, card.upgradeLevel);
        card.upgradeBonus = card.effectiveOverall - source.overall;
        card.referenceValue = s4CardReferenceValue(source, card.upgradeLevel);
        card.minimumListingPrice = Math.ceil(card.referenceValue * S4_PRICING.cardListingFloorRate / 100) * 100;
        card.systemRecoveryValue = s4SingleCardReleaseValue(source, card.upgradeLevel);
        card.systemRecyclable = Number(card.upgradeLevel ?? 0) <= 4;
      });
      player.activeCardId = activeCard?.id ?? null;
      player.upgradeLevel = Number(activeCard?.upgradeLevel ?? 0);
      player.baseOverall = source.overall;
      player.effectiveOverall = s4EffectiveOverall(source, player.upgradeLevel);
      player.effectiveAttributes = applyS4Enhancement(source, player.upgradeLevel).attributes;
      Object.assign(player, traitBoardPresentation(player, activeCard?.traitIds));
      player.ownsRights = ownershipOwner(this.state, player.id) === account.id;
      if (player.ownsRights && !isS4Legend(source)) {
        const highestLevel = Math.max(...cards.map((card) => Number(card.upgradeLevel ?? 0)));
        const retained = highestLevel > 0 ? cards.filter((card) => Number(card.upgradeLevel ?? 0) === highestLevel) : [];
        const retainedIds = new Set(retained.map((card) => card.id));
        const recovered = cards.filter((card) => !retainedIds.has(card.id));
        const ownershipAmount = Math.floor(s4OwnershipReferenceValue(source) * S4_OWNERSHIP_RETURN_RATE);
        const recoveryAmount = recovered.reduce((sum, card) => sum + s4ForcedCardRecoveryValue(source, card.upgradeLevel), 0);
        player.ownershipReturnPreview = {
          retainedCardIds:retained.map((card) => card.id),
          retainedCardCount:retained.length,
          retainedUpgradeLevel:retained.length ? highestLevel : null,
          recoveredCardCount:recovered.length,
          recoveryAmount,
          ownershipAmount,
          totalAmount:recoveryAmount + ownershipAmount,
        };
      }
      player.rosterSlotUsed = rosterFamilyUsesSlot(this.state, account.id, player.id);
      player.releaseValue = Number(activeCard?.upgradeLevel ?? 0) <= 1
        ? s4SingleCardReleaseValue(source, activeCard?.upgradeLevel)
          + (player.ownsRights && cards.length === 1 ? Math.floor(s4OwnershipReferenceValue(source) * S4_OWNERSHIP_RETURN_RATE) : 0)
        : null;
    });
    ownTeam.s4Assets = publicS4AssetsForOwner(this.state, account.id);
    const starters = ownTeam.roster.filter((player) => team.preferredStarterIds.includes(player.id)).map((player) => {
      const activeCard = player.cards.find((card) => card.id === player.activeCardId) ?? player.cards[0];
      return { ...player, traits:(activeCard?.traits ?? []).map((trait) => trait.id) };
    });
    const roles = inferElevenBoardRoles(starters.map((player) => ({ id:player.id, position:team.positions[player.id] })));
    ownTeam.bonds = evaluateS4LineupBonds(starters, S4_BOND_CATALOG, { roles });
    return ownTeam;
  }

  shopView(accountId) {
    return {
      catalog:S4_PACK_CATALOG.map((pack) => {
        const purchasedQuantity = this.state.ledger
          .filter((entry) => entry.accountId === accountId && entry.type === "s4-pack-buy" && entry.packType === pack.id)
          .reduce((sum, entry) => sum + Number(entry.quantity ?? 1), 0);
        return { ...pack, purchasedQuantity, remainingQuantity:pack.seasonPurchaseLimit == null ? null : Math.max(0, pack.seasonPurchaseLimit - purchasedQuantity) };
      }),
      maxPurchaseQuantity:S4_MAX_PACK_PURCHASE_QUANTITY,
    };
  }

  s4PacksView(accountId) {
    const offer = this.state.s4Packs.offers[accountId];
    const batchOpening = this.state.s4Packs.batchOpenings[accountId];
    return {
      inventory:this.s4PackInventory(accountId).filter((item) => ["unopened", "choosing"].includes(item.status)).map((item) => this.publicS4PackItem(item)),
      offer:offer?.status === "pending" ? {
        ...clone(offer),
        players:offer.playerIds.map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
        playerIds:undefined,
      } : null,
      batchOpening:batchOpening?.status === "active" ? {
        id:batchOpening.id,
        packType:batchOpening.packType,
        total:batchOpening.packIds.length,
        completed:batchOpening.results.length,
        remaining:batchOpening.packIds.length - batchOpening.results.length,
        status:"active",
      } : null,
    };
  }

  listingView(listing) {
    return {
      ...listing,
      player:playerSummary(REAL_PLAYER_BY_ID[listing.playerId]),
      card:listing.cardId && this.state.s4Assets.cards[listing.cardId] ? publicLeagueS4Card(this.state, this.state.s4Assets.cards[listing.cardId]) : null,
      retainedCardCount:listing.kind === "ownership" && listing.retainedUpgradeLevel != null
        ? this.playerCards(listing.sellerId, listing.playerId).filter((card) => Number(card.upgradeLevel ?? 0) === Number(listing.retainedUpgradeLevel)).length
        : 0,
      sellerTeamName:this.state.teams.find((entry) => entry.id === listing.sellerTeamId)?.name ?? "未知球队",
    };
  }

  activeListingsView() {
    return this.state.listings.filter((item) => item.status === "active").map((item) => this.listingView(item));
  }

  compactMutationView(account, options = {}) {
    const team = this.accountTeam(account.id);
    const result = {
      compact:true,
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      wallet:this.wallet(account.id),
      inboxUnreadCount:team ? (this.state.inbox[team.id] ?? []).filter((message) => !message.readAt).length : 0,
    };
    if (options.ownTeam) result.ownTeam = this.ownTeamView(account);
    if (options.shop) result.shop = this.shopView(account.id);
    if (options.s4Packs) result.s4Packs = this.s4PacksView(account.id);
    if (options.listings) result.listings = this.activeListingsView();
    if (options.extra) Object.assign(result, options.extra);
    return clone(result);
  }

  // 轻量同步头：供前端静默刷新使用，几十字节，避免每 12 秒构建/传输完整联赛视图。
  // 只有 updatedAt / 赛季状态变化时才需要重新拉取完整 view()。
  leagueHead(account) {
    const team = this.accountTeam(account.id);
    return {
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      seasonStatus:this.state.season?.status ?? null,
      seasonCurrentRound:Number(this.state.season?.currentRound ?? 0),
      walletBalance:this.wallet(account.id).balance,
      inboxUnreadCount:team ? (this.state.inbox[team.id] ?? []).filter((message) => !message.readAt).length : 0,
    };
  }

  view(account, options = {}) {
    this.pruneInvalidS4EnhancementTraitOffers();
    const team = this.accountTeam(account.id);
    const pendingTraitOffer = Object.values(this.state.s4Assets.traitOffers ?? {}).find((offer) => offer.ownerId === account.id && offer.status === "pending") ?? null;
    const ownTeam = team ? this.ownTeamView(account) : null;
    return clone({
      updatedAt:this.state.updatedAt,
      season:this.state.season,
      cup:this.cupView(),
      worldCup:this.worldCupView(account.id),
      serverTime:this.now(),
      schedule:{ activeHours:"10:00 - 22:00", intervalMinutes:20, serverPause:true, fixtures:team ? this.teamSchedule(team.id) : [] },
      teams:this.standings().map((entry) => ({ ...publicTeam(this.state.teams.find((teamEntry) => teamEntry.id === entry.id)), rank:entry.rank })),
      ownTeam,
      bondCatalog:S4_BOND_CATALOG,
      draft:this.draftView(account),
      aiSlotsRemaining:this.state.teams.filter((entry) => !entry.ownerId && !Object.values(this.state.drafts).some((item) => item.teamId === entry.id)).length,
      wallet:this.wallet(account.id),
      xGrowth:this.publicXGrowth(account.id),
      shop:{
        catalog:S4_PACK_CATALOG.map((pack) => {
          const purchasedQuantity = this.state.ledger
            .filter((entry) => entry.accountId === account.id && entry.type === "s4-pack-buy" && entry.packType === pack.id)
            .reduce((sum, entry) => sum + Number(entry.quantity ?? 1), 0);
          return { ...pack, purchasedQuantity, remainingQuantity:pack.seasonPurchaseLimit == null ? null : Math.max(0, pack.seasonPurchaseLimit - purchasedQuantity) };
        }),
        maxPurchaseQuantity:S4_MAX_PACK_PURCHASE_QUANTITY,
      },
      enhancement:{
        maxLevel:S4_ENHANCEMENT_MAX_LEVEL,
        equalLevelChances:[...S4_ENHANCEMENT_EQUAL_CHANCES],
        protectionCostFactor:S4_ENHANCEMENT.protectionCostFactor,
        protectionCostDiscount:S4_ENHANCEMENT.protectionCostDiscount,
        protectionCostUnit:S4_ENHANCEMENT.protectionCostUnit,
        abilityBonuses:[...S4_ENHANCEMENT.abilityBonuses],
        traitUnlockLevels:[...S4_ENHANCEMENT.traitUnlockLevels],
        lowerMaterialMultiplier:S4_ENHANCEMENT.lowerMaterialMultiplier,
        higherMaterialMultiplier:S4_ENHANCEMENT.higherMaterialMultiplier,
        history:this.enhancementHistory(account.id),
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
      playerDirectory:publicS4PlayerDirectory(this.state),
      matchRounds:this.matchRounds(),
      recentMatches:this.state.matches.slice().reverse().map((match) => this.matchSummary(match)),
      reviewHistory:team ? this.teamHistory(team.id) : [],
      reviewDemo:{ id:"__v2_review_demo__", competition:"demo", label:"V2 全量验证样本", playedAt:1_800_000_000_000, homeName:"标准阵容", awayName:"传奇强化阵容", score:[3,1], hasDetails:true, hasTacticalReview:true, engineVersion:"2.0.0-alpha.7" },
      rewardOffers:[],
      listings:this.state.listings.filter((item) => item.status === "active").map((item) => ({
        ...item,
        player:playerSummary(REAL_PLAYER_BY_ID[item.playerId]),
        card:item.cardId && this.state.s4Assets.cards[item.cardId] ? publicLeagueS4Card(this.state, this.state.s4Assets.cards[item.cardId]) : null,
        retainedCardCount:item.kind === "ownership" && item.retainedUpgradeLevel != null
          ? this.playerCards(item.sellerId, item.playerId).filter((card) => Number(card.upgradeLevel ?? 0) === Number(item.retainedUpgradeLevel)).length
          : 0,
        sellerTeamName:this.state.teams.find((entry) => entry.id === item.sellerTeamId)?.name ?? "未知球队",
      })),
      cardTradeOffers:this.state.cardTradeOffers
        .filter((offer) => offer.fromOwnerId === account.id || offer.toOwnerId === account.id)
        .map((offer) => this.cardTradeOfferView(offer))
        .sort((left, right) => right.createdAt - left.createdAt),
      matchPredictions:this.publicMatchPredictions(account),
      predictionLeaderboard:this.predictionLeaderboard(),
      tradeLockedCardIds:[...new Set(this.state.cardTradeOffers.filter((offer) => offer.status === "pending").flatMap((offer) => offer.offeredCardIds))],
      friendlyInvitations:this.state.friendlyInvitations.filter((item) => item.fromOwnerId === account.id || item.toOwnerId === account.id).map((item) => this.friendlyInvitationView(item)),
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
    const competition = match.competition ?? "league";
    const label = competition === "cup"
      ? match.cupStage === "swiss"
        ? `瑞士轮第${match.cupRound ?? match.round}轮`
        : `${CUP_STAGE_NAMES[match.cupStage] ?? "杯赛"}${match.legNumber ? ` · 第${match.legNumber}回合` : ""}`
      : competition === "worldcup"
        ? ({ group:`${match.worldCupGroupId ?? ""}组第${match.round}轮`, quarterfinal:"世界杯四分之一决赛", semifinal:"世界杯半决赛", final:"世界杯决赛" }[match.worldCupStage] ?? "黄狗世界杯")
      : competition === "friendly"
        ? "友谊赛"
        : Number.isFinite(Number(match.round)) ? `第${match.round}轮` : "联赛";
    return {
      id:match.id,
      competition,
      label,
      round:match.round,
      cupStage:match.cupStage ?? null,
      cupRound:match.cupRound ?? null,
      legNumber:match.legNumber ?? null,
      playedAt:match.playedAt,
      homeId:match.homeId,
      awayId:match.awayId,
      homeName:home?.name ?? match.homeName ?? "未知球队",
      awayName:away?.name ?? match.awayName ?? "未知球队",
      score:[...(match.score ?? [0, 0])],
      formations:[...(match.formations ?? [])],
      hasPlayerTeam:Boolean(home?.ownerId || away?.ownerId),
      hasDetails:Boolean(match.report),
      hasTacticalReview:Boolean(match.report?.tacticalReview),
      engineVersion:match.report?.engineVersion ?? null,
    };
  }

  v2ReviewDemoDetail() {
    if (this.cachedV2ReviewDemo) return clone(this.cachedV2ReviewDemo);
    if (!existsSync(V2_REVIEW_DEMO_PATH)) throw new Error("V2 复盘 Demo 数据缺失");
    this.cachedV2ReviewDemo = JSON.parse(readFileSync(V2_REVIEW_DEMO_PATH, "utf8"));
    return clone(this.cachedV2ReviewDemo);
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
    const friendlyFixtures = this.state.friendlyFixtures.filter((fixture) => fixture.homeId === teamId || fixture.awayId === teamId).map((fixture) => {
      const ownIsHome = fixture.homeId === teamId;
      const opponentId = ownIsHome ? fixture.awayId : fixture.homeId;
      const opponent = this.state.teams.find((team) => team.id === opponentId);
      return { id:`friendly:${fixture.id}`, competition:"friendly", competitionName:"YDL友谊赛", round:0, label:"友谊赛", startsAt:fixture.startsAt, status:fixture.status, opponentId, opponentName:opponent?.name ?? "未知球队", venue:ownIsHome ? "home" : "away", matchId:fixture.matchId ?? null, broadcastCode:fixture.broadcastCode ?? null, score:fixture.score ? (ownIsHome ? [...fixture.score] : [fixture.score[1], fixture.score[0]]) : null, weather:null, referee:null };
    });
    const club = this.state.teams.find((team) => team.id === teamId);
    const worldCupTeam = this.state.worldCup?.teams?.find((team) => team.ownerId && team.ownerId === club?.ownerId);
    const worldCupStartsAt = Number(this.state.worldCup?.startsAt);
    const worldCupFixtures = worldCupTeam && Number.isFinite(worldCupStartsAt) && worldCupStartsAt > 0 ? this.state.worldCup.events.flatMap((event, eventIndex) => this.worldCupEventFixtures(event).map((fixture) => {
      if (fixture.homeId !== worldCupTeam.id && fixture.awayId !== worldCupTeam.id) return null;
      const ownIsHome = fixture.homeId === worldCupTeam.id;
      const opponent = this.worldCupTeam(ownIsHome ? fixture.awayId : fixture.homeId);
      const match = fixture.matchId ? this.state.matches.find((entry) => entry.id === fixture.matchId) : null;
      const live = this.state.liveWorldCupRound?.matches.find((entry) => entry.fixtureId === fixture.id && !entry.completed);
      const labels = { group:`${fixture.groupId}组第${event.round}轮`, quarterfinal:"四分之一决赛", semifinal:"半决赛", final:"决赛" };
      return { id:`worldcup:${fixture.id}`, competition:"worldcup", competitionName:"黄狗世界杯", round:event.round, stage:event.stage, label:labels[event.stage] ?? event.stage, startsAt:match?.playedAt ?? (live ? this.state.liveWorldCupRound.startedAt : worldCupStartsAt + eventIndex * WORLD_CUP_INTERVAL_MS), status:match ? "complete" : live ? "live" : "scheduled", opponentId:opponent?.id ?? null, opponentName:opponent?.country ?? "待定", venue:ownIsHome ? "home" : "away", matchId:match?.id ?? null, broadcastCode:live?.code ?? null, score:match ? (ownIsHome ? [...match.score] : [match.score[1], match.score[0]]) : null, weather:null, referee:null };
    }).filter(Boolean)) : [];
    return [...leagueFixtures, ...cupFixtures, ...worldCupFixtures, ...friendlyFixtures].sort((left, right) => left.startsAt - right.startsAt || left.competition.localeCompare(right.competition));
  }

  teamHistory(teamId) {
    return this.state.matches
      .filter((match) => match.homeId === teamId || match.awayId === teamId)
      .sort((left, right) => Number(right.playedAt ?? 0) - Number(left.playedAt ?? 0) || Number(right.round ?? 0) - Number(left.round ?? 0))
      .map((match) => this.matchSummary(match));
  }

  liveView(account) {
    const team = this.accountTeam(account.id);
    return clone({
      serverTime:this.now(),
      season:{
        id:this.state.season.id,
        name:this.state.season.name,
        status:this.state.season.status,
        currentRound:this.state.season.currentRound,
        totalRounds:this.state.season.totalRounds,
      },
      team:team ? { id:team.id, name:team.name, ownerName:team.ownerName } : null,
      schedule:team ? this.teamSchedule(team.id) : [],
      history:team ? this.teamHistory(team.id) : [],
      broadcasts:this.broadcasts(),
    });
  }

  predictionMarketId(competition, roundKey, fixture) {
    const fixtureKey = competition === "cup" ? fixture.id : `${fixture.homeId}-${fixture.awayId}`;
    return `${competition}:${this.state.season.id}:${roundKey}:${fixtureKey}`;
  }

  nextPredictionFixtures() {
    const entries = [];
    const leagueRound = this.state.rounds[this.state.season.currentRound];
    if (this.state.season.status === "active" && leagueRound?.status === "pending" && Number(this.state.season.nextRoundAt) > this.now()) {
      leagueRound.fixtures.forEach((fixture) => entries.push({
        id:this.predictionMarketId("league", `R${leagueRound.number}`, fixture),
        competition:"league",
        competitionName:"黄狗联赛",
        round:leagueRound.number,
        stage:null,
        leg:1,
        roundKey:`R${leagueRound.number}`,
        fixture,
        startsAt:Number(this.state.season.nextRoundAt),
        matchOptions:{ competitionMode:"league", regulationOnly:true },
      }));
    }
    const cupEvent = this.state.cup.status === "active"
      ? this.state.cup.events.find((event) => event.status === "pending")
      : null;
    if (cupEvent && Number(this.state.cup.nextRoundAt) > this.now()) {
      this.cupEventFixtures(cupEvent).forEach((fixture) => {
        const tie = cupEvent.stage === "swiss" ? null : this.state.cup.knockout[cupEvent.stage].find((entry) => entry.legs.includes(fixture));
        const firstLeg = tie?.legs[0];
        entries.push({
          id:this.predictionMarketId("cup", cupEvent.id, fixture),
          competition:"cup",
          competitionName:"黄狗冠军杯",
          round:cupEvent.round,
          stage:cupEvent.stage,
          leg:cupEvent.leg,
          roundKey:cupEvent.id,
          fixture,
          startsAt:Number(this.state.cup.nextRoundAt),
          matchOptions:{
            competitionMode:"cup",
            legNumber:cupEvent.leg,
            regulationOnly:cupEvent.stage === "swiss" || cupEvent.stage === "final" ? false : cupEvent.leg === 1,
            aggregateBaseScore:cupEvent.leg === 2 && firstLeg ? [firstLeg.score[1], firstLeg.score[0]] : null,
          },
        });
      });
    }
    return entries;
  }

  predictionGoalBand(total) {
    return total <= 5 ? "0-5" : total <= 10 ? "6-10" : "11+";
  }

  predictionCardBand(total) {
    return total <= 0 ? "0" : total === 1 ? "1" : total === 2 ? "2" : total === 3 ? "3" : "4+";
  }

  predictionResult(score, homeHandicap = 0) {
    const adjustedHome = Number(score[0] ?? 0) + Number(homeHandicap ?? 0);
    const away = Number(score[1] ?? 0);
    return adjustedHome > away ? "home" : adjustedHome < away ? "away" : "draw";
  }

  predictionResultHandicap(scores) {
    if (!scores.length) return { handicap:0, counts:{ home:0, draw:0, away:0 } };
    const averageDifference = scores.reduce((sum, score) => sum + Number(score[0] ?? 0) - Number(score[1] ?? 0), 0) / scores.length;
    const largestDifference = Math.max(...scores.map((score) => Math.abs(Number(score[0] ?? 0) - Number(score[1] ?? 0))));
    const limit = Math.max(3, Math.min(12, Math.ceil(largestDifference + 2)));
    const target = scores.length / MATCH_PREDICTION_OPTIONS.result.length;
    let best = null;
    for (let handicap = -limit; handicap <= limit; handicap += 1) {
      const counts = { home:0, draw:0, away:0 };
      scores.forEach((score) => { counts[this.predictionResult(score, handicap)] += 1; });
      const imbalance = MATCH_PREDICTION_OPTIONS.result.reduce((sum, key) => sum + ((counts[key] - target) ** 2), 0);
      const candidate = {
        handicap,
        counts,
        imbalance,
        expectedDistance:Math.abs(handicap + averageDifference),
      };
      if (!best
        || candidate.imbalance < best.imbalance
        || (candidate.imbalance === best.imbalance && candidate.expectedDistance < best.expectedDistance)
        || (candidate.imbalance === best.imbalance && candidate.expectedDistance === best.expectedDistance && Math.abs(candidate.handicap) < Math.abs(best.handicap))) {
        best = candidate;
      }
    }
    return { handicap:best.handicap, counts:best.counts };
  }

  predictionHandicapHint(handicap) {
    const value = Number(handicap);
    if (!Number.isInteger(value)) return "盘口分析中";
    if (value < 0) return "主队让球";
    if (value > 0) return "客队让球";
    return "均势盘";
  }

  predictionClosesAt(startsAt) {
    return Number(startsAt) - MATCH_PREDICTION_LOCK_LEAD_MS;
  }

  predictionCategoryLabel(category) {
    return { result:"胜平负", goals:"总进球", cards:"红黄牌总数" }[category] ?? category;
  }

  predictionSelectionLabel(market, category, selection) {
    if (category === "result") return selection === "home" ? `${market.homeName}胜` : selection === "away" ? `${market.awayName}胜` : "平局";
    if (category === "goals") return selection === "0-5" ? "0–5球" : selection === "6-10" ? "6–10球" : "11球及以上";
    if (category === "cards") return selection === "4+" ? "4张及以上" : `${selection}张`;
    return selection;
  }

  predictionPayoutRates(counts, samples, options) {
    const denominator = samples + options.length;
    return Object.fromEntries(options.map((option) => {
      const probability = (Number(counts[option] ?? 0) + 1) / denominator;
      const rate = Math.max(1.05, Math.min(MATCH_PREDICTION_MAX_PAYOUT_RATE, (1 - MATCH_PREDICTION_MARGIN) / probability));
      return [option, Number(rate.toFixed(3))];
    }));
  }

  generatePredictionMarket(entry) {
    const existing = this.state.matchPredictions.markets[entry.id];
    if (existing && existing.status !== "preparing" && Number.isInteger(existing.resultHandicap)) return existing;
    const goalCounts = Object.fromEntries(MATCH_PREDICTION_OPTIONS.goals.map((key) => [key, 0]));
    const cardCounts = Object.fromEntries(MATCH_PREDICTION_OPTIONS.cards.map((key) => [key, 0]));
    const simulatedScores = [];
    const totals = {
      goals:[0, 0],
      xg:[0, 0],
      yellowCards:[0, 0],
      redCards:[0, 0],
    };
    for (let index = 0; index < MATCH_PREDICTION_SIMULATIONS; index += 1) {
      const created = this.createFixtureMatch(entry.fixture, entry.round, entry.startsAt, {
        ...entry.matchOptions,
        seed:`prediction:${entry.id}:${index + 1}`,
        recordEvents:false,
        matchEngine:"v1",
      });
      settleAutomatedMatch(created.match, created.startedAt);
      const report = created.match.report;
      const totalGoals = report.score[0] + report.score[1];
      const totalCards = report.teams.reduce((sum, team) => sum + Number(team.stats.yellowCards ?? 0) + Number(team.stats.redCards ?? 0), 0);
      simulatedScores.push([...report.score]);
      goalCounts[this.predictionGoalBand(totalGoals)] += 1;
      cardCounts[this.predictionCardBand(totalCards)] += 1;
      report.teams.forEach((team, teamIndex) => {
        totals.goals[teamIndex] += Number(report.score[teamIndex] ?? 0);
        totals.xg[teamIndex] += Number(team.stats.xg ?? 0);
        totals.yellowCards[teamIndex] += Number(team.stats.yellowCards ?? 0);
        totals.redCards[teamIndex] += Number(team.stats.redCards ?? 0);
      });
    }
    const home = this.state.teams.find((team) => team.id === entry.fixture.homeId);
    const away = this.state.teams.find((team) => team.id === entry.fixture.awayId);
    const samples = MATCH_PREDICTION_SIMULATIONS;
    const resultBalance = this.predictionResultHandicap(simulatedScores);
    const resultCounts = resultBalance.counts;
    const probabilities = {
      result:Object.fromEntries(MATCH_PREDICTION_OPTIONS.result.map((key) => [key, Number((resultCounts[key] / samples).toFixed(4))])),
      goals:Object.fromEntries(MATCH_PREDICTION_OPTIONS.goals.map((key) => [key, Number((goalCounts[key] / samples).toFixed(4))])),
      cards:Object.fromEntries(MATCH_PREDICTION_OPTIONS.cards.map((key) => [key, Number((cardCounts[key] / samples).toFixed(4))])),
    };
    const market = {
      id:entry.id,
      seasonId:this.state.season.id,
      competition:entry.competition,
      competitionName:entry.competitionName,
      round:entry.round,
      stage:entry.stage,
      leg:entry.leg,
      roundKey:entry.roundKey,
      fixtureId:entry.fixture.id ?? null,
      homeId:entry.fixture.homeId,
      awayId:entry.fixture.awayId,
      homeName:home?.name ?? "待定",
      awayName:away?.name ?? "待定",
      startsAt:entry.startsAt,
      closesAt:this.predictionClosesAt(entry.startsAt),
      generatedAt:this.now(),
      status:"open",
      resultHandicap:resultBalance.handicap,
      simulation:{
        samples,
        counts:{ result:resultCounts, goals:goalCounts, cards:cardCounts },
        probabilities,
        expected:{
          goals:totals.goals.map((value) => Number((value / samples).toFixed(3))),
          xg:totals.xg.map((value) => Number((value / samples).toFixed(3))),
          yellowCards:totals.yellowCards.map((value) => Number((value / samples).toFixed(3))),
          redCards:totals.redCards.map((value) => Number((value / samples).toFixed(3))),
        },
      },
      payoutRates:{
        result:this.predictionPayoutRates(resultCounts, samples, MATCH_PREDICTION_OPTIONS.result),
        goals:this.predictionPayoutRates(goalCounts, samples, MATCH_PREDICTION_OPTIONS.goals),
        cards:this.predictionPayoutRates(cardCounts, samples, MATCH_PREDICTION_OPTIONS.cards),
      },
      settlement:null,
    };
    this.state.matchPredictions.markets[market.id] = market;
    return market;
  }

  registerPredictionMarket(entry) {
    if (this.state.matchPredictions.markets[entry.id]) return false;
    const home = this.state.teams.find((team) => team.id === entry.fixture.homeId);
    const away = this.state.teams.find((team) => team.id === entry.fixture.awayId);
    this.state.matchPredictions.markets[entry.id] = {
      id:entry.id,
      seasonId:this.state.season.id,
      competition:entry.competition,
      competitionName:entry.competitionName,
      round:entry.round,
      stage:entry.stage,
      leg:entry.leg,
      roundKey:entry.roundKey,
      fixtureId:entry.fixture.id ?? null,
      homeId:entry.fixture.homeId,
      awayId:entry.fixture.awayId,
      homeName:home?.name ?? "待定",
      awayName:away?.name ?? "待定",
      startsAt:entry.startsAt,
      closesAt:this.predictionClosesAt(entry.startsAt),
      generatedAt:null,
      status:"preparing",
      resultHandicap:null,
      simulation:null,
      payoutRates:null,
      settlement:null,
    };
    return true;
  }

  ensurePredictionMarkets(generationLimit = 1) {
    let changed = false;
    let generated = 0;
    const now = this.now();
    Object.values(this.state.matchPredictions.markets).forEach((market) => {
      const expectedClosesAt = this.predictionClosesAt(market.startsAt);
      if (Number(market.closesAt) !== expectedClosesAt) {
        market.closesAt = expectedClosesAt;
        changed = true;
      }
      if (market.status === "open" && now >= Number(market.closesAt)) {
        market.status = "locked";
        changed = true;
      }
      if (market.status === "open"
        && !Number.isInteger(market.resultHandicap)
        && !this.state.matchPredictions.bets.some((bet) => bet.marketId === market.id)) {
        market.status = "preparing";
        changed = true;
      }
    });
    const entries = this.nextPredictionFixtures();
    entries.forEach((entry) => {
      if (this.registerPredictionMarket(entry)) changed = true;
    });
    entries.forEach((entry) => {
      if (this.state.matchPredictions.markets[entry.id]?.status !== "preparing" || generated >= generationLimit) return;
      this.generatePredictionMarket(entry);
      generated += 1;
      changed = true;
    });
    if (changed) this.save({ skipDailyBackup:true });
    return changed;
  }

  predictionLeaderboard() {
    return this.state.teams
      .filter((team) => team.ownerId)
      .map((team) => {
        const allBets = this.state.matchPredictions.bets.filter((bet) => bet.accountId === team.ownerId);
        const settledBets = allBets.filter((bet) => ["won", "lost"].includes(bet.status));
        const stakes = settledBets.reduce((sum, bet) => sum + Number(bet.amount ?? 0), 0);
        const payouts = settledBets.reduce((sum, bet) => sum + Number(bet.payout ?? 0), 0);
        return {
          accountId:team.ownerId,
          teamId:team.id,
          teamName:team.name,
          ownerName:team.ownerName,
          betCount:allBets.length,
          settledBetCount:settledBets.length,
          netProfit:payouts - stakes,
        };
      })
      .sort((left, right) => right.netProfit - left.netProfit || right.betCount - left.betCount || left.teamName.localeCompare(right.teamName, "zh-CN"))
      .map((entry, index) => ({ ...entry, rank:index + 1 }));
  }

  publicMatchPredictions(account) {
    const team = this.accountTeam(account.id);
    const activeIds = new Set(this.nextPredictionFixtures().map((entry) => entry.id));
    const bets = this.state.matchPredictions.bets.filter((bet) => bet.accountId === account.id);
    return Object.values(this.state.matchPredictions.markets)
      .filter((market) => activeIds.has(market.id))
      .sort((left, right) => left.startsAt - right.startsAt || left.competition.localeCompare(right.competition) || left.id.localeCompare(right.id))
      .map((market) => {
        const ownBets = bets.filter((bet) => bet.marketId === market.id).map((bet) => ({
          id:bet.id,
          category:bet.category,
          selection:bet.selection,
          amount:bet.amount,
          status:bet.status,
          payout:bet.status === "won" ? bet.payout : 0,
          createdAt:bet.createdAt,
          settledAt:bet.settledAt ?? null,
        }));
        const ownTeamMatch = Boolean(team && [market.homeId, market.awayId].includes(team.id));
        const preparing = market.status === "preparing";
        const open = market.status === "open" && this.now() < Number(market.closesAt);
        return {
          id:market.id,
          competition:market.competition,
          competitionName:market.competitionName,
          round:market.round,
          stage:market.stage,
          leg:market.leg,
          homeId:market.homeId,
          awayId:market.awayId,
          homeName:market.homeName,
          awayName:market.awayName,
          startsAt:market.startsAt,
          closesAt:market.closesAt,
          resultHandicapHint:this.predictionHandicapHint(market.resultHandicap),
          status:preparing ? "preparing" : open ? "open" : "locked",
          eligible:Boolean(team && open && !ownTeamMatch),
          lockedReason:!team ? "请先建立联赛球队" : ownTeamMatch ? "不能预测自己球队参加的比赛" : preparing ? "系统正在生成本场预测数据" : open ? null : "本场预测已经截止",
          maxStake:MATCH_PREDICTION_MAX_STAKE,
          options:{
            result:[
              { id:"home", label:`${market.homeName}胜` },
              { id:"draw", label:"平局" },
              { id:"away", label:`${market.awayName}胜` },
            ],
            goals:[
              { id:"0-5", label:"0–5球" },
              { id:"6-10", label:"6–10球" },
              { id:"11+", label:"11球及以上" },
            ],
            cards:[
              { id:"0", label:"0张" },
              { id:"1", label:"1张" },
              { id:"2", label:"2张" },
              { id:"3", label:"3张" },
              { id:"4+", label:"4张及以上" },
            ],
          },
          myBets:ownBets,
        };
      });
  }

  predictionView(account) {
    return clone({
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      wallet:{ balance:this.wallet(account.id).balance },
      matchPredictions:this.publicMatchPredictions(account),
      predictionLeaderboard:this.predictionLeaderboard(),
    });
  }

  placeMatchPrediction(account, marketIdValue, categoryValue, selectionValue, amountValue, options = {}) {
    this.ensurePredictionMarkets();
    const marketId = String(marketIdValue ?? "");
    const category = String(categoryValue ?? "");
    const selection = String(selectionValue ?? "");
    const amount = Number(amountValue);
    const market = this.state.matchPredictions.markets[marketId];
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("请先建立联赛球队");
    if (!market) throw new Error("找不到这场待预测比赛");
    if (market.status !== "open" || this.now() >= Number(market.closesAt)) throw new Error("本场比赛预测已经截止");
    if ([market.homeId, market.awayId].includes(team.id)) throw new Error("不能预测自己球队参加的比赛");
    if (!MATCH_PREDICTION_OPTIONS[category]?.includes(selection)) throw new Error("预测选项无效");
    if (!Number.isInteger(amount) || amount < 1 || amount > MATCH_PREDICTION_MAX_STAKE) throw new Error(`单个选项投资必须为1至${MATCH_PREDICTION_MAX_STAKE}金币的整数`);
    if (this.state.matchPredictions.bets.some((bet) => bet.marketId === marketId && bet.accountId === account.id && bet.category === category)) {
      throw new Error("同一场比赛的同一预测类别只能投资一次");
    }
    const wallet = this.wallet(account.id);
    if (wallet.balance < amount) throw new Error("金币不足");
    wallet.balance -= amount;
    const bet = {
      id:makeId("prediction-bet", `${marketId}-${account.id}-${category}`),
      marketId,
      accountId:account.id,
      teamId:team.id,
      category,
      selection,
      amount,
      payoutRate:Number(market.payoutRates[category][selection]),
      status:"pending",
      payout:0,
      createdAt:this.now(),
      settledAt:null,
    };
    this.state.matchPredictions.bets.push(bet);
    this.state.ledger.push({
      id:makeId("ledger", bet.id),
      accountId:account.id,
      amount:-amount,
      type:"match-prediction-stake",
      marketId,
      betId:bet.id,
      category,
      selection,
      createdAt:this.now(),
    });
    const categoryLabel = this.predictionCategoryLabel(category);
    const selectionLabel = this.predictionSelectionLabel(market, category, selection);
    const resultHandicap = Number.isInteger(market.resultHandicap) ? market.resultHandicap : 0;
    this.pushInbox(team, {
      id:`prediction-placed:${bet.id}`,
      type:"prediction",
      title:"比赛预测已受理",
      summary:`${market.homeName} vs ${market.awayName}：${categoryLabel}选择“${selectionLabel}”，投资${amount}金币。`,
      body:`你的比赛预测已经提交成功。比赛：${market.homeName} vs ${market.awayName}；本场胜平负按主队${resultHandicap >= 0 ? "+" : ""}${resultHandicap}球结算；预测类别：${categoryLabel}；预测选项：${selectionLabel}；投入：${amount}金币。比赛结束后系统会自动结算，并通过收件箱告知返还与净收益。`,
      payload:{
        marketId,
        betId:bet.id,
        competition:market.competition,
        competitionName:market.competitionName,
        homeName:market.homeName,
        awayName:market.awayName,
        startsAt:market.startsAt,
        category,
        categoryLabel,
        selection,
        selectionLabel,
        amount,
        resultHandicap,
        status:"pending",
      },
    });
    this.save();
    return options.compact ? this.predictionView(account) : this.view(account);
  }

  settleMatchPrediction(competition, roundKey, fixture, record) {
    const marketId = this.predictionMarketId(competition, roundKey, fixture);
    const market = this.state.matchPredictions?.markets?.[marketId];
    if (!market || market.settlement) return null;
    const totalGoals = Number(record.score[0] ?? 0) + Number(record.score[1] ?? 0);
    const totalCards = record.report.teams.reduce((sum, team) => sum + Number(team.stats.yellowCards ?? 0) + Number(team.stats.redCards ?? 0), 0);
    const resultHandicap = Number.isInteger(market.resultHandicap) ? market.resultHandicap : 0;
    const adjustedScore = [Number(record.score[0] ?? 0) + resultHandicap, Number(record.score[1] ?? 0)];
    const outcomes = {
      result:this.predictionResult(record.score, resultHandicap),
      goals:this.predictionGoalBand(totalGoals),
      cards:this.predictionCardBand(totalCards),
    };
    market.status = "settled";
    market.settlement = {
      matchId:record.id,
      settledAt:this.now(),
      outcomes,
      score:[...record.score],
      resultHandicap,
      adjustedScore,
      totalGoals,
      totalCards,
    };
    this.state.matchPredictions.bets.filter((bet) => bet.marketId === marketId && bet.status === "pending").forEach((bet) => {
      const won = outcomes[bet.category] === bet.selection;
      bet.status = won ? "won" : "lost";
      bet.settledAt = this.now();
      bet.payout = won ? Math.max(1, Math.floor(bet.amount * bet.payoutRate)) : 0;
      if (bet.payout) {
        this.wallet(bet.accountId).balance += bet.payout;
        this.state.ledger.push({
          id:makeId("ledger", `${bet.id}-payout`),
          accountId:bet.accountId,
          amount:bet.payout,
          type:"match-prediction-payout",
          marketId,
          betId:bet.id,
          category:bet.category,
          selection:bet.selection,
          createdAt:this.now(),
        });
      }
      const ownerTeam = this.state.teams.find((team) => team.ownerId === bet.accountId);
      if (ownerTeam) {
        const categoryLabel = this.predictionCategoryLabel(bet.category);
        const selectionLabel = this.predictionSelectionLabel(market, bet.category, bet.selection);
        const outcomeLabel = this.predictionSelectionLabel(market, bet.category, outcomes[bet.category]);
        const netProfit = bet.payout - bet.amount;
        this.pushInbox(ownerTeam, {
          id:`prediction-result:${bet.id}`,
          type:"prediction",
          title:won ? "比赛预测命中并完成结算" : "比赛预测未命中并完成结算",
          summary:won
            ? `投入${bet.amount}金币，返还${bet.payout}金币，净收益+${netProfit}金币。`
            : `投入${bet.amount}金币，本次返还0金币，净收益-${bet.amount}金币。`,
          body:`比赛结果：${market.homeName} ${record.score[0]}:${record.score[1]} ${market.awayName}。胜平负按主队${resultHandicap >= 0 ? "+" : ""}${resultHandicap}球结算，让球后比分为${adjustedScore[0]}:${adjustedScore[1]}。你的${categoryLabel}预测为“${selectionLabel}”，实际结果为“${outcomeLabel}”。本次投入${bet.amount}金币，返还${bet.payout}金币，净收益${netProfit >= 0 ? "+" : ""}${netProfit}金币。`,
          matchId:record.id,
          payload:{
            marketId,
            betId:bet.id,
            category:bet.category,
            categoryLabel,
            selection:bet.selection,
            selectionLabel,
            outcome:outcomes[bet.category],
            outcomeLabel,
            amount:bet.amount,
            status:bet.status,
            payout:bet.payout,
            netProfit,
            score:[...record.score],
            resultHandicap,
            adjustedScore,
            totalGoals,
            totalCards,
          },
        });
      }
    });
    return market.settlement;
  }

  distributePredictionProfit(competition, roundKey, label) {
    if (!this.state.matchPredictions) return null;
    const distributionId = `${competition}:${this.state.season.id}:${roundKey}`;
    const existing = this.state.matchPredictions.distributions.find((entry) => entry.id === distributionId);
    if (existing) return existing;
    const marketIds = new Set(Object.values(this.state.matchPredictions.markets)
      .filter((market) => market.competition === competition && market.roundKey === roundKey)
      .map((market) => market.id));
    const bets = this.state.matchPredictions.bets.filter((bet) => marketIds.has(bet.marketId));
    if (bets.some((bet) => bet.status === "pending")) return null;
    const stakes = bets.reduce((sum, bet) => sum + Number(bet.amount ?? 0), 0);
    const payouts = bets.reduce((sum, bet) => sum + Number(bet.payout ?? 0), 0);
    const systemProfit = stakes - payouts;
    const players = [...new Map(this.state.teams
      .filter((team) => team.ownerId)
      .map((team) => [team.ownerId, team])).values()];
    const sharePool = systemProfit > 0 ? Math.floor(systemProfit * 0.5) : 0;
    const amountPerPlayer = players.length ? Math.floor(sharePool / players.length) : 0;
    const distributedAmount = amountPerPlayer * players.length;
    const distribution = {
      id:distributionId,
      seasonId:this.state.season.id,
      competition,
      roundKey,
      label,
      stakes,
      payouts,
      systemProfit,
      sharePool,
      playerCount:players.length,
      amountPerPlayer,
      distributedAmount,
      undistributedRemainder:sharePool - distributedAmount,
      createdAt:this.now(),
      status:amountPerPlayer > 0 ? "distributed" : "no-distribution",
    };
    this.state.matchPredictions.distributions.push(distribution);
    if (amountPerPlayer <= 0) return distribution;
    players.forEach((team) => {
      this.wallet(team.ownerId).balance += amountPerPlayer;
      this.state.ledger.push({
        id:makeId("ledger", `${distributionId}-${team.ownerId}`),
        accountId:team.ownerId,
        amount:amountPerPlayer,
        type:"match-prediction-profit-share",
        distributionId,
        competition,
        roundKey,
        createdAt:this.now(),
      });
      this.pushInbox(team, {
        id:`prediction-profit-share:${distributionId}:${team.ownerId}`,
        type:"prediction-share",
        title:"比赛预测系统收益均分已到账",
        summary:`${label}预测系统产生正收益，本次向每位玩家均分${amountPerPlayer}金币。`,
        body:`${label}全部预测已完成结算。系统本轮共收到${stakes}金币投资，实际返还${payouts}金币，系统收益为${systemProfit}金币。按照规则取系统收益的50%作为玩家均分池，并向${players.length}位玩家等额发放；你获得${amountPerPlayer}金币，现已到账。`,
        payload:{
          distributionId,
          competition,
          roundKey,
          label,
          stakes,
          payouts,
          systemProfit,
          sharePool,
          playerCount:players.length,
          amount:amountPerPlayer,
          status:"distributed",
        },
      });
    });
    return distribution;
  }

  teamDetail(account, teamIdValue) {
    const team = this.state.teams.find((entry) => entry.id === String(teamIdValue ?? ""));
    if (!team) throw new Error("找不到这支球队");
    const lineup = team.ownerId
      ? team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean)
      : this.actualLineup(team, Math.max(1, this.state.season.currentRound + 1));
    const positions = this.actualPositions(team, lineup);
    const publicPlayer = (player) => applyS4Enhancement(
      playerSummary(player),
      this.representativeCard(team.ownerId, player.id)?.upgradeLevel ?? 0,
    );
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
      canInviteFriendly:Boolean(team.ownerId && team.ownerId !== account.id),
    });
  }

  matchDetail(account, matchIdValue) {
    if (String(matchIdValue ?? "") === "__v2_review_demo__") return this.v2ReviewDemoDetail();
    const match = this.state.matches.find((entry) => entry.id === String(matchIdValue ?? ""));
    if (!match?.report) throw new Error("找不到这场比赛的详细记录");
    const ownTeam = this.accountTeam(account.id);
    const ownWorldCupTeam = this.state.worldCup?.teams?.find((team) => team.ownerId === account.id);
    const viewerTeamId = match.competition === "worldcup" ? ownWorldCupTeam?.id : ownTeam?.id;
    const viewerIndex = viewerTeamId === match.awayId ? 1 : 0;
    const summary = this.matchSummary(match);
    const detail = hydrateHistoricalMatchDetail({
      ...unwrapTracked(match.report),
      playedAt:match.playedAt,
      roomCode:"YDL",
      round:match.round,
      viewerIndex,
    });
    detail.competition = summary.competition;
    detail.matchLabel = summary.label;
    if (detail.teams?.[0]) detail.teams[0].name = this.state.teams.find((team) => team.id === match.homeId)?.name ?? detail.teams[0].name;
    if (detail.teams?.[1]) detail.teams[1].name = this.state.teams.find((team) => team.id === match.awayId)?.name ?? detail.teams[1].name;
    return clone(detail);
  }

  beginDraft(account, teamNameValue) {
    if (this.accountTeam(account.id)) throw new Error("你已经拥有一支 YellowDogs League 球队");
    if (this.state.drafts[account.id]) return this.draftMutationView(account);
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
    this.state.drafts[account.id] = { teamId:team.id, teamName, selectedIds:[], offerIds:[], offerPool:null, xPlayerId:null, xRole:null, xSecondaryRole:null, xHeightCm:null, xTemplatePlayerId:null, xAttributes:null, xTraitId:null, startedAt:this.now() };
    this.save();
    return this.draftMutationView(account);
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
    return this.draftMutationView(account);
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
    return this.draftMutationView(account);
  }

  chooseXPlayer(account, playerIdValue) {
    const draft = this.state.drafts[account.id];
    const playerId = String(playerIdValue ?? "");
    if (!draft || !validDraft(draft.selectedIds) || draft.offerIds?.length) throw new Error("请先完成22人初始球员选秀");
    if (!this.availableXPlayers(account.id).some((player) => player.id === playerId) && draft.xPlayerId !== playerId) throw new Error("该X级球员已经被其他玩家选择");
    draft.xPlayerId = playerId;
    draft.xRole = null;
    draft.xSecondaryRole = null;
    draft.xHeightCm = null;
    draft.xTemplatePlayerId = null;
    draft.xAttributes = null;
    draft.xTraitId = null;
    this.save();
    return this.draftMutationView(account);
  }

  configureXPlayer(account, body = {}) {
    const draft = this.state.drafts[account.id];
    if (!draft?.xPlayerId || !isXPlayer(draft.xPlayerId)) throw new Error("请先选择一名X级球员");
    const role = String(body.role ?? "");
    const secondaryRole = body.secondaryRole ? String(body.secondaryRole) : null;
    const heightCm = Math.round(Number(body.heightCm));
    if (!X_PLAYER_ROLES.includes(role)) throw new Error("请选择有效的主位置");
    if (role === "GK" && secondaryRole) throw new Error("门将无法选择副位置");
    if (role !== "GK" && (!secondaryRole || !X_PLAYER_ROLES.includes(secondaryRole) || secondaryRole === role || secondaryRole === "GK")) throw new Error("请选择不同且有效的非门将副位置");
    if (!Number.isInteger(heightCm) || heightCm < X_PLAYER_HEIGHT_MIN || heightCm > X_PLAYER_INITIAL_HEIGHT_MAX) throw new Error(`身高必须设置为${X_PLAYER_HEIGHT_MIN}-${X_PLAYER_INITIAL_HEIGHT_MAX}cm`);
    draft.xRole = role;
    draft.xSecondaryRole = secondaryRole;
    draft.xHeightCm = heightCm;
    const template = xPlayerAttributeTemplate(role);
    draft.xTemplatePlayerId = template.templatePlayerId;
    draft.xAttributes = template.attributes;
    draft.xTraitId = null;
    this.save();
    return this.draftMutationView(account);
  }

  chooseXPlayerTrait(account, traitIdValue) {
    const draft = this.state.drafts[account.id];
    const traitId = String(traitIdValue ?? "");
    if (!draft?.xPlayerId || !draft.xRole || !draft.xHeightCm) throw new Error("请先完成X级球员的位置与身高设置");
    if (!this.eligibleXTraits(draft.xRole).some((trait) => trait.id === traitId)) throw new Error("该特性不适用于X级球员的主位置");
    draft.xTraitId = traitId;
    this.save();
    return this.draftMutationView(account);
  }

  resetDraft(account) {
    const draft = this.state.drafts[account.id];
    if (!draft) throw new Error("当前没有可重置的选秀");
    draft.selectedIds = [];
    draft.offerIds = [];
    draft.offerPool = null;
    draft.xPlayerId = null;
    draft.xRole = null;
    draft.xSecondaryRole = null;
    draft.xHeightCm = null;
    draft.xTemplatePlayerId = null;
    draft.xAttributes = null;
    draft.xTraitId = null;
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
    const xPlayer = this.availableXPlayers(account.id)[0];
    if (!xPlayer) throw new Error("当前没有可用的X级球员");
    draft.xPlayerId = xPlayer.id;
    draft.xRole = "ST";
    draft.xSecondaryRole = "LW";
    draft.xHeightCm = 178;
    const template = xPlayerAttributeTemplate(draft.xRole);
    draft.xTemplatePlayerId = template.templatePlayerId;
    draft.xAttributes = template.attributes;
    draft.xTraitId = this.eligibleXTraits(draft.xRole)[0]?.id ?? null;
    this.save();
    return this.draftMutationView(account);
  }

  finishDraft(account) {
    const draft = this.state.drafts[account.id];
    if (!draft || draft.offerIds?.length || !validDraft(draft.selectedIds)) throw new Error("需要完成全部22次三选一");
    if (!draft.xPlayerId || !draft.xRole || !draft.xHeightCm || !draft.xTraitId) throw new Error("需要完成X级球员选择、位置、身高和开局特性设置");
    if (!this.availableXPlayers(account.id).some((player) => player.id === draft.xPlayerId)) throw new Error("该X级球员已经被其他玩家选择");
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
    team.rosterIds = [...draft.selectedIds, draft.xPlayerId];
    team.preferredStarterIds = pickStartingIds(team.rosterIds);
    team.positions = leagueBoardPositions(team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]));
    team.positionPresets = Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(team.positions)]));
    team.playerState = Object.fromEntries(team.rosterIds.map((id) => [id, { fitness:100, suspension:0, injuryRounds:0 }]));
    draft.selectedIds.forEach((playerId) => this.grantS4Card(team, playerId, {
      grantOwnership:true,
      acquisitionSource:"initial-draft",
    }));
    this.state.xPlayers.assignments[draft.xPlayerId] = account.id;
    this.state.xPlayers.configs[draft.xPlayerId] = { role:draft.xRole, secondaryRole:draft.xSecondaryRole, heightCm:draft.xHeightCm, templatePlayerId:draft.xTemplatePlayerId, attributes:clone(draft.xAttributes), overall:62, baseAbilityOverall:playerOverallFromAttributes(draft.xAttributes, draft.xRole) };
    const xPlayer = REAL_PLAYER_BY_ID[draft.xPlayerId];
    xPlayer.role = draft.xRole;
    xPlayer.secondaryRole = draft.xSecondaryRole;
    xPlayer.heightCm = draft.xHeightCm;
    xPlayer.pool = roleGroup(draft.xRole);
    xPlayer.attributes = clone(draft.xAttributes);
    xPlayer.referenceAttributes = clone(draft.xAttributes);
    this.grantS4Card(team, draft.xPlayerId, { grantOwnership:true, traitIds:[draft.xTraitId], acquisitionSource:"initial-x-player" });
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

  teamSaveMutationView(team) {
    return clone({
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      team:{
        id:team.id,
        preferredStarterIds:team.preferredStarterIds,
        positions:team.positions,
        positionPresets:team.positionPresets,
        formationLinePresets:team.formationLinePresets,
        tactic:team.tactic,
        style:team.style,
        attackFocus:team.attackFocus,
        defenseFocus:team.defenseFocus,
        fitnessThreshold:team.fitnessThreshold,
        tacticalPlans:team.tacticalPlans,
      },
    });
  }

  saveTeam(account, body, options = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const starters = [...new Set(body.starterIds ?? [])];
    if (starters.length !== 11 || starters.some((id) => !team.rosterIds.includes(id))) throw new Error("必须从注册名单中选择11名首发");
    const players = starters.map((id) => REAL_PLAYER_BY_ID[id]);
    const submittedPresets = body.positionPresets;
    const submittedLinePresets = body.formationLinePresets;
    const formationLinePresets = Object.fromEntries(POSITION_PRESET_KEYS.map((key) => {
      const entries = players.map((player) => ({ id:player.id, position:(submittedPresets?.[key] ?? team.positionPresets?.[key] ?? team.positions)?.[player.id] }));
      return [key, sanitizeFormationLines(submittedLinePresets?.[key] ?? team.formationLinePresets?.[key] ?? deriveFormationLines(entries))];
    }));
    const positionPresets = Object.fromEntries(POSITION_PRESET_KEYS.map((key) => {
      const source = submittedPresets?.[key] ?? (!submittedPresets ? body.positions : null) ?? team.positionPresets?.[key] ?? team.positions;
      const sanitized = sanitizePositions(players, source);
      const formation = analyzeElevenBoardFormation(players, sanitized, formationLinePresets[key]);
      const valid = players.length === 11 && formation.counts.GK === 1 && (key !== "position1" || [formation.counts.DEF, formation.counts.MID, formation.counts.ATT].every((count) => count >= 1));
      if (!valid) throw new Error(`${key === "position1" ? "开局/平局站位" : key === "position2" ? "领先站位" : "落后站位"}：门将必须且只能有一人${key === "position1" ? "，并保留前中后三条外场线" : ""}`);
      return [key, sanitized];
    }));
    team.preferredStarterIds = starters;
    team.positionPresets = positionPresets;
    team.formationLinePresets = formationLinePresets;
    team.positions = clone(positionPresets.position1);
    if (TACTICS.has(body.tactic)) team.tactic = body.tactic;
    if (STYLES.has(body.style)) team.style = body.style;
    if (FOCUSES.has(body.attackFocus)) team.attackFocus = body.attackFocus;
    if (FOCUSES.has(body.defenseFocus)) team.defenseFocus = body.defenseFocus;
    const threshold = Number(body.fitnessThreshold);
    if (Number.isFinite(threshold)) team.fitnessThreshold = Math.max(45, Math.min(100, Math.round(threshold)));
    const plans = body.tacticalPlans ?? {};
    team.tacticalPlans = Object.fromEntries(["opening", "leading", "trailing"].map((state, index) => {
      const fallback = state === "opening" ? { tactic:team.tactic, style:team.style, positionPreset:"position1" } : team.tacticalPlans?.[state] ?? { tactic:state === "leading" ? "defensive" : "positive", style:state === "leading" ? "counterAttack" : "possession", positionPreset:POSITION_PRESET_KEYS[index] };
      return [state, {
        tactic:TACTICS.has(plans[state]?.tactic) ? plans[state].tactic : fallback.tactic,
        style:STYLES.has(plans[state]?.style) ? plans[state].style : fallback.style,
        positionPreset:POSITION_PRESET_KEYS[index],
        inPossession:IN_POSSESSION_PLANS.has(plans[state]?.inPossession) ? plans[state].inPossession : fallback.inPossession ?? "balanced",
        outOfPossession:OUT_OF_POSSESSION_PLANS.has(plans[state]?.outOfPossession) ? plans[state].outOfPossession : fallback.outOfPossession ?? "balanced",
        ...v2TacticalDetailsProperty(plans[state], fallback),
        ...v2TacticalDimensionsProperty(plans[state]?.tacticalDimensions, fallback.tacticalDimensions),
      }];
    }));
    team.tactic = team.tacticalPlans.opening.tactic;
    team.style = team.tacticalPlans.opening.style;
    this.save();
    if (options.compact) return this.teamSaveMutationView(team);
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

  listPlayer(account, playerId, priceValue, options = {}) {
    const card = this.representativeCard(account.id, playerId);
    if (!card) throw new Error("球员不在你的卡片资产中");
    return this.listCard(account, card.id, priceValue, options);
  }

  listCard(account, cardIdValue, priceValue, options = {}) {
    const team = this.accountTeam(account.id);
    const card = this.state.s4Assets.cards[String(cardIdValue ?? "")];
    const player = REAL_PLAYER_BY_ID[card?.playerId];
    const price = Math.floor(Number(priceValue));
    if (!team || !card || card.status !== "active" || card.ownerId !== account.id || !player) throw new Error("球员卡不在你的资产中");
    if (isXPlayer(player)) throw new Error("X级球员不可挂牌");
    if (this.cardLockedByTrade(card.id)) throw new Error("该球员卡正在交易报价中");
    if (!isS4Legend(player) && Number(card.upgradeLevel ?? 0) < 1) throw new Error("单卡市场只允许挂牌传奇卡或强化卡");
    const cardMinimumPrice = Math.ceil(s4CardReferenceValue(player, card.upgradeLevel) * S4_PRICING.cardListingFloorRate / 100) * 100;
    if (!Number.isFinite(price) || price < cardMinimumPrice) throw new Error(`挂牌价不能低于卡片参考价值的50%（${cardMinimumPrice}金币）`);
    if (this.state.listings.some((item) => item.status === "active" && item.cardId === card.id)) throw new Error("这张球员卡已经挂牌");
    if (this.state.listings.some((item) => item.status === "active" && item.kind === "ownership" && item.playerId === card.playerId)) throw new Error("该球员所有权正在挂牌，请先撤回所有权挂牌");
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
    if (options.compact) return this.compactMutationView(account, { ownTeam:true, listings:true, extra:{ listing:this.listingView(this.state.listings.at(-1)) } });
    return this.view(account);
  }

  inboxMessageDeletable(message) {
    if (message.type === "friendly-invite" && this.state.friendlyInvitations.some((item) => item.id === message.payload?.friendlyInvitationId && item.status === "pending" && this.now() < this.friendlyInvitationExpiresAt(item))) return false;
    if (message.type === "trade-offer" && this.state.cardTradeOffers.some((item) => item.id === message.payload?.tradeOfferId && item.status === "pending")) return false;
    if (message.type === "trait-compensation" && !message.payload?.resolvedAt) return false;
    return true;
  }

  deleteInboxBatch(account, modeValue = "all") {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const mode = modeValue === "read" ? "read" : "all";
    const inbox = this.state.inbox[team.id] ?? [];
    const removable = inbox.filter((message) => this.inboxMessageDeletable(message) && (mode === "all" || message.readAt));
    const removableIds = new Set(removable.map((message) => message.id));
    this.state.inbox[team.id] = inbox.filter((message) => !removableIds.has(message.id));
    const deleted = this.state.inboxDeleted[team.id] ?? (this.state.inboxDeleted[team.id] = []);
    removableIds.forEach((messageId) => { if (!deleted.includes(messageId)) deleted.push(messageId); });
    this.state.inboxDeleted[team.id] = deleted.slice(-500);
    this.save();
    return this.view(account);
  }

  listOwnership(account, playerId, priceValue, retainedCardId = null, options = {}) {
    const team = this.accountTeam(account.id);
    const player = REAL_PLAYER_BY_ID[playerId];
    const cards = this.playerCards(account.id, playerId);
    const price = Math.floor(Number(priceValue));
    if (!team || !player || ownershipOwner(this.state, playerId) !== account.id || !cards.length) throw new Error("你不拥有该球员所有权");
    if (isXPlayer(player)) throw new Error("X级球员不可挂牌所有权");
    if (cards.some((card) => this.cardLockedByTrade(card.id))) throw new Error("该球员存在正在处理的球员卡交易报价");
    if (!Number.isFinite(price) || price < ownershipMinimumListingPrice(player)) throw new Error(`所有权挂牌价不能低于${ownershipMinimumListingPrice(player)}金币`);
    if (this.state.listings.some((item) => item.status === "active" && item.playerId === playerId)) throw new Error("请先撤回该球员的其他挂牌");
    const highestLevel = Math.max(...cards.map((card) => Number(card.upgradeLevel ?? 0)));
    const retainedUpgradeLevel = highestLevel > 0 ? highestLevel : null;
    this.state.listings.push({
      id:makeId("ownership-listing", playerId),
      kind:"ownership",
      playerId,
      retainedCardId:null,
      retainedUpgradeLevel,
      sellerId:account.id,
      sellerTeamId:team.id,
      price,
      status:"active",
      createdAt:this.now(),
    });
    this.save();
    if (options.compact) return this.compactMutationView(account, { ownTeam:true, listings:true, extra:{ listing:this.listingView(this.state.listings.at(-1)) } });
    return this.view(account);
  }

  cancelListing(account, listingId, options = {}) {
    const listing = this.state.listings.find((item) => item.id === listingId && item.status === "active");
    if (!listing || listing.sellerId !== account.id) throw new Error("找不到你的这笔挂牌");
    listing.status = "cancelled";
    listing.closedAt = this.now();
    this.save();
    if (options.compact) return this.compactMutationView(account, { ownTeam:true, listings:true, extra:{ cancelledListingId:listing.id } });
    return this.view(account);
  }

  requiredS4EnhancementTraitCount(card) {
    const player = REAL_PLAYER_BY_ID[card?.playerId];
    if (!player) return 0;
    const initialTraitCount = isXPlayer(player) ? 1 : 0;
    const unlockedCount = S4_ENHANCEMENT.traitUnlockLevels.filter((level) => Number(card.upgradeLevel ?? 0) >= level).length;
    return initialTraitCount + unlockedCount;
  }

  nextS4EnhancementTraitUnlockLevel(card) {
    const player = REAL_PLAYER_BY_ID[card?.playerId];
    if (!player) return null;
    const initialTraitCount = isXPlayer(player) ? 1 : 0;
    const chosenEnhancementTraits = Math.max(0, Number(card.traitIds?.length ?? 0) - initialTraitCount);
    const unlockLevel = S4_ENHANCEMENT.traitUnlockLevels[chosenEnhancementTraits];
    return unlockLevel != null && Number(card.upgradeLevel ?? 0) >= unlockLevel ? unlockLevel : null;
  }

  createS4EnhancementTraitOffer(accountId, card, details = {}) {
    if (!card || card.status !== "active" || card.ownerId !== accountId) return null;
    const existing = Object.values(this.state.s4Assets.traitOffers ?? {}).find((offer) => offer.cardId === card.id && offer.status === "pending");
    if (existing) return existing;
    const player = REAL_PLAYER_BY_ID[card.playerId];
    const unlockLevel = this.nextS4EnhancementTraitUnlockLevel(card);
    if (!player || unlockLevel == null || this.requiredS4EnhancementTraitCount(card) <= Number(card.traitIds?.length ?? 0)) return null;
    const eligibleTraits = Object.values(YDL_TRAIT_BY_ID)
      .filter((trait) => !card.traitIds.includes(trait.id))
      .filter((trait) => trait.eligibleRoleGroups?.includes("ANY") || trait.eligibleRoleGroups?.includes(roleGroup(player.role)));
    const traitIds = [];
    const available = [...eligibleTraits];
    while (traitIds.length < 3 && available.length) {
      const index = Math.floor(this.rng() * available.length);
      traitIds.push(available.splice(index, 1)[0].id);
    }
    if (!traitIds.length) return null;
    const offer = {
      id:makeId("enhancement-trait", `${card.id}-${unlockLevel}`),
      ownerId:accountId,
      cardId:card.id,
      playerId:card.playerId,
      upgradeLevel:Number(card.upgradeLevel ?? 0),
      unlockLevel,
      chance:Number(details.chance ?? 0),
      beforeLevel:details.beforeLevel == null ? null : Number(details.beforeLevel),
      materialLevel:details.materialLevel == null ? null : Number(details.materialLevel),
      source:details.source ?? "enhancement",
      traitIds,
      status:"pending",
      createdAt:this.now(),
    };
    this.state.s4Assets.traitOffers[offer.id] = offer;
    return offer;
  }

  cancelS4EnhancementTraitOffersForCard(cardId, reason = "card-unavailable") {
    let changed = false;
    Object.values(this.state.s4Assets.traitOffers ?? {}).forEach((offer) => {
      if (offer.cardId !== cardId || offer.status !== "pending") return;
      offer.status = "cancelled";
      offer.cancelledAt = this.now();
      offer.cancelReason = reason;
      changed = true;
    });
    return changed;
  }

  pruneInvalidS4EnhancementTraitOffers() {
    let changed = false;
    Object.values(this.state.s4Assets.traitOffers ?? {}).forEach((offer) => {
      if (offer.status !== "pending") return;
      const card = this.state.s4Assets.cards[offer.cardId];
      const valid = card?.status === "active"
        && card.ownerId === offer.ownerId
        && Number(card.upgradeLevel ?? 0) >= Number(offer.unlockLevel ?? Infinity)
        && this.requiredS4EnhancementTraitCount(card) > Number(card.traitIds?.length ?? 0);
      if (valid) return;
      offer.status = "cancelled";
      offer.cancelledAt = this.now();
      offer.cancelReason = "invalid-card-state";
      changed = true;
    });
    return changed;
  }

  enhancementHistory(accountId, limit = 50) {
    const entries = [];
    for (let index = this.state.ledger.length - 1; index >= 0 && entries.length < limit; index -= 1) {
      const entry = this.state.ledger[index];
      if (entry.accountId === accountId && entry.type === "s4-card-enhancement") entries.push(entry);
    }
    return entries.map((entry) => {
        const mainPlayer = entry.mainPlayer ?? playerSummary(REAL_PLAYER_BY_ID[entry.playerId]);
        const materialPlayerId = entry.materialPlayerId ?? this.state.s4Assets.cards[entry.materialCardId]?.playerId ?? entry.playerId;
        const materialPlayer = entry.materialPlayer ?? playerSummary(REAL_PLAYER_BY_ID[materialPlayerId]);
        return {
          id:entry.id,
          createdAt:entry.createdAt,
          mainPlayer,
          mainCard:{ id:entry.mainCardId, playerId:mainPlayer.id, upgradeLevel:Number(entry.beforeLevel ?? 0), effectiveOverall:s4EffectiveOverall(mainPlayer, Number(entry.beforeLevel ?? 0)), traits:[] },
          materialPlayer,
          materialCard:{ id:entry.materialCardId, playerId:materialPlayer.id, upgradeLevel:Number(entry.materialLevel ?? 0), effectiveOverall:s4EffectiveOverall(materialPlayer, Number(entry.materialLevel ?? 0)), traits:[] },
          resultPlayer:mainPlayer,
          resultCard:{ id:entry.mainCardId, playerId:mainPlayer.id, upgradeLevel:Number(entry.afterLevel ?? entry.beforeLevel ?? 0), effectiveOverall:s4EffectiveOverall(mainPlayer, Number(entry.afterLevel ?? entry.beforeLevel ?? 0)), traits:[] },
          protectionUsed:Boolean(entry.protectionUsed),
          protectionCost:Number(entry.protectionCost ?? -Math.min(0, Number(entry.amount ?? 0))),
          chance:Number(entry.chance ?? 0),
          success:Boolean(entry.success),
          beforeLevel:Number(entry.beforeLevel ?? 0),
          afterLevel:Number(entry.afterLevel ?? entry.beforeLevel ?? 0),
        };
      });
  }

  enhanceS4Card(account, mainCardIdValue, materialCardIdValue, useProtection = false, options = {}) {
    this.pruneInvalidS4EnhancementTraitOffers();
    const team = this.accountTeam(account.id);
    const mainCard = this.state.s4Assets.cards[String(mainCardIdValue ?? "")];
    const materialCard = this.state.s4Assets.cards[String(materialCardIdValue ?? "")];
    if (!team) throw new Error("你还没有加入联赛");
    if (!mainCard || mainCard.status !== "active" || mainCard.ownerId !== account.id) throw new Error("请选择有效的主卡");
    if (!materialCard || materialCard.status !== "active" || materialCard.ownerId !== account.id) throw new Error("请选择有效的副卡");
    if (mainCard.id === materialCard.id) throw new Error("主卡和副卡不能是同一张卡");
    if (this.cardLockedByTrade(mainCard.id) || this.cardLockedByTrade(materialCard.id)) throw new Error("请先处理相关球员卡交易报价");
    const mainPlayer = REAL_PLAYER_BY_ID[mainCard.playerId];
    const materialPlayer = REAL_PLAYER_BY_ID[materialCard.playerId];
    if (isXPlayer(materialPlayer)) throw new Error("X级球员只能作为强化主卡");
    if (isXPlayer(mainPlayer)) {
      if (mainPlayer.role !== materialPlayer?.role) throw new Error("X级球员强化只能使用相同位置的普通球员卡");
    } else if (mainCard.playerId !== materialCard.playerId) throw new Error("强化只允许使用同名球员卡");
    const materialFamilyCards = cardsForOwner(this.state, account.id, materialCard.playerId);
    if (ownershipOwner(this.state, materialCard.playerId) === account.id && materialFamilyCards.length === 1) {
      throw new Error(`${materialPlayer.name}是该球员所有权的最后一张锚点卡，不能作为强化副卡`);
    }
    if (Object.values(this.state.s4Assets.traitOffers ?? {}).some((offer) => offer.status === "pending" && offer.cardId === mainCard.id)) throw new Error("请先为主卡选择强化特性");
    const mainLevel = Number(mainCard.upgradeLevel ?? 0);
    const materialLevel = Number(materialCard.upgradeLevel ?? 0);
    if (mainLevel >= S4_ENHANCEMENT_MAX_LEVEL) throw new Error("主卡已经达到最高强化等级");
    const blockedByListing = this.state.listings.some((item) => item.status === "active"
      && (item.cardId === mainCard.id
        || item.cardId === materialCard.id
        || item.kind === "ownership" && item.playerId === mainCard.playerId));
    if (blockedByListing) throw new Error("请先撤回相关球员资产挂牌");

    const chance = s4EnhancementChance(mainLevel, materialLevel);
    const protectionUsed = Boolean(useProtection) && chance < 100;
    const protectionCost = protectionUsed ? s4EnhancementProtectionCost(chance) : 0;
    const consumesMaterialFamily = mainCard.playerId !== materialCard.playerId
      && materialFamilyCards.length === 1;
    if (consumesMaterialFamily && team.rosterIds.length <= 11) {
      throw new Error("不能消耗最后一个可用的球员卡族，球队必须至少保留11名球员");
    }
    if (this.wallet(account.id).balance < protectionCost) throw new Error("金币不足，无法自动购买当前等级的保卡道具");
    const success = this.rng() * 100 < chance;
    if (protectionCost) this.wallet(account.id).balance -= protectionCost;
    this.cancelS4EnhancementTraitOffersForCard(materialCard.id, "used-as-enhancement-material");
    recycleS4Card(this.state, materialCard.id, "enhancement-material", this.now());
    if (consumesMaterialFamily) this.removeEmptyRosterFamily(team, materialCard.playerId);
    mainCard.upgradeLevel = success ? mainLevel + 1 : protectionUsed ? mainLevel : mainLevel >= 3 ? mainLevel - 1 : mainLevel;
    const player = mainPlayer;
    const resultId = makeId("enhancement", `${account.id}-${mainCard.id}`);
    const traitOffer = success ? this.createS4EnhancementTraitOffer(account.id, mainCard, {
      chance,
      beforeLevel:mainLevel,
      materialLevel,
      source:"enhancement",
    }) : null;
    this.state.ledger.push({
      id:makeId("ledger", resultId),
      accountId:account.id,
      amount:-protectionCost,
      type:"s4-card-enhancement",
      playerId:mainCard.playerId,
      materialPlayerId:materialCard.playerId,
      mainPlayer:playerSummary(mainPlayer, isXPlayer(mainPlayer) ? this.xPlayerConfig(mainPlayer.id) : null),
      materialPlayer:playerSummary(materialPlayer),
      mainCardId:mainCard.id,
      materialCardId:materialCard.id,
      beforeLevel:mainLevel,
      materialLevel,
      afterLevel:mainCard.upgradeLevel,
      chance,
      success,
      protectionUsed,
      protectionCost,
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
    this.save();
    const enhancementResult = {
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
          unlockLevel:traitOffer.unlockLevel,
          traits:traitOffer.traitIds.map((id) => ({
            id,
            name:YDL_TRAIT_BY_ID[id]?.name ?? id,
            summary:YDL_TRAIT_BY_ID[id]?.summary ?? "特性效果由联赛后台配置。",
            eligibleRoleGroups:[...(YDL_TRAIT_BY_ID[id]?.eligibleRoleGroups ?? ["ANY"])],
          })),
        } : null,
      };
    if (options.compact) {
      return clone({
        updatedAt:this.state.updatedAt,
        serverTime:this.now(),
        wallet:this.wallet(account.id),
        enhancementHistory:this.enhancementHistory(account.id),
        removedCardId:materialCard.id,
        removedPlayerId:consumesMaterialFamily ? materialCard.playerId : null,
        enhancementResult,
      });
    }
    return {
      ...this.view(account),
      enhancementResult,
    };
  }

  chooseS4EnhancementTrait(account, offerIdValue, traitIdValue, options = {}) {
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
    const compensation = this.state.s4Assets.traitThresholdCompensations?.[S4_TRAIT_COMPENSATION_ID];
    Object.values(this.state.inbox ?? {}).flat().forEach((message) => {
      if (message.type !== "trait-compensation" || message.payload?.offerId !== offer.id) return;
      message.payload.resolvedAt = this.now();
      message.payload.chosenTraitId = traitId;
    });

    const player = REAL_PLAYER_BY_ID[card.playerId];
    const trait = YDL_TRAIT_BY_ID[traitId];
    const team = this.accountTeam(account.id);
    this.notifyEnhancementTraitBinding(team, player, card, trait, offer);
    if (compensation?.cardIds?.includes(card.id) && this.nextS4EnhancementTraitUnlockLevel(card) != null) {
      const nextOffer = this.createS4EnhancementTraitOffer(account.id, card, { source:"threshold-compensation" });
      if (nextOffer) {
        if (!compensation.offerIds.includes(nextOffer.id)) compensation.offerIds.push(nextOffer.id);
        this.sendS4TraitCompensationMail(team, nextOffer, true);
      }
    }
    if (compensation && compensation.cardIds.every((cardId) => {
      const affectedCard = this.state.s4Assets.cards[cardId];
      return !affectedCard || affectedCard.status !== "active" || this.nextS4EnhancementTraitUnlockLevel(affectedCard) == null;
    })) compensation.completedAt ??= this.now();
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
    const enhancementTraitResult = {
        offerId:offer.id,
        player:playerSummary(player),
        card:publicLeagueS4Card(this.state, card),
        trait:{ id:trait.id, name:trait.name },
      };
    if (options.compact) {
      return clone({
        updatedAt:this.state.updatedAt,
        serverTime:this.now(),
        wallet:this.wallet(account.id),
        enhancementHistory:this.enhancementHistory(account.id),
        enhancementTraitResult,
      });
    }
    return { ...this.view(account), enhancementTraitResult };
  }

  releaseCard(account, cardIdValue, confirmOwnershipReturn = false) {
    const team = this.accountTeam(account.id);
    const card = this.state.s4Assets.cards[String(cardIdValue ?? "")];
    const player = REAL_PLAYER_BY_ID[card?.playerId];
    if (!team || !card || card.status !== "active" || card.ownerId !== account.id || !player) throw new Error("不能解约该球员卡");
    if (isXPlayer(player)) throw new Error("X级球员不可回收或解约");
    if (Number(card.upgradeLevel ?? 0) >= 5) throw new Error("+5及以上强化卡无法解约");
    if (this.cardLockedByTrade(card.id)) throw new Error("该球员卡正在交易报价中");
    if (this.state.listings.some((item) => item.status === "active" && (item.cardId === card.id || item.playerId === card.playerId && item.kind === "ownership"))) throw new Error("请先撤回球员资产挂牌");
    const familyCards = this.playerCards(account.id, card.playerId);
    const returnsOwnership = ownershipOwner(this.state, card.playerId) === account.id && familyCards.length === 1;
    if (returnsOwnership && !confirmOwnershipReturn) throw new Error("这是该球员最后一张卡，解约将同时返还球员所有权，请确认");
    if (team.rosterIds.length <= 11 && familyCards.length === 1) throw new Error("不能解约该球员，球队必须保留至少11名可用球员");
    const cardAmount = s4SingleCardReleaseValue(player, card.upgradeLevel);
    const ownershipAmount = returnsOwnership ? Math.floor(s4OwnershipReferenceValue(player) * S4_OWNERSHIP_RETURN_RATE) : 0;
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

  releaseCards(account, cardIdsValue) {
    const team = this.accountTeam(account.id);
    const cardIds = [...new Set((Array.isArray(cardIdsValue) ? cardIdsValue : []).map((id) => String(id ?? "")).filter(Boolean))];
    if (!team || !cardIds.length) throw new Error("请至少选择一张需要回收的球员卡");
    const cards = cardIds.map((id) => this.state.s4Assets.cards[id]);
    if (cards.some((card) => !card || card.status !== "active" || card.ownerId !== account.id || !REAL_PLAYER_BY_ID[card.playerId])) throw new Error("选择中包含无效球员卡");
    if (cards.some((card) => isXPlayer(card.playerId))) throw new Error("X级球员不可回收或解约");
    if (cards.some((card) => Number(card.upgradeLevel ?? 0) >= 5)) throw new Error("+5及以上强化卡无法回收");
    if (cards.some((card) => this.cardLockedByTrade(card.id))) throw new Error("选择中包含正在交易报价中的球员卡");
    if (cards.some((card) => this.state.listings.some((item) => item.status === "active" && (item.cardId === card.id || item.kind === "ownership" && item.playerId === card.playerId)))) throw new Error("请先撤回相关球员资产挂牌");
    const selectedByPlayer = new Map();
    cards.forEach((card) => selectedByPlayer.set(card.playerId, (selectedByPlayer.get(card.playerId) ?? 0) + 1));
    selectedByPlayer.forEach((selectedCount, playerId) => {
      const familyCards = this.playerCards(account.id, playerId);
      if (ownershipOwner(this.state, playerId) === account.id && selectedCount >= familyCards.length) throw new Error(`${REAL_PLAYER_BY_ID[playerId].name}的最后一张卡需通过所有权回收处理`);
    });
    const removedFamilies = [...selectedByPlayer].filter(([playerId, selectedCount]) => selectedCount >= this.playerCards(account.id, playerId).length).map(([playerId]) => playerId);
    if (team.rosterIds.length - removedFamilies.length < 11) throw new Error("回收后球队将少于11名可用球员");
    let amount = 0;
    cards.forEach((card) => {
      const player = REAL_PLAYER_BY_ID[card.playerId];
      const cardAmount = s4SingleCardReleaseValue(player, card.upgradeLevel);
      amount += cardAmount;
      recycleS4Card(this.state, card.id, "batch-single-card-release", this.now());
      this.state.ledger.push({ id:makeId("ledger", card.id), accountId:account.id, amount:cardAmount, type:"release", playerId:card.playerId, cardId:card.id, ownershipReturned:false, createdAt:this.now() });
      recordS4AssetTransaction(this.state, { id:makeId("asset-release", card.id), type:"single-card-release", playerId:card.playerId, cardIds:[card.id], fromOwnerId:account.id, amount:cardAmount, createdAt:this.now() });
    });
    removedFamilies.forEach((playerId) => this.removeEmptyRosterFamily(team, playerId));
    this.wallet(account.id).balance += amount;
    this.save();
    return { ...this.view(account), cardRecoveryResult:{ cardCount:cards.length, amount } };
  }

  cardTradeOfferView(offer) {
    const fromTeam = this.accountTeam(offer.fromOwnerId);
    const toTeam = this.accountTeam(offer.toOwnerId);
    const decorate = (cardId) => {
      const card = this.state.s4Assets.cards[cardId];
      const player = REAL_PLAYER_BY_ID[card?.playerId];
      return card && player ? { card:publicLeagueS4Card(this.state, card), player:playerSummary(player) } : null;
    };
    return {
      ...clone(offer),
      fromOwnerName:fromTeam?.ownerName ?? "未知玩家",
      fromTeamName:fromTeam?.name ?? "未知球队",
      toOwnerName:toTeam?.ownerName ?? "未知玩家",
      toTeamName:toTeam?.name ?? "未知球队",
      offeredCards:offer.offeredCardIds.map(decorate).filter(Boolean),
      requestedCards:offer.requestedCardIds.map(decorate).filter(Boolean),
    };
  }

  cardLockedByTrade(cardId, exceptOfferId = null) {
    return this.state.cardTradeOffers.some((offer) => offer.id !== exceptOfferId && offer.status === "pending" && offer.offeredCardIds.includes(cardId));
  }

  validateTradeCards(ownerId, cardIds, label, exceptOfferId = null, enforceTradeLock = true) {
    if (!cardIds.length) throw new Error(`${label}至少需要选择一张强化卡`);
    const cards = cardIds.map((id) => this.state.s4Assets.cards[id]);
    if (cards.some((card) => !card || card.status !== "active" || card.ownerId !== ownerId || Number(card.upgradeLevel ?? 0) < 1 && !isXPlayer(card.playerId))) throw new Error(`${label}包含无效或非强化球员卡`);
    if (cards.some((card) => this.state.listings.some((item) => item.status === "active" && (item.cardId === card.id || item.kind === "ownership" && item.playerId === card.playerId)))) throw new Error(`${label}包含已挂牌资产`);
    if (enforceTradeLock && cards.some((card) => this.cardLockedByTrade(card.id, exceptOfferId))) throw new Error(`${label}包含其他交易中的球员卡`);
    const selectedByPlayer = new Map();
    cards.forEach((card) => selectedByPlayer.set(card.playerId, (selectedByPlayer.get(card.playerId) ?? 0) + 1));
    selectedByPlayer.forEach((count, playerId) => {
      if (isXPlayer(playerId)) return;
      if (ownershipOwner(this.state, playerId) === ownerId && count >= this.playerCards(ownerId, playerId).length) throw new Error(`${REAL_PLAYER_BY_ID[playerId].name}必须保留至少一张所有权锚点卡`);
    });
    return cards;
  }

  validateCardTradeResult(offer) {
    const temporary = clone(this.state);
    offer.offeredCardIds.forEach((cardId) => transferS4Card(temporary, cardId, offer.toOwnerId, "player-card-trade", this.now()));
    offer.requestedCardIds.forEach((cardId) => transferS4Card(temporary, cardId, offer.fromOwnerId, "player-card-trade", this.now()));
    if (offer.xTrade) {
      const offeredPlayerId = temporary.s4Assets.cards[offer.offeredCardIds[0]].playerId;
      const requestedPlayerId = temporary.s4Assets.cards[offer.requestedCardIds[0]].playerId;
      temporary.xPlayers.assignments[offeredPlayerId] = offer.toOwnerId;
      temporary.xPlayers.assignments[requestedPlayerId] = offer.fromOwnerId;
      temporary.s4Assets.ownerships[offeredPlayerId] = offer.toOwnerId;
      temporary.s4Assets.ownerships[requestedPlayerId] = offer.fromOwnerId;
    }
    [offer.fromOwnerId, offer.toOwnerId].forEach((ownerId) => {
      const team = temporary.teams.find((entry) => entry.ownerId === ownerId);
      team.rosterIds = [...new Set(cardsForOwner(temporary, ownerId).map((card) => card.playerId))];
      team.preferredStarterIds = team.preferredStarterIds.filter((playerId) => team.rosterIds.includes(playerId));
    });
    assertS4AssetInvariants(temporary);
  }

  cardTradeSnapshot(cardIds) {
    return Object.fromEntries(cardIds.map((cardId) => {
      const card = this.state.s4Assets.cards[cardId];
      return [cardId, { ownerId:card.ownerId, upgradeLevel:Number(card.upgradeLevel ?? 0), traitIds:[...(card.traitIds ?? [])].sort() }];
    }));
  }

  cardTradeOwnershipSnapshot(cardIds) {
    return Object.fromEntries([...new Set(cardIds.map((cardId) => this.state.s4Assets.cards[cardId]?.playerId).filter(Boolean))]
      .map((playerId) => [playerId, ownershipOwner(this.state, playerId)]));
  }

  validateCardTradeSnapshots(offer) {
    [...offer.offeredCardIds, ...offer.requestedCardIds].forEach((cardId) => {
      const card = this.state.s4Assets.cards[cardId];
      const snapshot = offer.cardSnapshots?.[cardId];
      if (!card || card.status !== "active" || !snapshot || card.ownerId !== snapshot.ownerId || Number(card.upgradeLevel ?? 0) !== snapshot.upgradeLevel || JSON.stringify([...(card.traitIds ?? [])].sort()) !== JSON.stringify(snapshot.traitIds)) throw new Error("交易中的球员卡状态已经发生变化");
    });
    Object.entries(offer.ownershipSnapshots ?? {}).forEach(([playerId, ownerId]) => {
      if (ownershipOwner(this.state, playerId) !== ownerId) throw new Error(`${REAL_PLAYER_BY_ID[playerId]?.name ?? "球员"}的所有权状态已经发生变化`);
    });
  }

  failCardTradeOffer(offer, reason) {
    if (!offer || offer.status !== "pending") return false;
    const fromTeam = this.accountTeam(offer.fromOwnerId);
    const toTeam = this.accountTeam(offer.toOwnerId);
    offer.status = "failed";
    offer.failureReason = reason;
    offer.updatedAt = this.now();
    offer.resolvedAt = this.now();
    this.wallet(offer.fromOwnerId).balance += offer.coinAmount;
    if (offer.coinAmount) this.state.ledger.push({ id:makeId("ledger", `trade-failed-refund-${offer.id}`), accountId:offer.fromOwnerId, amount:offer.coinAmount, type:"card-trade-refund", tradeOfferId:offer.id, createdAt:this.now() });
    this.pushInbox(fromTeam, { id:`card-trade-failed:${offer.id}:sender`, type:"transfer", title:"球员卡交易未能完成", summary:"交易涉及的资产状态已经发生变化。", body:`交易已关闭${offer.coinAmount ? `，托管的${offer.coinAmount}金币已经退回。` : "。"} 原因：${reason}`, payload:{ tradeOfferId:offer.id } });
    this.pushInbox(toTeam, { id:`card-trade-failed:${offer.id}:receiver`, type:"transfer", title:"球员卡交易未能完成", summary:"交易涉及的资产状态已经发生变化。", body:`交易已关闭。原因：${reason}`, payload:{ tradeOfferId:offer.id } });
    return true;
  }

  createCardTradeOffer(account, targetOwnerIdValue, offeredCardIdsValue, requestedCardIdsValue, coinAmountValue = 0) {
    const fromTeam = this.accountTeam(account.id);
    const targetOwnerId = String(targetOwnerIdValue ?? "");
    const toTeam = this.accountTeam(targetOwnerId);
    const offeredCardIds = [...new Set((Array.isArray(offeredCardIdsValue) ? offeredCardIdsValue : []).map(String))];
    const requestedCardIds = [...new Set((Array.isArray(requestedCardIdsValue) ? requestedCardIdsValue : []).map(String))];
    const coinAmount = coinAmountValue === "" || coinAmountValue == null ? 0 : Number(coinAmountValue);
    if (!fromTeam || !toTeam || targetOwnerId === account.id) throw new Error("请选择其他真人玩家");
    if (!Number.isSafeInteger(coinAmount) || coinAmount < 0) throw new Error("附带金币必须是大于等于0的整数");
    const offeredX = offeredCardIds.map((id) => this.state.s4Assets.cards[id]).filter((card) => isXPlayer(card?.playerId));
    const requestedX = requestedCardIds.map((id) => this.state.s4Assets.cards[id]).filter((card) => isXPlayer(card?.playerId));
    const xTrade = offeredX.length || requestedX.length;
    if (xTrade && (offeredCardIds.length !== 1 || requestedCardIds.length !== 1 || offeredX.length !== 1 || requestedX.length !== 1 || coinAmount !== 0)) throw new Error("X级球员只能与另一名X级球员一换一，且不能附带金币或其他卡片");
    this.validateTradeCards(account.id, offeredCardIds, "己方报价");
    this.validateTradeCards(targetOwnerId, requestedCardIds, "对方报价");
    if (this.wallet(account.id).balance < coinAmount) throw new Error("金币不足，无法发起交易");
    const offer = {
      id:makeId("card-trade", `${account.id}-${targetOwnerId}`),
      fromOwnerId:account.id,
      toOwnerId:targetOwnerId,
      offeredCardIds,
      requestedCardIds,
      coinAmount,
      xTrade:Boolean(xTrade),
      cardSnapshots:this.cardTradeSnapshot([...offeredCardIds, ...requestedCardIds]),
      ownershipSnapshots:this.cardTradeOwnershipSnapshot([...offeredCardIds, ...requestedCardIds]),
      status:"pending",
      createdAt:this.now(),
      updatedAt:this.now(),
    };
    this.validateCardTradeResult(offer);
    this.wallet(account.id).balance -= coinAmount;
    if (coinAmount) this.state.ledger.push({ id:makeId("ledger", `trade-escrow-${offer.id}`), accountId:account.id, amount:-coinAmount, type:"card-trade-escrow", tradeOfferId:offer.id, createdAt:this.now() });
    this.state.cardTradeOffers.push(offer);
    this.pushInbox(toTeam, {
      id:`card-trade-offer:${offer.id}`,
      type:"trade-offer",
      title:`${fromTeam.ownerName}向你发起球员卡交易`,
      summary:`对方提供${offeredCardIds.length}张卡${coinAmount ? `及${coinAmount}金币` : ""}，希望交换你的${requestedCardIds.length}张卡。`,
      body:"请核对交易内容后选择接受或拒绝。交易处理前仅锁定发起方提供的卡片；你方卡片状态会在接受时重新检查。",
      payload:{ tradeOfferId:offer.id, tradeOffer:this.cardTradeOfferView(offer) },
    });
    this.save();
    return this.view(account);
  }

  resolveCardTradeOffer(account, offerIdValue, actionValue) {
    const offer = this.state.cardTradeOffers.find((entry) => entry.id === String(offerIdValue ?? ""));
    const action = String(actionValue ?? "");
    const fromTeam = this.accountTeam(offer?.fromOwnerId);
    const toTeam = this.accountTeam(offer?.toOwnerId);
    if (!offer || offer.status !== "pending" || offer.toOwnerId !== account.id || !["accept", "reject"].includes(action)) throw new Error("该交易报价已经无法处理");
    if (action === "reject") {
      offer.status = "rejected";
      offer.updatedAt = this.now();
      offer.resolvedAt = this.now();
      this.wallet(offer.fromOwnerId).balance += offer.coinAmount;
      if (offer.coinAmount) this.state.ledger.push({ id:makeId("ledger", `trade-refund-${offer.id}`), accountId:offer.fromOwnerId, amount:offer.coinAmount, type:"card-trade-refund", tradeOfferId:offer.id, createdAt:this.now() });
      this.pushInbox(fromTeam, { id:`card-trade-rejected:${offer.id}`, type:"transfer", title:"球员卡交易报价被拒绝", summary:`${toTeam.ownerName}拒绝了你的交易报价。`, body:`交易已关闭${offer.coinAmount ? `，托管的${offer.coinAmount}金币已经退回。` : "。"}`, payload:{ tradeOfferId:offer.id } });
    } else {
      try {
        this.validateCardTradeSnapshots(offer);
        this.validateTradeCards(offer.fromOwnerId, offer.offeredCardIds, "发起方报价", offer.id);
        this.validateTradeCards(offer.toOwnerId, offer.requestedCardIds, "接收方报价", offer.id);
        this.validateCardTradeResult(offer);
      } catch (error) {
        this.failCardTradeOffer(offer, error.message);
        this.save();
        return { ...this.view(account), cardTradeResult:{ tradeOfferId:offer.id, status:"failed", reason:error.message, refundedCoins:offer.coinAmount } };
      }
      offer.offeredCardIds.forEach((cardId) => transferS4Card(this.state, cardId, offer.toOwnerId, "player-card-trade", this.now()));
      offer.requestedCardIds.forEach((cardId) => transferS4Card(this.state, cardId, offer.fromOwnerId, "player-card-trade", this.now()));
      if (offer.xTrade) {
        const offeredPlayerId = this.state.s4Assets.cards[offer.offeredCardIds[0]].playerId;
        const requestedPlayerId = this.state.s4Assets.cards[offer.requestedCardIds[0]].playerId;
        this.state.xPlayers.assignments[offeredPlayerId] = offer.toOwnerId;
        this.state.xPlayers.assignments[requestedPlayerId] = offer.fromOwnerId;
        this.state.s4Assets.ownerships[offeredPlayerId] = offer.toOwnerId;
        this.state.s4Assets.ownerships[requestedPlayerId] = offer.fromOwnerId;
      }
      [fromTeam, toTeam].forEach((team) => {
        team.rosterIds = [...new Set(this.playerCards(team.ownerId).map((card) => card.playerId))];
        team.preferredStarterIds = team.preferredStarterIds.filter((playerId) => team.rosterIds.includes(playerId));
      });
      this.wallet(offer.toOwnerId).balance += offer.coinAmount;
      if (offer.coinAmount) this.state.ledger.push({ id:makeId("ledger", `trade-settlement-${offer.id}`), accountId:offer.toOwnerId, amount:offer.coinAmount, type:"card-trade-settlement", tradeOfferId:offer.id, createdAt:this.now() });
      [...offer.offeredCardIds, ...offer.requestedCardIds].forEach((cardId) => {
        const card = this.state.s4Assets.cards[cardId];
        recordS4AssetTransaction(this.state, { id:makeId("asset-card-trade", `${offer.id}-${cardId}`), type:"player-card-trade", playerId:card.playerId, cardIds:[cardId], fromOwnerId:card.previousOwnerId, toOwnerId:card.ownerId, amount:0, metadata:{ tradeOfferId:offer.id }, createdAt:this.now() });
      });
      offer.status = "accepted";
      offer.updatedAt = this.now();
      offer.resolvedAt = this.now();
      const publicOffer = this.cardTradeOfferView(offer);
      const importantCards = [...publicOffer.offeredCards, ...publicOffer.requestedCards]
        .filter((entry) => entry.player.xPlayer || Number(entry.card.upgradeLevel ?? 0) >= 5);
      this.pushInbox(fromTeam, { id:`card-trade-accepted:${offer.id}`, type:importantCards.length ? "trade-result" : "transfer", title:"球员卡交易已经达成", summary:`${toTeam.ownerName}接受了你的交易报价。`, body:`双方球员卡已经完成交换${offer.coinAmount ? `，${offer.coinAmount}金币已支付给对方。` : "。"}`, payload:{ tradeOfferId:offer.id, ...(importantCards.length ? { tradeOffer:publicOffer } : {}) } });
      if (importantCards.length) {
        const importantNames = importantCards.map((entry) => `${entry.player.name} +${entry.card.upgradeLevel}`).join("、");
        const publicReason = offer.xTrade ? "本次成交涉及全服唯一的X级球员" : "本次成交涉及+5及以上球员卡";
        this.pushInbox(toTeam, {
          id:`card-trade-accepted:${offer.id}:receiver`, type:"trade-result", title:"重要球员卡交易已经达成",
          summary:`你与${fromTeam.ownerName}完成交易，涉及${importantNames}。`, body:`${publicReason}，完整交易结果已记录并通知双方。`,
          payload:{ tradeOfferId:offer.id, tradeOffer:publicOffer },
        });
        this.state.teams
          .filter((team) => team.ownerId && team.ownerId !== offer.fromOwnerId && team.ownerId !== offer.toOwnerId)
          .forEach((team) => this.pushInbox(team, {
            id:`card-trade-public:${offer.id}:${team.ownerId}`,
            type:"trade-public",
            title:"重要球员卡转会公示",
            summary:`${publicOffer.fromOwnerName}与${publicOffer.toOwnerName}完成交易，涉及${importantNames}。`,
            body:`${publicReason}，现向全服公示交易双方、球员卡与金币信息。`,
            payload:{ tradeOfferId:offer.id, tradeOffer:publicOffer },
          }));
      }
      const settledCardIds = new Set([...offer.offeredCardIds, ...offer.requestedCardIds]);
      this.state.cardTradeOffers.forEach((otherOffer) => {
        if (otherOffer.id === offer.id || otherOffer.status !== "pending") return;
        const overlaps = [...otherOffer.offeredCardIds, ...otherOffer.requestedCardIds].some((cardId) => settledCardIds.has(cardId));
        if (overlaps) this.failCardTradeOffer(otherOffer, "相关球员卡已通过另一笔交易完成转移");
      });
    }
    this.save();
    return { ...this.view(account), cardTradeResult:{ tradeOfferId:offer.id, status:offer.status, refundedCoins:action === "reject" ? offer.coinAmount : 0 } };
  }

  withdrawCardTradeOffer(account, offerIdValue) {
    const offer = this.state.cardTradeOffers.find((entry) => entry.id === String(offerIdValue ?? ""));
    if (!offer || offer.status !== "pending" || offer.fromOwnerId !== account.id) throw new Error("该交易报价无法撤回");
    const fromTeam = this.accountTeam(offer.fromOwnerId);
    const toTeam = this.accountTeam(offer.toOwnerId);
    offer.status = "withdrawn";
    offer.updatedAt = this.now();
    offer.resolvedAt = this.now();
    this.wallet(offer.fromOwnerId).balance += offer.coinAmount;
    if (offer.coinAmount) this.state.ledger.push({ id:makeId("ledger", `trade-withdraw-refund-${offer.id}`), accountId:offer.fromOwnerId, amount:offer.coinAmount, type:"card-trade-refund", tradeOfferId:offer.id, createdAt:this.now() });
    this.pushInbox(toTeam, { id:`card-trade-withdrawn:${offer.id}`, type:"transfer", title:"球员卡交易报价已撤回", summary:`${fromTeam.ownerName}撤回了此前的交易报价。`, body:"该报价已经关闭，对应球员卡已解除锁定。", payload:{ tradeOfferId:offer.id } });
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

  ownershipReturnPlan(account, playerId) {
    const team = this.accountTeam(account.id);
    const player = REAL_PLAYER_BY_ID[playerId];
    const cards = this.playerCards(account.id, playerId);
    if (!team || !player || ownershipOwner(this.state, playerId) !== account.id || !cards.length) throw new Error("你不拥有该球员所有权");
    if (isXPlayer(player)) throw new Error("X级球员不可回收或解约");
    if (cards.some((card) => this.cardLockedByTrade(card.id))) throw new Error("该球员存在正在处理的球员卡交易报价");
    if (this.state.listings.some((item) => item.status === "active" && item.playerId === playerId)) throw new Error("请先撤回该球员的全部挂牌");
    const highestLevel = Math.max(...cards.map((card) => Number(card.upgradeLevel ?? 0)));
    const retained = highestLevel > 0 ? cards.filter((card) => Number(card.upgradeLevel ?? 0) === highestLevel) : [];
    const retainedIds = new Set(retained.map((card) => card.id));
    const recovered = cards.filter((card) => !retainedIds.has(card.id));
    const recoveryAmount = recovered.reduce((sum, card) => sum + s4ForcedCardRecoveryValue(player, card.upgradeLevel), 0);
    const ownershipAmount = Math.floor(s4OwnershipReferenceValue(player) * S4_OWNERSHIP_RETURN_RATE);
    return { team, player, playerId, retained, recovered, recoveryAmount, ownershipAmount, amount:recoveryAmount + ownershipAmount };
  }

  returnOwnerships(account, playerIdsValue) {
    const playerIds = [...new Set((Array.isArray(playerIdsValue) ? playerIdsValue : [playerIdsValue]).map(String).filter(Boolean))];
    if (!playerIds.length) throw new Error("请至少选择一名需要回收所有权的球员");
    const plans = playerIds.map((playerId) => this.ownershipReturnPlan(account, playerId));
    const team = plans[0].team;
    const removedFamilies = plans.filter((plan) => !plan.retained.length).length;
    if (team.rosterIds.length - removedFamilies < 11) throw new Error("不能批量回收这些球员所有权，球队必须保留至少11名可用球员");
    plans.forEach(({ player, playerId, retained, recovered, recoveryAmount, ownershipAmount, amount }) => {
      recovered.forEach((card) => recycleS4Card(this.state, card.id, "ownership-return-liquidation", this.now()));
      returnPlayerOwnershipToSystem(this.state, playerId, account.id);
      this.removeEmptyRosterFamily(team, playerId);
      this.wallet(account.id).balance += amount;
      this.state.ledger.push({ id:makeId("ledger", `ownership-return-${playerId}`), accountId:account.id, amount, type:"ownership-return", playerId, retainedCardIds:retained.map((card) => card.id), recoveredCardIds:recovered.map((card) => card.id), createdAt:this.now() });
      recordS4AssetTransaction(this.state, {
        id:makeId("asset-ownership-return", playerId),
        type:"ownership-return",
        playerId,
        cardIds:recovered.map((card) => card.id),
        fromOwnerId:account.id,
        amount,
        metadata:{ recoveryAmount, ownershipAmount, retainedCardIds:retained.map((card) => card.id) },
        createdAt:this.now(),
      });
    });
    this.save();
    return {
      ...this.view(account),
      ownershipRecoveryResult:{
        playerCount:plans.length,
        recoveredCardCount:plans.reduce((sum, plan) => sum + plan.recovered.length, 0),
        amount:plans.reduce((sum, plan) => sum + plan.amount, 0),
      },
    };
  }

  returnOwnership(account, playerId) {
    return this.returnOwnerships(account, [playerId]);
  }
  buyListing(account, listingId, options = {}) {
    const buyer = this.accountTeam(account.id);
    const listing = this.state.listings.find((item) => item.id === listingId && item.status === "active");
    if (!buyer || !listing || listing.sellerId === account.id) throw new Error("当前无法购买这名球员");
    const seller = this.state.teams.find((team) => team.id === listing.sellerTeamId && team.ownerId === listing.sellerId);
    if (!seller?.rosterIds.includes(listing.playerId)) throw new Error("卖方已不再持有这名球员");
    if (this.wallet(account.id).balance < listing.price) throw new Error("金币不足");
    const player = REAL_PLAYER_BY_ID[listing.playerId];
    let transferredCard = null;
    let recoveredCards = [];
    let retainedCards = [];
    let recoveryAmount = 0;
    let ownershipTransferred = false;
    let buyerHadCards = false;

    if (listing.kind === "ownership") {
      if (ownershipOwner(this.state, listing.playerId) !== listing.sellerId) throw new Error("卖方已不再拥有该球员所有权");
      const sellerCards = this.playerCards(listing.sellerId, listing.playerId);
      const buyerCards = this.playerCards(account.id, listing.playerId);
      buyerHadCards = buyerCards.length > 0;
      if (!sellerCards.length) throw new Error("卖方所有权缺少锚点卡");
      const buyerAlreadyUsesSlot = rosterFamilyUsesSlot(this.state, account.id, listing.playerId);
      if (!buyerAlreadyUsesSlot && this.rosterSlotsUsed(account.id) >= CLUB_ROSTER_LIMIT) throw new Error("33人名单已满，无法接收该球员所有权");
      const highestLevel = Math.max(...sellerCards.map((card) => Number(card.upgradeLevel ?? 0)));
      retainedCards = highestLevel > 0
        ? sellerCards.filter((card) => Number(card.upgradeLevel ?? 0) === highestLevel)
        : [];
      if (!buyerCards.length) {
        transferredCard = createS4Card(this.state, {
          playerId:listing.playerId,
          ownerId:account.id,
          upgradeLevel:0,
          acquisitionSource:listing.channel === "direct-trade" ? "direct-ownership-anchor" : "market-ownership-anchor",
          externalAcquisition:true,
          acquiredAt:this.now(),
        });
        this.ensureRosterFamily(buyer, listing.playerId);
      }
      recoveredCards = sellerCards.filter((card) => !retainedCards.some((retained) => retained.id === card.id));
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
      const willUseSlot = !isS4Legend(player) && (includesOwnership || Number(card.upgradeLevel ?? 0) < 5);
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
    const saleIncome = Math.floor(listing.price * (1 - S4_ECONOMY.marketFeeRate));
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
    const isOwnershipListing = listing.kind === "ownership";
    const cardLevel = Number(transferredCard?.upgradeLevel ?? 0);
    const buyerAssetText = isOwnershipListing
      ? buyerHadCards
        ? `你原有的${player.name}球员卡现已绑定该球员所有权，未新增球员卡。`
        : `系统已向你发放一张+0 ${player.name}基础锚点卡，用于绑定该球员所有权。`
      : `+${cardLevel} ${player.name}球员卡已经进入你的背包。`;
    const buyerOwnershipText = ownershipTransferred
      ? `你现在拥有${player.name}的球员所有权，私有池归属已同步转移到你的球队。`
      : `本次只交易单卡，${player.name}的球员所有权和私有池归属没有改变。`;
    const buyerSlotText = rosterFamilyUsesSlot(this.state, account.id, listing.playerId)
      ? "该球员当前占用1个33人大名单名额。"
      : "该球员当前不占用33人大名单名额。";
    const retainedLevel = retainedCards.length ? Number(retainedCards[0].upgradeLevel ?? 0) : null;
    const sellerRetentionText = isOwnershipListing
      ? retainedCards.length
        ? `你保留了${retainedCards.length}张最高等级+${retainedLevel}球员卡。${recoveredCards.length ? `其余${recoveredCards.length}张低等级卡已由系统回收，获得${recoveryAmount}金币补偿。` : "本次没有低等级卡需要回收，回收补偿为0金币。"}`
        : `你没有强化过的${player.name}球员卡，原有${recoveredCards.length}张+0基础锚点卡已由系统回收，获得${recoveryAmount}金币补偿。`
      : ownershipTransferred
        ? `这是你持有的最后一张${player.name}球员卡，因此卡片与所有权一并转移。`
        : `本次仅出售一张+${cardLevel}球员卡，你仍保有${player.name}的其他资产${player.pool === "LEGEND" ? "。" : "及球员所有权。"}`;
    const sellerOwnershipText = ownershipTransferred
      ? `${player.name}的球员所有权和私有池归属现已转移至${buyer.name}，你无法再通过原私有池获得同名卡。`
      : `${player.name}的球员所有权和私有池归属没有改变。`;
    const sellerSlotText = this.playerCards(listing.sellerId, listing.playerId).length
      ? rosterFamilyUsesSlot(this.state, listing.sellerId, listing.playerId)
        ? `你保留的${player.name}球员卡当前占用1个33人大名单名额。`
        : `你保留的${player.name}球员卡均为+5以上，当前不占用33人大名单名额。`
      : `你的球队已不再持有${player.name}球员卡。`;
    const mailPayload = {
      listingId:listing.id,
      listingKind:listing.kind,
      playerId:listing.playerId,
      playerName:player.name,
      price:listing.price,
      fee:listing.price - saleIncome,
      saleIncome,
      recoveryAmount,
      totalSellerIncome:saleIncome + recoveryAmount,
      ownershipTransferred,
      transferredCardId:transferredCard?.id ?? null,
      transferredCardLevel:transferredCard ? cardLevel : null,
      buyerReceivedSystemAnchor:isOwnershipListing && !buyerHadCards,
      retainedCardCount:retainedCards.length,
      retainedUpgradeLevel:retainedLevel,
      recoveredCardCount:recoveredCards.length,
    };
    this.pushInbox(buyer, {
      id:`transfer-buy:${listing.id}`,
      type:"transfer",
      title:`${player.name} 购买成功`,
      summary:`支付${listing.price}金币，${isOwnershipListing ? "球员所有权" : `+${cardLevel}单卡${ownershipTransferred ? "及所有权" : ""}`}已完成交割。`,
      body:`交易对方：${seller.name}。${buyerAssetText}${buyerOwnershipText}${buyerSlotText}`,
      payload:{ ...mailPayload, counterpartyId:listing.sellerId, counterpartyName:seller.name, perspective:"buyer" },
    });
    this.pushInbox(seller, {
      id:`transfer-sale:${listing.id}`,
      type:"transfer",
      title:`${player.name} 出售成功`,
      summary:`成交价${listing.price}金币，扣除${listing.price - saleIncome}金币手续费${recoveryAmount ? `并加上${recoveryAmount}金币回收补偿` : ""}，实际到账${saleIncome + recoveryAmount}金币。`,
      body:`买方：${buyer.name}。${sellerRetentionText}${sellerOwnershipText}${sellerSlotText}`,
      payload:{ ...mailPayload, counterpartyId:account.id, counterpartyName:buyer.name, perspective:"seller" },
    });
    this.save();
    if (options.compact) return this.compactMutationView(account, { ownTeam:true, listings:true, extra:{ marketPurchase:{ listingId:listing.id, ownershipTransferred, transferredCardId:transferredCard?.id ?? null, sellerId:listing.sellerId, price:listing.price } } });
    return this.view(account);
  }

  selectActualLineup(team, roundNumber, competition = "league") {
    const humanOwned = this.ownedPlayerIds();
    if (!team.ownerId) return { lineup:aiLineup(this.state.teams.indexOf(team), roundNumber, humanOwned), rotations:[] };
    const desired = team.preferredStarterIds.filter((id) => team.rosterIds.includes(id));
    const threshold = Number(team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD);
    const effectiveFitness = (id) => {
      const fixedFitness = fixedFitnessFromTraitIds(this.representativeCard(team.ownerId, id)?.traitIds);
      if (fixedFitness != null) return fixedFitness;
      return competition === "friendly" ? 100 : Number(team.playerState[id]?.fitness ?? 100);
    };
    const hardAvailable = (id) => {
      const state = team.playerState[id] ?? {};
      if (competition === "friendly") return Number(state.injuryRounds ?? 0) <= 0;
      const suspension = competition === "cup" ? Number(state.cupSuspension ?? 0) : Number(state.suspension ?? 0);
      return suspension <= 0 && Number(state.injuryRounds ?? 0) <= 0 && effectiveFitness(id) >= 45;
    };
    const assignedRoles = inferElevenBoardRoles(desired.map((id) => ({ id, position:team.positions[id] })));
    const selected = [];
    const rotations = [];
    const bench = team.rosterIds.filter((id) => !desired.includes(id) && hardAvailable(id));
    const takeReplacement = (starterId, requireFresh) => {
      const assignedRole = assignedRoles[starterId] ?? REAL_PLAYER_BY_ID[starterId]?.role;
      const candidates = bench
        .filter((id) => !requireFresh || effectiveFitness(id) > threshold)
        .map((id) => REAL_PLAYER_BY_ID[id])
        .filter((player) => player && (!requireFresh || playerRoleFit(player, assignedRole) >= 2))
        .sort((left, right) => playerRoleFit(right, assignedRole) - playerRoleFit(left, assignedRole)
          || effectiveFitness(right.id) - effectiveFitness(left.id)
          || right.overall - left.overall)[0];
      if (!candidates) return null;
      bench.splice(bench.indexOf(candidates.id), 1);
      return candidates.id;
    };
    for (const starterId of desired) {
      const state = team.playerState[starterId] ?? {};
      const fitness = effectiveFitness(starterId);
      const forcedOut = !hardAvailable(starterId);
      const atRedLine = competition !== "friendly" && !forcedOut && fitness <= threshold;
      const substitute = forcedOut ? takeReplacement(starterId, false) : atRedLine ? takeReplacement(starterId, true) : null;
      if (substitute) {
        selected.push(substitute);
        rotations.push({ outId:starterId, outName:REAL_PLAYER_BY_ID[starterId]?.name, inId:substitute, inName:REAL_PLAYER_BY_ID[substitute]?.name, reason:forcedOut ? ((competition === "cup" ? Number(state.cupSuspension ?? 0) : Number(state.suspension ?? 0)) > 0 ? "停赛" : Number(state.injuryRounds ?? 0) > 0 ? "伤缺" : "体能不足45") : `体能${Math.round(fitness)}达到红线${threshold}` });
      } else if (!forcedOut) selected.push(starterId);
    }
    while (selected.length < 11 && bench.length) selected.push(bench.shift());
    return {
      lineup:selected.slice(0,11).map((id) => ({ ...REAL_PLAYER_BY_ID[id], state:{ ...REAL_PLAYER_BY_ID[id].state, fitness:effectiveFitness(id) } })),
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
        ...applyS4Enhancement(player, card?.upgradeLevel ?? 0),
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
    const chemistryLineup = lineupWithCards.map((player) => {
      const values = valuesByPlayer.get(player.id) ?? [];
      if (!values.length) return { ...player, ydlBondBaseAttributes:clone(player.attributes) };
      const chemistry = values.reduce((sum, value) => sum + value, 0) / values.length;
      const bonus = Math.min(CHEMISTRY_MAX_BONUS, chemistry / 100 * CHEMISTRY_MAX_BONUS);
      const attributes = Object.fromEntries(Object.entries(player.attributes).map(([key, value]) => [key, Number.isFinite(value) ? Math.min(99, Number((value * (1 + bonus)).toFixed(2))) : value]));
      return {
        ...player,
        attributes,
        ydlBondBaseAttributes:clone(attributes),
        leagueChemistryBonus:Number(bonus.toFixed(4)),
      };
    });
    const roles = inferElevenBoardRoles(chemistryLineup.map((player) => ({ id:player.id, position:positions[player.id] })));
    const bonds = evaluateS4LineupBonds(chemistryLineup, S4_BOND_CATALOG, { roles });
    return applyS4BondBonuses(chemistryLineup, bonds);
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
    const formationLinePresets = teams.map((team) => Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, sanitizeFormationLines(team.formationLinePresets?.[key])])));
    const positions = teams.map((team, index) => {
      const openingPreset = team.tacticalPlans?.opening?.positionPreset ?? "position1";
      return clone(positionPresets[index][openingPreset] ?? positionPresets[index].position1);
    });
    const seats = teams.map((team, index) => ({ name:team.name, players:this.chemistryAdjustedLineup(team, lineups[index], positions[index]), positions:positions[index], positionPresets:positionPresets[index], formationLinePresets:formationLinePresets[index], tactic:team.tacticalPlans?.opening?.tactic ?? team.tactic, style:team.tacticalPlans?.opening?.style ?? team.style, tacticalPlans:unwrapTracked(team.tacticalPlans), bondCatalog:S4_BOND_CATALOG, attackFocus:team.attackFocus, defenseFocus:team.defenseFocus, preserveFitness:true }));
    const conditions = this.fixtureConditions(fixture, roundNumber);
    const competitionMode = options.competitionMode ?? "league";
    const matchEngine = options.matchEngine ?? MATCH_ENGINE_BY_COMPETITION[competitionMode] ?? DEFAULT_MATCH_ENGINE;
    const match = createLeagueMatch(unwrapTracked(seats), { now:startedAt, seed:options.seed ?? this.fixtureSeed(fixture, roundNumber), weather:conditions.weather.key, referee:conditions.referee.key, regulationOnly:options.regulationOnly ?? true, competitionMode, legNumber:options.legNumber ?? 1, aggregateBaseScore:options.aggregateBaseScore ?? null, recordEvents:options.recordEvents ?? this.recordMatchEvents !== false, matchEngine });
    match.leagueAutoRotations = selections.map((selection) => selection.rotations);
    return { home, away, match, startedAt };
  }

  friendlyInvitationView(invitation) {
    const fromTeam = this.state.teams.find((team) => team.id === invitation.fromTeamId);
    const toTeam = this.state.teams.find((team) => team.id === invitation.toTeamId);
    const expiresAt = this.friendlyInvitationExpiresAt(invitation);
    const status = invitation.status === "pending" && this.now() >= expiresAt ? "expired" : invitation.status;
    return { ...clone(invitation), expiresAt, status, fromTeamName:fromTeam?.name ?? "未知球队", fromOwnerName:fromTeam?.ownerName ?? "未知玩家", toTeamName:toTeam?.name ?? "未知球队", toOwnerName:toTeam?.ownerName ?? "未知玩家" };
  }

  friendlyInvitationExpiresAt(invitation) {
    const expiresAt = Number(invitation?.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt > 0) return expiresAt;
    const createdAt = Number(invitation?.createdAt);
    return (Number.isFinite(createdAt) && createdAt > 0 ? createdAt : this.now()) + FRIENDLY_INVITATION_TTL_MS;
  }

  expireFriendlyInvitations(now = this.now()) {
    let changed = false;
    this.state.friendlyInvitations.forEach((invitation) => {
      const expiresAt = this.friendlyInvitationExpiresAt(invitation);
      if (invitation.expiresAt !== expiresAt) {
        invitation.expiresAt = expiresAt;
        changed = true;
      }
      if (invitation.status !== "pending" || now < expiresAt) return;
      invitation.status = "expired";
      invitation.updatedAt = now;
      invitation.resolvedAt = now;
      changed = true;
    });
    return changed;
  }

  friendlyInvitationMutationView(account) {
    const team = this.accountTeam(account.id);
    return clone({
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      friendlyInvitations:this.state.friendlyInvitations.filter((item) => item.fromOwnerId === account.id || item.toOwnerId === account.id).map((item) => this.friendlyInvitationView(item)),
      inboxUnreadCount:team ? (this.state.inbox[team.id] ?? []).filter((message) => !message.readAt).length : 0,
    });
  }

  createFriendlyInvitation(account, targetTeamIdValue, options = {}) {
    const fromTeam = this.accountTeam(account.id);
    const toTeam = this.state.teams.find((team) => team.id === String(targetTeamIdValue ?? ""));
    if (!fromTeam || !toTeam || !toTeam.ownerId || toTeam.id === fromTeam.id) throw new Error("只能向其他真人玩家球队发起友谊赛");
    const now = this.now();
    this.expireFriendlyInvitations(now);
    if (this.state.friendlyInvitations.some((item) => item.status === "pending" && item.fromTeamId === fromTeam.id && item.toTeamId === toTeam.id)) throw new Error("你已经向该玩家发出过待处理的友谊赛邀请");
    const invitation = { id:makeId("friendly-invite", `${fromTeam.id}-${toTeam.id}`), fromTeamId:fromTeam.id, fromOwnerId:fromTeam.ownerId, toTeamId:toTeam.id, toOwnerId:toTeam.ownerId, status:"pending", createdAt:now, updatedAt:now, expiresAt:now + FRIENDLY_INVITATION_TTL_MS };
    this.state.friendlyInvitations.push(invitation);
    this.pushInbox(toTeam, { id:`friendly-invite:${invitation.id}`, type:"friendly-invite", title:`${fromTeam.ownerName}邀请你进行友谊赛`, summary:`${fromTeam.name}向${toTeam.name}发起了一场友谊赛邀请。`, body:"邀请在发出后两小时内有效。接受后，比赛会自动安排到最近的友谊赛时间并接入日程表和电视台直播。", payload:{ friendlyInvitationId:invitation.id } });
    this.save({ skipDailyBackup:true });
    return options.compact ? this.friendlyInvitationMutationView(account) : this.view(account);
  }

  nextAvailableFriendlySlot(teamIds) {
    let startsAt = nextFriendlySlot(this.now());
    while (this.state.friendlyFixtures.some((fixture) => fixture.status !== "complete" && fixture.startsAt === startsAt && teamIds.some((teamId) => [fixture.homeId, fixture.awayId].includes(teamId)))) startsAt += 10 * 60 * 1000;
    return startsAt;
  }

  resolveFriendlyInvitation(account, invitationIdValue, actionValue) {
    const invitation = this.state.friendlyInvitations.find((item) => item.id === String(invitationIdValue ?? ""));
    const action = String(actionValue ?? "");
    const now = this.now();
    if (invitation?.status === "pending" && now >= this.friendlyInvitationExpiresAt(invitation)) {
      this.expireFriendlyInvitations(now);
      this.save({ skipDailyBackup:true });
      throw new Error("该友谊赛邀请已超过两小时，无法处理");
    }
    if (!invitation || invitation.status !== "pending" || invitation.toOwnerId !== account.id || !["accept", "reject"].includes(action)) throw new Error("该友谊赛邀请已经无法处理");
    const fromTeam = this.state.teams.find((team) => team.id === invitation.fromTeamId);
    const toTeam = this.state.teams.find((team) => team.id === invitation.toTeamId);
    invitation.status = action === "accept" ? "accepted" : "rejected";
    invitation.updatedAt = now;
    invitation.resolvedAt = now;
    if (action === "reject") {
      this.pushInbox(fromTeam, { id:`friendly-rejected:${invitation.id}`, type:"friendly", title:"友谊赛邀请被拒绝", summary:`${toTeam.ownerName}拒绝了你的友谊赛邀请。`, body:"本次邀请已经关闭，你可以稍后再次发起。", payload:{ friendlyInvitationId:invitation.id } });
    } else {
      const startsAt = this.nextAvailableFriendlySlot([fromTeam.id, toTeam.id]);
      const fixture = { id:makeId("friendly", invitation.id), invitationId:invitation.id, homeId:fromTeam.id, awayId:toTeam.id, startsAt, status:"scheduled", createdAt:this.now(), matchId:null, broadcastCode:null };
      this.state.friendlyFixtures.push(fixture);
      invitation.fixtureId = fixture.id;
      const timeText = new Date(startsAt).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false });
      this.state.teams.filter((team) => team.ownerId).forEach((team) => {
        const participant = [fromTeam.id, toTeam.id].includes(team.id);
        this.pushInbox(team, { id:`friendly-scheduled:${fixture.id}:${team.id}`, type:"friendly", title:participant ? "友谊赛已经排定" : "全服友谊赛直播预告", summary:`${fromTeam.name} vs ${toTeam.name}，${timeText}开赛。`, body:participant ? "比赛将以100体力开赛，不消耗体力且红黄牌不计入正式赛事；受伤仍会正常形成伤停。" : "比赛开始后欢迎前往电视台观看直播。", payload:{ friendlyFixtureId:fixture.id, startsAt, homeTeamId:fromTeam.id, awayTeamId:toTeam.id } });
      });
    }
    this.save();
    return this.view(account);
  }

  startScheduledFriendlies(now = this.now()) {
    let changed = false;
    this.state.friendlyFixtures.filter((fixture) => fixture.status === "scheduled" && fixture.startsAt <= now).forEach((fixture) => {
      const created = this.createFixtureMatch(fixture, Math.max(1, this.state.season.currentRound + 1), fixture.startsAt, { competitionMode:"friendly", seed:`${this.state.season.id}:${fixture.id}` });
      const live = { code:`YDL-FRIENDLY-${fixture.id}`, fixtureId:fixture.id, round:"友谊赛", match:created.match, spectators:{}, startedAt:fixture.startsAt, completed:false };
      fixture.status = "live";
      fixture.broadcastCode = live.code;
      this.state.liveFriendlies.push(live);
      changed = true;
    });
    return changed;
  }

  finalizeFriendlyFixture(fixture, match) {
    const home = this.state.teams.find((team) => team.id === fixture.homeId);
    const away = this.state.teams.find((team) => team.id === fixture.awayId);
    const report = match.report;
    const id = `${this.state.season.id}-FRIENDLY-${fixture.id}`;
    const record = { id, competition:"friendly", round:0, playedAt:this.now(), homeId:home.id, awayId:away.id, homeName:home.name, awayName:away.name, score:[...report.score], formations:report.teams.map((team) => team.formation), report };
    this.state.matches.push(record);
    fixture.status = "complete";
    fixture.matchId = id;
    fixture.completedAt = this.now();
    fixture.score = [...report.score];
    [home, away].forEach((team, index) => report.teams[index].players.forEach((player) => {
      if (!player.injury || !team.playerState[player.id]) return;
      team.playerState[player.id].injuryRounds = Math.max(Number(team.playerState[player.id].injuryRounds ?? 0), 1 + (this.state.season.currentRound % 3));
    }));
    return record;
  }

  liveAdvanceBatch(entries, key, maximumMatches = Infinity) {
    const pending = entries.filter((entry) => !entry.completed);
    if (!pending.length || Number(maximumMatches) <= 0) return [];
    if (!Number.isFinite(Number(maximumMatches)) || Number(maximumMatches) >= pending.length) return pending;
    const count = Math.max(1, Math.min(pending.length, Math.floor(Number(maximumMatches))));
    const start = Number(this.liveAdvanceCursors[key] ?? 0) % pending.length;
    const selected = Array.from({ length:count }, (_, index) => pending[(start + index) % pending.length]);
    this.liveAdvanceCursors[key] = (start + count) % pending.length;
    return selected;
  }

  advanceLiveFriendlies(now = this.now(), options = {}) {
    let changed = this.startScheduledFriendlies(now);
    let advanced = false;
    const completedCodes = [];
    this.liveAdvanceBatch(this.state.liveFriendlies, "friendly", options.maximumMatches).forEach((live) => {
      advanceLeagueMatch(live.match, now, { maximumChains:options.maximumChainsPerMatch });
      advanced = true;
      if (!live.match.report) {
        if (options.persist !== false) this.persistLiveMatch(live, now);
        return;
      }
      const fixture = this.state.friendlyFixtures.find((item) => item.id === live.fixtureId);
      this.finalizeFriendlyFixture(fixture, live.match);
      live.completed = true;
      this.state.completedBroadcasts.push({ code:live.code, round:"友谊赛", matchId:fixture.matchId, completedAt:this.now(), spectators:clone(live.spectators ?? {}), match:publicLeagueMatch(live.match, this.now(), null, true), competition:"YDL友谊赛" });
      completedCodes.push(live.code);
      changed = true;
    });
    if (changed) {
      this.state.liveFriendlies = this.state.liveFriendlies.filter((live) => !live.completed);
      if (!this.scheduleLiveSettlementSave(completedCodes)) this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    }
    return changed || advanced;
  }

  finalizeFixture(fixture, roundNumber, match) {
    const home = this.state.teams.find((team) => team.id === fixture.homeId);
    const away = this.state.teams.find((team) => team.id === fixture.awayId);
    const report = match.report;
    const id = `${this.state.season.id}-R${roundNumber}-${home.id}-${away.id}`;
    const record = { id, round:roundNumber, playedAt:this.now(), homeId:home.id, awayId:away.id, homeName:home.name, awayName:away.name, score:[...report.score], formations:report.teams.map((team) => team.formation), autoRotations:clone(match.leagueAutoRotations ?? [[], []]), report };
    this.state.matches.push(record);
    fixture.matchId = id;
    this.settleMatchPrediction("league", `R${roundNumber}`, fixture, record);
    [home, away].forEach((team, index) => {
      const playedPlayerIds = new Set(report.teams[index].players.map((player) => player.id));
      const own = report.score[index]; const against = report.score[index === 0 ? 1 : 0];
      team.table.played += 1; team.table.goalsFor += own; team.table.goalsAgainst += against;
      if (own > against) { team.table.won += 1; team.table.points += 3; team.form.push("W"); }
      else if (own === against) { team.table.drawn += 1; team.table.points += 1; team.form.push("D"); }
      else { team.table.lost += 1; team.form.push("L"); }
      team.form = team.form.slice(-5);
      report.teams[index].players.forEach((player) => {
        const key = `${team.id}:${player.id}`;
        const stat = this.state.playerStats[key] ?? { key, playerId:player.id, playerName:player.name, teamId:team.id, teamName:team.name, appearances:0, goals:0, assists:0, saves:0, tackles:0, penaltiesWon:0, yellowCards:0, redCards:0, ratingTotal:0 };
        const penaltiesWon = (report.importantEvents ?? []).filter((entry) => entry.type === "penaltyAwarded" && entry.opponentId === player.id).length;
        stat.appearances += 1; stat.goals += player.stats.goals; stat.assists += player.stats.assists; stat.saves += player.stats.saves; stat.tackles = Number(stat.tackles ?? 0) + Number(player.stats.tackles ?? 0); stat.penaltiesWon = Number(stat.penaltiesWon ?? 0) + penaltiesWon; stat.yellowCards += player.stats.yellowCards; stat.redCards += player.stats.redCards; stat.ratingTotal += player.rating;
        this.state.playerStats[key] = stat;
        if (isXPlayer(REAL_PLAYER_BY_ID[player.id])) this.settleXGrowthTasks(player.id);
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
      this.recoverUnusedPlayers(team, playedPlayerIds);
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
    this.settleMatchPrediction("cup", event.id, fixture, record);
    [home, away].forEach((team, index) => {
      const playedPlayerIds = new Set(report.teams[index].players.map((player) => player.id));
      report.teams[index].players.forEach((player) => {
        const key = `${team.id}:${player.id}`;
        const stat = cup.playerStats[key] ?? { key, playerId:player.id, playerName:player.name, teamId:team.id, teamName:team.name, appearances:0, goals:0, assists:0, saves:0, tackles:0, penaltiesWon:0, yellowCards:0, redCards:0, ratingTotal:0 };
        const penaltiesWon = (report.importantEvents ?? []).filter((entry) => entry.type === "penaltyAwarded" && entry.opponentId === player.id).length;
        stat.appearances += 1; stat.goals += player.stats.goals; stat.assists += player.stats.assists; stat.saves += player.stats.saves; stat.tackles = Number(stat.tackles ?? 0) + Number(player.stats.tackles ?? 0); stat.penaltiesWon = Number(stat.penaltiesWon ?? 0) + penaltiesWon; stat.yellowCards += player.stats.yellowCards; stat.redCards += player.stats.redCards; stat.ratingTotal += player.rating;
        cup.playerStats[key] = stat;
        if (isXPlayer(REAL_PLAYER_BY_ID[player.id])) this.settleXGrowthTasks(player.id);
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
      this.recoverUnusedPlayers(team, playedPlayerIds);
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
    const predictionLabel = event.stage === "swiss"
      ? `黄狗冠军杯瑞士轮第${event.round}轮`
      : `黄狗冠军杯${CUP_STAGE_NAMES[event.stage] ?? event.stage}${event.stage === "final" ? "" : `第${event.leg}回合`}`;
    this.distributePredictionProfit("cup", event.id, predictionLabel);
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
    if (cup.status === "completed") {
      cup.nextRoundAt = null;
      this.schedulePreparedWorldCupAfterCupFinal();
    } else {
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
      const created = measureRuntimeSync("league.cup.createFixtureMatch", () => this.createFixtureMatch(fixture, event.round, this.now(), { seed:`${this.state.season.id}:${event.id}:${fixture.id}`, competitionMode:"cup", legNumber:event.leg, regulationOnly:event.stage === "swiss" || event.stage === "final" ? false : event.leg === 1, aggregateBaseScore }));
      if (created.home.ownerId || created.away.ownerId) liveMatches.push({ code:`YDL-CUP-${this.state.season.name}-${event.stage}-${event.leg}-M${index + 1}`, round:event.round, fixtureId:fixture.id, match:created.match, spectators:{} });
      else {
        measureRuntimeSync("league.cup.settleAutomatedMatch", () => settleAutomatedMatch(created.match, created.startedAt));
        measureRuntimeSync("league.cup.finalizeFixture", () => this.finalizeCupFixture(fixture, event, created.match));
      }
    });
    if (!liveMatches.length) { this.completeCupEvent(event); this.save(); return true; }
    this.state.liveCupRound = { eventId:event.id, startedAt:this.now(), matches:liveMatches };
    this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    return true;
  }

  worldCupTeam(teamId) {
    return this.state.worldCup?.teams?.find((team) => team.id === teamId) ?? null;
  }

  worldCupPlayer(playerId) {
    for (const team of this.state.worldCup?.teams ?? []) {
      const player = team.roster?.find((entry) => entry.id === playerId);
      if (player) return player;
    }
    return REAL_PLAYER_BY_ID[playerId] ?? null;
  }

  createWorldCupRoster(country, code) {
    const source = REAL_PLAYERS
      .filter((player) => !isXPlayer(player) && player.nationality === country)
      .sort((left, right) => Number(right.overall ?? 0) - Number(left.overall ?? 0));
    const roster = [];
    const fillerRoles = ["GK", "CB", "RB", "LB", "DM", "AM", "RM", "LM", "ST", "RW", "LW"];
    const required = { GK:2, DEF:6, MID:5, ATT:4 };
    Object.entries(required).forEach(([pool, count]) => source
      .filter((player) => (player.pool === "LEGEND" ? roleGroup(player.role) : player.pool) === pool)
      .slice(0, count)
      .forEach((player) => { if (!roster.some((entry) => entry.id === player.id)) roster.push(clone(player)); }));
    source.forEach((player) => { if (roster.length < 23 && !roster.some((entry) => entry.id === player.id)) roster.push(clone(player)); });
    const counts = () => roster.reduce((result, player) => {
      const pool = player.pool === "LEGEND" ? roleGroup(player.role) : player.pool;
      result[pool] = (result[pool] ?? 0) + 1;
      return result;
    }, { GK:0, DEF:0, MID:0, ATT:0 });
    while (roster.length < 23 || Object.entries(required).some(([pool, count]) => (counts()[pool] ?? 0) < count)) {
      const current = counts();
      const neededPool = Object.entries(required).find(([pool, count]) => (current[pool] ?? 0) < count)?.[0];
      const role = neededPool === "GK" ? "GK" : neededPool === "DEF" ? "CB" : neededPool === "MID" ? "DM" : neededPool === "ATT" ? "ST" : fillerRoles[roster.length % fillerRoles.length];
      const pool = roleGroup(role);
      const template = source.find((player) => roleGroup(player.role) === pool) ?? source[0] ?? REAL_PLAYERS.find((player) => roleGroup(player.role) === pool);
      const id = `world-cup-${code}-filler-${roster.length + 1}`;
      roster.push({ ...clone(template), id, name:`${country}征召球员${roster.length + 1}`, nationality:country, club:"国家队征召", role, secondaryRole:null, pool, legendary:false, legend:false, overall:Math.min(75, Number(template?.overall ?? 68)) });
    }
    return roster;
  }

  worldCupStartingIds(team) {
    const selectedSet = new Set(team.selectedIds ?? []);
    const roster = (team.roster ?? []).filter((player) => !selectedSet.size || selectedSet.has(player.id));
    const selected = [];
    const take = (pool, count) => roster
      .filter((player) => (player.pool === "LEGEND" ? roleGroup(player.role) : player.pool) === pool && !selected.includes(player.id))
      .sort((left, right) => Number(right.overall ?? 0) - Number(left.overall ?? 0))
      .slice(0, count)
      .forEach((player) => selected.push(player.id));
    take("GK", 1); take("DEF", 4); take("MID", 3); take("ATT", 3);
    roster.filter((player) => !selected.includes(player.id)).sort((a, b) => Number(b.overall ?? 0) - Number(a.overall ?? 0)).forEach((player) => {
      if (selected.length < 11) selected.push(player.id);
    });
    return selected;
  }

  boostedWorldCupPlayer(player) {
    if (!player || isS4Legend(player)) return clone(player);
    const attributes = Object.fromEntries(Object.entries(player.attributes ?? {}).map(([key, value]) => [key, Math.min(99, Number(value ?? 0) + 3)]));
    return { ...clone(player), overall:Math.min(99, Number(player.overall ?? 0) + 3), attributes, referenceAttributes:clone(attributes), worldCupUpgradeLevel:3 };
  }

  createWorldCupMatch(fixture, event, startedAt = this.now()) {
    const teams = [this.worldCupTeam(fixture.homeId), this.worldCupTeam(fixture.awayId)];
    if (teams.some((team) => !team)) throw new Error("世界杯赛程包含不存在的国家队");
    const seats = teams.map((team) => {
      const ids = team.startingIds?.length === 11 ? team.startingIds : this.worldCupStartingIds(team);
      const players = ids.map((id) => team.roster.find((player) => player.id === id)).filter(Boolean).map((player) => this.boostedWorldCupPlayer(player));
      if (players.length !== 11) throw new Error(`${team.country}无法组成11人首发`);
      const submittedPositions = team.tactics?.positionPresets?.[team.tactics?.tacticalPlans?.opening?.positionPreset ?? "position1"] ?? team.tactics?.positions;
      const positions = Object.keys(submittedPositions ?? {}).length ? sanitizePositions(players, submittedPositions) : leagueBoardPositions(players);
      const club = team.ownerId ? this.state.teams.find((entry) => entry.ownerId === team.ownerId) : null;
      const tactics = team.tactics ?? {};
      return {
        name:team.country,
        players,
        positions,
        positionPresets:Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(team.tactics?.positionPresets?.[key] ?? positions)])),
        formationLinePresets:clone(team.tactics?.formationLinePresets ?? {}),
        tactic:tactics.tacticalPlans?.opening?.tactic ?? club?.tacticalPlans?.opening?.tactic ?? club?.tactic ?? "balanced",
        style:tactics.tacticalPlans?.opening?.style ?? club?.tacticalPlans?.opening?.style ?? club?.style ?? "possession",
        tacticalPlans:tactics.tacticalPlans ?? (club ? unwrapTracked(club.tacticalPlans) : undefined),
        attackFocus:tactics.attackFocus ?? club?.attackFocus ?? "balanced",
        defenseFocus:tactics.defenseFocus ?? club?.defenseFocus ?? "balanced",
        bondCatalog:[],
        preserveFitness:true,
      };
    });
    const match = createLeagueMatch(unwrapTracked(seats), {
      now:startedAt,
      seed:`${this.state.worldCup.date}:${event.id}:${fixture.id}`,
      regulationOnly:event.stage === "group",
      competitionMode:"worldcup",
      recordEvents:this.recordMatchEvents !== false,
      matchEngine:MATCH_ENGINE_BY_COMPETITION.worldcup ?? DEFAULT_MATCH_ENGINE,
    });
    return { teams, match, startedAt };
  }

  worldCupEventFixtures(event) {
    return (this.state.worldCup?.fixtures ?? []).filter((fixture) => event.fixtureIds.includes(fixture.id));
  }

  worldCupStandings(groupId = null) {
    const cup = this.state.worldCup;
    const ids = groupId ? cup?.groups?.find((group) => group.id === groupId)?.teamIds ?? [] : cup?.teams?.map((team) => team.id) ?? [];
    return ids.map((id) => ({ ...clone(cup.table[id]), ...clone(this.worldCupTeam(id)), roster:undefined }))
      .sort((left, right) => right.points - left.points || (right.goalsFor - right.goalsAgainst) - (left.goalsFor - left.goalsAgainst) || right.goalsFor - left.goalsFor || left.country.localeCompare(right.country, "zh-CN"))
      .map((entry, index) => ({ ...entry, rank:index + 1 }));
  }

  finalizeWorldCupFixture(fixture, event, match) {
    if (fixture.status === "complete") return this.state.matches.find((entry) => entry.id === fixture.matchId) ?? null;
    const report = match.report;
    const home = this.worldCupTeam(fixture.homeId);
    const away = this.worldCupTeam(fixture.awayId);
    const id = `${this.state.season.id}-WORLD-CUP-${event.id}-${fixture.id}`;
    const record = { id, competition:"worldcup", worldCupStage:event.stage, round:event.round, playedAt:this.now(), homeId:home.id, awayId:away.id, homeName:home.country, awayName:away.country, score:[...report.score], penalties:report.penalties ?? null, formations:report.teams.map((team) => team.formation), report };
    this.state.matches.push(record);
    Object.assign(fixture, { status:"complete", matchId:id, score:[...report.score], penalties:report.penalties ?? null });
    fixture.winnerId = Number.isInteger(match.winnerIndex) ? [fixture.homeId, fixture.awayId][match.winnerIndex] : report.score[0] > report.score[1] ? fixture.homeId : report.score[1] > report.score[0] ? fixture.awayId : null;
    if (event.stage === "group") {
      [home, away].forEach((team, index) => {
        const table = this.state.worldCup.table[team.id];
        const own = report.score[index]; const against = report.score[index === 0 ? 1 : 0];
        table.played += 1; table.goalsFor += own; table.goalsAgainst += against;
        if (own > against) { table.won += 1; table.points += 3; }
        else if (own === against) { table.drawn += 1; table.points += 1; }
        else table.lost += 1;
      });
    }
    [home, away].forEach((team, index) => report.teams[index].players.forEach((player) => {
      const key = `${team.id}:${player.id}`;
      const stat = this.state.worldCup.playerStats[key] ?? { key, playerId:player.id, playerName:player.name, teamId:team.id, teamName:team.country, appearances:0, goals:0, assists:0, saves:0, tackles:0, yellowCards:0, redCards:0, ratingTotal:0 };
      stat.appearances += 1; stat.goals += Number(player.stats.goals ?? 0); stat.assists += Number(player.stats.assists ?? 0); stat.saves += Number(player.stats.saves ?? 0); stat.tackles += Number(player.stats.tackles ?? 0); stat.yellowCards += Number(player.stats.yellowCards ?? 0); stat.redCards += Number(player.stats.redCards ?? 0); stat.ratingTotal += Number(player.rating ?? 0);
      this.state.worldCup.playerStats[key] = stat;
    }));
    return record;
  }

  createWorldCupKnockoutEvent(stage, teamIds) {
    const round = stage === "quarterfinal" ? 4 : stage === "semifinal" ? 5 : 6;
    const event = { id:`world-cup-${stage}`, stage, round, status:"pending", fixtureIds:[] };
    for (let index = 0; index < teamIds.length; index += 2) {
      const fixture = { id:`world-cup-${stage}-${index / 2 + 1}`, stage, round, homeId:teamIds[index], awayId:teamIds[index + 1], status:"pending", matchId:null, score:null, winnerId:null };
      this.state.worldCup.fixtures.push(fixture); event.fixtureIds.push(fixture.id);
    }
    this.state.worldCup.events.push(event);
    this.state.worldCup.stage = stage;
    return event;
  }

  completeWorldCupEvent(event) {
    if (event.transitionedAt) return;
    event.status = "complete"; event.transitionedAt = this.now();
    const cup = this.state.worldCup;
    if (event.stage === "group" && event.round === 3) {
      const groupStandings = cup.groups.map((group) => this.worldCupStandings(group.id));
      const bestThird = groupStandings.map((table) => table[2]).sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor).slice(0, 2);
      const qualified = [...groupStandings.flatMap((table) => table.slice(0, 2)), ...bestThird];
      cup.qualifiedTeamIds = qualified.map((team) => team.id);
      this.createWorldCupKnockoutEvent("quarterfinal", [qualified[0].id, bestThird[1].id, qualified[3].id, qualified[4].id, qualified[5].id, bestThird[0].id, qualified[1].id, qualified[2].id]);
    } else if (event.stage === "quarterfinal" || event.stage === "semifinal") {
      const winners = this.worldCupEventFixtures(event).map((fixture) => fixture.winnerId);
      this.createWorldCupKnockoutEvent(event.stage === "quarterfinal" ? "semifinal" : "final", winners);
    } else if (event.stage === "final") {
      cup.status = "completed"; cup.stage = "completed"; cup.championId = this.worldCupEventFixtures(event)[0]?.winnerId ?? null; cup.completedAt = this.now(); cup.endsAt = this.now(); cup.tacticsWindowOpen = true; cup.nextEventAt = null;
      this.cleanupWorldCupFillers();
      return;
    }
    cup.nextEventAt = this.now() + WORLD_CUP_INTERVAL_MS;
  }

  startScheduledWorldCupEvent(options = {}) {
    const cup = this.state.worldCup;
    if (!cup || !["preparation", "active"].includes(cup.status) || this.state.liveWorldCupRound) return false;
    const event = cup.events.find((entry) => entry.status === "pending");
    if (!event) return false;
    cup.status = "active"; cup.stage = event.stage; event.status = "running";
    const liveMatches = [];
    this.worldCupEventFixtures(event).forEach((fixture, index) => {
      const created = this.createWorldCupMatch(fixture, event, this.now());
      if (created.teams.some((team) => team.ownerId)) liveMatches.push({ code:`YDL-WC-${cup.date}-${event.round}-M${index + 1}`, round:event.round, fixtureId:fixture.id, match:created.match, spectators:{} });
      else { settleAutomatedMatch(created.match, created.startedAt); this.finalizeWorldCupFixture(fixture, event, created.match); }
    });
    if (!liveMatches.length || options.simulateAll) {
      liveMatches.forEach((live) => { settleAutomatedMatch(live.match, this.now()); this.finalizeWorldCupFixture(this.worldCupEventFixtures(event).find((fixture) => fixture.id === live.fixtureId), event, live.match); });
      this.completeWorldCupEvent(event); this.save(); return true;
    }
    this.state.liveWorldCupRound = { eventId:event.id, startedAt:this.now(), matches:liveMatches };
    this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    return true;
  }

  advanceLiveWorldCupRound(now = this.now(), options = {}) {
    const liveRound = this.state.liveWorldCupRound;
    if (!liveRound) return false;
    const event = this.state.worldCup.events.find((entry) => entry.id === liveRound.eventId);
    let changed = false;
    for (const live of this.liveAdvanceBatch(liveRound.matches, "worldcup", options.maximumMatches)) {
      advanceLeagueMatch(live.match, now, { maximumChains:options.maximumChainsPerMatch }); changed = true;
      if (live.match.report) { this.finalizeWorldCupFixture(this.worldCupEventFixtures(event).find((fixture) => fixture.id === live.fixtureId), event, live.match); live.completed = true; }
      else if (options.persist !== false) this.persistLiveMatch(live, now);
    }
    if (liveRound.matches.every((entry) => entry.completed)) {
      liveRound.matches.forEach((live) => this.state.completedBroadcasts.push({ code:live.code, round:event.round, matchId:this.worldCupEventFixtures(event).find((fixture) => fixture.id === live.fixtureId)?.matchId ?? null, completedAt:this.now(), spectators:clone(live.spectators ?? {}), match:publicLeagueMatch(live.match, this.now(), null, true), competition:"YellowDogs World Cup" }));
      this.completeWorldCupEvent(event); this.state.liveWorldCupRound = null; this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    }
    return changed;
  }

  createWorldCupPreparation(startsAtValue = null) {
    const date = localDateKey(new Date(this.now()));
    const parsedStartsAt = startsAtValue === null ? null : Number(new Date(startsAtValue).getTime());
    const startsAt = Number.isFinite(parsedStartsAt) && parsedStartsAt > 0 ? parsedStartsAt : null;
    const humans = seededShuffle(this.state.teams.filter((team) => team.ownerId).slice(0, 9), `${date}:managers`);
    const humanCountries = seededShuffle(WORLD_CUP_COUNTRIES.slice(0, 9), `${date}:human-countries`);
    const aiCountries = seededShuffle(WORLD_CUP_COUNTRIES.slice(9), `${date}:ai-countries`);
    const assignments = ["A", "B", "C"].flatMap((groupId, groupIndex) => [
      ...humanCountries.slice(groupIndex * 3, groupIndex * 3 + 3).map((country, index) => ({ country, club:humans[groupIndex * 3 + index] ?? null, groupId })),
      { country:aiCountries[groupIndex], club:null, groupId },
    ]);
    const teams = assignments.map(({ country:[country, code], club, groupId }) => {
      const roster = this.createWorldCupRoster(country, code);
      const xPlayerId = club ? Object.entries(this.state.xPlayers.assignments ?? {}).find(([, ownerId]) => ownerId === club.ownerId)?.[0] : null;
      const xPlayer = xPlayerId ? REAL_PLAYER_BY_ID[xPlayerId] : null;
      if (xPlayer) roster[roster.length - 1] = clone(xPlayer);
      const team = { id:`world-cup-${code}`, country, code, groupId, ownerId:club?.ownerId ?? null, managerName:club?.ownerName ?? "AI教练", isAi:!club, roster, selectedIds:roster.map((player) => player.id), startingIds:[] };
      team.startingIds = this.worldCupStartingIds(team); return team;
    });
    const groups = ["A", "B", "C"].map((id) => ({ id, teamIds:teams.filter((team) => team.groupId === id).map((team) => team.id) }));
    const fixtures = []; const events = [];
    const pairings = [[[0,3],[1,2]], [[0,2],[3,1]], [[0,1],[2,3]]];
    for (let round = 1; round <= 3; round += 1) {
      const event = { id:`world-cup-group-${round}`, stage:"group", round, status:"pending", fixtureIds:[] };
      groups.forEach((group) => pairings[round - 1].forEach(([homeIndex, awayIndex], matchIndex) => {
        const fixture = { id:`world-cup-${group.id}-r${round}-m${matchIndex + 1}`, stage:"group", groupId:group.id, round, homeId:group.teamIds[homeIndex], awayId:group.teamIds[awayIndex], status:"pending", matchId:null, score:null, winnerId:null };
        fixtures.push(fixture); event.fixtureIds.push(fixture.id);
      }));
      events.push(event);
    }
    this.state.worldCup = { status:"preparation", stage:"group", date, startsAt, nextEventAt:startsAt, startedAt:this.now(), completedAt:null, endsAt:null, championId:null, tacticsWindowOpen:true, teams, groups, fixtures, events, table:Object.fromEntries(teams.map((team) => [team.id, freshTable()])), playerStats:{}, lastError:null };
    this.state.liveWorldCupRound = null;
    return this.state.worldCup;
  }

  prepareWorldCupForDailyReset() {
    const date = localDateKey(new Date(this.now()));
    if (this.state.worldCup?.date === date && !["closed", "cancelled"].includes(this.state.worldCup.status)) return false;
    this.createWorldCupPreparation(null);
    return true;
  }

  schedulePreparedWorldCupAfterCupFinal() {
    const cup = this.state.worldCup;
    if (!cup || cup.date !== localDateKey(new Date(this.now())) || Number(cup.startsAt) > 0 || ["closed", "cancelled", "completed"].includes(cup.status)) return false;
    const startsAt = this.now() + WORLD_CUP_INTERVAL_MS;
    cup.startsAt = startsAt;
    cup.nextEventAt = startsAt;
    cup.scheduledAfterCupFinalAt = this.now();
    return true;
  }

  bootstrapWorldCup(startsAtValue, options = {}) {
    const date = localDateKey(new Date(this.now()));
    const startsAt = Number(new Date(startsAtValue).getTime());
    if (!Number.isFinite(startsAt) || startsAt < this.now() - 60_000) throw new Error("世界杯首轮开球时间必须是当前或未来时间");
    if (this.state.worldCup?.date === date && !["closed", "cancelled"].includes(this.state.worldCup.status)) {
      if (!Number(this.state.worldCup.startsAt)) {
        this.state.worldCup.startsAt = startsAt;
        this.state.worldCup.nextEventAt = startsAt;
      }
      if (options.repair !== false) return this.repairWorldCup();
      this.save(); return this.adminView();
    }
    this.createWorldCupPreparation(startsAt);
    this.save(); return this.adminView();
  }

  reanchorWorldCup(startsAtValue) {
    const cup = this.state.worldCup; const startsAt = Number(new Date(startsAtValue).getTime());
    if (!cup || !Number.isFinite(startsAt) || startsAt < this.now() - 60_000) throw new Error("请选择当前或未来的世界杯开球时间");
    if (this.state.liveWorldCupRound) throw new Error("世界杯正在直播，不能重排时间");
    cup.startsAt = startsAt; cup.nextEventAt = startsAt; cup.status = cup.events.some((event) => event.status === "complete") ? "active" : "preparation"; this.save(); return this.adminView();
  }

  repairWorldCup() {
    const cup = this.state.worldCup;
    if (!cup) throw new Error("今日世界杯尚未创建");
    cup.teams.forEach((team) => { team.roster ??= this.createWorldCupRoster(team.country, team.code); team.startingIds = this.worldCupStartingIds(team); cup.table[team.id] ??= freshTable(); });
    cup.lastError = null; this.save(); return this.adminView();
  }

  worldCupRosterDeadline() {
    const startsAt = Number(this.state.worldCup?.startsAt);
    return Number.isFinite(startsAt) && startsAt > 0 ? startsAt - 10 * 60 * 1000 : Infinity;
  }

  saveWorldCupRoster(account, selectedIdsValue) {
    const cup = this.state.worldCup;
    const team = cup?.teams?.find((entry) => entry.ownerId === account.id);
    if (!cup || !team) throw new Error("今日没有分配到世界杯国家队");
    if (this.now() >= this.worldCupRosterDeadline()) throw new Error("世界杯首轮开赛前10分钟已到，大名单已经锁定");
    const selectedIds = [...new Set((selectedIdsValue ?? []).map(String))];
    const allowed = new Map(REAL_PLAYERS.filter((player) => !isXPlayer(player) && player.nationality === team.country).map((player) => [player.id, player]));
    if (selectedIds.length !== 22 || selectedIds.some((id) => !allowed.has(id))) throw new Error("只能从今日国家队选择22名球员");
    const counts = selectedIds.reduce((result, id) => { const player = allowed.get(id); const pool = player.pool === "LEGEND" ? roleGroup(player.role) : player.pool; result[pool] = (result[pool] ?? 0) + 1; return result; }, { GK:0, DEF:0, MID:0, ATT:0 });
    if (counts.GK < 2 || counts.DEF < 6 || counts.MID < 5 || counts.ATT < 4) throw new Error("大名单至少需要2门将、6后场、5中场和4前场");
    const xPlayer = (team.roster ?? []).find((player) => isXPlayer(player));
    team.roster = [...selectedIds.map((id) => clone(allowed.get(id))), ...(xPlayer ? [clone(xPlayer)] : [])];
    team.selectedIds = [...selectedIds, ...(xPlayer ? [xPlayer.id] : [])];
    team.startingIds = this.worldCupStartingIds(team);
    team.rosterSubmittedAt = this.now();
    this.save();
    return { updatedAt:this.state.updatedAt, serverTime:this.now(), worldCup:this.worldCupView(account.id) };
  }

  saveWorldCupTactics(account, payload = {}) {
    const cup = this.state.worldCup;
    const team = cup?.teams?.find((entry) => entry.ownerId === account.id);
    if (!cup || !team || !this.worldCupView(account.id)?.tacticsWindowOpen) throw new Error("今日国家队战术板已经关闭");
    const starterIds = [...new Set((payload.starterIds ?? []).map(String))];
    const rosterIds = new Set((team.roster ?? []).map((player) => player.id));
    if (starterIds.length !== 11 || starterIds.some((id) => !rosterIds.has(id))) throw new Error("国家队首发必须由名单中的11名球员组成");
    team.startingIds = starterIds;
    team.tactics = {
      positions:clone(payload.positions ?? {}),
      positionPresets:clone(payload.positionPresets ?? {}),
      formationLinePresets:clone(payload.formationLinePresets ?? {}),
      tacticalPlans:clone(payload.tacticalPlans ?? {}),
      attackFocus:String(payload.attackFocus ?? "balanced"),
      defenseFocus:String(payload.defenseFocus ?? "balanced"),
      fitnessThreshold:Number(payload.fitnessThreshold ?? 65),
      savedAt:this.now(),
    };
    this.save();
    return { updatedAt:this.state.updatedAt, serverTime:this.now(), worldCup:this.worldCupView(account.id) };
  }

  cleanupWorldCupFillers() {
    const cup = this.state.worldCup;
    if (!cup || cup.fillersCleanedAt) return false;
    cup.teams.forEach((team) => {
      const fillerIds = new Set((team.roster ?? []).filter((player) => String(player.id).startsWith("world-cup-") && String(player.id).includes("-filler-")).map((player) => player.id));
      if (!fillerIds.size) return;
      team.roster = team.roster.filter((player) => !fillerIds.has(player.id));
      team.selectedIds = (team.selectedIds ?? []).filter((id) => !fillerIds.has(id));
      team.startingIds = (team.startingIds ?? []).filter((id) => !fillerIds.has(id));
    });
    cup.fillersCleanedAt = this.now();
    return true;
  }

  closeWorldCup() {
    if (!this.state.worldCup) throw new Error("今日世界杯尚未创建");
    if (this.state.liveWorldCupRound) throw new Error("世界杯正在直播，不能直接关闭");
    Object.assign(this.state.worldCup, { status:"closed", tacticsWindowOpen:false, nextEventAt:null, endsAt:this.now() }); this.cleanupWorldCupFillers(); this.save(); return this.adminView();
  }

  worldCupView(accountId = null) {
    const cup = this.state.worldCup;
    if (!cup) return null;
    const ownTeam = cup.teams.find((team) => team.ownerId === accountId);
    const entries = Object.values(cup.playerStats ?? {}).map((entry) => ({ ...entry, averageRating:entry.appearances ? Number((entry.ratingTotal / entry.appearances).toFixed(2)) : 0 }));
    const leaders = (field) => entries.filter((entry) => entry[field] > 0).sort((a, b) => b[field] - a[field] || b.averageRating - a.averageRating).slice(0, 20);
    return clone({ ...cup, teams:cup.teams.map((team) => ({ ...team, roster:team.id === ownTeam?.id ? team.roster.map(playerSummary) : undefined })), groups:cup.groups.map((group) => ({ ...group, standings:this.worldCupStandings(group.id) })), playerStats:undefined, leaderboards:{ scorers:leaders("goals"), assists:leaders("assists"), ratings:entries.sort((a,b) => b.averageRating - a.averageRating).slice(0,20) }, ownTeamId:ownTeam?.id ?? null, liveEventId:this.state.liveWorldCupRound?.eventId ?? null, tacticsWindowOpen:Boolean(cup.tacticsWindowOpen && (!cup.endsAt || this.now() < Number(cup.endsAt) + 30 * 60 * 1000)) });
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

  advanceLiveCupRound(now = this.now(), options = {}) {
    const liveRound = this.state.liveCupRound;
    if (!liveRound) return false;
    const cup = this.state.cup;
    const event = cup.events.find((entry) => entry.id === liveRound.eventId);
    let advanced = false;
    for (const live of this.liveAdvanceBatch(liveRound.matches, "cup", options.maximumMatches)) {
      advanceLeagueMatch(live.match, now, { maximumChains:options.maximumChainsPerMatch });
      advanced = true;
      if (live.match.report) {
        const fixture = this.cupEventFixtures(event).find((entry) => entry.id === live.fixtureId);
        this.finalizeCupFixture(fixture, event, live.match);
        live.completed = true;
      } else if (options.persist !== false) this.persistLiveMatch(live, now);
    }
    if (liveRound.matches.every((entry) => entry.completed)) {
      const completedCodes = liveRound.matches.map((live) => live.code);
      this.archiveCompletedBroadcasts({ roundNumber:event.round, matches:liveRound.matches });
      this.completeCupEvent(event);
      this.state.liveCupRound = null;
      if (!this.scheduleLiveSettlementSave(completedCodes)) this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    }
    return advanced;
  }

  recoverUnusedPlayers(team, playedPlayerIds) {
    if (!team.ownerId) return;
    team.rosterIds.forEach((id) => {
      if (playedPlayerIds.has(id)) return;
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, cupSuspension:0, injuryRounds:0 });
      state.fitness = Math.min(100, Number(state.fitness ?? 100) + 18);
    });
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
    this.ensureDisciplineState();
    const packRewardEnabled = Number(this.state.season.startedAt ?? 0) >= S4_LEAGUE_ROUND_PACK_REWARD_START_AT;
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      const disciplineGrantId = `league-round-reward:${this.state.season.id}:${roundNumber}`;
      const previouslyWithheld = this.state.discipline.withheldRewards.some((entry) => entry.accountId === team.ownerId && entry.grantId === disciplineGrantId);
      if (this.rewardsSuspended(team.ownerId) || previouslyWithheld) {
        if (!previouslyWithheld) this.withholdReward(team.ownerId, "league", disciplineGrantId, { round:roundNumber, rewardType:"round" });
        return;
      }
      const coinRewarded = this.state.ledger.some((entry) => entry.type === "league-match-reward" && entry.accountId === team.ownerId && entry.seasonId === this.state.season.id && entry.round === roundNumber);
      const packRewarded = this.state.ledger.some((entry) => entry.type === "league-round-pack-reward" && entry.accountId === team.ownerId && entry.seasonId === this.state.season.id && entry.round === roundNumber);
      if (coinRewarded && (!packRewardEnabled || packRewarded)) return;
      const match = this.state.matches.find((entry) => entry.round === roundNumber
        && (!entry.competition || entry.competition === "league")
        && (entry.homeId === team.id || entry.awayId === team.id));
      if (!match) return;
      const ownIndex = match.homeId === team.id ? 0 : 1;
      const ownScore = Number(match.score[ownIndex] ?? 0);
      const opponentScore = Number(match.score[ownIndex === 0 ? 1 : 0] ?? 0);
      const result = ownScore > opponentScore ? "win" : ownScore === opponentScore ? "draw" : "loss";
      const amount = Number(LEAGUE_MATCH_REWARDS[result] ?? 0);
      if (!coinRewarded) {
        this.wallet(team.ownerId).balance += amount;
        this.state.ledger.push({ id:makeId("ledger", `${team.id}-${this.state.season.id}-${roundNumber}`), accountId:team.ownerId, amount, type:"league-match-reward", seasonId:this.state.season.id, round:roundNumber, matchId:match.id, result, createdAt:this.now() });
      }
      let packIds = [];
      if (packRewardEnabled && !packRewarded) {
        const grantId = `league-round-pack:${this.state.season.id}:${roundNumber}:${team.id}`;
        const items = this.grantS4Pack(team.ownerId, S4_LEAGUE_ROUND_PACK_REWARD_TYPE, S4_LEAGUE_ROUND_PACK_REWARD_QUANTITY, { source:"league-round", grantId });
        packIds = items.map((item) => item.id);
        this.state.ledger.push({
          id:makeId("ledger", grantId),
          accountId:team.ownerId,
          amount:0,
          type:"league-round-pack-reward",
          seasonId:this.state.season.id,
          round:roundNumber,
          matchId:match.id,
          result,
          grantId,
          packType:S4_LEAGUE_ROUND_PACK_REWARD_TYPE,
          quantity:S4_LEAGUE_ROUND_PACK_REWARD_QUANTITY,
          packIds,
          createdAt:this.now(),
        });
      }
      const packText = packRewardEnabled ? `并获得 ${S4_LEAGUE_ROUND_PACK_REWARD_QUANTITY} 个私有池随机礼包` : "";
      this.pushInbox(team, {
        id:`reward:${this.state.season.id}:${roundNumber}`,
        type:"reward",
        title:packRewardEnabled ? `第${roundNumber}轮联赛奖励已到账` : `第${roundNumber}轮联赛金币已到账`,
        summary:`本轮联赛${result === "win" ? "取胜" : result === "draw" ? "战平" : "失利"}，获得 ${amount} 金币${packText}。`,
        body:`本轮比分为 ${ownScore}:${opponentScore}。${packRewardEnabled ? "礼包已经发放到背包；" : ""}友谊赛不发放金币或其他比赛奖励。`,
        round:roundNumber,
        matchId:match.id,
        payload:{ amount, result, ownScore, opponentScore, competition:"league", packType:packRewardEnabled ? S4_LEAGUE_ROUND_PACK_REWARD_TYPE : null, quantity:packRewardEnabled ? S4_LEAGUE_ROUND_PACK_REWARD_QUANTITY : 0, packIds },
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
    this.ensureDisciplineState();
    const team = this.state.teams.find((entry) => entry.id === teamId);
    if (!team?.ownerId || kind !== "advance" || !["quarterfinals", "semifinals"].includes(event.stage)) return null;
    const awardKey = `${event.id}:${kind}`;
    const disciplineGrantId = `cup-reward:${this.state.season.id}:${awardKey}`;
    const previouslyWithheld = this.state.discipline.withheldRewards.some((entry) => entry.accountId === team.ownerId && entry.grantId === disciplineGrantId);
    if (this.rewardsSuspended(team.ownerId) || previouslyWithheld) {
      if (!previouslyWithheld) this.withholdReward(team.ownerId, "cup", disciplineGrantId, { round:event.round, stage:event.stage, rewardType:kind });
      return null;
    }
    if (this.state.ledger.some((entry) => entry.type === "cup-pack-reward" && entry.accountId === team.ownerId && entry.grantId === awardKey)) return null;
    const items = this.grantS4Pack(team.ownerId, CUP_ADVANCE_PACK_TYPE, CUP_ADVANCE_PACK_QUANTITY, { source:"cup", grantId:awardKey });
    const ledgerEntry = {
      id:makeId("ledger", `${team.id}-${awardKey}`),
      accountId:team.ownerId,
      amount:0,
      type:"cup-pack-reward",
      grantId:awardKey,
      competition:"cup",
      stage:event.stage,
      award:kind,
      packType:CUP_ADVANCE_PACK_TYPE,
      quantity:CUP_ADVANCE_PACK_QUANTITY,
      packIds:items.map((item) => item.id),
      round:event.round,
      createdAt:this.now(),
    };
    this.state.ledger.push(ledgerEntry);
    const stageName = CUP_STAGE_NAMES[event.stage] ?? "决赛";
    this.pushInbox(team, {
      id:`cup-reward:${this.state.season.id}:${awardKey}:${team.id}`,
      type:"reward",
      title:`黄狗冠军杯${stageName}晋级奖励已送达`,
      summary:`获得 ${CUP_ADVANCE_PACK_QUANTITY} 个公共池随机礼包。`,
      body:`恭喜晋级黄狗冠军杯${stageName === "四分之一决赛" ? "半决赛" : "决赛"}，${CUP_ADVANCE_PACK_QUANTITY}个公共池随机礼包已经发放到背包。决赛冠军奖励由管理员另行发放。`,
      round:event.round,
      payload:{ amount:0, competition:"cup", stage:event.stage, award:kind, grantId:awardKey, packType:CUP_ADVANCE_PACK_TYPE, quantity:CUP_ADVANCE_PACK_QUANTITY, packIds:items.map((item) => item.id) },
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

  finishRound(round, options = {}) {
    this.advanceAvailability();
    this.roundNewUnavailable = null;
    round.status = "complete";
    this.state.season.currentRound = round.number;
    this.distributePredictionProfit("league", `R${round.number}`, `黄狗联赛第${round.number}轮`);
    this.payRewards(round.number);
    if (round.number >= this.state.season.totalRounds) { this.state.season.status = "completed"; this.state.season.completedAt = this.now(); }
    else {
      this.state.season.nextRoundAt = nextSlot(this.now());
    }
    this.createRoundInbox(round.number);
    this.updateDailyReports();
    this.archiveCompletedBroadcasts(this.state.liveRound);
    const completedCodes = (this.state.liveRound?.matches ?? []).map((live) => live.code);
    this.state.liveRound = null;
    if (options.deferSave && this.scheduleLiveSettlementSave(completedCodes)) return;
    this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
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
    this.roundNewUnavailable = new Set();
    const liveMatches = [];
    round.fixtures.forEach((fixture, fixtureIndex) => {
      const created = this.createFixtureMatch(fixture, round.number);
      if (created.match.version === 2 || created.home.ownerId || created.away.ownerId) {
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
    this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    return true;
  }

  advanceLiveRound(now = this.now(), options = {}) {
    const liveRound = this.state.liveRound;
    if (!liveRound) return false;
    const round = this.state.rounds.find((entry) => entry.number === liveRound.roundNumber);
    this.roundNewUnavailable = new Set(liveRound.newUnavailable ?? []);
    let advanced = false;
    for (const live of this.liveAdvanceBatch(liveRound.matches, "league", options.maximumMatches)) {
      advanceLeagueMatch(live.match, now, { maximumChains:options.maximumChainsPerMatch });
      advanced = true;
      if (live.match.report) {
        this.finalizeFixture(round.fixtures[live.fixtureIndex], round.number, live.match);
        live.completed = true;
      } else if (options.persist !== false) this.persistLiveMatch(live, now);
    }
    liveRound.newUnavailable = [...this.roundNewUnavailable];
    if (liveRound.matches.every((entry) => entry.completed)) this.finishRound(round, { deferSave:true });
    return advanced;
  }

  advanceLiveSlice(now = this.now()) {
    if (this.liveAdvanceRunning) return false;
    this.liveAdvanceRunning = true;
    const hasFriendlies = this.state.liveFriendlies.some((entry) => !entry.completed);
    try {
      let changed = this.advanceLiveFriendlies(now, { maximumMatches:hasFriendlies ? 1 : 0, maximumChainsPerMatch:1 });
      const mainMaximumMatches = hasFriendlies ? 1 : 2;
      if (this.state.liveRound) changed = this.advanceLiveRound(now, { maximumMatches:mainMaximumMatches, maximumChainsPerMatch:1 }) || changed;
      else if (this.state.liveCupRound) changed = this.advanceLiveCupRound(now, { maximumMatches:mainMaximumMatches, maximumChainsPerMatch:1 }) || changed;
      else if (this.state.liveWorldCupRound) changed = this.advanceLiveWorldCupRound(now, { maximumMatches:mainMaximumMatches, maximumChainsPerMatch:1 }) || changed;
      return changed;
    } finally {
      this.liveAdvanceRunning = false;
    }
  }

  liveMatch(codeValue) {
    const code = String(codeValue ?? "").toUpperCase();
    const live = [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveWorldCupRound?.matches ?? []), ...this.state.liveFriendlies].find((entry) => entry.code.toUpperCase() === code && !entry.completed);
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
        match:publicLeagueMatch(live.match, this.now(), null, true),
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
    this.purgeCompletedBroadcasts();
    return clone([...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveWorldCupRound?.matches ?? []), ...this.state.liveFriendlies].filter((live) => !live.completed).map((live) => {
      this.cleanupLiveSpectators(live);
      const snapshot = publicLeagueMatch(live.match, this.now(), null, true);
      return {
        code:live.code,
        round:live.round ?? this.state.liveRound?.roundNumber ?? this.state.cup?.stage,
        teams:snapshot.teams.map((team) => ({ name:team.name, formation:team.formation })),
        score:[...snapshot.score],
        minute:snapshot.minute,
        segment:snapshot.segment,
        weather:snapshot.weather,
        spectatorCount:Object.keys(live.spectators ?? {}).length,
        competition:live.code.startsWith("YDL-FRIENDLY-") ? "YDL友谊赛" : live.code.startsWith("YDL-WC-") ? "YellowDogs World Cup" : live.code.startsWith("YDL-CUP-") ? "YellowDogs Champion Cup" : "YellowDogs League",
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
      match:publicLeagueMatch(live.match, this.now(), null, true),
      competition:live.code.startsWith("YDL-FRIENDLY-") ? "YDL友谊赛" : live.code.startsWith("YDL-WC-") ? "YellowDogs World Cup" : live.code.startsWith("YDL-CUP-") ? "YellowDogs Champion Cup" : "YellowDogs League",
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
    const codeKey = String(code ?? "").toUpperCase();
    const live = [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveWorldCupRound?.matches ?? []), ...this.state.liveFriendlies].find((entry) => entry.code.toUpperCase() === codeKey && !entry.completed);
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
      competition:completed.competition ?? (completed.code.startsWith("YDL-CUP-") ? "YellowDogs Champion Cup" : "YellowDogs League"),
    });
  }

  leaveWatch(code, spectatorToken) {
    const codeKey = String(code ?? "").toUpperCase();
    const live = [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveWorldCupRound?.matches ?? []), ...this.state.liveFriendlies].find((entry) => entry.code.toUpperCase() === codeKey && !entry.completed);
    if (live) delete live.spectators?.[spectatorToken];
    const completed = this.completedBroadcast(code);
    if (completed) delete completed.spectators?.[spectatorToken];
    return { left:true };
  }

  dailySettlementReward(rank) {
    return {
      coins:rank === 1 ? 10000 : rank <= 4 ? 8000 : 6000,
      packType:DAILY_SETTLEMENT_PACK_TYPE,
      packQuantity:DAILY_SETTLEMENT_PACK_QUANTITY,
    };
  }

  settleDailySeason(options = {}) {
    this.ensureDisciplineState();
    const season = this.state.season;
    const settlementId = `${season.id}+daily-settlement`;
    const automation = this.state.dailyAutomation;
    const existing = automation.settlements.find((entry) => entry.id === settlementId);
    if (automation.lastRewardedSeasonId === season.id || existing?.status === "completed") return clone(existing);
    if (season.status !== "completed") throw new Error("当前联赛尚未完成，不能发放赛季排名奖励");
    if (!options.manual && this.now() < Number(season.completedAt ?? 0) + DAILY_SETTLEMENT_DELAY_MS) return null;

    const standings = this.standings();
    const rewardedAt = this.now();
    const recipients = standings.filter((entry) => {
      const team = this.state.teams.find((candidate) => candidate.id === entry.id);
      return Boolean(team?.ownerId);
    }).map((entry) => {
      const team = this.state.teams.find((candidate) => candidate.id === entry.id);
      const reward = this.dailySettlementReward(entry.rank);
      const recipientKey = `${settlementId}:${team.ownerId}`;
      const disciplineGrantId = `league-ranking-reward:${settlementId}`;
      const previouslyWithheld = this.state.discipline.withheldRewards.some((item) => item.accountId === team.ownerId && item.grantId === disciplineGrantId);
      if (this.rewardsSuspended(team.ownerId) || previouslyWithheld) {
        if (!previouslyWithheld) this.withholdReward(team.ownerId, "league", disciplineGrantId, { rank:entry.rank, rewardType:"ranking", coins:reward.coins, packType:reward.packType, quantity:reward.packQuantity });
        return { accountId:team.ownerId, teamId:team.id, rank:entry.rank, points:entry.points, ...reward, packIds:[], withheld:true };
      }
      const alreadyGranted = this.state.ledger.some((ledgerEntry) => ledgerEntry.type === "daily-season-settlement" && ledgerEntry.grantId === settlementId && ledgerEntry.accountId === team.ownerId);
      let packIds = [];
      if (!alreadyGranted) {
        this.wallet(team.ownerId).balance += reward.coins;
        const packs = this.grantS4Pack(team.ownerId, reward.packType, reward.packQuantity, { source:"daily-season-settlement", grantId:settlementId });
        packIds = packs.map((pack) => pack.id);
        this.state.ledger.push({
          id:`daily-season-settlement:${recipientKey}`,
          accountId:team.ownerId,
          amount:reward.coins,
          type:"daily-season-settlement",
          grantId:settlementId,
          seasonId:season.id,
          rank:entry.rank,
          packType:reward.packType,
          quantity:reward.packQuantity,
          packIds,
          createdAt:rewardedAt,
        });
      } else {
        packIds = this.state.ledger.find((ledgerEntry) => ledgerEntry.type === "daily-season-settlement" && ledgerEntry.grantId === settlementId && ledgerEntry.accountId === team.ownerId)?.packIds ?? [];
      }
      this.pushInbox(team, {
        id:`daily-season-settlement:${season.id}:${team.ownerId}`,
        type:"reward",
        title:`${season.name} 联赛第${entry.rank}名奖励已到账`,
        summary:`获得${reward.coins.toLocaleString("zh-CN")}金币和${reward.packQuantity}个传奇随机卡包。`,
        body:`本赛季最终排名第${entry.rank}名，积${entry.points}分。${reward.coins.toLocaleString("zh-CN")}金币和${reward.packQuantity}个与新赛季商店同款的传奇随机卡包已经发放到你的账户。`,
        payload:{ settlementId, seasonId:season.id, rank:entry.rank, points:entry.points, ...reward, packIds },
      });
      return { accountId:team.ownerId, teamId:team.id, rank:entry.rank, points:entry.points, ...reward, packIds };
    });

    const settlement = { id:settlementId, seasonId:season.id, seasonName:season.name, status:"completed", rewardedAt, recipients };
    const index = automation.settlements.findIndex((entry) => entry.id === settlementId);
    if (index >= 0) automation.settlements[index] = settlement;
    else automation.settlements.push(settlement);
    automation.settlements = automation.settlements.slice(-30);
    automation.lastRewardedSeasonId = season.id;
    this.save();
    return clone(settlement);
  }

  resetDailyCompetitions(options = {}) {
    return measureRuntimeSync("league.dailyReset", () => this.resetDailyCompetitionsUnmeasured(options));
  }

  resetDailyCompetitionsUnmeasured(options = {}) {
    const now = this.now();
    const date = localDateKey(new Date(now));
    const automation = this.state.dailyAutomation;
    if (!options.manual && automation.lastResetDate === date) return false;
    if (!options.skipRewardCheck && this.state.season.status === "completed" && automation.lastRewardedSeasonId !== this.state.season.id) {
      throw new Error("当前已完赛联赛尚未发放排名奖励，请先手动补发奖励");
    }

    if (!options.skipBackup) this.backupFile(`before-daily-reset-${date}-${now}.json`);
    if (!options.skipArchive) this.archiveSeason(options.reason ?? (options.manual ? "manual-daily-reset" : "automatic-daily-reset"));
    this.state.teams.forEach((team) => {
      team.table = freshTable();
      team.form = [];
      team.rosterIds.forEach((playerId) => {
        team.playerState[playerId] = { fitness:100, suspension:0, cupSuspension:0, injuryRounds:0 };
      });
    });
    const seasonName = this.state.season.name;
    const firstRoundAt = options.manual
      ? nextSlot(now)
      : beijingTimestamp(date, ACTIVE_START_HOUR);
    this.state.season = {
      id:`${seasonName}-${date}-${firstRoundAt.toString(36)}`,
      name:seasonName,
      date,
      status:"active",
      currentRound:0,
      totalRounds:18,
      nextRoundAt:firstRoundAt,
      firstRoundAt,
      startedAt:firstRoundAt,
      completedAt:null,
    };
    this.state.rounds = roundRobin(this.state.teams.map((team) => team.id));
    this.state.matches = [];
    this.state.playerStats = {};
    this.state.liveRound = null;
    this.state.liveCupRound = null;
    this.state.liveWorldCupRound = null;
    this.cleanupWorldCupFillers();
    this.state.worldCup = null;
    this.state.cup = { status:"waiting", stage:"waiting", participants:[], table:{}, swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, completedAt:null };
    this.prepareWorldCupForDailyReset();
    automation.lastResetDate = date;
    automation.lastCupStartDate = null;
    if (!options.skipSave) this.save();
    return options.skipView ? true : this.adminView();
  }

  runDailyAutomation() {
    return measureRuntimeSync("league.dailyAutomation", () => this.runDailyAutomationUnmeasured());
  }

  runDailyAutomationUnmeasured() {
    const now = this.now();
    const date = localDateKey(new Date(now));
    const automation = this.state.dailyAutomation;
    if (!automation.enabled) return false;
    let changed = false;
    if (this.state.season.status === "completed") changed = Boolean(this.settleDailySeason() ?? changed);

    const resetAt = beijingTimestamp(date, DAILY_RESET_HOUR, DAILY_RESET_MINUTE);
    if (date > automation.initializedDate && now >= resetAt && automation.lastResetDate !== date) {
      this.resetDailyCompetitions();
      changed = true;
    }

    const cupAt = beijingTimestamp(date, DAILY_CUP_HOUR, DAILY_CUP_MINUTE);
    if (automation.lastResetDate === date && now >= cupAt && automation.lastCupStartDate !== date && this.state.season.status === "active" && this.state.cup.status === "waiting") {
      this.startCup();
      automation.lastCupStartDate = date;
      this.save();
      changed = true;
    }
    return changed;
  }

  tick() {
    const now = this.now();
    if (this.statePath && localDateKey(new Date(now)) !== this.lastBackupMaintenanceDate) this.maintainBackups();
    const compensationChanged = measureRuntimeSync("league.compensation", () => this.dispatchS4TraitThresholdCompensation());
    const automationChanged = this.runDailyAutomation();
    measureRuntimeSync("league.predictionMarkets", () => this.ensurePredictionMarkets());
    const friendlyInvitationChanged = measureRuntimeSync("league.expireInvitations", () => this.expireFriendlyInvitations(now));
    if (friendlyInvitationChanged) this.save({ skipDailyBackup:true });
    const friendlyChanged = measureRuntimeSync("league.advanceFriendlies", () => this.advanceLiveFriendlies(now, { maximumMatches:0 })) || friendlyInvitationChanged;
    if (this.state.liveRound || this.state.liveCupRound || this.state.liveWorldCupRound) return friendlyChanged || automationChanged || compensationChanged;
    if (["preparation", "active"].includes(this.state.worldCup?.status) && now >= Number(this.state.worldCup?.nextEventAt ?? Infinity)) {
      return measureRuntimeSync("league.startScheduledWorldCupEvent", () => this.startScheduledWorldCupEvent());
    }
    if (this.state.cup.status === "active" && activeTime(now) && now >= Number(this.state.cup.nextRoundAt ?? Infinity)) {
      return measureRuntimeSync("league.startScheduledCupEvent", () => this.startScheduledCupEvent());
    }
    const dailyLeagueWindow = this.state.dailyAutomation.lastResetDate === localDateKey(new Date(now)) && now >= Number(this.state.season.firstRoundAt ?? Infinity);
    if (this.state.season.status !== "active" || (!activeTime(now) && !dailyLeagueWindow) || now < this.state.season.nextRoundAt) return friendlyChanged || automationChanged || compensationChanged;
    return measureRuntimeSync("league.startScheduledRound", () => this.startScheduledRound());
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
    const fixture = this.teamSchedule(teamId).find((entry) => entry.status !== "complete" && entry.competition !== "worldcup");
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
    return measureRuntimeSync("league.archiveSeason", () => this.archiveSeasonUnmeasured(reason));
  }

  archiveSeasonUnmeasured(reason) {
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
    this.state.adminCoinGrants = [];
    this.state.adminXGrowthGrants = [];
    this.state.reports = {};
    this.state.liveRound = null;
    this.state.liveCupRound = null;
    this.state.liveWorldCupRound = null;
    this.state.liveFriendlies = [];
    this.state.friendlyInvitations = [];
    this.state.friendlyFixtures = [];
    this.state.cup = { status:"waiting", stage:"waiting", participants:[], table:{}, swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, completedAt:null };
    this.cleanupWorldCupFillers();
    this.state.worldCup = null;
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
    const discipline = clone(this.state.discipline);
    const adminCoinPenalties = clone(this.state.adminCoinPenalties);
    this.adoptState(createState(resetAt));
    this.state.discipline = discipline;
    this.state.adminCoinPenalties = adminCoinPenalties;
    this.state.dailyAutomation.enabled = true;
    this.state.dailyAutomation.activatedAt = resetAt;
    this.state.dailyAutomation.initializedDate = localDateKey(new Date(resetAt));
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
    const discipline = clone(this.state.discipline);
    const adminCoinPenalties = clone(this.state.adminCoinPenalties);
    this.adoptState(createState(resetAt, seasonName));
    this.state.discipline = discipline;
    this.state.adminCoinPenalties = adminCoinPenalties;
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
      "s4-pack-buy":"S4礼包购买",
      "s4-card-enhancement":"球员卡强化",
      "admin-coin-grant":"后台金币发放",
      "card-trade-escrow":"玩家交易金币托管",
      "card-trade-refund":"玩家交易金币退回",
      "card-trade-settlement":"玩家交易金币结算",
      "league-match-reward":"联赛单轮金币奖励",
      "daily-season-settlement":"每日联赛排名奖励",
      "three-round-reward":"联赛金币奖励",
      "cup-coin-reward":"杯赛金币奖励",
      "cup-pack-reward":"杯赛公共池礼包奖励",
      "round-pack-reward":"每轮卡包奖励",
      "round-pack-sign":"每轮卡包签约",
      "three-round-pack-sign":"后台奖励包签约",
      "cup-pack-sign":"杯赛奖励包签约",
      "admin-player-card-grant":"后台指定球员卡发放",
      "admin-coin-penalty":"后台纪律扣款",
      "discipline-reward-withheld":"纪律处罚扣留奖励",
    };
    const ledgerByAccount = new Map();
    for (const entry of this.state.ledger) {
      const accountId = entry.accountId;
      if (accountId == null) continue;
      if (!ledgerByAccount.has(accountId)) ledgerByAccount.set(accountId, []);
      ledgerByAccount.get(accountId).push(entry);
    }
    const listingPositions = new Map();
    const listingsByClosedAt = new Map();
    this.state.listings.forEach((item, index) => {
      listingPositions.set(item.id, index);
      if (item.closedAt != null) {
        if (!listingsByClosedAt.has(item.closedAt)) listingsByClosedAt.set(item.closedAt, []);
        listingsByClosedAt.get(item.closedAt).push({ item, index });
      }
    });
    const resolveListing = (entry, ownerId) => {
      let best = null;
      let bestIndex = Number.MAX_SAFE_INTEGER;
      if (entry.listingId != null && listingPositions.has(entry.listingId)) {
        const index = listingPositions.get(entry.listingId);
        best = this.state.listings[index];
        bestIndex = index;
      }
      if (entry.createdAt != null) {
        const candidates = listingsByClosedAt.get(entry.createdAt);
        if (candidates) {
          for (const candidate of candidates) {
            if ((candidate.item.sellerId === ownerId || candidate.item.buyerId === ownerId) && candidate.index < bestIndex) {
              best = candidate.item;
              bestIndex = candidate.index;
            }
          }
        }
      }
      return best;
    };
    return this.state.teams.filter((team) => team.ownerId).map((team) => {
      const entries = (ledgerByAccount.get(team.ownerId) ?? []).map((entry) => {
        let playerId = entry.playerId ?? null;
        if (!playerId && ["transfer-buy", "transfer-sale"].includes(entry.type)) {
          playerId = resolveListing(entry, team.ownerId)?.playerId ?? null;
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
      const releases = entries.filter((entry) => ["release", "ownership-return"].includes(entry.type));
      const enhancements = entries.filter((entry) => entry.type === "s4-card-enhancement");
      const transfers = entries.filter((entry) => ["transfer-buy", "transfer-sale", "card-buy", "card-sale", "ownership-buy", "ownership-sale", "card-trade-escrow", "card-trade-refund", "card-trade-settlement"].includes(entry.type));
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
        enhancements,
        transfers,
        ledger:entries,
      };
    }).sort((left, right) => right.balance - left.balance || left.teamName.localeCompare(right.teamName, "zh-CN"));
  }

  adminView() {
    return measureRuntimeSync("league.adminView", () => this.adminViewUnmeasured());
  }

  adminViewUnmeasured() {
    this.ensureDisciplineState();
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
    const allocationIndex = measureRuntimeSync("league.adminView.allocations", () => {
      const activeByPlayer = new Map();
      let activeCardCount = 0;
      let recycledCardCount = 0;
      for (const card of Object.values(this.state.s4Assets.cards)) {
        if (card.status === "active") {
          activeCardCount += 1;
          if (!activeByPlayer.has(card.playerId)) activeByPlayer.set(card.playerId, { cards:[], holderOwners:new Set(), highestUpgrade:0 });
          const bucket = activeByPlayer.get(card.playerId);
          bucket.cards.push(card);
          bucket.holderOwners.add(card.ownerId);
          bucket.highestUpgrade = Math.max(bucket.highestUpgrade, Number(card.upgradeLevel ?? 0));
        } else if (card.status === "recycled") {
          recycledCardCount += 1;
        }
      }
      return { activeByPlayer, activeCardCount, recycledCardCount };
    });
    const allocations = REAL_PLAYERS.filter((player) => owned.has(player.id) || reserved.has(player.id) || allocationIndex.activeByPlayer.has(player.id)).map((player) => {
      const team = owned.get(player.id);
      const draft = reserved.get(player.id);
      const bucket = allocationIndex.activeByPlayer.get(player.id);
      return {
        ...playerSummary(player),
        status:team ? "owned" : draft ? "drafting" : "cards-circulating",
        teamId:team?.id ?? null,
        teamName:team?.name ?? draft?.teamName ?? null,
        ownerName:team?.ownerName ?? null,
        cardCount:bucket?.cards.length ?? 0,
        cardHolderCount:bucket?.holderOwners.size ?? 0,
        highestUpgrade:bucket?.highestUpgrade ?? 0,
      };
    });
    return unwrapTracked({
      season:this.state.season,
      cup:this.cupView(),
      worldCup:this.worldCupView(),
      worldCupOperations:{
        cupFinalCompleted:this.state.cup.status === "completed",
        live:Boolean(this.state.liveWorldCupRound),
        pendingFixtures:(this.state.worldCup?.fixtures ?? []).filter((fixture) => fixture.status === "pending").length,
        completedFixtures:(this.state.worldCup?.fixtures ?? []).filter((fixture) => fixture.status === "complete").length,
        temporaryFillerCount:(this.state.worldCup?.teams ?? []).flatMap((team) => team.roster ?? []).filter((player) => String(player.id).includes("-filler-")).length,
      },
      schedule:{ activeHours:"10:00 - 22:00", intervalMinutes:20 },
      dailyAutomation:clone(this.state.dailyAutomation),
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
      s4PlayerCatalog:REAL_PLAYERS.filter((player) => !isXPlayer(player)).map((player) => ({ id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole, pool:player.pool, overall:player.overall, grade:player.grade, nationality:player.nationality, club:player.club })),
      s4CardGrants:(this.state.s4Packs.cardGrants ?? []).slice().sort((left, right) => right.createdAt - left.createdAt),
      coinGrants:(this.state.adminCoinGrants ?? []).slice().sort((left, right) => right.createdAt - left.createdAt),
      coinPenalties:(this.state.adminCoinPenalties ?? []).slice().sort((left, right) => right.createdAt - left.createdAt),
      xGrowthGrants:(this.state.adminXGrowthGrants ?? []).slice().sort((left, right) => right.createdAt - left.createdAt),
      mailBroadcasts:(this.state.adminMailBroadcasts ?? []).slice().sort((left, right) => right.createdAt - left.createdAt),
      discipline:{
        rewardSuspensions:clone(this.state.discipline.rewardSuspensions),
        actions:this.state.discipline.actions.slice().sort((left, right) => right.createdAt - left.createdAt),
        withheldRewards:this.state.discipline.withheldRewards.slice().sort((left, right) => right.createdAt - left.createdAt),
      },
      economy:measureRuntimeSync("league.adminView.economy", () => this.adminEconomyView()),
      s4Assets:{
        schemaVersion:this.state.s4Assets.schemaVersion,
        ownershipCount:Object.keys(this.state.s4Assets.ownerships).length,
        activeCardCount:allocationIndex.activeCardCount,
        recycledCardCount:allocationIndex.recycledCardCount,
        recentTransactions:this.state.s4Assets.transactions.slice(-100).reverse(),
      },
      rewardGrants:[],
      lastFullResetAt:this.state.lastFullResetAt ?? null,
      archives:(this.state.archives ?? []).map((archive) => ({ reason:archive.reason, archivedAt:archive.archivedAt, season:archive.season, matchCount:archive.matches?.length ?? 0 })),
    });
  }
}

export const yellowDogsLeague = new YellowDogsLeagueService();
