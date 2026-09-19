import * as THREE from 'three';
import {oilDeposit} from '../../shared/config/oil-deposits.mjs';
import {geometryPolygons,projectTerritoryPoint} from './projection.js';
const ringArea=r=>Math.abs(r.reduce((n,p,i)=>{const q=r[(i+1)%r.length];return n+p[0]*q[1]-q[0]*p[1];},0))*.5;
function inside(x,z,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function clearance(x,z,rings){let min=Infinity;for(const ring of rings)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));min=Math.min(min,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));}return min;}
export function oilGroundSites(territories){
 const sites=[];
 for(const f of territories?.features??[]){const id=f.properties?.territoryId;if(!oilDeposit(id))continue;
  const polygons=geometryPolygons(f.geometry).map(poly=>poly.map(r=>r.map(p=>{const q=projectTerritoryPoint(p,f.properties.region);return [q.x,q.z];}))).sort((a,b)=>ringArea(b[0])-ringArea(a[0]));
  const rings=polygons[0];if(!rings?.[0]?.length)continue;const xs=rings[0].map(p=>p[0]),zs=rings[0].map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);let best=null;
  for(let row=1;row<16;row++)for(let col=1;col<16;col++){const x=minX+(maxX-minX)*col/16,z=minZ+(maxZ-minZ)*row/16;if(!inside(x,z,rings[0])||rings.slice(1).some(r=>inside(x,z,r)))continue;const distance=clearance(x,z,rings);if(!best||distance>best.distance)best={x,z,distance};}
  if(!best)continue;const seed=[...id].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
  sites.push({id,x:best.x,z:best.z,radius:Math.min(1.15,best.distance*.52),angle:(seed%628)/100,seed:seed%1000});
 }return sites;
}
export function oilGroundWeight(site,x,z){const c=Math.cos(site.angle),s=Math.sin(site.angle),dx=x-site.x,dz=z-site.z,a=(dx*c-dz*s)/site.radius,b=(dx*s+dz*c)/(site.radius*.64),angle=Math.atan2(b,a),edge=1+.13*Math.sin(angle*3+site.seed)+.08*Math.cos(angle*5-site.seed);return Math.max(0,Math.min(1,(edge-Math.hypot(a,b))/.22));}
export function oilGroundTexture(field,sites){
 const scale=2,width=field.width*scale,height=field.height*scale,data=new Uint8Array(width*height);
 for(const site of sites){const reach=site.radius*1.3,minX=Math.max(0,Math.floor(((site.x-reach-field.origin[0])/field.step+.5)*scale)),maxX=Math.min(width-1,Math.ceil(((site.x+reach-field.origin[0])/field.step+.5)*scale)),minZ=Math.max(0,Math.floor(((site.z-reach-field.origin[1])/field.step+.5)*scale)),maxZ=Math.min(height-1,Math.ceil(((site.z+reach-field.origin[1])/field.step+.5)*scale));
  for(let row=minZ;row<=maxZ;row++)for(let col=minX;col<=maxX;col++){const x=field.origin[0]+((col+.5)/scale-.5)*field.step,z=field.origin[1]+((row+.5)/scale-.5)*field.step;if(field.maskAt(x,z)<=32)continue;data[row*width+col]=Math.max(data[row*width+col],Math.round(oilGroundWeight(site,x,z)*255));}
 }
 const texture=new THREE.DataTexture(data,width,height,THREE.RedFormat);texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;return texture;
}
export function applyOilGround(material,texture){
 const previous=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material);
 material.onBeforeCompile=shader=>{previous(shader);shader.uniforms.oilGround={value:texture};shader.vertexShader='varying vec2 vOilGroundUv;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvOilGroundUv=uv;');shader.fragmentShader='uniform sampler2D oilGround;\nvarying vec2 vOilGroundUv;\n'+shader.fragmentShader;
  // Paint the actual terrain surface after its biome color, retaining its depth, relief and lighting.
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   float oilMask=texture2D(oilGround,vOilGroundUv).r;
   float oilCore=smoothstep(.22,.84,oilMask);
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.07,.065,.045),smoothstep(.01,.32,oilMask)*.74);
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.008,.012,.013),oilCore);
   roughnessFactor=mix(roughnessFactor,.27,oilCore);
  `);
 };material.customProgramCacheKey=()=>cache()+'-native-oil-v1';material.userData.oilGround=true;
}
