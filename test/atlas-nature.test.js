import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { ReliefField, RELIEF_SHEAR } from "../client/map-three/relief-field.js";
import { AtlasTerrain, stylizeReliefField } from "../client/map-three/atlas-terrain.js";
import { AtlasEnvironment } from "../client/map-three/atlas-environment.js";
import { atlasWaterHeight } from "../client/map-three/atlas-style.js";
import { natureSites, natureWeights, prepareNatureFields, insideLake, WATER_STENCIL_BIT, loadMapNature } from "../client/map-three/atlas-nature-model.js";
import { buildLand } from "../client/map-three/geometry.js";

const near=(a,b,tolerance=1e-5)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function rle(count,value=255) {
  const bytes=[];while(count){const n=Math.min(65535,count);bytes.push(n&255,n>>8,value);count-=n;}
  return Buffer.from(bytes).toString("base64");
}
function fixture() {
  const width=65,height=65,origin=[0,-180],step=.25,buffer=new ArrayBuffer(width*height*3),v=new DataView(buffer);
  for(let row=0;row<height;row++)for(let col=0;col<width;col++)v.setUint16((row*width+col)*2,450+Math.round(200*Math.sin(col*.10)**2),true);
  new Uint8Array(buffer,width*height*2).fill(255);
  const field=new ReliefField({schemaVersion:1,region:"europe",width,height,origin,step},buffer);
  const rings=[[[5,-175],[8,-175],[8,-172],[5,-172],[5,-175]],[[6,-174],[6,-173],[7,-173],[7,-174],[6,-174]]];
  const data={schemaVersion:1,regions:{europe:{placement:{width,height,origin,step,rle:rle(width*height)},lakes:[{name:"Lake",rings,area:8}],mouths:[{name:"River",inland:[12,-169],coast:[12,-168],width:.1}]}}};
  return {field,data};
}
const view={minX:-1,maxX:18,minZ:-182,maxZ:-162};
const shader=()=>({uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader});

test("lake basins keep original DEM and holes intact while excluding water from vegetation",()=>{
  const {field,data}=fixture(),before=field.heights.slice(),styled=stylizeReliefField(field);
  prepareNatureFields([styled],data);assert.deepEqual(field.heights,before);assert.equal(field.nature,undefined);
  const lake=styled.nature.lakes[0];assert.ok(insideLake(5.5,-174.5,lake.rings));assert.ok(!insideLake(6.5,-173.5,lake.rings));
  near(styled.sample(5.5,-174.5),Math.max(0,lake.level-.035));
  assert.equal(styled.nature.placement[22*65+22],0);
  assert.ok(styled.nature.placement[26*65+26]>0,"Island holes stay available land");
  assert.throws(()=>prepareNatureFields([styled],{...data,schemaVersion:2}),/损坏/);
  const mismatched=structuredClone(data);mismatched.regions.europe.placement.width++;
  assert.throws(()=>prepareNatureFields([styled],mismatched),/不匹配/);
});

test("vegetation is deterministic, low, absent from blocked sites and never becomes an Arctic forest",async()=>{
  const {field,data}=fixture(),manager=new AtlasTerrain(new THREE.Scene(),[field],{natureData:data});await manager.build();
  try {
    const natureField=manager.fields[0],sites=natureSites(natureField);
    assert.ok(sites.length>0);assert.deepEqual(sites,natureSites(natureField));
    for(const site of sites){assert.ok(site.scale>=.78&&site.scale<1.21);assert.ok(natureWeights(natureField,site.x,site.z).some(v=>v>0));assert.ok(!insideLake(site.x,site.z,data.regions.europe.lakes[0].rings));}
    natureField.nature.placement.fill(0);natureField.nature.cover.fill(0);assert.equal(natureSites(natureField).length,0);
    natureField.meta={...natureField.meta,region:"svalbard"};assert.deepEqual(natureWeights(natureField,4,-174),[0,0,0,0]);
  }finally{manager.dispose();}
});

