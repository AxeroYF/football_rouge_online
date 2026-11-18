import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPredictionSimulation } from '../versus/prediction-simulation.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-prediction-test-'));
process.env.YELLOWDOGS_LEAGUE_PATH=path.join(dir,'league.json');
process.env.YDL_CONTENT_OVERRIDES_PATH=path.join(dir,'content.json');
const { YellowDogsLeagueService }=await import('../versus/league-service.js');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const NOW=Date.parse('2026-11-17T10:01:00+08:00');
const create=()=>new YellowDogsLeagueService({statePath:null,backupDir:null,now:()=>NOW,rng:()=>.37});
const reports=()=>Array.from({length:24},()=>({score:[1,0],halfTimeScore:[0,0],regulationScore:[1,0],events:[],teams:[{stats:{xg:1,yellowCards:1,redCards:0}},{stats:{xg:.5,yellowCards:0,redCards:0}}]}));
function deferredService(){
  const service=create();service.ensurePredictionMarkets(0);
  let complete,calls=0;
  service.runPredictionSimulation=()=>{calls++;return new Promise(resolve=>{complete=resolve;});};
  const entry=service.nextPredictionFixtures()[0];
  service.startPredictionMarketGeneration(entry);
  return {service,entry,job:service.predictionGenerationJob,complete:()=>complete(reports()),calls:()=>calls};
}

test('worker preserves all 24 seeded samples and prices for player league and cup, without blocking timers',async()=>{
  const service=create(),user={id:'prediction-worker-user',nickname:'预测测试'};
  service.beginDraft(user,'测试队');service.autoDraft(user);service.finishDraft(user);service.startCup();
  service.ensurePredictionMarkets(0);
  const league=service.nextPredictionFixtures().find(e=>e.competition==='league'&&[e.fixture.homeId,e.fixture.awayId].includes(service.accountTeam(user.id).id));
  const cup=service.nextPredictionFixtures().find(e=>e.competition==='cup');
  const second={...cup,id:cup.id+':second',matchOptions:{...cup.matchOptions,legNumber:2,regulationOnly:false,aggregateBaseScore:[1,0]}};
  for(const entry of [league,cup,second]){
    const beforeTeams=structuredClone(service.state.teams);
    const matches=[],originalCreate=service.createFixtureMatch.bind(service);
    service.createFixtureMatch=(...args)=>{const created=originalCreate(...args);matches.push(created.match);return created;};
    const expected=service.generatePredictionMarket(entry);
    service.createFixtureMatch=originalCreate;
    service.state.teams=beforeTeams;
    const stateBefore=JSON.stringify([service.state.teams,service.state.wallets,service.state.ledger]);
    service.state.matchPredictions.markets[entry.id]={status:'preparing'};
    const input=service.prepareFixtureMatch(entry.fixture,entry.round,entry.startsAt,{...entry.matchOptions,recordEvents:false,matchEngine:'v1',snapshotTeams:true});
    let ticks=0;const interval=setInterval(()=>ticks++,10);
    let actualReports;
    try{actualReports=await runPredictionSimulation({seats:input.seats,options:input.matchOptions,marketId:entry.id,samples:24});}finally{clearInterval(interval);}
    assert.ok(ticks>5,'main thread timers must continue while simulations run');
    assert.deepEqual(actualReports,matches.map(({report})=>({score:report.score,halfTimeScore:report.halfTimeScore,regulationScore:report.regulationScore,events:report.events,
      teams:report.teams.map(({stats})=>({stats:{xg:stats.xg,yellowCards:stats.yellowCards,redCards:stats.redCards}}))})), 'every seeded score and statistic must match');
    assert.deepEqual(service.generatePredictionMarket(entry,actualReports),expected);
    assert.equal(JSON.stringify([service.state.teams,service.state.wallets,service.state.ledger]),stateBefore,'forecast never changes game state');
  }
});

test('background generation deduplicates concurrent ticks and publishes once',async()=>{
  const {service,entry,job,complete,calls}=deferredService();
  let saves=0;service.save=()=>saves++;
  for(let n=0;n<5;n++)service.ensurePredictionMarkets(1,{background:true});
  assert.equal(calls(),1);assert.equal(service.state.matchPredictions.markets[entry.id].status,'preparing');
  complete();assert.equal(await job.promise,true);
  assert.equal(service.state.matchPredictions.markets[entry.id].simulation.samples,24);
  assert.equal(saves,1);assert.equal(service.predictionGenerationJob,null);
});

