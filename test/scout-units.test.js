import {setTestWar} from './diplomacy-fixture.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { territoryTravelEstimate } from "../server/domain/expedition-piece.mjs";
import { ScoutingService } from "../server/application/scouting-service.mjs";
import { BuildingService } from "../server/application/building-service.mjs";
import { EconomyService } from "../server/application/economy-service.mjs";
import { scoutEnglishName, scoutMovementFrame } from "../shared/scouting/scout-units.mjs";
import { createTerritoryWorld, claimHome, captureTerritory } from "../territory-model.js";

function fixture() {
  let clock=1000, fail=false, saved=null;
  const account={id:"p",setupComplete:true,homeTerritoryId:"capital",gold:10000,draft:{roster:[]}};
  const catalog=["C","B","S"].flatMap(grade=>["西班牙","德国"].flatMap(nationality=>Array.from({length:4},(_,i)=>({id:grade+nationality+i,name:nationality+i,grade,nationality,overall:80,pool:"ATT",role:"ST",attributes:{}}))));
  const territoryIndex={territories:[
    {territoryId:"capital",centroid:[-1,0],landNeighbors:["center"],countryCode:"ESP",country:"西班牙",name:"首都"},
    {territoryId:"center",centroid:[0,0],landNeighbors:["capital","b"],countryCode:"ESP",country:"西班牙",name:"球探中心地块"},
    {territoryId:"b",centroid:[1,0],landNeighbors:["center","c"],countryCode:"DEU",country:"德国",name:"目的地"},
    {territoryId:"c",centroid:[3,0],landNeighbors:["b"],countryCode:"DEU",country:"德国",name:"边地"},
    {territoryId:"island",centroid:[12,0],landNeighbors:[],neighbors:["center"],countryCode:"ESP",country:"西班牙",name:"海岛"},
  ]};
  const building={id:"center-1",type:"scout-center",status:"active",level:1};
  const world={revision:0,players:{p:{territoryIds:["capital","center","b","c","island"]}},territories:Object.fromEntries(territoryIndex.territories.map(t=>[t.territoryId,{territoryId:t.territoryId,ownerType:"player",ownerId:"p",buildings:t.territoryId==="center"?[building]:[]}]))};
  const economy=new EconomyService({now:()=>clock});
  const service=new ScoutingService({playerDatabase:catalog,territoryIndex,economy,buildings:new BuildingService({economy,now:()=>clock}),now:()=>clock,random:()=>.5,save(){if(fail)throw Error("disk failure");saved=structuredClone({account,world});}});
  const recruit=(count=1,requestId="recruit-1")=>service.recruit(account,world,{territoryId:"center",buildingId:"center-1",count,requestId});
  return {account,world,service,building,recruit,territoryIndex,setTime:t=>clock=t,failSave:v=>fail=v,saved:()=>saved};
}
test("LV1 recruits two unique English names at the non-capital center; retry cannot grant more",()=>{
  const f=fixture(), units=f.recruit(2);
  assert.equal(units.length,2);
  assert.deepEqual(units.map(u=>u.territoryId),["center","center"]);
  assert.deepEqual(units.map(u=>u.originTerritoryId),["center","center"]);
  assert.ok(units.every(u=>/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(u.name)));
  assert.notEqual(units[0].name,units[1].name);
  assert.deepEqual(f.recruit(2).map(u=>u.id),units.map(u=>u.id));
  assert.throws(()=>f.recruit(1,"recruit-2"),/最多拥有 2/);
  assert.throws(()=>f.recruit(1),/另一项/);
  assert.equal(f.account.gold,10000);
  assert.equal(f.service.details(f.account,f.world,"center","center-1").recruitAvailable,0);
});
test("recruit count validation and disk failure never create partial scouts",()=>{
  const f=fixture();
  for(const count of [0,3,1.5,"2"]) assert.throws(()=>f.recruit(count),/1～2/);
  f.failSave(true); assert.throws(()=>f.recruit(2),/disk failure/);
  assert.equal(f.account.scouting,undefined);
  f.failSave(false); assert.equal(f.recruit(2).length,2);
});
test("names remain distinct even when random produces the same roll",()=>{
  const first=scoutEnglishName([],()=>0);
  assert.match(first,/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.notEqual(first,scoutEnglishName([first],()=>0));
});
test("scouts can travel to disconnected owned land and islands using expedition timing, but never to foreign territory",()=>{
  const f=fixture(), scoutId=f.recruit()[0].id;
  assert.deepEqual(f.service.estimate(f.account,f.world,{scoutId,territoryId:"c"}).path,["center","c"]);
  const estimate=f.service.estimate(f.account,f.world,{scoutId,territoryId:"island"});
  const army=territoryTravelEstimate(f.territoryIndex,"center","island");
  assert.equal(estimate.durationMs,army.durationMs);assert.equal(estimate.distanceKm,army.distanceKm);
  assert.equal(estimate.durationMs,360000);
  assert.deepEqual(estimate.path,["center","island"]);
  f.world.territories.b.ownerId="other";
  assert.throws(()=>f.service.estimate(f.account,f.world,{scoutId,territoryId:"b"}),/己方、盟友或当前可见的中立/);
  assert.deepEqual(f.service.estimate(f.account,f.world,{scoutId,territoryId:"c"}).path,["center","c"]);
  assert.deepEqual(f.service.unitDetails(f.account,f.world,scoutId).scout.movableTerritoryIds,["capital","c","island"]);
  assert.throws(()=>f.service.unitDetails({id:"other"},f.world,scoutId),/不存在/);
});
test("server-timed direct travel survives reload and discovers at the destination country",()=>{
  const f=fixture(), scoutId=f.recruit()[0].id;
  const unit=f.service.move(f.account,f.world,{scoutId,territoryId:"c",requestId:"move-to-c"});
  assert.equal(unit.movement.durationMs,120000);
  assert.deepEqual(f.service.move(f.account,f.world,{scoutId,territoryId:"c",requestId:"move-to-c"}).movement,unit.movement);
  assert.throws(()=>f.service.move(f.account,f.world,{scoutId,territoryId:"b",requestId:"move-to-c"}),/其他行程或移动方式/);
  assert.throws(()=>f.service.start(f.account,f.world,{scoutId,requestId:"while-moving"}),/移动/);
  const restored=f.saved().account;
  f.setTime(91000);
  const midway=f.service.unitDetails(restored,f.world,scoutId).scout;
  assert.equal(midway.territoryId,"center");
  assert.equal(scoutMovementFrame(midway.movement,91000).progress,.75);
  f.setTime(121000);
  const arrived=f.service.unitDetails(restored,f.world,scoutId).scout;
  assert.equal(arrived.territoryId,"c");assert.equal(arrived.movement,null);
  const task=f.service.start(restored,f.world,{scoutId,territoryId:"c",requestId:"discover-c"});
  assert.equal(task.countryCode,"DEU");assert.equal(task.territoryId,"c");
  f.setTime(task.completesAt);
  assert.ok(f.service.publicTask(restored.scouting.tasks[task.id]).cards.every(card=>card.nationality==="德国"));
});
test("cancellation returns to departure and a stale cancel cannot stop a new trip",()=>{
  const f=fixture(), scoutId=f.recruit()[0].id;
  f.service.move(f.account,f.world,{scoutId,territoryId:"c",requestId:"move-one"});
  f.setTime(71000);
  const stopped=f.service.cancelMove(f.account,f.world,scoutId,"move-one");
  assert.equal(stopped.territoryId,"center");assert.equal(stopped.movement,null);
  f.service.move(f.account,f.world,{scoutId,territoryId:"c",requestId:"move-two"});
  assert.throws(()=>f.service.cancelMove(f.account,f.world,scoutId,"move-one"),/行程已变化/);
  assert.equal(f.service.unitDetails(f.account,f.world,scoutId).scout.movement.id,"move-two");
});
test("destination loss stops travel; losing the current tile returns to center without losing paid candidates",()=>{
  const f=fixture(), scoutId=f.recruit()[0].id;
  f.service.move(f.account,f.world,{scoutId,territoryId:"c",requestId:"move-one"});
  f.world.territories.c.ownerId="other";
  f.setTime(121000);
  assert.equal(f.service.unitDetails(f.account,f.world,scoutId).scout.territoryId,"center");
  assert.equal(f.service.unitDetails(f.account,f.world,scoutId).scout.movement,null);
  f.world.territories.b.ownerId="p";
  f.service.move(f.account,f.world,{scoutId,territoryId:"b",requestId:"move-two"});
  f.setTime(181000);
  const task=f.service.start(f.account,f.world,{scoutId,requestId:"discovery-one"});
  f.world.territories.b.ownerId="other"; f.setTime(task.completesAt);
  const detail=f.service.unitDetails(f.account,f.world,scoutId);
  assert.equal(detail.scout.territoryId,"center");
  assert.equal(detail.task.territoryId,"b");
  assert.equal(detail.task.status,"ready");
  assert.ok(f.service.choose(f.account,task.id,detail.task.cards[0].playerId));
});
test("two scouts keep independent work; working and ready scouts cannot move",()=>{
  const f=fixture(), [a,b]=f.recruit(2);
  const task=f.service.start(f.account,f.world,{scoutId:a.id,requestId:"discovery-a"});
  f.service.move(f.account,f.world,{scoutId:b.id,territoryId:"b",requestId:"movement-b"});
  assert.equal(f.service.publicState(f.account,f.world).scouts.find(u=>u.id===a.id).status,"working");
  assert.throws(()=>f.service.estimate(f.account,f.world,{scoutId:a.id,territoryId:"b"}),/选择球员/);
  f.setTime(task.completesAt);
  assert.throws(()=>f.service.move(f.account,f.world,{scoutId:a.id,territoryId:"b",requestId:"movement-a"}),/选择球员/);
  f.service.settle(f.account,f.world);
  assert.equal(f.service.publicState(f.account,f.world).scouts.find(u=>u.id===b.id).status,"idle");
});
test("movement save failures restore both path and request identity",()=>{
  const f=fixture(), scoutId=f.recruit()[0].id;
  f.failSave(true);
  assert.throws(()=>f.service.move(f.account,f.world,{scoutId,territoryId:"b",requestId:"move-one"}),/disk failure/);
  assert.equal(f.account.scouting.units[scoutId].movement,null);
  assert.equal(f.account.scouting.units[scoutId].moveRequests,undefined);
  f.failSave(false); f.service.move(f.account,f.world,{scoutId,territoryId:"b",requestId:"move-one"});
  f.setTime(61000);f.failSave(true);
  assert.throws(()=>f.service.unitDetails(f.account,f.world,scoutId),/disk failure/);
  assert.equal(f.account.scouting.units[scoutId].territoryId,"center");
  assert.ok(f.account.scouting.units[scoutId].movement);
  f.failSave(false);assert.equal(f.service.unitDetails(f.account,f.world,scoutId).scout.territoryId,"b");
});
test("legacy multi-center save consolidates once, refunds removed base costs and keeps paid tasks",()=>{
  const f=fixture();
  f.world.territories.b.buildings=[{id:"center-2",type:"scout-center",level:2,status:"active"}];
  f.world.territories.c.buildings=[{id:"center-3",type:"scout-center",level:1,status:"constructing"}];
  f.account.scouting={tasks:{old:{id:"old",level:1,territoryId:"center",buildingId:"center-1",startedAt:0,completesAt:1000,claimedAt:null,candidates:[{id:"old-card",name:"Old",grade:"C",overall:75}]}}};
  const accounts=new Map([["p",f.account]]);
  assert.equal(f.service.migrate(accounts,f.world),true);
  assert.equal(f.account.gold,20000);
  assert.equal(f.world.territories.center.buildings.length,0);
  assert.equal(f.world.territories.b.buildings[0].id,"center-2");
  assert.equal(f.world.territories.c.buildings.length,0);
  assert.equal(f.service.units(f.account).length,0);
  assert.equal(f.service.taskDetails(f.account,"old").task.status,"ready");
  assert.ok(f.service.choose(f.account,"old","old-card"));
  assert.equal(f.service.migrate(accounts,f.world),false);
  assert.equal(f.account.gold,20000);
  const scouts=f.service.recruit(f.account,f.world,{territoryId:"b",buildingId:"center-2",count:2,requestId:"recruit-new"});
  assert.ok(scouts.every(u=>u.territoryId==="b"));
});
test("capturing another scout center retains one owned center, or keeps the captured center when none exists",()=>{
  const index={territories:["a","b","c"].map((id,i)=>({territoryId:id,playable:true,spawnAllowed:true,initialOwner:{type:"neutral"},neighbors:i===0?["b"]:i===1?["a","c"]:["b"],landNeighbors:i===0?["b"]:i===1?["a","c"]:["b"]}))};
  for(const hasCenter of [false,true]) {
    const world=createTerritoryWorld(index);
    claimHome(index,world,"p","a");claimHome(index,world,"q","c");setTestWar(world,"p","q");captureTerritory(index,world,"q","b");
    if(hasCenter)world.territories.a.buildings.push({id:"owned",type:"scout-center"});
    world.territories.b.buildings=[{id:"captured",type:"scout-center"},{id:"training",type:"training-center"}];
    captureTerritory(index,world,"p","b");
    assert.equal(world.territories.b.buildings.some(b=>b.type==="scout-center"),!hasCenter);
    assert.ok(world.territories.b.buildings.some(b=>b.type==="training-center"));
  }
});


test("an existing multi-edge saved trip retains its old clock and waypoints after the travel-rule update",()=>{
  const f=fixture(), scoutId=f.recruit()[0].id;
  f.account.scouting.units[scoutId].movement={id:"old-trip",path:["center","b","c"],fromTerritoryId:"center",toTerritoryId:"c",stepDurationMs:60000,durationMs:120000,startedAt:1000,arrivesAt:121000};
  const restored=structuredClone(f.account);
  f.setTime(91000);
  assert.equal(f.service.unitDetails(restored,f.world,scoutId).scout.territoryId,"b");
  assert.equal(scoutMovementFrame(restored.scouting.units[scoutId].movement,91000).progress,.5);
  f.setTime(121000);
  assert.equal(f.service.unitDetails(restored,f.world,scoutId).scout.territoryId,"c");
  assert.equal(restored.scouting.units[scoutId].movement,null);
});
test("cross-sea travel survives a persisted reload and can be canceled or arrive normally",()=>{
  const f=fixture(), scoutId=f.recruit()[0].id;
  const moving=f.service.move(f.account,f.world,{scoutId,territoryId:"island",requestId:"cross-sea"});
  assert.equal(moving.movement.routeMode,"direct");
  const restored=f.saved().account;
  f.setTime(moving.movement.startedAt + moving.movement.durationMs / 2);
  const midway=f.service.unitDetails(restored,f.world,scoutId).scout;
  assert.equal(scoutMovementFrame(midway.movement,moving.movement.startedAt+moving.movement.durationMs/2).progress,.5);
  assert.equal(midway.territoryId,"center");
  assert.equal(f.service.cancelMove(restored,f.world,scoutId,"cross-sea").territoryId,"center");
  f.setTime(moving.movement.arrivesAt);
  assert.equal(f.service.unitDetails(f.account,f.world,scoutId).scout.territoryId,"island");
});

test('renaming a moving scout persists its name without restarting or cancelling either scout',()=>{
 const f=fixture(),[one,two]=f.recruit(2);f.service.move(f.account,f.world,{scoutId:one.id,territoryId:'island',requestId:'rename-moving'});
 const before=structuredClone(f.account.scouting.units),renamed=f.service.rename(f.account,f.world,{scoutId:one.id,name:'  南美观察员  '});
 assert.equal(renamed.name,'南美观察员');assert.deepEqual(renamed.movement,before[one.id].movement);assert.deepEqual(f.account.scouting.units[two.id],before[two.id]);
 assert.equal(f.service.unitDetails(f.saved().account,f.world,one.id).scout.name,'南美观察员');
 f.failSave(true);assert.throws(()=>f.service.rename(f.account,f.world,{scoutId:one.id,name:'不会保存'}),/disk failure/);assert.equal(f.account.scouting.units[one.id].name,'南美观察员');assert.deepEqual(f.account.scouting.units[one.id].movement,before[one.id].movement);
});
test('renaming updates the active discovery label and preserves its paid candidates',()=>{
 const f=fixture(),scoutId=f.recruit()[0].id;const task=f.service.start(f.account,f.world,{scoutId,requestId:'rename-working'});
 const before=structuredClone(f.account.scouting.tasks[task.id]);
 f.service.rename(f.account,f.world,{scoutId,name:'欧洲观察员'});
 assert.deepEqual(f.account.scouting.tasks[task.id],{...before,scoutName:'欧洲观察员'});
});
test('scout rename validates names and ownership before changing state',()=>{
 const f=fixture(),scoutId=f.recruit()[0].id,before=structuredClone(f.account);
 for(const name of ['', '   ', '球'.repeat(25), 'bad\nname', 'bad\u202ename', null, 12])assert.throws(()=>f.service.rename(f.account,f.world,{scoutId,name}));
 assert.throws(()=>f.service.rename({id:'other'},f.world,{scoutId,name:'禁止'}),/不存在/);assert.deepEqual(f.account,before);
 assert.equal(f.service.rename(f.account,f.world,{scoutId,name:'球'.repeat(24)}).name,'球'.repeat(24));
});


test('allied travel and discovery use the scout owner level and fixed price, then revoke cleanly',async()=>{
 const {relationKey}=await import('../shared/config/diplomacy.mjs');const f=fixture(),unit=f.recruit()[0];
 f.world.territories.b.ownerId='ally';f.world.players.p.territoryIds=f.world.players.p.territoryIds.filter(id=>id!=='b');
 f.world.diplomacy={relationships:{[relationKey('p','ally')]:{players:['p','ally'],state:'friendship'}}};
 assert.throws(()=>f.service.estimate(f.account,f.world,{scoutId:unit.id,territoryId:'b'}),/只能移动/);
 f.world.diplomacy.relationships[relationKey('p','ally')].state='alliance';f.building.level=5;
 const moved=f.service.move(f.account,f.world,{scoutId:unit.id,territoryId:'b',requestId:'allied-move'});f.setTime(moved.movement.arrivesAt);f.service.settle(f.account,f.world);
 assert.equal(f.account.scouting.units[unit.id].territoryId,'b');const gold=f.account.gold;
 const task=f.service.start(f.account,f.world,{scoutId:unit.id,territoryId:'b',requestId:'allied-discover'});assert.equal(task.level,5);assert.equal(f.account.gold,gold-700);
 f.world.diplomacy.relationships[relationKey('p','ally')].state='friendship';f.service.settle(f.account,f.world);
 assert.equal(f.account.scouting.units[unit.id].territoryId,'center');assert.equal(f.account.scouting.tasks[task.id].territoryId,'b');
 f.setTime(task.completesAt);const chosen=f.service.choose(f.account,task.id,f.account.scouting.tasks[task.id].candidates[0].id);assert.ok(chosen);
});

test('twenty-round prepaid queue survives reload, hides unfinished results and grants all choices atomically once',()=>{
 const f=fixture();f.account.gold=50000;const scout=f.recruit()[0];const input={scoutId:scout.id,territoryId:'center',requestId:'twenty-rounds',rounds:20};
 const result=f.service.start(f.account,f.world,input),task=f.account.scouting.tasks[result.id];assert.equal(f.account.gold,36000);assert.equal(result.roundCount,20);assert.deepEqual(result.rounds,[]);assert.deepEqual(result.cards,[]);
 assert.equal(f.service.start(f.account,f.world,input).id,result.id);assert.equal(f.account.gold,36000);assert.throws(()=>f.service.start(f.account,f.world,{...input,rounds:19}),/请求编号/);
 const selections=task.rounds.map(r=>r.candidates[0].id);f.setTime(task.startedAt+task.roundDurationMs*19);assert.equal(f.service.publicTask(task).completedRounds,19);assert.throws(()=>f.service.claimQueue(f.account,task.id,selections),/尚未全部完成/);
 f.setTime(task.completesAt);Object.assign(f.account,JSON.parse(JSON.stringify(f.account)));assert.equal(f.service.publicTask(f.account.scouting.tasks[task.id]).rounds.length,20);
 assert.throws(()=>f.service.choose(f.account,task.id,selections[0]),/统一领取/);assert.throws(()=>f.service.claimQueue(f.account,task.id,[...selections.slice(1),selections[0]]),/对应轮次/);
 f.failSave(true);const before=structuredClone(f.account);assert.throws(()=>f.service.claimQueue(f.account,task.id,selections),/disk failure/);assert.deepEqual(f.account,before);f.failSave(false);
 assert.equal(f.service.claimQueue(f.account,task.id,selections).length,20);assert.equal(f.account.draft.roster.length,20);f.service.claimQueue(f.account,task.id,selections);assert.equal(f.account.draft.roster.length,20);
});
test('queue rejects out-of-range rounds, insufficient total funds and rolls back failed scheduling',()=>{
 const f=fixture(),scout=f.recruit()[0],input={scoutId:scout.id,requestId:'queue-validation'};
 for(const rounds of [0,21,1.5,'2',null])assert.throws(()=>f.service.start(f.account,f.world,{...input,rounds}),/1～20/);
 assert.throws(()=>f.service.start(f.account,f.world,{...input,rounds:20}),/金币不足/);assert.equal(f.account.gold,10000);
 f.failSave(true);const before=structuredClone(f.account);assert.throws(()=>f.service.start(f.account,f.world,{...input,rounds:3}),/disk failure/);assert.deepEqual(f.account,before);
});


test('neutral scouting reveals on arrival, persists exploration and rejects neutral discoveries without charging',async()=>{
 const {FogService}=await import('../server/application/fog-service.mjs');
 const f=fixture(),scoutId=f.recruit()[0].id;
 for(const id of ['b','c','island'])Object.assign(f.world.territories[id],{ownerType:'neutral',ownerId:null});
 f.territoryIndex.territories.find(t=>t.territoryId==='island').neighbors=[];
 f.service.fog=new FogService({territoryIndex:f.territoryIndex,now:f.service.now});
 assert.ok(f.service.publicUnit(f.account,f.account.scouting.units[scoutId],f.world).movableTerritoryIds.includes('b'));
 assert.throws(()=>f.service.estimate(f.account,f.world,{scoutId,territoryId:'c'}),/当前可见/);
 const moved=f.service.move(f.account,f.world,{scoutId,territoryId:'b',requestId:'neutral-explore-1'});
 assert.ok(!f.service.fog.update(f.account,f.world).view.visibleTerritoryIds.includes('c'));
 f.setTime(moved.movement.arrivesAt);f.service.settle(f.account,f.world);
 assert.ok(f.service.fog.update(f.account,f.world).view.visibleTerritoryIds.includes('c'));
 assert.equal(f.world.territories.b.ownerType,'neutral');assert.equal(f.service.unitDetails(f.account,f.world,scoutId).canDiscover,false);
 const gold=f.account.gold;
 assert.throws(()=>f.service.start(f.account,f.world,{scoutId,requestId:'neutral-dig-denied'}),/中立地块/);
 assert.equal(f.account.gold,gold);assert.equal(Object.keys(f.account.scouting.tasks).length,0);
 const back=f.service.move(f.account,f.world,{scoutId,territoryId:'capital',requestId:'neutral-return-1'});f.setTime(back.movement.arrivesAt);f.service.settle(f.account,f.world);
 const view=f.service.fog.update(f.account,f.world).view;
 assert.ok(!view.visibleTerritoryIds.includes('c'));assert.ok(view.exploredTerritoryIds.includes('c'));assert.ok(view.exploredScoutTerritoryIds.includes('b'));
});
