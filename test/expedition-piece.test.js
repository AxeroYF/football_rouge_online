import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelExpeditionMovement,
  estimateExpeditionMove,
  expeditionAttackSource,
  expeditionMoveDuration,
  moveExpeditionPiece,
  normalizeExpeditionPiece,
  publicExpeditionPiece,
} from "../server/domain/expedition-piece.mjs";

function setup() {
  const account = { id: "player", homeTerritoryId: "home", expeditionPiece: null };
  const world = {
    players: {
      player: {
        capitalTerritoryId: "home",
        territoryIds: ["home", "near", "far"],
      },
    },
  };
  const territoryIndex = {
    territories: [
      { territoryId: "home", centroid: [0, 0] },
      { territoryId: "near", centroid: [1, 0] },
      { territoryId: "far", centroid: [100, 0] },
      { territoryId: "enemy", centroid: [2, 0] },
    ],
  };
  return { account, world, territoryIndex };
}

test("expedition piece starts at the capital and moves only within owned territory", () => {
  const { account, world, territoryIndex } = setup();
  const normalized = normalizeExpeditionPiece(account, world, 1_000);
  assert.equal(normalized.changed, true);
  assert.equal(normalized.piece.territoryId, "home");
  assert.equal(publicExpeditionPiece(account, world, 1_000).tokenUrl, "./assets/expedition-tokens/default.png");
  assert.throws(() => moveExpeditionPiece({
    account,
    world,
    territoryIndex,
    targetTerritoryId: "enemy",
    now: 1_000,
  }), /只能移动到你的领土/);

  const moving = moveExpeditionPiece({
    account,
    world,
    territoryIndex,
    targetTerritoryId: "near",
    now: 1_000,
  });
  assert.equal(moving.moving, true);
  assert.equal(moving.territoryId, "home");
  assert.equal(moving.movement.durationMs, 60_000);
  assert.throws(() => expeditionAttackSource(account, world, 2_000), /正在行军/);

  assert.equal(publicExpeditionPiece(account, world, 60_999).territoryId, "home");
  assert.equal(publicExpeditionPiece(account, world, 61_000).territoryId, "near");
  assert.equal(expeditionAttackSource(account, world, 61_000), "near");
});

test("expedition movement duration is clamped to one through ten minutes", () => {
  assert.equal(expeditionMoveDuration(1), 60_000);
  assert.equal(expeditionMoveDuration(251), 120_000);
  assert.equal(expeditionMoveDuration(100_000), 600_000);
});

test("expedition movement can be estimated without mutation and canceled back at its departure", () => {
  const {account,world,territoryIndex}=setup();
  normalizeExpeditionPiece(account,world,1_000);
  const estimate=estimateExpeditionMove({account,world,territoryIndex,targetTerritoryId:"far",now:1_000});
  assert.equal(estimate.fromTerritoryId,"home");
  assert.equal(estimate.toTerritoryId,"far");
  assert.equal(estimate.durationMs,600_000);
  assert.equal(account.expeditionPiece.movement,null);
  moveExpeditionPiece({account,world,territoryIndex,targetTerritoryId:"far",now:1_000});
  const canceled=cancelExpeditionMovement(account,world,2_000);
  assert.equal(canceled.piece.moving,false);
  assert.equal(canceled.piece.territoryId,"home");
  assert.equal(canceled.canceledMovement.toTerritoryId,"far");
  assert.throws(()=>cancelExpeditionMovement(account,world,3_000),/没有移动任务/);
});
