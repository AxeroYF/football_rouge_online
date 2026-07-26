import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { s4EnhancementChance, YellowDogsLeagueService } from "../versus/league-service.js";
import { REAL_PLAYERS } from "../versus/player-pool.js";
import { advanceVersusMatch } from "../versus/match-engine.js";

const NOW = Date.parse("2026-07-23T10:01:00+08:00");
const account = (id, nickname) => ({ id, nickname });
const CSL_TEAM_NAMES = ["上海海港", "上海申花", "北京国安", "山东泰山", "成都蓉城", "天津津门虎", "浙江队", "河南队", "武汉三镇", "深圳新鹏城"];

function join(service, user, teamName = `${user.nickname}-team`) {
  service.beginDraft(user, teamName);
  service.autoDraft(user);
  return service.finishDraft(user);
}

test("new league states use Chinese Super League names without migrating names in an existing state", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  assert.deepEqual(service.state.teams.map((team) => team.name), CSL_TEAM_NAMES);
  service.state.teams[1].name = "旧存档AI球队";
  service.restartSeason();
  assert.equal(service.state.teams[1].name, "旧存档AI球队");
});

test("黄狗联赛共用球员池中的十四名传奇均为S级", () => {
  const legends = REAL_PLAYERS.filter((player) => player.grade === "S");
  assert.equal(legends.length, 14);
  assert.ok(["贝利", "齐达内", "贝肯鲍尔", "大罗", "罗纳尔迪尼奥", "马拉多纳", "贝克汉姆"].every((name) => legends.some((player) => player.name === name)));
});

test("真人球队通过翻卡三选一接管AI且球员全服唯一", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("player-a", "甲");
  const second = account("player-b", "乙");
  service.beginDraft(first, "Team Alpha");
  let firstDraft = service.drawDraft(first, "GK").draft;
  assert.equal(firstDraft.offer.length, 3);
  const firstPlayerId = firstDraft.offer[0].id;
  service.chooseDraft(first, firstPlayerId);
  service.beginDraft(second, "Team Beta");
  const secondDraft = service.drawDraft(second, "GK").draft;
  assert.equal(secondDraft.offer.some((player) => player.id === firstPlayerId), false);
  assert.throws(() => service.chooseDraft(second, firstPlayerId), /三张卡牌/);
  service.autoDraft(first);
  service.finishDraft(first);
  join(service, second, "Team Beta");
  const firstIds = new Set(service.accountTeam(first.id).rosterIds);
  const secondIds = service.accountTeam(second.id).rosterIds;
  assert.equal(firstIds.size, 22);
  assert.equal(secondIds.length, 22);
  assert.ok(secondIds.every((id) => !firstIds.has(id)));
  assert.equal(service.accountTeam(first.id).name, "Team Alpha");
});

test("manual draft permits any positional composition", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("all-attackers", "Attacker Collector");
  service.beginDraft(user, "All Attack FC");
  for (let index = 0; index < 22; index += 1) {
    const draft = service.drawDraft(user, "ATT").draft;
    assert.deepEqual(draft.allowedPools, ["ATT", "MID", "DEF", "GK"]);
    service.chooseDraft(user, draft.offer[0].id);
  }
  const result = service.finishDraft(user);
  assert.equal(result.ownTeam.name, "All Attack FC");
  assert.equal(result.ownTeam.roster.length, 22);
  assert.ok(result.ownTeam.roster.every((player) => player.pool === "ATT"));
  assert.equal(result.ownTeam.roster.filter((player) => player.starter).length, 11);
  assert.equal(Object.keys(result.ownTeam.positions).length, 11);
});

test("mid-season player takeover notifies existing players of the joining round and replaced AI team", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const existing = account("existing-player", "Existing Manager");
  const newcomer = account("mid-season-player", "New Manager");
  join(service, existing, "Existing FC");
  for (let round = 0; round < 4; round += 1) service.simulateNextRound();

  service.beginDraft(newcomer, "Newcomer FC");
  const draft = service.state.drafts[newcomer.id];
  const replacedTeamName = service.state.teams.find((team) => team.id === draft.teamId).name;
  service.autoDraft(newcomer);
  service.finishDraft(newcomer);

  const notice = service.view(existing).inbox.find((message) => message.id.includes(`:${newcomer.id}`));
  assert.equal(notice.type, "notice");
  assert.equal(notice.round, 5);
  assert.match(notice.title, /第5轮/);
  assert.match(notice.body, new RegExp(replacedTeamName));
  assert.match(notice.body, /New Manager/);
  assert.match(notice.body, /Newcomer FC/);
  assert.match(notice.body, /继承该席位此前的战绩和积分/);
  assert.equal(service.view(newcomer).inbox.some((message) => message.id === notice.id), false);
});

test("saved tactical-board positions and next-match conditions are used by simulation", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW });
  const user = account("tactics-owner", "Tactics Owner");
  join(service, user, "Tactics FC");
  const team = service.accountTeam(user.id);
  const positions = structuredClone(team.positions);
  const movableId = team.preferredStarterIds.find((id) => positions[id].y < 82 && positions[id].y > 24);
  positions[movableId] = { x:33, y:54 };
  service.saveTeam(user, { starterIds:team.preferredStarterIds, positions, tactic:"positive", style:"possession", attackFocus:"left", defenseFocus:"right" });
  const preview = service.nextOpponent(team.id);
  assert.equal(preview.startsAt, service.state.season.nextRoundAt);
  assert.ok(preview.weather?.key);
  assert.ok(preview.referee?.key);
  service.simulateNextRound();
  const match = service.state.matches.find((entry) => entry.homeId === team.id || entry.awayId === team.id);
  const teamIndex = match.homeId === team.id ? 0 : 1;
  const simulatedPlayer = match.report.teams[teamIndex].players.find((player) => player.id === movableId);
  assert.deepEqual(simulatedPlayer.position, positions[movableId]);
  assert.equal(match.report.weather.key, preview.weather.key);
  assert.equal(match.report.referee.key, preview.referee.key);
});

test("fitness red line rotates a fresh same-line substitute and reports the change by inbox", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("rotation-owner", "Rotation Owner");
  join(service, user, "Rotation FC");
  const team = service.accountTeam(user.id);
  const tiredId = team.preferredStarterIds.find((id) => REAL_PLAYERS.find((player) => player.id === id)?.pool === "MID");
  const replacementId = team.rosterIds.find((id) => !team.preferredStarterIds.includes(id) && REAL_PLAYERS.find((player) => player.id === id)?.pool === "MID");
  team.fitnessThreshold = 80;
  team.playerState[tiredId].fitness = 60;
  team.playerState[replacementId].fitness = 100;
  team.positionPresets.position2[tiredId] = { x:31, y:48 };
  team.positionPresets.position3[tiredId] = { x:69, y:34 };
  team.tacticalPlans.leading.positionPreset = "position2";
  team.tacticalPlans.trailing.positionPreset = "position3";
  const fixturePreview = service.state.rounds[0].fixtures.find((entry) => entry.homeId === team.id || entry.awayId === team.id);
  const created = service.createFixtureMatch(fixturePreview, 1, NOW);
  const previewTeamIndex = fixturePreview.homeId === team.id ? 0 : 1;
  const previewOpponentIndex = previewTeamIndex === 0 ? 1 : 0;
  const previewRotation = created.match.leagueAutoRotations[previewTeamIndex].find((entry) => entry.outId === tiredId);
  assert.ok(previewRotation);
  assert.deepEqual(created.match.teams[previewTeamIndex].positionPresets.position2[previewRotation.inId], { x:31, y:48 });
  assert.deepEqual(created.match.teams[previewTeamIndex].positionPresets.position3[previewRotation.inId], { x:69, y:34 });
  created.match.teams[previewTeamIndex].score = 2;
  created.match.teams[previewOpponentIndex].score = 0;
  advanceVersusMatch(created.match, NOW + 3000);
  assert.deepEqual(created.match.teams[previewTeamIndex].positions[previewRotation.inId], { x:31, y:48 });
  assert.deepEqual(created.match.teams[previewTeamIndex].players.find((player) => player.id === previewRotation.inId).boardPosition, { x:31, y:48 });
  service.simulateNextRound();
  const match = service.state.matches.find((entry) => entry.homeId === team.id || entry.awayId === team.id);
  const teamIndex = match.homeId === team.id ? 0 : 1;
  assert.equal(match.report.teams[teamIndex].players.some((player) => player.id === tiredId), false);
  const rotationMail = service.view(user).inbox.find((message) => message.type === "lineup" && message.round === 1);
  assert.ok(rotationMail);
  const rotation = rotationMail.payload.autoRotations.find((entry) => entry.outId === tiredId);
  assert.ok(rotation);
  const replacement = match.report.teams[teamIndex].players.find((player) => player.id === rotation.inId);
  assert.ok(replacement);
  assert.ok(["AM", "DM", "LM", "RM"].includes(replacement.assignedRole));
  assert.equal(team.preferredStarterIds.includes(tiredId), true);
});

