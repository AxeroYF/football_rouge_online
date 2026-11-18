import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolveSourceCatalog} from '../versus/v4-adapter/read-source.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
const entries=['scripts/verify-v4-source-parity.mjs','versus/ydl-content-store.js','versus/player-pool.js','versus/trait-pool.js'];
const sourceHashes=dependencyHashes(entries);

const output=path.resolve('outputs/v4-real-teams-20261117');fs.mkdirSync(output,{recursive:true});
const sandbox=fs.mkdtempSync(path.join(output,'catalog-parity-'));
const files=['ydl-content-overrides.json','ydl-player-card-studio.json'];
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before=Object.fromEntries(files.map(name=>[name,hash(path.join('data',name))]));
for(const name of files)fs.copyFileSync(path.join('data',name),path.join(sandbox,name));
const content=JSON.parse(fs.readFileSync(path.join(sandbox,files[0]),'utf8')),studio=JSON.parse(fs.readFileSync(path.join(sandbox,files[1]),'utf8'));
const resolved=resolveSourceCatalog({content,studio});
// Run the canonical read/migration path only against disposable copies in a
// separate process. Never import league-service or point a writer at data/.
const script=`const c=await import('./versus/ydl-content-store.js');await c.flushContentWrites();const p=await import('./versus/player-pool.js');const t=await import('./versus/trait-pool.js');process.stdout.write(JSON.stringify({players:p.REAL_PLAYERS,traits:t.YDL_TRAIT_CARDS}));`;
const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),encoding:'utf8',maxBuffer:16*1024*1024,
  env:{...process.env,YDL_CONTENT_OVERRIDES_PATH:path.join(sandbox,files[0]),YDL_PLAYER_CARD_STUDIO_PATH:path.join(sandbox,files[1]),YDL_PLAYER_PROFILE_ROOT:path.join(sandbox,'profiles')}});
assert.equal(result.status,0,result.stderr);const canonical=JSON.parse(result.stdout);
const playerKeys=['id','name','role','secondaryRole','preferredFoot','grade','overall','heightCm','nationality','club','attributes'];
const traitKeys=['id','name','eligibleRoleGroups','rules'];
const normalized=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value[key]??null]));
assert.equal(resolved.players.length,canonical.players.length);assert.equal(resolved.traits.length,canonical.traits.length);
for(const p of resolved.players)assert.deepEqual(normalized(p,playerKeys),normalized(canonical.players.find(c=>c.id===p.id),playerKeys),`catalog differs: ${p.id}`);
for(const t of resolved.traits)assert.deepEqual(normalized(t,traitKeys),normalized(canonical.traits.find(c=>c.id===t.id),traitKeys),`trait differs: ${t.id}`);
for(const [name,expected] of Object.entries(before))assert.equal(hash(path.join('data',name)),expected);
assert.deepEqual(dependencyHashes(entries),sourceHashes);
const report={passed:true,players:resolved.players.length,traits:resolved.traits.length,originalFilesUnchanged:true,sandbox,dependencyHashes:sourceHashes,sourceRevisions:before,scope:'Canonical content loader in a child process, all persistence paths redirected to retained copies. No league service loaded.'};
fs.writeFileSync(path.join(output,'catalog-parity.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
