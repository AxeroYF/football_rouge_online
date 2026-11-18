import test from 'node:test';
import assert from 'node:assert/strict';
import {applySeasonBoundary,seasonBoundaryField} from '../versus/v4-host/season-boundary.js';

import {at,createService,completedSeason} from './v4-season-boundary-fixture.js';

test('season rewards and reset return one complete pure state, preserve assets and deduplicate even after the season changes',()=>{
  const league=completedSeason(),before=structuredClone(league),request={league,seasonId:league.season.id,at:at+86400000,createService};
  assert.throws(()=>applySeasonBoundary({...request,phase:'reset'}),/奖励回执/);
  const rewarded=applySeasonBoundary({...request,phase:'rewards'});assert.deepEqual(league,before);assert.equal(rewarded.receipt.phase,'rewards');assert.equal(rewarded.league.dailyAutomation.lastRewardedSeasonId,league.season.id);
  assert.equal(rewarded.league.ledger.filter(row=>row.type==='daily-season-settlement').length,2);
  const duplicate=applySeasonBoundary({...request,league:rewarded.league,phase:'rewards'});assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.league,rewarded.league);
  const reset=applySeasonBoundary({...request,league:rewarded.league,phase:'reset'});assert.notEqual(reset.league.season.id,league.season.id);assert.equal(reset.league.season.currentRound,0);assert.equal(reset.league.rounds.length,14);assert.equal(reset.league.cup.status,'waiting');assert.equal(reset.league.seasonFinalTournament,null);
  assert.equal(reset.league.archives.at(-1).matches.length,141);assert.equal(reset.league.competitionFormat.movements.length,1);assert.equal(reset.league.honorRoom.processedSeasonIds.filter(id=>id===league.season.id).length,1);
  assert.deepEqual(reset.league.wallets,rewarded.league.wallets);assert.deepEqual(reset.league.s4Packs,rewarded.league.s4Packs);
  for(const phase of ['rewards','reset']){const retry=applySeasonBoundary({...request,league:reset.league,phase});assert.equal(retry.duplicate,true);assert.deepEqual(retry.league,reset.league);}
  assert.equal(Object.keys(reset.league[seasonBoundaryField].receipts).length,2);
});

test('season boundary refuses unfinished fixtures, cup and active work before applying original business effects',()=>{
  const original=completedSeason();
  for(const mutate of [state=>state.rounds[0].status='running',state=>state.rounds[0].fixtures[0].matchId='missing',state=>state.cup.status='active',state=>state.v4LocalCupEvents={active:'cup'},state=>state.liveRound={},state=>state.teams[0].table.played=13]){
    const league=structuredClone(original);mutate(league);const before=structuredClone(league);
    assert.throws(()=>applySeasonBoundary({league,seasonId:league.season.id,phase:'rewards',at,createService}));assert.deepEqual(league,before);
  }
});
