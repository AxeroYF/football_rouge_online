import { positionFitScore, roleGroup } from "../../game/public/schema.js";
import { analyzeElevenBoardFormation, inferElevenBoardRoles } from "../public/formation-rules.js";
import { activeCaptain } from "../public/captain-rules.js";
import { calculateV2StructureFit, calculateV2TacticalFit } from "../public/v2-tactical-fit.js";
import {
  DEFAULT_IN_POSSESSION_DETAILS,
  DEFAULT_OUT_OF_POSSESSION_DETAILS,
  hasV2SplitTacticalPlan,
  resolveV2SplitTacticalPlan,
  v2SplitTacticalAdjustments,
  v2TacticalDetailAdjustments,
  v2TacticalProfileAdjustments,
} from "../public/v2-tactical-profiles.js";
import { YDL_TRAIT_BY_ID } from "../trait-pool.js";
import { simulateV2PossessionChain } from "./possession-chain-v2.js";
import { v2EngineAttributeValue, V2_MATCH_PARAMETERS } from "./match-parameters-v2.js";
import { resolveV2TacticalDimensions } from "./spatial-model-v2.js";
import { buildV2TeamSnapshots } from "./team-snapshot-v2.js";
import { v2AttackingCommitmentProfile } from "./tactical-balance-v2.js";
import { automaticSubstitutionRank, compareAutomaticSubstitutes } from "../automatic-substitution.js";
import {
  resolveV2PlayerDuty,
  v2DutyDefenderMultiplier,
  v2DutyFatigueMultiplier,
  v2DutyShotPreference,
} from "./player-duties-v2.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const SHOT_TYPE_LABELS = Object.freeze({
  throughBall:"直塞配合",
  cross:"传中",
  cutback:"倒三角回敲",
  counter:"快速反击",
  longShot:"远射",
  setPiece:"定位球",
  freeKick:"直接任意球",
  rebound:"补射",
  penalty:"点球",
  individual:"个人突破",
  soloCounter:"抢断后单刀",
});
const SHOT_BODY_PART_LABELS = Object.freeze({ header:"头球", leftFoot:"左脚", rightFoot:"右脚", other:"其他部位" });
const PLAN_LABELS = Object.freeze({ opening:"默认", leading:"领先", trailing:"落后" });
const WEATHER_LABELS = Object.freeze({ sunny:"晴朗", rain:"雨天", storm:"雷暴", snow:"雪天", superStorm:"超级雷暴" });
const ZONE_LABELS = Object.freeze({
  defensiveThird:"后场", buildUp:"本方半场", finalThird:"前场", box:"禁区",
  farLeft:"左路", leftHalfSpace:"左侧肋部", center:"中路", rightHalfSpace:"右侧肋部", farRight:"右路",
});
const DOT_REPLAY_EVENT_TYPES = new Set(["kickoff", "goal", "ownGoal", "save", "miss", "block", "penalty", "penaltyAwarded", "offside", "yellow", "red", "injury", "substitution", "fulltime"]);
const DOT_REPLAY_LANE_X = Object.freeze({ farLeft:10, leftHalfSpace:30, center:50, rightHalfSpace:70, farRight:90 });
const DOT_REPLAY_BAND_Y = Object.freeze({ defensiveThird:84, buildUp:64, finalThird:31, box:9 });

function zoneLabel(zone) {
  const [band, lane] = String(zone ?? "").split(":");
  return `${ZONE_LABELS[band] ?? "场上"}${ZONE_LABELS[lane] ?? "区域"}`;
}
const DEEP_BLOCK_MENTALITY_CEILING = 52;

function isDeepBlockPlan(plan = {}) {
  if (plan.outOfPossession === "lowBlock") return true;
  if (hasV2SplitTacticalPlan(plan)) return resolveV2SplitTacticalPlan(plan).defensiveBlock === "lowBlock";
  return plan.style === "lowBlock";
}

export function tacticalDimensionsForPlan(plan = {}) {
  const adjustments = v2TacticalProfileAdjustments(plan.inPossession, plan.outOfPossession);
  Object.entries(v2TacticalDetailAdjustments(plan.inPossessionDetails, plan.outOfPossessionDetails)).forEach(([key, value]) => { adjustments[key] = Number(adjustments[key] ?? 0) + Number(value); });
  if (!hasV2SplitTacticalPlan(plan)) {
    const legacyDetails = {
      tempo:{ patient:-18, cautious:-9, balanced:0, quick:11, extreme:22 }[plan.inPossessionDetails?.tempo] ?? 0,
      directness:{ short:-24, shorter:-12, balanced:0, longer:13, direct:26 }[plan.inPossessionDetails?.directness] ?? 0,
      pressing:{ retreat:-24, low:-12, standard:0, high:14, relentless:27 }[plan.outOfPossessionDetails?.pressing] ?? 0,
      compactness:{ loose:-16, balanced:0, tight:18 }[plan.outOfPossessionDetails?.compactness] ?? 0,
    };
    Object.entries(legacyDetails).forEach(([key, value]) => { adjustments[key] = Number(adjustments[key] ?? 0) + Number(value); });
  }
  const custom = structuredClone(plan.tacticalDimensions ?? {});
  if (hasV2SplitTacticalPlan(plan)) {
    const splitAdjustments = v2SplitTacticalAdjustments(plan);
    const base = resolveV2TacticalDimensions(plan.tactic, "__split__", {});
    Object.entries(splitAdjustments).forEach(([key, value]) => {
      if (!Object.hasOwn(custom, key)) custom[key] = round(clamp(Number(base[key] ?? 50) + Number(value), 0, 100), 2);
    });
  }
  let dimensions;
  if (!Object.keys(adjustments).length) {
    dimensions = hasV2SplitTacticalPlan(plan) ? resolveV2TacticalDimensions(plan.tactic, "__split__", custom) : custom;
  } else {
    const resolved = resolveV2TacticalDimensions(plan.tactic, hasV2SplitTacticalPlan(plan) ? "__split__" : plan.style, custom);
    Object.entries(adjustments).forEach(([key, value]) => { custom[key] = round(clamp(Number(resolved[key] ?? 50) + Number(value), 0, 100), 2); });
    dimensions = hasV2SplitTacticalPlan(plan) ? resolveV2TacticalDimensions(plan.tactic, "__split__", custom) : custom;
  }
  // A deep block and an aggressive mentality must not stack: parking the bus
  // cannot simultaneously keep all-out-attack mentality. Cap mentality at a
  // near-neutral ceiling so a low block keeps its defensive identity without
  // also receiving the forward-mentality attacking benefits.
  if (isDeepBlockPlan(plan)) {
    const resolvedMentality = resolveV2TacticalDimensions(plan.tactic, hasV2SplitTacticalPlan(plan) ? "__split__" : plan.style, custom).mentality;
    dimensions = { ...dimensions, mentality: Math.min(Number(resolvedMentality ?? 50), DEEP_BLOCK_MENTALITY_CEILING) };
  }
  return dimensions;
}

export function tacticalDetailsForPlan(plan = {}, team = {}) {
  const inPossessionDetails = { ...DEFAULT_IN_POSSESSION_DETAILS, ...(plan.inPossessionDetails ?? {}) };
  const outOfPossessionDetails = { ...DEFAULT_OUT_OF_POSSESSION_DETAILS, ...(plan.outOfPossessionDetails ?? {}) };
  if (inPossessionDetails.attackDirection === "balanced" && team.attackFocus && team.attackFocus !== "balanced") inPossessionDetails.attackDirection = team.attackFocus;
  if (outOfPossessionDetails.defenseDirection === "balanced" && team.defenseFocus && team.defenseFocus !== "balanced") outOfPossessionDetails.defenseDirection = team.defenseFocus;
  return { inPossessionDetails, outOfPossessionDetails };
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededEventRoll(match, event, teamIndex, chainIndex, playerId = "") {
  return hashSeed(`${match.simulationSeed}:${event}:${teamIndex}:${chainIndex}:${playerId}`) / 4294967296;
}

function resolveSuperStormStopMinute(seed, range, requestedMinute) {
  const minimum = clamp(Math.round(Number(range?.minimum ?? 61)), 61, 89);
  const maximum = clamp(Math.round(Number(range?.maximum ?? 89)), minimum, 89);
  const requested = Number(requestedMinute);
  return Number.isFinite(requested)
    ? clamp(Math.round(requested), minimum, maximum)
    : minimum + hashSeed(`${seed}:super-storm-stop`) % (maximum - minimum + 1);
}

export function createV2MatchRng(seed = "ydl-v2") {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function cloneTeam(team, index) {
  const opening = team.tacticalPlans?.opening ?? {
    tactic:team.tactic ?? "balanced",
    style:team.style ?? "possession",
    possessionStyle:team.possessionStyle,
    defensiveBlock:team.defensiveBlock,
    transitionStyle:team.transitionStyle,
    duelIntensity:team.duelIntensity,
    positionPreset:"position1",
  };
  const split = resolveV2SplitTacticalPlan(opening);
  const details = tacticalDetailsForPlan(opening, team);
  const positions = structuredClone(team.positionPresets?.[opening.positionPreset] ?? team.positions ?? {});
  const formationLines = structuredClone(team.formationLinePresets?.[opening.positionPreset] ?? team.formationLines ?? null);
  const assignedRoles = inferElevenBoardRoles((team.players ?? []).map((player) => ({ id:player.id, position:positions[player.id] })), formationLines);
  return {
    ...structuredClone(team),
    index,
    tactic:opening.tactic,
    structureRoles:assignedRoles,
    style:opening.style,
    ...split,
    splitTacticsExplicit:hasV2SplitTacticalPlan(opening),
    inPossession:opening.inPossession ?? "balanced",
    outOfPossession:opening.outOfPossession ?? "balanced",
    inPossessionDetails:details.inPossessionDetails,
    outOfPossessionDetails:details.outOfPossessionDetails,
    tacticalDimensions:tacticalDimensionsForPlan({ ...opening, tacticalDimensions:opening.tacticalDimensions ?? team.tacticalDimensions ?? {} }),
    openingPlan:structuredClone(opening),
    playerDuties:structuredClone(opening.playerDuties ?? {}),
    positions,
    formationLines,
    activePlan:"opening",
    score:0,
    stats:{ possessions:0, normalPossessions:0, transitionPossessions:0, possessionSeconds:0, normalPossessionSeconds:0, transitionPossessionSeconds:0, possessionControl:0, shots:0, normalShots:0, transitionShots:0, shotsOnTarget:0, blockedShots:0, goals:0, xg:0, normalXg:0, transitionXg:0, saves:0, tackles:0, interceptions:0, clearances:0, setPieceClearances:0, blocks:0, pressuresWon:0, corners:0, fouls:0, yellowCards:0, redCards:0, injuries:0, substitutions:0, setPieces:0, penalties:0 },
    players:(team.players ?? []).map((player) => ({
      ...structuredClone(player),
      assignedRole:assignedRoles[player.id] ?? player.assignedRole ?? player.role,
      tacticalDuty:resolveV2PlayerDuty(assignedRoles[player.id] ?? player.assignedRole ?? player.role, opening.playerDuties?.[player.id] ?? null),
      boardPosition:structuredClone(positions[player.id] ?? player.boardPosition ?? null),
      active:player.active !== false,
      startedMatch:player.active !== false,
      sentOff:false,
      injury:null,
      state:{ ...structuredClone(player.state ?? {}), fitness:Number(player.state?.fitness ?? player.fitness ?? 100) },
      matchStats:{ shots:0, shotsOnTarget:0, goals:0, assists:0, tackles:0, interceptions:0, clearances:0, setPieceClearances:0, blocks:0, pressuresWon:0, saves:0, yellowCards:0, redCards:0, fouls:0 },
    })),
  };
}

function traitHook(player, hook) {
  const definitions = player?.traitDefinitions ?? (player?.traits ?? []).map((entry) => YDL_TRAIT_BY_ID[typeof entry === "string" ? entry : entry?.id]).filter(Boolean);
  return definitions.flatMap((trait) => (trait.rules ?? []).map((rule) => ({ ...rule, traitId:trait.id, traitName:trait.name }))).find((rule) => rule.hook === hook);
}

function injuryImmune(player) {
  return Boolean(traitHook(player, "injury")?.immune || traitHook(player, "injuryImmune")?.immune);
}

function activePlayers(team) {
  return team.players.filter((player) => player.active !== false);
}

function injuryTransferProtector(team, injuredPlayer) {
  for (const candidate of activePlayers(team)) {
    if (candidate.id === injuredPlayer?.id) continue;
    const rule = traitHook(candidate, "teamInjuryTransfer");
    if (rule?.transferToSelf) return { player:candidate, rule };
  }
  return null;
}

function metric(player, weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + Number(player?.attributes?.[key] ?? 50) * weight, 0) / total;
}

function snapshotPlayer(match, teamIndex, playerId) {
  return match.snapshotTeams?.[teamIndex]?.players?.find((player) => player.id === playerId) ?? null;
}

function effectiveMetric(match, teamIndex, player, weights) {
  const snapshot = snapshotPlayer(match, teamIndex, player.id);
  if (snapshot) return metric(snapshot, weights);
  return metric({
    ...player,
    attributes:Object.fromEntries(Object.entries(player?.attributes ?? {}).map(([key, value]) => [key, v2EngineAttributeValue(value, match.parameters)])),
  }, weights);
}

function displayMetric(match, teamIndex, player, weights) {
  const snapshot = snapshotPlayer(match, teamIndex, player.id);
  if (!snapshot?.displayAttributes) return metric(player, weights);
  return metric({ ...snapshot, attributes:snapshot.displayAttributes }, weights);
}

function pick(match, entries, weight = () => 1) {
  if (!entries.length) return null;
  const values = entries.map((entry) => Math.max(0.001, Number(weight(entry)) || 0.001));
  let roll = match.rng() * values.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < entries.length; index += 1) {
    roll -= values[index];
    if (roll <= 0) return entries[index];
  }
  return entries.at(-1);
}

function highestAttributePlayer(match, teamIndex, candidates, attribute) {
  return [...candidates].sort((left, right) => {
    const difference = effectiveMetric(match, teamIndex, right, { [attribute]:1 })
      - effectiveMetric(match, teamIndex, left, { [attribute]:1 });
    return difference || String(left.id).localeCompare(String(right.id));
  })[0] ?? null;
}

function replayWorldPoint(position, teamIndex) {
  const x = clamp(Number(position?.x ?? 50), 0, 100);
  const y = clamp(Number(position?.y ?? 50), 0, 100);
  return teamIndex === 1 ? { x:round(100 - x, 2), y:round(100 - y, 2) } : { x:round(x, 2), y:round(y, 2) };
}

function replayShapeFromTeams(match) {
  return {
    modelVersion:match.parameters?.dynamicShape?.modelVersion ?? null,
    stage:"static",
    attackingTeamIndex:null,
    ballLane:"center",
    possessionType:"normal",
    teams:match.teams.map((team, teamIndex) => ({
      teamIndex,
      players:team.players.filter((player) => player.active).map((player) => ({
        id:player.id,
        role:player.assignedRole ?? player.role,
        ...team.positions?.[player.id],
      })),
    })),
  };
}

function dotReplayBall(match, event, shape) {
  if (event.type === "kickoff") return { x:50, y:50 };
  if (event.type === "fulltime" && match.lastDotReplayBall) return { ...match.lastDotReplayBall };
  const [band, lane] = String(event.zone ?? `${shape?.stage === "shot" ? "box" : "buildUp"}:${shape?.ballLane ?? "center"}`).split(":");
  const attackingTeamIndex = Number(event.attackingTeamIndex ?? shape?.attackingTeamIndex ?? event.teamIndex);
  return replayWorldPoint({ x:DOT_REPLAY_LANE_X[lane] ?? 50, y:DOT_REPLAY_BAND_Y[band] ?? 50 }, attackingTeamIndex === 1 ? 1 : 0);
}

function dotReplayTeams(match, shape, includeIdentity = false) {
  const playersByTeam = match.teams.map((team) => new Map(team.players.map((player) => [player.id, player])));
  return shape.teams.map((shapeTeam) => ({
    teamIndex:shapeTeam.teamIndex,
    players:shapeTeam.players.map((position) => {
      const player = playersByTeam[shapeTeam.teamIndex]?.get(position.id);
      return {
        id:position.id,
        ...(includeIdentity ? { name:player?.name ?? position.id, role:position.role ?? player?.assignedRole ?? player?.role ?? null } : {}),
        ...replayWorldPoint(position, shapeTeam.teamIndex),
      };
    }),
  }));
}

function dotReplayTerminalBall(event, ball, teams, attackingTeamIndex) {
  const attackingRight = Number(attackingTeamIndex) === 1;
  const goalDepth = attackingRight ? 102 : -2;
  if (["goal", "ownGoal"].includes(event.type)) return { x:round(clamp(ball.x, 42, 58), 2), y:goalDepth };
  if (event.type === "miss") return { x:round(ball.x < 50 ? Math.max(3, ball.x - 12) : Math.min(97, ball.x + 12), 2), y:goalDepth };
  if (["save", "block"].includes(event.type)) {
    const targetId = event.type === "save" ? event.actorId : event.actorId ?? event.opponentId;
    const target = teams.flatMap((team) => team.players).find((player) => player.id === targetId);
    if (target) return { x:target.x, y:target.y };
  }
  return { ...ball };
}

function dotReplayActorBall(teams, actorId, attackingTeamIndex, fallback) {
  if (!actorId) return fallback;
  const actor = teams.find((team) => team.teamIndex === attackingTeamIndex)?.players.find((player) => player.id === actorId)
    ?? teams.flatMap((team) => team.players).find((player) => player.id === actorId);
  if (!actor) return fallback;
  return {
    x:round(clamp(Number(actor.x) + 1.4, 0, 100), 2),
    y:round(clamp(Number(actor.y) + (Number(attackingTeamIndex) === 1 ? 1.2 : -1.2), 0, 100), 2),
  };
}

function dotReplayShotLocation(event, actor, attackingTeamIndex) {
  const attackType = event?.attackType ?? null;
  const direction = Number(attackingTeamIndex) === 1 ? 1 : -1;
  const attackingDepth = attackType === "penalty" ? 89
    : attackType === "rebound" ? 90
      : attackType === "longShot" ? 76
        : attackType === "freeKick" ? 78
          : ["cross", "setPiece"].includes(attackType) || event?.bodyPart === "header" ? 88
            : attackType === "cutback" ? 85
              : clamp(86 + Number(event?.xg ?? 0) * 7, 86, 90);
  const lateralRange = attackType === "penalty" ? [50, 50]
    : ["cross", "setPiece"].includes(attackType) || event?.bodyPart === "header" ? [31, 69]
      : attackType === "cutback" ? [28, 72]
        : [24, 76];
  return {
    x:round(clamp(Number(actor?.x ?? 50), lateralRange[0], lateralRange[1]), 2),
    y:round(direction === 1 ? attackingDepth : 100 - attackingDepth, 2),
  };
}

