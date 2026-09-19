function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
export const insideUnitTerritory=(p,polygons)=>polygons.some(rings=>inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r)));
const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
const samples=r=>[0,.5,1].flatMap(x=>[0,.5,1].map(y=>({x:r.x+x*r.width,y:r.y+y*r.height})));
export function placeTerritoryUnits(polygons,units,obstacles=[]){
 const points=polygons.flatMap(p=>p[0]);if(!points.length)return [];
 const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
 const candidates=[{x:0,y:0}];
 // Grid covers concave land and separate islands, not just the territory bounding box.
 for(let x=0;x<19;x++)for(let y=0;y<19;y++)candidates.push({x:minX+(maxX-minX)*(x+.5)/19,y:minY+(maxY-minY)*(y+.5)/19});
 const interior=candidates.filter(p=>insideUnitTerritory(p,polygons)),placed=[],blocked=[...obstacles];
 for(const unit of units){
  const width=unit.width,height=unit.height;
  const options=interior.map(p=>({x:p.x-width/2,y:p.y-height*.85,width,height}));
  const isContained=r=>samples(r).every(p=>insideUnitTerritory(p,polygons));
  const grounded=options.filter(r=>samples({x:r.x+r.width*.2,y:r.y+r.height*.72,width:r.width*.6,height:r.height*.2}).every(p=>insideUnitTerritory(p,polygons)));
  // If the sprite cannot fit on a tiny island, keep its ground contact inside it.
  const pool=grounded.length?grounded:options;
  pool.sort((a,b)=>{const score=r=>blocked.reduce((n,o)=>n+overlap(r,o),0)*1000+(isContained(r)?0:1000)+Math.hypot(r.x+width/2,r.y+height*.85);return score(a)-score(b);});
  const rect=pool[0];if(!rect)continue;
  blocked.push({...rect,x:rect.x-4,y:rect.y-4,width:width+8,height:height+8});placed.push({key:unit.key,...rect,fullyContained:isContained(rect)});
 }
 return placed;
}
export function createUnitTerritoryLayout({map,mapElement,territoryLayersById,getUnits,getLayoutRevision,getObstacles,referenceZoom=6.2}){
 const cache=new Map();
 return {metrics(key,territoryId,position,fallback){
  const layer=territoryLayersById.get(territoryId),raw=layer?.getLatLngs?.();if(!raw?.length||!position)return fallback;
  const units=getUnits(referenceZoom).filter(u=>u.territoryId===territoryId).sort((a,b)=>a.key.localeCompare(b.key));
  // Keep geographic ground contacts stable while the camera moves. Re-running
  // the greedy grid solver for fractional zooms flips equally good candidates.
  const buildings=[...mapElement.querySelectorAll('[data-building-territory]')].filter(e=>e.dataset.buildingTerritory===territoryId);
  const revision=getLayoutRevision?.(territoryId)??buildings.map(e=>[...e.querySelectorAll('[data-building-id]')].map(b=>b.dataset.buildingId));
  const signature=JSON.stringify([units.map(u=>u.key),revision]);let entry=cache.get(territoryId);
  if(!entry||entry.signature!==signature){
   const origin=map.latLngToContainerPoint(position),container=mapElement.getBoundingClientRect(),toReference=2**(referenceZoom-map.getZoom());
   const obstacles=getObstacles?.(territoryId,position,referenceZoom)??buildings.map(e=>{const r=e.getBoundingClientRect();return {x:(r.x-container.x-origin.x)*toReference,y:(r.y-container.y-origin.y)*toReference,width:r.width*toReference,height:r.height*toReference};});
   const multi=!Array.isArray(raw[0])?[[raw]]:!Array.isArray(raw[0][0])?[raw]:raw;
   const polygons=multi.map(rings=>rings.map(ring=>ring.map(ll=>{const p=map.latLngToContainerPoint(ll);return {x:(p.x-origin.x)*toReference,y:(p.y-origin.y)*toReference};})));
   let placements;
   for(const scale of [1,.85,.7,.55]){
    placements=placeTerritoryUnits(polygons,units.map(u=>({...u,width:Math.round(u.width*scale),height:Math.round(u.height*scale)})),obstacles);
    if(placements.every((a,i)=>placements.slice(i+1).every(b=>overlap(a,b)===0)))break;
   }
   entry={signature,placements,zoom:referenceZoom};cache.set(territoryId,entry);
  }
  const placement=entry.placements.find(u=>u.key===key);if(!placement)return fallback;
  const ratio=map.getZoomScale?.(map.getZoom(),entry.zoom)??2**(map.getZoom()-entry.zoom);
  // A sprite can shrink relative to its reserved plot but never grow outside it.
  const size=Math.min(ratio,fallback.iconSize[0]/placement.width,fallback.iconSize[1]/placement.height);
  const width=placement.width*size,height=placement.height*size;
  const x=(placement.x+placement.width/2)*ratio,y=(placement.y+placement.height*.85)*ratio;
  return {iconSize:[width,height],iconAnchor:[width/2-x,height*.85-y]};
 }};
}
