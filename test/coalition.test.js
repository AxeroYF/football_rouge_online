import {visibleMapUnits} from '../server/application/map-unit-visibility.mjs';
import {operatingCosts} from '../shared/config/operating-costs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {coalitionFixture} from './coalition-fixture.mjs';
import {coalitionOilShares,coalitionPlayerId} from '../shared/config/coalition.mjs';
import {representativePlayers} from '../shared/config/representative-players.mjs';
import {buildAccountMatchSeat} from '../shared/football/account-match-seat.mjs';
import {setTestWar} from './diplomacy-fixture.mjs';
import {setAbsence,absenceMatches} from '../shared/football/match-availability.mjs';
const M=60000;
function action(f,a,action,extra={}){const army=f.s.coalitions.find(a);return f.s.coalitions.mutate(a,{action,requestId:crypto.randomUUID(),armyId:army?.id,revision:army?.revision,...extra});}
function assembled(){const f=coalitionFixture();action(f,f.a,'create',{name:'测试联军'});for(const p of f.a.draft.roster.slice(0,6))action(f,f.a,'lend',{playerId:p.id});for(const p of f.b.draft.roster.slice(6,11))action(f,f.b,'lend',{playerId:p.id});action(f,f.a,'auto-lineup');f.s.save();return f;}
const army=f=>f.s.coalitions.find(f.a);
function move(f,id){const a=army(f),quote=f.s.coalitions.estimate(a,{territoryId:id});return action(f,f.a,'move',{territoryId:id,quoteId:quote.quoteId});}
function attack(f){setTestWar(f.s.world,'a','c');setTestWar(f.s.world,'b','c');action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'b'});action(f,f.b,'confirm-target',{proposalId:army(f).proposal.id});const q=f.s.coalitions.estimate(army(f),{...army(f).proposal,kind:'attack'});action(f,f.a,'attack',{quoteId:q.quoteId});f.tick(q.durationMs);f.s.advanceActiveChallenges(f.now,{maximumMatches:10,maximumChainsPerMatch:1000});return Object.values(f.s.world.activeChallenges).find(c=>c.coalitionId);}
test('integer oil splitting rotates remainder fairly',()=>{let cursor=0,totals={a:0,b:0,c:0};for(let i=0;i<30;i++){const shares=coalitionOilShares(['c','a','b'],2,cursor);assert.equal(shares.reduce((n,s)=>n+s.amount,0),2);shares.forEach(s=>totals[s.ownerId]+=s.amount);cursor+=2;}assert.deepEqual(totals,{a:20,b:20,c:20});});
test('assembly locks real cards, requires two owners, preserves personal garrison and persists',()=>{const f=assembled(),a=army(f),p=f.a.draft.roster[0];assert.equal(a.loans.length,11);assert.equal(f.s.coalitions.readiness(a),null);assert.equal(f.s.coalitions.seat(a).players.length,11);assert.equal(representativePlayers(f.a.draft.roster).some(x=>x.id===p.id),true);assert.match(f.s.cardManagement.blocked(f.a,p),/联军/);assert.match(f.s.enhancement.blocked(f.a,f.s.world,p),/联军/);assert.throws(()=>f.s.assignPlayerSquad(f.a,p.id,'garrison'),/联军/);assert.equal(buildAccountMatchSeat(f.a,'garrison').players.length,11);f.reload();assert.equal(army(f).loans.length,11);assert.equal(f.a.draft.roster[0].coalitionLoan.armyId,a.id);});
test('movement splits oil once across every ally and leaves personal expedition in place',()=>{const f=assembled(),piece=structuredClone(f.a.expeditionPiece),oa=f.a.oil.balance,ob=f.b.oil.balance;const q=f.s.coalitions.estimate(army(f),{territoryId:'b'}),body={action:'move',armyId:army(f).id,revision:army(f).revision,territoryId:'b',quoteId:q.quoteId,requestId:crypto.randomUUID()};f.s.coalitions.mutate(f.a,body);f.s.coalitions.mutate(f.a,body);assert.equal(f.a.oil.balance,oa-1);assert.equal(f.b.oil.balance,ob-1);assert.deepEqual(f.a.expeditionPiece,piece);f.tick(q.durationMs);f.reload();assert.equal(army(f).territoryId,'b');assert.equal(army(f).movement,null);});
test('shortage is shared and visible, spends nothing and slows fourfold',()=>{const f=assembled();f.b.oil.balance=0;f.s.save();const q=f.s.coalitions.estimate(army(f),{territoryId:'b'});assert.equal(q.oilShortage,true);const balance=f.a.oil.balance;action(f,f.a,'move',{territoryId:'b',quoteId:q.quoteId});assert.equal(f.a.oil.balance,balance);assert.equal(army(f).movement.durationMs,4*M);});
test('stale quote, unauthorized commander and persistence failure never partially charge',()=>{const f=assembled(),q=f.s.coalitions.estimate(army(f),{territoryId:'b'});assert.throws(()=>action(f,f.b,'move',{territoryId:'b',quoteId:q.quoteId}),/指挥官/);f.b.oil.balance--;assert.throws(()=>action(f,f.a,'move',{territoryId:'b',quoteId:q.quoteId}),/预览/);const before=JSON.stringify(f.a.oil);f.fail(true);assert.throws(()=>move(f,'b'),/disk failure/);f.fail(false);assert.equal(JSON.stringify(f.a.oil),before);assert.equal(army(f).movement,null);});
test('target needs beneficiary consent, deployment precedes match and uses separate team identity',()=>{const f=assembled();setTestWar(f.s.world,'a','c');setTestWar(f.s.world,'b','c');action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'b'});assert.throws(()=>action(f,f.a,'attack',{quoteId:'bad'}),/受益人/);assert.throws(()=>action(f,f.a,'confirm-target',{proposalId:army(f).proposal.id}),/受益人/);const ch=attack(f);assert.ok(ch);assert.equal(ch.attackerId,'b');assert.equal(ch.live.attacker.id,army(f).id);assert.equal(ch.coalitionContributors.length,2);assert.ok(ch.live.attacker.players.some(p=>p.id===coalitionPlayerId('a',f.a.draft.roster[0].id)));assert.equal(f.b.expeditionPiece.territoryId,'b');});
test('leg fitness and absences go to their original owners, not the beneficiary squad',()=>{const f=assembled(),ch=attack(f),leg=ch.live.firstLeg,team=leg.match.teams.find(t=>t.id===army(f).id),p=team.players[0],loan=army(f).loans.find(l=>coalitionPlayerId(l.ownerId,l.playerId)===p.id),real=f.s.accounts.get(loan.ownerId).draft.roster.find(p=>p.id===loan.playerId),unrelated=f.b.draft.roster[0];p.state.fitness=41;leg.match.finished=true;leg.match.postMatchConsequences={injuries:[{teamIndex:leg.match.teams.indexOf(team),playerId:p.id,matches:2,reason:'injury'}]};const old=unrelated.state.fitness;f.s.coalitions.applyLeg(ch,leg,f.now);assert.equal(real.state.fitness,41);assert.equal(absenceMatches(real,'injury'),2);assert.equal(unrelated.state.fitness,old);f.s.coalitions.applyLeg(ch,leg,f.now);assert.equal(absenceMatches(real,'injury'),2);});
test('two-leg settlement captures for the agreed beneficiary, shares report and never moves personal army',()=>{const f=assembled(),ch=attack(f),piece=structuredClone(f.b.expeditionPiece);ch.battle={outcome:'win',score:[2,0],aggregateScore:[2,0],teams:[],events:[]};const battle=f.s.challenges.settleChallenge(ch);assert.equal(battle.captured,true);assert.equal(f.s.world.territories.c.ownerId,'b');assert.equal(army(f).territoryId,'c');assert.deepEqual(f.b.expeditionPiece,piece);assert.equal(f.a.battleHistory.at(-1).coalitionId,army(f).id);assert.equal(f.b.battleHistory.at(-1).coalitionId,army(f).id);assert.ok(battle.warEnded);});
test('withdrawal during action waits; commander transfer needs a majority and survives restart',()=>{const f=assembled(),p=f.b.draft.roster[6];move(f,'b');action(f,f.b,'withdraw',{playerId:p.id});assert.ok(p.coalitionLoan);f.tick(M);f.s.save();assert.equal(p.coalitionLoan,undefined);assert.throws(()=>f.s.coalitions.assertLeave(f.a),/移交/);action(f,f.a,'vote',{kind:'commander',targetId:'b'});assert.equal(army(f).commanderId,'a');action(f,f.b,'vote',{kind:'commander',targetId:'b'});assert.equal(army(f).commanderId,'b');f.reload();assert.equal(army(f).commanderId,'b');});

