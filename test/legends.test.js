import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGEND_MATCH_LIMIT,
  LEGEND_PITY_LIMIT,
  LEGEND_PROFILES,
  LEGEND_ROLL_CHANCE,
  REWARD_LEGEND_ROLL_CHANCE,
  createLegendPlayer,
  legendPitySettings,
  rollLegend,
} from "../game/public/legends.js";
import { TRAIT_CARDS } from "../src/traits.js";

test("传奇池包含指定的十四名球星且身份唯一", () => {
  assert.equal(LEGEND_PROFILES.length, 14);
  assert.equal(new Set(LEGEND_PROFILES.map((player) => player.id)).size, 14);
  assert.deepEqual(
    new Set(LEGEND_PROFILES.map((player) => player.name)),
    new Set(["梅西", "姆巴佩", "C罗", "库尔图瓦", "哈兰德", "莫德里奇", "克罗斯", "贝利", "齐达内", "贝肯鲍尔", "大罗", "罗纳尔迪尼奥", "马拉多纳", "贝克汉姆"]),
  );
  assert.equal(LEGEND_ROLL_CHANCE, 0.04);
  assert.equal(REWARD_LEGEND_ROLL_CHANCE, 0.06);
});

test("商店和通关招募的传奇概率逐轮提升并在第十轮保底", () => {
  const shopFirst = legendPitySettings(0, "shop");
  const shopNinth = legendPitySettings(8, "shop");
  const shopTenth = legendPitySettings(9, "shop");
  const rewardFirst = legendPitySettings(0, "reward");
  const rewardNinth = legendPitySettings(8, "reward");
  assert.equal(LEGEND_PITY_LIMIT, 10);
  assert.ok(shopNinth.chance > shopFirst.chance);
  assert.ok(rewardFirst.chance > shopFirst.chance);
  assert.ok(rewardNinth.chance > rewardFirst.chance);
  assert.equal(shopTenth.round, 10);
  assert.equal(shopTenth.guaranteed, true);
  assert.equal(shopTenth.chance, 1);
  assert.ok(rollLegend(TRAIT_CARDS, () => 0.999, [], [], 0, shopTenth.chance)?.legendary);
});

test("传奇球星带三张强力锁定特性并限时十场", () => {
  const player = createLegendPlayer(LEGEND_PROFILES[0], TRAIT_CARDS, () => 0.37, 0);
  assert.equal(player.legendary, true);
  assert.equal(player.legendMatchesRemaining, LEGEND_MATCH_LIMIT);
  assert.equal(player.traits.length, 3);
  assert.equal(new Set(player.traits.map((entry) => entry.id)).size, 3);
  assert.ok(player.traits.every((entry) => entry.innate && entry.locked));
  assert.ok(player.traits.every((entry) => ["epic", "legendary"].includes(TRAIT_CARDS.find((trait) => trait.id === entry.id)?.rarity)));
});

test("传奇抽取会排除本轮已出现和本征程已签下的球星", () => {
  const unavailable = LEGEND_PROFILES.slice(0, 6).map((profile) => profile.id);
  const legend = rollLegend(TRAIT_CARDS, () => 0, unavailable, [], 0);
  assert.equal(legend.legendId, LEGEND_PROFILES[6].id);
});
