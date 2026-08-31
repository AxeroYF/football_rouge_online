import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CAMPAIGN_WEATHER_REFRESH_MS,
  CAMPAIGN_WEATHER_TYPES,
  campaignWeatherHour,
  createCampaignWeatherSnapshot,
  createTerritoryWeather,
} from "../engine/campaign-weather.mjs";

const territoryIndex = JSON.parse(readFileSync(new URL("../assets/data/territory-index.json", import.meta.url), "utf8"));

test("campaign weather is deterministic within an hour and refreshes on the next real-time hour", () => {
  const territory = territoryIndex.territories[0];
  const timestamp = Date.UTC(2026, 0, 5, 12, 34, 56);
  const first = createTerritoryWeather({ territory, timestamp, seed:"hourly-test" });
  const repeated = createTerritoryWeather({ territory, timestamp:timestamp + 20 * 60 * 1000, seed:"hourly-test" });
  assert.deepEqual(repeated, first);
  assert.equal(campaignWeatherHour(timestamp).observedAt, Date.UTC(2026, 0, 5, 12));
  assert.equal(campaignWeatherHour(timestamp).refreshAt, Date.UTC(2026, 0, 5, 13));
  const firstSnapshot = createCampaignWeatherSnapshot({ territoryIndex, timestamp, seed:"hourly-test" });
  const nextSnapshot = createCampaignWeatherSnapshot({ territoryIndex, timestamp:timestamp + CAMPAIGN_WEATHER_REFRESH_MS, seed:"hourly-test" });
  assert.equal(Object.keys(firstSnapshot.territories).length, territoryIndex.territories.length);
  assert.ok(Object.keys(firstSnapshot.territories).some((id) => firstSnapshot.territories[id].type !== nextSnapshot.territories[id].type
    || firstSnapshot.territories[id].precipitation !== nextSnapshot.territories[id].precipitation));
});

test("real map weather keeps sunny dominant while preserving every V2.1 weather type", () => {
  const start = Date.UTC(2026, 0, 1);
  const counts = Object.fromEntries(Object.keys(CAMPAIGN_WEATHER_TYPES).map((type) => [type, 0]));
  let stable = 0;
  let comparisons = 0;
  let previous = null;
  for (let hour = 0; hour < 168; hour += 1) {
    const snapshot = createCampaignWeatherSnapshot({ territoryIndex, timestamp:start + hour * CAMPAIGN_WEATHER_REFRESH_MS, seed:"distribution-test" });
    for (const [territoryId, weather] of Object.entries(snapshot.territories)) {
      counts[weather.type] += 1;
      assert.ok(weather.icon && weather.label);
      assert.ok(weather.precipitation >= 0 && weather.precipitation <= 100);
      if (previous) {
        comparisons += 1;
        if (previous[territoryId].type === weather.type) stable += 1;
      }
    }
    previous = snapshot.territories;
  }
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  assert.ok(counts.sunny / total > 0.55);
  assert.ok(counts.superStorm / total < 0.03);
  assert.ok(Object.values(counts).every((count) => count > 0));
  assert.ok(stable / comparisons > 0.6);
});

test("nearby territories share a regional front and cold winters favor snow", () => {
  const nearA = { territoryId:"near-a", centroid:[10.1, 58.1] };
  const nearB = { territoryId:"near-b", centroid:[10.4, 58.3] };
  const tropical = { territoryId:"tropical", centroid:[10.1, 2.1] };
  const start = Date.UTC(2026, 0, 1);
  let agreement = 0;
  let northernSnow = 0;
  let tropicalSnow = 0;
  for (let hour = 0; hour < 720; hour += 1) {
    const timestamp = start + hour * CAMPAIGN_WEATHER_REFRESH_MS;
    const weatherA = createTerritoryWeather({ territory:nearA, timestamp, seed:"regional-test" });
    const weatherB = createTerritoryWeather({ territory:nearB, timestamp, seed:"regional-test" });
    const tropicalWeather = createTerritoryWeather({ territory:tropical, timestamp, seed:"regional-test" });
    if (weatherA.type === weatherB.type) agreement += 1;
    if (weatherA.type === "snow") northernSnow += 1;
    if (tropicalWeather.type === "snow") tropicalSnow += 1;
  }
  assert.ok(agreement / 720 > 0.65);
  assert.ok(northernSnow > tropicalSnow * 3);
});
