import {OilService} from '../server/application/oil-service.mjs';
import {repairHeadquartersWars} from '../server/application/war-settlement.mjs';
import {withoutNavalPreview} from '../shared/config/fog.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DiplomacyService} from '../server/application/diplomacy-service.mjs';
import {EconomyService} from '../server/application/economy-service.mjs';
import {CardManagementService} from '../server/application/card-management-service.mjs';
import {ChallengeService} from '../server/application/challenge-service.mjs';
import {FogService} from '../server/application/fog-service.mjs';
import {createTerritoryWorld,canAttackFromTerritory,canAttack,captureTerritory} from '../territory-model.js';
import {hydrateCampaignWorld} from '../server/infrastructure/campaign-save-migrations.mjs';
import {playersAtWar,sharedHeadquarters,relationKey} from '../shared/config/diplomacy.mjs';
import {interactionWindowMarkup,serverPlayersMarkup,interactionNoticesMarkup} from '../client/social/interaction-controller.js';
import {FogSpatialIndex} from '../shared/map/fog-spatial.mjs';
import {setAbsence,absenceMatches} from '../shared/football/match-availability.mjs';
const catalog=JSON.parse(readFileSync(new URL('../assets/data/s4-player-catalog.json',import.meta.url)));
function baseFixture(){
 let at=1800000000000,broken=false,saved;
 const index={territories:['a','b','remote'].map((id,i)=>({territoryId:id,name:id,country:'法国',countryCode:'FRA',region:'europe',centroid:[i*5,45],bounds:[i*5,45,i*5+1,46],landNeighbors:id==='remote'?[]:[id==='a'?'b':'a'],neighbors:id==='remote'?[]:[id==='a'?'b':'a'],initialOwner:{type:'neutral'},spawnAllowed:true,playable:true,cityIds:[],clubIds:[]}))};
 const world=createTerritoryWorld(index),economy=new EconomyService({now:()=>at});
 const c={world,territoryIndex:index,playerDatabase:catalog,economy,now:()=>at,accounts:new Map(),save(){if(broken)throw Error('disk failure');saved=JSON.parse(JSON.stringify({world:c.world,accounts:Object.fromEntries(c.accounts)}));}};
 const roles=['GK','LB','CB','CB','RB','LM','DM','AM','RM','ST','ST'];
 for(const [id,home]of [['a','a'],['b','b'],['c','remote']]){
  const roster=[],assignments={};for(const squad of ['expedition','garrison'])for(const [i,role]of roles.entries()){
   const p=structuredClone(catalog.find(p=>p.role===role&&!p.isX&&!roster.some(card=>card.cardDefinitionId===p.id)));p.cardDefinitionId=p.id;p.id=`${id}-${squad}-${i}`;p.playerId=p.id;p.cardInstanceId=p.id;p.state={fitness:43};roster.push(p);assignments[p.id]=squad;
  }
  const account={id,nickname:id,token:'secret-'+id,passwordHash:'private',setupComplete:true,homeTerritoryId:home,gold:100000,goldLedger:[],draft:{teamName:id,roster},playerSquads:{schemaVersion:2,assignments},resources:{fans:1000}};c.accounts.set(id,account);
  Object.assign(world.territories[home],{ownerType:'player',ownerId:id,capitalOf:id,buildings:[]});world.players[id]={playerId:id,territoryIds:[home],capitalTerritoryId:home};
 }
 c.oil=new OilService(c);
 c.cardManagement=new CardManagementService({accounts:c.accounts,world,catalog,economy,now:c.now,save:c.save});
 let d=new DiplomacyService({campaign:c});
 const action=(from,to,action,extra={})=>d.mutate(c.accounts.get(from),{targetId:to,action,requestId:crypto.randomUUID(),...extra});
 return {c,get d(){return d;},a:c.accounts.get('a'),b:c.accounts.get('b'),other:c.accounts.get('c'),action,broken:v=>broken=v,time:v=>at=v,tick:v=>at+=v,saved:()=>saved,reload:()=>{c.world=hydrateCampaignWorld(index,JSON.parse(JSON.stringify(c.world)));c.cardManagement.world=c.world;d=new DiplomacyService({campaign:c});}};
}

