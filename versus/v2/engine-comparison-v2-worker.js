import { parentPort, workerData } from "node:worker_threads";
import { roleGroup } from "../../game/public/schema.js";
import { advanceVersusMatch, createVersusMatch, HALFTIME_ADJUSTMENT_MS, REGULAR_DURATION_MS } from "../match-engine.js";
import { buildS4BalanceSeat, createS4BalanceRng, pickS4BalanceArchetype } from "../s4-balance-report.js";
import { simulateV2Match } from "./match-engine-v2.js";
import { buildV2SpatialMatchup } from "./spatial-model-v2.js";
import { buildV2TeamSnapshots } from "./team-snapshot-v2.js";
import { V2_MATCH_PARAMETERS } from "./match-parameters-v2.js";

function increment(map, key, amount = 1) {
  map[key] = Number(map[key] ?? 0) + Number(amount ?? 0);
}

function emptyGroup() {
  return { teamSamples:0, v1Points:0, v1Wins:0, v1Draws:0, v1GoalsFor:0, v1GoalsAgainst:0, v1XgFor:0, v2Points:0, v2Wins:0, v2Draws:0, v2GoalsAgainst:0, v2XgAgainst:0, v2Possessions:0, v2OpponentPossessions:0, v2PossessionControl:0, v2OpponentPossessionControl:0, v2Xg:0, v2Goals:0, v2Shots:0, v2Turnovers:0 };
}

function addTeamGroup(map, key, values) {
  const group = map[key] ??= emptyGroup();
  for (const [field, value] of Object.entries(values)) group[field] += Number(value ?? 0);
}

function teamComparisonValues(teamIndex, report, v2Teams) {
  const own = v2Teams[teamIndex];
  const opponent = v2Teams[1 - teamIndex];
  const goalsFor = report.score[teamIndex];
  const goalsAgainst = report.score[1 - teamIndex];
  return {
    teamSamples:1,
    v1Points:goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0,
    v1Wins:Number(goalsFor > goalsAgainst),
    v1Draws:Number(goalsFor === goalsAgainst),
    v1GoalsFor:goalsFor,
    v1GoalsAgainst:goalsAgainst,
    v1XgFor:Number(report.teams[teamIndex].stats.xg ?? 0),
    v2Points:own.goals > opponent.goals ? 3 : own.goals === opponent.goals ? 1 : 0,
    v2Wins:Number(own.goals > opponent.goals),
    v2Draws:Number(own.goals === opponent.goals),
    v2GoalsAgainst:opponent.goals,
    v2XgAgainst:opponent.xg,
    v2Possessions:own.possessions,
    v2OpponentPossessions:opponent.possessions,
    v2PossessionControl:own.possessionControl,
    v2OpponentPossessionControl:opponent.possessionControl,
    v2Xg:own.xg,
    v2Goals:own.goals,
    v2Shots:own.shots,
    v2Turnovers:own.turnovers,
  };
}

function roleForTurnover(stage) {
  return roleGroup(stage.turnover?.playerRole ?? stage.defender?.role ?? "ATT");
}

function shotQualityBucket(xg, thresholds) {
  const value = Number(xg ?? 0);
  const index = thresholds.findIndex((threshold) => value < Number(threshold));
  if (index < 0) return `gte-${thresholds.at(-1)}`;
  if (index === 0) return `lt-${thresholds[0]}`;
  return `${thresholds[index - 1]}-to-${thresholds[index]}`;
}

function numericBand(value, bands) {
  const number = Number(value ?? 0);
  const match = bands.find((entry) => number <= entry.maximum);
  return match?.label ?? bands.at(-1)?.label ?? String(Math.round(number));
}

