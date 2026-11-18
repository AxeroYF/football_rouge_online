import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCanonicalStreamHost} from './canonical-host.js';
import {createBoundedReplayReaders} from './bounded-replay-readers.js';
import {handlePreviewAssets} from './preview-assets.js';
import {openArchive} from '../v4-stream/archive.js';

// Local historical index, bounded disk readers, shared retention leases. Adding
// a new round does not revoke viewers of the preceding round or load all files.
export async function openLocalReplayHost({enabled=false,root,rooms,league,lifecycle,now=Date.now,readerLimit=16}={}){
  if(!enabled)return createCanonicalStreamHost();
  if(typeof lifecycle?.acquire!=='function')throw new Error('历史录像宿主需要共用保留租约');
  const directory=await fs.realpath(root);if(JSON.parse(await fs.readFile(path.join(directory,'v4-local-storage.json'),'utf8')).format!=='yffm-v4-canonical-local-settlement-1')throw new Error('历史录像仅允许标记本地副本');
  const index=new Map(),rounds=new Map(),hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');let closed=false;
  const pool=createBoundedReplayReaders({limit:readerLimit,onEvict(id,reader){if(reader){const manifest=reader.manifest;index.get(id).checkpoint={count:manifest.segments.length,digest:hash(manifest.segments),complete:manifest.complete};}}});
  const host=createCanonicalStreamHost({enabled:true,rooms,league,now,maxMatches:4096,requestsPerMinute:600,maxConcurrent:16,lifecycle:{
    acquire(id){
      const releaseViewer=lifecycle.acquire(id);let releaseReader;
      try{releaseReader=pool.acquire(id,index.get(id).open);}catch(error){releaseViewer();throw error;}
      return ()=>{releaseReader();releaseViewer();};
    },
  }});
  function registerRound(round,{publicWatch=false,allowedAccountIds=[]}={}){
    if(closed)throw new Error('历史录像宿主已关闭');
    const competition=round.competition??'league';
    if(!['league','cup'].includes(competition)||!/^[a-f0-9]{64}$/.test(round.key)||!Number.isSafeInteger(round.startedAt)||!Number.isFinite(round.releaseRate)||round.releaseRate<.25||round.releaseRate>64||!/^[a-f0-9]{64}$/.test(round.enginePin?.sourceDigest??'')||!Array.isArray(round.tasks)||!round.tasks.length||round.tasks.length>16)throw new Error('历史录像赛程配置无效');
    const entries=round.tasks.map(task=>{
      const envelope=task.envelope,teams=envelope?.input?.teams?.map(({id,name})=>({id,name})),matchId=task.fixture?.id;
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(matchId)||envelope.engineVersion!==round.enginePin.engineVersion||!/^[a-f0-9]{64}$/.test(envelope.fingerprint)||teams?.length!==2)throw new Error('历史录像身份无效');
      let info=null;if(competition==='cup'){
        const event=task.context?.event,aggregate=envelope.input.competition?.aggregate;
        if(!['league','swiss','roundOf16','quarterfinals','semifinals','final'].includes(event?.stage)||![1,2].includes(event?.leg)||!Array.isArray(aggregate)||aggregate.length!==2||aggregate.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('历史杯赛格式无效');
        info={kind:'cup',stage:event.stage,leg:event.leg,aggregate:[...aggregate]};
      }
      return {matchId,engineVersion:envelope.engineVersion,inputFingerprint:envelope.fingerprint,sourceDigest:round.enginePin.sourceDigest,teams,competition:info};
    });
    const identity=JSON.stringify({entries,startedAt:round.startedAt,releaseRate:round.releaseRate,competition,publicWatch,allowedAccountIds});
    if(rounds.has(round.key)){if(rounds.get(round.key)!==identity)throw new Error('历史录像赛程已经锁定');return;}
    if(index.size+entries.length>4096||entries.some(entry=>index.has(entry.matchId))||new Set(entries.map(entry=>entry.matchId)).size!==entries.length)throw new Error('历史录像索引已满或比赛重复');
    const ids=[],startedAt=round.startedAt,releaseRate=round.releaseRate;
    try{
      for(const entry of entries){
        const folder=path.join(directory,competition+'-queue-'+round.key,'jobs',entry.matchId,'archive');
        const state={open:null,checkpoint:null,published:-1};
        const open=async()=>{
          try{
            if(await fs.realpath(folder)!==folder)throw new Error('历史录像目录存在重定向');
            const reader=await openArchive(folder),manifest=reader.manifest;
            for(const key of ['matchId','engineVersion','sourceDigest','inputFingerprint'])if(manifest[key]!==entry[key])throw new Error('历史录像与锁定输入不一致');
            if(JSON.stringify(manifest.teams)!==JSON.stringify(entry.teams))throw new Error('历史录像球队不一致');
            const checkpoint=state.checkpoint;if(checkpoint&&(manifest.segments.length<checkpoint.count||hash(manifest.segments.slice(0,checkpoint.count))!==checkpoint.digest||checkpoint.complete&&!manifest.complete))throw new Error('历史录像已验证片段被修改');return reader;
          }catch(error){if(error.code==='ENOENT')return null;throw error;}
        };
        state.open=open;index.set(entry.matchId,state);
        host.register({matchId:entry.matchId,homeId:entry.teams[0].id,awayId:entry.teams[1].id,publicWatch,allowedAccountIds},{
          manifest:{...entry},
          async refresh(){const reader=await pool.get(entry.matchId);if(!reader)return;await reader.refresh({snapshot:false});reader.publishUntil(Math.max(state.published,reader.publishedThrough,Math.min(reader.producedThrough,Math.max(-1,(now()-startedAt)/1000*releaseRate))));state.published=reader.publishedThrough;},
          publishedHead(){const reader=pool.peek(entry.matchId);return {...(reader?.publishedHead()??{matchId:entry.matchId,engineVersion:entry.engineVersion,teams:structuredClone(entry.teams),publishedThrough:-1,segments:[],complete:false}),competition:structuredClone(entry.competition)};},
          async read(segment,ownerSide){const reader=await pool.get(entry.matchId);return reader?reader.read(segment,ownerSide):null;},
        });ids.push(entry.matchId);
      }
      rounds.set(round.key,identity);
    }catch(error){for(const id of entries.map(entry=>entry.matchId))index.delete(id);for(const id of ids)host.unregister(id);throw error;}
  }
  return {
    enabled:true,scope:'local-historical-preview',registerRound,
    get registeredMatches(){return index.size;},get readerStats(){return pool.stats;},
    async handle(request,response){if(closed)return false;if(await handlePreviewAssets(request,response))return true;if(!/^\/v4\/matches\/[a-zA-Z0-9_-]{1,100}\//.test(new URL(request.url,'http://localhost').pathname))return false;response.setHeader('X-YFFM-V4-Scope','shadow-preview');return host.handle(request,response);},
    close(){pool.close();for(const id of index.keys())host.unregister(id);index.clear();rounds.clear();closed=true;},
  };
}
