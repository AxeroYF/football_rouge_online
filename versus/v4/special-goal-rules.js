const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

export function butterFingersProbability(goalkeeper = {}) {
  const fitness = clamp(Number(goalkeeper.state?.fitness ?? goalkeeper.fitness ?? 100), 35, 100);
  return clamp((75 - fitness) / 40 * 0.035, 0, 0.035);
}

export function superWorldieProbability(player = {}, attackType = "longShot") {
  if (attackType !== "longShot") return 0;
  const longShots = clamp(Number(player.attributes?.longShots ?? 50), 1, 99);
  const eliteLongShotFactor = clamp((longShots - 70) / 29, 0, 1);
  return 0.001 + eliteLongShotFactor ** 2 * 0.024;
}

export function ownGoalCandidateWeight(player = {}) {
  const fitness = clamp(Number(player.state?.fitness ?? player.fitness ?? 100), 35, 100);
  const composure = clamp(Number(player.attributes?.composure ?? 50), 1, 99);
  const fitnessRisk = clamp((70 - fitness) / 35, 0, 1);
  const composureRisk = clamp((65 - composure) / 40, 0, 1);
  return 0.15 + fitnessRisk * 1.2 + composureRisk * 0.9 + fitnessRisk * composureRisk * 0.8;
}
