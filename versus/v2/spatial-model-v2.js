import { positionFitScore, roleGroup } from "../../game/public/schema.js";
import { traitPositionFit } from "../../game/public/trait-runtime.js";
import { inferElevenBoardRoles } from "../public/formation-rules.js";
import { resolveV2MatchParameters, V2_MATCH_PARAMETERS } from "./match-parameters-v2.js";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

function weightedMetric(player, weights) {
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + Number(player.attributes?.[key] ?? 50) * weight, 0);
}

function boardPosition(position = {}) {
  const x = Number(position.x);
  const y = Number(position.y);
  return {
    x:clamp(Number.isFinite(x) ? x : 50, 0, 100),
    y:clamp(Number.isFinite(y) ? y : 50, 0, 100),
  };
}

export function resolveV2TacticalDimensions(tactic = "balanced", style = "possession", custom = {}, parameters = V2_MATCH_PARAMETERS) {
  const dimensions = parameters.tactics.dimensions;
  const preset = parameters.tactics.mentalityPresets[tactic] ?? parameters.tactics.mentalityPresets.balanced;
  const adjustment = parameters.tactics.styleAdjustments[style] ?? {};
  return Object.freeze(Object.fromEntries(Object.entries(dimensions).map(([key, range]) => [
    key,
    round(clamp(Object.hasOwn(custom ?? {}, key) ? Number(custom[key]) : Number(preset[key]) + Number(adjustment[key] ?? 0), range.minimum, range.maximum), 2),
  ])));
}

export function v2WorldPosition(position, teamIndex) {
  const local = boardPosition(position);
  return teamIndex === 0
    ? { x:local.x, y:100 - local.y }
    : { x:100 - local.x, y:local.y };
}

export function v2PerspectivePosition(position, teamIndex) {
  const world = boardPosition(position);
  return teamIndex === 0
    ? { x:world.x, y:world.y }
    : { x:100 - world.x, y:100 - world.y };
}

export function createV2Zones(parameters = V2_MATCH_PARAMETERS) {
  const { columns, rows } = parameters.spatial.grid;
  const cellWidth = parameters.spatial.pitch.width / columns;
  const cellHeight = parameters.spatial.pitch.length / rows;
  return Object.freeze(parameters.spatial.bands.flatMap((band, row) => parameters.spatial.lanes.map((lane, column) => Object.freeze({
    id:`${band}:${lane}`,
    band,
    lane,
    row,
    column,
    center:Object.freeze({ x:(column + 0.5) * cellWidth, y:(row + 0.5) * cellHeight }),
    bounds:Object.freeze({ xMin:column * cellWidth, xMax:(column + 1) * cellWidth, yMin:row * cellHeight, yMax:(row + 1) * cellHeight }),
  }))));
}

function adjustedLocalPosition(position, assignedRole, dimensions, parameters, outOfPossessionDetails = {}) {
  const base = boardPosition(position);
  const maximum = parameters.spatial.tacticalDisplacementMaximum;
  const group = roleGroup(assignedRole);
  const mentalityShift = (dimensions.mentality - 50) / 50 * maximum * 0.34;
  const lineShift = group === "DEF" ? (dimensions.defensiveLine - 50) / 50 * maximum * 0.66 : 0;
  const pressingShift = group !== "GK" ? (dimensions.pressing - 50) / 50 * maximum * 0.2 : 0;
  const compactness = (dimensions.compactness - 50) / 50;
  const widthScale = 1 + (dimensions.attackingWidth - 50) / 50 * 0.16 - compactness * 0.1;
  const verticalCompactness = group === "GK" ? 0 : compactness * 0.06;
  const defensiveDirection = outOfPossessionDetails.defenseDirection ?? "balanced";
  const defensiveWidth = outOfPossessionDetails.defensiveWidth ?? "balanced";
  const defensiveShift = group === "DEF" || group === "MID" ? ({ left:-4, center:0, right:4, balanced:0 }[defensiveDirection] ?? 0) : 0;
  const defensiveWidthScale = group === "DEF" || group === "MID" ? ({ protectCenter:.86, balanced:1, forceWide:1.1 }[defensiveWidth] ?? 1) : 1;
  return {
    x:clamp(50 + (base.x - 50) * widthScale * defensiveWidthScale + defensiveShift, 0, 100),
    y:clamp(50 + (base.y - 50) * (1 - verticalCompactness) - mentalityShift - lineShift - pressingShift, 0, 100),
  };
}

