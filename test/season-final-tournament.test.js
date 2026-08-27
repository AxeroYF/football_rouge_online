import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSeasonFinalSeedSnapshot, createSeasonFinalBracket, createSeasonFinalState, cupSeedPoints, positionLine, SEASON_FINAL_RULES, SEASON_FINAL_SCHEDULE_MINUTES, validateFinalBanSelection } from "../versus/season-final-tournament.js";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { REAL_PLAYERS } from "../versus/player-pool.js";

const teams = Array.from({ length: 10 }, (_, index) => ({ id: `T${index + 1}`, name: `队${index + 1}`, ownerId: index === 9 ? null : `u${index + 1}` }));

function completeCompetitions(service, cupCompletedAt = 123) {
  service.state.teams.slice(0, 9).forEach((team, index) => { team.ownerId = `player-${index + 1}`; });
  service.state.season.currentRound = 15;
  service.state.cup.status = "completed";
  service.state.cup.completedAt = cupCompletedAt;
  service.state.cup.participants = service.state.teams.map((team) => team.id);
  service.state.cup.table = Object.fromEntries(service.state.teams.map((team, index) => [team.id, { seed:index + 1, status:index < 8 ? "qualified" : "eliminated" }]));
  service.state.cup.knockout.final = [{ teams:[service.state.teams[0].id, service.state.teams[1].id], winnerId:service.state.teams[0].id, legs:[] }];
}

function hydrateHumanRosters(service, fitness = 100) {
  const pools = Object.fromEntries(["GK","DEF","MID","ATT"].map((pool) => [pool, REAL_PLAYERS.filter((player) => player.pool === pool)]));
  service.state.teams.forEach((team, index) => {
    const take = (pool, count) => pools[pool].slice(index * count, (index + 1) * count);
    const roster = [...take("GK", 2), ...take("DEF", 7), ...take("MID", 7), ...take("ATT", 6)];
    const starters = [roster[0], ...roster.slice(2, 6), ...roster.slice(9, 12), ...roster.slice(16, 19)];
    team.ownerId = `player-${index + 1}`;
    team.rosterIds = roster.map((player) => player.id);
    team.preferredStarterIds = starters.map((player) => player.id);
    team.playerState = Object.fromEntries(roster.map((player) => [player.id, { fitness, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 }]));
  });
}

test("season final seed snapshot keeps AI at seed 10 and persists tiebreak inputs", () => {
  const snapshot = buildSeasonFinalSeedSnapshot(teams, Object.fromEntries(teams.map((team, index) => [team.id, index + 1])), Object.fromEntries(teams.map((team) => [team.id, { stage: "group", groupRank: 1 }])));
  assert.equal(snapshot.length, 10);
  assert.equal(snapshot.at(-1).seed, 10);
  assert.equal(snapshot.at(-1).isAi, true);
  assert.equal(snapshot[0].leagueRank, 1);
  assert.match(snapshot[0].tiebreak, /teamId/);
});

test("cup stage ordering and non-standard bracket are deterministic", () => {
  assert.deepEqual({ leagueWeight:SEASON_FINAL_RULES.leagueWeight, cupWeight:SEASON_FINAL_RULES.cupWeight }, { leagueWeight:0.5, cupWeight:0.5 });
  assert.deepEqual(["champion", "finalist", "semifinal", "quarterfinal", "knockout", "group", "entered"].map((stage) => cupSeedPoints({ stage }).points), [10, 8, 6, 4, 4, 2, 0]);
  const snapshot = buildSeasonFinalSeedSnapshot(teams, Object.fromEntries(teams.map((team) => [team.id, 1])), Object.fromEntries(teams.map((team) => [team.id, { stage: "group", groupRank: 1 }])));
  const bracket = createSeasonFinalBracket(snapshot);
  assert.deepEqual(bracket.slice(0, 5).map((node) => [node.id, node.home, node.away]), [["W1", "T2", "T3"], ["W2", "T1", "W1.winner"], ["B1", "T5", "T10"], ["B2", "T6", "T9"], ["B3", "T7", "T8"]]);
  assert.deepEqual(bracket.slice(-2).map((node) => [node.home, node.away]), [["W2.winner", "B8.winner"], ["B8.winner", "W2.winner"]]);
});

test("season final composite score weighs league and cup equally", () => {
  const snapshot = buildSeasonFinalSeedSnapshot(teams, Object.fromEntries(teams.map((team, index) => [team.id, index + 1])), {
    T1:{ stage:"group", groupRank:1 },
    T2:{ stage:"champion", groupRank:2 },
  });
  assert.equal(snapshot.find((entry) => entry.teamId === "T1").compositeScore, 6);
  assert.equal(snapshot.find((entry) => entry.teamId === "T2").compositeScore, 9.5);
  assert.equal(snapshot[0].teamId, "T2");
});

test("final ban selection enforces one attacker, midfielder and defender", () => {
  assert.equal(positionLine("GK"), "GK");
  const players = [{ id: "a", position: "ST" }, { id: "m", position: "CM" }, { id: "d", position: "CB" }, { id: "g", position: "GK" }];
  assert.equal(validateFinalBanSelection({ forward: "a", midfield: "m", defense: "d" }, players).valid, true);
  assert.equal(validateFinalBanSelection({ forward: "a", midfield: "a", defense: "d" }, players).valid, false);
  assert.equal(validateFinalBanSelection({ forward: "g", midfield: "m", defense: "d" }, players).valid, false);
});

test("season final state retains a complete seed snapshot and bracket", () => {
  const state = createSeasonFinalState({ id: "S1-final", seasonId: "S1", teams, leagueRanks: Object.fromEntries(teams.map((team, index) => [team.id, index + 1])), cupResults: {}, createdAt: 123, scheduleAnchorAt:1000 });
  assert.equal(state.status, "scheduled");
  assert.equal(state.createdAt, 123);
  assert.equal(state.nextMatchAt, 1000 + 20 * 60 * 1000);
  assert.equal(state.finalBanDeadlineAt, 1000 + 110 * 60 * 1000);
  assert.equal(state.seedSnapshot.length, 10);
  assert.equal(state.bracket.length, 12);
  assert.equal(state.finalTie.championId, null);
});

