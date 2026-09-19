import { FOG_RULES } from "../config/fog.mjs";
import { territoryPointToDisplay } from "../../client/map/campaign-map-geometry.js";
import { project, unproject } from "../../client/map-three/projection.js";

export const intersects = (a,b) => !!a && !!b && a.minX<=b.maxX && a.maxX>=b.minX && a.minZ<=b.maxZ && a.maxZ>=b.minZ;
export const expand = (b,r) => ({minX:b.minX-r,maxX:b.maxX+r,minZ:b.minZ-r,maxZ:b.maxZ+r});
export function boundsOf(points) {
  if(!points.length)return null;
  const b={minX:Infinity,minZ:Infinity,maxX:-Infinity,maxZ:-Infinity};
  for(const [x,z] of points){b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);b.minZ=Math.min(b.minZ,z);b.maxZ=Math.max(b.maxZ,z);}return b;
}
export function mergeBounds(boxes) {
  return boundsOf(boxes.filter(Boolean).flatMap(b=>[[b.minX,b.minZ],[b.maxX,b.maxZ]]));
}
export function inRing([x,z],ring) {
  let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }return hit;
}
export const inPolygon = (p,rings) => inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r));
export function segmentDistance(p,a,b) {
  const dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
  const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/length)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}
export function nearPolygon(p,rings,radius) {
  if(inPolygon(p,rings))return true;
  for(const ring of rings)for(let i=1;i<ring.length;i++)if(segmentDistance(p,ring[i-1],ring[i])<=radius)return true;
  return false;
}
function crossed(a,b,c,d) {
  const cross=(u,v,w)=>(v[0]-u[0])*(w[1]-u[1])-(v[1]-u[1])*(w[0]-u[0]);
  return intersects(boundsOf([a,b]),boundsOf([c,d]))&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;
}
function polygonsNear(a,b,r) {
  if(!intersects(expand(a.bounds,r),b.bounds))return false;
  if(a.rings[0].some(p=>nearPolygon(p,b.rings,r))||b.rings[0].some(p=>nearPolygon(p,a.rings,r)))return true;
  for(const ar of a.rings)for(let i=1;i<ar.length;i++)for(const br of b.rings)for(let j=1;j<br.length;j++)if(crossed(ar[i-1],ar[i],br[j-1],br[j]))return true;
  return false;
}
export function convexHull(points) {
  const sorted=[...new Map(points.map(p=>[p.join(","),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(sorted.length<3)return sorted;
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=values=>{const result=[];for(const p of values){while(result.length>1&&cross(result.at(-2),result.at(-1),p)<=0)result.pop();result.push(p);}return result;};
  const a=half(sorted),b=half(sorted.toReversed());a.pop();b.pop();const ring=[...a,...b];return [...ring,ring[0]];
}

// Preserve the holdings' hull, bow its long sides gently outwards, then join
// them with tangent-continuous cubic curves. Curvature is locally bounded so
// a long island chain stays narrow instead of becoming one enormous circle.
// Flatten the same curves once for rendering, server visibility and lazy loads.
export function smoothSightEnvelope(points,curvature=FOG_RULES.radius) {
  const hull=convexHull(points);if(!hull.length)return null;
  const vertices=hull.length>2?hull.slice(0,-1):hull;
  if(vertices.length<3){const ring=[...vertices,vertices[0]];return {rings:[ring],bounds:boundsOf(ring)};}
  const bowed=[...vertices];
  for(let i=0;i<vertices.length;i++) {
    const a=vertices[i],b=vertices[(i+1)%vertices.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    const sag=Math.min(curvature,length*.08);
    bowed.push([(a[0]+b[0])/2+dz/length*sag,(a[1]+b[1])/2-dx/length*sag]);
  }
  const anchors=convexHull(bowed).slice(0,-1),unit=(a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],d=Math.hypot(dx,dz);return [dx/d,dz/d];};
  const tangents=anchors.map((p,i)=>{
    const incoming=unit(anchors[(i+anchors.length-1)%anchors.length],p),outgoing=unit(p,anchors[(i+1)%anchors.length]);
    const x=incoming[0]+outgoing[0],z=incoming[1]+outgoing[1],length=Math.hypot(x,z);return [x/length,z/length];
  });
  const ring=[anchors[0]],mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  function flatten(a,b,c,d,depth=0) {
    if(depth>=12||Math.max(segmentDistance(b,a,d),segmentDistance(c,a,d))<=.025){ring.push(d);return;}
    const ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),split=mid(abc,bcd);
    flatten(a,ab,abc,split,depth+1);flatten(split,bcd,cd,d,depth+1);
  }
  for(let i=0;i<anchors.length;i++) {
    const j=(i+1)%anchors.length,a=anchors[i],b=anchors[j],direction=unit(a,b),length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const handle=t=>Math.min(length/3,curvature/Math.max(.001,Math.abs(direction[0]*t[1]-direction[1]*t[0])));
    const ta=tangents[i],tb=tangents[j],ha=handle(ta),hb=handle(tb);
    flatten(a,[a[0]+ta[0]*ha,a[1]+ta[1]*ha],[b[0]-tb[0]*hb,b[1]-tb[1]*hb],b);
  }
  return {rings:[ring],bounds:boundsOf(ring)};
}

export function leafletBounds(bounds) {
  if(!bounds)return null;
  const a=unproject(bounds.minX,bounds.maxZ),b=unproject(bounds.maxX,bounds.minZ);
  return [[a.lat,a.lng],[b.lat,b.lng]];
}

// Geometry identity deliberately excludes encounter lists and preview expiry:
// polling/keepalive changes neither the visible footprint nor the raster.
export function fogGeometryKey(fog) {
  return JSON.stringify([fog,...(fog.sharedVision??[])].map(v=>[
    v.sourceTerritoryIds??v.visibleTerritoryIds??[],
    v.exploredSourceTerritoryIds??v.exploredTerritoryIds??v.sourceTerritoryIds??[],
    v.sharedTerritoryIds??[],v.scoutSourceTerritoryIds??[],v.exploredScoutTerritoryIds??[],
    v.preview?[v.preview.id,v.preview.sourceTerritoryId,v.preview.sourcePoint,v.preview.routes]:null,
  ]));
}

// Continuous geography, shared by server permission checks and both renderers.
// Owned holdings share a smooth contour: both water and intervening islands
// are visible inside it. Preview-only route corridors remain temporary.
export class FogSpatialIndex {
  constructor(geoJson, {displayCoordinates=false}={}) {
    this.entries=new Map();this.cache=new Map();this.modelCache=new Map();
    for(const feature of geoJson?.features??[]) {
      const id=feature.properties?.territoryId;if(!id)continue;
      const region=feature.properties.region??"europe";
      const source=feature.geometry?.type==="Polygon"?[feature.geometry.coordinates]:feature.geometry?.type==="MultiPolygon"?feature.geometry.coordinates:[];
      const polygons=source.map(rings=>{
        const projected=rings.map(ring=>ring.map(p=>{const [lat,lng]=displayCoordinates?[p[1],p[0]]:territoryPointToDisplay(p,region),v=project(lng,lat);return[v.x,v.z];}));
        return {rings:projected,bounds:boundsOf(projected[0]??[])};
      }).filter(p=>p.bounds);
      this.entries.set(id,{id,region,polygons,bounds:mergeBounds(polygons.map(p=>p.bounds))});
    }
  }
  plan(ids=[],preview=null,sharedIds=[]) {
    const key=JSON.stringify([ids,preview?[preview.id,preview.sourceTerritoryId,preview.sourcePoint,preview.routes]:null,sharedIds]);if(this.cache.has(key))return this.cache.get(key);
    const sources=ids.map(id=>this.entries.get(id)).filter(Boolean),polygons=sources.flatMap(e=>e.polygons);
    const groups=new Map();for(const e of sources){if(!groups.has(e.region))groups.set(e.region,[]);groups.get(e.region).push(...e.polygons.flatMap(p=>p.rings[0]));}
    const envelopes=[...groups.values()].map(points=>smoothSightEnvelope(points)).filter(Boolean);
    polygons.push(...envelopes);
    const circles=[],seaLines=[];
    for(const route of preview?.routes??[]) {
      const to=this.entries.get(route.targetTerritoryId),from=this.entries.get(preview.sourceTerritoryId);if(!to||!from)continue;
      const convert=(point,region)=>{const [lat,lng]=territoryPointToDisplay(point,region),p=project(lng,lat);return[p.x,p.z];};
      const a=convert(preview.sourcePoint,from.region),b=convert(route.targetPoint,to.region);
      circles.push({point:b,radius:FOG_RULES.previewRadius});seaLines.push({a,b,radius:FOG_RULES.radius});
    }
    const sharedPolygons=sharedIds.flatMap(id=>this.entries.get(id)?.polygons??[]);
    const bounds=mergeBounds([...sharedPolygons.map(p=>p.bounds),...polygons.map(p=>expand(p.bounds,FOG_RULES.radius)),...circles.map(c=>expand(boundsOf([c.point]),c.radius))]);
    const plan={sourceIds:new Set([...ids,...sharedIds]),sharedPolygons,polygons,envelopes,circles,seaLines,bounds,radius:FOG_RULES.radius};
    this.cache.set(key,plan);if(this.cache.size>24)this.cache.delete(this.cache.keys().next().value);return plan;
  }
  mergePlans(plans) {
    return {sourceIds:new Set(plans.flatMap(p=>[...p.sourceIds])),radius:FOG_RULES.radius,
      ...Object.fromEntries(['sharedPolygons','polygons','envelopes','circles','seaLines'].map(key=>[key,[...new Set(plans.flatMap(p=>p[key]??[]))]])),bounds:mergeBounds(plans.map(p=>p.bounds))};
  }
  models(fog) {
    // Terrain/nature queries call this for thousands of bounds. More than 24
    // alliance/scout plans thrash the per-plan cache; retain the merged result.
    // Content keys also invalidate in-place mutations and reuse polled snapshots.
    const key=fogGeometryKey(fog);
    if(this.modelCache.has(key)){
      const cached=this.modelCache.get(key);this.modelCache.delete(key);this.modelCache.set(key,cached);return cached;
    }
    const views=[fog,...(fog.sharedVision??[])];
    const current=this.mergePlans(views.flatMap(v=>[this.plan(v.sourceTerritoryIds??v.visibleTerritoryIds??[],v.preview,v.sharedTerritoryIds??[]),...(v.scoutSourceTerritoryIds??[]).map(id=>this.plan([id]))]));
    const explored=this.mergePlans(views.flatMap(v=>[this.plan(v.exploredSourceTerritoryIds??v.exploredTerritoryIds??v.sourceTerritoryIds??[]),...(v.exploredScoutTerritoryIds??[]).map(id=>this.plan([id]))]));
    const result={current,explored,bounds:mergeBounds([current.bounds,explored.bounds])};
    this.modelCache.set(key,result);
    if(this.modelCache.size>4)this.modelCache.delete(this.modelCache.keys().next().value);
    return result;
  }
  isLand(point) {
    const box=boundsOf([point]);for(const e of this.entries.values())if(intersects(e.bounds,box)&&e.polygons.some(p=>intersects(p.bounds,box)&&inPolygon(point,p.rings)))return true;return false;
  }
  landVisible(plan,point,padding=0) {
    const box=boundsOf([point]);
    return (plan.sharedPolygons??[]).some(p=>inPolygon(point,p.rings)) || plan.polygons.some(p=>intersects(expand(p.bounds,plan.radius+padding),box)&&nearPolygon(point,p.rings,plan.radius+padding))
      ||plan.circles.some(c=>Math.hypot(point[0]-c.point[0],point[1]-c.point[1])<=c.radius+padding);
  }
  pointVisible(plan,point) {
    // The feather is still visibly part of the map. Use the same margin for
    // mouse hits and server-visible IDs so exposed slivers have readable intel.
    if(this.landVisible(plan,point,FOG_RULES.feather))return true;
    const sea=plan.seaLines.some(l=>segmentDistance(point,l.a,l.b)<=l.radius+FOG_RULES.feather);
    return sea&&!this.isLand(point);
  }
  visibleIds(plan) {
    if(plan.visibleIds)return plan.visibleIds;
    const ids=[];for(const e of this.entries.values()){
      if(plan.sourceIds.has(e.id)||e.polygons.some(p=>plan.polygons.some(s=>polygonsNear(p,s,plan.radius+FOG_RULES.feather))
        ||plan.circles.some(c=>nearPolygon(c.point,p.rings,c.radius+FOG_RULES.feather))))ids.push(e.id);
    }return plan.visibleIds=ids.sort();
  }
  touchesLand(plan,box,padding=FOG_RULES.feather) {
    return (plan.sharedPolygons??[]).some(p=>intersects(p.bounds,box)) || plan.polygons.some(p=>intersects(expand(p.bounds,plan.radius+padding),box))
      ||plan.circles.some(c=>intersects(expand(boundsOf([c.point]),c.radius+padding),box));
  }
}