function playerSpatialProfile(player, assignedRole, position, teamIndex, dimensions, parameters, outOfPossessionDetails) {
  const localPosition = adjustedLocalPosition(position, assignedRole, dimensions, parameters, outOfPossessionDetails);
  const worldPosition = v2WorldPosition(localPosition, teamIndex);
  const fitness = clamp(Number(player.state?.fitness ?? player.fitness ?? 100), parameters.ability.fitnessMinimum, parameters.ability.fitnessMaximum);
  const fitnessFactor = 0.72 + fitness / 357;
  const fit = clamp(traitPositionFit({ ...player, assignedRole, traitDefinitions:(player.v2AppliedTraitIds ?? []).map((id) => ({ id, rules:(player.v2TraitHooks ?? []).filter((rule) => rule.traitId === id) })) }, positionFitScore(player, assignedRole)), 0.35, 1.04);
  const execution = fitnessFactor * (0.72 + fit * 0.28);
  const metrics = Object.fromEntries(Object.entries(parameters.metrics).map(([key, weights]) => [key, weightedMetric(player, weights) * execution]));
  return {
    id:player.id,
    name:player.name,
    role:player.role,
    assignedRole,
    group:roleGroup(assignedRole),
    fit:round(fit),
    fitness:round(fitness, 2),
    heightCm:Number(player.heightCm ?? 180),
    v2TraitHooks:player.v2TraitHooks ?? [],
    localPosition,
    worldPosition,
    metrics,
  };
}

function influenceAt(profile, zone, parameters) {
  const distance = Math.hypot(profile.worldPosition.x - zone.center.x, profile.worldPosition.y - zone.center.y);
  if (distance > parameters.spatial.influenceRadius) return 0;
  const influence = Math.exp(-distance * distance * parameters.spatial.influenceFalloff);
  return influence >= parameters.spatial.minimumInfluence ? influence : 0;
}

function influenceValues(profile) {
  const group = profile.group;
  const role = profile.assignedRole;
  const control = profile.metrics.buildUp * 0.36 + profile.metrics.progression * 0.34 + profile.metrics.pressResistance * 0.3;
  const attack = profile.metrics.chanceCreation * 0.42 + profile.metrics.movement * 0.34 + profile.metrics.finishing * 0.24;
  const defense = profile.metrics.defensiveDuel * 0.55 + profile.metrics.shotPrevention * 0.45;
  const pressure = profile.metrics.pressing;
  const pressResistance = profile.metrics.pressResistance;
  const support = profile.metrics.movement * 0.42 + profile.metrics.buildUp * 0.33 + profile.metrics.pressing * 0.25;
  const groupFactors = {
    GK:{ control:0.18, attack:0.03, defense:0.8, pressure:0.08, pressResistance:0.45, support:0.18 },
    DEF:{ control:0.72, attack:0.4, defense:1, pressure:0.76, pressResistance:0.82, support:0.78 },
    MID:{ control:1, attack:0.78, defense:0.72, pressure:1, pressResistance:1, support:1 },
    ATT:{ control:0.72, attack:1, defense:0.28, pressure:0.74, pressResistance:0.8, support:0.75 },
  }[group] ?? { control:0.7, attack:0.7, defense:0.7, pressure:0.7, pressResistance:0.7, support:0.7 };
  // Exact roles refine the broad line group. This prevents a lone-striker
  // formation from treating its AM as an ordinary central midfielder, and
  // lets advanced wing-backs contribute without being reclassified as forwards.
  const roleAdjustments = {
    AM:{ attack:1.2, defense:0.78, support:1.05 },
    DM:{ attack:0.78, defense:1.2, pressure:1.04 },
    LM:{ attack:1.08, defense:0.92 }, RM:{ attack:1.08, defense:0.92 },
    LB:{ attack:1.25, defense:0.94, support:1.08 }, RB:{ attack:1.25, defense:0.94, support:1.08 },
    LWB:{ attack:1.42, defense:0.86, support:1.12 }, RWB:{ attack:1.42, defense:0.86, support:1.12 },
  }[role] ?? {};
  return Object.fromEntries(Object.entries({ control, attack, defense, pressure, pressResistance, support }).map(([key, value]) => [key, value * groupFactors[key] * Number(roleAdjustments[key] ?? 1)]));
}

