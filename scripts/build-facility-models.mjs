import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {FACILITY_ART_VERSION,FACILITY_ASSET_ITEMS} from '../shared/config/facility-art.mjs';
import {createFacilityModel,inspectFacilityModel,disposeFacilityModel} from '../client/facility-models/facility-models.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
class NodeFileReader{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}readAsDataURL(blob){blob.arrayBuffer().then(a=>{this.result='data:'+blob.type+';base64,'+Buffer.from(a).toString('base64');this.onloadend?.({target:this});}).catch(e=>this.onerror?.(e));}}
globalThis.FileReader??=NodeFileReader;const exporter=new GLTFExporter();
const filter=process.argv.find(a=>a.startsWith('--types='))?.slice(8).split(',');
if(filter?.some(type=>!FACILITY_ASSET_ITEMS.some(i=>i.type===type)))throw new Error('Unknown facility type');
const selected=FACILITY_ASSET_ITEMS.filter(i=>!filter||filter.includes(i.type));
const existing=filter?JSON.parse(await fs.readFile(path.join(root,'assets/facilities/catalog.json'),'utf8')).items:[];
const byId=new Map(existing.map(i=>[i.assetId,i]));
await fs.mkdir(path.join(root,'outputs/facility-model-review'),{recursive:true});
for(const item of selected){const files=[],levels=[];for(let lod=0;lod<3;lod++){const model=createFacilityModel(item.assetId,{lod}),stats=inspectFacilityModel(model);const relative='assets/facilities/models/'+(lod?'lod'+lod+'/':'')+item.assetId+'.glb';const bytes=Buffer.from(await exporter.parseAsync(model,{binary:true,onlyVisible:true,trs:true}));await fs.mkdir(path.dirname(path.join(root,relative)),{recursive:true});await fs.writeFile(path.join(root,relative),bytes);files.push({lod,url:'./'+relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});levels.push({lod,...stats});disposeFacilityModel(model);}byId.set(item.assetId,{...item,files,levels,palette:item.palette,thumbnail:'./assets/facilities/thumbnails/'+item.assetId+'.webp',icon:'./assets/facilities/icons/'+item.assetId+'.png'});console.log(item.assetId+' · '+levels.map(l=>l.triangles).join(' / '));}
const items=FACILITY_ASSET_ITEMS.map(i=>byId.get(i.assetId));if(items.some(i=>!i))throw new Error("Missing assets; run a full build first");
const totalBytes=items.flatMap(i=>i.files).reduce((sum,f)=>sum+f.bytes,0),catalog={version:FACILITY_ART_VERSION,status:'colored-models-generated',format:'glTF 2.0 / GLB',total:items.length,facilities:FACILITY_ASSET_ITEMS.filter(i=>i.kind==='facility').length,units:2,totalBytes,items};
await fs.writeFile(path.join(root,'assets/facilities/catalog.json'),JSON.stringify(catalog,null,2)+'\n');await fs.writeFile(path.join(root,'outputs/facility-model-review/build-report.json'),JSON.stringify({version:FACILITY_ART_VERSION,totalModels:items.length*3,totalBytes,items:items.map(i=>({assetId:i.assetId,files:i.files,levels:i.levels}))},null,2)+'\n');console.log('Exported '+selected.length*3+' GLBs · '+(totalBytes/1048576).toFixed(2)+' MiB');
