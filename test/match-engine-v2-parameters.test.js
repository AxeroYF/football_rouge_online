import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveV2MatchParameters,
  validateV2MatchParameters,
  V2_MATCH_PARAMETERS,
  v2ParameterManifest,
} from "../versus/v2/match-parameters-v2.js";

test("V2参数规范独立于原版比赛引擎并通过严格校验", () => {
  assert.deepEqual(validateV2MatchParameters(V2_MATCH_PARAMETERS), { valid:true, errors:[] });
  assert.equal(V2_MATCH_PARAMETERS.status, "parameter-specification");
  assert.equal(Object.isFrozen(V2_MATCH_PARAMETERS), true);
  const source = readFileSync(new URL("../versus/v2/match-parameters-v2.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']\.\.\/match-engine\.js["']/);
});

test("V2全部场景指标使用26项游戏能力且权重归一", () => {
  for (const [metric, weights] of Object.entries(V2_MATCH_PARAMETERS.metrics)) {
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 0.000001, metric);
  }
});

test("V2战术预设完整覆盖连续战术维度", () => {
  const dimensions = Object.keys(V2_MATCH_PARAMETERS.tactics.dimensions).sort();
  for (const [preset, values] of Object.entries(V2_MATCH_PARAMETERS.tactics.mentalityPresets)) {
    assert.deepEqual(Object.keys(values).sort(), dimensions, preset);
  }
  assert.deepEqual(V2_MATCH_PARAMETERS.chain.stages, ["possession", "buildUp", "progression", "finalThird", "chance", "shot"]);
  for (const stage of V2_MATCH_PARAMETERS.chain.stages.slice(1)) {
    assert.ok(V2_MATCH_PARAMETERS.chain.baseProbabilities[stage] > 0);
    assert.ok(Math.abs(Object.values(V2_MATCH_PARAMETERS.chain.factorWeights[stage]).reduce((sum, value) => sum + value, 0) - 1) < 0.000001);
    assert.ok(Object.keys(V2_MATCH_PARAMETERS.tactics.stageProbabilityDimensionWeights[stage]).length > 0);
  }
  assert.ok(V2_MATCH_PARAMETERS.state.leadingShotXgPenaltyPerGoal > 0);
  assert.ok(V2_MATCH_PARAMETERS.state.leadingShotXgMinimumMultiplier < 1);
  assert.equal(Object.hasOwn(V2_MATCH_PARAMETERS.state, "homeAdvantageStageAdjustment"), false);
  assert.equal(V2_MATCH_PARAMETERS.dynamicShape.modelVersion, "dynamic-shape-v2.1-stable.2");
  assert.equal(V2_MATCH_PARAMETERS.dynamicShape.phaseTwo.enabled, true);
  assert.equal(V2_MATCH_PARAMETERS.dynamicShape.phaseTwo.underload.referencePlayers, 11);
});

test("V2参数覆盖只能修改已知路径且返回新的冻结配置", () => {
  const resolved = resolveV2MatchParameters({ state:{ chainAttemptProbabilityPerMinute:0.6 } });
  assert.equal(resolved.state.chainAttemptProbabilityPerMinute, 0.6);
  assert.equal(V2_MATCH_PARAMETERS.state.chainAttemptProbabilityPerMinute, 0.55);
  assert.equal(Object.isFrozen(resolved.state), true);
  assert.throws(() => resolveV2MatchParameters({ state:{ hiddenMomentum:1 } }), /未知V2参数/);
  assert.throws(
    () => resolveV2MatchParameters({ dynamicShape:{ phaseTwo:{ transitionRecovery:{ defendingWidthMultiplier:1.2 } } } }),
    /defendingWidthMultiplier/,
  );
});

test("V2校验拒绝未归一权重、越界战术和重复结果所有权", () => {
  const invalid = structuredClone(V2_MATCH_PARAMETERS);
  invalid.metrics.finishing.finishing = 0.9;
  invalid.tactics.mentalityPresets.balanced.tempo = 150;
  invalid.stacking.effectOwnership.goalProbability = "chance";
  const result = validateV2MatchParameters(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("权重之和")));
  assert.ok(result.errors.some((error) => error.includes("超出范围")));
  assert.ok(result.errors.some((error) => error.includes("独立负责阶段")));
});

test("V2参数清单公开版本、20个空间区域和唯一结果负责人", () => {
  const manifest = v2ParameterManifest();
  assert.equal(manifest.engineVersion, "2.1.0");
  assert.equal(manifest.zoneCount, 20);
  assert.equal(new Set(Object.values(manifest.effectOwnership)).size, Object.keys(manifest.effectOwnership).length);
  assert.equal(V2_MATCH_PARAMETERS.events.injuryPerChain, 0.00015);
  assert.equal(V2_MATCH_PARAMETERS.events.baseFoulProbability, 0.09);
  assert.ok(V2_MATCH_PARAMETERS.environment.weatherStageImpact.snow === undefined);
  assert.equal(V2_MATCH_PARAMETERS.environment.weatherStageImpact.chance, 0.4);
  assert.deepEqual(V2_MATCH_PARAMETERS.environment.weatherEventPerChain, {
    sunny:0.00003,
    rain:0.00015,
    storm:0.0038,
    snow:0.00024,
  });
  const stormWeight = V2_MATCH_PARAMETERS.environment.weatherWeights.storm
    / Object.values(V2_MATCH_PARAMETERS.environment.weatherWeights).reduce((sum, value) => sum + value, 0);
  const allMatchLightningInjuryChance = stormWeight * (1 - ((1 - V2_MATCH_PARAMETERS.environment.weatherEventPerChain.storm) ** 180));
  assert.ok(allMatchLightningInjuryChance >= 0.049 && allMatchLightningInjuryChance <= 0.051);
});
