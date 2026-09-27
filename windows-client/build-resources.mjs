import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MAP_ASSET_HASHES} from '../shared/config/map-assets.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(here),seed=path.join(here,'seed');
const manifestOnly=process.argv.includes('--manifest-only');
if(!manifestOnly)await fs.mkdir(path.join(seed,'objects'),{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=[];
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else files.push(p);}}
await walk(path.join(root,'assets'));
files.push(...Object.keys(MAP_ASSET_HASHES).filter(p=>!p.startsWith('assets/')).map(p=>path.join(root,p)));
const entries=[];
for(const p of files){const rel=path.relative(root,p).replaceAll('\\','/');if(!MAP_ASSET_HASHES[rel]&&!/\.(png|jpe?g|webp|svg|ico|woff2?|glb)$/i.test(rel))continue;
 const bytes=await fs.readFile(p),sha256=hash(bytes),core=Boolean(MAP_ASSET_HASHES[rel]);
 if(core&&sha256!==MAP_ASSET_HASHES[rel])throw Error('Stale map hash: '+rel);
 entries.push({path:rel,sha256,bytes:bytes.length,core});if(!manifestOnly&&(core||!rel.startsWith('assets/map-relief/')))await fs.writeFile(path.join(seed,'objects',sha256),bytes);
}
entries.sort((a,b)=>a.path.localeCompare(b.path));
const manifest={schemaVersion:1,version:hash(JSON.stringify(entries)),entries};
const text=JSON.stringify(manifest);
if(!manifestOnly){
 const codeFiles=files.filter(p=>path.relative(root,p).replaceAll('\\','/').startsWith('assets/vendor/'));
 for(const folder of ['client','shared','styles','engine']){
  const before=files.length;await walk(path.join(root,folder));codeFiles.push(...files.slice(before));
 }
 for(const e of await fs.readdir(root,{withFileTypes:true}))if(e.isFile()&&/\.(js|css)$/.test(e.name))codeFiles.push(path.join(root,e.name));
 const codeEntries=[];
 for(const p of codeFiles){
  const rel=path.relative(root,p).replaceAll('\\','/');
  if(!/\.(js|mjs|css)$/.test(rel)||rel.startsWith('shared/account-import/'))continue;
  const bytes=await fs.readFile(p),sha256=hash(bytes);
  codeEntries.push({path:rel,sha256,bytes:bytes.length,core:false});
  await fs.writeFile(path.join(seed,'objects',sha256),bytes);
 }
 const bundled={...manifest,entries:[...entries,...codeEntries]};
 await fs.writeFile(path.join(seed,'manifest.json'),JSON.stringify(bundled));
 console.log(JSON.stringify({bundledCode:codeEntries.length,bundledArtBytes:entries.filter(e=>e.core||!e.path.startsWith('assets/map-relief/')).reduce((n,e)=>n+e.bytes,0)}));
}
await fs.writeFile(path.join(root,'assets/data/desktop-resources.json'),text);
console.log(JSON.stringify({files:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0),seedBytes:entries.filter(e=>e.core).reduce((n,e)=>n+e.bytes,0)}));
