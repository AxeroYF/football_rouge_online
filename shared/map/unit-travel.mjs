// The displayed position and progress share one departure-to-arrival clock.
export function unitTravelProgress(movement, now){
 if(!movement)return 0;
 const startedAt=Number(movement.startedAt),duration=Math.max(1,Number(movement.arrivesAt)-startedAt||Number(movement.durationMs)||1);
 const elapsed=Number(now)-startedAt;
 return Number.isFinite(elapsed)?Math.max(0,Math.min(1,elapsed/duration)):0;
}
export function unitTravelFrame(movement,now){
 if(!movement)return null;
 const fromTerritoryId=movement.fromTerritoryId??movement.path?.[0],toTerritoryId=movement.toTerritoryId??movement.path?.at(-1);
 return fromTerritoryId&&toTerritoryId?{fromTerritoryId,toTerritoryId,progress:unitTravelProgress(movement,now)}:null;
}
export function interpolateMapTravel(map,from,to,progress){
 // Interpolate in the same projected plane as Leaflet's straight route line.
 if(map.project&&map.unproject){
  const a=map.project(from,0),b=map.project(to,0);
  return map.unproject([a.x+(b.x-a.x)*progress,a.y+(b.y-a.y)*progress],0);
 }
 return [from[0]+(to[0]-from[0])*progress,from[1]+(to[1]-from[1])*progress];
}