test("league match switches opening, leading and trailing tactical plans with the score", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("situational-tactics", "Situational Manager");
  join(service, user, "Situational FC");
  const team = service.accountTeam(user.id);
  const positionPresets = {
    position1:structuredClone(team.positions),
    position2:structuredClone(team.positions),
    position3:structuredClone(team.positions),
  };
  const movableId = team.preferredStarterIds.find((id) => REAL_PLAYERS.find((player) => player.id === id)?.pool === "MID");
  positionPresets.position2[movableId] = { x:28, y:48 };
  positionPresets.position3[movableId] = { x:72, y:34 };
  service.saveTeam(user, {
    starterIds:team.preferredStarterIds,
    positions:positionPresets.position1,
    positionPresets,
    fitnessThreshold:65,
    tacticalPlans:{ opening:{ tactic:"balanced", style:"possession", positionPreset:"position1" }, leading:{ tactic:"parkBus", style:"lowBlock", positionPreset:"position2" }, trailing:{ tactic:"allOutAttack", style:"highPress", positionPreset:"position3" } },
    attackFocus:"balanced",
    defenseFocus:"balanced",
  });
  const saved = service.view(user).ownTeam;
  assert.deepEqual(saved.tacticalPlans, {
    opening:{ tactic:"balanced", style:"possession", positionPreset:"position1" },
    leading:{ tactic:"parkBus", style:"lowBlock", positionPreset:"position2" },
    trailing:{ tactic:"allOutAttack", style:"highPress", positionPreset:"position3" },
  });
  assert.deepEqual(saved.positionPresets, positionPresets);
  const fixture = service.state.rounds[0].fixtures.find((entry) => entry.homeId === team.id || entry.awayId === team.id);
  const created = service.createFixtureMatch(fixture, 1, NOW);
  const ownIndex = fixture.homeId === team.id ? 0 : 1;
  const opponentIndex = ownIndex === 0 ? 1 : 0;
  created.match.teams[ownIndex].score = 20;
  created.match.teams[opponentIndex].score = 0;
  advanceVersusMatch(created.match, NOW + 3000);
  assert.equal(created.match.teams[ownIndex].tactic, "parkBus");
  assert.equal(created.match.teams[ownIndex].style, "lowBlock");
  assert.deepEqual(created.match.teams[ownIndex].positions[movableId], { x:28, y:48 });
  assert.deepEqual(created.match.teams[ownIndex].players.find((player) => player.id === movableId).boardPosition, { x:28, y:48 });
  created.match.teams[ownIndex].score = 0;
  created.match.teams[opponentIndex].score = 20;
  advanceVersusMatch(created.match, NOW + 6000);
  assert.equal(created.match.teams[ownIndex].tactic, "allOutAttack");
  assert.equal(created.match.teams[ownIndex].style, "highPress");
  assert.deepEqual(created.match.teams[ownIndex].positions[movableId], { x:72, y:34 });
  assert.ok(created.match.events.some((event) => event.type === "tactical" && event.plan === "leading"));
  assert.ok(created.match.events.some((event) => event.type === "tactical" && event.plan === "trailing"));
});

test("inbox delivers reports and matchweeks while nearby same-line starters build small chemistry", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("inbox-chemistry", "Inbox Chemistry");
  join(service, user, "Chemistry FC");
  const initialView = service.view(user);
  const dailyMessage = initialView.inbox.find((message) => message.type === "daily-report" && message.report);
  assert.ok(dailyMessage);
  assert.equal(initialView.inboxUnreadCount, 1);
  const readView = service.readInbox(user, dailyMessage.id);
  assert.equal(readView.inboxUnreadCount, 0);
  assert.ok(readView.inbox.find((message) => message.id === dailyMessage.id).readAt);
  const deletedView = service.deleteInbox(user, dailyMessage.id);
  assert.equal(deletedView.inbox.some((message) => message.id === dailyMessage.id), false);
  service.updateDailyReports();
  assert.equal(service.view(user).inbox.some((message) => message.id === dailyMessage.id), false);
  for (let round = 0; round < 5; round += 1) service.simulateNextRound();
  let view = service.view(user);
  assert.equal(view.inbox.filter((message) => message.type === "matchweek").length, 5);
  assert.equal(view.inbox.some((message) => message.type === "reward" && message.payload.amount > 0), true);
  assert.equal(view.inboxUnreadCount, view.inbox.length);
  const matchweekId = view.inbox.find((message) => message.type === "matchweek").id;
  const unreadBefore = view.inboxUnreadCount;
  view = service.readInbox(user, matchweekId);
  assert.equal(view.inboxUnreadCount, unreadBefore - 1);
  assert.ok(view.inbox.find((message) => message.id === matchweekId).readAt);
  view = service.deleteInbox(user, matchweekId);
  assert.equal(view.inbox.some((message) => message.id === matchweekId), false);
  assert.equal(view.inboxUnreadCount, unreadBefore - 1);
  assert.ok(view.ownTeam.chemistryLinks.length > 0);
  assert.ok(view.ownTeam.chemistryLinks.every((link) => {
    const [firstId, secondId] = link.playerIds;
    return link.value >= 30 && Math.abs(view.ownTeam.positions[firstId].y - view.ownTeam.positions[secondId].y) <= 12 && link.bonus <= .015;
  }));
  const team = service.accountTeam(user.id);
  const lineup = service.actualLineup(team, 6);
  const positions = service.actualPositions(team, lineup);
  const adjusted = service.chemistryAdjustedLineup(team, lineup, positions);
  const boosted = adjusted.find((player) => player.leagueChemistryBonus > 0);
  assert.ok(boosted);
  assert.ok(boosted.attributes.passing >= REAL_PLAYERS.find((player) => player.id === boosted.id).attributes.passing);
  assert.ok(boosted.leagueChemistryBonus <= .015);
});

test("team can be renamed and private-pool packs support bulk purchase and direct duplicate cards", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("shop-owner", "Shop Owner");
  join(service, user, "Old Name");
  const renamed = service.renameTeam(user, "New Name");
  assert.equal(renamed.ownTeam.name, "New Name");
  const team = service.accountTeam(user.id);
  const startersBefore = [...team.preferredStarterIds];
  const positionsBefore = structuredClone(team.positions);
  const cardsBefore = service.playerCards(user.id).length;
  const balanceBefore = renamed.wallet.balance;
  const bought = service.buyS4Packs(user, "private-mixed", 3);
  assert.equal(bought.wallet.balance, balanceBefore - 6600);
  assert.equal(bought.s4Packs.inventory.length, 3);
  const opened = service.openS4Pack(user, bought.s4Packs.inventory[0].id);
  assert.equal(opened.packOpening.mode, "direct");
  assert.equal(opened.s4Packs.inventory.length, 2);
  assert.equal(service.playerCards(user.id).length, cardsBefore + 1);
  assert.equal(service.state.s4Assets.ownerships[opened.packOpening.player.id], user.id);
  assert.deepEqual(team.preferredStarterIds, startersBefore);
  assert.deepEqual(team.positions, positionsBefore);
});

