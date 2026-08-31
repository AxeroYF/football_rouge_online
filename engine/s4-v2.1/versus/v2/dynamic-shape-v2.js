import { v2DutyMovement, v2DutyRestDefensePriority } from "./player-duties-v2.js";

export const V21_DYNAMIC_SHAPE_MODEL_VERSION = "dynamic-shape-v2.1-stable.9";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));

const BALL_LANE_X = Object.freeze({
  farLeft:10,
  leftHalfSpace:32,
  center:50,
  rightHalfSpace:68,
  farRight:90,
});

const ATTACKING_DEPTH = Object.freeze({
  GK:6,
  CB:16,
  FB:26,
  WB:29,
  DM:20,
  CM:24,
  AM:25,
  W:25,
  ST:17,
});

const DEFENDING_DEPTH = Object.freeze({
  GK:1.5,
  CB:11,
  FB:13,
  WB:15,
  DM:18,
  CM:21,
  AM:24,
  W:26,
  ST:28,
});

const ATTACKING_ROLE_ADVANCE_CAP = Object.freeze({
  GK:0.2,
  CB:0.45,
  FB:0.65,
  WB:0.72,
  DM:0.62,
  CM:0.72,
  AM:0.58,
  W:0.52,
  ST:0.5,
});

const REST_DUTIES = new Set(["anchor", "holdingFullback", "coverDefender", "deepLyingPlaymaker", "invertedFullback"]);

const DEFAULT_DUTY_DEPTH = Object.freeze({
  attacking:{ GK:0.05, CB:0.28, FB:0.38, WB:0.46, DM:0.48, CM:0.72, AM:0.68, W:0.74, ST:0.82 },
  defending:{ GK:0.12, CB:0.78, FB:0.73, WB:0.7, DM:0.82, CM:0.62, AM:0.5, W:0.42, ST:0.34 },
});

function resolvedDepthMultiplier(player, genericRole, attacking, dutyMovement) {
  if (attacking && player.tacticalDuty === "targetForward") return 0.12;
  if (attacking && player.tacticalDuty === "deepLyingForward") return -0.34;
  if (player.tacticalDuty) return Number(attacking ? dutyMovement.attackingDepth : dutyMovement.defendingDepth);
  return Number(DEFAULT_DUTY_DEPTH[attacking ? "attacking" : "defending"][genericRole] ?? 0.5);
}

function defensiveLineDepthMultiplier(player, genericRole, attacking, dimensions) {
  if (REST_DUTIES.has(player.tacticalDuty)) return 1;
  const roleInfluence = {
    CB:0.9, FB:0.8, WB:0.82, DM:0.65, CM:0.55,
    AM:0.5, W:0.4, ST:0.34, GK:0.05,
  }[genericRole] ?? 0.45;
  const line = clamp(Number(dimensions.defensiveLine ?? 50), 0, 100) / 100;
  const lineDelta = (line - 0.5) * 2 * roleInfluence;
  return attacking ? 1 + lineDelta : 1 - lineDelta;
}

function attackingAdvanceCap(player, genericRole) {
  if (player.tacticalDuty === "bylineWinger") return 0.9;
  if (player.tacticalDuty === "targetForward") return 0.24;
  if (player.tacticalDuty === "deepLyingForward") return 0.35;
  return Number(ATTACKING_ROLE_ADVANCE_CAP[genericRole] ?? 0.65);
}

