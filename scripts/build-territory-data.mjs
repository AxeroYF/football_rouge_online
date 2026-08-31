import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { merge as topologyMerge, neighbors as topologyNeighbors } from "topojson-client";
import { topology } from "topojson-server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.join(root, "assets", "data");

async function readJson(name) {
  return JSON.parse(await fs.readFile(path.join(dataDirectory, name), "utf8"));
}

function visitCoordinates(coordinates, callback) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number") {
    callback(coordinates[0], coordinates[1]);
    return;
  }
  coordinates.forEach((child) => visitCoordinates(child, callback));
}

function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  visitCoordinates(geometry.coordinates, (lng, lat) => {
    bounds[0] = Math.min(bounds[0], lng);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lng);
    bounds[3] = Math.max(bounds[3], lat);
  });
  return bounds;
}

function boundsArea(bounds) {
  return Math.max(0, bounds[2] - bounds[0]) * Math.max(0, bounds[3] - bounds[1]);
}

function boundsContain(bounds, lng, lat) {
  return lng >= bounds[0] && lng <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];
}

function distanceSquared(left, right) {
  const latitudeScale = Math.cos(((left[1] + right[1]) / 2) * Math.PI / 180);
  const lngDistance = (left[0] - right[0]) * latitudeScale;
  const latDistance = left[1] - right[1];
  return lngDistance * lngDistance + latDistance * latDistance;
}

