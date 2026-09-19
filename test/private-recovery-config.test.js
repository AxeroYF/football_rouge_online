import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {readDowntimeRecoveryPlan} from '../server/application/downtime-recovery-plan.mjs';
import {RECOVERY_TEST_PLAN} from './fixtures/downtime-recovery-plan.mjs';
test('private recovery config is opt-in when absent and rejects explicit missing or invalid files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ydl-private-config-')),file=path.join(dir,'plan.json');
 try{
  assert.deepEqual(readDowntimeRecoveryPlan(file,{optional:true}).players,[]);
  assert.throws(()=>readDowntimeRecoveryPlan(file),/ENOENT/);
  fs.writeFileSync(file,JSON.stringify(RECOVERY_TEST_PLAN));assert.deepEqual(readDowntimeRecoveryPlan(file),RECOVERY_TEST_PLAN);
  const invalid=structuredClone(RECOVERY_TEST_PLAN);invalid.players[0].proposed.oil=-1;
  fs.writeFileSync(file,JSON.stringify(invalid));assert.throws(()=>readDowntimeRecoveryPlan(file),/Invalid private/);
  invalid.players[0].proposed.oil=0;invalid.players[1].accountId=invalid.players[0].accountId;
  fs.writeFileSync(file,JSON.stringify(invalid));assert.throws(()=>readDowntimeRecoveryPlan(file),/Invalid private/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
