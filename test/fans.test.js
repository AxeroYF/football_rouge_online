import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_FANS, rankFanTerritories, allocateFans, fanIncomeIntervals } from '../shared/config/fans.mjs';
import { RESOURCE_HOUR_MS as HOUR } from '../shared/config/resources.mjs';
import { TerritoryProductionService } from '../server/application/territory-production-service.mjs';
import { ConstructionProductionService } from '../server/application/construction-production-service.mjs';
import { EconomyService } from '../server/application/economy-service.mjs';
import { CampaignService } from '../campaign-service.mjs';
import { fanSourcesMarkup, resourceSourcesMarkup } from '../client/resources/resource-controller.js';
import { territoryResourceMarkup, territoryResourceProfile } from '../client/resources/resource-markup.js';
const plot=(territoryId,gold,production,science)=>({territoryId,yields:{gold,production,science}});
const plots=[plot('g',120,0,0),plot('p',0,11,0),plot('s',0,0,12),plot('m',48,4,4)];
function fixture(fans=0, custom=[plot('a',12,2,3)]){
 const a={id:'one',setupComplete:true,gold:0,goldLedger:[],resources:{fans},fanEconomy:{schemaVersion:1,growthAt:0,preference:'balanced'}};
 const index={territories:custom.map((p,i)=>({territoryId:p.territoryId,country:'测试',countryCode:'FRA',region:'europe',name:p.territoryId,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:[],landNeighbors:[],cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
 const catalog={schemaVersion:1,version:'fans-test',periodMs:HOUR,territories:Object.fromEntries(custom.map(p=>[p.territoryId,{terrain:['plains'],yields:p.yields}]))};
 const accounts=new Map([[a.id,a]]),world={territories:Object.fromEntries(custom.map(p=>[p.territoryId,{ownerType:'player',ownerId:a.id,buildings:[]}]))};
 const service=new TerritoryProductionService({catalog,territoryIndex:index,economy:new EconomyService({now:()=>0})});
 return {a,index,catalog,accounts,world,service};
}
test('automatic objectives choose highest normalized value and each resource preference; ties are deterministic',()=>{
 for(const [preference,first] of [['balanced','m'],['gold','g'],['production','p'],['science','s']]){
  const ranked=rankFanTerritories(plots,preference);assert.equal(ranked[0].territoryId,first);
  const allocated=allocateFans(ranked,1500);assert.equal(allocated.assigned,1500);assert.deepEqual(allocated.sources.map(t=>t.fans),[1000,500,0,0]);
  for(const id of ['gold','production','science'])assert.equal(allocated.rates[id],ranked[0].yields[id]+ranked[1].yields[id]/2);
  assert.deepEqual(rankFanTerritories([...plots].reverse(),preference),ranked);
 }
 assert.throws(()=>rankFanTerritories(plots,'oops'));assert.throws(()=>allocateFans(plots,-1));
});
test('unused fans stay in total, new low value territories cannot dilute optimized income, all supported reaches full yield',()=>{
 const first=allocateFans(rankFanTerritories(plots),1000);const added=allocateFans(rankFanTerritories([...plots,plot('z',12,0,0)]),1000);assert.deepEqual(first.units,added.units);
 const full=allocateFans(rankFanTerritories(plots),5000);assert.equal(full.available,1000);assert.equal(full.assigned,4000);assert.deepEqual(full.rates,{gold:168,production:15,science:16,territoryCount:4});
});
test('migration grants initial fans once on top of earned rewards, growth starts only after setup and every full hour',()=>{
 const f=fixture(321);delete f.a.fanEconomy;f.a.setupComplete=false;
 f.service.prepare(f.accounts,f.world,0);assert.equal(f.a.resources.fans,INITIAL_FANS+321);
 f.service.prepare(f.accounts,f.world,20*HOUR);assert.equal(f.a.resources.fans,INITIAL_FANS+321);
 f.a.setupComplete=true;f.service.prepare(f.accounts,f.world,20*HOUR);f.service.prepare(f.accounts,f.world,21*HOUR-1);assert.equal(f.a.resources.fans,INITIAL_FANS+321);
 f.service.prepare(f.accounts,f.world,21*HOUR);assert.equal(f.a.resources.fans,INITIAL_FANS+421);
 f.service.prepare(f.accounts,f.world,20*HOUR);f.service.prepare(f.accounts,f.world,21*HOUR);assert.equal(f.a.resources.fans,INITIAL_FANS+421);
});
test('offline growth changes gold and construction at hourly boundaries, never retroactively',()=>{
 const f=fixture(),construction=new ConstructionProductionService();
 f.world.territories.a.buildings=[{id:'build',type:'club-shop',status:'constructing',productionWork:{ownerId:'one',updatedAt:0,required:2*HOUR,completed:0}}];
 const save=at=>{const tx=f.service.prepare(f.accounts,f.world,at);construction.prepare(f.world,at,{one:f.world.resourceEconomy.rates.one.production},tx.capacityIntervals);};
 save(0);save(HOUR);assert.equal(f.a.gold,0);assert.equal(f.world.territories.a.buildings[0].productionWork.completed,0);
 save(3*HOUR);assert.equal(f.a.resources.fans,300);assert.equal(f.a.gold,3);assert.equal(f.world.territories.a.buildings[0].productionWork.completed,.6*HOUR);
 assert.equal(f.service.publicState(f.a,f.world).current.production,.6);
 save(10*HOUR);assert.equal(f.world.territories.a.buildings[0].status,'active');assert.equal(f.world.territories.a.buildings[0].builtAt,5*HOUR);
});
test('frequent saves and one long offline interval agree even with fractional gold and fractional production',()=>{
 const a=fixture(17),b=fixture(17),ca=new ConstructionProductionService(),cb=new ConstructionProductionService();
 for(const f of [a,b])f.world.territories.a.buildings=[{id:'build',type:'club-shop',status:'constructing',productionWork:{ownerId:'one',updatedAt:0,required:100*HOUR,completed:0}}];
 const save=(f,c,at)=>{const tx=f.service.prepare(f.accounts,f.world,at);c.prepare(f.world,at,{one:f.world.resourceEconomy.rates.one.production},tx.capacityIntervals);};
 save(a,ca,0);save(b,cb,0);for(let at=7919;at<3*HOUR;at+=7919)save(a,ca,at);save(a,ca,3*HOUR);save(b,cb,3*HOUR);
 assert.equal(a.a.gold,b.a.gold);assert.deepEqual(a.a.resourceRemainders,b.a.resourceRemainders);assert.deepEqual(a.a.resources,b.a.resources);
 assert.ok(Math.abs(a.world.territories.a.buildings[0].productionWork.completed-b.world.territories.a.buildings[0].productionWork.completed)<.0001);
});
test('capture and reward affect next allocation, old ownership and fan count settle the previous interval',()=>{
 const f=fixture(500,[plot('a',120,0,0),plot('b',240,0,0)]);f.world.territories.b.ownerType='neutral';f.service.prepare(f.accounts,f.world,0);
 f.a.resources.fans+=200;f.world.territories.b.ownerType='player';f.service.prepare(f.accounts,f.world,HOUR/2);assert.equal(f.a.gold,30);assert.equal(f.service.publicState(f.a,f.world).hourly.gold,168);
 f.service.prepare(f.accounts,f.world,HOUR);assert.equal(f.a.gold,114);assert.equal(f.a.resources.fans,800);
});
test('legacy intervals keep prior full income, then start fan allocation at migration time',()=>{
 const f=fixture();delete f.a.fanEconomy;f.world.resourceEconomy={schemaVersion:2,settledAt:0,rateVersion:'old',rates:{one:{gold:120,production:9,science:8}}};
 f.service.prepare(f.accounts,f.world,5*HOUR);assert.equal(f.a.gold,600);assert.equal(f.a.resources.fans,INITIAL_FANS);assert.equal(f.a.fanEconomy.growthAt,5*HOUR);
 f.service.prepare(f.accounts,f.world,6*HOUR);assert.equal(f.a.gold,612);assert.equal(f.a.resources.fans,INITIAL_FANS+100);
});
test('very long offline periods stop allocation phases once all land is supported',()=>{
 const plan={fans:0,growthAt:0,territories:rankFanTerritories(plots)};assert.equal(fanIncomeIntervals(plan,0,1000000*HOUR).length,41);
});
test('preference transaction settles old objective, persists new one, validates input and rolls back failures',()=>{
 const f=fixture(1000,[plot('a',120,0,0),plot('b',0,12,0)]);let now=0;
 const c=new CampaignService({catalog:[],territoryIndex:f.index,territoryResources:f.catalog,now:()=>now});
 Object.assign(f.a,{nickname:'测试',token:'fans-test',homeTerritoryId:'a',draft:null,playerSquads:{assignments:{}},mapColor:'#123456'});c.accounts.set(f.a.id,f.a);for(const t of Object.values(c.world.territories))Object.assign(t,{ownerType:'player',ownerId:f.a.id});c.save();
 now=HOUR/2;c.setFanPreference(f.a,'gold');assert.equal(f.a.gold,0);assert.equal(f.a.fanEconomy.preference,'gold');assert.equal(c.resourceState(f.a).hourly.gold,120);
 assert.throws(()=>c.setFanPreference(f.a,'invalid'));assert.equal(f.a.fanEconomy.preference,'gold');
 now=HOUR;const before=JSON.stringify({a:f.a,world:c.world});c.repository.save=()=>{throw Error('disk failure');};assert.throws(()=>c.setFanPreference(f.a,'science'),/disk failure/);assert.equal(JSON.stringify({a:f.a,world:c.world}),before);
});
test('public actual yields, zero utilization and preference markup match allocation and escape names',()=>{
 const f=fixture(17);f.service.prepare(f.accounts,f.world,0);const resources=f.service.publicState(f.a,f.world),state={resources};
 assert.equal(resources.sources[0].fans,17);assert.equal(resources.sources[0].yields.gold,.204);assert.equal(resources.current.production,.034);
 resources.sources[0].label='<script>name</script>';const markup=fanSourcesMarkup(state);assert.match(markup,/&lt;script&gt;/);assert.match(markup,/data-fan-preference="science"/);assert.match(markup,/1.7%/);
 assert.match(resourceSourcesMarkup(state,'gold'),/0.204/);
 const profile=territoryResourceProfile({territoryId:'a',resources:f.catalog.territories.a},state);assert.match(territoryResourceMarkup(profile),/实际产出/);assert.match(territoryResourceMarkup(profile),/0.204/);
 const zero={...profile,fans:0,yields:{gold:0,production:0,science:0}};assert.match(territoryResourceMarkup(zero),/data-resource="production"/);assert.match(territoryResourceMarkup(zero),/利用率 0%/);
});
