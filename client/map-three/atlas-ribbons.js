import * as THREE from "three";
import { subdivideReliefPath } from "./relief-field.js";
import { simplifyCoastlineSegment } from "../map/coastline-lod.js";

// Two shared vertices per station replace the old rectangle plus twelve-triangle
// disk at every point. Bounded miters keep hairpins and short islands well behaved.
export function ribbonGeometry(paths,width,{step=Infinity,tolerance=0}={}) {
  const vertices=[],uv=[],indices=[];
  for(const path of paths) {
    let points=path.filter((p,i)=>Number.isFinite(p.x)&&Number.isFinite(p.z)&&(!i||Math.hypot(p.x-path[i-1].x,p.z-path[i-1].z)>1e-7));
    if(tolerance)points=simplifyCoastlineSegment(points.map(p=>[p.x,p.z]),tolerance).map(([x,z])=>({x,z}));
    if(Number.isFinite(step))points=subdivideReliefPath(points,step);
    if(points.length<2)continue;
    const start=vertices.length/3;
    for(let i=0;i<points.length;i++) {
      const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];
      const prev=new THREE.Vector2(p.x-a.x,p.z-a.z),next=new THREE.Vector2(b.x-p.x,b.z-p.z);
      if(prev.lengthSq()<1e-12)prev.copy(next);if(next.lengthSq()<1e-12)next.copy(prev);
      prev.normalize();next.normalize();
      const normal=new THREE.Vector2(-prev.y-next.y,prev.x+next.x);
      if(normal.lengthSq()<1e-8)normal.set(-next.y,next.x);else normal.normalize();
      const scale=Math.min(width*1.65,width/Math.max(.1,normal.dot(new THREE.Vector2(-next.y,next.x))));
      vertices.push(p.x-normal.x*scale,0,p.z-normal.y*scale,p.x+normal.x*scale,0,p.z+normal.y*scale);
      uv.push(0,0,0,1);
      if(i){const a=start+(i-1)*2,b=a+1,c=a+2,d=a+3;indices.push(a,c,b,b,c,d);}
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeBoundingSphere();
  return geometry;
}

export function partitionRiverPaths(paths,size=16) {
  const buckets=new Map();
  for(const path of paths) {
    const points=subdivideReliefPath(path,.5);let currentKey=null,run=[];
    const flush=()=>{if(run.length>1){if(!buckets.has(currentKey))buckets.set(currentKey,[]);buckets.get(currentKey).push(run);}run=[];};
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],key=`${Math.floor((a.x+b.x)/2/size)},${Math.floor((a.z+b.z)/2/size)}`;
      if(key!==currentKey){flush();currentKey=key;run=[a];}run.push(b);
    }
    flush();
  }
  return buckets;
}
