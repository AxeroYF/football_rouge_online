import test from "node:test";
import assert from "node:assert/strict";
import { BuildingService } from "../server/application/building-service.mjs";
import { EconomyService } from "../server/application/economy-service.mjs";
import { TrainingService } from "../server/application/training-service.mjs";
import { ScoutingService } from "../server/application/scouting-service.mjs";
import { CampaignService } from "../campaign-service.mjs";
import { BUILDING_DEFINITIONS } from "../shared/config/buildings.mjs";
import { PLAYER_ATTRIBUTE_LABELS } from "../shared/config/player-attributes.mjs";

function fixture(type = "training-center") {
  let now = 1000, fail = false, saved;
  const account = { id:"p", setupComplete:true, gold:10000, draft:{roster:[
    { id:"player", playerId:"player", name:"测试球员", pool:"ATT", role:"ST", grade:"C", overall:70, attributes:Object.fromEntries(Object.keys(PLAYER_ATTRIBUTE_LABELS).map(key=>[key,70])) }
  ]}};
  const territoryIndex = {territories:[{territoryId:"a",country:"西班牙",countryCode:"ESP",name:"甲",centroid:[0,0]},{territoryId:"b",country:"英国",countryCode:"GBR",name:"乙",centroid:[10,0]}]};
  const building = {id:"center",type,status:"active",level:1};
  const world = {revision:1,territories:{a:{ownerType:"player",ownerId:"p",buildings:[building],version:1},b:{ownerType:"player",ownerId:"p",buildings:[],version:0}},players:{p:{territoryIds:["a","b"]}}};
  const save = ()=>{ if(fail)throw Error("disk failure"); saved=JSON.stringify({account,world}); };
  const economy=new EconomyService({now:()=>now});
  const buildings=new BuildingService({economy,now:()=>now,save});
  const training=new TrainingService({buildings,territoryIndex,now:()=>now,random:()=>0,save});
  const catalog=Array.from({length:5},(_,i)=>({id:"card"+i,name:"候选"+i,grade:"C",nationality:"西班牙",overall:70,pool:"ATT",role:"ST",attributes:{}}));
  const scouting=new ScoutingService({buildings,economy,territoryIndex,playerDatabase:catalog,now:()=>now,random:()=>0.5,save});
  const options={territoryId:"a",buildingId:"center",requestId:"demolish-001"};
  return {account,world,building,buildings,training,scouting,options,setTime:value=>now=value,failSave:value=>fail=value,saved:()=>JSON.parse(saved)};
}
test("demolition releases the exact slot without gold change; receipt survives reload and protects a replacement",()=>{
  const f=fixture("scout-center"), beforeGold=f.account.gold;
  assert.equal(f.buildings.demolitionPreview(f.account,f.world,"a","center").canDemolish,true);
  const result=f.buildings.demolish(f.account,f.world,f.options);
  assert.equal(result.territory.availableSlots,1);
  assert.ok(result.territory.availableTypes.includes("scout-center"));
  assert.equal(f.account.gold,beforeGold);
  const saved=f.saved();
  saved.world.territories.a.buildings.push({...f.building,id:"replacement"});
  f.buildings.demolish(saved.account,saved.world,f.options);
  assert.equal(saved.world.territories.a.buildings[0].id,"replacement");
  assert.throws(()=>f.buildings.demolish(saved.account,saved.world,{...f.options,buildingId:"replacement"}),/另一座设施/);
  assert.throws(()=>f.buildings.demolish(saved.account,saved.world,{...f.options,requestId:"another-request"}),/不存在或已拆除/);
});
test("demolition revalidates owner, exact ID, supported type, setup and request identity",()=>{
  const f=fixture(), snapshot=structuredClone(f.world);
  assert.throws(()=>f.buildings.demolish({...f.account,id:"other"},f.world,f.options),/自己的/);
  assert.throws(()=>f.buildings.demolish(f.account,f.world,{...f.options,buildingId:"wrong"}),/不存在/);
  assert.throws(()=>f.buildings.demolish(f.account,f.world,{...f.options,requestId:""}),/请求/);
  assert.throws(()=>f.buildings.demolish({...f.account,setupComplete:false},f.world,f.options),/初始建队/);
  assert.deepEqual(f.world,snapshot);
  f.building.type="club-headquarters";
  assert.throws(()=>f.buildings.demolish(f.account,f.world,f.options),/不能拆除/);
});
test("a training started after preview blocks demolition, cancellation permits it and retains the player",()=>{
  const f=fixture();
  assert.equal(f.buildings.demolitionPreview(f.account,f.world,"a","center").canDemolish,true);
  const task=f.training.start(f.account,f.world,{territoryId:"a",buildingId:"center",pool:"ATT",slot:0,playerId:"player",requestId:"training-001"});
  assert.equal(f.buildings.demolitionPreview(f.account,f.world,"a","center").canDemolish,false);
  assert.throws(()=>f.buildings.demolish(f.account,f.world,f.options),/完成或取消/);
  assert.equal(f.account.draft.roster[0].training.taskId,task.id);
  f.training.cancel(f.account,task.id);
  f.buildings.demolish(f.account,f.world,f.options);
  assert.equal(f.account.draft.roster[0].training,undefined);
  assert.equal(f.account.draft.roster[0].attributes.passing,70);
});
test("campaign demolition settles due growth once then dismisses completed result",()=>{
  const f=fixture();
  const task=f.training.start(f.account,f.world,{territoryId:"a",buildingId:"center",pool:"ATT",slot:0,playerId:"player",requestId:"training-001"});
  f.setTime(task.completesAt);
  const campaign={training:f.training,buildings:f.buildings,world:f.world,state:()=>({ok:true})};
  assert.equal(CampaignService.prototype.previewBuildingDemolition.call(campaign,f.account,"a","center").canDemolish,true);
  CampaignService.prototype.demolishTerritoryBuilding.call(campaign,f.account,f.options);
  assert.equal(f.account.draft.roster[0].attributes.passing,75);
  assert.equal(f.training.publicState(f.account).tasks.length,0);
  f.training.settle(f.account);
  assert.equal(f.account.draft.roster[0].attributes.passing,75);
});
test("save failure rolls back building, revision and result dismissal; receipt history is bounded",()=>{
  const f=fixture();
  f.account.training={tasks:{done:{buildingId:"center",completedAt:500}}};
  const snapshot=structuredClone({account:f.account,world:f.world});
  f.failSave(true);
  assert.throws(()=>f.buildings.demolish(f.account,f.world,f.options),/disk failure/);
  assert.deepEqual({account:f.account,world:f.world},snapshot);
  f.failSave(false);
  f.account.buildingDemolitions=Array.from({length:20},(_,i)=>({requestId:"old-"+i}));
  f.buildings.demolish(f.account,f.world,f.options);
  assert.equal(f.account.buildingDemolitions.length,20);
  assert.equal(f.account.buildingDemolitions[0].requestId,"old-1");
});
test("recruiting center demolition preserves paid discoveries, scout movement and the two-scout cap after rebuilding",()=>{
  const f=fixture("scout-center");
  const units=f.scouting.recruit(f.account,f.world,{territoryId:"a",buildingId:"center",count:2,requestId:"recruit-001"});
  const task=f.scouting.start(f.account,f.world,{scoutId:units[0].id,requestId:"discover-001"});
  const movement=f.scouting.move(f.account,f.world,{scoutId:units[1].id,territoryId:"b",requestId:"move-001"});
  const before=structuredClone(f.account.scouting);
  f.buildings.demolish(f.account,f.world,f.options);
  assert.deepEqual(f.account.scouting,before);
  f.setTime(task.completesAt);
  const ready=f.scouting.taskDetails(f.account,task.id).task;
  f.scouting.choose(f.account,task.id,ready.cards[0].playerId);
  assert.equal(f.account.draft.roster.length,2);
  f.scouting.settle(f.account,f.world);
  assert.equal(f.scouting.unitDetails(f.account,f.world,units[1].id).territoryId,"b");
  assert.equal(movement.movement.toTerritoryId,"b");
  f.world.territories.a.buildings.push({...f.building,id:"rebuilt"});
  assert.throws(()=>f.scouting.recruit(f.account,f.world,{territoryId:"a",buildingId:"rebuilt",count:1,requestId:"recruit-002"}),/最多拥有 2/);
  assert.doesNotThrow(()=>f.scouting.start(f.account,f.world,{scoutId:units[0].id,requestId:"discover-002"}));
});
test("unfinished legacy discovery remains claimable after its building is removed",()=>{
  const f=fixture("scout-center");
  f.account.scouting={tasks:{old:{id:"old",buildingId:"center",territoryId:"a",startedAt:1,completesAt:2,claimedAt:null,candidates:[{id:"legacy",playerId:"legacy",name:"老候选",grade:"C",overall:70}]}}};
  f.buildings.demolish(f.account,f.world,f.options);
  assert.equal(f.scouting.taskDetails(f.account,"old").task.status,"ready");
  f.scouting.choose(f.account,"old","legacy");
  assert.equal(f.account.draft.roster.length,2);
});