test("signing a legendary player no longer sends a league-wide inbox notice", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("legend-observer", "Observer");
  const second = account("legend-owner", "Legend Owner");
  join(service, first, "Observer FC");
  join(service, second, "Legend FC");
  const secondTeam = service.accountTeam(second.id);
  const legend = REAL_PLAYERS.find((player) => player.grade === "S" && !service.unavailablePlayerIds(second.id).has(player.id) && !secondTeam.rosterIds.includes(player.id));
  assert.ok(legend);
  const fillers = REAL_PLAYERS.filter((player) => player.pool === legend.pool && player.grade !== "S" && !service.unavailablePlayerIds(second.id).has(player.id) && !secondTeam.rosterIds.includes(player.id)).slice(0, 2);
  assert.equal(fillers.length, 2);
  service.state.shopOffers[second.id] = { pool:legend.pool, tierId:"elite", playerIds:[legend.id, ...fillers.map((player) => player.id)], purchasedAt:NOW };
  service.choosePack(second, legend.id);
  assert.equal(service.view(first).inbox.some((message) => message.id.startsWith("legend-signing:")), false);
});

test("legend and public packs use three choices with distinct ownership behavior", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("tier-shop", "Tier Shop");
  join(service, user, "Tier FC");
  service.wallet(user.id).balance = 30000;

  let view = service.buyS4Packs(user, "legend-random", 1);
  view = service.openS4Pack(user, view.s4Packs.inventory[0].id);
  assert.equal(view.s4Packs.offer.players.length, 3);
  assert.equal(view.s4Packs.offer.players.every((player) => player.grade === "S"), true);
  const legendId = view.s4Packs.offer.players[0].id;
  view = service.chooseS4Pack(user, view.s4Packs.offer.id, legendId);
  assert.equal(view.packOpening.ownershipGranted, false);
  assert.notEqual(service.state.s4Assets.ownerships[legendId], user.id);

  view = service.buyS4Packs(user, "public-random", 1);
  view = service.openS4Pack(user, view.s4Packs.inventory[0].id);
  assert.equal(view.s4Packs.offer.players.length, 3);
  assert.equal(view.s4Packs.offer.players.every((player) => player.grade !== "S"), true);
  const publicId = view.s4Packs.offer.players[0].id;
  view = service.chooseS4Pack(user, view.s4Packs.offer.id, publicId);
  assert.equal(view.packOpening.ownershipGranted, true);
  assert.equal(service.state.s4Assets.ownerships[publicId], user.id);
});

test("public packs respect the 33-family roster limit and released last cards return ownership", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("expanded-roster", "Expanded Roster");
  join(service, user, "Expanded FC");
  service.wallet(user.id).balance = 100000;
  let view = service.buyS4Packs(user, "public-random", 12);
  for (let index = 0; index < 11; index += 1) {
    view = service.openS4Pack(user, view.s4Packs.inventory[0].id);
    view = service.chooseS4Pack(user, view.s4Packs.offer.id, view.s4Packs.offer.players[0].id);
  }
  assert.equal(service.view(user).ownTeam.s4Assets.rosterSlotsUsed, 33);
  view = service.openS4Pack(user, view.s4Packs.inventory[0].id);
  const blockedPlayerId = view.s4Packs.offer.players[0].id;
  assert.throws(() => service.chooseS4Pack(user, view.s4Packs.offer.id, blockedPlayerId), /33人名单已满/);

  const releasedId = service.accountTeam(user.id).rosterIds.at(-1);
  service.releasePlayer(user, releasedId);
  assert.equal(service.state.s4Assets.ownerships[releasedId], undefined);
  assert.equal(service.view(user).ownTeam.s4Assets.rosterSlotsUsed, 32);
  assert.doesNotThrow(() => service.chooseS4Pack(user, service.view(user).s4Packs.offer.id, blockedPlayerId));
});

test("admin economy view summarizes S4 bulk purchases and duplicate-card releases", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("economy-admin-owner", "Economy Manager");
  join(service, user, "Economy FC");
  service.wallet(user.id).balance = 20000;
  const bought = service.buyS4Packs(user, "private-mixed", 2);
  const opened = service.openS4Pack(user, bought.s4Packs.inventory[0].id);
  service.releaseCard(user, opened.packOpening.card.id);

  const economy = service.adminView().economy.find((entry) => entry.accountId === user.id);
  assert.ok(economy);
  assert.equal(economy.balance, 20000 - 4400 + economy.releases[0].amount);
  assert.equal(economy.shopPackCounts.find((entry) => entry.tierId === "private-mixed").count, 2);
  assert.equal(economy.releases[0].player.id, opened.packOpening.player.id);
  assert.ok(economy.income > 0);
  assert.equal(economy.expense, 4400);
  assert.ok(economy.ledger.some((entry) => entry.type === "s4-pack-buy" && entry.packType === "private-mixed" && entry.quantity === 2));
});

test("admin season controls preserve human squads, reset wallets to 10000 and archive results", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW });
  const user = account("season-owner", "Season Owner");
  join(service, user, "Season FC");
  const rosterIds = [...service.accountTeam(user.id).rosterIds];
  service.wallet(user.id).balance = 12345;
  service.simulateNextRound();
  const restarted = service.restartSeason();
  assert.equal(restarted.season.name, "S1");
  assert.equal(restarted.season.currentRound, 0);
  assert.equal(restarted.matches, 0);
  assert.equal(restarted.archives.length, 1);
  assert.deepEqual(service.accountTeam(user.id).rosterIds, rosterIds);
  assert.equal(service.wallet(user.id).balance, 10000);
  const nextSeason = service.startNewSeason();
  assert.equal(nextSeason.season.name, "S2");
  assert.equal(nextSeason.archives.length, 2);
  assert.deepEqual(service.accountTeam(user.id).rosterIds, rosterIds);
  assert.equal(service.wallet(user.id).balance, 10000);
});

test("daily reports summarize matches, players, availability, tactics and economy", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW });
  const user = account("daily-report", "Daily Report");
  join(service, user, "Report FC");
  service.simulateNextRound();
  const view = service.view(user);
  assert.equal(view.report.date, "2026-07-23");
  assert.equal(view.report.today.played, 1);
  assert.equal(view.report.topPlayers.length > 0, true);
  assert.equal(view.report.availability.total, 22);
  assert.ok(view.report.tactics.formation);
  assert.equal(typeof view.report.managerNote, "string");
  assert.equal(view.reportHistory[0].date, "2026-07-23");
});

test("daily backups retain seven days and full reset removes all league ownership and assets", (t) => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-ydl-backup-test-"));
  t.after(() => rmSync(directory, { recursive:true, force:true }));
  const statePath = path.join(directory, "league.json");
  const backupDir = path.join(directory, "backups");
  mkdirSync(backupDir, { recursive:true });
  writeFileSync(path.join(backupDir, "2026-07-01.json"), "{}", "utf8");
  let currentTime = NOW;
  const service = new YellowDogsLeagueService({ statePath, backupDir, now:() => currentTime, rng:() => .37 });
  const user = account("full-reset", "Full Reset");
  join(service, user, "Reset FC");
  assert.equal(existsSync(path.join(backupDir, "2026-07-23.json")), true);
  assert.equal(existsSync(path.join(backupDir, "2026-07-01.json")), false);
  currentTime = Date.parse("2026-07-24T00:01:00+08:00");
  assert.equal(service.tick(), false);
  assert.equal(existsSync(path.join(backupDir, "2026-07-24.json")), true);
  service.wallet(user.id).balance = 32100;
  service.fullReset();
  assert.equal(service.accountTeam(user.id), null);
  assert.equal(service.state.teams.every((team) => !team.ownerId), true);
  assert.deepEqual(service.state.wallets, {});
  assert.deepEqual(service.state.drafts, {});
  assert.deepEqual(service.state.listings, []);
  assert.deepEqual(service.state.matches, []);
  assert.ok(readdirSync(backupDir).some((name) => name.startsWith("before-full-reset-")));
});

