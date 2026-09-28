import test from 'node:test';
import assert from 'node:assert/strict';
import {leagueFixture} from './daily-league-fixture.mjs';
import {normalizeLeagueRegistration,leaguePlayerView} from '../shared/config/league-registration.mjs';
import {buildAccountMatchSeat} from '../shared/football/account-match-seat.mjs';
const save=(t,ids)=>t.league.saveRegistration(t.f.a,{playerIds:ids,version:JSON.stringify(t.league.registrationView(t.f.a).playerIds)});
test('first registration copies garrison starters, remains independent and survives restart and midnight',()=>{
 const t=leagueFixture(),{f}=t;assert.deepEqual(f.a.leagueRegistration.playerIds,f.a.tactics.squads.garrison.starters);
 const ids=f.a.tactics.squads.expedition.starters,assignments=structuredClone(f.a.playerSquads);save(t,ids);assert.deepEqual(f.a.playerSquads,assignments);
 f.tick(86400000);f.s.save();f.reload();assert.deepEqual(f.a.leagueRegistration.playerIds,ids);
 const seat=buildAccountMatchSeat(f.a,'league',f.now,{fitness:true});assert.deepEqual(new Set(seat.players.map(p=>p.id)),new Set(ids));
});
test('registration accepts any positions up to 23, rejects duplicates, missing and stale IDs',()=>{
 const t=leagueFixture(),{a}=t.f;const all=a.draft.roster.map(p=>p.id);save(t,all);assert.equal(a.leagueRegistration.playerIds.length,22);
 const extra={...structuredClone(a.draft.roster[0]),id:'extra',cardDefinitionId:'extra'};a.draft.roster.push(extra);save(t,[...all,'extra']);
 assert.throws(()=>save(t,[...all,'extra','extra']),/23|重复/);assert.throws(()=>save(t,['missing']),/离队/);
 assert.throws(()=>t.league.saveRegistration(a,{playerIds:[],version:'stale'}),/变化/);
 save(t,a.draft.roster.filter(p=>p.pool==='GK').map(p=>p.id));assert.equal(a.leagueRegistration.playerIds.length,3);
 save(t,[]);t.f.s.save();assert.deepEqual(a.leagueRegistration.playerIds,[],'explicit empty must not initialize again');
});
test('whole competition window locks registration including between rounds and unlocks after final result',()=>{
 const t=leagueFixture();t.f.tick(60000);t.league.ensureDay();assert.equal(t.league.registrationLocked(),false);save(t,[]);
 t.f.tick(600000);assert.equal(t.league.registrationLocked(),true);assert.throws(()=>save(t,t.f.a.tactics.squads.garrison.starters),/期间/);
 t.league.day.fixtures[0].status='completed';assert.equal(t.league.registrationLocked(),true);
 for(const f of t.league.day.fixtures)f.status='completed';assert.equal(t.league.registrationLocked(),false);save(t,t.f.a.tactics.squads.garrison.starters);
});
test('upgrade retains exact registered instance, consumption removes it even when a duplicate exists; no health reset exploit',()=>{
 const t=leagueFixture(),{f}=t,id=f.a.leagueRegistration.playerIds[0],p=f.a.draft.roster.find(p=>p.id===id);
 p.upgradeLevel=3;f.a.leagueRegistration.conditions[id]={state:{fitness:31,injury:{matchesRemaining:2}},at:f.now};f.s.persist();assert.ok(f.a.leagueRegistration.playerIds.includes(id));
 const before=[...f.a.leagueRegistration.playerIds];save(t,before.filter(v=>v!==id));save(t,before);assert.equal(f.a.leagueRegistration.conditions[id].state.fitness,31);
 f.a.draft.roster.push({...structuredClone(p),id:'duplicate'});f.a.draft.roster=f.a.draft.roster.filter(p=>p.id!==id);f.s.persist();assert.ok(!f.a.leagueRegistration.playerIds.includes(id));assert.ok(!f.a.leagueRegistration.playerIds.includes('duplicate'));
});
test('save rollback retains registration and conditions; retry is idempotent',()=>{
 const t=leagueFixture(),before=structuredClone(t.f.a.leagueRegistration),ids=t.f.a.tactics.squads.expedition.starters;
 t.f.fail(true);assert.throws(()=>save(t,ids),/disk/);assert.deepEqual(t.f.a.leagueRegistration,before);t.f.fail(false);save(t,ids);save(t,ids);assert.deepEqual(t.f.a.leagueRegistration.playerIds,ids);
});
test('league tactics save uses registered players without editing other squads',()=>{
 const t=leagueFixture(),{f}=t,old=structuredClone(f.a.tactics);save(t,f.a.tactics.squads.expedition.starters);
 const tactics=structuredClone(f.a.tactics.squads.expedition);tactics.planSnapshots.__s4V2.fitnessThreshold=72;
 f.s.saveTactics(f.a,{leagueOnly:true,squads:{league:tactics}},{compact:true});assert.deepEqual(f.a.tactics,old);assert.equal(f.a.leagueRegistration.tactics.planSnapshots.__s4V2.fitnessThreshold,72);
 t.start();t.league.advance(f.now);assert.throws(()=>f.s.saveTactics(f.a,{leagueOnly:true,squads:{league:tactics}}),/进行中/);
});
test('league projection excludes outside injury, suspension, training, medical and loan but retains abilities',()=>{
 const p={id:'a',overall:92,state:{fitness:9,injury:{matchesRemaining:5}},status:{suspensionMatches:2},medical:{},training:{},coalitionLoan:{},injury:true};
 const result=leaguePlayerView(p,{state:{fitness:50},at:0},120000);assert.equal(result.state.fitness,51);assert.equal(result.state.injury,undefined);assert.deepEqual(result.status,{});assert.equal(result.medical,null);assert.equal(result.overall,92);assert.equal(p.state.fitness,9);
});

