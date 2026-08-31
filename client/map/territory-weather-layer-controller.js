const WEATHER_STYLES = Object.freeze({
  sunny: Object.freeze({ fillColor:"#e6bf5b", fillOpacity:0.055, color:"#e6bf5b", opacity:0.12, weight:0.55 }),
  rain: Object.freeze({ fillColor:"url(#ydl-weather-rain-pattern)", fillOpacity:1, color:"#71d9d0", opacity:0.48, weight:0.8, dashArray:"2 5" }),
  snow: Object.freeze({ fillColor:"url(#ydl-weather-snow-pattern)", fillOpacity:1, color:"#edfafa", opacity:0.58, weight:0.75, dashArray:"1 4" }),
  storm: Object.freeze({ fillColor:"url(#ydl-weather-storm-pattern)", fillOpacity:1, color:"#71d9d0", opacity:0.62, weight:1.05, dashArray:"4 4" }),
  superStorm: Object.freeze({ fillColor:"url(#ydl-weather-super-storm-pattern)", fillOpacity:1, color:"#d19bff", opacity:0.78, weight:1.25, dashArray:"6 3" }),
});

const WEATHER_PATTERN_MARKUP = `
  <pattern id="ydl-weather-rain-pattern" width="14" height="14" patternUnits="userSpaceOnUse">
    <rect width="14" height="14" fill="#3f97a9" fill-opacity=".2" />
    <path d="M3 -3L-2 7M16 5L11 15" stroke="#8be7e1" stroke-opacity=".58" stroke-width="1.4" />
  </pattern>
  <pattern id="ydl-weather-snow-pattern" width="26" height="26" patternUnits="userSpaceOnUse">
    <rect width="26" height="26" fill="#dceff2" fill-opacity=".21" />
    <g stroke="#f4ffff" stroke-opacity=".72" stroke-width="1" stroke-linecap="round">
      <path d="M7 3V13M2.7 5.5L11.3 10.5M11.3 5.5L2.7 10.5" />
      <path d="M20 16V24M16.5 18L23.5 22M23.5 18L16.5 22" />
    </g>
  </pattern>
  <pattern id="ydl-weather-storm-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
    <rect width="20" height="20" fill="#253c50" fill-opacity=".35" />
    <path d="M4 -3L-2 9M22 4L16 16" stroke="#71d9d0" stroke-opacity=".48" stroke-width="1.5" />
    <path d="M12 2L8 9H12L7 18" fill="none" stroke="#e5d56a" stroke-opacity=".7" stroke-width="1.2" stroke-linejoin="round" />
  </pattern>
  <pattern id="ydl-weather-super-storm-pattern" width="22" height="22" patternUnits="userSpaceOnUse">
    <rect width="22" height="22" fill="#582d6f" fill-opacity=".47" />
    <path d="M5 -4L-1 9M24 3L18 17" stroke="#83e9e3" stroke-opacity=".58" stroke-width="1.8" />
    <path d="M14 1L9 10H14L8 21" fill="none" stroke="#f3dd72" stroke-opacity=".9" stroke-width="1.6" stroke-linejoin="round" />
  </pattern>`;

function weatherType(snapshot, territoryId) {
  const type = snapshot?.territories?.[territoryId]?.type;
  return WEATHER_STYLES[type] ? type : "sunny";
}

export function createTerritoryWeatherLayerController({
  Leaflet,
  map,
  renderer,
  displayTerritories,
  getWeatherSnapshot,
} = {}) {
  if (!Leaflet || !map || !renderer || !displayTerritories || typeof getWeatherSnapshot !== "function") {
    throw new Error("Territory weather layer dependencies are required");
  }
  let enabled = false;
  let renderSignature = null;
  let weatherLayer = null;
  let polygonCount = 0;

  function ensureWeatherPatterns() {
    const svg = renderer._container;
    if (!svg?.ownerDocument?.createElementNS || svg.querySelector?.("#ydl-weather-patterns")) return;
    const definitions = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "defs");
    definitions.id = "ydl-weather-patterns";
    definitions.innerHTML = WEATHER_PATTERN_MARKUP;
    svg.insertBefore(definitions, svg.firstChild);
  }

  function removeLayer() {
    if (weatherLayer && map.hasLayer?.(weatherLayer)) map.removeLayer(weatherLayer);
    weatherLayer = null;
    polygonCount = 0;
  }

  function createLayer(snapshot) {
    polygonCount = 0;
    const layer = Leaflet.geoJSON(displayTerritories, {
      pane:"weatherPane",
      renderer,
      interactive:false,
      bubblingMouseEvents:false,
      style(feature) {
        const type = weatherType(snapshot, feature.properties.territoryId);
        polygonCount += 1;
        return {
          ...WEATHER_STYLES[type],
          pane:"weatherPane",
          renderer,
          interactive:false,
          fill:true,
          className:`territory-weather-fill weather-${type}`,
        };
      },
    });
    layer.addTo(map);
    ensureWeatherPatterns();
    return layer;
  }

  function refresh({ force = false } = {}) {
    if (!enabled) return 0;
    const snapshot = getWeatherSnapshot();
    const signature = String(snapshot?.hourKey ?? "none");
    if (!force && signature === renderSignature) return polygonCount;
    renderSignature = signature;
    removeLayer();
    weatherLayer = createLayer(snapshot);
    return polygonCount;
  }

  function setEnabled(value) {
    const next = Boolean(value);
    if (next === enabled) return enabled;
    enabled = next;
    renderSignature = null;
    if (enabled) refresh({ force:true });
    else removeLayer();
    return enabled;
  }

  return Object.freeze({
    isEnabled:() => enabled,
    polygonCount:() => polygonCount,
    refresh,
    setEnabled,
    destroy() { setEnabled(false); },
  });
}
