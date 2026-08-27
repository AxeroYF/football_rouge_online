import { buildV21DynamicTeamShape } from "./dynamic-shape-v2.js";
import { tacticalDetailsForPlan, tacticalDimensionsForPlan } from "./match-engine-v2.js";

const ATTACK_LANES = Object.freeze({
  balanced:"center",
  left:"farLeft",
  leftHalf:"leftHalfSpace",
  center:"center",
  rightHalf:"rightHalfSpace",
  right:"farRight",
});

// Defensive direction is expressed from the defending team's viewpoint, while
// dynamic-shape ball lanes are expressed from the attacking team's viewpoint.
const DEFENSE_LANES = Object.freeze({
  balanced:"center",
  left:"rightHalfSpace",
  center:"center",
  right:"leftHalfSpace",
});

function baseFrame(players, positions) {
  return Object.freeze({
    id:"base",
    phase:"base",
    label:"默认站位",
    stage:"base",
    ball:null,
    players:Object.freeze(players.map((player) => Object.freeze({
      id:player.id,
      assignedRole:player.assignedRole ?? player.role,
      tacticalDuty:player.tacticalDuty ?? null,
      basePosition:Object.freeze({
        x:Number(positions[player.id]?.x ?? 50),
        y:Number(positions[player.id]?.y ?? 50),
      }),
      targetPosition:Object.freeze({
        x:Number(positions[player.id]?.x ?? 50),
        y:Number(positions[player.id]?.y ?? 50),
      }),
    }))),
  });
}

function targetFrame({ previewTeam, roles, dimensions, attacking, lane, parameters }) {
  // The match engine applies stableInfluence on each possession-chain step. A
  // lineup preview needs to show the complete landing shape, so it uses the
  // same movement rules and limits in candidate mode without simulating the
  // intermediate chain stages.
  const previewConfig = { ...parameters.dynamicShape, mode:"candidate" };
  const shape = buildV21DynamicTeamShape({
    team:previewTeam,
    teamIndex:0,
    attackingTeamIndex:attacking ? 0 : 1,
    stage:"chance",
    roles,
    dimensions,
    ballLane:lane,
    possessionType:"normal",
    config:previewConfig,
  });
  return Object.freeze({
    id:attacking ? "attack" : "defense",
    phase:attacking ? "attack" : "defense",
    label:attacking ? "进攻落位" : "防守落位",
    stage:"chance",
    ball:Object.freeze({
      x:Number(shape.localBallX),
      y:attacking ? 13 : 86,
    }),
    metrics:shape.metrics,
    players:Object.freeze(shape.players.map((player) => Object.freeze({
      ...player,
      basePosition:Object.freeze({ ...previewTeam.positions[player.id] }),
    }))),
  });
}

export function buildV21TacticalShapePreview({
  players,
  positions,
  roles,
  plan,
  attackFocus = "balanced",
  defenseFocus = "balanced",
  scoreState = "level",
  minute = 25,
  parameters,
}) {
  const config = parameters.dynamicShape;
  const details = tacticalDetailsForPlan(plan, { attackFocus, defenseFocus });
  const dimensions = tacticalDimensionsForPlan({
    ...plan,
    inPossessionDetails:details.inPossessionDetails,
    outOfPossessionDetails:details.outOfPossessionDetails,
  });
  const activePlayers = players.map((player) => ({
    ...player,
    assignedRole:roles[player.id] ?? player.assignedRole ?? player.role,
    tacticalDuty:plan.playerDuties?.[player.id] ?? player.tacticalDuty ?? null,
    active:true,
  }));
  const previewTeam = {
    players:activePlayers,
    positions,
    v2Snapshot:{ scoreState, minute },
  };
  const attackLane = ATTACK_LANES[details.inPossessionDetails.attackDirection] ?? "center";
  const defenseLane = DEFENSE_LANES[details.outOfPossessionDetails.defenseDirection] ?? "center";
  const frames = [
    baseFrame(activePlayers, positions),
    targetFrame({ previewTeam, roles, dimensions, attacking:true, lane:attackLane, parameters }),
    targetFrame({ previewTeam, roles, dimensions, attacking:false, lane:defenseLane, parameters }),
  ];
  return Object.freeze({
    modelVersion:config.modelVersion,
    scoreState,
    minute,
    attackLane,
    defenseLane,
    dimensions:Object.freeze({ ...dimensions }),
    frames:Object.freeze(frames),
  });
}
