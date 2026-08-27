import assert from "node:assert/strict";
import test from "node:test";
import { resolveV2MatchParameters } from "../versus/v2/match-parameters-v2.js";
import { buildV21TacticalShapePreview } from "../versus/v2/tactical-shape-preview-v2.js";

const parameters = resolveV2MatchParameters({ dynamicShape:{ mode:"stable" } });
const slots = [
  ["gk", "GK", 50, 90],
  ["lb", "LB", 12, 70], ["lcb", "CB", 38, 72], ["rcb", "CB", 62, 72], ["rb", "RB", 88, 70],
  ["dm", "DM", 50, 54], ["lm", "LM", 30, 42], ["rm", "RM", 70, 42],
  ["lw", "LW", 15, 20], ["st", "ST", 50, 16], ["rw", "RW", 85, 20],
];
const players = slots.map(([id, role]) => ({ id, name:id, role }));
const positions = Object.fromEntries(slots.map(([id, , x, y]) => [id, { x, y }]));
const roles = Object.fromEntries(slots.map(([id, role]) => [id, role]));

test("V2.1 tactical preview produces three independent shapes from the current preset", () => {
  const preview = buildV21TacticalShapePreview({
    players,
    positions,
    roles,
    plan:{
      tactic:"balanced",
      style:"possession",
      inPossession:"balanced",
      outOfPossession:"balanced",
      inPossessionDetails:{ attackDirection:"leftHalf", chanceCreation:"balanced", longShots:"balanced", crossing:"balanced" },
      outOfPossessionDetails:{ defensiveWidth:"balanced", defenseDirection:"left", marking:"mixed", lineStrategy:"hold" },
      tacticalDimensions:{ tempo:50, directness:50, attackingWidth:50, defensiveLine:50, pressing:50, compactness:55, counterAttack:50, timeWasting:15 },
      playerDuties:{ lb:"invertedFullback", lw:"insideForward" },
    },
    scoreState:"level",
    minute:25,
    parameters,
  });

  assert.equal(preview.attackLane, "leftHalfSpace");
  assert.equal(preview.defenseLane, "rightHalfSpace");
  assert.equal(preview.frames.length, 3);
  assert.deepEqual(preview.frames.map((frame) => frame.phase), ["base", "attack", "defense"]);
  const attack = preview.frames.find((frame) => frame.id === "attack");
  const defense = preview.frames.find((frame) => frame.id === "defense");
  assert.equal(attack.ball.x, 32);
  assert.equal(defense.ball.x, 32);
  assert.equal(attack.players.find((player) => player.id === "lb").tacticalDuty, "invertedFullback");
  assert.ok(attack.players.find((player) => player.id === "st").targetPosition.y < positions.st.y);
  assert.ok(defense.players.find((player) => player.id === "lb").targetPosition.y > positions.lb.y + 6);
  assert.ok(defense.players.find((player) => player.id === "dm").targetPosition.y > positions.dm.y + 8);
  assert.ok(new Set(attack.players.map((player) => Math.round(player.targetPosition.y))).size >= 5, "attacking shape must preserve multiple vertical lines");
  preview.frames.flatMap((frame) => frame.players).forEach((player) => {
    assert.ok(player.targetPosition.x >= 0 && player.targetPosition.x <= 100);
    assert.ok(player.targetPosition.y >= 0 && player.targetPosition.y <= 100);
  });
});
