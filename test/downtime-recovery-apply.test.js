import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after} from 'node:test';
import {RECOVERY_TEST_PLAN as PLAN} from './fixtures/downtime-recovery-plan.mjs';
const privateDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-recovery-test-'));
const privatePlan=path.join(privateDirectory,'plan.json');fs.writeFileSync(privatePlan,JSON.stringify(PLAN));
const previousPlan=process.env.DOWNTIME_RECOVERY_PLAN_PATH;process.env.DOWNTIME_RECOVERY_PLAN_PATH=privatePlan;
const {prepareDowntimeRecovery}=await import('../server/application/downtime-recovery-service.mjs');
const {CampaignService}=await import('../campaign-service.mjs');
after(()=>{if(previousPlan===undefined)delete process.env.DOWNTIME_RECOVERY_PLAN_PATH;else process.env.DOWNTIME_RECOVERY_PLAN_PATH=previousPlan;fs.rmSync(privateDirectory,{recursive:true,force:true});});
import {EconomyService} from '../server/application/economy-service.mjs';
import {createTerritoryWorld} from '../territory-model.js';
const now=Date.parse('2026-09-18T05:00:00Z');
function context(){const accounts=new Map(PLAN.players.map(p=>[p.accountId,{id:p.accountId,nickname:p.teamName,setupComplete:true,gold:p.proposed.gold+100,oil:{balance:p.proposed.oil+30},resources:{fans:p.proposed.fans+500},goldLedger:[],inventory:{unchanged:true}}]));return {accounts,world:{},economy:new EconomyService({now:()=>now}),now};}
test('synthetic eight-player plan applies exact deductions, preserves unrelated resources and logs actual totals',()=>{const c=context(),r=prepareDowntimeRecovery(c);assert.equal(r.changed,true);assert.deepEqual(r.record.totals,{gold:1552669,oil:3277,fans:57685});for(const a of c.accounts.values()){assert.equal(a.gold,100);assert.equal(a.oil.balance,30);assert.equal(a.resources.fans,500);assert.deepEqual(a.inventory,{unchanged:true});}const snapshot=structuredClone({accounts:c.accounts,world:c.world});assert.equal(prepareDowntimeRecovery(c).changed,false);assert.deepEqual(c.accounts,snapshot.accounts);assert.equal(c.world.news.length,1);});
test('insufficient resources stop at zero, waive the shortfall permanently, and never retry later gains',()=>{const c=context(),p=PLAN.players[0],a=c.accounts.get(p.accountId);a.gold=5;a.oil.balance=2;a.resources.fans=10;const r=prepareDowntimeRecovery(c).record.players[0];assert.deepEqual(r.deducted,{gold:5,oil:2,fans:10});assert.equal(r.waived.gold,p.proposed.gold-5);a.gold=900000;prepareDowntimeRecovery(c);assert.equal(a.gold,900000);});
test('per-account receipt protects against duplicate deductions when rebuilding the world record',()=>{const c=context();prepareDowntimeRecovery(c);const before=structuredClone(c.accounts);delete c.world.economyRecoveries;prepareDowntimeRecovery(c);assert.deepEqual(c.accounts,before);assert.equal(c.world.news.length,1);});
test('invalid resource on a later account restores prior accounts and leaves no completion record',()=>{const c=context();c.accounts.get(PLAN.players[1].accountId).oil.balance=-1;const before=structuredClone({accounts:c.accounts,world:c.world});assert.throws(()=>prepareDowntimeRecovery(c),/资源无效/);assert.deepEqual({accounts:c.accounts,world:c.world},before);});
test('an unrelated save is untouched',()=>{const c=context();c.accounts=new Map([['unrelated',{id:'unrelated',gold:500}]]);const before=structuredClone({accounts:c.accounts,world:c.world});assert.equal(prepareDowntimeRecovery(c).changed,false);assert.deepEqual({accounts:c.accounts,world:c.world},before);});
function bootFixture(){
 const id=PLAN.players[0].accountId,index={territories:[{territoryId:'home',country:'测试',countryCode:'FRA',region:'europe',name:'home',centroid:[2,48],bounds:[1,47,3,49],neighbors:[],landNeighbors:[],cityIds:[],clubIds:[],spawnAllowed:true,initialOwner:{type:'neutral',id:null,name:'中立'}}]},resources={schemaVersion:1,version:'recovery-test',periodMs:3600000,territories:{home:{terrain:['plains'],yields:{gold:100,production:10,science:10}}}};
 const world=createTerritoryWorld(index);world.players[id]={playerId:id,territoryIds:['home'],capitalTerritoryId:'home'};Object.assign(world.territories.home,{ownerType:'player',ownerId:id,capitalOf:id,buildings:[]});
 const a={id,nickname:'测试',token:'token',setupComplete:true,homeTerritoryId:'home',gold:400000,goldLedger:[],draft:null,playerSquads:{assignments:{}},resources:{fans:8800},fanEconomy:{schemaVersion:1,growthAt:now,cycleGrowth:100,preference:'balanced'},oil:{schemaVersion:1,balance:1000,settledAt:now,periodStartedAt:now,hourly:0,factoryDemand:0,remainder:0,pendingWork:0}};
 let saved={version:4,accounts:{[id]:a},world},fail=false;const repository={load:()=>structuredClone(saved),save:v=>{if(fail)throw Error('disk failed');saved=structuredClone(v);}};
 const options={repository,catalog:[],territoryIndex:index,territoryResources:resources,now:()=>now};return {id,options,fail:v=>fail=v,saved:()=>structuredClone(saved)};
}
test('first startup deducts automatically, persists once, refreshes fan allocation and survives restart',()=>{const f=bootFixture(),s=new CampaignService(f.options),a=s.accounts.get(f.id);assert.equal(a.gold,102085);assert.equal(a.oil.balance,544);assert.equal(a.resources.fans,500);assert.equal(s.world.resourceEconomy.fanPlans[f.id].fans,500);assert.equal(s.resourceState(a).sources.find(x=>x.type==='territory').fans,500);assert.ok(f.saved().world.economyRecoveries[PLAN.planId]);const reloaded=new CampaignService(f.options);assert.equal(reloaded.accounts.get(f.id).gold,102085);assert.equal(reloaded.accounts.get(f.id).oil.balance,544);assert.equal(reloaded.accounts.get(f.id).resources.fans,500);});
test('failed startup write leaves original save intact; next successful startup applies exactly once',()=>{const f=bootFixture(),before=f.saved();f.fail(true);assert.throws(()=>new CampaignService(f.options),/disk failed/);assert.deepEqual(f.saved(),before);f.fail(false);const s=new CampaignService(f.options);assert.equal(s.accounts.get(f.id).gold,102085);assert.equal(s.world.economyRecoveries[PLAN.planId].players.length,1);});