test('loans retain owner wages, invalid votes cannot transfer control',()=>{const f=coalitionFixture(),wage=operatingCosts(f.a,f.s.world).wages;action(f,f.a,'create');action(f,f.a,'lend',{playerId:f.a.draft.roster[0].id});assert.equal(operatingCosts(f.a,f.s.world).wages,wage);assert.throws(()=>action(f,f.a,'vote',{kind:'invalid',targetId:'c'}),/表决类型/);assert.equal(army(f).commanderId,'a');});
test('real two-leg simulation survives restart and returns deferred loans only after completion',()=>{const f=assembled(),ch=attack(f),id=ch.id,pid=f.a.draft.roster[1].id;action(f,f.a,'withdraw',{playerId:pid});f.tick(3*M);f.s.advanceActiveChallenges(f.now,{maximumMatches:10,maximumChainsPerMatch:1000});assert.equal(Object.values(f.s.world.activeChallenges)[0].phase,'intermission');assert.ok(f.a.draft.roster.find(p=>p.id===pid).coalitionLoan);f.reload();f.tick(3*M);f.s.advanceActiveChallenges(f.now,{maximumMatches:10,maximumChainsPerMatch:1000});const second=Object.values(f.s.world.activeChallenges)[0];assert.equal(second.phase,'second-leg');assert.ok(second.live.secondLeg.match.teams.some(t=>t.id===army(f).id));f.tick(4*M);for(let i=0;i<4;i++)f.s.advanceActiveChallenges(f.now,{maximumMatches:10,maximumChainsPerMatch:1000});assert.equal(Object.keys(f.s.world.activeChallenges).length,0);assert.equal(f.a.draft.roster.find(p=>p.id===pid).coalitionLoan,undefined);assert.equal(f.a.battleHistory.at(-1).challengeId,id);assert.ok(f.b.battleHistory.at(-1).broadcasts.length);});
test('non-contributing allies also share fuel; successful shares differ by at most one',()=>{const f=assembled();setTestWar(f.s.world,'a','c');f.s.world.diplomacy.relationships[JSON.stringify(['a','c'])].state='alliance';f.s.save();const q=f.s.coalitions.estimate(army(f),{territoryId:'b'});assert.equal(q.shares.length,3);assert.equal(q.shares.reduce((s,x)=>s+x.amount,0),q.oilRequired);assert.ok(Math.max(...q.shares.map(x=>x.amount))-Math.min(...q.shares.map(x=>x.amount))<=1);});

