import { v2PlayerDutySuitability } from "./v2-player-duty-options.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const average = (values, fallback = 60) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
const ROLE_GROUPS = Object.freeze({ GK:new Set(["GK"]), DEF:new Set(["CB", "LB", "RB", "LWB", "RWB"]), ATT:new Set(["ST", "LW", "RW"]) });
const POSITION_ORDER = Object.freeze(["GK", "CB", "LB", "RB", "DM", "AM", "LM", "RM", "ST", "LW", "RW"]);
const LEGACY_POSITIONS = Object.freeze({ DEF:"CB", MID:"DM", ATT:"ST", FB:"CB", CM:"DM", CF:"ST" });
const METRICS = Object.freeze({
  buildUp:{ passing:.28, vision:.22, decisions:.2, firstTouch:.18, composure:.12 },
  progression:{ passing:.22, vision:.18, dribbling:.2, decisions:.16, pace:.12, acceleration:.12 },
  pressResistance:{ firstTouch:.24, dribbling:.2, composure:.2, decisions:.18, strength:.1, agility:.08 },
  defensiveDuel:{ tackling:.28, positioning:.22, marking:.18, pace:.12, strength:.12, decisions:.08 },
  chanceCreation:{ passing:.25, vision:.25, decisions:.2, crossing:.12, dribbling:.1, composure:.08 },
  movement:{ offBall:.3, acceleration:.2, pace:.16, decisions:.14, agility:.1, composure:.1 },
  finishing:{ finishing:.42, composure:.22, offBall:.16, firstTouch:.12, decisions:.08 },
  aerialFinishing:{ heading:.38, jumping:.2, strength:.16, offBall:.14, composure:.12 },
  longShot:{ longShots:.46, composure:.2, finishing:.16, firstTouch:.1, decisions:.08 },
  shotPrevention:{ positioning:.28, marking:.22, decisions:.18, pace:.12, strength:.1, jumping:.1 },
  goalkeeping:{ goalkeeping:.5, reflexes:.3, positioning:.12, composure:.08 },
  pressing:{ stamina:.24, workRate:.22, pace:.14, tackling:.14, aggression:.12, decisions:.08, strength:.06 },
});

function roleGroup(role) {
  if (ROLE_GROUPS.GK.has(role)) return "GK";
  if (ROLE_GROUPS.DEF.has(role)) return "DEF";
  if (ROLE_GROUPS.ATT.has(role)) return "ATT";
  return "MID";
}

function normalizePosition(role, preferredFoot = "right", salt = 0) {
  if (role === "LWB") return "LB";
  if (role === "RWB") return "RB";
  if (POSITION_ORDER.includes(role)) return role;
  if (["WB", "WM"].includes(role)) return preferredFoot === "left" ? "LM" : "RM";
  if (role === "W") return preferredFoot === "left" ? "LW" : "RW";
  if (role === "FB") return preferredFoot === "left" ? "LB" : "RB";
  if (role === "AM") return salt % 2 === 0 ? "LM" : "RM";
  return LEGACY_POSITIONS[role] ?? "DM";
}

function positionFitScore(player, assignedRole) {
  const assigned = normalizePosition(assignedRole, player?.preferredFoot);
  const primary = normalizePosition(player?.role, player?.preferredFoot);
  const secondary = player?.secondaryRole ? normalizePosition(player.secondaryRole, player?.preferredFoot) : null;
  const assignedGroup = roleGroup(assigned);
  const primaryGroup = roleGroup(primary);
  let fit = assigned === primary
    ? 1
    : assigned === secondary
      ? .9
      : assignedGroup === primaryGroup
        ? .8
        : assignedGroup === "GK"
          ? Math.max(.35, Number(player?.hidden?.emergencyGoalkeeper ?? 35) / 100)
          : .66;
  const leftSide = ["LB", "LWB", "LM", "LW"].includes(assignedRole) || ["LB", "LM", "LW"].includes(assigned);
  const rightSide = ["RB", "RWB", "RM", "RW"].includes(assignedRole) || ["RB", "RM", "RW"].includes(assigned);
  if (leftSide || rightSide) {
    if (player?.preferredFoot === "both") fit *= 1.03;
    else if ((leftSide && player?.preferredFoot === "left") || (rightSide && player?.preferredFoot === "right")) fit *= 1.02;
    else fit *= .95;
  }
  return clamp(fit, .35, 1.04);
}

