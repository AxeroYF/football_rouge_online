import {oilGroundSites,oilGroundTexture,applyOilGround} from './atlas-oil.js';
import * as THREE from "three";
import { ReliefTerrain, createReliefMaterial, setChunkRelief } from "./relief-terrain.js";
import { RELIEF_SHEAR, ReliefField } from "./relief-field.js";
import { intersectBounds } from "./projection.js";
import { atlasColor } from "./atlas-style.js";
import { AtlasNature, applyNatureCover } from "./atlas-nature.js";
import { prepareNatureFields } from "./atlas-nature-model.js";
import { roundedMountainHeights } from "./atlas-mountains.js";

const CELLS=32, OFFSET=.025;

export function stylizeReliefField(source) {
  // Share immutable source data; the legacy field and its heights stay intact.
  return Object.assign(Object.create(ReliefField.prototype),source,{heights:roundedMountainHeights(source)});
}

export function atlasStride(pixelsPerUnit, previous=4) {
  // Orthographic map zoom changes the frustum, not the camera's distance.
  if(previous===1 && pixelsPerUnit>=17) return 1;
  if(previous===2 && pixelsPerUnit>=6 && pixelsPerUnit<23) return 2;
  return pixelsPerUnit>=21 ? 1 : pixelsPerUnit>=7 ? 2 : 4;
}

function cellHasLand(field,x,z,dx,dz) {
  for(let row=z;row<=z+dz;row++) for(let col=x;col<=x+dx;col++) if(field.mask[row*field.width+col]>32) return true;
  return false;
}

export function sampleAtlasField(field,x,z,stride=1) {
  if(!field.contains(x,z)) return 0;
  const px=(x-field.origin[0])/field.step,pz=(z-field.origin[1])/field.step;
  const cx=Math.min(field.width-2,Math.floor(px/stride)*stride),cz=Math.min(field.height-2,Math.floor(pz/stride)*stride);
  const ex=Math.min(field.width-1,cx+stride),ez=Math.min(field.height-1,cz+stride);
  const fx=(px-cx)/(ex-cx),fz=(pz-cz)/(ez-cz);
  const a=field.node(cx,cz),b=field.node(ex,cz),c=field.node(cx,ez),d=field.node(ex,ez);
  return fx+fz<=1 ? a+(b-a)*fx+(c-a)*fz : d+(c-d)*(1-fx)+(b-d)*(1-fz);
}

export function createAtlasChunk(field,x0,z0,stride=4) {
  const nx=Math.min(CELLS,field.width-1-x0),nz=Math.min(CELLS,field.height-1-z0);
  const cols=Array.from({length:Math.ceil(nx/stride)+1},(_,i)=>Math.min(nx,i*stride));
  const rows=Array.from({length:Math.ceil(nz/stride)+1},(_,i)=>Math.min(nz,i*stride));
  const indices=[];
  for(let z=0;z<rows.length-1;z++) for(let x=0;x<cols.length-1;x++) {
    if(!cellHasLand(field,x0+cols[x],z0+rows[z],cols[x+1]-cols[x],rows[z+1]-rows[z])) continue;
    const a=z*cols.length+x,b=a+1,c=a+cols.length,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  if(!indices.length)return null;
  const count=cols.length*rows.length,p=new Float32Array(count*3),n=new Float32Array(count*3);
  const color=new Uint8Array(count*3),uv=new Float32Array(count*2),map=new Float32Array(count*2),heights=new Float32Array(count);
  for(let z=0;z<rows.length;z++) for(let x=0;x<cols.length;x++) {
    const i=z*cols.length+x,cx=x0+cols[x],cz=z0+rows[z],source=cz*field.width+cx;
    const wx=field.origin[0]+cx*field.step,wz=field.origin[1]+cz*field.step,h=Math.fround(field.node(cx,cz)+OFFSET);
    p.set([wx,h,wz+RELIEF_SHEAR*h],i*3);n.set(field.normal(cx,cz),i*3);map.set([wx,wz],i*2);
    uv.set([(cx+.5)/field.width,(cz+.5)/field.height],i*2);heights[i]=h;
    const dx=(field.node(cx+1,cz)-field.node(cx-1,cz))/(2*field.step),dz=(field.node(cx,cz+1)-field.node(cx,cz-1))/(2*field.step);
    const valley=(field.node(cx-2,cz)+field.node(cx+2,cz)+field.node(cx,cz-2)+field.node(cx,cz+2))*.25-field.node(cx,cz);
    const tint=atlasColor(field.elevations[source],Math.hypot(dx,dz),wx,wz,valley);
    color.set([Math.round(tint.r*255),Math.round(tint.g*255),Math.round(tint.b*255)],i*3);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(p,3));geometry.setAttribute("normal",new THREE.BufferAttribute(n,3));
  geometry.setAttribute("color",new THREE.BufferAttribute(color,3,true));geometry.setAttribute("uv",new THREE.BufferAttribute(uv,2));
  geometry.setAttribute("reliefMapPosition",new THREE.BufferAttribute(map,2));geometry.setIndex(indices);
  geometry.userData.reliefHeights=heights;geometry.userData.reliefNormals=n.slice();geometry.computeBoundingSphere();
  return geometry;
}

function atlasMaterial(visibility,mask) {
  const material=createReliefMaterial(visibility,mask),previous=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
    previous(shader);
    shader.vertexShader="varying vec2 vAtlasMap;\n"+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nvAtlasMap = uv * vec2("+mask.image.width.toFixed(1)+","+mask.image.height.toFixed(1)+") * .25;");
    shader.fragmentShader="varying vec2 vAtlasMap;\n"+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\nfloat grain = sin(vAtlasMap.x*8.1+sin(vAtlasMap.y*3.7))*sin(vAtlasMap.y*9.3);\ndiffuseColor.rgb *= 1.0 + grain*.035*reliefVisible;");
    shader.fragmentShader=shader.fragmentShader.replace("mix(1.0,0.38,reliefVisible)","mix(1.0,0.62,reliefVisible)");
  };
  // Dimensions appear in GLSL: include them to avoid reusing another region's program.
  material.customProgramCacheKey=()=>`atlas-terrain-v2-${mask.image.width}-${mask.image.height}`;
  return material;
}

