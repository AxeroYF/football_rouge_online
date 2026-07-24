import { REAL_PLAYER_BY_ID } from "./player-pool.js";
import { analyzeElevenFormation, defaultElevenPositions } from "./rules.js";

function validPosition(value) {
  return Number.isFinite(Number(value?.x)) && Number.isFinite(Number(value?.y));
}

export function hydrateHistoricalMatchDetail(detail) {
  const hydrated = structuredClone(detail);
  if (!Array.isArray(hydrated.teams)) return hydrated;
  hydrated.teams = (hydrated.teams ?? []).map((team) => {
    const players = (team.players ?? []).map((player) => {
      const catalogPlayer = REAL_PLAYER_BY_ID[player.id];
      return {
        ...player,
        role: player.role ?? catalogPlayer?.role ?? "AM",
        assignedRole: player.assignedRole ?? player.role ?? catalogPlayer?.role ?? "AM",
        overall: Number.isFinite(Number(player.overall)) ? Number(player.overall) : Number(catalogPlayer?.overall ?? 0),
      };
    });
    const fallbackPositions = defaultElevenPositions(players);
    const positions = Object.fromEntries(players.map((player) => {
      const savedPosition = validPosition(player.position)
        ? player.position
        : validPosition(team.positions?.[player.id])
          ? team.positions[player.id]
          : fallbackPositions[player.id];
      return [player.id, { x: Number(savedPosition.x), y: Number(savedPosition.y) }];
    }));
    const formation = analyzeElevenFormation(players, positions);
    return {
      ...team,
      formation: team.formation ?? formation.name,
      positions,
      players: players.map((player) => ({
        ...player,
        assignedRole: player.assignedRole ?? formation.roles[player.id],
        position: { ...positions[player.id] },
      })),
    };
  });
  return hydrated;
}
