import {
  INJURY_PROFILES,
  PERSONALITY_PROFILES,
  clampValue,
  normalizePlayerSchema,
  playerMetric,
  roleGroup,
} from "./schema.js";

const GROWTH_PRIORITIES = Object.freeze({
  GK: Object.freeze(["goalkeeping", "reflexes", "positioning", "composure", "decisions", "passing", "jumping"]),
  DEF: Object.freeze(["tackling", "marking", "positioning", "strength", "jumping", "heading", "pace", "discipline"]),
  MID: Object.freeze(["passing", "vision", "decisions", "firstTouch", "stamina", "workRate", "dribbling", "composure"]),
  ATT: Object.freeze(["finishing", "offBall", "composure", "pace", "acceleration", "dribbling", "heading", "firstTouch"]),
});

function clampState(value) {
  return Math.round(clampValue(value, 0, 100));
}

function currentAbility(player) {
  const group = roleGroup(player.role);
  if (group === "GK") return playerMetric(player, "goalkeeping");
  if (group === "DEF") return playerMetric(player, "defense");
  if (group === "MID") return Math.round(playerMetric(player, "passing") * 0.62 + playerMetric(player, "defense") * 0.18 + playerMetric(player, "stamina") * 0.2);
  return playerMetric(player, "attack");
}

function recoveryCap(injury) {
  return ({ careerEnding: 0, severe: 58, moderate: 72, minor: 90, knock: 96, none: 100 })[injury.severity] ?? 100;
}

function recoverExistingInjury(player, played) {
  const injury = player.state.injury;
  if (!injury || injury.matchesRemaining <= 0) return;
  if (player.state.retired || injury.severity === "careerEnding") return;
  const servedMatches = played ? 0 : 1;
  injury.matchesRemaining = Math.max(0, injury.matchesRemaining - servedMatches);
  if (injury.matchesRemaining === 0) {
    injury.severity = "none";
    injury.totalMatches = 0;
    injury.cause = null;
    injury.sufferedAtStage = null;
  }
}

function serveExistingSuspension(player) {
  const suspension = player.state.suspension;
  if (!suspension || suspension.matchesRemaining <= 0) return false;
  suspension.matchesRemaining = Math.max(0, suspension.matchesRemaining - 1);
  if (suspension.matchesRemaining === 0) {
    suspension.totalMatches = 0;
    suspension.reason = null;
    suspension.receivedAtStage = null;
    return true;
  }
  return false;
}

function applyRedCardSuspension(player, redCards, stage) {
  if ((Number(redCards) || 0) <= 0) return null;
  player.state.suspension = {
    matchesRemaining: 1,
    totalMatches: 1,
    reason: "redCard",
    receivedAtStage: Number.isFinite(Number(stage)) ? Number(stage) : null,
  };
  return { ...player.state.suspension };
}

function applyNewInjury(player, newInjury, stage, allowUnavailable) {
  if (!newInjury || !INJURY_PROFILES[newInjury.severity] || newInjury.severity === "none") return null;
  let severity = newInjury.severity;
  let matchesRemaining = Math.max(1, Math.round(Number(newInjury.matchesOut) || Number(newInjury.matchesRemaining) || 1));
  const retired = Boolean(newInjury.retired || severity === "careerEnding");
  const existing = player.state.injury;
  if ((existing.matchesRemaining ?? 0) > matchesRemaining && INJURY_PROFILES[existing.severity]?.performance < INJURY_PROFILES[severity]?.performance) {
    return { ...existing };
  }
  player.state.injury = {
    severity,
    matchesRemaining,
    totalMatches: matchesRemaining,
    cause: newInjury.cause ?? "match",
    sufferedAtStage: Number.isFinite(Number(stage)) ? Number(stage) : null,
  };
  player.state.retired = retired;
  player.state.fitness = Math.min(player.state.fitness, recoveryCap(player.state.injury) - (severity === "severe" ? 12 : severity === "moderate" ? 7 : 3));
  return { ...player.state.injury };
}

