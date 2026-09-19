import {isEliteTerritory} from '../shared/config/elite-clubs.mjs';
import {allocateOilDeposits} from '../scripts/build-oil-deposits.mjs';
import {territoryResourceMarkup,territoryResourceProfile} from '../client/resources/resource-markup.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {districtFixture} from './oil-fixture.mjs';
import {OIL_DEPOSIT_IDS,oilDeposit} from '../shared/config/oil-deposits.mjs';
import {BUILDING_DEFINITIONS} from '../shared/config/buildings.mjs';
import {districtSiteYield} from '../shared/buildings/district-yields.mjs';
import {relationKey} from '../shared/config/diplomacy.mjs';
import {CampaignService} from '../campaign-service.mjs';
const HOUR=3600000;
function fixture(){const f=districtFixture();f.s.oil.deposit=id=>id==='t1'?{oilPerHour:3}:null;f.s.buildings.oilDeposit=f.s.oil.deposit;return f;}
function second(f){const b=structuredClone(f.a);b.id='two';b.nickname='乙队';b.oil={...b.oil,balance:30,hourly:0};f.s.accounts.set(b.id,b);return b;}
test('oil deposits are deterministic, sparse, valid and distributed across every continent',()=>{const index=JSON.parse(fs.readFileSync(new URL('../assets/data/territory-index.json',import.meta.url)));assert.equal(OIL_DEPOSIT_IDS.length,60);assert.equal(new Set(OIL_DEPOSIT_IDS).size,60);for(const id of OIL_DEPOSIT_IDS){const tile=index.territories.find(t=>t.territoryId===id);assert.ok(tile);assert.equal(isEliteTerritory(tile),false,'oil must be conquerable: '+id);}for(const region of new Set(index.territories.map(t=>t.region))){const list=index.territories.filter(t=>t.region===region);const count=list.filter(t=>oilDeposit(t.territoryId)).length;assert.ok(count>0&&count/list.length<.12);}assert.equal(oilDeposit('t1'),null);});
test('oil wells only build on deposits; exactly one level, no upgrade via either method',()=>{const f=fixture(),{s,a}=f;const gold=a.gold;assert.throws(()=>s.buildings.build(a,s.world,'t2','oil-well','gold'),/石油资源/);assert.equal(a.gold,gold);assert.ok(!s.buildings.territoryView(a,s.world,'t2').availableTypes.includes('oil-well'));assert.ok(s.buildings.territoryView(a,s.world,'t1').availableTypes.includes('oil-well'));const b=f.build('oil-well');const view=s.buildings.publicBuilding(b,a);assert.equal(view.level,1);assert.equal(view.maxLevel,1);assert.equal(view.upgradeEnabled,false);assert.equal(view.nextEffectText,null);assert.equal(view.nextUpgradeCostProduction,null);for(const buildMethod of ['gold','production'])assert.throws(()=>s.buildings.upgrade(a,s.world,'t1',b.id,{buildMethod,expectedLevel:1,requestId:'oil-upgrade-'+buildMethod}),/最高等级/);assert.equal(BUILDING_DEFINITIONS['oil-well'].costsGold.length,1);assert.throws(()=>f.build('oil-well'),/同类设施/);});
test('oil settles only at whole-hour boundaries, carrying partial work without early income',()=>{const f=fixture(),{s,a}=f;assert.equal(a.oil.balance,30);f.build('oil-well');const start=f.time();f.setTime(start+HOUR/2);s.save();assert.equal(a.oil.balance,30);s.save();assert.equal(a.oil.balance,30);f.setTime(start+HOUR);s.save();assert.equal(a.oil.balance,33);assert.equal(a.oil.remainder,0);assert.equal(s.resourceState(a).hourly.oil,3);});
test('demolition and capture stop old-owner oil production at the event boundary',()=>{const f=fixture(),{s,a}=f;const b=f.build('oil-well'),start=f.time();f.setTime(start+HOUR);s.save();const other=second(f);s.world.territories.t1.ownerId=other.id;s.save();f.setTime(start+HOUR*2);s.save();assert.equal(a.oil.balance,33);assert.equal(other.oil.balance,33);s.world.territories.t1.buildings=[];s.save();f.setTime(start+HOUR*3);s.save();assert.equal(other.oil.balance,33);});
test('construction earns oil only after actual completion, including offline catch-up',()=>{const f=fixture(),{s,a}=f;const start=f.time();s.buildings.build(a,s.world,'t1','oil-well','production');const b=s.world.territories.t1.buildings[0],finish=b.completesAt;assert.ok(finish>start);f.setTime(finish+HOUR);s.save();assert.equal(b.status,'active');const tick=start+Math.floor((finish+HOUR-start)/HOUR)*HOUR;assert.equal(a.oil.balance,30+Math.floor((tick-finish)*3/HOUR));assert.equal(a.oil.balance*HOUR+a.oil.remainder+a.oil.pendingWork,33*HOUR);});
test('fuel estimate and shortage durations; save failure restores movement and fuel',()=>{const f=fixture(),{s,a}=f;for(const kind of ['expedition','scout']){const base={distanceKm:501,durationMs:180000};let e=s.oil.estimate(a,base,kind);assert.equal(e.oilRequired,kind==='scout'?3:6);assert.equal(e.durationMs,180000);a.oil.balance=0;e=s.oil.estimate(a,base,kind);assert.equal(e.oilSpent,0);assert.equal(e.durationMs,180000*(kind==='scout'?2:4));a.oil.balance=30;}const before=structuredClone(a.oil),save=s.repository.save;let saves=0;s.repository.save=v=>{if(++saves===2)throw Error('disk failure');return save(v);};assert.throws(()=>s.moveExpedition(a,'t1'),/disk failure/);assert.deepEqual(a.oil,before);assert.equal(a.expeditionPiece?.movement??null,null);});
test('oil settlement rollback and account reload preserve balance and remainder',()=>{const f=fixture(),{s,a}=f;f.build('oil-well');const old=structuredClone(a.oil);f.setTime(f.time()+HOUR/2);f.fail(true);assert.throws(()=>s.save(),/disk failure/);assert.deepEqual(a.oil,old);f.fail(false);s.save();assert.equal(a.oil.balance,30);const saved=f.saved();assert.equal(saved.accounts[a.id].oil.pendingWork,HOUR*3/2);});
test('oil orders escrow, partial buy, fee, retry and cancellation conserve resources',()=>{const f=fixture(),{s,a}=f,b=second(f),goldA=a.gold,goldB=b.gold;const order=s.oil.mutate(a,{action:'list',quantity:10,unitPrice:100,requestId:'oil-list-0001'});assert.equal(a.oil.balance,20);const body={action:'buy',orderId:order.orderId,quantity:4,requestId:'oil-buy-0001'};s.oil.mutate(b,body);assert.equal(b.oil.balance,34);assert.equal(b.gold,goldB-400);assert.equal(a.gold,goldA+392);s.oil.mutate(b,body);assert.equal(b.oil.balance,34);assert.throws(()=>s.oil.mutate(b,{...body,quantity:5}),/请求编号/);s.oil.mutate(a,{action:'cancel',orderId:order.orderId,requestId:'oil-cancel-001'});assert.equal(a.oil.balance,26);assert.equal(s.oil.market(a).orders.length,0);});
test('failed market save rolls back both wallets, both oil stocks and the escrow order',()=>{const f=fixture(),{s,a}=f,b=second(f);const o=s.oil.mutate(a,{action:'list',quantity:10,unitPrice:10,requestId:'oil-list-rollback'}),before=structuredClone([a,b,s.world.oilMarket]);f.fail(true);assert.throws(()=>s.oil.mutate(b,{action:'buy',orderId:o.orderId,quantity:2,requestId:'oil-buy-rollback'}),/disk failure/);assert.deepEqual([a,b,s.world.oilMarket],before);});
test('war prevents oil purchases; only allies can receive gifts',()=>{const f=fixture(),{s,a}=f,b=second(f);const o=s.oil.mutate(a,{action:'list',quantity:5,unitPrice:1,requestId:'oil-war-list'});s.world.diplomacy={relationships:{[relationKey(a.id,b.id)]:{players:[a.id,b.id],state:'war'}}};assert.throws(()=>s.oil.mutate(b,{action:'buy',orderId:o.orderId,quantity:1,requestId:'oil-war-buy'}),/交战/);assert.throws(()=>s.oil.mutate(a,{action:'gift',targetId:b.id,quantity:2,requestId:'oil-gift-no'}),/盟友/);s.world.diplomacy.relationships[relationKey(a.id,b.id)].state='alliance';s.oil.mutate(a,{action:'gift',targetId:b.id,quantity:2,requestId:'oil-gift-yes'});assert.equal(a.oil.balance,23);assert.equal(b.oil.balance,32);});
test('factory adjacency gets oil deposit plus completed well, but only on own land',()=>{const id=OIL_DEPOSIT_IDS[0],t={ownerType:'player',ownerId:'one',buildings:[]},world={territories:{[id]:t}},metadata=new Map([[id,{territoryId:id,landNeighbors:[]}]]),args={type:'factory',territoryId:id,ownerId:'one',world,metadata};assert.equal(districtSiteYield(args).adjacencyBonus,1);t.buildings.push({id:'well',type:'oil-well',status:'active'});assert.equal(districtSiteYield(args).adjacencyBonus,2);t.ownerId='two';assert.equal(districtSiteYield(args).adjacencyBonus,0);});

