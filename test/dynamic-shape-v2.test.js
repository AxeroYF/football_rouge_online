import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ATTRIBUTE_NAMES } from "../game/public/schema.js";
import { buildS4BalanceSeat } from "../versus/s4-balance-report.js";
import {
  buildV21DynamicTeamShape,
  V21_DYNAMIC_SHAPE_MODEL_VERSION,
} from "../versus/v2/dynamic-shape-v2.js";
import { publicV2Match, simulateV2Match } from "../versus/v2/match-engine-v2.js";
import { resolveV2MatchParameters, V2_MATCH_PARAMETERS } from "../versus/v2/match-parameters-v2.js";
import { simulateV2PossessionChain } from "../versus/v2/possession-chain-v2.js";
import { inferElevenBoardRoles } from "../versus/public/formation-rules.js";
import {
  buildV21StageDynamicShapeSnapshot,
  buildV2StageSpatialMatchup,
  buildV2StageSpatialCache,
  resolveV2TacticalDimensions,
} from "../versus/v2/spatial-model-v2.js";

const LAYOUT = Object.freeze([
  ["GK", 50, 90],
  ["LB", 18, 69], ["CB", 40, 69], ["CB", 60, 69], ["RB", 82, 69],
  ["DM", 42, 53], ["CM", 58, 49],
  ["LW", 16, 25], ["AM", 50, 34], ["RW", 84, 25],
  ["ST", 50, 17],
]);
const CANDIDATE_SCENARIO_MATRIX = JSON.parse(readFileSync(new URL("../versus/v2/engine-comparison-v2.1-full-realism-baseline.json", import.meta.url), "utf8")).scenarioMatrix;
const CANDIDATE_DYNAMIC_SHAPE = resolveV2MatchParameters({ dynamicShape:{ mode:"candidate" } }).dynamicShape;

function makeTeam(name) {
  const players = LAYOUT.map(([role], index) => ({
    id:`${name}-${index}`,
    name:`${name}-${index}`,
    role,
    preferredFoot:"both",
    attributes:Object.fromEntries(ATTRIBUTE_NAMES.map((attribute) => [attribute, 80])),
    state:{ fitness:100 },
  }));
  return {
    name,
    tactic:"balanced",
    style:"possession",
    players,
    positions:Object.fromEntries(LAYOUT.map(([, x, y], index) => [players[index].id, { x, y }])),
    spatialRoles:Object.fromEntries(players.map((player) => [player.id, player.role])),
  };
}

function buildShape(team, options = {}) {
  return buildV21DynamicTeamShape({
    team,
    teamIndex:options.teamIndex ?? 0,
    attackingTeamIndex:options.attackingTeamIndex ?? 0,
    stage:options.stage ?? "shot",
    roles:team.spatialRoles,
    dimensions:resolveV2TacticalDimensions(team.tactic, team.style),
    ballLane:options.ballLane ?? "rightHalfSpace",
    possessionType:options.possessionType ?? "normal",
    config:options.config ?? CANDIDATE_DYNAMIC_SHAPE,
  });
}

function playerByRole(shape, role) {
  return shape.players.find((player) => player.assignedRole === role);
}

test("V2.1 stable is the default dynamic mode and keeps candidate isolated", () => {
  assert.equal(resolveV2MatchParameters().dynamicShape.mode, "stable");
  assert.equal(resolveV2MatchParameters({ dynamicShape:{ mode:"candidate" } }).dynamicShape.mode, "candidate");
  assert.throws(
    () => resolveV2MatchParameters({ dynamicShape:{ mode:"active" } }),
    /dynamicShape\.mode/,
  );
});

