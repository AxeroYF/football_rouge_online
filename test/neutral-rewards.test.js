import { INITIAL_FANS } from '../shared/config/fans.mjs';
import {spawnSync} from 'node:child_process';
import {createDevelopmentFogController} from '../client/map/development-fog-controller.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignService } from '../campaign-service.mjs';
import { createNeutralReward } from '../server/application/neutral-reward-service.mjs';
import { ChallengeService } from '../server/application/challenge-service.mjs';
import { RESOURCE_HOUR_MS } from '../shared/config/resources.mjs';
import { productionTargets } from '../client/resources/neutral-reward-controller.js';
function fixture(dev=true){
 let now=1000;const index={territories:['a','b','c'].map((id,i)=>({territoryId:id,country:'法国',countryCode:'FRA',region:'europe',name:id,centroid:[2+i,48],bounds:[1+i,47,3+i,49],neighbors:['a','b','c'].filter(x=>x!==id),landNeighbors:['a','b','c'].filter(x=>x!==id),cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null}}))};
 const resources={schemaVersion:1,version:'test',periodMs:RESOURCE_HOUR_MS,territories:Object.fromEntries(['a','b','c'].map(id=>[id,{terrain:['plains'],yields:{gold:12,production:50,science:2}}]))};
 const s=new CampaignService({developmentTools:dev,catalog:[],territoryIndex:index,territoryResources:resources,now:()=>now}),a={id:'one',nickname:'test',token:'x',setupComplete:true,homeTerritoryId:'a',gold:100000,goldLedger:[],draft:null,playerSquads:{assignments:{}},mapColor:'#123456'};
 s.accounts.set(a.id,a);s.world.players.one={playerId:'one',territoryIds:['a'],capitalTerritoryId:'a'};Object.assign(s.world.territories.a,{ownerType:'player',ownerId:'one',capitalOf:'one'});s.save();
 return {s,a,setNow:v=>now=v};
}
function award(s,a,kind,amount=200){
 const offer={id:'reward-'+kind,sourceTerritoryId:'b',kind,amount,...(kind==='sponsorship'?{contract:{sponsorId:'bmw',type:'stadium',durationDays:2,hourlyGold:300}}:{})};
 s.world.neutralRewards.offers.b=offer;return s.awardNeutralCapture({account:a,challenge:{id:'challenge-'+kind,territoryId:'b',previousOwner:{type:'neutral'}}});
}
test('world reward roll is stable, includes all six types, and sponsor contracts use confirmed terms',()=>{
 const world={seasonId:'x',aiGenerationSeed:4},seen=new Set();
 for(let i=0;i<2000;i++){const r=createNeutralReward(world,String(i));seen.add(r.kind);assert.deepEqual(r,createNeutralReward(world,String(i)));if(r.kind==='sponsorship'){assert.ok([1,2].includes(r.contract.durationDays));assert.ok([200,300,600].includes(r.contract.hourlyGold));}}
 assert.equal(seen.size,6);
});
test('gold, packs, fans and guaranteed sponsor offers award exactly once without extra rewards',()=>{
 for(const kind of ['gold','pack','fans','sponsorship']){const {s,a}=fixture(),gold=a.gold,result=award(s,a,kind,kind==='pack'?2:200);
  assert.equal(result.reward.kind,kind);assert.equal(a.gold,gold+(kind==='gold'?200:0));
  if(kind==='fans')assert.equal(a.resources.fans,INITIAL_FANS+200);
  if(kind==='pack')assert.equal(result.packs[0].count,2);
  if(kind==='sponsorship'){assert.equal(result.sponsorship.sponsorId,'bmw');assert.equal(a.sponsorship.offers.length,1);assert.equal(a.sponsorship.contracts.length,0);}
  assert.equal(s.awardNeutralCapture({account:a,challenge:{id:'retry',territoryId:'b',previousOwner:{type:'neutral'}}}),null);
 }
});
test('production and research rewards remain pending and never enter capacity balances',()=>{
 for(const kind of ['production','research']){const {s,a}=fixture(),before=structuredClone(s.resourceState(a));award(s,a,kind);assert.deepEqual(s.resourceState(a),before);assert.equal(s.neutralRewards.publicState(a).pending[0].kind,kind);}
});
test('one-time production can create a zero-gold project atomically and is idempotent',()=>{
 const {s,a}=fixture(),gold=a.gold;award(s,a,'production',200);
 const result=s.assignNeutralProduction(a,{rewardId:'reward-production',territoryId:'a',type:'training-center'});
 const b=s.world.territories.a.buildings[0];assert.equal(b.productionWork.completed,200*60000);assert.equal(a.gold,gold);assert.equal(result.state.neutralRewards.pending.length,0);
 assert.equal(s.assignNeutralProduction(a,{rewardId:'reward-production',territoryId:'a',type:'training-center'}).alreadyApplied,true);
 assert.equal(s.world.territories.a.buildings.length,1);
});
test('one-time production finishes projects, discloses overflow and recalculates shared capacity',()=>{
 const {s,a}=fixture();const b=s.buildings.build(a,s.world,'a','club-shop','production').building;
 award(s,a,'production',300);const result=s.assignNeutralProduction(a,{rewardId:'reward-production',territoryId:'a',buildingId:b.id});
 assert.equal(result.reward.appliedProduction,250);assert.equal(result.reward.overflowProduction,50);assert.equal(s.world.territories.a.buildings[0].status,'active');
});
test('invalid target, foreign land or save failure leaves production reward available',()=>{
 const {s,a}=fixture();award(s,a,'production');assert.throws(()=>s.assignNeutralProduction(a,{rewardId:'reward-production',territoryId:'b',type:'club-shop'}),/自己的/);
 const before=JSON.stringify({a,w:s.world});s.repository.save=()=>{throw Error('disk failure');};
 assert.throws(()=>s.assignNeutralProduction(a,{rewardId:'reward-production',territoryId:'a',type:'club-shop'}),/disk failure/);assert.equal(JSON.stringify({a,w:s.world}),before);
});
test('development fog toggle preserves discovery, survives state reads and is denied outside development',()=>{
 const {s,a}=fixture(),fog=structuredClone(a.fog);const all=s.setDevelopmentFog(a,false).state;assert.equal(all.fog.enabled,false);assert.equal(Object.keys(all.world.territories).length,3);assert.deepEqual(a.fog,fog);
 assert.equal(s.setDevelopmentFog(a,true).state.development.fogEnabled,true);
 const locked=fixture(false);assert.throws(()=>locked.s.setDevelopmentFog(locked.a,false),/未启用/);
});
test('pending project picker lists current projects and only server-authorized new types',()=>{
 const {s,a}=fixture();const b=s.buildings.build(a,s.world,'a','training-center','production').building;
 const targets=productionTargets(s.state(a));assert.ok(targets.some(t=>t.buildingId===b.id));assert.ok(targets.some(t=>t.type==='club-shop'));assert.ok(targets.every(t=>t.territoryId==='a'));assert.ok(!targets.some(t=>t.type==='port'));
});
test('failed battle persistence restores reward claim together with ownership and account',()=>{
 const {s,a}=fixture();const challenge={id:'battle',territoryId:'b',attackerId:a.id,previousOwner:{type:'neutral',id:null},fromTerritoryIds:['a']};
 s.world.activeChallenges.b=challenge;s.challenges.battleForChallenge=()=>({id:challenge.id,territoryId:'b',outcome:'win'});s.repository.save=()=>{throw Error('disk failure');};
 const before=JSON.stringify({a,w:s.world});assert.throws(()=>s.challenges.settleChallenge(challenge),/disk failure/);assert.equal(JSON.stringify({a,w:s.world}),before);
});