test('invalid quantities, overbuy, insufficient funds and unauthorized cancellation never transfer resources',()=>{const f=fixture(),{s,a}=f,b=second(f);for(const quantity of [-1,0,1.5,Infinity,1000001])assert.throws(()=>s.oil.mutate(a,{action:'list',quantity,unitPrice:1,requestId:'oil-invalid-q'}),/无效/);assert.equal(a.oil.balance,30);const o=s.oil.mutate(a,{action:'list',quantity:10,unitPrice:100,requestId:'oil-valid-list'});assert.throws(()=>s.oil.mutate(b,{action:'cancel',orderId:o.orderId,requestId:'oil-steal-cancel'}),/自己的/);assert.throws(()=>s.oil.mutate(b,{action:'buy',orderId:o.orderId,quantity:11,requestId:'oil-overbuy'}),/余量/);b.gold=0;assert.throws(()=>s.oil.mutate(b,{action:'buy',orderId:o.orderId,quantity:1,requestId:'oil-broke-buy'}),/金币不足/);assert.equal(b.oil.balance,30);assert.equal(s.world.oilMarket.orders[o.orderId].remaining,10);});

test('actual scout moves consume once, retain shortage duration, and cancel without refund',()=>{const f=fixture(),{s,a}=f,b=f.build('scout-center','t2');const scout=s.scouting.recruit(a,s.world,{territoryId:'t2',buildingId:b.id,count:1,requestId:'oil-recruit-scout'})[0];const body={scoutId:scout.id,territoryId:'t1',requestId:'oil-scout-move'};const estimate=s.estimateScoutMove(a,body).estimate;s.moveScout(a,body);assert.equal(a.oil.balance,30-estimate.oilRequired);s.moveScout(a,body);assert.equal(a.oil.balance,30-estimate.oilRequired);s.cancelScoutMove(a,scout.id,body.requestId);assert.equal(a.oil.balance,30-estimate.oilRequired);a.oil.balance=0;const slow=s.estimateScoutMove(a,body).estimate;const move=s.moveScout(a,{...body,requestId:'oil-scout-no-fuel'}).scout;assert.equal(move.movement.durationMs,slow.normalDurationMs*2);assert.equal(a.oil.balance,0);});
test('an expedition spends fuel at departure and preserves its chosen duration through later stock changes',()=>{const f=fixture(),{s,a}=f;const estimate=s.estimateExpedition(a,'t1').estimate;const result=s.moveExpedition(a,'t1');assert.equal(a.oil.balance,30-estimate.oilRequired);assert.equal(result.expeditionPiece.movement.durationMs,estimate.durationMs);a.oil.balance=0;assert.equal(a.expeditionPiece.movement.durationMs,estimate.durationMs);s.cancelExpedition(a);const slow=s.moveExpedition(a,'t1').expeditionPiece.movement;assert.equal(slow.oilSpent,0);assert.equal(slow.durationMs,slow.normalDurationMs*4);});

