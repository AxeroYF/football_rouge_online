import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const entries=['scripts/verify-v4-scheduled-league-local.mjs','scripts/verify-v4-scheduled-league-worker.mjs','versus/v4-host/dispatch-worker.js'];
const sourceHashes=dependencyHashes(entries);verifyV4ProtectedFiles();
const output=path.resolve('outputs/v4-scheduled-league-20261118');fs.mkdirSync(output,{recursive:true});
const root=fs.mkdtempSync(path.join(output,'rounds-'));fs.writeFileSync(path.join(root,'isolation.json'),JSON.stringify({format:'v4-scheduled-league-proof-1'}));
for(const name of ['yellowdogs-league.json','ydl-content-overrides.json','ydl-player-card-studio.json'])fs.copyFileSync(path.join('data',name),path.join(root,name));
const child=spawnSync(process.execPath,['scripts/verify-v4-scheduled-league-worker.mjs'],{windowsHide:true,encoding:'utf8',timeout:360000,maxBuffer:1024*1024,env:{...process.env,V4_ROUND_SANDBOX:root,VERSUS_ACCOUNTS_PATH:path.join(root,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(root,'yellowdogs-league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(root,'ydl-content-overrides.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(root,'ydl-player-card-studio.json'),YDL_PLAYER_PROFILE_ROOT:path.join(root,'profiles')}});
fs.writeFileSync(path.join(root,'worker.log'),child.stdout+child.stderr);assert.equal(child.status,0,child.stderr||child.error?.message);
assert.deepEqual(dependencyHashes(entries),sourceHashes);
const report={...JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8')),root,dependencyHashes:sourceHashes,preservation:verifyV4ProtectedFiles(),productionEnabled:false,cloudConnected:false};
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,root,storages:report.storages,preservation:report.preservation}));
