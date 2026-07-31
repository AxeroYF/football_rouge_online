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

test("正式S4球员池生成满足门槛的国家队和俱乐部羁绊", () => {
  assert.deepEqual(
    S4_BOND_CATALOG.filter((bond) => bond.type === "nationality").map((bond) => bond.name),
    ["西班牙", "巴西", "法国", "英格兰", "德国", "意大利", "葡萄牙", "阿根廷", "荷兰", "比利时", "克罗地亚"],
  );
  assert.deepEqual(
    S4_BOND_CATALOG.filter((bond) => bond.type === "club").map((bond) => bond.name),
    ["皇家马德里", "巴塞罗那", "拜仁慕尼黑", "阿森纳", "AC米兰", "国际米兰", "马德里竞技", "曼城", "曼联", "利物浦", "尤文图斯", "巴黎圣日耳曼", "切尔西", "纽卡斯尔联", "那不勒斯", "托特纳姆热刺", "多特蒙德", "阿斯顿维拉", "加拉塔萨雷", "利雅得新月"],
  );
  assert.ok(S4_BOND_CATALOG.every((bond) => bond.poolCount >= 10));
  assert.deepEqual(S4_BOND_CATALOG, createS4BondCatalog(REAL_PLAYERS));
});

test("国家队与俱乐部羁绊可同时触发并只强化成员", () => {
  const players = Array.from({ length:11 }, (_, index) => ({
    id:`p${index + 1}`,
    nationality:index < 5 ? "西班牙" : "法国",
    club:index < 6 ? "皇家马德里" : "阿森纳",
    upgradeLevel:1,
    attributes:{ passing:80 },
    traits:[],
  }));
  const catalog = createS4BondCatalog([
    ...players,
    ...Array.from({ length:9 }, (_, index) => ({ id:`es${index}`, nationality:"西班牙", club:"皇家马德里" })),
    ...Array.from({ length:9 }, (_, index) => ({ id:`fr${index}`, nationality:"法国", club:"阿森纳" })),
  ]);
  const bonds = evaluateS4LineupBonds(players, catalog);
  assert.deepEqual(bonds.filter((bond) => bond.type !== "structure").map((bond) => [bond.type, bond.name, bond.count, bond.bonus]), [
    ["nationality", "法国", 6, .025],
    ["club", "皇家马德里", 6, .025],
  ]);
  const boosted = applyS4BondBonuses(players, bonds.filter((bond) => bond.type !== "structure"));
  assert.equal(boosted[0].ydlBondBonus, .025);
  assert.equal(boosted[5].ydlBondBonus, .05);
  assert.equal(boosted[10].ydlBondBonus, .025);
  assert.equal(boosted[5].attributes.passing, 84);
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
  const identityBonds = bonds.filter((bond) => bond.type !== "structure");
  assert.equal(identityBonds.length, 2);
  assert.ok(identityBonds.every((bond) => bond.count === 5 && bond.memberIds.includes("wildcard")));
});

test("5至11人国家队和俱乐部羁绊采用2%至6%的渐进加成", () => {
  assert.deepEqual(S4_BOND_BONUS_BY_COUNT, {
    5:.02,
    6:.025,
    7:.03,
    8:.035,
    9:.04,
    10:.05,
    11:.06,
  });
});

test("后台数值只叠加已触发羁绊中加成最高的两条", () => {
  const players = [{ id:"limited", attributes:{ passing:80 } }];
  const bonds = [
    { id:"lower", bonus:.03, memberIds:["limited"] },
    { id:"highest", bonus:.06, memberIds:["limited"] },
    { id:"middle", bonus:.05, memberIds:["limited"] },
  ];
  const [boosted] = applyS4BondBonuses(players, bonds);

  assert.equal(boosted.ydlBondBonus, .11);
  assert.deepEqual(boosted.ydlBondIds, ["highest", "middle"]);
  assert.equal(boosted.attributes.passing, 88.8);
});

function structurePlayers(overrides = {}) {
  return Array.from({ length:11 }, (_, index) => ({
    id:`structure-${index}`,
    role:index === 0 ? "GK" : index <= 4 ? "CB" : index <= 7 ? "DM" : "ST",
    heightCm:180,
    upgradeLevel:0,
    attributes:{ passing:80 },
    traits:[],
    ...overrides(index),
  }));
}

