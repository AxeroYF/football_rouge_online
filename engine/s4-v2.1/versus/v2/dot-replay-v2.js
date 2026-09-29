import {roleGroup} from '../../game/public/schema.js';
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const DOT_REPLAY_EVENT_TYPES = new Set(["kickoff", "goal", "ownGoal", "save", "miss", "block", "penalty", "penaltyAwarded", "offside", "yellow", "red", "injury", "substitution", "fulltime"]);
const DOT_REPLAY_LANE_X = Object.freeze({ farLeft:10, leftHalfSpace:30, center:50, rightHalfSpace:70, farRight:90 });
const DOT_REPLAY_BAND_Y = Object.freeze({ defensiveThird:84, buildUp:64, finalThird:31, box:9 });

function replayWorldPoint(position, teamIndex) {
  const x = clamp(Number(position?.x ?? 50), 0, 100);
  const y = clamp(Number(position?.y ?? 50), 0, 100);
  return teamIndex === 1 ? { x:round(100 - x, 2), y:round(100 - y, 2) } : { x:round(x, 2), y:round(y, 2) };
}

function replayShapeFromTeams(match) {
  return {
    modelVersion:match.parameters?.dynamicShape?.modelVersion ?? null,
    stage:"static",
    attackingTeamIndex:null,
    ballLane:"center",
    possessionType:"normal",
    teams:match.teams.map((team, teamIndex) => ({
      teamIndex,
      players:team.players.filter((player) => player.active).map((player) => ({
        id:player.id,
        role:player.assignedRole ?? player.role,
        ...team.positions?.[player.id],
      })),
    })),
  };
}

function dotReplayBall(match, event, shape) {
  if (event.type === "kickoff") return { x:50, y:50 };
  if (event.type === "fulltime" && match.lastDotReplayBall) return { ...match.lastDotReplayBall };
  const [band, lane] = String(event.zone ?? `${shape?.stage === "shot" ? "box" : "buildUp"}:${shape?.ballLane ?? "center"}`).split(":");
  const attackingTeamIndex = Number(event.attackingTeamIndex ?? shape?.attackingTeamIndex ?? event.teamIndex);
  return replayWorldPoint({ x:DOT_REPLAY_LANE_X[lane] ?? 50, y:DOT_REPLAY_BAND_Y[band] ?? 50 }, attackingTeamIndex === 1 ? 1 : 0);
}

function dotReplayTeams(match, shape, includeIdentity = false) {
  const playersByTeam = match.teams.map((team) => new Map(team.players.map((player) => [player.id, player])));
  return shape.teams.map((shapeTeam) => ({
    teamIndex:shapeTeam.teamIndex,
    players:shapeTeam.players.map((position) => {
      const player = playersByTeam[shapeTeam.teamIndex]?.get(position.id);
      return {
        id:position.id,
        ...(includeIdentity ? { name:player?.name ?? position.id, role:position.role ?? player?.assignedRole ?? player?.role ?? null } : {}),
        ...replayWorldPoint(position, shapeTeam.teamIndex),
      };
    }),
  }));
}

function dotReplayTerminalBall(event, ball, teams, attackingTeamIndex) {
  const attackingRight = Number(attackingTeamIndex) === 1;
  const goalDepth = attackingRight ? 102 : -2;
  if (["goal", "ownGoal"].includes(event.type)) return { x:round(clamp(ball.x, 42, 58), 2), y:goalDepth };
  if (event.type === "miss") return { x:round(ball.x < 50 ? Math.max(3, ball.x - 12) : Math.min(97, ball.x + 12), 2), y:goalDepth };
  if (["save", "block"].includes(event.type)) {
    const targetId = event.type === "save" ? event.actorId : event.actorId ?? event.opponentId;
    const target = teams.flatMap((team) => team.players).find((player) => player.id === targetId);
    if (target) return { x:target.x, y:target.y };
  }
  return { ...ball };
}

