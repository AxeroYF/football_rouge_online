import assert from "node:assert/strict";
import test from "node:test";
import {
  displayPointToTerritory,
  isEuropeanFeature,
  isSouthAmericanFeature,
  territoryPointToDisplay,
  transformSouthAmericaFeature,
  transformSouthAmericaPoint,
} from "../client/map/campaign-map-geometry.js";
import { loadCampaignMapData } from "../client/map/campaign-map-data.js";
import { createTerritoryPresentation } from "../client/map/territory-presentation.js";
import { OWNER_TYPES } from "../territory-model.js";

test("campaign map geometry keeps Europe and relocates South America consistently", () => {
  assert.equal(isEuropeanFeature({ properties: { CONTINENT: "Europe", ADM0_A3: "FRA" } }), true);
  assert.equal(isEuropeanFeature({ properties: { CONTINENT: "Europe", ADM0_A3: "RUS" } }), false);
  assert.equal(isEuropeanFeature({ properties: { CONTINENT: "Asia", ADM0_A3: "TUR" } }), true);
  assert.equal(isSouthAmericanFeature({ properties: { CONTINENT: "South America" } }), true);

  const sourcePoint = [-57.5, -21.5];
  assert.deepEqual(transformSouthAmericaPoint(sourcePoint[1], sourcePoint[0]), [7, 20]);
  const displayPoint = territoryPointToDisplay(sourcePoint, "south-america");
  assert.deepEqual(displayPoint, [7, 20]);
  assert.deepEqual(displayPointToTerritory({ lat: displayPoint[0], lng: displayPoint[1] }, "south-america"), sourcePoint);
  assert.deepEqual(territoryPointToDisplay([12, 52], "europe"), [52, 12]);
});

test("campaign map geometry transforms labels and nested feature coordinates without mutation", () => {
  const feature = {
    type: "Feature",
    properties: { CONTINENT: "South America", LABEL_X: -57.5, LABEL_Y: -21.5 },
    geometry: { type: "Polygon", coordinates: [[[-57.5, -21.5], [-56.5, -21.5], [-57.5, -20.5]]] },
  };
  const transformed = transformSouthAmericaFeature(feature);

  assert.notEqual(transformed, feature);
  assert.equal(transformed.properties.LABEL_Y, 7);
  assert.equal(transformed.properties.LABEL_X, 20);
  assert.equal(transformed.properties.MIN_LABEL, 3.2);
  assert.deepEqual(transformed.geometry.coordinates[0][0], [20, 7]);
  assert.deepEqual(feature.geometry.coordinates[0][0], [-57.5, -21.5]);
});

test("territory presentation derives player ownership, selection and challenge state", () => {
  const context = {
    territoryWorld: {
      territories: {
        target: { ownerType: OWNER_TYPES.PLAYER, ownerId: "player-1", capitalOf: "player-1" },
      },
    },
    campaignState: {
      world: {
        weather: {
          territories: {
            target: { type:"storm", label:"雷暴", icon:"⛈", precipitation:82 },
          },
        },
        activeChallenges: {
          target: {
            phase: "second-leg",
            maritime: true,
            attackerTeamName: "进攻方",
            defenderName: "防守方",
          },
        },
      },
    },
    campaignWorldPlayers: {
      "player-1": { teamName: "测试球队", color: "#123456" },
    },
    selectedTerritoryId: null,
    homeSelectionMode: false,
    homeSelectionPermission: () => ({ allowed: false }),
    maritimeTargetIds: new Set(),
  };
  const presentation = createTerritoryPresentation({
    ownerTypes: OWNER_TYPES,
    escapeHtml: (value) => String(value),
    getContext: () => context,
  });
  const metadata = {
    territoryId: "target",
    country: "测试国",
    name: "测试省",
    initialOwner: { name: "" },
  };
  const state = context.territoryWorld.territories.target;
  const style = presentation.territoryStyle({ properties: { territoryId: "target" } });

  assert.equal(style.fillColor, "#123456");
  assert.equal(style.color, "#f0c75e");
  assert.equal(style.weight, 3);
  assert.equal(style.dashArray, "8 5");
  assert.equal(presentation.territoryOwnerLabel(metadata, state), "测试球队 · 主场");
  assert.equal(presentation.challengeSummary(context.campaignState.world.activeChallenges.target), "第二回合进行中 · 跨海挑战");
  assert.match(presentation.territoryTooltipMarkup(metadata, state), /进攻方 正在挑战 防守方/);
  assert.match(presentation.territoryTooltipMarkup(metadata, state), /⛈.*雷暴.*本小时天气/);
});

test("campaign map data loader fetches and combines the eight versioned assets", async () => {
  const requests = [];
  const payloads = [
    { features: ["countries"] },
    [{ id: "europe-city" }],
    [{ id: "south-america-city" }],
    [{ id: "club" }],
    { features: ["territories"] },
    { territories: ["index"] },
    { coastlines: ["coast"] },
    { regions: { svalbard: {} } },
  ];
  const data = await loadCampaignMapData({
    version: "test-version",
    fetchImpl: async (url, options) => {
      const payload = payloads[requests.length];
      requests.push({ url, options });
      return { ok: true, json: async () => payload };
    },
  });

  assert.equal(requests.length, 8);
  assert.ok(requests.every(({ url }) => url.endsWith("?v=test-version")));
  assert.ok(requests.every(({ options }) => options.cache === "no-cache"));
  assert.deepEqual(data.cities.map((city) => city.id), ["europe-city", "south-america-city"]);
  assert.equal(data.clubs[0].id, "club");
  assert.deepEqual(data.territoryIndex.territories, ["index"]);
  assert.deepEqual(data.reliefRegions.regions, { svalbard: {} });
});

test("campaign map data loader rejects the whole map when an asset is unavailable", async () => {
  let requestIndex = 0;
  await assert.rejects(
    loadCampaignMapData({
      fetchImpl: async () => ({
        ok: requestIndex++ !== 3,
        json: async () => ({}),
      }),
    }),
    /map data unavailable/,
  );
});
