import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { ReliefField, RELIEF_SHEAR } from "../client/map-three/relief-field.js";
import { AtlasTerrain, atlasStride, stylizeReliefField, createAtlasChunk, sampleAtlasField } from "../client/map-three/atlas-terrain.js";
import { AtlasEnvironment } from "../client/map-three/atlas-environment.js";
import { ribbonGeometry } from "../client/map-three/atlas-ribbons.js";
import { syncCampaignCamera } from "../client/map-three/campaign-layer.js";
import { roundedMountainHeights } from "../client/map-three/atlas-mountains.js";
import { ATLAS_SHORE, coastTileSegments, bakeCoastTile, buildAtlasShores, distanceToCoastSegment } from "../client/map-three/atlas-shore.js";
import { atlasWaterHeight, createAtlasOcean } from "../client/map-three/atlas-style.js";
import { buildLand } from "../client/map-three/geometry.js";
import { terrainProfile } from "../client/map-three/terrain-profile.js";

const near=(a,b,t=1e-5)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function fixture(width=65,height=35){
  const buffer=new ArrayBuffer(width*height*3),v=new DataView(buffer);
  for(let z=0;z<height;z++)for(let x=0;x<width;x++)v.setUint16((z*width+x)*2,100+Math.round(2400*Math.exp(-((x-24)**2+(z-14)**2)/220)),true);
  new Uint8Array(buffer,width*height*2).fill(255);
  return new ReliefField({schemaVersion:1,region:"europe",width,height,origin:[0,0],step:.25},buffer);
}
function camera(){
  const c=new THREE.OrthographicCamera(-1,1,1,-1,.1,2200);
  syncCampaignCamera(c,{getSize:()=>({x:1200,y:800,divideBy:()=>({x:600,y:400})}),options:{crs:{scale:z=>256*2**z}},getZoom:()=>5,containerPointToLatLng:()=>({lng:0,lat:0})});
  return c;
}
const view={minX:-1,maxX:20,minZ:-1,maxZ:12};

test("atlas is isolated from the original DEM and retains the relief fallback",()=>{
  const old=fixture(),before=old.heights.slice(),style=stylizeReliefField(old);
  assert.deepEqual(old.heights,before);assert.notEqual(style.heights,old.heights);
  assert.equal(style.elevations,old.elevations);assert.equal(style.mask,old.mask);
  assert.ok(style.node(24,14)>old.node(24,14));
  assert.ok(style.node(24,14)<old.node(24,14)*2.1);
  assert.equal(terrainProfile(),"atlas");assert.equal(terrainProfile("?terrain=relief"),"relief");
});

test("zoom LOD has hysteresis and reduces overview geometry without changing shared seams",()=>{
  assert.equal(atlasStride(2),4);assert.equal(atlasStride(10),2);assert.equal(atlasStride(40),1);
  assert.equal(atlasStride(6.5,2),2);assert.equal(atlasStride(6.5,4),4);
  assert.equal(atlasStride(18,1),1);assert.equal(atlasStride(18,2),2);
  const field=stylizeReliefField(fixture());
  const counts=[];
  for(const stride of [4,2,1]){
    const a=createAtlasChunk(field,0,0,stride),b=createAtlasChunk(field,32,0,stride),cols=32/stride+1;
    counts.push(a.index.count);
    for(let row=0;row<cols;row++)for(const name of ["position","normal","color"]){
      const x=a.attributes[name],y=b.attributes[name];
      assert.deepEqual(Array.from(x.array.slice((row*cols+cols-1)*3,(row*cols+cols)*3)),Array.from(y.array.slice(row*cols*3,(row*cols+1)*3)));
    }
    a.dispose();b.dispose();
  }
  assert.equal(counts[2]/counts[0],16);
});

test("all LODs keep gameplay projection and ray picking consistent with river height sampling",async()=>{
  const manager=new AtlasTerrain(new THREE.Scene(),[fixture()]);await manager.build();const c=camera();
  try{for(const ppu of [2,12,40,2]){
    manager.update(view,undefined,ppu);manager.scene.updateMatrixWorld(true);
    for(const [x,z]of [[1.2,1.2],[5.8,3.4],[8,7.95],[15.99,8.49]]){
      const flat=new THREE.Vector3(x,1.1,z).project(c),h=manager.sample(x,z)+.025;
      const screen=new THREE.Vector3(x,1.1+h,z+RELIEF_SHEAR*h).project(c);near(flat.x,screen.x);near(flat.y,screen.y);
      const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(flat.x,flat.y),c);
      const hits=ray.intersectObjects(manager.chunks.map(t=>t.mesh));assert.ok(hits.length);near(hits[0].point.y,1.1+h);
      const point=manager.pick(ray);near(point.x,x);near(point.z,z);
    }
  }}finally{manager.dispose();}
});

