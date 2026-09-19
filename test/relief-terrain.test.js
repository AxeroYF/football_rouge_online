import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { ReliefField, reliefHeight, reliefPoint, RELIEF_SHEAR, sampleRelief, loadReliefFields } from "../client/map-three/relief-field.js";
import { ReliefTerrain, createReliefChunk, setChunkRelief, drapeReliefLines } from "../client/map-three/relief-terrain.js";
import { syncCampaignCamera } from "../client/map-three/campaign-layer.js";
import { MapEnvironment } from "../client/map-three/environment.js";

function fixture(width=5,height=5,mask=255) {
  const buffer=new ArrayBuffer(width*height*3), view=new DataView(buffer);
  for(let z=0;z<height;z++) for(let x=0;x<width;x++) view.setUint16((z*width+x)*2,100+(x%30)*160+(z%8)**2*70,true);
  new Uint8Array(buffer,width*height*2).fill(mask);
  return new ReliefField({schemaVersion:1,region:"europe",width,height,step:.25,origin:[0,0]},buffer);
}
const near=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const vector=(p)=>new THREE.Vector3(p.x,p.y,p.z);
function cameraFor(center={lng:0,lat:0},zoom=5) {
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,2200);
  syncCampaignCamera(camera,{getSize:()=>({x:1200,y:800,divideBy:()=>({x:600,y:400})}),
    options:{crs:{scale:z=>256*2**z}},getZoom:()=>zoom,containerPointToLatLng:()=>center});
  return camera;
}

test("lowland height stays quiet while mountain elevations retain volume",()=>{
  assert.equal(reliefHeight(0),0);
  assert.equal(reliefHeight(80),0);
  assert.ok(reliefHeight(300)<.1);
  assert.ok(reliefHeight(2000)>1);
  assert.equal(reliefHeight(9000),3.3);
});

test("real elevation keeps the same gameplay screen footprint at every supported zoom",()=>{
  for(const center of [{lng:9,lat:46},{lng:20,lat:7},{lng:20,lat:78}]) {
    for(const zoom of [3,3.71,5.21,7]) {
      const camera=cameraFor(center,zoom);
      for(const h of [0,.02,.6,1.8,3.3]) {
        const a=new THREE.Vector3(12,1.1,-17).project(camera);
        const b=vector(reliefPoint(12,-17,h,1.1)).project(camera);
        near(a.x,b.x);near(a.y,b.y);
        if(h>0)assert.ok(b.z<a.z);
      }
    }
  }
});

test("mesh ray intersection agrees with triangular height sampling and original map coordinates",async()=>{
  const manager=new ReliefTerrain(new THREE.Scene(),[fixture()]);
  await manager.build();
  manager.scene.updateMatrixWorld(true);
  const camera=cameraFor();
  for(const [x,z] of [[.08,.06],[.2,.21],[.65,.63],[.76,.84]]) {
    const screen=new THREE.Vector3(x,1.1,z).project(camera),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(screen.x,screen.y),camera);
    const hits=ray.intersectObjects(manager.chunks.map(c=>c.mesh));
    assert.ok(hits.length);
    near(hits[0].point.y,1.1+manager.sample(x,z)+.025);
    const picked=manager.pick(ray);near(picked.x,x);near(picked.z,z);
  }
  manager.dispose();
});

test("neighboring chunks share exact elevations and smooth normals; toggles restore both",()=>{
  const field=fixture(65,4),a=createReliefChunk(field,0,0),b=createReliefChunk(field,32,0);
  for(let row=0;row<4;row++) for(const name of ["position","normal"]) {
    const left=a.geometry.attributes[name],right=b.geometry.attributes[name];
    assert.deepEqual(Array.from(left.array.slice((row*33+32)*3,(row*33+33)*3)),Array.from(right.array.slice(row*33*3,row*33*3+3)));
  }
  const before=a.geometry.attributes.position.array.slice(),normals=a.geometry.attributes.normal.array.slice();
  setChunkRelief(a.geometry,false);
  for(let i=0;i<a.geometry.attributes.position.count;i++) {
    near(a.geometry.attributes.position.getY(i),.025);
    near(a.geometry.attributes.normal.getY(i),1);
  }
  setChunkRelief(a.geometry,true);
  assert.deepEqual(a.geometry.attributes.position.array,before);
  assert.deepEqual(a.geometry.attributes.normal.array,normals);
  assert.ok(normals.some((n,i)=>i%3===0&&Math.abs(n)>.1));
  a.geometry.dispose();b.geometry.dispose();
});

test("overlapping region bounds do not let an ocean grid hide relocated land",()=>{
  const ocean=fixture(5,5,0),land=fixture();
  near(sampleRelief([ocean,land],.5,.5),land.sample(.5,.5));
  assert.equal(sampleRelief([ocean,land],8,8),0);
});

