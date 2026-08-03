import assert from "node:assert/strict";
import test from "node:test";
import { ATTRIBUTE_NAMES } from "../game/public/schema.js";
import {
  buildV2SpatialMatchup,
  buildV2StageSpatialCache,
  createV2Zones,
  resolveV2TacticalDimensions,
  v2PerspectivePosition,
  v2WorldPosition,
} from "../versus/v2/spatial-model-v2.js";

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
  const layout = options.layout ?? ROLE_LAYOUT;
  const players = layout.map(([role], index) => makePlayer(`${name}-${index}`, role, options.value ?? 80));
  const positions = Object.fromEntries(layout.map(([, x, y], index) => [players[index].id, { x, y }]));
  return {
    name,
    players,
    positions,
    tactic:options.tactic ?? "balanced",
    style:options.style ?? "possession",
    tacticalDimensions:options.tacticalDimensions,
    inPossessionDetails:options.inPossessionDetails,
    outOfPossessionDetails:options.outOfPossessionDetails,
  };
}

function localZone(team, id) {
  return team.zones[id];
}

test("V2区域模型建立20个有限数值区域且不修改输入", () => {
  const teams = [makeTeam("home"), makeTeam("away")];
  const original = structuredClone(teams);
  const result = buildV2SpatialMatchup(teams);

  assert.equal(result.zones.length, 20);
  assert.equal(Object.keys(result.teams[0].zones).length, 20);
  assert.equal(Object.keys(result.teams[1].zones).length, 20);
  assert.deepEqual(teams, original);
  for (const team of result.teams) {
    for (const zone of Object.values(team.zones)) {
      const values = [zone.controlShare, zone.numericalAdvantage, zone.pressureDelta, zone.exploitableSpace, zone.progressionEdge];
      assert.ok(values.every(Number.isFinite), `${team.name}:${zone.zone}`);
    }
  }
});

test("客队战术板经过180度投影并能还原本方视角", () => {
  const local = { x:18, y:69 };
  assert.deepEqual(v2WorldPosition(local, 0), { x:18, y:31 });
  assert.deepEqual(v2WorldPosition(local, 1), { x:82, y:69 });
  assert.deepEqual(v2PerspectivePosition(v2WorldPosition(local, 1), 1), { x:18, y:31 });
});

test("镜像阵型交换主客后产生对称的本方区域结果", () => {
  const first = buildV2SpatialMatchup([makeTeam("alpha"), makeTeam("beta")]);
  const second = buildV2SpatialMatchup([makeTeam("beta"), makeTeam("alpha")]);
  for (const zone of createV2Zones()) {
    assert.ok(Math.abs(first.teams[0].zones[zone.id].controlShare - first.teams[1].zones[zone.id].controlShare) < 0.0002, zone.id);
    assert.ok(Math.abs(first.teams[0].zones[zone.id].controlShare - second.teams[1].zones[zone.id].controlShare) < 0.0002, zone.id);
  }
});

test("中路增加一名球员会形成局部人数与控制优势", () => {
  const baseHome = makeTeam("base-home");
  const overloadedHome = makeTeam("overload-home");
  const movedId = overloadedHome.players[7].id;
  overloadedHome.players[7].role = "AM";
  overloadedHome.positions[movedId] = { x:50, y:46 };
  const opponent = makeTeam("opponent");
  const base = buildV2SpatialMatchup([baseHome, opponent]);
  const overloaded = buildV2SpatialMatchup([overloadedHome, opponent]);
  const zone = "finalThird:center";

  assert.ok(localZone(overloaded.teams[0], zone).numericalAdvantage > localZone(base.teams[0], zone).numericalAdvantage);
  assert.ok(localZone(overloaded.teams[0], zone).controlShare > localZone(base.teams[0], zone).controlShare);
});

test("边锋拉宽会提高边路占位并降低同区域对手控制", () => {
  const narrow = makeTeam("narrow");
  const wide = makeTeam("wide");
  wide.positions[wide.players[7].id] = { x:6, y:19 };
  wide.positions[wide.players[10].id] = { x:94, y:19 };
  const opponent = makeTeam("opponent");
  const narrowResult = buildV2SpatialMatchup([narrow, opponent]);
  const wideResult = buildV2SpatialMatchup([wide, opponent]);
  const left = "box:farLeft";
  const right = "box:farRight";

  assert.ok(localZone(wideResult.teams[0], left).own.occupancy > localZone(narrowResult.teams[0], left).own.occupancy);
  assert.ok(localZone(wideResult.teams[0], right).own.occupancy > localZone(narrowResult.teams[0], right).own.occupancy);
  assert.ok(wideResult.teams[0].flankControl > narrowResult.teams[0].flankControl);
});

