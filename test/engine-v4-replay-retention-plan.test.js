import test from 'node:test';
import assert from 'node:assert/strict';
import {planReplayRetention} from '../versus/v4-host/replay-retention-plan.js';
const now=1000000,record=(id,overrides={})=>({matchId:id,bytes:100,endedAt:0,settled:true,released:true,pinned:false,viewing:false,manifestDigest:'a'.repeat(64),...overrides}),policy={maxBytes:100,maxAgeMs:10000,minAgeMs:1000,keepLatest:1};

test('retention protects current, viewing, pinned and unconsumed archives even when the budget cannot be met',()=>{
  const records=[record('old'),record('latest',{endedAt:now-500}),record('viewer',{viewing:true}),record('pinned',{pinned:true}),record('unfinished',{settled:false}),record('hidden',{released:false})],before=structuredClone(records);
  const plan=planReplayRetention({records,now,policy});assert.deepEqual(plan.expire.map(row=>row.matchId),['old']);assert.equal(plan.budgetSatisfied,false);assert.equal(plan.projectedBytes,500);assert.equal(plan.protected.length,5);assert.deepEqual(records,before);
});

test('retention removes eligible oldest candidates to a budget, keeps the newest and preserves an exact identity for later recheck',()=>{
  const records=[record('new',{endedAt:now-1000}),record('middle',{endedAt:now-2000}),record('old',{endedAt:now-3000})],plan=planReplayRetention({records,now,policy});
  assert.deepEqual(plan.expire.map(row=>[row.matchId,row.reason]),[['old','budget'],['middle','budget']]);assert.equal(plan.projectedBytes,100);assert.equal(plan.budgetSatisfied,true);assert.ok(plan.expire.every(row=>row.manifestDigest==='a'.repeat(64)));assert.equal(plan.scope,'plan-only');
  assert.throws(()=>planReplayRetention({records:[records[0],records[0]],now,policy}),/记录/);assert.throws(()=>planReplayRetention({records,now,policy:{...policy,minAgeMs:20000}}),/配置/);
});
