// A player-scoped snapshot is authoritative, including ABSENCE. Merging it
// into the previous global preview would retain hidden owners and buildings.
export function applyFogWorldSnapshot(world, snapshot, territoryIndex, fog) {
  if (!world || !territoryIndex) return;
  const visible = new Set(fog?.visibleTerritoryIds ?? []);
  for (const metadata of territoryIndex.territories) {
    const id = metadata.territoryId;
    const value = snapshot?.territories?.[id];
    const hidden = fog?.enabled && (!visible.has(id) || !value);
    const initial = metadata.initialOwner ?? { type: "neutral", id: null };
    world.territories[id] = {
      territoryId: id, ownerType: hidden ? "unknown" : initial.type,
      ownerId: hidden ? null : initial.id, capitalOf: null, buildings: [], protectedUntil: null, version: 0,
      ...(!hidden ? value : {}),
    };
  }
}
