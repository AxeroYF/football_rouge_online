import test from "node:test";
import assert from "node:assert/strict";
import { REAL_PLAYER_POOLS } from "../versus/player-pool.js";
import {
  analyzeElevenBoardFormation,
  deriveFormationLines,
  FORMATION_ROLE_LANES,
  FORMATION_LINE_MINIMUM_GAP,
  formationRoleZones,
  GOALKEEPER_LINE_MINIMUM_Y,
  inferElevenBoardRoles as inferTacticalBoardRoles,
  moveFormationLine,
  sanitizeFormationLines,
} from "../versus/public/formation-rules.js";
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

test("tactical board boundary positions are interpreted identically by the match engine", () => {
  const players = ["gk", "cb-left", "cb-right", "lwb", "rwb", "dm", "lm", "rm", "am", "st-left", "st-right"]
    .map((id) => ({ id }));
  const positions = {
    gk:{ x:50, y:85 },
    "cb-left":{ x:40, y:60 }, "cb-right":{ x:60, y:60 },
    lwb:{ x:20, y:54 }, rwb:{ x:80, y:54 },
    dm:{ x:50, y:48 }, lm:{ x:30, y:40 }, rm:{ x:70, y:40 }, am:{ x:50, y:34 },
    "st-left":{ x:40, y:22 }, "st-right":{ x:60, y:22 },
  };

  const formation = analyzeElevenBoardFormation(players, positions);
  assert.equal(formation.name, "4-4-2");
  const roles = inferTacticalBoardRoles(players.map((player) => ({ id:player.id, position:positions[player.id] })));
  assert.equal(roles["cb-left"], "CB");
  assert.equal(roles.lwb, "LWB");
  assert.equal(roles.rwb, "RWB");
});

test("formation reference lines stay ordered and reject invalid drag coordinates", () => {
  const sanitized = sanitizeFormationLines({ attack:82, midfield:-20, defense:33, goalkeeper:34 });
  const values = [sanitized.attack, sanitized.midfield, sanitized.defense, sanitized.goalkeeper];
  assert.ok(values.every((value, index) => index === 0 || value - values[index - 1] >= FORMATION_LINE_MINIMUM_GAP));

  const raisedDefense = moveFormationLine({ attack:20, midfield:44, defense:68, goalkeeper:90 }, "defense", 30);
  assert.equal(raisedDefense.defense, 52);
  assert.equal(moveFormationLine(raisedDefense, "defense", Number.NaN).defense, 52);
  assert.equal(moveFormationLine(raisedDefense, "unknown", 10).defense, 52);
  assert.equal(moveFormationLine(raisedDefense, "goalkeeper", 60).goalkeeper, GOALKEEPER_LINE_MINIMUM_Y);
});

test("moving the reference lines changes the nearby player's recognized unit", () => {
  const entries = [{ id:"reference-player", position:{ x:50, y:52 } }];
  const highDefense = { attack:12, midfield:30, defense:52, goalkeeper:90 };
  const highMidfield = { attack:12, midfield:52, defense:72, goalkeeper:90 };

  assert.equal(inferTacticalBoardRoles(entries, highDefense)["reference-player"], "CB");
  assert.equal(inferTacticalBoardRoles(entries, highMidfield)["reference-player"], "DM");
});

test("central defenders, midfielders and strikers use wider recognition lanes", () => {
  const lines = { attack:20, midfield:44, defense:68, goalkeeper:90 };
  const entries = [
    { id:"st-edge", position:{ x:26, y:20 } },
    { id:"am-edge", position:{ x:74, y:38 } },
    { id:"dm-edge", position:{ x:26, y:50 } },
    { id:"cb-left-edge", position:{ x:26, y:68 } },
    { id:"cb-right-edge", position:{ x:74, y:68 } },
  ];
  assert.deepEqual(FORMATION_ROLE_LANES.central, FORMATION_ROLE_LANES.centralDefense);
  assert.deepEqual(FORMATION_ROLE_LANES.centralDefense, { minimumX:26, maximumX:74 });
  assert.deepEqual(inferTacticalBoardRoles(entries, lines), {
    "st-edge":"ST", "am-edge":"AM", "dm-edge":"DM", "cb-left-edge":"CB", "cb-right-edge":"CB",
  });
});

test("formation shadow zones expose the same role boundaries as recognition", () => {
  const lines = { attack:20, midfield:44, defense:68, goalkeeper:90 };
  const zones = formationRoleZones(lines);
  assert.deepEqual(zones.map((zone) => zone.role), ["LW", "ST", "RW", "LM", "AM", "DM", "RM", "LWB", "LB", "CB", "RWB", "RB", "GK"]);
  for (const zone of zones) {
    const position = { x:(zone.xMin + zone.xMax) / 2, y:(zone.yMin + zone.yMax) / 2 };
    assert.equal(inferTacticalBoardRoles([{ id:"sample", position }], lines).sample, zone.role);
  }
});

test("old tactical boards derive safe reference-line defaults from their player layers", () => {
  const entries = [
    { id:"st", position:{ x:50, y:18 } },
    { id:"mid", position:{ x:50, y:43 } },
    { id:"cb", position:{ x:50, y:69 } },
    { id:"gk", position:{ x:50, y:91 } },
  ];
  assert.deepEqual(deriveFormationLines(entries), { attack:18, midfield:43, defense:69, goalkeeper:91 });
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
