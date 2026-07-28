import test from "node:test";
import assert from "node:assert/strict";
import { runS4BalanceReport, taskDifficulty } from "../versus/s4-balance-report.js";

const CONFIG = {
  outputVersion:"test",
  seed:"s4-balance-report-test",
  matches:8,
  rawMatchSampleLimit:2,
  experiments:{ xTaskMatchesPerRole:0, formationMatchesPerCell:0, tacticMatchesPerCell:0, styleMatchesPerCell:0, upgradeMatchesPerCell:0, traitMatchesPerCell:0, legendMatchesPerCell:0, dynamicPlanMatches:0, weatherStyleMatchesPerCell:0, refereeStyleMatchesPerCell:0 },
  taskThresholds:{ appearances:[1,3], goals:[1], penaltiesWon:[1], assists:[1], tackles:[5], yellowCards:[1], saves:[5] },
  ecosystemWeights:{ standard:1, enhanced:1, traitHeavy:1, legendHeavy:1, xLed:3 },
};

test("S4平衡报告固定种子可复现并包含X任务难度口径", async () => {
  const phases = [];
  const first = await runS4BalanceReport(CONFIG, { progress:(phase) => phases.push(phase) });
  const second = await runS4BalanceReport(CONFIG);

  assert.deepEqual(second, first);
  assert.equal(first.results.matches, CONFIG.matches);
  assert.deepEqual(Object.keys(first.results.xTaskDifficulty), ["appearances", "goals", "penaltiesWon", "assists", "tackles", "yellowCards", "saves"]);
  assert.equal(first.config.totalMatches, CONFIG.matches);
  assert.equal(phases.length, first.config.totalMatches);
  assert.ok(phases.every((phase) => phase === "生态样本"));
  assert.ok(first.experiments.upgradeMatrix[0][8]);
  assert.match(first.simulationScope.interceptionMetricNote, /tackles/);
  assert.ok(first.rawMatchSamples.every((match) => match.seed.startsWith(`${CONFIG.seed}:ecosystem:`)));
});

test("S4任务难度汇总支持超过调用参数上限的大样本", () => {
  const samples = Array.from({ length:200000 }, (_, index) => ({ appearances:1, goals:index === 199999 ? 7 : 0 }));
  const result = taskDifficulty({ GK:[], DEF:[], MID:[], ATT:samples }, { appearances:[1], goals:[1] });

  assert.equal(result.appearances.playerMatchSamples, samples.length);
  assert.equal(result.appearances.perAppearanceDistribution.maximum, 1);
  assert.equal(result.goals.perAppearanceDistribution.maximum, 7);
});
