import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';
import {dependencyHashes} from './v4-source-hashes.mjs';
const entries=['scripts/verify-v4-legacy-consumer-regression.mjs','scripts/v4-legacy-service-test-loader.mjs','test/season-final-tournament.test.js','versus/public/app.js'];
const sources=dependencyHashes(entries),output=path.resolve('outputs/v4-settlement-20261118');fs.mkdirSync(output,{recursive:true});
const root=fs.mkdtempSync(path.join(output,'legacy-comparison-')),results=[];
for(const baseline of [false,true]){
  const directory=path.join(root,baseline?'baseline':'current');fs.mkdirSync(directory);
  const env={...process.env,V4_LEGACY_TEST_ROOT:directory,V4_LEGACY_SERVICE_TEST:baseline?'1':'0',VERSUS_ACCOUNTS_PATH:path.join(directory,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(directory,'league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(directory,'content.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(directory,'studio.json'),YDL_PLAYER_PROFILE_ROOT:path.join(directory,'profiles')};
  const result=spawnSync(process.execPath,[...(baseline?['--loader','./scripts/v4-legacy-service-test-loader.mjs']:[]),'--test','--test-reporter=tap','test/season-final-tournament.test.js'],{cwd:process.cwd(),windowsHide:true,env,encoding:'utf8',maxBuffer:16*1024*1024,timeout:180000});
  fs.writeFileSync(path.join(directory,'test.tap'),result.stdout);fs.writeFileSync(path.join(directory,'stderr.log'),result.stderr);
  const outcomes=[...result.stdout.matchAll(/^(not ok|ok) (\d+) - (.+)$/gm)].map(m=>({passed:m[1]==='ok',number:Number(m[2]),name:m[3]}));
  assert.equal(outcomes.length,39);assert.ok([0,1].includes(result.status),result.stderr);
  results.push({baseline,exitCode:result.status,tests:outcomes.length,passed:outcomes.filter(o=>o.passed).length,failed:outcomes.filter(o=>!o.passed).length,outcomes});
}
assert.deepEqual(results[0].outcomes,results[1].outcomes);assert.deepEqual(dependencyHashes(entries),sources);
const report={passed:true,scope:'Differential regression comparison only. Both runs use identical current dependencies; the baseline loader substitutes the hash-verified pre-V4-consumer league service. Existing disabled-season-final/UI test failures remain failures.',root,results,preservation:verifyV4ProtectedFiles(),dependencyHashes:sources};
fs.writeFileSync(path.join(output,'legacy-consumer-regression.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,root,results:results.map(({outcomes,...r})=>r)}));
