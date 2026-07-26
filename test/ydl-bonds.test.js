import test from "node:test";
import assert from "node:assert/strict";
import {
  applyS4BondBonuses,
  createS4BondCatalog,
  evaluateS4LineupBonds,
  S4_BOND_BONUS_BY_COUNT,
} from "../versus/public/bond-rules.js";
import { REAL_PLAYERS } from "../versus/player-pool.js";
import { S4_BOND_CATALOG } from "../versus/league-service.js";

test("正式S4球员池生成10个国家队和20家俱乐部羁绊", () => {
  assert.deepEqual(
    S4_BOND_CATALOG.filter((bond) => bond.type === "nationality").map((bond) => bond.name),
    ["西班牙", "法国", "英格兰", "德国", "巴西", "意大利", "葡萄牙", "阿根廷", "荷兰", "比利时"],
  );
  assert.deepEqual(
    S4_BOND_CATALOG.filter((bond) => bond.type === "club").map((bond) => bond.name),
    ["皇家马德里", "巴塞罗那", "阿森纳", "AC米兰", "拜仁慕尼黑", "曼城", "利物浦", "马德里竞技", "曼联", "巴黎圣日耳曼", "国际米兰", "尤文图斯", "那不勒斯", "纽卡斯尔联", "托特纳姆热刺", "切尔西", "阿斯顿维拉", "多特蒙德", "加拉塔萨雷", "利雅得新月"],
  );
  assert.ok(S4_BOND_CATALOG.every((bond) => bond.poolCount >= 10));
  assert.deepEqual(S4_BOND_CATALOG, createS4BondCatalog(REAL_PLAYERS));
});

test("国家队与俱乐部羁绊可同时触发并只强化成员", () => {
  const players = Array.from({ length:11 }, (_, index) => ({
    id:`p${index + 1}`,
    nationality:index < 5 ? "西班牙" : "法国",
    club:index < 6 ? "皇家马德里" : "阿森纳",
    attributes:{ passing:80 },
    traits:[],
  }));
  const catalog = createS4BondCatalog([
    ...players,
    ...Array.from({ length:9 }, (_, index) => ({ id:`es${index}`, nationality:"西班牙", club:"皇家马德里" })),
    ...Array.from({ length:9 }, (_, index) => ({ id:`fr${index}`, nationality:"法国", club:"阿森纳" })),
  ]);
  const bonds = evaluateS4LineupBonds(players, catalog);
  assert.deepEqual(bonds.map((bond) => [bond.type, bond.name, bond.count, bond.bonus]), [
    ["nationality", "法国", 6, .015],
    ["club", "皇家马德里", 6, .015],
  ]);
  const boosted = applyS4BondBonuses(players, bonds);
  assert.equal(boosted[0].ydlBondBonus, .015);
  assert.equal(boosted[5].ydlBondBonus, .03);
  assert.equal(boosted[10].ydlBondBonus, .015);
  assert.equal(boosted[5].attributes.passing, 82.4);
});

test("变色龙按国家队和俱乐部各补入一个最强羁绊", () => {
  const catalog = [
    { id:"nationality:西班牙", type:"nationality", name:"西班牙", label:"国家队", poolCount:20 },
    { id:"club:皇家马德里", type:"club", name:"皇家马德里", label:"俱乐部", poolCount:20 },
  ];
  const players = [
    ...Array.from({ length:4 }, (_, index) => ({ id:`base-${index}`, nationality:"西班牙", club:"皇家马德里", traits:[] })),
    { id:"wildcard", nationality:"阿根廷", club:"迈阿密国际", traits:["lone-finisher"] },
    ...Array.from({ length:6 }, (_, index) => ({ id:`other-${index}`, nationality:"其他", club:"其他", traits:[] })),
  ];
  const bonds = evaluateS4LineupBonds(players, catalog);
  assert.equal(bonds.length, 2);
  assert.ok(bonds.every((bond) => bond.count === 5 && bond.memberIds.includes("wildcard")));
});

test("5至11人羁绊采用1%至5%的渐进加成", () => {
  assert.deepEqual(S4_BOND_BONUS_BY_COUNT, {
    5:.01,
    6:.015,
    7:.02,
    8:.025,
    9:.03,
    10:.04,
    11:.05,
  });
});
