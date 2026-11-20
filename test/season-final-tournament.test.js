import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { buildSeasonFinalSeedSnapshot, createSeasonFinalBracket, createSeasonFinalState, cupSeedPoints, positionLine, SEASON_FINAL_RULES, SEASON_FINAL_SCHEDULE_MINUTES, validateFinalBanSelection } from "../versus/season-final-tournament.js";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { LeagueShardStore } from "../versus/league-shard-store.js";
import { tmpdir } from "node:os";
import { at, completedSeason } from "./v4-season-boundary-fixture.js";
import { clubNavMarkup, clubMobileNavMarkup, clubSubnavMarkup } from "../versus/public/club-navigation.js";
import { knockoutCupMarkup } from "../versus/public/division-ui.js";

const teams = Array.from({ length: 10 }, (_, index) => ({ id: `T${index + 1}`, name: `队${index + 1}`, ownerId: index === 9 ? null : `u${index + 1}` }));

// A completed event is still part of a player's match history after its competition retires.
test("completed sharded final keeps its full report through reload, core saves and archival", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "yffm1-final-history-"));
  t.after(() => rmSync(directory, { recursive:true, force:true }));
  const open = () => new YellowDogsLeagueService({statePath:path.join(directory,"shards"), backupDir:null, now:() => at});
  const service = open();
  const [homeId, awayId] = service.state.teams.map(team => team.id);
  const report = { teams:[{id:homeId}, {id:awayId}], score:[2,1], events:[{minute:43,type:"goal"}] };
  const tournament = { id:"historical-final-event", seasonId:service.state.season.id, status:"completed",
    finalTie:{championId:homeId}, matches:[], bracket:[], seedSnapshot:[] };
  tournament.matches.push({id:"historical-final", competition:"season-final", seasonFinalNodeId:"FINAL-2",
    homeId, awayId, round:12, score:[2,1], playedAt:at, report});
  service.state.seasonFinalTournament = tournament;
  service.save();
  const reference = service.shardStore.manifest.shards.seasonFinal;
  service.save({ scopes:["core"], skipDailyBackup:true });
  assert.equal(service.shardStore.manifest.shards.seasonFinal, reference);
  const reloaded = open();
  assert.equal(reloaded.seasonFinalTournamentView(), null);
  assert.equal(reloaded.state.seasonFinalTournament.finalTie.championId, homeId);
  assert.equal(reloaded.shardStore.coldCache.reads, 0);
  const viewer = {id:"history-viewer"};
  const detail = reloaded.matchDetail(viewer, "historical-final");
  assert.deepEqual(detail.events, report.events);
  assert.deepEqual(detail.score, report.score);
  assert.equal(detail.archived, false);
  reloaded.archiveSeason("history-test");
  reloaded.save({ scopes:["archives"], skipDailyBackup:true });
  const reader = new LeagueShardStore(reloaded.statePath, { backupDir:null });
  const archive = reader.readFullArchive(reader.load().archives.at(-1));
  assert.deepEqual(archive.seasonFinalTournament.matches[0].report, report);
  reloaded.state.seasonFinalTournament = null;
  reloaded.save();
  const archived = open().matchDetail(viewer, "historical-final");
  assert.equal(archived.archived, true);
  assert.deepEqual(archived.events, report.events);
});

// Retain historical bracket/scoring rules as pure tests, independent of the active competition.
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

test("current cup page renders all 29 match reports, two-legged ties and a single final", () => {
  const service = new YellowDogsLeagueService({statePath:null, now:() => at});
  service.adoptState(completedSeason());
  const cup = service.cupView();
  const html = knockoutCupMarkup({cup}, String, (_,name) => name, String);
  assert.deepEqual([...html.matchAll(/data-cup-stage="([^"]+)"/g)].map(m => m[1]), ["roundOf16","quarterfinals","semifinals","final"]);
  const [tree,rounds] = html.split('<div class="ko-rounds-view">');
  const expectedIds=Object.values(cup.knockout).flatMap(ties=>ties.flatMap(tie=>tie.legs.map(leg=>leg.matchId)));
  assert.deepEqual(new Set([...tree.matchAll(/data-league-match-detail="([^"]+)"/g)].map(m=>m[1])),new Set(expectedIds));
  const ids = [...rounds.matchAll(/data-league-match-detail="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, Object.values(cup.knockout).flatMap(ties => ties.flatMap(tie => tie.legs.map(leg => leg.matchId))));
  assert.equal(new Set(ids).size, 29);
  assert.equal(rounds.match(/首回合/g)?.length, 14);
  assert.equal(rounds.match(/次回合/g)?.length, 14);
  assert.equal(rounds.match(/总比分 1 : 1/g)?.length, 14);
  assert.ok(rounds.includes("冠军：" + cup.championName));
});

test("current competition navigation exposes the cup on desktop and mobile", () => {
  const desktop = clubNavMarkup("cup"), mobile = clubMobileNavMarkup("cup") + clubSubnavMarkup("cup");
  for (const markup of [desktop, mobile]) {
    assert.match(markup, /data-league-tab="cup"/);
    assert.doesNotMatch(markup, /data-league-tab="seasonFinal"/);
  }
});