test("fresh season increments the season while clearing all YDL assets for a new draft", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("fresh-season", "Fresh Season");
  join(service, user, "Fresh FC");
  service.state.season.name = "S2";
  service.wallet(user.id).balance = 32100;
  service.startFreshSeason();
  assert.equal(service.state.season.name, "S3");
  assert.equal(service.state.season.status, "registration");
  assert.equal(service.state.season.nextRoundAt, null);
  assert.equal(service.accountTeam(user.id), null);
  assert.deepEqual(service.state.wallets, {});
  assert.deepEqual(service.state.drafts, {});
  assert.deepEqual(service.state.listings, []);
  assert.equal(service.state.cup.status, "waiting");
  assert.equal(service.state.season.currentRound, 0);
});

test("fresh-season registration waits for admin before league simulation starts", () => {
  let currentTime = NOW;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => currentTime, rng:() => .37 });
  service.startFreshSeason();
  const user = account("registration-owner", "Registration Owner");
  join(service, user, "Registration FC");
  assert.equal(service.state.teams.filter((team) => team.ownerId).length, 1);
  assert.equal(service.state.teams.filter((team) => !team.ownerId).length, 9);
  assert.deepEqual(service.view(user).schedule.fixtures, []);
  assert.equal(service.tick(), false);
  assert.throws(() => service.simulateNextRound(), /报名选人阶段/);
  currentTime = Date.parse("2026-07-23T11:55:00+08:00");
  service.startLeagueSimulation();
  assert.equal(service.state.season.status, "active");
  assert.equal(service.state.season.nextRoundAt, Date.parse("2026-07-23T12:00:00+08:00"));
  assert.equal(service.state.season.firstRoundAt, Date.parse("2026-07-23T12:00:00+08:00"));
  assert.equal(service.view(user).schedule.fixtures.length, 18);
  assert.throws(() => service.startLeagueSimulation(), /已经开启/);
});

test("cup schedule follows the manually started league timeline", () => {
  let currentTime = NOW;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => currentTime, rng:() => .37 });
  service.startFreshSeason();
  currentTime = Date.parse("2026-07-23T11:55:00+08:00");
  service.startLeagueSimulation();
  service.startCup();
  assert.equal(service.state.season.firstRoundAt, Date.parse("2026-07-23T12:00:00+08:00"));
  assert.equal(service.state.cup.nextRoundAt, Date.parse("2026-07-23T12:10:00+08:00"));
  currentTime = Date.parse("2026-07-23T12:11:00+08:00");
  service.simulatePendingCupEvent();
  assert.equal(service.state.cup.nextRoundAt, Date.parse("2026-07-23T12:30:00+08:00"));
});

test("admin can grant distinct S2 and S3 cup champion badges", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("cup-badge", "Cup Champion");
  join(service, user, "Cup FC");
  service.awardChampionBadge({ accountId:user.id, season:"S2", competition:"cup" });
  service.awardChampionBadge({ accountId:user.id, season:"S3", competition:"cup" });
  const badges = service.accountTeam(user.id).championBadges;
  assert.deepEqual(badges.map((badge) => [badge.competition, badge.season]), [["cup", "S2"], ["cup", "S3"]]);
  assert.throws(() => service.awardChampionBadge({ accountId:user.id, season:"S2", competition:"cup" }));
});

test("10队联赛每轮完成5场并在三轮后结算榜单和金币", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW });
  const user = account("player-a", "甲");
  join(service, user, "ydl-team-1");
  const beforeRound = service.view(user);
  service.simulateNextRound();
  const afterRound = service.view(user);
  assert.ok(afterRound.updatedAt > beforeRound.updatedAt);
  assert.equal(afterRound.season.currentRound, 1);
  assert.ok(afterRound.teams.every((team) => team.table.played === 1));
  service.simulateNextRound();
  service.simulateNextRound();
  assert.equal(service.state.matches.length, 15);
  assert.ok(service.state.teams.every((team) => team.table.played === 3));
  assert.equal(service.state.teams.reduce((sum, team) => sum + team.table.points, 0) >= 20, true);
  assert.ok(service.wallet(user.id).balance > 10000);
  assert.ok(service.leaderboards().scorers.length > 0);
  assert.ok(service.leaderboards().assists.length > 0);
});

test("停赛球员缺席下一轮并在赛后恢复可用", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW });
  const user = account("player-a", "甲");
  join(service, user, "ydl-team-1");
  const team = service.accountTeam(user.id);
  const suspendedId = team.preferredStarterIds[1];
  team.playerState[suspendedId].suspension = 1;
  service.simulateNextRound();
  const ownMatch = service.state.matches.find((match) => match.homeId === team.id || match.awayId === team.id);
  const reportIndex = ownMatch.homeId === team.id ? 0 : 1;
  assert.equal(ownMatch.report.teams[reportIndex].players.some((player) => player.id === suspendedId), false);
  assert.equal(team.playerState[suspendedId].suspension, 0);
});

test("交易需要名单空位并完成球员唯一所有权转移", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW });
  const seller = account("seller", "卖方");
  const buyer = account("buyer", "买方");
  join(service, seller, "ydl-team-1");
  join(service, buyer, "ydl-team-2");
  const sellerTeam = service.accountTeam(seller.id);
  const buyerTeam = service.accountTeam(buyer.id);
  const playerId = sellerTeam.rosterIds.find((id) => !sellerTeam.preferredStarterIds.includes(id));
  const sellerStartersBefore = [...sellerTeam.preferredStarterIds];
  const sellerPositionsBefore = structuredClone(sellerTeam.positions);
  service.state.wallets[buyer.id].balance = 50000;
  const publicPlayer = service.view(seller).ownTeam.roster.find((player) => player.id === playerId);
  assert.equal(publicPlayer.minimumPrice, Math.ceil(publicPlayer.referencePrice * .5));
  assert.throws(() => service.listPlayer(seller, playerId, publicPlayer.minimumPrice - 1), /50%/);
  const price = publicPlayer.minimumPrice;
  const listingView = service.listPlayer(seller, playerId, price);
  const listing = listingView.listings.find((entry) => entry.playerId === playerId);
  service.buyListing(buyer, listing.id);
  assert.equal(sellerTeam.rosterIds.includes(playerId), false);
  assert.equal(buyerTeam.rosterIds.includes(playerId), true);
  assert.equal(buyerTeam.rosterIds.length, 23);
  assert.deepEqual(sellerTeam.preferredStarterIds, sellerStartersBefore);
  assert.deepEqual(sellerTeam.positions, sellerPositionsBefore);
  assert.equal(service.state.listings.find((entry) => entry.id === listing.id).status, "sold");
});

test("round results, team history and saved match details expose complete public data", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW });
  const user = account("history-owner", "History Owner");
  join(service, user, "Original Club Name");
  service.simulateNextRound();
  const renamed = service.renameTeam(user, "Renamed Club");
  assert.equal(renamed.matchRounds.length, 18);
  assert.equal(renamed.matchRounds[0].matches.length, 5);
  const ownSummary = renamed.matchRounds[0].matches.find((match) => match.homeId === renamed.ownTeam.id || match.awayId === renamed.ownTeam.id);
  assert.ok([ownSummary.homeName, ownSummary.awayName].includes("Renamed Club"));
  assert.equal(ownSummary.hasPlayerTeam, true);
  const futureOwnFixture = renamed.matchRounds[1].matches.find((match) => match.homeId === renamed.ownTeam.id || match.awayId === renamed.ownTeam.id);
  assert.equal(futureOwnFixture.pending, true);
  assert.equal(futureOwnFixture.score, null);
  assert.equal(futureOwnFixture.hasDetails, false);
  const publicTeam = service.teamDetail(user, renamed.ownTeam.id);
  assert.equal(publicTeam.history.length, 1);
  assert.equal(publicTeam.starters.length, 11);
  assert.ok(publicTeam.starters.every((player) => Number.isInteger(player.upgradeLevel)));
  assert.equal("tactic" in publicTeam, false);
  assert.equal("style" in publicTeam, false);
  const detail = service.matchDetail(user, ownSummary.id);
  assert.equal(detail.teams.length, 2);
  assert.ok(detail.teams.some((team) => team.name === "Renamed Club"));
  assert.ok(detail.teams.every((team) => team.players.length === 11));
  assert.ok(detail.teams.every((team) => team.players.every((player) => Number.isFinite(player.rating) && Number.isFinite(player.overall) && Number.isFinite(player.position.x))));
  assert.ok(detail.teams.every((team) => team.players.every((player) => Number.isInteger(player.upgradeLevel))));
  assert.ok(renamed.teamLeaderboards.ratings.every((entry) => entry.teamId === renamed.ownTeam.id));
});

