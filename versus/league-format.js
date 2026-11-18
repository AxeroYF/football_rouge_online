export const LEAGUE_FORMAT_VERSION = 2;
export const DIVISIONS = ['A', 'B'];
export const DIVISION_SIZE = 8;
export const PROMOTION_COUNT = 2;
export const LEAGUE_TEAM_COUNT = DIVISION_SIZE * DIVISIONS.length;
export const LEAGUE_ROUNDS = (DIVISION_SIZE - 1) * 2;
export const SEASON_FINAL_ENABLED = false;

export function compareLeagueTeams(a, b) {
  return b.table.points-a.table.points
    || (b.table.goalsFor-b.table.goalsAgainst)-(a.table.goalsFor-a.table.goalsAgainst)
    || b.table.goalsFor-a.table.goalsFor
    || a.id.localeCompare(b.id, 'en', {numeric:true});
}

export function divisionStandings(teams, division = null) {
  const groups = DIVISIONS.flatMap(group => teams.filter(t => t.division === group).sort(compareLeagueTeams)
    .map((team,index)=>({id:team.id,division:group,rank:index+1,overallRank:DIVISIONS.indexOf(group)*DIVISION_SIZE+index+1,points:team.table.points,
      movement:group==='A'&&index>=DIVISION_SIZE-PROMOTION_COUNT?'relegation':group==='B'&&index<PROMOTION_COUNT?'promotion':null})));
  return division ? groups.filter(t=>t.division===division) : groups;
}

export function assignInitialDivisions(teams) {
  const ordered=[...teams].sort((a,b)=>Number(Boolean(b.ownerId))-Number(Boolean(a.ownerId))||compareLeagueTeams(a,b));
  ordered.forEach((team,index)=>{team.division=index<DIVISION_SIZE?'A':'B';});
}

export function buildDivisionRounds(teams, roundRobin, shuffle = ids=>ids) {
  const schedules=DIVISIONS.map(division=>{
    const ids=teams.filter(t=>t.division===division).map(t=>t.id);
    if(ids.length!==DIVISION_SIZE)throw new Error(`${division}级联赛必须有${DIVISION_SIZE}支球队`);
    return roundRobin(shuffle(ids,division));
  });
  return schedules[0].map((round,index)=>({...round,fixtures:schedules.flatMap((rounds,i)=>rounds[index].fixtures.map(f=>({...f,division:DIVISIONS[i]})))}));
}

export function divisionMovement(teams, seasonId) {
  const table=divisionStandings(teams);
  return {seasonId,promoted:table.filter(t=>t.division==='B'&&t.rank<=PROMOTION_COUNT).map(t=>t.id),
    relegated:table.filter(t=>t.division==='A'&&t.rank>DIVISION_SIZE-PROMOTION_COUNT).map(t=>t.id),
    standings:table};
}

export function emptyKnockoutCup() {
  return {format:'knockout-16-v1',status:'waiting',stage:'waiting',participants:[],table:{},leagueRounds:[],swissRounds:[],
    knockout:{roundOf16:[],quarterfinals:[],semifinals:[],final:[]},events:[],playerStats:{},nextRoundAt:null,championId:null,startedAt:null,finalStartedAt:null,completedAt:null};
}