test("V2.1d candidate spatial matchup uses resolved dynamic positions exactly once", () => {
  const teams = [makeTeam("candidate-home"), makeTeam("candidate-away")];
  const parameters = resolveV2MatchParameters({ dynamicShape:{ mode:"candidate" } });
  const candidate = buildV2StageSpatialMatchup(teams, 0, "chance", {
    parameters,
    parametersResolved:true,
    ballLane:"farRight",
    possessionType:"transition",
  });
  const stable = buildV2StageSpatialMatchup(teams, 0, "chance", { parameters:{ dynamicShape:{ mode:"off" } }, ballLane:"farRight" });

  assert.equal(candidate.modelVersion, "spatial-v2.1d-candidate.4");
  assert.equal(candidate.stableModelVersion, stable.modelVersion);
  for (const team of candidate.teams) {
    const targets = Object.fromEntries(candidate.dynamicShape.teams[team.teamIndex].players.map((player) => [player.id, player.targetPosition]));
    for (const player of team.players) assert.deepEqual(player.localPosition, targets[player.id]);
  }
  assert.notDeepEqual(candidate.teams[0].players.map((player) => player.localPosition), stable.teams[0].players.map((player) => player.localPosition));
});

test("V2.1d candidate chain applies lane-aware dynamic spatial stages", () => {
  const parameters = resolveV2MatchParameters({ dynamicShape:{ mode:"candidate", diagnostics:{ sampleEveryChains:1 } } });
  const chain = simulateV2PossessionChain([makeTeam("candidate-chain-home"), makeTeam("candidate-chain-away")], {
    parameters,
    chainIndex:0,
    rng:() => 0,
    recordRandomRolls:true,
  });

  assert.ok(chain.stages.length > 1);
  assert.ok(chain.stages.slice(1).every((stage) => stage.stageSpatialModelVersion === "spatial-v2.1d-candidate.4"));
  assert.ok(chain.stages.slice(1).every((stage) => stage.dynamicShape?.ballLane === stage.zone.split(":")[1]));
});

test("V2.1 stable blends constrained collective movement into the calibrated stage shape", () => {
  const teams = [makeTeam("stable-home"), makeTeam("stable-away")];
  const stable = buildV2StageSpatialMatchup(teams, 0, "chance", {
    ballLane:"farRight",
    possessionType:"transition",
  });
  const off = buildV2StageSpatialMatchup(teams, 0, "chance", {
    parameters:{ dynamicShape:{ mode:"off" } },
    ballLane:"farRight",
    possessionType:"transition",
  });

  assert.equal(stable.modelVersion, "spatial-v2.1-stable-dynamic.2");
  assert.equal(stable.dynamicShape.mode, "stable");
  assert.equal(stable.stableModelVersion, off.modelVersion);
  assert.notDeepEqual(stable.teams[0].players.map((player) => player.localPosition), off.teams[0].players.map((player) => player.localPosition));
  for (const team of stable.dynamicShape.teams) {
    assert.ok(team.metrics.maximumDisplacement <= V2_MATCH_PARAMETERS.dynamicShape.maximumPlayerDisplacement);
    const targets = Object.fromEntries(team.players.map((player) => [player.id, player.targetPosition]));
    stable.teams[team.teamIndex].players.forEach((player) => assert.deepEqual(player.localPosition, targets[player.id]));
  }
});

test("V2.1d dynamic shape is deterministic and does not mutate its team input", () => {
  const team = makeTeam("deterministic");
  const original = structuredClone(team);
  const first = buildShape(team);
  const second = buildShape(team);

  assert.deepEqual(first, second);
  assert.deepEqual(team, original);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.players[0].targetPosition), true);
});

test("V2.1d advances the ball-side fullback while the far-side fullback tucks in", () => {
  const team = makeTeam("fullbacks");
  const shape = buildShape(team, { ballLane:"rightHalfSpace" });
  const leftBack = playerByRole(shape, "LB");
  const rightBack = playerByRole(shape, "RB");

  assert.ok(rightBack.targetPosition.y < leftBack.targetPosition.y - 4);
  assert.ok(Math.abs(leftBack.targetPosition.x - 50) < Math.abs(leftBack.basePosition.x - 50));
  assert.ok(rightBack.displacement > 0);
});

test("V2.1d defensive midfielder follows the ball side without a fixed advance line", () => {
  const shape = buildShape(makeTeam("cover"), { stage:"shot", ballLane:"rightHalfSpace" });
  const defensiveMidfielder = playerByRole(shape, "DM");

  assert.ok(defensiveMidfielder.targetPosition.x > defensiveMidfielder.basePosition.x);
  assert.ok(defensiveMidfielder.displacement > 0);
});

