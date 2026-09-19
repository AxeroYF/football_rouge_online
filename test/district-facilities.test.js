import {districtSiteYield,DISTRICT_RULES} from '../shared/buildings/district-yields.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignService} from '../campaign-service.mjs';
import {BuildingService} from '../server/application/building-service.mjs';
import {EconomyService} from '../server/application/economy-service.mjs';
import {BUILDING_DEFINITIONS} from '../shared/config/buildings.mjs';
import {facilityEffects,STADIUM_CAPACITIES} from '../shared/config/facility-levels.mjs';
import {setAbsence,absenceMatches,healthUnavailable} from '../shared/football/match-availability.mjs';
import {buildingPanelMarkup} from '../client/buildings/building-panel-controller.js';
const H=3600000;
function fixture(){
 let now=1000,saved=null,failure=false;
 const index={territories:Array.from({length:12},(_,i)=>({territoryId:'t'+i,country:'测试',countryCode:'FRA',region:'europe',name:'t'+i,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:[],landNeighbors:[],cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
 const resources={schemaVersion:1,version:'upgrade-fixture',periodMs:H,territories:Object.fromEntries(index.territories.map(t=>[t.territoryId,{terrain:['plains'],yields:{gold:12,production:5,science:1}}]))};
 const catalog=Array.from({length:44},(_,i)=>({id:'p'+i,name:'球员'+i,cardDefinitionId:'p'+i,pool:['GK','DEF','MID','ATT'][i%4],role:['GK','CB','DM','ST'][i%4],grade:i<22?'C':'B',overall:70,attributes:{passing:60,pace:60,finishing:60},state:{fitness:100}}));
 const repository={load:()=>null,save:value=>{if(failure)throw Error('disk failure');saved=structuredClone(value);}};
 const s=new CampaignService({repository,catalog,territoryIndex:index,territoryResources:resources,now:()=>now,random:()=>.1});
 const a={id:'one',nickname:'测试',token:'fixture',setupComplete:true,homeTerritoryId:'t0',gold:5000000,goldLedger:[],resources:{fans:50000},draft:{teamName:'测试',roster:structuredClone(catalog.slice(0,33))},playerSquads:{assignments:Object.fromEntries(catalog.slice(0,33).map((p,i)=>[p.id,i<22?'expedition':'garrison']))}};
 s.accounts.set(a.id,a);s.world.players.one={playerId:'one',territoryIds:index.territories.map(t=>t.territoryId),capitalTerritoryId:'t0'};
 for(const t of Object.values(s.world.territories))Object.assign(t,{ownerType:'player',ownerId:a.id,capitalOf:t.territoryId==='t0'?'one':null,buildings:[]});
 s.world.territories.t0.capitalOf='one';s.buildings.isCoastal=()=>true;
 const hq=s.buildings.ensureCapitalHeadquarters(a,s.world,'t0');hq.level=5;s.save();a.oil.balance=0;s.save();
 const build=(type,id='t1')=>{const result=s.buildings.build(a,s.world,id,type,'gold');return s.world.territories[id].buildings.find(b=>b.id===result.building.id);};
 const upgrade=(b,id='t1',method='gold',key=`upgrade-${b.id}-${b.level}`)=>s.buildings.upgrade(a,s.world,id,b.id,{buildMethod:method,expectedLevel:b.level,requestId:key});
 return {s,a,hq,build,upgrade,setTime:t=>{now=t;},time:()=>now,fail:value=>{failure=value;},saved:()=>saved};
}


const M=60000;
function districtFixture(){const f=fixture();f.s.territoryIndex.territories.find(t=>t.territoryId==='t1').landNeighbors=['t0','t2'];f.s.territoryProduction.catalog.territories.t1.terrain=['hills','forest'];f.s.save();return f;}
test('terrain and adjacency use owned completed land neighbors, distinct tags and independent caps',()=>{
 const f=districtFixture(),{s,a}=f;
 s.territoryProduction.catalog.territories.t1.terrain=['hills','forest','mountain','coastal','hills'];
 for(const type of ['port','club-shop','training-center','medical-center'])s.world.territories.t2.buildings.push(s.buildings.createRecord(type));
 s.world.territories.t3.buildings.push(s.buildings.createRecord('port'));s.territoryIndex.territories.find(t=>t.territoryId==='t1').maritimeNeighbors=['t3'];
 s.world.territories.t2.buildings.push(s.buildings.createRecord('port',{status:'constructing'}));
 const preview=s.territoryProduction.districtPreview(a,s.world,'t1','factory',5);
 assert.equal(preview.base,4);assert.equal(preview.terrainBonus,6);assert.equal(preview.adjacencyBonus,6);assert.equal(preview.baseYield,16);assert.equal(preview.fullYield,80);assert.equal(preview.neighbors.length,5);
 s.world.territories.t2.ownerId='ally';s.world.diplomacy={relationships:{'["ally","one"]':{players:['ally','one'],state:'alliance'}}};
 assert.equal(s.territoryProduction.districtPreview(a,s.world,'t1','factory').adjacencyBonus,1);
});
test('a constructing factory or university reserves the one-per-player slot and replay cannot spend twice',()=>{
 for(const type of ['factory','university']){const f=districtFixture();const gold=f.a.gold;f.s.buildings.build(f.a,f.s.world,'t1',type,'production');assert.equal(f.a.gold,gold);
 assert.throws(()=>f.s.buildings.build(f.a,f.s.world,'t3',type,'gold'),/最多建造 1/);assert.equal(f.a.gold,gold);
 assert.ok(!f.s.buildings.territoryView(f.a,f.s.world,'t3').availableTypes.includes(type));}
});
test('selected-site preview matches real world capacity including fan redistribution and upgrade gains',()=>{
 const f=districtFixture();f.a.resources.fans=500;f.s.save();
 const preview=f.s.buildings.territoryView(f.a,f.s.world,'t1').buildPreviews.factory;
 assert.equal(preview.baseYield,10);assert.equal(preview.coverage,.5);
 const b=f.build('factory');assert.equal(f.s.world.resourceEconomy.rates.one.production,preview.projectedCapacity);
 const site=f.s.buildings.territoryView(f.a,f.s.world,'t1').buildings.find(x=>x.id===b.id).siteYield;
 assert.equal(site.expectedYield,5);
 f.a.resources.fans=50000;f.s.save();const next=f.s.buildings.territoryView(f.a,f.s.world,'t1').buildings.find(x=>x.id===b.id).nextSiteYield;
 f.upgrade(b);assert.equal(b.level,2);assert.equal(f.s.world.resourceEconomy.rates.one.production,next.projectedCapacity);
 const html=buildingPanelMarkup({view:f.s.buildings.territoryView(f.a,f.s.world,'t1'),catalog:f.s.buildings.catalog()});assert.match(html,/生产力 20 → 30/);
});
test('adjacent buildings, territory ownership, and demolition immediately change district rates',()=>{
 const f=districtFixture(),b=f.build('factory'),initial=f.s.world.resourceEconomy.rates.one.production;
 const port=f.build('port','t2');assert.equal(f.s.world.resourceEconomy.rates.one.production,initial+2);
 f.s.buildings.demolish(f.a,f.s.world,{territoryId:'t2',buildingId:port.id,requestId:'remove-port-test'});assert.equal(f.s.world.resourceEconomy.rates.one.production,initial);
 f.s.buildings.demolish(f.a,f.s.world,{territoryId:'t1',buildingId:b.id,requestId:'remove-factory-test'});assert.equal(f.s.world.resourceEconomy.rates.one.production,initial-10);
 assert.ok(f.s.buildings.territoryView(f.a,f.s.world,'t3').availableTypes.includes('factory'));
});
test('offline factory completion accelerates remaining construction only after its actual completion boundary',()=>{
 const f=districtFixture(),start=f.time(),base=f.s.world.resourceEconomy.rates.one.production;
 const factory=f.s.buildings.build(f.a,f.s.world,'t1','factory','production').building;
 const stadium=f.s.buildings.build(f.a,f.s.world,'t3','main-stadium','production').building;
 const factoryAt=start+600/(base/2)*M,stadiumAt=factoryAt+(800-600)/(base+10)*M;
 f.setTime(start+30*M);f.s.save();
 const built=f.s.world.territories.t1.buildings.find(b=>b.id===factory.id),other=f.s.world.territories.t3.buildings.find(b=>b.id===stadium.id);
 assert.equal(built.status,'active');assert.ok(Math.abs(built.builtAt-factoryAt)<.01);assert.equal(other.builtAt,Math.ceil(stadiumAt));
 assert.equal(f.s.world.resourceEconomy.rates.one.production,base+10);
});
test('failed construction or upgrade save restores money, levels and economic plans',()=>{
 const f=districtFixture(),before=JSON.stringify({gold:f.a.gold,world:f.s.world});f.fail(true);
 assert.throws(()=>f.build('factory'),/disk failure/);assert.equal(JSON.stringify({gold:f.a.gold,world:f.s.world}),before);
 f.fail(false);const b=f.build('university'),prior=JSON.stringify({gold:f.a.gold,world:f.s.world});f.fail(true);
 assert.throws(()=>f.upgrade(b),/disk failure/);assert.equal(JSON.stringify({gold:f.a.gold,world:f.s.world}),prior);
});
test('captured extra facilities only contribute the highest single yield without deleting buildings',()=>{
 const f=districtFixture();f.build('factory');f.s.world.territories.t3.buildings.push(f.s.buildings.createRecord('factory',{level:5}));f.s.save();
 const sources=f.s.territoryProduction.sources(f.a,f.s.world),districts=sources.flatMap(t=>t.districtYields??[]);
 assert.equal(districts.length,2);assert.equal(districts.filter(d=>d.operating).length,1);assert.equal(districts.find(d=>d.operating).level,5);
 assert.equal(f.s.world.resourceEconomy.rates.one.production,60+20);
});
test('university has its own terrain preferences and its live rate feeds research',()=>{
 const f=districtFixture();f.s.territoryProduction.catalog.territories.t3.terrain=['mountain','forest','coastal'];
 const preview=f.s.territoryProduction.districtPreview(f.a,f.s.world,'t3','university');assert.equal(preview.baseYield,10);
 f.build('university','t3');assert.equal(f.s.formationResearch.publicState(f.a).sciencePerMinute,22);
 assert.equal(f.s.world.resourceEconomy.rates.one.production,60);
 assert.equal(f.s.buildings.territoryView({id:'other'},f.s.world,'t3').buildPreviews,undefined);
 assert.equal(f.s.buildings.territoryView({id:'other'},f.s.world,'t3').buildings[0].siteYield,undefined);
});


test('offline university completion gives no retroactive science; upgraded yields begin only on completion',()=>{
 const f=districtFixture();f.s.territoryProduction.catalog.territories.t3.terrain=['mountain','forest','coastal'];
 f.a.formationResearch=f.s.formationResearch.data(f.a);f.a.formationResearch.active={id:'research-fixture',startedAt:f.time(),updatedAt:f.time(),required:1000000,completed:0,workPeriodMs:M,slotId:'test',direction:'attack',level:1};
 const started=f.time();const b=f.s.buildings.build(f.a,f.s.world,'t3','university','production').building;
 f.setTime(started+20*M);f.s.save();assert.equal(f.a.formationResearch.active.completed,12*10+22*10);
 const built=f.s.world.territories.t3.buildings.find(x=>x.id===b.id),before=f.a.formationResearch.active.completed;
 f.upgrade(built,'t3','production');f.setTime(started+40*M);f.s.save();
 const upgradeMinutes=1000/60;assert.ok(Math.abs(f.a.formationResearch.active.completed-before-(22*upgradeMinutes+32*(20-upgradeMinutes)))<.001);
 assert.equal(built.level,2);assert.equal(f.s.formationResearch.publicState(f.a).sciencePerMinute,32);
});
test('demolition settles prior production and science then stops facility output at removal time',()=>{
 const f=districtFixture(),b=f.build('factory'),start=f.time();
 const stadium=f.s.buildings.build(f.a,f.s.world,'t3','main-stadium','production').building;
 f.setTime(start+M);f.s.demolishTerritoryBuilding(f.a,{territoryId:'t1',buildingId:b.id,requestId:'demolish-timed-factory'});
 const project=f.s.world.territories.t3.buildings.find(x=>x.id===stadium.id);assert.equal(project.productionWork.completed,70*M);
 f.setTime(start+2*M);f.s.save();assert.equal(project.productionWork.completed,130*M);
});


test('facility upkeep starts at offline completion, not at construction start',()=>{
 const f=districtFixture(),start=f.time();const old=f.a.operatingCosts.maintenance;
 f.s.buildings.build(f.a,f.s.world,'t1','factory','production');f.setTime(start+30*M);f.s.save();
 // 600 work / 60 production = 10 minutes, then 20 minutes of LV1 upkeep.
 assert.equal(f.a.operatingCosts.maintenance,old+10);assert.equal(f.a.operatingCosts.remainders.maintenance,((old*30+200)*M*1000)%(H*1000));
});
