import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {preflight,applyUpdate,rollbackUpdate} from './updater.mjs';
const bundle=path.dirname(fileURLToPath(import.meta.url)),app='/opt/yellowdogs-rougelite/app',data='/var/lib/yellowdogs-rougelite',backupRoot='/var/backups/yellowdogs-rougelite/hot-updates',service='yellowdogs-rougelite';
const run=(...args)=>execFileSync('systemctl',args,{encoding:'utf8'}).trim();
async function health(){for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:4380/healthz',{signal:AbortSignal.timeout(2000)});if(r.ok&&(await r.json()).status==='ok'&&run('is-active',service)==='active'){const page=await fetch('http://127.0.0.1:4380/versus/',{signal:AbortSignal.timeout(2000)});if(page.ok)return true;}}catch{}await new Promise(r=>setTimeout(r,1000));}return false;}
try{
 if(process.platform!=='linux'||process.getuid()!==0)throw Error('请使用 sudo 在 Linux 服务器运行');
 if(run('show',service,'--property=WorkingDirectory','--value')!==app)throw Error('服务工作目录与部署记录不匹配，请先核对');
 const env=fs.readFileSync('/etc/yellowdogs-rougelite.env','utf8');if(!/^DATA_DIR=\/?var\/lib\/yellowdogs-rougelite\s*$/m.test(env))throw Error('服务 DATA_DIR 与部署记录不匹配');
 const options={bundle,app,data,backupRoot,stop:()=>{run('stop',service);if(run('show',service,'--property=ActiveState','--value')==='active')throw Error('Service did not stop');},start:()=>run('start',service),health};
 const mode=process.argv[2]??'--check';
 if(mode==='--check'){const m=preflight(options);console.log(`检查通过：${m.version}，${m.files.length} 个文件；未修改服务器。`);}
 else if(mode==='apply'){if(run('show',service,'--property=ActiveState','--value')!=='active')throw Error('更新前服务必须正常运行；请先检查现有服务');const result=await applyUpdate(options);console.log('回滚指令：sudo bash '+JSON.stringify(path.join(bundle,'update.sh'))+' rollback '+JSON.stringify(result.backup));}
 else if(mode==='rollback'&&process.argv[3])await rollbackUpdate({...options,backup:path.resolve(process.argv[3])});
 else throw Error('用法：update.sh --check | apply | rollback /备份目录');
}catch(e){console.error(e.message);process.exitCode=1;}
