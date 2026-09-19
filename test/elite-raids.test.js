import {trainingProgress} from '../client/buildings/training-controller.js';
import {scoutingProgress} from '../client/buildings/scouting-controller.js';
import {districtFixture} from './oil-fixture.mjs';
import {territoryTravelEstimate} from '../server/domain/expedition-piece.mjs';
import {raidFixture} from './elite-raid-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {coalitionFixture} from './coalition-fixture.mjs';
import {EliteRaidService} from '../server/application/elite-raid-service.mjs';
import {RAID_RULES,raidWindow,raidDay,raidPackType} from '../shared/config/elite-raids.mjs';
import {suppressTerritory,releaseSuppression} from '../server/application/raid-suppression.mjs';
import {PLAYER_PACK_DEFINITIONS} from '../shared/config/player-packs.mjs';
import {raidWindowMarkup} from '../client/elite/raid-controller.js';
const H=3600000;
const fixture=raidFixture;
function action(f,a,action,extra={}){const army=f.s.eliteRaids.day().army;return f.s.eliteRaids.mutate(a,{requestId:crypto.randomUUID(),armyId:army.id,revision:army.revision,action,...extra});}
function assemble(f){const day=f.s.eliteRaids.day(),leader=f.s.accounts.get(day.candidateId);action(f,leader,'accept-command');for(const p of f.a.draft.roster.slice(0,6))action(f,f.a,'lend',{playerId:p.id});for(const p of f.b.draft.roster.slice(6,11))action(f,f.b,'lend',{playerId:p.id});action(f,leader,'auto-lineup');return leader;}
function finish(f,m,win=true){m.leg.match.score=win?[2,0]:[0,2];m.leg.match.finished=true;m.leg.extraTimePlayed=true;f.s.eliteRaids.transaction(()=>f.s.eliteRaids.finish(m,f.now));}
test('Beijing activity opens at 20:00 and closes at midnight',()=>{assert.equal(raidWindow(Date.parse('2026-09-18T11:59:59Z')).open,false);assert.equal(raidWindow(Date.parse('2026-09-18T12:00:00Z')).open,true);assert.equal(raidWindow(Date.parse('2026-09-18T15:59:59Z')).open,true);assert.equal(raidWindow(Date.parse('2026-09-18T16:00:00Z')).open,false);assert.equal(raidDay(Date.parse('2026-09-18T16:00:00Z')),'2026-09-19');});
test('two distinct daily clubs have real cross-continent legs and one non-HQ target per player',()=>{const f=fixture(),r=f.s.eliteRaids;const day=r.day();assert.equal(day.raids.length,2);assert.notEqual(day.raids[0].clubId,day.raids[1].clubId);r.advance(f.now);for(const raid of day.raids){assert.equal(raid.route.length,2);assert.equal(new Set(raid.route.map(s=>s.ownerId)).size,2);assert.ok(raid.route.every(s=>s.durationMs>=60000&&s.durationMs<=600000));assert.ok(raid.route.some(s=>s.distanceKm>5000));assert.ok(raid.movement.arrivesAt>f.now);}const ids=day.raids.map(r=>r.clubId);f.s.world.eliteRaids=JSON.parse(JSON.stringify(r.data));f.s.eliteRaids=new EliteRaidService(f.s);assert.deepEqual(f.s.eliteRaids.ensureDay().raids.map(r=>r.clubId),ids);});
test('passive lastSeen does not qualify; queue rotates on acceptance and survives restart',()=>{const f=fixture(),r=f.s.eliteRaids,d=r.day(),first=d.candidateId;f.s.accounts.get('c').lastSeenAt=f.now;r.rotation(d,f.now);assert.ok(!r.data.queue.includes('c'));const a=f.s.accounts.get(first),body={action:'accept-command',requestId:crypto.randomUUID(),armyId:d.army.id,revision:d.army.revision};r.mutate(a,body);r.mutate(a,body);assert.equal(d.army.commanderId,first);assert.equal(r.data.queue.at(-1),first);f.s.world.eliteRaids=JSON.parse(JSON.stringify(r.data));f.s.eliteRaids=new EliteRaidService(f.s);assert.equal(f.s.eliteRaids.day().army.commanderId,first);f.tick(86400000);const next=f.s.eliteRaids.ensureDay();f.s.eliteRaids.rotation(next,f.now);assert.notEqual(next.candidateId,first);});
test('independent global coalition accepts non-allies and locks loans without modifying personal squads',()=>{const f=fixture();for(const rel of Object.values(f.s.world.diplomacy.relationships))rel.state='war';const old=structuredClone(f.a.playerSquads),leader=assemble(f),army=f.s.eliteRaids.day().army;assert.equal(army.loans.length,11);assert.deepEqual(f.a.playerSquads,old);assert.equal(f.s.coalitions.find(f.a),null);assert.equal(f.a.draft.roster[0].coalitionLoan.activity,true);assert.equal(f.s.eliteRaids.armyView(leader).army.canCommand,true);assert.throws(()=>action(f,f.s.accounts.get(leader.id==='a'?'b':'a'),'challenge',{clubId:f.s.eliteRaids.day().raids[0].clubId}),/指挥官/);});
test('four rewards cap separates defence and interception for both clubs; repeat awards are idempotent',()=>{const f=fixture(),r=f.s.eliteRaids;for(const club of r.day().raids)for(const kind of ['defence','interception']){const m={day:r.day().id,clubId:club.clubId,id:kind};assert.ok(r.award(f.a,m,kind));assert.equal(r.award(f.a,m,kind),null);}assert.equal(f.s.playerPacks.publicInventory(f.a).totalPacks,4);});
test('club pack candidates are starting eleven at +1; duplicate owned definitions produce new instances',()=>{const f=fixture(),s=f.s,type=raidPackType('real-madrid');s.playerPacks.addPacks(f.a,type,2);const opening=s.playerPacks.open(f.a,type);assert.equal(opening.cards.length,3);assert.equal(new Set(opening.cards.map(p=>p.playerId)).size,3);assert.ok(opening.cards.every(p=>p.upgradeLevel===1));const candidate=f.a.inventory.pendingOpening.candidateIds[0],source=s.playerDatabase.find(p=>p.id===candidate);f.a.draft.roster.push(structuredClone(source));const selected=s.playerPacks.choose(f.a,opening.id,candidate);assert.notEqual(selected.playerId,candidate);assert.equal(f.a.draft.roster.at(-1).upgradeLevel,1);assert.equal(f.a.draft.roster.at(-1).cardDefinitionId,source.id);assert.equal(Object.values(PLAYER_PACK_DEFINITIONS).filter(p=>p.clubId).length,18);});
test('arrival challenges garrison; victory rewards once without capturing territory',()=>{const f=fixture(),r=f.s.eliteRaids;r.advance(f.now);const raid=r.day().raids[0];f.tick(raid.movement.arrivesAt-f.now);r.advance(f.now,{maximumChainsPerMatch:1});const m=Object.values(r.data.matches).find(m=>m.clubId===raid.clubId);assert.ok(m);assert.equal(m.kind,'defence');assert.ok(m.leg.home.players.every(p=>p.id.includes('garrison')));const owner=f.s.world.territories[m.territoryId].ownerId;finish(f,m);assert.equal(f.s.world.territories[m.territoryId].ownerId,owner);assert.equal(f.s.playerPacks.publicInventory(f.s.accounts.get(owner)).totalPacks,1);});
test('suppression retains buildings/tasks, disables effects for 24h and restores remaining work',()=>{const f=fixture(),c=f.s,t=c.world.territories['a-outer'];t.buildings=[{id:'shop',type:'club-shop',level:2,status:'active'},{id:'train',type:'training-center',status:'active'},{id:'build',type:'university',status:'constructing',productionWork:{required:1000,completed:200,paused:false}}];f.a.training={tasks:{t:{id:'t',buildingId:'train',startedAt:f.now-60000,completesAt:f.now+60000}}};const before=f.a.training.tasks.t.completesAt;suppressTerritory(c,'a-outer','real-madrid',f.now);assert.equal(t.buildings[0].status,'inactive');assert.equal(t.buildings[2].productionWork.completed,200);assert.equal(t.buildings[2].productionWork.paused,true);assert.equal(f.a.training.tasks.t.completesAt,before+24*H);assert.equal(suppressTerritory(c,'a-outer','barcelona',f.now+10000),false);releaseSuppression(c,'a-outer',f.now+H);assert.equal(t.buildings[0].status,'active');assert.equal(t.buildings[2].productionWork.paused,false);assert.equal(f.a.training.tasks.t.completesAt,before+H);});
test('winning interception withdraws elite, clears its suppression and grants actual contributors',()=>{const f=fixture(),r=f.s.eliteRaids,leader=assemble(f),club=r.day().raids[0];suppressTerritory(f.s,'a-outer',club.clubId,f.now);const {challengeId}=action(f,leader,'challenge',{clubId:club.clubId});const m=r.data.matches[challengeId];assert.equal(m.leg.home.id,r.day().army.id);finish(f,m);assert.ok(club.interceptedAt);assert.equal(club.status,'withdrawn');assert.equal(f.s.world.territories['a-outer'].raidSuppression,undefined);assert.equal(f.s.playerPacks.publicInventory(f.a).totalPacks,1);assert.equal(f.s.playerPacks.publicInventory(f.b).totalPacks,1);assert.throws(()=>action(f,leader,'challenge',{clubId:club.clubId}),/尚未被击退/);});
test('midnight withdraws moving raids, finishes live match, closes and returns loans',()=>{const f=fixture(),r=f.s.eliteRaids,leader=assemble(f),day=r.day();r.advance(f.now);const {challengeId}=action(f,leader,'challenge',{clubId:day.raids[0].clubId});f.tick(day.endsAt-f.now);r.advance(f.now,{maximumChainsPerMatch:0});assert.ok(day.raids.every(x=>x.status==='withdrawn'));assert.throws(()=>r.mutate(leader,{action:'lend',requestId:crypto.randomUUID(),playerId:'x'}),/20:00/);finish(f,r.data.matches[challengeId]);f.tick(1000);r.advance(f.now);assert.equal(r.data.days[day.id].army.loans.length,0);assert.ok(f.a.draft.roster.every(p=>!p.coalitionLoan));assert.equal(f.s.playerPacks.publicInventory(f.a).totalPacks,1);});
test('failed save rolls back borrowing and captain acceptance',()=>{const f=fixture(),r=f.s.eliteRaids,day=r.day(),leader=f.s.accounts.get(day.candidateId);f.fail(true);assert.throws(()=>action(f,leader,'accept-command'),/disk failure/);f.fail(false);assert.equal(r.day().army.commanderId,null);assemble(f);const old=f.a.draft.roster.length;f.fail(true);assert.throws(()=>action(f,f.a,'withdraw',{playerId:f.a.draft.roster[0].id}),/disk failure/);f.fail(false);assert.equal(r.day().army.loans.length,11);assert.equal(f.a.draft.roster.length,old);});
test('activity UI exposes commander, independent rewards and shared tactics entry',()=>{const f=fixture(),r=f.s.eliteRaids;r.advance(f.now);const html=raidWindowMarkup(r.view(f.a,{detail:true}),{playerId:'a'});assert.match(html,/20:00—24:00/);assert.match(html,/每日最多 4 包/);assert.match(html,/前往战术板/);assert.match(html,/club-badges/);});

