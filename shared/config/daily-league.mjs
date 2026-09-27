export const DAILY_LEAGUE = Object.freeze({
  clubIds: Object.freeze(['real-madrid','barcelona','bayern-munich','manchester-city']),
  startHour: 10, resetMinutes: 9*60+50, intervalMs: 30 * 60_000,
  attendanceRate: 0.5, ticketPrice: 0.1,
});
export const LEAGUE_REWARDS = Object.freeze([
  [100000,15],[92000,14],[85000,13],[78000,12],[72000,11],
  [66000,10],[61000,9],[57000,9],[53000,8],[50000,8],
].map(([gold,packs],i)=>Object.freeze({rank:i+1,gold,packs})));
export const leagueDate = at => new Date(Number(at)+8*3600000).toISOString().slice(0,10);
export const leagueDayStart = day => Date.parse(day+'T00:00:00+08:00');

export function leagueSchedule(teamIds, day, rules=DAILY_LEAGUE) {
  if(teamIds.length<2||new Set(teamIds).size!==teamIds.length)throw Error('联赛球队ID必须唯一且至少两队');
  const rotation=[...teamIds];if(rotation.length%2)rotation.push(null);
  const first=[];
  for(let r=0;r<rotation.length-1;r++){
    const pairs=[];
    for(let i=0;i<rotation.length/2;i++){
      const a=rotation[i],b=rotation[rotation.length-1-i];
      if(a!==null&&b!==null)pairs.push(r%2?[b,a]:[a,b]);
    }
    first.push(pairs);rotation.splice(1,0,rotation.pop());
  }
  return [...first,...first.map(pairs=>pairs.map(([a,b])=>[b,a]))].flatMap((pairs,r)=>pairs.map(([homeId,awayId],i)=>({
    id:`league:${day}:${r+1}:${i+1}`,round:r+1,homeId,awayId,
    startsAt:leagueDayStart(day)+rules.startHour*3600000+r*rules.intervalMs,status:'scheduled',
  })));
}
export function leagueStandings(day) {
  const rows=new Map(day.teams.map(t=>[t.id,{...t,played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,points:0}]));
  for(const f of day.fixtures){if(f.status!=='completed')continue;
    for(const [i,id] of [f.homeId,f.awayId].entries()){
      const row=rows.get(id),gf=f.score[i],ga=f.score[1-i];row.played++;row.goalsFor+=gf;row.goalsAgainst+=ga;
      if(gf>ga){row.won++;row.points+=3;}else if(gf===ga){row.drawn++;row.points++;}else row.lost++;
    }
  }
  return [...rows.values()].sort((a,b)=>b.points-a.points||(b.goalsFor-b.goalsAgainst)-(a.goalsFor-a.goalsAgainst)||b.goalsFor-a.goalsFor||a.id.localeCompare(b.id))
    .map((row,i)=>({...row,rank:i+1,goalDifference:row.goalsFor-row.goalsAgainst}));
}
export function leagueTicket(fans,capacity,rules=DAILY_LEAGUE){
  const attendance=Math.floor(Math.min(Math.max(0,Number(capacity)||0),Math.max(0,Number(fans)||0)*rules.attendanceRate));
  return {attendance,capacity:Math.max(0,Number(capacity)||0),price:rules.ticketPrice,gold:Math.floor(attendance*rules.ticketPrice)};
}
