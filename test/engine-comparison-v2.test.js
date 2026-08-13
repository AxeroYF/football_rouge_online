import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildS4BalanceSeat, createS4BalanceRng, pickS4BalanceArchetype } from "../versus/s4-balance-report.js";
import { evaluateV2RealismBenchmarks } from "../versus/v2/engine-comparison-v2.js";
import { expandV2ScenarioMatrix } from "../versus/v2/engine-comparison-v2-scenario-matrix.js";

const config = JSON.parse(readFileSync(new URL("../versus/v2/engine-comparison-v2-config.json", import.meta.url), "utf8"));
const fullRealismConfig = JSON.parse(readFileSync(new URL("../versus/v2/engine-comparison-v2.1-full-realism-baseline.json", import.meta.url), "utf8"));
const fullBalanceConfig = JSON.parse(readFileSync(new URL("../versus/v2/v2.1-full-balance-simulation.json", import.meta.url), "utf8"));

test("V1/V2全量对照配置使用固定种子和同尺度控球链", () => {
  assert.equal(config.matches, 30000);
  assert.equal(config.v2PossessionChainsPerMatch, 180);
  assert.equal(config.rawMatchSampleLimit, 500);
  assert.equal(config.shardMatches, 100);
  assert.equal(config.maximumWorkers, 10);
  assert.equal(config.progressIntervalMatches, 1);
  assert.match(config.outputVersion, /alpha4-10core-progress/);
  assert.deepEqual(config.v2ShotXgBucketUpperBounds, [0.01, 0.03, 0.05, 0.08, 0.15, 0.3, 0.6]);
  assert.ok(config.maximumWorkers <= 10);
  assert.equal(Object.values(config.ecosystemWeights).reduce((sum, value) => sum + value, 0), 100);
});

test("对照模拟复用现有S4确定性阵容构造器", () => {
  const seed = `${config.seed}:paired:42`;
  const firstRng = createS4BalanceRng(seed);
  const secondRng = createS4BalanceRng(seed);
  const firstArchetype = pickS4BalanceArchetype(firstRng, config.ecosystemWeights);
  const secondArchetype = pickS4BalanceArchetype(secondRng, config.ecosystemWeights);
  assert.equal(firstArchetype, secondArchetype);
  assert.deepEqual(
    buildS4BalanceSeat(seed, "home", firstArchetype, { staticPlans:true }),
    buildS4BalanceSeat(seed, "home", secondArchetype, { staticPlans:true }),
  );
});

test("V2.1 full matrix carries a versioned realism contract", () => {
  assert.equal(fullRealismConfig.engineVersion, "V2.1");
  assert.equal(fullRealismConfig.v2Only, true);
  assert.equal(fullRealismConfig.v2PossessionChainsPerMatch, 180);
  assert.match(fullRealismConfig.outputVersion, /V2\.1-realism-baseline-r3-20260809/);
  assert.equal(fullRealismConfig.realismBenchmarks.version, "v2.1-realism-v3-neutral-venue");
  assert.equal(fullRealismConfig.realismBenchmarks.minimumMatches, 10000);
  assert.ok(Object.keys(fullRealismConfig.realismBenchmarks.metrics).length >= 35);
  assert.equal(fullRealismConfig.realismBenchmarks.metrics.chainGoalsPerMatch.critical, true);
  assert.equal(fullRealismConfig.realismBenchmarks.metrics["possessionDistribution.averageAbsoluteDifferencePercent"].critical, true);
  assert.equal(fullRealismConfig.realismBenchmarks.metrics["matchDistribution.sideWinRateGapPercent"].critical, true);
  assert.equal(fullRealismConfig.realismBenchmarks.comparisons.length, 5);
  assert.equal(fullRealismConfig.scenarioMatrix.archetypePairing, "independentWeighted");
  assert.equal(fullRealismConfig.scenarioMatrix.environmentSampling, "weighted");
  assert.equal(fullRealismConfig.scenarioMatrix.environmentRotation, undefined);
  assert.equal(expandV2ScenarioMatrix(fullRealismConfig.scenarioMatrix).length, 385);
  assert.equal(expandV2ScenarioMatrix(fullRealismConfig.scenarioMatrix).length * fullRealismConfig.scenarioMatrix.repetitionsPerScenario, 10010);
});

