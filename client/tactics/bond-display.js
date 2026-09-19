import { applyS4BondBonuses, evaluateS4LineupBonds } from '../../engine/s4-v2.1/versus/public/bond-rules.js';
import { playerOverallFromAttributes } from '../../engine/s4-v2.1/game/public/schema.js';
import { offlineAttributeMaximum } from '../../engine/s4-v2.1/versus/offline-attribute-settings.js';

// S4 presentation only: list every eligible bond, preview the two strongest.
// Always start from roster values so toggles never accumulate or save bonuses.
export function tacticsBondDisplay(starters, catalog, { roles = {}, showBonuses = false } = {}) {
  const bonds = evaluateS4LineupBonds(starters, catalog, { roles });
  if (!showBonuses || !bonds.length) return { bonds, players: starters };
  const players = applyS4BondBonuses(starters.map(player => ({
    ...player,
    assignedRole: roles[player.id] ?? player.assignedRole ?? player.role,
    attributes: { ...(player.effectiveAttributes ?? player.attributes ?? {}) },
  })), bonds, { maximumAttribute: offlineAttributeMaximum() }).map(player => ({
    ...player,
    effectiveAttributes: player.attributes,
    effectiveOverall: playerOverallFromAttributes(player.attributes, player.role),
  }));
  return { bonds, players };
}
