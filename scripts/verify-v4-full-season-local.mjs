import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const entries=['scripts/verify-v4-full-season-local.mjs','scripts/verify-v4-full-season-worker.mjs','versus/v4-host/dispatch-worker.js'],sources=dependencyHashes(entries);verifyV4ProtectedFiles();
const output=path.resolve('outputs/v4-full-season-20261118');fs.mkdirSync(output,{recursive:true});
const resume=process.argv.find(arg=>arg.startsWith('--resume='))?.slice(9),root=resume?fs.realpathSync(resume):fs.mkdtempSync(path.join(output,'season-'));
const retryFixture=process.argv.find(arg=>arg.startsWith('--retry-fixture='))?.slice(16)??'';
if(retryFixture)assert.ok(resume&&/^[a-zA-Z0-9_-]{1,100}$/.test(retryFixture));
if(resume){const relative=path.relative(output,root);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'isolation.json'),'utf8')).format,'v4-full-season-proof-1');}
else fs.writeFileSync(path.join(root,'isolation.json'),JSON.stringify({format:'v4-full-season-proof-1'}));
for(const name of ['yellowdogs-league.json','ydl-content-overrides.json','ydl-player-card-studio.json']){if(resume)assert.deepEqual(fs.readFileSync(path.join(root,name)),fs.readFileSync(path.join('data',name)));else fs.copyFileSync(path.join('data',name),path.join(root,name));}
const attempt=Date.now(),resultName=`result-${attempt}.json`,child=spawnSync(process.execPath,['--max-old-space-size=1536','scripts/verify-v4-full-season-worker.mjs'],{windowsHide:true,encoding:'utf8',timeout:3600000,maxBuffer:4*1024*1024,env:{...process.env,V4_SEASON_SANDBOX:root,V4_SEASON_RETRY_FIXTURE:retryFixture,V4_SEASON_RESULT_NAME:resultName,VERSUS_ACCOUNTS_PATH:path.join(root,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(root,'yellowdogs-league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(root,'ydl-content-overrides.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(root,'ydl-player-card-studio.json'),YDL_PLAYER_PROFILE_ROOT:path.join(root,'profiles')}});
fs.writeFileSync(path.join(root,`worker-${attempt}.log`),child.stdout+child.stderr);assert.equal(child.status,0,child.stderr||child.error?.message);assert.deepEqual(dependencyHashes(entries),sources);
const report={...JSON.parse(fs.readFileSync(path.join(root,resultName),'utf8')),root,resultFile:path.join(root,resultName),dependencyHashes:sources,preservation:verifyV4ProtectedFiles(),productionEnabled:false,cloudConnected:false};
if(fs.existsSync(path.join(output,'verification.json')))fs.copyFileSync(path.join(output,'verification.json'),path.join(root,`prior-verification-${attempt}.json`));
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,root,storages:report.storages.map(({storage,matches,rounds,cupEvents,reset,reopenExactlyOnce})=>({storage,matches,rounds,cupEvents,reset,reopenExactlyOnce}))}));
