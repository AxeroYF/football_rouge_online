import assert from "node:assert/strict";
import test from "node:test";
import { V2_PLAYER_ATTRIBUTE_KEYS } from "../versus/public/v2-player-duty-options.js";
import { v2OptimalLineupAssignment, v2RecommendedPlayerDuties } from "../versus/public/v2-tactical-guidance.js";

const playerWithAttributes = (id, role, overrides = {}) => ({
  id,
  role,
  overall:70,
  attributes:{ ...Object.fromEntries(V2_PLAYER_ATTRIBUTE_KEYS.map((key) => [key, 50])), ...overrides },
});

test("自动替换使用全局最优分配而不是逐位置贪心", () => {
  const slots = [{ id:"left" }, { id:"right" }];
  const candidates = [{ id:"versatile" }, { id:"left-only" }, { id:"reserve" }];
  const scores = {
    "left:versatile":100,
    "left:left-only":99,
    "left:reserve":0,
    "right:versatile":98,
    "right:left-only":1,
    "right:reserve":0,
  };
  const result = v2OptimalLineupAssignment(slots, candidates, (player, slot) => scores[`${slot.id}:${player.id}`]);

  assert.deepEqual(result.map((entry) => entry.player.id), ["left-only", "versatile"]);
  assert.equal(result.reduce((sum, entry) => sum + entry.score, 0), 197);
});

test("适配职责按球员能力特点推荐且跳过门将", () => {
  const finisher = playerWithAttributes("finisher", "ST", {
    finishing:98, offBall:97, pace:94, acceleration:95, composure:93, firstTouch:88, decisions:90,
    strength:35, heading:32, jumping:36, passing:42,
  });
  const target = playerWithAttributes("target", "ST", {
    strength:98, heading:97, jumping:96, firstTouch:92, passing:87, decisions:90, composure:91, offBall:88,
    finishing:46, pace:43, acceleration:41,
  });
  const keeper = playerWithAttributes("keeper", "GK", { goalkeeping:99, reflexes:99 });
  const roles = { finisher:"ST", target:"ST", keeper:"GK" };
  const recommendations = v2RecommendedPlayerDuties([finisher, target, keeper], roles, () => 1);

  assert.equal(recommendations.finisher.id, "advancedForward");
  assert.equal(recommendations.target.id, "targetForward");
  assert.equal(recommendations.keeper, undefined);
  assert.ok(recommendations.finisher.score > 80);
  assert.ok(recommendations.target.score > 80);
});