test("season final schedule is anchored to the cup final and preserves the required waves", () => {
  const cupFinalAt = Date.UTC(2026, 7, 20, 6, 30);
  const state = createSeasonFinalState({ id:"S1-final", seasonId:"S1", teams, leagueRanks:Object.fromEntries(teams.map((team, index) => [team.id, index + 1])), cupResults:{}, createdAt:cupFinalAt, scheduleAnchorAt:cupFinalAt });
  const scheduledAt = Object.fromEntries(state.bracket.map((node) => [node.id, node.scheduledAt]));
  Object.entries(SEASON_FINAL_SCHEDULE_MINUTES).forEach(([id, minutes]) => assert.equal(scheduledAt[id], cupFinalAt + minutes * 60 * 1000));
  assert.deepEqual(["W1","B1","B2","B3"].map((id) => scheduledAt[id]), Array(4).fill(Date.UTC(2026, 7, 20, 6, 50)));
  assert.deepEqual(["W2","B4","B5"].map((id) => scheduledAt[id]), Array(3).fill(Date.UTC(2026, 7, 20, 7, 10)));
  assert.equal(scheduledAt.B6, Date.UTC(2026, 7, 20, 7, 30));
  assert.equal(scheduledAt.B7, Date.UTC(2026, 7, 20, 7, 50));
  assert.equal(scheduledAt.B8, Date.UTC(2026, 7, 20, 8, 10));
  assert.equal(scheduledAt["FINAL-1"], Date.UTC(2026, 7, 20, 8, 30));
  assert.equal(scheduledAt["FINAL-2"], Date.UTC(2026, 7, 20, 8, 40));
  assert.equal(state.finalBanDeadlineAt, Date.UTC(2026, 7, 20, 8, 20));
});

test("a delayed cup final shifts every season-final time by the same amount", () => {
  const firstAnchor = 10_000_000;
  const delay = 37 * 60 * 1000;
  const make = (scheduleAnchorAt) => createSeasonFinalState({ id:`S-${scheduleAnchorAt}`, seasonId:"S", teams, leagueRanks:Object.fromEntries(teams.map((team, index) => [team.id, index + 1])), cupResults:{}, createdAt:scheduleAnchorAt, scheduleAnchorAt });
  const normal = make(firstAnchor); const delayed = make(firstAnchor + delay);
  normal.bracket.forEach((node, index) => assert.equal(delayed.bracket[index].scheduledAt - node.scheduledAt, delay));
  assert.equal(delayed.finalBanDeadlineAt - normal.finalBanDeadlineAt, delay);
});

test("a completed cup anchors the season final to the final kickoff rather than full-time", () => {
  const finalStartedAt = Date.UTC(2026, 7, 20, 6, 30);
  const finalCompletedAt = finalStartedAt + 2 * 60 * 1000 + 12_000;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => finalCompletedAt });
  completeCompetitions(service, finalCompletedAt);
  service.state.cup.finalStartedAt = finalStartedAt;
  service.state.cup.events = [{ id:"cup-final-leg1", stage:"final", status:"complete", startedAt:finalStartedAt }];
  const tournament = service.ensureSeasonFinalTournament();
  const scheduledAt = Object.fromEntries(tournament.bracket.map((node) => [node.id, node.scheduledAt]));
  assert.equal(tournament.scheduleAnchorAt, finalStartedAt);
  assert.equal(scheduledAt.W1, Date.UTC(2026, 7, 20, 6, 50));
  assert.equal(scheduledAt.W2, Date.UTC(2026, 7, 20, 7, 10));
  assert.equal(scheduledAt.B6, Date.UTC(2026, 7, 20, 7, 30));
  assert.equal(scheduledAt.B7, Date.UTC(2026, 7, 20, 7, 50));
  assert.equal(scheduledAt.B8, Date.UTC(2026, 7, 20, 8, 10));
  assert.equal(scheduledAt["FINAL-1"], Date.UTC(2026, 7, 20, 8, 30));
  assert.equal(scheduledAt["FINAL-2"], Date.UTC(2026, 7, 20, 8, 40));
  assert.equal(tournament.finalBanDeadlineAt, Date.UTC(2026, 7, 20, 8, 20));
});

test("an actually delayed cup-final kickoff remains the season-final anchor", () => {
  const delayedKickoffAt = Date.UTC(2026, 7, 20, 6, 37);
  const service = new YellowDogsLeagueService({ statePath:null, now:() => delayedKickoffAt + 150_000 });
  completeCompetitions(service, delayedKickoffAt + 150_000);
  service.state.cup.finalStartedAt = delayedKickoffAt;
  const tournament = service.ensureSeasonFinalTournament();
  assert.equal(tournament.bracket.find((node) => node.id === "W1").scheduledAt, delayedKickoffAt + 20 * 60 * 1000);
  assert.equal(tournament.bracket.find((node) => node.id === "FINAL-1").scheduledAt, delayedKickoffAt + 120 * 60 * 1000);
});

test("a legacy completed V2 cup recovers its kickoff from the final match duration", () => {
  const finalStartedAt = Date.UTC(2026, 7, 20, 6, 30);
  const finalPlayedAt = finalStartedAt + 120_000;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => finalPlayedAt });
  completeCompetitions(service, finalPlayedAt);
  const finalMatchId = "legacy-cup-final";
  service.state.cup.knockout.final[0].legs = [{ id:"cup-final-leg1", number:1, matchId:finalMatchId }];
  service.state.matches.push({ id:finalMatchId, competition:"cup", cupStage:"final", playedAt:finalPlayedAt, report:{ engineVersion:"2.1.0", extraTimePlayed:false, penaltyShootout:null } });
  const tournament = service.ensureSeasonFinalTournament();
  assert.equal(tournament.scheduleAnchorAt, finalStartedAt);
  assert.equal(tournament.bracket.find((node) => node.id === "W1").scheduledAt, Date.UTC(2026, 7, 20, 6, 50));
  assert.equal(tournament.bracket.find((node) => node.id === "FINAL-1").scheduledAt, Date.UTC(2026, 7, 20, 8, 30));
});

