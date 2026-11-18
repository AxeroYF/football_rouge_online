import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Worker,isMainThread,workerData,parentPort} from 'node:worker_threads';
import {randomBytes,createHash} from 'node:crypto';
import {createArchive,openArchive} from '../versus/v4-stream/archive.js';
import {createStreamService} from '../versus/v4-stream/http-service.js';

if(!isMainThread){
  const {demoInput}=await import('../versus/v4/fixtures.js');
  const {createMatch,advanceMatch}=await import('../versus/v4/engine.js');
  const m=createMatch(workerData.input??demoInput({duration:workerData.duration,seed:'stream-lab'}),{frameInterval:1});
  const inputFingerprint=createHash('sha256').update(JSON.stringify({engineVersion:m.state.version,input:m.state.input})).digest('hex');
  const writer=await createArchive(workerData.directory,{matchId:'demo',engineVersion:m.state.version,inputFingerprint,teams:m.state.input.teams});
  let highWaterFrames=0,highWaterEvents=0;
  while(m.state.phase!=='finished'){
    advanceMatch(m,50);highWaterFrames=Math.max(highWaterFrames,m.frames.length);highWaterEvents=Math.max(highWaterEvents,m.events.length);
    await writer.appendMatch(m);parentPort.postMessage({type:'segment',through:m.state.time});
  }
  parentPort.postMessage({type:'complete',score:m.state.score,segments:writer.manifest.segments.length,highWaterFrames,highWaterEvents});
}

export async function startV4StreamLab({port=4315,duration=180,releaseRate=4,manualPublication=false,input=null}={}){
  const output=fileURLToPath(new URL('../outputs/v4-stream-20261117/',import.meta.url));await fs.mkdir(output,{recursive:true});
  const temporary=await fs.mkdtemp(path.join(output,'lab-')),directory=path.join(temporary,'archive');
  const worker=new Worker(new URL(import.meta.url),{workerData:{directory,duration,input}});let producerError=null,production=null;
  worker.on('error',error=>{producerError=error;});worker.on('message',value=>{if(value.type==='complete')production=value;});
  await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
  const archive=await openArchive(directory),tokens=new Map(),sessions=Object.fromEntries(['spectator','home','away'].map((role,i)=>{
    const token=randomBytes(24).toString('hex');tokens.set(token,{subject:`lab-${role}`,ownerSide:i===0?null:i-1});return [role,token];
  }));
  const service=createStreamService({authorize:async req=>tokens.get((req.headers.authorization??'').replace(/^Bearer /,''))??null});service.register('demo',archive);
  let started=Date.now();
  const repo=fileURLToPath(new URL('../',import.meta.url));
  const staticFiles=new Map([
    ['/','versus/v4-stream/lab/index.html'],['/lab/app.js','versus/v4-stream/lab/app.js'],['/lab/style.css','versus/v4-stream/lab/style.css'],
    ...['playback','publisher','codec'].map(name=>[`/v4-stream/${name}.js`,`versus/v4-stream/${name}.js`]),
    ...['replay','world','period-clock'].map(name=>[`/v4/${name}.js`,`versus/v4/${name}.js`])
  ]);
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/lab-sessions'){
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(sessions));return;
      }
      if(req.method==='GET'&&url.pathname==='/lab-info'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({realSnapshot:Boolean(input?.sourceFingerprint),scope:input?.sourceFingerprint?'真实球队只读影子演练':'合成直播演练'}));return;}
      if(url.pathname.startsWith('/v4/matches/')){
        await archive.refresh();if(!manualPublication){const produced=archive.manifest.segments.at(-1)?.through??-1;archive.publishUntil(Math.max(archive.publishedThrough,Math.min(produced,(Date.now()-started)/1000*releaseRate)));}
        if(await service.handle(req,res))return;
      }
      const name=staticFiles.get(url.pathname);if(!name||req.method!=='GET'){res.writeHead(404);res.end();return;}
      const data=await fs.readFile(path.join(repo,name));res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(name)]+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"});res.end(data);
    }catch{res.writeHead(503);res.end('Stream unavailable');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,directory,sessions,archive,get production(){return production;},get producerError(){return producerError;},
    async publishUntil(time){await archive.refresh();archive.publishUntil(time);},
    async stop(){await worker.terminate();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
if(isMainThread&&process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const lab=await startV4StreamLab();console.log(`V4 流式演练：${lab.url} · 合成阵容，演练身份仅用于本机验证`);
}
