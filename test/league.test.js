import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { s4EnhancementChance, YellowDogsLeagueService } from "../versus/league-service.js";
import { isXPlayer, REAL_PLAYERS } from "../versus/player-pool.js";
import { S4_ECONOMY, S4_PACK_PRICES, S4_PRICING, s4BaseCardReferenceValue, s4EffectiveOverall, s4EnhancementProtectionCost, s4OwnershipReferenceValue } from "../versus/s4-balance.js";
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

test("黄狗联赛共用球员池包含新增梅老鼠传奇", () => {
  const legends = REAL_PLAYERS.filter((player) => player.grade === "S");
  assert.equal(legends.length, 24);
  assert.ok(["贝利", "齐达内", "贝肯鲍尔", "大罗", "罗纳尔迪尼奥", "马拉多纳", "贝克汉姆", "梅老鼠"].every((name) => legends.some((player) => player.name === name)));
  assert.ok(["内马尔", "儒利奥·塞萨尔", "马尔科·马特拉齐", "盖德·穆勒", "里杰卡尔德", "古利特", "里瓦尔多", "古德温", "迪迪"]
    .every((name) => legends.some((player) => player.name === name)));
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
  assert.equal(firstIds.size, 23);
  assert.equal(secondIds.length, 23);
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
  service.autoDraft(user);
  const result = service.finishDraft(user);
  assert.equal(result.ownTeam.name, "All Attack FC");
  assert.equal(result.ownTeam.roster.length, 23);
  assert.ok(result.ownTeam.roster.every((player) => player.pool === "ATT"));
  assert.equal(result.ownTeam.roster.filter((player) => player.starter).length, 11);
  assert.equal(Object.keys(result.ownTeam.positions).length, 11);
});

test("draft choice returns to the four positional packs before the next three-card offer", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("draft-step", "Draft Step");
  const started = service.beginDraft(user, "Draft Step FC");
  assert.deepEqual(Object.keys(started).sort(), ["draft", "serverTime", "updatedAt"]);
  const first = service.drawDraft(user, "ATT").draft;
  const chosenId = first.offer[0].id;
  const picked = service.chooseDraft(user, chosenId).draft;
  assert.equal(picked.selectedIds.includes(chosenId), true);
  assert.equal(picked.selectedPlayers.length, 1);
  assert.equal(picked.offerPool, null);
  assert.deepEqual(picked.offer, []);
  assert.deepEqual(picked.allowedPools, ["ATT", "MID", "DEF", "GK"]);
  const next = service.drawDraft(user, "GK").draft;
  assert.equal(next.offerPool, "GK");
  assert.equal(next.offer.length, 3);
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

test("team autosave compact response excludes the full league view", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("compact-team-save", "Compact Save");
  join(service, user, "Compact Save FC");
  const team = service.accountTeam(user.id);
  const result = service.saveTeam(user, {
    starterIds:team.preferredStarterIds,
    positions:team.positions,
    positionPresets:team.positionPresets,
    formationLinePresets:team.formationLinePresets,
    fitnessThreshold:97,
    tacticalPlans:team.tacticalPlans,
    attackFocus:"left",
    defenseFocus:"right",
  }, { compact:true });

  assert.deepEqual(Object.keys(result).sort(), ["serverTime", "team", "updatedAt"]);
  assert.equal(result.team.id, team.id);
  assert.equal(result.team.fitnessThreshold, 97);
  assert.equal(result.team.attackFocus, "left");
  assert.equal(result.team.defenseFocus, "right");
  assert.equal("ownTeam" in result, false);
  assert.equal("playerDirectory" in result, false);
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
  const formationLinePresets = {
    position1:{ attack:20, midfield:44, defense:68, goalkeeper:90 },
    position2:{ attack:16, midfield:38, defense:60, goalkeeper:88 },
    position3:{ attack:24, midfield:48, defense:72, goalkeeper:92 },
  };
  const movableId = team.preferredStarterIds.find((id) => REAL_PLAYERS.find((player) => player.id === id)?.pool === "MID");
  positionPresets.position2[movableId] = { x:28, y:48 };
  positionPresets.position3[movableId] = { x:72, y:34 };
  const goalkeeperId = team.preferredStarterIds.find((id) => REAL_PLAYERS.find((player) => player.id === id)?.role === "GK");
  const outfieldIds = team.preferredStarterIds.filter((id) => id !== goalkeeperId);
  outfieldIds.forEach((id, index) => {
    positionPresets.position2[id] = { x:15 + index * 7, y:index < 6 ? 70 : 45 };
    positionPresets.position3[id] = { x:15 + index * 7, y:20 };
  });
  service.saveTeam(user, {
    starterIds:team.preferredStarterIds,
    positions:positionPresets.position1,
    positionPresets,
    formationLinePresets,
    fitnessThreshold:65,
    tacticalPlans:{
      opening:{ tactic:"balanced", style:"possession", positionPreset:"position3", inPossession:"shortPassing", outOfPossession:"highPress", inPossessionDetails:{ tempo:"balanced", directness:"balanced", attackDirection:"leftHalf", chanceCreation:"balanced", longShots:"increase", crossing:"balanced" }, outOfPossessionDetails:{ pressing:"standard", defensiveWidth:"balanced", compactness:"balanced", defenseDirection:"center", marking:"mixed", lineStrategy:"hold" }, tacticalDimensions:{ tempo:41, pressing:52 } },
      leading:{ tactic:"parkBus", style:"lowBlock", positionPreset:"position1", inPossession:"longBall", outOfPossession:"lowBlock", tacticalDimensions:{ defensiveLine:18, compactness:84 } },
      trailing:{ tactic:"allOutAttack", style:"highPress", positionPreset:"position2", inPossession:"vertical", outOfPossession:"manMark", tacticalDimensions:{ tempo:91, pressing:96 } },
    },
    attackFocus:"balanced",
    defenseFocus:"balanced",
  });
  const saved = service.view(user).ownTeam;
  assert.deepEqual(saved.tacticalPlans, {
    opening:{ tactic:"balanced", style:"possession", positionPreset:"position1", inPossession:"shortPassing", outOfPossession:"highPress", inPossessionDetails:{ tempo:"balanced", directness:"balanced", attackDirection:"leftHalf", chanceCreation:"balanced", longShots:"increase", crossing:"balanced" }, outOfPossessionDetails:{ pressing:"standard", defensiveWidth:"balanced", compactness:"balanced", defenseDirection:"center", marking:"mixed", lineStrategy:"hold" }, tacticalDimensions:{ tempo:41, pressing:52 } },
    leading:{ tactic:"parkBus", style:"lowBlock", positionPreset:"position2", inPossession:"longBall", outOfPossession:"lowBlock", tacticalDimensions:{ defensiveLine:18, compactness:84 } },
    trailing:{ tactic:"allOutAttack", style:"highPress", positionPreset:"position3", inPossession:"vertical", outOfPossession:"manMark", tacticalDimensions:{ tempo:91, pressing:96 } },
  });
  assert.deepEqual(saved.positionPresets, positionPresets);
  assert.deepEqual(saved.formationLinePresets, formationLinePresets);
  const fixture = service.state.rounds[0].fixtures.find((entry) => entry.homeId === team.id || entry.awayId === team.id);
  const createdV2 = service.createFixtureMatch(fixture, 1, NOW, { matchEngine:"v2" });
  const ownV2Index = fixture.homeId === team.id ? 0 : 1;
  assert.deepEqual(createdV2.match.teams[ownV2Index].formationLines, formationLinePresets.position1);
  assert.equal(createdV2.match.teams[ownV2Index].inPossession, "shortPassing");
  assert.equal(createdV2.match.teams[ownV2Index].outOfPossession, "highPress");
  assert.equal(createdV2.match.teams[ownV2Index].inPossessionDetails.attackDirection, "leftHalf");
  assert.equal(createdV2.match.teams[ownV2Index].outOfPossessionDetails.defenseDirection, "center");
  assert.equal(createdV2.match.teams[ownV2Index].tacticalDimensions.tempo, 35);
  assert.equal(createdV2.match.teams[ownV2Index].tacticalDimensions.pressing, 74);
  assert.equal(createdV2.match.teams[ownV2Index].tacticalDimensions.defensiveLine, 64);
  const created = service.createFixtureMatch(fixture, 1, NOW);
  const ownIndex = fixture.homeId === team.id ? 0 : 1;
  const opponentIndex = ownIndex === 0 ? 1 : 0;
  created.match.teams[ownIndex].score = 20;
  created.match.teams[opponentIndex].score = 0;
  advanceVersusMatch(created.match, NOW + 3000);
  assert.equal(created.match.teams[ownIndex].tactic, "parkBus");
  assert.equal(created.match.teams[ownIndex].style, "lowBlock");
  assert.deepEqual(created.match.teams[ownIndex].positions[movableId], positionPresets.position2[movableId]);
  assert.deepEqual(created.match.teams[ownIndex].players.find((player) => player.id === movableId).boardPosition, positionPresets.position2[movableId]);
  assert.ok(created.match.teams[ownIndex].bonds.some((bond) => bond.id === "structure:steel-defense"));
  created.match.teams[ownIndex].score = 0;
  created.match.teams[opponentIndex].score = 20;
  advanceVersusMatch(created.match, NOW + 6000);
  assert.equal(created.match.teams[ownIndex].tactic, "allOutAttack");
  assert.equal(created.match.teams[ownIndex].style, "highPress");
  assert.ok(created.match.teams[ownIndex].bonds.some((bond) => bond.id === "structure:blow-them-up"));
  assert.ok(!created.match.teams[ownIndex].bonds.some((bond) => bond.id === "structure:steel-defense"));
  assert.deepEqual(created.match.teams[ownIndex].positions[movableId], positionPresets.position3[movableId]);
  assert.ok(created.match.events.some((event) => event.type === "tactical" && event.plan === "leading"));
  assert.ok(created.match.events.some((event) => event.type === "tactical" && event.plan === "trailing"));
  const ownSnapshots = created.match.analysisTimeline.map((snapshot) => snapshot.teams[ownIndex]);
  assert.ok(ownSnapshots.some((snapshot) => snapshot.plan === "opening"));
  assert.ok(ownSnapshots.some((snapshot) => snapshot.plan === "leading"));
  assert.ok(ownSnapshots.some((snapshot) => snapshot.plan === "trailing"));
  assert.ok(ownSnapshots.every((snapshot) => snapshot.positions && snapshot.players.length === 11));
});

