import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  OWNER_TYPES,
  canAttack,
  canChooseHome,
  captureTerritory,
  claimHome,
  createTerritoryWorld,
  listAttackableTerritories,
  setPlayerLineups,
} from "../territory-model.js";

const realIndex = JSON.parse(fs.readFileSync(new URL("../assets/data/territory-index.json", import.meta.url), "utf8"));

function territory(territoryId, neighbors, initialOwner = { type: "neutral", id: null, name: "中立地区" }) {
  return {
    territoryId,
    neighbors,
    landNeighbors: neighbors,
    maritimeNeighbors: [],
    playable: true,
    spawnAllowed: initialOwner.type === "neutral",
    initialOwner,
    cityIds: [],
    clubIds: [],
  };
}

const syntheticIndex = {
  territories: [
    territory("a", ["b"]),
    territory("b", ["a", "c", "d"]),
    territory("c", ["b"], { type: "club", id: "club-garrison:c", name: "测试豪门" }),
    territory("d", ["b"]),
  ],
};

test("real territory index is internally consistent", () => {
  assert.equal(realIndex.territories.length, 1470);
  assert.equal(new Set(realIndex.territories.map((entry) => entry.territoryId)).size, 1470);
  assert.equal(Object.keys(realIndex.cities).length, 84);
  assert.equal(Object.keys(realIndex.clubs).length, 51);
  assert.equal(realIndex.territories.filter((entry) => entry.initialOwner.type === "club").length, 70);
  const mergedCountryCounts = { LVA:119, MKD:84, MLT:68, SVN:193 };
  for (const [countryCode, sourceCount] of Object.entries(mergedCountryCounts)) {
    const entries = realIndex.territories.filter((entry) => entry.countryCode === countryCode);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].territoryId, `adm1:country-${countryCode.toLowerCase()}`);
    assert.equal(entries[0].mergedSourceTerritoryIds.length, sourceCount);
    assert.equal(Object.values(realIndex.territoryIdAliases).filter((territoryId) => territoryId === entries[0].territoryId).length, sourceCount);
  }
  const greaterLondon = realIndex.territories.filter((entry) => entry.initialOwner.id === "club-garrison:greater-london");
  assert.equal(greaterLondon.length, 33);
  assert.ok(greaterLondon.every((entry) => entry.spawnAllowed === false));
  assert.ok(greaterLondon.every((entry) => entry.garrisonClubIds.length === 5));
  assert.equal(realIndex.territories.filter((entry) => entry.neighbors.length === 0).length, 0);
  const byId = new Map(realIndex.territories.map((entry) => [entry.territoryId, entry]));
  for (const entry of realIndex.territories) {
    assert.match(entry.territoryId, /^adm1:[a-z0-9-]+$/);
    for (const neighborId of entry.neighbors) {
      assert.notEqual(neighborId, entry.territoryId);
      assert.ok(byId.has(neighborId));
      assert.ok(byId.get(neighborId).neighbors.includes(entry.territoryId));
    }
  }
});

test("world starts with neutral and club ownership", () => {
  const world = createTerritoryWorld(syntheticIndex);
  assert.equal(world.territories.a.ownerType, OWNER_TYPES.NEUTRAL);
  assert.equal(world.territories.c.ownerType, OWNER_TYPES.CLUB);
  assert.equal(world.territories.c.ownerId, "club-garrison:c");
});

test("home claim, lineups, adjacent capture, permanent loss and recapture", () => {
  const world = createTerritoryWorld(syntheticIndex);
  claimHome(syntheticIndex, world, "player-1", "a");
  claimHome(syntheticIndex, world, "player-2", "d");
  setPlayerLineups(world, "player-1", { attackLineupId: "attack-1", defenseLineupId: "defense-1" });
  assert.equal(world.players["player-1"].capitalTerritoryId, "a");
  assert.equal(world.players["player-1"].defenseLineupId, "defense-1");
  assert.equal(canAttack(syntheticIndex, world, "player-1", "b").allowed, true);
  assert.equal(canAttack(syntheticIndex, world, "player-1", "c").reason, "not-adjacent");
  captureTerritory(syntheticIndex, world, "player-1", "b");
  assert.deepEqual(listAttackableTerritories(syntheticIndex, world, "player-1"), ["c", "d"]);
  captureTerritory(syntheticIndex, world, "player-2", "b");
  assert.equal(world.territories.b.ownerId, "player-2");
  assert.equal(world.players["player-1"].territoryIds.includes("b"), false);
  captureTerritory(syntheticIndex, world, "player-1", "b");
  assert.equal(world.territories.b.ownerId, "player-1");
});

test("home cannot directly border a neutral club territory", () => {
  const world = createTerritoryWorld(syntheticIndex);
  const permission = canChooseHome(syntheticIndex, world, "player-1", "b");
  assert.equal(permission.allowed, false);
  assert.equal(permission.reason, "adjacent-to-neutral-club");
  assert.equal(permission.adjacentClubTerritoryId, "c");
  assert.throws(() => claimHome(syntheticIndex, world, "player-1", "b"), /adjacent-to-neutral-club/);
});

test("club territory cannot be selected as a home", () => {
  const world = createTerritoryWorld(syntheticIndex);
  assert.throws(() => claimHome(syntheticIndex, world, "player-1", "c"), /territory-not-spawnable/);
});