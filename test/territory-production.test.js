import { INITIAL_FANS } from '../shared/config/fans.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TerritoryProductionService } from '../server/application/territory-production-service.mjs';
import { EconomyService } from '../server/application/economy-service.mjs';
import { CampaignService } from '../campaign-service.mjs';
import { RESOURCE_HOUR_MS as HOUR } from '../shared/config/resources.mjs';
const index={territories:['a','b'].map((id,i)=>({territoryId:id,country:'测试',countryCode:'FRA',region:'europe',name:id,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:[i?'a':'b'],landNeighbors:[i?'a':'b'],cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
const catalog={schemaVersion:1,version:'test-v1',periodMs:HOUR,territories:{a:{terrain:['plains'],yields:{gold:72,production:0,science:0}},b:{terrain:['hills'],yields:{gold:12,production:2,science:3}}}};
function fixture(){const a={id:'one',setupComplete:true,gold:100,goldLedger:[]},b={id:'two',setupComplete:true,gold:200,goldLedger:[]};const accounts=new Map([[a.id,a],[b.id,b]]);const world={territories:{a:{ownerType:'player',ownerId:a.id},b:{ownerType:'player',ownerId:a.id}}};const service=new TerritoryProductionService({catalog,territoryIndex:index,economy:new EconomyService({now:()=>0})});return{a,b,accounts,world,service};}
test('activation exposes current capacities without creating production or science balances',()=>{
 const f=fixture();f.service.prepare(f.accounts,f.world,100*HOUR);
 assert.equal(f.a.gold,100);assert.deepEqual(f.a.resources,{fans:INITIAL_FANS});
 const state=f.service.publicState(f.a,f.world);assert.deepEqual(state.hourly,{gold:84});assert.deepEqual(state.current,{production:2,science:3});assert.deepEqual(state.balances,{fans:INITIAL_FANS});
});
test('one hour accrues only gold; idle production and science never accumulate',()=>{
 const f=fixture();f.service.prepare(f.accounts,f.world,0);f.service.prepare(f.accounts,f.world,HOUR);
 assert.equal(f.a.gold,184);assert.deepEqual(f.a.resources,{fans:INITIAL_FANS+100});assert.deepEqual(f.a.resourceLedger[0].earned,{gold:84});
 f.service.prepare(f.accounts,f.world,HOUR);assert.equal(f.a.gold,184);assert.equal(f.a.resourceLedger.length,1);
 f.service.prepare(f.accounts,f.world,72*HOUR);assert.deepEqual(f.service.publicState(f.a,f.world).current,{production:2,science:3});assert.deepEqual(f.a.resources,{fans:INITIAL_FANS+7200});assert.deepEqual(f.a.resourceRemainders,{gold:0});
});
test('frequent commits preserve fractional gold and equal an uninterrupted interval',()=>{
 const f=fixture(),g=fixture();f.service.prepare(f.accounts,f.world,0);g.service.prepare(g.accounts,g.world,0);
 for(let at=1000;at<=HOUR;at+=1000)f.service.prepare(f.accounts,f.world,at);g.service.prepare(g.accounts,g.world,HOUR);
 assert.equal(f.a.gold,g.a.gold);assert.deepEqual(f.a.resources,g.a.resources);assert.deepEqual(f.a.resourceRemainders,g.a.resourceRemainders);
});
test('capture changes both capacities immediately and settles gold to the previous owner',()=>{
 const f=fixture();f.service.prepare(f.accounts,f.world,0);f.world.territories.b.ownerId=f.b.id;f.service.prepare(f.accounts,f.world,HOUR/2);
 assert.equal(f.a.gold,142);assert.equal(f.b.gold,200);assert.deepEqual(f.service.publicState(f.a,f.world).current,{production:0,science:0});assert.deepEqual(f.service.publicState(f.b,f.world).current,{production:2,science:3});
 f.service.prepare(f.accounts,f.world,HOUR);assert.equal(f.a.gold,178);assert.equal(f.b.gold,206);assert.deepEqual(f.b.resources,{fans:INITIAL_FANS+100});
});
test('neutral and club territories grant no capacity or player income; backward clocks do not backpay',()=>{
 const f=fixture();f.world.territories.b.ownerType='club';f.service.prepare(f.accounts,f.world,HOUR);f.service.prepare(f.accounts,f.world,HOUR/2);f.service.prepare(f.accounts,f.world,2*HOUR);
 assert.equal(f.a.gold,172);assert.deepEqual(f.service.publicState(f.a,f.world).current,{production:0,science:0});assert.equal(f.world.resourceEconomy.settledAt,2*HOUR);
});
test('failed persistence rolls back gold, checkpoint, resource migration and ledgers together',()=>{
 const f=fixture();f.a.resources={production:349,science:112,fans:10};f.a.resourceRemainders={production:12,science:34};
 const before=JSON.stringify({accounts:[...f.accounts],world:f.world});f.service.prepare(f.accounts,f.world,0).rollback();assert.equal(JSON.stringify({accounts:[...f.accounts],world:f.world}),before);
 f.service.prepare(f.accounts,f.world,0);const saved=JSON.stringify({accounts:[...f.accounts],world:f.world});f.service.prepare(f.accounts,f.world,HOUR).rollback();assert.equal(JSON.stringify({accounts:[...f.accounts],world:f.world}),saved);
});
test('legacy stockpiles are archived once, never converted to spendable one-shot rewards',()=>{
 const f=fixture();f.a.resources={production:349,science:112,fans:52,futureResource:6};f.a.resourceRemainders={gold:3,production:1,science:2};
 f.service.prepare(f.accounts,f.world,0);f.world.resourceEconomy.schemaVersion=1;f.service.prepare(f.accounts,f.world,HOUR);
 assert.deepEqual(f.a.resources,{fans:INITIAL_FANS+152,futureResource:6});
 assert.deepEqual(f.a.retiredResourceStockpiles,[{retiredAt:0,balances:{production:349,science:112},remainders:{production:1,science:2}}]);
 assert.deepEqual(f.a.resourceRemainders,{gold:3});assert.equal(f.world.resourceEconomy.schemaVersion,3);assert.deepEqual(f.service.publicState(f.a,f.world).balances,{fans:INITIAL_FANS+152});
});
test('overflow and invalid data fail without partially paying other accounts',()=>{
 const f=fixture();f.service.prepare(f.accounts,f.world,0);f.b.resources.fans=-1;
 const before=JSON.stringify({accounts:[...f.accounts],world:f.world});assert.throws(()=>f.service.prepare(f.accounts,f.world,HOUR),/无效/);assert.equal(JSON.stringify({accounts:[...f.accounts],world:f.world}),before);
 f.b.resources.fans=0;f.a.gold=Number.MAX_SAFE_INTEGER;const gold=f.a.gold;assert.throws(()=>f.service.prepare(f.accounts,f.world,HOUR));assert.equal(f.a.gold,gold);assert.equal(f.world.resourceEconomy.settledAt,0);
});
test('changed catalog uses old gold rate for elapsed time and immediately updates current capacities',()=>{
 const f=fixture();f.service.prepare(f.accounts,f.world,0);const updated=structuredClone(catalog);updated.version='test-v2';updated.territories.a.yields.gold=24;updated.territories.b.yields.production=5;
 const service=new TerritoryProductionService({catalog:updated,territoryIndex:index,economy:f.service.economy});service.prepare(f.accounts,f.world,HOUR);
 assert.equal(f.a.gold,184);assert.equal(service.publicState(f.a,f.world).current.production,5);service.prepare(f.accounts,f.world,2*HOUR);assert.equal(f.a.gold,220);
});
test('server restart pauses income, keeps capacities, preserves retirement audit and rolls back disk failures',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-production-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'campaign.json');let now=100*HOUR;
 const options={dataPath:file,catalog:[],territoryIndex:index,territoryResources:catalog,now:()=>now};let service=new CampaignService(options);
 const account={id:'one',nickname:'隔离资源测试',token:'test-token',setupComplete:true,homeTerritoryId:'a',gold:100,goldLedger:[],resources:{production:349,science:112,fans:3},draft:null,playerSquads:{assignments:{}},mapColor:'#123456'};
 service.accounts.set(account.id,account);for(const id of ['a','b'])Object.assign(service.world.territories[id],{ownerType:'player',ownerId:'one',capitalOf:id==='a'?'one':null});
 service.world.players.one={playerId:'one',territoryIds:['a','b'],capitalTerritoryId:'a'};service.save();
 now+=HOUR;service=new CampaignService(options);const a=service.accounts.get('one');assert.equal(a.gold,100);assert.deepEqual(service.territoryProduction.publicState(a,service.world).current,{production:2,science:3});assert.equal(a.retiredResourceStockpiles.length,1);
 now+=HOUR;const originalSave=service.repository.save;service.repository.save=()=>{throw new Error('fixture disk failure');};
 assert.throws(()=>service.save(),/disk failure/);assert.equal(a.gold,100);assert.equal(service.world.resourceEconomy.settledAt,101*HOUR);assert.equal(service.world.constructionEconomy.settledAt,101*HOUR);
 service.repository.save=originalSave;service.save();assert.equal(a.gold,174); // The migrated headquarters now costs 10 gold/hour.
 const reopened=new CampaignService(options);assert.equal(reopened.accounts.get('one').gold,174);assert.deepEqual(reopened.accounts.get('one').resources,{fans:INITIAL_FANS+103});assert.equal(reopened.accounts.get('one').retiredResourceStockpiles.length,1);
});

test('resource source rows expose only the current owner and add up to all three headline yields',()=>{
 const f=fixture();f.service.prepare(f.accounts,f.world,0);
 const state=f.service.publicState(f.a,f.world);
 assert.deepEqual(state.sources.map(s=>s.territoryId),['a','b']);
 for(const id of ['gold','production','science'])assert.equal(state.sources.reduce((sum,s)=>sum+s.yields[id],0),id==='gold'?state.hourly.gold:state.current[id]);
 assert.equal(state.sources[0].label,'测试 · a');
 state.sources[0].yields.gold=999;assert.equal(f.service.publicState(f.a,f.world).sources[0].yields.gold,72);
 f.world.territories.b.ownerId=f.b.id;f.service.prepare(f.accounts,f.world,HOUR);
 assert.deepEqual(f.service.publicState(f.a,f.world).sources.map(s=>s.territoryId),['a']);
 assert.deepEqual(f.service.publicState(f.b,f.world).sources.map(s=>s.territoryId),['b']);
 f.world.territories.a.ownerType='neutral';f.service.prepare(f.accounts,f.world,HOUR);
 assert.deepEqual(f.service.publicState(f.a,f.world).sources,[]);
 assert.deepEqual(f.service.sources({...f.b,setupComplete:false},f.world),[]);
});
