import test from "node:test";
import assert from "node:assert/strict";
import { INDIVIDUALIZED_PLAYERS, REAL_PLAYER_BY_ID, REAL_PLAYER_POOLS, REAL_PLAYERS } from "../versus/player-pool.js";
import { VersusRoomService } from "../versus/room-service.js";
import { createLineupSeed, parseLineupSeed } from "../versus/lineup-seed.js";
import {
  EXTRA_DURATION_MS,
  HALFTIME_ADJUSTMENT_MS,
  PENALTY_KICK_INTERVAL_MS,
  REGULAR_DURATION_MS,
  advanceVersusMatch,
  createVersusMatch,
  drawVersusReferee,
  publicMatch,
  requestTacticalPause,
  resumeVersusMatch,
  updatePausedTactics,
  versusPositionFit,
} from "../versus/match-engine.js";
import {
  VERSUS_STYLES,
  VERSUS_TEAM_SIZE,
  analyzeElevenFormation,
  defaultElevenPositions,
  drawUniquePlayers,
  formationStructureProfile,
} from "../versus/rules.js";

const BALANCED_DRAFT_POOLS = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "ATT", "ATT", "ATT"];

test("玩家ID绑定、自定义分享码与历史战绩会持久累计", () => {
  let now = 100;
  const service = new VersusRoomService({ rng: () => 0.23, now: () => now, accountsPath: null });
  const hostAccount = service.bindAccount("host_001", null, "主队玩家");
  const guestAccount = service.bindAccount("guest_001", null, "客队玩家");
  assert.throws(() => service.bindAccount("host_001", "wrong-token", "冒用者"), /绑定|凭证/);
  const host = service.create("主队玩家", "FRIEND01", "host_001", hostAccount.accountToken);
  const guest = service.join("friend01", "客队玩家", "guest_001", guestAccount.accountToken);
  assert.equal(host.room.code, "FRIEND01");
  assert.equal(guest.room.players[1].playerId, "guest_001");
  assert.throws(() => service.create("重复", "FRIEND01", "host_001", hostAccount.accountToken), /正在使用/);
  assert.throws(() => service.create("过短", "ABC", "host_001", hostAccount.accountToken), /6至20位/);

  const internal = service.getRoom("FRIEND01");
  internal.players.forEach((seat) => service.autoCompleteDraft(internal, seat));
  service.beginTactics(internal);
  internal.players.forEach((seat) => { seat.ready = true; });
  service.beginMatch(internal, now);
  const broadcasts = service.broadcasts();
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].code, "FRIEND01");
  const watching = service.watch("FRIEND01", "场边观众");
  assert.equal(watching.broadcast.match.teams[0].tactic, internal.match.teams[0].tactic);
  assert.equal(watching.broadcast.match.teams[1].style, internal.match.teams[1].style);
  assert.equal(service.view(internal, internal.players[0].id).spectators[0].name, "场边观众");
  assert.equal(service.watchView("FRIEND01", watching.spectatorToken).spectators.length, 1);
  now += REGULAR_DURATION_MS + 35_000;
  service.getRoom("FRIEND01");
  now += EXTRA_DURATION_MS + 1_000;
  service.getRoom("FRIEND01");
  now += PENALTY_KICK_INTERVAL_MS * 12 + 1_000;
  service.getRoom("FRIEND01");
  const profile = service.profile("host_001", hostAccount.accountToken);
  assert.equal(profile.summary.played, 1);
  assert.equal(profile.summary.wins + profile.summary.losses, 1);
  assert.equal("draws" in profile.summary, false);
  assert.equal(profile.matches.length, 1);
  assert.equal(profile.matches[0].opponentId, "guest_001");
  assert.equal(profile.matches[0].hasDetails, true);
  assert.ok(profile.matches[0].ownFormation && profile.matches[0].opponentFormation);
  const detail = service.profileMatch("host_001", hostAccount.accountToken, profile.matches[0].id);
  assert.equal(detail.teams.length, 2);
  assert.ok(detail.teams.every((team) => team.formation && team.tactic && team.style));
  assert.ok(Array.isArray(detail.importantEvents));
  assert.equal(detail.viewerIndex, 0);
  assert.ok(Number.isInteger(profile.summary.goals));
  assert.ok(Number.isInteger(profile.summary.assists));
});

test("玩家只输入昵称时由后台自动生成并复用唯一ID", () => {
  const service = new VersusRoomService({ accountsPath: null });
  const created = service.bindAccount(null, null, "自动玩家");
  assert.match(created.profile.id, /^P-[A-F0-9]{10}$/);
  assert.equal(created.profile.nickname, "自动玩家");
  const restored = service.bindAccount(null, created.accountToken, "新昵称");
  assert.equal(restored.profile.id, created.profile.id);
  assert.equal(restored.profile.nickname, "新昵称");
});

