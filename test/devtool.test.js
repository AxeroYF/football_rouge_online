import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultDatabase } from "../devtool/default-data.js";
import { buildTeamFromDatabase, runSimulation } from "../devtool/simulation.js";
import { hasCorruptedText, repairCorruptedDatabaseText, validateDatabase } from "../devtool/store.js";

test("开发工具默认数据库结构有效", () => {
  const state = createDefaultDatabase();
  assert.deepEqual(validateDatabase(state), []);
  assert.equal(state.traitCards.length, 100);
  assert.deepEqual(state.traitDrafts, []);
  assert.deepEqual(state.bonds, []);
  assert.equal(state.teams.length, 2);
  assert.equal(state.players.length, 22);
  assert.ok(state.teams.every((team) => team.lineupIds.length === 7 && team.benchIds.length === 4));
  assert.ok(state.traitCards.every((trait) => Array.isArray(trait.bondIds) && trait.bondIds.length === 0));
  assert.equal(state.globalConfig.economy.victoryBaseGold, 220);
});

test("开发中特性允许信息不完整，并与正式卡池保持隔离", () => {
  const state = createDefaultDatabase();
  state.traitDrafts.push({
    id: "draft-incomplete-card",
    name: "只有一个名字也能保存",
    status: "concept",
  });
  assert.deepEqual(validateDatabase(state), []);
  assert.equal(state.traitCards.length, 100);
  assert.ok(state.players.every((player) => !player.traitCards.includes("draft-incomplete-card")));
});

test("羁绊支持自定义档位效果且同一正式卡可以加入多个羁绊", () => {
  const state = createDefaultDatabase();
  const traitId = state.traitCards[0].id;
  state.bonds = [
    { id: "bond-a", name: "羁绊甲", short: "甲", description: "", traitIds: [traitId], tiers: [{ threshold: 1, effectText: "自定义甲", bonuses: { attack: 3 } }] },
    { id: "bond-b", name: "羁绊乙", short: "乙", description: "", traitIds: [traitId], tiers: [{ threshold: 1, effectText: "自定义乙", bonuses: { penaltyChance: 20 } }] },
  ];
  state.traitCards[0].bondIds = ["bond-a", "bond-b"];
  assert.deepEqual(validateDatabase(state), []);
});

test("开发中特性 ID 不得与正式卡或其他草稿冲突", () => {
  const state = createDefaultDatabase();
  state.traitDrafts.push({ id: state.traitCards[0].id });
  assert.ok(validateDatabase(state).some((error) => error.includes("conflicts with formal trait")));
  state.traitDrafts = [{ id: "same-draft" }, { id: "same-draft" }];
  assert.ok(validateDatabase(state).some((error) => error.includes("duplicate id")));
});

test("开发工具支持修改稀有度并拦截非法等级", () => {
  const state = createDefaultDatabase();
  state.traitCards[0].rarity = "legendary";
  assert.deepEqual(validateDatabase(state), []);
  state.traitCards[0].rarity = "mythic";
  assert.ok(validateDatabase(state).some((error) => error.includes("invalid rarity")));
});

test("静态特性属性规则会进入开发工具模拟阵容", () => {
  const state = createDefaultDatabase();
  const team = state.teams[0];
  const striker = state.players.find(
    (player) => team.lineupIds.includes(player.id) && player.role === "ST",
  );
  const originalHeading = striker.attributes.heading;
  const originalPace = striker.attributes.pace;
  striker.traitCards = ["aerial-beacon"];
  const built = buildTeamFromDatabase(state, team.id, {}, state.simulationPresets[0].context);
  const simulatedStriker = built.team.lineup.find((player) => player.id === striker.id);
  assert.equal(simulatedStriker.attributes.heading, originalHeading + 5);
  assert.equal(simulatedStriker.attributes.pace, originalPace - 2);
  assert.equal(built.audit.applied, 1);
  assert.equal(built.audit.pending, 1);
});

test("开发工具可以使用保存的数据运行单场与批量模拟", () => {
  const state = createDefaultDatabase();
  const result = runSimulation(state, { matches: 20, seed: "devtool-test" });
  assert.equal(result.batch.matches, 20);
  assert.ok(Number.isInteger(result.single.score.home));
  assert.ok(Number.isInteger(result.single.score.away));
  const probabilityTotal =
    result.batch.probabilities.homeWin +
    result.batch.probabilities.draw +
    result.batch.probabilities.awayWin;
  assert.ok(Math.abs(probabilityTotal - 1) < 0.001);
});

test("乱码修复按稳定ID恢复文字并保留数值调整", () => {
  const state = createDefaultDatabase();
  const originalPace = state.players[0].attributes.pace;
  state.meta.title = "?????";
  state.traitCards[0].name = "????";
  state.traitCards[0].summary = "????????+4????";
  state.players[0].name = "???? 1";
  state.players[0].attributes.pace = originalPace + 7;

  const repaired = repairCorruptedDatabaseText(state);
  assert.equal(repaired.state.meta.title, "场边实验室");
  assert.equal(repaired.state.traitCards[0].name, "一脚出球");
  assert.equal(repaired.state.players[0].name, "河湾竞技 1");
  assert.equal(repaired.state.players[0].attributes.pace, originalPace + 7);
  assert.ok(repaired.repairedFields >= 4);
  assert.equal(hasCorruptedText("正常的中文问句？"), false);
});
