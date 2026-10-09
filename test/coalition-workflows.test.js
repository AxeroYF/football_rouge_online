import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {coalitionFixture} from './coalition-fixture.mjs';
import {setTestWar} from './diplomacy-fixture.mjs';
import {coalitionPlayerId} from '../shared/config/coalition.mjs';
import {absenceMatches} from '../shared/football/match-availability.mjs';
const action=(f,a,action,extra={})=>{const army=f.s.coalitions.find(a);return f.s.coalitions.mutate(a,{action,pvpConfirmed:action==='attack',requestId:crypto.randomUUID(),armyId:army?.id,revision:army?.revision,...extra});};
function assembled(){const f=coalitionFixture();action(f,f.a,'create',{name:'同盟测试联军'});for(const p of f.a.draft.roster.slice(0,6))action(f,f.a,'lend',{playerId:p.id});for(const p of f.b.draft.roster.slice(6,11))action(f,f.b,'lend',{playerId:p.id});action(f,f.a,'auto-lineup');return f;}
const army=f=>f.s.coalitions.find(f.a);
function airports(f){for(const id of ['a','b'])f.s.world.territories[id].buildings.push({id:'airport-'+id,type:'airport',status:'active',level:1});f.s.save();const body={kind:'coalition',unitId:army(f).id,territoryId:'b',requestId:crypto.randomUUID()},quote=f.s.airports.quote(f.a,body);return {...body,goldCost:quote.goldCost,quoteId:quote.quoteId};}
test('only commander can browse allied card warehouse and request; only owner may accept',()=>{
 const f=assembled(),p=f.b.draft.roster[0];assert.ok(f.s.coalitions.loanCards(f.a,'b').cards.some(c=>c.id===p.id));
 assert.throws(()=>f.s.coalitions.loanCards(f.b,'a'),/指挥官/);assert.throws(()=>f.s.coalitions.loanCards(f.a,'c'),/盟友/);
 const r=action(f,f.a,'request-loan',{ownerId:'b',playerId:p.id});assert.equal(p.coalitionLoan,undefined);assert.equal(f.s.coalitions.loanNotices(f.b)[0].id,r.loanRequestId);
 assert.throws(()=>action(f,f.a,'accept-loan',{loanRequestId:r.loanRequestId}),/自己的/);
 assert.throws(()=>action(f,f.a,'request-loan',{ownerId:'b',playerId:p.id}),/已申请/);
 action(f,f.b,'accept-loan',{loanRequestId:r.loanRequestId});assert.equal(f.b.draft.roster.find(x=>x.id===p.id).coalitionLoan.armyId,army(f).id);assert.equal(f.s.coalitions.loanNotices(f.b).length,0);assert.equal(army(f).tactics,null);
});
test('approval survives restart and rejection never transfers a card; departed owners lose access',()=>{
 const f=assembled(),p=f.b.draft.roster[0],r=action(f,f.a,'request-loan',{ownerId:'b',playerId:p.id});f.reload();
 assert.equal(f.s.coalitions.loanNotices(f.b)[0].id,r.loanRequestId);action(f,f.b,'reject-loan',{loanRequestId:r.loanRequestId});assert.equal(f.b.draft.roster[0].coalitionLoan,undefined);
 action(f,f.a,'request-loan',{ownerId:'b',playerId:p.id});f.s.diplomacy.leaveAlliance(f.b);assert.equal(f.s.coalitions.loanNotices(f.b).length,0);
});
test('approval revalidates player locks and rolls back transfer on save failure',()=>{
 const f=assembled(),p=f.b.draft.roster[0],r=action(f,f.a,'request-loan',{ownerId:'b',playerId:p.id});
 p.coalitionLoan={armyId:'another'};assert.throws(()=>action(f,f.b,'accept-loan',{loanRequestId:r.loanRequestId}),/借调|联军/);delete f.b.draft.roster.find(x=>x.id===p.id).coalitionLoan;
 const save=f.s.repository.save;let count=0;f.s.repository.save=v=>{if(++count===1)throw Error('disk failure');return save(v);};
 assert.throws(()=>action(f,f.b,'accept-loan',{loanRequestId:r.loanRequestId}),/disk failure/);assert.equal(f.b.draft.roster[0].coalitionLoan,undefined);assert.equal(army(f).loanRequests[0].status,'pending');
 f.s.repository.save=save;action(f,f.b,'accept-loan',{loanRequestId:r.loanRequestId});assert.ok(f.b.draft.roster[0].coalitionLoan);
});
test('coalition and expedition use identical sea/port timing and oil total, with only payment split',()=>{
 const f=assembled();f.s.wonders.isSeaJourney=()=>true;f.s.wonders.seaTravel=(a,b)=>({...b,durationMs:190000});
 f.s.world.territories.a.buildings.push({id:'port',type:'port',status:'active',level:3});
 for(const useOil of [true,false]){const individual=f.s.estimateExpedition(f.a,'b',{useOil}).estimate,group=f.s.coalitions.estimate(army(f),{territoryId:'b',useOil});
  for(const k of ['distanceKm','durationMs','normalDurationMs','oilRequired','oilSpent','mode'])assert.equal(group[k],individual[k],k);
  assert.equal(group.shares.reduce((n,s)=>n+s.amount,0),individual.oilRequired);
 }
});
test('shared movement cancels invalid allied destinations and allows commander cancellation',()=>{
 const f=assembled(),q=f.s.coalitions.estimate(army(f),{territoryId:'b'});action(f,f.a,'move',{territoryId:'b',quoteId:q.quoteId});
 assert.throws(()=>action(f,f.b,'cancel-move'),/指挥官/);action(f,f.a,'cancel-move');assert.equal(army(f).territoryId,'a');assert.equal(army(f).movement,null);
 const next=f.s.coalitions.estimate(army(f),{territoryId:'b'});action(f,f.a,'move',{territoryId:'b',quoteId:next.quoteId});f.s.world.territories.b.ownerId='c';f.s.save();assert.equal(army(f).movement,null);assert.equal(army(f).territoryId,'a');
});
test('coalition air travel splits normal expedition ticket, persists and refunds each payer',()=>{
 const f=assembled(),body=airports(f),gold=[f.a.gold,f.b.gold];
 assert.equal(body.goldCost,f.s.airports.quote(f.a,{kind:'expedition',unitId:'expedition',territoryId:'b'}).goldCost);
 f.s.airports.move(f.a,body);assert.equal(f.a.gold,gold[0]-body.goldCost/2);assert.equal(f.b.gold,gold[1]-body.goldCost/2);
 f.reload();f.s.world.territories.b.buildings=[];f.tick(60000);f.s.save();
 for(const a of [f.a,f.b])assert.equal(a.goldLedger.filter(e=>e.reason==='airport-flight-refund').reduce((n,e)=>n+e.delta,0),body.goldCost/2);
 assert.equal(army(f).territoryId,'a');assert.equal(army(f).movement,null);
});
test('coalition airport quote rejects changed shares and persistence rolls all payers back',()=>{
 const f=assembled(),body=airports(f);f.s.world.diplomacy.relationships.extra={players:['a','c'],state:'alliance'};assert.throws(()=>f.s.airports.move(f.a,body),/分摊/);delete f.s.world.diplomacy.relationships.extra;
 const gold=[f.a.gold,f.b.gold],save=f.s.repository.save;let count=0;f.s.repository.save=v=>{if(++count===2)throw Error('disk failure');return save(v);};assert.throws(()=>f.s.airports.move(f.a,body),/disk failure/);
 assert.deepEqual([f.a.gold,f.b.gold],gold);assert.equal(army(f).movement,null);assert.equal(f.a.airportRequests?.[body.requestId],undefined);
});
test('allied recapture bonus applies to the whole coalition even when beneficiary is original owner',()=>{
 const f=assembled();setTestWar(f.s.world,'a','c');setTestWar(f.s.world,'b','c');f.s.world.territories.c.originalOwnerId='b';
 action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'b'});action(f,f.b,'confirm-target',{proposalId:army(f).proposal.id});
 const q=f.s.coalitions.estimate(army(f),{...army(f).proposal,kind:'attack'});action(f,f.a,'attack',{quoteId:q.quoteId});f.tick(q.durationMs);f.s.advanceActiveChallenges(f.now,{maximumMatches:10,maximumChainsPerMatch:1});
 const ch=f.s.world.activeChallenges.c;assert.equal(ch.coalitionId,army(f).id);assert.deepEqual(ch.internalAbilityMultipliers,[1,1.2]);
 ch.battle={outcome:'win'};f.s.challenges.settleChallenge(ch);assert.equal(f.s.world.territories.c.ownerId,'b');assert.equal(f.s.world.territories.c.pendingLiberation,undefined);
});
test('allied territory automatically uses coalition defence, locks it, and records contributors reports',()=>{
 const f=assembled();setTestWar(f.s.world,'c','a');const c=f.s.accounts.get('c'),ch=f.s.challenges.begin(c,'a').challenge;
 assert.equal(ch.defenderId,'a');assert.equal(ch.defenderCoalitionId,army(f).id);assert.equal(ch.live.defender.id,army(f).id);assert.equal(f.s.coalitions.busy(army(f)),true);
 assert.throws(()=>action(f,f.a,'move',{territoryId:'b'}),/正在行动/);assert.ok(f.s.publicWorld(f.b).activeChallenges.a.defenderCoalitionContributors.includes('b'));
 f.s.world.activeChallenges.a.battle={challengeId:ch.id,territoryId:'a',outcome:'loss',broadcasts:[]};f.s.challenges.settleChallenge(ch);assert.equal(f.s.world.territories.a.ownerId,'a');assert.equal(army(f).lastChallengeId,ch.id);assert.ok(f.b.battleHistory.some(b=>b.challengeId===ch.id));assert.equal(f.s.coalitions.busy(army(f)),false);
});
test('defending coalition preserves owner fitness, returns injuries and starts both legs full after restart',()=>{
 const f=assembled();for(const l of army(f).loans)f.s.coalitions.card(l).state.fitness=12;setTestWar(f.s.world,'c','a');const ch=f.s.challenges.begin(f.s.accounts.get('c'),'a').challenge,leg=ch.live.firstLeg,team=leg.match.teams[0],p=team.players[0];
 assert.ok(team.players.every(p=>p.state.fitness===100));const loan=army(f).loans.find(l=>coalitionPlayerId(l.ownerId,l.playerId)===p.id);const before=f.s.coalitions.card(loan).state.fitness;p.state.fitness=41;leg.match.finished=true;leg.match.postMatchConsequences={injuries:[{teamIndex:0,playerId:p.id,matches:2,reason:'match'}]};
 f.s.challenges.advance(f.now,{maximumMatches:10,maximumChainsPerMatch:1});const real=f.s.accounts.get(loan.ownerId).draft.roster.find(p=>p.id===loan.playerId);assert.equal(real.state.fitness,before);assert.equal(absenceMatches(real,'injury'),2);
 f.s.save();f.reload();const restored=f.s.world.activeChallenges.a;assert.equal(f.s.coalitions.active(army(f)).id,ch.id);f.tick(restored.secondLegStartsAt-f.now);f.s.challenges.advance(f.now,{maximumMatches:10,maximumChainsPerMatch:1});assert.equal(restored.live.secondLeg.home.id,army(f).id);assert.ok(!restored.live.secondLeg.home.players.some(x=>x.id===p.id&&x.active));assert.ok(restored.live.secondLeg.home.players.every(p=>p.state.fitness===100));
});
test('busy or incomplete coalition falls back to ordinary garrison',()=>{
 for(const reason of ['moving','incomplete','match']){const f=assembled();setTestWar(f.s.world,'c','b');const a=army(f);
  if(reason==='moving')a.movement={fromTerritoryId:'a',toTerritoryId:'b',startedAt:f.now,arrivesAt:f.now+60000};
  if(reason==='incomplete')a.tactics=null;
  if(reason==='match')f.s.world.activeChallenges.a={id:'existing',defenderCoalitionId:a.id};
  const ch=f.s.challenges.begin(f.s.accounts.get('c'),'b').challenge;assert.equal(ch.defenderCoalitionId,undefined,reason);assert.equal(ch.live.defender.id,'b');
 }
});

