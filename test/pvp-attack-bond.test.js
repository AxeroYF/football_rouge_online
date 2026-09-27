import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {coalitionFixture} from './coalition-fixture.mjs';
import {setTestWar} from './diplomacy-fixture.mjs';
import {conquestDay,conquestState,conquestAttackBlock} from '../shared/config/conquest.mjs';
import {bondQuote,holdBond,resolveBond,prepareOrphanBondRefunds} from '../server/application/pvp-attack-bond.mjs';
function fixture(){const f=coalitionFixture();for(const a of f.s.accounts.values())a.gold=100000;setTestWar(f.s.world,'a','c');return f;}
for(const outcome of ['win','loss'])test('personal PvP '+outcome+' settles exactly 30000 once and records successful quota only',()=>{
 const f=fixture(),defender=f.s.accounts.get('c');const {challenge}=f.s.challenges.begin(f.a,'c');assert.equal(f.a.gold,70000);assert.ok(challenge.attackBondId);
 challenge.battle={outcome};const result=f.s.challenges.settleChallenge(challenge);
 assert.equal(f.a.gold,outcome==='win'?100000:70000);
 if(outcome==='loss'){assert.equal(defender.gold,130000);assert.match(defender.pvpNotices.at(-1).text,/30000/);assert.equal(f.a.conquest.cooldownUntil,f.now+1200000);}
 assert.equal(f.s.challenges.conquestState(f.a).used,outcome==='win'?1:0);assert.equal(f.s.challenges.conquestState(f.a).playerUsed,outcome==='win'?1:0);
 assert.equal(result.attackBond.status,outcome==='win'?'refunded':'forfeited');assert.equal(f.s.challenges.settleChallenge(challenge),null);assert.equal(f.a.gold,outcome==='win'?100000:70000);
});
test('quota is 8 total and 4 successful player captures, both reset at Beijing 08:00',()=>{
 const now=Date.parse('2026-09-20T04:00:00Z'),a={conquest:{schemaVersion:2,resetHour:8,day:conquestDay(now),used:4,playerUsed:4}};
 assert.equal(conquestState(a,now,1).limit,9);assert.equal(conquestAttackBlock(conquestState(a,now),'player').code,'player-conquest-limit');assert.equal(conquestAttackBlock(conquestState(a,now),'neutral'),null);
 a.conquest.used=8;assert.ok(conquestAttackBlock(conquestState(a,now),'neutral'));assert.equal(conquestState(a,Date.parse('2026-09-21T00:00:00Z')).playerUsed,0);
});
test('funds and current owner confirmation are enforced before issuing a paid attack',()=>{
 const f=fixture();assert.throws(()=>f.s.challenges.begin(f.a,'c',{requirePvpConfirmation:true}),/确认/);assert.equal(Object.keys(f.s.world.activeChallenges).length,0);
 assert.throws(()=>f.s.challenges.begin(f.a,'c',{requirePvpConfirmation:true,pvpConfirmed:true,expectedOwnerId:'b'}),/确认/);
 f.a.gold=29999;assert.throws(()=>f.s.challenges.begin(f.a,'c'),/金币不足/);assert.equal(f.a.gold,29999);assert.equal(Object.keys(f.s.world.activeChallenges).length,0);
});
test('all allied accounts split 30000 including non-contributors; shortages change nothing; cancellation refunds once',()=>{
 const f=fixture(),q=bondQuote(f.s.accounts,['a','b','c'],'t','d');f.b.gold=1;const before=f.a.gold;
 assert.throws(()=>holdBond(f.s.world,f.s.accounts,q,f.now),/金币不足/);assert.equal(f.a.gold,before);f.b.gold=100000;
 const id=holdBond(f.s.world,f.s.accounts,q,f.now);assert.equal(f.a.gold,90000);assert.equal(f.b.gold,90000);assert.equal(f.s.accounts.get('c').gold,90000);
 const prepared=prepareOrphanBondRefunds(f.s.world,f.s.accounts,f.now);assert.equal(f.a.gold,100000);prepared.rollback();assert.equal(f.a.gold,90000);assert.equal(f.s.world.pvpBonds[id].status,'held');
 prepareOrphanBondRefunds(f.s.world,f.s.accounts,f.now);prepareOrphanBondRefunds(f.s.world,f.s.accounts,f.now);assert.equal(f.a.gold,100000);
});
test('failed battle save rolls back transfer and bond resolution; retry after reload pays once',()=>{
 const f=fixture(),{challenge}=f.s.challenges.begin(f.a,'c');challenge.battle={outcome:'loss'};const before=JSON.stringify([...f.s.accounts]);f.fail(true);
 assert.throws(()=>f.s.challenges.settleChallenge(challenge),/disk failure/);assert.equal(JSON.stringify([...f.s.accounts]),before);assert.equal(f.s.world.pvpBonds[challenge.attackBondId].status,'held');
 f.fail(false);f.s.save();f.reload();const ch=f.s.world.activeChallenges.c;ch.battle={outcome:'loss'};f.s.challenges.settleChallenge(ch);assert.equal(f.a.gold,70000);assert.equal(f.s.accounts.get('c').gold,130000);
});