test('mainland-first oil allocation is reproducible and never lets remote islands consume the quota',()=>{const index=JSON.parse(fs.readFileSync(new URL('../assets/data/territory-index.json',import.meta.url))),rows=allocateOilDeposits(index);assert.deepEqual(rows.map(r=>r.territoryId),OIL_DEPOSIT_IDS);assert.deepEqual(allocateOilDeposits({...index,territories:[...index.territories].reverse()}),rows);assert.equal(rows.filter(r=>r.landmass==='mainland').length,58);assert.equal(rows.filter(r=>r.landmass==='island').length,2);for(const r of rows.filter(r=>r.landmass==='island'))assert.ok(['GBR','IRL'].includes(r.country));assert.equal(rows.filter(r=>r.region==='south-america'&&r.landmass==='mainland').length,17);assert.ok(rows.some(r=>['SWE','NOR','FIN'].includes(r.country)));});
test('both compact hover and full territory detail identify oil, wells and non-oil land',()=>{const territoryId=OIL_DEPOSIT_IDS[0],metadata={territoryId,resources:{terrain:['plains'],yields:{gold:12,production:1,science:0}}};for(const compact of [true,false]){const profile=territoryResourceProfile(metadata,{}),html=territoryResourceMarkup(profile,{compact});assert.match(html,/战略资源：石油/);assert.match(html,/修建油井后每小时 \+3 石油/);const built=territoryResourceProfile(metadata,{world:{territories:{[territoryId]:{buildings:[{type:'oil-well',status:'active'}]}}}});assert.match(territoryResourceMarkup(built,{compact}),/油井已建成/);const blank=territoryResourceProfile({...metadata,territoryId:'non-oil'},{});assert.match(territoryResourceMarkup(blank,{compact}),/无石油/);}});