function teamAnalysisDimensions(seat, archetype, v2, teamIndex) {
  const snapshot = v2.openingSnapshots[teamIndex];
  const players = seat.players ?? [];
  const averageUpgrade = players.reduce((sum, player) => sum + Number(player.upgradeLevel ?? 0), 0) / Math.max(1, players.length);
  const traitAssignments = players.reduce((sum, player) => sum + Number(player.traits?.length ?? 0), 0);
  const averageOverall = players.reduce((sum, player) => sum + Number(player.overall ?? 0), 0) / Math.max(1, players.length);
  const activeBonds = snapshot?.v2Snapshot?.activeBonds ?? [];
  const legends = Number(snapshot?.v2Snapshot?.sourceCounts?.legends ?? 0);
  const xPlayers = Number(snapshot?.v2Snapshot?.sourceCounts?.xPlayers ?? 0);
  return {
    formation:seat.simulationFormation,
    tactic:seat.tactic,
    style:seat.style,
    archetype,
    averageUpgrade:numericBand(averageUpgrade, [
      { maximum:1, label:"0-1" }, { maximum:3, label:"1-3" }, { maximum:5, label:"3-5" }, { maximum:8, label:"5-8" },
    ]),
    traitAssignments:numericBand(traitAssignments, [
      { maximum:0, label:"0" }, { maximum:5, label:"1-5" }, { maximum:11, label:"6-11" }, { maximum:99, label:"12+" },
    ]),
    activeBondCount:String(Math.min(2, activeBonds.length)),
    activeBondType:activeBonds.length ? [...new Set(activeBonds.map((bond) => bond.type ?? bond.id ?? "unknown"))] : ["none"],
    legendCount:numericBand(legends, [
      { maximum:0, label:"0" }, { maximum:2, label:"1-2" }, { maximum:5, label:"3-5" }, { maximum:11, label:"6+" },
    ]),
    xPlayer:xPlayers ? "present" : "none",
    averageOverall:numericBand(averageOverall, [
      { maximum:69, label:"<=69" }, { maximum:74, label:"70-74" }, { maximum:79, label:"75-79" }, { maximum:84, label:"80-84" }, { maximum:99, label:"85+" },
    ]),
    weather:v2.result.environment.weather,
    referee:v2.result.environment.referee,
  };
}