test("联赛、杯赛与友谊赛默认统一使用V2且预测仍可显式使用V1", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("all-v2-competitions", "All V2 Manager");
  join(service, user, "All V2 FC");
  const team = service.accountTeam(user.id);
  const fixture = service.state.rounds[0].fixtures.find((entry) => entry.homeId === team.id || entry.awayId === team.id);

  assert.equal(service.createFixtureMatch(fixture, 1, NOW, { competitionMode:"league" }).match.version, 2);
  assert.equal(service.createFixtureMatch(fixture, 1, NOW, { competitionMode:"cup", regulationOnly:false }).match.version, 2);
  assert.equal(service.createFixtureMatch(fixture, 1, NOW, { competitionMode:"friendly" }).match.version, 2);
  assert.notEqual(service.createFixtureMatch(fixture, 1, NOW, { competitionMode:"league", matchEngine:"v1" }).match.version, 2);
});

test("五场V2直播按全局小切片轮转且读取直播列表不会推进比赛", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("live-slice-owner", "Live Slice Owner");
  join(service, user, "Live Slice FC");
  const round = service.state.rounds[0];
  const matches = round.fixtures.map((fixture, fixtureIndex) => ({
    code:`SLICE-${fixtureIndex + 1}`,
    fixtureIndex,
    spectators:{},
    match:service.createFixtureMatch(fixture, round.number, NOW, { competitionMode:"league" }).match,
  }));
  service.state.liveRound = { roundNumber:round.number, startedAt:NOW, matches, newUnavailable:[] };

  service.advanceLiveSlice(NOW + 60_000);
  assert.equal(matches.reduce((sum, live) => sum + live.match.nextChainIndex, 0), 2);
  const beforeRead = matches.map((live) => live.match.nextChainIndex);
  assert.equal(service.broadcasts().length, 5);
  assert.deepEqual(matches.map((live) => live.match.nextChainIndex), beforeRead);

  service.advanceLiveSlice(NOW + 60_000);
  service.advanceLiveSlice(NOW + 60_000);
  assert.equal(matches.reduce((sum, live) => sum + live.match.nextChainIndex, 0), 6);
  assert.ok(matches.every((live) => live.match.nextChainIndex >= 1));
});

test("服务重启后从V2直播检查点继续而不重新模拟已完成控球链", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-ydl-live-resume-"));
  const statePath = path.join(directory, "league.json");
  try {
    const first = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const user = account("live-resume-owner", "Live Resume Owner");
    join(first, user, "Live Resume FC");
    const round = first.state.rounds[0];
    const fixtureIndex = 0;
    const match = first.createFixtureMatch(round.fixtures[fixtureIndex], round.number, NOW, { competitionMode:"league" }).match;
    match.nextChainIndex = 37;
    first.state.liveRound = { roundNumber:round.number, startedAt:NOW, matches:[{ code:"RESUME-1", fixtureIndex, spectators:{}, match }], newUnavailable:[] };
    first.save({ skipDailyBackup:true });

    const reloaded = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const resumed = reloaded.state.liveRound.matches[0].match;
    assert.equal(resumed.nextChainIndex, 37);
    assert.equal(typeof resumed.rng, "function");
    reloaded.advanceLiveSlice(NOW + 60_000);
    assert.equal(resumed.nextChainIndex, 38);
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
});

test("live V2 matches persist separate checkpoints without rewriting the full league state", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".tmp-ydl-live-checkpoints-"));
  const statePath = path.join(directory, "league.json");
  try {
    const service = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW, rng:() => .37 });
    const round = service.state.rounds[0];
    const matches = round.fixtures.map((fixture, fixtureIndex) => ({
      code:`CHECKPOINT-${fixtureIndex + 1}`,
      fixtureIndex,
      spectators:{},
      match:service.createFixtureMatch(fixture, round.number, NOW, { competitionMode:"league" }).match,
    }));
    service.state.liveRound = { roundNumber:round.number, startedAt:NOW, matches, newUnavailable:[] };
    service.save({ skipDailyBackup:true, skipLiveBackupCopy:true, compact:true });
    const mainStateBefore = readFileSync(statePath, "utf8");

    service.advanceLiveSlice(NOW + 60_000);

    const checkpointDirectory = `${statePath}.live`;
    const checkpointFiles = readdirSync(checkpointDirectory).filter((name) => name.endsWith(".json")).sort();
    assert.deepEqual(checkpointFiles, ["CHECKPOINT-1.json", "CHECKPOINT-2.json"]);
    assert.equal(readFileSync(statePath, "utf8"), mainStateBefore);
    assert.ok(checkpointFiles.every((name) => statSync(path.join(checkpointDirectory, name)).size < statSync(statePath).size));
    assert.equal(service.persistLiveMatch(matches[0], NOW + 80_000), false);
    assert.equal(service.persistLiveMatch(matches[0], NOW + 90_000), true);

    const reloaded = new YellowDogsLeagueService({ statePath, backupDir:null, now:() => NOW + 60_000, rng:() => .37 });
    assert.deepEqual(reloaded.state.liveRound.matches.map((live) => live.match.nextChainIndex), [1, 1, 0, 0, 0]);
    assert.ok(reloaded.state.liveRound.matches.slice(0, 2).every((live) => typeof live.match.rng === "function"));
  } finally {
    rmSync(directory, { recursive:true, force:true });
  }
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
  const compactRead = service.readInbox(user, dailyMessage.id, { compact:true });
  assert.deepEqual(Object.keys(compactRead).sort(), ["inboxUnreadCount", "messageId", "readAt", "serverTime", "updatedAt"]);
  assert.equal(compactRead.messageId, dailyMessage.id);
  assert.equal(compactRead.inboxUnreadCount, 0);
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
  const lineup = team.preferredStarterIds.map((id) => REAL_PLAYERS.find((player) => player.id === id));
  const positions = team.positions;
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
  assert.equal(bought.wallet.balance, balanceBefore - 4800);
  assert.equal(bought.s4Packs.inventory.length, 3);
  const opened = service.openS4Pack(user, bought.s4Packs.inventory[0].id);
  assert.equal(opened.packOpening.mode, "direct");
  assert.equal(opened.s4Packs.inventory.length, 2);
  assert.equal(service.playerCards(user.id).length, cardsBefore + 1);
  assert.equal(service.state.s4Assets.ownerships[opened.packOpening.player.id], user.id);
  assert.deepEqual(team.preferredStarterIds, startersBefore);
  assert.deepEqual(team.positions, positionsBefore);
});

test("shop mutations return compact payloads without rebuilding the full league view", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("shop-compact", "Shop Compact");
  join(service, user, "Shop Compact FC");

  const fullView = service.view;
  service.view = () => { throw new Error("compact shop mutation must not build the full league view"); };
  const bought = service.buyS4Packs(user, "private-mixed", 1, { compact:true });
  service.view = fullView;

  assert.equal(bought.compact, true);
  assert.equal("ownTeam" in bought, false);
  assert.equal("teams" in bought, false);
  assert.equal("playerDirectory" in bought, false);
  assert.equal("recentMatches" in bought, false);
  assert.equal(bought.shop.catalog.find((pack) => pack.id === "private-mixed").purchasedQuantity, 1);
  assert.equal(bought.s4Packs.inventory.length, 1);
});

test("轻量比赛中心只公开本人赛程、历史与电视台数据", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("live-owner", "Live Owner");
  join(service, user, "Live FC");
  const view = service.liveView(user);
  assert.equal(view.team.name, "Live FC");
  assert.ok(Array.isArray(view.schedule));
  assert.ok(Array.isArray(view.history));
  assert.ok(Array.isArray(view.broadcasts));
  assert.equal("roster" in view.team, false);
  assert.equal("wallet" in view, false);
  assert.equal("teams" in view, false);
});

