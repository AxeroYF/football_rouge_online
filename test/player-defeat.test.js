import test from 'node:test';
import assert from 'node:assert/strict';
import {coalitionFixture} from './coalition-fixture.mjs';
import {setTestWar} from './diplomacy-fixture.mjs';
import {transferCapturedTerritory} from '../territory-model.js';
import {headquartersLevel} from '../shared/config/facility-levels.mjs';
function fixture(remaining=false){
 const f=coalitionFixture();if(remaining)transferCapturedTerritory(f.s.world,'b','c');setTestWar(f.s.world,'a','b');
 f.s.world.territories.b.buildings=[{id:'hq-b',type:'club-headquarters',level:4,status:'active'}];f.s.save();
 const challenge={id:'defeat-test',attackerId:'a',defenderId:'b',territoryId:'b',previousOwner:{type:'player',id:'b'},battle:{outcome:'win'},fromTerritoryIds:['a']};f.s.world.activeChallenges.b=challenge;
 return {f,settle:()=>f.s.challenges.settleChallenge(challenge)};
}
test('captured headquarters relocates with level; restart retains one headquarters',()=>{
 const {f,settle}=fixture(true),building=structuredClone(f.s.world.territories.b.buildings[0]);
 const roster=JSON.stringify(f.b.draft.roster),gold=f.b.gold;
 assert.equal(settle().playerDefeat.kind,'relocated');
 assert.equal(f.b.homeTerritoryId,'c');assert.equal(f.s.world.players.b.capitalTerritoryId,'c');assert.equal(f.s.world.territories.c.capitalOf,'b');
 assert.deepEqual(f.s.world.territories.c.buildings.find(b=>b.type==='club-headquarters'),building);
 assert.equal(f.s.world.territories.b.buildings.some(b=>b.type==='club-headquarters'),false);assert.equal(headquartersLevel(f.b,f.s.world),4);
 assert.equal(JSON.stringify(f.b.draft.roster),roster);assert.equal(f.b.gold,gold);
 assert.equal(f.s.state(f.b).expeditionPiece.territoryId,'c');f.reload();assert.equal(f.b.homeTerritoryId,'c');assert.equal(headquartersLevel(f.b,f.s.world),4);
});
test('last territory loss removes active player, resets progress, invalidates session and permits login/redraft',()=>{
 const {f,settle}=fixture();const credentials=f.s.register('重建账号','secret123'),registered=f.s.authenticate(credentials.token);
 f.b.nickname=registered.nickname;f.b.passwordHash=registered.passwordHash;f.b.passwordSalt=registered.passwordSalt;f.s.accounts.delete(registered.id);
 f.b.inventory={packs:{rare:10}};const token=f.b.token;
 assert.equal(settle().playerDefeat.kind,'eliminated');assert.equal(f.s.world.players.b,undefined);assert.equal(f.b.setupComplete,false);assert.equal(f.b.draft,null);assert.equal(f.b.homeTerritoryId,null);
 assert.throws(()=>f.s.authenticate(token),/登录已失效/);assert.ok(!f.s.diplomacy.summary(f.a).players.some(p=>p.id==='b'));assert.doesNotThrow(()=>f.s.state(f.b));
 f.reload();const session=f.s.login('重建账号','secret123');assert.equal(session.state.setupComplete,false);assert.equal(f.b.draft,null);assert.ok(session.token);assert.notEqual(session.token,token);
 f.s.drafting.start(f.b,'重新开始');assert.ok(f.b.draft);assert.equal(f.b.setupComplete,false);assert.equal(f.b.draft.roster.length,0);
 assert.equal(f.b.draft.totalPicks,22);
 for(let i=0;i<22;i++){const pool=i<3?'GK':i<10?'DEF':i<16?'MID':'ATT';f.s.drafting.open(f.b,pool,i+1);f.s.drafting.choose(f.b,f.b.draft.offer[0].id,f.b.draft.offerId);}
 assert.equal(f.b.setupComplete,true);assert.equal(f.b.draft.roster.length,22);assert.equal(f.s.state(f.b).homeSelectionRequired,true);
 Object.assign(f.s.world.territories.c,{ownerType:'neutral',ownerId:null,capitalOf:null,buildings:[]});f.s.world.players.c.territoryIds=[];
 f.s.territoryIndex.territories.find(t=>t.territoryId==='c').playable=true;f.s.chooseHome(f.b,'c');assert.equal(f.b.homeTerritoryId,'c');assert.equal(f.s.world.players.b.capitalTerritoryId,'c');

});
test('elimination clears friendly matches, loans, commands and pending liberations',()=>{
 const {f,settle}=fixture();const card=f.a.draft.roster[0];card.coalitionLoan={armyId:'army'};
 f.s.world.coalitions={army:{id:'army',commanderId:'b',loans:[{ownerId:'a',playerId:card.id}],revision:1,loanRequests:[],commandRequests:[]}};
 f.s.world.diplomacy.matches={old:{id:'old',from:'b',to:'c',battle:{}}};
 f.s.world.territories.c.originalOwnerId='b';f.s.world.territories.c.pendingLiberation={originalOwnerId:'b'};
 settle();assert.equal(card.coalitionLoan,undefined);assert.ok(f.s.world.coalitions.army.disbandedAt);assert.equal(f.s.world.diplomacy.matches.old,undefined);
 assert.equal(f.s.world.territories.c.originalOwnerId,undefined);assert.equal(f.s.world.territories.c.pendingLiberation,undefined);
});
for(const remaining of [false,true])test('failed defeat save restores accounts and territories: '+remaining,()=>{
 const {f,settle}=fixture(remaining),before=JSON.stringify({world:f.s.world,accounts:[...f.s.accounts]});f.fail(true);
 assert.throws(settle,/disk failure/);assert.equal(JSON.stringify({world:f.s.world,accounts:[...f.s.accounts]}),before);
});
