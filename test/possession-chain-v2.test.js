import assert from "node:assert/strict";
import test from "node:test";
import { ATTRIBUTE_NAMES } from "../game/public/schema.js";
import { simulateV2PossessionChain } from "../versus/v2/possession-chain-v2.js";
import { buildV2SpatialMatchup, buildV2StageSpatialCache } from "../versus/v2/spatial-model-v2.js";

const ROLE_LAYOUT = Object.freeze([
  ["GK", 50, 90],
  ["LB", 18, 69], ["CB", 40, 69], ["CB", 60, 69], ["RB", 82, 69],
  ["DM", 35, 47], ["AM", 65, 43],
  ["LW", 18, 19], ["ST", 40, 19], ["ST", 60, 19], ["RW", 82, 19],
]);

function makePlayer(id, role, value = 80) {
  return {
    id,
    name:id,
    role,
    preferredFoot:"both",
    attributes:Object.fromEntries(ATTRIBUTE_NAMES.map((attribute) => [attribute, value])),
    state:{ fitness:100 },
  };
}

function makeTeam(name, options = {}) {
  const players = ROLE_LAYOUT.map(([role], index) => makePlayer(`${name}-${index}`, role, options.value ?? 80));
  return {
    name,
    players,
    positions:Object.fromEntries(ROLE_LAYOUT.map(([, x, y], index) => [players[index].id, { x, y }])),
    tactic:options.tactic ?? "balanced",
    style:options.style ?? "possession",
    tacticalDimensions:options.tacticalDimensions,
    inPossessionDetails:options.inPossessionDetails,
    outOfPossessionDetails:options.outOfPossessionDetails,
  };
}

function sequenceRng(values, fallback = 0) {
  let index = 0;
  return () => values[index++] ?? fallback;
}

test("V2控球链按六阶段沿区域连接完成一次进攻", () => {
  const teams = [makeTeam("home"), makeTeam("away")];
  const chain = simulateV2PossessionChain(teams, { rng:() => 0, recordRandomRolls:true });

  assert.deepEqual(chain.stages.map((stage) => stage.stage), ["possession", "buildUp", "progression", "finalThird", "chance", "shot"]);
  assert.deepEqual(chain.stages.map((stage) => stage.owner), ["possession", "buildUp", "progression", "finalThird", "chance", "shot"]);
  assert.deepEqual(chain.stages.slice(1, 4).map((stage) => stage.zone.split(":")[0]), ["buildUp", "finalThird", "box"]);
  assert.ok(chain.stages.slice(1).every((stage) => stage.success && Number.isFinite(stage.probability)));
  assert.equal(chain.goal, true);
  assert.equal(chain.xg, chain.stages.at(-1).probability);
  assert.equal(chain.stages.at(-1).defender.role, "GK");
  assert.equal(Object.isFrozen(chain), true);
  assert.equal(Object.isFrozen(chain.stages[1].factors), true);
});

test("造越位防线可以在进攻进入前场时终止控球链", () => {
  const chain = simulateV2PossessionChain([
    makeTeam("attacker", { tacticalDimensions:{ directness:78 } }),
    makeTeam("offside-defense", { tacticalDimensions:{ defensiveLine:82 }, outOfPossessionDetails:{ lineStrategy:"offside" } }),
  ], { rng:() => 0, recordRandomRolls:true });
  assert.equal(chain.terminalOutcome, "offside");
  assert.equal(chain.stages.at(-1).stage, "finalThird");
});

test("客队控球链也按自身视角从防守三区推进到禁区", () => {
  const chain = simulateV2PossessionChain([makeTeam("home"), makeTeam("away")], {
    rng:sequenceRng([0.999], 0),
    recordRandomRolls:true,
  });
  assert.equal(chain.attackingTeamIndex, 1);
  assert.deepEqual(chain.stages.slice(1, 4).map((stage) => stage.zone.split(":")[0]), ["buildUp", "finalThird", "box"]);
  assert.ok(chain.stages.slice(1, 4).every((stage) => stage.connection));
});

