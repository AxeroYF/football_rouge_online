import {applyEliteTerritoryRules} from '../../shared/config/elite-clubs.mjs';
import { mapAssetUrl } from '../../shared/config/map-assets.mjs';

const MAP_ASSETS = Object.freeze({
  countries: './assets/data/campaign-countries.geojson',
  europeCities: './assets/data/europe-cities.json',
  southAmericaCities: './assets/data/south-america-cities.json',
  clubs: './assets/data/europe-clubs.json',
  territories: './assets/data/campaign-territories.geojson',
  territoryIndex: './assets/data/territory-index.json',
  territoryResources: './assets/data/territory-resources.json',
  coastlines: './assets/data/campaign-coastlines.json',
  reliefRegions: './shared/config/map-relief-regions.json',
});

// Login warm-up and map startup share one request and one JSON parse per asset.
// Each injected transport has its own cache; failed loads are retryable.
const loads = new WeakMap();
async function fetchMapJson(fetchImpl, url, timeoutMs) {
  // Include reading the body in the timeout; stalled transfers must not poison the shared promise.
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, {cache: attempt ? 'reload' : 'default', signal: controller.signal});
          if (!response.ok) throw new Error('map data unavailable: ' + url + ' (' + response.status + ')');
          return await response.json();
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          reject(new Error('map data timeout: ' + url)); controller.abort();
        }, timeoutMs); }),
      ]);
    } catch (error) { lastError = error; controller.abort(); }
    finally { clearTimeout(timer); }
  }
  throw lastError;
}
export function loadCampaignMapData({ fetchImpl = globalThis.fetch, version, timeoutMs = 30000 } = {}) {
  if (typeof fetchImpl !== 'function') return Promise.reject(new Error('Map asset fetch implementation is required'));
  let versions = loads.get(fetchImpl);
  if (!versions) { versions = new Map(); loads.set(fetchImpl, versions); }
  if (versions.has(version)) return versions.get(version);
  const pending = Promise.all(Object.entries(MAP_ASSETS).map(async ([key, path]) => {
    const url = version === undefined ? mapAssetUrl(path) : path + '?v=' + encodeURIComponent(version);
    return [key, await fetchMapJson(fetchImpl, url, timeoutMs)];
  })).then(entries => {
    const data = Object.fromEntries(entries);
    applyEliteTerritoryRules(data.territoryIndex);
    const eliteIds=new Set((data.territoryIndex?.territories??[]).flatMap(t=>t.eliteClubIds??[]));
    const byId=new Map((data.territoryIndex?.territories??[]).map(t=>[t.territoryId,t]));
    for(const feature of data.territories?.features??[]){const t=byId.get(feature.properties?.territoryId);if(t&&feature.properties){feature.properties.clubCount=(t.clubIds?.length??0);feature.properties.initialOwnerType=t.initialOwner?.type;}}
    return Object.freeze({
      countries: data.countries,
      cities: [...data.europeCities, ...data.southAmericaCities],
      clubs: eliteIds.size ? data.clubs.filter(c=>eliteIds.has(c.id)) : data.clubs,
      territories: data.territories,
      territoryIndex: data.territoryIndex,
      territoryResources: data.territoryResources,
      coastlines: data.coastlines,
      reliefRegions: data.reliefRegions,
    });
  }).catch(error => { versions.delete(version); throw error; });
  versions.set(version, pending);
  return pending;
}