test("preview bracket follows the projected cup final instead of the page-open time", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 999 });
  const firstCupAt = 10_000_000;
  service.state.cup.status = "active";
  service.state.cup.stage = "league";
  service.state.cup.nextRoundAt = firstCupAt;
  service.state.cup.events = Array.from({ length:9 }, (_, index) => ({ id:`cup-league-${index + 1}`, stage:"league", leg:1, status:"pending" }));
  const firstView = service.seasonFinalTournamentView();
  const projectedFinalAt = firstCupAt + 13 * 20 * 60 * 1000;
  assert.equal(firstView.scheduleAnchorAt, projectedFinalAt);
  assert.equal(firstView.bracket.find((node) => node.id === "W1").startsAt, projectedFinalAt + 20 * 60 * 1000);
  service.state.cup.nextRoundAt += 7 * 60 * 1000;
  const shiftedView = service.seasonFinalTournamentView();
  assert.equal(shiftedView.bracket.find((node) => node.id === "W1").startsAt - firstView.bracket.find((node) => node.id === "W1").startsAt, 7 * 60 * 1000);
});

test("the cup final freezes the most recently completed league round", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  service.state.teams.forEach((team, index) => { team.table.points = 30 - index; });
  completeCompetitions(service, 123);
  service.state.season.currentRound = 14;
  const tournament = service.ensureSeasonFinalTournament();
  const firstTeamId = service.state.teams[0].id;
  const locked = service.state.season.seasonFinalLeagueRanks;
  service.state.teams[0].table.points = -100;
  service.state.season.currentRound = 16;
  service.ensureSeasonFinalTournament();
  assert.equal(tournament.leagueSnapshotRound, 14);
  assert.equal(tournament.seedSnapshot.find((entry) => entry.teamId === firstTeamId).leagueRank, 1);
  assert.equal(service.state.season.seasonFinalLeagueRanks, locked);
});

test("the first season-final wave starts W1, B1, B2 and B3 together", () => {
  const cupFinalAt = 20_000_000;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => cupFinalAt + 20 * 60 * 1000 });
  completeCompetitions(service, cupFinalAt);
  service.fixtureConditions = () => ({ weather:{ key:"superStorm" }, referee:{ key:"standard" } });
  const tournament = service.ensureSeasonFinalTournament();
  const due = service.dueSeasonFinalNodes(tournament);
  assert.deepEqual(due.map((node) => node.id), ["W1","B1","B2","B3"]);
  assert.equal(service.startSeasonFinalWave(due, tournament), true);
  assert.deepEqual(tournament.bracket.filter((node) => node.status === "running").map((node) => node.id), ["W1","B1","B2","B3"]);
  assert.equal(service.state.liveSeasonFinalRound.matches.length, 4);
  assert.equal(service.state.liveSeasonFinalRound.matches.every((live) => live.match.environment.weather === "storm" && live.match.superStormStopMinute === null), true);
  assert.equal(tournament.nextMatchAt, cupFinalAt + 40 * 60 * 1000);
});

test("a season-final wave advances every simultaneous live match beyond the opening minute", () => {
  const cupFinalAt = Date.UTC(2026, 7, 20, 6, 30);
  let now = cupFinalAt + 20 * 60 * 1000;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now });
  service.state.season.date = "2026-08-20";
  completeCompetitions(service, cupFinalAt);
  hydrateHumanRosters(service, 100);
  const tournament = service.ensureSeasonFinalTournament();
  assert.equal(service.startSeasonFinalWave(service.dueSeasonFinalNodes(tournament), tournament), true);
  const liveMatches = [...service.state.liveSeasonFinalRound.matches];
  assert.equal(liveMatches.every((live) => live.match.teams.every((team) => team.players.filter((player) => player.active).length === 11)), true);

  now += 20_000;
  assert.equal(service.advanceLiveSeasonFinalRound(now, { maximumChainsPerMatch:Infinity, persist:false }), true);
  assert.equal(liveMatches.every((live) => Number(live.match.nextChainIndex) >= 5 && Number(live.match.minute) > 1 && !live.match.abandoned), true);
});

test("FINAL-1 refreshes finalist injuries and fitness exactly once while retaining cup suspensions", () => {
  const cupFinalAt = Date.UTC(2026, 7, 20, 6, 30);
  const finalStartsAt = cupFinalAt + 120 * 60 * 1000;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => finalStartsAt });
  completeCompetitions(service, cupFinalAt);
  service.state.cup.finalStartedAt = cupFinalAt;
  hydrateHumanRosters(service, 37);
  const tournament = service.ensureSeasonFinalTournament();
  const homeId = service.state.teams[0].id;
  const awayId = service.state.teams[1].id;
  const upperFinal = tournament.bracket.find((node) => node.id === "W2");
  const lowerFinal = tournament.bracket.find((node) => node.id === "B8");
  upperFinal.status = "complete";
  upperFinal.winner = homeId;
  lowerFinal.status = "complete";
  lowerFinal.winner = awayId;
  [homeId, awayId].forEach((teamId) => {
    const team = service.state.teams.find((entry) => entry.id === teamId);
    team.rosterIds.forEach((playerId) => { team.playerState[playerId].injuryRounds = 3; });
    team.playerState[team.rosterIds.at(-1)].cupSuspension = 1;
  });
  const finalNode = tournament.bracket.find((node) => node.id === "FINAL-1");
  assert.equal(service.startSeasonFinalNode(finalNode, tournament), true);
  assert.equal(tournament.stateRefreshAt, finalStartsAt);
  assert.deepEqual(tournament.stateRefreshTeamIds, [homeId, awayId]);
  [homeId, awayId].forEach((teamId) => {
    const team = service.state.teams.find((entry) => entry.id === teamId);
    assert.equal(team.rosterIds.every((playerId) => team.playerState[playerId].fitness === 100), true);
    assert.equal(team.rosterIds.every((playerId) => team.playerState[playerId].injuryRounds === 0), true);
    assert.equal(team.playerState[team.rosterIds.at(-1)].cupSuspension, 1);
    assert.equal(team.fitnessUpdatedAt, finalStartsAt);
  });
  const home = service.state.teams.find((team) => team.id === homeId);
  const samplePlayerId = home.rosterIds[0];
  home.playerState[samplePlayerId].fitness = 44;
  home.playerState[samplePlayerId].injuryRounds = 2;
  assert.equal(service.refreshSeasonFinalists(tournament, [homeId, awayId], finalStartsAt + 1), false);
  assert.equal(home.playerState[samplePlayerId].fitness, 44);
  assert.equal(home.playerState[samplePlayerId].injuryRounds, 2);
});

