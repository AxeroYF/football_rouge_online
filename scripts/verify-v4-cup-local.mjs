import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const entries=['scripts/verify-v4-cup-local.mjs','scripts/verify-v4-cup-worker.mjs','versus/v4-host/dispatch-worker.js'],sources=dependencyHashes(entries);verifyV4ProtectedFiles();
const output=path.resolve('outputs/v4-cup-lifecycle-20261118');fs.mkdirSync(output,{recursive:true});
const resume=process.argv.find(arg=>arg.startsWith('--resume='))?.slice(9),root=resume?fs.realpathSync(resume):fs.mkdtempSync(path.join(output,'cup-'));
if(resume){const relative=path.relative(output,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8')).format,'v4-cup-lifecycle-proof-1');if(fs.existsSync(path.join(root,'result.json')))assert.ok(process.argv.includes('--recheck'),'completed rehearsal needs explicit recheck');}
else fs.writeFileSync(path.join(root,'isolation.json'),JSON.stringify({format:'v4-cup-lifecycle-proof-1'}));
for(const name of ['yellowdogs-league.json','ydl-content-overrides.json','ydl-player-card-studio.json']){if(resume)assert.deepEqual(fs.readFileSync(path.join(root,name)),fs.readFileSync(path.join('data',name)),'original seed copy changed');else fs.copyFileSync(path.join('data',name),path.join(root,name));}
const resultName=resume?`result-${Date.now()}.json`:'result.json';
const child=spawnSync(process.execPath,['scripts/verify-v4-cup-worker.mjs'],{windowsHide:true,encoding:'utf8',timeout:600000,maxBuffer:4*1024*1024,env:{...process.env,V4_CUP_SANDBOX:root,V4_CUP_RESULT_NAME:resultName,VERSUS_ACCOUNTS_PATH:path.join(root,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(root,'yellowdogs-league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(root,'ydl-content-overrides.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(root,'ydl-player-card-studio.json'),YDL_PLAYER_PROFILE_ROOT:path.join(root,'profiles')}});
fs.writeFileSync(path.join(root,resume?`resumed-worker-${Date.now()}.log`:'worker.log'),child.stdout+child.stderr);assert.equal(child.status,0,child.stderr||child.error?.message);assert.deepEqual(dependencyHashes(entries),sources);
const report={...JSON.parse(fs.readFileSync(path.join(root,resultName),'utf8')),root,resultFile:path.join(root,resultName),dependencyHashes:sources,preservation:verifyV4ProtectedFiles(),productionEnabled:false,cloudConnected:false};
if(fs.existsSync(path.join(output,'verification.json')))fs.copyFileSync(path.join(output,'verification.json'),path.join(root,`prior-verification-${Date.now()}.json`));
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,root,storages:report.storages}));
