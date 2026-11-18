import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch} from '../versus/v4-adapter/compile-match.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {verifyV4ProtectedFiles} from './v4-protected-files.mjs';

const entries=['scripts/verify-v4-dispatch-local.mjs','scripts/verify-v4-dispatch-worker.mjs','versus/v4-host/dispatch-worker.js'];
const sourceHashes=dependencyHashes(entries);verifyV4ProtectedFiles();
const output=path.resolve('outputs/v4-dispatch-20261118');fs.mkdirSync(output,{recursive:true});
const root=fs.mkdtempSync(path.join(output,'round-'));fs.writeFileSync(path.join(root,'isolation.json'),JSON.stringify({format:'v4-dispatch-proof-1'}));
const source=readLeagueSource(process.cwd()),teams=[...source.teams].sort((a,b)=>a.division.localeCompare(b.division)||a.id.localeCompare(b.id)),tasks=[];
assert.equal(teams.length,16);
for(let i=0;i<teams.length;i+=2){
  const fixture={id:`dispatch-full-${i/2+1}`,competition:'league'},context={competition:'league',round:999};
  assert.equal(teams[i].division,teams[i+1].division);
  tasks.push({fixture,context,envelope:compileRealMatch(source,{homeId:teams[i].id,awayId:teams[i+1].id,fixtureId:fixture.id,seed:fixture.id,competition:'league'})});
}
fs.writeFileSync(path.join(root,'tasks.json'),JSON.stringify(tasks));
for(const name of ['yellowdogs-league.json','ydl-content-overrides.json','ydl-player-card-studio.json'])fs.copyFileSync(path.join('data',name),path.join(root,name));
const child=spawnSync(process.execPath,['scripts/verify-v4-dispatch-worker.mjs'],{windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:1024*1024,env:{...process.env,V4_DISPATCH_SANDBOX:root,VERSUS_ACCOUNTS_PATH:path.join(root,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(root,'yellowdogs-league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(root,'ydl-content-overrides.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(root,'ydl-player-card-studio.json'),YDL_PLAYER_PROFILE_ROOT:path.join(root,'profiles')}});
fs.writeFileSync(path.join(root,'worker.log'),child.stdout+child.stderr);assert.equal(child.status,0,child.stderr||child.error?.message);
assert.deepEqual(dependencyHashes(entries),sourceHashes);const preservation=verifyV4ProtectedFiles();
const report={passed:true,root,sourceFingerprint:source.fingerprint,dependencyHashes:sourceHashes,preservation,...JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8')),productionEnabled:false,cloudConnected:false};
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
