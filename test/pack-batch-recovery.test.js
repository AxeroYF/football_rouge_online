import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {YellowDogsLeagueService} from '../versus/league-service.js';
import {createTrackedState,unwrapTracked} from '../versus/league-shard-store.js';
import {withS4AssetTransactionBatch,recordS4AssetTransaction} from '../versus/s4-assets.js';
import {requestDirectPackBatch} from '../versus/public/direct-pack-batch.js';

const NOW = Date.parse('2026-11-17T12:00:00+08:00');
const user = {id:'batch-recovery',nickname:'批量恢复'};
function fixture(statePath = null) {
  const service = new YellowDogsLeagueService({statePath,backupDir:null,now:()=>NOW,rng:()=>.37});
  service.beginDraft(user,'批量恢复'); service.autoDraft(user); service.finishDraft(user);
  const packIds = service.grantS4Pack(user.id,'private-mixed',100).map(p=>p.id);
  return {service,packIds};
}
const snapshot = service => structuredClone(unwrapTracked({assets:service.state.s4Assets,
  packs:service.s4PackInventory(user.id),team:service.accountTeam(user.id),ledger:service.state.ledger}));

test('100 tracked awards keep both audit entries and replace 5000-entry history only once',()=>{
  const {service,packIds}=fixture();
  service.state.s4Assets.transactions=Array.from({length:5000},(_,i)=>({id:`old-${i}`}));
  let replacements=0;const assets=service.state.s4Assets;
  let transactions=assets.transactions;
  Object.defineProperty(assets,'transactions',{enumerable:true,configurable:true,get:()=>transactions,set:v=>{transactions=v;replacements++;}});
  service.state=createTrackedState(service.state,()=>{});
  let saves=0;service.save=()=>{saves++;};
  const result=service.openS4PacksBatch(user,packIds,{compact:true,requestId:'audit-100'});
  assert.equal(replacements,1);assert.equal(saves,1);
  assert.equal(new Set(result.packBatchOpening.results.map(r=>r.card.id)).size,100);
  const logs=service.state.s4Assets.transactions;
  assert.equal(logs.length,5000);assert.equal(logs[0].id,'old-200');
  assert.equal(logs.slice(-200).filter(r=>r.type==='card-created').length,100);
  assert.equal(logs.slice(-200).filter(r=>r.type==='private-pack-card').length,100);
});

test('batch retry is idempotent, account scoped, and rejects key reuse for different packs',()=>{
  const {service,packIds}=fixture();
  const first=service.openS4PacksBatch(user,packIds,{compact:true,requestId:'retry-100'});
  const before=snapshot(service);
  service.rng=()=>{throw new Error('must not draw again');};
  service.save=()=>{throw new Error('must not save again');};
  service.state.s4Packs.batchOpenings[user.id]={id:'another-choice',status:'active',packIds:['choice'],results:[]};
  const repeat=service.openS4PacksBatch(user,[...packIds].reverse(),{compact:true,requestId:'retry-100'});
  assert.deepEqual(repeat.packBatchOpening.results,first.packBatchOpening.results);
  assert.equal(repeat.packBatchOpening.replayed,true);
  assert.deepEqual(snapshot(service),before);
  assert.throws(()=>service.openS4PacksBatch(user,packIds.slice(1),{requestId:'retry-100'}),/其他礼包/);
  assert.equal(service.directPackBatchResult({id:'another-account'},'retry-100').packBatchLookup.found,false);
  assert.throws(()=>service.directPackBatchResult(user,undefined),/标识无效/);
});

for(const stage of ['grant','save']) test(`${stage} failure rolls back all 100 rewards, packs, logs and new legendary roster families`,()=>{
  const {service,packIds}=fixture();service.rng=()=>.01;
  service.state=createTrackedState(service.state,()=>{});
  const before=snapshot(service),grant=service.grantS4Card.bind(service),save=service.save.bind(service);
  let calls=0;
  if(stage==='grant') service.grantS4Card=(...args)=>{const result=grant(...args);if(++calls===50)throw new Error('injected grant failure');return result;};
  else service.save=()=>{throw new Error('injected save failure');};
  assert.throws(()=>service.openS4PacksBatch(user,packIds,{compact:true,requestId:'rollback-100'}),/injected/);
  assert.deepEqual(snapshot(service),before);
  assert.equal(service.directPackBatchResult(user,'rollback-100').packBatchLookup.found,false);
  service.grantS4Card=grant;service.save=save;
  assert.equal(service.openS4PacksBatch(user,packIds,{compact:true,requestId:'rollback-100'}).packBatchOpening.total,100);
});

