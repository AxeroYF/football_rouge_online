function maximumWeightAssignment(weights) {
  const rowCount = weights.length;
  const columnCount = weights[0]?.length ?? 0;
  if (!rowCount || columnCount < rowCount) return [];
  const rowPotential = Array(rowCount + 1).fill(0);
  const columnPotential = Array(columnCount + 1).fill(0);
  const columnMatch = Array(columnCount + 1).fill(0);
  const previousColumn = Array(columnCount + 1).fill(0);
  for (let row = 1; row <= rowCount; row += 1) {
    columnMatch[0] = row;
    let currentColumn = 0;
    const minimum = Array(columnCount + 1).fill(Infinity);
    const used = Array(columnCount + 1).fill(false);
    do {
      used[currentColumn] = true;
      const currentRow = columnMatch[currentColumn];
      let delta = Infinity;
      let nextColumn = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const cost = -Number(weights[currentRow - 1][column - 1] ?? 0) - rowPotential[currentRow] - columnPotential[column];
        if (cost < minimum[column]) { minimum[column] = cost; previousColumn[column] = currentColumn; }
        if (minimum[column] < delta) { delta = minimum[column]; nextColumn = column; }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) { rowPotential[columnMatch[column]] += delta; columnPotential[column] -= delta; }
        else minimum[column] -= delta;
      }
      currentColumn = nextColumn;
    } while (columnMatch[currentColumn] !== 0);
    do {
      const nextColumn = previousColumn[currentColumn];
      columnMatch[currentColumn] = columnMatch[nextColumn];
      currentColumn = nextColumn;
    } while (currentColumn !== 0);
  }
  const assignment = Array(rowCount).fill(-1);
  for (let column = 1; column <= columnCount; column += 1) if (columnMatch[column]) assignment[columnMatch[column] - 1] = column - 1;
  return assignment;
}

export function optimalLineupAssignment(slots, candidates, scorePlayerForSlot) {
  if (!Array.isArray(slots) || !Array.isArray(candidates) || candidates.length < slots.length || typeof scorePlayerForSlot !== "function") return [];
  const weights = slots.map((slot) => candidates.map((player) => Number(scorePlayerForSlot(player, slot)) || 0));
  return maximumWeightAssignment(weights).map((candidateIndex, index) => ({ slot:slots[index], player:candidates[candidateIndex], score:weights[index][candidateIndex] }));
}

export function remapLineupPresetSlots(sourceStarterIds, assignments, sourcePresets, presetKeys) {
  const slotPlayerMap = new Map(assignments.map((assignment) => [assignment.slot.playerId, assignment.player.id]));
  const remapped = structuredClone(sourcePresets);
  for (const preset of presetKeys) {
    const positions = sourcePresets[preset] ?? {};
    remapped[preset] = Object.fromEntries(sourceStarterIds.map((oldPlayerId) => [
      slotPlayerMap.get(oldPlayerId),
      structuredClone(positions[oldPlayerId] ?? { x:50, y:50 }),
    ]));
  }
  return { positionPresets:remapped, slotPlayerMap, nextStarterIds:assignments.map((assignment) => assignment.player.id) };
}
