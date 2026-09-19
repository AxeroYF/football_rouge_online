import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { CampaignService } from '../campaign-service.mjs';
import { convertS4Accounts } from '../shared/account-import/s4-accounts.mjs';
import { LaunchRewardService } from '../server/application/launch-reward-service.mjs';
import { EconomyService } from '../server/application/economy-service.mjs';
import { PlayerPackService } from '../server/application/player-pack-service.mjs';
import { ChallengeService } from '../server/application/challenge-service.mjs';
import { NeutralRewardService } from '../server/application/neutral-reward-service.mjs';
import { BUILDING_RULES } from '../shared/config/buildings.mjs';
const noon = Date.parse('2026-09-09T04:00:00Z');
const nextReset = Date.parse('2026-09-10T00:00:00Z'); // Beijing 08:00 conquest-day reset.
const index = { territories: ['home','one','two','three'].map(id => ({territoryId:id,country:'test',countryCode:'FRA',region:'europe',name:id,centroid:[2,48],bounds:[1,47,3,49],neighbors:[],landNeighbors:[],cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'neutral'}})) };
const resources = {schemaVersion:1,version:'test',periodMs:3600000,territories:Object.fromEntries(index.territories.map(t=>[t.territoryId,{terrain:['plains'],yields:{gold:0,production:1,science:0}}]))};
function campaign(seed) {
  let disk = seed, time = noon, fail = false;
  const repository = {load:()=>structuredClone(disk),save:value=>{if(fail)throw Error('disk failure');disk=structuredClone(value);}};
  const create = () => new CampaignService({repository,catalog:[],territoryIndex:index,territoryResources:resources,now:()=>time});
  const service = create();
  return {service,create,clock:t=>time=t,fail:v=>fail=v,disk:()=>disk};
}
function completeTeam(service, account) {
  account.setupComplete=true; account.homeTerritoryId='home';
  Object.assign(service.world.territories.home,{ownerType:'player',ownerId:account.id});
  service.save();
}
test('new registration uses exact launch gold and fans, grants packs and production only after setup, and persists once',()=>{
  const f=campaign(), token=f.service.register('new-manager','secret12').token;
  const a=f.service.authenticate(token);
  assert.equal(a.gold,20000);assert.equal(a.resources.fans,8000);
  assert.equal(a.inventory.packs['rare-player-pack'],0);assert.equal(a.pendingNeutralRewards,undefined);
  completeTeam(f.service,a);
  assert.equal(a.inventory.packs['rare-player-pack'],2);assert.equal(a.inventory.packs['exotic-player-pack'],1);
  assert.equal(a.pendingNeutralRewards.length,1);assert.equal(a.pendingNeutralRewards[0].amount,400);
  assert.equal(a.resources.production,undefined);
  f.service.save();const restored=f.create().accounts.get(a.id);
  assert.equal(restored.gold,20000);assert.equal(restored.resources.fans,8000);
  assert.equal(restored.inventory.packs['rare-player-pack'],2);assert.equal(restored.pendingNeutralRewards.length,1);
});
test('S4 import keeps credentials but cannot carry developer currency, packs, launch flags or progress',()=>{
  const salt=crypto.randomBytes(16),password='old-password';
  const old={id:'s4-player',nickname:'old-manager',createdAt:1,passwordHash:'scrypt$'+salt.toString('base64url')+'$'+crypto.scryptSync(password,salt,64).toString('base64url'),gold:1000000,resources:{fans:999999,production:99999},inventory:{packs:{'rare-player-pack':999}},launchRewards:{version:1,packsPaid:true},setupComplete:true,draft:{roster:[{}]}};
  const f=campaign(convertS4Accounts({accounts:{old}}));const a=f.service.accounts.get(old.id);
  assert.equal(f.service.login(old.nickname,password).profile.id,old.id);
  assert.equal(a.gold,20000);assert.equal(a.resources.fans,8000);assert.equal(a.setupComplete,false);assert.equal(a.draft,null);
  assert.equal(a.inventory.packs['rare-player-pack'],0);completeTeam(f.service,a);
  f.clock(nextReset);f.service.save();assert.equal(a.gold,20000);
  assert.equal(a.inventory.packs['rare-player-pack'],2);
});
test('gold stages require unique ordinary neutral wins and the next Beijing conquest day; repeated saves and restart never regrant',()=>{
  const f=campaign(),a=f.service.authenticate(f.service.register('stage-manager','secret12').token);completeTeam(f.service,a);
  const capture=(id,type='neutral')=>{f.service.neutralRewards.award=()=>null;f.service.awardNeutralCapture({account:a,challenge:{territoryId:id,previousOwner:{type}}});f.service.save();};
  capture('club','club');capture('enemy','player');assert.equal(a.gold,20000);
  capture('one');assert.equal(a.gold,35000);capture('one');assert.deepEqual(a.launchRewards.conqueredTerritoryIds,['one']);
  capture('two');capture('three');f.clock(nextReset-1);f.service.save();assert.equal(a.gold,35000);
  f.clock(nextReset);f.service.save();assert.equal(a.gold,50000);
  f.service.spendGold(a,1000,'purchase');f.service.save();assert.equal(f.create().accounts.get(a.id).gold,49000);
  assert.equal(a.goldLedger.filter(e=>e.reason.startsWith('launch-')).reduce((n,e)=>n+e.delta,0),50000);
});
test('next day alone cannot grant final gold before the third distinct capture',()=>{
  const f=campaign(),a=f.service.authenticate(f.service.register('wait-manager','secret12').token);completeTeam(f.service,a);
  f.clock(nextReset);f.service.launchRewards.recordConquest(a,'one');f.service.save();assert.equal(a.gold,35000);
  f.service.launchRewards.recordConquest(a,'two');f.service.save();assert.equal(a.gold,35000);
  f.service.launchRewards.recordConquest(a,'three');f.service.save();assert.equal(a.gold,50000);
});
test('disk failure rolls back every grant and eligibility flag; retry grants exactly once',()=>{
  const f=campaign(),a=f.service.authenticate(f.service.register('rollback-manager','secret12').token);
  a.setupComplete=true;a.homeTerritoryId='home';Object.assign(f.service.world.territories.home,{ownerType:'player',ownerId:a.id});
  const before=structuredClone(a);f.fail(true);assert.throws(()=>f.service.save(),/disk failure/);
  for(const key of ['gold','goldLedger','inventory','pendingNeutralRewards','launchRewards'])assert.deepEqual(a[key],before[key]);
  f.fail(false);f.service.save();f.service.launchRewards.recordConquest(a,'one');f.fail(true);
  assert.throws(()=>f.service.save(),/disk failure/);assert.equal(a.gold,20000);assert.equal(a.launchRewards.firstConquestPaid,undefined);
  f.fail(false);f.service.save();assert.equal(a.gold,35000);assert.equal(a.inventory.packs['rare-player-pack'],2);
});
test('existing developer saves are not silently reset or given fresh opening grants',()=>{
  const f=campaign({accounts:{dev:{id:'dev',nickname:'developer',gold:1000000,setupComplete:true,resources:{fans:12345},fanEconomy:{growthAt:noon,preference:'balanced'}}}});
  const a=f.service.accounts.get('dev');assert.equal(a.gold,1000000);assert.equal(a.resources.fans,12345);assert.equal(a.launchRewards,undefined);
});
test('failed battles and failed settlement saves cannot count as launch conquests',()=>{
  for(const outcome of ['win','loss']){
    let fail=true;const economy=new EconomyService({now:()=>noon}),packs=new PlayerPackService({playerDatabase:[]}),rewards=new LaunchRewardService({economy,playerPacks:packs});
    const a={id:'a',setupComplete:false};economy.migrateAccount(a);a.setupComplete=true;a.homeTerritoryId='home';a.draft={roster:[{}]};
    const accounts=new Map([['a',a]]),world={revision:0,territories:{target:{ownerType:'neutral',ownerId:null,version:0,buildings:[]}},players:{a:{territoryIds:['home']}},activeChallenges:{}};
    const challenge={id:'battle',attackerId:'a',territoryId:'target',previousOwner:{type:'neutral',id:null},battle:{outcome},settleAt:noon};world.activeChallenges.target=challenge;
    const service=new ChallengeService({world,accounts,territoryIndex:{territories:[{territoryId:'target'}]},now:()=>noon,awardNeutralCapture:({account,challenge})=>rewards.recordConquest(account,challenge.territoryId),save:()=>{
      const pending=rewards.prepare(accounts,world,noon);if(fail){pending.rollback();throw Error('disk failure');}
    }});
    assert.throws(()=>service.settleChallenge(challenge),/disk failure/);assert.deepEqual(a.launchRewards.conqueredTerritoryIds,[]);assert.equal(a.gold,20000);
    fail=false;service.settleChallenge(challenge);assert.equal(a.gold,outcome==='win'?35000:20000);
    assert.equal(a.launchRewards.conqueredTerritoryIds.length,outcome==='win'?1:0);
  }
});
test('400 production supplement retains unused remainder when a smaller project completes',()=>{
  const rewards=new NeutralRewardService({now:()=>noon});
  const reward={source:'launch',kind:'production',amount:400,status:'pending'};
  const building={id:'b',status:'constructing',productionWork:{required:100*BUILDING_RULES.productionPeriodMs,completed:0}};
  rewards.applyToBuilding({},reward,{territoryId:'home',version:0},building);
  assert.equal(building.status,'active');assert.equal(reward.amount,300);assert.equal(reward.status,'pending');
});
