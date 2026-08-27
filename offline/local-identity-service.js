import { yellowDogsLeague } from "../versus/league-service.js";
import { versusRooms } from "../versus/room-service.js";

function accountForOwner(ownerId) {
  return [...versusRooms.accounts.values()].find((account) => account.id === ownerId) ?? null;
}

function teamSummary(team) {
  const rank = [...yellowDogsLeague.state.teams]
    .sort((left, right) => Number(right.table?.points ?? 0) - Number(left.table?.points ?? 0)
      || Number((right.table?.goalsFor ?? 0) - (right.table?.goalsAgainst ?? 0)) - Number((left.table?.goalsFor ?? 0) - (left.table?.goalsAgainst ?? 0)))
    .findIndex((candidate) => candidate.id === team.id) + 1;
  return {
    id:team.id,
    name:team.name,
    ownerId:team.ownerId,
    ownerName:team.ownerName,
    rank:rank || null,
    points:Number(team.table?.points ?? 0),
    played:Number(team.table?.played ?? 0),
    rosterSize:Array.isArray(team.rosterIds) ? team.rosterIds.length : 0,
    formation:team.formation ?? null,
    tactic:team.tactic ?? "balanced",
    style:team.style ?? "possession",
    championBadges:Array.isArray(team.championBadges) ? team.championBadges.length : 0,
  };
}

export function offlineTeamCatalog() {
  return {
    mode:"ydl-offline",
    season:{ ...yellowDogsLeague.state.season },
    teams:yellowDogsLeague.state.teams
      .filter((team) => team.ownerId && accountForOwner(team.ownerId))
      .map(teamSummary),
  };
}

export function selectOfflineTeam(teamId) {
  const team = yellowDogsLeague.state.teams.find((candidate) => candidate.id === String(teamId ?? ""));
  if (!team?.ownerId) throw Object.assign(new Error("球队不存在或尚未绑定本地身份"), { statusCode:404 });
  const account = accountForOwner(team.ownerId);
  if (!account) throw Object.assign(new Error("球队的本地影子账号不存在"), { statusCode:409 });
  return {
    accountToken:account.token,
    profile:versusRooms.publicProfile(account),
    team:teamSummary(team),
  };
}
