import assert from "node:assert/strict";
import test from "node:test";
import { createMaritimeController } from "../client/maritime/maritime-controller.js";

function removableLayer() {
  return {
    addTo() { return this; },
    remove() { this.removed = true; },
  };
}

test("maritime controller owns surveying state and clears all overlays on cancel", () => {
  const classes = new Set();
  const toasts = [];
  const rendered = [];
  let refreshCount = 0;
  const Leaflet = {
    layerGroup: removableLayer,
    polyline: removableLayer,
    circleMarker: () => ({
      ...removableLayer(),
      on() { return this; },
      bindTooltip() { return this; },
      setLatLng() {},
      setStyle() {},
    }),
  };
  const controller = createMaritimeController({
    Leaflet,
    map: {},
    mapElement: {
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      },
    },
    maritimeRenderer: {},
    territoryMetadataById: new Map(),
    getCoastlineData: () => ({
      territories: {
        coast: { coastlines: [[[0, 0], [1, 1]]] },
      },
    }),
    getTerritoryWorld: () => ({
      territories: {
        coast: { ownerType: "player", ownerId: "player-1" },
      },
    }),
    getCampaignState: () => ({
      playerId: "player-1",
      coastalTerritoryIds: ["coast"],
    }),
    getCampaignRequest: () => null,
    getSelectedTerritoryId: () => "coast",
    ownActiveChallenge: () => null,
    sourcePointToDisplay: (_territoryId, point) => point,
    displayPointToSource: () => [0, 0],
    selectTerritory() {},
    refreshTerritoryDisplay: () => { refreshCount += 1; },
    renderTerritoryInspector: (territoryId) => rendered.push(territoryId),
    showToast: (message) => toasts.push(message),
  });

  assert.equal(controller.getMode(), null);
  controller.beginMaritimeCampaign();
  assert.equal(controller.getMode().sourceTerritoryId, "coast");
  assert.equal(controller.isSelectingPoint(), true);
  assert.equal(classes.has("is-selecting-coast"), true);
  assert.equal(controller.cancelMaritimeCampaign(), true);
  assert.equal(controller.getMode(), null);
  assert.equal(controller.getTargetIds().size, 0);
  assert.equal(classes.has("is-selecting-coast"), false);
  assert.equal(refreshCount, 1);
  assert.deepEqual(rendered, ["coast", "coast"]);
  assert.match(toasts.at(-1), /已取消/);
  assert.equal(controller.cancelMaritimeCampaign(), false);
});
