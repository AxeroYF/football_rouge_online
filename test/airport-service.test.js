import fs from 'node:fs';
import {territoryTravelEstimate} from '../server/domain/expedition-piece.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {coalitionFixture} from './coalition-fixture.mjs';
import {buildingPanelMarkup} from '../client/buildings/building-panel-controller.js';
function fixture(){const f=coalitionFixture();f.a.gold=100000;for(const id of ['a','b'])f.s.world.territories[id].buildings.push({id:'airport-'+id,type:'airport',level:1,status:'active'});f.s.save();return f;}
function args(f,extra={}){const body={kind:'expedition',unitId:'expedition',territoryId:'b',requestId:'airport-test-001',...extra};const quote=f.s.airports.quote(f.a,body);return {...body,goldCost:quote.goldCost,quoteId:quote.quoteId};}
test('airport construction is listed on vacant territory, unlimited across territories and single level',()=>{const f=coalitionFixture();f.a.gold=100000;const c=f.s.world.territories.c;c.ownerId='a';c.capitalOf=null;f.s.world.players.a.territoryIds.push('c');f.s.save();let view=f.s.buildings.territoryView(f.a,f.s.world,'c');assert.ok(view.availableTypes.includes('airport'));assert.match(buildingPanelMarkup({view,catalog:f.s.buildings.catalog(),walletGold:f.a.gold}),/data-build-type="airport"/);for(const id of ['a','c']){const r=f.s.buildings.build(f.a,f.s.world,id,'airport','gold');assert.equal(r.building.status,'active');assert.equal(r.building.maxLevel,1);assert.match(r.building.name,/a机场/);}assert.equal(f.a.gold,64000);assert.throws(()=>f.s.buildings.build(f.a,f.s.world,'c','airport','gold'));});
test('allied air transport debits gold once, no oil, arrives in 60 seconds and survives reload',()=>{const f=fixture(),body=args(f),gold=f.a.gold,oil=f.a.oil.balance;f.s.airports.move(f.a,body);assert.equal(f.a.gold,gold-body.goldCost);assert.equal(f.a.oil.balance,oil);f.s.airports.move(f.a,body);assert.equal(f.a.gold,gold-body.goldCost);f.tick(59000);f.s.save();assert.equal(f.a.expeditionPiece.territoryId,'a');f.reload();f.tick(1000);f.s.save();assert.equal(f.a.expeditionPiece.territoryId,'b');assert.equal(f.a.expeditionPiece.movement,null);});
test('requires both usable completed airports and rejects enemies, suppressed or missing endpoints',()=>{const f=fixture();assert.throws(()=>f.s.airports.quote(f.a,{kind:'expedition',unitId:'expedition',territoryId:'c'}),/起点/);f.s.world.territories.b.raidSuppression={until:f.now+100000};assert.throws(()=>args(f),/起点/);delete f.s.world.territories.b.raidSuppression;f.s.world.territories.b.buildings[0].status='constructing';assert.throws(()=>args(f),/起点/);});
test('destination demolished in flight refunds exactly and returns to origin',()=>{const f=fixture(),body=args(f);f.s.airports.move(f.a,body);const gold=f.a.gold;f.s.world.territories.b.buildings=[];f.tick(60000);f.s.save();assert.equal(f.a.expeditionPiece.territoryId,'a');assert.equal(f.a.expeditionPiece.movement,null);assert.equal(f.a.goldLedger.filter(e=>e.reason==='airport-flight-refund').reduce((sum,e)=>sum+e.delta,0),body.goldCost);const after=f.a.gold;f.s.save();assert.equal(f.a.gold,after);});
test('failed persistence rolls back ticket and movement',()=>{const f=fixture(),body=args(f),gold=f.a.gold,save=f.s.repository.save;let calls=0;f.s.repository.save=v=>{if(++calls===2)throw Error('disk failed');return save(v);};assert.throws(()=>f.s.airports.move(f.a,body),/disk failed/);assert.equal(f.a.gold,gold);assert.equal(f.a.expeditionPiece.movement,null);assert.equal(f.a.airportRequests?.[body.requestId],undefined);});
test('scouts use same flight timeline and cannot dig while airborne',()=>{const f=fixture();f.a.scouting??={tasks:[],units:{}};f.a.scouting.units={s:{id:'s',name:'测试球探',territoryId:'a',movement:null}};const body=args(f,{kind:'scout',unitId:'s'});f.s.airports.move(f.a,body);assert.throws(()=>f.s.scouting.requireIdle(f.a,f.a.scouting.units.s),/移动/);f.tick(60000);f.s.save();assert.equal(f.a.scouting.units.s.territoryId,'b');});
test('coalition members split the expedition ticket and oil remains unchanged',()=>{const f=fixture();f.s.coalitions.mutate(f.a,{action:'create',requestId:'create-test-001'});const army=f.s.coalitions.find(f.a),body=args(f,{kind:'coalition',unitId:army.id}),gold=[f.a.gold,f.b.gold],oil=[f.a.oil.balance,f.b.oil.balance];f.s.airports.move(f.a,body);assert.equal(f.a.gold,gold[0]-body.goldCost/2);assert.equal(f.b.gold,gold[1]-body.goldCost/2);assert.deepEqual([f.a.oil.balance,f.b.oil.balance],oil);f.tick(60000);f.s.save();assert.equal(army.territoryId,'b');assert.equal(army.movement,null);});

