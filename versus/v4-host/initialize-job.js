import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createArchive} from '../v4-stream/archive.js';
import {createSandboxJournal} from '../v4-rollout/sandbox-journal.js';
import {publishPreparedDirectory} from '../v4-stream/atomic-file.js';

// Prepare every initial record before publishing the directory name. A killed
// initializer leaves an unpublished staging directory, not a half-created job.
// Staging leftovers are retained for inspection; no existing directory is deleted.
export async function initializeShadowDirectory(directory,{job,pin,onPrepared=()=>{}}){
  if(job?.format!=='yffm-v4-shadow-job-1'||job.scope!=='shadow-only'||['fixtureId','engineVersion','sourceDigest','inputFingerprint'].some(key=>job[key]!==pin?.[key]))throw new Error('影子初始化身份不一致');
  const root=path.resolve(directory);
  try{await fs.lstat(root);throw Object.assign(new Error('影子任务目录已存在'),{code:'EEXIST'});}catch(error){if(error.code!=='ENOENT')throw error;}
  const staging=path.join(path.dirname(root),`.${path.basename(root)}.initializing-${randomUUID()}`);await fs.mkdir(staging);
  try{
    const journal=await createSandboxJournal(path.join(staging,'journal'),{scope:'shadow-only'});await journal.pin(pin);
    await createArchive(path.join(staging,'archive'),{matchId:job.fixtureId,engineVersion:job.engineVersion,sourceDigest:job.sourceDigest,inputFingerprint:job.inputFingerprint,teams:pin.input.teams});
    const file=await fs.open(path.join(staging,'job.json'),'wx');try{await file.writeFile(JSON.stringify(job));await file.sync();}finally{await file.close();}
    await onPrepared(staging);
    await publishPreparedDirectory(staging,root);
  }catch(error){error.stagingDirectory=staging;throw error;}
}
