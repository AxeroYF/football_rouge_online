import test from 'node:test';
import assert from 'node:assert/strict';
import {CampaignService} from '../campaign-service.mjs';
import {resumeServerEconomy} from '../server/infrastructure/server-economy-clock.mjs';
import {createChallengeScheduler} from '../server/scheduler/challenge-scheduler.mjs';
import {OIL_DEPOSIT_IDS} from '../shared/config/oil-deposits.mjs';
const H=3600000,START=Date.parse('2026-09-18T04:00:00Z');
function fixture(){
 let now=START,saved=null,fail=false;const ids=[OIL_DEPOSIT_IDS[0],'other'];
 const index={territories:ids.map((id,i)=>({territoryId:id,country:'法国',countryCode:'FRA',region:'europe',name:id,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:ids.filter(x=>x!==id),landNeighbors:ids.filter(x=>x!==id),cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}))};
 const resources={schemaVersion:1,version:'pause-test',periodMs:H,territories:Object.fromEntries(ids.map(id=>[id,{terrain:['plains'],yields:{gold:100,production:5,science:7}}]))};
 const repository={load:()=>structuredClone(saved),save:value=>{if(fail)throw Error('disk failure');saved=structuredClone(value);}};
 const options={repository,catalog:[],territoryIndex:index,territoryResources:resources,now:()=>now};let s=new CampaignService(options);
 const a={id:'one',nickname:'停服测试',token:'test-token',setupComplete:true,homeTerritoryId:ids[0],gold:100000,goldLedger:[],resources:{fans:10000},draft:null,playerSquads:{assignments:{}},mapColor:'#123456'};
 s.accounts.set(a.id,a);s.world.players.one={playerId:'one',territoryIds:ids,capitalTerritoryId:ids[0]};
 for(const id of ids)Object.assign(s.world.territories[id],{ownerType:'player',ownerId:a.id,capitalOf:id===ids[0]?a.id:null,buildings:[]});
 s.buildings.ensureCapitalHeadquarters(a,s.world,ids[0]);s.world.territories[ids[0]].buildings.push({id:'well',type:'oil-well',level:1,status:'active',builtAt:now});
 s.world.territories.other.buildings.push({id:'factory',type:'factory',level:1,status:'active',builtAt:now,upgradeTo:2,upgradeStartedAt:now,productionWork:{required:100000*60000,completed:0,updatedAt:now,ownerId:a.id}});
 a.formationResearch={schemaVersion:1,slots:[],topicLevels:{},active:{id:'study',topicId:'biology',required:1000000,completed:0,workPeriodMs:60000,startedAt:now,updatedAt:now}};
 a.sponsorship={schemaVersion:1,offers:[],payments:[],contracts:[{id:'contract',sponsorId:'microsoft',type:'normal',durationDays:1,hourlyGold:200,signedAt:now,expiresAt:now+24*H,status:'active',paidHours:0}]};s.save();
 return {get s(){return s;},get a(){return s.accounts.get('one');},get now(){return now;},tick:ms=>now+=ms,fail:v=>fail=v,reload:()=>{s=new CampaignService(options);},saved:()=>structuredClone(saved),legacy:()=>{delete saved.world.serverEconomyClock;},ids};
}
const view=f=>({gold:f.a.gold,fans:f.a.resources.fans,oil:f.a.oil.balance,oilRemainder:f.a.oil.remainder,oilPending:f.a.oil.pendingWork,resourceRemainder:structuredClone(f.a.resourceRemainders),expenseRemainder:structuredClone(f.a.operatingCosts.remainders),study:f.a.formationResearch.active.completed,work:f.s.world.territories.other.buildings[0].productionWork.completed,paidHours:f.a.sponsorship.contracts[0].paidHours});
test('83-hour shutdown freezes all economic accrual and preserves half-hour progress, then resumes normally',()=>{
 const stopped=fixture(),continuous=fixture();for(const f of [stopped,continuous]){f.tick(H/2);f.s.save();}
 const before=view(stopped),contract=structuredClone(stopped.a.sponsorship.contracts[0]);stopped.tick(83*H);stopped.reload();assert.deepEqual(view(stopped),before);
 assert.equal(stopped.s.world.serverEconomyClock.lastPause.durationMs,83*H);assert.equal(stopped.a.sponsorship.contracts[0].signedAt,contract.signedAt);assert.equal(stopped.a.sponsorship.contracts[0].expiresAt,contract.expiresAt+83*H);
 for(const f of [stopped,continuous]){f.tick(H/2);f.s.save();}assert.deepEqual(view(stopped),view(continuous));assert.equal(stopped.a.oil.balance,32);assert.equal(stopped.a.sponsorship.contracts[0].paidHours,1);
 assert.equal(stopped.a.fanEconomy.growthAt,START+84*H);
 const again=view(stopped);stopped.reload();assert.deepEqual(view(stopped),again);assert.equal(stopped.s.world.serverEconomyClock.totalPausedMs,83*H);
});
test('player absence does not pause an operating server; scheduler settles all accounts and checkpoints',()=>{
 const f=fixture(),scheduler=createChallengeScheduler({campaign:f.s,now:()=>f.now,autoStart:false});f.tick(2*H);assert.equal(scheduler.persist(),true);assert.equal(f.a.oil.balance,34);assert.equal(f.a.sponsorship.contracts[0].paidHours,2);assert.equal(f.s.world.serverEconomyClock.lastPersistedAt,f.now);assert.ok(f.a.resources.fans>10000);assert.ok(f.a.formationResearch.active.completed>0);
});
test('R9 migration skips only time after its latest settlement, with no deductions or duplicated restart',()=>{
 const f=fixture();f.tick(H/2);f.s.save();const before=view(f);f.legacy();f.tick(87*H);f.reload();assert.deepEqual(view(f),before);assert.equal(f.s.economyResume.legacy,true);assert.equal(f.s.economyResume.durationMs,87*H);f.reload();assert.equal(f.s.economyResume.durationMs,0);assert.deepEqual(view(f),before);
});
test('failed persistence leaves economic checkpoint and accrued balances unchanged',()=>{
 const f=fixture(),before=view(f),clock=structuredClone(f.s.world.serverEconomyClock),disk=f.saved();f.tick(H);f.fail(true);assert.throws(()=>f.s.save(),/disk failure/);assert.deepEqual(view(f),before);assert.deepEqual(f.s.world.serverEconomyClock,clock);assert.deepEqual(f.saved(),disk);f.fail(false);f.s.save();assert.equal(f.a.oil.balance,32);assert.equal(f.s.world.serverEconomyClock.lastPersistedAt,f.now);
});
test('a crashed process resumes from its persisted heartbeat without paying the missing gap',()=>{
 const f=fixture();f.tick(30000);f.s.save();const before=view(f);f.tick(4*24*H);f.reload();assert.deepEqual(view(f),before);assert.equal(f.s.economyResume.durationMs,4*24*H);
});
test('sponsor expiry advances by downtime and still pays exactly its original contracted hours',()=>{
 const f=fixture();f.tick(23*H+H/2);f.s.save();f.tick(90*H);f.reload();const c=f.a.sponsorship.contracts[0];assert.equal(c.status,'active');assert.equal(c.paidHours,23);const publicContract=f.s.sponsorship.publicState(f.a).contracts[0];assert.equal(publicContract.remainingMs,H/2);assert.equal(publicContract.nextPaymentAt,f.now+H/2);f.tick(H/2);f.s.save();assert.equal(f.a.sponsorship.contracts[0].paidHours,24);assert.equal(f.a.sponsorship.contracts[0].status,'expired');
});
test('backward wall clock never creates a negative pause or duplicate resources',()=>{const f=fixture(),before=view(f);f.tick(-H);f.reload();assert.deepEqual(view(f),before);assert.equal(f.s.economyResume.durationMs,0);assert.equal(f.s.world.serverEconomyClock.lastPersistedAt,START);});
test('forecast fractions are rebased; finished records and real-world event dates are not rewritten',()=>{
 const saved={accounts:{},world:{serverEconomyClock:{schemaVersion:1,lastPersistedAt:1000,totalPausedMs:0},eliteRaids:{day:'2026-09-18'},territories:{a:{raidSuppression:{until:2000},buildings:[{id:'build',status:'constructing',completesAt:5000,productionWork:{updatedAt:1000,completed:20,schedule:[{from:1000.25,to:4999.8,allocation:3}]}},{id:'done',status:'active',builtAt:900,completesAt:900}]}}}};
 resumeServerEconomy(saved,11000);const b=saved.world.territories.a.buildings;assert.equal(b[0].productionWork.schedule[0].from,11000.25);assert.equal(b[0].productionWork.completed,20);assert.equal(b[1].builtAt,900);assert.equal(saved.world.territories.a.raidSuppression.until,2000);
});
test('invalid runtime checkpoint fails explicitly instead of awarding a guessed gap',()=>{assert.throws(()=>resumeServerEconomy({world:{serverEconomyClock:{schemaVersion:1,lastPersistedAt:NaN,totalPausedMs:0}}},100),/存档无效/);});
