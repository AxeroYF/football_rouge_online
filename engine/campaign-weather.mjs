export const CAMPAIGN_WEATHER_REFRESH_MS = 60 * 60 * 1000;

export const CAMPAIGN_WEATHER_TYPES = Object.freeze({
  sunny: Object.freeze({ type: "sunny", label: "晴朗", icon: "☀", precipitation: [0, 0] }),
  snow: Object.freeze({ type: "snow", label: "雪天", icon: "❄", precipitation: [35, 60] }),
  rain: Object.freeze({ type: "rain", label: "雨天", icon: "🌧", precipitation: [45, 75] }),
  storm: Object.freeze({ type: "storm", label: "雷暴", icon: "⛈", precipitation: [70, 90] }),
  superStorm: Object.freeze({ type: "superStorm", label: "超级雷暴", icon: "🌩", precipitation: [100, 100] }),
});

const BASE_WEIGHTS = Object.freeze({ sunny: 64, rain: 15, storm: 10, snow: 10, superStorm: 1 });

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function randomUnit(value) {
  return hash(value) / 4294967296;
}

function weightedType(weights, roll) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, Number(weight) || 0), 0);
  let cursor = clamp(roll) * total;
  for (const [type, weight] of entries) {
    cursor -= Math.max(0, Number(weight) || 0);
    if (cursor <= 0) return type;
  }
  return entries.at(-1)?.[0] ?? "sunny";
}

function territoryCoordinates(territory) {
  const [longitude, latitude] = Array.isArray(territory?.centroid) ? territory.centroid.map(Number) : [];
  if (Number.isFinite(longitude) && Number.isFinite(latitude)) return { longitude, latitude };
  const fallback = hash(territory?.territoryId ?? territory?.name ?? "territory");
  return {
    longitude: (fallback % 12000) / 100 - 70,
    latitude: ((fallback >>> 8) % 9000) / 100 - 35,
  };
}

function coldSeasonStrength(latitude, timestamp) {
  const month = new Date(timestamp).getUTCMonth();
  const winterMonth = latitude < 0 ? 6 : 0;
  const distance = Math.min(Math.abs(month - winterMonth), 12 - Math.abs(month - winterMonth));
  return clamp(1 - distance / 6);
}

function climateWeights(territory, timestamp) {
  const { longitude, latitude } = territoryCoordinates(territory);
  const absoluteLatitude = Math.abs(latitude);
  const coldLatitude = clamp((absoluteLatitude - 25) / 35);
  const cold = coldLatitude * (0.2 + coldSeasonStrength(latitude, timestamp) * 0.8);
  const tropical = clamp((30 - absoluteLatitude) / 25);
  const atlantic = clamp((18 - Math.abs(longitude + 4)) / 25);
  const snow = 0.5 + cold * 20;
  const removedSnow = Math.max(0, BASE_WEIGHTS.snow - snow);
  return {
    sunny: BASE_WEIGHTS.sunny + removedSnow * 0.62 - tropical * 3 - atlantic * 1.5,
    rain: BASE_WEIGHTS.rain + removedSnow * 0.28 + tropical * 2 + atlantic * 2.5,
    storm: BASE_WEIGHTS.storm + removedSnow * 0.1 + tropical * 1.5,
    snow,
    superStorm: BASE_WEIGHTS.superStorm + tropical * 0.35,
  };
}

function regionalCell(territory) {
  const { longitude, latitude } = territoryCoordinates(territory);
  return `${Math.floor((longitude + 180) / 8)}:${Math.floor((latitude + 90) / 6)}`;
}

export function campaignWeatherHour(timestamp = Date.now()) {
  const observedAt = Math.floor(Number(timestamp) / CAMPAIGN_WEATHER_REFRESH_MS) * CAMPAIGN_WEATHER_REFRESH_MS;
  return {
    hourKey: Math.floor(observedAt / CAMPAIGN_WEATHER_REFRESH_MS),
    observedAt,
    refreshAt: observedAt + CAMPAIGN_WEATHER_REFRESH_MS,
  };
}

export function createTerritoryWeather({ territory, timestamp = Date.now(), seed = "ydl-campaign-weather" } = {}) {
  const clock = campaignWeatherHour(timestamp);
  const territoryId = String(territory?.territoryId ?? territory?.id ?? "unknown");
  const cell = regionalCell(territory);
  const frontWindow = Math.floor(clock.hourKey / 4);
  const weights = climateWeights(territory, clock.observedAt);
  const frontType = weightedType(weights, randomUnit(`${seed}:front:${frontWindow}:${cell}`));
  const localOverride = randomUnit(`${seed}:local-change:${clock.hourKey}:${territoryId}`) < 0.18;
  const type = localOverride
    ? weightedType(weights, randomUnit(`${seed}:local-type:${clock.hourKey}:${territoryId}`))
    : frontType;
  const definition = CAMPAIGN_WEATHER_TYPES[type] ?? CAMPAIGN_WEATHER_TYPES.sunny;
  const [minimum, maximum] = definition.precipitation;
  const precipitation = Math.round(minimum + (maximum - minimum)
    * randomUnit(`${seed}:precipitation:${clock.hourKey}:${territoryId}`));
  return Object.freeze({ type: definition.type, label: definition.label, icon: definition.icon, precipitation });
}

export function createCampaignWeatherSnapshot({ territoryIndex, timestamp = Date.now(), seed = "ydl-campaign-weather" } = {}) {
  const clock = campaignWeatherHour(timestamp);
  const territories = Object.fromEntries((territoryIndex?.territories ?? []).map((territory) => [
    territory.territoryId,
    createTerritoryWeather({ territory, timestamp: clock.observedAt, seed }),
  ]));
  return Object.freeze({
    schemaVersion: 1,
    hourKey: clock.hourKey,
    observedAt: clock.observedAt,
    refreshAt: clock.refreshAt,
    territories: Object.freeze(territories),
  });
}
