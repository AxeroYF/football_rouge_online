import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTRIBUTE_NAMES,
  POSITION_ORDER,
  SEVEN_A_SIDE,
  inferBoardRoles,
  normalizePlayerSchema,
  roleGroup,
} from "../game/public/schema.js";
import {
  advanceMatchSession,
  createMatchSession,
  foulCardProbabilities,
  inflictMatchSessionInjury,
  matchSessionSnapshot,
  resolveMatchSessionInjuryShortHanded,
  simulateMatch,
  substituteMatchSessionPlayer,
  updateMatchSessionTactics,
} from "../src/model.js";
import { createGeneratedTeam } from "../src/teams.js";
import { createDefaultDatabase } from "../devtool/default-data.js";

test("v0.2共享规范固定为七人制而不是十一人制", () => {
  assert.deepEqual(SEVEN_A_SIDE, { starters: 7, outfielders: 6, benchLimit: 4, substitutionLimit: 3 });
  const team = createGeneratedTeam("七人制验证队", 70, "balanced");
  assert.equal(team.lineup.length, 7);
  assert.equal(team.bench.length, 4);
  assert.deepEqual(new Set(team.lineup.map((player) => roleGroup(player.role))), new Set(["GK", "DEF", "MID", "ATT"]));
  assert.ok(team.lineup.every((player) => POSITION_ORDER.includes(player.role)));
});

test("旧位置和旧精简能力会迁移为统一十一位置与26项能力", () => {
  const migrated = normalizePlayerSchema({
    id: "legacy-player",
    name: "旧版中场",
    role: "CM",
    secondaryRole: "AM",
    preferredFoot: "left",
    attributes: { attack: 68, passing: 77, defense: 61, pace: 70, stamina: 74, composure: 72, aggression: 58, goalkeeping: 12, height: 179, fitness: 84 },
  });
  assert.equal(migrated.role, "DM");
  assert.equal(migrated.secondaryRole, "AM");
  assert.equal(migrated.heightCm, 179);
  assert.equal(migrated.state.fitness, 84);
  assert.deepEqual(Object.keys(migrated.attributes).sort(), [...ATTRIBUTE_NAMES].sort());
});

test("自由战术板按横向和中场纵深识别十一种细分位置", () => {
  assert.equal(POSITION_ORDER.length, 11);
  const roles = inferBoardRoles([
    { id: "gk", position: { x: 50, y: 90 } },
    { id: "lb", position: { x: 20, y: 70 } },
    { id: "cb", position: { x: 50, y: 70 } },
    { id: "rm", position: { x: 80, y: 46 } },
    { id: "am", position: { x: 50, y: 38 } },
    { id: "st", position: { x: 50, y: 18 } },
    { id: "rw", position: { x: 80, y: 18 } },
  ]);
  assert.deepEqual(roles, { gk: "GK", lb: "LB", cb: "CB", rm: "RM", am: "AM", st: "ST", rw: "RW" });
  const holding = inferBoardRoles([
    { id: "lm", position: { x: 20, y: 46 } },
    { id: "dm", position: { x: 50, y: 54 } },
  ]);
  assert.equal(holding.dm, "DM");
});

test("共享比赛会话逐分钟推进与整场模拟结果一致", () => {
  const home = createGeneratedTeam("主队", 72, "possession");
  const away = createGeneratedTeam("客队", 71, "direct");
  const full = simulateMatch(home, away, { seed: "v02-incremental" });
  const session = createMatchSession(home, away, { seed: "v02-incremental" });
  advanceMatchSession(session, 45);
  const halftime = matchSessionSnapshot(session);
  assert.equal(halftime.lineups.home.length, 7);
  advanceMatchSession(session, Number.POSITIVE_INFINITY);
  const final = matchSessionSnapshot(session);
  assert.deepEqual(final.score, full.score);
  assert.deepEqual(final.stats, full.stats);
});