function projectTeam(team, teamIndex, zones, parameters) {
  const positions = team.positions ?? {};
  const roles = team.spatialRoles ?? inferElevenBoardRoles((team.players ?? []).map((player) => ({ id:player.id, position:positions[player.id] })), team.formationLines);
  const dimensions = resolveV2TacticalDimensions(team.tactic, team.style, team.tacticalDimensions, parameters);
  const players = (team.players ?? []).filter((player) => player.active !== false).map((player) => playerSpatialProfile(
    player,
    roles[player.id] ?? player.assignedRole ?? player.role,
    positions[player.id],
    teamIndex,
    dimensions,
    parameters,
    team.outOfPossessionDetails,
  ));
  const zoneValues = Object.fromEntries(zones.map((zone) => {
    const contributions = players.map((player) => {
      const influence = influenceAt(player, zone, parameters);
      const values = influenceValues(player);
      return { player, influence, values };
    }).filter((entry) => entry.influence > 0);
    const totals = { occupancy:0, control:0, attack:0, defense:0, pressure:0, pressResistance:0, support:0 };
    contributions.forEach(({ influence, values }) => {
      totals.occupancy += influence;
      for (const key of ["control", "attack", "defense", "pressure", "pressResistance", "support"]) totals[key] += values[key] * influence;
    });
    return [zone.id, {
      ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value)])),
      contributors:contributions.sort((left, right) => right.influence - left.influence).slice(0, 4).map(({ player, influence }) => ({ id:player.id, role:player.assignedRole, influence:round(influence) })),
    }];
  }));
  return { teamIndex, name:team.name, tactic:team.tactic ?? "balanced", style:team.style ?? "possession", inPossessionDetails:team.inPossessionDetails ?? null, outOfPossessionDetails:team.outOfPossessionDetails ?? null, v2Snapshot:team.v2Snapshot ?? null, dimensions, players, zones:zoneValues };
}

function zoneForWorldPosition(position, zones) {
  const maximumColumn = Math.max(...zones.map((zone) => zone.column));
  const maximumRow = Math.max(...zones.map((zone) => zone.row));
  return zones.find((zone) => (
    position.x >= zone.bounds.xMin
    && (position.x < zone.bounds.xMax || (zone.column === maximumColumn && position.x <= zone.bounds.xMax))
    && position.y >= zone.bounds.yMin
    && (position.y < zone.bounds.yMax || (zone.row === maximumRow && position.y <= zone.bounds.yMax))
  )) ?? zones[0];
}

function buildConnections(teamProjection, opponentProjection, zones, parameters) {
  const occupied = zones.filter((zone) => teamProjection.zones[zone.id].occupancy >= parameters.spatial.minimumInfluence);
  const connections = [];
  for (let firstIndex = 0; firstIndex < occupied.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < occupied.length; secondIndex += 1) {
      const first = occupied[firstIndex];
      const second = occupied[secondIndex];
      const distance = Math.hypot(first.center.x - second.center.x, first.center.y - second.center.y);
      if (distance > parameters.spatial.connectionDistance * 1.7) continue;
      const midpoint = { x:(first.center.x + second.center.x) / 2, y:(first.center.y + second.center.y) / 2 };
      const middleZone = zoneForWorldPosition(midpoint, zones);
      const own = (teamProjection.zones[first.id].support + teamProjection.zones[second.id].support) / 2;
      const opposition = opponentProjection.zones[middleZone.id].pressure;
      const quality = clamp((own + 25) / (own + opposition + 50) * (1 - distance / (parameters.spatial.connectionDistance * 4)), 0, 1);
      connections.push({ from:first.id, to:second.id, via:middleZone.id, distance:round(distance, 2), quality:round(quality) });
    }
  }
  return connections.sort((left, right) => right.quality - left.quality);
}

function perspectiveZone(zone, teamIndex, zones) {
  if (teamIndex === 0) return zone;
  const point = v2PerspectivePosition(zone.center, teamIndex);
  return zoneForWorldPosition(point, zones);
}