export class AtlasTerrain extends ReliefTerrain {
  constructor(scene,fields,options={}) {
    super(scene,fields.map(stylizeReliefField),options);
    this.stride=4;this.environment=null;this.revision=0;this.pixelsPerUnit=2;
    this.isAreaVisible=options.isAreaVisible??(()=>true);this.pendingChunks=[];this.fillTimer=null;this.ready=false;
    this.oilSites=oilGroundSites(options.territories);
    prepareNatureFields(this.fields,options.natureData);
    for(const field of this.fields)field.oilSites=this.oilSites;
    this.nature=options.natureData?new AtlasNature(this.fields,this):null;
  }
  async build(signal) {
    try {
      for(const field of this.fields) {
        const maskData=new Uint8Array(field.mask.length*2);
        for(let i=0;i<field.mask.length;i++)maskData[i*2]=maskData[i*2+1]=field.mask[i];
        const mask=new THREE.DataTexture(maskData,field.width,field.height,THREE.RGFormat);
        mask.minFilter=mask.magFilter=THREE.LinearFilter;mask.generateMipmaps=false;mask.unpackAlignment=1;mask.needsUpdate=true;
        const material=atlasMaterial(this.visibility,mask);
        if(this.nature)applyNatureCover(material,field,this.visibility,this.nature.pixels);
        if(this.oilSites.length){const oilTexture=oilGroundTexture(field,this.oilSites);this.masks.push(oilTexture);applyOilGround(material,oilTexture);}
        const depth=new THREE.MeshDepthMaterial({alphaMap:mask,alphaTest:.12,depthPacking:THREE.RGBADepthPacking});
        this.masks.push(mask);this.materials.push({region:field.meta.region,material});this.depthMaterials.push(depth);
        for(let z=0;z<field.height-1;z+=CELLS) {
          if(this.disposed||signal?.aborted)throw new Error("立体地形加载已取消");
          for(let x=0;x<field.width-1;x+=CELLS) {
            const bounds={minX:field.origin[0]+x*field.step,maxX:field.origin[0]+Math.min(field.width-1,x+CELLS)*field.step,
              minZ:field.origin[1]+z*field.step,maxZ:field.origin[1]+Math.min(field.height-1,z+CELLS)*field.step};
            if(!cellHasLand(field,x,z,Math.min(CELLS,field.width-1-x),Math.min(CELLS,field.height-1-z)))continue;
            const descriptor={field,x,z,bounds,material,depth};
            if(this.isAreaVisible(bounds))this.realizeChunk(descriptor);else this.pendingChunks.push(descriptor);
          }
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
      if(this.nature){await this.nature.build(signal);this.scene.add(this.nature.group);}
      this.ready=true;this.onChange(this.stats());return this;
    }catch(error){this.dispose();throw error;}
  }
  realizeChunk(descriptor) {
    const {field,x,z,material,depth}=descriptor,geometry=createAtlasChunk(field,x,z,this.stride);if(!geometry)return;
    const mesh=new THREE.Mesh(geometry,material);mesh.position.y=this.height;mesh.renderOrder=3;
    mesh.castShadow=!!this.visibility.value;mesh.receiveShadow=true;mesh.customDepthMaterial=depth;
    if(!this.visibility.value)setChunkRelief(geometry,false);
    this.chunks.push({...descriptor,mesh,geometry,stride:this.stride});this.scene.add(mesh);
  }
  replaceGeometry(chunk,stride) {
    const geometry=createAtlasChunk(chunk.field,chunk.x,chunk.z,stride);
    if(!this.visibility.value)setChunkRelief(geometry,false);
    chunk.geometry.dispose();chunk.mesh.geometry=chunk.geometry=geometry;chunk.stride=stride;
  }
  update(view,zoom,pixelsPerUnit=2**((zoom??3)-2)) {
    if(this.disposed||!this.ready)return;
    this.view=view;this.pixelsPerUnit=pixelsPerUnit;const stride=atlasStride(pixelsPerUnit,this.stride),lodChanged=stride!==this.stride;
    this.stride=stride;let changed=lodChanged;
    const extended={minX:view.minX-8,maxX:view.maxX+8,minZ:view.minZ-8,maxZ:view.maxZ+8};
    // Reclaim temporary previews (and the pre-home full-map meshes) when
    // their footprint disappears. Returning descriptors may be realized later.
    this.chunks=this.chunks.filter(chunk=>{
      if(this.isAreaVisible(chunk.bounds))return true;
      chunk.mesh.removeFromParent();chunk.geometry.dispose();
      const {mesh,geometry,stride,...descriptor}=chunk;this.pendingChunks.push(descriptor);changed=true;return false;
    });
    let budget=4,more=false;
    this.pendingChunks=this.pendingChunks.filter(descriptor=>{
      if(!this.isAreaVisible(descriptor.bounds)||!intersectBounds(descriptor.bounds,extended))return true;
      if(budget--<=0){more=true;return true;}
      this.realizeChunk(descriptor);changed=true;return false;
    });
    for(const chunk of this.chunks) {
      const visible=this.isAreaVisible(chunk.bounds)&&!!intersectBounds(chunk.bounds,extended);
      if(visible!==chunk.mesh.visible){chunk.mesh.visible=visible;changed=true;}
      // Hidden chunks keep only their coarse representation, bounding cache cost.
      const desired=visible?stride:4;
      if(chunk.stride!==desired){this.replaceGeometry(chunk,desired);changed=true;}
    }
    if(lodChanged){this.revision++;this.environment?.setSurface(this);this.nature?.setSurface(this);}
    if(this.nature?.update(pixelsPerUnit,view))changed=true;
    if(more&&this.fillTimer===null)this.fillTimer=setTimeout(()=>{
      this.fillTimer=null;if(!this.disposed)this.update(this.view,null,this.pixelsPerUnit);
    },16);
    if(changed)this.onChange(this.stats());
  }
  sample(x,z) {
    if(!this.visibility.value)return 0;
    const field=this.fields.find(f=>f.maskAt(x,z)>32);
    return field?sampleAtlasField(field,x,z,this.stride):0;
  }
  setEnvironment(environment){this.environment=environment;super.setEnvironment(environment);this.nature?.setEnvironment(environment);}
  setTerrainVisible(visible){super.setTerrainVisible(visible);this.nature?.setSurface(this);this.nature?.update(this.pixelsPerUnit,this.view);}
  setThickness(height){super.setThickness(height);this.nature?.setSurface(this);}
  dispose(){if(this.fillTimer!==null)clearTimeout(this.fillTimer);this.fillTimer=null;this.pendingChunks=[];this.nature?.dispose();super.dispose();}
  stats() {
    const stats=super.stats();
    return {...stats,deferred:this.pendingChunks.length,nature:this.nature?.stats(),mountainSites:0,mountainTriangles:0,zoom:"风格化",stride:this.stride,visibleTriangles:this.chunks.reduce((sum,c)=>sum+(c.mesh.visible?c.geometry.index.count/3:0),0)};
  }
}
