import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSeasonFinalState } from "../versus/season-final-tournament.js";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { tmpdir } from "node:os";
import { at, completedSeason } from "./v4-season-boundary-fixture.js";

function isolatedSave(t, name) {
  const directory = mkdtempSync(path.join(tmpdir(), "yffm1-retired-final-"));
  t.after(() => rmSync(directory, { recursive:true, force:true }));
  const statePath = path.join(directory, name);
  return () => new YellowDogsLeagueService({ statePath, backupDir:null, now:() => at });
}

function historicalTournament(service) {
  return createSeasonFinalState({ id:"previous-final", seasonId:service.state.season.id,
    teams:service.state.teams.slice(0, 10), leagueRanks:{}, cupResults:{}, createdAt:at - 86400000 });
}

test("the current cup ends the competition without seeding, bans, extra rewards or a Ballon d'Or delay", () => {
  const service = new YellowDogsLeagueService({statePath:null, now:() => at});
  service.adoptState(completedSeason());
  const team = service.state.teams[0];
  assert.equal(service.ensureSeasonFinalTournament(), null);
  assert.equal(service.state.season.seasonFinalLeagueRanks, null);
  assert.equal(service.state.seasonFinalTournament, null);
  const old = historicalTournament(service);
  service.state.seasonFinalTournament = old;
  const before = structuredClone({team, ledger:service.state.ledger, packs:service.state.s4Packs});
  assert.deepEqual(service.dueSeasonFinalNodes(old), []);
  assert.equal(service.startSeasonFinalWave(old.bracket, old), false);
  assert.throws(() => service.simulateNextSeasonFinalMatch(), /停用/);
  assert.equal(service.completeSeasonFinalNode(old.bracket[0], {}, old), null);
  assert.equal(service.awardSeasonFinalChampionStar(team.id, old), null);
  assert.equal(service.grantSeasonFinalPlacementReward(team.id, old, "champion"), null);
  assert.throws(() => service.submitSeasonFinalBan({id:team.ownerId}, {}), /停用/);
  assert.deepEqual(service.seasonFinalBannedPlayerIds(team.id, old), []);
  assert.equal(service.finalizeSeasonFinalBansIfDue(old), false);
  assert.equal(service.notifySeasonFinalBanResults(old), false);
  assert.equal(service.teamSchedule(team.id).some(f => f.competition === "season-final"), false);
  assert.equal(service.nextPredictionFixtures().some(f => f.competition === "season-final"), false);
  assert.deepEqual({team, ledger:service.state.ledger, packs:service.state.s4Packs}, before);
  service.state.cup.status = "active";
  assert.equal(service.settleBallonDor(), null);
  service.state.cup.status = "completed";
  const result = service.settleBallonDor();
  assert.equal(result.seasonId, service.state.season.id);
  assert.deepEqual(service.settleBallonDor(), result);
  assert.equal(service.state.ballonDor.results.filter(r => r.seasonId === result.seasonId).length, 1);
});

