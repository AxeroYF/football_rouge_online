import assert from "node:assert/strict";
import test from "node:test";
import { ATTRIBUTE_NAMES } from "../game/public/schema.js";
import { V2_PLAYER_DUTY_OPTIONS, v2PlayerDutyOptionsForRole } from "../versus/public/v2-player-duty-options.js";
import { buildV21DynamicTeamShape } from "../versus/v2/dynamic-shape-v2.js";
import { advanceV2Match, createV2Match, publicV2Match } from "../versus/v2/match-engine-v2.js";
import { resolveV2MatchParameters } from "../versus/v2/match-parameters-v2.js";
import {
  resolveV2PlayerDuty,
  V2_PLAYER_DUTIES,
  v2DutyFatigueMultiplier,
  v2DutyOffsideMultiplier,
  v2DutyStageMultiplier,
} from "../versus/v2/player-duties-v2.js";
import { simulateV2PossessionChain } from "../versus/v2/possession-chain-v2.js";
import { resolveV2TacticalDimensions } from "../versus/v2/spatial-model-v2.js";

const LAYOUT = Object.freeze([
  ["GK", 50, 90],
  ["LB", 18, 69], ["CB", 40, 69], ["CB", 60, 69], ["RB", 82, 69],
  ["DM", 35, 47], ["AM", 65, 43],
  ["LW", 18, 19], ["ST", 40, 19], ["ST", 60, 19], ["RW", 82, 19],
]);

function makePlayer(id, role, tacticalDuty = null) {
  return {
    id,
    name:id,
    role,
    preferredFoot:"both",
    tacticalDuty,
    attributes:Object.fromEntries(ATTRIBUTE_NAMES.map((attribute) => [attribute, 80])),
    state:{ fitness:100 },
  };
}

function makeTeam(name, options = {}) {
  const players = LAYOUT.map(([role], index) => makePlayer(`${name}-${index}`, role, options.duties?.[index] ?? null));
  const positions = Object.fromEntries(LAYOUT.map(([, x, y], index) => [players[index].id, { x, y }]));
  return {
    name,
    players,
    positions,
    positionPresets:{ position1:structuredClone(positions), position2:structuredClone(positions), position3:structuredClone(positions) },
    tactic:options.tactic ?? "balanced",
    style:options.style ?? "possession",
    tacticalDimensions:options.tacticalDimensions,
    inPossessionDetails:options.inPossessionDetails,
    outOfPossessionDetails:options.outOfPossessionDetails,
  };
}

function quietParameters(overrides = {}) {
  return resolveV2MatchParameters({
    events:{ injuryPerChain:0, blackWhistlePerMatch:0 },
    environment:{ weatherEventPerChain:{ sunny:0, rain:0, storm:0, snow:0 } },
    ...overrides,
  });
}

test("V2.1职责注册表覆盖首批非门将职责并拒绝跨位置配置", () => {
  assert.equal(Object.keys(V2_PLAYER_DUTIES).length, 19);
  assert.deepEqual(Object.keys(V2_PLAYER_DUTIES), Object.keys(V2_PLAYER_DUTY_OPTIONS));
  Object.entries(V2_PLAYER_DUTIES).forEach(([id, definition]) => {
    assert.equal(definition.label, V2_PLAYER_DUTY_OPTIONS[id].label);
    assert.deepEqual(definition.roles, V2_PLAYER_DUTY_OPTIONS[id].roles);
    assert.ok(V2_PLAYER_DUTY_OPTIONS[id].description.length > 8);
  });
  assert.deepEqual(v2PlayerDutyOptionsForRole("GK").map((option) => option.id), [""]);
  assert.deepEqual(v2PlayerDutyOptionsForRole("LWB").map((option) => option.id), ["", "holdingFullback", "overlappingFullback", "invertedFullback"]);
  assert.equal(resolveV2PlayerDuty("ST", "targetForward"), "targetForward");
  assert.equal(resolveV2PlayerDuty("LWB", "overlappingFullback"), "overlappingFullback");
  assert.equal(resolveV2PlayerDuty("DM", "advancedForward"), null);
  assert.equal(resolveV2PlayerDuty("GK", "coverDefender"), null);
  assert.ok(Object.values(V2_PLAYER_DUTIES).every((definition) => !definition.roles.includes("GK")));
});

test("V2.1边后卫职责产生不同的纵向与横向动态站位", () => {
  const config = quietParameters({ dynamicShape:{ mode:"candidate" } }).dynamicShape;
  const shapeFor = (tacticalDuty) => {
    const team = makeTeam(tacticalDuty, { duties:{ 1:tacticalDuty } });
    const roles = Object.fromEntries(team.players.map((player) => [player.id, player.role]));
    return buildV21DynamicTeamShape({
      team,
      teamIndex:0,
      attackingTeamIndex:0,
      stage:"shot",
      roles,
      dimensions:resolveV2TacticalDimensions("balanced", "possession"),
      ballLane:"farLeft",
      possessionType:"normal",
      config,
    }).players.find((player) => player.assignedRole === "LB");
  };

  const holding = shapeFor("holdingFullback");
  const overlapping = shapeFor("overlappingFullback");
  const inverted = shapeFor("invertedFullback");
  assert.ok(overlapping.targetPosition.y < holding.targetPosition.y - 10);
  assert.ok(Math.abs(inverted.targetPosition.x - 50) < Math.abs(overlapping.targetPosition.x - 50));
  assert.equal(overlapping.tacticalDuty, "overlappingFullback");
});