test("a sharded legacy season-final live round migrates to the live scope and advances V2 chains", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-season-final-live-shard-"));
  const statePath = path.join(directory, "league-state");
  const cupFinalAt = Date.UTC(2026, 7, 20, 6, 30);
  let now = cupFinalAt + 20 * 60 * 1000;
  try {
    const service = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => now });
    service.state.season.date = "2026-08-20";
    completeCompetitions(service, cupFinalAt);
    hydrateHumanRosters(service, 100);
    service.state.teams.forEach((team) => team.rosterIds.forEach((playerId) => service.grantS4Card(team, playerId, { grantOwnership:true, acquisitionSource:"season-final-shard-test" })));
    const tournament = service.ensureSeasonFinalTournament();
    const dueNodes = service.dueSeasonFinalNodes(tournament);
    const expectedLiveCount = dueNodes.length;
    assert.equal(expectedLiveCount > 0, true);
    assert.equal(service.startSeasonFinalWave(dueNodes, tournament), true);
    assert.equal(service.state.liveSeasonFinalRound.matches.length, expectedLiveCount);
    service.save({ forceFull:true, skipDailyBackup:true });

    const manifest = service.shardStore.manifest;
    const corePath = path.join(statePath, manifest.shards.core);
    const livePath = path.join(statePath, manifest.shards.live);
    const legacyCore = JSON.parse(readFileSync(corePath, "utf8"));
    const legacyLive = JSON.parse(readFileSync(livePath, "utf8"));
    assert.equal(legacyLive.liveSeasonFinalRound.matches.length, expectedLiveCount);
    legacyCore.liveSeasonFinalRound = legacyLive.liveSeasonFinalRound;
    delete legacyLive.liveSeasonFinalRound;
    writeFileSync(corePath, JSON.stringify(legacyCore), "utf8");
    writeFileSync(livePath, JSON.stringify(legacyLive), "utf8");

    const reloaded = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => now });
    assert.equal(reloaded.state.liveSeasonFinalRound.matches.length, expectedLiveCount);
    reloaded.save({ scopes:["core"], skipDailyBackup:true });
    const migratedManifest = reloaded.shardStore.manifest;
    const migratedCore = JSON.parse(readFileSync(path.join(statePath, migratedManifest.shards.core), "utf8"));
    const migratedLive = JSON.parse(readFileSync(path.join(statePath, migratedManifest.shards.live), "utf8"));
    assert.equal(Object.hasOwn(migratedCore, "liveSeasonFinalRound"), false);
    assert.equal(migratedLive.liveSeasonFinalRound.matches.length, expectedLiveCount);

    const liveMatches = [...reloaded.state.liveSeasonFinalRound.matches];
    now += 20_000;
    assert.doesNotThrow(() => reloaded.advanceLiveSeasonFinalRound(now, { maximumChainsPerMatch:Infinity, persist:false }));
    assert.equal(liveMatches.every((live) => Number(live.match.nextChainIndex) >= 5 && Number(live.match.minute) > 1), true);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

test("service locks the tournament from the latest completed round when the cup final ends", () => {
  const service = new YellowDogsLeagueService({ statePath: null, now: () => 123 });
  service.state.teams.slice(0, 9).forEach((team, index) => { team.ownerId = `player-${index + 1}`; });
  service.state.season.currentRound = 14;
  const preview = service.seasonFinalTournamentView();
  assert.equal(preview.preview, true);
  assert.equal(preview.bracket.length, 12);
  assert.equal(preview.seedSnapshot[0].teamName, "1号种子");
  service.state.cup.status = "completed";
  service.state.cup.completedAt = 123;
  service.state.cup.participants = service.state.teams.map((team) => team.id);
  service.state.cup.table = Object.fromEntries(service.state.teams.map((team, index) => [team.id, { seed: index + 1, status: "eliminated" }]));
  service.state.cup.knockout.final = [{ teams: ["team-1", "team-2"], winnerId: "team-1" }];
  const view = service.seasonFinalTournamentView();
  assert.equal(Boolean(view.preview), false);
  assert.equal(view.status, "scheduled");
  assert.equal(view.leagueSnapshotRound, 14);
  assert.equal(view.seedSnapshot.length, 10);
  assert.equal(view.seedSnapshot.find((entry) => entry.seed === 10).isAi, true);
});

test("Ballon d'Or waits for the season final to finish", () => {
  const service = new YellowDogsLeagueService({ statePath: null, now: () => 123 });
  service.state.season.status = "completed";
  service.state.cup.status = "completed";
  service.state.seasonFinalTournament = { status: "running", finalTie: { championId: null } };
  assert.equal(service.settleBallonDor(), null);
});

test("service resolves the complete double-elimination path through both final legs", () => {
  const service = new YellowDogsLeagueService({ statePath: null, now: () => 123 });
  service.state.teams.slice(0, 9).forEach((team, index) => { team.ownerId = `player-${index + 1}`; });
  service.state.season.status = "completed";
  service.state.cup.status = "completed";
  service.state.cup.completedAt = 123;
  service.state.cup.participants = service.state.teams.map((team) => team.id);
  service.state.cup.table = Object.fromEntries(service.state.teams.map((team, index) => [team.id, { seed: index + 1, status: "eliminated" }]));
  service.state.cup.knockout.final = [{ teams: ["team-1", "team-2"], winnerId: "team-1" }];
  const tournament = service.ensureSeasonFinalTournament();
  const settle = (id, score = [2, 1]) => {
    const node = tournament.bracket.find((entry) => entry.id === id);
    service.completeSeasonFinalNode(node, { report: { score } }, tournament);
  };
  ["W1", "B1", "B2", "B3", "W2", "B4", "B5", "B6", "B7", "B8"].forEach((id) => settle(id));
  settle("FINAL-1", [1, 0]);
  settle("FINAL-2", [0, 1]);
  assert.equal(tournament.status, "completed");
  assert.equal(tournament.matches.length, 12);
  assert.equal(tournament.finalTie.championId, tournament.bracket.find((node) => node.id === "W2").winner);
});

