import assert from "node:assert/strict";
import test from "node:test";
import { createChallengeController } from "../client/challenge/challenge-controller.js";

function createElements() {
  return new Map([
    ["#battle-result-panel", { hidden: true }],
    ["#battle-result-territory", { textContent: "" }],
    ["#battle-result-outcome", { textContent: "" }],
    ["#battle-home-name", { textContent: "" }],
    ["#battle-away-name", { textContent: "" }],
    ["#battle-score", { textContent: "" }],
  ]);
}

test("challenge controller blocks concurrent attacks and renders compact aggregate results", async () => {
  const elements = createElements();
  const toasts = [];
  let requestCount = 0;
  const controller = createChallengeController({
    documentRef: { querySelector: (selector) => elements.get(selector) },
    territoryMetadataById: new Map([["target", { name: "测试板块" }]]),
    attackableTerritoryIds: new Set(["target"]),
    getCampaignRequest: () => async () => { requestCount += 1; },
    getCampaignState: () => ({ playerId: "player-1", world: { activeChallenges: {} } }),
    getSelectedTerritoryId: () => "target",
    ownActiveChallenge: () => ({ id: "existing" }),
    maritimeController: {
      getMode: () => null,
      getRouteTo: () => null,
      clearMaritimeMode() {},
    },
    campaignStore: {},
    applyCampaignWorldSnapshot() {},
    refreshTerritoryDisplay() {},
    renderTerritoryInspector() {},
    syncCampaignWorldState() {},
    startCampaignBroadcastBackground() {},
    showCampaignBroadcast() {},
    showToast: (message) => toasts.push(message),
  });

  await controller.challengeSelectedTerritory();
  assert.equal(requestCount, 0);
  assert.equal(controller.isPending(), false);
  assert.match(toasts[0], /已有一场板块挑战/);

  controller.renderBattleResult({
    territoryId: "target",
    outcome: "win",
    captured: true,
    teams: [{ name: "我方" }, { name: "守军" }],
    aggregateScore: [3, 2],
  });
  assert.equal(elements.get("#battle-result-panel").hidden, false);
  assert.equal(elements.get("#battle-result-territory").textContent, "测试板块");
  assert.equal(elements.get("#battle-result-outcome").textContent, "两回合胜利 · 地块已占领");
  assert.equal(elements.get("#battle-score").textContent, "3 : 2");
});