test("比赛预测后台模拟保持隐藏并限制本人比赛、重复类别和单项投资上限", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("prediction-owner", "Prediction Owner");
  join(service, user, "Prediction FC");
  service.ensurePredictionMarkets(Infinity);
  const view = service.view(user);
  assert.equal(view.matchPredictions.length, 5);
  assert.ok(view.matchPredictions.every((market) => !("simulation" in market) && !("payoutRates" in market)));
  assert.ok(view.matchPredictions.every((market) => market.options.cards.some((option) => option.id === "0")));
  assert.ok(view.matchPredictions.every((market) => !("resultHandicap" in market)));
  assert.ok(view.matchPredictions.every((market) => ["主队让球", "客队让球", "均势盘"].includes(market.resultHandicapHint)));
  assert.ok(view.matchPredictions.every((market) => market.closesAt === market.startsAt - 2 * 60 * 1000));
  assert.ok(view.matchPredictions.every((market) => market.options.goals.some((option) => option.label === "11球及以上")));
  assert.ok(view.matchPredictions.every((market) => market.options.cards.some((option) => option.label === "4张及以上")));
  const ownMarket = view.matchPredictions.find((market) => [market.homeId, market.awayId].includes(service.accountTeam(user.id).id));
  const eligibleMarket = view.matchPredictions.find((market) => market.eligible);
  assert.ok(ownMarket);
  assert.ok(eligibleMarket);
  const compactView = service.predictionView(user);
  assert.deepEqual(Object.keys(compactView).sort(), ["matchPredictions", "predictionLeaderboard", "serverTime", "updatedAt", "wallet"]);
  assert.equal(compactView.matchPredictions.length, view.matchPredictions.length);
  assert.equal("ownTeam" in compactView, false);
  assert.equal("playerDirectory" in compactView, false);
  assert.throws(() => service.placeMatchPrediction(user, ownMarket.id, "result", "home", 100), /不能预测自己球队/);
  assert.throws(() => service.placeMatchPrediction(user, eligibleMarket.id, "result", "home", 5001), /1至5000/);
  const balanceBefore = service.wallet(user.id).balance;
  const placed = service.placeMatchPrediction(user, eligibleMarket.id, "result", "home", 5000);
  assert.equal(placed.wallet.balance, balanceBefore - 5000);
  const publicBet = placed.matchPredictions.find((market) => market.id === eligibleMarket.id).myBets[0];
  assert.equal(publicBet.amount, 5000);
  assert.equal("payoutRate" in publicBet, false);
  const placedMail = placed.inbox.find((message) => message.id === `prediction-placed:${publicBet.id}`);
  assert.equal(placedMail.title, "比赛预测已受理");
  assert.match(placedMail.summary, /投资5000金币/);
  assert.equal(placedMail.payload.amount, 5000);
  assert.equal("payoutRate" in placedMail.payload, false);
  assert.throws(() => service.placeMatchPrediction(user, eligibleMarket.id, "result", "away", 100), /只能投资一次/);
  const internalMarket = service.state.matchPredictions.markets[eligibleMarket.id];
  assert.equal(internalMarket.simulation.samples, 24);
  assert.ok(internalMarket.simulation.expected.goals.every(Number.isFinite));
  assert.deepEqual(
    internalMarket.payoutRates.result,
    service.predictionPayoutRates(internalMarket.simulation.counts.result, internalMarket.simulation.samples, ["home", "draw", "away"]),
  );
  assert.ok(internalMarket.payoutRates.result.home > 1);
  service.simulateNextRound();
  const settledBet = service.state.matchPredictions.bets.find((bet) => bet.id === publicBet.id);
  assert.ok(["won", "lost"].includes(settledBet.status));
  const matchReward = service.state.ledger.filter((entry) => entry.accountId === user.id && entry.type === "league-match-reward").reduce((sum, entry) => sum + entry.amount, 0);
  const distribution = service.state.matchPredictions.distributions.find((entry) => entry.competition === "league" && entry.roundKey === "R1");
  assert.ok(distribution);
  assert.equal(distribution.stakes, 5000);
  assert.equal(distribution.payouts, settledBet.payout);
  assert.equal(distribution.systemProfit, 5000 - settledBet.payout);
  assert.equal(service.wallet(user.id).balance, balanceBefore - 5000 + settledBet.payout + matchReward + distribution.amountPerPlayer);
  assert.ok(service.state.ledger.some((entry) => entry.type === "match-prediction-stake" && entry.betId === settledBet.id));
  assert.equal(service.state.ledger.some((entry) => entry.type === "match-prediction-payout" && entry.betId === settledBet.id), settledBet.status === "won");
  const resultMail = service.view(user).inbox.find((message) => message.id === `prediction-result:${settledBet.id}`);
  assert.match(resultMail.title, /完成结算/);
  assert.equal(resultMail.payload.payout, settledBet.payout);
  assert.equal(resultMail.payload.netProfit, settledBet.payout - settledBet.amount);
  assert.match(resultMail.body, /实际结果/);
  assert.equal(resultMail.payload.resultHandicap, internalMarket.resultHandicap);
  assert.deepEqual(resultMail.payload.adjustedScore, [resultMail.payload.score[0] + internalMarket.resultHandicap, resultMail.payload.score[1]]);
  assert.equal("payoutRate" in resultMail.payload, false);
});

test("比赛预测根据模拟比分选择整数让球以平衡胜平负分布", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const scores = [[5, 0], [4, 0], [3, 0], [2, 0], [6, 0], [4, 1], [5, 1], [3, 1]];
  const rawCounts = { home:scores.length, draw:0, away:0 };
  const balanced = service.predictionResultHandicap(scores);
  const spread = (counts) => Math.max(...Object.values(counts)) - Math.min(...Object.values(counts));
  assert.ok(Number.isInteger(balanced.handicap));
  assert.ok(balanced.handicap < 0);
  assert.ok(spread(balanced.counts) < spread(rawCounts));
  assert.equal(Object.values(balanced.counts).reduce((sum, count) => sum + count, 0), scores.length);
});

test("比赛预测在开赛前两分钟由服务端停止投注", () => {
  let now = NOW;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const user = account("prediction-deadline-owner", "Prediction Deadline Owner");
  join(service, user, "Prediction Deadline FC");
  service.ensurePredictionMarkets(Infinity);
  const market = service.view(user).matchPredictions.find((entry) => entry.eligible);
  assert.ok(market);
  assert.equal(market.closesAt, market.startsAt - 2 * 60 * 1000);
  now = market.closesAt - 1;
  assert.equal(service.view(user).matchPredictions.find((entry) => entry.id === market.id).eligible, true);
  now = market.closesAt;
  assert.equal(service.view(user).matchPredictions.find((entry) => entry.id === market.id).eligible, false);
  assert.throws(() => service.placeMatchPrediction(user, market.id, "result", "home", 100), /已经截止/);
});

test("比赛预测同时登记下一轮联赛与下一轮杯赛全部比赛并分批完成后台分析", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("prediction-cup-owner", "Prediction Cup Owner");
  join(service, user, "Prediction Cup FC");
  service.startCup();
  const entries = service.nextPredictionFixtures();
  assert.equal(entries.filter((entry) => entry.competition === "league").length, 5);
  assert.equal(entries.filter((entry) => entry.competition === "cup").length, 5);
  service.ensurePredictionMarkets(0);
  const preparing = service.view(user).matchPredictions;
  assert.equal(preparing.length, 10);
  assert.ok(preparing.every((market) => market.status === "preparing"));
  const cupEntry = entries.find((entry) => entry.competition === "cup");
  service.generatePredictionMarket(cupEntry);
  const cupMarket = service.view(user).matchPredictions.find((market) => market.id === cupEntry.id);
  assert.equal(cupMarket.status, "open");
  assert.equal("simulation" in cupMarket, false);
  assert.equal(service.state.matchPredictions.markets[cupEntry.id].simulation.samples, 24);
});

test("比赛预测按轮统计系统收益并将正收益的50%均分给所有玩家且不会重复发放", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("share-first", "Share First");
  const second = account("share-second", "Share Second");
  join(service, first, "Share First FC");
  join(service, second, "Share Second FC");
  const firstBefore = service.wallet(first.id).balance;
  const secondBefore = service.wallet(second.id).balance;
  service.state.matchPredictions.markets["share-market"] = {
    id:"share-market",
    competition:"league",
    roundKey:"R99",
  };
  service.state.matchPredictions.bets.push({
    id:"share-bet",
    marketId:"share-market",
    accountId:first.id,
    amount:4001,
    payout:0,
    status:"lost",
  });

  const distribution = service.distributePredictionProfit("league", "R99", "黄狗联赛第99轮");
  assert.equal(distribution.stakes, 4001);
  assert.equal(distribution.payouts, 0);
  assert.equal(distribution.systemProfit, 4001);
  assert.equal(distribution.sharePool, 2000);
  assert.equal(distribution.playerCount, 2);
  assert.equal(distribution.amountPerPlayer, 1000);
  assert.equal(distribution.distributedAmount, 2000);
  assert.equal(service.wallet(first.id).balance, firstBefore + 1000);
  assert.equal(service.wallet(second.id).balance, secondBefore + 1000);
  assert.equal(service.state.ledger.filter((entry) => entry.type === "match-prediction-profit-share" && entry.distributionId === distribution.id).length, 2);
  const leaderboard = service.predictionLeaderboard();
  assert.equal(leaderboard[0].teamName, "Share Second FC");
  assert.equal(leaderboard[0].netProfit, 0);
  assert.equal(leaderboard[0].betCount, 0);
  assert.equal(leaderboard[1].teamName, "Share First FC");
  assert.equal(leaderboard[1].netProfit, -4001);
  for (const player of [first, second]) {
    const mail = service.view(player).inbox.find((message) => message.id === `prediction-profit-share:${distribution.id}:${player.id}`);
    assert.equal(mail.title, "比赛预测系统收益均分已到账");
    assert.equal(mail.payload.amount, 1000);
    assert.equal(mail.payload.playerCount, 2);
  }

  const firstAfter = service.wallet(first.id).balance;
  const repeated = service.distributePredictionProfit("league", "R99", "黄狗联赛第99轮");
  assert.equal(repeated.id, distribution.id);
  assert.equal(service.wallet(first.id).balance, firstAfter);
  assert.equal(service.state.matchPredictions.distributions.filter((entry) => entry.id === distribution.id).length, 1);
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
  assert.equal(service.view(user).shop.catalog.find((pack) => pack.id === "legend-random").price, 12000);
  assert.equal(service.view(user).shop.catalog.find((pack) => pack.id === "public-random").price, 2200);

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

test("公开池狂欢礼包赛季限购一次并发放所有权与50张基础卡", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("carnival-pack-owner", "Carnival Owner");
  join(service, user, "Carnival FC");

  let view = service.buyS4Packs(user, "public-carnival", 1);
  assert.equal(service.wallet(user.id).balance, 85000);
  assert.equal(view.shop.catalog.find((pack) => pack.id === "public-carnival").remainingQuantity, 0);
  const item = view.s4Packs.inventory.find((pack) => pack.packType === "public-carnival");
  view = service.openS4Pack(user, item.id);
  assert.equal(view.s4Packs.offer.players.length, 3);
  const playerId = view.s4Packs.offer.players[0].id;
  view = service.chooseS4Pack(user, view.s4Packs.offer.id, playerId);

  assert.equal(view.packOpening.cardCount, 50);
  assert.equal(service.state.s4Assets.ownerships[playerId], user.id);
  const cards = Object.values(service.state.s4Assets.cards).filter((card) => card.ownerId === user.id && card.playerId === playerId && card.status === "active");
  assert.equal(cards.length, 50);
  assert.ok(cards.every((card) => card.upgradeLevel === 0));
  assert.throws(() => service.buyS4Packs(user, "public-carnival", 1), /整个赛季限购1份/);
});