function dotReplayOffsideShape(attacking, defending, actor, attackingTeamIndex, playerRole) {
  const direction = Number(attackingTeamIndex) === 1 ? 1 : -1;
  const defendersByGoalDepth = defending.players
    .map((player) => ({ player, depth:direction * Number(player.y) }))
    .sort((left, right) => right.depth - left.depth);
  const secondLast = defendersByGoalDepth[1]?.player ?? defendersByGoalDepth[0]?.player ?? null;
  if (!secondLast) return { line:null, secondLastDefenderId:null, ballLine:Number(actor.y) };
  const ballLine = Number(actor.y);
  const rawLine = direction === 1 ? Math.max(ballLine, Number(secondLast.y)) : Math.min(ballLine, Number(secondLast.y));
  const line = direction === 1 ? Math.min(rawLine - 0.65, 94) : Math.max(rawLine + 0.65, 6);
  attacking.players.forEach((player) => {
    if (player.id === actor.id || playerRole(player.id, Number(attackingTeamIndex)) === "GK") return;
    const inOpposingHalf = direction === 1 ? Number(player.y) > 50 : Number(player.y) < 50;
    if (!inOpposingHalf) return;
    player.y = direction === 1 ? Math.min(Number(player.y), line) : Math.max(Number(player.y), line);
  });
  return { line:round(line, 2), secondLastDefenderId:secondLast.id, ballLine:round(ballLine, 2) };
}

function dotReplayReactiveTeams(match, sourceTeams, { attackingTeamIndex, actorId, defenderId, stage, action, ball, event = null }) {
  const teams = structuredClone(sourceTeams);
  const emptyResult = { teams, defensiveRoles:{ pressureId:null, coverIds:[], markerIds:[] }, offside:{ line:null, secondLastDefenderId:null, ballLine:null } };
  if (![0, 1].includes(Number(attackingTeamIndex)) || !actorId) return emptyResult;
  const attackIndex = Number(attackingTeamIndex);
  const attacking = teams.find((team) => team.teamIndex === attackIndex);
  const defending = teams.find((team) => team.teamIndex === 1 - attackIndex);
  const actor = attacking?.players.find((player) => player.id === actorId);
  if (!attacking || !defending || !actor) return emptyResult;
  const direction = attackIndex === 1 ? 1 : -1;
  const lateStage = ["finalThird", "chance", "assist", "shot", "goal", "ownGoal"].includes(stage);
  const actionIntensity = ({ keyPass:1.2, shot:1.65, shotOutcome:1.35 })[action] ?? (lateStage ? 0.8 : 0.45);
  const playerRole = (playerId, teamIndex) => {
    const source = match.teams[teamIndex]?.players.find((player) => player.id === playerId)
      ?? match.teams.flatMap((team) => team.players).find((player) => player.id === playerId);
    return roleGroup(source?.assignedRole ?? source?.role);
  };

  if (action === "shot") Object.assign(actor, dotReplayShotLocation(event, actor, attackIndex));
  else if (action === "keyPass") actor.y = clamp(actor.y + direction * actionIntensity, 1, 99);
  const supportCandidates = attacking.players
    .filter((player) => player.id !== actorId && playerRole(player.id, attackIndex) !== "GK")
    .sort((left, right) => {
      const rolePriority = (player) => ({ ATT:0, MID:1, DEF:2 })[playerRole(player.id, attackIndex)] ?? 3;
      return rolePriority(left) - rolePriority(right)
        || Math.hypot(left.x - actor.x, left.y - actor.y) - Math.hypot(right.x - actor.x, right.y - actor.y);
    });
  const supportRunRanks = new Map(supportCandidates.slice(0, 3).map((player, index) => [player.id, index]));
  attacking.players.forEach((player) => {
    if (player.id === actorId) return;
    const group = playerRole(player.id, attackIndex);
    if (group === "GK") return;
    if (supportRunRanks.has(player.id)) {
      const runRank = supportRunRanks.get(player.id);
      const laneOffset = [-7, 7, 0][runRank] ?? 0;
      const runDepth = lateStage ? [3.8, 3, 1.9][runRank] : [2.4, 1.9, 1.2][runRank];
      player.x = clamp(player.x + (actor.x + laneOffset - player.x) * 0.14 * actionIntensity, 1, 99);
      player.y = clamp(player.y + direction * runDepth * actionIntensity, 1, 99);
      return;
    }
    if (group === "ATT" && lateStage) {
      const awayFromActor = Math.sign(player.x - actor.x) || (String(player.id).localeCompare(String(actorId)) < 0 ? -1 : 1);
      player.x = clamp(player.x + awayFromActor * 0.58 * actionIntensity, 1, 99);
      player.y = clamp(player.y + direction * 2.7 * actionIntensity, 1, 99);
      return;
    }
    const unitShift = group === "MID" ? 1.15 : group === "DEF" ? 0.34 : 0.16;
    player.x = clamp(player.x + (actor.x - player.x) * (group === "MID" ? 0.045 : 0.02) * actionIntensity, 1, 99);
    player.y = clamp(player.y + direction * unitShift * actionIntensity, 1, 99);
  });
  const offside = dotReplayOffsideShape(attacking, defending, actor, attackIndex, playerRole);

  const explicitDefender = defending.players.find((player) => player.id === defenderId);
  const outfield = defending.players.filter((player) => playerRole(player.id, 1 - attackIndex) !== "GK");
  const pressureDefender = explicitDefender && playerRole(explicitDefender.id, 1 - attackIndex) !== "GK"
    ? explicitDefender
    : [...outfield].sort((left, right) => Math.hypot(left.x - actor.x, left.y - actor.y) - Math.hypot(right.x - actor.x, right.y - actor.y))[0];
  const coverDefenders = [...outfield]
    .filter((player) => player.id !== pressureDefender?.id && ["DEF", "MID"].includes(playerRole(player.id, 1 - attackIndex)))
    .sort((left, right) => Math.hypot(left.x - actor.x, left.y - actor.y) - Math.hypot(right.x - actor.x, right.y - actor.y))
    .slice(0, 2);
  const assignedIds = new Set([pressureDefender?.id, ...coverDefenders.map((player) => player.id)].filter(Boolean));
  const dangerousAttackers = attacking.players
    .filter((player) => player.id !== actorId && playerRole(player.id, attackIndex) !== "GK")
    .sort((left, right) => (direction * (right.y - left.y)) - (direction * (left.y - right.y))
      || Math.hypot(left.x - actor.x, left.y - actor.y) - Math.hypot(right.x - actor.x, right.y - actor.y));
  const markerAssignments = [];
  const availableMarkers = outfield.filter((player) => !assignedIds.has(player.id) && ["DEF", "MID"].includes(playerRole(player.id, 1 - attackIndex)));
  dangerousAttackers.slice(0, Math.min(3, availableMarkers.length)).forEach((target) => {
    const marker = [...availableMarkers]
      .filter((player) => !assignedIds.has(player.id))
      .sort((left, right) => Math.hypot(left.x - target.x, left.y - target.y) - Math.hypot(right.x - target.x, right.y - target.y))[0];
    if (!marker) return;
    assignedIds.add(marker.id);
    markerAssignments.push({ marker, target });
  });
  defending.players.forEach((player) => {
    const group = playerRole(player.id, 1 - attackIndex);
    if (group === "GK") {
      const targetX = Number(ball?.x ?? actor.x);
      player.x = clamp(player.x + (targetX - player.x) * 0.18 * actionIntensity, 1, 99);
      return;
    }
    if (assignedIds.has(player.id)) return;
    const blockTargetX = actor.x + (50 - actor.x) * (group === "DEF" ? 0.42 : 0.24);
    const blockTargetY = actor.y + direction * (group === "DEF" ? 13 : group === "MID" ? 7 : 1);
    const blockReaction = action === "shot" ? (group === "DEF" ? 0.28 : 0.21) : group === "DEF" ? 0.15 : 0.1;
    player.x = clamp(player.x + (blockTargetX - player.x) * blockReaction, 1, 99);
    player.y = clamp(player.y + (blockTargetY - player.y) * blockReaction, 1, 99);
  });
  if (pressureDefender) {
    const pressure = action === "shot" ? 0.46 : action === "keyPass" ? 0.34 : 0.22;
    const goalSideY = actor.y + direction * (action === "shot" ? 2.6 : 4.2);
    pressureDefender.x = clamp(pressureDefender.x + (actor.x - pressureDefender.x) * pressure, 1, 99);
    pressureDefender.y = clamp(pressureDefender.y + (goalSideY - pressureDefender.y) * pressure, 1, 99);
  }
  coverDefenders.forEach((coverDefender, index) => {
    const side = index === 0 ? -1 : 1;
    const coverTargetX = clamp(actor.x + side * (action === "shot" ? 7 : 9) + (50 - actor.x) * 0.18, 5, 95);
    const coverTargetY = actor.y + direction * (action === "shot" ? 7 : 10);
    const coverReaction = action === "shot" ? 0.35 : action === "keyPass" ? 0.27 : 0.17;
    coverDefender.x = clamp(coverDefender.x + (coverTargetX - coverDefender.x) * coverReaction, 1, 99);
    coverDefender.y = clamp(coverDefender.y + (coverTargetY - coverDefender.y) * coverReaction, 1, 99);
  });
  markerAssignments.forEach(({ marker, target }) => {
    const markingTargetX = target.x + (50 - target.x) * 0.12;
    const markingTargetY = target.y + direction * (action === "shot" ? 3.5 : 5);
    const markingReaction = action === "shot" ? 0.24 : action === "keyPass" ? 0.2 : 0.13;
    marker.x = clamp(marker.x + (markingTargetX - marker.x) * markingReaction, 1, 99);
    marker.y = clamp(marker.y + (markingTargetY - marker.y) * markingReaction, 1, 99);
  });
  if (action === "shotOutcome") {
    const goalkeeper = defending.players.find((player) => playerRole(player.id, 1 - attackIndex) === "GK");
    if (goalkeeper) {
      goalkeeper.x = clamp(goalkeeper.x + (Number(ball?.x ?? actor.x) - goalkeeper.x) * 0.62, 1, 99);
      goalkeeper.y = clamp(goalkeeper.y + direction * 1.4, 1, 99);
    }
  }
  return {
    teams,
    defensiveRoles:{
      pressureId:pressureDefender?.id ?? null,
      coverIds:coverDefenders.map((player) => player.id),
      markerIds:markerAssignments.map(({ marker }) => marker.id),
    },
    offside,
  };
}

function recordDotReplayFrame(match, event) {
  if (!match.dotReplayEnabled || !DOT_REPLAY_EVENT_TYPES.has(event.type)) return;
  const sourceShape = match.currentReplayShape ?? match.lastReplayShape ?? replayShapeFromTeams(match);
  const teams = dotReplayTeams(match, sourceShape, true);
  const ball = dotReplayBall(match, event, sourceShape);
  const replaySource = match.currentReplaySequence?.length ? match.currentReplaySequence : [sourceShape];
  let previousActorId = null;
  const sequence = replaySource.slice(-5).map((phase, phaseIndex) => {
    const basePhaseTeams = dotReplayTeams(match, phase);
    const attackingTeamIndex = Number(phase.attackingTeamIndex ?? sourceShape.attackingTeamIndex);
    const actorId = phase.actorId ?? null;
    const fallbackBall = dotReplayBall(match, { type:"phase", zone:phase.zone, attackingTeamIndex }, phase);
    const action = phaseIndex === 0 ? "control" : actorId && previousActorId && actorId !== previousActorId ? "pass" : "carry";
    if (actorId) previousActorId = actorId;
    const reaction = dotReplayReactiveTeams(match, basePhaseTeams, {
      attackingTeamIndex,
      actorId,
      defenderId:phase.defenderId ?? null,
      stage:phase.stage,
      action,
      ball:fallbackBall,
      event:phase,
    });
    return {
      stage:phase.stage,
      action,
      outcome:phase.outcome ?? null,
      actorId,
      defenderId:reaction.defensiveRoles.pressureId ?? phase.defenderId ?? null,
      defensiveRoles:reaction.defensiveRoles,
      offside:reaction.offside,
      ball:dotReplayActorBall(reaction.teams, actorId, attackingTeamIndex, fallbackBall),
      teams:reaction.teams,
    };
  });
  if (["goal", "ownGoal", "save", "miss", "block"].includes(event.type)) {
    const shotActorId = ["save", "block"].includes(event.type) ? event.opponentId : event.actorId;
    const outcomeDefenderId = event.type === "goal" ? event.opponentId : ["save", "block"].includes(event.type) ? event.actorId : null;
    let lastPhase = sequence.at(-1);
    if (event.type === "goal" && event.assistId) {
      if (lastPhase?.actorId === event.assistId) {
        lastPhase.action = "keyPass";
        lastPhase.role = "assist";
        const assistReaction = dotReplayReactiveTeams(match, lastPhase.teams ?? teams, {
          attackingTeamIndex:event.attackingTeamIndex ?? sourceShape.attackingTeamIndex,
          actorId:event.assistId,
          defenderId:lastPhase.defenderId ?? null,
          stage:"assist",
          action:"keyPass",
          ball:lastPhase.ball ?? ball,
          event,
        });
        lastPhase.teams = assistReaction.teams;
        lastPhase.defenderId = assistReaction.defensiveRoles.pressureId ?? lastPhase.defenderId;
        lastPhase.defensiveRoles = assistReaction.defensiveRoles;
        lastPhase.offside = assistReaction.offside;
        lastPhase.ball = dotReplayActorBall(lastPhase.teams, event.assistId, event.attackingTeamIndex ?? sourceShape.attackingTeamIndex, lastPhase.ball ?? ball);
      } else {
        const assistReaction = dotReplayReactiveTeams(match, lastPhase?.teams ?? teams, {
          attackingTeamIndex:event.attackingTeamIndex ?? sourceShape.attackingTeamIndex,
          actorId:event.assistId,
          defenderId:lastPhase?.defenderId ?? null,
          stage:"assist",
          action:"keyPass",
          ball:lastPhase?.ball ?? ball,
          event,
        });
        sequence.push({
          ...structuredClone(lastPhase),
          stage:"assist",
          action:"keyPass",
          role:"assist",
          actorId:event.assistId,
          defenderId:assistReaction.defensiveRoles.pressureId ?? lastPhase?.defenderId ?? null,
          defensiveRoles:assistReaction.defensiveRoles,
          offside:assistReaction.offside,
          ball:dotReplayActorBall(assistReaction.teams, event.assistId, event.attackingTeamIndex ?? sourceShape.attackingTeamIndex, lastPhase?.ball ?? ball),
          teams:assistReaction.teams,
        });
      }
      lastPhase = sequence.at(-1);
    }
    if (shotActorId && (lastPhase?.actorId !== shotActorId || lastPhase?.action !== "shot")) {
      const shotReaction = dotReplayReactiveTeams(match, lastPhase?.teams ?? teams, {
        attackingTeamIndex:event.attackingTeamIndex ?? sourceShape.attackingTeamIndex,
        actorId:shotActorId,
        defenderId:outcomeDefenderId ?? lastPhase?.defenderId ?? null,
        stage:"shot",
        action:"shot",
        ball:lastPhase?.ball ?? ball,
        event,
      });
      sequence.push({
        ...structuredClone(lastPhase),
        stage:"shot",
        action:"shot",
        role:event.type === "goal" ? "scorer" : "shooter",
        actorId:shotActorId,
        defenderId:shotReaction.defensiveRoles.pressureId ?? outcomeDefenderId ?? lastPhase?.defenderId ?? null,
        defensiveRoles:shotReaction.defensiveRoles,
        offside:shotReaction.offside,
        ball:dotReplayActorBall(shotReaction.teams, shotActorId, event.attackingTeamIndex ?? sourceShape.attackingTeamIndex, lastPhase?.ball ?? ball),
        teams:shotReaction.teams,
      });
    }
    lastPhase = sequence.at(-1);
    const outcomeBall = dotReplayTerminalBall(event, lastPhase?.ball ?? ball, teams, event.attackingTeamIndex ?? sourceShape.attackingTeamIndex);
    const outcomeActorId = event.type === "goal" ? event.actorId : shotActorId;
    const outcomeReaction = dotReplayReactiveTeams(match, lastPhase?.teams ?? teams, {
      attackingTeamIndex:event.attackingTeamIndex ?? sourceShape.attackingTeamIndex,
      actorId:outcomeActorId,
      defenderId:outcomeDefenderId ?? event.actorId ?? null,
      stage:event.type,
      action:"shotOutcome",
      ball:outcomeBall,
      event,
    });
    sequence.push({
      ...structuredClone(lastPhase),
      stage:event.type,
      action:"shotOutcome",
      outcome:event.type,
      actorId:outcomeActorId ?? lastPhase?.actorId ?? null,
      defenderId:outcomeReaction.defensiveRoles.pressureId ?? event.opponentId ?? lastPhase?.defenderId ?? null,
      defensiveRoles:outcomeReaction.defensiveRoles,
      offside:outcomeReaction.offside,
      ball:outcomeBall,
      teams:outcomeReaction.teams,
    });
  }
  match.lastDotReplayBall = ball;
  const frame = {
    id:`dot-${match.dotReplayFrames.length + 1}`,
    eventId:event.id,
    minute:event.minute,
    type:event.type,
    teamIndex:Number.isInteger(event.teamIndex) ? event.teamIndex : null,
    attackingTeamIndex:Number.isInteger(event.attackingTeamIndex) ? event.attackingTeamIndex : sourceShape.attackingTeamIndex,
    stage:sourceShape.stage,
    possessionType:sourceShape.possessionType,
    text:event.text,
    detail:event.detail ?? null,
    importance:event.importance,
    actorId:event.actorId ?? null,
    assistId:event.assistId ?? null,
    opponentId:event.opponentId ?? null,
    targetId:event.targetId ?? null,
    attackType:event.attackType ?? null,
    zone:event.zone ?? null,
    bodyPart:event.bodyPart ?? null,
    bodyPartLabel:event.bodyPartLabel ?? null,
    xg:Number.isFinite(Number(event.xg)) ? Number(event.xg) : null,
    score:[...match.teams.map((team) => team.score)],
    ball,
    teams,
    sequence,
  };
  match.dotReplayFrames.push(frame);
  event.dotReplayFrameId = frame.id;
}

function addEvent(match, type, teamIndex, text, details = {}) {
  const event = { id:`v2-${match.events.length + 1}`, minute:Math.max(1, Math.ceil(match.minute)), type, teamIndex, text, importance:["goal", "ownGoal", "red", "injury", "substitution", "lightning", "penaltyAwarded", "abandoned", "fulltime"].includes(type) ? "major" : "normal", ...details };
  match.events.push(event);
  recordDotReplayFrame(match, event);
  return event;
}

function tacticalPlanName(match, teamIndex) {
  const team = match.teams[teamIndex];
  const difference = Number(team.score) - Number(match.teams[1 - teamIndex].score);
  const leadingThreshold = clamp(Math.round(Number(team.tacticalPlans?.leading?.triggerGoalDifference) || 1), 1, 5);
  const trailingThreshold = clamp(Math.round(Number(team.tacticalPlans?.trailing?.triggerGoalDifference) || 1), 1, 5);
  if (difference >= leadingThreshold) return "leading";
  if (difference <= -trailingThreshold) return "trailing";
  return "opening";
}

function argentinaCount(team) {
  const natural = activePlayers(team).filter((player) => ["Argentina", "阿根廷"].includes(player.nationality)).length;
  const forced = activePlayers(team).reduce((maximum, player) => Math.max(maximum, Number(traitHook(player, "argentinaCount")?.minimum ?? 0)), 0);
  return Math.max(natural, forced);
}

function chooseTacticalPlan(team, state) {
  const fallback = state === "leading"
    ? { tactic:"defensive", style:"counterAttack", positionPreset:"position2" }
    : state === "trailing"
      ? { tactic:"positive", style:"possession", positionPreset:"position3" }
      : (team.openingPlan ?? { tactic:team.tactic, style:team.style, positionPreset:"position1" });
  return { ...fallback, ...(team.tacticalPlans?.[state] ?? {}) };
}