test("player schedule exposes confirmed league fixtures with stable kickoff times and results", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("schedule-owner", "Schedule Manager");
  join(service, user, "Calendar FC");
  let fixtures = service.view(user).schedule.fixtures;
  assert.equal(fixtures.length, 18);
  assert.equal(fixtures[0].startsAt, service.state.season.nextRoundAt);
  assert.equal(fixtures[1].startsAt - fixtures[0].startsAt, 20 * 60 * 1000);
  assert.ok(fixtures.every((fixture) => fixture.competition === "league" && fixture.opponentId && fixture.status === "scheduled"));

  service.simulateNextRound();
  fixtures = service.view(user).schedule.fixtures;
  assert.equal(fixtures[0].status, "complete");
  assert.ok(fixtures[0].matchId);
  assert.equal(fixtures[0].score.length, 2);
  assert.equal(fixtures[1].status, "scheduled");
});

test("league rounds no longer grant old-season packs while coins still settle every third round", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("reward-owner", "Reward Owner");
  join(service, user, "Reward FC");
  const startingBalance = service.wallet(user.id).balance;
  service.simulateNextRound();
  let view = service.view(user);
  assert.equal(view.rewardOffers.length, 0);
  assert.equal(view.s4Packs.inventory.length, 0);
  assert.equal(service.wallet(user.id).balance, startingBalance);
  service.simulateNextRound();
  service.simulateNextRound();
  view = service.view(user);
  assert.equal(view.rewardOffers.length, 0);
  assert.equal(view.s4Packs.inventory.length, 0);
  const rewardLedger = service.state.ledger.find((entry) => entry.type === "three-round-reward" && entry.round === 3);
  const recent = service.state.matches.filter((match) => match.round <= 3 && (match.homeId === view.ownTeam.id || match.awayId === view.ownTeam.id));
  const wins = recent.filter((match) => { const index = match.homeId === view.ownTeam.id ? 0 : 1; return match.score[index] > match.score[index === 0 ? 1 : 0]; }).length;
  const draws = recent.filter((match) => match.score[0] === match.score[1]).length;
  assert.equal(rewardLedger.amount, (300 + wins * 90 + draws * 35) * 5);
  assert.ok(view.inbox.some((message) => message.round === 3 && message.title.includes("金币")));
});

test("S4 bulk purchase limits are enforced and unopened inventory persists", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("legacy-reward-owner", "Legacy Reward Owner");
  join(service, user, "Legacy Reward FC");
  service.wallet(user.id).balance = 300000;
  const cardsBefore = service.playerCards(user.id).length;
  const view = service.buyS4Packs(user, "private-gk", 100);
  assert.equal(view.s4Packs.inventory.length, 100);
  assert.equal(service.view(user).s4Packs.inventory.length, 100);
  assert.equal(service.playerCards(user.id).length, cardsBefore);
  assert.throws(() => service.buyS4Packs(user, "private-gk", 101), /单次最多购买100份礼包/);
});

test("直接随机礼包支持批量开启并一次返回全部球员卡结果", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("direct-batch-pack-owner", "Direct Batch Owner");
  join(service, user, "Direct Batch FC");
  service.wallet(user.id).balance = 100000;
  const cardsBefore = service.playerCards(user.id).length;
  const bought = service.buyS4Packs(user, "private-mixed", 10);
  const packIds = bought.s4Packs.inventory.map((item) => item.id);
  const opened = service.openS4PacksBatch(user, packIds);
  assert.equal(opened.packBatchOpening.mode, "direct");
  assert.equal(opened.packBatchOpening.complete, true);
  assert.equal(opened.packBatchOpening.results.length, 10);
  assert.ok(opened.packBatchOpening.results.every((result) => result.player && result.card));
  assert.equal(opened.s4Packs.inventory.length, 0);
  assert.equal(service.playerCards(user.id).length, cardsBefore + 10);
});

test("三选一礼包批量开启会逐包生成候选直到全部选择完成", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("choice-batch-pack-owner", "Choice Batch Owner");
  join(service, user, "Choice Batch FC");
  service.wallet(user.id).balance = 100000;
  let view = service.buyS4Packs(user, "legend-random", 3);
  const packIds = view.s4Packs.inventory.map((item) => item.id);
  view = service.openS4PacksBatch(user, packIds);
  assert.equal(view.s4Packs.batchOpening.total, 3);
  assert.equal(view.s4Packs.offer.batchIndex, 1);
  assert.equal(view.s4Packs.offer.batchTotal, 3);

  for (let index = 1; index <= 3; index += 1) {
    const offer = view.s4Packs.offer;
    view = service.chooseS4Pack(user, offer.id, offer.players[0].id);
    if (index < 3) {
      assert.equal(view.packBatchOpening.complete, false);
      assert.equal(view.s4Packs.batchOpening.completed, index);
      assert.equal(view.s4Packs.offer.batchIndex, index + 1);
    }
  }

  assert.equal(view.packBatchOpening.complete, true);
  assert.equal(view.packBatchOpening.results.length, 3);
  assert.equal(view.s4Packs.batchOpening, null);
  assert.equal(view.s4Packs.offer, null);
  assert.equal(view.s4Packs.inventory.length, 0);
});

test("admin immediately grants S4 packs to all player teams and sends inbox notices", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("admin-reward-first", "First Manager");
  const second = account("admin-reward-second", "Second Manager");
  join(service, first, "First Reward FC");
  join(service, second, "Second Reward FC");
  const result = service.grantS4PacksFromAdmin({ packType:"private-mid", quantity:2, recipientMode:"all" });
  const grant = result.s4PackGrants.at(-1);
  assert.equal(grant.packType, "private-mid");
  assert.equal(grant.recipientCount, 2);
  for (const user of [first, second]) {
    const view = service.view(user);
    const granted = view.s4Packs.inventory.filter((item) => item.grantId === grant.id);
    assert.equal(granted.length, 2);
    assert.ok(view.inbox.some((message) => message.payload?.grantId === grant.id && message.payload?.quantity === 2));
  }
});

test("admin specified-player grants only reach the selected completed teams", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("team-created-first", "First Builder");
  const second = account("team-created-second", "Second Builder");
  join(service, first, "First Builder FC");
  join(service, second, "Second Builder FC");
  const result = service.grantS4PacksFromAdmin({ packType:"public-random", quantity:3, recipientMode:"specified", accountIds:[second.id] });
  const grant = result.s4PackGrants.at(-1);
  assert.deepEqual(grant.recipientIds, [second.id]);
  assert.equal(service.view(first).s4Packs.inventory.length, 0);
  assert.equal(service.view(second).s4Packs.inventory.filter((item) => item.grantId === grant.id).length, 3);
});