test('release ignores a saved developer fog override and denies direct toggle requests',()=>{
 const {s,a}=fixture(false);a.developmentFogDisabled=true;
 const state=s.state(a);assert.equal(state.development.enabled,false);assert.equal(state.development.fogEnabled,true);assert.equal(state.fog.enabled,true);assert.equal(state.fog.developmentOverride,undefined);
 assert.throws(()=>s.setDevelopmentFog(a,false),e=>e.statusCode===403);
});
test('production rejects even an explicitly requested developmentTools flag',()=>{
 const url=new URL('../campaign-service.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {CampaignService} from ${JSON.stringify(url)};const s=new CampaignService({catalog:[],developmentTools:true});if(s.developmentTools)throw Error('production override');try{s.setDevelopmentFog({},false);throw Error('accepted');}catch(e){if(e.statusCode!==403)throw e;}`],{env:{...process.env,NODE_ENV:'production',CAMPAIGN_DEV_TOOLS:'1'},encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);
});
test('release controller hides the developer button and never requests a toggle on a synthetic click',async()=>{
 let click,calls=0;const button={addEventListener(type,handler){click=handler;},setAttribute(){}},state={setupComplete:true,development:{enabled:false,fogEnabled:true}};
 createDevelopmentFogController({button,getState:()=>state,getRequest:()=>()=>{calls++;},campaignStore:{subscribe(){}},onState(){},showToast(){}});
 assert.equal(button.hidden,true);await click();assert.equal(calls,0);
});
