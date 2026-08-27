// Season Final Tournament domain rules. This module is intentionally pure so
// snapshots can be generated once and safely replayed after a season reload.

export const SEASON_FINAL_RULES = Object.freeze({
  teamCount: 10,
  playerTeamCount: 9,
  aiSeed: 10,
  leagueWeight: 0.5,
  cupWeight: 0.5,
  leagueRankPoints: Object.freeze({ 1: 10, 2: 9, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 2, 10: 1 }),
  cupStagePoints: Object.freeze({ champion: 10, finalist: 8, semifinal: 6, quarterfinal: 4, knockout: 4, group: 2, entered: 0 }),
  positionLines: Object.freeze({ forward: "ATT", midfield: "MID", defense: "DEF" }),
  firstMatchDelayMinutes: 20,
  finalBanDeadlineMinutes: 110,
});

export const SEASON_FINAL_SCHEDULE_MINUTES = Object.freeze({
  W1:20, B1:20, B2:20, B3:20,
  W2:40, B4:40, B5:40,
  B6:60, B7:80, B8:100,
  "FINAL-1":120, "FINAL-2":130,
});

export const CUP_ELIMINATION_STAGE_ORDER = Object.freeze([
  "champion", "finalist", "semifinal", "quarterfinal", "knockout", "group", "entered",
]);

const STAGE_ALIASES = Object.freeze({
  final: "champion", winner: "champion", champion: "champion", runner_up: "finalist", finalist: "finalist",
  semifinal: "semifinal", semifinals: "semifinal", quarterfinal: "quarterfinal", quarterfinals: "quarterfinal",
  knockout: "knockout", round_of_16: "knockout", group: "group", swiss: "group", entered: "entered",
});

function normalizedRank(rank, fallback = SEASON_FINAL_RULES.teamCount) {
  const value = Number(rank);
  return Number.isInteger(value) && value >= 1 && value <= SEASON_FINAL_RULES.teamCount ? value : fallback;
}

function normalizedStage(stage) {
  return STAGE_ALIASES[String(stage ?? "entered").trim().toLowerCase()] ?? "entered";
}

export function leagueSeedPoints(rank) {
  return SEASON_FINAL_RULES.leagueRankPoints[normalizedRank(rank)];
}

export function cupSeedPoints(result = {}) {
  const stage = normalizedStage(result.stage ?? result.finish ?? result.result);
  const base = SEASON_FINAL_RULES.cupStagePoints[stage];
  const groupRank = normalizedRank(result.groupRank ?? result.groupPosition ?? result.rank, SEASON_FINAL_RULES.teamCount);
  // Group rank only breaks ties within the same elimination stage. Higher is better.
  return { stage, points: base, groupRank, key: `${String(10 - base).padStart(2, "0")}:${String(groupRank).padStart(2, "0")}` };
}

export function compareCupResults(left = {}, right = {}) {
  const a = cupSeedPoints(left); const b = cupSeedPoints(right);
  return b.points - a.points || a.groupRank - b.groupRank || String(left.teamId ?? "").localeCompare(String(right.teamId ?? ""));
}

function isAiTeam(team) {
  return team?.isAi === true || team?.ai === true || team?.ownerId === null || team?.ownerId === undefined;
}

export function buildSeasonFinalSeedSnapshot(teams = [], leagueRanks = {}, cupResults = {}) {
  const ordered = teams.filter(Boolean).map((team) => {
    const teamId = String(team.id);
    const leagueRank = normalizedRank(leagueRanks[teamId] ?? team.leagueRank);
    const cup = cupSeedPoints({ teamId, ...(cupResults[teamId] ?? {}) });
    const leaguePoints = leagueSeedPoints(leagueRank);
    const compositeScore = Number((leaguePoints * SEASON_FINAL_RULES.leagueWeight + cup.points * SEASON_FINAL_RULES.cupWeight).toFixed(4));
    return { teamId, teamName: team.name ?? teamId, isAi: isAiTeam(team), leagueRank, leaguePoints, cupStage: cup.stage, cupGroupRank: cup.groupRank, cupPoints: cup.points, compositeScore };
  });
  const players = ordered.filter((entry) => !entry.isAi).sort((a, b) => b.compositeScore - a.compositeScore || a.leagueRank - b.leagueRank || a.cupGroupRank - b.cupGroupRank || a.teamId.localeCompare(b.teamId));
  const ai = ordered.filter((entry) => entry.isAi).sort((a, b) => a.teamId.localeCompare(b.teamId))[0] ?? null;
  return [...players.slice(0, 9), ...(ai ? [ai] : [])].map((entry, index) => ({ ...entry, seed: entry.isAi ? SEASON_FINAL_RULES.aiSeed : index + 1, tiebreak: entry.isAi ? "fixed-ai-seed" : "compositeScore>leagueRank>cupGroupRank>teamId" }));
}

