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
 const hq=s.buildings.ensureCapitalHeadquarters(a,s.world,'t0');hq.level=5;s.save();
 const build=(type,id='t1')=>{const result=s.buildings.build(a,s.world,id,type,'gold');return s.world.territories[id].buildings.find(b=>b.id===result.building.id);};
 const upgrade=(b,id='t1',method='gold',key=`upgrade-${b.id}-${b.level}`)=>s.buildings.upgrade(a,s.world,id,b.id,{buildMethod:method,expectedLevel:b.level,requestId:key});
 return {s,a,hq,build,upgrade,setTime:t=>{now=t;},time:()=>now,fail:value=>{failure=value;},saved:()=>saved};
}

test('new capital receives only headquarters, and old automatic stadium migrates in place exactly once',()=>{
 const f=fixture();assert.equal(f.s.world.territories.t0.buildings.length,1);assert.equal(f.hq.type,'club-headquarters');
 const t=f.s.world.territories.t0;delete f.hq.facilitySchemaVersion;f.hq.type='main-stadium';f.hq.name='旧场';f.hq.level=3;
 assert.equal(f.s.buildings.migrate({accounts:f.s.accounts,world:f.s.world}),true);
 assert.equal(t.buildings.length,1);assert.equal(t.buildings[0].type,'club-headquarters');assert.equal(t.buildings[0].level,3);assert.equal(t.buildings[0].legacyStadiumName,'旧场');
 assert.equal(f.s.buildings.migrate({accounts:f.s.accounts,world:f.s.world}),false);
});

test('manual stadium occupies a slot, is limited to one including construction, and exposes all seating capacities',()=>{
 const f=fixture(),b=f.build('main-stadium');
 assert.equal(f.s.buildings.territoryView(f.a,f.s.world,'t1').occupiedSlots,1);
 assert.throws(()=>f.build('main-stadium','t2'),/最多建造 1/);
 for(let level=1;level<=5;level++){assert.equal(f.s.buildings.publicBuilding(b).seatingCapacity,STADIUM_CAPACITIES[level-1]);if(level<5)f.upgrade(b);}
 assert.equal(b.level,5);assert.throws(()=>f.upgrade(b),/最高等级/);
 assert.equal(f.s.buildings.migrate({accounts:f.s.accounts,world:f.s.world}),false);assert.equal(b.type,'main-stadium');
 const g=fixture();g.s.buildings.build(g.a,g.s.world,'t1','main-stadium','production');assert.throws(()=>g.build('main-stadium','t2'),/最多建造 1/);
});

for(const type of Object.keys(BUILDING_DEFINITIONS).filter(type=>BUILDING_DEFINITIONS[type].costsGold.length>1))test(`${type}: four upgrade edges charge the configured price, advance one level, and preserve slot count`,()=>{
 const f=fixture(),b=type==='club-headquarters'?f.hq:f.build(type),id=type==='club-headquarters'?'t0':'t1';b.level=1;
 for(let level=1;level<5;level++){const gold=f.a.gold,slots=f.s.world.territories[id].buildings.length;f.upgrade(b,id);assert.equal(b.level,level+1);assert.equal(gold-f.a.gold,BUILDING_DEFINITIONS[type].costsGold[level]);assert.equal(f.s.world.territories[id].buildings.length,slots);}
});

test('headquarters gates, fan requirements, idempotency and failed persistence cannot lose funds or add levels',()=>{
 const f=fixture(),b=f.build('training-center');f.hq.level=1;
 assert.throws(()=>f.upgrade(b),/总部升级至 LV2/);f.a.resources.fans=6499;assert.throws(()=>f.upgrade(f.hq,'t0'),/6500/);
 f.a.resources.fans=6500;f.upgrade(f.hq,'t0');
 const input={buildMethod:'gold',expectedLevel:1,requestId:'idempotent-upgrade'};
 f.s.buildings.upgrade(f.a,f.s.world,'t1',b.id,input);const gold=f.a.gold;
 f.s.buildings.upgrade(f.a,f.s.world,'t1',b.id,input);assert.equal(f.a.gold,gold);assert.equal(b.level,2);
 assert.throws(()=>f.s.buildings.upgrade(f.a,f.s.world,'t1',b.id,{...input,expectedLevel:2}),/请求编号/);
 f.hq.level=5;const before=structuredClone({a:f.a,t:f.s.world.territories.t1});f.fail(true);
 assert.throws(()=>f.upgrade(b),/disk failure/);assert.deepEqual({a:f.a,t:f.s.world.territories.t1},before);
});

