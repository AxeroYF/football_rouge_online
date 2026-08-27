const ALLOWED_OVERFLOW_RATES = new Set([1, 0.5, 0.3]);

export function resolveOfflineAttributeSettings(environment = process.env) {
  const unlocked = environment.YDL_OFFLINE_MODE === "1" && environment.YDL_OFFLINE_ATTRIBUTE_UNCAP === "1";
  const requestedRate = Number(environment.YDL_OFFLINE_OVERCAP_RATE ?? 1);
  const overflowRate = unlocked && ALLOWED_OVERFLOW_RATES.has(requestedRate) ? requestedRate : 0;
  return Object.freeze({
    unlocked,
    overflowRate,
    baseMaximum:99,
  });
}

export const OFFLINE_ATTRIBUTE_SETTINGS = resolveOfflineAttributeSettings();

export function offlineAttributeMaximum(settings = OFFLINE_ATTRIBUTE_SETTINGS) {
  return settings.unlocked ? Number.POSITIVE_INFINITY : settings.baseMaximum;
}

export function offlineDisplayAttributeValue(value, settings = OFFLINE_ATTRIBUTE_SETTINGS, maximum = settings.baseMaximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, settings.unlocked ? numeric : Math.min(maximum, numeric));
}

export function offlineEngineAttributeValue(value, settings = OFFLINE_ATTRIBUTE_SETTINGS, maximum = settings.baseMaximum) {
  const displayed = offlineDisplayAttributeValue(value, settings, maximum);
  if (!settings.unlocked || displayed <= maximum) return Math.min(maximum, displayed);
  return maximum + (displayed - maximum) * settings.overflowRate;
}
