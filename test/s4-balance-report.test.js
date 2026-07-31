import test from "node:test";
import assert from "node:assert/strict";
import { runS4BalanceReport, splitS4BalanceReportOutput, taskDifficulty, taskDifficultyByRole } from "../versus/s4-balance-report.js";

const CONFIG = {
  outputVersion:"test",
  seed:"s4-balance-report-test",
  matches:8,
  rawMatchSampleLimit:2,
  experiments:{ xTaskMatchesPerRole:0, formationMatchesPerCell:0, tacticMatchesPerCell:0, styleMatchesPerCell:0, tacticalCombinationMatchesPerCell:0, upgradeMatchesPerCell:0, traitMatchesPerCell:0, legendMatchesPerCell:0, dynamicPlanMatches:0, weatherStyleMatchesPerCell:0, refereeStyleMatchesPerCell:0 },
  taskThresholds:{ appearances:[1,3], goals:[1], assists:[1], tackles:[5], saves:[5] },
  taskThresholdsByRole:{
    GK:{ appearances:[1,3], saves:[5] },
    DEF:{ appearances:[1,3], tackles:[5] },
    MID:{ appearances:[1,3], assists:[1] },
    ATT:{ appearances:[1,3], goals:[1] },
  },
  ecosystemWeights:{ standard:1, enhanced:1, traitHeavy:1, legendHeavy:1, xLed:3 },
};

test("S4平衡报告固定种子可复现并包含X任务难度口径", async () => {
  const phases = [];
  const first = await runS4BalanceReport(CONFIG, { progress:(phase) => phases.push(phase) });
  const second = await runS4BalanceReport(CONFIG);

  assert.deepEqual(second, first);
  assert.equal(first.results.matches, CONFIG.matches);
  assert.ok(Number.isFinite(first.results.overallRhythm.dynamicPositionAdjustmentMatchRatePercent));
  assert.deepEqual(Object.keys(first.results.xTaskDifficulty), ["appearances", "goals", "assists", "tackles", "saves"]);
  assert.deepEqual(Object.keys(first.results.xTaskDifficultyByRole), ["GK", "DEF", "MID", "ATT"]);
  assert.ok(first.results.lineupPositionIntegrity.outOfRoleGroupRatePercent >= 0);
  assert.equal(first.config.totalMatches, CONFIG.matches);
  assert.equal(phases.length, first.config.totalMatches);
  assert.ok(phases.every((phase) => phase === "生态样本"));
  assert.ok(first.experiments.upgradeMatrix[0][8]);
  assert.equal(first.experiments.tacticalCombinationStudy["4-3-3"].balanced.possession.matches, 0);
  assert.match(first.simulationScope.interceptionMetricNote, /tackles/);
  assert.ok(first.rawMatchSamples.every((match) => match.seed.startsWith(`${CONFIG.seed}:ecosystem:`)));
  assert.ok(first.rawMatchSamples.flatMap((match) => match.teams).flatMap((team) => team.players)
    .every((player) => ["primary", "secondary", "sameGroup", "outOfGroup"].includes(player.startingPositionFit)));
});

test("S4按位置任务难度只统计该位置实际适用的任务", () => {
  const result = taskDifficultyByRole({
    GK:[{ appearances:1, saves:2 }],
    DEF:[{ appearances:1, tackles:1 }],
    MID:[{ appearances:1, assists:0 }],
    ATT:[{ appearances:1, goals:1 }],
  }, CONFIG.taskThresholdsByRole);

  assert.deepEqual(Object.keys(result.GK), ["appearances", "saves"]);
  assert.deepEqual(Object.keys(result.ATT), ["appearances", "goals"]);
  assert.equal(result.GK.saves.milestoneEstimatedAppearances[5], 2.5);
  assert.equal(result.ATT.goals.milestoneEstimatedAppearances[1], 1);
});

test("传奇阵容按主位置、次位置或同位置组分配首发槽位", async () => {
  const report = await runS4BalanceReport({
    ...CONFIG,
    seed:"s4-legend-position-fit-test",
    matches:4,
    rawMatchSampleLimit:4,
    ecosystemWeights:{ legendHeavy:1 },
  });
  const legends = report.rawMatchSamples
    .flatMap((match) => match.teams)
    .flatMap((team) => team.players)
    .filter((player) => player.grade === "S");

  assert.ok(legends.length >= 32);
  assert.ok(legends.every((player) => player.startingPositionFit !== "outOfGroup"));
});

test("S4任务难度汇总支持超过调用参数上限的大样本", () => {
  const samples = Array.from({ length:200000 }, (_, index) => ({ appearances:1, goals:index === 199999 ? 7 : 0 }));
  const result = taskDifficulty({ GK:[], DEF:[], MID:[], ATT:samples }, { appearances:[1], goals:[1] });

  assert.equal(result.appearances.playerMatchSamples, samples.length);
  assert.equal(result.appearances.perAppearanceDistribution.maximum, 1);
  assert.equal(result.goals.perAppearanceDistribution.maximum, 7);
});
test("S4核心结果与逐场明细分开落盘且保留全部统计场次", () => {
  const rawMatchSamples = Array.from({ length:1000 }, (_, index) => ({ index, detail:"x".repeat(1000) }));
  const report = { schemaVersion:"test", outputVersion:"full", seed:"seed", simulationScope:{ matches:228600 }, results:{ matches:30000 }, experiments:{ formationMatrix:{ preserved:true } }, rawMatchSamples };
  const output = splitS4BalanceReportOutput(report, "raw-samples.json");

  assert.equal(output.mainReport.rawMatchSamples.length, 0);
  assert.equal(output.mainReport.outputProtection.statisticalMatchesPreserved, 228600);
  assert.equal(output.mainReport.outputProtection.rawMatchSampleCount, 1000);
  assert.equal(output.mainReport.experiments.formationMatrix.preserved, true);
  assert.equal(output.rawReport.rawMatchSamples.length, 1000);
  assert.equal(output.rawReport.statisticalMatches, 228600);
});

test("nationalityHeavy生态会实际触发国家队羁绊", async () => {
  const report = await runS4BalanceReport({
    ...CONFIG,
    seed:"s4-nationality-bond-activation-test",
    matches:6,
    rawMatchSampleLimit:0,
    ecosystemWeights:{ nationalityHeavy:1 },
  });

  assert.ok(report.results.ecosystemComposition.activeBondCounts.nationality > 0);
});