function applyTacticalPlan(match, team) {
  const planName = tacticalPlanName(match, team.index);
  const plan = chooseTacticalPlan(team, planName);
  if (team.activePlan === planName && team.tactic === plan.tactic && team.style === plan.style) return;
  team.activePlan = planName;
  team.tactic = plan.tactic ?? team.tactic;
  team.style = plan.style ?? team.style;
  Object.assign(team, resolveV2SplitTacticalPlan(plan));
  team.splitTacticsExplicit = hasV2SplitTacticalPlan(plan);
  team.inPossession = plan.inPossession ?? "balanced";
  team.outOfPossession = plan.outOfPossession ?? "balanced";
  const details = tacticalDetailsForPlan(plan, team);
  team.inPossessionDetails = details.inPossessionDetails;
  team.outOfPossessionDetails = details.outOfPossessionDetails;
  team.tacticalDimensions = tacticalDimensionsForPlan(plan);
  team.playerDuties = structuredClone(plan.playerDuties ?? team.openingPlan?.playerDuties ?? team.playerDuties ?? {});
  const preset = plan.positionPreset ?? "position1";
  team.positions = structuredClone(team.positionPresets?.[preset] ?? team.positions);
  team.formationLines = structuredClone(team.formationLinePresets?.[preset] ?? team.formationLines ?? null);
  const assignedRoles = inferElevenBoardRoles(team.players.map((player) => ({ id:player.id, position:team.positions[player.id] })), team.formationLines);
  team.structureRoles = assignedRoles;
  team.players.forEach((player) => {
    if (!team.positions[player.id]) return;
    player.boardPosition = structuredClone(team.positions[player.id]);
    if (player.active) {
      player.assignedRole = assignedRoles[player.id] ?? player.assignedRole ?? player.role;
      player.tacticalDuty = resolveV2PlayerDuty(player.assignedRole, team.playerDuties?.[player.id] ?? null);
    }
  });
  addEvent(match, "tactical", team.index, `${team.name}根据实时比分切换为${PLAN_LABELS[planName] ?? "当前"}战术计划。`, { plan:planName, tactic:team.tactic, style:team.style, positionPreset:preset });
}

function captureAnalysisSnapshot(match) {
  const signature = JSON.stringify(match.teams.map((team) => ({
    plan:team.activePlan,
    tactic:team.tactic,
    style:team.style,
    possessionStyle:team.possessionStyle,
    defensiveBlock:team.defensiveBlock,
    transitionStyle:team.transitionStyle,
    duelIntensity:team.duelIntensity,
    inPossession:team.inPossession,
    outOfPossession:team.outOfPossession,
    inPossessionDetails:team.inPossessionDetails,
    outOfPossessionDetails:team.outOfPossessionDetails,
    tacticalDimensions:team.tacticalDimensions,
    playerDuties:team.playerDuties,
    positions:team.positions,
    active:team.players.map((player) => [player.id, player.active, player.sentOff, Boolean(player.injury)]),
  })));
  if (match.lastAnalysisSignature === signature) return;
  match.lastAnalysisSignature = signature;
  match.analysisTimeline.push({
    minute:Math.max(0, Math.min(90, Math.ceil(Number(match.minute) || 0))),
    score:match.teams.map((team) => team.score),
    teams:match.teams.map((team) => {
      const players = team.players.filter((player) => player.startedMatch || player.enteredAsSubstitute || player.active || player.injury || player.sentOff).map((player) => ({
        id:player.id,
        active:player.active,
        sentOff:player.sentOff,
        injury:structuredClone(player.injury),
        fitness:round(player.state?.fitness ?? 100, 1),
        assignedRole:player.assignedRole ?? player.role,
        tacticalDuty:player.tacticalDuty ?? null,
      }));
      const currentPlayers = team.players.filter((player) => player.active);
      const roles = Object.fromEntries(currentPlayers.map((player) => [player.id, player.assignedRole ?? player.role]));
      const plan = {
        tactic:team.tactic,
        style:team.style,
        inPossession:team.inPossession,
        outOfPossession:team.outOfPossession,
        inPossessionDetails:team.inPossessionDetails,
        outOfPossessionDetails:team.outOfPossessionDetails,
        playerDuties:team.playerDuties,
      };
      const dimensions = resolveV2TacticalDimensions(team.tactic, team.style, team.tacticalDimensions, match.parameters);
      const averageOverall = currentPlayers.length ? currentPlayers.reduce((sum, player) => sum + Number(player.overall ?? 0), 0) / currentPlayers.length : 0;
      const averageFitness = currentPlayers.length ? currentPlayers.reduce((sum, player) => sum + Number(player.state?.fitness ?? 100), 0) / currentPlayers.length : 0;
      const positionFit = currentPlayers.length ? currentPlayers.reduce((sum, player) => sum + positionFitScore(player, roles[player.id]), 0) / currentPlayers.length : 0;
      return {
        plan:team.activePlan,
        tactic:team.tactic,
        style:team.style,
        formation:analyzeElevenBoardFormation(currentPlayers, team.positions, team.formationLines).name,
        positions:structuredClone(team.positions),
        formationLines:structuredClone(team.formationLines),
        players,
        playerDuties:structuredClone(team.playerDuties ?? {}),
        structureIndex:round(calculateV2StructureFit(currentPlayers, roles, team.positions, team.formationLines, dimensions) / 100, 4),
        positionFit:round(positionFit, 4),
        tacticalFit:round(calculateV2TacticalFit(currentPlayers, roles, team.positions, team.formationLines, plan, dimensions) / 100, 4),
        averageOverall:round(averageOverall, 2),
        averageFitness:round(averageFitness, 2),
      };
    }),
  });
}

function replacePositionPlayer(positions, outgoingId, incomingId) {
  if (!positions?.[outgoingId]) return false;
  positions[incomingId] = structuredClone(positions[outgoingId]);
  delete positions[outgoingId];
  return true;
}

function replaceDutyPlayer(duties, outgoingId, incomingId) {
  if (!duties || !Object.hasOwn(duties, outgoingId)) return false;
  duties[incomingId] = duties[outgoingId];
  delete duties[outgoingId];
  return true;
}

function autoSubstituteInjuredPlayer(match, team, injuredPlayer) {
  if (!match.parameters.state.substitutionsEnabled) return null;
  const targetRole = injuredPlayer.assignedRole ?? injuredPlayer.role;
  const substitute = team.players
    .filter((player) => player.active === false && !player.injury && !player.sentOff && automaticSubstitutionRank(targetRole, player) > 0)
    .sort((left, right) => compareAutomaticSubstitutes(targetRole, left, right))[0];
  if (!substitute) return null;
  const outgoingRole = injuredPlayer.assignedRole ?? injuredPlayer.role;
  replacePositionPlayer(team.positions, injuredPlayer.id, substitute.id);
  Object.values(team.positionPresets ?? {}).forEach((positions) => replacePositionPlayer(positions, injuredPlayer.id, substitute.id));
  replaceDutyPlayer(team.playerDuties, injuredPlayer.id, substitute.id);
  Object.values(team.tacticalPlans ?? {}).forEach((plan) => replaceDutyPlayer(plan.playerDuties, injuredPlayer.id, substitute.id));
  replaceDutyPlayer(team.openingPlan?.playerDuties, injuredPlayer.id, substitute.id);
  substitute.active = true;
  substitute.assignedRole = outgoingRole;
  substitute.tacticalDuty = resolveV2PlayerDuty(outgoingRole, injuredPlayer.tacticalDuty);
  substitute.boardPosition = structuredClone(team.positions[substitute.id] ?? injuredPlayer.boardPosition ?? null);
  substitute.enteredAsSubstitute = true;
  substitute.substitutedForId = injuredPlayer.id;
  injuredPlayer.substitutedOut = true;
  team.stats.substitutions = Number(team.stats.substitutions ?? 0) + 1;
  addEvent(match, "substitution", team.index, `${team.name}完成伤病换人：${substitute.name}替换${injuredPlayer.name}出场。`, {
    actorId:substitute.id,
    opponentId:injuredPlayer.id,
    incomingPlayerId:substitute.id,
    incomingPlayerName:substitute.name,
    outgoingPlayerId:injuredPlayer.id,
    outgoingPlayerName:injuredPlayer.name,
    reason:"injury",
    assignedRole:outgoingRole,
    tacticalDuty:substitute.tacticalDuty,
    detail:`换下：${injuredPlayer.name}；换上：${substitute.name}；位置匹配顺序：主位置、次位置、同位置线；${substitute.name}接管${outgoingRole}职责。`,
  });
  return substitute;
}

function currentMatchRating(player) {
  const stats = player?.matchStats ?? {};
  return Math.max(4, Math.min(10, 6.5
    + Number(stats.goals ?? 0) * 0.8
    + Number(stats.assists ?? 0) * 0.5
    + Number(stats.saves ?? 0) * 0.12
    - Number(stats.redCards ?? 0) * 1.5));
}

export function autoSubstituteDismissedGoalkeeper(match, team, dismissedGoalkeeper) {
  if (!match.parameters.state.substitutionsEnabled || (dismissedGoalkeeper.assignedRole ?? dismissedGoalkeeper.role) !== "GK") return null;
  const substitute = team.players
    .filter((player) => player.active === false && !player.injury && !player.sentOff && automaticSubstitutionRank("GK", player) > 0)
    .sort((left, right) => compareAutomaticSubstitutes("GK", left, right))[0];
  const outgoingCenterBack = activePlayers(team)
    .filter((player) => (player.assignedRole ?? player.role) === "CB")
    .sort((left, right) => currentMatchRating(left) - currentMatchRating(right)
      || Number(left.overall ?? 0) - Number(right.overall ?? 0)
      || String(left.id ?? "").localeCompare(String(right.id ?? "")))[0];
  if (!substitute || !outgoingCenterBack) return null;

  replacePositionPlayer(team.positions, dismissedGoalkeeper.id, substitute.id);
  delete team.positions[outgoingCenterBack.id];
  Object.values(team.positionPresets ?? {}).forEach((positions) => {
    replacePositionPlayer(positions, dismissedGoalkeeper.id, substitute.id);
    delete positions[outgoingCenterBack.id];
  });
  outgoingCenterBack.active = false;
  outgoingCenterBack.substitutedOut = true;
  substitute.active = true;
  substitute.assignedRole = "GK";
  substitute.boardPosition = structuredClone(team.positions[substitute.id] ?? dismissedGoalkeeper.boardPosition ?? null);
  substitute.enteredAsSubstitute = true;
  substitute.substitutedForId = outgoingCenterBack.id;
  team.stats.substitutions = Number(team.stats.substitutions ?? 0) + 1;
  addEvent(match, "substitution", team.index, `${team.name}启动门将红牌应急换人：${substitute.name}换下${outgoingCenterBack.name}，接替门将位置。`, {
    actorId:substitute.id,
    opponentId:outgoingCenterBack.id,
    incomingPlayerId:substitute.id,
    incomingPlayerName:substitute.name,
    outgoingPlayerId:outgoingCenterBack.id,
    outgoingPlayerName:outgoingCenterBack.name,
    dismissedGoalkeeperId:dismissedGoalkeeper.id,
    dismissedGoalkeeperName:dismissedGoalkeeper.name,
    reason:"goalkeeperRedCard",
    assignedRole:"GK",
    detail:`被罚门将：${dismissedGoalkeeper.name}；换下中后卫：${outgoingCenterBack.name}（当前评分${currentMatchRating(outgoingCenterBack).toFixed(1)}，总评${Number(outgoingCenterBack.overall ?? 0)}）；换上门将：${substitute.name}。`,
  });
  return { substitute, outgoingCenterBack };
}

function removePlayer(match, team, player, reason, details = {}) {
  if (!player?.active) return false;
  if (reason === "injury" && injuryImmune(player)) {
    addEvent(match, "trait", team.index, `${player.name}依靠“赖着不死”避免了伤退。`, { actorId:player.id, traitName:"赖着不死" });
    return false;
  }
  if (reason === "injury" && !details.injuryTransferResolved) {
    const protector = injuryTransferProtector(team, player);
    if (protector) {
      addEvent(match, "trait", team.index, `${protector.player.name}触发“${protector.rule.traitName}”，替${player.name}承担了伤病。`, {
        actorId:protector.player.id,
        opponentId:player.id,
        protectedPlayerId:player.id,
        protectedPlayerName:player.name,
        traitId:protector.rule.traitId,
        traitName:protector.rule.traitName,
        injuryTransferred:true,
      });
      return removePlayer(match, team, protector.player, "injury", {
        ...details,
        injuryTransferResolved:true,
        injuryTransferred:true,
        transferredFromPlayerId:player.id,
        transferredFromPlayerName:player.name,
        injuryTransferTraitId:protector.rule.traitId,
        injuryTransferTraitName:protector.rule.traitName,
      });
    }
  }
  player.active = false;
  player.sentOff = reason === "red";
  player.injury = reason === "injury" ? { severity:details.severity ?? "matchEnding", injuryRounds:Number(details.injuryRounds ?? 1) } : null;
  if (reason === "red") {
    player.matchStats.redCards += 1;
    team.stats.redCards += 1;
    match.postMatchConsequences.suspensions.push({ teamIndex:team.index, playerId:player.id, matches:1, reason:"redCard" });
    const dismissalText = details.cause === "secondYellow"
      ? `${player.name}领到本场第二张黄牌，两黄变一红被罚下，${team.name}只能以${activePlayers(team).length}人继续比赛。`
      : details.cause === "blackWhistle"
        ? `${player.name}在争议判罚中被直接红牌罚下，${team.name}只能以${activePlayers(team).length}人继续比赛。`
        : details.cause === "brawl"
          ? `${player.name}卷入双方群体冲突，被裁判直接红牌罚下，${team.name}只能以${activePlayers(team).length}人继续比赛。`
        : `${player.name}因严重犯规被直接红牌罚下，${team.name}只能以${activePlayers(team).length}人继续比赛。`;
    const dismissalEvent = addEvent(match, "red", team.index, dismissalText, {
      actorId:player.id,
      dismissalReason:details.cause ?? "directRed",
      opponentId:details.opponentId ?? null,
      zone:details.zone ?? null,
      detail:`被罚球员：${player.name}；判罚原因：${details.cause === "secondYellow" ? "两黄变红" : details.cause === "blackWhistle" ? "争议直接红牌" : details.cause === "brawl" ? "群体冲突直接红牌" : "严重犯规直接红牌"}；${details.opponentName ? `犯规对象：${details.opponentName}；` : ""}${details.zone ? `犯规区域：${zoneLabel(details.zone)}；` : ""}剩余人数：${activePlayers(team).length}；赛后自动停赛1场。`,
    });
    const goalkeeperSubstitution = autoSubstituteDismissedGoalkeeper(match, team, player);
    dismissalEvent.detail += goalkeeperSubstitution
      ? `门将红牌应急换人已执行，${goalkeeperSubstitution.outgoingCenterBack.name}被换下，${goalkeeperSubstitution.substitute.name}替补出场。`
      : (player.assignedRole ?? player.role) === "GK"
        ? "替补席没有可用门将或场上没有可换下的中后卫，无法执行门将红牌应急换人。"
        : "外场球员红牌罚下不可换人。";
  } else {
    team.stats.injuries += 1;
    const offender = details.offender ?? null;
    match.postMatchConsequences.injuries.push({ teamIndex:team.index, playerId:player.id, matches:Number(player.injury.injuryRounds), reason:details.cause ?? "match", offenderTeamIndex:details.offenderTeamIndex ?? null, offenderId:offender?.id ?? null, offenderName:offender?.name ?? null, card:details.card ?? null, injuryTransferred:Boolean(details.injuryTransferred), transferredFromPlayerId:details.transferredFromPlayerId ?? null, transferredFromPlayerName:details.transferredFromPlayerName ?? null, traitId:details.injuryTransferTraitId ?? null, traitName:details.injuryTransferTraitName ?? null });
    const accidentalDescription = details.accidentDescription ?? "在无对抗跑动中肌肉拉伤";
    const injuryCauseText = details.cause === "lightningInjury"
      ? `${player.name}遭到雷击，无法继续比赛。`
      : details.cause === "weatherInjury"
        ? `${player.name}${details.weatherDescription ?? "受到恶劣天气影响滑倒受伤"}，无法继续比赛。`
        : `${player.name}${accidentalDescription}，无法继续比赛。`;
    const injuryEventText = details.injuryTransferred
      ? `${details.transferredFromPlayerName}原本遭遇伤病，${player.name}触发“${details.injuryTransferTraitName}”替队友承担伤病，无法继续比赛。`
      : offender
        ? `${player.name}被${offender.name}踢伤，无法继续比赛；裁判${details.card === "red" ? "对犯规球员出示直接红牌" : details.card === "yellow" ? "对犯规球员出示黄牌" : "未对该动作出牌"}。`
        : injuryCauseText;
    const injuryEvent = addEvent(match, "injury", team.index, injuryEventText, {
      actorId:player.id,
      injuredPlayerId:player.id,
      injuredPlayerName:player.name,
      injuryTransferred:Boolean(details.injuryTransferred),
      transferredFromPlayerId:details.transferredFromPlayerId ?? null,
      transferredFromPlayerName:details.transferredFromPlayerName ?? null,
      traitId:details.injuryTransferTraitId ?? null,
      traitName:details.injuryTransferTraitName ?? null,
      offenderTeamIndex:details.offenderTeamIndex ?? null,
      offenderId:offender?.id ?? null,
      offenderName:offender?.name ?? null,
      opponentId:offender?.id ?? null,
      injuryRounds:player.injury.injuryRounds,
      cause:details.cause ?? "match",
      detail:`${details.injuryTransferred ? `原受伤球员：${details.transferredFromPlayerName}；“${details.injuryTransferTraitName}”将伤病转移给${player.name}；` : ""}伤退球员：${player.name}；伤病原因：${details.cause === "foul" ? "对手犯规" : details.cause === "lightningInjury" ? "雷击" : details.cause === "weatherInjury" ? `${WEATHER_LABELS[details.weather ?? match.environment.weather] ?? "恶劣天气"}影响` : "无对抗意外受伤"}；${offender ? `致伤球员：${offender.name}；纪律处罚：${details.card === "red" ? "直接红牌" : details.card === "yellow" ? "黄牌" : "未出牌"}；` : ""}${details.zone ? `发生区域：${zoneLabel(details.zone)}；` : ""}预计缺席：${player.injury.injuryRounds}轮。`,
    });
    const substitute = autoSubstituteInjuredPlayer(match, team, player);
    if (!substitute) {
      injuryEvent.text += `${team.name}替补席没有符合位置要求的球员，只能以${activePlayers(team).length}人继续比赛。`;
      injuryEvent.detail += `替补席无同位置、次位置或同位置线球员；剩余人数：${activePlayers(team).length}。`;
    }
  }
  return true;
}

export function v2FatigueLoadMultiplier(dimensions = {}, parameters = V2_MATCH_PARAMETERS) {
  const pressingLoad = clamp(Number(dimensions.pressing ?? 50) / 100, 0, 1);
  const aggressivePressingLoad = clamp((Number(dimensions.pressing ?? 50) - 65) / 35, 0, 1);
  const attackingLoad = clamp((Number(dimensions.mentality ?? 50) - 60) / 40, 0, 1);
  return 1
    + pressingLoad * Number(parameters.state.pressingFatigueMaximum ?? 0)
    + aggressivePressingLoad * attackingLoad * Number(parameters.state.attackingPressFatigueMaximum ?? 0);
}

