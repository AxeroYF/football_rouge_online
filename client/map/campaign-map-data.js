const MAP_ASSET_VERSION = "20260903-physical-slope-detail-v6";

const MAP_ASSETS = Object.freeze({
  countries: "./assets/data/natural-earth-countries-50m.geojson",
  europeCities: "./assets/data/europe-cities.json",
  southAmericaCities: "./assets/data/south-america-cities.json",
  clubs: "./assets/data/europe-clubs.json",
  territories: "./assets/data/campaign-territories.geojson",
  territoryIndex: "./assets/data/territory-index.json",
  coastlines: "./assets/data/campaign-coastlines.json",
  reliefRegions: "./shared/config/map-relief-regions.json",
});

function assetUrl(path, version) {
  return `${path}?v=${encodeURIComponent(version)}`;
}

export async function loadCampaignMapData({
  fetchImpl = globalThis.fetch,
  version = MAP_ASSET_VERSION,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Map asset fetch implementation is required");
  const entries = Object.entries(MAP_ASSETS);
  const responses = await Promise.all(
    entries.map(([, path]) => fetchImpl(assetUrl(path, version), { cache: "no-cache" })),
  );
  if (!responses.every((response) => response.ok)) throw new Error("map data unavailable");

  const values = await Promise.all(responses.map((response) => response.json()));
  const data = Object.fromEntries(entries.map(([key], index) => [key, values[index]]));
  return Object.freeze({
    countries: data.countries,
    cities: [...data.europeCities, ...data.southAmericaCities],
    clubs: data.clubs,
    territories: data.territories,
    territoryIndex: data.territoryIndex,
    coastlines: data.coastlines,
    reliefRegions: data.reliefRegions,
  });
}