function perspectiveConnections(connections, teamIndex, zones) {
  if (teamIndex === 0) return connections;
  const zoneById = Object.fromEntries(zones.map((zone) => [zone.id, zone]));
  return connections.map((connection) => ({
    ...connection,
    from:perspectiveZone(zoneById[connection.from], teamIndex, zones).id,
    to:perspectiveZone(zoneById[connection.to], teamIndex, zones).id,
    via:perspectiveZone(zoneById[connection.via], teamIndex, zones).id,
  }));
}

function teamZoneView(teamProjection, opponentProjection, teamIndex, zones, parameters) {
  const view = {};
  for (const worldZone of zones) {
    const localZone = perspectiveZone(worldZone, teamIndex, zones);
    const own = teamProjection.zones[worldZone.id];
    const opponent = opponentProjection.zones[worldZone.id];
    const ownControl = own.control + own.support * 0.24 + own.occupancy * 12;
    const opponentControl = opponent.control + opponent.pressure * 0.22 + opponent.occupancy * 12;
    const temperature = parameters.spatial.controlTemperature;
    const controlShare = 1 / (1 + Math.exp(-(ownControl - opponentControl) / temperature));
    const numericalAdvantage = clamp(own.occupancy - opponent.occupancy, -parameters.spatial.maximumLocalAdvantage, parameters.spatial.maximumLocalAdvantage);
    const attackingValue = own.attack * 0.4 + own.control * 0.25 + own.support * 0.2 + Math.max(0, numericalAdvantage) * 10;
    const resistance = opponent.defense * 0.48 + opponent.pressure * 0.32 + opponent.support * 0.2;
    view[localZone.id] = {
      zone:localZone.id,
      lane:localZone.lane,
      band:localZone.band,
      worldZone:worldZone.id,
      own,
      opponent,
      controlShare:round(controlShare),
      numericalAdvantage:round(numericalAdvantage),
      overload:numericalAdvantage >= parameters.spatial.overloadPlayerAdvantage,
      pressureDelta:round(own.pressure - opponent.pressResistance),
      exploitableSpace:round(clamp(1 - opponent.occupancy / 1.6, 0, 1)),
      progressionEdge:round(clamp((attackingValue - resistance) / 100, -1, 1)),
    };
  }
  return view;
}

function summarizeTeam(teamProjection, zoneView, connections, parameters) {
  const entries = Object.values(zoneView);
  const controlled = entries.filter((entry) => entry.controlShare >= 0.55);
  const finalThird = entries.filter((entry) => ["finalThird", "box"].includes(entry.band));
  const center = entries.filter((entry) => ["leftHalfSpace", "center", "rightHalfSpace"].includes(entry.lane));
  const flanks = entries.filter((entry) => ["farLeft", "farRight"].includes(entry.lane));
  const weightedAverage = (values, fallback = 0.5) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
  const topZones = [...entries].sort((left, right) => right.progressionEdge - left.progressionEdge || right.controlShare - left.controlShare).slice(0, 5);
  return {
    teamIndex:teamProjection.teamIndex,
    name:teamProjection.name,
    tactic:teamProjection.tactic,
    style:teamProjection.style,
    inPossessionDetails:teamProjection.inPossessionDetails,
    outOfPossessionDetails:teamProjection.outOfPossessionDetails,
    v2Snapshot:teamProjection.v2Snapshot,
    tacticalDimensions:teamProjection.dimensions,
    controlledZoneCount:controlled.length,
    overloadZoneCount:entries.filter((entry) => entry.overload).length,
    centralControl:round(weightedAverage(center.map((entry) => entry.controlShare))),
    flankControl:round(weightedAverage(flanks.map((entry) => entry.controlShare))),
    finalThirdControl:round(weightedAverage(finalThird.map((entry) => entry.controlShare))),
    boxPresence:round(weightedAverage(entries.filter((entry) => entry.band === "box").map((entry) => entry.own.occupancy), 0)),
    connectionQuality:round(weightedAverage(connections.map((connection) => connection.quality), 0)),
    strongConnectionCount:connections.filter((connection) => connection.quality >= 0.52).length,
    exploitableZones:topZones.map((entry) => ({ zone:entry.zone, progressionEdge:entry.progressionEdge, controlShare:entry.controlShare, overload:entry.overload })),
    zoneCount:parameters.spatial.grid.columns * parameters.spatial.grid.rows,
  };
}

