import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
async function discover(dir){const entries=await readdir(dir,{withFileTypes:true});const groups=await Promise.all(entries.map(e=>e.isDirectory()?discover(path.join(dir,e.name)):/\.test\.(?:mjs|js)$/.test(e.name)?[path.join(dir,e.name)]:[]));return groups.flat().sort();}
const files=await discover(path.join(root,'test'));
if(!files.length)throw Error('No tests discovered');
console.log(`Discovered ${files.length} test files`);
const child=spawn(process.execPath,['--test','--test-concurrency=4',...files.map(file=>path.relative(root,file))],{cwd:root,stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error(e);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
