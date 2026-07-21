import test from "node:test";
import assert from "node:assert/strict";
import {
  TEAM_SIZE,
  POSITION_GROUPS,
  createRng,
  formationBoardPositions,
  formationRolePlan,
  formationSettings,
  formationSlotsFromKey,
  generateDraftChoices,
  generateOpponent,
  generateOpponentSquad,
  nameTierIndex,
  pickWeather,
  playerOverall,
  roleFitScore,
  roleGroup,
  simulateMatchFast,
  traitFitsPlayer,
  traitFitsRole,
} from "../game/public/core.js";
import { TRAIT_CARDS } from "../src/traits.js";

test("七人制选秀每次提供三个不同名字且带有先天特性", () => {
  const choices = generateDraftChoices("GK", TRAIT_CARDS, createRng("draft-test"));
  assert.equal(choices.length, 3);
  assert.equal(new Set(choices.map((player) => player.name)).size, 3);
  assert.ok(choices.every((player) => player.role === "GK"));
  assert.ok(choices.every((player) => player.traits.length === 1));
  assert.ok(choices.every((player) => player.traits[0].innate && player.traits[0].locked));
  assert.ok(choices.every((player) => Number.isInteger(playerOverall(player))));
});

test("比赛天气按60/15/15/10的区间抽取", () => {
  assert.equal(pickWeather(() => 0.599).key, "sunny");
  assert.equal(pickWeather(() => 0.6).key, "rain");
  assert.equal(pickWeather(() => 0.749).key, "rain");
  assert.equal(pickWeather(() => 0.75).key, "storm");
  assert.equal(pickWeather(() => 0.899).key, "storm");
  assert.equal(pickWeather(() => 0.9).key, "snow");
});

test("比赛天气可读取开发者保存的自定义权重", () => {
  const weights = { sunny: 0, rain: 0, storm: 3, snow: 1 };
  assert.equal(pickWeather(() => 0, weights).key, "storm");
  assert.equal(pickWeather(() => 0.749, weights).key, "storm");
  assert.equal(pickWeather(() => 0.75, weights).key, "snow");
  assert.equal(pickWeather(() => 0.2, weights).weight, 75);
});

test("连续选秀会避开球队已有中文姓名", () => {
  const rng = createRng("draft-existing-names");
  const first = generateDraftChoices("GK", TRAIT_CARDS, rng);
  const existing = new Set(first.map((player) => player.name));
  const second = generateDraftChoices("DEF", TRAIT_CARDS, rng, { stage: 1, usedNames: existing });
  assert.ok(second.every((player) => !existing.has(player.name)));
});

test("ANY 特性可适配所有位置，专属特性只适配对应位置", () => {
  const anyTrait = TRAIT_CARDS.find((trait) => trait.eligibleRoleGroups.includes("ANY"));
  const keeperTrait = TRAIT_CARDS.find((trait) => trait.eligibleRoleGroups.length === 1 && trait.eligibleRoleGroups[0] === "GK");
  assert.ok(traitFitsRole(anyTrait, "ATT"));
  assert.ok(traitFitsRole(keeperTrait, "GK"));
  assert.equal(traitFitsRole(keeperTrait, "ATT"), false);
  assert.equal(traitFitsPlayer(keeperTrait, { role: "CB", secondaryRole: "GK" }), true);
  assert.equal(traitFitsPlayer(keeperTrait, { role: "CB", secondaryRole: "DM" }), false);
});

test("后期关卡生成的对手基础评级更高", () => {
  const early = generateOpponent(1, createRng("same-opponent"));
  const late = generateOpponent(40, createRng("same-opponent"));
  assert.ok(late.rating > early.rating + 25);
});