test("阶段概率公开空间、连接、压迫与人数因素且保持参数边界", () => {
  const chain = simulateV2PossessionChain([makeTeam("home"), makeTeam("away")], { rng:() => 0, recordRandomRolls:true });
  for (const stage of chain.stages.slice(1)) {
    assert.deepEqual(Object.keys(stage.factors).sort(), ["connection", "control", "execution", "overload", "pressureSafety", "progression", "space"]);
    assert.ok(Object.values(stage.factors).every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(stage.probability > 0 && stage.probability < 1);
  }
});

test("对手高位压迫通过区域控制降低本方初始控球概率", () => {
  const home = makeTeam("home");
  const balanced = simulateV2PossessionChain([home, makeTeam("balanced-away")], { rng:() => 0, recordRandomRolls:true });
  const highPress = simulateV2PossessionChain([
    home,
    makeTeam("press-away", { tactic:"allOutAttack", style:"highPress" }),
  ], { rng:() => 0, recordRandomRolls:true });
  assert.equal(balanced.stages[0].stage, "possession");
  assert.equal(highPress.stages[0].stage, "possession");
  assert.ok(highPress.stages[0].probability < balanced.stages[0].probability);
});

test("V2进攻心态和高位压迫提高后段推进收益且摆大巴主动进攻受限", () => {
  const aggressive = simulateV2PossessionChain([
    makeTeam("aggressive", { tactic:"allOutAttack", style:"highPress" }),
    makeTeam("aggressive-away"),
  ], { rng:() => 0, recordRandomRolls:true });
  const conservative = simulateV2PossessionChain([
    makeTeam("conservative", { tactic:"parkBus", style:"lowBlock" }),
    makeTeam("conservative-away"),
  ], { rng:() => 0, recordRandomRolls:true });
  const aggressiveChance = aggressive.stages.find((stage) => stage.stage === "chance");
  const conservativeChance = conservative.stages.find((stage) => stage.stage === "chance");
  assert.ok(aggressiveChance.stateAdjustment.tactical > 0);
  assert.ok(conservativeChance.stateAdjustment.tactical < 0);
  assert.ok(aggressiveChance.stateAdjustment.tactical > conservativeChance.stateAdjustment.tactical);
});

test("丢失球权时只允许事件区域内的防守球员完成断球", () => {
  const teams = [makeTeam("home"), makeTeam("away", { tactic:"allOutAttack", style:"highPress" })];
  const spatial = buildV2SpatialMatchup(teams);
  const chain = simulateV2PossessionChain(teams, {
    spatial,
    rng:sequenceRng([0, 0, 0, 0, 0, 0, 0.999, 0.999]),
    recordRandomRolls:true,
  });
  const turnover = chain.stages.at(-1);

  assert.equal(turnover.stage, "buildUp");
  assert.equal(turnover.success, false);
  assert.ok(turnover.defender);
  assert.equal(turnover.turnover.playerId, turnover.defender.id);
  const zone = spatial.teams[chain.attackingTeamIndex].zones[turnover.zone];
  assert.ok(zone.opponent.contributors.some((player) => player.id === turnover.defender.id));
  const defendingTeam = spatial.teams[chain.defendingTeamIndex];
  const defender = defendingTeam.players.find((player) => player.id === turnover.defender.id);
  const worldZone = spatial.zones.find((candidate) => candidate.id === zone.worldZone);
  assert.ok(Math.hypot(defender.worldPosition.x - worldZone.center.x, defender.worldPosition.y - worldZone.center.y) <= 24);
});

test("没有防守覆盖的区域不会虚构远距离抢断者", () => {
  const teams = [makeTeam("home"), makeTeam("away")];
  const baseline = buildV2SpatialMatchup(teams);
  const baselineStages = buildV2StageSpatialCache(teams);
  const baselineChain = simulateV2PossessionChain(teams, { spatial:baseline, stageSpatials:baselineStages, rng:() => 0 });
  const contestedZone = baselineChain.stages.find((stage) => stage.stage === "buildUp").zone;
  const stageSpatials = structuredClone(baselineStages);
  stageSpatials[0].buildUp.teams[0].zones[contestedZone].opponent.contributors = [];
  const chain = simulateV2PossessionChain(teams, {
    spatial:baseline,
    stageSpatials,
    rng:sequenceRng([0, 0, 0, 0, 0, 0.999]),
    recordRandomRolls:true,
  });
  const turnover = chain.stages.at(-1);
  assert.equal(turnover.stage, "buildUp");
  assert.equal(turnover.success, false);
  assert.equal(turnover.defender, null);
  assert.equal(turnover.turnover, null);
  assert.equal(turnover.outcome, "unforcedTurnover");
});

test("控球链复用空间快照且不修改球队或空间输入", () => {
  const teams = [makeTeam("home"), makeTeam("away")];
  const originalTeams = structuredClone(teams);
  const spatial = buildV2SpatialMatchup(teams);
  const originalSpatial = structuredClone(spatial);
  simulateV2PossessionChain(teams, { spatial, rng:() => 0.2 });
  assert.deepEqual(teams, originalTeams);
  assert.deepEqual(spatial, originalSpatial);
});

test("V2控球链拒绝非法球队数量和随机函数", () => {
  assert.throws(() => simulateV2PossessionChain([makeTeam("only")]), /恰好两支球队/);
  assert.throws(() => simulateV2PossessionChain([makeTeam("home"), makeTeam("away")], { rng:"invalid" }), /需要随机函数/);
  assert.throws(() => simulateV2PossessionChain([makeTeam("home"), makeTeam("away")], { rng:() => Number.NaN }), /有限数值/);
});

test("高直传倾向允许推进阶段跨过最后三区直接进入禁区", () => {
  const teams = [makeTeam("direct", { tactic:"parkBus", style:"longBall" }), makeTeam("opponent")];
  const chain = simulateV2PossessionChain(teams, { rng:() => 0, recordRandomRolls:true });
  const progression = chain.stages.find((stage) => stage.stage === "progression");
  assert.equal(progression.connection.routeType, "direct");
  assert.equal(progression.zone.split(":")[0], "box");
  assert.ok(progression.connection.quality < 0.2);
});

test("反击从断球区域直接启动而不倒退到组织区", () => {
  const teams = [makeTeam("counter", { tactic:"defensive", style:"counterAttack" }), makeTeam("opponent")];
  const chain = simulateV2PossessionChain(teams, {
    rng:() => 0,
    transition:{ wonZone:"finalThird:center", previousDefendingTeamIndex:0 },
    recordRandomRolls:true,
  });
  assert.equal(chain.startZone, "finalThird:center");
  assert.equal(chain.stages[1].stage, "finalThird");
  assert.equal(chain.stages[1].connection.routeType, "counter");
  assert.equal(chain.stages[1].zone.split(":")[0], "box");
});

test("断球转换指定下一条控球链的反击球队", () => {
  const teams = [makeTeam("home"), makeTeam("away")];
  const chain = simulateV2PossessionChain(teams, {
    rng:() => 0,
    transition:{ attackingTeamIndex:1, wonZone:"finalThird:center", previousDefendingTeamIndex:0 },
  });
  assert.equal(chain.attackingTeamIndex, 1);
  assert.equal(chain.startZone, "finalThird:center");
  assert.equal(chain.stages[1].connection.routeType, "counter");
});

test("落后紧迫度与天气进入阶段概率且链序号不再重复扣除体能", () => {
  const teams = [makeTeam("home"), makeTeam("away")];
  const level = simulateV2PossessionChain(teams, { rng:() => 0, state:{ minute:80, score:[0, 0] }, environment:{ weather:"sunny" }, chainIndex:0 });
  const lateLevel = simulateV2PossessionChain(teams, { rng:() => 0, state:{ minute:80, score:[0, 0] }, environment:{ weather:"sunny" }, chainIndex:170 });
  const trailing = simulateV2PossessionChain(teams, { rng:() => 0, state:{ minute:80, score:[0, 1] }, environment:{ weather:"snow" }, chainIndex:170 });
  const levelBuildUp = level.stages.find((stage) => stage.stage === "buildUp");
  const lateLevelBuildUp = lateLevel.stages.find((stage) => stage.stage === "buildUp");
  const trailingBuildUp = trailing.stages.find((stage) => stage.stage === "buildUp");
  assert.ok(trailingBuildUp.stateAdjustment.urgency > 0);
  assert.ok(trailingBuildUp.stateAdjustment.weather < 1);
  assert.equal(lateLevelBuildUp.stateAdjustment.fatigue, 0);
  assert.equal(lateLevelBuildUp.probability, levelBuildUp.probability);
  assert.ok(trailingBuildUp.probability < levelBuildUp.probability);
});

test("控球打法通过低直接度获得可观察的球权优势", () => {
  const chain = simulateV2PossessionChain([
    makeTeam("possession", { tactic:"balanced", style:"possession" }),
    makeTeam("low-block", { tactic:"parkBus", style:"lowBlock" }),
  ], { rng:() => 0, recordRandomRolls:true });
  assert.equal(chain.attackingTeamIndex, 0);
  assert.ok(chain.stages[0].probability > 0.52);
});

test("粗野打法和严格裁判可把区域防守失败转为犯规与牌", () => {
  const teams = [makeTeam("home"), makeTeam("rough", { style:"roughPlay" })];
  const chain = simulateV2PossessionChain(teams, {
    rng:sequenceRng([0, 0, 0, 0, 0, 0, 0.999, 0, 0]),
    environment:{ referee:"strict", weather:"sunny" },
    recordRandomRolls:true,
  });
  const foul = chain.stages.at(-1);
  assert.equal(foul.stage, "buildUp");
  assert.equal(foul.outcome, "setPieceWon");
  assert.equal(foul.turnover, null);
  assert.equal(foul.foul.occurred, true);
  assert.equal(foul.foul.card, "red");
  assert.equal(foul.foul.referee, "strict");
});

test("严格裁判比宽松裁判提高犯规和出牌概率", () => {
  const teams = [makeTeam("home"), makeTeam("rough", { style:"roughPlay" })];
  const rolls = [0, 0, 0, 0, 0, 0, 0.999, 0, 0.15];
  const lenient = simulateV2PossessionChain(teams, {
    rng:sequenceRng(rolls),
    environment:{ referee:"lenient", weather:"sunny" },
    recordRandomRolls:true,
  }).stages.at(-1).foul;
  const strict = simulateV2PossessionChain(teams, {
    rng:sequenceRng(rolls),
    environment:{ referee:"strict", weather:"sunny" },
    recordRandomRolls:true,
  }).stages.at(-1).foul;

  assert.ok(strict.probability > lenient.probability);
  assert.ok(strict.cardProbability > lenient.cardProbability);
});

test("雷暴独立事件不会重复改变射门概率", () => {
  const teams = [makeTeam("home"), makeTeam("away")];
  const sunny = simulateV2PossessionChain(teams, { rng:() => 0, environment:{ weather:"sunny" } });
  const storm = simulateV2PossessionChain(teams, { rng:() => 0, environment:{ weather:"storm" } });
  assert.equal(storm.independentEvents[0].type, "lightningInjury");
  assert.ok(storm.stages.find((stage) => stage.stage === "buildUp").stateAdjustment.weather < 1);
  assert.equal(sunny.independentEvents[0].type, "weatherInjury");
});