test('successful asynchronous publication advances the client revision and keeps locked bet odds',async()=>{
  const service=create(),user={id:'async-bet-user',nickname:'异步预测'};
  service.beginDraft(user,'异步预测队');service.autoDraft(user);service.finishDraft(user);service.ensurePredictionMarkets(0);
  const entry=service.nextPredictionFixtures().find(e=>![e.fixture.homeId,e.fixture.awayId].includes(service.accountTeam(user.id).id));
  const revision=service.predictionView(user).updatedAt,teamsBefore=JSON.stringify(service.state.teams);
  service.runPredictionSimulation=async()=>reports();service.startPredictionMarketGeneration(entry);
  assert.equal(await service.predictionGenerationJob.promise,true);
  const view=service.predictionView(user);
  assert.ok(view.updatedAt>revision);assert.equal(view.matchPredictions.find(m=>m.id===entry.id).eligible,true);
  assert.equal(JSON.stringify(service.state.teams),teamsBefore);
  const market=service.state.matchPredictions.markets[entry.id],rate=market.payoutRates.result.home;
  service.placeMatchPrediction(user,entry.id,'result','home',100);
  market.pricingVersion=0;service.ensurePredictionMarkets(0);
  assert.equal(market.status,'open');assert.equal(service.state.matchPredictions.bets[0].payoutRate,rate);
  assert.equal(service.predictionGenerationJob,null);
});

for(const boundary of ['deadline','season','replacement','reschedule','takeover','settled'])test(`discard background result after ${boundary}`,async()=>{
  const {service,entry,job,complete}=deferredService();
  let saves=0;service.save=()=>saves++;
  if(boundary==='deadline')service.now=()=>service.predictionClosesAt(entry.startsAt);
  if(boundary==='season')service.state.season.id+='-new';
  if(boundary==='replacement')service.state.matchPredictions.markets={};
  if(boundary==='reschedule')service.state.season.nextRoundAt+=60000;
  if(boundary==='takeover')service.state.teams.find(t=>t.id===entry.fixture.homeId).ownerId='new-owner';
  if(boundary==='settled')service.state.matchPredictions.markets[entry.id].status='settled';
  complete();assert.equal(await job.promise,false);assert.equal(saves,0);assert.equal(service.predictionGenerationJob,null);
  if(boundary==='deadline'){
    service.ensurePredictionMarkets(1,{background:true});
    assert.equal(service.state.matchPredictions.markets[entry.id].status,'locked');
    assert.equal(service.predictionGenerationJob,null);
  }
});

test('worker or persistence failure keeps preparing, releases slot and backs off for retry',async()=>{
  for(const failure of ['worker','save']){
    const service=create();service.ensurePredictionMarkets(0);
    const entry=service.nextPredictionFixtures()[0];
    service.runPredictionSimulation=async()=>{if(failure==='worker')throw Error('test worker failure');return reports();};
    const originalSave=service.save.bind(service);
    if(failure==='save')service.save=()=>{throw Error('test save failure');};
    service.startPredictionMarketGeneration(entry);assert.equal(await service.predictionGenerationJob.promise,false);
    assert.equal(service.state.matchPredictions.markets[entry.id].status,'preparing');
    assert.equal(service.startPredictionMarketGeneration(entry),false);
    service.now=()=>NOW+61000;service.save=originalSave;service.runPredictionSimulation=async()=>reports();
    assert.equal(service.startPredictionMarketGeneration(entry),true);assert.equal(await service.predictionGenerationJob.promise,true);
  }
});

test('bet requests never synchronously generate a market or debit a preparing market',()=>{
  const service=create(),user={id:'bet-user',nickname:'投注测试'};
  service.beginDraft(user,'投注队');service.autoDraft(user);service.finishDraft(user);service.ensurePredictionMarkets(0);
  const entry=service.nextPredictionFixtures().find(e=>![e.fixture.homeId,e.fixture.awayId].includes(service.accountTeam(user.id).id));
  const balance=service.wallet(user.id).balance;
  service.generatePredictionMarket=()=>{throw Error('synchronous generation forbidden');};
  assert.throws(()=>service.placeMatchPrediction(user,entry.id,'result','home',100),/正在准备/);
  assert.equal(service.wallet(user.id).balance,balance);assert.equal(service.state.matchPredictions.bets.length,0);
  service.state.matchPredictions.markets={};
  service.now=()=>service.predictionClosesAt(entry.startsAt);
  service.ensurePredictionMarkets(0);
  assert.ok(Object.values(service.state.matchPredictions.markets).every(m=>m.status==='locked'),'new registration at deadline cannot remain preparing');
});

test('one failed fixture does not hold up preparation of the other markets',async()=>{
  const service=create();service.ensurePredictionMarkets(0);
  const [first,second]=service.nextPredictionFixtures();
  service.runPredictionSimulation=async()=>{throw Error('test fixture failure');};
  service.startPredictionMarketGeneration(first);await service.predictionGenerationJob.promise;
  service.runPredictionSimulation=async()=>reports();
  service.ensurePredictionMarkets(1,{background:true});
  assert.equal(service.predictionGenerationJob.id,second.id);
  assert.equal(await service.predictionGenerationJob.promise,true);
  assert.equal(service.state.matchPredictions.markets[first.id].status,'preparing');
});

test('worker errors and timeouts reject without a main-thread fallback',async()=>{
  await assert.rejects(runPredictionSimulation({samples:24}),/./);
  const forever=new URL('data:text/javascript,await new Promise(() => setInterval(() => {}, 1000))');
  await assert.rejects(runPredictionSimulation({samples:24},{workerUrl:forever,timeoutMs:100}),/超时/);
});