test('production upgrade keeps old effects, shares work, completes offline at the exact boundary, and cannot be duplicated',()=>{
 const f=fixture(),b=f.build('recovery-center'),gold=f.a.gold;
 f.upgrade(b,'t1','production');assert.equal(b.level,1);assert.equal(b.status,'active');assert.equal(b.upgradeTo,2);assert.equal(f.a.gold,gold);
 assert.throws(()=>f.upgrade(b,'t1','production','second-production-request'),/正在升级/);
 assert.equal(b.productionWork.allocation,60);
 f.s.buildings.build(f.a,f.s.world,'t2','training-center','production');assert.equal(b.productionWork.allocation,30);
 f.setTime(1000+400/30*60000+200/60*60000);f.s.save();assert.equal(b.level,2);assert.equal(b.upgradeTo,undefined);assert.equal(b.builtAt,1000);assert.equal(b.upgradeCompletedAt,f.time());
 const before=b.level;f.s.save();assert.equal(b.level,before);
});

test('cancelling or losing an upgrade retains the old level and never transfers unfinished work',()=>{
 const f=fixture(),b=f.build('training-center');f.upgrade(b,'t1','production');f.s.buildings.cancelUpgrade(f.a,f.s.world,'t1',b.id);assert.equal(b.level,1);assert.equal(b.productionWork,undefined);
 f.upgrade(b,'t1','production','restart-upgrade');f.s.world.territories.t1.ownerId='other';f.s.save();assert.equal(b.upgradeTo,undefined);assert.equal(b.level,1);
});

test('headquarters fan growth changes only after the current hourly cycle; offline matches periodic saves',()=>{
 const run=frequent=>{const f=fixture();f.hq.level=1;f.a.fanEconomy.cycleGrowth=100;f.s.save();const initial=f.a.resources.fans;f.setTime(1000+H/2);f.s.save();f.upgrade(f.hq,'t0');if(frequent)for(let i=31;i<=120;i++){f.setTime(1000+i*60000);f.s.save();}else{f.setTime(1000+H*2);f.s.save();}return f.a.resources.fans-initial;};
 assert.equal(run(false),220);assert.equal(run(true),220);
});

test('shop income is local, fan-scaled, and does not retroactively apply its upgraded rate',()=>{
 const f=fixture(),b=f.build('club-shop');const before=f.a.gold;
 f.setTime(1000+H/2);f.s.save();const first=f.a.gold-before;assert.equal(first,(12*12+60)/2-110-30);
 f.upgrade(b);const after=f.a.gold;f.setTime(1000+H);f.s.save();assert.equal(f.a.gold-after,(12*12+120)/2-110-35);
 f.a.resources.fans=500;f.a.fanEconomy.preference='gold';f.s.save();const source=f.s.territoryProduction.sources(f.a,f.s.world).find(t=>t.territoryId==='t1');assert.equal(source.shopGold,60);assert.equal(source.fans,500);
});

test('recovery rate uses the local level with no retrospective speedup and preserves fixed fitness',()=>{
 const f=fixture(),b=f.build('recovery-center');f.a.expeditionPiece={schemaVersion:1,tokenId:'default',territoryId:'t1',movement:null};const p=f.a.draft.roster[0];p.state.fitness=40;f.s.save();
 f.setTime(61000);f.s.save();assert.equal(p.state.fitness,41);f.upgrade(b);f.setTime(121000);f.s.save();assert.equal(p.state.fitness,42.25);
 assert.equal(f.s.fitness.publicState(f.a).players[p.id].recoveryPerMinute,1.25);
});