function dotReplayActorBall(teams, actorId, attackingTeamIndex, fallback) {
  if (!actorId) return fallback;
  const actor = teams.find((team) => team.teamIndex === attackingTeamIndex)?.players.find((player) => player.id === actorId)
    ?? teams.flatMap((team) => team.players).find((player) => player.id === actorId);
  if (!actor) return fallback;
  return {
    x:round(clamp(Number(actor.x) + 1.4, 0, 100), 2),
    y:round(clamp(Number(actor.y) + (Number(attackingTeamIndex) === 1 ? 1.2 : -1.2), 0, 100), 2),
  };
}

function dotReplayShotLocation(event, actor, attackingTeamIndex) {
  const attackType = event?.attackType ?? null;
  const direction = Number(attackingTeamIndex) === 1 ? 1 : -1;
  const attackingDepth = attackType === "penalty" ? 89
    : attackType === "rebound" ? 90
      : attackType === "longShot" ? 76
        : attackType === "freeKick" ? 78
          : ["cross", "setPiece"].includes(attackType) || event?.bodyPart === "header" ? 88
            : attackType === "cutback" ? 85
              : clamp(86 + Number(event?.xg ?? 0) * 7, 86, 90);
  const lateralRange = attackType === "penalty" ? [50, 50]
    : ["cross", "setPiece"].includes(attackType) || event?.bodyPart === "header" ? [31, 69]
      : attackType === "cutback" ? [28, 72]
        : [24, 76];
  return {
    x:round(clamp(Number(actor?.x ?? 50), lateralRange[0], lateralRange[1]), 2),
    y:round(direction === 1 ? attackingDepth : 100 - attackingDepth, 2),
  };
}

function dotReplayOffsideShape(attacking, defending, actor, attackingTeamIndex, playerRole) {
  const direction = Number(attackingTeamIndex) === 1 ? 1 : -1;
  const defendersByGoalDepth = defending.players
    .map((player) => ({ player, depth:direction * Number(player.y) }))
    .sort((left, right) => right.depth - left.depth);
  const secondLast = defendersByGoalDepth[1]?.player ?? defendersByGoalDepth[0]?.player ?? null;
  if (!secondLast) return { line:null, secondLastDefenderId:null, ballLine:Number(actor.y) };
  const ballLine = Number(actor.y);
  const rawLine = direction === 1 ? Math.max(ballLine, Number(secondLast.y)) : Math.min(ballLine, Number(secondLast.y));
  const line = direction === 1 ? Math.min(rawLine - 0.65, 94) : Math.max(rawLine + 0.65, 6);
  attacking.players.forEach((player) => {
    if (player.id === actor.id || playerRole(player.id, Number(attackingTeamIndex)) === "GK") return;
    const inOpposingHalf = direction === 1 ? Number(player.y) > 50 : Number(player.y) < 50;
    if (!inOpposingHalf) return;
    player.y = direction === 1 ? Math.min(Number(player.y), line) : Math.max(Number(player.y), line);
  });
  return { line:round(line, 2), secondLastDefenderId:secondLast.id, ballLine:round(ballLine, 2) };
}

