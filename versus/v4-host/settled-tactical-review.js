import fs from 'node:fs/promises';
import path from 'node:path';
import {openArchive} from '../v4-stream/archive.js';
import {createMatchMetrics} from './match-metrics.js';

const cache=new Map();
const metricCache=new Map();
export async function readSettledMetrics(ref){
  // Verify current availability even when the numeric reconstruction is cached.
  const head=await readSettledReplay(ref,'head'),key=ref.statePath+'|'+ref.inputFingerprint;
  if(!metricCache.has(key)){
    const work=(async()=>{const metrics=createMatchMetrics();for(const s of head.segments){const packet=await readSettledReplay(ref,s.index);metrics.consume(packet.events);}return metrics.view(head.publishedThrough);})();
    metricCache.set(key,work);if(metricCache.size>8)metricCache.delete(metricCache.keys().next().value);
  }
  try{return await metricCache.get(key);}catch(error){metricCache.delete(key);throw error;}
}
const gone=()=>Object.assign(new Error('本场录像已不在保留范围'),{statusCode:410});
function verify(value,ref,id){
  if(value[id]!==ref.fixtureId||value.engineVersion!==ref.engineVersion||
    value.inputFingerprint!==ref.inputFingerprint||value.sourceDigest!==ref.sourceDigest)throw new Error('录像与已结算战报不匹配');
}
async function fileFor(ref,name){
  if(!['league','cup'].includes(ref.competition)||!/^[a-f0-9]{64}$/.test(ref.roundKey)||
    !/^v4-(?:cup-)?[a-f0-9]{32}-\d+$/.test(ref.fixtureId))throw new Error('无效的正式比赛录像绑定');
  const root=(await fs.realpath(ref.statePath))+'.v4-schedule';
  const file=path.join(root,ref.competition+'-queue-'+ref.roundKey,'jobs',ref.fixtureId,name);
  if(await fs.realpath(file)!==file)throw new Error('正式比赛录像路径不匹配');
  return file;
}

export async function readSettledReview(ref){
  try{
    const data=JSON.parse(await fs.readFile(await fileFor(ref,'tactical-review.json'),'utf8'));
    verify(data,ref,'fixtureId');
    if(data.version!==1||!Array.isArray(data.teams)||data.teams.length!==2)throw new Error('未知的战术复盘格式');
    let replayAvailable=true;
    try{await availableArchive(ref);}catch(error){if(error.statusCode!==410)throw error;replayAvailable=false;}
    return {fixtureId:ref.fixtureId,lineupSchemeId:data.lineupSchemeIds?.[ref.side]??null,plans:data.teams[ref.side],replayAvailable};
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
}

async function availableArchive(ref){
  let folder;
  try{folder=await fileFor(ref,'archive');}catch(error){if(error.code==='ENOENT')throw gone();throw error;}
  try{await fs.access(path.join(folder,'retired.json'));}catch(error){if(error.code==='ENOENT')return folder;throw error;}
  throw gone();
}

// Only settled reports can supply a reference. Each request rechecks the owner
// in the league service before reading an immutable, side-redacted stream.
export async function readSettledReplay(ref,segment){
  const file=await availableArchive(ref);
  const key=file+'|'+ref.inputFingerprint;
  let opening=cache.get(key);
  if(!opening){
    opening=openArchive(file,{cacheBytes:512*1024}).then(reader=>{
      const manifest=reader.manifest;
      verify(manifest,ref,'matchId');
      if(!manifest.complete||manifest.teams.some((team,i)=>team.id!==ref.teamIds[i]))throw new Error('录像未完赛或球队不匹配');
      reader.publishUntil(reader.producedThrough);
      return reader;
    });
  }
  cache.delete(key);cache.set(key,opening);
  if(cache.size>8)cache.delete(cache.keys().next().value);
  try{
    const reader=await opening;
    if(segment==='head')return {...reader.publishedHead(),ownerSide:ref.side,competition:ref.cup??null};
    if(!Number.isSafeInteger(segment)||segment<0)throw Object.assign(new Error('片段编号无效'),{statusCode:400});
    const packet=await reader.read(segment,ref.side);
    if(!packet)throw Object.assign(new Error('回放片段不存在'),{statusCode:404});
    return packet;
  }catch(error){if(cache.get(key)===opening)cache.delete(key);if(error.code==='ENOENT')throw gone();throw error;}
}
