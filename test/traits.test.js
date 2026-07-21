import test from "node:test";
import assert from "node:assert/strict";
import {
  drawTraitOffer,
  grantTraitCard,
  isTraitEligibleForPlayer,
  TRAIT_BY_ID,
  TRAIT_CARDS,
  validateTraitCatalog,
} from "../src/traits.js";
import { makePlayer } from "../src/teams.js";

test("正式卡池包含100张结构有效且ID唯一的特性卡", () => {
  assert.equal(TRAIT_CARDS.length, 100);
  assert.deepEqual(validateTraitCatalog(), []);
  assert.equal(Object.keys(TRAIT_BY_ID).length, TRAIT_CARDS.length);
});

test("同一随机种子产生相同的三选一", () => {
  const player = makePlayer("前锋", "ST", 70);
  const first = drawTraitOffer({ seed: "same", player });
  const second = drawTraitOffer({ seed: "same", player });
  assert.deepEqual(
    first.map((trait) => trait.id),
    second.map((trait) => trait.id),
  );
});

test("随机卡池无重复并始终适配目标位置", () => {
  for (const role of ["GK", "CB", "CM", "ST"]) {
    const player = makePlayer(role, role, 70);
    for (let index = 0; index < 250; index += 1) {
      const offer = drawTraitOffer({ seed: role + index, player });
      assert.equal(offer.length, 3);
      assert.equal(new Set(offer.map((trait) => trait.id)).size, 3);
      assert.ok(offer.every((trait) => isTraitEligibleForPlayer(trait, player)));
    }
  }
});

test("保底计数会保证第一张卡达到目标稀有度", () => {
  const player = makePlayer("中场", "CM", 70);
  const rareOffer = drawTraitOffer({ seed: "rare-pity", player, pityOffers: 7 });
  const epicOffer = drawTraitOffer({ seed: "epic-pity", player, pityOffers: 18 });
  assert.ok(["rare", "epic", "legendary"].includes(rareOffer[0].rarity));
  assert.ok(["epic", "legendary"].includes(epicOffer[0].rarity));
});

test("装备卡牌遵守位置、重复和三个槽位限制", () => {
  const goalkeeper = makePlayer("门将", "GK", 70);
  assert.throws(() => grantTraitCard(goalkeeper, "box-instinct"), /not eligible/);

  let striker = makePlayer("前锋", "ST", 70);
  striker = grantTraitCard(striker, "box-instinct");
  assert.throws(() => grantTraitCard(striker, "box-instinct"), /already owns/);
  striker = grantTraitCard(striker, "endless-engine");
  striker = grantTraitCard(striker, "big-stage");
  assert.throws(() => grantTraitCard(striker, "rewrite-fate"), /slots are full/);
});
