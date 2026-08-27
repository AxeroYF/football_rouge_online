import { VERSUS_REFEREES } from "../match-engine.js";
import { analyzeElevenBoardFormation } from "../public/formation-rules.js";
import { calculateV2TacticalFit } from "../public/v2-tactical-fit.js";
import { advanceV2Match, createV2Match, finishV2Match, publicV2Match, v2TurnoverRestartZone } from "./match-engine-v2.js";
import { resolveV2TacticalDimensions } from "./spatial-model-v2.js";

const REGULATION_LIVE_DURATION_MS = 120_000;
const EXTRA_TIME_LIVE_DURATION_MS = 40_000;
const REGULATION_CHAIN_COUNT = 180;
const EXTRA_TIME_CHAIN_COUNT = 60;
const EXTRA_TIME_HALF_CHAIN_COUNT = EXTRA_TIME_CHAIN_COUNT / 2;
const PENALTY_SHOOTOUT_EVENT_INTERVAL_MS = 2_000;
const WEATHER = Object.freeze({
  sunny:{ name:"晴朗", precipitation:5, wind:8 },
  rain:{ name:"雨天", precipitation:72, wind:18 },
  storm:{ name:"雷暴", precipitation:88, wind:45 },
  snow:{ name:"雪天", precipitation:58, wind:20 },
});

const publicMinute = (minute) => Math.max(0, Math.min(120, Math.ceil(Number(minute) || 0)));
const publicEvents = (events) => events.map((event) => ({ ...event, minute:publicMinute(event.minute) }));
const publicWeather = (key) => ({ key, ...(WEATHER[key] ?? WEATHER.sunny) });
const publicReferee = (key) => ({ key, ...(VERSUS_REFEREES[key] ?? VERSUS_REFEREES.standard) });
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));

function possessionPercent(match, teamIndex) {
  const secondsTotal = match.teams.reduce((sum, team) => sum + Number(team.stats.possessionSeconds ?? 0), 0);
  const controlTotal = match.teams.reduce((sum, team) => sum + Number(team.stats.possessionControl ?? 0), 0);
  const key = secondsTotal > 0 ? "possessionSeconds" : controlTotal > 0 ? "possessionControl" : "possessions";
  const total = match.teams.reduce((sum, team) => sum + Number(team.stats[key] ?? 0), 0) || 1;
  return Number((Number(match.teams[teamIndex].stats[key] ?? 0) / total * 100).toFixed(1));
}