test('save failure after oil debit rolls all member balances and orders back',()=>{const f=assembled(),oldSave=f.s.repository.save.bind(f.s.repository);let calls=0;f.s.repository.save=v=>{if(++calls===2)throw Error('commit failed');return oldSave(v);};const balances=[f.a.oil.balance,f.b.oil.balance],q=f.s.coalitions.estimate(army(f),{territoryId:'b'});assert.throws(()=>action(f,f.a,'move',{territoryId:'b',quoteId:q.quoteId}),/commit failed/);assert.deepEqual([f.a.oil.balance,f.b.oil.balance],balances);assert.equal(army(f).movement,null);assert.equal(army(f).ledger,undefined);f.s.repository.save=oldSave;move(f,'b');assert.ok(army(f).movement);});
test('outsiders cannot inspect or modify coalition; fog hides enemy coalition marker',()=>{const f=assembled(),outsider=f.s.accounts.get('c'),args={world:f.s.world,accounts:f.s.accounts,territoryIndex:f.s.territoryIndex,now:f.now};assert.throws(()=>f.s.coalitions.require(outsider,army(f).id),/同盟/);const hidden=visibleMapUnits({...args,account:outsider,fog:{enabled:true,visibleTerritoryIds:['c']}});assert.ok(!hidden.some(u=>u.kind==='coalition'));const seen=visibleMapUnits({...args,account:outsider,fog:{enabled:true,visibleTerritoryIds:['a']}});assert.ok(seen.some(u=>u.kind==='coalition'));const own=visibleMapUnits({...args,account:f.b,fog:{enabled:true,visibleTerritoryIds:[]}});assert.ok(own.some(u=>u.kind==='coalition'&&u.allied));assert.ok(!JSON.stringify(seen).includes('loans'));});
test('disband requires both contributors, releases real cards and permits rebuilding',()=>{const f=assembled(),id=army(f).id;action(f,f.a,'vote',{kind:'disband'});assert.equal(army(f).id,id);action(f,f.b,'vote',{kind:'disband'});assert.equal(army(f),null);assert.ok(![...f.a.draft.roster,...f.b.draft.roster].some(p=>p.coalitionLoan));action(f,f.a,'create');assert.notEqual(army(f).id,id);});
test('departed contributor is returned when idle and two coalitions cannot merge',()=>{const f=assembled();f.s.diplomacy.leaveAlliance(f.b);f.s.save();assert.ok(f.b.draft.roster.every(p=>!p.coalitionLoan));assert.equal(army(f).loans.length,6);f.s.world.coalitions.second={id:'second',commanderId:'c',loans:[],revision:1};assert.throws(()=>f.s.coalitions.assertAllianceMerge(['a','c']),/解散/);});
test('naval preview belongs to coalition position, not the personal expedition',()=>{const f=assembled();army(f).territoryId='b';const result={sourceTerritoryId:'b',sourcePoint:[3,48],routes:[{targetTerritoryId:'c',targetPoint:[4,48]}]};f.s.fog.survey(f.a,f.s.world,result,{coalitionId:army(f).id});assert.equal(f.s.fog.preview(f.a,f.s.world).coalitionId,army(f).id);army(f).movement={fromTerritoryId:'b',toTerritoryId:'c',startedAt:f.now,arrivesAt:f.now+M};assert.equal(f.s.fog.preview(f.a,f.s.world),null);});