test('elite travel always uses supplied-oil time regardless of player stocks',()=>{const f=fixture();for(const a of f.s.accounts.values())if(a.oil)a.oil.balance=0;const r=f.s.eliteRaids;r.advance(f.now);for(const raid of r.day().raids)for(const leg of raid.route){assert.equal(leg.fuelMode,'supplied');assert.equal(leg.durationMs,territoryTravelEstimate(f.s.territoryIndex,leg.fromTerritoryId,leg.toTerritoryId).durationMs);}assert.ok([...f.s.accounts.values()].every(a=>!a.oil||a.oil.balance===0));});
test('24h suppression expiry splits offline income and preserves maintenance with exact restoration',()=>{const f=districtFixture(),c=f.s,a=f.a;f.build('club-shop','t1');const t=c.world.territories.t1,normal=c.territoryProduction.publicState(a,c.world).hourly.gold,fee=c.operatingCosts.costs(a,c.world).maintenance,started=f.time();suppressTerritory(c,'t1','real-madrid',started);c.save();const reduced=c.territoryProduction.publicState(a,c.world).hourly.gold;assert.equal(Math.round((normal-reduced)*10),636);assert.equal(c.operatingCosts.costs(a,c.world).maintenance,fee);const before=a.gold;f.setTime(started+48*H);c.save();assert.equal(t.raidSuppression,undefined);assert.equal(t.buildings[0].status,'active');assert.equal(c.territoryProduction.publicState(a,c.world).hourly.gold,normal);const costs=c.operatingCosts.costs(a,c.world).total;assert.ok(Math.abs(a.gold-before-(reduced*24+normal*24-costs*48))<1.01);});
test('suppression expiry save failure restores original object state and can retry',()=>{const f=districtFixture(),c=f.s;f.build('club-shop','t1');const t=c.world.territories.t1,b=t.buildings[0],start=f.time();suppressTerritory(c,'t1','real-madrid',start);c.save();const before=f.a.gold;f.setTime(start+25*H);f.fail(true);assert.throws(()=>c.save(),/disk failure/);assert.equal(t.buildings[0],b);assert.equal(b.status,'inactive');assert.ok(t.raidSuppression);assert.equal(f.a.gold,before);f.fail(false);c.save();assert.equal(b.status,'active');assert.equal(t.raidSuppression,undefined);});
test('candidate timeout, resignation and offline fallback follow persisted rotation',()=>{const f=fixture(),r=f.s.eliteRaids,d=r.day(),first=d.candidateId;f.tick(RAID_RULES.claimMs);r.rotation(d,f.now);assert.notEqual(d.candidateId,first);const captain=f.s.accounts.get(d.candidateId);action(f,captain,'accept-command');f.tick(RAID_RULES.offlineMs);r.rotation(d,f.now);assert.equal(d.army.commanderId,null);assert.notEqual(d.candidateId,captain.id);});


