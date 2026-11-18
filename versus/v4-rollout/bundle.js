import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=data=>createHash('sha256').update(data).digest('hex');
export const bundleDigest=files=>hash(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))));
const within=(root,name)=>{const file=path.resolve(root,name),relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('引擎包路径越界');return file;};

export async function createEngineBundle(directory,{sourceRoot,engineVersion,files,entry='versus/v4/engine.js'}){
  if(!engineVersion||!files?.[entry]||Object.values(files).some(value=>!/^[a-f0-9]{64}$/.test(value)))throw new Error('引擎包清单无效');
  const root=path.resolve(directory);await fs.mkdir(root);
  for(const [name,expected] of Object.entries(files)){
    const data=await fs.readFile(within(sourceRoot,name));if(hash(data)!==expected)throw new Error('打包期间源码发生变化');
    const target=within(root,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx'});
  }
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({private:true,type:'module'}),{flag:'wx'});
  const manifest={format:'yffm-v4-engine-bundle-1',engineVersion,entry,files,sourceDigest:bundleDigest(files)};
  await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});return manifest;
}
export async function loadEngineBundle(directory,{engineVersion,sourceDigest}){
  const root=path.resolve(directory),manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
  if(manifest.format!=='yffm-v4-engine-bundle-1'||manifest.engineVersion!==engineVersion||manifest.sourceDigest!==sourceDigest||bundleDigest(manifest.files)!==sourceDigest||!manifest.files[manifest.entry])throw new Error('锁定引擎包版本不一致');
  for(const [name,expected] of Object.entries(manifest.files))if(hash(await fs.readFile(within(root,name)))!==expected)throw new Error('锁定引擎包文件校验失败');
  const engine=await import(pathToFileURL(within(root,manifest.entry)).href);
  if(!['createMatch','advanceMatch','restoreCheckpoint','exportCheckpoint'].every(name=>typeof engine[name]==='function'))throw new Error('引擎包接口无效');
  return engine;
}
