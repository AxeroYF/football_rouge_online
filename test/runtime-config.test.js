import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAdminPassword,resolveMatchEngines} from '../src/runtime-config.js';
test('engine configuration defaults to V3 and supports explicit V2 and legacy overrides',()=>{
  assert.deepEqual(resolveMatchEngines({}),{default:'v3',league:'v3',cup:'v3',friendly:'v3'});
  assert.deepEqual(resolveMatchEngines({YDL_MATCH_ENGINE:'v1',YDL_CUP_MATCH_ENGINE:'v2'}),{default:'v1',league:'v1',cup:'v2',friendly:'v1'});
  assert.equal(resolveMatchEngines({YFFM_MATCH_ENGINE:'v2',YDL_MATCH_ENGINE:'v1'}).league,'v2');
});
test('public and production servers require an explicit admin password',()=>{
  assert.equal(resolveAdminPassword({}),'local-dev-admin');
  assert.throws(()=>resolveAdminPassword({APP_ENV:'production'}),/requires/);
  assert.throws(()=>resolveAdminPassword({VERSUS_HOST:'0.0.0.0'}),/requires/);
  assert.equal(resolveAdminPassword({APP_ENV:'production',YFFM_ADMIN_PASSWORD:'a-long-unique-test-password'}),'a-long-unique-test-password');
  assert.equal(resolveAdminPassword({APP_ENV:'production',YDL_OFFLINE_MODE:'1'}),'ydl-offline');
});
