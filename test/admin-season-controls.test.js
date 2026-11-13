import test from "node:test";
import assert from "node:assert/strict";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { advanceYdlLeagueV2Match } from "../versus/v2/ydl-league-engine-adapter.js";

function fixture() {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => Date.parse("2026-11-12T10:00:00+08:00"), rng:() => .37 });
  const user = { id:"admin-season-owner", nickname:"Admin Season" };
  service.beginDraft(user, "Season FC"); service.autoDraft(user); service.finishDraft(user);
  service.wallet(user.id).balance = 43210;
  return { service, user };
}
function apply(service, action) {
  const preview = service.adminSeasonControlsPreview();
  return service.applyAdminSeasonControl({ action, confirm:preview.operations.find(entry => entry.id === action).confirmation, seasonId:preview.seasonId, revision:preview.revision });
}

test("replay and next season preserve wallet, roster, cards, inventory and audit ledger", () => {
  for (const action of ["replay", "next"]) {
    const { service, user } = fixture();
    const team = service.accountTeam(user.id);
    const roster = [...team.rosterIds], cards = JSON.stringify(service.state.s4Assets.cards), packs = JSON.stringify(service.state.s4Packs);
    service.state.ledger.push({ id:"keep-ledger", accountId:user.id, amount:12, type:"admin-coin-grant", createdAt:service.now() });
    const result = apply(service, action);
    assert.equal(result.league.season.name, action === "replay" ? "S1" : "S2");
    assert.equal(result.league.season.status, "registration");
    assert.equal(service.wallet(user.id).balance, 43210);
    assert.deepEqual(service.accountTeam(user.id).rosterIds, roster);
    assert.equal(JSON.stringify(service.state.s4Assets.cards), cards);
    assert.equal(JSON.stringify(service.state.s4Packs), packs);
    assert.ok(service.state.ledger.some(entry => entry.id === "keep-ledger"));
    assert.equal(service.state.archives.length, 1);
  }
  const { service, user } = fixture();
  service.resetDailyCompetitions({ manual:true });
  assert.equal(service.wallet(user.id).balance, 43210, "automatic daily engine also preserves coins");
});

test("only full reset clears assets and old destructive alias uses the same implementation", () => {
  const { service, user } = fixture();
  apply(service, "full");
  assert.equal(service.accountTeam(user.id), null);
  assert.deepEqual(service.state.wallets, {});
  assert.equal(service.state.season.name, "S1");
  assert.equal(service.state.season.status, "registration");
  const legacy = fixture(); legacy.service.state.season.name = "S2";
  legacy.service.startFreshSeason();
  assert.equal(legacy.service.state.season.name, "S3");
  assert.deepEqual(legacy.service.state.wallets, {});
});

test("stale preview, wrong confirmation, pending bets and active games reject before any reset", () => {
  const { service, user } = fixture();
  const preview = service.adminSeasonControlsPreview();
  const request = { action:"replay", confirm:"重赛当前赛季", seasonId:preview.seasonId, revision:preview.revision };
  assert.throws(() => service.applyAdminSeasonControl({ ...request, confirm:"wrong" }), /确认/);
  service.wallet(user.id).balance++;
  assert.throws(() => service.applyAdminSeasonControl(request), /预览/);
  service.state.matchPredictions.bets.push({ id:"pending-bet", status:"pending" });
  assert.throws(() => service.restartSeason(), /未结算预测/);
  service.state.matchPredictions.bets = [];
  service.startScheduledRound();
  assert.equal(service.adminView().manualSimulation.allowed, false);
  assert.throws(() => service.simulateNextRound(), /直播|结算/);
  assert.throws(() => service.restartSeason(), /直播|结算/);
  assert.throws(() => service.fullReset(), /直播|结算/);
  assert.equal(service.wallet(user.id).balance, 43211);
});

test("a partially settled live round cannot be simulated again and fixture settlement is idempotent", () => {
  const { service } = fixture(); service.startScheduledRound();
  const live = service.state.liveRound.matches[0], round = service.state.rounds[0], game = round.fixtures[live.fixtureIndex];
  advanceYdlLeagueV2Match(live.match, live.match.startedAt + 120001, { maximumChains:Infinity });
  service.roundNewUnavailable = new Set();
  const first = service.finalizeFixture(game, 1, live.match);
  live.completed = true;
  const before = JSON.stringify(service.state);
  assert.throws(() => service.simulateNextRound(), /直播|结算/);
  assert.equal(service.finalizeFixture(game, 1, live.match).id, first.id);
  assert.equal(service.simulateFixture(game, 1).id, first.id);
  assert.equal(JSON.stringify(service.state), before);
  assert.equal(service.state.matches.length, 1);
});

test("manual season operations remain in registration across the daily automation deadline", () => {
  const { service, user } = fixture();
  service.state.dailyAutomation.enabled = true;
  service.state.dailyAutomation.initializedDate = "2026-11-11";
  service.restartSeason();
  const season = service.state.season.id;
  assert.equal(service.runDailyAutomation(), false);
  assert.equal(service.state.season.status, "registration");
  assert.equal(service.state.season.id, season);
  service.startLeagueSimulation();
  service.runDailyAutomation();
  assert.equal(service.state.season.id, season, "starting a season should not immediately trigger another reset");
  assert.equal(service.wallet(user.id).balance, 43210);
});

test("replay can repair an interrupted completed season without implicitly paying rewards", () => {
  const { service, user } = fixture();
  service.state.season.status = "completed";
  assert.throws(() => service.startNewSeason(), /结算/);
  service.restartSeason();
  assert.equal(service.state.season.status, "registration");
  assert.equal(service.wallet(user.id).balance, 43210);
});
