import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {STREAM_FORMAT,encodeFrames,publicFrame,publicEvent} from './codec.js';
import {INITIAL_CURSOR} from './publisher.js';
import {replaceCommittedFile} from './atomic-file.js';

const ARCHIVE_FORMAT='yffm-v4-archive-1';
const views=[null,0,1];
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const filename=(index,side)=>`${String(index).padStart(6,'0')}-${side===null?'public':`owner${side}`}.json.gz`;
const sameCursor=(a,b)=>a.frame===b.frame&&a.event===b.event;
const validSide=side=>views.includes(side);
const validCursor=c=>c&&Number.isSafeInteger(c.frame)&&c.frame>=-1&&Number.isSafeInteger(c.event)&&c.event>=0;
async function writeUncommitted(file,data,resume=false){
  let handle;
  try{handle=await fs.open(file,'wx');}
  catch(error){
    if(!resume||error.code!=='EEXIST')throw error;
    const saved=await fs.readFile(file);
    if(saved.length>data.length||!saved.equals(data.subarray(0,saved.length)))throw new Error('未提交文件与锁定重演不一致');
    if(saved.length===data.length)return;
    // A killed write can leave a byte prefix, including half a UTF-8 character.
    // Only finish that exact deterministic prefix while holding producer ownership.
    handle=await fs.open(file,'r+');
    try{
      if((await handle.stat()).size!==saved.length)throw new Error('未提交文件在恢复期间发生变化');
      let offset=saved.length;
      while(offset<data.length){const {bytesWritten}=await handle.write(data,offset,data.length-offset,offset);if(bytesWritten<=0)throw new Error('未提交文件写入未推进');offset+=bytesWritten;}
      await handle.sync();
    }finally{await handle.close();}
    return;
  }
  try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
}
async function atomicJson(file,value,reusePending=false){
  const temporary=`${file}.pending`;
  await writeUncommitted(temporary,Buffer.from(JSON.stringify(value)),reusePending);
  await replaceCommittedFile(temporary,file,{maxRetries:32});
}