test("coarse coastline cells retain islands between samples and partial edge cells remain finite",()=>{
  const field=fixture(6,7);field.mask.fill(0);field.mask[2*6+2]=255;
  const g=createAtlasChunk(field,0,0,4);assert.ok(g.index.count>0);
  for(const attribute of Object.values(g.attributes))assert.ok(attribute.array.every(Number.isFinite));
  near(sampleAtlasField(field,1.25,1.5,4),field.node(5,6));g.dispose();
});

test("hidden detail is released and aborted or repeated disposal leaves no scene resources",async()=>{
  const scene=new THREE.Scene(),manager=new AtlasTerrain(scene,[fixture()]);await manager.build();
  manager.update(view,undefined,40);let disposed=0;
  manager.chunks.forEach(c=>c.geometry.addEventListener("dispose",()=>disposed++));
  manager.update({minX:100,maxX:110,minZ:100,maxZ:110},undefined,40);
  assert.ok(manager.chunks.every(c=>!c.mesh.visible&&c.stride===4));assert.equal(disposed,manager.chunks.length);
  manager.dispose();manager.dispose();assert.equal(scene.children.length,0);
  const aborted=new AtlasTerrain(scene,[fixture()]);await assert.rejects(aborted.build({aborted:true}),/取消/);assert.equal(scene.children.length,0);
});

test("river ribbons use indexed strips with bounded joins, including hairpins and repeated points",()=>{
  const g=ribbonGeometry([[{x:0,z:0},{x:0,z:0},{x:2,z:0},{x:.001,z:.001},{x:3,z:3}]],.05);
  assert.equal(g.attributes.position.count,8);assert.equal(g.index.count/3,6);
  assert.ok(g.attributes.position.array.every(Number.isFinite));g.computeBoundingBox();
  assert.ok(g.boundingBox.min.x>=-.083&&g.boundingBox.max.x<=3.083);g.dispose();
});

test("atlas rivers follow LOD/flat toggles, clip by view and preserve independent snow switching",async()=>{
  const manager=new AtlasTerrain(new THREE.Scene(),[fixture()]);await manager.build();
  const env=new AtlasEnvironment({schemaVersion:1,regions:{europe:{snow:{width:2,height:2,origin:[0,0],step:1,rle:btoa(String.fromCharCode(4,0,255))},rivers:[{rank:1,points:[[1,1],[6,3],[14,4]]},{rank:5,points:[[1,2],[3,4]]}]}}},{surface:manager});
  manager.setEnvironment(env);
  try{
    for(const ppu of [2,12,40]){manager.update(view,undefined,ppu);env.update(ppu,view);
      for(const {mesh}of env.riverMeshes){const p=mesh.geometry.attributes.position,flat=mesh.geometry.userData.flatRiverPositions;
        for(let i=0;i<p.count;i++){near(p.getY(i),manager.sample(flat[i*3],flat[i*3+2]));near(p.getZ(i)-RELIEF_SHEAR*(p.getY(i)+mesh.position.y),flat[i*3+2]);}
      }
    }
    env.update(40,{minX:100,maxX:110,minZ:100,maxZ:110});assert.ok(env.riverMeshes.every(r=>!r.mesh.visible));
    env.update(2,view);assert.ok(env.riverMeshes.filter(r=>!r.major).every(r=>!r.mesh.visible));
    manager.setTerrainVisible(false);env.setSurface(manager);
    for(const {mesh}of env.riverMeshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++)near(mesh.geometry.attributes.position.getY(i),0);
    env.setRiversVisible(false);env.setSnowVisible(true);assert.equal(env.group.visible,false);assert.equal(env.snowVisibility.value,1);
    const material=manager.materials[0].material,shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader);assert.equal(shader.uniforms.reliefVisible.value,0);assert.equal(shader.uniforms.reliefFlat.value.getHexString(),"304844");
    assert.equal(shader.uniforms.environmentSnowVisible.value,1);
    assert.ok(shader.vertexShader.includes("vAtlasMap")&&shader.vertexShader.includes("vEnvironmentPosition"));
  }finally{env.dispose();manager.dispose();}
});

