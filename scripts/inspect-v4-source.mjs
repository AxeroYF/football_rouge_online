import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readLeagueSource} from '../versus/v4-adapter/read-source.js';
import {sourceCoverage} from '../versus/v4-adapter/source-snapshot.js';
import {prepareSourceTeam} from '../versus/v4-adapter/prepare-teams.js';
const snapshot=readLeagueSource(process.cwd());
for(const [name,expected] of Object.entries(snapshot.sourceRevisions))assert.equal(createHash('sha256').update(fs.readFileSync(path.join('data',name))).digest('hex'),expected,'source changed during read');
const output=path.resolve('outputs/v4-real-teams-20261117');fs.mkdirSync(output,{recursive:true});
const report={...sourceCoverage(snapshot),sourceRevisions:snapshot.sourceRevisions,sourceFilesUnchanged:true};
report.preparation={runs:0,competitions:['league','cup','season-final','friendly'],allEleven:true,mutatedSource:false};
const before=JSON.stringify(snapshot);
for(const team of snapshot.teams)for(const competition of report.preparation.competitions){
  const prepared=prepareSourceTeam(snapshot,team.id,{competition});assert.equal(prepared.players.length,11);
  assert.equal(new Set(prepared.players.map(p=>p.id)).size,11);assert.ok(prepared.players.every(p=>!(p.state.injuryRounds>0)));
  report.preparation.runs++;
}
assert.equal(JSON.stringify(snapshot),before);
fs.writeFileSync(path.join(output,'source-coverage.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
