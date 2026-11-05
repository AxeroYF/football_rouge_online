// A display-only predicate. Ownership, family identity and squad locks stay in
// each domain controller; filtering never decides which cards can be submitted.
export function createPlayerFilter(filters = {}, {includeSourceName = true} = {}) {
  const search = String(filters.search ?? '').toLowerCase();
  const {position, club, nationality, min, upgrade} = filters;
  return player => {
    const text = [player.name, ...(includeSourceName ? [player.sourceName] : []), player.club, player.nationality].map(value => value ?? '').join(' ').toLowerCase();
    return (!search || text.includes(search))
      && (!position || player.role === position || player.secondaryRole === position)
      && (!club || player.club === club)
      && (!nationality || player.nationality === nationality)
      && (!min || Number(player.effectiveOverall ?? player.overall) >= Number(min))
      && (upgrade == null || upgrade === '' || Number(player.upgradeLevel ?? 0) === Number(upgrade));
  };
}