function mentalityRoleMultiplier({ player, genericRole, attacking, dimensions, dutyMovement }) {
  const mentality = (Number(dimensions.mentality ?? 50) - 50) / 50;
  const counterAttack = Number(dimensions.counterAttack ?? 50);
  const restDuty = REST_DUTIES.has(player.tacticalDuty);
  if (restDuty) return attacking ? 0.48 : 0.62;
  const front = ["ST", "W", "AM"].includes(genericRole);
  const back = ["CB", "FB", "WB", "DM"].includes(genericRole);
  let multiplier = 1 + mentality * (front ? 0.72 : back ? 0.46 : 0.58);
  if (counterAttack >= 58 && mentality < 0 && !attacking) multiplier *= front ? 0.88 : 0.62;
  if (counterAttack >= 58 && mentality < 0 && attacking) multiplier *= front ? 1.2 : 0.62;
  if (mentality <= -0.45) multiplier *= attacking ? (front ? 0.72 : 0.58) : 0.7;
  return clamp(multiplier, 0.28, 1.72);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function boardPosition(position = {}, bounds) {
  const x = Number(position.x);
  const y = Number(position.y);
  return {
    x:clamp(Number.isFinite(x) ? x : 50, bounds.minimumX, bounds.maximumX),
    y:clamp(Number.isFinite(y) ? y : 50, bounds.minimumY, bounds.maximumY),
  };
}

export function normalizeV21DynamicRole(role) {
  const value = String(role ?? "CM").toUpperCase();
  if (value === "GK") return "GK";
  if (value === "CB" || value.endsWith("CB")) return "CB";
  if (["LB", "RB"].includes(value)) return "FB";
  if (["LWB", "RWB"].includes(value)) return "WB";
  if (["DM", "CDM"].includes(value)) return "DM";
  if (["AM", "CAM"].includes(value)) return "AM";
  if (["LW", "RW", "LM", "RM"].includes(value)) return "W";
  if (["ST", "CF", "SS"].includes(value)) return "ST";
  return "CM";
}

function widthScale(dimensions, attacking, config) {
  if (attacking) {
    return 1 + (Number(dimensions.attackingWidth ?? 50) - 50) / 50 * Number(config.widthInfluence.attacking);
  }
  return 1 - (Number(dimensions.compactness ?? 50) - 50) / 50 * Number(config.widthInfluence.defending);
}

function ballPullFactor(genericRole) {
  return ({ GK:0.05, CB:0.35, FB:0.75, WB:0.95, DM:0.8, CM:1, AM:1, W:0.9, ST:0.7 })[genericRole] ?? 0.8;
}

function phaseTwoContext(team, attacking, possessionType, config) {
  const phaseTwo = config.phaseTwo ?? {};
  const enabled = phaseTwo.enabled === true;
  const scoreState = team.v2Snapshot?.scoreState ?? "level";
  const minute = clamp(Number(team.v2Snapshot?.minute ?? 0), 0, 120);
  const startMinute = Number(phaseTwo.scoreState?.startMinute ?? 55);
  const matchStateProgress = clamp((minute - startMinute) / Math.max(1, 90 - startMinute), 0, 1);
  const activeCount = (team.players ?? []).filter((player) => player.active !== false).length;
  const referencePlayers = Number(phaseTwo.underload?.referencePlayers ?? 11);
  const maximumMissingPlayers = Number(phaseTwo.underload?.maximumMissingPlayers ?? 3);
  const missingPlayers = clamp(referencePlayers - activeCount, 0, maximumMissingPlayers);
  let scoreVerticalShift = 0;
  let scoreWidthMultiplier = 1;
  if (enabled && scoreState === "trailing") {
    scoreVerticalShift = -Number(attacking
      ? phaseTwo.scoreState?.trailingAttackingAdvance
      : phaseTwo.scoreState?.trailingDefendingAdvance) * matchStateProgress;
    scoreWidthMultiplier += Number(phaseTwo.scoreState?.trailingWidthExpansion ?? 0) * matchStateProgress;
  }
  if (enabled && scoreState === "leading") {
    scoreVerticalShift = Number(attacking
      ? phaseTwo.scoreState?.leadingAttackingRetreat
      : phaseTwo.scoreState?.leadingDefendingRetreat) * matchStateProgress;
    scoreWidthMultiplier -= Number(phaseTwo.scoreState?.leadingWidthCompression ?? 0) * matchStateProgress;
  }
  return {
    enabled,
    scoreState,
    minute,
    matchStateProgress,
    activeCount,
    missingPlayers,
    scoreVerticalShift,
    scoreWidthMultiplier,
    transitionRecovery:possessionType === "transition" && !attacking,
  };
}

function movePlayer({ player, assignedRole, basePosition, attacking, intensity, ballX, dimensions, possessionType, phaseContext, config }) {
  const bounds = config.pitchBounds;
  const base = boardPosition(basePosition, bounds);
  const genericRole = normalizeV21DynamicRole(assignedRole);
  const dutyMovement = v2DutyMovement(player, assignedRole);
  const mobility = Number(config.roleMobility[genericRole] ?? 0.8);
  const mentality = (Number(dimensions.mentality ?? 50) - 50) / 50;
  const compactness = (Number(dimensions.compactness ?? 50) - 50) / 50;
  const depthMaximum = Number((attacking ? ATTACKING_DEPTH : DEFENDING_DEPTH)[genericRole] ?? 14);
  const depthFactor = attacking ? 1 + mentality * 0.16 : 1 + compactness * 0.12;
  const transition = possessionType === "transition";
  let transitionDepthMultiplier = transition
    ? Number(attacking ? config.transition.attackingDepthMultiplier : config.transition.defendingRecoveryMultiplier)
    : 1;
  if (transition && phaseContext.enabled) {
    const roleMultipliers = attacking
      ? config.phaseTwo.transitionRecovery.attackingRunMultiplier
      : config.phaseTwo.transitionRecovery.roleDepthMultiplier;
    transitionDepthMultiplier *= Number(roleMultipliers[genericRole] ?? 1);
  }
  const dutyDepthMultiplier = resolvedDepthMultiplier(player, genericRole, attacking, dutyMovement);
  const highPressDmBoost = attacking && genericRole === "DM"
    ? 1 + Math.max(0, Number(dimensions.pressing ?? 50) - 50) / 50 * 0.4
    : 1;
  const effectiveDutyDepthMultiplier = attacking && genericRole === "DM" && Number(dimensions.pressing ?? 50) >= 65
    ? Math.max(dutyDepthMultiplier, 0.62)
    : dutyDepthMultiplier;
  const rawDepthShift = depthMaximum * intensity * mobility * depthFactor * transitionDepthMultiplier
    * effectiveDutyDepthMultiplier * highPressDmBoost
    * mentalityRoleMultiplier({ player, genericRole, attacking, dimensions, dutyMovement })
    * defensiveLineDepthMultiplier(player, genericRole, attacking, dimensions);
  const availableAdvance = Math.max(0, base.y - bounds.minimumY);
  const line = clamp(Number(dimensions.defensiveLine ?? 50), 0, 100) / 100;
  const roleAdvanceCap = attackingAdvanceCap(player, genericRole)
    * (attacking ? 0.7 + line * 0.6 : 1);
  const depthShift = attacking
    ? rawDepthShift < 0
      ? Math.max(rawDepthShift, -Math.max(2, availableAdvance * roleAdvanceCap))
      : Math.min(rawDepthShift, Math.max(2, availableAdvance * roleAdvanceCap))
    : rawDepthShift;
  const transitionWidthMultiplier = transition && attacking ? Number(config.transition.attackingWidthMultiplier) : 1;
  let collectiveWidthMultiplier = phaseContext.scoreWidthMultiplier;
  if (phaseContext.enabled && phaseContext.missingPlayers > 0) {
    collectiveWidthMultiplier *= Math.max(0.72, 1 - phaseContext.missingPlayers * Number(config.phaseTwo.underload.widthCompressionPerMissing));
  }
  if (transition && !attacking && phaseContext.enabled) {
    collectiveWidthMultiplier *= Number(config.phaseTwo.transitionRecovery.defendingWidthMultiplier);
  }
  let x = 50 + (base.x - 50) * widthScale(dimensions, attacking, config) * transitionWidthMultiplier * collectiveWidthMultiplier * Number(dutyMovement.width);
  let y = base.y + (attacking ? -1 : 1) * depthShift;

  if (phaseContext.enabled && attacking && ["FB", "WB", "W"].includes(genericRole)) {
    const lateStage = intensity >= Number(config.stageIntensity.chance ?? 0.86);
    const expansion = Number(config.phaseTwo.wideOccupancy.attackingRoleExpansion)
      + (lateStage ? Number(config.phaseTwo.wideOccupancy.lateStageExpansion) : 0);
    x = 50 + (x - 50) * (1 + expansion * intensity);
  }

  if (phaseContext.enabled) {
    y += phaseContext.scoreVerticalShift * (0.45 + intensity * 0.55);
    if (phaseContext.missingPlayers > 0) {
      y += phaseContext.missingPlayers * Number(attacking
        ? config.phaseTwo.underload.attackingRestraintPerMissing
        : config.phaseTwo.underload.defensiveRetreatPerMissing) * (0.5 + intensity * 0.5);
    }
  }

  const pull = Number(attacking ? config.ballSidePull.attacking : config.ballSidePull.defending);
  x += (ballX - x) * pull * intensity * ballPullFactor(genericRole) * Number(dutyMovement.ballPull);

  const onLeft = base.x < 50;
  const ballOnLeft = ballX < 50;
  const hasBallSide = ballX !== 50;
  const ballSideWidePlayer = ["FB", "WB"].includes(genericRole) && hasBallSide && onLeft === ballOnLeft;
  const farSideWidePlayer = ["FB", "WB"].includes(genericRole) && hasBallSide && onLeft !== ballOnLeft;
  if (attacking && ballSideWidePlayer) y -= Number(config.fullback.ballSideAdvance) * intensity * mobility * Number(dutyMovement.ballSideAdvance);
  if (attacking && farSideWidePlayer) {
    y += Number(config.fullback.farSideDepthRetention) * intensity;
    x = 50 + (x - 50) * (1 - Number(config.fullback.farSideTuck) * intensity * Number(dutyMovement.farSideTuck));
  }

  if (genericRole === "DM" && attacking) {
    x += (ballX - x) * Number(config.defensiveMidfielder.coverShift) * intensity;
  }

  const influence = config.mode === "stable" ? Number(config.stableInfluence) : 1;
  x = base.x + (x - base.x) * influence;
  y = base.y + (y - base.y) * influence;

  return {
    id:player.id,
    assignedRole,
    tacticalDuty:player.tacticalDuty ?? null,
    genericRole,
    basePosition:base,
    targetPosition:{
      x:clamp(x, bounds.minimumX, bounds.maximumX),
      y:clamp(y, bounds.minimumY, bounds.maximumY),
    },
  };
}

function enforceAttackingRoleDepthOrder(players, config) {
  const strikers = players.filter((player) => player.genericRole === "ST");
  if (!strikers.length) return players;
  const strikerFront = Math.min(...strikers.map((player) => player.targetPosition.y));
  players.forEach((player) => {
    if (player.genericRole === "AM") player.targetPosition.y = Math.max(player.targetPosition.y, strikerFront + 3.5);
  });
  players.forEach((player) => constrainPlayerPosition(player, config));
  return players;
}

function constrainPlayerPosition(player, config) {
  const bounds = config.pitchBounds;
  const target = player.targetPosition;
  target.x = clamp(target.x, bounds.minimumX, bounds.maximumX);
  target.y = clamp(target.y, bounds.minimumY, bounds.maximumY);
  if (config.restrictionsEnabled === false) return;
  const maximumDisplacement = Number(config.maximumPlayerDisplacement);
  const dx = target.x - player.basePosition.x;
  const dy = target.y - player.basePosition.y;
  const displacement = Math.hypot(dx, dy);
  if (!Number.isFinite(maximumDisplacement) || maximumDisplacement <= 0 || displacement <= maximumDisplacement) return;
  const scale = maximumDisplacement / displacement;
  target.x = clamp(player.basePosition.x + dx * scale, bounds.minimumX, bounds.maximumX);
  target.y = clamp(player.basePosition.y + dy * scale, bounds.minimumY, bounds.maximumY);
}

function deterministicSeparationDirection(leftIndex, rightIndex) {
  const angle = ((leftIndex + 1) * 137 + (rightIndex + 1) * 71) * Math.PI / 180;
  return { x:Math.cos(angle), y:Math.sin(angle) };
}

function enforceGeometryConstraints(players, config) {
  const adjusted = players.map((player) => ({ ...player, targetPosition:{ ...player.targetPosition } }));
  if (config.restrictionsEnabled === false) {
    adjusted.forEach((player) => constrainPlayerPosition(player, config));
    return adjusted;
  }
  const minimumDistance = Number(config.minimumPlayerDistance);
  const targetDistance = minimumDistance + Number(config.separation.tolerance);
  const maximumIterations = Number(config.separation.maximumIterations);
  adjusted.forEach((player) => constrainPlayerPosition(player, config));
  for (let pass = 0; pass < maximumIterations; pass += 1) {
    for (let leftIndex = 0; leftIndex < adjusted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < adjusted.length; rightIndex += 1) {
        const leftPlayer = adjusted[leftIndex];
        const rightPlayer = adjusted[rightIndex];
        const left = leftPlayer.targetPosition;
        const right = rightPlayer.targetPosition;
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= targetDistance) continue;
        const fallback = deterministicSeparationDirection(leftIndex, rightIndex);
        const directionX = distance > 0.0001 ? dx / distance : fallback.x;
        const directionY = distance > 0.0001 ? dy / distance : fallback.y;
        const leftMobility = Number(config.separation.roleCorrectionWeight[leftPlayer.genericRole] ?? 1);
        const rightMobility = Number(config.separation.roleCorrectionWeight[rightPlayer.genericRole] ?? 1);
        const totalMobility = Math.max(0.0001, leftMobility + rightMobility);
        const correction = targetDistance - distance;
        left.x -= directionX * correction * leftMobility / totalMobility;
        left.y -= directionY * correction * leftMobility / totalMobility;
        right.x += directionX * correction * rightMobility / totalMobility;
        right.y += directionY * correction * rightMobility / totalMobility;
        constrainPlayerPosition(leftPlayer, config);
        constrainPlayerPosition(rightPlayer, config);
      }
    }
    if (minimumPairDistance(adjusted) >= minimumDistance) break;
  }
  return adjusted;
}