test('one ally may supply all eleven starters and another only the bench; no muster delay',()=>{const f=coalitionFixture();action(f,f.a,'create');for(const p of f.a.draft.roster.slice(0,11))action(f,f.a,'lend',{playerId:p.id});assert.throws(()=>action(f,f.a,'auto-lineup'),/共同出人/);const bench=f.b.draft.roster[1];bench.overall=1;bench.effectiveOverall=1;action(f,f.b,'lend',{playerId:bench.id});action(f,f.a,'auto-lineup');const a=army(f),roster=f.s.coalitions.roster(a),starters=a.tactics.starters.map(id=>roster.find(p=>p.id===id));assert.equal(starters.length,11);assert.ok(starters.every(p=>p.coalitionOwnerId==='a'));assert.equal(f.s.coalitions.readiness(a),null);a.readyAt=f.now+600000;f.s.save();assert.equal(a.readyAt,undefined);assert.equal(f.s.coalitions.readiness(a),null);move(f,'b');assert.ok(army(f).movement);});

test('loans preserve all saved squad positions while personal matches rotate the borrowed player',()=>{
 const f=coalitionFixture(),p=f.a.draft.roster[1],before=structuredClone(f.a.tactics),assignments=structuredClone(f.a.playerSquads);
 action(f,f.a,'create');action(f,f.a,'lend',{playerId:p.id});f.s.state(f.a);
 assert.deepEqual(f.a.tactics,before);assert.deepEqual(f.a.playerSquads,assignments);
 const reserve=structuredClone(f.a.draft.roster[2]);reserve.id='reserve';reserve.playerId='reserve';reserve.cardDefinitionId='reserve';reserve.role='LB';f.a.draft.roster.push(reserve);f.a.playerSquads.assignments[reserve.id]='expedition';
 const seat=buildAccountMatchSeat(f.a,'expedition',f.now,{fitness:true,allowShortHanded:true});
 assert.ok(!seat.players.some(x=>x.id===p.id));assert.ok(seat.rotations.some(r=>r.outId===p.id&&r.reason==='联军借调'));
 action(f,f.a,'withdraw',{playerId:p.id});assert.deepEqual(f.a.tactics,before);assert.equal(f.a.playerSquads.assignments[p.id],assignments.assignments[p.id]);
});


