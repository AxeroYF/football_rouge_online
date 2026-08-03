import { positionFitScore, roleGroup } from "../../game/public/schema.js";
import { analyzeElevenBoardFormation, inferElevenBoardRoles } from "../public/formation-rules.js";
import { calculateV2StructureFit, calculateV2TacticalFit } from "../public/v2-tactical-fit.js";
import { DEFAULT_IN_POSSESSION_DETAILS, DEFAULT_OUT_OF_POSSESSION_DETAILS, v2TacticalDetailAdjustments, v2TacticalProfileAdjustments } from "../public/v2-tactical-profiles.js";
import { YDL_TRAIT_BY_ID } from "../trait-pool.js";
import { simulateV2PossessionChain } from "./possession-chain-v2.js";
import { V2_MATCH_PARAMETERS } from "./match-parameters-v2.js";
import { resolveV2TacticalDimensions } from "./spatial-model-v2.js";
import { buildV2TeamSnapshots } from "./team-snapshot-v2.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const SHOT_TYPE_LABELS = Object.freeze({
  throughBall:"直塞配合",
  cross:"传中",
  cutback:"倒三角回敲",
  counter:"快速反击",
  longShot:"远射",
  setPiece:"定位球",
  rebound:"补射",
  penalty:"点球",
});
const PLAN_LABELS = Object.freeze({ opening:"开场", leading:"领先", trailing:"落后" });
function tacticalDimensionsForPlan(plan = {}) {
  const adjustments = v2TacticalProfileAdjustments(plan.inPossession, plan.outOfPossession);
  Object.entries(v2TacticalDetailAdjustments(plan.inPossessionDetails, plan.outOfPossessionDetails)).forEach(([key, value]) => { adjustments[key] = Number(adjustments[key] ?? 0) + Number(value); });
  const custom = structuredClone(plan.tacticalDimensions ?? {});
  if (!Object.keys(adjustments).length) return custom;
  const resolved = resolveV2TacticalDimensions(plan.tactic, plan.style, custom);
  Object.entries(adjustments).forEach(([key, value]) => { custom[key] = round(clamp(Number(resolved[key] ?? 50) + Number(value), 0, 100), 2); });
  return custom;
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
  const opening = team.tacticalPlans?.opening ?? { tactic:team.tactic ?? "balanced", style:team.style ?? "possession", positionPreset:"position1" };
  const positions = structuredClone(team.positionPresets?.[opening.positionPreset] ?? team.positions ?? {});
  const formationLines = structuredClone(team.formationLinePresets?.[opening.positionPreset] ?? team.formationLines ?? null);
  const assignedRoles = inferElevenBoardRoles((team.players ?? []).map((player) => ({ id:player.id, position:positions[player.id] })), formationLines);
  return {
    ...structuredClone(team),
    index,
    tactic:opening.tactic,
    style:opening.style,
    inPossession:opening.inPossession ?? "balanced",
    outOfPossession:opening.outOfPossession ?? "balanced",
    inPossessionDetails:structuredClone(opening.inPossessionDetails ?? DEFAULT_IN_POSSESSION_DETAILS),
    outOfPossessionDetails:structuredClone(opening.outOfPossessionDetails ?? DEFAULT_OUT_OF_POSSESSION_DETAILS),
    tacticalDimensions:tacticalDimensionsForPlan({ ...opening, tacticalDimensions:opening.tacticalDimensions ?? team.tacticalDimensions ?? {} }),
    openingPlan:structuredClone(opening),
    positions,
    formationLines,
    activePlan:"opening",
    score:0,
    stats:{ possessions:0, possessionControl:0, shots:0, shotsOnTarget:0, goals:0, xg:0, saves:0, corners:0, fouls:0, yellowCards:0, redCards:0, injuries:0, setPieces:0, penalties:0 },
    players:(team.players ?? []).map((player) => ({
      ...structuredClone(player),
      assignedRole:assignedRoles[player.id] ?? player.assignedRole ?? player.role,
      boardPosition:structuredClone(positions[player.id] ?? player.boardPosition ?? null),
      active:player.active !== false,
      sentOff:false,
      injury:null,
      state:{ ...structuredClone(player.state ?? {}), fitness:Number(player.state?.fitness ?? player.fitness ?? 100) },
      matchStats:{ shots:0, shotsOnTarget:0, goals:0, assists:0, tackles:0, saves:0, yellowCards:0, redCards:0, fouls:0 },
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

function metric(player, weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + Number(player?.attributes?.[key] ?? 50) * weight, 0) / total;
}

function snapshotPlayer(match, teamIndex, playerId) {
  return match.snapshotTeams?.[teamIndex]?.players?.find((player) => player.id === playerId) ?? null;
}

function effectiveMetric(match, teamIndex, player, weights) {
  return metric(snapshotPlayer(match, teamIndex, player.id) ?? player, weights);
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

function addEvent(match, type, teamIndex, text, details = {}) {
  const event = { id:`v2-${match.events.length + 1}`, minute:Math.max(1, Math.ceil(match.minute)), type, teamIndex, text, importance:["goal", "red", "injury", "fulltime"].includes(type) ? "major" : "normal", ...details };
  match.events.push(event);
  return event;
}

function scoreState(match, teamIndex) {
  return match.teams[teamIndex].score > match.teams[1 - teamIndex].score ? "leading" : match.teams[teamIndex].score < match.teams[1 - teamIndex].score ? "trailing" : "level";
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
  const state = scoreState(match, team.index);
  const planName = state === "level" ? "opening" : state;
  const plan = chooseTacticalPlan(team, planName);
  if (team.activePlan === planName && team.tactic === plan.tactic && team.style === plan.style) return;
  team.activePlan = planName;
  team.tactic = plan.tactic ?? team.tactic;
  team.style = plan.style ?? team.style;
  team.inPossession = plan.inPossession ?? "balanced";
  team.outOfPossession = plan.outOfPossession ?? "balanced";
  team.inPossessionDetails = structuredClone(plan.inPossessionDetails ?? DEFAULT_IN_POSSESSION_DETAILS);
  team.outOfPossessionDetails = structuredClone(plan.outOfPossessionDetails ?? DEFAULT_OUT_OF_POSSESSION_DETAILS);
  team.tacticalDimensions = tacticalDimensionsForPlan(plan);
  const preset = plan.positionPreset ?? "position1";
  team.positions = structuredClone(team.positionPresets?.[preset] ?? team.positions);
  team.formationLines = structuredClone(team.formationLinePresets?.[preset] ?? team.formationLines ?? null);
  const assignedRoles = inferElevenBoardRoles(team.players.map((player) => ({ id:player.id, position:team.positions[player.id] })), team.formationLines);
  team.players.forEach((player) => {
    if (!team.positions[player.id]) return;
    player.boardPosition = structuredClone(team.positions[player.id]);
    if (player.active) player.assignedRole = assignedRoles[player.id] ?? player.assignedRole ?? player.role;
  });
  addEvent(match, "tactical", team.index, `${team.name}根据实时比分切换为${PLAN_LABELS[planName] ?? "当前"}战术计划。`, { plan:planName, tactic:team.tactic, style:team.style, positionPreset:preset });
}

function captureAnalysisSnapshot(match) {
  const signature = JSON.stringify(match.teams.map((team) => ({
    plan:team.activePlan,
    tactic:team.tactic,
    style:team.style,
    inPossession:team.inPossession,
    outOfPossession:team.outOfPossession,
    inPossessionDetails:team.inPossessionDetails,
    outOfPossessionDetails:team.outOfPossessionDetails,
    tacticalDimensions:team.tacticalDimensions,
    positions:team.positions,
    active:team.players.map((player) => [player.id, player.active, player.sentOff, Boolean(player.injury)]),
  })));
  if (match.lastAnalysisSignature === signature) return;
  match.lastAnalysisSignature = signature;
  match.analysisTimeline.push({
    minute:Math.max(0, Math.min(90, Math.ceil(Number(match.minute) || 0))),
    score:match.teams.map((team) => team.score),
    teams:match.teams.map((team) => {
      const players = team.players.map((player) => ({
        id:player.id,
        active:player.active,
        sentOff:player.sentOff,
        injury:structuredClone(player.injury),
        fitness:round(player.state?.fitness ?? 100, 1),
        assignedRole:player.assignedRole ?? player.role,
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
        structureIndex:round(calculateV2StructureFit(currentPlayers, roles, team.positions, team.formationLines, dimensions) / 100, 4),
        positionFit:round(positionFit, 4),
        tacticalFit:round(calculateV2TacticalFit(currentPlayers, roles, team.positions, team.formationLines, plan, dimensions) / 100, 4),
        averageOverall:round(averageOverall, 2),
        averageFitness:round(averageFitness, 2),
      };
    }),
  });
}

function removePlayer(match, team, player, reason, details = {}) {
  if (!player?.active) return false;
  if (reason === "injury" && injuryImmune(player)) {
    addEvent(match, "trait", team.index, `${player.name}依靠“赖着不死”避免了伤退。`, { actorId:player.id, traitName:"赖着不死" });
    return false;
  }
  player.active = false;
  player.sentOff = reason === "red";
  player.injury = reason === "injury" ? { severity:details.severity ?? "matchEnding", injuryRounds:Number(details.injuryRounds ?? 1) } : null;
  if (reason === "red") {
    player.matchStats.redCards += 1;
    team.stats.redCards += 1;
    match.postMatchConsequences.suspensions.push({ teamIndex:team.index, playerId:player.id, matches:1, reason:"redCard" });
    addEvent(match, "red", team.index, `${player.name}被红牌罚下，${team.name}只能以${activePlayers(team).length}人继续比赛。`, {
      actorId:player.id,
      detail:`被罚球员：${player.name}；剩余人数：${activePlayers(team).length}；赛后后果：自动停赛1场。YDL比赛不可换人。`,
    });
  } else {
    team.stats.injuries += 1;
    match.postMatchConsequences.injuries.push({ teamIndex:team.index, playerId:player.id, matches:Number(player.injury.injuryRounds), reason:details.cause ?? "match" });
    addEvent(match, "injury", team.index, `${player.name}受伤离场且不可换人，${team.name}只能以${activePlayers(team).length}人继续比赛。`, {
      actorId:player.id,
      injuryRounds:player.injury.injuryRounds,
      cause:details.cause ?? "match",
      detail:`伤退球员：${player.name}；预计缺席：${player.injury.injuryRounds}轮；剩余人数：${activePlayers(team).length}。YDL比赛不可换人。`,
    });
  }
  return true;
}

function applyFatigue(match) {
  for (const team of match.teams) {
    for (const player of activePlayers(team)) {
      const fixed = traitHook(player, "fixedFitness");
      if (fixed) player.state.fitness = Number(fixed.value);
      else {
        const stamina = Number(player.attributes?.stamina ?? 70);
        const dimensions = resolveV2TacticalDimensions(team.tactic, team.style, team.tacticalDimensions, match.parameters);
        const pressing = 1 + dimensions.pressing / 100 * Number(match.parameters.state.pressingFatigueMaximum ?? 0);
        const loss = Number(match.parameters.state.fatiguePerChain ?? 0.085) * pressing * (1.2 - stamina / 300);
        player.state.fitness = round(clamp(player.state.fitness - loss, 18, 100), 1);
      }
    }
  }
}

function shotTypeFrom(chain, team) {
  const route = chain.stages.find((stage) => stage.connection?.routeType)?.connection?.routeType;
  const crossing = team.inPossessionDetails?.crossing ?? "balanced";
  const lane = chain.endZone?.split(":")[1];
  if (route === "counter") return "counter";
  if (crossing === "increase" && lane && lane !== "center") return "cross";
  if (route === "direct") return team.style === "wingPlay" && crossing !== "reduce" ? "cross" : "throughBall";
  if (team.style === "wingPlay" && crossing !== "reduce") return "cross";
  return lane && lane !== "center" ? "cutback" : "throughBall";
}

function longShotProfile(match, teamIndex, team, candidate, chain, requestedType, explicitType) {
  if (explicitType || !candidate || !["throughBall", "cutback"].includes(requestedType)) return null;
  const lane = chain.endZone?.split(":")[1] ?? "center";
  if (["farLeft", "farRight"].includes(lane)) return null;
  const config = match.parameters.chain.longShot;
  const skill = effectiveMetric(match, teamIndex, candidate, { longShots:0.55, composure:0.2, decisions:0.15, firstTouch:0.1 });
  const defending = match.teams[1 - teamIndex];
  const lowBlock = defending.style === "lowBlock" || ["defensive", "parkBus"].includes(defending.tactic);
  const attackingMentality = ["positive", "allOutAttack"].includes(team.tactic);
  const longShotInstruction = team.inPossessionDetails?.longShots ?? "balanced";
  const chanceInstruction = team.inPossessionDetails?.chanceCreation ?? "balanced";
  const instructionAdjustment = (longShotInstruction === "increase" ? 0.09 : longShotInstruction === "reduce" ? -0.07 : 0)
    + (chanceInstruction === "shootOnSight" ? 0.05 : chanceInstruction === "patient" ? -0.03 : 0);
  const decisionChance = clamp(
    Number(config.baseDecisionChance) + (skill - 70) * Number(config.skillDecisionWeight)
      + (team.style === "longBall" ? Number(config.longBallBonus) : 0)
      + (lowBlock ? Number(config.lowBlockBonus) : 0)
      + (attackingMentality ? Number(config.attackingMentalityBonus) : 0)
      + instructionAdjustment,
    Number(config.minimumDecisionChance),
    Number(config.maximumDecisionChance),
  );
  if (seededEventRoll(match, "longShot", teamIndex, chain.context?.chainIndex ?? match.nextChainIndex, candidate.id) >= decisionChance) return null;
  const space = Number(chain.stages.at(-1)?.factors?.space ?? 0.5);
  const baseXg = clamp(
    Number(config.baseXg) + (skill - 70) * Number(config.skillXgWeight) + (space - 0.5) * Number(config.spaceXgWeight),
    Number(config.minimumXg),
    Number(config.maximumXg),
  );
  return { candidate, zone:`finalThird:${lane}`, baseXg, decisionChance, skill };
}

function goalkeeper(team) {
  return activePlayers(team).find((player) => roleGroup(player.assignedRole ?? player.role) === "GK") ?? activePlayers(team)[0] ?? null;
}

export function calibrateV2ShotXg(value, type = "throughBall", scale = 1) {
  const xg = clamp((Number(value) || 0) * Number(scale ?? 1), 0, type === "penalty" ? 0.82 : 0.58);
  if (type === "penalty" || xg >= 0.08) return round(xg);
  const lowQualityFactor = 0.2 + 0.8 * Math.pow(xg / 0.08, 1.5);
  return round(xg * lowQualityFactor);
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

function shotCreator(match, attacking, chain, shooter, type, suppliedCreator = null) {
  if (["penalty", "rebound", "setPiece"].includes(type)) return null;
  if (suppliedCreator?.active && suppliedCreator.id !== shooter.id) return suppliedCreator;
  const chainCreator = [...chainActors(chain)].reverse()
    .map((actor) => attacking.players.find((player) => player.id === actor.id))
    .find((player) => player?.active && player.id !== shooter.id);
  if (chainCreator) return chainCreator;
  const fallbackChance = type === "counter" ? 0.68 : 0.8;
  if (match.rng() >= fallbackChance) return null;
  const candidates = activePlayers(attacking).filter((player) => player.id !== shooter.id && roleGroup(player.assignedRole ?? player.role) !== "GK");
  return pick(match, candidates, (player) => effectiveMetric(match, attacking.index, player, { passing:0.4, vision:0.3, technique:0.18, crossing:0.12 }));
}

function describeShotBuildUp(match, teamIndex, chain, shooter, creator, type) {
  if ((chain.stages ?? []).length <= 1) return;
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

function describeTurnover(match, chain, chainIndex) {
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
  addEvent(match, routeType === "counter" ? "counter" : "duel", chain.attackingTeamIndex, `${cooperation}，${defender.name}及时预判传球线路并完成拦截。`, {
    actorId:actor.id,
    opponentId:defender.id,
    participantId:partner?.id ?? null,
  });
}

function resolveShot(match, teamIndex, chain, options = {}) {
  const attacking = match.teams[teamIndex];
  const defending = match.teams[1 - teamIndex];
  const shotStage = chain.stages.at(-1);
  let type = options.type ?? shotTypeFrom(chain, attacking);
  const candidates = activePlayers(attacking).filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK");
  let shooter = options.taker ?? candidates.find((player) => player.id === shotStage.actor?.id) ?? pick(match, candidates, (player) => effectiveMetric(match, teamIndex, player, { finishing:0.45, offBall:0.3, composure:0.25 }));
  const longShotCandidate = options.type ? null : [...candidates].sort((left, right) => effectiveMetric(match, teamIndex, right, { longShots:0.55, composure:0.2, decisions:0.15, firstTouch:0.1 }) - effectiveMetric(match, teamIndex, left, { longShots:0.55, composure:0.2, decisions:0.15, firstTouch:0.1 }) || String(left.id).localeCompare(String(right.id)))[0] ?? null;
  const longShot = longShotProfile(match, teamIndex, attacking, longShotCandidate, chain, type, options.type);
  if (longShot) {
    type = "longShot";
    shooter = longShot.candidate;
  }
  const shotZone = longShot?.zone ?? chain.endZone ?? shotStage?.zone ?? "box:center";
  const keeper = goalkeeper(defending);
  if (!shooter) return { outcome:"abandoned", xg:0 };
  const creator = type === "setPiece"
    ? (options.creator?.active && options.creator.id !== shooter.id ? options.creator : null)
    : shotCreator(match, attacking, chain, shooter, type, options.creator);
  const typeLabel = SHOT_TYPE_LABELS[type] ?? "进攻配合";
  describeShotBuildUp(match, teamIndex, chain, shooter, creator, type);
  const finishing = ["cross", "setPiece"].includes(type) ? effectiveMetric(match, teamIndex, shooter, { heading:0.42, jumping:0.2, composure:0.2, finishing:0.18 }) : type === "longShot" ? effectiveMetric(match, teamIndex, shooter, { longShots:0.5, composure:0.3, finishing:0.2 }) : effectiveMetric(match, teamIndex, shooter, { finishing:0.5, composure:0.3, offBall:0.2 });
  const keeperValue = keeper ? effectiveMetric(match, 1 - teamIndex, keeper, { goalkeeping:0.52, reflexes:0.32, positioning:0.16 }) : 18;
  const baseXg = options.xg ?? longShot?.baseXg ?? shotStage.probability;
  const rawXg = clamp(baseXg * (0.78 + finishing / 360) * (1.16 - keeperValue / 520), 0.015, type === "penalty" ? 0.82 : 0.58);
  const openPlayScale = options.xg == null ? Number(match.parameters.chain.openPlayXgScale ?? 1) : 1;
  const scoreStateXgMultiplier = scoreStateShotXgMultiplier(match, teamIndex, type);
  const xg = round(calibrateV2ShotXg(rawXg, type, openPlayScale) * scoreStateXgMultiplier);
  const onTargetProbability = clamp(0.3 + finishing / 230, xg, 0.72);
  const roll = match.rng();
  attacking.stats.shots += 1;
  attacking.stats.xg = round(attacking.stats.xg + xg);
  shooter.matchStats.shots += 1;
  const goalProbability = type === "penalty" ? clamp(0.72 + (finishing - keeperValue) / 260, 0.5, 0.9) : xg;
  const goal = roll < goalProbability;
  const onTarget = goal || roll < onTargetProbability;
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
    addEvent(match, "goal", teamIndex, `${shooter.name}破门！${assistText}，${typeLabel}，xG ${xg.toFixed(2)}，比分${match.teams[0].score}:${match.teams[1].score}。`, {
      actorId:shooter.id,
      assistId:creator?.id ?? null,
      opponentId:keeper?.id ?? null,
      attackType:type,
      xg,
      scoreStateXgMultiplier,
      zone:shotZone,
      attackingTeamIndex:teamIndex,
      score:match.teams.map((team) => team.score),
      detail:`射手：${shooter.name}；${assistText}；进攻方式：${typeLabel}；机会质量：xG ${xg.toFixed(3)}；终结能力：${Math.round(finishing)}；${keeper ? `门将：${keeper.name}（扑救能力 ${Math.round(keeperValue)}）` : "对方没有有效门将"}。`,
    });
    return { outcome:"goal", xg, shooterId:shooter.id };
  }
  if (!onTarget) {
    addEvent(match, "miss", teamIndex, `${shooter.name}接应${typeLabel}后的攻门偏出。`, { actorId:shooter.id, attackType:type, xg, scoreStateXgMultiplier, zone:shotZone, attackingTeamIndex:teamIndex });
    return { outcome:"miss", xg, shooterId:shooter.id };
  }
  if (keeper) {
    defending.stats.saves += 1;
    keeper.matchStats.saves += 1;
  }
  const looseBall = type !== "penalty" && match.rng() < clamp(0.18 + xg * 0.25 - keeperValue / 1000, 0.05, 0.22);
  addEvent(match, "save", 1 - teamIndex, `${keeper?.name ?? "防守球员"}判断准确，扑出${shooter.name}接应${typeLabel}后的射门${looseBall ? "，皮球形成补射机会" : "并控制住皮球"}。`, { actorId:keeper?.id ?? null, opponentId:shooter.id, attackType:type, xg, scoreStateXgMultiplier, looseBall, zone:shotZone, attackingTeamIndex:teamIndex });
  if (looseBall) {
    const rebounder = pick(match, candidates.filter((player) => player.id !== shooter.id), (player) => effectiveMetric(match, teamIndex, player, { offBall:0.5, finishing:0.3, acceleration:0.2 }));
    if (rebounder && match.rng() < 0.48) return resolveShot(match, teamIndex, chain, { type:"rebound", taker:rebounder, xg:clamp(xg * 0.52, 0.06, 0.28) });
  }
  if (type !== "penalty" && Number(options.setPieceDepth ?? 0) < 2 && match.rng() < 0.22) {
    attacking.stats.corners += 1;
    addEvent(match, "corner", teamIndex, `${attacking.name}获得角球。`, { attackType:type });
    return resolveSetPiece(match, teamIndex, "corner", Number(options.setPieceDepth ?? 0) + 1);
  }
  return { outcome:"save", xg, shooterId:shooter.id };
}

export function v2SetPieceTargetPool(candidates, taker) {
  const receivers = candidates.filter((player) => player.id !== taker?.id);
  const attackingReceivers = receivers.filter((player) => roleGroup(player.assignedRole ?? player.role) === "ATT");
  return attackingReceivers.length ? attackingReceivers : receivers;
}

function resolveSetPiece(match, teamIndex, kind, setPieceDepth = 0) {
  const attacking = match.teams[teamIndex];
  const candidates = activePlayers(attacking).filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK");
  const taker = pick(match, candidates, (player) => effectiveMetric(match, teamIndex, player, { setPieces:0.55, composure:0.25, finishing:0.2 }));
  attacking.stats.setPieces += 1;
  if (kind === "penalty") {
    attacking.stats.penalties += 1;
    const keeper = goalkeeper(match.teams[1 - teamIndex]);
    const guaranteed = keeper && traitHook(keeper, "firstPenaltySave")?.guaranteed && !keeper.v2FirstPenaltySaveUsed;
    if (guaranteed) {
      keeper.v2FirstPenaltySaveUsed = true;
      attacking.stats.shots += 1;
      attacking.stats.shotsOnTarget += 1;
      attacking.stats.xg = round(attacking.stats.xg + 0.76);
      match.teams[1 - teamIndex].stats.saves += 1;
      keeper.matchStats.saves += 1;
      addEvent(match, "save", 1 - teamIndex, `${keeper.name}触发“一夫当关”，扑出本场面对的第一粒点球。`, { actorId:keeper.id, opponentId:taker?.id ?? null, attackType:"penalty", xg:0.76, traitName:"一夫当关", zone:"box:center", attackingTeamIndex:teamIndex });
      return { outcome:"save", xg:0.76 };
    }
    return resolveShot(match, teamIndex, { stages:[{ actor:taker ? { id:taker.id } : null, probability:0.76 }] }, { type:"penalty", taker, xg:0.76 });
  }
  if (!taker) return { outcome:"noTaker", xg:0 };
  const defenders = activePlayers(match.teams[1 - teamIndex]).filter((player) => roleGroup(player.assignedRole ?? player.role) !== "GK");
  const targets = v2SetPieceTargetPool(candidates, taker);
  const target = pick(match, targets, (player) => effectiveMetric(match, teamIndex, player, { heading:0.42, jumping:0.22, strength:0.18, offBall:0.18 }));
  const marker = pick(match, defenders, (player) => effectiveMetric(match, 1 - teamIndex, player, { marking:0.35, positioning:0.3, heading:0.2, jumping:0.15 }));
  const delivery = effectiveMetric(match, teamIndex, taker, { setPieces:0.45, crossing:0.3, passing:0.25 });
  const targetAerial = target ? effectiveMetric(match, teamIndex, target, { heading:0.42, jumping:0.24, strength:0.2, offBall:0.14 }) + (Number(snapshotPlayer(match, teamIndex, target.id)?.heightCm ?? target.heightCm ?? 180) - 180) * 0.4 : 40;
  const markerAerial = marker ? effectiveMetric(match, 1 - teamIndex, marker, { heading:0.38, jumping:0.26, strength:0.2, marking:0.16 }) + (Number(snapshotPlayer(match, 1 - teamIndex, marker.id)?.heightCm ?? marker.heightCm ?? 180) - 180) * 0.35 : 35;
  addEvent(match, "setPiece", teamIndex, `${taker.name}为${attacking.name}主罚${kind === "corner" ? "角球" : "前场定位球"}${target ? `，${target.name}向第一落点前插` : ""}。`, { actorId:taker.id, targetId:target?.id ?? null, markerId:marker?.id ?? null, setPieceType:kind });
  const deliveryProbability = clamp(0.55 + (delivery - 68) / 180, 0.28, 0.88);
  if (match.rng() >= deliveryProbability) {
    addEvent(match, "clearance", 1 - teamIndex, `${marker?.name ?? "防守球员"}判断落点，直接解围定位球。`, { actorId:marker?.id ?? null, setPieceType:kind });
    return { outcome:"cleared", xg:0 };
  }
  const duelProbability = clamp(0.52 + (targetAerial - markerAerial) / 170, 0.24, 0.82);
  if (!target || match.rng() >= duelProbability) {
    addEvent(match, "clearance", 1 - teamIndex, `${marker?.name ?? "防守球员"}赢下定位球争顶并完成解围。`, { actorId:marker?.id ?? null, targetId:target?.id ?? null, setPieceType:kind });
    return { outcome:"aerialLost", xg:0 };
  }
  addEvent(match, "setPieceDuel", teamIndex, `${target.name}抢到定位球第一落点，形成头球攻门机会。`, { actorId:target.id, opponentId:marker?.id ?? null, setPieceType:kind });
  const xg = kind === "corner" ? 0.11 : 0.14;
  return resolveShot(match, teamIndex, { endZone:"box:center", stages:[{ actor:{ id:target.id }, probability:xg }] }, { type:"setPiece", taker:target, creator:taker, xg, setPieceDepth });
}

function processDiscipline(match, chain) {
  for (const stage of chain.stages) {
    if (!stage.foul?.occurred) continue;
    const defending = match.teams[chain.defendingTeamIndex];
    const attacking = match.teams[chain.attackingTeamIndex];
    const offender = defending.players.find((player) => player.id === stage.defender?.id);
    defending.stats.fouls += 1;
    if (offender) offender.matchStats.fouls += 1;
    addEvent(match, "foul", defending.index, `${offender?.name ?? defending.name}在阻挡${stage.actor?.name ?? attacking.name}推进时犯规，${attacking.name}获得${stage.foul.penalty ? "点球" : "定位球"}。`, { actorId:offender?.id ?? null, opponentId:stage.actor?.id ?? null });
    if (stage.foul.card === "yellow" && offender) {
      offender.matchStats.yellowCards += 1;
      defending.stats.yellowCards += 1;
      addEvent(match, "yellow", defending.index, `${offender.name}被出示黄牌。`, { actorId:offender.id });
      if (offender.matchStats.yellowCards >= 2) {
        if (traitHook(offender, "redCardImmune")?.immune) {
          addEvent(match, "trait", defending.index, `${offender.name}的红牌免疫生效，第二张黄牌未升级为红牌。`, { actorId:offender.id, traitName:"普拉蒂尼是我爹" });
        } else removePlayer(match, defending, offender, "red");
      }
    }
    if (stage.foul.card === "red" && offender) {
      if (traitHook(offender, "redCardImmune")?.immune) {
        offender.matchStats.yellowCards += 1;
        defending.stats.yellowCards += 1;
        addEvent(match, "trait", defending.index, `${offender.name}的红牌免疫生效，本次判罚降为黄牌。`, { actorId:offender.id, traitName:"普拉蒂尼是我爹" });
      } else removePlayer(match, defending, offender, "red");
    }
    if (stage.foul.simulationYellow && stage.actor?.id) {
      const creator = attacking.players.find((player) => player.id === stage.actor.id);
      if (creator?.active) {
        creator.matchStats.yellowCards += 1;
        attacking.stats.yellowCards += 1;
        addEvent(match, "yellow", attacking.index, `${creator.name}被判定为假摔，出示黄牌。`, { actorId:creator.id, traitId:stage.foul.traitId ?? null });
        if (creator.matchStats.yellowCards >= 2 && !traitHook(creator, "redCardImmune")?.immune) removePlayer(match, attacking, creator, "red");
      }
    }
    resolveSetPiece(match, attacking.index, stage.foul.penalty ? "penalty" : "freeKick");
  }
}

function processInjuries(match, chain) {
  const events = [...chain.independentEvents];
  if (match.rng() < Number(match.parameters.events.injuryPerChain ?? 0)) events.push({ type:"matchInjury", probability:match.parameters.events.injuryPerChain });
  for (const event of events) {
    const candidates = match.teams.flatMap((team) => activePlayers(team).map((player) => ({ team, player })));
    const protectedTeams = new Set(match.teams.filter((team) => activePlayers(team).some((player) => traitHook(player, "teamLightningProtection")?.immune)).map((team) => team.index));
    if (event.type === "lightningInjury" && protectedTeams.size === 2) {
      addEvent(match, "trait", null, "双方都受到“避雷针”保护，雷击伤病未发生。", { traitName:"避雷针" });
      continue;
    }
    const eligible = candidates.filter(({ team, player }) => !injuryImmune(player) && !(event.type === "lightningInjury" && protectedTeams.has(team.index)));
    const victim = pick(match, eligible);
    if (victim) {
      if (event.type === "lightningInjury" && protectedTeams.has(victim.team.index)) {
        addEvent(match, "trait", victim.team.index, `${victim.team.name}受到“避雷针”保护，雷击伤病未发生。`, { traitName:"避雷针" });
      } else removePlayer(match, victim.team, victim.player, "injury", { cause:event.type, injuryRounds:event.type === "lightningInjury" ? 2 : 1 });
    }
  }
  for (const stage of chain.stages) {
    if (!stage.foul?.occurred || !stage.actor?.id) continue;
    const team = match.teams[chain.attackingTeamIndex];
    const player = team.players.find((candidate) => candidate.id === stage.actor.id);
    if (!player?.active || injuryImmune(player)) continue;
    const defender = match.teams[chain.defendingTeamIndex].players.find((candidate) => candidate.id === stage.defender?.id);
    const aggression = Number(defender?.attributes?.aggression ?? 60);
    if (match.rng() < clamp(0.006 + Math.max(0, aggression - 65) / 2400, 0.004, 0.045)) removePlayer(match, team, player, "injury", { cause:"foul", injuryRounds:1 });
  }
}

function maybeBlackWhistle(match) {
  if (match.blackWhistleTriggered || match.blackWhistleChecked) return false;
  match.blackWhistleChecked = true;
  if (!match.forceBlackWhistle && match.rng() >= Number(match.parameters.events.blackWhistlePerMatch ?? 0)) return false;
  const counts = match.teams.map(argentinaCount);
  if (counts[0] === counts[1]) return false;
  const favoredIndex = counts[0] > counts[1] ? 0 : 1;
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
      addEvent(match, "abandoned", team.index, `${team.name}可比赛球员少于7人，比赛终止。`);
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

function runV2Chain(match, chainIndex, options = {}) {
  const chainCount = Number(match.possessionChainCount ?? 180);
  const regulationChainCount = Math.min(chainCount, Number(match.regulationChainCount ?? chainCount));
  const extraTimeChainCount = Math.max(0, chainCount - regulationChainCount);
  match.minute = chainIndex < regulationChainCount || !extraTimeChainCount
    ? round((chainIndex + 0.5) / regulationChainCount * 90, 2)
    : round(90 + (chainIndex - regulationChainCount + 0.5) / extraTimeChainCount * 30, 2);
  match.teams.forEach((team) => applyTacticalPlan(match, team));
  captureAnalysisSnapshot(match);
  if (chainIndex === 0) maybeBlackWhistle(match);
  match.snapshotTeams = buildV2TeamSnapshots(match.teams, {
    parameters:match.parameters,
    state:{ minute:match.minute, score:match.teams.map((team) => team.score) },
    environment:match.environment,
  });
  const chain = simulateV2PossessionChain(match.teams, {
    rng:match.rng,
    chainIndex,
    state:{ minute:match.minute, score:match.teams.map((team) => team.score) },
    environment:match.environment,
    parameters:match.parameters,
    snapshotTeams:match.snapshotTeams,
    transition:match.transition,
    deferShotResolution:true,
    recordRandomRolls:Boolean(options.recordRandomRolls),
  });
  match.chains.push(chain);
  const attacking = match.teams[chain.attackingTeamIndex];
  attacking.stats.possessions += 1;
  const selectedProbability = Number(chain.stages?.[0]?.probability ?? 0.5);
  const homeControl = chain.attackingTeamIndex === 0 ? selectedProbability : 1 - selectedProbability;
  match.teams[0].stats.possessionControl += homeControl;
  match.teams[1].stats.possessionControl += 1 - homeControl;
  processDiscipline(match, chain);
  processInjuries(match, chain);
  const finalStage = chain.stages.at(-1);
  if (finalStage?.turnover?.playerId) {
    const defender = match.teams[chain.defendingTeamIndex].players.find((player) => player.id === finalStage.turnover.playerId);
    if (defender) defender.matchStats.tackles += 1;
  }
  if (finalStage?.stage === "shot" && finalStage.outcome === "shotCreated") resolveShot(match, chain.attackingTeamIndex, chain);
  else if (finalStage?.outcome === "offside") addEvent(match, "offside", chain.defendingTeamIndex, `${match.teams[chain.defendingTeamIndex].name}保持防线同步前压，成功制造越位。`, { attackingTeamIndex:chain.attackingTeamIndex, zone:finalStage.zone });
  else describeTurnover(match, chain, chainIndex);
  applyFatigue(match);
  match.transition = finalStage?.turnover ? {
    attackingTeamIndex:finalStage.turnover.teamIndex,
    wonZone:v2TurnoverRestartZone(finalStage.turnover.zone),
    previousDefendingTeamIndex:chain.attackingTeamIndex,
  } : null;
  match.nextChainIndex = chainIndex + 1;
  match.score = match.teams.map((team) => team.score);
  ensurePlayable(match);
  return chain;
}

export function createV2Match(teams, options = {}) {
  if (!Array.isArray(teams) || teams.length !== 2) throw new Error("YDL V2比赛需要两支球队");
  const rng = options.rng ?? createV2MatchRng(options.seed);
  const parameters = options.parameters ?? V2_MATCH_PARAMETERS;
  return {
    engineVersion:parameters.engineVersion,
    modelVersion:"match-engine-v2-alpha.15",
    mode:"YDL",
    substitutionsAllowed:false,
    minute:0,
    score:[0, 0],
    environment:{ weather:options.weather ?? "sunny", referee:options.referee ?? "standard", precipitation:Number(options.precipitation ?? (["rain", "storm"].includes(options.weather) ? 70 : options.weather === "snow" ? 45 : 0)) },
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
    blackWhistleTriggered:false,
    blackWhistleChecked:false,
    finished:false,
    abandoned:false,
  };
}

export function simulateV2Match(teams, options = {}) {
  const match = createV2Match(teams, options);
  advanceV2Match(match, match.possessionChainCount, options);
  return match;
}

function syncCommentary(match) {
  match.commentary = match.events.map((entry) => ({
    minute:entry.minute,
    type:entry.type,
    text:entry.text,
    importance:entry.importance,
    teamIndex:entry.teamIndex,
  }));
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
}

export function advanceV2Match(match, targetChainCount = match.nextChainIndex + 1, options = {}) {
  if (!match || match.finished) return match;
  const chainCount = Number(match.possessionChainCount ?? 180);
  const target = Math.min(chainCount, Math.max(0, Number(targetChainCount)));
  if (!match.started) {
    match.started = true;
    addEvent(match, "kickoff", null, "比赛开始，YDL V2引擎正式开球。", { importance:"stage" });
  }
  while (match.nextChainIndex < target && !match.abandoned) runV2Chain(match, match.nextChainIndex, options);
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
    substitutionsAllowed:false,
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
      activePlan:team.activePlan,
      stats:{ ...team.stats },
      players:team.players.map((player) => ({ id:player.id, name:player.name, role:player.role, active:player.active, sentOff:player.sentOff, injury:player.injury, fitness:player.state.fitness, matchStats:{ ...player.matchStats } })),
    })),
    events:match.events.slice(-eventLimit).map((event) => ({ ...event })),
    commentary:match.commentary.slice(-eventLimit).map((entry) => ({ ...entry })),
    postMatchConsequences:structuredClone(match.postMatchConsequences),
  };
}
