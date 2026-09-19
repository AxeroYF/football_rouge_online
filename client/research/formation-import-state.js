// Keep the original geometry until research use is released, including when switching research slots.
export function rememberFormationBeforeResearch(state, key) {
  state.researchFormationBackups ??= {};
  if (!state.researchFormationIds?.[key]) {
    state.researchFormationBackups[key] = structuredClone({
      positions: state.positionPresets[key], lines: state.formationLinePresets[key],
    });
  }
}
export function releaseResearchFormation(state, key, fallback) {
  const saved = state.researchFormationBackups?.[key];
  const source = saved ?? fallback;
  state.positionPresets[key] = structuredClone(source.positions);
  state.formationLinePresets[key] = structuredClone(source.lines);
  delete state.researchFormationIds[key];
  if (state.researchFormationBackups) delete state.researchFormationBackups[key];
  return Boolean(saved);
}
