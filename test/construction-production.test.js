import { INITIAL_FANS } from '../shared/config/fans.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceConstruction, productionConstructionProgress } from '../shared/buildings/construction-production.mjs';
import { ConstructionProductionService } from '../server/application/construction-production-service.mjs';
import { CampaignService } from '../campaign-service.mjs';
import { RESOURCE_HOUR_MS } from '../shared/config/resources.mjs';
const project=(id,completed=0,updatedAt=0)=>({id,required:60000,completed,updatedAt});
test('all concurrent projects equally share capacity and release it at actual completion',()=>{
 const result=advanceConstruction([project('a',30000),project('b')],2,0,45000);
 assert.equal(result[0].completedAt,30000);assert.equal(result[1].completedAt,45000);assert.equal(result[1].completed,60000);
 const midpoint=advanceConstruction([project('a'),project('b')],6,0,10000);assert.deepEqual(midpoint.map(p=>p.completed),[30000,30000]);
});
test('new projects share only from their start; idle time is not available to later projects',()=>{
 const result=advanceConstruction([project('a'),project('b',0,10000)],2,0,60000);
 assert.equal(result[0].completedAt,50000);assert.equal(result[1].completedAt,60000);
 const idle=advanceConstruction([project('late',0,100000)],2,0,100001);assert.equal(idle[0].completed,2);
});
test('zero production preserves work and has no completion ETA',()=>{
 const [result]=advanceConstruction([project('a',24000)],0,0,Infinity);assert.equal(result.completed,24000);assert.equal(result.completedAt,null);assert.deepEqual(result.schedule,[]);
});
test('incremental and offline advancement agree across fractional allocations',()=>{
 const input=[project('a',1234),project('b',6789),project('c')],capacity=7;
 let running=input;
 for(let time=0;time<26000;time+=1000)running=advanceConstruction(running.filter(p=>p.completed<p.required),capacity,time,time+1000).map(p=>({...p,updatedAt:time+1000}));
 assert.ok(running.every(p=>p.completed===p.required));
 assert.ok(advanceConstruction(input,capacity,0,26000).every(p=>p.completed===p.required));
 const offline=advanceConstruction(input,capacity,0,9876),partial=advanceConstruction(advanceConstruction(input,capacity,0,4567).map(p=>({...p,updatedAt:4567})),capacity,4567,9876);
 offline.forEach((p,i)=>assert.ok(Math.abs(p.completed-partial[i].completed)<1e-6));
});
test('client progress follows redistribution schedule rather than stretching original start time',()=>{
 const result=advanceConstruction([project('a',30000),project('b')],2,0,Infinity)[1];
 const building={completesAt:result.completedAt,productionWork:{...project('b'),schedule:result.schedule}};
 assert.equal(productionConstructionProgress(building,15000).percent,25);
 assert.ok(Math.abs(productionConstructionProgress(building,37500).percent-75)<1e-9);
 const paused={completesAt:null,productionWork:{...project('p',24000),schedule:[]}};assert.deepEqual(productionConstructionProgress(paused,999999),{percent:40,remaining:null});
});
const pending=(id,completed=0)=>({id,type:'club-shop',level:1,status:'constructing',constructionStartedAt:1000,completesAt:61000,productionWork:{...project(id,completed,1000),ownerId:'one'}});
const world=()=>({revision:1,territories:{a:{ownerType:'player',ownerId:'one',version:1,buildings:[pending('a')]},b:{ownerType:'player',ownerId:'one',version:1,buildings:[pending('b')]} }});
test('capacity changes apply from the ownership boundary, with previous owner work retained',()=>{
 const s=new ConstructionProductionService(),w=world();s.prepare(w,1000,{one:2,two:0});w.territories.b.ownerId='two';s.prepare(w,11000,{one:4,two:1});
 assert.equal(w.territories.a.buildings[0].productionWork.completed,10000);assert.equal(w.territories.b.buildings[0].productionWork.completed,10000);
 assert.equal(w.territories.a.buildings[0].completesAt,23500);assert.equal(w.territories.b.buildings[0].completesAt,61000);
 s.prepare(w,23500,{one:4,two:1});assert.equal(w.territories.a.buildings[0].status,'active');assert.equal(w.territories.b.buildings[0].productionWork.completed,22500);
});
test('losing production pauses projects and acquiring it resumes without idle backpay',()=>{
 const s=new ConstructionProductionService(),w=world();s.prepare(w,1000,{one:2});s.prepare(w,11000,{one:0});s.prepare(w,111000,{one:4});
 assert.equal(w.territories.a.buildings[0].productionWork.completed,10000);assert.equal(w.territories.a.buildings[0].completesAt,136000);s.prepare(w,136000,{one:4});assert.equal(w.territories.a.buildings[0].status,'active');
});
test('legacy timers preserve completed work fraction; already expired timers finish at their old time',()=>{
 const s=new ConstructionProductionService(),w=world();delete w.territories.a.buildings[0].productionWork;delete w.territories.b.buildings[0].productionWork;
 w.territories.b.buildings[0].completesAt=11000;s.prepare(w,31000,{one:2});assert.equal(w.territories.a.buildings[0].productionWork.completed,30000);assert.equal(w.territories.a.buildings[0].completesAt,46000);assert.equal(w.territories.b.buildings[0].builtAt,11000);
});
test('backward clocks cannot rewind work; rollback restores all building and world fields',()=>{
 const s=new ConstructionProductionService(),w=world();s.prepare(w,1000,{one:2});s.prepare(w,11000,{one:2});const before=JSON.stringify(w);
 s.prepare(w,1000,{one:2});assert.equal(JSON.stringify(w),before);s.prepare(w,90000,{one:2}).rollback();assert.equal(JSON.stringify(w),before);
});
test('a removed project frees capacity only after its settled demolition time',()=>{
 const s=new ConstructionProductionService(),w=world();s.prepare(w,1000,{one:2});s.prepare(w,11000,{one:2});w.territories.b.buildings=[];s.prepare(w,11000,{one:2});assert.equal(w.territories.a.buildings[0].completesAt,36000);
});
function campaignFixture(capacity=2){
 let now=1000;const index={territories:['a','b'].map((id,i)=>({territoryId:id,country:'测试',countryCode:'FRA',region:'europe',name:id,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:[i?'a':'b'],landNeighbors:[i?'a':'b'],cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
 const catalog={schemaVersion:1,version:'test',periodMs:RESOURCE_HOUR_MS,territories:{a:{terrain:['plains'],yields:{gold:12,production:capacity/2,science:2}},b:{terrain:['hills'],yields:{gold:0,production:capacity/2,science:1}}}};
 const service=new CampaignService({catalog:[],territoryIndex:index,territoryResources:catalog,now:()=>now});
 const account={id:'one',nickname:'test',token:'test',setupComplete:true,homeTerritoryId:'a',gold:100000,goldLedger:[],draft:null,playerSquads:{assignments:{}},mapColor:'#123456'};service.accounts.set(account.id,account);service.world.players.one={playerId:'one',territoryIds:['a','b'],capitalTerritoryId:'a'};
 for(const id of ['a','b'])Object.assign(service.world.territories[id],{ownerType:'player',ownerId:'one',capitalOf:id==='a'?'one':null});service.save();
 return {service,account,setNow:value=>now=value};
}
test('real campaign builds share capacity, update previews, complete offline and keep resources unbanked',()=>{
 const {service:s,account:a,setNow}=campaignFixture();
 const one=s.buildings.build(a,s.world,'a','training-center','production');assert.equal(one.building.completesAt,12001000);assert.equal(one.building.productionWork.allocation,2);
 setNow(11000);s.buildings.build(a,s.world,'b','club-shop','production');const first=s.world.territories.a.buildings.find(b=>b.id===one.building.id);assert.equal(first.productionWork.completed,20000);assert.equal(first.completesAt,19501000);
 const preview=s.buildings.territoryView(a,s.world,'a').production;assert.equal(preview.capacity,2);assert.equal(preview.activeProjects,2);
 setNow(19501000);s.save();assert.equal(first.builtAt,19501000);assert.equal(s.world.territories.b.buildings[0].builtAt,15011000);assert.deepEqual(a.resources,{fans:INITIAL_FANS+500});
});
test('real campaign save failure rolls back work, gold, capacity checkpoints and a newly requested building',()=>{
 const {service:s,account:a,setNow}=campaignFixture();s.buildings.build(a,s.world,'a','training-center','production');setNow(11000);
 const before=JSON.stringify({account:a,world:s.world});const original=s.repository.save;s.repository.save=()=>{throw Error('disk failure');};
 assert.throws(()=>s.save(),/disk failure/);assert.equal(JSON.stringify({account:a,world:s.world}),before);
 setNow(1000);assert.throws(()=>s.buildings.build(a,s.world,'b','club-shop','production'),/disk failure/);assert.equal(JSON.stringify({account:a,world:s.world}),before);
 s.repository.save=original;
});
for(const method of ['gold','production'])test('failed '+method+' commit restores wallet and removes proposed building',()=>{
 const {service:s,account:a}=campaignFixture();const before=JSON.stringify({account:a,world:s.world});
 s.repository.save=()=>{throw Error('disk failure');};
 assert.throws(()=>s.buildings.build(a,s.world,'a','training-center',method),/disk failure/);assert.equal(JSON.stringify({account:a,world:s.world}),before);
});

test('completion events do not stall on fractional allocation at real epoch timestamps',()=>{
 const now=1788796800000;
 const input=[project('a',1234,now),project('b',6789,now),project('c',0,now)];
 const offline=advanceConstruction(input,7,now,now+26000);
 assert.ok(offline.every(p=>p.completed===p.required&&p.completedAt!==null));
 let pending=input,completed=[];
 for(let t=now;t<now+26000;t+=1000){const next=advanceConstruction(pending,7,t,t+1000);completed.push(...next.filter(p=>p.completedAt!==null));pending=next.filter(p=>p.completedAt===null).map(p=>({...p,updatedAt:t+1000}));}
 assert.equal(completed.length,3);assert.equal(pending.length,0);
 for(const p of offline)assert.ok(Math.abs(p.completedAt-completed.find(v=>v.id===p.id).completedAt)<=1);
});

test('port requires 500 production and capacity 50 completes it in exactly ten minutes without gold',()=>{
 const {service:s,account:a,setNow}=campaignFixture(50);s.buildings.isCoastal=()=>true;a.gold=0;
 const value=s.buildTerritoryBuilding(a,'b','port','production');
 assert.equal(value.building.buildMethod,'production');assert.equal(value.building.buildCostProduction,500);
 assert.equal(value.building.productionWork.required,500*60000);assert.equal(value.building.remainingConstructionMs,10*60000);
 assert.equal(a.gold,0);assert.equal(a.goldLedger.length,0);
 setNow(301000);s.save();assert.equal(s.world.territories.b.buildings[0].productionWork.completed,250*60000);
 setNow(601000);s.save();assert.equal(s.world.territories.b.buildings[0].status,'active');assert.equal(s.world.territories.b.buildings[0].builtAt,601000);
});

test('gold instant construction never takes production from an existing project and cannot be purchased twice',()=>{
 const {service:s,account:a}=campaignFixture(50);
 const pending=s.buildings.build(a,s.world,'a','training-center','production').building;
 const before=structuredClone(a), gold=a.gold;
 const built=s.buildTerritoryBuilding(a,'b','club-shop','gold');
 assert.equal(built.building.status,'active');assert.equal(built.building.buildMethod,'gold');assert.equal(built.building.builtAt,1000);
 assert.equal(built.building.remainingConstructionMs,0);assert.equal(built.building.productionWork,undefined);
 assert.equal(a.gold,gold-5000);assert.equal(a.goldLedger.length,before.goldLedger.length+1);
 assert.equal(s.buildings.territoryView(a,s.world,'a').production.activeProjects,1);
 assert.equal(s.world.territories.a.buildings.find(b=>b.id===pending.id).completesAt,pending.completesAt);
 assert.throws(()=>s.buildings.build(a,s.world,'b','club-shop','gold'),/同类设施/);assert.equal(a.gold,gold-5000);
});

test('every manual facility has server-authoritative production costs and supports either build method',()=>{
 for(const entry of campaignFixture().service.buildings.catalog().filter(e=>e.buildable)){
  assert.ok(Number.isSafeInteger(entry.buildCostProduction)&&entry.buildCostProduction>0);
  for(const method of ['gold','production']){
   const {service:s,account:a}=campaignFixture(50);s.buildings.isCoastal=()=>true;s.buildings.oilDeposit=()=>({oilPerHour:3});const gold=a.gold;
   const value=s.buildings.build(a,s.world,'b',entry.type,method);
   assert.equal(value.building.status,method==='gold'?'active':'constructing');
   assert.equal(a.gold,gold-(method==='gold'?entry.buildCostGold:0));
   if(method==='production')assert.equal(value.building.remainingConstructionMs,entry.buildCostProduction/50*60000);
  }
 }
});

test('zero production queues without charging gold and resumes only when capacity exists',()=>{
 const {service:s,account:a,setNow}=campaignFixture(0);a.gold=0;
 const built=s.buildings.build(a,s.world,'b','club-shop','production').building;
 assert.equal(built.completesAt,null);assert.equal(built.status,'constructing');
 setNow(601000);s.save();const b=s.world.territories.b.buildings[0];assert.equal(b.productionWork.completed,0);
 // A new capacity boundary must not backfill the idle interval.
 new ConstructionProductionService().prepare(s.world,601000,{one:50});
 assert.equal(b.completesAt,901000);assert.equal(b.productionWork.completed,0);assert.ok(a.goldLedger.every(entry=>entry.delta>0));
});

test('invalid or missing methods and insufficient gold leave buildings and wallets unchanged',()=>{
 const {service:s,account:a}=campaignFixture(50);a.gold=4999;const before=JSON.stringify({a,w:s.world});
 for(const method of [undefined,null,'instant',{},''])assert.throws(()=>s.buildings.build(a,s.world,'b','club-shop',method),/请选择/);
 assert.throws(()=>s.buildings.build(a,s.world,'b','club-shop','gold'),/金币/);
 assert.equal(JSON.stringify({a,w:s.world}),before);
 const built=s.buildings.build(a,s.world,'b','club-shop','production');assert.equal(built.building.status,'constructing');assert.equal(a.gold,4999);
});

test('both methods enforce ownership, terrain, slots and automatic headquarters restrictions',()=>{
 for(const method of ['gold','production']){
  const {service:s,account:a}=campaignFixture(50);
  assert.throws(()=>s.buildings.build(a,s.world,'b','port',method),/海岸线/);
  assert.throws(()=>s.buildings.build(a,s.world,'b','club-headquarters',method),/不能手动建造/);
  assert.throws(()=>s.buildings.build({id:'stranger',setupComplete:true},s.world,'b','club-shop',method),/自己的领地/);
  s.buildings.build(a,s.world,'b','club-shop',method);
  assert.throws(()=>s.buildings.build(a,s.world,'b','medical-center',method),/槽位/);
 }
});

test('saved new requirements and old in-flight work survive reload without repricing',()=>{
 const {service:s,account:a}=campaignFixture(50);
 s.buildings.build(a,s.world,'a','training-center','production');
 s.world.territories.b.buildings.push(pending('legacy',30000));
 const copy=structuredClone(s.world);new ConstructionProductionService().prepare(copy,2000,{one:50});
 const fresh=copy.territories.a.buildings.find(b=>b.buildMethod==='production'),legacy=copy.territories.b.buildings[0];
 assert.equal(fresh.buildCostProduction,400);assert.equal(fresh.productionWork.required,400*60000);
 assert.equal(legacy.productionWork.required,60000);assert.equal(legacy.productionWork.completed,55000);
 assert.equal(fresh.productionWork.completed,25000);
});

test('a scout center blocks a second center for both instant and ongoing builds',()=>{
 for(const method of ['gold','production']){
  const {service:s,account:a}=campaignFixture(50);
  s.buildings.build(a,s.world,'b','scout-center',method);
  assert.throws(()=>s.buildings.build(a,s.world,'a','scout-center','production'),/最多修建 1/);
  assert.throws(()=>s.buildings.build(a,s.world,'a','scout-center','gold'),/最多修建 1/);
 }
});