test("season final awards the cup-equivalent finalist packs and permanently accumulates champion stars", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  completeCompetitions(service);
  service.state.season.status = "completed";
  service.settleBallonDor = () => null;
  const tournament = service.ensureSeasonFinalTournament();
  const champion = service.state.teams[0];
  const runnerUp = service.state.teams[1];
  const championOwnerId = champion.ownerId;
  const runnerUpOwnerId = runnerUp.ownerId;
  tournament.bracket.find((node) => node.id === "W2").winner = champion.id;
  tournament.bracket.find((node) => node.id === "B8").winner = runnerUp.id;
  tournament.finalTie.winnerBracketChampionId = champion.id;
  tournament.finalTie.loserBracketChampionId = runnerUp.id;
  const first = tournament.bracket.find((node) => node.id === "FINAL-1");
  first.score = [1, 0];
  first.status = "complete";
  const second = tournament.bracket.find((node) => node.id === "FINAL-2");

  service.completeSeasonFinalNode(second, { teams:[{ id:runnerUp.id }, { id:champion.id }], report:{ score:[0, 1] } }, tournament);

  assert.equal(tournament.status, "completed");
  assert.equal(tournament.finalTie.championId, champion.id);
  assert.equal(service.s4PackInventory(championOwnerId).filter((item) => item.packType === "admin-legend-choice-plus2" && item.source === "season-final").length, 1);
  assert.equal(service.s4PackInventory(runnerUpOwnerId).filter((item) => item.packType === "admin-legend-choice-plus1" && item.source === "season-final").length, 1);
  assert.equal(champion.seasonFinalChampionStars.length, 1);
  assert.equal(champion.seasonFinalChampionStars[0].tournamentId, tournament.id);
  assert.equal(service.adminView().teams.find((team) => team.id === champion.id).seasonFinalStarCount, 1);
  assert.equal(service.cupStandings().find((team) => team.id === champion.id).seasonFinalStarCount, 1);
  assert.equal(service.grantSeasonFinalPlacementReward(champion.id, tournament, "champion"), null);
  service.awardSeasonFinalChampionStar(champion.id, tournament);
  assert.equal(champion.seasonFinalChampionStars.length, 1);

  service.awardSeasonFinalChampionStar(champion.id, { id:"next-season-final", seasonId:"next-season" });
  assert.equal(champion.seasonFinalChampionStars.length, 2);
  service.state.dailyAutomation.lastRewardedSeasonId = service.state.season.id;
  service.resetDailyCompetitions({ manual:true, skipRewardCheck:true, skipBackup:true, skipHonorRoomUpdate:true, skipArchive:true, skipSave:true, skipView:true });
  assert.equal(service.state.teams.find((team) => team.id === champion.id).seasonFinalChampionStars.length, 2);
  assert.equal(service.adminView().teams.find((team) => team.id === champion.id).seasonFinalStarCount, 2);
});

test("league and cup standings render every accumulated season-final champion star after the team name", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /seasonFinalStarMarkup\(team\.seasonFinalStarCount\)/);
  assert.match(appSource, /"★"\.repeat\(count\)/);
  assert.match(cssSource, /\.season-final-champion-stars\{/);
});

test("preview bracket never starts from the server tick", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  assert.doesNotThrow(() => service.tick());
  assert.equal(service.state.seasonFinalTournament.preview, true);
  assert.equal(service.state.liveSeasonFinalRound, null);
  assert.equal(service.state.seasonFinalTournament.bracket.every((node) => node.status === "pending"), true);
});

test("an expired competition day cancels an accidentally resumed season final and never starts yesterday's bracket", () => {
  const previousDayCupFinalAt = Date.UTC(2026, 7, 20, 6, 30);
  const nextDayBeforeReset = Date.UTC(2026, 7, 20, 16, 9);
  const service = new YellowDogsLeagueService({ statePath:null, now:() => nextDayBeforeReset });
  service.state.season.date = "2026-08-20";
  service.state.season.status = "completed";
  completeCompetitions(service, previousDayCupFinalAt);
  const tournament = createSeasonFinalState({
    id:`${service.state.season.id}-final`,
    seasonId:service.state.season.id,
    teams:service.state.teams,
    leagueRanks:Object.fromEntries(service.state.teams.map((team, index) => [team.id, index + 1])),
    cupResults:{},
    createdAt:previousDayCupFinalAt,
    scheduleAnchorAt:previousDayCupFinalAt,
  });
  tournament.status = "running";
  tournament.bracket.find((node) => node.id === "W1").status = "running";
  service.state.seasonFinalTournament = tournament;
  service.state.liveSeasonFinalRound = { tournamentId:tournament.id, startedAt:nextDayBeforeReset, matches:[] };

  assert.equal(service.advanceLiveSeasonFinalRound(nextDayBeforeReset, { persist:false }), true);
  assert.equal(tournament.status, "cancelled");
  assert.equal(tournament.cancellationReason, "competition-day-expired");
  assert.equal(tournament.nextMatchAt, null);
  assert.equal(service.state.liveSeasonFinalRound, null);
  assert.deepEqual(service.dueSeasonFinalNodes(tournament, nextDayBeforeReset), []);
});

test("an expired completed season may reset at 09:51 even when its season final was cancelled", () => {
  const resetAt = Date.UTC(2026, 7, 21, 1, 51);
  const service = new YellowDogsLeagueService({ statePath:null, now:() => resetAt });
  const previousSeasonId = service.state.season.id;
  service.state.season.date = "2026-08-20";
  service.state.season.status = "completed";
  service.state.cup.status = "completed";
  service.state.seasonFinalTournament = { id:"expired-final", seasonId:previousSeasonId, status:"cancelled", preview:false, bracket:[], matches:[] };
  service.state.dailyAutomation.lastRewardedSeasonId = previousSeasonId;

  assert.equal(service.resetDailyCompetitions({ skipBackup:true, skipHonorRoomUpdate:true, skipArchive:true, skipSave:true, skipView:true }), true);
  assert.equal(service.state.season.date, "2026-08-21");
  assert.notEqual(service.state.season.id, previousSeasonId);
  assert.equal(service.state.seasonFinalTournament, null);
});

test("daily reset clears the previous season final", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  const previousSeasonId = service.state.season.id;
  service.state.season.status = "completed";
  service.state.cup.status = "completed";
  service.state.seasonFinalTournament = { id:"old-final", seasonId:previousSeasonId, status:"completed", preview:false, finalTie:{ championId:"ydl-team-1" }, seedSnapshot:[], bracket:[], matches:[] };
  service.state.dailyAutomation.lastRewardedSeasonId = previousSeasonId;
  service.resetDailyCompetitions({ manual:true, skipRewardCheck:true, skipBackup:true, skipHonorRoomUpdate:true, skipArchive:true, skipSave:true, skipView:true });
  assert.equal(service.state.seasonFinalTournament, null);
  assert.equal(service.state.liveSeasonFinalRound, null);
  assert.notEqual(service.state.season.id, previousSeasonId);
});

