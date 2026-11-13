import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const quick=process.argv.includes('--quick');
const extended=new Set(['league-shards.test.js','league.test.js','match-engine-v2.test.js','mirror-marketplace.test.js','season-simulation.test.js','ydl-league-engine-v2.test.js']);
const requested=process.argv.slice(2).filter(a=>a!=='--quick');
const discovered=fs.readdirSync('test').filter(f=>f.endsWith('.test.js')).sort();
const files=requested.length?requested.map(f=>path.basename(f)):discovered.filter(f=>!quick||!extended.has(f));
if(files.some(f=>!discovered.includes(f)))throw new Error('Unknown test file');
const out=path.join(root,'outputs','tests',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(out,{recursive:true});
const fixtures=fs.mkdtempSync(path.join(os.tmpdir(),'yffm1-tests-'));
const results=[],running=new Set();let cursor=0;
function stop(child){try{if(process.platform==='win32')execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGKILL');}catch{child.kill();}}
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{for(const child of running)stop(child);process.exit(1);});
async function worker(){
  while(cursor<files.length){
    const file=files[cursor++],dir=path.join(fixtures,file);fs.mkdirSync(dir);
    const log=fs.createWriteStream(path.join(out,file+'.tap'));
    const started=Date.now();let tail='',timedOut=false;
    const child=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap','test/'+file],{cwd:root,windowsHide:true,env:{...process.env,VERSUS_ACCOUNTS_PATH:path.join(dir,'accounts.json'),YELLOWDOGS_LEAGUE_PATH:path.join(dir,'league.json'),YDL_CONTENT_OVERRIDES_PATH:path.join(dir,'content.json'),YDL_PLAYER_CARD_STUDIO_PATH:path.join(dir,'studio.json')}});
    running.add(child);
    child.stdout.on('data',chunk=>{log.write(chunk);tail=(tail+chunk).slice(-12000);});
    child.stderr.on('data',chunk=>log.write(chunk));
    const timeout=setTimeout(()=>{timedOut=true;stop(child);},quick?60000:180000);
    const code=await new Promise((resolve,reject)=>{child.once('close',resolve);child.once('error',reject);});
    clearTimeout(timeout);running.delete(child);
    await new Promise(resolve=>log.end(resolve));
    const counts=Object.fromEntries([...tail.matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]));
    const result={file,status:timedOut?'timeout':code===0?'pass':'fail',code,durationMs:Date.now()-started,counts};results.push(result);
    console.log(`${result.status.toUpperCase()} ${file} (${result.durationMs}ms)`);
  }
}
try{await Promise.all([worker(),worker(),worker(),worker()]);}
finally{for(const child of running)stop(child);if(!fixtures.startsWith(path.resolve(os.tmpdir())+path.sep+'yffm1-tests-'))throw new Error('Unexpected test fixture path');fs.rmSync(fixtures,{recursive:true,force:true});}
const report={suite:quick?'quick':'all',extendedFiles:quick?[...extended]:[],results,passed:results.filter(r=>r.status==='pass').length,failed:results.filter(r=>r.status==='fail').length,timedOut:results.filter(r=>r.status==='timeout').length};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({files:files.length,passed:report.passed,failed:report.failed,timeout:report.timedOut,report:path.join(out,'report.json')}));
process.exitCode=report.failed||report.timedOut?1:0;
