import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {topology} from 'topojson-server';
import {merge,feature} from 'topojson-client';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import {point} from '@turf/helpers';
const polys=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
function bounds(g){const a=[Infinity,Infinity,-Infinity,-Infinity];for(const p of polys(g))for(const r of p)for(const [x,y]of r){a[0]=Math.min(a[0],x);a[1]=Math.min(a[1],y);a[2]=Math.max(a[2],x);a[3]=Math.max(a[3],y);}return a;}
function ringArea(r){let a=0;for(let i=1;i<r.length;i++)a+=r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1];return Math.abs(a)/2;}
function inRing(x,y,r){let hit=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
// Bounded interior search: preserve an actual inside point for narrow / concave regions.
export function interiorAnchor(geometry,seeds=[]){
 const poly=[...polys(geometry)].sort((a,b)=>ringArea(b[0])-ringArea(a[0]))[0],all=poly[0],minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),maxY=Math.max(...all.map(p=>p[1])),cos=Math.max(.1,Math.cos((minY+maxY)*Math.PI/360));
 function distance(x,y){if(!inRing(x,y,poly[0])||poly.slice(1).some(r=>inRing(x,y,r)))return -1;let d=Infinity;for(const r of poly)for(let i=1;i<r.length;i++){const a=r[i-1],b=r[i],dx=(b[0]-a[0])*cos,dy=b[1]-a[1],px=(x-a[0])*cos,py=y-a[1],t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1)));d=Math.min(d,Math.hypot(px-t*dx,py-t*dy));}return d;}
 let best={x:(minX+maxX)/2,y:(minY+maxY)/2,d:-1};const tryPoint=(x,y)=>{const d=distance(x,y);if(d>best.d)best={x,y,d};};
 for(const p of seeds)tryPoint(...p);
 for(let j=0;j<=12;j++)for(let i=0;i<=12;i++)tryPoint(minX+(maxX-minX)*(i+.5)/13,minY+(maxY-minY)*(j+.5)/13);
 let sx=(maxX-minX)/12,sy=(maxY-minY)/12;
 for(let n=0;n<5;n++){const bx=best.x,by=best.y;for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++)tryPoint(bx+i*sx/2,by+j*sy/2);sx/=3;sy/=3;}
 if(best.d<0){const seed=seeds.find(p=>booleanPointInPolygon(point(p),{type:'Feature',properties:{},geometry}));if(!seed)throw Error('No interior anchor found');return {position:seed,radiusKm:0};}
 return {position:[+best.x.toFixed(6),+best.y.toFixed(6)],radiusKm:+(best.d*111.2).toFixed(3)};
}
export function buildMergedRegions(source,plan,{aliases={},cities=[]}={}){
 assert.equal(source.length,plan.sourceTerritoryCount);
 const byId=new Map(source.map(f=>[f.properties.territoryId,f])),used=new Set(),newAliases={...aliases};
 const top=topology({territories:{type:'FeatureCollection',features:source}},1000000),topById=new Map(top.objects.territories.geometries.map(g=>[g.properties.territoryId,g]));
 const features=plan.regions.map(group=>{
  const members=group.members.map(id=>{assert.ok(byId.has(id),'Unknown merge member '+id);assert.ok(!used.has(id),'Duplicate merge member '+id);used.add(id);return byId.get(id);});
  assert.ok(members.every(f=>f.properties.countryCode===group.countryCode));
  const geometry=members.length===1?feature(top,topById.get(group.members[0])).geometry:merge(top,group.members.map(id=>topById.get(id)));
  const wrapper={type:'Feature',properties:{},geometry},city=cities.find(c=>group.cityIds.includes(c.id)&&booleanPointInPolygon(point([c.lng,c.lat]),wrapper));
  const anchor=interiorAnchor(geometry,[...(city?[[city.lng,city.lat]]:[]),...members.map(f=>f.properties.centroid)]);
  const properties={...members[0].properties,territoryId:group.territoryId,sourceId:group.territoryId,region:group.region,countryCode:group.countryCode,
   name:members.length===1?members[0].properties.name:(city?city.name:group.anchorName||members[0].properties.country)+'地区',
   nameEn:members.length===1?members[0].properties.nameEn:(city?.id||members[0].properties.nameEn)+' Region',
   type:members.length===1?members[0].properties.type:'Game region',centroid:anchor.position,bounds:bounds(geometry),buildAnchor:anchor.position,buildRadiusKm:anchor.radiusKm,
   mergedSourceTerritoryIds:group.members,sourceTerritoryCount:group.members.length,mapVersion:plan.mapVersion};
  for(const id of group.members)if(id!==group.territoryId)newAliases[id]=group.territoryId;
  return {type:'Feature',id:group.territoryId,geometry,properties};
 });
 for(const id of Object.keys(newAliases)){let value=newAliases[id],seen=new Set([id]);while(newAliases[value]&&!seen.has(value)){seen.add(value);value=newAliases[value];}newAliases[id]=value;}
 assert.equal(used.size,source.length);assert.equal(features.length,598);
 for(const f of features)assert.ok(booleanPointInPolygon(point(f.properties.centroid),f),'Anchor outside '+f.id);
 return {features:features.sort((a,b)=>a.properties.territoryId.localeCompare(b.properties.territoryId)),territoryIdAliases:newAliases,mapVersion:plan.mapVersion};
}
