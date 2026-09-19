import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { WONDER_IDS, createWonderModel, inspectWonderModel, disposeWonderModel } from '../client/wonders/wonder-models.js';
import {wonderPalette,WONDER_MATERIAL_VERSION} from '../client/wonders/wonder-materials.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
class NodeFileReader {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.({target:this});}).catch(error=>this.onerror?.(error));}
  readAsDataURL(blob){blob.arrayBuffer().then(a=>{this.result='data:'+blob.type+';base64,'+Buffer.from(a).toString('base64');this.onloadend?.({target:this});}).catch(error=>this.onerror?.(error));}
}
globalThis.FileReader??=NodeFileReader;
const source=JSON.parse((await fs.readFile(path.join(root,'assets/wonders/art-catalog.json'),'utf8')).replace(/^\uFEFF/,''));
if(source.items.length!==24||WONDER_IDS.length!==24)throw new Error('Expected 24 wonders');
const exporter=new GLTFExporter(),catalog=[];
for(const item of source.items){
  const files=[],levels=[];
  for(let lod=0;lod<3;lod++){
    const model=createWonderModel(item.assetId,{lod}),stats=inspectWonderModel(model);
    model.userData={...model.userData,name:item.name,region:item.region,prototype:item.prototypeLocation,reference:item.reference.url};
    const relative='assets/wonders/models/'+(lod?'lod'+lod+'/':'')+item.assetId+'.glb';
    const bytes=Buffer.from(await exporter.parseAsync(model,{binary:true,onlyVisible:true,trs:true}));
    await fs.mkdir(path.dirname(path.join(root,relative)),{recursive:true});await fs.writeFile(path.join(root,relative),bytes);
    files.push({lod,url:'./'+relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});levels.push({lod,...stats});disposeWonderModel(model);
  }
  catalog.push({id:item.id,assetId:item.assetId,name:item.name,region:item.region,location:item.prototypeLocation,reference:item.reference.url,signature:item.art.signature,palette:wonderPalette(item.assetId),files,levels,thumbnail:'./assets/wonders/thumbnails/'+item.assetId+'.webp'});
  console.log(item.id+' '+item.name+' · '+levels.map(x=>x.triangles).join(' / ')+' triangles');
}
const totalBytes=catalog.flatMap(x=>x.files).reduce((s,f)=>s+f.bytes,0);
const result={version:WONDER_MATERIAL_VERSION,format:'glTF 2.0 / GLB',status:'colored-models-generated',total:24,europe:16,southAmerica:8,totalBytes,items:catalog};
await fs.writeFile(path.join(root,'assets/wonders/catalog.json'),JSON.stringify(result,null,2)+'\n');
const out=path.join(root,'outputs/wonder-model-review');await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'build-report.json'),JSON.stringify({version:result.version,totalModels:72,totalBytes,levels:[0,1,2].map(lod=>({lod,totalTriangles:catalog.reduce((s,x)=>s+x.levels[lod].triangles,0),maxTriangles:Math.max(...catalog.map(x=>x.levels[lod].triangles))})),items:catalog.map(x=>({id:x.id,assetId:x.assetId,levels:x.levels,files:x.files}))},null,2)+'\n');
console.log('Exported 72 GLBs; '+(totalBytes/1048576).toFixed(2)+' MiB.');