test("visibility changes invalidate once, retain shadow margin, and disposal releases the scene",async()=>{
  let changes=0;const scene=new THREE.Scene(),manager=new ReliefTerrain(scene,[fixture()],{onChange:()=>changes++});
  await manager.build();changes=0;
  const far={minX:90,maxX:100,minZ:90,maxZ:100};
  manager.update(far);assert.equal(changes,1);assert.equal(manager.stats().loaded,0);
  manager.update(far);assert.equal(changes,1);
  manager.update({minX:4,maxX:5,minZ:4,maxZ:5});assert.equal(changes,2);assert.equal(manager.stats().loaded,1);
  manager.dispose();manager.dispose();assert.equal(scene.children.length,0);
});

test("aborted build releases partial geometries and mask materials",async()=>{
  const scene=new THREE.Scene(),manager=new ReliefTerrain(scene,[fixture()]);
  await assert.rejects(manager.build({aborted:true}),/取消/);
  assert.equal(scene.children.length,0);assert.equal(manager.masks.length,0);
});

test("draped lines retain their map footprint through repeated height toggles",()=>{
  const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(1,0,1)]);
  const field=fixture(),offset=.055;
  drapeReliefLines(geometry,(x,z)=>field.sample(x,z),offset);
  assert.ok(geometry.attributes.position.count>2);
  const saved=geometry.attributes.position.array.slice();
  for(let i=0;i<geometry.attributes.position.count;i++) {
    const p=geometry.attributes.position,source=geometry.userData.mapLinePositions;
    near(p.getZ(i)-RELIEF_SHEAR*(p.getY(i)+offset),source[i*2+1]);
  }
  drapeReliefLines(geometry,()=>0,offset);
  drapeReliefLines(geometry,(x,z)=>field.sample(x,z),offset);
  assert.deepEqual(geometry.attributes.position.array,saved);geometry.dispose();
});

test("snow uses original map positions and retains the relief lighting shader",async()=>{
  const manager=new ReliefTerrain(new THREE.Scene(),[fixture()]);await manager.build();
  const environment=new MapEnvironment({schemaVersion:1,regions:{europe:{snow:{width:2,height:2,origin:[0,0],step:1,rle:btoa(String.fromCharCode(4,0,255))},rivers:[{rank:1,points:[[0,0],[1,1]]}]}}},{surface:manager});
  manager.setEnvironment(environment);
  const material=manager.materials[0].material;
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader);
  assert.match(shader.vertexShader,/vEnvironmentPosition = reliefMapPosition;/);
  assert.match(shader.fragmentShader,/indirectDiffuse \*= mix\(1.0,0.38,reliefVisible\)/);
  assert.equal(shader.uniforms.reliefFlat.value.getHexString(),"304844");
  assert.equal(shader.uniforms.environmentSnowVisible.value,1);
  environment.setSnowVisible(false);assert.equal(shader.uniforms.environmentSnowVisible.value,0);
  const river=environment.riverMeshes[0].mesh;
  assert.ok(river.geometry.attributes.position.array.some((v,i)=>i%3===1&&v>0));
  manager.setTerrainVisible(false);environment.setSurface(manager);
  assert.equal(shader.uniforms.reliefVisible.value,0);
  for(let i=0;i<river.geometry.attributes.position.count;i++)near(river.geometry.attributes.position.getY(i),0);
  environment.dispose();manager.dispose();
});

test("bad elevation buffers fail clearly and loading preserves cancellation and fixed asset names",async()=>{
  const field=fixture();
  assert.throws(()=>new ReliefField({...field.meta,width:9000000},new ArrayBuffer(0)),/损坏/);
  const corrupt=new ArrayBuffer(12);new DataView(corrupt).setUint16(0,9001,true);
  assert.throws(()=>new ReliefField({...field.meta,width:2,height:2},corrupt),/超出/);
  const signal=new AbortController().signal,requests=[];
  const fields=await loadReliefFields({signal,fetchImpl:async(url,options)=>{
    assert.equal(options.signal,signal);requests.push(url);
    return {ok:true,json:async()=>({...field.meta,file:"https://invalid.test/redirect.bin"}),arrayBuffer:async()=>field.mask.buffer.slice(0)};
  }});
  assert.equal(fields.length,3);assert.equal(requests.length,6);
  assert.ok(requests.every(url=>url.startsWith("./assets/map-relief/relief-mesh/")));
  await assert.rejects(loadReliefFields({fetchImpl:async()=>({ok:false})}),/清单加载失败/);
});


test("switching terrain off during loading also flattens chunks that arrive later",async()=>{
  const terrain=new ReliefTerrain(new THREE.Scene(),[fixture(5,35)]);
  const pending=terrain.build();
  terrain.setTerrainVisible(false);
  await pending;
  assert.equal(terrain.chunks.length,2);
  for(const {mesh,geometry} of terrain.chunks) {
    assert.equal(mesh.castShadow,false);
    for(let i=0;i<geometry.attributes.position.count;i++)near(geometry.attributes.position.getY(i),.025);
  }
  terrain.dispose();
});