function playerMetric(player, name) {
  const weights = METRICS[name];
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + Number(player.attributes?.[key] ?? player.overall ?? 60) * weight, 0);
}

function squadMetric(entries, weights) {
  if (!entries.length) return 55;
  return average(entries.map((player) => Object.entries(weights).reduce((sum, [name, weight]) => sum + playerMetric(player, name) * weight, 0)));
}

function inPossessionFit(plan, groups, wide) {
  const outfield = [...groups.DEF, ...groups.MID, ...groups.ATT];
  const profiles = {
    balanced:() => squadMetric(outfield, { buildUp:.24, progression:.26, chanceCreation:.25, movement:.15, pressResistance:.1 }),
    shortPassing:() => squadMetric(outfield, { buildUp:.42, pressResistance:.32, chanceCreation:.16, movement:.1 }),
    vertical:() => squadMetric([...groups.MID, ...groups.ATT], { progression:.42, movement:.3, chanceCreation:.18, pressResistance:.1 }),
    wideOverload:() => squadMetric(wide, { progression:.24, chanceCreation:.38, movement:.22, pressResistance:.16 }) * .68 + squadMetric(groups.ATT, { aerialFinishing:.58, movement:.24, finishing:.18 }) * .32,
    centralCombination:() => squadMetric(groups.MID, { buildUp:.3, chanceCreation:.34, pressResistance:.24, movement:.12 }) * .66 + squadMetric(groups.ATT, { movement:.46, finishing:.3, pressResistance:.24 }) * .34,
    longBall:() => squadMetric([...groups.DEF, ...groups.MID], { buildUp:.44, progression:.38, pressResistance:.18 }) * .54 + squadMetric(groups.ATT, { aerialFinishing:.58, movement:.26, finishing:.16 }) * .46,
    counterAttack:() => squadMetric([...groups.DEF, ...groups.MID], { defensiveDuel:.28, buildUp:.28, passing:.18, decisions:.14, pressResistance:.12 }) * .54 + squadMetric(groups.ATT, { movement:.34, pace:.22, acceleration:.18, pressResistance:.14, finishing:.12 }) * .46,
  };
  const base = (profiles[plan.inPossession] ?? profiles.balanced)();
  const details = plan.inPossessionDetails ?? {};
  const detailScores = [
    ["short", "shorter"].includes(details.directness) ? squadMetric(outfield, { buildUp:.55, pressResistance:.45 }) : ["longer", "direct"].includes(details.directness) ? squadMetric([...groups.MID, ...groups.ATT], { progression:.55, movement:.25, aerialFinishing:.2 }) : squadMetric(outfield, { buildUp:.34, progression:.36, pressResistance:.3 }),
    details.chanceCreation === "patient" ? squadMetric([...groups.MID, ...groups.ATT], { chanceCreation:.5, pressResistance:.3, movement:.2 }) : details.chanceCreation === "shootOnSight" ? squadMetric(groups.ATT, { finishing:.48, longShot:.34, movement:.18 }) : squadMetric([...groups.MID, ...groups.ATT], { chanceCreation:.34, movement:.33, finishing:.33 }),
    details.longShots === "increase" ? squadMetric([...groups.MID, ...groups.ATT], { longShot:.72, chanceCreation:.18, pressResistance:.1 }) : squadMetric([...groups.MID, ...groups.ATT], { chanceCreation:.42, movement:.34, finishing:.24 }),
    details.crossing === "increase" ? squadMetric(wide, { chanceCreation:.45, progression:.32, movement:.23 }) * .65 + squadMetric(groups.ATT, { aerialFinishing:.62, movement:.23, finishing:.15 }) * .35 : squadMetric([...groups.MID, ...groups.ATT], { chanceCreation:.4, movement:.34, finishing:.26 }),
  ];
  return base * .55 + average(detailScores) * .45;
}