test("需要选人的礼包会在33人名单满前截断，清理名额后仍可正常开启", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("expanded-roster", "Expanded Roster");
  join(service, user, "Expanded FC");
  service.wallet(user.id).balance = 100000;
  let view = service.buyS4Packs(user, "public-random", 12);
  for (let index = 0; index < 10; index += 1) {
    view = service.openS4Pack(user, view.s4Packs.inventory[0].id);
    view = service.chooseS4Pack(user, view.s4Packs.offer.id, view.s4Packs.offer.players[0].id);
  }
  assert.equal(service.view(user).ownTeam.s4Assets.rosterSlotsUsed, 32);
  const finalPackIds = service.view(user).s4Packs.inventory.map((item) => item.id);
  assert.throws(() => service.openS4PacksBatch(user, finalPackIds), /仅剩1个名额.*最多打开1份/);
  assert.equal(service.view(user).s4Packs.offer, null);
  assert.equal(service.view(user).s4Packs.inventory.length, 2);

  view = service.openS4Pack(user, finalPackIds[0]);
  view = service.chooseS4Pack(user, view.s4Packs.offer.id, view.s4Packs.offer.players[0].id);
  assert.equal(service.view(user).ownTeam.s4Assets.rosterSlotsUsed, 33);
  assert.throws(() => service.openS4Pack(user, finalPackIds[1]), /33人名单已满.*礼包不会被消耗/);
  assert.equal(service.view(user).s4Packs.offer, null);
  assert.equal(service.view(user).s4Packs.inventory[0].id, finalPackIds[1]);

  const releasedId = service.accountTeam(user.id).rosterIds.at(-1);
  service.releasePlayer(user, releasedId);
  assert.equal(service.state.s4Assets.ownerships[releasedId], undefined);
  assert.equal(service.view(user).ownTeam.s4Assets.rosterSlotsUsed, 32);
  view = service.openS4Pack(user, finalPackIds[1]);
  assert.doesNotThrow(() => service.chooseS4Pack(user, view.s4Packs.offer.id, view.s4Packs.offer.players[0].id));
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
  assert.equal(economy.balance, 20000 - 3200 + economy.releases[0].amount);
  assert.equal(economy.shopPackCounts.find((entry) => entry.tierId === "private-mixed").count, 2);
  assert.equal(economy.releases[0].player.id, opened.packOpening.player.id);
  assert.ok(economy.income > 0);
  assert.equal(economy.expense, 3200);
  assert.ok(economy.ledger.some((entry) => entry.type === "s4-pack-buy" && entry.packType === "private-mixed" && entry.quantity === 2));
});

