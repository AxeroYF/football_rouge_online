import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { YellowDogsLeagueService } from "../versus/league-service.js";
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
  assert.ok(result.ownTeam.roster.every((player) => player.id.startsWith("real-att-")));
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
  service.saveTeam(user, {
    starterIds:team.preferredStarterIds,
    positions:team.positions,
    fitnessThreshold:65,
    tacticalPlans:{ opening:{ tactic:"balanced", style:"possession" }, leading:{ tactic:"parkBus", style:"lowBlock" }, trailing:{ tactic:"allOutAttack", style:"highPress" } },
    attackFocus:"balanced",
    defenseFocus:"balanced",
  });
  const saved = service.view(user).ownTeam;
  assert.deepEqual(saved.tacticalPlans, {
    opening:{ tactic:"balanced", style:"possession" },
    leading:{ tactic:"parkBus", style:"lowBlock" },
    trailing:{ tactic:"allOutAttack", style:"highPress" },
  });
  const fixture = service.state.rounds[0].fixtures.find((entry) => entry.homeId === team.id || entry.awayId === team.id);
  const created = service.createFixtureMatch(fixture, 1, NOW);
  const ownIndex = fixture.homeId === team.id ? 0 : 1;
  const opponentIndex = ownIndex === 0 ? 1 : 0;
  created.match.teams[ownIndex].score = 20;
  created.match.teams[opponentIndex].score = 0;
  advanceVersusMatch(created.match, NOW + 3000);
  assert.equal(created.match.teams[ownIndex].tactic, "parkBus");
  assert.equal(created.match.teams[ownIndex].style, "lowBlock");
  created.match.teams[ownIndex].score = 0;
  created.match.teams[opponentIndex].score = 20;
  advanceVersusMatch(created.match, NOW + 6000);
  assert.equal(created.match.teams[ownIndex].tactic, "allOutAttack");
  assert.equal(created.match.teams[ownIndex].style, "highPress");
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

test("team can be renamed and a paid three-choice pack signs one unique player", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("shop-owner", "Shop Owner");
  join(service, user, "Old Name");
  const renamed = service.renameTeam(user, "New Name");
  assert.equal(renamed.ownTeam.name, "New Name");
  const team = service.accountTeam(user.id);
  const startersBefore = [...team.preferredStarterIds];
  const positionsBefore = structuredClone(team.positions);
  const balanceBefore = renamed.wallet.balance;
  const pack = service.buyPack(user, "ATT");
  assert.equal(pack.wallet.balance, balanceBefore - 2500);
  assert.equal(pack.shop.offer.players.length, 3);
  const playerId = pack.shop.offer.players[0].id;
  const signed = service.choosePack(user, playerId);
  assert.equal(signed.shop.offer, null);
  assert.equal(signed.ownTeam.roster.some((player) => player.id === playerId), true);
  assert.equal(signed.ownTeam.roster.length, 23);
  assert.deepEqual(team.preferredStarterIds, startersBefore);
  assert.deepEqual(team.positions, positionsBefore);
});

test("signing a legendary player sends a league-wide inbox notice to other players", () => {
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
  const notice = service.view(first).inbox.find((message) => message.payload?.playerId === legend.id && message.payload?.teamId === secondTeam.id);
  assert.ok(notice);
  assert.match(notice.title, /签下传奇球员/);
  assert.match(notice.body, new RegExp(legend.name));
  assert.equal(service.view(second).inbox.some((message) => message.id === notice.id), false);
});

test("advanced and elite packs charge their tier price and honor grade guarantees", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("tier-shop", "Tier Shop");
  join(service, user, "Tier FC");
  service.wallet(user.id).balance = 20000;
  const elite = service.buyPack(user, "ATT", "elite");
  assert.equal(elite.wallet.balance, 15000);
  assert.equal(elite.shop.offer.tier.id, "elite");
  assert.ok(elite.shop.offer.players.some((player) => ["S", "A"].includes(player.grade)));
  service.choosePack(user, elite.shop.offer.players[0].id);
  const advanced = service.buyPack(user, "MID", "advanced");
  assert.equal(advanced.wallet.balance, 11500);
  assert.ok(advanced.shop.offer.players.some((player) => ["S", "A", "B"].includes(player.grade)));
});

