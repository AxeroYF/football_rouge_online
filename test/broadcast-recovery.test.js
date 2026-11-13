import test from "node:test";
import assert from "node:assert/strict";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { advanceYdlLeagueV2Match } from "../versus/v2/ydl-league-engine-adapter.js";

function fixture() {
  let now = Date.parse("2026-11-12T10:00:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const owner = { id:"live-owner", nickname:"观赛经理" };
  service.beginDraft(owner, "直播联队"); service.autoDraft(owner); service.finishDraft(owner);
  const created = service.createAiTraining(owner, { formation:"4-3-3", averageOverall:82 });
  const live = service.liveAiTrainings.get(created.broadcast.code);
  return { service, owner, created, live, advance:ms => { now += ms; } };
}

test("公开观赛清理在线人数后恢复同一个 token，重复恢复不增加人数", () => {
  const { service, created, live, advance } = fixture();
  service.liveAiTrainings.clear(); live.aiTraining = false; live.code = "YDL-FRIENDLY-RESUME";
  service.state.liveFriendlies.push(live);
  advance(31_000); service.broadcasts();
  assert.equal(Object.keys(live.spectators).length, 0);
  assert.throws(() => service.watchView(live.code, created.spectatorToken), { code:"BROADCAST_SESSION_EXPIRED" });
  const restored = service.resumeWatch(live.code, "经理", created.spectatorToken);
  assert.equal(restored.spectatorToken, created.spectatorToken);
  assert.equal(restored.broadcast.spectators.length, 1);
  assert.equal(service.resumeWatch(live.code, "经理", created.spectatorToken).broadcast.spectators.length, 1);
  service.leaveWatch(live.code, created.spectatorToken);
  assert.equal(Object.keys(live.spectatorRecoveries).length, 0);
});

test("私有训练只允许创建者恢复，保留比赛对象、进度与余额", () => {
  const { service, owner, created, live, advance } = fixture();
  const balance = service.wallet(owner.id).balance;
  advance(31_000); service.cleanupLiveSpectators(live);
  assert.throws(() => service.resumeWatch(live.code, "冒名", created.spectatorToken), { code:"BROADCAST_FORBIDDEN" });
  assert.throws(() => service.resumeWatch(live.code, "其他账号", created.spectatorToken, { id:"other" }), { code:"BROADCAST_FORBIDDEN" });
  assert.throws(() => service.watchView(live.code, "__proto__"), { code:"BROADCAST_SESSION_EXPIRED" });
  assert.throws(() => service.watch(live.code, "冒名", "constructor"), /创建者/);
  const before = JSON.stringify(live.match);
  const resumed = service.resumeWatch(live.code, "经理", created.spectatorToken, owner);
  assert.equal(resumed.spectatorToken, created.spectatorToken);
  assert.equal(service.liveAiTrainings.get(live.code), live);
  assert.equal(JSON.stringify(live.match), before);
  assert.equal(service.wallet(owner.id).balance, balance);
});

test("后台期间比赛结束仍能恢复最终快照，归档保留恢复资格", () => {
  const { service, created, live, advance } = fixture();
  service.liveAiTrainings.clear(); live.aiTraining = false; live.code = "YDL-FINAL-RESUME";
  advance(31_000); service.cleanupLiveSpectators(live);
  advance(100_000); advanceYdlLeagueV2Match(live.match, service.now(), { maximumChains:Infinity });
  live.completed = true;
  service.archiveCompletedBroadcasts({ roundNumber:1, matches:[live] });
  assert.throws(() => service.watchView(live.code, created.spectatorToken), { code:"BROADCAST_SESSION_EXPIRED" });
  const restored = service.resumeWatch(live.code, "经理", created.spectatorToken);
  assert.equal(restored.spectatorToken, created.spectatorToken);
  assert.equal(restored.broadcast.live, false);
  assert.ok(restored.broadcast.match.report);
  assert.equal(restored.broadcast.revision.length, 64);
});

test("完整镜像恢复和终场报告不暴露新增战术字段及事件，恢复不再次扣费", () => {
  const { service, owner, live, advance } = fixture();
  const opponent = { id:"mirror-owner", nickname:"Akira" };
  service.beginDraft(opponent, "镜像联队"); service.autoDraft(opponent); service.finishDraft(opponent);
  service.state.season.status = "completed";
  service.setFullMirrorUpload(opponent, true);
  service.wallet(owner.id).balance = 1000;
  const full = service.createAiTraining(owner, { mirrorTeamId:service.accountTeam(opponent.id).id, mirrorKind:"full" });
  const mirror = service.liveAiTrainings.get(full.broadcast.code);
  const balance = service.wallet(owner.id).balance;
  advance(31_000); service.cleanupLiveSpectators(mirror);
  service.resumeWatch(mirror.code, "经理", full.spectatorToken, owner);
  assert.equal(service.wallet(owner.id).balance, balance);
  // Force an actual engine plan switch, then inspect both live and report views.
  mirror.match.teams[1].score = 2; mirror.match.score[1] = 2;
  advance(100_000); advanceYdlLeagueV2Match(mirror.match, service.now(), { maximumChains:Infinity });
  const view = service.watchView(mirror.code, full.spectatorToken);
  for (const team of [view.match.teams[1], view.match.report.teams[1]]) {
    assert.equal(team.tacticsHidden, true);
    for (const key of ["activePlan", "activePlanTrigger", "possessionStyle", "defensiveBlock", "transitionStyle", "duelIntensity", "playerDuties"]) assert.equal(key in team, false);
  }
  for (const events of [view.match.events, view.match.report.events, view.match.report.importantEvents]) {
    for (const event of events.filter(event => event.type === "tactical" && event.teamIndex === 1)) {
      assert.equal("possessionStyle" in event, false); assert.equal("plan" in event, false);
    }
  }
});
