import test from 'node:test';
import assert from 'node:assert/strict';
import {leagueFixture} from './daily-league-fixture.mjs';
import {supplementLeagueRegistration,DailyLeagueService} from '../server/application/daily-league-service.mjs';
import {enhancementFamily} from '../shared/config/enhancement.mjs';
import {buildAccountMatchSeat} from '../shared/football/account-match-seat.mjs';

const today=t=>{t.f.tick(Date.parse('2026-09-30T09:49:00+08:00')-t.f.now);t.start();};
test('short player registration keeps original cards and fills to 15 by true enhanced overall, without duplicate families',()=>{
 const {f}=leagueFixture(),a=f.a,before=structuredClone(a),initial=[...a.leagueRegistration.playerIds];
 const candidates=a.draft.roster.filter(p=>!initial.includes(p.id));
 candidates.forEach((p,i)=>{p.effectiveOverall=200-i;p.overall=50+i;});
 a.draft.roster.push({...structuredClone(candidates[0]),id:'enhanced-duplicate',effectiveOverall:250,upgradeLevel:8});
 a.draft.roster.push({...structuredClone(a.draft.roster.find(p=>p.id===initial[0])),id:'registered-duplicate',effectiveOverall:999});
 const next=supplementLeagueRegistration(a,f.now);
 assert.deepEqual(next.playerIds.slice(0,initial.length),initial);assert.equal(next.playerIds.length,15);
 assert.deepEqual(next.playerIds.slice(initial.length),['enhanced-duplicate',...candidates.slice(1,4).map(p=>p.id)]);
 assert.equal(new Set(next.playerIds.map(id=>enhancementFamily(a.draft.roster.find(p=>p.id===id)))).size,15);
 assert.deepEqual(a.leagueRegistration,before.leagueRegistration);assert.deepEqual(a.playerSquads,before.playerSquads);assert.deepEqual(a.tactics,before.tactics);
});
test('supplement preserves league health including previously unregistered cards; external health is independent',()=>{
 const {f}=leagueFixture(),a=f.a,existing=a.leagueRegistration.playerIds[0],candidate=a.draft.roster.find(p=>!a.leagueRegistration.playerIds.includes(p.id));
 candidate.effectiveOverall=999;candidate.state={fitness:1,injury:{matchesRemaining:9}};candidate.training={id:'training'};
 a.leagueRegistration.conditions[existing]={state:{fitness:30,injury:{matchesRemaining:2}},at:f.now};
 a.leagueRegistration.conditions[candidate.id]={state:{fitness:50,injury:{matchesRemaining:1}},at:f.now};
 const next=supplementLeagueRegistration(a,f.now);
 assert.deepEqual(next.conditions[existing],a.leagueRegistration.conditions[existing]);assert.deepEqual(next.conditions[candidate.id],a.leagueRegistration.conditions[candidate.id]);
 const fresh=next.playerIds.find(id=>!a.leagueRegistration.conditions[id]);assert.equal(next.conditions[fresh].state.fitness,100);assert.equal(candidate.state.fitness,1);
});
test('15 or more registrations stay unchanged; insufficient owned unique cards stop naturally',()=>{
 const {f}=leagueFixture(),a=f.a;a.leagueRegistration.playerIds=a.draft.roster.slice(0,18).map(p=>p.id);assert.equal(supplementLeagueRegistration(a,f.now),null);
 a.leagueRegistration.playerIds=a.leagueRegistration.playerIds.slice(0,5);a.draft.roster=a.draft.roster.slice(0,10);
 const next=supplementLeagueRegistration(a,f.now);assert.equal(next.playerIds.length,10);assert.equal(supplementLeagueRegistration({...a,leagueRegistration:next},f.now),null);
});
test('empty registration can recover a playable starting eleven, keeper and bench without touching tactical sliders',()=>{
 const {f}=leagueFixture(),a=f.a;a.leagueRegistration.playerIds=[];a.leagueRegistration.tactics={starters:[],tacticalBars:{tempo:83},planSnapshots:{__s4V2:{starters:[],fitnessThreshold:60}}};
 const next=supplementLeagueRegistration(a,f.now);assert.equal(next.playerIds.length,15);assert.equal(next.tactics.tacticalBars.tempo,83);
 a.leagueRegistration=next;const seat=buildAccountMatchSeat(a,'league',f.now,{fitness:true});assert.equal(seat.players.length,15);assert.equal(seat.players.filter(p=>p.active!==false).length,11);assert.equal(seat.players.filter(p=>p.active!==false&&p.pool==='GK').length,1);
});
test('daily preparation occurs once before the first match and persists with the schedule',()=>{
 const t=leagueFixture(),{f}=t;f.tick(60000);t.league.ensureDay();assert.equal(t.league.prepareRegistrations(),false);assert.equal(f.a.leagueRegistration.playerIds.length,11);
 f.tick(600000);assert.equal(t.league.prepareRegistrations(),true);assert.equal(f.a.leagueRegistration.playerIds.length,15);
 const day=t.league.day,teams=structuredClone(day.teams),stamp=day.registrationMinimumCheckedAt;f.s.persist=()=>{throw Error('unexpected write');};
 for(let i=0;i<50;i++)assert.equal(t.league.prepareRegistrations(),false);
 const restored=new DailyLeagueService(f.s,{rules:t.league.rules});assert.equal(restored.prepareRegistrations(),false);assert.equal(day.registrationMinimumCheckedAt,stamp);assert.deepEqual(day.teams,teams);
});
test('September 30 in-progress intervention is once only and does not rewrite live legs or completed results',()=>{
 const t=leagueFixture(),{f}=t;today(t);t.league.day.registrationMinimumCheckedAt=f.now;t.league.advance(f.now);
 const day=t.league.day,live=JSON.stringify(day.live),fixtures=structuredClone(day.fixtures);delete day.registrationMinimumCheckedAt;
 assert.equal(f.a.leagueRegistration.playerIds.length,11);assert.equal(t.league.prepareRegistrations(),true);assert.equal(f.a.leagueRegistration.playerIds.length,15);
 assert.equal(JSON.stringify(day.live),live);assert.deepEqual(day.fixtures,fixtures);assert.equal(t.league.registrationLocked(),true);
 f.a.leagueRegistration.playerIds.pop();assert.equal(t.league.prepareRegistrations(),false);assert.equal(f.a.leagueRegistration.playerIds.length,14);
});
test('in-progress exception is dated and never edits other days or already completed competitions',()=>{
 for(const date of ['2026-09-29','2026-10-01']){const t=leagueFixture();t.f.tick(Date.parse(date+'T09:49:00+08:00')-t.f.now);t.start();t.league.day.fixtures[0].status='completed';assert.equal(t.league.prepareRegistrations(),false);assert.equal(t.f.a.leagueRegistration.playerIds.length,11);}
 const t=leagueFixture();today(t);t.league.day.rewarded=true;assert.equal(t.league.prepareRegistrations(),false);
});
test('failed persistence rolls back both supplementation and once-only marker, then can retry',()=>{
 const t=leagueFixture();today(t);const before=structuredClone(t.f.a.leagueRegistration);t.f.fail(true);assert.throws(()=>t.league.prepareRegistrations(),/disk/);assert.deepEqual(t.f.a.leagueRegistration,before);assert.equal(t.league.day.registrationMinimumCheckedAt,undefined);
 t.f.fail(false);assert.equal(t.league.prepareRegistrations(),true);assert.equal(t.f.a.leagueRegistration.playerIds.length,15);
});