for (const name of ["league.json", "shards"]) {
  test("retired live final releases controls and refunds only pending final bets once in " + name, t => {
    const open = isolatedSave(t, name);
    const writer = open();
    const account = {id:"final-market-player"};
    writer.beginDraft(account, "旧赛事退款测试");
    writer.autoDraft(account);
    writer.finishDraft(account);
    const old = historicalTournament(writer);
    old.status = "running";
    old.bracket[0].status = "running";
    old.bracket[1].status = "complete";
    writer.state.seasonFinalTournament = old;
    writer.state.liveSeasonFinalRound = { tournamentId:old.id, matches:[{code:"YDL-FINAL-STALE",match:{version:2}}] };
    writer.wallet(account.id).balance = 100;
    const [home, away] = writer.state.teams.filter(team => team.ownerId !== account.id);
    const market = (id, competition, status) => ({id, competition, status, startsAt:at + 3600000,
      homeId:home.id, awayId:away.id, homeName:home.name, awayName:away.name,
      resultHandicap:0, payoutRates:{result:{home:2}}});
    writer.state.matchPredictions.markets = {
      retired:market("retired","season-final","open"), paid:market("paid","season-final","settled"),
      current:market("current","cup","locked")
    };
    const bet = (id, marketId, amount, status) => ({id, marketId, amount, accountId:account.id, status, payout:status === "won" ? 90 : 0});
    writer.state.matchPredictions.bets = [bet("one","retired",25,"pending"), bet("two","season-final:missing",6,"pending"),
      bet("three","paid",30,"won"), bet("four","current",40,"pending")];
    writer.save();
    if (name === "shards") {
      // Old shard schemas stored the live round in core, before the separate live scope.
      const {core, live} = writer.shardStore.manifest.shards;
      const corePath = path.join(writer.statePath, core), livePath = path.join(writer.statePath, live);
      const coreData = JSON.parse(readFileSync(corePath)), liveData = JSON.parse(readFileSync(livePath));
      coreData.liveSeasonFinalRound = liveData.liveSeasonFinalRound;
      delete liveData.liveSeasonFinalRound;
      writeFileSync(corePath, JSON.stringify(coreData));
      writeFileSync(livePath, JSON.stringify(liveData));
    }
    for (let restart = 0; restart < 2; restart++) {
      const service = open();
      const final = service.state.seasonFinalTournament;
      assert.equal(service.state.liveSeasonFinalRound, null);
      assert.equal(final.status, "cancelled");
      assert.equal(final.cancellationReason, "competition-disabled");
      assert.equal(final.nextMatchAt, null);
      assert.equal(final.bracket[0].status, "cancelled");
      assert.equal(final.bracket[1].status, "complete");
      assert.equal(service.broadcasts().some(b => b.code === "YDL-FINAL-STALE"), false);
      assert.throws(() => service.watch("YDL-FINAL-STALE", "viewer"), /直播/);
      assert.equal(service.adminSeasonControlBlocker("full"), null);
      assert.match(service.adminSeasonControlBlocker("next"), /预测/);
      const {markets, bets} = service.state.matchPredictions;
      assert.equal(markets.retired.status, "cancelled");
      assert.equal(markets.paid.status, "settled");
      assert.equal(markets.current.status, "locked");
      assert.deepEqual(bets.map(b => [b.status,b.payout]), [["refunded",25],["refunded",6],["won",90],["pending",0]]);
      assert.equal(service.wallet(account.id).balance, 131);
      assert.deepEqual(service.state.ledger.filter(e => e.type === "prediction-format-refund").map(e => e.betId), ["one","two"]);
      assert.equal(service.cancelExpiredSeasonFinal(), false);
    }
    const service = open();
    service.state.matchPredictions.markets.retired.status = "open";
    assert.throws(() => service.placeMatchPrediction(account, "retired", "result", "home", 1), /找不到/);
    assert.equal(service.wallet(account.id).balance, 131);
    const fixture = {id:"old"};
    const id = service.predictionMarketId("season-final", "FINAL-2", fixture);
    service.state.matchPredictions.markets[id] = market(id, "season-final", "open");
    assert.equal(service.settleMatchPrediction("season-final", "FINAL-2", fixture, {score:[1,0]}), null);
    assert.equal(service.state.matchPredictions.markets[id].settlement, undefined);
    service.state.matchPredictions.markets.current.status = "open";
    service.placeMatchPrediction(account, "current", "result", "home", 1, {compact:true});
    assert.equal(service.wallet(account.id).balance, 130);
    assert.equal(service.state.matchPredictions.bets.at(-1).marketId, "current");
  });
}

test("only retired bets remain at the boundary: reload refunds them and allows normal rollover", t => {
  const open = isolatedSave(t, "shards");
  const writer = open();
  writer.adoptState(completedSeason());
  const {season, teams, matchPredictions} = writer.state;
  const id = season.id, accountId = teams.find(team => team.ownerId).ownerId;
  matchPredictions.bets.push({id:"final-stake", accountId, marketId:"season-final:orphan", amount:77, status:"pending"});
  writer.state.liveSeasonFinalRound = {tournamentId:"missing", matches:[]};
  writer.save({forceFull:true});
  const resumed = open();
  assert.equal(resumed.adminSeasonControlBlocker("next"), null);
  resumed.startNewSeason();
  const next = open();
  assert.notEqual(next.state.season.id, id);
  assert.equal(next.state.archives.filter(a => a.season.id === id).length, 1);
  assert.equal(next.state.ledger.filter(e => e.betId === "final-stake" && e.amount === 77).length, 1);
});

test("an abandoned final cannot hold the last league round across midnight", t => {
  const open = isolatedSave(t, "league.json");
  const writer = open();
  writer.state.liveSeasonFinalRound = {tournamentId:"orphan", matches:[]};
  writer.state.season.currentRound = 13;
  writer.state.season.date = writer.state.dailyAutomation.lastResetDate = writer.state.dailyAutomation.initializedDate = "2026-11-17";
  writer.state.season.nextRoundAt = at;
  writer.state.rounds.slice(0,13).forEach(round => { round.status = "complete"; });
  writer.state.cup.status = "completed";
  writer.save();
  const resumed = open();
  resumed.now = () => Date.parse("2026-11-19T10:00:00+08:00");
  resumed.tick();
  assert.equal(resumed.state.season.id, writer.state.season.id);
  assert.equal(resumed.state.liveRound?.roundNumber, 14);
  assert.equal(resumed.state.liveSeasonFinalRound, null);
});
