import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir as mkdirAsync, open as openAsync, rename as renameAsync } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { createTrackedState, LEAGUE_SHARD_SCOPES, LeagueShardStore, isLeagueShardPath, unwrapTracked } from "./league-shard-store.js";
import { advanceVersusMatch, createVersusMatch, drawVersusReferee, publicMatch, REGULAR_DURATION_MS, HALFTIME_ADJUSTMENT_MS } from "./match-engine.js";
import { hydrateHistoricalMatchDetail } from "./history-detail.js";
import { isS4Legend, isXPlayer, REAL_PLAYER_BY_ID, REAL_PLAYER_POOLS, REAL_PLAYERS, X_PLAYERS } from "./player-pool.js";
import { analyzeElevenFormation, drawUniqueMixedPlayers, drawUniquePlayers, inferElevenBoardRoles, sanitizePositions } from "./rules.js";
import { ATTRIBUTE_LABELS, ATTRIBUTE_NAMES, PLAYER_OVERALL_ATTRIBUTE_KEYS, playerOverallFromAttributes, roleGroup } from "../game/public/schema.js";
import { YDL_TRAIT_BY_ID, YDL_TRAIT_CARDS } from "./trait-pool.js";
import { advanceYdlLeagueV2Match, createYdlLeagueV2Match, drawYdlV2Weather, publicYdlLeagueV2Match } from "./v2/ydl-league-engine-adapter.js";
import { createV2MatchRng } from "./v2/match-engine-v2.js";
import { resolveV2MatchParameters } from "./v2/match-parameters-v2.js";
import { resolveV2PlayerDuty } from "./v2/player-duties-v2.js";
import { buildV21TacticalShapePreview } from "./v2/tactical-shape-preview-v2.js";
import { applyS4Enhancement, S4_ECONOMY, S4_ENHANCEMENT, S4_PACK_PRICES, S4_PRICING, s4BaseCardReferenceValue, s4CardValueMultiplier, s4EffectiveOverall, s4EnhancementChanceForLevels, s4EnhancementProtectionCost, s4OwnershipReferenceValue } from "./s4-balance.js";
import { applyS4BondBonuses, createS4BondCatalog, evaluateS4LineupBonds } from "./public/bond-rules.js";
import { DEFAULT_CAPTAIN_STYLE, normalizeCaptainStyle } from "./public/captain-rules.js";
import { analyzeElevenBoardFormation, deriveFormationLines, inferElevenBoardRoles as inferFormationBoardRoles, sanitizeFormationLines } from "./public/formation-rules.js";
import {
  DEFAULT_IN_POSSESSION_DETAILS,
  DEFAULT_OUT_OF_POSSESSION_DETAILS,
  IN_POSSESSION_DETAIL_OPTIONS,
  OUT_OF_POSSESSION_DETAIL_OPTIONS,
} from "./public/v2-tactical-profiles.js";
import { measureRuntimeSync } from "../src/runtime-metrics.js";
import {
  MIRROR_BATCH_CLOUD_NODE,
  MIRROR_BATCH_DIRECTOR_CONCURRENCY,
  MIRROR_BATCH_DIRECTOR_NODE,
  MIRROR_BATCH_DIRECTOR_OWNER_NAME,
  MIRROR_BATCH_DIRECTOR_SURCHARGE_PER_MATCH,
  MIRROR_BATCH_WORKER_ENGINE_VERSION,
  MIRROR_BATCH_WORKER_LEASE_MS,
  MIRROR_BATCH_WORKER_ONLINE_MS,
} from "./mirror-batch-worker-protocol.js";
import { automaticSubstitutionRank, compareAutomaticSubstitutes } from "./automatic-substitution.js";
import { createSeasonFinalState, positionLine, SEASON_FINAL_RULES, SEASON_FINAL_SCHEDULE_MINUTES, validateFinalBanSelection } from "./season-final-tournament.js";
import { HONOR_ROOM_SEED } from "./honor-room-seed.js";
import { CLUB_BADGE_PACK, CLUB_BADGES, COSMETIC_BADGE_BY_ID, COSMETIC_BADGE_MINIMUM_LISTING_PRICE, COSMETIC_BADGES, COUNTRY_BADGE_BY_ID, COUNTRY_BADGE_PACK, COUNTRY_BADGES, drawCosmeticBadgeChoices } from "./cosmetic-items.js";
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
  rosterLimitBonusForOwner,
  rosterLimitForOwner,
  rosterSlotUsage,
  S4_ROSTER_EXPANSION_LIMIT,
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
const CLUB_ROSTER_LIMIT = S4_ROSTER_LIMIT;
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

function v2TacticalDimensionsProperty(value, fallback, plan = {}) {
  const tacticalDimensions = sanitizeV2TacticalDimensions(value, fallback);
  if (!["possessionStyle", "defensiveBlock", "transitionStyle", "duelIntensity"].some((key) => Object.hasOwn(plan ?? {}, key))) {
    const legacyAdjustments = {
      tempo:{ patient:-18, cautious:-9, balanced:0, quick:11, extreme:22 }[plan?.inPossessionDetails?.tempo] ?? 0,
      directness:{ short:-24, shorter:-12, balanced:0, longer:13, direct:26 }[plan?.inPossessionDetails?.directness] ?? 0,
      pressing:{ retreat:-24, low:-12, standard:0, high:14, relentless:27 }[plan?.outOfPossessionDetails?.pressing] ?? 0,
      compactness:{ loose:-16, balanced:0, tight:18 }[plan?.outOfPossessionDetails?.compactness] ?? 0,
    };
    Object.entries(legacyAdjustments).forEach(([key, adjustment]) => {
      if (adjustment) tacticalDimensions[key] = Math.max(0, Math.min(100, Math.round(Number(tacticalDimensions[key] ?? 50) + adjustment)));
    });
  }
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

function sanitizeV2PlayerDuties(value, playerIds, roles, fallback = {}) {
  return Object.fromEntries((playerIds ?? []).flatMap((playerId) => {
    const resolved = resolveV2PlayerDuty(roles?.[playerId], value?.[playerId] ?? fallback?.[playerId]);
    return resolved ? [[playerId, resolved]] : [];
  }));
}

function v2PlayerDutiesProperty(value, playerIds, roles, fallback = {}) {
  const playerDuties = sanitizeV2PlayerDuties(value, playerIds, roles, fallback);
  return Object.keys(playerDuties).length ? { playerDuties } : {};
}

function tacticalPlansWithInheritedDuties(tacticalPlans, rotations = []) {
  const plans = clone(tacticalPlans ?? {});
  for (const { outId, inId } of rotations) {
    if (!outId || !inId || outId === inId) continue;
    Object.values(plans).forEach((plan) => {
      if (!plan?.playerDuties || !Object.hasOwn(plan.playerDuties, outId)) return;
      plan.playerDuties[inId] = plan.playerDuties[outId];
      delete plan.playerDuties[outId];
    });
  }
  return plans;
}
export const S4_PACK_CATALOG = Object.freeze([
  COUNTRY_BADGE_PACK,
  CLUB_BADGE_PACK,
  Object.freeze({ id:"legend-random", name:"传奇随机卡包", price:S4_PACK_PRICES["legend-random"], kind:"legend", pool:"LEGEND", selectionMode:"choice", description:"随机展示3名传奇球员，选择其中1张球员卡。" }),
  Object.freeze({ id:"private-mixed", name:"私有池全位置随机礼包", price:S4_PACK_PRICES["private-mixed"], kind:"private", pool:"MIXED", selectionMode:"direct", description:"通常从你的私有池随机获得1张卡，并有1.5%概率直接获得随机传奇S球员卡。" }),
  Object.freeze({ id:"private-att", name:"私有池前场随机礼包", price:S4_PACK_PRICES["private-att"], kind:"private", pool:"ATT", selectionMode:"direct", description:"从你拥有所有权的前场球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-mid", name:"私有池中场随机礼包", price:S4_PACK_PRICES["private-mid"], kind:"private", pool:"MID", selectionMode:"direct", description:"从你拥有所有权的中场球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-def", name:"私有池后场随机礼包", price:S4_PACK_PRICES["private-def"], kind:"private", pool:"DEF", selectionMode:"direct", description:"从你拥有所有权的后场球员中随机获得1张卡。" }),
  Object.freeze({ id:"private-gk", name:"私有池门将随机礼包", price:S4_PACK_PRICES["private-gk"], kind:"private", pool:"GK", selectionMode:"direct", description:"从你拥有所有权的门将中随机获得1张卡。" }),
  Object.freeze({ id:"public-random", name:"公共池随机礼包", price:S4_PACK_PRICES["public-random"], kind:"public", pool:"MIXED", selectionMode:"choice", description:"从尚未被占用所有权的非传奇球员中随机展示3人，选择1张卡并获得其所有权。" }),
]);
const S4_ADMIN_GIFT_PACK_CATALOG = Object.freeze([
  Object.freeze({ id:"admin-legend-choice-plus2", name:"指定传奇球员卡+2礼包", price:0, kind:"legend", pool:"LEGEND", selectionMode:"choice", choiceMode:"all", fixedUpgradeLevel:2, adminOnly:true, description:"打开后可从全部传奇球员中指定1名，获得1张+2传奇球员卡。" }),
  Object.freeze({ id:"admin-legend-choice-plus1", name:"指定传奇球员卡+1礼包", price:0, kind:"legend", pool:"LEGEND", selectionMode:"choice", choiceMode:"all", fixedUpgradeLevel:1, adminOnly:true, description:"打开后可从全部传奇球员中指定1名，获得1张+1传奇球员卡。" }),
  Object.freeze({ id:"admin-private-choice-plus3", name:"私有池指定球员+3礼包", price:0, kind:"private", pool:"MIXED", selectionMode:"choice", choiceMode:"all", fixedUpgradeLevel:3, adminOnly:true, description:"打开后可从自己拥有所有权的私有池球员中指定1名，获得1张+3球员卡。" }),
]);
export const S4_PRIVATE_MIXED_LEGEND_RATE = 0.015;
const S4_SINGLE_CARD_RECOVERY_MAX_UPGRADE_LEVEL = 6;
const LEGACY_S4_PACK_CATALOG = Object.freeze([
  Object.freeze({ id:"public-carnival", name:"公开池狂欢礼包", price:S4_PACK_PRICES["public-carnival"], kind:"public", pool:"MIXED", selectionMode:"choice", seasonPurchaseLimit:1, cardQuantity:50, description:"赛季限购1次。从公开池随机展示3人，选择1人并获得其所有权及50张+0基础卡。", retired:true }),
]);
const S4_PACK_BY_ID = Object.freeze(Object.fromEntries([...S4_PACK_CATALOG, ...S4_ADMIN_GIFT_PACK_CATALOG, ...LEGACY_S4_PACK_CATALOG].map((pack) => [pack.id, pack])));
const S4_MAX_PACK_PURCHASE_QUANTITY = 100;
const S4_ROSTER_EXPANSION_ITEM = Object.freeze({
  id:"paid-roster-slot",
  name:"付费大名单",
  price:6666,
  rosterSlots:1,
  purchaseLimit:S4_ROSTER_EXPANSION_LIMIT,
  description:"购买后立即将球队大名单永久上限提高1人，累计最多购买15个。",
});
const METEOR_STAND_ITEM = Object.freeze({
  id:"meteor-stand",
  name:"流星雨看台",
  price:20_000,
  description:"永久解锁流星雨看台外观。购买后可在俱乐部的球场管理中选择装备。",
});
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
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAILY_RESET_HOUR = 9;
const DAILY_RESET_MINUTE = 51;
const DAILY_CUP_HOUR = 10;
const DAILY_CUP_MINUTE = 1;
const DAILY_SETTLEMENT_DELAY_MS = 10 * 60 * 1000;
const DAILY_SETTLEMENT_PACK_TYPE = "legend-random";
const DAILY_SETTLEMENT_PACK_QUANTITY = 2;
const LEAGUE_RANKING_GIFT_PACK_TYPE = "admin-private-choice-plus3";
const LEAGUE_RANKING_GIFT_QUANTITIES = Object.freeze({ 1:4, 2:3, 3:2, 4:2, 5:1, 6:1, 7:1, 8:1 });
const BALLON_DOR_MINIMUM_APPEARANCES = 15;
const BALLON_DOR_OWNER_REWARD = 10000;
const BALLON_DOR_CUP_WEIGHT = 1.25;
const BALLON_DOR_RECONCILIATION_VERSION = 2;
const BALLON_DOR_SCORING = Object.freeze({ goal:4, assist:3, rating:20, appearance:0.25, leagueChampion:35, leagueRunnerUp:15, cupChampion:30, cupRunnerUp:10, seasonFinalChampion:50, seasonFinalRunnerUp:25 });

function ballonDorBreakdown(candidate, placements) {
  const weightedAverageRating = candidate.weightedRatingTotal / Math.max(1, candidate.weightedAppearances);
  return {
    goals:Number((candidate.weightedGoals * BALLON_DOR_SCORING.goal).toFixed(2)),
    assists:Number((candidate.weightedAssists * BALLON_DOR_SCORING.assist).toFixed(2)),
    rating:Number((Math.max(0, weightedAverageRating - 6) * BALLON_DOR_SCORING.rating).toFixed(2)),
    appearances:Number((Math.min(30, candidate.weightedAppearances) * BALLON_DOR_SCORING.appearance).toFixed(2)),
    leagueChampion:placements.leagueChampion ? BALLON_DOR_SCORING.leagueChampion : 0,
    leagueRunnerUp:placements.leagueRunnerUp ? BALLON_DOR_SCORING.leagueRunnerUp : 0,
    cupChampion:placements.cupChampion ? BALLON_DOR_SCORING.cupChampion : 0,
    cupRunnerUp:placements.cupRunnerUp ? BALLON_DOR_SCORING.cupRunnerUp : 0,
    seasonFinalChampion:placements.seasonFinalChampion ? BALLON_DOR_SCORING.seasonFinalChampion : 0,
    seasonFinalRunnerUp:placements.seasonFinalRunnerUp ? BALLON_DOR_SCORING.seasonFinalRunnerUp : 0,
  };
}

function compareBallonDorCandidates(left, right) {
  return right.score - left.score
    || right.weightedAverageRating - left.weightedAverageRating
    || right.goals - left.goals
    || right.assists - left.assists
    || right.appearances - left.appearances
    || left.teamId.localeCompare(right.teamId)
    || left.playerId.localeCompare(right.playerId);
}
const COMPLETED_BROADCAST_RETENTION_MS = 2 * 60 * 60 * 1000;
const LIVE_MATCH_PERSIST_INTERVAL_MS = Math.max(10_000, Math.min(120_000, Number(process.env.YDL_LIVE_MATCH_PERSIST_INTERVAL_MS ?? 30_000)));
const LIVE_SETTLEMENT_PERSIST_DELAY_MS = 1_500;
const LIVE_SETTLEMENT_JOB_GAP_MS = 25;
const IN_SEASON_FRIENDLY_MINUTE_MARKS = Object.freeze([5, 15, 25, 35, 45, 55]);
const OFFSEASON_FRIENDLY_MINUTE_MARKS = Object.freeze([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
const IN_SEASON_FRIENDLY_TEAM_INTERVAL_MS = 10 * 60 * 1000;
const OFFSEASON_FRIENDLY_TEAM_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVE_START_HOUR = 10;
const ACTIVE_END_HOUR = 22;
const LEAGUE_FITNESS_DRAIN_FACTOR = 0.36;
const GOALKEEPER_FITNESS_DRAIN_FACTOR = 0.5;
const CHEMISTRY_GAIN_PER_MATCH = 6;
const CHEMISTRY_VISIBLE_THRESHOLD = 30;
const CHEMISTRY_MAX_BONUS = 0.015;
const MATCH_PREDICTION_SIMULATIONS = Math.max(20, Math.min(200, Number(process.env.YDL_PREDICTION_SIMULATIONS ?? 24)));
const MATCH_PREDICTION_MAX_STAKE = 10000;
const configuredMatchEngine = (value, fallback = "v2") => String(value ?? fallback).toLowerCase() === "v1" ? "v1" : "v2";
const DEFAULT_MATCH_ENGINE = configuredMatchEngine(process.env.YDL_MATCH_ENGINE);
const LEAGUE_MATCH_ENGINE = configuredMatchEngine(process.env.YDL_LEAGUE_MATCH_ENGINE, DEFAULT_MATCH_ENGINE);
const CUP_MATCH_ENGINE = configuredMatchEngine(process.env.YDL_CUP_MATCH_ENGINE, DEFAULT_MATCH_ENGINE);
const FRIENDLY_MATCH_ENGINE = configuredMatchEngine(process.env.YDL_FRIENDLY_MATCH_ENGINE, DEFAULT_MATCH_ENGINE);
const MATCH_ENGINE_BY_COMPETITION = Object.freeze({ league:LEAGUE_MATCH_ENGINE, cup:CUP_MATCH_ENGINE, friendly:FRIENDLY_MATCH_ENGINE });
const STABLE_V21_PARAMETERS = resolveV2MatchParameters({ dynamicShape:{ mode:"stable" } });
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
const MATCH_PREDICTION_PRICING_VERSION = 9;
const MATCH_PREDICTION_MAX_STAKE_BY_CATEGORY = Object.freeze({ goals:5000, halfFull:5000 });
const MATCH_PREDICTION_OPTIONS = Object.freeze({
  result:Object.freeze(["home", "draw", "away"]),
  goals:Object.freeze(["0-3", "4-5", "6+"]),
  cards:Object.freeze(["0", "1", "2", "3", "4+"]),
  halfFull:Object.freeze(["home-home", "home-draw", "home-away", "draw-home", "draw-draw", "draw-away", "away-home", "away-draw", "away-away"]),
});
// V1 deliberately remains the low-cost pricing engine, while V2 settles the real match.
// These hidden card-market guards preserve V1's match-to-match variation without allowing
// the stable V1/V2 discipline gap to turn the high-card selections into mechanical arbitrage.
const MATCH_PREDICTION_CARD_PAYOUT_GUARDS = Object.freeze({
  "0":Object.freeze({ multiplier:1.5, minimum:9.5, maximum:10.8 }),
  "1":Object.freeze({ multiplier:1.4, minimum:4.4, maximum:5.2 }),
  "2":Object.freeze({ multiplier:1, minimum:3.8, maximum:4.5 }),
  "3":Object.freeze({ multiplier:.72, minimum:4.1, maximum:4.8 }),
  "4+":Object.freeze({ multiplier:.37, minimum:2.4, maximum:2.7 }),
});
const MATCH_PREDICTION_MIN_PUBLISHED_RATE = 1.02;
const MATCH_PREDICTION_LOW_ODDS_DISCOUNT = .93;
const MATCH_PREDICTION_HIGH_ODDS_DISCOUNT = .77;
const MATCH_PREDICTION_CONFUSION_RANGE = .04;
// V2 results exposed a repeatable edge on the result selection helped by a
// non-zero handicap. Charge that selection an additional line-specific risk
// discount while leaving zero-ball markets and the other selections unchanged.
const MATCH_PREDICTION_DIRECTED_RESULT_DISCOUNT = Object.freeze({ 1:.77, 2:.62 });
// Cap the return of the entire 1X2 board instead of judging each displayed
// number independently. A 72% board turns the former 1.88 / 2.58 / 3.10
// example into roughly 1.68 / 2.31 / 2.77 while preserving its probability shape.
const MATCH_PREDICTION_MAX_MARKET_RTP = Object.freeze({ result:.72 });
export const S4_BOND_CATALOG = Object.freeze(createS4BondCatalog(REAL_PLAYERS));
const INITIAL_WALLET_BALANCE = S4_ECONOMY.initialWalletBalance;
const CLUB_STADIUM_DEFAULT_CAPACITY = 30_000;
const CLUB_STADIUM_EXPANSIONS = Object.freeze([
  Object.freeze({ capacity:35_000, cost:4_000 }),
  Object.freeze({ capacity:40_000, cost:5_000 }),
  Object.freeze({ capacity:45_000, cost:6_500 }),
  Object.freeze({ capacity:50_000, cost:8_000 }),
  Object.freeze({ capacity:55_000, cost:10_000 }),
  Object.freeze({ capacity:60_000, cost:12_500 }),
  Object.freeze({ capacity:65_000, cost:15_000 }),
  Object.freeze({ capacity:70_000, cost:18_000 }),
  Object.freeze({ capacity:75_000, cost:22_000 }),
  Object.freeze({ capacity:80_000, cost:26_000 }),
]);
const CLUB_SPONSOR_OFFER_CHANCE = .35;
const CLUB_SPONSOR_MAX_PENDING_OFFERS = 5;
const CLUB_SPONSORS = Object.freeze([
  Object.freeze({ id:"microsoft", name:"微软", icon:"/versus/assets/sponsors/microsoft.svg" }),
  Object.freeze({ id:"apple", name:"苹果", icon:"/versus/assets/sponsors/apple.svg" }),
  Object.freeze({ id:"emirates", name:"阿联酋航空", icon:"/versus/assets/sponsors/emirates.svg" }),
  Object.freeze({ id:"nike", name:"耐克", icon:"/versus/assets/sponsors/nike.svg" }),
  Object.freeze({ id:"adidas", name:"阿迪达斯", icon:"/versus/assets/sponsors/adidas.svg" }),
  Object.freeze({ id:"jissbon", name:"杰士邦", icon:"/versus/assets/sponsors/jissbon.png" }),
  Object.freeze({ id:"samsung", name:"三星", icon:"/versus/assets/sponsors/samsung.svg" }),
  Object.freeze({ id:"sony", name:"索尼", icon:"/versus/assets/sponsors/sony.svg" }),
  Object.freeze({ id:"mizuno", name:"美津浓", icon:"/versus/assets/sponsors/mizuno.svg" }),
  Object.freeze({ id:"zhuren", name:"主任株式会社", icon:"/versus/assets/sponsors/zhuren-kabushiki-kaisha.png" }),
]);
const CLUB_SPONSOR_CONTRACTS = Object.freeze({
  normal:Object.freeze({ id:"normal", name:"普通赞助", durationSeasons:1, bonus:5_000, requiredRank:10, description:"场边展示赞助商标识" }),
  stadium:Object.freeze({ id:"stadium", name:"球场冠名", durationSeasons:2, bonus:15_000, requiredRank:6, description:"锁定主场名称并展示场边广告" }),
  team:Object.freeze({ id:"team", name:"球队冠名", durationSeasons:2, bonus:30_000, requiredRank:3, description:"球队名称在全部赛事中追加赞助商后缀" }),
});
const DEFAULT_FITNESS_THRESHOLD = 65;
const LEAGUE_MATCH_REWARDS = S4_ECONOMY.leagueMatchRewards;
const CUP_ADVANCE_PACK_TYPE = S4_ECONOMY.cupAdvancePackType;
const CUP_ADVANCE_PACK_QUANTITY = S4_ECONOMY.cupAdvancePackQuantity;
const FINAL_PLACEMENT_REWARD_PACK_TYPES = Object.freeze({
  champion:"admin-legend-choice-plus2",
  runnerUp:"admin-legend-choice-plus1",
});
const CUP_LEAGUE_QUALIFIER_PACK_TYPE = "legend-random";
const CUP_LEAGUE_QUALIFIER_PACK_QUANTITY = 2;
const CUP_LEAGUE_TOP_FOUR_COINS = 10_000;
const CUP_LEAGUE_LOWER_QUALIFIER_COINS = 6_000;
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
const AI_TRAINING_FORMATIONS = Object.freeze({
  "4-3-3":Object.freeze([
    ["GK",50,90], ["LB",18,68], ["CB",40,68], ["CB",60,68], ["RB",82,68],
    ["DM",50,49], ["AM",40,40], ["AM",60,40], ["LW",20,20], ["ST",50,17], ["RW",80,20],
  ]),
  "4-4-2":Object.freeze([
    ["GK",50,90], ["LB",18,68], ["CB",40,68], ["CB",60,68], ["RB",82,68],
    ["LM",18,44], ["DM",40,47], ["AM",60,41], ["RM",82,44], ["ST",40,18], ["ST",60,18],
  ]),
  "4-2-3-1":Object.freeze([
    ["GK",50,90], ["LB",18,68], ["CB",40,68], ["CB",60,68], ["RB",82,68],
    ["DM",40,51], ["DM",60,51], ["LM",20,38], ["AM",50,36], ["RM",80,38], ["ST",50,16],
  ]),
  "4-1-4-1":Object.freeze([
    ["GK",50,90], ["LB",18,68], ["CB",40,68], ["CB",60,68], ["RB",82,68],
    ["DM",50,54], ["LM",18,39], ["AM",40,40], ["AM",60,40], ["RM",82,39], ["ST",50,17],
  ]),
  "3-4-3":Object.freeze([
    ["GK",50,90], ["CB",34,68], ["CB",50,68], ["CB",66,68],
    ["LM",18,44], ["DM",40,47], ["AM",60,41], ["RM",82,44], ["LW",20,20], ["ST",50,17], ["RW",80,20],
  ]),
  "3-5-2":Object.freeze([
    ["GK",50,90], ["CB",34,68], ["CB",50,68], ["CB",66,68],
    ["LM",16,44], ["DM",42,49], ["AM",50,38], ["AM",58,42], ["RM",84,44], ["ST",40,18], ["ST",60,18],
  ]),
  "5-3-2":Object.freeze([
    ["GK",50,90], ["LB",12,69], ["CB",31,69], ["CB",50,69], ["CB",69,69], ["RB",88,69],
    ["DM",50,50], ["AM",40,39], ["AM",60,39], ["ST",40,18], ["ST",60,18],
  ]),
  "5-4-1":Object.freeze([
    ["GK",50,90], ["LB",12,69], ["CB",31,69], ["CB",50,69], ["CB",69,69], ["RB",88,69],
    ["LM",18,43], ["DM",40,47], ["AM",60,41], ["RM",82,43], ["ST",50,17],
  ]),
});
const AI_TRAINING_BENCH_ROLES = Object.freeze(["GK", "CB", "LB", "RB", "DM", "AM", "ST"]);
const AI_TRAINING_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MIRROR_MARKETPLACE_COMMISSION_RATE = 0.3;
const MIRROR_MARKETPLACE_FULL_MULTIPLIER = 1.8;
const MIRROR_MARKETPLACE_FORCED_FULL_PRICE = 300;
const MIRROR_BATCH_MATCH_COUNT = 10;
const MIRROR_BATCH_MIN_MATCH_COUNT = 10;
const MIRROR_BATCH_MAX_MATCH_COUNT = 50;
const MIRROR_BATCH_PRICE_DIVISOR = 3;
const MIRROR_COMPUTE_NODE_TOKEN_MS = 12 * 60 * 60 * 1000;
const MIRROR_BATCH_SERVICE_FEE_RATE = 0.3;
const MIRROR_BATCH_MAX_ACTIVE_JOBS = 2;
const MIRROR_BATCH_CHAINS_PER_TICK = 20;
const MIRROR_MARKETPLACE_PRICES = Object.freeze(new Map([
  ["Akira", 200],
  ["皇马", 180],
  ["唱反调", 160],
  ["Aul", 140],
  ["AuI", 140],
  ["小黄", 120],
  ["Axero", 100],
  ["ZH", 80],
  ["卢卡", 60],
  ["罗哥", 40],
]));
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
const playerSummary = (player, xConfig = null) => ({ id:player.id, name:player.name, role:xConfig?.role ?? player.role, secondaryRole:xConfig?.secondaryRole ?? player.secondaryRole, pool:xConfig ? roleGroup(xConfig.role) : player.pool, overall:player.overall, grade:player.grade, nationality:player.nationality, club:player.club, heightCm:xConfig?.heightCm ?? player.heightCm, preferredFoot:player.preferredFoot, attributes:clone(xConfig?.attributes ?? player.attributes ?? {}), legendary:isS4Legend(player), xPlayer:isXPlayer(player), cardProfile:clone(player.cardProfile ?? null) });
const marketPlayerSummary = (player) => ({ id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole, pool:player.pool, overall:player.overall, grade:player.grade, nationality:player.nationality, club:player.club, legendary:isS4Legend(player), xPlayer:isXPlayer(player), cardProfile:clone(player.cardProfile ?? null) });
const playerDirectorySummary = (player) => ({ id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole, pool:player.pool, overall:player.overall, grade:player.grade, nationality:player.nationality, club:player.club, legendary:isS4Legend(player), legend:isS4Legend(player), xPlayer:isXPlayer(player), cardProfile:clone(player.cardProfile ?? null) });
const playerDirectoryDetailSummary = (player) => ({ ...playerDirectorySummary(player), heightCm:player.heightCm, preferredFoot:player.preferredFoot, attributes:clone(player.attributes ?? {}) });
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
    systemRecoveryValue:player ? s4SingleCardReleaseValue(player, card.upgradeLevel) : 0,
    systemRecyclable:Number(card.upgradeLevel ?? 0) <= S4_SINGLE_CARD_RECOVERY_MAX_UPGRADE_LEVEL,
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
      ...playerDirectoryDetailSummary(player),
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

function injuryAbsenceMatches(player) {
  return Math.max(1, Math.round(Number(player?.injury?.injuryRounds ?? player?.injury?.matches ?? 1)));
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
    captainId:null,
    captainStyle:DEFAULT_CAPTAIN_STYLE,
    tacticalPlans:{
      opening:{ tactic:["positive", "balanced", "defensive", "balanced", "allOutAttack"][index % 5], style:["possession", "wingPlay", "counterAttack", "highPress", "longBall", "lowBlock"][index % 6], positionPreset:"position1" },
      leading:{ tactic:"defensive", style:"counterAttack", positionPreset:"position2", triggerGoalDifference:1 },
      trailing:{ tactic:"positive", style:"possession", positionPreset:"position3", triggerGoalDifference:1 },
    },
    playerState:{},
    chemistry:{},
    championBadges:[],
    seasonFinalChampionStars:[],
    table:freshTable(),
    form:[],
    fitnessUpdatedAt:null,
  };
}

function createState(now, seasonName = "S1") {
  const teams = Array.from({ length:TEAM_COUNT }, (_, index) => initialTeam(index));
  return {
    version:2,
    ruleset:"S4",
    season:{ id:`${seasonName}-${localDateKey(new Date(now))}`, name:seasonName, date:localDateKey(new Date(now)), status:"active", currentRound:0, totalRounds:18, nextRoundAt:null, firstRoundAt:null, startedAt:now, completedAt:null, seasonFinalLeagueRanks:null, seasonFinalLeagueRound:null, seasonFinalLeagueLockedAt:null },
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
    lineupShares:{},
    matchPredictions:{ schemaVersion:1, markets:{}, bets:[], distributions:[] },
    ballonDor:{ schemaVersion:3, reconciliationVersion:BALLON_DOR_RECONCILIATION_VERSION, results:[] },
    honorRoom:clone(HONOR_ROOM_SEED),
    shopOffers:{},
    rewardOffers:{},
    adminPackGrants:[],
    adminCoinGrants:[],
    adminCoinPenalties:[],
    adminXGrowthGrants:[],
    adminMailBroadcasts:[],
    discipline:{ rewardSuspensions:{}, actions:[], withheldRewards:[] },
    s4Assets:{ schemaVersion:1, nextCardSequence:1, ownerships:{}, cards:{}, traitOffers:{}, rosterLimitBonuses:{}, cosmetics:{ schemaVersion:1, inventory:{}, equipped:{} }, transactions:[] },
    s4RosterEnforcement:{ schemaVersion:1, active:false, rosterLimit:S4_ROSTER_LIMIT, runId:null, seed:null, appliedAt:null, audit:[] },
    s4Packs:{ schemaVersion:1, nextSequence:1, inventory:{}, offers:{}, batchOpenings:{}, grants:[], cardGrants:[], legacyRetiredAt:now },
    liveRound:null,
    liveCupRound:null,
    liveSeasonFinalRound:null,
    liveFriendlies:[],
    mirrorMarketplace:{ uploads:{}, usageByDate:{}, settledDates:[], batchJobs:[], batchReceipts:[], computeNodes:{} },
    cup:{ format:null, status:"waiting", stage:"waiting", participants:[], table:{}, leagueRounds:[], swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, finalStartedAt:null, completedAt:null },
    seasonFinalTournament:null,
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
async function atomicWriteAsync(filePath, value, options = {}) {
  const temporary = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await mkdirAsync(path.dirname(filePath), { recursive:true });
  const descriptor = await openAsync(temporary, "w");
  try {
    await descriptor.writeFile(JSON.stringify(value, null, options.compact ? undefined : 2), "utf8");
    await descriptor.sync();
  } finally { await descriptor.close(); }
  await renameAsync(temporary, filePath);
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

function nextFriendlySlot(now, minuteMarks = IN_SEASON_FRIENDLY_MINUTE_MARKS) {
  const date = new Date(now);
  date.setSeconds(0, 0);
  for (const minute of minuteMarks) {
    date.setMinutes(minute, 0, 0);
    if (date.getTime() > now) return date.getTime();
  }
  date.setHours(date.getHours() + 1, minuteMarks[0], 0, 0);
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

function seededConditions(seed, options = {}) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  const rng = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return { weather:drawYdlV2Weather(rng, { ...options, weatherWeights:STABLE_V21_PARAMETERS.environment.weatherWeights }), referee:drawVersusReferee(rng) };
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

function seededUnitInterval(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619) >>> 0;
  }
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 4294967296;
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

const LINEUP_SCHEME_LIMIT = 3;
const LINEUP_SCHEME_COMPETITIONS = Object.freeze(["league", "cup", "friendly"]);
const LINEUP_SHARE_TTL_MS = 72 * 60 * 60 * 1000;

function normalizedLineupSchemeCompetition(value) {
  const competition = String(value ?? "");
  return competition === "all" || LINEUP_SCHEME_COMPETITIONS.includes(competition) ? competition : null;
}

function lineupSchemeSnapshot(team, id = "lineup-1", name = "方案 1") {
  return clone({
    id,
    name,
    revision:Math.max(0, Math.floor(Number(team.lineupSchemeRevision ?? 0))),
    preferredStarterIds:team.preferredStarterIds ?? [],
    positions:team.positions ?? {},
    positionPresets:team.positionPresets ?? {},
    formationLinePresets:team.formationLinePresets ?? {},
    tactic:team.tactic,
    style:team.style,
    attackFocus:team.attackFocus,
    defenseFocus:team.defenseFocus,
    fitnessThreshold:team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD,
    captainId:team.captainId ?? null,
    captainStyle:normalizeCaptainStyle(team.captainStyle),
    tacticalPlans:team.tacticalPlans ?? {},
    competitionScope:normalizedLineupSchemeCompetition(team.competitionScope) ?? undefined,
  });
}

function applyLineupScheme(team, scheme) {
  team.preferredStarterIds = clone(scheme.preferredStarterIds ?? []);
  team.positionPresets = clone(scheme.positionPresets ?? {});
  team.formationLinePresets = clone(scheme.formationLinePresets ?? {});
  team.positions = clone(scheme.positions ?? team.positionPresets.position1 ?? {});
  team.tactic = scheme.tactic ?? team.tactic;
  team.style = scheme.style ?? team.style;
  team.attackFocus = scheme.attackFocus ?? team.attackFocus;
  team.defenseFocus = scheme.defenseFocus ?? team.defenseFocus;
  team.fitnessThreshold = scheme.fitnessThreshold ?? team.fitnessThreshold;
  team.tacticalPlans = clone(scheme.tacticalPlans ?? team.tacticalPlans);
  team.captainId = scheme.captainId ?? null;
  team.captainStyle = normalizeCaptainStyle(scheme.captainStyle);
}

function syncActiveLineupScheme(team) {
  const active = team.lineupSchemes?.find((scheme) => scheme.id === team.activeLineupSchemeId);
  if (!active) return;
  const revision = Math.max(0, Math.floor(Number(active.revision ?? 0)));
  const snapshot = lineupSchemeSnapshot({ ...team, competitionScope:active.competitionScope }, active.id, active.name);
  Object.assign(active, snapshot, { revision });
}

function rebuildLineupSchemeAssignments(team, preferredSchemeId = null) {
  const schemes = team.lineupSchemes ?? [];
  const preferred = schemes.find((scheme) => scheme.id === preferredSchemeId) ?? null;
  const fallback = schemes.find((scheme) => scheme.competitionScope === "all")
    ?? schemes.find((scheme) => scheme.id === team.activeLineupSchemeId)
    ?? schemes[0];
  if (!fallback) return;
  const assignments = Object.fromEntries(LINEUP_SCHEME_COMPETITIONS.map((competition) => [competition, fallback.id]));
  if (preferred?.competitionScope === "all") {
    LINEUP_SCHEME_COMPETITIONS.forEach((competition) => { assignments[competition] = preferred.id; });
  } else {
    schemes.filter((scheme) => scheme !== preferred).forEach((scheme) => {
      if (LINEUP_SCHEME_COMPETITIONS.includes(scheme.competitionScope)) assignments[scheme.competitionScope] = scheme.id;
    });
    if (preferred && LINEUP_SCHEME_COMPETITIONS.includes(preferred.competitionScope)) assignments[preferred.competitionScope] = preferred.id;
  }
  team.lineupSchemeAssignments = assignments;
}

function lineupTeamForCompetition(team, competition) {
  if (!team?.ownerId) return team;
  const schemeId = team.lineupSchemeAssignments?.[competition];
  const scheme = team.lineupSchemes?.find((entry) => entry.id === schemeId);
  if (!scheme) return team;
  const configured = { ...team };
  applyLineupScheme(configured, scheme);
  return configured;
}

function repairLineupSchemeAfterDeparture(team, scheme, playerId) {
  const draft = {
    rosterIds:[...team.rosterIds],
    preferredStarterIds:clone(scheme.preferredStarterIds ?? []),
    positions:clone(scheme.positions ?? {}),
    positionPresets:clone(scheme.positionPresets ?? {}),
  };
  removeRosterPlayerPreservingShape(draft, playerId);
  scheme.preferredStarterIds = draft.preferredStarterIds;
  scheme.positions = draft.positions;
  scheme.positionPresets = draft.positionPresets;
  if (scheme.captainId === playerId) scheme.captainId = null;
}

function repairLineupSchemeAgainstRoster(team, scheme) {
  const rosterIds = [...new Set((team.rosterIds ?? []).filter((id) => REAL_PLAYER_BY_ID[id]))];
  const rosterSet = new Set(rosterIds);
  const draft = {
    rosterIds,
    preferredStarterIds:[...new Set(scheme.preferredStarterIds ?? [])],
    positions:clone(scheme.positions ?? {}),
    positionPresets:clone(scheme.positionPresets ?? {}),
  };
  POSITION_PRESET_KEYS.forEach((key) => { draft.positionPresets[key] ??= clone(draft.positions); });

  const unavailableStarterIds = draft.preferredStarterIds.filter((id) => !rosterSet.has(id));
  unavailableStarterIds.forEach((playerId) => removeRosterPlayerPreservingShape(draft, playerId));

  // Older card-trade settlements removed the departed IDs from the starter list but
  // left their coordinates behind. Recreate those vacancies so the normal
  // shape-preserving replacement logic can repair already-saved nine/ten-man teams.
  const targetSize = Math.min(11, rosterIds.length);
  const stalePositionIds = Object.keys(draft.positionPresets.position1 ?? {})
    .filter((id) => !rosterSet.has(id) && !draft.preferredStarterIds.includes(id));
  while (draft.preferredStarterIds.length < targetSize && stalePositionIds.length) {
    const playerId = stalePositionIds.shift();
    draft.preferredStarterIds.push(playerId);
    removeRosterPlayerPreservingShape(draft, playerId);
  }

  if (draft.preferredStarterIds.length < targetSize) {
    const fallbackIds = pickStartingIds(rosterIds).filter((id) => !draft.preferredStarterIds.includes(id));
    const fallbackPositions = leagueBoardPositions(pickStartingIds(rosterIds).map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean));
    fallbackIds.forEach((playerId) => {
      if (draft.preferredStarterIds.length >= targetSize) return;
      draft.preferredStarterIds.push(playerId);
      POSITION_PRESET_KEYS.forEach((key) => {
        draft.positionPresets[key][playerId] = clone(fallbackPositions[playerId] ?? { x:50, y:50 });
      });
    });
    draft.positions = clone(draft.positionPresets.position1);
  }

  scheme.preferredStarterIds = draft.preferredStarterIds;
  scheme.positions = draft.positions;
  scheme.positionPresets = draft.positionPresets;
  if (!draft.preferredStarterIds.includes(scheme.captainId)) scheme.captainId = null;
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

function aiSubstitutes(teamIndex, roundNumber, humanOwned, starters) {
  const excluded = new Set([...humanOwned, ...starters.map((player) => player.id)]);
  const take = (pool, count) => seededShuffle(
    REAL_PLAYER_POOLS[pool].filter((player) => !excluded.has(player.id)),
    `ai-bench:${teamIndex}:${roundNumber}:${pool}`,
  ).slice(0, count);
  return [...take("GK", 1), ...take("DEF", 2), ...take("MID", 2), ...take("ATT", 2)];
}

function publicTeam(team, includeRoster = false, equippedBadge = null, equippedClubBadge = null) {
  return {
    id:team.id, name:team.name, isAi:!team.ownerId, ownerId:team.ownerId, ownerName:team.ownerName, equippedBadge:equippedBadge ? clone(equippedBadge) : null, equippedClubBadge:equippedClubBadge ? clone(equippedClubBadge) : null, championBadges:clone(team.championBadges ?? []), seasonFinalStarCount:(team.seasonFinalChampionStars ?? []).length, table:{ ...team.table }, form:[...team.form], tactic:team.tactic, style:team.style, attackFocus:team.attackFocus, defenseFocus:team.defenseFocus,
    fitnessThreshold:team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD,
    captainId:team.captainId ?? null,
    captainStyle:normalizeCaptainStyle(team.captainStyle),
    tacticalPlans:clone(team.tacticalPlans ?? { opening:{ tactic:team.tactic, style:team.style, positionPreset:"position1" }, leading:{ tactic:"defensive", style:"counterAttack", positionPreset:"position2" }, trailing:{ tactic:"positive", style:"possession", positionPreset:"position3" } }),
    roster:includeRoster ? team.rosterIds.map((id) => ({ ...playerSummary(REAL_PLAYER_BY_ID[id]), state:{ fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0, ...(team.playerState[id] ?? {}) }, starter:team.preferredStarterIds.includes(id), rosterOverlimitLocked:Boolean(team.playerState?.[id]?.rosterOverlimitLocked), listed:false })) : undefined,
    positions:includeRoster ? { ...team.positions } : undefined,
    positionPresets:includeRoster ? clone(team.positionPresets ?? Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, team.positions ?? {}]))) : undefined,
    formationLinePresets:includeRoster ? clone(team.formationLinePresets ?? {}) : undefined,
    activeLineupSchemeId:includeRoster ? team.activeLineupSchemeId : undefined,
    lineupSchemes:includeRoster ? clone(team.lineupSchemes ?? []) : undefined,
    lineupSchemeAssignments:includeRoster ? clone(team.lineupSchemeAssignments ?? {}) : undefined,
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
    this.liveCheckpointIo = Promise.resolve();
    this.liveSettlementPersistTimer = null;
    this.cachedV2ReviewDemo = null;
    this.liveSettlementJobs = [];
    this.liveSettlementJobKeys = new Set();
    this.liveSettlementJobTimer = null;
    this.liveSettlementWaiters = [];
    this.liveAiTrainings = new Map();
    this.liveAdvanceCursors = { league:0, cup:0, friendly:0, aiTraining:0, auxiliary:0 };
    this.liveAdvanceRunning = false;
    this.mirrorBatchWorkers = new Map();
    this.playerDirectoryCache = null;
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
    this.state.s4RosterEnforcement ??= { schemaVersion:1, active:false, rosterLimit:S4_ROSTER_LIMIT, runId:null, seed:null, appliedAt:null, audit:[] };
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
    this.state.liveSeasonFinalRound ??= null;
    this.state.liveFriendlies ??= [];
    this.restoreLiveCheckpoints();
    const resumedLiveEntries = [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveSeasonFinalRound?.matches ?? []), ...this.state.liveFriendlies];
    resumedLiveEntries.forEach((live) => {
      const match = live?.match;
      if (match?.version !== 2 || match.finished) return;
      match.rng = createV2MatchRng(`${match.simulationSeed ?? "ydl-v2"}:resume:${match.nextChainIndex ?? 0}:${match.events?.length ?? 0}`);
    });
    this.state.cup ??= { format:null, status:"waiting", stage:"waiting", participants:[], table:{}, leagueRounds:[], swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, finalStartedAt:null, completedAt:null };
    this.state.cup.finalStartedAt ??= null;
    this.state.seasonFinalTournament ??= null;
    this.state.season.seasonFinalLeagueRanks ??= null;
    this.state.season.seasonFinalLeagueRound ??= null;
    this.state.season.seasonFinalLeagueLockedAt ??= null;
    this.state.cup.format ??= this.state.cup.stage === "swiss" ? "swiss-v1" : null;
    this.state.cup.leagueRounds ??= [];
    this.state.cup.swissRounds ??= [];
    Object.values(this.state.cup.table ?? {}).forEach((entry) => { entry.status ??= "active"; entry.drawn ??= 0; });
    this.state.completedBroadcasts ??= [];
    this.state.reports ??= {};
    this.state.inbox ??= {};
    this.state.inboxDeleted ??= {};
    this.state.cardTradeOffers ??= [];
    this.state.friendlyInvitations ??= [];
    this.state.friendlyFixtures ??= [];
    this.state.lineupShares ??= {};
    this.state.mirrorMarketplace ??= { uploads:{}, usageByDate:{}, settledDates:[] };
    this.state.mirrorMarketplace.uploads ??= {};
    this.state.mirrorMarketplace.usageByDate ??= {};
    this.state.mirrorMarketplace.settledDates ??= [];
    this.state.mirrorMarketplace.batchJobs ??= [];
    this.state.mirrorMarketplace.batchReceipts ??= [];
    this.state.mirrorMarketplace.computeNodes ??= {};
    this.state.mirrorMarketplace.batchJobs.forEach((job) => {
      job.executionNode ??= MIRROR_BATCH_CLOUD_NODE;
      job.directorSurcharge = Math.max(0, Number(job.directorSurcharge ?? 0));
      job.directorServiceFeeRevenue = Math.max(0, Number(job.directorServiceFeeRevenue ?? 0));
      job.playerComputeNodeServiceFeeRevenue = Math.max(0, Number(job.playerComputeNodeServiceFeeRevenue ?? 0));
      const match = job.activeMatch;
      if (match?.version === 2 && !match.finished) match.rng = createV2MatchRng(`${match.simulationSeed ?? "ydl-v2"}:resume:${match.nextChainIndex ?? 0}:${match.events?.length ?? 0}`);
    });
    const completedBatchJobIds = new Set(this.state.mirrorMarketplace.batchReceipts.map((receipt) => receipt.id));
    this.state.mirrorMarketplace.batchJobs = this.state.mirrorMarketplace.batchJobs.filter((job) => {
      if (job.status !== "completed") return true;
      const mailed = (this.state.inbox[job.teamId] ?? []).some((message) => message.type === "mirror-batch-report" && message.payload?.mirrorBatchJobId === job.id);
      if (!mailed) return true;
      if (!completedBatchJobIds.has(job.id)) this.state.mirrorMarketplace.batchReceipts.push({ ...this.mirrorBatchJobView(job), ownerId:job.ownerId, teamId:job.teamId });
      return false;
    });
    this.state.mirrorMarketplace.batchReceipts = this.state.mirrorMarketplace.batchReceipts
      .sort((left, right) => Number(left.completedAt ?? left.createdAt) - Number(right.completedAt ?? right.createdAt))
      .slice(-500);
    this.state.matchPredictions ??= { schemaVersion:1, markets:{}, bets:[], distributions:[] };
    this.state.matchPredictions.schemaVersion = 1;
    this.state.matchPredictions.markets ??= {};
    this.state.matchPredictions.bets ??= [];
    this.state.matchPredictions.distributions ??= [];
    this.state.ballonDor ??= { schemaVersion:3, results:[] };
    this.state.ballonDor.schemaVersion = 3;
    this.state.ballonDor.results ??= [];
    const shouldReconcileBallonDor = Number(this.state.ballonDor.reconciliationVersion ?? 0) < BALLON_DOR_RECONCILIATION_VERSION;
    this.state.honorRoom ??= clone(HONOR_ROOM_SEED);
    this.state.honorRoom.schemaVersion = 1;
    this.state.honorRoom.processedSeasonIds ??= [];
    this.state.honorRoom.clubs ??= {};
    this.state.honorRoom.nextSeasonNumber = Math.max(1, Number(this.state.honorRoom.nextSeasonNumber ?? this.state.honorRoom.processedSeasonIds.length + 1));
    this.state.dailyAutomation ??= {};
    this.state.dailyAutomation.enabled ??= false;
    this.state.dailyAutomation.activatedAt ??= null;
    this.state.dailyAutomation.initializedDate ??= localDateKey(new Date(this.now()));
    this.state.dailyAutomation.lastRewardedSeasonId ??= null;
    this.state.dailyAutomation.lastResetDate ??= null;
    this.state.dailyAutomation.lastCupStartDate ??= null;
    this.state.dailyAutomation.settlements ??= [];
    this.state.teams.forEach((team) => {
      this.ensureClubManagement(team);
      team.chemistry ??= {};
      team.championBadges ??= [];
      team.seasonFinalChampionStars ??= [];
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
        const preset = POSITION_PRESET_KEYS[index];
        const roles = inferFormationBoardRoles((team.preferredStarterIds ?? []).map((id) => ({ id, position:team.positionPresets[preset]?.[id] })), team.formationLinePresets[preset]);
        const playerDuties = sanitizeV2PlayerDuties(team.tacticalPlans[state].playerDuties, team.preferredStarterIds, roles);
        if (Object.keys(playerDuties).length) team.tacticalPlans[state].playerDuties = playerDuties;
        else delete team.tacticalPlans[state].playerDuties;
        if (state !== "opening") team.tacticalPlans[state].triggerGoalDifference = Math.max(1, Math.min(5, Math.round(Number(team.tacticalPlans[state].triggerGoalDifference) || 1)));
      });
      const legacyScheme = lineupSchemeSnapshot(team);
      team.lineupSchemes = (Array.isArray(team.lineupSchemes) ? team.lineupSchemes : [legacyScheme]).slice(0, LINEUP_SCHEME_LIMIT).map((scheme, index) => ({
        ...lineupSchemeSnapshot({ ...team, ...scheme }, String(scheme?.id || `lineup-${index + 1}`), String(scheme?.name || `方案 ${index + 1}`).trim().slice(0, 20) || `方案 ${index + 1}`),
        revision:Math.max(0, Math.floor(Number(scheme?.revision ?? 0))),
      }));
      if (!team.lineupSchemes.length) team.lineupSchemes = [legacyScheme];
      if (!team.lineupSchemes.some((scheme) => scheme.id === team.activeLineupSchemeId)) team.activeLineupSchemeId = team.lineupSchemes[0].id;
      team.lineupSchemeAssignments = Object.fromEntries(LINEUP_SCHEME_COMPETITIONS.map((competition) => {
        const assignedId = team.lineupSchemeAssignments?.[competition];
        return [competition, team.lineupSchemes.some((scheme) => scheme.id === assignedId) ? assignedId : team.activeLineupSchemeId];
      }));
      team.lineupSchemes.forEach((scheme) => {
        if (normalizedLineupSchemeCompetition(scheme.competitionScope)) return;
        const assignedCompetitions = LINEUP_SCHEME_COMPETITIONS.filter((competition) => team.lineupSchemeAssignments[competition] === scheme.id);
        scheme.competitionScope = assignedCompetitions.length === 1 ? assignedCompetitions[0] : "all";
      });
      team.lineupSchemes.forEach((scheme) => repairLineupSchemeAgainstRoster(team, scheme));
      applyLineupScheme(team, team.lineupSchemes.find((scheme) => scheme.id === team.activeLineupSchemeId));
      Object.keys(team.playerState ?? {}).filter((playerId) => !team.rosterIds.includes(playerId)).forEach((playerId) => {
        delete team.playerState[playerId];
        removePlayerChemistry(team, playerId);
      });
    });
    if (this.state.season.status === "active" && (!this.state.season.nextRoundAt || this.state.season.nextRoundAt < this.now())) this.state.season.nextRoundAt = nextSlot(this.now());
    if (this.state.season.status === "registration") this.state.season.nextRoundAt = null;
    if (this.state.cup.status === "active" && this.state.season.firstRoundAt) {
      const earliestCupAt = this.state.season.firstRoundAt + 10 * 60 * 1000;
      if (!this.state.cup.nextRoundAt || this.state.cup.nextRoundAt < earliestCupAt) this.state.cup.nextRoundAt = nextCupSlot(this.now(), this.state.season.firstRoundAt);
    }
    this.adoptState(this.state, false);
    if (shouldReconcileBallonDor) {
      this.backupFile(this.shardStore ? `pre-ballon-dor-reconciliation-v${BALLON_DOR_RECONCILIATION_VERSION}.manifest.json` : `pre-ballon-dor-reconciliation-v${BALLON_DOR_RECONCILIATION_VERSION}.json`);
      if (this.reconcileHistoricalBallonDor()) this.save();
    }
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
    if (this.state.liveRound || this.state.liveCupRound || this.state.liveFriendlies?.length) {
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
    const liveByCode = new Map([...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveSeasonFinalRound?.matches ?? []), ...this.state.liveFriendlies].map((live) => [String(live.code).toUpperCase(), live]));
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
    if (!force && !this.liveCheckpointPersistedAt.has(live.code)) {
      const codeHash = [...String(live.code)].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0);
      const spreadWindow = Math.max(1, LIVE_MATCH_PERSIST_INTERVAL_MS - 1_000);
      const staggerMs = Math.min(LIVE_MATCH_PERSIST_INTERVAL_MS, 1_000 + codeHash % spreadWindow);
      const startedAt = Number(live.startedAt ?? live.match.startedAt ?? now);
      this.liveCheckpointPersistedAt.set(live.code, startedAt + staggerMs - LIVE_MATCH_PERSIST_INTERVAL_MS);
    }
    const lastPersistedAt = Number(this.liveCheckpointPersistedAt.get(live.code) ?? 0);
    if (!force && now - lastPersistedAt < LIVE_MATCH_PERSIST_INTERVAL_MS) return false;
    this.liveCheckpointPersistedAt.set(live.code, now);
    const checkpoint = { version:1, code:live.code, persistedAt:now, match:live.match };
    this.liveCheckpointIo = this.liveCheckpointIo
      .then(() => atomicWriteAsync(checkpointPath, checkpoint, { compact:true }))
      .catch((error) => {
        if (this.liveCheckpointPersistedAt.get(live.code) === now) this.liveCheckpointPersistedAt.delete(live.code);
        console.error(`YDL直播检查点异步写入失败：${live.code}`, error);
      });
    return true;
  }

  flushLiveCheckpointIo() { return this.liveCheckpointIo; }

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
    this.liveSettlementPersistTimer = setTimeout(async () => {
      this.liveSettlementPersistTimer = null;
      const completedCodes = [...this.pendingLiveCheckpointCleanup];
      try {
        await this.flushLiveCheckpointIo();
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

  queueLiveSettlement(live, settle) {
    const key = String(live?.code ?? "");
    if (!key || live.settlementPending || live.completed || this.liveSettlementJobKeys.has(key)) return false;
    live.settlementPending = true;
    this.liveSettlementJobKeys.add(key);
    this.liveSettlementJobs.push({ key, live, settle });
    this.scheduleNextLiveSettlementJob(0);
    return true;
  }

  scheduleNextLiveSettlementJob(delay = LIVE_SETTLEMENT_JOB_GAP_MS) {
    if (this.liveSettlementJobTimer || !this.liveSettlementJobs.length) return;
    this.liveSettlementJobTimer = setTimeout(() => {
      this.liveSettlementJobTimer = null;
      const job = this.liveSettlementJobs.shift();
      try { job.settle(); }
      catch (error) {
        job.live.settlementPending = false;
        console.error(`YDL直播延后结算失败：${job.key}`, error);
      } finally {
        this.liveSettlementJobKeys.delete(job.key);
        if (this.liveSettlementJobs.length) this.scheduleNextLiveSettlementJob();
        else this.resolveLiveSettlementWaiters();
      }
    }, delay);
  }

  resolveLiveSettlementWaiters() {
    if (this.liveSettlementJobs.length || this.liveSettlementJobTimer) return;
    const waiters = this.liveSettlementWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
  }

  flushLiveSettlementJobs() {
    if (!this.liveSettlementJobs.length && !this.liveSettlementJobTimer) return Promise.resolve();
    return new Promise((resolve) => this.liveSettlementWaiters.push(resolve));
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

  rosterLimit(accountId) {
    return rosterLimitForOwner(this.state, accountId);
  }

  rosterOverlimitLocked(team, playerId) {
    return Boolean(team?.playerState?.[playerId]?.rosterOverlimitLocked);
  }

  rosterEnforcementPreview() {
    const rosterLimit = S4_ROSTER_LIMIT;
    const players = this.state.teams.filter((team) => team.ownerId).map((team) => {
      const rosterSlotsUsed = rosterSlotUsage(this.state, team.ownerId);
      const excessCount = Math.max(0, rosterSlotsUsed - rosterLimit);
      const lockedPlayerIds = excessCount > 0
        ? [...(team.rosterEnforcement?.lockedPlayerIds ?? [])].filter((id) => team.rosterIds?.includes(id) && Boolean(team.playerState?.[id]?.rosterOverlimitLocked)).slice(0, excessCount)
        : [];
      return {
        accountId:team.ownerId, ownerName:team.ownerName, teamId:team.id, teamName:team.name,
        rosterSlotsUsed, rosterLimit, excessCount,
        alreadyApplied:Boolean(excessCount > 0 && team.rosterEnforcement?.overLimit), lockedPlayerIds,
        lockedPlayerNames:lockedPlayerIds.map((id) => REAL_PLAYER_BY_ID[id]?.name ?? id),
      };
    }).filter((entry) => entry.excessCount > 0 || entry.alreadyApplied);
    return { active:Boolean(this.state.s4RosterEnforcement?.active), rosterLimit, generatedAt:this.now(), playerCount:players.length, totalExcess:players.reduce((sum, entry) => sum + entry.excessCount, 0), players };
  }

  applyRosterEnforcement(options = {}) {
    if (options.confirm !== "APPLY_ROSTER_LIMIT_33") throw new Error("需要确认执行33人大名单清退");
    ensureS4Assets(this.state);
    this.state.s4RosterEnforcement ??= { schemaVersion:1, active:false, rosterLimit:S4_ROSTER_LIMIT, audit:[] };
    const runId = String(options.runId ?? `roster-limit-33-${this.now()}`);
    const seed = String(options.seed ?? runId);
    const backupName = this.shardStore ? `before-roster-enforcement-${runId}.manifest.json` : `before-roster-enforcement-${runId}.json`;
    const backupPath = this.backupFile(backupName);
    this.state.s4RosterEnforcement = { schemaVersion:1, active:true, rosterLimit:S4_ROSTER_LIMIT, runId, seed, appliedAt:this.now(), audit:[] };
    const players = [];
    for (const team of this.state.teams.filter((entry) => entry.ownerId)) {
      this.state.s4Assets.rosterLimitBonuses[team.ownerId] = 0;
      const rosterSlotsUsed = rosterSlotUsage(this.state, team.ownerId);
      const excessCount = Math.max(0, rosterSlotsUsed - S4_ROSTER_LIMIT);
      const families = [...new Set((team.rosterIds ?? []).filter((id) => rosterFamilyUsesSlot(this.state, team.ownerId, id)))];
      const lockedPlayerIds = seededShuffle(families, `${seed}:${team.ownerId}`).slice(0, excessCount);
      team.playerState ??= {};
      for (const playerId of families) {
        const state = team.playerState[playerId] ?? (team.playerState[playerId] = { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 });
        if (lockedPlayerIds.includes(playerId)) Object.assign(state, { rosterOverlimitLocked:true, rosterOverlimitLockedAt:this.now(), rosterOverlimitRunId:runId });
        else { delete state.rosterOverlimitLocked; delete state.rosterOverlimitLockedAt; delete state.rosterOverlimitRunId; }
      }
      team.rosterEnforcement = { overLimit:excessCount > 0, rosterLimit:S4_ROSTER_LIMIT, excessCount, lockedPlayerIds, appliedAt:this.now(), runId };
      const entry = { accountId:team.ownerId, teamId:team.id, rosterSlotsUsed, excessCount, lockedPlayerIds };
      players.push(entry);
      this.state.s4RosterEnforcement.audit.push(entry);
    }
    this.save();
    return { runId, backupPath, rosterLimit:S4_ROSTER_LIMIT, playerCount:players.filter((entry) => entry.excessCount > 0).length, totalLocked:players.reduce((sum, entry) => sum + entry.lockedPlayerIds.length, 0), players };
  }

  reconcileRosterOverlimitState(team) {
    if (!this.state.s4RosterEnforcement?.active || !team?.ownerId) return;
    const rosterSlotsUsed = rosterSlotUsage(this.state, team.ownerId);
    const excessCount = Math.max(0, rosterSlotsUsed - S4_ROSTER_LIMIT);
    if (!excessCount) {
      team.rosterEnforcement = { ...(team.rosterEnforcement ?? {}), overLimit:false, excessCount:0, lockedPlayerIds:[], resolvedAt:this.now() };
      Object.values(team.playerState ?? {}).forEach((state) => { delete state.rosterOverlimitLocked; delete state.rosterOverlimitLockedAt; delete state.rosterOverlimitRunId; });
      return;
    }
    const families = [...new Set((team.rosterIds ?? []).filter((id) => rosterFamilyUsesSlot(this.state, team.ownerId, id)))];
    const retained = (team.rosterEnforcement?.lockedPlayerIds ?? []).filter((id) => families.includes(id));
    const additions = seededShuffle(families.filter((id) => !retained.includes(id)), `${this.state.s4RosterEnforcement.seed}:${team.ownerId}`).slice(0, Math.max(0, excessCount - retained.length));
    const lockedPlayerIds = [...new Set([...retained, ...additions])].slice(0, excessCount);
    team.rosterEnforcement = { ...(team.rosterEnforcement ?? {}), overLimit:true, rosterLimit:S4_ROSTER_LIMIT, excessCount, lockedPlayerIds };
    families.forEach((id) => { const state = team.playerState[id] ?? (team.playerState[id] = {}); if (lockedPlayerIds.includes(id)) state.rosterOverlimitLocked = true; else delete state.rosterOverlimitLocked; });
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
    team.playerState[playerId] ??= { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 };
  }

  removeEmptyRosterFamily(team, playerId) {
    if (this.playerCards(team.ownerId, playerId).length) return false;
    removeRosterPlayerPreservingShape(team, playerId);
    (team.lineupSchemes ?? []).forEach((scheme) => repairLineupSchemeAfterDeparture(team, scheme, playerId));
    const active = team.lineupSchemes?.find((scheme) => scheme.id === team.activeLineupSchemeId);
    if (active) applyLineupScheme(team, active);
    delete team.playerState[playerId];
    removePlayerChemistry(team, playerId);
    this.reconcileRosterOverlimitState(team);
    return true;
  }

  synchronizeRosterAfterCardTrade(team) {
    const cardRosterIds = [...new Set(this.playerCards(team.ownerId).map((card) => card.playerId))];
    const cardRosterSet = new Set(cardRosterIds);
    cardRosterIds.forEach((playerId) => this.ensureRosterFamily(team, playerId));
    [...team.rosterIds].filter((playerId) => !cardRosterSet.has(playerId)).forEach((playerId) => this.removeEmptyRosterFamily(team, playerId));
    team.rosterIds = team.rosterIds.filter((playerId) => cardRosterSet.has(playerId));
    cardRosterIds.forEach((playerId) => this.ensureRosterFamily(team, playerId));
  }

  grantS4Card(team, playerId, options = {}) {
    const alreadyUsesSlot = options.knownRosterFamily === true || rosterFamilyUsesSlot(this.state, team.ownerId, playerId);
    const willOwnRights = options.grantOwnership !== false && !isS4Legend(REAL_PLAYER_BY_ID[playerId]);
    const externalExempt = isS4Legend(REAL_PLAYER_BY_ID[playerId])
      || Boolean(options.externalAcquisition)
        && Number(options.upgradeLevel ?? 0) >= 5
        && !willOwnRights;
    if (!alreadyUsesSlot && !externalExempt && this.rosterSlotsUsed(team.ownerId) >= this.rosterLimit(team.ownerId)) {
      throw new Error(`${this.rosterLimit(team.ownerId)}人名单已满，请先出售或解约一名占用名额的球员`);
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

  cosmeticInventory(accountId) {
    const cosmetics = this.state.s4Assets.cosmetics;
    return cosmetics.inventory[accountId] ?? (cosmetics.inventory[accountId] = {});
  }

  equippedCosmeticIds(accountId) {
    const cosmetics = this.state.s4Assets.cosmetics;
    return cosmetics.equipped[accountId] ?? (cosmetics.equipped[accountId] = {});
  }

  equippedTeamBadge(accountId) {
    const itemId = accountId ? this.state.s4Assets.cosmetics?.equipped?.[accountId]?.teamBadge : null;
    return itemId && COUNTRY_BADGE_BY_ID[itemId] ? COUNTRY_BADGE_BY_ID[itemId] : null;
  }

  equippedClubBadge(accountId) {
    const itemId = accountId ? this.state.s4Assets.cosmetics?.equipped?.[accountId]?.clubBadge : null;
    return itemId && COSMETIC_BADGE_BY_ID[itemId]?.slot === "clubBadge" ? COSMETIC_BADGE_BY_ID[itemId] : null;
  }

  cosmeticsView(accountId) {
    const inventory = this.cosmeticInventory(accountId);
    const equipped = this.equippedCosmeticIds(accountId);
    const items = COSMETIC_BADGES
      .filter((item) => Number(inventory[item.id] ?? 0) > 0)
      .map((item) => ({ ...item, count:Number(inventory[item.id]), equipped:equipped[item.slot] === item.id, minimumListingPrice:COSMETIC_BADGE_MINIMUM_LISTING_PRICE }));
    const countryOwned = items.filter((item) => item.slot === "teamBadge").length;
    const clubOwned = items.filter((item) => item.slot === "clubBadge").length;
    return {
      schemaVersion:1,
      items,
      equipped:{ teamBadge:this.equippedTeamBadge(accountId), clubBadge:this.equippedClubBadge(accountId) },
      collection:{
        ownedUnique:items.length,
        total:COSMETIC_BADGES.length,
        country:{ ownedUnique:countryOwned, total:COUNTRY_BADGES.length },
        club:{ ownedUnique:clubOwned, total:CLUB_BADGES.length },
      },
    };
  }

  equipCosmetic(account, itemIdValue, slotValue = null, options = {}) {
    if (slotValue && typeof slotValue === "object") { options = slotValue; slotValue = null; }
    if (!this.accountTeam(account.id)) throw new Error("你还没有加入联赛");
    const itemId = String(itemIdValue ?? "").trim();
    const requestedSlot = ["teamBadge", "clubBadge"].includes(String(slotValue ?? "")) ? String(slotValue) : "teamBadge";
    const equipped = this.equippedCosmeticIds(account.id);
    if (!itemId) delete equipped[requestedSlot];
    else {
      const item = COSMETIC_BADGE_BY_ID[itemId];
      if (!item || Number(this.cosmeticInventory(account.id)[item.id] ?? 0) < 1) throw new Error("你尚未拥有这件装饰道具");
      equipped[item.slot] = item.id;
    }
    this.save();
    const teamBadgeDelta = this.equippedTeamBadge(account.id);
    const clubBadgeDelta = this.equippedClubBadge(account.id);
    if (options.compact) return this.compactMutationView(account, { ownTeam:true, cosmetics:true, extra:{ teamBadgeDelta, clubBadgeDelta } });
    return this.view(account);
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
    if (pack.adminOnly) throw new Error("该礼包只能由管理员发放");
    if (!pack) throw new Error("该礼包已下架或不存在");
    if (pack.retired) throw new Error("该礼包已下架或不存在");
    if (!Number.isInteger(count) || count < 1 || count > S4_MAX_PACK_PURCHASE_QUANTITY) throw new Error(`单次最多购买${S4_MAX_PACK_PURCHASE_QUANTITY}份礼包`);
    const purchasedQuantity = this.state.ledger
      .filter((entry) => entry.accountId === account.id && entry.type === "s4-pack-buy" && entry.packType === pack.id)
      .reduce((sum, entry) => sum + Number(entry.quantity ?? 1), 0);
    if (pack.seasonPurchaseLimit && (count > pack.seasonPurchaseLimit || purchasedQuantity + count > pack.seasonPurchaseLimit)) throw new Error(`${pack.name}整个赛季限购${pack.seasonPurchaseLimit}份`);
    const total = pack.price * count;
    if (this.wallet(account.id).balance < total) throw new Error("金币不足");
    this.wallet(account.id).balance -= total;
    const items = this.grantS4Pack(account.id, pack.id, count, { source:"shop" });
    if (options.skipAudit !== true) this.state.ledger.push({
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

  buyRosterExpansion(account, quantity = 1, options = {}) {
    throw new Error("大名单+1道具已下架，大名单上限已恢复为33人");
    const team = this.accountTeam(account.id);
    const count = Math.floor(Number(quantity));
    if (!team) throw new Error("你还没有加入联赛");
    if (!Number.isInteger(count) || count < 1) throw new Error("购买数量必须是正整数");
    const purchasedQuantity = rosterLimitBonusForOwner(this.state, account.id);
    const remainingQuantity = Math.max(0, S4_ROSTER_EXPANSION_LIMIT - purchasedQuantity);
    if (count > remainingQuantity) throw new Error(`付费大名单永久最多购买${S4_ROSTER_EXPANSION_LIMIT}个，当前还可购买${remainingQuantity}个`);
    const total = S4_ROSTER_EXPANSION_ITEM.price * count;
    const wallet = this.wallet(account.id);
    if (wallet.balance < total) throw new Error("金币不足");
    const rosterLimitBefore = this.rosterLimit(account.id);
    wallet.balance -= total;
    this.state.s4Assets.rosterLimitBonuses[account.id] = purchasedQuantity + count;
    this.state.ledger.push({
      id:makeId("ledger", `${account.id}-roster-expansion-${purchasedQuantity + count}`),
      accountId:account.id,
      amount:-total,
      type:"roster-expansion-buy",
      itemId:S4_ROSTER_EXPANSION_ITEM.id,
      quantity:count,
      unitPrice:S4_ROSTER_EXPANSION_ITEM.price,
      rosterLimitBefore,
      rosterLimitAfter:this.rosterLimit(account.id),
      createdAt:this.now(),
    });
    this.save();
    if (options.compact) return this.compactMutationView(account, { shop:true, ownTeam:true });
    return this.view(account);
  }


  ownsMeteorStand(accountId) {
    return Boolean(accountId) && this.state.ledger.some((entry) => entry.accountId === accountId && entry.type === "stadium-cosmetic-buy" && entry.itemId === METEOR_STAND_ITEM.id);
  }

  buyMeteorStand(account, options = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    if (this.ownsMeteorStand(account.id)) throw new Error("你已经拥有流星雨看台");
    const wallet = this.wallet(account.id);
    if (wallet.balance < METEOR_STAND_ITEM.price) throw new Error("金币不足");
    wallet.balance -= METEOR_STAND_ITEM.price;
    this.state.ledger.push({ id:makeId("ledger", `${account.id}-meteor-stand`), accountId:account.id, amount:-METEOR_STAND_ITEM.price, type:"stadium-cosmetic-buy", itemId:METEOR_STAND_ITEM.id, createdAt:this.now() });
    this.save();
    if (options.compact) return this.compactMutationView(account, { shop:true, ownTeam:true });
    return this.view(account, { includePlayerDirectory:false });
  }

  assertChoicePackRosterCapacity(accountId, pack, requestedCount = 1) {
    if (pack?.selectionMode !== "choice") return;
    // Legendary cards do not consume roster slots, so a full roster must not
    // block opening legendary choice packs.
    if (["legend", "cosmetic"].includes(pack?.kind)) return;
    if (pack?.choiceMode === "all" && pack.kind === "private") {
      if (!this.privatePackCandidates(accountId, pack).length) throw new Error(`${pack.name}当前没有可选的私有池球员`);
      return;
    }
    const rosterLimit = this.rosterLimit(accountId);
    const availableSlots = Math.max(0, rosterLimit - this.rosterSlotsUsed(accountId));
    if (availableSlots <= 0) throw new Error(`${rosterLimit}人名单已满，暂时无法打开需要选人的礼包。请先前往背包的球员卡管理回收、解约或出售球员；礼包不会被消耗`);
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
      if (options.compact) return this.compactMutationView(account, { s4Packs:true, extra:{ packOpening:result, s4CardDeltas:[{ playerId:result.player.id, card:result.card, ownershipGranted:false }], s4PlayerDeltas:[this.s4PlayerAssetDelta(account.id, result.player.id)], s4RosterSlotsUsed:this.rosterSlotsUsed(account.id) } });
      return { ...this.view(account), packOpening:result };
    }

    this.createS4ChoiceOffer(account, item, pack);
    this.save();
    if (options.compact) return this.compactMutationView(account, { s4Packs:true });
    return this.view(account);
  }

  openDirectS4Pack(account, team, item, pack, options = {}) {
    const legendaryHit = pack.id === "private-mixed" && this.rng() < S4_PRIVATE_MIXED_LEGEND_RATE;
    const candidates = legendaryHit ? this.legendPackCandidates() : options.candidates ?? this.privatePackCandidates(account.id, pack);
    if (!candidates.length) throw new Error(`${pack.name}当前没有可抽取的私有池球员`);
    const player = this.randomS4Players(candidates, 1)[0];
    const card = this.grantS4Card(team, player.id, {
      grantOwnership:false,
      acquisitionSource:legendaryHit ? "private-mixed-legend-hit" : "private-pack",
      knownRosterFamily:true,
    });
    item.status = "opened";
    item.openedAt = this.now();
    item.resultPlayerId = player.id;
    item.resultCardId = card.id;
    this.state.ledger.push({ id:makeId("ledger", item.id), accountId:account.id, amount:0, type:"s4-pack-open", packType:pack.id, packId:item.id, playerId:player.id, cardId:card.id, legendaryHit, createdAt:this.now() });
    if (options.skipAudit !== true) recordS4AssetTransaction(this.state, {
      id:makeId("asset-pack", item.id),
      type:"private-pack-card",
      playerId:player.id,
      cardIds:[card.id],
      toOwnerId:account.id,
      metadata:{ packId:item.id, packType:pack.id, legendaryHit },
      createdAt:this.now(),
    });
    const rawResult = { mode:"direct", packId:item.id, playerId:player.id, cardId:card.id, legendaryHit };
    return options.deferPublicResult ? rawResult : this.publicDirectS4PackResult(rawResult);
  }

  publicDirectS4PackResult(result) {
    const player = REAL_PLAYER_BY_ID[result.playerId];
    const card = this.state.s4Assets.cards[result.cardId];
    return { mode:result.mode, packId:result.packId, player:playerSummary(player), card:publicLeagueS4Card(this.state, card), legendaryHit:Boolean(result.legendaryHit) };
  }

  s4PlayerAssetDelta(accountId, playerId) {
    const source = REAL_PLAYER_BY_ID[playerId];
    if (!source) return null;
    const cards = this.playerCards(accountId, playerId);
    const activeCard = cards[0] ?? null;
    const ownsRights = ownershipOwner(this.state, playerId) === accountId;
    let ownershipReturnPreview = null;
    if (ownsRights && !isS4Legend(source) && cards.length) {
      const highestLevel = Math.max(...cards.map((card) => Number(card.upgradeLevel ?? 0)));
      const retained = highestLevel > 0 ? cards.filter((card) => Number(card.upgradeLevel ?? 0) === highestLevel) : [];
      const retainedIds = new Set(retained.map((card) => card.id));
      const recovered = cards.filter((card) => !retainedIds.has(card.id));
      const ownershipAmount = Math.floor(s4OwnershipReferenceValue(source) * S4_OWNERSHIP_RETURN_RATE);
      const recoveryAmount = recovered.reduce((sum, card) => sum + s4ForcedCardRecoveryValue(source, card.upgradeLevel), 0);
      ownershipReturnPreview = {
        retainedCardIds:retained.map((card) => card.id),
        retainedCardCount:retained.length,
        retainedUpgradeLevel:retained.length ? highestLevel : null,
        recoveredCardCount:recovered.length,
        recoveryAmount,
        ownershipAmount,
        totalAmount:recoveryAmount + ownershipAmount,
      };
    }
    return {
      playerId,
      listed:this.state.listings.some((item) => item.status === "active" && item.playerId === playerId),
      referencePrice:s4OwnershipReferenceValue(source),
      minimumPrice:ownershipMinimumListingPrice(source),
      activeCardId:activeCard?.id ?? null,
      upgradeLevel:Number(activeCard?.upgradeLevel ?? 0),
      baseOverall:source.overall,
      effectiveOverall:s4EffectiveOverall(source, activeCard?.upgradeLevel ?? 0),
      effectiveAttributes:applyS4Enhancement(source, activeCard?.upgradeLevel ?? 0).attributes,
      ownsRights,
      ownershipReturnPreview,
      rosterSlotUsed:rosterFamilyUsesSlot(this.state, accountId, playerId),
    };
  }

  s4RosterMutationDelta(accountId) {
    const team = this.accountTeam(accountId);
    if (!team) return null;
    const snapshot = publicTeam(team, true);
    return {
      rosterPlayerIds:snapshot.roster.map((player) => player.id),
      starterIds:snapshot.roster.filter((player) => player.starter).map((player) => player.id),
      positions:snapshot.positions,
      positionPresets:snapshot.positionPresets,
      formationLinePresets:snapshot.formationLinePresets,
      activeLineupSchemeId:snapshot.activeLineupSchemeId,
      lineupSchemes:snapshot.lineupSchemes,
      lineupSchemeAssignments:snapshot.lineupSchemeAssignments,
      chemistryLinks:snapshot.chemistryLinks,
      formation:snapshot.formation,
    };
  }

  s4RecoveryMutationView(account, options = {}) {
    const affectedPlayerIds = [...new Set((options.affectedPlayerIds ?? []).map(String))];
    const removedPlayerIds = [...new Set((options.removedPlayerIds ?? []).map(String))];
    return this.compactMutationView(account, { extra:{
      removedS4CardIds:[...new Set((options.removedCardIds ?? []).map(String))],
      removedS4PlayerIds:removedPlayerIds,
      returnedS4OwnershipPlayerIds:[...new Set((options.returnedOwnershipPlayerIds ?? []).map(String))],
      s4PlayerDeltas:affectedPlayerIds.map((playerId) => this.s4PlayerAssetDelta(account.id, playerId)),
      s4RosterSlotsUsed:this.rosterSlotsUsed(account.id),
      ...(removedPlayerIds.length ? { s4RosterDelta:this.s4RosterMutationDelta(account.id) } : {}),
      ...(options.extra ?? {}),
    } });
  }

  createS4ChoiceOffer(account, item, pack, batch = null) {
    if (pack.kind === "cosmetic") {

      const choices = drawCosmeticBadgeChoices(pack.cosmeticType, this.rng, 3);
      const offer = {
        id:makeId("s4-pack-offer", item.id),
        packId:item.id,
        packType:pack.id,
        ownerId:account.id,
        kind:pack.kind,
        cosmeticType:pack.cosmeticType,
        choiceMode:"random",
        itemIds:choices.map((choice) => choice.id),
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
    const candidates = pack.choiceMode === "all"
      ? pack.kind === "legend" ? this.legendPackCandidates() : this.privatePackCandidates(account.id, pack)
      : pack.kind === "legend" ? this.legendPackCandidates() : this.publicPackCandidates();
    const choices = pack.choiceMode === "all"
      ? candidates
      : pack.kind === "public"
      ? this.randomPublicS4Players(candidates, 3)
      : this.randomS4Players(candidates, 3);
    if (pack.choiceMode === "all" ? !choices.length : choices.length !== 3) throw new Error(`${pack.name}当前没有可选球员`);
    const offer = {
      id:makeId("s4-pack-offer", item.id),
      packId:item.id,
      packType:pack.id,
      ownerId:account.id,
      kind:pack.kind,
      choiceMode:pack.choiceMode ?? "random",
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

  publicS4PackOffer(offer) {
    if (!offer || offer.status !== "pending") return null;
    if (offer.kind === "cosmetic") return {
      ...clone(offer),
      items:(offer.itemIds ?? []).map((id) => COSMETIC_BADGE_BY_ID[id]).filter(Boolean),
      itemIds:undefined,
    };
    return {
      ...clone(offer),
      players:offer.playerIds.map((id) => playerSummary(REAL_PLAYER_BY_ID[id])),
      playerIds:undefined,
    };
  }

  publicS4BatchResult(result) {
    if (result.mode === "cosmetic-choice") {
      const item = COSMETIC_BADGE_BY_ID[result.itemId];
      return { mode:result.mode, packId:result.packId, item:item ? { ...item } : null };
    }
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
      const candidates = this.privatePackCandidates(account.id, pack);
      if (!candidates.length) throw new Error(`${pack.name}当前没有可抽取的私有池球员`);
      const rawResults = items.map((item) => this.openDirectS4Pack(account, team, item, pack, { candidates, deferPublicResult:true }));
      const results = rawResults.map((result) => this.publicDirectS4PackResult(result));
      this.save();
      const packBatchOpening = { id:makeId("s4-pack-batch", `${account.id}-${pack.id}`), mode:"direct", complete:true, packType:pack.id, total:results.length, results };
      if (options.compact) {
        const changedPlayerIds = [...new Set(results.map((result) => result.player.id))];
        return this.compactMutationView(account, { s4Packs:true, extra:{ packBatchOpening, s4CardDeltas:results.map((result) => ({ playerId:result.player.id, card:result.card, ownershipGranted:false })), s4PlayerDeltas:changedPlayerIds.map((playerId) => this.s4PlayerAssetDelta(account.id, playerId)), s4RosterSlotsUsed:this.rosterSlotsUsed(account.id) } });
      }
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

  chooseS4CosmeticPack(account, offerIdValue, itemIdValue, options = {}) {
    const team = this.accountTeam(account.id);
    const offer = this.state.s4Packs.offers[account.id];
    const itemId = String(itemIdValue ?? "");
    const item = this.s4PackInventory(account.id).find((candidate) => candidate.id === offer?.packId);
    const pack = S4_PACK_BY_ID[offer?.packType];
    const cosmetic = COSMETIC_BADGE_BY_ID[itemId];
    if (!team || !offer || offer.kind !== "cosmetic" || offer.status !== "pending" || offer.id !== String(offerIdValue ?? "") || !(offer.itemIds ?? []).includes(itemId) || !item || !pack || !cosmetic || cosmetic.kind !== pack.cosmeticType) {
      throw new Error("只能选择当前徽章包展示的徽章");
    }
    const inventory = this.cosmeticInventory(account.id);
    inventory[itemId] = Math.max(0, Number(inventory[itemId] ?? 0)) + 1;
    const equipped = this.equippedCosmeticIds(account.id);
    if (!equipped[cosmetic.slot]) equipped[cosmetic.slot] = itemId;
    offer.status = "selected";
    offer.selectedItemId = itemId;
    offer.closedAt = this.now();
    item.status = "opened";
    item.openedAt = this.now();
    item.resultCosmeticItemId = itemId;
    delete this.state.s4Packs.offers[account.id];
    this.state.ledger.push({ id:makeId("ledger", item.id), accountId:account.id, amount:0, type:"s4-pack-open", packType:pack.id, packId:item.id, cosmeticItemId:itemId, createdAt:this.now() });
    const packOpening = { mode:"cosmetic-choice", packId:item.id, item:{ ...cosmetic, count:inventory[itemId], equipped:equipped[cosmetic.slot] === itemId } };
    const batch = offer.batchId ? this.state.s4Packs.batchOpenings[account.id] : null;
    if (batch?.id === offer.batchId && batch.status === "active") {
      batch.results.push({ mode:"cosmetic-choice", packId:item.id, itemId });
      if (batch.results.length < batch.packIds.length) {
        const nextPackId = batch.packIds[batch.results.length];
        const nextItem = this.s4PackInventory(account.id).find((candidate) => candidate.id === nextPackId);
        if (!nextItem || nextItem.status !== "unopened") throw new Error("批量开包队列中的下一份徽章包不可用");
        this.createS4ChoiceOffer(account, nextItem, pack, batch);
        this.save();
        const packBatchOpening = { id:batch.id, mode:"cosmetic-choice", complete:false, packType:batch.packType, total:batch.packIds.length, completed:batch.results.length };
        if (options.compact) return this.compactMutationView(account, { ownTeam:true, s4Packs:true, cosmetics:true, extra:{ packOpening, packBatchOpening, teamBadgeDelta:this.equippedTeamBadge(account.id), clubBadgeDelta:this.equippedClubBadge(account.id) } });
        return { ...this.view(account), packOpening, packBatchOpening };
      }
      batch.status = "complete";
      batch.completedAt = this.now();
      const batchResult = {
        id:batch.id,
        mode:"cosmetic-choice",
        complete:true,
        packType:batch.packType,
        total:batch.packIds.length,
        results:batch.results.map((result) => this.publicS4BatchResult(result)),
      };
      delete this.state.s4Packs.batchOpenings[account.id];
      this.save();
      if (options.compact) return this.compactMutationView(account, { ownTeam:true, s4Packs:true, cosmetics:true, extra:{ packOpening, packBatchOpening:batchResult, teamBadgeDelta:this.equippedTeamBadge(account.id), clubBadgeDelta:this.equippedClubBadge(account.id) } });
      return { ...this.view(account), packOpening, packBatchOpening:batchResult };
    }
    this.save();
    if (options.compact) return this.compactMutationView(account, { ownTeam:true, s4Packs:true, cosmetics:true, extra:{ packOpening, teamBadgeDelta:this.equippedTeamBadge(account.id), clubBadgeDelta:this.equippedClubBadge(account.id) } });
    return { ...this.view(account), packOpening };
  }

  chooseS4Pack(account, offerIdValue, playerIdValue, options = {}) {
    const team = this.accountTeam(account.id);
    const offer = this.state.s4Packs.offers[account.id];
    if (offer?.kind === "cosmetic") return this.chooseS4CosmeticPack(account, offerIdValue, playerIdValue, options);
    const playerId = String(playerIdValue ?? "");
    const item = this.s4PackInventory(account.id).find((candidate) => candidate.id === offer?.packId);
    const pack = S4_PACK_BY_ID[offer?.packType];
    if (!team || !offer || offer.status !== "pending" || offer.id !== String(offerIdValue ?? "") || !offer.playerIds.includes(playerId) || !item || !pack) {
      throw new Error("只能选择当前礼包展示的球员");
    }
    if (pack.adminOnly && pack.kind === "private") {
      const privateCandidates = new Set(this.privatePackCandidates(account.id, pack).map((player) => player.id));
      if (!privateCandidates.has(playerId)) throw new Error("该球员已不在你的私有池中，请重新开启礼包");
    }
    if (offer.kind === "public" && ownershipOwner(this.state, playerId)) throw new Error("该球员所有权已经被其他玩家获得，请重新开启礼包");
    const cardQuantity = Math.max(1, Number(pack.cardQuantity ?? 1));
    const upgradeLevel = Number.isInteger(pack.fixedUpgradeLevel) ? pack.fixedUpgradeLevel : 0;
    const cards = Array.from({ length:cardQuantity }, (_, index) => this.grantS4Card(team, playerId, {
      grantOwnership:offer.kind === "public" && index === 0,
      acquisitionSource:pack.adminOnly ? "admin-designated-pack" : offer.kind === "public" ? "public-pack" : "legend-pack",
      knownRosterFamily:offer.kind !== "public" || index > 0,
      upgradeLevel,
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
    const publicCards = cards.map((entry) => publicLeagueS4Card(this.state, entry));
    const s4CardDeltas = publicCards.map((entry) => ({ playerId, card:entry, ownershipGranted:offer.kind === "public" }));
    const packOpening = { mode:"choice", packId:item.id, player:playerSummary(REAL_PLAYER_BY_ID[playerId]), card:publicCards[0], cardCount:cardQuantity, ownershipGranted:offer.kind === "public" };
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
        if (options.compact) return this.compactMutationView(account, { s4Packs:true, extra:{ packOpening, packBatchOpening, s4CardDeltas, s4PlayerDeltas:[this.s4PlayerAssetDelta(account.id, playerId)], s4RosterSlotsUsed:this.rosterSlotsUsed(account.id) } });
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
      if (options.compact) return this.compactMutationView(account, { s4Packs:true, extra:{ packOpening, packBatchOpening:batchResult, s4CardDeltas, s4PlayerDeltas:[this.s4PlayerAssetDelta(account.id, playerId)], s4RosterSlotsUsed:this.rosterSlotsUsed(account.id) } });
      return { ...this.view(account), packOpening, packBatchOpening:batchResult };
    }
    this.save();
    if (options.compact) return this.compactMutationView(account, { s4Packs:true, extra:{ packOpening, s4CardDeltas, s4PlayerDeltas:[this.s4PlayerAssetDelta(account.id, playerId)], s4RosterSlotsUsed:this.rosterSlotsUsed(account.id) } });
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
      delete this.state.s4Assets.cosmetics.inventory[accountId];
      delete this.state.s4Assets.cosmetics.equipped[accountId];
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
    const mode = body.recipientMode === "specified" ? "specified" : "all";
    const requestedIds = [...new Set((Array.isArray(body.accountIds) ? body.accountIds : [body.accountIds]).map(String).filter(Boolean))];
    const recipients = this.state.teams
      .filter((team) => team.ownerId && (mode === "all" || requestedIds.includes(team.ownerId)))
      .map((team) => ({ team, player:this.accountXPlayer(team.ownerId) }))
      .filter((entry) => entry.player);
    if (mode === "specified") {
      const found = new Set(recipients.map(({ team }) => team.ownerId));
      const missing = requestedIds.filter((id) => !found.has(id));
      if (missing.length) throw new Error(`指定玩家未拥有X球员或不存在: ${missing.join(", ")}`);
    }
    if (!recipients.length) throw new Error("当前没有拥有X球员的玩家");
    const grant = {
      id:makeId("x-growth-grant", `${mode}-${points}`),
      points,
      recipientMode:mode,
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

  ensureClubManagement(team) {
    if (!team) return null;
    const baseName = String(team.clubManagement?.baseTeamName ?? team.name ?? "球队");
    team.clubManagement ??= {};
    team.clubManagement.baseTeamName ??= baseName;
    team.clubManagement.stadium ??= {};
    team.clubManagement.stadium.name ??= `${baseName}主场`;
    team.clubManagement.stadium.capacity = Math.max(CLUB_STADIUM_DEFAULT_CAPACITY, Math.round(Number(team.clubManagement.stadium.capacity ?? CLUB_STADIUM_DEFAULT_CAPACITY)));
    team.clubManagement.stadium.standStyle ??= "none";
    if (Number(team.clubManagement.stadium.standStyleDefaultVersion ?? 0) < 2) {
      if (team.clubManagement.stadium.standStyle === "classic") team.clubManagement.stadium.standStyle = "none";
      team.clubManagement.stadium.standStyleDefaultVersion = 2;
    }
    team.clubManagement.stadium.pitchStyle ??= "striped";
    team.clubManagement.stadium.adLayout ??= "sideline";
    team.clubManagement.stadium.backgroundEffect ??= team.clubManagement.stadium.standStyle === "meteor" ? "meteor" : "none";
    if (team.clubManagement.stadium.standStyle === "meteor") team.clubManagement.stadium.standStyle = "none";
    if (team.clubManagement.stadium.backgroundEffect === "meteor" && !this.ownsMeteorStand(team.ownerId)) team.clubManagement.stadium.backgroundEffect = "none";
    delete team.clubManagement.supporters;
    delete team.clubManagement.attendance;

    team.clubManagement.sponsorship ??= {};
    const sponsorship = team.clubManagement.sponsorship;
    sponsorship.history ??= [];
    sponsorship.offers ??= [];
    sponsorship.activeContracts ??= [];
    if (sponsorship.activeContract && !sponsorship.activeContracts.some((entry) => entry.id === sponsorship.activeContract.id)) sponsorship.activeContracts.push(sponsorship.activeContract);
    delete sponsorship.activeContract;
    sponsorship.offersInitialized = true;
    if (team.ownerId && sponsorship.initialOfferGranted !== true) {
      sponsorship.initialOfferGranted = true;
      this.createClubSponsorOffer(team, { type:"normal", sourceCompetition:"initial", force:true });
    }
    return team.clubManagement;
  }

  setStoredTeamName(team, name) {
    team.name = name;
    Object.values(this.state.playerStats).forEach((entry) => { if (entry.teamId === team.id) entry.teamName = name; });
    this.state.listings.forEach((entry) => { if (entry.sellerTeamId === team.id) entry.sellerTeamName = name; });
    (this.state.reports[team.id] ?? []).forEach((report) => { report.teamName = name; });
  }

  activeClubSponsorContract(club, type) {
    return (club?.sponsorship?.activeContracts ?? []).find((entry) => entry.type === type && Number(entry.remainingSeasons ?? 0) > 0) ?? null;
  }

  settleClubSponsorContractsForSeason(team, seasonId) {
    const settledSeasonId = String(seasonId ?? "").trim();
    if (!team || !settledSeasonId) return false;
    const club = this.ensureClubManagement(team);
    let changed = false;
    let teamNamingExpired = false;
    club.sponsorship.activeContracts.forEach((contract) => {
      if (contract.lastSettledSeasonId === settledSeasonId) return;
      contract.remainingSeasons = Math.max(0, Number(contract.remainingSeasons ?? contract.durationSeasons ?? 1) - 1);
      contract.lastSettledSeasonId = settledSeasonId;
      if (contract.remainingSeasons === 0 && contract.type === "team") teamNamingExpired = true;
      changed = true;
    });
    if (!changed) return false;
    club.sponsorship.activeContracts = club.sponsorship.activeContracts.filter((contract) => Number(contract.remainingSeasons ?? 0) > 0);
    if (teamNamingExpired) this.setStoredTeamName(team, club.baseTeamName);
    return true;
  }

  createClubSponsorOffer(team, options = {}) {
    if (!team?.ownerId) return null;
    const club = this.ensureClubManagement(team);
    const sponsorship = club.sponsorship;
    if ((sponsorship.offers ?? []).filter((entry) => entry.status === "pending").length >= CLUB_SPONSOR_MAX_PENDING_OFFERS) return null;
    if (!options.force && this.rng() >= CLUB_SPONSOR_OFFER_CHANCE) return null;
    const rank = this.standings().find((entry) => entry.id === team.id)?.rank ?? TEAM_COUNT;
    const eligibleTypes = Object.values(CLUB_SPONSOR_CONTRACTS).filter((entry) => rank <= entry.requiredRank);
    const requestedType = CLUB_SPONSOR_CONTRACTS[String(options.type ?? "")];
    const type = requestedType ?? eligibleTypes[Math.floor(this.rng() * eligibleTypes.length)] ?? CLUB_SPONSOR_CONTRACTS.normal;
    const activeSponsorIds = new Set(sponsorship.activeContracts.map((entry) => entry.sponsorId));
    const pendingSponsorIds = new Set(sponsorship.offers.filter((entry) => entry.status === "pending" && entry.type === type.id).map((entry) => entry.sponsorId));
    const candidates = CLUB_SPONSORS.filter((entry) => !activeSponsorIds.has(entry.id) && !pendingSponsorIds.has(entry.id));
    const sponsorPool = candidates.length ? candidates : CLUB_SPONSORS;
    const sponsor = sponsorPool[Math.floor(this.rng() * sponsorPool.length)] ?? sponsorPool[0];
    const durationSeasons = Math.max(1, Math.min(3, Math.round(Number(options.durationSeasons ?? (1 + Math.floor(this.rng() * 3))))));
    const offer = {
      id:makeId("sponsor-offer", `${team.id}-${sponsor.id}-${type.id}-${this.now()}`),
      sponsorId:sponsor.id,
      sponsorName:sponsor.name,
      sponsorIcon:sponsor.icon,
      type:type.id,
      typeName:type.name,
      durationSeasons,
      bonus:type.bonus * durationSeasons,
      status:"pending",
      sourceCompetition:String(options.sourceCompetition ?? "league"),
      sourceMatchId:options.sourceMatchId ?? null,
      createdSeasonId:this.state.season.id,
      createdAt:this.now(),
    };
    sponsorship.offers.unshift(offer);
    sponsorship.offers = sponsorship.offers.slice(0, 30);
    return offer;
  }

  rollClubSponsorOffersAfterMatch(record) {
    if (!record?.id || record.competition === "friendly") return [];
    const created = [];
    [record.homeId, record.awayId].forEach((teamId) => {
      const team = this.state.teams.find((entry) => entry.id === teamId);
      if (!team?.ownerId) return;
      const club = this.ensureClubManagement(team);
      if (club.sponsorship.offers.some((entry) => entry.sourceMatchId === record.id)) return;
      const offer = this.createClubSponsorOffer(team, { sourceCompetition:record.competition ?? "league", sourceMatchId:record.id });
      if (offer) created.push(offer);
    });
    return created;
  }

  clubManagementView(account) {
    const team = this.accountTeam(account.id);
    if (!team) return null;
    const club = this.ensureClubManagement(team);
    const rank = this.standings().find((entry) => entry.id === team.id)?.rank ?? TEAM_COUNT;
    const meteorUnlocked = this.ownsMeteorStand(account.id);
    const stadiumContract = this.activeClubSponsorContract(club, "stadium");
    const stadiumSponsor = CLUB_SPONSORS.find((entry) => entry.id === stadiumContract?.sponsorId) ?? null;
    const nextExpansion = CLUB_STADIUM_EXPANSIONS.find((entry) => entry.capacity > club.stadium.capacity) ?? null;
    const activeSponsors = club.sponsorship.activeContracts.map((contract) => ({ ...contract, sponsor:CLUB_SPONSORS.find((entry) => entry.id === contract.sponsorId) ?? null }));
    const attendanceRate = meteorUnlocked ? 1 : .82;
    return clone({
      ...club,
      stadium:{
        ...club.stadium,
        displayName:stadiumContract && stadiumSponsor ? `${stadiumSponsor.name}竞技场` : club.stadium.name,
        nameLocked:Boolean(stadiumContract),
        nextExpansion,
        attendanceRate,
        estimatedTicketIncome:Math.floor(club.stadium.capacity * attendanceRate * .08),
        unlockedStandStyles:["none", "classic", "steep", "continuous"],
        unlockedBackgroundEffects:["none", ...(meteorUnlocked ? ["meteor"] : [])],
      },
      sponsorship:{ ...club.sponsorship, activeSponsors, activeSponsor:activeSponsors[0]?.sponsor ?? null },
      sponsors:CLUB_SPONSORS,
      contractTypes:Object.values(CLUB_SPONSOR_CONTRACTS).map((type) => ({ ...type, unlocked:rank <= type.requiredRank, currentRank:rank })),
    });
  }

  updateClubStadium(account, body = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const club = this.ensureClubManagement(team);
    const stadiumContract = this.activeClubSponsorContract(club, "stadium");
    const name = String(body.name ?? club.stadium.name).trim();
    if (stadiumContract && name !== club.stadium.name) throw new Error("球场冠名合同生效期间无法修改主场名称");
    if (!name) throw new Error("主场名称不能为空");
    if (name.length > 30) throw new Error("主场名称最多30个字符");
    const standStyles = new Set(["none", "classic", "steep", "continuous"]);
    const pitchStyles = new Set(["striped", "checker", "plain"]);
    const backgroundEffects = new Set(["none", "meteor"]);
    if (body.backgroundEffect === "meteor" && !this.ownsMeteorStand(account.id)) throw new Error("请先在商店购买流星雨看台");
    club.stadium.name = name;
    if (standStyles.has(body.standStyle)) club.stadium.standStyle = body.standStyle;
    if (pitchStyles.has(body.pitchStyle)) club.stadium.pitchStyle = body.pitchStyle;
    if (backgroundEffects.has(body.backgroundEffect)) club.stadium.backgroundEffect = body.backgroundEffect;
    this.save();
    return this.view(account, { includePlayerDirectory:false });
  }

  expandClubStadium(account) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const club = this.ensureClubManagement(team);
    const expansion = CLUB_STADIUM_EXPANSIONS.find((entry) => entry.capacity > club.stadium.capacity);
    if (!expansion) throw new Error("球场已经达到当前最高容量");
    const wallet = this.wallet(account.id);
    if (wallet.balance < expansion.cost) throw new Error(`金币不足，扩建需要${expansion.cost}金币`);
    wallet.balance -= expansion.cost;
    club.stadium.capacity = expansion.capacity;
    this.state.ledger.push({ id:makeId("ledger", `stadium-expansion-${team.id}-${expansion.capacity}`), accountId:account.id, amount:-expansion.cost, type:"stadium-expansion", teamId:team.id, capacity:expansion.capacity, createdAt:this.now() });
    this.save();
    return this.view(account, { includePlayerDirectory:false });
  }

  clubBroadcastVenue(team) {
    const club = this.ensureClubManagement(team);
    const stadiumContract = this.activeClubSponsorContract(club, "stadium");
    const stadiumSponsor = CLUB_SPONSORS.find((entry) => entry.id === stadiumContract?.sponsorId) ?? null;
    const sponsors = club.sponsorship.activeContracts
      .filter((contract) => contract.type === "normal")
      .map((contract) => CLUB_SPONSORS.find((entry) => entry.id === contract.sponsorId))
      .filter((sponsor, index, entries) => sponsor && entries.findIndex((entry) => entry.id === sponsor.id) === index)
      .map((sponsor) => ({ id:sponsor.id, name:sponsor.name, icon:sponsor.icon }));
    return {
      name:stadiumContract && stadiumSponsor ? `${stadiumSponsor.name}竞技场` : club.stadium.name,
      standStyle:club.stadium.standStyle,
      backgroundEffect:club.stadium.backgroundEffect,
      pitchStyle:club.stadium.pitchStyle,
      sponsors,
    };
  }

  settleHomeTicketIncome(record) {
    if (!record?.id || !record.homeId || record.competition === "friendly") return null;
    const team = this.state.teams.find((entry) => entry.id === record.homeId);
    if (!team?.ownerId) return null;
    const existing = this.state.ledger.find((entry) => entry.type === "home-ticket-income" && entry.matchId === record.id && entry.accountId === team.ownerId);
    if (existing) return existing;
    const club = this.ensureClubManagement(team);
    const attendanceRate = this.ownsMeteorStand(team.ownerId) ? 1 : .82;
    const attendance = Math.floor(club.stadium.capacity * attendanceRate);
    const amount = Math.floor(attendance * .08);
    const entry = { id:makeId("ledger", `tickets-${record.id}`), accountId:team.ownerId, amount, type:"home-ticket-income", seasonId:this.state.season.id, round:record.round, matchId:record.id, competition:record.competition ?? "league", attendanceRate, attendance, capacity:club.stadium.capacity, createdAt:this.now() };
    this.wallet(team.ownerId).balance += amount;
    this.state.ledger.push(entry);
    return entry;
  }

  homeTicketIncomeSummary(team, record) {
    if (!team?.ownerId || !record?.id || record.homeId !== team.id) return null;
    const entry = this.state.ledger.find((item) => item.type === "home-ticket-income" && item.matchId === record.id && item.accountId === team.ownerId);
    if (!entry) return null;
    return {
      amount:Number(entry.amount ?? 0),
      attendance:Number(entry.attendance ?? 0),
      capacity:Number(entry.capacity ?? 0),
      attendanceRate:Number(entry.attendanceRate ?? (entry.capacity ? entry.attendance / entry.capacity : 0)),
    };
  }
  respondClubSponsorOffer(account, body = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const club = this.ensureClubManagement(team);
    const offer = club.sponsorship.offers.find((entry) => entry.id === String(body.offerId ?? ""));
    if (!offer || offer.status !== "pending") throw new Error("这份赞助报价已不存在或已经处理");
    const action = String(body.action ?? "");
    if (action === "reject") {
      offer.status = "rejected";
      offer.resolvedAt = this.now();
      this.save();
      return this.view(account, { includePlayerDirectory:false });
    }
    if (action !== "accept") throw new Error("请选择接受或拒绝赞助报价");
    const sameType = club.sponsorship.activeContracts.filter((entry) => entry.type === offer.type);
    const limit = offer.type === "normal" ? 3 : 1;
    if (sameType.length >= limit) throw new Error(offer.type === "normal" ? "普通赞助最多同时签约三家公司" : `${offer.typeName}最多同时签约一家公司`);
    if (club.sponsorship.activeContracts.some((entry) => entry.sponsorId === offer.sponsorId)) throw new Error("该赞助商已有生效中的合同");
    const contract = {
      id:makeId("sponsor", `${team.id}-${offer.sponsorId}-${offer.type}-${this.now()}`),
      offerId:offer.id,
      sponsorId:offer.sponsorId,
      sponsorName:offer.sponsorName,
      type:offer.type,
      typeName:offer.typeName,
      bonus:offer.bonus,
      durationSeasons:offer.durationSeasons,
      remainingSeasons:offer.durationSeasons,
      signedSeasonId:this.state.season.id,
      lastSettledSeasonId:null,
      signedAt:this.now(),
    };
    offer.status = "accepted";
    offer.resolvedAt = this.now();
    club.sponsorship.activeContracts.push(contract);
    club.sponsorship.history.unshift(clone(contract));
    club.sponsorship.history = club.sponsorship.history.slice(0, 30);
    this.wallet(account.id).balance += contract.bonus;
    this.state.ledger.push({ id:makeId("ledger", contract.id), accountId:account.id, amount:contract.bonus, type:"sponsor-signing-bonus", teamId:team.id, sponsorId:contract.sponsorId, contractType:contract.type, durationSeasons:contract.durationSeasons, createdAt:this.now() });
    if (contract.type === "team") this.setStoredTeamName(team, `${club.baseTeamName}-${contract.sponsorName}`);
    this.save();
    return this.view(account, { includePlayerDirectory:false });
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
    const ordered = inbox.sort((left, right) => left.createdAt - right.createdAt);
    const pending = [];
    const ordinary = [];
    ordered.forEach((item) => (this.inboxMessageDeletable(item) ? ordinary : pending).push(item));
    this.state.inbox[team.id] = [...ordinary.slice(-120), ...pending].sort((left, right) => left.createdAt - right.createdAt);
    return entry;
  }

  notifyEnhancementSuccess(team, player, card, details) {
    const upgradeLevel = Number(card?.upgradeLevel ?? 0);
    if (!team?.ownerId || !details?.success || upgradeLevel < 6 || upgradeLevel > 8) return;
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

  notifyEnhancementBatch(team, player, details) {
    if (!team?.ownerId || !details?.quantity || !details.successCount || details.successCount < 1) return;
    const maxLevel = Math.max(...(details.outcomes ?? []).filter((entry) => entry.success).map((entry) => Number(entry.afterLevel ?? 0)), 0);
    if (maxLevel < 6) return;
    const ownerName = team.ownerName ?? "玩家";
    const playerInfo = `${player.club ?? "自由球员"} / ${player.nationality ?? "未知国家队"} / ${player.role} / 能力 ${player.overall}`;
    this.state.teams.filter((recipient) => recipient.ownerId && recipient.ownerId !== team.ownerId).forEach((recipient) => this.pushInbox(recipient, {
      id:`enhancement-batch-success:${details.batchId}:${recipient.ownerId}`,
      type:"announcement",
      title:`${player.name}批量强化完成`,
      summary:`${ownerName}批量合成${details.quantity}次，成功${details.successCount}次，最高达到+${maxLevel}。`,
      body:`玩家${ownerName}（${team.name}）完成${player.name}的批量强化：主卡+${details.mainLevel}、副卡+${details.materialLevel}，合成${details.quantity}次，成功${details.successCount}次，失败${details.failureCount}次，成功率${details.chance}%，最高强化至+${maxLevel}。球员信息：${playerInfo}。`,
      payload:{ accountId:team.ownerId, ownerName, teamId:team.id, teamName:team.name, playerId:player.id, playerName:player.name, beforeLevel:details.mainLevel, materialLevel:details.materialLevel, upgradeLevel:maxLevel, chance:details.chance, quantity:details.quantity, successCount:details.successCount, failureCount:details.failureCount },
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

  readInboxBatch(account, messageIdsValue = []) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const messageIds = new Set((Array.isArray(messageIdsValue) ? messageIdsValue : []).slice(0, 200).map((value) => String(value ?? "")).filter(Boolean));
    const readAt = this.now();
    const readMessageIds = [];
    (this.state.inbox[team.id] ?? []).forEach((message) => {
      if (!messageIds.has(message.id) || message.readAt) return;
      message.readAt = readAt;
      readMessageIds.push(message.id);
    });
    if (readMessageIds.length) {
      this.state.updatedAt = Math.max(readAt, Number(this.state.updatedAt ?? 0) + 1);
      this.scheduleInboxReadPersist();
    }
    return clone({
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      messageIds:readMessageIds,
      readAt,
      inboxUnreadCount:(this.state.inbox[team.id] ?? []).filter((message) => !message.readAt).length,
    });
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
      return { id:teamId, name:team?.name ?? "未知球队", seasonFinalStarCount:(team?.seasonFinalChampionStars ?? []).length, ...(cup.table[teamId] ?? { played:0, won:0, drawn:0, lost:0, goalsFor:0, goalsAgainst:0, points:0, seed:TEAM_COUNT, status:"active" }) };
    }).sort((left, right) => right.points - left.points || (right.goalsFor - right.goalsAgainst) - (left.goalsFor - left.goalsAgainst) || right.goalsFor - left.goalsFor || left.seed - right.seed || left.name.localeCompare(right.name, "zh-CN"))
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
      format:cup.format,
      leagueRounds:cup.leagueRounds.map((round) => ({ ...round, fixtures:round.fixtures.map((fixture) => ({ ...fixture, homeName:teamName(fixture.homeId), awayName:teamName(fixture.awayId) })) })),
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
    this.state.cup = { format:"round-robin-v1", status:"active", stage:"league", participants, table, leagueRounds:[], swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:nextCupSlot(this.now(), this.state.season.firstRoundAt ?? this.state.season.nextRoundAt), championId:null, startedAt:this.now(), finalStartedAt:null, completedAt:null };
    this.createCupLeagueStage();
    this.save();
    return this.adminView();
  }

  createCupLeagueStage() {
    const cup = this.state.cup;
    const participantOrder = seededShuffle(cup.participants, `${this.state.season.id}:cup-league:participants`);
    const generatedRounds = roundRobin(participantOrder).slice(0, TEAM_COUNT - 1);
    const independentRoundOrder = seededShuffle(generatedRounds, `${this.state.season.id}:cup-league:rounds`);
    const pairingSignature = (round) => round.fixtures.map((fixture) => [fixture.homeId, fixture.awayId].sort().join(":")).sort().join("|");
    const duplicatesLeagueOrder = independentRoundOrder.every((round, index) => pairingSignature(round) === pairingSignature(this.state.rounds[index]));
    if (duplicatesLeagueOrder) independentRoundOrder.push(independentRoundOrder.shift());
    const rounds = independentRoundOrder.map((generatedRound, index) => {
      const roundNumber = index + 1;
      const fixtures = generatedRound.fixtures.map((fixture) => ({
        id:`cup-league-${roundNumber}-${fixture.homeId}-${fixture.awayId}`,
        homeId:fixture.homeId,
        awayId:fixture.awayId,
        matchId:null,
        status:"pending",
      }));
      return { number:roundNumber, status:"pending", fixtures };
    });
    cup.leagueRounds = rounds;
    rounds.forEach((round) => cup.events.push({ id:`cup-league-${round.number}`, stage:"league", round:round.number, leg:1, status:"pending", fixtureIds:round.fixtures.map((fixture) => fixture.id) }));
    return rounds;
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

  seasonCompetitionDate() {
    const storedDate = String(this.state.season?.date ?? "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(storedDate)) return storedDate;
    const fallback = Number(this.state.season?.startedAt ?? this.state.season?.completedAt ?? this.now());
    return localDateKey(new Date(fallback));
  }

  seasonCompetitionDayExpired(now = this.now()) {
    return this.seasonCompetitionDate() < localDateKey(new Date(now));
  }

  cancelExpiredSeasonFinal(now = this.now()) {
    if (!this.seasonCompetitionDayExpired(now)) return false;
    const tournament = this.state.seasonFinalTournament;
    if (!tournament || ["completed", "cancelled"].includes(tournament.status)) return false;
    tournament.status = "cancelled";
    tournament.cancelledAt = Number(now);
    tournament.cancellationReason = "competition-day-expired";
    tournament.nextMatchAt = null;
    (tournament.bracket ?? []).forEach((node) => {
      if (node.status === "running") node.status = "cancelled";
    });
    if (this.state.liveSeasonFinalRound?.tournamentId === tournament.id) this.state.liveSeasonFinalRound = null;
    return true;
  }

  ensureSeasonFinalTournament() {
    if (this.seasonCompetitionDayExpired()) {
      this.cancelExpiredSeasonFinal();
      return this.state.seasonFinalTournament ?? null;
    }
    const leagueRanks = this.lockSeasonFinalLeagueRanks();
    const tournamentReady = Boolean(leagueRanks) && this.state.cup?.status === "completed" && this.state.cup.completedAt != null && Number.isFinite(Number(this.state.cup.completedAt));
    if (this.state.seasonFinalTournament?.seasonId !== this.state.season.id) this.state.seasonFinalTournament = null;
    if (this.state.seasonFinalTournament && !this.state.seasonFinalTournament.preview) return this.ensureSeasonFinalSchedule(this.state.seasonFinalTournament);
    if (this.state.seasonFinalTournament?.preview && !tournamentReady) return this.syncSeasonFinalPreviewSchedule(this.state.seasonFinalTournament);
    if (this.state.seasonFinalTournament?.preview && tournamentReady) this.state.seasonFinalTournament = null;
    if (!tournamentReady) {
      const previewTeams = Array.from({ length:10 }, (_, index) => ({ id:`season-final-seed-${index + 1}`, name:`${index + 1}号种子`, ownerId:index === 9 ? null : `season-final-preview-${index + 1}` }));
      const previewRanks = Object.fromEntries(previewTeams.map((team, index) => [team.id, index + 1]));
      const previewCupResults = Object.fromEntries(previewTeams.map((team) => [team.id, { stage:"group", groupRank:10 }]));
      this.state.seasonFinalTournament = { ...createSeasonFinalState({ id:`${this.state.season.id}-final-preview`, seasonId:this.state.season.id, teams:previewTeams, leagueRanks:previewRanks, cupResults:previewCupResults, createdAt:this.now() }), preview:true };
      return this.syncSeasonFinalPreviewSchedule(this.state.seasonFinalTournament);
    }
    const cupResults = {};
    const knockout = this.state.cup.knockout ?? {};
    const finalTie = knockout.final?.[0];
    if (finalTie?.teams?.length === 2) finalTie.teams.forEach((teamId) => { cupResults[teamId] = { stage: finalTie.winnerId === teamId ? "champion" : "finalist", groupRank: this.state.cup.table?.[teamId]?.seed }; });
    const semifinalists = new Set((knockout.semifinals ?? []).flatMap((tie) => tie.teams ?? []));
    const quarterfinalists = new Set((knockout.quarterfinals ?? []).flatMap((tie) => tie.teams ?? []));
    Object.entries(this.state.cup.table ?? {}).forEach(([teamId, entry]) => {
      const stage = semifinalists.has(teamId) ? "semifinal" : quarterfinalists.has(teamId) ? "quarterfinal" : entry.status === "qualified" ? "knockout" : "group";
      cupResults[teamId] ??= { stage, groupRank: entry.seed ?? entry.rank };
    });
    this.state.seasonFinalTournament = createSeasonFinalState({ id:`${this.state.season.id}-final`, seasonId:this.state.season.id, teams:this.state.teams, leagueRanks, cupResults, createdAt:this.now(), scheduleAnchorAt:this.cupFinalStartedAt() ?? this.state.cup.completedAt });
    this.state.seasonFinalTournament.leagueSnapshotRound = this.state.season.seasonFinalLeagueRound;
    return this.state.seasonFinalTournament;
  }

  leagueRanksAfterRound(roundNumber = this.state.season.currentRound) {
    const table = Object.fromEntries(this.state.teams.map((team) => [team.id, { points:0, goalsFor:0, goalsAgainst:0 }]));
    const matches = this.state.matches.filter((match) => !match.competition && Number(match.round) <= roundNumber);
    if (!matches.length) return Object.fromEntries(this.standings().map((entry) => [entry.id, entry.rank]));
    matches.forEach((match) => {
      const home = table[match.homeId]; const away = table[match.awayId];
      if (!home || !away || !match.score) return;
      home.goalsFor += Number(match.score[0]); home.goalsAgainst += Number(match.score[1]);
      away.goalsFor += Number(match.score[1]); away.goalsAgainst += Number(match.score[0]);
      if (match.score[0] > match.score[1]) home.points += 3;
      else if (match.score[1] > match.score[0]) away.points += 3;
      else { home.points += 1; away.points += 1; }
    });
    return Object.fromEntries([...this.state.teams].sort((left, right) => {
      const a = table[left.id]; const b = table[right.id];
      return b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor || left.name.localeCompare(right.name, "zh-CN");
    }).map((team, index) => [team.id, index + 1]));
  }

  lockSeasonFinalLeagueRanks() {
    if (this.state.season.seasonFinalLeagueRanks) return this.state.season.seasonFinalLeagueRanks;
    if (this.state.cup?.status !== "completed" || this.state.cup.completedAt == null) return null;
    const completedRound = Math.max(0, Number(this.state.season.currentRound) || 0);
    this.state.season.seasonFinalLeagueRanks = this.leagueRanksAfterRound(completedRound);
    this.state.season.seasonFinalLeagueRound = completedRound;
    this.state.season.seasonFinalLeagueLockedAt = Number(this.state.cup.completedAt);
    return this.state.season.seasonFinalLeagueRanks;
  }

  ensureSeasonFinalSchedule(tournament) {
    if (!tournament || tournament.preview) return tournament;
    const exactAnchor = this.cupFinalStartedAt();
    const canReschedule = !(tournament.matches?.length) && (tournament.bracket ?? []).every((node) => node.status === "pending");
    const anchor = Number(exactAnchor != null && canReschedule ? exactAnchor : tournament.scheduleAnchorAt ?? exactAnchor ?? this.state.cup.completedAt ?? tournament.createdAt);
    if (!Number.isFinite(anchor)) return tournament;
    const migrated = tournament.scheduleAnchorAt == null || !Number.isFinite(Number(tournament.scheduleAnchorAt)) || Number(tournament.scheduleAnchorAt) !== anchor;
    tournament.scheduleAnchorAt = anchor;
    tournament.finalBanDeadlineAt = anchor + SEASON_FINAL_RULES.finalBanDeadlineMinutes * 60 * 1000;
    tournament.bracket.forEach((node) => { node.scheduledAt = anchor + SEASON_FINAL_SCHEDULE_MINUTES[node.id] * 60 * 1000; });
    if (migrated || !Number.isFinite(Number(tournament.nextMatchAt))) {
      const pendingTimes = tournament.bracket.filter((node) => node.status === "pending").map((node) => node.scheduledAt);
      tournament.nextMatchAt = pendingTimes.length ? Math.min(...pendingTimes) : null;
    }
    return tournament;
  }

  cupFinalStartedAt() {
    const cup = this.state.cup;
    const stored = Number(cup?.finalStartedAt);
    if (Number.isFinite(stored) && stored > 0) return stored;
    const finalEvent = [...(cup?.events ?? [])].reverse().find((event) => event.stage === "final");
    const eventStartedAt = Number(finalEvent?.startedAt);
    if (Number.isFinite(eventStartedAt) && eventStartedAt > 0) return eventStartedAt;
    if (finalEvent && this.state.liveCupRound?.eventId === finalEvent.id) {
      const liveStartedAt = Number(this.state.liveCupRound.startedAt);
      if (Number.isFinite(liveStartedAt) && liveStartedAt > 0) return liveStartedAt;
    }
    const finalLeg = cup?.knockout?.final?.[0]?.legs?.[0];
    const finalRecord = finalLeg?.matchId ? this.state.matches.find((match) => match.id === finalLeg.matchId) : null;
    const playedAt = Number(finalRecord?.playedAt);
    if (Number.isFinite(playedAt) && playedAt > 0 && String(finalRecord?.report?.engineVersion ?? "").startsWith("2.1")) {
      const extraTimeDuration = finalRecord.report.extraTimePlayed ? 40_000 : 0;
      const penaltyKickCount = Number(finalRecord.report.penaltyShootout?.kicks?.length ?? 0);
      const penaltyDuration = finalRecord.report.penaltyShootout ? (penaltyKickCount + 1) * 2_000 : 0;
      return playedAt - 120_000 - extraTimeDuration - penaltyDuration;
    }
    return null;
  }

  projectedCupFinalAt() {
    const cup = this.state.cup;
    if (cup?.status === "completed" && cup.completedAt != null) return this.cupFinalStartedAt() ?? Number(cup.completedAt);
    const nextAt = Number(cup?.nextRoundAt);
    if (!Number.isFinite(nextAt) || !cup?.events?.length) return null;
    const current = cup.events.find((event) => event.status === "running") ?? cup.events.find((event) => event.status === "pending");
    if (!current) return null;
    let slotsBeforeFinal = null;
    if (current.stage === "league") {
      const remainingLeagueEvents = cup.events.filter((event) => event.stage === "league" && ["pending", "running"].includes(event.status)).length;
      slotsBeforeFinal = Math.max(0, remainingLeagueEvents - 1) + 5;
    } else if (current.stage === "quarterfinals") slotsBeforeFinal = current.leg === 1 ? 4 : 3;
    else if (current.stage === "semifinals") slotsBeforeFinal = current.leg === 1 ? 2 : 1;
    else if (current.stage === "final") slotsBeforeFinal = 0;
    if (!Number.isInteger(slotsBeforeFinal)) return null;
    return nextAt + slotsBeforeFinal * CUP_INTERVAL_MS;
  }

  syncSeasonFinalPreviewSchedule(tournament) {
    if (!tournament?.preview) return tournament;
    const anchor = this.projectedCupFinalAt();
    tournament.scheduleAnchorAt = anchor;
    tournament.nextMatchAt = anchor == null ? null : anchor + SEASON_FINAL_RULES.firstMatchDelayMinutes * 60 * 1000;
    tournament.finalBanDeadlineAt = anchor == null ? null : anchor + SEASON_FINAL_RULES.finalBanDeadlineMinutes * 60 * 1000;
    tournament.bracket.forEach((node) => { node.scheduledAt = anchor == null ? null : anchor + SEASON_FINAL_SCHEDULE_MINUTES[node.id] * 60 * 1000; });
    return tournament;
  }

  seasonFinalTournamentView(account = null) {
    const tournament = this.ensureSeasonFinalTournament();
    if (!tournament) return null;
    const seedNames = new Map((tournament.seedSnapshot ?? []).map((entry) => [entry.teamId, entry.teamName ?? `${entry.seed}号种子`]));
    const teamName = (id) => this.state.teams.find((team) => team.id === id)?.name ?? seedNames.get(id) ?? "待定";
    const resolvedName = (source) => teamName(this.seasonFinalNodeTeamId(tournament, source));
    const bracket = tournament.bracket.map((node) => {
      const match = tournament.matches.find((entry) => entry.seasonFinalNodeId === node.id);
      const live = this.state.liveSeasonFinalRound?.matches.find((entry) => entry.nodeId === node.id && !entry.completed);
      const resolvedStartsAt = match?.playedAt ?? (live ? this.state.liveSeasonFinalRound?.startedAt : node.scheduledAt ?? tournament.nextMatchAt);
      const startsAt = resolvedStartsAt == null ? null : Number(resolvedStartsAt);
      return { ...node, startsAt, homeName:resolvedName(node.home), awayName:resolvedName(node.away) };
    });
    return clone({ ...tournament, seedSnapshot:tournament.seedSnapshot.map((entry) => ({ ...entry, teamName:teamName(entry.teamId) })), bracket, finalBan:this.seasonFinalBanView(account, tournament) });
  }

  seasonFinalNodeTeamId(tournament, source) {
    if (!source || !String(source).includes(".")) return source ?? null;
    const [nodeId, result] = String(source).split(".");
    return tournament.bracket.find((node) => node.id === nodeId)?.[result] ?? null;
  }

  seasonFinalBanEligiblePlayers(team, roundNumber = 100) {
    if (!team) return [];
    const playerIds = team.ownerId
      ? team.rosterIds ?? []
      : (() => {
          const starters = aiLineup(this.state.teams.indexOf(team), roundNumber, this.ownedPlayerIds());
          return [...starters, ...aiSubstitutes(this.state.teams.indexOf(team), roundNumber, this.ownedPlayerIds(), starters)].map((player) => player.id);
        })();
    return [...new Set(playerIds)].map((playerId) => {
      const player = REAL_PLAYER_BY_ID[playerId];
      const state = team.playerState?.[playerId] ?? {};
      if (!player) return null;
      return {
        id:player.id,
        name:player.name,
        role:player.role,
        line:positionLine(player.role),
        overall:s4EffectiveOverall(player, this.representativeCard(team.ownerId, player.id)?.upgradeLevel ?? 0),
        isAvailable:Number(state.seasonFinalSuspension ?? 0) <= 0 && Number(state.injuryRounds ?? 0) <= 0,
      };
    }).filter((player) => player && player.line !== "GK");
  }

  seasonFinalBanDecision(tournament, nodeId, teamId) {
    const decisionNodeId = String(nodeId).startsWith("FINAL-") ? "FINAL-1" : nodeId;
    return (tournament.finalBanDecisions ?? []).find((entry) => entry.nodeId === decisionNodeId && entry.teamId === teamId) ?? null;
  }

  automaticSeasonFinalBanSelection(opponent, roundNumber) {
    const candidates = this.seasonFinalBanEligiblePlayers(opponent, roundNumber).filter((player) => player.isAvailable);
    const choose = (line) => candidates.filter((player) => player.line === line).sort((left, right) => right.overall - left.overall || left.id.localeCompare(right.id))[0]?.id ?? null;
    return { forward:choose("ATT"), midfield:choose("MID"), defense:choose("DEF") };
  }

  ensureSeasonFinalBanDecisions(node, tournament) {
    const homeId = this.seasonFinalNodeTeamId(tournament, node.home);
    const awayId = this.seasonFinalNodeTeamId(tournament, node.away);
    const roundNumber = 100 + node.order;
    const bannedPlayerIdsByTeam = {};
    for (const [teamId, opponentTeamId] of [[homeId, awayId], [awayId, homeId]]) {
      const opponent = this.state.teams.find((team) => team.id === opponentTeamId);
      const candidates = this.seasonFinalBanEligiblePlayers(opponent, roundNumber);
      const decisionNodeId = node.group === "final" ? "FINAL-1" : node.id;
      let decision = this.seasonFinalBanDecision(tournament, decisionNodeId, teamId);
      if (!decision || !validateFinalBanSelection(decision.selection, candidates).valid) {
        const selection = this.automaticSeasonFinalBanSelection(opponent, roundNumber);
        const validation = validateFinalBanSelection(selection, candidates);
        if (!validation.valid) throw new Error(`无法为${opponent?.name ?? "对手"}生成完整的赛季总决赛禁用名单`);
        decision = { nodeId:decisionNodeId, teamId, opponentTeamId, selection:validation.selection, automatic:true, submittedAt:this.now() };
        tournament.finalBanDecisions = (tournament.finalBanDecisions ?? []).filter((entry) => !(entry.nodeId === decisionNodeId && entry.teamId === teamId));
        tournament.finalBanDecisions.push(decision);
      }
      bannedPlayerIdsByTeam[opponentTeamId] = Object.values(decision.selection);
    }
    this.notifySeasonFinalBanResults(tournament);
    return bannedPlayerIdsByTeam;
  }

  confirmedSeasonFinalBanDecisions(tournament = this.state.seasonFinalTournament) {
    if (!tournament || tournament.preview || tournament.status === "completed") return null;
    const node = tournament.bracket?.find((entry) => entry.id === "FINAL-1");
    const homeId = this.seasonFinalNodeTeamId(tournament, node?.home);
    const awayId = this.seasonFinalNodeTeamId(tournament, node?.away);
    if (!homeId || !awayId) return null;
    const decisions = [homeId, awayId].map((teamId) => this.seasonFinalBanDecision(tournament, "FINAL-1", teamId));
    if (decisions.some((decision) => !decision)) return null;
    return { node, homeId, awayId, decisions };
  }

  seasonFinalBannedPlayerIds(teamId, tournament = this.state.seasonFinalTournament) {
    const confirmed = this.confirmedSeasonFinalBanDecisions(tournament);
    if (!confirmed) return [];
    const opponentDecision = confirmed.decisions.find((decision) => decision.opponentTeamId === teamId);
    return opponentDecision ? Object.values(opponentDecision.selection ?? {}).filter(Boolean) : [];
  }

  notifySeasonFinalBanResults(tournament = this.state.seasonFinalTournament) {
    const confirmed = this.confirmedSeasonFinalBanDecisions(tournament);
    if (!confirmed) return false;
    tournament.finalBanNotificationSignatures ??= {};
    const playerNames = (ids) => ids.map((id) => REAL_PLAYER_BY_ID[id]?.name ?? id);
    let changed = false;
    for (const teamId of [confirmed.homeId, confirmed.awayId]) {
      const team = this.state.teams.find((entry) => entry.id === teamId);
      if (!team?.ownerId) continue;
      const ownDecision = confirmed.decisions.find((decision) => decision.teamId === teamId);
      const opponentDecision = confirmed.decisions.find((decision) => decision.opponentTeamId === teamId);
      const ownBannedNames = playerNames(Object.values(opponentDecision?.selection ?? {}));
      const opponentBannedNames = playerNames(Object.values(ownDecision?.selection ?? {}));
      const signature = JSON.stringify({ own:ownBannedNames, opponent:opponentBannedNames });
      if (tournament.finalBanNotificationSignatures[teamId] === signature) continue;
      tournament.finalBanNotificationSignatures[teamId] = signature;
      this.pushInbox(team, {
        id:`season-final-ban-result:${tournament.id}:${teamId}`,
        type:"season-final-ban",
        title:"赛季总决赛禁用名单已确定",
        summary:`本队被禁用：${ownBannedNames.join("、")}。`,
        body:`最终决赛双方禁用名单已经确定。本队被对手禁用的球员：${ownBannedNames.join("、")}；本队禁用的对手球员：${opponentBannedNames.join("、")}。以上名单沿用至第二回合。`,
        payload:{ tournamentId:tournament.id, nodeId:"FINAL-1", bannedPlayerIds:Object.values(opponentDecision?.selection ?? {}), opponentBannedPlayerIds:Object.values(ownDecision?.selection ?? {}) },
      });
      changed = true;
    }
    return changed;
  }

  finalizeSeasonFinalBansIfDue(tournament = this.state.seasonFinalTournament, now = this.now()) {
    if (!tournament || tournament.preview || ["completed", "cancelled"].includes(tournament.status) || now < Number(tournament.finalBanDeadlineAt ?? Infinity)) return false;
    const node = tournament.bracket?.find((entry) => entry.id === "FINAL-1" && entry.status === "pending");
    if (!node || !this.seasonFinalNodeTeamId(tournament, node.home) || !this.seasonFinalNodeTeamId(tournament, node.away)) return false;
    const before = JSON.stringify({ decisions:tournament.finalBanDecisions ?? [], notifications:tournament.finalBanNotificationSignatures ?? {} });
    this.ensureSeasonFinalBanDecisions(node, tournament);
    return JSON.stringify({ decisions:tournament.finalBanDecisions ?? [], notifications:tournament.finalBanNotificationSignatures ?? {} }) !== before;
  }

  seasonFinalBanView(account, tournament = this.ensureSeasonFinalTournament()) {
    if (!account?.id || !tournament || tournament.preview || tournament.status === "completed") return null;
    const node = tournament.bracket.find((entry) => entry.id === "FINAL-1" && this.seasonFinalNodeTeamId(tournament, entry.home) && this.seasonFinalNodeTeamId(tournament, entry.away));
    if (!node) return null;
    const team = this.accountTeam(account.id);
    const homeId = this.seasonFinalNodeTeamId(tournament, node.home);
    const awayId = this.seasonFinalNodeTeamId(tournament, node.away);
    if (!team || ![homeId, awayId].includes(team.id)) return null;
    const opponentId = team.id === homeId ? awayId : homeId;
    const opponent = this.state.teams.find((entry) => entry.id === opponentId);
    const decision = this.seasonFinalBanDecision(tournament, node.id, team.id);
    return {
      nodeId:node.id,
      opponentTeamId:opponentId,
      opponentTeamName:opponent?.name ?? "对手",
      deadlineAt:tournament.finalBanDeadlineAt,
      locked:node.status !== "pending" || this.now() >= Number(tournament.finalBanDeadlineAt ?? node.scheduledAt),
      submitted:Boolean(decision),
      automatic:Boolean(decision?.automatic),
      selection:decision?.selection ?? null,
      candidates:this.seasonFinalBanEligiblePlayers(opponent, 100 + node.order).filter((player) => player.isAvailable),
    };
  }

  submitSeasonFinalBan(account, selection = {}) {
    const tournament = this.ensureSeasonFinalTournament();
    const view = this.seasonFinalBanView(account, tournament);
    if (!view) throw new Error("当前没有需要你提交的赛季总决赛禁用名单");
    if (view.locked) throw new Error("赛季总决赛禁用名单提交时间已截止，不能再修改");
    const validation = validateFinalBanSelection(selection, view.candidates);
    if (!validation.valid) throw new Error("必须从对手可用阵容中各选择一名前锋、中场和后卫");
    const team = this.accountTeam(account.id);
    const decision = { nodeId:view.nodeId, teamId:team.id, opponentTeamId:view.opponentTeamId, selection:validation.selection, automatic:false, submittedAt:this.now() };
    tournament.finalBanDecisions = (tournament.finalBanDecisions ?? []).filter((entry) => !(entry.nodeId === view.nodeId && entry.teamId === team.id));
    tournament.finalBanDecisions.push(decision);
    this.notifySeasonFinalBanResults(tournament);
    this.save();
    return this.seasonFinalTournamentView(account);
  }

  nextSeasonFinalNode(tournament = this.ensureSeasonFinalTournament()) {
    if (!tournament || ["completed", "cancelled"].includes(tournament.status)) return null;
    return tournament.bracket.find((node) => node.status === "pending" && this.seasonFinalNodeTeamId(tournament, node.home) && this.seasonFinalNodeTeamId(tournament, node.away)) ?? null;
  }

  dueSeasonFinalNodes(tournament = this.ensureSeasonFinalTournament(), now = this.now()) {
    if (!tournament || tournament.preview || ["completed", "cancelled"].includes(tournament.status)) return [];
    return tournament.bracket.filter((node) => node.status === "pending" && Number(node.scheduledAt) <= now && this.seasonFinalNodeTeamId(tournament, node.home) && this.seasonFinalNodeTeamId(tournament, node.away));
  }

  startSeasonFinalNode(node, tournament = this.ensureSeasonFinalTournament(), options = {}) {
    if (!node || !tournament || tournament.preview || tournament.seasonId !== this.state.season.id || (this.state.liveSeasonFinalRound && !options.batch)) return false;
    const homeId = this.seasonFinalNodeTeamId(tournament, node.home);
    const awayId = this.seasonFinalNodeTeamId(tournament, node.away);
    if (!homeId || !awayId) return false;
    const finalLeg = node.group === "final" ? Number(node.id.slice(-1)) : 0;
    const firstLeg = tournament.bracket.find((entry) => entry.id === "FINAL-1");
    const aggregateBaseScore = finalLeg === 2 && firstLeg?.score ? [firstLeg.score[1], firstLeg.score[0]] : null;
    const fixture = { id:`${tournament.id}:${node.id}`, homeId, awayId };
    if (node.id === "FINAL-1") this.refreshSeasonFinalists(tournament, [homeId, awayId]);
    const bannedPlayerIdsByTeam = node.group === "final" ? this.ensureSeasonFinalBanDecisions(node, tournament) : {};
    if (!options.batch) this.cupNewUnavailable = new Set();
    const created = this.createFixtureMatch(fixture, 100 + node.order, this.now(), {
      seed:`${tournament.id}:${node.id}`,
      competitionMode:"cup",
      availabilityMode:"season-final",
      legNumber:finalLeg || 1,
      allowSuperStorm:false,
      regulationOnly:finalLeg === 1,
      aggregateBaseScore,
      bannedPlayerIdsByTeam,
    });
    node.status = "running";
    tournament.status = "running";
    const live = { code:`YDL-FINAL-${this.state.season.name}-${node.id}`, nodeId:node.id, round:`赛季总决赛 ${node.id}`, competition:"赛季总决赛", match:created.match, spectators:{} };
    if (!created.home.ownerId && !created.away.ownerId) {
      settleAutomatedMatch(created.match, created.startedAt);
      this.completeSeasonFinalNode(node, created.match, tournament, { deferAvailability:options.batch });
      return true;
    }
    if (options.batch) options.liveMatches.push(live);
    else this.state.liveSeasonFinalRound = { tournamentId:tournament.id, startedAt:this.now(), matches:[live], newUnavailable:[...this.cupNewUnavailable] };
    return true;
  }

  refreshSeasonFinalists(tournament, teamIds, refreshedAt = this.now()) {
    if (!tournament || tournament.stateRefreshAt != null) return false;
    [...new Set(teamIds)].forEach((teamId) => {
      const team = this.state.teams.find((entry) => entry.id === teamId);
      if (!team) return;
      team.playerState ??= {};
      (team.rosterIds ?? []).forEach((playerId) => {
        const state = team.playerState[playerId] ?? (team.playerState[playerId] = { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 });
        state.fitness = 100;
        state.injuryRounds = 0;
      });
      team.fitnessUpdatedAt = refreshedAt;
    });
    tournament.stateRefreshAt = refreshedAt;
    tournament.stateRefreshTeamIds = [...new Set(teamIds)];
    return true;
  }

  startSeasonFinalWave(nodes, tournament = this.ensureSeasonFinalTournament()) {
    if (!nodes?.length || !tournament || this.state.liveSeasonFinalRound) return false;
    const liveMatches = [];
    this.cupNewUnavailable = new Set();
    let started = false;
    nodes.forEach((node) => { started = this.startSeasonFinalNode(node, tournament, { batch:true, liveMatches }) || started; });
    if (liveMatches.length) this.state.liveSeasonFinalRound = { tournamentId:tournament.id, startedAt:this.now(), matches:liveMatches, newUnavailable:[...this.cupNewUnavailable] };
    else if (started) this.advanceSeasonFinalAvailability();
    const pendingTimes = tournament.bracket.filter((node) => node.status === "pending").map((node) => Number(node.scheduledAt)).filter(Number.isFinite);
    tournament.nextMatchAt = pendingTimes.length ? Math.min(...pendingTimes) : null;
    return started;
  }

  completeSeasonFinalNode(node, match, tournament = this.ensureSeasonFinalTournament(), options = {}) {
    if (!node || node.status === "complete") return tournament.matches.find((entry) => entry.seasonFinalNodeId === node?.id) ?? null;
    const record = { id:`${tournament.id}-${node.id}-${tournament.matches.length + 1}`, competition:"season-final", seasonFinalNodeId:node.id, round:node.order + 1, playedAt:this.now(), homeId:match.teams?.[0]?.id ?? this.seasonFinalNodeTeamId(tournament, node.home), awayId:match.teams?.[1]?.id ?? this.seasonFinalNodeTeamId(tournament, node.away), score:[...(match.report?.score ?? [0, 0])], penalties:match.report?.penalties ?? null, formations:match.report?.teams?.map((team) => team.formation) ?? [], autoRotations:clone(match.leagueAutoRotations ?? [[], []]), report:match.report };
    const homeId = record.homeId; const awayId = record.awayId;
    const penaltyWinnerId = record.penalties?.[0] > record.penalties?.[1] ? homeId : record.penalties?.[1] > record.penalties?.[0] ? awayId : null;
    const engineWinnerId = Number.isInteger(match.winnerIndex) ? [homeId, awayId][match.winnerIndex] : null;
    let winnerId = record.score[0] > record.score[1] ? homeId : record.score[1] > record.score[0] ? awayId : penaltyWinnerId ?? engineWinnerId ?? awayId;
    if (node.id === "FINAL-1") {
      node.score = record.score; node.matchIds.push(record.id); node.status = "complete";
      tournament.finalTie.firstLegId = record.id;
    } else if (node.id === "FINAL-2") {
      const first = tournament.bracket.find((entry) => entry.id === "FINAL-1");
      const aggregate = [Number(first.score?.[0] ?? 0) + record.score[1], Number(first.score?.[1] ?? 0) + record.score[0]];
      const winnerBracketTeamId = this.seasonFinalNodeTeamId(tournament, first.home);
      const loserBracketTeamId = this.seasonFinalNodeTeamId(tournament, first.away);
      winnerId = aggregate[0] > aggregate[1] ? winnerBracketTeamId : aggregate[1] > aggregate[0] ? loserBracketTeamId : penaltyWinnerId ?? engineWinnerId ?? winnerId;
      node.score = record.score; node.winner = winnerId; node.loser = winnerId === homeId ? awayId : homeId; node.matchIds.push(record.id); node.status = "complete";
      tournament.finalTie.secondLegId = record.id; tournament.finalTie.aggregateScore = aggregate; tournament.finalTie.extraTime = Boolean(match.report?.extraTime); tournament.finalTie.penalties = Boolean(record.penalties); tournament.finalTie.championId = winnerId; tournament.status = "completed";
      const runnerUpId = [winnerBracketTeamId, loserBracketTeamId, homeId, awayId].find((teamId) => teamId && teamId !== winnerId) ?? null;
      this.awardSeasonFinalChampionStar(winnerId, tournament);
      this.grantSeasonFinalPlacementReward(winnerId, tournament, "champion");
      if (runnerUpId) this.grantSeasonFinalPlacementReward(runnerUpId, tournament, "runnerUp");
    } else {
      node.winner = winnerId; node.loser = winnerId === homeId ? awayId : homeId; node.score = record.score; node.matchIds.push(record.id); node.status = "complete";
      if (node.id === "W2") tournament.finalTie.winnerBracketChampionId = winnerId;
      if (node.id === "B8") tournament.finalTie.loserBracketChampionId = winnerId;
    }
    tournament.matches.push(record);
    this.settleHomeTicketIncome(record);
    this.rollClubSponsorOffersAfterMatch(record);
    const fixture = { id:`${tournament.id}:${node.id}`, homeId:record.homeId, awayId:record.awayId };
    this.settleMatchPrediction("season-final", node.id, fixture, record);
    this.recordSeasonFinalPlayerConsequences(record);
    this.createSeasonFinalMatchInbox(node, record, tournament);
    if (!options.deferAvailability) this.advanceSeasonFinalAvailability();
    this.distributePredictionProfit("season-final", node.id, `赛季总决赛 ${node.id}`);
    if (tournament.status === "completed") this.settleBallonDor();
    return record;
  }

  recordSeasonFinalPlayerConsequences(record) {
    const report = record.report;
    if (!report?.teams) return;
    this.state.cup.playerStats ??= {};
    this.cupNewUnavailable ??= new Set();
    const teams = [record.homeId, record.awayId].map((teamId) => this.state.teams.find((team) => team.id === teamId));
    teams.forEach((team, teamIndex) => {
      if (!team) return;
      const reportPlayers = report.teams?.[teamIndex]?.players ?? [];
      const playedPlayerIds = new Set(reportPlayers.map((player) => player.id));
      reportPlayers.forEach((player) => {
        const key = `${team.id}:${player.id}`;
        const stat = this.state.cup.playerStats[key] ?? { key, playerId:player.id, playerName:player.name, teamId:team.id, teamName:team.name, appearances:0, goals:0, assists:0, saves:0, tackles:0, interceptions:0, clearances:0, blocks:0, pressuresWon:0, penaltiesWon:0, yellowCards:0, redCards:0, ratingTotal:0 };
        const penaltiesWon = (report.importantEvents ?? []).filter((entry) => entry.type === "penaltyAwarded" && entry.opponentId === player.id).length;
        stat.appearances += 1;
        stat.goals += Number(player.stats?.goals ?? 0);
        stat.assists += Number(player.stats?.assists ?? 0);
        stat.saves += Number(player.stats?.saves ?? 0);
        stat.tackles += Number(player.stats?.tackles ?? 0);
        stat.interceptions += Number(player.stats?.interceptions ?? 0);
        stat.clearances += Number(player.stats?.clearances ?? 0);
        stat.blocks += Number(player.stats?.blocks ?? 0);
        stat.pressuresWon += Number(player.stats?.pressuresWon ?? 0);
        stat.penaltiesWon += penaltiesWon;
        stat.yellowCards += Number(player.stats?.yellowCards ?? 0);
        stat.redCards += Number(player.stats?.redCards ?? 0);
        stat.ratingTotal += Number(player.rating ?? 0);
        this.state.cup.playerStats[key] = stat;
        if (isXPlayer(REAL_PLAYER_BY_ID[player.id])) this.settleXGrowthTasks(player.id);
        if (team.ownerId && team.playerState[player.id]) {
          const state = team.playerState[player.id];
          const beforeMatch = Number(state.fitness ?? 100);
          const drain = Math.max(0, beforeMatch - Number(player.fitness ?? beforeMatch));
          const drainFactor = player.role === "GK" ? LEAGUE_FITNESS_DRAIN_FACTOR * GOALKEEPER_FITNESS_DRAIN_FACTOR : LEAGUE_FITNESS_DRAIN_FACTOR;
          state.fitness = Math.max(35, Math.min(100, Number((beforeMatch - drain * drainFactor).toFixed(1))));
          if (player.stats?.redCards) {
            state.seasonFinalSuspension = Math.max(Number(state.seasonFinalSuspension ?? 0), 1);
            this.cupNewUnavailable.add(`${team.id}:${player.id}:suspension`);
          }
          if (player.injury) {
            state.injuryRounds = Math.max(Number(state.injuryRounds ?? 0), injuryAbsenceMatches(player));
            this.cupNewUnavailable.add(`${team.id}:${player.id}:injury`);
          }
        }
      });
      this.recoverUnusedPlayers(team, playedPlayerIds);
      const chemistryPlayers = reportPlayers.filter((player) => !player.substitutedOut);
      this.recordChemistry(team, chemistryPlayers.map((player) => REAL_PLAYER_BY_ID[player.id]).filter(Boolean), Object.fromEntries(chemistryPlayers.map((player) => [player.id, player.position])));
      team.fitnessUpdatedAt = this.now();
    });
  }

  createSeasonFinalMatchInbox(node, record, tournament) {
    const teams = [record.homeId, record.awayId].map((teamId) => this.state.teams.find((team) => team.id === teamId));
    teams.forEach((team, ownIndex) => {
      if (!team?.ownerId) return;
      const opponent = teams[ownIndex === 0 ? 1 : 0];
      const ownScore = record.score[ownIndex];
      const opponentScore = record.score[ownIndex === 0 ? 1 : 0];
      const resultText = ownScore > opponentScore ? "取胜" : ownScore === opponentScore ? "战平" : "失利";
      const nextNode = this.nextSeasonFinalNode(tournament);
      const homeTicketIncome = this.homeTicketIncomeSummary(team, record);
      this.pushInbox(team, {
        id:`season-final:${tournament.id}:${node.id}:${team.id}`,
        type:"matchweek",
        title:`赛季总决赛 · ${node.id} 战报`,
        summary:`${team.name} ${ownScore}:${opponentScore} ${opponent?.name ?? "对手"}，本场${resultText}。${homeTicketIncome ? ` 主场门票收入${homeTicketIncome.amount.toLocaleString("zh-CN")}金币。` : ""}`,
        body:`${tournament.status === "completed" ? `本届赛季总决赛已经结束，冠军为${this.state.teams.find((entry) => entry.id === tournament.finalTie.championId)?.name ?? "待定"}。` : nextNode ? `下一场为赛季总决赛 ${nextNode.id}，预计稍后开始。` : "后续对阵尚待确认。"}${homeTicketIncome ? ` 本场共有${homeTicketIncome.attendance.toLocaleString("zh-CN")}名观众入场，门票收入${homeTicketIncome.amount.toLocaleString("zh-CN")}金币。` : ""}`,
        matchId:record.id,
        payload:{ results:[this.matchSummary(record)], competition:"season-final", nodeId:node.id, homeTicketIncome },
      });
    });
  }

  simulateNextSeasonFinalMatch() {
    const tournament = this.ensureSeasonFinalTournament();
    if (!tournament || tournament.preview || !this.state.season.seasonFinalLeagueRanks || this.state.cup?.status !== "completed") throw new Error("杯赛决赛结束并锁定最近一轮联赛排名后才能开始赛季总决赛");
    if (this.state.liveSeasonFinalRound) throw new Error("赛季总决赛当前有进行中的比赛");
    const node = this.nextSeasonFinalNode(tournament);
    if (!node) throw new Error("当前没有可进行的赛季总决赛比赛");
    const started = this.startSeasonFinalNode(node, tournament);
    if (this.state.liveSeasonFinalRound) {
      const live = this.state.liveSeasonFinalRound.matches[0];
      settleAutomatedMatch(live.match, this.now());
      this.completeSeasonFinalNode(node, live.match, tournament);
      this.state.liveSeasonFinalRound = null;
    }
    this.save();
    return this.seasonFinalTournamentView();
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
    // Heal legacy enforcement records after a player was removed before the
    // reconciliation hook was introduced.
    this.reconcileRosterOverlimitState(team);
    const listingByPlayer = new Map(this.state.listings.filter((item) => item.status === "active" && item.playerId).map((item) => [item.playerId, item]));
    const ownTeam = publicTeam(team, true, this.equippedTeamBadge(team.ownerId), this.equippedClubBadge(team.ownerId));
    const seasonFinalBannedPlayerIds = new Set(this.seasonFinalBannedPlayerIds(team.id));
    ownTeam.chemistryLinks = this.publicChemistryLinksForTeam(team);
    ownTeam.roster.forEach((player) => {
      const source = REAL_PLAYER_BY_ID[player.id];
      const cards = this.playerCards(account.id, player.id);
      const activeCard = cards[0] ?? null;
      player.listed = listingByPlayer.has(player.id);
      player.state.seasonFinalBanned = seasonFinalBannedPlayerIds.has(player.id);
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
        card.systemRecyclable = Number(card.upgradeLevel ?? 0) <= S4_SINGLE_CARD_RECOVERY_MAX_UPGRADE_LEVEL;
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
    ownTeam.clubManagement = this.clubManagementView(account);
    return ownTeam;
  }

  shopView(accountId) {
    const purchasedQuantity = rosterLimitBonusForOwner(this.state, accountId);
    return {
      catalog:S4_PACK_CATALOG.map((pack) => {
        const purchasedQuantity = this.state.ledger
          .filter((entry) => entry.accountId === accountId && entry.type === "s4-pack-buy" && entry.packType === pack.id)
          .reduce((sum, entry) => sum + Number(entry.quantity ?? 1), 0);
        return { ...pack, purchasedQuantity, remainingQuantity:pack.seasonPurchaseLimit == null ? null : Math.max(0, pack.seasonPurchaseLimit - purchasedQuantity) };
      }),
      maxPurchaseQuantity:S4_MAX_PACK_PURCHASE_QUANTITY,
      meteorStand:{ ...METEOR_STAND_ITEM, owned:this.ownsMeteorStand(accountId) },
      rosterExpansion:{
        ...S4_ROSTER_EXPANSION_ITEM,
        retired:true,
        purchasedQuantity,
        remainingQuantity:Math.max(0, S4_ROSTER_EXPANSION_LIMIT - purchasedQuantity),
        currentRosterLimit:this.rosterLimit(accountId),
        maximumRosterLimit:S4_ROSTER_LIMIT + S4_ROSTER_EXPANSION_LIMIT,
    },
    };
  }

  s4PacksView(accountId) {
    const offer = this.state.s4Packs.offers[accountId];
    const batchOpening = this.state.s4Packs.batchOpenings[accountId];
    return {
      inventory:this.s4PackInventory(accountId).filter((item) => ["unopened", "choosing"].includes(item.status)).map((item) => this.publicS4PackItem(item)),
      offer:this.publicS4PackOffer(offer),
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

  listingView(listing, context = null) {
    if (listing.kind === "cosmetic") {
      const item = COSMETIC_BADGE_BY_ID[listing.cosmeticItemId];
      return {
        ...listing,
        item:item ? { ...item, minimumListingPrice:COSMETIC_BADGE_MINIMUM_LISTING_PRICE } : null,
        sellerTeamName:context?.teamById?.get(listing.sellerTeamId)?.name ?? this.state.teams.find((entry) => entry.id === listing.sellerTeamId)?.name ?? "未知球队",
      };
    }
    const assetKey = `${listing.sellerId}\u0000${listing.playerId}`;
    const assetStats = context?.assetStats?.get(assetKey) ?? (() => {
      const cards = this.playerCards(listing.sellerId, listing.playerId);
      const levelCounts = new Map();
      cards.forEach((card) => levelCounts.set(Number(card.upgradeLevel ?? 0), (levelCounts.get(Number(card.upgradeLevel ?? 0)) ?? 0) + 1));
      return { cardCount:cards.length, levelCounts };
    })();
    const includesOwnership = listing.kind === "card"
      && ownershipOwner(this.state, listing.playerId) === listing.sellerId
      && assetStats.cardCount === 1;
    return {
      ...listing,
      includesOwnership,
      player:marketPlayerSummary(REAL_PLAYER_BY_ID[listing.playerId]),
      card:listing.cardId && this.state.s4Assets.cards[listing.cardId] ? publicLeagueS4Card(this.state, this.state.s4Assets.cards[listing.cardId]) : null,
      retainedCardCount:listing.kind === "ownership" && listing.retainedUpgradeLevel != null
        ? assetStats.levelCounts.get(Number(listing.retainedUpgradeLevel)) ?? 0
        : 0,
      sellerTeamName:context?.teamById?.get(listing.sellerTeamId)?.name ?? this.state.teams.find((entry) => entry.id === listing.sellerTeamId)?.name ?? "未知球队",
    };
  }

  activeListingsView() {
    const listings = this.state.listings.filter((item) => item.status === "active");
    const teamById = new Map(this.state.teams.map((team) => [team.id, team]));
    const assetStats = new Map();
    listings.forEach((listing) => {
      if (listing.kind === "cosmetic") return;
      const key = `${listing.sellerId}\u0000${listing.playerId}`;
      if (assetStats.has(key)) return;
      const cards = this.playerCards(listing.sellerId, listing.playerId);
      const levelCounts = new Map();
      cards.forEach((card) => levelCounts.set(Number(card.upgradeLevel ?? 0), (levelCounts.get(Number(card.upgradeLevel ?? 0)) ?? 0) + 1));
      assetStats.set(key, { cardCount:cards.length, levelCounts });
    });
    return listings.map((listing) => this.listingView(listing, { assetStats, teamById }));
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
    if (options.cosmetics) result.cosmetics = this.cosmeticsView(account.id);
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
      seasonFinalTournament:this.seasonFinalTournamentView(account),
      serverTime:this.now(),
      schedule:{ activeHours:"10:00 - 22:00", intervalMinutes:20, serverPause:true, fixtures:team ? this.teamSchedule(team.id) : [] },
      teams:this.standings().map((entry) => { const teamEntry = this.state.teams.find((candidate) => candidate.id === entry.id); return { ...publicTeam(teamEntry, false, this.equippedTeamBadge(teamEntry?.ownerId), this.equippedClubBadge(teamEntry?.ownerId)), rank:entry.rank }; }),
      ownTeam,
      bondCatalog:S4_BOND_CATALOG,
      draft:this.draftView(account),
      aiSlotsRemaining:this.state.teams.filter((entry) => !entry.ownerId && !Object.values(this.state.drafts).some((item) => item.teamId === entry.id)).length,
      wallet:this.wallet(account.id),
      xGrowth:this.publicXGrowth(account.id),
      shop:this.shopView(account.id),
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
      cosmetics:this.cosmeticsView(account.id),
      s4Packs:{
        inventory:this.s4PackInventory(account.id).filter((item) => ["unopened", "choosing"].includes(item.status)).map((item) => this.publicS4PackItem(item)),
        offer:this.publicS4PackOffer(this.state.s4Packs.offers[account.id]),
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
      teamLeaderboards:team ? this.teamLeaderboards(team.id) : { scorers:[], assists:[], ratings:[], saves:[], cards:[] },
      ...(options.includePlayerDirectory === false ? {} : { playerDirectory:publicS4PlayerDirectory(this.state) }),
      ballonDor:{ latest:clone(this.state.ballonDor?.results?.at(-1) ?? null) },
      honorRoomUpdatedAt:this.state.honorRoom.updatedAt,
      matchRounds:this.matchRounds(),
      recentMatches:[...this.state.matches, ...(this.state.seasonFinalTournament?.matches ?? [])].sort((left, right) => Number(right.playedAt ?? 0) - Number(left.playedAt ?? 0)).map((match) => this.matchSummary(match)),
      reviewHistory:team ? this.teamHistory(team.id).filter((match) => match.hasDotReplay) : [],
      reviewDemo:null,
      rewardOffers:[],
      listings:this.activeListingsView(),
      cardTradeOffers:this.state.cardTradeOffers
        .filter((offer) => offer.fromOwnerId === account.id || offer.toOwnerId === account.id)
        .map((offer) => this.cardTradeOfferView(offer))
        .sort((left, right) => right.createdAt - left.createdAt),
      matchPredictions:this.publicMatchPredictions(account),
      predictionLeaderboard:this.predictionLeaderboard(),
      tradeLockedCardIds:[...new Set(this.state.cardTradeOffers.filter((offer) => offer.status === "pending").flatMap((offer) => offer.offeredCardIds))],
      friendlyInvitations:this.state.friendlyInvitations.filter((item) => item.fromOwnerId === account.id || item.toOwnerId === account.id).map((item) => this.friendlyInvitationView(item)),
      mirrorMarketplace:this.mirrorMarketplaceCatalog(account),
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

  teamLeaderboards(teamId) {
    const fields = ["appearances", "goals", "assists", "saves", "tackles", "interceptions", "clearances", "blocks", "pressuresWon", "penaltiesWon", "yellowCards", "redCards", "ratingTotal"];
    const combined = new Map();
    [this.state.playerStats, this.state.cup?.playerStats].forEach((source) => Object.values(source ?? {}).filter((entry) => entry.teamId === teamId).forEach((entry) => {
      const key = `${entry.teamId}:${entry.playerId}`;
      const total = combined.get(key) ?? { ...entry, key };
      fields.forEach((field) => { total[field] = Number(total[field] ?? 0) + (combined.has(key) ? Number(entry[field] ?? 0) : 0); });
      combined.set(key, total);
    }));
    const entries = [...combined.values()].map((entry) => ({ ...entry, averageRating:entry.appearances ? Number((entry.ratingTotal / entry.appearances).toFixed(2)) : 0 }));
    const sort = (field) => [...entries].filter((entry) => entry[field] > 0).sort((a,b) => b[field] - a[field] || b.averageRating - a.averageRating).slice(0, CLUB_ROSTER_LIMIT);
    return {
      scorers:sort("goals"),
      assists:sort("assists"),
      ratings:[...entries].filter((entry) => entry.appearances >= Math.max(1, Math.ceil(this.state.season.currentRound * .25))).sort((a,b) => b.averageRating - a.averageRating).slice(0, CLUB_ROSTER_LIMIT),
      saves:sort("saves"),
      cards:[...entries].filter((entry) => entry.yellowCards || entry.redCards).sort((a,b) => b.redCards - a.redCards || b.yellowCards - a.yellowCards).slice(0, CLUB_ROSTER_LIMIT),
    };
  }

  matchSummary(match) {
    const home = this.state.teams.find((team) => team.id === match.homeId);
    const away = this.state.teams.find((team) => team.id === match.awayId);
    const competition = match.competition ?? "league";
    const label = competition === "cup"
      ? ["league", "swiss"].includes(match.cupStage)
        ? `${match.cupStage === "league" ? "联赛阶段" : "瑞士轮"}第${match.cupRound ?? match.round}轮`
        : `${CUP_STAGE_NAMES[match.cupStage] ?? "杯赛"}${match.legNumber ? ` · 第${match.legNumber}回合` : ""}`
      : competition === "worldcup"
        ? ({ group:`${match.worldCupGroupId ?? ""}组第${match.round}轮`, quarterfinal:"世界杯四分之一决赛", semifinal:"世界杯半决赛", final:"世界杯决赛" }[match.worldCupStage] ?? "黄狗世界杯")
      : competition === "friendly"
        ? "友谊赛"
      : competition === "season-final"
        ? `赛季总决赛 · ${match.seasonFinalNodeId ?? "淘汰赛"}`
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
      engineProfile:match.report?.engineProfile ?? null,
      hasDotReplay:Boolean(match.report?.dotReplay?.frames?.length),
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
    const pendingCupEvents = this.state.cup.events.filter((event) => event.status === "pending");
    const cupFixtures = this.state.cup.events.flatMap((event) => this.cupEventFixtures(event).map((fixture) => {
      if (fixture.homeId !== teamId && fixture.awayId !== teamId) return null;
      const ownIsHome = fixture.homeId === teamId;
      const match = fixture.matchId ? this.state.matches.find((entry) => entry.id === fixture.matchId) : null;
      const live = this.state.liveCupRound?.matches.find((entry) => entry.fixtureId === fixture.id && !entry.completed);
      const conditions = this.fixtureConditions(fixture, event.round, { competitionMode:"cup", legNumber:event.leg });
      const label = ["league", "swiss"].includes(event.stage) ? `${event.stage === "league" ? "联赛阶段" : "瑞士轮"}第${event.round}轮` : `${CUP_STAGE_NAMES[event.stage] ?? event.stage} · 第${event.leg}回合`;
      const pendingIndex = pendingCupEvents.indexOf(event);
      const scheduledAt = Number(this.state.cup.nextRoundAt) + Math.max(0, pendingIndex) * CUP_INTERVAL_MS;
      return { id:`cup:${fixture.id}`, competition:"cup", competitionName:"黄狗冠军杯", round:event.round, stage:event.stage, leg:event.leg, label, startsAt:match?.playedAt ?? (live ? this.state.liveCupRound.startedAt : event.status === "pending" ? scheduledAt : this.now()), status:match ? "complete" : live ? "live" : "scheduled", opponentId:ownIsHome ? fixture.awayId : fixture.homeId, opponentName:this.state.teams.find((team) => team.id === (ownIsHome ? fixture.awayId : fixture.homeId))?.name ?? "待定", venue:ownIsHome ? "home" : "away", matchId:match?.id ?? null, broadcastCode:live?.code ?? null, score:match ? (ownIsHome ? [...match.score] : [match.score[1], match.score[0]]) : null, weather:conditions.weather, referee:conditions.referee };
    }).filter(Boolean));
    const tournament = this.state.seasonFinalTournament;
    const seasonFinalFixtures = tournament && !tournament.preview ? tournament.bracket.map((node) => {
      const homeId = this.seasonFinalNodeTeamId(tournament, node.home);
      const awayId = this.seasonFinalNodeTeamId(tournament, node.away);
      if (!homeId || !awayId || ![homeId, awayId].includes(teamId)) return null;
      const ownIsHome = homeId === teamId;
      const opponentId = ownIsHome ? awayId : homeId;
      const match = tournament.matches.find((entry) => entry.seasonFinalNodeId === node.id);
      const live = this.state.liveSeasonFinalRound?.matches.find((entry) => entry.nodeId === node.id && !entry.completed);
      const finalLeg = node.group === "final" ? Number(node.id.slice(-1)) : 1;
      const conditions = this.fixtureConditions({ homeId, awayId }, 100 + node.order, { competitionMode:"cup", legNumber:finalLeg, allowSuperStorm:false });
      return {
        id:`season-final:${tournament.id}:${node.id}:${teamId}`,
        competition:"season-final",
        competitionName:"赛季总决赛",
        round:node.order + 1,
        stage:node.group,
        leg:node.group === "final" ? finalLeg : 1,
        label:node.id,
        startsAt:match?.playedAt ?? Number(live ? this.state.liveSeasonFinalRound.startedAt : node.scheduledAt ?? tournament.nextMatchAt ?? this.now()),
        status:match ? "complete" : live ? "live" : "scheduled",
        opponentId,
        opponentName:this.state.teams.find((team) => team.id === opponentId)?.name ?? "待定",
        venue:ownIsHome ? "home" : "away",
        matchId:match?.id ?? null,
        broadcastCode:live?.code ?? null,
        score:match ? (ownIsHome ? [...match.score] : [match.score[1], match.score[0]]) : null,
        weather:conditions.weather,
        referee:conditions.referee,
      };
    }).filter(Boolean) : [];
    const friendlyFixtures = this.state.friendlyFixtures.filter((fixture) => fixture.homeId === teamId || fixture.awayId === teamId).map((fixture) => {
      const ownIsHome = fixture.homeId === teamId;
      const opponentId = ownIsHome ? fixture.awayId : fixture.homeId;
      const opponent = this.state.teams.find((team) => team.id === opponentId);
      return { id:`friendly:${fixture.id}`, competition:"friendly", competitionName:"YDL友谊赛", round:0, label:"友谊赛", startsAt:fixture.startsAt, status:fixture.status, opponentId, opponentName:opponent?.name ?? "未知球队", venue:ownIsHome ? "home" : "away", matchId:fixture.matchId ?? null, broadcastCode:fixture.broadcastCode ?? null, score:fixture.score ? (ownIsHome ? [...fixture.score] : [fixture.score[1], fixture.score[0]]) : null, weather:null, referee:null };
    });
    return [...leagueFixtures, ...cupFixtures, ...seasonFinalFixtures, ...friendlyFixtures].sort((left, right) => left.startsAt - right.startsAt || left.competition.localeCompare(right.competition));
  }

  teamHistory(teamId) {
    return [...this.state.matches, ...(this.state.seasonFinalTournament?.matches ?? [])]
      .filter((match) => match.homeId === teamId || match.awayId === teamId)
      .sort((left, right) => Number(right.playedAt ?? 0) - Number(left.playedAt ?? 0) || Number(right.round ?? 0) - Number(left.round ?? 0))
      .map((match) => this.matchSummary(match));
  }

  liveView(account) {
    const team = this.accountTeam(account.id);
    const leagueStandings = this.standings().map(({ id, rank }) => {
      const standingTeam = this.state.teams.find((entry) => entry.id === id);
      const table = standingTeam?.table ?? {};
      return {
        id,
        rank,
        name:standingTeam?.name ?? "未知球队",
        played:Number(table.played ?? 0),
        won:Number(table.won ?? 0),
        drawn:Number(table.drawn ?? 0),
        lost:Number(table.lost ?? 0),
        goalsFor:Number(table.goalsFor ?? 0),
        goalsAgainst:Number(table.goalsAgainst ?? 0),
        points:Number(table.points ?? 0),
      };
    });
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
      leagueStandings,
      cup:this.cupView(),
      schedule:team ? this.teamSchedule(team.id) : [],
      history:team ? this.teamHistory(team.id) : [],
      broadcasts:this.broadcasts(),
    });
  }

  predictionMarketId(competition, roundKey, fixture) {
    const fixtureKey = competition === "league" ? `${fixture.homeId}-${fixture.awayId}` : fixture.id;
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
        const tie = ["league", "swiss"].includes(cupEvent.stage) ? null : this.state.cup.knockout[cupEvent.stage].find((entry) => entry.legs.includes(fixture));
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
            allowSuperStorm:["league", "swiss"].includes(cupEvent.stage),
            regulationOnly:cupEvent.stage === "league" ? true : cupEvent.stage === "swiss" || cupEvent.stage === "final" ? false : cupEvent.leg === 1,
            aggregateBaseScore:cupEvent.leg === 2 && firstLeg ? [firstLeg.score[1], firstLeg.score[0]] : null,
          },
        });
      });
    }
    const tournament = this.state.seasonFinalTournament;
    if (tournament && !tournament.preview && !["completed", "cancelled"].includes(tournament.status)) {
      tournament.bracket.filter((node) => node.status === "pending" && Number(node.scheduledAt) > this.now()).forEach((node) => {
        const homeId = this.seasonFinalNodeTeamId(tournament, node.home);
        const awayId = this.seasonFinalNodeTeamId(tournament, node.away);
        if (!homeId || !awayId) return;
        const finalLeg = node.group === "final" ? Number(node.id.slice(-1)) : 0;
        const firstLeg = tournament.bracket.find((entry) => entry.id === "FINAL-1");
        const fixture = { id:`${tournament.id}:${node.id}`, homeId, awayId };
        const bannedPlayerIdsByTeam = node.group === "final"
          ? Object.fromEntries([homeId, awayId].map((teamId) => [teamId, this.seasonFinalBannedPlayerIds(teamId, tournament)]))
          : {};
        entries.push({
          id:this.predictionMarketId("season-final", node.id, fixture),
          competition:"season-final",
          competitionName:"赛季总决赛",
          round:node.order + 1,
          stage:node.group,
          leg:finalLeg || 1,
          roundKey:node.id,
          fixture,
          startsAt:Number(node.scheduledAt),
          matchOptions:{
            competitionMode:"cup",
            availabilityMode:"season-final",
            legNumber:finalLeg || 1,
            allowSuperStorm:false,
            regulationOnly:finalLeg === 1,
            aggregateBaseScore:finalLeg === 2 && firstLeg?.score ? [firstLeg.score[1], firstLeg.score[0]] : null,
            bannedPlayerIdsByTeam,
          },
        });
      });
    }
    return entries;
  }

  predictionGoalBand(total) {
    return total <= 3 ? "0-3" : total <= 5 ? "4-5" : "6+";
  }

  predictionGoalBandForMarket(total, market) {
    const legacy = Number(market?.pricingVersion ?? 0) < 9
      && Object.prototype.hasOwnProperty.call(market?.payoutRates?.goals ?? {}, "0-5");
    return legacy ? (total <= 5 ? "0-5" : total <= 10 ? "6-10" : "11+") : this.predictionGoalBand(total);
  }

  predictionCardBand(total) {
    return total <= 0 ? "0" : total === 1 ? "1" : total === 2 ? "2" : total === 3 ? "3" : "4+";
  }

  predictionScoreAtMinute(report, minute = 45) {
    const score = [0, 0];
    const scoringTypes = new Set(["goal", "butterFingers", "ownGoal", "superWorldie"]);
    for (const event of report?.events ?? []) {
      if (Number(event.minute) > minute) continue;
      if (event.type === "penalty" && event.scored) {
        if ([0, 1].includes(Number(event.teamIndex))) score[Number(event.teamIndex)] += 1;
        continue;
      }
      if (!scoringTypes.has(event.type)) continue;
      if (Array.isArray(event.score) && event.score.length >= 2) {
        score[0] = Number(event.score[0] ?? score[0]);
        score[1] = Number(event.score[1] ?? score[1]);
      } else if ([0, 1].includes(Number(event.teamIndex))) {
        score[Number(event.teamIndex)] += 1;
      }
    }
    return score;
  }

  predictionHalfFullOutcome(report) {
    const halfTimeScore = Array.isArray(report?.halfTimeScore) ? report.halfTimeScore : this.predictionScoreAtMinute(report, 45);
    const regulationScore = Array.isArray(report?.events) && report.events.length
      ? this.predictionScoreAtMinute(report, 90)
      : Array.isArray(report?.regulationScore) ? report.regulationScore : report?.score ?? [0, 0];
    return {
      halfTimeScore,
      regulationScore:[Number(regulationScore[0] ?? 0), Number(regulationScore[1] ?? 0)],
      outcome:`${this.predictionResult(halfTimeScore)}-${this.predictionResult(regulationScore)}`,
    };
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
    const handicap = Math.max(-2, Math.min(2, best.handicap));
    const counts = { home:0, draw:0, away:0 };
    scores.forEach((score) => { counts[this.predictionResult(score, handicap)] += 1; });
    return { handicap, counts };
  }

  predictionHandicapHint(handicap) {
    const value = Number(handicap);
    if (!Number.isInteger(value)) return "盘口分析中";
    if (value < 0) return "主队让球";
    if (value > 0) return "客队让球";
    return "零球盘";
  }

  predictionClosesAt(startsAt) {
    return Number(startsAt) - MATCH_PREDICTION_LOCK_LEAD_MS;
  }

  predictionCategoryLabel(category) {
    return { result:"胜平负", goals:"总进球", cards:"红黄牌总数", halfFull:"半全场" }[category] ?? category;
  }

  predictionSelectionLabel(market, category, selection) {
    if (category === "result") return selection === "home" ? `${market.homeName}胜` : selection === "away" ? `${market.awayName}胜` : "平局";
    if (category === "goals") return {
      "0-3":"0–3球", "4-5":"4–5球", "6+":"6球及以上",
      "0-5":"0–5球", "6-10":"6–10球", "11+":"11球及以上",
    }[selection] ?? selection;
    if (category === "cards") return selection === "4+" ? "4张及以上" : `${selection}张`;
    if (category === "halfFull") {
      const label = { home:"胜", draw:"平", away:"负" };
      const [halfTime, fullTime] = String(selection).split("-");
      return `${label[halfTime] ?? halfTime}${label[fullTime] ?? fullTime}`;
    }
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

  predictionPayoutRatesFromProbabilities(probabilities, options, maximumRate = MATCH_PREDICTION_MAX_PAYOUT_RATE) {
    return Object.fromEntries(options.map((option) => {
      const probability = Math.max(Number.EPSILON, Number(probabilities?.[option]) || 0);
      const rate = Math.max(1.05, Math.min(maximumRate, (1 - MATCH_PREDICTION_MARGIN) / probability));
      return [option, Number(rate.toFixed(3))];
    }));
  }

  predictionHalfFullPayoutRates(probabilities) {
    return Object.fromEntries(MATCH_PREDICTION_OPTIONS.halfFull.map((selection) => {
      const probability = Math.max(Number.EPSILON, Number(probabilities?.[selection]) || 0);
      const fairRate = (1 - MATCH_PREDICTION_MARGIN) / probability;
      // Soft-compress rare paths without making different probabilities collide
      // at a fixed ceiling. Prices remain strictly ordered as probability changes.
      const rate = fairRate <= 7 ? fairRate : 7 + 1.35 * Math.log1p(fairRate - 7);
      return [selection, Number(Math.max(1.05, rate).toFixed(3))];
    }));
  }

  predictionHalfFullPricingProbabilities(counts, samples) {
    const fullTimeOptions = MATCH_PREDICTION_OPTIONS.result;
    const halfTimeOptions = MATCH_PREDICTION_OPTIONS.result;
    const transitionPrior = Object.freeze({
      home:Object.freeze({ home:.55, draw:.35, away:.1 }),
      draw:Object.freeze({ home:.2, draw:.6, away:.2 }),
      away:Object.freeze({ home:.1, draw:.35, away:.55 }),
    });
    const transitionPriorWeight = .7;
    const fullTimeCounts = Object.fromEntries(fullTimeOptions.map((fullTime) => [fullTime,
      halfTimeOptions.reduce((sum, halfTime) => sum + Number(counts?.[`${halfTime}-${fullTime}`] ?? 0), 0),
    ]));
    // Team strength first determines the full-time result mass. A fixed transition
    // prior is then blended with this match's V1 paths, so even a zero-count path
    // moves down/up with the favorite's final-win/final-loss probability instead
    // of inheriting a sample-size artefact.
    const fullTimeDenominator = Math.max(0, Number(samples) || 0) + fullTimeOptions.length;
    const probabilities = {};
    fullTimeOptions.forEach((fullTime) => {
      const fullTimeCount = fullTimeCounts[fullTime];
      const fullTimeProbability = (fullTimeCount + 1) / fullTimeDenominator;
      halfTimeOptions.forEach((halfTime) => {
        const selection = `${halfTime}-${fullTime}`;
        const empiricalProbability = fullTimeCount > 0
          ? Number(counts?.[selection] ?? 0) / fullTimeCount
          : transitionPrior[fullTime][halfTime];
        const conditionalProbability = transitionPriorWeight * transitionPrior[fullTime][halfTime]
          + (1 - transitionPriorWeight) * empiricalProbability;
        probabilities[selection] = fullTimeProbability * conditionalProbability;
      });
    });
    return Object.fromEntries(MATCH_PREDICTION_OPTIONS.halfFull.map((selection) => [selection,
      Number(probabilities[selection].toFixed(6)),
    ]));
  }

  predictionCardPayoutRates(counts, samples) {
    const rawRates = this.predictionPayoutRates(counts, samples, MATCH_PREDICTION_OPTIONS.cards);
    return Object.fromEntries(MATCH_PREDICTION_OPTIONS.cards.map((option) => {
      const guard = MATCH_PREDICTION_CARD_PAYOUT_GUARDS[option];
      const calibrated = Number(rawRates[option] ?? 1.05) * guard.multiplier;
      const rate = Math.max(guard.minimum, Math.min(guard.maximum, calibrated));
      return [option, Number(rate.toFixed(3))];
    }));
  }

  predictionPublishedPayoutRate(rateValue, marketId, category, selection, directedDiscount = 1) {
    const rate = Math.max(1.05, Number(rateValue) || 1.05);
    const highOddsWeight = Math.min(1, Math.max(0, (rate - 1) / 6));
    let discount = MATCH_PREDICTION_LOW_ODDS_DISCOUNT
      + (MATCH_PREDICTION_HIGH_ODDS_DISCOUNT - MATCH_PREDICTION_LOW_ODDS_DISCOUNT) * highOddsWeight;
    if (category === "halfFull" && rate > 7) {
      // Keep long prices ordered by their underlying probability, but charge an
      // increasingly larger risk discount instead of flattening them at a cap.
      discount *= Math.max(.65, 1 - (rate - 7) * .03);
    }
    const confusion = 1 + (seededUnitInterval(`${marketId}:${category}:${selection}:published-rate-v${MATCH_PREDICTION_PRICING_VERSION}`) * 2 - 1) * MATCH_PREDICTION_CONFUSION_RANGE;
    const resultRiskDiscount = Number.isFinite(Number(directedDiscount))
      ? Math.max(0, Math.min(1, Number(directedDiscount)))
      : 1;
    return Number(Math.max(MATCH_PREDICTION_MIN_PUBLISHED_RATE, rate * discount * resultRiskDiscount * confusion).toFixed(2));
  }

  predictionMarketRtp(rates) {
    const inverseTotal = Object.values(rates ?? {}).reduce((sum, rateValue) => {
      const rate = Number(rateValue);
      return Number.isFinite(rate) && rate > 0 ? sum + 1 / rate : sum;
    }, 0);
    return inverseTotal > 0 ? 1 / inverseTotal : 0;
  }

  predictionCapMarketRtp(rates, targetRtp) {
    const target = Number(targetRtp);
    if (!Number.isFinite(target) || target <= 0 || this.predictionMarketRtp(rates) <= target) return rates;
    let lowerScale = 0;
    let upperScale = 1;
    const scaledRates = (scale) => Object.fromEntries(Object.entries(rates).map(([selection, rateValue]) => [
      selection,
      Number(Math.max(MATCH_PREDICTION_MIN_PUBLISHED_RATE, Number(rateValue) * scale).toFixed(2)),
    ]));
    for (let index = 0; index < 32; index += 1) {
      const scale = (lowerScale + upperScale) / 2;
      if (this.predictionMarketRtp(scaledRates(scale)) <= target) lowerScale = scale;
      else upperScale = scale;
    }
    let result = scaledRates(lowerScale);
    // Two-decimal display rounding can cross the cap by a fraction. Prefer
    // trimming the longest price first, which also reinforces the high-odds cut.
    while (this.predictionMarketRtp(result) > target + 1e-9) {
      const selection = Object.entries(result).sort((left, right) => right[1] - left[1])[0]?.[0];
      if (!selection || result[selection] <= MATCH_PREDICTION_MIN_PUBLISHED_RATE) break;
      result = { ...result, [selection]:Number(Math.max(MATCH_PREDICTION_MIN_PUBLISHED_RATE, result[selection] - .01).toFixed(2)) };
    }
    return result;
  }

  predictionPublishedPayoutRates(payoutRates, marketId, resultHandicap = 0) {
    const handicap = Number(resultHandicap);
    const directedResultSelection = handicap > 0 ? "home" : handicap < 0 ? "away" : null;
    const directedResultDiscount = MATCH_PREDICTION_DIRECTED_RESULT_DISCOUNT[Math.min(2, Math.abs(handicap))] ?? 1;
    return Object.fromEntries(Object.entries(payoutRates).map(([category, rates]) => {
      const published = Object.fromEntries(Object.entries(rates).map(([selection, rate]) => [selection,
        this.predictionPublishedPayoutRate(
          rate,
          marketId,
          category,
          selection,
          category === "result" && selection === directedResultSelection ? directedResultDiscount : 1,
        ),
      ]));
      return [category, this.predictionCapMarketRtp(published, MATCH_PREDICTION_MAX_MARKET_RTP[category])];
    }));
  }

  generatePredictionMarket(entry) {
    const existing = this.state.matchPredictions.markets[entry.id];
    if (existing && existing.status !== "preparing" && Number.isInteger(existing.resultHandicap)) return existing;
    const goalCounts = Object.fromEntries(MATCH_PREDICTION_OPTIONS.goals.map((key) => [key, 0]));
    const cardCounts = Object.fromEntries(MATCH_PREDICTION_OPTIONS.cards.map((key) => [key, 0]));
    const halfFullCounts = Object.fromEntries(MATCH_PREDICTION_OPTIONS.halfFull.map((key) => [key, 0]));
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
      const halfFull = this.predictionHalfFullOutcome(report);
      simulatedScores.push([...report.score]);
      goalCounts[this.predictionGoalBand(totalGoals)] += 1;
      cardCounts[this.predictionCardBand(totalCards)] += 1;
      halfFullCounts[halfFull.outcome] += 1;
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
    const halfFullPricingProbabilities = this.predictionHalfFullPricingProbabilities(halfFullCounts, samples);
    const probabilities = {
      result:Object.fromEntries(MATCH_PREDICTION_OPTIONS.result.map((key) => [key, Number((resultCounts[key] / samples).toFixed(4))])),
      goals:Object.fromEntries(MATCH_PREDICTION_OPTIONS.goals.map((key) => [key, Number((goalCounts[key] / samples).toFixed(4))])),
      cards:Object.fromEntries(MATCH_PREDICTION_OPTIONS.cards.map((key) => [key, Number((cardCounts[key] / samples).toFixed(4))])),
      halfFull:Object.fromEntries(MATCH_PREDICTION_OPTIONS.halfFull.map((key) => [key, Number((halfFullCounts[key] / samples).toFixed(4))])),
    };
    const rawPayoutRates = {
      result:this.predictionPayoutRates(resultCounts, samples, MATCH_PREDICTION_OPTIONS.result),
      goals:this.predictionPayoutRates(goalCounts, samples, MATCH_PREDICTION_OPTIONS.goals),
      cards:this.predictionCardPayoutRates(cardCounts, samples),
      halfFull:this.predictionHalfFullPayoutRates(halfFullPricingProbabilities),
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
        counts:{ result:resultCounts, goals:goalCounts, cards:cardCounts, halfFull:halfFullCounts },
        probabilities,
        pricingProbabilities:{ halfFull:halfFullPricingProbabilities },
        expected:{
          goals:totals.goals.map((value) => Number((value / samples).toFixed(3))),
          xg:totals.xg.map((value) => Number((value / samples).toFixed(3))),
          yellowCards:totals.yellowCards.map((value) => Number((value / samples).toFixed(3))),
          redCards:totals.redCards.map((value) => Number((value / samples).toFixed(3))),
        },
      },
      pricingVersion:MATCH_PREDICTION_PRICING_VERSION,
      rawPayoutRates,
      payoutRates:this.predictionPublishedPayoutRates(rawPayoutRates, entry.id, resultBalance.handicap),
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
      pricingVersion:null,
      rawPayoutRates:null,
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
        && (!Number.isInteger(market.resultHandicap) || Number(market.pricingVersion ?? 0) !== MATCH_PREDICTION_PRICING_VERSION)
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
        const goalOptions = Object.prototype.hasOwnProperty.call(market.payoutRates?.goals ?? {}, "0-5")
          ? [["0-5", "0–5球"], ["6-10", "6–10球"], ["11+", "11球及以上"]]
          : [["0-3", "0–3球"], ["4-5", "4–5球"], ["6+", "6球及以上"]];
        const publicPayoutRate = (category, selection) => {
          const rate = Number(market.payoutRates?.[category]?.[selection]);
          return Number.isFinite(rate) ? rate : null;
        };
        const ownBets = bets.filter((bet) => bet.marketId === market.id).map((bet) => ({
          id:bet.id,
          category:bet.category,
          selection:bet.selection,
          amount:bet.amount,
          payoutRate:Number(bet.payoutRate),
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
          resultHandicap:Number.isInteger(market.resultHandicap) ? market.resultHandicap : null,
          resultHandicapHint:this.predictionHandicapHint(market.resultHandicap),
          status:preparing ? "preparing" : open ? "open" : "locked",
          eligible:Boolean(team && open && !ownTeamMatch),
          lockedReason:!team ? "请先建立联赛球队" : ownTeamMatch ? "不能预测自己球队参加的比赛" : preparing ? "系统正在生成本场预测数据" : open ? null : "本场预测已经截止",
          maxStake:MATCH_PREDICTION_MAX_STAKE,
          maxStakes:Object.fromEntries(Object.keys(MATCH_PREDICTION_OPTIONS).map((category) => [
            category,
            MATCH_PREDICTION_MAX_STAKE_BY_CATEGORY[category] ?? MATCH_PREDICTION_MAX_STAKE,
          ])),
          options:{
            result:[
              { id:"home", label:`${market.homeName}胜`, payoutRate:publicPayoutRate("result", "home") },
              { id:"draw", label:"平局", payoutRate:publicPayoutRate("result", "draw") },
              { id:"away", label:`${market.awayName}胜`, payoutRate:publicPayoutRate("result", "away") },
            ],
            goals:goalOptions.map(([selection, label]) => ({
              id:selection,
              label,
              payoutRate:publicPayoutRate("goals", selection),
            })),
            cards:[
              { id:"0", label:"0张", payoutRate:publicPayoutRate("cards", "0") },
              { id:"1", label:"1张", payoutRate:publicPayoutRate("cards", "1") },
              { id:"2", label:"2张", payoutRate:publicPayoutRate("cards", "2") },
              { id:"3", label:"3张", payoutRate:publicPayoutRate("cards", "3") },
              { id:"4+", label:"4张及以上", payoutRate:publicPayoutRate("cards", "4+") },
            ],
            halfFull:MATCH_PREDICTION_OPTIONS.halfFull.map((selection) => ({
              id:selection,
              label:this.predictionSelectionLabel(market, "halfFull", selection),
              payoutRate:publicPayoutRate("halfFull", selection),
            })),
          },
          myBets:ownBets,
        };
      });
  }

  publicPredictionHistory(account, limitValue = 100) {
    const limit = Math.max(1, Math.min(200, Math.floor(Number(limitValue) || 100)));
    return this.state.matchPredictions.bets
      .filter((bet) => bet.accountId === account.id)
      .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))
      .slice(0, limit)
      .map((bet) => {
        const market = this.state.matchPredictions.markets[bet.marketId];
        return {
          id:bet.id,
          marketId:bet.marketId,
          competition:market?.competition ?? null,
          competitionName:market?.competitionName ?? "比赛预测",
          homeName:market?.homeName ?? "未知球队",
          awayName:market?.awayName ?? "未知球队",
          startsAt:market?.startsAt ?? null,
          category:bet.category,
          categoryLabel:this.predictionCategoryLabel(bet.category),
          selection:bet.selection,
          selectionLabel:market ? this.predictionSelectionLabel(market, bet.category, bet.selection) : bet.selection,
          amount:bet.amount,
          payoutRate:Number(bet.payoutRate),
          status:bet.status,
          payout:bet.status === "won" ? Number(bet.payout ?? 0) : 0,
          createdAt:bet.createdAt,
          settledAt:bet.settledAt ?? null,
        };
      });
  }

  predictionView(account) {
    return clone({
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      wallet:{ balance:this.wallet(account.id).balance },
      matchPredictions:this.publicMatchPredictions(account),
      predictionHistory:this.publicPredictionHistory(account),
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
    const marketSelections = Object.keys(market.payoutRates?.[category] ?? {});
    if (!MATCH_PREDICTION_OPTIONS[category] || !marketSelections.includes(selection)) throw new Error("预测选项无效");
    const lockedPayoutRate = Number(market.payoutRates?.[category]?.[selection]);
    if (!Number.isFinite(lockedPayoutRate) || lockedPayoutRate <= 0) throw new Error("本场暂未开放该预测分类");
    const maxStake = MATCH_PREDICTION_MAX_STAKE_BY_CATEGORY[category] ?? MATCH_PREDICTION_MAX_STAKE;
    if (!Number.isInteger(amount) || amount < 1 || amount > maxStake) throw new Error(`该预测类别投资必须为1至${maxStake}金币的整数`);
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
      payoutRate:lockedPayoutRate,
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
    const payoutRate = lockedPayoutRate;
    const potentialPayout = Math.max(1, Math.floor(amount * payoutRate));
    const resultHandicap = Number.isInteger(market.resultHandicap) ? market.resultHandicap : 0;
    this.pushInbox(team, {
      id:`prediction-placed:${bet.id}`,
      type:"prediction",
      title:"比赛预测已受理",
      summary:`${market.homeName} vs ${market.awayName}：${categoryLabel}选择“${selectionLabel}”，赔率${payoutRate.toFixed(2)}，投资${amount}金币。`,
      body:`你的比赛预测已经提交成功。比赛：${market.homeName} vs ${market.awayName}；本场胜平负按主队${resultHandicap >= 0 ? "+" : ""}${resultHandicap}球结算；${category === "halfFull" ? "半全场按主队视角的45分钟结果和90分钟常规时间结果结算，加时赛与点球大战不计入；" : ""}预测类别：${categoryLabel}；本玩法单场最多投入${maxStake}金币；预测选项：${selectionLabel}；锁定赔率：${payoutRate.toFixed(2)}；投入：${amount}金币；命中预计返还：${potentialPayout}金币（含本金）。比赛结束后系统会自动结算。`,
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
        payoutRate,
        potentialPayout,
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
    const halfFull = this.predictionHalfFullOutcome(record.report);
    const resultHandicap = Number.isInteger(market.resultHandicap) ? market.resultHandicap : 0;
    const adjustedScore = [Number(record.score[0] ?? 0) + resultHandicap, Number(record.score[1] ?? 0)];
    const outcomes = {
      result:this.predictionResult(record.score, resultHandicap),
      goals:this.predictionGoalBandForMarket(totalGoals, market),
      cards:this.predictionCardBand(totalCards),
      halfFull:halfFull.outcome,
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
      halfTimeScore:halfFull.halfTimeScore,
      regulationScore:halfFull.regulationScore,
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
          body:`比赛结果：${market.homeName} ${record.score[0]}:${record.score[1]} ${market.awayName}。胜平负按主队${resultHandicap >= 0 ? "+" : ""}${resultHandicap}球结算，让球后比分为${adjustedScore[0]}:${adjustedScore[1]}。${bet.category === "halfFull" ? `半场比分${halfFull.halfTimeScore[0]}:${halfFull.halfTimeScore[1]}，90分钟常规时间比分${halfFull.regulationScore[0]}:${halfFull.regulationScore[1]}。` : ""}你的${categoryLabel}预测为“${selectionLabel}”，实际结果为“${outcomeLabel}”。本次投入${bet.amount}金币，返还${bet.payout}金币，净收益${netProfit >= 0 ? "+" : ""}${netProfit}金币。`,
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
            halfTimeScore:halfFull.halfTimeScore,
            regulationScore:halfFull.regulationScore,
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
    const upgradeLevel = (playerId) => Number(this.representativeCard(team.ownerId, playerId)?.upgradeLevel ?? 0);
    const publicStarter = (player) => applyS4Enhancement(playerSummary(player), upgradeLevel(player.id));
    const publicRosterPlayer = (player) => {
      const level = upgradeLevel(player.id);
      return { id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole, grade:player.grade, overall:s4EffectiveOverall(player, level), upgradeLevel:level };
    };
    const roster = team.ownerId
      ? team.rosterIds.map((id) => publicRosterPlayer(REAL_PLAYER_BY_ID[id]))
      : lineup.map(publicRosterPlayer);
    const recentHistoryPage = this.teamHistoryPage(account, team.id, 0, 5);
    return clone({
      id:team.id,
      name:team.name,
      isAi:!team.ownerId,
      ownerName:team.ownerName,
      equippedBadge:this.equippedTeamBadge(team.ownerId),
      equippedClubBadge:this.equippedClubBadge(team.ownerId),
      table:{ ...team.table },
      formation:lineup.length === 11 ? analyzeElevenFormation(lineup, positions).name : null,
      starters:lineup.map((player) => ({ ...publicStarter(player), position:{ ...positions[player.id] }, captain:player.id === team.captainId })),
      roster,
      recentHistory:recentHistoryPage.history,
      historyTotal:recentHistoryPage.total,
      isOwn:team.ownerId === account.id,
      canInviteFriendly:Boolean(team.ownerId && team.ownerId !== account.id),
    });
  }

  matchDetail(account, matchIdValue) {
    if (String(matchIdValue ?? "") === "__v2_review_demo__") return this.v2ReviewDemoDetail();
    const match = this.state.matches.find((entry) => entry.id === String(matchIdValue ?? ""))
      ?? this.state.seasonFinalTournament?.matches?.find((entry) => entry.id === String(matchIdValue ?? ""));
    if (!match?.report) throw new Error("找不到这场比赛的详细记录");
    const ownTeam = this.accountTeam(account.id);
    const viewerTeamId = match.competition === "worldcup" ? null : ownTeam?.id;
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
    team.clubManagement = null;
    this.ensureClubManagement(team);
    team.ownerId = account.id;
    team.ownerName = account.nickname;
    team.joinedAt = this.now();
    team.rosterIds = [...draft.selectedIds, draft.xPlayerId];
    team.preferredStarterIds = pickStartingIds(team.rosterIds);
    team.positions = leagueBoardPositions(team.preferredStarterIds.map((id) => REAL_PLAYER_BY_ID[id]));
    team.positionPresets = Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(team.positions)]));
    team.activeLineupSchemeId = "lineup-1";
    team.lineupSchemes = [lineupSchemeSnapshot({ ...team, competitionScope:"all" }, "lineup-1", "方案 1")];
    team.lineupSchemeAssignments = { league:"lineup-1", cup:"lineup-1", friendly:"lineup-1" };
    team.playerState = Object.fromEntries(team.rosterIds.map((id) => [id, { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 }]));
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
        captainId:team.captainId ?? null,
        captainStyle:normalizeCaptainStyle(team.captainStyle),
        tacticalPlans:team.tacticalPlans,
        activeLineupSchemeId:team.activeLineupSchemeId,
        lineupSchemes:team.lineupSchemes,
        lineupSchemeAssignments:team.lineupSchemeAssignments,
      },
    });
  }

  teamHistoryPage(account, teamIdValue, offsetValue = 0, limitValue = 8) {
    void account;
    const team = this.state.teams.find((entry) => entry.id === String(teamIdValue ?? ""));
    if (!team) throw new Error("找不到这支球队");
    const offset = Math.max(0, Math.floor(Number(offsetValue) || 0));
    const limit = Math.max(1, Math.min(20, Math.floor(Number(limitValue) || 8)));
    const matches = [...this.state.matches, ...(this.state.seasonFinalTournament?.matches ?? [])]
      .filter((match) => match.homeId === team.id || match.awayId === team.id)
      .sort((left, right) => Number(right.playedAt ?? 0) - Number(left.playedAt ?? 0) || Number(right.round ?? 0) - Number(left.round ?? 0));
    const history = matches.slice(offset, offset + limit).map((match) => this.matchSummary(match));
    const nextOffset = offset + history.length;
    return clone({ teamId:team.id, history, total:matches.length, nextOffset:nextOffset < matches.length ? nextOffset : null });
  }

  tacticalShapePreview(account, body = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const starters = [...new Set(body.starterIds ?? team.preferredStarterIds ?? [])];
    if (starters.length !== 11 || starters.some((id) => !team.rosterIds.includes(id))) throw new Error("动态预览需要完整的11人首发阵容");
    const players = starters.map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean);
    if (players.length !== 11) throw new Error("动态预览无法识别当前首发球员");
    const planState = ["opening", "leading", "trailing"].includes(body.planState) ? body.planState : "opening";
    const positionPreset = { opening:"position1", leading:"position2", trailing:"position3" }[planState];
    const positionSource = body.positionPresets?.[positionPreset]
      ?? (positionPreset === "position1" ? body.positions : null)
      ?? team.positionPresets?.[positionPreset]
      ?? team.positions;
    const positions = sanitizePositions(players, positionSource);
    const formationLines = sanitizeFormationLines(
      body.formationLinePresets?.[positionPreset]
        ?? team.formationLinePresets?.[positionPreset]
        ?? deriveFormationLines(players.map((player) => ({ id:player.id, position:positions[player.id] }))),
    );
    const roles = inferFormationBoardRoles(players.map((player) => ({ id:player.id, position:positions[player.id] })), formationLines);
    const fallback = team.tacticalPlans?.[planState] ?? team.tacticalPlans?.opening ?? { tactic:team.tactic, style:team.style };
    const submitted = body.tacticalPlans?.[planState] ?? {};
    const plan = {
      tactic:TACTICS.has(submitted.tactic) ? submitted.tactic : fallback.tactic ?? "balanced",
      style:STYLES.has(submitted.style) ? submitted.style : fallback.style ?? "possession",
      inPossession:IN_POSSESSION_PLANS.has(submitted.inPossession) ? submitted.inPossession : fallback.inPossession ?? "balanced",
      outOfPossession:OUT_OF_POSSESSION_PLANS.has(submitted.outOfPossession) ? submitted.outOfPossession : fallback.outOfPossession ?? "balanced",
      ...v2TacticalDetailsProperty(submitted, fallback),
      ...v2TacticalDimensionsProperty(submitted.tacticalDimensions, fallback.tacticalDimensions, submitted),
      ...v2PlayerDutiesProperty(submitted.playerDuties, starters, roles, fallback.playerDuties),
    };
    const scoreState = planState === "leading" ? "leading" : planState === "trailing" ? "trailing" : "level";
    const minute = planState === "opening" ? 25 : 70;
    return buildV21TacticalShapePreview({
      players,
      positions,
      roles,
      plan,
      attackFocus:body.attackFocus ?? team.attackFocus,
      defenseFocus:body.defenseFocus ?? team.defenseFocus,
      scoreState,
      minute,
      parameters:STABLE_V21_PARAMETERS,
    });
  }

  saveTeam(account, body, options = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    if (body.lineupSchemeId && body.lineupSchemeId !== team.activeLineupSchemeId) throw new Error("阵容方案已切换，请刷新后重试");
    const activeScheme = team.lineupSchemes?.find((scheme) => scheme.id === team.activeLineupSchemeId);
    const currentRevision = Math.max(0, Math.floor(Number(activeScheme?.revision ?? 0)));
    const submittedRevision = Number(body.lineupSchemeRevision);
    if (currentRevision > 0 && !Number.isFinite(submittedRevision)) throw new Error("当前阵容方案已被其他设备更新，请刷新后重试");
    if (Number.isFinite(submittedRevision) && Math.floor(submittedRevision) !== currentRevision) throw new Error("当前阵容方案已被其他设备更新，请刷新后重试");
    const starters = [...new Set(body.starterIds ?? [])];
    if (starters.length !== 11 || starters.some((id) => !team.rosterIds.includes(id) || this.rosterOverlimitLocked(team, id))) throw new Error("必须从注册名单中选择11名未被超限锁定的球员");
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
      if (!valid) throw new Error(`${key === "position1" ? "默认站位" : key === "position2" ? "领先站位" : "落后站位"}：门将必须且只能有一人${key === "position1" ? "，并保留前中后三条外场线" : ""}`);
      return [key, sanitized];
    }));
    team.preferredStarterIds = starters;
    team.positionPresets = positionPresets;
    const captainId = String(body.captainId ?? "");
    if (captainId && !starters.includes(captainId)) throw new Error("队长必须来自当前方案的默认11人首发");
    team.captainId = captainId || null;
    team.captainStyle = normalizeCaptainStyle(body.captainStyle);
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
      const preset = POSITION_PRESET_KEYS[index];
      const roles = inferFormationBoardRoles(players.map((player) => ({ id:player.id, position:positionPresets[preset]?.[player.id] })), formationLinePresets[preset]);
      return [state, {
        tactic:TACTICS.has(plans[state]?.tactic) ? plans[state].tactic : fallback.tactic,
        style:STYLES.has(plans[state]?.style) ? plans[state].style : fallback.style,
        positionPreset:POSITION_PRESET_KEYS[index],
        ...(state === "opening" ? {} : { triggerGoalDifference:Math.max(1, Math.min(5, Math.round(Number(plans[state]?.triggerGoalDifference ?? fallback.triggerGoalDifference) || 1))) }),
        inPossession:IN_POSSESSION_PLANS.has(plans[state]?.inPossession) ? plans[state].inPossession : fallback.inPossession ?? "balanced",
        outOfPossession:OUT_OF_POSSESSION_PLANS.has(plans[state]?.outOfPossession) ? plans[state].outOfPossession : fallback.outOfPossession ?? "balanced",
        ...v2TacticalDetailsProperty(plans[state], fallback),
        ...v2TacticalDimensionsProperty(plans[state]?.tacticalDimensions, fallback.tacticalDimensions, plans[state]),
        ...v2PlayerDutiesProperty(plans[state]?.playerDuties, starters, roles, fallback.playerDuties),
      }];
    }));
    team.tactic = team.tacticalPlans.opening.tactic;
    team.style = team.tacticalPlans.opening.style;
    syncActiveLineupScheme(team);
    const savedScheme = team.lineupSchemes?.find((scheme) => scheme.id === team.activeLineupSchemeId);
    if (savedScheme) savedScheme.revision = currentRevision + 1;
    this.save();
    if (options.compact) return this.teamSaveMutationView(team);
    return this.view(account);
  }

  updateLineupScheme(account, body, options = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    team.lineupSchemes ??= [lineupSchemeSnapshot(team)];
    team.activeLineupSchemeId ??= team.lineupSchemes[0].id;
    syncActiveLineupScheme(team);
    const action = String(body.action ?? "select");
    if (body.expectedActiveLineupSchemeId && body.expectedActiveLineupSchemeId !== team.activeLineupSchemeId) throw new Error("阵容方案已在其他设备切换，请刷新后重试");
    if (action === "create") {
      if (team.lineupSchemes.length >= LINEUP_SCHEME_LIMIT) throw new Error("最多只能保存3套阵容方案");
      const used = new Set(team.lineupSchemes.map((scheme) => scheme.id));
      const index = [1, 2, 3].find((value) => !used.has(`lineup-${value}`)) ?? team.lineupSchemes.length + 1;
      const name = String(body.name ?? `方案 ${index}`).trim().slice(0, 20) || `方案 ${index}`;
      const scheme = lineupSchemeSnapshot(team, `lineup-${index}`, name);
      scheme.competitionScope = "all";
      team.lineupSchemes.push(scheme);
      team.activeLineupSchemeId = scheme.id;
    } else {
      const scheme = team.lineupSchemes.find((entry) => entry.id === body.lineupSchemeId);
      if (!scheme) throw new Error("阵容方案不存在");
      if (action === "delete") {
        if (team.lineupSchemes.length <= 1) throw new Error("至少需要保留一套有效阵容方案");
        team.lineupSchemes = team.lineupSchemes.filter((entry) => entry.id !== scheme.id);
        if (team.activeLineupSchemeId === scheme.id) {
          const fallback = team.lineupSchemes[0];
          team.activeLineupSchemeId = fallback.id;
          applyLineupScheme(team, fallback);
        }
        rebuildLineupSchemeAssignments(team, team.activeLineupSchemeId);
      } else if (action === "rename") {
        const name = String(body.name ?? "").trim();
        if (!name) throw new Error("方案名称不能为空");
        if (name.length > 20) throw new Error("方案名称最多20个字符");
        scheme.name = name;
      } else if (action === "assign") {
        const competition = String(body.competition ?? "");
        if (competition !== "all" && !LINEUP_SCHEME_COMPETITIONS.includes(competition)) throw new Error("不支持的赛事类型");
        scheme.competitionScope = competition;
        rebuildLineupSchemeAssignments(team, scheme.id);
      } else if (action === "select") {
        team.activeLineupSchemeId = scheme.id;
        applyLineupScheme(team, scheme);
      } else throw new Error("不支持的阵容方案操作");
    }
    this.save();
    if (options.compact) return this.teamSaveMutationView(team);
    return this.view(account);
  }

  exportLineupScheme(account) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    syncActiveLineupScheme(team);
    const scheme = team.lineupSchemes?.find((entry) => entry.id === team.activeLineupSchemeId);
    if (!scheme) throw new Error("当前阵容方案不存在");
    const now = this.now();
    this.state.lineupShares ??= {};
    Object.entries(this.state.lineupShares).forEach(([code, entry]) => {
      if (Number(entry?.expiresAt ?? 0) <= now) delete this.state.lineupShares[code];
    });
    const seed = Math.floor(this.rng() * 1_000_000_000);
    let code = "";
    for (let offset = 0; offset < 1_000_000_000; offset += 1) {
      code = String((seed + offset) % 1_000_000_000).padStart(9, "0");
      if (!this.state.lineupShares[code]) break;
    }
    const expiresAt = now + LINEUP_SHARE_TTL_MS;
    this.state.lineupShares[code] = {
      code,
      ownerId:account.id,
      teamId:team.id,
      createdAt:now,
      expiresAt,
      scheme:clone(scheme),
    };
    // Sharing only changes the small lineup-share map. Avoid creating a daily backup
    // and a second full-state .bak copy on this latency-sensitive action.
    this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    return { code, createdAt:now, expiresAt };
  }

  importLineupScheme(account, codeValue, options = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    const code = String(codeValue ?? "").trim();
    if (!/^\d{9}$/.test(code)) throw new Error("请输入有效的9位阵容码");
    const shared = this.state.lineupShares?.[code];
    if (!shared) throw new Error("阵容码不存在或已失效");
    if (Number(shared.expiresAt ?? 0) <= this.now()) {
      delete this.state.lineupShares[code];
      this.save();
      throw new Error("阵容码已过期，请让分享者重新导出");
    }
    const importedStarterIds = [...new Set(shared.scheme?.preferredStarterIds ?? [])];
    if (importedStarterIds.length !== 11) throw new Error("阵容码中的首发阵容无效");
    const current = team.lineupSchemes?.find((entry) => entry.id === team.activeLineupSchemeId);
    if (!current) throw new Error("当前阵容方案不存在");
    const rosterIds = new Set(team.rosterIds ?? []);
    const availableCurrentIds = (current.preferredStarterIds ?? []).filter((playerId) => rosterIds.has(playerId));
    const playerIdMap = new Map(importedStarterIds.map((sourceId, index) => [sourceId, availableCurrentIds[index] ?? null]));
    if ([...playerIdMap.values()].some((playerId) => !playerId)) throw new Error("当前方案没有完整的11人首发，无法承载导入阵容");
    const remapPositions = (positions = {}) => Object.fromEntries(importedStarterIds.map((sourceId) => [playerIdMap.get(sourceId), clone(positions[sourceId] ?? { x:50, y:50 })]));
    const remapDuties = (duties = {}) => Object.fromEntries(Object.entries(duties)
      .filter(([sourceId]) => playerIdMap.has(sourceId))
      .map(([sourceId, duty]) => [playerIdMap.get(sourceId), duty]));
    const mappedScheme = clone(shared.scheme);
    mappedScheme.preferredStarterIds = importedStarterIds.map((sourceId) => playerIdMap.get(sourceId));
    mappedScheme.captainId = playerIdMap.get(shared.scheme?.captainId) ?? null;
    mappedScheme.captainStyle = normalizeCaptainStyle(shared.scheme?.captainStyle);
    mappedScheme.positions = remapPositions(shared.scheme.positions);
    mappedScheme.positionPresets = Object.fromEntries(POSITION_PRESET_KEYS.map((preset) => [preset, remapPositions(shared.scheme.positionPresets?.[preset] ?? shared.scheme.positions)]));
    mappedScheme.tacticalPlans = Object.fromEntries(Object.entries(shared.scheme.tacticalPlans ?? {}).map(([state, plan]) => [state, {
      ...clone(plan),
      ...(plan?.playerDuties ? { playerDuties:remapDuties(plan.playerDuties) } : {}),
    }]));
    const imported = lineupSchemeSnapshot({
      ...team,
      ...mappedScheme,
      competitionScope:current.competitionScope,
    }, current.id, current.name);
    repairLineupSchemeAgainstRoster(team, imported);
    Object.assign(current, imported);
    applyLineupScheme(team, current);
    rebuildLineupSchemeAssignments(team, current.id);
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
    const club = this.ensureClubManagement(team);
    const teamContract = this.activeClubSponsorContract(club, "team");
    const activeSponsor = CLUB_SPONSORS.find((entry) => entry.id === teamContract?.sponsorId);
    const storedName = teamContract && activeSponsor ? `${name}-${activeSponsor.name}` : name;
    const normalizedName = storedName.toLocaleLowerCase("zh-CN");
    if (this.state.teams.some((entry) => entry.id !== team.id && entry.name.toLocaleLowerCase("zh-CN") === normalizedName)
      || Object.values(this.state.drafts).some((draft) => draft.teamName.toLocaleLowerCase("zh-CN") === normalizedName)) throw new Error("该球队名称已经被使用");
    club.baseTeamName = name;
    this.setStoredTeamName(team, storedName);
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
    if (this.rosterSlotsUsed(account.id) >= this.rosterLimit(account.id)) throw new Error(`${this.rosterLimit(account.id)}人名单已满，请先出售或解约一名球员`);
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
    if (this.rosterSlotsUsed(account.id) >= this.rosterLimit(account.id)) throw new Error(`${this.rosterLimit(account.id)}人名单已满，请先腾出一个位置`);
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
    if (options.compact) return this.compactMutationView(account, { extra:{ listing:this.listingView(this.state.listings.at(-1)) } });
    return this.view(account);
  }

  listCosmetic(account, itemIdValue, priceValue, options = {}) {
    const team = this.accountTeam(account.id);
    const item = COSMETIC_BADGE_BY_ID[String(itemIdValue ?? "")];
    const price = Math.floor(Number(priceValue));
    const inventory = this.cosmeticInventory(account.id);
    const availableCount = Number(inventory[item?.id] ?? 0);
    if (!team || !item || availableCount < 1) throw new Error("这枚徽章不在你的可交易道具中");
    if (!Number.isFinite(price) || price < COSMETIC_BADGE_MINIMUM_LISTING_PRICE) throw new Error(`道具挂牌价不能低于${COSMETIC_BADGE_MINIMUM_LISTING_PRICE}金币`);
    const equipped = this.equippedCosmeticIds(account.id);
    const wasEquipped = equipped[item.slot] === item.id;
    const remainingCount = availableCount - 1;
    if (remainingCount > 0) inventory[item.id] = remainingCount;
    else delete inventory[item.id];
    if (wasEquipped && remainingCount < 1) delete equipped[item.slot];
    this.state.listings.push({
      id:makeId("cosmetic-listing", `${item.id}-${this.state.listings.length}`),
      kind:"cosmetic",
      cosmeticItemId:item.id,
      cosmeticSlot:item.slot,
      wasEquipped,
      sellerId:account.id,
      sellerTeamId:team.id,
      price,
      status:"active",
      createdAt:this.now(),
    });
    this.save();
    const teamBadgeDelta = this.equippedTeamBadge(account.id);
    const clubBadgeDelta = this.equippedClubBadge(account.id);
    if (options.compact) return this.compactMutationView(account, { cosmetics:true, extra:{ listing:this.listingView(this.state.listings.at(-1)), teamBadgeDelta, clubBadgeDelta } });
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
    if (options.compact) return this.compactMutationView(account, { extra:{ listing:this.listingView(this.state.listings.at(-1)) } });
    return this.view(account);
  }

  cancelListing(account, listingId, options = {}) {
    const listing = this.state.listings.find((item) => item.id === listingId && item.status === "active");
    if (!listing || listing.sellerId !== account.id) throw new Error("找不到你的这笔挂牌");
    if (listing.kind === "cosmetic") {
      const item = COSMETIC_BADGE_BY_ID[listing.cosmeticItemId];
      if (!item) throw new Error("挂牌徽章已经失效");
      const inventory = this.cosmeticInventory(account.id);
      inventory[item.id] = Number(inventory[item.id] ?? 0) + 1;
      const equipped = this.equippedCosmeticIds(account.id);
      if (listing.wasEquipped && !equipped[item.slot]) equipped[item.slot] = item.id;
    }
    listing.status = "cancelled";
    listing.closedAt = this.now();
    this.save();
    if (options.compact) {
      const cosmetic = listing.kind === "cosmetic";
      return this.compactMutationView(account, { cosmetics:cosmetic, extra:{ cancelledListingId:listing.id, ...(cosmetic ? { teamBadgeDelta:this.equippedTeamBadge(account.id), clubBadgeDelta:this.equippedClubBadge(account.id) } : {}) } });
    }
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
      if (entry.accountId === accountId && ["s4-card-enhancement", "s4-card-enhancement-batch"].includes(entry.type)) entries.push(entry);
    }
    return entries.map((entry) => {
        const mainPlayer = entry.mainPlayer ?? playerSummary(REAL_PLAYER_BY_ID[entry.playerId]);
        const materialPlayerId = entry.materialPlayerId ?? this.state.s4Assets.cards[entry.materialCardId]?.playerId ?? entry.playerId;
        const materialPlayer = entry.materialPlayer ?? playerSummary(REAL_PLAYER_BY_ID[materialPlayerId]);
        const isBatch = entry.type === "s4-card-enhancement-batch";
        const batchOutcomes = isBatch ? (entry.outcomes ?? []) : [];
        const batchAfterLevel = isBatch ? Math.max(...batchOutcomes.map((outcome) => Number(outcome.afterLevel ?? entry.mainLevel ?? 0)), Number(entry.mainLevel ?? 0)) : null;
        return {
          id:entry.id,
          createdAt:entry.createdAt,
          mainPlayer,
          mainCard:{ id:entry.mainCardId ?? `${entry.id}:main`, playerId:mainPlayer.id, upgradeLevel:Number(entry.beforeLevel ?? entry.mainLevel ?? 0), effectiveOverall:s4EffectiveOverall(mainPlayer, Number(entry.beforeLevel ?? entry.mainLevel ?? 0)), traits:[] },
          materialPlayer,
          materialCard:{ id:entry.materialCardId, playerId:materialPlayer.id, upgradeLevel:Number(entry.materialLevel ?? 0), effectiveOverall:s4EffectiveOverall(materialPlayer, Number(entry.materialLevel ?? 0)), traits:[] },
          resultPlayer:mainPlayer,
          resultCard:{ id:entry.mainCardId ?? `${entry.id}:result`, playerId:mainPlayer.id, upgradeLevel:Number(entry.afterLevel ?? batchAfterLevel ?? entry.beforeLevel ?? entry.mainLevel ?? 0), effectiveOverall:s4EffectiveOverall(mainPlayer, Number(entry.afterLevel ?? batchAfterLevel ?? entry.beforeLevel ?? entry.mainLevel ?? 0)), traits:[] },
          protectionUsed:Boolean(entry.protectionUsed),
          protectionCost:Number(entry.protectionCost ?? -Math.min(0, Number(entry.amount ?? 0))),
          chance:Number(entry.chance ?? 0),
          success:isBatch ? Number(entry.successCount ?? 0) > 0 : Boolean(entry.success),
          beforeLevel:Number(entry.beforeLevel ?? entry.mainLevel ?? 0),
          afterLevel:Number(entry.afterLevel ?? batchAfterLevel ?? entry.beforeLevel ?? entry.mainLevel ?? 0),
          batchQuantity:isBatch ? Number(entry.quantity ?? batchOutcomes.length) : 0,
          batchSuccessCount:isBatch ? Number(entry.successCount ?? 0) : 0,
          batchFailureCount:isBatch ? Number(entry.failureCount ?? 0) : 0,
        };
      });
  }

  enhanceS4Card(account, mainCardIdValue, materialCardIdValue, useProtection = false, options = {}) {
    this.pruneInvalidS4EnhancementTraitOffers();
    const team = this.accountTeam(account.id);
    const mainCard = this.state.s4Assets.cards[String(mainCardIdValue ?? "")];
    const materialCard = this.state.s4Assets.cards[String(materialCardIdValue ?? "")];
    if (!team) throw new Error("你还没有加入联赛");
    const requestId = String(options.requestId ?? "").trim();
    if (requestId && !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) throw new Error("合卡请求标识无效");
    let repeated = null;
    for (let index = this.state.ledger.length - 1; requestId && index >= 0; index -= 1) {
      const entry = this.state.ledger[index];
      if (entry.type === "s4-card-enhancement" && entry.accountId === account.id && entry.requestId === requestId) {
        repeated = entry;
        break;
      }
    }
    if (repeated) {
      if (repeated.mainCardId !== String(mainCardIdValue ?? "")
        || repeated.materialCardId !== String(materialCardIdValue ?? "")
        || Boolean(repeated.requestedProtection) !== Boolean(useProtection)) {
        throw new Error("合卡请求标识与原请求不一致");
      }
      const enhancementResult = clone(repeated.enhancementResultSnapshot);
      if (options.compact) return clone({
        updatedAt:this.state.updatedAt,
        serverTime:this.now(),
        wallet:this.wallet(account.id),
        ...(options.skipHistory === true ? {} : { enhancementHistory:this.enhancementHistory(account.id) }),
        removedCardId:repeated.materialCardId,
        removedPlayerId:repeated.removedPlayerId ?? null,
        enhancementResult,
      });
      return { ...this.view(account), enhancementResult };
    }
    if (this.rosterOverlimitLocked(team, mainCard?.playerId) || this.rosterOverlimitLocked(team, materialCard?.playerId)) throw new Error("超限锁定球员不能参与合卡");
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
    if (options.skipAudit !== true) this.state.ledger.push({
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
      requestId:requestId || null,
      requestedProtection:Boolean(useProtection),
      removedPlayerId:consumesMaterialFamily ? materialCard.playerId : null,
      enhancementResultSnapshot:clone(enhancementResult),
      createdAt:this.now(),
    });
    if (options.skipAudit !== true) recordS4AssetTransaction(this.state, {
      id:resultId,
      type:"card-enhancement",
      playerId:mainCard.playerId,
      cardIds:[mainCard.id, materialCard.id],
      fromOwnerId:account.id,
      amount:-protectionCost,
      metadata:{ beforeLevel:mainLevel, materialLevel, afterLevel:mainCard.upgradeLevel, chance, success, protectionUsed },
      createdAt:this.now(),
    });
    if (options.skipNotify !== true) this.notifyEnhancementSuccess(team, player, mainCard, {
      resultId,
      success,
      chance,
      beforeLevel:mainLevel,
      materialLevel,
    });
    if (options.skipSave !== true) this.save();
    if (options.compact) {
      return clone({
        updatedAt:this.state.updatedAt,
        serverTime:this.now(),
        wallet:this.wallet(account.id),
        ...(options.skipHistory === true ? {} : { enhancementHistory:this.enhancementHistory(account.id) }),
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

  batchEnhanceS4Cards(account, playerIdValue, mainLevelValue, materialLevelValue, quantityValue, options = {}) {
    const playerId = String(playerIdValue ?? "");
    const mainLevel = Math.floor(Number(mainLevelValue));
    const materialLevel = Math.floor(Number(materialLevelValue));
    const requestedQuantity = Math.floor(Number(quantityValue));
    const player = REAL_PLAYER_BY_ID[playerId];
    if (!player || isXPlayer(player)) throw new Error("批量合卡只支持普通球员");
    if (!Number.isInteger(mainLevel) || mainLevel < 0 || mainLevel >= S4_ENHANCEMENT_MAX_LEVEL) throw new Error("主卡等级必须为0至7");
    if (mainLevel >= 3) throw new Error("批量合卡不支持预期达到+4及以上的结果，请逐张合成并绑定特性");
    if (!Number.isInteger(materialLevel) || materialLevel < 0 || materialLevel > S4_ENHANCEMENT_MAX_LEVEL) throw new Error("副卡等级必须为0至8");
    if (materialLevel > mainLevel) throw new Error("主卡等级不能低于副卡等级");
    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) throw new Error("批量次数必须至少为1");
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("你还没有加入联赛");
    if (this.rosterOverlimitLocked(team, playerId)) throw new Error("超限锁定球员不能参与合卡");
    const activeCards = this.playerCards(account.id, playerId).filter((card) => card.status === "active");
    const pendingTraitCardIds = new Set(Object.values(this.state.s4Assets.traitOffers ?? {}).filter((offer) => offer.ownerId === account.id && offer.status === "pending").map((offer) => offer.cardId));
    const mainCount = activeCards.filter((card) => Number(card.upgradeLevel ?? 0) === mainLevel && !pendingTraitCardIds.has(card.id)).length;
    const materialCount = activeCards.filter((card) => Number(card.upgradeLevel ?? 0) === materialLevel && !card.ownershipAnchorRequired).length;
    const maximumQuantity = mainLevel === materialLevel ? Math.floor(Math.min(mainCount, materialCount) / 2) : Math.min(mainCount, materialCount);
    if (!maximumQuantity) throw new Error("没有足够的指定等级卡片可供批量合卡");
    const quantity = Math.min(requestedQuantity, maximumQuantity);
    const chance = s4EnhancementChance(mainLevel, materialLevel);
    let successCount = 0;
    let failureCount = 0;
    const outcomes = [];
    for (let index = 0; index < quantity; index += 1) {
      const currentCards = this.playerCards(account.id, playerId).filter((card) => card.status === "active");
      const currentPendingTraitCardIds = new Set(Object.values(this.state.s4Assets.traitOffers ?? {}).filter((offer) => offer.ownerId === account.id && offer.status === "pending").map((offer) => offer.cardId));
      const mainCard = currentCards.find((card) => Number(card.upgradeLevel ?? 0) === mainLevel && !currentPendingTraitCardIds.has(card.id));
      const materialCard = currentCards.find((card) => Number(card.upgradeLevel ?? 0) === materialLevel && !card.ownershipAnchorRequired && card.id !== mainCard?.id);
      if (!mainCard || !materialCard) break;
      const result = this.enhanceS4Card(account, mainCard.id, materialCard.id, false, { compact:true, skipSave:true, skipNotify:true, skipAudit:true, skipHistory:true });
      outcomes.push({ mainCardId:mainCard.id, materialCardId:materialCard.id, beforeLevel:mainLevel, materialLevel, afterLevel:result.enhancementResult.afterLevel, success:result.enhancementResult.success, resultId:result.enhancementResult.id });
      if (result.enhancementResult.success) successCount += 1;
      else failureCount += 1;
    }
    const remainingCards = this.playerCards(account.id, playerId).filter((card) => card.status === "active");
    const finalLevelCounts = {};
    remainingCards.forEach((card) => {
      const level = Number(card.upgradeLevel ?? 0);
      finalLevelCounts[level] = (finalLevelCounts[level] ?? 0) + 1;
    });
    const batchId = makeId("enhancement-batch", `${account.id}-${playerId}`);
    this.state.ledger.push({
      id:makeId("ledger", batchId),
      accountId:account.id,
      amount:0,
      type:"s4-card-enhancement-batch",
      playerId,
      mainLevel,
      materialLevel,
      chance,
      quantity:successCount + failureCount,
      successCount,
      failureCount,
      outcomes,
      createdAt:this.now(),
    });
    recordS4AssetTransaction(this.state, {
      id:batchId,
      type:"card-enhancement-batch",
      playerId,
      cardIds:outcomes.flatMap((entry) => [entry.mainCardId, entry.materialCardId]),
      fromOwnerId:account.id,
      metadata:{ mainLevel, materialLevel, chance, quantity:successCount + failureCount, successCount, failureCount, outcomes },
      createdAt:this.now(),
    });
    this.notifyEnhancementBatch(team, player, { batchId, mainLevel, materialLevel, chance, quantity:successCount + failureCount, successCount, failureCount, outcomes });
    this.save({ scopes:["core", "assets", "ledger", "inbox"], skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    const pendingTraitOffers = Object.values(this.state.s4Assets.traitOffers ?? {})
      .filter((offer) => offer.ownerId === account.id && offer.status === "pending" && offer.playerId === playerId)
      .map((offer) => ({ id:offer.id, cardId:offer.cardId, playerId:offer.playerId, upgradeLevel:offer.upgradeLevel, unlockLevel:offer.unlockLevel, traits:offer.traitIds.map((id) => ({ id, name:YDL_TRAIT_BY_ID[id]?.name ?? id, summary:YDL_TRAIT_BY_ID[id]?.summary ?? "特性效果由联赛后台配置。", eligibleRoleGroups:[...(YDL_TRAIT_BY_ID[id]?.eligibleRoleGroups ?? ["ANY"])] })) }));
    const result = {
      playerId,
      player:playerSummary(player),
      mainLevel,
      materialLevel,
      requestedQuantity,
      maximumQuantity,
      quantity:successCount + failureCount,
      chance,
      expectedSuccesses:Number(((successCount + failureCount) * chance / 100).toFixed(2)),
      successCount,
      failureCount,
      finalCardCount:remainingCards.length,
      finalLevelCounts,
      cards:remainingCards.map((card) => publicLeagueS4Card(this.state, card)),
      pendingTraitOffers,
      wallet:this.wallet(account.id),
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
    };
    return options.compact ? clone(result) : { ...this.view(account), batchEnhancementResult:result };
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

  releaseCard(account, cardIdValue, confirmOwnershipReturn = false, options = {}) {
    const team = this.accountTeam(account.id);
    const card = this.state.s4Assets.cards[String(cardIdValue ?? "")];
    const player = REAL_PLAYER_BY_ID[card?.playerId];
    if (!team || !card || card.status !== "active" || card.ownerId !== account.id || !player) throw new Error("不能解约该球员卡");
    if (isXPlayer(player)) throw new Error("X级球员不可回收或解约");
    if (Number(card.upgradeLevel ?? 0) > S4_SINGLE_CARD_RECOVERY_MAX_UPGRADE_LEVEL) throw new Error(`+${S4_SINGLE_CARD_RECOVERY_MAX_UPGRADE_LEVEL + 1}及以上强化卡无法解约`);
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
    if (options.compact) {
      return this.s4RecoveryMutationView(account, {
        affectedPlayerIds:[card.playerId],
        removedCardIds:[card.id],
        removedPlayerIds:familyCards.length === 1 ? [card.playerId] : [],
        returnedOwnershipPlayerIds:returnsOwnership ? [card.playerId] : [],
        extra:{ cardRecoveryResult:{ cardCount:1, amount } },
      });
    }
    return this.view(account);
  }

  releaseCards(account, cardIdsValue, options = {}) {
    const team = this.accountTeam(account.id);
    const cardIds = [...new Set((Array.isArray(cardIdsValue) ? cardIdsValue : []).map((id) => String(id ?? "")).filter(Boolean))];
    if (!team || !cardIds.length) throw new Error("请至少选择一张需要回收的球员卡");
    const cards = cardIds.map((id) => this.state.s4Assets.cards[id]);
    if (cards.some((card) => !card || card.status !== "active" || card.ownerId !== account.id || !REAL_PLAYER_BY_ID[card.playerId])) throw new Error("选择中包含无效球员卡");
    if (cards.some((card) => isXPlayer(card.playerId))) throw new Error("X级球员不可回收或解约");
    if (cards.some((card) => Number(card.upgradeLevel ?? 0) > S4_SINGLE_CARD_RECOVERY_MAX_UPGRADE_LEVEL)) throw new Error(`+${S4_SINGLE_CARD_RECOVERY_MAX_UPGRADE_LEVEL + 1}及以上强化卡无法回收`);
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
    const cardRecoveryResult = { cardCount:cards.length, amount };
    if (options.compact) {
      return this.s4RecoveryMutationView(account, {
        affectedPlayerIds:[...selectedByPlayer.keys()],
        removedCardIds:cards.map((card) => card.id),
        removedPlayerIds:removedFamilies,
        extra:{ cardRecoveryResult },
      });
    }
    return { ...this.view(account), cardRecoveryResult };
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
    const ownerIds = [offer.fromOwnerId, offer.toOwnerId];
    const projectedCards = ownerIds
      .flatMap((ownerId) => this.playerCards(ownerId))
      .map((card) => ({ ...card, traitIds:[...(card.traitIds ?? [])] }));
    const projectedCardById = Object.fromEntries(projectedCards.map((card) => [card.id, card]));
    const offeredCardIds = new Set(offer.offeredCardIds);
    const requestedCardIds = new Set(offer.requestedCardIds);
    projectedCards.forEach((card) => {
      if (offeredCardIds.has(card.id)) card.ownerId = offer.toOwnerId;
      else if (requestedCardIds.has(card.id)) card.ownerId = offer.fromOwnerId;
    });
    const projectedPlayerIds = new Set(projectedCards.map((card) => card.playerId));
    const projectedOwnerships = Object.fromEntries([...projectedPlayerIds]
      .map((playerId) => [playerId, ownershipOwner(this.state, playerId)])
      .filter(([, ownerId]) => ownerId));
    const projectedState = {
      s4Assets:{ cards:projectedCardById, ownerships:projectedOwnerships },
    };
    ownerIds.forEach((ownerId) => {
      const projectedSlots = rosterSlotUsage(projectedState, ownerId);
      const rosterLimit = this.rosterLimit(ownerId);
      if (projectedSlots > rosterLimit) {
        const team = this.accountTeam(ownerId);
        throw new Error(`球队超过${rosterLimit}人大名单额度：${team?.id ?? ownerId}（实际占用${projectedSlots}）`);
      }
    });
  }

  cardTradeMutationView(account, extra = {}) {
    const team = this.accountTeam(account.id);
    return this.compactMutationView(account, {
      ownTeam:true,
      extra:{
        cardTradeOffers:this.state.cardTradeOffers
          .filter((offer) => offer.fromOwnerId === account.id || offer.toOwnerId === account.id)
          .map((offer) => this.cardTradeOfferView(offer))
          .sort((left, right) => right.createdAt - left.createdAt),
        tradeLockedCardIds:[...new Set(this.state.cardTradeOffers
          .filter((offer) => offer.status === "pending")
          .flatMap((offer) => offer.offeredCardIds))],
        inbox:team ? this.inbox(team) : [],
        ...extra,
      },
    });
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

  createCardTradeOffer(account, targetOwnerIdValue, offeredCardIdsValue, requestedCardIdsValue, coinAmountValue = 0, options = {}) {
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
    if (options.compact) return this.cardTradeMutationView(account, { cardTradeResult:{ tradeOfferId:offer.id, status:offer.status } });
    return this.view(account);
  }

  resolveCardTradeOffer(account, offerIdValue, actionValue, options = {}) {
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
        if (options.compact) return this.cardTradeMutationView(account, { cardTradeResult:{ tradeOfferId:offer.id, status:"failed", reason:error.message, refundedCoins:offer.coinAmount } });
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
      [fromTeam, toTeam].forEach((team) => this.synchronizeRosterAfterCardTrade(team));
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
    if (options.compact) return this.cardTradeMutationView(account, { cardTradeResult:{ tradeOfferId:offer.id, status:offer.status, refundedCoins:action === "reject" ? offer.coinAmount : 0 } });
    return { ...this.view(account), cardTradeResult:{ tradeOfferId:offer.id, status:offer.status, refundedCoins:action === "reject" ? offer.coinAmount : 0 } };
  }

  withdrawCardTradeOffer(account, offerIdValue, options = {}) {
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
    if (options.compact) return this.cardTradeMutationView(account, { cardTradeResult:{ tradeOfferId:offer.id, status:offer.status, refundedCoins:offer.coinAmount } });
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

  releasePlayer(account, playerId, options = {}) {
    const card = this.representativeCard(account.id, playerId);
    if (!card) throw new Error("不能解约该球员");
    return this.releaseCard(account, card.id, true, options);
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

  returnOwnerships(account, playerIdsValue, options = {}) {
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
    this.reconcileRosterOverlimitState(team);
    this.save();
    const ownershipRecoveryResult = {
      playerCount:plans.length,
      recoveredCardCount:plans.reduce((sum, plan) => sum + plan.recovered.length, 0),
      amount:plans.reduce((sum, plan) => sum + plan.amount, 0),
    };
    if (options.compact) {
      return this.s4RecoveryMutationView(account, {
        affectedPlayerIds:plans.map((plan) => plan.playerId),
        removedCardIds:plans.flatMap((plan) => plan.recovered.map((card) => card.id)),
        removedPlayerIds:plans.filter((plan) => !plan.retained.length).map((plan) => plan.playerId),
        returnedOwnershipPlayerIds:plans.map((plan) => plan.playerId),
        extra:{ ownershipRecoveryResult },
      });
    }
    return { ...this.view(account), ownershipRecoveryResult };
  }

  returnOwnership(account, playerId, options = {}) {
    return this.returnOwnerships(account, [playerId], options);
  }
  buyCosmeticListing(account, listing, options = {}) {
    const buyer = this.accountTeam(account.id);
    const seller = this.state.teams.find((team) => team.id === listing?.sellerTeamId && team.ownerId === listing?.sellerId);
    const item = COSMETIC_BADGE_BY_ID[listing?.cosmeticItemId];
    if (!buyer || !seller || !listing || listing.status !== "active" || listing.kind !== "cosmetic" || listing.sellerId === account.id || !item) throw new Error("当前无法购买这件道具");
    if (this.wallet(account.id).balance < listing.price) throw new Error("金币不足");
    const buyerInventory = this.cosmeticInventory(account.id);
    buyerInventory[item.id] = Number(buyerInventory[item.id] ?? 0) + 1;
    const buyerEquipped = this.equippedCosmeticIds(account.id);
    if (!buyerEquipped[item.slot]) buyerEquipped[item.slot] = item.id;
    this.wallet(account.id).balance -= listing.price;
    const saleIncome = Math.floor(listing.price * (1 - S4_ECONOMY.marketFeeRate));
    this.wallet(listing.sellerId).balance += saleIncome;
    listing.status = "sold";
    listing.buyerId = account.id;
    listing.closedAt = this.now();
    this.state.ledger.push(
      { id:makeId("ledger", listing.id), accountId:account.id, amount:-listing.price, type:"cosmetic-buy", cosmeticItemId:item.id, counterpartyId:listing.sellerId, listingId:listing.id, createdAt:this.now() },
      { id:makeId("ledger", `${listing.id}-seller`), accountId:listing.sellerId, amount:saleIncome, type:"cosmetic-sale", cosmeticItemId:item.id, counterpartyId:account.id, listingId:listing.id, createdAt:this.now() },
    );
    const fee = listing.price - saleIncome;
    this.pushInbox(buyer, { id:`cosmetic-buy:${listing.id}`, type:"transfer", title:`${item.name} 购买成功`, summary:`支付${listing.price}金币，道具已经进入背包。`, body:`交易对方：${seller.name}。你当前持有${buyerInventory[item.id]}枚${item.name}。`, payload:{ listingId:listing.id, listingKind:"cosmetic", cosmeticItemId:item.id, price:listing.price, counterpartyId:listing.sellerId, counterpartyName:seller.name, perspective:"buyer" } });
    this.pushInbox(seller, { id:`cosmetic-sale:${listing.id}`, type:"transfer", title:`${item.name} 出售成功`, summary:`成交价${listing.price}金币，扣除${fee}金币手续费，实际到账${saleIncome}金币。`, body:`买方：${buyer.name}。本次徽章道具交易已经完成。`, payload:{ listingId:listing.id, listingKind:"cosmetic", cosmeticItemId:item.id, price:listing.price, fee, saleIncome, counterpartyId:account.id, counterpartyName:buyer.name, perspective:"seller" } });
    this.save();
    if (options.compact) return this.compactMutationView(account, { cosmetics:true, extra:{ marketPurchase:{ listingId:listing.id, listingKind:"cosmetic", cosmeticItemId:item.id, sellerId:listing.sellerId, price:listing.price, item:{ ...item, count:buyerInventory[item.id], equipped:buyerEquipped[item.slot] === item.id, minimumListingPrice:COSMETIC_BADGE_MINIMUM_LISTING_PRICE } }, teamBadgeDelta:this.equippedTeamBadge(account.id), clubBadgeDelta:this.equippedClubBadge(account.id) } });
    return this.view(account);
  }

  buyListing(account, listingId, options = {}) {
    const buyer = this.accountTeam(account.id);
    const listing = this.state.listings.find((item) => item.id === listingId && item.status === "active");
    if (listing?.kind === "cosmetic") return this.buyCosmeticListing(account, listing, options);
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
      if (!buyerAlreadyUsesSlot && this.rosterSlotsUsed(account.id) >= this.rosterLimit(account.id)) throw new Error(`${this.rosterLimit(account.id)}人名单已满，无法接收该球员所有权`);
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
      if (!buyerAlreadyUsesSlot && willUseSlot && this.rosterSlotsUsed(account.id) >= this.rosterLimit(account.id)) throw new Error(`${this.rosterLimit(account.id)}人名单已满，无法接收这张球员卡`);
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
    if (options.compact) {
      const publicTransferredCard = transferredCard ? publicLeagueS4Card(this.state, transferredCard) : null;
      return this.compactMutationView(account, { extra:{
        marketPurchase:{ listingId:listing.id, ownershipTransferred, transferredCardId:transferredCard?.id ?? null, sellerId:listing.sellerId, price:listing.price, player:playerSummary(player), card:publicTransferredCard },
        s4CardDeltas:publicTransferredCard ? [{ playerId:listing.playerId, card:publicTransferredCard, ownershipGranted:ownershipTransferred }] : [],
        s4PlayerDeltas:[this.s4PlayerAssetDelta(account.id, listing.playerId)],
        s4RosterSlotsUsed:this.rosterSlotsUsed(account.id),
      } });
    }
    return this.view(account);
  }

  selectActualLineup(team, roundNumber, competition = "league", options = {}) {
    const humanOwned = this.ownedPlayerIds();
    const bannedPlayerIds = new Set((options.bannedPlayerIds ?? []).map(String));
    if (!team.ownerId) {
      const teamIndex = this.state.teams.indexOf(team);
      const preferred = aiLineup(teamIndex, roundNumber, humanOwned);
      const reserves = aiSubstitutes(teamIndex, roundNumber, humanOwned, preferred);
      const available = [...preferred, ...reserves].filter((player) => !bannedPlayerIds.has(String(player.id)));
      return { lineup:available.slice(0, 11), substitutes:available.slice(11), rotations:[] };
    }
    const desired = team.preferredStarterIds.filter((id) => team.rosterIds.includes(id) && !this.rosterOverlimitLocked(team, id));
    const threshold = Number(team.fitnessThreshold ?? DEFAULT_FITNESS_THRESHOLD);
    const effectiveFitness = (id) => {
      const fixedFitness = fixedFitnessFromTraitIds(this.representativeCard(team.ownerId, id)?.traitIds);
      if (fixedFitness != null) return fixedFitness;
      return competition === "friendly" ? 100 : Number(team.playerState[id]?.fitness ?? 100);
    };
    const hardAvailable = (id) => {
      const state = team.playerState[id] ?? {};
      if (competition === "friendly") return Number(state.injuryRounds ?? 0) <= 0;
      const suspension = competition === "season-final"
        ? Number(state.seasonFinalSuspension ?? 0)
        : competition === "cup" ? Number(state.cupSuspension ?? 0) : Number(state.suspension ?? 0);
      return !bannedPlayerIds.has(String(id)) && suspension <= 0 && Number(state.injuryRounds ?? 0) <= 0 && effectiveFitness(id) >= 45;
    };
    const assignedRoles = inferElevenBoardRoles(desired.map((id) => ({ id, position:team.positions[id] })));
    const selected = [];
    const rotations = [];
    const bench = team.rosterIds.filter((id) => !desired.includes(id) && !this.rosterOverlimitLocked(team, id) && hardAvailable(id));
    const effectiveOverall = (player) => s4EffectiveOverall(
      player,
      this.representativeCard(team.ownerId, player.id)?.upgradeLevel ?? 0,
    );
    const takeReplacement = (starterId, requireFresh) => {
      const assignedRole = assignedRoles[starterId] ?? REAL_PLAYER_BY_ID[starterId]?.role;
      const candidates = bench
        .filter((id) => !requireFresh || effectiveFitness(id) > threshold)
        .map((id) => {
          const player = REAL_PLAYER_BY_ID[id];
          const card = this.representativeCard(team.ownerId, id);
          return player ? { ...player, traits:[...(card?.traitIds ?? [])] } : null;
        })
        .filter((player) => player && (!requireFresh || automaticSubstitutionRank(assignedRole, player) > 0))
        .sort((left, right) => compareAutomaticSubstitutes(
          assignedRole,
          left,
          right,
          (player) => effectiveFitness(player.id),
          effectiveOverall,
        ))[0];
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
        const suspension = competition === "season-final"
          ? Number(state.seasonFinalSuspension ?? 0)
          : competition === "cup" ? Number(state.cupSuspension ?? 0) : Number(state.suspension ?? 0);
        rotations.push({ outId:starterId, outName:REAL_PLAYER_BY_ID[starterId]?.name, inId:substitute, inName:REAL_PLAYER_BY_ID[substitute]?.name, reason:forcedOut ? (bannedPlayerIds.has(String(starterId)) ? "赛季总决赛禁用" : suspension > 0 ? "停赛" : Number(state.injuryRounds ?? 0) > 0 ? "伤缺" : "体能不足45") : `体能${Math.round(fitness)}达到红线${threshold}` });
      } else if (!forcedOut) selected.push(starterId);
    }
    while (selected.length < 11 && bench.length) selected.push(bench.shift());
    const starterIds = selected.slice(0, 11);
    const playerForMatch = (id) => ({ ...REAL_PLAYER_BY_ID[id], state:{ ...REAL_PLAYER_BY_ID[id].state, fitness:effectiveFitness(id) } });
    return {
      lineup:starterIds.map(playerForMatch),
      substitutes:bench.filter((id) => !starterIds.includes(id)).map(playerForMatch),
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

  fixtureConditions(fixture, roundNumber, options = {}) {
    return seededConditions(this.fixtureSeed(fixture, roundNumber), options);
  }

  createFixtureMatch(fixture, roundNumber, startedAt = this.now(), options = {}) {
    const home = this.state.teams.find((team) => team.id === fixture.homeId);
    const away = this.state.teams.find((team) => team.id === fixture.awayId);
    const competitionMode = options.competitionMode ?? "league";
    const availabilityMode = options.availabilityMode ?? competitionMode;
    const teams = [home, away].map((team) => lineupTeamForCompetition(team, competitionMode));
    const selections = teams.map((team) => this.selectActualLineup(team, roundNumber, availabilityMode, { bannedPlayerIds:options.bannedPlayerIdsByTeam?.[team.id] ?? [] }));
    const lineups = selections.map((selection) => selection.lineup);
    const positionPresets = teams.map((team, index) => Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, this.actualPositions(team, lineups[index], key)])));
    const formationLinePresets = teams.map((team) => Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, sanitizeFormationLines(team.formationLinePresets?.[key])])));
    const positions = teams.map((team, index) => {
      const openingPreset = team.tacticalPlans?.opening?.positionPreset ?? "position1";
      return clone(positionPresets[index][openingPreset] ?? positionPresets[index].position1);
    });
    const conditions = this.fixtureConditions(fixture, roundNumber, options);
    const matchEngine = options.matchEngine ?? MATCH_ENGINE_BY_COMPETITION[competitionMode] ?? DEFAULT_MATCH_ENGINE;
    const seats = teams.map((team, index) => {
      const starters = this.chemistryAdjustedLineup(team, lineups[index], positions[index]).map((player) => ({ ...player, active:true }));
      const substitutes = matchEngine === "v2" ? (selections[index].substitutes ?? []).map((player) => {
        const card = this.representativeCard(team.ownerId, player.id);
        return { ...applyS4Enhancement(player, card?.upgradeLevel ?? 0), traits:(card?.traitIds ?? []).filter((id) => YDL_TRAIT_BY_ID[id]), active:false };
      }) : [];
      const tacticalPlans = tacticalPlansWithInheritedDuties(unwrapTracked(team.tacticalPlans), selections[index].rotations);
      return { name:team.name, players:[...starters, ...substitutes], positions:positions[index], positionPresets:positionPresets[index], formationLinePresets:formationLinePresets[index], tactic:tacticalPlans.opening?.tactic ?? team.tactic, style:tacticalPlans.opening?.style ?? team.style, tacticalPlans, bondCatalog:S4_BOND_CATALOG, attackFocus:team.attackFocus, defenseFocus:team.defenseFocus, captainId:starters.some((player) => player.id === team.captainId) ? team.captainId : null, captainStyle:normalizeCaptainStyle(team.captainStyle), preserveFitness:true };
    });
    const match = createLeagueMatch(unwrapTracked(seats), { now:startedAt, seed:options.seed ?? this.fixtureSeed(fixture, roundNumber), weather:conditions.weather.key, referee:conditions.referee.key, regulationOnly:options.regulationOnly ?? true, competitionMode, legNumber:options.legNumber ?? 1, allowSuperStorm:options.allowSuperStorm, aggregateBaseScore:options.aggregateBaseScore ?? null, recordEvents:options.recordEvents ?? this.recordMatchEvents !== false, matchEngine, parameters:matchEngine === "v2" ? STABLE_V21_PARAMETERS : undefined, engineProfile:"v2.1-stable-dynamic.2", dotReplayEnabled:false });
    match.stadium = this.clubBroadcastVenue(home);
    match.leagueAutoRotations = selections.map((selection) => selection.rotations);
    return { home, away, match, startedAt };
  }

  publicChemistryLinksForTeam(team, starterIds = team.preferredStarterIds, positions = team.positions) {
    const links = publicChemistryLinks(team, starterIds, positions);
    const starters = starterIds.map((id) => REAL_PLAYER_BY_ID[id]).filter(Boolean);
    eligibleChemistryPairs(starters, positions).forEach((pair) => {
      const carrier = pair.playerIds
        .map((id) => this.representativeCard(team.ownerId, id))
        .filter(Boolean)
        .map((card) => (card.traitIds ?? []).map((id) => YDL_TRAIT_BY_ID[id]).filter(Boolean))
        .flat()
        .find((trait) => (trait.rules ?? []).some((rule) => rule.hook === "chemistry" && rule.linkNearby));
      if (!carrier) return;
      const rule = carrier.rules.find((entry) => entry.hook === "chemistry" && entry.linkNearby);
      const existing = links.find((link) => link.playerIds.slice().sort().join("::") === pair.key);
      if (existing) {
        existing.value = Math.max(Number(existing.value ?? 0), Number(rule.value ?? 100));
        existing.bonus = Number(CHEMISTRY_MAX_BONUS.toFixed(4));
        existing.source = "trait";
        return;
      }
      links.push({ playerIds:[...pair.playerIds], appearances:0, value:Number(rule.value ?? 100), bonus:Number(CHEMISTRY_MAX_BONUS.toFixed(4)), source:"trait" });
    });
    return links.sort((left, right) => right.value - left.value);
  }

  aiTrainingTacticalPlans(value = {}) {
    return Object.fromEntries(["opening", "leading", "trailing"].map((state, index) => {
      const source = value?.[state] ?? {};
      return [state, {
        tactic:TACTICS.has(source.tactic) ? source.tactic : state === "leading" ? "defensive" : state === "trailing" ? "positive" : "balanced",
        style:STYLES.has(source.style) ? source.style : state === "leading" ? "counterAttack" : "possession",
        positionPreset:POSITION_PRESET_KEYS[index],
        ...(state === "opening" ? {} : { triggerGoalDifference:Math.max(1, Math.min(5, Math.round(Number(source.triggerGoalDifference) || 1))) }),
      }];
    }));
  }

  aiTrainingPlayers(formation, targetOverall) {
    const slots = AI_TRAINING_FORMATIONS[formation];
    if (!slots) throw new Error("请选择有效的 AI 阵型");
    const target = Math.max(62, Math.min(95, Math.round(Number(targetOverall) || 80)));
    const selected = [];
    const used = new Set();
    const choose = (role, remainingSlots, totalOverall) => {
      const desired = (target * 11 - totalOverall) / Math.max(1, remainingSlots);
      const candidates = REAL_PLAYERS
        .filter((player) => !isXPlayer(player) && player.role === role && !used.has(player.id))
        .sort((left, right) => Math.abs(left.overall - desired) - Math.abs(right.overall - desired) || left.id.localeCompare(right.id));
      if (!candidates.length) throw new Error(`球员库缺少主位置为${role}的 AI 球员`);
      const shortlist = candidates.slice(0, Math.min(5, candidates.length));
      const player = shortlist[Math.floor(this.rng() * shortlist.length)] ?? shortlist[0];
      used.add(player.id);
      return player;
    };
    let totalOverall = 0;
    slots.forEach(([role, x, y], index) => {
      const player = choose(role, slots.length - index, totalOverall);
      totalOverall += Number(player.overall ?? 0);
      selected.push({ player, position:{ x, y } });
    });
    const bench = AI_TRAINING_BENCH_ROLES.map((role) => {
      const player = REAL_PLAYERS
        .filter((entry) => !isXPlayer(entry) && entry.role === role && !used.has(entry.id))
        .sort((left, right) => Math.abs(left.overall - target) - Math.abs(right.overall - target) || left.id.localeCompare(right.id))[0];
      if (player) used.add(player.id);
      return player;
    }).filter(Boolean);
    return {
      starters:selected,
      substitutes:bench,
      averageOverall:Number((totalOverall / selected.length).toFixed(1)),
      targetOverall:target,
    };
  }

  aiTrainingPlayerSeat(team) {
    const starterIds = team.preferredStarterIds.filter((id) => team.rosterIds.includes(id) && !this.rosterOverlimitLocked(team, id)).slice(0, 11);
    if (starterIds.length !== 11 || new Set(starterIds).size !== 11) throw new Error("请先在战术板保存有效的 11 人首发阵容");
    const lineup = starterIds.map((id) => ({ ...REAL_PLAYER_BY_ID[id], state:{ fitness:100 } }));
    const positionPresets = Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, sanitizePositions(lineup, team.positionPresets?.[key] ?? team.positions)]));
    const formationLinePresets = Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, sanitizeFormationLines(team.formationLinePresets?.[key])]));
    const openingPreset = team.tacticalPlans?.opening?.positionPreset ?? "position1";
    const positions = clone(positionPresets[openingPreset] ?? positionPresets.position1);
    const starters = this.chemistryAdjustedLineup(team, lineup, positions).map((player) => ({ ...player, state:{ fitness:100 }, active:true }));
    const substitutes = team.rosterIds.filter((id) => !starterIds.includes(id) && !this.rosterOverlimitLocked(team, id)).map((id) => {
      const player = REAL_PLAYER_BY_ID[id];
      const card = this.representativeCard(team.ownerId, id);
      return { ...applyS4Enhancement(player, card?.upgradeLevel ?? 0), state:{ fitness:100 }, traits:(card?.traitIds ?? []).filter((traitId) => YDL_TRAIT_BY_ID[traitId]), active:false };
    });
    return {
      name:team.name,
      players:[...starters, ...substitutes],
      positions,
      positionPresets,
      formationLinePresets,
      tactic:team.tacticalPlans?.opening?.tactic ?? team.tactic,
      style:team.tacticalPlans?.opening?.style ?? team.style,
      tacticalPlans:unwrapTracked(team.tacticalPlans),
      bondCatalog:S4_BOND_CATALOG,
      attackFocus:team.attackFocus,
      defenseFocus:team.defenseFocus,
      preserveFitness:true,
      captainId:starters.some((player) => player.id === team.captainId) ? team.captainId : null,
      captainStyle:normalizeCaptainStyle(team.captainStyle),
    };
  }

  mirrorSchemeSnapshots(team) {
    const schemes = team.lineupSchemes?.length
      ? team.lineupSchemes
      : [lineupSchemeSnapshot(team, team.activeLineupSchemeId ?? "lineup-1", "方案 1")];
    return schemes.map((scheme) => {
      const configured = { ...team };
      applyLineupScheme(configured, scheme);
      return {
        schemeId:scheme.id,
        schemeName:scheme.name,
        revision:Math.max(0, Number(scheme.revision ?? 0)),
        snapshot:clone(this.aiTrainingPlayerSeat(configured)),
      };
    });
  }

  forcedSeedMirrorTeams() {
    const tournament = this.state.seasonFinalTournament;
    if (this.state.season.status !== "completed" || !tournament || tournament.preview || tournament.seasonId !== this.state.season.id) return [];
    return (tournament.seedSnapshot ?? [])
      .filter((entry) => !entry.isAi && Number(entry.seed) >= 1 && Number(entry.seed) <= 3)
      .sort((left, right) => Number(left.seed) - Number(right.seed))
      .map((entry) => ({ seed:Number(entry.seed), team:this.state.teams.find((team) => team.id === entry.teamId && team.ownerId) }))
      .filter((entry) => entry.team);
  }

  mirrorUploadSnapshots(upload) {
    if (Array.isArray(upload?.snapshots) && upload.snapshots.length) return upload.snapshots.filter((entry) => entry?.snapshot);
    return upload?.snapshot ? [{ schemeId:null, schemeName:null, revision:null, snapshot:upload.snapshot }] : [];
  }

  syncForcedSeedMirrorUploads() {
    const uploads = this.state.mirrorMarketplace.uploads;
    const forcedTeams = this.forcedSeedMirrorTeams();
    const forcedOwnerIds = new Set(forcedTeams.map(({ team }) => team.ownerId));
    const date = localDateKey(new Date(this.now()));
    let changed = false;

    Object.entries(uploads).forEach(([ownerId, upload]) => {
      if (!upload?.forcedBySeed || forcedOwnerIds.has(ownerId)) return;
      const manualEnabled = Boolean(upload.manualEnabled && upload.manualSnapshot);
      Object.assign(upload, {
        enabled:manualEnabled,
        snapshot:manualEnabled ? upload.manualSnapshot : null,
        snapshots:manualEnabled ? [{ schemeId:null, schemeName:null, revision:null, snapshot:upload.manualSnapshot }] : [],
        updatedAt:this.now(),
      });
      delete upload.forcedBySeed;
      delete upload.forcedSeed;
      delete upload.forcedDate;
      delete upload.schemeSignature;
      changed = true;
    });

    forcedTeams.forEach(({ seed, team }) => {
      const current = uploads[team.ownerId] ?? {};
      const manualEnabled = current.manualEnabled ?? Boolean(current.enabled && !current.forcedBySeed);
      const manualSnapshot = current.manualSnapshot ?? (manualEnabled ? current.snapshot : null);
      const schemes = team.lineupSchemes?.length ? team.lineupSchemes : [lineupSchemeSnapshot(team)];
      const schemeSignature = schemes.map((scheme) => `${scheme.id}:${Math.max(0, Number(scheme.revision ?? 0))}`).join("|");
      const needsRefresh = !current.forcedBySeed || current.forcedDate !== date || Number(current.forcedSeed) !== seed || current.schemeSignature !== schemeSignature;
      if (!needsRefresh && current.enabled && this.mirrorUploadSnapshots(current).length === schemes.length) return;
      const snapshots = this.mirrorSchemeSnapshots(team);
      uploads[team.ownerId] = {
        ...current,
        enabled:true,
        manualEnabled:Boolean(manualEnabled),
        manualSnapshot,
        forcedBySeed:true,
        forcedSeed:seed,
        forcedDate:date,
        schemeSignature,
        snapshot:snapshots[0]?.snapshot ?? null,
        snapshots,
        updatedAt:this.now(),
      };
      changed = true;
    });
    return changed;
  }

  mirrorMarketplacePrice(team) {
    return MIRROR_MARKETPLACE_PRICES.get(String(team?.ownerName ?? "").trim()) ?? null;
  }

  mirrorMarketplaceCatalog(account) {
    this.syncForcedSeedMirrorUploads();
    const ownTeam = this.accountTeam(account.id);
    const uploads = this.state.mirrorMarketplace.uploads;
    const entries = this.state.teams.flatMap((team) => {
      const basePrice = this.mirrorMarketplacePrice(team);
      if (!team.ownerId || basePrice == null || team.ownerId === account.id) return [];
      const upload = uploads[team.ownerId];
      const common = {
        teamId:team.id,
        ownerName:team.ownerName,
        teamName:team.name,
        forcedSeed:upload?.forcedBySeed ? Number(upload.forcedSeed) : null,
      };
      const variants = [{ ...common, kind:"basic", price:basePrice }];
      if (upload?.enabled) {
        this.mirrorUploadSnapshots(upload).forEach((entry) => variants.push({
          ...common,
          kind:"full",
          price:upload.forcedBySeed ? MIRROR_MARKETPLACE_FORCED_FULL_PRICE : Math.round(basePrice * MIRROR_MARKETPLACE_FULL_MULTIPLIER),
          mirrorSchemeId:entry.schemeId ?? null,
          mirrorSchemeName:entry.schemeName ?? null,
        }));
      }
      return variants;
    }).sort((left, right) => (MIRROR_MARKETPLACE_PRICES.get(right.ownerName) ?? 0) - (MIRROR_MARKETPLACE_PRICES.get(left.ownerName) ?? 0)
      || (left.kind === right.kind
        ? String(left.mirrorSchemeId ?? "").localeCompare(String(right.mirrorSchemeId ?? ""))
        : left.kind === "basic" ? -1 : 1));
    const ownUpload = ownTeam ? uploads[account.id] : null;
    const cloudActiveJobs = this.mirrorBatchCapacityEntries(MIRROR_BATCH_CLOUD_NODE);
    const computeNodes = this.mirrorComputeNodeStatuses(account);
    return {
      available:this.state.season.status !== "active",
      commissionRate:MIRROR_MARKETPLACE_COMMISSION_RATE,
      fullMultiplier:MIRROR_MARKETPLACE_FULL_MULTIPLIER,
      batchMatchCount:MIRROR_BATCH_MATCH_COUNT,
      batchMinimumMatchCount:MIRROR_BATCH_MIN_MATCH_COUNT,
      batchMaximumMatchCount:MIRROR_BATCH_MAX_MATCH_COUNT,
      batchServiceFeeRate:MIRROR_BATCH_SERVICE_FEE_RATE,
      batchPriceDivisor:MIRROR_BATCH_PRICE_DIVISOR,
      batchCapacity:MIRROR_BATCH_MAX_ACTIVE_JOBS,
      activeBatchJobs:this.mirrorBatchCapacityEntries(),
      batchNodes:[{ id:MIRROR_BATCH_CLOUD_NODE, label:"云服务器", online:true, acceptingJobs:true, status:"accepting", capacity:MIRROR_BATCH_MAX_ACTIVE_JOBS, activeCount:cloudActiveJobs.length, availableSlots:Math.max(0, MIRROR_BATCH_MAX_ACTIVE_JOBS - cloudActiveJobs.length), estimatedSeconds:1_350, surchargePerMatch:0, serviceFeeRate:MIRROR_BATCH_SERVICE_FEE_RATE, activeJobs:cloudActiveJobs }, ...computeNodes],
      ownComputeNodes:computeNodes.filter((node) => node.isOwned),
      activeBatchJob:this.mirrorBatchJobView(this.state.mirrorMarketplace.batchJobs.find((job) => job.ownerId === account.id && ["queued", "running"].includes(job.status))),
      fullUploadEnabled:Boolean(ownUpload?.enabled && this.mirrorUploadSnapshots(ownUpload).length),
      fullUploadLocked:Boolean(ownUpload?.forcedBySeed),
      forcedSeed:ownUpload?.forcedBySeed ? Number(ownUpload.forcedSeed) : null,
      fullUploadCount:this.mirrorUploadSnapshots(ownUpload).length,
      fullUploadUpdatedAt:ownUpload?.updatedAt ?? null,
      entries,
    };
  }
  setFullMirrorUpload(account, enabledValue) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("请先加入联赛并保存自己的战术板");
    this.syncForcedSeedMirrorUploads();
    const enabled = enabledValue === true;
    const current = this.state.mirrorMarketplace.uploads[account.id] ?? {};
    if (!enabled && current.forcedBySeed) {
      throw new Error(`你是今日${current.forcedSeed}号种子，全部战术板完整镜像由系统强制上传，休赛期不可取消`);
    }
    if (!enabled) {
      this.state.mirrorMarketplace.uploads[account.id] = {
        ...current,
        enabled:false,
        manualEnabled:false,
        manualSnapshot:null,
        snapshot:null,
        snapshots:[],
        updatedAt:this.now(),
      };
    } else if (!current.forcedBySeed) {
      const activeScheme = team.lineupSchemes?.find((scheme) => scheme.id === team.activeLineupSchemeId);
      const snapshot = clone(this.aiTrainingPlayerSeat(team));
      this.state.mirrorMarketplace.uploads[account.id] = {
        ...current,
        enabled:true,
        manualEnabled:true,
        manualSnapshot:snapshot,
        snapshot,
        snapshots:[{
          schemeId:activeScheme?.id ?? null,
          schemeName:activeScheme?.name ?? "当前战术板",
          revision:Math.max(0, Number(activeScheme?.revision ?? 0)),
          snapshot,
        }],
        updatedAt:this.now(),
      };
    } else {
      current.enabled = true;
    }
    this.save({ scopes:["mirrorMarketplace"], skipDailyBackup:true });
    return this.compactMutationView(account, { extra:{ mirrorMarketplace:this.mirrorMarketplaceCatalog(account) } });
  }

  chargeMirrorInvocation(account, mirrorTeam, kind, mirrorSchemeId = null) {
    this.syncForcedSeedMirrorUploads();
    const basePrice = this.mirrorMarketplacePrice(mirrorTeam);
    if (basePrice == null) throw new Error("该玩家的镜像暂未开放调用");
    const full = kind === "full";
    const upload = this.state.mirrorMarketplace.uploads[mirrorTeam.ownerId];
    const fullSnapshots = full && upload?.enabled ? this.mirrorUploadSnapshots(upload) : [];
    const selectedSnapshot = full
      ? (mirrorSchemeId ? fullSnapshots.find((entry) => entry.schemeId === mirrorSchemeId) : fullSnapshots[0])
      : null;
    if (full && !selectedSnapshot) throw new Error("该玩家尚未上传所选完整战术镜像");
    const price = full ? (upload?.forcedBySeed ? MIRROR_MARKETPLACE_FORCED_FULL_PRICE : Math.round(basePrice * MIRROR_MARKETPLACE_FULL_MULTIPLIER)) : basePrice;
    const wallet = this.wallet(account.id);
    if (wallet.balance < price) throw new Error(`金币不足，调用该镜像需要${price}金币`);
    wallet.balance -= price;
    const platformCommission = Math.round(price * MIRROR_MARKETPLACE_COMMISSION_RATE);
    const ownerRevenue = price - platformCommission;
    const date = localDateKey(new Date(this.now()));
    const usageForDate = this.state.mirrorMarketplace.usageByDate[date] ?? (this.state.mirrorMarketplace.usageByDate[date] = {});
    const usage = usageForDate[mirrorTeam.ownerId] ?? (usageForDate[mirrorTeam.ownerId] = {
      ownerId:mirrorTeam.ownerId,
      teamId:mirrorTeam.id,
      ownerName:mirrorTeam.ownerName,
      teamName:mirrorTeam.name,
      basicCalls:0,
      fullCalls:0,
      gross:0,
      platformCommission:0,
      ownerRevenue:0,
    });
    usage[full ? "fullCalls" : "basicCalls"] += 1;
    usage.gross += price;
    usage.platformCommission += platformCommission;
    usage.ownerRevenue += ownerRevenue;
    return {
      kind:full ? "full" : "basic",
      price,
      platformCommission,
      ownerRevenue,
      upload,
      snapshot:selectedSnapshot?.snapshot ?? null,
      mirrorSchemeId:selectedSnapshot?.schemeId ?? null,
      mirrorSchemeName:selectedSnapshot?.schemeName ?? null,
    };
  }

  refundMirrorInvocation(account, mirrorTeam, charge) {
    if (!charge) return;
    this.wallet(account.id).balance += charge.price;
    const date = localDateKey(new Date(this.now()));
    const usage = this.state.mirrorMarketplace.usageByDate[date]?.[mirrorTeam.ownerId];
    if (!usage) return;
    usage[charge.kind === "full" ? "fullCalls" : "basicCalls"] = Math.max(0, usage[charge.kind === "full" ? "fullCalls" : "basicCalls"] - 1);
    usage.gross -= charge.price;
    usage.platformCommission -= charge.platformCommission;
    usage.ownerRevenue -= charge.ownerRevenue;
    if (usage.basicCalls + usage.fullCalls === 0) delete this.state.mirrorMarketplace.usageByDate[date][mirrorTeam.ownerId];
  }

  settleMirrorMarketplace(beforeDate = localDateKey(new Date(this.now()))) {
    const marketplace = this.state.mirrorMarketplace;
    const settled = new Set(marketplace.settledDates ?? []);
    const dates = Object.keys(marketplace.usageByDate ?? {}).filter((date) => date < beforeDate && !settled.has(date)).sort();
    let changed = false;
    dates.forEach((date) => {
      Object.values(marketplace.usageByDate[date] ?? {}).forEach((usage) => {
        const team = this.state.teams.find((entry) => entry.ownerId === usage.ownerId);
        if (!team || !usage.ownerRevenue) return;
        this.wallet(usage.ownerId).balance += usage.ownerRevenue;
        this.pushInbox(team, {
          id:`mirror-marketplace-settlement:${date}:${usage.ownerId}`,
          type:"mirror-settlement",
          title:`${date} 镜像调用收益已结算`,
          summary:`普通镜像${usage.basicCalls}次、完整镜像${usage.fullCalls}次，到账${usage.ownerRevenue}金币。`,
          body:`你的阵容镜像在${date}共被调用${usage.basicCalls + usage.fullCalls}次，其中普通镜像${usage.basicCalls}次、完整战术镜像${usage.fullCalls}次。调用费合计${usage.gross}金币，系统抽成${usage.platformCommission}金币，剩余${usage.ownerRevenue}金币现已发放到球队账户。`,
          payload:{ date, ...clone(usage) },
        });
      });
      settled.add(date);
      changed = true;
    });
    marketplace.settledDates = [...settled].sort().slice(-30);
    dates.forEach((date) => { delete marketplace.usageByDate[date]; });
    return changed;
  }

  mirrorComputeNodeConfig(nodeIdValue) {
    const nodeId = String(nodeIdValue ?? "");
    if (nodeId === MIRROR_BATCH_DIRECTOR_NODE) {
      const team = this.directorMirrorRevenueTeam();
      return {
        id:MIRROR_BATCH_DIRECTOR_NODE,
        ownerId:team?.ownerId ?? null,
        teamId:team?.id ?? null,
        label:"主任高速服务器",
        visibility:"public",
        maximumConcurrency:MIRROR_BATCH_DIRECTOR_CONCURRENCY,
        legacy:true,
      };
    }
    return this.state.mirrorMarketplace.computeNodes?.[nodeId] ?? null;
  }

  saveMirrorComputeNode(account, info = {}) {
    const existingId = String(info.nodeId ?? "");
    const existing = existingId ? this.state.mirrorMarketplace.computeNodes[existingId] : null;
    if (existing && existing.ownerId !== account.id) throw new Error("无权修改该计算节点");
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("请先加入联赛");
    const nodeId = existing?.id ?? `worker-${randomBytes(8).toString("hex")}`;
    const rotateToken = !existing?.tokenHash || info.rotateToken === true;
    const workerToken = rotateToken ? randomBytes(32).toString("base64url") : null;
    const node = {
      id:nodeId,
      ownerId:account.id,
      teamId:team.id,
      label:String(info.label ?? existing?.label ?? `${team.ownerName ?? team.name}的计算节点`).trim().slice(0, 40) || "玩家计算节点",
      visibility:info.visibility === "public" ? "public" : "private",
      maximumConcurrency:Math.min(MIRROR_BATCH_DIRECTOR_CONCURRENCY, Math.max(1, Math.floor(Number(info.maximumConcurrency ?? existing?.maximumConcurrency ?? 1)))),
      tokenHash:rotateToken ? createHash("sha256").update(workerToken).digest("hex") : existing.tokenHash,
      tokenExpiresAt:rotateToken ? this.now() + MIRROR_COMPUTE_NODE_TOKEN_MS : Number(existing.tokenExpiresAt ?? 0),
      createdAt:existing?.createdAt ?? this.now(),
      updatedAt:this.now(),
    };
    this.state.mirrorMarketplace.computeNodes[nodeId] = node;
    if (rotateToken) this.mirrorBatchWorkers.delete(nodeId);
    this.save({ scopes:["mirrorMarketplace"], skipDailyBackup:true, skipLiveBackupCopy:true });
    return this.compactMutationView(account, {
      extra:{
        mirrorMarketplace:this.mirrorMarketplaceCatalog(account),
        workerCredential:workerToken ? { nodeId, token:workerToken, expiresAt:node.tokenExpiresAt, engineVersion:MIRROR_BATCH_WORKER_ENGINE_VERSION } : null,
      },
    });
  }

  removeMirrorComputeNode(account, nodeIdValue) {
    const nodeId = String(nodeIdValue ?? "");
    const node = this.state.mirrorMarketplace.computeNodes[nodeId];
    if (!node || node.ownerId !== account.id) throw new Error("计算节点不存在或无权删除");
    if (this.mirrorBatchCapacityEntries(nodeId).length) throw new Error("该节点仍有批量任务，暂时不能删除");
    delete this.state.mirrorMarketplace.computeNodes[nodeId];
    this.mirrorBatchWorkers.delete(nodeId);
    this.save({ scopes:["mirrorMarketplace"], skipDailyBackup:true, skipLiveBackupCopy:true });
    return this.compactMutationView(account, { extra:{ mirrorMarketplace:this.mirrorMarketplaceCatalog(account) } });
  }

  authenticateMirrorComputeNode(nodeIdValue, tokenValue) {
    const node = this.state.mirrorMarketplace.computeNodes[String(nodeIdValue ?? "")];
    const token = String(tokenValue ?? "");
    if (!node?.tokenHash || !token) return null;
    if (Number(node.tokenExpiresAt ?? 0) <= this.now()) return null;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return tokenHash === node.tokenHash ? node : null;
  }

  mirrorComputeNodeStatuses(account = null) {
    const visible = Object.values(this.state.mirrorMarketplace.computeNodes ?? {})
      .filter((node) => node.visibility === "public" || node.ownerId === account?.id)
      .map((node) => this.directorMirrorWorkerStatus(node.id, account?.id));
    return [this.directorMirrorWorkerStatus(MIRROR_BATCH_DIRECTOR_NODE, account?.id), ...visible]
      .sort((left, right) => Number(right.isOwned) - Number(left.isOwned) || Number(right.online) - Number(left.online) || left.label.localeCompare(right.label, "zh-CN"));
  }
  directorMirrorRevenueTeam() {
    const target = MIRROR_BATCH_DIRECTOR_OWNER_NAME.toLocaleLowerCase("en-US");
    return this.state.teams.find((team) => team.ownerId && String(team.ownerName ?? "").trim().toLocaleLowerCase("en-US") === target) ?? null;
  }

  reclaimExpiredDirectorMirrorLeases() {
    const now = this.now();
    let changed = false;
    this.state.mirrorMarketplace.batchJobs.forEach((job) => {
      if ((job.executionNode ?? MIRROR_BATCH_CLOUD_NODE) === MIRROR_BATCH_CLOUD_NODE || job.status !== "running" || !job.workerLease) return;
      if (Number(job.workerLease.expiresAt ?? 0) > now) return;
      job.status = "queued";
      job.workerProgress = 0;
      job.lastWorkerError = "玩家计算节点租约超时，任务已重新排队";
      delete job.workerLease;
      changed = true;
    });
    return changed;
  }

  directorMirrorWorkerStatus(nodeIdValue = MIRROR_BATCH_DIRECTOR_NODE, viewerOwnerId = null) {
    this.reclaimExpiredDirectorMirrorLeases();
    const nodeId = String(nodeIdValue ?? MIRROR_BATCH_DIRECTOR_NODE);
    const config = this.mirrorComputeNodeConfig(nodeId);
    const worker = this.mirrorBatchWorkers.get(nodeId);
    const compatible = worker?.engineVersion === MIRROR_BATCH_WORKER_ENGINE_VERSION;
    const online = Boolean(config && worker && compatible && this.now() - Number(worker.lastHeartbeatAt ?? 0) <= MIRROR_BATCH_WORKER_ONLINE_MS);
    const capacity = Math.min(MIRROR_BATCH_DIRECTOR_CONCURRENCY, Math.max(1, Number(config?.maximumConcurrency ?? 1)), Math.max(1, Number(worker?.maximumConcurrency ?? config?.maximumConcurrency ?? 1)));
    const activeJobs = this.mirrorBatchCapacityEntries(nodeId);
    const acceptingJobs = Boolean(online && worker?.acceptingJobs !== false);
    const status = !online ? "offline" : !acceptingJobs ? "standby" : activeJobs.length >= capacity ? "full" : "accepting";
    return {
      id:nodeId,
      ownerId:config?.ownerId ?? null,
      label:config?.label ?? "玩家计算节点",
      visibility:config?.visibility ?? "private",
      isOwned:Boolean(viewerOwnerId && config?.ownerId === viewerOwnerId),
      credentialExpiresAt:viewerOwnerId && config?.ownerId === viewerOwnerId ? Number(config.tokenExpiresAt ?? 0) || null : null,
      online,
      acceptingJobs,
      status,
      compatible:Boolean(compatible),
      capacity,
      activeCount:activeJobs.length,
      availableSlots:acceptingJobs ? Math.max(0, capacity - activeJobs.length) : 0,
      estimatedSeconds:120,
      surchargePerMatch:MIRROR_BATCH_DIRECTOR_SURCHARGE_PER_MATCH,
      serviceFeeRate:viewerOwnerId && config?.ownerId === viewerOwnerId ? 0 : MIRROR_BATCH_SERVICE_FEE_RATE,
      engineVersion:MIRROR_BATCH_WORKER_ENGINE_VERSION,
      workerId:online ? nodeId : null,
      lastHeartbeatAt:worker?.lastHeartbeatAt ?? null,
      activeJobs,
    };
  }

  registerDirectorMirrorWorker(info = {}) {
    const requestedWorkerId = String(info.workerId ?? "").trim().slice(0, 120);
    const nodeId = requestedWorkerId === "axero-director-pc" ? MIRROR_BATCH_DIRECTOR_NODE : requestedWorkerId;
    const engineVersion = String(info.engineVersion ?? "").trim();
    if (!nodeId || !this.mirrorComputeNodeConfig(nodeId)) throw new Error("高速Worker节点不存在");
    if (engineVersion !== MIRROR_BATCH_WORKER_ENGINE_VERSION) {
      const error = new Error(`高速Worker引擎版本不匹配，需要${MIRROR_BATCH_WORKER_ENGINE_VERSION}`);
      error.statusCode = 409;
      throw error;
    }
    const now = this.now();
    const activeLeaseIds = new Set((info.activeLeaseIds ?? []).map(String));
    this.mirrorBatchWorkers.set(nodeId, {
      workerId:nodeId,
      engineVersion,
      maximumConcurrency:Math.min(MIRROR_BATCH_DIRECTOR_CONCURRENCY, Math.max(1, Number(this.mirrorComputeNodeConfig(nodeId)?.maximumConcurrency ?? 1)), Math.max(1, Number(info.maximumConcurrency ?? 1))),
      acceptingJobs:info.acceptingJobs !== false,
      lastHeartbeatAt:now,
    });
    this.state.mirrorMarketplace.batchJobs.forEach((job) => {
      if (job.workerLease?.workerId !== nodeId || !activeLeaseIds.has(String(job.workerLease.leaseId))) return;
      job.workerLease.expiresAt = now + MIRROR_BATCH_WORKER_LEASE_MS;
      job.workerLease.lastHeartbeatAt = now;
    });
    return this.directorMirrorWorkerStatus(nodeId);
  }

  assertDirectorMirrorWorker(workerId, engineVersion) {
    const nodeId = String(workerId ?? "");
    const status = this.directorMirrorWorkerStatus(nodeId);
    if (!status.acceptingJobs || engineVersion !== MIRROR_BATCH_WORKER_ENGINE_VERSION) {
      const error = new Error(status.online ? "玩家计算节点当前在线待机，尚未开启接受计算服务" : "玩家计算节点当前离线或版本不匹配");
      error.statusCode = 409;
      throw error;
    }
    return status;
  }

  leaseDirectorMirrorBatchJob(info = {}) {
    const workerId = String(info.workerId ?? "") === "axero-director-pc" ? MIRROR_BATCH_DIRECTOR_NODE : String(info.workerId ?? "");
    const engineVersion = String(info.engineVersion ?? "");
    this.assertDirectorMirrorWorker(workerId, engineVersion);
    const reclaimed = this.reclaimExpiredDirectorMirrorLeases();
    const job = this.state.mirrorMarketplace.batchJobs
      .filter((entry) => entry.executionNode === workerId && entry.status === "queued")
      .sort((left, right) => Number(left.createdAt) - Number(right.createdAt))[0];
    if (!job) {
      if (reclaimed) this.save({ scopes:["mirrorMarketplace"], skipDailyBackup:true, skipLiveBackupCopy:true });
      return null;
    }
    const now = this.now();
    const leaseId = makeId("mirror-worker-lease", `${job.id}:${workerId}:${now}`);
    job.status = "running";
    job.workerProgress = 0;
    job.workerLease = { leaseId, workerId, leasedAt:now, lastHeartbeatAt:now, expiresAt:now + MIRROR_BATCH_WORKER_LEASE_MS };
    job.updatedAt = now;
    const matches = Array.from({ length:job.totalMatches }, (_, index) => {
      const number = index + 1;
      const seed = `${this.state.season.id}:${job.id}:${number}`;
      const conditions = seededConditions(seed);
      return { number, seed, weather:conditions.weather.key, referee:conditions.referee };
    });
    this.save({ scopes:["mirrorMarketplace"], skipDailyBackup:true, skipLiveBackupCopy:true });
    return {
      jobId:job.id,
      leaseId,
      engineVersion:MIRROR_BATCH_WORKER_ENGINE_VERSION,
      totalMatches:job.totalMatches,
      callerSeat:clone(job.callerSeat),
      opponentSeat:clone(job.opponentSeat),
      matches,
    };
  }

  directorMirrorBatchLease(jobId, leaseId) {
    const job = this.state.mirrorMarketplace.batchJobs.find((entry) => entry.id === String(jobId ?? ""));
    if (!job) {
      const receipt = (this.state.mirrorMarketplace.batchReceipts ?? []).find((entry) => entry.id === String(jobId ?? ""));
      if (!receipt) throw new Error("高速模拟任务不存在");
      const message = (this.state.inbox[receipt.teamId] ?? []).find((entry) => entry.type === "mirror-batch-report" && entry.payload?.mirrorBatchJobId === receipt.id);
      return { job:receipt, completed:true, report:message?.report ?? null };
    }
    if (job.status === "completed") return { job, completed:true, report:job.report ?? null };
    if ((job.executionNode ?? MIRROR_BATCH_CLOUD_NODE) === MIRROR_BATCH_CLOUD_NODE || job.workerLease?.leaseId !== String(leaseId ?? "")) {
      const error = new Error("高速模拟任务租约无效或已过期");
      error.statusCode = 409;
      throw error;
    }
    if (Number(job.workerLease.expiresAt ?? 0) <= this.now()) {
      const error = new Error("高速模拟任务租约已过期");
      error.statusCode = 409;
      throw error;
    }
    return { job, completed:false };
  }

  updateDirectorMirrorBatchProgress(info = {}) {
    const lease = this.directorMirrorBatchLease(info.jobId, info.leaseId);
    if (lease.completed) return this.mirrorBatchJobView(lease.job);
    const completedMatches = Math.min(lease.job.totalMatches, Math.max(0, Math.floor(Number(info.completedMatches ?? 0))));
    lease.job.workerProgress = Math.max(Number(lease.job.workerProgress ?? 0), completedMatches);
    lease.job.updatedAt = this.now();
    this.save({ scopes:["mirrorMarketplace"], skipDailyBackup:true, skipLiveBackupCopy:true });
    return this.mirrorBatchJobView(lease.job);
  }

  completeDirectorMirrorBatchJob(info = {}) {
    const lease = this.directorMirrorBatchLease(info.jobId, info.leaseId);
    if (lease.completed) return { mirrorBatchJob:this.mirrorBatchJobView(lease.job), report:clone(lease.report ?? lease.job.report ?? null) };
    const reports = Array.isArray(info.reports) ? info.reports : [];
    if (reports.length !== lease.job.totalMatches) throw new Error(`高速模拟结果必须包含${lease.job.totalMatches}场`);
    const expectedSeeds = new Map(Array.from({ length:lease.job.totalMatches }, (_, index) => {
      const number = index + 1;
      return [number, `${this.state.season.id}:${lease.job.id}:${number}`];
    }));
    const seen = new Set();
    const results = reports.map((entry) => {
      const number = Math.floor(Number(entry?.number));
      if (!expectedSeeds.has(number) || seen.has(number) || entry?.seed !== expectedSeeds.get(number)) throw new Error("高速模拟结果编号或随机种子无效");
      if (!Array.isArray(entry.report?.score) || entry.report.score.length !== 2 || !Array.isArray(entry.report?.teams) || entry.report.teams.length !== 2) throw new Error("高速模拟比赛报告结构无效");
      seen.add(number);
      return this.mirrorBatchMatchResult({ report:entry.report }, number);
    }).sort((left, right) => left.number - right.number);
    lease.job.results = results;
    delete lease.job.workerLease;
    delete lease.job.workerProgress;
    this.finalizeMirrorBatchJob(lease.job);
    this.save({ scopes:["core", "mirrorMarketplace"], skipDailyBackup:true, skipLiveBackupCopy:true });
    return { mirrorBatchJob:this.mirrorBatchJobView(lease.job), report:clone(lease.job.report) };
  }

  failDirectorMirrorBatchJob(info = {}) {
    const lease = this.directorMirrorBatchLease(info.jobId, info.leaseId);
    if (lease.completed) return this.mirrorBatchJobView(lease.job);
    lease.job.status = "queued";
    lease.job.workerProgress = 0;
    lease.job.lastWorkerError = String(info.error ?? "高速Worker执行失败").slice(0, 500);
    lease.job.updatedAt = this.now();
    delete lease.job.workerLease;
    this.save({ scopes:["mirrorMarketplace"], skipDailyBackup:true, skipLiveBackupCopy:true });
    return this.mirrorBatchJobView(lease.job);
  }

  mirrorBatchCapacityEntries(executionNode = null) {
    return this.state.mirrorMarketplace.batchJobs
      .filter((job) => ["queued", "running"].includes(job.status) && (!executionNode || (job.executionNode ?? MIRROR_BATCH_CLOUD_NODE) === executionNode))
      .sort((left, right) => Number(left.createdAt) - Number(right.createdAt))
      .map((job) => {
        const team = this.state.teams.find((entry) => entry.id === job.teamId || entry.ownerId === job.ownerId);
        const completedMatches = Math.max(Number(job.results?.length ?? 0), Number(job.workerProgress ?? 0));
        const totalMatches = Number(job.totalMatches ?? MIRROR_BATCH_MATCH_COUNT);
        return {
          ownerId:job.ownerId,
          ownerName:team?.ownerName ?? "未知玩家",
          teamName:team?.name ?? "未知球队",
          status:job.status,
          executionNode:job.executionNode ?? MIRROR_BATCH_CLOUD_NODE,
          completedMatches,
          totalMatches,
          remainingMatches:Math.max(0, totalMatches - completedMatches),
        };
      });
  }

  mirrorBatchJobView(job) {
    if (!job) return null;
    return {
      id:job.id,
      requestId:job.requestId,
      status:job.status,
      executionNode:job.executionNode ?? MIRROR_BATCH_CLOUD_NODE,
      computeNodeOwnerId:job.computeNodeOwnerId ?? null,
      computeNodeLabel:job.computeNodeLabel ?? (job.executionNode === MIRROR_BATCH_CLOUD_NODE ? "云服务器" : "玩家计算节点"),
      usesOwnComputeNode:Boolean(job.usesOwnComputeNode),
      completedMatches:Math.max(Number(job.results?.length ?? 0), Number(job.workerProgress ?? 0)),
      totalMatches:Number(job.totalMatches ?? MIRROR_BATCH_MATCH_COUNT),
      mirrorTeamId:job.mirrorTeamId,
      mirrorKind:job.mirrorKind,
      mirrorSchemeId:job.mirrorSchemeId ?? null,
      mirrorSchemeName:job.mirrorSchemeName ?? null,
      opponentName:job.opponentName,
      unitPrice:job.unitPrice,
      batchPriceDivisor:MIRROR_BATCH_PRICE_DIVISOR,
      subtotal:job.subtotal,
      serviceFee:job.serviceFee,
      directorSurcharge:Number(job.directorSurcharge ?? 0),
      directorServiceFeeRevenue:Number(job.directorServiceFeeRevenue ?? 0),
      playerComputeNodeServiceFeeRevenue:Number(job.playerComputeNodeServiceFeeRevenue ?? 0),
      totalCost:job.totalCost,
      createdAt:job.createdAt,
      completedAt:job.completedAt ?? null,
    };
  }

  createMirrorBatchSimulation(account, config = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("请先加入联赛并保存自己的战术板");
    const mirrorTeamId = String(config.mirrorTeamId ?? "");
    if (mirrorTeamId && this.state.season.status === "active") throw new Error("玩家阵容镜像仅在休赛期开放");
    const requestId = String(config.requestId ?? "").trim().slice(0, 120);
    if (!requestId) throw new Error("批量模拟请求缺少requestId");
    const totalMatches = Math.floor(Number(config.totalMatches ?? config.matchCount ?? MIRROR_BATCH_MATCH_COUNT));
    if (totalMatches < MIRROR_BATCH_MIN_MATCH_COUNT || totalMatches > MIRROR_BATCH_MAX_MATCH_COUNT || totalMatches % 10 !== 0) {
      throw new Error(`批量模拟场次必须为10、20、30、40或50场`);
    }
    const marketplace = this.state.mirrorMarketplace;
    const repeated = marketplace.batchJobs.find((job) => job.ownerId === account.id && job.requestId === requestId)
      ?? (marketplace.batchReceipts ?? []).find((receipt) => receipt.ownerId === account.id && receipt.requestId === requestId);
    if (repeated) return this.compactMutationView(account, { extra:{ mirrorBatchJob:this.mirrorBatchJobView(repeated) } });
    const activeJob = marketplace.batchJobs.find((job) => job.ownerId === account.id && ["queued", "running"].includes(job.status));
    if (activeJob) throw new Error(`已有批量模拟正在排队（${Math.max(Number(activeJob.results?.length ?? 0), Number(activeJob.workerProgress ?? 0))}/${activeJob.totalMatches}），请等待系统邮件`);

    const requestedNode = String(config.executionNode ?? MIRROR_BATCH_CLOUD_NODE);
    const executionNode = requestedNode === MIRROR_BATCH_CLOUD_NODE ? MIRROR_BATCH_CLOUD_NODE : requestedNode;
    const computeNode = executionNode === MIRROR_BATCH_CLOUD_NODE ? null : this.mirrorComputeNodeConfig(executionNode);
    if (executionNode !== MIRROR_BATCH_CLOUD_NODE && (!computeNode || (computeNode.visibility !== "public" && computeNode.ownerId !== account.id))) {
      throw new Error("请选择有效的玩家计算节点");
    }
    const nodeStatus = computeNode ? this.directorMirrorWorkerStatus(executionNode, account.id) : null;
    if (nodeStatus && !nodeStatus.acceptingJobs) {
      const error = new Error(nodeStatus.online ? `${nodeStatus.label}当前在线待机，尚未开启接受计算服务` : `${nodeStatus.label}当前离线，请选择其他节点`);
      error.statusCode = 409;
      error.details = nodeStatus.activeJobs;
      throw error;
    }
    const capacity = nodeStatus?.capacity ?? MIRROR_BATCH_MAX_ACTIVE_JOBS;
    const capacityEntries = this.mirrorBatchCapacityEntries(executionNode);
    if (capacityEntries.length >= capacity) {
      const error = new Error(`${nodeStatus?.label ?? "云服务器"}任务已满，请稍后尝试`);
      error.statusCode = 409;
      error.details = capacityEntries;
      throw error;
    }

    const tacticalPlans = this.aiTrainingTacticalPlans(config.tacticalPlans);
    let mirrorTeam = null;
    let mirrorKind = "system-ai";
    let selectedSnapshot = null;
    let unitPrice = 0;
    let opponentName;
    let opponentSeat;
    if (mirrorTeamId) {
      this.syncForcedSeedMirrorUploads();
      mirrorTeam = this.state.teams.find((entry) => entry.id === mirrorTeamId && entry.ownerId);
      if (!mirrorTeam) throw new Error("请选择有效的玩家阵容镜像");
      if (mirrorTeam.ownerId === account.id) throw new Error("不能调用自己的阵容镜像");
      mirrorKind = String(config.mirrorKind ?? "basic") === "full" ? "full" : "basic";
      const mirrorSchemeId = String(config.mirrorSchemeId ?? "") || null;
      const basePrice = this.mirrorMarketplacePrice(mirrorTeam);
      if (basePrice == null) throw new Error("该玩家的镜像暂未开放调用");
      const upload = marketplace.uploads[mirrorTeam.ownerId];
      const snapshots = mirrorKind === "full" && upload?.enabled ? this.mirrorUploadSnapshots(upload) : [];
      selectedSnapshot = mirrorKind === "full"
        ? (mirrorSchemeId ? snapshots.find((entry) => entry.schemeId === mirrorSchemeId) : snapshots[0])
        : null;
      if (mirrorKind === "full" && !selectedSnapshot) throw new Error("该玩家尚未上传所选完整战术镜像");
      unitPrice = mirrorKind === "full"
        ? (upload?.forcedBySeed ? MIRROR_MARKETPLACE_FORCED_FULL_PRICE : Math.round(basePrice * MIRROR_MARKETPLACE_FULL_MULTIPLIER))
        : basePrice;
      opponentName = mirrorKind === "full"
        ? `${mirrorTeam.ownerName ?? mirrorTeam.name}完整战术镜像${selectedSnapshot?.schemeName ? ` · ${selectedSnapshot.schemeName}` : ""}`
        : `${mirrorTeam.ownerName ?? mirrorTeam.name}玩家镜像`;
      const sourceSeat = mirrorKind === "full" ? clone(selectedSnapshot.snapshot) : this.aiTrainingPlayerSeat(mirrorTeam);
      opponentSeat = mirrorKind === "full" ? { ...sourceSeat, name:opponentName } : {
        ...sourceSeat,
        name:opponentName,
        tactic:tacticalPlans.opening.tactic,
        style:tacticalPlans.opening.style,
        tacticalPlans,
        attackFocus:FOCUSES.has(config.attackFocus) ? config.attackFocus : "balanced",
        defenseFocus:FOCUSES.has(config.defenseFocus) ? config.defenseFocus : "balanced",
      };
    } else {
      const formation = String(config.formation ?? "4-3-3");
      const aiSelection = this.aiTrainingPlayers(formation, config.averageOverall);
      const positions = Object.fromEntries(aiSelection.starters.map(({ player, position }) => [player.id, position]));
      const formationLines = deriveFormationLines(aiSelection.starters.map(({ player, position }) => ({ id:player.id, position })));
      opponentName = `AI 训练队 · ${formation} · ${aiSelection.averageOverall}`;
      opponentSeat = {
        name:opponentName,
        players:[
          ...aiSelection.starters.map(({ player }) => ({ ...player, state:{ fitness:100 }, traits:[], active:true })),
          ...aiSelection.substitutes.map((player) => ({ ...player, state:{ fitness:100 }, traits:[], active:false })),
        ],
        positions,
        positionPresets:Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(positions)])),
        formationLinePresets:Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(formationLines)])),
        tactic:tacticalPlans.opening.tactic,
        style:tacticalPlans.opening.style,
        tacticalPlans,
        bondCatalog:[],
        attackFocus:FOCUSES.has(config.attackFocus) ? config.attackFocus : "balanced",
        defenseFocus:FOCUSES.has(config.defenseFocus) ? config.defenseFocus : "balanced",
        preserveFitness:true,
      };
    }

    const subtotal = Math.round(unitPrice * totalMatches / MIRROR_BATCH_PRICE_DIVISOR);
    const usesOwnComputeNode = Boolean(computeNode && computeNode.ownerId === account.id);
    const serviceFee = usesOwnComputeNode ? 0 : Math.round(subtotal * MIRROR_BATCH_SERVICE_FEE_RATE);
    const baseTotalCost = subtotal;
    const directorSurcharge = 0;
    const directorServiceFeeRevenue = executionNode === MIRROR_BATCH_DIRECTOR_NODE && !usesOwnComputeNode ? serviceFee : 0;
    const playerComputeNodeServiceFeeRevenue = computeNode && executionNode !== MIRROR_BATCH_DIRECTOR_NODE && !usesOwnComputeNode ? serviceFee : 0;
    const directorRevenueTeam = directorServiceFeeRevenue > 0 ? this.directorMirrorRevenueTeam() : null;
    const computeNodeRevenueTeam = playerComputeNodeServiceFeeRevenue > 0
      ? this.state.teams.find((entry) => entry.id === computeNode.teamId && entry.ownerId === computeNode.ownerId) ?? null
      : null;
    if (directorServiceFeeRevenue > 0 && !directorRevenueTeam) throw new Error(`联赛中未找到${MIRROR_BATCH_DIRECTOR_OWNER_NAME}账号，暂时无法使用主任高速服务器`);
    if (playerComputeNodeServiceFeeRevenue > 0 && !computeNodeRevenueTeam) throw new Error(`${nodeStatus?.label ?? "玩家计算节点"}的节点主人账号不存在，暂时无法使用`);
    const totalCost = subtotal + serviceFee;
    const wallet = this.wallet(account.id);
    if (wallet.balance < totalCost) throw new Error(`金币不足，${totalMatches}场批量模拟需要${totalCost}金币`);
    const createdAt = this.now();
    const job = {
      id:makeId("mirror-batch", `${account.id}:${requestId}`),
      requestId,
      ownerId:account.id,
      teamId:team.id,
      mirrorOwnerId:mirrorTeam?.ownerId ?? null,
      mirrorTeamId:mirrorTeam?.id ?? null,
      mirrorKind,
      mirrorSchemeId:selectedSnapshot?.schemeId ?? null,
      mirrorSchemeName:selectedSnapshot?.schemeName ?? null,
      opponentName,
      computeNodeOwnerId:computeNode?.ownerId ?? null,
      computeNodeLabel:nodeStatus?.label ?? "云服务器",
      usesOwnComputeNode,
      executionNode,
      unitPrice,
      subtotal,
      serviceFee,
      baseTotalCost,
      directorSurcharge,
      directorServiceFeeRevenue,
      playerComputeNodeServiceFeeRevenue,
      totalCost,
      totalMatches:totalMatches,
      status:"queued",
      callerSeat:clone(this.aiTrainingPlayerSeat(team)),
      opponentSeat:clone(opponentSeat),
      results:[],
      createdAt,
      updatedAt:createdAt,
    };

    wallet.balance -= totalCost;
    const mirrorCommission = mirrorTeam ? Math.round(subtotal * MIRROR_MARKETPLACE_COMMISSION_RATE) : 0;
    const platformCommission = mirrorCommission + serviceFee - directorServiceFeeRevenue - playerComputeNodeServiceFeeRevenue;
    const ownerRevenue = mirrorTeam ? subtotal - mirrorCommission : 0;
    if (mirrorTeam) {
      const date = localDateKey(new Date(createdAt));
      const usageForDate = marketplace.usageByDate[date] ?? (marketplace.usageByDate[date] = {});
      const usage = usageForDate[mirrorTeam.ownerId] ?? (usageForDate[mirrorTeam.ownerId] = {
        ownerId:mirrorTeam.ownerId,
        teamId:mirrorTeam.id,
        ownerName:mirrorTeam.ownerName,
        teamName:mirrorTeam.name,
        basicCalls:0,
        fullCalls:0,
        gross:0,
        platformCommission:0,
        ownerRevenue:0,
        serviceFees:0,
      });
      usage[mirrorKind === "full" ? "fullCalls" : "basicCalls"] += totalMatches;
      usage.gross += totalCost;
      usage.platformCommission += platformCommission;
      usage.ownerRevenue += ownerRevenue;
      usage.serviceFees = Number(usage.serviceFees ?? 0) + serviceFee;
    }
    if (directorServiceFeeRevenue > 0) {
      this.wallet(directorRevenueTeam.ownerId).balance += directorServiceFeeRevenue;
      this.state.ledger.push({ id:`director-worker-service-fee:${job.id}`, accountId:account.id, amount:-directorServiceFeeRevenue, type:"director-mirror-worker-service-fee", beneficiaryAccountId:directorRevenueTeam.ownerId, mirrorBatchJobId:job.id, matches:totalMatches, createdAt });
      this.state.ledger.push({ id:`director-worker-revenue:${job.id}`, accountId:directorRevenueTeam.ownerId, amount:directorServiceFeeRevenue, type:"director-mirror-worker-revenue", payerAccountId:account.id, mirrorBatchJobId:job.id, matches:totalMatches, createdAt });
      this.pushInbox(directorRevenueTeam, {
        id:`director-mirror-worker-revenue:${job.id}`,
        type:"director-worker-revenue",
        title:"主任高速服务器服务费收益到账",
        summary:`${team.ownerName ?? team.name}调用${totalMatches}场高速模拟，服务费${directorServiceFeeRevenue}金币已到账。`,
        body:`玩家${team.ownerName ?? "未知玩家"}（${team.name}）选择主任高速服务器运行${totalMatches}场批量模拟，30%批量服务费共${directorServiceFeeRevenue}金币已汇入Axero球队账户。`,
        payload:{ mirrorBatchJobId:job.id, payerOwnerId:account.id, payerTeamId:team.id, matches:totalMatches, amount:directorServiceFeeRevenue, source:"batch-service-fee" },
      });
    }


    if (playerComputeNodeServiceFeeRevenue > 0) {
      this.wallet(computeNodeRevenueTeam.ownerId).balance += playerComputeNodeServiceFeeRevenue;
      this.state.ledger.push({ id:`compute-node-service-fee:${job.id}`, accountId:account.id, amount:-playerComputeNodeServiceFeeRevenue, type:"compute-node-service-fee", beneficiaryAccountId:computeNodeRevenueTeam.ownerId, computeNodeId:executionNode, mirrorBatchJobId:job.id, matches:totalMatches, createdAt });
      this.state.ledger.push({ id:`compute-node-revenue:${job.id}`, accountId:computeNodeRevenueTeam.ownerId, amount:playerComputeNodeServiceFeeRevenue, type:"compute-node-revenue", payerAccountId:account.id, computeNodeId:executionNode, mirrorBatchJobId:job.id, matches:totalMatches, createdAt });
      this.pushInbox(computeNodeRevenueTeam, {
        id:`compute-node-revenue:${job.id}`,
        type:"compute-node-revenue",
        title:"计算节点服务费收益到账",
        summary:`${team.ownerName ?? team.name}调用你的计算节点，服务费${playerComputeNodeServiceFeeRevenue}金币已到账。`,
        body:`玩家${team.ownerName ?? "未知玩家"}（${team.name}）选择你的计算节点“${nodeStatus?.label ?? "玩家计算节点"}”运行${totalMatches}场批量模拟，30%节点服务费共${playerComputeNodeServiceFeeRevenue}金币已汇入你的球队账户。`,
        payload:{ mirrorBatchJobId:job.id, computeNodeId:executionNode, payerOwnerId:account.id, payerTeamId:team.id, matches:totalMatches, amount:playerComputeNodeServiceFeeRevenue, source:"batch-service-fee" },
      });
    }
    marketplace.batchJobs.push(job);
    const cutoff = createdAt - 30 * 24 * 60 * 60 * 1000;
    marketplace.batchJobs = marketplace.batchJobs.filter((entry) => ["queued", "running"].includes(entry.status) || Number(entry.completedAt ?? entry.createdAt) >= cutoff).slice(-200);
    this.save({ scopes:["core", "mirrorMarketplace"], skipDailyBackup:true });
    return this.compactMutationView(account, { extra:{ mirrorBatchJob:this.mirrorBatchJobView(job) } });
  }
  mirrorBatchTacticalProfile(seat = {}) {
    const starters = (seat.players ?? []).filter((player) => player.active !== false).slice(0, 11);
    const plans = seat.tacticalPlans ?? {};
    const states = [
      ["opening", "默认", "position1"],
      ["leading", "领先", "position2"],
      ["trailing", "落后", "position3"],
    ];
    const phases = states.map(([state, label, fallbackPreset]) => {
      const plan = plans[state] ?? plans.opening ?? {};
      const preset = plan.positionPreset ?? fallbackPreset;
      const positions = seat.positionPresets?.[preset] ?? seat.positions ?? {};
      const formationLines = seat.formationLinePresets?.[preset];
      let formation = "未知阵型";
      try {
        if (starters.length === 11) formation = analyzeElevenBoardFormation(starters, positions, formationLines).name;
      } catch { /* keep a readable fallback for legacy snapshots */ }
      return {
        state,
        label,
        formation,
        tactic:plan.tactic ?? seat.tactic ?? "balanced",
        style:plan.style ?? seat.style ?? "possession",
        triggerGoalDifference:state === "opening" ? null : Math.max(1, Number(plan.triggerGoalDifference ?? 1)),
      };
    });
    return {
      name:String(seat.name ?? "球队"),
      averageOverall:starters.length ? Number((starters.reduce((sum, player) => sum + Number(player.overall ?? 0), 0) / starters.length).toFixed(1)) : 0,
      attackFocus:seat.attackFocus ?? "balanced",
      defenseFocus:seat.defenseFocus ?? "balanced",
      phases,
    };
  }

  mirrorBatchMatchResult(match, number) {
    const report = match.report;
    const compactTeam = (team = {}) => {
      const stats = team.stats ?? {};
      const leaders = [...(team.players ?? [])]
        .sort((left, right) => Number(right.rating ?? 0) - Number(left.rating ?? 0) || Number(right.stats?.goals ?? 0) - Number(left.stats?.goals ?? 0))
        .slice(0, 3)
        .map((player) => ({
          id:player.id,
          name:player.name,
          rating:Number(player.rating ?? 0),
          goals:Number(player.stats?.goals ?? 0),
          assists:Number(player.stats?.assists ?? 0),
          shots:Number(player.stats?.shots ?? 0),
          shotsOnTarget:Number(player.stats?.shotsOnTarget ?? 0),
          tackles:Number(player.stats?.tackles ?? 0),
          interceptions:Number(player.stats?.interceptions ?? 0),
          saves:Number(player.stats?.saves ?? 0),
        }));
      return {
        formation:team.formation ?? null,
        tactic:team.tactic ?? null,
        style:team.style ?? null,
        attackFocus:team.attackFocus ?? null,
        defenseFocus:team.defenseFocus ?? null,
        tacticalFit:Number(team.tacticalFit ?? Number(team.styleFit ?? 0) * 100),
        xg:Number(stats.xg ?? 0),
        shots:Number(stats.shots ?? 0),
        shotsOnTarget:Number(stats.shotsOnTarget ?? 0),
        possession:Number(stats.possession ?? stats.possessionControl ?? 0),
        corners:Number(stats.corners ?? 0),
        fouls:Number(stats.fouls ?? 0),
        saves:Number(stats.saves ?? 0),
        tackles:Number(stats.tackles ?? 0),
        interceptions:Number(stats.interceptions ?? 0),
        clearances:Number(stats.clearances ?? 0),
        pressuresWon:Number(stats.pressuresWon ?? 0),
        leaders,
      };
    };
    const own = compactTeam(report.teams[0]);
    const opponent = compactTeam(report.teams[1]);
    const scoreFor = Number(report.score[0] ?? 0);
    const scoreAgainst = Number(report.score[1] ?? 0);
    return {
      number,
      result:scoreFor > scoreAgainst ? "W" : scoreFor === scoreAgainst ? "D" : "L",
      scoreFor,
      scoreAgainst,
      own,
      opponent,
      topPlayer:own.leaders[0] ?? null,
      opponentTopPlayer:opponent.leaders[0] ?? null,
    };
  }

  finalizeMirrorBatchJob(job) {
    const results = job.results ?? [];
    const total = Math.max(1, results.length);
    const sum = (selector) => results.reduce((value, result) => value + Number(selector(result) ?? 0), 0);
    const average = (selector, digits = 1) => Number((sum(selector) / total).toFixed(digits));
    const percent = (numerator, denominator) => denominator > 0 ? Number((numerator / denominator * 100).toFixed(1)) : 0;
    const wins = results.filter((result) => result.result === "W").length;
    const draws = results.filter((result) => result.result === "D").length;
    const losses = results.length - wins - draws;
    const goalsFor = sum((result) => result.scoreFor);
    const goalsAgainst = sum((result) => result.scoreAgainst);
    const xgFor = sum((result) => result.own.xg);
    const xgAgainst = sum((result) => result.opponent.xg);
    const shotsFor = sum((result) => result.own.shots);
    const shotsAgainst = sum((result) => result.opponent.shots);
    const shotsOnTargetFor = sum((result) => result.own.shotsOnTarget);
    const shotsOnTargetAgainst = sum((result) => result.opponent.shotsOnTarget);
    const cleanSheets = results.filter((result) => result.scoreAgainst === 0).length;
    const failedToScore = results.filter((result) => result.scoreFor === 0).length;
    const highVarianceMatches = results.filter((result) => Math.abs(result.scoreFor - result.scoreAgainst) >= 2).length;
    const oneGoalMatches = results.filter((result) => Math.abs(result.scoreFor - result.scoreAgainst) === 1).length;
    const playerTotals = new Map();
    results.forEach((result) => {
      for (const player of result.own.leaders ?? []) {
        const current = playerTotals.get(player.id) ?? { id:player.id, name:player.name, appearances:0, ratingTotal:0, goals:0, assists:0 };
        current.appearances += 1;
        current.ratingTotal += player.rating;
        current.goals += player.goals;
        current.assists += player.assists;
        playerTotals.set(player.id, current);
      }
    });
    const bestPlayer = [...playerTotals.values()].map((player) => ({ ...player, averageRating:Number((player.ratingTotal / player.appearances).toFixed(2)) }))
      .sort((left, right) => right.averageRating - left.averageRating || right.goals - left.goals)[0] ?? null;
    const ownProfile = this.mirrorBatchTacticalProfile(job.callerSeat);
    const opponentProfile = this.mirrorBatchTacticalProfile(job.opponentSeat);
    const xgDifference = Number(((xgFor - xgAgainst) / total).toFixed(2));
    const shotDifference = Number(((shotsFor - shotsAgainst) / total).toFixed(1));
    const possession = average((result) => result.own.possession, 1);
    const possessionAgainst = average((result) => result.opponent.possession, 1);
    const recommendations = [];
    if (xgDifference <= -0.25) recommendations.push("场均xG明显落后：应减少低质量远射，并通过中场接应或边路套上把进攻推进到更高价值区域。");
    else if (xgDifference >= 0.25 && wins < 5) recommendations.push("机会质量领先但胜率没有兑现：重点检查终结球员、禁区职责和领先后的比赛管理。");
    if (shotsOnTargetAgainst / total >= 5) recommendations.push("对手场均射正偏高：建议降低防线暴露，增加后腰保护或调整失球侧的防守职责。");
    if (failedToScore >= 3) recommendations.push(`有${failedToScore}场未能进球：落后方案启动后仍缺少稳定破局点，可提高进攻宽度或增加禁区人数。`);
    if (possession >= 55 && shotDifference < 0) recommendations.push("控球占优但射门落后，存在无效控球；需要提升向前传递、反抢后的快速推进和禁区触球。");
    if (cleanSheets <= 2 && goalsAgainst > goalsFor) recommendations.push("零封率偏低且总失球更多，优先优化由攻转守站位，再考虑进一步增加进攻风险。");
    if (!recommendations.length) recommendations.push("当前方案的机会、射门和赛果较均衡；建议保留默认结构，仅针对领先与落后节点做小幅调整后复测。");
    const summary = wins >= 6
      ? `${results.length}场模拟取得${wins}胜，整体表现占优；${xgFor >= xgAgainst ? "机会质量同样领先，可以继续沿用当前方案。" : "但预期进球处于下风，仍需警惕结果波动。"}`
      : losses >= 6
        ? `${results.length}场模拟遭遇${losses}负，当前方案面对该对手处于下风；建议优先调整防守结构与攻守转换。`
        : `${results.length}场模拟为${wins}胜${draws}平${losses}负，双方较为接近；可结合xG差、射门差和战术阶段继续微调。`;
    const report = {
      schemaVersion:2,
      jobId:job.id,
      opponentName:job.opponentName,
      mirrorKind:job.mirrorKind,
      mirrorSchemeName:job.mirrorSchemeName,
      totalMatches:results.length,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      average:{
        xgFor:Number((xgFor / total).toFixed(2)),
        xgAgainst:Number((xgAgainst / total).toFixed(2)),
        shotsFor:Number((shotsFor / total).toFixed(1)),
        shotsAgainst:Number((shotsAgainst / total).toFixed(1)),
        shotsOnTargetFor:Number((shotsOnTargetFor / total).toFixed(1)),
        shotsOnTargetAgainst:Number((shotsOnTargetAgainst / total).toFixed(1)),
        possession,
        possessionAgainst,
        cornersFor:average((result) => result.own.corners, 1),
        cornersAgainst:average((result) => result.opponent.corners, 1),
        foulsFor:average((result) => result.own.fouls, 1),
        foulsAgainst:average((result) => result.opponent.fouls, 1),
      },
      efficiency:{
        shotAccuracyFor:percent(shotsOnTargetFor, shotsFor),
        shotAccuracyAgainst:percent(shotsOnTargetAgainst, shotsAgainst),
        conversionFor:percent(goalsFor, shotsFor),
        conversionAgainst:percent(goalsAgainst, shotsAgainst),
        xgPerShotFor:shotsFor ? Number((xgFor / shotsFor).toFixed(3)) : 0,
        xgPerShotAgainst:shotsAgainst ? Number((xgAgainst / shotsAgainst).toFixed(3)) : 0,
      },
      stability:{ cleanSheets, failedToScore, oneGoalMatches, highVarianceMatches },
      tacticalProfiles:{ own:ownProfile, opponent:opponentProfile },
      analysis:{
        verdict:summary,
        attack:`场均${(goalsFor / total).toFixed(2)}球、${(xgFor / total).toFixed(2)} xG，射正率${percent(shotsOnTargetFor, shotsFor)}%，进球转化率${percent(goalsFor, shotsFor)}%。`,
        defense:`场均失${(goalsAgainst / total).toFixed(2)}球、被制造${(xgAgainst / total).toFixed(2)} xG，${cleanSheets}场零封，对手射正率${percent(shotsOnTargetAgainst, shotsAgainst)}%。`,
        control:`场均控球${possession}%（对手${possessionAgainst}%），场均射门差${shotDifference >= 0 ? "+" : ""}${shotDifference}，场均xG差${xgDifference >= 0 ? "+" : ""}${xgDifference}。`,
        consistency:`${oneGoalMatches}场一球差、${highVarianceMatches}场分差达到2球以上、${failedToScore}场被零封，反映当前方案的结果波动。`,
        recommendations,
      },
      bestPlayer,
      results:clone(results),
      pricing:{ executionNode:job.executionNode ?? MIRROR_BATCH_CLOUD_NODE, computeNodeLabel:job.computeNodeLabel ?? null, usesOwnComputeNode:Boolean(job.usesOwnComputeNode), unitPrice:job.unitPrice, batchPriceDivisor:MIRROR_BATCH_PRICE_DIVISOR, subtotal:job.subtotal, serviceFee:job.serviceFee, directorSurcharge:Number(job.directorSurcharge ?? 0), directorServiceFeeRevenue:Number(job.directorServiceFeeRevenue ?? 0), playerComputeNodeServiceFeeRevenue:Number(job.playerComputeNodeServiceFeeRevenue ?? 0), totalCost:job.totalCost },
      summary,
      completedAt:this.now(),
    };
    job.status = "completed";
    job.completedAt = report.completedAt;
    job.updatedAt = report.completedAt;
    job.report = report;
    delete job.activeMatch;
    delete job.activeMatchStartedAt;
    delete job.callerSeat;
    delete job.opponentSeat;
    delete job.workerLease;
    delete job.workerProgress;
    const team = this.accountTeam(job.ownerId);
    this.pushInbox(team, {
      id:`mirror-batch-report:${job.id}`,
      type:"mirror-batch-report",
      title:`${results.length}场批量模拟深度报告`,
      summary:`${job.opponentName} · ${wins}胜${draws}平${losses}负 · 总比分${report.goalsFor}:${report.goalsAgainst}`,
      body:`${summary} 邮件内已附逐场数据、双方三阶段战术对照、攻防效率与调整建议。`,
      report,
      payload:{ mirrorBatchJobId:job.id },
    });
    const marketplace = this.state.mirrorMarketplace;
    const receipt = { ...this.mirrorBatchJobView(job), ownerId:job.ownerId, teamId:job.teamId };
    marketplace.batchReceipts = [...(marketplace.batchReceipts ?? []).filter((entry) => entry.id !== job.id), receipt]
      .sort((left, right) => Number(left.completedAt ?? left.createdAt) - Number(right.completedAt ?? right.createdAt))
      .slice(-500);
    marketplace.batchJobs = marketplace.batchJobs.filter((entry) => entry.id !== job.id);
    return report;
  }
  advanceMirrorBatchSimulations(maximumJobs = 1, options = {}) {
    if (this.state.season.status === "active") return false;
    const jobs = this.state.mirrorMarketplace.batchJobs
      .filter((job) => ["queued", "running"].includes(job.status) && (job.executionNode ?? MIRROR_BATCH_CLOUD_NODE) === MIRROR_BATCH_CLOUD_NODE)
      .sort((left, right) => Number(left.createdAt) - Number(right.createdAt));
    if (!jobs.length) return false;
    const maximumChainsPerMatch = Math.max(1, Number(options.maximumChainsPerMatch ?? 4));
    let processed = 0;
    let advanced = false;
    for (const job of jobs) {
      if (processed >= Math.max(1, Number(maximumJobs) || 1)) break;
      job.status = "running";
      const number = Number(job.results?.length ?? 0) + 1;
      if (!job.activeMatch) {
        const seed = `${this.state.season.id}:${job.id}:${number}`;
        const conditions = seededConditions(seed);
        job.activeMatch = createLeagueMatch(unwrapTracked([clone(job.callerSeat), clone(job.opponentSeat)]), {
          now:this.now(),
          seed,
          weather:conditions.weather.key,
          referee:conditions.referee.key,
          regulationOnly:true,
          competitionMode:"friendly",
          recordEvents:false,
          matchEngine:"v2",
        });
        job.activeMatchStartedAt = this.now();
        advanced = true;
      }
      const activeMatch = unwrapTracked(job.activeMatch);
      const before = Number(activeMatch.nextChainIndex ?? 0);
      const advanceAt = Number(job.activeMatchStartedAt ?? this.now()) + REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS + 1;
      advanceLeagueMatch(activeMatch, advanceAt, { maximumChains:maximumChainsPerMatch });
      job.activeMatch = activeMatch;
      advanced = advanced || Number(activeMatch.nextChainIndex ?? 0) > before || Boolean(activeMatch.report);
      if (activeMatch.report) {
        job.results.push(this.mirrorBatchMatchResult(activeMatch, number));
        delete job.activeMatch;
        delete job.activeMatchStartedAt;
        if (job.results.length >= job.totalMatches) this.finalizeMirrorBatchJob(job);
      }
      job.updatedAt = this.now();
      processed += 1;
    }
    if (advanced) this.save({ scopes:["core", "mirrorMarketplace"], skipDailyBackup:true, skipLiveBackupCopy:true });
    return advanced;
  }

  createAiTraining(account, config = {}) {
    const team = this.accountTeam(account.id);
    if (!team) throw new Error("请先加入联赛并保存自己的战术板");
    const tacticalPlans = this.aiTrainingTacticalPlans(config.tacticalPlans);
    const mirrorTeamId = String(config.mirrorTeamId ?? "");
    const mirrorSchemeId = String(config.mirrorSchemeId ?? "") || null;
    let opponentSeat;
    let actualAverageOverall;
    let targetOverall = null;
    let opponentLabel;
    let mirrorCharge = null;
    if (mirrorTeamId) {
      if (this.state.season.status === "active") throw new Error("玩家阵容镜像仅在休赛期开放");
      const mirrorTeam = this.state.teams.find((entry) => entry.id === mirrorTeamId && entry.ownerId);
      if (!mirrorTeam) throw new Error("选择的玩家阵容镜像不存在");
      if (mirrorTeam.ownerId === account.id) throw new Error("不能调用自己的阵容镜像");
      const mirrorKind = String(config.mirrorKind ?? "basic") === "full" ? "full" : "basic";
      mirrorCharge = this.chargeMirrorInvocation(account, mirrorTeam, mirrorKind, mirrorSchemeId);
      opponentLabel = mirrorKind === "full"
        ? `${mirrorTeam.ownerName ?? mirrorTeam.name}完整战术镜像${mirrorCharge.mirrorSchemeName ? ` · ${mirrorCharge.mirrorSchemeName}` : ""}`
        : `${mirrorTeam.ownerName ?? mirrorTeam.name}玩家镜像`;
      const sourceSeat = mirrorKind === "full" ? clone(mirrorCharge.snapshot) : this.aiTrainingPlayerSeat(mirrorTeam);
      opponentSeat = mirrorKind === "full" ? { ...sourceSeat, name:opponentLabel } : {
        ...sourceSeat,
        name:opponentLabel,
        tactic:tacticalPlans.opening.tactic,
        style:tacticalPlans.opening.style,
        tacticalPlans,
        attackFocus:FOCUSES.has(config.attackFocus) ? config.attackFocus : "balanced",
        defenseFocus:FOCUSES.has(config.defenseFocus) ? config.defenseFocus : "balanced",
      };
      const activePlayers = opponentSeat.players.filter((player) => player.active !== false);
      actualAverageOverall = Number((activePlayers.reduce((sum, player) => sum + Number(player.overall ?? 0), 0) / activePlayers.length).toFixed(1));
    } else {
      const formation = String(config.formation ?? "4-3-3");
      const aiSelection = this.aiTrainingPlayers(formation, config.averageOverall);
      const positions = Object.fromEntries(aiSelection.starters.map(({ player, position }) => [player.id, position]));
      const formationLines = deriveFormationLines(aiSelection.starters.map(({ player, position }) => ({ id:player.id, position })));
      opponentLabel = formation;
      actualAverageOverall = aiSelection.averageOverall;
      targetOverall = aiSelection.targetOverall;
      opponentSeat = {
        name:`AI 训练队 · ${formation}`,
        players:[
          ...aiSelection.starters.map(({ player }) => ({ ...player, state:{ fitness:100 }, traits:[], active:true })),
          ...aiSelection.substitutes.map((player) => ({ ...player, state:{ fitness:100 }, traits:[], active:false })),
        ],
        positions,
        positionPresets:Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(positions)])),
        formationLinePresets:Object.fromEntries(POSITION_PRESET_KEYS.map((key) => [key, clone(formationLines)])),
        tactic:tacticalPlans.opening.tactic,
        style:tacticalPlans.opening.style,
        tacticalPlans,
        bondCatalog:[],
        attackFocus:FOCUSES.has(config.attackFocus) ? config.attackFocus : "balanced",
        defenseFocus:FOCUSES.has(config.defenseFocus) ? config.defenseFocus : "balanced",
        preserveFitness:true,
      };
    }
    for (const [code, live] of this.liveAiTrainings) {
      if (live.ownerId === account.id) this.liveAiTrainings.delete(code);
    }
    const startedAt = this.now();
    const code = `YDL-AI-${makeId("TRAINING", account.id)}`.toUpperCase();
    const conditions = seededConditions(`${this.state.season.id}:${code}`);
    let match;
    try {
      match = createLeagueMatch(unwrapTracked([this.aiTrainingPlayerSeat(team), opponentSeat]), {
        now:startedAt,
        seed:`${this.state.season.id}:${code}`,
        weather:conditions.weather.key,
        referee:conditions.referee.key,
        regulationOnly:true,
        competitionMode:"friendly",
        recordEvents:this.recordMatchEvents !== false,
        matchEngine:"v2",
      });
      match.stadium = this.clubBroadcastVenue(team);
    } catch (error) {
      if (mirrorCharge) this.refundMirrorInvocation(account, this.state.teams.find((entry) => entry.id === mirrorTeamId), mirrorCharge);
      throw error;
    }
    const spectatorToken = makeId("training-viewer", account.id);
    const live = { code, ownerId:account.id, round:"AI 对战", match, spectators:{ [spectatorToken]:{ name:account.name ?? team.ownerName ?? "玩家", lastSeenAt:startedAt } }, startedAt, aiTraining:true, actualAverageOverall, targetOverall, formation:opponentLabel, mirrorTeamId:mirrorTeamId || null, mirrorKind:mirrorCharge?.kind ?? null, mirrorSchemeId:mirrorCharge?.mirrorSchemeId ?? null };
    this.liveAiTrainings.set(code, live);
    if (mirrorCharge) this.save({ scopes:["core", "mirrorMarketplace"], skipDailyBackup:true });
    return { spectatorToken, broadcast:this.broadcastView(live), actualAverageOverall, targetOverall, walletBalance:this.wallet(account.id).balance, mirrorCharge:mirrorCharge ? { kind:mirrorCharge.kind, price:mirrorCharge.price } : null };
  }

  endAiTraining(account, codeValue) {
    const code = String(codeValue ?? "").toUpperCase();
    const live = this.liveAiTrainings.get(code);
    if (!live || live.ownerId !== account.id) throw new Error("这场 AI 对战已经结束");
    this.liveAiTrainings.delete(code);
    return { ended:true };
  }

  advanceAiTrainings(now = this.now(), options = {}) {
    for (const [code, live] of this.liveAiTrainings) {
      if (now - live.startedAt > AI_TRAINING_MAX_AGE_MS) this.liveAiTrainings.delete(code);
    }
    const pending = [...this.liveAiTrainings.values()].filter((live) => !live.match.report);
    if (!pending.length) return false;
    const maximumMatches = Math.max(1, Math.min(pending.length, Number(options.maximumMatches ?? 1)));
    const start = Number(this.liveAdvanceCursors.aiTraining ?? 0) % pending.length;
    let advanced = false;
    for (let index = 0; index < maximumMatches; index += 1) {
      const live = pending[(start + index) % pending.length];
      const before = Number(live.match.nextChainIndex ?? 0);
      advanceLeagueMatch(live.match, now, { maximumChains:options.maximumChainsPerMatch ?? 1 });
      advanced = advanced || Number(live.match.nextChainIndex ?? 0) > before || Boolean(live.match.report);
    }
    this.liveAdvanceCursors.aiTraining = (start + maximumMatches) % pending.length;
    return advanced;
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

  friendlyInvitationMutationView(account, options = {}) {
    const team = this.accountTeam(account.id);
    const result = {
      compact:true,
      updatedAt:this.state.updatedAt,
      serverTime:this.now(),
      friendlyInvitations:this.state.friendlyInvitations.filter((item) => item.fromOwnerId === account.id || item.toOwnerId === account.id).map((item) => this.friendlyInvitationView(item)),
      inboxUnreadCount:team ? (this.state.inbox[team.id] ?? []).filter((message) => !message.readAt).length : 0,
    };
    if (options.inbox && team) result.inbox = this.inbox(team);
    if (options.schedule && team) result.schedule = { fixtures:this.teamSchedule(team.id) };
    return clone(result);
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
    const inSeason = this.state.season.status === "active";
    const minuteMarks = inSeason ? IN_SEASON_FRIENDLY_MINUTE_MARKS : OFFSEASON_FRIENDLY_MINUTE_MARKS;
    const teamIntervalMs = inSeason ? IN_SEASON_FRIENDLY_TEAM_INTERVAL_MS : OFFSEASON_FRIENDLY_TEAM_INTERVAL_MS;
    let startsAt = nextFriendlySlot(this.now(), minuteMarks);
    const conflicts = () => this.state.friendlyFixtures.some((fixture) => {
      if (!teamIds.some((teamId) => [fixture.homeId, fixture.awayId].includes(teamId))) return false;
      return Math.abs(Number(fixture.startsAt) - startsAt) < teamIntervalMs;
    });
    while (conflicts()) startsAt = nextFriendlySlot(startsAt, minuteMarks);
    return startsAt;
  }

  resolveFriendlyInvitation(account, invitationIdValue, actionValue, options = {}) {
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
        const injuryNotice = this.state.season.status === "completed" ? "比赛仍会正常判定受伤和伤退，但不会形成正式伤停。" : "受伤仍会正常形成伤停。";
        this.pushInbox(team, { id:`friendly-scheduled:${fixture.id}:${team.id}`, type:"friendly", title:participant ? "友谊赛已经排定" : "全服友谊赛直播预告", summary:`${fromTeam.name} vs ${toTeam.name}，${timeText}开赛。`, body:participant ? `比赛将以100体力开赛，不消耗体力且红黄牌不计入正式赛事；${injuryNotice}` : "比赛开始后欢迎前往电视台观看直播。", payload:{ friendlyFixtureId:fixture.id, startsAt, homeTeamId:fromTeam.id, awayTeamId:toTeam.id } });
      });
    }
    this.save({ scopes:["core", "inbox"], skipDailyBackup:true });
    return options.compact
      ? this.friendlyInvitationMutationView(account, { inbox:true, schedule:action === "accept" })
      : this.view(account);
  }

  startScheduledFriendlies(now = this.now()) {
    let changed = false;
    this.state.friendlyFixtures.filter((fixture) => fixture.status === "scheduled" && fixture.startsAt <= now).forEach((fixture) => {
      fixture.offseason = this.state.season.status === "completed";
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
    const offseason = fixture.offseason ?? this.state.season.status === "completed";
    if (!offseason) {
      [home, away].forEach((team, index) => report.teams[index].players.forEach((player) => {
        if (!player.injury || !team.playerState[player.id]) return;
        team.playerState[player.id].injuryRounds = Math.max(Number(team.playerState[player.id].injuryRounds ?? 0), injuryAbsenceMatches(player));
      }));
    }
    return record;
  }

  liveAdvanceBatch(entries, key, maximumMatches = Infinity) {
    const pending = entries.filter((entry) => !entry.completed && !entry.settlementPending);
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
    this.liveAdvanceBatch(this.state.liveFriendlies, "friendly", options.maximumMatches).forEach((live) => {
      const before = Number(live.match.nextChainIndex ?? 0);
      advanceLeagueMatch(live.match, now, { maximumChains:options.maximumChainsPerMatch });
      const didAdvance = Number(live.match.nextChainIndex ?? 0) > before;
      advanced = advanced || didAdvance;
      if (!live.match.report) {
        if (didAdvance && options.persist !== false) this.persistLiveMatch(live, now);
        return;
      }
      if (options.persist !== false) this.persistLiveMatch(live, now, true);
      advanced = this.queueLiveSettlement(live, () => {
        const fixture = this.state.friendlyFixtures.find((item) => item.id === live.fixtureId);
        this.finalizeFriendlyFixture(fixture, live.match);
        live.completed = true;
        delete live.settlementPending;
        this.state.completedBroadcasts.push({ code:live.code, round:"友谊赛", matchId:fixture.matchId, completedAt:this.now(), spectators:clone(live.spectators ?? {}), match:publicLeagueMatch(live.match, this.now(), null, true), competition:"YDL友谊赛" });
        this.state.liveFriendlies = this.state.liveFriendlies.filter((entry) => !entry.completed);
        if (!this.scheduleLiveSettlementSave([live.code])) this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
      }) || advanced;
    });
    if (changed) this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    return changed || advanced;
  }

  finalizeFixture(fixture, roundNumber, match) {
    const home = this.state.teams.find((team) => team.id === fixture.homeId);
    const away = this.state.teams.find((team) => team.id === fixture.awayId);
    const report = match.report;
    const id = `${this.state.season.id}-R${roundNumber}-${home.id}-${away.id}`;
    const record = { id, round:roundNumber, playedAt:this.now(), homeId:home.id, awayId:away.id, homeName:home.name, awayName:away.name, score:[...report.score], formations:report.teams.map((team) => team.formation), autoRotations:clone(match.leagueAutoRotations ?? [[], []]), report };
    this.state.matches.push(record);
    this.settleHomeTicketIncome(record);
    this.rollClubSponsorOffersAfterMatch(record);
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
        const stat = this.state.playerStats[key] ?? { key, playerId:player.id, playerName:player.name, teamId:team.id, teamName:team.name, appearances:0, goals:0, assists:0, saves:0, tackles:0, interceptions:0, clearances:0, blocks:0, pressuresWon:0, penaltiesWon:0, yellowCards:0, redCards:0, ratingTotal:0 };
        const penaltiesWon = (report.importantEvents ?? []).filter((entry) => entry.type === "penaltyAwarded" && entry.opponentId === player.id).length;
        stat.appearances += 1; stat.goals += player.stats.goals; stat.assists += player.stats.assists; stat.saves += player.stats.saves; stat.tackles = Number(stat.tackles ?? 0) + Number(player.stats.tackles ?? 0); stat.interceptions = Number(stat.interceptions ?? 0) + Number(player.stats.interceptions ?? 0); stat.clearances = Number(stat.clearances ?? 0) + Number(player.stats.clearances ?? 0); stat.blocks = Number(stat.blocks ?? 0) + Number(player.stats.blocks ?? 0); stat.pressuresWon = Number(stat.pressuresWon ?? 0) + Number(player.stats.pressuresWon ?? 0); stat.penaltiesWon = Number(stat.penaltiesWon ?? 0) + penaltiesWon; stat.yellowCards += player.stats.yellowCards; stat.redCards += player.stats.redCards; stat.ratingTotal += player.rating;
        this.state.playerStats[key] = stat;
        if (isXPlayer(REAL_PLAYER_BY_ID[player.id])) this.settleXGrowthTasks(player.id);
        if (team.ownerId && team.playerState[player.id]) {
          const state = team.playerState[player.id];
          const beforeMatch = Number(state.fitness ?? 100);
          const engineFitness = Number(player.fitness ?? beforeMatch);
          const matchDrain = Math.max(0, beforeMatch - engineFitness);
          const drainFactor = player.role === "GK" ? LEAGUE_FITNESS_DRAIN_FACTOR * GOALKEEPER_FITNESS_DRAIN_FACTOR : LEAGUE_FITNESS_DRAIN_FACTOR;
          state.fitness = Math.max(35, Math.min(100, Number((beforeMatch - matchDrain * drainFactor).toFixed(1))));
          if (player.stats.redCards) state.suspension = Math.max(state.suspension ?? 0, 1);
          if (player.stats.redCards) this.roundNewUnavailable?.add(`${team.id}:${player.id}:suspension`);
          if (player.injury) {
            state.injuryRounds = Math.max(state.injuryRounds ?? 0, injuryAbsenceMatches(player));
            this.roundNewUnavailable?.add(`${team.id}:${player.id}:injury`);
          }
        }
      });
      this.recoverUnusedPlayers(team, playedPlayerIds);
      const chemistryPlayers = report.teams[index].players.filter((player) => !player.substitutedOut);
      const chemistryLineup = chemistryPlayers.map((player) => REAL_PLAYER_BY_ID[player.id]).filter(Boolean);
      const chemistryPositions = Object.fromEntries(chemistryPlayers.map((player) => [player.id, player.position]));
      this.recordChemistry(team, chemistryLineup, chemistryPositions);
      team.fitnessUpdatedAt = this.now();
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
    this.settleHomeTicketIncome(record);
    this.rollClubSponsorOffersAfterMatch(record);
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
        const stat = cup.playerStats[key] ?? { key, playerId:player.id, playerName:player.name, teamId:team.id, teamName:team.name, appearances:0, goals:0, assists:0, saves:0, tackles:0, interceptions:0, clearances:0, blocks:0, pressuresWon:0, penaltiesWon:0, yellowCards:0, redCards:0, ratingTotal:0 };
        const penaltiesWon = (report.importantEvents ?? []).filter((entry) => entry.type === "penaltyAwarded" && entry.opponentId === player.id).length;
        stat.appearances += 1; stat.goals += player.stats.goals; stat.assists += player.stats.assists; stat.saves += player.stats.saves; stat.tackles = Number(stat.tackles ?? 0) + Number(player.stats.tackles ?? 0); stat.interceptions = Number(stat.interceptions ?? 0) + Number(player.stats.interceptions ?? 0); stat.clearances = Number(stat.clearances ?? 0) + Number(player.stats.clearances ?? 0); stat.blocks = Number(stat.blocks ?? 0) + Number(player.stats.blocks ?? 0); stat.pressuresWon = Number(stat.pressuresWon ?? 0) + Number(player.stats.pressuresWon ?? 0); stat.penaltiesWon = Number(stat.penaltiesWon ?? 0) + penaltiesWon; stat.yellowCards += player.stats.yellowCards; stat.redCards += player.stats.redCards; stat.ratingTotal += player.rating;
        cup.playerStats[key] = stat;
        if (isXPlayer(REAL_PLAYER_BY_ID[player.id])) this.settleXGrowthTasks(player.id);
        if (team.ownerId && team.playerState[player.id]) {
          const state = team.playerState[player.id];
          const beforeMatch = Number(state.fitness ?? 100);
          const drain = Math.max(0, beforeMatch - Number(player.fitness ?? beforeMatch));
          const drainFactor = player.role === "GK" ? LEAGUE_FITNESS_DRAIN_FACTOR * GOALKEEPER_FITNESS_DRAIN_FACTOR : LEAGUE_FITNESS_DRAIN_FACTOR;
          state.fitness = Math.max(35, Math.min(100, Number((beforeMatch - drain * drainFactor).toFixed(1))));
          if (player.stats.redCards) state.cupSuspension = Math.max(state.cupSuspension ?? 0, 1);
          if (player.stats.redCards) { this.cupNewUnavailable ??= new Set(); this.cupNewUnavailable.add(`${team.id}:${player.id}:suspension`); }
          if (player.injury) {
            state.injuryRounds = Math.max(state.injuryRounds ?? 0, injuryAbsenceMatches(player));
            this.cupNewUnavailable ??= new Set();
            this.cupNewUnavailable.add(`${team.id}:${player.id}:injury`);
          }
        }
      });
      this.recoverUnusedPlayers(team, playedPlayerIds);
      const chemistryPlayers = report.teams[index].players.filter((player) => !player.substitutedOut);
      this.recordChemistry(team, chemistryPlayers.map((player) => REAL_PLAYER_BY_ID[player.id]).filter(Boolean), Object.fromEntries(chemistryPlayers.map((player) => [player.id, player.position])));
      team.fitnessUpdatedAt = this.now();
    });
    if (["league", "swiss"].includes(event.stage)) {
      [home, away].forEach((team, index) => {
        const table = cup.table[team.id]; const own = report.score[index]; const against = report.score[index === 0 ? 1 : 0];
        table.played += 1; table.goalsFor += own; table.goalsAgainst += against;
        const won = fixture.winnerId === team.id;
        if (won) { table.won += 1; table.points += 3; }
        else if (fixture.winnerId) table.lost += 1;
        else { table.drawn += 1; table.points += 1; }
        if (event.stage === "swiss") {
          if (table.won >= 3) table.status = "qualified";
          if (table.lost >= 3) table.status = "eliminated";
        }
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
      const stageLabel = ["league", "swiss"].includes(event.stage) ? `${event.stage === "league" ? "联赛阶段" : "瑞士轮"}第${event.round}轮` : `${CUP_STAGE_NAMES[event.stage] ?? event.stage} · 第${event.leg}回合`;
      const rank = this.standings().find((entry) => entry.id === team.id)?.rank ?? TEAM_COUNT;
      const injured = team.rosterIds.filter((id) => Number(team.playerState[id]?.injuryRounds ?? 0) > 0).map((id) => ({ id, name:REAL_PLAYER_BY_ID[id].name, rounds:team.playerState[id].injuryRounds }));
      const suspended = team.rosterIds.filter((id) => Number(team.playerState[id]?.cupSuspension ?? 0) > 0).map((id) => ({ id, name:REAL_PLAYER_BY_ID[id].name, rounds:team.playerState[id].cupSuspension }));
      const next = this.nextOpponent(team.id);
      const homeTicketIncome = this.homeTicketIncomeSummary(team, record);
      this.pushInbox(team, {
        id:`cup-matchweek:${this.state.season.id}:${event.id}:${record.id}:${team.id}`,
        type:"matchweek",
        title:`黄狗冠军杯 · ${stageLabel}战报`,
        summary:`${team.name} ${ownScore}:${opponentScore} ${opponent.name}，本场${resultText}。${homeTicketIncome ? ` 主场门票收入${homeTicketIncome.amount.toLocaleString("zh-CN")}金币。` : ""}`,
        body:`黄狗冠军杯${stageLabel}结束。${homeTicketIncome ? `本场共有${homeTicketIncome.attendance.toLocaleString("zh-CN")}名观众入场，门票收入${homeTicketIncome.amount.toLocaleString("zh-CN")}金币。` : ""}${next ? `下一场为${next.competitionName} ${next.label}，对阵 ${next.name}。` : "当前没有已确定的后续比赛。"}`,
        round:event.round,
        matchId:record.id,
        payload:{ results:[this.matchSummary(record)], rank, points:team.table.points, injured, suspended, next, autoRotations:record.autoRotations?.[ownIndex] ?? [], competition:"cup", stage:event.stage, leg:event.leg, homeTicketIncome },
      });
    });
  }

  cupEventFixtures(event) {
    if (event.stage === "league") return this.state.cup.leagueRounds.find((round) => round.number === event.round)?.fixtures ?? [];
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
    cup.events.push({ id:`cup-${stage}-leg1`, stage, round:stage === "quarterfinals" ? 10 : stage === "semifinals" ? 11 : 12, leg:1, status:"pending", fixtureIds:ties.map((tie) => tie.legs[0].id) });
    return ties;
  }

  completeCupEvent(event) {
    if (event.transitionedAt) return;
    const alreadySettled = event.status === "complete";
    const cup = this.state.cup;
    if (event.stage === "final") cup.finalStartedAt ??= this.cupFinalStartedAt();
    if (!alreadySettled) this.advanceCupAvailability();
    const predictionLabel = ["league", "swiss"].includes(event.stage)
      ? `黄狗冠军杯${event.stage === "league" ? "联赛阶段" : "瑞士轮"}第${event.round}轮`
      : `黄狗冠军杯${CUP_STAGE_NAMES[event.stage] ?? event.stage}${event.stage === "final" ? "" : `第${event.leg}回合`}`;
    this.distributePredictionProfit("cup", event.id, predictionLabel);
    if (event.stage === "league") {
      const round = cup.leagueRounds.find((entry) => entry.number === event.round);
      round.status = "complete";
      if (event.round === TEAM_COUNT - 1) {
        const qualified = this.cupStandings().slice(0, 8);
        const qualifiedSet = new Set(qualified.map((entry) => entry.id));
        Object.entries(cup.table).forEach(([teamId, table]) => { table.status = qualifiedSet.has(teamId) ? "qualified" : "eliminated"; });
        qualified.forEach((entry) => this.grantCupLeagueQualificationReward(entry.id, entry.rank));
        const ids = qualified.map((entry) => entry.id);
        this.createKnockoutStage("quarterfinals", [ids[0], ids[7], ids[3], ids[4], ids[2], ids[5], ids[1], ids[6]]);
        cup.stage = "quarterfinals";
      }
    } else if (event.stage === "swiss") {
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
          const championId = winners[0];
          const runnerUpId = ties[0]?.teams?.find((teamId) => teamId !== championId) ?? null;
          this.grantCupReward(championId, event, "champion");
          if (runnerUpId) this.grantCupReward(runnerUpId, event, "runnerUp");
          cup.status = "completed"; cup.stage = "completed"; cup.championId = championId; cup.completedAt = this.now();
          this.settleBallonDor();
          this.ensureSeasonFinalTournament();
        }
      }
    }
    event.status = "complete";
    event.transitionedAt = this.now();
    if (cup.status === "completed") {
      cup.nextRoundAt = null;
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
    const startedAt = this.now();
    event.status = "running";
    event.startedAt = startedAt;
    if (event.stage === "final") cup.finalStartedAt = startedAt;
    this.cupNewUnavailable = new Set();
    const fixtures = this.cupEventFixtures(event);
    const liveMatches = [];
    fixtures.forEach((fixture, index) => {
      const tie = ["league", "swiss"].includes(event.stage) ? null : cup.knockout[event.stage].find((entry) => entry.legs.includes(fixture));
      const firstLeg = tie?.legs[0];
      const aggregateBaseScore = event.leg === 2 && firstLeg ? [firstLeg.score[1], firstLeg.score[0]] : null;
      const created = measureRuntimeSync("league.cup.createFixtureMatch", () => this.createFixtureMatch(fixture, event.round, startedAt, { seed:`${this.state.season.id}:${event.id}:${fixture.id}`, competitionMode:"cup", legNumber:event.leg, allowSuperStorm:["league", "swiss"].includes(event.stage), regulationOnly:event.stage === "league" ? true : event.stage === "swiss" || event.stage === "final" ? false : event.leg === 1, aggregateBaseScore }));
      if (created.home.ownerId || created.away.ownerId) liveMatches.push({ code:`YDL-CUP-${this.state.season.name}-${event.stage}-${event.leg}-M${index + 1}`, round:event.round, fixtureId:fixture.id, match:created.match, spectators:{} });
      else {
        measureRuntimeSync("league.cup.settleAutomatedMatch", () => settleAutomatedMatch(created.match, created.startedAt));
        measureRuntimeSync("league.cup.finalizeFixture", () => this.finalizeCupFixture(fixture, event, created.match));
      }
    });
    if (!liveMatches.length) { this.completeCupEvent(event); this.save(); return true; }
    this.state.liveCupRound = { eventId:event.id, startedAt, matches:liveMatches, newUnavailable:[...this.cupNewUnavailable] };
    this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    return true;
  }

  simulatePendingCupEvent() {
    const cup = this.state.cup;
    if (cup.status !== "active" || this.state.liveCupRound) return null;
    const event = cup.events.find((entry) => entry.status === "pending");
    if (!event) return null;
    const startedAt = this.now();
    event.status = "running";
    event.startedAt = startedAt;
    if (event.stage === "final") cup.finalStartedAt = startedAt;
    this.cupNewUnavailable = new Set();
    this.cupEventFixtures(event).forEach((fixture) => {
      const tie = ["league", "swiss"].includes(event.stage) ? null : cup.knockout[event.stage].find((entry) => entry.legs.includes(fixture));
      const firstLeg = tie?.legs[0];
      const aggregateBaseScore = event.leg === 2 && firstLeg ? [firstLeg.score[1], firstLeg.score[0]] : null;
      const created = this.createFixtureMatch(fixture, event.round, startedAt, {
        seed:`${this.state.season.id}:${event.id}:${fixture.id}`,
        competitionMode:"cup",
        legNumber:event.leg,
        allowSuperStorm:["league", "swiss"].includes(event.stage),
        regulationOnly:event.stage === "league" ? true : event.stage === "swiss" || event.stage === "final" ? false : event.leg === 1,
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
    this.cupNewUnavailable = new Set(liveRound.newUnavailable ?? []);
    for (const live of liveRound.matches.filter((entry) => entry.completed && entry.match?.report)) {
      const fixture = this.cupEventFixtures(event).find((entry) => entry.id === live.fixtureId);
      const teams = [fixture?.homeId, fixture?.awayId];
      live.match.report.teams.forEach((reportTeam, teamIndex) => reportTeam.players.forEach((player) => {
        if (player.stats?.redCards) this.cupNewUnavailable.add(`${teams[teamIndex]}:${player.id}:suspension`);
        if (player.injury) this.cupNewUnavailable.add(`${teams[teamIndex]}:${player.id}:injury`);
      }));
    }
    let advanced = false;
    for (const live of this.liveAdvanceBatch(liveRound.matches, "cup", options.maximumMatches)) {
      const before = Number(live.match.nextChainIndex ?? 0);
      advanceLeagueMatch(live.match, now, { maximumChains:options.maximumChainsPerMatch });
      const didAdvance = Number(live.match.nextChainIndex ?? 0) > before;
      advanced = advanced || didAdvance;
      if (live.match.report) {
        if (options.persist !== false) this.persistLiveMatch(live, now, true);
        advanced = this.queueLiveSettlement(live, () => {
          const currentLiveRound = this.state.liveCupRound;
          const currentEvent = this.state.cup.events.find((entry) => entry.id === currentLiveRound?.eventId);
          if (!currentLiveRound || !currentEvent) { delete live.settlementPending; return; }
          this.cupNewUnavailable = new Set(currentLiveRound.newUnavailable ?? []);
          const fixture = this.cupEventFixtures(currentEvent).find((entry) => entry.id === live.fixtureId);
          this.finalizeCupFixture(fixture, currentEvent, live.match);
          live.completed = true;
          delete live.settlementPending;
          currentLiveRound.newUnavailable = [...this.cupNewUnavailable];
          if (currentLiveRound.matches.every((entry) => entry.completed)) {
            const completedCodes = currentLiveRound.matches.map((entry) => entry.code);
            this.archiveCompletedBroadcasts({ roundNumber:currentEvent.round, matches:currentLiveRound.matches });
            this.completeCupEvent(currentEvent);
            this.state.liveCupRound = null;
            if (!this.scheduleLiveSettlementSave(completedCodes)) this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
          }
        }) || advanced;
      } else if (didAdvance && options.persist !== false) this.persistLiveMatch(live, now);
    }
    liveRound.newUnavailable = [...this.cupNewUnavailable];
    return advanced;
  }

  advanceLiveSeasonFinalRound(now = this.now(), options = {}) {
    if (this.seasonCompetitionDayExpired(now)) {
      const changed = this.cancelExpiredSeasonFinal(now);
      if (changed && options.persist !== false) this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
      return changed;
    }
    const liveRound = this.state.liveSeasonFinalRound;
    if (!liveRound) return false;
    const tournament = this.state.seasonFinalTournament;
    if (!tournament) return false;
    this.cupNewUnavailable = new Set(liveRound.newUnavailable ?? []);
    let advanced = false;
    for (const live of this.liveAdvanceBatch(liveRound.matches, "season-final", options.maximumMatches)) {
      const node = tournament.bracket.find((entry) => entry.id === live.nodeId);
      if (!node || !live?.match) continue;
      const before = Number(live.match.nextChainIndex ?? 0);
      advanceLeagueMatch(live.match, now, { maximumChains:options.maximumChainsPerMatch });
      const didAdvance = Number(live.match.nextChainIndex ?? 0) > before;
      advanced = advanced || didAdvance;
      if (live.match.report) {
        if (options.persist !== false) this.persistLiveMatch(live, now, true);
        advanced = this.queueLiveSettlement(live, () => {
          const currentLiveRound = this.state.liveSeasonFinalRound;
          const currentTournament = this.state.seasonFinalTournament;
          const currentNode = currentTournament?.bracket.find((entry) => entry.id === live.nodeId);
          if (!currentLiveRound || !currentTournament || !currentNode) { delete live.settlementPending; return; }
          this.cupNewUnavailable = new Set(currentLiveRound.newUnavailable ?? []);
          const record = this.completeSeasonFinalNode(currentNode, live.match, currentTournament, { deferAvailability:true });
          live.matchId = record?.id ?? null;
          live.completed = true;
          delete live.settlementPending;
          currentLiveRound.newUnavailable = [...this.cupNewUnavailable];
          if (currentLiveRound.matches.every((entry) => entry.completed)) {
            const completedCodes = currentLiveRound.matches.map((entry) => entry.code);
            this.archiveCompletedBroadcasts({ roundNumber:`赛季总决赛 ${currentLiveRound.matches.map((entry) => entry.nodeId).join("/")}`, matches:currentLiveRound.matches });
            this.advanceSeasonFinalAvailability();
            this.state.liveSeasonFinalRound = null;
            if (!this.scheduleLiveSettlementSave(completedCodes)) this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
          }
        }) || advanced;
      } else if (didAdvance && options.persist !== false) this.persistLiveMatch(live, now);
    }
    liveRound.newUnavailable = [...this.cupNewUnavailable];
    return advanced;
  }

  recoverUnusedPlayers(team, playedPlayerIds) {
    if (!team?.ownerId) return;
    team.rosterIds.forEach((id) => {
      if (playedPlayerIds.has(id)) return;
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 });
      state.fitness = Math.min(100, Number(state.fitness ?? 100) + 18);
    });
  }

  advanceAvailability() {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => team.rosterIds.forEach((id) => {
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 });
      if (!this.roundNewUnavailable?.has(`${team.id}:${id}:suspension`)) state.suspension = Math.max(0, Number(state.suspension ?? 0) - 1);
      if (!this.roundNewUnavailable?.has(`${team.id}:${id}:injury`)) state.injuryRounds = Math.max(0, Number(state.injuryRounds ?? 0) - 1);
    }));
  }

  advanceCupAvailability() {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => team.rosterIds.forEach((id) => {
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 });
      const legacyKey = `${team.id}:${id}`;
      if (!this.cupNewUnavailable?.has(legacyKey) && !this.cupNewUnavailable?.has(`${legacyKey}:suspension`)) state.cupSuspension = Math.max(0, Number(state.cupSuspension ?? 0) - 1);
      if (!this.cupNewUnavailable?.has(`${legacyKey}:injury`)) state.injuryRounds = Math.max(0, Number(state.injuryRounds ?? 0) - 1);
    }));
    this.cupNewUnavailable = null;
  }

  advanceSeasonFinalAvailability() {
    this.state.teams.filter((team) => team.ownerId).forEach((team) => team.rosterIds.forEach((id) => {
      const state = team.playerState[id] ?? (team.playerState[id] = { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 });
      const legacyKey = `${team.id}:${id}`;
      if (!this.cupNewUnavailable?.has(`${legacyKey}:suspension`)) state.seasonFinalSuspension = Math.max(0, Number(state.seasonFinalSuspension ?? 0) - 1);
      if (!this.cupNewUnavailable?.has(`${legacyKey}:injury`)) state.injuryRounds = Math.max(0, Number(state.injuryRounds ?? 0) - 1);
    }));
    this.cupNewUnavailable = null;
  }

  payRewards(roundNumber) {
    this.ensureDisciplineState();
    const packRewardEnabled = Number(this.state.season.startedAt ?? 0) >= S4_LEAGUE_ROUND_PACK_REWARD_START_AT;
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      const match = this.state.matches.find((entry) => entry.round === roundNumber
        && (!entry.competition || entry.competition === "league")
        && (entry.homeId === team.id || entry.awayId === team.id));
      if (match?.homeId === team.id) this.settleHomeTicketIncome(match);
      const disciplineGrantId = `league-round-reward:${this.state.season.id}:${roundNumber}`;
      const previouslyWithheld = this.state.discipline.withheldRewards.some((entry) => entry.accountId === team.ownerId && entry.grantId === disciplineGrantId);
      if (this.rewardsSuspended(team.ownerId) || previouslyWithheld) {
        if (!previouslyWithheld) this.withholdReward(team.ownerId, "league", disciplineGrantId, { round:roundNumber, rewardType:"round" });
        return;
      }
      const coinRewarded = this.state.ledger.some((entry) => entry.type === "league-match-reward" && entry.accountId === team.ownerId && entry.seasonId === this.state.season.id && entry.round === roundNumber);
      const packRewarded = this.state.ledger.some((entry) => entry.type === "league-round-pack-reward" && entry.accountId === team.ownerId && entry.seasonId === this.state.season.id && entry.round === roundNumber);
      if (coinRewarded && (!packRewardEnabled || packRewarded)) return;
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

  grantCupLeagueQualificationReward(teamId, rankValue) {
    this.ensureDisciplineState();
    const team = this.state.teams.find((entry) => entry.id === teamId);
    const rank = Math.max(1, Math.min(8, Number(rankValue) || 8));
    if (!team?.ownerId) return null;
    const grantId = `cup-league-qualification:${this.state.season.id}`;
    const disciplineGrantId = `cup-reward:${grantId}`;
    const previouslyWithheld = this.state.discipline.withheldRewards.some((entry) => entry.accountId === team.ownerId && entry.grantId === disciplineGrantId);
    if (this.rewardsSuspended(team.ownerId) || previouslyWithheld) {
      if (!previouslyWithheld) this.withholdReward(team.ownerId, "cup", disciplineGrantId, { round:9, stage:"league", rewardType:"qualification", rank });
      return null;
    }
    const existing = this.state.ledger.find((entry) => entry.type === "cup-coin-reward" && entry.accountId === team.ownerId && entry.grantId === grantId);
    if (existing) return existing;
    const amount = rank <= 4 ? CUP_LEAGUE_TOP_FOUR_COINS : CUP_LEAGUE_LOWER_QUALIFIER_COINS;
    const items = this.grantS4Pack(team.ownerId, CUP_LEAGUE_QUALIFIER_PACK_TYPE, CUP_LEAGUE_QUALIFIER_PACK_QUANTITY, { source:"cup-league-qualification", grantId });
    this.wallet(team.ownerId).balance += amount;
    const ledgerEntry = {
      id:makeId("ledger", `${team.id}-${grantId}`),
      accountId:team.ownerId,
      amount,
      type:"cup-coin-reward",
      grantId,
      competition:"cup",
      stage:"league",
      award:"qualification",
      rank,
      packType:CUP_LEAGUE_QUALIFIER_PACK_TYPE,
      quantity:CUP_LEAGUE_QUALIFIER_PACK_QUANTITY,
      packIds:items.map((item) => item.id),
      round:9,
      createdAt:this.now(),
    };
    this.state.ledger.push(ledgerEntry);
    this.pushInbox(team, {
      id:`cup-reward:${this.state.season.id}:league-qualification:${team.id}`,
      type:"reward",
      title:"黄狗冠军杯八强奖励已送达",
      summary:`联赛阶段第${rank}名，获得${amount.toLocaleString("zh-CN")}金币和${CUP_LEAGUE_QUALIFIER_PACK_QUANTITY}个传奇随机卡包。`,
      body:`黄狗冠军杯9轮联赛阶段已经结束，你以第${rank}名晋级八强。${amount.toLocaleString("zh-CN")}金币和${CUP_LEAGUE_QUALIFIER_PACK_QUANTITY}个传奇随机卡包已经发放到球队账户。冠亚军礼包将在决赛结束后自动发放。`,
      round:9,
      payload:{ amount, competition:"cup", stage:"league", award:"qualification", rank, grantId, packType:CUP_LEAGUE_QUALIFIER_PACK_TYPE, quantity:CUP_LEAGUE_QUALIFIER_PACK_QUANTITY, packIds:items.map((item) => item.id) },
    });
    return ledgerEntry;
  }

  grantCupReward(teamId, event, kind) {
    this.ensureDisciplineState();
    const team = this.state.teams.find((entry) => entry.id === teamId);
    const advanceReward = kind === "advance" && ["quarterfinals", "semifinals"].includes(event.stage);
    const finalPackType = event.stage === "final" ? FINAL_PLACEMENT_REWARD_PACK_TYPES[kind] ?? null : null;
    if (!team?.ownerId || (!advanceReward && !finalPackType)) return null;
    const awardKey = finalPackType ? `${this.state.season.id}:${event.id}:${kind}` : `${event.id}:${kind}`;
    const disciplineGrantId = finalPackType ? `cup-reward:${awardKey}` : `cup-reward:${this.state.season.id}:${awardKey}`;
    const previouslyWithheld = this.state.discipline.withheldRewards.some((entry) => entry.accountId === team.ownerId && entry.grantId === disciplineGrantId);
    if (this.rewardsSuspended(team.ownerId) || previouslyWithheld) {
      if (!previouslyWithheld) this.withholdReward(team.ownerId, "cup", disciplineGrantId, { round:event.round, stage:event.stage, rewardType:kind });
      return null;
    }
    if (this.state.ledger.some((entry) => entry.type === "cup-pack-reward" && entry.accountId === team.ownerId && entry.grantId === awardKey)) return null;
    const packType = finalPackType ?? CUP_ADVANCE_PACK_TYPE;
    const quantity = finalPackType ? 1 : CUP_ADVANCE_PACK_QUANTITY;
    const items = this.grantS4Pack(team.ownerId, packType, quantity, { source:finalPackType ? "cup-final" : "cup", grantId:awardKey });
    const ledgerEntry = {
      id:makeId("ledger", `${team.id}-${awardKey}`),
      accountId:team.ownerId,
      amount:0,
      type:"cup-pack-reward",
      grantId:awardKey,
      competition:"cup",
      stage:event.stage,
      award:kind,
      packType,
      quantity,
      packIds:items.map((item) => item.id),
      round:event.round,
      createdAt:this.now(),
    };
    this.state.ledger.push(ledgerEntry);
    if (finalPackType) {
      const placementName = kind === "champion" ? "冠军" : "亚军";
      const pack = S4_PACK_BY_ID[packType];
      this.pushInbox(team, {
        id:`cup-reward:${awardKey}:${team.id}`,
        type:"reward",
        title:`黄狗冠军杯${placementName}奖励已送达`,
        summary:`获得1份${pack.name}。`,
        body:`恭喜获得本届黄狗冠军杯${placementName}。1份${pack.name}已经发放到礼包背包，可以随时开启。`,
        round:event.round,
        payload:{ amount:0, competition:"cup", stage:"final", award:kind, grantId:awardKey, packType, quantity, packIds:items.map((item) => item.id) },
      });
      return ledgerEntry;
    }
    const stageName = CUP_STAGE_NAMES[event.stage] ?? "决赛";
    this.pushInbox(team, {
      id:`cup-reward:${this.state.season.id}:${awardKey}:${team.id}`,
      type:"reward",
      title:`黄狗冠军杯${stageName}晋级奖励已送达`,
      summary:`获得 ${CUP_ADVANCE_PACK_QUANTITY} 个公共池随机礼包。`,
      body:`恭喜晋级黄狗冠军杯${stageName === "四分之一决赛" ? "半决赛" : "决赛"}，${CUP_ADVANCE_PACK_QUANTITY}个公共池随机礼包已经发放到背包。冠亚军礼包将在决赛结束后自动发放。`,
      round:event.round,
      payload:{ amount:0, competition:"cup", stage:event.stage, award:kind, grantId:awardKey, packType:CUP_ADVANCE_PACK_TYPE, quantity:CUP_ADVANCE_PACK_QUANTITY, packIds:items.map((item) => item.id) },
    });
    return ledgerEntry;
  }

  awardSeasonFinalChampionStar(teamId, tournament) {
    const team = this.state.teams.find((entry) => entry.id === teamId);
    if (!team || !tournament?.id) return null;
    team.seasonFinalChampionStars ??= [];
    const existing = team.seasonFinalChampionStars.find((entry) => entry.tournamentId === tournament.id);
    if (existing) return existing;
    const star = {
      tournamentId:tournament.id,
      seasonId:tournament.seasonId ?? this.state.season.id,
      awardedAt:this.now(),
    };
    team.seasonFinalChampionStars.push(star);
    return star;
  }

  grantSeasonFinalPlacementReward(teamId, tournament, kind) {
    this.ensureDisciplineState();
    const team = this.state.teams.find((entry) => entry.id === teamId);
    const packType = FINAL_PLACEMENT_REWARD_PACK_TYPES[kind] ?? null;
    if (!team?.ownerId || !tournament?.id || !packType) return null;
    const awardKey = `${tournament.id}:${kind}`;
    const disciplineGrantId = `season-final-reward:${awardKey}`;
    const previouslyWithheld = this.state.discipline.withheldRewards.some((entry) => entry.accountId === team.ownerId && entry.grantId === disciplineGrantId);
    if (this.rewardsSuspended(team.ownerId) || previouslyWithheld) {
      if (!previouslyWithheld) this.withholdReward(team.ownerId, "season-final", disciplineGrantId, { stage:"final", rewardType:kind, tournamentId:tournament.id });
      return null;
    }
    if (this.state.ledger.some((entry) => entry.type === "season-final-pack-reward" && entry.accountId === team.ownerId && entry.grantId === awardKey)) return null;
    const items = this.grantS4Pack(team.ownerId, packType, 1, { source:"season-final", grantId:awardKey });
    const ledgerEntry = {
      id:makeId("ledger", `${team.id}-${awardKey}`),
      accountId:team.ownerId,
      amount:0,
      type:"season-final-pack-reward",
      grantId:awardKey,
      competition:"season-final",
      stage:"final",
      award:kind,
      packType,
      quantity:1,
      packIds:items.map((item) => item.id),
      tournamentId:tournament.id,
      seasonId:tournament.seasonId ?? this.state.season.id,
      createdAt:this.now(),
    };
    this.state.ledger.push(ledgerEntry);
    const placementName = kind === "champion" ? "冠军" : "亚军";
    const pack = S4_PACK_BY_ID[packType];
    this.pushInbox(team, {
      id:`season-final-reward:${awardKey}:${team.id}`,
      type:"reward",
      title:`赛季总决赛${placementName}奖励已送达`,
      summary:`获得1份${pack.name}${kind === "champion" ? "，并永久增加一颗总决赛冠军星" : ""}。`,
      body:`恭喜获得本届赛季总决赛${placementName}。1份${pack.name}已经发放到礼包背包${kind === "champion" ? "；冠军星已经记入球队永久荣誉，并会展示在联赛和杯赛积分榜的球队名称后" : ""}。`,
      payload:{ amount:0, competition:"season-final", stage:"final", award:kind, grantId:awardKey, packType, quantity:1, packIds:items.map((item) => item.id), seasonFinalStarAwarded:kind === "champion" },
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
    if (this.rosterSlotsUsed(account.id) >= this.rosterLimit(account.id)) throw new Error(`${this.rosterLimit(account.id)}人名单已满，请先腾出一个位置`);
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
    if (round.number >= this.state.season.totalRounds) {
      this.state.season.status = "completed";
      this.state.season.completedAt = this.now();
      this.settleBallonDor();
      this.ensureSeasonFinalTournament();
    }
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
      const homeTicketIncome = this.homeTicketIncomeSummary(team, matchRecord);
      this.pushInbox(team, {
        id:`matchweek:${this.state.season.id}:${roundNumber}`,
        type:"matchweek",
        title:`第${roundNumber}轮比赛周战报`,
        summary:`${team.name} ${ownScore}:${opponentScore} ${opponentName}，本轮${resultText}。${homeTicketIncome ? ` 主场门票收入${homeTicketIncome.amount.toLocaleString("zh-CN")}金币。` : ""}`,
        body:`球队目前排名第 ${rank}，积 ${team.table.points} 分。${homeTicketIncome ? `本场共有${homeTicketIncome.attendance.toLocaleString("zh-CN")}名观众入场，门票收入${homeTicketIncome.amount.toLocaleString("zh-CN")}金币。` : ""}${next ? `下一轮将${next.venue === "home" ? "主场" : "客场"}迎战 ${next.name}。` : "本赛季赛程已经完成。"}`,
        round:roundNumber,
        matchId:ownMatch.id,
        payload:{ results, rank, points:team.table.points, injured, suspended, next, autoRotations, homeTicketIncome },
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
    if (round.number === 1) this.settleMirrorMarketplace(localDateKey(new Date(this.now())));
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
      const before = Number(live.match.nextChainIndex ?? 0);
      advanceLeagueMatch(live.match, now, { maximumChains:options.maximumChainsPerMatch });
      const didAdvance = Number(live.match.nextChainIndex ?? 0) > before;
      advanced = advanced || didAdvance;
      if (live.match.report) {
        if (options.persist !== false) this.persistLiveMatch(live, now, true);
        advanced = this.queueLiveSettlement(live, () => {
          const currentLiveRound = this.state.liveRound;
          const currentRound = this.state.rounds.find((entry) => entry.number === currentLiveRound?.roundNumber);
          if (!currentLiveRound || !currentRound) { delete live.settlementPending; return; }
          this.roundNewUnavailable = new Set(currentLiveRound.newUnavailable ?? []);
          this.finalizeFixture(currentRound.fixtures[live.fixtureIndex], currentRound.number, live.match);
          live.completed = true;
          delete live.settlementPending;
          currentLiveRound.newUnavailable = [...this.roundNewUnavailable];
          if (currentLiveRound.matches.every((entry) => entry.completed)) this.finishRound(currentRound, { deferSave:true });
        }) || advanced;
      } else if (didAdvance && options.persist !== false) this.persistLiveMatch(live, now);
    }
    liveRound.newUnavailable = [...this.roundNewUnavailable];
    return advanced;
  }

  advanceLiveSlice(now = this.now()) {
    if (this.liveAdvanceRunning) return false;
    this.liveAdvanceRunning = true;
    try {
      const mainAdvanced = this.state.liveRound
        ? this.advanceLiveRound(now, { maximumMatches:1, maximumChainsPerMatch:1 })
        : this.state.liveCupRound
          ? this.advanceLiveCupRound(now, { maximumMatches:1, maximumChainsPerMatch:1 })
          : this.state.liveSeasonFinalRound
            ? this.advanceLiveSeasonFinalRound(now, { maximumChainsPerMatch:1 })
          : false;
      if (mainAdvanced) return true;

      // Only one possession chain is allowed to consume a live slice. When the
      // selected official match is already caught up to wall-clock time, use
      // that spare slice for a friendly or AI training and alternate them.
      const auxiliaryAdvancers = [
        () => this.advanceLiveFriendlies(now, { maximumMatches:1, maximumChainsPerMatch:1 }),
        () => this.advanceAiTrainings(now, { maximumMatches:1, maximumChainsPerMatch:1 }),
      ];
      const start = Number(this.liveAdvanceCursors.auxiliary ?? 0) % auxiliaryAdvancers.length;
      for (let offset = 0; offset < auxiliaryAdvancers.length; offset += 1) {
        const index = (start + offset) % auxiliaryAdvancers.length;
        if (!auxiliaryAdvancers[index]()) continue;
        this.liveAdvanceCursors.auxiliary = (index + 1) % auxiliaryAdvancers.length;
        return true;
      }
      this.liveAdvanceCursors.auxiliary = (start + 1) % auxiliaryAdvancers.length;
      return false;
    } finally {
      this.liveAdvanceRunning = false;
    }
  }

  liveMatch(codeValue) {
    const code = String(codeValue ?? "").toUpperCase();
    const live = this.liveAiTrainings.get(code) ?? [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveSeasonFinalRound?.matches ?? []), ...this.state.liveFriendlies].find((entry) => entry.code.toUpperCase() === code && !entry.completed);
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
        matchId:fixture?.matchId ?? live.matchId ?? null,
        completedAt:this.now(),
        spectators:clone(live.spectators ?? {}),
        match:publicLeagueMatch(live.match, this.now(), null, true),
      });
    });
  }

  purgeCompletedBroadcasts() {
    const cutoff = this.now() - COMPLETED_BROADCAST_RETENTION_MS;
    const broadcasts = this.state.completedBroadcasts ?? [];
    const firstExpiredIndex = broadcasts.findIndex((entry) => entry.completedAt < cutoff);
    if (firstExpiredIndex < 0) return false;
    this.state.completedBroadcasts = broadcasts.filter((entry, index) => index < firstExpiredIndex || entry.completedAt >= cutoff);
    return true;
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
    return clone([...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveSeasonFinalRound?.matches ?? []), ...this.state.liveFriendlies].filter((live) => !live.completed).map((live) => {
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
        competition:live.code.startsWith("YDL-FRIENDLY-") ? "YDL友谊赛" : live.code.startsWith("YDL-WC-") ? "YellowDogs World Cup" : live.code.startsWith("YDL-CUP-") ? "YellowDogs Champion Cup" : live.code.startsWith("YDL-FINAL-") ? "赛季总决赛" : "YellowDogs League",
      };
    }));
  }

  upcomingBroadcasts() {
    const now = this.now();
    const teamName = (id) => this.state.teams.find((team) => team.id === id)?.name ?? "待定";
    const hasClubOwner = (fixture) => [fixture.homeId, fixture.awayId].some((id) => this.state.teams.find((team) => team.id === id)?.ownerId);
    const upcoming = [];
    const leagueRound = this.state.rounds?.[this.state.season.currentRound];
    const leagueStartsAt = Number(this.state.season.nextRoundAt);
    if (this.state.season.status === "active" && leagueRound?.status === "pending" && leagueStartsAt > now) {
      leagueRound.fixtures.filter((fixture) => LEAGUE_MATCH_ENGINE === "v2" || hasClubOwner(fixture)).forEach((fixture) => upcoming.push({
        id:`league:${leagueRound.number}:${fixture.homeId}:${fixture.awayId}`,
        competition:"league", competitionName:"黄狗联赛", round:leagueRound.number,
        label:`第${leagueRound.number}轮`, startsAt:leagueStartsAt,
        homeName:teamName(fixture.homeId), awayName:teamName(fixture.awayId),
      }));
    }
    const cupEvent = this.state.cup?.status === "active" ? this.state.cup.events?.find((event) => event.status === "pending") : null;
    const cupStartsAt = Number(this.state.cup?.nextRoundAt);
    if (cupEvent && cupStartsAt > now) {
      const label = ["league", "swiss"].includes(cupEvent.stage) ? `${cupEvent.stage === "league" ? "联赛阶段" : "瑞士轮"}第${cupEvent.round}轮` : `${CUP_STAGE_NAMES[cupEvent.stage] ?? cupEvent.stage} · 第${cupEvent.leg}回合`;
      this.cupEventFixtures(cupEvent).filter(hasClubOwner).forEach((fixture) => upcoming.push({
        id:`cup:${fixture.id}`, competition:"cup", competitionName:"黄狗冠军杯",
        round:cupEvent.round, label, startsAt:cupStartsAt,
        homeName:teamName(fixture.homeId), awayName:teamName(fixture.awayId),
      }));
    }
    const tournament = this.state.seasonFinalTournament;
    if (tournament && !tournament.preview && !["completed", "cancelled"].includes(tournament.status)) {
      tournament.bracket.filter((node) => node.status === "pending" && Number(node.scheduledAt) > now).forEach((node) => {
        const homeId = this.seasonFinalNodeTeamId(tournament, node.home);
        const awayId = this.seasonFinalNodeTeamId(tournament, node.away);
        if (!homeId || !awayId) return;
        const fixture = { homeId, awayId };
        if (!hasClubOwner(fixture)) return;
        upcoming.push({
          id:`season-final:${tournament.id}:${node.id}`,
          competition:"season-final",
          competitionName:"赛季总决赛",
          round:node.order + 1,
          label:node.group === "final" ? `${node.id} · 最终决赛第${Number(node.id.slice(-1))}回合` : node.id,
          startsAt:Number(node.scheduledAt),
          homeName:teamName(homeId),
          awayName:teamName(awayId),
        });
      });
    }
    return clone(upcoming.sort((left, right) => Number(left.startsAt) - Number(right.startsAt) || left.competition.localeCompare(right.competition)).slice(0, 24));
  }

  broadcastView(live) {
    this.cleanupLiveSpectators(live);
    const homeTeam = live.aiTraining
      ? this.accountTeam(live.ownerId)
      : this.state.teams.find((team) => team.name === live.match?.teams?.[0]?.name);
    if (homeTeam) live.match.stadium = this.clubBroadcastVenue(homeTeam);
    const protectMirrorTactics = live.aiTraining && live.mirrorKind === "full";
    const match = publicLeagueMatch(live.match, this.now(), protectMirrorTactics ? 0 : null, true);
    if (protectMirrorTactics) {
      const hideOpponentTacticalDetails = (team) => {
        if (!team) return;
        ["inPossessionDetails", "outOfPossessionDetails", "tacticalDimensions", "playerDuties"].forEach((key) => { delete team[key]; });
        (team.players ?? []).forEach((player) => { delete player.tacticalDuty; });
      };
      hideOpponentTacticalDetails(match.teams?.[1]);
      hideOpponentTacticalDetails(match.report?.teams?.[1]);
      if (match.report) {
        delete match.report.analysisTimeline;
        delete match.report.tacticalReview;
      }
    }
    return clone({
      code:live.code,
      round:live.round ?? this.state.liveRound?.roundNumber ?? this.state.cup?.stage ?? 0,
      live:!live.completed && !live.match.report,
      spectators:Object.values(live.spectators ?? {}).map(({ name }) => ({ name })),
      match,
      competition:live.aiTraining ? "AI 战术训练赛" : live.code.startsWith("YDL-FRIENDLY-") ? "YDL友谊赛" : live.code.startsWith("YDL-WC-") ? "YellowDogs World Cup" : live.code.startsWith("YDL-CUP-") ? "YellowDogs Champion Cup" : "YellowDogs League",
      aiTraining:Boolean(live.aiTraining),
      aiTrainingConfig:live.aiTraining ? { formation:live.formation, actualAverageOverall:live.actualAverageOverall, targetOverall:live.targetOverall } : undefined,
    });
  }

  watch(code, spectatorName, existingToken = null) {
    const live = this.liveMatch(code);
    if (live.aiTraining && !live.spectators?.[existingToken]) throw new Error("AI 对战只能由创建者观看");
    live.spectators ??= {};
    const spectatorToken = existingToken && live.spectators[existingToken] ? existingToken : makeId("viewer", code);
    live.spectators[spectatorToken] = { name:String(spectatorName ?? "匿名观众").trim().slice(0, 30) || "匿名观众", lastSeenAt:this.now() };
    return { spectatorToken, broadcast:this.broadcastView(live) };
  }

  watchView(code, spectatorToken) {
    const codeKey = String(code ?? "").toUpperCase();
    const live = this.liveAiTrainings.get(codeKey) ?? [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveSeasonFinalRound?.matches ?? []), ...this.state.liveFriendlies].find((entry) => entry.code.toUpperCase() === codeKey && !entry.completed);
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
    const live = this.liveAiTrainings.get(codeKey) ?? [...(this.state.liveRound?.matches ?? []), ...(this.state.liveCupRound?.matches ?? []), ...(this.state.liveSeasonFinalRound?.matches ?? []), ...this.state.liveFriendlies].find((entry) => entry.code.toUpperCase() === codeKey && !entry.completed);
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

  settleLeagueRankingGiftPacks() {
    const season = this.state.season;
    if (season.status !== "completed") return null;
    const settlementId = `${season.id}+league-ranking-gifts`;
    const standings = this.standings();
    const rewardedAt = this.now();
    const recipients = standings.filter((entry) => LEAGUE_RANKING_GIFT_QUANTITIES[entry.rank]).map((entry) => {
      const team = this.state.teams.find((candidate) => candidate.id === entry.id);
      const quantity = LEAGUE_RANKING_GIFT_QUANTITIES[entry.rank];
      if (!team?.ownerId) return { teamId:entry.id, rank:entry.rank, quantity, packIds:[], skipped:true };
      const grantId = `${settlementId}:${team.ownerId}`;
      const existing = this.state.ledger.find((ledgerEntry) => ledgerEntry.type === "league-ranking-gift-settlement" && ledgerEntry.grantId === grantId);
      if (existing) return { accountId:team.ownerId, teamId:team.id, rank:entry.rank, quantity, packIds:existing.packIds ?? [], alreadyGranted:true };
      const packs = this.grantS4Pack(team.ownerId, LEAGUE_RANKING_GIFT_PACK_TYPE, quantity, { source:"league-ranking-settlement", grantId });
      const packIds = packs.map((pack) => pack.id);
      this.state.ledger.push({
        id:`league-ranking-gift-settlement:${season.id}:${team.ownerId}`,
        accountId:team.ownerId,
        amount:0,
        type:"league-ranking-gift-settlement",
        grantId,
        seasonId:season.id,
        rank:entry.rank,
        packType:LEAGUE_RANKING_GIFT_PACK_TYPE,
        quantity,
        packIds,
        createdAt:rewardedAt,
      });
      this.pushInbox(team, {
        id:`league-ranking-gifts:${season.id}:${team.ownerId}`,
        type:"reward",
        title:`${season.name} 联赛名次追加奖励已到账`,
        summary:`最终排名第${entry.rank}名，获得${quantity}个私有池+3指定礼包。`,
        body:`本赛季联赛最终排名第${entry.rank}名，${quantity}个私有池+3指定礼包已经发放到 S4 礼包背包。`,
        payload:{ settlementId, seasonId:season.id, rank:entry.rank, competition:"league", award:"ranking-gift", packType:LEAGUE_RANKING_GIFT_PACK_TYPE, quantity, packIds },
      });
      return { accountId:team.ownerId, teamId:team.id, rank:entry.rank, quantity, packIds };
    });
    const settlement = { id:settlementId, seasonId:season.id, seasonName:season.name, status:"completed", rewardedAt, packType:LEAGUE_RANKING_GIFT_PACK_TYPE, recipients };
    this.state.dailyAutomation.leagueRankingGiftSettlements ??= [];
    const index = this.state.dailyAutomation.leagueRankingGiftSettlements.findIndex((entry) => entry.id === settlementId);
    if (index >= 0) this.state.dailyAutomation.leagueRankingGiftSettlements[index] = settlement;
    else this.state.dailyAutomation.leagueRankingGiftSettlements.push(settlement);
    this.state.dailyAutomation.leagueRankingGiftSettlements = this.state.dailyAutomation.leagueRankingGiftSettlements.slice(-30);
    this.save();
    return clone(settlement);
  }

  ballonDorCandidates() {
    const candidates = new Map();
    const collect = (source, competition, weight) => {
      Object.values(source ?? {}).forEach((entry) => {
        const player = REAL_PLAYER_BY_ID[entry.playerId];
        const team = this.state.teams.find((candidate) => candidate.id === entry.teamId);
        const appearances = Math.max(0, Number(entry.appearances ?? 0));
        if (!player || !team?.ownerId || !appearances) return;
        const candidateKey = `${team.id}:${player.id}`;
        const current = candidates.get(candidateKey) ?? {
          candidateKey,
          playerId:player.id,
          playerName:player.name,
          role:player.role,
          grade:player.grade,
          teamId:team.id,
          teamName:team.name,
          ownerId:team.ownerId,
          ownerName:team.ownerName,
          appearances:0,
          goals:0,
          assists:0,
          ratingTotal:0,
          weightedAppearances:0,
          weightedGoals:0,
          weightedAssists:0,
          weightedRatingTotal:0,
          league:{ appearances:0, goals:0, assists:0, ratingTotal:0 },
          cup:{ appearances:0, goals:0, assists:0, ratingTotal:0 },
        };
        const goals = Math.max(0, Number(entry.goals ?? 0));
        const assists = Math.max(0, Number(entry.assists ?? 0));
        const ratingTotal = Math.max(0, Number(entry.ratingTotal ?? 0));
        current.appearances += appearances;
        current.goals += goals;
        current.assists += assists;
        current.ratingTotal += ratingTotal;
        current.weightedAppearances += appearances * weight;
        current.weightedGoals += goals * weight;
        current.weightedAssists += assists * weight;
        current.weightedRatingTotal += ratingTotal * weight;
        current[competition].appearances += appearances;
        current[competition].goals += goals;
        current[competition].assists += assists;
        current[competition].ratingTotal += ratingTotal;
        candidates.set(candidateKey, current);
      });
    };
    collect(this.state.playerStats, "league", 1);
    collect(this.state.cup?.playerStats, "cup", BALLON_DOR_CUP_WEIGHT);

    const leagueStandings = this.state.season.status === "completed" ? this.standings() : [];
    const leagueChampionId = leagueStandings[0]?.id ?? null;
    const leagueRunnerUpId = leagueStandings[1]?.id ?? null;
    const cupChampionId = this.state.cup?.status === "completed" ? this.state.cup.championId ?? null : null;
    const cupFinal = this.state.cup?.status === "completed" ? this.state.cup.knockout?.final?.[0] ?? null : null;
    const cupRunnerUpId = cupChampionId ? cupFinal?.teams?.find((teamId) => teamId !== cupChampionId) ?? null : null;
    const seasonFinalTie = this.state.seasonFinalTournament?.status === "completed" ? this.state.seasonFinalTournament.finalTie : null;
    const seasonFinalChampionId = seasonFinalTie?.championId ?? null;
    const seasonFinalRunnerUpId = seasonFinalChampionId ? [seasonFinalTie.winnerBracketChampionId, seasonFinalTie.loserBracketChampionId].find((teamId) => teamId && teamId !== seasonFinalChampionId) ?? null : null;
    return [...candidates.values()].filter((candidate) => candidate.appearances >= BALLON_DOR_MINIMUM_APPEARANCES && this.representativeCard(candidate.ownerId, candidate.playerId)).map((candidate) => {
      const averageRating = candidate.ratingTotal / Math.max(1, candidate.appearances);
      const weightedAverageRating = candidate.weightedRatingTotal / Math.max(1, candidate.weightedAppearances);
      const leagueChampion = candidate.teamId === leagueChampionId;
      const leagueRunnerUp = candidate.teamId === leagueRunnerUpId;
      const cupChampion = candidate.teamId === cupChampionId;
      const cupRunnerUp = candidate.teamId === cupRunnerUpId;
      const seasonFinalChampion = candidate.teamId === seasonFinalChampionId;
      const seasonFinalRunnerUp = candidate.teamId === seasonFinalRunnerUpId;
      const card = this.representativeCard(candidate.ownerId, candidate.playerId);
      const placements = { leagueChampion, leagueRunnerUp, cupChampion, cupRunnerUp, seasonFinalChampion, seasonFinalRunnerUp };
      const breakdown = ballonDorBreakdown(candidate, placements);
      const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
      return {
        playerId:candidate.playerId,
        playerName:candidate.playerName,
        role:candidate.role,
        grade:candidate.grade,
        teamId:candidate.teamId,
        teamName:candidate.teamName,
        ownerId:candidate.ownerId,
        ownerName:candidate.ownerName,
        cardId:card.id,
        appearances:candidate.appearances,
        goals:candidate.goals,
        assists:candidate.assists,
        averageRating:Number(averageRating.toFixed(2)),
        weightedAverageRating:Number(weightedAverageRating.toFixed(3)),
        league:{ ...candidate.league, averageRating:candidate.league.appearances ? Number((candidate.league.ratingTotal / candidate.league.appearances).toFixed(2)) : 0 },
        cup:{ ...candidate.cup, averageRating:candidate.cup.appearances ? Number((candidate.cup.ratingTotal / candidate.cup.appearances).toFixed(2)) : 0 },
        champions:{ league:placements.leagueChampion, cup:placements.cupChampion, seasonFinal:placements.seasonFinalChampion },
        runnerUps:{ league:placements.leagueRunnerUp, cup:placements.cupRunnerUp, seasonFinal:placements.seasonFinalRunnerUp },
        breakdown,
        score:Number(score.toFixed(2)),
      };
    }).sort(compareBallonDorCandidates);
  }

  archivedBallonDorCandidates(archive, previousResult) {
    const standings = [...(archive?.standings ?? [])].sort((left, right) => Number(left.rank ?? TEAM_COUNT) - Number(right.rank ?? TEAM_COUNT));
    const teams = new Map(standings.map((standing) => {
      const archivedTeam = standing.team ?? {};
      const currentTeam = this.state.teams.find((team) => team.id === standing.id || team.ownerId && team.ownerId === archivedTeam.ownerId);
      return [standing.id, {
        id:standing.id,
        name:archivedTeam.name ?? standing.name ?? currentTeam?.name ?? standing.id,
        ownerId:archivedTeam.ownerId ?? currentTeam?.ownerId ?? null,
        ownerName:archivedTeam.ownerName ?? currentTeam?.ownerName ?? null,
      }];
    }));
    const previousCandidates = [previousResult?.winner, ...(previousResult?.candidates ?? [])].filter(Boolean);
    const previousByKey = new Map(previousCandidates.map((candidate) => [`${candidate.teamId}:${candidate.playerId}`, candidate]));
    const candidates = new Map();
    const collect = (source, competition, weight) => {
      Object.values(source ?? {}).forEach((entry) => {
        const player = REAL_PLAYER_BY_ID[entry.playerId];
        const team = teams.get(entry.teamId);
        const appearances = Math.max(0, Number(entry.appearances ?? 0));
        if (!player || !team?.ownerId || !appearances) return;
        const candidateKey = `${team.id}:${player.id}`;
        const current = candidates.get(candidateKey) ?? {
          candidateKey,
          playerId:player.id,
          playerName:player.name,
          role:player.role,
          grade:player.grade,
          teamId:team.id,
          teamName:team.name,
          ownerId:team.ownerId,
          ownerName:team.ownerName,
          appearances:0,
          goals:0,
          assists:0,
          ratingTotal:0,
          weightedAppearances:0,
          weightedGoals:0,
          weightedAssists:0,
          weightedRatingTotal:0,
          league:{ appearances:0, goals:0, assists:0, ratingTotal:0 },
          cup:{ appearances:0, goals:0, assists:0, ratingTotal:0 },
        };
        const goals = Math.max(0, Number(entry.goals ?? 0));
        const assists = Math.max(0, Number(entry.assists ?? 0));
        const ratingTotal = Math.max(0, Number(entry.ratingTotal ?? 0));
        current.appearances += appearances;
        current.goals += goals;
        current.assists += assists;
        current.ratingTotal += ratingTotal;
        current.weightedAppearances += appearances * weight;
        current.weightedGoals += goals * weight;
        current.weightedAssists += assists * weight;
        current.weightedRatingTotal += ratingTotal * weight;
        current[competition].appearances += appearances;
        current[competition].goals += goals;
        current[competition].assists += assists;
        current[competition].ratingTotal += ratingTotal;
        candidates.set(candidateKey, current);
      });
    };
    collect(archive?.playerStats, "league", 1);
    collect(archive?.cup?.playerStats, "cup", BALLON_DOR_CUP_WEIGHT);

    const leagueChampionId = standings[0]?.id ?? null;
    const leagueRunnerUpId = standings[1]?.id ?? null;
    const cupChampionId = archive?.cup?.status === "completed" ? archive.cup.championId ?? null : null;
    const cupFinal = archive?.cup?.status === "completed" ? archive.cup.knockout?.final?.[0] ?? null : null;
    const cupRunnerUpId = cupChampionId ? cupFinal?.teams?.find((teamId) => teamId !== cupChampionId) ?? null : null;
    const seasonFinalTie = archive?.seasonFinalTournament?.status === "completed" ? archive.seasonFinalTournament.finalTie : null;
    const seasonFinalChampionId = seasonFinalTie?.championId ?? null;
    const seasonFinalRunnerUpId = seasonFinalChampionId ? [seasonFinalTie.winnerBracketChampionId, seasonFinalTie.loserBracketChampionId].find((teamId) => teamId && teamId !== seasonFinalChampionId) ?? null : null;
    return [...candidates.values()].filter((candidate) => candidate.appearances >= BALLON_DOR_MINIMUM_APPEARANCES).map((candidate) => {
      const weightedAverageRating = candidate.weightedRatingTotal / Math.max(1, candidate.weightedAppearances);
      const averageRating = candidate.ratingTotal / Math.max(1, candidate.appearances);
      const placements = {
        leagueChampion:candidate.teamId === leagueChampionId,
        leagueRunnerUp:candidate.teamId === leagueRunnerUpId,
        cupChampion:candidate.teamId === cupChampionId,
        cupRunnerUp:candidate.teamId === cupRunnerUpId,
        seasonFinalChampion:candidate.teamId === seasonFinalChampionId,
        seasonFinalRunnerUp:candidate.teamId === seasonFinalRunnerUpId,
      };
      const breakdown = ballonDorBreakdown(candidate, placements);
      const previous = previousByKey.get(candidate.candidateKey);
      const currentCard = this.representativeCard(candidate.ownerId, candidate.playerId);
      return {
        playerId:candidate.playerId,
        playerName:candidate.playerName,
        role:candidate.role,
        grade:candidate.grade,
        teamId:candidate.teamId,
        teamName:candidate.teamName,
        ownerId:candidate.ownerId,
        ownerName:candidate.ownerName,
        cardId:previous?.cardId ?? currentCard?.id ?? null,
        appearances:candidate.appearances,
        goals:candidate.goals,
        assists:candidate.assists,
        averageRating:Number(averageRating.toFixed(2)),
        weightedAverageRating:Number(weightedAverageRating.toFixed(3)),
        league:{ ...candidate.league, averageRating:candidate.league.appearances ? Number((candidate.league.ratingTotal / candidate.league.appearances).toFixed(2)) : 0 },
        cup:{ ...candidate.cup, averageRating:candidate.cup.appearances ? Number((candidate.cup.ratingTotal / candidate.cup.appearances).toFixed(2)) : 0 },
        champions:{ league:placements.leagueChampion, cup:placements.cupChampion, seasonFinal:placements.seasonFinalChampion },
        runnerUps:{ league:placements.leagueRunnerUp, cup:placements.cupRunnerUp, seasonFinal:placements.seasonFinalRunnerUp },
        breakdown,
        score:Number(Object.values(breakdown).reduce((sum, value) => sum + value, 0).toFixed(2)),
      };
    }).sort(compareBallonDorCandidates);
  }

  ballonDorReconciliationCard(candidate) {
    const recorded = candidate?.cardId ? this.state.s4Assets.cards[candidate.cardId] : null;
    if (recorded) return recorded;
    const current = this.representativeCard(candidate?.ownerId, candidate?.playerId);
    if (current) return current;
    return Object.values(this.state.s4Assets.cards ?? {})
      .filter((card) => card.playerId === candidate?.playerId && card.previousOwnerId === candidate?.ownerId)
      .sort((left, right) => Number(right.upgradeLevel ?? 0) - Number(left.upgradeLevel ?? 0)
        || Number(right.traitIds?.length ?? 0) - Number(left.traitIds?.length ?? 0)
        || String(left.id).localeCompare(String(right.id)))[0] ?? null;
  }

  ballonDorSeasonLabel(seasonId, fallback = null) {
    const processedSeasonIds = this.state.honorRoom?.processedSeasonIds ?? [];
    const processedIndex = processedSeasonIds.indexOf(seasonId);
    if (processedIndex >= 0) return `S${processedIndex + 1}`;
    if (seasonId && seasonId === this.state.season?.id) return `S${processedSeasonIds.length + 1}`;
    return fallback ?? seasonId ?? "未知赛季";
  }

  reconcileHistoricalBallonDor() {
    const ballonDor = this.state.ballonDor ?? (this.state.ballonDor = { schemaVersion:3, results:[] });
    if (Number(ballonDor.reconciliationVersion ?? 0) >= BALLON_DOR_RECONCILIATION_VERSION) return false;
    const auditedAt = this.now();
    const archivesBySeason = new Map((this.state.archives ?? []).map((archive) => [archive.season?.id, archive]));
    const audits = [];
    const results = [...(ballonDor.results ?? [])];

    results.forEach((previousResult) => {
      if (previousResult.status !== "completed" || !previousResult.winner) return;
      const archiveSummary = archivesBySeason.get(previousResult.seasonId);
      const archive = archiveSummary && this.shardStore
        ? this.shardStore.readFullArchive(archiveSummary) ?? archiveSummary
        : archiveSummary;
      const seasonLabel = this.ballonDorSeasonLabel(previousResult.seasonId, previousResult.seasonName);
      const candidates = archive
        ? this.archivedBallonDorCandidates(archive, previousResult)
        : previousResult.seasonId === this.state.season.id && this.state.season.status === "completed"
          ? this.ballonDorCandidates()
          : [];
      if (!candidates.length) {
        audits.push({ seasonId:previousResult.seasonId, seasonName:previousResult.seasonName, seasonLabel, status:"insufficient-data", previousWinner:clone(previousResult.winner) });
        return;
      }

      const winner = { ...candidates[0] };
      const previousWinner = previousResult.winner;
      const changed = previousWinner.teamId !== winner.teamId || previousWinner.playerId !== winner.playerId;
      let rewardStatus = "unchanged";
      let rewardAmount = 0;
      let revokedCardId = null;
      let awardedCardId = winner.cardId ?? null;
      if (changed) {
        const previousCard = previousWinner.cardId ? this.state.s4Assets.cards[previousWinner.cardId] : null;
        if (previousCard) {
          previousCard.ballonDorWins = Math.max(0, Number(previousCard.ballonDorWins ?? 0) - 1);
          revokedCardId = previousCard.id;
        }
        const winningCard = this.ballonDorReconciliationCard(winner);
        if (winningCard) {
          winningCard.ballonDorWins = Number(winningCard.ballonDorWins ?? 0) + 1;
          winner.cardId = winningCard.id;
          winner.awardNumber = winningCard.ballonDorWins;
          awardedCardId = winningCard.id;
        } else winner.awardNumber = 1;

        const alreadyRewarded = this.state.ledger.some((entry) => entry.type === "ballon-dor-owner-reward" && entry.seasonId === previousResult.seasonId && entry.accountId === winner.ownerId);
        if (alreadyRewarded) rewardStatus = "already-rewarded";
        else {
          rewardStatus = "supplemented";
          rewardAmount = BALLON_DOR_OWNER_REWARD;
          this.wallet(winner.ownerId).balance += rewardAmount;
          this.state.ledger.push({
            id:`ballon-dor-reconciliation:${previousResult.seasonId}:${winner.ownerId}`,
            accountId:winner.ownerId,
            amount:rewardAmount,
            type:"ballon-dor-owner-reward",
            grantId:`ballon-dor-reconciliation:${previousResult.seasonId}:${winner.ownerId}`,
            seasonId:previousResult.seasonId,
            playerId:winner.playerId,
            cardId:winner.cardId ?? null,
            teamId:winner.teamId,
            reconciliationVersion:BALLON_DOR_RECONCILIATION_VERSION,
            createdAt:auditedAt,
          });
        }
      } else winner.awardNumber = Number(previousWinner.awardNumber ?? this.state.s4Assets.cards[previousWinner.cardId]?.ballonDorWins ?? 1);

      const podium = candidates.slice(0, 3).map((candidate, index) => ({ rank:index + 1, ...candidate, ...(index === 0 ? { cardId:winner.cardId } : {}) }));
      const corrected = {
        ...previousResult,
        minimumAppearances:BALLON_DOR_MINIMUM_APPEARANCES,
        cupWeight:BALLON_DOR_CUP_WEIGHT,
        scoring:{ ...BALLON_DOR_SCORING },
        winner,
        rewardedOwnerId:winner.ownerId,
        ownerReward:BALLON_DOR_OWNER_REWARD,
        podium,
        candidates:candidates.slice(0, 10).map((candidate, index) => index === 0 ? { ...candidate, cardId:winner.cardId } : candidate),
        reconciliation:{ version:BALLON_DOR_RECONCILIATION_VERSION, auditedAt, changed, previousWinner:clone(previousWinner), rewardStatus, rewardAmount },
      };
      const resultIndex = ballonDor.results.findIndex((entry) => entry.id === previousResult.id);
      if (resultIndex >= 0) ballonDor.results[resultIndex] = corrected;
      if (archive) archive.ballonDorResult = clone(corrected);

      if (changed && this.state.honorRoom?.processedSeasonIds?.includes(previousResult.seasonId)) {
        Object.values(this.state.honorRoom.clubs ?? {}).forEach((club) => {
          club.ballonDor = (club.ballonDor ?? []).filter((award) => award.seasonId !== previousResult.seasonId);
        });
        const winnerTeam = this.state.teams.find((team) => team.ownerId === winner.ownerId);
        if (winnerTeam) this.ensureHonorRoomClub(winnerTeam).ballonDor.push({ season:seasonLabel, seasonId:previousResult.seasonId, playerId:winner.playerId, playerName:winner.playerName });
        this.state.honorRoom.updatedAt = auditedAt;
      }

      audits.push({
        seasonId:previousResult.seasonId,
        seasonName:previousResult.seasonName,
        seasonLabel,
        status:changed ? "changed" : "unchanged",
        previousWinner:{ ownerId:previousWinner.ownerId, ownerName:previousWinner.ownerName, playerId:previousWinner.playerId, playerName:previousWinner.playerName, score:previousWinner.score },
        winner:{ ownerId:winner.ownerId, ownerName:winner.ownerName, playerId:winner.playerId, playerName:winner.playerName, score:winner.score },
        rewardStatus,
        rewardAmount,
        revokedCardId,
        awardedCardId,
      });
    });

    const changedAudits = audits.filter((audit) => audit.status === "changed");
    const supplemented = audits.filter((audit) => audit.rewardStatus === "supplemented");
    const publicLines = audits.length ? audits.map((audit, index) => {
      if (audit.status === "insufficient-data") return `${index + 1}. ${audit.seasonLabel}：缺少完整赛季归档，保留原评选结果。`;
      if (audit.status === "unchanged") return `${index + 1}. ${audit.seasonLabel}：复核后得主不变，仍为${audit.winner.ownerName}的${audit.winner.playerName}（${Number(audit.winner.score ?? 0).toFixed(2)}分）。`;
      const rewardText = audit.rewardStatus === "supplemented" ? `新得主补发${audit.rewardAmount.toLocaleString("zh-CN")}金币` : "新得主已有该赛季奖励记录，不重复发放金币";
      return `${index + 1}. ${audit.seasonLabel}：原得主${audit.previousWinner.ownerName}的${audit.previousWinner.playerName}调整为${audit.winner.ownerName}的${audit.winner.playerName}（${Number(audit.winner.score ?? 0).toFixed(2)}分）；原金球标识收回，原已发金币不追回；${rewardText}。`;
    }) : ["当前没有需要追溯复核的已发金球奖。"];
    const ruleText = "新标准：联赛冠军35分、联赛亚军15分、杯赛冠军30分、杯赛亚军10分；其余进球、助攻、评分、出场门槛及杯赛1.25倍权重保持不变。";
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      const personal = [];
      changedAudits.forEach((audit) => {
        if (audit.previousWinner.ownerId === team.ownerId) personal.push(`${audit.seasonLabel}：${audit.previousWinner.playerName}的原金球奖标识已收回，已发金币不追回。`);
        if (audit.winner.ownerId === team.ownerId) personal.push(`${audit.seasonLabel}：${audit.winner.playerName}补发金球奖；${audit.rewardStatus === "supplemented" ? `${audit.rewardAmount.toLocaleString("zh-CN")}金币已到账` : "金币已有发放记录，本次不重复发放"}。`);
      });
      this.pushInbox(team, {
        id:`ballon-dor-reconciliation-v${BALLON_DOR_RECONCILIATION_VERSION}:${team.ownerId}`,
        type:"announcement",
        title:"金球奖评分调整及历史重新评选公告",
        summary:`金球奖冠亚军加分已经调整，已复核${audits.length}届，改判${changedAudits.length}届，补发金币${supplemented.length}笔。`,
        body:`${ruleText}\n\n历史复核结果：\n${publicLines.join("\n")}\n\n${personal.length ? `与你相关的处理：\n${personal.join("\n")}` : "你没有需要没收或补发的个人奖项。"}\n\n本次处理原则：错误金球标识予以收回，正确得主补发金球标识和应得奖励；过去已经发出的金币一律不追回，同一赛季已有金球奖励记录的玩家不重复领取。`,
        payload:{ reconciliationVersion:BALLON_DOR_RECONCILIATION_VERSION, auditedAt, auditedSeasons:audits.length, changedSeasons:changedAudits.length, supplementedRewards:supplemented.length },
      });
    });
    ballonDor.reconciliationVersion = BALLON_DOR_RECONCILIATION_VERSION;
    ballonDor.reconciliation = { version:BALLON_DOR_RECONCILIATION_VERSION, auditedAt, audits:clone(audits) };
    return true;
  }

  settleBallonDor() {
    const season = this.state.season;
    if (season.status !== "completed" || this.state.cup?.status !== "completed" || this.state.seasonFinalTournament?.status !== "completed") return null;
    this.state.ballonDor ??= { schemaVersion:3, reconciliationVersion:BALLON_DOR_RECONCILIATION_VERSION, results:[] };
    const existing = this.state.ballonDor.results.find((entry) => entry.seasonId === season.id);
    if (existing) return clone(existing);
    const candidates = this.ballonDorCandidates();
    if (!candidates.length) {
      const result = { id:`ballon-dor:${season.id}`, seasonId:season.id, seasonName:season.name, status:"no-eligible-player", minimumAppearances:BALLON_DOR_MINIMUM_APPEARANCES, awardedAt:this.now(), candidates:[] };
      this.state.ballonDor.results.push(result);
      return clone(result);
    }

    const winner = candidates[0];
    const winningCard = this.state.s4Assets.cards[winner.cardId];
    const rewardedOwnerId = winner.ownerId;
    const awardNumber = Number(winningCard.ballonDorWins ?? 0) + 1;
    const podium = candidates.slice(0, 3).map((candidate, index) => ({ rank:index + 1, ...candidate }));
    const result = {
      id:`ballon-dor:${season.id}`,
      seasonId:season.id,
      seasonName:season.name,
      status:"completed",
      minimumAppearances:BALLON_DOR_MINIMUM_APPEARANCES,
      cupWeight:BALLON_DOR_CUP_WEIGHT,
      scoring:{ ...BALLON_DOR_SCORING },
      awardedAt:this.now(),
      winner:{ ...winner, awardNumber },
      rewardedOwnerId,
      ownerReward:BALLON_DOR_OWNER_REWARD,
      podium,
      candidates:candidates.slice(0, 10),
    };
    winningCard.ballonDorWins = awardNumber;
    this.state.ballonDor.results.push(result);
    this.state.ballonDor.results = this.state.ballonDor.results.slice(-30);

    const grantId = `${result.id}:${rewardedOwnerId}`;
    if (!this.state.ledger.some((entry) => entry.type === "ballon-dor-owner-reward" && entry.grantId === grantId)) {
      this.wallet(rewardedOwnerId).balance += BALLON_DOR_OWNER_REWARD;
      this.state.ledger.push({ id:`ballon-dor-owner-reward:${season.id}:${rewardedOwnerId}`, accountId:rewardedOwnerId, amount:BALLON_DOR_OWNER_REWARD, type:"ballon-dor-owner-reward", grantId, seasonId:season.id, playerId:winner.playerId, cardId:winner.cardId, teamId:winner.teamId, createdAt:result.awardedAt });
    }

    const championText = [winner.champions.league ? "联赛冠军" : null, winner.runnerUps.league ? "联赛亚军" : null, winner.champions.cup ? "杯赛冠军" : null, winner.runnerUps.cup ? "杯赛亚军" : null, winner.champions.seasonFinal ? "赛季总决赛冠军" : null, winner.runnerUps.seasonFinal ? "赛季总决赛亚军" : null].filter(Boolean).join("、") || "无冠亚军加成";
    const podiumText = podium.map((candidate) => `第${candidate.rank}名：${candidate.ownerName}的${candidate.playerName}（${candidate.teamName}），${candidate.score.toFixed(2)}分，${candidate.appearances}场${candidate.goals}球${candidate.assists}助攻，平均评分${candidate.averageRating.toFixed(2)}`).join("；");
    const awardDate = localDateKey(new Date(result.awardedAt));
    this.state.teams.filter((team) => team.ownerId).forEach((team) => {
      const rewarded = team.ownerId === rewardedOwnerId;
      this.pushInbox(team, {
        id:`ballon-dor:${season.id}:${team.ownerId}`,
        type:rewarded ? "reward" : "announcement",
        title:`${awardDate} 当日金球奖：${winner.ownerName}的${winner.playerName}`,
        summary:`${winner.ownerName}的${winner.playerName}以${winner.score.toFixed(2)}分当选，${winner.appearances}场贡献${winner.goals}球、${winner.assists}次助攻，平均评分${winner.averageRating.toFixed(2)}。`,
        body:`本次评选在赛季总决赛结束后进行，合并联赛与杯赛正式数据，参评门槛为至少${BALLON_DOR_MINIMUM_APPEARANCES}次出场，杯赛表现按${BALLON_DOR_CUP_WEIGHT}倍计入。${winner.playerName}的冠亚军情况：${championText}。得分构成为：进球${winner.breakdown.goals}分、助攻${winner.breakdown.assists}分、评分${winner.breakdown.rating}分、出场稳定性${winner.breakdown.appearances}分、联赛冠军${winner.breakdown.leagueChampion}分、联赛亚军${winner.breakdown.leagueRunnerUp}分、杯赛冠军${winner.breakdown.cupChampion}分、杯赛亚军${winner.breakdown.cupRunnerUp}分、赛季总决赛冠军${winner.breakdown.seasonFinalChampion}分、赛季总决赛亚军${winner.breakdown.seasonFinalRunnerUp}分。金球积分前三名：${podiumText}。${rewarded ? `你持有该球员卡，${BALLON_DOR_OWNER_REWARD.toLocaleString("zh-CN")}金币奖励已经到账。` : "获奖球员卡将永久累计一枚金色地球标识。"}`,
        payload:{ ballonDorResultId:result.id, winner:result.winner, podium, rewarded, rewardAmount:rewarded ? BALLON_DOR_OWNER_REWARD : 0 },
      });
    });
    return clone(result);
  }

  settleDailySeason(options = {}) {
    this.ensureDisciplineState();
    const season = this.state.season;
    if (season.status !== "completed") throw new Error("当前联赛尚未完成，不能发放赛季排名奖励");
    if (this.state.cup?.status !== "completed" || this.state.seasonFinalTournament?.status !== "completed") return null;
    const leagueRankingGiftSettlement = this.settleLeagueRankingGiftPacks();
    const settlementId = `${season.id}+daily-settlement`;
    const automation = this.state.dailyAutomation;
    const existing = automation.settlements.find((entry) => entry.id === settlementId);
    const hadBallonDorResult = this.state.ballonDor?.results?.some((entry) => entry.seasonId === season.id);
    const ballonDorResult = this.settleBallonDor();
    if (automation.lastRewardedSeasonId === season.id || existing?.status === "completed") {
      if (!hadBallonDorResult && ballonDorResult) this.save();
      return clone(existing ?? leagueRankingGiftSettlement);
    }
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

    const settlement = { id:settlementId, seasonId:season.id, seasonName:season.name, status:"completed", rewardedAt, recipients, ballonDorResultId:ballonDorResult?.id ?? null, leagueRankingGiftSettlementId:leagueRankingGiftSettlement?.id ?? null };
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
    const seasonFinalResolved = ["completed", "cancelled"].includes(this.state.seasonFinalTournament?.status) || this.seasonCompetitionDayExpired(now);
    if (process.env.YDL_OFFLINE_MODE !== "1" && this.state.season.status === "completed" && (this.state.cup?.status !== "completed" || !seasonFinalResolved)) {
      throw new Error("杯赛或赛季总决赛尚未结束，不能在金球奖完成评选前重置当日赛事");
    }
    if (process.env.YDL_OFFLINE_MODE !== "1" && !options.skipRewardCheck && this.state.season.status === "completed" && automation.lastRewardedSeasonId !== this.state.season.id) {
      throw new Error("当前已完赛联赛尚未发放排名奖励，请先手动补发奖励");
    }

    if (!options.skipBackup) this.backupFile(`before-daily-reset-${date}-${now}.json`);
    if (!options.skipHonorRoomUpdate) this.updateHonorRoomForCompletedSeason();
    if (!options.skipArchive) this.archiveSeason(options.reason ?? (options.manual ? "manual-daily-reset" : "automatic-daily-reset"));
    const completedSeasonId = this.state.season.id;
    this.state.teams.forEach((team) => {
      this.settleClubSponsorContractsForSeason(team, completedSeasonId);
      team.table = freshTable();
      team.form = [];
      team.fitnessUpdatedAt = now;
      team.rosterIds.forEach((playerId) => {
        team.playerState[playerId] = { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 };
      });
    });
    const seasonName = this.state.season.name;
    const firstRoundAt = nextSlot(now);
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
      seasonFinalLeagueRanks:null,
      seasonFinalLeagueRound:null,
      seasonFinalLeagueLockedAt:null,
    };
    // Keep a day's schedule stable across reloads while changing pairings between daily seasons.
    const dailyTeamOrder = seededShuffle(this.state.teams.map((team) => team.id), `league:${this.state.season.id}`);
    this.state.rounds = roundRobin(dailyTeamOrder);
    this.state.matches = [];
    this.state.playerStats = {};
    this.state.matchPredictions = { schemaVersion:1, markets:{}, bets:[], distributions:[] };
    this.state.completedBroadcasts = [];
    this.state.liveRound = null;
    this.state.liveCupRound = null;
    this.state.liveSeasonFinalRound = null;
    this.state.seasonFinalTournament = null;
    this.syncForcedSeedMirrorUploads();
    this.state.liveFriendlies = [];
    this.state.friendlyInvitations = [];
    this.state.friendlyFixtures = [];
    this.state.cup = { format:null, status:"waiting", stage:"waiting", participants:[], table:{}, leagueRounds:[], swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, finalStartedAt:null, completedAt:null };
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
    const seasonFinalResolved = ["completed", "cancelled"].includes(this.state.seasonFinalTournament?.status) || this.seasonCompetitionDayExpired(now);
    const seasonReadyForReset = process.env.YDL_OFFLINE_MODE === "1" || this.state.season.status !== "completed"
      || (this.state.cup?.status === "completed" && seasonFinalResolved && automation.lastRewardedSeasonId === this.state.season.id);
    if (date > automation.initializedDate && now >= resetAt && automation.lastResetDate !== date && seasonReadyForReset) {
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
    const staleSeasonFinalChanged = this.cancelExpiredSeasonFinal(now);
    if (staleSeasonFinalChanged) this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    const compensationChanged = measureRuntimeSync("league.compensation", () => this.dispatchS4TraitThresholdCompensation());
    const automationChanged = this.runDailyAutomation();
    measureRuntimeSync("league.predictionMarkets", () => this.ensurePredictionMarkets());
    const friendlyInvitationChanged = measureRuntimeSync("league.expireInvitations", () => this.expireFriendlyInvitations(now));
    if (friendlyInvitationChanged) this.save({ skipDailyBackup:true });
    const friendlyChanged = measureRuntimeSync("league.advanceFriendlies", () => this.advanceLiveFriendlies(now, { maximumMatches:0 })) || friendlyInvitationChanged;
    const tournament = this.ensureSeasonFinalTournament();
    const forcedMirrorChanged = this.syncForcedSeedMirrorUploads();
    const mirrorBatchChanged = this.state.liveRound || this.state.liveCupRound || this.state.liveSeasonFinalRound
      ? false
      : measureRuntimeSync("league.advanceMirrorBatchSimulations", () => this.advanceMirrorBatchSimulations(MIRROR_BATCH_MAX_ACTIVE_JOBS, { maximumChainsPerMatch:MIRROR_BATCH_CHAINS_PER_TICK }));
    if (forcedMirrorChanged) this.save({ scopes:["mirrorMarketplace"], skipDailyBackup:true });
    const seasonFinalBanChanged = this.finalizeSeasonFinalBansIfDue(tournament, now);
    if (seasonFinalBanChanged) this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    if (this.state.liveRound || this.state.liveCupRound || this.state.liveSeasonFinalRound) return friendlyChanged || automationChanged || compensationChanged || staleSeasonFinalChanged || seasonFinalBanChanged || forcedMirrorChanged || mirrorBatchChanged;
    if (tournament && !tournament.preview && tournament.status !== "completed" && now >= Number(tournament.nextMatchAt ?? Infinity)) {
      const nodes = this.dueSeasonFinalNodes(tournament, now);
      if (nodes.length && this.startSeasonFinalWave(nodes, tournament)) {
        this.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
        return true;
      }
    }
    if (this.state.cup.status === "active" && activeTime(now) && now >= Number(this.state.cup.nextRoundAt ?? Infinity)) {
      return measureRuntimeSync("league.startScheduledCupEvent", () => this.startScheduledCupEvent());
    }
    const dailyLeagueWindow = this.state.dailyAutomation.lastResetDate === localDateKey(new Date(now)) && now >= Number(this.state.season.firstRoundAt ?? Infinity);
    if (this.state.season.status !== "active" || (!activeTime(now) && !dailyLeagueWindow) || now < this.state.season.nextRoundAt) return friendlyChanged || automationChanged || compensationChanged || staleSeasonFinalChanged || seasonFinalBanChanged || forcedMirrorChanged || mirrorBatchChanged;
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

  ensureHonorRoomClub(team) {
    if (!team?.ownerId) return null;
    const clubs = this.state.honorRoom.clubs;
    const club = clubs[team.ownerId] ?? (clubs[team.ownerId] = {
      ownerId:team.ownerId,
      ownerName:team.ownerName,
      teamId:team.id,
      teamName:team.name,
      honors:{ league:[], cup:[], worldCup:[] },
      ballonDor:[],
      players:{},
    });
    club.ownerName = team.ownerName;
    club.teamId = team.id;
    club.teamName = team.name;
    club.honors ??= { league:[], cup:[], worldCup:[] };
    club.honors.league ??= [];
    club.honors.cup ??= [];
    club.honors.worldCup ??= [];
    club.ballonDor ??= [];
    club.players ??= {};
    return club;
  }

  updateHonorRoomForCompletedSeason() {
    const history = this.state.honorRoom;
    const season = this.state.season;
    if (season.status !== "completed" || history.processedSeasonIds.includes(season.id)) return false;
    const seasonNumber = Math.max(1, Number(history.nextSeasonNumber ?? history.processedSeasonIds.length + 1));
    const seasonLabel = `S${seasonNumber}`;
    const teamById = new Map(this.state.teams.filter((team) => team.ownerId).map((team) => [team.id, team]));
    const teamByOwner = new Map(this.state.teams.filter((team) => team.ownerId).map((team) => [team.ownerId, team]));
    const addStats = (entries) => Object.values(entries ?? {}).forEach((entry) => {
      const team = teamById.get(entry.teamId);
      const club = this.ensureHonorRoomClub(team);
      if (!club || !entry.playerId) return;
      const player = club.players[entry.playerId] ?? (club.players[entry.playerId] = {
        playerId:entry.playerId,
        playerName:entry.playerName ?? REAL_PLAYER_BY_ID[entry.playerId]?.name ?? entry.playerId,
        appearances:0,
        goals:0,
        assists:0,
        redCards:0,
        ratingTotal:0,
      });
      player.playerName = entry.playerName ?? player.playerName;
      player.appearances += Number(entry.appearances ?? 0);
      player.goals += Number(entry.goals ?? 0);
      player.assists += Number(entry.assists ?? 0);
      player.redCards = Number(player.redCards ?? 0) + Number(entry.redCards ?? 0);
      player.ratingTotal += Number(entry.ratingTotal ?? 0);
    });
    addStats(this.state.playerStats);
    addStats(this.state.cup?.playerStats);

    const leagueChampion = teamById.get(this.standings()[0]?.id);
    if (leagueChampion) this.ensureHonorRoomClub(leagueChampion).honors.league.push(seasonLabel);
    const cupChampion = this.state.cup?.status === "completed" ? teamById.get(this.state.cup.championId) : null;
    if (cupChampion) this.ensureHonorRoomClub(cupChampion).honors.cup.push(seasonLabel);

    const ballonDorResult = this.state.ballonDor?.results?.find((entry) => entry.seasonId === season.id && entry.status === "completed");
    const winner = ballonDorResult?.winner;
    const winnerTeam = winner?.ownerId ? teamByOwner.get(winner.ownerId) : null;
    if (winner && winnerTeam) this.ensureHonorRoomClub(winnerTeam).ballonDor.push({
      season:seasonLabel,
      seasonId:season.id,
      playerId:winner.playerId,
      playerName:winner.playerName,
    });

    history.processedSeasonIds.push(season.id);
    history.nextSeasonNumber = seasonNumber + 1;
    history.updatedAt = this.now();
    return true;
  }

  honorRoomPlayerView(ownerId, club, stat) {
    if (!stat) return null;
    const source = REAL_PLAYER_BY_ID[stat.playerId];
    const card = this.representativeCard(ownerId, stat.playerId);
    const upgradeLevel = Number(card?.upgradeLevel ?? 0);
    const awardCount = (club.ballonDor ?? []).filter((award) => award.playerId === stat.playerId).length;
    const player = source ? playerSummary(source) : { id:stat.playerId, name:stat.playerName, grade:"C", overall:0, role:null, club:"历史球员", nationality:"-" };
    const cardView = card
      ? { ...publicLeagueS4Card(this.state, card), ballonDorWins:Math.max(awardCount, Number(card.ballonDorWins ?? 0)) }
      : { upgradeLevel:0, effectiveOverall:Number(player.overall ?? 0), traits:[], ballonDorWins:awardCount };
    return {
      player,
      card:cardView,
      appearances:Number(stat.appearances ?? 0),
      goals:Number(stat.goals ?? 0),
      assists:Number(stat.assists ?? 0),
      redCards:Number(stat.redCards ?? 0),
      averageRating:stat.appearances ? Number((Number(stat.ratingTotal ?? 0) / Number(stat.appearances)).toFixed(2)) : 0,
      upgradeLevel,
    };
  }

  honorRoomView(account) {
    const team = this.accountTeam(account.id);
    if (!team) return null;
    const club = this.ensureHonorRoomClub(team);
    const players = Object.values(club.players ?? {});
    const appearances = [...players]
      .sort((left, right) => Number(right.appearances ?? 0) - Number(left.appearances ?? 0) || Number(right.goals ?? 0) - Number(left.goals ?? 0) || String(left.playerName).localeCompare(String(right.playerName), "zh-CN"))
      .slice(0, 3)
      .map((stat) => this.honorRoomPlayerView(account.id, club, stat));
    const scorerStats = [...players].filter((player) => Number(player.goals ?? 0) > 0).sort((left, right) => Number(right.goals ?? 0) - Number(left.goals ?? 0) || Number(right.appearances ?? 0) - Number(left.appearances ?? 0) || String(left.playerName).localeCompare(String(right.playerName), "zh-CN")).slice(0, 3);
    const assisterStats = [...players].filter((player) => Number(player.assists ?? 0) > 0).sort((left, right) => Number(right.assists ?? 0) - Number(left.assists ?? 0) || Number(right.appearances ?? 0) - Number(left.appearances ?? 0) || String(left.playerName).localeCompare(String(right.playerName), "zh-CN")).slice(0, 3);
    const redCardStats = [...players].filter((player) => Number(player.redCards ?? 0) > 0).sort((left, right) => Number(right.redCards ?? 0) - Number(left.redCards ?? 0) || Number(right.appearances ?? 0) - Number(left.appearances ?? 0) || String(left.playerName).localeCompare(String(right.playerName), "zh-CN")).slice(0, 3);
    const latestBallonDor = club.ballonDor?.at(-1) ?? null;
    const ballonStat = latestBallonDor ? club.players?.[latestBallonDor.playerId] ?? { playerId:latestBallonDor.playerId, playerName:latestBallonDor.playerName } : null;
    const ballonDorWinners = [...new Set((club.ballonDor ?? []).map((award) => award.playerId))].map((playerId) => {
      const awards = (club.ballonDor ?? []).filter((award) => award.playerId === playerId);
      const latestAward = awards.at(-1);
      const stat = club.players?.[playerId] ?? { playerId, playerName:latestAward?.playerName ?? playerId };
      return {
        playerId,
        playerName:latestAward?.playerName ?? stat.playerName,
        awardCount:awards.length,
        seasons:awards.map((award) => award.season),
        latestSeason:latestAward?.season ?? null,
        record:this.honorRoomPlayerView(account.id, club, stat),
      };
    }).sort((left, right) => right.awardCount - left.awardCount || String(right.latestSeason ?? "").localeCompare(String(left.latestSeason ?? ""), "zh-CN"));
    return clone({
      updatedAt:this.state.honorRoom.updatedAt,
      seasonCount:this.state.honorRoom.processedSeasonIds.length,
      club:{ ownerId:team.ownerId, ownerName:team.ownerName, teamId:team.id, teamName:team.name },
      honors:club.honors,
      appearances,
      scorers:scorerStats.map((stat) => this.honorRoomPlayerView(account.id, club, stat)),
      assisters:assisterStats.map((stat) => this.honorRoomPlayerView(account.id, club, stat)),
      redCardLeaders:redCardStats.map((stat) => this.honorRoomPlayerView(account.id, club, stat)),
      scorer:this.honorRoomPlayerView(account.id, club, scorerStats[0]),
      assister:this.honorRoomPlayerView(account.id, club, assisterStats[0]),
      redCardLeader:this.honorRoomPlayerView(account.id, club, redCardStats[0]),
      ballonDorWinners,
      ballonDor:latestBallonDor ? {
        ...latestBallonDor,
        awardCount:(club.ballonDor ?? []).filter((award) => award.playerId === latestBallonDor.playerId).length,
        record:this.honorRoomPlayerView(account.id, club, ballonStat),
      } : null,
    });
  }

  playerDirectoryView(account) {
    if (!this.accountTeam(account.id)) return { players:[], enhancementRanking:[] };
    // The directory is shared by every player and only changes after a persisted mutation.
    // Keep one immutable response snapshot per state revision instead of rebuilding its card index per request.
    if (this.playerDirectoryCache?.updatedAt !== this.state.updatedAt) {
      this.playerDirectoryCache = {
        updatedAt:this.state.updatedAt,
        value:publicS4PlayerDirectory(this.state),
      };
    }
    return clone(this.playerDirectoryCache.value);
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
    const archive = {
      reason,
      archivedAt:this.now(),
      season:this.state.season,
      standings:this.standings().map((entry) => ({ ...entry, team:publicTeam(this.state.teams.find((team) => team.id === entry.id)) })),
      matches:this.state.matches,
      playerStats:this.state.playerStats,
      cup:this.state.cup,
      seasonFinalTournament:this.state.seasonFinalTournament,
      ballonDorResult:this.state.ballonDor?.results?.find((entry) => entry.seasonId === this.state.season.id) ?? null,
    };
    this.state.archives.push(this.shardStore ? archive : clone(archive));
    if (this.state.archives.length > 12) this.state.archives.splice(0, this.state.archives.length - 12);
  }

  resetCompetition(name, reason, status = "active", options = {}) {
    if (process.env.YDL_OFFLINE_MODE !== "1" && this.state.season.status === "completed" && (this.state.cup?.status !== "completed" || this.state.seasonFinalTournament?.status !== "completed")) throw new Error("杯赛或赛季总决赛尚未结束，不能在金球奖完成评选前开启新赛季");
    if (this.state.season.status === "completed") this.settleBallonDor();
    this.archiveSeason(reason);
    const previousRanks = new Map(this.standings().map((entry) => [entry.id, entry.rank]));
    const completedSeasonId = this.state.season.id;
    this.state.teams.forEach((team) => {
      if (options.advanceSponsorContracts === true) this.settleClubSponsorContractsForSeason(team, completedSeasonId);
      team.table = freshTable();
      team.form = [];
      if (team.ownerId) {
        this.wallet(team.ownerId).balance = INITIAL_WALLET_BALANCE;
        team.rosterIds.forEach((id) => {
          team.playerState[id] = { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 };
        });
      }
    });
    // 休赛期跨过00:00后产生的镜像调用与新赛季重置可能处于同一自然日。
    // 钱包重置完成后一次结清全部待结算日期，避免严格“小于当天”导致收益永久滞留。
    this.settleMirrorMarketplace("9999-12-31");
    const startedAt = this.now();
    const firstRoundAt = status === "active" ? nextSlot(startedAt) : null;
    this.state.season = { id:`${name}-${localDateKey(new Date(startedAt))}-${startedAt.toString(36)}`, name, date:localDateKey(new Date(startedAt)), status, currentRound:0, totalRounds:18, nextRoundAt:firstRoundAt, firstRoundAt, startedAt:status === "active" ? startedAt : null, registrationOpenedAt:status === "registration" ? startedAt : null, completedAt:null, seasonFinalLeagueRanks:null, seasonFinalLeagueRound:null, seasonFinalLeagueLockedAt:null };
    this.state.rounds = roundRobin(this.state.teams.map((team) => team.id));
    this.state.matches = [];
    this.state.playerStats = {};
    this.state.seasonFinalTournament = null;
    this.syncForcedSeedMirrorUploads();
    this.state.ledger = [];
    this.state.adminPackGrants = [];
    this.state.adminCoinGrants = [];
    this.state.adminXGrowthGrants = [];
    this.state.reports = {};
    this.state.liveRound = null;
    this.state.liveCupRound = null;
    this.state.liveSeasonFinalRound = null;
    this.state.liveFriendlies = [];
    this.state.friendlyInvitations = [];
    this.state.friendlyFixtures = [];
    this.state.cup = { format:null, status:"waiting", stage:"waiting", participants:[], table:{}, leagueRounds:[], swissRounds:[], knockout:{ quarterfinals:[], semifinals:[], final:[] }, events:[], playerStats:{}, nextRoundAt:null, championId:null, startedAt:null, finalStartedAt:null, completedAt:null };
    this.save();
    return this.adminView();
  }

  restartSeason() {
    return this.resetCompetition(this.state.season.name, "restarted");
  }

  startNewSeason() {
    const current = Number(String(this.state.season.name).match(/\d+/)?.[0] ?? 1);
    return this.resetCompetition(`S${current + 1}`, "new-season", "registration", { advanceSponsorContracts:true });
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
      "cosmetic-buy":"徽章道具买入",
      "cosmetic-sale":"徽章道具售出",
      "ownership-return":"球员所有权返还系统",
      "s4-pack-buy":"S4礼包购买",
      "roster-expansion-buy":"付费大名单扩容",
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
      const transfers = entries.filter((entry) => ["transfer-buy", "transfer-sale", "card-buy", "card-sale", "ownership-buy", "ownership-sale", "cosmetic-buy", "cosmetic-sale", "card-trade-escrow", "card-trade-refund", "card-trade-settlement"].includes(entry.type));
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

  adminSimulationBaseline() {
    const teams = this.state.teams
      .filter((team) => team.ownerId)
      .map((team) => {
        const account = { id:team.ownerId };
        const view = this.ownTeamView(account);
        const roster = (view?.roster ?? []).map((player) => {
          const card = player.cards?.find((entry) => entry.id === player.activeCardId) ?? player.cards?.[0] ?? null;
          const source = REAL_PLAYER_BY_ID[player.id] ?? player;
          return {
            ...applyS4Enhancement(playerSummary(source), card?.upgradeLevel ?? player.upgradeLevel ?? 0),
            state:player.state ?? { fitness:100 },
            starter:Boolean(player.starter),
            traits:(card?.traits ?? []).map((trait) => trait.id),
          };
        });
        return {
          id:team.id,
          ownerId:team.ownerId,
          ownerName:team.ownerName,
          name:team.name,
          players:roster,
          preferredStarterIds:[...(team.preferredStarterIds ?? [])],
          positions:clone(team.positions ?? {}),
          positionPresets:clone(team.positionPresets ?? {}),
          formationLinePresets:clone(team.formationLinePresets ?? {}),
          tactic:team.tactic,
          style:team.style,
          attackFocus:team.attackFocus,
          defenseFocus:team.defenseFocus,
          tacticalPlans:clone(team.tacticalPlans ?? {}),
          activeLineupSchemeId:team.activeLineupSchemeId ?? null,
          lineupSchemes:clone(team.lineupSchemes ?? []),
          lineupSchemeAssignments:clone(team.lineupSchemeAssignments ?? {}),
        };
      });
    return clone({ generatedAt:this.now(), season:this.state.season, teams });
  }

  adminPredictionBetsToday(nowValue = this.now()) {
    const dateKey = localDateKey(new Date(nowValue));
    const startsAt = beijingTimestamp(dateKey, 0);
    const endsAt = startsAt + 24 * 60 * 60 * 1000;
    const markets = this.state.matchPredictions?.markets ?? {};
    const todayBets = (this.state.matchPredictions?.bets ?? [])
      .filter((bet) => Number(bet.createdAt) >= startsAt && Number(bet.createdAt) < endsAt)
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
    const playerTeams = this.state.teams
      .filter((team) => team.ownerId)
      .sort((left, right) => String(left.ownerName).localeCompare(String(right.ownerName), "zh-CN"));
    const detailsFor = (bets) => bets.map((bet) => {
      const market = markets[bet.marketId];
      const payoutRate = Number(bet.payoutRate ?? 0);
      const amount = Number(bet.amount ?? 0);
      const payout = Number(bet.payout ?? 0);
      const settled = bet.status === "won" || bet.status === "lost";
      const outcome = market?.settlement?.outcomes?.[bet.category] ?? null;
      return {
        id:bet.id,
        marketId:bet.marketId,
        createdAt:Number(bet.createdAt),
        settledAt:bet.settledAt == null ? null : Number(bet.settledAt),
        status:bet.status,
        competition:market?.competition ?? null,
        competitionName:market?.competitionName ?? "未知赛事",
        round:market?.round ?? null,
        stage:market?.stage ?? null,
        leg:market?.leg ?? null,
        startsAt:market?.startsAt ?? null,
        homeName:market?.homeName ?? "未知主队",
        awayName:market?.awayName ?? "未知客队",
        resultHandicap:Number.isInteger(market?.resultHandicap) ? market.resultHandicap : null,
        category:bet.category,
        categoryLabel:this.predictionCategoryLabel(bet.category),
        selection:bet.selection,
        selectionLabel:market ? this.predictionSelectionLabel(market, bet.category, bet.selection) : bet.selection,
        outcome,
        outcomeLabel:market && outcome ? this.predictionSelectionLabel(market, bet.category, outcome) : null,
        score:Array.isArray(market?.settlement?.score) ? [...market.settlement.score] : null,
        halfTimeScore:Array.isArray(market?.settlement?.halfTimeScore) ? [...market.settlement.halfTimeScore] : null,
        regulationScore:Array.isArray(market?.settlement?.regulationScore) ? [...market.settlement.regulationScore] : null,
        amount,
        payoutRate,
        potentialPayout:payoutRate > 0 ? Math.max(1, Math.floor(amount * payoutRate)) : 0,
        payout,
        netProfit:settled ? payout - amount : null,
      };
    });
    const summarize = (bets) => {
      const settled = bets.filter((bet) => bet.status === "won" || bet.status === "lost");
      const pending = bets.filter((bet) => bet.status === "pending");
      const totalStake = bets.reduce((sum, bet) => sum + Number(bet.amount ?? 0), 0);
      const settledStake = settled.reduce((sum, bet) => sum + Number(bet.amount ?? 0), 0);
      const pendingStake = pending.reduce((sum, bet) => sum + Number(bet.amount ?? 0), 0);
      const payout = settled.reduce((sum, bet) => sum + Number(bet.payout ?? 0), 0);
      return {
        betCount:bets.length,
        settledCount:settled.length,
        pendingCount:pending.length,
        wonCount:settled.filter((bet) => bet.status === "won").length,
        lostCount:settled.filter((bet) => bet.status === "lost").length,
        totalStake,
        settledStake,
        pendingStake,
        payout,
        realizedNet:payout - settledStake,
      };
    };
    const players = playerTeams.map((team) => {
      const bets = todayBets.filter((bet) => bet.accountId === team.ownerId);
      return {
        accountId:team.ownerId,
        ownerName:team.ownerName,
        teamId:team.id,
        teamName:team.name,
        ...summarize(bets),
        bets:detailsFor(bets),
      };
    });
    return unwrapTracked({
      dateKey,
      startsAt,
      endsAt,
      generatedAt:Number(nowValue),
      timezone:"Asia/Shanghai",
      totals:summarize(todayBets),
      players,
    });
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
      seasonFinalTournament:this.seasonFinalTournamentView(),
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
      s4PackCatalog:[...S4_PACK_CATALOG, ...S4_ADMIN_GIFT_PACK_CATALOG].map((pack) => ({ ...pack })),
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
      archives:(this.state.archives ?? []).map((archive) => ({ reason:archive.reason, archivedAt:archive.archivedAt, season:archive.season, matchCount:archive.matchCount ?? archive.matches?.length ?? 0 })),
    });
  }
}

export const yellowDogsLeague = new YellowDogsLeagueService();
