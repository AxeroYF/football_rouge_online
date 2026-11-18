import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {acquireDispatchLock} from './dispatch-store.js';
import {readCompletedShadowJob} from './shadow-settlement.js';
import {openArchive} from '../v4-stream/archive.js';
import {replaceCommittedFile} from '../v4-stream/atomic-file.js';
import {planReplayRetention} from './replay-retention-plan.js';
import {createReplayLifecycle} from './replay-lifecycle.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const format='yffm-v4-retired-replay-1',hex=/^[a-f0-9]{64}$/;
const payloadName=(index,side)=>`${String(index).padStart(6,'0')}-${side===null?'public':`owner${side}`}.json.gz`;

// Local only, explicitly invoked, single host owner. Keep manifest, pinned input,
// full result and canonical receipts; delete only exact checksummed frame files.
export async function openLocalReplayRetention({root,readLeague,now=Date.now,policy={},pinnedMatchIds=[]}){
  if(typeof readLeague!=='function'||!Array.isArray(pinnedMatchIds)||pinnedMatchIds.some(id=>!/^[a-zA-Z0-9_-]{1,100}$/.test(id)))throw new Error('录像保留配置无效');
  planReplayRetention({records:[],now:now(),policy});policy=structuredClone(policy);
  const directory=await fs.realpath(root),pinned=new Set(pinnedMatchIds);
  if(JSON.parse(await fs.readFile(path.join(directory,'v4-local-storage.json'),'utf8')).format!=='yffm-v4-canonical-local-settlement-1')throw new Error('录像清理仅允许标记本地副本');
  const unlock=await acquireDispatchLock(path.join(directory,'replay-retention.lock')),lifecycle=createReplayLifecycle({now});let closed=false,busy=false;
  async function checked(target,type='file'){
    const relative=path.relative(directory,target);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('录像路径越出标记副本');
    let cursor=directory;
    for(const part of relative.split(path.sep)){
      cursor=path.join(cursor,part);const stat=await fs.lstat(cursor);
      if(stat.isSymbolicLink()||cursor!==target&&!stat.isDirectory()||cursor===target&&(type==='directory'?!stat.isDirectory():!stat.isFile()))throw new Error('录像路径不是普通文件或目录');
    }
    if(await fs.realpath(target)!==target)throw new Error('录像路径包含重定向');return target;
  }
  async function readMarker(folder,digest,fixtureId){
    const file=path.join(folder,'retired.json');let bytes;
    try{bytes=await fs.readFile(await checked(file));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    const value=JSON.parse(bytes);
    if(value.format!==format||value.matchId!==fixtureId||value.manifestDigest!==digest||!Number.isSafeInteger(value.retiredAt)||typeof value.cleaned!=='boolean'||!hex.test(value.receiptDigest))throw new Error('录像过期记录与锁定身份不一致');
    return value;
  }
  async function inspect(){
    if(closed)throw new Error('录像保留器已关闭');
    const league=await readLeague(),rows=[],ids=new Set();
    for(const [competition,field,collection] of [['league','v4LocalLeagueRounds','rounds'],['cup','v4LocalCupEvents','events']]){
      for(const record of Object.values(league[field]?.[collection]??{})){
        if(!hex.test(record.key)||!Array.isArray(record.tasks))throw new Error('录像赛程索引无效');
        for(const task of record.tasks){
          const matchId=task.fixture?.id;
          if(!/^[a-zA-Z0-9_-]{1,100}$/.test(matchId)||ids.has(matchId))throw new Error('录像比赛标识无效或重复');ids.add(matchId);
          const job=path.join(directory,competition+'-queue-'+record.key,'jobs',matchId),folder=path.join(job,'archive'),manifestFile=path.join(folder,'manifest.json');let manifestBytes;
          try{manifestBytes=await fs.readFile(await checked(manifestFile));}catch(error){if(error.code==='ENOENT')continue;throw error;}
          const archive=await openArchive(folder,{cacheBytes:0}),manifest=archive.manifest,digest=hash(manifestBytes);
          if(hash(await fs.readFile(manifestFile))!==digest)throw new Error('录像清单正在变化，请稍后重试');
          if(manifest.matchId!==matchId||manifest.inputFingerprint!==task.envelope?.fingerprint||manifest.sourceDigest!==record.enginePin?.sourceDigest||manifest.engineVersion!==record.enginePin?.engineVersion)throw new Error('录像与锁定赛程不一致');
          const receipt=league.v4LocalSettlements?.receipts?.[matchId],expectedRelease=record.startedAt+Math.ceil(archive.producedThrough*1000/record.releaseRate);
          const settled=Boolean(manifest.complete&&manifest.segments.at(-1)?.complete&&record.status==='complete'&&receipt&&receipt.fixtureId===matchId&&receipt.engineVersion===manifest.engineVersion&&receipt.sourceDigest===manifest.sourceDigest&&receipt.inputFingerprint===manifest.inputFingerprint&&receipt.context?.binding?.roundKey===record.key&&receipt.releaseAt===expectedRelease&&hex.test(receipt.identityDigest));
          const marker=await readMarker(folder,digest,matchId);
          if(marker){if(!settled||marker.receiptDigest!==receipt.identityDigest)throw new Error('已过期录像缺少原结算回执');lifecycle.restoreExpired(matchId);}
          let producing=false;try{await fs.lstat(path.join(job,'producer.lock'));producing=true;}catch(error){if(error.code!=='ENOENT')throw error;}
          const bytes=manifest.segments.reduce((sum,segment)=>sum+segment.files.reduce((n,file)=>n+file.bytes,0),0);
          rows.push({matchId,bytes,endedAt:Number.isSafeInteger(receipt?.settledAt)?receipt.settledAt:Math.max(0,Math.ceil(expectedRelease)),settled:settled&&!producing,released:settled&&now()>=expectedRelease,pinned:pinned.has(matchId),viewing:lifecycle.viewing(matchId),manifestDigest:digest,job,folder,manifest,receipt,marker});
        }
      }
    }
    return rows;
  }
  async function writeMarker(row,value){
    await checked(row.folder,'directory');const file=path.join(row.folder,'retired.json'),temporary=path.join(row.folder,`retired.pending-${randomUUID()}`),handle=await fs.open(temporary,'wx');
    try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
    await replaceCommittedFile(temporary,file);
  }
  async function clean(row,marker){
    if(marker.cleaned)return 0;
    let removedBytes=0;
    for(const segment of row.manifest.segments)for(const meta of segment.files){
      const file=path.join(row.folder,payloadName(segment.index,meta.ownerSide));let data;
      try{data=await fs.readFile(await checked(file));}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(data.length!==meta.bytes||hash(data)!==meta.sha256)throw new Error('待清理录像分块校验失败，已保留现场');
      await checked(file);await fs.unlink(file);removedBytes+=data.length;
    }
    await writeMarker(row,{...marker,cleaned:true});return removedBytes;
  }
  async function exclusive(operation){if(closed||busy)throw new Error('录像保留器已关闭或繁忙');busy=true;try{return await operation();}finally{busy=false;}}
  try{await inspect();}catch(error){await unlock();throw error;}
  return {
    lifecycle,scope:'local-payload-retention-only',
    async plan(){return exclusive(async()=>{const rows=await inspect();return {...planReplayRetention({records:rows.filter(row=>!row.marker),now:now(),policy}),pendingCleanup:rows.filter(row=>row.marker&&!row.marker.cleaned).map(row=>row.matchId),metric:'compressed-frame-payload-bytes'};});},
    async sweep(){return exclusive(async()=>{
      let rows=await inspect(),removedBytes=0;const expired=[],skipped=[];
      for(const row of rows.filter(row=>row.marker&&!row.marker.cleaned))removedBytes+=await clean(row,row.marker);
      const plan=planReplayRetention({records:rows.filter(row=>!row.marker),now:now(),policy});
      for(const candidate of plan.expire){
        // Refresh receipts, producer state, policy and manifest before each
        // candidate. The lease gate then excludes requests during the commit.
        rows=await inspect();const row=rows.find(row=>row.matchId===candidate.matchId),fresh=planReplayRetention({records:rows.filter(row=>!row.marker),now:now(),policy});
        if(!row||row.manifestDigest!==candidate.manifestDigest||!fresh.expire.some(item=>item.matchId===candidate.matchId)){skipped.push(candidate.matchId);continue;}
        const outcome=await lifecycle.expire(row.matchId,async()=>{
          const {pinned:input,result}=await readCompletedShadowJob(row.job);
          if(input.fixtureId!==row.matchId||input.inputFingerprint!==row.manifest.inputFingerprint||result.sourceDigest!==row.manifest.sourceDigest)throw new Error('录像清理缺少可核验的结算证据');
          await checked(row.folder,'directory');if(hash(await fs.readFile(path.join(row.folder,'manifest.json')))!==row.manifestDigest)throw new Error('清理前录像清单已变化');
          await writeMarker(row,{format,matchId:row.matchId,manifestDigest:row.manifestDigest,receiptDigest:row.receipt.identityDigest,retiredAt:now(),cleaned:false});
        });
        if(!outcome.expired){skipped.push(row.matchId);continue;}
        expired.push(row.matchId);const marker=await readMarker(row.folder,row.manifestDigest,row.matchId);removedBytes+=await clean(row,marker);
      }
      return {scope:'local-payload-retention-only',expired,skipped,removedBytes};
    });},
    async close(){if(busy)throw new Error('录像清理仍在运行');if(closed)return;lifecycle.close();closed=true;await unlock();},
  };
}
