import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OWNER_TYPES } from "../territory-model.js";
import { createTerritoryPresentation } from "../client/map/territory-presentation.js";
import { expeditionTokenMetrics } from "../client/map/expedition-piece-controller.js";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const territoryPresentationSource = await readFile(new URL("../client/map/territory-presentation.js", import.meta.url), "utf8");
const maritimeControllerSource = await readFile(new URL("../client/maritime/maritime-controller.js", import.meta.url), "utf8");
const challengeControllerSource = await readFile(new URL("../client/challenge/challenge-controller.js", import.meta.url), "utf8");
const inventoryControllerSource = await readFile(new URL("../client/inventory/inventory-controller.js", import.meta.url), "utf8");
const broadcastSource = await readFile(new URL("../campaign-broadcast.js", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const schedulerSource = await readFile(new URL("../server/scheduler/challenge-scheduler.mjs", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const inertialWheelSource = await readFile(new URL("../client/map/inertial-wheel-zoom.js", import.meta.url), "utf8");
const expeditionPieceSource = await readFile(new URL("../client/map/expedition-piece-controller.js", import.meta.url), "utf8");

function functionSource(name, nextName, source = appSource, sourceName = "app.js") {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} should exist in ${sourceName}`);
  assert.notEqual(end, -1, `${nextName} should follow ${name} in ${sourceName}`);
  return source.slice(start, end);
}

test("maritime target styling stays separate from owner labels", () => {
  const context = {
    territoryWorld: { territories: { coast: { ownerType: OWNER_TYPES.NEUTRAL } } },
    campaignState: { world: { activeChallenges: {} } },
    campaignWorldPlayers: {},
    selectedTerritoryId: null,
    homeSelectionMode: false,
    homeSelectionPermission: () => ({ allowed: false }),
    maritimeTargetIds: new Set(["coast"]),
  };
  const presentation = createTerritoryPresentation({
    ownerTypes: OWNER_TYPES,
    escapeHtml: String,
    getContext: () => context,
  });

  assert.equal(presentation.territoryStyle({ properties: { territoryId: "coast" } }).color, "#71d9d0");
  assert.equal(
    presentation.territoryOwnerLabel({ initialOwner: { name: "" } }, context.territoryWorld.territories.coast),
    "无主中立地区",
  );
});

test("coast snapping uses continuous coastline segments", () => {
  const snapSource = functionSource(
    "nearestCoastPoint",
    "updateMaritimeSnap",
    maritimeControllerSource,
    "maritime-controller.js",
  );
  assert.match(snapSource, /coastlines/);
  assert.match(snapSource, /lengthSquared/);
  assert.doesNotMatch(snapSource, /samplePoints/);
});

test("map layer defaults keep national borders, weather and major cities off", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(appSource, /let countryBordersVisible = false;/);
  assert.match(appSource, /let majorCitiesVisible = false;/);
  assert.match(appSource, /const cityLayer = L\.layerGroup\(\);/);
  assert.match(appSource, /setMajorCitiesVisible\(majorCitiesVisible\)/);
  assert.match(appSource, /let weatherLayerVisible = false;/);
  assert.match(indexSource, /id="country-borders-toggle" type="checkbox" \/>/);
  assert.match(indexSource, /id="major-cities-toggle" type="checkbox" \/>/);
  assert.match(indexSource, /id="weather-layer-toggle" type="checkbox" \/>/);
  assert.match(appSource, /weatherLayerController\?\.setEnabled\(weatherLayerVisible\)/);
});

test("map hides zoom readout while retaining twenty-five-times zoom and live icon resizing", async () => {
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(index, /map-zoom-indicator|map-zoom-value|map-zoom-detail/);
  assert.doesNotMatch(appSource, /updateZoomIndicator|ZOOM_STAGE_LABELS/);
  assert.match(appSource, /maxZoom:\s*3 \+ Math\.log2\(30\)/);
  assert.match(appSource, /map\.on\("zoom", updateLiveZoomState\)/);
});

test("campaign relief uses one unified z3-z7 tile pyramid per region", () => {
  const reliefSource = functionSource("addReliefTileSet", "addCampaignReliefLayers");
  const campaignReliefSource = functionSource("addCampaignReliefLayers", "addCampaignCoastlineLayer");
  assert.match(appSource, /map\.createPane\("reliefPane"\)/);
  assert.match(campaignReliefSource, /europe-dem-overview\/\{z\}\/\{x\}\/\{y\}\.webp/);
  assert.match(campaignReliefSource, /reliefConfig\?\.regions/);
  assert.match(campaignReliefSource, /tiles:\s*region\.output\.overview/);
  assert.match(reliefSource, /L\.tileLayer/);
  assert.match(reliefSource, /tiles\}\?v=/);
  assert.match(reliefSource, /minZoom:\s*3/);
  assert.match(reliefSource, /maxZoom:\s*Math\.ceil\(3 \+ Math\.log2\(30\)\)/);
  assert.match(reliefSource, /maxNativeZoom:\s*7/);
  assert.match(reliefSource, /keepBuffer:\s*2/);
  assert.match(reliefSource, /updateWhenIdle:\s*false/);
  assert.match(reliefSource, /updateWhenZooming:\s*true/);
  assert.match(reliefSource, /updateInterval:\s*120/);
  assert.match(appSource, /fadeAnimation:\s*false/);
  assert.match(appSource, /reliefLayers\.forEach/);
  assert.match(appSource, /0\.46 \+ progress \* 0\.22/);
  assert.doesNotMatch(appSource, /reliefDetailPane|reliefDetailLayers|detailMix/);
});

test("unified relief keeps one mild filter without a second detail-pane style", async () => {
  const stylesSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(stylesSource, /\.leaflet-relief-pane img\s*\{[^}]*contrast\(1\.02\)[^}]*brightness\(0\.98\)[^}]*saturate\(0\.92\)/s);
  assert.doesNotMatch(stylesSource, /leaflet-reliefDetail-pane/);
});

test("campaign oceans use map-coordinate shallow-water color bands without current lines", () => {
  const oceanSource = functionSource("addCampaignOceanDepthLayer", "updateLandDepthPerspective");
  assert.match(appSource, /map\.createPane\("oceanPane"\)/);
  assert.match(appSource, /const oceanRenderer = L\.canvas\(\{ pane: "oceanPane"/);
  assert.match(oceanSource, /coastlineSegmentsForZoom\(\)/);
  assert.equal((oceanSource.match(/L\.polyline\(segments/g) ?? []).length, 3);
  assert.equal((oceanSource.match(/renderer:\s*oceanRenderer/g) ?? []).length, 3);
  assert.match(oceanSource, /pane:\s*"oceanPane"/);
  assert.match(appSource, /updateOceanDepthStyle\(zoom\)/);
  assert.doesNotMatch(appSource, /europe-ocean-currents|OceanCurrent|imageOverlay/);
  assert.doesNotMatch(indexSource, /europe-ocean-currents/);
  assert.match(serverSource, /createStaticHandler/);
});

test("Europe and relocated South America share consolidated coastline and 2.5D land-depth strokes", () => {
  const collectSource = functionSource("collectCampaignCoastlineSegments", "coastlineSegmentsForZoom");
  const depthSource = functionSource("addCampaignLandDepthLayer", "addCampaignCoastlineLayer");
  const coastlineSource = functionSource("addCampaignCoastlineLayer", "addTerritoryLayer");
  assert.match(appSource, /const coastRenderer = L\.canvas\(\{ pane: "coastPane"/);
  assert.match(appSource, /map\.createPane\("landShadowPane"\)/);
  assert.match(appSource, /map\.createPane\("landShelfPane"\)/);
  assert.match(appSource, /const landShadowRenderer = L\.canvas\(\{ pane: "landShadowPane"/);
  assert.match(appSource, /const landShelfRenderer = L\.canvas\(\{ pane: "landShelfPane"/);
  assert.match(appSource, /buildCoastlineLods\(collectCampaignCoastlineSegments\(territories\)\)/);
  assert.match(collectSource, /\["europe", "south-america"\]\.includes\(region\)/);
  assert.match(collectSource, /territoryPointToDisplay\(point, region\)/);
  assert.match(appSource, /updateCoastlineLod\(zoom\)/);
  assert.match(appSource, /landDepthStrokes\.forEach/);
  assert.match(appSource, /updateLandDepthPerspective\(\)/);
  assert.match(appSource, /translate3d/);
  assert.match(depthSource, /landDepthStrokes = \[/);
  assert.equal((depthSource.match(/L\.polyline\(segments/g) ?? []).length, 2);
  assert.match(coastlineSource, /COASTLINE_STROKE_STYLES\.map/);
  assert.match(coastlineSource, /L\.polyline\(segments/);
  assert.doesNotMatch(coastlineSource, /for \(const segment/);
  assert.doesNotMatch(appSource, /const coastRenderer = L\.svg/);
});

test("province outlines reuse display coordinates in one non-interactive path above terrain", () => {
  const source = functionSource("addProvinceOutlineLayer", "addTerritoryLayer");
  const renderer = {};
  const mapStub = {};
  const calls = [];
  let removals = 0;
  const leaflet = {
    polyline(points, options) {
      calls.push({ points, options });
      return {
        addTo(target) { assert.equal(target, mapStub); return this; },
        removeFrom(target) { assert.equal(target, mapStub); removals += 1; },
      };
    },
  };
  const create = new Function("L", "map", "provinceOutlineRenderer",
    "let provinceOutlineLayer = null; const useThreeMap = true;\n" + source + "\nreturn addProvinceOutlineLayer;");
  const add = create(leaflet, mapStub, renderer);
  const ring = [[20, 7], [21, 7], [20, 8], [20, 7]];
  const data = { features: [
    { geometry: { type: "Polygon", coordinates: [ring] } },
    { geometry: { type: "MultiPolygon", coordinates: [[ring, ring]] } },
  ] };
  const original = JSON.stringify(data);
  add(data);
  add(data);
  assert.equal(calls.length, 2);
  assert.equal(removals, 1);
  assert.equal(calls[0].points.length, 3);
  assert.deepEqual(calls[0].points[0], [[7, 20], [7, 21], [8, 20], [7, 20]]);
  assert.equal(JSON.stringify(data), original);
  assert.equal(calls[0].options.fill, false);
  assert.equal(calls[0].options.interactive, false);
  assert.equal(calls[0].options.renderer, renderer);
  assert.equal(calls[0].options.opacity, 0.09);
  assert.match(appSource, /map\.getPane\("provinceOutlinePane"\)\.style\.zIndex = "219"/);
  assert.match(appSource, /map\.getPane\("provinceOutlinePane"\)\.style\.pointerEvents = "none"/);
  assert.match(appSource, /addProvinceOutlineLayer\(displayTerritories\)/);
});

test("map startup does not wait for every club badge", () => {
  const loadSource = functionSource("loadMap", "startMapLoading");
  assert.doesNotMatch(appSource, /function preloadClubBadge/);
  assert.doesNotMatch(loadSource, /Promise\.allSettled\(clubData\.map/);
  assert.match(appSource, /club-badges\/\$\{escapeHtml\(club\.id\)\}\.webp" alt="" loading="lazy" decoding="async"/);
});
test("expanded buildings and neutral clubs survive smooth animated map zoom", () => {
  // Native CSS zoom transitions cannot animate an independent WebGL camera.
  // Three uses the existing continuous wheel movement; compatibility retains CSS animation.
  assert.match(appSource, /zoomAnimation:\s*!useThreeMap/);
  assert.match(appSource, /markerZoomAnimation:\s*!useThreeMap/);
  assert.match(appSource, /expandedCityId === city\.id/);
  assert.doesNotMatch(appSource, /map\.on\("zoomstart"[\s\S]{0,180}closeExpandedCity/);
  assert.doesNotMatch(appSource, /map\.on\("zoomstart"[\s\S]{0,180}buildingMarkerController\.closeExpanded/);
});

test("wheel zoom uses a cursor-anchored inertial controller instead of Leaflet steps", () => {
  assert.match(appSource, /createInertialWheelZoom\(\{/);
  assert.match(appSource, /scrollWheelZoom:\s*false/);
  assert.match(appSource, /zoomSnap:\s*0/);
  assert.match(inertialWheelSource, /requestFrame\(step\)/);
  assert.match(inertialWheelSource, /centerAroundAnchor/);
  assert.match(inertialWheelSource, /Math\.exp\(-Math\.max\(0\.01, friction\) \* duration\)/);
  assert.match(inertialWheelSource, /const zoomChanged = map\.getZoom\(\) !== startZoom/);
  assert.match(inertialWheelSource, /map\._moveEnd\(zoomChanged\)/);
  assert.match(inertialWheelSource, /if \(zoomChanged\) map\.fire\?\.\("viewreset"\)/);
  assert.doesNotMatch(inertialWheelSource, /map\._animateZoom|map\._resetView/);
  assert.doesNotMatch(inertialWheelSource, /setInterval/);
});

test("maritime surveying supports both button and Escape cancellation", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const cancelSource = functionSource(
    "cancelMaritimeCampaign",
    "nearestCoastPoint",
    maritimeControllerSource,
    "maritime-controller.js",
  );
  assert.match(indexSource, /id="territory-maritime-cancel-button"/);
  assert.match(cancelSource, /clearMaritimeMode\(\)/);
  assert.match(cancelSource, /renderTerritoryInspector\(getSelectedTerritoryId\(\)\)/);
  assert.match(appSource, /territory-maritime-cancel-button.*addEventListener\("click", cancelMaritimeCampaign\)/s);
  assert.match(appSource, /event\.key === "Escape" && cancelMaritimeCampaign\(\)/);
  assert.match(maritimeControllerSource, /maritimeMode\s*!==\s*activeMode/);
});

test("maritime overlays use a dedicated SVG renderer instead of a blocking canvas", () => {
  assert.match(appSource, /const maritimeRenderer = L\.svg\(\{ pane: "maritimePane"/);
  const snapSource = functionSource(
    "updateMaritimeSnap",
    "drawMaritimeRoutes",
    maritimeControllerSource,
    "maritime-controller.js",
  );
  const routesSource = functionSource(
    "drawMaritimeRoutes",
    "confirmMaritimePoint",
    maritimeControllerSource,
    "maritime-controller.js",
  );
  for (const source of [snapSource, routesSource, maritimeControllerSource]) {
    assert.match(source, /renderer:\s*maritimeRenderer/);
    assert.doesNotMatch(source, /pane:\s*"territoryPane"/);
  }
});

test("expedition piece enters owned-territory movement mode with estimate, progress and abort controls", async () => {
  const stylesSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(appSource, /createExpeditionPieceController/);
  assert.match(expeditionPieceSource, /\/api\/campaign\/expedition\/move/);
  assert.match(expeditionPieceSource, /\/api\/campaign\/expedition\/estimate/);
  assert.match(expeditionPieceSource, /\/api\/campaign\/expedition\/cancel/);
  assert.match(expeditionPieceSource, /handleTerritoryClick/);
  assert.match(expeditionPieceSource, /isSelectingDestination/);
  assert.match(indexSource, /id="expedition-movement-widget"/);
  assert.match(indexSource, /id="expedition-move-confirm"/);
  assert.doesNotMatch(indexSource, /id="territory-expedition-button"/);
  assert.match(appSource, /expeditionPane/);
  assert.match(appSource, /getPane\("expeditionPane"\)\.style\.pointerEvents = "none"/);
  assert.match(expeditionPieceSource, /piece\.tokenUrl/);
  assert.match(expeditionPieceSource,/html: `<button[^`]*<img[^`]*<\/button>`/);
  assert.doesNotMatch(stylesSource,/\.expedition-piece-token span/);
  assert.match(stylesSource,/\.campaign-expedition-widget/);
  assert.match(stylesSource,/\.campaign-expedition-progress/);
  assert.match(stylesSource,/\.expedition-piece-map-icon\s*\{[^}]*pointer-events:\s*auto\s*!important/s);
  assert.match(stylesSource,/\.expedition-move-route span\s*\{[^}]*font-size:\s*36px/s);
});

test("expedition piece keeps overview sizes and grows into the merged-territory close-up", () => {
  const overview = expeditionTokenMetrics(3);
  const middle = expeditionTokenMetrics(5.4);
  const regional = expeditionTokenMetrics(5.8);
  const detailed = expeditionTokenMetrics(6.8);
  const maximum = expeditionTokenMetrics(9);
  assert.deepEqual(overview, {iconSize:[15,16],iconAnchor:[8,13]});
  assert.ok(overview.iconSize[0] < middle.iconSize[0]);
  assert.ok(middle.iconSize[0] < regional.iconSize[0]);
  assert.deepEqual(regional, {iconSize:[38,40],iconAnchor:[19,32]});
  assert.ok(regional.iconSize[0] < detailed.iconSize[0]);
  assert.ok(detailed.iconSize[0]>76);
  assert.deepEqual(maximum.iconSize,[125,132]);assert.ok(maximum.iconSize[0]>detailed.iconSize[0]);
  const liveSource = functionSource("updateLiveZoomState", "updateZoomState");
  assert.match(liveSource, /expeditionPieceController\?\.updateZoom\(\)/);
  assert.match(liveSource, /buildingMarkerController\?\.updateVisibility\(\)/);
});

test("primary navigation stays left aligned and the gold wallet stays on the right", async () => {
  const stylesSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  const walletStyle = stylesSource.match(/\.topbar-wallet\s*\{([^}]*)\}/s)?.[1] ?? "";
  assert.match(stylesSource, /\.topbar\s*\{[^}]*display:\s*flex;/s);
  assert.match(stylesSource, /\.primary-nav\s*\{[^}]*justify-content:\s*flex-start;/s);
  assert.match(stylesSource, /\.topbar-identity\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(stylesSource, /\.topbar-wallet\s*\{[^}]*margin-left:\s*auto;/s);
  assert.doesNotMatch(walletStyle, /background|border|box-shadow|border-radius|padding/);
  assert.ok(indexSource.indexOf('class="topbar-wallet"')>indexSource.indexOf('class="primary-nav"'));
  assert.doesNotMatch(indexSource, /wallet-coin|wallet-copy/);
  assert.match(indexSource, /<img class="gold-icon"[^>]*gold-coin\.svg[^>]*><strong id="gold-balance">0<\/strong>/);
  assert.match(indexSource,/id="gold-balance"/);
  const resourceSource = await readFile(new URL("../client/resources/resource-controller.js", import.meta.url), "utf8");
  assert.match(resourceSource,/new Intl\.NumberFormat\(['"]zh-CN['"]\)/);
  assert.match(resourceSource,/state\?\.wallet\?\.gold/);
  assert.match(indexSource, /<div id="topbar-resource-summary"[^>]*>[\s\S]*id="topbar-wallet"[\s\S]*data-resource-slot="production"[\s\S]*data-resource-slot="science"[\s\S]*?<\/button>/);
  assert.match(appSource,/resourceController\.update\(stateValue\)/);
});

test("topbar inventory uses a light small shelf and a full-screen meteor player choice stage", () => {
  assert.ok(indexSource.indexOf('id="topbar-inventory"') < indexSource.indexOf('id="topbar-wallet"'));
  assert.match(indexSource,/<nav[^>]*class="primary-nav"[\s\S]*id="topbar-inventory"[\s\S]*<\/nav>/);
  assert.match(indexSource,/id="inventory-window"[^>]*data-small-window="inventory"/);
  assert.match(appSource,/createInventoryController\(\{/);
  assert.match(inventoryControllerSource,/bindSmallWindow\(windowRoot/);
  assert.match(inventoryControllerSource,/registerStageWindow\(windowRoot,\{kind:"inventory"/);
  assert.match(inventoryControllerSource,/smallShelf \? "small-window__dialog" : "inventory-opening-surface"/);
  assert.match(inventoryControllerSource,/inventory-opening-stage-root/);
  assert.match(inventoryControllerSource,/meteorLayer\(\)/);
  assert.doesNotMatch(inventoryControllerSource,/\.flatMap\(\(pack\) => Array\.from/);
  assert.match(inventoryControllerSource,/inventory-pack-count/);
  assert.match(inventoryControllerSource,/data-select-pack/);
  assert.match(inventoryControllerSource,/inventory-showcase/);
  assert.doesNotMatch(inventoryControllerSource,/classList\.toggle\("standard-window"/);
  assert.match(inventoryControllerSource,/inventory\/packs\/open/);
  assert.match(inventoryControllerSource,/inventory\/packs\/choose/);
  assert.match(inventoryControllerSource,/playerCardMarkup\(card,\{interactive:true,variant:"standard",action:"pack-choice"/);
  assert.match(inventoryControllerSource,/windowRoot\.hidden = true/);
  assert.match(inventoryControllerSource,/data-stage-window-close/);
});

test("active territory challenges are marked and consume server-live snapshots", async () => {
  assert.match(territoryPresentationSource, /world\?\.activeChallenges\?\.\[territoryId\]/);
  assert.match(territoryPresentationSource, /dashArray: activeChallenge \? "8 5" : null/);
  assert.match(territoryPresentationSource, /attackerTeamName[\s\S]*defenderName/);
  assert.match(challengeControllerSource, /territory\/challenge\?id=/);
  assert.match(appSource, /startCampaignStatePolling\(\)/);
  assert.match(broadcastSource, /CAMPAIGN_LIVE_POLL_MS = 1000/);
  assert.doesNotMatch(broadcastSource, /eventCount\+1/);
  assert.match(serverSource, /createChallengeScheduler\(\{ campaign \}\)/);
  assert.match(schedulerSource, /maximumMatches: 1, maximumChainsPerMatch: 1/);
  assert.match(schedulerSource, /Math\.max\(100, Math\.min\(2000/);
  assert.match(appSource, /resumeOwnActiveChallenge\(\)/);
  assert.match(appSource, /ownActiveChallenge\(\)/);
  assert.match(broadcastSource, /pendingLegReset/);
  assert.match(broadcastSource, /nextKey!==state\.liveKey/);
});

test("result dialog keeps the aggregate score and shows neutral conquest rewards", () => {
  const resultSource=functionSource(
    "renderBattleResult",
    "startCampaignLiveController",
    challengeControllerSource,
    "challenge-controller.js",
  );
  assert.doesNotMatch(indexSource,/battle-result-(stats|events)/);
  assert.doesNotMatch(resultSource,/shotsOnTarget|notableEvents|battle-result-stats|battle-result-events/);
  assert.match(resultSource,/battle-score/);
  assert.match(indexSource,/battle-result-(gold|pack)-reward/);
  assert.match(resultSource,/battle\.rewards/);
});


test("live token resizing updates dimensions and foot anchor without replacing its image node",()=>{
  let zoom=3;
  const values=new Map(),token={style:{setProperty:(key,value)=>values.set(key,value)}};
  const element={style:{transform:"translate3d(100px,200px,0)"},querySelector:()=>token};
  const marker={options:{icon:{options:{}}},getElement:()=>element,setIcon(){assert.fail("Live zoom must preserve the token node");}};
  const source=functionSource("updateZoom","renderMovementWidget",expeditionPieceSource);
  const update=new Function("marker","map","getCampaignState","expeditionTokenMetrics","getDisplayMetrics",source+";return updateZoom;")(
    marker,{getZoom:()=>zoom},()=>({expeditionPiece:{}}),expeditionTokenMetrics,(_piece,fallback)=>fallback);
  update();
  assert.equal(element.style.width,"15px");assert.equal(element.style.marginLeft,"-8px");assert.equal(element.style.marginTop,"-13px");
  assert.equal(values.get("--expedition-piece-scale"),"0.2");
  zoom=5.8;update();
  assert.equal(element.style.width,"38px");assert.equal(element.style.marginTop,"-32px");
  assert.equal(values.get("--expedition-piece-scale"),"0.5");
  zoom=6.8;update();
  const detailed=expeditionTokenMetrics(zoom);
  assert.equal(element.style.width,detailed.iconSize[0]+"px");assert.equal(element.style.marginTop,-detailed.iconAnchor[1]+"px");
  assert.deepEqual(marker.options.icon.options,detailed);
  assert.equal(element.style.transform,"translate3d(100px,200px,0)");
});


test("compatibility relief keeps native z7 tiles visible across the 30x cap and rounding boundary",async()=>{
  const source=functionSource("addReliefTileSet","addCampaignReliefLayers");let options;
  const L={tileLayer:(url,value)=>{options=value;return{addTo:()=>({url})};}};
  const add=Function("L","map","return ("+source+");")(L,{});
  add({tiles:"tiles/{z}/{x}/{y}.webp",bounds:{south:0,west:0,north:1,east:1}},"test");
  const vendor=await readFile(new URL("../assets/vendor/leaflet.js",import.meta.url),"utf8");
  const start=vendor.indexOf("_setView:function("),end=vendor.indexOf(",_setZoomTransforms:",start);
  assert.ok(start>=0&&end>start);
  const setView=Function("return "+vendor.slice(start+"_setView:".length,end))();
  let updated=0;
  const layer={options,_clampZoom:zoom=>Math.min(zoom,options.maxNativeZoom),_updateLevels(){},_resetGrid(){},
    _update(){updated++;},_pruneTiles(){},_setZoomTransforms(){}};
  for(const magnification of [20,22.7,25,29.9,30]) {
    setView.call(layer,null,3+Math.log2(magnification));assert.equal(layer._tileZoom,7);
  }
  assert.equal(updated,5, "Maximum magnification must still schedule native relief tiles");
});


test("startup zoom tolerates pending city markers and applies fog once markers arrive", () => {
  const cities=[{id:"known",lat:40,lng:0,tier:1},{id:"hidden",lat:40,lng:2,tier:1}];
  const markers=new Map(),active=new Set();let checks=0,allow=true;
  const layer={
    hasLayer(marker){
      // Leaflet stamp() uses the in operator, which throws for undefined.
      if (!("_leaflet_id" in marker)) marker._leaflet_id=++checks;
      return active.has(marker);
    },
    removeLayer(marker){active.delete(marker);},
  };
  const run=new Function("map","cityData","cityMarkers","clubsByCity","campaignFogController","expandedCityId","cityLayer",
    functionSource("updateCityVisibility","setObjective")+"\nreturn updateCityVisibility;")(
      {getZoom:()=>6},cities,markers,new Map(),{isPointVisible:([_lat,lng])=>allow&&lng===0},null,layer);
  assert.doesNotThrow(run);assert.equal(checks,0);
  const makeMarker=()=>({addTo(target){assert.equal(target,layer);active.add(this);return this;}});
  const known=makeMarker();markers.set("known",known);
  assert.doesNotThrow(run);assert.deepEqual([...active],[known]);
  const hidden=makeMarker();markers.set("hidden",hidden);run();
  assert.deepEqual([...active],[known]);
  allow=false;run();assert.equal(active.size,0);
  allow=true;run();assert.deepEqual([...active],[known]);
});
