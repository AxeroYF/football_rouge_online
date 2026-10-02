import test from 'node:test';
import assert from 'node:assert/strict';
import {coalitionFixture} from './coalition-fixture.mjs';
import {mergeRosterDelta} from '../client/core/merge-roster-delta.js';
import {PLAYER_PACK_DEFINITIONS} from '../shared/config/player-packs.mjs';
const type='legendary-player-pack';
const fixture=()=>{const f=coalitionFixture();f.s.playerPacks.addPacks(f.a,type,3);f.s.save();return f;};
test('compact opening keeps roster and world references, skips full state, persists once, and retry does not consume twice',()=>{
 const f=fixture(),state=f.s.state(f.a);let writes=0;const save=f.s.repository.save.bind(f.s.repository);f.s.repository.save=v=>{writes++;save(v);};f.s.state=()=>{throw Error('full state forbidden');};
 const response=f.s.openPlayerPack(f.a,type,{compact:true});assert.equal(writes,1);assert.equal(response.state,undefined);assert.deepEqual(Object.keys(response.statePatch).sort(),['inventory','playerId']);
 const next=mergeRosterDelta(state,response);assert.equal(next.draft,state.draft);assert.equal(next.world,state.world);assert.equal(next.tactics,state.tactics);
 const count=f.a.inventory.packs[type],id=response.statePatch.inventory.pendingOpening.id;const again=f.s.openPlayerPack(f.a,type,{compact:true});assert.equal(again.statePatch.inventory.pendingOpening.id,id);assert.equal(f.a.inventory.packs[type],count);
 f.reload();assert.equal(f.a.inventory.pendingOpening.id,id);assert.equal(f.a.inventory.packs[type],count);
});
test('compact claim persists card, assignment and tactics once, with a single-card delta and correct counts',()=>{
 const f=fixture(),state=f.s.state(f.a),opening=f.s.openPlayerPack(f.a,type,{compact:true}).statePatch.inventory.pendingOpening;
 let writes=0;const save=f.s.repository.save.bind(f.s.repository);f.s.repository.save=v=>{writes++;save(v);};f.s.state=()=>{throw Error('full state forbidden');};
 const response=f.s.choosePlayerPackCard(f.a,opening.id,opening.cards[0].playerId,{compact:true});assert.equal(writes,1);assert.equal(response.state,undefined);assert.equal(response.statePatch.draft,undefined);assert.equal(response.statePatch.world,undefined);assert.equal(response.rosterDelta.cards.length,1);
 const card=response.rosterDelta.cards[0];assert.equal(card.id,response.player.playerId);assert.ok(card.attributes);assert.equal(response.statePatch.playerSquads.assignments[card.id],'garrison');assert.ok(response.statePatch.tactics.squads.garrison.bench.includes(card.id));
 const next=mergeRosterDelta(state,response),repeated=mergeRosterDelta(next,response);assert.equal(next.world,state.world);assert.equal(next.draft.roster.length,state.draft.roster.length+1);assert.equal(repeated.draft.roster.length,next.draft.roster.length);assert.equal(next.draft.pickNumber,next.draft.roster.length);
 assert.equal(mergeRosterDelta({...state,playerId:'other'},response).playerId,'other');
 const expected=structuredClone(f.a.tactics);f.reload();assert.equal(f.a.inventory.pendingOpening,null);assert.ok(f.a.draft.roster.some(p=>p.id===card.id));assert.equal(f.a.playerSquads.assignments[card.id],'garrison');assert.deepEqual(f.a.tactics,expected);
});
test('failed compact open and claim restore inventory, roster, assignment, tactics and wonder rewards',()=>{
 const f=fixture();let before=structuredClone(f.a);f.fail(true);assert.throws(()=>f.s.openPlayerPack(f.a,type,{compact:true}),/disk/);assert.deepEqual(f.a,before);f.fail(false);
 const opening=f.s.openPlayerPack(f.a,type,{compact:true}).statePatch.inventory.pendingOpening;
 const chosen=f.s.wonders.packChosen.bind(f.s.wonders);f.s.wonders.packChosen=(a,o,p)=>{chosen(a,o,p);a.resources={...a.resources,fans:(a.resources?.fans??0)+100};a.wonderPackFans={total:100,events:[o.id]};};
 before=structuredClone(f.a);f.fail(true);assert.throws(()=>f.s.choosePlayerPackCard(f.a,opening.id,opening.cards[0].playerId,{compact:true}),/disk/);assert.deepEqual(f.a,before);f.fail(false);
 const response=f.s.choosePlayerPackCard(f.a,opening.id,opening.cards[0].playerId,{compact:true});assert.equal(response.statePatch.resources.balances.fans,f.a.resources.fans);assert.equal(f.a.wonderPackFans.total,100);
});
test('compact elite pack claims the enhanced instance; four-choice normal packs remain four choices',()=>{
 const f=fixture(),elite=Object.values(PLAYER_PACK_DEFINITIONS).find(p=>p.clubId);f.s.playerPacks.addPacks(f.a,elite.type,1);
 const opening=f.s.openPlayerPack(f.a,elite.type,{compact:true}).statePatch.inventory.pendingOpening;assert.equal(opening.cards.length,3);
 const response=f.s.choosePlayerPackCard(f.a,opening.id,opening.cards[0].playerId,{compact:true}),card=response.rosterDelta.cards[0];assert.equal(card.upgradeLevel,1);assert.equal(card.id,card.cardInstanceId);assert.notEqual(card.id,opening.cards[0].playerId);assert.equal(card.cardDefinitionId,opening.cards[0].cardDefinitionId);
 const modifiers=f.s.wonders.modifiers.bind(f.s.wonders);f.s.wonders.modifiers=a=>({...modifiers(a),packChoices:4});assert.equal(f.s.openPlayerPack(f.a,type,{compact:true}).statePatch.inventory.pendingOpening.cards.length,4);
});
test('legacy pack calls retain full-state responses and new merge accepts legacy replies',()=>{
 const f=fixture(),opened=f.s.openPlayerPack(f.a,type);assert.ok(opened.state.draft);assert.ok(opened.opening);const claimed=f.s.choosePlayerPackCard(f.a,opened.opening.id,opened.opening.cards[0].playerId);assert.ok(claimed.state.world);assert.equal(mergeRosterDelta({},claimed),claimed.state);
});