test("admin season controls preserve human squads, reset wallets to 100000 and archive results", () => {
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
  assert.equal(service.wallet(user.id).balance, 100000);
  const nextSeason = service.startNewSeason();
  assert.equal(nextSeason.season.name, "S2");
  assert.equal(nextSeason.archives.length, 2);
  assert.deepEqual(service.accountTeam(user.id).rosterIds, rosterIds);
  assert.equal(service.wallet(user.id).balance, 100000);
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
  assert.equal(view.report.availability.total, 23);
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
  const seasonIdBeforeActivation = service.state.season.id;
  currentTime = Date.parse("2026-07-24T09:52:00+08:00");
  assert.equal(service.tick(), false);
  assert.equal(service.state.season.id, seasonIdBeforeActivation);
  assert.equal(service.state.dailyAutomation.enabled, false);
  service.wallet(user.id).balance = 32100;
  service.fullReset();
  assert.equal(service.state.dailyAutomation.enabled, true);
  assert.equal(service.state.dailyAutomation.activatedAt, currentTime);
  assert.equal(service.state.dailyAutomation.initializedDate, "2026-07-24");
  assert.equal(service.accountTeam(user.id), null);
  assert.equal(service.state.teams.every((team) => !team.ownerId), true);
  assert.deepEqual(service.state.wallets, {});
  assert.deepEqual(service.state.drafts, {});
  assert.deepEqual(service.state.listings, []);
  assert.deepEqual(service.state.matches, []);
  assert.ok(readdirSync(backupDir).some((name) => name.startsWith("before-full-reset-")));
  const reloaded = new YellowDogsLeagueService({ statePath, backupDir, now:() => currentTime, rng:() => .37 });
  assert.equal(reloaded.state.dailyAutomation.enabled, true);
  assert.equal(reloaded.state.dailyAutomation.activatedAt, currentTime);
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

test("10队联赛每轮完成5场并逐轮结算榜单和金币", () => {
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
  assert.equal(publicPlayer.minimumPrice, Math.ceil(publicPlayer.referencePrice * S4_PRICING.ownershipListingFloorRate / 100) * 100);
  assert.throws(() => service.listOwnership(seller, playerId, publicPlayer.minimumPrice - 1), /不能低于/);
  const price = publicPlayer.minimumPrice;
  const listingView = service.listOwnership(seller, playerId, price);
  const listing = listingView.listings.find((entry) => entry.kind === "ownership" && entry.playerId === playerId);
  service.buyListing(buyer, listing.id);
  assert.equal(sellerTeam.rosterIds.includes(playerId), false);
  assert.equal(buyerTeam.rosterIds.includes(playerId), true);
  assert.equal(buyerTeam.rosterIds.length, 24);
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
  assert.ok(detail.teams.every((team) => team.players.every((player) => !("legendAbility" in player) && !("signature" in player))));
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

test("联赛每轮按胜平负结算金币且不会重复发奖", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("reward-owner", "Reward Owner");
  join(service, user, "Reward FC");
  const startingBalance = service.wallet(user.id).balance;
  service.simulateNextRound();
  let view = service.view(user);
  assert.equal(view.rewardOffers.length, 0);
  assert.equal(view.s4Packs.inventory.length, 0);
  let rewardLedgers = service.state.ledger.filter((entry) => entry.type === "league-match-reward" && entry.accountId === user.id);
  assert.equal(rewardLedgers.length, 1);
  assert.equal(rewardLedgers[0].amount, { win:1600, draw:1400, loss:1200 }[rewardLedgers[0].result]);
  assert.equal(service.wallet(user.id).balance, startingBalance + rewardLedgers[0].amount);
  const balanceAfterFirstReward = service.wallet(user.id).balance;
  service.payRewards(1);
  assert.equal(service.wallet(user.id).balance, balanceAfterFirstReward);
  service.simulateNextRound();
  service.simulateNextRound();
  view = service.view(user);
  assert.equal(view.rewardOffers.length, 0);
  assert.equal(view.s4Packs.inventory.length, 0);
  rewardLedgers = service.state.ledger.filter((entry) => entry.type === "league-match-reward" && entry.accountId === user.id);
  assert.equal(rewardLedgers.length, 3);
  assert.equal(service.wallet(user.id).balance, startingBalance + rewardLedgers.reduce((sum, entry) => sum + entry.amount, 0));
  assert.ok(view.inbox.some((message) => message.round === 3 && message.title.includes("金币")));
});

test("赛后复盘按完赛时间排列并将最新友谊赛放在联赛记录之前", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("review-friendly-owner", "Review Friendly Owner");
  join(service, user, "Review Friendly FC");
  const team = service.accountTeam(user.id);
  const opponent = service.state.teams.find((entry) => entry.id !== team.id);
  service.state.matches.push(
    { id:"older-league", competition:"league", round:18, playedAt:NOW - 60_000, homeId:team.id, awayId:opponent.id, score:[1, 0], formations:["4-3-3", "4-4-2"] },
    { id:"newer-friendly", competition:"friendly", round:0, playedAt:NOW, homeId:team.id, awayId:opponent.id, score:[2, 2], formations:["4-3-3", "4-4-2"] },
  );
  assert.deepEqual(service.teamHistory(team.id).map((match) => match.id), ["newer-friendly", "older-league"]);
});

test("7月30日自动重置后的联赛每轮额外发放8个私有池随机礼包且保持幂等", () => {
  const now = Date.parse("2026-07-30T10:20:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const user = account("daily-round-pack-owner", "Daily Round Pack Owner");
  join(service, user, "Daily Round Pack FC");
  service.state.season.startedAt = Date.parse("2026-07-30T10:00:00+08:00");
  service.state.season.id = "S4-2026-07-30-test";

  service.simulateNextRound();
  let view = service.view(user);
  assert.equal(view.s4Packs.inventory.length, 8);
  assert.ok(view.s4Packs.inventory.every((item) => item.packType === "private-mixed" && item.source === "league-round"));
  let ledgers = service.state.ledger.filter((entry) => entry.type === "league-round-pack-reward" && entry.accountId === user.id);
  assert.equal(ledgers.length, 1);
  assert.equal(ledgers[0].quantity, 8);
  assert.equal(ledgers[0].packIds.length, 8);
  assert.ok(view.inbox.some((message) => message.round === 1 && message.title.includes("奖励") && message.summary.includes("8 个私有池随机礼包")));

  service.payRewards(1);
  view = service.view(user);
  ledgers = service.state.ledger.filter((entry) => entry.type === "league-round-pack-reward" && entry.accountId === user.id);
  assert.equal(view.s4Packs.inventory.length, 8);
  assert.equal(ledgers.length, 1);
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

test("admin coin grants immediately credit all or specified players and create mail and ledger records", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("coin-grant-first", "Coin First");
  const second = account("coin-grant-second", "Coin Second");
  join(service, first, "Coin First FC");
  join(service, second, "Coin Second FC");
  const firstBalance = service.wallet(first.id).balance;
  const secondBalance = service.wallet(second.id).balance;

  service.grantCoinsFromAdmin({ amount:2500, recipientMode:"specified", accountIds:[second.id] });
  assert.equal(service.wallet(first.id).balance, firstBalance);
  assert.equal(service.wallet(second.id).balance, secondBalance + 2500);
  assert.ok(service.view(second).inbox.some((message) => message.type === "reward" && message.payload?.amount === 2500));
  assert.ok(service.state.ledger.some((entry) => entry.accountId === second.id && entry.type === "admin-coin-grant" && entry.amount === 2500));

  const adminView = service.grantCoinsFromAdmin({ amount:1000, recipientMode:"all" });
  assert.equal(service.wallet(first.id).balance, firstBalance + 1000);
  assert.equal(service.wallet(second.id).balance, secondBalance + 3500);
  assert.equal(adminView.coinGrants.find((grant) => grant.recipientMode === "all").recipientCount, 2);
  assert.throws(() => service.grantCoinsFromAdmin({ amount:0, recipientMode:"all" }), /1至10亿/);
});

test("admin can broadcast an update mail to every player team", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("mail-broadcast-a", "Mail A");
  const second = account("mail-broadcast-b", "Mail B");
  join(service, first, "Mail A FC");
  join(service, second, "Mail B FC");

  const adminView = service.broadcastAdminMail({
    title:"V2引擎更新说明",
    summary:"阵型线与比赛引擎已经更新。",
    body:"本次更新增加阵型高度线，并优化了实时比赛性能。",
  });
  const broadcast = adminView.mailBroadcasts[0];
  assert.equal(broadcast.recipientCount, 2);
  assert.equal(broadcast.title, "V2引擎更新说明");
  [first, second].forEach((user) => {
    const mail = service.view(user).inbox.find((entry) => entry.payload?.adminMailBroadcastId === broadcast.id);
    assert.equal(mail.type, "admin-update");
    assert.equal(mail.title, broadcast.title);
    assert.equal(mail.body, "本次更新增加阵型高度线，并优化了实时比赛性能。");
  });
  assert.throws(() => service.broadcastAdminMail({ title:"", body:"正文" }), /标题不能为空/);
  assert.throws(() => service.broadcastAdminMail({ title:"标题", body:"" }), /正文不能为空/);
});

test("后台纪律处罚可扣除金币、全服通告并阻止联赛和杯赛奖励补发", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const punished = account("discipline-player", "Discipline Player");
  const observer = account("discipline-observer", "Discipline Observer");
  join(service, punished, "Discipline FC");
  join(service, observer, "Observer FC");
  const startingBalance = service.wallet(punished.id).balance;

  service.removeCoinsFromAdmin({ accountId:punished.id, amount:1200, reason:"利用异常交易获利", announce:true });
  assert.equal(service.wallet(punished.id).balance, startingBalance - 1200);
  assert.ok(service.state.ledger.some((entry) => entry.accountId === punished.id && entry.type === "admin-coin-penalty" && entry.amount === -1200));
  assert.ok(service.view(observer).inbox.some((message) => message.title === "全服纪律处罚通告" && message.summary.includes("Discipline Player")));
  assert.throws(() => service.removeCoinsFromAdmin({ accountId:punished.id, amount:startingBalance, reason:"超额扣款" }), /不能扣除更多金币/);

  service.setRewardSuspensionFromAdmin({ accountId:punished.id, suspended:true, reason:"多次违规", announce:true });
  const balanceBeforeRound = service.wallet(punished.id).balance;
  service.simulateNextRound();
  assert.equal(service.wallet(punished.id).balance, balanceBeforeRound);
  assert.ok(service.state.discipline.withheldRewards.some((entry) => entry.accountId === punished.id && entry.competition === "league" && entry.rewardType === "round"));

  service.setRewardSuspensionFromAdmin({ accountId:punished.id, suspended:false, reason:"处罚期结束" });
  service.payRewards(1);
  assert.equal(service.wallet(punished.id).balance, balanceBeforeRound);

  const team = service.accountTeam(punished.id);
  service.setRewardSuspensionFromAdmin({ accountId:punished.id, suspended:true, reason:"杯赛奖励暂停" });
  const cupEvent = { id:"discipline-cup-quarterfinal", stage:"quarterfinals", round:5, leg:2 };
  assert.equal(service.grantCupReward(team.id, cupEvent, "advance"), null);
  service.setRewardSuspensionFromAdmin({ accountId:punished.id, suspended:false, reason:"处罚期结束" });
  assert.equal(service.grantCupReward(team.id, cupEvent, "advance"), null);
  assert.equal(service.s4PackInventory(punished.id).filter((item) => item.source === "cup").length, 0);
});

test("最高处罚会清算并解散球队、由AI补位、均分补偿且按每日规则重置赛事", () => {
  let currentTime = NOW;
  const service = new YellowDogsLeagueService({ statePath:null, now:() => currentTime, rng:() => .37 });
  const punished = account("dissolved-player", "Dissolved Player");
  const first = account("dissolution-recipient-a", "Recipient A");
  const second = account("dissolution-recipient-b", "Recipient B");
  join(service, punished, "违规球队");
  join(service, first, "补偿甲队");
  join(service, second, "补偿乙队");
  service.grantS4Pack(punished.id, "legend-random", 1, { source:"test" });
  service.simulateNextRound();
  const dissolvedTeam = service.accountTeam(punished.id);
  const dissolvedTeamId = dissolvedTeam.id;
  const xPlayerId = dissolvedTeam.rosterIds.find(isXPlayer);
  const recipientBalanceBefore = service.wallet(first.id).balance + service.wallet(second.id).balance;

  assert.throws(
    () => service.dissolveTeamFromAdmin({ accountId:punished.id, reason:"严重破坏公平竞赛", confirm:"wrong" }),
    /需要确认/,
  );
  const result = service.dissolveTeamFromAdmin({
    accountId:punished.id,
    reason:"严重破坏公平竞赛",
    confirm:"DISSOLVE_YDL_TEAM",
  });

  assert.equal(service.accountTeam(punished.id), null);
  assert.equal(service.state.teams.find((team) => team.id === dissolvedTeamId).ownerId, null);
  assert.equal(service.wallet(punished.id).balance, 0);
  assert.equal(service.playerCards(punished.id).length, 0);
  assert.equal(Object.values(service.state.s4Assets.ownerships).includes(punished.id), false);
  assert.equal(service.state.xPlayers.assignments[xPlayerId], undefined);
  assert.equal(service.state.xPlayers.configs[xPlayerId], undefined);
  assert.equal(REAL_PLAYERS.find((player) => player.id === xPlayerId).role, null);
  assert.equal(service.s4PackInventory(punished.id).length, 0);
  assert.equal(service.state.season.currentRound, 0);
  assert.equal(service.state.cup.status, "waiting");
  assert.equal(service.state.matches.length, 0);
  assert.equal(result.action.distributedAmount, result.action.totalRecoveryAmount);
  assert.equal(
    service.wallet(first.id).balance + service.wallet(second.id).balance,
    recipientBalanceBefore + result.action.totalRecoveryAmount,
  );
  assert.ok(service.view(first).inbox.some((message) => message.title === "严重违规球队强制解散及补偿公告" && message.summary.includes("违规球队")));
  assert.ok(service.view(second).inbox.some((message) => message.payload?.compensation > 0));
  assert.doesNotThrow(() => service.adminView());

  const dissolvedResetSeasonId = service.state.season.id;
  assert.equal(service.state.dailyAutomation.lastResetDate, "2026-07-23");
  service.state.dailyAutomation.enabled = true;
  currentTime = Date.parse("2026-07-24T09:51:01+08:00");
  assert.equal(service.runDailyAutomation(), true);
  assert.notEqual(service.state.season.id, dissolvedResetSeasonId);
  assert.equal(service.state.dailyAutomation.lastResetDate, "2026-07-24");
});

test("奖励暂停会扣留联赛最终排名奖励且恢复后不补发", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("discipline-ranking", "Ranking Discipline");
  join(service, user, "Ranking Discipline FC");
  const team = service.accountTeam(user.id);
  const startingBalance = service.wallet(user.id).balance;
  team.table = { played:18, won:18, drawn:0, lost:0, goalsFor:50, goalsAgainst:2, points:54 };
  service.state.season.status = "completed";
  service.state.season.completedAt = NOW - 20 * 60_000;
  service.setRewardSuspensionFromAdmin({ accountId:user.id, suspended:true, reason:"赛季奖励处罚" });

  const settlement = service.settleDailySeason();
  const recipient = settlement.recipients.find((entry) => entry.accountId === user.id);
  assert.equal(recipient.withheld, true);
  assert.equal(service.wallet(user.id).balance, startingBalance);
  assert.equal(service.s4PackInventory(user.id).length, 0);
  service.setRewardSuspensionFromAdmin({ accountId:user.id, suspended:false, reason:"处罚期结束" });
  service.settleDailySeason();
  assert.equal(service.wallet(user.id).balance, startingBalance);
});

test("admin X growth grants immediately reach every completed player with an X player", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const first = account("x-grant-first", "X First");
  const second = account("x-grant-second", "X Second");
  join(service, first, "X First FC");
  join(service, second, "X Second FC");
  const firstTeam = service.accountTeam(first.id);
  const secondTeam = service.accountTeam(second.id);
  const firstX = firstTeam.rosterIds.find(isXPlayer);
  const secondX = secondTeam.rosterIds.find(isXPlayer);

  const adminView = service.grantXGrowthPointsFromAdmin({ points:4 });
  assert.equal(service.view(first).xGrowth.points, 4);
  assert.equal(service.view(second).xGrowth.points, 4);
  assert.equal(service.view(first).xGrowth.grantedPoints, 4);
  assert.equal(adminView.xGrowthGrants[0].recipientCount, 2);
  assert.ok(service.view(second).inbox.some((message) => message.payload?.playerId === secondX && message.payload?.points === 4));
  assert.ok(service.state.ledger.some((entry) => entry.playerId === firstX && entry.type === "admin-x-growth-grant" && entry.points === 4));
  assert.throws(() => service.grantXGrowthPointsFromAdmin({ points:0 }), /1至1000/);
});
test("admin can grant every S4 pack type through the replacement grant system", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("admin-mixed-owner", "Mixed Manager");
  join(service, user, "Mixed Reward FC");
  const types = service.adminView().s4PackCatalog.map((entry) => entry.id);
  assert.deepEqual(types, ["legend-random", "private-mixed", "private-att", "private-mid", "private-def", "private-gk", "public-random", "public-carnival"]);
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
  const grantedPublicCard = service.view(second).ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === grantedCards[0].id);
  assert.equal(grantedPublicCard.effectiveOverall, Math.min(99, REAL_PLAYERS.find((player) => player.id === playerId).overall + 13));
  assert.equal(grantedPublicCard.upgradeBonus, 13);
  assert.equal(service.state.s4Assets.ownerships[playerId], first.id);
  assert.ok(secondTeam.rosterIds.includes(playerId));
  assert.equal(adminView.s4CardGrants[0].playerId, playerId);
  assert.equal(adminView.s4CardGrants[0].upgradeLevel, 8);
  assert.equal(adminView.s4CardGrants[0].quantity, 2);
  assert.ok(service.view(second).inbox.some((message) => message.payload?.grantId === adminView.s4CardGrants[0].id));
  const unownedPlayer = REAL_PLAYERS.find((player) => player.grade !== "S" && !service.state.s4Assets.ownerships[player.id]);
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
  assert.equal(view.enhancementResult.chance, 25);
  assert.equal(view.enhancementResult.afterLevel, 8);
  assert.equal(service.state.s4Assets.cards[main.id].upgradeLevel, 8);
  assert.equal(service.state.s4Assets.cards[material.id].status, "recycled");
  assert.equal(service.wallet(user.id).balance, balanceBefore - s4EnhancementProtectionCost(view.enhancementResult.chance));
  assert.equal(view.enhancementResult.traitOffer.traits.length, 3);
  assert.ok(view.enhancementResult.traitOffer.traits.every((trait) => trait.summary && Array.isArray(trait.eligibleRoleGroups)));
  const chosenTrait = view.enhancementResult.traitOffer.traits[0];
  const chosen = service.chooseS4EnhancementTrait(user, view.enhancementResult.traitOffer.id, chosenTrait.id);
  assert.equal(chosen.enhancementTraitResult.trait.id, chosenTrait.id);
  assert.ok(service.state.s4Assets.cards[main.id].traitIds.includes(chosenTrait.id));
  const publicCard = chosen.ownTeam.roster.find((player) => player.id === playerId).cards.find((card) => card.id === main.id);
  assert.equal(publicCard.traits[0].name, chosenTrait.name);
  assert.ok(publicCard.traits[0].summary);
});

