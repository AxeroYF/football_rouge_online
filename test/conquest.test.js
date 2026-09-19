import {setTestWar} from './diplomacy-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { conquestState, conquestAttackBlock, conquestDay, EXPEDITION_DEFEAT_COOLDOWN_MS } from '../shared/config/conquest.mjs';
import { ChallengeService } from '../server/application/challenge-service.mjs';
const noon = Date.parse('2026-09-08T04:00:00Z');
function fixture({ now = noon, used = 0, type = 'neutral', outcome = 'win', save = () => {} } = {}) {
  let time = now;
  const account = {id:'a', setupComplete:true,homeTerritoryId:'home',draft:{roster:[{}]},conquest:{day:conquestDay(time),used,cooldownUntil:0}};
  const target={ownerType:type,ownerId:type==='player'?'b':null,version:0,buildings:[]};
  const world={revision:0,territories:{target},players:{a:{territoryIds:['home']},b:{territoryIds:['target']}},activeChallenges:{}};
  const challenge={id:'test',attackerId:'a',territoryId:'target',previousOwner:{type,id:target.ownerId},battle:{outcome},settleAt:now};
  world.activeChallenges.target=challenge;
  if(type==='player')setTestWar(world,'a','b');
  const service=new ChallengeService({world,accounts:new Map([['a',account]]),territoryIndex:{territories:[{territoryId:'target'}]},now:()=>time,save});
  return {account,world,challenge,service,time:value=>time=value};
}
test('new account starts with 8 and Beijing 08:00 resets usage',()=>{
  assert.equal(conquestState({},noon).remaining,8);
  const account={conquest:{day:'2026-09-08',used:8}};
  const midnight=Date.parse('2026-09-09T00:00:00Z');
  assert.equal(conquestState(account,midnight-1).remaining,0);
  assert.equal(conquestState(account,midnight-1).resetsAt,midnight);
  assert.equal(conquestState(account,midnight).remaining,8);
});
test('legacy successful neutral captures are counted, failures and club captures are not',()=>{
  const account={battleHistory:[{captured:true,defender:{type:'neutral'},settledAt:noon},{captured:false,outcome:'loss',settledAt:noon},{captured:true,defender:{type:'club'},settledAt:noon}]};
  const state=conquestState(account,noon);assert.equal(state.used,1);assert.equal(state.cooldownUntil,noon+1200000);
});
test('last allowed capture spends once, duplicate settlement cannot spend twice',()=>{
 const f=fixture({used:7});assert.equal(f.service.settleChallenge(f.challenge).captured,true);
 assert.equal(f.service.conquestState(f.account).remaining,0);assert.equal(f.service.settleChallenge(f.challenge),null);assert.equal(f.account.conquest.used,8);
});
test('quota rejects both land and maritime begins before engine creation',()=>{
 const f=fixture({used:8});f.world.activeChallenges={};
 for(const options of [{},{maritimeRoute:{}}])assert.throws(()=>f.service.begin(f.account,'target',options),/次数已用完/);
});
test('legacy in-flight challenge cannot exceed daily limit at settlement',()=>{
 const f=fixture({used:8});const battle=f.service.settleChallenge(f.challenge);assert.equal(battle.captured,false);assert.match(battle.captureBlockedReason,/次数/);assert.equal(f.world.territories.target.ownerType,'neutral');
});
test('failure retains quota and prevents every type of attack for exactly 20 minutes',()=>{
 const f=fixture({used:2,outcome:'loss'});f.service.settleChallenge(f.challenge);
 assert.equal(f.account.conquest.used,2);assert.equal(f.account.conquest.cooldownUntil,noon+EXPEDITION_DEFEAT_COOLDOWN_MS);
 for(const type of ['neutral','player','club']){f.world.territories.target.ownerType=type;assert.throws(()=>f.service.begin(f.account,'target'),/休整/);}
 f.time(noon+1200000-1);assert.throws(()=>f.service.assertAttackAvailable(f.account,'target'),/休整/);
 f.time(noon+1200000);assert.doesNotThrow(()=>f.service.assertAttackAvailable(f.account,'target'));
});
test('failure cooldown survives the 08:00 reset, JSON save and service reconstruction',()=>{
 const midnight=Date.parse('2026-09-09T00:00:00Z');const f=fixture({now:midnight-1000,outcome:'loss',used:4});f.service.settleChallenge(f.challenge);
 const restored=JSON.parse(JSON.stringify(f.account));const state=conquestState(restored,midnight);
 assert.equal(state.remaining,8);assert.equal(conquestAttackBlock(state,'neutral').code,'expedition-cooldown');
 const service=new ChallengeService({world:f.world,accounts:new Map([['a',restored]]),now:()=>midnight});assert.throws(()=>service.assertAttackAvailable(restored,'target'),/休整/);
});
test('cross-08:00 win is counted on the new conquest day',()=>{
 const f=fixture({now:Date.parse('2026-09-08T23:59:00Z'),used:4});f.time(Date.parse('2026-09-09T00:01:00Z'));f.service.settleChallenge(f.challenge);assert.equal(f.account.conquest.day,'2026-09-09');assert.equal(f.account.conquest.used,1);
});
test('player and club capture leave neutral quota unchanged',()=>{
 for(const type of ['player','club']){const f=fixture({used:5,type});assert.equal(f.service.settleChallenge(f.challenge).captured,true);assert.equal(f.account.conquest.used,5);}
});
test('save failure rolls back capture, quota and cooldown; retry applies once',()=>{
 for(const outcome of ['win','loss']){let fail=true;const f=fixture({used:3,outcome,save:()=>{if(fail)throw Error('disk failure');}});
 assert.throws(()=>f.service.settleChallenge(f.challenge),/disk failure/);assert.equal(f.account.conquest.used,3);assert.equal(f.account.conquest.cooldownUntil,0);assert.equal(f.world.territories.target.ownerType,'neutral');assert.ok(f.world.activeChallenges.target);
 fail=false;f.service.settleChallenge(f.challenge);assert.equal(f.account.conquest.used,outcome==='win'?4:3);}
});
test('wonder bonus adds one daily conquest and is visible in limit',()=>{
 const f=fixture({used:8});f.service.wonders={modifiers:()=>({neutralAttacksBonus:1})};assert.equal(f.service.conquestState(f.account).limit,9);assert.equal(f.service.conquestState(f.account).remaining,1);assert.doesNotThrow(()=>f.service.assertAttackAvailable(f.account,'target'));
});

