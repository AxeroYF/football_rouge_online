export const CAMPAIGN_BOUNDS = Object.freeze([
  Object.freeze([-20, -25]),
  Object.freeze([82, 100]),
]);

const SOUTH_AMERICA_DISPLAY_CENTER = Object.freeze({ lat: 7, lng: 20 });
const SOUTH_AMERICA_SOURCE_CENTER = Object.freeze({ lat: -21.5, lng: -57.5 });

export function isEuropeanFeature(feature) {
  const properties = feature.properties ?? {};
  const code = properties.ADM0_A3;
  return code !== "RUS" && (properties.CONTINENT === "Europe" || ["TUR", "CYP"].includes(code));
}

export function isSouthAmericanFeature(feature) {
  return feature.properties?.CONTINENT === "South America";
}

export function transformSouthAmericaPoint(lat, lng) {
  return [
    SOUTH_AMERICA_DISPLAY_CENTER.lat + (lng - SOUTH_AMERICA_SOURCE_CENTER.lng),
    SOUTH_AMERICA_DISPLAY_CENTER.lng + (lat - SOUTH_AMERICA_SOURCE_CENTER.lat),
  ];
}

function transformCoordinates(coordinates) {
  if (typeof coordinates[0] === "number") {
    const [lat, lng] = transformSouthAmericaPoint(coordinates[1], coordinates[0]);
    return [lng, lat];
  }
  return coordinates.map(transformCoordinates);
}

export function transformSouthAmericaFeature(feature) {
  const properties = feature.properties ?? {};
  const labelLat = Number(properties.LABEL_Y ?? properties.latitude);
  const labelLng = Number(properties.LABEL_X ?? properties.longitude);
  const transformedProperties = { ...properties };
  if (Number.isFinite(labelLat) && Number.isFinite(labelLng)) {
    const [displayLat, displayLng] = transformSouthAmericaPoint(labelLat, labelLng);
    transformedProperties.LABEL_Y = displayLat;
    transformedProperties.LABEL_X = displayLng;
    transformedProperties.MIN_LABEL = 3.2;
  }
  return {
    ...feature,
    properties: transformedProperties,
    geometry: feature.geometry
      ? { ...feature.geometry, coordinates: transformCoordinates(feature.geometry.coordinates) }
      : null,
  };
}

export function territoryPointToDisplay(point, region) {
  if (region !== "south-america") return [point[1], point[0]];
  return transformSouthAmericaPoint(point[1], point[0]);
}

export function displayPointToTerritory(latlng, region) {
  if (region !== "south-america") return [latlng.lng, latlng.lat];
  return [
    SOUTH_AMERICA_SOURCE_CENTER.lng + (latlng.lat - SOUTH_AMERICA_DISPLAY_CENTER.lat),
    SOUTH_AMERICA_SOURCE_CENTER.lat + (latlng.lng - SOUTH_AMERICA_DISPLAY_CENTER.lng),
  ];
}
