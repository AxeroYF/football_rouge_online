import test from 'node:test';
import assert from 'node:assert/strict';
import {liberationBeneficiary,pendingLiberations,resolveLiberation,migrateOriginalOwners} from '../server/application/territory-liberation.mjs';
import {claimHome,captureTerritory,createTerritoryWorld} from '../territory-model.js';
import {ChallengeService,publicChallengeView} from '../server/application/challenge-service.mjs';
import {relationKey} from '../shared/config/diplomacy.mjs';
import {setTestWar} from './diplomacy-fixture.mjs';
import {coalitionFixture} from './coalition-fixture.mjs';
import {buildV2TeamSnapshots} from '../engine/s4-v2.1/versus/v2/team-snapshot-v2.js';
import {publicCampaignLiveLeg,advanceCampaignLiveLeg} from '../engine/campaign-match-engine.mjs';
import {hydrateCampaignWorld} from '../server/infrastructure/campaign-save-migrations.mjs';
const at=Date.parse('2026-09-19T04:00:00Z');
const ally=(w,a,b)=>{w.diplomacy??={relationships:{}};w.diplomacy.relationships[relationKey(a,b)]={players:[a,b],state:'alliance'};};
const index={territories:['home','target','other'].map(territoryId=>({territoryId,playable:true,spawnAllowed:true,neighbors:[],initialOwner:{type:'neutral',id:null}}))};
function fixture() {
 const world=createTerritoryWorld(index),accounts=new Map(['a','b','c'].map(id=>[id,{id,nickname:id,homeTerritoryId:id==='a'?'home':'other',draft:{roster:[]}}]));
 claimHome(index,world,'a','home');claimHome(index,world,'b','target');setTestWar(world,'c','b');
 captureTerritory(index,world,'c','target',{permission:{allowed:true}});ally(world,'a','b');setTestWar(world,'a','c');
 let fail=false,saves=0;
 const save=()=>{if(fail)throw Error('disk failure');saves++;};
 const service=new ChallengeService({world,accounts,territoryIndex:index,now:()=>at,save});
 const challenge={id:'battle-1',territoryId:'target',attackerId:'a',defenderId:'c',previousOwner:{type:'player',id:'c'},battle:{challengeId:'battle-1',territoryId:'target',outcome:'win'}};
 world.activeChallenges.target=challenge;
 const resolve=(action='liberate',extra={})=>resolveLiberation({world,accounts,account:accounts.get('a'),territoryId:'target',challengeId:'battle-1',action,save,now:at,...extra});
 return {world,accounts,service,challenge,resolve,save,fail:v=>fail=v,saves:()=>saves};
}
test('first neutral owner is immutable across enemy captures; club capture creates no provenance',()=>{
 const f=fixture();assert.equal(f.world.territories.target.originalOwnerId,'b');
 f.service.settleChallenge(f.challenge);assert.equal(f.world.territories.target.originalOwnerId,'b');f.resolve();assert.equal(f.world.territories.target.originalOwnerId,'b');
 const w=createTerritoryWorld(index);w.territories.target.ownerType='club';captureTerritory(index,w,'a','target',{permission:{allowed:true}});assert.equal(w.territories.target.originalOwnerId,undefined);
});
test('only allies liberating someone else from a player qualify',()=>{
 const f=fixture();assert.equal(liberationBeneficiary(f.world,f.accounts,'a','target'),'b');
 for(const id of ['b','c','stranger'])assert.equal(liberationBeneficiary(f.world,f.accounts,id,'target'),null);
 f.world.territories.target.ownerType='neutral';assert.equal(liberationBeneficiary(f.world,f.accounts,'a','target'),null);
 f.world.territories.target.ownerType='player';f.accounts.delete('b');assert.equal(liberationBeneficiary(f.world,f.accounts,'a','target'),null);
});
test('successful recapture persists a choice, returns ownership, and is idempotent',()=>{
 const f=fixture();f.service.settleChallenge(f.challenge);assert.equal(f.world.territories.target.ownerId,'a');
 assert.equal(pendingLiberations(f.world,f.accounts,f.accounts.get('a')).length,1);assert.equal(pendingLiberations(f.world,f.accounts,f.accounts.get('b')).length,0);
 assert.equal(hydrateCampaignWorld(index,JSON.parse(JSON.stringify(f.world))).territories.target.pendingLiberation.challengeId,'battle-1');
 f.resolve();assert.equal(f.world.territories.target.ownerId,'b');assert.ok(f.world.players.b.territoryIds.includes('target'));assert.ok(!f.world.players.a.territoryIds.includes('target'));assert.equal(f.world.players.b.exiled,false);
 const saves=f.saves();f.resolve();assert.equal(f.saves(),saves);assert.equal(f.world.news.filter(n=>n.type==='liberation').length,1);
 assert.throws(()=>f.resolve('keep'),/失效/);
});
test('keep resolves permanently without changing original owner; forged and stale choices fail',()=>{
 const f=fixture();f.service.settleChallenge(f.challenge);
 assert.throws(()=>f.resolve('liberate',{account:f.accounts.get('c')}),/失效/);assert.throws(()=>f.resolve('liberate',{challengeId:'forged'}),/失效/);
 f.resolve('keep');assert.equal(f.world.territories.target.ownerId,'a');assert.equal(f.world.territories.target.originalOwnerId,'b');assert.equal(f.world.territories.target.pendingLiberation,undefined);
 assert.throws(()=>f.resolve(),/失效/);
});
test('leaving alliance disables liberation but permits keep; active battle blocks decisions',()=>{
 const f=fixture();f.service.settleChallenge(f.challenge);f.world.activeChallenges.target={id:'new'};assert.throws(()=>f.resolve(),/比赛中/);delete f.world.activeChallenges.target;
 f.world.diplomacy.relationships[relationKey('a','b')].state='neutral';assert.equal(pendingLiberations(f.world,f.accounts,f.accounts.get('a'))[0].canLiberate,false);assert.throws(()=>f.resolve(),/不是你的盟友/);f.resolve('keep');
});
test('new capture invalidates the old choice; defeat never creates a choice',()=>{
 const f=fixture();f.service.settleChallenge(f.challenge);captureTerritory(index,f.world,'c','target',{permission:{allowed:true}});assert.throws(()=>f.resolve(),/失效/);assert.equal(f.world.territories.target.pendingLiberation,undefined);
 const lost=fixture();lost.challenge.battle.outcome='loss';lost.service.settleChallenge(lost.challenge);assert.equal(lost.world.territories.target.pendingLiberation,undefined);
});
test('settlement and return both roll back completely on persistence failure',()=>{
 const f=fixture();f.fail(true);assert.throws(()=>f.service.settleChallenge(f.challenge),/disk failure/);assert.equal(f.world.territories.target.ownerId,'c');assert.equal(f.world.territories.target.pendingLiberation,undefined);
 f.fail(false);f.service.settleChallenge(f.challenge);const before=JSON.stringify(f.world);f.fail(true);assert.throws(()=>f.resolve(),/disk failure/);assert.equal(JSON.stringify(f.world),before);
 f.fail(false);f.resolve();assert.equal(f.world.territories.target.ownerId,'b');
});
test('migration uses proven neutral captures and survives hydration without guessing current owners',()=>{
 const f=fixture();delete f.world.territories.target.originalOwnerId;f.accounts.get('b').battleHistory=[{territoryId:'target',captured:true,defender:{type:'neutral'},settledAt:at}];
 assert.equal(migrateOriginalOwners(f),true);assert.equal(f.world.territories.target.originalOwnerId,'b');assert.equal(f.world.territories.other.originalOwnerId,undefined);assert.equal(migrateOriginalOwners(f),false);
 const restored=hydrateCampaignWorld(index,JSON.parse(JSON.stringify(f.world)));assert.equal(restored.originalOwnersVersion,1);assert.equal(migrateOriginalOwners({world:restored,accounts:f.accounts}),false);
});
test('20 percent multiplies effective V2 ability after overflow folding, never display attributes or source cards',()=>{
 const p={id:'p',name:'p',role:'ST',attributes:{finishing:109,pace:80},traits:[]},team={name:'A',players:[p],positions:{p:{x:50,y:20}}};
 const snapshot=buildV2TeamSnapshots([team,team],{internalAbilityMultipliers:[1,1.2]});
 assert.equal(snapshot[1].players[0].attributes.finishing,121.2);assert.equal(snapshot[1].players[0].attributes.pace,96);assert.equal(snapshot[0].players[0].attributes.finishing,101);
 assert.equal(snapshot[1].players[0].displayAttributes.finishing,109);assert.equal(p.attributes.finishing,109);
});
test('real campaign freezes server bonus across both legs and restart, without public markers',()=>{
 const f=coalitionFixture();setTestWar(f.s.world,'a','c');f.s.world.territories.c.originalOwnerId='b';
 const challenge=f.s.challenges.begin(f.a,'c',{internalAbilityMultipliers:[9,9]}).challenge;
 assert.deepEqual(challenge.internalAbilityMultipliers,[1,1.2]);assert.deepEqual(challenge.live.firstLeg.match.internalAbilityMultipliers,[1,1.2]);
 assert.ok(!JSON.stringify(publicChallengeView(challenge,f.now)).includes('internalAbility'));
 assert.ok(!JSON.stringify(publicCampaignLiveLeg(challenge.live.firstLeg)).includes('internalAbility'));
 advanceCampaignLiveLeg(challenge.live.firstLeg,f.now+10000,{maximumChains:1});
 const boosted=challenge.live.firstLeg.match.snapshotTeams[1].players[0];
 const base=buildV2TeamSnapshots(challenge.live.firstLeg.match.teams,{parameters:challenge.live.firstLeg.match.parameters,state:{minute:challenge.live.firstLeg.match.minute,score:challenge.live.firstLeg.match.score},environment:challenge.live.firstLeg.match.environment})[1].players[0];
 assert.ok(Math.abs(boosted.attributes.pace-base.attributes.pace*1.2)<.02);
 challenge.live.firstLeg.match.finished=true;f.advance();f.s.save();f.reload();
 const restored=f.s.world.activeChallenges.c;assert.deepEqual(restored.internalAbilityMultipliers,[1,1.2]);f.tick(restored.secondLegStartsAt-f.now);f.advance();
 assert.deepEqual(restored.live.secondLeg.match.internalAbilityMultipliers,[1,1.2]);
 assert.ok(!JSON.stringify(f.s.challengeStatus(f.a,restored.id)).includes('internalAbility'));
});
test('client cannot grant an ordinary attack a bonus',()=>{
 const f=coalitionFixture();setTestWar(f.s.world,'a','c');const c=f.s.challenges.begin(f.a,'c',{internalAbilityMultipliers:[9,9]}).challenge;assert.equal(c.internalAbilityMultipliers,null);assert.equal(c.live.firstLeg.match.internalAbilityMultipliers,undefined);
});

test('shootout fallback applies the same hidden multiplier after match snapshots are discarded',async()=>{
 const {v2PenaltyShootout}=await import('../engine/s4-v2.1/versus/v2/penalty-shootout-v2.js');
 const f=coalitionFixture();setTestWar(f.s.world,'a','c');f.s.world.territories.c.originalOwnerId='b';const ch=f.s.challenges.begin(f.a,'c').challenge;
 const boosted=ch.live.firstLeg.match;delete boosted.snapshotTeams;
 const ordinary=structuredClone({...boosted,rng:undefined});delete ordinary.internalAbilityMultipliers;let i=0;const random=()=>[.2,.3,.85,.65,.91,.4,.73,.1,.82,.6,.95,.2][i++%12];boosted.rng=random;const result=v2PenaltyShootout(boosted);i=0;ordinary.rng=random;const baseline=v2PenaltyShootout(ordinary);
 const kick=result.kicks.find(k=>k.teamIndex===1),base=baseline.kicks.find(k=>k.teamIndex===1);assert.equal(kick.takerId,base.takerId);assert.ok(kick.probability>base.probability);assert.ok(!JSON.stringify(result).includes('internalAbility'));
});