test("S4普通球员卡在+4和+7各获得一次三选一特性机会", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const user = account("trait-threshold-owner", "Trait Threshold Owner");
  join(service, user, "Trait Threshold FC");
  const playerId = service.accountTeam(user.id).rosterIds[0];
  service.grantS4PlayerCardsFromAdmin({ accountId:user.id, playerId, upgradeLevel:3, quantity:2 });
  let [main, material] = service.playerCards(user.id, playerId).filter((card) => card.upgradeLevel === 3).slice(0, 2);

  let result = service.enhanceS4Card(user, main.id, material.id);
  assert.equal(result.enhancementResult.afterLevel, 4);
  assert.equal(result.enhancementResult.traitOffer.unlockLevel, 4);
  let trait = result.enhancementResult.traitOffer.traits[0];
  service.chooseS4EnhancementTrait(user, result.enhancementResult.traitOffer.id, trait.id);
  assert.equal(main.traitIds.length, 1);

  main.upgradeLevel = 6;
  material = service.grantS4Card(service.accountTeam(user.id), playerId, { grantOwnership:false, upgradeLevel:6, acquisitionSource:"threshold-test" });
  result = service.enhanceS4Card(user, main.id, material.id);
  assert.equal(result.enhancementResult.afterLevel, 7);
  assert.equal(result.enhancementResult.traitOffer.unlockLevel, 7);
  trait = result.enhancementResult.traitOffer.traits[0];
  service.chooseS4EnhancementTrait(user, result.enhancementResult.traitOffer.id, trait.id);
  assert.equal(main.traitIds.length, 2);
  assert.deepEqual(result.enhancement.traitUnlockLevels, [4, 7]);
});

test("7月30日09:30向旧存档受影响卡发送一次性特性补偿邮件并定向绑定", () => {
  let currentTime = Date.parse("2026-07-30T09:29:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => currentTime, rng:() => 0 });
  const affected = account("trait-compensation-owner", "Trait Compensation Owner");
  const unaffected = account("trait-compensation-unaffected", "Trait Compensation Unaffected");
  join(service, affected, "Compensation FC");
  join(service, unaffected, "Unaffected FC");
  const card = service.representativeCard(affected.id, service.accountTeam(affected.id).rosterIds[0]);
  card.upgradeLevel = 4;

  assert.equal(service.tick(), false);
  assert.equal(service.view(affected).inbox.some((message) => message.type === "trait-compensation"), false);
  currentTime = Date.parse("2026-07-30T09:30:00+08:00");
  assert.equal(service.tick(), true);
  const mail = service.view(affected).inbox.find((message) => message.type === "trait-compensation");
  assert.ok(mail);
  assert.equal(mail.payload.cardId, card.id);
  assert.equal(mail.payload.unlockLevel, 4);
  assert.equal(mail.payload.traitOffer.traits.length, 3);
  assert.equal(service.view(unaffected).inbox.some((message) => message.type === "trait-compensation"), false);
  assert.throws(() => service.deleteInbox(affected, mail.id), /待办事项/);

  service.tick();
  assert.equal(service.view(affected).inbox.filter((message) => message.type === "trait-compensation").length, 1);
  const selected = mail.payload.traitOffer.traits[0];
  const chosen = service.chooseS4EnhancementTrait(affected, mail.payload.offerId, selected.id);
  assert.ok(card.traitIds.includes(selected.id));
  const resolvedMail = chosen.inbox.find((message) => message.id === mail.id);
  assert.ok(resolvedMail.payload.resolvedAt);
  assert.equal(resolvedMail.payload.chosenTraitId, selected.id);
  assert.doesNotThrow(() => service.deleteInbox(affected, mail.id));
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

test("S4强化等级同步提升比赛综合能力和全部数值属性并在99封顶", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const user = account("ydl-enhancement-ability", "Ability Owner");
  join(service, user, "Ability FC");
  const team = service.accountTeam(user.id);
  const playerId = team.preferredStarterIds[0];
  const source = REAL_PLAYERS.find((player) => player.id === playerId);
  const card = service.representativeCard(user.id, playerId);
  card.upgradeLevel = 8;
  const lineup = service.actualLineup(team, 1);
  const positions = service.actualPositions(team, lineup);
  const carrier = service.chemistryAdjustedLineup(team, lineup, positions).find((player) => player.id === playerId);
  const publicPlayer = service.view(user).ownTeam.roster.find((player) => player.id === playerId);
  const publicCard = publicPlayer.cards.find((entry) => entry.id === card.id);

  const expectedOverall = source.grade === "S" ? source.overall + 13 : Math.min(99, source.overall + 13);
  assert.equal(carrier.overall, expectedOverall);
  assert.equal(carrier.upgradeBonus, 13);
  Object.entries(source.attributes).forEach(([key, value]) => {
    if (Number.isFinite(value)) assert.ok(carrier.attributes[key] >= Math.min(99, value + 13));
  });
  assert.equal(publicPlayer.effectiveOverall, expectedOverall);
  assert.equal(publicCard.effectiveOverall, expectedOverall);
  assert.equal(publicCard.upgradeBonus, 13);
});

test("YDL比赛首发只叠加数值最高的两条已触发羁绊", () => {
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
  assert.ok(adjusted.every((player) => player.ydlBondBonus === .12));
  assert.ok(adjusted.every((player) => ["nationality:西班牙", "club:皇家马德里"].every((id) => player.ydlBondIds.includes(id))));
  assert.ok(adjusted.every((player) => !player.ydlBondIds.includes("structure:united")));
  assert.ok(adjusted.every((player) => player.attributes.passing >= 89.6));
});

test("+5至+8强化成功及+7关键等级特性绑定会向其他玩家发送全服公告", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const observer = account("enhancement-observer", "Enhancement Observer");
  const owner = account("enhancement-owner", "Enhancement Owner");
  join(service, observer, "Observer FC");
  join(service, owner, "Owner FC");
  const ownerTeam = service.accountTeam(owner.id);
  const expectedChances = [70, 55, 40, 25];

  [4, 5, 6, 7].forEach((beforeLevel, index) => {
    const playerId = ownerTeam.rosterIds[index];
    service.grantS4PlayerCardsFromAdmin({ accountId:owner.id, playerId, upgradeLevel:beforeLevel, quantity:2 });
    const [main, material] = service.playerCards(owner.id, playerId).filter((card) => card.upgradeLevel === beforeLevel).slice(0, 2);
    main.traitIds = ["aerial-beacon", ...(beforeLevel >= 7 ? ["shadow-marker"] : [])];
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

    if (upgradeLevel === 7) {
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
  assert.equal(service.view(observer).inbox.filter((message) => message.id.startsWith("enhancement-trait:")).length, 1);
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
  assert.equal(service.wallet(user.id).balance, balanceBeforeProtection - s4EnhancementProtectionCost(protectedResult.enhancementResult.chance));
});

test("S4强化支持轻量响应且不生成完整联赛视图", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => 0 });
  const user = account("enhancement-compact", "Enhancement Compact");
  join(service, user, "Enhancement Compact FC");
  const playerId = service.accountTeam(user.id).rosterIds[0];
  service.grantS4PlayerCardsFromAdmin({ accountId:user.id, playerId, upgradeLevel:2, quantity:2 });
  const [main, material] = service.playerCards(user.id, playerId).filter((card) => card.upgradeLevel === 2).slice(0, 2);

  const result = service.enhanceS4Card(user, main.id, material.id, false, { compact:true });

  assert.equal(result.enhancementResult.success, true);
  assert.equal(result.enhancementResult.card.id, main.id);
  assert.equal(result.enhancementResult.card.upgradeLevel, 3);
  assert.equal(result.removedCardId, material.id);
  assert.equal(result.wallet.balance, service.wallet(user.id).balance);
  assert.equal(result.teams, undefined);
  assert.equal(result.playerDirectory, undefined);
  assert.equal(result.recentMatches, undefined);
});

test("S4强化在+3以后每级增加2点总评，传奇球员允许超过99", () => {
  const ordinary = { overall:98 };
  const legend = { overall:70, grade:"S", legendary:true };
  const bonuses = Array.from({ length:9 }, (_, level) => s4EffectiveOverall(legend, level) - legend.overall);
  assert.deepEqual(bonuses, [0, 1, 2, 3, 5, 7, 9, 11, 13]);
  assert.equal(s4EffectiveOverall(ordinary, 8), 99);
  assert.equal(s4EffectiveOverall(legend, 8), legend.overall + 13);
});

test("S4非百分百强化均可使用防爆，价格按失败概率计算", () => {
  const previousBaseCost = Math.ceil(((100 - 70) ** 2 * .7) / 100) * 100;
  assert.equal(s4EnhancementProtectionCost(70), Math.ceil(previousBaseCost * .75));
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .999 });
  const user = account("enhancement-low-protection", "Low Protection");
  join(service, user, "Low Protection FC");
  const playerId = service.accountTeam(user.id).rosterIds[0];
  service.grantS4PlayerCardsFromAdmin({ accountId:user.id, playerId, upgradeLevel:2, quantity:1 });
  service.grantS4PlayerCardsFromAdmin({ accountId:user.id, playerId, upgradeLevel:1, quantity:1 });
  const [main] = service.playerCards(user.id, playerId).filter((card) => card.upgradeLevel === 2);
  const [material] = service.playerCards(user.id, playerId).filter((card) => card.upgradeLevel === 1);
  const chance = s4EnhancementChance(2, 1);
  const balanceBefore = service.wallet(user.id).balance;
  const result = service.enhanceS4Card(user, main.id, material.id, true);

  assert.ok(chance < 100);
  assert.equal(result.enhancementResult.protectionUsed, true);
  assert.equal(result.enhancementResult.afterLevel, 2);
  assert.equal(service.wallet(user.id).balance, balanceBefore - s4EnhancementProtectionCost(chance));
});