test("十一人对战拥有四个各125人的唯一真实球员池", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(REAL_PLAYER_POOLS).map(([key, players]) => [key, players.length])), {
    GK: 125,
    DEF: 125,
    MID: 125,
    ATT: 125,
  });
  assert.equal(REAL_PLAYERS.length, 500);
  assert.equal(new Set(REAL_PLAYERS.map((player) => player.id)).size, 500);
  assert.equal(new Set(REAL_PLAYERS.map((player) => player.name)).size, 500);
  assert.ok(REAL_PLAYERS.every((player) => player.nationality && player.club));
  assert.ok(REAL_PLAYERS.every((player) => Number.isFinite(player.heightCm) && player.heightCm >= 165 && player.heightCm <= 202));
  assert.ok(new Set(REAL_PLAYERS.map((player) => player.heightCm)).size > 20);
  assert.deepEqual(REAL_PLAYERS.filter((player) => player.grade === "S").map((player) => player.name).sort(),
    ["C罗", "克罗斯", "哈兰德", "姆巴佩", "库尔图瓦", "梅西", "莫德里奇"].sort());
  assert.ok(REAL_PLAYERS.every((player) => ["S", "A", "B", "C"].includes(player.grade)));
  assert.ok(REAL_PLAYERS.filter((player) => player.role !== "GK").every((player) => player.secondaryRole));
  assert.ok(REAL_PLAYER_POOLS.GK.every((player) => player.secondaryRole === null));
  assert.equal(INDIVIDUALIZED_PLAYERS.length, 100);
  assert.ok(INDIVIDUALIZED_PLAYERS.every((player) => player.signature && player.archetype && player.nationality && player.club));
  assert.ok(INDIVIDUALIZED_PLAYERS.every((player) => !player.nationality.startsWith("未登记") && !player.club.startsWith("未登记")));
  assert.equal(INDIVIDUALIZED_PLAYERS.at(-1).overall, 90);
});

test("副位置减益小于完全陌生位置减益", () => {
  const player = REAL_PLAYER_POOLS.ATT.find((entry) => entry.role === "ST" && entry.secondaryRole);
  assert.equal(versusPositionFit(player, player.role), 1);
  assert.equal(versusPositionFit(player, player.secondaryRole), 0.9);
  assert.ok(versusPositionFit(player, player.secondaryRole) > versusPositionFit(player, "CB"));
  assert.ok(versusPositionFit(player, "CB") <= 0.56);
  assert.ok(versusPositionFit(player, "GK") <= 0.38);
});

test("位置池三选一不会出现已被选中的球员", () => {
  const firstThree = REAL_PLAYER_POOLS.ATT.slice(0, 3).map((player) => player.id);
  const choices = drawUniquePlayers("ATT", firstThree, () => 0, 3);
  assert.equal(choices.length, 3);
  assert.ok(choices.every((player) => !firstThree.includes(player.id)));
  assert.equal(new Set(choices.map((player) => player.id)).size, 3);
});

test("三选一卡牌按左中右位置分散发放", () => {
  const attackers = drawUniquePlayers("ATT", [], () => 0.42, 3);
  const defenders = drawUniquePlayers("DEF", [], () => 0.42, 3);
  const midfielders = drawUniquePlayers("MID", [], () => 0.42, 3);
  assert.deepEqual(attackers.map((player) => player.role), ["LW", "ST", "RW"]);
  assert.deepEqual(defenders.map((player) => player.role), ["LB", "CB", "RB"]);
  assert.equal(midfielders[0].role, "LM");
  assert.ok(["DM", "AM"].includes(midfielders[1].role));
  assert.equal(midfielders[2].role, "RM");
});

test("S级保底球员占据自然位置且不破坏三位置发牌", () => {
  const guaranteed = REAL_PLAYER_POOLS.ATT.find((player) => player.grade === "S");
  const choices = drawUniquePlayers("ATT", [], () => 0.31, 3, [guaranteed]);
  assert.ok(choices.some((player) => player.id === guaranteed.id));
  assert.deepEqual(choices.map((player) => player.role).sort(), ["LW", "RW", "ST"]);
});

test("十一人阵型要求门将恰好一人且其余三线各至少一人", () => {
  const players = [
    ...REAL_PLAYER_POOLS.GK.slice(0, 1),
    ...REAL_PLAYER_POOLS.DEF.slice(0, 4),
    ...REAL_PLAYER_POOLS.MID.slice(0, 3),
    ...REAL_PLAYER_POOLS.ATT.slice(0, 3),
  ];
  const positions = defaultElevenPositions(players);
  const valid = analyzeElevenFormation(players, positions);
  assert.equal(valid.valid, true);
  assert.equal(valid.name, "4-3-3");
  const invalid = analyzeElevenFormation(players, Object.fromEntries(players.map((player, index) => [player.id, { x: 10 + index * 7, y: 45 }])));
  assert.equal(invalid.valid, false);
  const twoGoalkeepers = { ...positions, [players[1].id]: { ...positions[players[1].id], y: 90 } };
  const invalidGoalkeepers = analyzeElevenFormation(players, twoGoalkeepers);
  assert.equal(invalidGoalkeepers.counts.GK, 2);
  assert.equal(invalidGoalkeepers.valid, false);
  assert.match(invalidGoalkeepers.message, /只能有一人/);
});

test("前腰识别区域向前延伸且不会过早判定为中锋", () => {
  const players = [
    ...REAL_PLAYER_POOLS.GK.slice(0, 1),
    ...REAL_PLAYER_POOLS.DEF.slice(0, 4),
    ...REAL_PLAYER_POOLS.MID.slice(0, 4),
    ...REAL_PLAYER_POOLS.ATT.slice(0, 2),
  ];
  const positions = defaultElevenPositions(players);
  const attackingMidfielder = players.find((player) => player.pool === "MID");
  positions[attackingMidfielder.id] = { x: 50, y: 30 };
  const formation = analyzeElevenFormation(players, positions);
  assert.equal(formation.roles[attackingMidfielder.id], "AM");
  assert.equal(formation.counts.MID, 4);
  positions[attackingMidfielder.id] = { x: 50, y: 26 };
  assert.equal(analyzeElevenFormation(players, positions).roles[attackingMidfielder.id], "ST");
});