test('raising the base limit preserves the five captures already used in an existing save',()=>{const a=JSON.parse(JSON.stringify({conquest:{day:conquestDay(noon),used:5,cooldownUntil:0}}));assert.equal(conquestState(a,noon).limit,8);assert.equal(conquestState(a,noon).remaining,3);});

test('curfew blocks all attack targets from Beijing midnight until exactly 08:00',()=>{
 const midnight=Date.parse('2026-09-08T16:00:00Z'),morning=Date.parse('2026-09-09T00:00:00Z');
 for(const type of ['neutral','player','club']){
  const f=fixture({now:midnight-1,type});assert.doesNotThrow(()=>f.service.assertAttackAvailable(f.account,'target'));
  for(const at of [midnight,midnight+1,morning-1]){f.time(at);assert.throws(()=>f.service.assertAttackAvailable(f.account,'target'),e=>e.code==='attack-curfew');}
  f.time(morning);assert.doesNotThrow(()=>f.service.assertAttackAvailable(f.account,'target'));
 }
});
test('a match already in progress settles during curfew without refreshing the day',()=>{
 const f=fixture({now:Date.parse('2026-09-08T15:59:00Z'),used:4});f.time(Date.parse('2026-09-08T16:01:00Z'));
 assert.equal(f.service.settleChallenge(f.challenge).captured,true);assert.equal(f.account.conquest.day,'2026-09-08');assert.equal(f.account.conquest.used,5);assert.equal(f.account.conquest.resetHour,8);
});
test('midnight does not replenish quotas and migration separates old early-morning captures',()=>{
 const midnight=Date.parse('2026-09-08T16:00:00Z'),morning=Date.parse('2026-09-09T00:00:00Z');
 const a={conquest:{day:'2026-09-08',used:8,resetHour:8}};
 assert.equal(conquestState(a,midnight).remaining,0);assert.equal(conquestState(a,morning-1).remaining,0);assert.equal(conquestState(a,morning).remaining,8);
 const capture=at=>({captured:true,defender:{type:'neutral'},settledAt:Date.parse(at)});
 const legacy={conquest:{day:'2026-09-09',used:3},battleHistory:[capture('2026-09-08T17:00:00Z'),capture('2026-09-08T19:00:00Z'),capture('2026-09-09T01:00:00Z')]};
 assert.equal(conquestState(legacy,Date.parse('2026-09-09T02:00:00Z')).used,1);
 assert.equal(conquestState(legacy,Date.parse('2026-09-08T23:00:00Z')).used,2);
});
