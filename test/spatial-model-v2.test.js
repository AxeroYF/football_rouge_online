import assert from "node:assert/strict";
import test from "node:test";
import { ATTRIBUTE_NAMES } from "../game/public/schema.js";
import {
  buildV2SpatialMatchup,
  buildV2StageSpatialCache,
  createV2Zones,
  resolveV2TacticalDimensions,
  v2DoublePivot451Profile,
  v2MidfieldStructureProfile,
  v2PerspectivePosition,
  v2StyleIdentityProfile,
  v2WorldPosition,
} from "../versus/v2/spatial-model-v2.js";

const DOUBLE_PIVOT_451_LAYOUT = Object.freeze([
  ["GK", 50, 90],
  ["LB", 18, 68], ["CB", 40, 68], ["CB", 60, 68], ["RB", 82, 68],
  ["DM", 40, 51], ["DM", 60, 51],
  ["LM", 20, 38], ["AM", 50, 36], ["RM", 80, 38],
  ["ST", 50, 16],
]);

test("V2中场真空结构几乎丧失完整性并暴露远射空间", () => {
  const emptyMidfieldLayout = [
    ["GK", 50, 92],
    ["LB", 5, 75], ["CB", 19, 79], ["CB", 32, 81], ["CB", 44, 82],
    ["CB", 56, 82], ["CB", 68, 81], ["CB", 81, 79], ["RB", 95, 75],
    ["ST", 38, 18], ["ST", 62, 18],
  ];
  const empty = buildV2SpatialMatchup([makeTeam("empty-midfield", { layout:emptyMidfieldLayout }), makeTeam("normal-opponent")]);
  const stable = buildV2SpatialMatchup([makeTeam("stable"), makeTeam("stable-opponent")]);
  const profile = v2MidfieldStructureProfile(empty.teams[0].players);

  assert.equal(profile.breakdown.midfieldPlayerCount, 0);
  assert.ok(profile.breakdown.maximumVerticalGap >= 50);
  assert.ok(empty.teams[0].midfieldIntegrity <= 0.1);
  assert.ok(empty.teams[0].longShotExposure >= 0.95);
  assert.ok(stable.teams[0].midfieldIntegrity >= 0.75);
  assert.ok(stable.teams[0].midfieldIntegrity > empty.teams[0].midfieldIntegrity + 0.6);
});

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
    spatialRoles:Object.fromEntries(players.map((player) => [player.id, player.role])),
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

test("双后腰、单前腰、左右中场和单前锋精确触发4-2-3-1增强", () => {
  const team = makeTeam("double-pivot-451", { layout:DOUBLE_PIVOT_451_LAYOUT });
  assert.equal(v2DoublePivot451Profile(team.players).active, true);

  const threeAdvancedMidfielders = structuredClone(team);
  threeAdvancedMidfielders.players[7].role = "AM";
  threeAdvancedMidfielders.players[9].role = "AM";
  assert.equal(v2DoublePivot451Profile(threeAdvancedMidfielders.players).active, false);

  const opponent = makeTeam("double-pivot-opponent");
  const strengthened = buildV2SpatialMatchup([team, opponent]);
  const neutral = buildV2SpatialMatchup([team, opponent], { parameters:{ spatial:{ roleBalance:{
    doublePivot451PivotControlMultiplier:1,
    doublePivot451PivotDefenseMultiplier:1,
    doublePivot451AttackUnitControlMultiplier:1,
    doublePivot451AttackUnitAttackMultiplier:1,
    doublePivot451AttackUnitSupportMultiplier:1,
  } } } });
  const total = (matchup, key) => Object.values(matchup.teams[0].zones).reduce((sum, zone) => sum + zone.own[key], 0);
  assert.ok(total(strengthened, "control") > total(neutral, "control"));
  assert.ok(total(strengthened, "attack") > total(neutral, "attack"));
  assert.ok(total(strengthened, "defense") > total(neutral, "defense"));
  assert.ok(total(strengthened, "support") > total(neutral, "support"));
});

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