test('a completed wonder on oil acts as one well; construction and non-oil wonders do not',()=>{
 const f=fixture(),{s,a}=f;
 const wonder={id:'wonder-fixture',type:'wonder:eiffel-tower',wonderId:'eiffel-tower',status:'constructing',level:1};
 s.world.territories.t1.buildings=[wonder];s.save();assert.equal(s.oil.view(a).production,0);
 wonder.status='active';s.save();const v=s.oil.view(a);
 assert.equal(v.production,3);assert.equal(v.wells.length,1);assert.match(v.sources[0].label,/奇观油田/);
 f.setTime(f.time()+HOUR);s.save();assert.equal(a.oil.balance,33);
 s.world.territories.t1.buildings.push({id:'well-fixture',type:'oil-well',status:'active',level:1});s.save();assert.equal(s.oil.view(a).production,3);
 s.world.territories.t2.buildings=[{...wonder,id:'dry-wonder'}];assert.equal(s.oil.view(a).production,3);
});

test('wonder oil production changes owner, stops on removal and supplies factory',()=>{
 const f=fixture(),{s,a}=f,other=second(f);
 s.world.territories.t1.buildings=[{id:'wonder-fixture',type:'wonder:eiffel-tower',wonderId:'eiffel-tower',status:'active',level:1}];
 f.build('factory','t2');a.oil.balance=0;s.save();assert.equal(s.oil.view(a).factorySupply.active,true);assert.equal(s.oil.view(a).hourly,2);
 f.setTime(f.time()+HOUR);s.save();assert.equal(a.oil.balance,2);
 s.world.territories.t1.ownerId=other.id;s.save();const oldBalance=a.oil.balance,otherBalance=other.oil.balance;
 f.setTime(f.time()+HOUR);s.save();assert.equal(a.oil.balance,oldBalance-1);assert.equal(other.oil.balance,otherBalance+3);
 s.world.territories.t1.buildings=[];s.save();const removedBalance=other.oil.balance;f.setTime(f.time()+HOUR);s.save();assert.equal(other.oil.balance,removedBalance);
});