test("V2.1d ignores tactical hard locks while retaining physical pitch boundaries", () => {
  const team = makeTeam("unrestricted-runs");
  const config = structuredClone(V2_MATCH_PARAMETERS.dynamicShape);
  config.restrictionsEnabled = false;
  config.minimumPlayerDistance = 95;
  config.maximumPlayerDisplacement = 0.1;
  config.restDefense.protectionLineY = 99;
  const shape = buildV21DynamicTeamShape({
    team,
    teamIndex:0,
    attackingTeamIndex:0,
    stage:"shot",
    roles:team.spatialRoles,
    dimensions:resolveV2TacticalDimensions(team.tactic, team.style),
    ballLane:"rightHalfSpace",
    possessionType:"transition",
    config,
  });

  assert.ok(shape.metrics.maximumDisplacement > config.maximumPlayerDisplacement);
  assert.ok(shape.metrics.minimumPairDistance < config.minimumPlayerDistance);
  assert.ok(shape.players.every((player) => player.targetPosition.x >= config.pitchBounds.minimumX && player.targetPosition.x <= config.pitchBounds.maximumX
    && player.targetPosition.y >= config.pitchBounds.minimumY && player.targetPosition.y <= config.pitchBounds.maximumY));
});

test("V2.1d transition shape accelerates attacking runs and defensive recovery", () => {
  const attackingTeam = makeTeam("transition-attack");
  const defendingTeam = makeTeam("transition-defense");
  const normalAttack = buildShape(attackingTeam, { stage:"chance", possessionType:"normal" });
  const transitionAttack = buildShape(attackingTeam, { stage:"chance", possessionType:"transition" });
  const normalDefense = buildShape(defendingTeam, { teamIndex:1, attackingTeamIndex:0, stage:"chance", possessionType:"normal" });
  const transitionDefense = buildShape(defendingTeam, { teamIndex:1, attackingTeamIndex:0, stage:"chance", possessionType:"transition" });

  assert.ok(playerByRole(transitionAttack, "CM").targetPosition.y < playerByRole(normalAttack, "CM").targetPosition.y);
  assert.ok(playerByRole(transitionAttack, "CM").basePosition.y - playerByRole(transitionAttack, "CM").targetPosition.y > 15);
  assert.ok(playerByRole(transitionDefense, "CB").targetPosition.y - playerByRole(transitionDefense, "CB").basePosition.y > 5);
  assert.ok(playerByRole(transitionDefense, "CB").targetPosition.y > playerByRole(normalDefense, "CB").targetPosition.y);
});

test("V2.1 stable phase two moves late trailing and leading shapes in opposite directions", () => {
  const trailingTeam = makeTeam("late-trailing");
  trailingTeam.v2Snapshot = { minute:85, scoreState:"trailing" };
  const levelTeam = makeTeam("late-level");
  levelTeam.v2Snapshot = { minute:85, scoreState:"level" };
  const leadingTeam = makeTeam("late-leading");
  leadingTeam.v2Snapshot = { minute:85, scoreState:"leading" };
  const trailingAttack = buildShape(trailingTeam, { stage:"chance", config:V2_MATCH_PARAMETERS.dynamicShape });
  const levelAttack = buildShape(levelTeam, { stage:"chance", config:V2_MATCH_PARAMETERS.dynamicShape });
  const leadingDefense = buildShape(leadingTeam, { teamIndex:1, attackingTeamIndex:0, stage:"chance", config:V2_MATCH_PARAMETERS.dynamicShape });
  const levelDefense = buildShape(levelTeam, { teamIndex:1, attackingTeamIndex:0, stage:"chance", config:V2_MATCH_PARAMETERS.dynamicShape });

  assert.equal(trailingAttack.context.scoreState, "trailing");
  assert.ok(trailingAttack.context.matchStateProgress > 0.8);
  assert.ok(trailingAttack.metrics.centroid.y < levelAttack.metrics.centroid.y);
  assert.ok(trailingAttack.metrics.width > levelAttack.metrics.width);
  assert.ok(leadingDefense.metrics.centroid.y > levelDefense.metrics.centroid.y);
  assert.ok(leadingDefense.metrics.width < levelDefense.metrics.width);
});

