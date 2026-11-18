import fs from 'node:fs/promises';
import path from 'node:path';
import {createCanonicalStreamHost} from './canonical-host.js';
import {openArchive} from '../v4-stream/archive.js';
import {handlePreviewAssets} from './preview-assets.js';
import {createBroadcastSummary} from './broadcast-summary.js';

// Register the committed round before workers create their archives. Lazy opens
// occur only behind the existing account authorization and request limits.
export async function openScheduledPreviewHost({root,rooms,league,enabled=false,now=Date.now,lifecycle=null,scheduled=false}){
  if(enabled!==true)return createCanonicalStreamHost();
  const directory=await fs.realpath(root);
  if(scheduled){
    if(directory!==(await fs.realpath(league.statePath))+'.v4-schedule')throw new Error('录像与赛程目录不匹配');
  }else if(JSON.parse(await fs.readFile(path.join(directory,'v4-local-storage.json'),'utf8')).format!=='yffm-v4-canonical-local-settlement-1')throw new Error('动态预览仅允许标记本地副本');
  const host=createCanonicalStreamHost({enabled:true,rooms,league,now,lifecycle,requestsPerMinute:600,maxConcurrent:16}),rounds=new Map();
  return {
    enabled:true,scope:scheduled?'scheduled':'shadow-preview',
    registerRound(round,{publicWatch=false,allowedAccountIds=[]}={}){
      if(!/^[a-f0-9]{64}$/.test(round?.key)||!Number.isSafeInteger(round.startedAt)||!Number.isFinite(round.releaseRate)||round.releaseRate<.25||round.releaseRate>64||!round.enginePin||!/^[a-f0-9]{64}$/.test(round.enginePin.sourceDigest)||!Array.isArray(round.tasks)||round.tasks.length<1||round.tasks.length>16)throw new Error('动态预览轮次配置无效');
      const startAt=round.startedAt,releaseRate=round.releaseRate,competition=round.competition??'league';
      if(!['league','cup'].includes(competition))throw new Error('动态预览赛事类型无效');
      const entries=round.tasks.map(task=>{
        const envelope=task.envelope,teams=envelope?.input?.teams?.map(({id,name})=>({id,name}));
        if(!/^[a-zA-Z0-9_-]{1,100}$/.test(task.fixture?.id)||envelope?.engineVersion!==round.enginePin.engineVersion||!/^[a-f0-9]{64}$/.test(envelope.fingerprint)||teams?.length!==2)throw new Error('动态预览比赛身份无效');
        let competitionInfo=null;
        if(competition==='cup'){
          const event=task.context?.event,aggregate=envelope.input.competition?.aggregate;
          if(!['league','swiss','roundOf16','quarterfinals','semifinals','final'].includes(event?.stage)||![1,2].includes(event?.leg)||!Array.isArray(aggregate)||aggregate.length!==2||aggregate.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('杯赛公开赛制无效');
          competitionInfo={kind:'cup',stage:event.stage,leg:event.leg,aggregate:[...aggregate]};
        }
        return {matchId:task.fixture.id,engineVersion:envelope.engineVersion,inputFingerprint:envelope.fingerprint,sourceDigest:round.enginePin.sourceDigest,teams,competition:competitionInfo};
      });
      const identity=JSON.stringify({entries,competition,startAt:round.startedAt,releaseRate:round.releaseRate,publicWatch,allowedAccountIds});
      if(rounds.has(round.key)){if(rounds.get(round.key).identity!==identity)throw new Error('预览轮次已经锁定');return;}
      if([...rounds.values()].reduce((n,r)=>n+r.ids.length,0)+entries.length>16)throw new Error('预览保留比赛已满，请先移除旧轮次');
      const registered=[];
      try{
        for(const entry of entries){
          const summary=createBroadcastSummary(round.tasks.find(task=>task.fixture.id===entry.matchId).envelope.input);
          const folder=path.join(directory,competition+'-queue-'+round.key,'jobs',entry.matchId,'archive');let archive=null,opening=null;
          async function open(){
            try{
              const real=await fs.realpath(folder),relative=path.relative(directory,real);
              if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('动态归档越出标记副本');
              const reader=await openArchive(real),manifest=reader.manifest;
              for(const key of ['matchId','engineVersion','inputFingerprint','sourceDigest'])if(manifest[key]!==entry[key])throw new Error('动态归档与轮次锁定不一致');
              if(JSON.stringify(manifest.teams)!==JSON.stringify(entry.teams))throw new Error('动态归档球队不一致');
              archive=reader;
            }catch(error){if(error.code!=='ENOENT')throw error;}
          }
          const pendingHead=()=>({matchId:entry.matchId,engineVersion:entry.engineVersion,teams:structuredClone(entry.teams),publishedThrough:-1,segments:[],complete:false});
          host.register({matchId:entry.matchId,homeId:entry.teams[0].id,awayId:entry.teams[1].id,publicWatch,allowedAccountIds},{
            get manifest(){return archive?.manifest??{...structuredClone(entry),segments:[],complete:false};},
            get publishedThrough(){return archive?.publishedThrough??-1;},
            publishedHead(){return {...(archive?.publishedHead()??pendingHead()),competition:structuredClone(entry.competition)};},
            read(index,ownerSide){return archive?.read(index,ownerSide)??null;},
            broadcast(){return summary(archive,{...(archive?.publishedHead()??pendingHead()),competition:entry.competition});},
            async refresh(){
              if(!archive){opening??=open().finally(()=>{opening=null;});await opening;}
              if(!archive)return;
              await archive.refresh({snapshot:false});
              archive.publishUntil(Math.max(archive.publishedThrough,Math.min(archive.producedThrough,Math.max(-1,(now()-startAt)/1000*releaseRate))));
            },
          });registered.push(entry.matchId);
        }
        rounds.set(round.key,{identity,ids:registered});
      }catch(error){registered.forEach(id=>host.unregister(id));throw error;}
    },
    unregisterRound(key){for(const id of rounds.get(key)?.ids??[])host.unregister(id);rounds.delete(key);},
    async handle(request,response){
      if(await handlePreviewAssets(request,response))return true;
      const route=/^\/v4\/matches\/([a-zA-Z0-9_-]{1,100})\//.exec(new URL(request.url,'http://localhost').pathname);
      if(!route||scheduled&&!Array.from(rounds.values()).some(round=>round.ids.includes(route[1])))return false;
      response.setHeader('X-YFFM-V4-Scope',scheduled?'scheduled':'shadow-preview');return host.handle(request,response);
    },
  };
}
