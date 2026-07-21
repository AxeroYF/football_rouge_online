import test from "node:test";
import assert from "node:assert/strict";
import {
  isPlayerUnavailable,
  normalizePlayerSchema,
  playerAerialAbility,
  playerMentalStrength,
  playerPhysicalQuality,
} from "../game/public/schema.js";
import { settlePlayerAfterMatch } from "../game/public/player-progression.js";
import { formationRolePlan, formationSettings } from "../game/public/core.js";
import { createMatchSession, deriveTeamMetrics } from "../src/model.js";
import { createGeneratedTeam, makePlayer } from "../src/teams.js";

function fixedRng(value = 0.1) {
  return () => value;
}

test("旧球员会补齐精神、隐藏性格、伤病与成长结构", () => {
  const player = normalizePlayerSchema({ id: "legacy-systems", name: "旧球员", role: "ST", attributes: { attack: 70 } });
  assert.ok(Number.isFinite(player.hidden.mentality));
  assert.ok(player.hidden.personality);
  assert.equal(player.state.injury.severity, "none");
  assert.equal(player.state.injury.matchesRemaining, 0);
  assert.equal(player.state.suspension.matchesRemaining, 0);
  assert.ok(player.development.age >= 16);
  assert.ok(player.development.potential >= 40);
});

test("红牌会自动停赛下一场并在该场结算后解除", () => {
  const player = makePlayer("停赛测试", "CB", 68);
  const report = settlePlayerAfterMatch(player, { played: true, won: false, redCards: 1, stage: 5 }, fixedRng());
  assert.equal(report.suspension.matchesRemaining, 1);
  assert.equal(player.state.suspension.receivedAtStage, 5);
  assert.equal(isPlayerUnavailable(player), true);

  const served = settlePlayerAfterMatch(player, { played: false, won: true, stage: 6 }, fixedRng());
  assert.equal(served.suspensionServed, true);
  assert.equal(player.state.suspension.matchesRemaining, 0);
  assert.equal(isPlayerUnavailable(player), false);
});

test("相同头球技术下身高会显著提高制空能力并进入球队制空指标", () => {
  const base = makePlayer("制空测试", "ST", 70, { heightCm: 180, attributes: { heading: 72, jumping: 72, strength: 72 } });
  const short = normalizePlayerSchema({ ...base, id: "short-aerial", heightCm: 165 });
  const tall = normalizePlayerSchema({ ...base, id: "tall-aerial", heightCm: 200 });
  assert.ok(playerAerialAbility(tall) >= playerAerialAbility(short) + 18);

  const away = createGeneratedTeam("制空对手", 70, "balanced");
  const shortTeam = createGeneratedTeam("矮个队", 70, "direct");
  const tallTeam = createGeneratedTeam("高个队", 70, "direct");
  shortTeam.lineup[6] = short;
  tallTeam.lineup[6] = tall;
  const shortSession = createMatchSession(shortTeam, away, { seed: "short-aerial" });
  const tallSession = createMatchSession(tallTeam, away, { seed: "tall-aerial" });
  assert.ok(deriveTeamMetrics(tallSession.home, 20).aerialAttack > deriveTeamMetrics(shortSession.home, 20).aerialAttack + 4);
});

test("高精神力球队在比赛末段落后时拥有更强的逆境响应", () => {
  const away = createGeneratedTeam("精神对手", 70, "balanced");
  const low = createGeneratedTeam("低精神", 70, "balanced");
  const high = createGeneratedTeam("高精神", 70, "balanced");
  for (const player of low.lineup) Object.assign(player.hidden, { mentality: 30, pressure: 30, consistency: 35, leadership: 25, personality: "volatile" });
  for (const player of high.lineup) Object.assign(player.hidden, { mentality: 90, pressure: 90, consistency: 88, leadership: 78, personality: "resilient" });
  const lowSession = createMatchSession(low, away, { seed: "low-mental" });
  const highSession = createMatchSession(high, away, { seed: "high-mental" });
  lowSession.away.stats.goals = 1;
  highSession.away.stats.goals = 1;
  const lowMetrics = deriveTeamMetrics(lowSession.home, 84);
  const highMetrics = deriveTeamMetrics(highSession.home, 84);
  assert.ok(highMetrics.mentalStrength > lowMetrics.mentalStrength + 25);
  assert.ok(highMetrics.mentalResponse > lowMetrics.mentalResponse + 4);
});

test("共享比赛模型会把激进阵型转化为更强创造和更弱转换防守", () => {
  const opponent = createGeneratedTeam("阵型对手", 70, "balanced");
  const base = createGeneratedTeam("阵型测试", 70, "balanced");
  const aggressive = structuredClone(base);
  const balanced = structuredClone(base);
  const shape = (key) => formationSettings(formationRolePlan(key).map((role, index) => ({ id: `${key}-${index}`, role, assignedRole: role })), key);
  aggressive.formation = shape("114");
  balanced.formation = shape("222");
  const aggressiveMetrics = deriveTeamMetrics(createMatchSession(aggressive, opponent, { seed: "shape-aggressive" }).home, 30);
  const balancedMetrics = deriveTeamMetrics(createMatchSession(balanced, opponent, { seed: "shape-balanced" }).home, 30);
  assert.ok(aggressiveMetrics.chanceCreation > balancedMetrics.chanceCreation + 2);
  assert.ok(aggressiveMetrics.finishing > balancedMetrics.finishing + 1);
  assert.ok(aggressiveMetrics.transitionDefense < balancedMetrics.transitionDefense - 3);
});

