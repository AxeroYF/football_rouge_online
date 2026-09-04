export function createTerritoryPresentation({
  ownerTypes,
  escapeHtml,
  getContext,
}) {
  if (!ownerTypes || typeof escapeHtml !== "function" || typeof getContext !== "function") {
    throw new Error("Territory presentation dependencies are required");
  }

  function context() {
    return getContext() ?? {};
  }

  function territoryOwnerLabel(metadata, state) {
    const { campaignWorldPlayers = {} } = context();
    if (state.ownerType === ownerTypes.PLAYER) {
      const player = campaignWorldPlayers[state.ownerId];
      return (player?.teamName ?? player?.nickname ?? "玩家势力") + (state.capitalOf ? " · 主场" : "");
    }
    if (state.ownerType === ownerTypes.CLUB) return metadata.initialOwner.name || "豪门中立势力";
    return "无主中立地区";
  }

  function challengePhaseLabel(challenge) {
    return {
      "first-leg": "第一回合进行中",
      intermission: "回合间整备",
      "second-leg": "第二回合进行中",
    }[challenge?.phase] ?? "争夺进行中";
  }

  function challengeSummary(challenge) {
    return `${challengePhaseLabel(challenge)} · ${challenge?.maritime ? "跨海挑战" : "陆地挑战"}`;
  }

  function territoryStyle(feature) {
    const {
      territoryWorld,
      campaignState,
      campaignWorldPlayers = {},
      selectedTerritoryId,
      homeSelectionMode,
      homeSelectionPermission,
      maritimeTargetIds = new Set(),
      expeditionMoveTargetIds = new Set(),
    } = context();
    const territoryId = feature.properties.territoryId;
    const state = territoryWorld?.territories[territoryId];
    const selected = territoryId === selectedTerritoryId;
    const activeChallenge = campaignState?.world?.activeChallenges?.[territoryId] ?? null;
    let fillColor = "#31473b";
    let fillOpacity = 0.96;
    let color = "rgba(225, 217, 192, 0.2)";
    let weight = 0.55;

    if (state?.ownerType === ownerTypes.CLUB) {
      fillColor = "#6f603a";
      fillOpacity = 0.96;
      color = "rgba(234, 190, 89, 0.72)";
      weight = 0.8;
    } else if (state?.ownerType === ownerTypes.PLAYER) {
      const player = campaignWorldPlayers[state.ownerId];
      fillColor = player?.color ?? "#41694d";
      fillOpacity = 0.96;
      color = state.capitalOf ? "#f1eddf" : "rgba(241, 237, 223, 0.62)";
      weight = state.capitalOf ? 2.2 : 1.1;
    }
    if (homeSelectionMode && state?.ownerType === ownerTypes.NEUTRAL) {
      const permission = homeSelectionPermission(territoryId);
      color = permission.allowed ? "rgba(104, 169, 123, 0.86)" : "rgba(225, 217, 192, 0.12)";
      weight = permission.allowed ? 1.15 : 0.45;
      fillOpacity = permission.allowed ? 0.96 : 0.78;
    }
    if (selected) {
      fillOpacity = Math.max(fillOpacity, 0.24);
      color = "#f1eddf";
      weight = 2.2;
    }
    if (maritimeTargetIds.has(territoryId) && !selected) {
      color = "#71d9d0";
      weight = 1.8;
    }
    if (expeditionMoveTargetIds.has(territoryId) && !selected) {
      color = "#f1cb62";
      weight = Math.max(weight,2.4);
      fillOpacity = Math.max(fillOpacity,.96);
    }
    if (activeChallenge) {
      color = "#f0c75e";
      weight = Math.max(weight, 3);
      fillOpacity = Math.max(fillOpacity, 0.9);
    }
    return {
      pane: "territoryPane",
      fillColor,
      fillOpacity,
      color,
      weight,
      dashArray: activeChallenge ? "8 5" : null,
    };
  }

  function territoryHoverStyle(feature) {
    const baseStyle = territoryStyle(feature);
    return {
      ...baseStyle,
      fillOpacity: Math.max(baseStyle.fillOpacity, feature.properties.clubCount ? 0.38 : 0.18),
      color: "#f1eddf",
      weight: Math.max(baseStyle.weight, 1.5),
    };
  }

  function territoryTooltipMarkup(metadata, state) {
    const { campaignState } = context();
    const challenge = campaignState?.world?.activeChallenges?.[metadata.territoryId] ?? null;
    const weather = campaignState?.world?.weather?.territories?.[metadata.territoryId] ?? null;
    return "<span>" + escapeHtml(metadata.country) + "</span>"
      + "<strong>" + escapeHtml(metadata.name) + "</strong>"
      + "<small>" + escapeHtml(territoryOwnerLabel(metadata, state)) + "</small>"
      + (weather ? "<small class=\"territory-tooltip-weather\"><i aria-hidden=\"true\">" + escapeHtml(weather.icon)
        + "</i><b>" + escapeHtml(weather.label) + "</b><u>本小时天气</u></small>" : "")
      + (challenge ? "<em><b>⚔ " + escapeHtml(challengeSummary(challenge)) + "</b>"
        + escapeHtml(challenge.attackerTeamName) + " 正在挑战 " + escapeHtml(challenge.defenderName) + "</em>" : "");
  }

  return Object.freeze({
    challengePhaseLabel,
    challengeSummary,
    territoryHoverStyle,
    territoryOwnerLabel,
    territoryStyle,
    territoryTooltipMarkup,
  });
}
