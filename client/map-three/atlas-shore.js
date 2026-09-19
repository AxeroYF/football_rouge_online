import * as THREE from "three";
import { simplifyCoastlineSegment } from "../map/coastline-lod.js";
import { ATLAS_PALETTE, atlasWaterHeight } from "./atlas-style.js";

export const ATLAS_SHORE = Object.freeze({ tileSize:16, step:.125, radius:2.4 });

export function distanceToCoastSegment(x,z,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
  const t=length?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/length)):0;
  return Math.hypot(x-a.x-t*dx,z-a.z-t*dz);
}

export function coastTileSegments(coasts) {
  const buckets=new Map(),{tileSize,step,radius}=ATLAS_SHORE;
  // A shared distance field unions coastlines before blending. Overlapping
  // bays, short segments and islands cannot accumulate opacity or leave miters.
  for(const coast of coasts) {
    const points=simplifyCoastlineSegment(coast.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)).map(p=>[p.x,p.z]),.012)
      .map(([x,z])=>({x,z}));
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i];if(a.x===b.x&&a.z===b.z)continue;
      const margin=radius+step;
      for(let z=Math.floor((Math.min(a.z,b.z)-margin)/tileSize);z<=Math.floor((Math.max(a.z,b.z)+margin)/tileSize);z++)
        for(let x=Math.floor((Math.min(a.x,b.x)-margin)/tileSize);x<=Math.floor((Math.max(a.x,b.x)+margin)/tileSize);x++) {
          const key=x+","+z;
          if(!buckets.has(key))buckets.set(key,{x:x*tileSize,z:z*tileSize,segments:[]});
          buckets.get(key).segments.push([a,b]);
        }
    }
  }
  return [...buckets.values()];
}

export function bakeCoastTile(tile) {
  const {tileSize,step,radius}=ATLAS_SHORE,size=tileSize/step+3;
  const data=new Uint8Array(size*size),ox=tile.x-step,oz=tile.z-step;
  // One guard texel outside every edge gives neighboring tiles identical
  // bilinear samples, including negative world coordinates and four-way joins.
  for(const [a,b]of tile.segments) {
    const minX=Math.max(0,Math.ceil((Math.min(a.x,b.x)-radius-ox)/step));
    const maxX=Math.min(size-1,Math.floor((Math.max(a.x,b.x)+radius-ox)/step));
    const minZ=Math.max(0,Math.ceil((Math.min(a.z,b.z)-radius-oz)/step));
    const maxZ=Math.min(size-1,Math.floor((Math.max(a.z,b.z)+radius-oz)/step));
    for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++) {
      const closeness=Math.max(0,Math.round(255*(1-distanceToCoastSegment(ox+x*step,oz+z*step,a,b)/radius)));
      const i=z*size+x;if(closeness>data[i])data[i]=closeness;
    }
  }
  return {data,size};
}

function coastMaterial(texture) {
  const material=new THREE.MeshBasicMaterial({color:ATLAS_PALETTE.outerShore,transparent:true,depthWrite:false,
    toneMapped:false,side:THREE.DoubleSide,forceSinglePass:true});
  material.onBeforeCompile=shader=>{
    shader.uniforms.coastDistance={value:texture};
    shader.uniforms.coastInner={value:new THREE.Color(ATLAS_PALETTE.innerShore)};
    shader.uniforms.coastSand={value:new THREE.Color("#b9b18a")};
    shader.vertexShader="varying vec2 vCoastUv;\n"+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nvCoastUv=uv;");
    shader.fragmentShader="uniform sampler2D coastDistance;\nuniform vec3 coastInner;\nuniform vec3 coastSand;\nvarying vec2 vCoastUv;\n"+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\nfloat distance=(1.0-texture2D(coastDistance,vCoastUv).r)*2.4;\nfloat shelf=1.0-smoothstep(0.0,2.4,distance);\nfloat beach=1.0-smoothstep(0.0,.20,distance);\ndiffuseColor.rgb=mix(diffuseColor.rgb,coastInner,1.0-smoothstep(.1,1.1,distance));\ndiffuseColor.rgb=mix(diffuseColor.rgb,coastSand,beach*.30);\ndiffuseColor.a=shelf*.48+beach*.10;");
  };
  material.customProgramCacheKey=()=>"atlas-distance-coast-v2";
  material.addEventListener("dispose",()=>texture.dispose());
  material.userData.coastTexture=texture;
  return material;
}

export async function buildAtlasShores(coasts) {
  const meshes=[],tiles=coastTileSegments(coasts),{tileSize}=ATLAS_SHORE;
  try {
    for(let i=0;i<tiles.length;i++) {
      const tile=tiles[i],{data,size}=bakeCoastTile(tile);
      if(!data.some(value=>value>0))continue;
      const texture=new THREE.DataTexture(data,size,size,THREE.RedFormat);
      texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;
      const g=new THREE.BufferGeometry(),x=tile.x,z=tile.z,edge=1.5/size,end=1-edge;
      g.setAttribute("position",new THREE.Float32BufferAttribute([x,0,z,x+tileSize,0,z,x,0,z+tileSize,x+tileSize,0,z+tileSize],3));
      g.setAttribute("uv",new THREE.Float32BufferAttribute([edge,edge,end,edge,edge,end,end,end],2));
      g.setIndex([0,2,1,1,2,3]);g.computeBoundingSphere();
      const mesh=new THREE.Mesh(g,coastMaterial(texture));mesh.renderOrder=1;mesh.position.y=atlasWaterHeight(1.1)+.012;
      meshes.push(mesh);
      if(i%8===7)await new Promise(resolve=>setTimeout(resolve,0));
    }
    return meshes;
  } catch(error) { for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}throw error; }
}
