import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createShadowSeason,shadowSchedule,applyShadowRound,shadowSummary} from '../versus/v4-adapter/shadow-season.js';

test('division shadow schedule covers every directed pair once and evolves only its isolated state',()=>{
  const source={fingerprint:'original',season:{id:'season'},teams:Array.from({length:16},(_,i)=>({id:`t${i}`,division:i<8?'A':'B',rosterIds:['p1','p2','p3'],playerState:{p1:{fitness:100},p2:{fitness:80},p3:{fitness:70,injuryRounds:2,suspension:2}}}))};
  const original=JSON.stringify(source),shadow=createShadowSeason(source),rounds=shadowSchedule(shadow),pairs=rounds.flatMap(r=>r.fixtures.map(f=>`${f.homeId}:${f.awayId}`));
  assert.equal(rounds.length,14);assert.equal(pairs.length,112);assert.equal(new Set(pairs).size,112);
  for(const round of rounds)assert.equal(new Set(round.fixtures.flatMap(f=>[f.homeId,f.awayId])).size,16);
  const results=rounds[0].fixtures.map((f,i)=>{const input={fixtureId:`r1-${i}`,teams:[{id:f.homeId},{id:f.awayId}]};return {envelope:{sourceFingerprint:shadow.fingerprint,engineVersion:'test',input,fingerprint:createHash('sha256').update(JSON.stringify({engineVersion:'test',input})).digest('hex')},state:{phase:'finished',version:'test',input,score:[2,1],players:[0,1].flatMap(side=>[
    {id:'p1',side,role:'CM',status:'playing',fitness:90,injury:side===0?{unableToContinue:true}:null},{id:'p2',side,role:'GK',status:side===1?'sentOff':'playing',fitness:70}])}};});
  const next=applyShadowRound(shadow,1,results),home=next.teams.find(t=>t.id===rounds[0].fixtures[0].homeId),away=next.teams.find(t=>t.id===rounds[0].fixtures[0].awayId);
  assert.equal(home.playerState.p1.fitness,96.4);assert.equal(home.playerState.p2.fitness,78.2);assert.equal(home.playerState.p3.fitness,88);
  assert.equal(home.playerState.p1.injuryRounds,1);assert.equal(home.playerState.p3.injuryRounds,1);assert.equal(away.playerState.p2.suspension,1);
  assert.equal(home.table.points,3);assert.equal(shadowSummary(next).standings.length,16);assert.equal(JSON.stringify(source),original);assert.equal(shadow.shadow.round,0);
  assert.throws(()=>applyShadowRound(next,1,results),/轮次/);
});
