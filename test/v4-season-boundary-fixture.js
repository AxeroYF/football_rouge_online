import {YellowDogsLeagueService} from '../versus/league-service.js';
export const at=1794934800000,createService=options=>new YellowDogsLeagueService(options);
export function completedSeason(){
  const service=createService({statePath:null,backupDir:null,now:()=>at,rng:()=>.5});
  // Deterministic boundary fixture; no claim of simulated football in this test.
  for(const round of service.state.rounds){round.status='complete';for(const [index,fixture] of round.fixtures.entries()){fixture.matchId=`boundary-league-${round.number}-${index}`;service.state.matches.push({id:fixture.matchId,competition:'league',round:round.number,homeId:fixture.homeId,awayId:fixture.awayId,score:[1,0],playedAt:at});}}
  service.startCup();while(service.state.cup.status!=='completed'){
    const event=service.state.cup.events.find(event=>event.status==='pending');
    for(const fixture of service.cupEventFixtures(event)){fixture.status='complete';fixture.score=[1,0];fixture.winnerId=fixture.homeId;fixture.matchId='boundary-'+fixture.id;service.state.matches.push({id:fixture.matchId,competition:'cup',cupStage:event.stage,cupRound:event.round,legNumber:event.leg,homeId:fixture.homeId,awayId:fixture.awayId,score:[1,0],playedAt:at});}
    service.completeCupEvent(event);
  }
  service.state.season.status='completed';service.state.season.currentRound=14;service.state.season.completedAt=at;
  for(const [index,team] of service.state.teams.entries())team.table={played:14,won:7,drawn:0,lost:7,goalsFor:7,goalsAgainst:7,points:21-index};
  for(const [index,team] of service.state.teams.slice(0,2).entries()){team.ownerId='boundary-owner-'+index;team.ownerName='边界测试'+index;for(const id of [...team.rosterIds])service.grantS4Card(team,id,{grantOwnership:true,acquisitionSource:'season-boundary-test'});}
  return structuredClone(service.state);
}
