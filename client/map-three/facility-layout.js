import { projectTerritoryPoint } from './projection.js';
export function pointInside(point,rings){const hit=ring=>{let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point.z)!==(b[1]>point.z)&&point.x<(b[0]-a[0])*(point.z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};return hit(rings[0])&&!rings.slice(1).some(hit);}
const projectRing=(ring,region)=>ring.map(p=>{const q=projectTerritoryPoint(p,region);return [q.x,q.z];});
export function facilitySites(metadata,feature,buildings,coastlines=[]){
 if(!metadata||!feature||!buildings.length)return [];
 const center=projectTerritoryPoint(metadata.buildAnchor??metadata.centroid,metadata.region);
 const polygons=(feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates).map(p=>p.map(r=>projectRing(r,metadata.region)));
 const inside=p=>polygons.some(r=>pointInside(p,r));
 let radius=Infinity;
 for(const rings of polygons.filter(r=>pointInside(center,r)))for(const ring of rings)for(let i=1;i<ring.length;i++){
  const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((center.x-a[0])*dx+(center.z-a[1])*dz)/(dx*dx+dz*dz||1)));
  radius=Math.min(radius,Math.hypot(center.x-a[0]-t*dx,center.z-a[1]-t*dz));
 }
 if(!Number.isFinite(radius))return [];
 const ordered=[...buildings].sort((a,b)=>(a.type==='club-headquarters'?-1:0)-(b.type==='club-headquarters'?-1:0)||a.id.localeCompare(b.id));
 const width=Math.max(.0001,Math.min(2.25,radius*(ordered.length===1?1.3:ordered.length<=3?.59:1/(1+Math.sqrt(ordered.length-1)))));
 return ordered.map((building,i)=>{
  const angle=i*2*Math.PI/ordered.length-.7,offset=ordered.length>1?width*.88:0;
  const site={building,territoryId:metadata.territoryId,x:center.x+Math.cos(angle)*offset,z:center.z+Math.sin(angle)*offset,width,rotation:building.type==='club-shop'?Math.PI:0};
  if(building.type==='port'&&coastlines.length){
   const candidates=[];
   for(const line of coastlines){const points=line.map(p=>projectTerritoryPoint(p,metadata.region));for(let j=1;j<points.length;j++){
    const a=points[j-1],b=points[j],length=Math.hypot(a.x-b.x,a.z-b.z);if(length<.02)continue;
    const p={x:(a.x+b.x)/2,z:(a.z+b.z)/2},nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
    for(const side of [-1,1]){const outward={x:nx*side,z:nz*side},w=Math.min(1.9,Math.max(.1,width));
     if(!inside({x:p.x+outward.x*w*.4,z:p.z+outward.z*w*.4})&&inside({x:p.x-outward.x*w*.4,z:p.z-outward.z*w*.4}))
      candidates.push({...p,outward,score:Math.hypot(p.x-center.x,p.z-center.z)});
    }
   }}
   candidates.sort((a,b)=>a.score-b.score);const p=candidates[0];if(p){site.x=p.x-p.outward.x*width*.16;site.z=p.z-p.outward.z*width*.16;site.rotation=Math.atan2(p.outward.x,p.outward.z);site.coastal=true;}
  }
  return site;
 });
}
