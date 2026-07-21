import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCALIZED_PLAYER_NAME_CAPACITY,
  createRng,
  generatePlayer,
  playerMetric,
  playerOverall,
} from "../game/public/core.js";
import { ATTRIBUTE_NAMES } from "../game/public/schema.js";
import { TRAIT_CARDS } from "../src/traits.js";

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

test("程序化普通球员拥有数千种中文译名身份", () => {
  assert.ok(LOCALIZED_PLAYER_NAME_CAPACITY.total >= 5_000);
  assert.ok(Object.values(LOCALIZED_PLAYER_NAME_CAPACITY.perTier).every((count) => count >= 1_000));

  const rng = createRng("large-player-name-pool");
  const usedNames = new Set();
  const roles = ["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"];
  for (let index = 0; index < 500; index += 1) {
    const player = generatePlayer(roles[index % roles.length], TRAIT_CARDS, rng, index, { stage: 1, usedNames });
    assert.equal(usedNames.has(player.name), false);
    usedNames.add(player.name);
  }
  assert.equal(usedNames.size, 500);
  assert.ok([...usedNames].every((name) => name.includes("·") && !/[A-Za-z]/.test(name)));
});

test("同一位置能生成不同技术类型、身体模板、生涯阶段和隐藏性格", () => {
  const rng = createRng("procedural-player-diversity");
  const roles = ["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"];
  const players = Array.from({ length: 600 }, (_, index) => generatePlayer(
    roles[index % roles.length],
    TRAIT_CARDS,
    rng,
    index,
    { stage: 8 },
  ));

  assert.ok(new Set(players.map((player) => player.recruitment.archetype)).size >= 20);
  assert.equal(new Set(players.map((player) => player.recruitment.physicalProfile)).size, 7);
  assert.equal(new Set(players.map((player) => player.recruitment.careerStage)).size, 4);
  assert.equal(new Set(players.map((player) => player.recruitment.qualityBand)).size, 4);
  assert.equal(new Set(players.map((player) => player.hidden.personality)).size, 7);
  assert.ok(new Set(players.map((player) => ATTRIBUTE_NAMES.map((name) => player.attributes[name]).join("-"))).size > 590);
  assert.ok(Math.max(...players.map((player) => player.heightCm)) - Math.min(...players.map((player) => player.heightCm)) >= 35);
  assert.ok(Math.max(...players.map((player) => player.attributes.pace)) - Math.min(...players.map((player) => player.attributes.pace)) >= 40);
  assert.ok(Math.max(...players.map(playerOverall)) - Math.min(...players.map(playerOverall)) >= 24);
  assert.ok(players.every((player) => player.recruitment.generator === "procedural-v2" && !player.legendary));
  assert.ok(players.every((player) => player.development.potential >= playerOverall(player)));
  assert.ok(players.every((player) => ATTRIBUTE_NAMES.every((name) => Number.isFinite(player.attributes[name]) && player.attributes[name] >= 1 && player.attributes[name] <= 99)));
});

test("程序化属性保持位置特征，同时允许极端专长球员出现", () => {
  const rng = createRng("procedural-role-identity");
  const generateGroup = (role) => Array.from({ length: 160 }, (_, index) => generatePlayer(role, [], rng, index, { stage: 12 }));
  const keepers = generateGroup("GK");
  const centreBacks = generateGroup("CB");
  const strikers = generateGroup("ST");
  const wingers = generateGroup("LW");

  assert.ok(average(keepers.map((player) => playerMetric(player, "goalkeeping"))) > average(keepers.map((player) => playerMetric(player, "attack"))) + 18);
  assert.ok(average(centreBacks.map((player) => playerMetric(player, "defense"))) > average(centreBacks.map((player) => playerMetric(player, "attack"))) + 10);
  assert.ok(average(strikers.map((player) => playerMetric(player, "attack"))) > average(strikers.map((player) => playerMetric(player, "defense"))) + 16);
  assert.ok(average(wingers.map((player) => playerMetric(player, "pace"))) > average(centreBacks.map((player) => playerMetric(player, "pace"))) + 8);
  assert.ok(centreBacks.some((player) => player.recruitment.archetype === "aerial-defender" && playerMetric(player, "aerial") >= 80));
  assert.ok(wingers.some((player) => player.recruitment.archetype === "speedster" && playerMetric(player, "pace") >= 85));
});

test("征程后期普通候选整体增强但仍保持随机波动", () => {
  const roles = ["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"];
  const sample = (stage, seed) => {
    const rng = createRng(seed);
    return Array.from({ length: 400 }, (_, index) => generatePlayer(roles[index % roles.length], [], rng, index, { stage }));
  };
  const community = sample(1, "community-candidates");
  const elite = sample(45, "elite-candidates");
  const communityAverage = average(community.map(playerOverall));
  const eliteAverage = average(elite.map(playerOverall));

  assert.ok(eliteAverage > communityAverage + 9);
  assert.ok(Math.max(...community.map(playerOverall)) > communityAverage + 10);
  assert.ok(Math.min(...elite.map(playerOverall)) < eliteAverage - 8);
});