function applyGrowth(player, earnedExperience, stage, rng) {
  const development = player.development;
  const profile = PERSONALITY_PROFILES[player.hidden.personality] ?? PERSONALITY_PROFILES.teamPlayer;
  const ageFactor = development.age <= 21 ? 1.24 : development.age <= 25 ? 1.08 : development.age <= 29 ? 0.9 : development.age <= 32 ? 0.62 : 0.34;
  const rate = (development.growthRate / 100) * profile.growth * ageFactor;
  development.experience += Math.max(0, Math.round(earnedExperience * rate));
  const improved = {};
  let levelUps = 0;
  let threshold = 90 + development.level * 25;
  while (development.experience >= threshold && levelUps < 3) {
    development.experience -= threshold;
    development.level += 1;
    levelUps += 1;
    const room = development.potential - currentAbility(player);
    if (room > 0) {
      const priorities = GROWTH_PRIORITIES[roleGroup(player.role)] ?? GROWTH_PRIORITIES.MID;
      const improvements = room >= 10 && rng() < 0.35 ? 2 : 1;
      for (let index = 0; index < improvements; index += 1) {
        const available = priorities.filter((name) => Number(player.attributes[name] ?? 50) < 99);
        if (!available.length) break;
        const attribute = available[Math.floor(rng() * available.length)];
        player.attributes[attribute] = Math.min(99, Number(player.attributes[attribute] ?? 50) + 1);
        improved[attribute] = (improved[attribute] ?? 0) + 1;
      }
    }
    threshold = 90 + development.level * 25;
  }
  development.lastGrowth = Object.keys(improved).length ? { stage, attributes: improved } : null;
  return { levelUps, attributes: improved, experience: development.experience, nextThreshold: threshold };
}

export function settlePlayerAfterMatch(player, context = {}, rng = Math.random) {
  Object.assign(player, normalizePlayerSchema(player));
  const played = Boolean(context.played);
  const profile = PERSONALITY_PROFILES[player.hidden.personality] ?? PERSONALITY_PROFILES.teamPlayer;
  const before = {
    fitness: player.state.fitness,
    form: player.state.form,
    morale: player.state.morale,
    injury: { ...player.state.injury },
    suspension: { ...player.state.suspension },
  };

  recoverExistingInjury(player, played);
  const suspensionServed = serveExistingSuspension(player);
  const stamina = Number(player.attributes.stamina ?? 50);
  const physicalRecovery = (stamina - 50) * 0.045 + (player.hidden.injuryResistance - 50) * 0.025;
  if (played) {
    const minutes = Math.max(1, Number(context.minutesPlayed) || 90);
    const load = (minutes / 90) * (9.5 - physicalRecovery + (Number(context.tacticLoad) || 0));
    player.state.fitness = clampState(player.state.fitness - load);
  } else {
    const recovery = 11 + player.hidden.professionalism * 0.045 + (player.hidden.personality === "resilient" ? 3 : 0);
    player.state.fitness = clampState(player.state.fitness + recovery);
  }

  const resultDelta = context.won ? 5 : context.draw ? 1 : -6;
  const contribution = (Number(context.goals) || 0) * 3 + (Number(context.assists) || 0) * 2 - (Number(context.yellowCards) || 0) - (Number(context.redCards) || 0) * 4;
  const selectionDelta = played ? 0.8 : player.hidden.ambition >= 72 ? -1.5 : -0.4;
  const injuryDelta = context.newInjury ? -3 : 0;
  const moraleDelta = (resultDelta + contribution + selectionDelta + injuryDelta) * profile.moraleSwing;
  player.state.morale = clampState(player.state.morale + moraleDelta);

  const performanceSignal = (context.won ? 4 : context.draw ? 0 : -3) + contribution * 0.8 + (played ? 1 : -1);
  player.state.form = clampState(player.state.form * 0.82 + (50 + performanceSignal) * 0.18);
  if (played) player.development.matchesPlayed += 1;

  const earnedExperience = played
    ? 16 + (context.won ? 7 : context.draw ? 3 : 1) + (Number(context.goals) || 0) * 8 + (Number(context.assists) || 0) * 5
    : 4 + player.hidden.professionalism * 0.025;
  const growth = applyGrowth(player, earnedExperience, context.stage, rng);
  const injury = applyNewInjury(player, context.newInjury, context.stage, context.allowUnavailable !== false);
  const suspension = applyRedCardSuspension(player, context.redCards, context.stage);
  player.state.fitness = Math.min(player.state.fitness, recoveryCap(player.state.injury));

  return {
    playerId: player.id,
    playerName: player.name,
    played,
    fitnessDelta: player.state.fitness - before.fitness,
    formDelta: player.state.form - before.form,
    moraleDelta: player.state.morale - before.morale,
    recovered: before.injury.matchesRemaining > 0 && player.state.injury.matchesRemaining === 0,
    injury,
    retired: Boolean(player.state.retired),
    finalFitness: player.state.fitness,
    finalMorale: player.state.morale,
    suspension,
    suspensionServed,
    growth,
  };
}