test("七种V2打法按对应位置与能力形成受上限约束的实战适配", () => {
  const profile = (style, configure) => {
    const team = makeTeam(`${style}-fit`, { style });
    configure(team);
    const spatial = buildV2SpatialMatchup([team, makeTeam(`${style}-opponent`)]);
    return v2StyleIdentityProfile(team, spatial.teams[0].players);
  };
  const wingStrong = profile("wingPlay", (team) => team.players.filter((player) => ["LW", "RW", "LB", "RB"].includes(player.role)).forEach((player) => Object.assign(player.attributes, { passing:96, vision:95, crossing:98, dribbling:92, offBall:91, pace:94, acceleration:93 })));
  const wingLimited = profile("wingPlay", (team) => team.players.filter((player) => ["LW", "RW", "LB", "RB"].includes(player.role)).forEach((player) => Object.assign(player.attributes, { passing:48, vision:48, crossing:45, dribbling:46, offBall:47, pace:50, acceleration:49 })));
  const possessionStrong = profile("possession", (team) => team.players.filter((player) => ["CB", "LB", "RB", "DM", "AM"].includes(player.role)).forEach((player) => Object.assign(player.attributes, { passing:96, vision:94, decisions:93, firstTouch:92, composure:92, tackling:91, positioning:90, marking:89 })));
  const possessionLimited = profile("possession", (team) => team.players.filter((player) => ["CB", "LB", "RB", "DM", "AM"].includes(player.role)).forEach((player) => Object.assign(player.attributes, { passing:48, vision:46, decisions:47, firstTouch:48, composure:46, tackling:49, positioning:48, marking:47 })));
  const longStrong = profile("longBall", (team) => team.players.forEach((player) => Object.assign(player.attributes, { passing:92, vision:88, decisions:88, heading:96, jumping:94, strength:93, offBall:91 })));
  const longLimited = profile("longBall", (team) => team.players.forEach((player) => Object.assign(player.attributes, { passing:48, vision:46, decisions:46, heading:45, jumping:46, strength:47, offBall:47 })));
  const roughStrong = profile("roughPlay", (team) => team.players.filter((player) => ["CB", "LB", "RB", "DM", "AM"].includes(player.role)).forEach((player) => Object.assign(player.attributes, { tackling:97, positioning:94, marking:93, strength:94, stamina:92, workRate:94, aggression:96 })));
  const roughLimited = profile("roughPlay", (team) => team.players.filter((player) => ["CB", "LB", "RB", "DM", "AM"].includes(player.role)).forEach((player) => Object.assign(player.attributes, { tackling:45, positioning:47, marking:46, strength:48, stamina:46, workRate:47, aggression:45 })));
  const counterStrong = profile("counterAttack", (team) => team.players.forEach((player) => Object.assign(player.attributes, { tackling:92, marking:90, positioning:91, passing:94, vision:91, decisions:90, pace:91, acceleration:92, offBall:93, finishing:90, pressResistance:89 })));
  const counterLimited = profile("counterAttack", (team) => team.players.forEach((player) => Object.assign(player.attributes, { tackling:48, marking:47, positioning:46, passing:48, vision:47, decisions:46, pace:47, acceleration:46, offBall:45, finishing:48, pressResistance:47 })));
  const pressStrong = profile("highPress", (team) => team.players.forEach((player) => Object.assign(player.attributes, { stamina:94, workRate:95, aggression:93, pace:91, acceleration:90, tackling:92, positioning:90, shotPrevention:90 })));
  const pressLimited = profile("highPress", (team) => team.players.forEach((player) => Object.assign(player.attributes, { stamina:46, workRate:45, aggression:47, pace:48, acceleration:47, tackling:46, positioning:45, shotPrevention:46 })));
  const blockStrong = profile("lowBlock", (team) => team.players.forEach((player) => Object.assign(player.attributes, { shotPrevention:94, positioning:93, marking:92, tackling:91, strength:90, goalkeeping:94, reflexes:93, pressResistance:89 })));
  const blockLimited = profile("lowBlock", (team) => team.players.forEach((player) => Object.assign(player.attributes, { shotPrevention:46, positioning:45, marking:47, tackling:48, strength:47, goalkeeping:46, reflexes:45, pressResistance:46 })));

  assert.ok(wingStrong.crossingMultiplier > wingLimited.crossingMultiplier);
  assert.ok(possessionStrong.controlMultiplier > possessionLimited.controlMultiplier);
  assert.ok(possessionStrong.defenseMultiplier > possessionLimited.defenseMultiplier);
  assert.ok(longStrong.progressionMultiplier > longLimited.progressionMultiplier);
  assert.ok(longStrong.headerXgMultiplier > longLimited.headerXgMultiplier);
  assert.ok(roughStrong.defenseMultiplier > roughLimited.defenseMultiplier);
  assert.ok(roughStrong.pressureMultiplier > roughLimited.pressureMultiplier);
  assert.ok(counterStrong.transitionMultiplier > counterLimited.transitionMultiplier);
  assert.ok(counterStrong.outletMultiplier > counterLimited.outletMultiplier);
  assert.ok(pressStrong.pressureMultiplier > pressLimited.pressureMultiplier);
  assert.ok(pressStrong.recoveryMultiplier > pressLimited.recoveryMultiplier);
  assert.ok(blockStrong.defenseMultiplier > blockLimited.defenseMultiplier);
  assert.ok(blockStrong.outletMultiplier > blockLimited.outletMultiplier);
  for (const item of [wingStrong, possessionStrong, longStrong, roughStrong, counterStrong, pressStrong, blockStrong]) assert.ok(item.fit >= 0.82 && item.fit <= 1.18);
});

