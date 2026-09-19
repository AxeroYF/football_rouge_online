export const FOG_RULES = Object.freeze({
  schemaVersion: 2,
  sightRings: 1, // Compatibility for worlds without geometry.
  radius: 9,
  feather: 1.2,
  previewRadius: 5.6,
  previewLifetime: 90000,
  baseMinZoom: 3,
  maxZoom: 3 + Math.log2(30),
  zoomRoom: 0.75,
  boundsPadding: 0.3,
  unexploredColor: "#23343b",
  exploredOpacity: 0.62,
});

// Fail closed while an older server is being restarted: only owned land is
// known. Never turn the pre-home full-world preview into exploration history.
export function campaignFog(state) {
  if (state?.fog) return state.fog;
  const owned = Object.entries(state?.world?.territories ?? {})
    .filter(([, entry]) => entry.ownerType === "player" && entry.ownerId === state?.playerId)
    .map(([id]) => id);
  return { enabled: Boolean(state?.homeTerritoryId), visibleTerritoryIds: owned,
    exploredTerritoryIds: owned, metPlayerIds: [], pending: Boolean(state?.homeTerritoryId) };
}

export function fogTerritoryStatus(fog, territoryId) {
  if (!fog?.enabled || fog.visibleTerritoryIds?.includes(territoryId)) return "visible";
  return fog.exploredTerritoryIds?.includes(territoryId) ? "explored" : "unexplored";
}

export function fogMinimumZoom(fitZoom, rules = FOG_RULES) {
  const finiteZoom = Number.isFinite(fitZoom) ? fitZoom : rules.baseMinZoom;
  return Math.max(rules.baseMinZoom, Math.min(rules.maxZoom - rules.zoomRoom, finiteZoom));
}


export function withoutNavalPreview(state) {
  if(!state?.fog?.preview)return state;
  const fog=state.fog,visible=fog.baseVisibleTerritoryIds??fog.visibleTerritoryIds.filter(id=>!fog.navalVisibleTerritoryIds?.includes(id));
  const ids=new Set(visible);
  return {...state,fog:{...fog,preview:null,visibleTerritoryIds:visible,navalVisibleTerritoryIds:[]},
    world:state.world?{...state.world,units:[],territories:Object.fromEntries(Object.entries(state.world.territories??{}).filter(([id])=>ids.has(id))),
      weather:state.world.weather?{...state.world.weather,territories:Object.fromEntries(Object.entries(state.world.weather.territories??{}).filter(([id])=>ids.has(id)))}:state.world.weather,
      activeChallenges:Object.fromEntries(Object.entries(state.world.activeChallenges??{}).filter(([id,challenge])=>ids.has(id)||challenge.attackerId===state.playerId||challenge.defenderId===state.playerId))}:state.world,
    coastalTerritoryIds:state.coastalTerritoryIds?.filter(id=>ids.has(id)),attackableTerritoryIds:state.attackableTerritoryIds?.filter(id=>ids.has(id))};
}
