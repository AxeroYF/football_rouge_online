import test from "node:test";
import assert from "node:assert/strict";
import { REAL_PLAYER_POOLS } from "../versus/player-pool.js";
import { analyzeElevenFormation, defaultElevenPositions } from "../versus/rules.js";

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
