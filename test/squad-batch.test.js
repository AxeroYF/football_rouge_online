import test from 'node:test';
import assert from 'node:assert/strict';
import {squadBatchSnapshot,previewSquadBatch,saveSquadBatch} from '../server/application/squad-batch-service.mjs';
import {createBatchDraft} from '../client/team/team-batch-model.js';
function fixture(){
 const roster=Array.from({length:40},(_,i)=>({id:'p'+i,name:'球员'+i,cardDefinitionId:'card'+i,role:i%11===0?'GK':'CB',pool:i%11===0?'GK':'DEF',overall:70+i,attributes:{},state:{fitness:100}}));
 const account={id:'a',setupComplete:true,draft:{roster},playerSquads:{assignments:Object.fromEntries(roster.map((p,i)=>[p.id,i<22?'expedition':'garrison']))},tactics:{squads:{expedition:{starters:roster.slice(0,11).map(p=>p.id),positions:Object.fromEntries(roster.slice(0,11).map((p,i)=>[p.id,{x:10+i*7,y:i===0?90:65}]))},garrison:{starters:roster.slice(22,33).map(p=>p.id)}}}};
 let saves=0,broken=false;const service={world:{activeChallenges:{}},save(){if(broken)throw Error('disk failure');saves++;},actionState:a=>({playerSquads:structuredClone(a.playerSquads),tactics:structuredClone(a.tactics)})};
 const snapshot=()=>squadBatchSnapshot(account,service.world);
 const body=()=>({version:snapshot().version,requestId:'batch-request-1',changes:[{playerId:'p22',squadId:'expedition'},{playerId:'p0',squadId:'garrison'}]});
 return {account,service,snapshot,body,get saves(){return saves;},breakSave:()=>broken=true,restore:()=>broken=false};
}
test('full 22-player squad swaps atomically, previews are read only, retries save once',()=>{
 const f=fixture(),body=f.body(),before=structuredClone(f.account),preview=previewSquadBatch(f.account,f.service.world,body);
 assert.deepEqual(f.account,before);assert.equal(f.saves,0);assert.ok(preview.lineupChanges[0].removed.includes('p0'));
 saveSquadBatch(f.service,f.account,body);assert.equal(f.saves,1);assert.equal(f.account.playerSquads.assignments.p22,'expedition');assert.equal(f.account.playerSquads.assignments.p0,'garrison');
 assert.deepEqual(f.account.tactics.squads.expedition.positions.p1,before.tactics.squads.expedition.positions.p1);
 saveSquadBatch(f.service,f.account,body);assert.equal(f.saves,1);
 assert.throws(()=>saveSquadBatch(f.service,f.account,{...body,changes:body.changes.slice(1)}),/请求编号/);
});
test('over capacity, invalid ids, duplicate ids, wrong squad reject the entire batch',()=>{
 for(const changes of [[{playerId:'p22',squadId:'expedition'}],[{playerId:'missing',squadId:'garrison'}],[{playerId:'p0',squadId:'garrison'},{playerId:'p0',squadId:'expedition'}],[{playerId:'p0',squadId:'other'}]]){
  const f=fixture(),before=structuredClone(f.account);assert.throws(()=>saveSquadBatch(f.service,f.account,{...f.body(),changes}));assert.deepEqual(f.account,before);assert.equal(f.saves,0);
 }
});
test('training, medical, loan and active match prevent transfers with player-specific reasons',()=>{
 for(const field of ['training','medical','coalitionLoan','match']){
  const f=fixture();if(field==='match')f.service.world.activeChallenges.x={attackerId:'a',live:{attacker:{players:[{id:'p0'}]}}};else f.account.draft.roster[0][field]={id:'locked'};
  const body=f.body(),before=structuredClone(f.account);assert.ok(f.snapshot().locks.p0);assert.throws(()=>saveSquadBatch(f.service,f.account,body),/球员0/);assert.deepEqual(f.account,before);
 }
});
test('a newly started match is validated even after a successful preview',()=>{
 const f=fixture(),body=f.body();previewSquadBatch(f.account,f.service.world,body);f.service.world.activeChallenges.x={attackerId:'a',live:{attacker:{players:[{id:'p0'}]}}};assert.throws(()=>saveSquadBatch(f.service,f.account,body),/比赛进行中/);assert.equal(f.saves,0);
});
test('concurrent assignment and roster changes reject stale drafts, fitness ticks do not',()=>{
 const f=fixture(),body=f.body();f.account.draft.roster[0].state.fitness=90;assert.equal(f.snapshot().version,body.version);
 f.account.playerSquads.assignments.p1='garrison';assert.throws(()=>saveSquadBatch(f.service,f.account,body),/状态已变化/);
 const next=f.body();f.account.draft.roster[2].upgradeLevel=3;assert.throws(()=>saveSquadBatch(f.service,f.account,next),/状态已变化/);
});
test('disk failure rolls back assignments, lineup repair and retry receipt',()=>{
 const f=fixture(),body=f.body(),before=structuredClone(f.account);f.breakSave();assert.throws(()=>saveSquadBatch(f.service,f.account,body),/disk/);assert.deepEqual(f.account,before);f.restore();saveSquadBatch(f.service,f.account,body);assert.equal(f.saves,1);
});
test('draft permits temporary overflow, undo, individual revert and refresh preserving intentions',()=>{
 const f=fixture(),draft=createBatchDraft(f.snapshot());draft.move(['p22'],'expedition');assert.equal(draft.changes().length,1);assert.equal(Object.values(draft.assignments).filter(s=>s==='expedition').length,23);assert.equal(f.saves,0);
 draft.move(['p0'],'garrison');assert.equal(draft.changes().length,2);draft.undo();assert.equal(draft.changes().length,1);draft.revert('p22');assert.equal(draft.changes().length,0);draft.undo();assert.equal(draft.changes().length,1);
 f.account.playerSquads.assignments.p1='garrison';draft.refresh(f.snapshot());assert.equal(draft.assignments.p1,'garrison');assert.equal(draft.assignments.p22,'expedition');assert.equal(draft.changes().length,1);
 draft.reset();assert.equal(draft.changes().length,0);
});
test('draft excludes locked players and drops stale representative ids on explicit refresh',()=>{
 const f=fixture();f.account.draft.roster[0].training={};const draft=createBatchDraft(f.snapshot());draft.move(['p0'],'garrison');assert.equal(draft.changes().length,0);
 draft.move(['p22'],'expedition');f.account.draft.roster=f.account.draft.roster.filter(p=>p.id!=='p22');assert.deepEqual(draft.refresh(f.snapshot()),['p22']);assert.equal(draft.changes().length,0);
});
