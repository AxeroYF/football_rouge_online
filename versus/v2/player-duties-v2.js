import { V2_PLAYER_DUTY_OPTIONS } from "../public/v2-player-duty-options.js";

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const duty = (id, definition = {}) => ({
  ...V2_PLAYER_DUTY_OPTIONS[id],
  movement:{
    attackingDepth:1,
    defendingDepth:1,
    width:1,
    ballPull:1,
    ballSideAdvance:1,
    farSideTuck:1,
    ...(definition.movement ?? {}),
  },
  stage:{ ...(definition.stage ?? {}) },
  route:{ ...(definition.route ?? {}) },
  defenseStage:{ ...(definition.defenseStage ?? {}) },
  spatial:{ ...(definition.spatial ?? {}) },
  fatigue:Number(definition.fatigue ?? 1),
  offside:Number(definition.offside ?? 1),
  restDefensePriority:Number(definition.restDefensePriority ?? 0),
  shotPreference:definition.shotPreference ?? null,
  targetSupport:Boolean(definition.targetSupport),
});

export const V2_PLAYER_DUTIES = deepFreeze({
  advancedForward:duty("advancedForward", {
    movement:{ attackingDepth:1.22 },
    stage:{ buildUp:.72, progression:1.04, finalThird:1.16, chance:1.24, shot:1.34 },
    spatial:{ attack:1.08, support:.94 },
    fatigue:1.05,
    offside:1.2,
  }),
  targetForward:duty("targetForward", {
    movement:{ attackingDepth:.84, ballPull:.88 },
    stage:{ buildUp:.9, progression:1.22, finalThird:1.2, chance:1.04, shot:1.06 },
    route:{ direct:1.7, structured:1.08, counter:.88 },
    spatial:{ control:1.04, support:1.12, attack:1.03 },
    fatigue:1.04,
    targetSupport:true,
  }),
  deepLyingForward:duty("deepLyingForward", {
    movement:{ attackingDepth:.64, ballPull:1.12 },
    stage:{ buildUp:1.28, progression:1.34, finalThird:1.18, chance:1.14, shot:.7 },
    spatial:{ control:1.1, support:1.14, attack:.94 },
    offside:.78,
  }),

  bylineWinger:duty("bylineWinger", {
    movement:{ attackingDepth:1.08, width:1.16, ballPull:.76 },
    stage:{ progression:1.08, finalThird:1.2, chance:1.2, shot:.82 },
    spatial:{ attack:1.05, support:1.08 },
    fatigue:1.06,
    shotPreference:"cross",
  }),
  insideForward:duty("insideForward", {
    movement:{ attackingDepth:1.14, width:.7, ballPull:1.1 },
    stage:{ buildUp:.86, progression:1.04, finalThird:1.16, chance:1.23, shot:1.32 },
    spatial:{ attack:1.1, control:.96 },
    fatigue:1.05,
    offside:1.1,
    shotPreference:"inside",
  }),

  advancedPlaymaker:duty("advancedPlaymaker", {
    movement:{ attackingDepth:.84, width:.9, ballPull:1.12 },
    stage:{ buildUp:1.12, progression:1.28, finalThird:1.3, chance:1.38, shot:.68 },
    spatial:{ control:1.1, attack:1.04, support:1.14 },
  }),
  shadowStriker:duty("shadowStriker", {
    movement:{ attackingDepth:1.3, ballPull:.94 },
    stage:{ buildUp:.72, progression:.92, finalThird:1.14, chance:1.24, shot:1.42 },
    spatial:{ attack:1.12, support:.92 },
    fatigue:1.06,
    offside:1.12,
  }),

  anchor:duty("anchor", {
    movement:{ attackingDepth:.34, defendingDepth:1.08, ballPull:.72 },
    stage:{ buildUp:1.04, progression:.86, finalThird:.62, chance:.48, shot:.3 },
    defenseStage:{ buildUp:1.08, progression:1.12, finalThird:1.18, chance:1.16, shot:1.12 },
    spatial:{ defense:1.12, support:1.04, attack:.72 },
    restDefensePriority:-3,
  }),
  ballWinningMidfielder:duty("ballWinningMidfielder", {
    movement:{ attackingDepth:.78, defendingDepth:.7, ballPull:1.18 },
    stage:{ buildUp:.82, progression:.9, finalThird:.78, chance:.62, shot:.38 },
    defenseStage:{ buildUp:1.34, progression:1.38, finalThird:1.3, chance:1.22, shot:1.04 },
    spatial:{ defense:1.08, pressure:1.16, support:.96 },
    fatigue:1.14,
    restDefensePriority:1,
  }),
  deepLyingPlaymaker:duty("deepLyingPlaymaker", {
    movement:{ attackingDepth:.48, ballPull:1.04 },
    stage:{ buildUp:1.4, progression:1.28, finalThird:.9, chance:.76, shot:.42 },
    defenseStage:{ buildUp:.92, progression:.96, finalThird:.9, chance:.88, shot:.9 },
    spatial:{ control:1.12, support:1.1, defense:.96 },
    restDefensePriority:-1,
  }),

  wideMidfielder:duty("wideMidfielder", {
    movement:{ attackingDepth:.94, width:1.12, ballPull:.86 },
    stage:{ buildUp:1.02, progression:1.1, finalThird:1.12, chance:1.04, shot:.82 },
    defenseStage:{ buildUp:1.04, progression:1.06, finalThird:1.02 },
    spatial:{ support:1.08 },
    fatigue:1.04,
    shotPreference:"cross",
  }),
  invertedWideMidfielder:duty("invertedWideMidfielder", {
    movement:{ attackingDepth:.9, width:.68, ballPull:1.12 },
    stage:{ buildUp:1.16, progression:1.24, finalThird:1.16, chance:1.08, shot:.78 },
    spatial:{ control:1.1, support:1.1 },
    shotPreference:"inside",
  }),
  defensiveWideMidfielder:duty("defensiveWideMidfielder", {
    movement:{ attackingDepth:.56, defendingDepth:1.08, width:1.06 },
    stage:{ buildUp:.98, progression:.84, finalThird:.66, chance:.48, shot:.32 },
    defenseStage:{ buildUp:1.24, progression:1.28, finalThird:1.24, chance:1.14, shot:1.05 },
    spatial:{ defense:1.1, pressure:1.08, attack:.78 },
    fatigue:1.08,
    restDefensePriority:-1,
  }),

  holdingFullback:duty("holdingFullback", {
    movement:{ attackingDepth:.22, defendingDepth:1.08, width:1.02, ballSideAdvance:0, farSideTuck:1.08 },
    stage:{ buildUp:1.02, progression:.78, finalThird:.48, chance:.3, shot:.2 },
    defenseStage:{ buildUp:1.12, progression:1.18, finalThird:1.22, chance:1.18, shot:1.12 },
    spatial:{ defense:1.1, attack:.68, support:.92 },
    restDefensePriority:-3,
  }),
  overlappingFullback:duty("overlappingFullback", {
    movement:{ attackingDepth:1.42, width:1.14, ballPull:.84, ballSideAdvance:1.6, farSideTuck:.78 },
    stage:{ buildUp:.9, progression:1.12, finalThird:1.3, chance:1.28, shot:.72 },
    defenseStage:{ buildUp:.9, progression:.92, finalThird:.88, chance:.82, shot:.86 },
    spatial:{ attack:1.12, support:1.1, defense:.9 },
    fatigue:1.16,
    restDefensePriority:3,
    shotPreference:"cross",
  }),
  invertedFullback:duty("invertedFullback", {
    movement:{ attackingDepth:.72, width:.56, ballPull:1.12, ballSideAdvance:.52, farSideTuck:1.28 },
    stage:{ buildUp:1.16, progression:1.24, finalThird:1.04, chance:.82, shot:.45 },
    defenseStage:{ buildUp:1.04, progression:1.08, finalThird:1.06, chance:1.02 },
    spatial:{ control:1.1, support:1.12, defense:1.03 },
    fatigue:1.07,
    restDefensePriority:-1,
  }),

  ballPlayingDefender:duty("ballPlayingDefender", {
    movement:{ attackingDepth:.78, ballPull:.92 },
    stage:{ buildUp:1.42, progression:1.18, finalThird:.58, chance:.32, shot:.2 },
    defenseStage:{ buildUp:.96, progression:.96, finalThird:.94, chance:.92, shot:.96 },
    spatial:{ control:1.12, support:1.06, defense:.97 },
    fatigue:1.03,
    restDefensePriority:-1,
  }),
  stopper:duty("stopper", {
    movement:{ attackingDepth:.92, defendingDepth:.62, ballPull:1.12 },
    stage:{ buildUp:.92, progression:.68, finalThird:.36, chance:.24, shot:.18 },
    defenseStage:{ buildUp:1.26, progression:1.34, finalThird:1.32, chance:1.2, shot:.96 },
    spatial:{ defense:1.08, pressure:1.12 },
    fatigue:1.09,
    restDefensePriority:1,
  }),
  coverDefender:duty("coverDefender", {
    movement:{ attackingDepth:.28, defendingDepth:1.26, ballPull:.72 },
    stage:{ buildUp:.94, progression:.54, finalThird:.3, chance:.2, shot:.16 },
    defenseStage:{ buildUp:.92, progression:1.02, finalThird:1.16, chance:1.28, shot:1.3 },
    spatial:{ defense:1.12, pressure:.86, support:.96 },
    restDefensePriority:-2,
  }),
});