function protectAttackingRestDefense(players, { attacking, ballX, stage, config }) {
  if (!attacking || config.restrictionsEnabled === false) return players;
  const eligible = players.filter((player) => ["CB", "FB", "WB", "DM"].includes(player.genericRole));
  const wideLateStage = ["chance", "shot"].includes(stage) && ballX !== BALL_LANE_X.center;
  const required = Math.min(eligible.length, Number(wideLateStage
    ? config.restDefense.lateWideMinimum
    : config.restDefense.attackingMinimum));
  const ballOnLeft = ballX < 50;
  const priority = (player) => {
    const wide = ["FB", "WB"].includes(player.genericRole);
    const farSide = ballX !== 50 && (player.basePosition.x < 50) !== ballOnLeft;
    const basePriority = wide && farSide ? 0
      : player.genericRole === "DM" ? 1
        : player.genericRole === "CB" && farSide ? 2
          : player.genericRole === "CB" && player.basePosition.x === 50 ? 3
            : player.genericRole === "CB" ? 4 : 5;
    return basePriority + v2DutyRestDefensePriority(player);
  };
  [...eligible]
    .sort((left, right) => priority(left) - priority(right)
      || right.basePosition.y - left.basePosition.y
      || String(left.id).localeCompare(String(right.id)))
    .slice(0, required)
    .forEach((player) => {
      player.restDefenseProtected = true;
      player.targetPosition.y = Math.max(player.targetPosition.y, Number(config.restDefense.protectionLineY));
    });
  return players;
}

