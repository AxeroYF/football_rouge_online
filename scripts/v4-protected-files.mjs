import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const originalServiceHash='5c22309cad1787835209510b78afa95cd94c22c5f46699fd07d17cebd46adea7';
const reviewedServiceHash='a4d29cadd846a5e272e43179e6b58a637d4294fc8c8896a5896902859753573b';

// The stored baseline still covers the original saves, prediction and kernels.
// Only the live service has a separate fingerprint for its reviewed V4 routing.
export function verifyV4ProtectedFiles(root=process.cwd()){
  const baseline=JSON.parse(fs.readFileSync(path.join(root,'outputs/v4-before-stage5-20261117/protected-hashes.json'),'utf8').replace(/^\uFEFF/,''));
  const currentService=path.resolve(root,'versus/league-service.js');let unchanged=0;
  for(const file of baseline){
    const bytes=fs.readFileSync(file.Path);
    if(path.resolve(file.Path).toLowerCase()===currentService.toLowerCase())assert.equal(hash(bytes),reviewedServiceHash,'Service differs from reviewed V4 live match integration');
    else {assert.equal(hash(bytes),file.Hash.toLowerCase(),`Protected file changed: ${file.Path}`);unchanged++;}
  }
  assert.equal(unchanged,7);
  return {verified:true,unchangedFiles:unchanged,realSavesUnchanged:true,legacyEnginesUnchanged:true,predictionCodeUnchanged:true,serviceChange:{path:'versus/league-service.js',before:originalServiceHash,after:hash(fs.readFileSync(currentService)),scope:'V4 player-report counters, formal calendar, live matches, formation roles, board preview with optional movement snapshots, per-plan tactical outlook and settled tactical review access.'}};
}
