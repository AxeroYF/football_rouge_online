import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { completedSeason } from "./v4-season-boundary-fixture.js";

const yesterday = "2026-11-18";
const now = () => Date.parse("2026-11-19T10:00:00+08:00");

function fixture(t, storage = "league.json") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yffm-reset-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const options = { statePath:path.join(root, storage), backupDir:path.join(root, "backups"), now, rng:() => .37 };
  const reopen = () => new YellowDogsLeagueService(options);
  return { service:reopen(), reopen };
}

for (const pending of [false, true]) {
  test(`跨日保留第13轮的旧赛季并启动第14轮，待结投注=${pending}`, t => {
    const { service, reopen } = fixture(t);
    const s = service.state, id = s.season.id;
    s.dailyAutomation.initializedDate = s.dailyAutomation.lastResetDate = s.season.date = yesterday;
    s.season.currentRound = 13;
    s.season.nextRoundAt = now();
    s.rounds.slice(0,13).forEach(round => { round.status = "complete"; });
    s.cup.status = "completed";
    if (pending) s.matchPredictions.bets.push({ id:"old-season-bet", status:"pending" });
    service.save();
    const resumed = reopen();
    assert.throws(() => resumed.startNewSeason(), /未完赛|未结算预测/);
    resumed.tick();
    assert.equal(resumed.state.season.id, id);
    assert.equal(resumed.state.liveRound?.roundNumber, 14);
    assert.equal(resumed.state.dailyAutomation.lastResetDate, yesterday);
    assert.equal(resumed.state.matchPredictions.bets.some(bet => bet.id === "old-season-bet"), pending);
    assert.equal(resumed.state.archives.length, 0);
  });
}

test("错过开杯的旧赛季在联赛完赛后继续开杯", t => {
  const { service } = fixture(t);
  const s = service.state, id = s.season.id;
  s.season.status = "completed";
  s.season.date = s.dailyAutomation.initializedDate = yesterday;
  service.now = () => now() + 61_000;
  service.tick();
  assert.equal(s.season.id, id);
  assert.equal(s.cup.stage, "roundOf16");
  assert.equal(s.dailyAutomation.lastRewardedSeasonId, null);
});

test("完赛后等待投注结算，再轮转一次", t => {
  const { service } = fixture(t);
  service.adoptState(completedSeason());
  const s = service.state, id = s.season.id;
  s.dailyAutomation.initializedDate = s.dailyAutomation.lastResetDate = yesterday;
  s.matchPredictions.bets.push({ id:"awaiting-settlement", status:"pending" });
  service.runDailyAutomation();
  assert.equal(s.season.id, id);
  assert.equal(s.matchPredictions.bets.length, 1);
  s.matchPredictions.bets[0].status = "lost";
  service.runDailyAutomation();
  service.runDailyAutomation();
  assert.notEqual(s.season.id, id);
  assert.equal(s.archives.filter(a => a.season.id === id).length, 1);
});

test("新存档提交后中断，重载再清理录像", t => {
  const { service, reopen } = fixture(t);
  const key = "c".repeat(64), id = "v4-"+"d".repeat(32)+"-1";
  service.state.v4LocalLeagueRounds = { rounds:{ [key]:{
    key, seasonId:service.state.season.id, status:"complete", tasks:[{fixture:{id}}],
  } } };
  service.save();
  const job = path.join(service.statePath+".v4-schedule","league-queue-"+key,"jobs",id);
  fs.mkdirSync(job,{recursive:true});
  const file = path.join(job,"goal-clips.json.gz");
  fs.writeFileSync(file,"clip");
  t.mock.method(service,"finishSeasonReplayCleanup",() => {});
  service.fullReset();
  assert.ok(fs.existsSync(file));
  const resumed = reopen();
  assert.equal(resumed.state.season.status,"registration");
  assert.equal(resumed.state.pendingSeasonReplayCleanup.length,1);
  resumed.tick();
  assert.equal(fs.existsSync(file),false);
  assert.equal(reopen().state.pendingSeasonReplayCleanup,undefined);
});