function runV2Match(seats, config, matchSeed, environment) {
  const openingSnapshots = buildV2TeamSnapshots(seats, { state:{ minute:0, score:[0, 0] }, environment });
  const match = simulateV2Match(seats, {
    seed:`${matchSeed}:v2-match`,
    possessionChains:Number(config.v2PossessionChainsPerMatch),
    weather:environment.weather,
    referee:environment.referee,
    recordRandomRolls:Boolean(config.recordV2RandomRolls),
  });
  const result = {
    possessions:match.teams.reduce((sum, team) => sum + Number(team.stats.possessions ?? 0), 0),
    xg:match.teams.reduce((sum, team) => sum + Number(team.stats.xg ?? 0), 0),
    goals:match.teams.reduce((sum, team) => sum + Number(team.stats.goals ?? 0), 0),
    shots:match.teams.reduce((sum, team) => sum + Number(team.stats.shots ?? 0), 0),
    terminalOutcomes:{},
    turnoverDefenderRoles:{},
    turnoverBands:{},
    startZones:{},
    endZones:{},
    routeTypes:{},
    discipline:{
      fouls:match.teams.reduce((sum, team) => sum + Number(team.stats.fouls ?? 0), 0),
      setPieces:match.teams.reduce((sum, team) => sum + Number(team.stats.setPieces ?? 0), 0),
      penalties:match.teams.reduce((sum, team) => sum + Number(team.stats.penalties ?? 0), 0),
      yellowCards:match.teams.reduce((sum, team) => sum + Number(team.stats.yellowCards ?? 0), 0),
      redCards:match.teams.reduce((sum, team) => sum + Number(team.stats.redCards ?? 0), 0),
    },
    independentEvents:{},
    environment:{ weather:environment.weather, referee:environment.referee },
    sources:{ activeBonds:0, legends:0, xPlayers:0, traitAssignments:0 },
    stages:{},
    teams:match.teams.map((team) => ({
      possessions:Number(team.stats.possessions ?? 0),
      xg:Number(team.stats.xg ?? 0),
      goals:Number(team.stats.goals ?? 0),
      shots:Number(team.stats.shots ?? 0),
      turnovers:0,
      possessionControl:0,
    })),
    matchExecution:{
      completed:Number(match.finished && !match.abandoned),
      abandoned:Number(match.abandoned),
      tacticalSwitches:match.events.filter((event) => event.type === "tactical" && event.plan).length,
      injuries:match.postMatchConsequences.injuries.length,
      suspensions:match.postMatchConsequences.suspensions.length,
      commentaryEntries:match.commentary.length,
      eventTypes:{},
    },
    shotQuality:{},
    shotTypes:{},
    matchDistribution:{
      homeWins:Number(match.score[0] > match.score[1]),
      draws:Number(match.score[0] === match.score[1]),
      awayWins:Number(match.score[0] < match.score[1]),
      zeroZero:Number(match.score[0] === 0 && match.score[1] === 0),
      sixPlusGoals:Number(match.score[0] + match.score[1] >= 6),
      eightPlusGoals:Number(match.score[0] + match.score[1] >= 8),
      threePlusGoalMargin:Number(Math.abs(match.score[0] - match.score[1]) >= 3),
      fourPlusGoalMargin:Number(Math.abs(match.score[0] - match.score[1]) >= 4),
    },
    goalMinutes:{},
  };
  for (const team of openingSnapshots) {
    result.sources.activeBonds += team.v2Snapshot.activeBonds.length;
    result.sources.legends += team.v2Snapshot.sourceCounts.legends;
    result.sources.xPlayers += team.v2Snapshot.sourceCounts.xPlayers;
    result.sources.traitAssignments += team.players.reduce((sum, player) => sum + Number(player.v2AppliedTraitIds?.length ?? 0), 0);
  }
  const rawChains = [];
  for (const event of match.events) {
    increment(result.matchExecution.eventTypes, event.type);
    if (event.type === "goal") {
      const minute = Number(event.minute ?? 0);
      const bucket = minute <= 15 ? "01-15" : minute <= 30 ? "16-30" : minute <= 45 ? "31-45" : minute <= 60 ? "46-60" : minute <= 75 ? "61-75" : "76-90";
      increment(result.goalMinutes, bucket);
    }
    if (!["goal", "miss", "save"].includes(event.type) || !Number.isFinite(Number(event.xg))) continue;
    const shotType = result.shotTypes[event.attackType ?? "unknown"] ??= { shots:0, goals:0, xg:0 };
    shotType.shots += 1;
    shotType.goals += Number(event.type === "goal");
    shotType.xg += Number(event.xg);
    const thresholds = config.v2ShotXgBucketUpperBounds ?? [0.01, 0.03, 0.05, 0.08, 0.15, 0.3, 0.6];
    const bucket = result.shotQuality[shotQualityBucket(event.xg, thresholds)] ??= { shots:0, goals:0, xg:0 };
    bucket.shots += 1;
    bucket.goals += Number(event.type === "goal");
    bucket.xg += Number(event.xg);
  }
  for (const chain of match.chains) {
    increment(result.terminalOutcomes, chain.terminalOutcome);
    increment(result.startZones, chain.startZone);
    increment(result.endZones, chain.endZone);
    const team = result.teams[chain.attackingTeamIndex];
    const selectedShare = Number(chain.stages[0]?.probability ?? 0.5);
    const homeShare = chain.attackingTeamIndex === 0 ? selectedShare : 1 - selectedShare;
    result.teams[0].possessionControl += homeShare;
    result.teams[1].possessionControl += 1 - homeShare;
    for (const stage of chain.stages.slice(1)) {
      const aggregate = result.stages[stage.stage] ??= { attempts:0, successes:0, probabilitySum:0, factors:{} };
      aggregate.attempts += 1;
      aggregate.successes += Number(stage.success);
      aggregate.probabilitySum += stage.probability;
      for (const [factor, value] of Object.entries(stage.factors)) increment(aggregate.factors, factor, value);
      if (stage.connection?.routeType) increment(result.routeTypes, stage.connection.routeType);
      if (stage.outcome === "defensiveTurnover") {
        team.turnovers += 1;
        increment(result.turnoverDefenderRoles, roleForTurnover(stage));
        increment(result.turnoverBands, stage.zone.split(":")[0]);
      } else if (stage.outcome === "unforcedTurnover") {
        team.turnovers += 1;
        increment(result.turnoverDefenderRoles, "unforced");
        increment(result.turnoverBands, stage.zone.split(":")[0]);
      }
    }
    for (const event of chain.independentEvents) increment(result.independentEvents, event.type);
    if (rawChains.length < Number(config.rawV2ChainsPerSample ?? 3)) rawChains.push(chain);
  }
  return { result, spatial:buildV2SpatialMatchup(openingSnapshots), rawChains, match, openingSnapshots };
}