export function createSeasonFinalBracket(seedSnapshot = [], scheduleAnchorAt = null) {
  const bySeed = Object.fromEntries(seedSnapshot.map((entry) => [entry.seed, entry.teamId]));
  const slot = (seed) => bySeed[seed] ?? null;
  const nodes = [
    ["W1", "winner", slot(2), slot(3)], ["W2", "winner", slot(1), "W1.winner"],
    ["B1", "loser", slot(5), slot(10)], ["B2", "loser", slot(6), slot(9)], ["B3", "loser", slot(7), slot(8)],
    ["B4", "loser", slot(4), "B3.winner"], ["B5", "loser", "B1.winner", "B2.winner"], ["B6", "loser", "B4.winner", "B5.winner"],
    ["B7", "loser", "B6.winner", "W1.loser"], ["B8", "loser", "B7.winner", "W2.loser"],
    ["FINAL-1", "final", "W2.winner", "B8.winner"], ["FINAL-2", "final", "B8.winner", "W2.winner"],
  ];
  const anchor = Number(scheduleAnchorAt);
  return nodes.map(([id, group, home, away], order) => ({
    id, group, order, home, away, winner:null, loser:null, status:"pending", matchIds:[],
    scheduledAt:Number.isFinite(anchor) ? anchor + SEASON_FINAL_SCHEDULE_MINUTES[id] * 60 * 1000 : null,
  }));
}

export function positionLine(position) {
  const value = String(position ?? "").trim().toUpperCase();
  if (value === "GK") return "GK";
  if (["CB", "LB", "RB", "LWB", "RWB", "WB", "DEF"].includes(value)) return "DEF";
  if (["DM", "CM", "AM", "LM", "RM", "WM", "MID"].includes(value)) return "MID";
  return "ATT";
}

export function validateFinalBanSelection(selection = {}, players = []) {
  const available = new Map(players.filter((player) => player?.id).map((player) => [String(player.id), player]));
  const result = {};
  for (const line of ["forward", "midfield", "defense"]) {
    const player = available.get(String(selection[line] ?? ""));
    if (!player || positionLine(player.position ?? player.role) !== SEASON_FINAL_RULES.positionLines[line] || player.position === "GK" || player.isAvailable === false) return { valid: false, selection: result, invalidLine: line };
    result[line] = String(player.id);
  }
  if (new Set(Object.values(result)).size !== 3) return { valid: false, selection: result, invalidLine: "duplicate" };
  return { valid: true, selection: result, invalidLine: null };
}

export function createSeasonFinalState({ id, seasonId, teams, leagueRanks, cupResults, createdAt = Date.now(), scheduleAnchorAt = createdAt }) {
  const seedSnapshot = buildSeasonFinalSeedSnapshot(teams, leagueRanks, cupResults);
  const anchor = Number(scheduleAnchorAt);
  const resolvedAnchor = Number.isFinite(anchor) ? anchor : Number(createdAt);
  return {
    id, seasonId, status:"scheduled", createdAt, scheduleAnchorAt:resolvedAnchor,
    nextMatchAt:resolvedAnchor + SEASON_FINAL_RULES.firstMatchDelayMinutes * 60 * 1000,
    finalBanDeadlineAt:resolvedAnchor + SEASON_FINAL_RULES.finalBanDeadlineMinutes * 60 * 1000,
    seedSnapshot, bracket:createSeasonFinalBracket(seedSnapshot, resolvedAnchor), matches:[],
    finalTie:{ winnerBracketChampionId:null, loserBracketChampionId:null, firstLegId:null, secondLegId:null, aggregateScore:null, extraTime:false, penalties:false, championId:null },
    finalBanDecisions:[], stateRefreshAt:null,
  };
}
