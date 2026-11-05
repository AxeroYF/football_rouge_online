import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const excluded=new Set(['.git','.assessment','node_modules','outputs','dist','build','backups']);
function* walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(excluded.has(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isDirectory())yield*walk(file);else if(/\.(js|mjs|cjs)$/.test(file))yield file;}}
const files=[...walk('.')];let failed=0;
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});if(result.status!==0){failed++;console.error(file,result.stderr);}}
console.log(`Syntax: ${files.length-failed}/${files.length} passed`);process.exitCode=failed?1:0;