test("选秀完成门将选择后会锁定门将池", () => {
  let now = 900;
  const service = new VersusRoomService({ rng: () => 0.19, now: () => now++ });
  const host = service.create("甲");
  service.join(host.room.code, "乙");
  const offer = service.drawPlayers(host.room.code, host.token, "GK");
  assert.ok(offer.offer.choices.every((player) => Number.isFinite(player.heightCm) && player.nationality && player.club));
  const view = service.choosePlayer(host.room.code, host.token, offer.offer.choices[0].id);
  assert.equal(view.players[0].draftLines.counts.GK, 1);
  assert.ok(!view.players[0].draftLines.availablePools.includes("GK"));
  assert.throws(() => service.drawPlayers(host.room.code, host.token, "GK"), /剩余名额|一名门将/);
});

test("异常站位和过薄后防会受到显著结构惩罚", () => {
  const players = [
    ...REAL_PLAYER_POOLS.GK.slice(0, 1),
    ...REAL_PLAYER_POOLS.DEF.slice(0, 4),
    ...REAL_PLAYER_POOLS.MID.slice(0, 3),
    ...REAL_PLAYER_POOLS.ATT.slice(0, 3),
  ];
  const normal = formationStructureProfile(players, defaultElevenPositions(players));
  const oneDefenderPositions = Object.fromEntries(players.map((player, index) => [player.id, {
    x: 12 + index * 7,
    y: index === 0 ? 90 : index === 1 ? 69 : index < 6 ? 45 : 19,
  }]));
  const oneDefender = formationStructureProfile(players, oneDefenderPositions);
  const strikerInGoalPositions = { ...defaultElevenPositions(players) };
  [strikerInGoalPositions[players[0].id], strikerInGoalPositions[players.at(-1).id]] = [strikerInGoalPositions[players.at(-1).id], strikerInGoalPositions[players[0].id]];
  const strikerInGoal = formationStructureProfile(players, strikerInGoalPositions);
  assert.equal(normal.multipliers.defense, 1);
  assert.equal(oneDefender.counts.DEF, 1);
  assert.ok(oneDefender.multipliers.defense <= 0.56);
  assert.ok(oneDefender.multipliers.transitionRisk > normal.multipliers.transitionRisk);
  assert.equal(strikerInGoal.mismatches.emergencyKeepers, 1);
  assert.ok(strikerInGoal.multipliers.goalkeeper < 0.4);
  assert.ok(strikerInGoal.multipliers.coherence < 0.7);
});

test("房间选择球员后自动绑定一张特性并进入双方战术阶段", () => {
  let now = 1_000;
  const service = new VersusRoomService({ rng: () => 0.17, now: () => now++ });
  const host = service.create("甲");
  const guest = service.join(host.room.code, "乙");
  const clients = [host.token, guest.token];
  for (let round = 0; round < VERSUS_TEAM_SIZE; round += 1) {
    for (const playerToken of clients) {
      let view = service.drawPlayers(host.room.code, playerToken, BALANCED_DRAFT_POOLS[round]);
      view = service.choosePlayer(host.room.code, playerToken, view.offer.choices[0].id);
      assert.equal(view.offer, null);
    }
  }
  const room = service.getRoom(host.room.code);
  const hostView = service.view(room, host.token);
  assert.equal(hostView.phase, "tactics");
  assert.equal(hostView.players[0].roster.length, 11);
  assert.equal(hostView.players[1].roster.length, 0);
  assert.equal(hostView.players[1].draftLines, null);
  assert.equal(hostView.players[1].formation, null);
  assert.equal(hostView.players[1].tactic, null);
  assert.equal(new Set(room.players.flatMap((seat) => seat.selections.map((selection) => selection.playerId))).size, 22);
  assert.ok(room.players.flatMap((seat) => seat.selections).every((selection) => selection.traitIds.length === 1));
  assert.throws(() => service.chooseTrait(), /已移除/);
});

test("双方选秀都获得独立且必定出现的S级球员保底", () => {
  let now = 1_250;
  const service = new VersusRoomService({ rng: () => 0.41, now: () => now++ });
  const host = service.create("甲");
  const guest = service.join(host.room.code, "乙");
  const internal = service.getRoom(host.room.code);
  const guaranteedIds = internal.players.map((seat) => seat.guaranteedPlayerId);
  assert.equal(new Set(guaranteedIds).size, 2);
  assert.ok(guaranteedIds.every((id) => REAL_PLAYERS.find((player) => player.id === id)?.grade === "S"));

  const hostPool = REAL_PLAYERS.find((player) => player.id === guaranteedIds[0]).pool;
  const hostOffer = service.drawPlayers(host.room.code, host.token, hostPool);
  assert.ok(hostOffer.offer.choices.some((player) => player.id === guaranteedIds[0]));
  const guestOffer = service.drawPlayers(host.room.code, guest.token, hostPool);
  assert.ok(guestOffer.offer.choices.every((player) => player.id !== guaranteedIds[0]));
});

test("开发者入口支持单人完整流程和快速开赛", () => {
  let now = 1_500;
  const service = new VersusRoomService({ rng: () => 0.27, now: () => now++ });
  const fullFlow = service.createDeveloperRoom("开发者", false);
  assert.equal(fullFlow.room.phase, "draft");
  assert.equal(fullFlow.room.players[0].selectionCount, 0);
  assert.equal(service.getRoom(fullFlow.room.code).players[1].selections.length, 11);
  const quickStart = service.createDeveloperRoom("开发者", true);
  assert.equal(quickStart.room.phase, "match");
  assert.equal(quickStart.room.players[0].roster.length, 11);
  assert.equal(quickStart.room.players[1].roster.length, 11);
  assert.ok(quickStart.room.match.teams.every((team) => team.formation === "4-3-3"));
  assert.ok(quickStart.room.match);
});