function outOfPossessionFit(plan, groups) {
  const outfield = [...groups.DEF, ...groups.MID, ...groups.ATT];
  const defensiveUnit = [...groups.DEF, ...groups.MID];
  const profiles = {
    balanced:() => squadMetric(outfield, { pressing:.28, defensiveDuel:.4, shotPrevention:.32 }),
    highPress:() => squadMetric(outfield, { pressing:.62, defensiveDuel:.22, shotPrevention:.16 }),
    midBlock:() => squadMetric(defensiveUnit, { defensiveDuel:.44, pressing:.3, shotPrevention:.26 }),
    lowBlock:() => squadMetric(groups.DEF, { shotPrevention:.56, defensiveDuel:.34, pressing:.1 }) * .82 + squadMetric(groups.GK, { goalkeeping:.82, pressResistance:.18 }) * .18,
    zonal:() => squadMetric(defensiveUnit, { shotPrevention:.48, defensiveDuel:.38, pressing:.14 }),
    manMark:() => average(defensiveUnit.map((player) => Number(player.attributes?.marking ?? player.overall ?? 60) * .42 + playerMetric(player, "defensiveDuel") * .38 + playerMetric(player, "pressing") * .2), 55),
  };
  const base = (profiles[plan.outOfPossession] ?? profiles.balanced)();
  const details = plan.outOfPossessionDetails ?? {};
  const detailScores = [
    ["high", "relentless"].includes(details.pressing) ? squadMetric(outfield, { pressing:.72, defensiveDuel:.28 }) : squadMetric(defensiveUnit, { defensiveDuel:.42, shotPrevention:.4, pressing:.18 }),
    details.marking === "man" ? average(defensiveUnit.map((player) => Number(player.attributes?.marking ?? player.overall ?? 60) * .48 + playerMetric(player, "defensiveDuel") * .32 + playerMetric(player, "pressing") * .2), 55) : squadMetric(defensiveUnit, { shotPrevention:.5, defensiveDuel:.36, pressing:.14 }),
    details.lineStrategy === "offside" ? squadMetric(groups.DEF, { shotPrevention:.42, defensiveDuel:.28, pressing:.3 }) : details.lineStrategy === "drop" ? squadMetric([...groups.DEF, ...groups.GK], { shotPrevention:.52, defensiveDuel:.28, goalkeeping:.2 }) : squadMetric(groups.DEF, { shotPrevention:.52, defensiveDuel:.34, pressing:.14 }),
  ];
  return base * .55 + average(detailScores) * .45;
}

function dimensionExecutionFit(dimensions, groups, wide) {
  const outfield = [...groups.DEF, ...groups.MID, ...groups.ATT];
  const demands = [
    [Number(dimensions.tempo), squadMetric(outfield, { pressing:.34, progression:.28, pressResistance:.38 })],
    [Math.abs(Number(dimensions.directness) - 50) * 2, Number(dimensions.directness) >= 50 ? squadMetric([...groups.MID, ...groups.ATT], { progression:.48, movement:.28, aerialFinishing:.24 }) : squadMetric(outfield, { buildUp:.5, pressResistance:.5 })],
    [Math.abs(Number(dimensions.attackingWidth) - 50) * 2, Number(dimensions.attackingWidth) >= 50 ? squadMetric(wide, { progression:.34, chanceCreation:.38, movement:.28 }) : squadMetric(groups.MID, { buildUp:.3, chanceCreation:.38, pressResistance:.32 })],
    [Number(dimensions.defensiveLine), squadMetric(groups.DEF, { defensiveDuel:.42, shotPrevention:.34, pressing:.24 })],
    [Number(dimensions.pressing), squadMetric(outfield, { pressing:.7, defensiveDuel:.3 })],
    [Number(dimensions.compactness), squadMetric([...groups.DEF, ...groups.MID], { shotPrevention:.46, defensiveDuel:.34, pressing:.2 })],
    [Number(dimensions.counterAttack), squadMetric([...groups.MID, ...groups.ATT], { progression:.42, movement:.38, pressResistance:.2 })],
    [Number(dimensions.timeWasting), squadMetric([...groups.DEF, ...groups.MID], { buildUp:.38, pressResistance:.46, defensiveDuel:.16 })],
  ];
  const weights = demands.map(([intensity]) => .45 + Math.abs(intensity - 50) / 100);
  return demands.reduce((sum, [, score], index) => sum + score * weights[index], 0) / weights.reduce((sum, value) => sum + value, 0);
}

