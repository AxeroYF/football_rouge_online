import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createWonderModel,disposeWonderModel,inspectWonderModel,WONDER_IDS} from '../client/wonders/wonder-models.js';
import {publicRequestPath} from '../server/http/static-handler.mjs';
import {WONDER_MATERIAL_VERSION} from '../client/wonders/wonder-materials.js';
const root=new URL('../',import.meta.url);
const catalog=JSON.parse(await fs.readFile(new URL('assets/wonders/catalog.json',root),'utf8'));
function glbDocument(bytes){
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  let offset=12,doc,bin;
  while(offset<bytes.length){const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);assert.equal(length%4,0);assert.ok(offset+8+length<=bytes.length);
    if(type===0x4e4f534a)doc=JSON.parse(bytes.subarray(offset+8,offset+8+length).toString('utf8'));
    if(type===0x004e4942)bin=bytes.subarray(offset+8,offset+8+length);
    offset+=8+length;
  }
  assert.equal(offset,bytes.length);assert.equal(doc.asset.version,'2.0');assert.ok(bin?.length);assert.equal(doc.buffers.length,1);assert.ok(!doc.buffers[0].uri);assert.ok(doc.buffers[0].byteLength<=bin.length);
  for(const v of doc.bufferViews){assert.equal(v.buffer,0);assert.ok((v.byteOffset??0)+v.byteLength<=bin.length);assert.equal((v.byteOffset??0)%4,0);}
  for(const a of doc.accessors){assert.ok(a.count>0);assert.ok(doc.bufferViews[a.bufferView]);assert.ok(!a.sparse);}
  return doc;
}
test('catalog has approved 16 + 8, required Bernabeu, portable assets and no gameplay effects',()=>{
  assert.equal(catalog.version,WONDER_MATERIAL_VERSION);
  assert.equal(catalog.items.length,24);assert.equal(catalog.items.filter(x=>x.region==='欧洲').length,16);assert.equal(catalog.items.filter(x=>x.region==='南美洲').length,8);
  assert.equal(catalog.items.find(x=>x.assetId==='santiago-bernabeu').name,'伯纳乌球场');
  assert.deepEqual(new Set(catalog.items.map(x=>x.assetId)),new Set(WONDER_IDS));
  for(const item of catalog.items){assert.equal(item.files.length,3);assert.ok(!('effect'in item));assert.ok(!('cost'in item));assert.ok(item.levels[0].triangles>=item.levels[1].triangles);assert.ok(item.levels[1].triangles>=item.levels[2].triangles);}
});
for(const item of catalog.items)test(item.id+' '+item.name+': all exported LODs reload with finite meshes, expected dimensions and independent parts',async()=>{
  for(let lod=0;lod<3;lod++){
    const f=item.files[lod],bytes=await fs.readFile(new URL(f.url,root)),doc=glbDocument(bytes);
    assert.equal(bytes.length,f.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);
    assert.ok(!doc.images?.length,'assets are self contained and use procedural materials');
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),'');
    const stats=inspectWonderModel(gltf.scene);assert.equal(stats.triangles,item.levels[lod].triangles);
    stats.size.forEach((v,i)=>{assert.ok(Number.isFinite(v)&&v>0);assert.ok(Math.abs(v-item.levels[lod].size[i])<1e-5);});
    gltf.scene.traverse(o=>{
      if(!o.isMesh)return;const p=o.geometry.getAttribute('position'),n=o.geometry.getAttribute('normal');
      assert.equal(n.count,p.count);for(const v of p.array)assert.ok(Number.isFinite(v));for(const v of n.array)assert.ok(Number.isFinite(v));
      for(const i of o.geometry.index?.array??[])assert.ok(i>=0&&i<p.count);
      assert.ok(p.count>0);assert.ok(o.material.isMeshStandardMaterial);
    });
    const fresh=createWonderModel(item.assetId,{lod});assert.equal(inspectWonderModel(fresh).triangles,stats.triangles);
    const materialsOf=root=>{const set=new Set();root.traverse(o=>{if(o.isMesh){const m=o.material;assert.equal(m.userData.artVersion,WONDER_MATERIAL_VERSION);assert.ok(m.userData.surface);set.add([m.color.getHexString(),m.roughness.toFixed(5),m.metalness.toFixed(5),m.userData.surface].join('|'));}});return set;};
    assert.deepEqual(materialsOf(gltf.scene),materialsOf(fresh),'exported GLB must retain the authored colors and surface properties');
    if(item.assetId==='santiago-bernabeu')for(const name of ['shell','roof_north','roof_south','pitch_1','pitch_6'])assert.ok(gltf.scene.getObjectByName(name),name);
    disposeWonderModel(fresh);disposeWonderModel(gltf.scene);
  }
});
test('public GLB access remains confined to approved static folders',()=>{
  assert.equal(publicRequestPath('/assets/wonders/models/santiago-bernabeu.glb'),'assets/wonders/models/santiago-bernabeu.glb');
  for(const p of ['/outputs/private.glb','/server/private.glb','/shared/account-import/x.glb','/assets/.secret.glb','/assets/%5csecret.glb'])assert.equal(publicRequestPath(p),null);
});
test('invalid asset identifiers and unsupported precision fail explicitly',()=>{
  assert.throws(()=>createWonderModel('../save'),/Unknown wonder/);assert.throws(()=>createWonderModel('eiffel-tower',{lod:3}),/LOD/);
});


test('closed stadium roof halves have outward winding at every LOD',()=>{
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(const lod of [0,1,2]){
    const model=createWonderModel('santiago-bernabeu',{lod});
    for(const name of ['roof_north','roof_south']){
      let volume=0;
      model.getObjectByName(name).traverse(o=>{if(!o.isMesh)return;const p=o.geometry.attributes.position,ix=o.geometry.index;
        for(let i=0;i<(ix?.count??p.count);i+=3){a.fromBufferAttribute(p,ix?ix.getX(i):i);b.fromBufferAttribute(p,ix?ix.getX(i+1):i+1);c.fromBufferAttribute(p,ix?ix.getX(i+2):i+2);volume+=a.dot(b.cross(c))/6;}
      });
      assert.ok(volume>0,name+' should be an outward-facing closed solid');
    }disposeWonderModel(model);
  }
});

