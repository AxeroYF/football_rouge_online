import assert from "node:assert/strict";
import test from "node:test";
import { ATTRIBUTE_NAMES } from "../game/public/schema.js";
import {
  DEFAULT_IN_POSSESSION_DETAILS,
  DEFAULT_OUT_OF_POSSESSION_DETAILS,
  IN_POSSESSION_DETAIL_OPTIONS,
  OUT_OF_POSSESSION_DETAIL_OPTIONS,
  resolveV2SplitTacticalPlan,
  v2SplitTacticalAdjustments,
} from "../versus/public/v2-tactical-profiles.js";
import { createV2Match, publicV2Match } from "../versus/v2/match-engine-v2.js";
import { v2MarkingDefenderScore, v2MarkingExecutionAdjustment } from "../versus/v2/possession-chain-v2.js";

const LAYOUT = Object.freeze([
  ["GK", 50, 90],
  ["LB", 18, 69], ["CB", 40, 69], ["CB", 60, 69], ["RB", 82, 69],
  ["DM", 35, 47], ["AM", 65, 43],
  ["LW", 18, 19], ["ST", 40, 19], ["ST", 60, 19], ["RW", 82, 19],
]);

function makeTeam(name, options = {}) {
  const players = LAYOUT.map(([role], index) => ({
    id:`${name}-${index}`,
    name:`${name}-${index}`,
    role,
    attributes:Object.fromEntries(ATTRIBUTE_NAMES.map((attribute) => [attribute, 80])),
    state:{ fitness:100 },
  }));
  const positions = Object.fromEntries(LAYOUT.map(([, x, y], index) => [players[index].id, { x, y }]));
  return {
    name,
    players,
    positions,
    tactic:"balanced",
    style:"possession",
    attackFocus:options.attackFocus ?? "balanced",
    defenseFocus:options.defenseFocus ?? "balanced",
    tacticalPlans:options.tacticalPlans,
  };
}

test("V2.1 removes detail selectors that duplicate the eight visible sliders", () => {
  assert.deepEqual(Object.keys(IN_POSSESSION_DETAIL_OPTIONS), ["attackDirection", "chanceCreation", "longShots", "crossing"]);
  assert.deepEqual(Object.keys(OUT_OF_POSSESSION_DETAIL_OPTIONS), ["defensiveWidth", "defenseDirection", "marking", "lineStrategy"]);
  assert.equal(Object.hasOwn(DEFAULT_IN_POSSESSION_DETAILS, "tempo"), false);
  assert.equal(Object.hasOwn(DEFAULT_IN_POSSESSION_DETAILS, "directness"), false);
  assert.equal(Object.hasOwn(DEFAULT_OUT_OF_POSSESSION_DETAILS, "pressing"), false);
  assert.equal(Object.hasOwn(DEFAULT_OUT_OF_POSSESSION_DETAILS, "compactness"), false);
});

test("previous split tactical data remains readable after restoring original style presets", () => {
  assert.deepEqual(resolveV2SplitTacticalPlan({ style:"roughPlay" }), {
    possessionStyle:"balanced",
    defensiveBlock:"midBlock",
    transitionStyle:"balanced",
    duelIntensity:"roughPlay",
  });
  const highCounter = v2SplitTacticalAdjustments({ possessionStyle:"vertical", defensiveBlock:"highPress", transitionStyle:"counterAttack", duelIntensity:"balanced" });
  assert.ok(highCounter.tempo > 0);
  assert.ok(highCounter.directness > 0);
  assert.ok(highCounter.defensiveLine > 0);
  assert.ok(highCounter.pressing > 0);
  assert.ok(highCounter.counterAttack > 0);
});

test("legacy attack and defense focus now enter V2 direction instructions", () => {
  const home = makeTeam("direction", { attackFocus:"right", defenseFocus:"left" });
  const match = createV2Match([home, makeTeam("opponent")], { possessionChains:1, rng:() => .5 });
  assert.equal(match.teams[0].inPossessionDetails.attackDirection, "right");
  assert.equal(match.teams[0].outOfPossessionDetails.defenseDirection, "left");

  const strikerId = home.players[8].id;
  home.tacticalPlans = {
    opening:{
      tactic:"balanced",
      style:"possession",
      possessionStyle:"wingPlay",
      defensiveBlock:"midBlock",
      transitionStyle:"balanced",
      duelIntensity:"balanced",
      positionPreset:"position1",
      inPossessionDetails:{ attackDirection:"center" },
      outOfPossessionDetails:{ defenseDirection:"right" },
      playerDuties:{ [strikerId]:"advancedForward" },
    },
  };
  const explicit = createV2Match([home, makeTeam("explicit-opponent")], { possessionChains:1, rng:() => .5 });
  assert.equal(explicit.teams[0].inPossessionDetails.attackDirection, "center");
  assert.equal(explicit.teams[0].outOfPossessionDetails.defenseDirection, "right");
  assert.equal(publicV2Match(explicit).teams[0].possessionStyle, "wingPlay");
  assert.equal(explicit.teams[0].splitTacticsExplicit, true);
  assert.ok(explicit.teams[0].tacticalDimensions.attackingWidth > 50);
  assert.equal(Number.isFinite(explicit.teams[0].tacticalDimensions.timeWasting), true);
});

test("zonal and man marking select defenders by different abilities and carry matchup risk", () => {
  const manMarker = { metrics:{ marking:96, pace:90, strength:88, tackling:84, decisions:72, positioning:55 } };
  const zonalReader = { metrics:{ marking:62, pace:70, strength:68, tackling:76, decisions:94, positioning:97 } };
  assert.ok(v2MarkingDefenderScore(manMarker, "man") > v2MarkingDefenderScore(zonalReader, "man"));
  assert.ok(v2MarkingDefenderScore(zonalReader, "zonal") > v2MarkingDefenderScore(manMarker, "zonal"));

  const runner = { metrics:{ offBall:65, acceleration:65, agility:65, decisions:65, strength:65 } };
  assert.ok(v2MarkingExecutionAdjustment(runner, manMarker, "man") > 0);
  assert.equal(v2MarkingExecutionAdjustment(runner, manMarker, "mixed"), 0);
});
