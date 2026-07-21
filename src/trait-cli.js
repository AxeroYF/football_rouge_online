import { drawTraitOffer, RARITY_LABELS, TRAIT_CARDS } from "./traits.js";
import { makePlayer } from "./teams.js";

function argument(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const seed = argument("seed", "trait-demo");
const role = argument("role", "ST");
const luck = Number(argument("luck", "0"));
const player = makePlayer("测试球员", role, 70);
const offer = drawTraitOffer({ seed, player, luck });
const counts = Object.groupBy(TRAIT_CARDS, (trait) => RARITY_LABELS[trait.rarity]);

console.log("首批特性卡：" + TRAIT_CARDS.length + " 张");
console.table(
  Object.fromEntries(Object.entries(counts).map(([rarity, cards]) => [rarity, cards.length])),
);
console.log("\n为 " + role + " 位置生成的三选一：");
console.table(
  offer.map((trait) => ({
    稀有度: RARITY_LABELS[trait.rarity],
    名称: trait.name,
    类型: trait.category,
    效果: trait.summary,
  })),
);
