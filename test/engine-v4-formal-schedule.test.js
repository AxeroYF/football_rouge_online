import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {YDL_TRAIT_CARDS} from '../versus/trait-pool.js';
import {openFormalSchedule} from '../versus/v4-host/formal-schedule.js';
import {createStreamPlayback} from '../versus/v4-stream/playback.js';

for(const [kind,store] of [['league','league.json'],['cup','shards']]){
  test('formal timer starts, resumes and settles '+kind+' once on '+store,async t=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'v4-calendar-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    let clock=Date.parse('2026-11-18T12:00:00+08:00');
    const now=()=>clock,createService=options=>new YellowDogsLeagueService(options);
    const config={statePath:path.join(dir,store),backupDir:path.join(dir,'backups'),now};
    let service=createService(config);
    if(kind==='cup')service.startCup();
    const due=clock+60000;
    service.state.season.nextRoundAt=due;
    if(kind==='cup')service.state.cup.nextRoundAt=due;
    const open=()=>openFormalSchedule({service,createService,now,duration:kind==='league'?5400:60,releaseRate:32,
      rooms:{account:id=>({id})},getCatalog:()=>({catalog:REAL_PLAYERS,traitCatalog:YDL_TRAIT_CARDS,bondCatalog:S4_BOND_CATALOG})});
    let host=await open();
    await service.tick(host);
    assert.equal(service.state.v4LocalLeagueRounds?.active,undefined);
    assert.equal(service.state.v4LocalCupEvents?.active,undefined);
    clock=due;
    const started=await service.tick(host);
    assert.equal(started.computed,8);
    assert.equal(started.complete,false);
    assert.equal(service.state.matches.length,0);
    const live=service.teamSchedule(service.state.teams[0].id).find(f=>f.status==='live');
    assert.equal(live.competition,kind);
    assert.equal(live.startsAt,due);
    assert.match(live.v4MatchId,/^v4-/);
    assert.throws(()=>service.simulateNextRound(),error=>error.statusCode===409);
    assert.equal(await service.tick(host),false);
    service=createService(config);
    host=await open();
    clock+=600000;
    const result=await service.tick(host);
    assert.equal(result.computed,0);
    assert.equal(result.settled,8);
    assert.equal(result.complete,true);
    assert.equal(result.receipt.localOnly,false);
    assert.equal(service.state.matches.length,8);
    assert.equal(new Set(service.state.matches.map(m=>m.id)).size,8);
    if(kind==='league'){
      assert.equal(service.state.season.currentRound,1);
      assert.ok(service.state.rounds[0].fixtures.every(f=>f.matchId));
    }else{
      assert.equal(service.state.cup.events[0].status,'complete');
      assert.equal(service.state.season.currentRound,0);
    }
    const reopened=createService(config);
    assert.equal(reopened.state.matches.length,8);
    assert.equal(Object.keys(reopened.state.v4LocalSettlements.receipts).length,8);
    const match=reopened.state.matches[0];
    for(const [side,teamId] of [match.homeId,match.awayId].entries()){
      const account={id:'coach-'+side};
      reopened.state.teams.find(t=>t.id===teamId).ownerId=account.id;
      const detail=await reopened.matchDetailWithReview(account,match.id);
      assert.ok(detail.tacticalReview,'settled match retains its tactical review');
      const plans=detail.tacticalReview.plans;
      assert.deepEqual(Object.keys(plans),['normal','leading','trailing']);
      assert.deepEqual(plans.normal.checks.map(c=>c.id),['pass','press','overlap','loss']);
      assert.ok(plans.normal.intervals.length);
      assert.ok(plans.normal.checks.every(c=>c.preview.samples>=0));
      for(const plan of Object.values(plans)){
        for(const check of plan.checks){
          assert.equal(plan.intervals.reduce((n,i)=>n+(i.checks[check.id]?.samples??0),0),check.samples);
          for(const span of plan.intervals){
            for(const {evidence} of Object.values(span.checks[check.id]?.occurrences??{})){
              assert.ok(evidence.time>=span.start&&evidence.time<=span.end);
              assert.equal(evidence.clock.period,span.from.period);
            }
          }
        }
      }
      const examples=Object.values(plans).flatMap(p=>p.checks.flatMap(c=>Object.values(c.occurrences).map(o=>o.evidence)));
      assert.ok(examples.length);
      const sample=examples.at(-1);
      const playback=createStreamPlayback({matchId:detail.tacticalReview.fixtureId,fetcher:async url=>{
        const last=url.split('/').at(-1);
        const packet=await reopened.matchTacticalReplay(account,match.id,last==='head'?last:Number(last));
        return {status:200,ok:true,json:async()=>packet};
      }});
      await playback.seek(sample.time);
      assert.equal(playback.state.ownerSide,side);
      assert.equal(playback.state.time,sample.time);
      assert.ok(playback.frame.players.find(p=>p.key===sample.playerKey)?.task);
      playback.close();
    }
    assert.equal((await reopened.matchDetailWithReview({id:'spectator'},match.id)).tacticalReview,undefined);
    // Reading an older report reconstructs metrics from its bound archive without
    // mutating saved scores, statistics or settlement receipts.
    const original=JSON.parse(JSON.stringify(match.report));
    delete match.report.metricDefinitions;
    for(const team of match.report.teams){delete team.stats.xg;delete team.stats.possession;}
    const migrated=await reopened.matchDetailWithReview({id:'coach-0'},match.id);
    assert.deepEqual(migrated.teams.map(t=>[t.stats.xg,t.stats.possession]),original.teams.map(t=>[t.stats.xg,t.stats.possession]));
    assert.equal(match.report.teams[0].stats.xg,undefined);
    assert.ok(migrated.v4Replay);match.report=original;
    await assert.rejects(reopened.matchTacticalReplay({id:'spectator'},match.id,'head'),{statusCode:403});
    const ref=reopened.settledReviewReference({id:'coach-0'},match);
    const job=path.join(config.statePath+'.v4-schedule',kind+'-queue-'+ref.roundKey,'jobs',ref.fixtureId);
    await fs.writeFile(path.join(job,'archive','retired.json'),JSON.stringify({matchId:ref.fixtureId}));
    assert.equal((await reopened.matchDetailWithReview({id:'coach-0'},match.id)).tacticalReview.replayAvailable,false);
    await assert.rejects(reopened.matchTacticalReplay({id:'coach-0'},match.id,'head'),{statusCode:410});
    await fs.writeFile(path.join(job,'tactical-review.json'),'{}');
    const unreadable=await reopened.matchDetailWithReview({id:'coach-0'},match.id);
    assert.deepEqual(unreadable.score,[...match.score]);
    assert.equal(unreadable.tacticalReviewUnavailable,'unreadable');
    delete match.report.v4ReviewArchive;
    assert.equal((await reopened.matchDetailWithReview({id:'coach-0'},match.id)).tacticalReviewUnavailable,true);
  });
}

test('manual advance rejects unsupported input before lock without switching engines',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'v4-calendar-coverage-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const createService=options=>new YellowDogsLeagueService(options);
  const service=createService({statePath:path.join(dir,'league.json')});
  const team=service.state.teams[0];
  team.ownerId='test-user';
  for(const playerId of team.rosterIds){
    service.state.s4Assets.cards[playerId]={id:playerId,ownerId:team.ownerId,playerId,traitIds:['test-trait']};
  }
  service.scheduledHost=await openFormalSchedule({service,createService,rooms:{account:id=>({id})},
    getCatalog:()=>({catalog:REAL_PLAYERS,traitCatalog:[{id:'test-trait',rules:[{hook:'unsupported-test-hook'}]}],bondCatalog:S4_BOND_CATALOG})});
  let calls=0;
  service.startScheduledRound=()=>{calls++;return true;};
  await assert.rejects(service.simulateNextRound(),{code:'V4_UNSUPPORTED_COVERAGE'});
  assert.equal(calls,0);
  assert.equal(service.state.rounds[0].status,'pending');
  assert.equal(service.state.v4LocalLeagueRounds,undefined);
});
