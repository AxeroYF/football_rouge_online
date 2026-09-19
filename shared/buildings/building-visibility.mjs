import {playersAllied} from '../config/diplomacy.mjs';
export function buildingVisibility(building,world,viewerId,ownerId){
 if(!building||!viewerId||viewerId===ownerId||playersAllied(world,viewerId,ownerId))return building;
 // An explicit public projection prevents new scheduling fields leaking by default.
 const keys=['id','type','label','iconPath','level','maxLevel','status','name','effects','effectText','seatingCapacity','capabilities','wonderId','upgradeTo'];
 return {...Object.fromEntries(keys.filter(key=>Object.hasOwn(building,key)).map(key=>[key,building[key]])),progressHidden:true};
}
