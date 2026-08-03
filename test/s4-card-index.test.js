import test from "node:test";
import assert from "node:assert/strict";
import { createTrackedState } from "../versus/league-shard-store.js";
import { cardsForOwner, cardsForPlayer, representativeCard } from "../versus/s4-assets.js";

function card(id, ownerId, playerId, upgradeLevel, extra = {}) {
  return { id, ownerId, playerId, upgradeLevel, traitIds:[], acquiredAt:1, status:"active", ...extra };
}

test("tracked card index preserves ordering and invalidates on card mutations", () => {
  const raw = {
    s4Assets:{
      cards:{
        low:card("low", "owner-1", "player-1", 1),
        high:card("high", "owner-1", "player-1", 2),
        other:card("other", "owner-1", "player-2", 4),
      },
    },
  };
  const dirtyScopes = [];
  const state = createTrackedState(raw, (scope) => dirtyScopes.push(scope));

  assert.deepEqual(cardsForOwner(state, "owner-1", "player-1").map((entry) => entry.id), ["high", "low"]);
  assert.equal(representativeCard(state, "owner-1", "player-1").id, "high");

  state.s4Assets.cards.low.upgradeLevel = 5;
  assert.equal(representativeCard(state, "owner-1", "player-1").id, "low");

  state.s4Assets.cards.low.ownerId = "owner-2";
  assert.deepEqual(cardsForOwner(state, "owner-1", "player-1").map((entry) => entry.id), ["high"]);
  assert.deepEqual(cardsForOwner(state, "owner-2", "player-1").map((entry) => entry.id), ["low"]);

  state.s4Assets.cards.high.status = "recycled";
  assert.deepEqual(cardsForOwner(state, "owner-1", "player-1"), []);
  assert.deepEqual(cardsForPlayer(state, "player-1").map((entry) => entry.id), ["low"]);
  assert.ok(dirtyScopes.every((scope) => scope === "assets"));
});

test("untracked card states retain the existing uncached query behavior", () => {
  const state = { s4Assets:{ cards:{ first:card("first", "owner", "player", 1) } } };
  assert.equal(representativeCard(state, "owner", "player").id, "first");
  state.s4Assets.cards.first.status = "recycled";
  assert.equal(representativeCard(state, "owner", "player"), null);
});