test("trees remain rooted at every terrain LOD and forest visibility changes request a frame",async()=>{
  const {field,data}=fixture();let changes=0;
  const manager=new AtlasTerrain(new THREE.Scene(),[field],{natureData:data,onChange:()=>changes++});await manager.build();
  try {
    manager.update(view,undefined,2);assert.ok(manager.nature.batches.every(b=>!b.mesh.visible));
    const before=changes;manager.update(view,undefined,5.5);assert.ok(changes>before);assert.ok(manager.nature.batches.some(b=>b.mesh.visible));
    const matrix=new THREE.Matrix4();
    for(const ppu of [12,50,2,50]){
      manager.update(view,undefined,ppu);
      for(const b of manager.nature.batches)for(let i=0;i<b.sites.length;i++){
        b.mesh.getMatrixAt(i,matrix);const site=b.sites[i],h=manager.sample(site.x,site.z)+.027;
        near(matrix.elements[13],h);near(matrix.elements[14]-RELIEF_SHEAR*h,site.z,2e-5);
      }
    }
    manager.update({minX:200,maxX:220,minZ:200,maxZ:220},undefined,50);assert.ok(manager.nature.batches.every(b=>!b.mesh.visible));
    manager.setTerrainVisible(false);manager.update(view,undefined,50);assert.ok(manager.nature.batches.every(b=>!b.mesh.visible));
  }finally{manager.dispose();}
});

test("lake surfaces stay level, preserve their map footprint and triangulate island holes",async()=>{
  const {field,data}=fixture(),manager=new AtlasTerrain(new THREE.Scene(),[field],{natureData:data});await manager.build();
  try {
    const entry=manager.nature.lakes[0],g=entry.water.geometry,p=g.attributes.position,map=g.userData.mapPositions;
    assert.equal(entry.cut.geometry,g);assert.equal(entry.cut.material.colorWrite,false);assert.equal(entry.cut.material.depthTest,false);
    assert.equal(entry.cut.material.stencilWriteMask,WATER_STENCIL_BIT);
    assert.equal(entry.water.material.stencilFuncMask,WATER_STENCIL_BIT);
    assert.ok(entry.cut.renderOrder<entry.water.renderOrder);
    let area=0;for(let i=0;i<g.index.count;i+=3){const [a,b,c]=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];area+=Math.abs((p.getX(b)-p.getX(a))*(map[c*3+2]-map[a*3+2])-(p.getX(c)-p.getX(a))*(map[b*3+2]-map[a*3+2]))*.5;}
    near(area,8);
    for(const ppu of [2,12,50]) {
      manager.update(view,undefined,ppu);
      for(let i=0;i<p.count;i++){near(p.getY(i),entry.lake.level+.04);near(p.getZ(i)-RELIEF_SHEAR*p.getY(i),map[i*3+2],2e-5);}
    }
    manager.setTerrainVisible(false);for(let i=0;i<p.count;i++)near(p.getY(i),.04);
    manager.setThickness(1.7);near(manager.nature.group.position.y,1.7);
  }finally{manager.dispose();}
});

test("land stencil respects lake cutouts only in atlas mode",async()=>{
  const ring=[[0,0],[1,0],[1,1],[0,1],[0,0]],territories={features:[{properties:{region:"europe",territoryId:"test"},geometry:{type:"Polygon",coordinates:[ring]}}]};
  const coast={territories:{test:{coastlines:[ring]}}};
  const atlas=await buildLand(territories,coast,()=>{},{style:"atlas"}),legacy=await buildLand(territories,coast);
  try {
    assert.equal(atlas.group.children[0].material.stencilFuncMask,WATER_STENCIL_BIT);
    assert.equal(atlas.group.children[0].material.stencilFunc,THREE.EqualStencilFunc);
    assert.equal(legacy.group.children[0].material.stencilFunc,THREE.AlwaysStencilFunc);
  }finally{atlas.dispose();legacy.dispose();}
});