test("共享比赛会话支持玩家手动换人与实时战术更新", () => {
  const home = createGeneratedTeam("玩家队", 72, "balanced");
  const away = createGeneratedTeam("对手队", 71, "direct");
  const session = createMatchSession(home, away, { seed: "v02-manual", autoSubstitutions: { home: false, away: true } });
  advanceMatchSession(session, 30);
  const outgoing = session.home.lineup[1];
  const incoming = session.home.bench[1];
  const event = substituteMatchSessionPlayer(session, "home", outgoing.id, incoming.id, 30);
  assert.equal(event.playerOutId, outgoing.id);
  assert.equal(event.playerInId, incoming.id);
  updateMatchSessionTactics(session, "home", { pressing: 82, tempo: 74 });
  advanceMatchSession(session, Number.POSITIVE_INFINITY);
  const final = matchSessionSnapshot(session);
  assert.equal(final.stats.home.substitutions, 1);
  assert.ok(final.lineups.home.some((player) => player.id === incoming.id));
});

test("比赛内受伤会冻结玩家队会话，且只能换下伤员", () => {
  const home = createGeneratedTeam("伤病玩家队", 72, "balanced");
  const away = createGeneratedTeam("伤病对手队", 71, "direct");
  const session = createMatchSession(home, away, { seed: "forced-injury", autoSubstitutions: { home: false, away: true } });
  const injured = session.home.lineup[2];
  const wrongOutgoing = session.home.lineup[3];
  const incoming = session.home.bench[0];
  inflictMatchSessionInjury(session, "home", injured.id, { severity: "moderate", matchesOut: 4, minute: 24, causedByFoul: true });
  const pausedAt = session.possessionIndex;
  assert.equal(matchSessionSnapshot(session).pendingInjury.playerId, injured.id);
  assert.deepEqual(advanceMatchSession(session, 80), []);
  assert.equal(session.possessionIndex, pausedAt);
  assert.equal(substituteMatchSessionPlayer(session, "home", wrongOutgoing.id, incoming.id, 24), null);
  const event = substituteMatchSessionPlayer(session, "home", injured.id, incoming.id, 24);
  assert.equal(event.reason, "injury");
  const snapshot = matchSessionSnapshot(session);
  assert.equal(snapshot.pendingInjury, null);
  assert.ok(snapshot.discipline.injuredOut.home.includes(injured.id));
  assert.ok(snapshot.lineups.home.some((player) => player.id === incoming.id));
  assert.ok(!snapshot.benches.home.some((player) => player.id === injured.id));
});

test("无替补时受伤球员离场并以少一人状态继续", () => {
  const home = createGeneratedTeam("少人玩家队", 70, "balanced");
  const away = createGeneratedTeam("少人对手队", 70, "balanced");
  home.bench = [];
  const session = createMatchSession(home, away, { seed: "short-handed-injury", autoSubstitutions: { home: false, away: true } });
  const injured = session.home.lineup[4];
  inflictMatchSessionInjury(session, "home", injured.id, { severity: "minor", matchesOut: 2, minute: 31 });
  assert.equal(resolveMatchSessionInjuryShortHanded(session, "home", injured.id), true);
  const snapshot = matchSessionSnapshot(session);
  assert.equal(snapshot.pendingInjury, null);
  assert.ok(snapshot.discipline.injuredOut.home.includes(injured.id));
});

test("踢伤对手会显著提高犯规球员吃牌与直红概率", () => {
  const team = createGeneratedTeam("判罚测试队", 70, "aggressive");
  const session = createMatchSession(team, createGeneratedTeam("判罚对手", 70, "balanced"), { seed: "injury-card" });
  const offender = session.home.lineup[1];
  const context = session.context;
  const ordinary = foulCardProbabilities(offender, session.home, context, null);
  const severe = foulCardProbabilities(offender, session.home, context, { severity: "severe" });
  assert.ok(severe.card >= ordinary.card + 0.35);
  assert.ok(severe.directRed >= ordinary.directRed + 0.14);
});

test("开发者后台默认数据与玩家侧共用七人制位置和能力字典", () => {
  const state = createDefaultDatabase();
  assert.equal(state.meta.schemaVersion, 11);
  assert.ok(state.teams.every((team) => team.lineupIds.length === SEVEN_A_SIDE.starters && team.benchIds.length <= SEVEN_A_SIDE.benchLimit));
  assert.ok(state.players.every((player) => POSITION_ORDER.includes(player.role)));
  assert.ok(state.players.every((player) => ATTRIBUTE_NAMES.every((attribute) => Number.isFinite(player.attributes[attribute]))));
  assert.ok(state.players.every((player) => player.hidden?.personality && player.development?.potential && player.state?.injury));
  assert.deepEqual(state.globalConfig.weatherWeights, { sunny: 60, rain: 15, storm: 15, snow: 10 });
});