function buildTacticalReview(match) {
  const lanes = [...(match.parameters?.spatial?.lanes ?? ["farLeft", "leftHalfSpace", "center", "rightHalfSpace", "farRight"])];
  const bands = [...(match.parameters?.spatial?.bands ?? ["defensiveThird", "buildUp", "finalThird", "box"])];
  const zoneIds = bands.flatMap((band) => lanes.map((lane) => `${band}:${lane}`));
  const makeStage = () => ({ attempts:0, successes:0, rate:0 });
  const teams = match.teams.map((team) => ({
    name:team.name,
    zones:Object.fromEntries(zoneIds.map((zone) => [zone, { zone, starts:0, actions:0, successes:0, turnovers:0, recoveries:0, shots:0, xg:0, goals:0 }])),
    stages:{ buildUp:makeStage(), progression:makeStage(), finalThird:makeStage(), chance:makeStage(), shot:makeStage() },
    routes:{ structured:0, counter:0, direct:0 },
  }));
  for (const chain of match.chains ?? []) {
    const review = teams[chain.attackingTeamIndex];
    if (!review) continue;
    if (review.zones[chain.startZone]) review.zones[chain.startZone].starts += 1;
    for (const stage of chain.stages ?? []) {
      if (stage.stage === "possession") continue;
      const stageReview = review.stages[stage.stage];
      if (stageReview) {
        stageReview.attempts += 1;
        if (stage.success || stage.outcome === "shotCreated") stageReview.successes += 1;
      }
      const zoneReview = review.zones[stage.zone];
      if (zoneReview) {
        zoneReview.actions += 1;
        if (stage.success || stage.outcome === "shotCreated") zoneReview.successes += 1;
        if (stage.turnover) zoneReview.turnovers += 1;
      }
      const route = stage.connection?.routeType;
      if (route && Object.hasOwn(review.routes, route)) review.routes[route] += 1;
      if (stage.turnover) {
        const recoveryZone = v2TurnoverRestartZone(stage.turnover.zone);
        const defendingReview = teams[chain.defendingTeamIndex]?.zones?.[recoveryZone];
        if (defendingReview) defendingReview.recoveries += 1;
      }
    }
  }
  for (const event of match.events ?? []) {
    if (!["goal", "miss", "save", "block"].includes(event.type)) continue;
    const teamIndex = Number(event.attackingTeamIndex ?? (event.type === "save" ? 1 - event.teamIndex : event.teamIndex));
    const zoneReview = teams[teamIndex]?.zones?.[event.zone];
    if (!zoneReview) continue;
    zoneReview.shots += 1;
    zoneReview.xg += Number(event.xg ?? 0);
    if (event.type === "goal") zoneReview.goals += 1;
  }
  for (const team of teams) {
    for (const stage of Object.values(team.stages)) stage.rate = stage.attempts ? Number((stage.successes / stage.attempts * 100).toFixed(1)) : 0;
    for (const zone of Object.values(team.zones)) zone.xg = Number(zone.xg.toFixed(3));
    team.zones = Object.values(team.zones);
  }
  return {
    version:2,
    source:"v2-possession-chains",
    chainModelVersion:"possession-chain-v2.1",
    spatialModelVersion:match.parameters?.dynamicShape?.mode === "stable" ? "spatial-v2.1-stable-dynamic.2" : "spatial-v2-alpha.1",
    chainCount:(match.chains ?? []).length,
    grid:{ lanes, bands },
    teams,
  };
}

function reportPlayer(team, player) {
  const stats = { tackles:0, interceptions:0, clearances:0, blocks:0, pressuresWon:0, ...player.matchStats };
  const defensiveContribution = stats.tackles * 0.08 + stats.interceptions * 0.09 + stats.clearances * 0.055 + stats.blocks * 0.12 + stats.pressuresWon * 0.035;
  const rating = Math.max(4, Math.min(10, 6.5 + stats.goals * 0.8 + stats.assists * 0.5 + stats.saves * 0.12 + defensiveContribution - stats.redCards * 1.5));
  return {
    id:player.id, name:player.name, role:player.role, assignedRole:player.assignedRole ?? player.role, tacticalDuty:player.tacticalDuty ?? null,
    secondaryRole:player.secondaryRole, overall:player.overall, position:structuredClone(team.positions[player.id] ?? player.boardPosition ?? null),
    rating:Number(rating.toFixed(1)), heightCm:player.heightCm, nationality:player.nationality, club:player.club,
    grade:player.grade, upgradeLevel:Number(player.upgradeLevel ?? 0), legendary:Boolean(player.legendary ?? player.grade === "S"),
    fitness:Number(player.state.fitness.toFixed(1)), active:player.active, sentOff:player.sentOff, injury:player.injury, stats,
    startedMatch:Boolean(player.startedMatch), enteredAsSubstitute:Boolean(player.enteredAsSubstitute), substitutedOut:Boolean(player.substitutedOut), substitutedForId:player.substitutedForId ?? null,
    traits:player.traitDefinitions?.map(({ id, name, summary }) => ({ id, name, summary })) ?? [],
  };
}