test("admin can grant every S4 pack type through the replacement grant system", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("admin-mixed-owner", "Mixed Manager");
  join(service, user, "Mixed Reward FC");
  const types = service.adminView().s4PackCatalog.map((entry) => entry.id);
  assert.deepEqual(types, ["legend-random", "private-mixed", "private-att", "private-mid", "private-def", "private-gk", "public-random"]);
  types.forEach((packType) => service.grantS4PacksFromAdmin({ packType, quantity:1, recipientMode:"specified", accountIds:[user.id] }));
  const view = service.view(user);
  assert.equal(view.s4Packs.inventory.length, types.length);
  assert.deepEqual(new Set(view.s4Packs.inventory.map((item) => item.packType)), new Set(types));
});

test("admin can grant a specified player card at any upgrade level to any completed player", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("admin-card-first", "First Card Manager");
  const second = account("admin-card-second", "Second Card Manager");
  join(service, first, "First Card FC");
  join(service, second, "Second Card FC");
  const firstTeam = service.accountTeam(first.id);
  const secondTeam = service.accountTeam(second.id);
  const playerId = firstTeam.preferredStarterIds[0];
  const before = service.playerCards(second.id, playerId).length;

  const adminView = service.grantS4PlayerCardsFromAdmin({
    accountId:second.id,
    playerId,
    upgradeLevel:8,
    quantity:2,
  });

  const grantedCards = service.playerCards(second.id, playerId);
  assert.equal(grantedCards.length, before + 2);
  assert.ok(grantedCards.slice(0, 2).every((card) => card.upgradeLevel === 8 && card.externalAcquisition));
  assert.equal(service.state.s4Assets.ownerships[playerId], first.id);
  assert.ok(secondTeam.rosterIds.includes(playerId));
  assert.equal(adminView.s4CardGrants[0].playerId, playerId);
  assert.equal(adminView.s4CardGrants[0].upgradeLevel, 8);
  assert.equal(adminView.s4CardGrants[0].quantity, 2);
  assert.ok(service.view(second).inbox.some((message) => message.payload?.grantId === adminView.s4CardGrants[0].id));
  const unownedPlayer = REAL_PLAYERS.find((player) => !player.legendAbility && !service.state.s4Assets.ownerships[player.id]);
  service.grantS4PlayerCardsFromAdmin({ accountId:second.id, playerId:unownedPlayer.id, upgradeLevel:3, quantity:1 });
  assert.equal(service.state.s4Assets.ownerships[unownedPlayer.id], second.id);
  assert.ok(secondTeam.rosterIds.includes(unownedPlayer.id));
  assert.throws(() => service.grantS4PlayerCardsFromAdmin({ accountId:second.id, playerId, upgradeLevel:9 }), /强化等级必须为0至8/);
});

test("S4同名卡强化消耗副卡并把成功主卡提升一级", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const user = account("enhancement-success", "Enhancement Success");
  join(service, user, "Enhancement Success FC");
  const playerId = service.accountTeam(user.id).rosterIds[0];
  service.grantS4PlayerCardsFromAdmin({ accountId:user.id, playerId, upgradeLevel:7, quantity:2 });
  const [main, material] = service.playerCards(user.id, playerId).filter((card) => card.upgradeLevel === 7).slice(0, 2);
  const balanceBefore = service.wallet(user.id).balance;
  const view = service.enhanceS4Card(user, main.id, material.id, true);

  assert.equal(view.enhancementResult.success, true);
  assert.equal(view.enhancementResult.chance, 22);
  assert.equal(view.enhancementResult.afterLevel, 8);
  assert.equal(service.state.s4Assets.cards[main.id].upgradeLevel, 8);
  assert.equal(service.state.s4Assets.cards[material.id].status, "recycled");
  assert.equal(service.wallet(user.id).balance, balanceBefore - 5000);
  assert.equal(view.enhancementResult.traitOffer.traits.length, 3);
  assert.ok(view.enhancementResult.traitOffer.traits.every((trait) => trait.summary && Array.isArray(trait.eligibleRoleGroups)));
  const chosenTrait = view.enhancementResult.traitOffer.traits[0];
  const chosen = service.chooseS4EnhancementTrait(user, view.enhancementResult.traitOffer.id, chosenTrait.id);
  assert.equal(chosen.enhancementTraitResult.trait.id, chosenTrait.id);
  assert.ok(service.state.s4Assets.cards[main.id].traitIds.includes(chosenTrait.id));
});

test("S4代表卡的多个YDL特性会同时进入联赛首发和默契计算", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const user = account("ydl-multi-trait", "YDL Multi Trait");
  join(service, user, "Multi Trait FC");
  const team = service.accountTeam(user.id);
  const playerId = team.preferredStarterIds.find((id) => REAL_PLAYERS.find((player) => player.id === id)?.role !== "GK");
  const card = service.representativeCard(user.id, playerId);
  card.upgradeLevel = 8;
  card.traitIds = ["aerial-beacon", "shadow-marker"];
  const lineup = service.actualLineup(team, 1);
  const positions = service.actualPositions(team, lineup);
  const adjusted = service.chemistryAdjustedLineup(team, lineup, positions);
  const carrier = adjusted.find((player) => player.id === playerId);

  assert.equal(carrier.upgradeLevel, 8);
  assert.deepEqual(carrier.traits, ["aerial-beacon", "shadow-marker"]);
  assert.ok(Number(carrier.leagueChemistryBonus) > 0);
  assert.ok(adjusted.some((player) => player.id !== playerId && Number(player.leagueChemistryBonus) > 0));
});

test("YDL比赛首发会应用国家队和俱乐部双羁绊加成", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const team = { ownerId:null };
  const lineup = Array.from({ length:11 }, (_, index) => ({
    ...REAL_PLAYERS[index],
    id:`bond-lineup-${index}`,
    nationality:"西班牙",
    club:"皇家马德里",
    attributes:{ ...REAL_PLAYERS[index].attributes, passing:80 },
  }));
  const adjusted = service.chemistryAdjustedLineup(team, lineup, {});
  assert.ok(adjusted.every((player) => player.ydlBondBonus === .1));
  assert.ok(adjusted.every((player) => player.ydlBondIds.length === 2));
  assert.ok(adjusted.every((player) => player.attributes.passing === 88));
});

test("+5至+8强化成功及关键等级特性绑定会向其他玩家发送全服公告", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const observer = account("enhancement-observer", "Enhancement Observer");
  const owner = account("enhancement-owner", "Enhancement Owner");
  join(service, observer, "Observer FC");
  join(service, owner, "Owner FC");
  const ownerTeam = service.accountTeam(owner.id);
  const expectedChances = [52, 40, 30, 22];

  [4, 5, 6, 7].forEach((beforeLevel, index) => {
    const playerId = ownerTeam.rosterIds[index];
    service.grantS4PlayerCardsFromAdmin({ accountId:owner.id, playerId, upgradeLevel:beforeLevel, quantity:2 });
    const [main, material] = service.playerCards(owner.id, playerId).filter((card) => card.upgradeLevel === beforeLevel).slice(0, 2);
    const view = service.enhanceS4Card(owner, main.id, material.id, false);
    const upgradeLevel = beforeLevel + 1;
    const announcement = service.view(observer).inbox.find((message) =>
      message.id.startsWith("enhancement-success:")
      && message.payload?.playerId === playerId
      && message.payload?.upgradeLevel === upgradeLevel);
    assert.ok(announcement);
    assert.equal(announcement.payload.ownerName, owner.nickname);
    assert.equal(announcement.payload.teamName, ownerTeam.name);
    assert.equal(announcement.payload.chance, expectedChances[index]);
    assert.match(announcement.body, new RegExp(`${expectedChances[index]}%`));
    assert.equal(service.view(owner).inbox.some((message) => message.id === announcement.id), false);

    if ([5, 8].includes(upgradeLevel)) {
      const trait = view.enhancementResult.traitOffer.traits[0];
      service.chooseS4EnhancementTrait(owner, view.enhancementResult.traitOffer.id, trait.id);
      const traitAnnouncement = service.view(observer).inbox.find((message) =>
        message.id.startsWith("enhancement-trait:")
        && message.payload?.playerId === playerId
        && message.payload?.traitId === trait.id);
      assert.ok(traitAnnouncement);
      assert.equal(traitAnnouncement.payload.traitName, trait.name);
      assert.match(traitAnnouncement.body, new RegExp(trait.name));
    }
  });

  const observerAnnouncements = service.view(observer).inbox.filter((message) => message.id.startsWith("enhancement-success:"));
  assert.deepEqual(new Set(observerAnnouncements.map((message) => message.payload.upgradeLevel)), new Set([5, 6, 7, 8]));
  assert.equal(service.view(observer).inbox.filter((message) => message.id.startsWith("enhancement-trait:")).length, 2);
});