test("V2.1全量平衡配置覆盖战术、职责与羁绊并限制结果分片大小", () => {
  const scenarios = expandV2ScenarioMatrix(fullBalanceConfig.scenarioMatrix);
  assert.equal(scenarios.length, 561);
  assert.equal(scenarios.length * fullBalanceConfig.scenarioMatrix.repetitionsPerScenario, 22440);
  assert.equal(fullBalanceConfig.studyDesign.expectedMatches, 22440);
  assert.equal(fullBalanceConfig.scenarioMatrix.repetitionsPerScenario % 2, 0);
  assert.deepEqual(fullBalanceConfig.studyDesign.expectedDurationHours, { minimum:6, maximum:8, baselineEstimate:6.9, calibratedFromPreviousHours:11 });
  assert.ok(fullBalanceConfig.studyDesign.focusMetrics.includes("yellowCards"));
  assert.ok(fullBalanceConfig.studyDesign.focusMetrics.includes("foulInjuriesCaused"));
  assert.ok(fullBalanceConfig.realismBenchmarks.metrics["injuries.injuriesPerMatch"]);
  assert.equal(fullBalanceConfig.outputLimits.separateDimensions, true);
  assert.ok(fullBalanceConfig.outputLimits.coreBytes <= 4_000_000);
  for (const dimension of ["formation", "tactic", "style", "playerDutyMode", "activeBondType", "tempoBand", "outLineStrategy"]) {
    assert.ok(fullBalanceConfig.analysisDimensions.includes(dimension), dimension);
  }
  assert.equal(fullBalanceConfig.scenarioMatrix.profiles["duties-recommended"].playerDutyMode, "recommended");
  assert.equal(fullBalanceConfig.scenarioMatrix.profiles["bonds-disabled"].bondMode, "disabled");
});

test("realism evaluator reports sample sufficiency, weighted verdict, and critical failures", () => {
  const benchmark = {
    version:"test-v1",
    minimumMatches:100,
    minimumPassRatePercent:75,
    metrics:{
      chainGoalsPerMatch:{ minimum:2.4, maximum:3.2, critical:true, weight:3 },
      cornersPerMatch:{ minimum:8, maximum:13, weight:1 },
    },
  };
  const pass = evaluateV2RealismBenchmarks({ matches:100, chainGoalsPerMatch:2.8, cornersPerMatch:10 }, benchmark);
  assert.equal(pass.verdict, "pass");
  assert.equal(pass.overallPassRatePercent, 100);
  assert.equal(pass.sampleRequirement.met, true);

  const review = evaluateV2RealismBenchmarks({ matches:50, chainGoalsPerMatch:4.1, cornersPerMatch:10 }, benchmark);
  assert.equal(review.verdict, "review");
  assert.deepEqual(review.criticalFailures, ["chainGoalsPerMatch"]);
  assert.equal(review.sampleRequirement.met, false);
  assert.equal(review.overallPassRatePercent, 25);
});

test("realism evaluator checks directional differences between tactical groups", () => {
  const result = evaluateV2RealismBenchmarks({
    matches:100,
    dimensions:{ style:{ possession:{ v2:{ possessionSharePercent:55 } }, counterAttack:{ v2:{ possessionSharePercent:46 } } } },
  }, {
    minimumMatches:100,
    comparisons:[{
      id:"possession-gap",
      leftPath:"dimensions.style.possession.v2.possessionSharePercent",
      rightPath:"dimensions.style.counterAttack.v2.possessionSharePercent",
      minimumDifference:3,
      maximumDifference:15,
      critical:true,
    }],
  });
  assert.equal(result.verdict, "pass");
  assert.equal(result.comparisons[0].difference, 9);
  assert.equal(result.comparisons[0].status, "pass");
});