function stableTerritoryId(properties) {
  const sourceId = properties.adm1_code || properties.iso_3166_2 || properties.code_hasc || `ne-${properties.ne_id}`;
  if (!sourceId) throw new Error(`territory has no stable source id: ${properties.name}`);
  const slug = String(sourceId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `adm1:${slug}`;
}

function normalizedTerritoryFeature(feature, region, countryByCode) {
  const properties = feature.properties ?? {};
  const territoryId = stableTerritoryId(properties);
  const bounds = geometryBounds(feature.geometry);
  const sourceLng = Number(properties.longitude);
  const sourceLat = Number(properties.latitude);
  const sourcePointIsValid = Number.isFinite(sourceLng)
    && Number.isFinite(sourceLat)
    && booleanPointInPolygon(point([sourceLng, sourceLat]), feature);
  const centroid = [
    sourcePointIsValid ? sourceLng : (bounds[0] + bounds[2]) / 2,
    sourcePointIsValid ? sourceLat : (bounds[1] + bounds[3]) / 2,
  ];
  const countryCode = properties.adm0_a3;
  const country = countryByCode.get(countryCode);
  return {
    type: "Feature",
    id: territoryId,
    geometry: feature.geometry,
    properties: {
      territoryId,
      sourceId: properties.adm1_code ?? null,
      region,
      countryCode,
      country: country?.NAME_ZH || country?.NAME_EN || properties.admin,
      name: properties.name_zh || properties.name_en || properties.name,
      nameEn: properties.name_en || properties.name,
      type: properties.type_en || properties.type || "Administrative area",
      playable: true,
      centroid,
      bounds,
    },
  };
}

const SMALL_FRAGMENTED_COUNTRY_CODES = new Set(["LVA", "MKD", "MLT", "SVN"]);

function mergeSmallCountryTerritories(sourceFeatures, countryByCode) {
  const membersByCode = Object.groupBy(sourceFeatures, (feature) => feature.properties.countryCode);
  const territoryIdAliases = {};
  const mergedCountrySourceCounts = {};
  const emittedCodes = new Set();
  const mergedFeatures = [];

  for (const feature of sourceFeatures) {
    const countryCode = feature.properties.countryCode;
    if (!SMALL_FRAGMENTED_COUNTRY_CODES.has(countryCode)) {
      mergedFeatures.push(feature);
      continue;
    }
    if (emittedCodes.has(countryCode)) continue;
    emittedCodes.add(countryCode);
    const members = membersByCode[countryCode] ?? [];
    if (members.length <= 1) {
      mergedFeatures.push(...members);
      continue;
    }

    const countryTopology = topology({ territories:{ type:"FeatureCollection", features:members } }, 100000);
    const geometry = topologyMerge(countryTopology, countryTopology.objects.territories.geometries);
    const country = countryByCode.get(countryCode) ?? {};
    const territoryId = `adm1:country-${countryCode.toLowerCase()}`;
    const mergedFeature = {
      type: "Feature",
      id: territoryId,
      geometry,
      properties: {
        territoryId,
        sourceId: `${countryCode}-MERGED`,
        region: members[0].properties.region,
        countryCode,
        country: country.NAME_ZH || country.NAME_EN || members[0].properties.country,
        name: country.NAME_ZH || country.NAME_EN || members[0].properties.country,
        nameEn: country.NAME_EN || members[0].properties.country,
        type: "Country",
        playable: true,
        mergedSourceTerritoryIds: members.map((member) => member.properties.territoryId).sort(),
      },
    };
    const bounds = geometryBounds(geometry);
    const labelPoint = [Number(country.LABEL_X), Number(country.LABEL_Y)];
    const labelIsValid = labelPoint.every(Number.isFinite) && booleanPointInPolygon(point(labelPoint), mergedFeature);
    const memberCentroid = members.map((member) => member.properties.centroid).find((candidate) => booleanPointInPolygon(point(candidate), mergedFeature));
    mergedFeature.properties.bounds = bounds;
    mergedFeature.properties.centroid = labelIsValid ? labelPoint : memberCentroid ?? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    for (const member of members) territoryIdAliases[member.properties.territoryId] = territoryId;
    mergedCountrySourceCounts[countryCode] = members.length;
    mergedFeatures.push(mergedFeature);
  }

  return {
    features: mergedFeatures.sort((left, right) => left.properties.territoryId.localeCompare(right.properties.territoryId)),
    territoryIdAliases,
    mergedCountrySourceCounts,
  };
}
function findTerritoryForCity(city, features, metadataById, countryCodeByChineseName) {
  const cityPoint = point([city.lng, city.lat]);
  const bounded = features.filter((feature) => boundsContain(feature.properties.bounds, city.lng, city.lat));
  const containing = bounded.filter((feature) => booleanPointInPolygon(cityPoint, feature));
  if (containing.length) {
    const selected = containing.sort((left, right) => boundsArea(left.properties.bounds) - boundsArea(right.properties.bounds))[0];
    return { territoryId: selected.properties.territoryId, method: "point-in-polygon" };
  }

  const expectedCountry = countryCodeByChineseName.get(city.country);
  const sameCountry = features.filter((feature) => feature.properties.countryCode === expectedCountry);
  const candidates = sameCountry.length ? sameCountry : features;
  const nearest = candidates
    .map((feature) => ({
      territoryId: feature.properties.territoryId,
      distance: distanceSquared([city.lng, city.lat], metadataById.get(feature.properties.territoryId).centroid),
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  return { territoryId: nearest.territoryId, method: "nearest-centroid-fallback" };
}

const [countries, europe, southAmerica, europeCities, southAmericaCities, clubs] = await Promise.all([
  readJson("natural-earth-countries-50m.geojson"),
  readJson("europe-admin1-10m.geojson"),
  readJson("south-america-admin1-10m.geojson"),
  readJson("europe-cities.json"),
  readJson("south-america-cities.json"),
  readJson("europe-clubs.json"),
]);

const countryByCode = new Map(countries.features.map((feature) => [feature.properties.ADM0_A3, feature.properties]));
const countryCodeByChineseName = new Map(countries.features.map((feature) => [feature.properties.NAME_ZH, feature.properties.ADM0_A3]));
const normalizedFeatures = [
  ...europe.features.map((feature) => normalizedTerritoryFeature(feature, "europe", countryByCode)),
  ...southAmerica.features.map((feature) => normalizedTerritoryFeature(feature, "south-america", countryByCode)),
];
const { features, territoryIdAliases, mergedCountrySourceCounts } = mergeSmallCountryTerritories(normalizedFeatures, countryByCode);

const ids = features.map((feature) => feature.properties.territoryId);
if (new Set(ids).size !== ids.length) throw new Error("duplicate territory ids detected");

const territoryCollection = { type: "FeatureCollection", name: "campaign-territories", features };
const territoryTopology = topology({ territories: territoryCollection }, 100000);
const adjacencyIndexes = topologyNeighbors(territoryTopology.objects.territories.geometries);
const adjacencySets = adjacencyIndexes.map((indexes, index) => new Set(indexes.filter((neighborIndex) => neighborIndex !== index)));
const maritimeSets = features.map(() => new Set());

adjacencySets.forEach((neighbors, index) => {
  if (neighbors.size) return;
  const territory = features[index].properties;
  const indexedFeatures = features.map((feature, candidateIndex) => ({ feature, candidateIndex }));
  const sameCountry = indexedFeatures.filter(({ feature, candidateIndex }) => candidateIndex !== index && feature.properties.countryCode === territory.countryCode);
  const sameRegion = indexedFeatures.filter(({ feature, candidateIndex }) => candidateIndex !== index && feature.properties.region === territory.region);
  const candidates = sameCountry.length ? sameCountry : sameRegion;
  const nearest = candidates
    .map(({ feature, candidateIndex }) => ({
      candidateIndex,
      distance: distanceSquared(territory.centroid, feature.properties.centroid),
    }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!nearest) return;
  adjacencySets[index].add(nearest.candidateIndex);
  adjacencySets[nearest.candidateIndex].add(index);
  maritimeSets[index].add(nearest.candidateIndex);
  maritimeSets[nearest.candidateIndex].add(index);
});

const metadata = features.map((feature, index) => ({
  ...feature.properties,
  neighbors: [...adjacencySets[index]].map((neighborIndex) => features[neighborIndex].properties.territoryId).sort(),
  landNeighbors: [...adjacencySets[index]].filter((neighborIndex) => !maritimeSets[index].has(neighborIndex)).map((neighborIndex) => features[neighborIndex].properties.territoryId).sort(),
  maritimeNeighbors: [...maritimeSets[index]].map((neighborIndex) => features[neighborIndex].properties.territoryId).sort(),
  cityIds: [],
  clubIds: [],
  spawnAllowed: true,
  initialOwner: { type: "neutral", id: null, name: "中立地区" },
}));
const metadataById = new Map(metadata.map((territory) => [territory.territoryId, territory]));

const cities = [...europeCities, ...southAmericaCities];
const cityMappings = {};
for (const city of cities) {
  const mapping = findTerritoryForCity(city, features, metadataById, countryCodeByChineseName);
  cityMappings[city.id] = { cityId: city.id, territoryId: mapping.territoryId, method: mapping.method };
  metadataById.get(mapping.territoryId).cityIds.push(city.id);
}

const clubMappings = {};
for (const club of clubs) {
  const cityMapping = cityMappings[club.city];
  if (!cityMapping) throw new Error(`club ${club.id} references unmapped city ${club.city}`);
  clubMappings[club.id] = { clubId: club.id, cityId: club.city, territoryId: cityMapping.territoryId };
  metadataById.get(cityMapping.territoryId).clubIds.push(club.id);
}

const clubById = new Map(clubs.map((club) => [club.id, club]));
for (const territory of metadata) {
  territory.cityIds.sort();
  territory.clubIds.sort();
  if (territory.clubIds.length) {
    territory.spawnAllowed = false;
    territory.initialOwner = {
      type: "club",
      id: `club-garrison:${territory.territoryId}`,
      name: territory.clubIds.map((clubId) => clubById.get(clubId).name).join(" / "),
    };
  }
}

const londonClubIds = clubs.filter((club) => club.city === "london").map((club) => club.id).sort();
const greaterLondonTerritories = metadata.filter((territory) => {
  const [longitude, latitude] = territory.centroid;
  return territory.countryCode === "GBR"
    && longitude >= -0.55
    && longitude <= 0.35
    && latitude >= 51.25
    && latitude <= 51.7
    && (territory.type.startsWith("London Borough") || territory.nameEn === "London");
});
for (const territory of greaterLondonTerritories) {
  territory.spawnAllowed = false;
  territory.garrisonClubIds = londonClubIds;
  territory.initialOwner = {
    type: "club",
    id: "club-garrison:greater-london",
    name: londonClubIds.map((clubId) => clubById.get(clubId).name).join(" / "),
  };
}

for (const feature of features) {
  const territory = metadataById.get(feature.properties.territoryId);
  feature.properties.cityCount = territory.cityIds.length;
  feature.properties.clubCount = territory.clubIds.length;
  feature.properties.spawnAllowed = territory.spawnAllowed;
  feature.properties.initialOwnerType = territory.initialOwner.type;
  delete feature.properties.bounds;
  delete feature.properties.centroid;
}

const mappingMethods = Object.values(cityMappings).reduce((counts, mapping) => {
  counts[mapping.method] = (counts[mapping.method] ?? 0) + 1;
  return counts;
}, {});
const report = {
  schemaVersion: 2,
  territoryCount: metadata.length,
  adjacencyEdges: metadata.reduce((sum, territory) => sum + territory.neighbors.length, 0) / 2,
  maritimeEdges: metadata.reduce((sum, territory) => sum + territory.maritimeNeighbors.length, 0) / 2,
  isolatedTerritories: metadata.filter((territory) => territory.neighbors.length === 0).length,
  cityCount: cities.length,
  clubCount: clubs.length,
  clubTerritoryCount: metadata.filter((territory) => territory.initialOwner.type === "club").length,
  mappingMethods,
  countries: Object.fromEntries(Object.entries(Object.groupBy(metadata, (territory) => territory.countryCode)).map(([code, entries]) => [code, entries.length])),
  mergedCountrySourceCounts,
};
const index = {
  schemaVersion: 2,
  source: "Natural Earth ne_10m_admin_1_states_provinces",
  territoryCount: metadata.length,
  territoryIdAliases,
  territories: metadata,
  cities: cityMappings,
  clubs: clubMappings,
};

await Promise.all([
  fs.writeFile(path.join(dataDirectory, "campaign-territories.geojson"), JSON.stringify(territoryCollection)),
  fs.writeFile(path.join(dataDirectory, "territory-index.json"), JSON.stringify(index)),
  fs.writeFile(path.join(dataDirectory, "territory-build-report.json"), JSON.stringify(report, null, 2)),
]);

console.log(JSON.stringify(report, null, 2));