test("团结起来要求11张非强化代表卡并强化全队3%", () => {
  const players = structurePlayers(() => ({}));
  const united = evaluateS4LineupBonds(players, []).find((bond) => bond.id === "structure:united");
  assert.equal(united.count, 11);
  assert.equal(united.bonus, .03);
  assert.equal(united.memberIds.length, 11);
  assert.ok(applyS4BondBonuses(players, [united]).every((player) => player.attributes.passing === 82.4));

  players[5].upgradeLevel = 1;
  assert.equal(evaluateS4LineupBonds(players, []).some((bond) => bond.id === "structure:united"), false);
});

test("小快灵与高空轰炸采用严格身高边界和2%至5%曲线", () => {
  for (const count of [5, 7, 11]) {
    const short = structurePlayers((index) => ({ heightCm:index < count ? 174 : 175, upgradeLevel:1 }));
    const bond = evaluateS4LineupBonds(short, []).find((entry) => entry.id === "structure:small-quick-skillful");
    assert.equal(bond.count, count);
    assert.equal(bond.bonus, count === 5 ? .02 : count === 7 ? .03 : .05);
    assert.equal(bond.memberIds.length, count);
  }
  const tall = structurePlayers((index) => ({ heightCm:index < 6 ? 186 : 185, upgradeLevel:1 }));
  const aerial = evaluateS4LineupBonds(tall, []).find((entry) => entry.id === "structure:aerial-bombardment");
  assert.equal(aerial.count, 6);
  assert.equal(aerial.bonus, .025);
  assert.equal(aerial.memberIds.length, 6);
});

test("身高结构羁绊使用强化特性修正后的有效身高", () => {
  const short = structurePlayers((index) => ({
    heightCm:index < 5 ? 180 : 175,
    upgradeLevel:1,
    traits:index < 5 ? ["custom-2c1cb6a5-becb-47d2-bad7-1f52b3716c20"] : [],
  }));
  assert.equal(evaluateS4LineupBonds(short, []).find((bond) => bond.id === "structure:small-quick-skillful").count, 5);

  const tall = structurePlayers((index) => ({
    heightCm:index < 5 ? 170 : 185,
    upgradeLevel:1,
    traits:index < 5 ? ["aerial-beacon"] : [],
  }));
  assert.equal(evaluateS4LineupBonds(tall, []).find((bond) => bond.id === "structure:aerial-bombardment").count, 5);
});

test("钢铁防线、跟他们爆了与一起打麻将按当前站位强化对应成员", () => {
  const cases = [
    { id:"structure:steel-defense", role:"CB", count:6, bonus:.05 },
    { id:"structure:blow-them-up", role:"ST", count:5, bonus:.04 },
    { id:"structure:mahjong-together", role:"DM", count:6, bonus:.05 },
  ];
  cases.forEach(({ id, role, count, bonus }) => {
    const players = structurePlayers((index) => ({ upgradeLevel:1 }));
    const fallbackRoles = id === "structure:steel-defense"
      ? ["CB", "CB", "CB", "CB", "CB", "CB", "DM", "DM", "DM", "ST", "GK"]
      : id === "structure:blow-them-up"
        ? ["ST", "ST", "ST", "ST", "ST", "CB", "CB", "CB", "CB", "DM", "GK"]
        : ["DM", "DM", "DM", "DM", "DM", "DM", "CB", "CB", "CB", "ST", "GK"];
    const roles = Object.fromEntries(players.map((player, index) => [player.id, fallbackRoles[index]]));
    const bond = evaluateS4LineupBonds(players, [], { roles }).find((entry) => entry.id === id);
    assert.equal(bond.count, count);
    assert.equal(bond.bonus, bonus);
    const boosted = applyS4BondBonuses(players, [bond]);
    assert.equal(boosted.filter((player) => player.ydlBondBonus === bonus).length, count);
    assert.equal(boosted.find((player) => !bond.memberIds.includes(player.id)).attributes.passing, 80);
  });
});