function reportTeam(match, team, teamIndex) {
  const activePlayers = team.players.filter((player) => player.active);
  const roles = Object.fromEntries(activePlayers.map((player) => [player.id, player.assignedRole ?? player.role]));
  const plan = {
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
    playerDuties:team.playerDuties,
  };
  const dimensions = resolveV2TacticalDimensions(team.tactic, team.style, team.tacticalDimensions, match.parameters);
  const tacticalFit = calculateV2TacticalFit(activePlayers, roles, team.positions, team.formationLines, plan, dimensions);
  return {
    name:team.name, importedLineup:Boolean(team.importedLineup), tactic:team.tactic, style:team.style, possessionStyle:team.possessionStyle, defensiveBlock:team.defensiveBlock, transitionStyle:team.transitionStyle, duelIntensity:team.duelIntensity, inPossessionDetails:structuredClone(team.inPossessionDetails ?? null), outOfPossessionDetails:structuredClone(team.outOfPossessionDetails ?? null),
    attackFocus:team.attackFocus ?? "center", defenseFocus:team.defenseFocus ?? "center", styleFit:Number((tacticalFit / 100).toFixed(3)), tacticalFit,
    positionStructure:null, inMatchPositionAdjustment:team.activePlan !== "opening", markingTargetId:null,
    formation:analyzeElevenBoardFormation(activePlayers, team.positions, team.formationLines).name, activeCount:activePlayers.length,
    positions:structuredClone(team.positions),
    playerDuties:structuredClone(team.playerDuties ?? {}),
    formationLines:structuredClone(team.formationLines),
    stats:{ ...team.stats, possession:possessionPercent(match, teamIndex), xg:Number(team.stats.xg.toFixed(2)) },
    players:team.players.filter((player) => player.startedMatch || player.enteredAsSubstitute || player.active || player.injury || player.sentOff).map((player) => reportPlayer(team, player)),
  };
}

function adapterEvent(match, type, minute, teamIndex, text, details = {}) {
  const event = { id:`v2-${match.events.length + 1}`, minute, type, teamIndex, text, importance:details.importance ?? "major", ...details };
  match.events.push(event);
  return event;
}

const shootoutAbility = (player) => Number(player?.attributes?.finishing ?? player?.overall ?? 60) * 0.62
  + Number(player?.attributes?.composure ?? 60) * 0.38;