function applyFatigue(match) {
  const weatherFatigueMultiplier = Number(match.parameters.environment?.weatherFatigueMultiplier?.[match.environment.weather] ?? 1);
  for (const team of match.teams) {
    for (const player of activePlayers(team)) {
      const fixed = traitHook(player, "fixedFitness");
      if (fixed) {
        player.state.fitness = Number(fixed.value);
        player.v2WeatherFatigueRemainder = 0;
      }
      else {
        const stamina = effectiveMetric(match, team.index, player, { stamina:1 });
        const dimensions = resolveV2TacticalDimensions(team.tactic, team.style, team.tacticalDimensions, match.parameters);
        const pressing = v2FatigueLoadMultiplier(dimensions, match.parameters);
        const baseLoss = Number(match.parameters.state.fatiguePerChain ?? 0.085) * pressing * (1.2 - stamina / 300) * v2DutyFatigueMultiplier(player);
        player.v2WeatherFatigueRemainder = Number(player.v2WeatherFatigueRemainder ?? 0) + baseLoss * Math.max(0, weatherFatigueMultiplier - 1);
        const weatherLoss = Math.floor((player.v2WeatherFatigueRemainder + 1e-9) * 10) / 10;
        player.v2WeatherFatigueRemainder -= weatherLoss;
        const loss = baseLoss + weatherLoss;
        player.state.fitness = round(clamp(player.state.fitness - loss, 18, 100), 1);
      }
    }
  }
}

function shotTypeFrom(chain, team) {
  const route = chain.stages.find((stage) => stage.connection?.routeType)?.connection?.routeType;
  const crossing = team.inPossessionDetails?.crossing ?? "balanced";
  const lane = chain.endZone?.split(":")[1];
  const finalActorId = [...(chain.stages ?? [])].reverse().find((stage) => stage.actor?.id)?.actor?.id;
  const finalActor = team.players.find((player) => player.id === finalActorId);
  const dutyPreference = v2DutyShotPreference(finalActor);
  const possessionStyle = team.splitTacticsExplicit ? team.possessionStyle : team.style;
  if (route === "counter") return "counter";
  if (dutyPreference === "cross" && lane && lane !== "center") return "cross";
  if (dutyPreference === "inside") return "throughBall";
  if (crossing === "increase" && lane && lane !== "center") return "cross";
  if (route === "direct") return ["wingPlay", "longBall"].includes(possessionStyle) && crossing !== "reduce" ? "cross" : "throughBall";
  if (possessionStyle === "wingPlay" && crossing !== "reduce") return "cross";
  return lane && lane !== "center" ? "cutback" : "throughBall";
}

function longShotProfile(match, teamIndex, team, candidate, chain, requestedType, explicitType) {
  if (explicitType || !candidate || !["throughBall", "cutback"].includes(requestedType)) return null;
  const lane = chain.endZone?.split(":")[1] ?? "center";
  if (["farLeft", "farRight"].includes(lane)) return null;
  const config = match.parameters.chain.longShot;
  const skill = effectiveMetric(match, teamIndex, candidate, { longShots:0.55, composure:0.2, decisions:0.15, firstTouch:0.1 });
  const defending = match.teams[1 - teamIndex];
  const lowBlock = (defending.splitTacticsExplicit ? defending.defensiveBlock : defending.style) === "lowBlock" || ["defensive", "parkBus"].includes(defending.tactic);
  const attackingMentality = ["positive", "allOutAttack"].includes(team.tactic);
  const longShotInstruction = team.inPossessionDetails?.longShots ?? "balanced";
  const chanceInstruction = team.inPossessionDetails?.chanceCreation ?? "balanced";
  const structureExposure = clamp(Number(chain.stages.at(-1)?.defendingLongShotExposure ?? 0), 0, 1);
  const instructionAdjustment = (longShotInstruction === "increase" ? 0.09 : longShotInstruction === "reduce" ? -0.07 : 0)
    + (chanceInstruction === "shootOnSight" ? 0.05 : chanceInstruction === "patient" ? -0.03 : 0);
  const decisionChance = clamp(
    Number(config.baseDecisionChance) + (skill - 70) * Number(config.skillDecisionWeight)
      + ((team.splitTacticsExplicit ? team.possessionStyle : team.style) === "longBall" ? Number(config.longBallBonus) : 0)
      + (lowBlock ? Number(config.lowBlockBonus) : 0)
      + (attackingMentality ? Number(config.attackingMentalityBonus) : 0)
      + structureExposure * Number(config.structureExposureDecisionBonus ?? 0)
      + instructionAdjustment,
    Number(config.minimumDecisionChance),
    Number(config.maximumDecisionChance),
  );
  if (seededEventRoll(match, "longShot", teamIndex, chain.context?.chainIndex ?? match.nextChainIndex, candidate.id) >= decisionChance) return null;
  const space = Number(chain.stages.at(-1)?.factors?.space ?? 0.5);
  const baseXg = clamp(
    Number(config.baseXg)
      + (skill - 70) * Number(config.skillXgWeight)
      + (space - 0.5) * Number(config.spaceXgWeight)
      + structureExposure * Number(config.structureExposureXgBonus ?? 0),
    Number(config.minimumXg),
    Number(config.maximumXg),
  );
  return { candidate, zone:`finalThird:${lane}`, baseXg, decisionChance, skill, structureExposure };
}

export function v2MidfieldVacuumLongShotOpportunityProfile(chain, parameters = V2_MATCH_PARAMETERS, roll = 1) {
  const terminal = chain?.stages?.at(-1) ?? null;
  const config = parameters.chain?.longShot ?? {};
  const [zoneBand, lane = "center"] = String(terminal?.zone ?? chain?.endZone ?? "").split(":");
  const exposure = clamp(Number(terminal?.defendingLongShotExposure ?? 0), 0, 1);
  const minimumExposure = clamp(Number(config.midfieldVacuumMinimumExposure ?? 0.55), 0, 1);
  const eligible = Boolean(
    terminal?.turnover
      && terminal.outcome === "defensiveTurnover"
      && !terminal.foul?.occurred
      && zoneBand === "finalThird"
      && ["progression", "finalThird", "chance"].includes(terminal.stage)
      && exposure >= minimumExposure
  );
  const severity = eligible ? clamp((exposure - minimumExposure) / Math.max(0.01, 1 - minimumExposure), 0, 1) : 0;
  const baseChance = clamp(Number(config.midfieldVacuumBaseChance ?? 0.04), 0, 1);
  const maximumChance = clamp(Number(config.midfieldVacuumMaximumChance ?? 0.26), baseChance, 1);
  const wideLaneMultiplier = ["farLeft", "farRight"].includes(lane)
    ? clamp(Number(config.midfieldVacuumWideLaneMultiplier ?? 0.55), 0, 1)
    : 1;
  const opportunityChance = eligible
    ? clamp((baseChance + (maximumChance - baseChance) * severity) * wideLaneMultiplier, 0, maximumChance)
    : 0;
  return Object.freeze({
    eligible,
    created:eligible && clamp(Number(roll), 0, 1) < opportunityChance,
    exposure:round(exposure),
    severity:round(severity),
    opportunityChance:round(opportunityChance),
    zoneBand,
    lane,
    wideLaneMultiplier:round(wideLaneMultiplier),
  });
}

function bestLongShotCandidate(match, teamIndex, team) {
  return activePlayers(team)
    .filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK")
    .sort((left, right) => effectiveMetric(match, teamIndex, right, { longShots:0.55, composure:0.2, decisions:0.15, firstTouch:0.1 }) - effectiveMetric(match, teamIndex, left, { longShots:0.55, composure:0.2, decisions:0.15, firstTouch:0.1 }) || String(left.id).localeCompare(String(right.id)))[0] ?? null;
}

function materializeMidfieldVacuumLongShot(match, chain, chainIndex) {
  const roll = seededEventRoll(match, "midfieldVacuumLongShot", chain.attackingTeamIndex, chainIndex);
  const profile = v2MidfieldVacuumLongShotOpportunityProfile(chain, match.parameters, roll);
  if (!profile.created) return profile;
  const attacking = match.teams[chain.attackingTeamIndex];
  const candidate = bestLongShotCandidate(match, chain.attackingTeamIndex, attacking);
  if (!candidate) return Object.freeze({ ...profile, created:false, reason:"noCandidate" });
  const config = match.parameters.chain.longShot;
  const terminal = chain.stages.at(-1);
  const skill = effectiveMetric(match, chain.attackingTeamIndex, candidate, { longShots:0.55, composure:0.2, decisions:0.15, firstTouch:0.1 });
  const space = Number(terminal?.factors?.space ?? 0.5);
  const baseXg = clamp(
    Number(config.baseXg)
      + (skill - 70) * Number(config.skillXgWeight)
      + (space - 0.5) * Number(config.spaceXgWeight)
      + profile.exposure * Number(config.structureExposureXgBonus ?? 0),
    Number(config.minimumXg),
    Number(config.maximumXg),
  );
  const shotStage = {
    stage:"shot",
    owner:"shot",
    teamIndex:chain.attackingTeamIndex,
    zone:terminal.zone,
    worldZone:terminal.worldZone ?? terminal.zone,
    actor:{ id:candidate.id, name:candidate.name, role:candidate.assignedRole ?? candidate.role, tacticalDuty:candidate.tacticalDuty ?? null },
    defender:null,
    probability:round(profile.opportunityChance),
    success:true,
    outcome:"shotCreated",
    turnover:null,
    factors:{ ...(terminal.factors ?? {}), space:round(space) },
    defendingBacklineExposure:Number(terminal.defendingBacklineExposure ?? 0),
    defendingBacklineExposureBreakdown:terminal.defendingBacklineExposureBreakdown ?? null,
    defendingLine:Number(terminal.defendingLine ?? 50),
    defendingMidfieldIntegrity:Number(terminal.defendingMidfieldIntegrity ?? 1),
    defendingLongShotExposure:profile.exposure,
    midfieldVacuumOpportunity:true,
    midfieldVacuumProfile:profile,
    baseXg:round(baseXg),
  };
  chain.stages.push(shotStage);
  chain.completedStages = [...(chain.completedStages ?? []), "shot"];
  chain.terminalOutcome = "shotCreated";
  chain.endZone = shotStage.zone;
  return Object.freeze({ ...profile, candidateId:candidate.id, baseXg:round(baseXg) });
}

function goalkeeper(team) {
  return activePlayers(team).find((player) => roleGroup(player.assignedRole ?? player.role) === "GK") ?? activePlayers(team)[0] ?? null;
}

function shotBlockProfile(match, defendingTeamIndex, chain, type) {
  if (type === "penalty") return { blocked:false, defender:null, probability:0 };
  const defenders = activePlayers(match.teams[defendingTeamIndex]).filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK");
  if (!defenders.length) return { blocked:false, defender:null, probability:0 };
  const weighted = defenders.map((player) => ({
    player,
    weight:Math.pow(effectiveMetric(match, defendingTeamIndex, player, { positioning:0.34, marking:0.24, tackling:0.2, decisions:0.14, strength:0.08 }), 2) * v2DutyDefenderMultiplier(player, "shot"),
  }));
  const chainIndex = chain.context?.chainIndex ?? match.nextChainIndex;
  let selectionRoll = seededEventRoll(match, "shotBlocker", defendingTeamIndex, chainIndex) * weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let defender = weighted.at(-1).player;
  for (const entry of weighted) {
    selectionRoll -= entry.weight;
    if (selectionRoll <= 0) { defender = entry.player; break; }
  }
  const ability = effectiveMetric(match, defendingTeamIndex, defender, { positioning:0.36, marking:0.24, tackling:0.2, decisions:0.12, strength:0.08 });
  const typeBase = type === "cross" || type === "setPiece" ? 0.26 : type === "longShot" || type === "freeKick" ? 0.18 : type === "rebound" ? 0.24 : 0.21;
  const probability = clamp(typeBase + (ability - 70) * 0.003, 0.08, 0.38);
  return {
    blocked:seededEventRoll(match, "shotBlocked", defendingTeamIndex, chainIndex, defender.id) < probability,
    defender,
    probability:round(probability),
  };
}

function maybeAwardCorner(match, teamIndex, chain, source, probability, setPieceDepth = 0, possessionType = "normal") {
  if (Number(setPieceDepth) >= 2 || probability <= 0) return null;
  const chainIndex = chain?.context?.chainIndex ?? match.nextChainIndex;
  if (seededEventRoll(match, `corner:${source}`, teamIndex, chainIndex) >= probability) return null;
  const attacking = match.teams[teamIndex];
  attacking.stats.corners += 1;
  addEvent(match, "corner", teamIndex, `${attacking.name}迫使对方将球处理出底线，获得角球。`, { attackType:source, cornerSource:source });
  return resolveSetPiece(match, teamIndex, "corner", Number(setPieceDepth) + 1, possessionType);
}

export function calibrateV2ShotXg(value, type = "throughBall", scale = 1) {
  const xg = clamp((Number(value) || 0) * Number(scale ?? 1), 0, type === "penalty" ? 0.82 : 0.58);
  if (type === "penalty" || xg >= 0.08) return round(xg);
  const lowQualityFactor = 0.2 + 0.8 * Math.pow(xg / 0.08, 1.5);
  return round(xg * lowQualityFactor);
}

export function v2ShotOutcomeProfile(xg, finishing, keeperValue, type = "throughBall") {
  const chanceXg = clamp(Number(xg) || 0, 0.001, type === "penalty" ? 0.82 : 0.58);
  const shooter = Math.max(1, Number(finishing) || 50);
  const keeper = Math.max(1, Number(keeperValue) || 18);
  const onTargetProbability = type === "penalty"
    ? clamp(0.72 + shooter / 500, 0.78, 0.94)
    : clamp(0.1 + shooter / 330, Math.min(0.76, chanceXg + 0.08), 0.58);
  const finishingMultiplier = clamp(0.82 + shooter / 390, 0.82, 1.08);
  const keeperMultiplier = clamp(1.12 - keeper / 600, 0.955, 1.12);
  const goalProbability = type === "penalty"
    ? clamp(chanceXg + (shooter - keeper) / 400, 0.58, 0.9)
    : clamp(chanceXg * finishingMultiplier * keeperMultiplier, 0.001, Math.min(chanceXg * 1.2, onTargetProbability * 0.94));
  const saveProbabilityGivenOnTarget = clamp(1 - goalProbability / onTargetProbability, 0.02, 0.98);
  return {
    xg:round(chanceXg),
    onTargetProbability:round(onTargetProbability),
    goalProbability:round(goalProbability),
    saveProbabilityGivenOnTarget:round(saveProbabilityGivenOnTarget),
  };
}

export function v2ShotBodyPartProfile(player, type = "throughBall", roll = 0.5) {
  const heading = Math.max(1, Number(player?.attributes?.heading ?? 50));
  const preferredFoot = String(player?.preferredFoot ?? "right").toLowerCase() === "left" ? "left" : "right";
  const weakFoot = clamp(Number(player?.weakFoot ?? 2.5), 1, 5);
  const headerBase = type === "cross" ? 0.48 : type === "setPiece" ? 0.58 : type === "rebound" ? 0.12 : 0.025;
  const headerProbability = type === "penalty" || type === "longShot" || type === "freeKick"
    ? 0
    : clamp(headerBase + (heading - 70) * 0.004, 0.01, type === "setPiece" ? 0.78 : 0.68);
  const otherProbability = type === "rebound" ? 0.045 : 0.012;
  const weakFootProbability = clamp(0.12 + weakFoot * 0.055, 0.175, 0.395);
  const value = clamp(Number(roll) || 0, 0, 0.999999);
  let bodyPart;
  if (value < headerProbability) bodyPart = "header";
  else if (value < headerProbability + otherProbability) bodyPart = "other";
  else {
    const footRoll = (value - headerProbability - otherProbability) / Math.max(0.001, 1 - headerProbability - otherProbability);
    const usesWeakFoot = footRoll < weakFootProbability;
    const foot = usesWeakFoot ? (preferredFoot === "left" ? "right" : "left") : preferredFoot;
    bodyPart = foot === "left" ? "leftFoot" : "rightFoot";
  }
  return { bodyPart, label:SHOT_BODY_PART_LABELS[bodyPart], headerProbability:round(headerProbability), weakFootProbability:round(weakFootProbability) };
}

function scoreStateShotXgMultiplier(match, teamIndex, type) {
  if (type === "penalty") return 1;
  const goalLead = Math.max(0, Number(match.teams[teamIndex]?.score ?? 0) - Number(match.teams[1 - teamIndex]?.score ?? 0));
  if (!goalLead) return 1;
  const penalty = Number(match.parameters.state.leadingShotXgPenaltyPerGoal ?? 0);
  const minimum = Number(match.parameters.state.leadingShotXgMinimumMultiplier ?? 1);
  return clamp(1 - goalLead * penalty, minimum, 1);
}

function chainActors(chain) {
  const actors = [];
  for (const stage of chain.stages ?? []) {
    if (!stage.actor?.id || actors.some((actor) => actor.id === stage.actor.id)) continue;
    actors.push(stage.actor);
  }
  return actors;
}

function shotCreator(attacking, chain, shooter, type, suppliedCreator = null) {
  if (["penalty", "rebound", "setPiece", "freeKick"].includes(type)) return null;
  if (suppliedCreator?.active && suppliedCreator.id !== shooter.id) return suppliedCreator;
  return [...(chain.stages ?? [])].slice(0, -1).reverse()
    .map((stage) => stage.actor)
    .filter((actor) => actor?.id && actor.id !== shooter.id)
    .map((actor) => attacking.players.find((player) => player.id === actor.id))
    .find(Boolean) ?? null;
}

function describeShotBuildUp(match, teamIndex, chain, shooter, creator, type) {
  if ((chain.stages ?? []).length <= 1) return;
  const targetHoldUp = chain.stages.find((stage) => stage.dutyAction === "targetHoldUp" && stage.actor?.id);
  const targetLayoff = chain.stages.find((stage) => stage.dutyAction === "targetLayoff" && stage.actor?.id);
  if (targetHoldUp && targetLayoff) {
    addEvent(match, "attack", teamIndex, `${targetHoldUp.actor.name}作为支点背身接住直传并护住球权，随后为${targetLayoff.actor.name}做球，${shooter.name}获得起脚空间。`, {
      actorId:targetHoldUp.actor.id,
      targetId:shooter.id,
      participantId:targetLayoff.actor.id,
      participants:[...new Set([targetHoldUp.actor.name, targetLayoff.actor.name, shooter.name])],
      attackType:"targetLayoff",
      tacticalDuty:"targetForward",
    });
    return;
  }
  if (["individual", "soloCounter"].includes(type)) {
    addEvent(match, type === "soloCounter" ? "counter" : "attack", teamIndex, type === "soloCounter"
      ? `${shooter.name}在转换阶段自行带球突进，形成抢断后的单刀机会。`
      : `${shooter.name}连续摆脱防守，以个人突破为自己创造起脚空间。`, {
      actorId:shooter.id,
      targetId:shooter.id,
      participants:[shooter.name],
      attackType:type,
      selfCreated:true,
    });
    return;
  }
  const actors = chainActors(chain).filter((actor) => actor.id !== shooter.id);
  const first = actors[0];
  const second = actors.length > 2 ? actors[Math.floor(actors.length / 2)] : null;
  const typeLabel = SHOT_TYPE_LABELS[type] ?? "进攻配合";
  const opening = type === "counter" ? "断球后立即提速" : "从后场耐心组织";
  const links = [first?.name, second?.name, creator?.name].filter((name, index, values) => name && values.indexOf(name) === index);
  const cooperation = links.length ? `${links.join("、")}连续接应` : `${match.teams[teamIndex].name}连续传递`;
  addEvent(match, type === "counter" ? "counter" : "attack", teamIndex, `${cooperation}，${opening}并通过${typeLabel}为${shooter.name}创造起脚空间。`, {
    actorId:creator?.id ?? first?.id ?? shooter.id,
    targetId:shooter.id,
    participants:[...new Set([...links, shooter.name])],
    attackType:type,
  });
}