import {ScoutingService} from '../server/application/scouting-service.mjs';
import {JointScoutingService} from '../server/application/joint-scouting-service.mjs';
import {JOINT_SCOUTING_RULES,SCOUTING_RULES} from '../shared/config/scouting.mjs';
import {canVisitScoutTerritory,canDiscoverScoutTerritory} from '../shared/scouting/scout-units.mjs';
function fixture(){const f=baseFixture(),c=f.c;let seed=37;
 c.scouting=new ScoutingService({playerDatabase:catalog,territoryIndex:c.territoryIndex,economy:c.economy,now:c.now,save:()=>c.save(),random:()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296)});
 for(const a of [f.a,f.b]){c.world.territories[a.id].buildings.push({id:'center-'+a.id,type:'scout-center',status:'active',level:5});a.scouting={schemaVersion:2,tasks:{},units:{[a.id]:{id:a.id,name:'Scout '+a.id,territoryId:'a',originTerritoryId:a.id,originBuildingId:'center-'+a.id}}};}
 c.jointScouting=new JointScoutingService(c);c.scouting.siteProvider=()=>c.jointScouting.sites();
 f.site=c.jointScouting.sites().territories[0].id;for(const a of [f.a,f.b])a.scouting.units[a.id].territoryId=f.site;
 f.propose=(rounds=30)=>f.action('a','b','joint-scout',{joint:{scoutId:'a',territoryId:f.site,rounds}});
 f.accept=p=>f.action('b','a','accept',{proposalId:p.proposalId,scoutId:'b'});return f;
}
test('joint invitation commits two independent 30-round queues, split fee and private results',()=>{
 const f=fixture(),p=f.propose(),request=f.c.world.diplomacy.requests[p.proposalId],terms=request.payload;
 assert.equal(f.a.gold,100000);assert.equal(terms.totalGold,terms.perPlayerGold*2);assert.equal(terms.legendaryChance,.045);assert.deepEqual(terms.enhancementWeights,{0:88,1:8,2:3,3:1});
 const body={targetId:'a',action:'accept',proposalId:p.proposalId,scoutId:'b',requestId:'joint-accept-id'};f.d.mutate(f.b,body);f.d.mutate(f.b,body);
 const x=Object.values(f.a.scouting.tasks)[0],y=Object.values(f.b.scouting.tasks)[0];
 assert.equal(x.rounds.length,30);assert.equal(y.rounds.length,30);assert.equal(f.a.gold,100000-terms.perPlayerGold);assert.equal(f.b.gold,f.a.gold);
 assert.notDeepEqual(x.rounds.map(r=>r.candidates.map(p=>p.cardDefinitionId)),y.rounds.map(r=>r.candidates.map(p=>p.cardDefinitionId)));
 assert.equal(x.completesAt,y.completesAt);assert.deepEqual(f.c.scouting.publicTask(x).cards,[]);assert.ok(!JSON.stringify(f.d.publicRequest(request)).includes('candidates'));
 assert.throws(()=>f.c.scouting.requireIdle(f.a,f.a.scouting.units.a),/当前发掘/);
 f.time(x.completesAt);const ids=x.rounds.map(r=>r.candidates[0].id),other=y.rounds.map(r=>r.candidates[0].id);
 assert.throws(()=>f.c.scouting.claimQueue(f.a,x.id,other),/对应轮次/);
 const n=f.a.draft.roster.length;f.c.scouting.claimQueue(f.a,x.id,ids);f.c.scouting.claimQueue(f.a,x.id,ids);assert.equal(f.a.draft.roster.length,n+30);assert.equal(y.claimedAt,null);assert.equal(f.b.draft.roster.length,n);
 assert.deepEqual(structuredClone(f.saved().accounts.b.scouting.tasks[y.id].rounds),y.rounds);
});
test('joint save failure rolls back both wallets, scouts, proposal and results',()=>{const f=fixture(),p=f.propose(),before=structuredClone([f.a,f.b]);f.broken(true);assert.throws(()=>f.accept(p),/disk failure/);assert.deepEqual([f.a,f.b],before);assert.equal(f.c.world.diplomacy.requests[p.proposalId].status,'pending');f.broken(false);f.accept(p);assert.equal(Object.keys(f.a.scouting.tasks).length,1);});
test('accept revalidates scout occupancy, ownership, wallet and changed price',()=>{
 for(const mutate of [f=>f.a.scouting.units.a.movement={id:'busy'},f=>f.b.gold=0,f=>f.b.scouting.units.b.territoryId='missing',f=>f.c.world.territories.a.buildings[0].level=1]){const f=fixture(),p=f.propose();mutate(f);const before=structuredClone([f.a,f.b]);assert.throws(()=>f.accept(p));assert.deepEqual([f.a,f.b],before);}
 const f=fixture(),p=f.propose();assert.throws(()=>f.action('b','a','accept',{proposalId:p.proposalId,scoutId:'a'}),/不存在/);assert.throws(()=>f.propose(31),/待处理/);const other=fixture();assert.throws(()=>other.propose(31),/1～30/);assert.equal(SCOUTING_RULES.maxQueueRounds,20);
});
test('sites persist across restart, rotate sparsely, expire invitations, retain paid results',()=>{
 const f=fixture(),sites=structuredClone(f.c.jointScouting.sites());assert.equal(sites.territories.length,3);
 const loaded=hydrateCampaignWorld(f.c.territoryIndex,structuredClone(f.c.world));const savedSeed=f.c.world.jointScoutingSeed;assert.equal(loaded.jointScoutingSeed,savedSeed);
 assert.deepEqual(new JointScoutingService({...f.c,world:loaded}).sites(),sites);
 const p=f.propose();f.time(sites.expiresAt);assert.throws(()=>f.accept(p),/过期/);assert.notEqual(f.c.jointScouting.sites().rotationId,sites.rotationId);assert.equal(f.a.gold,100000);
 const g=fixture(),q=g.propose();g.accept(q);const t=Object.values(g.a.scouting.tasks)[0];g.time(t.completesAt+JOINT_SCOUTING_RULES.rotationMs);g.c.jointScouting.sites();assert.equal(g.c.scouting.publicTask(t).status,'ready');assert.ok(canVisitScoutTerritory(g.a,g.c.world,g.site));
});
test('activity access is scout-only and does not grant normal solo discovery',()=>{const f=fixture();const site=f.c.jointScouting.sites().territories.find(t=>t.id!==f.a.id);assert.ok(canVisitScoutTerritory(f.a,f.c.world,site.id));assert.equal(canDiscoverScoutTerritory(f.a,f.c.world,site.id),false);assert.ok(f.c.scouting.moveTargets(f.a,f.c.world,f.site).includes(site.id)||site.id===f.site);});
test('profile avoids all trade-card checks; cards load explicitly and preview never clones history',()=>{const f=fixture();let checks=0;f.c.cardManagement.blocked=()=>{checks++;return null;};Object.defineProperty(f.b,'hugeHistory',{get(){throw Error('unrelated history read');},enumerable:true});const p=f.d.details(f.a,'b',{profile:true});assert.equal(checks,0);assert.equal(p.myCards,null);assert.equal(p.theirCards,null);assert.equal(p.cardCount,22);assert.equal(p.squad.players.length,11);f.d.cards(f.a,'b');assert.equal(checks,44);});
test('enhancement overrides leave ordinary rolls unchanged',()=>{const f=fixture();const rolls=[.9,.5,.5,.5,.90];let i=0;f.c.scouting.random=()=>rolls[i++%5];const ordinary=f.c.scouting.draw(5,'FRA');i=0;const joint=f.c.scouting.draw(5,'FRA',3,null,{enhancementWeights:JOINT_SCOUTING_RULES.enhancementWeights});assert.ok(ordinary.every(p=>p.upgradeLevel===0));assert.ok(joint.every(p=>p.upgradeLevel===1));});