test("terrain disabled during an asynchronous atlas build also flattens subsequent chunks",async()=>{
  const manager=new AtlasTerrain(new THREE.Scene(),[fixture()]);const pending=manager.build();manager.setTerrainVisible(false);await pending;
  for(const c of manager.chunks){assert.equal(c.mesh.castShadow,false);for(let i=0;i<c.geometry.attributes.position.count;i++)near(c.geometry.attributes.position.getY(i),.025);}
  manager.update(view,undefined,40);
  for(const c of manager.chunks)for(let i=0;i<c.geometry.attributes.position.count;i++)near(c.geometry.attributes.position.getY(i),.025);
  manager.dispose();
});

test("real source river data stays below the legacy geometry budget",async()=>{
  const data=JSON.parse(await readFile(new URL("../assets/data/map-environment.json",import.meta.url)));
  const env=new AtlasEnvironment(data);
  const triangles=env.riverMeshes.reduce((s,r)=>s+r.mesh.geometry.index.count/3,0);
  assert.ok(triangles<653150*.5,`river triangles ${triangles}; must reduce the previous mesh by at least half`);assert.ok(env.riverMeshes.length>4);
  env.update(40,{minX:10,maxX:20,minZ:-155,maxZ:-145});assert.ok(env.riverMeshes.some(r=>!r.mesh.visible));
  env.dispose();
});


test("continuous mountain shaping broadens sharp crests without modifying plains, sea or source data",()=>{
  const field=fixture(33,33);field.heights.fill(1);field.elevations.fill(1800);
  const center=16*33+16;field.heights[center]=3;const before=field.heights.slice();
  const rounded=roundedMountainHeights(field);
  assert.deepEqual(field.heights,before);assert.deepEqual(rounded,roundedMountainHeights(field));
  assert.ok(rounded[center]<2.3, "A narrow spike must lose at least one third of its old exaggerated height");
  assert.ok(rounded[center-1]>1.2, "Height spreads into a broader shoulder");
  assert.ok(rounded[center]-rounded[center-1]<1, "The steep peak-to-shoulder step is softened");
  field.mask.fill(0);assert.ok(roundedMountainHeights(field).every(h=>h===0));
  field.mask.fill(255);field.elevations.fill(100);field.heights.fill(.01);
  assert.ok(roundedMountainHeights(field).every(h=>Math.abs(h-.0104)<1e-7), "Low plains are not warped");
});

test("mountains stay in the terrain surface with matching snow, picking and LOD instead of extra cones",async()=>{
  const scene=new THREE.Scene(),manager=new AtlasTerrain(scene,[fixture()]);await manager.build();
  try {
    assert.equal(scene.children.length,manager.chunks.length, "No freestanding mountain decorations");
    manager.update(view,undefined,40);const h=manager.sample(6,3.5);
    assert.ok(h>1.5);assert.equal(manager.stats().mountainTriangles,0);
    manager.update(view,undefined,2);manager.update(view,undefined,40);near(manager.sample(6,3.5),h);
    manager.setTerrainVisible(false);near(manager.sample(6,3.5),0);
    manager.setTerrainVisible(true);near(manager.sample(6,3.5),h);
  }finally{manager.dispose();}
});


test("shore distance is a nearest-coast union, independent of overlap, ordering and segment density",()=>{
  const a={x:1,z:1},b={x:7,z:7},c={x:1,z:7},paths=[[a,b,c,a],[{x:4,z:0},{x:4,z:9}]];
  const first=coastTileSegments(paths).find(t=>t.x===0&&t.z===0),tile=bakeCoastTile(first);
  const duplicate=coastTileSegments([...paths,...paths.map(p=>[...p].reverse())]).find(t=>t.x===0&&t.z===0);
  assert.deepEqual(bakeCoastTile(duplicate).data,tile.data, "Overlapping shores must not brighten or develop wedges");
  const {step,radius}=ATLAS_SHORE;
  for(let z=0;z<tile.size;z+=3)for(let x=0;x<tile.size;x+=3) {
    const wx=(x-1)*step,wz=(z-1)*step;
    const distance=Math.min(...first.segments.map(([p,q])=>distanceToCoastSegment(wx,wz,p,q)));
    assert.equal(tile.data[z*tile.size+x],Math.max(0,Math.round(255*(1-distance/radius))));
  }
  const sparse=coastTileSegments([[a,b]]).find(t=>t.x===0&&t.z===0);
  const dense=coastTileSegments([[a,a,{x:4,z:4},b]]).find(t=>t.x===0&&t.z===0);
  assert.deepEqual(bakeCoastTile(sparse).data,bakeCoastTile(dense).data);
  near(distanceToCoastSegment(2,1,a,a),1);
});