const realIndex=JSON.parse(fs.readFileSync(new URL('../assets/data/territory-index.json',import.meta.url),'utf8'));
function brazilTurkey(){const f=fixture(),from=realIndex.territories.find(t=>t.nameEn==='Rio Grande do Norte'),to=realIndex.territories.find(t=>t.countryCode==='TUR'&&t.name.includes('安塔利亚'));assert.ok(from&&to);for(const [id,t]of [['a',from],['b',to]])Object.assign(f.s.territoryIndex.territories.find(e=>e.territoryId===id),{centroid:[...t.centroid],region:t.region});return f;}
test('Brazil to southern Turkey flights use campaign map distance for coalition, expedition and scout',()=>{
 const f=brazilTurkey();f.s.coalitions.mutate(f.a,{action:'create',requestId:'create-air-distance'});const army=f.s.coalitions.find(f.a);
 f.a.scouting??={tasks:[],units:{}};f.a.scouting.units={s:{id:'s',territoryId:'a',movement:null}};
 const before=JSON.stringify(f.s.territoryIndex);assert.equal(territoryTravelEstimate(f.s.territoryIndex,'a','b').distanceKm,8375);
 for(const [kind,unitId,cost]of [['coalition',army.id,800],['expedition','expedition',800],['scout','s',320]]){
  const q=f.s.airports.quote(f.a,{kind,unitId,territoryId:'b'});assert.equal(q.distanceKm,1091);assert.equal(q.distanceBasis,'campaign-map');assert.equal(q.goldCost,cost);assert.equal(q.durationMs,60000);assert.equal(q.shares.reduce((s,p)=>s+p.amount,0),cost);
 }
 assert.equal(JSON.stringify(f.s.territoryIndex),before,'distance conversion must not mutate source geography');
 const forward=f.s.airports.quote(f.a,{kind:'coalition',unitId:army.id,territoryId:'b'});army.territoryId='b';
 const reverse=f.s.airports.quote(f.a,{kind:'coalition',unitId:army.id,territoryId:'a'});assert.equal(reverse.distanceKm,forward.distanceKm);assert.equal(reverse.goldCost,forward.goldCost);
});
test('coalition quote uses army airport rather than commander expedition position and rejects old price',()=>{
 const f=brazilTurkey();f.s.coalitions.mutate(f.a,{action:'create',requestId:'create-air-origin'});const army=f.s.coalitions.find(f.a);f.a.expeditionPiece.territoryId='b';
 const body={kind:'coalition',unitId:army.id,territoryId:'b',requestId:'air-distance-fixed'};const q=f.s.airports.quote(f.a,body);assert.equal(q.fromTerritoryId,'a');assert.equal(q.distanceKm,1091);
 const gold=[f.a.gold,f.b.gold];assert.throws(()=>f.s.airports.move(f.a,{...body,goldCost:2200,quoteId:q.quoteId}),/价格已变化/);assert.deepEqual([f.a.gold,f.b.gold],gold);assert.equal(army.movement,null);
 f.s.airports.move(f.a,{...body,goldCost:q.goldCost,quoteId:q.quoteId});assert.deepEqual([f.a.gold,f.b.gold],[gold[0]-400,gold[1]-400]);assert.equal(army.movement.distanceKm,1091);
 f.s.airports.move(f.a,{...body,goldCost:q.goldCost,quoteId:q.quoteId});assert.deepEqual([f.a.gold,f.b.gold],[gold[0]-400,gold[1]-400]);
 f.tick(60000);f.s.save();assert.equal(army.territoryId,'b');
});
test('European coordinates keep existing airport distances',()=>{
 const from=realIndex.territories.find(t=>t.countryCode==='FRA'),to=realIndex.territories.find(t=>t.countryCode==='TUR');
 const old=territoryTravelEstimate(realIndex,from.territoryId,to.territoryId);const corrected=territoryTravelEstimate(realIndex,from.territoryId,to.territoryId,{displayCoordinates:true});assert.equal(corrected.distanceKm,old.distanceKm);
});