test("同一完赛存档走手动或每日换季，奖励、荣誉、升降级和赞助完全相同", t => {
  const original = completedSeason();
  original.dailyAutomation.initializedDate = original.dailyAutomation.lastResetDate = yesterday;
  const effects = [];
  for (const manual of [true,false]) {
    const {service,reopen} = fixture(t);
    service.adoptState(structuredClone(original));
    const team = service.state.teams.find(t => t.ownerId);
    const contract = service.createClubSponsorOffer(team, { type:"stadium", durationSeasons:3, force:true });
    service.respondClubSponsorOffer({id:team.ownerId}, {offerId:contract.id, action:"accept"});
    const before = service.wallet(team.ownerId).balance;
    const id = service.state.season.id;
    if (manual) service.startNewSeason();
    else service.runDailyAutomation();
    const resumed = reopen(), s = resumed.state;
    assert.notEqual(s.season.id, id);
    assert.equal(s.season.status, manual ? "registration" : "active");
    assert.equal(s.archives.filter(a => a.season.id === id).length, 1);
    assert.equal(s.honorRoom.processedSeasonIds.filter(k => k === id).length, 1);
    assert.equal(s.competitionFormat.movements.filter(m => m.seasonId === id).length, 1);
    assert.equal(s.dailyAutomation.lastRewardedSeasonId, id);
    const payments = s.ledger.filter(p => p.accountId === team.ownerId);
    assert.equal(payments.filter(p => p.type === "sponsor-season-installment").length, 1);
    assert.equal(payments.find(p => p.type === "sponsor-season-installment").amount, 15000);
    assert.equal(payments.filter(p => p.type === "daily-season-settlement").length, 1);
    const balance = resumed.wallet(team.ownerId).balance;
    for (let attempt=0; attempt<2; attempt++) assert.throws(() => resumed.startNewSeason(), /未完赛/);
    resumed.runDailyAutomation();
    assert.equal(resumed.wallet(team.ownerId).balance, balance);
    effects.push({
      income:balance-before, packs:resumed.s4PackInventory(team.ownerId).map(p => p.packType),
      honors:s.honorRoom.clubs[team.ownerId].honors, divisions:s.teams.map(t => t.division),
      contract:resumed.accountTeam(team.ownerId).clubManagement.sponsorship.activeContracts[0].remainingSeasons,
    });
  }
  assert.deepEqual(effects[0], effects[1]);
});

for (const storage of ["league.json","league-shards"]) {
  for (const [name, reset] of Object.entries({
    replay:s => s.restartSeason(), next:s => s.startNewSeason(),
    daily:s => s.resetDailyCompetitions({manual:true}), full:s => s.fullReset(),
  })) {
    test(`${storage} ${name} 备份或提交失败保留回放与资产，重试成功后清理`, t => {
      const {service,reopen} = fixture(t, storage);
      const account = { id:"clip-owner", nickname:"Clip Manager" };
      service.beginDraft(account,"Clip FC");
      service.autoDraft(account);
      service.finishDraft(account);
      const s = service.state, id = s.season.id;
      const balance = service.wallet(account.id).balance;
      const packCount = service.s4PackInventory(account.id).length;
      s.season.status = s.cup.status = "completed";
      const clip = { eventId:"goal", frames:[1,2] };
      s.completedBroadcasts.push({ code:"ended", match:{ keyPlays:[clip] } });
      const key = "a".repeat(64), fixtureId = "v4-"+"b".repeat(32)+"-1";
      s.v4LocalLeagueRounds = { rounds:{ [key]:{ key, seasonId:id, status:"complete", tasks:[{fixture:{id:fixtureId}}] } } };
      service.save({forceFull:true});
      const job = path.join(service.statePath+".v4-schedule","league-queue-"+key,"jobs",fixtureId);
      fs.mkdirSync(job,{recursive:true});
      const file = path.join(job,"goal-clips.json.gz");
      fs.writeFileSync(file,"old clip");
      for (const method of ["backupFile","save"]) {
        const failure = t.mock.method(service,method,() => { throw new Error("injected "+method); });
        assert.throws(() => reset(service), /injected/);
        failure.mock.restore();
        for (const current of [service,reopen()]) {
          assert.equal(current.state.season.id,id);
          assert.deepEqual(current.state.completedBroadcasts[0].match.keyPlays,[clip]);
          assert.equal(current.state.archives.length,0);
          assert.equal(current.wallet(account.id).balance,balance);
          assert.equal(current.s4PackInventory(account.id).length,packCount);
          assert.equal(current.state.dailyAutomation.lastRewardedSeasonId,null);
        }
        assert.equal(fs.readFileSync(file,"utf8"),"old clip");
      }
      reset(service);
      assert.equal(fs.existsSync(file),false);
      assert.equal(reopen().state.completedBroadcasts.length,0);
    });
  }
}