function dotReplayReactiveTeams(match, sourceTeams, { attackingTeamIndex, actorId, defenderId, stage, action, ball, event = null }) {
  const teams = structuredClone(sourceTeams);
  const emptyResult = { teams, defensiveRoles:{ pressureId:null, coverIds:[], markerIds:[] }, offside:{ line:null, secondLastDefenderId:null, ballLine:null } };
  if (![0, 1].includes(Number(attackingTeamIndex)) || !actorId) return emptyResult;
  const attackIndex = Number(attackingTeamIndex);
  const attacking = teams.find((team) => team.teamIndex === attackIndex);
  const defending = teams.find((team) => team.teamIndex === 1 - attackIndex);
  const actor = attacking?.players.find((player) => player.id === actorId);
  if (!attacking || !defending || !actor) return emptyResult;
  const direction = attackIndex === 1 ? 1 : -1;
  const lateStage = ["finalThird", "chance", "assist", "shot", "goal", "ownGoal"].includes(stage);
  const actionIntensity = ({ keyPass:1.2, shot:1.65, shotOutcome:1.35 })[action] ?? (lateStage ? 0.8 : 0.45);
  const playerRole = (playerId, teamIndex) => {
    const source = match.teams[teamIndex]?.players.find((player) => player.id === playerId)
      ?? match.teams.flatMap((team) => team.players).find((player) => player.id === playerId);
    return roleGroup(source?.assignedRole ?? source?.role);
  };

  if (action === "shot") Object.assign(actor, dotReplayShotLocation(event, actor, attackIndex));
  else if (action === "keyPass") actor.y = clamp(actor.y + direction * actionIntensity, 1, 99);
  const supportCandidates = attacking.players
    .filter((player) => player.id !== actorId && playerRole(player.id, attackIndex) !== "GK")
    .sort((left, right) => {
      const rolePriority = (player) => ({ ATT:0, MID:1, DEF:2 })[playerRole(player.id, attackIndex)] ?? 3;
      return rolePriority(left) - rolePriority(right)
        || Math.hypot(left.x - actor.x, left.y - actor.y) - Math.hypot(right.x - actor.x, right.y - actor.y);
    });
  const supportRunRanks = new Map(supportCandidates.slice(0, 3).map((player, index) => [player.id, index]));
  attacking.players.forEach((player) => {
    if (player.id === actorId) return;
    const group = playerRole(player.id, attackIndex);
    if (group === "GK") return;
    if (supportRunRanks.has(player.id)) {
      const runRank = supportRunRanks.get(player.id);
      const laneOffset = [-7, 7, 0][runRank] ?? 0;
      const runDepth = lateStage ? [3.8, 3, 1.9][runRank] : [2.4, 1.9, 1.2][runRank];
      player.x = clamp(player.x + (actor.x + laneOffset - player.x) * 0.14 * actionIntensity, 1, 99);
      player.y = clamp(player.y + direction * runDepth * actionIntensity, 1, 99);
      return;
    }
    if (group === "ATT" && lateStage) {
      const awayFromActor = Math.sign(player.x - actor.x) || (String(player.id).localeCompare(String(actorId)) < 0 ? -1 : 1);
      player.x = clamp(player.x + awayFromActor * 0.58 * actionIntensity, 1, 99);
      player.y = clamp(player.y + direction * 2.7 * actionIntensity, 1, 99);
      return;
    }
    const unitShift = group === "MID" ? 1.15 : group === "DEF" ? 0.34 : 0.16;
    player.x = clamp(player.x + (actor.x - player.x) * (group === "MID" ? 0.045 : 0.02) * actionIntensity, 1, 99);
    player.y = clamp(player.y + direction * unitShift * actionIntensity, 1, 99);
  });
  const offside = dotReplayOffsideShape(attacking, defending, actor, attackIndex, playerRole);

  const explicitDefender = defending.players.find((player) => player.id === defenderId);
  const outfield = defending.players.filter((player) => playerRole(player.id, 1 - attackIndex) !== "GK");
  const pressureDefender = explicitDefender && playerRole(explicitDefender.id, 1 - attackIndex) !== "GK"
    ? explicitDefender
    : [...outfield].sort((left, right) => Math.hypot(left.x - actor.x, left.y - actor.y) - Math.hypot(right.x - actor.x, right.y - actor.y))[0];
  const coverDefenders = [...outfield]
    .filter((player) => player.id !== pressureDefender?.id && ["DEF", "MID"].includes(playerRole(player.id, 1 - attackIndex)))
    .sort((left, right) => Math.hypot(left.x - actor.x, left.y - actor.y) - Math.hypot(right.x - actor.x, right.y - actor.y))
    .slice(0, 2);
  const assignedIds = new Set([pressureDefender?.id, ...coverDefenders.map((player) => player.id)].filter(Boolean));
  const dangerousAttackers = attacking.players
    .filter((player) => player.id !== actorId && playerRole(player.id, attackIndex) !== "GK")
    .sort((left, right) => (direction * (right.y - left.y)) - (direction * (left.y - right.y))
      || Math.hypot(left.x - actor.x, left.y - actor.y) - Math.hypot(right.x - actor.x, right.y - actor.y));
  const markerAssignments = [];
  const availableMarkers = outfield.filter((player) => !assignedIds.has(player.id) && ["DEF", "MID"].includes(playerRole(player.id, 1 - attackIndex)));
  dangerousAttackers.slice(0, Math.min(3, availableMarkers.length)).forEach((target) => {
    const marker = [...availableMarkers]
      .filter((player) => !assignedIds.has(player.id))
      .sort((left, right) => Math.hypot(left.x - target.x, left.y - target.y) - Math.hypot(right.x - target.x, right.y - target.y))[0];
    if (!marker) return;
    assignedIds.add(marker.id);
    markerAssignments.push({ marker, target });
  });
  defending.players.forEach((player) => {
    const group = playerRole(player.id, 1 - attackIndex);
    if (group === "GK") {
      const targetX = Number(ball?.x ?? actor.x);
      player.x = clamp(player.x + (targetX - player.x) * 0.18 * actionIntensity, 1, 99);
      return;
    }
    if (assignedIds.has(player.id)) return;
    const blockTargetX = actor.x + (50 - actor.x) * (group === "DEF" ? 0.42 : 0.24);
    const blockTargetY = actor.y + direction * (group === "DEF" ? 13 : group === "MID" ? 7 : 1);
    const blockReaction = action === "shot" ? (group === "DEF" ? 0.28 : 0.21) : group === "DEF" ? 0.15 : 0.1;
    player.x = clamp(player.x + (blockTargetX - player.x) * blockReaction, 1, 99);
    player.y = clamp(player.y + (blockTargetY - player.y) * blockReaction, 1, 99);
  });
  if (pressureDefender) {
    const pressure = action === "shot" ? 0.46 : action === "keyPass" ? 0.34 : 0.22;
    const goalSideY = actor.y + direction * (action === "shot" ? 2.6 : 4.2);
    pressureDefender.x = clamp(pressureDefender.x + (actor.x - pressureDefender.x) * pressure, 1, 99);
    pressureDefender.y = clamp(pressureDefender.y + (goalSideY - pressureDefender.y) * pressure, 1, 99);
  }
  coverDefenders.forEach((coverDefender, index) => {
    const side = index === 0 ? -1 : 1;
    const coverTargetX = clamp(actor.x + side * (action === "shot" ? 7 : 9) + (50 - actor.x) * 0.18, 5, 95);
    const coverTargetY = actor.y + direction * (action === "shot" ? 7 : 10);
    const coverReaction = action === "shot" ? 0.35 : action === "keyPass" ? 0.27 : 0.17;
    coverDefender.x = clamp(coverDefender.x + (coverTargetX - coverDefender.x) * coverReaction, 1, 99);
    coverDefender.y = clamp(coverDefender.y + (coverTargetY - coverDefender.y) * coverReaction, 1, 99);
  });
  markerAssignments.forEach(({ marker, target }) => {
    const markingTargetX = target.x + (50 - target.x) * 0.12;
    const markingTargetY = target.y + direction * (action === "shot" ? 3.5 : 5);
    const markingReaction = action === "shot" ? 0.24 : action === "keyPass" ? 0.2 : 0.13;
    marker.x = clamp(marker.x + (markingTargetX - marker.x) * markingReaction, 1, 99);
    marker.y = clamp(marker.y + (markingTargetY - marker.y) * markingReaction, 1, 99);
  });
  if (action === "shotOutcome") {
    const goalkeeper = defending.players.find((player) => playerRole(player.id, 1 - attackIndex) === "GK");
    if (goalkeeper) {
      goalkeeper.x = clamp(goalkeeper.x + (Number(ball?.x ?? actor.x) - goalkeeper.x) * 0.62, 1, 99);
      goalkeeper.y = clamp(goalkeeper.y + direction * 1.4, 1, 99);
    }
  }
  return {
    teams,
    defensiveRoles:{
      pressureId:pressureDefender?.id ?? null,
      coverIds:coverDefenders.map((player) => player.id),
      markerIds:markerAssignments.map(({ marker }) => marker.id),
    },
    offside,
  };
}

