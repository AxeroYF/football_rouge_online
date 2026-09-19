import test from 'node:test';
import assert from 'node:assert/strict';
import {createFacilityModel,disposeFacilityModel} from '../client/facility-models/facility-models.js';
import {applyAirportIdentity} from '../client/facility-models/airport-identity.js';
import {airportIdentity,airportTerritoryIdentity} from '../shared/config/airport-identity.mjs';
import {BUILDING_DEFINITIONS} from '../shared/config/buildings.mjs';
import {FACILITY_ASSET_ITEMS,facilityArtIcon} from '../shared/config/facility-art.mjs';
test('airport is a single-level live facility with a construction icon',()=>{
 const models=FACILITY_ASSET_ITEMS.filter(i=>i.type==='airport');assert.equal(models.length,1);assert.equal(models[0].planned,false);
 assert.equal(BUILDING_DEFINITIONS.airport.buildable,true);assert.ok(facilityArtIcon('airport'));
});
test('airport retains terminal, runway, tower and nameplate at all geometry detail tiers',()=>{
 for(const lod of [0,1,2]){const model=createFacilityModel('airport-lv1',{lod});try{for(const part of ['terminal','runway','runway_threshold','control_tower','airport_nameplate','aircraft_tail','jet_bridges'])assert.ok(model.getObjectByName(part),part);}finally{disposeFacilityModel(model);}}
});
test('team colors change only the airport accent material and do not leak across players',()=>{
 const blue=createFacilityModel('airport-lv1'),red=createFacilityModel('airport-lv1');
 try{const identity=applyAirportIdentity(red,{clubName:'赤焰联',territoryName:'都柏林',playerColor:'#b94138',playerId:'red'});assert.equal(identity.name,'赤焰联 · 都柏林机场');
 const materials=m=>{const map=new Map();m.traverse(o=>{if(o.isMesh)map.set(o.material.name,o.material.color.getHexString());});return map;};
 const b=materials(blue),r=materials(red);assert.equal(r.get('airportTeam'),'b94138');assert.equal(b.get('airportTeam'),'256ba4');assert.equal(r.get('airportAsphalt'),b.get('airportAsphalt'));assert.equal(r.get('glass'),b.get('glass'));
 }finally{disposeFacilityModel(blue);disposeFacilityModel(red);}
});
test('club naming handles empty names, long names and invalid colors predictably',()=>{
 assert.equal(airportIdentity({clubName:'  ',playerColor:'bad'}).name,'俱乐部机场');assert.equal(airportIdentity({playerColor:'bad'}).color,'#256ba4');
 assert.equal(airportIdentity({clubName:'联'.repeat(100)}).clubName.length,40);assert.notEqual(airportIdentity({playerId:'red'}).code,airportIdentity({playerId:'blue'}).code);
});

test('airport identity follows actual territory owner, territory color changes and captures for arbitrary players',()=>{
 const world={territories:{home:{ownerType:'player',ownerId:'player-0'}},players:{}};
 for(let i=0;i<100;i++)world.players['player-'+i]={teamName:'俱乐部'+i,color:'#'+(0x102030+i*6541).toString(16).padStart(6,'0')};
 const model=createFacilityModel('airport-lv1');
 try{
  for(let i=0;i<100;i++){
   const id='player-'+i;world.territories.home.ownerId=id;
   const result=applyAirportIdentity(model,{world,territoryId:'home',territoryName:'里斯本'});
   assert.equal(result.color,world.players[id].color);assert.equal(result.ownerId,id);assert.match(result.name,new RegExp('俱乐部'+i));
  }
  world.players['player-99'].color='#123abc';assert.equal(airportTerritoryIdentity(world,'home').color,'#123abc');
  world.territories.home.ownerId='hidden-player';assert.equal(airportTerritoryIdentity(world,'home').color,'#7f8b82');
 }finally{disposeFacilityModel(model);}
});