export function v2PenaltyShootout(match) {
  const scores = [0, 0];
  const active = match.teams.map((team) => team.players.filter((player) => player.active));
  const eligibleCount = Math.min(...active.map((players) => players.length));
  const excluded = active.map((players) => players.length === eligibleCount ? [] : [...players]
    .sort((left, right) => Number(left.role === "GK") - Number(right.role === "GK") || shootoutAbility(left) - shootoutAbility(right))
    .slice(0, players.length - eligibleCount));
  const excludedIds = excluded.map((players) => new Set(players.map((player) => player.id)));
  const takers = active.map((players, teamIndex) => players
    .filter((player) => !excludedIds[teamIndex].has(player.id))
    .sort((left, right) => shootoutAbility(right) - shootoutAbility(left) || left.id.localeCompare(right.id)));
  const keepers = match.teams.map((team) => team.players.find((player) => player.active && player.role === "GK") ?? team.players.find((player) => player.role === "GK"));
  const goalTeamIndex = match.rng() < 0.5 ? 0 : 1;
  const firstTeamIndex = match.rng() < 0.5 ? 0 : 1;
  const attempts = [0, 0];
  const kicks = [];
  adapterEvent(match, "penaltyShootoutStart", 120, firstTeamIndex, `点球大战开始。掷硬币决定在${match.teams[goalTeamIndex].name}一侧球门进行，${match.teams[firstTeamIndex].name}选择先罚。`, {
    importance:"stage", goalTeamIndex, firstTeamIndex, eligiblePlayerIds:takers.map((players) => players.map((player) => player.id)), excludedPlayerIds:excluded.map((players) => players.map((player) => player.id)),
  });
  excluded.forEach((players, teamIndex) => {
    if (!players.length) return;
    adapterEvent(match, "penaltyShootoutEqualise", 120, teamIndex, `${match.teams[teamIndex].name}按规则将人数减至${eligibleCount}人，${players.map((player) => player.name).join("、")}不参加点球大战。`, {
      importance:"stage", eligibleCount, excludedPlayerIds:players.map((player) => player.id),
    });
  });
  const kick = (teamIndex, round, phase) => {
    const kickIndex = attempts[teamIndex];
    const taker = takers[teamIndex][kickIndex % takers[teamIndex].length];
    const keeper = keepers[1 - teamIndex];
    const finishing = shootoutAbility(taker);
    const keeping = Number(keeper?.attributes?.goalkeeping ?? keeper?.overall ?? 55) * 0.58 + Number(keeper?.attributes?.reflexes ?? 55) * 0.42;
    const probability = clamp(0.74 + (finishing - keeping) / 300, 0.58, 0.9);
    const roll = match.rng();
    const scored = roll < probability;
    const saved = !scored && roll < probability + (1 - probability) * 0.72;
    attempts[teamIndex] += 1;
    if (scored) scores[teamIndex] += 1;
    const outcome = scored ? "命中" : saved ? `被${keeper?.name ?? "门将"}扑出` : "射偏";
    const entry = { teamIndex, round, phase, kickNumber:kickIndex + 1, takerId:taker.id, takerName:taker.name, goalkeeperId:keeper?.id ?? null, goalkeeperName:keeper?.name ?? null, scored, saved, probability:Number(probability.toFixed(3)), score:[...scores] };
    kicks.push(entry);
    adapterEvent(match, "penaltyShootoutKick", 120, teamIndex, `${phase === "suddenDeath" ? `突然死亡第${round}轮` : `点球大战第${round}轮`}，${taker.name}主罚${outcome}，比分${scores[0]}:${scores[1]}。`, { actorId:taker.id, opponentId:keeper?.id ?? null, ...entry });
  };
  let decided = false;
  for (let round = 1; round <= 5 && !decided; round += 1) {
    for (const teamIndex of [firstTeamIndex, 1 - firstTeamIndex]) {
      kick(teamIndex, round, "initial");
      if (scores[0] > scores[1] + (5 - attempts[1]) || scores[1] > scores[0] + (5 - attempts[0])) {
        decided = true;
        break;
      }
    }
  }
  let suddenDeathRound = 1;
  while (!decided && scores[0] === scores[1]) {
    if (suddenDeathRound > 100) throw new Error("V2点球大战超过100轮，随机源可能无效");
    kick(firstTeamIndex, suddenDeathRound, "suddenDeath");
    kick(1 - firstTeamIndex, suddenDeathRound, "suddenDeath");
    if (scores[0] !== scores[1]) decided = true;
    suddenDeathRound += 1;
  }
  const winnerIndex = scores[0] > scores[1] ? 0 : 1;
  adapterEvent(match, "penalties", 120, winnerIndex, `点球大战结束，${match.teams[winnerIndex].name}以${scores[0]}:${scores[1]}胜出。`, { importance:"stage", penalties:[...scores], winnerIndex });
  return { scores, winnerIndex, firstTeamIndex, goalTeamIndex, eligiblePlayerIds:takers.map((players) => players.map((player) => player.id)), excludedPlayerIds:excluded.map((players) => players.map((player) => player.id)), kicks };
}