test("阵容种子完整保存球员、特性、站位和战术并拒绝篡改", () => {
  let now = 1_700;
  const service = new VersusRoomService({ rng: () => 0.29, now: () => now++ });
  const created = service.createDeveloperRoom("种子来源", true);
  const room = service.getRoom(created.room.code);
  const seat = room.players[0];
  const seed = createLineupSeed({
    selections: seat.selections,
    positions: seat.positions,
    tactic: "positive",
    style: "highPress",
    attackFocus: "left",
    defenseFocus: "right",
  }, { nonce:"fixed-test" });
  const parsed = parseLineupSeed(seed);
  assert.deepEqual(parsed.selections, seat.selections);
  assert.deepEqual(parsed.positions, seat.positions);
  assert.equal(parsed.tactic, "positive");
  assert.equal(parsed.style, "highPress");
  assert.equal(parsed.attackFocus, "left");
  assert.equal(parsed.defenseFocus, "right");
  assert.throws(() => parseLineupSeed(`${seed.slice(0, -1)}x`), /校验失败/);
  const goalkeeperIndex = seat.selections.findIndex((selection) => REAL_PLAYER_BY_ID[selection.playerId].pool === "GK");
  const outfieldIndex = seat.selections.findIndex((selection) => REAL_PLAYER_BY_ID[selection.playerId].pool !== "GK");
  const secondGoalkeeper = REAL_PLAYER_POOLS.GK.find((player) => player.id !== seat.selections[goalkeeperIndex].playerId);
  const twoGoalkeeperSelections = structuredClone(seat.selections);
  twoGoalkeeperSelections[outfieldIndex] = { playerId: secondGoalkeeper.id, traitIds: [seat.selections[goalkeeperIndex].traitIds[0]] };
  assert.throws(() => createLineupSeed({
    selections: twoGoalkeeperSelections,
    positions: seat.positions,
    tactic: "positive",
    style: "highPress",
  }), /只能包含一名门将/);
});

test("赛后阵容可以导入新房间跳过选秀并在比赛中公开来源标记", () => {
  let sourceNow = 2_000;
  const sourceService = new VersusRoomService({ rng: () => 0.33, now: () => sourceNow });
  const source = sourceService.createDeveloperRoom("阵容来源", true);
  sourceNow += REGULAR_DURATION_MS + 1;
  let sourceRoom = sourceService.getRoom(source.room.code);
  if (sourceRoom.phase !== "report") {
    sourceNow += 30_001;
    sourceRoom = sourceService.getRoom(source.room.code);
  }
  assert.equal(sourceRoom.phase, "report");
  const exported = sourceService.exportLineup(source.room.code, source.token);
  assert.match(exported.seed, /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]{11}$/);

  let targetNow = 5_000;
  const targetService = new VersusRoomService({ rng: () => 0.38, now: () => targetNow++ });
  const target = targetService.createDeveloperRoom("导入玩家", false);
  const importedView = targetService.importLineup(target.room.code, target.token, exported.seed);
  assert.equal(importedView.phase, "tactics");
  assert.equal(importedView.players[0].selectionCount, 11);
  assert.equal(importedView.players[0].importedLineup, true);
  assert.equal(importedView.players[1].roster.length, 0);
  assert.equal(importedView.players[1].importedLineup, null);
  const own = importedView.players[0];
  const matchView = targetService.saveTactics(target.room.code, target.token, {
    positions: Object.fromEntries(own.roster.map((player) => [player.id, player.position])),
    tactic: own.tactic,
    style: own.style,
    ready: true,
  });
  assert.equal(matchView.phase, "match");
  assert.equal(matchView.match.teams[0].importedLineup, true);
  assert.equal(matchView.match.teams[1].importedLineup, false);
  const targetRoom = targetService.getRoom(target.room.code);
  const opponentView = targetService.view(targetRoom, targetRoom.players[1].id);
  assert.equal(opponentView.match.teams[0].importedLineup, true);
});

test("双方只有提交有效十一人阵型后才能同时准备", () => {
  let now = 2_000;
  const service = new VersusRoomService({ rng: () => 0.31, now: () => now++ });
  const host = service.create("甲");
  const guest = service.join(host.room.code, "乙");
  for (let round = 0; round < VERSUS_TEAM_SIZE; round += 1) {
    for (const playerToken of [host.token, guest.token]) {
      const playerOffer = service.drawPlayers(host.room.code, playerToken, BALANCED_DRAFT_POOLS[round]);
      service.choosePlayer(host.room.code, playerToken, playerOffer.offer.choices[0].id);
    }
  }
  for (const [index, playerToken] of [host.token, guest.token].entries()) {
    const view = service.view(service.getRoom(host.room.code), playerToken);
    const own = view.players[view.viewerIndex];
    service.saveTactics(host.room.code, playerToken, { positions:defaultElevenPositions(own.roster), tactic:index === 0 ? "balanced" : "parkBus", style:index === 0 ? "possession" : "lowBlock", ready:true });
  }
  const hostView = service.view(service.getRoom(host.room.code), host.token);
  assert.equal(hostView.bothReady, true);
  assert.equal(hostView.phase, "match");
  assert.equal(hostView.players[1].roster.length, 11);
  assert.ok(hostView.players[1].formation);
  assert.equal(hostView.players[1].tactic, null);
  assert.equal(hostView.players[1].style, null);
  assert.equal(hostView.match.teams[0].tactic, "balanced");
  assert.equal(hostView.match.teams[1].tactic, null);
  assert.equal(hostView.match.teams[0].style, "possession");
  assert.equal(hostView.match.teams[1].style, null);
});

function matchSeat(name, offset, tactic = "balanced", style = "possession") {
  const players = [
    REAL_PLAYER_POOLS.GK[offset],
    ...REAL_PLAYER_POOLS.DEF.slice(offset, offset + 4),
    ...REAL_PLAYER_POOLS.MID.slice(offset, offset + 3),
    ...REAL_PLAYER_POOLS.ATT.slice(offset, offset + 3),
  ];
  return { name, players, positions: defaultElevenPositions(players), tactic, style };
}