export function v2DefensiveActionType(chain) {
  const terminal = chain?.stages?.at(-1) ?? {};
  const routeType = terminal.connection?.routeType ?? chain?.stages?.find((stage) => stage.connection?.routeType)?.connection?.routeType;
  const lane = String(terminal.zone ?? "").split(":")[1];
  if (["buildUp", "progression"].includes(terminal.stage) || routeType === "direct") return "interception";
  if (terminal.stage === "finalThird" && (["farLeft", "farRight"].includes(lane) || routeType === "counter")) return "clearance";
  if (terminal.stage === "chance") return "tackle";
  return "tackle";
}

function recordDefensiveTurnover(match, chain) {
  const terminal = chain.stages.at(-1);
  if (!terminal?.turnover?.playerId) return null;
  const defending = match.teams[chain.defendingTeamIndex];
  const defender = defending.players.find((player) => player.id === terminal.turnover.playerId);
  if (!defender) return null;
  const actionType = v2DefensiveActionType(chain);
  const statKey = { tackle:"tackles", interception:"interceptions", clearance:"clearances" }[actionType];
  const creditProbability = Number(match.parameters.events.defensiveActionCreditProbability?.[actionType] ?? 1);
  const credited = seededEventRoll(match, "defensiveActionCredit", chain.defendingTeamIndex, chain.context?.chainIndex ?? match.nextChainIndex, defender.id) < creditProbability;
  if (credited) {
    defender.matchStats[statKey] = Number(defender.matchStats[statKey] ?? 0) + 1;
    defending.stats[statKey] = Number(defending.stats[statKey] ?? 0) + 1;
  }
  const pressing = Number(defending.tacticalDimensions?.pressing ?? 50);
  const pressureWon = pressing >= 68
    && ["buildUp", "progression"].includes(terminal.stage)
    && seededEventRoll(match, "pressureWinCredit", chain.defendingTeamIndex, chain.context?.chainIndex ?? match.nextChainIndex, defender.id) < Number(match.parameters.events.pressureWinCreditProbability ?? 1);
  if (pressureWon) {
    defender.matchStats.pressuresWon = Number(defender.matchStats.pressuresWon ?? 0) + 1;
    defending.stats.pressuresWon = Number(defending.stats.pressuresWon ?? 0) + 1;
  }
  return { actionType, defender, pressureWon, credited, creditProbability };
}

function describeTurnover(match, chain, chainIndex, defensiveAction = null) {
  const terminal = chain.stages.at(-1);
  if (!terminal || terminal.success || terminal.foul?.occurred || terminal.stage === "possession" || terminal.stage === "shot") return;
  const routeType = terminal.connection?.routeType ?? chain.stages.find((stage) => stage.connection?.routeType === "counter")?.connection?.routeType;
  const advanced = ["finalThird", "chance"].includes(terminal.stage);
  if (routeType !== "counter" && chainIndex % (advanced ? 3 : 8) !== 0) return;
  const actors = chainActors(chain);
  const actor = terminal.actor ?? actors.at(-1);
  const partner = [...actors].reverse().find((candidate) => candidate.id !== actor?.id);
  const defender = terminal.defender;
  if (!actor || !defender) return;
  const routeLabel = routeType === "counter" ? "快速反击" : routeType === "direct" ? "纵向直传" : "连续短传";
  const cooperation = partner ? `${partner.name}与${actor.name}尝试${routeLabel}` : `${actor.name}尝试${routeLabel}`;
  const actionType = defensiveAction?.actionType ?? v2DefensiveActionType(chain);
  const actionText = actionType === "clearance" ? "抢先将球解围" : actionType === "interception" ? "及时预判传球线路并完成拦截" : "在一对一对抗中完成抢断";
  addEvent(match, actionType, chain.defendingTeamIndex, `${cooperation}，${defender.name}${actionText}${defensiveAction?.pressureWon ? "，这次防守来自持续高压逼抢" : ""}。`, {
    actorId:defender.id,
    opponentId:actor.id,
    participantId:partner?.id ?? null,
    defensiveAction:actionType,
    pressureWon:Boolean(defensiveAction?.pressureWon),
  });
}

export function v2HighLineBreakawayProfile(baseXg, chain, shotType, parameters = V2_MATCH_PARAMETERS, explicitXg = false) {
  const shotStage = chain?.stages?.at(-1) ?? {};
  const config = parameters.chain.breakaway ?? {};
  const highLineRisk = Number(shotStage.defendingBacklineExposureBreakdown?.highLineRisk ?? 0);
  const exposure = Number(shotStage.defendingBacklineExposure ?? 0);
  const defendingDimensions = shotStage.defendingTacticalDimensions ?? {};
  const highPressConfig = parameters.tactics?.styleIdentity?.highPress ?? {};
  const defendingHighPress = shotStage.defendingStyle === "highPress";
  const pressingSeverity = clamp((Number(defendingDimensions.pressing ?? 50) - Number(highPressConfig.riskPressingThreshold ?? 68)) / Math.max(1, 100 - Number(highPressConfig.riskPressingThreshold ?? 68)), 0, 1);
  const lineSeverity = clamp((Number(defendingDimensions.defensiveLine ?? 50) - Number(highPressConfig.riskDefensiveLineThreshold ?? 62)) / Math.max(1, 100 - Number(highPressConfig.riskDefensiveLineThreshold ?? 62)), 0, 1);
  const highPressSeverity = defendingHighPress ? pressingSeverity * 0.65 + lineSeverity * 0.35 : 0;
  const routeTypes = new Set((chain?.stages ?? []).map((stage) => stage.connection?.routeType).filter(Boolean));
  const transition = chain?.possessionType === "transition";
  const direct = routeTypes.has("direct") || routeTypes.has("counter");
  const eligibleType = !["cross", "cutback", "longShot", "setPiece", "freeKick", "rebound", "penalty"].includes(shotType);
  const minimumRisk = Number(config.minimumHighLineRisk ?? 0.08);
  if (explicitXg || !eligibleType || (!transition && !direct) || (highLineRisk <= minimumRisk && highPressSeverity <= 0)) {
    return { xg:round(baseXg), breakaway:false, bonus:0, defendingLine:Number(shotStage.defendingLine ?? 50) };
  }
  const lineBreakSeverity = clamp((highLineRisk - minimumRisk) / Math.max(0.01, 1 - minimumRisk), 0, 1);
  const routeMultiplier = transition ? Number(config.transitionMultiplier ?? 1) : Number(config.directRouteMultiplier ?? 0.9);
  const baseBonus = Number(config.maximumXgBonus ?? 0.22) * lineBreakSeverity * routeMultiplier * (0.75 + clamp(exposure, 0, 1) * 0.25);
  const highPressBonus = Number(highPressConfig.breakawayXgMaximum ?? 0) * highPressSeverity * routeMultiplier * Number(config.highPressCounterRiskWeight ?? 1);
  const bonus = round(baseBonus + highPressBonus);
  return {
    xg:round(clamp(Number(baseXg) + bonus, 0, Number(config.maximumXg ?? 0.5))),
    breakaway:bonus > 0,
    bonus,
    defendingLine:Number(shotStage.defendingLine ?? 50), highPressSeverity:round(highPressSeverity),
  };
}

function resolveShot(match, teamIndex, chain, options = {}) {
  const attacking = match.teams[teamIndex];
  const defending = match.teams[1 - teamIndex];
  const shotStage = chain.stages.at(-1);
  let type = options.type ?? shotTypeFrom(chain, attacking);
  const candidates = activePlayers(attacking).filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK");
  let shooter = options.taker ?? candidates.find((player) => player.id === shotStage.actor?.id) ?? pick(match, candidates, (player) => effectiveMetric(match, teamIndex, player, { finishing:0.45, offBall:0.3, composure:0.25 }));
  const longShotCandidate = options.type ? null : bestLongShotCandidate(match, teamIndex, attacking);
  const longShot = longShotProfile(match, teamIndex, attacking, longShotCandidate, chain, type, options.type);
  if (longShot) {
    type = "longShot";
    shooter = longShot.candidate;
  }
  const possessionStyle = attacking.splitTacticsExplicit ? attacking.possessionStyle : attacking.style;
  if (!options.taker && !longShot && type === "cross") {
    shooter = pick(match, candidates, (player) => effectiveMetric(match, teamIndex, player, { heading:0.42, jumping:0.22, strength:0.18, offBall:0.18 }) + (Number(snapshotPlayer(match, teamIndex, player.id)?.heightCm ?? player.heightCm ?? 180) - 180) * 0.65);
  }
  const shotZone = longShot?.zone ?? chain.endZone ?? shotStage?.zone ?? "box:center";
  const keeper = goalkeeper(defending);
  if (!shooter) return { outcome:"abandoned", xg:0 };
  const creator = type === "setPiece"
    ? (options.creator?.active && options.creator.id !== shooter.id ? options.creator : null)
    : shotCreator(attacking, chain, shooter, type, options.creator);
  if (!creator && ["throughBall", "cross", "cutback", "counter"].includes(type)) {
    type = chain.possessionType === "transition" || type === "counter" ? "soloCounter" : "individual";
  }
  const typeLabel = SHOT_TYPE_LABELS[type] ?? "进攻配合";
  describeShotBuildUp(match, teamIndex, chain, shooter, creator, type);
  const finishing = ["cross", "setPiece"].includes(type) ? effectiveMetric(match, teamIndex, shooter, { heading:0.42, jumping:0.2, composure:0.2, finishing:0.18 }) : ["longShot", "freeKick"].includes(type) ? effectiveMetric(match, teamIndex, shooter, { longShots:0.42, setPieces:0.3, composure:0.18, finishing:0.1 }) : effectiveMetric(match, teamIndex, shooter, { finishing:0.5, composure:0.3, offBall:0.2 });
  const keeperValue = keeper ? effectiveMetric(match, 1 - teamIndex, keeper, { goalkeeping:0.52, reflexes:0.32, positioning:0.16 }) : 18;
  const displayedFinishing = ["cross", "setPiece"].includes(type) ? displayMetric(match, teamIndex, shooter, { heading:0.42, jumping:0.2, composure:0.2, finishing:0.18 }) : ["longShot", "freeKick"].includes(type) ? displayMetric(match, teamIndex, shooter, { longShots:0.42, setPieces:0.3, composure:0.18, finishing:0.1 }) : displayMetric(match, teamIndex, shooter, { finishing:0.5, composure:0.3, offBall:0.2 });
  const displayedKeeperValue = keeper ? displayMetric(match, 1 - teamIndex, keeper, { goalkeeping:0.52, reflexes:0.32, positioning:0.16 }) : 18;
  const baseXg = options.xg ?? longShot?.baseXg ?? shotStage.probability;
  const styleIdentity = shotStage?.attackingStyleIdentity ?? {};
  const identityXgMultiplier = type === "cross"
    ? Number(styleIdentity.crossingMultiplier ?? 1) * (possessionStyle === "longBall" ? Number(styleIdentity.headerXgMultiplier ?? 1) : 1)
    : type === "counter" || type === "soloCounter"
      ? Number(styleIdentity.transitionMultiplier ?? 1) * Number(styleIdentity.outletMultiplier ?? 1)
      : 1;
  const rawXg = clamp(baseXg * identityXgMultiplier, 0.015, type === "penalty" ? 0.82 : 0.58);
  const openPlayScale = options.xg == null || options.applyOpenPlayScale
    ? Number(match.parameters.chain.openPlayXgScale ?? 1)
    : 1;
  const scoreStateXgMultiplier = scoreStateShotXgMultiplier(match, teamIndex, type);
  const calibratedXg = calibrateV2ShotXg(rawXg, type, openPlayScale);
  const breakawayProfile = v2HighLineBreakawayProfile(calibratedXg, chain, type, match.parameters, options.xg != null);
  const xg = round(breakawayProfile.xg * scoreStateXgMultiplier);
  const possessionType = options.possessionType ?? chain.possessionType ?? "normal";
  const outcomeProfile = v2ShotOutcomeProfile(xg, finishing, keeperValue, type);
  const bodyPartProfile = v2ShotBodyPartProfile(snapshotPlayer(match, teamIndex, shooter.id) ?? shooter, type, seededEventRoll(match, "shotBodyPart", teamIndex, chain.context?.chainIndex ?? match.nextChainIndex, shooter.id));
  attacking.stats.shots += 1;
  attacking.stats.xg = round(attacking.stats.xg + xg);
  attacking.stats[possessionType === "transition" ? "transitionShots" : "normalShots"] += 1;
  const sourceXgKey = possessionType === "transition" ? "transitionXg" : "normalXg";
  attacking.stats[sourceXgKey] = round(attacking.stats[sourceXgKey] + xg);
  shooter.matchStats.shots += 1;
  const onTarget = match.rng() < outcomeProfile.onTargetProbability;
  const goal = onTarget && match.rng() < 1 - outcomeProfile.saveProbabilityGivenOnTarget;
  const saved = onTarget && !goal;
  if (onTarget) {
    attacking.stats.shotsOnTarget += 1;
    shooter.matchStats.shotsOnTarget += 1;
  }
  if (goal) {
    attacking.score += 1;
    attacking.stats.goals += 1;
    shooter.matchStats.goals += 1;
    if (creator) creator.matchStats.assists += 1;
    const assistText = creator ? `助攻：${creator.name}` : type === "penalty" ? "点球直接得分" : "无助攻";
    addEvent(match, "goal", teamIndex, `${shooter.name}以${bodyPartProfile.label}破门！${assistText}，${typeLabel}，xG ${xg.toFixed(2)}，比分${match.teams[0].score}:${match.teams[1].score}。`, {
      actorId:shooter.id,
      assistId:creator?.id ?? null,
      opponentId:keeper?.id ?? null,
      attackType:type,
      xg,
      bodyPart:bodyPartProfile.bodyPart,
      bodyPartLabel:bodyPartProfile.label,
      goalProbability:outcomeProfile.goalProbability,
      onTargetProbability:outcomeProfile.onTargetProbability,
      saveProbability:outcomeProfile.saveProbabilityGivenOnTarget,
      scoreStateXgMultiplier,
      zone:shotZone,
      attackingTeamIndex:teamIndex,
      possessionType,
      breakaway:breakawayProfile.breakaway,
      breakawayBonus:breakawayProfile.bonus,
      defendingLine:breakawayProfile.defendingLine,
      score:match.teams.map((team) => team.score),
      detail:`射手：${shooter.name}；进球部位：${bodyPartProfile.label}；${assistText}；进攻方式：${typeLabel}；机会质量：xG ${xg.toFixed(3)}；终结能力：${Math.round(displayedFinishing)}；${keeper ? `门将：${keeper.name}（扑救能力 ${Math.round(displayedKeeperValue)}）` : "对方没有有效门将"}。`,
    });
    return { outcome:"goal", xg, shooterId:shooter.id };
  }
  if (!onTarget) {
    const block = shotBlockProfile(match, 1 - teamIndex, chain, type);
    if (block.blocked && block.defender) {
      attacking.stats.blockedShots = Number(attacking.stats.blockedShots ?? 0) + 1;
      defending.stats.blocks = Number(defending.stats.blocks ?? 0) + 1;
      block.defender.matchStats.blocks = Number(block.defender.matchStats.blocks ?? 0) + 1;
      addEvent(match, "block", 1 - teamIndex, `${block.defender.name}封堵了${shooter.name}在${zoneLabel(shotZone)}的${bodyPartProfile.label}射门。`, {
        actorId:block.defender.id, opponentId:shooter.id, attackType:type, xg, bodyPart:bodyPartProfile.bodyPart, bodyPartLabel:bodyPartProfile.label,
        blockProbability:block.probability, zone:shotZone, attackingTeamIndex:teamIndex, possessionType,
        detail:`封堵球员：${block.defender.name}；射门球员：${shooter.name}；射门部位：${bodyPartProfile.label}；起脚区域：${zoneLabel(shotZone)}；机会质量：xG ${xg.toFixed(3)}。`,
      });
      const corner = maybeAwardCorner(match, teamIndex, chain, "block", Number(match.parameters.chain.setPiece?.cornerFromBlockChance ?? 0), Number(options.setPieceDepth ?? 0), possessionType);
      if (corner) return corner;
      return { outcome:"block", xg, shooterId:shooter.id, blockerId:block.defender.id };
    }
    addEvent(match, "miss", teamIndex, `${shooter.name}在${zoneLabel(shotZone)}接应${typeLabel}后攻门偏出，机会质量xG ${xg.toFixed(2)}。`, {
      actorId:shooter.id, attackType:type, xg, bodyPart:bodyPartProfile.bodyPart, bodyPartLabel:bodyPartProfile.label, goalProbability:outcomeProfile.goalProbability, onTargetProbability:outcomeProfile.onTargetProbability, scoreStateXgMultiplier, zone:shotZone, attackingTeamIndex:teamIndex, possessionType, breakaway:breakawayProfile.breakaway, breakawayBonus:breakawayProfile.bonus, defendingLine:breakawayProfile.defendingLine,
      detail:`射门球员：${shooter.name}；进攻方式：${typeLabel}；起脚区域：${zoneLabel(shotZone)}；机会质量：xG ${xg.toFixed(3)}；终结能力：${Math.round(displayedFinishing)}；结果：未射正。`,
    });
    return { outcome:"miss", xg, shooterId:shooter.id };
  }
  if (keeper) {
    defending.stats.saves += 1;
    keeper.matchStats.saves += 1;
  }
  const looseBall = type !== "penalty" && match.rng() < clamp(0.18 + xg * 0.25 - keeperValue / 1000, 0.05, 0.22);
  addEvent(match, "save", 1 - teamIndex, `${keeper?.name ?? "防守球员"}扑出${shooter.name}在${zoneLabel(shotZone)}接应${typeLabel}后的射门${looseBall ? "，皮球脱手形成补射机会" : "并稳稳控制住皮球"}。`, {
    actorId:keeper?.id ?? null, opponentId:shooter.id, attackType:type, xg, bodyPart:bodyPartProfile.bodyPart, bodyPartLabel:bodyPartProfile.label, goalProbability:outcomeProfile.goalProbability, onTargetProbability:outcomeProfile.onTargetProbability, saveProbability:outcomeProfile.saveProbabilityGivenOnTarget, scoreStateXgMultiplier, looseBall, zone:shotZone, attackingTeamIndex:teamIndex, possessionType, breakaway:breakawayProfile.breakaway, breakawayBonus:breakawayProfile.bonus, defendingLine:breakawayProfile.defendingLine,
    detail:`射门球员：${shooter.name}；门将：${keeper?.name ?? "无有效门将"}；进攻方式：${typeLabel}；起脚区域：${zoneLabel(shotZone)}；机会质量：xG ${xg.toFixed(3)}；终结能力：${Math.round(displayedFinishing)}；扑救能力：${Math.round(displayedKeeperValue)}；${looseBall ? "扑救后未能控制皮球" : "扑救后控制住皮球"}。`,
  });
  if (looseBall && Number(options.reboundDepth ?? 0) < 1) {
    const rebounder = pick(match, candidates.filter((player) => player.id !== shooter.id), (player) => effectiveMetric(match, teamIndex, player, { offBall:0.5, finishing:0.3, acceleration:0.2 }));
    if (rebounder && match.rng() < 0.48) return resolveShot(match, teamIndex, chain, { type:"rebound", taker:rebounder, xg:clamp(xg * 0.52, 0.06, 0.28), possessionType, reboundDepth:Number(options.reboundDepth ?? 0) + 1, setPieceDepth:Number(options.setPieceDepth ?? 0) });
  }
  if (type !== "penalty") {
    const corner = maybeAwardCorner(match, teamIndex, chain, "save", Number(match.parameters.chain.setPiece?.cornerFromSaveChance ?? 0), Number(options.setPieceDepth ?? 0), possessionType);
    if (corner) return corner;
  }
  return { outcome:"save", xg, shooterId:shooter.id };
}

