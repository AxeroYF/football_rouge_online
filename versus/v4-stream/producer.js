import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {createMatch,advanceMatch} from '../v4/engine.js';
import {createArchive} from './archive.js';
import {loadEngineBundle} from '../v4-rollout/bundle.js';

// Server-only bounded recording. The result is private and must pass through
// the versioned result adapter before any host considers settlement.
async function produce(input,directory,{matchId,stepsPerChunk=50,onCommitted=()=>{},sourceDigest=null,replayExisting=false,engine,expectedVersion=null}={}){
  if(!Number.isSafeInteger(stepsPerChunk)||stepsPerChunk<1||stepsPerChunk>250)throw new Error('录制分块步数无效');
  const started=performance.now(),match=engine.createMatch(input,{frameInterval:1});
  if(expectedVersion&&match.state.version!==expectedVersion)throw new Error('锁定引擎包声明版本与实际内核不一致');
  const inputFingerprint=createHash('sha256').update(JSON.stringify({engineVersion:match.state.version,input:match.state.input})).digest('hex');
  const writer=await createArchive(directory,{matchId,engineVersion:match.state.version,inputFingerprint,teams:input.teams,sourceDigest,replayExisting});
  const highWater={frames:0,events:0,heapUsed:0,rss:0};
  while(match.state.phase!=='finished'){
    engine.advanceMatch(match,stepsPerChunk);const memory=process.memoryUsage();
    highWater.frames=Math.max(highWater.frames,match.frames.length);highWater.events=Math.max(highWater.events,match.events.length);
    highWater.heapUsed=Math.max(highWater.heapUsed,memory.heapUsed);highWater.rss=Math.max(highWater.rss,memory.rss);
    await writer.appendMatch(match);await onCommitted({through:writer.manifest.segments.at(-1).through,segments:writer.manifest.segments.length});
    if(match.state.time>input.duration*3+1800)throw new Error('录制比赛超时');
  }
  const manifest=writer.manifest;
  return {state:match.state,metrics:{elapsedMs:performance.now()-started,highWater,segments:manifest.segments.length,
    bytesByView:[null,0,1].map(side=>({side,bytes:manifest.segments.reduce((sum,s)=>sum+s.files.find(f=>f.ownerSide===side).bytes,0)})),inputFingerprint}};
}

export function produceArchive(input,directory,options={}){
  if(options.sourceDigest||options.replayExisting)throw new Error('恢复录制必须使用经过校验的锁定引擎包');
  return produce(input,directory,{...options,sourceDigest:null,replayExisting:false,engine:{createMatch,advanceMatch}});
}

export async function producePinnedArchive(input,directory,{bundleDirectory,engineVersion,sourceDigest,...options}){
  const engine=await loadEngineBundle(bundleDirectory,{engineVersion,sourceDigest});
  return produce(input,directory,{...options,sourceDigest,engine,expectedVersion:engineVersion});
}
