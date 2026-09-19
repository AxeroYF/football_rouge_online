const alternatives = ['position2', 'position3'];
const copy = value => structuredClone(value);
function samePositions(a, b) {
  const ids = Object.keys(a ?? {});
  return ids.length > 0 && ids.every(id => a[id]?.x === b?.[id]?.x && a[id]?.y === b?.[id]?.y);
}
function sameLines(a, b) {
  return ['attack', 'midfield', 'defense', 'goalkeeper'].every(key => a?.[key] === b?.[key]);
}

// Old saves have no edit flag. Preserve distinct layouts; recognize unchanged
// copies and the original generated grid as inherited layouts.
export function initializePositionInheritance(state, { generatedPositions = {}, defaultLines = {} } = {}) {
  state.customPositionPresets = { ...state.customPositionPresets };
  for (const key of alternatives) {
    if (typeof state.customPositionPresets[key] === 'boolean') continue;
    const positions = state.positionPresets[key];
    const lines = state.formationLinePresets[key];
    const sameAsDefault = samePositions(positions, state.positionPresets.position1) && sameLines(lines, state.formationLinePresets.position1);
    const generated = samePositions(positions, generatedPositions) && sameLines(lines, defaultLines);
    state.customPositionPresets[key] = Boolean(state.researchFormationIds?.[key]) || Boolean(positions && Object.keys(positions).length && !sameAsDefault && !generated);
  }
  return syncInheritedPositions(state);
}

export function syncInheritedPositions(state) {
  for (const key of alternatives) {
    if (state.customPositionPresets?.[key] !== false) continue;
    state.positionPresets[key] = copy(state.positionPresets.position1);
    state.formationLinePresets[key] = copy(state.formationLinePresets.position1);
    for (const field of ['researchFormationIds', 'researchFormationBackups']) {
      state[field] ??= {};
      if (state[field].position1 != null) state[field][key] = copy(state[field].position1);
      else delete state[field][key];
    }
  }
  return state;
}

export function markPositionCustomized(state, key = state.activePositionPreset) {
  if (alternatives.includes(key)) (state.customPositionPresets ??= {})[key] = true;
}