export function recordDotReplayFrame(match, event) {
  if (!match.dotReplayEnabled || !DOT_REPLAY_EVENT_TYPES.has(event.type)) return;
  const sourceShape = match.currentReplayShape ?? match.lastReplayShape ?? replayShapeFromTeams(match);
  const teams = dotReplayTeams(match, sourceShape, true);
  const ball = dotReplayBall(match, event, sourceShape);
  const replaySource = match.currentReplaySequence?.length ? match.currentReplaySequence : [sourceShape];
  let previousActorId = null;
  const sequence = replaySource.slice(-5).map((phase, phaseIndex) => {
    const basePhaseTeams = dotReplayTeams(match, phase);
    const attackingTeamIndex = Number(phase.attackingTeamIndex ?? sourceShape.attackingTeamIndex);
    const actorId = phase.actorId ?? null;
    const fallbackBall = dotReplayBall(match, { type:"phase", zone:phase.zone, attackingTeamIndex }, phase);
    const action = phaseIndex === 0 ? "control" : actorId && previousActorId && actorId !== previousActorId ? "pass" : "carry";
    if (actorId) previousActorId = actorId;
    const reaction = dotReplayReactiveTeams(match, basePhaseTeams, {
      attackingTeamIndex,
      actorId,
      defenderId:phase.defenderId ?? null,
      stage:phase.stage,
      action,
      ball:fallbackBall,
      event:phase,
    });
    return {
      stage:phase.stage,
      action,
      outcome:phase.outcome ?? null,
      actorId,
      defenderId:reaction.defensiveRoles.pressureId ?? phase.defenderId ?? null,
      defensiveRoles:reaction.defensiveRoles,
      offside:reaction.offside,
      ball:dotReplayActorBall(reaction.teams, actorId, attackingTeamIndex, fallbackBall),
      teams:reaction.teams,
    };
  });
  if (["goal", "ownGoal", "save", "miss", "block"].includes(event.type)) {
    const shotActorId = ["save", "block"].includes(event.type) ? event.opponentId : event.actorId;
    const outcomeDefenderId = event.type === "goal" ? event.opponentId : ["save", "block"].includes(event.type) ? event.actorId : null;
    let lastPhase = sequence.at(-1);
    if (event.type === "goal" && event.assistId) {
      if (lastPhase?.actorId === event.assistId) {
        lastPhase.action = "keyPass";
        lastPhase.role = "assist";
        const assistReaction = dotReplayReactiveTeams(match, lastPhase.teams ?? teams, {
          attackingTeamIndex:event.attackingTeamIndex ?? sourceShape.attackingTeamIndex,
          actorId:event.assistId,
          defenderId:lastPhase.defenderId ?? null,
          stage:"assist",
          action:"keyPass",
          ball:lastPhase.ball ?? ball,
          event,
        });
        lastPhase.teams = assistReaction.teams;
        lastPhase.defenderId = assistReaction.defensiveRoles.pressureId ?? lastPhase.defenderId;
        lastPhase.defensiveRoles = assistReaction.defensiveRoles;
        lastPhase.offside = assistReaction.offside;
        lastPhase.ball = dotReplayActorBall(lastPhase.teams, event.assistId, event.attackingTeamIndex ?? sourceShape.attackingTeamIndex, lastPhase.ball ?? ball);
      } else {
        const assistReaction = dotReplayReactiveTeams(match, lastPhase?.teams ?? teams, {
          attackingTeamIndex:event.attackingTeamIndex ?? sourceShape.attackingTeamIndex,
          actorId:event.assistId,
          defenderId:lastPhase?.defenderId ?? null,
          stage:"assist",
          action:"keyPass",
          ball:lastPhase?.ball ?? ball,
          event,
        });
        sequence.push({
          ...structuredClone(lastPhase),
          stage:"assist",
          action:"keyPass",
          role:"assist",
          actorId:event.assistId,
          defenderId:assistReaction.defensiveRoles.pressureId ?? lastPhase?.defenderId ?? null,
          defensiveRoles:assistReaction.defensiveRoles,
          offside:assistReaction.offside,
          ball:dotReplayActorBall(assistReaction.teams, event.assistId, event.attackingTeamIndex ?? sourceShape.attackingTeamIndex, lastPhase?.ball ?? ball),
          teams:assistReaction.teams,
        });
      }
      lastPhase = sequence.at(-1);
    }
    if (shotActorId && (lastPhase?.actorId !== shotActorId || lastPhase?.action !== "shot")) {
      const shotReaction = dotReplayReactiveTeams(match, lastPhase?.teams ?? teams, {
        attackingTeamIndex:event.attackingTeamIndex ?? sourceShape.attackingTeamIndex,
        actorId:shotActorId,
        defenderId:outcomeDefenderId ?? lastPhase?.defenderId ?? null,
        stage:"shot",
        action:"shot",
        ball:lastPhase?.ball ?? ball,
        event,
      });
      sequence.push({
        ...structuredClone(lastPhase),
        stage:"shot",
        action:"shot",
        role:event.type === "goal" ? "scorer" : "shooter",
        actorId:shotActorId,
        defenderId:shotReaction.defensiveRoles.pressureId ?? outcomeDefenderId ?? lastPhase?.defenderId ?? null,
        defensiveRoles:shotReaction.defensiveRoles,
        offside:shotReaction.offside,
        ball:dotReplayActorBall(shotReaction.teams, shotActorId, event.attackingTeamIndex ?? sourceShape.attackingTeamIndex, lastPhase?.ball ?? ball),
        teams:shotReaction.teams,
      });
    }
    lastPhase = sequence.at(-1);
    const outcomeBall = dotReplayTerminalBall(event, lastPhase?.ball ?? ball, teams, event.attackingTeamIndex ?? sourceShape.attackingTeamIndex);
    const outcomeActorId = event.type === "goal" ? event.actorId : shotActorId;
    const outcomeReaction = dotReplayReactiveTeams(match, lastPhase?.teams ?? teams, {
      attackingTeamIndex:event.attackingTeamIndex ?? sourceShape.attackingTeamIndex,
      actorId:outcomeActorId,
      defenderId:outcomeDefenderId ?? event.actorId ?? null,
      stage:event.type,
      action:"shotOutcome",
      ball:outcomeBall,
      event,
    });
    sequence.push({
      ...structuredClone(lastPhase),
      stage:event.type,
      action:"shotOutcome",
      outcome:event.type,
      actorId:outcomeActorId ?? lastPhase?.actorId ?? null,
      defenderId:outcomeReaction.defensiveRoles.pressureId ?? event.opponentId ?? lastPhase?.defenderId ?? null,
      defensiveRoles:outcomeReaction.defensiveRoles,
      offside:outcomeReaction.offside,
      ball:outcomeBall,
      teams:outcomeReaction.teams,
    });
  }
  match.lastDotReplayBall = ball;
  const frame = {
    id:`dot-${match.dotReplayFrames.length + 1}`,
    eventId:event.id,
    minute:event.minute,
    type:event.type,
    teamIndex:Number.isInteger(event.teamIndex) ? event.teamIndex : null,
    attackingTeamIndex:Number.isInteger(event.attackingTeamIndex) ? event.attackingTeamIndex : sourceShape.attackingTeamIndex,
    stage:sourceShape.stage,
    possessionType:sourceShape.possessionType,
    text:event.text,
    detail:event.detail ?? null,
    importance:event.importance,
    actorId:event.actorId ?? null,
    assistId:event.assistId ?? null,
    opponentId:event.opponentId ?? null,
    targetId:event.targetId ?? null,
    attackType:event.attackType ?? null,
    zone:event.zone ?? null,
    bodyPart:event.bodyPart ?? null,
    bodyPartLabel:event.bodyPartLabel ?? null,
    xg:Number.isFinite(Number(event.xg)) ? Number(event.xg) : null,
    score:[...match.teams.map((team) => team.score)],
    ball,
    teams,
    sequence,
  };
  match.dotReplayFrames.push(frame);
  event.dotReplayFrameId = frame.id;
}