test("V2.1 stable phase two narrows transition recovery by role", () => {
  const team = makeTeam("phase-two-recovery");
  team.v2Snapshot = { minute:70, scoreState:"level" };
  const normal = buildShape(team, { teamIndex:1, attackingTeamIndex:0, stage:"chance", possessionType:"normal", config:V2_MATCH_PARAMETERS.dynamicShape });
  const transition = buildShape(team, { teamIndex:1, attackingTeamIndex:0, stage:"chance", possessionType:"transition", config:V2_MATCH_PARAMETERS.dynamicShape });

  assert.equal(transition.context.transitionRecovery, true);
  assert.ok(transition.metrics.width < normal.metrics.width);
  assert.ok(playerByRole(transition, "CB").targetPosition.y > playerByRole(normal, "CB").targetPosition.y);
  assert.ok(playerByRole(transition, "CB").targetPosition.y - playerByRole(normal, "CB").targetPosition.y
    > playerByRole(transition, "ST").targetPosition.y - playerByRole(normal, "ST").targetPosition.y);
});

test("V2.1 stable phase two compacts and retreats after losing a central player", () => {
  const fullTeam = makeTeam("full-strength");
  const shortTeam = makeTeam("short-handed");
  shortTeam.players.find((player) => player.role === "AM").active = false;
  fullTeam.v2Snapshot = { minute:72, scoreState:"level" };
  shortTeam.v2Snapshot = { minute:72, scoreState:"level" };
  const fullShape = buildShape(fullTeam, { teamIndex:1, attackingTeamIndex:0, stage:"finalThird", config:V2_MATCH_PARAMETERS.dynamicShape });
  const shortShape = buildShape(shortTeam, { teamIndex:1, attackingTeamIndex:0, stage:"finalThird", config:V2_MATCH_PARAMETERS.dynamicShape });

  assert.equal(shortShape.context.activeCount, 10);
  assert.equal(shortShape.context.missingPlayers, 1);
  assert.ok(shortShape.metrics.width < fullShape.metrics.width);
  assert.ok(shortShape.metrics.centroid.y > fullShape.metrics.centroid.y);
  assert.ok(shortShape.metrics.maximumDisplacement <= V2_MATCH_PARAMETERS.dynamicShape.maximumPlayerDisplacement);
});

test("V2.1d produces finite positions inside the physical pitch", () => {
  const shape = buildShape(makeTeam("bounds"), { ballLane:"farRight" });
  const bounds = V2_MATCH_PARAMETERS.dynamicShape.pitchBounds;
  for (const player of shape.players) {
    assert.ok(Number.isFinite(player.targetPosition.x));
    assert.ok(Number.isFinite(player.targetPosition.y));
    assert.ok(player.targetPosition.x >= bounds.minimumX && player.targetPosition.x <= bounds.maximumX);
    assert.ok(player.targetPosition.y >= bounds.minimumY && player.targetPosition.y <= bounds.maximumY);
  }
});

test("V2.1d unrestricted late-wide scenario matrix remains inside the physical pitch", () => {
  const formations = ["4-3-3", "4-2-3-1", "3-4-3", "3-5-2", "5-3-2"];
  const tactics = ["allOutAttack", "positive", "balanced", "defensive", "parkBus"];
  const styles = ["possession", "longBall", "wingPlay", "counterAttack", "highPress", "lowBlock", "roughPlay"];
  const bounds = V2_MATCH_PARAMETERS.dynamicShape.pitchBounds;
  for (const formation of formations) {
    for (const tactic of tactics) {
      for (const style of styles) {
        const team = buildS4BalanceSeat(`v21d-r2:${formation}:${tactic}:${style}`, "home", "standard", { formation, tactic, style, staticPlans:true });
        const roles = inferElevenBoardRoles(team.players.map((player) => ({ id:player.id, position:team.positions[player.id] })), team.formationLines);
        for (const stage of ["chance", "shot"]) {
          for (const ballLane of ["farLeft", "farRight"]) {
            for (const possessionType of ["normal", "transition"]) {
              const attack = buildV21DynamicTeamShape({
                team,
                teamIndex:0,
                attackingTeamIndex:0,
                stage,
                roles,
                dimensions:resolveV2TacticalDimensions(team.tactic, team.style),
                ballLane,
                possessionType,
                config:V2_MATCH_PARAMETERS.dynamicShape,
              });
              const defense = buildV21DynamicTeamShape({
                team,
                teamIndex:1,
                attackingTeamIndex:0,
                stage,
                roles,
                dimensions:resolveV2TacticalDimensions(team.tactic, team.style),
                ballLane,
                possessionType,
                config:V2_MATCH_PARAMETERS.dynamicShape,
              });
              for (const shape of [attack, defense]) {
                assert.ok(shape.players.every((player) => player.targetPosition.x >= bounds.minimumX && player.targetPosition.x <= bounds.maximumX && player.targetPosition.y >= bounds.minimumY && player.targetPosition.y <= bounds.maximumY));
              }
            }
          }
        }
      }
    }
  }
});