function finishReport(match) {
  const aggregateBaseScore = Array.isArray(match.aggregateBaseScore) ? match.aggregateBaseScore.map(Number) : null;
  const aggregateScore = aggregateBaseScore ? match.score.map((score, index) => Number(score) + Number(aggregateBaseScore[index] ?? 0)) : null;
  const decisionScore = aggregateScore ?? match.score;
  let winnerIndex = decisionScore[0] === decisionScore[1] ? null : decisionScore[0] > decisionScore[1] ? 0 : 1;
  const shootout = match.penaltyShootout ?? (winnerIndex == null && !match.regulationOnly && !match.abandoned ? v2PenaltyShootout(match) : null);
  const penalties = shootout?.scores ?? null;
  if (shootout) winnerIndex = shootout.winnerIndex;
  match.winnerIndex = winnerIndex;
  match.aggregateScore = aggregateScore;
  match.penalties = penalties;
  match.report = {
    engineVersion:match.engineVersion, modelVersion:match.modelVersion, engineProfile:match.engineProfile,
    dynamicShapeMode:match.parameters?.dynamicShape?.mode ?? "off",
    dynamicShapeModelVersion:match.parameters?.dynamicShape?.modelVersion ?? null,
    dynamicShapeInfluence:Number(match.parameters?.dynamicShape?.stableInfluence ?? 0),
    dynamicShapePhaseTwo:Boolean(match.parameters?.dynamicShape?.phaseTwo?.enabled),
    score:[...match.score],
    halfTimeScore:match.halfTimeScore ? [...match.halfTimeScore] : [0, 0],
    aggregateBaseScore:aggregateBaseScore ? [...aggregateBaseScore] : null, aggregateScore:aggregateScore ? [...aggregateScore] : null, competitionMode:match.competitionMode, legNumber:match.legNumber,
    regulationScore:match.regulationScore ? [...match.regulationScore] : [...match.score], extraTimeScore:match.extraTimeScore ? [...match.extraTimeScore] : null,
    extraTimePlayed:Boolean(match.extraTimeStarted), penalties:penalties ? [...penalties] : null, penaltyShootout:shootout ? structuredClone(shootout) : null, winnerIndex, weather:publicWeather(match.environment.weather), referee:publicReferee(match.environment.referee),
    blackWhistle:match.blackWhistleTriggered, teams:match.teams.map((team, index) => reportTeam(match, team, index)),
    importantEvents:publicEvents(match.events.filter((event) => event.importance !== "normal")),
    events:publicEvents(match.events), analysisTimeline:structuredClone(match.analysisTimeline ?? []),
    tacticalReview:buildTacticalReview(match),
    dotReplay:match.dotReplayEnabled ? {
      version:9,
      engineProfile:match.engineProfile,
      modelVersion:match.parameters?.dynamicShape?.modelVersion ?? null,
      coordinateSystem:"common-pitch-100",
      frames:structuredClone(match.dotReplayFrames ?? []),
    } : null,
    postMatchConsequences:structuredClone(match.postMatchConsequences),
  };
}

function preparePenaltyShootout(match, now) {
  const eventStart = match.events.length;
  const shootout = v2PenaltyShootout(match);
  const events = match.events.splice(eventStart);
  const extraTimeEnd = match.events.at(-1);
  if (extraTimeEnd?.type === "fulltime") {
    extraTimeEnd.type = "extraTimeEnd";
    extraTimeEnd.text = `加时赛结束，总比分仍为${currentDecisionScore(match)[0]}:${currentDecisionScore(match)[1]}，比赛进入点球大战。`;
  }
  match.extraTimeScore = match.score.map((score, index) => Number(score) - Number(match.regulationScore?.[index] ?? 0));
  match.penaltyShootout = shootout;
  match.pendingPenaltyShootout = {
    events,
    revealed:0,
    startedAt:Number(now),
  };
  match.penalties = [0, 0];
  match.winnerIndex = null;
  match.finished = false;
  match.phase = "playing";
  match.segment = "penalties";
}

function advancePenaltyShootout(match, now) {
  const pending = match.pendingPenaltyShootout;
  if (!pending) return;
  const elapsed = Math.max(0, Number(now) - Number(pending.startedAt));
  const target = Math.min(pending.events.length, Math.floor(elapsed / PENALTY_SHOOTOUT_EVENT_INTERVAL_MS) + 1);
  while (pending.revealed < target) {
    const event = pending.events[pending.revealed];
    match.events.push(event);
    pending.revealed += 1;
    if (event.type === "penaltyShootoutKick") match.penalties = [...event.score];
    if (event.type === "penalties") {
      match.penalties = [...match.penaltyShootout.scores];
      match.winnerIndex = match.penaltyShootout.winnerIndex;
      match.finished = true;
      match.phase = "finished";
      delete match.pendingPenaltyShootout;
      finishReport(match);
    }
  }
}

function currentDecisionScore(match) {
  return Array.isArray(match.aggregateBaseScore)
    ? match.score.map((score, index) => Number(score) + Number(match.aggregateBaseScore[index] ?? 0))
    : [...match.score];
}

