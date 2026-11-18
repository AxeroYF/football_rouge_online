import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {normalizeArtBatch} from '../versus/public/player-art-preview.js';
import {A_PLAYER_PROFILE_BY_PLAYER_ID} from '../versus/public/a-player-profiles.js';
import {LEGENDARY_PROFILE_BY_PLAYER_ID} from '../versus/public/legendary-profiles.js';

const arg=name=>process.argv.find(v=>v.startsWith(name+'='))?.slice(name.length+1);
const input=arg('--manifest');
if(!input)throw Error('Usage: node scripts/apply-player-art-batch.mjs --manifest=path [--apply]');
const root=process.cwd(),apply=process.argv.includes('--apply');
const payload=JSON.parse(fs.readFileSync(input,'utf8')),entries=normalizeArtBatch(payload);
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const out=path.resolve(root,'outputs/card-art-imports',stamp);fs.mkdirSync(out,{recursive:true});
const content=path.resolve(root,'data/ydl-content-overrides.json'),studio=path.resolve(root,'data/ydl-player-card-studio.json');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const contentHash=hash(content),studioExisted=fs.existsSync(studio);
// Content loading can migrate. Always isolate content, even when applying only artwork.
fs.copyFileSync(content,path.join(out,'content.json'));
if(studioExisted)fs.copyFileSync(studio,path.join(out,'studio-before.json'));
fs.writeFileSync(path.join(out,'backup-state.json'),JSON.stringify({studioExisted,contentHash,manifest:path.resolve(input),apply},null,2));
const isolatedStudio=path.join(out,'studio.json');if(studioExisted)fs.copyFileSync(studio,isolatedStudio);
process.env.YDL_CONTENT_OVERRIDES_PATH=path.join(out,'content.json');
process.env.YDL_PLAYER_CARD_STUDIO_PATH=apply?studio:isolatedStudio;
process.env.YDL_PLAYER_PROFILE_ROOT=apply?path.resolve(root,'player_profiles'):path.join(out,'player_profiles');
const {REAL_PLAYERS}=await import('../versus/player-pool.js');
const {flushContentWrites}=await import('../versus/ydl-content-store.js');await flushContentWrites();
const {savePlayerCardProfile}=await import('../versus/player-card-studio-store.js');
const before=structuredClone(REAL_PLAYERS),byId=new Map(REAL_PLAYERS.map(p=>[p.id,p]));
// Validate the entire batch before saving the first image.
for(const e of entries){
 const p=byId.get(e.id);assert.ok(p,'Unknown player '+e.id);assert.equal(p.grade,e.grade,'Grade changed '+e.id);
 assert.equal(p.name,e.name,'Identity changed '+e.id);assert.notEqual(p.grade,'X');
 if(p.cardProfile){
  const archiveRestore=process.argv.includes('--restore-archived'),reviewReplacement=process.argv.includes('--replace-reviewed');
  assert.ok(archiveRestore||reviewReplacement,'Existing studio art must not be replaced by a missing-art batch: '+e.id);
  if(archiveRestore)assert.equal(e.source?.type,'existing-user-art','Replacement must be recovered user artwork');
  if(reviewReplacement)assert.ok(e.reviewReplacementReason,'Reviewed replacement requires a concrete reason');
  assert.ok(e.expectedCurrentSha256,'Archive replacement requires the reviewed current image hash');
  assert.equal(hash(path.resolve(root,'player_profiles/webp',p.cardProfile.optimizedFileName)),e.expectedCurrentSha256,'Current art changed since restore review');
 }
 assert.ok(!(p.grade==='A'?A_PLAYER_PROFILE_BY_PLAYER_ID[p.id]:p.grade==='S'?LEGENDARY_PROFILE_BY_PLAYER_ID[p.id]:null),'Existing legacy art must not be replaced: '+e.id);
 const file=path.resolve(root,e.imageFile??'');assert.ok(file.startsWith(root+path.sep),'Image must be in workspace');
 assert.equal(hash(file),e.sha256,'Image changed since review '+e.id);
}
const results=[];
for(const e of entries){const profile=await savePlayerCardProfile(e.id,{imageBuffer:fs.readFileSync(path.resolve(root,e.imageFile)),sourceFileName:path.basename(e.imageFile),...e.position});results.push({...e,cardProfile:profile});}
const selected=new Set(entries.map(p=>p.id));
for(let i=0;i<before.length;i++){
 const old=structuredClone(before[i]),next=structuredClone(REAL_PLAYERS[i]);
 if(selected.has(old.id)){delete old.cardProfile;delete next.cardProfile;}
 assert.deepEqual(next,old,'Only selected cardProfile fields may change');
}
assert.equal(hash(content),contentHash,'Live content overrides changed');
const report={applied:apply,count:results.length,unchangedPlayers:before.length-results.length,allGameplayFieldsUnchanged:true,xUnchanged:true,contentHashUnchanged:true,backupDirectory:out,players:results};
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
if(apply){
 const record={schemaVersion:2,frame:'shield-v1',appliedAt:new Date().toISOString(),backupDirectory:out,players:results.map(e=>({...e,imageFile:'player_profiles/webp/'+e.cardProfile.optimizedFileName,imageUrl:e.cardProfile.imageUrl,sha256:hash(path.resolve(root,'player_profiles/webp',e.cardProfile.optimizedFileName))}))};
 const recordPath=path.resolve(root,arg('--record')??`data/player-art-batches/${stamp}.json`);
 assert.ok(recordPath.startsWith(root+path.sep),'Record must be in workspace');
 fs.mkdirSync(path.dirname(recordPath),{recursive:true});
 fs.writeFileSync(recordPath,JSON.stringify(record,null,2));
}
console.log(JSON.stringify({applied:apply,count:results.length,unchangedPlayers:report.unchangedPlayers,allGameplayFieldsUnchanged:true,xUnchanged:true,result:path.join(out,'result.json')}));