test("高位压迫前移压力线，同时为对手留下身后空间", () => {
  const balanced = buildV2SpatialMatchup([makeTeam("balanced"), makeTeam("opponent")]);
  const pressing = buildV2SpatialMatchup([
    makeTeam("pressing", { tactic:"allOutAttack", style:"highPress" }),
    makeTeam("opponent"),
  ]);

  const attackingPressure = ["finalThird:center", "box:center"];
  const balancedPressure = attackingPressure.reduce((sum, zone) => sum + localZone(balanced.teams[0], zone).own.pressure, 0);
  const highPressure = attackingPressure.reduce((sum, zone) => sum + localZone(pressing.teams[0], zone).own.pressure, 0);
  assert.ok(highPressure > balancedPressure);
  assert.ok(pressing.teams[1].finalThirdControl > balanced.teams[1].finalThirdControl);
});

test("低位防守回收防线并提高本方防守三区占位", () => {
  const balanced = buildV2SpatialMatchup([makeTeam("balanced"), makeTeam("opponent")]);
  const lowBlock = buildV2SpatialMatchup([
    makeTeam("low", { tactic:"parkBus", style:"lowBlock" }),
    makeTeam("opponent"),
  ]);
  const defensiveZones = ["defensiveThird:leftHalfSpace", "defensiveThird:center", "defensiveThird:rightHalfSpace"];
  const occupancy = (result) => defensiveZones.reduce((sum, zone) => sum + localZone(result.teams[0], zone).own.occupancy, 0);
  assert.ok(occupancy(lowBlock) > occupancy(balanced));
});

test("防守方向与防守宽度会改变后卫和中场的实际覆盖位置", () => {
  const balanced = buildV2SpatialMatchup([makeTeam("balanced"), makeTeam("opponent")]);
  const protectLeft = buildV2SpatialMatchup([
    makeTeam("protect-left", { outOfPossessionDetails:{ defenseDirection:"left", defensiveWidth:"balanced" } }),
    makeTeam("opponent"),
  ]);
  const protectCenter = buildV2SpatialMatchup([
    makeTeam("protect-center", { outOfPossessionDetails:{ defenseDirection:"balanced", defensiveWidth:"protectCenter" } }),
    makeTeam("opponent"),
  ]);
  const balancedDefender = balanced.teams[0].players.find((player) => player.assignedRole === "CB");
  const shiftedDefender = protectLeft.teams[0].players.find((player) => player.assignedRole === "CB");
  const narrowDefender = protectCenter.teams[0].players.find((player) => player.assignedRole === "CB");
  assert.ok(shiftedDefender.localPosition.x < balancedDefender.localPosition.x);
  assert.ok(Math.abs(narrowDefender.localPosition.x - 50) < Math.abs(balancedDefender.localPosition.x - 50));
});

test("不合理位置适配会降低同一空间内的球员贡献", () => {
  const natural = makeTeam("natural");
  const misplaced = makeTeam("misplaced");
  misplaced.players[8].role = "GK";
  const opponent = makeTeam("opponent");
  const naturalResult = buildV2SpatialMatchup([natural, opponent]);
  const misplacedResult = buildV2SpatialMatchup([misplaced, opponent]);
  const zone = "box:leftHalfSpace";

  assert.ok(localZone(misplacedResult.teams[0], zone).own.attack < localZone(naturalResult.teams[0], zone).own.attack);
});

test("连续战术参数由心态、打法和自定义值共同确定", () => {
  const dimensions = resolveV2TacticalDimensions("positive", "wingPlay", { pressing:88 });
  assert.equal(dimensions.pressing, 88);
  assert.equal(dimensions.attackingWidth, 85);
  assert.equal(dimensions.mentality, 66);
});

test("阶段动态空间让前腰和边锋前插且保留后场保护", () => {
  const layout = [
    ["GK", 50, 90],
    ["LB", 16, 69], ["CB", 38, 69], ["CB", 62, 69], ["RB", 84, 69],
    ["DM", 45, 55], ["DM", 55, 55],
    ["LM", 20, 38], ["AM", 50, 36], ["RM", 80, 38], ["ST", 50, 17],
  ];
  const home = makeTeam("dynamic-home", { layout });
  const away = makeTeam("dynamic-away");
  const opening = buildV2SpatialMatchup([home, away]);
  const cache = buildV2StageSpatialCache([home, away]);
  const shot = cache[0].shot;
  const attackingMidfielder = shot.teams[0].players.find((player) => player.assignedRole === "AM");
  const defensiveMidfielder = shot.teams[0].players.find((player) => player.assignedRole === "DM");

  assert.ok(attackingMidfielder.localPosition.y < home.positions[attackingMidfielder.id].y - 8);
  assert.ok(defensiveMidfielder.localPosition.y >= 45);
  assert.ok(shot.teams[0].boxPresence > opening.teams[0].boxPresence * 1.5);
  assert.ok(shot.teams[0].players.filter((player) => player.assignedRole === "CB").every((player) => player.localPosition.y > 55));
});