test("season final seeding distinguishes semifinalists and quarterfinalists", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  completeCompetitions(service);
  const ids = service.state.teams.map((team) => team.id);
  service.state.cup.knockout.quarterfinals = [[0,1],[2,3],[4,5],[6,7]].map(([left,right]) => ({ teams:[ids[left], ids[right]], winnerId:ids[left] }));
  service.state.cup.knockout.semifinals = [{ teams:[ids[0], ids[2]], winnerId:ids[0] }, { teams:[ids[4], ids[6]], winnerId:ids[4] }];
  service.state.cup.knockout.final = [{ teams:[ids[0], ids[4]], winnerId:ids[0] }];
  const snapshot = service.ensureSeasonFinalTournament().seedSnapshot;
  assert.deepEqual({ stage:snapshot.find((entry) => entry.teamId === ids[2]).cupStage, points:snapshot.find((entry) => entry.teamId === ids[2]).cupPoints }, { stage:"semifinal", points:6 });
  assert.deepEqual({ stage:snapshot.find((entry) => entry.teamId === ids[1]).cupStage, points:snapshot.find((entry) => entry.teamId === ids[1]).cupPoints }, { stage:"quarterfinal", points:4 });
});

test("aggregate tie uses the second-leg shootout winner", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  completeCompetitions(service);
  const tournament = service.ensureSeasonFinalTournament();
  const winnerBracketTeamId = service.state.teams[0].id;
  const loserBracketTeamId = service.state.teams[1].id;
  tournament.bracket.find((node) => node.id === "W2").winner = winnerBracketTeamId;
  tournament.bracket.find((node) => node.id === "B8").winner = loserBracketTeamId;
  tournament.finalTie.winnerBracketChampionId = winnerBracketTeamId;
  tournament.finalTie.loserBracketChampionId = loserBracketTeamId;
  const first = tournament.bracket.find((node) => node.id === "FINAL-1");
  first.score = [1, 0];
  first.status = "complete";
  const second = tournament.bracket.find((node) => node.id === "FINAL-2");
  service.completeSeasonFinalNode(second, { teams:[{ id:loserBracketTeamId }, { id:winnerBracketTeamId }], report:{ score:[1, 0], penalties:[3, 5] } }, tournament);
  assert.deepEqual(tournament.finalTie.aggregateScore, [1, 1]);
  assert.equal(tournament.finalTie.championId, winnerBracketTeamId);
  assert.equal(tournament.finalTie.penalties, true);
});

test("live season final is discoverable through broadcasts and watch lookup", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  completeCompetitions(service);
  const tournament = service.ensureSeasonFinalTournament();
  const node = service.nextSeasonFinalNode(tournament);
  assert.equal(service.startSeasonFinalNode(node, tournament), true);
  const code = service.state.liveSeasonFinalRound.matches[0].code;
  assert.equal(service.broadcasts().find((entry) => entry.code === code)?.competition, "赛季总决赛");
  assert.equal(service.liveMatch(code).code, code);
  const watched = service.watch(code, "总决赛观众");
  assert.equal(service.watchView(code, watched.spectatorToken).code, code);
  assert.deepEqual(service.leaveWatch(code, watched.spectatorToken), { left:true });
  assert.throws(() => service.watchView(code, watched.spectatorToken), /观赛会话已过期/);
  assert.equal(service.teamSchedule(service.seasonFinalNodeTeamId(tournament, node.home)).some((fixture) => fixture.broadcastCode === code), true);
});

test("resolved bracket slots expose the advancing team name", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  completeCompetitions(service);
  const tournament = service.ensureSeasonFinalTournament();
  const node = tournament.bracket.find((entry) => entry.id === "W1");
  service.completeSeasonFinalNode(node, { report:{ score:[2, 1] } }, tournament);
  const view = service.seasonFinalTournamentView();
  assert.equal(view.bracket.find((entry) => entry.id === "W2").awayName, service.state.teams.find((team) => team.id === node.winner).name);
  const pending = view.bracket.filter((entry) => entry.status === "pending");
  assert.equal(tournament.bracket.find((entry) => entry.id === "W1").scheduledAt, tournament.bracket.find((entry) => entry.id === "B1").scheduledAt);
  assert.equal(tournament.bracket.find((entry) => entry.id === "W2").scheduledAt - tournament.bracket.find((entry) => entry.id === "W1").scheduledAt, 20 * 60 * 1000);
  const finalLegs = view.bracket.filter((entry) => entry.group === "final");
  assert.equal(finalLegs[1].startsAt - finalLegs[0].startsAt, 10 * 60 * 1000);
});

test("season final player output is merged into cup leaderboards exactly once", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  completeCompetitions(service);
  const tournament = service.ensureSeasonFinalTournament();
  const node = tournament.bracket.find((entry) => entry.id === "W1");
  const homeId = service.seasonFinalNodeTeamId(tournament, node.home);
  const awayId = service.seasonFinalNodeTeamId(tournament, node.away);
  const home = service.state.teams.find((team) => team.id === homeId);
  const player = REAL_PLAYERS.find((entry) => entry.role === "ST" && entry.grade !== "X");
  home.rosterIds = [player.id];
  home.playerState[player.id] = { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 };
  const reportPlayer = { id:player.id, name:player.name, role:player.role, position:{ x:50, y:25 }, fitness:80, rating:8.2, stats:{ goals:2, assists:1, saves:0, tackles:1, interceptions:0, clearances:0, blocks:0, pressuresWon:2, yellowCards:0, redCards:1 } };
  const match = { report:{ score:[2, 0], teams:[{ formation:"4-3-3", players:[reportPlayer] }, { formation:"4-4-2", players:[] }], importantEvents:[] } };
  service.completeSeasonFinalNode(node, match, tournament);
  service.completeSeasonFinalNode(node, match, tournament);
  const stat = service.state.cup.playerStats[`${homeId}:${player.id}`];
  assert.deepEqual({ appearances:stat.appearances, goals:stat.goals, assists:stat.assists }, { appearances:1, goals:2, assists:1 });
  assert.equal(service.cupLeaderboards().scorers[0].playerId, player.id);
  assert.ok(home.playerState[player.id].fitness < 100);
  assert.equal(home.playerState[player.id].seasonFinalSuspension, 1);
  assert.equal(service.teamHistory(homeId).some((entry) => entry.competition === "season-final"), true);
});