test('full campaign restart restores raids, commander queue, loans and live battle without duplicate rewards',()=>{
 const f=fixture(),leader=assemble(f),r=f.s.eliteRaids,day=r.day();r.advance(f.now);
 suppressTerritory(f.s,'a-outer',day.raids[0].clubId,f.now);
 const {challengeId}=action(f,leader,'challenge',{clubId:day.raids[0].clubId});
 const queue=[...r.data.queue],route=structuredClone(day.raids[0].route);f.s.save();f.reload();
 const restored=f.s.eliteRaids;assert.deepEqual(restored.data.queue,queue);assert.deepEqual(restored.day().raids[0].route,route);
 assert.equal(restored.day().army.commanderId,leader.id);assert.equal(restored.day().army.loans.length,11);
 assert.ok(f.a.draft.roster.some(p=>p.coalitionLoan?.activity));assert.ok(f.s.world.territories['a-outer'].raidSuppression);
 const match=restored.data.matches[challengeId];assert.ok(match);assert.equal(typeof match.leg.match.rng,"function");finish(f,match);
 assert.equal(f.s.playerPacks.publicInventory(f.a).totalPacks,1);f.reload();
 assert.equal(f.s.eliteRaids.data.matches[challengeId],undefined);assert.equal(f.s.playerPacks.publicInventory(f.a).totalPacks,1);
 assert.equal(f.s.world.territories['a-outer'].raidSuppression,undefined);assert.equal(f.s.eliteRaids.day().raids[0].status,'withdrawn');
});