test("V2.1支点中锋会接应直接进攻并为下一名球员做球", () => {
  const chain = simulateV2PossessionChain([
    makeTeam("target", { duties:{ 8:"targetForward", 9:"targetForward" }, style:"longBall", tacticalDimensions:{ directness:95 } }),
    makeTeam("opponent"),
  ], { rng:() => 0, recordRandomRolls:true });

  const holdUp = chain.stages.find((stage) => stage.dutyAction === "targetHoldUp");
  const layoff = chain.stages.find((stage) => stage.dutyAction === "targetLayoff");
  assert.equal(holdUp.actor.tacticalDuty, "targetForward");
  assert.equal(holdUp.connection.routeType, "direct");
  assert.notEqual(layoff.actor.id, holdUp.actor.id);
  assert.ok(v2DutyStageMultiplier({ assignedRole:"ST", tacticalDuty:"targetForward" }, "progression", { routeType:"direct" }) > 2);
});

test("V2.1三阶段战术切换会同步切换球员职责并进入公开比赛状态", () => {
  const home = makeTeam("home");
  const away = makeTeam("away");
  const strikerId = home.players[8].id;
  home.tacticalPlans = {
    opening:{ tactic:"balanced", style:"possession", positionPreset:"position1", playerDuties:{ [strikerId]:"advancedForward" } },
    leading:{ tactic:"defensive", style:"counterAttack", positionPreset:"position2", triggerGoalDifference:1, playerDuties:{ [strikerId]:"targetForward" } },
    trailing:{ tactic:"positive", style:"possession", positionPreset:"position3", triggerGoalDifference:1, playerDuties:{ [strikerId]:"deepLyingForward" } },
  };
  const match = createV2Match([home, away], { possessionChains:4, parameters:quietParameters(), rng:() => .99 });
  assert.equal(match.teams[0].players.find((player) => player.id === strikerId).tacticalDuty, "advancedForward");

  match.teams[0].score = 1;
  advanceV2Match(match, 1);
  assert.equal(match.teams[0].activePlan, "leading");
  assert.equal(match.teams[0].players.find((player) => player.id === strikerId).tacticalDuty, "targetForward");
  assert.equal(publicV2Match(match).teams[0].players.find((player) => player.id === strikerId).tacticalDuty, "targetForward");
});

test("高活动职责承担更高体能成本而默认职责保持1倍", () => {
  assert.equal(v2DutyFatigueMultiplier({ assignedRole:"LB" }), 1);
  assert.ok(v2DutyFatigueMultiplier({ assignedRole:"LB", tacticalDuty:"overlappingFullback" }) > v2DutyFatigueMultiplier({ assignedRole:"LB", tacticalDuty:"holdingFullback" }));
  assert.ok(v2DutyFatigueMultiplier({ assignedRole:"DM", tacticalDuty:"ballWinningMidfielder" }) > 1);
  assert.ok(v2DutyOffsideMultiplier({ assignedRole:"ST", tacticalDuty:"advancedForward" }) > v2DutyOffsideMultiplier({ assignedRole:"ST", tacticalDuty:"deepLyingForward" }));
});

test("V2.1 injury substitution inherits the outgoing player's tactical duty", () => {
  const home = makeTeam("duty-sub");
  const away = makeTeam("opponent");
  const target = home.players[8];
  const substitute = {
    ...structuredClone(target),
    id:"duty-substitute",
    name:"duty-substitute",
    active:false,
    state:{ fitness:100 },
  };
  home.players = [target, ...home.players.filter((player) => player.id !== target.id), substitute];
  home.tacticalPlans = {
    opening:{ tactic:"balanced", style:"longBall", positionPreset:"position1", playerDuties:{ [target.id]:"targetForward" } },
  };

  const match = createV2Match([home, away], {
    possessionChains:1,
    parameters:quietParameters({ events:{ injuryPerChain:1, blackWhistlePerMatch:0 } }),
    rng:() => 0,
  });
  advanceV2Match(match, 1);

  const substitution = match.events.find((event) => event.type === "substitution");
  assert.equal(match.teams[0].players.find((player) => player.id === target.id).active, false);
  assert.equal(match.teams[0].players.find((player) => player.id === substitute.id).tacticalDuty, "targetForward");
  assert.equal(substitution.tacticalDuty, "targetForward");
});
