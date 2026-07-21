import test from "node:test";
import assert from "node:assert/strict";
import { BOND_DEFINITIONS, computeTeamBonds, inferTraitBondIds, sumBondBonuses } from "../game/public/bonds.js";
import { createRng, generateDraftChoices, teamRatings } from "../game/public/core.js";
import { TRAIT_CARDS } from "../src/traits.js";

const TEST_BONDS = [
  {
    id: "control",
    name: "控制链",
    short: "控制",
    description: "测试羁绊",
    traitIds: ["control-a", "control-b", "one-touch"],
    tiers: [{ threshold: 2, bonuses: { midfield: 2 }, effectText: "中场配合增强" }],
  },
  {
    id: "versatile",
    name: "多面手",
    short: "多面",
    description: "允许复用同一张卡",
    traitIds: ["control-a"],
    tiers: [{ threshold: 1, bonuses: { tempo: 1 } }],
  },
];

test("100张正式特性卡默认不再绑定任何旧羁绊", () => {
  assert.equal(TRAIT_CARDS.length, 100);
  assert.deepEqual(BOND_DEFINITIONS, []);
  assert.ok(TRAIT_CARDS.every((trait) => inferTraitBondIds(trait, BOND_DEFINITIONS).length === 0));
});

test("同一张特性卡可以属于多个自定义羁绊", () => {
  assert.deepEqual(inferTraitBondIds({ id: "control-a" }, TEST_BONDS), ["control", "versatile"]);
});

test("羁绊按不同首发携带人数激活而不是同一球员的卡牌数量", () => {
  const catalog = [{ id: "control-a" }, { id: "control-b" }];
  const oneCarrier = computeTeamBonds([{ id: "p1", traits: [{ id: "control-a" }, { id: "control-b" }] }], catalog, TEST_BONDS);
  assert.equal(oneCarrier.find((bond) => bond.id === "control").tier, 0);

  const twoCarriers = computeTeamBonds([
    { id: "p1", traits: [{ id: "control-a" }] },
    { id: "p2", traits: [{ id: "control-b" }] },
  ], catalog, TEST_BONDS);
  const control = twoCarriers.find((bond) => bond.id === "control");
  assert.equal(control.carriers, 2);
  assert.equal(control.tier, 1);
  assert.equal(control.effectText, "中场配合增强");
  assert.equal(sumBondBonuses(twoCarriers).midfield, 2);
});

test("激活的自定义羁绊加成会进入七人制球队评分", () => {
  const rng = createRng("bond-rating-test");
  const roles = ["GK", "DEF", "DEF", "MID", "MID", "MID", "ATT"];
  const players = roles.map((role, index) => {
    const player = generateDraftChoices(role, TRAIT_CARDS, rng)[0];
    player.id = `bond-player-${index}`;
    player.assignedRole = role;
    player.traits = index === 3 || index === 4 ? [{ id: "one-touch" }] : [];
    return player;
  });
  const ratings = teamRatings(players, "balanced", TRAIT_CARDS, "231", { bonds: TEST_BONDS });
  assert.equal(ratings.bondBonus.midfield, 2);
  assert.equal(ratings.bonds.find((bond) => bond.id === "control").tier, 1);
});

test("长期共同出场形成的默契度会提升球队评分", () => {
  const rng = createRng("chemistry-rating-test");
  const roles = ["GK", "DEF", "DEF", "MID", "MID", "MID", "ATT"];
  const players = roles.map((role, index) => {
    const player = generateDraftChoices(role, TRAIT_CARDS, rng)[0];
    player.id = `chemistry-player-${index}`;
    player.assignedRole = role;
    return player;
  });
  const fresh = teamRatings(players, "balanced", TRAIT_CARDS, "231", { chemistry: 50 });
  const familiar = teamRatings(players, "balanced", TRAIT_CARDS, "231", { chemistry: 90 });
  assert.ok(familiar.attack > fresh.attack);
  assert.ok(familiar.midfield > fresh.midfield);
  assert.ok(familiar.defense > fresh.defense);
});