function spatialFit(players, roles, positions, formationLines, dimensions) {
  const lineY = (key, fallback) => Number(formationLines?.[key] ?? fallback);
  const defenseY = lineY("defense", average(players.filter((player) => roleGroup(roles[player.id]) === "DEF").map((player) => Number(positions[player.id]?.y)), 68));
  const midfieldY = lineY("midfield", 44);
  const attackY = lineY("attack", 20);
  const actualLength = defenseY - attackY;
  const desiredDefenseY = 80 - Number(dimensions.defensiveLine) * .36;
  const desiredLength = 61 - Number(dimensions.compactness) * .3;
  const outfieldX = players.filter((player) => roleGroup(roles[player.id]) !== "GK").map((player) => Number(positions[player.id]?.x ?? 50));
  const actualWidth = outfieldX.length ? Math.max(...outfieldX) - Math.min(...outfieldX) : 50;
  const desiredWidth = 38 + Number(dimensions.attackingWidth) * .46;
  const maximumGap = Math.max(defenseY - midfieldY, midfieldY - attackY);
  const lineTarget = 25 - Number(dimensions.compactness) * .07;
  const closeness = (actual, desired, tolerance) => clamp(100 - Math.abs(actual - desired) / tolerance * 35, 52, 100);
  return closeness(defenseY, desiredDefenseY, 18) * .32
    + closeness(actualLength, desiredLength, 24) * .28
    + closeness(actualWidth, desiredWidth, 34) * .24
    + closeness(maximumGap, lineTarget, 14) * .16;
}

export function calculateV2DutyFit(players, roles, plan = {}) {
  const scores = players.flatMap((player) => {
    const assignedRole = roles[player.id];
    const dutyId = plan.playerDuties?.[player.id];
    const score = dutyId ? v2PlayerDutySuitability(player, assignedRole, dutyId, positionFitScore(player, assignedRole)) : null;
    return Number.isFinite(score) ? [score] : [];
  });
  return scores.length ? average(scores) : null;
}

export function calculateV2StructureFit(players, roles, positions, formationLines, dimensions) {
  return Math.round(clamp(spatialFit(players, roles, positions, formationLines, dimensions), 45, 100));
}

export function calculateV2TacticalFit(players, roles, positions, formationLines, plan, dimensions) {
  const effectivePlayers = players.map((player) => player.effectiveAttributes ? { ...player, attributes:player.effectiveAttributes } : player);
  const groups = { GK:[], DEF:[], MID:[], ATT:[] };
  effectivePlayers.forEach((player) => groups[roleGroup(roles[player.id])].push(player));
  const wide = effectivePlayers.filter((player) => roleGroup(roles[player.id]) !== "GK" && (Number(positions[player.id]?.x ?? 50) <= 34 || Number(positions[player.id]?.x ?? 50) >= 66));
  const possession = inPossessionFit(plan, groups, wide);
  const defending = outOfPossessionFit(plan, groups);
  const execution = dimensionExecutionFit(dimensions, groups, wide);
  const structure = calculateV2StructureFit(effectivePlayers, roles, positions, formationLines, dimensions);
  const baseScore = possession * .3 + defending * .3 + execution * .25 + structure * .15;
  const duty = calculateV2DutyFit(effectivePlayers, roles, plan);
  const score = duty === null ? baseScore : baseScore * .85 + duty * .15;
  return Math.round(clamp(score, 45, 99));
}