test('voluntary coalition slow march charges no ally and cannot reuse a fast quote',()=>{
 const f=assembled(),a=army(f),balances=[f.a.oil.balance,f.b.oil.balance],cursor=a.oilCursor;
 const fast=f.s.coalitions.estimate(a,{territoryId:'b'}),slow=f.s.coalitions.estimate(a,{territoryId:'b',useOil:false});
 assert.equal(slow.durationMs,fast.durationMs*4);assert.equal(slow.oilSpent,0);assert.equal(slow.oilShortage,false);
 assert.throws(()=>action(f,f.a,'move',{territoryId:'b',useOil:false,quoteId:fast.quoteId}),/预览/);
 assert.throws(()=>action(f,f.a,'move',{territoryId:'b',useOil:true,quoteId:slow.quoteId}),/预览/);
 action(f,f.a,'move',{territoryId:'b',useOil:false,quoteId:slow.quoteId});
 assert.deepEqual([f.a.oil.balance,f.b.oil.balance],balances);assert.equal(army(f).oilCursor,cursor);
 assert.equal(army(f).movement.durationMs,slow.durationMs);assert.equal(army(f).ledger.at(-1).useOil,false);
 assert.ok(army(f).ledger.at(-1).shares.every(s=>s.amount===0));
 f.reload();assert.equal(army(f).movement.useOil,false);
 f.tick(slow.durationMs);f.s.save();assert.equal(army(f).territoryId,'b');
});
test('coalition attack deployment respects the commander choice without charging allies',()=>{
 const f=assembled();setTestWar(f.s.world,'a','c');setTestWar(f.s.world,'b','c');
 action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'b'});action(f,f.b,'confirm-target',{proposalId:army(f).proposal.id});
 const balances=[f.a.oil.balance,f.b.oil.balance],q=f.s.coalitions.estimate(army(f),{...army(f).proposal,kind:'attack',useOil:false});
 action(f,f.a,'attack',{quoteId:q.quoteId,useOil:false});
 assert.equal(army(f).movement.durationMs,q.normalDurationMs*4);assert.equal(army(f).order.territoryId,'c');
 assert.deepEqual([f.a.oil.balance,f.b.oil.balance],balances);
});


test('curfew blocks new coalition attacks but permits moves; overnight deployment waits until 08:00',()=>{
 const f=assembled(),midnight=16*3600000,morning=24*3600000;
 f.tick(midnight-30000-f.now);setTestWar(f.s.world,'a','c');setTestWar(f.s.world,'b','c');
 action(f,f.a,'propose-target',{territoryId:'c',beneficiaryId:'b'});action(f,f.b,'confirm-target',{proposalId:army(f).proposal.id});
 const q=f.s.coalitions.estimate(army(f),{...army(f).proposal,kind:'attack'});action(f,f.a,'attack',{quoteId:q.quoteId});
 const balances=[f.a.oil.balance,f.b.oil.balance];f.tick(q.durationMs);f.s.save();f.s.coalitions.advance();
 assert.ok(army(f).order.arrived);assert.equal(Object.keys(f.s.world.activeChallenges).length,0);
 assert.equal(f.s.coalitions.view(f.a).army.waitingForCurfewUntil,morning);
 f.reload();assert.ok(army(f).order.arrived);f.s.coalitions.advance();assert.equal(Object.keys(f.s.world.activeChallenges).length,0);
 f.tick(morning-f.now);f.s.coalitions.advance();assert.ok(Object.values(f.s.world.activeChallenges).some(ch=>ch.coalitionId===army(f).id));
 assert.equal(army(f).order,null);assert.deepEqual([f.a.oil.balance,f.b.oil.balance],balances);
 const g=assembled();g.tick(midnight-g.now);setTestWar(g.s.world,'a','c');setTestWar(g.s.world,'b','c');
 assert.throws(()=>action(g,g.a,'propose-target',{territoryId:'c',beneficiaryId:'b'}),/宵禁/);
 assert.throws(()=>g.s.coalitions.estimate(army(g),{territoryId:'c',beneficiaryId:'b',kind:'attack'}),/宵禁/);
 move(g,'b');assert.ok(army(g).movement);
});
