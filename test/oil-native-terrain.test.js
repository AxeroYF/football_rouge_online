import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as THREE from 'three';
import {oilGroundSites,oilGroundTexture,oilGroundWeight,applyOilGround} from '../client/map-three/atlas-oil.js';
import {projectTerritoryPoint} from '../client/map-three/projection.js';
import {OIL_DEPOSIT_IDS} from '../shared/config/oil-deposits.mjs';
import {districtFixture} from './oil-fixture.mjs';
const HOUR=3600000;
test('native oil sites occupy geographic land interiors with bounded footprint and no screen-size parameter',()=>{const geo=JSON.parse(fs.readFileSync(new URL('../assets/data/campaign-territories.geojson',import.meta.url)));const sites=oilGroundSites(geo);assert.equal(sites.length,60);for(const s of sites){assert.ok(s.radius>0&&s.radius<=1.15);assert.equal(oilGroundWeight(s,s.x,s.z),1);assert.equal(oilGroundWeight(s,s.x+s.radius*2,s.z),0);}assert.deepEqual(sites,oilGroundSites(geo));});
test('oil material paints the existing terrain and roughness without creating overlay geometry',()=>{const field={width:16,height:16,origin:[0,0],step:.25,maskAt:()=>255},sites=[{id:'oil',x:2,z:2,radius:.8,angle:0,seed:2}];const texture=oilGroundTexture(field,sites);assert.ok(texture.image.data.some(v=>v>200));assert.equal(texture.image.data[0],0);const sea=oilGroundTexture({...field,maskAt:()=>0},sites);assert.ok(sea.image.data.every(v=>v===0));const material=new THREE.MeshStandardMaterial();applyOilGround(material,texture);const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <roughnessmap_fragment>'};material.onBeforeCompile(shader);assert.equal(shader.uniforms.oilGround.value,texture);assert.match(shader.fragmentShader,/roughnessFactor=mix/);assert.doesNotMatch(shader.vertexShader,/position\s*=/);texture.dispose();sea.dispose();material.dispose();});
function oilFixture(){const f=districtFixture();f.s.oil.deposit=id=>id==='t1'?{oilPerHour:3}:null;f.s.buildings.oilDeposit=f.s.oil.deposit;return f;}
test('any available fuel powers the factory; escrow suspends supply and cancellation restores it',()=>{
 const f=oilFixture(),{s,a}=f;a.oil.balance=0;s.save();const b=f.build('factory','t2');
 const preview=()=>s.territoryProduction.districtPreview(a,s.world,'t2','factory',1,b.id),base=preview();assert.equal(base.oilSupply.active,false);
 a.oil.balance=1;s.save();assert.equal(preview().fullYield,base.fullYield*120/100);assert.equal(preview().projectedCapacity,s.resourceState(a).current.production);
 const science=s.resourceState(a).current.science;assert.equal(s.oil.view(a).hourly,-1);
 const order=s.oil.mutate(a,{action:'list',quantity:1,unitPrice:10,requestId:'supply-stock-list'});assert.equal(preview().oilSupply.active,false);assert.equal(s.oil.view(a).hourly,0);assert.equal(s.resourceState(a).current.science,science);
 s.oil.mutate(a,{action:'cancel',orderId:order.orderId,requestId:'supply-stock-cancel'});assert.equal(preview().oilSupply.active,true);
});
test('offline depletion splits construction at the instant fuel runs out',()=>{
 const f=oilFixture(),{s,a}=f;f.build('factory','t2');a.oil.balance=1;s.save();const start=f.time(),boosted=s.resourceState(a).current.production;
 const b=s.buildings.createRecord('training-center',{status:'constructing'});b.productionWork={required:1e12,completed:0,updatedAt:start,ownerId:a.id};s.world.territories.t3.buildings.push(b);s.save();
 f.setTime(start+2*HOUR);s.save();const base=s.resourceState(a).current.production;assert.ok(boosted>base);assert.ok(Math.abs(b.productionWork.completed-(boosted+base)*HOUR)<.001);assert.equal(a.oil.balance,0);assert.equal(a.oil.remainder,0);assert.equal(s.oil.view(a).consumption,0);
});
test('hourly fuel billing keeps inventory whole and rollback preserves the pending period',()=>{
 const f=oilFixture(),{s,a}=f;f.build('factory','t2');a.oil.balance=1;s.save();const start=f.time();
 f.setTime(start+HOUR/2);s.save();assert.equal(a.oil.balance,1);assert.equal(a.oil.pendingWork,-HOUR/2);assert.equal(s.oil.view(a).balance,1);assert.equal(s.oil.view(a).factorySupply.active,true);
 const before=structuredClone(a.oil),rates=structuredClone(s.world.resourceEconomy);f.setTime(start+2*HOUR);f.fail(true);assert.throws(()=>s.save(),/disk failure/);assert.deepEqual(a.oil,before);assert.deepEqual(s.world.resourceEconomy,rates);
 f.fail(false);s.save();assert.equal(s.oil.view(a).balance,0);assert.equal(s.oil.view(a).factorySupply.active,false);
});
test('a producing well powers the factory from zero stock and accumulates only the net surplus',()=>{
 const f=oilFixture(),{s,a}=f;f.build('oil-well','t1');f.build('factory','t2');a.oil.balance=0;s.save();const start=f.time();
 const v=s.oil.view(a);assert.equal(v.factorySupply.active,true);assert.equal(v.production,3);assert.equal(v.consumption,1);assert.equal(v.hourly,2);assert.deepEqual(v.sources.map(x=>x.yields.oil),[3,-1]);
 f.setTime(start+4*HOUR);s.save();assert.equal(a.oil.balance,8);assert.equal(a.oil.remainder,0);s.save();assert.equal(a.oil.balance,8);
});
test('only the operating factory consumes oil, and legacy saves are not charged retroactively',()=>{
 const f=oilFixture(),{s,a}=f;f.build('factory','t2');const other=s.buildings.createRecord('factory',{status:'active'});s.world.territories.t3.buildings.push(other);s.save();assert.equal(a.oil.factoryDemand,1);
 delete a.oil.factoryDemand;const start=f.time();f.setTime(start+HOUR);s.save();assert.equal(a.oil.balance,30);assert.equal(a.oil.factoryDemand,1);f.setTime(start+2*HOUR);s.save();assert.equal(a.oil.balance,29);
});
test('factory fuel demand begins at actual construction completion',()=>{
 const f=oilFixture(),{s,a}=f;const start=f.time(),capacity=s.resourceState(a).current.production;
 const b=s.buildings.createRecord('factory',{status:'constructing'});b.productionWork={required:capacity*HOUR/2,completed:0,updatedAt:start,ownerId:a.id};s.world.territories.t2.buildings.push(b);s.save();assert.equal(a.oil.factoryDemand,0);
 f.setTime(start+HOUR);s.save();assert.equal(b.status,'active');assert.equal(s.oil.view(a).balance,30);assert.equal(a.oil.remainder,-HOUR/2);assert.equal(a.oil.factoryDemand,1);
});