function beginExtraTime(match) {
  match.regulationScore = [...match.score];
  match.extraTimeStarted = true;
  match.segment = "extraTimeFirstHalf";
  match.transition = null;
  adapterEvent(match, "extraTimeStart", 90, null, "常规时间及总比分仍然相同，比赛进入上下半场各15分钟的加时赛。", { importance:"stage", score:[...match.score], aggregateScore:currentDecisionScore(match) });
}

function finishAtRegulation(match) {
  match.regulationScore = [...match.score];
  match.segment = "regular";
  finishV2Match(match, { minute:90 });
}

export function createYdlLeagueV2Match(seats, options = {}) {
  const teams = seats.map((seat) => ({
    ...seat,
    positionPresets:seat.positionPresets ?? { position1:seat.positions },
    tacticalPlans:seat.tacticalPlans ?? { opening:{ tactic:seat.tactic, style:seat.style, positionPreset:"position1" } },
  }));
  const regulationOnly = options.regulationOnly !== false;
  const match = createV2Match(teams, {
    seed:options.seed, weather:options.weather, referee:options.referee,
    possessionChains:regulationOnly ? REGULATION_CHAIN_COUNT : REGULATION_CHAIN_COUNT + EXTRA_TIME_CHAIN_COUNT,
    parameters:options.parameters,
    dotReplayEnabled:Boolean(options.dotReplayEnabled),
  });
  match.regulationChainCount = REGULATION_CHAIN_COUNT;
  match.scheduledDurationMinutes = regulationOnly ? 90 : 120;
  match.version = 2;
  match.phase = "playing";
  match.segment = "regular";
  match.competitionMode = options.competitionMode ?? "league";
  match.engineProfile = options.engineProfile ?? "v2.1-stable-dynamic.2";
  match.legNumber = Number(options.legNumber ?? 1);
  match.regulationOnly = regulationOnly;
  match.aggregateBaseScore = Array.isArray(options.aggregateBaseScore) ? options.aggregateBaseScore.map(Number) : null;
  match.aggregateScore = null;
  match.regulationScore = null;
  match.halfTimeScore = null;
  match.extraTimeScore = null;
  match.extraTimeStarted = false;
  match.extraTimeHalfTimeRecorded = false;
  match.penalties = null;
  match.startedAt = Number(options.now ?? Date.now());
  match.lastAdvancedAt = match.startedAt;
  match.pause = null;
  match.pauseUsed = [true, true];
  match.report = null;
  return match;
}