test('medical reduces one injury round, never suspension, and each injury source permits one completed treatment',()=>{
 const f=fixture(),b=f.build('medical-center'),p=f.a.draft.roster[0];setAbsence(p,'injury',2,{sourceLegId:'lightning'});setAbsence(p,'suspension',1,{sourceLegId:'red'});
 const task=f.s.medical.start(f.a,{territoryId:'t1',buildingId:b.id,playerId:p.id,requestId:'medical-first'});assert.ok(p.medical);assert.ok(healthUnavailable(p));
 f.setTime(task.completesAt);f.s.save();assert.equal(absenceMatches(p,'injury'),1);assert.equal(absenceMatches(p,'suspension'),1);assert.equal(p.medical,undefined);
 assert.throws(()=>f.s.medical.start(f.a,{territoryId:'t1',buildingId:b.id,playerId:p.id,requestId:'medical-second'}),/本次受伤已经治疗/);
 f.s.save();assert.equal(absenceMatches(p,'injury'),1);
});

test('medical completion cannot heal a new injury, treats ordinary injury fully, and respects active challenges',()=>{
 const f=fixture(),b=f.build('medical-center'),p=f.a.draft.roster[0];setAbsence(p,'injury',1,{sourceLegId:'old'});
 const task=f.s.medical.start(f.a,{territoryId:'t1',buildingId:b.id,playerId:p.id,requestId:'medical-old'});setAbsence(p,'injury',2,{sourceLegId:'new'});f.setTime(task.completesAt);f.s.save();assert.equal(absenceMatches(p,'injury'),2);assert.equal(task.status,'obsolete');
 setAbsence(p,'injury',1,{sourceLegId:'ordinary'});const next=f.s.medical.start(f.a,{territoryId:'t1',buildingId:b.id,playerId:p.id,requestId:'medical-ordinary'});f.setTime(next.completesAt);f.s.save();assert.equal(absenceMatches(p,'injury'),0);
 setAbsence(p,'injury',1,{sourceLegId:'locked'});f.s.world.activeChallenges.lock={attackerId:f.a.id};assert.throws(()=>f.s.medical.start(f.a,{territoryId:'t1',buildingId:b.id,playerId:p.id,requestId:'medical-locked'}),/比赛期间/);
});

test('medical completion is rolled back with failed save and losing a hospital refunds only once',()=>{
 const f=fixture(),b=f.build('medical-center'),p=f.a.draft.roster[0];setAbsence(p,'injury',1,{sourceLegId:'one'});
 const task=f.s.medical.start(f.a,{territoryId:'t1',buildingId:b.id,playerId:p.id,requestId:'medical-save'});f.setTime(task.completesAt);f.fail(true);assert.throws(()=>f.s.save(),/disk failure/);assert.equal(absenceMatches(p,'injury'),1);assert.ok(p.medical);f.fail(false);
 const gold=f.a.gold;f.s.world.territories.t1.ownerId='other';f.s.save();const first=f.a.gold;assert.equal(f.a.goldLedger.filter(e=>e.reason==='medical-facility-lost-refund').reduce((n,e)=>n+e.delta,0),task.costGold);f.s.save();assert.equal(f.a.gold,first);assert.equal(f.a.goldLedger.filter(e=>e.reason==='medical-facility-lost-refund').length,1);assert.equal(p.medical,undefined);
});

test('facility panel exposes upgrades, headquarters prerequisites, stadium seats and actual medical controls',()=>{
 const f=fixture(),b=f.build('medical-center');setAbsence(f.a.draft.roster[0],'injury',1,{sourceLegId:'ui'});
 const html=buildingPanelMarkup({view:f.s.buildings.territoryView(f.a,f.s.world,'t1'),catalog:f.s.buildings.catalog(),walletGold:f.a.gold});
 assert.match(html,/data-upgrade-building/);assert.match(html,/金币升级/);assert.match(html,/生产力升级/);assert.match(html,/data-start-medical/);assert.match(html,/1 → 0 回合/);assert.doesNotMatch(html,/待开放/);
 assert.equal(facilityEffects('main-stadium',5).seatingCapacity,80000);
});


