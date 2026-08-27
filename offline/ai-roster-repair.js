const AI_433 = Object.freeze([
  ["GK", 50, 90], ["LB", 18, 68], ["CB", 40, 68], ["CB", 60, 68], ["RB", 82, 68],
  ["DM", 50, 49], ["AM", 40, 40], ["AM", 60, 40], ["LW", 20, 20], ["ST", 50, 17], ["RW", 80, 20],
]);
const BENCH_ROLES = Object.freeze(["GK", "CB", "LB", "RB", "DM", "AM", "ST"]);
const ROLE_GROUPS = Object.freeze({ GK:"GK", CB:"DEF", LB:"DEF", RB:"DEF", DM:"MID", AM:"MID", LM:"MID", RM:"MID", ST:"ATT", LW:"ATT", RW:"ATT" });

function roleGroup(role) {
  return ROLE_GROUPS[role] ?? "ATT";
}

export function repairOfflineAiRoster(team, players, positionPresetKeys = ["position1", "position2", "position3"]) {
  if (!String(team?.ownerId ?? "").startsWith("YDL-OFFLINE-") || (team.rosterIds ?? []).length) return false;
  const used = new Set();
  const choose = (role) => {
    const candidates = players
      .filter((player) => !player?.isXPlayer && player?.role && !used.has(player.id) && (player.role === role || roleGroup(player.role) === roleGroup(role)))
      .sort((left, right) => (left.role === role ? 0 : 1) - (right.role === role ? 0 : 1) || Number(right.overall ?? 0) - Number(left.overall ?? 0) || String(left.id).localeCompare(String(right.id)));
    const player = candidates[0];
    if (!player) return null;
    used.add(player.id);
    return player;
  };
  const starters = AI_433.map(([role, x, y]) => ({ player:choose(role), position:{ x, y } })).filter((entry) => entry.player);
  if (starters.length !== AI_433.length) return false;
  const bench = BENCH_ROLES.map((role) => choose(role)).filter(Boolean);
  team.rosterIds = [...starters.map(({ player }) => player.id), ...bench.map((player) => player.id)];
  team.preferredStarterIds = starters.map(({ player }) => player.id);
  team.positions = Object.fromEntries(starters.map(({ player, position }) => [player.id, position]));
  team.positionPresets = Object.fromEntries(positionPresetKeys.map((key) => [key, structuredClone(team.positions)]));
  team.formationLinePresets = {};
  team.playerState = Object.fromEntries(team.rosterIds.map((id) => [id, { fitness:100, suspension:0, cupSuspension:0, seasonFinalSuspension:0, injuryRounds:0 }]));
  team.chemistry = {};
  team.captainId = team.preferredStarterIds.find((id) => players.find((player) => player.id === id)?.role !== "GK") ?? team.preferredStarterIds[0];
  return true;
}
