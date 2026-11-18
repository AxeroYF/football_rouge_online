import fs from 'node:fs/promises';
import path from 'node:path';
import {createCanonicalStreamHost} from './canonical-host.js';
import {openArchive} from '../v4-stream/archive.js';
import {handlePreviewAssets} from './preview-assets.js';

export async function openConfiguredStreamHost(configPath,{rooms,league,now=Date.now}={}){
  if(!configPath)return createCanonicalStreamHost();
  const root=await fs.realpath(path.dirname(path.resolve(configPath)));
  const config=JSON.parse(await fs.readFile(configPath,'utf8'));
  if(config.format!=='yffm-v4-stream-host-1'||config.scope!=='shadow-preview'||!Array.isArray(config.matches)||config.matches.length>16)throw new Error('V4发布清单格式无效，只允许影子预览');
  // 64x replay at two polls/second uses about 504 requests/minute for ten-second
  // chunks. Sixteen bounded in-flight reads accommodate ten simultaneous
  // viewers without rejecting bursts while archive I/O is outstanding.
  const host=createCanonicalStreamHost({enabled:true,rooms,league,requestsPerMinute:600,maxConcurrent:16});
  for(const entry of config.matches){
    if(typeof entry.archive!=='string'||path.isAbsolute(entry.archive)||!Number.isFinite(entry.startAt)||!Number.isFinite(entry.releaseRate)||entry.releaseRate<=0||entry.releaseRate>64||!/^[a-f0-9]{64}$/.test(entry.sourceDigest??'')||!/^[a-f0-9]{64}$/.test(entry.inputFingerprint??''))throw new Error('V4发布清单比赛配置无效');
    const directory=await fs.realpath(path.resolve(root,entry.archive)),relative=path.relative(root,directory);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('V4归档路径超出发布目录');
    const archive=await openArchive(directory),manifest=archive.manifest;
    if(manifest.engineVersion!==entry.engineVersion||manifest.sourceDigest!==entry.sourceDigest||manifest.inputFingerprint!==entry.inputFingerprint)throw new Error('V4发布清单与锁定归档不一致');
    // Refresh and release only inside the authenticated, rate/concurrency-limited
    // service path. Unauthenticated requests must not trigger archive disk I/O.
    host.register(entry,{
      get manifest(){return archive.manifest;},
      get publishedThrough(){return archive.publishedThrough;},
      publishedHead:archive.publishedHead,
      read:archive.read,
      async refresh(){
        await archive.refresh({snapshot:false});
        const produced=archive.producedThrough;
        archive.publishUntil(Math.max(archive.publishedThrough,Math.min(produced,Math.max(-1,(now()-entry.startAt)/1000*entry.releaseRate))));
      },
    });
  }
  return {enabled:true,scope:'shadow-preview',
    async handle(request,response){
      if(await handlePreviewAssets(request,response))return true;
      const route=/^\/v4\/matches\/([a-zA-Z0-9_-]{1,100})\//.exec(new URL(request.url,'http://localhost').pathname);
      if(!route)return false;
      response.setHeader('X-YFFM-V4-Scope','shadow-preview');return host.handle(request,response);
    }
  };
}
