import test from "node:test";
import assert from "node:assert/strict";
import { YellowDogsLeagueService } from "../versus/league-service.js";

const account = (id, nickname) => ({ id, nickname });

function join(service, user, teamName) {
  service.beginDraft(user, teamName);
  service.autoDraft(user);
  return service.finishDraft(user);
}

test("V2 offseason mirror marketplace charges fixed prices and settles 70 percent on next league kickoff", () => {
  let now = Date.parse("2026-08-06T22:30:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const challenger = account("mirror-paying-challenger", "挑战者");
  const owner = account("mirror-akira-owner", "Akira");
  join(service, challenger, "挑战者球队");
  join(service, owner, "Akira球队");
  const ownerTeam = service.accountTeam(owner.id);
  service.state.season.status = "completed";
  service.wallet(challenger.id).balance = 2000;
  service.wallet(owner.id).balance = 1000;

  assert.equal(service.mirrorMarketplacePrice({ ownerName:"Aul" }), 140);
  assert.equal(service.mirrorMarketplacePrice({ ownerName:"AuI" }), 140);
  assert.deepEqual(service.mirrorMarketplaceCatalog(challenger).entries.filter((entry) => entry.teamId === ownerTeam.id).map((entry) => [entry.kind, entry.price]), [["basic", 200]]);
  service.createAiTraining(challenger, { mirrorTeamId:ownerTeam.id, mirrorKind:"basic" });
  service.createAiTraining(challenger, { mirrorTeamId:ownerTeam.id, mirrorKind:"basic" });
  assert.equal(service.wallet(challenger.id).balance, 1600);

  const upload = service.setFullMirrorUpload(owner, true);
  assert.equal(upload.mirrorMarketplace.fullUploadEnabled, true);
  assert.deepEqual(service.mirrorMarketplaceCatalog(challenger).entries.filter((entry) => entry.teamId === ownerTeam.id).map((entry) => [entry.kind, entry.price]), [["basic", 200], ["full", 360]]);
  const full = service.createAiTraining(challenger, { mirrorTeamId:ownerTeam.id, mirrorKind:"full" });
  assert.deepEqual(full.mirrorCharge, { kind:"full", price:360 });
  const opponent = full.broadcast.match.teams[1];
  assert.equal(opponent.tactic, ownerTeam.tacticalPlans.opening.tactic);
  assert.equal(opponent.style, ownerTeam.tacticalPlans.opening.style);
  assert.equal(opponent.attackFocus, ownerTeam.attackFocus);
  assert.equal(opponent.defenseFocus, ownerTeam.defenseFocus);
  assert.deepEqual(opponent.positions, service.state.mirrorMarketplace.uploads[owner.id].snapshot.positions);
  assert.deepEqual(opponent.formationLines, service.state.mirrorMarketplace.uploads[owner.id].snapshot.formationLinePresets.position1);
  assert.equal("inPossessionDetails" in opponent, false);
  assert.equal("outOfPossessionDetails" in opponent, false);
  assert.equal("tacticalDimensions" in opponent, false);
  assert.equal(service.wallet(challenger.id).balance, 1240);

  const usage = service.state.mirrorMarketplace.usageByDate["2026-08-06"][owner.id];
  assert.deepEqual({ basicCalls:usage.basicCalls, fullCalls:usage.fullCalls, gross:usage.gross, platformCommission:usage.platformCommission, ownerRevenue:usage.ownerRevenue }, {
    basicCalls:2, fullCalls:1, gross:760, platformCommission:228, ownerRevenue:532,
  });
  assert.equal(service.wallet(owner.id).balance, 1000);

  now = Date.parse("2026-08-07T10:00:00+08:00");
  service.state.season = { ...service.state.season, status:"active", currentRound:0, nextRoundAt:now, firstRoundAt:now };
  service.state.rounds[0].status = "pending";
  service.startScheduledRound();
  assert.equal(service.wallet(owner.id).balance, 1532);
  assert.equal(service.state.mirrorMarketplace.usageByDate["2026-08-06"], undefined);
  const mail = service.state.inbox[ownerTeam.id].find((message) => message.type === "mirror-settlement");
  assert.match(mail.summary, /普通镜像2次、完整镜像1次/);
  assert.equal(service.settleMirrorMarketplace("2026-08-07"), false);
  assert.equal(service.wallet(owner.id).balance, 1532);
});

test("full mirror upload is opt-in and does not expose tactical data in the catalog", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => Date.parse("2026-08-06T22:30:00+08:00"), rng:() => .37 });
  const viewer = account("mirror-viewer", "查看者");
  const owner = account("mirror-owner", "皇马");
  join(service, viewer, "查看者球队");
  join(service, owner, "皇马球队");
  service.state.season.status = "completed";
  const ownerTeam = service.accountTeam(owner.id);

  assert.equal(service.mirrorMarketplaceCatalog(owner).fullUploadEnabled, false);
  service.setFullMirrorUpload(owner, true);
  ownerTeam.tacticalPlans.opening.tactic = "allOutAttack";
  const catalog = service.mirrorMarketplaceCatalog(viewer);
  const full = catalog.entries.find((entry) => entry.teamId === ownerTeam.id && entry.kind === "full");
  assert.equal(full.price, 324);
  assert.equal("snapshot" in full, false);
  assert.equal("tacticalPlans" in full, false);
  service.setFullMirrorUpload(owner, false);
  assert.equal(service.mirrorMarketplaceCatalog(viewer).entries.some((entry) => entry.teamId === ownerTeam.id && entry.kind === "full"), false);
});