test("V2 空间快照保留本场纪律状态供第二黄牌判定", () => {
  const home = makeTeam("booked-home");
  home.players[1].matchStats = { yellowCards:1 };
  const result = buildV2SpatialMatchup([home, makeTeam("opponent")]);

  assert.equal(result.teams[0].players.find((player) => player.id === home.players[1].id).matchStats.yellowCards, 1);
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

test("中路过密的额外占位采用递减收益而非线性滚大", () => {
  const base = makeTeam("base-central");
  const oneExtra = makeTeam("one-extra-central");
  const twoExtra = makeTeam("two-extra-central");
  [oneExtra.players[7], twoExtra.players[7], twoExtra.players[10]].forEach((player) => {
    player.role = "AM";
  });
  oneExtra.positions[oneExtra.players[7].id] = { x:50, y:46 };
  twoExtra.positions[twoExtra.players[7].id] = { x:50, y:46 };
  twoExtra.positions[twoExtra.players[10].id] = { x:50, y:46 };
  const opponent = makeTeam("central-opponent");
  const zone = "finalThird:center";
  const baseline = localZone(buildV2SpatialMatchup([base, opponent]).teams[0], zone);
  const first = localZone(buildV2SpatialMatchup([oneExtra, opponent]).teams[0], zone);
  const second = localZone(buildV2SpatialMatchup([twoExtra, opponent]).teams[0], zone);

  assert.ok(first.controlShare > baseline.controlShare);
  assert.ok(second.controlShare > first.controlShare);
  assert.ok(second.controlShare - first.controlShare < first.controlShare - baseline.controlShare);
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

test("少中场多前锋阵型产生后场暴露并提高对手机会空间", () => {
  const extremeLayout = [
    ["GK", 50, 90],
    ["LB", 18, 69], ["CB", 40, 69], ["CB", 60, 69], ["RB", 82, 69],
    ["DM", 50, 47],
    ["LW", 10, 18], ["ST", 30, 18], ["ST", 50, 18], ["ST", 70, 18], ["RW", 90, 18],
  ];
  const normal = buildV2SpatialMatchup([makeTeam("normal"), makeTeam("opponent")]);
  const exposed = buildV2SpatialMatchup([makeTeam("extreme", { layout:extremeLayout }), makeTeam("opponent")]);

  assert.ok(exposed.teams[0].backlineExposure > normal.teams[0].backlineExposure + 0.2);
  assert.ok(exposed.teams[1].finalThirdControl > normal.teams[1].finalThirdControl);
  assert.ok(localZone(exposed.teams[1], "box:center").exploitableSpace > localZone(normal.teams[1], "box:center").exploitableSpace);
});

test("两后卫在禁区与边路产生比三后卫更明显的区域防守断层", () => {
  const threeBackLayout = [
    ["GK", 50, 90],
    ["CB", 24, 70], ["CB", 50, 70], ["CB", 76, 70],
    ["LM", 14, 48], ["DM", 36, 52], ["AM", 50, 40], ["DM", 64, 52], ["RM", 86, 48],
    ["ST", 38, 18], ["ST", 62, 18],
  ];
  const twoBackLayout = [
    ["GK", 50, 90],
    ["CB", 35, 70], ["CB", 65, 70],
    ["DM", 34, 48], ["DM", 50, 48], ["DM", 66, 48],
    ["AM", 36, 36], ["AM", 64, 36],
    ["ST", 30, 16], ["ST", 50, 14], ["ST", 70, 16],
  ];
  const opponent = makeTeam("coverage-opponent");
  const threeBack = buildV2SpatialMatchup([makeTeam("three-back", { layout:threeBackLayout }), opponent]);
  const twoBack = buildV2SpatialMatchup([makeTeam("two-back", { layout:twoBackLayout }), opponent]);
  const center = "box:center";
  const flank = "box:farLeft";

  assert.ok(twoBack.teams[0].backlineExposure > threeBack.teams[0].backlineExposure + 0.35);
  assert.ok(localZone(twoBack.teams[1], center).coverageDeficit > localZone(threeBack.teams[1], center).coverageDeficit);
  assert.ok(localZone(twoBack.teams[1], flank).coverageDeficit > localZone(threeBack.teams[1], flank).coverageDeficit);
});

test("少于三后卫的结构失衡独立于中前场人数，二后卫惩罚较轻", () => {
  const oneBackLayout = [
    ["GK", 50, 90], ["CB", 50, 72],
    ["DM", 18, 52], ["DM", 34, 50], ["DM", 50, 48], ["DM", 66, 50], ["DM", 82, 52], ["AM", 38, 34], ["AM", 62, 34],
    ["ST", 35, 17], ["ST", 65, 17],
  ];
  const twoBackLayout = oneBackLayout.map((entry, index) => index === 2 ? ["CB", entry[1], 70] : entry);
  const opponent = makeTeam("one-back-opponent");
  const oneBack = buildV2SpatialMatchup([makeTeam("one-back", { layout:oneBackLayout }), opponent]);
  const twoBack = buildV2SpatialMatchup([makeTeam("two-back", { layout:twoBackLayout }), opponent]);

  assert.equal(oneBack.teams[0].backlineExposureBreakdown.defenderCount, 1);
  assert.ok(oneBack.teams[0].underThreeDefenderFailure > 0.6);
  assert.ok(twoBack.teams[0].underThreeDefenderFailure > 0);
  assert.ok(twoBack.teams[0].underThreeDefenderFailure < oneBack.teams[0].underThreeDefenderFailure);
  assert.ok(oneBack.teams[0].backlineExposure > twoBack.teams[0].backlineExposure);
});

test("相同人数结构下高位防线和纵向脱节都会增加后场暴露", () => {
  const highLineLayout = ROLE_LAYOUT.map(([role, x, y]) => [role, x, ["LB", "CB", "RB"].includes(role) ? 45 : y]);
  const disconnectedLayout = ROLE_LAYOUT.map(([role, x, y]) => [role, x, ["LW", "ST", "RW"].includes(role) ? 5 : y]);
  const balanced = buildV2SpatialMatchup([makeTeam("balanced"), makeTeam("opponent")]);
  const highLine = buildV2SpatialMatchup([makeTeam("high-line", { layout:highLineLayout }), makeTeam("opponent")]);
  const disconnected = buildV2SpatialMatchup([makeTeam("disconnected", { layout:disconnectedLayout }), makeTeam("opponent")]);

  assert.ok(highLine.teams[0].backlineExposure > balanced.teams[0].backlineExposure);
  assert.ok(highLine.teams[0].backlineExposureBreakdown.highLineRisk > 0.7);
  assert.ok(disconnected.teams[0].backlineExposure > balanced.teams[0].backlineExposure);
  assert.ok(disconnected.teams[0].backlineExposureBreakdown.verticalGapRisk > 0);
  assert.ok(Object.values(highLine.teams[0].backlineExposureBreakdown).filter((value) => value != null).every(Number.isFinite));
});

test("V2 三后卫叠加多个前腰会产生额外的转换防守风险", () => {
  const doubleAmLayout = [
    ["GK", 50, 90],
    ["LB", 20, 69], ["CB", 50, 69], ["RB", 80, 69],
    ["DM", 36, 49], ["DM", 64, 49],
    ["LM", 16, 36], ["AM", 42, 33], ["AM", 58, 33], ["RM", 84, 36],
    ["ST", 50, 16],
  ];
  const singleAmLayout = doubleAmLayout.map((entry, index) => index === 8 ? ["DM", entry[1], entry[2]] : entry);
  const doubleAm = buildV2SpatialMatchup([makeTeam("double-am", { layout:doubleAmLayout }), makeTeam("opponent")]);
  const singleAm = buildV2SpatialMatchup([makeTeam("single-am", { layout:singleAmLayout }), makeTeam("opponent")]);

  assert.ok(doubleAm.teams[0].backlineExposure > singleAm.teams[0].backlineExposure + 0.09);
  assert.equal(doubleAm.teams[0].backlineExposureBreakdown.advancedMidfielderExcess, 0.5);
  assert.equal(doubleAm.teams[0].backlineExposureBreakdown.threeBackAdvancedMidfieldRisk, 0.5);
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
