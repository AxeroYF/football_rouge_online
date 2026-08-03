import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildS4BalanceSeat, createS4BalanceRng, pickS4BalanceArchetype } from "../versus/s4-balance-report.js";

const config = JSON.parse(readFileSync(new URL("../versus/v2/engine-comparison-v2-config.json", import.meta.url), "utf8"));

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
