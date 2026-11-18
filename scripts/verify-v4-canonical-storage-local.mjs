import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const entries=['scripts/verify-v4-canonical-storage-local.mjs','scripts/verify-v4-canonical-storage-worker.mjs'],sources=dependencyHashes(entries);
verifyV4ProtectedFiles();const output=path.resolve('outputs/v4-canonical-storage-20261118');fs.mkdirSync(output,{recursive:true});
const root=fs.mkdtempSync(path.join(output,'round-'));fs.writeFileSync(path.join(root,'isolation.json'),JSON.stringify({format:'v4-canonical-storage-proof-1'}));
for(const name of ['yellowdogs-league.json','ydl-content-overrides.json','ydl-player-card-studio.json'])fs.copyFileSync(path.join('data',name),path.join(root,name));
const prior=JSON.parse(fs.readFileSync('outputs/v4-dispatch-accepted-20261118/evidence/verification.json','utf8'));
assert.equal(prior.passed,true);assert.equal(prior.matches,8);fs.writeFileSync(path.join(root,'accepted-round.json'),JSON.stringify(prior));
const child=spawnSync(process.execPath,['scripts/verify-v4-canonical-storage-worker.mjs'],{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1024*1024,env:{...process.env,V4_STORAGE_SANDBOX:root,VERSUS_ACCOUNTS_PATH:path.join(root,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(root,'yellowdogs-league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(root,'ydl-content-overrides.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(root,'ydl-player-card-studio.json'),YDL_PLAYER_PROFILE_ROOT:path.join(root,'profiles')}});
fs.writeFileSync(path.join(root,'worker.log'),child.stdout+child.stderr);assert.equal(child.status,0,`Storage proof failed; inspect ${path.join(root,'worker.log')}`);
assert.deepEqual(dependencyHashes(entries),sources);const preservation=verifyV4ProtectedFiles();
const report={passed:true,root,...JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8')),dependencyHashes:sources,preservation,productionEnabled:false,cloudConnected:false};
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,root,storages:report.storages,preservation}));
