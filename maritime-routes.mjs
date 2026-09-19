import { playersAtWar, canUseTerritory } from "./shared/config/diplomacy.mjs";
import { territoryPointToDisplay, displayPointToTerritory, transformSouthAmericaFeature } from './client/map/campaign-map-geometry.js';
import { facilityEffects } from './shared/config/facility-levels.mjs';
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import {
  MARITIME_MAX_COAST_SNAP_KM,
  MARITIME_MAX_RANGE_KM,
  MARITIME_MIN_ROUTE_KM,
  MARITIME_ROUTE_SAMPLE_KM,
} from "./shared/config/maritime.mjs";

const radians = (value) => value * Math.PI / 180;
export function maritimeDistanceKm(left,right) {
  const dLat=radians(right[1]-left[1]); const dLng=radians(right[0]-left[0]);
  const a=Math.sin(dLat/2)**2+Math.cos(radians(left[1]))*Math.cos(radians(right[1]))*Math.sin(dLng/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function bearing(left,right) { return (Math.atan2(Math.sin(radians(right[0]-left[0]))*Math.cos(radians(right[1])),Math.cos(radians(left[1]))*Math.sin(radians(right[1]))-Math.sin(radians(left[1]))*Math.cos(radians(right[1]))*Math.cos(radians(right[0]-left[0])))*180/Math.PI+360)%360; }
function interpolate(left,right,t) { return [left[0]+(right[0]-left[0])*t,left[1]+(right[1]-left[1])*t]; }
export function nearestPointOnCoastlines(coastlines,requestedPoint) {
  const longitudeScale=Math.max(.01,Math.cos(radians(requestedPoint[1]))); let nearest=null;
  for(const line of coastlines??[]){
    for(let index=1;index<line.length;index+=1){
      const start=line[index-1]; const end=line[index];
      const dx=(end[0]-start[0])*longitudeScale; const dy=end[1]-start[1];
      const px=(requestedPoint[0]-start[0])*longitudeScale; const py=requestedPoint[1]-start[1];
      const lengthSquared=dx*dx+dy*dy;
      const ratio=lengthSquared?Math.max(0,Math.min(1,(px*dx+py*dy)/lengthSquared)):0;
      const candidate=interpolate(start,end,ratio); const distance=maritimeDistanceKm(requestedPoint,candidate);
      if(!nearest||distance<nearest.distance)nearest={candidate,distance};
    }
  }
  return nearest;
}
function overlaps(left,right) { return left[0]<=right[2]&&left[2]>=right[0]&&left[1]<=right[3]&&left[3]>=right[1]; }
function lineBounds(left,right) { return [Math.min(left[0],right[0]),Math.min(left[1],right[1]),Math.max(left[0],right[0]),Math.max(left[1],right[1])]; }
// Leaflet draws straight sea lanes in Web Mercator, not in raw lon/lat.
function interpolateRoute(left,right,t) {
  const project=(lat)=>Math.log(Math.tan(Math.PI/4+radians(Math.max(-85.05112878,Math.min(85.05112878,lat)))/2));
  const y=project(left[1])+(project(right[1])-project(left[1]))*t;
  return [left[0]+(right[0]-left[0])*t,(2*Math.atan(Math.exp(y))-Math.PI/2)*180/Math.PI];
}
function startsTowardOpenWater(sourceFeature,from,to) {
  const distance=maritimeDistanceKm(from,to);
  if(!sourceFeature||!Number.isFinite(distance)||distance<=0)return false;
  const probeDistanceKm=Math.min(1,distance/2);
  const probe=interpolateRoute(from,to,probeDistanceKm/distance);
  return !booleanPointInPolygon(point(probe),sourceFeature);
}

export function createMaritimeRoutePlanner({ coastlineData, territoryGeoJson, territoryIndex }) {
  const metadataById=new Map((territoryIndex?.territories??[]).map((entry)=>[entry.territoryId,entry]));
  // Keep wire/save points in source coordinates; all geometry decisions use the
  // same displayed world as the client (South America is rotated and relocated).
  const toDisplay=(id,p)=>territoryPointToDisplay(p,metadataById.get(id)?.region).reverse();
  const toSource=(id,p)=>displayPointToTerritory({lng:p[0],lat:p[1]},metadataById.get(id)?.region);
  const displayIndex=(territoryIndex?.territories??[]).map(entry=>{
    const a=toDisplay(entry.territoryId,entry.bounds.slice(0,2));
    const b=toDisplay(entry.territoryId,entry.bounds.slice(2,4));
    return {...entry,bounds:lineBounds(a,b)};
  });
  const displayBounds=new Map(displayIndex.map(entry=>[entry.territoryId,entry.bounds]));
  const featureById=new Map((territoryGeoJson?.features??[]).map(feature=>{
    const id=feature.properties.territoryId;
    const displayed=metadataById.get(id)?.region==='south-america'?transformSouthAmericaFeature(feature):feature;
    return [id,{...displayed,bbox:displayBounds.get(id)}];
  }));
  const coastsById=new Map(Object.entries(coastlineData?.territories??{}).map(([id,entry])=>
    [id,(entry.coastlines??[]).map(line=>line.map(p=>toDisplay(id,p)))]));
  const coastalIds=new Set(coastsById.keys());
  // Geometry assets can retain an older range; gameplay uses the current server rule.
  const maxRangeKm=MARITIME_MAX_RANGE_KM;
  const snapToCoast=(territoryId,requestedPoint)=>nearestPointOnCoastlines(coastsById.get(territoryId),toDisplay(territoryId,requestedPoint));
  const clearRoute=(sourceId,targetId,from,to)=>{
    const bounds=lineBounds(from,to);
    const blockers=displayIndex.filter((entry)=>entry.territoryId!==sourceId&&entry.territoryId!==targetId&&overlaps(entry.bounds,bounds));
    const steps=Math.max(12,Math.ceil(maritimeDistanceKm(from,to)/MARITIME_ROUTE_SAMPLE_KM));
    for(let index=1;index<steps;index+=1){
      const sample=interpolateRoute(from,to,index/steps); const samplePoint=point(sample);
      if(blockers.some((entry)=>booleanPointInPolygon(samplePoint,featureById.get(entry.territoryId))))return false;
    }
    return true;
  };
  const routesFrom=(world,playerId,sourceTerritoryId,requestedPoint,now=Date.now())=>{
    const sourceState=world?.territories?.[sourceTerritoryId];
    const port=sourceState?.buildings?.find(b=>b.type==='port'&&b.status==='active');
    const effectiveRangeKm=port?facilityEffects('port',port.level).rangeKm:maxRangeKm;
    if(!canUseTerritory(world,playerId,sourceTerritoryId))throw new Error("只能从自己或盟友的领土地块出海");
    if(!coastalIds.has(sourceTerritoryId))throw new Error("该地块没有可用海岸线");
    const snapped=snapToCoast(sourceTerritoryId,requestedPoint);
    if(!snapped||snapped.distance>MARITIME_MAX_COAST_SNAP_KM)throw new Error("请选择该地块海岸线附近的出发点");
    const sourceMetadata=metadataById.get(sourceTerritoryId); const candidates=[];
    const landNeighborIds=new Set(sourceMetadata.landNeighbors??[]);
    for(const targetTerritoryId of coastalIds){
      if(targetTerritoryId===sourceTerritoryId)continue;
      if(landNeighborIds.has(targetTerritoryId))continue;
      const targetState=world.territories[targetTerritoryId];
      if(targetState?.ownerType==="player"&&(targetState.ownerId===playerId||!playersAtWar(world,playerId,targetState.ownerId)))continue;
      if(targetState?.protectedUntil&&Number(targetState.protectedUntil)>now)continue;
      const targetMetadata=metadataById.get(targetTerritoryId);
      if(!targetMetadata)continue;
      const nearest=nearestPointOnCoastlines(coastsById.get(targetTerritoryId),snapped.candidate);
      if(!nearest||nearest.distance<MARITIME_MIN_ROUTE_KM||nearest.distance>effectiveRangeKm)continue;
      if(!startsTowardOpenWater(featureById.get(sourceTerritoryId),snapped.candidate,nearest.candidate))continue;
      if(!clearRoute(sourceTerritoryId,targetTerritoryId,snapped.candidate,nearest.candidate))continue;
      candidates.push({ targetTerritoryId,sourcePoint:toSource(sourceTerritoryId,snapped.candidate),targetPoint:toSource(targetTerritoryId,nearest.candidate),distanceKm:Math.round(nearest.distance),bearing:Math.round(bearing(snapped.candidate,nearest.candidate)) });
    }
    // Keep every geometrically reachable coast, including multiple landings
    // in the same angular sector. Actual intervening land still blocks routes.
    return { sourceTerritoryId,maxRangeKm:effectiveRangeKm,sourcePoint:toSource(sourceTerritoryId,snapped.candidate),routes:candidates.sort((a,b)=>a.bearing-b.bearing || a.distanceKm-b.distanceKm) };
  };
  return { coastalTerritoryIds:[...coastalIds].sort(),isCoastal:(territoryId)=>coastalIds.has(territoryId),routesFrom };
}