export function buildV2SpatialMatchup(teams, options = {}) {
  if (!Array.isArray(teams) || teams.length !== 2) throw new Error("V2区域空间模型需要恰好两支球队");
  const parameters = options.parameters ? resolveV2MatchParameters(options.parameters) : V2_MATCH_PARAMETERS;
  const zones = createV2Zones(parameters);
  const projections = teams.map((team, index) => projectTeam(team, index, zones, parameters));
  const worldConnections = projections.map((team, index) => buildConnections(team, projections[index === 0 ? 1 : 0], zones, parameters));
  const connections = worldConnections.map((teamConnections, index) => perspectiveConnections(teamConnections, index, zones));
  const zoneViews = projections.map((team, index) => teamZoneView(team, projections[index === 0 ? 1 : 0], index, zones, parameters));
  return Object.freeze({
    engineVersion:parameters.engineVersion,
    modelVersion:"spatial-v2-alpha.1",
    grid:parameters.spatial.grid,
    zones,
    teams:projections.map((team, index) => ({
      ...summarizeTeam(team, zoneViews[index], connections[index], parameters),
      players:team.players.map((player) => ({
        id:player.id,
        name:player.name,
        assignedRole:player.assignedRole,
        group:player.group,
        fit:player.fit,
        fitness:player.fitness,
        localPosition:player.localPosition,
        worldPosition:player.worldPosition,
        metrics:{ ...player.metrics },
      })),
      zones:zoneViews[index],
      connections:connections[index],
    })),
  });
}

function stageMovementPosition(position, assignedRole, movement, direction, dimensions, parameters) {
  const base = boardPosition(position);
  const advance = Number(parameters.spatial.stageAdvance[movement]?.[assignedRole] ?? 0);
  const mentalityFactor = direction < 0 ? 0.76 + dimensions.mentality / 210 : 0.72 + dimensions.compactness / 250;
  const distance = advance * mentalityFactor * (direction < 0 ? 1 : parameters.spatial.defensiveTrackingRatio);
  const centralRun = ["AM", "LM", "RM", "LW", "RW"].includes(assignedRole) && ["chance", "shot"].includes(movement) ? 0.1 : 0;
  return {
    x:clamp(50 + (base.x - 50) * (1 - centralRun), 0, 100),
    y:clamp(base.y + direction * distance, 0, 100),
  };
}

export function buildV2StageSpatialMatchup(teams, attackingTeamIndex, stage, options = {}) {
  if (![0, 1].includes(attackingTeamIndex)) throw new Error("V2阶段空间需要有效的进攻方索引");
  if (!V2_MATCH_PARAMETERS.chain.stages.slice(1).includes(stage)) throw new Error(`未知V2控球阶段：${stage}`);
  const parameters = options.parameters ? resolveV2MatchParameters(options.parameters) : V2_MATCH_PARAMETERS;
  const stagedTeams = teams.map((team, teamIndex) => {
    const positions = team.positions ?? {};
    const roles = inferElevenBoardRoles((team.players ?? []).map((player) => ({ id:player.id, position:positions[player.id] })), team.formationLines);
    const dimensions = resolveV2TacticalDimensions(team.tactic, team.style, team.tacticalDimensions, parameters);
    const direction = teamIndex === attackingTeamIndex ? -1 : 1;
    return {
      ...team,
      spatialRoles:roles,
      positions:Object.fromEntries((team.players ?? []).map((player) => {
        const assignedRole = roles[player.id] ?? player.assignedRole ?? player.role;
        return [player.id, stageMovementPosition(positions[player.id], assignedRole, stage, direction, dimensions, parameters)];
      })),
    };
  });
  return buildV2SpatialMatchup(stagedTeams, { parameters });
}

export function buildV2StageSpatialCache(teams, options = {}) {
  const parameters = options.parameters ? resolveV2MatchParameters(options.parameters) : V2_MATCH_PARAMETERS;
  return Object.freeze([0, 1].map((attackingTeamIndex) => Object.freeze(Object.fromEntries(
    parameters.chain.stages.slice(1).map((stage) => [stage, buildV2StageSpatialMatchup(teams, attackingTeamIndex, stage, { parameters })]),
  ))));
}
