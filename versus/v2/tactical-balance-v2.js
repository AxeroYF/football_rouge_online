const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

export function v2AttackingCommitmentProfile(dimensions = {}, parameters = {}) {
  const config = parameters.tactics?.attackingCommitment ?? {};
  const weights = {
    mentality:0.38,
    tempo:0.16,
    defensiveLine:0.18,
    pressing:0.08,
    availableTime:0.2,
    ...(config.weights ?? {}),
  };
  const normalized = {
    mentality:clamp(Number(dimensions.mentality ?? 50) / 100, 0, 1),
    tempo:clamp(Number(dimensions.tempo ?? 50) / 100, 0, 1),
    defensiveLine:clamp(Number(dimensions.defensiveLine ?? 50) / 100, 0, 1),
    pressing:clamp(Number(dimensions.pressing ?? 50) / 100, 0, 1),
    availableTime:1 - clamp(Number(dimensions.timeWasting ?? 20) / 100, 0, 1),
  };
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) || 1;
  const rawCommitment = Object.entries(weights).reduce((sum, [key, weight]) => sum + Number(normalized[key] ?? 0.5) * Math.max(0, Number(weight) || 0), 0) / totalWeight;
  const commitment = clamp(rawCommitment, Number(config.minimumCommitment ?? 0.05), 1);
  const threshold = clamp(Number(config.deepDefensiveThreshold ?? 0.52), 0.05, 1);
  const deepDefensiveSeverity = clamp((threshold - commitment) / threshold, 0, 1);
  const stateMinimum = clamp(Number(config.stateBonusMinimumMultiplier ?? 0.18), 0, 1);
  const stateExponent = Math.max(0.1, Number(config.stateBonusExponent ?? 1.2));
  const stateBonusMultiplier = stateMinimum + (1 - stateMinimum) * Math.pow(commitment, stateExponent);
  return Object.freeze({
    commitment:round(commitment),
    deepDefensiveSeverity:round(deepDefensiveSeverity),
    stateBonusMultiplier:round(stateBonusMultiplier),
  });
}