export function v2SetPieceTargetPool(candidates, taker) {
  const receivers = candidates.filter((player) => player.id !== taker?.id);
  const attackingReceivers = receivers.filter((player) => roleGroup(player.assignedRole ?? player.role) === "ATT");
  return attackingReceivers.length ? attackingReceivers : receivers;
}

export function v2SetPieceChanceProfile(inputs = {}, parameters = V2_MATCH_PARAMETERS) {
  const config = parameters.chain?.setPiece ?? {};
  const kind = inputs.kind === "corner" ? "corner" : "freeKick";
  const delivery = Number(inputs.delivery ?? 70);
  const targetAerial = Number(inputs.targetAerial ?? 70);
  const markerAerial = Number(inputs.markerAerial ?? 70);
  const targetMovement = Number(inputs.targetMovement ?? 70);
  const directAbility = Number(inputs.directAbility ?? delivery);
  const directEligible = kind === "freeKick" && ["center", "leftHalfSpace", "rightHalfSpace"].includes(inputs.sourceLane);
  const directFreeKickChance = directEligible
    ? clamp(Number(config.directFreeKickBaseChance ?? 0.14) + (directAbility - 70) * Number(config.directFreeKickSkillWeight ?? 0.004), Number(config.minimumDirectFreeKickChance ?? 0.08), Number(config.maximumDirectFreeKickChance ?? 0.38))
    : 0;
  const directFreeKickXg = clamp(Number(config.directFreeKickBaseXg ?? 0.065) + (directAbility - 70) * 0.0015, Number(config.minimumDirectFreeKickXg ?? 0.045), Number(config.maximumDirectFreeKickXg ?? 0.16));
  const deliveryBase = kind === "corner" ? Number(config.cornerDeliveryBase ?? 0.5) : Number(config.freeKickDeliveryBase ?? 0.56);
  const deliveryProbability = clamp(deliveryBase + (delivery - 68) / Number(config.deliverySkillDivisor ?? 180), Number(config.minimumDeliveryProbability ?? 0.26), Number(config.maximumDeliveryProbability ?? 0.88));
  const duelProbability = clamp(Number(config.duelBase ?? 0.5) + (targetAerial - markerAerial) / Number(config.aerialDifferenceDivisor ?? 165), Number(config.minimumDuelProbability ?? 0.22), Number(config.maximumDuelProbability ?? 0.82));
  const shotCreationBase = kind === "corner" ? Number(config.cornerShotCreationBase ?? 0.54) : Number(config.freeKickShotCreationBase ?? 0.62);
  const shotCreationProbability = clamp(shotCreationBase + (targetMovement - 70) / 260 + (delivery - markerAerial) / 520, 0.28, 0.84);
  const baseXg = kind === "corner" ? Number(config.cornerBaseXg ?? 0.075) : Number(config.freeKickHeaderBaseXg ?? 0.09);
  const headerXg = clamp(baseXg + (targetAerial - 70) * 0.0012 + (delivery - 70) * 0.0007 - Math.max(0, markerAerial - 70) * 0.0006, Number(config.minimumHeaderXg ?? 0.035), Number(config.maximumHeaderXg ?? 0.19));
  return {
    directFreeKickChance:round(directFreeKickChance), directFreeKickXg:round(directFreeKickXg),
    deliveryProbability:round(deliveryProbability), duelProbability:round(duelProbability),
    shotCreationProbability:round(shotCreationProbability), headerXg:round(headerXg),
  };
}

export function v2SelectSetPieceTaker(match, teamIndex, kind = "freeKick") {
  const team = match.teams[teamIndex];
  const captain = kind !== "corner" ? activeCaptain(team) : null;
  if (captain) return captain;
  const candidates = activePlayers(team).filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK");
  return highestAttributePlayer(match, teamIndex, candidates, kind === "penalty" ? "finishing" : "setPieces");
}

function resolveSetPiece(match, teamIndex, kind, setPieceDepth = 0, possessionType = "normal", sourceZone = null) {
  const attacking = match.teams[teamIndex];
  const candidates = activePlayers(attacking).filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK");
  const taker = v2SelectSetPieceTaker(match, teamIndex, kind);
  attacking.stats.setPieces += 1;
  if (kind === "penalty") {
    attacking.stats.penalties += 1;
    const keeper = goalkeeper(match.teams[1 - teamIndex]);
    addEvent(match, "penalty", teamIndex, `${taker?.name ?? attacking.name}站上点球点，准备主罚；${keeper?.name ?? "防守方"}镇守球门。`, {
      actorId:taker?.id ?? null, opponentId:keeper?.id ?? null, penaltyPhase:"take", attackingTeamIndex:teamIndex,
      detail:`主罚球员：${taker?.name ?? "未知"}；防守门将：${keeper?.name ?? "无有效门将"}；标准点球机会质量：xG 0.760。`,
    });
    const guaranteed = keeper && traitHook(keeper, "firstPenaltySave")?.guaranteed && !keeper.v2FirstPenaltySaveUsed;
    if (guaranteed) {
      keeper.v2FirstPenaltySaveUsed = true;
      attacking.stats.shots += 1;
      attacking.stats[possessionType === "transition" ? "transitionShots" : "normalShots"] += 1;
      attacking.stats.shotsOnTarget += 1;
      attacking.stats.xg = round(attacking.stats.xg + 0.76);
      const sourceXgKey = possessionType === "transition" ? "transitionXg" : "normalXg";
      attacking.stats[sourceXgKey] = round(attacking.stats[sourceXgKey] + 0.76);
      match.teams[1 - teamIndex].stats.saves += 1;
      keeper.matchStats.saves += 1;
      addEvent(match, "save", 1 - teamIndex, `${keeper.name}触发“一夫当关”，扑出本场面对的第一粒点球。`, { actorId:keeper.id, opponentId:taker?.id ?? null, attackType:"penalty", xg:0.76, traitName:"一夫当关", zone:"box:center", attackingTeamIndex:teamIndex, possessionType });
      return { outcome:"save", xg:0.76 };
    }
    return resolveShot(match, teamIndex, { possessionType, stages:[{ actor:taker ? { id:taker.id } : null, probability:0.76 }] }, { type:"penalty", taker, xg:0.76, possessionType });
  }
  if (!taker) return { outcome:"noTaker", xg:0 };
  const defenders = activePlayers(match.teams[1 - teamIndex]).filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK");
  const targets = v2SetPieceTargetPool(candidates, taker);
  const target = pick(match, targets, (player) => effectiveMetric(match, teamIndex, player, { heading:0.42, jumping:0.22, strength:0.18, offBall:0.18 }));
  const marker = pick(match, defenders, (player) => effectiveMetric(match, 1 - teamIndex, player, { marking:0.35, positioning:0.3, heading:0.2, jumping:0.15 }));
  const delivery = effectiveMetric(match, teamIndex, taker, { setPieces:0.45, crossing:0.3, passing:0.25 });
  const targetAerial = target ? effectiveMetric(match, teamIndex, target, { heading:0.42, jumping:0.24, strength:0.2, offBall:0.14 }) + (Number(snapshotPlayer(match, teamIndex, target.id)?.heightCm ?? target.heightCm ?? 180) - 180) * 0.65 : 40;
  const markerAerial = marker ? effectiveMetric(match, 1 - teamIndex, marker, { heading:0.38, jumping:0.26, strength:0.2, marking:0.16 }) + (Number(snapshotPlayer(match, 1 - teamIndex, marker.id)?.heightCm ?? marker.heightCm ?? 180) - 180) * 0.55 : 35;
  const recordClearance = (player) => {
    if (!player) return;
    player.matchStats.clearances = Number(player.matchStats.clearances ?? 0) + 1;
    player.matchStats.setPieceClearances = Number(player.matchStats.setPieceClearances ?? 0) + 1;
    match.teams[1 - teamIndex].stats.clearances = Number(match.teams[1 - teamIndex].stats.clearances ?? 0) + 1;
    match.teams[1 - teamIndex].stats.setPieceClearances = Number(match.teams[1 - teamIndex].stats.setPieceClearances ?? 0) + 1;
  };
  const sourceLane = String(sourceZone ?? "").split(":")[1];
  const directFreeKickAbility = effectiveMetric(match, teamIndex, taker, { setPieces:0.46, longShots:0.28, composure:0.16, finishing:0.1 });
  const displayedDirectFreeKickAbility = displayMetric(match, teamIndex, taker, { setPieces:0.46, longShots:0.28, composure:0.16, finishing:0.1 });
  const targetMovement = target ? effectiveMetric(match, teamIndex, target, { offBall:0.46, decisions:0.2, acceleration:0.14, heading:0.2 }) : 40;
  const chanceProfile = v2SetPieceChanceProfile({ kind, sourceLane, delivery, targetAerial, markerAerial, targetMovement, directAbility:directFreeKickAbility }, match.parameters);
  const directFreeKickChance = chanceProfile.directFreeKickChance;
  if (directFreeKickChance > 0 && match.rng() < directFreeKickChance) {
    const xg = chanceProfile.directFreeKickXg;
    addEvent(match, "setPiece", teamIndex, `${taker.name}选择直接主罚任意球，瞄准球门完成攻门。`, {
      actorId:taker.id, setPieceType:kind, direct:true, sourceZone, directFreeKickChance:round(directFreeKickChance),
      detail:`主罚球员：${taker.name}；任意球能力：${Math.round(displayedDirectFreeKickAbility)}；选择直接射门概率：${Math.round(directFreeKickChance * 100)}%；机会质量：xG ${xg.toFixed(3)}。`,
    });
    return resolveShot(match, teamIndex, { possessionType, context:{ chainIndex:match.nextChainIndex }, endZone:sourceZone ?? "finalThird:center", stages:[{ actor:{ id:taker.id }, probability:xg }] }, { type:"freeKick", taker, xg, setPieceDepth, possessionType });
  }
  const deliveryLane = ["leftHalfSpace", "center", "rightHalfSpace"][Math.floor(match.rng() * 3)] ?? "center";
  const deliveryZone = `box:${deliveryLane}`;
  addEvent(match, "setPiece", teamIndex, `${taker.name}为${attacking.name}主罚${kind === "corner" ? "角球" : "前场定位球"}，将球送向${zoneLabel(deliveryZone)}${target ? `，${target.name}向第一落点前插` : ""}。`, {
    actorId:taker.id, targetId:target?.id ?? null, markerId:marker?.id ?? null, setPieceType:kind, direct:false, deliveryZone, sourceZone,
  });
  const deliveryProbability = chanceProfile.deliveryProbability;
  if (match.rng() >= deliveryProbability) {
    recordClearance(marker);
    addEvent(match, "clearance", 1 - teamIndex, `${marker?.name ?? "防守球员"}判断落点，直接解围定位球。`, { actorId:marker?.id ?? null, setPieceType:kind, deliveryZone, deliveryProbability:round(deliveryProbability) });
    return { outcome:"cleared", xg:0 };
  }
  const duelProbability = chanceProfile.duelProbability;
  if (!target || match.rng() >= duelProbability) {
    recordClearance(marker);
    addEvent(match, "clearance", 1 - teamIndex, `${marker?.name ?? "防守球员"}赢下定位球争顶并完成解围。`, { actorId:marker?.id ?? null, targetId:target?.id ?? null, setPieceType:kind, deliveryZone, duelProbability:round(duelProbability) });
    return { outcome:"aerialLost", xg:0 };
  }
  const shotCreationProbability = chanceProfile.shotCreationProbability;
  if (match.rng() >= shotCreationProbability) {
    recordClearance(marker);
    addEvent(match, "clearance", 1 - teamIndex, `${target.name}抢到第一落点，但${marker?.name ?? "防守球员"}贴身干扰，没有让他完成攻门。`, {
      actorId:marker?.id ?? null, opponentId:target.id, setPieceType:kind, deliveryZone, shotCreationProbability:round(shotCreationProbability), secondBall:true,
    });
    return { outcome:"chanceSmothered", xg:0 };
  }
  addEvent(match, "setPieceDuel", teamIndex, `${target.name}抢到定位球第一落点，在${zoneLabel(deliveryZone)}形成头球攻门机会。`, {
    actorId:target.id, opponentId:marker?.id ?? null, setPieceType:kind, deliveryZone, deliveryProbability:round(deliveryProbability), duelProbability:round(duelProbability), shotCreationProbability:round(shotCreationProbability),
  });
  const xg = chanceProfile.headerXg;
  return resolveShot(match, teamIndex, { possessionType, context:{ chainIndex:match.nextChainIndex }, endZone:deliveryZone, stages:[{ actor:{ id:target.id }, probability:xg }] }, { type:"setPiece", taker:target, creator:taker, xg, setPieceDepth, possessionType });
}

function processDiscipline(match, chain) {
  for (const stage of chain.stages) {
    if (!stage.foul?.occurred) continue;
    const defending = match.teams[chain.defendingTeamIndex];
    const attacking = match.teams[chain.attackingTeamIndex];
    const offender = defending.players.find((player) => player.id === stage.defender?.id);
    defending.stats.fouls += 1;
    if (offender) offender.matchStats.fouls += 1;
    const foulZone = zoneLabel(stage.zone);
    const foulSeverity = stage.foul.card === "red" ? "危险动作" : stage.foul.card === "yellow" ? "鲁莽犯规" : "战术犯规";
    addEvent(match, "foul", defending.index, `${offender?.name ?? defending.name}在${foulZone}对${stage.actor?.name ?? attacking.name}${foulSeverity}，${attacking.name}获得${stage.foul.penalty ? "点球" : "定位球"}。`, {
      actorId:offender?.id ?? null, opponentId:stage.actor?.id ?? null, zone:stage.zone, foulSeverity,
      detail:`犯规球员：${offender?.name ?? "未知"}；被犯规球员：${stage.actor?.name ?? "未知"}；区域：${foulZone}；动作性质：${foulSeverity}；裁判尺度：${stage.foul.referee}。`,
    });
    if (stage.foul.penalty) {
      addEvent(match, "penaltyAwarded", attacking.index, `裁判判罚点球：${offender?.name ?? defending.name}在禁区内侵犯${stage.actor?.name ?? attacking.name}。`, {
        actorId:stage.actor?.id ?? null, opponentId:offender?.id ?? null, zone:stage.zone,
        detail:`制造点球：${stage.actor?.name ?? "未知"}；犯规球员：${offender?.name ?? "未知"}；犯规区域：${foulZone}。`,
      });
    }
    if (stage.foul.card === "yellow" && offender) {
      offender.matchStats.yellowCards += 1;
      defending.stats.yellowCards += 1;
      addEvent(match, "yellow", defending.index, `${offender.name}因在${foulZone}对${stage.actor?.name ?? "对手"}的鲁莽犯规被出示黄牌，这是他本场第${offender.matchStats.yellowCards}张黄牌。`, {
        actorId:offender.id, opponentId:stage.actor?.id ?? null, zone:stage.zone, yellowCardNumber:offender.matchStats.yellowCards,
        detail:`被罚球员：${offender.name}；犯规对象：${stage.actor?.name ?? "未知"}；犯规区域：${foulZone}；本场个人黄牌：${offender.matchStats.yellowCards}张。`,
      });
      if (offender.matchStats.yellowCards >= 2) {
        if (traitHook(offender, "redCardImmune")?.immune) {
          addEvent(match, "trait", defending.index, `${offender.name}的红牌免疫生效，第二张黄牌未升级为红牌。`, { actorId:offender.id, traitName:"普拉蒂尼是我爹" });
        } else removePlayer(match, defending, offender, "red", { cause:"secondYellow", opponentId:stage.actor?.id ?? null, opponentName:stage.actor?.name ?? null, zone:stage.zone });
      }
    }
    if (stage.foul.card === "red" && offender) {
      if (traitHook(offender, "redCardImmune")?.immune) {
        offender.matchStats.yellowCards += 1;
        defending.stats.yellowCards += 1;
        addEvent(match, "trait", defending.index, `${offender.name}的红牌免疫生效，本次判罚降为黄牌。`, { actorId:offender.id, traitName:"普拉蒂尼是我爹" });
      } else removePlayer(match, defending, offender, "red", { cause:"directRed", opponentId:stage.actor?.id ?? null, opponentName:stage.actor?.name ?? null, zone:stage.zone });
    }
    if (stage.foul.simulationYellow && stage.actor?.id) {
      const creator = attacking.players.find((player) => player.id === stage.actor.id);
      if (creator?.active) {
        creator.matchStats.yellowCards += 1;
        attacking.stats.yellowCards += 1;
        addEvent(match, "yellow", attacking.index, `${creator.name}在${foulZone}倒地试图制造${stage.foul.penalty ? "点球" : "定位球"}，裁判认定其假摔并出示本场第${creator.matchStats.yellowCards}张黄牌。`, {
          actorId:creator.id, traitId:stage.foul.traitId ?? null, zone:stage.zone, simulation:true, yellowCardNumber:creator.matchStats.yellowCards,
          detail:`假摔球员：${creator.name}；发生区域：${foulZone}；试图制造：${stage.foul.penalty ? "点球" : "定位球"}；本场个人黄牌：${creator.matchStats.yellowCards}张。`,
        });
        if (creator.matchStats.yellowCards >= 2 && !traitHook(creator, "redCardImmune")?.immune) removePlayer(match, attacking, creator, "red", { cause:"secondYellow", zone:stage.zone });
      }
    }
    const foulBand = String(stage.zone ?? "").split(":")[0];
    if (stage.foul.penalty || ["finalThird", "box"].includes(foulBand)) {
      resolveSetPiece(match, attacking.index, stage.foul.penalty ? "penalty" : "freeKick", 0, chain.possessionType ?? "normal", stage.zone);
    } else attacking.stats.setPieces += 1;
  }
}