test("finalists can submit one opponent ban per outfield line", () => {
  let now = 123;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now });
  completeCompetitions(service, now);
  const tournament = service.ensureSeasonFinalTournament();
  const home = service.state.teams[0];
  const away = service.state.teams[1];
  home.ownerId = "ban-owner";
  away.ownerId = null;
  tournament.bracket.find((node) => node.id === "W2").winner = home.id;
  tournament.bracket.find((node) => node.id === "B8").winner = away.id;
  const account = { id:"ban-owner" };
  const banView = service.seasonFinalBanView(account, tournament);
  const selection = Object.fromEntries([["forward","ATT"],["midfield","MID"],["defense","DEF"]].map(([field,line]) => [field, banView.candidates.find((player) => player.line === line).id]));
  const updated = service.submitSeasonFinalBan(account, selection);
  assert.equal(updated.finalBan.submitted, true);
  assert.equal(updated.finalBan.automatic, false);
  assert.deepEqual(updated.finalBan.selection, selection);
  assert.equal(updated.finalBan.deadlineAt, tournament.scheduleAnchorAt + 110 * 60 * 1000);
  assert.deepEqual(service.seasonFinalBanDecision(tournament, "FINAL-2", home.id).selection, selection);
  now = tournament.finalBanDeadlineAt;
  assert.equal(service.seasonFinalBanView(account, tournament).locked, true);
  assert.throws(() => service.submitSeasonFinalBan(account, selection), /提交时间已截止/);
});

test("season-final fixtures feed predictions, pending television and the full resolved club calendar", () => {
  const cupFinalAt = Date.UTC(2026, 7, 20, 6, 30);
  const service = new YellowDogsLeagueService({ statePath:null, now:() => cupFinalAt + 1 });
  completeCompetitions(service, cupFinalAt);
  service.state.cup.finalStartedAt = cupFinalAt;
  const tournament = service.ensureSeasonFinalTournament();
  const predictionEntries = service.nextPredictionFixtures().filter((entry) => entry.competition === "season-final");
  assert.deepEqual(predictionEntries.map((entry) => entry.roundKey).sort(), ["B1", "B2", "B3", "W1"]);
  assert.equal(predictionEntries.every((entry) => entry.matchOptions.availabilityMode === "season-final"), true);
  assert.deepEqual(service.upcomingBroadcasts().filter((entry) => entry.competition === "season-final").map((entry) => entry.label).sort(), ["B1", "B2", "B3", "W1"]);

  const homeId = service.state.teams[0].id;
  const awayId = service.state.teams[1].id;
  tournament.bracket.find((node) => node.id === "W2").winner = homeId;
  tournament.bracket.find((node) => node.id === "B8").winner = awayId;
  const finalSchedule = service.teamSchedule(homeId).filter((fixture) => fixture.competition === "season-final" && fixture.stage === "final");
  assert.deepEqual(finalSchedule.map((fixture) => fixture.label), ["FINAL-1", "FINAL-2"]);
  assert.equal(finalSchedule[1].startsAt - finalSchedule[0].startsAt, 10 * 60 * 1000);
});

test("season-final completion settles its prediction market", () => {
  const cupFinalAt = Date.UTC(2026, 7, 20, 6, 30);
  const service = new YellowDogsLeagueService({ statePath:null, now:() => cupFinalAt + 1 });
  completeCompetitions(service, cupFinalAt);
  service.state.cup.finalStartedAt = cupFinalAt;
  const tournament = service.ensureSeasonFinalTournament();
  const entry = service.nextPredictionFixtures().find((candidate) => candidate.competition === "season-final");
  service.registerPredictionMarket(entry);
  const node = tournament.bracket.find((candidate) => candidate.id === entry.roundKey);
  service.completeSeasonFinalNode(node, { report:{ score:[1, 0], teams:[{ formation:"4-3-3", stats:{ yellowCards:1, redCards:0 }, players:[] }, { formation:"4-4-2", stats:{ yellowCards:0, redCards:0 }, players:[] }], events:[], importantEvents:[] } }, tournament);
  const market = service.state.matchPredictions.markets[entry.id];
  assert.equal(market.status, "settled");
  assert.equal(market.settlement.matchId, tournament.matches[0].id);
  assert.deepEqual(market.settlement.score, [1, 0]);
});

test("confirmed final bans notify both finalists and mark their tactical boards", () => {
  const cupFinalAt = Date.UTC(2026, 7, 20, 6, 30);
  const service = new YellowDogsLeagueService({ statePath:null, now:() => cupFinalAt + 1 });
  completeCompetitions(service, cupFinalAt);
  hydrateHumanRosters(service);
  service.state.teams.forEach((team) => team.rosterIds.forEach((playerId) => service.grantS4Card(team, playerId, { grantOwnership:true, acquisitionSource:"season-final-ban-test" })));
  service.state.cup.finalStartedAt = cupFinalAt;
  const tournament = service.ensureSeasonFinalTournament();
  const home = service.state.teams[0];
  const away = service.state.teams[1];
  tournament.bracket.find((node) => node.id === "W2").winner = home.id;
  tournament.bracket.find((node) => node.id === "B8").winner = away.id;
  const choose = (view) => Object.fromEntries([["forward","ATT"],["midfield","MID"],["defense","DEF"]].map(([field, line]) => [field, view.candidates.find((player) => player.line === line).id]));
  const homeAccount = { id:home.ownerId };
  const awayAccount = { id:away.ownerId };
  const homeSelection = choose(service.seasonFinalBanView(homeAccount, tournament));
  const awaySelection = choose(service.seasonFinalBanView(awayAccount, tournament));
  service.submitSeasonFinalBan(homeAccount, homeSelection);
  assert.equal((service.state.inbox[home.id] ?? []).some((mail) => mail.type === "season-final-ban"), false);
  service.submitSeasonFinalBan(awayAccount, awaySelection);
  assert.equal((service.state.inbox[home.id] ?? []).filter((mail) => mail.type === "season-final-ban").length, 1);
  assert.equal((service.state.inbox[away.id] ?? []).filter((mail) => mail.type === "season-final-ban").length, 1);
  const marked = service.ownTeamView(homeAccount).roster.filter((player) => player.state.seasonFinalBanned).map((player) => player.id).sort();
  assert.deepEqual(marked, Object.values(awaySelection).sort());
});