test("比赛战术适配取决于球员能力并受到天气修正", () => {
  const technicalSeat = matchSeat("技术队", 0, "balanced", "possession");
  technicalSeat.players = technicalSeat.players.map((player) => ({
    ...player,
    attributes: { ...player.attributes, passing:95, firstTouch:95, decisions:94, dribbling:93, composure:94 },
  }));
  const limitedSeat = matchSeat("粗糙队", 12, "balanced", "possession");
  limitedSeat.players = limitedSeat.players.map((player) => ({
    ...player,
    attributes: { ...player.attributes, passing:52, firstTouch:50, decisions:54, dribbling:49, composure:55 },
  }));
  const technical = publicMatch(createVersusMatch([technicalSeat, matchSeat("对手", 24)], { now:0,seed:"technical",weather:"sunny" }), 0, 0);
  const limited = publicMatch(createVersusMatch([limitedSeat, matchSeat("对手", 24)], { now:0,seed:"limited",weather:"sunny" }), 0, 0);
  assert.ok(technical.teams[0].styleFit > limited.teams[0].styleFit);
  const longBallSunny = publicMatch(createVersusMatch([matchSeat("长传队", 0, "balanced", "longBall"), matchSeat("对手", 24)], { now:0,seed:"long-sunny",weather:"sunny" }), 0, 0);
  const longBallStorm = publicMatch(createVersusMatch([matchSeat("长传队", 0, "balanced", "longBall"), matchSeat("对手", 24)], { now:0,seed:"long-storm",weather:"storm" }), 0, 0);
  const possessionSunny = publicMatch(createVersusMatch([matchSeat("短传队", 0, "balanced", "possession"), matchSeat("对手", 24)], { now:0,seed:"short-sunny",weather:"sunny" }), 0, 0);
  const possessionStorm = publicMatch(createVersusMatch([matchSeat("短传队", 0, "balanced", "possession"), matchSeat("对手", 24)], { now:0,seed:"short-storm",weather:"storm" }), 0, 0);
  assert.ok(longBallStorm.teams[0].styleFit > longBallSunny.teams[0].styleFit);
  assert.ok(possessionStorm.teams[0].styleFit < possessionSunny.teams[0].styleFit);
});

test("两翼齐飞根据边路球员能力获得战术适配收益", () => {
  assert.ok(VERSUS_STYLES.includes("wingPlay"));
  const strong = matchSeat("强力边路", 0, "balanced", "wingPlay");
  const weak = matchSeat("薄弱边路", 0, "balanced", "wingPlay");
  const adjustWidePlayers = (seat, value) => ({
    ...seat,
    players: seat.players.map((player) => {
      const x = seat.positions[player.id]?.x ?? 50;
      if (x > 34 && x < 66) return player;
      return {
        ...player,
        attributes: {
          ...player.attributes,
          crossing: value,
          pace: value,
          acceleration: value,
          dribbling: value,
          passing: value,
          stamina: value,
        },
      };
    }),
  });
  const opponent = matchSeat("对手", 24);
  const strongMatch = publicMatch(createVersusMatch([adjustWidePlayers(strong, 95), opponent], { now:0, seed:"wing-strong", weather:"sunny" }), 0, 0);
  const weakMatch = publicMatch(createVersusMatch([adjustWidePlayers(weak, 48), opponent], { now:0, seed:"wing-weak", weather:"sunny" }), 0, 0);
  assert.ok(strongMatch.teams[0].styleFit > weakMatch.teams[0].styleFit);
  const narrow = matchSeat("收窄边路", 0, "balanced", "wingPlay");
  narrow.positions = Object.fromEntries(Object.entries(narrow.positions).map(([id, position]) => [id, { ...position, x:Math.max(35, Math.min(65, position.x)) }]));
  const stretched = matchSeat("充分拉边", 0, "balanced", "wingPlay");
  stretched.positions = Object.fromEntries(Object.entries(stretched.positions).map(([id, position]) => [id, { ...position, x:position.x < 50 ? 8 : position.x > 50 ? 92 : 50 }]));
  const narrowView = publicMatch(createVersusMatch([narrow, opponent], { now:0, seed:"wing-narrow", weather:"sunny" }), 0, 0);
  const stretchedView = publicMatch(createVersusMatch([stretched, opponent], { now:0, seed:"wing-stretched", weather:"sunny" }), 0, 0);
  assert.ok(stretchedView.teams[0].styleFit > narrowView.teams[0].styleFit);
});

test("三中卫可以横向展开且边翼卫拥有独立位置识别", () => {
  const players = [
    ...REAL_PLAYER_POOLS.GK.slice(0, 1),
    ...REAL_PLAYER_POOLS.DEF.slice(0, 5),
    ...REAL_PLAYER_POOLS.MID.slice(0, 4),
    ...REAL_PLAYER_POOLS.ATT.slice(0, 1),
  ];
  const positions = defaultElevenPositions(players);
  const defenders = players.filter((player) => player.pool === "DEF");
  positions[defenders[0].id] = { x:18, y:57 };
  positions[defenders[1].id] = { x:32, y:70 };
  positions[defenders[2].id] = { x:50, y:70 };
  positions[defenders[3].id] = { x:68, y:70 };
  positions[defenders[4].id] = { x:82, y:57 };
  const formation = analyzeElevenFormation(players, positions);
  assert.deepEqual(defenders.slice(1, 4).map((player) => formation.roles[player.id]), ["CB", "CB", "CB"]);
  assert.equal(formation.roles[defenders[0].id], "LWB");
  assert.equal(formation.roles[defenders[4].id], "RWB");
  assert.equal(formation.counts.DEF, 5);
});

