import test from 'node:test';
import assert from 'node:assert/strict';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {verifyV4ProtectedFiles} from '../scripts/v4-protected-files.mjs';

for(const competition of ['league','cup','season-final'])for(const v4 of [true,false])test(`${competition}: duplicate cards consume team-scoped V4 penalty statistics while legacy behavior stays unchanged (${v4?'V4':'legacy'})`,()=>{
  const service=new YellowDogsLeagueService({statePath:null,backupDir:null,pagedInbox:false,now:()=>1794934800000,rng:()=>.5});
  const teams=service.state.teams.slice(0,2),id='shared-penalty-card';
  const counters={goals:0,assists:0,saves:0,tackles:0,interceptions:0,clearances:0,blocks:0,pressuresWon:0,yellowCards:0,redCards:0};
  const report={...(v4?{schema:'v4-legacy-player-report-1'}:{}),score:[0,0],teams:teams.map((t,i)=>({id:t.id,name:t.name,formation:'4-3-3',stats:{yellowCards:0,redCards:0},players:[{id,name:'Shared card',role:'CM',position:{x:50,y:50},fitness:90,rating:6.5,stats:{...counters,penaltiesWon:i===0?1:0}}]})),importantEvents:[{type:'penaltyAwarded',opponentId:id,teamIndex:1}]};
  const fixture={id:'penalty-consumer',homeId:teams[0].id,awayId:teams[1].id,matchId:null};
  if(competition==='league')service.finalizeFixture(fixture,999,{report});else if(competition==='cup')service.finalizeCupFixture(fixture,{id:'isolated-final',stage:'final',round:1,leg:1},{report,winnerIndex:null});else service.recordSeasonFinalPlayerConsequences({...fixture,report});
  const stats=competition==='league'?service.state.playerStats:service.state.cup.playerStats;
  assert.equal(stats[`${teams[0].id}:${id}:ai`].penaltiesWon,1);
  assert.equal(stats[`${teams[1].id}:${id}:ai`].penaltiesWon,v4?0:1);
  assert.equal(verifyV4ProtectedFiles().unchangedFiles,7);
});