test("对手阵容包含七名首发和替补且名字唯一", () => {
  const opponent = generateOpponent(7, createRng("opponent-squad"));
  const squad = generateOpponentSquad({ ...opponent, stage: 7 }, createRng("opponent-players"), 4);
  assert.equal(squad.length, TEAM_SIZE + 4);
  assert.equal(new Set(squad.map((player) => player.name)).size, TEAM_SIZE + 4);
  assert.deepEqual(squad.slice(0, TEAM_SIZE).map((player) => player.assignedRole), formationRolePlan(opponent.formation));
  assert.deepEqual(squad.slice(0, TEAM_SIZE).map((player) => player.boardPosition), formationBoardPositions(formationRolePlan(opponent.formation)));
});

test("堆叠前锋会提高进攻投入但降低防守与阵型结构", () => {
  const shape = (key) => {
    const roles = formationRolePlan(key);
    return formationSettings(roles.map((role, index) => ({ id: `${key}-${index}`, role, assignedRole: role })), key);
  };
  const aggressive = shape("114");
  const balanced = shape("222");
  const defensive = shape("411");
  assert.ok(aggressive.attackingNumbers > balanced.attackingNumbers + 15);
  assert.ok(aggressive.defensiveBalance < balanced.defensiveBalance - 10);
  assert.ok(aggressive.transitionRisk > balanced.transitionRisk + 15);
  assert.ok(defensive.defensiveBalance > balanced.defensiveBalance + 15);
  assert.ok(aggressive.coherence < balanced.coherence);
});

test("球队与球员姓名随征程阶段升级且只显示中文译名", () => {
  const stages = [1, 11, 21, 31, 41];
  const teams = stages.map((stage) => generateOpponent(stage, createRng(`team-name-${stage}`)).name);
  const players = stages.map((stage) => generateDraftChoices("MID", TRAIT_CARDS, createRng(`player-name-${stage}`), { stage })[0].name);
  assert.deepEqual(stages.map(nameTierIndex), [0, 1, 2, 3, 4]);
  assert.equal(new Set(teams).size, stages.length);
  assert.equal(new Set(players).size, stages.length);
  assert.ok([...teams, ...players].every((name) => !/[A-Za-z]/.test(name)));
  assert.ok(players.every((name) => name.includes("·")));
});

test("球员使用细分位置、惯用脚并受到站位适配影响", () => {
  const player = generateDraftChoices("DEF", TRAIT_CARDS, createRng("detailed-position"))[0];
  assert.ok(POSITION_GROUPS.DEF.includes(player.role));
  assert.equal(roleGroup(player.role), "DEF");
  assert.ok(["left", "right", "both"].includes(player.preferredFoot));
  assert.ok(roleFitScore(player, player.role) > roleFitScore(player, "ST"));
});

test("自由站位识别的阵型必须覆盖三条线并保持六名外场球员", () => {
  assert.deepEqual(formationSlotsFromKey("123"), ["GK", "DEF", "MID", "MID", "ATT", "ATT", "ATT"]);
  assert.deepEqual(formationSlotsFromKey("600"), formationSlotsFromKey("231"));
});

test("快速比赛会产生有效比分与射门统计", () => {
  const rng = createRng("team-test");
  const roles = ["GK", "DEF", "DEF", "MID", "MID", "MID", "ATT"];
  const players = roles.map((role) => generateDraftChoices(role, TRAIT_CARDS, rng)[0]);
  const result = simulateMatchFast({ players, tactic: "balanced", formation: "231" }, TRAIT_CARDS, "match-test", 1);
  assert.equal(result.minute, 90);
  assert.ok(Number.isInteger(result.homeScore));
  assert.ok(Number.isInteger(result.awayScore));
  assert.ok(result.homeShots + result.awayShots > 0);
  assert.ok(result.fouls.home + result.fouls.away > 0);
  assert.ok(result.referee?.name);
  assert.ok(result.timeline.length >= 10);
  assert.equal(result.events.length, result.timeline.length);
  assert.ok(result.events.some((event) => ["build-up", "attack", "counter", "duel", "corner"].includes(event.type)));
  assert.ok(result.timeline.filter((event) => ["goal", "save", "miss"].includes(event.type)).every((event) => event.playerName));
});
