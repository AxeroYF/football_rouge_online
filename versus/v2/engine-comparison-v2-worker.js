import { parentPort, workerData } from "node:worker_threads";
import { roleGroup } from "../../game/public/schema.js";
import { advanceVersusMatch, createVersusMatch, HALFTIME_ADJUSTMENT_MS, REGULAR_DURATION_MS } from "../match-engine.js";
import { buildS4BalanceSeat, createS4BalanceRng, pickS4BalanceArchetype } from "../s4-balance-report.js";
import { simulateV2Match } from "./match-engine-v2.js";
import { buildV2SpatialMatchup } from "./spatial-model-v2.js";
import { buildV2TeamSnapshots } from "./team-snapshot-v2.js";
import { V2_MATCH_PARAMETERS } from "./match-parameters-v2.js";
import { v2ScenarioForMatch, v2ScenarioSeatOptions } from "./engine-comparison-v2-scenario-matrix.js";

function increment(map, key, amount = 1) {
  map[key] = Number(map[key] ?? 0) + Number(amount ?? 0);
}

function emptyGroup() {
  return { teamSamples:0, v1Points:0, v1Wins:0, v1Draws:0, v1GoalsFor:0, v1GoalsAgainst:0, v1XgFor:0, v2Points:0, v2Wins:0, v2Draws:0, v2GoalsAgainst:0, v2XgAgainst:0, v2Possessions:0, v2OpponentPossessions:0, v2PossessionControl:0, v2OpponentPossessionControl:0, v2Xg:0, v2Goals:0, v2Shots:0, v2ShotsOnTarget:0, v2Fouls:0, v2YellowCards:0, v2RedCards:0, v2Injuries:0, v2InjuryAbsenceRounds:0, v2FoulInjuriesSuffered:0, v2FoulInjuriesCaused:0, v2Substitutions:0, v2NormalPossessions:0, v2TransitionPossessions:0, v2TransitionShots:0, v2BacklineExposure:0, v2Turnovers:0 };
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
    v2ShotsOnTarget:own.shotsOnTarget,
    v2Fouls:own.fouls,
    v2YellowCards:own.yellowCards,
    v2RedCards:own.redCards,
    v2Injuries:own.injuries,
    v2InjuryAbsenceRounds:own.injuryAbsenceRounds,
    v2FoulInjuriesSuffered:own.foulInjuriesSuffered,
    v2FoulInjuriesCaused:own.foulInjuriesCaused,
    v2Substitutions:own.substitutions,
    v2NormalPossessions:own.normalPossessions,
    v2TransitionPossessions:own.transitionPossessions,
    v2TransitionShots:own.transitionShots,
    v2BacklineExposure:own.backlineExposure,
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
  const tacticalDimensions = v2.spatial?.teams?.[teamIndex]?.tacticalDimensions ?? {};
  const analysisSnapshot = v2.match?.analysisTimeline?.[0]?.teams?.[teamIndex] ?? {};
  const inDetails = { attackDirection:"balanced", chanceCreation:"balanced", longShots:"balanced", crossing:"balanced", ...(seat.inPossessionDetails ?? {}) };
  const outDetails = { defensiveWidth:"balanced", defenseDirection:"balanced", marking:"mixed", lineStrategy:"hold", ...(seat.outOfPossessionDetails ?? {}) };
  const activeDutyPlayers = (analysisSnapshot.players ?? []).filter((player) => player.tacticalDuty);
  const activeDutyTypes = [...new Set(activeDutyPlayers.map((player) => player.tacticalDuty))];
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
    scenario:seat.simulationScenarioId ?? "random-ecosystem",
    scenarioCategory:seat.simulationScenarioCategory ?? "random",
    scenarioSuite:seat.simulationScenarioSuite ?? "random",
    shapeRisk:seat.simulationShapeRisk ?? "normal",
    formationTag:seat.simulationFormationTags?.length ? seat.simulationFormationTags : ["normal"],
    tacticalProfile:seat.simulationTacticalProfile ?? `${seat.tactic}:${seat.style}`,
    detailProfile:seat.simulationDetailProfile ?? "default",
    playerDutyMode:seat.simulationPlayerDutyMode ?? "default",
    bondMode:seat.simulationBondMode ?? "natural",
    activeDutyCount:numericBand(activeDutyPlayers.length, [
      { maximum:0, label:"0" }, { maximum:4, label:"1-4" }, { maximum:8, label:"5-8" }, { maximum:11, label:"9-11" },
    ]),
    activeDutyType:activeDutyTypes.length ? activeDutyTypes : ["none"],
    inPossession:seat.inPossession ?? "balanced",
    outOfPossession:seat.outOfPossession ?? "balanced",
    inAttackDirection:inDetails.attackDirection,
    inChanceCreation:inDetails.chanceCreation,
    inLongShots:inDetails.longShots,
    inCrossing:inDetails.crossing,
    outDefensiveWidth:outDetails.defensiveWidth,
    outDefenseDirection:outDetails.defenseDirection,
    outMarking:outDetails.marking,
    outLineStrategy:outDetails.lineStrategy,
    tacticalFitBand:numericBand(Number(analysisSnapshot.tacticalFit ?? 0) * 100, [
      { maximum:69, label:"<=69" }, { maximum:79, label:"70-79" }, { maximum:89, label:"80-89" }, { maximum:100, label:"90+" },
    ]),
    structureFitBand:numericBand(Number(analysisSnapshot.structureIndex ?? 0) * 100, [
      { maximum:69, label:"<=69" }, { maximum:79, label:"70-79" }, { maximum:89, label:"80-89" }, { maximum:100, label:"90+" },
    ]),
    tempoBand:numericBand(tacticalDimensions.tempo, [{ maximum:20, label:"00-20" }, { maximum:40, label:"21-40" }, { maximum:60, label:"41-60" }, { maximum:80, label:"61-80" }, { maximum:100, label:"81-100" }]),
    directnessBand:numericBand(tacticalDimensions.directness, [{ maximum:20, label:"00-20" }, { maximum:40, label:"21-40" }, { maximum:60, label:"41-60" }, { maximum:80, label:"61-80" }, { maximum:100, label:"81-100" }]),
    attackingWidthBand:numericBand(tacticalDimensions.attackingWidth, [{ maximum:20, label:"00-20" }, { maximum:40, label:"21-40" }, { maximum:60, label:"41-60" }, { maximum:80, label:"61-80" }, { maximum:100, label:"81-100" }]),
    defensiveLineBand:numericBand(tacticalDimensions.defensiveLine, [{ maximum:20, label:"00-20" }, { maximum:40, label:"21-40" }, { maximum:60, label:"41-60" }, { maximum:80, label:"61-80" }, { maximum:100, label:"81-100" }]),
    pressingBand:numericBand(tacticalDimensions.pressing, [{ maximum:20, label:"00-20" }, { maximum:40, label:"21-40" }, { maximum:60, label:"41-60" }, { maximum:80, label:"61-80" }, { maximum:100, label:"81-100" }]),
    compactnessBand:numericBand(tacticalDimensions.compactness, [{ maximum:20, label:"00-20" }, { maximum:40, label:"21-40" }, { maximum:60, label:"41-60" }, { maximum:80, label:"61-80" }, { maximum:100, label:"81-100" }]),
    counterAttackBand:numericBand(tacticalDimensions.counterAttack, [{ maximum:20, label:"00-20" }, { maximum:40, label:"21-40" }, { maximum:60, label:"41-60" }, { maximum:80, label:"61-80" }, { maximum:100, label:"81-100" }]),
    timeWastingBand:numericBand(tacticalDimensions.timeWasting, [{ maximum:20, label:"00-20" }, { maximum:40, label:"21-40" }, { maximum:60, label:"41-60" }, { maximum:80, label:"61-80" }, { maximum:100, label:"81-100" }]),
    backlineExposure:numericBand(v2.spatial?.teams?.[teamIndex]?.backlineExposure ?? 0, [
      { maximum:0.05, label:"none" }, { maximum:0.25, label:"low" }, { maximum:0.5, label:"high" }, { maximum:1, label:"extreme" },
    ]),
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
  const spatial = buildV2SpatialMatchup(openingSnapshots);
  const match = simulateV2Match(seats, {
    seed:`${matchSeed}:v2-match`,
    possessionChains:Number(config.v2PossessionChainsPerMatch),
    weather:environment.weather,
    referee:environment.referee,
    recordRandomRolls:Boolean(config.recordV2RandomRolls),
  });
  const injuryConsequences = match.postMatchConsequences.injuries ?? [];
  const redEvents = match.events.filter((event) => event.type === "red");
  const yellowEvents = match.events.filter((event) => event.type === "yellow");
  const injurySubstitutions = match.events.filter((event) => event.type === "substitution" && event.reason === "injury").length;
  const injurySummary = {
    total:injuryConsequences.length,
    matchesWithInjury:Number(injuryConsequences.length > 0),
    totalAbsenceRounds:injuryConsequences.reduce((sum, injury) => sum + Number(injury.matches ?? 0), 0),
    causedByFoul:injuryConsequences.filter((injury) => injury.reason === "foul").length,
    transferredByTrait:injuryConsequences.filter((injury) => injury.injuryTransferred).length,
    injurySubstitutions,
    unreplacedInjuries:Math.max(0, injuryConsequences.length - injurySubstitutions),
    causes:{},
    absenceRounds:{},
    victimRoles:{},
    offenderSanctions:{},
  };
  injuryConsequences.forEach((injury) => {
    increment(injurySummary.causes, injury.reason ?? "match");
    increment(injurySummary.absenceRounds, String(Number(injury.matches ?? 0)));
    const victim = match.teams[injury.teamIndex]?.players.find((player) => player.id === injury.playerId);
    increment(injurySummary.victimRoles, victim?.assignedRole ?? victim?.role ?? "unknown");
    if (injury.reason === "foul") increment(injurySummary.offenderSanctions, injury.card ?? "none");
  });
  const result = {
    possessions:match.teams.reduce((sum, team) => sum + Number(team.stats.possessions ?? 0), 0),
    xg:match.teams.reduce((sum, team) => sum + Number(team.stats.xg ?? 0), 0),
    goals:match.teams.reduce((sum, team) => sum + Number(team.stats.goals ?? 0), 0),
    shots:match.teams.reduce((sum, team) => sum + Number(team.stats.shots ?? 0), 0),
    shotsOnTarget:match.teams.reduce((sum, team) => sum + Number(team.stats.shotsOnTarget ?? 0), 0),
    corners:match.teams.reduce((sum, team) => sum + Number(team.stats.corners ?? 0), 0),
    saves:match.teams.reduce((sum, team) => sum + Number(team.stats.saves ?? 0), 0),
    blockedShots:match.teams.reduce((sum, team) => sum + Number(team.stats.blockedShots ?? 0), 0),
    offsides:match.events.filter((event) => event.type === "offside").length,
    defensiveActions:{
      tackles:match.teams.reduce((sum, team) => sum + Number(team.stats.tackles ?? 0), 0),
      interceptions:match.teams.reduce((sum, team) => sum + Number(team.stats.interceptions ?? 0), 0),
      clearances:match.teams.reduce((sum, team) => sum + Number(team.stats.clearances ?? 0), 0),
      setPieceClearances:match.teams.reduce((sum, team) => sum + Number(team.stats.setPieceClearances ?? 0), 0),
      blocks:match.teams.reduce((sum, team) => sum + Number(team.stats.blocks ?? 0), 0),
      pressuresWon:match.teams.reduce((sum, team) => sum + Number(team.stats.pressuresWon ?? 0), 0),
    },
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
      matchesWithYellowCard:Number(yellowEvents.length > 0),
      matchesWithRedCard:Number(redEvents.length > 0),
      simulationYellowCards:yellowEvents.filter((event) => event.simulation).length,
      directRedCards:redEvents.filter((event) => ["directRed", "blackWhistle"].includes(event.dismissalReason)).length,
      secondYellowRedCards:redEvents.filter((event) => event.dismissalReason === "secondYellow").length,
      blackWhistleRedCards:redEvents.filter((event) => event.dismissalReason === "blackWhistle").length,
    },
    injuries:injurySummary,
    independentEvents:{},
    environment:{ weather:environment.weather, referee:environment.referee },
    sources:{ activeBonds:0, legends:0, xPlayers:0, traitAssignments:0 },
    stages:{},
    teams:match.teams.map((team, teamIndex) => ({
      possessions:Number(team.stats.possessions ?? 0),
      xg:Number(team.stats.xg ?? 0),
      goals:Number(team.stats.goals ?? 0),
      shots:Number(team.stats.shots ?? 0),
      shotsOnTarget:Number(team.stats.shotsOnTarget ?? 0),
      fouls:Number(team.stats.fouls ?? 0),
      yellowCards:Number(team.stats.yellowCards ?? 0),
      redCards:Number(team.stats.redCards ?? 0),
      injuries:Number(team.stats.injuries ?? 0),
      injuryAbsenceRounds:injuryConsequences.filter((injury) => injury.teamIndex === teamIndex).reduce((sum, injury) => sum + Number(injury.matches ?? 0), 0),
      foulInjuriesSuffered:injuryConsequences.filter((injury) => injury.teamIndex === teamIndex && injury.reason === "foul").length,
      foulInjuriesCaused:injuryConsequences.filter((injury) => injury.offenderTeamIndex === teamIndex && injury.reason === "foul").length,
      substitutions:Number(team.stats.substitutions ?? 0),
      backlineExposure:Number(spatial.teams[teamIndex]?.backlineExposure ?? 0),
      turnovers:0,
      possessionControl:Number(team.stats.possessionSeconds ?? team.stats.possessions ?? 0),
      normalPossessions:Number(team.stats.normalPossessions ?? 0),
      transitionPossessions:Number(team.stats.transitionPossessions ?? 0),
      transitionShots:Number(team.stats.transitionShots ?? 0),
      corners:Number(team.stats.corners ?? 0),
      saves:Number(team.stats.saves ?? 0),
      blockedShots:Number(team.stats.blockedShots ?? 0),
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
    goalBodyParts:{},
    matchDistribution:{
      homeWins:Number(match.score[0] > match.score[1]),
      draws:Number(match.score[0] === match.score[1]),
      awayWins:Number(match.score[0] < match.score[1]),
      zeroZero:Number(match.score[0] === 0 && match.score[1] === 0),
      sixPlusGoals:Number(match.score[0] + match.score[1] >= 6),
      eightPlusGoals:Number(match.score[0] + match.score[1] >= 8),
      threePlusGoalMargin:Number(Math.abs(match.score[0] - match.score[1]) >= 3),
      fourPlusGoalMargin:Number(Math.abs(match.score[0] - match.score[1]) >= 4),
      bothTeamsScored:Number(match.score[0] > 0 && match.score[1] > 0),
      cleanSheetMatches:Number(match.score[0] === 0 || match.score[1] === 0),
      oneGoalMargin:Number(Math.abs(match.score[0] - match.score[1]) === 1),
      totalGoals:{ [String(Math.min(6, match.score[0] + match.score[1]))]:1 },
      scorelines:{ [`${match.score[0]}-${match.score[1]}`]:1 },
    },
    xgCalibration:{
      absoluteMatchErrorSum:Math.abs(Number(match.teams[0].stats.xg ?? 0) + Number(match.teams[1].stats.xg ?? 0) - match.score[0] - match.score[1]),
      squaredMatchErrorSum:Math.pow(Number(match.teams[0].stats.xg ?? 0) + Number(match.teams[1].stats.xg ?? 0) - match.score[0] - match.score[1], 2),
      overperformanceMatches:Number(match.score[0] + match.score[1] > Number(match.teams[0].stats.xg ?? 0) + Number(match.teams[1].stats.xg ?? 0)),
      underperformanceMatches:Number(match.score[0] + match.score[1] < Number(match.teams[0].stats.xg ?? 0) + Number(match.teams[1].stats.xg ?? 0)),
    },
    possessionDistribution:{
      homePossessionPercent:Number((Number(match.teams[0].stats.possessionSeconds ?? 0) / Math.max(1, match.teams.reduce((sum, team) => sum + Number(team.stats.possessionSeconds ?? 0), 0)) * 100).toFixed(4)),
      absoluteDifferencePercent:Math.abs(Number(match.teams[0].stats.possessionSeconds ?? 0) - Number(match.teams[1].stats.possessionSeconds ?? 0)) / Math.max(1, match.teams.reduce((sum, team) => sum + Number(team.stats.possessionSeconds ?? 0), 0)) * 100,
      matchesWith55Plus:Number(Math.max(...match.teams.map((team) => Number(team.stats.possessionSeconds ?? 0))) / Math.max(1, match.teams.reduce((sum, team) => sum + Number(team.stats.possessionSeconds ?? 0), 0)) >= 0.55),
      matchesWith60Plus:Number(Math.max(...match.teams.map((team) => Number(team.stats.possessionSeconds ?? 0))) / Math.max(1, match.teams.reduce((sum, team) => sum + Number(team.stats.possessionSeconds ?? 0), 0)) >= 0.6),
      matchesWith70Plus:Number(Math.max(...match.teams.map((team) => Number(team.stats.possessionSeconds ?? 0))) / Math.max(1, match.teams.reduce((sum, team) => sum + Number(team.stats.possessionSeconds ?? 0), 0)) >= 0.7),
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
      increment(result.goalBodyParts, event.bodyPart ?? "unknown");
    }
    if (!["goal", "miss", "save", "block"].includes(event.type) || !Number.isFinite(Number(event.xg))) continue;
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
    for (const stage of chain.stages.slice(1)) {
      const aggregate = result.stages[stage.stage] ??= { attempts:0, successes:0, probabilitySum:0, factors:{} };
      aggregate.attempts += 1;
      aggregate.successes += Number(stage.success);
      aggregate.probabilitySum += stage.probability;
      for (const [factor, value] of Object.entries(stage.factors ?? {})) increment(aggregate.factors, factor, value);
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
  return { result, spatial, rawChains, match, openingSnapshots };
}

function addMatch(aggregate, report, seats, archetypes, v2) {
  aggregate.matches += 1;
  aggregate.v1.goals += report.score[0] + report.score[1];
  aggregate.v1.shots += report.teams.reduce((sum, team) => sum + Number(team.stats.shots ?? 0), 0);
  aggregate.v1.shotsOnTarget += report.teams.reduce((sum, team) => sum + Number(team.stats.shotsOnTarget ?? 0), 0);
  aggregate.v1.xg += report.teams.reduce((sum, team) => sum + Number(team.stats.xg ?? 0), 0);
  aggregate.v1.draws += Number(report.score[0] === report.score[1]);
  for (const key of ["possessions", "xg", "goals", "shots", "shotsOnTarget", "corners", "saves", "blockedShots", "offsides"]) aggregate.v2[key] += v2.result[key];
  for (const key of ["terminalOutcomes", "turnoverDefenderRoles", "turnoverBands", "startZones", "endZones", "routeTypes", "discipline", "injuries", "defensiveActions", "independentEvents", "sources", "stages", "matchExecution", "shotQuality", "shotTypes", "goalBodyParts", "matchDistribution", "goalMinutes", "xgCalibration", "possessionDistribution"]) {
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

function rawSample(index, seed, seats, archetypes, report, v2, scenario = null) {
  const v2Players = new Map(v2.match.teams.flatMap((team) => team.players.map((player) => [player.id, player.name])));
  return {
    index,
    seed,
    archetypes,
    scenario:scenario ? { id:scenario.id, suiteId:scenario.suiteId, category:scenario.category, tags:scenario.tags, mirrored:scenario.mirrored, repetition:scenario.repetition } : null,
    matchup:seats.map((seat) => ({ name:seat.name, formation:seat.simulationFormation, formationTags:seat.simulationFormationTags, shapeRisk:seat.simulationShapeRisk, tacticalProfile:seat.simulationTacticalProfile, detailProfile:seat.simulationDetailProfile, tactic:seat.tactic, style:seat.style, inPossession:seat.inPossession, outOfPossession:seat.outOfPossession, inPossessionDetails:seat.inPossessionDetails, outOfPossessionDetails:seat.outOfPossessionDetails, formationLines:seat.formationLines, players:seat.players.map((player) => ({ id:player.id, name:player.name, role:player.role, secondaryRole:player.secondaryRole ?? null, grade:player.grade, overall:player.overall, upgradeLevel:player.upgradeLevel, traitIds:player.traits ?? [] })), positions:seat.positions })),
    ...(v2.config.v2Only ? {} : { v1:{ score:report.score, weather:report.weather.key, referee:report.referee.key, teams:report.teams.map((team) => ({ name:team.name, formation:team.formation, stats:team.stats })) } }),
    v2:{
      possessions:v2.result.possessions,
      xg:v2.result.xg,
      goals:v2.result.goals,
      shots:v2.result.shots,
      shotsOnTarget:v2.result.shotsOnTarget,
      corners:v2.result.corners,
      saves:v2.result.saves,
      blockedShots:v2.result.blockedShots,
      offsides:v2.result.offsides,
      defensiveActions:v2.result.defensiveActions,
      terminalOutcomes:v2.result.terminalOutcomes,
      turnoverDefenderRoles:v2.result.turnoverDefenderRoles,
      routeTypes:v2.result.routeTypes,
      discipline:v2.result.discipline,
      injuries:v2.result.injuries,
      matchExecution:v2.result.matchExecution,
      shotQuality:v2.result.shotQuality,
      shotTypes:v2.result.shotTypes,
      goalBodyParts:v2.result.goalBodyParts,
      matchDistribution:v2.result.matchDistribution,
      xgCalibration:v2.result.xgCalibration,
      possessionDistribution:v2.result.possessionDistribution,
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
        bodyPart:event.bodyPart,
        bodyPartLabel:event.bodyPartLabel,
        xg:event.xg,
        goalProbability:event.goalProbability,
        onTargetProbability:event.onTargetProbability,
        saveProbability:event.saveProbability,
        text:event.text,
        detail:event.detail,
      })),
      postMatchConsequences:v2.match.postMatchConsequences,
      independentEvents:v2.result.independentEvents,
      sources:v2.result.sources,
      spatialTeams:v2.spatial.teams.map((team) => ({ name:team.name, backlineExposure:team.backlineExposure, controlledZoneCount:team.controlledZoneCount, overloadZoneCount:team.overloadZoneCount, centralControl:team.centralControl, flankControl:team.flankControl, finalThirdControl:team.finalThirdControl, boxPresence:team.boxPresence, connectionQuality:team.connectionQuality, exploitableZones:team.exploitableZones })),
      chains:v2.rawChains,
    },
  };
}

try {
  const { config, start, count } = workerData;
  const aggregate = { matches:0, v1:{ goals:0, shots:0, shotsOnTarget:0, xg:0, draws:0 }, v2:{ possessions:0, xg:0, goals:0, shots:0, shotsOnTarget:0, corners:0, saves:0, blockedShots:0, offsides:0, terminalOutcomes:{}, turnoverDefenderRoles:{}, turnoverBands:{}, startZones:{}, endZones:{}, routeTypes:{}, discipline:{}, injuries:{}, defensiveActions:{}, independentEvents:{}, sources:{}, stages:{}, matchExecution:{}, shotQuality:{}, shotTypes:{}, goalBodyParts:{}, matchDistribution:{}, goalMinutes:{}, xgCalibration:{}, possessionDistribution:{} }, dimensions:{}, headToHead:{} };
  const rawMatchSamples = [];
  const progressInterval = Math.max(1, Number(config.progressIntervalMatches ?? 1));
  for (let index = start; index < start + count; index += 1) {
    const seed = `${config.seed}:paired:${index}`;
    const ecosystemRng = createS4BalanceRng(seed);
    const scenario = v2ScenarioForMatch(config, index);
    const scenarioSides = scenario ? [scenario.home, scenario.away] : null;
    const independentScenarioArchetypes = scenario && config.scenarioMatrix?.archetypePairing === "independentWeighted";
    const archetypes = scenarioSides && !independentScenarioArchetypes
      ? scenarioSides.map((side) => side.archetype)
      : [pickS4BalanceArchetype(ecosystemRng, config.ecosystemWeights), pickS4BalanceArchetype(ecosystemRng, config.ecosystemWeights)];
    const scenarioBuildSeed = scenario ? `${config.seed}:scenario:${scenario.scenarioIndex}:archetype-cycle:${Math.floor(scenario.repetition / (config.scenarioMatrix.mirrorHomeAway === false ? 1 : 2))}` : seed;
    const seats = archetypes.map((archetype, sideIndex) => {
      if (!scenario) return buildS4BalanceSeat(seed, sideIndex === 0 ? "home" : "away", archetype);
      const side = scenarioSides[sideIndex];
      const seat = buildS4BalanceSeat(scenarioBuildSeed, side.sourceSide, archetype, v2ScenarioSeatOptions(config.scenarioMatrix, side));
      seat.simulationScenarioId = scenario.id;
      seat.simulationScenarioSuite = scenario.suiteId;
      seat.simulationScenarioCategory = scenario.category;
      seat.simulationScenarioTags = scenario.tags;
      return seat;
    });
    let report;
    if (config.v2Only) {
      const weather = scenario?.environment?.weather ?? pickS4BalanceArchetype(ecosystemRng, V2_MATCH_PARAMETERS.environment.weatherWeights);
      const referee = scenario?.environment?.referee ?? pickS4BalanceArchetype(ecosystemRng, V2_MATCH_PARAMETERS.environment.refereeWeights);
      report = { score:[0, 0], weather:{ key:weather }, referee:{ key:referee }, teams:[{ stats:{ xg:0 } }, { stats:{ xg:0 } }] };
    } else {
      const match = createVersusMatch(seats, { now:0, seed, competitionMode:"league", regulationOnly:true, recordEvents:false });
      advanceVersusMatch(match, REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS);
      report = match.report;
    }
    const v2 = runV2Match(seats, config, seed, { weather:report.weather.key, referee:report.referee.key });
    v2.config = config;
    addMatch(aggregate, report, seats, archetypes, v2);
    if (index < Number(config.rawMatchSampleLimit ?? 0)) rawMatchSamples.push(rawSample(index, seed, seats, archetypes, report, v2, scenario));
    const completed = index - start + 1;
    if (completed % progressInterval === 0 || completed === count) parentPort.postMessage({ type:"progress", completed, total:count });
  }
  parentPort.postMessage({ type:"result", aggregate, rawMatchSamples });
} catch (error) {
  parentPort.postMessage({ error:{ name:error.name, message:error.message, stack:error.stack } });
}
