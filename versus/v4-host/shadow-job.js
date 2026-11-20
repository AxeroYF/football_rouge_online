import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadEngineBundle} from '../v4-rollout/bundle.js';
import {openSandboxJournal} from '../v4-rollout/sandbox-journal.js';
import {createArchive} from '../v4-stream/archive.js';
import {createPlayerReportLedger} from './player-report.js';
import {initializeShadowDirectory} from './initialize-job.js';
import {createMatchTacticalReview} from './match-tactical-review.js';
import {replaceCommittedFile} from '../v4-stream/atomic-file.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const format='yffm-v4-shadow-job-1';
const read=file=>fs.readFile(file,'utf8').then(JSON.parse);

// This producer has no reference to the formal league service. Its only output
// is a private archive and an explicitly isolated journal, never a league save.
// Recovery replays the pinned input and verifies every already committed byte.
export async function runShadowJob({directory,bundleDirectory,sourceDigest,envelope,resume=false,tacticalReview=false,onCommitted=()=>{}}){
  if(envelope?.schema!=='yffm-v4-match-input-1'||!/^[a-zA-Z0-9_-]{1,100}$/.test(envelope.input?.fixtureId??'')||envelope.input.format!=='full'||envelope.coverage?.blockers?.length!==0)throw new Error('影子任务需要完整且无未覆盖能力的比赛输入');
  const {engineVersion,input,fingerprint}=envelope;
  if(hash({engineVersion,input})!==fingerprint)throw new Error('影子任务输入指纹无效');
  const engine=await loadEngineBundle(bundleDirectory,{engineVersion,sourceDigest});
  const match=engine.createMatch(input,{frameInterval:1});
  if(match.state.version!==engineVersion||hash({engineVersion,input:match.state.input})!==fingerprint)throw new Error('锁定内核与规范化输入不一致');
  const root=path.resolve(directory),job={format,scope:'shadow-only',fixtureId:input.fixtureId,engineVersion,sourceDigest,inputFingerprint:fingerprint,stepsPerChunk:50};
  const metadata=path.join(root,'job.json'),lockPath=path.join(root,'producer.lock');
  const pin={fixtureId:input.fixtureId,engineVersion,sourceDigest,inputFingerprint:fingerprint,input,selection:{fixtureId:input.fixtureId,primary:'legacy',shadow:true}};
  let exists=false;try{await fs.lstat(root);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(resume&&exists){if(JSON.stringify(await read(metadata))!==JSON.stringify(job))throw new Error('恢复任务与原锁定任务不一致');}
  else await initializeShadowDirectory(root,{job,pin});
  let lock;
  try{lock=await fs.open(lockPath,'wx');}catch(error){if(error.code==='EEXIST')throw new Error('影子任务已有生产者，禁止并发或自动抢锁');throw error;}
  try{
    await lock.writeFile(JSON.stringify({pid:process.pid,format,fixtureId:input.fixtureId}));await lock.sync();
    const journal=await openSandboxJournal(path.join(root,'journal'));await journal.pin(pin);
    const archiveDirectory=path.join(root,'archive');
    const writer=await createArchive(archiveDirectory,{matchId:input.fixtureId,engineVersion,sourceDigest,inputFingerprint:fingerprint,teams:input.teams,replayExisting:true});
    const ledger=createPlayerReportLedger(input,engineVersion),highWater={frames:0,events:0};
    const review=tacticalReview?createMatchTacticalReview(input,engine):null;
    // Older pinned jobs must reproduce their original archive bytes on resume.
    const publishAssist=input.publishGoalAssists ? (goal,assistId)=>{goal.assistId=assistId;} : undefined;
    while(match.state.phase!=='finished'){
      engine.advanceMatch(match,job.stepsPerChunk);
      highWater.frames=Math.max(highWater.frames,match.frames.length);highWater.events=Math.max(highWater.events,match.events.length);
      ledger.consume(match.events.filter(event=>event.id>ledger.cursor),publishAssist);
      review?.consume(match.frames,match.events);
      await writer.appendMatch(match);
      await onCommitted({time:match.state.time,segments:writer.manifest.segments.length});
      if(match.state.time>input.duration*3+1800)throw new Error('影子比赛超时');
    }
    const report=ledger.finish(match.state);
    if(review){
      const file=path.join(root,'tactical-review.json');
      await fs.writeFile(file+'.pending',JSON.stringify({version:1,fixtureId:input.fixtureId,engineVersion,
        inputFingerprint:fingerprint,sourceDigest,lineupSchemeIds:envelope.lineupSchemeIds,teams:review.finish()}));
      await replaceCommittedFile(file+'.pending',file);
    }
    const result={fixtureId:input.fixtureId,engineVersion,sourceDigest,inputFingerprint:fingerprint,score:[...match.state.score],report,settlementAllowed:false};
    await journal.complete(input.fixtureId,result);
    return {result,highWater,segments:writer.manifest.segments.length,directory:root};
  }finally{await lock.close();await fs.unlink(lockPath);}
}

export async function recoverShadowProducerLock(directory){
  const root=path.resolve(directory),job=await read(path.join(root,'job.json'));
  if(job.format!==format||job.scope!=='shadow-only')throw new Error('不是隔离影子任务');
  const file=path.join(root,'producer.lock'),owner=await read(file);
  if(owner.format!==format||owner.fixtureId!==job.fixtureId||!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw new Error('影子任务锁无效，需人工检查');
  try{process.kill(owner.pid,0);throw new Error('影子生产者仍在运行');}catch(error){if(error.code!=='ESRCH')throw error;}
  await fs.unlink(file);
}