test("the ban deadline auto-finalizes missing selections and emails both finalists before kickoff", () => {
  const cupFinalAt = Date.UTC(2026, 7, 20, 6, 30);
  let now = cupFinalAt + 1;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now });
  completeCompetitions(service, cupFinalAt);
  hydrateHumanRosters(service);
  service.state.cup.finalStartedAt = cupFinalAt;
  const tournament = service.ensureSeasonFinalTournament();
  const home = service.state.teams[0];
  const away = service.state.teams[1];
  tournament.bracket.find((node) => node.id === "W2").winner = home.id;
  tournament.bracket.find((node) => node.id === "B8").winner = away.id;
  now = tournament.finalBanDeadlineAt;
  assert.equal(service.finalizeSeasonFinalBansIfDue(tournament, now), true);
  assert.equal(tournament.finalBanDecisions.length, 2);
  assert.equal(tournament.finalBanDecisions.every((decision) => decision.automatic), true);
  assert.equal((service.state.inbox[home.id] ?? []).some((mail) => mail.type === "season-final-ban"), true);
  assert.equal((service.state.inbox[away.id] ?? []).some((mail) => mail.type === "season-final-ban"), true);
  assert.ok(now < tournament.bracket.find((node) => node.id === "FINAL-1").scheduledAt);
  assert.equal(service.finalizeSeasonFinalBansIfDue(tournament, now), false);
});

test("cup red cards do not carry into the season final, while FINAL-1 reds suspend FINAL-2", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => 123 });
  completeCompetitions(service);
  hydrateHumanRosters(service);
  const tournament = service.ensureSeasonFinalTournament();
  const home = service.state.teams[0];
  const away = service.state.teams[1];
  const playerId = home.preferredStarterIds[0];
  home.playerState[playerId].cupSuspension = 1;
  assert.equal(service.selectActualLineup(home, 101, "season-final").lineup.some((player) => player.id === playerId), true);

  tournament.bracket.find((node) => node.id === "W2").winner = home.id;
  tournament.bracket.find((node) => node.id === "B8").winner = away.id;
  const firstFinal = tournament.bracket.find((node) => node.id === "FINAL-1");
  const reportPlayer = { ...REAL_PLAYERS.find((player) => player.id === playerId), fitness:90, rating:6, stats:{ goals:0, assists:0, saves:0, tackles:0, interceptions:0, clearances:0, blocks:0, pressuresWon:0, yellowCards:0, redCards:1 } };
  service.completeSeasonFinalNode(firstFinal, { report:{ score:[0, 0], teams:[{ formation:"4-3-3", stats:{ yellowCards:0, redCards:1 }, players:[reportPlayer] }, { formation:"4-3-3", stats:{ yellowCards:0, redCards:0 }, players:[] }], events:[], importantEvents:[] } }, tournament);
  assert.equal(home.playerState[playerId].seasonFinalSuspension, 1);
  assert.equal(service.selectActualLineup(home, 112, "season-final").lineup.some((player) => player.id === playerId), false);
  const secondFinal = tournament.bracket.find((node) => node.id === "FINAL-2");
  assert.equal(service.startSeasonFinalNode(secondFinal, tournament), true);
  assert.equal(service.state.liveSeasonFinalRound.matches[0].match.teams.every((team) => team.players.filter((player) => player.active).every((player) => player.id !== playerId)), true);
});

test("season final UI exposes the ban workflow and dedicated grand-final stage", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../versus/api.js", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /data-season-final-ban/);
  assert.match(appSource, /leagueRequest\("\/season-final\/ban"/);
  assert.match(appSource, /viewBox="0 0 2025 850"/);
  assert.match(appSource, /sf-final-stage/);
  assert.match(appSource, /sf-champion/);
  assert.match(appSource, /sf-final-stage" x="1645" y="157" width="334" height="536"/);
  assert.match(appSource, /"FINAL-1":\[1675,240\], "FINAL-2":\[1675,430\]/);
  assert.match(appSource, /scheduleTimeText\(node\.startsAt/);
  assert.match(appSource, /if \(match\) return ""/);
  assert.match(appSource, /M192 247 V304 H1132 V540/);
  assert.match(appSource, /M622 247 V316 H1392 V540/);
  assert.match(appSource, /GRAND FINAL · 最终决赛/);
  assert.match(cssSource, /Season final bracket v2/);
  assert.match(cssSource, /\.season-final-map-head\{display:none\}/);
  assert.match(cssSource, /\.sf-match-card-final/);
  assert.match(cssSource, /data-league-theme="light"\] \.season-final-page/);
  assert.match(cssSource, /data-league-theme="light"\] \.season-final-svg\{background:/);
  assert.match(cssSource, /data-league-theme="light"\] \.sf-final-stage\{fill:#fffaf0/);
  assert.match(cssSource, /data-league-theme="light"\] \.sf-match-card\{background:/);
  assert.match(appSource, /league-magnet-ban/);
  assert.match(cssSource, /\.league-magnet-ban\{/);
  assert.match(apiSource, /\/api\/versus\/league\/season-final\/ban/);
});

test("champion cup knockout uses the shared tournament-tree design in both themes", () => {
  const appSource = readFileSync(new URL("../versus/public/app.js", import.meta.url), "utf8");
  const cssSource = readFileSync(new URL("../versus/public/styles.css", import.meta.url), "utf8");
  assert.match(appSource, /cup-bracket cup-bracket-tree/);
  assert.match(appSource, /viewBox="0 0 1480 830"/);
  assert.match(appSource, /cupTreeCard\(quarterfinals/);
  assert.match(appSource, /cupTreeCard\(semifinals/);
  assert.match(appSource, /cup-tree-final-stage/);
  assert.match(appSource, /length:isFinal \? 1 : 2/);
  assert.match(appSource, /class="cup-tree-leg-row/);
  assert.match(appSource, /sf-match-card-final is-single-leg/);
  assert.match(cssSource, /Champion Cup knockout tree shares the season-final visual language/);
  assert.match(cssSource, /data-league-theme="light"\] \.cup-tree/);
  assert.match(cssSource, /\.cup-tree-card\.is-single-leg/);
});
