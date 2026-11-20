import {REAL_PLAYER_BY_ID} from './player-pool.js';
import {isGoalEvent} from './public/goal-event.js';
import {aiClubBadge} from './ai-clubs.js';
import {COSMETIC_BADGE_BY_ID} from './cosmetic-items.js';

const competitions = {cup:'冠军杯', friendly:'友谊赛', 'season-final':'赛季总决赛', worldcup:'黄狗世界杯'};
const stages = {league:'联赛阶段', swiss:'瑞士轮', roundOf16:'十六强', quarterfinals:'八强', semifinals:'四强', final:'决赛'};

export function historyArchiveKey(archive) {
  return JSON.stringify([archive.season.id, archive.archivedAt, archive.reason]);
}

function participantId(team, slot, playedAt) {
  if (team?.ownerId && (!team.joinedAt || playedAt >= team.joinedAt)) return 'club-' + team.ownerId;
  return 'ai-' + slot;
}

// The rolling report archive and the permanent club summaries have separate lifetimes.
// Only the player's own side of each match belongs in their history payload.
export function summarizeClubSeason(source, standings, onlyOwner = null) {
  const teams = new Map(standings.map(row => [row.id, row.team]));
  const matches = [...source.matches ?? [], ...source.seasonFinalTournament?.matches ?? []];
  const clubs = {};
  for (const standing of standings) {
    const team = standing.team;
    if (!team?.ownerId || (onlyOwner && team.ownerId !== onlyOwner)) continue;
    const division = standing.division ?? team.division;
    const completed = source.season.status === 'completed';
    const name = source.season.name ?? source.season.id;
    const honors = [];
    if (completed && standing.rank === 1) honors.push({label:(division ? division+'级联赛' : '联赛')+'冠军',tier:'gold'});
    const cupChampion = source.cup?.championId === team.id && source.cup.status === 'completed';
    if (cupChampion) honors.push({label:'冠军杯冠军',tier:'gold'});
    if (source.seasonFinalTournament?.finalTie?.championId === team.id) honors.push({label:'赛季总决赛冠军',tier:'gold'});
    const movement = completed ? ({promotion:'promoted',relegation:'relegated'}[standing.movement] ?? 'stayed') : null;
    const season = {id:source.season.id,name,shortName:name,division,divisionName:division ? division+'级联赛' : '联赛',
      finalRank:standing.rank,inProgress:!source.archivedAt && !completed,movement,
      movementLabel:({promoted:'升入 A 级',relegated:'降入 B 级',stayed:'—'}[movement] ?? '—'),
      honors,cupStage:'—',hasArchiveGap:false};
    const rows = [], players = new Map(), seen = new Set(), opponentBadges = {};
    let latestCupStage = -1;
    let leagueGames = 0;
    for (const m of matches) {
      const home = m.homeId === team.id;
      if (!home && m.awayId !== team.id) continue;
      if (!m.id || m.pending || !Array.isArray(m.score) || m.score.length !== 2 || !m.score.every(Number.isFinite)) continue;
      if (m.playedAt < team.joinedAt || m.aiTraining || m.competition === 'training' || seen.has(m.id)) continue;
      seen.add(m.id);
      const side = home ? 0 : 1, other = home ? m.awayId : m.homeId;
      const competition = m.competition ?? 'league', report = m.report;
      const opponent = teams.get(other), playedAt = Number(m.playedAt) || 0;
      const opponentName = (home ? m.awayName : m.homeName) ?? opponent?.name ?? other;
      const opponentId = participantId(opponent,other,playedAt);
      if (source.archivedAt && opponent && (!opponent.ownerId || opponentId === 'club-'+opponent.ownerId)) {
        opponentBadges[opponentId] = [opponent.equippedBadge?.id ?? null,opponent.equippedClubBadge?.id ?? null];
      }
      const playerStats = [];
      for (const p of report?.teams?.[side]?.players ?? []) {
        if (!p.id || p.startedMatch === false && p.enteredAsSubstitute === false) continue;
        const base = REAL_PLAYER_BY_ID[p.id];
        players.set(p.id,{id:p.id,name:p.name ?? base?.name ?? p.id,role:p.role ?? base?.role ?? '—'});
        playerStats.push({playerId:p.id,started:p.startedMatch ?? (p.enteredAsSubstitute ? false : null),goals:p.stats?.goals ?? null,
          assists:p.stats?.assists ?? null,saves:p.stats?.saves ?? null,rating:p.rating ?? null});
      }
      const d = m.division ?? (competition === 'league' ? division : null);
      if (competition === 'league') leagueGames++;
      if (competition === 'cup') latestCupStage = Math.max(latestCupStage,Object.keys(stages).indexOf(m.cupStage));
      const penalties = m.penalties ?? report?.penalties ?? report?.penaltyShootout?.scores;
      const hasInlineReplay = report?.keyPlays?.some(c => c.frames?.length >= 2 || c.actions?.length);
      const hasStoredReplay = !source.archivedAt && report?.v4ReviewArchive && report?.importantEvents?.some(e=>isGoalEvent(e) && Number.isFinite(e.replayTime));
      rows.push({id:m.id,seasonId:season.id,playedAt,date:playedAt ? new Date(playedAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}) : '—',
        competition,division:d,competitionName:competitions[competition] ?? (d ? d+'级联赛' : '联赛'),
        round:stages[m.cupStage] ?? m.seasonFinalNodeId ?? (m.round || m.cupRound ? '第 '+(m.round || m.cupRound)+' 轮' : '—'),
        venue:home?'home':'away',opponentId,opponentName,
        homeGoals:m.score[0],awayGoals:m.score[1],penalties:penalties?.length===2 ? {label:'点球 '+penalties.join(' : ')} : null,
        hasDetail:Boolean(report),hasReplay:Boolean(hasInlineReplay || hasStoredReplay || report?.dotReplay?.frames?.some(f=>['goal','ownGoal'].includes(f.type))),hasPlayerDetails:playerStats.length>0,playerStats});
    }
    season.cupStage = cupChampion ? '冠军' : Object.values(stages)[latestCupStage] ?? '—';
    season.hasArchiveGap = team.table?.played > leagueGames && !(team.joinedAt >= source.season.startedAt && source.season.startedAt);
    clubs[team.ownerId] = {teamId:team.id,season,matches:rows,players:[...players.values()],opponentBadges};
  }
  return clubs;
}

