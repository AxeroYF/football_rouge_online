import test from "node:test";
import assert from "node:assert/strict";
import { REAL_PLAYER_POOLS } from "../versus/player-pool.js";
import { analyzeElevenFormation, defaultElevenPositions, formationStructureProfile } from "../versus/rules.js";

test("formation recognition distinguishes 4-5-1 from 4-2-3-1", () => {
  const players = [
    ...REAL_PLAYER_POOLS.GK.slice(0, 1),
    ...REAL_PLAYER_POOLS.DEF.slice(0, 4),
    ...REAL_PLAYER_POOLS.MID.slice(0, 5),
    ...REAL_PLAYER_POOLS.ATT.slice(0, 1),
  ];
  const flatPositions = defaultElevenPositions(players);
  assert.equal(analyzeElevenFormation(players, flatPositions).name, "4-5-1");

  const layeredPositions = structuredClone(flatPositions);
  const midfielders = players.slice(5, 10);
  midfielders.forEach((player, index) => {
    layeredPositions[player.id].y = index < 2 ? 52 : 37;
  });
  assert.equal(analyzeElevenFormation(players, layeredPositions).name, "4-2-3-1");
});

test("formation recognition covers flat and layered single-striker systems", () => {
  const players = [
    ...REAL_PLAYER_POOLS.GK.slice(0, 1),
    ...REAL_PLAYER_POOLS.DEF.slice(0, 5),
    ...REAL_PLAYER_POOLS.MID.slice(0, 4),
    ...REAL_PLAYER_POOLS.ATT.slice(0, 1),
  ];
  const positions = defaultElevenPositions(players);
  assert.equal(analyzeElevenFormation(players, positions).name, "5-4-1");

  const midfielders = players.slice(6, 10);
  midfielders.forEach((player, index) => {
    positions[player.id].y = index < 2 ? 52 : 37;
  });
  assert.equal(analyzeElevenFormation(players, positions).name, "5-2-2-1");
});

test("formation recognition supports three midfield layers", () => {
  const players = [
    ...REAL_PLAYER_POOLS.GK.slice(0, 1),
    ...REAL_PLAYER_POOLS.DEF.slice(0, 4),
    ...REAL_PLAYER_POOLS.MID.slice(0, 4),
    ...REAL_PLAYER_POOLS.ATT.slice(0, 2),
  ];
  const positions = defaultElevenPositions(players);
  const midfielders = players.slice(5, 9);
  midfielders.forEach((player, index) => {
    positions[player.id].y = index === 0 ? 57 : index < 3 ? 45 : 33;
  });
  assert.equal(analyzeElevenFormation(players, positions).name, "4-1-2-1-2");
});

test("layered midfield improves buildup but exposes uncovered wide areas", () => {
  const players = [
    ...REAL_PLAYER_POOLS.GK.slice(0, 1),
    ...REAL_PLAYER_POOLS.DEF.slice(0, 3),
    ...REAL_PLAYER_POOLS.MID.slice(0, 4),
    ...REAL_PLAYER_POOLS.ATT.slice(0, 3),
  ];
  const flatPositions = defaultElevenPositions(players);
  const diamondPositions = structuredClone(flatPositions);
  const midfielders = players.slice(4, 8);
  [[50,57], [37,45], [63,45], [50,33]].forEach(([x, y], index) => { diamondPositions[midfielders[index].id] = { x, y }; });
  const flat = formationStructureProfile(players, flatPositions);
  const diamond = formationStructureProfile(players, diamondPositions);
  assert.equal(diamond.name, "3-1-2-1-3");
  assert.deepEqual(diamond.midfieldStructure.lineSizes, [1, 2, 1]);
  assert.ok(diamond.multipliers.midfield > flat.multipliers.midfield);
  assert.ok(diamond.multipliers.defense < flat.multipliers.defense);
  assert.ok(diamond.multipliers.transitionRisk > flat.multipliers.transitionRisk);

  diamondPositions[midfielders[1].id].x = 30;
  diamondPositions[midfielders[2].id].x = 70;
  const coveredDiamond = formationStructureProfile(players, diamondPositions);
  assert.equal(coveredDiamond.midfieldStructure.wideCoverage, 1);
  assert.ok(coveredDiamond.multipliers.defense > diamond.multipliers.defense);
  assert.ok(coveredDiamond.multipliers.transitionRisk < diamond.multipliers.transitionRisk);
});