test("球员体力与状态会真实改变比赛攻防指标", () => {
  const opponent = createGeneratedTeam("状态对手", 70, "balanced");
  const fresh = createGeneratedTeam("高状态队", 70, "balanced");
  const drained = structuredClone(fresh);
  fresh.morale = 82;
  drained.morale = 28;
  for (const player of fresh.lineup) Object.assign(player.state, { fitness: 100, morale: 82, form: 62 });
  for (const player of drained.lineup) Object.assign(player.state, { fitness: 42, morale: 28, form: 38 });
  const freshMetrics = deriveTeamMetrics(createMatchSession(fresh, opponent, { seed: "fresh-condition" }).home, 35);
  const drainedMetrics = deriveTeamMetrics(createMatchSession(drained, opponent, { seed: "drained-condition" }).home, 35);
  assert.ok(freshMetrics.chanceCreation > drainedMetrics.chanceCreation + 10);
  assert.ok(freshMetrics.finishing > drainedMetrics.finishing + 10);
  assert.ok(freshMetrics.transitionDefense > drainedMetrics.transitionDefense + 10);
});

test("身体素质由力量耐力速度等共同决定", () => {
  const weak = makePlayer("身体弱", "DM", 55, { attributes: { strength: 30, stamina: 35, pace: 35, acceleration: 35, agility: 35, jumping: 30, workRate: 35 } });
  const strong = makePlayer("身体强", "DM", 55, { attributes: { strength: 88, stamina: 88, pace: 82, acceleration: 82, agility: 78, jumping: 86, workRate: 90 } });
  assert.ok(playerPhysicalQuality(strong) > playerPhysicalQuality(weak) + 40);
});

test("所有正式伤情都会跨场伤停，休战后按剩余场次恢复", () => {
  const player = makePlayer("恢复测试", "CB", 68, { state: { injury: { severity: "moderate", matchesRemaining: 2, totalMatches: 2 } } });
  player.hidden.personality = "resilient";
  assert.equal(isPlayerUnavailable(player), true);
  settlePlayerAfterMatch(player, { played: false, won: true, stage: 2 }, fixedRng());
  assert.equal(player.state.injury.matchesRemaining, 1);
  settlePlayerAfterMatch(player, { played: false, won: true, stage: 3 }, fixedRng());
  assert.equal(player.state.injury.severity, "none");
  assert.equal(isPlayerUnavailable(player), false);

  const emergency = makePlayer("无替补测试", "ST", 68);
  const report = settlePlayerAfterMatch(emergency, { played: true, won: false, stage: 1, allowUnavailable: false, newInjury: { severity: "severe", matchesOut: 6 } }, fixedRng());
  assert.equal(report.injury.severity, "severe");
  assert.equal(report.injury.matchesRemaining, 6);
  assert.equal(isPlayerUnavailable(emergency), true);

  const lightningVictim = makePlayer("雷击测试", "AM", 68);
  const lightningReport = settlePlayerAfterMatch(lightningVictim, { played: true, won: false, stage: 4, allowUnavailable: false, newInjury: { severity: "severe", matchesOut: 5, cause: "lightning", forceUnavailable: true } }, fixedRng());
  assert.equal(lightningReport.injury.severity, "severe");
  assert.equal(lightningReport.injury.matchesRemaining, 5);
  assert.equal(lightningVictim.state.injury.cause, "lightning");
  assert.equal(isPlayerUnavailable(lightningVictim), true);
});

test("生涯终结伤病会永久标记退役且不可再出场", () => {
  const player = makePlayer("退役测试", "CB", 68);
  const report = settlePlayerAfterMatch(player, {
    played: true,
    won: false,
    stage: 8,
    newInjury: { severity: "careerEnding", retired: true, cause: "foul" },
  }, fixedRng());
  assert.equal(report.retired, true);
  assert.equal(report.injury.severity, "careerEnding");
  assert.equal(player.state.retired, true);
  assert.equal(isPlayerUnavailable(player), true);
});

test("胜负会动态改变状态，职业性格和潜力会推动成长", () => {
  const winner = makePlayer("胜者", "ST", 62);
  const loser = normalizePlayerSchema({ ...winner, id: "loser", name: "败者" });
  Object.assign(winner.hidden, { personality: "professional", professionalism: 92, volatility: 20 });
  Object.assign(loser.hidden, { personality: "volatile", professionalism: 45, volatility: 90 });
  winner.development.potential = 92;
  winner.development.experience = 114;
  const beforeAttributes = Object.values(winner.attributes).reduce((sum, value) => sum + value, 0);
  const winnerBeforeMorale = winner.state.morale;
  const loserBeforeMorale = loser.state.morale;
  const growth = settlePlayerAfterMatch(winner, { played: true, won: true, goals: 1, stage: 4 }, fixedRng()).growth;
  settlePlayerAfterMatch(loser, { played: true, won: false, redCards: 1, stage: 4 }, fixedRng());
  const afterAttributes = Object.values(winner.attributes).reduce((sum, value) => sum + value, 0);
  assert.ok(winner.state.morale > winnerBeforeMorale);
  assert.ok(loser.state.morale < loserBeforeMorale);
  assert.ok(growth.levelUps >= 1);
  assert.ok(afterAttributes > beforeAttributes);
  assert.ok(playerMentalStrength(winner) > 0);
});