function coalition(f){
 const action=(who,action,extra={})=>{const army=f.s.coalitions.find(who);return f.s.coalitions.mutate(who,{action,requestId:crypto.randomUUID(),armyId:army?.id,revision:army?.revision,...extra});};
 action(f.a,'create');for(const p of f.a.draft.roster.slice(0,6))action(f.a,'lend',{playerId:p.id});for(const p of f.b.draft.roster.slice(6,11))action(f.b,'lend',{playerId:p.id});action(f.a,'auto-lineup');
 setTestWar(f.s.world,'b','c');action(f.a,'propose-target',{territoryId:'c',beneficiaryId:'b'});const army=f.s.coalitions.find(f.a);action(f.b,'confirm-target',{proposalId:army.proposal.id});const quote=f.s.coalitions.estimate(army,{...army.proposal,kind:'attack'});
 return {action,army,quote};
}
for(const outcome of ['cancel','win','loss'])test('real coalition departure charges shares, '+outcome+' settles the same deposit once',()=>{
 const f=fixture(),{action,army,quote}=coalition(f);assert.equal(quote.attackBond.total,30000);assert.deepEqual(quote.attackBond.shares.map(s=>s.amount),[15000,15000]);
 assert.throws(()=>action(f.a,'attack',{quoteId:quote.quoteId}),/确认/);
 // A failed command restores world objects, so read the canonical army again.
 action(f.a,'attack',{quoteId:quote.quoteId,pvpConfirmed:true});assert.equal(f.a.gold,85000);assert.equal(f.b.gold,85000);
 if(outcome==='cancel'){action(f.a,'cancel-move');assert.equal(f.a.gold,100000);assert.equal(f.b.gold,100000);return;}
 f.reload();f.tick(quote.durationMs);f.s.coalitions.advance();const ch=f.s.world.activeChallenges.c;assert.ok(ch,f.s.coalitions.find(f.a).lastActionError);assert.equal(f.a.goldLedger.filter(l=>l.reason==='pvp-attack-bond').length,1);const balances=[f.a.gold,f.b.gold,f.s.accounts.get('c').gold];
 ch.battle={outcome};const result=f.s.challenges.settleChallenge(ch);assert.equal(f.a.gold,balances[0]+(outcome==='win'?15000:0));assert.equal(f.b.gold,balances[1]+(outcome==='win'?15000:0));
 if(outcome==='loss'){assert.equal(f.s.accounts.get('c').gold,balances[2]+30000);assert.equal(f.s.coalitions.find(f.a).cooldownUntil,f.now+1200000);}
 assert.equal(f.s.challenges.conquestState(f.b).playerUsed,outcome==='win'?1:0);assert.equal(f.s.challenges.conquestState(f.a).playerUsed,0);assert.ok(result.attackBond);
});
test('failed initial save cannot lose gold or leave a live paid challenge',()=>{
 const f=fixture(),save=f.s.challenges.save;let calls=0;f.s.challenges.save=()=>{if(++calls===2)throw Error('disk failure');save();};
 assert.throws(()=>f.s.challenges.begin(f.a,'c'),/disk failure/);assert.equal(f.a.gold,100000);assert.equal(f.s.world.activeChallenges.c,undefined);assert.equal(Object.values(f.s.world.pvpBonds??{}).filter(b=>b.status==='held').length,0);
});