test("对战包含两分钟比赛与三十秒中场调整且没有替补或换人数据", () => {
  const match = createVersusMatch([matchSeat("甲", 0), matchSeat("乙", 12)], { now: 0, seed: "two-minute" });
  advanceVersusMatch(match, REGULAR_DURATION_MS - 1);
  assert.ok(match.minute < 90);
  advanceVersusMatch(match, REGULAR_DURATION_MS + HALFTIME_ADJUSTMENT_MS);
  assert.equal(match.minute, 90);
  assert.ok(match.finished || match.segment === "extra");
  assert.ok(match.teams.every((team) => !("bench" in team)));
  assert.ok(match.events.every((entry) => entry.type !== "substitution"));
});

test("战术暂停冻结比赛时钟且每方只能使用一次", () => {
  const match = createVersusMatch([matchSeat("甲", 0), matchSeat("乙", 12)], { now: 0, seed: "pause" });
  advanceVersusMatch(match, 30_000);
  const frozenMinute = match.minute;
  const opponentStyleFitBeforeMarking = publicMatch(match, 30_000, 1).teams[1].styleFit;
  requestTacticalPause(match, 0, 30_000);
  advanceVersusMatch(match, 50_000);
  assert.equal(match.minute, frozenMinute);
  const twoGoalkeeperPositions = Object.fromEntries(match.teams[0].players.map((player, index) => [player.id, { x: 10 + index * 7, y: index < 2 ? 90 : 45 }]));
  assert.throws(() => updatePausedTactics(match, 0, { positions: twoGoalkeeperPositions, tactic: "balanced", style: "possession" }), /最多只能安排一名/);
  assert.throws(() => updatePausedTactics(match, 0, { positions: match.teams[0].positions, tactic: "balanced", style: "possession", markingTargetId: match.teams[0].players[0].id }), /对方仍在场/);
  const attackingPositions = Object.fromEntries(match.teams[0].players.map((player, index) => [player.id, { x: 10 + index * 7, y: 18 }]));
  const markingTarget = match.teams[1].players.find((player) => player.active && player.assignedRole !== "GK");
  updatePausedTactics(match, 0, { positions: attackingPositions, tactic: "allOutAttack", style: "highPress", markingTargetId: markingTarget.id });
  assert.equal(match.teams[0].tactic, "allOutAttack");
  assert.equal(match.teams[0].adjustmentBoostUntilMinute, frozenMinute + 15);
  assert.equal(match.teams[0].markingTargetId, markingTarget.id);
  assert.equal(match.teams[0].players.filter((player) => player.assignedRole === "GK").length, 0);
  const opponentView = publicMatch(match, 50_000, 1);
  assert.equal(opponentView.teams[0].formation, "0-0-11");
  assert.equal(opponentView.teams[0].tactic, null);
  assert.equal(opponentView.teams[0].style, null);
  assert.equal(opponentView.teams[0].markingTargetId, markingTarget.id);
  assert.ok(opponentView.teams[1].styleFit < opponentStyleFitBeforeMarking);
  assert.match(opponentView.events.at(-1).text, /阵型改为0-0-11，比赛思路调整为全力进攻，改打高位压迫/);
  assert.match(opponentView.events.at(-1).text, new RegExp(`重点盯防${markingTarget.name}`));
  assert.equal(opponentView.events.at(-1).tactic, "allOutAttack");
  assert.equal(opponentView.events.at(-1).style, "highPress");
  resumeVersusMatch(match, 0, 50_000);
  advanceVersusMatch(match, 61_000);
  assert.ok(match.minute > frozenMinute);
  assert.throws(() => requestTacticalPause(match, 0, 61_000), /已经使用/);
});

test("中场休息固定三十秒且双方都能提交临场调整", () => {
  const match = createVersusMatch([matchSeat("甲", 0), matchSeat("乙", 12)], { now: 0, seed: "halftime-both" });
  advanceVersusMatch(match, REGULAR_DURATION_MS / 2);
  assert.equal(match.minute, 45);
  assert.equal(match.pause.kind, "halftime");
  updatePausedTactics(match, 0, { positions:match.teams[0].positions, tactic:"positive", style:"wingPlay", attackFocus:"left", defenseFocus:"center" });
  updatePausedTactics(match, 1, { positions:match.teams[1].positions, tactic:"defensive", style:"roughPlay", attackFocus:"right", defenseFocus:"left" });
  assert.equal(match.teams[0].adjustmentBoostUntilMinute, 0);
  assert.equal(match.teams[1].adjustmentBoostUntilMinute, 0);
  resumeVersusMatch(match, 0, REGULAR_DURATION_MS / 2 + 2_000);
  assert.deepEqual(match.pause.submitted, [true, false]);
  resumeVersusMatch(match, 1, REGULAR_DURATION_MS / 2 + 3_000);
  assert.equal(match.pause, null);
  assert.match(match.events.at(-1).text, /提前开始/);
  advanceVersusMatch(match, REGULAR_DURATION_MS / 2 + 6_000);
  assert.ok(match.minute > 45);
  assert.equal(match.teams[0].attackFocus, "left");
  assert.equal(match.teams[1].style, "roughPlay");
});