test("所有非传奇基础卡回收价均低于对应私有池卡包价格", () => {
  const packPriceByPool = {
    ATT:S4_PACK_PRICES["private-att"],
    MID:S4_PACK_PRICES["private-mid"],
    DEF:S4_PACK_PRICES["private-def"],
    GK:S4_PACK_PRICES["private-gk"],
  };
  REAL_PLAYERS.filter((player) => player.grade !== "S" && !isXPlayer(player)).forEach((player) => {
    const referenceValue = s4BaseCardReferenceValue(player);
    const recoveryValue = Math.floor(referenceValue * S4_ECONOMY.singleCardRecoveryRate);
    assert.ok(recoveryValue < packPriceByPool[player.pool], `${player.name}的回收价${recoveryValue}不应覆盖卡包成本${packPriceByPool[player.pool]}`);
  });
});

test("S4单卡与所有权采用独立参考价格曲线", () => {
  const grades = ["A", "B", "C"];
  grades.forEach((grade) => {
    const players = REAL_PLAYERS.filter((player) => player.grade === grade);
    players.forEach((player) => assert.ok(s4OwnershipReferenceValue(player) > s4BaseCardReferenceValue(player)));
  });
  const bestA = REAL_PLAYERS.filter((player) => player.grade === "A").sort((left, right) => right.overall - left.overall)[0];
  assert.equal(s4BaseCardReferenceValue(bestA), 3400);
  assert.equal(s4OwnershipReferenceValue(bestA), 8200);
});

