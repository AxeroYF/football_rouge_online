import assert from "node:assert/strict";
import test from "node:test";
import { createTerritoryController } from "../client/territory/territory-controller.js";
import { OWNER_TYPES } from "../territory-model.js";

function createController({ metadata, territories }) {
  return createTerritoryController({
    documentRef: {},
    mapElement: {},
    ownerTypes: OWNER_TYPES,
    territoryMetadataById: new Map(metadata.map((entry) => [entry.territoryId, entry])),
    territoryLayersById: new Map(),
    attackableTerritoryIds: new Set(),
    getTerritoryWorld: () => ({ territories }),
    getCampaignState: () => ({}),
    getCityData: () => [],
    getClubData: () => [],
    getCampaignRequest: () => null,
    getMaritimeMode: () => null,
    getMaritimeTargetIds: () => new Set(),
    getTerritoryChallengePending: () => false,
    campaignStore: {},
    applyCampaignWorldSnapshot() {},
    territoryStyle() {},
    territoryTooltipMarkup() {},
    territoryOwnerLabel() {},
    challengeSummary() {},
    ownActiveChallenge: () => null,
    showToast() {},
  });
}

test("territory controller owns home selection permission rules", () => {
  const baseMetadata = {
    playable: true,
    spawnAllowed: true,
    landNeighbors: [],
    initialOwner: { type: "neutral" },
  };
  const controller = createController({
    metadata: [
      { ...baseMetadata, territoryId: "open" },
      { ...baseMetadata, territoryId: "occupied" },
      { ...baseMetadata, territoryId: "club", playable: false },
      { ...baseMetadata, territoryId: "adjacent", landNeighbors: ["club"] },
    ],
    territories: {
      open: { ownerType: OWNER_TYPES.NEUTRAL },
      occupied: { ownerType: OWNER_TYPES.PLAYER, ownerId: "other-player" },
      club: { ownerType: OWNER_TYPES.CLUB },
      adjacent: { ownerType: OWNER_TYPES.NEUTRAL },
    },
  });

  assert.deepEqual(controller.homeSelectionPermission("open"), {
    allowed: true,
    reason: "可以在这里建立永久主场",
  });
  assert.equal(controller.homeSelectionPermission("occupied").allowed, false);
  assert.equal(controller.homeSelectionPermission("club").reason, "豪门中立区域不能作为主场");
  assert.match(controller.homeSelectionPermission("adjacent").reason, /直接接壤/);
  assert.equal(controller.homeSelectionPermission("missing").reason, "无法读取该地块");
});
