import {representativePlayers} from './representative-players.mjs';
import {BUILDING_DEFINITIONS} from './buildings.mjs';
import {facilityLevel} from './facility-levels.mjs';
export const OPERATING_RATE_VERSION=2;
export const WAGES_PER_HOUR=Object.freeze({C:5,B:10,A:15,S:20,X:25});
export const MAINTENANCE_PER_LEVEL_HOUR=10;
export const WONDER_MAINTENANCE_PER_HOUR=30;
export function playerHourlyWage(player){return WAGES_PER_HOUR[player?.isX?'X':String(player?.grade??player?.card?.grade??'C').toUpperCase() ]??5;}
export function facilityHourlyMaintenance(building){return building?.wonderId?WONDER_MAINTENANCE_PER_HOUR:building?.type==='airport'?20:BUILDING_DEFINITIONS[building?.type]?facilityLevel(building.level)*MAINTENANCE_PER_LEVEL_HOUR:0;}
export function operatingCosts(account,world,{discount=1,rateVersion=OPERATING_RATE_VERSION}={}){
 const tariffScale=rateVersion===1?.2:1;
 const players=account?.setupComplete?representativePlayers(account.draft?.roster??[],{includeLoans:true}):[];
 const buildings=account?.setupComplete?Object.values(world?.territories??{}).filter(t=>t.ownerType==='player'&&t.ownerId===account.id).flatMap(t=>(t.buildings??[]).filter(b=>b.status==='active'||b.raidSuppressed?.status==='active')):[];
 const wageGroups=[];for(const [grade,rate]of Object.entries(WAGES_PER_HOUR)){const count=players.filter(p=>playerHourlyWage(p)===rate).length;if(count)wageGroups.push({label:grade+'级球员',count,rate,total:Math.round(count*rate*1000)/1000});}
 const grouped=new Map();for(const b of buildings){const rate=facilityHourlyMaintenance(b);if(!rate)continue;const label=b.wonderId?'奇观':(BUILDING_DEFINITIONS[b.type]?.label??b.type)+' LV'+facilityLevel(b.level);const g=grouped.get(label)??{label,count:0,rate,total:0};g.count++;g.total=Math.round((g.total+rate)*1000)/1000;grouped.set(label,g);}
 const maintenanceGroups=[...grouped.values()],baseWages=wageGroups.reduce((n,g)=>n+g.total,0),baseMaintenance=maintenanceGroups.reduce((n,g)=>n+g.total,0);
 const wages=Math.round(baseWages*discount*tariffScale*1000)/1000,maintenance=Math.round(baseMaintenance*discount*tariffScale*1000)/1000;
 return {wages,maintenance,total:Math.round((wages+maintenance)*1000)/1000,baseWages:Math.round(baseWages*1000)/1000,baseMaintenance,discountPercent:Math.round((1-discount)*100),playerCount:players.length,buildingCount:maintenanceGroups.reduce((n,g)=>n+g.count,0),wageGroups,maintenanceGroups};
}