test('reject/cancel do not charge or reserve either scout; war blocks the plan',()=>{for(const action of ['reject','cancel']){const f=fixture(),p=f.propose();f.action(action==='cancel'?'a':'b',action==='cancel'?'b':'a',action,{proposalId:p.proposalId});assert.equal(f.a.gold,100000);assert.equal(f.b.gold,100000);assert.equal(Object.keys(f.a.scouting.tasks).length,0);f.c.scouting.requireIdle(f.a,f.a.scouting.units.a);}const f=fixture(),p=f.propose();f.action('b','a','war');assert.throws(()=>f.accept(p));assert.equal(Object.keys(f.a.scouting.tasks).length,0);});
test('three random sites from a larger map, no persistence or candidate work during polling',()=>{const f=fixture();for(let i=0;i<20;i++){const id='site-'+i;f.c.territoryIndex.territories.push({territoryId:id,centroid:[i,40],playable:true});f.c.world.territories[id]={ownerType:'neutral'};}f.c.world.jointScoutingSeed='deterministic-sites';const service=new JointScoutingService(f.c),before=structuredClone(service.sites());assert.equal(before.territories.length,3);assert.equal(new Set(before.territories.map(t=>t.id)).size,3);f.c.save=()=>{throw Error('poll write');};for(let i=0;i<20;i++)assert.deepEqual(service.sites(),before);f.time(before.expiresAt);assert.notDeepEqual(service.sites().territories,before.territories);});
test('joint polling stays compact after completion; result detail hydrates only the requester',()=>{const f=fixture(),p=f.propose();f.accept(p);const t=Object.values(f.a.scouting.tasks)[0];f.time(t.completesAt);const compact=f.c.scouting.publicState(f.a,f.c.world);assert.equal(compact.tasks[0].rounds.length,0);assert.equal(compact.scouts[0].task.cards.length,0);assert.equal(compact.tasks[0].candidatesDeferred,true);assert.equal(f.c.scouting.taskDetails(f.a,t.id).task.rounds.length,30);assert.throws(()=>f.c.scouting.taskDetails(f.b,t.id),/不存在/);});

test('joint S boost changes the actual draw threshold, not just displayed odds',()=>{const f=fixture();f.c.scouting.random=()=>.04;assert.ok(f.c.scouting.draw(5,'FRA').every(p=>p.grade!=='S'));assert.ok(f.c.scouting.draw(5,'FRA',3,null,{legendaryChance:.045}).every(p=>p.grade==='S'));});
