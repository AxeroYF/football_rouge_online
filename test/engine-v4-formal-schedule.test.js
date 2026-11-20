import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {YellowDogsLeagueService,S4_BOND_CATALOG} from '../versus/league-service.js';
import {REAL_PLAYERS} from '../versus/player-pool.js';
import {YDL_TRAIT_CARDS} from '../versus/trait-pool.js';
import {openFormalSchedule} from '../versus/v4-host/formal-schedule.js';
import {expireSeasonReplays} from '../versus/v4-host/goal-clips.js';

for(const [kind,store] of [['league','league.json'],['cup','shards']]){
  test('formal timer starts, resumes and settles '+kind+' once on '+store,async t=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'v4-calendar-'));
    t.after(()=>fs.rm(dir,{recursive:true,force:true}));
    let clock=Date.parse('2026-11-18T12:00:00+08:00');
    const now=()=>clock,createService=options=>new YellowDogsLeagueService(options);
    const config={statePath:path.join(dir,store),backupDir:path.join(dir,'backups'),now};
    let service=createService(config);
    if(kind==='league')service.state.season.id='weather-league-24';
    if(kind==='cup')service.startCup();
    const due=clock+60000;
    service.state.season.nextRoundAt=due;
    if(kind==='cup')service.state.cup.nextRoundAt=due;
    const open=()=>openFormalSchedule({service,createService,now,duration:kind==='league'?5400:60,releaseRate:32,
      rooms:{account:id=>({id})},getCatalog:()=>({catalog:REAL_PLAYERS,traitCatalog:YDL_TRAIT_CARDS,bondCatalog:S4_BOND_CATALOG})});
    let host=await open();
    const forecasts=new Map(service.state.teams.map(team=>[team.id,
      service.teamSchedule(team.id).find(f=>f.competition===kind).weather]));
    async function responseFor(id,route){
      const response={setHeader(){},writeHead(status){this.status=status;},end(body){this.data=JSON.parse(body);}};
      await host.handle({url:'/v4/matches/'+id+'/'+route,method:'GET',headers:{authorization:'Bearer test','x-player-id':'spectator'}},response);
      return response;
    }
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
    const listings=service.scheduledBroadcasts();
    assert.equal(listings.length,8);
    const viewed=new Set();
    for(const team of service.state.teams){
      const fixture=service.teamSchedule(team.id).find(f=>f.status==='live'&&f.competition===kind);
      if(viewed.has(fixture.v4MatchId))continue;
      viewed.add(fixture.v4MatchId);
      const onAir=await responseFor(fixture.v4MatchId,'broadcast');
      assert.equal(onAir.status,200);
      assert.deepEqual(onAir.data.match.weather,forecasts.get(team.id));
      const listing=listings.find(entry=>entry.v4MatchId===fixture.v4MatchId);
      assert.deepEqual(listing.teams,onAir.data.match.teams.map(({id,name})=>({id,name})));
      assert.deepEqual(listing.weather,onAir.data.match.weather);
      assert.deepEqual((await responseFor(fixture.v4MatchId,'scoreboard')).data,
        {minute:onAir.data.match.minute,score:onAir.data.match.score});
    }
    assert.equal(viewed.size,8);
    assert.throws(()=>service.simulateNextRound(),error=>error.statusCode===409);
    assert.equal(await service.tick(host),false);
    service=createService(config);
    host=await open();
    clock+=600000;
    const result=await service.tick(host);
    assert.equal(result.computed,0);
    assert.equal(result.settled,8);
    assert.deepEqual(service.scheduledBroadcasts(),[]);
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
    for(const settled of reopened.state.matches){
      const expected=forecasts.get(settled.homeId);
      assert.deepEqual(settled.report.weather,expected);
      assert.deepEqual((await responseFor(settled.report.fixtureId,'broadcast')).data.match.weather,expected);
    }
    if(kind==='league'){
      const storm=reopened.state.matches.find(m=>m.report.weather.key==='superStorm');
      assert.ok(storm?.report.stoppedAtMinute>=61&&storm.report.stoppedAtMinute<=89);
      assert.deepEqual(storm.score,storm.report.regulationScore);
      assert.equal((await responseFor(storm.report.fixtureId,'broadcast')).data.match.minute,storm.report.stoppedAtMinute);
    }
    assert.equal(Object.keys(reopened.state.v4LocalSettlements.receipts).length,8);
    const match=reopened.state.matches.find(m=>m.report.importantEvents.some(e=>e.type==='goal'))??reopened.state.matches[0];
    const finalResponse=route=>responseFor(match.report.fixtureId,route);
    const broadcast=await finalResponse('broadcast');
    assert.equal(broadcast.status,200);
    assert.deepEqual(broadcast.data.match.score,match.score);
    assert.equal(broadcast.data.match.phase,'finished');
    assert.equal(broadcast.data.match.v4Replay,undefined);
    assert.deepEqual(broadcast.data.match.keyPlays.map(c=>c.eventId),match.report.importantEvents.filter(e=>e.type==='goal'||e.shootoutGoal).map(e=>e.id));
    assert.equal((await finalResponse('segments/0')).status,410);
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
      assert.equal(detail.tacticalReview.replayAvailable,false);
      assert.equal(detail.v4Replay,undefined);
      assert.deepEqual(detail.keyPlays.map(c=>c.eventId),match.report.importantEvents.filter(e=>e.type==='goal'||e.shootoutGoal).map(e=>e.id));
      for(const clip of detail.keyPlays){
        assert.ok(clip.frames.length>=2);
        assert.ok(clip.frames.every(f=>f.time>=clip.replayTime-13&&f.time<=clip.replayTime+2));
        assert.ok(clip.frames.every(f=>f.players.every(p=>!('task' in p))));
      }
      assert.ok(detail.teams.every(t=>Number.isFinite(t.stats.xg)&&Number.isFinite(t.stats.possession)));
    }
    assert.equal((await reopened.matchDetailWithReview({id:'spectator'},match.id)).tacticalReview,undefined);
    await assert.rejects(reopened.matchTacticalReplay({id:'spectator'},match.id,'head'),{statusCode:403});
    const ref=reopened.settledReviewReference({id:'coach-0'},match);
    const job=path.join(config.statePath+'.v4-schedule',kind+'-queue-'+ref.roundKey,'jobs',ref.fixtureId);
    await assert.rejects(fs.access(path.join(job,'archive')),{code:'ENOENT'});
    expireSeasonReplays(reopened,'unrelated-season');
    await fs.access(path.join(job,'goal-clips.json.gz'));
    const nextDay=createService(config);
    clock+=86400000;
    nextDay.restartSeason();
    assert.notEqual(nextDay.state.season.id,reopened.state.season.id);
    await assert.rejects(fs.access(path.join(job,'goal-clips.json.gz')),{code:'ENOENT'});
    const restarted=createService(config);
    t.mock.method(restarted,'accountTeam',id=>reopened.accountTeam(id));
    const expired=await restarted.matchDetailWithReview({id:'coach-0'},match.id);
    assert.equal(expired.archived,true);
    assert.deepEqual(expired.keyPlays,[]);
    assert.deepEqual(expired.score,match.score);
    assert.deepEqual(expired.teams.map(t=>[t.stats.xg,t.stats.possession]),match.report.teams.map(t=>[t.stats.xg,t.stats.possession]));
    assert.equal(expired.tacticalReview.replayAvailable,false);
    await assert.rejects(restarted.matchTacticalReplay({id:'coach-0'},match.id,'head'),{statusCode:410});
    expireSeasonReplays(restarted,reopened.state.season.id);
    await fs.writeFile(path.join(job,'tactical-review.json'),'{}');
    const unreadable=await reopened.matchDetailWithReview({id:'coach-0'},match.id);
    assert.deepEqual(unreadable.score,[...match.score]);
    assert.equal(unreadable.tacticalReviewUnavailable,'unreadable');
    delete match.report.v4ReviewArchive;
    assert.equal((await reopened.matchDetailWithReview({id:'coach-0'},match.id)).tacticalReviewUnavailable,true);
  });
}