test('paused training and scouting progress remains frozen until restoration',()=>{
 const f=fixture(),task={id:'paused',buildingId:'train',startedAt:f.now-60000,completesAt:f.now+60000,roundCount:2,roundDurationMs:60000};
 f.a.training={tasks:{paused:task}};f.s.world.territories['a-outer'].buildings=[{id:'train',type:'training-center',status:'active'}];
 suppressTerritory(f.s,'a-outer','real-madrid',f.now);
 for(const progress of [trainingProgress,scoutingProgress]){assert.equal(progress(task,f.now).percent,50);assert.equal(progress(task,f.now+H).percent,50);}
 assert.equal(f.s.training.publicTask(task).raidPause.until,f.now+24*H);
 assert.equal(f.s.scouting.publicTask(task).completedRounds,1);
 releaseSuppression(f.s,'a-outer',f.now+H);assert.equal(trainingProgress(task,f.now+H).percent,50);
});


test('daily routes only target recently active teams; passive polling and old activity do not qualify',()=>{
 const f=fixture(),r=f.s.eliteRaids,day=r.day();
 f.b.raidActivity={activeAt:f.now-RAID_RULES.activeWindowMs-1};f.b.lastSeenAt=f.now;
 for(const raid of day.raids){const route=r.targets(raid,day);assert.deepEqual(route.map(s=>s.ownerId),['a']);}
 r.touch(f.b,{foreground:true});
 for(const raid of day.raids)assert.equal(r.targets(raid,day).length,2);
 delete f.a.raidActivity;delete f.b.raidActivity;r.advance(f.now);
 assert.ok(day.raids.every(raid=>raid.status==='finished'&&!raid.movement&&raid.route.length===0));
});

test('restored routes skip inactive future stops and recalculate travel without changing completed results',()=>{
 const f=fixture(),r=f.s.eliteRaids,day=r.day(),raid=day.raids[0];raid.route=r.targets(raid,day);
 const removed=raid.route[0],kept=raid.route[1];f.s.accounts.get(removed.ownerId).raidActivity={activeAt:f.now-RAID_RULES.activeWindowMs-1};
 const results=[{ownerId:'previous',outcome:'win'}];raid.results=structuredClone(results);r.depart(raid,f.now);
 assert.deepEqual(raid.route.map(s=>s.ownerId),[kept.ownerId]);
 assert.equal(raid.movement.fromTerritoryId,raid.sourceTerritoryId);
 assert.equal(raid.movement.durationMs,territoryTravelEstimate(f.s.territoryIndex,raid.sourceTerritoryId,kept.territoryId).durationMs);
 assert.deepEqual(raid.results,results);
});

test('a target that becomes inactive while the raid travels is skipped without a battle or suppression',()=>{
 const f=fixture(),r=f.s.eliteRaids,day=r.day();r.advance(f.now);const raid=day.raids[0],stop=raid.route[0];
 f.s.accounts.get(stop.ownerId).raidActivity={activeAt:f.now-RAID_RULES.activeWindowMs-1};
 r.startDefence(day,raid,raid.movement.arrivesAt);
 assert.equal(raid.results[0].outcome,'skipped');assert.equal(Object.keys(r.data.matches).length,0);
 assert.equal(f.s.world.territories[stop.territoryId].raidSuppression,undefined);
});