function processInjuries(match, chain) {
  const events = [...chain.independentEvents];
  const highPressInjuryConfig = match.parameters.events.highPressInjury ?? {};
  const highPressInjurySeverity = (team) => {
    if ((team.splitTacticsExplicit ? team.defensiveBlock : team.style) !== "highPress") return 0;
    const dimensions = team.tacticalDimensions ?? {};
    const pressingThreshold = Number(highPressInjuryConfig.pressingThreshold ?? 68);
    const lineThreshold = Number(highPressInjuryConfig.defensiveLineThreshold ?? 62);
    const pressingSeverity = clamp((Number(dimensions.pressing ?? 50) - pressingThreshold) / Math.max(1, 100 - pressingThreshold), 0, 1);
    const lineSeverity = clamp((Number(dimensions.defensiveLine ?? 50) - lineThreshold) / Math.max(1, 100 - lineThreshold), 0, 1);
    return clamp(pressingSeverity * Number(highPressInjuryConfig.pressingWeight ?? 0.65) + lineSeverity * Number(highPressInjuryConfig.defensiveLineWeight ?? 0.35), 0, 1);
  };
  const highPressTeams = match.teams.map((team) => ({ team, severity:highPressInjurySeverity(team) })).filter((entry) => entry.severity > 0);
  const injuryMultiplier = highPressTeams.length
    ? Math.max(...highPressTeams.map(({ severity }) => Number(highPressInjuryConfig.minimumMultiplier ?? 1.08) + (Number(highPressInjuryConfig.maximumMultiplier ?? 1.65) - Number(highPressInjuryConfig.minimumMultiplier ?? 1.08)) * severity))
    : 1;
  const injuryProbability = clamp(Number(match.parameters.events.injuryPerChain ?? 0) * injuryMultiplier, 0, 1);
  if (match.rng() < injuryProbability) events.push({ type:"matchInjury", probability:injuryProbability, highPressTeams });
  for (const event of events) {
    if (event.type === "lightningInjury") {
      if (match.lightningResolved) continue;
      match.lightningResolved = true;
      const targetTeam = pick(match, match.teams.filter((team) => activePlayers(team).length > 0));
      if (!targetTeam) continue;
      const protection = activePlayers(targetTeam)
        .map((player) => ({ player, hook:traitHook(player, "teamLightningProtection") }))
        .find((entry) => entry.hook?.immune);
      if (protection) {
        addEvent(match, "lightning", targetTeam.index, `雷电击向${targetTeam.name}，但${protection.player.name}的“${protection.hook.traitName ?? "避雷针"}”保护了全队。`, {
          actorId:protection.player.id,
          traitId:protection.hook.traitId,
          traitName:protection.hook.traitName ?? "避雷针",
          prevented:true,
          weather:event.weather ?? match.environment.weather,
        });
        continue;
      }
      const victim = pick(match, activePlayers(targetTeam).filter((player) => !injuryImmune(player)));
      if (!victim) {
        addEvent(match, "lightning", targetTeam.index, `雷电击向${targetTeam.name}，但没有球员因此受伤。`, {
          prevented:true,
          weather:event.weather ?? match.environment.weather,
        });
        continue;
      }
      addEvent(match, "lightning", targetTeam.index, `雷电击中${targetTeam.name}的${victim.name}！`, {
        actorId:victim.id,
        victimId:victim.id,
        victimName:victim.name,
        prevented:false,
        weather:event.weather ?? match.environment.weather,
      });
      removePlayer(match, targetTeam, victim, "injury", { cause:"lightningInjury", injuryRounds:2 });
      continue;
    }
    const candidates = match.teams.flatMap((team) => activePlayers(team).map((player) => ({ team, player })));
    const eligible = candidates.filter(({ player }) => !injuryImmune(player));
    const victim = pick(match, eligible, ({ team, player }) => {
      const pressEntry = highPressTeams.find((entry) => entry.team.index === team.index);
      if (!pressEntry) return 1;
      const roleWeight = ["ST", "LW", "RW", "LM", "RM", "AM", "CM", "DM"].includes(player.assignedRole) ? 1.25 : 0.8;
      return 1 + pressEntry.severity * roleWeight;
    });
    if (victim) {
      const weatherDescriptions = {
        rain:"在湿滑草皮上失去支撑扭伤脚踝",
        snow:"在积雪覆盖的草皮上落地不稳扭伤膝部",
        sunny:"在高温下出现肌肉不适",
      };
      const accidentalDescriptions = ["在无对抗冲刺中拉伤大腿后侧", "在变向时支撑脚不稳扭伤脚踝", "在落地时膝部不适", "旧伤突然复发"];
      const accidentIndex = Math.floor(match.rng() * accidentalDescriptions.length) % accidentalDescriptions.length;
      removePlayer(match, victim.team, victim.player, "injury", {
        cause:event.type,
        injuryRounds:1,
        weather:event.weather ?? match.environment.weather,
        weatherDescription:weatherDescriptions[event.weather ?? match.environment.weather] ?? "受到恶劣天气影响滑倒受伤",
        accidentDescription:accidentalDescriptions[accidentIndex],
        highPressRisk:event.highPressTeams?.some((entry) => entry.team.index === victim.team.index) ?? false,
      });
    }
  }
  for (const stage of chain.stages) {
    if (!stage.foul?.occurred || !stage.actor?.id) continue;
    const team = match.teams[chain.attackingTeamIndex];
    const player = team.players.find((candidate) => candidate.id === stage.actor.id);
    if (!player?.active || injuryImmune(player)) continue;
    const defender = match.teams[chain.defendingTeamIndex].players.find((candidate) => candidate.id === stage.defender?.id);
    const aggression = defender ? effectiveMetric(match, chain.defendingTeamIndex, defender, { aggression:1 }) : 60;
    const defendingTactics = match.teams[chain.defendingTeamIndex];
    const roughMultiplier = (defendingTactics.splitTacticsExplicit ? defendingTactics.duelIntensity : defendingTactics.style) === "roughPlay" ? Number(match.parameters.events.roughPlay?.foulInjuryMultiplier ?? 1.35) : 1;
    if (match.rng() < clamp((0.006 + Math.max(0, aggression - 65) / 2400) * roughMultiplier, 0.004, 0.06)) removePlayer(match, team, player, "injury", {
      cause:"foul",
      injuryRounds:1,
      offender:defender ? { id:defender.id, name:defender.name } : null,
      offenderTeamIndex:chain.defendingTeamIndex,
      zone:stage.zone,
      card:stage.foul.card,
    });
  }
}

function maybeWeatherImpact(match, chainIndex) {
  if (match.weatherImpactResolved || match.environment.weather === "sunny") return false;
  if (chainIndex !== 0 || match.rng() >= Number(match.parameters.events.weatherImpactPerMatch ?? 0)) return false;
  match.weatherImpactResolved = true;
  const team = pick(match, match.teams.filter((entry) => activePlayers(entry).length));
  const player = team ? pick(match, activePlayers(team)) : null;
  if (!team || !player) return false;
  const descriptions = {
    rain:`雨水让草皮变得湿滑，${player.name}接球时脚下打滑，${team.name}被迫重新组织进攻。`,
    storm:`强风和暴雨干扰了皮球线路，${player.name}未能控制来球，${team.name}丢失推进节奏。`,
    snow:`积雪拖慢球速，${player.name}的传球未能按预期到位，${team.name}只能回收球权。`,
    superStorm:`超级雷暴令球场能见度急剧下降，${player.name}几乎无法判断来球线路，${team.name}只能放慢比赛节奏。`,
  };
  addEvent(match, "weather", team.index, descriptions[match.environment.weather] ?? `${WEATHER_LABELS[match.environment.weather] ?? "天气"}影响了比赛节奏。`, {
    actorId:player.id, weather:match.environment.weather,
    detail:`天气：${WEATHER_LABELS[match.environment.weather] ?? match.environment.weather}；受影响球员：${player.name}；该事件仅说明既有天气影响，不额外改变比赛结果。`,
  });
  return true;
}

function ownGoalCandidateWeight(match, teamIndex, player) {
  const fitness = clamp(Number(player.state?.fitness ?? 100), 35, 100);
  const composure = effectiveMetric(match, teamIndex, player, { composure:1 });
  return 0.15 + clamp((70 - fitness) / 35, 0, 1) * 1.2 + clamp((65 - composure) / 40, 0, 1) * 0.9;
}

function maybeOwnGoal(match, chainIndex) {
  if (match.ownGoalResolved || chainIndex !== 0) return false;
  match.ownGoalResolved = true;
  if (!match.forceOwnGoal && seededEventRoll(match, "ownGoal", 0, 0) >= Number(match.parameters.events.ownGoalPerMatch ?? 0)) return false;
  const candidates = match.teams.flatMap((team) => activePlayers(team)
    .filter((player) => roleGroup(player.assignedRole ?? player.role) !== "ATT")
    .map((player) => ({ team, player })));
  const target = pick(match, candidates, ({ team, player }) => ownGoalCandidateWeight(match, team.index, player));
  if (!target) return false;
  const scoringIndex = 1 - target.team.index;
  const scoringTeam = match.teams[scoringIndex];
  scoringTeam.score += 1;
  scoringTeam.stats.goals += 1;
  target.player.matchStats.ownGoals = Number(target.player.matchStats.ownGoals ?? 0) + 1;
  addEvent(match, "ownGoal", scoringIndex, `乌龙球！${target.player.name}回防处理时判断失误，将球碰进自家球门，${scoringTeam.name}意外取得进球，比分${match.teams[0].score}:${match.teams[1].score}。`, {
    actorId:target.player.id, ownGoalTeamIndex:target.team.index, score:[match.teams[0].score, match.teams[1].score],
    detail:`乌龙球员：${target.player.name}；受益球队：${scoringTeam.name}；当前体能：${Math.round(Number(target.player.state?.fitness ?? 100))}；冷静：${Math.round(displayMetric(match, target.team.index, target.player, { composure:1 }))}；疲劳和低冷静会提高入选权重。`,
  });
  return true;
}

function usesRoughPlay(team) {
  return team.style === "roughPlay" || team.duelIntensity === "roughPlay";
}

function averageActiveAggression(match, team) {
  const players = activePlayers(team).filter((player) => (player.assignedRole ?? player.role) !== "GK");
  return players.reduce((sum, player) => sum + effectiveMetric(match, team.index, player, { aggression:1 }), 0) / Math.max(1, players.length);
}

function displayedAverageActiveAggression(match, team) {
  const players = activePlayers(team).filter((player) => (player.assignedRole ?? player.role) !== "GK");
  return players.reduce((sum, player) => sum + displayMetric(match, team.index, player, { aggression:1 }), 0) / Math.max(1, players.length);
}

function pickBrawlDismissals(match, team, count) {
  const candidates = activePlayers(team).filter((player) => (player.assignedRole ?? player.role) !== "GK");
  const selected = [];
  while (selected.length < count && candidates.length) {
    selected.push(candidates.splice(Math.floor(match.rng() * candidates.length), 1)[0]);
  }
  return selected;
}

function brawlCheckChainIndex(match, config, regulationChainCount) {
  if (Number.isInteger(match.brawlCheckChainIndex)) return match.brawlCheckChainIndex;
  const chainCount = Math.max(1, Math.round(Number(regulationChainCount) || 1));
  const minimumMinute = clamp(Number(config.minimumMinute ?? 20), 0, 90);
  const maximumMinute = clamp(Number(config.maximumMinute ?? 80), minimumMinute, 90);
  const minimumIndex = clamp(Math.ceil(minimumMinute / 90 * chainCount - 0.5), 0, chainCount - 1);
  const maximumIndex = clamp(Math.floor(maximumMinute / 90 * chainCount - 0.5), minimumIndex, chainCount - 1);
  match.brawlCheckChainIndex = minimumIndex + hashSeed(`${match.simulationSeed}:brawl-timing`) % (maximumIndex - minimumIndex + 1);
  return match.brawlCheckChainIndex;
}

function maybeBrawl(match, chainIndex, regulationChainCount) {
  if (match.brawlTriggered || match.brawlChecked) return false;
  const config = match.parameters.events?.brawl ?? {};
  if (chainIndex < brawlCheckChainIndex(match, config, regulationChainCount)) return false;
  match.brawlChecked = true;
  const goalDifference = Math.abs(Number(match.teams[0].score) - Number(match.teams[1].score));
  if (!match.forceBrawl && goalDifference > Number(config.maximumGoalDifference ?? 1)) return false;
  const rough = match.teams.map(usesRoughPlay);
  const averageAggression = (averageActiveAggression(match, match.teams[0]) + averageActiveAggression(match, match.teams[1])) / 2;
  const displayedAverageAggression = (displayedAverageActiveAggression(match, match.teams[0]) + displayedAverageActiveAggression(match, match.teams[1])) / 2;
  const aggressionMultiplier = clamp(1 + Math.max(0, averageAggression - Number(config.aggressionBaseline ?? 65)) / 15, 1, Number(config.aggressionMultiplierMaximum ?? 3));
  const roughMultiplier = rough[0] && rough[1]
    ? Number(config.bothSidesRoughPlayMultiplier ?? 7)
    : rough[0] || rough[1]
      ? Number(config.oneSideRoughPlayMultiplier ?? 5)
      : 1;
  const refereeMultiplier = Number(config.refereeMultiplier?.[match.environment.referee] ?? 1);
  const probability = clamp(Number(config.basePerEligibleMatch ?? 0) * aggressionMultiplier * roughMultiplier * refereeMultiplier, 0, 1);
  if (!match.forceBrawl && match.rng() >= probability) return false;
  const minimum = Math.max(1, Math.round(Number(config.dismissalsPerTeamMinimum ?? 1)));
  const maximum = Math.max(minimum, Math.round(Number(config.dismissalsPerTeamMaximum ?? 3)));
  const sharedDismissals = minimum + Math.floor(match.rng() * (maximum - minimum + 1));
  const dismissalCounts = rough[0] !== rough[1]
    ? [sharedDismissals + Number(rough[0]), sharedDismissals + Number(rough[1])]
    : [sharedDismissals, sharedDismissals];
  if (match.teams.some((team, index) => activePlayers(team).length < 7 + dismissalCounts[index])) return false;
  match.brawlTriggered = true;
  addEvent(match, "brawl", null, `双方在比分${match.teams[0].score}:${match.teams[1].score}胶着时爆发大规模冲突，裁判正在分别向涉事球员出示红牌。`, {
    importance:"major",
    score:[...match.teams.map((team) => team.score)],
    averageAggression:Number(averageAggression.toFixed(2)),
    roughPlayTeams:rough,
    referee:match.environment.referee,
    refereeMultiplier,
    dismissalCounts:[...dismissalCounts],
    detail:`触发条件：比分差${goalDifference}球；双方非门将平均侵略性${displayedAverageAggression.toFixed(1)}；伐木战术：${rough.map((value) => value ? "是" : "否").join("/")}；裁判尺度：${match.environment.referee}（触发倍率${refereeMultiplier}）；共同红牌基数：每队${sharedDismissals}人。`,
  });
  match.teams.forEach((team, teamIndex) => {
    pickBrawlDismissals(match, team, dismissalCounts[teamIndex]).forEach((player, order) => {
      removePlayer(match, team, player, "red", {
        cause:"brawl",
        brawl:true,
        brawlOrder:order + 1,
        brawlDismissalCount:dismissalCounts[teamIndex],
      });
    });
  });
  return true;
}

