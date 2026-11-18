import test from 'node:test';
import assert from 'node:assert/strict';
import {competitionPresentation} from '../versus/v4-host/competition-presentation.js';
import {createStreamPlayback} from '../versus/v4-stream/playback.js';

test('cup presentation uses the current frame for aggregate, shootout and winner without revealing a future result',()=>{
  const competition={kind:'cup',stage:'quarterfinals',leg:2,aggregate:[1,2]},teams=[{name:'甲'},{name:'乙'}],frame={score:[2,0],phase:'playing'};
  assert.deepEqual(competitionPresentation(null,competition,teams),{label:'黄狗冠军杯 · 四分之一决赛 · 第2回合',aggregate:'',shootout:'',decision:''});
  assert.equal(competitionPresentation(frame,competition,teams).aggregate,'总比分 3 : 2');assert.equal(competitionPresentation(frame,competition,teams).decision,'');
  assert.equal(competitionPresentation({...frame,phase:'finished'},competition,teams).decision,'甲晋级');
  const shootout={score:[3,4],winner:1,active:false},final={kind:'cup',stage:'final',leg:1,aggregate:[0,0]};
  const decided=competitionPresentation({score:[0,0],phase:'finished',shootout},final,teams);assert.equal(decided.shootout,'点球 3 : 4');assert.equal(decided.decision,'乙夺冠');assert.equal(decided.aggregate,'');
  assert.equal(competitionPresentation({score:[0,0],phase:'shootout',shootout:{...shootout,winner:null,active:true}},final,teams).decision,'');
  assert.equal(competitionPresentation({score:[0,0],phase:'finished',shootout},{...final,stage:'swiss'},teams).decision,'乙获胜');
  assert.equal(competitionPresentation({...frame,phase:'finished'},null,teams).decision,'');
});

test('playback pins immutable public cup metadata and exposes defensive copies',async()=>{
  let competition={kind:'cup',stage:'semifinals',leg:2,aggregate:[1,2]};
  const client=createStreamPlayback({matchId:'cup',fetcher:async()=>({ok:true,json:async()=>({matchId:'cup',engineVersion:'proof',ownerSide:null,publishedThrough:-1,segments:[],competition:structuredClone(competition)})})});
  await client.refresh();client.state.competition.aggregate[0]=99;assert.equal(client.state.competition.aggregate[0],1);
  competition.aggregate[0]=2;await assert.rejects(client.refresh(),/身份/);assert.equal(client.state.competition.aggregate[0],1);
  competition.aggregate[0]=-1;await assert.rejects(client.refresh(),/发布信息/);client.close();assert.equal(client.state.competition,null);
});