test("every buildable facility can be demolished in active, construction and upgrade states",()=>{
 for(const d of Object.values(BUILDING_DEFINITIONS).filter(d=>d.buildable))for(const phase of ['active','constructing','upgrading']){
  const f=fixture(d.type);if(phase==='constructing'){f.building.status='constructing';f.building.completesAt=100000;}if(phase==='upgrading'){f.building.upgradeTo=2;f.building.productionWork={required:60000,completed:1000,updatedAt:1000,ownerId:'p'};}
  const preview=f.buildings.demolitionPreview(f.account,f.world,'a','center');assert.equal(preview.canDemolish,true,d.type+phase);assert.equal(preview.cancelsConstruction,phase!=='active');
  f.buildings.demolish(f.account,f.world,f.options);assert.equal(f.world.territories.a.buildings.length,0,d.type+phase);assert.equal(f.account.gold,10000);
 }
});
test("medical treatment blocks demolition until cancelled without granting a lost-facility refund",()=>{
 const f=fixture('medical-center');f.account.medicalTasks={t:{buildingId:'center',closedAt:null}};
 assert.equal(f.buildings.demolitionPreview(f.account,f.world,'a','center').canDemolish,false);assert.throws(()=>f.buildings.demolish(f.account,f.world,f.options),/治疗/);
 f.account.medicalTasks.t.closedAt=1000;f.buildings.demolish(f.account,f.world,f.options);assert.equal(f.account.gold,10000);
});
test("active stadium naming contracts block demolition until expiry",()=>{
 const f=fixture('main-stadium');f.account.sponsorship={contracts:[{type:'stadium',status:'active',signedAt:500,expiresAt:2000}]};
 assert.throws(()=>f.buildings.demolish(f.account,f.world,f.options),/冠名合同/);f.setTime(2001);assert.doesNotThrow(()=>f.buildings.demolish(f.account,f.world,f.options));
});