test("S4强化失败在+3以上降级，保卡道具会扣金币并阻止降级", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .999 });
  const user = account("enhancement-failure", "Enhancement Failure");
  join(service, user, "Enhancement Failure FC");
  const playerId = service.accountTeam(user.id).rosterIds[0];
  service.grantS4PlayerCardsFromAdmin({ accountId:user.id, playerId, upgradeLevel:4, quantity:4 });
  let cards = service.playerCards(user.id, playerId).filter((card) => card.upgradeLevel === 4).slice(0, 4);
  const unprotected = service.enhanceS4Card(user, cards[0].id, cards[1].id, false);
  assert.equal(unprotected.enhancementResult.success, false);
  assert.equal(unprotected.enhancementResult.afterLevel, 3);
  const balanceBeforeProtection = service.wallet(user.id).balance;
  const protectedResult = service.enhanceS4Card(user, cards[2].id, cards[3].id, true);
  assert.equal(protectedResult.enhancementResult.success, false);
  assert.equal(protectedResult.enhancementResult.afterLevel, 4);
  assert.equal(protectedResult.enhancementResult.protectionUsed, true);
  assert.equal(service.wallet(user.id).balance, balanceBeforeProtection - 900);
});

test("S4强化概率区分稳妥同级卡和娱乐式低级副卡", () => {
  assert.equal(s4EnhancementChance(1, 1), 90);
  assert.equal(s4EnhancementChance(7, 7), 22);
  assert.equal(s4EnhancementChance(7, 1), 1);
});

test("scheduled player fixtures are broadcast live and finalize after match time", () => {
  let currentTime = NOW;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => currentTime });
  const user = account("live-owner", "Live Owner");
  join(service, user, "Live FC");
  assert.equal(service.startScheduledRound(), true);
  const broadcasts = service.broadcasts();
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].code.startsWith("YDL-"), true);
  const watched = service.watch(broadcasts[0].code, "Viewer");
  assert.equal(watched.broadcast.live, true);
  assert.equal(watched.broadcast.spectators.length, 1);
  currentTime += 4 * 60 * 1000;
  assert.deepEqual(service.broadcasts(), []);
  const finalView = service.watchView(broadcasts[0].code, watched.spectatorToken);
  assert.equal(finalView.live, false);
  assert.equal(finalView.match.report?.score.join(":"), finalView.match.score.join(":"));
  assert.ok(finalView.matchId);
  assert.deepEqual(service.leaveWatch(broadcasts[0].code, watched.spectatorToken), { left:true });
  assert.equal(service.state.season.currentRound, 1);
  assert.equal(service.state.matches.length, 5);
});

test("admin cup uses a modified Swiss stage then resolves a two-leg knockout champion", () => {
  let currentTime = NOW;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => currentTime, rng:() => .37 });
  service.startCup();
  assert.equal(service.state.cup.status, "active");
  assert.equal(service.state.cup.swissRounds.length, 1);
  const openingCupFixture = service.teamSchedule(service.state.teams[0].id).find((fixture) => fixture.competition === "cup");
  assert.deepEqual([openingCupFixture.competitionName, openingCupFixture.label], ["黄狗冠军杯", "瑞士轮第1轮"]);
  for (let index = 0; index < 20 && service.state.cup.status !== "completed"; index += 1) {
    service.startScheduledCupEvent();
    currentTime += 10 * 60 * 1000;
  }
  assert.ok(service.state.cup.swissRounds.length >= 3 && service.state.cup.swissRounds.length <= 5);
  assert.equal(service.state.cup.status, "completed");
  assert.ok(service.state.cup.championId);
  assert.equal(service.cupStandings().filter((team) => team.status === "qualified").length, 8);
  assert.equal(service.cupStandings().filter((team) => team.status === "eliminated").length, 2);
  assert.equal(service.state.cup.knockout.quarterfinals.length, 4);
  assert.equal(service.state.cup.knockout.semifinals.length, 2);
  assert.equal(service.state.cup.knockout.final.length, 1);
  assert.equal(service.state.cup.knockout.final[0].legs.length, 1);
});

test("admin league simulation also settles the pending cup event between league rounds", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  service.startCup();
  service.simulateNextRound();
  assert.equal(service.state.season.currentRound, 1);
  assert.equal(service.state.cup.swissRounds[0].status, "complete");
  assert.equal(service.state.cup.swissRounds.length, 2);
  assert.equal(service.state.matches.filter((match) => match.competition === "cup" && match.cupRound === 1).length, 5);
});

test("Swiss stage settles every match with a winner and never awards draw points", () => {
  let currentTime = NOW;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => currentTime, rng:() => .37 });
  service.startCup();
  while (service.state.cup.stage === "swiss") {
    service.startScheduledCupEvent();
    currentTime += 10 * 60 * 1000;
  }
  assert.equal(service.state.cup.swissRounds.every((round) => round.fixtures.every((fixture) => fixture.winnerId)), true);
  assert.equal(service.cupStandings().every((team) => team.drawn === 0 && team.played === team.won + team.lost), true);
  assert.equal(service.cupStandings().filter((team) => team.status === "qualified").length, 8);
  assert.equal(service.cupStandings().filter((team) => team.status === "eliminated").length, 2);
  assert.equal(service.state.matches.filter((match) => match.competition === "cup" && match.cupStage === "swiss").length, service.state.cup.swissRounds.reduce((total, round) => total + round.fixtures.length, 0));
});

test("the eighth-ranked team fills the bracket when a final Swiss round produces three eliminations", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  service.startCup();
  const ids = service.state.teams.map((team) => team.id);
  ids.forEach((id, index) => {
    const table = service.state.cup.table[id];
    table.points = 12 - index;
    table.goalsFor = 20 - index;
    table.status = index < 7 ? "qualified" : "eliminated";
  });
  service.state.cup.swissRounds = [{ number:3, status:"pending", fixtures:[] }];
  service.completeCupEvent({ id:"cup-swiss-3", stage:"swiss", round:3, leg:1, status:"running" });
  const standings = service.cupStandings();
  assert.equal(standings[7].id, ids[7]);
  assert.equal(standings[7].status, "qualified");
  assert.equal(standings.filter((team) => team.status === "qualified").length, 8);
  assert.equal(service.state.cup.knockout.quarterfinals.length, 4);
  assert.ok(service.state.cup.knockout.quarterfinals.flatMap((tie) => tie.teams).includes(ids[7]));
});