test("裁判尺度会公开展示，黑哨事件保证红牌与点球", () => {
  assert.equal(drawVersusReferee(() => 0.1).key, "lenient");
  assert.equal(drawVersusReferee(() => 0.5).key, "standard");
  assert.equal(drawVersusReferee(() => 0.9).key, "strict");
  const favored = matchSeat("阿根廷较多", 0, "balanced", "possession");
  const punished = matchSeat("阿根廷较少", 12, "defensive", "roughPlay");
  favored.players = favored.players.map((player, index) => ({ ...player, nationality: index < 2 ? "Argentina" : null }));
  punished.players = punished.players.map((player) => ({ ...player, nationality: null }));
  const match = createVersusMatch([favored, punished], { now: 0, seed: "black-whistle", weather: "sunny", referee: "strict" });
  match.blackWhistleMinute = 1;
  advanceVersusMatch(match, 2_000);
  const view = publicMatch(match, 2_000, 0, true);
  assert.equal(view.referee.key, "strict");
  assert.equal(view.blackWhistle, true);
  assert.ok(match.events.some((entry) => entry.type === "blackWhistle"));
  assert.ok(match.events.some((entry) => entry.type === "red" && entry.blackWhistle));
  assert.ok(match.events.some((entry) => entry.type === "penaltyAwarded" && entry.blackWhistle));
  assert.ok(match.teams[1].stats.redCards >= 1);
});

test("雷暴对战必定至少造成一名球员伤退且不会自动递补", () => {
  const match = createVersusMatch([matchSeat("甲", 0), matchSeat("乙", 12)], { now: 0, seed: "storm-guarantee", weather: "storm" });
  advanceVersusMatch(match, REGULAR_DURATION_MS);
  const lightning = match.events.filter((entry) => entry.type === "lightning");
  assert.equal(lightning.length, 1);
  assert.ok(match.teams.reduce((sum, team) => sum + team.players.filter((player) => player.active).length, 0) <= 21);
  assert.ok(match.events.every((entry) => entry.type !== "substitution"));
});

test("详细播报记录对抗双方、属性解释并持续更新评分", () => {
  const match = createVersusMatch([matchSeat("甲", 0), matchSeat("乙", 12)], { now: 0, seed: "commentary" });
  advanceVersusMatch(match, 60_000);
  const detailed = match.events.find((entry) => entry.actorId && entry.opponentId && entry.detail);
  assert.ok(detailed);
  const chained = match.events.filter((entry) => entry.chainId);
  assert.ok(chained.length >= 2);
  assert.ok(new Set(chained.map((entry) => entry.chainId)).size < chained.length);
  assert.ok(match.teams.flatMap((team) => team.players).some((player) => player.rating !== 6));
  const view = publicMatch(match, 60_000);
  assert.ok(view.teams.every((team) => team.players.every((player) => Number.isFinite(player.rating) && Number.isFinite(player.fitness))));
});

test("选秀与战术超时会自动补齐阵容并开始比赛", () => {
  let now = 10_000;
  const service = new VersusRoomService({ rng: () => 0.23, now: () => now });
  const host = service.create("甲");
  service.join(host.room.code, "乙");
  now += 120_001;
  let room = service.getRoom(host.room.code);
  assert.equal(room.phase, "tactics");
  assert.ok(room.players.every((seat) => seat.selections.length === 11));
  assert.ok(room.players.every((seat) => seat.selections.some((selection) => REAL_PLAYERS.find((player) => player.id === selection.playerId)?.grade === "S")));
  now += 75_001;
  room = service.getRoom(host.room.code);
  assert.equal(room.phase, "match");
  assert.ok(room.match);
});

test("比赛结束后生成双方完整统计、重要事件与球员评分", () => {
  const match = createVersusMatch([matchSeat("甲", 0), matchSeat("乙", 12)], { now: 0, seed: "report" });
  advanceVersusMatch(match, REGULAR_DURATION_MS);
  if (!match.finished) advanceVersusMatch(match, REGULAR_DURATION_MS + 30_000);
  if (!match.finished) advanceVersusMatch(match, REGULAR_DURATION_MS + EXTRA_DURATION_MS + PENALTY_KICK_INTERVAL_MS * 30);
  if (!match.finished) advanceVersusMatch(match, match.lastAdvancedAt + PENALTY_KICK_INTERVAL_MS * 30);
  assert.ok(match.finished);
  assert.ok(match.report);
  assert.equal(match.report.teams.length, 2);
  assert.ok(match.report.teams.every((team) => team.players.length === 11));
  assert.ok(match.report.events.length > 20);
  assert.ok(match.report.teams.flatMap((team) => team.players).every((player) => player.rating >= 1 && player.rating <= 10));
  const hostView = publicMatch(match, REGULAR_DURATION_MS + 30_000, 0);
  assert.equal(hostView.report.teams[0].tactic, match.report.teams[0].tactic);
  assert.equal(hostView.report.teams[1].tactic, null);
  assert.equal(hostView.report.teams[0].style, match.report.teams[0].style);
  assert.equal(hostView.report.teams[1].style, null);
});

test("点球大战逐球播报且点球不会计入球员进球统计", () => {
  const match = createVersusMatch([matchSeat("甲", 0), matchSeat("乙", 12)], { now: 0, seed: "shootout-detail" });
  match.segment = "extra";
  match.segmentStartedAt = 0;
  match.minute = 120;
  match.lastProcessedMinute = 120;
  match.teams[0].score = 1;
  match.teams[1].score = 1;
  const goalsBefore = match.teams.flatMap((team) => team.players.map((player) => player.matchStats.goals));
  advanceVersusMatch(match, EXTRA_DURATION_MS);
  assert.equal(match.segment, "penalties");
  assert.equal(match.penalties.kicks.length, 0);
  advanceVersusMatch(match, EXTRA_DURATION_MS + PENALTY_KICK_INTERVAL_MS);
  assert.equal(match.penalties.kicks.length, 1);
  assert.equal(match.finished, false);
  advanceVersusMatch(match, EXTRA_DURATION_MS + PENALTY_KICK_INTERVAL_MS * 30);
  assert.equal(match.finished, true);
  assert.ok(match.events.filter((entry) => entry.type === "shootout").length >= match.penalties.kicks.length);
  assert.deepEqual(match.teams.flatMap((team) => team.players.map((player) => player.matchStats.goals)), goalsBefore);
  assert.deepEqual(match.report.score, [1, 1]);
  assert.notDeepEqual(match.report.penalties, [0, 0]);
});

