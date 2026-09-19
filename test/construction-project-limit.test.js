import test from 'node:test';
import assert from 'node:assert/strict';
import {districtFixture} from './oil-fixture.mjs';
import {constructionProjectState} from '../shared/buildings/construction-limit.mjs';
import {buildingPanelMarkup} from '../client/buildings/building-panel-controller.js';
import {facilityEffects} from '../shared/config/facility-levels.mjs';
function start(f,i){return f.s.buildings.build(f.a,f.s.world,'t'+i,'club-shop','production');}
test('five concurrent projects combine new buildings, upgrades and wonders across all territories',()=>{
 const f=districtFixture(),{s,a}=f,facility=f.build('port','t6');
 for(let i=1;i<=4;i++)start(f,i);
 f.upgrade(facility,'t6','production');
 assert.equal(constructionProjectState(a,s.world).activeProjects,5);
 const gold=a.gold;assert.throws(()=>start(f,5),e=>e.code==='construction-project-limit');assert.equal(a.gold,gold);
 const other=f.build('recovery-center','t7');assert.equal(other.status,'active');
 assert.throws(()=>f.upgrade(other,'t7','production'),/上限为 5/);
 assert.throws(()=>s.wonders.build(a,'t8',s.wonders.catalog()[0].wonderId,'production'),/上限为 5/);
 s.buildings.cancelUpgrade(a,s.world,'t6',facility.id);assert.equal(constructionProjectState(a,s.world).activeProjects,4);
 start(f,5);assert.equal(constructionProjectState(a,s.world).activeProjects,5);
});
test('existing excess projects are retained, allies excluded and wonder jobs count',()=>{
 const f=districtFixture(),{s,a}=f;
 for(let i=1;i<=6;i++)s.world.territories['t'+i].buildings=[{id:'legacy'+i,type:'wonder:test',wonderId:'test',status:'constructing'}];
 assert.equal(constructionProjectState(a,s.world).activeProjects,6);assert.throws(()=>start(f,7),/上限/);
 assert.equal(constructionProjectState(a,s.world).activeProjects,6);
 s.world.territories.t6.ownerId='ally';assert.equal(constructionProjectState(a,s.world).activeProjects,5);
 s.world.territories.t5.buildings[0].status='active';start(f,7);assert.equal(constructionProjectState(a,s.world).activeProjects,5);
});
test('completed projects free slots before the next construction request',()=>{
 const f=districtFixture();for(let i=1;i<=5;i++)start(f,i);
 f.setTime(f.time()+86400000);start(f,6);assert.equal(constructionProjectState(f.a,f.s.world).activeProjects,1);
});
test('building view exposes project capacity and disables only queued construction buttons',()=>{
 const f=districtFixture();for(let i=1;i<=5;i++)start(f,i);
 const view=f.s.buildings.territoryView(f.a,f.s.world,'t6');assert.equal(view.production.projectLimit,5);assert.equal(view.production.remainingProjectSlots,0);
 const html=buildingPanelMarkup({view,catalog:f.s.buildings.catalog(),walletGold:f.a.gold});
 assert.match(html,/施工 5\/5 · 名额已满/);
 for(const match of html.matchAll(/<button[^>]+data-build-method="production"[^>]*>/g))assert.match(match[0],/disabled/);
 const goldButtons=[...html.matchAll(/<button[^>]+data-build-method="gold"[^>]*>/g)];assert.ok(goldButtons.length);assert.ok(goldButtons.some(m=>!m[0].includes('disabled')));
});
test('club shops retain starter income and scale moderately at high levels',()=>{
 assert.deepEqual([1,2,3,4,5].map(l=>facilityEffects('club-shop',l).goldPerHour),[60,120,220,360,540]);
});

test('a wonder can take the fifth shared construction slot and blocks a sixth ordinary project',()=>{
 const f=districtFixture();for(let i=1;i<=4;i++)start(f,i);
 f.s.wonders.getConstruction=()=>({totalProduction:400,adjacentBuildings:[],terrain:{anyOf:[],allOf:[]},playerCollection:null});
 f.s.wonders.build(f.a,'t5','eiffel-tower','production');assert.equal(constructionProjectState(f.a,f.s.world).activeProjects,5);
 assert.throws(()=>start(f,6),/上限为 5/);
});