function addMatch(aggregate, report, seats, archetypes, v2) {
  aggregate.matches += 1;
  aggregate.v1.goals += report.score[0] + report.score[1];
  aggregate.v1.shots += report.teams.reduce((sum, team) => sum + Number(team.stats.shots ?? 0), 0);
  aggregate.v1.shotsOnTarget += report.teams.reduce((sum, team) => sum + Number(team.stats.shotsOnTarget ?? 0), 0);
  aggregate.v1.xg += report.teams.reduce((sum, team) => sum + Number(team.stats.xg ?? 0), 0);
  aggregate.v1.draws += Number(report.score[0] === report.score[1]);
  for (const key of ["possessions", "xg", "goals", "shots"]) aggregate.v2[key] += v2.result[key];
  for (const key of ["terminalOutcomes", "turnoverDefenderRoles", "turnoverBands", "startZones", "endZones", "routeTypes", "discipline", "independentEvents", "sources", "stages", "matchExecution", "shotQuality", "shotTypes", "matchDistribution", "goalMinutes"]) {
    mergeObject(aggregate.v2[key], v2.result[key]);
  }
  const dimensionsByTeam = seats.map((seat, teamIndex) => teamAnalysisDimensions(seat, archetypes[teamIndex], v2, teamIndex));
  const selectedDimensions = new Set(configuredAnalysisDimensions(v2.config));
  seats.forEach((seat, teamIndex) => {
    const values = teamComparisonValues(teamIndex, report, v2.result.teams);
    for (const [dimension, rawValue] of Object.entries(dimensionsByTeam[teamIndex])) {
      if (!selectedDimensions.has(dimension)) continue;
      const valuesForDimension = Array.isArray(rawValue) ? rawValue : [rawValue];
      const opponentRaw = dimensionsByTeam[1 - teamIndex][dimension];
      const opponentValue = (Array.isArray(opponentRaw) ? opponentRaw : [opponentRaw]).join("+");
      for (const value of valuesForDimension) {
        addTeamGroup(aggregate.dimensions[dimension] ??= {}, value, values);
        addTeamGroup(aggregate.headToHead[dimension] ??= {}, `${value} vs ${opponentValue}`, values);
      }
    }
  });
}

function configuredAnalysisDimensions(config = {}) {
  return config.analysisDimensions ?? ["formation", "tactic", "style", "archetype"];
}

function mergeObject(target, source) {
    for (const [key, value] of Object.entries(source ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) mergeObject(target[key] ??= {}, value);
    else increment(target, key, value);
  }
}