// Each segment contains three already-redacted independent packets. A directory
// is single-writer and immutable after finish; no caller-supplied file names.
export async function createArchive(directory,{matchId,engineVersion,inputFingerprint,teams=[],sourceDigest=null,replayExisting=false}){
  if(![matchId,engineVersion,inputFingerprint].every(v=>typeof v==='string'&&v.length>0&&v.length<=256))throw new Error('归档身份无效');
  if(sourceDigest!==null&&!/^[a-f0-9]{64}$/.test(sourceDigest)||replayExisting&&!sourceDigest)throw new Error('恢复归档需要锁定的引擎包指纹');
  const root=path.resolve(directory);
  if(!Array.isArray(teams)||teams.length!==0&&teams.length!==2||teams.some(t=>typeof t.id!=='string'||typeof t.name!=='string'))throw new Error('归档球队信息无效');
  const manifest={format:ARCHIVE_FORMAT,matchId,engineVersion,inputFingerprint,sourceDigest,teams:teams.map(t=>({id:t.id,name:t.name})),segments:[],complete:false};
  let committed=[];
  if(replayExisting){
    const reader=await openArchive(root),saved=reader.manifest;
    if(saved.matchId!==matchId||saved.engineVersion!==engineVersion||saved.inputFingerprint!==inputFingerprint||saved.sourceDigest!==sourceDigest||JSON.stringify(saved.teams)!==JSON.stringify(manifest.teams))throw new Error('恢复归档与锁定比赛不一致');
    committed=saved.segments;
  }else{await fs.mkdir(root);await atomicJson(path.join(root,'manifest.json'),manifest);} // refuse overwrite
  let cursor={...INITIAL_CURSOR},base=null,busy=false,failed=false;
  return {
    get manifest(){return structuredClone(manifest);},
    async appendMatch(match){
      if(busy||failed||manifest.complete)throw new Error('归档不可继续写入');
      if(match.state.version!==engineVersion)throw new Error('归档引擎版本不一致');
      busy=true;
      try{
        const frames=match.frames.filter(f=>f!==base);
        if(!frames.length)return false;
        if(frames.length>4096)throw new Error('归档缓冲超过上限，应更频繁写入');
        let time=base?.time??-Infinity;
        for(const f of frames){if(!Number.isFinite(f.time)||f.time<time)throw new Error('归档帧顺序无效');time=f.time;}
        // Consume a contiguous ID prefix. An injury timestamp may differ from
        // a rounded frame by a floating-point ulp; filtering later events by
        // time independently would skip that injury and permanently lose IDs.
        const events=[];
        for(const event of match.events){if(event.id<=cursor.event)continue;if(event.time>time)break;events.push(event);}
        let eventId=cursor.event;
        for(const e of events){if(!Number.isSafeInteger(e.id)||e.id!==eventId+1)throw new Error('归档事件缺失');eventId=e.id;}
        const to={frame:cursor.frame+frames.length,event:eventId},index=manifest.segments.length;
        const complete=frames.at(-1).phase==='finished';
        if(complete&&match.events.some(e=>e.id>eventId))throw new Error('完赛帧遗漏事件');
        const entry={index,from:{...cursor},to,through:time,complete,files:[]};
        for(const ownerSide of views){
          const packet={format:STREAM_FORMAT,matchId,engineVersion,ownerSide,from:{...cursor},to,publishedThrough:time,through:time,hasBase:Boolean(base),
            frames:encodeFrames([...(base?[base]:[]),...frames].map(f=>publicFrame(f,ownerSide))),events:events.map(e=>publicEvent(e,ownerSide)).filter(Boolean),complete};
          const data=gzipSync(JSON.stringify(packet));
          if(data.length>4*1024*1024)throw new Error('归档分块过大');
          const file=filename(index,ownerSide),target=path.join(root,file);
          if(index<committed.length){if(hash(await fs.readFile(target))!==hash(data))throw new Error('重演与已提交归档内容不一致');}
          else await writeUncommitted(target,data,replayExisting);
          entry.files.push({ownerSide,bytes:data.length,sha256:hash(data)});
        }
        manifest.segments.push(entry);manifest.complete=complete;
        if(index<committed.length){if(JSON.stringify(entry)!==JSON.stringify(committed[index]))throw new Error('重演与已提交归档游标不一致');}
        else await atomicJson(path.join(root,'manifest.json'),manifest,replayExisting);
        cursor=to;base=frames.at(-1);
        // Preserve the last frame for the recorder's sampling clock. Simulation
        // state and RNG are untouched; only successfully committed data drains.
        match.frames=[base];match.events=match.events.filter(e=>e.id>eventId);
        return true;
      }catch(error){failed=true;throw error;}finally{busy=false;}
    }
  };
}