test("cover and trees share snow state, while river-mouth visibility and terrain visibility remain independent",async()=>{
  const {field,data}=fixture(),manager=new AtlasTerrain(new THREE.Scene(),[field],{natureData:data});await manager.build();
  const env=new AtlasEnvironment({schemaVersion:1,regions:{europe:{snow:{width:2,height:2,origin:[0,-180],step:16,rle:rle(4)},rivers:[]}}},{surface:manager});manager.setEnvironment(env);
  try {
    const ground=shader();manager.materials[0].material.onBeforeCompile(ground);
    assert.equal(ground.uniforms.natureCover.value,manager.fields[0].nature.texture);
    assert.equal(ground.uniforms.environmentSnowVisible,env.snowVisibility);
    const tree=shader();manager.nature.batches[0].mesh.material.onBeforeCompile(tree);
    assert.equal(tree.uniforms.natureSnowVisible,env.snowVisibility);assert.ok(manager.nature.batches[0].mesh.geometry.attributes.instanceSnow.array.some(v=>v===1));
    env.setSnowVisible(false);assert.equal(tree.uniforms.natureSnowVisible.value,0);
    manager.update(view,undefined,50);env.setRiversVisible(false);assert.ok(manager.nature.mouths.every(m=>!m.channel.visible&&!m.plume.visible));
    assert.ok(manager.nature.lakes.every(l=>l.water.visible));
    env.setRiversVisible(true);assert.ok(manager.nature.mouths.every(m=>m.channel.visible));
    for(const height of [1.1,1.7]){
      manager.setThickness(height);const mouth=manager.nature.mouths[0],p=mouth.channel.geometry.attributes.position;
      near(p.getY(p.count-1)+height,atlasWaterHeight(height)+.018);near(mouth.plume.position.y+height,atlasWaterHeight(height)+.018);
    }
  }finally{env.dispose();manager.dispose();}
});

test("nature resources are released exactly once including aborted terrain builds",async()=>{
  const {field,data}=fixture(),scene=new THREE.Scene(),manager=new AtlasTerrain(scene,[field],{natureData:data});await manager.build();
  const resources=[...manager.nature.geometries,...manager.nature.materials,...manager.nature.textures];let disposed=0;
  resources.forEach(r=>r.addEventListener("dispose",()=>disposed++));manager.dispose();manager.dispose();
  assert.equal(disposed,resources.length);assert.equal(scene.children.length,0);assert.equal(manager.nature.batches.length,0);
  const cancelled=new AtlasTerrain(scene,[field],{natureData:data});await assert.rejects(cancelled.build({aborted:true}),/取消/);assert.equal(scene.children.length,0);
});

test("committed nature data includes named real lakes and region-correct masks with a bounded download",async()=>{
  const bytes=await readFile(new URL("../assets/data/map-nature.json",import.meta.url)),data=JSON.parse(bytes);
  assert.ok(bytes.length<800000);assert.equal(data.source.license,"Natural Earth public domain");
  assert.ok(data.regions.europe.lakes.length>100);assert.ok(data.regions["south-america"].lakes.some(l=>/Titicaca/i.test(l.name)));
  assert.ok(data.regions.europe.mouths.some(m=>/Seine/i.test(m.name)));
  for(const [region,contents]of Object.entries(data.regions)) {
    const meta=JSON.parse(await readFile(new URL(`../assets/map-relief/relief-mesh/${region}.json`,import.meta.url)));
    assert.deepEqual(contents.placement.origin,meta.origin);assert.equal(contents.placement.width,meta.width);
  }
  const loaded=await loadMapNature({fetchImpl:async(url,options)=>{assert.ok(url.includes("map-nature.json"));assert.equal(options.cache,"default");return {ok:true,json:async()=>data};}});
  assert.equal(loaded,data);await assert.rejects(loadMapNature({fetchImpl:async()=>({ok:false})}),/读取失败/);
});