export function assembleClubHistory(team, snapshots, replayCutoff, currentBadges) {
  const seasons = new Map(), matches = new Map(), players = new Map(), opponents = new Map();
  const roster = new Set(team.rosterIds);
  for (const {clubs, available} of snapshots) {
    const club = clubs?.[team.ownerId];
    if (!club || club.teamId !== team.id) continue;
    seasons.set(club.season.id,club.season);
    for (const p of club.players) players.set(p.id,{...p,roleLabel:p.role,status:roster.has(p.id)?'active':'departed'});
    for (const row of club.matches) {
      if (team.joinedAt && row.playedAt && row.playedAt < team.joinedAt) continue;
      const opp = opponents.get(row.opponentId) ?? {id:row.opponentId,name:row.opponentName,previousNames:[]};
      if (opp.name !== row.opponentName) {
        if (!opp.previousNames.includes(opp.name)) opp.previousNames.push(opp.name);
        opp.name = row.opponentName;
      }
      opp.short = String(opp.name).slice(0,2);
      const badges = club.opponentBadges?.[opp.id];
      if (badges) {
        opp.equippedBadge = COSMETIC_BADGE_BY_ID[badges[0]] ?? null;
        opp.equippedClubBadge = COSMETIC_BADGE_BY_ID[badges[1]] ?? null;
      }
      opponents.set(opp.id,opp);
      matches.set(row.id,{...row,hasDetail:available && row.hasDetail,hasReplay:available && row.hasReplay && row.playedAt >= replayCutoff});
    }
  }
  for (const opp of opponents.values()) {
    const current = currentBadges.get(opp.id);
    if (opp.id.startsWith('ai-')) {
      opp.equippedClubBadge = aiClubBadge({name:opp.name}) ?? opp.equippedClubBadge ?? current?.equippedClubBadge;
    } else if (current) Object.assign(opp,current);
  }
  return {club:{id:team.id,name:team.name,shortName:team.name.slice(0,2),...currentBadges.get('club-'+team.ownerId)},seasons:[...seasons.values()],
    opponents:[...opponents.values()],players:[...players.values()],matches:[...matches.values()]};
}