test("post-draft roster expands to 33 and released players return to the unique pool", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("expanded-roster", "Expanded Roster");
  join(service, user, "Expanded FC");
  service.wallet(user.id).balance = 100000;
  for (let index = 0; index < 11; index += 1) {
    const pack = service.buyPack(user, ["ATT", "MID", "DEF", "GK"][index % 4]);
    service.choosePack(user, pack.shop.offer.players[0].id);
  }
  const team = service.accountTeam(user.id);
  assert.equal(team.rosterIds.length, 33);
  assert.throws(() => service.buyPack(user, "ATT"), /33人名单已满/);
  const releasedId = team.rosterIds.at(-1);
  const releasedPlayer = service.view(user).ownTeam.roster.find((player) => player.id === releasedId);
  const balanceBeforeRelease = service.wallet(user.id).balance;
  assert.equal(releasedPlayer.releaseValue, Math.floor(releasedPlayer.referencePrice * .6));
  service.releasePlayer(user, releasedId);
  assert.equal(service.wallet(user.id).balance, balanceBeforeRelease + releasedPlayer.releaseValue);
  assert.equal(service.unavailablePlayerIds().has(releasedId), false);
  assert.equal(service.view(user).ownTeam.roster.length, 32);
  assert.doesNotThrow(() => service.buyPack(user, "ATT"));
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

test("10队联赛每轮完成5场并在三轮后结算榜单和金币", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW });
  const user = account("player-a", "甲");
  join(service, user, "ydl-team-1");
  service.simulateNextRound();
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
  assert.equal(publicPlayer.minimumPrice, Math.ceil(publicPlayer.referencePrice * .8));
  assert.throws(() => service.listPlayer(seller, playerId, publicPlayer.minimumPrice - 1), /80%/);
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
  assert.equal(renamed.matchRounds.length, 1);
  assert.equal(renamed.matchRounds[0].matches.length, 5);
  const ownSummary = renamed.matchRounds[0].matches.find((match) => match.homeId === renamed.ownTeam.id || match.awayId === renamed.ownTeam.id);
  assert.ok([ownSummary.homeName, ownSummary.awayName].includes("Renamed Club"));
  assert.equal(ownSummary.hasPlayerTeam, true);
  const publicTeam = service.teamDetail(user, renamed.ownTeam.id);
  assert.equal(publicTeam.history.length, 1);
  assert.equal(publicTeam.starters.length, 11);
  assert.equal("tactic" in publicTeam, false);
  assert.equal("style" in publicTeam, false);
  const detail = service.matchDetail(user, ownSummary.id);
  assert.equal(detail.teams.length, 2);
  assert.ok(detail.teams.some((team) => team.name === "Renamed Club"));
  assert.ok(detail.teams.every((team) => team.players.length === 11));
  assert.ok(detail.teams.every((team) => team.players.every((player) => Number.isFinite(player.rating) && Number.isFinite(player.overall) && Number.isFinite(player.position.x))));
  assert.ok(renamed.teamLeaderboards.ratings.every((entry) => entry.teamId === renamed.ownTeam.id));
});

test("every round grants two random-position packs while coins still settle every third round", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("reward-owner", "Reward Owner");
  join(service, user, "Reward FC");
  const startingBalance = service.wallet(user.id).balance;
  service.simulateNextRound();
  let view = service.view(user);
  assert.equal(view.rewardOffers.length, 1);
  assert.equal(service.wallet(user.id).balance, startingBalance);
  assert.equal(view.rewardOffers.every((offer) => offer.round === 1), true);
  assert.equal(view.inbox.some((message) => message.id.includes(":1") && message.payload?.offerIds?.length === 1), true);
  service.simulateNextRound();
  service.simulateNextRound();
  view = service.view(user);
  assert.equal(view.rewardOffers.length, 4);
  assert.deepEqual(Object.fromEntries([1, 2, 3].map((round) => [round, view.rewardOffers.filter((offer) => offer.round === round).length])), { 1:1, 2:1, 3:2 });
  const rewardLedger = service.state.ledger.find((entry) => entry.type === "three-round-reward" && entry.round === 3);
  const recent = service.state.matches.filter((match) => match.round <= 3 && (match.homeId === view.ownTeam.id || match.awayId === view.ownTeam.id));
  const wins = recent.filter((match) => { const index = match.homeId === view.ownTeam.id ? 0 : 1; return match.score[index] > match.score[index === 0 ? 1 : 0]; }).length;
  const draws = recent.filter((match) => match.score[0] === match.score[1]).length;
  assert.equal(rewardLedger.amount, (300 + wins * 90 + draws * 35) * 5);
  assert.equal(view.rewardOffers[0].round, 1);
  assert.equal(view.rewardOffers[0].tierId, "standard");
  assert.equal(view.rewardOffers[0].tier.id, "standard");
  assert.ok(["ATT", "MID", "DEF", "GK"].includes(view.rewardOffers[0].pool));
  assert.equal(view.rewardOffers.every((offer) => offer.players.length === 0), true);
  view = service.openRewardPack(user, view.rewardOffers[0].id);
  assert.equal(view.rewardOffers[0].players.length, 3);
  const playerId = view.rewardOffers[0].players[0].id;
  const team = service.accountTeam(user.id);
  const startersBefore = [...team.preferredStarterIds];
  const positionsBefore = structuredClone(team.positions);
  const claimed = service.chooseRewardPack(user, view.rewardOffers[0].id, playerId);
  assert.equal(claimed.rewardOffers.length, 3);
  assert.equal(claimed.ownTeam.roster.length, 23);
  assert.equal(claimed.ownTeam.roster.some((player) => player.id === playerId), true);
  assert.deepEqual(team.preferredStarterIds, startersBefore);
  assert.deepEqual(team.positions, positionsBefore);
  assert.equal(service.view(user).rewardOffers.length, 3);
});

