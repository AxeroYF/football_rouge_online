import { v2BestPlayerDuty } from "./v2-player-duty-options.js";

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
        if (cost < minimum[column]) {
          minimum[column] = cost;
          previousColumn[column] = currentColumn;
        }
        if (minimum[column] < delta) {
          delta = minimum[column];
          nextColumn = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          rowPotential[columnMatch[column]] += delta;
          columnPotential[column] -= delta;
        } else minimum[column] -= delta;
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
  for (let column = 1; column <= columnCount; column += 1) {
    if (columnMatch[column]) assignment[columnMatch[column] - 1] = column - 1;
  }
  return assignment;
}

export function v2OptimalLineupAssignment(slots, candidates, scorePlayerForSlot) {
  if (!Array.isArray(slots) || !Array.isArray(candidates) || candidates.length < slots.length || typeof scorePlayerForSlot !== "function") return [];
  const weights = slots.map((slot) => candidates.map((player) => Number(scorePlayerForSlot(player, slot)) || 0));
  return maximumWeightAssignment(weights).map((candidateIndex, index) => ({
    slot:slots[index],
    player:candidates[candidateIndex],
    score:weights[index][candidateIndex],
  }));
}

export function v2RecommendedPlayerDuties(players, roles, positionFitForPlayer = () => 1) {
  return Object.fromEntries(players.flatMap((player) => {
    const role = roles[player.id];
    if (!role || role === "GK") return [];
    const recommendation = v2BestPlayerDuty(player, role, positionFitForPlayer(player, role));
    return recommendation ? [[player.id, recommendation]] : [];
  }));
}