function maybeBlackWhistle(match, chainIndex, regulationChainCount) {
  if (match.blackWhistleTriggered) return false;
  if (!match.blackWhistleChecked) {
    match.blackWhistleChecked = true;
    if (!match.forceBlackWhistle && match.rng() >= Number(match.parameters.events.blackWhistlePerMatch ?? 0)) return false;
    const counts = match.teams.map(argentinaCount);
    if (counts[0] === counts[1]) return false;
    const firstEligibleChain = Math.max(0, Math.min(regulationChainCount - 1, Number(chainIndex) || 0));
    const remainingChains = Math.max(1, regulationChainCount - firstEligibleChain);
    match.blackWhistleChainIndex = firstEligibleChain + Math.min(remainingChains - 1, Math.floor(seededEventRoll(match, "blackWhistleTiming", 0, 0) * remainingChains));
    match.blackWhistleArgentinaCounts = counts;
    match.blackWhistleFavoredIndex = counts[0] > counts[1] ? 0 : 1;
  }
  if (!Number.isInteger(match.blackWhistleChainIndex) || chainIndex !== match.blackWhistleChainIndex) return false;
  const counts = match.blackWhistleArgentinaCounts ?? match.teams.map(argentinaCount);
  const favoredIndex = Number(match.blackWhistleFavoredIndex);
  const punishedIndex = 1 - favoredIndex;
  const favored = match.teams[favoredIndex];
  const punished = match.teams[punishedIndex];
  const dismissible = activePlayers(punished).filter((player) => !traitHook(player, "redCardImmune")?.immune);
  const offender = pick(match, dismissible.filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK")) ?? pick(match, dismissible);
  match.blackWhistleTriggered = true;
  addEvent(match, "blackWhistle", favoredIndex, `裁判出现争议判罚，${favored.name}获得明显偏向。`, { argentinaCounts:counts, punishedTeamIndex:punishedIndex, importance:"major" });
  if (offender) removePlayer(match, punished, offender, "red", { cause:"blackWhistle" });
  addEvent(match, "penaltyAwarded", favoredIndex, `裁判判给${favored.name}一粒争议点球。`, { blackWhistle:true, importance:"major" });
  resolveSetPiece(match, favoredIndex, "penalty");
  return true;
}

function ensurePlayable(match) {
  for (const team of match.teams) {
    if (activePlayers(team).length < 7) {
      match.finished = true;
      match.abandoned = true;
      addEvent(match, "abandoned", team.index, `${team.name}仅剩${activePlayers(team).length}名可比赛球员，少于规则要求的7人，比赛立即终止；终止时比分${match.teams[0].score}:${match.teams[1].score}。`, {
        activePlayers:activePlayers(team).length,
        score:match.teams.map((entry) => entry.score),
        detail:`终止球队：${team.name}；可比赛人数：${activePlayers(team).length}；最低要求：7人；终止时比分：${match.teams[0].score}:${match.teams[1].score}。`,
      });
      return false;
    }
  }
  return true;
}

export function v2TurnoverRestartZone(zone) {
  const [band, lane] = String(zone ?? "").split(":");
  const oppositeBand = {
    defensiveThird:"box",
    buildUp:"finalThird",
    finalThird:"buildUp",
    box:"defensiveThird",
  }[band];
  const oppositeLane = {
    farLeft:"farRight",
    leftHalfSpace:"rightHalfSpace",
    center:"center",
    rightHalfSpace:"leftHalfSpace",
    farRight:"farLeft",
  }[lane];
  return oppositeBand && oppositeLane ? `${oppositeBand}:${oppositeLane}` : "defensiveThird:center";
}

export function v2PossessionDurationProfile(chain, team = {}, parameters = V2_MATCH_PARAMETERS) {
  const stages = (chain?.stages ?? []).filter((stage) => stage.stage !== "possession");
  const dimensions = team.tacticalDimensions ?? {};
  const directness = clamp(Number(dimensions.directness ?? 50), 0, 100);
  const tempo = clamp(Number(dimensions.tempo ?? 50), 0, 100);
  const timeWasting = clamp(Number(dimensions.timeWasting ?? 20), 0, 100);
  const routeTypes = stages.map((stage) => stage.connection?.routeType).filter(Boolean);
  const directRoutes = routeTypes.filter((route) => route === "direct" || route === "counter").length;
  const structuredRoutes = routeTypes.filter((route) => route === "structured").length;
  const stageWeight = 14 + stages.length * 2.5;
  const retentionMultiplier = clamp(1 + (50 - directness) * 0.0015 + (50 - tempo) * 0.0008 + timeWasting * 0.0007, 0.86, 1.18);
  const possessionStyle = team.splitTacticsExplicit ? team.possessionStyle : team.style;
  const styleMultiplier = {
    balanced:1,
    vertical:.96,
    possession:1.02,
    longBall:0.96,
    wingPlay:0.99,
    counterAttack:0.94,
    highPress:0.97,
    lowBlock:0.98,
    roughPlay:0.97,
  }[possessionStyle] ?? 1;
  const routeMultiplier = clamp(1 + structuredRoutes * 0.01 - directRoutes * 0.02, 0.9, 1.08);
  const transitionMultiplier = chain?.possessionType === "transition" ? 0.82 : 1;
  const terminal = stages.at(-1);
  const outcomeMultiplier = terminal?.foul?.occurred ? 1.08 : terminal?.turnover && stages.length <= 2 ? 0.78 : 1;
  const possessionStage = (chain?.stages ?? []).find((stage) => stage.stage === "possession");
  const selectionProbability = clamp(Number(possessionStage?.probability ?? 0.5), 0, 1);
  const durationConfig = parameters.chain.possessionDuration ?? {};
  const controlMultiplier = clamp(
    1 + (selectionProbability - 0.5) * Number(durationConfig.controlProbabilityWeight ?? 0),
    Number(durationConfig.minimumControlMultiplier ?? 1),
    Number(durationConfig.maximumControlMultiplier ?? 1),
  );
  return {
    weight:round(clamp(stageWeight * retentionMultiplier * styleMultiplier * routeMultiplier * transitionMultiplier * outcomeMultiplier * controlMultiplier, 3, 80)),
    stageWeight:round(stageWeight),
    retentionMultiplier:round(retentionMultiplier),
    styleMultiplier:round(styleMultiplier),
    routeMultiplier:round(routeMultiplier),
    transitionMultiplier:round(transitionMultiplier),
    outcomeMultiplier:round(outcomeMultiplier),
    controlMultiplier:round(controlMultiplier),
  };
}

function recalculateV2PossessionSeconds(match) {
  const regulationChainCount = Math.min(Number(match.possessionChainCount ?? 180), Number(match.regulationChainCount ?? match.possessionChainCount ?? 180));
  const phaseDefinitions = [
    { chains:(match.chains ?? []).slice(0, regulationChainCount), duration:90 * 60, capacity:regulationChainCount },
    { chains:(match.chains ?? []).slice(regulationChainCount), duration:30 * 60, capacity:Math.max(0, Number(match.possessionChainCount ?? 180) - regulationChainCount) },
  ];
  match.teams.forEach((team) => {
    team.stats.possessionSeconds = 0;
    team.stats.normalPossessionSeconds = 0;
    team.stats.transitionPossessionSeconds = 0;
  });
  let totalElapsedSeconds = 0;
  for (const phase of phaseDefinitions) {
    if (!phase.chains.length || !phase.capacity) continue;
    const elapsedSeconds = round(phase.duration * phase.chains.length / phase.capacity, 2);
    totalElapsedSeconds = round(totalElapsedSeconds + elapsedSeconds, 2);
    const weights = phase.chains.map((chain) => {
      const team = match.teams[chain.attackingTeamIndex];
      const profile = chain.possessionDurationProfile ?? v2PossessionDurationProfile(chain, team, match.parameters);
      return Math.max(0.001, Number(profile.weight));
    });
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    let allocated = 0;
    phase.chains.forEach((chain, index) => {
      const seconds = index === phase.chains.length - 1
        ? round(elapsedSeconds - allocated, 2)
        : round(elapsedSeconds * weights[index] / weightTotal, 2);
      allocated = round(allocated + seconds, 2);
      const team = match.teams[chain.attackingTeamIndex];
      const sourceKey = chain.possessionType === "transition" ? "transitionPossessionSeconds" : "normalPossessionSeconds";
      team.stats[sourceKey] = round(Number(team.stats[sourceKey] ?? 0) + seconds, 2);
      team.stats.possessionSeconds = round(Number(team.stats.possessionSeconds ?? 0) + seconds, 2);
    });
  }
  match.teams.forEach((team) => {
    team.stats.possessionSeconds = Number(team.stats.normalPossessionSeconds ?? 0) + Number(team.stats.transitionPossessionSeconds ?? 0);
  });
  const possessionTotal = match.teams.reduce((sum, team) => sum + Number(team.stats.possessionSeconds ?? 0), 0);
  const correction = totalElapsedSeconds - possessionTotal;
  if (correction && match.teams.length) {
    const team = match.teams.at(-1);
    team.stats.transitionPossessionSeconds = Number(team.stats.transitionPossessionSeconds ?? 0) + correction;
    team.stats.possessionSeconds = Number(team.stats.normalPossessionSeconds ?? 0) + Number(team.stats.transitionPossessionSeconds ?? 0);
  }
}

function ensureV2SourceStats(match) {
  const possessionKeys = ["normalPossessions", "transitionPossessions", "possessionSeconds", "normalPossessionSeconds", "transitionPossessionSeconds"];
  const needsPossessionBackfill = match.teams.some((team) => possessionKeys.some((key) => !Number.isFinite(Number(team.stats[key]))));
  if (needsPossessionBackfill) {
    match.teams.forEach((team) => possessionKeys.forEach((key) => { team.stats[key] = 0; }));
    (match.chains ?? []).forEach((chain, index) => {
      const team = match.teams[chain.attackingTeamIndex];
      if (!team) return;
      const possessionType = chain.possessionType === "transition" || chain.context?.transition ? "transition" : "normal";
      team.stats[possessionType === "transition" ? "transitionPossessions" : "normalPossessions"] += 1;
    });
    recalculateV2PossessionSeconds(match);
  }
  match.teams.forEach((team) => {
    if (!Number.isFinite(Number(team.stats.normalShots)) || !Number.isFinite(Number(team.stats.transitionShots))) {
      team.stats.normalShots = Number(team.stats.shots ?? 0);
      team.stats.transitionShots = 0;
    }
    if (!Number.isFinite(Number(team.stats.normalXg)) || !Number.isFinite(Number(team.stats.transitionXg))) {
      team.stats.normalXg = Number(team.stats.xg ?? 0);
      team.stats.transitionXg = 0;
    }
  });
}

function runV2Chain(match, chainIndex, options = {}) {
  const chainCount = Number(match.possessionChainCount ?? 180);
  const regulationChainCount = Math.min(chainCount, Number(match.regulationChainCount ?? chainCount));
  const extraTimeChainCount = Math.max(0, chainCount - regulationChainCount);
  ensureV2SourceStats(match);
  match.minute = chainIndex < regulationChainCount || !extraTimeChainCount
    ? round((chainIndex + 0.5) / regulationChainCount * 90, 2)
    : round(90 + (chainIndex - regulationChainCount + 0.5) / extraTimeChainCount * 30, 2);
  match.teams.forEach((team) => applyTacticalPlan(match, team));
  captureAnalysisSnapshot(match);
  maybeBlackWhistle(match, chainIndex, regulationChainCount);
  maybeBrawl(match, chainIndex, regulationChainCount);
  maybeWeatherImpact(match, chainIndex);
  maybeOwnGoal(match, chainIndex);
  match.snapshotTeams = buildV2TeamSnapshots(match.teams, {
    parameters:match.parameters,
    state:{ minute:match.minute, score:match.teams.map((team) => team.score) },
    environment:match.environment,
  });
  const simulatedChain = simulateV2PossessionChain(match.teams, {
    rng:match.rng,
    chainIndex,
    state:{ minute:match.minute, score:match.teams.map((team) => team.score) },
    environment:match.environment,
    parameters:match.parameters,
    snapshotTeams:match.snapshotTeams,
    transition:match.transition,
    deferShotResolution:true,
    recordRandomRolls:Boolean(options.recordRandomRolls),
    recordReplayShape:Boolean(match.dotReplayEnabled),
  });
  const { replayShape, replaySequence, ...simulatedChainData } = simulatedChain;
  match.currentReplayShape = replayShape ?? null;
  match.currentReplaySequence = replaySequence ?? null;
  if (replayShape) match.lastReplayShape = replayShape;
  const attacking = match.teams[simulatedChainData.attackingTeamIndex];
  const chain = {
    ...simulatedChainData,
    stages:simulatedChainData.stages.map((stage) => ({ ...stage })),
    completedStages:[...(simulatedChainData.completedStages ?? [])],
  };
  const midfieldVacuumLongShot = materializeMidfieldVacuumLongShot(match, chain, chainIndex);
  if (midfieldVacuumLongShot.eligible) chain.midfieldVacuumLongShot = midfieldVacuumLongShot;
  chain.possessionDurationProfile = v2PossessionDurationProfile(chain, attacking, match.parameters);
  match.chains.push(chain);
  const possessionType = chain.possessionType === "transition" ? "transition" : "normal";
  attacking.stats.possessions += 1;
  attacking.stats[possessionType === "transition" ? "transitionPossessions" : "normalPossessions"] += 1;
  recalculateV2PossessionSeconds(match);
  const selectedProbability = Number(chain.stages?.[0]?.probability ?? 0.5);
  const homeControl = chain.attackingTeamIndex === 0 ? selectedProbability : 1 - selectedProbability;
  match.teams[0].stats.possessionControl += homeControl;
  match.teams[1].stats.possessionControl += 1 - homeControl;
  processDiscipline(match, chain);
  processInjuries(match, chain);
  const finalStage = chain.stages.at(-1);
  const defensiveAction = recordDefensiveTurnover(match, chain);
  let cornerRestart = null;
  if (finalStage?.stage === "shot" && finalStage.outcome === "shotCreated") {
    if (finalStage.midfieldVacuumOpportunity) {
      const taker = attacking.players.find((player) => player.id === finalStage.actor?.id) ?? null;
      resolveShot(match, chain.attackingTeamIndex, chain, { type:"longShot", taker, xg:finalStage.baseXg, possessionType, applyOpenPlayScale:true });
    } else resolveShot(match, chain.attackingTeamIndex, chain);
  }
  else if (finalStage?.outcome === "offside") {
    const attackingTeam = match.teams[chain.attackingTeamIndex];
    const offsidePlayer = finalStage.actor ?? [...chain.stages].reverse().find((stage) => stage.actor)?.actor ?? null;
    const passer = [...chain.stages].reverse().find((stage) => stage.actor?.id && stage.actor.id !== offsidePlayer?.id)?.actor ?? null;
    addEvent(match, "offside", chain.defendingTeamIndex, `${offsidePlayer?.name ?? attackingTeam.name}在${zoneLabel(finalStage.zone)}提前启动越位，${match.teams[chain.defendingTeamIndex].name}同步前压成功。`, {
      actorId:offsidePlayer?.id ?? null, passerId:passer?.id ?? null, attackingTeamIndex:chain.attackingTeamIndex, zone:finalStage.zone,
      detail:`越位球员：${offsidePlayer?.name ?? "未知"}；${passer ? `传球球员：${passer.name}；` : ""}发生区域：${zoneLabel(finalStage.zone)}；防守方式：同步前压造越位。`,
    });
  }
  else if (defensiveAction?.credited && defensiveAction.actionType === "clearance") {
    cornerRestart = maybeAwardCorner(match, chain.attackingTeamIndex, chain, "clearance", Number(match.parameters.chain.setPiece?.cornerFromClearanceChance ?? 0), 0, chain.possessionType ?? "normal");
    if (!cornerRestart) describeTurnover(match, chain, chainIndex, defensiveAction);
  } else describeTurnover(match, chain, chainIndex, defensiveAction);
  applyFatigue(match);
  if (cornerRestart) match.transition = null;
  else if (finalStage?.turnover) {
    const attackingTeamIndex = finalStage.turnover.teamIndex;
    const wonZone = v2TurnoverRestartZone(finalStage.turnover.zone);
    const wonBand = wonZone.split(":")[0];
    const counterDimension = Number(match.teams[attackingTeamIndex]?.tacticalDimensions?.counterAttack ?? 50);
    const commitment = v2AttackingCommitmentProfile(match.teams[attackingTeamIndex]?.tacticalDimensions ?? {}, match.parameters);
    const commitmentConfig = match.parameters.tactics.attackingCommitment ?? {};
    const counterOpportunityMultiplier = 1 - commitment.deepDefensiveSeverity * (1 - Number(commitmentConfig.counterOpportunityMinimumMultiplier ?? 0.62));
    const baseChance = { defensiveThird:0.18, buildUp:0.36, finalThird:0.68, box:0.78 }[wonBand] ?? 0.24;
    const defendingTeam = match.teams[chain.attackingTeamIndex];
    const highPressConfig = match.parameters.tactics.styleIdentity?.highPress ?? {};
    const defendingHighPress = (defendingTeam.splitTacticsExplicit ? defendingTeam.defensiveBlock : defendingTeam.style) === "highPress";
    const pressingSeverity = clamp((Number(defendingTeam.tacticalDimensions?.pressing ?? 50) - Number(highPressConfig.riskPressingThreshold ?? 68)) / Math.max(1, 100 - Number(highPressConfig.riskPressingThreshold ?? 68)), 0, 1);
    const lineSeverity = clamp((Number(defendingTeam.tacticalDimensions?.defensiveLine ?? 50) - Number(highPressConfig.riskDefensiveLineThreshold ?? 62)) / Math.max(1, 100 - Number(highPressConfig.riskDefensiveLineThreshold ?? 62)), 0, 1);
    const highPressCounterBonus = defendingHighPress
      ? (pressingSeverity * 0.65 + lineSeverity * 0.35) * Number(highPressConfig.counterOpportunityMaximum ?? 0.18)
      : 0;
    const counterOpportunityChance = clamp((baseChance + (counterDimension - 50) * 0.004 + highPressCounterBonus) * counterOpportunityMultiplier, 0.08, 0.86);
    match.transition = {
      attackingTeamIndex,
      wonZone,
      previousDefendingTeamIndex:chain.attackingTeamIndex,
      counterOpportunity:seededEventRoll(match, "counterOpportunity", attackingTeamIndex, chainIndex) < counterOpportunityChance,
      counterOpportunityChance:round(counterOpportunityChance),
      attackingCommitment:commitment.commitment,
      deepDefensiveSeverity:commitment.deepDefensiveSeverity,
      counterOpportunityMultiplier:round(counterOpportunityMultiplier),
      highPressCounterBonus:round(highPressCounterBonus),
    };
  } else match.transition = null;
  match.nextChainIndex = chainIndex + 1;
  match.score = match.teams.map((team) => team.score);
  ensurePlayable(match);
  match.currentReplayShape = null;
  match.currentReplaySequence = null;
  return chain;
}

export function createV2Match(teams, options = {}) {
  if (!Array.isArray(teams) || teams.length !== 2) throw new Error("YDL V2比赛需要两支球队");
  const rng = options.rng ?? createV2MatchRng(options.seed);
  const parameters = options.parameters ?? V2_MATCH_PARAMETERS;
  return {
    engineVersion:parameters.engineVersion,
    modelVersion:"match-engine-v2.1",
    mode:"YDL",
    substitutionsAllowed:Boolean(parameters.state.substitutionsEnabled),
    minute:0,
    score:[0, 0],
    environment:{ weather:options.weather ?? "sunny", referee:options.referee ?? "standard", precipitation:Number(options.precipitation ?? (options.weather === "superStorm" ? 100 : ["rain", "storm"].includes(options.weather) ? 70 : options.weather === "snow" ? 45 : 0)) },
    parameters,
    simulationSeed:String(options.seed ?? "ydl-v2"),
    possessionChainCount:Number(options.possessionChains ?? 180),
    teams:teams.map(cloneTeam),
    events:[],
    commentary:[],
    rng,
    chains:[],
    analysisTimeline:[],
    lastAnalysisSignature:null,
    postMatchConsequences:{ injuries:[], suspensions:[] },
    nextChainIndex:0,
    transition:null,
    started:false,
    forceBlackWhistle:Boolean(options.forceBlackWhistle),
    forceBrawl:Boolean(options.forceBrawl),
    forceOwnGoal:Boolean(options.forceOwnGoal),
    blackWhistleTriggered:false,
    blackWhistleChecked:false,
    blackWhistleChainIndex:null,
    blackWhistleArgentinaCounts:null,
    blackWhistleFavoredIndex:null,
    brawlTriggered:false,
    brawlChecked:false,
    brawlCheckChainIndex:null,
    lightningResolved:false,
    weatherImpactResolved:false,
    ownGoalResolved:false,
    finished:false,
    abandoned:false,
    abandonmentReason:null,
    weatherStopped:false,
    superStormStopMinute:options.weather === "superStorm" && !options.disableSuperStormStop
      ? resolveSuperStormStopMinute(options.seed ?? "ydl-v2", parameters.environment?.superStormStopMinuteRange, options.superStormStopMinute)
      : null,
    dotReplayEnabled:Boolean(options.dotReplayEnabled),
    dotReplayFrames:[],
    currentReplayShape:null,
    currentReplaySequence:null,
    lastReplayShape:null,
    lastDotReplayBall:null,
  };
}

export function simulateV2Match(teams, options = {}) {
  const match = createV2Match(teams, options);
  advanceV2Match(match, match.possessionChainCount, options);
  return match;
}

function syncCommentary(match) {
  match.commentary = match.events.map((entry) => ({ ...entry }));
}

function stopV2MatchForSuperStorm(match) {
  if (match.finished || match.environment.weather !== "superStorm" || !Number.isInteger(match.superStormStopMinute)) return false;
  const regulationChainCount = Number(match.regulationChainCount ?? match.possessionChainCount ?? 180);
  const stopChain = Math.ceil(match.superStormStopMinute / 90 * regulationChainCount);
  if (match.nextChainIndex < stopChain) return false;
  match.minute = match.superStormStopMinute;
  match.abandoned = true;
  match.abandonmentReason = "superStorm";
  match.weatherStopped = true;
  addEvent(match, "abandoned", null, `超级雷暴持续增强，现场已不具备安全比赛条件。裁判在第${match.superStormStopMinute}分钟强制终止比赛，并按当前比分${match.score[0]}:${match.score[1]}结算。`, {
    importance:"major", cause:"superStorm", score:[...match.score], stoppedAtMinute:match.superStormStopMinute,
  });
  return true;
}

export function finishV2Match(match, options = {}) {
  if (match.finalized) return;
  match.finalized = true;
  if (!match.abandoned) match.minute = Number(options.minute ?? match.scheduledDurationMinutes ?? 90);
  match.score = match.teams.map((team) => team.score);
  match.finished = true;
  addEvent(match, "fulltime", null, match.abandoned ? `比赛终止，最终比分${match.score[0]}:${match.score[1]}。` : `全场结束，比分${match.score[0]}:${match.score[1]}。`, {
    score:[...match.score],
    abandoned:match.abandoned,
    importance:"stage",
  });
  syncCommentary(match);
  delete match.snapshotTeams;
  delete match.currentReplayShape;
  delete match.currentReplaySequence;
}

export function advanceV2Match(match, targetChainCount = match.nextChainIndex + 1, options = {}) {
  if (!match || match.finished) return match;
  const chainCount = Number(match.possessionChainCount ?? 180);
  const target = Math.min(chainCount, Math.max(0, Number(targetChainCount)));
  if (!match.started) {
    match.started = true;
    addEvent(match, "kickoff", null, "比赛开始，YDL V2引擎正式开球。", { importance:"stage" });
  }
  while (match.nextChainIndex < target && !match.abandoned) {
    if (stopV2MatchForSuperStorm(match)) break;
    runV2Chain(match, match.nextChainIndex, options);
  }
  stopV2MatchForSuperStorm(match);
  syncCommentary(match);
  if (match.nextChainIndex >= chainCount || match.abandoned) finishV2Match(match);
  return match;
}

export function publicV2Match(match, options = {}) {
  const eventLimit = Number(options.eventLimit ?? match.events.length);
  return {
    engineVersion:match.engineVersion,
    modelVersion:match.modelVersion,
    mode:match.mode,
    substitutionsAllowed:Boolean(match.parameters?.state?.substitutionsEnabled),
    minute:match.minute,
    score:[...match.score],
    finished:match.finished,
    abandoned:match.abandoned,
    environment:{ ...match.environment },
    teams:match.teams.map((team) => ({
      name:team.name,
      score:team.score,
      tactic:team.tactic,
      style:team.style,
      possessionStyle:team.possessionStyle,
      defensiveBlock:team.defensiveBlock,
      transitionStyle:team.transitionStyle,
      duelIntensity:team.duelIntensity,
      activePlan:team.activePlan,
      stats:{ ...team.stats },
      players:team.players.map((player) => ({ id:player.id, name:player.name, role:player.role, assignedRole:player.assignedRole ?? player.role, tacticalDuty:player.tacticalDuty ?? null, active:player.active, sentOff:player.sentOff, injury:player.injury, fitness:player.state.fitness, matchStats:{ ...player.matchStats } })),
    })),
    events:match.events.slice(-eventLimit).map((event) => ({ ...event })),
    commentary:match.commentary.slice(-eventLimit).map((entry) => ({ ...entry })),
    postMatchConsequences:structuredClone(match.postMatchConsequences),
  };
}
