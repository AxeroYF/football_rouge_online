import test from 'node:test';import assert from 'node:assert/strict';
import {BuildingService} from '../server/application/building-service.mjs';
import {MedicalService} from '../server/application/medical-service.mjs';
import {raidFixture} from './elite-raid-fixture.mjs';
test('polling unfinished production buildings does not repeatedly save the entire world',()=>{
 let writes=0,now=1000;const b={status:'constructing',completesAt:20000,productionWork:{completed:0,required:100}};const world={territories:{a:{buildings:[b]}}};
 const service=new BuildingService({economy:{},now:()=>now,save:()=>{writes++;b.status='active';}});service.getProduction=()=>({});
 for(let i=0;i<20;i++)service.settleConstructions(world);assert.equal(writes,0);now=20000;service.settleConstructions(world);assert.equal(writes,1);
});
test('legacy and paused construction retain correct settlement boundaries',()=>{
 let writes=0;const b={status:'constructing',completesAt:5000},world={territories:{a:{buildings:[b]}}};const service=new BuildingService({economy:{},now:()=>1000,save:()=>{writes++;b.productionWork={paused:true};b.completesAt=null;}});service.getProduction=()=>({});
 service.settleConstructions(world);service.settleConstructions(world);assert.equal(writes,1);
});
test('raid waiting on a busy defender does not clone and save the world every second',()=>{
 const f=raidFixture(),r=f.s.eliteRaids,d=r.day();d.raids=[{status:'waiting',route:[{territoryId:'a',ownerId:'a'}],index:0,results:[]}];r.rotation=()=>{};r.accountBusy=()=>true;let writes=0;f.s.save=()=>{writes++;};
 for(let i=1;i<=20;i++)r.advance(f.now+i*1000);assert.equal(writes,0);assert.equal(d.raids[0].status,'waiting');
 let starts=0;r.accountBusy=()=>false;r.startDefence=(_day,raid)=>{starts++;raid.status='battle';};r.advance(f.now+21000);r.advance(f.now+22000);assert.equal(starts,1);assert.equal(writes,2);
});
test('waiting raid rechecks eligibility so a changed owner is skipped even if defender is busy',()=>{
 const f=raidFixture(),r=f.s.eliteRaids,d=r.day();d.raids=[{status:'waiting',route:[{territoryId:'a',ownerId:'a'}],index:0,results:[]}];r.rotation=()=>{};r.accountBusy=()=>true;f.s.world.territories.a.ownerId='b';f.s.save=()=>{};r.advance(f.now+1000);assert.equal(d.raids[0].results[0].outcome,'skipped');
});
test('raid-paused treatment does not keep economy permanently due',()=>{
 const task={id:'task',playerId:'p',territoryId:'a',buildingId:'m',completesAt:500,raidPause:{until:20000}},a={id:'a',medicalTasks:{task}},world={territories:{a:{ownerId:'a',buildings:[{id:'m',raidSuppressed:true}]}}};
 const s=new MedicalService({accounts:new Map([['a',a]]),world,now:()=>1000});assert.equal(s.due(),false);world.territories.a.buildings[0].raidSuppressed=false;assert.equal(s.due(),true);
});
