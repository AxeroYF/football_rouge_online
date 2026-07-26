import test from "node:test";
import assert from "node:assert/strict";
import { REAL_PLAYER_POOLS } from "../versus/player-pool.js";
import { analyzeElevenFormation, defaultElevenPositions, formationStructureProfile, inferElevenBoardRoles } from "../versus/rules.js";

test("position recognition uses balanced pitch zones and wide channels", () => {
  const roles = inferElevenBoardRoles([
    { id:"gk", position:{ x:50, y:90 } },
    { id:"lb", position:{ x:20, y:72 } },
    { id:"cb", position:{ x:50, y:72 } },
    { id:"rb", position:{ x:80, y:72 } },
    { id:"lwb", position:{ x:20, y:60 } },
    { id:"dm", position:{ x:50, y:56 } },
    { id:"lm", position:{ x:25, y:44 } },
    { id:"am", position:{ x:50, y:35 } },
    { id:"lw", position:{ x:25, y:20 } },
    { id:"st", position:{ x:50, y:20 } },
    { id:"rw", position:{ x:75, y:20 } },
  ]);
  assert.deepEqual(roles, {
    gk:"GK", lb:"LB", cb:"CB", rb:"RB", lwb:"LWB",
    dm:"DM", lm:"LM", am:"AM", lw:"LW", st:"ST", rw:"RW",
  });
});

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

test("line heights and distances distinguish short passing, direct play, deep blocks and high pressing", () => {
  const players = [
    ...REAL_PLAYER_POOLS.GK.slice(0, 1),
    ...REAL_PLAYER_POOLS.DEF.slice(0, 4),
    ...REAL_PLAYER_POOLS.MID.slice(0, 3),
    ...REAL_PLAYER_POOLS.ATT.slice(0, 3),
  ];
  const compactPositions = defaultElevenPositions(players);
  players.slice(1, 5).forEach((player) => { compactPositions[player.id].y = 65; });
  players.slice(5, 8).forEach((player) => { compactPositions[player.id].y = 47; });
  players.slice(8).forEach((player) => { compactPositions[player.id].y = 27; });
  const disconnectedPositions = structuredClone(compactPositions);
  players.slice(1, 5).forEach((player) => { disconnectedPositions[player.id].y = 82; });
  players.slice(5, 8).forEach((player) => { disconnectedPositions[player.id].y = 50; });
  players.slice(8).forEach((player) => { disconnectedPositions[player.id].y = 10; });
  const compact = formationStructureProfile(players, compactPositions);
  const disconnected = formationStructureProfile(players, disconnectedPositions);
  assert.equal(compact.name, disconnected.name);
  assert.ok(compact.geometry.styleFits.possession > disconnected.geometry.styleFits.possession);
  assert.ok(disconnected.geometry.styleFits.longBall > compact.geometry.styleFits.longBall);
  assert.ok(disconnected.geometry.disconnectionRisk > compact.geometry.disconnectionRisk);

  const deepPositions = structuredClone(compactPositions);
  players.slice(1, 5).forEach((player) => { deepPositions[player.id].y = 80; });
  const highPositions = structuredClone(compactPositions);
  players.slice(1, 5).forEach((player) => { highPositions[player.id].y = 62; });
  const deep = formationStructureProfile(players, deepPositions);
  const high = formationStructureProfile(players, highPositions);
  assert.ok(deep.geometry.boxProtection > high.geometry.boxProtection);
  assert.ok(high.geometry.pressingCohesion > deep.geometry.pressingCohesion);
  assert.ok(high.geometry.highLineExposure > deep.geometry.highLineExposure);
});
