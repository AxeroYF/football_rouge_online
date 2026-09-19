import { allianceMembers } from '../config/diplomacy.mjs';
import { facilityEffects } from '../config/facility-levels.mjs';
const RAD=Math.PI/180,R=6371;
export function geoDistanceKm(a,b){
 if(!a||!b)return Infinity;
 const h=Math.sin((b[1]-a[1])*RAD/2)**2+Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin((b[0]-a[0])*RAD/2)**2;
 return 2*R*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
export function recoveryRing(center,radiusKm,steps=96){
 const [lng,lat]=center.map(x=>x*RAD),d=radiusKm/R;
 return Array.from({length:steps+1},(_,i)=>{const bearing=2*Math.PI*i/steps;
  const y=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(bearing));
  const x=lng+Math.atan2(Math.sin(bearing)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(y));
  return [x/RAD,y/RAD];
 });
}
export function recoveryCenters(world,playerId,metadata){
 const owners=new Set(allianceMembers(world,playerId));
 return Object.entries(world?.territories??{}).flatMap(([territoryId,t])=>{
  if(t.ownerType!=='player'||!owners.has(t.ownerId))return [];
  const center=metadata.get(territoryId)?.centroid;
  return (t.buildings??[]).filter(b=>b.type==='recovery-center'&&b.status==='active').map(b=>({
   buildingId:b.id,territoryId,ownerId:t.ownerId,center,level:b.level??1,builtAt:b.builtAt,...facilityEffects('recovery-center',b.level),
  }));
 });
}
export function strongestRecoveryCenter(world,playerId,territoryId,metadata){
 const point=metadata.get(territoryId)?.centroid;
 return recoveryCenters(world,playerId,metadata).filter(c=>c.territoryId===territoryId||geoDistanceKm(c.center,point)<=c.recoveryRadiusKm)
  .sort((a,b)=>b.recoveryPerMinute-a.recoveryPerMinute||String(a.buildingId).localeCompare(String(b.buildingId)))[0]??null;
}
