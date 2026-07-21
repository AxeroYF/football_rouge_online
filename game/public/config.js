export const DEFAULT_GAME_CONFIG = Object.freeze({
  weatherWeights: Object.freeze({ sunny: 60, rain: 15, storm: 15, snow: 10 }),
  lightning: Object.freeze({
    chance: 0.006,
    fitnessLossMin: 8,
    fitnessLossMax: 16,
    moraleLossMin: 2,
    moraleLossMax: 6,
  }),
  referee: Object.freeze({
    strictnessMin: 56,
    strictnessMax: 84,
    penaltyBiasMin: 52,
    penaltyBiasMax: 82,
    homeBiasMin: 46,
    homeBiasMax: 54,
  }),
  economy: Object.freeze({
    victoryBaseGold: 220,
    victoryGoldPerStage: 20,
  }),
});

function numberInRange(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}

function orderedRange(input, defaults, minimum, maximum) {
  const low = numberInRange(input?.min, defaults.min, minimum, maximum);
  const high = numberInRange(input?.max, defaults.max, minimum, maximum);
  return { min: Math.min(low, high), max: Math.max(low, high) };
}

export function normalizeGameConfig(value = {}) {
  const weatherInput = value?.weatherWeights ?? {};
  const weatherWeights = Object.fromEntries(
    Object.entries(DEFAULT_GAME_CONFIG.weatherWeights).map(([key, fallback]) => [
      key,
      numberInRange(weatherInput[key], fallback, 0, 1000),
    ]),
  );
  if (Object.values(weatherWeights).reduce((sum, weight) => sum + weight, 0) <= 0) {
    Object.assign(weatherWeights, DEFAULT_GAME_CONFIG.weatherWeights);
  }

  const lightningInput = value?.lightning ?? {};
  const fitnessRange = orderedRange(
    { min: lightningInput.fitnessLossMin, max: lightningInput.fitnessLossMax },
    { min: DEFAULT_GAME_CONFIG.lightning.fitnessLossMin, max: DEFAULT_GAME_CONFIG.lightning.fitnessLossMax },
    0,
    100,
  );
  const moraleRange = orderedRange(
    { min: lightningInput.moraleLossMin, max: lightningInput.moraleLossMax },
    { min: DEFAULT_GAME_CONFIG.lightning.moraleLossMin, max: DEFAULT_GAME_CONFIG.lightning.moraleLossMax },
    0,
    100,
  );

  const refereeInput = value?.referee ?? {};
  const strictnessRange = orderedRange(
    { min: refereeInput.strictnessMin, max: refereeInput.strictnessMax },
    { min: DEFAULT_GAME_CONFIG.referee.strictnessMin, max: DEFAULT_GAME_CONFIG.referee.strictnessMax },
    0,
    100,
  );
  const penaltyRange = orderedRange(
    { min: refereeInput.penaltyBiasMin, max: refereeInput.penaltyBiasMax },
    { min: DEFAULT_GAME_CONFIG.referee.penaltyBiasMin, max: DEFAULT_GAME_CONFIG.referee.penaltyBiasMax },
    0,
    100,
  );
  const homeBiasRange = orderedRange(
    { min: refereeInput.homeBiasMin, max: refereeInput.homeBiasMax },
    { min: DEFAULT_GAME_CONFIG.referee.homeBiasMin, max: DEFAULT_GAME_CONFIG.referee.homeBiasMax },
    0,
    100,
  );

  return {
    weatherWeights,
    lightning: {
      chance: numberInRange(lightningInput.chance, DEFAULT_GAME_CONFIG.lightning.chance, 0, 1),
      fitnessLossMin: Math.round(fitnessRange.min),
      fitnessLossMax: Math.round(fitnessRange.max),
      moraleLossMin: Math.round(moraleRange.min),
      moraleLossMax: Math.round(moraleRange.max),
    },
    referee: {
      strictnessMin: Math.round(strictnessRange.min),
      strictnessMax: Math.round(strictnessRange.max),
      penaltyBiasMin: Math.round(penaltyRange.min),
      penaltyBiasMax: Math.round(penaltyRange.max),
      homeBiasMin: Math.round(homeBiasRange.min),
      homeBiasMax: Math.round(homeBiasRange.max),
    },
    economy: {
      victoryBaseGold: Math.round(numberInRange(value?.economy?.victoryBaseGold, DEFAULT_GAME_CONFIG.economy.victoryBaseGold, 0, 100000)),
      victoryGoldPerStage: Math.round(numberInRange(value?.economy?.victoryGoldPerStage, DEFAULT_GAME_CONFIG.economy.victoryGoldPerStage, 0, 10000)),
    },
  };
}
