export const DRAFT_VERSION = 3;
export const DRAFT_SIZE = 33;
export const DRAFT_POOLS = Object.freeze({
  GK: Object.freeze(["GK"]),
  DEF: Object.freeze(["LB", "CB", "RB"]),
  MID: Object.freeze(["LM", "RM", "AM", "DM"]),
  ATT: Object.freeze(["LW", "ST", "RW"]),
});
export const LINE_KEYS = Object.freeze(Object.keys(DRAFT_POOLS));
export const DRAFT_ROLES = Object.freeze(Object.values(DRAFT_POOLS).flat());
export const MINIMUM_GOALKEEPERS = 3;
export const GRADE_WEIGHTS = Object.freeze({ C: 0.30, B: 0.40, A: 0.25, S: 0.05 });
export const DRAFT_CONFIG = Object.freeze({
  version: DRAFT_VERSION,
  size: DRAFT_SIZE,
  pools: DRAFT_POOLS,
  minimumGoalkeepers: MINIMUM_GOALKEEPERS,
  gradeWeights: GRADE_WEIGHTS,
});
export function draftPositionCounts(roster = []) {
  return Object.fromEntries(DRAFT_ROLES.map(role => [role, roster.filter(player => player.role === role).length]));
}
export function missingDraftGoalkeepers(roster = []) {
  return Math.max(0, MINIMUM_GOALKEEPERS - roster.filter(player => player.role === "GK").length);
}
export function draftTargetSize(draft) {
  if (draft.version === DRAFT_VERSION) return draft.totalPicks ?? DRAFT_SIZE;
  // Old progress keeps already selected cards; only missing goalkeepers can require extra picks.
  return Math.max(DRAFT_SIZE, draft.roster.length + missingDraftGoalkeepers(draft.roster));
}
export function availableDraftPools(draft) {
  const remaining = draftTargetSize(draft) - draft.roster.length;
  if (remaining <= 0) return [];
  return remaining <= missingDraftGoalkeepers(draft.roster) ? ["GK"] : [...LINE_KEYS];
}
export function hasCurrentDraftOffer(draft) {
  return draft.version >= 2 && Boolean(draft.offer?.length) && availableDraftPools(draft).includes(draft.offerPool);
}
