import test from "node:test";
import assert from "node:assert/strict";
import { simulateMatch, simulateMany } from "../src/model.js";
import { createGeneratedTeam, makeExampleTeams } from "../src/teams.js";

test("开发模拟核心使用七人首发与四人替补", () => {
  const team = createGeneratedTeam("七人测试队", 70, "balanced");
  assert.equal(team.lineup.length, 7);
  assert.equal(team.bench.length, 4);
  assert.equal(team.formation.name, "2-3-1");
});

test("相同随机种子产生完全相同的比赛", () => {
  const { home, away } = makeExampleTeams();
  const first = simulateMatch(home, away, { seed: "repeatable" });
  const second = simulateMatch(home, away, { seed: "repeatable" });
  assert.deepEqual(first, second);
});

test("雷暴雷击会造成固定五场重伤，其他天气不会触发", () => {
  const { home, away } = makeExampleTeams();
  const storm = simulateMatch(home, away, {
    seed: "forced-lightning",
    context: { weather: { type: "storm", lightningChance: 1, lightningFitnessLossMin: 20, lightningFitnessLossMax: 20, lightningMoraleLossMin: 9, lightningMoraleLossMax: 9 } },
  });
  const sunny = simulateMatch(home, away, {
    seed: "forced-lightning",
    context: { weather: { type: "sunny", lightningChance: 1 } },
  });
  assert.ok(storm.events.some((event) => event.type === "lightning" && event.fitnessLoss === 20 && event.moraleLoss === 9 && event.severity === "severe" && event.matchesOut === 5 && event.forceUnavailable));
  assert.equal(sunny.events.some((event) => event.type === "lightning"), false);
  assert.ok(storm.stats.home.lightningHits + storm.stats.away.lightningHits > 0);
  assert.ok(storm.stats.home.injuries + storm.stats.away.injuries > 0);
});

test("明显更强的球队在大样本中占优", () => {
  const strong = createGeneratedTeam("强队", 82, "balanced");
  const weak = createGeneratedTeam("弱队", 62, "balanced");
  const result = simulateMany(strong, weak, { matches: 1800, seed: "strength" });
  assert.ok(result.probabilities.homeWin > 0.68, JSON.stringify(result));
  assert.ok(result.averages.homeGoals > result.averages.awayGoals + 0.65, JSON.stringify(result));
});

test("主场优势能提高相同球队的主队进球和胜率", () => {
  const home = createGeneratedTeam("主队", 72, "balanced");
  const away = createGeneratedTeam("客队", 72, "balanced");
  const withHomeAdvantage = simulateMany(home, away, {
    matches: 1600,
    seed: "home-advantage",
    context: { homeAdvantage: 3.2 },
  });
  const neutral = simulateMany(home, away, {
    matches: 1600,
    seed: "home-advantage",
    context: { homeAdvantage: 0 },
  });
  assert.ok(withHomeAdvantage.averages.homeGoals > neutral.averages.homeGoals);
  assert.ok(withHomeAdvantage.probabilities.homeWin > neutral.probabilities.homeWin);
});

test("默认比赛分布保持在足球比分的合理量级", () => {
  const { home, away } = makeExampleTeams();
  const result = simulateMany(home, away, { matches: 2200, seed: "sanity" });
  assert.ok(result.averages.totalGoals > 2.0, JSON.stringify(result));
  assert.ok(result.averages.totalGoals < 3.4, JSON.stringify(result));
  assert.ok(result.probabilities.draw > 0.18, JSON.stringify(result));
  assert.ok(result.probabilities.draw < 0.34, JSON.stringify(result));
  assert.ok(result.averages.homeShots > 7, JSON.stringify(result));
  assert.ok(result.averages.homeShots < 17, JSON.stringify(result));
});