test("双方确认再来一局后保留房间并重新进入选秀", () => {
  let now = 20_000;
  const service = new VersusRoomService({ rng: () => 0.37, now: () => now, accountsPath: null });
  const host = service.create("甲", "REMATCH1");
  const guest = service.join(host.room.code, "乙");
  const internal = service.getRoom(host.room.code);
  internal.players.forEach((seat) => service.autoCompleteDraft(internal, seat));
  service.beginTactics(internal);
  internal.players.forEach((seat) => { seat.ready = true; });
  service.beginMatch(internal, now);
  now += REGULAR_DURATION_MS;
  service.getRoom(host.room.code);
  if (internal.phase !== "report") { now += EXTRA_DURATION_MS; service.getRoom(host.room.code); }
  if (internal.phase !== "report") { now += PENALTY_KICK_INTERVAL_MS * 30; service.getRoom(host.room.code); }
  assert.equal(internal.phase, "report");
  const waiting = service.requestRematch(host.room.code, host.token);
  assert.equal(waiting.phase, "report");
  assert.deepEqual(waiting.rematchReady, [true, false]);
  const restarted = service.requestRematch(host.room.code, guest.token);
  assert.equal(restarted.phase, "draft");
  assert.equal(restarted.code, host.room.code);
  assert.ok(restarted.players.every((seat) => seat.selectionCount === 0));
});

test("锦标赛首回合不进入加时且次回合按总比分决定加时", () => {
  const firstLeg = createVersusMatch([matchSeat("甲", 0), matchSeat("乙", 12)], { now:0, seed:"cup-leg-1", competitionMode:"tournament", legNumber:1, regulationOnly:true });
  firstLeg.halftimeTaken = true;
  firstLeg.lastProcessedMinute = 90;
  firstLeg.teams[0].score = 1;
  firstLeg.teams[1].score = 1;
  advanceVersusMatch(firstLeg, REGULAR_DURATION_MS);
  assert.equal(firstLeg.finished, true);
  assert.equal(firstLeg.segment, "regular");
  assert.equal(firstLeg.report.winnerIndex, null);

  const secondLeg = createVersusMatch([matchSeat("甲", 0), matchSeat("乙", 12)], { now:0, seed:"cup-leg-2", competitionMode:"tournament", legNumber:2, aggregateBaseScore:[1, 0] });
  secondLeg.halftimeTaken = true;
  secondLeg.lastProcessedMinute = 90;
  secondLeg.teams[0].score = 0;
  secondLeg.teams[1].score = 1;
  advanceVersusMatch(secondLeg, REGULAR_DURATION_MS);
  assert.equal(secondLeg.segment, "extra");
  assert.deepEqual(publicMatch(secondLeg, REGULAR_DURATION_MS, 0).aggregateScore, [1, 1]);
  secondLeg.lastProcessedMinute = 120;
  secondLeg.teams[0].score = 1;
  advanceVersusMatch(secondLeg, REGULAR_DURATION_MS + EXTRA_DURATION_MS);
  assert.equal(secondLeg.finished, true);
  assert.deepEqual(secondLeg.report.aggregateScore, [2, 1]);
  assert.equal(secondLeg.report.winnerIndex, 0);
});

test("锦标赛保留首回合阵容并完成5轮传奇保底补强", () => {
  let now = 0;
  const service = new VersusRoomService({ rng:() => 0.23, now:() => now, accountsPath:null });
  const host = service.create("甲", null, null, null, "tournament");
  const guest = service.join(host.room.code, "乙");
  const internal = service.getRoom(host.room.code);
  internal.players.forEach((seat) => service.autoCompleteDraft(internal, seat));
  service.beginTactics(internal, now);
  internal.players.forEach((seat) => { seat.ready = true; });
  service.beginMatch(internal, now);
  assert.equal(internal.match.regulationOnly, true);
  internal.match.halftimeTaken = true;
  internal.match.lastProcessedMinute = 90;
  internal.match.teams[0].score = 1;
  internal.match.teams[1].score = 1;
  now = REGULAR_DURATION_MS;
  service.getRoom(internal.code);
  assert.equal(internal.phase, "report");
  service.requestRematch(internal.code, host.token);
  service.requestRematch(internal.code, guest.token);
  assert.equal(internal.phase, "draft");
  assert.equal(internal.legNumber, 2);
  assert.ok(internal.players.every((seat) => seat.selections.length === 11));
  internal.players.forEach((seat) => service.autoCompleteDraft(internal, seat));
  assert.ok(internal.players.every((seat) => seat.selections.length === 16));
  assert.ok(internal.players.every((seat) => seat.selections.slice(11).some((selection) => REAL_PLAYER_BY_ID[selection.playerId].grade === "S")));
  service.beginTactics(internal, now);
  for (const [index, tokenValue] of [host.token, guest.token].entries()) {
    const seat = internal.players[index];
    service.saveTactics(internal.code, tokenValue, { positions:seat.positions, startingIds:seat.startingIds, tactic:"balanced", style:"possession", attackFocus:"balanced", defenseFocus:"balanced", ready:true });
  }
  assert.equal(internal.phase, "match");
  assert.equal(internal.match.teams[0].players.length, 11);
  assert.deepEqual(internal.match.aggregateBaseScore, [1, 1]);
});