test("V2.1d candidate geometry remains safe across every controlled and extreme formation", () => {
  const profileIds = ["baseline-balanced", "positive-possession", "allout-highpress", "parkbus-lowblock"];
  for (const [formation, definition] of Object.entries(CANDIDATE_SCENARIO_MATRIX.formations)) {
    for (const profileId of profileIds) {
      const profile = CANDIDATE_SCENARIO_MATRIX.profiles[profileId];
      const team = buildS4BalanceSeat(`v21d-candidate:${formation}:${profileId}`, "home", "standard", {
        formation,
        formationSlots:definition.slots,
        formationLines:definition.formationLines,
        tactic:profile.tactic,
        style:profile.style,
        tacticalDimensions:profile.tacticalDimensions,
        lockTacticalProfile:true,
      });
      const roles = inferElevenBoardRoles(team.players.map((player) => ({ id:player.id, position:team.positions[player.id] })), team.formationLines);
      for (const attacking of [true, false]) {
        const shape = buildV21DynamicTeamShape({
          team,
          teamIndex:attacking ? 0 : 1,
          attackingTeamIndex:0,
          stage:"shot",
          roles,
          dimensions:resolveV2TacticalDimensions(team.tactic, team.style, team.tacticalDimensions),
          ballLane:"farRight",
          possessionType:"transition",
          config:V2_MATCH_PARAMETERS.dynamicShape,
        });
        assert.ok(shape.players.every((player) => Number.isFinite(player.targetPosition.x) && Number.isFinite(player.targetPosition.y)));
      }
    }
  }
});

test("V2.1d attacking shapes remain symmetric when the attacking team index is swapped", () => {
  const home = makeTeam("mirror-home");
  const away = makeTeam("mirror-away");
  const homeShape = buildShape(home, { teamIndex:0, attackingTeamIndex:0, ballLane:"leftHalfSpace" });
  const awayShape = buildShape(away, { teamIndex:1, attackingTeamIndex:1, ballLane:"leftHalfSpace" });
  const simplify = (shape) => shape.players.map((player) => ({ role:player.assignedRole, position:player.targetPosition }));

  assert.deepEqual(simplify(homeShape), simplify(awayShape));
});

test("V2.1d left and right ball lanes produce mirrored wide-player movements", () => {
  const teams = [makeTeam("lane-home"), makeTeam("lane-away")];
  const left = buildV21StageDynamicShapeSnapshot(teams, 0, "chance", { ballLane:"farLeft" });
  const right = buildV21StageDynamicShapeSnapshot(teams, 0, "chance", { ballLane:"farRight" });
  const leftBackOnLeft = playerByRole(left.teams[0], "LB");
  const rightBackOnRight = playerByRole(right.teams[0], "RB");
  const rightBackOnLeft = playerByRole(left.teams[0], "RB");
  const leftBackOnRight = playerByRole(right.teams[0], "LB");

  assert.ok(Math.abs(leftBackOnLeft.targetPosition.x + rightBackOnRight.targetPosition.x - 100) < 0.01);
  assert.ok(Math.abs(rightBackOnLeft.targetPosition.x + leftBackOnRight.targetPosition.x - 100) < 0.01);
  assert.equal(leftBackOnLeft.targetPosition.y, rightBackOnRight.targetPosition.y);
  assert.equal(rightBackOnLeft.targetPosition.y, leftBackOnRight.targetPosition.y);
  assert.ok(Math.abs(left.teams[0].metrics.centroid.x + right.teams[0].metrics.centroid.x - 100) < 0.01);
  assert.equal(left.teams[0].metrics.width, right.teams[0].metrics.width);
  assert.equal(left.teams[0].metrics.restDefenseCount, right.teams[0].metrics.restDefenseCount);
});

