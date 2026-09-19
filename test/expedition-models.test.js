import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {EXPEDITION_ART_VERSION,EXPEDITION_STYLES} from '../shared/config/expedition-art.mjs';
import {createExpeditionModel,inspectExpeditionModel,disposeExpeditionModel} from '../client/expedition-models/expedition-models.js';
const root=new URL('../',import.meta.url),catalog=JSON.parse(await fs.readFile(new URL('assets/expedition-units/catalog.json',root),'utf8'));
const required={airplane:['fuselage','wings','tail_fin','engines','landing_gear'],excavator:['tracks','cab','boom','stick','hydraulics','bucket_teeth'],bus:['body','passenger_windows','passenger_door','wheels','roof_ac'],'sports-car':['body','canopy','wheels','rear_wing','headlights'],tank:['armored_hull','turret','barrel','tracks','hatches']};
test('catalog replaces the five footballers with distinct vehicle assets and square icons',async()=>{
 assert.equal(catalog.version,EXPEDITION_ART_VERSION);assert.deepEqual(catalog.items.map(i=>i.assetId),Object.keys(required));assert.deepEqual(catalog.items.map(i=>i.assetId),EXPEDITION_STYLES.map(i=>i.id));assert.equal(new Set(catalog.items.map(i=>i.files[0].sha256)).size,5);
 for(const item of catalog.items){assert.equal(item.level,null);const png=await fs.readFile(new URL(item.icon,root));assert.equal(png.readUInt32BE(0),0x89504e47);assert.equal(png.readUInt32BE(16),320);assert.equal(png.readUInt32BE(20),320);}
 assert.throws(()=>createExpeditionModel('messi'));assert.throws(()=>createExpeditionModel('../x'));assert.throws(()=>createExpeditionModel('airplane',{lod:3}));
});
for(const item of catalog.items)test(item.name+' exports grounded colored geometry and recognizable parts at every LOD',async()=>{
 let previous=Infinity;
 for(const file of item.files){
  const b=await fs.readFile(new URL(file.url,root));assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(8),b.length);assert.equal(createHash('sha256').update(b).digest('hex'),file.sha256);
  const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),''),model=gltf.scene,stats=inspectExpeditionModel(model),fresh=createExpeditionModel(item.assetId,{lod:file.lod});
  assert.equal(stats.triangles,inspectExpeditionModel(fresh).triangles);assert.ok(stats.triangles<previous);previous=stats.triangles;assert.ok(Math.abs(stats.bounds.min[1])<1e-5);assert.ok(Math.abs(Math.max(stats.size[0],stats.size[2])-2.4)<1e-5);
  for(const node of required[item.assetId])assert.ok(model.getObjectByName(node),node+' remains at LOD '+file.lod);
  for(const retired of ['jersey','head','football','boots','turf'])assert.ok(!model.getObjectByName(retired));
  model.traverse(o=>{if(!o.isMesh)return;for(const attr of ['position','normal'])for(const v of o.geometry.attributes[attr].array)assert.ok(Number.isFinite(v));assert.equal(o.material.userData.artVersion,EXPEDITION_ART_VERSION);});
  const colors=m=>{const c=new Set();m.traverse(o=>{if(o.isMesh)c.add(o.material.color.getHexString());});return c;};assert.deepEqual(colors(model),colors(fresh));disposeExpeditionModel(model);disposeExpeditionModel(fresh);
 }
});
