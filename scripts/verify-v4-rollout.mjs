import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {dependencyHashes} from './v4-source-hashes.mjs';
import {createEngineBundle,loadEngineBundle} from '../versus/v4-rollout/bundle.js';
import {createSandboxJournal,openSandboxJournal} from '../versus/v4-rollout/sandbox-journal.js';
import {selectMatchEngine} from '../versus/v4-rollout/policy.js';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch,resultEnvelope} from '../versus/v4-adapter/compile-match.js';
const output=path.resolve('outputs/v4-rollout-20261117');fs.mkdirSync(output,{recursive:true});const run=fs.mkdtempSync(path.join(output,'drill-'));
const source=readLeagueSource(process.cwd()),envelope=compileRealMatch(source,{homeId:source.teams[0].id,awayId:source.teams[1].id,fixtureId:'rollback-drill',competition:'friendly',duration:180,seed:'rollback-drill'});
const bundle=await createEngineBundle(path.join(run,'engine'),{sourceRoot:process.cwd(),engineVersion:envelope.engineVersion,files:dependencyHashes(['versus/v4/engine.js'])});
const engine=await loadEngineBundle(path.join(run,'engine'),bundle),fixture={id:envelope.input.fixtureId,competition:'friendly'};
// An explicit synthetic acceptance flag exercises policy mechanics only. It
// does not certify or enable the working V4 candidate in the formal service.
const selection=selectMatchEngine({fixture,accepted:true,coverage:envelope.coverage,policy:{mode:'canary',fixtureAllowlist:[fixture.id],competitions:['friendly']}});
const journal=await createSandboxJournal(path.join(run,'journal'),{played:0,goals:[0,0]});
await journal.pin({fixtureId:fixture.id,engineVersion:envelope.engineVersion,sourceDigest:bundle.sourceDigest,inputFingerprint:envelope.fingerprint,input:envelope.input,selection});
const original=engine.createMatch(envelope.input,{recording:false});engine.advanceMatch(original,107);
await journal.checkpoint(fixture.id,engine.exportCheckpoint(original));
const reopened=await openSandboxJournal(path.join(run,'journal')),saved=(await reopened.read()).fixtures[fixture.id];
const restoredEngine=await loadEngineBundle(path.join(run,'engine'),saved),resumed=restoredEngine.restoreCheckpoint(saved.checkpoint.value);
while(original.state.phase!=='finished')engine.advanceMatch(original,250);while(resumed.state.phase!=='finished')restoredEngine.advanceMatch(resumed,250);assert.deepEqual(resumed,original);
assert.equal(selectMatchEngine({fixture,policy:{mode:'off'},pinned:saved.selection}).primary,'v4');assert.equal(selectMatchEngine({fixture:{id:'new-fixture',competition:'friendly'},policy:{mode:'off'}}).primary,'legacy');
const result=resultEnvelope(envelope,resumed);await reopened.complete(fixture.id,result);
const apply=(state,r)=>({played:state.played+1,goals:state.goals.map((n,i)=>n+r.score[i])});
await reopened.settle(fixture.id,apply);const retry=await (await openSandboxJournal(path.join(run,'journal'))).settle(fixture.id,apply);assert.equal(retry.duplicate,true);assert.equal((await reopened.read()).state.played,1);
await assert.rejects(loadEngineBundle(path.join(run,'engine'),{...bundle,sourceDigest:'0'.repeat(64)}),/版本/);
const protectedFiles=JSON.parse(fs.readFileSync('outputs/v4-before-stage5-20261117/protected-hashes.json','utf8').replace(/^\uFEFF/,''));
for(const item of protectedFiles)assert.equal(createHash('sha256').update(fs.readFileSync(item.Path)).digest('hex'),item.Hash.toLowerCase());
const report={passed:true,engineVersion:envelope.engineVersion,sourceDigest:bundle.sourceDigest,run,exactResume:true,pinnedVersionAfterRollback:true,newFixturesLegacyAfterRollback:true,settlementExactlyOnce:true,
  formalServiceChanged:false,formalSaveChanged:false,productionEnabled:false,score:result.score,scope:'Isolated rollout rehearsal; production host wiring and actual rollout remain disabled.',
  dependencyHashes:dependencyHashes(['versus/v4-rollout/bundle.js','versus/v4-rollout/sandbox-journal.js','versus/v4-rollout/policy.js','versus/v4-adapter/compile-match.js'])};
fs.writeFileSync(path.join(output,'rollout-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