test('commander directly transfers to a built allied member without requiring votes or loans',()=>{const f=coalitionFixture();action(f,f.a,'create');const id=army(f).id;action(f,f.a,'transfer-command',{targetId:'b'});assert.equal(f.s.world.coalitions[id].commanderId,'b');assert.throws(()=>action(f,f.a,'transfer-command',{targetId:'a'}),/指挥官/);action(f,f.b,'transfer-command',{targetId:'a'});assert.equal(army(f).commanderId,'a');});
test('ally requests command, only commander may resolve, accepting invalidates old requests',()=>{const f=assembled();const r=action(f,f.b,'request-command');assert.equal(f.s.coalitions.commandNotices(f.a).length,1);assert.throws(()=>action(f,f.b,'request-command'),/已提交/);assert.throws(()=>action(f,f.b,'accept-command',{commandRequestId:r.commandRequestId}),/指挥官/);action(f,f.a,'accept-command',{commandRequestId:r.commandRequestId});assert.equal(f.s.coalitions.find(f.b).commanderId,'b');assert.equal(f.s.coalitions.commandNotices(f.a).length,0);f.reload();assert.equal(f.s.coalitions.find(f.b).commanderId,'b');});
test('command rejects outsiders, stale requests and transfers during movement',()=>{const f=assembled();assert.throws(()=>action(f,f.a,'transfer-command',{targetId:'c'}),/盟友/);const r=action(f,f.b,'request-command');f.tick(86400001);assert.throws(()=>action(f,f.a,'accept-command',{commandRequestId:r.commandRequestId}),/失效|状态已变化/);army(f).movement={startedAt:f.now,arrivesAt:f.now+60000,fromTerritoryId:'a',toTerritoryId:'b'};assert.throws(()=>action(f,f.a,'transfer-command',{targetId:'b'}),/行动/);});
test('direct command transfer rolls back on persistence failure; rejected request does not transfer',()=>{const f=assembled(),r=action(f,f.b,'request-command');action(f,f.a,'reject-command',{commandRequestId:r.commandRequestId});assert.equal(army(f).commanderId,'a');const save=f.s.repository.save;f.s.repository.save=()=>{throw Error('commit failure');};assert.throws(()=>action(f,f.a,'transfer-command',{targetId:'b'}),/commit failure/);assert.equal(army(f).commanderId,'a');f.s.repository.save=save;});
test('routine loan request performs one durable save and never snapshots unrelated accounts',()=>{const f=assembled();let saves=0;const save=f.s.repository.save;f.s.repository.save=v=>{saves++;return save(v);};const other=f.s.accounts.get('c');other.nonCloneableSentinel=()=>{};action(f,f.a,'request-loan',{ownerId:'b',playerId:f.b.draft.roster[0].id});assert.equal(saves,1);delete other.nonCloneableSentinel;});