test('wonder oil is visible in territory hover and detail without suggesting another well',()=>{
 const territoryId=OIL_DEPOSIT_IDS[0],metadata={territoryId};
 const state={world:{territories:{[territoryId]:{buildings:[{id:'w',type:'wonder:eiffel-tower',wonderId:'eiffel-tower',status:'active'}]}}}};
 for(const compact of [true,false]){
  const html=territoryResourceMarkup(territoryResourceProfile(metadata,state),{compact});
  assert.match(html,/奇观油田 · 每小时 \+3 石油/);assert.doesNotMatch(html,/修建油井后/);
 }
});


test('stocked expeditions can decline fuel; land and sea retain normal travel modifiers',()=>{
 for(const sea of [false,true]){
  const f=fixture(),{s,a}=f;s.wonders.isSeaJourney=()=>sea;
  if(sea)s.wonders.seaTravel=(_a,base)=>({...base,durationMs:180000});
  const normal=s.estimateExpedition(a,'t1').estimate;
  const preview=s.estimateExpedition(a,'t1',{useOil:false}).estimate;
  assert.equal(preview.durationMs,normal.durationMs*4);assert.equal(preview.oilSpent,0);assert.equal(preview.oilShortage,false);
  const balance=a.oil.balance,trip=s.moveExpedition(a,'t1',{useOil:false}).expeditionPiece.movement;
  assert.equal(trip.durationMs,preview.durationMs);assert.equal(trip.useOil,false);assert.equal(a.oil.balance,balance);
  s.save();assert.equal(f.saved().accounts[a.id].expeditionPiece.movement.useOil,false);
  s.cancelExpedition(a);assert.equal(a.oil.balance,balance);
  s.moveExpedition(a,'t1',{useOil:true});assert.equal(a.oil.balance,balance-normal.oilRequired);
 }
});
test('stocked scout slow moves consume no oil, retries cannot change the mode',()=>{
 const f=fixture(),{s,a}=f,b=f.build('scout-center','t2');
 const scout=s.scouting.recruit(a,s.world,{territoryId:'t2',buildingId:b.id,count:1,requestId:'optional-oil-recruit'})[0];
 const body={scoutId:scout.id,territoryId:'t1',useOil:false,requestId:'optional-oil-scout'};
 const fast=s.estimateScoutMove(a,{...body,useOil:true}).estimate,slow=s.estimateScoutMove(a,body).estimate;
 assert.equal(slow.durationMs,fast.durationMs*2);assert.equal(slow.stepDurationMs,slow.durationMs);
 const balance=a.oil.balance;s.moveScout(a,body);s.moveScout(a,body);assert.equal(a.oil.balance,balance);
 assert.throws(()=>s.moveScout(a,{...body,useOil:true}),/其他行程/);
 s.cancelScoutMove(a,scout.id,body.requestId);s.moveScout(a,{...body,useOil:true,requestId:'optional-oil-fast'});
 assert.equal(a.oil.balance,balance-fast.oilRequired);
});
test('invalid fuel modes are rejected without starting expedition movement',()=>{
 const {s,a}=fixture();for(const useOil of ['false',0,null,{}])assert.throws(()=>s.moveExpedition(a,'t1',{useOil}),e=>e.statusCode===400);
 assert.equal(a.expeditionPiece?.movement??null,null);assert.equal(a.oil.balance,30);
});