test('daily reset backup retains inline goal clips from the outgoing season',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'v4-reset-backup-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const backupDir=path.join(dir,'backups');
  const service=new YellowDogsLeagueService({statePath:path.join(dir,'league.json'),backupDir});
  const finished={score:[2,1],keyPlays:[{eventId:'v4-1',frames:[]}]};
  service.state.completedBroadcasts.push({code:'ended',match:{...finished,report:{...finished}}});
  service.state.season.status="completed";
  service.state.cup.status="completed";
  service.save({forceFull:true,skipDailyBackup:true});
  service.resetDailyCompetitions({manual:true});
  const backup=(await fs.readdir(backupDir)).find(name=>name.startsWith('before-daily-reset-'));
  const snapshot=JSON.parse(await fs.readFile(path.join(backupDir,backup),'utf8'));
  const match=snapshot.completedBroadcasts.find(row=>row.code==='ended').match;
  assert.deepEqual(match.score,[2,1]);
  assert.deepEqual(match.keyPlays,finished.keyPlays);
  assert.deepEqual(match.report.keyPlays,finished.keyPlays);
});

test('season replay cleanup accepts a differently cased Windows save path',{skip:process.platform!=='win32'},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'v4-reset-case-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'league.json'),alias=path.join(dir,'LEAGUE.JSON');
  await fs.writeFile(statePath,'{}');
  try{await fs.access(alias);}catch(error){
    if(error.code!=='ENOENT')throw error;
    return t.skip('temporary volume is case-sensitive');
  }
  const key='a'.repeat(64),id='v4-'+'b'.repeat(32)+'-1';
  const round={key,seasonId:'previous',status:'complete',tasks:[{fixture:{id}}]};
  const state={season:{id:'current'},v4LocalLeagueRounds:{rounds:{[key]:round}}};
  const job=path.join(statePath+'.v4-schedule','league-queue-'+key,'jobs',id);
  await fs.mkdir(job,{recursive:true});
  await fs.writeFile(path.join(job,'goal-clips.json.gz'),'clip');
  await fs.writeFile(path.join(job,'tactical-review.json'),'{}');
  expireSeasonReplays({statePath:alias,state},round.seasonId);
  await assert.rejects(fs.access(path.join(job,'goal-clips.json.gz')),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(job,'tactical-review.json'),'utf8'),'{}');
});

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