test('registration polling is read-only and exposes health only for registered cards',()=>{
 const t=leagueFixture(),{f}=t,before=structuredClone(f.a.leagueRegistration);let saves=0;f.s.persist=()=>saves++;
 for(let i=0;i<50;i++){const value=t.league.registrationView(f.a);assert.equal(Object.keys(value.conditions).length,value.playerIds.length);}
 assert.equal(saves,0);assert.deepEqual(f.a.leagueRegistration,before);
});
test('expedition injury and simultaneous match do not affect league seat, and failed settlement rolls league health back',()=>{
 const t=leagueFixture(),{f}=t;save(t,f.a.tactics.squads.expedition.starters);
 for(const p of f.a.draft.roster.filter(p=>f.a.leagueRegistration.playerIds.includes(p.id))){p.state={fitness:2,injury:{matchesRemaining:8}};p.training={id:'outside'};}
 t.start();t.league.advance(f.now);const fixture=t.league.day.fixtures[0],live=t.league.day.live[fixture.id];assert.ok(live);assert.ok(live.leg.home.players.every(p=>p.state.fitness===100));
 const before=structuredClone(f.a.leagueRegistration);live.leg.match.finished=true;live.leg.match.score=[1,0];live.leg.match.teams[0].players[0].state.fitness=15;
 f.fail(true);assert.throws(()=>t.league.settle(fixture,f.now),/disk/);assert.deepEqual(f.a.leagueRegistration,before);f.fail(false);
 const retry=t.league.day.fixtures[0];t.league.settle(retry,f.now);assert.equal(f.a.leagueRegistration.conditions[live.leg.match.teams[0].players[0].id].state.fitness,15);
});

test('real enhancement keeps registered main card and removes registered consumed material atomically',()=>{
 const t=leagueFixture(),{f}=t,main=f.a.draft.roster.find(p=>p.id===f.a.leagueRegistration.playerIds[2]);
 main.upgradeLevel=0;const material={...structuredClone(main),id:'league-material',playerId:'league-material',cardInstanceId:'league-material'};f.a.draft.roster.push(material);f.s.persist();
 const before=f.a.leagueRegistration.playerIds.slice();f.s.enhancement.enhance(f.a,f.s.world,{requestId:'league-enhance-1',mainCardId:main.id,materialCardId:material.id});assert.ok(f.a.leagueRegistration.playerIds.includes(main.id));assert.equal(main.upgradeLevel,1);
 const copy={...structuredClone(main),id:'league-material-2',playerId:'league-material-2',cardInstanceId:'league-material-2',upgradeLevel:0};f.a.draft.roster.push(copy);f.s.persist();save(t,before.map(id=>id===main.id?copy.id:id));
 f.s.enhancement.enhance(f.a,f.s.world,{requestId:'league-enhance-2',mainCardId:main.id,materialCardId:copy.id});assert.ok(!f.a.leagueRegistration.playerIds.includes(copy.id));assert.ok(!f.a.leagueRegistration.playerIds.includes(main.id));
});
