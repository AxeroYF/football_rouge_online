import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
async function sources(directory,recursive=true){
  const entries=await readdir(directory,{withFileTypes:true});
  return (await Promise.all(entries.map(entry=>entry.isDirectory()
    ? recursive?sources(path.join(directory,entry.name)):[]
    : /\.(?:mjs|js)$/.test(entry.name)?[path.join(directory,entry.name)]:[]))).flat();
}
const files=[...await sources(root,false),...(await Promise.all(['client','shared','server','engine'].map(name=>sources(path.join(root,name))))).flat()].sort();
const failures=[];
async function worker(){
  for(let file;(file=files.pop());){
    await new Promise(resolve=>{
      const child=spawn(process.execPath,['--check',file],{cwd:root,stdio:['ignore','ignore','pipe'],windowsHide:true});
      let output='';child.stderr.on('data',chunk=>output+=chunk);
      child.once('error',error=>{failures.push(`${file}: ${error.message}`);resolve();});
      child.once('close',code=>{if(code!==0)failures.push(`${file}: ${output}`);resolve();});
    });
  }
}
const count=files.length;
await Promise.all(Array.from({length:4},worker));
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log(`Syntax checked ${count} runtime modules`);
