import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {compileRealMatch,resultEnvelope} from '../versus/v4-adapter/compile-match.js';
import {createMatch,advanceMatch,simulateMatch,exportCheckpoint,restoreCheckpoint} from '../versus/v4/engine.js';
import {dependencyHashes} from './v4-source-hashes.mjs';
const output=path.resolve('outputs/v4-real-teams-20261117');fs.mkdirSync(output,{recursive:true});
const snapshot=readLeagueSource(process.cwd()),before=JSON.stringify(snapshot),rows=[];
for(const competition of ['league','cup','season-final','friendly'])for(let i=0;i<snapshot.teams.length;i+=2){
  const options={homeId:snapshot.teams[i].id,awayId:snapshot.teams[i+1].id,competition,fixtureId:`adapter-${competition}-${i}`,seed:`adapter-${competition}-${i}`,duration:180};
  const envelope=compileRealMatch(snapshot,options);assert.deepEqual(envelope.coverage.blockers,[]);assert.equal(compileRealMatch(snapshot,options).fingerprint,envelope.fingerprint);
  const m=createMatch(envelope.input,{recording:false});advanceMatch(m,41);const resumed=restoreCheckpoint(exportCheckpoint(m));
  while(m.state.phase!=='finished')advanceMatch(m,250);while(resumed.state.phase!=='finished')advanceMatch(resumed,250);
  assert.deepEqual(m,resumed);const result=resultEnvelope(envelope,m);assert.equal(result.settlementAllowed,false);
  rows.push({fixtureId:options.fixtureId,competition,score:result.score,inputFingerprint:result.inputFingerprint,players:m.state.players.length,excludedBench:envelope.coverage.excludedBench.length,warnings:envelope.coverage.warnings,events:m.events.length});
}
assert.equal(JSON.stringify(snapshot),before);
// Explicit unsupported features fail before match creation, while a knowingly
// partial shadow run retains a machine-readable blocker and cannot settle.
const unsupported=structuredClone(snapshot),team=unsupported.teams.find(t=>t.humanOwned),starter=team.preferredStarterIds[0];
const p=team.roster.find(p=>p.id===starter);p.traitDefinitions=[{id:'unsupported-fixture',rules:[{hook:'unknownTestHook'}]}];
const options={homeId:team.id,awayId:unsupported.teams.find(t=>t.id!==team.id).id,fixtureId:'unsupported-proof',seed:'unsupported-proof',duration:60};
assert.throws(()=>compileRealMatch(unsupported,options),/trait:unknownTestHook/);
assert.ok(compileRealMatch(unsupported,{...options,allowPartial:true}).coverage.blockers.includes('trait:unknownTestHook'));
assert.throws(()=>compileRealMatch(snapshot,{...options,environment:{weather:'rainy'}}),/未知的比赛天气/);
assert.equal(compileRealMatch(snapshot,{...options,environment:{weather:'rain'}}).input.environment.weather,'rain');
const fullEnvelope=compileRealMatch(snapshot,{homeId:snapshot.teams[0].id,awayId:snapshot.teams[2].id,fixtureId:'real-full-proof',seed:'real-full-proof'});
const started=performance.now(),full=simulateMatch(fullEnvelope.input,{recording:false}),result=resultEnvelope(fullEnvelope,full);
assert.equal(full.state.clock.completed.length,2);assert.ok(full.state.time>=6300);assert.equal(result.settlementAllowed,false);
for(const [name,expected] of Object.entries(snapshot.sourceRevisions))assert.equal(createHash('sha256').update(fs.readFileSync(path.join('data',name))).digest('hex'),expected);
const report={passed:true,version:full.state.version,dependencyHashes:dependencyHashes(['versus/v4/engine.js','versus/v4-adapter/read-source.js','versus/v4-adapter/compile-match.js']),sourceFingerprint:snapshot.fingerprint,sourceRevisions:snapshot.sourceRevisions,shortRuns:rows.length,rows,
  full:{score:result.score,stats:result.stats,periods:full.state.clock.completed,simulationSeconds:full.state.time,elapsedMs:performance.now()-started},
  checkpointExact:true,unsupportedFeaturesRejected:true,sourceUnchanged:true,settlementAllowed:false};
fs.writeFileSync(path.join(output,'real-adapter-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,shortRuns:rows.length,full:report.full,sourceUnchanged:true}));
