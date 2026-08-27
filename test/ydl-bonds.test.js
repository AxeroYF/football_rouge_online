import test from "node:test";
import assert from "node:assert/strict";
import {
  applyS4BondBonuses,
  createS4BondCatalog,
  evaluateS4LineupBonds,
  S4_BOND_BONUS_BY_COUNT,
  S4_REGIONAL_BONDS,
} from "../versus/public/bond-rules.js";
import { REAL_PLAYERS } from "../versus/player-pool.js";
import { S4_BOND_CATALOG } from "../versus/league-service.js";

test("正式S4球员池生成满足门槛的国家队和俱乐部羁绊", () => {
  const expectedNames = (field) => {
    const counts = new Map();
    REAL_PLAYERS.filter((player) => !player.xPlayer).forEach((player) => {
      const name = String(player[field] ?? "").trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    });
    return [...counts.entries()]
      .filter(([, count]) => count >= 10)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
      .map(([name]) => name);
  };

  assert.deepEqual(
    S4_BOND_CATALOG.filter((bond) => bond.type === "nationality" && !bond.regional).map((bond) => bond.name),
    expectedNames("nationality"),
  );
  assert.deepEqual(
    S4_BOND_CATALOG.filter((bond) => bond.type === "club").map((bond) => bond.name),
    expectedNames("club"),
  );
  assert.ok(S4_BOND_CATALOG.every((bond) => bond.poolCount >= 10));
  assert.deepEqual(S4_BOND_CATALOG, createS4BondCatalog(REAL_PLAYERS));
});

test("正式球员池上线五个地域羁绊并按非X成员统计", () => {
  assert.deepEqual(S4_REGIONAL_BONDS.map((bond) => bond.name), ["北欧", "中东欧", "非洲", "中北美洲", "亚洲大洋洲"]);
  const regionalCatalog = S4_BOND_CATALOG.filter((bond) => bond.regional);
  assert.equal(regionalCatalog.length, 5);
  S4_REGIONAL_BONDS.forEach((definition) => {
    const catalogEntry = regionalCatalog.find((entry) => entry.id === `nationality-region:${definition.id}`);
    const expectedPoolCount = REAL_PLAYERS.filter((player) => !player.xPlayer && definition.memberNationalities.includes(player.nationality)).length;
    assert.equal(catalogEntry?.poolCount, expectedPoolCount);
    assert.equal(catalogEntry?.label, "地域");
    assert.ok(catalogEntry.poolCount >= 10);
  });
  const africa = S4_REGIONAL_BONDS.find((bond) => bond.id === "africa");
  assert.ok(["摩洛哥", "尼日利亚", "喀麦隆", "刚果民主共和国", "南非", "埃及"].every((country) => africa.memberNationalities.includes(country)));
});

test("地域羁绊混合成员国后使用与国家羁绊相同的2%至6%曲线", () => {
  const nationalities = ["瑞典", "瑞典", "瑞典", "瑞典", "丹麦", "丹麦", "丹麦", "丹麦", "挪威", "挪威", "挪威"];
  const players = nationalities.map((nationality, index) => ({
    id:`nordic-${index}`,
    nationality,
    club:`俱乐部-${index}`,
    attributes:{ passing:80 },
    traits:[],
  }));
  const catalog = createS4BondCatalog(players);
  const bond = evaluateS4LineupBonds(players, catalog).find((entry) => entry.id === "nationality-region:nordic");

  assert.equal(bond.count, 11);
  assert.equal(bond.bonus, S4_BOND_BONUS_BY_COUNT[11]);
  assert.equal(bond.regional, true);
  assert.ok(applyS4BondBonuses(players, [bond]).every((player) => player.attributes.passing === 84.8));
});

test("国家与地域羁绊不叠加且同人数时优先具体国家", () => {
  const lineup = [
    ...Array.from({ length:5 }, (_, index) => ({ id:`sweden-${index}`, nationality:"瑞典", club:`首发-${index}`, traits:[] })),
    ...Array.from({ length:6 }, (_, index) => ({ id:`other-${index}`, nationality:"法国", club:`其他-${index}`, traits:[] })),
  ];
  const catalog = createS4BondCatalog([
    ...lineup,
    ...Array.from({ length:5 }, (_, index) => ({ id:`sweden-pool-${index}`, nationality:"瑞典", club:`瑞典池-${index}` })),
    ...Array.from({ length:5 }, (_, index) => ({ id:`denmark-pool-${index}`, nationality:"丹麦", club:`丹麦池-${index}` })),
  ]);
  const nationalityBonds = evaluateS4LineupBonds(lineup, catalog).filter((bond) => bond.type === "nationality");

  assert.equal(nationalityBonds.length, 1);
  assert.equal(nationalityBonds[0].name, "瑞典");
  assert.equal(nationalityBonds[0].regional, false);
  assert.equal(nationalityBonds[0].count, 5);
  assert.equal(nationalityBonds[0].bonus, .02);
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
    { id:"structure:steel-defense", roleGroup:"DEF", count:6, bonus:.03 },
    { id:"structure:blow-them-up", roleGroup:"ATT", count:5, bonus:.03 },
    { id:"structure:mahjong-together", roleGroup:"MID", count:6, bonus:.03 },
  ];
  cases.forEach(({ id, roleGroup, count, bonus }) => {
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
    assert.equal(bond.targetRoleGroup, roleGroup);
    const positionedPlayers = players.map((player) => ({ ...player, assignedRole:roles[player.id] }));
    const boosted = applyS4BondBonuses(positionedPlayers, [bond]);
    assert.equal(boosted.filter((player) => player.ydlBondBonus === bonus).length, count);
    assert.equal(boosted.find((player) => !bond.memberIds.includes(player.id)).attributes.passing, 80);
    const staleMemberId = bond.memberIds[0];
    const moved = positionedPlayers.map((player) => player.id === staleMemberId ? { ...player, assignedRole:roleGroup === "DEF" ? "ST" : "CB" } : player);
    const guarded = applyS4BondBonuses(moved, [bond]);
    assert.equal(guarded.find((player) => player.id === staleMemberId).attributes.passing, 80);
  });
});
