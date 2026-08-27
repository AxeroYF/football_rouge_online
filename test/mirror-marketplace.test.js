import test from "node:test";
import assert from "node:assert/strict";
import { YellowDogsLeagueService } from "../versus/league-service.js";
import { createTrackedState } from "../versus/league-shard-store.js";
import { runMirrorBatchWorkerMatch } from "../versus/mirror-batch-worker-protocol.js";

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

test("top three offseason seeds are forced to publish every saved tactical board", () => {
  let now = Date.parse("2026-08-06T22:30:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const viewer = account("forced-mirror-viewer", "查看者");
  const seedOne = account("forced-mirror-seed-1", "Akira");
  const seedTwo = account("forced-mirror-seed-2", "皇马");
  const seedThree = account("forced-mirror-seed-3", "唱反调");
  join(service, viewer, "查看者球队");
  join(service, seedOne, "一号种子球队");
  join(service, seedTwo, "二号种子球队");
  join(service, seedThree, "三号种子球队");

  const seedOneTeam = service.accountTeam(seedOne.id);
  const seedTwoTeam = service.accountTeam(seedTwo.id);
  const seedThreeTeam = service.accountTeam(seedThree.id);
  service.updateLineupScheme(seedOne, { action:"create", name:"第二战术板" });
  service.updateLineupScheme(seedOne, { action:"create", name:"第三战术板" });
  seedOneTeam.lineupSchemes[1].tacticalPlans.opening.tactic = "attacking";
  seedOneTeam.lineupSchemes[1].revision += 1;
  seedOneTeam.lineupSchemes[2].tacticalPlans.opening.tactic = "allOutAttack";
  seedOneTeam.lineupSchemes[2].revision += 1;

  service.state.season.status = "completed";
  service.state.season.date = "2026-08-06";
  service.state.seasonFinalTournament = {
    seasonId:service.state.season.id,
    preview:false,
    seedSnapshot:[
      { teamId:seedOneTeam.id, seed:1, isAi:false },
      { teamId:seedTwoTeam.id, seed:2, isAi:false },
      { teamId:seedThreeTeam.id, seed:3, isAi:false },
    ],
  };

  assert.equal(service.syncForcedSeedMirrorUploads(), true);
  const seedOneUpload = service.state.mirrorMarketplace.uploads[seedOne.id];
  assert.equal(seedOneUpload.forcedBySeed, true);
  assert.equal(seedOneUpload.forcedSeed, 1);
  assert.equal(seedOneUpload.snapshots.length, 3);
  assert.equal(service.state.mirrorMarketplace.uploads[seedTwo.id].snapshots.length, 1);
  assert.equal(service.state.mirrorMarketplace.uploads[seedThree.id].snapshots.length, 1);

  const ownCatalog = service.mirrorMarketplaceCatalog(seedOne);
  assert.equal(ownCatalog.fullUploadLocked, true);
  assert.equal(ownCatalog.fullUploadCount, 3);
  const seedOneEntries = service.mirrorMarketplaceCatalog(viewer).entries.filter((entry) => entry.teamId === seedOneTeam.id);
  assert.equal(seedOneEntries.filter((entry) => entry.kind === "full").length, 3);
  assert.ok(seedOneEntries.filter((entry) => entry.kind === "full").every((entry) => entry.price === 300));
  assert.deepEqual(seedOneEntries.filter((entry) => entry.kind === "full").map((entry) => entry.mirrorSchemeName), ["方案 1", "第二战术板", "第三战术板"]);
  assert.ok(seedOneEntries.every((entry) => entry.forcedSeed === 1));
  assert.throws(() => service.setFullMirrorUpload(seedOne, false), /强制上传.*不可取消/);

  service.wallet(viewer.id).balance = 2000;
  const selected = seedOneUpload.snapshots[1];
  const training = service.createAiTraining(viewer, {
    mirrorTeamId:seedOneTeam.id,
    mirrorKind:"full",
    mirrorSchemeId:selected.schemeId,
  });
  assert.equal(training.broadcast.match.teams[1].tactic, "attacking");
  assert.match(training.broadcast.match.teams[1].name, /第二战术板/);

  now = Date.parse("2026-08-07T00:05:00+08:00");
  assert.equal(service.syncForcedSeedMirrorUploads(), true);
  assert.equal(service.state.mirrorMarketplace.uploads[seedOne.id].forcedBySeed, true);
  assert.equal(service.state.mirrorMarketplace.uploads[seedOne.id].forcedDate, "2026-08-07");
  assert.equal(service.mirrorMarketplaceCatalog(viewer).entries.filter((entry) => entry.teamId === seedOneTeam.id && entry.kind === "full").length, 3);

  service.state.season.status = "active";
  service.state.seasonFinalTournament = null;
  assert.equal(service.syncForcedSeedMirrorUploads(), true);
  assert.equal(service.state.mirrorMarketplace.uploads[seedOne.id].forcedBySeed, undefined);
  assert.equal(service.state.mirrorMarketplace.uploads[seedOne.id].enabled, false);
});

test("10-match mirror batch charges a 30 percent service fee and sends a summary mail", () => {
  const now = Date.parse("2026-08-06T22:30:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const viewer = account("mirror-batch-viewer", "批量模拟玩家");
  const seedOwner = account("mirror-batch-seed", "Akira");
  join(service, viewer, "批量模拟球队");
  join(service, seedOwner, "种子镜像球队");
  const viewerTeam = service.accountTeam(viewer.id);
  const mirrorTeam = service.accountTeam(seedOwner.id);
  service.state.season.status = "completed";
  service.state.season.date = "2026-08-06";
  service.state.seasonFinalTournament = {
    seasonId:service.state.season.id,
    preview:false,
    seedSnapshot:[{ teamId:mirrorTeam.id, seed:1, isAi:false }],
  };
  service.syncForcedSeedMirrorUploads();
  service.wallet(viewer.id).balance = 5000;
  service.wallet(seedOwner.id).balance = 1000;
  const mirrorSchemeId = service.state.mirrorMarketplace.uploads[seedOwner.id].snapshots[0].schemeId;
  const config = {
    requestId:"mirror-batch-request-1",
    mirrorTeamId:mirrorTeam.id,
    mirrorKind:"full",
    mirrorSchemeId,
    attackFocus:"balanced",
    defenseFocus:"balanced",
    tacticalPlans:{
      opening:{ tactic:"balanced", style:"possession" },
      leading:{ tactic:"defensive", style:"counterAttack" },
      trailing:{ tactic:"positive", style:"wingPlay" },
    },
  };

  const created = service.createMirrorBatchSimulation(viewer, config);
  assert.equal(created.mirrorBatchJob.totalMatches, 10);
  assert.equal(created.mirrorBatchJob.unitPrice, 300);
  assert.equal(created.mirrorBatchJob.subtotal, 1000);
  assert.equal(created.mirrorBatchJob.serviceFee, 300);
  assert.equal(created.mirrorBatchJob.totalCost, 1300);
  assert.equal(service.wallet(viewer.id).balance, 3700);
  const repeated = service.createMirrorBatchSimulation(viewer, config);
  assert.equal(repeated.mirrorBatchJob.id, created.mirrorBatchJob.id);
  assert.equal(service.wallet(viewer.id).balance, 3700);

  const usage = service.state.mirrorMarketplace.usageByDate["2026-08-06"][seedOwner.id];
  assert.equal(usage.fullCalls, 10);
  assert.equal(usage.gross, 1300);
  assert.equal(usage.serviceFees, 300);
  assert.equal(usage.platformCommission, 600);
  assert.equal(usage.ownerRevenue, 700);

  const job = service.state.mirrorMarketplace.batchJobs.find((entry) => entry.id === created.mirrorBatchJob.id);
  service.state.season.status = "active";
  assert.equal(service.advanceMirrorBatchSimulations(1, { maximumChainsPerMatch:Infinity }), false);
  assert.equal(job.results.length, 0);
  service.state.season.status = "completed";
  service.state = createTrackedState(service.state, () => {});
  for (let guard = 0; guard < 20 && job.status !== "completed"; guard += 1) assert.equal(service.advanceMirrorBatchSimulations(1, { maximumChainsPerMatch:Infinity }), true);
  assert.equal(job.status, "completed");
  assert.equal(job.results.length, 10);
  assert.equal(job.callerSeat, undefined);
  assert.equal(job.opponentSeat, undefined);
  assert.equal(job.report.totalMatches, 10);
  assert.equal(job.report.wins + job.report.draws + job.report.losses, 10);
  assert.equal(job.report.pricing.totalCost, 1300);
  const mail = service.state.inbox[viewerTeam.id].find((message) => message.type === "mirror-batch-report");
  assert.ok(mail);
  assert.equal(mail.report.results.length, 10);
  assert.equal(mail.report.schemaVersion, 2);
  assert.equal(mail.report.tacticalProfiles.own.phases.length, 3);
  assert.equal(mail.report.tacticalProfiles.opponent.phases.length, 3);
  assert.ok(mail.report.results.every((result) => result.own.leaders.length <= 3 && result.opponent.leaders.length <= 3));
  assert.ok(mail.report.analysis.attack && mail.report.analysis.defense && mail.report.analysis.control);
  assert.ok(mail.report.analysis.recommendations.length >= 1);
  assert.equal(job.activeMatch, undefined);
  assert.equal(job.workerLease, undefined);
assert.match(mail.summary, /10场镜像|总比分|胜/);
  assert.equal(service.state.mirrorMarketplace.batchJobs.some((entry) => entry.id === job.id), false);
  const receipt = service.state.mirrorMarketplace.batchReceipts.find((entry) => entry.id === job.id);
  assert.ok(receipt);
  assert.equal("results" in receipt, false);
  assert.equal("report" in receipt, false);
  const balanceAfterCompletion = service.wallet(viewer.id).balance;
  const repeatedAfterCompletion = service.createMirrorBatchSimulation(viewer, config);
  assert.equal(repeatedAfterCompletion.mirrorBatchJob.id, job.id);
  assert.equal(service.wallet(viewer.id).balance, balanceAfterCompletion);
});

test("mirror batch accepts 10 to 50 matches in steps of ten and prices all matches at one third", () => {
  const now = Date.parse("2026-08-06T22:30:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const viewer = account("mirror-fifty-viewer", "五十场玩家");
  const seedOwner = account("mirror-fifty-seed", "Akira");
  join(service, viewer, "五十场球队");
  join(service, seedOwner, "五十场种子球队");
  const mirrorTeam = service.accountTeam(seedOwner.id);
  service.state.season.status = "completed";
  service.state.season.date = "2026-08-06";
  service.state.seasonFinalTournament = { seasonId:service.state.season.id, preview:false, seedSnapshot:[{ teamId:mirrorTeam.id, seed:1, isAi:false }] };
  service.syncForcedSeedMirrorUploads();
  service.wallet(viewer.id).balance = 20_000;
  const mirrorSchemeId = service.state.mirrorMarketplace.uploads[seedOwner.id].snapshots[0].schemeId;
  const config = {
    requestId:"mirror-batch-fifty-request",
    totalMatches:50,
    mirrorTeamId:mirrorTeam.id,
    mirrorKind:"full",
    mirrorSchemeId,
    attackFocus:"balanced",
    defenseFocus:"balanced",
    tacticalPlans:{ opening:{ tactic:"balanced", style:"possession" }, leading:{ tactic:"defensive", style:"counterAttack" }, trailing:{ tactic:"positive", style:"wingPlay" } },
  };
  const catalog = service.mirrorMarketplaceCatalog(viewer);
  assert.equal(catalog.batchMinimumMatchCount, 10);
  assert.equal(catalog.batchMaximumMatchCount, 50);
  const created = service.createMirrorBatchSimulation(viewer, config);
  assert.equal(created.mirrorBatchJob.totalMatches, 50);
  assert.equal(created.mirrorBatchJob.subtotal, 5000);
  assert.equal(created.mirrorBatchJob.serviceFee, 1500);
  assert.equal(created.mirrorBatchJob.totalCost, 6500);
  assert.equal(service.wallet(viewer.id).balance, 13_500);
  assert.equal(service.state.mirrorMarketplace.usageByDate["2026-08-06"][seedOwner.id].fullCalls, 50);
  assert.throws(() => service.createMirrorBatchSimulation(viewer, { ...config, requestId:"too-many", totalMatches:60 }), /10、20、30、40或50/);
  assert.throws(() => service.createMirrorBatchSimulation(viewer, { ...config, requestId:"invalid-step", totalMatches:15 }), /10、20、30、40或50/);
});
test("mirror batches run two at once and reject a third without charging", () => {
  const now = Date.parse("2026-08-06T22:30:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const first = account("mirror-capacity-first", "甲玩家");
  const second = account("mirror-capacity-second", "乙玩家");
  const third = account("mirror-capacity-third", "丙玩家");
  const seedOwner = account("mirror-capacity-seed", "Akira");
  join(service, first, "甲球队");
  join(service, second, "乙球队");
  join(service, third, "丙球队");
  join(service, seedOwner, "种子镜像球队");
  const mirrorTeam = service.accountTeam(seedOwner.id);
  service.state.season.status = "completed";
  service.state.season.date = "2026-08-06";
  service.state.seasonFinalTournament = {
    seasonId:service.state.season.id,
    preview:false,
    seedSnapshot:[{ teamId:mirrorTeam.id, seed:1, isAi:false }],
  };
  service.syncForcedSeedMirrorUploads();
  [first, second, third].forEach((user) => { service.wallet(user.id).balance = 5000; });
  const mirrorSchemeId = service.state.mirrorMarketplace.uploads[seedOwner.id].snapshots[0].schemeId;
  const config = (requestId) => ({
    requestId,
    mirrorTeamId:mirrorTeam.id,
    mirrorKind:"full",
    mirrorSchemeId,
    attackFocus:"balanced",
    defenseFocus:"balanced",
    tacticalPlans:{
      opening:{ tactic:"balanced", style:"possession" },
      leading:{ tactic:"defensive", style:"counterAttack" },
      trailing:{ tactic:"positive", style:"wingPlay" },
    },
  });

  const firstCreated = service.createMirrorBatchSimulation(first, config("mirror-capacity-request-1"));
  const secondCreated = service.createMirrorBatchSimulation(second, config("mirror-capacity-request-2"));
  const catalog = service.mirrorMarketplaceCatalog(third);
  assert.equal(catalog.batchCapacity, 2);
  assert.deepEqual(catalog.activeBatchJobs.map((entry) => [entry.ownerName, entry.teamName, entry.remainingMatches]), [
    ["甲玩家", "甲球队", 10],
    ["乙玩家", "乙球队", 10],
  ]);

  const balanceBefore = service.wallet(third.id).balance;
  assert.throws(
    () => service.createMirrorBatchSimulation(third, config("mirror-capacity-request-3")),
    (error) => error.statusCode === 409
      && error.details.length === 2
      && error.details.every((entry) => entry.remainingMatches === 10),
  );
  assert.equal(service.wallet(third.id).balance, balanceBefore);
  assert.equal(service.state.mirrorMarketplace.batchJobs.some((job) => job.ownerId === third.id), false);

  assert.equal(service.advanceMirrorBatchSimulations(2, { maximumChainsPerMatch:20 }), true);
  const firstJob = service.state.mirrorMarketplace.batchJobs.find((job) => job.id === firstCreated.mirrorBatchJob.id);
  const secondJob = service.state.mirrorMarketplace.batchJobs.find((job) => job.id === secondCreated.mirrorBatchJob.id);
  assert.equal(firstJob.status, "running");
  assert.equal(secondJob.status, "running");
  assert.equal(firstJob.activeMatch.nextChainIndex, 20);
  assert.equal(secondJob.activeMatch.nextChainIndex, 20);
});
test("legacy director worker remains permanent and transfers the 30 percent service fee to Axero", () => {
  const now = Date.parse("2026-08-06T22:30:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const viewer = account("director-worker-viewer", "高速调用玩家");
  const nextViewer = account("director-worker-next", "等待玩家");
  const axero = account("director-worker-axero", "Axero");
  const seedOwner = account("director-worker-seed", "Akira");
  join(service, viewer, "高速调用球队");
  join(service, nextViewer, "等待球队");
  join(service, axero, "Axero球队");
  join(service, seedOwner, "种子镜像球队");
  const viewerTeam = service.accountTeam(viewer.id);
  const axeroTeam = service.accountTeam(axero.id);
  const mirrorTeam = service.accountTeam(seedOwner.id);
  service.state.season.status = "completed";
  service.state.season.date = "2026-08-06";
  service.state.seasonFinalTournament = { seasonId:service.state.season.id, preview:false, seedSnapshot:[{ teamId:mirrorTeam.id, seed:1, isAi:false }] };
  service.syncForcedSeedMirrorUploads();
  service.wallet(viewer.id).balance = 10_000;
  service.wallet(nextViewer.id).balance = 10_000;
  service.wallet(axero.id).balance = 500;
  const engineVersion = "v2.1-cap99-director-r1";
  const workerId = "axero-director-pc";
  service.registerDirectorMirrorWorker({ workerId, engineVersion, maximumConcurrency:5, activeLeaseIds:[] });
  const directorNode = service.mirrorMarketplaceCatalog(viewer).batchNodes.find((node) => node.id === "director");
  assert.equal(directorNode.online, true);
  assert.equal(directorNode.acceptingJobs, true);
  assert.equal(directorNode.status, "accepting");
  assert.equal(directorNode.capacity, 5);
  assert.equal(directorNode.surchargePerMatch, 0);

  const mirrorSchemeId = service.state.mirrorMarketplace.uploads[seedOwner.id].snapshots[0].schemeId;
  const config = (requestId) => ({
    requestId,
    executionNode:"director",
    mirrorTeamId:mirrorTeam.id,
    mirrorKind:"full",
    mirrorSchemeId,
    attackFocus:"balanced",
    defenseFocus:"balanced",
    tacticalPlans:{ opening:{ tactic:"balanced", style:"possession" }, leading:{ tactic:"defensive", style:"counterAttack" }, trailing:{ tactic:"positive", style:"wingPlay" } },
  });
service.registerDirectorMirrorWorker({ workerId, engineVersion, maximumConcurrency:5, activeLeaseIds:[], acceptingJobs:false });
  const standbyNode = service.mirrorMarketplaceCatalog(viewer).batchNodes.find((node) => node.id === "director");
  assert.equal(standbyNode.online, true);
  assert.equal(standbyNode.acceptingJobs, false);
  assert.equal(standbyNode.status, "standby");
  assert.equal(standbyNode.availableSlots, 0);
  const standbyBalance = service.wallet(viewer.id).balance;
  assert.throws(() => service.createMirrorBatchSimulation(viewer, config("director-standby-request")), /在线待机/);
  assert.equal(service.wallet(viewer.id).balance, standbyBalance);
  service.registerDirectorMirrorWorker({ workerId, engineVersion, maximumConcurrency:5, activeLeaseIds:[], acceptingJobs:true });
  const created = service.createMirrorBatchSimulation(viewer, config("director-request-1"));
  assert.equal(created.mirrorBatchJob.executionNode, "director");
  assert.equal(created.mirrorBatchJob.subtotal, 1000);
  assert.equal(created.mirrorBatchJob.serviceFee, 300);
  assert.equal(created.mirrorBatchJob.directorSurcharge, 0);
  assert.equal(created.mirrorBatchJob.directorServiceFeeRevenue, 300);
  assert.equal(created.mirrorBatchJob.totalCost, 1300);
  assert.equal(service.wallet(viewer.id).balance, 8700);
  assert.equal(service.wallet(axero.id).balance, 800);
  const revenueMail = service.state.inbox[axeroTeam.id].find((message) => message.type === "director-worker-revenue");
  assert.ok(revenueMail);
  assert.equal(revenueMail.payload.amount, 300);
  assert.equal(revenueMail.payload.source, "batch-service-fee");
  assert.match(revenueMail.body, /30%批量服务费共300金币.*Axero/);
  const repeated = service.createMirrorBatchSimulation(viewer, config("director-request-1"));
  assert.equal(repeated.mirrorBatchJob.id, created.mirrorBatchJob.id);
  assert.equal(service.wallet(viewer.id).balance, 8700);
  assert.equal(service.wallet(axero.id).balance, 800);
  assert.equal(service.state.inbox[axeroTeam.id].filter((message) => message.type === "director-worker-revenue").length, 1);

  const lease = service.leaseDirectorMirrorBatchJob({ workerId, engineVersion });
  assert.equal(lease.jobId, created.mirrorBatchJob.id);
  assert.equal(lease.matches.length, 10);
  service.updateDirectorMirrorBatchProgress({ jobId:lease.jobId, leaseId:lease.leaseId, completedMatches:3 });
  assert.equal(service.mirrorMarketplaceCatalog(viewer).activeBatchJob.completedMatches, 3);
  const reports = lease.matches.map(({ number, seed }) => ({
    number,
    seed,
    report:{
      score:[number % 3, 1],
      teams:[
        { stats:{ xg:1.5, shots:10, shotsOnTarget:4, possession:54 }, players:[{ id:"p1", name:"测试球员", rating:7.2, stats:{ goals:1, assists:0 } }] },
        { stats:{ xg:1.1, shots:8, shotsOnTarget:3, possession:46 }, players:[] },
      ],
    },
  }));
  reports[0] = runMirrorBatchWorkerMatch(lease, lease.matches[0]);
  assert.equal("events" in reports[0].report, false);
  assert.ok(Buffer.byteLength(JSON.stringify(reports[0]), "utf8") < 20_000);
  const completed = service.completeDirectorMirrorBatchJob({ jobId:lease.jobId, leaseId:lease.leaseId, reports });
  assert.equal(completed.mirrorBatchJob.status, "completed");
  assert.equal(completed.report.totalMatches, 10);
  assert.equal(completed.report.pricing.directorSurcharge, 0);
  assert.equal(completed.report.pricing.directorServiceFeeRevenue, 300);
  assert.ok(service.state.inbox[viewerTeam.id].some((message) => message.type === "mirror-batch-report"));
  const repeatedCompletion = service.completeDirectorMirrorBatchJob({ jobId:lease.jobId, leaseId:lease.leaseId, reports });
  assert.equal(repeatedCompletion.mirrorBatchJob.status, "completed");
  assert.equal(service.state.inbox[viewerTeam.id].filter((message) => message.type === "mirror-batch-report").length, 1);

  assert.equal(service.state.mirrorMarketplace.batchJobs.some((job) => job.id === lease.jobId), false);
  const completedReceipt = service.state.mirrorMarketplace.batchReceipts.find((receipt) => receipt.id === lease.jobId);
  assert.ok(completedReceipt);
  assert.equal("results" in completedReceipt, false);
  assert.equal("report" in completedReceipt, false);
  for (let index = 0; index < 5; index += 1) service.state.mirrorMarketplace.batchJobs.push({ ...structuredClone(completedReceipt), id:`director-busy-${index}`, ownerId:`busy-${index}`, status:"queued", executionNode:"director", results:[], report:null, completedAt:null, createdAt:now + index + 1 });
  const balanceBefore = service.wallet(nextViewer.id).balance;
  assert.throws(() => service.createMirrorBatchSimulation(nextViewer, config("director-request-capacity")), (error) => error.statusCode === 409 && error.details.length === 5);
  assert.equal(service.wallet(nextViewer.id).balance, balanceBefore);
  assert.equal(service.wallet(axero.id).balance, 800);
});
test("players can mount private or public compute nodes and their own node waives the system service fee", () => {
  let clock = Date.parse("2026-08-06T22:30:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => clock, rng:() => .37 });
  const provider = account("community-worker-owner", "节点主人");
  const stranger = account("community-worker-stranger", "其他玩家");
  const seedOwner = account("community-worker-seed", "Akira");
  join(service, provider, "节点主人球队");
  join(service, stranger, "其他玩家球队");
  join(service, seedOwner, "种子镜像球队");
  const mirrorTeam = service.accountTeam(seedOwner.id);
  service.state.season.status = "completed";
  service.state.season.date = "2026-08-06";
  service.state.seasonFinalTournament = { seasonId:service.state.season.id, preview:false, seedSnapshot:[{ teamId:mirrorTeam.id, seed:1, isAi:false }] };
  service.syncForcedSeedMirrorUploads();
  service.wallet(provider.id).balance = 10_000;

  const saved = service.saveMirrorComputeNode(provider, { label:"节点主人的电脑", maximumConcurrency:3, visibility:"private", rotateToken:true });
  const credential = saved.workerCredential;
  assert.ok(credential.token);
  assert.equal(credential.expiresAt, clock + 12 * 60 * 60 * 1000);
  assert.equal(service.authenticateMirrorComputeNode(credential.nodeId, credential.token).ownerId, provider.id);
  assert.equal(service.mirrorMarketplaceCatalog(stranger).batchNodes.some((node) => node.id === credential.nodeId), false);

  service.registerDirectorMirrorWorker({ workerId:credential.nodeId, engineVersion:credential.engineVersion, maximumConcurrency:3, activeLeaseIds:[], acceptingJobs:true });
  const ownNode = service.mirrorMarketplaceCatalog(provider).batchNodes.find((node) => node.id === credential.nodeId);
  assert.equal(ownNode.isOwned, true);
  assert.equal(ownNode.serviceFeeRate, 0);
  assert.equal(ownNode.capacity, 3);

  const mirrorSchemeId = service.state.mirrorMarketplace.uploads[seedOwner.id].snapshots[0].schemeId;
  const created = service.createMirrorBatchSimulation(provider, {
    requestId:"community-worker-own-request",
    executionNode:credential.nodeId,
    mirrorTeamId:mirrorTeam.id,
    mirrorKind:"full",
    mirrorSchemeId,
    attackFocus:"balanced",
    defenseFocus:"balanced",
    tacticalPlans:{ opening:{ tactic:"balanced", style:"possession" }, leading:{ tactic:"defensive", style:"counterAttack" }, trailing:{ tactic:"positive", style:"wingPlay" } },
  });
  assert.equal(created.mirrorBatchJob.computeNodeOwnerId, provider.id);
  assert.equal(created.mirrorBatchJob.usesOwnComputeNode, true);
  assert.equal(created.mirrorBatchJob.subtotal, 1000);
  assert.equal(created.mirrorBatchJob.serviceFee, 0);
  assert.equal(created.mirrorBatchJob.totalCost, 1000);
  assert.equal(service.wallet(provider.id).balance, 9000);

  service.saveMirrorComputeNode(provider, { nodeId:credential.nodeId, label:"节点主人的电脑", maximumConcurrency:3, visibility:"public" });
  const publicNode = service.mirrorMarketplaceCatalog(stranger).batchNodes.find((node) => node.id === credential.nodeId);
  assert.ok(publicNode);
  assert.equal(publicNode.isOwned, false);
  assert.equal(publicNode.serviceFeeRate, .3);
  const providerBalanceBeforePublicJob = service.wallet(provider.id).balance;
  const publicJob = service.createMirrorBatchSimulation(stranger, {
    requestId:"community-worker-public-request",
    executionNode:credential.nodeId,
    mirrorTeamId:mirrorTeam.id,
    mirrorKind:"full",
    mirrorSchemeId,
    attackFocus:"balanced",
    defenseFocus:"balanced",
    tacticalPlans:{ opening:{ tactic:"balanced", style:"possession" }, leading:{ tactic:"defensive", style:"counterAttack" }, trailing:{ tactic:"positive", style:"wingPlay" } },
  });
  assert.equal(publicJob.mirrorBatchJob.serviceFee, 300);
  assert.equal(publicJob.mirrorBatchJob.playerComputeNodeServiceFeeRevenue, 300);
  assert.equal(service.wallet(provider.id).balance, providerBalanceBeforePublicJob + 300);
  const nodeRevenueMail = service.state.inbox[service.accountTeam(provider.id).id].find((message) => message.type === "compute-node-revenue");
  assert.ok(nodeRevenueMail);
  assert.equal(nodeRevenueMail.payload.amount, 300);
  clock = credential.expiresAt + 1;
  assert.equal(service.authenticateMirrorComputeNode(credential.nodeId, credential.token), null);
});
test("system AI formations can use the permanent director high-speed node during an active season", () => {
  const now = Date.parse("2026-08-07T12:00:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const viewer = account("ai-batch-viewer", "AI批量玩家");
  const axero = account("ai-batch-axero", "Axero");
  join(service, viewer, "AI批量球队");
  join(service, axero, "Axero球队");
  service.state.season.status = "active";
  service.wallet(viewer.id).balance = 5000;
  service.wallet(axero.id).balance = 500;
  const engineVersion = "v2.1-cap99-director-r1";
  service.registerDirectorMirrorWorker({ workerId:"axero-director-pc", engineVersion, maximumConcurrency:5, activeLeaseIds:[], acceptingJobs:true });

  const created = service.createMirrorBatchSimulation(viewer, {
    requestId:"system-ai-director-batch",
    executionNode:"director",
    formation:"4-2-3-1",
    averageOverall:86,
    attackFocus:"left",
    defenseFocus:"balanced",
    tacticalPlans:{ opening:{ tactic:"balanced", style:"possession" }, leading:{ tactic:"defensive", style:"counterAttack" }, trailing:{ tactic:"positive", style:"wingPlay" } },
  });
  assert.equal(created.mirrorBatchJob.mirrorTeamId, null);
  assert.equal(created.mirrorBatchJob.mirrorKind, "system-ai");
  assert.equal(created.mirrorBatchJob.subtotal, 0);
  assert.equal(created.mirrorBatchJob.serviceFee, 0);
  assert.equal(created.mirrorBatchJob.totalCost, 0);
  assert.equal(service.wallet(viewer.id).balance, 5000);
  assert.equal(service.wallet(axero.id).balance, 500);

  const lease = service.leaseDirectorMirrorBatchJob({ workerId:"axero-director-pc", engineVersion });
  assert.equal(lease.jobId, created.mirrorBatchJob.id);
  assert.equal(lease.matches.length, 10);
  assert.match(lease.opponentSeat.name, /AI 训练队 · 4-2-3-1/);
});

test("same-day seed mirror batch revenue is paid after the new-season wallet reset", () => {
  const now = Date.parse("2026-08-07T09:51:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const viewer = account("reset-batch-viewer", "Batch viewer");
  const seedOwner = account("reset-seed-owner", "Akira");
  join(service, viewer, "Batch viewer team");
  join(service, seedOwner, "Seed owner team");
  const seedTeam = service.accountTeam(seedOwner.id);
  service.state.season.status = "completed";
  service.state.season.date = "2026-08-07";
  service.state.seasonFinalTournament = {
    seasonId:service.state.season.id,
    preview:false,
    seedSnapshot:[{ teamId:seedTeam.id, seed:1, isAi:false }],
  };
  service.syncForcedSeedMirrorUploads();
  service.wallet(viewer.id).balance = 10_000;
  service.wallet(seedOwner.id).balance = 321;

  const mirrorSchemeId = service.state.mirrorMarketplace.uploads[seedOwner.id].snapshots[0].schemeId;
  service.createMirrorBatchSimulation(viewer, {
    requestId:"same-day-reset-seed-revenue",
    mirrorTeamId:seedTeam.id,
    mirrorKind:"full",
    mirrorSchemeId,
    attackFocus:"balanced",
    defenseFocus:"balanced",
    tacticalPlans:{ opening:{ tactic:"balanced", style:"possession" }, leading:{ tactic:"defensive", style:"counterAttack" }, trailing:{ tactic:"positive", style:"wingPlay" } },
  });
  assert.equal(service.state.mirrorMarketplace.usageByDate["2026-08-07"][seedOwner.id].ownerRevenue, 700);

  // Exercise resetCompetition directly without invoking the completed-cup guard:
  // the bug was in reset ordering/date filtering, independent of tournament gates.
  service.state.season.status = "registration";
  service.resetCompetition("S2", "new-season", "registration");

  assert.equal(service.wallet(seedOwner.id).balance, 100_700);
  assert.equal(service.state.mirrorMarketplace.usageByDate["2026-08-07"], undefined);
  const settlements = service.state.inbox[seedTeam.id].filter((message) => message.type === "mirror-settlement");
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].payload.ownerRevenue, 700);
});