export function resolveV2PlayerDuty(assignedRole, dutyId) {
  const id = String(dutyId ?? "");
  const definition = V2_PLAYER_DUTIES[id];
  return definition?.roles.includes(String(assignedRole ?? "").toUpperCase()) ? id : null;
}

export function v2PlayerDutyDefinition(player, assignedRole = player?.assignedRole ?? player?.role) {
  const id = resolveV2PlayerDuty(assignedRole, player?.tacticalDuty);
  return id ? V2_PLAYER_DUTIES[id] : null;
}

export function v2DutyMovement(player, assignedRole = player?.assignedRole ?? player?.role) {
  return v2PlayerDutyDefinition(player, assignedRole)?.movement ?? {
    attackingDepth:1,
    defendingDepth:1,
    width:1,
    ballPull:1,
    ballSideAdvance:1,
    farSideTuck:1,
  };
}

export function v2DutyStageMultiplier(player, stage, context = {}) {
  const definition = v2PlayerDutyDefinition(player);
  if (!definition) return 1;
  const stageMultiplier = Number(definition.stage?.[stage] ?? 1);
  const routeMultiplier = Number(definition.route?.[context.routeType] ?? 1);
  return stageMultiplier * routeMultiplier;
}

export function v2DutyDefenderMultiplier(player, stage) {
  return Number(v2PlayerDutyDefinition(player)?.defenseStage?.[stage] ?? 1);
}

export function v2DutySpatialMultipliers(player) {
  return v2PlayerDutyDefinition(player)?.spatial ?? {};
}

export function v2DutyFatigueMultiplier(player) {
  return Number(v2PlayerDutyDefinition(player)?.fatigue ?? 1);
}

export function v2DutyOffsideMultiplier(player) {
  return Number(v2PlayerDutyDefinition(player)?.offside ?? 1);
}

export function v2DutyRestDefensePriority(player) {
  return Number(v2PlayerDutyDefinition(player, player?.assignedRole)?.restDefensePriority ?? 0);
}

export function v2DutyShotPreference(player) {
  return v2PlayerDutyDefinition(player)?.shotPreference ?? null;
}

export function isV2TargetForward(player) {
  return v2PlayerDutyDefinition(player)?.targetSupport === true;
}