export function advanceYdlLeagueV2Match(match, now = Date.now(), options = {}) {
  if (match.finished) return match;
  if (match.pendingPenaltyShootout) {
    advancePenaltyShootout(match, now);
    match.lastAdvancedAt = Number(now);
    return match;
  }
  const elapsed = Math.max(0, Number(now) - Number(match.startedAt ?? now));
  const maximumChains = Number(options.maximumChains ?? 8);
  let remainingChains = Number.isFinite(maximumChains) ? Math.max(0, maximumChains) : Infinity;
  const advanceTo = (desiredTarget) => {
    if (match.finished || remainingChains <= 0 || desiredTarget <= match.nextChainIndex) return;
    const target = Math.min(desiredTarget, match.nextChainIndex + remainingChains);
    const before = match.nextChainIndex;
    advanceV2Match(match, target);
    if (Number.isFinite(remainingChains)) remainingChains -= match.nextChainIndex - before;
  };

  const regulationTarget = Math.min(REGULATION_CHAIN_COUNT, Math.floor(elapsed / REGULATION_LIVE_DURATION_MS * REGULATION_CHAIN_COUNT));
  const halfTimeTarget = REGULATION_CHAIN_COUNT / 2;
  advanceTo(Math.min(regulationTarget, halfTimeTarget));
  if (!match.halfTimeScore && match.nextChainIndex >= halfTimeTarget) match.halfTimeScore = [...match.score];
  advanceTo(regulationTarget);
  if (!match.finished && match.nextChainIndex >= REGULATION_CHAIN_COUNT && !match.regulationOnly && !match.extraTimeStarted) {
    if (currentDecisionScore(match)[0] === currentDecisionScore(match)[1]) beginExtraTime(match);
    else finishAtRegulation(match);
  }
  if (!match.finished && match.extraTimeStarted) {
    const extraTimeElapsed = Math.max(0, elapsed - REGULATION_LIVE_DURATION_MS);
    const extraTimeTarget = REGULATION_CHAIN_COUNT + Math.min(EXTRA_TIME_CHAIN_COUNT, Math.floor(extraTimeElapsed / EXTRA_TIME_LIVE_DURATION_MS * EXTRA_TIME_CHAIN_COUNT));
    const halfTimeTarget = REGULATION_CHAIN_COUNT + EXTRA_TIME_HALF_CHAIN_COUNT;
    advanceTo(Math.min(extraTimeTarget, halfTimeTarget));
    if (!match.finished && match.nextChainIndex >= halfTimeTarget && !match.extraTimeHalfTimeRecorded) {
      match.extraTimeHalfTimeRecorded = true;
      match.segment = "extraTimeSecondHalf";
      match.transition = null;
      adapterEvent(match, "extraTimeHalfTime", 105, null, "加时赛上半场结束，双方短暂休整后交换场地。", { importance:"stage", score:[...match.score], aggregateScore:currentDecisionScore(match) });
    }
    advanceTo(extraTimeTarget);
    if (!match.finished && match.nextChainIndex >= match.possessionChainCount) {
      finishV2Match(match, { minute:120 });
      if (!match.regulationOnly && !match.abandoned && currentDecisionScore(match)[0] === currentDecisionScore(match)[1]) preparePenaltyShootout(match, now);
    }
  }
  if (match.finished && match.extraTimeStarted && !match.extraTimeScore) {
    match.extraTimeScore = match.score.map((score, index) => Number(score) - Number(match.regulationScore?.[index] ?? 0));
  }
  match.aggregateScore = Array.isArray(match.aggregateBaseScore) ? currentDecisionScore(match) : null;
  match.lastAdvancedAt = Number(now);
  match.phase = match.finished ? "finished" : "playing";
  if (match.finished && !match.report) finishReport(match);
  return match;
}

export function publicYdlLeagueV2Match(match, now = Date.now(), viewerIndex = null, revealAllStrategies = false) {
  const snapshot = publicV2Match(match);
  const teams = match.teams.map((team, index) => {
    const value = reportTeam(match, team, index);
    if (!revealAllStrategies && index !== viewerIndex) {
      value.tactic = null;
      value.style = null;
      value.attackFocus = null;
      value.defenseFocus = null;
    }
    return value;
  });
  return structuredClone({
    engineVersion:match.engineVersion, modelVersion:match.modelVersion, engineProfile:match.engineProfile, phase:match.phase, segment:match.segment,
    minute:publicMinute(snapshot.minute), score:snapshot.score, competitionMode:match.competitionMode, legNumber:match.legNumber,
    aggregateBaseScore:match.aggregateBaseScore ? [...match.aggregateBaseScore] : null, aggregateScore:match.aggregateScore ? [...match.aggregateScore] : null, weather:publicWeather(match.environment.weather), referee:publicReferee(match.environment.referee),
    blackWhistle:match.blackWhistleTriggered, teams, events:publicEvents(snapshot.events), pauseUsed:[true, true], pause:null,
    remainingMs:match.finished ? 0 : match.pendingPenaltyShootout
      ? Math.max(0, (match.pendingPenaltyShootout.events.length - match.pendingPenaltyShootout.revealed) * PENALTY_SHOOTOUT_EVENT_INTERVAL_MS)
      : Math.max(0, (match.extraTimeStarted ? REGULATION_LIVE_DURATION_MS + EXTRA_TIME_LIVE_DURATION_MS : REGULATION_LIVE_DURATION_MS) - (Number(now) - match.startedAt)),
    penalties:match.penalties ? [...match.penalties] : null, winnerIndex:match.winnerIndex ?? null, report:match.report,
  });
}