test("missing round rewards are topped up to two packs without duplicating claimed packs", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("legacy-reward-owner", "Legacy Reward Owner");
  join(service, user, "Legacy Reward FC");
  service.simulateNextRound();
  service.simulateNextRound();
  service.simulateNextRound();
  const offers = service.state.rewardOffers[user.id];
  offers.splice(1, 1);
  delete offers[0].slot;
  delete offers[0].tierId;
  assert.equal(service.view(user).rewardOffers.length, 4);
  const first = service.view(user).rewardOffers[0];
  assert.equal(first.tierId, "standard");
  assert.equal(first.tier.id, "standard");
  const opened = service.openRewardPack(user, first.id).rewardOffers.find((offer) => offer.id === first.id);
  service.chooseRewardPack(user, first.id, opened.players[0].id);
  assert.equal(service.view(user).rewardOffers.length, 3);
  assert.equal(service.state.ledger.filter((entry) => entry.accountId === user.id && entry.type === "round-pack-sign" && entry.round === first.round).length, 1);
});

test("admin schedules a tiered position pack by round and mails every player team", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("admin-reward-first", "First Manager");
  const second = account("admin-reward-second", "Second Manager");
  join(service, first, "First Reward FC");
  join(service, second, "Second Reward FC");
  const scheduled = service.scheduleAdminRewardPack({ round:2, pool:"MID", tierId:"advanced" });
  assert.equal(scheduled.rewardGrants[0].status, "scheduled");
  service.simulateNextRound();
  assert.equal(service.view(first).rewardOffers.some((offer) => offer.source === "admin"), false);
  service.simulateNextRound();
  for (const user of [first, second]) {
    const view = service.view(user);
    const offer = view.rewardOffers.find((entry) => entry.source === "admin");
    assert.ok(offer);
    assert.equal(offer.round, 2);
    assert.equal(offer.pool, "MID");
    assert.equal(offer.tierId, "advanced");
    assert.equal(offer.players.length, 3);
    assert.ok(offer.players.some((player) => ["S", "A", "B"].includes(player.grade)));
    assert.ok(view.inbox.some((message) => message.payload?.grantId === offer.grantId && message.round === 2));
  }
  const grant = service.adminView().rewardGrants[0];
  assert.equal(grant.status, "sent");
  assert.equal(grant.recipientCount, 2);
  assert.equal(grant.failedCount, 0);
  const firstTeam = service.accountTeam(first.id);
  const startersBefore = [...firstTeam.preferredStarterIds];
  const positionsBefore = structuredClone(firstTeam.positions);
  const offer = service.view(first).rewardOffers.find((entry) => entry.source === "admin");
  service.chooseRewardPack(first, offer.id, offer.players[0].id);
  assert.deepEqual(firstTeam.preferredStarterIds, startersBefore);
  assert.deepEqual(firstTeam.positions, positionsBefore);
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
  assert.equal(service.state.season.currentRound, 1);
  assert.equal(service.state.matches.length, 5);
});

test("lightweight league fitness remains competitive across unattended rounds", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW });
  const user = account("fitness-owner", "Fitness Owner");
  join(service, user, "Fitness FC");
  const team = service.accountTeam(user.id);
  for (let round = 0; round < 9; round += 1) service.simulateNextRound();
  const starterFitness = team.preferredStarterIds.map((id) => team.playerState[id].fitness);
  const average = starterFitness.reduce((sum, value) => sum + value, 0) / starterFitness.length;
  assert.ok(Math.min(...starterFitness) >= 75);
  assert.ok(average >= 85);
});
