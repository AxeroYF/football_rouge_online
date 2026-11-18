import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openSandboxJournal} from '../versus/v4-rollout/sandbox-journal.js';
import {createCanonicalShadowSettlement,openCanonicalShadowSettlement} from '../versus/v4-host/shadow-settlement.js';

// Guard every persistence path before importing modules with singleton writers.
const root=fs.realpathSync(process.env.V4_CANONICAL_SANDBOX??'');
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8')).format,'v4-canonical-settlement-proof-1');
for(const key of ['VERSUS_ACCOUNTS_PATH','YELLOWDOGS_LEAGUE_PATH','YDL_CONTENT_OVERRIDES_PATH','YDL_PLAYER_CARD_STUDIO_PATH','YDL_PLAYER_PROFILE_ROOT']){
  assert.ok(process.env[key],`Missing isolated ${key}`);
  const relative=path.relative(root,path.resolve(process.env[key]));assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),`Unsafe ${key}`);
}
await import('../versus/ydl-content-store.js');
const {YellowDogsLeagueService,yellowDogsLeague}=await import('../versus/league-service.js');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finite=value=>{if(typeof value==='number')assert.ok(Number.isFinite(value));else if(value&&typeof value==='object')Object.values(value).forEach(finite);};
const tasks=JSON.parse(fs.readFileSync(path.join(root,'tasks.json'),'utf8')),summaries=[];
for(const task of tasks){
  const job=await openSandboxJournal(path.join(root,task.job,'journal')),pinned=(await job.read()).fixtures[task.fixtureId],result=pinned.result.value,report=result.report;
  assert.equal(result.settlementAllowed,false);assert.equal(report.settlementAllowed,false);
  const initial=structuredClone(yellowDogsLeague.state),round=999;
  const fixture={id:task.fixtureId,homeId:report.teams[0].id,awayId:report.teams[1].id,matchId:null};
  const event={id:`isolated-${task.label}`,stage:'final',round:1,leg:1};
  const service=new YellowDogsLeagueService({statePath:null,backupDir:null,pagedInbox:false,now:()=>1794934800000,rng:()=>.5});
  service.state=initial;
  // Use the real prediction settlement consumer with an empty test market.
  // No prediction simulations, samples, prices or real bets are changed.
  const marketId=service.predictionMarketId(task.competition,task.competition==='league'?`R${round}`:event.id,fixture);
  initial.matchPredictions.markets[marketId]={id:marketId,resultHandicap:0,status:'open'};
  let calls=0,failBeforeCommit=true;
  const createService=options=>{
    const instance=new YellowDogsLeagueService(options);
    for(const name of ['finalizeFixture','finalizeCupFixture']){const original=instance[name];instance[name]=function(...args){calls++;const result=original.apply(this,args);if(failBeforeCommit)throw new Error('simulated pre-commit interruption');return result;};}
    return instance;
  };
  const store=await createCanonicalShadowSettlement(path.join(root,`settlement-${task.label}`),{initialState:initial,createService,now:()=>1794934800000});
  const before=await store.read(),context={competition:task.competition,round:task.competition==='league'?round:event.round,event},jobDirectory=path.join(root,task.job);
  await assert.rejects(store.settleJob(jobDirectory,context),/pre-commit/);
  assert.equal(hash((await store.read()).state),hash(before.state));assert.deepEqual((await store.read()).receipts,{});
  failBeforeCommit=false;await store.settleJob(jobDirectory,context);const after=await store.read(),callsBeforeRetry=calls,settledState=after.state.league;
  const reopened=await openCanonicalShadowSettlement(path.join(root,`settlement-${task.label}`),{createService});
  assert.equal((await reopened.settleJob(jobDirectory,context)).duplicate,true);assert.equal(calls,callsBeforeRetry);
  await assert.rejects(reopened.settleJob(jobDirectory,{...context,round:context.round+1,...(task.competition==='cup'?{event:{...event,round:context.round+1}}:{})}),/不同结算上下文/);
  assert.equal(hash((await reopened.read()).state),hash(after.state));assert.equal(settledState.matches.length,initial.matches.length+1);
  assert.equal(after.state.fixtures[task.fixtureId].matchId,settledState.matches.at(-1).id);
  const market=settledState.matchPredictions.markets[marketId];
  assert.deepEqual(market.settlement.halfTimeScore,report.halfTimeScore);assert.deepEqual(market.settlement.regulationScore,report.regulationScore);
  const target=task.competition==='league'?'playerStats':null;
  const beforeStats=target?initial.playerStats:initial.cup.playerStats,afterStats=target?settledState.playerStats:settledState.cup.playerStats;
  let played=0;
  for(const [side,team] of report.teams.entries()){
    const prior=initial.teams.find(t=>t.id===team.id),updated=settledState.teams.find(t=>t.id===team.id);
    if(task.competition==='league'){
      assert.equal(updated.table.played,prior.table.played+1);assert.equal(updated.table.goalsFor,prior.table.goalsFor+report.score[side]);
    }
    for(const player of team.players){
      played++;const key=`${team.id}:${player.id}${prior.ownerId?'':':ai'}`;
      assert.equal(afterStats[key].appearances,(beforeStats[key]?.appearances??0)+1);
      for(const field of ['goals','assists','saves','tackles','interceptions','clearances','blocks','pressuresWon','penaltiesWon','yellowCards','redCards'])assert.equal(afterStats[key][field],(beforeStats[key]?.[field]??0)+player.stats[field],`${task.competition}/${field}`);
      assert.ok(Number.isFinite(afterStats[key].ratingTotal));
      if(updated.playerState[player.id])assert.ok(updated.playerState[player.id].fitness>=35&&updated.playerState[player.id].fitness<=100);
    }
    for(const player of pinned.input.teams[side].bench.filter(p=>!team.players.some(q=>q.id===p.id))){
      const key=`${team.id}:${player.id}${prior.ownerId?'':':ai'}`;assert.deepEqual(afterStats[key],beforeStats[key]);
    }
  }
  finite(after.state);
  if(report.penalties)assert.deepEqual(settledState.matches.at(-1).penalties,report.penalties);
  summaries.push({label:task.label,competition:task.competition,score:report.score,penalties:report.penalties,halfTimeScore:report.halfTimeScore,regulationScore:report.regulationScore,playedPlayers:played,exactlyOnce:true,preCommitRollback:true,predictionConsumerCompatible:true,formalSaveChanged:false});
}
const report={passed:true,scope:'Canonical league and cup finalizers inside isolated cloned state; receipt and state committed atomically by sandbox journal. Not a production settlement bridge.',summaries};
fs.writeFileSync(path.join(root,'canonical-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