for(const format of ['json','shard']) test(`${format} restarts recover the original receipt without resurrecting recycled cards`,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-pack-recovery-'));
  try {
    const statePath=path.join(dir,format==='json'?'league.json':'shards');
    const {service,packIds}=fixture(statePath);
    const first=service.openS4PacksBatch(user,packIds,{compact:true,requestId:'persist-100'});
    const original=first.packBatchOpening.results[0];
    service.state.s4Assets.cards[original.card.id].status='recycled';service.save({skipDailyBackup:true});
    const loaded=new YellowDogsLeagueService({statePath,backupDir:null,now:()=>NOW,rng:()=>.37});
    const recovered=loaded.directPackBatchResult(user,'persist-100');
    assert.deepEqual(recovered.packBatchOpening.results,first.packBatchOpening.results);
    assert.equal('s4CardDeltas' in recovered,false);
    assert.ok(recovered.ownTeam);
    assert.equal(loaded.playerCards(user.id).some(c=>c.id===original.card.id),false);
    assert.equal(loaded.view(user,{includePlayerDirectory:false}).s4Packs.lastDirectOpening.requestId,'persist-100');
    assert.equal(loaded.openS4PacksBatch(user,packIds,{compact:true,requestId:'persist-100'}).packBatchOpening.replayed,true);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

for (const committed of [false,true]) test(`shard ${committed?'post-commit cleanup':'pre-commit write'} failure preserves the durable outcome`,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yffm-pack-recovery-'));
  try {
    const statePath=path.join(dir,'shards'),{service,packIds}=fixture(statePath);
    service.save({skipDailyBackup:true});
    const before=snapshot(service),store=service.shardStore;
    const method=committed?'cleanupRevisions':'writePacks',original=store[method];
    store.lastCleanupAt=0;store[method]=()=>{throw new Error('injected disk failure');};
    if(committed)assert.equal(service.openS4PacksBatch(user,packIds,{compact:true,requestId:'disk-100'}).packBatchOpening.total,100);
    else {
      assert.throws(()=>service.openS4PacksBatch(user,packIds,{compact:true,requestId:'disk-100'}),/injected disk failure/);
      assert.deepEqual(snapshot(service),before);
    }
    store[method]=original;
    const loaded=new YellowDogsLeagueService({statePath,backupDir:null,now:()=>NOW,rng:()=>.37});
    const found=loaded.directPackBatchResult(user,'disk-100');
    assert.equal(Boolean(found.packBatchOpening),committed);
    if(!committed){
      assert.equal(loaded.s4PackInventory(user.id).filter(p=>p.status==='unopened').length,100);
      assert.equal(service.openS4PacksBatch(user,packIds,{compact:true,requestId:'disk-100'}).packBatchOpening.total,100);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('receipt retention is bounded; expired batches cannot award again',()=>{
  const {service,packIds}=fixture();service.save=()=>{};
  for(let i=0;i<21;i++)service.openS4PacksBatch(user,[packIds[i]],{compact:true,requestId:`bounded-${i}`});
  assert.equal(service.state.s4Packs.directReceipts[user.id].length,20);
  assert.equal(service.directPackBatchResult(user,'bounded-0').packBatchLookup.found,false);
  assert.throws(()=>service.openS4PacksBatch(user,[packIds[0]],{compact:true,requestId:'bounded-0'}),/不可用/);
});

test('discarded audit batch cannot leak into the next operation',()=>{
  const state={s4Assets:{transactions:[]}};
  assert.throws(()=>withS4AssetTransactionBatch(state,()=>{recordS4AssetTransaction(state,{id:'lost'});throw new Error('failed');}));
  recordS4AssetTransaction(state,{id:'kept'});
  assert.deepEqual(state.s4Assets.transactions.map(r=>r.id),['kept']);
});

test('daily backup failure occurs before any packs or rewards are changed',()=>{
  const {service,packIds}=fixture(),before=snapshot(service);
  service.maintainBackups=()=>{throw new Error('backup unavailable');};
  assert.throws(()=>service.openS4PacksBatch(user,packIds,{compact:true,requestId:'backup-100'}),/backup unavailable/);
  assert.deepEqual(snapshot(service),before);
});

test('lost HTTP response is recovered without another open request',async()=>{
  const {service,packIds}=fixture();let opens=0;
  const value=await requestDirectPackBatch(async(route,body)=>{
    if(route.endsWith('batch-result'))return service.directPackBatchResult(user,body.requestId);
    opens++;service.openS4PacksBatch(user,body.packIds,{compact:true,requestId:body.requestId});throw new Error('network timeout');
  },{requestId:'lost-response',packIds});
  assert.equal(opens,1);assert.equal(value.packBatchOpening.results.length,100);
});

test('reload checks receipt before safely resubmitting the exact unprocessed request',async()=>{
  const payload={requestId:'reload-100',packIds:['a','b']},calls=[];
  await requestDirectPackBatch(async(route,body)=>{calls.push({route,body});return route.endsWith('batch-result')?{packBatchLookup:{found:false}}:{packBatchOpening:{complete:true}};},payload,{recover:true});
  assert.deepEqual(calls,[{route:'/packs/batch-result',body:{requestId:'reload-100'}},{route:'/packs/open-batch',body:payload}]);
});

test('validation failure is surfaced without automatic resubmission',async()=>{
  let calls=0;
  await assert.rejects(requestDirectPackBatch(async()=>{calls++;throw Object.assign(new Error('unavailable'),{status:400});},{requestId:'invalid-100',packIds:[]}),/unavailable/);
  assert.equal(calls,1);
});
