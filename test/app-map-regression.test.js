import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OWNER_TYPES } from "../territory-model.js";
import { createTerritoryPresentation } from "../client/map/territory-presentation.js";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const territoryPresentationSource = await readFile(new URL("../client/map/territory-presentation.js", import.meta.url), "utf8");
const maritimeControllerSource = await readFile(new URL("../client/maritime/maritime-controller.js", import.meta.url), "utf8");
const challengeControllerSource = await readFile(new URL("../client/challenge/challenge-controller.js", import.meta.url), "utf8");
const broadcastSource = await readFile(new URL("../campaign-broadcast.js", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const schedulerSource = await readFile(new URL("../server/scheduler/challenge-scheduler.mjs", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const inertialWheelSource = await readFile(new URL("../client/map/inertial-wheel-zoom.js", import.meta.url), "utf8");

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

test("map layer defaults keep borders and weather overlay off while major cities stay on", async () => {
  const indexSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(appSource, /let countryBordersVisible = false;/);
  assert.match(appSource, /let majorCitiesVisible = true;/);
  assert.match(appSource, /let weatherLayerVisible = false;/);
  assert.match(indexSource, /id="country-borders-toggle" type="checkbox" \/>/);
  assert.match(indexSource, /id="major-cities-toggle" type="checkbox" checked \/>/);
  assert.match(indexSource, /id="weather-layer-toggle" type="checkbox" \/>/);
  assert.match(appSource, /weatherLayerController\?\.setEnabled\(weatherLayerVisible\)/);
});

test("expanded buildings and neutral clubs survive smooth animated map zoom", () => {
  assert.match(appSource, /zoomAnimation:\s*true/);
  assert.match(appSource, /markerZoomAnimation:\s*true/);
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
  assert.match(inertialWheelSource, /map\._moveEnd\(map\.getZoom\(\) !== startZoom\)/);
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
  assert.match(indexSource, /<span>\u91d1\u5e01<\/span><strong id="gold-balance">0<\/strong>/);
  assert.match(indexSource,/id="gold-balance"/);
  assert.match(appSource,/new Intl\.NumberFormat\("zh-CN"\)/);
  assert.match(appSource,/stateValue\?\.wallet\?\.gold/);
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

test("result dialog keeps only outcome and aggregate score", () => {
  const resultSource=functionSource(
    "renderBattleResult",
    "startCampaignLiveController",
    challengeControllerSource,
    "challenge-controller.js",
  );
  assert.doesNotMatch(indexSource,/battle-result-(stats|events)/);
  assert.doesNotMatch(resultSource,/shotsOnTarget|notableEvents|battle-result-stats|battle-result-events/);
  assert.match(resultSource,/battle-score/);
});
