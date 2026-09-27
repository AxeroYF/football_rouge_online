import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveFields,restoreArchivedFields,battleSummary} from '../server/infrastructure/history-archive.mjs';
import {prepareHistoryCompaction} from '../server/application/history-compaction.mjs';
import {maintainCampaignHistory} from '../server/application/history-maintenance.mjs';
import {ScoutingService} from '../server/application/scouting-service.mjs';
import {EnhancementService} from '../server/application/enhancement-service.mjs';
import {ChallengeService} from '../server/application/challenge-service.mjs';
const big=()=>Array.from({length:100},(_,i)=>({id:String(i),text:'known historical content '.repeat(40)}));
test('archive survives restart and restores exact detail without exposing it in summary',()=>{
 const battle={id:'b',captured:true,broadcasts:[{events:big()}]};const packed=archiveFields(battle,['broadcasts']);assert.ok(JSON.stringify(packed).length<JSON.stringify(battle).length/5);
 assert.deepEqual(restoreArchivedFields(JSON.parse(JSON.stringify(packed))),battle);assert.deepEqual(battleSummary(packed),{id:'b',captured:true,hasDetailedReport:true});
});
test('migration preserves active tasks; claimed queue retries remain idempotent after restart',()=>{
 const players=big(),a={scouting:{tasks:{old:{id:'old',claimedAt:1,selectedCardIds:players.map(p=>p.id),claimedPlayers:players,candidates:big(),rounds:[{candidates:big()}]},active:{id:'active',claimedAt:null,candidates:big()}}},draft:{roster:[]}};
 const active=a.scouting.tasks.active,c={accounts:new Map([['a',a]]),world:{}};const before=structuredClone(a);const result=prepareHistoryCompaction(c,{maxRecords:Infinity});assert.equal(result.changed,true);assert.equal(a.scouting.tasks.active,active);assert.ok(a.scouting.tasks.old.archivedFields);
 const service=new ScoutingService({territoryIndex:{territories:[]},save(){throw Error('retry must not save');}});const saved=JSON.parse(JSON.stringify(a));assert.deepEqual(service.claimQueue(saved,'old',players.map(p=>p.id)),players);assert.throws(()=>service.claimQueue(saved,'old',['different']),/其他/);assert.equal(saved.draft.roster.length,0);
 result.rollback();assert.deepEqual(a,before);
});
test('enhancement archived receipt returns original result without repeating action',()=>{
 const result={cards:big()},options={requestId:'request-a',mainCardId:'main'};
 const signature=JSON.stringify(['upgrade',options.mainCardId,options.materialCardId,false,options.playerId,options.mainLevel,options.materialLevel,options.quantity]);
 const account={setupComplete:true,draft:{},enhancement:{requests:{'request-a':archiveFields({signature,result},['result'])}}};
 const s=new EnhancementService({});assert.deepEqual(s.request(JSON.parse(JSON.stringify(account)),options,'upgrade',()=>{throw Error('must not execute');}),result);
});
test('completed battle status and repeat completion restore archived broadcasts',()=>{
 const battle={id:'b',challengeId:'b',broadcasts:[{events:big()}]},account={battleHistory:[archiveFields(battle,['broadcasts'])]};
 const service=Object.create(ChallengeService.prototype);service.world={activeChallenges:{}};
 assert.deepEqual(service.status(account,'b').battle,battle);assert.deepEqual(service.complete(account,'b').battle,battle);
});
test('maintenance save failure restores original history references',()=>{
 const battle={id:'b',broadcasts:[{events:big()}]},a={battleHistory:[battle]},c={accounts:new Map([['a',a]]),world:{},now:()=>1800000000000,persist(){throw Error('disk failed');}};
 assert.throws(()=>maintainCampaignHistory(c),/disk failed/);assert.equal(a.battleHistory[0],battle);assert.equal(c.historyCursor,undefined);
 c.persist=()=>{};assert.equal(maintainCampaignHistory(c).changed,true);assert.ok(a.battleHistory[0].archivedFields);
});
test('bounded maintenance reaches later records after small incompressible records',()=>{
 const a={battleHistory:[...Array.from({length:40},(_,id)=>({id,broadcasts:[]})),{id:'large',broadcasts:[{events:big()}]}]},c={accounts:new Map([['a',a]]),world:{}};
 prepareHistoryCompaction(c);prepareHistoryCompaction(c);assert.ok(a.battleHistory.at(-1).archivedFields);assert.equal(prepareHistoryCompaction(c).changed,false);
});

test('legacy claimed candidates are reduced without breaking single-card retry',async()=>{
 const {createPlayerCardViewModel}=await import('../shared/player-card/player-card-contract.js');
 const card={id:'picked',name:'player',grade:'A',overall:80,role:'ST',attributes:{finishing:80}},other={...card,id:'other'};
 const task={id:'legacy',claimedAt:1,selectedCardId:'picked',candidates:[card,other]},a={scouting:{tasks:{legacy:task}}},c={accounts:new Map([['a',a]]),world:{}};
 prepareHistoryCompaction(c,{maxRecords:Infinity});const service=new ScoutingService({territoryIndex:{territories:[]}});
 assert.deepEqual(service.choose(JSON.parse(JSON.stringify(a)),'legacy','picked'),createPlayerCardViewModel(card));assert.deepEqual(a.scouting.tasks.legacy.candidates,[]);assert.throws(()=>service.choose(a,'legacy','other'),/其他/);
});
test('elite, raid and friendly report endpoints restore archived details',async()=>{
 const {EliteChallengeService}=await import('../server/application/elite-challenge-service.mjs');
 const {EliteRaidService}=await import('../server/application/elite-raid-service.mjs');
 const {DiplomacyService}=await import('../server/application/diplomacy-service.mjs');
 const battle={id:'report',broadcasts:[{events:big()}]},elite=Object.create(EliteChallengeService.prototype);elite.active=()=>null;
 assert.deepEqual(elite.snapshot({elite:{lastBattle:archiveFields(battle,['broadcasts'])}},'report').battle,battle);
 const raid=Object.create(EliteRaidService.prototype),raw={id:'report',broadcast:{events:big()}};raid.c={world:{eliteRaids:{matches:{},history:[archiveFields(raw,['broadcast'])]}}};
 assert.deepEqual(raid.snapshot({},'report').battle,{...raw,broadcasts:[raw.broadcast]});
 const friendly=Object.create(DiplomacyService.prototype);friendly.c={world:{diplomacy:{matches:{report:{id:'report',from:'a',to:'b',battle:archiveFields(battle,['broadcasts'])}}}}};
 assert.deepEqual(friendly.snapshot({id:'a'},'report').battle,battle);
});
