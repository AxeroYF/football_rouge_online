import test from "node:test";
import assert from "node:assert/strict";
import { NEW_TRAIT_BATCH } from "../src/new-trait-batch.js";
import { simulateMatch } from "../src/model.js";
import { createGeneratedTeam } from "../src/teams.js";
import {
  hydratePlayerTraits,
  injuryImmune,
  traitAdjustedAttribute,
  traitPositionFit,
  weatherPenaltyMultiplier,
} from "../game/public/trait-runtime.js";

const catalog = NEW_TRAIT_BATCH;

function carrier(traitId) {
  return hydratePlayerTraits({ id: `player-${traitId}`, traitCards: [traitId], attributes: {} }, catalog, "new-trait-test");
}

test("原创卡与5张确认测试卡共20张已转为正式规则，空白卡不被擅自实现", () => {
  assert.equal(NEW_TRAIT_BATCH.length, 20);
  assert.equal(new Set(NEW_TRAIT_BATCH.map((trait) => trait.id)).size, 20);
  assert.ok(NEW_TRAIT_BATCH.every((trait) => trait.summary && trait.rules.length));
  assert.ok(!NEW_TRAIT_BATCH.some((trait) => trait.name === "裁判友好"));
});

test("顺风战士、身体倍棒与特别的一个会按规则改变球员能力", () => {
  const frontRunner = carrier("front-runner-essential");
  assert.equal(traitAdjustedAttribute(frontRunner, "finishing", 80, { scoreState: "leading" }), 99);
  assert.equal(traitAdjustedAttribute(frontRunner, "finishing", 80, { scoreState: "trailing" }), 40);
  assert.equal(traitAdjustedAttribute(carrier("iron-health"), "pace", 80, {}), 64);
  assert.equal(traitAdjustedAttribute(carrier("special-one-loan"), "passing", 80, {}), 99);
});

test("身体倍棒、风雨无惧与变色龙的非数值规则已经接入", () => {
  assert.equal(injuryImmune(carrier("iron-health")), true);
  assert.equal(weatherPenaltyMultiplier(carrier("stormproof-lightning-rod")), 0);
  assert.equal(traitPositionFit(carrier("chameleon-role"), 0.25), 0.7);
});

test("确认加入的5张测试卡采用修订后的评级、时间点和位置限制", () => {
  const byId = new Map(NEW_TRAIT_BATCH.map((trait) => [trait.id, trait]));
  assert.equal(byId.get("five-minutes-before-clockout").rarity, "legendary");
  assert.equal(byId.get("human-goalpost").rarity, "legendary");
  assert.equal(byId.get("last-ticket").rarity, "legendary");
  assert.deepEqual(byId.get("my-flank-alone").eligibleRoleGroups, ["ATT"]);
  const latePlayer = carrier("five-minutes-before-clockout");
  assert.equal(traitAdjustedAttribute(latePlayer, "finishing", 80, { minute: 59 }), 72);
  assert.equal(traitAdjustedAttribute(latePlayer, "finishing", 60, { minute: 60 }), 81);
});

test("一脚成名在任意一次进球后激活而非限定第一次射门", () => {
  const player = carrier("one-goal-to-fame");
  assert.equal(traitAdjustedAttribute(player, "finishing", 60, { minute: 40 }), 60);
  player.matchTraitState = { scored: true };
  assert.equal(traitAdjustedAttribute(player, "finishing", 60, { minute: 70 }), 78);
});

test("肉身门柱会挡下必进球并触发当场离场及1至3场伤停", () => {
  const home = createGeneratedTeam("肉身队", 55, "balanced");
  const away = createGeneratedTeam("猛攻队", 90, "attacking");
  home.lineup[1] = hydratePlayerTraits({ ...home.lineup[1], traitCards: ["human-goalpost"] }, catalog, "human-goalpost-test");
  const result = simulateMatch(home, away, { seed: "human-0" });
  const injury = result.events.find((event) => event.type === "injury" && event.traitName === "肉身门柱");
  assert.ok(injury);
  assert.ok(injury.matchesOut >= 1 && injury.matchesOut <= 3);
  assert.equal(injury.forceUnavailable, true);
});