test("shadow mode adds diagnostics without changing the stable V2.1 spatial result", () => {
  const teams = [makeTeam("shadow-home"), makeTeam("shadow-away")];
  const shadow = buildV2StageSpatialMatchup(teams, 0, "chance", { parameters:{ dynamicShape:{ mode:"shadow" } }, ballLane:"rightHalfSpace" });
  const off = buildV2StageSpatialMatchup(teams, 0, "chance", { parameters:{ dynamicShape:{ mode:"off" } } });
  const { dynamicShape, ...stableShadowResult } = shadow;

  assert.equal(dynamicShape.mode, "shadow");
  assert.equal(dynamicShape.modelVersion, V21_DYNAMIC_SHAPE_MODEL_VERSION);
  assert.equal(dynamicShape.ballLane, "rightHalfSpace");
  assert.deepEqual(stableShadowResult, off);
});

test("V2.1d possession stages use the lane of the actual routed zone", () => {
  const teams = [makeTeam("route-home"), makeTeam("route-away")];
  const parameters = resolveV2MatchParameters({ dynamicShape:{ mode:"shadow" } });
  const cache = buildV2StageSpatialCache(teams, { parameters });
  const chain = simulateV2PossessionChain(teams, { parameters, stageSpatials:cache, rng:() => 0, recordRandomRolls:true });

  assert.ok(Object.values(cache[0]).every((stage) => !Object.hasOwn(stage, "dynamicShape")));
  for (const stage of chain.stages.slice(1)) {
    assert.equal(stage.dynamicShape.ballLane, stage.zone.split(":")[1]);
    assert.equal(stage.dynamicShape.stage, stage.stage);
    assert.equal(stage.dynamicShape.possessionType, chain.possessionType);
    assert.equal(stage.dynamicShape.teams.length, 2);
    assert.equal(typeof stage.dynamicShape.teams[0].formation, "string");
    assert.ok(stage.dynamicShape.teams.every((team) => Number.isFinite(team.dynamic.centroid.x)));
    assert.ok(stage.dynamicShape.teams.every((team) => Number.isFinite(team.stable.centroid.x)));
    assert.ok(stage.dynamicShape.teams.every((team) => Number.isFinite(team.delta.width)));
    assert.equal(Object.hasOwn(stage.dynamicShape.teams[0], "players"), false);
  }
});

test("V2.1d samples compact chain diagnostics without retaining every chain", () => {
  const teams = [makeTeam("sample-home"), makeTeam("sample-away")];
  const parameters = resolveV2MatchParameters({ dynamicShape:{ mode:"shadow" } });
  const sampled = simulateV2PossessionChain(teams, { parameters, chainIndex:10, rng:() => 0 });
  const skipped = simulateV2PossessionChain(teams, { parameters, chainIndex:11, rng:() => 0 });

  assert.ok(sampled.stages.slice(1).every((stage) => stage.dynamicShape));
  assert.ok(skipped.stages.slice(1).every((stage) => !Object.hasOwn(stage, "dynamicShape")));
});

test("shadow and off modes produce the same seeded V2.1 match result", () => {
  const teams = [
    buildS4BalanceSeat("v21d-shadow-result", "home", "standard"),
    buildS4BalanceSeat("v21d-shadow-result", "away", "standard"),
  ];
  const common = {
    events:{ injuryPerChain:0, blackWhistlePerMatch:0 },
    environment:{ weatherEventPerChain:{ sunny:0, rain:0, storm:0, snow:0 } },
  };
  const shadowParameters = resolveV2MatchParameters({ ...common, dynamicShape:{ mode:"shadow" } });
  const offParameters = resolveV2MatchParameters({ ...common, dynamicShape:{ mode:"off" } });
  const options = { seed:"v21d-shadow-result", possessionChains:12 };
  const shadow = publicV2Match(simulateV2Match(structuredClone(teams), { ...options, parameters:shadowParameters }));
  const off = publicV2Match(simulateV2Match(structuredClone(teams), { ...options, parameters:offParameters }));

  assert.deepEqual(shadow, off);
});