test('one-time production rewards complete upgrades at their target level without resetting original build time',()=>{
 const f=fixture(),b=f.build('club-shop');f.upgrade(b,'t1','production');
 f.a.pendingNeutralRewards=[{id:'upgrade-work',kind:'production',amount:500,status:'pending'}];
 f.s.neutralRewards.assignProduction(f.a,{rewardId:'upgrade-work',territoryId:'t1',buildingId:b.id});
 assert.equal(b.level,2);assert.equal(b.upgradeTo,undefined);assert.equal(b.builtAt,1000);assert.equal(f.a.pendingNeutralRewards[0].status,'applied');
});


test('a manual stadium outside the capital supplies match venue identity and upgraded capacity',()=>{
 const f=fixture();assert.equal(f.s.sponsorMatchVenue(f.a).seatingCapacity,0);
 const b=f.build('main-stadium','t2');b.name='远方球场';
 assert.equal(f.s.sponsorMatchVenue(f.a).stadiumId,b.id);assert.equal(f.s.sponsorMatchVenue(f.a).name,'远方球场');
 f.upgrade(b,'t2');assert.equal(f.s.sponsorMatchVenue(f.a).seatingCapacity,40000);
});

test('medical completion independently wakes the economy scheduler even with no other due work',()=>{
 const f=fixture(),b=f.build('medical-center'),p=f.a.draft.roster[0];setAbsence(p,'injury',1,{sourceLegId:'scheduler-injury'});
 const task=f.s.medical.start(f.a,{territoryId:'t1',buildingId:b.id,playerId:p.id,requestId:'medical-scheduler'});
 f.s.fitness.due=()=>false;f.s.territoryProduction.due=()=>false;f.s.sponsorship.due=()=>false;f.s.operatingCosts.due=()=>false;f.s.oil.due=()=>false;
 f.s.world.serverEconomyClock.lastPersistedAt=task.completesAt-1; // Isolate medical wake-up from the independent 30-second heartbeat.
 assert.equal(f.s.economyDue(task.completesAt-1),false);assert.equal(f.s.economyDue(task.completesAt),true);
 f.setTime(task.completesAt);f.s.save();assert.equal(absenceMatches(p,'injury'),0);assert.equal(f.s.economyDue(),false);
});


test('facility detail reports actual fan-covered shop income and active expedition recovery',()=>{
 const f=fixture();f.build('club-shop','t1');f.build('recovery-center','t2');
 f.a.resources.fans=500;f.a.fanEconomy.preference='gold';f.a.expeditionPiece={schemaVersion:1,tokenId:'default',territoryId:'t2',movement:null};f.s.save();
 assert.match(f.s.buildings.territoryView(f.a,f.s.world,'t1').buildings[0].runtimeEffectText,/50%.*30 金币/);
 assert.match(f.s.buildings.territoryView(f.a,f.s.world,'t2').buildings[0].runtimeEffectText,/22 名/);
 f.a.expeditionPiece.territoryId='t0';f.s.save();assert.match(f.s.buildings.territoryView(f.a,f.s.world,'t2').buildings[0].runtimeEffectText,/22 名/);
});

test('sea movement snapshots local port time together with wonder bonus and preserves the one-minute floor',()=>{
 const f=fixture(),port=f.build('port','t0');port.level=5;
 f.a.expeditionPiece={schemaVersion:1,tokenId:'default',territoryId:'t0',movement:null};f.s.save();
 f.s.wonders.isSeaJourney=()=>true;f.s.wonders.seaTravel=(_a,base)=>({...base,durationMs:400000});
 assert.equal(f.s.estimateExpedition(f.a,'t11').estimate.durationMs,280000);
 f.s.moveExpedition(f.a,'t11');assert.equal(f.a.expeditionPiece.movement.arrivesAt,f.time()+280000);
 port.level=1;assert.equal(f.a.expeditionPiece.movement.durationMs,280000);
 f.a.expeditionPiece.movement=null;f.s.wonders.seaTravel=(_a,base)=>({...base,durationMs:60000});
 assert.equal(f.s.estimateExpedition(f.a,'t11').estimate.durationMs,60000);
 f.s.wonders.isSeaJourney=()=>false;assert.equal(f.s.estimateExpedition(f.a,'t11').estimate.mode,'land');
});
