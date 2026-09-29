import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const ORIGIN='https://yellowdogsleague.online';
const codePath=p=>!(p.endsWith('.mjs')&&!p.includes('/'))&&!p.split('/').some(x=>!x||x.startsWith('.'))&&!p.includes('\\')&&!p.startsWith('shared/account-import/')&&/^(?:(?:client|shared|styles|engine|assets\/vendor)\/[^?#:\x00-\x1f]+|[^/?:#]+)\.(?:js|mjs|css)$/.test(p);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function validateManifest(value){
 if(value?.schemaVersion!==1||!Array.isArray(value.entries)||value.entries.length>50000)throw Error('资源清单格式无效');
 const seen=new Set();
 for(const e of value.entries){if((!codePath(e.path)&&(!/^(assets\/|shared\/config\/)[^\\?#:\x00-\x1f]+$/.test(e.path)||e.path.split('/').some(p=>p==='..'||p.startsWith('.'))||!/[.](json|geojson|bin|png|jpe?g|svg|webp|ico|glb|woff2?)$/i.test(e.path)))||!/^[a-f0-9]{64}$/.test(e.sha256)||!Number.isSafeInteger(e.bytes)||e.bytes<0||e.bytes>128*1024*1024||seen.has(e.path))throw Error('资源清单包含无效条目');seen.add(e.path);}
 return value;
}
export class ResourceCache{
 constructor({directory,seed,fetchImpl=fetch,report=()=>{}}){Object.assign(this,{directory,seed,fetchImpl,report});this.pending=new Map();this.entries=new Map();this.known=new Map();this.hits=0;this.downloads=0;this.verified=new Set();this.memory=new Map();this.memoryBytes=0;}
 async init(){await fs.mkdir(path.join(this.directory,'objects'),{recursive:true});const manifest=validateManifest(JSON.parse(await fs.readFile(path.join(this.seed,'manifest.json'),'utf8')));this.remember(manifest);try{this.remember(validateManifest(JSON.parse(await fs.readFile(path.join(this.directory,'manifest.json'),'utf8'))));}catch(error){if(error.code!=='ENOENT')this.report({phase:'fallback',message:'本地资源清单需重新同步，随包地图仍可使用。'});}}
 remember(m){for(const e of m.entries){this.known.set(e.path+'?'+e.sha256,e);if(codePath(e.path))this.known.set(e.path+'?'+e.sha256.slice(0,20),e);}}
 entry(url){
  try{
   const u=new URL(url);if(u.origin!==ORIGIN)return null;
   const p=decodeURIComponent(u.pathname).replace(/^\/versus\//,'/').slice(1),v=u.searchParams.get('v');
   if([...u.searchParams.keys()].some(k=>k!=='v')||u.searchParams.getAll('v').length>1)return null;
   if(v?.startsWith('sha256-')){
    const digest=v.slice(7);const exact=this.known.get(p+'?'+digest);if(exact)return exact;
    if(codePath(p)&&/^(?:[a-f0-9]{20}|[a-f0-9]{64})$/.test(digest)){
     return {path:p,sha256:digest,bytes:null};
    }
    return null;
   }
   // Legacy admin uploads overwrite the same URL without updating the release manifest.
   if(v||p.startsWith('assets/player-profiles/admin/'))return null;
   return this.entries.get(p)??null;
  }catch{return null;}
 }
 retain(key,bytes){
  if(bytes.length>4*1024*1024)return;
  if(this.memory.has(key)){this.memoryBytes-=this.memory.get(key).length;this.memory.delete(key);}
  this.memory.set(key,bytes);this.memoryBytes+=bytes.length;
  while(this.memoryBytes>32*1024*1024){const first=this.memory.keys().next().value;this.memoryBytes-=this.memory.get(first).length;this.memory.delete(first);}
 }
 async local(e){
  const remembered=this.memory.get(e.sha256);if(remembered){this.retain(e.sha256,remembered);return remembered;}
  for(const dir of [this.directory,this.seed]){
   const p=path.join(dir,'objects',e.sha256);
   try{const b=await fs.readFile(p);if((e.bytes===null||b.length===e.bytes)&&(this.verified.has(p)||hash(b).startsWith(e.sha256))){this.verified.add(p);this.retain(e.sha256,b);return b;}}
   catch(error){if(error.code!=='ENOENT')throw error;}
  }return null;
 }
 async get(e,{signal,timeoutMs=15000}={}){signal?.throwIfAborted();const cached=await this.local(e);signal?.throwIfAborted();if(cached){this.hits++;return cached;}const existing=this.pending.get(e.sha256);if(existing&&!existing.signal.aborted)return existing;
 const downloadSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
 const task=(async()=>{try{
  const response=await this.fetchImpl(ORIGIN+'/'+e.path+'?v=sha256-'+e.sha256,{signal:downloadSignal,redirect:'error',cache:'no-store'});if(!response.ok)throw Error('资源下载 HTTP '+response.status);
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>(e.bytes??16*1024*1024))throw Error('资源大小超出清单');chunks.push(chunk);this.report({phase:'download',path:e.path,bytes:size,total:e.bytes});}
  downloadSignal.throwIfAborted();const b=Buffer.concat(chunks);if((e.bytes!==null&&b.length!==e.bytes)||!hash(b).startsWith(e.sha256))throw Error('资源校验失败：'+e.path);
  const dest=path.join(this.directory,'objects',e.sha256),temp=dest+'.'+crypto.randomUUID()+'.part';await fs.writeFile(temp,b);try{await fs.rename(temp,dest);}finally{await fs.rm(temp,{force:true});}this.verified.add(dest);this.downloads++;this.retain(e.sha256,b);return b;
 }catch(error){throw error;}})().finally(()=>{if(this.pending.get(e.sha256)===task)this.pending.delete(e.sha256);});task.signal=downloadSignal;this.pending.set(e.sha256,task);return task;
 }
 async update({prefetch=true}={}){
  const response=await this.fetchImpl(ORIGIN+'/assets/data/desktop-resources.json',{cache:'no-cache',signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('线上资源清单尚未就绪（HTTP '+response.status+'）');
  const m=validateManifest(await response.json());this.remember(m);const core=m.entries.filter(e=>e.core);let done=0,index=0;
  const workers=prefetch?await Promise.allSettled(Array.from({length:3},async()=>{while(index<core.length){const e=core[index++];await this.get(e);this.report({phase:'prepare',done:++done,total:core.length});}})):[];
  const failed=workers.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  const next=path.join(this.directory,'manifest.next.json');await fs.writeFile(next,JSON.stringify(m));await fs.rename(next,path.join(this.directory,'manifest.json'));this.entries=new Map(m.entries.map(e=>[e.path,e]));await this.prune();return m;
 }
 async prune(limit=1024*1024*1024){const dir=path.join(this.directory,'objects'),files=[];for(const name of await fs.readdir(dir)){if(!/^(?:[a-f0-9]{20}|[a-f0-9]{64})$/.test(name))continue;const p=path.join(dir,name),s=await fs.stat(p);files.push({p,bytes:s.size,time:s.mtimeMs});}let size=files.reduce((n,f)=>n+f.bytes,0);for(const f of files.sort((a,b)=>a.time-b.time)){if(size<=limit)break;await fs.rm(f.p,{force:true});this.verified.delete(f.p);size-=f.bytes;}}
 async clear(){if(this.pending.size)throw Error('资源下载进行中，请稍后再试');const dir=path.join(this.directory,'objects');for(const name of await fs.readdir(dir)){if(/^(?:[a-f0-9]{20}|[a-f0-9]{64})(?:\.[a-f0-9-]+\.part)?$/.test(name))await fs.rm(path.join(dir,name),{force:true});}this.verified.clear();this.memory.clear();this.memoryBytes=0;}
 async stats(){let bytes=0;for(const n of await fs.readdir(path.join(this.directory,'objects'))){bytes+=(await fs.stat(path.join(this.directory,'objects',n))).size;}return {bytes,hits:this.hits,downloads:this.downloads};}
 async repair(){
  this.verified.clear();this.memory.clear();this.memoryBytes=0;let removed=0;
  for(const name of await fs.readdir(path.join(this.directory,'objects'))){
   if(!/^(?:[a-f0-9]{20}|[a-f0-9]{64})$/.test(name))continue;
   const p=path.join(this.directory,'objects',name),bytes=await fs.readFile(p);
   if(!hash(bytes).startsWith(name)){await fs.rm(p,{force:true});removed++;}
  }return removed;
 }
}
export const contentType=p=>({js:'text/javascript',mjs:'text/javascript',css:'text/css',woff:'font/woff',ico:'image/x-icon',json:'application/json',geojson:'application/geo+json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',woff2:'font/woff2',glb:'model/gltf-binary'})[p.split('.').at(-1)]??'application/octet-stream';
