import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts;mkdirSync('outputs/training-growth-20260909',{recursive:true});let log='',failed=false;
for(const [name,raw] of [['syntax',scripts.check.split(' && npm test')[0]],['pretest',scripts.pretest],['test',scripts.test],['three',scripts['test:three']]]){const cmd=raw.replaceAll('node --test ','node --test --test-concurrency=1 ');const result=spawnSync(cmd,{shell:true,windowsHide:true,encoding:'utf8',maxBuffer:30*1024*1024});log+='\n'+name+'\n'+result.stdout+result.stderr;console.log(name+' exit '+result.status+' '+(result.stdout?.match(/# tests \d+|# pass \d+|# fail \d+/g)||[]).join(', '));if(result.status!==0)failed=true;writeFileSync('outputs/training-growth-20260909/regression.log',log);}
process.exitCode=failed?1:0;