test('target changes before coalition arrival refund the deposit without starting a battle',()=>{
 const f=fixture(),{action,quote}=coalition(f);action(f.a,'attack',{quoteId:quote.quoteId,pvpConfirmed:true});
 Object.assign(f.s.world.territories.c,{ownerType:'neutral',ownerId:null});f.tick(quote.durationMs);f.s.coalitions.advance();
 assert.equal(f.s.world.activeChallenges.c,undefined);assert.equal(Object.values(f.s.world.pvpBonds)[0].status,'refunded');
 for(const a of [f.a,f.b])assert.equal(a.goldLedger.filter(l=>l.reason==='pvp-bond-refund').reduce((n,l)=>n+l.delta,0),15000);
});
test('concurrent winning battle cannot exceed player quota and refunds when capture is blocked',()=>{
 const f=fixture(),{challenge}=f.s.challenges.begin(f.a,'c');f.a.conquest={schemaVersion:2,resetHour:8,day:conquestDay(f.now),used:4,playerUsed:4};challenge.battle={outcome:'win'};
 const result=f.s.challenges.settleChallenge(challenge);assert.equal(result.captured,false);assert.equal(f.a.gold,100000);assert.equal(f.a.conquest.playerUsed,4);assert.equal(f.s.world.territories.c.ownerId,'c');
});

test('legacy quota migration includes own player captures but not allied contributor reports',()=>{
 const at=Date.parse('2026-09-20T04:00:00Z'),a={id:'a',conquest:{day:conquestDay(at),resetHour:8,used:3},battleHistory:[{captured:true,attackerId:'a',defender:{type:'player'},settledAt:at},{captured:true,attackerId:'b',defender:{type:'player'},settledAt:at}]};
 const q=conquestState(a,at);assert.equal(q.used,4);assert.equal(q.playerUsed,1);a.conquest={...q};assert.equal(conquestState(a,at).used,4);
});

test('fast cancellation restores deposit and payers on disk failure and retries once',()=>{
 const f=fixture(),{action,quote}=coalition(f);action(f.a,'attack',{quoteId:quote.quoteId,pvpConfirmed:true});
 const army=f.s.coalitions.find(f.a),body={action:'cancel-move',requestId:crypto.randomUUID(),armyId:army.id,revision:army.revision};
 const before=JSON.stringify({a:f.a,b:f.b,army,bonds:f.s.world.pvpBonds});
 f.fail(true);assert.throws(()=>f.s.coalitions.mutate(f.a,body),/disk failure/);f.fail(false);
 assert.equal(JSON.stringify({a:f.a,b:f.b,army:f.s.coalitions.find(f.a),bonds:f.s.world.pvpBonds}),before);
 f.s.coalitions.mutate(f.a,body);assert.equal(f.a.gold,100000);assert.equal(f.b.gold,100000);
 f.s.coalitions.mutate(f.a,body);assert.equal(f.a.gold,100000);assert.equal(f.b.gold,100000);
});

import {createRequestId} from '../client/core/request-id.js';
import {pruneReceipts} from '../server/application/receipt-retention.mjs';
test('retired paid coalition request is rejected after persistence and restart without a second charge',()=>{
 const f=fixture(),{quote}=coalition(f),army=f.s.coalitions.find(f.a);
 const body={action:'attack',requestId:createRequestId(crypto.webcrypto,f.now),armyId:army.id,revision:army.revision,quoteId:quote.quoteId,pvpConfirmed:true};
 f.s.coalitions.mutate(f.a,body);const balances=[f.a.gold,f.b.gold];
 f.s.coalitions.mutate(f.a,body);assert.deepEqual([f.a.gold,f.b.gold],balances);
 pruneReceipts(f.a,'coalitionRequests',f.now,{limit:0});f.s.persist();f.reload();
 assert.throws(()=>f.s.coalitions.mutate(f.a,body),/过期/);assert.deepEqual([f.a.gold,f.b.gold],balances);
});