test("an odd Swiss field eliminates ninth place before a final six-team seeding round", () => {
  let currentTime = Date.parse("2026-07-23T13:42:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => currentTime, rng:() => .37 });
  service.startCup();
  const standingsOrder = service.state.teams.map((team) => team.id);
  standingsOrder.forEach((teamId, index) => {
    Object.assign(service.state.cup.table[teamId], { played:3, won:index < 2 ? 3 : index === 9 ? 0 : 1, lost:index < 2 ? 0 : index === 9 ? 3 : 2, points:index < 2 ? 9 : 8 - index, goalsFor:10 - index, goalsAgainst:index, status:index < 2 ? "qualified" : index === 9 ? "eliminated" : "active" });
  });
  const rankNine = service.cupStandings().find((team) => team.rank === 9);
  assert.equal(rankNine.status, "active");
  service.state.cup.swissRounds = [{ number:3, status:"complete", fixtures:[] }];
  const event = { id:"cup-swiss-3", stage:"swiss", round:3, leg:1, status:"complete", fixtureIds:[] };
  service.state.cup.events = [event];
  service.state.season.nextRoundAt = Date.parse("2026-07-23T13:40:00+08:00");
  service.completeCupEvent(event);
  assert.equal(service.state.cup.swissRounds[0].automaticEliminationId, rankNine.id);
  assert.equal(service.state.cup.table[rankNine.id].status, "eliminated");
  assert.equal(service.state.cup.knockout.quarterfinals.length, 0);
  assert.equal(service.state.cup.swissRounds.length, 2);
  assert.equal(service.state.cup.swissRounds[1].number, 4);
  assert.equal(service.state.cup.swissRounds[1].fixtures.length, 3);
  assert.deepEqual(new Set(service.state.cup.swissRounds[1].fixtures.flatMap((fixture) => [fixture.homeId, fixture.awayId])), new Set(service.cupStandings().filter((team) => team.status === "active").map((team) => team.id)));
  assert.equal(service.state.season.nextRoundAt, Date.parse("2026-07-23T14:00:00+08:00"));
  assert.equal(service.state.cup.nextRoundAt, Date.parse("2026-07-23T14:10:00+08:00"));
  service.completeCupEvent(event);
  assert.equal(service.state.cup.swissRounds.length, 2);
});

test("a 3-0 Swiss qualifier takes priority over a 3-1 qualifier regardless of goal difference", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  service.startCup();
  const [perfectId, laterId] = service.state.teams.map((team) => team.id);
  Object.values(service.state.cup.table).forEach((table) => { table.points = 0; table.won = 0; table.lost = 3; table.goalsFor = 0; table.goalsAgainst = 10; });
  Object.assign(service.state.cup.table[perfectId], { played:3, won:3, lost:0, points:9, goalsFor:3, goalsAgainst:2, status:"qualified" });
  Object.assign(service.state.cup.table[laterId], { played:4, won:3, lost:1, points:9, goalsFor:20, goalsAgainst:2, status:"qualified" });
  const standings = service.cupStandings();
  assert.equal(standings[0].id, perfectId);
  assert.equal(standings[1].id, laterId);
});

test("Swiss pairings use current cup standings and quarterfinal seeds occupy the intended bracket halves", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  service.startCup();
  const ids = service.state.teams.map((team) => team.id);
  ids.forEach((id, index) => {
    service.state.cup.table[id].points = 20 - index;
    service.state.cup.table[id].goalsFor = 20 - index;
  });
  const secondSwissRound = service.createSwissRound();
  const topSeedFixture = secondSwissRound.fixtures.find((fixture) => fixture.homeId === ids[0] || fixture.awayId === ids[0]);
  const openingFixture = service.state.cup.swissRounds[0].fixtures.find((fixture) => fixture.homeId === ids[0] || fixture.awayId === ids[0]);
  const openingOpponent = openingFixture.homeId === ids[0] ? openingFixture.awayId : openingFixture.homeId;
  const expectedOpponent = ids.slice(1).find((id) => id !== openingOpponent);
  assert.ok(topSeedFixture);
  assert.equal(topSeedFixture.homeId === ids[0] ? topSeedFixture.awayId : topSeedFixture.homeId, expectedOpponent);

  ids.forEach((id, index) => { service.state.cup.table[id].status = index < 8 ? "qualified" : "eliminated"; });
  service.state.cup.swissRounds = [1, 2, 3, 4].map((number) => ({ number, status:number === 4 ? "pending" : "complete", fixtures:[] }));
  const finalSwissEvent = { id:"cup-swiss-4", stage:"swiss", round:4, leg:1, status:"running" };
  service.completeCupEvent(finalSwissEvent);
  const quarterfinalPairs = service.state.cup.knockout.quarterfinals.map((tie) => tie.teams);
  assert.deepEqual(quarterfinalPairs, [[ids[0], ids[7]], [ids[3], ids[4]], [ids[2], ids[5]], [ids[1], ids[6]]]);
});

test("cup rewards grant coins instead of player packs for knockout advancement and champion", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("cup-reward-owner", "Cup Reward Manager");
  join(service, user, "Cup Reward FC");
  const team = service.accountTeam(user.id);
  service.startCup();
  const swissEvent = service.state.cup.events[0];
  assert.equal(service.view(user).s4Packs.inventory.some((item) => item.source === "cup"), false);

  const fixture = service.cupEventFixtures(swissEvent).find((entry) => entry.homeId === team.id || entry.awayId === team.id);
  const home = service.state.teams.find((entry) => entry.id === fixture.homeId);
  const away = service.state.teams.find((entry) => entry.id === fixture.awayId);
  const record = { id:"cup-mail-test", round:swissEvent.round, homeId:home.id, awayId:away.id, homeName:home.name, awayName:away.name, score:[2, 1], formations:[], report:{} };
  service.createCupMatchInbox(home, away, record, swissEvent);
  const report = service.view(user).inbox.find((message) => message.id.includes("cup-matchweek:"));
  assert.ok(report);
  assert.equal(report.type, "matchweek");
  assert.equal(report.payload.competition, "cup");
  assert.equal(report.payload.stage, "swiss");
  assert.equal(report.payload.results[0].id, record.id);

  const balanceBeforeRewards = service.wallet(user.id).balance;
  const advance = service.grantCupReward(team.id, { id:"cup-quarterfinals-leg2", stage:"quarterfinals", round:5, leg:2 }, "advance");
  assert.ok(advance);
  assert.equal(advance.type, "cup-coin-reward");
  assert.equal(advance.amount, 2200);
  const champion = service.grantCupReward(team.id, { id:"cup-final-leg2", stage:"final", round:7, leg:2 }, "champion");
  assert.ok(champion);
  assert.equal(champion.type, "cup-coin-reward");
  assert.equal(champion.amount, 12000);
  assert.equal(service.wallet(user.id).balance, balanceBeforeRewards + 14200);
  assert.equal(service.view(user).s4Packs.inventory.filter((item) => item.source === "cup").length, 0);
  assert.equal(service.grantCupReward(team.id, { id:"cup-final-leg2", stage:"final", round:7, leg:2 }, "champion"), null);
  assert.equal(service.wallet(user.id).balance, balanceBeforeRewards + 14200);
  assert.equal(service.view(user).inbox.filter((message) => message.id.startsWith("cup-reward:")).length, 2);
});

test("league and cup suspensions are isolated while injuries remain shared", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("discipline-owner", "Discipline Manager");
  join(service, user, "Discipline FC");
  const team = service.accountTeam(user.id);
  const starterId = team.preferredStarterIds.find((id) => team.rosterIds.some((candidate) => !team.preferredStarterIds.includes(candidate) && REAL_PLAYERS.find((player) => player.id === candidate)?.pool === REAL_PLAYERS.find((player) => player.id === id)?.pool));
  team.playerState[starterId].cupSuspension = 1;
  assert.equal(service.selectActualLineup(team, 1, "league").lineup.some((player) => player.id === starterId), true);
  assert.equal(service.selectActualLineup(team, 1, "cup").lineup.some((player) => player.id === starterId), false);
  team.playerState[starterId].injuryRounds = 1;
  assert.equal(service.selectActualLineup(team, 1, "league").lineup.some((player) => player.id === starterId), false);
  assert.equal(service.selectActualLineup(team, 1, "cup").lineup.some((player) => player.id === starterId), false);
});

test("lightweight league fitness remains playable while penalizing an unchanged lineup", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("fitness-owner", "Fitness Owner");
  join(service, user, "Fitness FC");
  const team = service.accountTeam(user.id);
  for (let round = 0; round < 9; round += 1) service.simulateNextRound();
  const starterFitness = team.preferredStarterIds.map((id) => team.playerState[id].fitness);
  const average = starterFitness.reduce((sum, value) => sum + value, 0) / starterFitness.length;
  assert.ok(Math.min(...starterFitness) >= 67);
  assert.ok(average >= 74);
  assert.ok(average <= 85);
});