function rawSample(index, seed, seats, archetypes, report, v2) {
  const v2Players = new Map(v2.match.teams.flatMap((team) => team.players.map((player) => [player.id, player.name])));
  return {
    index,
    seed,
    archetypes,
    matchup:seats.map((seat) => ({ name:seat.name, formation:seat.simulationFormation, tactic:seat.tactic, style:seat.style, players:seat.players.map((player) => ({ id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole ?? null, grade:player.grade, overall:player.overall, upgradeLevel:player.upgradeLevel, traitIds:player.traits ?? [] })), positions:seat.positions })),
    v1:{ score:report.score, weather:report.weather.key, referee:report.referee.key, teams:report.teams.map((team) => ({ name:team.name, formation:team.formation, stats:team.stats })) },
    v2:{
      possessions:v2.result.possessions,
      xg:v2.result.xg,
      goals:v2.result.goals,
      shots:v2.result.shots,
      terminalOutcomes:v2.result.terminalOutcomes,
      turnoverDefenderRoles:v2.result.turnoverDefenderRoles,
      routeTypes:v2.result.routeTypes,
      discipline:v2.result.discipline,
      matchExecution:v2.result.matchExecution,
      shotQuality:v2.result.shotQuality,
      score:v2.match.score,
      goalEvents:v2.match.events.filter((event) => event.type === "goal").map((event) => ({
        minute:event.minute,
        teamIndex:event.teamIndex,
        actorId:event.actorId,
        scorerName:v2Players.get(event.actorId) ?? null,
        assistId:event.assistId,
        assistName:v2Players.get(event.assistId) ?? null,
        opponentId:event.opponentId,
        goalkeeperName:v2Players.get(event.opponentId) ?? null,
        attackType:event.attackType,
        xg:event.xg,
        text:event.text,
        detail:event.detail,
      })),
      postMatchConsequences:v2.match.postMatchConsequences,
      independentEvents:v2.result.independentEvents,
      sources:v2.result.sources,
      spatialTeams:v2.spatial.teams.map((team) => ({ name:team.name, controlledZoneCount:team.controlledZoneCount, overloadZoneCount:team.overloadZoneCount, centralControl:team.centralControl, flankControl:team.flankControl, finalThirdControl:team.finalThirdControl, boxPresence:team.boxPresence, connectionQuality:team.connectionQuality, exploitableZones:team.exploitableZones })),
      chains:v2.rawChains,
    },
  };
}

try {
  const { config, start, count } = workerData;
  const aggregate = { matches:0, v1:{ goals:0, shots:0, shotsOnTarget:0, xg:0, draws:0 }, v2:{ possessions:0, xg:0, goals:0, shots:0, terminalOutcomes:{}, turnoverDefenderRoles:{}, turnoverBands:{}, startZones:{}, endZones:{}, routeTypes:{}, discipline:{}, independentEvents:{}, sources:{}, stages:{}, matchExecution:{}, shotQuality:{}, shotTypes:{}, matchDistribution:{}, goalMinutes:{} }, dimensions:{}, headToHead:{} };
  const rawMatchSamples = [];
  const progressInterval = Math.max(1, Number(config.progressIntervalMatches ?? 1));
  for (let index = start; index < start + count; index += 1) {
    const seed = `${config.seed}:paired:${index}`;
    const ecosystemRng = createS4BalanceRng(seed);
    const archetypes = [pickS4BalanceArchetype(ecosystemRng, config.ecosystemWeights), pickS4BalanceArchetype(ecosystemRng, config.ecosystemWeights)];
    const seats = archetypes.map((archetype, side) => buildS4BalanceSeat(seed, side === 0 ? "home" : "away", archetype));
    let report;
    if (config.v2Only) {
      const weather = pickS4BalanceArchetype(ecosystemRng, V2_MATCH_PARAMETERS.environment.weatherWeights);
      const referee = pickS4BalanceArchetype(ecosystemRng, V2_MATCH_PARAMETERS.environment.refereeWeights);
      report = { score:[0, 0], weather:{ key:weather }, referee:{ key:referee }, teams:[{ stats:{ xg:0 } }, { stats:{ xg:0 } }] };
    } else {
      const match = createVersusMatch(seats, { now:0, seed, competitionMode:"league", regulationOnly:true, recordEvents:false });
      advanceVersusMatch(match, REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS);
      report = match.report;
    }
    const v2 = runV2Match(seats, config, seed, { weather:report.weather.key, referee:report.referee.key });
    v2.config = config;
    addMatch(aggregate, report, seats, archetypes, v2);
    if (index < Number(config.rawMatchSampleLimit ?? 0)) rawMatchSamples.push(rawSample(index, seed, seats, archetypes, report, v2));
    const completed = index - start + 1;
    if (completed % progressInterval === 0 || completed === count) parentPort.postMessage({ type:"progress", completed, total:count });
  }
  parentPort.postMessage({ type:"result", aggregate, rawMatchSamples });
} catch (error) {
  parentPort.postMessage({ error:{ name:error.name, message:error.message, stack:error.stack } });
}
