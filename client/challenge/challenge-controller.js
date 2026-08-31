export function createChallengeController({
  documentRef = globalThis.document,
  territoryMetadataById,
  attackableTerritoryIds,
  getCampaignRequest,
  getCampaignState,
  getSelectedTerritoryId,
  ownActiveChallenge,
  maritimeController,
  campaignStore,
  applyCampaignWorldSnapshot,
  refreshTerritoryDisplay,
  renderTerritoryInspector,
  syncCampaignWorldState,
  startCampaignBroadcastBackground,
  showCampaignBroadcast,
  showToast,
}) {
  let territoryChallengePending = false;
  let activeCampaignMatch = null;
  let campaignLiveResumePending = false;

  function renderBattleResult(battle) {
    const panel = documentRef.querySelector("#battle-result-panel");
    const [home, away] = battle.teams ?? [];
    const outcomeText = battle.outcome === "win"
      ? battle.captured ? "两回合胜利 · 地块已占领" : "胜利"
      : "两回合失利 · 归属不变";
    documentRef.querySelector("#battle-result-territory").textContent = (
      territoryMetadataById.get(battle.territoryId)?.name ?? "地块争夺赛"
    );
    documentRef.querySelector("#battle-result-outcome").textContent = outcomeText;
    documentRef.querySelector("#battle-home-name").textContent = home?.name ?? "我方球队";
    documentRef.querySelector("#battle-away-name").textContent = away?.name ?? "地块守军";
    documentRef.querySelector("#battle-score").textContent = (
      `${battle.aggregateScore?.[0] ?? battle.score?.[0] ?? 0} : `
      + `${battle.aggregateScore?.[1] ?? battle.score?.[1] ?? 0}`
    );
    panel.hidden = false;
  }

  function startCampaignLiveController(value) {
    activeCampaignMatch?.stop?.();
    activeCampaignMatch = startCampaignBroadcastBackground(value, {
      fetchSnapshot: () => getCampaignRequest()(
        "/api/campaign/territory/challenge?id=" + encodeURIComponent(value.challenge.id),
      ),
      onOpen: (matchState) => showCampaignBroadcast(matchState, {
        onClose: () => { matchState.opened = false; },
      }),
      onFinish: async (snapshot) => {
        try {
          await syncCampaignWorldState();
          renderBattleResult(snapshot.battle);
        } catch (error) {
          showToast(error.message || "比赛结束，但领地状态刷新失败，请刷新页面");
        } finally {
          activeCampaignMatch = null;
        }
      },
    });
    return activeCampaignMatch;
  }

  async function resumeOwnActiveChallenge() {
    const campaignRequest = getCampaignRequest();
    if (activeCampaignMatch || campaignLiveResumePending || !campaignRequest) return;
    const campaignState = getCampaignState();
    const challenge = Object.values(campaignState?.world?.activeChallenges ?? {})
      .find((entry) => entry.attackerId === campaignState?.playerId);
    if (!challenge) return;
    campaignLiveResumePending = true;
    try {
      const value = await campaignRequest(
        "/api/campaign/territory/challenge?id=" + encodeURIComponent(challenge.id),
      );
      if (!value.completed) startCampaignLiveController(value);
    } catch {
      // The next world poll retries if the match still exists.
    } finally {
      campaignLiveResumePending = false;
    }
  }

  async function challengeSelectedTerritory() {
    if (ownActiveChallenge()) {
      showToast("已有一场板块挑战正在进行，比赛结束前不能发起新挑战");
      return;
    }
    const selectedTerritoryId = getSelectedTerritoryId();
    const maritimeMode = maritimeController.getMode();
    const maritimeRoute = maritimeController.getRouteTo(selectedTerritoryId);
    const campaignState = getCampaignState();
    const activeChallenge = campaignState?.world?.activeChallenges?.[selectedTerritoryId];
    if (
      !selectedTerritoryId
      || activeChallenge
      || territoryChallengePending
      || (!attackableTerritoryIds.has(selectedTerritoryId) && !maritimeRoute)
    ) return;
    territoryChallengePending = true;
    renderTerritoryInspector(selectedTerritoryId);
    try {
      const value = await getCampaignRequest()("/api/campaign/territory/challenge", {
        method: "POST",
        body: {
          territoryId: selectedTerritoryId,
          ...(maritimeRoute ? {
            maritimeRoute: {
              sourceTerritoryId: maritimeMode.sourceTerritoryId,
              sourcePoint: maritimeMode.sourcePoint,
            },
          } : {}),
        },
      });
      campaignStore.setState(value.state, { source: "challenge-start" });
      applyCampaignWorldSnapshot(getCampaignState().world);
      refreshTerritoryDisplay();
      renderTerritoryInspector(selectedTerritoryId);
      if (maritimeRoute) maritimeController.clearMaritimeMode({ keepSelection: true });
      startCampaignLiveController(value);
      showToast("挑战已锁定该板块；服务器将按 S4 节奏实时推进，赛果只在结束后生成");
    } catch (error) {
      showToast(error.message || "地块争夺赛启动失败");
    } finally {
      territoryChallengePending = false;
      renderTerritoryInspector(selectedTerritoryId);
    }
  }

  return Object.freeze({
    challengeSelectedTerritory,
    isPending: () => territoryChallengePending,
    renderBattleResult,
    resumeOwnActiveChallenge,
    startCampaignLiveController,
  });
}