export async function openArchive(directory,{cacheBytes=2*1024*1024}={}){
  if(!Number.isSafeInteger(cacheBytes)||cacheBytes<0||cacheBytes>32*1024*1024)throw new Error('归档缓存上限无效');
  const root=path.resolve(directory),cache=new Map();let cached=0,published=-1,manifest,validatedBytes=null,refreshTail=Promise.resolve(),pendingRead=null;
  async function readManifest(){
    const bytes=await fs.readFile(path.join(root,'manifest.json'));
    // Polling head and the following segment often sees the same committed
    // manifest. Compare its exact bytes before parsing/validating the full
    // history again; timestamps and file sizes are not trusted cache keys.
    if(validatedBytes?.equals(bytes))return manifest;
    const next=JSON.parse(bytes.toString('utf8'));
    if(next.format!==ARCHIVE_FORMAT||!Array.isArray(next.segments)||next.segments.length>20000)throw new Error('归档清单无效');
    let cursor={...INITIAL_CURSOR},time=-1;
    for(const [i,s] of next.segments.entries()){
      if(s.index!==i||!validCursor(s.from)||!validCursor(s.to)||!sameCursor(s.from,cursor)||s.to.frame<=cursor.frame||s.to.event<cursor.event||!Number.isFinite(s.through)||s.through<time||s.files?.length!==3||s.files.some((f,j)=>f.ownerSide!==views[j]||!Number.isSafeInteger(f.bytes)||f.bytes<=0||f.bytes>4*1024*1024||!/^[a-f0-9]{64}$/.test(f.sha256)))throw new Error('归档分块清单损坏');
      cursor=s.to;time=s.through;
    }
    if(manifest&&(next.matchId!==manifest.matchId||next.engineVersion!==manifest.engineVersion||next.inputFingerprint!==manifest.inputFingerprint||next.sourceDigest!==manifest.sourceDigest||JSON.stringify(next.teams)!==JSON.stringify(manifest.teams)||next.segments.length<manifest.segments.length||JSON.stringify(next.segments.slice(0,manifest.segments.length))!==JSON.stringify(manifest.segments)||manifest.complete&&!next.complete))throw new Error('归档历史被修改');
    manifest=next;validatedBytes=bytes;return manifest;
  }
  // Keep validation ordered, with at most one read waiting behind the current
  // read. Calls can share a read only if that read has not started yet, so a
  // producer asking after commit never receives an earlier disk snapshot.
  function refresh({snapshot=true}={}){
    let pending=pendingRead;
    if(!pending){
      pending=refreshTail.then(()=>{pendingRead=null;return readManifest();});
      pendingRead=pending;refreshTail=pending.catch(()=>{});
    }
    return pending.then(value=>snapshot?structuredClone(value):undefined);
  }
  await refresh();
  return {
    refresh,
    get manifest(){return structuredClone(manifest);},
    get producedThrough(){return manifest.segments.at(-1)?.through??-1;},
    get publishedThrough(){return published;},
    get cachedBytes(){return cached;},
    publishedHead(){
      const released=manifest.segments.filter(segment=>segment.through<=published);
      return {matchId:manifest.matchId,engineVersion:manifest.engineVersion,teams:structuredClone(manifest.teams??[]),publishedThrough:published,
        segments:released.map(segment=>({index:segment.index,through:segment.through})),complete:released.at(-1)?.complete??false};
    },
    publishUntil(time){if(!Number.isFinite(time)||time<published||time>(manifest.segments.at(-1)?.through??-1))throw new Error('归档发布时间无效');published=time;},
    async read(index,ownerSide=null){
      if(!Number.isSafeInteger(index)||index<0||!validSide(ownerSide))throw new Error('归档读取参数无效');
      const entry=manifest.segments[index];
      if(!entry||entry.through>published)return null;
      const file=filename(index,ownerSide),meta=entry.files.find(f=>f.ownerSide===ownerSide);
      let data=cache.get(file);
      if(data){cache.delete(file);cache.set(file,data);}else{
        data=await fs.readFile(path.join(root,file));
        if(data.length!==meta.bytes||hash(data)!==meta.sha256)throw new Error('归档分块校验失败');
        if(data.length<=cacheBytes){while(cached+data.length>cacheBytes){const key=cache.keys().next().value;cached-=cache.get(key).length;cache.delete(key);}cache.set(file,data);cached+=data.length;}
      }
      const packet=JSON.parse(gunzipSync(data,{maxOutputLength:32*1024*1024}).toString('utf8'));
      if(packet.matchId!==manifest.matchId||packet.engineVersion!==manifest.engineVersion||packet.ownerSide!==ownerSide||!sameCursor(packet.from,entry.from)||!sameCursor(packet.to,entry.to)||packet.through!==entry.through)throw new Error('归档分块身份不一致');
      return {...packet,publishedThrough:published};
    }
  };
}