test("shore distance textures share identical filter guards across every tile boundary",()=>{
  const tiles=coastTileSegments([[{x:-22,z:-19},{x:21,z:22}],[{x:-20,z:16},{x:23,z:15}]]);
  const byKey=new Map(tiles.map(t=>[t.x+","+t.z,{...t,...bakeCoastTile(t)}]));let joins=0;
  for(const a of byKey.values()) {
    const right=byKey.get((a.x+16)+","+a.z),bottom=byKey.get(a.x+","+(a.z+16));
    if(right)for(let z=0;z<a.size;z++)for(let k=0;k<3;k++)assert.equal(a.data[z*a.size+a.size-3+k],right.data[z*a.size+k]);
    if(bottom)for(let x=0;x<a.size;x++)for(let k=0;k<3;k++)assert.equal(a.data[(a.size-3+k)*a.size+x],bottom.data[k*a.size+x]);
    joins+=Number(!!right)+Number(!!bottom);
  }
  assert.ok(joins>12, "Exercise negative coordinates and four-way joins");
});

test("shore rendering uses nonoverlapping quads and releases each distance texture",async()=>{
  const meshes=await buildAtlasShores([[{x:-1,z:-1},{x:18,z:18},{x:3,z:17},{x:18,z:18}]]);let released=0;
  assert.ok(meshes.length>1);
  for(const mesh of meshes) {
    const g=mesh.geometry,m=mesh.material;assert.equal(g.index.count,6);assert.equal(m.stencilWrite,false);
    assert.equal(m.depthWrite,false);assert.equal(mesh.castShadow,false);near(mesh.position.y,.832);
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
    m.onBeforeCompile(shader);assert.equal(shader.uniforms.coastDistance.value,m.userData.coastTexture);
    assert.ok(shader.fragmentShader.includes("texture2D(coastDistance,vCoastUv)"));
    const texture=m.userData.coastTexture;texture.addEventListener("dispose",()=>released++);
    const u=g.attributes.uv,step=ATLAS_SHORE.step;
    near((u.getX(0)*texture.image.width-.5-1)*step,0);
    near((u.getX(1)*texture.image.width-.5-1)*step,16);
    g.dispose();m.dispose();
  }
  assert.equal(released,meshes.length);
});

test("shallow coast height stays synchronized with the ocean while legacy geometry remains unchanged",async()=>{
  const ring=[[0,0],[1,0],[1,1],[0,1],[0,0]];
  const territories={features:[{type:"Feature",properties:{territoryId:"island",region:"europe"},geometry:{type:"Polygon",coordinates:[ring]}}]};
  const coasts={territories:{island:{coastlines:[ring]}}};
  const atlas=await buildLand(territories,coasts,()=>{},{style:"atlas"}),legacy=await buildLand(territories,coasts);
  const sea=createAtlasOcean(),scene=new THREE.Scene();scene.add(atlas.group);
  try {
    assert.deepEqual(atlas.group.children[0].geometry.attributes.position.array,legacy.group.children[0].geometry.attributes.position.array);
    assert.equal(legacy.group.children.length,6);
    for(const height of [.1,1.1,1.7]) {
      atlas.setThickness(height);sea.userData.setThickness(height);
      near(sea.position.y,atlasWaterHeight(height));assert.ok(height-sea.position.y<=.28+1e-6);
      for(const shelf of atlas.group.children.slice(4))near(shelf.position.y,sea.position.y+.012);
    }
    legacy.setThickness(1.7);near(legacy.group.children[4].position.y,.015);
  }finally{atlas.dispose();legacy.dispose();sea.geometry.dispose();sea.material.dispose();}
  assert.equal(scene.children.length,0);
});