test('neutral coalition attack costs no oil at normal speed, including empty stocks and slow choice',()=>{
 const f=assembled();Object.assign(f.s.world.territories.c,{ownerType:'neutral',ownerId:null,capitalOf:null});f.s.world.players.c.territoryIds=[];
 for(const a of [f.a,f.b])f.s.oil.initialize(a).balance=0;
 action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'a'});
 const q=f.s.coalitions.estimate(army(f),{...army(f).proposal,kind:'attack',useOil:true}),slow=f.s.coalitions.estimate(army(f),{...army(f).proposal,kind:'attack',useOil:false});
 assert.equal(q.oilExempt,true);assert.equal(q.oilRequired,0);assert.equal(q.oilSpent,0);assert.equal(q.durationMs,q.normalDurationMs);assert.equal(q.oilMultiplier,1);assert.equal(slow.quoteId,q.quoteId);
 const before=[f.a,f.b].map(a=>f.s.oil.initialize(a).balance);action(f,f.a,'attack',{quoteId:q.quoteId,useOil:false});
 assert.deepEqual([f.a,f.b].map(a=>f.s.oil.initialize(a).balance),before);assert.equal(army(f).ledger.at(-1).oilExempt,true);assert.equal(army(f).movement.arrivesAt-f.now,q.durationMs);
 f.tick(q.durationMs);f.s.advanceActiveChallenges(f.now,{maximumMatches:10,maximumChainsPerMatch:1});assert.equal(f.s.world.activeChallenges.c.coalitionId,army(f).id);
});
test('target notice only goes to beneficiary, persists and disappears on confirmation or replacement',()=>{
 const f=assembled();setTestWar(f.s.world,'a','c');setTestWar(f.s.world,'b','c');action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'b'});
 assert.equal(f.s.state(f.a).coalitionTargetRequests.length,0);assert.equal(f.s.state(f.s.accounts.get('c')).coalitionTargetRequests.length,0);
 const n=f.s.state(f.b).coalitionTargetRequests[0];assert.equal(n.territoryId,'c');assert.equal(n.armyId,army(f).id);f.reload();assert.equal(f.s.state(f.b).coalitionTargetRequests[0].id,n.id);
 assert.throws(()=>action(f,f.a,'confirm-target',{proposalId:n.id}),/受益人/);action(f,f.b,'confirm-target',{proposalId:n.id});assert.equal(f.s.state(f.b).coalitionTargetRequests.length,0);
 action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'b'});const old=army(f).proposal.id;action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'a'});assert.equal(f.s.coalitions.targetNotices(f.b).length,0);assert.throws(()=>action(f,f.b,'confirm-target',{proposalId:old}),/受益人/);
});
test('defence preference persists, rejects invalid values and selects own garrison',()=>{
 const f=assembled();assert.ok(f.s.coalitions.defenderFor(f.a));action(f,f.a,'defence-preference',{preference:'garrison'});assert.equal(f.s.coalitions.defenderFor(f.a),null);assert.ok(f.s.coalitions.defenderFor(f.b));
 f.reload();assert.equal(f.s.coalitions.view(f.a).defencePreference,'garrison');assert.throws(()=>action(f,f.a,'defence-preference',{preference:'other'}),/无效/);assert.equal(f.a.defencePreference,'garrison');
 setTestWar(f.s.world,'c','a');const ch=f.s.challenges.begin(f.s.accounts.get('c'),'a').challenge;assert.equal(ch.defenderCoalitionId,undefined);assert.equal(ch.live.defender.id,'a');
 action(f,f.a,'defence-preference',{preference:'coalition'});assert.equal(ch.defenderCoalitionId,undefined);
});
test('nonbeneficiary coalition contributor receives an unmasked match outside fog and its report',async()=>{
 const {coalitionAttackEntries}=await import('../client/challenge/defence-notifications.js');const f=assembled();setTestWar(f.s.world,'a','c');setTestWar(f.s.world,'b','c');action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'b'});action(f,f.b,'confirm-target',{proposalId:army(f).proposal.id});const q=f.s.coalitions.estimate(army(f),{...army(f).proposal,kind:'attack'});action(f,f.a,'attack',{quoteId:q.quoteId});f.tick(q.durationMs);f.s.advanceActiveChallenges(f.now,{maximumMatches:10,maximumChainsPerMatch:1});
 const ch=f.s.world.activeChallenges.c,world=f.s.publicWorld(f.a,{enabled:true,visibleTerritoryIds:[],metPlayerIds:[]});assert.equal(world.activeChallenges.c.id,ch.id);assert.deepEqual(world.activeChallenges.c.coalitionContributors,['a','b']);assert.equal(coalitionAttackEntries({playerId:'a',world}).active[0].id,ch.id);
 ch.battle={challengeId:ch.id,territoryId:'c',outcome:'loss',broadcasts:[]};f.s.challenges.settleChallenge(ch);assert.equal(coalitionAttackEntries(f.s.state(f.a)).history[0].challengeId,ch.id);assert.equal(f.s.challenges.status(f.a,ch.id).completed,true);
});