test("S4强化概率区分稳妥同级卡和娱乐式低级副卡", () => {
  const triangle = Array.from({ length:8 }, (_, mainLevel) => Array.from({ length:mainLevel + 1 }, (_, materialLevel) => s4EnhancementChance(mainLevel, materialLevel)));
  assert.deepEqual(triangle, [
    [100],
    [60, 100],
    [34, 57, 95],
    [18, 31, 51, 85],
    [9, 15, 25, 42, 70],
    [4, 7, 12, 20, 33, 55],
    [2, 3, 5, 9, 14, 24, 40],
    [1, 1, 2, 3, 5, 9, 15, 25],
  ]);
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
  const cupMatch = service.state.matches.find((match) => match.competition === "cup");
  const cupSummary = service.matchSummary(cupMatch);
  assert.doesNotMatch(cupSummary.label, /undefined/);
  assert.match(cupSummary.label, /瑞士轮|决赛/);
  assert.equal(service.matchDetail(account("cup-history-viewer", "Cup Viewer"), cupMatch.id).matchLabel, cupSummary.label);
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

test("杯赛瑞士轮无奖励，淘汰赛晋级发两个公共池卡包且冠军由后台另行发奖", () => {
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
  assert.equal(service.grantCupReward(team.id, { id:"cup-swiss-3", stage:"swiss", round:3, leg:1 }, "advance"), null);
  const advance = service.grantCupReward(team.id, { id:"cup-quarterfinals-leg2", stage:"quarterfinals", round:5, leg:2 }, "advance");
  assert.ok(advance);
  assert.equal(advance.type, "cup-pack-reward");
  assert.equal(advance.packType, "public-random");
  assert.equal(advance.quantity, 2);
  assert.equal(service.view(user).s4Packs.inventory.filter((item) => item.source === "cup").length, 2);
  const semifinalAdvance = service.grantCupReward(team.id, { id:"cup-semifinals-leg2", stage:"semifinals", round:6, leg:2 }, "advance");
  assert.equal(semifinalAdvance.quantity, 2);
  const champion = service.grantCupReward(team.id, { id:"cup-final-leg2", stage:"final", round:7, leg:2 }, "champion");
  assert.equal(champion, null);
  assert.equal(service.wallet(user.id).balance, balanceBeforeRewards);
  assert.equal(service.view(user).s4Packs.inventory.filter((item) => item.source === "cup").length, 4);
  assert.equal(service.grantCupReward(team.id, { id:"cup-final-leg2", stage:"final", round:7, leg:2 }, "champion"), null);
  assert.equal(service.wallet(user.id).balance, balanceBeforeRewards);
  assert.equal(service.view(user).inbox.filter((message) => message.id.startsWith("cup-reward:")).length, 2);
});

test("真人玩家可通过邮件接受友谊赛并排入最近的05分钟档及全服直播预告", () => {
  let now = Date.parse("2026-07-23T10:01:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const inviter = account("friendly-inviter", "邀请方");
  const receiver = account("friendly-receiver", "接收方");
  const observer = account("friendly-observer", "观众");
  join(service, inviter, "邀请方球队");
  join(service, receiver, "接收方球队");
  join(service, observer, "观众球队");
  const inviterTeam = service.accountTeam(inviter.id);
  const receiverTeam = service.accountTeam(receiver.id);

  assert.throws(() => service.createFriendlyInvitation(inviter, service.state.teams.find((team) => !team.ownerId).id), /真人玩家/);
  service.createFriendlyInvitation(inviter, receiverTeam.id);
  const invitation = service.state.friendlyInvitations.at(-1);
  assert.ok(service.view(receiver).inbox.some((message) => message.type === "friendly-invite" && message.payload.friendlyInvitationId === invitation.id));

  service.resolveFriendlyInvitation(receiver, invitation.id, "accept");
  const fixture = service.state.friendlyFixtures.at(-1);
  assert.equal(new Date(fixture.startsAt).getMinutes(), 5);
  assert.equal(service.view(inviter).schedule.fixtures.some((entry) => entry.competition === "friendly" && entry.opponentId === receiverTeam.id), true);
  const nextOpponent = service.view(inviter).report.nextOpponent;
  assert.equal(nextOpponent.competition, "friendly");
  assert.equal(nextOpponent.weather, null);
  assert.equal(nextOpponent.referee, null);
  assert.equal(service.view(observer).inbox.some((message) => message.payload?.friendlyFixtureId === fixture.id && message.title.includes("直播预告")), true);
  assert.equal(service.teamDetail(inviter, receiverTeam.id).canInviteFriendly, true);
  assert.equal(service.teamDetail(inviter, service.state.teams.find((team) => !team.ownerId).id).canInviteFriendly, false);
  assert.equal(inviterTeam.ownerId, inviter.id);
});

test("发起友谊赛支持轻量响应且不构建完整联赛视图", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const inviter = account("friendly-compact-a", "轻量邀请方");
  const receiver = account("friendly-compact-b", "轻量接收方");
  join(service, inviter, "轻量邀请队");
  join(service, receiver, "轻量接收队");
  const fullView = service.view;
  service.view = () => { throw new Error("轻量邀请不应构建完整联赛视图"); };
  const result = service.createFriendlyInvitation(inviter, service.accountTeam(receiver.id).id, { compact:true });
  service.view = fullView;

  assert.equal(result.friendlyInvitations.length, 1);
  assert.equal(result.friendlyInvitations[0].status, "pending");
  assert.equal(typeof result.updatedAt, "number");
  assert.equal(Object.hasOwn(result, "playerDirectory"), false);
  assert.equal(Object.hasOwn(result, "ownTeam"), false);
});

test("友谊赛邀请两小时后自动过期且无法再接受", () => {
  let now = Date.parse("2026-07-23T10:01:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const inviter = account("friendly-expiry-a", "超时邀请方");
  const receiver = account("friendly-expiry-b", "超时接收方");
  join(service, inviter, "超时邀请队");
  join(service, receiver, "超时接收队");
  const receiverTeam = service.accountTeam(receiver.id);

  service.createFriendlyInvitation(inviter, receiverTeam.id);
  const invitation = service.state.friendlyInvitations.at(-1);
  const invitationMail = service.view(receiver).inbox.find((message) => message.payload?.friendlyInvitationId === invitation.id);
  assert.equal(invitation.expiresAt, invitation.createdAt + 2 * 60 * 60 * 1000);
  now = invitation.expiresAt - 1;
  assert.equal(service.view(receiver).friendlyInvitations.at(-1).status, "pending");
  assert.equal(service.inboxMessageDeletable(invitationMail), false);

  now = invitation.expiresAt;
  service.tick();
  assert.equal(invitation.status, "expired");
  assert.equal(service.view(receiver).friendlyInvitations.at(-1).status, "expired");
  assert.equal(service.inboxMessageDeletable(invitationMail), true);
  assert.equal(service.state.friendlyFixtures.length, 0);

  now += 1;
  service.createFriendlyInvitation(inviter, receiverTeam.id);
  const racedInvitation = service.state.friendlyInvitations.at(-1);
  now = racedInvitation.expiresAt;
  assert.throws(() => service.resolveFriendlyInvitation(receiver, racedInvitation.id, "accept"), /超过两小时/);
  assert.equal(racedInvitation.status, "expired");
  assert.equal(service.state.friendlyFixtures.length, 0);
});

test("友谊赛以100体力直播且结算不消耗体力或累计停赛，只保留伤病", () => {
  let now = Date.parse("2026-07-23T10:01:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => now, rng:() => .37 });
  const inviter = account("friendly-state-a", "友谊甲");
  const receiver = account("friendly-state-b", "友谊乙");
  join(service, inviter, "友谊甲队");
  join(service, receiver, "友谊乙队");
  const home = service.accountTeam(inviter.id);
  const away = service.accountTeam(receiver.id);
  const homeBalance = service.wallet(inviter.id).balance;
  const awayBalance = service.wallet(receiver.id).balance;
  const starterId = home.preferredStarterIds[0];
  home.playerState[starterId].fitness = 48;

  service.createFriendlyInvitation(inviter, away.id);
  service.resolveFriendlyInvitation(receiver, service.state.friendlyInvitations.at(-1).id, "accept");
  const fixture = service.state.friendlyFixtures.at(-1);
  now = fixture.startsAt;
  service.tick();
  const live = service.state.liveFriendlies[0];
  assert.equal(live.match.version, 2);
  assert.equal(live.match.engineVersion, "2.0.0-alpha.15");
  const liveStarter = live.match.teams[0].players.find((player) => player.id === starterId);
  assert.equal(liveStarter.state.fitness, 100);
  assert.equal(service.broadcasts().some((entry) => entry.code === live.code && entry.competition === "YDL友谊赛"), true);

  live.match.teams[0].players.forEach((player) => { player.state.fitness = 5; player.matchStats.redCards = 1; });
  liveStarter.injury = { type:"test" };
  live.match.report = { score:[1, 0], teams:live.match.teams.map((team) => ({ ...team, players:team.players.map((player) => ({ ...player, fitness:player.state.fitness, stats:{ ...player.matchStats } })) })) };
  service.advanceLiveFriendlies(now);

  assert.equal(home.playerState[starterId].fitness, 48);
  assert.equal(home.playerState[starterId].suspension ?? 0, 0);
  assert.equal(home.playerState[starterId].cupSuspension ?? 0, 0);
  assert.ok(home.playerState[starterId].injuryRounds > 0);
  assert.equal(fixture.status, "complete");
  assert.equal(service.state.matches.at(-1).competition, "friendly");
  assert.equal(service.wallet(inviter.id).balance, homeBalance);
  assert.equal(service.wallet(receiver.id).balance, awayBalance);
  assert.equal(service.state.ledger.some((entry) => entry.type === "league-match-reward" && entry.matchId === fixture.matchId), false);
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

test("正式比赛只消耗实际出场者体力，替补恢复且联赛杯赛共用同一体力池", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("shared-fitness", "Shared Fitness");
  join(service, user, "Shared Fitness FC");
  const team = service.accountTeam(user.id);
  const leagueFixture = service.state.rounds[0].fixtures.find((fixture) => fixture.homeId === team.id || fixture.awayId === team.id);
  const createdLeague = service.createFixtureMatch(leagueFixture, 1, NOW);
  const leagueIndex = leagueFixture.homeId === team.id ? 0 : 1;
  const starterId = createdLeague.match.teams[leagueIndex].players[0].id;
  const benchId = team.rosterIds.find((id) => !createdLeague.match.teams[leagueIndex].players.some((player) => player.id === id));
  team.playerState[starterId].fitness = 82;
  team.playerState[benchId].fitness = 60;
  createdLeague.match.report = { score:[0, 0], teams:createdLeague.match.teams.map((matchTeam) => ({ ...matchTeam, players:matchTeam.players.map((player) => ({ ...player, fitness:player.id === starterId ? 62 : player.state.fitness, stats:{ ...player.matchStats } })) })) };
  service.finalizeFixture(leagueFixture, 1, createdLeague.match);
  const afterLeague = team.playerState[starterId].fitness;
  assert.equal(afterLeague, 74.8);
  assert.equal(team.playerState[benchId].fitness, 78);

  service.startCup();
  const event = service.state.cup.events[0];
  const cupFixture = service.cupEventFixtures(event).find((fixture) => fixture.homeId === team.id || fixture.awayId === team.id);
  const createdCup = service.createFixtureMatch(cupFixture, event.round, NOW, { competitionMode:"cup" });
  const cupIndex = cupFixture.homeId === team.id ? 0 : 1;
  assert.equal(createdCup.match.teams[cupIndex].players.find((player) => player.id === starterId).state.fitness, afterLeague);
  createdCup.match.report = { score:[0, 0], teams:createdCup.match.teams.map((matchTeam) => ({ ...matchTeam, players:matchTeam.players.map((player) => ({ ...player, fitness:player.id === starterId ? 54.8 : player.state.fitness, stats:{ ...player.matchStats } })) })) };
  service.finalizeCupFixture(cupFixture, event, createdCup.match);
  assert.equal(team.playerState[starterId].fitness, 67.6);
  assert.equal(team.playerState[benchId].fitness, 96);
});

test("连续正式比赛会消耗出场阵容体力，同时让未出场球员恢复", () => {
  const service = new YellowDogsLeagueService({ statePath:null, now:() => NOW, rng:() => .37 });
  const user = account("fitness-owner", "Fitness Owner");
  join(service, user, "Fitness FC");
  const team = service.accountTeam(user.id);
  for (let round = 0; round < 9; round += 1) service.simulateNextRound();
  const starterFitness = team.preferredStarterIds.map((id) => team.playerState[id].fitness);
  const benchFitness = team.rosterIds.filter((id) => !team.preferredStarterIds.includes(id)).map((id) => team.playerState[id].fitness);
  const starterAverage = starterFitness.reduce((sum, value) => sum + value, 0) / starterFitness.length;
  const benchAverage = benchFitness.reduce((sum, value) => sum + value, 0) / benchFitness.length;
  assert.ok(Math.min(...starterFitness) >= 50);
  assert.ok(starterAverage < 80);
  assert.ok(benchAverage > starterAverage);
});

test("daily season settlement is idempotent and daily reset preserves player assets", () => {
  let currentTime = Date.parse("2026-07-29T18:30:00+08:00");
  const service = new YellowDogsLeagueService({ statePath:null, now:() => currentTime, rng:() => .37 });
  const user = account("daily-reward-owner", "Daily Reward");
  join(service, user, "Daily Reward FC");
  const team = service.accountTeam(user.id);
  const originalRoster = [...team.rosterIds];
  const originalPack = service.grantS4Pack(user.id, "legend-random", 1, { source:"test" })[0].id;
  service.wallet(user.id).balance = 123456;
  team.playerState[originalRoster[0]] = { fitness:31, suspension:2, injuryRounds:3 };
  service.state.season.status = "completed";
  service.state.season.completedAt = currentTime - 11 * 60 * 1000;
  service.state.season.currentRound = 18;
  team.table = { played:18, won:18, drawn:0, lost:0, goalsFor:40, goalsAgainst:1, points:54 };
  const first = service.settleDailySeason();
  assert.equal(first.id, `${service.state.season.id}+daily-settlement`);
  assert.equal(service.wallet(user.id).balance, 133456);
  assert.equal(service.s4PackInventory(user.id).filter((item) => item.grantId === first.id).length, 2);
  assert.equal(service.settleDailySeason().id, first.id);
  assert.equal(service.wallet(user.id).balance, 133456);

  currentTime = Date.parse("2026-07-30T09:51:01+08:00");
  service.resetDailyCompetitions();
  assert.equal(service.state.season.status, "active");
  assert.equal(service.state.season.firstRoundAt, Date.parse("2026-07-30T10:00:00+08:00"));
  assert.deepEqual(service.accountTeam(user.id).rosterIds, originalRoster);
  assert.equal(service.wallet(user.id).balance, 133456);
  assert.equal(service.s4PackInventory(user.id).some((item) => item.id === originalPack), true);
  assert.deepEqual(service.accountTeam(user.id).playerState[originalRoster[0]], { fitness:100, suspension:0, cupSuspension:0, injuryRounds:0 });
  assert.equal(service.state.dailyAutomation.lastRewardedSeasonId, first.seasonId);
  assert.equal(service.state.dailyAutomation.lastResetDate, "2026-07-30");
  service.state.dailyAutomation.enabled = true;

  currentTime = Date.parse("2026-07-30T10:00:00+08:00");
  service.tick();
  assert.equal(service.state.liveRound.startedAt, currentTime);
  currentTime = Date.parse("2026-07-30T10:01:00+08:00");
  service.tick();
  assert.equal(service.state.cup.status, "active");
  assert.equal(service.state.cup.nextRoundAt, Date.parse("2026-07-30T10:10:00+08:00"));
});
