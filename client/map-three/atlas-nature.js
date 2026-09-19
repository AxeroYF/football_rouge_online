import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RELIEF_SHEAR } from "./relief-field.js";
import { LAND_STENCIL_BIT } from "./settings.js";
import { intersectBounds } from "./projection.js";
import { atlasWaterHeight } from "./atlas-style.js";
import { natureWeights, natureSites, natureHash, WATER_STENCIL_BIT } from "./atlas-nature-model.js";

const colors={forest:new THREE.Color("#526d42"),meadow:new THREE.Color("#a1ad70"),crop:new THREE.Color("#b5a16b")};

export function applyNatureCover(material,field,visibility,pixels) {
  if(!field.nature?.texture)return;
  const previous=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=shader=>{
    previous(shader);
    Object.assign(shader.uniforms,{natureCover:{value:field.nature.texture},naturePixels:pixels,
      natureOrigin:{value:new THREE.Vector2(...field.origin)},natureExtent:{value:new THREE.Vector2(field.width*field.step,field.height*field.step)},
      natureForest:{value:colors.forest},natureMeadow:{value:colors.meadow},natureCrop:{value:colors.crop}});
    shader.vertexShader="varying vec2 vNatureUv;\n"+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nvNatureUv=uv;");
    shader.fragmentShader="varying vec2 vNatureUv;\nuniform sampler2D natureCover;\nuniform float naturePixels;\nuniform vec2 natureOrigin,natureExtent;\nuniform vec3 natureForest,natureMeadow,natureCrop;\n"+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>",`#include <color_fragment>
      vec4 cover=texture2D(natureCover,vNatureUv)*reliefVisible;
      vec2 natureWorld=natureOrigin+vNatureUv*natureExtent-vec2(.125);
      vec2 fieldGrid=mat2(.92,-.38,.38,.92)*natureWorld/0.78;
      vec2 parcel=floor(fieldGrid),insideParcel=fract(fieldGrid);
      float fieldSeed=fract(sin(dot(parcel,vec2(127.1,311.7)))*43758.5453);
      float verge=min(min(insideParcel.x,1.0-insideParcel.x),min(insideParcel.y,1.0-insideParcel.y));
      float parcelMask=smoothstep(.018,.07,verge);
      float furrows=sin(fieldGrid.y*48.0)*.045*smoothstep(16.0,34.0,naturePixels);
      vec3 cropTint=natureCrop*mix(.83,1.12,fieldSeed)*(1.0+furrows);
      diffuseColor.rgb=mix(diffuseColor.rgb,natureForest,cover.r*.32);
      diffuseColor.rgb=mix(diffuseColor.rgb,natureMeadow,cover.b*.26);
      diffuseColor.rgb=mix(diffuseColor.rgb,cropTint,cover.g*parcelMask*.52);
    `);
  };
  material.customProgramCacheKey=()=>cache()+"-nature-cover-v1";
}

function foliageGeometry(kind) {
  const parts=[];
  const add=(geometry,color)=>{
    const g=geometry.index?geometry.toNonIndexed():geometry;
    const c=new Float32Array(g.attributes.position.count*3),tint=new THREE.Color(color);
    for(let i=0;i<c.length;i+=3)tint.toArray(c,i);
    g.setAttribute("color",new THREE.BufferAttribute(c,3));parts.push(g);
    if(g!==geometry)geometry.dispose();
  };
  if(kind==="forest") {
    const trunk=new THREE.CylinderGeometry(.022,.03,.19,5);trunk.translate(0,.095,0);add(trunk,"#877954");
    for(const [x,y,z,s]of [[0,.29,0,1],[-.095,.235,.045,.72],[.085,.24,-.055,.76]]) {
      const crown=new THREE.IcosahedronGeometry(.17,1);crown.scale(s,s*.96,s*.92);crown.translate(x,y,z);add(crown,"#76915a");
    }
  } else {
    for(const [x,z,s]of [[0,0,1],[-.10,.03,.67],[.10,.025,.72]]) {
      const crown=new THREE.IcosahedronGeometry(.13,1);crown.scale(s,.68*s,s);crown.translate(x,.073*s,z);add(crown,"#87945d");
    }
  }
  const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());return geometry;
}

function lakeGeometry(lake) {
  const paths=lake.rings.map(r=>r.map(([x,z])=>new THREE.Vector2(x,-z)));
  const shape=new THREE.Shape(paths[0]);shape.holes=paths.slice(1).map(p=>new THREE.Path(p));
  const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);
  geometry.userData.mapPositions=geometry.attributes.position.array.slice();return geometry;
}

export class AtlasNature {
  constructor(fields,surface) {
    this.fields=fields;this.surface=surface;this.group=new THREE.Group();this.group.name="atlas-nature";
    this.pending=[];this.fillTimer=null;this.prototypes=null;this.environment=null;
    this.pixels={value:2};this.snowVisibility={value:1};this.batches=[];this.lakes=[];this.mouths=[];
    this.textures=[];this.materials=[];this.geometries=new Set();this.disposed=false;this.riversVisible=true;this.view=null;
    for(const field of fields)if(field.nature) {
      const bytes=new Uint8Array(field.width*field.height*4);
      for(let row=0;row<field.height;row++)for(let col=0;col<field.width;col++) {
        const i=row*field.width+col;if(!field.nature.placement[i])continue;
        const weights=natureWeights(field,field.origin[0]+col*field.step,field.origin[1]+row*field.step);
        for(let n=0;n<4;n++)bytes[i*4+n]=Math.round(weights[n]*255);
      }
      field.nature.cover=bytes;
      const texture=new THREE.DataTexture(bytes,field.width,field.height,THREE.RGBAFormat);
      texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;
      field.nature.texture=texture;this.textures.push(texture);
    }
  }
  foliageMaterial() {
    const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,
      stencilWrite:true,stencilRef:LAND_STENCIL_BIT,stencilFuncMask:LAND_STENCIL_BIT,stencilWriteMask:0,stencilFunc:THREE.EqualStencilFunc});
    material.onBeforeCompile=shader=>{
      shader.uniforms.natureSnowVisible=this.snowVisibility;
      shader.vertexShader="attribute float instanceSnow;\nvarying float vNatureSnow;\n"+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nvNatureSnow=instanceSnow;");
      shader.fragmentShader="varying float vNatureSnow;\nuniform float natureSnowVisible;\n"+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>","#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.69,.76,.70),vNatureSnow*natureSnowVisible*.75);");
    };
    material.customProgramCacheKey=()=>"atlas-foliage-v1";this.materials.push(material);return material;
  }
  async build(signal) {
    this.prototypes={forest:foliageGeometry("forest"),shrub:foliageGeometry("shrub")};
    for(const field of this.fields) {
      if(this.disposed||signal?.aborted)throw new Error("自然地貌加载已取消");
      if(!field.nature)continue;
      const buckets=new Map();
      for(const site of natureSites(field)) {
        const key=[Math.floor(site.x/16),Math.floor(site.z/16),site.kind].join(",");
        if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(site);
      }
      const material=this.foliageMaterial();
      for(const [key,sites]of buckets) {
        const [x,z,kind]=key.split(",");
        this.pending.push({type:"foliage",sites,field,kind,material,bounds:{minX:Number(x)*16-1,maxX:(Number(x)+1)*16+1,minZ:Number(z)*16-1,maxZ:(Number(z)+1)*16+1}});
      }
      for(const lake of field.nature.lakes)this.pending.push({type:"lake",lake,field,bounds:lake.bounds});
      for(const mouth of field.nature.mouths) {
        const [x,z]=mouth.coast,[a,b]=mouth.inland;
        this.pending.push({type:"mouth",mouth,bounds:{minX:Math.min(x,a)-2,maxX:Math.max(x,a)+2,minZ:Math.min(z,b)-2,maxZ:Math.max(z,b)+2}});
      }
      // Yield between small batches; hidden foliage has no instances or geometry.
      while(this.realizePending(8).more) {
        await new Promise(resolve=>setTimeout(resolve,0));
        if(this.disposed||signal?.aborted)throw new Error("自然地貌加载已取消");
      }
    }
    this.setSurface(this.surface);this.update(this.pixels.value,this.view);return this;
  }
  realizePending(budget=8) {
    let more=false,changed=false;
    this.pending=this.pending.filter(entry=>{
      if(this.surface.isAreaVisible&&!this.surface.isAreaVisible(entry.bounds))return true;
      if(this.view&&!intersectBounds(entry.bounds,this.view))return true;
      if(budget--<=0){more=true;return true;}
      if(entry.type==="lake")this.addLake(entry.lake,entry.field);
      else if(entry.type==="mouth")this.addMouth(entry.mouth);
      else {
        const {sites,kind,material}=entry,geometry=this.prototypes[kind].clone();this.geometries.add(geometry);
        geometry.setAttribute("instanceSnow",new THREE.InstancedBufferAttribute(new Float32Array(sites.length),1));
        const mesh=new THREE.InstancedMesh(geometry,material,sites.length);mesh.renderOrder=4;mesh.receiveShadow=true;mesh.raycast=()=>{};
        sites.forEach((site,i)=>mesh.setColorAt(i,new THREE.Color().setScalar(.86+natureHash(site.x+5,site.z)*.22)));
        this.batches.push({...entry,mesh});this.group.add(mesh);
      }
      changed=true;return false;
    });
    if(changed){this.setSurface(this.surface);if(this.environment)this.setEnvironment(this.environment);}
    return {more,changed};
  }
  addLake(lake,field) {
    const geometry=lakeGeometry(lake);this.geometries.add(geometry);
    // First mark the exact projected water polygon. Land writes its own bit
    // outside this mask; coarse terrain therefore never pokes through a lake.
    const cutMaterial=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false,depthTest:false,side:THREE.DoubleSide,
      stencilWrite:true,stencilRef:WATER_STENCIL_BIT,stencilWriteMask:WATER_STENCIL_BIT,stencilFunc:THREE.AlwaysStencilFunc,stencilZPass:THREE.ReplaceStencilOp});
    const waterMaterial=new THREE.MeshStandardMaterial({color:"#3c8290",roughness:.62,metalness:0,toneMapped:false,side:THREE.DoubleSide,
      stencilWrite:true,stencilRef:WATER_STENCIL_BIT,stencilFuncMask:WATER_STENCIL_BIT,stencilWriteMask:0,stencilFunc:THREE.EqualStencilFunc});
    this.materials.push(cutMaterial,waterMaterial);
    const cut=new THREE.Mesh(geometry,cutMaterial),water=new THREE.Mesh(geometry,waterMaterial);
    cut.renderOrder=-20;water.renderOrder=2;water.receiveShadow=true;cut.raycast=water.raycast=()=>{};
    this.group.add(cut,water);this.lakes.push({lake,field,cut,water});
  }
  addMouth(mouth) {
    const [x,z]=mouth.coast,dx=x-mouth.inland[0],dz=z-mouth.inland[1],length=Math.hypot(dx,dz);
    if(length<.01)return;
    const ux=dx/length,uz=dz/length,position=[],map=[],indices=[];
    for(let i=0;i<=10;i++) {
      const t=i/10,cx=mouth.inland[0]+ux*(length+.35)*t,cz=mouth.inland[1]+uz*(length+.35)*t;
      const width=mouth.width*(.55+t*.80);
      for(const side of [-1,1]){position.push(cx-uz*width*side,0,cz+ux*width*side);map.push(cx-uz*width*side,cz+ux*width*side,t);}
      if(i<10){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    }
    const geometry=new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(position,3));geometry.setIndex(indices);geometry.userData.mouthMap=new Float32Array(map);this.geometries.add(geometry);
    const material=new THREE.MeshBasicMaterial({color:"#619c9e",transparent:true,opacity:.78,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
    const channel=new THREE.Mesh(geometry,material);channel.renderOrder=9;channel.raycast=()=>{};this.group.add(channel);this.materials.push(material);
    const plumeGeometry=new THREE.PlaneGeometry(.85,1.15);plumeGeometry.rotateX(-Math.PI/2);this.geometries.add(plumeGeometry);
    const plumeMaterial=new THREE.MeshBasicMaterial({color:"#80b4a4",transparent:true,opacity:.26,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
    plumeMaterial.onBeforeCompile=shader=>{
      shader.vertexShader="varying vec2 vPlumeUv;\n"+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nvPlumeUv=uv;");
      shader.fragmentShader="varying vec2 vPlumeUv;\n"+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>","#include <color_fragment>\ndiffuseColor.a*=1.0-smoothstep(.1,1.0,length((vPlumeUv-.5)*2.0));");
    };
    plumeMaterial.customProgramCacheKey=()=>"atlas-estuary-plume-v1";this.materials.push(plumeMaterial);
    const plume=new THREE.Mesh(plumeGeometry,plumeMaterial);plume.rotation.y=Math.atan2(ux,uz);plume.renderOrder=8;plume.raycast=()=>{};this.group.add(plume);
    this.mouths.push({mouth,channel,plume,x:x+ux*.38,z:z+uz*.38,bounds:{minX:Math.min(x,mouth.inland[0])-2,maxX:Math.max(x,mouth.inland[0])+2,minZ:Math.min(z,mouth.inland[1])-2,maxZ:Math.max(z,mouth.inland[1])+2}});
  }
  setSurface(surface) {
    this.surface=surface;this.group.position.y=surface.height;const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(),position=new THREE.Vector3(),axis=new THREE.Vector3(0,1,0);
    for(const {mesh,sites}of this.batches) {
      sites.forEach((site,i)=>{const h=surface.sample(site.x,site.z)+.027;position.set(site.x,h,site.z+RELIEF_SHEAR*h);rotation.setFromAxisAngle(axis,site.rotation);scale.setScalar(site.scale);matrix.compose(position,rotation,scale);mesh.setMatrixAt(i,matrix);});
      mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
    }
    for(const {lake,water}of this.lakes) {
      const geometry=water.geometry,p=geometry.attributes.position,original=geometry.userData.mapPositions,h=(surface.visibility.value?lake.level:0)+.04;
      for(let i=0;i<p.count;i++)p.setXYZ(i,original[i*3],h,original[i*3+2]+RELIEF_SHEAR*h);
      p.needsUpdate=true;geometry.computeBoundingSphere();
    }
    const sea=atlasWaterHeight(surface.height)-surface.height+.018;
    for(const entry of this.mouths) {
      const p=entry.channel.geometry.attributes.position,map=entry.channel.geometry.userData.mouthMap;
      for(let i=0;i<p.count;i++) {
        const x=map[i*3],z=map[i*3+1],t=map[i*3+2],blend=THREE.MathUtils.smoothstep(t,.72,1),h=THREE.MathUtils.lerp(surface.sample(x,z)+.074,sea,blend);
        p.setXYZ(i,x,h,z+RELIEF_SHEAR*h);
      }
      p.needsUpdate=true;entry.channel.geometry.computeBoundingSphere();entry.plume.position.set(entry.x,sea,entry.z+RELIEF_SHEAR*sea);
    }
  }
  setEnvironment(environment) {
    this.environment=environment;this.snowVisibility=environment.snowVisibility;
    for(const {mesh,field,sites}of this.batches) {
      const mask=environment.masks.get(field.meta.region);if(!mask)continue;
      const {width,height,data}=mask.texture.image,attribute=mesh.geometry.attributes.instanceSnow;
      sites.forEach((site,i)=>{const x=Math.floor((site.x-mask.origin.x)/mask.extent.x*width),z=Math.floor((site.z-mask.origin.y)/mask.extent.y*height);attribute.setX(i,x>=0&&x<width&&z>=0&&z<height?data[z*width+x]/255:0);});
      attribute.needsUpdate=true;mesh.material.needsUpdate=true;
    }
  }
  releaseHidden() {
    if(!this.surface.isAreaVisible)return false;
    let changed=false;
    const free=(geometry,meshes,materials=[])=>{
      for(const mesh of meshes){mesh.removeFromParent();mesh.dispose?.();}
      geometry.dispose();this.geometries.delete(geometry);
      for(const material of materials){material.dispose();this.materials=this.materials.filter(m=>m!==material);}
      changed=true;
    };
    this.batches=this.batches.filter(entry=>{
      if(this.surface.isAreaVisible(entry.bounds))return true;
      free(entry.mesh.geometry,[entry.mesh]);const {mesh,...descriptor}=entry;this.pending.push(descriptor);return false;
    });
    this.lakes=this.lakes.filter(entry=>{
      if(this.surface.isAreaVisible(entry.lake.bounds))return true;
      free(entry.water.geometry,[entry.cut,entry.water],[entry.cut.material,entry.water.material]);
      this.pending.push({type:"lake",lake:entry.lake,field:entry.field,bounds:entry.lake.bounds});return false;
    });
    this.mouths=this.mouths.filter(entry=>{
      if(this.surface.isAreaVisible(entry.bounds))return true;
      free(entry.channel.geometry,[entry.channel],[entry.channel.material]);free(entry.plume.geometry,[entry.plume],[entry.plume.material]);
      this.pending.push({type:"mouth",mouth:entry.mouth,bounds:entry.bounds});return false;
    });
    return changed;
  }
  setRiversVisible(visible){this.riversVisible=!!visible;this.update(this.pixels.value,this.view);}
  update(pixels,view) {
    if(this.disposed)return false;
    let changed=pixels!==this.pixels.value;this.pixels.value=pixels;this.view=view;
    changed=this.releaseHidden()||changed;
    const result=this.realizePending(4);changed=changed||result.changed;
    if(result.more&&this.fillTimer===null)this.fillTimer=setTimeout(()=>{
      this.fillTimer=null;if(this.disposed)return;
      if(this.update(this.pixels.value,this.view))this.surface.onChange?.(this.surface.stats());
    },16);
    const show=(mesh,value)=>{if(mesh.visible!==value)changed=true;mesh.visible=value;};
    const visible=bounds=>(!this.surface.isAreaVisible||this.surface.isAreaVisible(bounds))&&(!view||!!intersectBounds(bounds,view));
    for(const b of this.batches)show(b.mesh,!!this.surface.visibility.value&&pixels>=(b.kind==="forest"?5:10)&&visible(b.bounds));
    for(const l of this.lakes){const enabled=visible(l.lake.bounds)&&Math.sqrt(l.lake.area??1)*pixels>=1.4;show(l.cut,enabled);show(l.water,enabled);}
    for(const m of this.mouths){const enabled=this.riversVisible&&pixels>=3&&visible(m.bounds);show(m.channel,enabled);show(m.plume,enabled);}
    return changed;
  }
  stats(){return {deferred:this.pending.length,trees:this.batches.filter(b=>b.kind==="forest").reduce((n,b)=>n+b.sites.length,0),shrubs:this.batches.filter(b=>b.kind==="shrub").reduce((n,b)=>n+b.sites.length,0),lakes:this.lakes.length,mouths:this.mouths.length,visibleBatches:this.batches.filter(b=>b.mesh.visible).length};}
  dispose() {
    if(this.disposed)return;this.disposed=true;this.group.removeFromParent();
    if(this.fillTimer!==null)clearTimeout(this.fillTimer);this.fillTimer=null;this.pending=[];
    if(this.prototypes)Object.values(this.prototypes).forEach(g=>g.dispose());this.prototypes=null;
    for(const {mesh}of this.batches)mesh.dispose();
    for(const g of this.geometries)g.dispose();for(const m of this.materials)m.dispose();for(const t of this.textures)t.dispose();this.group.clear();
    this.fields=[];this.batches=[];this.lakes=[];this.mouths=[];this.textures=[];this.materials=[];this.geometries.clear();
  }
}