function minimumPairDistance(players) {
  let minimum = Number.POSITIVE_INFINITY;
  for (let leftIndex = 0; leftIndex < players.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < players.length; rightIndex += 1) {
      const left = players[leftIndex].targetPosition;
      const right = players[rightIndex].targetPosition;
      minimum = Math.min(minimum, Math.hypot(right.x - left.x, right.y - left.y));
    }
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function summarizeShape(players) {
  const xs = players.map((player) => player.targetPosition.x);
  const ys = players.map((player) => player.targetPosition.y);
  const centroid = players.length ? {
    x:xs.reduce((sum, value) => sum + value, 0) / players.length,
    y:ys.reduce((sum, value) => sum + value, 0) / players.length,
  } : { x:50, y:50 };
  const displacements = players.map((player) => Math.hypot(
    player.targetPosition.x - player.basePosition.x,
    player.targetPosition.y - player.basePosition.y,
  ));
  return {
    centroid:{ x:round(centroid.x), y:round(centroid.y) },
    width:round(players.length ? Math.max(...xs) - Math.min(...xs) : 0),
    depth:round(players.length ? Math.max(...ys) - Math.min(...ys) : 0),
    maximumDisplacement:round(displacements.length ? Math.max(...displacements) : 0),
    averageDisplacement:round(displacements.length ? displacements.reduce((sum, value) => sum + value, 0) / displacements.length : 0),
    minimumPairDistance:round(minimumPairDistance(players)),
    restDefenseCount:players.filter((player) => ["CB", "FB", "WB", "DM"].includes(player.genericRole) && player.targetPosition.y >= 48).length,
  };
}

export function buildV21DynamicTeamShape({
  team,
  teamIndex,
  attackingTeamIndex,
  stage,
  roles = {},
  dimensions = {},
  ballLane = "center",
  possessionType = "normal",
  config,
}) {
  if (!config) throw new Error("V2.1 dynamic shape config is required");
  const attacking = teamIndex === attackingTeamIndex;
  const worldBallX = Number(BALL_LANE_X[ballLane] ?? BALL_LANE_X.center);
  const localBallX = attacking ? worldBallX : 100 - worldBallX;
  const intensity = Number(config.stageIntensity[stage] ?? 0);
  const positions = team.positions ?? {};
  const context = phaseTwoContext(team, attacking, possessionType, config);
  const moved = (team.players ?? []).filter((player) => player.active !== false).map((player) => {
    const assignedRole = roles[player.id] ?? player.assignedRole ?? player.role;
    return movePlayer({
      player,
      assignedRole,
      basePosition:positions[player.id],
      attacking,
      intensity,
      ballX:localBallX,
      dimensions,
      possessionType,
      phaseContext:context,
      config,
    });
  });
  if (attacking) enforceAttackingRoleDepthOrder(moved, config);
  protectAttackingRestDefense(moved, { attacking, ballX:localBallX, stage, config });
  const separated = enforceGeometryConstraints(moved, config).map((player) => ({
    id:player.id,
    assignedRole:player.assignedRole,
    tacticalDuty:player.tacticalDuty ?? null,
    genericRole:player.genericRole,
    basePosition:{ x:round(player.basePosition.x), y:round(player.basePosition.y) },
    targetPosition:{ x:round(player.targetPosition.x), y:round(player.targetPosition.y) },
    displacement:round(Math.hypot(
      player.targetPosition.x - player.basePosition.x,
      player.targetPosition.y - player.basePosition.y,
    )),
  }));
  return deepFreeze({
    teamIndex,
    formation:team.simulationFormation ?? team.formation ?? "unknown",
    attacking,
    ballLane,
    possessionType,
    localBallX,
    stage,
    context:{
      scoreState:context.scoreState,
      minute:round(context.minute, 2),
      matchStateProgress:round(context.matchStateProgress),
      activeCount:context.activeCount,
      missingPlayers:context.missingPlayers,
      transitionRecovery:context.transitionRecovery,
    },
    players:separated,
    metrics:summarizeShape(separated),
  });
}

export function buildV21DynamicShapeSnapshot({ teams, attackingTeamIndex, stage, contexts, ballLane = "center", possessionType = "normal", config }) {
  return deepFreeze({
    mode:config.mode,
    modelVersion:config.modelVersion ?? V21_DYNAMIC_SHAPE_MODEL_VERSION,
    stage,
    attackingTeamIndex,
    ballLane,
    possessionType,
    teams:teams.map((team, teamIndex) => buildV21DynamicTeamShape({
      team,
      teamIndex,
      attackingTeamIndex,
      stage,
      roles:contexts[teamIndex].roles,
      dimensions:contexts[teamIndex].dimensions,
      ballLane,
      possessionType,
      config,
    })),
  });
}
